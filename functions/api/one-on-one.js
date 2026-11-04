import {requireMemberRole} from '../../server/youtube-member.js';
import {hasTalkIntroduction} from '../../server/talk-introduction.js';
import {database} from '../../server/private-documents.js';
import {privateKv,openDocument} from '../../server/pii-storage.js';
const SHIN='c5516add-0853-4dd8-b101-b4f6483404eb',PREFIX='dm:oneonone:v1:';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
const valid=r=>r&&typeof r.uid==='string'&&r.hostUid===SHIN&&typeof r.name==='string'&&typeof r.id==='string'&&r.threadId===SHIN+':'+r.uid&&Number.isFinite(Date.parse(r.at));
export async function onRequest({request,env}){
 const origin=new URL(request.url).origin;if(request.method!=='POST'||request.headers.get('Origin')!==origin)return reply(403,{message:'アプリから利用してください。'});
 const user=await requireMemberRole(request);if(!user.ok)return reply(user.status,{message:user.message});
 let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const raw=await request.text();if(raw.length>3000)throw Error();body=JSON.parse(raw)}catch{return reply(400,{message:'入力内容を確認してください。'})}
 if(!['apply','status','inbox'].includes(body?.action))return reply(400,{message:'操作を確認してください。'});
 const kv=privateKv({...env,IKIGAI_ACTOR_UID:user.uid});
 try{
  if(body.action==='inbox'){
   if(!user.isHost)return reply(403,{message:'管理者のみ確認できます。'});
   const cursor=typeof body.cursor==='string'&&body.cursor.length<=4096?body.cursor:undefined;
   const page=await kv.list({prefix:PREFIX,limit:20,...(cursor?{cursor}:{})});const values=await Promise.all(page.keys.map(k=>kv.get(k.name,'json')));
   if(values.some(r=>!valid(r)))throw Error('invalid request');
   const rows=values.filter(r=>r.sent===true).map(r=>({uid:r.uid,name:r.name,at:r.at,requestId:r.id,threadId:r.threadId,canChat:true,readOnly:user.uid!==SHIN})).sort((a,b)=>b.at.localeCompare(a.at));
   return reply(200,{rows,cursor:page.list_complete?null:page.cursor});
  }
  const membership=await database(request,'rpc/ikigai_my_membership_v1',{method:'POST',body:{}});
  if(user.isHost||membership?.plan!=='basic'||membership?.can_zoom!==false)return reply(403,{message:'ベーシック会員限定の申込みです。'});
  const pointer=await kv.get(PREFIX+user.uid,'json');
  const previous=pointer||await kv.get(PREFIX+user.uid+':'+SHIN+':'+user.uid,'json');
  if(previous&&(!valid(previous)||previous.uid!==user.uid))throw Error('invalid request');
  if(!pointer&&previous?.sent===true)await kv.put(PREFIX+user.uid,JSON.stringify(previous));
  async function applicationState(){
   let handled=false;
   if(previous?.sent===true){const recent=await kv.list({prefix:'dm:incoming:v1:'+user.uid+':'+previous.threadId+':',limit:1});if(recent.keys.length){const id=recent.keys[0].name.split(':').at(-1),message=await kv.get('dm:message:v1:'+previous.threadId+':'+id,'json');handled=message?.senderUid===SHIN&&message.threadId===previous.threadId&&Date.parse(message.at)>=Date.parse(previous.at)}}
   return {applied:previous?.sent===true,handled,repeatAllowed:false};
  }
  if(body.action==='status')return reply(200,await applicationState());
  if(previous?.sent===true)return reply(200,{...await applicationState(),already:true});
  if(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))return reply(400,{message:'アプリを更新してからもう一度お申し込みください。'});
  // A stable identity also deduplicates concurrent submissions and new retry IDs.
  const applicationId=user.uid;
  const requestKey=PREFIX+user.uid+':'+SHIN+':'+applicationId;
  let record=await kv.get(requestKey,'json');if(record&&(!valid(record)||record.uid!==user.uid||record.id!==applicationId))throw Error('invalid request');
  if(record?.sent===true)return reply(200,{applied:true,already:true});
  if(env.PII_MIGRATION_MODE==='locked')return reply(503,{message:'保護設定の更新中です。しばらくしてからお試しください。'});
  if(!await hasTalkIntroduction(request))return reply(403,{message:'先に自己紹介を送信してからお申し込みください。'});
  const serviceKey=env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY;
  const hosts=await database(null,'admins?'+new URLSearchParams({select:'user_id',user_id:'eq.'+SHIN}),{serviceKey});
  if(!Array.isArray(hosts)||hosts.length!==1)return reply(503,{message:'SHINの送信先を確認できませんでした。運営へご連絡ください。'});
  if(!record){
   const rows=await database(request,'documents?'+new URLSearchParams({select:'path,data',path:'eq.members/'+user.uid}));const member=rows?.[0]?await openDocument(env,rows[0].path,rows[0].data):{};
   const id=applicationId;
   record={uid:user.uid,hostUid:SHIN,name:typeof member.nick==='string'?member.nick.slice(0,100):'メンバー',id,threadId:SHIN+':'+user.uid,at:new Date().toISOString(),sent:false};
   await kv.put(requestKey,JSON.stringify(record));
  }
  const threadKey='dm:thread:v1:'+record.threadId;let thread=await kv.get(threadKey,'json');
  if(thread&&(thread.hostUid!==SHIN||thread.memberUid!==user.uid||thread.id!==record.threadId))throw Error('invalid thread');
  if(!thread){thread={id:record.threadId,hostUid:SHIN,memberUid:user.uid,hostName:'SHIN',memberName:record.name,createdAt:record.at};await kv.put(threadKey,JSON.stringify(thread))}
  await kv.put('dm:inbox:v1:'+SHIN+':'+thread.id,JSON.stringify({id:thread.id}));await kv.put('dm:inbox:v1:'+user.uid+':'+thread.id,JSON.stringify({id:thread.id}));
  const key='dm:message:v1:'+thread.id+':'+record.id;let message=await kv.get(key,'json');
  const cancelled=await kv.get('dm:unsent:v1:'+thread.id+':'+record.id);
  if(!cancelled&&!message?.unsent){
   if(!message){message={id:record.id,threadId:thread.id,senderUid:user.uid,text:'面談希望',at:record.at};await kv.put(key,JSON.stringify(message))}
   if(message.senderUid!==user.uid||message.text!=='面談希望'||message.id!==record.id)throw Error('invalid message');
   const sort=String(9999999999999-Date.parse(message.at)).padStart(13,'0')+':'+record.id;
   await kv.put('dm:messages:v1:'+thread.id+':'+sort,JSON.stringify(message));await kv.put('dm:incoming:v1:'+SHIN+':'+thread.id+':'+sort,JSON.stringify({id:record.id}));
  }
  await kv.put(requestKey,JSON.stringify({...record,sent:true}));await kv.put(PREFIX+user.uid,JSON.stringify({...record,sent:true}));return reply(200,{applied:true,already:false});
 }catch{return reply(503,{message:'申込みを完了できませんでした。もう一度お試しください。同じ送信の再試行ではメッセージは重複しません。'})}
}
