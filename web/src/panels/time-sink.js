function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
  const width = Math.max(2, Math.round(rect.width * ratio));
  const height = Math.max(2, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; return true; }
  return false;
}

export class TimeSinkView {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { alpha: false });
    this.data = null;
    this.resizeObserver = new ResizeObserver(() => { resizeCanvas(canvas); this.draw(); });
    this.resizeObserver.observe(canvas);
    resizeCanvas(canvas);
  }
  destroy() { this.resizeObserver.disconnect(); }
  update(detail) { this.data = detail; this.draw(); }
  draw() {
    const ctx = this.context; const width = this.canvas.width; const height = this.canvas.height;
    if (!width || !height) return;
    ctx.fillStyle = "#050805"; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "rgba(104,126,108,.25)"; ctx.lineWidth = 1;
    for (let y = 1; y < 4; y++) { const py = y * height / 4; ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke(); }
    for (let x = 1; x < 8; x++) { const px = x * width / 8; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, height); ctx.stroke(); }
    if (!this.data?.i?.length) return;
    const draw = (values, stroke) => {
      ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, (globalThis.devicePixelRatio || 1)); ctx.beginPath();
      for (let index = 0; index < values.length; index += 1) {
        const x = index / Math.max(1, values.length - 1) * width;
        const y = height / 2 - Math.max(-1.1, Math.min(1.1, values[index])) * height * 0.42;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    draw(this.data.i, "rgba(215,255,63,.95)");
    draw(this.data.q, "rgba(91,231,255,.82)");
  }
}
