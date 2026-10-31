import {runtimeStore} from './supabase-runtime.js';
import {database} from './private-documents.js';
import {encryptPii,decryptPii} from './pii-crypto.js';
const DOC='shin-knowledge:document:v1:',INDEX='shin-knowledge:index:v1:';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function ready(env){if(env.RUNTIME_STORAGE!=='supabase')throw Error('KNOWLEDGE_SETUP');if(env.RUNTIME_TRANSFER_LOCK==='locked')throw Error('KNOWLEDGE_LOCKED');}
export function terms(text){
 const normalized=text.normalize('NFKC').toLowerCase(),counts=new Map();
 for(const word of normalized.match(/[\p{L}\p{N}]+/gu)||[]){
  const characters=Array.from(word);const units=/^[a-z0-9]+$/.test(word)?[word]:characters.slice(0,-1).map((_,i)=>characters[i]+characters[i+1]);
  for(const unit of units)if(unit.length>1)counts.set(unit,(counts.get(unit)||0)+1);
 }
 return [...counts].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);
}
async function hashes(words){return Promise.all(words.map(async word=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(word)))).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('')))}
async function read(store,env,id){const key=DOC+id,envelope=await store.get(key,'json');return envelope?decryptPii(env,key,envelope):null;}
export async function manageKnowledge(env,body,actor){
 ready(env);const store=runtimeStore(env);
 if(body.action==='list'){
  if(body.cursor!==undefined&&(typeof body.cursor!=='string'||body.cursor.length>4096))throw Error('KNOWLEDGE_INPUT');
  const page=await store.list({prefix:DOC,limit:10,...(body.cursor?{cursor:body.cursor}:{})});
  const records=await Promise.all(page.keys.map(async k=>{const r=await read(store,env,k.name.slice(DOC.length));return r?{id:r.id,title:r.title,active:r.active,updatedAt:r.updatedAt,length:r.text.length}:null}));
  return {records:records.filter(Boolean),cursor:page.list_complete?null:page.cursor};
 }
 if(body.action!=='save'&&!ID.test(body.id||''))throw Error('KNOWLEDGE_INPUT');
 if(body.action==='get'){const record=await read(store,env,body.id);if(!record)throw Error('KNOWLEDGE_NOT_FOUND');return {record};}
 if(body.action==='delete'){await store.delete(DOC+body.id);await store.delete(INDEX+body.id);return {deleted:true};}
 if(body.action==='save'){
  if(body.id!==undefined&&!ID.test(body.id)||body.requestId!==undefined&&!ID.test(body.requestId))throw Error('KNOWLEDGE_INPUT');
  if(typeof body.title!=='string'||!body.title.trim()||body.title.length>100||typeof body.text!=='string'||!body.text.trim()||body.text.length>50000||typeof body.active!=='boolean')throw Error('KNOWLEDGE_INPUT');
  const id=body.id||body.requestId||crypto.randomUUID(),old=await read(store,env,id);
  if(!body.id&&old&&(old.title!==body.title.trim()||old.text!==body.text.trim()||old.active!==body.active))throw Error('KNOWLEDGE_INPUT');
  if(body.id&&!old)throw Error('KNOWLEDGE_NOT_FOUND');
  const record={id,title:body.title.trim(),text:body.text.trim(),active:body.active,createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),updatedBy:actor};
  await store.put(DOC+id,JSON.stringify(await encryptPii(env,DOC+id,record)));
  // The searchable index contains token hashes, never transcript text or titles.
  if(record.active)await store.put(INDEX+id,JSON.stringify(await hashes([...new Set([...terms(record.title),...terms(record.text)])].slice(0,2000))));
  else await store.delete(INDEX+id);
  return {id};
 }
 throw Error('KNOWLEDGE_INPUT');
}
export async function knowledgeContext(env,question){
 ready(env);const words=terms(question).slice(0,12);if(!words.length)return '';
 const tokens=await hashes(words),query=new URLSearchParams({select:'key',key:'like.'+INDEX+'*',or:'('+tokens.map(t=>'value.like.*'+t+'*').join(',')+')',order:'updated_at.desc',limit:'8'});
 const rows=await database(null,'ikigai_runtime_values_v1?'+query,{serviceKey:env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY});if(!Array.isArray(rows))throw Error('KNOWLEDGE_READ');
 const store=runtimeStore(env),records=await Promise.all(rows.map(row=>read(store,env,row.key.slice(INDEX.length))));
 const passages=[];
 for(const record of records){if(!record?.active)continue;const blocks=record.text.match(/[\s\S]{1,700}/g)||[];
  for(let i=0;i<blocks.length;i++){const text=blocks[i],normalized=(record.title+' '+text).normalize('NFKC').toLowerCase();const score=words.reduce((sum,w)=>sum+(normalized.includes(w)?1:0),0);if(score)passages.push({score,title:record.title,text,position:i});}
 }
 return passages.sort((a,b)=>b.score-a.score||a.position-b.position).slice(0,5).map(p=>JSON.stringify({title:p.title,excerpt:p.text})).join('\n').slice(0,4500);
}
