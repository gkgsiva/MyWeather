// Service worker of the web version (served by server.js, which fills in the
// build). It keeps the app's own files so the app opens with no connection;
// the app keeps its data and radar pictures itself (js/offline.js, js/idb.js).
// Files are fetched fresh when online, so a new deploy shows on the next open.
const CACHE = "myweather-web-__BUILD__";
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "js/webproxy.js", "icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only the app's own files; data (/p/), frames and other sites go straight to the network.
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/p/") || url.pathname.startsWith("/frame") || url.pathname === "/healthz") return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
