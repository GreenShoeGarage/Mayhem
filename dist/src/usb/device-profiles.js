export const R8XX_GAIN_STEPS_DB = Object.freeze([
  0.0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7,
  20.7, 22.9, 25.4, 28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2,
  42.1, 43.4, 43.9, 44.5, 48.0, 49.6
]);

export const SAMPLE_RATE_PRESETS = Object.freeze([1_024_000, 1_200_000, 1_800_000, 2_048_000, 2_400_000]);

export function nearestGain(value) {
  const target = Number(value);
  return R8XX_GAIN_STEPS_DB.reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best, R8XX_GAIN_STEPS_DB[0]);
}

export function conservativeCaps(device) {
  const directSamplingCapable = true;
  const blogV4 = String(device?.tunerName ?? device?.deviceInfo?.tuner ?? "").includes("Blog V4");
  const minimumFrequencyHz = blogV4 ? 0 : 28_800_000;
  return {
    hasRx: true,
    hasTx: false,
    fullDuplex: false,
    minFrequencyHz: minimumFrequencyHz,
    maxFrequencyHz: 1_766_000_000,
    minSampleRate: 225_001,
    maxSampleRate: 3_200_000,
    sampleRatePresets: [...SAMPLE_RATE_PRESETS],
    gainStepsDb: [...R8XX_GAIN_STEPS_DB],
    directSampling: directSamplingCapable,
    biasTee: blogV4,
    tuner: device?.tunerName ?? device?.deviceInfo?.tuner ?? "R8xx tuner family",
    transport: "WebUSB"
  };
}
