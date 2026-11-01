export function mountTalkLayout(){
 const view=document.querySelector('#v-mates'),header=document.querySelector('header.top'),tabs=document.querySelector('nav.tabs');let frame=0;
 function fit(){
  const open=!view.hidden&&!document.querySelector('#app').hidden;document.body.classList.toggle('talk-open',open);
  if(!open){document.body.classList.remove('talk-keyboard');return}
  const viewport=window.visualViewport,offset=viewport?.offsetTop||0,height=viewport?.height||innerHeight;
  const editing=view.contains(document.activeElement)&&document.activeElement.matches('textarea,input'),keyboard=editing&&innerHeight-height>140;
  document.body.classList.toggle('talk-keyboard',keyboard);
  const top=keyboard?offset:Math.max(offset,header.getBoundingClientRect().bottom)+4;
  const bottom=offset+height-(keyboard?4:tabs.getBoundingClientRect().height+4);
  const logs=[...view.querySelectorAll('#chatLog,#groupMessages,#dmMessages')],sticks=logs.map(log=>log.scrollHeight-log.scrollTop-log.clientHeight<70);
  view.style.setProperty('--talk-menu-top',Math.ceil(view.firstElementChild.getBoundingClientRect().height)+'px');view.style.setProperty('--talk-top',top+'px');view.style.setProperty('--talk-height',Math.max(120,bottom-top)+'px');
  requestAnimationFrame(()=>logs.forEach((log,i)=>{if(sticks[i])log.scrollTop=log.scrollHeight}));
 }
 function schedule(){cancelAnimationFrame(frame);frame=requestAnimationFrame(fit)}
 for(const el of [view,document.querySelector('#app')])new MutationObserver(schedule).observe(el,{attributes:true,attributeFilter:['hidden']});
 const observer=new ResizeObserver(schedule);for(const el of [header,tabs,view.firstElementChild])observer.observe(el);
 window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
 view.addEventListener('focusin',schedule);view.addEventListener('focusout',schedule);
 view.addEventListener('input',event=>{const el=event.target;if(['giveFreeText','groupText','dmInput'].includes(el.id)){el.style.height='42px';el.style.height=Math.min(96,Math.max(42,el.scrollHeight))+'px'}});
 schedule();return {fit:schedule};
}
