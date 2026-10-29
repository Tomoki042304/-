import {deliverPush} from '../../server/web-push.js';
import {requireMemberRole,readPrivateChatRoster,readChatAccessSince} from '../../server/youtube-member.js';
const UID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
const tkey=id=>'dm:thread:v1:'+id,ikey=(uid,id)=>'dm:inbox:v1:'+uid+':'+id;
const incoming=(uid,id)=>'dm:incoming:v1:'+uid+':'+id+':',readKey=(uid,id)=>'dm:read:v1:'+uid+':'+id;
const validThread=t=>t&&UID.test(t.hostUid)&&UID.test(t.memberUid)&&t.id===t.hostUid+':'+t.memberUid&&typeof t.hostName==='string'&&typeof t.memberName==='string';
const canRead=(u,t)=>validThread(t)&&((t.hostUid===u.uid&&u.isHost)||t.memberUid===u.uid);
const sortKey=m=>String(9999999999999-Date.parse(m.at)).padStart(13,'0')+':'+m.id;
async function unread(kv,u,t){const [list,seen]=await Promise.all([kv.list({prefix:incoming(u.uid,t.id),limit:20}),kv.get(readKey(u.uid,t.id),'json')]);list.keys=list.keys.filter(k=>9999999999999-Number(k.name.slice(incoming(u.uid,t.id).length).split(':')[0])>=u.chatSince);const ids=Array.isArray(seen?.ids)?seen.ids:[];return {incomingIds:list.keys.map(k=>k.name.split(':').at(-1)),unread:list.keys.some(k=>!ids.includes(k.name.split(':').at(-1))),updatedAt:list.keys.length?new Date(9999999999999-Number(list.keys[0].name.slice(incoming(u.uid,t.id).length).split(':')[0])).toISOString():t.createdAt}}
export async function onRequest(context){
  const {request,env}=context;
  if(request.method!=='POST')return reply(405,{message:'POSTで利用してください。'});
  const user=await requireMemberRole(request);if(!user.ok)return reply(user.status,{message:user.message});
  try{user.chatSince=await readChatAccessSince(request)}catch{return reply(503,{message:'トークの利用情報を確認できませんでした。時間をおいてもう一度お試しください。'})}
  if(!UID.test(user.uid))return reply(503,{message:'アカウントを確認できませんでした。'});
  const kv=env.YT_CACHE;if(!kv?.get||!kv?.put||!kv?.list)return reply(503,{message:'個別トークは接続準備中です。'});
  let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('type');const raw=await request.text();if(raw.length>8000)throw Error('length');body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error('body')}catch{return reply(400,{message:'入力内容を確認してください。'})}
  if(body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>2048))return reply(400,{message:'一覧を更新してください。'});
  try{
    if(body.action==='create'){
      if(!user.isHost)return reply(403,{message:'新しい個別トークは管理者のみ開始できます。'});
      if(!UID.test(body.memberUid)||body.memberUid===user.uid)return reply(400,{message:'連絡するメンバーを選んでください。'});
      const roster=await readPrivateChatRoster(request),member=roster.find(r=>r.user_id===body.memberUid),host=roster.find(r=>r.user_id===user.uid);
      if(!member)return reply(403,{message:'在籍メンバーを確認できませんでした。'});
      const id=user.uid+':'+body.memberUid;let thread=await kv.get(tkey(id),'json');
      if(thread&&!validThread(thread))throw Error('thread');
      if(!thread){thread={id,hostUid:user.uid,memberUid:body.memberUid,hostName:String(host?.display_name||'管理者').slice(0,100),memberName:String(member.display_name||'メンバー').slice(0,100),createdAt:new Date().toISOString()};await kv.put(tkey(id),JSON.stringify(thread));}
      await kv.put(ikey(user.uid,id),JSON.stringify({id}));await kv.put(ikey(body.memberUid,id),JSON.stringify({id}));
      return reply(200,{thread});
    }
    if(body.action==='inbox'){
      const page=await kv.list({prefix:'dm:inbox:v1:'+user.uid+':',limit:10,...(body.cursor?{cursor:body.cursor}:{})});
      const links=await Promise.all(page.keys.map(k=>kv.get(k.name,'json'))),threads=[];
      for(const link of links){if(!link?.id)continue;const t=await kv.get(tkey(link.id),'json');if(!canRead(user,t))continue;const state=await unread(kv,user,t);threads.push({id:t.id,peerUid:t.hostUid===user.uid?t.memberUid:t.hostUid,peerName:t.hostUid===user.uid?t.memberName:t.hostName,...state});}
      return reply(200,{threads,cursor:page.list_complete?null:page.cursor,isHost:user.isHost});
    }
    if(typeof body.threadId!=='string'||body.threadId.length!==73)return reply(400,{message:'個別トークを選んでください。'});
    const thread=await kv.get(tkey(body.threadId),'json');if(!canRead(user,thread))return reply(403,{message:'この個別トークは参加者だけが利用できます。'});
    if(body.action==='messages'){
      const page=await kv.list({prefix:'dm:messages:v1:'+thread.id+':',limit:20,...(body.cursor?{cursor:body.cursor}:{})});const rows=await Promise.all(page.keys.map(k=>kv.get(k.name,'json')));
      if(rows.some(m=>!m||m.threadId!==thread.id||![thread.hostUid,thread.memberUid].includes(m.senderUid)||!UID.test(m.id)||typeof m.text!=='string'||!Number.isFinite(Date.parse(m.at))))throw Error('message');
      rows.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));const eligible=rows.filter(m=>Date.parse(m.at)>=user.chatSince);return reply(200,{thread,since:new Date(user.chatSince).toISOString(),messages:eligible,cursor:page.list_complete||eligible.length<rows.length?null:page.cursor});
    }
    if(body.action==='read'){
      if(!Array.isArray(body.ids)||body.ids.length>40||!body.ids.every(id=>UID.test(id)))return reply(400,{message:'既読情報を確認できませんでした。'});
      const old=await kv.get(readKey(user.uid,thread.id),'json'),ids=[...new Set([...(Array.isArray(old?.ids)?old.ids:[]),...body.ids])].slice(-200);await kv.put(readKey(user.uid,thread.id),JSON.stringify({ids}));return reply(200,{ok:true});
    }
    if(body.action==='send'){
      if(!UID.test(body.id)||typeof body.text!=='string'||!body.text.trim()||body.text.trim().length>2000)return reply(400,{message:'メッセージを1〜2000文字で入力してください。'});
      if(user.isHost&&thread.hostUid===user.uid){const roster=await readPrivateChatRoster(request);if(!roster.some(r=>r.user_id===thread.memberUid))return reply(403,{message:'相手の在籍状態を確認できませんでした。'});}
      const key='dm:message:v1:'+thread.id+':'+body.id;let message=await kv.get(key,'json');
      if(message&&Date.parse(message.at)<user.chatSince)return reply(403,{message:'入会前のメッセージは利用できません。'});
      if(message&&(message.senderUid!==user.uid||message.text!==body.text.trim()))return reply(409,{message:'送信内容を確認し、個別トークを開き直してください。'});
      if(!message){message={id:body.id,threadId:thread.id,senderUid:user.uid,text:body.text.trim(),at:new Date().toISOString()};await kv.put(key,JSON.stringify(message));}
      const sort=sortKey(message),recipient=user.uid===thread.hostUid?thread.memberUid:thread.hostUid;
      await kv.put('dm:messages:v1:'+thread.id+':'+sort,JSON.stringify(message));await kv.put(incoming(recipient,thread.id)+sort,JSON.stringify({id:message.id}));
      const pushKey='dm:push:v1:'+thread.id+':'+message.id;
      if(!await kv.get(pushKey)){await kv.put(pushKey,'queued',{expirationTtl:86400});const job=deliverPush(env,recipient,{title:'IKIGAI 個別トーク',body:'個別メッセージが届きました。',tag:pushKey,data:{threadId:thread.id}}).catch(()=>{});if(context.waitUntil)context.waitUntil(job);else await job;}
      return reply(200,{message});
    }
    return reply(400,{message:'利用できない操作です。'});
  }catch{return reply(503,{message:'個別トークを読み込み・保存できませんでした。時間をおいてお試しください。'})}
}
