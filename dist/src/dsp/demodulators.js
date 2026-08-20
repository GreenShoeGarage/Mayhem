/*
 * MAYHEM RTL receive-audio demodulation kernels.
 *
 * IQ stays in the processing worker and only reduced audio leaves the DSP path.
 * v0.8.2 extends the analog-audio family with USB, LSB and CW while retaining
 * deterministic fixture coverage and bounded state across worker blocks.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const TWO_PI = Math.PI * 2;

export const DemodulationMode = Object.freeze({
  WFM: "wfm",
  NFM: "nfm",
  AM: "am",
  USB: "usb",
  LSB: "lsb",
  CW: "cw"
});

export const DEMODULATION_MODES = Object.freeze(Object.values(DemodulationMode));

const DEFAULTS = Object.freeze({
  mode: DemodulationMode.WFM,
  outputRate: 48_000,
  audioBandwidthHz: 15_000,
  deemphasisUs: 75,
  ssbLowCutHz: 300,
  ritHz: 0,
  cwPitchHz: 700,
  agcMode: "medium"
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function onePoleAlpha(cutoffHz, sampleRate) {
  const cutoff = clamp(Number(cutoffHz) || 1, 1, sampleRate * 0.45);
  return 1 - Math.exp(-TWO_PI * cutoff / sampleRate);
}

function sinc(value) {
  if (Math.abs(value) < 1e-12) return 1;
  return Math.sin(Math.PI * value) / (Math.PI * value);
}

function normalizedLowpass(taps, cutoffHz, sampleRate) {
  const count = Math.max(17, Math.round(taps) | 1);
  const cutoff = clamp(Number(cutoffHz), 20, sampleRate * 0.45);
  const center = (count - 1) / 2;
  const coeffs = new Float64Array(count);
  let sum = 0;
  for (let n = 0; n < count; n += 1) {
    const m = n - center;
    const ideal = (2 * cutoff / sampleRate) * sinc(2 * cutoff * m / sampleRate);
    const window = 0.54 - 0.46 * Math.cos(TWO_PI * n / (count - 1));
    coeffs[n] = ideal * window;
    sum += coeffs[n];
  }
  if (Math.abs(sum) > 1e-12) for (let n = 0; n < count; n += 1) coeffs[n] /= sum;
  return coeffs;
}

function complexBandpass(taps, lowHz, highHz, sampleRate, side = 1) {
  const low = clamp(Math.abs(Number(lowHz) || 0), 0, sampleRate * 0.4);
  const high = clamp(Math.max(low + 50, Math.abs(Number(highHz) || 2400)), low + 50, sampleRate * 0.45);
  const bandwidth = high - low;
  const centerHz = side * ((high + low) / 2);
  const prototype = normalizedLowpass(taps, bandwidth / 2, sampleRate);
  const center = (prototype.length - 1) / 2;
  const real = new Float64Array(prototype.length);
  const imag = new Float64Array(prototype.length);
  for (let n = 0; n < prototype.length; n += 1) {
    const phase = TWO_PI * centerHz * (n - center) / sampleRate;
    real[n] = prototype[n] * Math.cos(phase);
    imag[n] = prototype[n] * Math.sin(phase);
  }
  return { real, imag };
}

function agcConstants(mode, sampleRate) {
  if (mode === "off") return null;
  const profile = mode === "fast" ? { attack: 0.004, release: 0.08 } : mode === "slow" ? { attack: 0.02, release: 0.8 } : { attack: 0.01, release: 0.25 };
  return {
    attackAlpha: 1 - Math.exp(-1 / Math.max(1, sampleRate * profile.attack)),
    releaseAlpha: 1 - Math.exp(-1 / Math.max(1, sampleRate * profile.release))
  };
}

export function recommendedAudioBandwidth(mode) {
  if (mode === DemodulationMode.WFM) return 15_000;
  if (mode === DemodulationMode.NFM) return 3_500;
  if (mode === DemodulationMode.USB || mode === DemodulationMode.LSB) return 2_400;
  if (mode === DemodulationMode.CW) return 500;
  return 5_000;
}

export class AudioDemodulator {
  constructor(options = {}) {
    this.settings = { ...DEFAULTS, ...options };
    this.filterKey = "";
    this.reset();
  }

  configure(options = {}) {
    const previousMode = this.settings.mode;
    const previousFilterKey = `${this.settings.audioBandwidthHz}:${this.settings.ssbLowCutHz}`;
    this.settings = { ...this.settings, ...options };
    const nextFilterKey = `${this.settings.audioBandwidthHz}:${this.settings.ssbLowCutHz}`;
    if ((options.mode && options.mode !== previousMode) || previousFilterKey !== nextFilterKey) this.reset();
  }

  reset() {
    this.prevI = 1;
    this.prevQ = 0;
    this.havePrevious = false;
    this.decimI = 0;
    this.decimQ = 0;
    this.decimCount = 0;
    this.audioLowpass = 0;
    this.deemphasis = 0;
    this.amDc = 0;
    this.resamplePhase = 0;
    this.lastInputRate = 0;
    this.ritPhase = 0;
    this.cwPhase = 0;
    this.agcEnvelope = 0.02;
    this.agcGain = 1;
    this.firI = new Float64Array(129);
    this.firQ = new Float64Array(129);
    this.firIndex = 0;
    this.filter = null;
    this.filterKey = "";
  }

  #ensureFilter(mode, iqRate) {
    const bandwidth = clamp(Number(this.settings.audioBandwidthHz) || recommendedAudioBandwidth(mode), 100, 6_000);
    const lowCut = mode === DemodulationMode.CW ? 0 : clamp(Number(this.settings.ssbLowCutHz) || 300, 0, Math.max(0, bandwidth - 100));
    const highCut = mode === DemodulationMode.CW ? bandwidth / 2 : lowCut + bandwidth;
    const key = `${mode}:${iqRate.toFixed(3)}:${lowCut}:${highCut}`;
    if (this.filterKey === key && this.filter) return;
    if (mode === DemodulationMode.USB) this.filter = complexBandpass(81, lowCut, highCut, iqRate, +1);
    else if (mode === DemodulationMode.LSB) this.filter = complexBandpass(81, lowCut, highCut, iqRate, -1);
    else {
      const real = normalizedLowpass(81, Math.max(100, bandwidth / 2), iqRate);
      this.filter = { real, imag: new Float64Array(real.length) };
    }
    this.firI = new Float64Array(this.filter.real.length);
    this.firQ = new Float64Array(this.filter.real.length);
    this.firIndex = 0;
    this.filterKey = key;
  }

  #filterComplex(i, q) {
    const filter = this.filter;
    const length = filter.real.length;
    this.firI[this.firIndex] = i;
    this.firQ[this.firIndex] = q;
    let outI = 0;
    let outQ = 0;
    let cursor = this.firIndex;
    for (let tap = 0; tap < length; tap += 1) {
      const xr = this.firI[cursor];
      const xq = this.firQ[cursor];
      const hr = filter.real[tap];
      const hq = filter.imag[tap];
      outI += xr * hr - xq * hq;
      outQ += xr * hq + xq * hr;
      cursor -= 1;
      if (cursor < 0) cursor = length - 1;
    }
    this.firIndex += 1;
    if (this.firIndex >= length) this.firIndex = 0;
    return [outI, outQ];
  }

  #applyAgc(sample, rate) {
    const mode = String(this.settings.agcMode || "off");
    const constants = agcConstants(mode, rate);
    if (!constants) return sample;
    const magnitude = Math.abs(sample);
    const alpha = magnitude > this.agcEnvelope ? constants.attackAlpha : constants.releaseAlpha;
    this.agcEnvelope += alpha * (magnitude - this.agcEnvelope);
    const desired = clamp(0.24 / Math.max(0.005, this.agcEnvelope), 0.15, 18);
    this.agcGain += 0.02 * (desired - this.agcGain);
    return clamp(sample * this.agcGain, -1, 1);
  }

  process(iSamples, qSamples, inputRate) {
    if (!(iSamples instanceof Float32Array) || !(qSamples instanceof Float32Array)) throw new TypeError("Audio demodulator requires Float32Array IQ inputs.");
    if (iSamples.length !== qSamples.length) throw new RangeError("I and Q input lengths must match.");
    const rate = Number(inputRate);
    if (!Number.isFinite(rate) || rate <= 0 || iSamples.length === 0) return new Float32Array(0);
    if (this.lastInputRate && Math.abs(this.lastInputRate - rate) > 0.5) this.reset();
    this.lastInputRate = rate;

    const mode = DEMODULATION_MODES.includes(this.settings.mode) ? this.settings.mode : DemodulationMode.WFM;
    const ssbFamily = mode === DemodulationMode.USB || mode === DemodulationMode.LSB || mode === DemodulationMode.CW;
    const targetIqRate = mode === DemodulationMode.WFM ? 420_000 : ssbFamily ? 48_000 : 120_000;
    const decimation = Math.max(1, Math.floor(rate / targetIqRate));
    const iqRate = rate / decimation;
    const outputRate = clamp(Number(this.settings.outputRate) || 48_000, 8_000, 96_000);
    const lowpassAlpha = onePoleAlpha(this.settings.audioBandwidthHz || recommendedAudioBandwidth(mode), iqRate);
    const deemphasisTau = Math.max(1e-6, (Number(this.settings.deemphasisUs) || 75) * 1e-6);
    const deemphasisAlpha = 1 - Math.exp(-1 / (iqRate * deemphasisTau));
    const amDcAlpha = onePoleAlpha(20, iqRate);
    const deviationHz = mode === DemodulationMode.WFM ? 75_000 : 5_000;
    const fmScale = iqRate / (TWO_PI * deviationHz);
    const ritHz = clamp(Number(this.settings.ritHz) || 0, -10_000, 10_000);
    const ritIncrement = -TWO_PI * ritHz / iqRate;
    const cwPitch = clamp(Number(this.settings.cwPitchHz) || 700, 200, 1500);
    const cwIncrement = TWO_PI * cwPitch / iqRate;
    if (ssbFamily) this.#ensureFilter(mode, iqRate);
    const output = [];

    for (let index = 0; index < iSamples.length; index += 1) {
      this.decimI += iSamples[index];
      this.decimQ += qSamples[index];
      this.decimCount += 1;
      if (this.decimCount < decimation) continue;

      let currentI = this.decimI / this.decimCount;
      let currentQ = this.decimQ / this.decimCount;
      this.decimI = 0;
      this.decimQ = 0;
      this.decimCount = 0;

      let audio = 0;
      if (ssbFamily) {
        if (ritHz) {
          const c = Math.cos(this.ritPhase);
          const s = Math.sin(this.ritPhase);
          const rotatedI = currentI * c - currentQ * s;
          const rotatedQ = currentI * s + currentQ * c;
          currentI = rotatedI;
          currentQ = rotatedQ;
          this.ritPhase += ritIncrement;
          if (this.ritPhase > Math.PI) this.ritPhase -= TWO_PI;
          else if (this.ritPhase < -Math.PI) this.ritPhase += TWO_PI;
        }
        const [filteredI, filteredQ] = this.#filterComplex(currentI, currentQ);
        if (mode === DemodulationMode.CW) {
          const c = Math.cos(this.cwPhase);
          const s = Math.sin(this.cwPhase);
          audio = filteredI * c - filteredQ * s;
          this.cwPhase += cwIncrement;
          if (this.cwPhase > Math.PI) this.cwPhase -= TWO_PI;
        } else {
          audio = filteredI;
        }
        audio = this.#applyAgc(audio, iqRate);
      } else if (mode === DemodulationMode.AM) {
        const magnitude = Math.hypot(currentI, currentQ);
        this.amDc += amDcAlpha * (magnitude - this.amDc);
        audio = (magnitude - this.amDc) * 2.2;
      } else {
        if (!this.havePrevious) {
          this.prevI = currentI;
          this.prevQ = currentQ;
          this.havePrevious = true;
          continue;
        }
        const real = this.prevI * currentI + this.prevQ * currentQ;
        const imag = this.prevI * currentQ - this.prevQ * currentI;
        audio = Math.atan2(imag, real) * fmScale;
        this.prevI = currentI;
        this.prevQ = currentQ;
      }

      let filtered = audio;
      if (!ssbFamily) {
        this.audioLowpass += lowpassAlpha * (audio - this.audioLowpass);
        filtered = this.audioLowpass;
        if (mode === DemodulationMode.WFM) {
          this.deemphasis += deemphasisAlpha * (filtered - this.deemphasis);
          filtered = this.deemphasis;
        }
      }

      this.resamplePhase += outputRate;
      if (this.resamplePhase >= iqRate) {
        this.resamplePhase -= iqRate;
        output.push(clamp(filtered, -1, 1));
      }
    }

    return Float32Array.from(output);
  }
}

export function rms(samples) {
  if (!samples?.length) return 0;
  let power = 0;
  for (let index = 0; index < samples.length; index += 1) power += samples[index] * samples[index];
  return Math.sqrt(power / samples.length);
}
