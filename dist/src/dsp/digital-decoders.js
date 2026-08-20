/*
 * MAYHEM RTL digital-audio receive decoders.
 *
 * Shared receive-only DSP for v0.8.5:
 *   AFSK terminal -> asynchronous serial characters
 *   APRS -> Bell 202 AFSK -> NRZI -> HDLC -> AX.25/APRS
 *   ACARS -> AM audio -> 1200/2400 Hz MSK tone decisions -> ARINC 618 framing
 *   RTTY -> SSB audio -> dual-tone decisions -> ITA2/Baudot
 *   Morse -> CW audio envelope -> dot/dash timing -> text
 *
 * The browser worker feeds these classes the same continuous IQ blocks used by
 * spectrum/capture. No decoder depends on the speaker AudioWorklet.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import { AudioDemodulator } from "./demodulators.js";

const TWO_PI = Math.PI * 2;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

export const DIGITAL_DECODER_MODES = Object.freeze(["afsk", "aprs", "acars", "rtty", "morse"]);
export const MORSE_IF_OFFSET_HZ = 2_000;

export const AFSK_MODEM_PRESETS = Object.freeze({
  bell202: Object.freeze({ id: "bell202", name: "Bell 202", markHz: 1200, spaceHz: 2200, baud: 1200, dataBits: 7, parity: "even", stopBits: 1 }),
  bell103: Object.freeze({ id: "bell103", name: "Bell 103", markHz: 1270, spaceHz: 1070, baud: 300, dataBits: 7, parity: "even", stopBits: 1 }),
  v21: Object.freeze({ id: "v21", name: "V.21", markHz: 980, spaceHz: 1180, baud: 300, dataBits: 7, parity: "even", stopBits: 1 }),
  v23m1: Object.freeze({ id: "v23m1", name: "V.23 Mode 1", markHz: 1300, spaceHz: 1700, baud: 600, dataBits: 7, parity: "even", stopBits: 1 }),
  v23m2: Object.freeze({ id: "v23m2", name: "V.23 Mode 2", markHz: 1300, spaceHz: 2100, baud: 1200, dataBits: 7, parity: "even", stopBits: 1 })
});

export const RTTY_PRESETS = Object.freeze({
  eu: Object.freeze({ id: "eu", name: "RTTY EU 170 Hz", markHz: 2125, spaceHz: 1955, baud: 45.45 }),
  us: Object.freeze({ id: "us", name: "RTTY US 170 Hz", markHz: 2295, spaceHz: 2125, baud: 45.45 })
});

export function reverseBits(value, bits) {
  let out = 0;
  for (let index = 0; index < bits; index += 1) out = (out << 1) | ((value >> index) & 1);
  return out >>> 0;
}

export function crc16Ax25(bytes) {
  let crc = 0xffff;
  for (const byte of bytes ?? []) {
    crc ^= Number(byte) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? ((crc >>> 1) ^ 0x8408) : (crc >>> 1);
  }
  return (crc ^ 0xffff) & 0xffff;
}

export function crc16Xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes ?? []) {
    crc ^= (Number(byte) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
  }
  return crc & 0xffff;
}

function popcount8(value) {
  let v = value & 0xff;
  v = v - ((v >>> 1) & 0x55);
  v = (v & 0x33) + ((v >>> 2) & 0x33);
  return (((v + (v >>> 4)) & 0x0f) * 0x01) & 0xff;
}

export function acarsParityOk(byte) { return (popcount8(byte) & 1) === 1; }
export function acarsAddParity(byte) {
  const data = byte & 0x7f;
  return acarsParityOk(data) ? data : (data | 0x80);
}

class ToneLane {
  constructor(offsetSamples = 0) { this.initialDelay = offsetSamples; this.reset(); }
  reset() {
    this.delay = this.initialDelay;
    this.symbolPhase = 0;
    this.markRe = this.markIm = this.spaceRe = this.spaceIm = 0;
    this.energy = 0;
  }
}

export class TonePairBitDemodulator {
  constructor({ sampleRate = 48_000, markHz = 1200, spaceHz = 2200, baud = 1200, lanes = 8, reverse = false } = {}) {
    this.onBit = null;
    this.configure({ sampleRate, markHz, spaceHz, baud, lanes, reverse });
  }

  configure(options = {}) {
    const next = {
      sampleRate: Number(options.sampleRate ?? this.sampleRate ?? 48_000),
      markHz: Number(options.markHz ?? this.markHz ?? 1200),
      spaceHz: Number(options.spaceHz ?? this.spaceHz ?? 2200),
      baud: Number(options.baud ?? this.baud ?? 1200),
      lanes: Math.max(1, Math.min(16, Math.round(Number(options.lanes ?? this.laneCount ?? 8)))),
      reverse: Boolean(options.reverse ?? this.reverse ?? false)
    };
    const key = `${next.sampleRate}:${next.markHz}:${next.spaceHz}:${next.baud}:${next.lanes}:${next.reverse}`;
    if (key === this.key) return;
    this.sampleRate = next.sampleRate;
    this.markHz = next.markHz;
    this.spaceHz = next.spaceHz;
    this.baud = next.baud;
    this.laneCount = next.lanes;
    this.reverse = next.reverse;
    this.samplesPerBit = this.sampleRate / this.baud;
    this.markIncrement = TWO_PI * this.markHz / this.sampleRate;
    this.spaceIncrement = TWO_PI * this.spaceHz / this.sampleRate;
    this.key = key;
    this.reset();
  }

  reset() {
    this.sampleIndex = 0;
    this.bits = 0;
    this.lanes = [];
    for (let lane = 0; lane < this.laneCount; lane += 1) {
      const offset = Math.round((lane / this.laneCount) * this.samplesPerBit);
      this.lanes.push(new ToneLane(offset));
    }
  }

  process(samples) {
    if (!samples?.length) return;
    for (let index = 0; index < samples.length; index += 1, this.sampleIndex += 1) {
      const sample = Number(samples[index]) || 0;
      const markPhase = this.markIncrement * this.sampleIndex;
      const spacePhase = this.spaceIncrement * this.sampleIndex;
      const markCos = Math.cos(markPhase), markSin = Math.sin(markPhase);
      const spaceCos = Math.cos(spacePhase), spaceSin = Math.sin(spacePhase);
      for (let laneIndex = 0; laneIndex < this.lanes.length; laneIndex += 1) {
        const lane = this.lanes[laneIndex];
        if (lane.delay > 0) { lane.delay -= 1; continue; }
        lane.markRe += sample * markCos;
        lane.markIm -= sample * markSin;
        lane.spaceRe += sample * spaceCos;
        lane.spaceIm -= sample * spaceSin;
        lane.energy += sample * sample;
        lane.symbolPhase += 1;
        if (lane.symbolPhase + 1e-9 < this.samplesPerBit) continue;
        lane.symbolPhase -= this.samplesPerBit;
        const markEnergy = lane.markRe * lane.markRe + lane.markIm * lane.markIm;
        const spaceEnergy = lane.spaceRe * lane.spaceRe + lane.spaceIm * lane.spaceIm;
        const total = Math.max(1e-12, markEnergy + spaceEnergy);
        let bit = markEnergy >= spaceEnergy ? 1 : 0;
        if (this.reverse) bit ^= 1;
        const confidence = Math.abs(markEnergy - spaceEnergy) / total;
        this.bits += 1;
        this.onBit?.({ lane: laneIndex, bit, confidence, markEnergy, spaceEnergy });
        lane.markRe = lane.markIm = lane.spaceRe = lane.spaceIm = 0;
        lane.energy = 0;
      }
    }
  }
}

export class AsyncSerialFramer {
  constructor({ dataBits = 7, parity = "even", stopBits = 1, bitOrder = "lsb" } = {}) {
    this.onWord = null;
    this.configure({ dataBits, parity, stopBits, bitOrder });
  }
  configure(options = {}) {
    this.dataBits = clamp(Math.round(Number(options.dataBits ?? this.dataBits ?? 7)), 5, 8);
    this.parity = ["none", "even", "odd"].includes(options.parity ?? this.parity) ? (options.parity ?? this.parity) : "none";
    this.stopBits = clamp(Math.round(Number(options.stopBits ?? this.stopBits ?? 1)), 1, 2);
    this.bitOrder = (options.bitOrder ?? this.bitOrder) === "msb" ? "msb" : "lsb";
    this.reset();
  }
  reset() { this.state = "wait"; this.value = 0; this.bitIndex = 0; this.ones = 0; this.parityOk = true; this.stopCount = 0; this.frames = 0; this.framingErrors = 0; this.parityErrors = 0; }
  feed(bit) {
    bit = bit ? 1 : 0;
    if (this.state === "wait") {
      if (bit === 0) { this.state = "data"; this.value = 0; this.bitIndex = 0; this.ones = 0; }
      return;
    }
    if (this.state === "data") {
      if (this.bitOrder === "lsb") this.value |= bit << this.bitIndex;
      else this.value = (this.value << 1) | bit;
      this.ones += bit;
      this.bitIndex += 1;
      if (this.bitIndex >= this.dataBits) this.state = this.parity === "none" ? "stop" : "parity";
      return;
    }
    if (this.state === "parity") {
      const totalOdd = ((this.ones + bit) & 1) === 1;
      this.parityOk = this.parity === "odd" ? totalOdd : !totalOdd;
      if (!this.parityOk) this.parityErrors += 1;
      this.state = "stop";
      return;
    }
    if (this.state === "stop") {
      if (bit !== 1) { this.framingErrors += 1; this.state = "wait"; return; }
      this.stopCount += 1;
      if (this.stopCount >= this.stopBits) {
        this.frames += 1;
        this.onWord?.({ value: this.value & ((1 << this.dataBits) - 1), parityOk: this.parityOk, framingOk: true });
        this.state = "wait"; this.stopCount = 0; this.parityOk = true;
      }
    }
  }
}

function printableByte(value) { return value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126); }
function displayByte(value) { return printableByte(value) ? String.fromCharCode(value) : `[${value.toString(16).padStart(2, "0").toUpperCase()}]`; }

class LaneTextSelector {
  constructor(lanes, onText) { this.lanes = Array.from({ length: lanes }, () => ({ streak: 0, pending: "", score: 0 })); this.activeLane = null; this.onText = onText; }
  reset() { for (const lane of this.lanes) { lane.streak = 0; lane.pending = ""; lane.score = 0; } this.activeLane = null; }
  feed(laneIndex, value, valid = true) {
    const lane = this.lanes[laneIndex];
    const text = displayByte(value);
    const printable = printableByte(value);
    if (this.activeLane === laneIndex) { if (valid) this.onText?.(text, value); return; }
    if (this.activeLane != null) return;
    if (valid && printable) { lane.streak += 1; lane.score += 2; lane.pending += text; }
    else { lane.streak = 0; lane.score -= 2; lane.pending = ""; }
    if (lane.streak >= 3 && lane.score >= 6) {
      this.activeLane = laneIndex;
      if (lane.pending) this.onText?.(lane.pending, null);
      lane.pending = "";
    }
  }
}

class FrequencyShifter {
  constructor() { this.phase = 0; }
  reset() { this.phase = 0; }
  process(i, q, offsetHz, sampleRate) {
    if (!offsetHz) return { i, q };
    const oi = new Float32Array(i.length), oq = new Float32Array(q.length);
    const inc = -TWO_PI * Number(offsetHz) / Number(sampleRate);
    for (let n = 0; n < i.length; n += 1) {
      const c = Math.cos(this.phase), s = Math.sin(this.phase);
      oi[n] = i[n] * c - q[n] * s;
      oq[n] = i[n] * s + q[n] * c;
      this.phase += inc;
      if (this.phase > Math.PI) this.phase -= TWO_PI;
      else if (this.phase < -Math.PI) this.phase += TWO_PI;
    }
    return { i: oi, q: oq };
  }
}

export class AfskTerminalIqDecoder {
  constructor(options = {}) {
    this.audio = new AudioDemodulator();
    this.events = [];
    this.configure(options);
  }
  configure(options = {}) {
    const preset = AFSK_MODEM_PRESETS[options.profile ?? this.profile] ?? AFSK_MODEM_PRESETS.bell202;
    const key = `${preset.id}:${options.reverse ?? this.reverse ?? false}`;
    if (key === this.key && Number(options.sampleRate ?? this.sampleRate) === this.sampleRate) return;
    this.profile = preset.id; this.preset = preset; this.reverse = Boolean(options.reverse ?? this.reverse ?? false); this.sampleRate = Number(options.sampleRate ?? this.sampleRate ?? 1_024_000);
    this.key = key; this.reset();
  }
  reset() {
    this.audio.reset();
    this.demod = new TonePairBitDemodulator({ sampleRate: 48_000, markHz: this.preset.markHz, spaceHz: this.preset.spaceHz, baud: this.preset.baud, lanes: 8, reverse: this.reverse });
    this.framers = Array.from({ length: 8 }, () => new AsyncSerialFramer({ dataBits: this.preset.dataBits, parity: this.preset.parity, stopBits: this.preset.stopBits, bitOrder: "lsb" }));
    this.text = ""; this.characters = 0; this.events = []; this.selector = new LaneTextSelector(8, (text) => { this.text = (this.text + text).slice(-8000); this.characters += text.length; this.events.push({ type: "text", text, receivedAt: Date.now() }); });
    for (let lane = 0; lane < this.framers.length; lane += 1) this.framers[lane].onWord = ({ value, parityOk }) => this.selector.feed(lane, value, parityOk);
    this.demod.onBit = ({ lane, bit }) => this.framers[lane].feed(bit);
  }
  process(i, q, { sampleRate = this.sampleRate } = {}) {
    if (sampleRate !== this.sampleRate) { this.sampleRate = sampleRate; this.reset(); }
    this.audio.configure({ mode: "nfm", outputRate: 48_000, audioBandwidthHz: 5000, deemphasisUs: 75, agcMode: "off" });
    const samples = this.audio.process(i, q, sampleRate); this.demod.process(samples);
    const events = this.events.splice(0); return events;
  }
  snapshot() { return { mode: "afsk", profile: this.profile, characters: this.characters, activeLane: this.selector.activeLane, text: this.text.slice(-512), bitRate: this.preset.baud, markHz: this.preset.markHz, spaceHz: this.preset.spaceHz }; }
}

function ax25Address(bytes, offset) {
  if (offset + 7 > bytes.length) return null;
  let call = "";
  for (let i = 0; i < 6; i += 1) call += String.fromCharCode((bytes[offset + i] >>> 1) & 0x7f);
  call = call.trim();
  const ssidByte = bytes[offset + 6];
  const ssid = (ssidByte >>> 1) & 0x0f;
  return { text: ssid ? `${call}-${ssid}` : call, last: Boolean(ssidByte & 1), repeated: Boolean(ssidByte & 0x80) };
}

export function parseAprsFrame(frame) {
  const bytes = Array.from(frame ?? [], Number);
  if (bytes.length < 18) return null;
  const receivedFcs = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
  const computedFcs = crc16Ax25(bytes.slice(0, -2));
  const crcOk = receivedFcs === computedFcs;
  const addresses = [];
  let cursor = 0;
  while (cursor + 7 <= bytes.length - 4 && addresses.length < 10) {
    const address = ax25Address(bytes, cursor); if (!address) break;
    addresses.push(address); cursor += 7; if (address.last) break;
  }
  if (addresses.length < 2 || cursor + 2 > bytes.length - 2) return { crcOk, receivedFcs, computedFcs, raw: bytes };
  const control = bytes[cursor++], pid = bytes[cursor++];
  const infoBytes = bytes.slice(cursor, -2);
  const info = String.fromCharCode(...infoBytes.map((value) => (value >= 32 && value <= 126) || value === 13 || value === 10 ? value : 46));
  const result = { crcOk, receivedFcs, computedFcs, destination: addresses[0].text, source: addresses[1].text, path: addresses.slice(2).map((entry) => entry.text), control, pid, info, raw: bytes };
  const ident = info[0];
  if ((ident === "!" || ident === "=") && info.length >= 20) {
    const lat = info.slice(1, 9), lon = info.slice(10, 19);
    const latDeg = Number(lat.slice(0, 2)), latMin = Number(lat.slice(2, 7));
    const lonDeg = Number(lon.slice(0, 3)), lonMin = Number(lon.slice(3, 8));
    if ([latDeg, latMin, lonDeg, lonMin].every(Number.isFinite)) {
      result.latitude = (latDeg + latMin / 60) * (lat[7] === "S" ? -1 : 1);
      result.longitude = (lonDeg + lonMin / 60) * (lon[8] === "W" ? -1 : 1);
      result.symbolTable = info[9]; result.symbol = info[19];
    }
  }
  return result;
}

class HdlcLane {
  constructor(onFrame) { this.onFrame = onFrame; this.reset(); }
  reset() { this.prevTone = null; this.recent = []; this.segment = []; this.inFrame = false; }
  feedTone(tone) {
    if (this.prevTone == null) { this.prevTone = tone; return; }
    const bit = tone === this.prevTone ? 1 : 0; this.prevTone = tone;
    this.segment.push(bit); this.recent.push(bit); if (this.recent.length > 8) this.recent.shift();
    if (this.recent.length === 8 && this.recent[0] === 0 && this.recent.slice(1, 7).every((v) => v === 1) && this.recent[7] === 0) {
      if (this.inFrame && this.segment.length > 16) this.#emit(this.segment.slice(0, -8));
      this.inFrame = true; this.segment = []; this.recent = [];
    } else if (this.segment.length > 8192) { this.segment = []; this.recent = []; this.inFrame = false; }
  }
  #emit(rawBits) {
    const bits = []; let ones = 0;
    for (const bit of rawBits) {
      if (bit === 1) { ones += 1; bits.push(1); if (ones >= 6) return; }
      else { if (ones === 5) { ones = 0; continue; } ones = 0; bits.push(0); }
    }
    if (bits.length < 16 || bits.length % 8 !== 0) return;
    const bytes = [];
    for (let index = 0; index < bits.length; index += 8) {
      let value = 0; for (let bit = 0; bit < 8; bit += 1) value |= bits[index + bit] << bit; bytes.push(value);
    }
    this.onFrame?.(bytes);
  }
}

export class AprsIqDecoder {
  constructor(options = {}) { this.audio = new AudioDemodulator(); this.configure(options); }
  configure(options = {}) { const sr = Number(options.sampleRate ?? this.sampleRate ?? 1_024_000); const reverse = Boolean(options.reverse ?? this.reverse ?? false); if (sr === this.sampleRate && reverse === this.reverse && this.demod) return; this.sampleRate = sr; this.reverse = reverse; this.reset(); }
  reset() {
    this.audio.reset(); this.events = []; this.frames = 0; this.badCrc = 0; this.seen = new Map();
    this.demod = new TonePairBitDemodulator({ sampleRate: 48_000, markHz: 1200, spaceHz: 2200, baud: 1200, lanes: 8, reverse: this.reverse });
    this.lanes = Array.from({ length: 8 }, (_, lane) => new HdlcLane((bytes) => this.#handleFrame(lane, bytes)));
    this.demod.onBit = ({ lane, bit }) => this.lanes[lane].feedTone(bit);
  }
  #handleFrame(lane, bytes) {
    const parsed = parseAprsFrame(bytes); if (!parsed) return;
    if (!parsed.crcOk) { this.badCrc += 1; return; }
    const key = `${parsed.source}>${parsed.destination}:${parsed.info}`; const now = Date.now();
    if ((this.seen.get(key) ?? 0) > now - 800) return; this.seen.set(key, now);
    this.frames += 1; this.events.push({ type: "frame", lane, ...parsed, receivedAt: now });
  }
  process(i, q, { sampleRate = this.sampleRate } = {}) { if (sampleRate !== this.sampleRate) { this.sampleRate = sampleRate; this.reset(); } this.audio.configure({ mode: "nfm", outputRate: 48_000, audioBandwidthHz: 5000, agcMode: "off" }); const samples = this.audio.process(i, q, sampleRate); this.demod.process(samples); return this.events.splice(0); }
  snapshot() { return { mode: "aprs", frames: this.frames, badCrc: this.badCrc, bitRate: 1200, markHz: 1200, spaceHz: 2200 }; }
}

const ACARS_SYN = 0x16, ACARS_SOH = 0x01, ACARS_ETX = 0x83, ACARS_ETB = 0x97, ACARS_DEL = 0x7f;

export function parseAcarsBlock(message, crcHigh, crcLow, parityErrors = 0) {
  const bytes = Array.from(message ?? [], Number);
  const receivedCrc = ((crcHigh & 0xff) << 8) | (crcLow & 0xff);
  const computedCrc = crc16Xmodem(bytes);
  const display = bytes.map((value) => value & 0x7f);
  const str = (start, length) => String.fromCharCode(...display.slice(start, start + length)).trim();
  return {
    crcOk: computedCrc === receivedCrc,
    computedCrc, receivedCrc, parityErrors,
    mode: str(0, 1), registration: str(1, 7), label: str(9, 2), blockId: str(11, 1), messageNumber: str(12, 3), flightId: str(15, 6),
    text: String.fromCharCode(...display.slice(21, Math.max(21, display.length - 1))).replace(/[\x00-\x1f\x7f]/g, " ").trim(),
    raw: bytes
  };
}

class AcarsBitLane {
  constructor(onBlock) { this.onBlock = onBlock; this.reset(); }
  reset() { this.state = "wait"; this.window = []; this.bitCount = 0; this.byte = 0; this.message = []; this.crcHigh = 0; this.crcLow = 0; this.parityErrors = 0; }
  feed(bit) {
    bit = bit ? 1 : 0;
    if (this.state === "wait") {
      this.window.push(bit); if (this.window.length > 8) this.window.shift();
      if (this.window.length === 8) { let value = 0; for (let b = 0; b < 8; b += 1) value |= this.window[b] << b; if (value === ACARS_SYN) { this.state = "syn2"; this.window = []; this.bitCount = 0; this.byte = 0; } }
      return;
    }
    this.byte |= bit << this.bitCount; this.bitCount += 1; if (this.bitCount < 8) return;
    const ch = this.byte & 0xff; this.byte = 0; this.bitCount = 0;
    if (this.state === "syn2") { if (ch === ACARS_SYN) this.state = "soh"; else { this.state = "wait"; this.window = []; } return; }
    if (this.state === "soh") { if (ch === ACARS_SOH) { this.state = "text"; this.message = []; this.parityErrors = 0; } else { this.state = "wait"; this.window = []; } return; }
    if (this.state === "text") {
      if (!acarsParityOk(ch)) this.parityErrors += 1;
      this.message.push(ch);
      if (ch === ACARS_ETX || ch === ACARS_ETB) this.state = "crc1";
      if (this.message.length > 240 || this.parityErrors > 8) { this.state = "wait"; this.window = []; }
      return;
    }
    if (this.state === "crc1") { this.crcHigh = ch; this.state = "crc2"; return; }
    if (this.state === "crc2") { this.crcLow = ch; this.state = "end"; return; }
    if (this.state === "end") {
      if (ch === ACARS_DEL) this.onBlock?.({ message: this.message.slice(), crcHigh: this.crcHigh, crcLow: this.crcLow, parityErrors: this.parityErrors });
      this.state = "wait"; this.window = [];
    }
  }
}

export class AcarsIqDecoder {
  constructor(options = {}) { this.audio = new AudioDemodulator(); this.shifter = new FrequencyShifter(); this.configure(options); }
  configure(options = {}) {
    const sampleRate = Number(options.sampleRate ?? this.sampleRate ?? 1_024_000); const channelOffsetHz = Number(options.channelOffsetHz ?? this.channelOffsetHz ?? -12_000);
    if (sampleRate === this.sampleRate && channelOffsetHz === this.channelOffsetHz && this.demod) return;
    this.sampleRate = sampleRate; this.channelOffsetHz = channelOffsetHz; this.reset();
  }
  reset() {
    this.audio.reset(); this.shifter.reset(); this.events = []; this.frames = 0; this.badCrc = 0; this.seen = new Map();
    this.demod = new TonePairBitDemodulator({ sampleRate: 48_000, markHz: 2400, spaceHz: 1200, baud: 2400, lanes: 8 });
    this.lanes = Array.from({ length: 8 }, (_, lane) => new AcarsBitLane((block) => this.#handle(lane, block)));
    this.demod.onBit = ({ lane, bit }) => this.lanes[lane].feed(bit);
  }
  #handle(lane, block) {
    const parsed = parseAcarsBlock(block.message, block.crcHigh, block.crcLow, block.parityErrors);
    if (!parsed.crcOk) { this.badCrc += 1; return; }
    const key = `${parsed.registration}:${parsed.label}:${parsed.blockId}:${parsed.messageNumber}:${parsed.text}`; const now = Date.now();
    if ((this.seen.get(key) ?? 0) > now - 1200) return; this.seen.set(key, now);
    this.frames += 1; this.events.push({ type: "frame", lane, ...parsed, receivedAt: now });
  }
  process(i, q, { sampleRate = this.sampleRate, channelOffsetHz = this.channelOffsetHz } = {}) {
    if (sampleRate !== this.sampleRate || channelOffsetHz !== this.channelOffsetHz) { this.sampleRate = sampleRate; this.channelOffsetHz = channelOffsetHz; this.reset(); }
    const shifted = this.shifter.process(i, q, channelOffsetHz, sampleRate);
    this.audio.configure({ mode: "am", outputRate: 48_000, audioBandwidthHz: 5000, agcMode: "off" });
    const samples = this.audio.process(shifted.i, shifted.q, sampleRate); this.demod.process(samples); return this.events.splice(0);
  }
  snapshot() { return { mode: "acars", frames: this.frames, badCrc: this.badCrc, bitRate: 2400, markHz: 2400, spaceHz: 1200, channelOffsetHz: this.channelOffsetHz }; }
}

const ITA2_LETTERS = Object.freeze(["", "E", "\n", "A", " ", "S", "I", "U", "\r", "D", "R", "J", "N", "F", "C", "K", "T", "Z", "L", "W", "H", "Y", "P", "Q", "O", "B", "G", "", "M", "X", "V", ""]);
const ITA2_FIGURES = Object.freeze(["", "3", "\n", "-", " ", "'", "8", "7", "\r", "$", "4", "\u0007", ",", "!", ":", "(", "5", '"', ")", "2", "#", "6", "0", "1", "9", "?", "&", "", ".", "/", ";", ""]);
export function ita2Decode(code, figures = false) { const table = figures ? ITA2_FIGURES : ITA2_LETTERS; return table[code & 0x1f] ?? ""; }

export class RttyIqDecoder {
  constructor(options = {}) { this.audio = new AudioDemodulator(); this.configure(options); }
  configure(options = {}) {
    const preset = RTTY_PRESETS[options.profile ?? this.profile] ?? RTTY_PRESETS.eu;
    const sideband = options.sideband === "lsb" ? "lsb" : (this.sideband === "lsb" ? "lsb" : "usb");
    const reverse = Boolean(options.reverse ?? this.reverse ?? false); const sampleRate = Number(options.sampleRate ?? this.sampleRate ?? 1_024_000);
    const key = `${preset.id}:${sideband}:${reverse}:${sampleRate}`; if (key === this.key && this.demod) return;
    this.preset = preset; this.profile = preset.id; this.sideband = sideband; this.reverse = reverse; this.sampleRate = sampleRate; this.key = key; this.reset();
  }
  reset() {
    this.audio.reset(); this.events = []; this.text = ""; this.characters = 0;
    this.demod = new TonePairBitDemodulator({ sampleRate: 12_000, markHz: this.preset.markHz, spaceHz: this.preset.spaceHz, baud: this.preset.baud, lanes: 8, reverse: this.reverse });
    this.framers = Array.from({ length: 8 }, () => new AsyncSerialFramer({ dataBits: 5, parity: "none", stopBits: 1, bitOrder: "lsb" }));
    this.shifts = Array(8).fill(false);
    this.selector = new LaneTextSelector(8, (text) => { this.text = (this.text + text).slice(-8000); this.characters += text.length; this.events.push({ type: "text", text, receivedAt: Date.now() }); });
    for (let lane = 0; lane < 8; lane += 1) this.framers[lane].onWord = ({ value }) => {
      if (value === 27) { this.shifts[lane] = true; return; } if (value === 31) { this.shifts[lane] = false; return; }
      const char = ita2Decode(value, this.shifts[lane]); if (char) this.selector.feed(lane, char.charCodeAt(0), true);
    };
    this.demod.onBit = ({ lane, bit }) => this.framers[lane].feed(bit);
  }
  process(i, q, { sampleRate = this.sampleRate } = {}) { if (sampleRate !== this.sampleRate) { this.sampleRate = sampleRate; this.reset(); } this.audio.configure({ mode: this.sideband, outputRate: 12_000, audioBandwidthHz: 3000, ssbLowCutHz: 100, agcMode: "medium" }); const samples = this.audio.process(i, q, sampleRate); this.demod.process(samples); return this.events.splice(0); }
  snapshot() { return { mode: "rtty", profile: this.profile, sideband: this.sideband, characters: this.characters, activeLane: this.selector.activeLane, text: this.text.slice(-512), baud: this.preset.baud, markHz: this.preset.markHz, spaceHz: this.preset.spaceHz }; }
}

export const MORSE_TABLE = Object.freeze({
  ".-":"A","-...":"B","-.-.":"C","-..":"D",".":"E","..-.":"F","--.":"G","....":"H","..":"I",".---":"J","-.-":"K",".-..":"L","--":"M","-.":"N","---":"O",".--.":"P","--.-":"Q",".-.":"R","...":"S","-":"T","..-":"U","...-":"V",".--":"W","-..-":"X","-.--":"Y","--..":"Z",
  "-----":"0",".----":"1","..---":"2","...--":"3","....-":"4",".....":"5","-....":"6","--...":"7","---..":"8","----.":"9",
  ".-.-.-":".","--..--":",","..--..":"?","-..-.":"/","-....-":"-","-.--.":"(","-.--.-":")"
});

export class MorseTimingDecoder {
  constructor({ sampleRate = 12_000, wpm = 20, threshold = 0.035 } = {}) { this.configure({ sampleRate, wpm, threshold }); }
  configure(options = {}) { this.sampleRate = Number(options.sampleRate ?? this.sampleRate ?? 12_000); this.wpm = clamp(Number(options.wpm ?? this.wpm ?? 20), 5, 60); this.threshold = clamp(Number(options.threshold ?? this.threshold ?? 0.035), 0.002, 0.8); this.unit = this.sampleRate * 1.2 / this.wpm; }
  reset() { this.key = false; this.markSamples = 0; this.gapSamples = this.unit * 8; this.symbol = ""; this.text = ""; this.charFinalized = true; this.wordAdded = false; this.events = []; }
  feedEnvelope(envelope) {
    const high = this.threshold, low = this.threshold * 0.65; const nextKey = this.key ? envelope >= low : envelope >= high;
    if (nextKey === this.key) {
      if (this.key) this.markSamples += 1; else { this.gapSamples += 1; this.#maybeFinalizeGap(); }
      return;
    }
    if (this.key && !nextKey) {
      const duration = this.markSamples; if (duration > this.unit * 0.25) this.symbol += duration < this.unit * 2.2 ? "." : "-";
      this.markSamples = 0; this.gapSamples = 0; this.charFinalized = false; this.wordAdded = false;
    } else if (!this.key && nextKey) {
      this.#maybeFinalizeGap(true); this.markSamples = 1; this.gapSamples = 0;
    }
    this.key = nextKey;
  }
  #maybeFinalizeGap(force = false) {
    if (!this.charFinalized && (force ? this.gapSamples >= this.unit * 2.2 : this.gapSamples >= this.unit * 3.0)) {
      const decoded = MORSE_TABLE[this.symbol] ?? (this.symbol ? "·" : "");
      if (decoded) { this.text = (this.text + decoded).slice(-8000); this.events.push({ type: "text", text: decoded, symbol: this.symbol, receivedAt: Date.now() }); }
      this.symbol = ""; this.charFinalized = true;
    }
    if (this.charFinalized && !this.wordAdded && this.text && this.gapSamples >= this.unit * 6.5) {
      if (!this.text.endsWith(" ")) { this.text += " "; this.events.push({ type: "text", text: " ", receivedAt: Date.now() }); }
      this.wordAdded = true;
    }
  }
}

export class MorseIqDecoder {
  constructor(options = {}) { this.audio = new AudioDemodulator(); this.configure(options); }
  configure(options = {}) {
    const sampleRate = Number(options.sampleRate ?? this.sampleRate ?? 1_024_000), pitchHz = clamp(Number(options.pitchHz ?? this.pitchHz ?? 700), 300, 1200), wpm = clamp(Number(options.wpm ?? this.wpm ?? 20), 5, 60), threshold = clamp(Number(options.threshold ?? this.threshold ?? 0.035), 0.002, 0.8), channelOffsetHz = Number(options.channelOffsetHz ?? this.channelOffsetHz ?? -MORSE_IF_OFFSET_HZ);
    const key = `${sampleRate}:${pitchHz}:${wpm}:${threshold}:${channelOffsetHz}`; if (key === this.key && this.timing) return;
    this.sampleRate = sampleRate; this.pitchHz = pitchHz; this.wpm = wpm; this.threshold = threshold; this.channelOffsetHz = channelOffsetHz; this.key = key; this.reset();
  }
  reset() { this.audio.reset(); this.timing = new MorseTimingDecoder({ sampleRate: 12_000, wpm: this.wpm, threshold: this.threshold }); this.timing.reset(); this.env = 0; this.sampleCounter = 0; }
  process(i, q, { sampleRate = this.sampleRate } = {}) {
    if (sampleRate !== this.sampleRate) { this.sampleRate = sampleRate; this.reset(); }
    this.audio.configure({ mode: "cw", outputRate: 12_000, audioBandwidthHz: 500, ritHz: this.channelOffsetHz, cwPitchHz: this.pitchHz, agcMode: "off" });
    const samples = this.audio.process(i, q, sampleRate); const alpha = 1 - Math.exp(-TWO_PI * 55 / 12_000);
    for (let n = 0; n < samples.length; n += 1) { this.env += alpha * (Math.abs(samples[n]) - this.env); this.timing.feedEnvelope(this.env); this.sampleCounter += 1; }
    return this.timing.events.splice(0);
  }
  snapshot() { return { mode: "morse", text: this.timing.text.slice(-512), currentSymbol: this.timing.symbol, wpm: this.wpm, pitchHz: this.pitchHz, threshold: this.threshold, channelOffsetHz: this.channelOffsetHz, keyDown: this.timing.key, envelope: this.env }; }
}

/* -------------------------------------------------------------------------
 * Deterministic IQ fixture generators used by Simulation Mode and tests.
 * ---------------------------------------------------------------------- */

function renderToneBits(bits, { markHz, spaceHz, baud, sampleRate = 48_000, amplitude = 0.72, trailingBits = 4 } = {}) {
  const totalBits = bits.length + trailingBits; const totalSamples = Math.ceil(totalBits * sampleRate / baud); const audio = new Float32Array(totalSamples); let phase = 0; let bitIndex = 0;
  for (let sample = 0; sample < totalSamples; sample += 1) {
    bitIndex = Math.min(bits.length - 1, Math.floor(sample * baud / sampleRate)); const bit = sample * baud / sampleRate >= bits.length ? 1 : bits[Math.max(0, bitIndex)]; const frequency = bit ? markHz : spaceHz;
    audio[sample] = amplitude * Math.sin(phase); phase += TWO_PI * frequency / sampleRate; if (phase > TWO_PI) phase -= TWO_PI;
  }
  return audio;
}

function resampleNearest(samples, inputRate, outputRate) {
  if (inputRate === outputRate) return samples; const length = Math.max(1, Math.round(samples.length * outputRate / inputRate)); const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = samples[Math.min(samples.length - 1, Math.floor(i * inputRate / outputRate))]; return out;
}

function nfmIqFromAudio(audio, { audioRate = 48_000, sampleRate = 1_024_000, deviationHz = 5000, amplitude = 0.82 } = {}) {
  const base = resampleNearest(audio, audioRate, sampleRate); const i = new Float32Array(base.length), q = new Float32Array(base.length); let phase = 0;
  for (let n = 0; n < base.length; n += 1) { phase += TWO_PI * deviationHz * base[n] / sampleRate; i[n] = amplitude * Math.cos(phase); q[n] = amplitude * Math.sin(phase); }
  return { i, q, sampleRate };
}

function amIqFromAudio(audio, { audioRate = 48_000, sampleRate = 1_024_000, carrierOffsetHz = -12_000, amplitude = 0.78 } = {}) {
  const base = resampleNearest(audio, audioRate, sampleRate); const i = new Float32Array(base.length), q = new Float32Array(base.length); let phase = 0;
  for (let n = 0; n < base.length; n += 1) { const envelope = amplitude * (0.68 + 0.28 * base[n]); phase += TWO_PI * carrierOffsetHz / sampleRate; i[n] = envelope * Math.cos(phase); q[n] = envelope * Math.sin(phase); }
  return { i, q, sampleRate, carrierOffsetHz };
}

function asyncBits(text, { dataBits = 7, parity = "even", stopBits = 1 } = {}) {
  const bits = Array(12).fill(1);
  for (const char of text) {
    let value = char.charCodeAt(0) & ((1 << dataBits) - 1); bits.push(0); let ones = 0;
    for (let b = 0; b < dataBits; b += 1) { const bit = (value >> b) & 1; bits.push(bit); ones += bit; }
    if (parity !== "none") { const parityBit = parity === "even" ? (ones & 1) : ((ones & 1) ^ 1); bits.push(parityBit); }
    for (let s = 0; s < stopBits; s += 1) bits.push(1);
  }
  bits.push(...Array(12).fill(1)); return bits;
}

export function generateAfskIqFixture({ sampleRate = 1_024_000, text = "MAYHEM RTL AFSK TEST\r\n", profile = "bell202" } = {}) {
  const preset = AFSK_MODEM_PRESETS[profile] ?? AFSK_MODEM_PRESETS.bell202; const bits = asyncBits(text, preset); const audio = renderToneBits(bits, { ...preset, sampleRate: 48_000 }); return { ...nfmIqFromAudio(audio, { sampleRate }), expectedText: text, profile: preset.id };
}

function encodeAx25Address(text, last) {
  const [callRaw, ssidRaw] = String(text).split("-"); const call = callRaw.toUpperCase().padEnd(6, " ").slice(0, 6); const ssid = clamp(Number(ssidRaw ?? 0) || 0, 0, 15); const bytes = [];
  for (const ch of call) bytes.push((ch.charCodeAt(0) & 0x7f) << 1); bytes.push(0x60 | (ssid << 1) | (last ? 1 : 0)); return bytes;
}

function hdlcBits(frameBytes) {
  const bits = []; const flag = [0,1,1,1,1,1,1,0]; for (let f = 0; f < 16; f += 1) bits.push(...flag); let ones = 0;
  for (const byte of frameBytes) for (let b = 0; b < 8; b += 1) { const bit = (byte >> b) & 1; bits.push(bit); if (bit) { ones += 1; if (ones === 5) { bits.push(0); ones = 0; } } else ones = 0; }
  bits.push(...flag, ...flag, ...flag); return bits;
}

function nrziTones(bits) { const tones = []; let tone = 1; for (const bit of bits) { if (bit === 0) tone ^= 1; tones.push(tone); } return tones; }

export function generateAprsIqFixture({ sampleRate = 1_024_000, source = "N0CALL-1", destination = "APRS", info = "!3900.00N/07700.00W>MAYHEM RTL APRS TEST" } = {}) {
  const frame = [...encodeAx25Address(destination, false), ...encodeAx25Address(source, true), 0x03, 0xf0, ...Array.from(info, (ch) => ch.charCodeAt(0))]; const fcs = crc16Ax25(frame); frame.push(fcs & 0xff, (fcs >> 8) & 0xff);
  const tones = nrziTones(hdlcBits(frame)); const audio = renderToneBits(tones, { markHz: 1200, spaceHz: 2200, baud: 1200, sampleRate: 48_000, trailingBits: 8 }); return { ...nfmIqFromAudio(audio, { sampleRate }), expected: { source, destination, info }, frame: Uint8Array.from(frame) };
}

function acarsBodyBytes({ registration = "CEFIJLO", label = "Q1", blockId = "R", messageNumber = "T24", flightId = "WX1278", text = "MAYHEM RTL ACARS TEST" } = {}) {
  const raw = `2${registration.padEnd(7, " ").slice(0,7)}\x02${label.padEnd(2," ").slice(0,2)}${blockId.slice(0,1)}${messageNumber.padEnd(3," ").slice(0,3)}${flightId.padEnd(6," ").slice(0,6)}${text}`;
  const bytes = Array.from(raw, (ch) => acarsAddParity(ch.charCodeAt(0))); bytes.push(ACARS_ETX); return bytes;
}

export function generateAcarsIqFixture({ sampleRate = 1_024_000, carrierOffsetHz = -12_000, registration = "CEFIJLO", flightId = "WX1278", text = "MAYHEM RTL ACARS TEST" } = {}) {
  const body = acarsBodyBytes({ registration, flightId, text }); const crc = crc16Xmodem(body); const bits = [];
  for (let i = 0; i < 48; i += 1) bits.push(i & 1); const pushByte = (value) => { for (let b = 0; b < 8; b += 1) bits.push((value >> b) & 1); };
  pushByte(ACARS_SYN); pushByte(ACARS_SYN); pushByte(ACARS_SOH); for (const b of body) pushByte(b); pushByte((crc >> 8) & 0xff); pushByte(crc & 0xff); pushByte(ACARS_DEL); bits.push(...Array(16).fill(1));
  const audio = renderToneBits(bits, { markHz: 2400, spaceHz: 1200, baud: 2400, sampleRate: 48_000, trailingBits: 8 }); return { ...amIqFromAudio(audio, { sampleRate, carrierOffsetHz }), expected: { registration, flightId, text }, body: Uint8Array.from(body), crc };
}

const ITA2_ENCODE_LETTERS = Object.freeze(Object.fromEntries(ITA2_LETTERS.map((char, code) => [char, code]).filter(([char]) => char)));
export function ita2EncodeText(text) {
  const codes = [31];
  for (const raw of String(text).toUpperCase()) { const code = ITA2_ENCODE_LETTERS[raw]; if (code != null) codes.push(code); }
  return codes;
}

export function generateRttyIqFixture({ sampleRate = 1_024_000, text = "MAYHEM RTL RTTY TEST", profile = "eu" } = {}) {
  const preset = RTTY_PRESETS[profile] ?? RTTY_PRESETS.eu; const codes = ita2EncodeText(text); const bits = Array(4).fill(1);
  for (const code of codes) { bits.push(0); for (let b = 0; b < 5; b += 1) bits.push((code >> b) & 1); bits.push(1,1); }
  bits.push(...Array(8).fill(1)); const totalSamples = Math.ceil(bits.length * sampleRate / preset.baud); const i = new Float32Array(totalSamples), q = new Float32Array(totalSamples); let phase = 0;
  for (let n = 0; n < totalSamples; n += 1) { const bitIndex = Math.min(bits.length - 1, Math.floor(n * preset.baud / sampleRate)); const freq = bits[bitIndex] ? preset.markHz : preset.spaceHz; phase += TWO_PI * freq / sampleRate; i[n] = 0.75 * Math.cos(phase); q[n] = 0.75 * Math.sin(phase); }
  return { i, q, sampleRate, expectedText: text, profile: preset.id };
}

const MORSE_ENCODE = Object.freeze(Object.fromEntries(Object.entries(MORSE_TABLE).map(([pattern, char]) => [char, pattern])));
export function generateMorseIqFixture({ sampleRate = 1_024_000, text = "MAYHEM RTL MORSE TEST", wpm = 20, amplitude = 0.78, carrierOffsetHz = -MORSE_IF_OFFSET_HZ } = {}) {
  const unitSeconds = 1.2 / wpm; const key = [];
  const push = (state, units) => { const count = Math.max(1, Math.round(units * unitSeconds * sampleRate)); for (let n = 0; n < count; n += 1) key.push(state); };
  const words = String(text).toUpperCase().split(/\s+/);
  words.forEach((word, wi) => { [...word].forEach((char, ci) => { const pattern = MORSE_ENCODE[char]; if (!pattern) return; [...pattern].forEach((symbol, si) => { push(1, symbol === "." ? 1 : 3); if (si < pattern.length - 1) push(0, 1); }); if (ci < word.length - 1) push(0, 3); }); if (wi < words.length - 1) push(0, 7); }); push(0, 8);
  const i = new Float32Array(key.length), q = new Float32Array(key.length); let phase = 0; const increment = TWO_PI * carrierOffsetHz / sampleRate;
  for (let n = 0; n < key.length; n += 1) { if (key[n]) { i[n] = amplitude * Math.cos(phase); q[n] = amplitude * Math.sin(phase); } phase += increment; if (phase > Math.PI) phase -= TWO_PI; else if (phase < -Math.PI) phase += TWO_PI; }
  return { i, q, sampleRate, expectedText: text, wpm, carrierOffsetHz };
}
