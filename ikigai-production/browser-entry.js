import {growthLoginTarget} from './growth-entry.js';
const APP_URL='https://ikigai-shidoroku.pages.dev/';
const SDK_URL='https://static.line-scdn.net/liff/edge/versions/2.31.1/sdk.js';
const LIFF_ID='2012617316-f4FBapHK';
let ready;
function loadLiff(document,window){
 if(ready)return ready;
 ready=(async()=>{
  if(!window.liff)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=SDK_URL;script.charset='utf-8';script.async=true;
   const timer=setTimeout(()=>{script.remove();reject(Error('SDK_TIMEOUT'))},10000);
   script.onload=()=>{clearTimeout(timer);resolve()};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('SDK_UNAVAILABLE'))};document.head.append(script);
  });
  let timer;
  try{await Promise.race([window.liff.init({liffId:LIFF_ID,withLoginOnExternalBrowser:false}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('INIT_TIMEOUT')),12000)})])}
  finally{clearTimeout(timer)}
  return window.liff;
 })().catch(error=>{ready=null;throw error});
 return ready;
}

export const isLineBrowser=navigator=>/\bLine\//i.test(navigator.userAgent);

export async function openLineLoginInBrowser({document,window,loadSdk=()=>loadLiff(document,window)}){
 const liff=await loadSdk();
 // Start OAuth only after arriving in the external browser. Never transport sessions between browsers.
 const target=APP_URL+'?login=line'+growthLoginTarget(window.location);
 if(liff.isInClient())liff.openWindow({url:target,external:true});
 else window.location.assign(target+'&openExternalBrowser=1');
}

export function consumeBrowserLogin(location,history){
 const url=new URL(location.href);
 if(url.searchParams.get('login')!=='line')return false;
 url.searchParams.delete('login');url.searchParams.delete('openExternalBrowser');
 history.replaceState(history.state,'',url.pathname+url.search+url.hash);
 return true;
}

export function mountBrowserEntry({document,window,navigator,loadSdk=()=>loadLiff(document,window)}){
 // The installation prompt belongs in LINE, not in an installed home-screen app.
 if(!isLineBrowser(navigator)||navigator.standalone===true||window.matchMedia('(display-mode: standalone)').matches)return;
 const home=document.querySelector('#v-home');if(!home||document.querySelector('#browserEntry'))return;
 const root=document.createElement('section');root.id='browserEntry';root.className='card';root.style.cssText='padding:18px;margin:0 0 20px';
 const title=document.createElement('b');title.textContent='ホーム画面から使う';
 const copy=document.createElement('p');copy.className='muted';copy.textContent='ブラウザで開くと、ホーム画面に追加できます。';copy.style.cssText='font-size:12px;line-height:1.8;margin:8px 0 14px';
 const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent='ブラウザで開く';button.style.cssText='min-height:44px;width:100%;font-weight:600';
 const status=document.createElement('p');status.className='muted';status.setAttribute('role','status');status.style.cssText='font-size:12px;line-height:1.8;margin:10px 0 0';status.hidden=true;
 const fallback=document.createElement('button');fallback.type='button';fallback.className='small-btn';fallback.textContent='アプリのURLをコピー';fallback.hidden=true;
 fallback.onclick=async()=>{try{await navigator.clipboard.writeText(APP_URL);status.textContent='コピーしました。Safariなどのブラウザに貼り付けて開いてください。'}catch{status.textContent='ブラウザのアドレス欄に '+APP_URL+' を入力してください。'}};
 button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;status.hidden=false;status.textContent='ブラウザを開いています…';fallback.hidden=true;
  try{
   const liff=await loadSdk();
   if(liff.isInClient()){
    // Never forward the current URL: it may contain an OAuth code or LINE token.
    liff.openWindow({url:APP_URL,external:true});
   }else{
    // LINE's ordinary in-app browser supports this flag; LIFF uses openWindow above.
    window.location.assign(APP_URL+'?openExternalBrowser=1');
   }
   status.textContent=/iPhone|iPad|iPod/i.test(navigator.userAgent)?'開いたブラウザの共有メニューから「ホーム画面に追加」を選んでください。':'開いたブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選んでください。';
   fallback.hidden=false;
  }catch{status.textContent='ブラウザを開けませんでした。もう一度押すか、URLをコピーしてSafariなどで開いてください。';fallback.hidden=false}
  finally{button.disabled=false}
 };
 root.append(title,copy,button,status,fallback);home.prepend(root);
 return {root,button,status,fallback};
}
