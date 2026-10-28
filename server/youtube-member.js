const URL_ROOT='https://ebozxwiuujrnvmxienat.supabase.co';
const PUBLIC_KEY='sb_publishable_mJ6vFykk8ykbAmm2LaEEuA_Ea5n4yp8';
export async function requireYoutubeMember(request){
  const url=new URL(request.url),origin=request.headers.get('Origin');
  if(url.protocol!=='https:'||url.hostname!=='ikigai-shidoroku.pages.dev'||(origin&&origin!==url.origin))return {status:403,message:'本番の公開サイトから利用してください。'};
  const bearer=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s]+$/.test(bearer)||bearer.length>8192)return {status:401,message:'ログインし直してください。'};
  const headers={apikey:PUBLIC_KEY,Authorization:bearer},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
    const who=await fetch(URL_ROOT+'/auth/v1/user',{headers,signal:controller.signal,redirect:'error'});
    if(!who.ok||!(await who.json())?.id)return {status:401,message:'ログイン状態を確認してください。'};
    const member=await fetch(URL_ROOT+'/rest/v1/rpc/is_member',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:controller.signal,redirect:'error'});
    if(!member.ok)throw Error('membership');
    if(await member.json()!==true)return {status:403,message:'管理者の承認後に使えます。'};
    return {ok:true};
  }catch{return {status:503,message:'利用資格を確認できません。時間をおいてお試しください。'}}
  finally{clearTimeout(timer)}
}
