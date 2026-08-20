export const AmateurMode = Object.freeze({
  LSB: "lsb",
  USB: "usb",
  CW: "cw",
  AM: "am",
  NFM: "nfm"
});

export const AMATEUR_BANDS = Object.freeze({
  "160m": Object.freeze({ id: "160m", label: "160 m", startHz: 1_800_000, endHz: 2_000_000, defaultHz: 1_900_000, defaultMode: AmateurMode.LSB, note: "HF voice commonly uses LSB; actual allocations vary by country." }),
  "80m": Object.freeze({ id: "80m", label: "80 m", startHz: 3_500_000, endHz: 4_000_000, defaultHz: 3_900_000, defaultMode: AmateurMode.LSB, note: "HF voice commonly uses LSB; actual allocations vary by country." }),
  "60m": Object.freeze({ id: "60m", label: "60 m", startHz: 5_330_500, endHz: 5_405_000, defaultHz: 5_357_000, defaultMode: AmateurMode.USB, note: "60 m operation is channelized/restricted in many regions. This is only a tuning convenience preset." }),
  "40m": Object.freeze({ id: "40m", label: "40 m", startHz: 7_000_000, endHz: 7_300_000, defaultHz: 7_200_000, defaultMode: AmateurMode.LSB, note: "HF voice commonly uses LSB; actual allocations vary by country." }),
  "30m": Object.freeze({ id: "30m", label: "30 m", startHz: 10_100_000, endHz: 10_150_000, defaultHz: 10_120_000, defaultMode: AmateurMode.CW, note: "30 m is commonly used for CW/data rather than voice in many regions." }),
  "20m": Object.freeze({ id: "20m", label: "20 m", startHz: 14_000_000, endHz: 14_350_000, defaultHz: 14_200_000, defaultMode: AmateurMode.USB, note: "HF voice commonly uses USB above 10 MHz; actual allocations vary by country." }),
  "17m": Object.freeze({ id: "17m", label: "17 m", startHz: 18_068_000, endHz: 18_168_000, defaultHz: 18_130_000, defaultMode: AmateurMode.USB, note: "HF voice commonly uses USB; actual allocations vary by country." }),
  "15m": Object.freeze({ id: "15m", label: "15 m", startHz: 21_000_000, endHz: 21_450_000, defaultHz: 21_300_000, defaultMode: AmateurMode.USB, note: "HF voice commonly uses USB; actual allocations vary by country." }),
  "12m": Object.freeze({ id: "12m", label: "12 m", startHz: 24_890_000, endHz: 24_990_000, defaultHz: 24_940_000, defaultMode: AmateurMode.USB, note: "HF voice commonly uses USB; actual allocations vary by country." }),
  "10m": Object.freeze({ id: "10m", label: "10 m", startHz: 28_000_000, endHz: 29_700_000, defaultHz: 28_400_000, defaultMode: AmateurMode.USB, note: "The low edge may require direct sampling on an ordinary R8xx RTL-SDR whose normal tuner floor is above the selected frequency." }),
  "6m": Object.freeze({ id: "6m", label: "6 m", startHz: 50_000_000, endHz: 54_000_000, defaultHz: 50_125_000, defaultMode: AmateurMode.USB, note: "SSB activity commonly uses USB; band plans vary." }),
  "2m": Object.freeze({ id: "2m", label: "2 m", startHz: 144_000_000, endHz: 148_000_000, defaultHz: 146_520_000, defaultMode: AmateurMode.NFM, note: "NFM is common for simplex/repeater voice; SSB activity commonly uses USB." }),
  "1.25m": Object.freeze({ id: "1.25m", label: "1.25 m", startHz: 222_000_000, endHz: 225_000_000, defaultHz: 223_500_000, defaultMode: AmateurMode.NFM, note: "Availability and band edges vary significantly by country." }),
  "70cm": Object.freeze({ id: "70cm", label: "70 cm", startHz: 420_000_000, endHz: 450_000_000, defaultHz: 446_000_000, defaultMode: AmateurMode.NFM, note: "NFM is common for simplex/repeater voice; regional band edges differ." })
});

export const AMATEUR_BAND_ORDER = Object.freeze(["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "1.25m", "70cm"]);

export function amateurBandDefinition(band) {
  return AMATEUR_BANDS[band] ?? AMATEUR_BANDS["20m"];
}

export function amateurModeDefaults(mode) {
  if (mode === AmateurMode.CW) return Object.freeze({ modulation: mode, audioBandwidthHz: 500, ssbLowCutHz: 0, tuningStepHz: 50, squelchDb: -140, cwPitchHz: 700, agcMode: "medium" });
  if (mode === AmateurMode.USB || mode === AmateurMode.LSB) return Object.freeze({ modulation: mode, audioBandwidthHz: 2400, ssbLowCutHz: 300, tuningStepHz: 100, squelchDb: -140, cwPitchHz: 700, agcMode: "medium" });
  if (mode === AmateurMode.AM) return Object.freeze({ modulation: mode, audioBandwidthHz: 5000, ssbLowCutHz: 0, tuningStepHz: 1000, squelchDb: -140, cwPitchHz: 700, agcMode: "off" });
  return Object.freeze({ modulation: AmateurMode.NFM, audioBandwidthHz: 3500, ssbLowCutHz: 0, tuningStepHz: 5000, squelchDb: -55, cwPitchHz: 700, agcMode: "off" });
}

export function clampAmateurFrequency(band, frequencyHz) {
  const definition = amateurBandDefinition(band);
  const value = Number(frequencyHz);
  if (!Number.isFinite(value)) return definition.defaultHz;
  return Math.max(definition.startHz, Math.min(definition.endHz, Math.round(value)));
}

export function amateurFrequencyPath(frequencyHz, caps = {}) {
  const frequency = Math.max(0, Math.round(Number(frequencyHz) || 0));
  const tunerMinimum = Math.max(0, Number(caps.minFrequencyHz ?? 0));
  const requiresDirectSampling = frequency < tunerMinimum;
  const directSamplingSupported = Boolean(caps.directSampling);
  const blocked = requiresDirectSampling && !directSamplingSupported;
  return Object.freeze({
    frequencyHz: frequency,
    directSampling: requiresDirectSampling ? "q" : "off",
    directSamplingRequired: requiresDirectSampling,
    directSamplingSupported,
    blocked,
    reason: blocked
      ? `The selected frequency is below the tuner's ${Math.round(tunerMinimum / 1e6)} MHz normal tuning floor and this receiver profile does not expose RTL2832U direct sampling.`
      : requiresDirectSampling
        ? "This frequency is below the normal R8xx tuner range, so MAYHEM RTL will use the RTL2832U Q-branch direct-sampling path. Antenna/input hardware must support that path."
        : "This frequency is reachable through the receiver's normal tuner path."
  });
}

export function amateurConfiguration(band, caps = {}, current = {}, { preserveMode = false } = {}) {
  const definition = amateurBandDefinition(band);
  const frequencyHz = clampAmateurFrequency(band, current.centerFrequencyHz ?? definition.defaultHz);
  const mode = preserveMode && Object.values(AmateurMode).includes(current.modulation) ? current.modulation : definition.defaultMode;
  const modeDefaults = amateurModeDefaults(mode);
  const path = amateurFrequencyPath(frequencyHz, caps);
  return Object.freeze({
    band: definition.id,
    label: definition.label,
    frequencyHz,
    sampleRate: 1_024_000,
    mode,
    ...modeDefaults,
    ritHz: Number.isFinite(Number(current.ritHz)) ? Number(current.ritHz) : 0,
    directSampling: path.directSampling,
    directSamplingRequired: path.directSamplingRequired,
    directSamplingSupported: path.directSamplingSupported,
    blocked: path.blocked,
    reason: path.reason,
    note: definition.note
  });
}
