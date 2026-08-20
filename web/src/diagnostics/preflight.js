function row(id, name, status, detail, correctiveAction = "") {
  return { id, name, status, detail, correctiveAction };
}

export function runPreflight(scope = globalThis) {
  const nav = scope.navigator ?? {};
  const secure = Boolean(scope.isSecureContext);
  const usb = Boolean(nav.usb?.requestDevice);
  const wasm = typeof scope.WebAssembly === "object";
  const workers = typeof scope.Worker === "function";
  const audioWorklet = typeof scope.AudioWorkletNode === "function" || Boolean(scope.AudioContext?.prototype?.audioWorklet || scope.webkitAudioContext?.prototype?.audioWorklet);
  const isolated = Boolean(scope.crossOriginIsolated);
  const sharedMemory = typeof scope.SharedArrayBuffer === "function";
  const indexedDatabase = Boolean(scope.indexedDB);
  const storage = Boolean(nav.storage?.estimate);
  const serviceWorker = Boolean(nav.serviceWorker);

  const results = [
    row("secure-context", "Secure context", secure ? "pass" : "fail", secure ? "HTTPS or trusted local origin" : "Not a secure context", "Serve the application through HTTPS or the provided localhost development server."),
    row("webusb", "WebUSB Application Programming Interface (API)", usb ? "pass" : "fail", usb ? "Device picker available" : "Unavailable in this browser", "Use a current Chromium-based desktop browser with WebUSB enabled."),
    row("webassembly", "WebAssembly", wasm ? "pass" : "fail", wasm ? "Available" : "Unavailable", "Enable WebAssembly or use a browser that supports it."),
    row("workers", "Web Workers", workers ? "pass" : "fail", workers ? "Processing worker available" : "Unavailable", "Use a browser that supports module Web Workers."),
    row("cross-origin-isolation", "Cross-origin isolation", isolated ? "pass" : "warn", isolated ? "Shared-memory build eligible" : "Compatibility processing path", "Add Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp headers for the future threaded build."),
    row("shared-memory", "Shared WebAssembly memory", sharedMemory ? "pass" : "warn", sharedMemory ? "Available" : "Unavailable", "Enable the cross-origin isolation headers; this development build remains usable with transferable buffers."),
    row("audio-worklet", "AudioWorklet", audioWorklet ? "pass" : "warn", audioWorklet ? "Available" : "Unavailable", audioWorklet ? "WFM, NFM, and AM browser audio can be enabled after a user gesture." : "Spectrum, waterfall, capture, and replay remain usable, but WFM/NFM/AM playback requires AudioWorklet."),
    row("indexed-database", "Indexed Database", indexedDatabase ? "pass" : "warn", indexedDatabase ? "Project and capture metadata available" : "Capture persistence unavailable", "Allow site storage or leave private-browsing mode."),
    row("persistent-storage", "Persistent storage", storage ? "pass" : "warn", storage ? "Quota estimate available" : "Estimate unavailable", "The application can run session-only, but long captures require browser storage."),
    row("service-worker", "Service worker", serviceWorker ? "pass" : "warn", serviceWorker ? "Offline installation available" : "Offline installation unavailable", "Serve through HTTPS or localhost and allow service workers.")
  ];

  const blocking = results.filter((entry) => entry.status === "fail");
  return {
    ok: blocking.length === 0,
    liveRadioEligible: secure && usb && wasm && workers,
    compatibilityMode: !isolated || !sharedMemory,
    results,
    checkedAt: new Date().toISOString()
  };
}

export function browserSummary(scope = globalThis) {
  const nav = scope.navigator ?? {};
  const brands = nav.userAgentData?.brands?.map((item) => `${item.brand} ${item.version}`).join(", ");
  return {
    browser: brands || nav.userAgent || "unknown",
    platform: nav.userAgentData?.platform || nav.platform || "unknown",
    language: nav.language || "unknown",
    online: nav.onLine !== false,
    hardwareConcurrency: nav.hardwareConcurrency ?? null,
    deviceMemoryGiB: nav.deviceMemory ?? null
  };
}
