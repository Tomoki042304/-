export function mountShinAI({request,getContext}) {
  const $=s=>document.querySelector(s),log=$('#shinAiLog'),input=$('#shinAiInput'),form=$('#shinAiForm'),send=$('#shinAiSend'),error=$('#shinAiError');
  let history=[],busy=false,controller=null,epoch=0;
  const view=$('#v-ai');
  function fitInput(){input.style.height='44px';input.style.height=Math.min(160,Math.max(44,input.scrollHeight))+'px';}
  function fitViewport(){
    if(view.hidden)return;
    const viewport=window.visualViewport,offset=viewport?.offsetTop||0,visibleHeight=viewport?.height||window.innerHeight;
    const keyboard=document.activeElement===input&&window.innerHeight-visibleHeight>140;
    document.body.classList.toggle('shin-chat-keyboard',keyboard);
    const header=document.querySelector('header.top'),tabs=document.querySelector('nav.tabs');
    const top=Math.max(offset,header?.getBoundingClientRect().bottom||0)+6;
    const bottom=offset+visibleHeight-(keyboard?8:(tabs?.getBoundingClientRect().height||0)+6);
    const stick=log.scrollHeight-log.scrollTop-log.clientHeight<64;
    view.style.setProperty('--shin-top',top+'px');view.style.setProperty('--shin-height',Math.max(120,bottom-top)+'px');
    if(stick)requestAnimationFrame(()=>log.scrollTop=log.scrollHeight);
  }
  let frame=0;function scheduleFit(){cancelAnimationFrame(frame);frame=requestAnimationFrame(fitViewport)}
  new MutationObserver(scheduleFit).observe(view,{attributes:true,attributeFilter:['hidden']});
  const resize=new ResizeObserver(scheduleFit);for(const el of [document.querySelector('header.top'),document.querySelector('nav.tabs')])if(el)resize.observe(el);
  window.addEventListener('resize',scheduleFit);window.visualViewport?.addEventListener('resize',scheduleFit);window.visualViewport?.addEventListener('scroll',scheduleFit);
  input.addEventListener('input',fitInput);input.addEventListener('focus',scheduleFit);input.addEventListener('blur',scheduleFit);
  function message(role,text){const row=document.createElement('article');row.className='shin-ai-message '+role;row.setAttribute('aria-label',role==='user'?'あなたのメッセージ':'SHIN AIの回答');const name=document.createElement('b');name.textContent=role==='user'?'あなた':'SHIN AI';const body=document.createElement('p');body.textContent=text;row.append(name,body);log.append(row);log.scrollTop=log.scrollHeight;return row}
  function reset(){$('#shinAiUseGoal').checked=false;$('#shinAiUseLogs').checked=false;epoch++;controller?.abort();controller=null;history=[];log.replaceChildren();view.dataset.conversation='false';message('assistant','今日はどんなことを相談したいですか？');input.value='';error.hidden=true;busy=false;send.disabled=false;$('#shinAiStatus').textContent='';form.removeAttribute('aria-busy');$('#shinAiReferences').open=false;fitInput();scheduleFit();}
  $('#shinAiClear').onclick=reset;
  document.querySelectorAll('[data-shin-prompt]').forEach(b=>b.onclick=()=>{input.value=b.dataset.shinPrompt;fitInput();input.focus()});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy||e.isComposing)return;const text=input.value.trim();if(!text)return;
    if(text.length>2000){error.textContent='相談は2,000文字以内で入力してください。';error.hidden=false;return}
    busy=true;send.disabled=true;error.hidden=true;form.setAttribute('aria-busy','true');$('#shinAiStatus').textContent='考えています…';const token=epoch;controller=new AbortController();const activeController=controller;
    const candidates=[...history.slice(-8),{role:'user',content:text}],context=getContext({goal:$('#shinAiUseGoal').checked,logs:$('#shinAiUseLogs').checked});
    view.dataset.conversation='true';$('#shinAiReferences').open=false;const row=message('user',text);const timer=setTimeout(()=>activeController.abort(),45000);
    try {const reply=await request({messages:candidates,context},{signal:activeController.signal});if(token!==epoch)return;if(typeof reply!=='string'||!reply.trim())throw Error('回答を取得できませんでした。');history=[...candidates,{role:'assistant',content:reply.slice(0,3000)}];message('assistant',reply);if(input.value.trim()===text){input.value='';fitInput();}}
    catch(err){if(token!==epoch)return;row.remove();view.dataset.conversation=history.length?'true':'false';error.textContent=err?.name==='AbortError'?'回答に時間がかかっています。もう一度お試しください。':err?.message||'接続できませんでした。もう一度お試しください。';error.hidden=false;}
    finally {clearTimeout(timer);if(token===epoch){busy=false;controller=null;send.disabled=false;form.removeAttribute('aria-busy');$('#shinAiStatus').textContent='';}}
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();form.requestSubmit()}});
  reset();return {reset};
}
