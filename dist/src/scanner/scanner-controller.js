function sleepDefault(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export class ScannerController extends EventTarget {
  constructor({ tune, readLevel, sleep = sleepDefault, now = () => Date.now(), maxHistory = 200 } = {}) {
    super();
    if (typeof tune !== "function") throw new TypeError("Scanner requires a tune(frequencyHz) callback.");
    if (typeof readLevel !== "function") throw new TypeError("Scanner requires a readLevel() callback.");
    this.tune = tune;
    this.readLevel = readLevel;
    this.sleep = sleep;
    this.now = now;
    this.maxHistory = Math.max(1, Math.min(1000, Math.round(maxHistory)));
    this.running = false;
    this.token = 0;
    this.currentFrequencyHz = null;
    this.hits = [];
    this.lockouts = new Set();
    this.config = null;
  }

  normalizeConfig(config = {}) {
    const startHz = Math.max(0, Math.round(Number(config.startHz) || 88_000_000));
    const endHz = Math.max(startHz, Math.round(Number(config.endHz) || startHz));
    return Object.freeze({
      startHz,
      endHz,
      stepHz: Math.max(1, Math.min(10_000_000, Math.round(Number(config.stepHz) || 100_000))),
      dwellMs: Math.max(20, Math.min(10_000, Math.round(Number(config.dwellMs) || 180))),
      settleMs: Math.max(0, Math.min(5_000, Math.round(Number(config.settleMs) || 60))),
      thresholdDbfs: Math.max(-140, Math.min(0, Number(config.thresholdDbfs ?? -45))),
      holdMs: Math.max(0, Math.min(60_000, Math.round(Number(config.holdMs) || 900))),
      holdOnHit: config.holdOnHit !== false,
      direction: Number(config.direction) < 0 ? -1 : 1
    });
  }

  async start(config = {}) {
    if (this.running) return;
    this.config = this.normalizeConfig(config);
    this.running = true;
    const token = ++this.token;
    this.currentFrequencyHz = this.config.direction > 0 ? this.config.startHz : this.config.endHz;
    this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
    try {
      while (this.running && token === this.token) {
        if (this.lockouts.has(Math.round(this.currentFrequencyHz))) this.currentFrequencyHz = this.#next(this.currentFrequencyHz);
        const requested = this.currentFrequencyHz;
        const actual = Number(await this.tune(requested)) || requested;
        this.currentFrequencyHz = actual;
        this.dispatchEvent(new CustomEvent("tune", { detail: { requestedFrequencyHz: requested, actualFrequencyHz: actual } }));
        if (this.config.settleMs) await this.sleep(this.config.settleMs);
        if (!this.running || token !== this.token) break;
        const levelDbfs = Number(this.readLevel());
        const hit = Number.isFinite(levelDbfs) && levelDbfs >= this.config.thresholdDbfs;
        if (hit) {
          const existing = this.hits.find((entry) => Math.abs(entry.frequencyHz - actual) < Math.max(1, this.config.stepHz / 2));
          const event = {
            frequencyHz: actual,
            levelDbfs,
            firstSeenAt: existing?.firstSeenAt ?? new Date(this.now()).toISOString(),
            lastSeenAt: new Date(this.now()).toISOString(),
            count: (existing?.count ?? 0) + 1
          };
          if (existing) Object.assign(existing, event);
          else this.hits.unshift(event);
          this.hits = this.hits.slice(0, this.maxHistory);
          this.dispatchEvent(new CustomEvent("hit", { detail: { ...event } }));
          if (this.config.holdOnHit && this.config.holdMs) await this.sleep(this.config.holdMs);
        }
        const remainder = Math.max(0, this.config.dwellMs - this.config.settleMs);
        if (remainder) await this.sleep(remainder);
        if (!this.running || token !== this.token) break;
        this.currentFrequencyHz = this.#next(actual);
        this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
      }
    } finally {
      if (token === this.token) this.running = false;
      this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.token += 1;
    this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
  }

  clearHits() {
    this.hits = [];
    this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
  }

  lockout(frequencyHz) {
    const frequency = Math.round(Number(frequencyHz));
    if (Number.isFinite(frequency)) this.lockouts.add(frequency);
    this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
  }

  clearLockouts() {
    this.lockouts.clear();
    this.dispatchEvent(new CustomEvent("state", { detail: this.snapshot() }));
  }

  snapshot() {
    return Object.freeze({
      running: this.running,
      currentFrequencyHz: this.currentFrequencyHz,
      config: this.config,
      hits: this.hits.map((entry) => ({ ...entry })),
      lockouts: [...this.lockouts]
    });
  }

  #next(current) {
    const { startHz, endHz, stepHz, direction } = this.config;
    let next = current + stepHz * direction;
    if (direction > 0 && next > endHz) next = startHz;
    if (direction < 0 && next < startHz) next = endHz;
    return next;
  }
}
