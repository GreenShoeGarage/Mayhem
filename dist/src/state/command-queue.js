export class SerializedCommandQueue {
  #tail = Promise.resolve();
  #sequence = 0;
  #latestByKey = new Map();
  #closed = false;

  enqueue(name, task, { key = null, latestWins = false } = {}) {
    if (this.#closed) return Promise.reject(new Error("Command queue is closed"));
    const sequence = ++this.#sequence;
    if (key && latestWins) this.#latestByKey.set(key, sequence);
    const execute = async () => {
      if (key && latestWins && this.#latestByKey.get(key) !== sequence) return { skipped: true, sequence };
      const value = await task({ sequence });
      return { skipped: false, sequence, value };
    };
    const result = this.#tail.then(execute, execute);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async drain() { await this.#tail; }
  close() { this.#closed = true; }
  reopen() { this.#closed = false; }
  get sequence() { return this.#sequence; }
}
