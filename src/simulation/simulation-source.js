function xorshift32(seed) {
  let value = seed >>> 0 || 0x12345678;
  return () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 0xffffffff;
  };
}

const SCENARIOS = Object.freeze({
  carrier: "Single carrier",
  multi: "Multiple spectrum peaks",
  am: "Amplitude Modulation",
  nfm: "Narrowband Frequency Modulation",
  wfm: "Wideband Frequency Modulation",
  changing: "Changing signal level",
  overflow: "Buffer overflow stress",
  disconnect: "Device disconnect recovery",
  adsb: "Automatic Dependent Surveillance–Broadcast fixture"
});

export function simulationScenarios() { return { ...SCENARIOS }; }

export class SimulationSource extends EventTarget {
  constructor({ sampleRate = 1_024_000, centerFrequencyHz = 100_000_000, blockSamples = 32768, scenario = "multi" } = {}) {
    super();
    this.sampleRate = sampleRate;
    this.centerFrequencyHz = centerFrequencyHz;
    this.blockSamples = blockSamples;
    this.scenario = scenario;
    this.running = false;
    this.sampleIndex = 0;
    this.sequence = 0;
    this.timer = null;
    this.random = xorshift32(0x4d415948);
    this.startedAt = 0;
    this.onBlock = null;
  }

  configure(settings = {}) {
    if (Number.isFinite(settings.sampleRate)) this.sampleRate = Number(settings.sampleRate);
    if (Number.isFinite(settings.centerFrequencyHz)) this.centerFrequencyHz = Number(settings.centerFrequencyHz);
    if (Number.isFinite(settings.blockSamples)) this.blockSamples = Math.max(1024, Math.min(65536, Math.round(settings.blockSamples)));
    if (settings.scenario && SCENARIOS[settings.scenario]) this.scenario = settings.scenario;
  }

  start(onBlock) {
    if (this.running) throw new Error("Simulation source is already running.");
    this.onBlock = onBlock;
    this.running = true;
    this.startedAt = performance.now();
    this.sampleIndex = 0;
    this.sequence = 0;
    this.#schedule(0);
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  #schedule(delay) { this.timer = setTimeout(() => this.#tick(), Math.max(0, delay)); }

  async #tick() {
    if (!this.running) return;
    const started = performance.now();
    const buffer = this.#generateBlock();
    const sequence = this.sequence++;
    try {
      await this.onBlock({ sequence, data: buffer, frequency: this.centerFrequencyHz, sampleRate: this.sampleRate, directSampling: false, receivedAt: performance.now(), source: "simulation" });
    } catch (error) {
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
    }
    if (this.scenario === "disconnect" && performance.now() - this.startedAt > 5000) {
      this.stop();
      this.dispatchEvent(new CustomEvent("disconnect", { detail: { message: "Simulated device removal after five seconds." } }));
      return;
    }
    const realTimeMs = this.blockSamples / this.sampleRate * 1000;
    const processingMs = performance.now() - started;
    const delay = this.scenario === "overflow" ? 0 : Math.max(0, realTimeMs - processingMs);
    this.#schedule(delay);
  }

  #generateBlock() {
    const output = new Uint8Array(this.blockSamples * 2);
    const sr = this.sampleRate;
    const scenario = this.scenario;
    for (let n = 0; n < this.blockSamples; n += 1) {
      const index = this.sampleIndex + n;
      const t = index / sr;
      let i = 0;
      let q = 0;
      const addCarrier = (offsetHz, amplitude, phaseMod = 0) => {
        const phase = Math.PI * 2 * offsetHz * t + phaseMod;
        i += amplitude * Math.cos(phase);
        q += amplitude * Math.sin(phase);
      };
      if (scenario === "carrier") addCarrier(96_000, 0.8);
      else if (scenario === "am") {
        const envelope = 0.45 + 0.35 * Math.sin(Math.PI * 2 * 1000 * t);
        addCarrier(-145_000, envelope);
      } else if (scenario === "nfm") {
        const deviationPhase = 4.2 * Math.sin(Math.PI * 2 * 900 * t);
        addCarrier(82_000, 0.75, deviationPhase);
      } else if (scenario === "wfm") {
        const deviationPhase = 45 * Math.sin(Math.PI * 2 * 1000 * t) + 8 * Math.sin(Math.PI * 2 * 2700 * t);
        addCarrier(-90_000, 0.62, deviationPhase);
      } else if (scenario === "changing") {
        const level = 0.12 + 0.72 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * 0.18 * t));
        addCarrier(155_000, level);
      } else if (scenario === "adsb") {
        const framePosition = index % Math.max(1, Math.round(sr * 0.002));
        const pulseSamples = Math.max(1, Math.round(sr * 0.5e-6));
        const pulse = [0,2,7,9,14,18,21,29,34,41,47,53,61,67,73,79,86,93,101,108].some((slot) => framePosition >= slot * pulseSamples && framePosition < (slot + 1) * pulseSamples);
        if (pulse) addCarrier(0, 0.92);
      } else {
        addCarrier(-215_000, 0.54);
        addCarrier(83_000, 0.78, 2.5 * Math.sin(Math.PI * 2 * 1200 * t));
        addCarrier(272_000, 0.38);
        addCarrier(-48_000, 0.22, 0.6 * Math.sin(Math.PI * 2 * 330 * t));
      }
      i += (this.random() - 0.5) * 0.12;
      q += (this.random() - 0.5) * 0.12;
      output[n * 2] = Math.max(0, Math.min(255, Math.round(127.5 + i * 112)));
      output[n * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + q * 112)));
    }
    this.sampleIndex += this.blockSamples;
    return output.buffer;
  }
}
