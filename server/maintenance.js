import {database} from './private-documents.js';
export function maintenanceWindow(now=Date.now()){
 const shifted=new Date(now+9*3600000),minute=shifted.getUTCHours()*60+shifted.getUTCMinutes(),day=shifted.toISOString().slice(0,10),start=Date.parse(day+'T02:00:00+09:00'),end=start+1800000;
 return {serverNow:new Date(now).toISOString(),day,inWindow:minute>=120&&minute<150,start:new Date(start).toISOString(),end:new Date(end).toISOString(),nextStart:new Date(now<start?start:start+86400000).toISOString(),timezone:'Asia/Tokyo'};
}
let cached=null,pending=null;
export async function maintenanceState(env,now=Date.now()){
 const window=maintenanceWindow(now);let config;
 if(cached&&cached.until>now)config=cached.value;
 else if(pending)config=await pending;
 else{pending=(async()=>{try{return await database(null,'rpc/ikigai_maintenance_state_v1',{method:'POST',body:{},serviceKey:env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY})}catch(error){if(['PGRST202','42883'].includes(error?.code))return {configured:false,enabled:true,criticalHold:false,holdOnCritical:false};throw error}})();try{config=await pending;cached={until:now+5000,value:config}}finally{pending=null}}
 if(!config||typeof config.configured!=='boolean')throw Error('MAINTENANCE_STATE_UNAVAILABLE');
 return {...window,configured:config.configured,enabled:config.enabled!==false,criticalHold:config.criticalHold===true,holdOnCritical:config.holdOnCritical===true,lastCheckedAt:config.lastCheckedAt||null,active:config.criticalHold===true||(config.enabled!==false&&window.inWindow)};
}
export function maintenanceResponse(state){return Response.json({code:'APP_MAINTENANCE',message:state.criticalHold?'点検で重要な異常が確認されたため、管理者の確認を待っています。':'毎日2:00〜2:30（日本時間）はシステム点検のため利用できません。',...state},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30','X-Content-Type-Options':'nosniff'}})}
export function clearMaintenanceCache(){cached=null}
