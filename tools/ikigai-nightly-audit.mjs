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
 let checks;try{checks=await scanPublicSources()}catch{throw failure('PUBLIC_SOURCE_SCAN_FAILED')}
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

 await requestServerAudit(checks);

}
const SAFE_CODES=new Set(['PUBLIC_SOURCE_SCAN_FAILED','OIDC_UNAVAILABLE','OIDC_REQUEST_FAILED','OIDC_RESPONSE_INVALID','OIDC_NETWORK_FAILED','AUDIT_NETWORK_FAILED','AUDIT_RESPONSE_INVALID','AUDIT_HTTP_FAILED','UNEXPECTED_ERROR','OIDC_ALGORITHM_REJECTED','OIDC_ISSUER_REJECTED','OIDC_AUDIENCE_REJECTED','OIDC_REPOSITORY_REJECTED','OIDC_REF_REJECTED','OIDC_WORKFLOW_REJECTED','OIDC_EVENT_REJECTED','OIDC_SUBJECT_REJECTED','OIDC_TIME_REJECTED','OIDC_FORMAT_REJECTED','OIDC_CLAIMS_REJECTED','OIDC_KEYS_UNAVAILABLE','OIDC_KEY_NOT_FOUND','OIDC_SIGNATURE_REJECTED','OIDC_VERIFICATION_FAILED','MAINTENANCE_SQL_REQUIRED','AUDIT_DB_PERMISSION_DENIED','AUDIT_DB_AUTH_FAILED','AUDIT_DB_SCHEMA_MISSING','AUDIT_DB_TIMEOUT','AUDIT_EXECUTION_FAILED','MAINTENANCE_STATUS_UNAVAILABLE']);
function failure(code,httpStatus){const error=Error('Audit diagnostic');error.diagnosticCode=code;if(Number.isInteger(httpStatus))error.httpStatus=httpStatus;return error}
export function auditFailureMessage(error){
 const code=SAFE_CODES.has(error?.diagnosticCode)?error.diagnosticCode:'UNEXPECTED_ERROR';
 const status=Number.isInteger(error?.httpStatus)&&error.httpStatus>=100&&error.httpStatus<=599?' HTTP='+error.httpStatus:'';
 return 'Audit did not complete. Code='+code+status+'. No completed audit has been confirmed. Do not share tokens or secret keys.';
}
export async function requestServerAudit(checks,{environment=process.env,fetcher=fetch,log=console.log}={}){
 if(!environment.ACTIONS_ID_TOKEN_REQUEST_URL||!environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN)throw failure('OIDC_UNAVAILABLE');
 log('Audit stage: requesting GitHub identity');
 const url=new URL(environment.ACTIONS_ID_TOKEN_REQUEST_URL);url.searchParams.set('audience',origin+'/api/maintenance');
 let identity;try{identity=await fetcher(url,{headers:{Authorization:'Bearer '+environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN},signal:AbortSignal.timeout(15000)})}catch{throw failure('OIDC_NETWORK_FAILED')}
 if(!identity.ok)throw failure('OIDC_REQUEST_FAILED',identity.status);
 const identityBody=await identity.json().catch(()=>null),value=identityBody?.value;
 if(typeof value!=='string'||!value)throw failure('OIDC_RESPONSE_INVALID');
 log('Audit stage: requesting server audit');
 let response;try{response=await fetcher(origin+'/api/maintenance',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+value},body:JSON.stringify({action:'audit',checks}),redirect:'error',signal:AbortSignal.timeout(150000)})}catch{throw failure('AUDIT_NETWORK_FAILED')}
 const result=await response.json().catch(()=>null);
 if(response.status===409&&result?.busy===true){log('Another authorized audit is already running.');return {busy:true}}
 if(!response.ok)throw failure(SAFE_CODES.has(result?.code)?result.code:'AUDIT_HTTP_FAILED',response.status);
 if(!['critical','error','warning','incomplete'].includes(result?.status))throw failure('AUDIT_RESPONSE_INVALID',response.status);
 log('Audit completed. Status: '+result.status);
 if(['critical','error'].includes(result.status))process.exitCode=1;
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===new URL(import.meta.url).pathname)main().catch(error=>{console.error(auditFailureMessage(error));process.exitCode=1});
