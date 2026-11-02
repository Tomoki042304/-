const ISSUER='https://token.actions.githubusercontent.com',AUDIENCE='https://ikigai-shidoroku.pages.dev/api/maintenance';
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let keys=null,expires=0,lastFetch=0,pending=null;
export async function verifyNightlyIdentity(token,{now=Date.now(),onFailure=()=>{},fetchKeys=async()=>{const response=await fetch(ISSUER+'/.well-known/jwks',{redirect:'manual',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();return response.json()}}={}){
 const reject=code=>{onFailure(code);return false};
 try{
  if(typeof token!=='string'||token.length>20000)return reject('OIDC_FORMAT_REJECTED');const parts=token.split('.');if(parts.length!==3)return reject('OIDC_FORMAT_REJECTED');
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1]))),seconds=now/1000;
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>128)return reject('OIDC_ALGORITHM_REJECTED');
  if(claims.iss!==ISSUER)return reject('OIDC_ISSUER_REJECTED');
  if(claims.aud!==AUDIENCE)return reject('OIDC_AUDIENCE_REJECTED');
  if(claims.repository!=='Tomoki042304/-')return reject('OIDC_REPOSITORY_REJECTED');
  if(claims.ref!=='refs/heads/main')return reject('OIDC_REF_REJECTED');
  if(claims.workflow_ref!=='Tomoki042304/-/.github/workflows/ikigai-nightly-audit.yml@refs/heads/main')return reject('OIDC_WORKFLOW_REJECTED');
  if(!['schedule','workflow_dispatch'].includes(claims.event_name))return reject('OIDC_EVENT_REJECTED');
  // GitHub supports customized OIDC subjects. Authorize using the independently
  // signed repository/ref/workflow/event claims above, not a legacy sub template.
  if(typeof claims.sub!=='string'||!claims.sub.trim()||claims.sub.length>2048||/[\u0000-\u001f\u007f]/.test(claims.sub))return reject('OIDC_SUBJECT_REJECTED');
  if(!Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+60||seconds-claims.iat>600||claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds+60))return reject('OIDC_TIME_REJECTED');
  if(!keys&&lastFetch&&now-lastFetch<30000&&!pending)return reject('OIDC_KEYS_UNAVAILABLE');
  if(!keys||expires<now||!keys.some(k=>k.kid===header.kid)&&now-lastFetch>30000){
   if(!pending){lastFetch=now;pending=fetchKeys().then(value=>{keys=value.keys;expires=now+300000}).finally(()=>{pending=null})}
   try{await pending}catch{return reject('OIDC_KEYS_UNAVAILABLE')}
  }
  const jwk=keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));if(!jwk)return reject('OIDC_KEY_NOT_FOUND');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
  return valid||reject('OIDC_SIGNATURE_REJECTED');
 }catch{return reject('OIDC_VERIFICATION_FAILED')}
}
