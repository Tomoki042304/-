// Offline shell for the installed app. Pages and scripts: network first (so updates show up),
// falling back to the cached copy when offline. Firebase / Supabase traffic is never cached here.
const CACHE = "ikigai-v10-private-api";
const SHELL = ["./", "index.html", "main-supabase.js", "app.js", "supabase-config.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
// local test settings and the test-only panel: always fetched fresh and never stored
const NEVER_CACHE = /\/(supabase-config\.local\.js|dev-faults\.js|\.env[^/]*)$/;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || NEVER_CACHE.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});
