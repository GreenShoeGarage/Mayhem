/* Browser audio output controller for MAYHEM RTL. SPDX-License-Identifier: GPL-2.0-or-later */
export class AudioController extends EventTarget {
  constructor({ workletUrl = new URL("./audio-ring-worklet.js", import.meta.url), log = null } = {}) {
    super();
    this.workletUrl = String(workletUrl);
    this.log = log;
    this.context = null;
    this.node = null;
    this.enabled = false;
    this.volume = 0.75;
    this.muted = false;
    this.stats = this.#freshStats();
  }

  #freshStats() {
    return {
      underruns: 0,
      rebufferEvents: 0,
      queuedSamples: 0,
      queuedMs: 0,
      prebufferSamples: 0,
      droppedInputSamples: 0,
      pushedSamples: 0,
      pushedFrames: 0,
      pushErrors: 0,
      buffering: true,
      squelchOpen: false,
      mode: "wfm",
      levelRms: 0
    };
  }

  get state() {
    if (!this.context) return "off";
    if (this.context.state === "suspended") return "suspended";
    return this.enabled ? (this.muted ? "muted" : "active") : "off";
  }

  async enable() {
    if (!globalThis.AudioContext && !globalThis.webkitAudioContext) throw new Error("AudioWorklet is unavailable in this browser.");
    if (!this.context) {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.context = new AudioContextClass({ latencyHint: "interactive" });
      this.context.addEventListener?.("statechange", () => this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() })));
      if (!this.context.audioWorklet) throw new Error("AudioWorklet is unavailable in this browser.");
      await this.context.audioWorklet.addModule(this.workletUrl);
      this.node = new AudioWorkletNode(this.context, "mayhem-rtl-audio-ring", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.node.connect(this.context.destination);
      this.node.port.onmessage = (event) => {
        if (typeof event.data === "number") {
          this.stats.underruns = event.data;
        } else if (event.data?.type === "status") {
          const status = event.data;
          this.stats.underruns = Number(status.underruns) || 0;
          this.stats.rebufferEvents = Number(status.rebufferEvents) || 0;
          this.stats.queuedSamples = Math.max(0, Number(status.queuedSamples) || 0);
          this.stats.prebufferSamples = Math.max(0, Number(status.prebufferSamples) || 0);
          this.stats.droppedInputSamples = Math.max(0, Number(status.droppedInputSamples) || 0);
          this.stats.buffering = Boolean(status.buffering);
          this.stats.queuedMs = this.context?.sampleRate ? (this.stats.queuedSamples / this.context.sampleRate) * 1000 : 0;
        }
        this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() }));
      };
      this.setVolume(this.volume);
      this.setMuted(this.muted);
    }
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = true;
    this.stats = { ...this.#freshStats(), mode: this.stats.mode, squelchOpen: this.stats.squelchOpen };
    this.node.port.postMessage({ type: "reset" });
    this.log?.info("Browser audio enabled", { sampleRate: this.context.sampleRate });
    this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() }));
    return this.snapshot();
  }

  disable() {
    this.enabled = false;
    this.node?.port.postMessage({ type: "reset" });
    this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() }));
  }

  async resume() {
    if (this.context?.state === "suspended") await this.context.resume();
    this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() }));
  }

  push(samples, metadata = {}) {
    if (!this.enabled || !this.node || !(samples instanceof Float32Array) || samples.length === 0) return false;
    const sampleCount = samples.length;
    this.stats.squelchOpen = Boolean(metadata.squelchOpen);
    this.stats.mode = metadata.mode || this.stats.mode;
    this.stats.levelRms = Number(metadata.levelRms || 0);
    try {
      // Only the audio frame crosses into the worklet. Do not clone the worker's
      // full metadata object (which also contains this same transferred buffer).
      this.node.port.postMessage({ type: "frame", samples }, [samples.buffer]);
      this.stats.pushedSamples += sampleCount;
      this.stats.pushedFrames += 1;
      return true;
    } catch (error) {
      this.stats.pushErrors += 1;
      this.log?.error("Audio frame could not be queued", { message: error?.message ?? String(error) });
      this.dispatchEvent(new CustomEvent("status", { detail: this.snapshot() }));
      return false;
    }
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    this.node?.port.postMessage({ type: "volume", value: this.volume });
  }

  setMuted(value) {
    this.muted = Boolean(value);
    this.node?.port.postMessage({ type: "mute", value: this.muted });
  }

  snapshot() {
    return { enabled: this.enabled, state: this.state, volume: this.volume, muted: this.muted, sampleRate: this.context?.sampleRate ?? 0, ...this.stats };
  }

  async close() {
    this.enabled = false;
    try { this.node?.disconnect(); } catch {}
    this.node = null;
    if (this.context) await this.context.close().catch(() => {});
    this.context = null;
  }
}
