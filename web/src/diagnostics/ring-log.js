export class RingLog extends EventTarget {
  #entries = [];
  constructor(limit = 250) { super(); this.limit = Math.max(10, limit); }
  add(level, message, details = null) {
    const entry = { timestamp: new Date().toISOString(), level, message: String(message), details };
    this.#entries.push(entry);
    if (this.#entries.length > this.limit) this.#entries.splice(0, this.#entries.length - this.limit);
    this.dispatchEvent(new CustomEvent("entry", { detail: entry }));
    return entry;
  }
  info(message, details) { return this.add("info", message, details); }
  warn(message, details) { return this.add("warn", message, details); }
  error(message, details) { return this.add("error", message, details); }
  clear() { this.#entries = []; this.dispatchEvent(new Event("clear")); }
  toJSON() { return this.#entries.map((entry) => ({ ...entry })); }
  toText() { return this.#entries.map((entry) => `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}${entry.details ? ` ${JSON.stringify(entry.details)}` : ""}`).join("\n"); }
}
