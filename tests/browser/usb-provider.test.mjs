import test from "node:test";
import assert from "node:assert/strict";
import { KNOWN_RTL2832U_FILTERS, RadioErrorType, RTL2832UProvider } from "../../web/src/usb/webrtlsdr-lowlevel.js";

test("WebUSB picker is restricted to known RTL2832U identifiers", async () => {
  let seenOptions = null;
  const expected = { vendorId: 0x0bda, productId: 0x2838 };
  const provider = new RTL2832UProvider({ webusb: { async requestDevice(options) { seenOptions = options; return expected; } } });
  const selected = await provider.requestDevice();
  assert.equal(selected, expected);
  assert.deepEqual(seenOptions.filters, KNOWN_RTL2832U_FILTERS);
});

test("second-stage identifier policy rejects an unrelated selected device", async () => {
  const provider = new RTL2832UProvider({ webusb: { async requestDevice() { return { vendorId: 0x1234, productId: 0x5678 }; } } });
  await assert.rejects(provider.requestDevice(), (error) => error.type === RadioErrorType.UnsupportedDevice);
});
