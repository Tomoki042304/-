// Public rollout metadata only. Never expose mail credentials or account identities.
const ROOT='https://ebozxwiuujrnvmxienat.supabase.co';
const KEY='sb_publishable_mJ6vFykk8ykbAmm2LaEEuA_Ea5n4yp8';
export async function onRequest({request,env}){
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 if(request.method!=='GET')return Response.json({enabled:false},{status:405,headers:{...headers,Allow:'GET'}});
 const url=new URL(request.url);
 if(url.origin!=='https://ikigai-shidoroku.pages.dev')return Response.json({enabled:false},{status:403,headers});
 const siteKey=env.IKIGAI_LOGIN_TURNSTILE_SITE_KEY;
 if(env.IKIGAI_EMAIL_LOGIN_READY!=='true'||typeof siteKey!=='string'||!/^[A-Za-z0-9_-]{10,100}$/.test(siteKey))return Response.json({enabled:false},{headers});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
 try{
  const response=await fetch(ROOT+'/rest/v1/rpc/ikigai_login_security_ready_v1',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:'{}',signal:controller.signal,redirect:'manual'});
  const ready=response.ok&&await response.json()===true;
  return Response.json(ready?{enabled:true,siteKey}:{enabled:false},{headers});
 }catch{return Response.json({enabled:false},{headers})}finally{clearTimeout(timer)}
}
