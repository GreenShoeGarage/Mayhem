export const BroadcastBand = Object.freeze({ FM: "fm", AM: "am" });

export const BROADCAST_BANDS = Object.freeze({
  [BroadcastBand.FM]: Object.freeze({
    id: BroadcastBand.FM,
    label: "FM broadcast",
    startHz: 87_500_000,
    endHz: 108_000_000,
    defaultHz: 99_500_000,
    stepHz: 100_000,
    sampleRate: 1_024_000,
    modulation: "wfm",
    audioBandwidthHz: 15_000,
    deemphasisUs: 75,
    directSampling: "off",
    description: "87.5–108 MHz wideband frequency-modulation broadcast band."
  }),
  [BroadcastBand.AM]: Object.freeze({
    id: BroadcastBand.AM,
    label: "AM broadcast",
    startHz: 530_000,
    endHz: 1_710_000,
    defaultHz: 1_000_000,
    stepHz: 10_000,
    alternateStepHz: 9_000,
    sampleRate: 1_024_000,
    modulation: "am",
    audioBandwidthHz: 5_000,
    deemphasisUs: 75,
    directSampling: "q",
    description: "530–1710 kHz amplitude-modulation broadcast band preset; channel spacing varies by region."
  })
});

export function broadcastBandDefinition(band) {
  return BROADCAST_BANDS[band] ?? BROADCAST_BANDS[BroadcastBand.FM];
}

export function clampBroadcastFrequency(band, frequencyHz) {
  const definition = broadcastBandDefinition(band);
  const frequency = Number(frequencyHz);
  if (!Number.isFinite(frequency)) return definition.defaultHz;
  return Math.max(definition.startHz, Math.min(definition.endHz, Math.round(frequency)));
}

export function nextBroadcastFrequency(band, frequencyHz, direction = 1, stepOverride = null) {
  const definition = broadcastBandDefinition(band);
  const step = Math.max(1, Math.round(Number(stepOverride) || definition.stepHz));
  let next = clampBroadcastFrequency(band, frequencyHz) + Math.sign(direction || 1) * step;
  if (next > definition.endHz) next = definition.startHz;
  if (next < definition.startHz) next = definition.endHz;
  return next;
}

export function broadcastConfiguration(band, caps = {}, current = {}) {
  const definition = broadcastBandDefinition(band);
  const requestedFrequency = clampBroadcastFrequency(band, current.centerFrequencyHz ?? definition.defaultHz);
  const tunerMinimum = Number(caps.minFrequencyHz ?? 0);
  const needsDirectSampling = definition.id === BroadcastBand.AM && requestedFrequency < tunerMinimum;
  const directSamplingSupported = Boolean(caps.directSampling);
  const blocked = needsDirectSampling && !directSamplingSupported;
  return Object.freeze({
    band: definition.id,
    label: definition.label,
    frequencyHz: requestedFrequency,
    sampleRate: definition.sampleRate,
    modulation: definition.modulation,
    audioBandwidthHz: definition.audioBandwidthHz,
    deemphasisUs: definition.deemphasisUs,
    tuningStepHz: definition.stepHz,
    squelchDb: -140,
    directSampling: needsDirectSampling ? definition.directSampling : "off",
    directSamplingRequired: needsDirectSampling,
    directSamplingSupported,
    blocked,
    reason: blocked
      ? `The selected AM frequency is below the tuner's ${Math.round(tunerMinimum / 1e6)} MHz normal tuning floor and this device profile does not expose direct sampling.`
      : needsDirectSampling
        ? "This receiver needs RTL2832U direct sampling for medium-wave AM. Antenna/input hardware must support that path."
        : "The tuner can receive this broadcast band through its normal RF path."
  });
}
