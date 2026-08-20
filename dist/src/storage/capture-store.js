import { APP_VERSION, CAPTURE_FORMAT, UPSTREAM_COMMIT } from "../config.js";
import { makeId, safeFilename } from "../utils/format.js";

const DATABASE_NAME = "mayhem-rtl-storage-v1";
const DATABASE_VERSION = 1;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("Indexed Database request failed")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Indexed Database transaction aborted")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Indexed Database transaction failed")), { once: true });
  });
}

async function openDatabase() {
  if (!globalThis.indexedDB) throw new Error("Indexed Database is unavailable.");
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("captures")) database.createObjectStore("captures", { keyPath: "id" });
    if (!database.objectStoreNames.contains("chunks")) {
      const store = database.createObjectStore("chunks", { keyPath: ["captureId", "sequence"] });
      store.createIndex("captureId", "captureId", { unique: false });
    }
  });
  return requestToPromise(request);
}

export class CaptureStore {
  constructor({ log }) {
    this.log = log;
    this.databasePromise = openDatabase().catch((error) => { this.log?.warn("Capture database unavailable", { message: error.message }); throw error; });
    this.active = null;
  }

  async storageEstimate() {
    if (!navigator.storage?.estimate) return { usage: null, quota: null, available: null, persisted: false };
    const estimate = await navigator.storage.estimate();
    const persisted = await navigator.storage.persisted?.().catch(() => false) ?? false;
    return { usage: estimate.usage ?? null, quota: estimate.quota ?? null, available: estimate.quota != null && estimate.usage != null ? Math.max(0, estimate.quota - estimate.usage) : null, persisted };
  }

  async requestPersistence() {
    return navigator.storage?.persist ? navigator.storage.persist() : false;
  }

  async start(metadata) {
    if (this.active) throw new Error("A capture is already active.");
    const id = makeId("capture");
    const now = new Date().toISOString();
    const record = {
      id,
      name: metadata.name || `Capture ${now}`,
      fileName: `${safeFilename(metadata.name || id, id)}.cu8`,
      format: CAPTURE_FORMAT,
      sampleFormat: "unsigned 8-bit interleaved In-phase and Quadrature",
      sampleRate: Number(metadata.sampleRate),
      centerFrequencyHz: Number(metadata.centerFrequencyHz),
      tuner: metadata.tuner || "unknown",
      gainDb: metadata.gainDb ?? null,
      automaticGainControl: metadata.gainDb == null,
      frequencyCorrectionPpm: Number(metadata.frequencyCorrectionPpm ?? 0),
      modulation: metadata.modulation || "unknown",
      audioBandwidthHz: Number(metadata.audioBandwidthHz ?? 0),
      squelchDb: Number(metadata.squelchDb ?? -55),
      ritHz: Number(metadata.ritHz ?? 0),
      cwPitchHz: Number(metadata.cwPitchHz ?? 700),
      ssbLowCutHz: Number(metadata.ssbLowCutHz ?? 300),
      agcMode: String(metadata.agcMode ?? "off"),
      directSampling: String(metadata.directSampling ?? "off"),
      source: metadata.source || "unknown",
      deviceIdentifier: metadata.deviceIdentifier || "",
      applicationVersion: APP_VERSION,
      upstreamCommit: UPSTREAM_COMMIT,
      startedAt: now,
      stoppedAt: null,
      bytes: 0,
      complexSamples: 0,
      droppedSamples: 0,
      chunks: 0,
      storageBackend: "indexeddb",
      opfsFileName: null,
      notes: String(metadata.notes ?? "").slice(0, 20_000),
      complete: false,
      recoveryState: "active"
    };

    let writable = null;
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const opfsFileName = `${id}.cu8`;
        const handle = await root.getFileHandle(opfsFileName, { create: true });
        writable = await handle.createWritable({ keepExistingData: false });
        record.storageBackend = "opfs";
        record.opfsFileName = opfsFileName;
      } catch (error) {
        this.log?.warn("Origin Private File System unavailable; using Indexed Database capture chunks", { message: error.message });
      }
    }

    const database = await this.databasePromise;
    const transaction = database.transaction("captures", "readwrite");
    transaction.objectStore("captures").put(record);
    await transactionDone(transaction);
    this.active = { record, writable, nextSequence: 0, writeTail: Promise.resolve(), backlog: 0, failed: null };
    this.log?.info("Capture started", { id, backend: record.storageBackend, sampleRate: record.sampleRate });
    return structuredClone(record);
  }

  append(buffer) {
    if (!this.active) return Promise.reject(new Error("No capture is active."));
    if (!(buffer instanceof ArrayBuffer)) return Promise.reject(new TypeError("Capture chunk must be an ArrayBuffer."));
    const session = this.active;
    const sequence = session.nextSequence++;
    session.backlog += 1;
    const data = buffer.slice(0);
    session.writeTail = session.writeTail.then(async () => {
      if (session.failed) throw session.failed;
      if (session.record.storageBackend === "opfs") {
        await session.writable.write(new Uint8Array(data));
      } else {
        const database = await this.databasePromise;
        const transaction = database.transaction("chunks", "readwrite");
        transaction.objectStore("chunks").put({ captureId: session.record.id, sequence, data });
        await transactionDone(transaction);
      }
      session.record.bytes += data.byteLength;
      session.record.complexSamples += data.byteLength / 2;
      session.record.chunks += 1;
    }).catch((error) => {
      session.failed = error;
      throw error;
    }).finally(() => { session.backlog = Math.max(0, session.backlog - 1); });
    return session.writeTail;
  }

  get activeStatus() {
    if (!this.active) return null;
    return { id: this.active.record.id, bytes: this.active.record.bytes, chunks: this.active.record.chunks, backlog: this.active.backlog, failed: this.active.failed?.message ?? null, startedAt: this.active.record.startedAt, backend: this.active.record.storageBackend };
  }

  async stop({ droppedSamples = 0, notes = undefined, recoveryState = "complete" } = {}) {
    if (!this.active) return null;
    const session = this.active;
    this.active = null;
    try { await session.writeTail; }
    catch (error) { session.failed = error; }
    try { if (session.writable) await session.writable.close(); }
    catch (error) { session.failed ??= error; }
    session.record.stoppedAt = new Date().toISOString();
    session.record.droppedSamples = Number(droppedSamples) || 0;
    if (notes !== undefined) session.record.notes = String(notes).slice(0, 20_000);
    session.record.complete = !session.failed && recoveryState === "complete";
    session.record.recoveryState = session.failed ? "write-failed" : recoveryState;
    const database = await this.databasePromise;
    const transaction = database.transaction("captures", "readwrite");
    transaction.objectStore("captures").put(session.record);
    await transactionDone(transaction);
    this.log?.info("Capture stopped", { id: session.record.id, bytes: session.record.bytes, complete: session.record.complete, failure: session.failed?.message });
    if (session.failed) throw new Error(`Capture closed with a storage failure: ${session.failed.message}`);
    return structuredClone(session.record);
  }

  async list() {
    const database = await this.databasePromise;
    const transaction = database.transaction("captures", "readonly");
    const records = await requestToPromise(transaction.objectStore("captures").getAll());
    await transactionDone(transaction);
    return records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  async get(id) {
    const database = await this.databasePromise;
    const transaction = database.transaction("captures", "readonly");
    const record = await requestToPromise(transaction.objectStore("captures").get(id));
    await transactionDone(transaction);
    return record ?? null;
  }

  async getCaptureBlob(record) {
    if (record.storageBackend === "opfs" && record.opfsFileName && navigator.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(record.opfsFileName);
      return handle.getFile();
    }
    const database = await this.databasePromise;
    const transaction = database.transaction("chunks", "readonly");
    const index = transaction.objectStore("chunks").index("captureId");
    const chunks = await requestToPromise(index.getAll(IDBKeyRange.only(record.id)));
    await transactionDone(transaction);
    chunks.sort((a, b) => a.sequence - b.sequence);
    return new Blob(chunks.map((chunk) => chunk.data), { type: "application/octet-stream" });
  }

  async delete(id) {
    const record = await this.get(id);
    if (!record) return;
    if (record.storageBackend === "opfs" && record.opfsFileName && navigator.storage?.getDirectory) {
      try { const root = await navigator.storage.getDirectory(); await root.removeEntry(record.opfsFileName); } catch { /* metadata deletion still proceeds */ }
    }
    const database = await this.databasePromise;
    const transaction = database.transaction(["captures", "chunks"], "readwrite");
    transaction.objectStore("captures").delete(id);
    const chunkStore = transaction.objectStore("chunks");
    const index = chunkStore.index("captureId");
    const cursorRequest = index.openKeyCursor(IDBKeyRange.only(id));
    cursorRequest.addEventListener("success", () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      chunkStore.delete(cursor.primaryKey);
      cursor.continue();
    });
    await transactionDone(transaction);
  }

  async clearAll() {
    const records = await this.list();
    for (const record of records) await this.delete(record.id);
  }
}
