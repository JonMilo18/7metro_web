// 7metro - service worker probisionala
// Aldaketak argitaratzean, aldatu CACHE bertsioa.
const CACHE = "7metro-v148";
const SHELL = ["./", "./index.html", "./manifest.json",
  "./locales/es.js?v=148", "./i18n.js?v=148", "./app.js?v=148", "./insights-data.js?v=148", "./insights.js?v=148",
  "./portal.js?v=148", "./portal-events.js?v=148", "./portal.css?v=148", "./report-pdf.js?v=148", "./insights.css?v=148", "./vendor/jspdf.umd.min.js",
  "./vendor/fonts/NotoSans-Regular.ttf", "./vendor/fonts/NotoSans-Bold.ttf",
  "./irudiak/Zelaia.png", "./irudiak/Zelai-erdia.png",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Nabigazioa: sarea lehenik, konexiorik ez badago cachea
  if (req.mode === "navigate") {
    e.respondWith(fetch(req, { cache: "no-cache" }).then(r => { caches.open(CACHE).then(c => c.put("./index.html", r.clone())); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r;
  })));
});
