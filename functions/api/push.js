import {requireYoutubeMember,readNotificationDocument} from '../../server/youtube-member.js';
import {newVapidKey,validateSubscription,digest,deliverPush} from '../../server/web-push.js';
const UID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
export async function onRequest(context){
  const {request,env}=context;if(request.method!=='POST')return reply(405,{message:'POSTで利用してください。'});
  const user=await requireYoutubeMember(request);if(!user.ok)return reply(user.status,{message:user.message});
  if(!UID.test(user.uid))return reply(503,{message:'アカウントを確認できませんでした。'});
  const kv=env.YT_CACHE;if(!kv?.get||!kv?.put||!kv?.list||!kv?.delete)return reply(503,{message:'通知機能は接続準備中です。'});
  let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('type');const raw=await request.text();if(raw.length>10000)throw Error('length');body=JSON.parse(raw);if(!body||typeof body!=='object')throw Error('body')}catch{return reply(400,{message:'入力内容を確認してください。'})}
  try{
    if(body.action==='key'){
      const id=crypto.randomUUID(),key=await newVapidKey();await kv.put('push:key:v1:'+id,JSON.stringify({...key,uid:user.uid}));return reply(200,{keyId:id,publicKey:key.publicKey});
    }
    if(['status','unsubscribe'].includes(body.action)){
      if(typeof body.endpoint!=='string'||body.endpoint.length>3000)return reply(400,{message:'通知の接続先を確認できませんでした。'});
      const key='push:subscription:v1:'+user.uid+':'+await digest(body.endpoint);
      if(body.action==='unsubscribe'){await kv.delete(key);return reply(200,{enabled:false})}
      return reply(200,{enabled:!!await kv.get(key,'json')});
    }
    if(body.action==='subscribe'){
      let subscription;try{subscription=validateSubscription(body.subscription)}catch{return reply(400,{message:'通知の接続先を確認できませんでした。'})}
      if(!UID.test(body.keyId))return reply(400,{message:'通知を有効にし直してください。'});
      const key=await kv.get('push:key:v1:'+body.keyId,'json');if(!key||key.uid!==user.uid)return reply(403,{message:'通知を有効にし直してください。'});
      // Importing the public key also rejects invalid points before storing an endpoint.
      const bytes=Uint8Array.from(atob(subscription.keys.p256dh.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-subscription.keys.p256dh.length%4)%4)),c=>c.charCodeAt(0));
      try{await crypto.subtle.importKey('raw',bytes,{name:'ECDH',namedCurve:'P-256'},false,[])}catch{return reply(400,{message:'端末の通知キーを確認できませんでした。'})}
      await kv.put('push:subscription:v1:'+user.uid+':'+await digest(subscription.endpoint),JSON.stringify({...subscription,keyId:body.keyId}));return reply(200,{enabled:true});
    }
    if(body.action==='notify'){
      if(!['like','comment'].includes(body.kind)||typeof body.postKey!=='string'||body.postKey.length>150)return reply(400,{message:'通知対象を確認できませんでした。'});
      const split=body.postKey.indexOf(':'),owner=body.postKey.slice(0,split),postId=body.postKey.slice(split+1);if(!UID.test(owner)||!/^[A-Za-z0-9_-]{1,100}$/.test(postId))return reply(400,{message:'通知対象を確認できませんでした。'});
      if(owner===user.uid)return reply(200,{accepted:false});
      const [source,target]=await Promise.all([readNotificationDocument(request,'posts/'+user.uid),readNotificationDocument(request,'posts/'+owner)]);
      if(!target?.posts?.some(p=>p.id===postId))return reply(404,{message:'投稿が見つかりません。'});
      let eventAt,eventId;
      if(body.kind==='like'){if(!source?.likes?.includes(body.postKey))return reply(403,{message:'応援の記録を確認できませんでした。'});eventAt=source.likeTimes?.[body.postKey];eventId=eventAt;}
      else{const comment=source?.comments?.find(c=>c.id===body.eventId&&c.key===body.postKey);if(!comment)return reply(403,{message:'コメントの記録を確認できませんでした。'});eventAt=comment.at;eventId=comment.id;}
      const time=Date.parse(eventAt);if(!Number.isFinite(time)||time>Date.now()+60000||Date.now()-time>600000)return reply(400,{message:'通知対象の日時を確認できませんでした。'});
      const eventKey='push:event:v1:'+await digest([body.kind,user.uid,body.postKey,eventId].join('|'));if(await kv.get(eventKey))return reply(200,{accepted:true,duplicate:true});
      await kv.put(eventKey,'queued',{expirationTtl:86400});
      const job=deliverPush(env,owner,{title:'IKIGAI',body:body.kind==='like'?'あなたの投稿にいいねが届きました。':'あなたの投稿にコメントが届きました。',tag:eventKey,data:{postKey:body.postKey,kind:body.kind}}).catch(()=>{});
      if(context.waitUntil)context.waitUntil(job);else await job;return reply(200,{accepted:true});
    }
    return reply(400,{message:'利用できない操作です。'});
  }catch{return reply(503,{message:'通知の設定・送信ができませんでした。時間をおいてお試しください。'})}
}
