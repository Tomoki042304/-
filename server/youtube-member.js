import {privateRoster} from './private-documents.js';
const URL_ROOT='https://ebozxwiuujrnvmxienat.supabase.co';
const PUBLIC_KEY='sb_publishable_mJ6vFykk8ykbAmm2LaEEuA_Ea5n4yp8';
const issue=(stage,suffix,status=503)=>({status,code:'YT_'+stage+'_'+suffix,message:(stage==='AUTH'?'ログイン状態':'承認状態')+'を確認できませんでした。（YT_'+stage+'_'+suffix+'）時間をおいて、もう一度読み込んでください。'});
async function readCheck(path,init,stage){
  // Each check has its own deadline. Retry only transient network/5xx failures once.
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(URL_ROOT+path,{...init,signal:controller.signal,redirect:'manual'});
      const body=await response.json().catch(()=>null);
      if(response.status>=500&&attempt===0)continue;
      return {status:response.status,ok:response.ok,body};
    }catch(error){if(attempt===1)return {failure:issue(stage,error?.name==='AbortError'?'TIMEOUT':'NETWORK')};}
    finally{clearTimeout(timer)}
  }
}
export async function requireYoutubeMember(request){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(url.protocol!=='https:'||url.hostname!=='ikigai-shidoroku.pages.dev'||(origin&&origin!==url.origin))return {status:403,message:'本番の公開サイトから利用してください。'};
  const bearer=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s]+$/.test(bearer)||bearer.length>8192)return {status:401,message:'ログインし直してください。'};
  const headers={apikey:PUBLIC_KEY,Authorization:bearer};
  // Both services validate the same bearer; neither result alone grants access.
  const [who,member]=await Promise.all([
    readCheck('/auth/v1/user',{headers},'AUTH'),
    readCheck('/rest/v1/rpc/is_member',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'},'MEMBER')
  ]);
  if(who.failure)return who.failure;
  if(!who.ok){if(who.status===401)return {status:401,message:'ログインし直してから、もう一度お試しください。'};return issue('AUTH',String(who.status));}
  if(!who.body?.id)return issue('AUTH','FORMAT');
  if(member.failure)return member.failure;
  if(!member.ok){
    if(member.status===401)return {status:401,message:'ログインし直してから、もう一度お試しください。'};
    const code=typeof member.body?.code==='string'&&/^[A-Z0-9_]{1,24}$/.test(member.body.code)?'_'+member.body.code:'';
    return issue('MEMBER',String(member.status)+code);
  }
  if(member.body!==true){if(member.body===false)return {status:403,message:'管理者の承認後に使えます。'};return issue('MEMBER','FORMAT');}
  return {ok:true,uid:who.body.id,email:typeof who.body.email==='string'?who.body.email:''};
}

export async function requireYoutubeHost(request){
  const member=await requireYoutubeMember(request);if(!member.ok)return member;
  const host=await readCheck('/rest/v1/rpc/is_host',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:request.headers.get('Authorization'),'Content-Type':'application/json'},body:'{}'},'HOST');
  if(host.failure)return host.failure;
  if(!host.ok)return issue('HOST',String(host.status));
  return host.body===true?member:{status:403,message:'チャンネル設定は管理者のみ変更できます。'};
}

// Account settings remain available to signed-in users awaiting membership approval.
export async function requireAccountUser(request){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(url.protocol!=='https:'||url.hostname!=='ikigai-shidoroku.pages.dev'||(origin&&origin!==url.origin))return {status:403,message:'本番の公開サイトから利用してください。'};
  const bearer=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s]+$/.test(bearer)||bearer.length>8192)return {status:401,message:'ログインし直してください。'};
  const who=await readCheck('/auth/v1/user',{headers:{apikey:PUBLIC_KEY,Authorization:bearer}},'AUTH');
  if(who.failure)return who.failure;
  if(!who.ok||typeof who.body?.id!=='string')return {status:who.status===401?401:503,message:'ログイン状態を確認できませんでした。'};
  return {ok:true,uid:who.body.id,email:typeof who.body.email==='string'?who.body.email:''};
}

export async function requireMemberRole(request){
  const member=await requireYoutubeMember(request);if(!member.ok)return member;
  const result=await readCheck('/rest/v1/rpc/is_host',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:request.headers.get('Authorization'),'Content-Type':'application/json'},body:'{}'},'HOST');
  if(result.failure)return result.failure;if(!result.ok||typeof result.body!=='boolean')return {status:503,message:'権限を確認できませんでした。'};
  return {...member,isHost:result.body};
}
// Sending needs only admission, not decryption of every member's display name.
export async function readPrivateChatRosterIds(request){
  const result=await readCheck('/rest/v1/rpc/ikigai_admin_member_status_v1?select=user_id',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:request.headers.get('Authorization'),'Content-Type':'application/json'},body:'{}'},'ROSTER');
  if(result.failure||!result.ok||!Array.isArray(result.body))throw Error('roster unavailable');return result.body;
}
export async function readPrivateChatRoster(request,env){
  return privateRoster(request,env);
}

export async function readNotificationDocument(request,path){
  const query=new URLSearchParams({select:'data',path:'eq.'+path});
  const result=await readCheck('/rest/v1/documents?'+query,{headers:{apikey:PUBLIC_KEY,Authorization:request.headers.get('Authorization')}},'DOCUMENT');
  if(result.failure||!result.ok||!Array.isArray(result.body))throw Error('document unavailable');return result.body[0]?.data||null;
}

export async function readChatAccessSince(request){
  const result=await readCheck('/rest/v1/rpc/ikigai_chat_access_since_v1',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:request.headers.get('Authorization'),'Content-Type':'application/json'},body:'{}'},'CHAT');
  if(result.failure||!result.ok||typeof result.body!=='string'||!Number.isFinite(Date.parse(result.body)))throw Error('admission unavailable');
  return Date.parse(result.body);
}

export async function readVisibleChatRoom(request){
 const result=await readCheck('/rest/v1/rpc/ikigai_chat_room_v1',{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:request.headers.get('Authorization'),'Content-Type':'application/json'},body:'{}'},'CHAT');
 if(result.failure||!result.ok||!Array.isArray(result.body))throw Error('chat unavailable');return result.body;
}
