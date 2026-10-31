export function mountSecurity({request,active,onState=()=>{}}){
 const status=document.querySelector('#securityStatus'),buttons=['securityRefresh','securityMigrate','securityVerify'].map(id=>document.getElementById(id));let busy=false;
 async function run(action){
  if(busy||!active())return;busy=true;buttons.forEach(button=>button.disabled=true);
  try{
   const state=await request({action:'status'});if(!active())return;
   if(action==='status'){
    status.textContent=`暗号鍵：${state.keyReady?'確認済み':'未確認'} ／ DB準備：${state.database?'完了':'未完了'} ／ 未移行：${state.database?.remaining??'未確認'}件 ／ 平文保存の制限：${state.database?.enforced?'有効':'準備中'}`;onState(state);return;
   }
   if(!state.keyReady)throw Error('暗号鍵の設定を確認してください。');
   if(!state.database)throw Error('先にSupabaseの準備用SQLを実行してください。');
   if(!state.maintenance)throw Error('移行中の書き込み停止設定が必要です。管理者向けの移行手順をご確認ください。');
   if(action==='migrate'){
    if(!state.migrationKeyReady)throw Error('一時的なデータ移行用のサーバー秘密鍵を設定してください。');
    // Confirm KV write drain BEFORE starting either storage migration.
    await request({action:'verify-kv',prefixIndex:0});
    let cursor=null,converted=0,conflicts=0;
    do{if(!active())throw Error('移行を中断しました。この画面から再開できます。');const page=await request({action:'documents',cursor});converted+=page.converted;conflicts+=page.conflicts;cursor=page.cursor;status.textContent=`暗号化中：${converted}件。画面を開いたままお待ちください。`}while(cursor);
    let prefixIndex=0;cursor=null;
    do{if(!active())throw Error('移行を中断しました。この画面から再開できます。');const page=await request({action:'kv',prefixIndex,cursor});converted+=page.converted;prefixIndex=page.prefixIndex;cursor=page.cursor;status.textContent=`暗号化中：${converted}件。`}while(prefixIndex<3);
    status.textContent=`移行処理：${converted}件。${conflicts?'更新が重なったため再試行が必要：'+conflicts+'件。':''}1分以上待って「移行結果を確認」を押してください。`;return;
   }
   if(state.database.remaining!==0)throw Error(`未移行のデータが${state.database.remaining}件あります。「既存データを暗号化」を再実行してください。`);
   if(!state.migrationKeyReady)throw Error('移行用の一時設定が必要です。');
   let docCursor=null,docRemaining=0,docVerified=0;
   do{if(!active())throw Error('確認を中断しました。');const page=await request({action:'verify-documents',cursor:docCursor});docRemaining+=page.remaining;docVerified+=page.verified;docCursor=page.cursor;status.textContent=`プロフィール・申込等の復号を確認中：${docVerified}件。`}while(docCursor);
   if(docRemaining)throw Error('未移行のデータがあります。移行を再実行してください。');
   let prefixIndex=0,cursor=null,remaining=0,verified=0;
   do{if(!active())throw Error('確認を中断しました。');const page=await request({action:'verify-kv',prefixIndex,cursor});remaining+=page.remaining;verified+=page.verified;prefixIndex=page.prefixIndex;cursor=page.cursor;status.textContent=`問い合わせ・トーク名の保護を確認中：${verified}件。`}while(prefixIndex<3);
   if(remaining)throw Error(`未移行の問い合わせ等が${remaining}件あります。少し待って再確認し、残る場合は移行を再実行してください。`);
   const result=await request({action:'enforce'});
   if(result.database?.remaining!==0||result.database?.enforced!==true)throw Error('保護設定を確認できませんでした。');
   status.textContent='現在の対象データの暗号化と平文保存の制限を確認しました。移行用の一時設定を削除し、再公開してください。過去のバックアップ・外部保存分は別途管理が必要です。';
  }catch(error){if(active())status.textContent=error.message||'処理を完了できませんでした。'}
  finally{busy=false;buttons.forEach(button=>button.disabled=false)}
 }
 buttons[0].onclick=()=>run('status');buttons[1].onclick=()=>run('migrate');buttons[2].onclick=()=>run('verify');
 const transferButtons=['storageConfig','storageCopy','storageVerify'].map(id=>document.getElementById(id));
 let transferring=false;
 async function transfer(action){
  if(transferring||busy||!active())return;transferring=true;[...buttons,...transferButtons].forEach(button=>button.disabled=true);const box=document.getElementById('storageStatus');
  try{
   const config=await request({action:'runtime-status'});if(!active())return;
   if(action==='runtime-status'){box.textContent=`移行先：${config.targetReady?'準備済み':'未準備'} ／ 使用先：${config.active?'Supabase':'KV'} ／ 移行中の書き込み停止：${config.locked?'有効':'無効'}`;return}
   if(!config.targetReady)throw Error('Supabaseの準備用SQLとサーバー秘密鍵の設定を確認してください。');
   if(!config.locked)throw Error('移行中の書き込み停止設定が必要です。');
   let cursor=null,total=0,missing=0;
   do{if(!active())throw Error('移行を中断しました。同じ画面から再開できます。');const page=await request({action,cursor});total+=action==='runtime-copy'?page.copied:page.verified;missing+=page.missing||0;cursor=page.cursor;box.textContent=`処理中：${total}件。画面を開いたままお待ちください。`}while(cursor);
   box.textContent=action==='runtime-copy'?`移行処理：${total}件。「移行先を照合」を押してください。`:missing?`未移行が${missing}件あります。「データを移行」を再実行してください。`:`${total}件の照合が完了しました。RUNTIME_STORAGEをsupabaseに設定し、RUNTIME_TRANSFER_LOCKを削除して再公開してください。`;
  }catch(error){if(active())box.textContent=error.message||'処理を完了できませんでした。'}
  finally{transferring=false;[...buttons,...transferButtons].forEach(button=>button.disabled=false)}
 }
 if(transferButtons.every(Boolean)){transferButtons[0].onclick=()=>transfer('runtime-status');transferButtons[1].onclick=()=>transfer('runtime-copy');transferButtons[2].onclick=()=>transfer('runtime-verify')}
 return {refresh:()=>run('status')};
}
