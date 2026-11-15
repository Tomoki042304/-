// Supabase owns OAuth state, PKCE, the code exchange and the member session.
// LIFF opens the same app in LINE; no LINE token is trusted by client code.
export const LINE_PROVIDER='custom:line';
export const LIFF_URL='https://liff.line.me/2012617316-f4FBapHK';

export function oauthTarget(value,supabaseUrl,provider) {
 const target=new URL(value),expected=new URL(supabaseUrl);
 if(target.origin!==expected.origin || target.pathname!=='/auth/v1/authorize' || target.searchParams.get('provider')!==provider || target.username || target.password)throw Error('Unexpected OAuth target');
 return target.href;
}

export function mountLineLogin({document,onLogin,onReady,fetchConfig=fetch}) {
 const root=document.createElement('section');root.id='lineLogin';root.className='card auth-box';root.hidden=true;
 const button=document.createElement('button');button.type='button';button.id='authLine';button.textContent='LINEでログイン';
 button.style.cssText='background:#06c755;color:#fff;border:0;border-radius:12px;padding:14px;font-weight:700;width:100%;cursor:pointer';
 button.onclick=()=>onLogin(LINE_PROVIDER);
 const hint=document.createElement('p');hint.className='muted';hint.textContent='GitHubで登録済みの方は、これまでと同じ方法でログインしてください。';
 const link=document.createElement('a');link.href=LIFF_URL;link.textContent='LINEアプリ内で開く';
 const status=document.createElement('p');status.id='lineLoginStatus';status.className='auth-err';status.setAttribute('role','alert');
 root.append(button,status,link,hint);document.querySelector('#authForm').before(root);
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
 const ready=(async()=>{
  try{
   const response=await fetchConfig('/api/line-login-config',{cache:'no-store',redirect:'error',signal:controller.signal});
   if(response.ok && (await response.json())?.enabled===true)onReady(root);
  }catch{ /* Keep the existing login available if configuration cannot be checked. */ }
  finally{clearTimeout(timeout)}
 })();
 return {root,button,ready};
}
