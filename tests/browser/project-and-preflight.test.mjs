import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyProject, validateProject } from "../../web/src/state/project-store.js";
import { runPreflight } from "../../web/src/diagnostics/preflight.js";

if (!globalThis.crypto?.randomUUID) globalThis.crypto = { ...globalThis.crypto, randomUUID: () => "test-project" };

test("fresh projects are empty and schema-valid", () => {
  const project = createEmptyProject();
  assert.deepEqual(project.stations, []);
  assert.deepEqual(project.markers, []);
  assert.equal(validateProject(project).valid, true);
});

test("project validation rejects malformed frequencies and oversized station collections", () => {
  const project = createEmptyProject();
  project.settings.centerFrequencyHz = Number.NaN;
  project.stations = new Array(5001).fill({});
  const result = validateProject(project);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 2);
});

test("preflight labels missing WebUSB as a live-radio blocker without blocking local compatibility paths", () => {
  const scope = {
    isSecureContext: true,
    navigator: { storage: {}, serviceWorker: {} },
    WebAssembly: {}, Worker: class {}, SharedArrayBuffer: undefined,
    crossOriginIsolated: false,
    indexedDB: {}, AudioWorkletNode: undefined
  };
  const result = runPreflight(scope);
  assert.equal(result.liveRadioEligible, false);
  assert.equal(result.compatibilityMode, true);
  assert.equal(result.results.find((entry) => entry.id === "webusb").status, "fail");
});

test("schema 1 projects migrate audio and performance settings into the current schema", async () => {
  const { migrateProject, validateProject } = await import("../../web/src/state/project-store.js");
  const legacy = {
    schemaVersion: 1,
    application: "MAYHEM RTL",
    applicationVersion: "0.3.1",
    upstreamCommit: "44736b9c",
    projectId: "legacy",
    name: "Legacy",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    mode: "easy",
    activeView: "receiver",
    settings: { centerFrequencyHz: 100_000_000, sampleRate: 1_024_000, gainMode: "automatic", gainDb: 28, ppm: 0 },
    stations: [], markers: [], notes: "", layout: { leftOpen: true, rightOpen: true }, diagnosticPreferences: { includeSerialOnExport: false }, recentCaptures: []
  };
  const result = migrateProject(legacy);
  assert.equal(result.migrated, true);
  assert.equal(result.project.schemaVersion, 3);
  assert.equal(result.project.settings.modulation, "wfm");
  assert.equal(result.project.settings.audioOutputRate, 48000);
  assert.equal(result.project.settings.performanceProfile, "auto");
  assert.equal(result.project.settings.processingQueueDepth, 4);
  assert.equal(validateProject(result.project).valid, true);
});
