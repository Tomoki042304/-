import {requireYoutubeMember,requireYoutubeHost} from '../../server/youtube-member.js';
import {database} from '../../server/private-documents.js';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'}});
const missing=e=>['PGRST202','42883'].includes(e?.code);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const rpc=(request,name,body={})=>database(request,'rpc/'+name,{method:'POST',body});
export async function onRequest({request}){
 const url=new URL(request.url);
 if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return reply(403,{message:'アプリから利用してください。'});
 let body;try{const raw=await request.text();if(raw.length>10000||!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error();body=JSON.parse(raw)}catch{return reply(400,{message:'入力内容を確認してください。'})}
 const hostActions=['list','set','approve','meeting-write'];
 if(![...hostActions,'self','meeting-read'].includes(body?.action))return reply(400,{message:'操作を確認してください。'});
 const access=await(hostActions.includes(body.action)?requireYoutubeHost:requireYoutubeMember)(request);
 if(!access.ok)return reply(access.status,{message:access.message});
 try{
  if(body.action==='list')return reply(200,{rows:await rpc(request,'ikigai_admin_member_plans_v1')});
  if(body.action==='set'||body.action==='approve'){
   if(!uuid(body.user_id)||!['basic','premium'].includes(body.plan))return reply(400,{message:'会員とプランを確認してください。'});
   return reply(200,await rpc(request,body.action==='set'?'ikigai_set_member_plan_v1':'ikigai_approve_member_plan_v1',{p_user_id:body.user_id,p_plan:body.plan}));
  }
  if(body.action==='self')return reply(200,{membership:await rpc(request,'ikigai_my_membership_v1')});
  if(body.action==='meeting-read'){
   try{return reply(200,await rpc(request,'ikigai_zoom_read_v1'))}
   catch(error){
    if(!missing(error))throw error;
    // Compatibility only until the SQL installation. After installation the restrictive
    // document policy and scrubbed row make this path fail closed, even during RPC reload.
    const rows=await database(request,'documents?select=data&path=eq.config%2Fmeeting');
    const data=Array.isArray(rows)?rows[0]?.data:null;
    if(data?.storage==='private'||!data)throw Error('PLAN_SETUP_REQUIRED');
    return reply(200,{membership:{plan:'premium',can_zoom:true,legacy:true},meeting:data});
   }
  }
  if(body.action==='meeting-write'){
   const m=body.meeting;
   if(!m||typeof m!=='object'||!['url','when','memo'].every(k=>typeof m[k]==='string')||m.url.length>2000||m.when.length>60||m.memo.length>200||(m.url&&!/^https:\/\/[^\s<>"']+$/i.test(m.url)))return reply(400,{message:'Zoomの入力内容を確認してください。'});
   // Never write the legacy row: old clients cannot accidentally republish a private URL.
   return reply(200,await rpc(request,'ikigai_zoom_write_v1',{p_meeting:{url:m.url,when:m.when,memo:m.memo}}));
  }
 }catch(error){
  const denied=[401,403].includes(error.status)||error.code==='42501';
  return reply(denied?403:503,{message:denied?'この操作を行う権限がありません。':missing(error)?'プラン管理のデータベース設定がまだ完了していません。':'プラン情報を取得・保存できませんでした。再度お試しください。'});
 }
}
