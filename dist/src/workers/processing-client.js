import { SharedBlockPool } from "./shared-block-pool.js";

export class ProcessingClient extends EventTarget {
  constructor({ workerUrl, wasmUrl, settings, log, maxPendingBlocks = 4, preferSharedMemory = true }) {
    super();
    this.log = log;
    this.maxPendingBlocks = Math.max(2, Math.min(8, Math.round(Number(maxPendingBlocks) || 4)));
    this.pending = 0;
    this.ready = false;
    this.wasmMode = "starting";
    this.sharedPool = null;
    this.transportMode = "transferable";

    const sharedEligible = preferSharedMemory && globalThis.crossOriginIsolated === true && typeof globalThis.SharedArrayBuffer === "function";
    if (sharedEligible) {
      try {
        this.sharedPool = new SharedBlockPool({ slotBytes: 131072, slots: 8 });
        this.transportMode = "shared-block-pool";
      } catch (error) {
        this.log?.warn("Shared sample pool could not start; transferable buffers remain active", { message: error.message });
      }
    }

    this.worker = new Worker(workerUrl, { type: "module", name: "mayhem-rtl-processing" });
    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Processing worker startup timed out.")), 8000);
      this.worker.addEventListener("message", (event) => {
        if (event.data?.type === "ready") {
          clearTimeout(timeout);
          this.ready = true;
          this.wasmMode = event.data.wasmMode;
          resolve({ ...event.data, transportMode: this.transportMode });
        }
      });
      this.worker.addEventListener("error", (event) => { clearTimeout(timeout); reject(event.error ?? new Error(event.message)); }, { once: true });
    });
    this.worker.addEventListener("message", (event) => this.#handleMessage(event.data));
    this.worker.addEventListener("error", (event) => {
      this.log?.error("Processing worker error", { message: event.message });
      this.sharedPool?.reset();
      this.dispatchEvent(new CustomEvent("error", { detail: event.error ?? new Error(event.message) }));
    });
    this.worker.postMessage({
      type: "init",
      wasmUrl: String(wasmUrl),
      settings,
      sharedPool: this.sharedPool ? { buffer: this.sharedPool.buffer, slotBytes: this.sharedPool.slotBytes, slots: this.sharedPool.slots } : null
    });
  }

  async waitUntilReady() { return this.readyPromise; }

  setCapacity(value) {
    this.maxPendingBlocks = Math.max(2, Math.min(8, Math.round(Number(value) || 4)));
    this.#emitQueue();
  }

  processBlock(block) {
    if (!this.ready || this.pending >= this.maxPendingBlocks) return false;
    if (!(block.data instanceof ArrayBuffer)) throw new TypeError("Processing block data must be an ArrayBuffer.");

    const common = {
      sequence: block.sequence,
      sampleRate: block.sampleRate,
      frequency: block.frequency,
      receivedAt: block.receivedAt
    };

    if (this.sharedPool) {
      const shared = this.sharedPool.acquire(block.data);
      if (!shared) return false;
      this.pending += 1;
      this.worker.postMessage({ type: "block-shared", ...common, sharedSlot: shared.slot, length: shared.length });
      this.#emitQueue();
      return true;
    }

    this.pending += 1;
    this.worker.postMessage({ type: "block", ...common, buffer: block.data }, [block.data]);
    this.#emitQueue();
    return true;
  }

  updateSettings(settings, resetAveraging = false, resetAudio = false, resetDecoder = false) {
    this.worker.postMessage({ type: "settings", settings, resetAveraging, resetAudio, resetDecoder });
  }

  reset() {
    // Do not mark shared slots free here: older block messages are ordered before
    // this reset in the worker queue and may still be reading them. Their ACKs
    // release the slots safely; new blocks can use only genuinely free slots.
    this.pending = 0;
    this.worker.postMessage({ type: "reset" });
    this.#emitQueue();
  }

  close() {
    this.worker.terminate();
    this.ready = false;
    this.pending = 0;
    this.sharedPool?.reset();
  }

  snapshot() {
    return {
      ready: this.ready,
      wasmMode: this.wasmMode,
      transportMode: this.transportMode,
      pending: this.pending,
      capacity: this.maxPendingBlocks,
      sharedPool: this.sharedPool?.snapshot() ?? null
    };
  }

  #emitQueue() {
    this.dispatchEvent(new CustomEvent("queue", { detail: { ...this.snapshot() } }));
  }

  #handleMessage(message) {
    if (["processed", "ack"].includes(message?.type)) {
      if (Number.isInteger(message.sharedSlot)) this.sharedPool?.release(message.sharedSlot);
      this.pending = Math.max(0, this.pending - 1);
      this.#emitQueue();
    }
    if (message?.type === "processed") this.dispatchEvent(new CustomEvent("spectrum", { detail: message }));
    else if (message?.type === "ack") this.dispatchEvent(new CustomEvent("ack", { detail: message }));
    else if (message?.type === "audio") this.dispatchEvent(new CustomEvent("audio", { detail: message }));
    else if (message?.type === "adsb") this.dispatchEvent(new CustomEvent("adsb", { detail: message.frame }));
    else if (message?.type === "pocsag") this.dispatchEvent(new CustomEvent("pocsag", { detail: message.page }));
    else if (message?.type === "pocsag-status") this.dispatchEvent(new CustomEvent("pocsag-status", { detail: message.status }));
    else if (message?.type === "digital") this.dispatchEvent(new CustomEvent("digital", { detail: { mode: message.mode, event: message.event } }));
    else if (message?.type === "digital-status") this.dispatchEvent(new CustomEvent("digital-status", { detail: { mode: message.mode, status: message.status } }));
    else if (message?.type === "telemetry") this.dispatchEvent(new CustomEvent("telemetry", { detail: { mode: message.mode, event: message.event } }));
    else if (message?.type === "telemetry-status") this.dispatchEvent(new CustomEvent("telemetry-status", { detail: { mode: message.mode, status: message.status } }));
    else if (message?.type === "paging") this.dispatchEvent(new CustomEvent("paging", { detail: { mode: message.mode, event: message.event } }));
    else if (message?.type === "paging-status") this.dispatchEvent(new CustomEvent("paging-status", { detail: { mode: message.mode, status: message.status } }));
    else if (message?.type === "tracking") this.dispatchEvent(new CustomEvent("tracking", { detail: { mode: message.mode, event: message.event } }));
    else if (message?.type === "tracking-status") this.dispatchEvent(new CustomEvent("tracking-status", { detail: { mode: message.mode, status: message.status } }));
    else if (message?.type === "sstv") this.dispatchEvent(new CustomEvent("sstv", { detail: message.event }));
    else if (message?.type === "sstv-status") this.dispatchEvent(new CustomEvent("sstv-status", { detail: message.status }));
    else if (message?.type === "timeseries") this.dispatchEvent(new CustomEvent("timeseries", { detail: message }));
    else if (message?.type === "warning") { this.log?.warn(message.message, { detail: message.detail }); this.dispatchEvent(new CustomEvent("warning", { detail: message })); }
    else if (message?.type === "ready") { this.wasmMode = message.wasmMode; this.log?.info("Processing worker ready", { wasmMode: message.wasmMode, transportMode: this.transportMode }); }
  }
}
