import {requireMemberRole,readChatAccessSince,readVisibleChatRoom} from '../../server/youtube-member.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,EMOJI=['👍','❤️‍🔥','😭','🙇‍♂️'];
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
const validTarget=x=>x&&UUID.test(x.senderUid)&&typeof x.messageId==='string'&&x.messageId.length>=1&&x.messageId.length<=120;
async function prefix(scope,threadId,t){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([scope,scope==='direct'?threadId:'',t.senderUid,t.messageId])));return 'reaction:v1:'+Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')+':'}
async function summary(kv,p,uid,override){
 const records=[];let cursor;const seen=new Set();
 do{const page=await kv.list({prefix:p,limit:1000,...(cursor?{cursor}:{})});records.push(...await Promise.all(page.keys.map(async k=>({uid:k.name.slice(p.length),record:await kv.get(k.name,'json')}))));cursor=page.list_complete?null:page.cursor;if(cursor){if(seen.has(cursor))throw Error('cursor');seen.add(cursor)}}while(cursor);
 const counts=Object.fromEntries(EMOJI.map(e=>[e,0]));let mine='';
 for(const r of records){if(!UUID.test(r.uid)||!EMOJI.includes(r.record?.emoji)||(override!==undefined&&r.uid===uid))continue;counts[r.record.emoji]++;if(r.uid===uid)mine=r.record.emoji}
 if(override!==undefined){mine=override;if(EMOJI.includes(override))counts[override]++}
 return {counts:EMOJI.filter(e=>counts[e]).map(emoji=>({emoji,count:counts[emoji]})),mine};
}
export async function onRequest({request,env}){
 if(request.method!=='POST')return reply(405,{message:'POSTで利用してください。'});
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{message:'アプリから操作してください。'});
 let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const raw=await request.text();if(raw.length>15000)throw Error();body=JSON.parse(raw);if(!['list','set'].includes(body?.action)||!['group','direct'].includes(body.scope))throw Error()}catch{return reply(400,{message:'リアクションの入力内容を確認してください。'})}
 const targets=body.action==='set'?[body.target]:body.targets;
 if(!Array.isArray(targets)||targets.length>30||!targets.length||!targets.every(validTarget)||(body.action==='set'&&!['',...EMOJI].includes(body.emoji)))return reply(400,{message:'4種類のリアクションから選んでください。'});
 const user=await requireMemberRole(request);if(!user.ok)return reply(user.status,{message:user.message});if(!UUID.test(user.uid))return reply(503,{message:'アカウントを確認できませんでした。'});
 const kv=env.YT_CACHE;if(!kv?.get||!kv?.put||!kv?.list)return reply(503,{message:'リアクションの接続準備中です。'});
 try{
  let allowed;
  if(body.scope==='group'){
   const rows=await readVisibleChatRoom(request),visible=new Set();
   for(const row of rows){const sender=row.path?.startsWith('chats/')?row.path.slice(6):'';for(const m of Array.isArray(row.data?.msgs)?row.data.msgs:[])if(!m.unsent)visible.add(JSON.stringify([sender,m.id]))}
   allowed=targets.map(t=>visible.has(JSON.stringify([t.senderUid,t.messageId])));
  }else{
   if(typeof body.threadId!=='string'||body.threadId.length!==73)return reply(400,{message:'個別トークを選んでください。'});
   const [thread,since]=await Promise.all([kv.get('dm:thread:v1:'+body.threadId,'json'),readChatAccessSince(request)]);
   if(!thread||!UUID.test(thread.hostUid)||!UUID.test(thread.memberUid)||thread.id!==body.threadId||thread.id!==thread.hostUid+':'+thread.memberUid||!((thread.hostUid===user.uid&&user.isHost)||thread.memberUid===user.uid))return reply(403,{message:'参加しているトークのみ利用できます。'});
   allowed=await Promise.all(targets.map(async t=>{const [m,cancelled]=await Promise.all([kv.get('dm:message:v1:'+thread.id+':'+t.messageId,'json'),kv.get('dm:unsent:v1:'+thread.id+':'+t.messageId)]);return !!m&&m.threadId===thread.id&&[thread.hostUid,thread.memberUid].includes(m.senderUid)&&m.senderUid===t.senderUid&&!m.unsent&&!cancelled&&Number.isFinite(Date.parse(m.at))&&Date.parse(m.at)>=since}));
  }
  if(body.action==='set'&&!allowed[0])return reply(403,{message:'閲覧できるメッセージのみリアクションできます。'});
  const states=await Promise.all(targets.map(async(target,i)=>{if(!allowed[i])return {...target,counts:[],mine:''};const p=await prefix(body.scope,body.threadId,target);if(body.action==='set')await kv.put(p+user.uid,JSON.stringify({emoji:body.emoji,at:new Date().toISOString()}));return {...target,...await summary(kv,p,user.uid,body.action==='set'?body.emoji:undefined)}}));
  return reply(200,{states});
 }catch{return reply(503,{message:'リアクションを更新できませんでした。もう一度お試しください。'})}
}
