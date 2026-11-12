// Supabase Auth owns code generation, expiry, one-time use and server rate limits.
// The local cooldown is only a UX aid, never an authorization boundary.
export function mountEmailLogin({auth,root,siteKey,onVerified}){
 const $=id=>root.querySelector('#'+id);
 let email='',busy=false,token='',widget=null,retryAt=0,timer=null,dead=false,attempt=0;
 const say=(text,ok=false)=>{$('emailAuthStatus').textContent=text;$('emailAuthStatus').classList.toggle('ok',ok)};
 const sync=()=>{
  const seconds=Math.max(0,Math.ceil((retryAt-Date.now())/1000));
  $('emailSend').disabled=busy||!token||!!seconds;
  $('emailResend').disabled=busy||!token||!!seconds;
  $('emailResend').textContent=seconds?`${seconds}秒後に再送できます`:'確認コードをもう一度送る';
  $('emailVerify').disabled=busy;$('emailBack').disabled=busy;$('emailAddress').disabled=busy;
  $('existingGitHub').disabled=busy;
 };
 const resetCaptcha=()=>{token='';if(widget!==null&&window.turnstile)window.turnstile.reset(widget);sync()};
 const fail=error=>{
  const limited=error?.status===429||['over_email_send_rate_limit','over_request_rate_limit'].includes(error?.code);
  if(limited)retryAt=Math.max(retryAt,Date.now()+60000);
  say(limited?'試行回数が多くなっています。時間をおいてお試しください。':error?.code==='captcha_failed'?'確認をやり直してから、もう一度お試しください。':'確認できませんでした。入力内容と通信状態を確認し、時間をおいてお試しください。');
 };
 async function send(resend){
  if(dead||busy||!token||Date.now()<retryAt)return;
  const address=resend?email:$('emailAddress').value.trim();
  if(!address||address.length>254||!$('emailAddress').checkValidity()){say('メールアドレスの形式を確認してください。');return}
  busy=true;sync();say('');const epoch=++attempt;
  try{
   const {error}=await auth.signInWithOtp({email:address,options:{shouldCreateUser:true,captchaToken:token}});
   if(dead||epoch!==attempt)return;if(error)throw error;
   email=address;retryAt=Date.now()+60000;
   $('emailEntry').hidden=true;$('emailCodeStep').hidden=false;$('emailTarget').textContent=email;
   $('emailCode').value='';$('emailCode').focus();
   // Same message for all addresses: never disclose whether an account exists.
   say('確認コードを送信しました。届かない場合は迷惑メールもご確認ください。',true);
  }catch(error){if(!dead&&epoch===attempt)fail(error)}finally{busy=false;resetCaptcha()}
 }
 $('emailAuthForm').onsubmit=event=>{event.preventDefault();void send(false)};
 $('emailResend').onclick=()=>void send(true);
 $('emailCodeForm').onsubmit=async event=>{
  event.preventDefault();if(dead||busy)return;
  const code=$('emailCode').value.trim();
  if(!/^\d{6,10}$/.test(code)){say('メールに記載された数字の確認コードを入力してください。');return}
  busy=true;sync();say('');
  try{
   const {data,error}=await auth.verifyOtp({email,token:code,type:'email'});
   if(error)throw error;if(!data?.session?.user)throw Error('NO_SESSION');
   $('emailCode').value='';email='';onVerified(data.session.user);
  }catch(error){fail(error);$('emailCode').value='';$('emailCode').focus()}
  finally{busy=false;sync()}
 };
 $('emailBack').onclick=()=>{email='';$('emailCode').value='';$('emailEntry').hidden=false;$('emailCodeStep').hidden=true;say('');$('emailAddress').focus()};
 timer=setInterval(sync,1000);sync();
 const render=()=>{
  if(dead)return;
  widget=window.turnstile.render($('emailCaptcha'),{sitekey:siteKey,theme:'light',action:'ikigai-login',callback:value=>{token=value;sync()},'expired-callback':()=>{token='';sync()},'error-callback':()=>{token='';sync();say('安全確認を読み込めません。通信状態を確認して再読み込みしてください。')}});
 };
 if(window.turnstile)render();else{
  const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.referrerPolicy='no-referrer';script.onload=render;script.onerror=()=>say('安全確認を読み込めません。通信状態を確認して再読み込みしてください。');document.head.append(script);
 }
 return {
  reset(){attempt++;email='';$('emailCode').value='';$('emailTarget').textContent='';$('emailEntry').hidden=false;$('emailCodeStep').hidden=true;say('');sync()},
  clear(){dead=true;attempt++;clearInterval(timer);token='';email='';$('emailCode').value='';$('emailAddress').value='';if(widget!==null&&window.turnstile)window.turnstile.remove(widget)}
 };
}
