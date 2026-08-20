import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AisIqDecoder, generateAisIqFixture, crc16X25,
  Rs41IqDecoder, generateRs41IqFixture, crc16CcittFalse,
  EpirbIqDecoder, generateEpirbIqFixture, buildEpirbStandardLocationFrame, parseEpirbFrame
} from '../../web/src/dsp/tracking-decoders.js';

function quantizedWorkerBlock(i, q) {
  const oi = new Float32Array(i.length), oq = new Float32Array(q.length);
  let mi = 0, mq = 0;
  for (let n = 0; n < i.length; n += 1) {
    const ui = Math.max(0, Math.min(255, Math.round(127.5 + i[n] * 112)));
    const uq = Math.max(0, Math.min(255, Math.round(127.5 + q[n] * 112)));
    oi[n] = (ui - 127.5) / 127.5; oq[n] = (uq - 127.5) / 127.5; mi += oi[n]; mq += oq[n];
  }
  mi /= Math.max(1, i.length); mq /= Math.max(1, q.length);
  for (let n = 0; n < i.length; n += 1) { oi[n] -= mi; oq[n] -= mq; }
  return { i: oi, q: oq };
}

function runChunked(decoder, fixture, metadata = {}) {
  const events = [];
  for (let at = 0; at < fixture.i.length; at += 32768) {
    const b = quantizedWorkerBlock(fixture.i.slice(at, at + 32768), fixture.q.slice(at, at + 32768));
    events.push(...decoder.process(b.i, b.q, { receivedAtMs: 1234567890, ...metadata }));
  }
  return events;
}

test('AIS and radiosonde CRC parameter sets match published check values', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc16X25(bytes), 0x906e);
  assert.equal(crc16CcittFalse(bytes), 0x29b1);
});

test('AIS A fixture survives quantization, worker DC removal, and normal chunk boundaries', () => {
  const fixture = generateAisIqFixture({ channel: 'A', mmsi: 367168384, latitude: 38.8895, longitude: -77.0353, speedKnots: 12.3, courseDeg: 184.2 });
  const decoder = new AisIqDecoder({ sampleRate: fixture.sampleRate });
  const events = runChunked(decoder, fixture);
  assert.equal(events.length, 1);
  assert.equal(events[0].channel, 'A');
  assert.equal(events[0].mmsi, '367168384');
  assert.equal(events[0].messageType, 1);
  assert.ok(Math.abs(events[0].latitude - 38.8895) < 0.00001);
  assert.ok(Math.abs(events[0].longitude + 77.0353) < 0.00001);
  assert.equal(decoder.snapshot().crcErrors, 0);
});

test('Vaisala RS41-SG fixture survives worker-sized block boundaries', () => {
  const fixture = generateRs41IqFixture({ serial: 'S1234567', frame: 0x1234, batteryVolts: 2.6, latitude: 48, longitude: 2, altitudeM: 1000 });
  const decoder = new Rs41IqDecoder({ sampleRate: fixture.sampleRate, frequencyHz: 400_500_000 });
  const events = runChunked(decoder, fixture, { frequencyHz: 400_500_000 });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.protocol, 'Vaisala RS41-SG');
  assert.equal(event.serial, 'S1234567');
  assert.equal(event.frame, 0x1234);
  assert.equal(event.batteryMv, 2600);
  assert.ok(Math.abs(event.latitude - 48) < 0.0001);
  assert.ok(Math.abs(event.longitude - 2) < 0.0001);
  assert.ok(Math.abs(event.altitudeM - 1000) < 1);
  assert.deepEqual(event.crcStatus, { status: true, measurement: true, gps: true });
});

test('406 MHz beacon fixture verifies BCH and Standard Location PLB position through continuous IQ', () => {
  const fixture = generateEpirbIqFixture({ countryCode: 227, typeApproval: 123, serialNumber: 4567 });
  const decoder = new EpirbIqDecoder({ sampleRate: fixture.sampleRate, frequencyHz: 406_037_000 });
  const events = runChunked(decoder, fixture, { frequencyHz: 406_037_000 });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.type, 'PLB');
  assert.equal(event.countryCode, 227);
  assert.equal(event.country, 'France');
  assert.equal(event.serialNumber, 4567);
  assert.equal(event.bch1Valid, true);
  assert.equal(event.bch2Valid, true);
  assert.equal(event.valid, true);
  assert.ok(Math.abs(event.latitude - 43.7555555556) < 1e-6);
  assert.ok(Math.abs(event.longitude - 1.5022222222) < 1e-6);
});

test('406 MHz beacon parser rejects a BCH-corrupted protected field', () => {
  const bits = buildEpirbStandardLocationFrame();
  bits[29] ^= 1;
  const event = parseEpirbFrame(bits);
  assert.equal(event.valid, false);
  assert.equal(event.bch1Valid, false);
});

test('v0.8.9 registry exposes AIS, RS41 radiosonde, and passive 406 MHz beacon receive apps', () => {
  const registry = JSON.parse(fs.readFileSync(new URL('../../src/app_registry.json', import.meta.url), 'utf8'));
  const byId = Object.fromEntries(registry.map((app) => [app.id, app]));
  assert.equal(byId.aisrx.portState, 'ready');
  assert.equal(byId.sonde.verificationState, 'fixture-tested');
  assert.equal(byId.epirbrx.requiresTransmit, false);
  assert.match(byId.epirbrx.limitations.join(' '), /passive reception|receive-only/i);
});
