const MODE_S_POLY = 0x1fff409;
const CPR_MAX = 131072;
const NZ = 15;
const CALLSIGN_LUT = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ#####_###############0123456789######";

function bytesFromHex(hex) {
  const clean = String(hex).replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2) throw new Error("Mode S hexadecimal text must contain whole bytes.");
  return Uint8Array.from({ length: clean.length / 2 }, (_, index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16));
}

export function hexFromBytes(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function bitArray(bytes, appendZeroBits = 0) {
  const bits = new Uint8Array(bytes.length * 8 + appendZeroBits);
  for (let index = 0; index < bytes.length * 8; index += 1) bits[index] = (bytes[index >> 3] >> (7 - (index & 7))) & 1;
  return bits;
}

const POLY_BITS = (() => {
  const bits = new Uint8Array(25);
  for (let i = 0; i < 25; i += 1) bits[i] = (MODE_S_POLY >> (24 - i)) & 1;
  return bits;
})();

function divideModeS(bits) {
  const work = bits.slice();
  for (let offset = 0; offset <= work.length - 25; offset += 1) {
    if (!work[offset]) continue;
    for (let bit = 0; bit < 25; bit += 1) work[offset + bit] ^= POLY_BITS[bit];
  }
  let remainder = 0;
  for (let index = work.length - 24; index < work.length; index += 1) remainder = (remainder << 1) | work[index];
  return remainder >>> 0;
}

export function modeSCrc(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  if (data.length !== 7 && data.length !== 14) throw new Error("Mode S frame must be 56 or 112 bits.");
  return divideModeS(bitArray(data.subarray(0, data.length - 3), 24));
}

export function modeSParity(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes ?? []);
  const length = data.length;
  return ((data[length - 3] << 16) | (data[length - 2] << 8) | data[length - 1]) >>> 0;
}

export function modeSCrcValid(bytes) { return modeSCrc(bytes) === modeSParity(bytes); }

function bitsValue(bytes, offset, length) {
  let value = 0;
  for (let bit = 0; bit < length; bit += 1) {
    const index = offset + bit;
    value = value * 2 + ((bytes[index >> 3] >> (7 - (index & 7))) & 1);
  }
  return value;
}

export function cprMod(a, b) { return a - b * Math.floor(a / b); }
export function cprNL(latitude) {
  const lat = Math.abs(Number(latitude));
  if (lat === 0) return 59;
  if (lat === 87) return 2;
  if (lat > 87) return 1;
  const c = Math.cos(Math.PI * lat / 180);
  const arg = 1 - ((1 - Math.cos(Math.PI / (2 * NZ))) / (c * c));
  if (arg <= -1) return 1;
  if (arg >= 1) return 59;
  return Math.floor(2 * Math.PI / Math.acos(arg));
}
function cprN(lat, odd) { return Math.max(1, cprNL(lat) - (odd ? 1 : 0)); }

function decodeAltitude(bytes) {
  if (!(bytes[5] & 1)) return null;
  return ((((bytes[5] & 0xfe) << 3) | ((bytes[6] & 0xf0) >> 4)) * 25) - 1000;
}

function decodeCallsign(bytes) {
  let coded = 0n;
  for (let index = 5; index < 11; index += 1) coded = (coded << 8n) | BigInt(bytes[index]);
  let callsign = "";
  for (let index = 0; index < 8; index += 1) {
    const code = Number((coded >> BigInt(42 - index * 6)) & 0x3fn);
    const char = CALLSIGN_LUT[code] || " ";
    callsign += char === "#" || char === "_" ? " " : char;
  }
  return callsign.trim();
}

function rawCpr(bytes) {
  return {
    odd: Boolean(bytes[6] & 0x04),
    latitude: ((bytes[6] & 0x03) << 15) | (bytes[7] << 7) | (bytes[8] >> 1),
    longitude: ((bytes[8] & 0x01) << 16) | (bytes[9] << 8) | bytes[10]
  };
}

function decodeVelocity(bytes) {
  const subtype = bytes[4] & 0x07;
  if (subtype < 1 || subtype > 4) return null;
  let verticalRate = ((((bytes[8] & 0x07) << 6) | (bytes[9] >> 2)) - 1) * 64;
  if (bytes[8] & 0x08) verticalRate *= -1;
  if (subtype === 1 || subtype === 2) {
    let ew = ((bytes[5] & 0x03) << 8) | bytes[6];
    let ns = ((bytes[7] & 0x7f) << 3) | (bytes[8] >> 5);
    if (!ew || !ns) return { subtype, verticalRateFpm: verticalRate };
    ew -= 1; ns -= 1;
    if (subtype === 2) { ew *= 4; ns *= 4; }
    if (bytes[5] & 0x04) ew *= -1;
    if (bytes[7] & 0x80) ns *= -1;
    const speed = Math.round(Math.hypot(ns, ew));
    let heading = Math.round(Math.atan2(ew, ns) * 180 / Math.PI);
    if (heading < 0) heading += 360;
    return { subtype, speedKnots: speed, headingDegrees: heading % 360, verticalRateFpm: verticalRate, speedType: "ground" };
  }
  const headingValid = Boolean(bytes[5] & 0x04);
  const headingDegrees = Math.round(((((bytes[5] & 0x03) << 8) | bytes[6]) * 45) / 128) % 360;
  let speed = ((bytes[7] & 0x7f) << 3) | (bytes[8] >> 5);
  if (speed) { speed -= 1; if (subtype === 4) speed *= 4; }
  return { subtype, speedKnots: speed || null, headingDegrees: headingValid ? headingDegrees : null, verticalRateFpm: verticalRate, speedType: (bytes[7] & 0x80) ? "true airspeed" : "indicated airspeed" };
}

export function decodeGlobalCpr(evenFrame, oddFrame) {
  if (!evenFrame?.cpr || !oddFrame?.cpr || evenFrame.cpr.odd || !oddFrame.cpr.odd) return null;
  const evenAge = Number(evenFrame.receivedAtMs ?? 0);
  const oddAge = Number(oddFrame.receivedAtMs ?? 0);
  if (Math.abs(evenAge - oddAge) > 10_000) return null;
  const latE = evenFrame.cpr.latitude / CPR_MAX;
  const latO = oddFrame.cpr.latitude / CPR_MAX;
  const lonE = evenFrame.cpr.longitude / CPR_MAX;
  const lonO = oddFrame.cpr.longitude / CPR_MAX;
  const j = Math.floor((59 * latE) - (60 * latO) + 0.5);
  let latitudeEven = 6 * (cprMod(j, 60) + latE);
  let latitudeOdd = (360 / 59) * (cprMod(j, 59) + latO);
  if (latitudeEven >= 270) latitudeEven -= 360;
  if (latitudeOdd >= 270) latitudeOdd -= 360;
  if (cprNL(latitudeEven) !== cprNL(latitudeOdd)) return null;
  const useEven = evenAge >= oddAge;
  const latitude = useEven ? latitudeEven : latitudeOdd;
  const nl = cprNL(latitude);
  const ni = cprN(latitude, !useEven);
  const m = Math.floor((lonE * (nl - 1)) - (lonO * nl) + 0.5);
  const selectedLon = useEven ? lonE : lonO;
  let longitude = (360 / ni) * (cprMod(m, ni) + selectedLon);
  if (longitude >= 180) longitude -= 360;
  return { latitude, longitude, altitudeFeet: useEven ? evenFrame.altitudeFeet : oddFrame.altitudeFeet };
}

export function decodeModeSFrame(input, { receivedAtMs = Date.now() } = {}) {
  const bytes = typeof input === "string" ? bytesFromHex(input) : (input instanceof Uint8Array ? input : Uint8Array.from(input ?? []));
  if (bytes.length !== 14) return { valid: false, reason: "The MAYHEM RTL ADS-B decoder currently accepts 112-bit extended-squitter frames.", rawHex: hexFromBytes(bytes) };
  const df = bytes[0] >> 3;
  const crcValid = modeSCrcValid(bytes);
  const icao = hexFromBytes(bytes.subarray(1, 4));
  const typeCode = bytes[4] >> 3;
  const subtype = bytes[4] & 0x07;
  const decoded = {
    valid: crcValid && (df === 17 || df === 18),
    crcValid,
    df,
    icao,
    typeCode,
    subtype,
    rawHex: hexFromBytes(bytes),
    receivedAtMs,
    callsign: null,
    altitudeFeet: null,
    cpr: null,
    velocity: null
  };
  if (!decoded.valid) {
    decoded.reason = !crcValid ? "Mode S CRC-24 did not match." : `Unsupported downlink format ${df}.`;
    return decoded;
  }
  if (typeCode >= 1 && typeCode <= 4) decoded.callsign = decodeCallsign(bytes);
  if (typeCode >= 9 && typeCode <= 18) {
    decoded.altitudeFeet = decodeAltitude(bytes);
    decoded.cpr = rawCpr(bytes);
  }
  if (typeCode === 19) decoded.velocity = decodeVelocity(bytes);
  return decoded;
}

export class AdsbAircraftTracker {
  constructor({ maxAircraft = 500 } = {}) { this.maxAircraft = maxAircraft; this.aircraft = new Map(); }
  update(frame) {
    if (!frame?.valid || !frame.icao) return null;
    const previous = this.aircraft.get(frame.icao) ?? { icao: frame.icao, frames: 0, even: null, odd: null };
    const next = { ...previous, frames: previous.frames + 1, lastSeenAt: new Date(frame.receivedAtMs).toISOString(), lastFrame: frame.rawHex };
    if (frame.callsign) next.callsign = frame.callsign;
    if (Number.isFinite(frame.altitudeFeet)) next.altitudeFeet = frame.altitudeFeet;
    if (frame.velocity) Object.assign(next, frame.velocity);
    if (frame.cpr) {
      const cprFrame = { ...frame };
      if (frame.cpr.odd) next.odd = cprFrame; else next.even = cprFrame;
      const position = decodeGlobalCpr(next.even, next.odd);
      if (position) Object.assign(next, position);
    }
    this.aircraft.set(frame.icao, next);
    if (this.aircraft.size > this.maxAircraft) {
      const oldest = [...this.aircraft.values()].sort((a, b) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt))[0];
      if (oldest) this.aircraft.delete(oldest.icao);
    }
    return { ...next, even: undefined, odd: undefined };
  }
  clear() { this.aircraft.clear(); }
}

function magnitude(i, q, index) { return Math.hypot(i[index] || 0, q[index] || 0); }
function sampleLinear(i, q, base, sampleRate, microseconds) {
  const position = base + microseconds * sampleRate / 1e6;
  const lower = Math.max(0, Math.floor(position));
  const upper = Math.min(i.length - 1, lower + 1);
  const fraction = position - lower;
  return magnitude(i, q, lower) * (1 - fraction) + magnitude(i, q, upper) * fraction;
}

export class AdsbIqDecoder {
  constructor({ sampleRate = 2_400_000 } = {}) {
    this.sampleRate = sampleRate;
    this.tailI = new Float32Array(0);
    this.tailQ = new Float32Array(0);
    this.tracker = new AdsbAircraftTracker();
  }
  configure({ sampleRate } = {}) { if (Number.isFinite(sampleRate) && sampleRate > 0) this.sampleRate = sampleRate; }
  reset() { this.tailI = new Float32Array(0); this.tailQ = new Float32Array(0); this.tracker.clear(); }
  process(iSamples, qSamples, { receivedAtMs = Date.now() } = {}) {
    const i = new Float32Array(this.tailI.length + iSamples.length);
    const q = new Float32Array(this.tailQ.length + qSamples.length);
    i.set(this.tailI); i.set(iSamples, this.tailI.length);
    q.set(this.tailQ); q.set(qSamples, this.tailQ.length);
    const frames = [];
    const totalUs = 8 + 112;
    const frameSamples = Math.ceil(totalUs * this.sampleRate / 1e6) + 4;
    const lowOffsets = [0.7, 1.7, 2.2, 2.8, 3.2, 4.2, 5.2, 5.8, 6.3, 6.8, 7.3];
    for (let base = 0; base + frameSamples < i.length; base += 1) {
      const highs = [0.2, 1.2, 3.7, 4.7].map((t) => sampleLinear(i, q, base, this.sampleRate, t));
      const lows = lowOffsets.map((t) => sampleLinear(i, q, base, this.sampleRate, t));
      const floor = lows.reduce((sum, value) => sum + value, 0) / lows.length;
      const weakestHigh = Math.min(...highs);
      if (!(weakestHigh > Math.max(0.08, floor * 2.2))) continue;
      const bytes = new Uint8Array(14);
      let ambiguous = 0;
      for (let bit = 0; bit < 112; bit += 1) {
        const start = 8 + bit;
        const first = sampleLinear(i, q, base, this.sampleRate, start + 0.24);
        const second = sampleLinear(i, q, base, this.sampleRate, start + 0.74);
        if (Math.abs(first - second) < Math.max(0.015, floor * 0.15)) ambiguous += 1;
        if (first > second) bytes[bit >> 3] |= 1 << (7 - (bit & 7));
      }
      if (ambiguous > 18) continue;
      const frame = decodeModeSFrame(bytes, { receivedAtMs });
      if (!frame.valid) continue;
      const aircraft = this.tracker.update(frame);
      frames.push({ ...frame, aircraft });
      base += Math.max(1, frameSamples - 2);
    }
    const keep = Math.min(i.length, frameSamples);
    this.tailI = i.slice(i.length - keep);
    this.tailQ = q.slice(q.length - keep);
    return frames;
  }
}

export function generateAdsbIqFixture(frameInput, { sampleRate = 2_400_000, amplitude = 0.8, noise = 0.02, paddingUs = 12 } = {}) {
  const bytes = typeof frameInput === "string" ? bytesFromHex(frameInput) : frameInput;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 14) throw new Error("ADS-B IQ fixture requires one 112-bit frame.");
  const pulses = [0, 1.0, 3.5, 4.5].map((startUs) => [startUs, startUs + 0.5]);
  for (let bit = 0; bit < 112; bit += 1) {
    const value = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    const startUs = 8 + bit + (value ? 0 : 0.5);
    pulses.push([startUs, startUs + 0.5]);
  }
  const totalUs = paddingUs + 8 + 112 + paddingUs;
  const count = Math.ceil(totalUs * sampleRate / 1e6);
  const i = new Float32Array(count);
  const q = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const absoluteUs = index * 1e6 / sampleRate;
    const relativeUs = absoluteUs - paddingUs;
    const high = pulses.some(([startUs, endUs]) => relativeUs >= startUs && relativeUs < endUs);
    i[index] = high ? amplitude : noise * Math.sin(index * 0.31);
  }
  return { i, q, sampleRate, origin: paddingUs * sampleRate / 1e6 };
}
