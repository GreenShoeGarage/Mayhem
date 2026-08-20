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

export function validateProject(candidate) {
  const errors = [];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) errors.push("Project must be a JSON object.");
  if (candidate?.schemaVersion !== PROJECT_SCHEMA_VERSION) errors.push(`Unsupported project schema ${candidate?.schemaVersion ?? "missing"}; expected ${PROJECT_SCHEMA_VERSION}.`);
  if (typeof candidate?.name !== "string" || candidate.name.length > 200) errors.push("Project name is missing or too long.");
  if (!candidate?.settings || typeof candidate.settings !== "object") errors.push("Receiver settings are missing.");
  const s = candidate?.settings ?? {};
  if (!isFiniteNumber(s.centerFrequencyHz) || s.centerFrequencyHz < 0 || s.centerFrequencyHz > 10e9) errors.push("Center frequency is invalid.");
  if (!isFiniteNumber(s.sampleRate) || s.sampleRate < 1 || s.sampleRate > 20e6) errors.push("Sample rate is invalid.");
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
    this.#setState("Unsaved");
    clearTimeout(this.#saveTimer);
    if (immediate) return this.save();
    this.#saveTimer = setTimeout(() => this.save(), 350);
    this.dispatchEvent(new CustomEvent("change", { detail: this.#project }));
    return Promise.resolve();
  }

  replace(project, state = "Restored") {
    const validation = validateProject(project);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    this.#project = structuredClone(project);
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
    const validation = validateProject(parsed);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const rollback = structuredClone(this.#project);
    try {
      this.replace(parsed, "Restored");
      await this.save();
    } catch (error) {
      this.#project = rollback;
      throw error;
    }
    return { migrated: false, schemaVersion: parsed.schemaVersion };
  }

  #restore() {
    try {
      const text = localStorage.getItem(STORAGE_KEY);
      if (!text) { this.#state = "Session only"; return createEmptyProject(); }
      const parsed = JSON.parse(text);
      const validation = validateProject(parsed);
      if (!validation.valid) { this.#state = "Storage unavailable"; return createEmptyProject(); }
      this.#state = "Restored";
      return parsed;
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
