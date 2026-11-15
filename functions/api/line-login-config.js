// Public rollout switch only. The LINE secret belongs in Supabase Auth, never here.
export async function onRequest({request,env}) {
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 if(request.method!=='GET')return Response.json({enabled:false},{status:405,headers:{...headers,Allow:'GET'}});
 if(new URL(request.url).origin!=='https://ikigai-shidoroku.pages.dev')return Response.json({enabled:false},{status:403,headers});
 return Response.json({enabled:env.IKIGAI_LINE_LOGIN_READY==='true'},{headers});
}
