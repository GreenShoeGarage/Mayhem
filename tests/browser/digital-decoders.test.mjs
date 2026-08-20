import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  AFSK_MODEM_PRESETS,
  RTTY_PRESETS,
  AfskTerminalIqDecoder,
  AprsIqDecoder,
  AcarsIqDecoder,
  RttyIqDecoder,
  MorseIqDecoder,
  crc16Ax25,
  crc16Xmodem,
  generateAfskIqFixture,
  generateAprsIqFixture,
  generateAcarsIqFixture,
  generateRttyIqFixture,
  generateMorseIqFixture,
  parseAprsFrame,
  parseAcarsBlock
} from "../../web/src/dsp/digital-decoders.js";
import { APPLICATIONS } from "../../web/src/apps/compatibility-manifest.js";
import { simulationScenarios } from "../../web/src/simulation/simulation-source.js";

function processChunked(decoder, fixture, options = {}, block = 32768) {
  const events = [];
  for (let offset = 0; offset < fixture.i.length; offset += block) {
    events.push(...decoder.process(
      fixture.i.subarray(offset, offset + block),
      fixture.q.subarray(offset, offset + block),
      { sampleRate: fixture.sampleRate, ...options }
    ));
  }
  return events;
}

function textFrom(events) {
  return events.filter((entry) => entry.type === "text").map((entry) => entry.text).join("");
}

test("AFSK modem presets preserve Mayhem Bell/V-series receive definitions", () => {
  assert.deepEqual(
    Object.values(AFSK_MODEM_PRESETS).map(({ name, markHz, spaceHz, baud }) => [name, markHz, spaceHz, baud]),
    [
      ["Bell 202", 1200, 2200, 1200],
      ["Bell 103", 1270, 1070, 300],
      ["V.21", 980, 1180, 300],
      ["V.23 Mode 1", 1300, 1700, 600],
      ["V.23 Mode 2", 1300, 2100, 1200]
    ]
  );
  assert.equal(RTTY_PRESETS.eu.markHz - RTTY_PRESETS.eu.spaceHz, 170);
  assert.equal(RTTY_PRESETS.us.markHz - RTTY_PRESETS.us.spaceHz, 170);
});

test("AX.25 and ACARS CRC engines match independent protocol check values", () => {
  const check = Uint8Array.from(Buffer.from("123456789", "ascii"));
  assert.equal(crc16Xmodem(check), 0x31c3);
  // CRC-16/X-25 / AX.25 check value for the same canonical byte string.
  assert.equal(crc16Ax25(check), 0x906e);
});

test("AFSK deterministic IQ remains continuous across worker-sized chunks", () => {
  const fixture = generateAfskIqFixture({ sampleRate: 1_024_000, text: "MAYHEM RTL AFSK TEST\r\n" });
  const decoder = new AfskTerminalIqDecoder({ sampleRate: fixture.sampleRate, profile: "bell202" });
  const events = processChunked(decoder, fixture);
  assert.ok(textFrom(events).includes("MAYHEM RTL AFSK TEST"));
  assert.equal(decoder.snapshot().bitRate, 1200);
  assert.notEqual(decoder.snapshot().activeLane, null);
});

test("APRS Bell 202/NRZI/HDLC fixture decodes AX.25 fields and position", () => {
  const fixture = generateAprsIqFixture({ sampleRate: 1_024_000 });
  const parsed = parseAprsFrame(fixture.frame);
  assert.equal(parsed.crcOk, true);
  assert.equal(parsed.source, "N0CALL-1");
  assert.equal(parsed.destination, "APRS");
  assert.equal(parsed.latitude, 39);
  assert.equal(parsed.longitude, -77);

  const decoder = new AprsIqDecoder({ sampleRate: fixture.sampleRate });
  const events = processChunked(decoder, fixture);
  const frame = events.find((entry) => entry.type === "frame" && entry.info.includes("MAYHEM RTL APRS TEST"));
  assert.ok(frame);
  assert.equal(frame.crcOk, true);
  assert.equal(frame.source, "N0CALL-1");
  assert.equal(frame.destination, "APRS");
  assert.equal(frame.latitude, 39);
  assert.equal(frame.longitude, -77);
});

test("ACARS AM/MSK fixture preserves parity, CRC, and ARINC 618 fields with an IF offset", () => {
  const fixture = generateAcarsIqFixture({ sampleRate: 1_024_000, carrierOffsetHz: -12_000 });
  const parsed = parseAcarsBlock(fixture.body, (fixture.crc >> 8) & 0xff, fixture.crc & 0xff, 0);
  assert.equal(parsed.crcOk, true);
  assert.equal(parsed.registration, "CEFIJLO");
  assert.equal(parsed.flightId, "WX1278");

  const decoder = new AcarsIqDecoder({ sampleRate: fixture.sampleRate, channelOffsetHz: -12_000 });
  const events = processChunked(decoder, fixture, { channelOffsetHz: -12_000 });
  const frame = events.find((entry) => entry.type === "frame");
  assert.ok(frame);
  assert.equal(frame.crcOk, true);
  assert.equal(frame.registration, "CEFIJLO");
  assert.equal(frame.label, "Q1");
  assert.equal(frame.blockId, "R");
  assert.equal(frame.messageNumber, "T24");
  assert.equal(frame.flightId, "WX1278");
  assert.match(frame.text, /MAYHEM RTL ACARS TEST/);
  assert.equal(frame.parityErrors, 0);
});

test("RTTY 45.45 baud 170 Hz-shift fixture decodes ITA2 text", () => {
  const fixture = generateRttyIqFixture({ sampleRate: 256_000, text: "MAYHEM RTL RTTY TEST", profile: "eu" });
  const decoder = new RttyIqDecoder({ sampleRate: fixture.sampleRate, profile: "eu", sideband: "usb" });
  const events = processChunked(decoder, fixture, {}, 16384);
  assert.ok(textFrom(events).includes("MAYHEM RTL RTTY TEST"));
  assert.equal(decoder.snapshot().profile, "eu");
  assert.equal(decoder.snapshot().sideband, "usb");
});

test("Morse CW fixture survives worker-style per-block DC removal and decodes configured-speed text", () => {
  const fixture = generateMorseIqFixture({ sampleRate: 256_000, text: "MAYHEM RTL MORSE TEST", wpm: 20 });
  const decoder = new MorseIqDecoder({ sampleRate: fixture.sampleRate, wpm: 20, pitchHz: 700, threshold: 0.035, channelOffsetHz: fixture.carrierOffsetHz });
  const events = [];
  const block = 16384;
  for (let offset = 0; offset < fixture.i.length; offset += block) {
    const i = fixture.i.slice(offset, offset + block), q = fixture.q.slice(offset, offset + block);
    let meanI = 0, meanQ = 0;
    for (let n = 0; n < i.length; n += 1) { meanI += i[n]; meanQ += q[n]; }
    meanI /= Math.max(1, i.length); meanQ /= Math.max(1, q.length);
    for (let n = 0; n < i.length; n += 1) { i[n] -= meanI; q[n] -= meanQ; }
    events.push(...decoder.process(i, q, { sampleRate: fixture.sampleRate }));
  }
  assert.ok(textFrom(events).includes("MAYHEM RTL MORSE TEST"));
  assert.equal(decoder.snapshot().wpm, 20);
  assert.equal(decoder.snapshot().pitchHz, 700);
  assert.equal(decoder.snapshot().channelOffsetHz, fixture.carrierOffsetHz);
});

test("v0.8.5 registry and Simulation Mode expose all five digital receive applications", () => {
  const scenarios = simulationScenarios();
  for (const id of ["afsk", "aprs", "acars", "rtty", "morse"]) {
    const app = APPLICATIONS.find((entry) => entry.id === id);
    assert.ok(app, `${id} must be registered`);
    assert.equal(app.category, "Receive");
    assert.equal(app.requiresReceive, true);
    assert.equal(app.requiresTransmit, false);
    assert.equal(app.portState, "ready");
    assert.equal(app.verificationState, "fixture-tested");
    assert.ok(scenarios[id], `${id} must have a deterministic simulation scenario`);
  }
});

test("digital decoder applications consume continuous worker IQ and keep speaker audio optional", async () => {
  const worker = await readFile("web/src/workers/processing-worker.js", "utf8");
  const app = await readFile("web/src/app.js", "utf8");
  assert.match(worker, /digitalDecoders/);
  assert.match(worker, /type: "digital"/);
  assert.match(worker, /type: "digital-status"/);
  assert.match(app, /DIGITAL DECODERS/);
  assert.match(app, /decoder receives continuous IQ directly in the processing worker/);
  assert.match(app, /Monitor Audio/);
  assert.match(app, /Intermediate-frequency offset/);
});
