// Cache only the public application shell, never account data or API responses.
const CACHE = "ikigai-v149-photo-and-login-retry";
const SHELL = ["./", "index.html", "main-supabase.js", "app-badge.js", "email-login.js", "login-mfa.js", "app.js", "supabase-config.js",
  "manifest.webmanifest", "update-manager.js", "pull-refresh.js", "maintenance.js", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const PUBLIC_FILES = new Set([...SHELL, 'images/premium-entry-artwork.jpg', 'images/shin-session-artwork.jpg', 'images/journal-purchase-artwork.jpg', 'update-manager.js', 'pull-refresh.js', 'direct-messages.js',
  'growth-views.js', 'one-on-one.js', 'talk-message-layout.js', 'talk-notes.js', 'member-actions.js', 'maintenance.js', 'talk-layout.js', 'groups.js', 'message-reactions.js', 'growth-photos.js', 'admin-notices.js', 'security-settings.js', 'announcements.js', 'inquiry.js', 'push-notifications.js',
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

// Count unconfirmed device notifications, persist across service-worker restarts.
let badgeDatabase=null,badgeQueue=Promise.resolve();
const badgeUid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function badgeDb(){
 if(!badgeDatabase)badgeDatabase=new Promise((resolve,reject)=>{
  const open=indexedDB.open('ikigai-device-badge-v1',1);
  open.onupgradeneeded=()=>open.result.createObjectStore('badge');
  open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
 }).catch(error=>{badgeDatabase=null;throw error});
 return badgeDatabase;
}
function badgeChange(change){
 const work=badgeQueue.then(async()=>{
  const db=await badgeDb();
  const state=await new Promise((resolve,reject)=>{
   const tx=db.transaction('badge','readwrite'),store=tx.objectStore('badge'),read=store.get('state');let next;
   read.onsuccess=()=>{
    const saved=read.result;
    const state=saved&&Array.isArray(saved.items)&&Array.isArray(saved.seen)?saved:{account:null,bound:false,items:[],seen:[],overflow:0};
    next=change(state);store.put(next,'state');
   };
   tx.oncomplete=()=>resolve(next);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
  const count=Math.min(9999,state.items.length);
  try{
   if(count&&typeof navigator.setAppBadge==='function')await navigator.setAppBadge(count);
   else if(typeof navigator.clearAppBadge==='function')await navigator.clearAppBadge();
  }catch{}
 });
 badgeQueue=work.catch(()=>{});return badgeQueue;
}
function badgeReceive(payload){
 return badgeChange(state=>{
  const account=payload.data?.account,key=payload.tag;
  if(!badgeUid(account)||!payload.data?.kind||typeof key!=='string'||!key||key.length>250||(state.bound&&state.account!==account))return state;
  state.account=account;state.bound=true;
  if(state.seen.includes(key)||state.items.some(item=>item.key===key))return state;
  const data=payload.data||{},at=Date.parse(data.eventAt),item={key,kind:data.kind,at:Number.isFinite(at)?at:Date.now()};
  for(const field of ['threadId','groupId','postKey','announcementId'])if(typeof data[field]==='string')item[field]=data[field];
  const markers=['all','kind:'+item.kind];for(const field of ['threadId','groupId','postKey','announcementId'])if(item[field])markers.push(field+':'+item[field]);if(item.kind==='talk'&&!item.threadId&&!item.groupId)markers.push('publicTalk');
  if(!markers.some(marker=>(state.readAt?.[marker]||0)>=item.at))state.items.push(item);
  state.seen.push(key);
  state.seen=state.seen.slice(-4096);return state;
 });
}
function badgeRead(account,scope,before=Date.now()){
 return badgeChange(state=>{
  if(state.account!==account)return state;
  const cutoff=Number.isFinite(before)?Math.min(before,Date.now()):Date.now();
  const matches=item=>scope.all===true||(['key','threadId','groupId','postKey','announcementId'].some(key=>typeof scope[key]==='string'&&scope[key]===item[key]))||(scope.publicTalk===true&&item.kind==='talk'&&!item.threadId&&!item.groupId)||(Array.isArray(scope.kinds)&&scope.kinds.includes(item.kind));
  state.items=state.items.filter(item=>item.at>cutoff||!matches(item));
  const markers=[];if(scope.all===true)markers.push('all');if(scope.publicTalk===true)markers.push('publicTalk');for(const field of ['threadId','groupId','postKey','announcementId'])if(typeof scope[field]==='string')markers.push(field+':'+scope[field]);if(Array.isArray(scope.kinds))for(const kind of scope.kinds)markers.push('kind:'+kind);
  state.readAt=state.readAt||{};for(const marker of markers)state.readAt[marker]=Math.max(state.readAt[marker]||0,cutoff);state.readAt=Object.fromEntries(Object.entries(state.readAt).sort((a,b)=>b[1]-a[1]).slice(0,256));return state;
 });
}
self.addEventListener('message',event=>{
 const message=event.data;
 if(!['ikigai-badge-account','ikigai-badge-read'].includes(message?.type))return;
 try{if(new URL(event.source.url).origin!==new URL(self.registration.scope).origin)return}catch{return}
 if(message.type==='ikigai-badge-account'){
  if(message.account!==null&&!badgeUid(message.account))return;
  event.waitUntil(badgeChange(state=>state.account===message.account?{...state,bound:true}:{account:message.account,bound:true,items:[],seen:[],overflow:0}));
 }else if(badgeUid(message.account)&&message.scope&&typeof message.scope==='object')event.waitUntil(badgeRead(message.account,message.scope,message.before));
});

self.addEventListener("push", event => {
  let payload={};try{payload=event.data?.json()||{}}catch{}
  const title=typeof payload.title==='string'?payload.title.slice(0,80):'IKIGAI';
  const body=typeof payload.body==='string'?payload.body.slice(0,160):'新しいお知らせがあります。';
  const data={};if(['member','log','talk','like','comment','reaction','announcement','morning'].includes(payload.data?.kind))data.kind=payload.data.kind;if(typeof payload.data?.postKey==='string'&&payload.data.postKey.length<151)data.postKey=payload.data.postKey;if(typeof payload.data?.threadId==='string'&&payload.data.threadId.length===73)data.threadId=payload.data.threadId;
  if(typeof payload.data?.groupId==='string'&&/^[0-9a-f-]{36}$/i.test(payload.data.groupId))data.groupId=payload.data.groupId;if(typeof payload.data?.announcementId==='string'&&/^[0-9a-f-]{36}$/i.test(payload.data.announcementId))data.announcementId=payload.data.announcementId;
  if(payload.data?.publicTalk===true)data.publicTalk=true;
  event.waitUntil(Promise.allSettled([
    badgeReceive({...payload,data:{...data,account:payload.data?.account,eventAt:payload.data?.eventAt}}),
    self.registration.showNotification(title,{body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:typeof payload.tag==='string'?payload.tag.slice(0,200):undefined,data}),
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{for(const client of clients)client.postMessage({type:'ikigai-notification-received',...data})})
  ]));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();const data=event.notification.data||{};
  event.waitUntil((async()=>{await badgeChange(state=>{state.items=state.items.filter(item=>item.key!==event.notification.tag);return state});const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of windows){if(new URL(client.url).origin===self.location.origin){await client.focus();client.postMessage({type:'ikigai-open-notification',...data});return}}const url=new URL('./',self.registration.scope);if(data.postKey)url.searchParams.set('openPost',data.postKey);if(data.threadId)url.searchParams.set('openDm',data.threadId);if(data.groupId)url.searchParams.set('openGroup',data.groupId);if(data.kind)url.searchParams.set('openKind',data.kind);if(data.announcementId)url.searchParams.set('openAnnouncement',data.announcementId);await self.clients.openWindow(url.href)})());
});
