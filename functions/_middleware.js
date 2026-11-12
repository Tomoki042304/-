import {maintenanceState,maintenanceResponse} from '../server/maintenance.js';
export async function onRequest(context){
 const path=new URL(context.request.url).pathname;
 let response;
 if(path.startsWith('/api/')&&path!=='/api/maintenance'){
  try{const state=await maintenanceState(context.env);if(state.active)response=maintenanceResponse(state)}
  catch{response=Response.json({code:'MAINTENANCE_STATUS_UNAVAILABLE',message:'利用状態を確認できません。少し待ってから再試行してください。'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}})}
 }
 if(!response)response=await context.next();
 response=new Response(response.body,response);
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
 response.headers.set('X-Frame-Options','DENY');
 // Existing scripts/fonts remain compatible. Prevent framing, plugin objects and base-URL injection.
 response.headers.set('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
 if(path.startsWith('/api/'))response.headers.set('Cache-Control','no-store');
 return response;
}
