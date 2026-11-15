// In-app acknowledgement is separate from message read receipts and OS push badges.
// Each bell/tab pair shares the same immutable event version; later updates light it again.
export const threadNoticeVersion=thread=>Array.isArray(thread.incomingIds)
 ? JSON.stringify([...new Set(thread.incomingIds)].sort()) : String(thread.updatedAt||'');

export function createNotificationState({getSeen=()=>({}),onSeen=()=>{},onChange=()=>{}}={}){
 const sources=new Map();
 const key=(source,id)=>source+':'+id;
 const all=()=>[...sources.values()].flat();
 const isUnread=(source,id,version)=>getSeen()?.[key(source,id)]!==String(version);
 function publish(source,rows){
  const next=rows.filter(row=>row&&typeof row.id==='string'&&row.version!=null&&['home','timeline','mates','account'].includes(row.target))
   .map(row=>({...row,source,version:String(row.version),key:key(source,row.id),count:Math.max(1,Number(row.count)||1)}));
  const signature=items=>JSON.stringify(items.map(({open,...row})=>row));
  const changed=signature(sources.get(source)||[])!==signature(next);sources.set(source,next);if(changed)onChange();
 }
 const unread=()=>all().filter(row=>isUnread(row.source,row.id,row.version));
 function acknowledge(rows=all()){
  const seen={...getSeen()},current=new Map(all().map(row=>[row.key,row]));let changed=false;
  for(const row of rows){if(current.get(row.key)?.version!==row.version||seen[row.key]===row.version)continue;delete seen[row.key];seen[row.key]=row.version;changed=true}
  if(changed){const entries=Object.entries(seen),past=entries.filter(([id])=>!current.has(id)).slice(-300),live=entries.filter(([id])=>current.has(id));onSeen(Object.fromEntries([...past,...live]));onChange()}
 }
 function read(scope={}){
  const before=Number.isFinite(scope.before)?scope.before:Date.now();
  acknowledge(all().filter(row=>{
   if(Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)>before)return false;
   if(scope.all===true)return true;
   const keys=['threadId','groupId','postKey','announcementId'].filter(field=>typeof scope[field]==='string');
   const targeted=keys.length||scope.publicTalk===true;
   const matches=keys.some(field=>row[field]===scope[field])||(scope.publicTalk===true&&row.publicTalk===true);
   return (!targeted||matches)&&(!Array.isArray(scope.kinds)||scope.kinds.includes(row.kind))&&(targeted||Array.isArray(scope.kinds));
  }));
 }
 return {publish,all,unread,isUnread,acknowledge,read,readTarget:target=>acknowledge(all().filter(row=>row.target===target)),clear(){sources.clear();onChange()}};
}
