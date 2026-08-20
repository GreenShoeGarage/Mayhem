import { APPLICATION_DEFINITIONS } from "./generated-registry.js";

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

export const APPLICATIONS = Object.freeze(APPLICATION_DEFINITIONS.map((entry) => Object.freeze({ ...entry, limitations: Object.freeze([...(entry.limitations || [])]) })));

export function evaluateApplication(application, caps = { hasRx: true, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: Infinity }) {
  if (application.requiresTransmit && !caps.hasTx) return { available: false, state: "transmit-only", reason: "RTL-SDR hardware is receive-only." };
  if (application.requiresReceive && !caps.hasRx) return { available: false, state: "unavailable for connected hardware", reason: "The selected source cannot receive live samples." };
  if (application.minimumSampleRate && application.minimumSampleRate > caps.maxSampleRate) return { available: false, state: "requires unsupported sample rate", reason: `Requires at least ${application.minimumSampleRate} samples per second.` };
  if (application.minimumFrequencyHz && application.minimumFrequencyHz < caps.minFrequencyHz) return { available: false, state: "requires unsupported frequency", reason: "Required frequency is outside the connected receiver range." };
  if (application.portState === PortState.PENDING) return { available: false, state: PortState.PENDING, reason: application.limitations[0] ?? "Browser port pending." };
  return { available: true, state: application.portState, reason: application.limitations[0] ?? "Ready." };
}
