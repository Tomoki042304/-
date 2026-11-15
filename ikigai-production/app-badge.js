// Native installed-app badges. Unsupported browsers continue without a custom overlay.
let owner=null;
function post(message){
 if(!('serviceWorker' in navigator))return;
 void navigator.serviceWorker.ready.then(registration=>registration.active?.postMessage(message)).catch(()=>{});
}
export function setBadgeAccount(uid){
 owner=typeof uid==='string'?uid:null;
 post({type:'ikigai-badge-account',account:owner});
 if(!owner&&typeof navigator.clearAppBadge==='function')void navigator.clearAppBadge().catch(()=>{});
}
export function readBadge(scope={}){
 if(!owner)return;
 post({type:'ikigai-badge-read',account:owner,scope,before:Date.now()});
}
window.addEventListener('ikigai-notification-read',event=>readBadge(event.detail||{}));
