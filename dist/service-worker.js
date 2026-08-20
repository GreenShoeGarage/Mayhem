/* Generated cache list is injected by scripts/build.mjs. */
const CACHE_NAME = "mayhem-rtl-v0.8.2";
const ASSETS = [
  "./assets/dsp_core.wasm",
  "./assets/icon.svg",
  "./assets/mayhem_core.wasm",
  "./documents/ARCHITECTURE.md",
  "./documents/CHANGELOG.md",
  "./documents/COMPATIBILITY.md",
  "./documents/CONTRIBUTING.md",
  "./documents/LICENSE",
  "./documents/LICENSE.Apache-2.0",
  "./documents/LICENSE.GPL-2.0-or-later",
  "./documents/NOTICE.md",
  "./documents/PORTING_MATRIX.md",
  "./documents/PRIVACY.md",
  "./documents/README.md",
  "./documents/SECURITY.md",
  "./documents/SOURCE_ATTRIBUTION.md",
  "./documents/TEST_PLAN.md",
  "./documents/TEST_RESULTS.md",
  "./documents/THIRD_PARTY_LICENSES.md",
  "./documents/UPSTREAM_COMMIT.txt",
  "./documents/UPSTREAM_RUNTIME_AUDIT.md",
  "./documents/WEBRTLSDR_COMMIT.txt",
  "./documents/deployment/apache/.htaccess",
  "./documents/deployment/cloudflare/_headers",
  "./documents/deployment/generic/HEADERS.md",
  "./documents/deployment/netlify/_headers",
  "./documents/deployment/nginx/mayhem-rtl.conf",
  "./documents/test-results/browser-smoke-v0.1.0.json",
  "./documents/test-results/responsive-smoke-v0.1.0.json",
  "./index.html",
  "./manifest.webmanifest",
  "./src/app.js",
  "./src/apps/compatibility-manifest.js",
  "./src/apps/generated-registry.js",
  "./src/audio/audio-controller.js",
  "./src/audio/audio-ring-worklet.js",
  "./src/config.js",
  "./src/diagnostics/package.js",
  "./src/diagnostics/preflight.js",
  "./src/diagnostics/ring-log.js",
  "./src/dsp/adsb.js",
  "./src/dsp/demodulators.js",
  "./src/dsp/fft.js",
  "./src/panels/mayhem-core.js",
  "./src/panels/mayhem-framebuffer.js",
  "./src/panels/spectrum-waterfall.js",
  "./src/performance/stream-plan.js",
  "./src/radio/amateur-radio.js",
  "./src/radio/broadcast-radio.js",
  "./src/scanner/scanner-controller.js",
  "./src/simulation/simulation-source.js",
  "./src/state/command-queue.js",
  "./src/state/connection-state.js",
  "./src/state/project-store.js",
  "./src/storage/capture-store.js",
  "./src/storage/replay-source.js",
  "./src/usb/device-profiles.js",
  "./src/usb/webrtlsdr-lowlevel.js",
  "./src/usb/webusb-radio.js",
  "./src/utils/format.js",
  "./src/workers/processing-client.js",
  "./src/workers/processing-worker.js",
  "./src/workers/shared-block-pool.js",
  "./styles.css",
  "./version.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  const versionSensitive = event.request.mode === "navigate" || /\.(?:js|css|json|webmanifest)$/.test(requestUrl.pathname);
  if (versionSensitive) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response && response.status === 200 && response.type !== "opaque") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));

});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
