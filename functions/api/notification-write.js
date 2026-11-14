import {requireAccountUser} from '../../server/youtube-member.js';
import {database} from '../../server/private-documents.js';
// Persist with the SAME caller bearer/RLS as the previous direct SDK write.
// The common middleware wakes delivery only after this request succeeds.
const reply=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request}){
 if(request.method!=='POST'||request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,{message:'アプリから利用してください。'});
 const user=await requireAccountUser(request,{verifyLive:true});if(!user.ok)return reply(user.status,{message:user.message});
 let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const raw=await request.text();if(raw.length>1500000)throw Error();body=JSON.parse(raw);if(!body||Array.isArray(body))throw Error()}catch{return reply(400,{message:'保存する内容を確認してください。'})}
 try{
  if(body.action==='posts'){
   if(!body.data||typeof body.data!=='object'||Array.isArray(body.data))return reply(400,{message:'投稿内容を確認してください。'});
   const rows=await database(request,'documents?on_conflict=path',{method:'POST',body:{path:'posts/'+user.uid,data:body.data,updated_at:new Date().toISOString()}});
   if(!Array.isArray(rows)||rows.length!==1)throw Error();return reply(200,{ok:true});
  }
  if(body.action==='chat'){
   await database(request,'rpc/ikigai_chat_write_v1',{method:'POST',body:{p_messages:Array.isArray(body.msgs)?body.msgs:[],p_read_at:body.readAt||null,p_give_read_at:body.giveReadAt||null}});
   return reply(200,{ok:true});
  }
  if(body.action==='greeting'){
   const result=await database(request,'rpc/ikigai_register_greeting_v1',{method:'POST',body:{p_fields:body.fields}});
   return reply(200,result);
  }
  return reply(400,{message:'利用できない操作です。'});
 }catch(error){return reply(error.status===403?403:503,{message:error.status===403?'この情報を保存する権限がありません。':'保存を確認できませんでした。通信状態を確認して再試行してください。'})}
}
