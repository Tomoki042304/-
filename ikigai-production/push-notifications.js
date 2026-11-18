const WAIT_MESSAGE='通知の準備に時間がかかっています。通信状態を確認して、もう一度お試しください。';
const pendingSubscriptions=new WeakMap();
function waitFor(operation,message=WAIT_MESSAGE,ms=12000){
 let timer;return Promise.race([Promise.resolve(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms)})]).finally(()=>clearTimeout(timer));
}
function checkedRequest(request,payload){return waitFor(Promise.resolve().then(()=>request(payload)));}
function subscribe(registration,key){
 let pending=pendingSubscriptions.get(registration);
 if(!pending){
  pending=registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(key.publicKey)});
  pendingSubscriptions.set(registration,pending);
  const clear=()=>{if(pendingSubscriptions.get(registration)===pending)pendingSubscriptions.delete(registration)};
  pending.then(clear,clear);
 }
 return waitFor(pending,'端末の通知登録に時間がかかっています。もう一度お試しください。',20000);
}
const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const supported=()=>typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
export async function disableDevicePush(request){
  if(!supported())return;const registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager.getSubscription();if(!sub)return;
  const localDisabled=await sub.unsubscribe().catch(()=>false);let serverDisabled=false;try{await request({action:'unsubscribe',endpoint:sub.endpoint});serverDisabled=true}catch{}if(!localDisabled&&!serverDisabled)throw Error('通知を停止できませんでした。端末の設定から通知を停止してください。');
}
export function mountPushNotifications({request,allowed}){
  const $=s=>document.querySelector(s);let busy=false;
  function unsupported(){const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);if(ios&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)return 'iPhone・iPadではSafariからホーム画面に追加し、そのアプリで通知を有効にしてください。';if(!supported())return 'この端末・ブラウザはプッシュ通知に対応していません。';return ''}
  async function refresh(){const hint=unsupported();$('#pushEnable').disabled=!!hint||!allowed();$('#pushDisable').disabled=true;if(hint){$('#pushStatus').textContent=hint;return}if(!allowed()){$('#pushStatus').textContent='承認後にプッシュ通知を利用できます。';return}try{const registration=await navigator.serviceWorker.getRegistration(),sub=await registration?.pushManager.getSubscription();const data=sub?await request({action:'status',endpoint:sub.endpoint}):{enabled:false};$('#pushStatus').textContent=data.enabled?'この端末へのプッシュ通知は有効です。':'通知を許可すると、新メンバー・成長ログ・トーク・自分への反応・運営のお知らせを携帯に届けます。プレミアム会員には朝活リマインドも届きます。';$('#pushDisable').disabled=!data.enabled;}catch{$('#pushStatus').textContent='通知の状態を確認できませんでした。'}}
  $('#pushEnable').onclick=async()=>{
    if(busy||!allowed())return;const hint=unsupported();if(hint){$('#pushStatus').textContent=hint;return}busy=true;$('#pushEnable').disabled=true;
    try{await enableDevicePush(request,message=>{$('#pushStatus').textContent=message});$('#pushStatus').textContent='この端末へのプッシュ通知を有効にしました。';$('#pushDisable').disabled=false;}
    catch(e){$('#pushStatus').textContent=e.message||'通知を有効にできませんでした。もう一度お試しください。';}
    finally{busy=false;$('#pushEnable').disabled=!allowed()||!!unsupported();}
  };
  $('#pushDisable').onclick=async()=>{if(busy)return;busy=true;$('#pushDisable').disabled=true;try{await disableDevicePush(request);$('#pushStatus').textContent='この端末へのプッシュ通知を停止しました。'}catch{$('#pushStatus').textContent='通知を停止できませんでした。'}finally{busy=false}};
  return {refresh};
}
// Call directly from a user tap; browsers control the permission prompt.
export function deviceNotificationPermissionGranted(){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
 return supported()&&(!ios||navigator.standalone===true||matchMedia('(display-mode: standalone)').matches)&&Notification.permission==='granted';
}
export async function enableDevicePush(request,onProgress=()=>{},options={}){
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
 if(ios&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)throw Error('Safariの共有メニューでホーム画面に追加し、IKIGAIのアイコンから開いて通知を許可してください。');
 if(!supported())throw Error('この端末・ブラウザは通知に対応していません。対応する端末からご利用ください。');
 if(Notification.permission==='denied')throw Error('通知が拒否されています。端末の設定でIKIGAIの通知を許可してから、もう一度お試しください。');
 onProgress('端末の通知確認画面で「許可」を選んでください。');
 // Keep the permission request in the original tap, before asynchronous preparation.
 if(options.askPermission===false&&Notification.permission!=='granted')throw Error('通知は許可されていません。');
 const permission=Notification.permission==='granted'?'granted':await waitFor(Notification.requestPermission(),'通知の確認が完了していません。端末の確認画面を閉じて、もう一度お試しください。',60000);
 if(permission!=='granted')throw Error('通知は許可されていません。あとから端末の設定で変更できます。');
 onProgress('通知を準備しています…');
 const registration=await waitFor(navigator.serviceWorker.ready,'通知機能の起動に時間がかかっています。アプリを開き直して、もう一度お試しください。');
 let subscription=await waitFor(registration.pushManager.getSubscription());
 if(subscription){const state=await checkedRequest(request,{action:'status',endpoint:subscription.endpoint});if(state.enabled)return {enabled:true};await waitFor(subscription.unsubscribe());}
 const key=await checkedRequest(request,{action:'key'});onProgress('この端末に通知を登録しています…');subscription=await subscribe(registration,key);
 try{await checkedRequest(request,{action:'subscribe',keyId:key.keyId,subscription:subscription.toJSON()});}
 catch(error){await waitFor(subscription.unsubscribe()).catch(()=>false);throw error;}
 return {enabled:true};
}

// Read-only delivery check. Admission uses the browser permission, not network readiness.
export async function devicePushEnabled(request){
 if(!supported()||Notification.permission!=='granted')return false;
 const registration=await waitFor(navigator.serviceWorker.getRegistration());
 const subscription=await waitFor(registration?.pushManager.getSubscription());
 if(!subscription)return false;
 const state=await checkedRequest(request,{action:'status',endpoint:subscription.endpoint});
 return state?.enabled===true;
}
