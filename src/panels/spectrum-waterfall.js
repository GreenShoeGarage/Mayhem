import { clamp, formatFrequency } from "../utils/format.js";

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(2, Math.round(rect.width * ratio));
  const height = Math.max(2, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; return true; }
  return false;
}

function waterfallColor(normalized) {
  const value = clamp(normalized, 0, 1);
  let r = 0, g = 0, b = 0;
  if (value < 0.2) { const t = value / 0.2; r = 5; g = 8 + 22 * t; b = 18 + 72 * t; }
  else if (value < 0.45) { const t = (value - 0.2) / 0.25; r = 5 + 18 * t; g = 30 + 100 * t; b = 90 + 90 * t; }
  else if (value < 0.68) { const t = (value - 0.45) / 0.23; r = 23 + 52 * t; g = 130 + 100 * t; b = 180 - 70 * t; }
  else if (value < 0.86) { const t = (value - 0.68) / 0.18; r = 75 + 180 * t; g = 230 - 70 * t; b = 110 - 75 * t; }
  else { const t = (value - 0.86) / 0.14; r = 255; g = 160 + 90 * t; b = 35 + 200 * t; }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

export class SpectrumWaterfallView extends EventTarget {
  constructor({ spectrumCanvas, waterfallCanvas }) {
    super();
    this.spectrumCanvas = spectrumCanvas;
    this.waterfallCanvas = waterfallCanvas;
    this.spectrumContext = spectrumCanvas.getContext("2d", { alpha: false });
    this.waterfallContext = waterfallCanvas.getContext("2d", { alpha: false });
    this.waterfallBuffer = document.createElement("canvas");
    this.waterfallBufferContext = this.waterfallBuffer.getContext("2d", { alpha: false, willReadFrequently: true });
    this.centerFrequencyHz = 100_000_000;
    this.sampleRate = 1_024_000;
    this.spanHz = 1_024_000;
    this.referenceLevelDb = 0;
    this.dynamicRangeDb = 90;
    this.spectrum = null;
    this.peak = null;
    this.markers = [];
    this.paused = false;
    this.lastPointer = null;
    this.dragging = false;
    this.tuningStepHz = 1000;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(spectrumCanvas);
    this.resizeObserver.observe(waterfallCanvas);
    this.#installInteractions();
    this.resize();
  }

  destroy() { this.resizeObserver.disconnect(); }

  configure(settings = {}) {
    if (Number.isFinite(settings.centerFrequencyHz)) this.centerFrequencyHz = Number(settings.centerFrequencyHz);
    if (Number.isFinite(settings.sampleRate)) this.sampleRate = Number(settings.sampleRate);
    if (Number.isFinite(settings.spanHz)) this.spanHz = clamp(Number(settings.spanHz), 1000, Math.max(1000, this.sampleRate));
    if (Number.isFinite(settings.referenceLevelDb)) this.referenceLevelDb = Number(settings.referenceLevelDb);
    if (Number.isFinite(settings.dynamicRangeDb)) this.dynamicRangeDb = clamp(Number(settings.dynamicRangeDb), 20, 160);
    if (Number.isFinite(settings.tuningStepHz)) this.tuningStepHz = Number(settings.tuningStepHz);
    if (Array.isArray(settings.markers)) this.markers = settings.markers;
    this.drawSpectrum();
  }

  update({ spectrum, peak = null, frequency, sampleRate }) {
    if (Number.isFinite(frequency)) this.centerFrequencyHz = Number(frequency);
    if (Number.isFinite(sampleRate)) { this.sampleRate = Number(sampleRate); this.spanHz = Math.min(this.spanHz, this.sampleRate); }
    if (this.paused) return;
    this.spectrum = spectrum;
    this.peak = peak;
    this.drawSpectrum();
    this.pushWaterfallRow(spectrum);
  }

  setPaused(value) { this.paused = Boolean(value); this.dispatchEvent(new CustomEvent("pause", { detail: { paused: this.paused } })); }
  clearPeak() { this.peak = null; this.dispatchEvent(new Event("clear-peak")); this.drawSpectrum(); }
  clearWaterfall() { this.waterfallBufferContext.fillStyle = "#050805"; this.waterfallBufferContext.fillRect(0, 0, this.waterfallBuffer.width, this.waterfallBuffer.height); this.waterfallContext.drawImage(this.waterfallBuffer, 0, 0); }

  resize() {
    const spectrumChanged = resizeCanvas(this.spectrumCanvas);
    const waterfallChanged = resizeCanvas(this.waterfallCanvas);
    if (waterfallChanged) {
      this.waterfallBuffer.width = this.waterfallCanvas.width;
      this.waterfallBuffer.height = this.waterfallCanvas.height;
      this.clearWaterfall();
    }
    if (spectrumChanged) this.drawSpectrum();
  }

  drawSpectrum() {
    const canvas = this.spectrumCanvas;
    const ctx = this.spectrumContext;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;
    const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
    const left = 48 * ratio;
    const right = 10 * ratio;
    const top = 10 * ratio;
    const bottom = 24 * ratio;
    const plotWidth = Math.max(1, width - left - right);
    const plotHeight = Math.max(1, height - top - bottom);
    ctx.fillStyle = "#050805";
    ctx.fillRect(0, 0, width, height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(104,126,108,0.22)";
    ctx.fillStyle = "rgba(210,223,211,0.62)";
    ctx.font = `${9 * ratio}px ui-monospace, monospace`;
    ctx.textBaseline = "middle";
    for (let yIndex = 0; yIndex <= 6; yIndex += 1) {
      const y = top + plotHeight * yIndex / 6;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
      const db = this.referenceLevelDb - this.dynamicRangeDb * yIndex / 6;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(db)}`, left - 6 * ratio, y);
    }
    const startFrequency = this.centerFrequencyHz - this.spanHz / 2;
    for (let xIndex = 0; xIndex <= 8; xIndex += 1) {
      const x = left + plotWidth * xIndex / 8;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotHeight); ctx.stroke();
      const frequency = startFrequency + this.spanHz * xIndex / 8;
      ctx.textAlign = xIndex === 0 ? "left" : xIndex === 8 ? "right" : "center";
      ctx.textBaseline = "top";
      ctx.fillText(formatFrequency(frequency, this.spanHz >= 1e6 ? 3 : 1).replace(" ", ""), x, top + plotHeight + 5 * ratio);
      ctx.textBaseline = "middle";
    }

    const centerX = left + plotWidth / 2;
    ctx.strokeStyle = "rgba(215,255,63,0.68)";
    ctx.beginPath(); ctx.moveTo(centerX, top); ctx.lineTo(centerX, top + plotHeight); ctx.stroke();

    if (this.spectrum?.length) {
      const drawLine = (array, color, lineWidth) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth * ratio;
        ctx.beginPath();
        for (let pixel = 0; pixel < plotWidth; pixel += 1) {
          const frequencyFraction = pixel / Math.max(1, plotWidth - 1);
          const visibleOffset = (frequencyFraction - 0.5) * this.spanHz;
          const sourceFraction = 0.5 + visibleOffset / this.sampleRate;
          const sourceIndex = clamp(Math.round(sourceFraction * (array.length - 1)), 0, array.length - 1);
          const value = array[sourceIndex];
          const normalized = clamp((this.referenceLevelDb - value) / this.dynamicRangeDb, 0, 1);
          const x = left + pixel;
          const y = top + normalized * plotHeight;
          if (pixel === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      };
      if (this.peak?.length) drawLine(this.peak, "rgba(255,179,78,0.64)", 1);
      drawLine(this.spectrum, "rgba(215,255,63,0.95)", 1.25);
    }

    for (const marker of this.markers) {
      const offset = marker.frequencyHz - this.centerFrequencyHz;
      if (Math.abs(offset) > this.spanHz / 2) continue;
      const x = left + (offset / this.spanHz + 0.5) * plotWidth;
      ctx.strokeStyle = marker.color || "rgba(91,231,255,0.9)";
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + plotHeight); ctx.stroke();
      ctx.fillStyle = marker.color || "#5be7ff";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(marker.label || "M", x + 4 * ratio, top + 3 * ratio);
    }
  }

  pushWaterfallRow(spectrum) {
    const width = this.waterfallBuffer.width;
    const height = this.waterfallBuffer.height;
    if (!width || !height || !spectrum?.length) return;
    const ctx = this.waterfallBufferContext;
    ctx.drawImage(this.waterfallBuffer, 0, 0, width, height - 1, 0, 1, width, height - 1);
    const image = ctx.createImageData(width, 1);
    for (let x = 0; x < width; x += 1) {
      const visibleOffset = (x / Math.max(1, width - 1) - 0.5) * this.spanHz;
      const sourceFraction = 0.5 + visibleOffset / this.sampleRate;
      const index = clamp(Math.round(sourceFraction * (spectrum.length - 1)), 0, spectrum.length - 1);
      const value = spectrum[index];
      const normalized = 1 - clamp((this.referenceLevelDb - value) / this.dynamicRangeDb, 0, 1);
      const [r, g, b] = waterfallColor(normalized);
      image.data[x * 4] = r; image.data[x * 4 + 1] = g; image.data[x * 4 + 2] = b; image.data[x * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.waterfallContext.drawImage(this.waterfallBuffer, 0, 0, this.waterfallCanvas.width, this.waterfallCanvas.height);
  }

  async screenshot() {
    const width = Math.max(this.spectrumCanvas.width, this.waterfallCanvas.width);
    const height = this.spectrumCanvas.height + this.waterfallCanvas.height;
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#050805"; context.fillRect(0, 0, width, height);
    context.drawImage(this.spectrumCanvas, 0, 0, width, this.spectrumCanvas.height);
    context.drawImage(this.waterfallCanvas, 0, this.spectrumCanvas.height, width, this.waterfallCanvas.height);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Screenshot encoding failed.")), "image/png"));
  }

  #installInteractions() {
    const canvas = this.spectrumCanvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Interactive radio spectrum. Click to tune, drag to pan, use the wheel to zoom, or use arrow keys to tune.");
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.lastPointer = { x: event.clientX, center: this.centerFrequencyHz };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging || !this.lastPointer) return;
      const rect = canvas.getBoundingClientRect();
      const delta = event.clientX - this.lastPointer.x;
      const frequency = this.lastPointer.center - delta / Math.max(1, rect.width) * this.spanHz;
      this.dispatchEvent(new CustomEvent("pan", { detail: { centerFrequencyHz: frequency, commit: false } }));
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!this.dragging || !this.lastPointer) return;
      const rect = canvas.getBoundingClientRect();
      const delta = event.clientX - this.lastPointer.x;
      const distance = Math.abs(delta);
      this.dragging = false;
      canvas.releasePointerCapture(event.pointerId);
      if (distance < 4) {
        const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        const frequency = this.centerFrequencyHz + (fraction - 0.5) * this.spanHz;
        if (event.shiftKey) this.dispatchEvent(new CustomEvent("marker", { detail: { frequencyHz: frequency } }));
        else this.dispatchEvent(new CustomEvent("tune", { detail: { frequencyHz: frequency } }));
      } else {
        const frequency = this.lastPointer.center - delta / Math.max(1, rect.width) * this.spanHz;
        this.dispatchEvent(new CustomEvent("pan", { detail: { centerFrequencyHz: frequency, commit: true } }));
      }
      this.lastPointer = null;
    });
    canvas.addEventListener("pointercancel", () => { this.dragging = false; this.lastPointer = null; });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.22 : 0.82;
      const next = clamp(this.spanHz * factor, 1000, this.sampleRate);
      this.dispatchEvent(new CustomEvent("zoom", { detail: { spanHz: next } }));
    }, { passive: false });
    canvas.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(event.key)) return;
      event.preventDefault();
      const direction = ["ArrowRight", "PageUp"].includes(event.key) ? 1 : -1;
      const multiplier = event.shiftKey ? 10 : 1;
      this.dispatchEvent(new CustomEvent("tune", { detail: { frequencyHz: this.centerFrequencyHz + direction * this.tuningStepHz * multiplier } }));
    });
  }
}
