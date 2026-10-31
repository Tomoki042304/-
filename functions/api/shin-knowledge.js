import {requireYoutubeHost} from '../../server/youtube-member.js';
import {manageKnowledge} from '../../server/shin-knowledge.js';
const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request,env}){
 if(request.method!=='POST'||request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{message:'アプリの管理者画面から利用してください。'});
 const user=await requireYoutubeHost(request);if(!user.ok)return reply(user.status,{message:user.status===403?'管理者専用です。':user.message});
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,{message:'入力形式を確認してください。'});
 let body;try{const raw=await request.text();if(new TextEncoder().encode(raw).length>220000)return reply(413,{message:'1件の記録は50,000文字以内にしてください。'});body=JSON.parse(raw);if(!body||typeof body!=='object')throw Error();}catch{return reply(400,{message:'入力を確認してください。'})}
 try{return reply(200,await manageKnowledge(env,body,user.uid))}catch(error){
  const code=error?.message;return reply(code==='KNOWLEDGE_INPUT'?400:code==='KNOWLEDGE_NOT_FOUND'?404:503,{message:code==='KNOWLEDGE_INPUT'?'タイトルと本文を確認してください。本文は1件50,000文字までです。':code==='KNOWLEDGE_NOT_FOUND'?'記録が見つかりません。一覧を更新してください。':'知識を読み込み・保存できませんでした。時間をおいて再試行してください。（SHIN_KNOWLEDGE）'});
 }
}
