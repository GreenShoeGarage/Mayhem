import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { ReplaySource } from "../../web/src/storage/replay-source.js";

test("replay pacing survives transfer of the sample buffer", async () => {
  const blockSamples = 1024;
  const sampleRate = 1024;
  const file = new File([new Uint8Array(blockSamples * 2 * 2)], "two-blocks.cu8", { type: "application/octet-stream" });
  const replay = new ReplaySource();
  replay.load(file, { sampleRate, centerFrequencyHz: 100_000_000 });
  let blocks = 0;
  replay.start(async ({ data }) => {
    blocks += 1;
    structuredClone(data, { transfer: [data] });
  }, { speed: 1, blockSamples });

  await delay(80);
  assert.equal(blocks, 1, "the detached first buffer must not collapse the next-block delay to zero");
  assert.equal(replay.running, true);
  replay.stop();
});
