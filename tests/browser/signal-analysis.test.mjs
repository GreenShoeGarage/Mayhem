import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ActivityDetector, LevelHistory, WidebandSweepAccumulator, estimateNoiseFloorDb, findSpectrumPeaks, nextRangeFrequency, relativeStrength } from "../../web/src/analysis/signal-analysis.js";
import { APPLICATIONS } from "../../web/src/apps/compatibility-manifest.js";

test("signal analysis estimates noise and finds separated local peaks", () => {
  const spectrum = new Float32Array(256); spectrum.fill(-92);
  spectrum[40] = -45; spectrum[41] = -52;
  spectrum[100] = -38; spectrum[101] = -50;
  spectrum[102] = -43; // close enough to merge with index 100 by separation rule
  const floor = estimateNoiseFloorDb(spectrum);
  assert.ok(floor <= -91 && floor >= -93);
  const peaks = findSpectrumPeaks(spectrum, { centerFrequencyHz: 100_000_000, sampleRate: 1_024_000, thresholdDbfs: -60, minProminenceDb: 6, minSeparationHz: 20_000 });
  assert.equal(peaks.length, 2);
  assert.ok(peaks.some((entry) => Math.abs(entry.levelDbfs - (-45)) < 0.1));
  assert.ok(peaks.some((entry) => Math.abs(entry.levelDbfs - (-38)) < 0.1));
});

test("activity detector applies minimum-active time, hysteresis, and release", () => {
  const detector = new ActivityDetector({ thresholdDbfs: -50, hysteresisDb: 3, minActiveMs: 100, releaseMs: 200 });
  detector.process(-48, 1000);
  assert.equal(detector.snapshot().active, false);
  detector.process(-47, 1110);
  assert.equal(detector.snapshot().active, true);
  detector.process(-52, 1200); // inside hysteresis, stays active
  assert.equal(detector.snapshot().active, true);
  detector.process(-54, 1300);
  detector.process(-55, 1510);
  const snapshot = detector.snapshot();
  assert.equal(snapshot.active, false);
  assert.equal(snapshot.events.length, 1);
  assert.ok(snapshot.events[0].durationMs >= 500);
});

test("level history is bounded and tracks rolling metrics", () => {
  const history = new LevelHistory({ maxPoints: 30 });
  for (let i = 0; i < 50; i += 1) history.add(-90 + i, 1000 + i);
  const snapshot = history.snapshot();
  assert.equal(snapshot.points.length, 30);
  assert.equal(snapshot.peakDbfs, -41);
  assert.ok(snapshot.meanDbfs > -60);
  assert.equal(relativeStrength(-60, -100, -20), 0.5);
});

test("Looking Glass accumulator stitches max-hold values from multiple tuned slices", () => {
  const accumulator = new WidebandSweepAccumulator({ startHz: 99_000_000, endHz: 101_000_000, bins: 240 });
  const a = new Float32Array(128); a.fill(-100); a[96] = -30;
  const b = new Float32Array(128); b.fill(-105); b[32] = -40;
  accumulator.addSpectrum({ spectrum: a, frequency: 99_500_000, sampleRate: 1_000_000 });
  accumulator.addSpectrum({ spectrum: b, frequency: 100_500_000, sampleRate: 1_000_000 });
  const snapshot = accumulator.snapshot();
  assert.equal(snapshot.slices, 2);
  assert.ok(Math.max(...snapshot.values) >= -31);
  assert.ok(snapshot.hits.some((value) => value > 0));
});

test("Signal Hunter range helper steps, wraps, and normalizes an out-of-range cursor", () => {
  const range = { startHz: 433_000_000, endHz: 433_100_000, stepHz: 25_000 };
  assert.equal(nextRangeFrequency(null, range), 433_000_000);
  assert.equal(nextRangeFrequency(433_000_000, range), 433_025_000);
  assert.equal(nextRangeFrequency(433_075_000, range), 433_100_000);
  assert.equal(nextRangeFrequency(433_100_000, range), 433_000_000);
  assert.equal(nextRangeFrequency(999_000_000, range), 433_000_000);
  assert.equal(nextRangeFrequency(10, { startHz: 20, endHz: 10, stepHz: 1 }), null);
});


test("v0.8.4 registry exposes the seven Signal Analysis Suite receivers", () => {
  for (const id of ["level", "detector", "foxhunt", "search", "lookingglass", "signalhunter", "timesink"]) {
    const app = APPLICATIONS.find((entry) => entry.id === id);
    assert.ok(app, `${id} must be registered`);
    assert.equal(app.category, "Receive");
    assert.equal(app.requiresReceive, true);
    assert.equal(app.requiresTransmit, false);
    assert.equal(app.portState, "ready");
  }
});

test("Time Sink uses bounded worker snapshots and Signal Hunter reuses local capture", async () => {
  const worker = await readFile("web/src/workers/processing-worker.js", "utf8");
  const app = await readFile("web/src/app.js", "utf8");
  assert.match(worker, /timeSinkPoints/);
  assert.match(worker, /Math\.max\(64, Math\.min\(2048/);
  assert.match(worker, /type: "timeseries"/);
  assert.match(app, /Signal Hunter auto-trigger/);
  assert.match(app, /startCapture\(\{ name, notes:/);
  assert.match(app, /Post-trigger capture in v0\.8\.4/);
});
