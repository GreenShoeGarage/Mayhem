import test from "node:test";
import assert from "node:assert/strict";
import { buildStreamPlan, PerformanceGovernor } from "../../web/src/performance/stream-plan.js";
import { SharedBlockPool } from "../../web/src/workers/shared-block-pool.js";
import { readFile } from "node:fs/promises";

test("automatic stream planning scales block size and queue depth for high rates", () => {
  const low = buildStreamPlan({ sampleRate: 1_024_000, performanceProfile: "auto" });
  const high = buildStreamPlan({ sampleRate: 2_400_000, performanceProfile: "auto" });
  assert.equal(low.blockSamples, 32768);
  assert.equal(low.transferDepth, 4);
  assert.equal(high.blockSamples, 65536);
  assert.equal(high.transferDepth, 6);
  assert.ok(high.processingQueueDepth > low.processingQueueDepth);
  assert.equal(high.profile, "auto-high-rate");
});

test("custom stream planning respects bounded operator settings", () => {
  const plan = buildStreamPlan({ sampleRate: 2_400_000, performanceProfile: "custom", usbBlockSamples: 50000, transferDepth: 8, processingQueueDepth: 8, displayRateHz: 40 });
  assert.equal(plan.blockSamples, 50000);
  assert.equal(plan.transferDepth, 8);
  assert.equal(plan.processingQueueDepth, 8);
  assert.equal(plan.displayRateHz, 40);
});

test("performance governor sheds visualization work before recovery", () => {
  const governor = new PerformanceGovernor();
  governor.reset();
  let state = governor.observe({ queueRatio: 0.9, workerTimeMs: 30, blockDurationMs: 25, drops: 0, underruns: 0 });
  assert.equal(state.level, "critical");
  assert.equal(state.policy.spectrumStride, 4);
  for (let index = 0; index < 4; index += 1) state = governor.observe({ queueRatio: 0.1, workerTimeMs: 2, blockDurationMs: 25, drops: 0, underruns: 0 });
  assert.equal(state.level, "busy");
  for (let index = 0; index < 6; index += 1) state = governor.observe({ queueRatio: 0.1, workerTimeMs: 2, blockDurationMs: 25, drops: 0, underruns: 0 });
  assert.equal(state.level, "normal");
  assert.equal(state.policy.spectrumStride, 1);
});

test("shared block pool uses fixed slots and never overwrites an in-use slot", () => {
  if (typeof SharedArrayBuffer !== "function") return;
  const pool = new SharedBlockPool({ slotBytes: 16, slots: 2 });
  const first = pool.acquire(Uint8Array.from([1,2,3,4]).buffer);
  const second = pool.acquire(Uint8Array.from([5,6,7,8]).buffer);
  assert.ok(first && second);
  assert.equal(pool.acquire(Uint8Array.from([9]).buffer), null);
  assert.deepEqual([...pool.view(first.slot, first.length)], [1,2,3,4]);
  assert.equal(pool.release(first.slot), true);
  const third = pool.acquire(Uint8Array.from([9,10]).buffer);
  assert.equal(third.slot, first.slot);
});

test("processing worker preserves audio on every block while spectrum work can be strided", async () => {
  const source = await readFile("web/src/workers/processing-worker.js", "utf8");
  assert.match(source, /processAudio\(converted, sampleRate, levelDbfs\);/);
  assert.match(source, /spectrumStride/);
  assert.match(source, /block-shared/);
});

test("Easy Mode receiver keeps essential controls in the main workspace", async () => {
  const app = await readFile("web/src/app.js", "utf8");
  const css = await readFile("web/styles.css", "utf8");
  for (const id of ["quickFrequency", "quickTuningStep", "quickModulation", "quickGainMode", "quickStart", "quickAudioEnable", "quickCapture", "quickStation"]) assert.ok(app.includes(`id=\\"${id}\\"`) || app.includes(`id="${id}"`));
  assert.match(css, /data-mode="easy".*advanced-control/s);
  assert.match(css, /data-mode="easy".*right-inspector/s);
});
