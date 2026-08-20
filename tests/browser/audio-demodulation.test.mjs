import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AudioDemodulator, rms } from "../../web/src/dsp/demodulators.js";

function generateFm({ sampleRate = 1_024_000, samples = 262_144, toneHz = 1000, deviationHz = 75_000 }) {
  const i = new Float32Array(samples);
  const q = new Float32Array(samples);
  let phase = 0;
  for (let n = 0; n < samples; n += 1) {
    const t = n / sampleRate;
    phase += 2 * Math.PI * deviationHz * Math.sin(2 * Math.PI * toneHz * t) / sampleRate;
    i[n] = Math.cos(phase);
    q[n] = Math.sin(phase);
  }
  return { i, q };
}

function generateAm({ sampleRate = 1_024_000, samples = 262_144, toneHz = 1000 }) {
  const i = new Float32Array(samples);
  const q = new Float32Array(samples);
  for (let n = 0; n < samples; n += 1) {
    const t = n / sampleRate;
    i[n] = 0.6 + 0.3 * Math.sin(2 * Math.PI * toneHz * t);
  }
  return { i, q };
}

function toneCorrelation(samples, toneHz, sampleRate = 48_000, skip = 1000) {
  let cosine = 0;
  let sine = 0;
  let power = 0;
  let count = 0;
  for (let n = skip; n < samples.length; n += 1) {
    const phase = 2 * Math.PI * toneHz * n / sampleRate;
    cosine += samples[n] * Math.cos(phase);
    sine += samples[n] * Math.sin(phase);
    power += samples[n] * samples[n];
    count += 1;
  }
  return Math.sqrt(cosine * cosine + sine * sine) / Math.sqrt(Math.max(1e-12, power * count));
}

function processInChunks(demodulator, source, sampleRate, chunk = 32768) {
  const parts = [];
  let total = 0;
  for (let start = 0; start < source.i.length; start += chunk) {
    const output = demodulator.process(source.i.subarray(start, start + chunk), source.q.subarray(start, start + chunk), sampleRate);
    parts.push(output); total += output.length;
  }
  const joined = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  return joined;
}

for (const fixture of [
  { mode: "wfm", toneHz: 1000, source: () => generateFm({ toneHz: 1000, deviationHz: 75_000 }), bandwidth: 15_000 },
  { mode: "nfm", toneHz: 900, source: () => generateFm({ toneHz: 900, deviationHz: 5_000 }), bandwidth: 3_500 },
  { mode: "am", toneHz: 1000, source: () => generateAm({ toneHz: 1000 }), bandwidth: 5_000 }
]) {
  test(`${fixture.mode.toUpperCase()} deterministic IQ fixture produces the expected audio tone`, () => {
    const demodulator = new AudioDemodulator({ mode: fixture.mode, outputRate: 48_000, audioBandwidthHz: fixture.bandwidth });
    const output = processInChunks(demodulator, fixture.source(), 1_024_000);
    assert.ok(output.length > 10_000);
    assert.ok(rms(output) > 0.05, "audio should not be silent");
    assert.ok(toneCorrelation(output, fixture.toneHz) > 0.65, "expected tone must dominate the demodulated audio");
  });
}

test("AudioWorklet uses a fixed ring instead of a frame-array queue", async () => {
  const source = await readFile("web/src/audio/audio-ring-worklet.js", "utf8");
  assert.match(source, /new Float32Array\(this\.capacity\)/);
  assert.ok(!source.includes("this.frames = []"));
  assert.ok(!source.includes(".shift()"));
  assert.match(source, /registerProcessor\("mayhem-rtl-audio-ring"/);
});


test("AudioWorklet prebuffers bursty worker audio and reports bounded rebuffer state", async () => {
  const source = await readFile("web/src/audio/audio-ring-worklet.js", "utf8");
  assert.match(source, /prebufferSamples/);
  assert.match(source, /buffering: !this\.playing/);
  assert.match(source, /rebufferEvents/);
  assert.ok(!source.includes("this.underruns += 1;\n      if (this.underruns === 1"), "old every-quantum underrun counter must be removed");
});

test("AudioController sends only the transferred audio frame to the worklet", async () => {
  const source = await readFile("web/src/audio/audio-controller.js", "utf8");
  assert.match(source, /numberOfInputs: 0/);
  assert.match(source, /postMessage\(\{ type: "frame", samples \}, \[samples\.buffer\]\)/);
  assert.ok(!source.includes("samples, metadata }, [samples.buffer]"), "the same transferred frame must not also be cloned through metadata");
  assert.match(source, /pushedFrames/);
  assert.match(source, /pushErrors/);
});

function generateSideband({ sampleRate = 1_024_000, samples = 262_144, toneHz = 1000, side = 1, carrierOffsetHz = 0 }) {
  const i = new Float32Array(samples);
  const q = new Float32Array(samples);
  const basebandHz = side * toneHz + carrierOffsetHz;
  for (let n = 0; n < samples; n += 1) {
    const phase = 2 * Math.PI * basebandHz * n / sampleRate;
    i[n] = Math.cos(phase);
    q[n] = Math.sin(phase);
  }
  return { i, q };
}

test("USB and LSB complex filters recover the selected sideband and reject the opposite sideband", () => {
  for (const [mode, side] of [["usb", 1], ["lsb", -1]]) {
    const demodulator = new AudioDemodulator({ mode, outputRate: 48_000, audioBandwidthHz: 2400, ssbLowCutHz: 300, agcMode: "off" });
    const selected = processInChunks(demodulator, generateSideband({ toneHz: 1000, side }), 1_024_000);
    assert.ok(selected.length > 10_000);
    assert.ok(rms(selected) > 0.2);
    assert.ok(toneCorrelation(selected, 1000) > 0.65);

    demodulator.reset();
    const rejected = processInChunks(demodulator, generateSideband({ toneHz: 1000, side: -side }), 1_024_000);
    assert.ok(rms(rejected) < rms(selected) * 0.08, `${mode} should reject the opposite sideband`);
  }
});

test("SSB Receiver Incremental Tuning corrects a carrier offset without changing nominal tune", () => {
  const demodulator = new AudioDemodulator({ mode: "usb", outputRate: 48_000, audioBandwidthHz: 2400, ssbLowCutHz: 300, ritHz: 150, agcMode: "off" });
  const output = processInChunks(demodulator, generateSideband({ toneHz: 1000, side: 1, carrierOffsetHz: 150 }), 1_024_000);
  assert.ok(toneCorrelation(output, 1000) > 0.65);
});

test("CW mode creates the selected beat pitch from a carrier at the tuned frequency", () => {
  const count = 262_144;
  const source = { i: new Float32Array(count).fill(1), q: new Float32Array(count) };
  const demodulator = new AudioDemodulator({ mode: "cw", outputRate: 48_000, audioBandwidthHz: 500, cwPitchHz: 700, agcMode: "off" });
  const output = processInChunks(demodulator, source, 1_024_000);
  assert.ok(rms(output) > 0.2);
  assert.ok(toneCorrelation(output, 700) > 0.65);
});
