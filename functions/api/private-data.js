import {requireAccountUser,requireYoutubeHost} from '../../server/youtube-member.js';
import {privateFields,privateCollection,sealDocument,openDocument} from '../../server/pii-storage.js';
import {database,privateRoster} from '../../server/private-documents.js';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
export async function onRequest({request,env}){
 const url=new URL(request.url);
 if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return reply(403,{message:'アプリから利用してください。'});
 const user=await requireAccountUser(request);if(!user.ok)return reply(user.status,{message:user.message});
 let body;try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();const text=await request.text();if(text.length>1500000)throw Error();body=JSON.parse(text)}catch{return reply(400,{message:'入力内容を確認してください。'})}
 try{
  if(body?.action==='roster'){
   const host=await requireYoutubeHost(request);if(!host.ok)return reply(host.status,{message:host.message});
   return reply(200,{rows:await privateRoster(request,env)});
  }
  if(body?.action==='list'){
   if(!privateCollection(body.path))return reply(400,{message:'対象を確認してください。'});
   // PostgREST applies the caller's existing RLS; paginate so the 1000-row default never truncates a roster.
   const rows=[];let offset=0;
   for(let page=0;page<100;page++){
    const query=new URLSearchParams({select:'path,data',coll:'eq.'+body.path,order:'path',limit:'100',offset:String(offset)});
    const batch=await database(request,'documents?'+query);if(!Array.isArray(batch))throw Error();
    rows.push(...await Promise.all(batch.map(async row=>({path:row.path,data:await openDocument(env,row.path,row.data)}))));
    if(batch.length<100)return reply(200,{rows});offset+=100;
   }
   return reply(503,{message:'件数が多いため一覧を取得できませんでした。'});
  }
  if(!privateFields(body?.path))return reply(400,{message:'対象を確認してください。'});
  const query=new URLSearchParams({select:'path,data',path:'eq.'+body.path});
  if(body.action==='read'){
   const rows=await database(request,'documents?'+query);if(!Array.isArray(rows))throw Error();const row=rows[0];
   return reply(200,{row:row?{path:row.path,data:await openDocument(env,row.path,row.data)}:null});
  }
  if(body.action==='write'){
   const data=await sealDocument(env,body.path,body.data);
   // The session bearer is forwarded: the server never elevates an ordinary write.
   const rows=await database(request,'documents?on_conflict=path',{method:'POST',body:{path:body.path,data,updated_at:new Date().toISOString()}});
   if(!Array.isArray(rows)||rows.length!==1)throw Error();return reply(200,{ok:true});
  }
  return reply(400,{message:'操作を確認してください。'});
 }catch(error){return reply(error.status===403?403:503,{message:error.status===403?'この情報を変更する権限がありません。':'保護された情報を読み込み・保存できませんでした。管理者にご連絡ください。'})}
}
