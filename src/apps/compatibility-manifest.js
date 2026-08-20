export const PortState = Object.freeze({
  READY: "ready",
  PARTIAL: "partial",
  TRANSMIT_ONLY: "transmit-only",
  PENDING: "browser port pending",
  SIMULATED_ONLY: "simulated only"
});

export const VerificationState = Object.freeze({
  UNIT_TESTED: "unit-tested",
  REPLAY_TESTED: "replay-tested",
  SIMULATION_TESTED: "simulation-tested",
  HARDWARE_TESTED: "hardware-tested",
  ON_AIR_UNVERIFIED: "on-air behavior unverified",
  NOT_TESTED: "not tested"
});

export const APPLICATIONS = Object.freeze([
  { id: "spectrum", name: "Spectrum Analyzer", icon: "∿", category: "Receive", requiresReceive: true, requiresTransmit: false, minimumFrequencyHz: 0, maximumFrequencyHz: 0, preferredSampleRate: 1024000, minimumSampleRate: 225001, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.SIMULATION_TESTED, limitations: ["Initial live RTL-SDR bring-up is verified; sustained soak and wider hardware coverage remain pending."] },
  { id: "waterfall", name: "Waterfall", icon: "≋", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 225001, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.SIMULATION_TESTED, limitations: ["Transferable-buffer compatibility path; shared-memory performance target not claimed."] },
  { id: "wfm", name: "Wideband Frequency Modulation Receiver", icon: "W", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 2400000, minimumSampleRate: 1024000, requiredBandwidthHz: 200000, requiresAudio: true, requiresMap: false, portState: PortState.PENDING, verificationState: VerificationState.NOT_TESTED, limitations: ["AudioWorklet and upstream demodulator port pending."] },
  { id: "nfm", name: "Narrowband Frequency Modulation Receiver", icon: "N", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 225001, requiredBandwidthHz: 12500, requiresAudio: true, requiresMap: false, portState: PortState.PENDING, verificationState: VerificationState.NOT_TESTED, limitations: ["AudioWorklet and upstream demodulator port pending."] },
  { id: "am", name: "Amplitude Modulation Receiver", icon: "A", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 225001, requiredBandwidthHz: 10000, requiresAudio: true, requiresMap: false, portState: PortState.PENDING, verificationState: VerificationState.NOT_TESTED, limitations: ["AudioWorklet and upstream demodulator port pending."] },
  { id: "scanner", name: "Frequency Scanner", icon: "⇥", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 225001, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.PENDING, verificationState: VerificationState.NOT_TESTED, limitations: ["Serialized scan controller pending."] },
  { id: "capture", name: "Raw In-phase and Quadrature Capture", icon: "●", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 1, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.SIMULATION_TESTED, limitations: ["Origin Private File System preferred; Indexed Database fallback used when unavailable."] },
  { id: "replay", name: "Raw In-phase and Quadrature Replay", icon: "▶", category: "Utilities", requiresReceive: false, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 1, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.PARTIAL, verificationState: VerificationState.REPLAY_TESTED, limitations: ["Real-time and faster-than-real-time block replay; decoder-aware pacing pending."] },
  { id: "adsbrx", name: "Automatic Dependent Surveillance–Broadcast Receiver", icon: "✈", category: "Receive", requiresReceive: true, requiresTransmit: false, preferredSampleRate: 2400000, minimumSampleRate: 2000000, requiredBandwidthHz: 2000000, requiresAudio: false, requiresMap: true, portState: PortState.PENDING, verificationState: VerificationState.NOT_TESTED, limitations: ["Decoder and local graticule panel pending; no aircraft data leaves the browser."] },
  { id: "diagnostics", name: "Device Diagnostics", icon: "⌕", category: "Utilities", requiresReceive: false, requiresTransmit: false, preferredSampleRate: 0, minimumSampleRate: 0, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.UNIT_TESTED, limitations: [] },
  { id: "radiosetup", name: "Radio Setup", icon: "⚙", category: "Settings", requiresReceive: false, requiresTransmit: false, preferredSampleRate: 0, minimumSampleRate: 0, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.PARTIAL, verificationState: VerificationState.UNIT_TESTED, limitations: ["Hardware-specific controls remain hidden until capability and hardware verification are available."] },
  { id: "compatibility", name: "Application Compatibility Matrix", icon: "≡", category: "Utilities", requiresReceive: false, requiresTransmit: false, preferredSampleRate: 0, minimumSampleRate: 0, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.UNIT_TESTED, limitations: [] },
  { id: "about", name: "About and Licenses", icon: "i", category: "Settings", requiresReceive: false, requiresTransmit: false, preferredSampleRate: 0, minimumSampleRate: 0, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.UNIT_TESTED, limitations: [] },
  { id: "simulation", name: "Simulation Mode", icon: "S", category: "Utilities", requiresReceive: false, requiresTransmit: false, preferredSampleRate: 1024000, minimumSampleRate: 1, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.READY, verificationState: VerificationState.SIMULATION_TESTED, limitations: ["Always displays SIMULATION — NO LIVE RADIO."] },
  { id: "jammer", name: "Jammer", icon: "!", category: "Transmit", requiresReceive: false, requiresTransmit: true, preferredSampleRate: 0, minimumSampleRate: 0, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.TRANSMIT_ONLY, verificationState: VerificationState.NOT_TESTED, limitations: ["This application requires radio transmission.", "The connected RTL-SDR is receive-only.", "No transmit operation is available in this browser build."] },
  { id: "replaytx", name: "Replay over Radio", icon: "↥", category: "Transmit", requiresReceive: false, requiresTransmit: true, preferredSampleRate: 0, minimumSampleRate: 0, requiredBandwidthHz: 0, requiresAudio: false, requiresMap: false, portState: PortState.TRANSMIT_ONLY, verificationState: VerificationState.NOT_TESTED, limitations: ["This application requires radio transmission.", "The connected RTL-SDR is receive-only.", "No transmit operation is available in this browser build."] }
]);

export function evaluateApplication(application, caps = { hasRx: true, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: Infinity }) {
  if (application.requiresTransmit && !caps.hasTx) return { available: false, state: "transmit-only", reason: "RTL-SDR hardware is receive-only." };
  if (application.requiresReceive && !caps.hasRx) return { available: false, state: "unavailable for connected hardware", reason: "The selected source cannot receive live samples." };
  if (application.minimumSampleRate && application.minimumSampleRate > caps.maxSampleRate) return { available: false, state: "requires unsupported sample rate", reason: `Requires at least ${application.minimumSampleRate} samples per second.` };
  if (application.minimumFrequencyHz && application.minimumFrequencyHz < caps.minFrequencyHz) return { available: false, state: "requires unsupported frequency", reason: "Required frequency is outside the connected receiver range." };
  if (application.portState === PortState.PENDING) return { available: false, state: PortState.PENDING, reason: application.limitations[0] ?? "Browser port pending." };
  return { available: true, state: application.portState, reason: application.limitations[0] ?? "Ready." };
}
