export const APP_NAME = "MAYHEM RTL";
export const APP_VERSION = "0.8.2";
export const UPSTREAM_COMMIT = "44736b9ca844732e18f35e86eb5beece1d9c2c57";
export const WEBRTLSDR_COMMIT = "5699cec220cb0349e8f9144b7b71d3d03b5d9dbf";
export const PROJECT_SCHEMA_VERSION = 5;
export const CAPTURE_FORMAT = "CU8_INTERLEAVED_IQ";
export const HARDWARE_VERIFICATION = Object.freeze({
  state: "reference-hardware-validated",
  label: "Receiver/high-rate reference validation successful; audio output re-check pending",
  source: "user-reported physical test",
  observedAt: "2026-08-20",
  deviceProduct: "RTL2838UHIDIR",
  tunerFamily: "R820T/R820T2/R860 family",
  sampleRate: 2_400_000,
  validatedSampleRates: [1_024_000, 2_400_000],
  observedDroppedSamples: 0,
  verifiedCapabilities: ["connect", "tune", "receive", "spectrum", "waterfall", "retune while receiving", "gain change", "sample-rate change", "stop/restart", "hot unplug/reconnect", "30-minute 1.024 Msps soak", "2.4 Msps / 60-minute soak", "2.4 Msps receive + capture", "SharedArrayBuffer stream path", "bounded long-run memory/queue behavior"],
  pendingChecks: ["v0.8.2 USB/LSB/CW on-air validation", "Amateur Radio HF direct-sampling review", "multi-device matrix", "R828D hardware", "R860 hardware", "cross-browser hardware matrix"]
});

export const DEFAULT_SETTINGS = Object.freeze({
  centerFrequencyHz: 100_000_000,
  sampleRate: 1_024_000,
  gainMode: "automatic",
  gainDb: 28.0,
  ppm: 0,
  fftSize: 1024,
  fftWindow: "hann",
  averaging: 0.35,
  peakHold: false,
  referenceLevelDb: 0,
  dynamicRangeDb: 90,
  waterfallSpeed: 30,
  usbBlockSamples: 32768,
  transferDepth: 4,
  processingQueueDepth: 4,
  performanceProfile: "auto",
  displayRateHz: 30,
  directSampling: "off",
  biasTee: false,
  mode: "easy",
  spanHz: 1_024_000,
  notes: "",
  modulation: "wfm",
  audioEnabled: false,
  audioOutputRate: 48000,
  audioBandwidthHz: 15000,
  deemphasisUs: 75,
  squelchDb: -55,
  volume: 0.75,
  mute: false,
  broadcastBand: "fm",
  broadcastStepHz: 100_000,
  scannerStartHz: 88_000_000,
  scannerEndHz: 108_000_000,
  scannerStepHz: 100_000,
  scannerDwellMs: 180,
  scannerThresholdDbfs: -45,
  scannerHoldOnHit: true,
  scannerHoldMs: 900,
  amateurBand: "20m",
  amateurStepHz: 100,
  ssbLowCutHz: 300,
  ritHz: 0,
  cwPitchHz: 700,
  agcMode: "medium"
});
