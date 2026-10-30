// Private server-only operational storage. Browser roles have no table access.
import {database} from './private-documents.js';
const TABLE='ikigai_runtime_values_v1';
export function runtimeStore(env){
 const serviceKey=env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY;
 const db=async(path,options={})=>{if(typeof serviceKey!=='string'||!serviceKey.startsWith('eyJ'))throw Error('RUNTIME_KEY_UNAVAILABLE');return database(null,path,{...options,serviceKey})};
 const validKey=key=>{if(typeof key!=='string'||!key||new TextEncoder().encode(key).length>512)throw Error('RUNTIME_KEY_INVALID')};
 const cache=new Map(),pending=new Map();let queued=false;
 async function flush(){
  queued=false;const entries=[...pending.entries()];pending.clear();
  const chunks=[];let chunk=[],length=0;
  for(const entry of entries){const size=encodeURIComponent(JSON.stringify(entry[0])).length+1;if(chunk.length&&(length+size>6500||chunk.length>=50)){chunks.push(chunk);chunk=[];length=0}chunk.push(entry);length+=size}if(chunk.length)chunks.push(chunk);
  await Promise.all(chunks.map(async group=>{
   try{
    const query=new URLSearchParams({select:'key,value,expires_at',key:'in.('+group.map(([key])=>JSON.stringify(key)).join(',')+')',limit:String(group.length)});
    const rows=await db(TABLE+'?'+query);if(!Array.isArray(rows))throw Error('RUNTIME_READ_INVALID');
    const found=new Map(rows.map(row=>[row.key,row]));for(const [key,waiters] of group){const row=found.get(key)||null;cache.set(key,row);for(const waiter of waiters)waiter.resolve(row)}
   }catch(error){for(const [,waiters] of group)for(const waiter of waiters)waiter.reject(error)}
  }));
 }
 async function readRow(key){if(cache.has(key))return cache.get(key);return new Promise((resolve,reject)=>{if(!pending.has(key))pending.set(key,[]);pending.get(key).push({resolve,reject});if(!queued){queued=true;queueMicrotask(flush)}})}
 return {
  async get(key,type){
   validKey(key);const row=await readRow(key);
   if(!row||row.expires_at&&Date.parse(row.expires_at)<=Date.now())return null;
   if(typeof row.value!=='string')throw Error('RUNTIME_VALUE_INVALID');return type==='json'?JSON.parse(row.value):row.value;
  },
  async put(key,value,options={}){
   validKey(key);if(typeof value!=='string')throw Error('RUNTIME_VALUE_INVALID');
   const expiry=Number.isFinite(options?.expiration)?options.expiration*1000:Number.isFinite(options?.expirationTtl)?Date.now()+options.expirationTtl*1000:null;
   const row={key,value,expires_at:expiry===null?null:new Date(expiry).toISOString(),updated_at:new Date().toISOString()};await db(TABLE+'?on_conflict=key',{method:'POST',body:row});cache.set(key,row);
  },
  async delete(key){validKey(key);await db(TABLE+'?'+new URLSearchParams({key:'eq.'+key}),{method:'DELETE'});cache.set(key,null)},
  async list({prefix='',limit=1000,cursor}={}){
   if(typeof prefix!=='string'||prefix.length>512||!Number.isInteger(limit)||limit<1||limit>1000)throw Error('RUNTIME_LIST_INVALID');
   let after='';if(cursor){try{if(typeof cursor!=='string'||cursor.length>4096)throw Error();const parsed=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));if(parsed.prefix!==prefix||typeof parsed.after!=='string'||!parsed.after.startsWith(prefix))throw Error();after=parsed.after}catch{throw Error('RUNTIME_CURSOR_INVALID')}}
   const query=new URLSearchParams({select:'key,value,expires_at',order:'key.asc',limit:String(limit),or:'(expires_at.is.null,expires_at.gt.'+new Date().toISOString()+')'});
   if(prefix){query.append('key','gte.'+prefix);query.append('key','lt.'+prefix+'\uffff')}
   if(after)query.append('key','gt.'+after);
   const rows=await db(TABLE+'?'+query);if(!Array.isArray(rows))throw Error('RUNTIME_LIST_INVALID');for(const row of rows)cache.set(row.key,row);
   const complete=rows.length<limit,keys=rows.slice(0,limit).map(row=>({name:row.key,...(row.expires_at?{expiration:Math.floor(Date.parse(row.expires_at)/1000)}:{})}));
   return {keys,list_complete:complete,cursor:complete?'':btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({prefix,after:keys.at(-1).name})))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
  }
 };
}
export function operationalStore(env){
 const store=env.RUNTIME_STORAGE==='supabase'?runtimeStore(env):env.YT_CACHE;
 if(env.RUNTIME_TRANSFER_LOCK!=='locked'||!store)return store;
 return {get:(...args)=>store.get(...args),list:(...args)=>store.list(...args),put:async()=>{throw Error('RUNTIME_TRANSFER_LOCKED')},delete:async()=>{throw Error('RUNTIME_TRANSFER_LOCKED')}};
}
