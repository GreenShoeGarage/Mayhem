import test from "node:test";
import assert from "node:assert/strict";
import { BroadcastBand, broadcastConfiguration, nextBroadcastFrequency } from "../../web/src/radio/broadcast-radio.js";
import { ScannerController } from "../../web/src/scanner/scanner-controller.js";
import { AdsbIqDecoder, decodeGlobalCpr, decodeModeSFrame, generateAdsbIqFixture, modeSCrcValid } from "../../web/src/dsp/adsb.js";
import { APPLICATIONS } from "../../web/src/apps/compatibility-manifest.js";
import { SimulationSource } from "../../web/src/simulation/simulation-source.js";

test("broadcast radio presets select WFM for FM and direct-sampling AM when required", () => {
  const caps = { minFrequencyHz: 28_800_000, directSampling: true };
  const fm = broadcastConfiguration(BroadcastBand.FM, caps, { centerFrequencyHz: 99_500_000 });
  assert.equal(fm.modulation, "wfm");
  assert.equal(fm.directSampling, "off");
  assert.equal(fm.squelchDb, -140);
  const am = broadcastConfiguration(BroadcastBand.AM, caps, { centerFrequencyHz: 1_000_000 });
  assert.equal(am.modulation, "am");
  assert.equal(am.directSamplingRequired, true);
  assert.equal(am.directSampling, "q");
  assert.equal(am.blocked, false);
  assert.equal(nextBroadcastFrequency(BroadcastBand.AM, 1_710_000, 1, 10_000), 530_000);
});

test("broadcast AM remains on the normal tuner path for a zero-Hz-minimum profile", () => {
  const am = broadcastConfiguration(BroadcastBand.AM, { minFrequencyHz: 0, directSampling: true }, { centerFrequencyHz: 1_000_000 });
  assert.equal(am.directSamplingRequired, false);
  assert.equal(am.directSampling, "off");
});

test("scanner serializes tuning, detects threshold crossings, holds, and wraps", async () => {
  const tuned = [];
  const sleeps = [];
  let level = -70;
  const scanner = new ScannerController({
    tune: async (frequency) => { tuned.push(frequency); level = frequency === 101_000_000 ? -30 : -70; return frequency; },
    readLevel: () => level,
    sleep: async (ms) => { sleeps.push(ms); if (tuned.length >= 3) scanner.stop(); },
    now: (() => { let t = 0; return () => (t += 100); })()
  });
  await scanner.start({ startHz: 100_000_000, endHz: 102_000_000, stepHz: 1_000_000, dwellMs: 20, settleMs: 0, thresholdDbfs: -45, holdOnHit: true, holdMs: 30 });
  assert.deepEqual(tuned.slice(0, 3), [100_000_000, 101_000_000, 102_000_000]);
  assert.equal(scanner.hits.length, 1);
  assert.equal(scanner.hits[0].frequencyHz, 101_000_000);
  assert.ok(sleeps.includes(30));
});



test("scanner lockouts skip frequencies until cleared", async () => {
  const tuned = [];
  const scanner = new ScannerController({
    tune: async (frequency) => { tuned.push(frequency); return frequency; },
    readLevel: () => -90,
    sleep: async () => { if (tuned.length >= 3) scanner.stop(); }
  });
  scanner.lockout(101_000_000);
  await scanner.start({ startHz: 100_000_000, endHz: 102_000_000, stepHz: 1_000_000, dwellMs: 20, settleMs: 0, thresholdDbfs: -45 });
  assert.deepEqual(tuned.slice(0, 3), [100_000_000, 102_000_000, 100_000_000]);
  assert.deepEqual(scanner.snapshot().lockouts, [101_000_000]);
  scanner.clearLockouts();
  assert.equal(scanner.snapshot().lockouts.length, 0);
});

test("Mode S CRC and ADS-B identification fixture match known upstream-compatible frames", () => {
  const frame = decodeModeSFrame("8D4840D6202CC371C32CE0576098", { receivedAtMs: 1000 });
  assert.equal(frame.valid, true);
  assert.equal(frame.icao, "4840D6");
  assert.equal(frame.callsign, "KLM1023");
  assert.equal(modeSCrcValid(Uint8Array.from("8D4840D6202CC371C32CE0576098".match(/../g).map((value) => parseInt(value, 16)))), true);
});

test("ADS-B global CPR fixture resolves the known airborne position", () => {
  const even = decodeModeSFrame("8D40621D58C382D690C8AC2863A7", { receivedAtMs: 1000 });
  const odd = decodeModeSFrame("8D40621D58C386435CC412692AD6", { receivedAtMs: 1500 });
  const position = decodeGlobalCpr(even, odd);
  assert.ok(position);
  assert.ok(Math.abs(position.latitude - 52.26578) < 0.0002);
  assert.ok(Math.abs(position.longitude - 3.93891) < 0.0002);
  assert.equal(position.altitudeFeet, 38000);
});

test("ADS-B IQ fixture is recovered by the browser decoder at 2.4 Msps", () => {
  const fixture = generateAdsbIqFixture("8D4840D6202CC371C32CE0576098", { sampleRate: 2_400_000 });
  const decoder = new AdsbIqDecoder({ sampleRate: fixture.sampleRate });
  const frames = decoder.process(fixture.i, fixture.q, { receivedAtMs: 2000 });
  assert.ok(frames.length >= 1);
  assert.equal(frames[0].callsign, "KLM1023");
});



test("explicit ADS-B Simulation Mode emits a valid locally decodable fixture", async () => {
  const source = new SimulationSource({ sampleRate: 2_400_000, centerFrequencyHz: 1_090_000_000, blockSamples: 32768, scenario: "adsb" });
  const block = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { source.stop(); reject(new Error("simulation block timeout")); }, 1000);
    source.start(async (entry) => { clearTimeout(timeout); source.stop(); resolve(entry); });
  });
  const bytes = new Uint8Array(block.data);
  const samples = bytes.length / 2;
  const i = new Float32Array(samples);
  const q = new Float32Array(samples);
  for (let n = 0; n < samples; n += 1) {
    i[n] = (bytes[n * 2] - 127.5) / 112;
    q[n] = (bytes[n * 2 + 1] - 127.5) / 112;
  }
  const frames = new AdsbIqDecoder({ sampleRate: block.sampleRate }).process(i, q, { receivedAtMs: 2500 });
  assert.ok(frames.some((frame) => frame.valid && (frame.callsign === "KLM1023" || frame.position)));
});

test("v0.8 registry exposes Broadcast Radio, Scanner and ADS-B as receive applications", () => {
  for (const id of ["broadcast", "scanner", "adsbrx"]) {
    const app = APPLICATIONS.find((entry) => entry.id === id);
    assert.ok(app, `${id} must be registered`);
    assert.equal(app.category, "Receive");
    assert.equal(app.requiresTransmit, false);
    assert.equal(app.portState, "ready");
  }
});
