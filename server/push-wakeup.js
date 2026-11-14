import {database} from './private-documents.js';
// Only a successful authenticated mutation may call this helper. The scheduler
// secret stays on the server; clients can neither read it nor choose recipients.
let pending=null,again=false;
export function schedulePushDelivery(context){
 if(typeof context.waitUntil!=='function'||typeof context.env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY!=='string')return;
 if(pending){again=true;context.waitUntil(pending);return}
 const env=context.env;
 pending=(async()=>{
  try{
   const rows=await database(null,'ikigai_runtime_values_v1?'+new URLSearchParams({select:'value',key:'eq.system:push-dispatch-token:v2',limit:'1'}),{serviceKey:env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY});
   const token=rows?.[0]?.value;if(typeof token!=='string'||!/^\w{64}$/.test(token))return;
   // One coalesced follow-up covers a write committed while the first batch was claimed.
   for(let i=0;i<2;i++){
    again=false;
    const response=await fetch('https://ikigai-shidoroku.pages.dev/api/push-dispatch',{method:'POST',headers:{'Content-Type':'application/json','X-IKIGAI-Scheduler':token},body:'{}',redirect:'manual',signal:AbortSignal.timeout(15000)});
    await response.arrayBuffer();if(!response.ok||!again)break;
   }
  }catch{ /* Durable outbox + cron remain the recovery path. Never fail a saved message. */ }
 })().finally(()=>{pending=null;again=false});
 context.waitUntil(pending);
}
