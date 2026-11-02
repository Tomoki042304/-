import {maintenanceState,maintenanceResponse} from '../../server/maintenance.js';
import {verifyNightlyIdentity} from '../../server/github-audit-auth.js';
import {runNightlyAudit,LATEST} from '../../server/nightly-audit.js';
import {runtimeStore} from '../../server/supabase-runtime.js';
import {requireYoutubeHost} from '../../server/youtube-member.js';
const HOST='https://ikigai-shidoroku.pages.dev';
const reply=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization, Origin'}});
export async function onRequest({request,env}){
 const url=new URL(request.url);
 if(url.origin!==HOST)return reply(403,{message:'本番サイトから利用してください。'});
 try{
  if(request.method==='GET'){
   const state=await maintenanceState(env);
   // Public status contains neither reports, configuration nor member data.
   const publicState={serverNow:state.serverNow,active:state.active,enabled:state.enabled,criticalHold:state.criticalHold,start:state.start,end:state.end,nextStart:state.nextStart,timezone:state.timezone};
   return state.active?maintenanceResponse(publicState):reply(200,publicState);
  }
  if(request.method!=='POST')return reply(405,{message:'操作を確認してください。'});
  if(Number(request.headers.get('Content-Length')||0)>2048)return reply(413,{});
  const reader=request.body?.getReader();if(!reader)return reply(400,{});
  let raw='',bytes=0;const decoder=new TextDecoder();
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();return reply(413,{})}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
  let body;try{body=JSON.parse(raw)}catch{return reply(400,{message:'操作を確認してください。'})}
  if(body?.action==='audit'){
   const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
   if(!await verifyNightlyIdentity(token))return reply(403,{message:'点検実行の権限がありません。'});
   const state=await maintenanceState(env);if(!state.configured)return reply(503,{message:'先に点検用SQLの設定が必要です。'});
   // Result supplied by the authorized workflow is allowlisted inside the audit.
   const report=await runNightlyAudit(env,body.checks||{});
   return reply(report.busy?409:200,{busy:report.busy===true,id:report.id,status:report.status});
  }
  if(body?.action!=='report'||request.headers.get('Origin')!==HOST)return reply(403,{message:'操作を確認してください。'});
  const state=await maintenanceState(env);if(state.active)return maintenanceResponse(state);
  const host=await requireYoutubeHost(request);if(!host.ok)return reply(host.status,{message:host.message});
  const report=await runtimeStore(env).get(LATEST,'json');
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  const reportDay=report?.startedAt?new Date(Date.parse(report.startedAt)+9*3600000).toISOString().slice(0,10):null;
  const completion=Date.parse(state.lastCheckedAt||'');
  return reply(200,{state,report,scheduledCheckMissing:!report||!Number.isFinite(completion)||completion<Date.parse(report.finishedAt)-1000||Date.now()>Date.parse(state.end)&&reportDay!==today});
 }catch{return reply(503,{message:'点検状態を取得できませんでした。点検が成功したとは判定していません。'})}
}
