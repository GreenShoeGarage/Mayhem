/*
 * MAYHEM RTL — browser-local POCSAG receiver.
 *
 * Protocol behavior follows the pinned mayhem-b200 host port:
 * - 2FSK, nominal +/-4.5 kHz deviation;
 * - 512, 1200, or 2400 bit/s;
 * - sync word 0x7CD215D8 and idle word 0x7A89C197;
 * - BCH(31,21) error correction with the same syndrome table construction;
 * - RIC low three bits derived from the codeword frame position;
 * - 7-bit alpha characters transmitted least-significant-bit first.
 *
 * This module is receive/decode only. It contains no encoder exposed to the UI
 * and no radio-transmit path. Small fixture helpers are exported for tests and
 * Simulation Mode only.
 */

export const POCSAG_SYNC_WORD = 0x7cd215d8 >>> 0;
export const POCSAG_IDLE_WORD = 0x7a89c197 >>> 0;
export const POCSAG_BIT_RATES = Object.freeze([512, 1200, 2400]);
export const POCSAG_DEFAULT_DEVIATION_HZ = 4500;

const TWO_PI = Math.PI * 2;
const NUMERIC_LUT = "084 2.6]195-3U7[";

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function reverseBits(value, width) {
  let out = 0;
  for (let bit = 0; bit < width; bit += 1) out = (out << 1) | ((value >>> bit) & 1);
  return out >>> 0;
}
function popcount32(value) {
  let v = value >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function wordToBits(word) {
  const bits = [];
  for (let bit = 31; bit >= 0; bit -= 1) bits.push((word >>> bit) & 1);
  return bits;
}
function sanitizeAlpha(text) {
  return String(text || "")
    .replace(/[\u0000\u0001\u0002\u0003\u0004\u0005\u0006\u0007]/g, "")
    .replace(/[\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+$/g, "");
}

export class PocsagEcc {
  constructor() {
    this.ecs = new Uint16Array(32);
    this.bch = new Uint16Array(1024);
    this.#setup();
  }

  #setup() {
    let srr = 0x3b4;
    for (let i = 0; i <= 20; i += 1) {
      this.ecs[i] = srr;
      srr = (srr & 1) ? ((srr >>> 1) ^ 0x3b4) : (srr >>> 1);
    }
    for (let n = 0; n <= 20; n += 1) {
      for (let i = 0; i <= 20; i += 1) {
        const syndrome = this.ecs[n] ^ this.ecs[i];
        this.bch[syndrome] = ((i << 5) + n + 0x2000) & 0xffff;
      }
    }
    for (let n = 0; n <= 20; n += 1) this.bch[this.ecs[n]] = (n + (0x1f << 5) + 0x1000) & 0xffff;
    for (let n = 0; n <= 20; n += 1) {
      for (let i = 0; i < 10; i += 1) {
        const syndrome = this.ecs[n] ^ (1 << i);
        this.bch[syndrome] = (n + (0x1f << 5) + 0x2000) & 0xffff;
      }
    }
    for (let n = 0; n < 10; n += 1) this.bch[1 << n] = (0x3ff + 0x1000) & 0xffff;
    for (let n = 0; n < 10; n += 1) {
      for (let i = 0; i < 10; i += 1) {
        if (i === n) continue;
        this.bch[(1 << n) ^ (1 << i)] = (0x3ff + 0x2000) & 0xffff;
      }
    }
  }

  correct(input) {
    let value = input >>> 0;
    let ecc = 0;
    for (let i = 31; i >= 11; i -= 1) if (value & (1 << i)) ecc ^= this.ecs[31 - i];
    let acc = 0;
    for (let i = 10; i >= 1; i -= 1) {
      acc <<= 1;
      if (value & (1 << i)) acc ^= 1;
    }
    const syndrome = (ecc ^ acc) & 0x3ff;
    if (!syndrome) return { word: value >>> 0, errors: 0, corrected: false, uncorrectable: false };
    const entry = this.bch[syndrome];
    if (!entry) return { word: value >>> 0, errors: 3, corrected: false, uncorrectable: true };
    const b1 = entry & 0x1f;
    const b2 = (entry >>> 5) & 0x1f;
    if (b2 !== 0x1f) value = (value ^ (1 << (31 - b2))) >>> 0;
    if (b1 !== 0x1f) value = (value ^ (1 << (31 - b1))) >>> 0;
    let errors = entry >>> 12;
    if (errors === 4) errors = 3;
    return { word: value >>> 0, errors, corrected: errors > 0 && errors < 3, uncorrectable: errors >= 3 };
  }

  encode(payload) {
    let word = (payload >>> 0) & 0xfffff800;
    let ecc = 0;
    for (let i = 31; i >= 11; i -= 1) if (word & (1 << i)) ecc ^= this.ecs[31 - i];
    word = (word | ((ecc & 0x3ff) << 1)) >>> 0;
    let parity = 0;
    for (let i = 31; i >= 1; i -= 1) if (word & (1 << i)) parity ^= 1;
    return (word | parity) >>> 0;
  }
}

function chooseMessageType(alpha, numeric) {
  const cleanAlpha = sanitizeAlpha(alpha);
  const cleanNumeric = String(numeric || "").replace(/\s+$/g, "");
  if (!cleanAlpha && !cleanNumeric) return { type: "tone", message: "" };
  let printable = 0;
  let letters = 0;
  for (const char of cleanAlpha) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) printable += 1;
    if (/[A-Za-z]/.test(char)) letters += 1;
  }
  const ratio = cleanAlpha.length ? printable / cleanAlpha.length : 0;
  if (cleanAlpha && (letters >= 2 || ratio >= 0.88)) return { type: "alpha", message: cleanAlpha };
  return { type: "numeric", message: cleanNumeric || cleanAlpha };
}

class PageAssembler {
  constructor(ecc) {
    this.ecc = ecc;
    this.current = null;
  }

  reset() { this.current = null; }

  #newPage(address, func, bitrate, inverted, receivedAtMs) {
    this.current = {
      address,
      function: func,
      bitrate,
      inverted,
      receivedAtMs,
      alpha: "",
      numeric: "",
      alphaShift: 0,
      alphaBits: 0,
      messageCodewords: 0,
      correctedBits: 0,
      uncorrectableCodewords: 0
    };
  }

  #appendPayload(payload) {
    if (!this.current) return;
    for (let bit = 19; bit >= 0; bit -= 1) {
      this.current.alphaShift = ((this.current.alphaShift << 1) | ((payload >>> bit) & 1)) & 0x7f;
      this.current.alphaBits += 1;
      if (this.current.alphaBits === 7) {
        const code = reverseBits(this.current.alphaShift, 7) & 0x7f;
        this.current.alpha += String.fromCharCode(code);
        this.current.alphaBits = 0;
        this.current.alphaShift = 0;
      }
    }
    for (let shift = 16; shift >= 0; shift -= 4) this.current.numeric += NUMERIC_LUT[(payload >>> shift) & 0xf];
    this.current.messageCodewords += 1;
  }

  #finalize(reason = "terminator") {
    if (!this.current) return null;
    const page = this.current;
    this.current = null;
    const detected = chooseMessageType(page.alpha, page.numeric);
    return {
      address: page.address,
      ric: page.address,
      function: page.function,
      bitrate: page.bitrate,
      inverted: page.inverted,
      type: detected.type,
      message: detected.message,
      alpha: sanitizeAlpha(page.alpha),
      numeric: page.numeric.replace(/\s+$/g, ""),
      messageCodewords: page.messageCodewords,
      correctedBits: page.correctedBits,
      uncorrectableCodewords: page.uncorrectableCodewords,
      receivedAtMs: page.receivedAtMs,
      endedBy: reason
    };
  }

  processBatch(words, { bitrate, inverted, receivedAtMs = Date.now() } = {}) {
    const pages = [];
    let correctedBits = 0;
    let uncorrectableCodewords = 0;
    for (let index = 0; index < 16; index += 1) {
      const corrected = this.ecc.correct(words[index] >>> 0);
      correctedBits += corrected.errors < 3 ? corrected.errors : 0;
      if (corrected.uncorrectable) {
        uncorrectableCodewords += 1;
        if (this.current) this.current.uncorrectableCodewords += 1;
        continue;
      }
      const word = corrected.word >>> 0;
      if (this.current) this.current.correctedBits += corrected.errors;
      if (word === POCSAG_IDLE_WORD) {
        const page = this.#finalize("idle");
        if (page) pages.push(page);
        continue;
      }
      if ((word & 0x80000000) === 0) {
        const prior = this.#finalize("next-address");
        if (prior) pages.push(prior);
        const frame = Math.floor(index / 2);
        const address = (((word >>> 10) & 0x1ffff8) | frame) >>> 0;
        const func = (word >>> 11) & 0x3;
        this.#newPage(address, func, bitrate, inverted, receivedAtMs);
        this.current.correctedBits += corrected.errors;
      } else if (this.current) {
        this.#appendPayload((word >>> 11) & 0xfffff);
      }
    }
    return { pages, correctedBits, uncorrectableCodewords };
  }
}

class BitLane {
  constructor(bitrate, onBatch) {
    this.bitrate = bitrate;
    this.onBatch = onBatch;
    this.reset(48000);
  }

  reset(sampleRate) {
    this.sampleRate = sampleRate;
    this.samplesPerBit = sampleRate / this.bitrate;
    this.sampleIndex = 0;
    this.lastSign = null;
    this.lastTransition = null;
    this.lockScore = 0;
    this.locked = false;
    this.nextCenter = 0;
    this.shift = 0;
    this.shiftBits = 0;
    this.bitsSinceSync = 0;
    this.collecting = false;
    this.inverted = false;
    this.word = 0;
    this.wordBits = 0;
    this.words = [];
    this.syncCount = 0;
  }

  configure(sampleRate) {
    if (Math.abs(sampleRate - this.sampleRate) > 0.01) this.reset(sampleRate);
  }

  #observeTransition() {
    if (this.lastTransition != null) {
      const interval = this.sampleIndex - this.lastTransition;
      const tolerance = this.samplesPerBit * 0.28;
      if (Math.abs(interval - this.samplesPerBit) <= tolerance) this.lockScore += 1;
      else if (Math.abs(interval - this.samplesPerBit * 2) <= tolerance * 1.5) this.lockScore = Math.max(0, this.lockScore - 0.25);
      else this.lockScore = Math.max(0, this.lockScore - 2);
      if (!this.locked && this.lockScore >= 18) {
        this.locked = true;
        this.nextCenter = this.sampleIndex + this.samplesPerBit / 2;
        this.shift = 0;
        this.shiftBits = 0;
        this.bitsSinceSync = 0;
      }
    }
    if (this.locked) {
      const firstBoundary = this.nextCenter - this.samplesPerBit / 2;
      const k = Math.round((this.sampleIndex - firstBoundary) / this.samplesPerBit);
      const expected = firstBoundary + k * this.samplesPerBit;
      const error = this.sampleIndex - expected;
      if (Math.abs(error) <= this.samplesPerBit * 0.32) this.nextCenter += error * 0.18;
    }
    this.lastTransition = this.sampleIndex;
  }

  #acceptBit(bit, receivedAtMs) {
    this.bitsSinceSync += 1;
    if (this.collecting) {
      const value = this.inverted ? (bit ^ 1) : bit;
      this.word = ((this.word << 1) | value) >>> 0;
      this.wordBits += 1;
      if (this.wordBits === 32) {
        this.words.push(this.word >>> 0);
        this.word = 0;
        this.wordBits = 0;
        if (this.words.length === 16) {
          this.onBatch({ words: this.words.slice(), bitrate: this.bitrate, inverted: this.inverted, receivedAtMs });
          this.words.length = 0;
          this.collecting = false;
          this.shift = 0;
          this.shiftBits = 0;
          this.bitsSinceSync = 0;
        }
      }
      return;
    }

    this.shift = ((this.shift << 1) | bit) >>> 0;
    this.shiftBits = Math.min(32, this.shiftBits + 1);
    if (this.shiftBits < 32) return;
    const normalDistance = popcount32((this.shift ^ POCSAG_SYNC_WORD) >>> 0);
    const invertedWord = (~POCSAG_SYNC_WORD) >>> 0;
    const invertedDistance = popcount32((this.shift ^ invertedWord) >>> 0);
    if (normalDistance <= 2 || invertedDistance <= 2) {
      this.inverted = invertedDistance < normalDistance;
      this.collecting = true;
      this.word = 0;
      this.wordBits = 0;
      this.words.length = 0;
      this.syncCount += 1;
      this.bitsSinceSync = 0;
    } else if (this.bitsSinceSync > 5000) {
      this.locked = false;
      this.lockScore = 0;
      this.lastTransition = null;
      this.shift = 0;
      this.shiftBits = 0;
      this.bitsSinceSync = 0;
    }
  }

  process(value, receivedAtMs) {
    const sign = value < 0 ? 1 : 0; // POCSAG logical 1 is the lower FSK tone.
    if (this.lastSign != null && sign !== this.lastSign) this.#observeTransition();
    this.lastSign = sign;
    if (this.locked) {
      while (this.sampleIndex + 1e-9 >= this.nextCenter) {
        this.#acceptBit(sign, receivedAtMs);
        this.nextCenter += this.samplesPerBit;
      }
      if (this.lastTransition != null && this.sampleIndex - this.lastTransition > this.samplesPerBit * 160) {
        this.locked = false;
        this.lockScore = 0;
        this.lastTransition = null;
      }
    }
    this.sampleIndex += 1;
  }
}

export class PocsagIqDecoder {
  constructor({ sampleRate = 1_024_000, baudRate = "auto", deviationHz = POCSAG_DEFAULT_DEVIATION_HZ } = {}) {
    this.ecc = new PocsagEcc();
    this.assemblerByRate = new Map();
    this.lanes = new Map();
    this.stats = {};
    this.configure({ sampleRate, baudRate, deviationHz });
    this.reset();
  }

  configure({ sampleRate = this.sampleRate, baudRate = this.baudRate, deviationHz = this.deviationHz } = {}) {
    const rate = Number(sampleRate);
    if (!Number.isFinite(rate) || rate < 8000) throw new RangeError("POCSAG sample rate must be at least 8 kHz.");
    const nextBaud = baudRate === "auto" ? "auto" : Number(baudRate);
    if (nextBaud !== "auto" && !POCSAG_BIT_RATES.includes(nextBaud)) throw new RangeError("POCSAG baud rate must be auto, 512, 1200, or 2400.");
    const changed = this.sampleRate !== rate || this.baudRate !== nextBaud;
    this.sampleRate = rate;
    this.baudRate = nextBaud;
    this.deviationHz = clamp(Number(deviationHz) || POCSAG_DEFAULT_DEVIATION_HZ, 1000, 12000);
    this.decimation = Math.max(1, Math.floor(rate / 48_000));
    this.audioRate = rate / this.decimation;
    if (changed && this.lanes?.size) this.reset();
  }

  reset() {
    this.prevI = 1;
    this.prevQ = 0;
    this.havePrev = false;
    this.discriminatorSum = 0;
    this.decimCount = 0;
    this.low1 = 0;
    this.low2 = 0;
    this.dc = 0;
    this.absLevel = 0.05;
    this.sampleCounter = 0;
    this.lastPageKey = "";
    this.lastPageAt = 0;
    this.stats = {
      samples: 0,
      syncs: 0,
      batches: 0,
      pages: 0,
      correctedBits: 0,
      uncorrectableCodewords: 0,
      lastBitrate: 0,
      lastInverted: false,
      audioRate: this.audioRate
    };
    this.assemblerByRate = new Map();
    this.lanes = new Map();
    for (const rate of POCSAG_BIT_RATES) {
      if (this.baudRate !== "auto" && rate !== this.baudRate) continue;
      const assembler = new PageAssembler(this.ecc);
      this.assemblerByRate.set(rate, assembler);
      const lane = new BitLane(rate, (batch) => this.#handleBatch(batch));
      lane.configure(this.audioRate);
      this.lanes.set(rate, lane);
    }
  }

  #handleBatch(batch) {
    this.stats.syncs += 1;
    this.stats.batches += 1;
    this.stats.lastBitrate = batch.bitrate;
    this.stats.lastInverted = batch.inverted;
    const assembler = this.assemblerByRate.get(batch.bitrate);
    const result = assembler.processBatch(batch.words, batch);
    this.stats.correctedBits += result.correctedBits;
    this.stats.uncorrectableCodewords += result.uncorrectableCodewords;
    for (const page of result.pages) {
      const key = `${page.address}:${page.function}:${page.message}:${page.bitrate}`;
      const now = Number(page.receivedAtMs) || Date.now();
      if (key === this.lastPageKey && now - this.lastPageAt < 1200) continue;
      this.lastPageKey = key;
      this.lastPageAt = now;
      this.stats.pages += 1;
      this.onPage?.({ ...page, decoderStats: { ...this.stats } });
    }
  }

  setPageHandler(handler) { this.onPage = typeof handler === "function" ? handler : null; }

  snapshot() {
    const laneStats = {};
    for (const [rate, lane] of this.lanes) laneStats[rate] = { locked: lane.locked, syncs: lane.syncCount, lockScore: Number(lane.lockScore.toFixed(2)) };
    return { ...this.stats, baudRate: this.baudRate, sampleRate: this.sampleRate, audioRate: this.audioRate, lanes: laneStats };
  }

  process(iSamples, qSamples, { receivedAtMs = Date.now() } = {}) {
    if (!(iSamples instanceof Float32Array) || !(qSamples instanceof Float32Array) || iSamples.length !== qSamples.length) throw new TypeError("POCSAG decoder requires equal Float32Array IQ inputs.");
    const pages = [];
    const originalHandler = this.onPage;
    this.onPage = (page) => { pages.push(page); originalHandler?.(page); };
    const lowpassAlpha = 1 - Math.exp(-TWO_PI * 1800 / this.audioRate);
    const dcAlpha = 1 - Math.exp(-TWO_PI * 12 / this.audioRate);
    const levelAlpha = 1 - Math.exp(-TWO_PI * 18 / this.audioRate);
    for (let n = 0; n < iSamples.length; n += 1) {
      const i = iSamples[n];
      const q = qSamples[n];
      if (this.havePrev) {
        const real = this.prevI * i + this.prevQ * q;
        const imag = this.prevI * q - this.prevQ * i;
        this.discriminatorSum += Math.atan2(imag, real);
        this.decimCount += 1;
        if (this.decimCount >= this.decimation) {
          const phaseAverage = this.discriminatorSum / this.decimCount;
          const frequencyHz = phaseAverage * this.sampleRate / TWO_PI;
          this.discriminatorSum = 0;
          this.decimCount = 0;
          this.low1 += lowpassAlpha * (frequencyHz - this.low1);
          this.low2 += lowpassAlpha * (this.low1 - this.low2);
          this.dc += dcAlpha * (this.low2 - this.dc);
          const centered = this.low2 - this.dc;
          this.absLevel += levelAlpha * (Math.abs(centered) - this.absLevel);
          const normalized = centered / Math.max(100, this.absLevel);
          for (const lane of this.lanes.values()) lane.process(normalized, receivedAtMs);
        }
      }
      this.prevI = i;
      this.prevQ = q;
      this.havePrev = true;
    }
    this.stats.samples += iSamples.length;
    this.onPage = originalHandler;
    return pages;
  }
}

export function pocsagAddressCodeword(ric, func = 0, ecc = new PocsagEcc()) {
  const payload = ((((Number(ric) >>> 0) & 0x1ffff8) << 10) | ((Number(func) & 0x3) << 11)) >>> 0;
  return ecc.encode(payload);
}

export function pocsagAlphaCodewords(text, ecc = new PocsagEcc()) {
  const bits = [];
  for (const char of String(text)) {
    const encoded = reverseBits(char.charCodeAt(0) & 0x7f, 7);
    for (let bit = 6; bit >= 0; bit -= 1) bits.push((encoded >>> bit) & 1);
  }
  const codewords = [];
  for (let cursor = 0; cursor < bits.length; cursor += 20) {
    let payload = 0;
    for (let bit = 0; bit < 20; bit += 1) payload = (payload << 1) | (bits[cursor + bit] ?? 0);
    codewords.push(ecc.encode((0x80000000 | ((payload & 0xfffff) << 11)) >>> 0));
  }
  return codewords;
}

export function buildPocsagFixtureWords({ ric = 1234560, functionCode = 3, message = "MAYHEM RTL", bitrate = 1200 } = {}) {
  if (!POCSAG_BIT_RATES.includes(Number(bitrate))) throw new RangeError("Fixture bitrate must be 512, 1200, or 2400.");
  const ecc = new PocsagEcc();
  const words = new Array(16).fill(POCSAG_IDLE_WORD);
  const frame = (Number(ric) >>> 0) & 7;
  const addressIndex = frame * 2;
  words[addressIndex] = pocsagAddressCodeword(ric, functionCode, ecc);
  const messages = pocsagAlphaCodewords(message, ecc);
  for (let i = 0; i < messages.length && addressIndex + 1 + i < 16; i += 1) words[addressIndex + 1 + i] = messages[i];
  return words;
}

export function generatePocsagIqFixture({ sampleRate = 48_000, bitrate = 1200, ric = 1234560, functionCode = 3, message = "MAYHEM RTL", deviationHz = POCSAG_DEFAULT_DEVIATION_HZ, inverted = false, preambleBits = 576, trailingBits = 96 } = {}) {
  const rate = Number(sampleRate);
  const baud = Number(bitrate);
  if (!POCSAG_BIT_RATES.includes(baud)) throw new RangeError("Fixture bitrate must be 512, 1200, or 2400.");
  const words = buildPocsagFixtureWords({ ric, functionCode, message, bitrate: baud });
  const bits = [];
  for (let i = 0; i < preambleBits; i += 1) bits.push(i & 1 ? 0 : 1);
  bits.push(...wordToBits(POCSAG_SYNC_WORD));
  for (const word of words) bits.push(...wordToBits(word));
  // A second idle batch gives a message ending in the final codeword a real
  // protocol terminator instead of relying on an artificial end-of-buffer flush.
  bits.push(...wordToBits(POCSAG_SYNC_WORD));
  for (let index = 0; index < 16; index += 1) bits.push(...wordToBits(POCSAG_IDLE_WORD));
  for (let i = 0; i < trailingBits; i += 1) bits.push(i & 1 ? 0 : 1);
  const samplesPerBit = rate / baud;
  const sampleCount = Math.ceil(bits.length * samplesPerBit);
  const i = new Float32Array(sampleCount);
  const q = new Float32Array(sampleCount);
  let phase = 0;
  let sample = 0;
  for (let bitIndex = 0; bitIndex < bits.length && sample < sampleCount; bitIndex += 1) {
    const logical = inverted ? (bits[bitIndex] ^ 1) : bits[bitIndex];
    const frequency = logical ? -Math.abs(deviationHz) : Math.abs(deviationHz);
    const end = Math.min(sampleCount, Math.round((bitIndex + 1) * samplesPerBit));
    const increment = TWO_PI * frequency / rate;
    while (sample < end) {
      i[sample] = Math.cos(phase) * 0.8;
      q[sample] = Math.sin(phase) * 0.8;
      phase += increment;
      if (phase > Math.PI) phase -= TWO_PI;
      else if (phase < -Math.PI) phase += TWO_PI;
      sample += 1;
    }
  }
  return { i, q, sampleRate: rate, bitrate: baud, ric: Number(ric) >>> 0, message, words };
}
