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
