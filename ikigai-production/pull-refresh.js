export async function refreshCurrentData(){
  const tasks=[];window.dispatchEvent(new CustomEvent('ikigai-refresh-data',{detail:{tasks}}));
  if(!tasks.length)throw Error('画面の準備中です。少し待ってからもう一度お試しください。');
  const results=await Promise.allSettled(tasks);
  if(results.some(result=>result.status==='rejected'))throw Error('一部のデータを更新できませんでした。通信状況を確認して再試行してください。');
}
export function mountPullRefresh({refresh=refreshCurrentData}={}){
  const indicator=document.createElement('div');indicator.id='pullRefresh';indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');indicator.hidden=true;document.body.append(indicator);
  let start=null,busy=false,armed=false,hideTimer=0;
  const atTop=()=>Math.max(0,window.scrollY||document.scrollingElement?.scrollTop||0)<=1;
  function eligible(target){
    if(document.getElementById('app')?.hidden!==false||document.getElementById('splash')?.hidden===false)return false;
    if(target.closest('input,textarea,select,[contenteditable="true"],dialog[open],.crop:not([hidden]),.shin-ai-log,.chat-log,.dm-log'))return false;
    for(let el=target;el&&el!==document.body&&el!==document.documentElement;el=el.parentElement){const style=getComputedStyle(el);if(/auto|scroll/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+2)return false;}
    return true;
  }
  function show(text,distance=0){clearTimeout(hideTimer);indicator.textContent=text;indicator.hidden=false;indicator.style.setProperty('--pull-distance',Math.min(48,distance*.45)+'px');const header=document.querySelector('header.top');indicator.style.top=Math.max(8,(header?.getBoundingClientRect().bottom||0)+8)+'px';}
  function clear(){start=null;armed=false;if(!busy)indicator.hidden=true;}
  async function perform(){
    if(busy)return;busy=true;show('更新しています…');
    try{
      if(!navigator.onLine)throw Error('オフラインです。接続してからもう一度お試しください。');
      const guard=new Event('ikigai-before-refresh',{cancelable:true});
      if(!window.dispatchEvent(guard))throw Error('保存待ちの変更があります。保存してから更新してください。');
      await refresh();show('更新しました');hideTimer=setTimeout(()=>indicator.hidden=true,1000);
    }catch(error){show(error.message||'更新できませんでした。もう一度お試しください。');hideTimer=setTimeout(()=>indicator.hidden=true,3500);}
    finally{busy=false;start=null;armed=false;}
  }
  function begin(e){if(busy||e.touches.length!==1||!atTop()||!eligible(e.target))return;const t=e.touches[0];start={x:t.clientX,y:t.clientY};armed=false;}
  function move(e){
    if(!start||busy)return;if(e.touches.length!==1||!atTop()){clear();return}
    const t=e.touches[0],dy=t.clientY-start.y,dx=t.clientX-start.x;
    if(dy<=0||Math.abs(dx)>Math.max(24,dy*.6)){clear();return}
    if(dy<12)return;if(e.cancelable)e.preventDefault();armed=dy>=90;show(armed?'離すと更新':'下に引っ張って更新',dy);
  }
  function end(){if(start&&armed){start=null;void perform()}else clear();}
  document.addEventListener('touchstart',begin,{passive:true});document.addEventListener('touchmove',move,{passive:false});document.addEventListener('touchend',end,{passive:true});document.addEventListener('touchcancel',clear,{passive:true});
  const visibility=()=>{if(document.visibilityState==='hidden')clear()};document.addEventListener('visibilitychange',visibility);
  return {destroy(){document.removeEventListener('touchstart',begin);document.removeEventListener('touchmove',move);document.removeEventListener('touchend',end);document.removeEventListener('touchcancel',clear);document.removeEventListener('visibilitychange',visibility);clearTimeout(hideTimer);indicator.remove()}};
}
