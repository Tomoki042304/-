import {requireYoutubeHost} from '../../server/youtube-member.js';
import {encryptPii,decryptPii} from '../../server/pii-crypto.js';
import {privateFields,sealDocument,openDocument,KV_PRIVATE_PREFIXES} from '../../server/pii-storage.js';
import {database} from '../../server/private-documents.js';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
const LOCK='pii:migration:lock:v1';
export async function onRequest({request,env}){
 if(request.method!=='POST'||request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{message:'アプリから利用してください。'});
 const host=await requireYoutubeHost(request);if(!host.ok)return reply(host.status,{message:host.message});
 let body;try{const raw=await request.text();if(raw.length>5000)throw Error();body=JSON.parse(raw)}catch{return reply(400,{message:'操作を確認してください。'})}
 const kv=env.YT_CACHE;
 try{
  let keyReady=false;try{const envelope=await encryptPii(env,'security:self-test',{test:true});keyReady=(await decryptPii(env,'security:self-test',envelope)).test===true}catch{}
  if(body?.action==='status'){
   if(env.PII_MIGRATION_MODE!=='locked'&&kv?.delete)await kv.delete(LOCK);
   let db=null;try{db=await database(request,'rpc/ikigai_pii_status_v1',{method:'POST',body:{p_enforce:false}})}catch{}
   return reply(200,{keyReady,database:db,migrationKeyReady:typeof env.SUPABASE_MIGRATION_SERVICE_ROLE_KEY==='string'&&env.SUPABASE_MIGRATION_SERVICE_ROLE_KEY.startsWith('eyJ'),maintenance:env.PII_MIGRATION_MODE==='locked'});
  }
  if(!keyReady)return reply(503,{message:'暗号鍵の設定を確認してください。鍵の内容をチャットに送らないでください。'});
  if(body.action==='documents'||body.action==='verify-documents'){
   const serviceKey=env.SUPABASE_MIGRATION_SERVICE_ROLE_KEY;
   if(typeof serviceKey!=='string'||!serviceKey.startsWith('eyJ'))return reply(503,{message:'一時的なデータ移行用のサーバー秘密鍵を設定してください。'});
   if(body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>200))return reply(400,{message:'移行位置を確認してください。'});
   const query=new URLSearchParams({select:'path,data',or:'(coll.eq.members,coll.eq.applications,path.like.data/users/*/profile)',order:'path',limit:'20',...(body.cursor?{path:'gt.'+body.cursor}:{})});
   const rows=await database(request,'documents?'+query,{serviceKey});if(!Array.isArray(rows))throw Error();let converted=0,conflicts=0,verified=0,remaining=0;
   for(const row of rows){
    if(!privateFields(row.path))continue;
    if(row.data?._piiVersion){await openDocument(env,row.path,row.data);verified++;continue}
    if(body.action==='verify-documents'){remaining++;continue}
    const data=await sealDocument(env,row.path,row.data);
    const opened=await openDocument(env,row.path,data);
    // Canonical JSON comparison is field-order independent.
    for(const [field,value] of Object.entries(row.data))if(JSON.stringify(opened[field])!==JSON.stringify(value))throw Error('verification');
    const replaced=await database(request,'rpc/ikigai_pii_replace_v1',{method:'POST',serviceKey,body:{p_path:row.path,p_expected:row.data,p_encrypted:data}});
    if(replaced===true)converted++;else if(replaced===false)conflicts++;else throw Error();
   }
   return reply(200,{converted,conflicts,verified,remaining,cursor:rows.length===20?rows.at(-1).path:null});
  }
  if(['kv','verify-kv','enforce'].includes(body.action)){
   if(env.PII_MIGRATION_MODE!=='locked')return reply(409,{message:'移行中の書き込み停止設定が必要です。'});
   if(!kv?.get||!kv?.put||!kv?.list)return reply(503,{message:'保管先を確認できませんでした。'});
   let lock=await kv.get(LOCK,'json');
   if(!lock||!Number.isFinite(lock.at)){lock={at:Date.now()};await kv.put(LOCK,JSON.stringify(lock));return reply(409,{message:'書き込み停止を確認中です。2分後に再試行してください。'})}
   if(Date.now()-lock.at<120000)return reply(409,{message:'書き込み停止を確認中です。2分後に再試行してください。'});
   if(body.action==='enforce'){
    const state=await database(request,'rpc/ikigai_pii_status_v1',{method:'POST',body:{p_enforce:true}});
    if(kv.delete)await kv.delete(LOCK);
    return reply(200,{database:state});
   }
   const index=body.prefixIndex??0;if(!Number.isInteger(index)||index<0||index>=KV_PRIVATE_PREFIXES.length)return reply(400,{message:'移行位置を確認してください。'});
   if(body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>2048))return reply(400,{message:'移行位置を確認してください。'});
   const page=await kv.list({prefix:KV_PRIVATE_PREFIXES[index],limit:20,...(body.cursor?{cursor:body.cursor}:{})});let converted=0,remaining=0,verified=0;
   for(const entry of page.keys){
    const value=await kv.get(entry.name,'json');if(value==null)continue;
    if(value.format==='ikigai-pii'){await decryptPii(env,entry.name,value);verified++;continue}
    if(body.action==='verify-kv'){remaining++;continue}
    const encrypted=await encryptPii(env,entry.name,value);
    if(JSON.stringify(await decryptPii(env,entry.name,encrypted))!==JSON.stringify(value))throw Error('verification');
    await kv.put(entry.name,JSON.stringify(encrypted));converted++;
   }
   const next=page.list_complete?index+1:index;
   return reply(200,{converted,remaining,verified,prefixIndex:next,cursor:page.list_complete?null:page.cursor,done:next>=KV_PRIVATE_PREFIXES.length});
  }
  return reply(400,{message:'操作を確認してください。'});
 }catch{return reply(503,{message:'保護設定を確認・変更できませんでした。移行は途中から再開できます。'})}
}
