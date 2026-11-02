const ISSUER='https://token.actions.githubusercontent.com',AUDIENCE='https://ikigai-shidoroku.pages.dev/api/maintenance';
const decode=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let keys=null,expires=0,lastFetch=0,pending=null;
export async function verifyNightlyIdentity(token,{now=Date.now(),fetchKeys=async()=>{const response=await fetch(ISSUER+'/.well-known/jwks',{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();return response.json()}}={}){
 try{
  if(typeof token!=='string'||token.length>20000)return false;const parts=token.split('.');if(parts.length!==3)return false;
  const header=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1]))),seconds=now/1000;
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>128||claims.iss!==ISSUER||claims.aud!==AUDIENCE||claims.repository!=='Tomoki042304/-'||claims.ref!=='refs/heads/main'||claims.workflow_ref!=='Tomoki042304/-/.github/workflows/ikigai-nightly-audit.yml@refs/heads/main'||!['schedule','workflow_dispatch'].includes(claims.event_name)||claims.sub!=='repo:Tomoki042304/-:ref:refs/heads/main'||!Number.isFinite(claims.exp)||claims.exp<=seconds||!Number.isFinite(claims.iat)||claims.iat>seconds+60||seconds-claims.iat>600||claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>seconds+60))return false;
  if(!keys&&lastFetch&&now-lastFetch<30000&&!pending)return false;
  if(!keys||expires<now||!keys.some(k=>k.kid===header.kid)&&now-lastFetch>30000){
   if(!pending){lastFetch=now;pending=fetchKeys().then(value=>{keys=value.keys;expires=now+300000}).finally(()=>{pending=null})}
   await pending;
  }
  const jwk=keys?.find(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));if(!jwk)return false;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
 }catch{return false}
}
