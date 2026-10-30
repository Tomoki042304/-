import {requireYoutubeMember,requireYoutubeHost} from '../../server/youtube-member.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const key=id=>'announcement:item:v1:'+id;
const feed=a=>'announcement:feed:v1:'+String(9999999999999-Date.parse(a.at)).padStart(13,'0')+':'+a.id;
const valid=a=>a&&UUID.test(a.id)&&UUID.test(a.authorUid)&&typeof a.title==='string'&&a.title.length<=80&&typeof a.text==='string'&&a.text.length<=3000&&Number.isFinite(Date.parse(a.at));
const publicRow=a=>({id:a.id,title:a.title,text:a.text,at:a.at});
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request,env}){
 if(request.method!=='POST')return reply(405,{message:'POSTで利用してください。'});
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{message:'アプリから操作してください。'});
 let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const raw=await request.text();if(raw.length>20000)throw Error();body=JSON.parse(raw);if(!['list','publish'].includes(body?.action))throw Error()}catch{return reply(400,{message:'入力内容を確認してください。'})}
 const user=await (body.action==='publish'?requireYoutubeHost:requireYoutubeMember)(request);if(!user.ok)return reply(user.status,{message:user.message});if(!UUID.test(user.uid))return reply(503,{message:'アカウントを確認できませんでした。'});
 const kv=env.YT_CACHE;if(!kv?.get||!kv?.put||!kv?.list)return reply(503,{message:'お知らせ配信の接続準備中です。'});
 try{
  if(body.action==='list'){
   if(body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>2048))return reply(400,{message:'お知らせを更新してください。'});
   const page=await kv.list({prefix:'announcement:feed:v1:',limit:20,...(body.cursor?{cursor:body.cursor}:{})});
   const links=await Promise.all(page.keys.map(k=>kv.get(k.name,'json')));
   const rows=await Promise.all(links.map(link=>{if(!UUID.test(link?.id))throw Error('index');return kv.get(key(link.id),'json')}));
   if(rows.some(row=>!valid(row)))throw Error('record');
   rows.sort((a,b)=>b.at.localeCompare(a.at)||a.id.localeCompare(b.id));
   return reply(200,{announcements:rows.map(publicRow),cursor:page.list_complete?null:page.cursor});
  }
  if(!UUID.test(body.id)||typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>80||typeof body.text!=='string'||!body.text.trim()||body.text.trim().length>3000)return reply(400,{message:'タイトルは80文字、本文は3000文字以内で入力してください。'});
  let row=await kv.get(key(body.id),'json');
  if(row&&(!valid(row)||row.authorUid!==user.uid||row.title!==body.title.trim()||row.text!==body.text.trim()))return reply(409,{message:'配信内容が変わっています。入力内容を確認してください。'});
  if(!row){row={id:body.id,authorUid:user.uid,title:body.title.trim(),text:body.text.trim(),at:new Date().toISOString()};await kv.put(key(row.id),JSON.stringify(row))}
  await kv.put(feed(row),JSON.stringify({id:row.id}));
  return reply(200,{announcement:publicRow(row)});
 }catch{return reply(503,{message:'お知らせを読み込み・配信できませんでした。入力内容を残して、もう一度お試しください。'})}
}
