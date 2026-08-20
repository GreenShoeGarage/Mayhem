import { spectrumDb } from "../dsp/fft.js";

let wasm = null;
let wasmMode = "javascript-fallback";
let heapBase = 65536;
let settings = {
  fftSize: 1024,
  fftWindow: "hann",
  averaging: 0.35,
  peakHold: false,
  displayRateHz: 30,
  floorDb: -140
};
let averageSpectrum = null;
let peakSpectrum = null;
let lastPublishedAt = 0;
let lastSequence = -1;
let sequenceGaps = 0;
let processedBlocks = 0;

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

function convertSamples(buffer, count) {
  if (wasm) {
    const inputPointer = align16(heapBase);
    const iPointer = align16(inputPointer + buffer.byteLength);
    const qPointer = align16(iPointer + count * 4);
    ensureMemory(qPointer + count * 4 + 64);
    new Uint8Array(wasm.memory.buffer, inputPointer, buffer.byteLength).set(new Uint8Array(buffer));
    wasm.mayhem_rtl_convert_u8_iq(inputPointer, iPointer, qPointer, count);
    wasm.mayhem_rtl_dc_remove(iPointer, qPointer, count);
    return {
      i: new Float32Array(wasm.memory.buffer, iPointer, count),
      q: new Float32Array(wasm.memory.buffer, qPointer, count),
      power: wasm.mayhem_rtl_mean_power(iPointer, qPointer, count)
    };
  }
  const bytes = new Uint8Array(buffer);
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

function processBlock(message) {
  const started = performance.now();
  const { sequence, buffer, sampleRate, frequency, receivedAt } = message;
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) {
    postMessage({ type: "processed", sequence, rejected: true, reason: "empty-block" });
    return;
  }
  if (lastSequence >= 0 && sequence !== lastSequence + 1) sequenceGaps += Math.max(0, sequence - lastSequence - 1);
  lastSequence = sequence;
  const complexSamples = Math.floor(buffer.byteLength / 2);
  const converted = convertSamples(buffer, complexSamples);
  const fftSize = Math.min(settings.fftSize, 1 << Math.floor(Math.log2(complexSamples)));
  const current = spectrumDb(converted.i, converted.q, { size: fftSize, window: settings.fftWindow, floorDb: settings.floorDb });
  const spectra = updateAveraging(current);
  processedBlocks += 1;
  const now = performance.now();
  const publishInterval = 1000 / Math.max(1, settings.displayRateHz);
  const publish = now - lastPublishedAt >= publishInterval;
  const levelDbfs = 10 * Math.log10(Math.max(1e-12, converted.power / 2));
  if (publish) {
    lastPublishedAt = now;
    const average = spectra.average.slice();
    const peak = spectra.peak?.slice() ?? null;
    const transfers = [average.buffer];
    if (peak) transfers.push(peak.buffer);
    postMessage({
      type: "processed",
      sequence,
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
      wasmMode
    }, transfers);
  } else {
    postMessage({ type: "ack", sequence, levelDbfs, workerTimeMs: performance.now() - started, sequenceGaps, processedBlocks, wasmMode });
  }
}

self.addEventListener("message", async (event) => {
  const message = event.data ?? {};
  if (message.type === "init") {
    if (message.settings) settings = { ...settings, ...message.settings };
    await initializeWasm(message.wasmUrl);
    postMessage({ type: "ready", wasmMode, settings });
  } else if (message.type === "settings") {
    settings = { ...settings, ...message.settings };
    if (message.resetAveraging) { averageSpectrum = null; peakSpectrum = null; }
    postMessage({ type: "settings-applied", settings });
  } else if (message.type === "block") {
    processBlock(message);
  } else if (message.type === "reset") {
    averageSpectrum = null;
    peakSpectrum = null;
    lastSequence = -1;
    sequenceGaps = 0;
    processedBlocks = 0;
    postMessage({ type: "reset-complete" });
  }
});
