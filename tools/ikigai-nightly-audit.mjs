// Runs only in the authorized GitHub workflow. No user data or token is logged.
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const origin='https://ikigai-shidoroku.pages.dev',root=path.resolve('ikigai-production');
async function files(dir){const result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())result.push(...await files(p));else if(/\.(?:js|mjs|json|html|map|txt|env)$/i.test(entry.name)||entry.name==='.env')result.push(p)}return result}
export async function scanPublicSources(){
 let secretFound=false,dependencyUnknown=false;const dependencies=[];
 for(const file of await files(root)){
  const text=await readFile(file,'utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsb_secret_[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b/.test(text))secretFound=true;
  for(const token of text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){try{if(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).role==='service_role')secretFound=true}catch{}}
  for(const match of text.matchAll(/https:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm)\/(\@[\w-]+\/[\w-]+|[\w-]+)@([\w.^~-]+)/g)){
   if(!/^\d+\.\d+\.\d+$/.test(match[2]))dependencyUnknown=true;else dependencies.push({package:{name:match[1],ecosystem:'npm'},version:match[2]});
  }
 }
 let dependencyStatus='unverified';
 if(dependencies.length&&!dependencyUnknown){
  try{const response=await fetch('https://api.osv.dev/v1/querybatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({queries:dependencies}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.results)||data.results.length!==dependencies.length)throw Error();dependencyStatus=data.results.some(r=>r.vulns?.length)?'warning':'pass'}catch{}
 }
 return {publicSecrets:secretFound?'critical':'pass',dependencies:dependencyStatus};
}
async function main(){
 const checks=await scanPublicSources();
 checks.apiAccess='unverified';checks.apiMaintenance='unverified';
 checks.publicFiles='unverified';
 try{
  let exposed=false;
  for(const endpoint of ['/.env','/.git/config','/wrangler.toml']){
   const response=await fetch(origin+endpoint,{redirect:'error',signal:AbortSignal.timeout(10000)});
   if(response.status===404)continue;if(!response.ok)throw Error();
   if(Number(response.headers.get('Content-Length')||0)>65536)throw Error();
   const reader=response.body.getReader();let count=0,text='';const decoder=new TextDecoder();
   while(true){const {value,done}=await reader.read();if(done)break;count+=value.byteLength;if(count>65536){await reader.cancel();throw Error()}text+=decoder.decode(value,{stream:true})}
   if(!/<(?:!doctype|html)\b/i.test(text)&&(/\[(?:core|remote|vars|env\.)/.test(text)||/^(?:[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)|DATABASE_URL)\s*=/m.test(text)))exposed=true;
  }
  checks.publicFiles=exposed?'critical':'pass';
 }catch{}

 try{
  const stateResponse=await fetch(origin+'/api/maintenance',{cache:'no-store',signal:AbortSignal.timeout(10000)}),state=await stateResponse.json();
  if(typeof state.active!=='boolean')throw Error();
  const probes=await Promise.all(['/api/shin-ai','/api/security','/api/private-data'].map(async endpoint=>{
   const response=await fetch(origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({action:'notice-status'}),redirect:'error',signal:AbortSignal.timeout(10000)});
   const body=await response.json().catch(()=>null);return {status:response.status,code:body?.code};
  }));
  if(state.active)checks.apiMaintenance=probes.every(p=>p.status===503&&p.code==='APP_MAINTENANCE')?'pass':'warning';
  else checks.apiAccess=probes.some(p=>p.status>=200&&p.status<300)?'critical':probes.every(p=>[401,403].includes(p.status))?'pass':'unverified';
 }catch{}

 if(!process.env.ACTIONS_ID_TOKEN_REQUEST_URL||!process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw Error('OIDC_UNAVAILABLE');
 const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',origin+'/api/maintenance');
 const identity=await fetch(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(15000)});
 if(!identity.ok)throw Error('OIDC_UNAVAILABLE');const {value}=await identity.json();if(typeof value!=='string')throw Error('OIDC_UNAVAILABLE');
 const response=await fetch(origin+'/api/maintenance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+value},body:JSON.stringify({action:'audit',checks}),redirect:'error',signal:AbortSignal.timeout(150000)});
 if(response.status===409){console.log('Another authorized audit is already running.');return}
 if(!response.ok)throw Error('AUDIT_REQUEST_FAILED_'+response.status);
 const result=await response.json();console.log('Audit completed. Status: '+(['critical','error','warning','incomplete'].includes(result.status)?result.status:'unknown'));
 if(['critical','error'].includes(result.status))process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(()=>{console.error('Audit did not complete. Inspect server configuration and workflow status. No successful check has been recorded.');process.exitCode=1});
