import {privateKv} from '../../server/pii-storage.js';
import {requireAccountUser,requireYoutubeHost} from '../../server/youtube-member.js';
const PREFIX='inquiry:v1:',TYPES=['note','training','withdrawal'],UID=/^[A-Za-z0-9-]{1,80}$/;
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization, Origin'}});
const valid=x=>x&&UID.test(x.uid)&&typeof x.requestId==='string'&&typeof x.reason==='string'&&TYPES.includes(x.type)&&['pending','handled'].includes(x.status)&&Number.isFinite(Date.parse(x.submittedAt));
export async function onRequest({request,env}){
  const url=new URL(request.url),admin=url.searchParams.get('scope')==='admin',type=url.searchParams.get('type')||'note';
  if(!TYPES.includes(type))return reply(400,{message:'お問い合わせ項目を選んでください。'});
  if(!['GET','POST'].includes(request.method))return reply(405,{message:'利用できない操作です。'});
  const reading=request.method==='GET'||(request.method==='POST'&&url.searchParams.get('read')==='1');
  const user=await (admin?requireYoutubeHost:requireAccountUser)(request);
  if(!user.ok)return reply(user.status,{message:user.status===403&&admin?'管理者専用の連絡欄です。':user.message});
  if(!UID.test(user.uid))return reply(503,{message:'アカウントを確認できませんでした。'});
  const storage=env.YT_CACHE;const kv=storage&&privateKv(env);if(!kv?.get||!kv?.put||(admin&&!kv?.list))return reply(503,{message:'問い合わせ機能は接続準備中です。'});
  try{
    if(admin&&reading){
      const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2048)return reply(400,{message:'一覧を更新してください。'});
      const page=await kv.list({prefix:PREFIX,limit:20,...(cursor?{cursor}:{})});
      const rows=await Promise.all(page.keys.map(k=>kv.get(k.name,'json')));if(rows.some(x=>!valid(x)))throw Error('record');
      rows.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));return reply(200,{requests:rows,cursor:page.list_complete?null:page.cursor});
    }
    if(!admin&&reading){
      const current=await kv.get(PREFIX+user.uid+':'+type,'json');if(current&&!valid(current))throw Error('record');return reply(200,{request:current||null});
    }
    if(env.PII_MIGRATION_MODE==='locked')return reply(503,{message:'個人情報の保護設定を更新中です。しばらくしてから送信してください。'});
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,{message:'JSON形式で送信してください。'});
    const raw=await request.text();if(raw.length>5000)return reply(400,{message:'入力が長すぎます。'});
    let body;try{body=JSON.parse(raw)}catch{return reply(400,{message:'入力内容を確認してください。'})}
    if(admin){
      if(body?.action!=='handle'||!UID.test(body.uid)||!TYPES.includes(body.type)||typeof body.requestId!=='string')return reply(400,{message:'対象の連絡を選んでください。'});
      const current=await kv.get(PREFIX+body.uid+':'+body.type,'json');if(!valid(current))return reply(404,{message:'連絡が見つかりません。'});
      if(current.requestId!==body.requestId)return reply(409,{message:'連絡が更新されています。一覧を更新してください。'});
      if(current.status==='handled')return reply(200,{request:current});
      const updated={...current,status:'handled',handledAt:new Date().toISOString(),handledBy:user.uid};await kv.put(PREFIX+body.uid+':'+body.type,JSON.stringify(updated));return reply(200,{request:updated});
    }
    if((type==='withdrawal'&&body?.confirmed!==true)||typeof body?.reason!=='string'||!body.reason.trim()||body.reason.trim().length>2000)return reply(400,{message:'内容を1〜2000文字で入力してください。退会については「退会希望」にチェックしてください。'});
    const old=await kv.get(PREFIX+user.uid+':'+type,'json');if(old&&!valid(old))throw Error('record');
    if(old?.status==='pending')return reply(409,{message:'この項目の問い合わせはすでに送信されています。',request:old});
    const next={type,uid:user.uid,requestId:crypto.randomUUID(),name:typeof body.name==='string'?body.name.trim().slice(0,100):'',email:user.email,reason:body.reason.trim(),status:'pending',submittedAt:new Date().toISOString(),handledAt:null,handledBy:null};
    if(old)await kv.put('inquiry-history:v1:'+user.uid+':'+old.requestId,JSON.stringify(old));
    await kv.put(PREFIX+user.uid+':'+type,JSON.stringify(next));return reply(200,{request:next});
  }catch{return reply(503,{message:'問い合わせを読み込み・保存できませんでした。時間をおいてお試しください。'})}
}
