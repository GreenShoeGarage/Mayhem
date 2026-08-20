import { generateAdsbIqFixture } from "../dsp/adsb.js";
import { generatePocsagIqFixture } from "../dsp/pocsag.js";
import { generateAfskIqFixture, generateAprsIqFixture, generateAcarsIqFixture, generateRttyIqFixture, generateMorseIqFixture } from "../dsp/digital-decoders.js";
import { generateNexusWeatherPulses, generateTpmsSchraderOokPulses, renderOokPulsesToIq } from "../dsp/subghz-telemetry.js";
import { generateFlex1600Fixture, generateTwoToneFixture } from "../dsp/paging-decoders.js";
import { generateAisIqFixture, generateRs41IqFixture, generateEpirbIqFixture } from "../dsp/tracking-decoders.js";
import { generateSstvIqFixture } from "../dsp/sstv.js";

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
  adsb: "Automatic Dependent Surveillance–Broadcast fixture",
  pocsag: "POCSAG pager fixture",
  afsk: "AFSK terminal fixture",
  aprs: "APRS / AX.25 fixture",
  acars: "ACARS fixture",
  rtty: "RTTY / ITA2 fixture",
  morse: "Morse fixture",
  tpms: "TPMS OOK fixture",
  weather: "Weather sensor OOK fixture",
  flex: "FLEX 1600 pager fixture",
  twotone: "Two-Tone paging fixture",
  ais: "AIS marine position-report fixture",
  radiosonde: "Vaisala RS41-SG radiosonde fixture",
  epirb: "406 MHz COSPAS-SARSAT beacon fixture",
  sstv: "SSTV Martin 1 image fixture"
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
    this.adsbFixtureStream = null;
    this.adsbFixtureRate = 0;
    this.pocsagFixtureStream = null;
    this.pocsagFixtureRate = 0;
    this.digitalFixtureStreams = new Map();
    this.telemetryFixtureStreams = new Map();
    this.pagingFixtureStreams = new Map();
    this.trackingFixtureStreams = new Map();
    this.sstvFixtureStreams = new Map();
  }

  configure(settings = {}) {
    if (Number.isFinite(settings.sampleRate)) {
      const nextRate = Number(settings.sampleRate);
      if (nextRate !== this.sampleRate) { this.adsbFixtureStream = null; this.adsbFixtureRate = 0; this.pocsagFixtureStream = null; this.pocsagFixtureRate = 0; this.digitalFixtureStreams.clear(); this.telemetryFixtureStreams.clear(); this.pagingFixtureStreams.clear(); this.trackingFixtureStreams.clear(); this.sstvFixtureStreams.clear(); }
      this.sampleRate = nextRate;
    }
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
    if (scenario === "sstv") {
      const cacheKey = `sstv:${sr}`;
      let stream = this.sstvFixtureStreams.get(cacheKey);
      if (!stream) {
        const fixture = generateSstvIqFixture({ sampleRate: sr, mode: "martin1", lines: 256, rfMode: "usb", includeVis: true });
        stream = new Uint8Array(fixture.i.length * 2);
        for (let index = 0; index < fixture.i.length; index += 1) {
          stream[index * 2] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.i[index] * 112)));
          stream[index * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.q[index] * 112)));
        }
        this.sstvFixtureStreams.set(cacheKey, stream);
      }
      const sampleCount = stream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) {
        const pos = (this.sampleIndex + n) % sampleCount;
        output[n * 2] = stream[pos * 2]; output[n * 2 + 1] = stream[pos * 2 + 1];
      }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
    if (["ais", "radiosonde", "epirb"].includes(scenario)) {
      const cacheKey = `${scenario}:${sr}`;
      let stream = this.trackingFixtureStreams.get(cacheKey);
      if (!stream) {
        const fixture = scenario === "ais" ? generateAisIqFixture({ sampleRate: sr, channel: "A" })
          : scenario === "radiosonde" ? generateRs41IqFixture({ sampleRate: sr })
          : generateEpirbIqFixture({ sampleRate: sr });
        stream = new Uint8Array(fixture.i.length * 2);
        for (let index = 0; index < fixture.i.length; index += 1) {
          stream[index * 2] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.i[index] * 112)));
          stream[index * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.q[index] * 112)));
        }
        this.trackingFixtureStreams.set(cacheKey, stream);
      }
      const sampleCount = stream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) {
        const pos = (this.sampleIndex + n) % sampleCount;
        output[n * 2] = stream[pos * 2]; output[n * 2 + 1] = stream[pos * 2 + 1];
      }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
    if (["flex", "twotone"].includes(scenario)) {
      const cacheKey = `${scenario}:${sr}`;
      let stream = this.pagingFixtureStreams.get(cacheKey);
      if (!stream) {
        const fixture = scenario === "flex" ? generateFlex1600Fixture({ sampleRate: sr }) : generateTwoToneFixture({ sampleRate: sr });
        stream = new Uint8Array(fixture.i.length * 2);
        for (let index = 0; index < fixture.i.length; index += 1) {
          stream[index * 2] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.i[index] * 112)));
          stream[index * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.q[index] * 112)));
        }
        this.pagingFixtureStreams.set(cacheKey, stream);
      }
      const sampleCount = stream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) { const pos = (this.sampleIndex + n) % sampleCount; output[n*2]=stream[pos*2]; output[n*2+1]=stream[pos*2+1]; }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
    if (["tpms", "weather"].includes(scenario)) {
      const cacheKey = `${scenario}:${sr}`;
      let stream = this.telemetryFixtureStreams.get(cacheKey);
      if (!stream) {
        const pulses = scenario === "weather" ? generateNexusWeatherPulses().pulses : generateTpmsSchraderOokPulses().pulses;
        const fixture = renderOokPulsesToIq(pulses, { sampleRate: sr });
        stream = new Uint8Array(fixture.i.length * 2);
        for (let index = 0; index < fixture.i.length; index += 1) {
          stream[index * 2] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.i[index] * 112)));
          stream[index * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.q[index] * 112)));
        }
        this.telemetryFixtureStreams.set(cacheKey, stream);
      }
      const sampleCount = stream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) {
        const position = (this.sampleIndex + n) % sampleCount;
        output[n * 2] = stream[position * 2]; output[n * 2 + 1] = stream[position * 2 + 1];
      }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
    if (["afsk", "aprs", "acars", "rtty", "morse"].includes(scenario)) {
      const cacheKey = `${scenario}:${sr}`;
      let stream = this.digitalFixtureStreams.get(cacheKey);
      if (!stream) {
        const fixture = scenario === "afsk" ? generateAfskIqFixture({ sampleRate: sr })
          : scenario === "aprs" ? generateAprsIqFixture({ sampleRate: sr })
          : scenario === "acars" ? generateAcarsIqFixture({ sampleRate: sr })
          : scenario === "rtty" ? generateRttyIqFixture({ sampleRate: sr })
          : generateMorseIqFixture({ sampleRate: sr });
        stream = new Uint8Array(fixture.i.length * 2);
        for (let index = 0; index < fixture.i.length; index += 1) {
          stream[index * 2] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.i[index] * 112)));
          stream[index * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.q[index] * 112)));
        }
        this.digitalFixtureStreams.set(cacheKey, stream);
      }
      const sampleCount = stream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) {
        const position = (this.sampleIndex + n) % sampleCount;
        output[n * 2] = stream[position * 2];
        output[n * 2 + 1] = stream[position * 2 + 1];
      }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
    if (scenario === "pocsag") {
      if (!this.pocsagFixtureStream || this.pocsagFixtureRate !== sr) {
        const fixture = generatePocsagIqFixture({ sampleRate: sr, bitrate: 1200, ric: 1234560, functionCode: 3, message: "MAYHEM RTL POCSAG TEST" });
        const stream = new Uint8Array(fixture.i.length * 2);
        for (let index = 0; index < fixture.i.length; index += 1) {
          stream[index * 2] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.i[index] * 112)));
          stream[index * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + fixture.q[index] * 112)));
        }
        this.pocsagFixtureStream = stream;
        this.pocsagFixtureRate = sr;
      }
      const sampleCount = this.pocsagFixtureStream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) {
        const position = (this.sampleIndex + n) % sampleCount;
        output[n * 2] = this.pocsagFixtureStream[position * 2];
        output[n * 2 + 1] = this.pocsagFixtureStream[position * 2 + 1];
      }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
    if (scenario === "adsb") {
      if (!this.adsbFixtureStream || this.adsbFixtureRate !== sr) {
        const frames = [
          "8D4840D6202CC371C32CE0576098",
          "8D40621D58C382D690C8AC2863A7",
          "8D40621D58C386435CC412692AD6"
        ];
        const gap = Math.max(1, Math.round(sr * 0.0015));
        const chunks = frames.map((hex) => generateAdsbIqFixture(hex, { sampleRate: sr, paddingUs: 10 }));
        const samples = chunks.reduce((sum, chunk) => sum + chunk.i.length + gap, 0);
        const stream = new Uint8Array(samples * 2);
        let cursor = 0;
        for (const chunk of chunks) {
          for (let index = 0; index < chunk.i.length; index += 1) {
            stream[cursor * 2] = Math.max(0, Math.min(255, Math.round(127.5 + chunk.i[index] * 112)));
            stream[cursor * 2 + 1] = Math.max(0, Math.min(255, Math.round(127.5 + chunk.q[index] * 112)));
            cursor += 1;
          }
          for (let index = 0; index < gap; index += 1) { stream[cursor * 2] = 127; stream[cursor * 2 + 1] = 127; cursor += 1; }
        }
        this.adsbFixtureStream = stream;
        this.adsbFixtureRate = sr;
      }
      const sampleCount = this.adsbFixtureStream.length / 2;
      for (let n = 0; n < this.blockSamples; n += 1) {
        const position = (this.sampleIndex + n) % sampleCount;
        output[n * 2] = this.adsbFixtureStream[position * 2];
        output[n * 2 + 1] = this.adsbFixtureStream[position * 2 + 1];
      }
      this.sampleIndex += this.blockSamples;
      return output.buffer;
    }
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
        addCarrier(0, envelope);
      } else if (scenario === "nfm") {
        const deviationPhase = 4.2 * Math.sin(Math.PI * 2 * 900 * t);
        addCarrier(0, 0.75, deviationPhase);
      } else if (scenario === "wfm") {
        const deviationPhase = 45 * Math.sin(Math.PI * 2 * 1000 * t) + 8 * Math.sin(Math.PI * 2 * 2700 * t);
        addCarrier(0, 0.62, deviationPhase);
      } else if (scenario === "changing") {
        const level = 0.12 + 0.72 * (0.5 + 0.5 * Math.sin(Math.PI * 2 * 0.18 * t));
        addCarrier(155_000, level);
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
