const TYPES={note:'志動録ノート購入',training:'企業研修について',withdrawal:'退会について'};
export function mountInquiry({request,account,isAdmin,name}){
  const $=s=>document.querySelector(s),form=$('#inquiryForm'),type=$('#inquiryType'),reason=$('#inquiryReason'),confirm=$('#inquiryConfirm'),submit=$('#inquirySubmit');
  let selfToken=0,adminToken=0,selfBusy=false,adminBusy=false,current=null,rows=[],cursor=null;
  const date=s=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
  function selfControls(ready){type.disabled=selfBusy;reason.disabled=!ready||selfBusy||current?.status==='pending';confirm.disabled=reason.disabled;submit.disabled=reason.disabled;$('#inquiryReload').disabled=selfBusy;$('#inquiryReasonLabel').textContent=type.value==='withdrawal'?'退会理由（必須）':'お問い合わせ内容（必須）';confirm.required=type.value==='withdrawal';$('#inquiryConfirmRow').hidden=type.value!=='withdrawal';submit.textContent=current?.status==='pending'?'送信済み':'管理者へ送信する'}
  async function loadSelf(send=false){
    if(!account()||selfBusy)return;
    if(send&&(!reason.value.trim()||(type.value==='withdrawal'&&!confirm.checked))){$('#inquiryStatus').textContent='内容を入力し、退会については「退会希望」にチェックしてください。';return}
    const token=++selfToken,uid=account(),selected=type.value,payload=send?{name:name(),reason:reason.value.trim(),confirmed:confirm.checked}:undefined;
    selfBusy=true;selfControls(false);$('#inquiryStatus').textContent=send?'管理者へ送信しています…':'送信状況を確認しています…';
    try{
      const data=await request('self',payload,undefined,selected);if(token!==selfToken||account()!==uid)return;
      current=data.request;
      if(current){reason.value=current.reason;confirm.checked=selected==='withdrawal';$('#inquiryStatus').textContent=(send?'管理者へ送信しました。':current.status==='handled'?'管理者が確認済みです。':'管理者へ送信済みです。')+'（'+date(current.submittedAt)+'）';}
      else $('#inquiryStatus').textContent='';
      selfBusy=false;selfControls(true);
    }catch(e){if(token!==selfToken||account()!==uid)return;$('#inquiryStatus').textContent=e.name==='AbortError'?'時間がかかっています。「送信状況を確認」で結果を確認してください。':e.message||'連絡を保存できませんでした。';selfBusy=false;selfControls(send);}
    finally{if(token===selfToken){selfBusy=false;type.disabled=false;$('#inquiryReload').disabled=false}}
  }
  function renderAdmin(){
    const list=$('#inquiryAdminList');list.replaceChildren();
    for(const row of rows){const box=document.createElement('article');box.className='inquiry-item';const head=document.createElement('b');head.textContent=(row.name||'メンバー')+' ／ '+TYPES[row.type];const info=document.createElement('small');info.textContent=date(row.submittedAt)+' · '+(row.status==='pending'?'未確認':'確認済み');const who=document.createElement('small');who.textContent=(row.email?row.email+' ／ ':'')+'ID: '+row.uid;const text=document.createElement('p');text.textContent=row.reason;box.append(head,info,who,text);
      if(row.status==='pending'){const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent='確認済みにする';button.onclick=()=>handle(row);box.append(button)}else if(row.handledAt){const done=document.createElement('small');done.textContent='確認：'+date(row.handledAt);box.append(done)}list.append(box)}
    $('#inquiryAdminMore').hidden=!cursor;
  }
  async function loadAdmin(more=false){
    if(!account()||!isAdmin()||adminBusy)return;
    const token=++adminToken,uid=account();adminBusy=true;$('#inquiryAdminRefresh').disabled=true;$('#inquiryAdminMore').disabled=true;$('#inquiryAdminStatus').textContent='読み込んでいます…';
    try{const data=await request('admin',undefined,more?cursor:undefined);if(token!==adminToken||account()!==uid||!isAdmin())return;if(!Array.isArray(data.requests))throw Error('一覧を読み込めませんでした。');rows=more?[...new Map([...rows,...data.requests].map(r=>[r.requestId,r])).values()]:data.requests;cursor=data.cursor;renderAdmin();$('#inquiryAdminStatus').textContent=rows.length?'表示 '+rows.length+'件（未確認 '+rows.filter(r=>r.status==='pending').length+'件）':'問い合わせはありません。';}
    catch(e){if(token===adminToken)$('#inquiryAdminStatus').textContent=e.message||'一覧を読み込めませんでした。'}
    finally{if(token===adminToken){adminBusy=false;$('#inquiryAdminRefresh').disabled=false;$('#inquiryAdminMore').disabled=false}}
  }
  async function handle(row){
    if(!account()||!isAdmin()||adminBusy)return;
    const token=++adminToken,uid=account();adminBusy=true;$('#inquiryAdminList').querySelectorAll('button').forEach(b=>b.disabled=true);
    try{const data=await request('admin',{action:'handle',uid:row.uid,type:row.type,requestId:row.requestId});if(token!==adminToken||account()!==uid||!isAdmin())return;rows=rows.map(r=>r.requestId===row.requestId?data.request:r);renderAdmin();$('#inquiryAdminStatus').textContent='確認済みにしました。アカウント・データは変更していません。';}
    catch(e){if(token===adminToken)$('#inquiryAdminStatus').textContent=e.message||'確認状況を保存できませんでした。';}
    finally{if(token===adminToken){adminBusy=false;$('#inquiryAdminList').querySelectorAll('button').forEach(b=>b.disabled=false)}}
  }
  form.onsubmit=e=>{e.preventDefault();loadSelf(true)};
  type.onchange=()=>{current=null;reason.value='';confirm.checked=false;loadSelf()};
  $('#inquiryReload').onclick=()=>loadSelf();$('#inquiryAdminRefresh').onclick=()=>loadAdmin();$('#inquiryAdminMore').onclick=()=>loadAdmin(true);
  function clearAdmin(){adminToken++;adminBusy=false;rows=[];cursor=null;$('#inquiryAdminList').replaceChildren();$('#inquiryAdminStatus').textContent='';$('#inquiryAdminMore').hidden=true;$('#inquiryAdminRefresh').disabled=false;}
  function stop(){selfToken++;selfBusy=false;current=null;reason.value='';confirm.checked=false;selfControls(false);clearAdmin();$('#inquiryStatus').textContent='';}
  return {open(which){if(which==='admin')loadAdmin();else loadSelf()},stop,clearAdmin};
}
