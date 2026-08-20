import { MayhemCoreBridge, MayhemKey } from "./mayhem-core.js";

const keyMap = new Map([
  ["ArrowRight", MayhemKey.RIGHT],
  ["ArrowLeft", MayhemKey.LEFT],
  ["ArrowDown", MayhemKey.DOWN],
  ["ArrowUp", MayhemKey.UP],
  ["Enter", MayhemKey.SELECT],
  [" ", MayhemKey.SELECT],
  ["Escape", MayhemKey.BACK],
  ["Backspace", MayhemKey.BACK]
]);

export class MayhemFramebufferTarget extends EventTarget {
  constructor(canvas, { onCoreReady = null, onCoreError = null } = {}) {
    super();
    this.canvas = canvas;
    this.canvas.width = 240;
    this.canvas.height = 320;
    this.canvas.tabIndex = 0;
    this.context = canvas.getContext("2d", { alpha: false });
    this.context.imageSmoothingEnabled = false;
    this.state = { connection: "DISCONNECTED", frequencyHz: 100_000_000, sampleRate: 1_024_000, levelDbfs: null, source: "none" };
    this.core = new MayhemCoreBridge();
    this.coreStatus = "loading";
    this.boundHandlers = [];
    this.drawFallback("LINKING WEBASSEMBLY CORE", "The logical framebuffer is loading.");
    this.readyPromise = this.core.init().then(() => {
      this.coreStatus = "linked";
      this.bindInput();
      this.update(this.state);
      onCoreReady?.(this.core);
      return this.core;
    }).catch((error) => {
      this.coreStatus = "error";
      this.drawFallback("CORE LINK FAILED", error.message);
      onCoreError?.(error);
      throw error;
    });
  }

  destroy() {
    for (const [target, type, handler, options] of this.boundHandlers) target.removeEventListener(type, handler, options);
    this.boundHandlers.length = 0;
  }

  on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.boundHandlers.push([target, type, handler, options]);
  }

  bindInput() {
    this.on(this.canvas, "keydown", (event) => {
      const mapped = keyMap.get(event.key);
      if (mapped == null) return;
      event.preventDefault();
      this.handleActivation(this.core.inputKey(mapped));
      this.present();
    });
    this.on(this.canvas, "wheel", (event) => {
      event.preventDefault();
      this.handleActivation(this.core.inputEncoder(event.deltaY > 0 ? 1 : -1));
      this.present();
    }, { passive: false });
    this.on(this.canvas, "pointerdown", (event) => {
      this.canvas.focus({ preventScroll: true });
      const p = this.logicalPoint(event);
      this.core.inputPointer(p.x, p.y, 0);
      this.present();
    });
    this.on(this.canvas, "pointermove", (event) => {
      if (!event.buttons) return;
      const p = this.logicalPoint(event);
      this.core.inputPointer(p.x, p.y, 1);
      this.present();
    });
    this.on(this.canvas, "pointerup", (event) => {
      const p = this.logicalPoint(event);
      this.handleActivation(this.core.inputPointer(p.x, p.y, 2));
      this.present();
    });
  }

  logicalPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(239, (event.clientX - rect.left) * 240 / rect.width)),
      y: Math.max(0, Math.min(319, (event.clientY - rect.top) * 320 / rect.height))
    };
  }

  handleActivation(entry) {
    if (!entry) return;
    this.dispatchEvent(new CustomEvent("activate", { detail: entry }));
  }

  update(patch) {
    Object.assign(this.state, patch);
    if (this.coreStatus === "linked") {
      this.core.update(this.state);
      this.present();
    } else if (this.coreStatus !== "loading") {
      this.drawFallback("CORE LINK FAILED", "See Diagnostics for the WebAssembly startup error.");
    }
  }

  present() {
    const frame = this.core.rgbaFrame();
    if (frame) this.context.putImageData(frame, 0, 0);
  }

  drawFallback(title, detail) {
    const ctx = this.context;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0a0d0b"; ctx.fillRect(0, 0, 240, 320);
    ctx.fillStyle = "#1b251e"; ctx.fillRect(0, 0, 240, 28);
    ctx.fillStyle = "#d7ff3f"; ctx.font = "bold 12px ui-monospace, monospace"; ctx.textBaseline = "middle"; ctx.fillText("MAYHEM RTL", 8, 14);
    ctx.strokeStyle = "#344139"; ctx.strokeRect(8.5, 39.5, 223, 94);
    ctx.fillStyle = "#788379"; ctx.font = "9px ui-monospace, monospace"; ctx.fillText("MAYHEM 240 × 320 CORE", 17, 56);
    ctx.fillStyle = this.coreStatus === "error" ? "#ff6b64" : "#ffb34e"; ctx.font = "bold 11px ui-monospace, monospace"; ctx.fillText(title, 17, 78);
    ctx.fillStyle = "#9eaa9f"; ctx.font = "8px ui-monospace, monospace";
    const text = String(detail || "").slice(0, 100);
    ctx.fillText(text.slice(0, 42), 17, 99);
    ctx.fillText(text.slice(42, 84), 17, 112);
    ctx.fillText(text.slice(84), 17, 125);
  }
}
