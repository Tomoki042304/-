// Native installed-app badges. Unsupported browsers continue without a custom overlay.
let owner=null,reconciled='',reconciliation=null;
function post(message){
 if(!('serviceWorker' in navigator))return;
 void navigator.serviceWorker.ready.then(registration=>registration.active?.postMessage(message)).catch(()=>{});
}
export function setBadgeAccount(uid){
 if(owner!==uid){reconciled='';reconciliation=null;}
 owner=typeof uid==='string'?uid:null;
 post({type:'ikigai-badge-account',account:owner});
 if(!owner&&typeof navigator.clearAppBadge==='function')void navigator.clearAppBadge().catch(()=>{});
}
export function readBadge(scope={}){
 if(!owner||document.visibilityState!=='visible')return;
 const {before,...target}=scope;
 post({type:'ikigai-badge-read',account:owner,scope:target,before:Number.isFinite(before)?before:Date.now()});
}
window.addEventListener('ikigai-notification-read',event=>readBadge(event.detail||{}));
window.addEventListener('ikigai-notification-ui-read',event=>readBadge(event.detail||{}));
window.addEventListener('ikigai-notification-reconcile',event=>{
 const {account,ready,unread,before}=event.detail||{};
 if(!owner||account!==owner||ready!==true||unread!==0||!Number.isFinite(before)||before>Date.now()||document.visibilityState!=='visible')return;
 const key=owner+':'+before;if(reconciled===key)return;reconciled=key;
 // The cutoff predates loading the app. Pushes received during loading remain unread.
 reconciliation={type:'ikigai-badge-reconcile',account:owner,before};post(reconciliation);
});
function replayReconciliation(){if(owner&&reconciliation?.account===owner&&document.visibilityState==='visible')post(reconciliation)}
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>{
 // A newly activated worker may replace the one that first received this message.
 if(owner)post({type:'ikigai-badge-account',account:owner});replayReconciliation();
});
document.addEventListener('visibilitychange',replayReconciliation);

