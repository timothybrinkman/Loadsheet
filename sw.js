// Load Sheet offline worker. Bump VERSION on every release.
const VERSION = "2026.10.26-5";
const CACHE = "loadsheet-" + VERSION;
const SHELL = ["./", "index.html", "office.html", "cloud.js", "config.js", "backend-firebase.js", "vendor/firebase.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("loadsheet-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Serve from the device first (instant, works with no signal); refresh the copy in the background.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    // each page is cached under its own address (index.html, office.html); ?add=… links reuse the cached page
    const key = req;
    const cached = (await cache.match(key, { ignoreSearch: true })) ||
      (req.mode === "navigate" && new URL(req.url).pathname.endsWith("/") ? await cache.match("index.html") : undefined);
    const fresh = fetch(req).then(res => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || new Response("Offline", { status: 503 });
  }));
});
