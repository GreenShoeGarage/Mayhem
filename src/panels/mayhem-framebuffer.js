import { formatFrequency, formatRate } from "../utils/format.js";

export class MayhemFramebufferTarget {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvas.width = 240;
    this.canvas.height = 320;
    this.context = canvas.getContext("2d", { alpha: false });
    this.state = { connection: "DISCONNECTED", frequencyHz: 100_000_000, sampleRate: 1_024_000, levelDbfs: null, source: "none" };
    this.draw();
  }

  update(patch) { Object.assign(this.state, patch); this.draw(); }

  draw() {
    const ctx = this.context;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0a0d0b"; ctx.fillRect(0, 0, 240, 320);
    ctx.fillStyle = "#1b251e"; ctx.fillRect(0, 0, 240, 28);
    ctx.fillStyle = "#d7ff3f"; ctx.font = "bold 12px ui-monospace, monospace"; ctx.textBaseline = "middle"; ctx.fillText("MAYHEM RTL", 8, 14);
    ctx.textAlign = "right"; ctx.fillStyle = "#9eaa9f"; ctx.font = "9px ui-monospace, monospace"; ctx.fillText("PORT TARGET", 232, 14); ctx.textAlign = "left";

    ctx.strokeStyle = "#344139"; ctx.strokeRect(8.5, 39.5, 223, 88);
    ctx.fillStyle = "#788379"; ctx.font = "9px ui-monospace, monospace"; ctx.fillText("UPSTREAM FRAMEBUFFER", 17, 55);
    ctx.fillStyle = "#ffb34e"; ctx.font = "bold 12px ui-monospace, monospace"; ctx.fillText("NOT YET LINKED", 17, 77);
    ctx.fillStyle = "#9eaa9f"; ctx.font = "9px ui-monospace, monospace";
    ctx.fillText("Browser shell and radio transport", 17, 97);
    ctx.fillText("are active. Mayhem UI linkage is", 17, 110);
    ctx.fillText("tracked in PORTING_MATRIX.md.", 17, 121);

    ctx.fillStyle = "#141b16"; ctx.fillRect(8, 140, 224, 96);
    ctx.fillStyle = "#6f7b71"; ctx.font = "8px ui-monospace, monospace"; ctx.fillText("SOURCE", 17, 155); ctx.fillText("CENTER", 17, 180); ctx.fillText("RATE", 17, 205); ctx.fillText("LEVEL", 17, 230);
    ctx.fillStyle = "#f0f4ec"; ctx.font = "bold 10px ui-monospace, monospace";
    ctx.fillText(String(this.state.source).toUpperCase(), 75, 155);
    ctx.fillText(formatFrequency(this.state.frequencyHz, 3), 75, 180);
    ctx.fillText(formatRate(this.state.sampleRate), 75, 205);
    ctx.fillText(Number.isFinite(this.state.levelDbfs) ? `${this.state.levelDbfs.toFixed(1)} dBFS` : "—", 75, 230);

    const statusColor = this.state.connection === "RECEIVING" ? "#63e58f" : this.state.connection === "SIMULATION" ? "#c69bff" : this.state.connection.includes("ERROR") ? "#ff6b64" : "#9eaa9f";
    ctx.fillStyle = statusColor; ctx.fillRect(8, 252, 224, 30);
    ctx.fillStyle = "#0b0f0c"; ctx.font = "bold 10px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText(this.state.connection, 120, 267); ctx.textAlign = "left";
    ctx.fillStyle = "#6f7b71"; ctx.font = "8px ui-monospace, monospace"; ctx.fillText("240 × 320 logical canvas • nearest-neighbor scaling", 8, 304);
  }
}
