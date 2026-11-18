const KEY='ikigai.home-line-resume.v1';
// This marker contains no account identifiers or tokens. Each browser keeps its own session.
export function createHomeLineResume({enabled,standalone,callback,storage,onResume,schedule=fn=>setTimeout(fn,0)}){
 let ready=false,initial=false,blocked=false,queued=false;
 const applicable=enabled&&standalone;
 function mark(){try{storage.setItem(KEY,'done')}catch{}}
 function attempt(){
  if(!applicable||!ready||!initial||blocked||queued||callback)return;
  try{if(storage.getItem(KEY))return;storage.setItem(KEY,'started')}catch{return}
  queued=true;schedule(()=>{if(!blocked)onResume()});
 }
 return {
  ready(){ready=true;attempt()},
  auth(event,session){
   if(!applicable)return;
   if(session){blocked=true;mark();return}
   if(event==='SIGNED_OUT'||event==='PASSWORD_RECOVERY'){blocked=true;mark();return}
   if(event==='INITIAL_SESSION'){initial=true;attempt()}
  }
 };
}
