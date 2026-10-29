// Offline shell for the installed app. Pages and scripts: network first (so updates show up),
// falling back to the cached copy when offline. Firebase / Supabase traffic is never cached here.
const CACHE = "ikigai-v24-header-complete";
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

self.addEventListener("push", event => {
  let payload={};try{payload=event.data?.json()||{}}catch{}
  const title=typeof payload.title==='string'?payload.title.slice(0,80):'IKIGAI';
  const body=typeof payload.body==='string'?payload.body.slice(0,160):'新しいお知らせがあります。';
  const data={};if(['like','comment'].includes(payload.data?.kind))data.kind=payload.data.kind;if(typeof payload.data?.postKey==='string'&&payload.data.postKey.length<151)data.postKey=payload.data.postKey;if(typeof payload.data?.threadId==='string'&&payload.data.threadId.length===73)data.threadId=payload.data.threadId;
  event.waitUntil(self.registration.showNotification(title,{body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:typeof payload.tag==='string'?payload.tag.slice(0,200):undefined,data}));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();const data=event.notification.data||{};
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();client.postMessage({type:'ikigai-open-notification',...data});return}}const url=new URL('./',self.registration.scope);if(data.postKey)url.searchParams.set('openPost',data.postKey);if(data.threadId)url.searchParams.set('openDm',data.threadId);await self.clients.openWindow(url.href)})());
});
