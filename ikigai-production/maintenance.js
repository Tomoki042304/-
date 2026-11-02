// Public status only. Private reports require a separately authenticated admin request.
export async function mountMaintenance({fetchStatus=()=>fetch('/api/maintenance',{cache:'no-store',signal:AbortSignal.timeout(5000)}),clock=()=>Date.now()}={}){
 const style=document.createElement('style');style.textContent=`html[data-daily-maintenance] body{overflow:hidden!important}html[data-daily-maintenance] body>:not(#maintenanceGate){visibility:hidden!important;pointer-events:none!important}#maintenanceGate{position:fixed;inset:0;z-index:2147483647;background:#191919;color:#f7f7f7;display:grid;place-content:center;padding:28px;text-align:center;font-family:system-ui,sans-serif}#maintenanceGate[hidden]{display:none}#maintenanceGate p{max-width:34em;line-height:1.8;color:#ccc}#maintenanceGate button{justify-self:center;padding:12px 24px;border-radius:24px;border:1px solid #777;background:#fff;color:#171717;font-weight:700}`;
 document.head.append(style);
 const box=document.createElement('section');box.id='maintenanceGate';box.role='status';box.setAttribute('aria-live','polite');box.innerHTML='<h1>IKIGAI</h1><p></p><button type="button">状態を更新</button>';document.body.append(box);
 const message=box.querySelector('p');let state=null,offset=0,busy=false,readyResolve,readyDone=false,stopped=false;
 const ready=new Promise(resolve=>readyResolve=resolve);
 const display=text=>{const blocked=!!text;box.hidden=!blocked;document.documentElement.toggleAttribute('data-daily-maintenance',blocked);if(blocked)message.textContent=text;window.__ikigaiMaintenanceActive=blocked};
 function tick(){
  if(!state)return;
  const now=clock()+offset,parts=new Date(now+9*3600000),minutes=parts.getUTCHours()*60+parts.getUTCMinutes();
  const active=state.active||state.criticalHold||(state.enabled!==false&&minutes>=120&&minutes<150);
  if(active){display(state.criticalHold?'点検で重要な異常が確認されたため、管理者の確認を待っています。':'システム点検中です。毎日2:00〜2:30（日本時間）はご利用いただけません。終了後、自動で画面に戻ります。')}
  else{display('');if(!readyDone){readyDone=true;readyResolve()}}
 }
 async function refresh(){
  if(busy||stopped)return;busy=true;
  try{const response=await fetchStatus(),value=await response.json();if(![200,503].includes(response.status)||typeof value.active!=='boolean'||!Number.isFinite(Date.parse(value.serverNow)))throw Error();
   state=value;offset=Date.parse(value.serverNow)-clock();tick();
  }catch{
   // Keep the last confirmed schedule during transient failures. Initial unknown state stays locked.
   if(!state)display('利用状態を確認できません。通信を確認して「状態を更新」を押してください。');else tick();
  }finally{busy=false}
 }
 display('利用状態を確認しています…');box.querySelector('button').onclick=refresh;
 const visibility=()=>{if(document.visibilityState==='visible'){tick();refresh()}};document.addEventListener('visibilitychange',visibility);window.addEventListener('online',refresh);
 const tickTimer=setInterval(tick,1000),poll=setInterval(refresh,15000);await refresh();
 // Already-open tabs resume in place. No reload, sign-out, or draft clearing.
 return {ready,refresh,destroy(){stopped=true;clearInterval(tickTimer);clearInterval(poll);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('online',refresh);box.remove();style.remove();document.documentElement.removeAttribute('data-daily-maintenance')}};
}
