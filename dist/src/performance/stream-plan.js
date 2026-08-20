/* MAYHEM RTL stream planning and adaptive visualization governor. SPDX-License-Identifier: GPL-2.0-or-later */

const PROFILES = new Set(["auto", "compatibility", "high-rate", "custom"]);

function clampInteger(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export function buildStreamPlan(settings = {}) {
  const sampleRate = Math.max(1, Number(settings.sampleRate) || 1_024_000);
  const requestedProfile = PROFILES.has(settings.performanceProfile) ? settings.performanceProfile : "auto";
  const custom = requestedProfile === "custom";

  let profile = requestedProfile;
  let blockSamples;
  let transferDepth;
  let processingQueueDepth;
  let displayRateHz;

  if (custom) {
    blockSamples = clampInteger(settings.usbBlockSamples, 8192, 65536, 32768);
    transferDepth = clampInteger(settings.transferDepth, 1, 8, 4);
    processingQueueDepth = clampInteger(settings.processingQueueDepth, 2, 8, Math.max(3, transferDepth));
    displayRateHz = clampInteger(settings.displayRateHz, 8, 60, 30);
  } else if (requestedProfile === "compatibility") {
    blockSamples = 32768;
    transferDepth = 4;
    processingQueueDepth = 4;
    displayRateHz = 20;
  } else if (requestedProfile === "high-rate") {
    blockSamples = 65536;
    transferDepth = 6;
    processingQueueDepth = 7;
    displayRateHz = 30;
  } else if (sampleRate >= 2_000_000) {
    profile = "auto-high-rate";
    blockSamples = 65536;
    transferDepth = 6;
    processingQueueDepth = 7;
    displayRateHz = 24;
  } else if (sampleRate >= 1_500_000) {
    profile = "auto-balanced";
    blockSamples = 49152;
    transferDepth = 5;
    processingQueueDepth = 6;
    displayRateHz = 25;
  } else {
    profile = "auto-conservative";
    blockSamples = 32768;
    transferDepth = 4;
    processingQueueDepth = 4;
    displayRateHz = 30;
  }

  const blockDurationMs = (blockSamples / sampleRate) * 1000;
  return Object.freeze({
    requestedProfile,
    profile,
    sampleRate,
    blockSamples,
    transferDepth,
    processingQueueDepth,
    displayRateHz,
    blockDurationMs,
    sharedMemoryPreferred: sampleRate >= 1_500_000
  });
}

const POLICIES = Object.freeze({
  normal: Object.freeze({ displayRateHz: 30, spectrumStride: 1 }),
  busy: Object.freeze({ displayRateHz: 20, spectrumStride: 2 }),
  critical: Object.freeze({ displayRateHz: 12, spectrumStride: 4 })
});

export class PerformanceGovernor {
  constructor() {
    this.level = "normal";
    this.normalWindows = 0;
    this.busyWindows = 0;
    this.previousDrops = 0;
    this.previousUnderruns = 0;
  }

  reset({ drops = 0, underruns = 0 } = {}) {
    this.level = "normal";
    this.normalWindows = 0;
    this.busyWindows = 0;
    this.previousDrops = Number(drops) || 0;
    this.previousUnderruns = Number(underruns) || 0;
    return this.snapshot();
  }

  observe({ queueRatio = 0, workerTimeMs = 0, blockDurationMs = Infinity, captureBacklog = 0, drops = 0, underruns = 0 } = {}) {
    const dropDelta = Math.max(0, (Number(drops) || 0) - this.previousDrops);
    const underrunDelta = Math.max(0, (Number(underruns) || 0) - this.previousUnderruns);
    this.previousDrops = Number(drops) || 0;
    this.previousUnderruns = Number(underruns) || 0;

    const workerRatio = Number.isFinite(blockDurationMs) && blockDurationMs > 0 ? (Number(workerTimeMs) || 0) / blockDurationMs : 0;
    const severe = dropDelta > 0 || queueRatio >= 0.85 || workerRatio >= 0.95 || captureBacklog >= 10 || underrunDelta >= 4;
    const busy = severe || queueRatio >= 0.5 || workerRatio >= 0.65 || captureBacklog >= 4 || underrunDelta > 0;

    if (severe) {
      this.level = "critical";
      this.normalWindows = 0;
      this.busyWindows = 0;
    } else if (busy) {
      this.normalWindows = 0;
      this.busyWindows += 1;
      if (this.level === "normal" && this.busyWindows >= 2) this.level = "busy";
      if (this.level === "critical" && this.busyWindows >= 3) this.level = "busy";
    } else {
      this.busyWindows = 0;
      this.normalWindows += 1;
      if (this.level === "critical" && this.normalWindows >= 4) this.level = "busy";
      else if (this.level === "busy" && this.normalWindows >= 6) this.level = "normal";
    }

    return this.snapshot({ queueRatio, workerRatio, captureBacklog, dropDelta, underrunDelta });
  }

  snapshot(extra = {}) {
    return { level: this.level, policy: POLICIES[this.level], ...extra };
  }
}

export function performanceLabel(level) {
  if (level === "critical") return "Protecting stream";
  if (level === "busy") return "Managing load";
  return "Healthy";
}
