export const APP_NAME = "MAYHEM RTL";
export const APP_VERSION = "0.2.0";
export const UPSTREAM_COMMIT = "44736b9ca844732e18f35e86eb5beece1d9c2c57";
export const WEBRTLSDR_COMMIT = "5699cec220cb0349e8f9144b7b71d3d03b5d9dbf";
export const PROJECT_SCHEMA_VERSION = 1;
export const CAPTURE_FORMAT = "CU8_INTERLEAVED_IQ";
export const HARDWARE_VERIFICATION = Object.freeze({
  state: "initial-hardware-bring-up",
  label: "Initial hardware bring-up successful",
  source: "user-reported physical test",
  observedAt: "2026-08-19",
  deviceProduct: "RTL2838UHIDIR",
  tunerFamily: "R820T/R820T2/R860 family",
  sampleRate: 1_024_000,
  observedDroppedSamples: 0,
  verifiedCapabilities: ["connect", "tune", "receive", "spectrum", "waterfall"],
  pendingChecks: ["retune while receiving", "gain change", "sample-rate change", "stop/restart", "hot unplug/reconnect", "30-minute soak", "multi-device matrix"]
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
  directSampling: "off",
  biasTee: false,
  mode: "easy",
  spanHz: 1_024_000,
  notes: ""
});
