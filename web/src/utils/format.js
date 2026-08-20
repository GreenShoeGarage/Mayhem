export function formatFrequency(hz, digits = 3) {
  const value = Number(hz);
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(digits)} GHz`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(digits)} MHz`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(digits)} kHz`;
  return `${Math.round(value)} Hz`;
}

export function formatRate(rate) {
  const value = Number(rate);
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e6) return `${(value / 1e6).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} Msps`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} ksps`;
  return `${Math.round(value)} sps`;
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < units.length - 1) { scaled /= 1024; index += 1; }
  return `${scaled.toFixed(index === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2)} ${units[index]}`;
}

export function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = Math.floor(value % 60);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")}` : `${minutes}:${String(secs).padStart(2,"0")}`;
}

export function formatDateTime(value) {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)); }
  catch { return "—"; }
}

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
export function makeId(prefix = "id") { return `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`; }
export function safeFilename(value, fallback = "file") {
  const result = String(value ?? "").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  return result || fallback;
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(filename);
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}
