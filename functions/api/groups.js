import {database} from '../../server/private-documents.js';
import {operationalStore} from '../../server/supabase-runtime.js';
import {requireMemberRole,readChatAccessSince} from '../../server/youtube-member.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
const roomKey=id=>'group:room:v1:'+id,deletedKey=id=>'group:deleted:v1:'+id,memberKey=(id,uid)=>'group:member:v1:'+id+':'+uid,messageKey=(id,mid)=>'group:message:v1:'+id+':'+mid,cancelKey=(id,mid)=>'group:unsent:v1:'+id+':'+mid;
// Each participant and message has its own row: concurrent joins/sends never replace an array.
// Administrators are implicit participants in every group, including groups created before their appointment.
async function participantDirectory(env,ids){
 const serviceKey=env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY;if(typeof serviceKey!=='string'||!serviceKey.startsWith('eyJ'))throw Error('ROSTER_UNAVAILABLE');
 const admins=await database(null,'admins?select=user_id',{serviceKey}),approved=[];
 for(let i=0;i<ids.length;i+=80){const query=new URLSearchParams({select:'user_id,approved_at',user_id:'in.('+ids.slice(i,i+80).join(',')+')'});const rows=await database(null,'approved_members?'+query,{serviceKey});if(!Array.isArray(rows))throw Error('ROSTER_UNAVAILABLE');approved.push(...rows)}
 if(!Array.isArray(admins))throw Error('ROSTER_UNAVAILABLE');return {admins:admins.map(r=>r.user_id),approved};
}
async function participants(kv,room,env,directory){
 const candidates=new Map([[room.ownerUid,room.at]]);let cursor;
 do{const page=await kv.list({prefix:'group:member:v1:'+room.id+':',limit:200,...(cursor?{cursor}:{})});const rows=await Promise.all(page.keys.map(k=>kv.get(k.name,'json')));for(const row of rows)if(uuid(row?.uid)&&Number.isFinite(Date.parse(row.at)))candidates.set(row.uid,row.at);cursor=page.list_complete?null:page.cursor}while(cursor);
 const current=await directory(env,[...candidates.keys()]),ids=new Set(current.admins.filter(uuid)),approved=new Map(current.approved.map(r=>[r.user_id,Date.parse(r.approved_at)]));
 for(const [id,at] of candidates)if(approved.has(id)&&Date.parse(at)>=approved.get(id))ids.add(id);
 return [...ids];
}
export function createGroupHandler({authenticate=requireMemberRole,admission=readChatAccessSince,store=operationalStore,directory=participantDirectory}={}){
 return async function({request,env}){
  const url=new URL(request.url);
  if(request.method!=='POST'||url.protocol!=='https:'||url.hostname!=='ikigai-shidoroku.pages.dev'||request.headers.get('Origin')!==url.origin)return reply(403,{message:'アプリから利用してください。'});
  let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const raw=await request.text();if(raw.length>10000)throw Error();body=JSON.parse(raw);if(!body||Array.isArray(body))throw Error()}catch{return reply(400,{message:'入力内容を確認してください。'})}
  if(!['list','create','join','messages','send','unsend','delete','members'].includes(body.action)||body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>4096))return reply(400,{message:'操作内容を確認してください。'});
  const user=await authenticate(request);if(!user.ok)return reply(user.status,{message:user.message});
  try{
   const since=await admission(request),kv=store(env);if(!kv)throw Error();
   if(!Number.isFinite(since)||!uuid(user.uid))throw Error();
   const participating=async room=>{
    if(user.isHost)return {joined:true,since};
    if(room.ownerUid===user.uid&&Date.parse(room.at)>=since)return {joined:true,since:Math.max(since,Date.parse(room.at))};
    const member=await kv.get(memberKey(room.id,user.uid),'json'),at=Date.parse(member?.at);
    return {joined:member?.uid===user.uid&&Number.isFinite(at)&&at>=since,since:Math.max(since,at||0)};
   };
   const validRoom=r=>r&&uuid(r.id)&&uuid(r.ownerUid)&&typeof r.name==='string'&&typeof r.description==='string'&&Number.isFinite(Date.parse(r.at));
   if(body.action==='list'){
    const page=await kv.list({prefix:'group:room:v1:',limit:30,...(body.cursor?{cursor:body.cursor}:{})});
    const rows=await Promise.all(page.keys.map(async key=>{const room=await kv.get(key.name,'json');if(!validRoom(room)||await kv.get(deletedKey(room.id)))return null;return {...room,joined:(await participating(room)).joined}}));
    return reply(200,{groups:rows.filter(Boolean),cursor:page.list_complete?null:page.cursor,isAdmin:user.isHost});
   }
   if(!uuid(body.groupId))return reply(400,{message:'グループを選んでください。'});
   const id=body.groupId;
   // Deletion is a permanent tombstone, separate from all mutable records. Retries cannot resurrect it.
   if(await kv.get(deletedKey(id)))return body.action==='delete'&&user.isHost?reply(200,{ok:true}):reply(410,{message:'このグループは管理者によって削除されました。'});
   let room=await kv.get(roomKey(id),'json');
   if(body.action==='create'){
    if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>60||typeof body.description!=='string'||body.description.trim().length>500)return reply(400,{message:'名前は60文字、募集内容は500文字以内で入力してください。'});
    if(room&&(room.ownerUid!==user.uid||room.name!==body.name.trim()||room.description!==body.description.trim()||Date.parse(room.at)<since))return reply(409,{message:'内容を確認し、もう一度作成してください。'});
    if(!room){room={id,ownerUid:user.uid,name:body.name.trim(),description:body.description.trim(),at:new Date().toISOString()};await kv.put(roomKey(id),JSON.stringify(room))}
    return reply(200,{group:{...room,joined:true},isAdmin:user.isHost});
   }
   if(!validRoom(room))return reply(404,{message:'グループが見つかりません。'});
   if(body.action==='delete'){
    if(!user.isHost)return reply(403,{message:'グループの削除は管理者のみ行えます。'});
    await kv.put(deletedKey(id),JSON.stringify({by:user.uid,at:new Date().toISOString()}));return reply(200,{ok:true});
   }
   let access=await participating(room);
   if(body.action==='join'){
    if(!access.joined)await kv.put(memberKey(id,user.uid),JSON.stringify({uid:user.uid,at:new Date().toISOString()}));
    if(await kv.get(deletedKey(id)))return reply(410,{message:'このグループは削除されました。'});
    return reply(200,{group:{...room,joined:true},isAdmin:user.isHost});
   }
   if(!access.joined)return reply(403,{message:'「賛同する」を押した会員と管理者だけが利用できます。'});
   if(body.action==='members'){
    const ids=await participants(kv,room,env,directory);
    if(await kv.get(deletedKey(id)))return reply(410,{message:'このグループは削除されました。'});
    return reply(200,{participants:ids,count:ids.length});
   }
   if(body.action==='messages'){
    const prefix='group:timeline:v1:'+id+':',page=await kv.list({prefix,limit:40,...(body.cursor?{cursor:body.cursor}:{})});
    const rows=await Promise.all(page.keys.map(async key=>{const mid=key.name.split(':').at(-1);if(!uuid(mid))throw Error();const m=await kv.get(messageKey(id,mid),'json');if(!m||m.groupId!==id||!uuid(m.senderUid)||typeof m.text!=='string'||!Number.isFinite(Date.parse(m.at)))throw Error();if(Date.parse(m.at)<access.since)return null;return {...m,...(await kv.get(cancelKey(id,mid))?{text:'',unsent:true}:{})}}));
    if(await kv.get(deletedKey(id)))return reply(410,{message:'このグループは削除されました。'});
    return reply(200,{group:{...room,joined:true},isAdmin:user.isHost,messages:[...new Map(rows.filter(Boolean).map(m=>[m.id,m])).values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)),cursor:page.list_complete?null:page.cursor});
   }
   if(!uuid(body.id))return reply(400,{message:'メッセージを確認してください。'});
   const key=messageKey(id,body.id),existing=await kv.get(key,'json');
   if(body.action==='unsend'){
    if(!existing||existing.senderUid!==user.uid||Date.parse(existing.at)<access.since)return reply(403,{message:'自分が送信したメッセージのみ取り消せます。'});
    await kv.put(cancelKey(id,body.id),JSON.stringify({at:new Date().toISOString()}));return reply(200,{message:{...existing,text:'',unsent:true}});
   }
   if(typeof body.text!=='string'||!body.text.trim()||body.text.trim().length>2000)return reply(400,{message:'メッセージは1〜2000文字で入力してください。'});
   if(await kv.get(cancelKey(id,body.id)))return reply(409,{message:'取り消したメッセージは再送できません。'});
   if(existing&&(existing.senderUid!==user.uid||existing.text!==body.text.trim()||Date.parse(existing.at)<access.since))return reply(409,{message:'送信内容を確認してください。'});
   const message=existing||{id:body.id,groupId:id,senderUid:user.uid,text:body.text.trim(),at:new Date().toISOString()};
   if(!existing)await kv.put(key,JSON.stringify(message));
   const order=String(9999999999999-Date.parse(message.at)).padStart(13,'0');await kv.put('group:timeline:v1:'+id+':'+order+':'+message.id,JSON.stringify({id:message.id}));
   if(await kv.get(deletedKey(id)))return reply(410,{message:'このグループは削除されました。'});
   return reply(200,{message});
  }catch(error){return reply(503,{message:'グループを読み込み・保存できませんでした。入力は残っています。もう一度お試しください。'})}
 };
}
export const onRequest=createGroupHandler();
