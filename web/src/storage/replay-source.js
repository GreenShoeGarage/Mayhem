export class ReplaySource extends EventTarget {
  constructor() {
    super();
    this.file = null;
    this.metadata = null;
    this.offset = 0;
    this.running = false;
    this.paused = false;
    this.sequence = 0;
    this.timer = null;
    this.onBlock = null;
    this.speed = 1;
    this.blockSamples = 32768;
  }

  load(file, metadata = {}) {
    if (!(file instanceof File)) throw new Error("Select a raw In-phase and Quadrature capture file.");
    this.file = file;
    this.metadata = {
      sampleFormat: metadata.sampleFormat ?? "unsigned 8-bit interleaved In-phase and Quadrature",
      sampleRate: Number(metadata.sampleRate ?? 1_024_000),
      centerFrequencyHz: Number(metadata.centerFrequencyHz ?? metadata.center_frequency ?? 100_000_000),
      timestamp: metadata.startedAt ?? metadata.timestamp ?? null,
      gainDb: metadata.gainDb ?? null,
      frequencyCorrectionPpm: Number(metadata.frequencyCorrectionPpm ?? 0),
      notes: String(metadata.notes ?? ""),
      sourceFilename: file.name
    };
    if (!Number.isFinite(this.metadata.sampleRate) || this.metadata.sampleRate <= 0) throw new Error("Replay metadata contains an invalid sample rate.");
    this.offset = 0;
    this.sequence = 0;
    this.dispatchEvent(new CustomEvent("loaded", { detail: { file, metadata: this.metadata } }));
  }

  start(onBlock, { speed = 1, blockSamples = 32768 } = {}) {
    if (!this.file) throw new Error("No replay file is loaded.");
    if (this.running) throw new Error("Replay is already active.");
    this.onBlock = onBlock;
    this.speed = Number(speed) || 1;
    this.blockSamples = Math.max(1024, Math.min(262144, Math.round(blockSamples)));
    this.running = true;
    this.paused = false;
    this.#schedule(0);
  }

  pause() { this.paused = true; clearTimeout(this.timer); }
  resume() { if (this.running && this.paused) { this.paused = false; this.#schedule(0); } }
  stop() { this.running = false; this.paused = false; clearTimeout(this.timer); this.timer = null; }
  seekFraction(value) { if (!this.file) return; const aligned = Math.floor((this.file.size * Math.max(0, Math.min(1, value))) / 2) * 2; this.offset = aligned; }

  async step() {
    if (!this.file) throw new Error("No replay file is loaded.");
    return this.#readOne(false);
  }

  #schedule(delay) { this.timer = setTimeout(() => this.#readOne(true), Math.max(0, delay)); }

  async #readOne(continuePlayback) {
    if (!this.file || (continuePlayback && (!this.running || this.paused))) return false;
    if (this.offset >= this.file.size) {
      this.stop();
      this.dispatchEvent(new Event("ended"));
      return false;
    }
    const bytes = this.blockSamples * 2;
    const start = this.offset;
    const end = Math.min(this.file.size, start + bytes);
    const buffer = await this.file.slice(start, end).arrayBuffer();
    const samples = buffer.byteLength / 2;
    this.offset = end;
    await this.onBlock({ sequence: this.sequence++, data: buffer, frequency: this.metadata.centerFrequencyHz, sampleRate: this.metadata.sampleRate, directSampling: false, receivedAt: performance.now(), source: "replay" });
    this.dispatchEvent(new CustomEvent("progress", { detail: { offset: this.offset, size: this.file.size, fraction: this.offset / this.file.size } }));
    if (continuePlayback && this.running) {
      const realTimeMs = samples / this.metadata.sampleRate * 1000;
      this.#schedule(this.speed === Infinity ? 0 : realTimeMs / Math.max(0.01, this.speed));
    }
    return true;
  }
}
