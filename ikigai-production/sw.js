// Cache only the public application shell, never account data or API responses.
const CACHE = "ikigai-v57-pull-refresh-log-notice";
const SHELL = ["./", "index.html", "main-supabase.js", "app.js", "supabase-config.js",
  "manifest.webmanifest", "update-manager.js", "pull-refresh.js", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const PUBLIC_FILES = new Set([...SHELL, 'update-manager.js', 'pull-refresh.js', 'direct-messages.js',
  'message-reactions.js', 'security-settings.js', 'announcements.js', 'inquiry.js', 'push-notifications.js',
  'shin-ai.js', 'shin-knowledge.js', 'youtube-recommendations.js'].map(path => new URL(path, self.registration.scope).href));
function cacheable(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && !request.headers.has('Authorization') &&
    !url.search && PUBLIC_FILES.has(url.href);
}
async function cleanup() {
  // Other applications may share this origin. Only remove this app's old caches.
  for (const key of await caches.keys()) {
    if (key.startsWith('ikigai-v') && key !== CACHE) await caches.delete(key);
  }
  const cache = await caches.open(CACHE);
  for (const request of await cache.keys()) if (!cacheable(request)) await cache.delete(request);
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(cleanup().then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ikigai-maintenance') event.waitUntil(cleanup());
});
self.addEventListener('fetch', event => {
  if (!cacheable(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== 'opaqueredirect' && !response.redirected &&
          !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      // Never return HTML for a missing script or image.
      if (event.request.mode === 'navigate') {
        const shell = await cache.match(new URL('index.html', self.registration.scope));
        if (shell) return shell;
      }
      throw error;
    }
  })());
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
