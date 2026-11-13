// 7metro - service worker probisionala
// Aldaketak argitaratzean, aldatu CACHE bertsioa.
const CACHE = "7metro-v160";
const SHELL = ["./", "./index.html", "./manifest.json",
  "./inbox.js?v=160",
  "./weekly-training.js?v=160",
  "./locales/es.js?v=160", "./i18n.js?v=160", "./app.js?v=160", "./insights-data.js?v=160", "./insights.js?v=160",
  "./portal.js?v=160", "./portal-events.js?v=160", "./portal-calendar.js?v=160", "./push.js?v=160", "./portal.css?v=160", "./report-pdf.js?v=160", "./insights.css?v=160", "./vendor/jspdf.umd.min.js",
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

function pushBinding(operation, value) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("7metro-push", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("state");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, transaction = db.transaction("state", operation === "get" ? "readonly" : "readwrite"), store = transaction.objectStore("state");
      const request = operation === "get" ? store.get("binding") : operation === "set" ? store.put(value, "binding") : store.delete("binding");
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}
self.addEventListener("message", event => {
  const message = event.data || {}, source = event.source && event.source.url;
  if (!source || new URL(source).origin !== location.origin || !new URL(source).pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  if (!["7METRO_PUSH_PING", "7METRO_PUSH_BIND", "7METRO_PUSH_CLEAR"].includes(message.type)) return;
  event.waitUntil((async () => {
    try {
      if (message.type === "7METRO_PUSH_BIND") {
        if (typeof message.binding !== "string" || !/^[0-9a-f-]{36}$/.test(message.binding)) throw Error("Invalid binding");
        await pushBinding("set", message.binding);
      } else if (message.type === "7METRO_PUSH_CLEAR" && (!message.binding || message.binding === await pushBinding("get"))) {
        await pushBinding("clear");
        const notifications = await self.registration.getNotifications(); notifications.forEach(notification => notification.close());
      }
      event.ports[0]?.postMessage({ ok: true });
    } catch { event.ports[0]?.postMessage({ ok: false }); }
  })());
});
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data; try { data = event.data.json(); } catch { return; }
    if (!data || data.binding !== await pushBinding("get") || !Number.isSafeInteger(data.notification_id) || data.notification_id < 1) return;
    await self.registration.showNotification(String(data.title || "7metro").slice(0, 150), {
      body: String(data.body || "").slice(0, 300), icon: new URL("icons/icon-192.png", self.registration.scope).href,
      badge: new URL("icons/icon-192.png", self.registration.scope).href, tag: String(data.tag || "7metro"), renotify: false,
      data: { id: data.notification_id }
    });
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close(); const id = Number(event.notification.data && event.notification.data.id);
  if (!Number.isSafeInteger(id) || id < 1) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }), scope = new URL(self.registration.scope);
    const entryPath = new URL("index.html", scope).pathname;
    const client = windows.find(window => { const url = new URL(window.url); return url.origin === scope.origin && (url.pathname === scope.pathname || url.pathname === entryPath); });
    if (client) { try { await client.focus(); client.postMessage({ type: "7METRO_PUSH_OPEN", id }); return; } catch {} }
    const url = new URL("index.html", scope); url.searchParams.set("notification", String(id)); await self.clients.openWindow(url.href);
  })());
});
