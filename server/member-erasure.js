import {database,ROOT} from './private-documents.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET='ikigai-growth-photos';
export function scrubErased(value,uid){
 if(typeof value==='string')return value.includes(uid)?undefined:value;
 if(Array.isArray(value))return value.map(item=>scrubErased(item,uid)).filter(item=>item!==undefined);
 if(value&&typeof value==='object'){
  if(Object.entries(value).some(([key,item])=>['uid','senderUid','ownerUid','hostUid','memberUid','authorUid','user_id','by','key','postKey','threadId','id'].includes(key)&&typeof item==='string'&&item.includes(uid)))return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!key.includes(uid)).map(([key,item])=>[key,scrubErased(item,uid)]).filter(([,item])=>item!==undefined));
 }
 return value;
}
export function erasureKey(key,uid,meta){
 if(key.includes(uid))return true;
 if(key.startsWith('group:')&&(meta.groups||[]).some(id=>key.includes(id)))return true;
 if((meta.reactions||[]).some(prefix=>key.startsWith(prefix)))return true;
 return (meta.messages||[]).some(m=>key==='group:message:v1:'+m.groupId+':'+m.id||key==='group:unsent:v1:'+m.groupId+':'+m.id||key.startsWith('group:reaction:v1:'+m.groupId+':'+m.id+':')||key.startsWith('group:timeline:v1:'+m.groupId+':')&&key.endsWith(':'+m.id));
}
const parse=text=>{try{return JSON.parse(text)}catch{return undefined}};
function legacyChange(key,text,job){
 if(erasureKey(key,job.target,job.meta))return {remove:true};
 if(!text.includes(job.target))return null;
 const value=parse(text);if(key.startsWith('group:deleted:v1:')&&value?.by===job.target){const {by,...kept}=value;return {value:JSON.stringify(kept)}}
 const cleaned=scrubErased(value,job.target);return cleaned===undefined?{remove:true}:{value:JSON.stringify(cleaned)};
}
function safeJob(job){return {id:job.id,target:job.target,phase:job.phase,createdAt:job.created_at,...(job.verify_after?{retryAfterMs:Math.max(0,Date.parse(job.verify_after)-Date.now())}:{})}}
export function createErasureService(env,actor,{rpc,remote}={}){
 if(env.RUNTIME_TRANSFER_LOCK==='locked'||env.PII_MIGRATION_MODE==='locked')throw Error('ERASURE_MIGRATION_ACTIVE');
 const key=env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY;
 if(env.RUNTIME_STORAGE!=='supabase'||typeof key!=='string'||!key.startsWith('eyJ'))throw Error('ERASURE_SETUP_REQUIRED');
 const db=rpc||((action,extra={})=>database(null,'rpc/ikigai_member_erasure_v1',{method:'POST',serviceKey:key,body:{p_actor:actor,p_action:action,...extra}}));
 const call=remote|| (async(path,{method='GET',body}={})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{return await fetch(ROOT+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:controller.signal})}finally{clearTimeout(timer)}
 });
 async function photos(uid){
  const listed=await call('/storage/v1/object/list/'+BUCKET,{method:'POST',body:{prefix:uid,limit:100,offset:0,sortBy:{column:'name',order:'asc'}}});
  if(listed.status===404)return true;
  const files=await listed.json().catch(()=>null);
  if(listed.status===400&&/bucket.*not found/i.test(String(files?.message||files?.error||'')))return true;
  if(!listed.ok||!Array.isArray(files))throw Error('ERASURE_PHOTO_UNAVAILABLE');
  if(!files.length)return true;
  if(files.some(file=>typeof file.name!=='string'||!file.name||file.name.includes('/')||file.name==='.'||file.name==='..'||!file.id))throw Error('ERASURE_PHOTO_REVIEW');
  const removed=await call('/storage/v1/object/'+BUCKET,{method:'DELETE',body:{prefixes:files.map(file=>uid+'/'+file.name)}});
  if(!removed.ok&&removed.status!==404)throw Error('ERASURE_PHOTO_UNAVAILABLE');return false;
 }
 async function legacyPage(job,mode){
  const store=env.YT_CACHE;if(!store?.list||!store?.get||!store?.delete||!store?.put)throw Error('ERASURE_LEGACY_UNAVAILABLE');
  const page=await store.list({prefix:'',limit:20,...(job.cursor?{cursor:job.cursor}:{})});
  if(!page||!Array.isArray(page.keys)||typeof page.list_complete!=='boolean'||!page.list_complete&&!page.cursor)throw Error('ERASURE_LEGACY_UNAVAILABLE');
  const meta={groups:[...(job.meta.groups||[])],messages:[...(job.meta.messages||[])],reactions:[...(job.meta.reactions||[])]};
  let found=false;
  for(const entry of page.keys){
   if(!/^(group|dm|inquiry|inquiry-history|push|reaction|announcement):/.test(entry.name))continue;
   const text=await store.get(entry.name);if(text===null)continue;if(typeof text!=='string')throw Error('ERASURE_LEGACY_UNAVAILABLE');
   if(mode==='inventory'){
    const value=parse(text);
    if(entry.name.startsWith('group:room:v1:')&&value?.ownerUid===job.target&&UUID.test(value.id))meta.groups.push(value.id);
    if(entry.name.startsWith('group:message:v1:')&&value?.senderUid===job.target&&UUID.test(value.groupId)&&UUID.test(value.id))meta.messages.push({groupId:value.groupId,id:value.id});
    if(/^dm:messages?:v1:/.test(entry.name)&&entry.name.includes(job.target)&&value?.senderUid&&value?.threadId&&value?.id){
     const encoded=new TextEncoder().encode(JSON.stringify(['direct',value.threadId,value.senderUid,value.id]));const hash=await crypto.subtle.digest('SHA-256',encoded);
     meta.reactions.push('reaction:v1:'+Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')+':');
    }
   }else{
    const change=legacyChange(entry.name,text,job);if(!change)continue;found=true;
    if(mode==='legacy'){if(change.remove)await store.delete(entry.name);else await store.put(entry.name,change.value,entry.expiration?{expiration:entry.expiration}:undefined)}
   }
  }
  meta.groups=[...new Set(meta.groups)];meta.reactions=[...new Set(meta.reactions)];meta.messages=[...new Map(meta.messages.map(item=>[item.groupId+':'+item.id,item])).values()];
  return {cursor:page.list_complete?null:page.cursor,meta,found};
 }
 return {
  async list(){const result=await db('list');return {jobs:(result.jobs||[]).map(safeJob)}},
  async start(target,id){if(!env.YT_CACHE?.list||!env.YT_CACHE?.get||!env.YT_CACHE?.delete||!env.YT_CACHE?.put)throw Error('ERASURE_LEGACY_UNAVAILABLE');const job=await db('start',{p_target:target,p_job:id});return job.done?{done:true}:{done:false,job:safeJob(job)}},
  async step(id){
   let job=await db('get',{p_job:id});if(job.missing)return {missing:true,done:false};
   const advance=extra=>db('advance',{p_job:id,...extra,p_meta:{...(extra.p_meta||{}),__expectedPhase:job.phase,__expectedCursor:job.cursor??null}});
   if(job.phase==='photos'){if(await photos(job.target))job=await advance({})}
   else if(['inventory','legacy','legacy-verify'].includes(job.phase)){
    const page=await legacyPage(job,job.phase);
    if(job.phase==='legacy-verify'&&page.found)job=await db('legacy-retry',{p_job:id});
    else job=await advance({p_cursor:page.cursor,...(job.phase==='inventory'?{p_meta:page.meta}:{})});
   }else if(job.phase==='legacy-wait'){
    if(Date.parse(job.verify_after)<=Date.now())job=await db('verify-legacy',{p_job:id});
   }else if(job.phase==='auth'){
    const removed=await call('/auth/v1/admin/users/'+job.target,{method:'DELETE',body:{should_soft_delete:false}});
    if(!removed.ok&&removed.status!==404)throw Error('ERASURE_AUTH_UNAVAILABLE');job=await advance({});
   }else if(['documents','runtime'].includes(job.phase))job=await db('purge',{p_job:id});
   else if(job.phase==='finish'){const result=await db('finish',{p_job:id});if(result.done!==true)throw Error('ERASURE_VERIFY_FAILED');return {done:true}}
   else throw Error('ERASURE_PHASE_INVALID');
   return {done:false,job:safeJob(job)};
  }
 };
}
