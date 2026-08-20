/* MAYHEM RTL bounded AudioWorklet ring. SPDX-License-Identifier: GPL-2.0-or-later */
class MayhemRtlAudioRingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.max(16_384, Math.round(sampleRate * 4));
    this.prebufferSamples = Math.max(2_048, Math.round(sampleRate * 0.12));
    this.ring = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.playing = false;
    this.muted = false;
    this.volume = 0.75;
    this.underruns = 0;
    this.rebufferEvents = 0;
    this.droppedInputSamples = 0;
    this.processQuanta = 0;
    this.port.onmessage = (event) => {
      const message = event.data ?? {};
      if (message.type === "frame" && message.samples instanceof Float32Array) this.enqueue(message.samples);
      else if (message.type === "mute") this.muted = Boolean(message.value);
      else if (message.type === "volume") this.volume = Math.max(0, Math.min(1, Number(message.value) || 0));
      else if (message.type === "reset") this.reset();
    };
  }

  reset() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.playing = false;
    this.underruns = 0;
    this.rebufferEvents = 0;
    this.droppedInputSamples = 0;
    this.processQuanta = 0;
    this.reportStatus(true);
  }

  enqueue(samples) {
    for (let index = 0; index < samples.length; index += 1) {
      if (this.available >= this.capacity) {
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.available -= 1;
        this.droppedInputSamples += 1;
      }
      this.ring[this.writeIndex] = samples[index];
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.available += 1;
    }
    if (!this.playing && this.available >= this.prebufferSamples) {
      this.playing = true;
      this.reportStatus(true);
    }
  }

  reportStatus(force = false) {
    if (!force && (this.processQuanta & 63) !== 0) return;
    this.port.postMessage({
      type: "status",
      underruns: this.underruns,
      rebufferEvents: this.rebufferEvents,
      queuedSamples: this.available,
      prebufferSamples: this.prebufferSamples,
      droppedInputSamples: this.droppedInputSamples,
      buffering: !this.playing
    });
  }

  process(_inputs, outputs) {
    const channels = outputs[0] ?? [];
    const length = channels[0]?.length ?? 128;
    this.processQuanta += 1;

    if (!this.playing && this.available >= this.prebufferSamples) this.playing = true;

    if (this.playing && this.available < length) {
      this.playing = false;
      this.underruns += 1;
      this.rebufferEvents += 1;
      this.reportStatus(true);
    }

    for (let index = 0; index < length; index += 1) {
      let sample = 0;
      if (this.playing && this.available > 0) {
        sample = this.ring[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.available -= 1;
      }
      const output = this.muted ? 0 : sample * this.volume;
      for (let channel = 0; channel < channels.length; channel += 1) channels[channel][index] = output;
    }

    this.reportStatus(false);
    return true;
  }
}
registerProcessor("mayhem-rtl-audio-ring", MayhemRtlAudioRingProcessor);
