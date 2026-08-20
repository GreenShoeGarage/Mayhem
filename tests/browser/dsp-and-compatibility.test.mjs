import test from "node:test";
import assert from "node:assert/strict";
import { fftComplex, spectrumDb, windowCoefficient } from "../../web/src/dsp/fft.js";
import { APPLICATIONS, evaluateApplication } from "../../web/src/apps/compatibility-manifest.js";

test("complex FFT places a known positive-frequency carrier in the shifted spectrum", () => {
  const size = 256;
  const i = new Float32Array(size);
  const q = new Float32Array(size);
  const bin = 19;
  for (let n = 0; n < size; n += 1) { const phase = 2 * Math.PI * bin * n / size; i[n] = Math.cos(phase); q[n] = Math.sin(phase); }
  const spectrum = spectrumDb(i, q, { size, window: "rectangular" });
  let peak = 0;
  for (let n = 1; n < spectrum.length; n += 1) if (spectrum[n] > spectrum[peak]) peak = n;
  assert.equal(peak, size / 2 + bin);
  assert.ok(spectrum[peak] > -0.1);
});

test("window functions and FFT input validation are deterministic", () => {
  assert.equal(windowCoefficient("rectangular", 3, 8), 1);
  assert.throws(() => fftComplex(new Float64Array(3), new Float64Array(3)), /power-of-two/);
});

test("transmit applications remain visible and unavailable on receive-only hardware", () => {
  const jammer = APPLICATIONS.find((entry) => entry.id === "jammer");
  assert.ok(jammer);
  const result = evaluateApplication(jammer, { hasRx: true, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: Infinity });
  assert.equal(result.available, false);
  assert.match(result.reason, /receive-only/);
});

test("WFM, NFM, and AM are active receive applications after the audio batch", () => {
  for (const id of ["wfm", "nfm", "am"]) {
    const application = APPLICATIONS.find((entry) => entry.id === id);
    assert.ok(application, `${id} must remain in the registry`);
    assert.equal(application.portState, "ready");
    assert.equal(application.verificationState, "hardware-tested");
    const result = evaluateApplication(application, { hasRx: true, hasTx: false, minFrequencyHz: 0, maxFrequencyHz: Infinity, maxSampleRate: 1_024_000 });
    assert.equal(result.available, true, `${id} should be available on the verified 1.024 Msps receive path`);
  }
});
