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
