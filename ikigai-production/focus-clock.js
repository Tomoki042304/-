import {createClock,snapshot,startClock,pauseClock,restoreClock,formatTime} from './focus-clock-state.js';
export function mountFocusClock(button){
 if(!button)return;
 const key='ikigai-focus-clock-v1';let clock=createClock(),announced=false,tickId=null;
 try{clock=restoreClock(JSON.parse(localStorage.getItem(key)))}catch{}
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(clock))}catch{}};
 const dialog=document.createElement('dialog');dialog.className='focus-clock';dialog.setAttribute('aria-labelledby','focusClockTitle');
 dialog.innerHTML=`<div class="focus-clock-head"><div><span class="focus-eyebrow">TIME FOR YOUR 志</span><h2 id="focusClockTitle">志を満たす時間</h2></div><button type="button" class="focus-close" aria-label="時計を閉じる">×</button></div>
 <div class="focus-modes" role="group" aria-label="時計の種類"><button type="button" data-clock-mode="timer">タイマー</button><button type="button" data-clock-mode="stopwatch">ストップウォッチ</button></div>
 <div class="focus-art" aria-hidden="true"><svg viewBox="0 0 320 320"><defs>
 <image id="focusShiArtwork" href="${new URL('./images/focus-shi-gold.jpg',import.meta.url).href}" x="-127" y="-124" width="574" height="574"/>
 <filter id="focusShiCutout" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  2 2 2 0 -1"/></filter>
 <filter id="focusShiOutline" x="-2%" y="-2%" width="104%" height="104%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2 2 2 0 -1"/><feComponentTransfer result="glyph"><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer><feMorphology operator="dilate" radius=".45" result="outer"/><feComposite in="outer" in2="glyph" operator="out" result="edge"/><feFlood flood-color="#d6b66b"/><feComposite in2="edge" operator="in"/></filter>
 <mask id="focusPaintMask" maskUnits="userSpaceOnUse" x="0" y="0" width="320" height="320" style="mask-type:luminance"><g class="focus-level"><path class="focus-wave focus-wave-back" d="M-320 3 Q-280 -9 -240 3 T-160 3 T-80 3 T0 3 T80 3 T160 3 T240 3 T320 3 T400 3 T480 3 T560 3 T640 3 V650 H-320Z" fill="#aaa"/><path class="focus-wave" d="M-320 8 Q-280 -3 -240 8 T-160 8 T-80 8 T0 8 T80 8 T160 8 T240 8 T320 8 T400 8 T480 8 T560 8 T640 8 V650 H-320Z" fill="white"/></g></mask>
 </defs><use href="#focusShiArtwork" filter="url(#focusShiOutline)" opacity=".8"/><use href="#focusShiArtwork" filter="url(#focusShiCutout)" mask="url(#focusPaintMask)"/></svg></div>
 <p class="focus-time" aria-label="時間">25:00</p><p class="focus-caption">一つのことに、心を注ぐ。</p>
 <div class="focus-setup"><label class="focus-duration-label" for="focusMinutes">集中する時間</label><div class="focus-duration"><select id="focusMinutes" aria-label="時間（分）">${Array.from({length:60},(_,i)=>`<option value="${i+1}"${i===24?' selected':''}>${i+1}分</option>`).join('')}</select></div><div class="focus-presets"><button type="button" data-minutes="5">5分</button><button type="button" data-minutes="15">15分</button><button type="button" data-minutes="25">25分</button><button type="button" data-minutes="50">50分</button></div><p class="focus-hint">設定した時間で「志」が満ちます。</p></div>
 <p class="focus-status" role="status" aria-live="polite"></p><div class="focus-actions"><button type="button" class="focus-reset">リセット</button><button type="button" class="focus-start">はじめる</button></div>`;
 document.body.append(dialog);const $=s=>dialog.querySelector(s),modes=[...dialog.querySelectorAll('[data-clock-mode]')];
 function fillInputs(){$('#focusMinutes').value=Math.max(1,Math.min(60,Math.round(clock.duration/60000)))}
 function render(){const state=snapshot(clock);button.classList.toggle('clock-running',state.running);button.setAttribute('aria-label',state.running?(clock.mode==='timer'?'実行中のタイマーを開く':'実行中のストップウォッチを開く'):'タイマーとストップウォッチを開く');
  if(!dialog.open)return;
  dialog.classList.toggle('is-running',state.running);$('.focus-level').style.transform=`translateY(${state.progress===0?330:state.progress===1?-20:300-state.progress*290}px)`;
  $('.focus-time').textContent=formatTime(clock.mode==='timer'?Math.ceil(state.remaining/1000)*1000:state.elapsed);$('.focus-time').setAttribute('aria-label',(clock.mode==='timer'?'残り時間 ':'経過時間 ')+$('.focus-time').textContent);
  $('.focus-start').textContent=state.running?'一時停止':state.finished?'もう一度':state.elapsed?'再開':'はじめる';$('.focus-setup').hidden=state.elapsed>0||state.running;
  $('.focus-duration-label').textContent=clock.mode==='timer'?'集中する時間':'志が満ちる目標時間';$('.focus-hint').textContent=clock.mode==='timer'?'設定した時間で「志」が満ちます。':'目標を過ぎても、時間は計り続けます。';
  $('.focus-caption').textContent=state.finished?'おつかれさま。志が、また一つ満ちました。':state.running?'一つのことに、心を注ぐ。':state.elapsed?'ひと息ついて、またここから。':'一つのことに、心を注ぐ。';
  modes.forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.clockMode===clock.mode));b.disabled=state.running||state.elapsed>0});
  if(state.finished&&!announced){announced=true;clock=pauseClock(clock);save();$('.focus-status').textContent='設定した時間になりました。'}
 }
 function loop(){clearInterval(tickId);tickId=setInterval(()=>{render();if(!dialog.open&&!snapshot(clock).running){clearInterval(tickId);tickId=null}},200)}
 function reset(){clock=createClock(clock.mode,clock.duration);announced=false;save();fillInputs();$('.focus-status').textContent='';render()}
 function duration(){const minutes=Number($('#focusMinutes').value);if(!Number.isInteger(minutes)||minutes<1||minutes>60){$('.focus-status').textContent='1分から60分の間で選んでください。';return false}clock=createClock(clock.mode,minutes*60000);save();return true}
 button.addEventListener('click',()=>{if(!dialog.open){fillInputs();dialog.showModal();render();loop()}});
 $('.focus-close').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});dialog.addEventListener('close',()=>button.focus());
 modes.forEach(b=>b.onclick=()=>{if(snapshot(clock).running||snapshot(clock).elapsed)return;clock=createClock(b.dataset.clockMode,clock.duration);save();$('.focus-status').textContent='';render()});
 dialog.querySelectorAll('[data-minutes]').forEach(b=>b.onclick=()=>{$('#focusMinutes').value=b.dataset.minutes;duration();render()});
 $('#focusMinutes').onchange=()=>{if(duration())render()};
 $('.focus-reset').onclick=reset;
 $('.focus-start').onclick=()=>{const state=snapshot(clock);$('.focus-status').textContent='';if(state.running)clock=pauseClock(clock);else{if(state.finished){reset()}if(!clock.elapsed&&!duration())return;clock=startClock(clock);announced=false}save();render();loop()};
 document.addEventListener('visibilitychange',()=>{render();if(document.visibilityState==='visible'&&snapshot(clock).running)loop()});
 fillInputs();render();if(snapshot(clock).running)loop();
}
mountFocusClock(document.getElementById('focusClockBtn'));
