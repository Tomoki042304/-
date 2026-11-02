import {maintenanceState,maintenanceResponse} from '../server/maintenance.js';
export async function onRequest(context){
 const path=new URL(context.request.url).pathname;
 if(!path.startsWith('/api/')||path==='/api/maintenance')return context.next();
 try{const state=await maintenanceState(context.env);if(state.active)return maintenanceResponse(state)}
 catch{return Response.json({code:'MAINTENANCE_STATUS_UNAVAILABLE',message:'利用状態を確認できません。少し待ってから再試行してください。'},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}})}
 return context.next();
}
