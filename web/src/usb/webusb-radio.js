import { ConnectionState } from "../state/connection-state.js";
import { SerializedCommandQueue } from "../state/command-queue.js";
import { DirectSampling, RadioError, RadioErrorType, RTL2832UProvider } from "./webrtlsdr-lowlevel.js";
import { conservativeCaps, nearestGain } from "./device-profiles.js";

function initialStats() {
  return {
    startedAt: null,
    stoppedAt: null,
    blocks: 0,
    bytes: 0,
    samples: 0,
    effectiveSampleRate: 0,
    usbTransferFailures: 0,
    transferTimeouts: 0,
    sequenceGaps: 0,
    staleCompletions: 0,
    ringDrops: 0,
    inFlight: 0,
    transferDepth: 0,
    blockSamples: 0,
    processingLatencyMs: 0,
    maximumProcessingLatencyMs: 0,
    captureWriteBacklog: 0,
    lastBlockAt: null
  };
}

export class WebUsbRadio extends EventTarget {
  constructor({ stateMachine, log, providerFactory = () => new RTL2832UProvider() }) {
    super();
    this.stateMachine = stateMachine;
    this.log = log;
    this.providerFactory = providerFactory;
    this.provider = null;
    this.device = null;
    this.caps = { hasRx: true, hasTx: false, fullDuplex: false, minFrequencyHz: 0, maxFrequencyHz: 0, maxSampleRate: 0, tuner: "—" };
    this.actual = { frequencyHz: 100_000_000, sampleRate: 1_024_000, gainDb: null, ppm: 0, directSampling: DirectSampling.Off, biasTee: false };
    this.stats = initialStats();
    this.commandQueue = new SerializedCommandQueue();
    this.receiving = false;
    this.pumpToken = 0;
    this.inFlight = new Map();
    this.completions = new Map();
    this.nextSchedule = 0;
    this.nextDeliver = 0;
    this.onBlock = null;
    this.startedPerformanceMs = 0;
    this.usbDisconnectHandler = (event) => this.#handleUsbDisconnect(event);
  }

  get connected() { return Boolean(this.device) && [ConnectionState.CONNECTED_IDLE, ConnectionState.STARTING_RECEIVER, ConnectionState.RECEIVING, ConnectionState.STOPPING_RECEIVER].includes(this.stateMachine.state); }

  async connect(settings) {
    if (![ConnectionState.READY, ConnectionState.DISCONNECTED, ConnectionState.ERROR, ConnectionState.PERMISSION_REVOKED, ConnectionState.DEVICE_REMOVED].includes(this.stateMachine.state)) {
      throw new RadioError("A device connection is already in progress or active.", RadioErrorType.InvalidState);
    }
    const sessionId = this.stateMachine.beginSession();
    this.commandQueue.reopen();
    this.stateMachine.transition(ConnectionState.SELECTING_DEVICE, "User opened the WebUSB device picker");
    this.log.info("Opening WebUSB RTL-SDR device picker", { sessionId });
    try {
      this.provider = this.providerFactory();
      await this.provider.requestDevice();
      if (!this.stateMachine.isCurrent(sessionId)) throw new RadioError("Connection attempt was superseded.", RadioErrorType.InvalidState);
      this.stateMachine.transition(ConnectionState.OPENING_DEVICE, "USB permission granted");
      this.stateMachine.transition(ConnectionState.INITIALIZING_TUNER, "Validating descriptors and initializing tuner");
      this.device = await this.provider.get();
      if (!this.stateMachine.isCurrent(sessionId)) {
        await this.device.close();
        throw new RadioError("Connection attempt completed after it was cancelled.", RadioErrorType.InvalidState);
      }
      this.caps = conservativeCaps(this.device);
      navigator.usb?.addEventListener?.("disconnect", this.usbDisconnectHandler);
      const actualRate = await this.device.setSampleRate(Number(settings.sampleRate));
      const directMap = { off: DirectSampling.Off, i: DirectSampling.I, q: DirectSampling.Q };
      const requestedDirectSampling = directMap[settings.directSampling] ?? DirectSampling.Off;
      await this.device.setDirectSamplingMethod(requestedDirectSampling);
      const actualFrequency = await this.device.setCenterFrequency(Number(settings.centerFrequencyHz));
      if (settings.gainMode === "automatic") await this.device.setGain(null);
      else await this.device.setGain(nearestGain(settings.gainDb));
      await this.device.setFrequencyCorrection(Number(settings.ppm ?? 0));
      this.actual = {
        frequencyHz: actualFrequency,
        sampleRate: actualRate,
        gainDb: settings.gainMode === "automatic" ? null : nearestGain(settings.gainDb),
        ppm: Number(settings.ppm ?? 0),
        directSampling: requestedDirectSampling,
        biasTee: false
      };
      this.stateMachine.transition(ConnectionState.CONNECTED_IDLE, "RTL2832U initialized");
      this.log.info("RTL-SDR connected", { sessionId, device: this.safeDeviceInfo(false), caps: this.caps, actual: this.actual });
      this.#emit("connected", { caps: this.caps, actual: this.actual, device: this.safeDeviceInfo(false) });
      return { caps: this.caps, actual: this.actual, device: this.safeDeviceInfo(false) };
    } catch (error) {
      await this.#cleanupFailedConnection();
      if (error?.type === RadioErrorType.NoDeviceSelected) this.stateMachine.force(ConnectionState.PERMISSION_REVOKED, error.message);
      else if (this.stateMachine.isCurrent(sessionId)) this.stateMachine.force(ConnectionState.ERROR, error.message);
      this.log.error("RTL-SDR connection failed", { name: error?.name, message: error?.message });
      throw error;
    }
  }

  async setFrequency(frequencyHz) {
    this.#assertDevice();
    const requested = Number(frequencyHz);
    const result = await this.commandQueue.enqueue("tune", async () => {
      const actual = await this.device.setCenterFrequency(requested);
      this.actual.frequencyHz = actual;
      this.#emit("settings", { requestedFrequencyHz: requested, actual: { ...this.actual } });
      return actual;
    }, { key: "frequency", latestWins: true });
    return result.skipped ? this.actual.frequencyHz : result.value;
  }

  async setSampleRate(sampleRate) {
    this.#assertDevice();
    const requested = Number(sampleRate);
    const result = await this.commandQueue.enqueue("sample-rate", async () => {
      const actual = await this.device.setSampleRate(requested);
      this.actual.sampleRate = actual;
      this.#emit("settings", { requestedSampleRate: requested, actual: { ...this.actual } });
      return actual;
    }, { key: "sample-rate", latestWins: true });
    return result.skipped ? this.actual.sampleRate : result.value;
  }

  async setGain(mode, gainDb = 0) {
    this.#assertDevice();
    const value = mode === "automatic" ? null : nearestGain(gainDb);
    const result = await this.commandQueue.enqueue("gain", async () => {
      await this.device.setGain(value);
      this.actual.gainDb = value;
      this.#emit("settings", { actual: { ...this.actual } });
      return value;
    }, { key: "gain", latestWins: true });
    return result.skipped ? this.actual.gainDb : result.value;
  }

  async setFrequencyCorrection(ppm) {
    this.#assertDevice();
    const value = Number(ppm);
    const result = await this.commandQueue.enqueue("frequency-correction", async () => {
      await this.device.setFrequencyCorrection(value);
      this.actual.ppm = value;
      this.#emit("settings", { actual: { ...this.actual } });
      return value;
    }, { key: "ppm", latestWins: true });
    return result.skipped ? this.actual.ppm : result.value;
  }

  async setDirectSampling(method) {
    this.#assertDevice();
    const map = { off: DirectSampling.Off, i: DirectSampling.I, q: DirectSampling.Q };
    const value = typeof method === "string" ? map[method] : method;
    const result = await this.commandQueue.enqueue("direct-sampling", async () => {
      await this.device.setDirectSamplingMethod(value);
      this.actual.directSampling = value;
      if (this.actual.frequencyHz) this.actual.frequencyHz = await this.device.setCenterFrequency(this.actual.frequencyHz);
      this.#emit("settings", { actual: { ...this.actual } });
      return value;
    });
    return result.value;
  }

  async setBiasTee(enabled) {
    this.#assertDevice();
    const value = Boolean(enabled);
    const result = await this.commandQueue.enqueue("bias-tee", async () => {
      await this.device.enableBiasTee(value);
      this.actual.biasTee = value;
      this.#emit("settings", { actual: { ...this.actual } });
      return value;
    });
    return result.value;
  }

  async startReceiver({ blockSamples = 32768, transferDepth = 4, onBlock }) {
    this.#assertDevice();
    if (this.receiving || this.stateMachine.state !== ConnectionState.CONNECTED_IDLE) throw new RadioError("Receiver cannot start from the current connection state.", RadioErrorType.InvalidState);
    if (typeof onBlock !== "function") throw new RadioError("The receive pipeline has no sample consumer.", RadioErrorType.InvalidState);
    this.stateMachine.transition(ConnectionState.STARTING_RECEIVER, "Resetting RTL2832U sample buffer");
    try {
      await this.commandQueue.drain();
      await this.device.resetBuffer();
      this.stats = initialStats();
      this.stats.startedAt = new Date().toISOString();
      this.startedPerformanceMs = performance.now();
      this.stats.blockSamples = Math.max(8192, Math.min(65536, Math.round(Number(blockSamples) || 32768)));
      this.stats.transferDepth = Math.max(1, Math.min(8, Math.round(Number(transferDepth) || 4)));
      this.receiving = true;
      this.onBlock = onBlock;
      this.pumpToken += 1;
      this.inFlight.clear();
      this.completions.clear();
      this.nextSchedule = 0;
      this.nextDeliver = 0;
      this.stateMachine.transition(ConnectionState.RECEIVING, "USB transfer pump active");
      this.log.info("Receiver started", { blockSamples: this.stats.blockSamples, transferDepth: this.stats.transferDepth, actual: this.actual });
      this.#fillTransferPump(this.stateMachine.sessionId, this.pumpToken);
      this.#emit("receive-started", { stats: this.stats });
    } catch (error) {
      this.receiving = false;
      this.stateMachine.force(ConnectionState.CONNECTED_IDLE, "Receiver start failed safely");
      throw error;
    }
  }

  async stopReceiver(reason = "User stopped receiver") {
    if (!this.receiving) return;
    if (this.stateMachine.state === ConnectionState.RECEIVING) this.stateMachine.transition(ConnectionState.STOPPING_RECEIVER, reason);
    this.receiving = false;
    this.pumpToken += 1;
    this.stats.stoppedAt = new Date().toISOString();
    const pending = [...this.inFlight.values()].map((entry) => entry.promise.catch(() => undefined));
    this.inFlight.clear();
    this.completions.clear();
    await Promise.race([Promise.allSettled(pending), new Promise((resolve) => setTimeout(resolve, 250))]);
    if (this.device && this.stateMachine.state === ConnectionState.STOPPING_RECEIVER) this.stateMachine.transition(ConnectionState.CONNECTED_IDLE, reason);
    this.log.info("Receiver stopped", { reason, stats: { ...this.stats } });
    this.#emit("receive-stopped", { reason, stats: { ...this.stats } });
  }

  async disconnect(reason = "User disconnected") {
    if (!this.device && this.stateMachine.state === ConnectionState.DISCONNECTED) return;
    try { await this.stopReceiver(reason); } catch { /* continue close */ }
    this.stateMachine.invalidateSession();
    this.commandQueue.close();
    navigator.usb?.removeEventListener?.("disconnect", this.usbDisconnectHandler);
    const device = this.device;
    this.device = null;
    try {
      if (device) {
        try { if (device.isBiasTeeEnabled?.()) await device.enableBiasTee(false); } catch { /* best effort */ }
        await device.close();
      }
    } catch (error) { this.log.warn("Device close reported an error", { message: error?.message }); }
    this.actual.biasTee = false;
    this.stateMachine.force(ConnectionState.DISCONNECTED, reason);
    this.log.info("RTL-SDR disconnected", { reason });
    this.#emit("disconnected", { reason });
  }

  safeDeviceInfo(includeSerial = false) {
    const info = this.device?.deviceInfo ?? {};
    return { ...info, serialNumber: includeSerial ? (info.serialNumber ?? "") : undefined };
  }

  #fillTransferPump(sessionId, token) {
    while (this.receiving && this.stateMachine.isCurrent(sessionId) && token === this.pumpToken && this.inFlight.size < this.stats.transferDepth) {
      const sequence = this.nextSchedule++;
      const started = performance.now();
      const promise = this.device.readSamples(this.stats.blockSamples)
        .then((block) => this.#completeTransfer({ sequence, block, started, sessionId, token, error: null }))
        .catch((error) => this.#completeTransfer({ sequence, block: null, started, sessionId, token, error }));
      this.inFlight.set(sequence, { promise, started });
    }
    this.stats.inFlight = this.inFlight.size;
  }

  async #completeTransfer(completion) {
    this.inFlight.delete(completion.sequence);
    if (!this.receiving || !this.stateMachine.isCurrent(completion.sessionId) || completion.token !== this.pumpToken) {
      this.stats.staleCompletions += 1;
      return;
    }
    this.completions.set(completion.sequence, completion);
    while (this.completions.has(this.nextDeliver)) {
      const current = this.completions.get(this.nextDeliver);
      this.completions.delete(this.nextDeliver);
      this.nextDeliver += 1;
      if (current.error) {
        this.stats.usbTransferFailures += 1;
        this.stats.sequenceGaps += 1;
        this.log.warn("USB sample transfer failed", { sequence: current.sequence, message: current.error?.message });
        if (this.stats.usbTransferFailures >= 5) {
          this.receiving = false;
          this.stateMachine.force(ConnectionState.ERROR, "Repeated USB transfer failures");
          this.#emit("error", { error: current.error, receivingStopped: true });
          return;
        }
        continue;
      }
      const latency = performance.now() - current.started;
      this.stats.processingLatencyMs = latency;
      this.stats.maximumProcessingLatencyMs = Math.max(this.stats.maximumProcessingLatencyMs, latency);
      this.stats.blocks += 1;
      this.stats.bytes += current.block.data.byteLength;
      this.stats.samples += current.block.data.byteLength / 2;
      this.stats.lastBlockAt = new Date().toISOString();
      const elapsed = Math.max(0.001, (performance.now() - this.startedPerformanceMs) / 1000);
      this.stats.effectiveSampleRate = this.stats.samples / elapsed;
      try {
        const accepted = await this.onBlock({ sequence: current.sequence, ...current.block, receivedAt: performance.now(), stats: this.stats });
        if (accepted === false) this.stats.ringDrops += current.block.data.byteLength / 2;
      } catch (error) {
        this.stats.ringDrops += current.block.data.byteLength / 2;
        this.log.error("Sample consumer rejected a block", { sequence: current.sequence, message: error?.message });
      }
      this.#emit("stats", { stats: { ...this.stats } });
    }
    this.#fillTransferPump(completion.sessionId, completion.token);
  }

  async #handleUsbDisconnect(event) {
    const selected = this.provider?.selectedDevice;
    if (!selected || event.device !== selected) return;
    this.log.warn("RTL-SDR was removed while connected");
    this.receiving = false;
    this.pumpToken += 1;
    this.stateMachine.invalidateSession();
    this.device = null;
    this.stateMachine.force(ConnectionState.DEVICE_REMOVED, "USB device removed");
    this.#emit("removed", { message: "The RTL-SDR was unplugged. Active capture metadata has been retained." });
  }

  async #cleanupFailedConnection() {
    navigator.usb?.removeEventListener?.("disconnect", this.usbDisconnectHandler);
    const device = this.device;
    this.device = null;
    if (device) { try { await device.close(); } catch { /* best effort */ } }
  }

  #assertDevice() {
    if (!this.device) throw new RadioError("No initialized RTL-SDR device is connected.", RadioErrorType.InvalidState);
  }

  #emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
}
