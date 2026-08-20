import test from "node:test";
import assert from "node:assert/strict";
import { HARDWARE_VERIFICATION } from "../../web/src/config.js";
import { createDiagnosticPackage } from "../../web/src/diagnostics/package.js";
import { ConnectionState, ConnectionStateMachine } from "../../web/src/state/connection-state.js";
import { WebUsbRadio } from "../../web/src/usb/webusb-radio.js";

if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
if (!globalThis.navigator) Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });

const quietLog = { info() {}, warn() {}, error() {} };

test("hardware verification metadata records completed soak checks and remaining matrix work", () => {
  assert.equal(HARDWARE_VERIFICATION.state, "reference-hardware-validated");
  assert.equal(HARDWARE_VERIFICATION.sampleRate, 2_400_000);
  assert.ok(HARDWARE_VERIFICATION.verifiedCapabilities.includes("waterfall"));
  assert.ok(HARDWARE_VERIFICATION.verifiedCapabilities.includes("30-minute 1.024 Msps soak"));
  assert.ok(HARDWARE_VERIFICATION.verifiedCapabilities.includes("2.4 Msps / 60-minute soak"));
  assert.ok(HARDWARE_VERIFICATION.pendingChecks.includes("USB/LSB/CW on-air validation"));
  assert.ok(HARDWARE_VERIFICATION.pendingChecks.includes("multi-device matrix"));
});

test("diagnostic exports carry hardware verification evidence", () => {
  const payload = createDiagnosticPackage({ preflight: {}, browser: {}, connection: {}, device: {}, receiver: {}, stream: {}, processing: {}, capture: null, application: {}, project: {}, logs: [] });
  assert.equal(payload.hardwareVerification.state, "reference-hardware-validated");
  assert.equal(payload.hardwareVerification.observedDroppedSamples, 0);
});

test("live receiver start and stop move cleanly between connected-idle and receiving", async () => {
  const machine = new ConnectionStateMachine(ConnectionState.CONNECTED_IDLE);
  const radio = new WebUsbRadio({ stateMachine: machine, log: quietLog });
  let reads = 0;
  radio.device = {
    async resetBuffer() {},
    async readSamples(length) {
      reads += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { frequency: 100_000_000, directSampling: false, data: new Uint8Array(length * 2).buffer };
    }
  };
  await radio.startReceiver({ blockSamples: 8192, transferDepth: 1, onBlock: () => true });
  assert.equal(machine.state, ConnectionState.RECEIVING);
  await new Promise((resolve) => setTimeout(resolve, 8));
  assert.ok(reads >= 1);
  await radio.stopReceiver("test stop");
  assert.equal(machine.state, ConnectionState.CONNECTED_IDLE);
  assert.equal(radio.receiving, false);
});
