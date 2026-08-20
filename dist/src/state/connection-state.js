export const ConnectionState = Object.freeze({
  UNSUPPORTED_BROWSER: "UNSUPPORTED_BROWSER",
  READY: "READY",
  SELECTING_DEVICE: "SELECTING_DEVICE",
  OPENING_DEVICE: "OPENING_DEVICE",
  INITIALIZING_TUNER: "INITIALIZING_TUNER",
  CONNECTED_IDLE: "CONNECTED_IDLE",
  STARTING_RECEIVER: "STARTING_RECEIVER",
  RECEIVING: "RECEIVING",
  STOPPING_RECEIVER: "STOPPING_RECEIVER",
  DISCONNECTED: "DISCONNECTED",
  PERMISSION_REVOKED: "PERMISSION_REVOKED",
  DEVICE_REMOVED: "DEVICE_REMOVED",
  RECOVERING: "RECOVERING",
  ERROR: "ERROR",
  SIMULATION: "SIMULATION",
  REPLAY: "REPLAY"
});

const allowed = new Map([
  [ConnectionState.UNSUPPORTED_BROWSER, [ConnectionState.SIMULATION, ConnectionState.REPLAY]],
  [ConnectionState.READY, [ConnectionState.SELECTING_DEVICE, ConnectionState.SIMULATION, ConnectionState.REPLAY, ConnectionState.DISCONNECTED]],
  [ConnectionState.SELECTING_DEVICE, [ConnectionState.OPENING_DEVICE, ConnectionState.READY, ConnectionState.PERMISSION_REVOKED, ConnectionState.ERROR]],
  [ConnectionState.OPENING_DEVICE, [ConnectionState.INITIALIZING_TUNER, ConnectionState.ERROR, ConnectionState.DEVICE_REMOVED, ConnectionState.DISCONNECTED]],
  [ConnectionState.INITIALIZING_TUNER, [ConnectionState.CONNECTED_IDLE, ConnectionState.ERROR, ConnectionState.DEVICE_REMOVED, ConnectionState.DISCONNECTED]],
  [ConnectionState.CONNECTED_IDLE, [ConnectionState.STARTING_RECEIVER, ConnectionState.DISCONNECTED, ConnectionState.DEVICE_REMOVED, ConnectionState.ERROR]],
  [ConnectionState.STARTING_RECEIVER, [ConnectionState.RECEIVING, ConnectionState.CONNECTED_IDLE, ConnectionState.ERROR, ConnectionState.DEVICE_REMOVED]],
  [ConnectionState.RECEIVING, [ConnectionState.STOPPING_RECEIVER, ConnectionState.DEVICE_REMOVED, ConnectionState.ERROR]],
  [ConnectionState.STOPPING_RECEIVER, [ConnectionState.CONNECTED_IDLE, ConnectionState.DISCONNECTED, ConnectionState.DEVICE_REMOVED, ConnectionState.ERROR]],
  [ConnectionState.DISCONNECTED, [ConnectionState.SELECTING_DEVICE, ConnectionState.SIMULATION, ConnectionState.REPLAY, ConnectionState.READY]],
  [ConnectionState.PERMISSION_REVOKED, [ConnectionState.SELECTING_DEVICE, ConnectionState.READY, ConnectionState.SIMULATION]],
  [ConnectionState.DEVICE_REMOVED, [ConnectionState.RECOVERING, ConnectionState.SELECTING_DEVICE, ConnectionState.DISCONNECTED, ConnectionState.SIMULATION]],
  [ConnectionState.RECOVERING, [ConnectionState.OPENING_DEVICE, ConnectionState.CONNECTED_IDLE, ConnectionState.DISCONNECTED, ConnectionState.ERROR]],
  [ConnectionState.ERROR, [ConnectionState.SELECTING_DEVICE, ConnectionState.DISCONNECTED, ConnectionState.SIMULATION, ConnectionState.REPLAY, ConnectionState.READY]],
  [ConnectionState.SIMULATION, [ConnectionState.RECEIVING, ConnectionState.STOPPING_RECEIVER, ConnectionState.READY, ConnectionState.DISCONNECTED, ConnectionState.REPLAY]],
  [ConnectionState.REPLAY, [ConnectionState.RECEIVING, ConnectionState.STOPPING_RECEIVER, ConnectionState.READY, ConnectionState.DISCONNECTED, ConnectionState.SIMULATION]]
]);

export class ConnectionStateMachine extends EventTarget {
  #state;
  #sessionId = 0;
  #history = [];

  constructor(initialState = ConnectionState.READY) {
    super();
    this.#state = initialState;
    this.#record(null, initialState, "initial");
  }

  get state() { return this.#state; }
  get sessionId() { return this.#sessionId; }
  get history() { return [...this.#history]; }

  beginSession() {
    this.#sessionId += 1;
    return this.#sessionId;
  }

  invalidateSession() {
    this.#sessionId += 1;
    return this.#sessionId;
  }

  isCurrent(sessionId) { return sessionId === this.#sessionId; }

  canTransition(next) {
    return next === this.#state || (allowed.get(this.#state) ?? []).includes(next);
  }

  transition(next, reason = "") {
    if (next === this.#state) return this.#state;
    if (!this.canTransition(next)) throw new Error(`Illegal connection transition ${this.#state} → ${next}`);
    const previous = this.#state;
    this.#state = next;
    this.#record(previous, next, reason);
    this.dispatchEvent(new CustomEvent("change", { detail: { previous, state: next, reason, sessionId: this.#sessionId } }));
    return this.#state;
  }

  force(next, reason = "forced recovery") {
    const previous = this.#state;
    this.#state = next;
    this.#record(previous, next, reason);
    this.dispatchEvent(new CustomEvent("change", { detail: { previous, state: next, reason, sessionId: this.#sessionId, forced: true } }));
  }

  #record(previous, state, reason) {
    this.#history.push({ timestamp: new Date().toISOString(), previous, state, reason, sessionId: this.#sessionId });
    if (this.#history.length > 100) this.#history.splice(0, this.#history.length - 100);
  }
}
