import {operationalStore} from './supabase-runtime.js';
import {encryptPii,decryptPii} from './pii-crypto.js';
const UUID='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const profile=new RegExp('^data/users/'+UUID+'/profile$'),application=new RegExp('^applications/'+UUID+'$'),member=new RegExp('^members/'+UUID+'$');
export function privateFields(path){
  if(profile.test(path)||member.test(path))return ['nick','aff'];
  if(application.test(path))return ['name','email','referrer','age','job','sns','reason'];
  return null;
}
export function privateCollection(path){return path==='members'||path==='applications'}
export async function sealDocument(env,path,value){
  const fields=privateFields(path);if(!fields)throw Error('PII_PATH_INVALID');
  if(!value||typeof value!=='object'||Array.isArray(value)||value._pii||value._piiVersion)throw Error('PII_INPUT_INVALID');
  const data={...value},sealed={};
  for(const field of fields){sealed[field]=await encryptPii(env,path+'#'+field,{present:Object.hasOwn(data,field),value:data[field]??null});delete data[field]}
  return {...data,_piiVersion:1,_pii:sealed};
}
export async function openDocument(env,path,value){
  if(!value||!privateFields(path))throw Error('PII_PATH_INVALID');
  if(!value._piiVersion&&!value._pii)return value; // Legacy, until the verified migration finishes.
  if(value._piiVersion!==1||!value._pii)throw Error('PII_FORMAT_INVALID');
  const data={...value};delete data._pii;delete data._piiVersion;
  for(const field of privateFields(path)){
    const opened=await decryptPii(env,path+'#'+field,value._pii[field]);
    if(!opened||typeof opened.present!=='boolean')throw Error('PII_FORMAT_INVALID');
    delete data[field];if(opened.present)data[field]=opened.value;
  }
  return data;
}
// Keep the existing key names and authorization decisions. No plaintext fallback on writes.
export function privateKv(env){
  const raw=operationalStore(env);
  const protectedKey=key=>key.startsWith('inquiry:v1:')||key.startsWith('inquiry-history:v1:')||key.startsWith('dm:thread:v1:');
  return {
    get:async(key,type)=>{if(!protectedKey(key))return raw.get(key,type);const value=await raw.get(key,'json');if(value==null)return null;const data=value.format==='ikigai-pii'?await decryptPii(env,key,value):value;return type==='json'?data:JSON.stringify(data)},
    put:async(key,value,options)=>raw.put(key,protectedKey(key)?JSON.stringify(await encryptPii(env,key,JSON.parse(value))):value,options),
    list:async options=>{
      try{return await raw.list(options)}catch(error){
        const message=String(error?.message||'');
        if(/(?:limit|quota|too many|exceed)/i.test(message))throw Error('KV_LIST_LIMIT');
        throw error;
      }
    },delete:key=>raw.delete(key)
  };
}
export const KV_PRIVATE_PREFIXES=['inquiry:v1:','inquiry-history:v1:','dm:thread:v1:'];
