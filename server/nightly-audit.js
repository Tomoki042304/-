import {database} from './private-documents.js';
import {runtimeStore} from './supabase-runtime.js';
import {encryptPii,decryptPii} from './pii-crypto.js';
import {manageKnowledge} from './shin-knowledge.js';
import {privateFields,openDocument,KV_PRIVATE_PREFIXES} from './pii-storage.js';
import {clearMaintenanceCache} from './maintenance.js';
export const LATEST='maintenance:latest:v1';
const RETENTION=90*86400;
async function withDeadline(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AUDIT_TIMEOUT')),ms)})])}finally{clearTimeout(timer)}}
export async function runNightlyAudit(env,external={}){
 const db=(name,body={})=>database(null,'rpc/'+name,{method:'POST',body,serviceKey:env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY});
 const catalog=await db('ikigai_maintenance_audit_v1',{p_claim:true});
 if(catalog?.claimed!==true)return {busy:true};
 const startedAt=new Date().toISOString(),id=crypto.randomUUID(),store=runtimeStore(env),checks=[];
 const add=(id,label,status,detail)=>checks.push({id,label,status,detail});
 for(const [field,label] of [['privateTablesProtected','非公開テーブルの権限'],['documentsRls','会員データの行単位アクセス制御'],['maintenancePolicies','DB・写真の点検時間制限'],['privatePhotoBucket','成長ログ写真の非公開設定'],['databaseGateConfigured','DBの停止設定']]){
  if(typeof catalog[field]!=='boolean'){add(field,label,'error','検査結果の形式を確認できません。');continue}
  const good=catalog[field]===true;
  add(field,label,good?'pass':field==='maintenancePolicies'||field==='databaseGateConfigured'?'error':'critical',good?'設定を確認しました。':'設定を確認できません。管理者による確認が必要です。');
 }
 const check=async(id,label,fn)=>{try{const detail=await fn();add(id,label,detail?.status||'pass',detail?.detail||detail||'動作を確認しました。')}catch{add(id,label,'error','動作を確認できませんでした。機密情報を記録せず終了しました。')}};
 await Promise.all([
  check('ai','SHIN AIの応答',async()=>{
   if(!env.AI?.run)throw Error();
   const result=await withDeadline(env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8',{messages:[{role:'system',content:'Health check. Reply with the word READY only.'},{role:'user',content:'READY'}],max_tokens:32}),45000);
   if(typeof result?.response!=='string'||!result.response.trim()||result.response.length>2000)throw Error();
   return '実データを含まない短い質問への応答を確認しました。回答品質の完全な評価ではありません。';
  }),
  check('encryption','保存時暗号化と復号',async()=>{
   const text=crypto.randomUUID(),envelope=await encryptPii(env,'nightly:self-test',text);
   if(await decryptPii(env,'nightly:self-test',envelope)!==text)throw Error();
   let rejected=false;try{await decryptPii(env,'nightly:wrong-context',envelope)}catch{rejected=true}if(!rejected)throw Error();
  }),
  check('storage','専用の点検データ保存・取得・削除',async()=>{
   const key='maintenance:probe:v1:'+id,value=crypto.randomUUID();
   try{await store.put(key,value,{expirationTtl:600});if(await runtimeStore(env).get(key)!==value)throw Error()}
   finally{await store.delete(key)}
   if(await runtimeStore(env).get(key)!==null)throw Error();
   return '点検専用の一時データのみを使用しました。';
  }),
  check('storedPii','既存の個人情報の復号・平文残存（標本）',async()=>{
   const query=new URLSearchParams({select:'path,data',or:'(coll.eq.members,coll.eq.applications,path.like.data/users/*/profile)',order:'path',limit:'20'});
   const rows=await database(null,'documents?'+query,{serviceKey:env.SUPABASE_RUNTIME_SERVICE_ROLE_KEY});if(!Array.isArray(rows))throw Error();
   let checked=0;
   for(const row of rows){const fields=privateFields(row.path);if(!fields)continue;
    if(fields.some(field=>Object.hasOwn(row.data||{},field))||row.data?._piiVersion!==1)throw Error();
    await openDocument(env,row.path,row.data);checked++;
   }
   for(const prefix of KV_PRIVATE_PREFIXES){const page=await store.list({prefix,limit:10});for(const entry of page.keys){const envelope=await store.get(entry.name,'json');if(envelope?.format!=='ikigai-pii')throw Error();await decryptPii(env,entry.name,envelope);checked++}}
   return `${checked}件を標本確認しました。全件・バックアップの確認ではありません。内容は記録しません。`;
  }),
  check('knowledge','登録知識の読み取り・復号（最大10件）',async()=>{
   const page=await manageKnowledge(env,{action:'list'},'nightly-audit');
   if(!page.records.length)return {status:'warning',detail:'登録知識がありません。SHINの考えに基づく回答の準備を確認してください。'};
   return `${page.records.length}件を確認しました。原文やタイトルは記録しません。${page.cursor?'続きがあるため全件点検ではありません。':''}`;
  })
 ]);
 for(const [key,label] of [['publicFiles','公開URLの設定ファイル露出検査'],['publicSecrets','公開ファイルの秘密鍵混入検査'],['dependencies','直接参照SDKの既知脆弱性検査'],['apiAccess','匿名APIアクセスの拒否'],['apiMaintenance','APIの点検時間停止']]){
  const value=external[key];
  add(key,label,['pass','warning','unverified','critical'].includes(value)?value:'unverified',key==='publicFiles'?'代表する3つの設定ファイルURLのみを検査します。すべての公開ファイルや過去の漏洩の検査ではありません。':key==='apiAccess'?'認証がない状態での限定した読み取り要求を検査します。点検時間中は認証より先に停止されるため権限確認は未確認です。':key==='apiMaintenance'?'GitHubから代表APIへの応答を検査します。点検時間外は未確認です。':key==='dependencies'?'npm CDNで直接参照するSDKが対象です。間接依存・その他の外部サービスは対象外です。検査APIに接続できない場合は未確認です。':'GitHub側の公開対象ファイル検査です。過去の配信内容や外部保存分の検査ではありません。');
 }
 add('attackLogs','WAF・DDoS・不正アクセスのログ調査','unverified','Cloudflareの攻撃・通信ログへの接続が未設定のため未確認です。');
 add('authLogs','認証履歴・アカウント乗っ取り調査','unverified','Supabaseの認証・監査ログへの接続が未設定のため未確認です。');
 add('leaks','過去の漏洩・侵入の有無','unverified','この点検だけで漏洩や侵入がないことは証明できません。ログ、バックアップ、外部保存先の確認が別途必要です。');
 const critical=checks.some(c=>c.status==='critical');
 const status=critical?'critical':checks.some(c=>c.status==='error')?'error':checks.some(c=>c.status==='warning')?'warning':'incomplete';
 const report={version:1,id,startedAt,finishedAt:new Date().toISOString(),status,checks};
 if(critical){await db('ikigai_maintenance_finish_v1',{p_critical:true,p_completed:false});clearMaintenanceCache()}
 // Save evidence before finishing; a failed audit never appears as a completed success.
 await store.put('maintenance:report:v1:'+id,JSON.stringify(report),{expirationTtl:RETENTION});
 await store.put(LATEST,JSON.stringify(report),{expirationTtl:RETENTION});
 await db('ikigai_maintenance_finish_v1',{p_critical:critical});clearMaintenanceCache();
 return report;
}
