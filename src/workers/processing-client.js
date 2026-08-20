export class ProcessingClient extends EventTarget {
  constructor({ workerUrl, wasmUrl, settings, log, maxPendingBlocks = 3 }) {
    super();
    this.log = log;
    this.maxPendingBlocks = maxPendingBlocks;
    this.pending = 0;
    this.ready = false;
    this.wasmMode = "starting";
    this.worker = new Worker(workerUrl, { type: "module", name: "mayhem-rtl-processing" });
    this.readyPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Processing worker startup timed out.")), 8000);
      this.worker.addEventListener("message", (event) => {
        if (event.data?.type === "ready") { clearTimeout(timeout); this.ready = true; this.wasmMode = event.data.wasmMode; resolve(event.data); }
      });
      this.worker.addEventListener("error", (event) => { clearTimeout(timeout); reject(event.error ?? new Error(event.message)); }, { once: true });
    });
    this.worker.addEventListener("message", (event) => this.#handleMessage(event.data));
    this.worker.addEventListener("error", (event) => {
      this.log?.error("Processing worker error", { message: event.message });
      this.dispatchEvent(new CustomEvent("error", { detail: event.error ?? new Error(event.message) }));
    });
    this.worker.postMessage({ type: "init", wasmUrl: String(wasmUrl), settings });
  }

  async waitUntilReady() { return this.readyPromise; }

  processBlock(block) {
    if (!this.ready || this.pending >= this.maxPendingBlocks) return false;
    if (!(block.data instanceof ArrayBuffer)) throw new TypeError("Processing block data must be an ArrayBuffer.");
    this.pending += 1;
    this.worker.postMessage({
      type: "block",
      sequence: block.sequence,
      buffer: block.data,
      sampleRate: block.sampleRate,
      frequency: block.frequency,
      receivedAt: block.receivedAt
    }, [block.data]);
    this.dispatchEvent(new CustomEvent("queue", { detail: { pending: this.pending, capacity: this.maxPendingBlocks } }));
    return true;
  }

  updateSettings(settings, resetAveraging = false) { this.worker.postMessage({ type: "settings", settings, resetAveraging }); }
  reset() { this.pending = 0; this.worker.postMessage({ type: "reset" }); }
  close() { this.worker.terminate(); this.ready = false; this.pending = 0; }

  #handleMessage(message) {
    if (["processed", "ack"].includes(message?.type)) {
      this.pending = Math.max(0, this.pending - 1);
      this.dispatchEvent(new CustomEvent("queue", { detail: { pending: this.pending, capacity: this.maxPendingBlocks } }));
    }
    if (message?.type === "processed") this.dispatchEvent(new CustomEvent("spectrum", { detail: message }));
    else if (message?.type === "ack") this.dispatchEvent(new CustomEvent("ack", { detail: message }));
    else if (message?.type === "warning") { this.log?.warn(message.message, { detail: message.detail }); this.dispatchEvent(new CustomEvent("warning", { detail: message })); }
    else if (message?.type === "ready") { this.wasmMode = message.wasmMode; this.log?.info("Processing worker ready", { wasmMode: message.wasmMode }); }
  }
}
