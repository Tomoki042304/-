import {runtimeStore} from './supabase-runtime.js';
import {encryptPii,decryptPii} from './pii-crypto.js';
const PREFIXES=['inquiry:','inquiry-history:','dm:','reaction:','announcement:','push:'];
const protectedKey=key=>key.startsWith('inquiry:v1:')||key.startsWith('inquiry-history:v1:')||key.startsWith('dm:thread:v1:');
const LOCK='storage-transfer:lock:v1';
async function opened(env,key,value){const parsed=JSON.parse(value);return parsed?.format==='ikigai-pii'?decryptPii(env,key,parsed):parsed}
export async function transferStorage(env,body){
 const target=runtimeStore(env),source=env.YT_CACHE;
 if(body.action==='runtime-status'){
  let targetReady=false;try{await target.list({prefix:'__storage_probe__',limit:1});targetReady=true}catch{}
  return {targetReady,active:env.RUNTIME_STORAGE==='supabase',locked:env.RUNTIME_TRANSFER_LOCK==='locked'};
 }
 if(env.RUNTIME_TRANSFER_LOCK!=='locked')throw Error('移行中の書き込み停止設定が必要です。');
 if(!source?.get||!source?.list||!source?.put)throw Error('元の保存先を確認できませんでした。');
 let lock=await source.get(LOCK,'json');
 if(!lock||!Number.isFinite(lock.at)){await source.put(LOCK,JSON.stringify({at:Date.now()}));throw Error('書き込み停止を確認中です。2分後に再試行してください。')}
 if(Date.now()-lock.at<120000)throw Error('書き込み停止を確認中です。2分後に再試行してください。');
 if(body.cursor&&(typeof body.cursor!=='string'||body.cursor.length>4096))throw Error('移行位置を確認してください。');
 let page;try{page=await source.list({prefix:'',limit:10,...(body.cursor?{cursor:body.cursor}:{})})}catch{throw Error('元の保存先の一覧取得が制限されています。日本時間の朝9時以降に再試行してください。')}
 let copied=0,verified=0,missing=0;
 for(const entry of page.keys){
  if(!PREFIXES.some(prefix=>entry.name.startsWith(prefix)))continue;
  if(entry.expiration&&entry.expiration*1000<=Date.now())continue;
  const original=await source.get(entry.name);if(original===null)continue;
  const existing=await target.get(entry.name);
  let expected=original;
  if(protectedKey(entry.name)){
   const parsed=JSON.parse(original);
   if(parsed?.format==='ikigai-pii')await decryptPii(env,entry.name,parsed);
   else expected=JSON.stringify(await encryptPii(env,entry.name,parsed));
  }
  const same=existing!==null&&(existing===expected||(protectedKey(entry.name)&&JSON.stringify(await opened(env,entry.name,existing))===JSON.stringify(await opened(env,entry.name,expected))));
  if(existing!==null&&!same)throw Error('移行先に異なる内容があります。上書きせず停止しました。');
  if(body.action==='runtime-verify'){if(!same)missing++;else verified++;continue}
  if(body.action!=='runtime-copy')throw Error('操作を確認してください。');
  if(!same){await target.put(entry.name,expected,entry.expiration?{expiration:entry.expiration}:undefined);copied++}
 }
 return {copied,verified,missing,cursor:page.list_complete?null:page.cursor,done:page.list_complete};
}
