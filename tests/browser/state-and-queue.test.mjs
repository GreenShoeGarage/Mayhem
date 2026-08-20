import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionState, ConnectionStateMachine } from "../../web/src/state/connection-state.js";
import { SerializedCommandQueue } from "../../web/src/state/command-queue.js";

if (!globalThis.CustomEvent) globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };

test("connection state rejects illegal transitions and invalidates stale sessions", () => {
  const machine = new ConnectionStateMachine(ConnectionState.READY);
  const session = machine.beginSession();
  machine.transition(ConnectionState.SELECTING_DEVICE);
  machine.transition(ConnectionState.OPENING_DEVICE);
  assert.equal(machine.isCurrent(session), true);
  machine.invalidateSession();
  assert.equal(machine.isCurrent(session), false);
  assert.throws(() => machine.transition(ConnectionState.RECEIVING), /Illegal connection transition/);
});

test("latest-wins commands skip superseded work while preserving serialization", async () => {
  const queue = new SerializedCommandQueue();
  const order = [];
  const first = queue.enqueue("tune", async () => { order.push("first"); return 1; }, { key: "frequency", latestWins: true });
  const second = queue.enqueue("tune", async () => { order.push("second"); return 2; }, { key: "frequency", latestWins: true });
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.skipped, true);
  assert.equal(b.value, 2);
  assert.deepEqual(order, ["second"]);
});
