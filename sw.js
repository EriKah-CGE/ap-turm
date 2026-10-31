/* Service worker for the AP character sheet (GitHub Pages).
 * Network-first with cache fallback, only for the files below. The cache name carries the app build version
 * (the buildtag in ap-character-sheet.html, passed as ?v=... at registration); a new build registers a new worker,
 * which deletes the old caches on activate. */
const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `ap-sheet-${BUILD}`;
const FILES = ["ap-character-sheet.html", "index.html", "manifest.webmanifest", "icons/app-192.png", "icons/app-512.png"];
const BASE = new URL("./", self.location.href);
const URLS = new Set(FILES.map(f => new URL(f, BASE).href));
URLS.add(BASE.href); // "/ap-turm/" serves index.html

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("ap-sheet-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  url.search = ""; url.hash = "";
  if (!URLS.has(url.href)) return;
  const key = url.href === BASE.href ? new URL("index.html", BASE).href : url.href;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
        return res;
      })
      .catch(() => caches.match(key, { ignoreSearch: true }))
  );
});
