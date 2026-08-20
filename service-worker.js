/* Generated cache list is injected by scripts/build.mjs. */
const CACHE_NAME = "mayhem-rtl-v0.2.0";
const ASSETS = [
  "./assets/dsp_core.wasm",
  "./assets/icon.svg",
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
  "./src/audio/audio-ring-worklet.js",
  "./src/config.js",
  "./src/diagnostics/package.js",
  "./src/diagnostics/preflight.js",
  "./src/diagnostics/ring-log.js",
  "./src/dsp/fft.js",
  "./src/panels/mayhem-framebuffer.js",
  "./src/panels/spectrum-waterfall.js",
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
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (!response || response.status !== 200 || response.type === "opaque") return response;
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
