const EMOJIS=['👍','❤️‍🔥','😭','🙇‍♂️'],LABELS=['いいね','熱い応援','感動','感謝'];
export function mountMessageReactions({request,account,notify}){
 const roots=[document.querySelector('#chatLog'),document.querySelector('#dmMessages')],cache=new Map(),busy=new Set();let started=false,epoch=0,timer=0,reading=false,openKey='',pressTimer=0,suppressClick=0,failures=0;
 const target=b=>({scope:b.dataset.reactionScope,threadId:b.dataset.reactionThread||'',senderUid:b.dataset.reactionSender,messageId:b.dataset.reactionMessage});
 const key=t=>JSON.stringify([t.scope,t.threadId,t.senderUid,t.messageId]),bubbles=()=>roots.flatMap(root=>[...root.querySelectorAll('[data-reaction-message]')]);
 const host=b=>b.dataset.reactionScope==='group'?b.closest('.body'):b.closest('.dm-row');
 function decorate(){
  for(const b of bubbles()){
   const t=target(b),k=key(t),box=host(b);if(!box)continue;const state=cache.get(k)||{counts:[],mine:''},signature=JSON.stringify([state.counts,state.mine,busy.has(k),openKey===k]);
   if(box.dataset.reactionSignature===signature)continue;box.dataset.reactionSignature=signature;box.querySelectorAll(':scope > .message-reaction-counts,:scope > .message-reaction-picker').forEach(el=>el.remove());
   if(state.counts?.length){const counts=document.createElement('div');counts.className='message-reaction-counts';for(const r of state.counts){if(!EMOJIS.includes(r.emoji)||!Number.isFinite(r.count)||r.count<1)continue;const chip=document.createElement('button');chip.type='button';chip.textContent=r.emoji+' '+r.count;chip.setAttribute('aria-label',LABELS[EMOJIS.indexOf(r.emoji)]+' '+r.count+'人');chip.setAttribute('aria-pressed',String(state.mine===r.emoji));chip.disabled=busy.has(k);chip.onclick=()=>change(t,r.emoji);counts.append(chip)}box.append(counts)}
   if(openKey===k){const picker=document.createElement('div');picker.className='message-reaction-picker';picker.setAttribute('role','group');picker.setAttribute('aria-label','リアクションを選ぶ');EMOJIS.forEach((emoji,i)=>{const button=document.createElement('button');button.type='button';button.textContent=emoji;button.setAttribute('aria-label',LABELS[i]);button.setAttribute('aria-pressed',String(state.mine===emoji));button.disabled=busy.has(k);button.onclick=()=>change(t,emoji);picker.append(button)});box.append(picker)}
  }
 }
 async function change(t,emoji){
  const k=key(t);if(!account()||busy.has(k))return;const old=cache.get(k)||{counts:[],mine:''},selected=old.mine===emoji?'':emoji,counts=new Map((old.counts||[]).map(x=>[x.emoji,x.count]));if(old.mine)counts.set(old.mine,Math.max(0,(counts.get(old.mine)||0)-1));if(selected)counts.set(selected,(counts.get(selected)||0)+1);
  const token=epoch,uid=account();busy.add(k);cache.set(k,{counts:EMOJIS.filter(e=>counts.get(e)>0).map(emoji=>({emoji,count:counts.get(emoji)})),mine:selected});openKey='';decorate();
  try{const data=await request({action:'set',scope:t.scope,...(t.scope==='direct'?{threadId:t.threadId}:{}),target:{senderUid:t.senderUid,messageId:t.messageId},emoji:selected});if(token!==epoch||account()!==uid)return;const state=data.states?.find(s=>s.senderUid===t.senderUid&&s.messageId===t.messageId);if(!state)throw Error('リアクションを確認できませんでした。');cache.set(k,{...state,localUntil:Date.now()+60000})}
  catch(e){if(token===epoch){cache.set(k,old);notify(e.message||'リアクションを保存できませんでした。')}}finally{if(token===epoch){busy.delete(k);decorate()}}
 }
 async function refresh(){
  clearTimeout(timer);if(!started||reading||!account()||document.visibilityState!=='visible')return;const visible=bubbles().filter(b=>b.getClientRects().length).slice(-30),groups=new Map();for(const b of visible){const t=target(b),g=t.scope+'|'+t.threadId;if(!groups.has(g))groups.set(g,[]);groups.get(g).push(t)}
  const token=epoch,uid=account();reading=true;
  try{await Promise.all([...groups.values()].map(async targets=>{const first=targets[0],data=await request({action:'list',scope:first.scope,...(first.scope==='direct'?{threadId:first.threadId}:{}),targets:targets.map(({senderUid,messageId})=>({senderUid,messageId}))});if(token!==epoch||account()!==uid)return;if(!Array.isArray(data.states))return;for(const state of data.states){const k=key({...first,...state}),old=cache.get(k);if(!busy.has(k)&&!(old?.localUntil>Date.now()))cache.set(k,state)}}));if(token===epoch){failures=0;decorate()}}
  catch{if(token===epoch)failures++}finally{if(token===epoch){reading=false;if(started)timer=setTimeout(refresh,failures?Math.min(300000,15000*Math.pow(2,failures)):15000)}}
 }
 for(const root of roots){
  root.addEventListener('click',event=>{const b=event.target.closest('[data-reaction-message]');if(!b||Date.now()<suppressClick)return;const k=key(target(b));openKey=openKey===k?'':k;decorate();void refresh()});
  root.addEventListener('contextmenu',event=>{const b=event.target.closest('[data-reaction-message]');if(!b)return;event.preventDefault();openKey=key(target(b));decorate()});
  root.addEventListener('keydown',event=>{const b=event.target.closest('[data-reaction-message]');if(b&&b.tagName!=='BUTTON'&&['Enter',' '].includes(event.key)){event.preventDefault();const k=key(target(b));openKey=openKey===k?'':k;decorate()}});
  root.addEventListener('pointerdown',event=>{const b=event.target.closest('[data-reaction-message]');if(!b)return;clearTimeout(pressTimer);const k=key(target(b));pressTimer=setTimeout(()=>{openKey=k;suppressClick=Date.now()+700;decorate()},450)});
  for(const event of ['pointerup','pointerleave','pointercancel','pointermove'])root.addEventListener(event,()=>clearTimeout(pressTimer));
 }
 const observer=new MutationObserver(()=>decorate());for(const root of roots)observer.observe(root,{childList:true,subtree:true});
 document.addEventListener('click',event=>{if(!roots.some(root=>event.composedPath().includes(root))){openKey='';decorate()}});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){openKey='';decorate()}});
 document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(started&&document.visibilityState==='visible')void refresh()});
 return {start(){started=true;decorate();void refresh()},stop(){started=false;failures=0;epoch++;clearTimeout(timer);clearTimeout(pressTimer);reading=false;openKey='';cache.clear();busy.clear();decorate()}};
}
