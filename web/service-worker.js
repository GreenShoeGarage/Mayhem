/* Generated cache list is injected by scripts/build.mjs. */
const CACHE_NAME = "mayhem-rtl-v__APP_VERSION__";
const ASSETS = __ASSET_LIST__;

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
