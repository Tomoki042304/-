const TYPES={note:'志動録ノート購入',training:'企業研修について',withdrawal:'退会について'};
export function mountInquiry({request,account,isAdmin,name,onNotice,viewing=()=>false}){
  const $=s=>document.querySelector(s),form=$('#inquiryForm'),type=$('#inquiryType'),reason=$('#inquiryReason'),confirm=$('#inquiryConfirm'),submit=$('#inquirySubmit');
  let selfToken=0,adminToken=0,selfBusy=false,adminBusy=false,current=null,rows=[],cursor=null,draftKey='',draftSignature='';
  let noticeTimer=0,noticeToken=0,noticeBusy=false,noticesStarted=false;const handledIds=new Set();
  function noticeDot(on){if(onNotice)return;for(const id of ['#inquiryAdminDot','#inquiryEntryDot']){const dot=$(id);if(dot)dot.hidden=!on}}
  async function pollNotices(){
    clearTimeout(noticeTimer);if(noticeBusy||!noticesStarted||!account()||!isAdmin()||document.visibilityState!=='visible')return;
    const token=++noticeToken,uid=account();noticeBusy=true;
    try{
      let next,found=false;const all=[],cursors=new Set();
      do{const data=await request('admin',undefined,next);if(token!==noticeToken||account()!==uid||!isAdmin())return;
        if(!Array.isArray(data.requests))throw Error('invalid inbox');
        all.push(...data.requests.filter(r=>r.status==='pending'&&!handledIds.has(r.requestId)));found=all.length>0;next=data.cursor;
        if(next){if(cursors.has(next))throw Error('invalid cursor');cursors.add(next)}
      }while(next&&(onNotice||!found));
      if(onNotice)onNotice(all,{complete:true,viewed:false});else noticeDot(found);
    }catch{}finally{if(token===noticeToken){noticeBusy=false;if(noticesStarted&&account()&&isAdmin())noticeTimer=setTimeout(pollNotices,30000)}}
  }
  function startNotices(){if(!isAdmin())return;noticesStarted=true;void pollNotices()}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&noticesStarted)void pollNotices();else clearTimeout(noticeTimer)});
  const date=s=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  function selfControls(ready){type.disabled=selfBusy;reason.disabled=!ready||selfBusy;confirm.disabled=reason.disabled;submit.disabled=reason.disabled;$('#inquiryReload').disabled=selfBusy;$('#inquiryReasonLabel').textContent=type.value==='withdrawal'?'退会理由（必須）':'お問い合わせ内容（必須）';confirm.required=type.value==='withdrawal';$('#inquiryConfirmRow').hidden=type.value!=='withdrawal';submit.textContent=selfBusy?'確認中…':'管理者へ送信する'}
  async function loadSelf(send=false){
    if(!account()||selfBusy)return;
    if(send&&(!reason.value.trim()||(type.value==='withdrawal'&&!confirm.checked))){$('#inquiryStatus').textContent='内容を入力し、退会については「退会希望」にチェックしてください。';return}
    if(send){const signature=JSON.stringify([type.value,reason.value.trim(),confirm.checked]);if(signature!==draftSignature||!draftKey){draftKey=crypto.randomUUID();draftSignature=signature;}}
    const token=++selfToken,uid=account(),selected=type.value,payload=send?{name:name(),reason:reason.value.trim(),confirmed:confirm.checked,requestId:draftKey}:undefined;
    selfBusy=true;selfControls(false);$('#inquiryStatus').textContent=send?'管理者へ送信しています…':'送信状況を確認しています…';
    try{
      const data=await request('self',payload,undefined,selected);if(token!==selfToken||account()!==uid)return;
      current=data.request;if(send){draftKey='';draftSignature='';}
      if(current){reason.value='';confirm.checked=false;$('#inquiryStatus').textContent=(send?'管理者へ送信しました。':current.status==='handled'?'管理者が確認済みです。':'管理者へ送信済みです。')+'（'+date(current.submittedAt)+'）';}
      else $('#inquiryStatus').textContent='';
      selfBusy=false;selfControls(true);
    }catch(e){if(token!==selfToken||account()!==uid)return;$('#inquiryStatus').textContent=e.name==='AbortError'?'時間がかかっています。「送信状況を確認」で結果を確認してください。':e.message||'連絡を保存できませんでした。';selfBusy=false;selfControls(send);}
    finally{if(token===selfToken){selfBusy=false;type.disabled=false;$('#inquiryReload').disabled=false}}
  }
  const pendingRows=()=>rows.filter(row=>row.status==='pending'&&!handledIds.has(row.requestId));
  function renderAdmin(){
    const list=$('#inquiryAdminList');list.replaceChildren();
    for(const row of pendingRows()){const box=document.createElement('article');box.className='inquiry-item';const head=document.createElement('b');head.textContent=(row.name||'メンバー')+' ／ '+TYPES[row.type];const info=document.createElement('small');info.textContent=date(row.submittedAt)+' · '+(row.status==='pending'?'未確認':'確認済み');const who=document.createElement('small');who.textContent=(row.email?row.email+' ／ ':'')+'ID: '+row.uid;const text=document.createElement('p');text.textContent=row.reason;box.append(head,info,who,text);
      if(row.status==='pending'){const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent='確認済みにする';button.onclick=()=>handle(row);box.append(button)}else if(row.handledAt){const done=document.createElement('small');done.textContent='確認：'+date(row.handledAt);box.append(done)}list.append(box)}
    $('#inquiryAdminMore').hidden=!cursor;
    $('#inquiryAdminStatus').textContent=pendingRows().length?'未確認 '+pendingRows().length+'件':cursor?'この範囲に未確認の問い合わせはありません。「もっと見る」で続きを確認できます。':'未確認の問い合わせはありません。';
  }
  async function loadAdmin(more=false){
    if(!account()||!isAdmin()||adminBusy)return;
    const token=++adminToken,uid=account();adminBusy=true;$('#inquiryAdminRefresh').disabled=true;$('#inquiryAdminMore').disabled=true;$('#inquiryAdminStatus').textContent='読み込んでいます…';
    try{const data=await request('admin',undefined,more?cursor:undefined);if(token!==adminToken||account()!==uid||!isAdmin())return;if(!Array.isArray(data.requests))throw Error('一覧を読み込めませんでした。');rows=[...new Map([...(more?rows:[]),...data.requests].map(r=>[r.requestId,r])).values()];cursor=data.cursor;renderAdmin();if(onNotice)onNotice(pendingRows(),{complete:!cursor,viewed:viewing()});if(rows.some(r=>r.status==='pending'&&!handledIds.has(r.requestId)))noticeDot(true);if(noticesStarted)void pollNotices();}
    catch(e){if(token===adminToken)$('#inquiryAdminStatus').textContent=e.message||'一覧を読み込めませんでした。'}
    finally{if(token===adminToken){adminBusy=false;$('#inquiryAdminRefresh').disabled=false;$('#inquiryAdminMore').disabled=false}}
  }
  async function handle(row){
    if(!account()||!isAdmin()||adminBusy)return;
    const token=++adminToken,uid=account();adminBusy=true;$('#inquiryAdminList').querySelectorAll('button').forEach(b=>b.disabled=true);
    try{const data=await request('admin',{action:'handle',uid:row.uid,type:row.type,requestId:row.requestId});if(token!==adminToken||account()!==uid||!isAdmin())return;handledIds.add(row.requestId);rows=rows.map(r=>r.requestId===row.requestId?data.request:r);renderAdmin();void pollNotices();$('#inquiryAdminStatus').textContent='確認済みにして一覧から非表示にしました。'+(pendingRows().length?' 未確認 '+pendingRows().length+'件':cursor?'「もっと見る」で続きを確認できます。':'未確認の問い合わせはありません。');}
    catch(e){if(token===adminToken)$('#inquiryAdminStatus').textContent=e.message||'確認状況を保存できませんでした。';}
    finally{if(token===adminToken){adminBusy=false;$('#inquiryAdminList').querySelectorAll('button').forEach(b=>b.disabled=false)}}
  }
  form.onsubmit=e=>{e.preventDefault();loadSelf(true)};
  type.onchange=()=>{current=null;reason.value='';confirm.checked=false;loadSelf()};
  $('#inquiryReload').onclick=()=>loadSelf();$('#inquiryAdminRefresh').onclick=()=>loadAdmin();$('#inquiryAdminMore').onclick=()=>loadAdmin(true);
  function clearAdmin(){noticesStarted=false;clearTimeout(noticeTimer);noticeToken++;noticeBusy=false;handledIds.clear();noticeDot(false);adminToken++;adminBusy=false;rows=[];cursor=null;$('#inquiryAdminList').replaceChildren();$('#inquiryAdminStatus').textContent='';$('#inquiryAdminMore').hidden=true;$('#inquiryAdminRefresh').disabled=false;}
  function stop(){draftKey='';draftSignature='';selfToken++;selfBusy=false;current=null;reason.value='';confirm.checked=false;selfControls(false);clearAdmin();$('#inquiryStatus').textContent='';}
  return {startNotices,open(which){if(which==='admin')loadAdmin();else loadSelf()},stop,clearAdmin};
}
