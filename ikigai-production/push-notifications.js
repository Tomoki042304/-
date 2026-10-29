const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const supported=()=>typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
export async function disableDevicePush(request){
  if(!supported())return;const registration=await navigator.serviceWorker.getRegistration();const sub=await registration?.pushManager.getSubscription();if(!sub)return;
  const localDisabled=await sub.unsubscribe().catch(()=>false);let serverDisabled=false;try{await request({action:'unsubscribe',endpoint:sub.endpoint});serverDisabled=true}catch{}if(!localDisabled&&!serverDisabled)throw Error('通知を停止できませんでした。端末の設定から通知を停止してください。');
}
export function mountPushNotifications({request,allowed}){
  const $=s=>document.querySelector(s);let busy=false;
  function unsupported(){const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);if(ios&&!navigator.standalone&&!matchMedia('(display-mode: standalone)').matches)return 'iPhone・iPadではSafariからホーム画面に追加し、そのアプリで通知を有効にしてください。';if(!supported())return 'この端末・ブラウザはプッシュ通知に対応していません。';return ''}
  async function refresh(){const hint=unsupported();$('#pushEnable').disabled=!!hint||!allowed();$('#pushDisable').disabled=true;if(hint){$('#pushStatus').textContent=hint;return}if(!allowed()){$('#pushStatus').textContent='承認後にプッシュ通知を利用できます。';return}try{const registration=await navigator.serviceWorker.getRegistration(),sub=await registration?.pushManager.getSubscription();const data=sub?await request({action:'status',endpoint:sub.endpoint}):{enabled:false};$('#pushStatus').textContent=data.enabled?'この端末へのプッシュ通知は有効です。':'通知を許可すると、いいね・コメント・個別トークをスマホにお知らせします。';$('#pushDisable').disabled=!data.enabled;}catch{$('#pushStatus').textContent='通知の状態を確認できませんでした。'}}
  $('#pushEnable').onclick=async()=>{
    if(busy||!allowed()||unsupported())return;busy=true;$('#pushEnable').disabled=true;
    try{
      // Ask permission directly from the user's tap (required by iOS).
      const permission=await Notification.requestPermission();if(permission!=='granted'){$('#pushStatus').textContent='通知は許可されていません。端末の設定から通知を許可してください。';return}
      const registration=await navigator.serviceWorker.ready;let subscription=await registration.pushManager.getSubscription();
      if(subscription){const status=await request({action:'status',endpoint:subscription.endpoint});if(status.enabled){$('#pushStatus').textContent='この端末へのプッシュ通知は有効です。';$('#pushDisable').disabled=false;return}await subscription.unsubscribe();subscription=null}
      const key=await request({action:'key'});subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(key.publicKey)});
      try{await request({action:'subscribe',keyId:key.keyId,subscription:subscription.toJSON()})}catch(error){await subscription.unsubscribe().catch(()=>false);throw error}
      $('#pushStatus').textContent='この端末へのプッシュ通知を有効にしました。';$('#pushDisable').disabled=false;
    }catch(e){$('#pushStatus').textContent=e.message||'通知を有効にできませんでした。'}finally{busy=false;$('#pushEnable').disabled=false}
  };
  $('#pushDisable').onclick=async()=>{if(busy)return;busy=true;$('#pushDisable').disabled=true;try{await disableDevicePush(request);$('#pushStatus').textContent='この端末へのプッシュ通知を停止しました。'}catch{$('#pushStatus').textContent='通知を停止できませんでした。'}finally{busy=false}};
  return {refresh};
}
