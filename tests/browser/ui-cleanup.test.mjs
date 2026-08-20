import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const index = await readFile('web/index.html', 'utf8');
const app = await readFile('web/src/app.js', 'utf8');
const css = await readFile('web/styles.css', 'utf8');

test('v0.8.11 navigation is grouped by user task', () => {
  for (const label of ['START', 'LISTEN', 'DECODE', 'ANALYZE', 'REVIEW', 'SUPPORT']) assert.ok(index.includes(`>${label}<`), label);
  assert.ok(index.includes('>Receiver Library<'));
  assert.ok(css.includes('.nav-section-label'));
  assert.ok(css.includes('.app-shell[data-left-open="false"] .nav-button span:last-child'));
});

test('Easy Mode keeps implementation/system detail out of the primary path', () => {
  assert.match(index, /advanced-control[^>]*data-view="compatibility"|data-view="compatibility"[^>]*advanced-control/);
  assert.match(index, /advanced-control[^>]*data-view="diagnostics"|data-view="diagnostics"[^>]*advanced-control/);
  assert.match(index, /advanced-control[^>]*data-view="settings"|data-view="settings"[^>]*advanced-control/);
  for (const id of ['statusTuner', 'statusRate', 'statusGain', 'statusQueue', 'statusPerformance']) {
    const at = index.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    assert.ok(index.slice(Math.max(0, at - 120), at).includes('advanced-status'), `${id} should be advanced-only`);
  }
});

test('Home is task-first instead of duplicating source cards', () => {
  assert.ok(app.includes('What do you want to do?'));
  for (const id of ['homeOpenReceiver', 'homeOpenSstv', 'homeOpenDigital', 'homeOpenAnalysis', 'homeOpenLibrary', 'homeOpenCaptures']) assert.ok(app.includes(`id=\"${id}\"`) || app.includes(`id="${id}"`), id);
  assert.ok(!app.includes('id="homeConnect2"'));
  assert.ok(!app.includes('id="homeSimulation2"'));
  assert.ok(css.includes('.task-grid'));
  assert.ok(css.includes('.source-summary-card'));
});

test('Receiver uses one stateful start-stop control and hides unused manual gain', () => {
  assert.ok(app.includes('id="quickStart"'));
  assert.ok(!app.includes('id="quickStop"'));
  assert.match(app, /quickStart"\)\.textContent = sourceRunning \? "Stop Receiver" : "Start Receiver"/);
  assert.match(app, /wrap\.classList\.toggle\("hidden", settings\.gainMode === "automatic"\)/);
});

test('Receiver Library is searchable, task-filtered, and separates unavailable transmit entries', () => {
  assert.ok(app.includes('id="applicationSearch"'));
  for (const filter of ['featured', 'listen', 'decode', 'analyze', 'review', 'system', 'unavailable', 'all']) assert.ok(app.includes(`[\"${filter}\"`) || app.includes(`"${filter}"`), filter);
  assert.ok(app.includes('FEATURED_APPLICATIONS'));
  assert.ok(app.includes('application.requiresTransmit'));
  assert.ok(css.includes('.library-toolbar'));
  assert.ok(css.includes('.library-filter.active'));
});

test('Advanced inspector follows all modern receive workspaces', () => {
  assert.ok(app.includes('"pocsag", "paging", "digital", "telemetry", "tracking", "sstv", "adsb"'));
});
