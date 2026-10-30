import {privateKv} from '../../server/pii-storage.js';
import {requireAccountUser,requireYoutubeHost} from '../../server/youtube-member.js';
const PREFIX='inquiry:v1:',TYPES=['note','training','withdrawal'],UID=/^[A-Za-z0-9-]{1,80}$/;
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization, Origin'}});
const recordKey=(uid,type,id)=>PREFIX+uid+':'+type+':'+id;
const valid=x=>x&&UID.test(x.uid)&&typeof x.requestId==='string'&&typeof x.reason==='string'&&TYPES.includes(x.type)&&['pending','handled'].includes(x.status)&&Number.isFinite(Date.parse(x.submittedAt));
export async function onRequest({request,env}){
  const url=new URL(request.url),admin=url.searchParams.get('scope')==='admin',type=url.searchParams.get('type')||'note';
  if(!TYPES.includes(type))return reply(400,{message:'お問い合わせ項目を選んでください。'});
  if(!['GET','POST'].includes(request.method))return reply(405,{message:'利用できない操作です。'});
  const reading=request.method==='GET'||(request.method==='POST'&&url.searchParams.get('read')==='1');
  const user=await (admin?requireYoutubeHost:requireAccountUser)(request);
  if(!user.ok)return reply(user.status,{message:user.status===403&&admin?'管理者専用の連絡欄です。':user.message});
  if(!UID.test(user.uid))return reply(503,{message:'アカウントを確認できませんでした。'});
  const storage=env.RUNTIME_STORAGE==='supabase'||env.YT_CACHE;const kv=storage&&privateKv(env);if(!kv?.get||!kv?.put||(admin&&!kv?.list))return reply(503,{message:'問い合わせ機能は接続準備中です。'});
  let stage='STORE';
  try{
    if(admin&&reading){
      const cursor=url.searchParams.get('cursor')||undefined;if(cursor&&cursor.length>2048)return reply(400,{message:'一覧を更新してください。'});
      stage='INBOX_LIST';const page=await kv.list({prefix:PREFIX,limit:20,...(cursor?{cursor}:{})});
      stage='INBOX_DECRYPT';let rows=await Promise.all(page.keys.map(k=>kv.get(k.name,'json')));stage='INBOX_VALIDATE';if(rows.some(x=>!valid(x)))throw Error('record');
      // Head pointers and legacy records may coexist. Canonical records own the handling status.
      stage='INBOX_DECRYPT';rows=await Promise.all(rows.map(async row=>(await kv.get(recordKey(row.uid,row.type,row.requestId),'json'))||row));
      stage='INBOX_VALIDATE';if(rows.some(x=>!valid(x)))throw Error('record');rows=[...new Map(rows.map(row=>[row.requestId,row])).values()];
      rows.sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt));return reply(200,{requests:rows,cursor:page.list_complete?null:page.cursor});
    }
    if(!admin&&reading){
      stage='SELF_DECRYPT';
      let current=await kv.get(PREFIX+user.uid+':'+type,'json');if(current&&!valid(current))throw Error('record');if(current)current=(await kv.get(recordKey(user.uid,type,current.requestId),'json'))||current;if(current&&!valid(current))throw Error('record');return reply(200,{request:current||null});
    }
    if(env.PII_MIGRATION_MODE==='locked')return reply(503,{message:'個人情報の保護設定を更新中です。しばらくしてから送信してください。'});
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,{message:'JSON形式で送信してください。'});
    const raw=await request.text();if(raw.length>5000)return reply(400,{message:'入力が長すぎます。'});
    let body;try{body=JSON.parse(raw)}catch{return reply(400,{message:'入力内容を確認してください。'})}
    if(admin){
      stage='HANDLE';
      if(body?.action!=='handle'||!UID.test(body.uid)||!TYPES.includes(body.type)||typeof body.requestId!=='string')return reply(400,{message:'対象の連絡を選んでください。'});
      if(!/^[0-9a-f-]{36}$/i.test(body.requestId))return reply(400,{message:'対象の連絡を選んでください。'});
      const head=await kv.get(PREFIX+body.uid+':'+body.type,'json');
      const current=(await kv.get(recordKey(body.uid,body.type,body.requestId),'json'))||(head?.requestId===body.requestId?head:null);
      if(!valid(current)||current.uid!==body.uid||current.type!==body.type||current.requestId!==body.requestId)return reply(404,{message:'連絡が見つかりません。'});
      if(current.status==='handled')return reply(200,{request:current});
      const updated={...current,status:'handled',handledAt:new Date().toISOString(),handledBy:user.uid};await kv.put(recordKey(body.uid,body.type,body.requestId),JSON.stringify(updated));return reply(200,{request:updated});
    }
    stage='SUBMIT';
    if((type==='withdrawal'&&body?.confirmed!==true)||typeof body?.reason!=='string'||!body.reason.trim()||body.reason.trim().length>2000)return reply(400,{message:'内容を1〜2000文字で入力してください。退会については「退会希望」にチェックしてください。'});
    if(body.requestId!==undefined&&(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)))return reply(400,{message:'送信内容を更新してください。'});
    const requestId=body.requestId||crypto.randomUUID(),existing=await kv.get(recordKey(user.uid,type,requestId),'json');
    if(existing){if(!valid(existing)||existing.uid!==user.uid||existing.type!==type||existing.requestId!==requestId)throw Error('record');if(existing.reason!==body.reason.trim())return reply(409,{message:'送信内容を変更した場合は、新しい問い合わせとして送信してください。'});return reply(200,{request:existing});}
    const old=await kv.get(PREFIX+user.uid+':'+type,'json');if(old&&!valid(old))throw Error('record');
    const next={type,uid:user.uid,requestId,name:typeof body.name==='string'?body.name.trim().slice(0,100):'',email:user.email,reason:body.reason.trim(),status:'pending',submittedAt:new Date().toISOString(),handledAt:null,handledBy:null};
    // Preserve the previous item before replacing the latest pointer. Never overwrite a newer canonical status.
    if(old&&!await kv.get(recordKey(user.uid,type,old.requestId),'json'))await kv.put(recordKey(user.uid,type,old.requestId),JSON.stringify(old));
    await kv.put(recordKey(user.uid,type,next.requestId),JSON.stringify(next));
    await kv.put(PREFIX+user.uid+':'+type,JSON.stringify(next));return reply(200,{request:next});
  }catch(error){
    const keyFailure=typeof error?.message==='string'&&error.message.startsWith('PII_KEY_');
    const decryptFailure=error?.name==='OperationError';
    const code=error?.message==='KV_LIST_LIMIT'?'INQUIRY_KV_LIST_LIMIT':keyFailure?'INQUIRY_ENCRYPTION_KEY':decryptFailure?'INQUIRY_DECRYPT':'INQUIRY_'+stage;
    return reply(503,{code,message:(keyFailure?'問い合わせの暗号鍵を確認できませんでした。管理者にご連絡ください。':'問い合わせを読み込み・保存できませんでした。管理者にこのコードをお知らせください。')+'（'+code+'）'});
  }
}
