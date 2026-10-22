/* Пробка — офлайн-оболочка PWA */
const VERSION = "probka-v1.1.0";
const CORE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/app.css",
  "css/views.css",
  "js/util.js",
  "js/store.js",
  "js/model.js",
  "js/board.js",
  "js/overlays.js",
  "js/panels.js",
  "js/views-core.js",
  "js/views-life.js",
  "js/tools.js",
  "js/sync.js",
  "js/main.js",
  "assets/icon.svg",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png",
  "assets/fonts/fonts.css",
  "assets/fonts/manrope-200_800-normal-cyrillic.woff2",
  "assets/fonts/manrope-200_800-normal-cyrillic-ext.woff2",
  "assets/fonts/manrope-200_800-normal-latin.woff2",
  "assets/fonts/manrope-200_800-normal-latin-ext.woff2",
  "assets/fonts/caveat-400_700-normal-cyrillic.woff2",
  "assets/fonts/caveat-400_700-normal-cyrillic-ext.woff2",
  "assets/fonts/caveat-400_700-normal-latin.woff2",
  "assets/fonts/caveat-400_700-normal-latin-ext.woff2",
  "assets/fonts/neucha-400-normal-cyrillic.woff2",
  "assets/fonts/neucha-400-normal-latin.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn("Пробка: кэш не создан", err))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isBypassed(url) {
  return url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/mcp/") ||
    url.pathname === "/health";
}

async function networkFirst(request, fallback) {
  const cache = await caches.open(VERSION);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
      return fresh;
    }
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match(fallback || "index.html");
    if (shell) return shell;
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match(fallback || "index.html");
    if (shell) return shell;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (isBypassed(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "index.html"));
    return;
  }
  const changing = /\.(?:js|css|html|webmanifest)$/i.test(url.pathname) ||
    request.destination === "script" || request.destination === "style" || request.destination === "document";
  event.respondWith(changing ? networkFirst(request) : staleWhileRevalidate(request));
});
