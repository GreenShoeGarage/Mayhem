import test from "node:test";
import assert from "node:assert/strict";
import {
  POCSAG_SYNC_WORD,
  POCSAG_IDLE_WORD,
  PocsagEcc,
  PocsagIqDecoder,
  generatePocsagIqFixture
} from "../../web/src/dsp/pocsag.js";
import { APPLICATIONS } from "../../web/src/apps/compatibility-manifest.js";
import { SimulationSource, simulationScenarios } from "../../web/src/simulation/simulation-source.js";

function decodeFixture({ bitrate = 1200, inverted = false, sampleRate = 48_000, message = "HELLO" } = {}) {
  const fixture = generatePocsagIqFixture({ sampleRate, bitrate, ric: 1234560, functionCode: 3, message, inverted });
  const decoder = new PocsagIqDecoder({ sampleRate, baudRate: "auto" });
  const pages = [];
  const block = 32768;
  for (let offset = 0; offset < fixture.i.length; offset += block) {
    pages.push(...decoder.process(fixture.i.subarray(offset, offset + block), fixture.q.subarray(offset, offset + block), { receivedAtMs: 1000 + offset }));
  }
  return { fixture, decoder, pages };
}

test("POCSAG BCH accepts standard sync/idle and corrects data-bit errors", () => {
  const ecc = new PocsagEcc();
  assert.equal(ecc.correct(POCSAG_SYNC_WORD).errors, 0);
  assert.equal(ecc.correct(POCSAG_IDLE_WORD).errors, 0);
  const one = ecc.correct((POCSAG_SYNC_WORD ^ (1 << 20)) >>> 0);
  assert.equal(one.errors, 1);
  assert.equal(one.word, POCSAG_SYNC_WORD);
  const two = ecc.correct((POCSAG_SYNC_WORD ^ (1 << 20) ^ (1 << 25)) >>> 0);
  assert.equal(two.errors, 2);
  assert.equal(two.word, POCSAG_SYNC_WORD);
});

for (const bitrate of [512, 1200, 2400]) {
  test(`POCSAG ${bitrate} bit/s IQ fixture decodes RIC/function/alpha message`, () => {
    const { pages, decoder } = decodeFixture({ bitrate, message: "MAYHEM RTL" });
    const page = pages.find((entry) => entry.ric === 1234560 && entry.message.includes("MAYHEM RTL"));
    assert.ok(page, `expected a decoded ${bitrate} bit/s page`);
    assert.equal(page.function, 3);
    assert.equal(page.bitrate, bitrate);
    assert.equal(page.type, "alpha");
    assert.ok(decoder.snapshot().syncs >= 1);
  });
}

test("POCSAG decoder recognizes inverted discriminator polarity", () => {
  const { pages } = decodeFixture({ bitrate: 1200, inverted: true, message: "INVERTED" });
  const page = pages.find((entry) => entry.message.includes("INVERTED"));
  assert.ok(page);
  assert.equal(page.inverted, true);
});

test("POCSAG auto decoder remains continuous across 1.024 Msps worker-sized blocks", () => {
  const { pages } = decodeFixture({ bitrate: 1200, sampleRate: 1_024_000, message: "BLOCK SAFE" });
  assert.ok(pages.some((entry) => entry.message.includes("BLOCK SAFE")));
});

test("explicit POCSAG Simulation Mode emits locally decodable fixture data", async () => {
  assert.equal(simulationScenarios().pocsag, "POCSAG pager fixture");
  const source = new SimulationSource({ sampleRate: 240_000, centerFrequencyHz: 929_612_500, blockSamples: 32768, scenario: "pocsag" });
  const decoder = new PocsagIqDecoder({ sampleRate: 240_000, baudRate: "auto" });
  let decoded = null;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { source.stop(); reject(new Error("POCSAG simulation decode timeout")); }, 2500);
    source.start(async (entry) => {
      const bytes = new Uint8Array(entry.data);
      const count = bytes.length / 2;
      const i = new Float32Array(count);
      const q = new Float32Array(count);
      for (let n = 0; n < count; n += 1) {
        i[n] = (bytes[n * 2] - 127.5) / 112;
        q[n] = (bytes[n * 2 + 1] - 127.5) / 112;
      }
      const pages = decoder.process(i, q, { receivedAtMs: Date.now() });
      decoded = pages.find((page) => page.message.includes("MAYHEM RTL POCSAG TEST")) || decoded;
      if (decoded) { clearTimeout(timeout); source.stop(); resolve(); }
    });
  });
  assert.equal(decoded.ric, 1234560);
  assert.equal(decoded.bitrate, 1200);
});

test("registry exposes POCSAG as a ready receive-only application", () => {
  const app = APPLICATIONS.find((entry) => entry.id === "pocsag");
  assert.ok(app);
  assert.equal(app.category, "Receive");
  assert.equal(app.requiresTransmit, false);
  assert.equal(app.requiresAudio, false);
  assert.equal(app.portState, "ready");
  assert.equal(app.verificationState, "simulation-tested");
});
