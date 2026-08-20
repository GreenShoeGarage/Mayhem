export function percentile(values, fraction) {
  if (!values?.length) return null;
  const sorted = Array.from(values, Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

export function estimateNoiseFloorDb(spectrum, { percentileFraction = 0.35, ignoreCenterBins = 3 } = {}) {
  if (!spectrum?.length) return null;
  const center = Math.floor(spectrum.length / 2);
  const values = [];
  for (let index = 0; index < spectrum.length; index += 1) {
    if (Math.abs(index - center) <= ignoreCenterBins) continue;
    const value = Number(spectrum[index]);
    if (Number.isFinite(value)) values.push(value);
  }
  return percentile(values, percentileFraction);
}

export function binFrequency(index, length, centerFrequencyHz, sampleRate) {
  if (!Number.isFinite(centerFrequencyHz) || !Number.isFinite(sampleRate) || length <= 1) return Number(centerFrequencyHz) || 0;
  return centerFrequencyHz + ((index / (length - 1)) - 0.5) * sampleRate;
}

export function findSpectrumPeaks(spectrum, {
  centerFrequencyHz = 0,
  sampleRate = 1,
  thresholdDbfs = -60,
  minProminenceDb = 6,
  minSeparationHz = 12_500,
  maxPeaks = 20,
  ignoreCenterBins = 3
} = {}) {
  if (!spectrum?.length || spectrum.length < 5) return [];
  const noiseFloorDb = estimateNoiseFloorDb(spectrum, { ignoreCenterBins }) ?? -140;
  const required = Math.max(Number(thresholdDbfs), noiseFloorDb + Number(minProminenceDb));
  const center = Math.floor(spectrum.length / 2);
  const candidates = [];
  for (let index = 2; index < spectrum.length - 2; index += 1) {
    if (Math.abs(index - center) <= ignoreCenterBins) continue;
    const value = Number(spectrum[index]);
    if (!Number.isFinite(value) || value < required) continue;
    if (value < spectrum[index - 1] || value < spectrum[index + 1]) continue;
    if (value < spectrum[index - 2] || value < spectrum[index + 2]) continue;
    const shoulder = Math.max(
      Math.min(spectrum[index - 2], spectrum[index - 1]),
      Math.min(spectrum[index + 1], spectrum[index + 2])
    );
    const prominenceDb = value - shoulder;
    if (prominenceDb < Math.max(1, minProminenceDb / 3)) continue;
    candidates.push({
      index,
      frequencyHz: binFrequency(index, spectrum.length, centerFrequencyHz, sampleRate),
      levelDbfs: value,
      prominenceDb,
      noiseFloorDb,
      snrDb: value - noiseFloorDb
    });
  }
  candidates.sort((a, b) => b.levelDbfs - a.levelDbfs);
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.some((entry) => Math.abs(entry.frequencyHz - candidate.frequencyHz) < minSeparationHz)) continue;
    accepted.push(candidate);
    if (accepted.length >= maxPeaks) break;
  }
  return accepted.sort((a, b) => a.frequencyHz - b.frequencyHz);
}

export class LevelHistory {
  constructor({ maxPoints = 600 } = {}) {
    this.maxPoints = Math.max(30, Math.round(maxPoints));
    this.points = [];
    this.peakDbfs = -Infinity;
    this.minimumDbfs = Infinity;
  }
  add(levelDbfs, timestampMs = Date.now()) {
    const level = Number(levelDbfs);
    if (!Number.isFinite(level)) return;
    this.points.push({ t: Number(timestampMs) || Date.now(), levelDbfs: level });
    if (this.points.length > this.maxPoints) this.points.splice(0, this.points.length - this.maxPoints);
    this.peakDbfs = Math.max(this.peakDbfs, level);
    this.minimumDbfs = Math.min(this.minimumDbfs, level);
  }
  clear() { this.points = []; this.peakDbfs = -Infinity; this.minimumDbfs = Infinity; }
  snapshot() {
    const latest = this.points.at(-1)?.levelDbfs ?? null;
    const mean = this.points.length ? this.points.reduce((sum, p) => sum + p.levelDbfs, 0) / this.points.length : null;
    return { points: this.points.slice(), latestDbfs: latest, meanDbfs: mean, peakDbfs: Number.isFinite(this.peakDbfs) ? this.peakDbfs : null, minimumDbfs: Number.isFinite(this.minimumDbfs) ? this.minimumDbfs : null };
  }
}

export class ActivityDetector extends EventTarget {
  constructor({ thresholdDbfs = -50, hysteresisDb = 3, minActiveMs = 80, releaseMs = 250 } = {}) {
    super();
    this.configure({ thresholdDbfs, hysteresisDb, minActiveMs, releaseMs });
    this.reset();
  }
  configure(settings = {}) {
    if (Number.isFinite(settings.thresholdDbfs)) this.thresholdDbfs = Number(settings.thresholdDbfs);
    if (Number.isFinite(settings.hysteresisDb)) this.hysteresisDb = Math.max(0, Number(settings.hysteresisDb));
    if (Number.isFinite(settings.minActiveMs)) this.minActiveMs = Math.max(0, Number(settings.minActiveMs));
    if (Number.isFinite(settings.releaseMs)) this.releaseMs = Math.max(0, Number(settings.releaseMs));
  }
  reset() { this.active = false; this.candidateAt = 0; this.releaseAt = 0; this.startedAt = 0; this.events = []; this.peakDbfs = -Infinity; }
  process(levelDbfs, timestampMs = Date.now()) {
    const level = Number(levelDbfs); const now = Number(timestampMs) || Date.now();
    if (!Number.isFinite(level)) return this.snapshot();
    if (!this.active) {
      if (level >= this.thresholdDbfs) {
        if (!this.candidateAt) this.candidateAt = now;
        if (now - this.candidateAt >= this.minActiveMs) {
          this.active = true; this.startedAt = this.candidateAt; this.peakDbfs = level; this.releaseAt = 0;
          this.dispatchEvent(new CustomEvent("start", { detail: { startedAt: this.startedAt, levelDbfs: level } }));
        }
      } else this.candidateAt = 0;
    } else {
      this.peakDbfs = Math.max(this.peakDbfs, level);
      if (level < this.thresholdDbfs - this.hysteresisDb) {
        if (!this.releaseAt) this.releaseAt = now;
        if (now - this.releaseAt >= this.releaseMs) {
          const event = { startedAt: this.startedAt, endedAt: now, durationMs: Math.max(0, now - this.startedAt), peakDbfs: this.peakDbfs };
          this.events.unshift(event); this.events = this.events.slice(0, 200);
          this.active = false; this.candidateAt = 0; this.releaseAt = 0; this.startedAt = 0; this.peakDbfs = -Infinity;
          this.dispatchEvent(new CustomEvent("end", { detail: event }));
        }
      } else this.releaseAt = 0;
    }
    return this.snapshot();
  }
  snapshot() { return { active: this.active, thresholdDbfs: this.thresholdDbfs, hysteresisDb: this.hysteresisDb, minActiveMs: this.minActiveMs, releaseMs: this.releaseMs, events: this.events.slice(), startedAt: this.startedAt || null, peakDbfs: Number.isFinite(this.peakDbfs) ? this.peakDbfs : null }; }
}

export class WidebandSweepAccumulator {
  constructor({ startHz, endHz, bins = 720 } = {}) {
    this.startHz = Number(startHz); this.endHz = Number(endHz); this.bins = Math.max(120, Math.round(bins));
    this.values = new Float32Array(this.bins); this.values.fill(-160);
    this.hits = new Uint16Array(this.bins); this.slices = 0;
  }
  addSpectrum({ spectrum, frequency, sampleRate }) {
    if (!spectrum?.length || !Number.isFinite(frequency) || !Number.isFinite(sampleRate) || this.endHz <= this.startHz) return;
    for (let index = 0; index < spectrum.length; index += 1) {
      const hz = binFrequency(index, spectrum.length, frequency, sampleRate);
      if (hz < this.startHz || hz > this.endHz) continue;
      const target = Math.max(0, Math.min(this.bins - 1, Math.round((hz - this.startHz) / (this.endHz - this.startHz) * (this.bins - 1))));
      const value = Number(spectrum[index]);
      if (!Number.isFinite(value)) continue;
      if (!this.hits[target] || value > this.values[target]) this.values[target] = value;
      this.hits[target] += 1;
    }
    this.slices += 1;
  }
  snapshot() { return { startHz: this.startHz, endHz: this.endHz, bins: this.bins, values: this.values.slice(), hits: this.hits.slice(), slices: this.slices }; }
}

export function relativeStrength(levelDbfs, floorDbfs = -100, ceilingDbfs = -20) {
  const level = Number(levelDbfs);
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(1, (level - floorDbfs) / Math.max(1, ceilingDbfs - floorDbfs)));
}

export function nextRangeFrequency(currentHz, { startHz, endHz, stepHz } = {}) {
  const start = Number(startHz);
  const end = Number(endHz);
  const step = Math.max(1, Number(stepHz) || 1);
  const current = Number(currentHz);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  if (!Number.isFinite(current) || current < start || current >= end) return start;
  const next = current + step;
  return next > end ? start : next;
}
