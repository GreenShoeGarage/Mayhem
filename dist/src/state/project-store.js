import { APP_VERSION, DEFAULT_SETTINGS, PROJECT_SCHEMA_VERSION, UPSTREAM_COMMIT } from "../config.js";

const STORAGE_KEY = "mayhem-rtl-project-v1";
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export function createEmptyProject() {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    application: "MAYHEM RTL",
    applicationVersion: APP_VERSION,
    upstreamCommit: UPSTREAM_COMMIT,
    projectId: crypto.randomUUID?.() ?? `project-${Date.now()}`,
    name: "Untitled receiver session",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "easy",
    activeView: "home",
    settings: structuredClone(DEFAULT_SETTINGS),
    stations: [],
    markers: [],
    notes: "",
    layout: { leftOpen: true, rightOpen: true },
    diagnosticPreferences: { includeSerialOnExport: false },
    recentCaptures: []
  };
}

function isFiniteNumber(value) { return typeof value === "number" && Number.isFinite(value); }

export function migrateProject(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { project: candidate, migrated: false, fromVersion: null };
  const fromVersion = Number(candidate.schemaVersion || 0);
  if (fromVersion > PROJECT_SCHEMA_VERSION || fromVersion < 1) return { project: candidate, migrated: false, fromVersion };
  const project = structuredClone(candidate);
  project.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(project.settings || {}) };
  // Browser audio always requires a fresh user gesture after load; never restore it as already active.
  project.settings.audioEnabled = false;
  project.applicationVersion = APP_VERSION;
  project.upstreamCommit ||= UPSTREAM_COMMIT;
  project.mode ||= "easy";
  project.layout = { leftOpen: true, rightOpen: true, ...(project.layout || {}) };
  project.diagnosticPreferences = { includeSerialOnExport: false, ...(project.diagnosticPreferences || {}) };
  project.recentCaptures ||= [];
  project.stations = Array.isArray(project.stations) ? project.stations.map((station) => ({
    modulation: project.settings.modulation,
    audioBandwidthHz: project.settings.audioBandwidthHz,
    squelchDb: project.settings.squelchDb,
    volume: project.settings.volume,
    ritHz: project.settings.ritHz,
    cwPitchHz: project.settings.cwPitchHz,
    ssbLowCutHz: project.settings.ssbLowCutHz,
    agcMode: project.settings.agcMode,
    ...station
  })) : [];
  project.schemaVersion = PROJECT_SCHEMA_VERSION;
  return { project, migrated: fromVersion !== PROJECT_SCHEMA_VERSION, fromVersion };
}

export function validateProject(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) errors.push("Project must be a JSON object.");
  if (candidate?.schemaVersion !== PROJECT_SCHEMA_VERSION) errors.push(`Unsupported project schema ${candidate?.schemaVersion ?? "missing"}; expected ${PROJECT_SCHEMA_VERSION}.`);
  if (typeof candidate?.name !== "string" || candidate.name.length > 200) errors.push("Project name is missing or too long.");
  if (!candidate?.settings || typeof candidate.settings !== "object") errors.push("Receiver settings are missing.");
  const s = candidate?.settings ?? {};
  if (!isFiniteNumber(s.centerFrequencyHz) || s.centerFrequencyHz < 0 || s.centerFrequencyHz > 10e9) errors.push("Center frequency is invalid.");
  if (!isFiniteNumber(s.sampleRate) || s.sampleRate < 1 || s.sampleRate > 20e6) errors.push("Sample rate is invalid.");
  if (!["wfm", "nfm", "am", "usb", "lsb", "cw"].includes(s.modulation)) errors.push("Demodulation mode is invalid.");
  if (!isFiniteNumber(s.volume) || s.volume < 0 || s.volume > 1) errors.push("Audio volume is invalid.");
  if (!isFiniteNumber(s.squelchDb) || s.squelchDb < -140 || s.squelchDb > 0) errors.push("Squelch threshold is invalid.");
  if (!["auto", "compatibility", "high-rate", "custom"].includes(s.performanceProfile)) errors.push("Performance profile is invalid.");
  if (!isFiniteNumber(s.processingQueueDepth) || s.processingQueueDepth < 2 || s.processingQueueDepth > 8) errors.push("Processing queue depth is invalid.");
  if (!isFiniteNumber(s.displayRateHz) || s.displayRateHz < 8 || s.displayRateHz > 60) errors.push("Display update rate is invalid.");
  if (!["fm", "am"].includes(s.broadcastBand)) errors.push("Broadcast band preset is invalid.");
  if (!isFiniteNumber(s.broadcastStepHz) || s.broadcastStepHz < 1_000 || s.broadcastStepHz > 1_000_000) errors.push("Broadcast channel step is invalid.");
  if (!isFiniteNumber(s.scannerStartHz) || !isFiniteNumber(s.scannerEndHz) || s.scannerStartHz < 0 || s.scannerEndHz < s.scannerStartHz) errors.push("Scanner range is invalid.");
  if (!isFiniteNumber(s.scannerStepHz) || s.scannerStepHz < 1 || s.scannerStepHz > 10_000_000) errors.push("Scanner step is invalid.");
  if (!isFiniteNumber(s.scannerDwellMs) || s.scannerDwellMs < 20 || s.scannerDwellMs > 10_000) errors.push("Scanner dwell time is invalid.");
  if (!isFiniteNumber(s.scannerThresholdDbfs) || s.scannerThresholdDbfs < -140 || s.scannerThresholdDbfs > 0) errors.push("Scanner threshold is invalid.");
  if (!['160m','80m','60m','40m','30m','20m','17m','15m','12m','10m','6m','2m','1.25m','70cm'].includes(s.amateurBand)) errors.push("Amateur band preset is invalid.");
  if (!isFiniteNumber(s.amateurStepHz) || s.amateurStepHz < 10 || s.amateurStepHz > 100_000) errors.push("Amateur tuning step is invalid.");
  if (!isFiniteNumber(s.ssbLowCutHz) || s.ssbLowCutHz < 0 || s.ssbLowCutHz > 2000) errors.push("SSB low-cut setting is invalid.");
  if (!isFiniteNumber(s.ritHz) || s.ritHz < -10_000 || s.ritHz > 10_000) errors.push("Receiver Incremental Tuning offset is invalid.");
  if (!isFiniteNumber(s.cwPitchHz) || s.cwPitchHz < 200 || s.cwPitchHz > 1500) errors.push("CW pitch is invalid.");
  if (!["off", "slow", "medium", "fast"].includes(s.agcMode)) errors.push("Audio Automatic Gain Control mode is invalid.");
  if (!Array.isArray(candidate?.stations) || candidate.stations.length > 5000) errors.push("Station list is invalid or too large.");
  if (!Array.isArray(candidate?.markers) || candidate.markers.length > 1000) errors.push("Marker list is invalid or too large.");
  return { valid: errors.length === 0, errors };
}

export class ProjectStore extends EventTarget {
  #project;
  #saveTimer = null;
  #saveSequence = 0;
  #state = "Restored";

  constructor() {
    super();
    this.#project = this.#restore();
  }

  get project() { return this.#project; }
  get saveState() { return this.#state; }

  update(mutator, { immediate = false } = {}) {
    mutator(this.#project);
    this.#project.updatedAt = new Date().toISOString();
    this.#project.applicationVersion = APP_VERSION;
    this.#setState("Unsaved");
    clearTimeout(this.#saveTimer);
    if (immediate) return this.save();
    this.#saveTimer = setTimeout(() => this.save(), 350);
    this.dispatchEvent(new CustomEvent("change", { detail: this.#project }));
    return Promise.resolve();
  }

  replace(project, state = "Restored") {
    const migrated = migrateProject(project);
    const validation = validateProject(migrated.project);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    this.#project = structuredClone(migrated.project);
    this.#setState(state);
    this.dispatchEvent(new CustomEvent("change", { detail: this.#project }));
  }

  async save() {
    const sequence = ++this.#saveSequence;
    this.#setState("Saving");
    await Promise.resolve();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#project));
      if (sequence === this.#saveSequence) this.#setState("Saved locally");
    } catch (error) {
      this.#setState("Save failed", error);
      throw error;
    }
  }

  freshStart() {
    clearTimeout(this.#saveTimer);
    this.#project = createEmptyProject();
    localStorage.removeItem(STORAGE_KEY);
    this.#setState("Unsaved");
    this.dispatchEvent(new CustomEvent("change", { detail: this.#project }));
  }

  clearLocal() {
    clearTimeout(this.#saveTimer);
    localStorage.removeItem(STORAGE_KEY);
    this.#project = createEmptyProject();
    this.#setState("Session only");
    this.dispatchEvent(new CustomEvent("change", { detail: this.#project }));
  }

  exportJson() {
    const output = structuredClone(this.#project);
    output.exportedAt = new Date().toISOString();
    return JSON.stringify(output, null, 2);
  }

  async importFile(file) {
    if (!(file instanceof File)) throw new Error("No project file was selected.");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("Project file exceeds the 4 MiB import limit.");
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { throw new Error("Project file is not valid JSON."); }
    const migration = migrateProject(parsed);
    const validation = validateProject(migration.project);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const rollback = structuredClone(this.#project);
    try {
      this.replace(migration.project, "Restored");
      await this.save();
    } catch (error) {
      this.#project = rollback;
      throw error;
    }
    return { migrated: migration.migrated, fromVersion: migration.fromVersion, schemaVersion: migration.project.schemaVersion };
  }

  #restore() {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (!text) { this.#state = "Session only"; return createEmptyProject(); }
      const parsed = JSON.parse(text);
      const migration = migrateProject(parsed);
      const validation = validateProject(migration.project);
      if (!validation.valid) { this.#state = "Storage unavailable"; return createEmptyProject(); }
      if (migration.migrated) localStorage.setItem(STORAGE_KEY, JSON.stringify(migration.project));
      this.#state = "Restored";
      return migration.project;
    } catch {
      this.#state = "Storage unavailable";
      return createEmptyProject();
    }
  }

  #setState(state, error = null) {
    this.#state = state;
    this.dispatchEvent(new CustomEvent("save-state", { detail: { state, error } }));
  }
}
