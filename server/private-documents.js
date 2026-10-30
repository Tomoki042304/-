import {decryptPii} from './pii-crypto.js';
export const ROOT='https://ebozxwiuujrnvmxienat.supabase.co';
const PUBLIC_KEY='sb_publishable_mJ6vFykk8ykbAmm2LaEEuA_Ea5n4yp8';
export async function database(request,path,{method='GET',body,serviceKey}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(ROOT+'/rest/v1/'+path,{method,headers:{apikey:serviceKey||PUBLIC_KEY,Authorization:serviceKey?'Bearer '+serviceKey:request?.headers.get('Authorization'),'Content-Type':'application/json',Prefer:'return=representation,resolution=merge-duplicates'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:controller.signal,redirect:'manual'});
    const result=await response.json().catch(()=>null);
    if(!response.ok){const error=Error('DATABASE_UNAVAILABLE');error.status=response.status;error.code=result?.code;throw error}
    return result;
  }finally{clearTimeout(timer)}
}
export async function privateRoster(request,env){
  const rows=await database(request,'rpc/ikigai_admin_member_status_pii_v1',{method:'POST',body:{}});
  if(!Array.isArray(rows))throw Error('PII_ROSTER_INVALID');
  return Promise.all(rows.map(async row=>{
    const result={...row};delete result.name_cipher;delete result.name_path;delete result.name_field;
    if(row.name_cipher){const name=await decryptPii(env,row.name_path+'#'+row.name_field,row.name_cipher);if(name?.present&&typeof name.value==='string'&&name.value)result.display_name=name.value.slice(0,80)}
    return result;
  }));
}
