/*
 * MAYHEM RTL v0.8.9 receive-only tracking / beacon decoders.
 *
 * Fixture-backed subsets:
 *   AIS      -> 9600 bit/s HDLC/NRZI over the two marine AIS channels,
 *               CRC-16/X-25, message types 1/2/3 position reports.
 *   RS41     -> Vaisala RS41-SG 4800 bit/s 2FSK, XOR descramble,
 *               per-block CRC-16/CCITT-FALSE, identity/battery/ECEF position.
 *   406 MHz  -> COSPAS-SARSAT long-frame biphase-L burst, BCH-1/BCH-2
 *               verification, Standard Location PLB fixture fields.
 *
 * These decoders consume the continuous worker IQ stream. Their deterministic
 * fixtures prove the implemented paths, not general on-air compatibility.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const TWO_PI = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function signed(value, bits) {
  const n = Number(value);
  const sign = 2 ** (bits - 1);
  return n >= sign ? n - 2 ** bits : n;
}

function bitsToUnsigned(bits, start, width) {
  let value = 0;
  for (let i = 0; i < width; i += 1) value = value * 2 + (bits[start + i] ? 1 : 0);
  return value;
}

function setBits(bits, startOneBased, endOneBased, value) {
  const width = endOneBased - startOneBased + 1;
  let v = BigInt(value);
  for (let index = 0; index < width; index += 1) {
    const shift = BigInt(width - 1 - index);
    bits[startOneBased - 1 + index] = Number((v >> shift) & 1n);
  }
}

function bytesToMsbBits(bytes) {
  const bits = [];
  for (const byte of bytes) for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >> bit) & 1);
  return bits;
}

function msbBitsToBytes(bits) {
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < out.length; index += 1) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte = (byte << 1) | (bits[index * 8 + bit] ? 1 : 0);
    out[index] = byte;
  }
  return out;
}

function bytesToLsbBits(bytes) {
  const bits = [];
  for (const byte of bytes) for (let bit = 0; bit < 8; bit += 1) bits.push((byte >> bit) & 1);
  return bits;
}

function lsbBitsToBytes(bits) {
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < out.length; index += 1) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit += 1) byte |= (bits[index * 8 + bit] ? 1 : 0) << bit;
    out[index] = byte;
  }
  return out;
}

export function crc16X25(bytes) {
  let crc = 0xffff;
  for (const raw of bytes ?? []) {
    crc ^= Number(raw) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? ((crc >>> 1) ^ 0x8408) : (crc >>> 1);
  }
  return (crc ^ 0xffff) & 0xffff;
}

export function crc16CcittFalse(bytes) {
  let crc = 0xffff;
  for (const raw of bytes ?? []) {
    crc ^= (Number(raw) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xffff) : ((crc << 1) & 0xffff);
  }
  return crc & 0xffff;
}

class ContinuousMixer {
  constructor() { this.phase = 0; }
  reset() { this.phase = 0; }
  mix(i, q, offsetHz, sampleRate) {
    const oi = new Float32Array(i.length), oq = new Float32Array(i.length);
    const inc = -TWO_PI * offsetHz / sampleRate;
    let phase = this.phase;
    for (let n = 0; n < i.length; n += 1) {
      const c = Math.cos(phase), s = Math.sin(phase);
      oi[n] = i[n] * c - q[n] * s;
      oq[n] = i[n] * s + q[n] * c;
      phase += inc;
      if (phase > Math.PI) phase -= TWO_PI;
      else if (phase < -Math.PI) phase += TWO_PI;
    }
    this.phase = phase;
    return { i: oi, q: oq };
  }
}

class FmBitClock {
  constructor({ sampleRate = 1_024_000, baud = 9600 } = {}) { this.configure({ sampleRate, baud }); }
  configure({ sampleRate = this.sampleRate, baud = this.baud } = {}) {
    this.sampleRate = Number(sampleRate) || 1_024_000;
    this.baud = Number(baud) || 9600;
    this.samplesPerBit = this.sampleRate / this.baud;
    this.reset();
  }
  reset() { this.prevI = 1; this.prevQ = 0; this.have = false; this.phase = 0; this.acc = 0; this.bits = 0; }
  process(i, q, onBit) {
    for (let n = 0; n < i.length; n += 1) {
      let d = 0;
      if (this.have) {
        const re = this.prevI * i[n] + this.prevQ * q[n];
        const im = this.prevI * q[n] - this.prevQ * i[n];
        d = Math.atan2(im, re);
      } else this.have = true;
      this.prevI = i[n]; this.prevQ = q[n];
      this.acc += d;
      this.phase += 1;
      if (this.phase + 1e-9 < this.samplesPerBit) continue;
      this.phase -= this.samplesPerBit;
      const bit = this.acc >= 0 ? 1 : 0;
      const strength = Math.abs(this.acc) / Math.max(1, this.samplesPerBit);
      this.acc = 0;
      this.bits += 1;
      onBit?.(bit, strength);
    }
  }
}

/* -------------------------------------------------------------------------
 * AIS
 * ---------------------------------------------------------------------- */

export const AIS_CENTER_HZ = 162_000_000;
export const AIS_CHANNELS = Object.freeze({ A: Object.freeze({ frequencyHz: 161_975_000, offsetHz: -25_000 }), B: Object.freeze({ frequencyHz: 162_025_000, offsetHz: 25_000 }) });
const HDLC_FLAG_BITS = Object.freeze([0, 1, 1, 1, 1, 1, 1, 0]);

function hdlcStuff(bits) {
  const out = [];
  let ones = 0;
  for (const bit of bits) {
    out.push(bit ? 1 : 0);
    if (bit) {
      ones += 1;
      if (ones === 5) { out.push(0); ones = 0; }
    } else ones = 0;
  }
  return out;
}

function hdlcDestuff(bits) {
  const out = [];
  let ones = 0;
  for (const bit of bits) {
    if (!bit && ones === 5) { ones = 0; continue; }
    out.push(bit ? 1 : 0);
    ones = bit ? ones + 1 : 0;
    if (ones > 6) return [];
  }
  return out;
}

function nrziEncode(bits, initial = 0) {
  const out = [];
  let state = initial ? 1 : 0;
  for (const bit of bits) { if (!bit) state ^= 1; out.push(state); }
  return out;
}

function aisText(bytes, startBit, chars) {
  const bits = bytesToMsbBits(bytes);
  const alphabet = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
  let out = '';
  for (let i = 0; i < chars; i += 1) out += alphabet[bitsToUnsigned(bits, startBit + i * 6, 6)] ?? '?';
  return out.replace(/@+$/g, '').trimEnd();
}

export function parseAisPayload(payloadBytes, { channel = 'A', receivedAtMs = Date.now() } = {}) {
  if (!payloadBytes?.length) return null;
  const bits = bytesToMsbBits(payloadBytes);
  const messageType = bitsToUnsigned(bits, 0, 6);
  const repeat = bitsToUnsigned(bits, 6, 2);
  const mmsi = bitsToUnsigned(bits, 8, 30);
  const common = { family: 'ais', channel, channelFrequencyHz: AIS_CHANNELS[channel]?.frequencyHz ?? AIS_CENTER_HZ, messageType, repeat, mmsi: String(mmsi).padStart(9, '0'), receivedAtMs };
  if ([1, 2, 3].includes(messageType) && bits.length >= 168) {
    const navStatus = bitsToUnsigned(bits, 38, 4);
    const rot = signed(bitsToUnsigned(bits, 42, 8), 8);
    const sogRaw = bitsToUnsigned(bits, 50, 10);
    const longitudeRaw = signed(bitsToUnsigned(bits, 61, 28), 28);
    const latitudeRaw = signed(bitsToUnsigned(bits, 89, 27), 27);
    const cogRaw = bitsToUnsigned(bits, 116, 12);
    const headingRaw = bitsToUnsigned(bits, 128, 9);
    return {
      ...common,
      kind: 'position-report-class-a',
      navigationalStatus: navStatus,
      rateOfTurnRaw: rot,
      speedKnots: sogRaw >= 1023 ? null : sogRaw / 10,
      longitude: Math.abs(longitudeRaw) >= 108_600_000 ? null : longitudeRaw / 600_000,
      latitude: Math.abs(latitudeRaw) >= 54_600_000 ? null : latitudeRaw / 600_000,
      courseDeg: cogRaw >= 3600 ? null : cogRaw / 10,
      headingDeg: headingRaw >= 511 ? null : headingRaw,
      timestampSecond: bitsToUnsigned(bits, 137, 6)
    };
  }
  if (messageType === 5 && bits.length >= 424) {
    return {
      ...common,
      kind: 'static-voyage',
      imo: bitsToUnsigned(bits, 40, 30),
      callsign: aisText(payloadBytes, 70, 7),
      vesselName: aisText(payloadBytes, 112, 20),
      shipType: bitsToUnsigned(bits, 232, 8),
      destination: aisText(payloadBytes, 302, 20)
    };
  }
  return { ...common, kind: 'message', payloadHex: [...payloadBytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase() };
}

class AisHdlcFramer {
  constructor(channel) { this.channel = channel; this.reset(); }
  reset() { this.prevSymbol = 0; this.haveSymbol = false; this.started = false; this.frameBits = []; this.window = []; this.frames = 0; this.crcErrors = 0; this.flags = 0; }
  feedSymbol(symbol, receivedAtMs, out) {
    symbol = symbol ? 1 : 0;
    let bit = 1;
    if (this.haveSymbol) bit = symbol === this.prevSymbol ? 1 : 0;
    else this.haveSymbol = true;
    this.prevSymbol = symbol;
    this.window.push(bit);
    if (this.window.length > 8) this.window.shift();
    if (this.started) this.frameBits.push(bit);
    if (this.window.length !== 8 || !this.window.every((v, i) => v === HDLC_FLAG_BITS[i])) return;
    this.flags += 1;
    if (this.started && this.frameBits.length > 8) {
      const raw = this.frameBits.slice(0, -8);
      const clean = hdlcDestuff(raw);
      if (clean.length >= 24 && clean.length % 8 === 0) {
        const bytes = lsbBitsToBytes(clean);
        if (bytes.length >= 3) {
          const data = bytes.slice(0, -2);
          const received = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
          const expected = crc16X25(data);
          if (received === expected) {
            const parsed = parseAisPayload(data, { channel: this.channel, receivedAtMs });
            if (parsed) { this.frames += 1; out.push(parsed); }
          } else this.crcErrors += 1;
        }
      }
    }
    this.started = true;
    this.frameBits = [];
  }
}

class AisChannelDecoder {
  constructor(channel, { sampleRate = 1_024_000 } = {}) { this.channel = channel; this.mixer = new ContinuousMixer(); this.clock = new FmBitClock({ sampleRate, baud: 9600 }); this.framer = new AisHdlcFramer(channel); this.configure({ sampleRate }); }
  configure({ sampleRate = this.sampleRate } = {}) { const next = Number(sampleRate) || 1_024_000; if (next === this.sampleRate) return; this.sampleRate = next; this.clock.configure({ sampleRate: next, baud: 9600 }); this.mixer.reset(); this.framer.reset(); }
  reset() { this.mixer.reset(); this.clock.reset(); this.framer.reset(); }
  process(i, q, receivedAtMs, out) {
    const mixed = this.mixer.mix(i, q, AIS_CHANNELS[this.channel].offsetHz, this.sampleRate);
    this.clock.process(mixed.i, mixed.q, (symbol) => this.framer.feedSymbol(symbol, receivedAtMs, out));
  }
  snapshot() { return { channel: this.channel, bits: this.clock.bits, flags: this.framer.flags, frames: this.framer.frames, crcErrors: this.framer.crcErrors }; }
}

export class AisIqDecoder {
  constructor({ sampleRate = 1_024_000 } = {}) { this.channels = { A: new AisChannelDecoder('A', { sampleRate }), B: new AisChannelDecoder('B', { sampleRate }) }; this.sampleRate = sampleRate; }
  configure({ sampleRate = this.sampleRate } = {}) { this.sampleRate = Number(sampleRate) || 1_024_000; Object.values(this.channels).forEach((c) => c.configure({ sampleRate: this.sampleRate })); }
  reset() { Object.values(this.channels).forEach((c) => c.reset()); }
  process(i, q, { receivedAtMs = Date.now() } = {}) { const out = []; this.channels.A.process(i, q, receivedAtMs, out); this.channels.B.process(i, q, receivedAtMs, out); return out; }
  snapshot() { const A = this.channels.A.snapshot(), B = this.channels.B.snapshot(); return { channels: { A, B }, frames: A.frames + B.frames, crcErrors: A.crcErrors + B.crcErrors }; }
}

export function buildAisPositionPayload({ messageType = 1, mmsi = 367168384, latitude = 38.8895, longitude = -77.0353, speedKnots = 12.3, courseDeg = 184.2, headingDeg = 184, navStatus = 0, timestampSecond = 30 } = {}) {
  const bits = new Array(168).fill(0);
  setBits(bits, 1, 6, messageType); setBits(bits, 7, 8, 0); setBits(bits, 9, 38, mmsi); setBits(bits, 39, 42, navStatus); setBits(bits, 43, 50, 128); setBits(bits, 51, 60, Math.round(speedKnots * 10)); setBits(bits, 61, 61, 1);
  const lon = Math.round(longitude * 600000), lat = Math.round(latitude * 600000);
  setBits(bits, 62, 89, BigInt.asUintN(28, BigInt(lon))); setBits(bits, 90, 116, BigInt.asUintN(27, BigInt(lat))); setBits(bits, 117, 128, Math.round(courseDeg * 10)); setBits(bits, 129, 137, headingDeg); setBits(bits, 138, 143, timestampSecond); setBits(bits, 144, 144, 0); setBits(bits, 145, 146, 0); setBits(bits, 147, 149, 0); setBits(bits, 150, 168, 0);
  return msbBitsToBytes(bits);
}

function renderOffsetFsk(symbols, { sampleRate, baud, deviationHz, offsetHz = 0, amplitude = 0.72, leadSymbols = 8, tailSymbols = 8 } = {}) {
  const all = new Array(leadSymbols).fill(0).concat(symbols, new Array(tailSymbols).fill(0));
  const spb = sampleRate / baud;
  const total = Math.ceil(all.length * spb);
  const i = new Float32Array(total), q = new Float32Array(total);
  let phase = 0, n = 0, t = 0;
  for (const symbol of all) {
    const end = t + spb;
    const freq = offsetHz + (symbol ? deviationHz : -deviationHz);
    const inc = TWO_PI * freq / sampleRate;
    while (n < total && n < Math.ceil(end)) { phase += inc; i[n] = Math.cos(phase) * amplitude; q[n] = Math.sin(phase) * amplitude; n += 1; }
    t = end;
  }
  return { i, q, sampleRate };
}

export function generateAisIqFixture({ channel = 'A', sampleRate = 1_024_000, ...fields } = {}) {
  const payload = buildAisPositionPayload(fields);
  const crc = crc16X25(payload);
  const bytes = new Uint8Array(payload.length + 2); bytes.set(payload); bytes[payload.length] = crc & 0xff; bytes[payload.length + 1] = crc >> 8;
  const stuffed = hdlcStuff(bytesToLsbBits(bytes));
  const decodedBits = [...HDLC_FLAG_BITS, ...stuffed, ...HDLC_FLAG_BITS];
  const symbols = nrziEncode(decodedBits, 0);
  return { ...renderOffsetFsk(symbols, { sampleRate, baud: 9600, deviationHz: 2400, offsetHz: AIS_CHANNELS[channel].offsetHz, leadSymbols: 24, tailSymbols: 24 }), payload, channel };
}

/* -------------------------------------------------------------------------
 * Vaisala RS41-SG subset
 * ---------------------------------------------------------------------- */

export const RS41_SYNC_BYTES = Object.freeze([0x10, 0xB6, 0xCA, 0x11]);
export const RS41_MASK = Object.freeze([
  0x96,0x83,0x3E,0x51,0xB1,0x49,0x08,0x98,0x32,0x05,0x59,0x0E,0xF9,0x44,0xC6,0x26,
  0x21,0x60,0xC2,0xEA,0x79,0x5D,0x6D,0xA1,0x54,0x69,0x47,0x0C,0xDC,0xE8,0x5C,0xF1,
  0xF7,0x76,0x82,0x7F,0x07,0x99,0xA2,0x2C,0x93,0x7C,0x30,0x63,0xF5,0x10,0x2E,0x61,
  0xD0,0xBC,0xB4,0xB6,0x06,0xAA,0xF4,0x23,0x78,0x6E,0x3B,0xAE,0xBF,0x7B,0x4C,0xC1
]);
const RS41_SYNC_BITS = Object.freeze(bytesToLsbBits(RS41_SYNC_BYTES));

function putRs41Block(frame, start, id, data) {
  frame[start] = id; frame[start + 1] = data.length;
  frame.set(data, start + 2);
  const crc = crc16CcittFalse(data);
  frame[start + 2 + data.length] = crc & 0xff; frame[start + 3 + data.length] = crc >> 8;
}

function putLe32(bytes, at, value) {
  const u = value >>> 0; bytes[at] = u & 0xff; bytes[at + 1] = (u >>> 8) & 0xff; bytes[at + 2] = (u >>> 16) & 0xff; bytes[at + 3] = (u >>> 24) & 0xff;
}

function readLe32Signed(bytes, at) { return (bytes[at] | (bytes[at+1]<<8) | (bytes[at+2]<<16) | (bytes[at+3]<<24)) | 0; }

function geodeticToEcef(latDeg, lonDeg, heightM) {
  const a = 6378137.0, e2 = 6.6943799901413165e-3;
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  const sin = Math.sin(lat), N = a / Math.sqrt(1 - e2 * sin * sin);
  return { x: (N + heightM) * Math.cos(lat) * Math.cos(lon), y: (N + heightM) * Math.cos(lat) * Math.sin(lon), z: (N * (1 - e2) + heightM) * Math.sin(lat) };
}

function ecefToGeodetic(x, y, z) {
  const a = 6378137.0, e2 = 6.6943799901413165e-3;
  const p = Math.hypot(x, y);
  if (p < 1e-6 && Math.abs(z) < 1e-6) return { latitude: null, longitude: null, altitudeM: null };
  let lat = Math.atan2(z, p * (1 - e2));
  let alt = 0;
  for (let k = 0; k < 8; k += 1) {
    const sin = Math.sin(lat), N = a / Math.sqrt(1 - e2 * sin * sin);
    alt = p / Math.max(1e-12, Math.cos(lat)) - N;
    lat = Math.atan2(z, p * (1 - e2 * N / (N + alt)));
  }
  return { latitude: lat * 180 / Math.PI, longitude: Math.atan2(y, x) * 180 / Math.PI, altitudeM: alt };
}

function rs41BlockValid(clear, start) {
  if (start + 4 > clear.length) return false;
  const len = clear[start + 1];
  if (start + 4 + len > clear.length) return false;
  const data = clear.slice(start + 2, start + 2 + len);
  const got = clear[start + 2 + len] | (clear[start + 3 + len] << 8);
  return crc16CcittFalse(data) === got;
}

export function parseRs41ClearFrame(clear, { receivedAtMs = Date.now(), frequencyHz = 400_500_000 } = {}) {
  if (!(clear instanceof Uint8Array) || clear.length < 320) return null;
  const statusOk = rs41BlockValid(clear, 0x35), measOk = rs41BlockValid(clear, 0x61), gpsOk = rs41BlockValid(clear, 0x10e);
  if (!statusOk || !gpsOk) return null;
  const serial = String.fromCharCode(...clear.slice(0x39, 0x41)).trim().replace(/\0/g, '');
  const frame = clear[0x37] | (clear[0x38] << 8);
  const batteryMv = clear[0x41] * 100;
  const x = readLe32Signed(clear, 0x110) / 100, y = readLe32Signed(clear, 0x114) / 100, z = readLe32Signed(clear, 0x118) / 100;
  const geo = ecefToGeodetic(x, y, z);
  return { family: 'radiosonde', protocol: 'Vaisala RS41-SG', serial, frame, batteryMv, ...geo, temperatureC: null, humidity: null, crcStatus: { status: statusOk, measurement: measOk, gps: gpsOk }, frequencyHz, receivedAtMs };
}

export function buildRs41ClearFrame({ serial = 'S1234567', frame = 0x1234, batteryVolts = 2.6, latitude = 48.0, longitude = 2.0, altitudeM = 1000 } = {}) {
  const clear = new Uint8Array(320);
  const status = new Uint8Array(40); status[0] = frame & 0xff; status[1] = frame >> 8;
  for (let i = 0; i < 8; i += 1) status[2 + i] = i < serial.length ? serial.charCodeAt(i) : 0x20;
  status[10] = clamp(Math.round(batteryVolts * 10), 0, 255); status[23] = 3;
  putRs41Block(clear, 0x35, 0x79, status);
  putRs41Block(clear, 0x61, 0x7a, new Uint8Array(42));
  const gps = new Uint8Array(21), e = geodeticToEcef(latitude, longitude, altitudeM);
  putLe32(gps, 0, Math.round(e.x * 100)); putLe32(gps, 4, Math.round(e.y * 100)); putLe32(gps, 8, Math.round(e.z * 100));
  putRs41Block(clear, 0x10e, 0x7b, gps);
  return clear;
}

export function generateRs41IqFixture({ sampleRate = 1_024_000, ...fields } = {}) {
  const clear = buildRs41ClearFrame(fields), raw = new Uint8Array(clear.length);
  for (let pos = 0; pos < raw.length; pos += 1) raw[pos] = clear[pos] ^ RS41_MASK[(pos + 4) % 64];
  const bits = [...new Array(32).fill(0).map((_, i) => i & 1), ...RS41_SYNC_BITS, ...bytesToLsbBits(raw), ...new Array(32).fill(0).map((_, i) => i & 1)];
  return { ...renderOffsetFsk(bits, { sampleRate, baud: 4800, deviationHz: 2400, offsetHz: 0, leadSymbols: 0, tailSymbols: 0 }), clear };
}

export class Rs41IqDecoder {
  constructor({ sampleRate = 1_024_000, frequencyHz = 400_500_000 } = {}) { this.clock = new FmBitClock({ sampleRate, baud: 4800 }); this.configure({ sampleRate, frequencyHz }); }
  configure({ sampleRate = this.sampleRate, frequencyHz = this.frequencyHz } = {}) { const next = Number(sampleRate) || 1_024_000; this.frequencyHz = Number(frequencyHz) || 400_500_000; if (next !== this.sampleRate) { this.sampleRate = next; this.clock.configure({ sampleRate: next, baud: 4800 }); this.resetFrame(); } }
  resetFrame() { this.sync = []; this.collecting = false; this.bits = []; }
  reset() { this.clock.reset(); this.resetFrame(); this.syncs = 0; this.frames = 0; this.crcErrors = 0; }
  process(i, q, { receivedAtMs = Date.now(), frequencyHz = this.frequencyHz } = {}) {
    const out = [];
    this.clock.process(i, q, (bit) => {
      if (!this.collecting) {
        this.sync.push(bit); if (this.sync.length > RS41_SYNC_BITS.length) this.sync.shift();
        if (this.sync.length === RS41_SYNC_BITS.length && this.sync.every((v, idx) => v === RS41_SYNC_BITS[idx])) { this.collecting = true; this.bits = []; this.syncs += 1; }
        return;
      }
      this.bits.push(bit);
      if (this.bits.length < 320 * 8) return;
      const raw = lsbBitsToBytes(this.bits), clear = new Uint8Array(raw.length);
      for (let pos = 0; pos < raw.length; pos += 1) clear[pos] = raw[pos] ^ RS41_MASK[(pos + 4) % 64];
      const event = parseRs41ClearFrame(clear, { receivedAtMs, frequencyHz });
      if (event) { this.frames += 1; out.push(event); } else this.crcErrors += 1;
      this.resetFrame();
    });
    return out;
  }
  snapshot() { return { protocol: 'RS41-SG', syncs: this.syncs ?? 0, frames: this.frames ?? 0, crcErrors: this.crcErrors ?? 0, bits: this.clock.bits }; }
}

/* -------------------------------------------------------------------------
 * COSPAS-SARSAT 406 MHz long-frame subset
 * ---------------------------------------------------------------------- */

export const EPIRB_IF_OFFSET_HZ = 12_000;
export const EPIRB_REAL_PREAMBLE = 0b111111111111111000101111;
export const EPIRB_TEST_PREAMBLE = 0b111111111111111011010000;
export const EPIRB_BCH21_POLY = 0b1001101101100111100011;
export const EPIRB_BCH12_POLY = 0b1010100111001;

function bchRemainder(frameBits, startOneBased, endOneBased, generator, generatorBits) {
  const degree = generatorBits - 1;
  const mask = (2 ** degree) - 1;
  const low = generator & mask;
  let reg = 0;
  for (let b = startOneBased; b <= endOneBased; b += 1) {
    const input = frameBits[b - 1] ? 1 : 0;
    const feedback = ((reg >>> (degree - 1)) & 1) ^ input;
    reg = (reg << 1) & mask;
    if (feedback) reg ^= low;
  }
  return reg >>> 0;
}

function bitsField(bits, start, end) { return bitsToUnsigned(bits, start - 1, end - start + 1); }

export function buildEpirbStandardLocationFrame({ countryCode = 227, typeApproval = 123, serialNumber = 4567, latitudeDeg = 43, latitudeQuarterMinutes = 3, longitudeDeg = 1, longitudeQuarterMinutes = 2, latOffsetSeconds = 20, lonOffsetSeconds = 8 } = {}) {
  const bits = new Array(144).fill(0);
  setBits(bits, 25, 25, 1); setBits(bits, 26, 26, 0); setBits(bits, 27, 36, countryCode); setBits(bits, 37, 40, 0b0111); setBits(bits, 41, 50, typeApproval); setBits(bits, 51, 64, serialNumber);
  setBits(bits, 65, 65, 0); setBits(bits, 66, 72, latitudeDeg); setBits(bits, 73, 74, latitudeQuarterMinutes); setBits(bits, 75, 75, 0); setBits(bits, 76, 83, longitudeDeg); setBits(bits, 84, 85, longitudeQuarterMinutes);
  setBits(bits, 107, 110, 0b1101); setBits(bits, 111, 111, 1); setBits(bits, 112, 112, 1);
  setBits(bits, 113, 113, 1); setBits(bits, 114, 118, Math.floor(latOffsetSeconds / 60)); setBits(bits, 119, 122, Math.round((latOffsetSeconds % 60) / 4));
  setBits(bits, 123, 123, 1); setBits(bits, 124, 128, Math.floor(lonOffsetSeconds / 60)); setBits(bits, 129, 132, Math.round((lonOffsetSeconds % 60) / 4));
  setBits(bits, 1, 24, EPIRB_REAL_PREAMBLE);
  setBits(bits, 86, 106, bchRemainder(bits, 25, 85, EPIRB_BCH21_POLY, 22));
  setBits(bits, 133, 144, bchRemainder(bits, 107, 132, EPIRB_BCH12_POLY, 13));
  return bits;
}

const COUNTRY_NAMES = Object.freeze({ 227: 'France', 232: 'United Kingdom', 316: 'Canada', 338: 'United States', 366: 'United States', 367: 'United States', 368: 'United States', 369: 'United States' });

export function parseEpirbFrame(bits, { receivedAtMs = Date.now(), frequencyHz = 406_037_000 } = {}) {
  if (!Array.isArray(bits) || ![112, 144].includes(bits.length)) return null;
  const preamble = bitsField(bits, 1, 24), selfTest = preamble === EPIRB_TEST_PREAMBLE;
  if (preamble !== EPIRB_REAL_PREAMBLE && !selfTest) return null;
  const longFrame = bitsField(bits, 25, 25) === 1;
  const bch1 = bitsField(bits, 86, 106), bch1Expected = bchRemainder(bits, 25, 85, EPIRB_BCH21_POLY, 22);
  const bch2 = longFrame && bits.length >= 144 ? bitsField(bits, 133, 144) : null;
  const bch2Expected = longFrame && bits.length >= 144 ? bchRemainder(bits, 107, 132, EPIRB_BCH12_POLY, 13) : null;
  const protocolFlag = bitsField(bits, 26, 26), countryCode = bitsField(bits, 27, 36), protocolCode = bitsField(bits, 37, protocolFlag ? 39 : 40);
  const valid = bch1 === bch1Expected && (!longFrame || bch2 === bch2Expected);
  let type = protocolFlag ? 'User Protocol Beacon' : 'Location Protocol Beacon';
  let protocol = `code-${protocolCode}`;
  let serialNumber = null, typeApproval = null, latitude = null, longitude = null;
  if (!protocolFlag && protocolCode === 0b0111) {
    type = 'PLB'; protocol = 'Standard Location PLB Serial';
    typeApproval = bitsField(bits, 41, 50); serialNumber = bitsField(bits, 51, 64);
    const latSouth = bitsField(bits, 65, 65) === 1, lonWest = bitsField(bits, 75, 75) === 1;
    latitude = bitsField(bits, 66, 72) + bitsField(bits, 73, 74) * 15 / 60;
    longitude = bitsField(bits, 76, 83) + bitsField(bits, 84, 85) * 15 / 60;
    if (latSouth) latitude = -latitude; if (lonWest) longitude = -longitude;
    if (longFrame && bitsField(bits, 107, 110) === 0b1101) {
      const latOffset = bitsField(bits, 114, 118) / 60 + bitsField(bits, 119, 122) * 4 / 3600;
      const lonOffset = bitsField(bits, 124, 128) / 60 + bitsField(bits, 129, 132) * 4 / 3600;
      latitude += bitsField(bits, 113, 113) ? latOffset : -latOffset;
      longitude += bitsField(bits, 123, 123) ? lonOffset : -lonOffset;
    }
  }
  return { family: '406-beacon', type, protocol, frameMode: selfTest ? 'self-test' : 'normal', longFrame, countryCode, country: COUNTRY_NAMES[countryCode] ?? `MID ${countryCode}`, typeApproval, serialNumber, latitude, longitude, internalNavigation: longFrame ? Boolean(bitsField(bits, 111, 111)) : null, homing121_5MHz: longFrame ? Boolean(bitsField(bits, 112, 112)) : null, bch1Valid: bch1 === bch1Expected, bch2Valid: longFrame ? bch2 === bch2Expected : null, valid, frequencyHz, receivedAtMs };
}

export function generateEpirbIqFixture({ sampleRate = 1_024_000, offsetHz = EPIRB_IF_OFFSET_HZ, ...fields } = {}) {
  const bits = buildEpirbStandardLocationFrame(fields), samplesPerChip = sampleRate / 800;
  const carrierSamples = Math.round(sampleRate * 0.160), tailSamples = Math.round(samplesPerChip * 6);
  const total = carrierSamples + Math.ceil(bits.length * 2 * samplesPerChip) + tailSamples;
  const i = new Float32Array(total), q = new Float32Array(total);
  let phase = 0, index = 0, chipClock = 0;
  const rfInc = TWO_PI * offsetHz / sampleRate;
  const emit = (targetPhase, samples) => { for (let n = 0; n < samples && index < total; n += 1, index += 1) { phase += rfInc; i[index] = Math.cos(phase + targetPhase) * 0.72; q[index] = Math.sin(phase + targetPhase) * 0.72; } };
  emit(0, carrierSamples);
  for (const bit of bits) {
    const first = bit ? 1.1 : -1.1;
    chipClock += samplesPerChip; const n1 = Math.round(chipClock) - (index - carrierSamples); emit(first, Math.max(0, n1));
    chipClock += samplesPerChip; const n2 = Math.round(chipClock) - (index - carrierSamples); emit(-first, Math.max(0, n2));
  }
  emit(0, total - index);
  return { i, q, sampleRate, bits };
}

export class EpirbIqDecoder {
  constructor({ sampleRate = 1_024_000, offsetHz = EPIRB_IF_OFFSET_HZ, frequencyHz = 406_037_000 } = {}) { this.mixer = new ContinuousMixer(); this.configure({ sampleRate, offsetHz, frequencyHz }); }
  configure({ sampleRate = this.sampleRate, offsetHz = this.offsetHz, frequencyHz = this.frequencyHz } = {}) {
    const nextRate = Number(sampleRate) || 1_024_000, nextOffset = Number(offsetHz) || EPIRB_IF_OFFSET_HZ;
    const changed = nextRate !== this.sampleRate || nextOffset !== this.offsetHz;
    this.sampleRate = nextRate; this.offsetHz = nextOffset; this.frequencyHz = Number(frequencyHz) || 406_037_000; this.samplesPerChip = this.sampleRate / 800;
    if (changed) this.reset();
  }
  reset() { this.mixer.reset(); this.chipPhase = 0; this.sumI = 0; this.sumQ = 0; this.carrierChips = 0; this.inData = false; this.firstChip = null; this.bitWindow = []; this.frameBits = null; this.expectedBits = 0; this.syncs = 0; this.frames = 0; this.invalidPairs = 0; this.bchErrors = 0; }
  #chip(angle, receivedAtMs, out) {
    if (!this.inData) {
      if (Math.abs(angle) < 0.40) { this.carrierChips += 1; return; }
      if (this.carrierChips < 32) { this.carrierChips = 0; return; }
      this.inData = true; this.firstChip = angle; return;
    }
    if (this.firstChip == null) { this.firstChip = angle; return; }
    const a = this.firstChip, b = angle; this.firstChip = null;
    let bit = null;
    if (a > 0.35 && b < -0.35) bit = 1; else if (a < -0.35 && b > 0.35) bit = 0;
    if (bit == null) { this.invalidPairs += 1; this.inData = false; this.carrierChips = 0; this.bitWindow = []; this.frameBits = null; return; }
    if (!this.frameBits) {
      this.bitWindow.push(bit); if (this.bitWindow.length > 24) this.bitWindow.shift();
      if (this.bitWindow.length === 24) {
        const pre = bitsToUnsigned(this.bitWindow, 0, 24);
        if (pre === EPIRB_REAL_PREAMBLE || pre === EPIRB_TEST_PREAMBLE) { this.frameBits = [...this.bitWindow]; this.expectedBits = 0; this.syncs += 1; }
      }
      return;
    }
    this.frameBits.push(bit);
    if (this.frameBits.length === 25) this.expectedBits = this.frameBits[24] ? 144 : 112;
    if (!this.expectedBits || this.frameBits.length < this.expectedBits) return;
    const event = parseEpirbFrame(this.frameBits.slice(0, this.expectedBits), { receivedAtMs, frequencyHz: this.frequencyHz });
    if (event?.valid) { this.frames += 1; out.push(event); } else this.bchErrors += 1;
    this.inData = false; this.carrierChips = 0; this.bitWindow = []; this.frameBits = null; this.expectedBits = 0;
  }
  process(i, q, { receivedAtMs = Date.now(), frequencyHz = this.frequencyHz } = {}) {
    this.frequencyHz = Number(frequencyHz) || this.frequencyHz;
    const mixed = this.mixer.mix(i, q, this.offsetHz, this.sampleRate), out = [];
    for (let n = 0; n < mixed.i.length; n += 1) {
      this.sumI += mixed.i[n]; this.sumQ += mixed.q[n]; this.chipPhase += 1;
      if (this.chipPhase + 1e-9 < this.samplesPerChip) continue;
      this.chipPhase -= this.samplesPerChip;
      const angle = Math.atan2(this.sumQ, this.sumI); this.sumI = 0; this.sumQ = 0;
      this.#chip(angle, receivedAtMs, out);
    }
    return out;
  }
  snapshot() { return { state: this.frameBits ? 'frame' : this.inData ? 'data-sync' : 'carrier-search', syncs: this.syncs, frames: this.frames, invalidPairs: this.invalidPairs, bchErrors: this.bchErrors, carrierChips: this.carrierChips }; }
}

export class TrackingDecoderSuite {
  constructor({ sampleRate = 1_024_000 } = {}) { this.ais = new AisIqDecoder({ sampleRate }); this.radiosonde = new Rs41IqDecoder({ sampleRate }); this.epirb = new EpirbIqDecoder({ sampleRate }); this.sampleRate = sampleRate; }
  configure({ sampleRate = this.sampleRate } = {}) { this.sampleRate = Number(sampleRate) || 1_024_000; this.ais.configure({ sampleRate: this.sampleRate }); this.radiosonde.configure({ sampleRate: this.sampleRate }); this.epirb.configure({ sampleRate: this.sampleRate }); }
  reset() { this.ais.reset(); this.radiosonde.reset(); this.epirb.reset(); }
}
