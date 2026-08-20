/* MAYHEM RTL bounded AudioWorklet ring. SPDX-License-Identifier: GPL-2.0-or-later */
class MayhemRtlAudioRingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = Math.max(16_384, Math.round(sampleRate * 4));
    this.ring = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.muted = false;
    this.volume = 0.75;
    this.underruns = 0;
    this.droppedInputSamples = 0;
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
  }

  process(_inputs, outputs) {
    const channels = outputs[0] ?? [];
    const length = channels[0]?.length ?? 128;
    let missing = false;
    for (let index = 0; index < length; index += 1) {
      let sample = 0;
      if (this.available > 0) {
        sample = this.ring[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.capacity;
        this.available -= 1;
      } else missing = true;
      const output = this.muted ? 0 : sample * this.volume;
      for (let channel = 0; channel < channels.length; channel += 1) channels[channel][index] = output;
    }
    if (missing) {
      this.underruns += 1;
      if (this.underruns === 1 || (this.underruns & 31) === 0) this.port.postMessage(this.underruns);
    }
    return true;
  }
}
registerProcessor("mayhem-rtl-audio-ring", MayhemRtlAudioRingProcessor);
