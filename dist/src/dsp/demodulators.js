/*
 * MAYHEM RTL receive-audio demodulation kernels.
 *
 * These browser-port kernels preserve the receiver behavior boundary used by
 * mayhem-b200: IQ stays in the processing worker and only reduced audio leaves
 * the DSP path. They are intentionally small and deterministic so they can be
 * fixture-tested outside the browser while the deeper upstream receiver-model
 * linkage continues.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const TWO_PI = Math.PI * 2;

export const DemodulationMode = Object.freeze({
  WFM: "wfm",
  NFM: "nfm",
  AM: "am"
});

const DEFAULTS = Object.freeze({
  mode: DemodulationMode.WFM,
  outputRate: 48_000,
  audioBandwidthHz: 15_000,
  deemphasisUs: 75
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function onePoleAlpha(cutoffHz, sampleRate) {
  const cutoff = clamp(Number(cutoffHz) || 1, 1, sampleRate * 0.45);
  return 1 - Math.exp(-TWO_PI * cutoff / sampleRate);
}

export function recommendedAudioBandwidth(mode) {
  if (mode === DemodulationMode.WFM) return 15_000;
  if (mode === DemodulationMode.NFM) return 3_500;
  return 5_000;
}

export class AudioDemodulator {
  constructor(options = {}) {
    this.settings = { ...DEFAULTS, ...options };
    this.reset();
  }

  configure(options = {}) {
    const previousMode = this.settings.mode;
    this.settings = { ...this.settings, ...options };
    if (options.mode && options.mode !== previousMode) this.reset();
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
  }

  process(iSamples, qSamples, inputRate) {
    if (!(iSamples instanceof Float32Array) || !(qSamples instanceof Float32Array)) throw new TypeError("Audio demodulator requires Float32Array IQ inputs.");
    if (iSamples.length !== qSamples.length) throw new RangeError("I and Q input lengths must match.");
    const rate = Number(inputRate);
    if (!Number.isFinite(rate) || rate <= 0 || iSamples.length === 0) return new Float32Array(0);
    if (this.lastInputRate && Math.abs(this.lastInputRate - rate) > 0.5) this.reset();
    this.lastInputRate = rate;

    const mode = this.settings.mode;
    const targetIqRate = mode === DemodulationMode.WFM ? 420_000 : 120_000;
    const decimation = Math.max(1, Math.floor(rate / targetIqRate));
    const iqRate = rate / decimation;
    const outputRate = clamp(Number(this.settings.outputRate) || 48_000, 8_000, 96_000);
    const lowpassAlpha = onePoleAlpha(this.settings.audioBandwidthHz || recommendedAudioBandwidth(mode), iqRate);
    const deemphasisTau = Math.max(1e-6, (Number(this.settings.deemphasisUs) || 75) * 1e-6);
    const deemphasisAlpha = 1 - Math.exp(-1 / (iqRate * deemphasisTau));
    const amDcAlpha = onePoleAlpha(20, iqRate);
    const deviationHz = mode === DemodulationMode.WFM ? 75_000 : 5_000;
    const fmScale = iqRate / (TWO_PI * deviationHz);
    const output = [];

    for (let index = 0; index < iSamples.length; index += 1) {
      this.decimI += iSamples[index];
      this.decimQ += qSamples[index];
      this.decimCount += 1;
      if (this.decimCount < decimation) continue;

      const currentI = this.decimI / this.decimCount;
      const currentQ = this.decimQ / this.decimCount;
      this.decimI = 0;
      this.decimQ = 0;
      this.decimCount = 0;

      let audio = 0;
      if (mode === DemodulationMode.AM) {
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

      this.audioLowpass += lowpassAlpha * (audio - this.audioLowpass);
      let filtered = this.audioLowpass;
      if (mode === DemodulationMode.WFM) {
        this.deemphasis += deemphasisAlpha * (filtered - this.deemphasis);
        filtered = this.deemphasis;
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
