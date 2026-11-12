// Only the server role RPC decides whether MFA is required. No client role flag grants access.
export function mountLoginMfa({auth,root,onVerified,onCancel}){
 const $=id=>root.querySelector('#'+id);let busy=false,factor=null,dead=false;
 const clearSecret=()=>{$('loginMfaQr').removeAttribute('src');$('loginMfaSecret').textContent='';$('loginMfaCode').value=''};
 const say=text=>{$('loginMfaStatus').textContent=text};
 const controls=disabled=>{root.querySelectorAll('button,input').forEach(element=>element.disabled=disabled)};
 async function prepare(){
  if(busy||dead)return;busy=true;controls(true);clearSecret();say('');
  try{
   const {data,error}=await auth.mfa.listFactors();if(error)throw error;
   factor=data.totp.find(item=>item.status==='verified')||null;
   if(factor){$('loginMfaSetup').hidden=true;$('loginMfaVerifyForm').hidden=false;say('認証アプリに表示された6桁のコードを入力してください。')}
   else{$('loginMfaSetup').hidden=false;$('loginMfaVerifyForm').hidden=true}
  }catch{say('追加認証の状態を確認できませんでした。再読み込みしてお試しください。')}
  finally{busy=false;controls(false)}
 }
 $('loginMfaEnroll').onclick=async()=>{
  if(busy||dead)return;busy=true;controls(true);say('');
  try{
   const listed=await auth.mfa.listFactors();if(listed.error)throw listed.error;
   // Only unfinished factors created by this setup may be replaced. Never remove verified factors.
   for(const item of listed.data.all||[]){if(item.factor_type==='totp'&&item.status==='unverified'&&item.friendly_name==='IKIGAI管理者'){const removed=await auth.mfa.unenroll({factorId:item.id});if(removed.error)throw removed.error}}
   const {data,error}=await auth.mfa.enroll({factorType:'totp',friendlyName:'IKIGAI管理者'});if(error)throw error;
   if(dead)return;
   const qr=data.totp.qr_code;if(typeof qr!=='string'||!qr.startsWith('data:image/svg+xml;'))throw Error('BAD_QR');
   factor={id:data.id};$('loginMfaQr').src=qr;$('loginMfaSecret').textContent=data.totp.secret;
   $('loginMfaVerifyForm').hidden=false;$('loginMfaEnroll').hidden=true;
  }catch{say('認証アプリの登録を開始できませんでした。時間をおいてお試しください。')}
  finally{busy=false;controls(false)}
 };
 $('loginMfaVerifyForm').onsubmit=async event=>{
  event.preventDefault();if(busy||dead||!factor)return;
  const code=$('loginMfaCode').value.trim();if(!/^\d{6}$/.test(code)){say('6桁のコードを入力してください。');return}
  busy=true;controls(true);say('');
  try{
   const {error}=await auth.mfa.challengeAndVerify({factorId:factor.id,code});if(error)throw error;
   clearSecret();onVerified();
  }catch{say('コードを確認できませんでした。認証アプリの最新のコードでお試しください。');$('loginMfaCode').value=''}
  finally{busy=false;controls(false)}
 };
 $('loginMfaCancel').onclick=()=>{if(!busy){clearSecret();onCancel()}};
 void prepare();return {clear(){dead=true;clearSecret();factor=null}};
}
