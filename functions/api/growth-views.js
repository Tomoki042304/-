import {requireGrowthUser} from '../../server/growth-access.js';
import {requireYoutubeHost} from '../../server/youtube-member.js';
import {database} from '../../server/private-documents.js';
import {privateKv,openDocument} from '../../server/pii-storage.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid=t=>t&&UUID.test(t.author)&&typeof t.id==='string'&&t.id.length>0&&t.id.length<=120&&!/[\u0000-\u001f]/.test(t.id);
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
async function prefix(t){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t.id));return 'reaction:growth-view:v1:'+t.author.toLowerCase()+':'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')+':'}
export async function onRequest({request,env}){
 if(request.method!=='POST'||request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{message:'アプリから利用してください。'});
 let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const raw=await request.text();if(raw.length>12000)throw Error();body=JSON.parse(raw);if(!['mark','list'].includes(body?.action))throw Error()}catch{return reply(400,{message:'入力内容を確認してください。'})}
 const targets=body.action==='mark'?body.targets:[body.target];
 if(!Array.isArray(targets)||!targets.length||targets.length>20||!targets.every(valid)||body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>4096))return reply(400,{message:'投稿を確認してください。'});
 // A read request never relies on a browser-supplied admin flag.
 const user=body.action==='list'?await requireYoutubeHost(request):await requireGrowthUser(request);
 if(!user.ok)return reply(user.status||403,{message:body.action==='list'?'閲覧一覧は管理者のみ確認できます。':user.message});
 if(!UUID.test(user.uid))return reply(401,{message:'ログインし直してください。'});
 try{
  const kv=privateKv({...env,IKIGAI_ACTOR_UID:user.uid}),posts=new Map();
  for(const target of targets){const author=target.author.toLowerCase();if(!posts.has(author)){const rows=await database(request,'documents?'+new URLSearchParams({select:'data',path:'eq.posts/'+author}));posts.set(author,Array.isArray(rows?.[0]?.data?.posts)?rows[0].data.posts:[])}}
  const exists=t=>posts.get(t.author.toLowerCase()).some(p=>p&&String(p.id)===t.id);
  if(body.action==='mark'){
   const accepted=[];
   for(const target of targets){if(!exists(target))continue;const key=await prefix(target)+user.uid,old=await kv.get(key,'json');if(!old)await kv.put(key,JSON.stringify({authorUid:target.author.toLowerCase(),uid:user.uid,at:new Date().toISOString()}));accepted.push(target)}
   return reply(200,{accepted});
  }
  const target=targets[0];if(!exists(target))return reply(404,{message:'投稿が見つかりません。'});
  const p=await prefix(target),page=await kv.list({prefix:p,limit:100,...(body.cursor?{cursor:body.cursor}:{})}),records=[];
  for(const key of page.keys){const uid=key.name.slice(p.length);if(!UUID.test(uid))continue;const r=await kv.get(key.name,'json');if(r?.uid===uid&&r.authorUid===target.author.toLowerCase()&&Number.isFinite(Date.parse(r.at)))records.push(r)}
  const rows=[];
  if(records.length){
   const serviceKey=env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY;if(typeof serviceKey!=='string'||!serviceKey.startsWith('eyJ'))throw Error('SETUP');
   const paths=records.map(r=>'data/users/'+r.uid+'/profile');const profiles=await database(null,'documents?'+new URLSearchParams({select:'path,data',path:'in.('+paths.map(p=>JSON.stringify(p)).join(',')+')'}),{serviceKey});
   for(const record of records){const profile=profiles.find(p=>p.path==='data/users/'+record.uid+'/profile');if(!profile)continue;const person=await openDocument(env,profile.path,profile.data);rows.push({uid:record.uid,name:typeof person.nick==='string'?person.nick.slice(0,80):'メンバー',avatar:typeof person.avatar==='string'&&person.avatar.length<=300000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(person.avatar)?person.avatar:'',at:record.at})}
  }
  return reply(200,{rows,cursor:page.list_complete?null:page.cursor});
 }catch{return reply(503,{message:'閲覧情報を確認できませんでした。もう一度お試しください。'})}
}
