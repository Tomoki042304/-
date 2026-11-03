import {requireGrowthUser} from '../../server/growth-access.js';
import {requireYoutubeMember} from '../../server/youtube-member.js';
import {database,ROOT} from '../../server/private-documents.js';
const BUCKET='ikigai-growth-photos',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers={'Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff'};
const reply=(status,message)=>Response.json({message},{status,headers});
async function bytes(request,max){
 const reader=request.body?.getReader();if(!reader)throw Error('INPUT');const chunks=[];let length=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error('LARGE')}chunks.push(value)}}finally{reader.releaseLock()}
 const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length}return out;
}
function jpeg(data){
 if(data.length<20||data.length>160000||data[0]!==255||data[1]!==216||data.at(-2)!==255||data.at(-1)!==217)return false;
 for(let i=2;i+8<data.length;){if(data[i++]!==255)return false;let marker=data[i++];while(marker===255)marker=data[i++];
  if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;
  const size=data[i]*256+data[i+1];if(size<2||i+size>data.length)return false;
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
   const h=data[i+3]*256+data[i+4],w=data[i+5]*256+data[i+6];return w>0&&h>0&&w<=1600&&h<=1600;
  }i+=size;
 }return false;
}
async function storage(env,path,{method='GET',body,type='application/json'}={}){
 const key=env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY;if(typeof key!=='string'||!key.startsWith('eyJ'))throw Error('SETUP');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{return await fetch(ROOT+'/storage/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':type,'x-upsert':'true'},...(body===undefined?{}:{body:type==='application/json'?JSON.stringify(body):body}),signal:controller.signal,redirect:'manual'})}finally{clearTimeout(timer)}
}
async function privateBucket(env){
 let response=await storage(env,'bucket/'+BUCKET);
 const initial=await response.json().catch(()=>null);
 if(response.status===404||response.status===400&&/bucket.*not found/i.test(String(initial?.message||initial?.error||''))){const made=await storage(env,'bucket',{method:'POST',body:{id:BUCKET,name:BUCKET,public:false,file_size_limit:200000,allowed_mime_types:['image/jpeg']}});if(!made.ok&&made.status!==409)throw Error('SETUP');response=await storage(env,'bucket/'+BUCKET)}
 if(!response.ok)throw Error('SETUP');const bucket=response.bodyUsed?initial:await response.json();if(bucket.public!==false)throw Error('SETUP');
}
async function posts(request,uid){const query=new URLSearchParams({select:'data',path:'eq.posts/'+uid});const rows=await database(request,'documents?'+query);if(!Array.isArray(rows))throw Error('DATA');return Array.isArray(rows[0]?.data?.posts)?rows[0].data.posts:[]}
export async function onRequest({request,env}){
 const url=new URL(request.url),action=url.searchParams.get('action');
 if(request.method!=='POST'||request.headers.get('Origin')!==url.origin)return reply(403,'アプリから利用してください。');
 if(!['upload','read','delete'].includes(action))return reply(400,'操作を確認してください。');
 const member=await requireGrowthUser(request);if(!member.ok)return reply(member.status,member.message);
 if(!UUID.test(member.uid))return reply(403,'ログインし直してください。');
 try{
  if(action==='upload'){
   const id=url.searchParams.get('id');if(!UUID.test(id||'')||request.headers.get('Content-Type')!=='image/jpeg')return reply(400,'写真を選び直してください。');
   const data=await bytes(request,160000);if(!jpeg(data))return reply(400,'写真を読み込めません。JPEG形式の写真を選び直してください。');
   await privateBucket(env);
   const saved=await storage(env,'object/'+BUCKET+'/'+member.uid+'/'+id+'.jpg',{method:'POST',body:data,type:'image/jpeg'});
   if(!saved.ok)throw Error('SAVE');return Response.json({id},{headers});
  }
  const body=JSON.parse(new TextDecoder().decode(await bytes(request,2048))),id=body.id,author=action==='delete'?member.uid:body.author;
  if(!UUID.test(id||'')||!UUID.test(author||''))return reply(400,'写真を確認してください。');
  const records=await posts(request,author),published=records.some(p=>p?.id===id&&p.photoId===id);
  const object=author+'/'+id+'.jpg';
  if(action==='read'){
   if(!published)return reply(404,'写真が見つかりません。');
   const image=await storage(env,'object/authenticated/'+BUCKET+'/'+object);
   if(!image.ok)return reply(image.status===404?404:503,'写真を読み込めませんでした。');
   const data=new Uint8Array(await image.arrayBuffer());if(!jpeg(data))return reply(503,'写真を読み込めませんでした。');
   return new Response(data,{headers:{...headers,'Content-Type':'image/jpeg','Content-Security-Policy':"default-src 'none'"}});
  }
  // Only the signed-in author's unlinked objects can be removed. A failed post save cannot erase a published photo.
  if(published)return reply(409,'投稿に表示中の写真は削除できません。');
  const removed=await storage(env,'object/'+BUCKET,{method:'DELETE',body:{prefixes:[object]}});if(!removed.ok&&removed.status!==404)throw Error('DELETE');
  return Response.json({deleted:true},{headers});
 }catch(error){return reply(error.message==='LARGE'?413:503,error.message==='LARGE'?'写真のサイズが大きすぎます。選び直してください。':'写真を保存・取得できませんでした。通信状態を確認して再度お試しください。')}
}
