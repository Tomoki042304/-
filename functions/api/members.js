import {requireYoutubeHost} from '../../server/youtube-member.js';
import {createErasureService} from '../../server/member-erasure.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const reply=(status,value)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
export function createMemberErasureHandler({authorize=requireYoutubeHost,service=createErasureService}={}){return async({request,env})=>{
 const url=new URL(request.url);
 if(request.method!=='POST'||url.origin!=='https://ikigai-shidoroku.pages.dev'||request.headers.get('Origin')!==url.origin)return reply(403,{message:'管理者画面から利用してください。'});
 const actor=await authorize(request);if(!actor.ok)return reply(actor.status,{message:actor.message});
 let body;try{const raw=await request.text();if(raw.length>2048||!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();body=JSON.parse(raw)}catch{return reply(400,{message:'操作を確認してください。'})}
 if(!['list','start','step'].includes(body?.action)||body.action!=='list'&&!uuid(body.requestId)||body.action==='start'&&(!uuid(body.userId)||body.userId===actor.uid||body.confirm!=='DELETE'))return reply(400,{message:'削除するメンバーと確認内容を確認してください。'});
 try{
  const api=service(env,actor.uid);return reply(200,body.action==='list'?await api.list():body.action==='start'?await api.start(body.userId,body.requestId):await api.step(body.requestId));
 }catch(error){
  if(error?.message==='ERASURE_MIGRATION_ACTIVE')return reply(409,{code:'ERASURE_MIGRATION_ACTIVE',message:'データ移行中はメンバーを削除できません。移行完了後に再開してください。'});
  const setup=['PGRST202','42883','42P01'].includes(error?.code)||error?.message==='ERASURE_SETUP_REQUIRED';
  return reply(error?.code==='42501'?403:503,{code:setup?'ERASURE_SETUP_REQUIRED':'ERASURE_INCOMPLETE',message:setup?'削除機能のSQL設定が未完了です。先に設定用SQLを実行してください。':error?.code==='42501'?'削除権限を確認できません。自分自身や管理者アカウントは削除できません。':'削除はまだ完了していません。通信や保存先を確認し、管理者画面から削除を再開してください。'});
 }
}}
export const onRequest=createMemberErasureHandler();
