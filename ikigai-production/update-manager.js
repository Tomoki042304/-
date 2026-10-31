// Check published releases daily and on resume. Never reload an active form.
export async function startUpdates() {
  const registration = await navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'});
  let lastSuccess = 0, pending = false;
  const day = time => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(time);
  async function check() {
    if (document.visibilityState === 'hidden' || pending || !navigator.onLine) return;
    if (lastSuccess && day(lastSuccess) === day(Date.now())) return;
    pending = true;
    try {
      await registration.update();
      (registration.active || navigator.serviceWorker.controller)?.postMessage({type: 'ikigai-maintenance'});
      lastSuccess = Date.now();
    } catch { /* Keep the current version offline; retry on resume or the next tick. */ }
    finally { pending = false; }
  }
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  window.addEventListener('pageshow', check);
  setInterval(check, 60000);
  await check();
}

// Explicit pull-to-refresh always checks, even after today's background check.
export async function refreshPublishedApp({reload=()=>location.reload()}={}) {
  if(!navigator.onLine)throw Error('オフラインです。接続してからもう一度お試しください。');
  async function bounded(promise,milliseconds){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('更新に時間がかかっています。もう一度お試しください。')),milliseconds))])}finally{clearTimeout(timer)}}
  if('serviceWorker' in navigator){
    const registration=await bounded(navigator.serviceWorker.getRegistration(),5000);
    if(registration){
      await bounded(registration.update(),12000);
      const worker=registration.installing||registration.waiting;
      if(worker&&worker.state!=='activated')await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('statechange',changed)};
        const changed=()=>{if(worker.state==='activated'){cleanup();resolve()}else if(worker.state==='redundant'){cleanup();reject(Error('更新できませんでした。もう一度お試しください。'))}};
        const timer=setTimeout(()=>{cleanup();reject(Error('更新の準備中です。少し待ってもう一度お試しください。'))},12000);
        worker.addEventListener('statechange',changed);changed();
      });
    }
  }
  reload();
}
