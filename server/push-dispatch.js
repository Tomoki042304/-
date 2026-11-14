import {database} from './private-documents.js';
import {deliverPreparedPush} from './web-push.js';
export function notificationPayload(job){
 const context=job.context||{};
 const messages={member:'新しいメンバーが参加しました。',log:'新しい成長ログが投稿されました。',talk:context.threadId?'個別メッセージが届きました。':context.groupId?'参加中のグループに新しいメッセージがあります。':'全体トークに新しいメッセージがあります。',like:'あなたの成長ログに応援が届きました。',comment:'あなたの成長ログにコメントが届きました。',reaction:'あなたのトークにリアクションが届きました。',announcement:'運営から新しいお知らせがあります。',morning:'朝活の開始30分前です。アプリから参加情報をご確認ください。'};
 if(!messages[job.kind])throw Error('UNKNOWN_NOTIFICATION');
 const data={kind:job.kind};for(const key of ['postKey','threadId','groupId','announcementId'])if(typeof context[key]==='string')data[key]=context[key];
 if(context.publicTalk)data.publicTalk=true;
 return {title:job.kind==='morning'?'IKIGAI 朝活リマインド':'IKIGAI',body:messages[job.kind],tag:job.key,data,urgency:'high',...(job.kind==='morning'?{ttl:Math.max(0,Math.min(1800,Math.floor((Date.parse(context.startsAt)-Date.now())/1000)))}:{})};
}
export function createPushDispatcher({rpc,deliver=deliverPreparedPush,continueFetch=fetch}={}){return async(context)=>{
 const {request,env}=context;
 const reply=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 const url=new URL(request.url),token=request.headers.get('X-IKIGAI-Scheduler');
 if(request.method!=='POST'||url.origin!=='https://ikigai-shidoroku.pages.dev'||!/^\w{64}$/.test(token||''))return reply(403,{ok:false});
 const call=rpc||((name,body={})=>database(null,'rpc/'+name,{method:'POST',body,serviceKey:env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY}));
 if(typeof env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY!=='string')return reply(503,{ok:false});
 try{
  if(await call('ikigai_push_auth_v2',{p_token:token})!==true)return reply(403,{ok:false});
  const jobs=await call('ikigai_push_claim_v2');if(!Array.isArray(jobs))throw Error();
  let sent=0,retry=0;
  // Keep subrequests bounded. A lease prevents overlapping cron calls from duplicating a batch.
  await Promise.all(jobs.map(async job=>{
   let ok=false,receipts=[],expired=[];
   try{
    if(await call('ikigai_push_check_v2',{p_key:job.key,p_lease:job.lease})!==true)ok=true;
    else{const result=await deliver(env,job,notificationPayload(job));receipts=result?.receipts||[];expired=result?.expired||[];ok=result?.failed===0;if(ok)sent++}
   }catch{}
   if(!ok)retry++;
   await call('ikigai_push_finish_v2',{p_key:job.key,p_lease:job.lease,p_ok:ok,p_receipts:receipts,p_expired:expired});
  }));
  // One request used to process only ten recipients until the next minute.
  // Continue in a fresh Worker request to retain the bounded subrequest budget.
  // SQL leases + receipts still own deduplication; never resend failed leases here.
  const hop=Number(request.headers.get('X-IKIGAI-Push-Hop')||0);
  if(jobs.length===10&&Number.isInteger(hop)&&hop>=0&&hop<6&&typeof context.waitUntil==='function'){
   context.waitUntil(Promise.allSettled([0,1].map(async()=>{const response=await continueFetch(url.href,{method:'POST',headers:{'Content-Type':'application/json','X-IKIGAI-Scheduler':token,'X-IKIGAI-Push-Hop':String(hop+1)},body:'{}',redirect:'manual',signal:AbortSignal.timeout(15000)});await response.arrayBuffer()})));
  }
  return reply(200,{ok:true,processed:jobs.length,sent,retry});
 }catch{return reply(503,{ok:false})}
}}
