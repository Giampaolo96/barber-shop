// Service worker minimo (ADR 009). In cache solo file statici con hash e icone, più la pagina
// /offline; pagine, dati, server action, /auth e /admin vanno sempre in rete e non si salvano.
// Cambiando la strategia si aumenta VERSION: all'attivazione le cache precedenti si cancellano.
// Emergenza: copiare sw-kill-switch.js su questo file e pubblicare.

const VERSION = "v1";
const CACHE = `barber-shop-static-${VERSION}`;
const OFFLINE_PATH = "/offline";

/** File statici di Next (nomi con hash, immutabili) e icone generate. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon/") ||
    url.pathname === "/apple-icon"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_PATH))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkWithOfflinePage(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const offline = await caches.match(OFFLINE_PATH);
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflinePage(request));
    return;
  }
  if (isStaticAsset(url)) event.respondWith(cacheFirst(request));
  // Tutto il resto (dati RSC, manifest, API) lo gestisce il browser, senza cache del worker.
});
