/*
 * MAYHEM RTL AudioWorklet port target.
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * This processor is deliberately not loaded by v0.1.0. It defines the bounded,
 * allocation-free render contract for the verified audio-receiver batch.
 */
class MayhemRtlAudioRingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frames = [];
    this.frameOffset = 0;
    this.muted = true;
    this.volume = 0;
    this.underruns = 0;
    this.port.onmessage = (event) => {
      const message = event.data ?? {};
      if (message.type === "frame" && message.samples instanceof Float32Array && this.frames.length < 32) this.frames.push(message.samples);
      else if (message.type === "mute") this.muted = Boolean(message.value);
      else if (message.type === "volume") this.volume = Math.max(0, Math.min(1, Number(message.value) || 0));
      else if (message.type === "reset") { this.frames.length = 0; this.frameOffset = 0; }
    };
  }

  process(_inputs, outputs) {
    const channels = outputs[0] ?? [];
    const length = channels[0]?.length ?? 128;
    for (let index = 0; index < length; index += 1) {
      while (this.frames.length && this.frameOffset >= this.frames[0].length) { this.frames.shift(); this.frameOffset = 0; }
      const sample = this.frames.length ? this.frames[0][this.frameOffset++] : 0;
      if (!this.frames.length && index === 0) { this.underruns += 1; this.port.postMessage({ type: "underrun", count: this.underruns }); }
      const output = this.muted ? 0 : sample * this.volume;
      for (const channel of channels) channel[index] = output;
    }
    return true;
  }
}

registerProcessor("mayhem-rtl-audio-ring", MayhemRtlAudioRingProcessor);
