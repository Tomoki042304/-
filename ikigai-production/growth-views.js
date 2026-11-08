// Viewer identities are requested only when an administrator opens a post's panel.
export function mountGrowthViews({account,canUse,isAdmin,request}){
 const feed=document.getElementById('feed');let owner=account(),epoch=0,busy=false,retry=0,scanFrame=0;const seen=new Set(),queue=new Map(),timers=new Map(),visible=new Set(),panels=new Map();
 const key=t=>t.author+':'+t.id;
 const target=node=>{const value=node.closest('[data-post-key]')?.dataset.postKey||'';return /^[0-9a-f-]{36}:./i.test(value)?{author:value.slice(0,36),id:value.slice(37)}:null};
 const active=()=>canUse()&&account()&&document.visibilityState==='visible'&&!document.getElementById('app').hidden&&!document.getElementById('v-timeline').hidden;
 function clearTimers(){for(const timer of timers.values())clearTimeout(timer);timers.clear();visible.clear()}
 async function flush(){
  clearTimeout(retry);retry=0;if(busy||!active()||!queue.size)return;
  const who=account(),version=epoch,items=[...queue.values()].slice(0,20);busy=true;
  try{const data=await request({action:'mark',targets:items});if(account()!==who||epoch!==version)return;const accepted=new Set((data.accepted||[]).map(key));for(const t of items){queue.delete(key(t));if(accepted.has(key(t)))seen.add(key(t))}}
  catch(error){if(account()===who&&epoch===version&&[401,403].includes(error.status))queue.clear()}finally{if(epoch===version){busy=false;if(queue.size)retry=setTimeout(flush,5000)}}
 }
 function arm(node){
  const t=target(node);if(!t||!active()||seen.has(key(t))||queue.has(key(t))||timers.has(node))return;
  timers.set(node,setTimeout(()=>{timers.delete(node);if(!active()||!node.isConnected||!visible.has(node))return;queue.set(key(t),t);void flush()},1000));
 }
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting&&e.intersectionRatio>=.1){visible.add(e.target);arm(e.target)}else{visible.delete(e.target);clearTimeout(timers.get(e.target));timers.delete(e.target)}}},{threshold:.1,rootMargin:'-70px 0px -85px 0px'}):null;
 function paintList(box,state){
  box.replaceChildren();for(const person of state.rows){const row=document.createElement('div');row.className='post-responder';const icon=document.createElement('div');icon.className='avatar';icon.style.backgroundColor='#7a1f33';icon.setAttribute('role','img');icon.setAttribute('aria-label',(person.name||'メンバー')+'のプロフィール');if(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(person.avatar||'')){const img=document.createElement('img');img.src=person.avatar;img.alt='';icon.append(img)}else icon.textContent=Array.from(person.name||'会員')[0];const name=document.createElement('b');name.textContent=person.name||'メンバー';row.append(icon,name);box.append(row)}
  if(!state.rows.length){const note=document.createElement('p');note.className='muted';note.textContent='記録された閲覧はまだありません。';box.append(note)}
 }
 function decorate(article){
  let panel=article.querySelector('.post-viewers');if(!isAdmin()){panel?.remove();return}if(panel)return;
  const responders=article.querySelector('.post-responders'),t=target(article);if(!responders||!t)return;
  let tools=responders.parentElement;if(!tools.classList.contains('post-response-tools')){tools=document.createElement('div');tools.className='post-response-tools';responders.before(tools);tools.append(responders)}
  const state=panels.get(key(t))||{open:false,rows:[],loaded:false};panels.set(key(t),state);
  panel=document.createElement('details');panel.className='post-viewers';panel.open=state.open;
  const summary=document.createElement('summary');summary.className='channel-summary';const title=document.createElement('span');title.textContent=state.loaded?'閲覧（'+state.rows.length+'人）':'閲覧';const plus=document.createElement('span');plus.className='channel-expand';summary.append(title,plus);
  const box=document.createElement('div');box.className='post-responders-list';const status=document.createElement('p');status.className='muted post-view-status';status.setAttribute('role','status');const more=document.createElement('button');more.type='button';more.className='small-btn';more.hidden=true;more.textContent='もっと見る';
  panel.append(summary,status,box,more);tools.append(panel);
  let loading=false;
  async function load(append=false){
   if(!panel.open||!isAdmin()||loading)return;loading=true;status.textContent='読み込んでいます…';more.disabled=true;const who=account(),version=epoch;
   try{const data=await request({action:'list',target:t,...(append&&state.cursor?{cursor:state.cursor}:{})});if(who!==account()||version!==epoch||!isAdmin()||!panel.isConnected)return;
    state.rows=[...new Map([...(append?state.rows:[]),...(data.rows||[])].map(r=>[r.uid,r])).values()];state.cursor=data.cursor;state.loaded=true;title.textContent='閲覧（'+state.rows.length+(state.cursor?'人以上':'人')+'）';paintList(box,state);status.textContent='この機能の追加後に記録された閲覧です。';more.hidden=!state.cursor;
   }catch(error){if(who===account()&&version===epoch&&panel.isConnected){if(error.status===403){state.rows=[];box.replaceChildren()}status.textContent=error.message||'取得できませんでした。閉じてから、もう一度開いてください。'}}finally{loading=false;more.disabled=false}
  }
  panel.addEventListener('toggle',()=>{state.open=panel.open;if(panel.open)void load()});more.onclick=()=>void load(true);if(panel.open){if(state.loaded)paintList(box,state);void load()}
 }
 function reset(){epoch++;busy=false;seen.clear();queue.clear();panels.clear();clearTimeout(retry);retry=0;clearTimers();observer?.disconnect();feed.querySelectorAll('.post-viewers').forEach(p=>p.remove());owner=account()}
 function scan(){
  scanFrame=0;if(owner!==account())reset();if(!isAdmin()){panels.clear();feed.querySelectorAll('.post-viewers').forEach(p=>p.remove())}
  observer?.disconnect();clearTimers();if(!canUse())return;
  for(const article of feed.querySelectorAll('.post')){decorate(article);const text=article.querySelector('.text');if(text&&active())observer?.observe(text)}
  if(active())void flush();
 }
 function schedule(){if(!scanFrame)scanFrame=requestAnimationFrame(scan)}
 new MutationObserver(schedule).observe(feed,{childList:true});
 for(const id of ['app','v-timeline'])new MutationObserver(schedule).observe(document.getElementById(id),{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('visibilitychange',()=>{clearTimers();schedule()});window.addEventListener('pagehide',()=>{clearTimers();clearTimeout(retry)});window.addEventListener('pageshow',schedule);
 schedule();return {refresh:schedule,stop:reset};
}
