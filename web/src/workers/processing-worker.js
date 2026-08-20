import { spectrumDb } from "../dsp/fft.js";
import { AudioDemodulator, recommendedAudioBandwidth, rms } from "../dsp/demodulators.js";
import { AdsbIqDecoder } from "../dsp/adsb.js";

let wasm = null;
let wasmMode = "javascript-fallback";
let heapBase = 65536;
let sharedPool = null;
let settings = {
  fftSize: 1024,
  fftWindow: "hann",
  averaging: 0.35,
  peakHold: false,
  displayRateHz: 30,
  spectrumStride: 1,
  floorDb: -140,
  audioEnabled: false,
  modulation: "wfm",
  audioOutputRate: 48000,
  audioBandwidthHz: 15000,
  deemphasisUs: 75,
  squelchDb: -55,
  ssbLowCutHz: 300,
  ritHz: 0,
  cwPitchHz: 700,
  agcMode: "medium",
  decoderMode: "none"
};
let averageSpectrum = null;
let peakSpectrum = null;
let lastPublishedAt = 0;
let lastSequence = -1;
let sequenceGaps = 0;
let processedBlocks = 0;
let spectrumBlocks = 0;
let audioFramesProduced = 0;
let audioSamplesProduced = 0;
const audioDemodulator = new AudioDemodulator(settings);
const adsbDecoder = new AdsbIqDecoder({ sampleRate: 2_400_000 });

function align16(value) { return (value + 15) & ~15; }

async function initializeWasm(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`WebAssembly response status ${response.status}`);
    const result = await WebAssembly.instantiateStreaming(response, {});
    wasm = result.instance.exports;
    const exportedHeap = wasm.__heap_base;
    heapBase = Number(exportedHeap?.value ?? exportedHeap ?? 65536);
    if (!wasm.memory || typeof wasm.mayhem_rtl_convert_u8_iq !== "function") throw new Error("Required WebAssembly exports are missing");
    wasmMode = "webassembly";
  } catch (error) {
    wasm = null;
    wasmMode = "javascript-fallback";
    postMessage({ type: "warning", message: "WebAssembly sample kernel could not start; using the local JavaScript fallback.", detail: error.message });
  }
}

function ensureMemory(bytes) {
  if (!wasm?.memory) return;
  const available = wasm.memory.buffer.byteLength;
  if (available >= bytes) return;
  const pages = Math.ceil((bytes - available) / 65536);
  wasm.memory.grow(pages);
}

function convertSamples(bytes, count) {
  if (wasm) {
    const inputPointer = align16(heapBase);
    const iPointer = align16(inputPointer + bytes.byteLength);
    const qPointer = align16(iPointer + count * 4);
    ensureMemory(qPointer + count * 4 + 64);
    new Uint8Array(wasm.memory.buffer, inputPointer, bytes.byteLength).set(bytes);
    wasm.mayhem_rtl_convert_u8_iq(inputPointer, iPointer, qPointer, count);
    wasm.mayhem_rtl_dc_remove(iPointer, qPointer, count);
    return {
      i: new Float32Array(wasm.memory.buffer, iPointer, count),
      q: new Float32Array(wasm.memory.buffer, qPointer, count),
      power: wasm.mayhem_rtl_mean_power(iPointer, qPointer, count)
    };
  }
  const i = new Float32Array(count);
  const q = new Float32Array(count);
  let meanI = 0;
  let meanQ = 0;
  for (let index = 0; index < count; index += 1) {
    i[index] = (bytes[index * 2] - 127.5) / 127.5;
    q[index] = (bytes[index * 2 + 1] - 127.5) / 127.5;
    meanI += i[index];
    meanQ += q[index];
  }
  meanI /= count;
  meanQ /= count;
  let power = 0;
  for (let index = 0; index < count; index += 1) {
    i[index] -= meanI;
    q[index] -= meanQ;
    power += i[index] * i[index] + q[index] * q[index];
  }
  return { i, q, power: power / count };
}

function updateAveraging(current) {
  if (!averageSpectrum || averageSpectrum.length !== current.length) averageSpectrum = current.slice();
  else {
    const alpha = Math.max(0, Math.min(1, Number(settings.averaging)));
    for (let index = 0; index < current.length; index += 1) averageSpectrum[index] = averageSpectrum[index] * alpha + current[index] * (1 - alpha);
  }
  if (settings.peakHold) {
    if (!peakSpectrum || peakSpectrum.length !== current.length) peakSpectrum = current.slice();
    else for (let index = 0; index < current.length; index += 1) peakSpectrum[index] = Math.max(current[index], peakSpectrum[index] - 0.04);
  } else peakSpectrum = null;
  return { average: averageSpectrum, peak: peakSpectrum };
}

function processAudio(converted, sampleRate, levelDbfs) {
  if (!settings.audioEnabled) return;
  const mode = ["wfm", "nfm", "am", "usb", "lsb", "cw"].includes(settings.modulation) ? settings.modulation : "wfm";
  audioDemodulator.configure({
    mode,
    outputRate: Number(settings.audioOutputRate) || 48000,
    audioBandwidthHz: Number(settings.audioBandwidthHz) || recommendedAudioBandwidth(mode),
    deemphasisUs: Number(settings.deemphasisUs) || 75,
    ssbLowCutHz: Number(settings.ssbLowCutHz) || 300,
    ritHz: Number(settings.ritHz) || 0,
    cwPitchHz: Number(settings.cwPitchHz) || 700,
    agcMode: String(settings.agcMode || "medium")
  });
  const samples = audioDemodulator.process(converted.i, converted.q, sampleRate);
  if (!samples.length) return;
  const squelchOpen = levelDbfs >= Number(settings.squelchDb ?? -55);
  if (!squelchOpen) samples.fill(0);
  const levelRms = rms(samples);
  audioFramesProduced += 1;
  audioSamplesProduced += samples.length;
  postMessage({ type: "audio", samples, mode, outputRate: Number(settings.audioOutputRate) || 48000, squelchOpen, levelRms, audioFramesProduced, audioSamplesProduced }, [samples.buffer]);
}

function processBlock(message, bytes) {
  const started = performance.now();
  const { sequence, sampleRate, frequency, receivedAt, sharedSlot } = message;
  const responseSlot = Number.isInteger(sharedSlot) ? sharedSlot : undefined;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) {
    postMessage({ type: "ack", sequence, rejected: true, reason: "empty-block", sharedSlot: responseSlot });
    return;
  }
  if (lastSequence >= 0 && sequence !== lastSequence + 1) sequenceGaps += Math.max(0, sequence - lastSequence - 1);
  lastSequence = sequence;
  const complexSamples = Math.floor(bytes.byteLength / 2);
  const converted = convertSamples(bytes, complexSamples);
  processedBlocks += 1;
  const levelDbfs = 10 * Math.log10(Math.max(1e-12, converted.power / 2));
  processAudio(converted, sampleRate, levelDbfs);
  if (settings.decoderMode === "adsb" && sampleRate >= 2_000_000) {
    adsbDecoder.configure({ sampleRate });
    const decodedFrames = adsbDecoder.process(converted.i, converted.q, { receivedAtMs: Date.now() });
    for (const frame of decodedFrames) postMessage({ type: "adsb", frame });
  }

  const stride = Math.max(1, Math.min(8, Math.round(Number(settings.spectrumStride) || 1)));
  const computeSpectrum = (processedBlocks - 1) % stride === 0;
  if (!computeSpectrum) {
    postMessage({
      type: "ack", sequence, sharedSlot: responseSlot, levelDbfs,
      workerTimeMs: performance.now() - started, sourceLatencyMs: Number.isFinite(receivedAt) ? performance.now() - receivedAt : null,
      sequenceGaps, processedBlocks, spectrumBlocks, wasmMode
    });
    return;
  }

  const fftSize = Math.min(settings.fftSize, 1 << Math.floor(Math.log2(complexSamples)));
  const current = spectrumDb(converted.i, converted.q, { size: fftSize, window: settings.fftWindow, floorDb: settings.floorDb });
  const spectra = updateAveraging(current);
  spectrumBlocks += 1;
  const now = performance.now();
  const publishInterval = 1000 / Math.max(1, settings.displayRateHz);
  const publish = now - lastPublishedAt >= publishInterval;
  if (publish) {
    lastPublishedAt = now;
    const average = spectra.average.slice();
    const peak = spectra.peak?.slice() ?? null;
    const transfers = [average.buffer];
    if (peak) transfers.push(peak.buffer);
    postMessage({
      type: "processed",
      sequence,
      sharedSlot: responseSlot,
      frequency,
      sampleRate,
      complexSamples,
      levelDbfs,
      spectrum: average,
      peak,
      fftSize,
      workerTimeMs: performance.now() - started,
      sourceLatencyMs: Number.isFinite(receivedAt) ? performance.now() - receivedAt : null,
      sequenceGaps,
      processedBlocks,
      spectrumBlocks,
      spectrumStride: stride,
      displayRateHz: settings.displayRateHz,
      wasmMode
    }, transfers);
  } else {
    postMessage({
      type: "ack", sequence, sharedSlot: responseSlot, levelDbfs,
      workerTimeMs: performance.now() - started, sourceLatencyMs: Number.isFinite(receivedAt) ? performance.now() - receivedAt : null,
      sequenceGaps, processedBlocks, spectrumBlocks, spectrumStride: stride, displayRateHz: settings.displayRateHz, wasmMode
    });
  }
}

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  if (message.type === "init") {
    if (message.settings) settings = { ...settings, ...message.settings };
    if (typeof SharedArrayBuffer === "function" && message.sharedPool?.buffer instanceof SharedArrayBuffer) {
      sharedPool = {
        buffer: message.sharedPool.buffer,
        slotBytes: Number(message.sharedPool.slotBytes),
        slots: Number(message.sharedPool.slots)
      };
    }
    audioDemodulator.configure(settings);
    adsbDecoder.configure({ sampleRate: Number(settings.sampleRate) || 2_400_000 });
    await initializeWasm(message.wasmUrl);
    postMessage({ type: "ready", wasmMode, settings, sharedMemory: Boolean(sharedPool) });
  } else if (message.type === "settings") {
    settings = { ...settings, ...message.settings };
    audioDemodulator.configure(settings);
    adsbDecoder.configure({ sampleRate: Number(settings.sampleRate) || adsbDecoder.sampleRate });
    if (message.resetAveraging) { averageSpectrum = null; peakSpectrum = null; }
    if (message.resetAudio) audioDemodulator.reset();
    postMessage({ type: "settings-applied", settings });
  } else if (message.type === "block") {
    if (message.buffer instanceof ArrayBuffer) processBlock(message, new Uint8Array(message.buffer));
    else postMessage({ type: "ack", sequence: message.sequence, rejected: true, reason: "invalid-transferable-block" });
  } else if (message.type === "block-shared") {
    const slot = Number(message.sharedSlot);
    const length = Math.max(0, Math.min(sharedPool?.slotBytes ?? 0, Math.round(Number(message.length) || 0)));
    if (!sharedPool || !Number.isInteger(slot) || slot < 0 || slot >= sharedPool.slots || length < 4) {
      postMessage({ type: "ack", sequence: message.sequence, sharedSlot: slot, rejected: true, reason: "invalid-shared-block" });
    } else {
      processBlock(message, new Uint8Array(sharedPool.buffer, slot * sharedPool.slotBytes, length));
    }
  } else if (message.type === "reset") {
    averageSpectrum = null;
    peakSpectrum = null;
    lastSequence = -1;
    sequenceGaps = 0;
    processedBlocks = 0;
    spectrumBlocks = 0;
    audioFramesProduced = 0;
    audioSamplesProduced = 0;
    audioDemodulator.reset();
    adsbDecoder.reset();
    postMessage({ type: "reset-complete" });
  }
});
