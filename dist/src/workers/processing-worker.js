import { spectrumDb } from "../dsp/fft.js";
import { AudioDemodulator, recommendedAudioBandwidth, rms } from "../dsp/demodulators.js";
import { AdsbIqDecoder } from "../dsp/adsb.js";
import { PocsagIqDecoder } from "../dsp/pocsag.js";
import { AfskTerminalIqDecoder, AprsIqDecoder, AcarsIqDecoder, RttyIqDecoder, MorseIqDecoder } from "../dsp/digital-decoders.js";
import { SubGhzTelemetryDecoder } from "../dsp/subghz-telemetry.js";
import { Flex1600IqDecoder, TwoToneIqDecoder } from "../dsp/paging-decoders.js";
import { AisIqDecoder, Rs41IqDecoder, EpirbIqDecoder, EPIRB_IF_OFFSET_HZ } from "../dsp/tracking-decoders.js";
import { SstvIqDecoder } from "../dsp/sstv.js";

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
  decoderMode: "none",
  pocsagBaudRate: "auto",
  afskProfile: "bell202",
  afskReverse: false,
  aprsReverse: false,
  acarsChannelOffsetHz: -12000,
  rttyProfile: "eu",
  rttySideband: "usb",
  rttyReverse: false,
  morseWpm: 20,
  morsePitchHz: 700,
  morseThreshold: 0.035,
  morseChannelOffsetHz: -2000,
  timeSinkEnabled: false,
  timeSinkPoints: 512,
  telemetryMode: "none",
  pagingMode: "none",
  trackingMode: "none",
  sstvEnabled: false,
  sstvRfMode: "fm",
  sstvMode: "martin1",
  sstvAutoVis: true,
  sstvPhaseOffset: 0,
  sstvSlant: 0,
  sstvChannelOffsetHz: 0
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
const pocsagDecoder = new PocsagIqDecoder({ sampleRate: 1_024_000, baudRate: "auto" });
const digitalDecoders = {
  afsk: new AfskTerminalIqDecoder({ sampleRate: 1_024_000 }),
  aprs: new AprsIqDecoder({ sampleRate: 1_024_000 }),
  acars: new AcarsIqDecoder({ sampleRate: 1_024_000, channelOffsetHz: -12_000 }),
  rtty: new RttyIqDecoder({ sampleRate: 1_024_000 }),
  morse: new MorseIqDecoder({ sampleRate: 1_024_000 })
};
const telemetryDecoder = new SubGhzTelemetryDecoder({ sampleRate: 1_024_000, mode: "weather" });
const pagingDecoders = { flex: new Flex1600IqDecoder({ sampleRate: 1_024_000 }), twotone: new TwoToneIqDecoder({ sampleRate: 1_024_000 }) };
const trackingDecoders = {
  ais: new AisIqDecoder({ sampleRate: 1_024_000 }),
  radiosonde: new Rs41IqDecoder({ sampleRate: 1_024_000 }),
  epirb: new EpirbIqDecoder({ sampleRate: 1_024_000, offsetHz: EPIRB_IF_OFFSET_HZ })
};
const sstvDecoder = new SstvIqDecoder({ sampleRate: 1_024_000, rfMode: "fm", mode: "martin1", autoVis: true });
let lastTelemetryStatusAt = 0;
let lastPocsagStatusAt = 0;
let lastDigitalStatusAt = 0;
let lastTimeSinkAt = 0;
let lastPagingStatusAt = 0;
let lastTrackingStatusAt = 0;
let lastSstvStatusAt = 0;

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


function processTimeSink(converted, sampleRate, frequency) {
  if (!settings.timeSinkEnabled) return;
  const now = performance.now();
  if (now - lastTimeSinkAt < 80) return;
  lastTimeSinkAt = now;
  const points = Math.max(64, Math.min(2048, Math.round(Number(settings.timeSinkPoints) || 512)));
  const available = converted.i.length;
  const i = new Float32Array(points);
  const q = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const source = Math.min(available - 1, Math.floor(index * available / points));
    i[index] = converted.i[source];
    q[index] = converted.q[source];
  }
  postMessage({ type: "timeseries", i, q, sampleRate, frequency, sourceSamples: available }, [i.buffer, q.buffer]);
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
  processTimeSink(converted, sampleRate, frequency);
  if (settings.decoderMode === "adsb" && sampleRate >= 2_000_000) {
    adsbDecoder.configure({ sampleRate });
    const decodedFrames = adsbDecoder.process(converted.i, converted.q, { receivedAtMs: Date.now() });
    for (const frame of decodedFrames) postMessage({ type: "adsb", frame });
  }
  if (settings.decoderMode === "pocsag") {
    pocsagDecoder.configure({ sampleRate, baudRate: settings.pocsagBaudRate ?? "auto" });
    const decodedPages = pocsagDecoder.process(converted.i, converted.q, { receivedAtMs: Date.now() });
    for (const page of decodedPages) postMessage({ type: "pocsag", page });
    const now = performance.now();
    if (now - lastPocsagStatusAt >= 400) {
      lastPocsagStatusAt = now;
      postMessage({ type: "pocsag-status", status: pocsagDecoder.snapshot() });
    }
  }

  if (["tpms", "weather"].includes(settings.telemetryMode)) {
    telemetryDecoder.configure({ sampleRate, mode: settings.telemetryMode });
    const telemetryEvents = telemetryDecoder.process(converted.i, converted.q, { receivedAtMs: Date.now() });
    for (const event of telemetryEvents) postMessage({ type: "telemetry", mode: settings.telemetryMode, event });
    const nowTelemetry = performance.now();
    if (nowTelemetry - lastTelemetryStatusAt >= 500) {
      lastTelemetryStatusAt = nowTelemetry;
      postMessage({ type: "telemetry-status", mode: settings.telemetryMode, status: telemetryDecoder.snapshot() });
    }
  }

  if (["flex", "twotone"].includes(settings.pagingMode)) {
    const mode = settings.pagingMode;
    const decoder = pagingDecoders[mode];
    decoder.configure({ sampleRate });
    const events = decoder.process(converted.i, converted.q, { receivedAtMs: Date.now() });
    for (const event of events) postMessage({ type: "paging", mode, event });
    const nowPaging = performance.now();
    if (nowPaging - lastPagingStatusAt >= 500) {
      lastPagingStatusAt = nowPaging;
      postMessage({ type: "paging-status", mode, status: decoder.snapshot() });
    }
  }


  if (["ais", "radiosonde", "epirb"].includes(settings.trackingMode)) {
    const mode = settings.trackingMode;
    const decoder = trackingDecoders[mode];
    if (mode === "ais") decoder.configure({ sampleRate });
    else if (mode === "radiosonde") decoder.configure({ sampleRate, frequencyHz: frequency });
    else decoder.configure({ sampleRate, offsetHz: EPIRB_IF_OFFSET_HZ, frequencyHz: Number(frequency) + EPIRB_IF_OFFSET_HZ });
    const decoded = decoder.process(converted.i, converted.q, {
      receivedAtMs: Date.now(),
      frequencyHz: mode === "epirb" ? Number(frequency) + EPIRB_IF_OFFSET_HZ : frequency
    });
    for (const event of decoded) postMessage({ type: "tracking", mode, event });
    const nowTracking = performance.now();
    if (nowTracking - lastTrackingStatusAt >= 500) {
      lastTrackingStatusAt = nowTracking;
      postMessage({ type: "tracking-status", mode, status: decoder.snapshot() });
    }
  }
  if (settings.sstvEnabled) {
    // Decoder configuration is applied on init/settings messages, not once per
    // IQ block. SSTV depends on minute-scale timing continuity; resetting the
    // VIS/line state at every USB block would make a live image impossible.
    const decoded = sstvDecoder.process(converted.i, converted.q, { receivedAtMs: Date.now() });
    for (const event of decoded) {
      if (event.type === "line" && event.rgb instanceof Uint8Array) postMessage({ type: "sstv", event }, [event.rgb.buffer]);
      else postMessage({ type: "sstv", event });
    }
    const nowSstv = performance.now();
    if (nowSstv - lastSstvStatusAt >= 500) {
      lastSstvStatusAt = nowSstv;
      postMessage({ type: "sstv-status", status: sstvDecoder.snapshot() });
    }
  }

  if (["afsk", "aprs", "acars", "rtty", "morse"].includes(settings.decoderMode)) {
    const mode = settings.decoderMode;
    const decoder = digitalDecoders[mode];
    if (mode === "afsk") decoder.configure({ sampleRate, profile: settings.afskProfile ?? "bell202", reverse: Boolean(settings.afskReverse) });
    else if (mode === "aprs") decoder.configure({ sampleRate, reverse: Boolean(settings.aprsReverse) });
    else if (mode === "acars") decoder.configure({ sampleRate, channelOffsetHz: Number(settings.acarsChannelOffsetHz ?? -12000) });
    else if (mode === "rtty") decoder.configure({ sampleRate, profile: settings.rttyProfile ?? "eu", sideband: settings.rttySideband ?? "usb", reverse: Boolean(settings.rttyReverse) });
    else decoder.configure({ sampleRate, wpm: Number(settings.morseWpm ?? 20), pitchHz: Number(settings.morsePitchHz ?? settings.cwPitchHz ?? 700), threshold: Number(settings.morseThreshold ?? 0.035), channelOffsetHz: Number(settings.morseChannelOffsetHz ?? -2000) });
    const decoded = decoder.process(converted.i, converted.q, { sampleRate, channelOffsetHz: Number(settings.acarsChannelOffsetHz ?? -12000) });
    for (const event of decoded) postMessage({ type: "digital", mode, event });
    const now = performance.now();
    if (now - lastDigitalStatusAt >= 400) {
      lastDigitalStatusAt = now;
      postMessage({ type: "digital-status", mode, status: decoder.snapshot() });
    }
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
    pocsagDecoder.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, baudRate: settings.pocsagBaudRate ?? "auto" });
    digitalDecoders.afsk.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, profile: settings.afskProfile ?? "bell202", reverse: Boolean(settings.afskReverse) });
    digitalDecoders.aprs.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, reverse: Boolean(settings.aprsReverse) });
    digitalDecoders.acars.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, channelOffsetHz: Number(settings.acarsChannelOffsetHz ?? -12000) });
    digitalDecoders.rtty.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, profile: settings.rttyProfile ?? "eu", sideband: settings.rttySideband ?? "usb", reverse: Boolean(settings.rttyReverse) });
    digitalDecoders.morse.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, wpm: Number(settings.morseWpm ?? 20), pitchHz: Number(settings.morsePitchHz ?? 700), threshold: Number(settings.morseThreshold ?? 0.035), channelOffsetHz: Number(settings.morseChannelOffsetHz ?? -2000) });
    telemetryDecoder.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, mode: settings.telemetryMode === "tpms" ? "tpms" : "weather" });
    Object.values(pagingDecoders).forEach((decoder) => decoder.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000 }));
    Object.values(trackingDecoders).forEach((decoder) => decoder.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000 }));
    sstvDecoder.configure({ sampleRate: Number(settings.sampleRate) || 1_024_000, rfMode: settings.sstvRfMode ?? "fm", mode: settings.sstvMode ?? "martin1", autoVis: settings.sstvAutoVis !== false, phaseOffset: Number(settings.sstvPhaseOffset ?? 0), slant: Number(settings.sstvSlant ?? 0), channelOffsetHz: Number(settings.sstvChannelOffsetHz ?? 0) });
    await initializeWasm(message.wasmUrl);
    postMessage({ type: "ready", wasmMode, settings, sharedMemory: Boolean(sharedPool) });
  } else if (message.type === "settings") {
    settings = { ...settings, ...message.settings };
    audioDemodulator.configure(settings);
    adsbDecoder.configure({ sampleRate: Number(settings.sampleRate) || adsbDecoder.sampleRate });
    pocsagDecoder.configure({ sampleRate: Number(settings.sampleRate) || pocsagDecoder.sampleRate, baudRate: settings.pocsagBaudRate ?? pocsagDecoder.baudRate });
    sstvDecoder.configure({
      sampleRate: Number(settings.sampleRate) || 1_024_000,
      rfMode: settings.sstvRfMode ?? "fm",
      mode: settings.sstvMode ?? "martin1",
      autoVis: settings.sstvAutoVis !== false,
      phaseOffset: Number(settings.sstvPhaseOffset ?? 0),
      slant: Number(settings.sstvSlant ?? 0),
      channelOffsetHz: Number(settings.sstvChannelOffsetHz ?? 0)
    });
    if (message.resetDecoder) { pocsagDecoder.reset(); Object.values(digitalDecoders).forEach((decoder) => decoder.reset()); telemetryDecoder.reset(); Object.values(pagingDecoders).forEach((decoder) => decoder.reset()); Object.values(trackingDecoders).forEach((decoder) => decoder.reset()); sstvDecoder.reset(); }
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
    pocsagDecoder.reset();
    Object.values(digitalDecoders).forEach((decoder) => decoder.reset());
    telemetryDecoder.reset();
    Object.values(pagingDecoders).forEach((decoder) => decoder.reset());
    Object.values(trackingDecoders).forEach((decoder) => decoder.reset());
    sstvDecoder.reset();
    lastTelemetryStatusAt = 0;
    lastPagingStatusAt = 0;
    lastTrackingStatusAt = 0;
    lastSstvStatusAt = 0;
    lastPocsagStatusAt = 0;
    lastTimeSinkAt = 0;
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
    lastDigitalStatusAt = 0;
    postMessage({ type: "reset-complete" });
  }
});
