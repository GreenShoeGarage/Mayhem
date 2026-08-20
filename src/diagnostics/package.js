import { APP_NAME, APP_VERSION, UPSTREAM_COMMIT, WEBRTLSDR_COMMIT } from "../config.js";

function clean(value) {
  if (value === undefined) return undefined;
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(clean);
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (["usbDevice", "device", "file", "writable", "provider", "worker"].includes(key)) continue;
      output[key] = clean(entry);
    }
    return output;
  }
  return String(value);
}

export function createDiagnosticPackage({ preflight, browser, connection, device, receiver, stream, processing, capture, application, project, logs, includeSerial = false }) {
  const safeDevice = clean(device ?? {});
  if (!includeSerial && safeDevice && typeof safeDevice === "object") delete safeDevice.serialNumber;
  return {
    schema: "mayhem-rtl-diagnostics-v1",
    exportedAt: new Date().toISOString(),
    application: { name: APP_NAME, version: APP_VERSION, upstreamCommit: UPSTREAM_COMMIT, webRtlSdrCommit: WEBRTLSDR_COMMIT },
    privacy: { telemetry: false, analytics: false, serialIncluded: Boolean(includeSerial) },
    browser: clean(browser),
    preflight: clean(preflight),
    connection: clean(connection),
    device: safeDevice,
    receiver: clean(receiver),
    stream: clean(stream),
    processing: clean(processing),
    capture: clean(capture),
    activeApplication: clean(application),
    project: { id: project?.projectId ?? null, name: project?.name ?? "", mode: project?.mode ?? "", updatedAt: project?.updatedAt ?? null },
    log: clean(logs)
  };
}
