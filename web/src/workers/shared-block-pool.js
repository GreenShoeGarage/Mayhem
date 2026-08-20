/* Fixed-slot shared raw-sample pool used when cross-origin isolation permits SharedArrayBuffer. SPDX-License-Identifier: GPL-2.0-or-later */
export class SharedBlockPool {
  constructor({ slotBytes = 131072, slots = 8, buffer = null } = {}) {
    this.slotBytes = Math.max(4096, Math.round(Number(slotBytes) || 131072));
    this.slots = Math.max(2, Math.min(16, Math.round(Number(slots) || 8)));
    const SharedCtor = globalThis.SharedArrayBuffer;
    if (!buffer && typeof SharedCtor !== "function") throw new Error("SharedArrayBuffer is unavailable.");
    this.buffer = buffer ?? new SharedCtor(this.slotBytes * this.slots);
    if (this.buffer.byteLength < this.slotBytes * this.slots) throw new Error("Shared sample buffer is smaller than the declared slot layout.");
    this.bytes = new Uint8Array(this.buffer);
    this.free = Array.from({ length: this.slots }, (_, index) => index);
    this.inUse = new Set();
    this.highWater = 0;
  }

  acquire(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) throw new TypeError("Shared block input must be an ArrayBuffer.");
    if (arrayBuffer.byteLength > this.slotBytes || this.free.length === 0) return null;
    const slot = this.free.pop();
    const offset = slot * this.slotBytes;
    this.bytes.set(new Uint8Array(arrayBuffer), offset);
    this.inUse.add(slot);
    this.highWater = Math.max(this.highWater, this.inUse.size);
    return { slot, offset, length: arrayBuffer.byteLength };
  }

  release(slot) {
    const index = Number(slot);
    if (!this.inUse.delete(index)) return false;
    this.free.push(index);
    return true;
  }

  view(slot, length) {
    const index = Number(slot);
    const size = Math.max(0, Math.min(this.slotBytes, Math.round(Number(length) || 0)));
    return new Uint8Array(this.buffer, index * this.slotBytes, size);
  }

  reset() {
    this.inUse.clear();
    this.free = Array.from({ length: this.slots }, (_, index) => index);
  }

  snapshot() {
    return { slots: this.slots, slotBytes: this.slotBytes, inUse: this.inUse.size, free: this.free.length, highWater: this.highWater };
  }
}
