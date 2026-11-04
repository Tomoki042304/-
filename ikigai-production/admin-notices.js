// Only record IDs and revision markers are persisted in the viewer's private profile.
// Failed reads never replace a successful snapshot or acknowledge unseen content.
export function mountAdminNotices({account,allowed,active,getSeen,saveSeen,load}){
 const sections={applications:'applicationsAdminDot',members:'membersAdminDot',announcements:'announcementsAdminDot',channels:'channelsAdminDot',inquiries:'inquiryAdminDot',knowledge:'knowledgeAdminDot',security:'securityAdminDot'};
 let owner=null,current=new Map(),timer=0,running=null,epoch=0;
 const clean=items=>new Map(items.filter(x=>x&&typeof x.id==='string'&&typeof x.version==='string').map(x=>[x.id,x.version]));
 function reset(){epoch++;owner=account();current=new Map();running=null;render()}
 function ensure(){if(owner!==account())reset();return allowed()&&!!owner}
 function render(){
  let any=false;const receipts=allowed()?getSeen()||{}:{};
  for(const [key,id] of Object.entries(sections)){
   const seen=receipts[key]||{},rows=current.get(key)||new Map();
   const unread=allowed()&&[...rows].some(([id,v])=>seen[id]!==v);any||=unread;
   const dot=document.getElementById(id);if(dot)dot.hidden=!unread;
  }
  const entry=document.getElementById('inquiryEntryDot');if(entry)entry.hidden=!any;
 }
 function update(key,items,{complete=true,viewed=false}={}){
  if(!ensure()||!Object.hasOwn(sections,key)||!Array.isArray(items))return;
  const incoming=clean(items),rows=complete?new Map():new Map(current.get(key));
  for(const [id,v] of incoming)rows.set(id,v);current.set(key,rows);
  if(viewed&&document.visibilityState==='visible'){
   const before=getSeen()||{},seen={...(before[key]||{})};let changed=false;
   for(const [id,v] of incoming)if(seen[id]!==v){seen[id]=v;changed=true}
   // Prune receipts for removed rows only after an authoritative complete read.
   if(complete)for(const id of Object.keys(seen))if(!rows.has(id)){delete seen[id];changed=true}
   if(changed)saveSeen({...before,[key]:seen});
  }
  render();
 }
 async function refresh(){
  if(!ensure()||!active()||document.visibilityState!=='visible')return;
  if(running)return running;
  const token=epoch;const work=Promise.resolve().then(load);running=work;
  try{await work}finally{if(token===epoch)running=null}
 }
 function start(){ensure();if(!timer)timer=setInterval(()=>{void refresh().catch(()=>{})},60000);void refresh().catch(()=>{})}
 function stop(){clearInterval(timer);timer=0;reset();current.clear();render()}
 const resume=()=>{if(document.visibilityState==='visible'){render();void refresh().catch(()=>{})}};
 document.addEventListener('visibilitychange',resume);
 const refreshEvent=e=>{if(active()&&Array.isArray(e.detail?.tasks))e.detail.tasks.push(refresh())};
 window.addEventListener('ikigai-refresh-data',refreshEvent);
 return {update,refresh,start,stop,render};
}
