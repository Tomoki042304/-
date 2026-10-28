export function mountShinAI({request,getContext}) {
  const $=s=>document.querySelector(s),log=$('#shinAiLog'),input=$('#shinAiInput'),form=$('#shinAiForm'),send=$('#shinAiSend'),error=$('#shinAiError');
  let history=[],busy=false,controller=null,epoch=0;
  function message(role,text){const row=document.createElement('article');row.className='shin-ai-message '+role;const name=document.createElement('b');name.textContent=role==='user'?'あなた':'SHIN AI';const body=document.createElement('p');body.textContent=text;row.append(name,body);log.append(row);log.scrollTop=log.scrollHeight;return row}
  function reset(){$('#shinAiUseGoal').checked=false;$('#shinAiUseLogs').checked=false;epoch++;controller?.abort();controller=null;history=[];log.replaceChildren();message('assistant','こんにちは、SHIN AIです。志や目標の整理、成長ログの振り返りを一緒に進めましょう。今日はどんなことを相談したいですか？');input.value='';error.hidden=true;busy=false;send.disabled=false;$('#shinAiStatus').textContent='';form.removeAttribute('aria-busy');}
  $('#shinAiClear').onclick=reset;
  document.querySelectorAll('[data-shin-prompt]').forEach(b=>b.onclick=()=>{input.value=b.dataset.shinPrompt;input.focus()});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy||e.isComposing)return;const text=input.value.trim();if(!text)return;
    if(text.length>2000){error.textContent='相談は2,000文字以内で入力してください。';error.hidden=false;return}
    busy=true;send.disabled=true;error.hidden=true;form.setAttribute('aria-busy','true');$('#shinAiStatus').textContent='考えています…';const token=epoch;controller=new AbortController();const activeController=controller;
    const candidates=[...history.slice(-8),{role:'user',content:text}],context=getContext({goal:$('#shinAiUseGoal').checked,logs:$('#shinAiUseLogs').checked});
    const row=message('user',text);const timer=setTimeout(()=>activeController.abort(),45000);
    try {const reply=await request({messages:candidates,context},{signal:activeController.signal});if(token!==epoch)return;if(typeof reply!=='string'||!reply.trim())throw Error('回答を取得できませんでした。');history=[...candidates,{role:'assistant',content:reply.slice(0,3000)}];message('assistant',reply);if(input.value.trim()===text)input.value='';}
    catch(err){if(token!==epoch)return;row.remove();error.textContent=err?.name==='AbortError'?'回答に時間がかかっています。もう一度お試しください。':err?.message||'接続できませんでした。もう一度お試しください。';error.hidden=false;}
    finally {clearTimeout(timer);if(token===epoch){busy=false;controller=null;send.disabled=false;form.removeAttribute('aria-busy');$('#shinAiStatus').textContent='';}}
  });
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();form.requestSubmit()}});
  reset();return {reset};
}
