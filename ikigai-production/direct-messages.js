import {messageBlocks,messageShell,dayDivider} from './talk-message-layout.js';
export function mountDirectMessages({request,account,isAdmin,beforeOpen=()=>{},avatar=null,day=at=>new Date(at).toLocaleDateString('ja-JP'),timeLabel=at=>new Date(at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}){
  const $=s=>document.querySelector(s);let threads=[],active=null,messages=[],accessSince=0,older=null,convToken=0,inboxToken=0,timer=0,started=false,polling=false,draftId=crypto.randomUUID();const drafts=new Map(),localReads=new Map(),sends=new Set(),cancelling=new Set();let createToken=0,pollFailures=0,readOnly=true,activeThread=null;
  const visible=()=>account()&&document.visibilityState==='visible';
  function senderName(id){return id===activeThread?.hostUid?activeThread.hostName:id===activeThread?.memberUid?activeThread.memberName:'メンバー'}
  function senderAvatar(id,name){let photo=typeof avatar==='function'?avatar(id,name):null;if(!photo){photo=document.createElement('span');photo.className='avatar';photo.style.backgroundColor='#7a1f33';photo.textContent=(name||'志').slice(0,1)}photo.setAttribute('role','img');photo.setAttribute('aria-label',(name||'メンバー')+'のプロフィール写真');return photo}
  function paintPeer(thread){
    const uid=account(),peer=readOnly?thread.memberUid:thread.hostUid===uid?thread.memberUid:thread.hostUid,name=senderName(peer);
    $('#dmPeerAvatar').replaceChildren(senderAvatar(peer,name));
  }
  function dots(){const unread=threads.some(t=>t.unread&&(!Array.isArray(t.incomingIds)||t.incomingIds.some(id=>!localReads.get(t.id)?.has(id))));$('#dmUnreadDot').hidden=!unread;$('#dmTabDot').hidden=!unread;$('#talkPrivateTab').setAttribute('aria-label',unread?'個人チャット（未読あり）':'個人チャット')}
  function renderInbox(){const box=$('#dmInbox');box.replaceChildren();for(const t of threads){const button=document.createElement('button');button.type='button';button.className='dm-thread';button.dataset.threadId=t.id;const name=document.createElement('b');name.textContent=t.peerName;button.append(name);const unread=t.unread&&(!Array.isArray(t.incomingIds)||t.incomingIds.some(id=>!localReads.get(t.id)?.has(id)));if(unread){const dot=document.createElement('span');dot.className='unread';dot.setAttribute('aria-label','未読');button.append(dot)}button.onclick=()=>open(t.id);box.append(button)}$('#dmInboxStatus').textContent=threads.length?'相手ごとの個人チャットを表示しています。':isAdmin()?'メンバー一覧の「チャット」から個別トークを開始できます。':'管理者からの個別連絡はまだありません。';dots()}
  async function refreshInbox(){if(!visible())return;const token=++inboxToken,uid=account(),all=[];let cursor;try{do{const data=await request({action:'inbox',...(cursor?{cursor}:{})});if(token!==inboxToken||account()!==uid)return;all.push(...data.threads);cursor=data.cursor;}while(cursor);threads=[...new Map(all.map(t=>[t.id,t])).values()].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));renderInbox()}catch(e){if(token===inboxToken)$('#dmInboxStatus').textContent=e.message||'個別トーク一覧を更新できませんでした。'}}
  function mergeMessages(rows){
    const map=new Map(messages.map(m=>[m.id,m]));
    for(const m of rows){const old=map.get(m.id);const unsent=old?.unsent||m.unsent;map.set(m.id,{...old,...m,read:!!old?.read||!!m.read,unsent:!!unsent,text:unsent?'':m.text});}
    messages=[...map.values()].filter(m=>Date.parse(m.at)>=accessSince).sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
  }
  function renderMessages(scroll=false){
    const box=$('#dmMessages'),bottom=box.scrollHeight-box.scrollTop-box.clientHeight<80,position=box.scrollTop,height=box.scrollHeight;
    box.replaceChildren();const block=messageBlocks(day);
    for(const m of messages.filter(m=>!m.unsent)){
      const mine=m.senderUid===account(),state=block(m.senderUid,m.at);if(state.day)box.append(dayDivider(state.day));const {row,body:messageBody,line}=messageShell({mine,first:state.first,name:senderName(m.senderUid),avatar:()=>senderAvatar(m.senderUid,senderName(m.senderUid)),className:'dm-row'+(mine?' mine':'')});row.dataset.messageId=m.id;
      const actionable=!readOnly&&mine&&!m.unsent&&!m.pending&&!m.failed,text=document.createElement(actionable?'button':'div');if(actionable)text.type='button';
      text.className='dm-bubble bubble';text.textContent=m.text;
      if(!readOnly&&!m.unsent&&!m.pending&&!m.failed){text.dataset.reactionScope='direct';text.dataset.reactionThread=active;text.dataset.reactionSender=m.senderUid;text.dataset.reactionMessage=m.id;text.tabIndex=0;text.setAttribute('role','button');text.setAttribute('aria-label','リアクションとメッセージ操作を開く');}
      if(actionable){text.setAttribute('aria-label','メッセージの操作を開く');text.setAttribute('aria-expanded','false');text.onclick=()=>{
        const old=row.querySelector('.dm-actions');if(old){old.remove();text.setAttribute('aria-expanded','false');return}
        box.querySelectorAll('.dm-actions').forEach(el=>el.remove());box.querySelectorAll('[aria-expanded=true]').forEach(el=>el.setAttribute('aria-expanded','false'));
        const menu=document.createElement('div');menu.className='dm-actions';const cancel=document.createElement('button');cancel.type='button';cancel.textContent=cancelling.has(m.id)?'取り消し中…':'送信取り消し';cancel.disabled=cancelling.has(m.id);cancel.onclick=()=>unsend(m.id);menu.append(cancel);messageBody.append(menu);text.setAttribute('aria-expanded','true');
      };}
      const meta=document.createElement('div');meta.className='dm-meta meta';const time=document.createElement('time');time.dateTime=m.at;time.textContent=timeLabel(m.at);
      if(mine&&!m.unsent&&(m.pending||m.failed||m.read)){const state=document.createElement('span');state.className='dm-delivery read';state.textContent=m.pending?'送信中…':m.failed?'未送信・再送できます':'既読';meta.append(state)}
      meta.append(time);line.append(text,meta);box.append(row);
    }
    if(scroll||bottom)box.scrollTop=box.scrollHeight;else box.scrollTop=position+Math.max(0,box.scrollHeight-height);$('#dmOlder').hidden=!older;
  }
  async function unsend(messageId){
    if(readOnly||!active||cancelling.has(messageId))return;const id=active,token=convToken,uid=account();cancelling.add(messageId);renderMessages();$('#dmStatus').textContent='送信を取り消しています…';
    try{const data=await request({action:'unsend',threadId:id,id:messageId});if(token!==convToken||uid!==account())return;mergeMessages([data.message]);renderMessages();$('#dmStatus').textContent=''}catch(e){if(token===convToken)$('#dmStatus').textContent=e.message||'取り消せませんでした。もう一度お試しください。'}finally{cancelling.delete(messageId)}
  }
  async function markRead(token){if(readOnly||!visible()||!active||$('#v-mates').hidden||$('#dmConversation').hidden)return;const uid=account(),id=active,ids=messages.filter(m=>!m.unsent&&m.senderUid!==uid&&!localReads.get(id)?.has(m.id)).slice(-40).map(m=>m.id);if(!ids.length)return;try{await request({action:'read',threadId:id,ids});if(token!==convToken||account()!==uid)return;const seen=localReads.get(id)||new Set();ids.forEach(x=>seen.add(x));localReads.set(id,seen);renderInbox()}catch{}}
  async function refreshMessages(more=false,forceScroll=false){if(!visible()||!active||$('#v-mates').hidden)return;const token=convToken,uid=account(),id=active;try{const data=await request({action:'messages',threadId:id,...(more&&older?{cursor:older}:{})});if(token!==convToken||account()!==uid||id!==active)return;if(typeof data.since!=='string'||!Number.isFinite(Date.parse(data.since)))throw Error('トークの利用情報を確認できませんでした。');readOnly=data.readOnly===true;activeThread=data.thread;paintPeer(data.thread);$('#dmForm').hidden=readOnly;$('#dmSend').disabled=readOnly||sends.has(id);$('#dmInput').disabled=readOnly||sends.has(id);accessSince=Date.parse(data.since);$('#dmPeer').textContent=readOnly?data.thread.memberName+' ／ SHIN':data.thread.hostUid===uid?data.thread.memberName:data.thread.hostName;mergeMessages(data.messages);if(more||!older||messages.length<=20)older=data.cursor;renderMessages(forceScroll);$('#dmStatus').textContent=readOnly?'管理者の確認用トークです（閲覧専用）。':messages.some(m=>!m.unsent)?'':'最初のメッセージを送ってみましょう。';await markRead(token);return true}catch(e){if(token===convToken){if(e.status===401||e.status===403){messages=[];older=null;}renderMessages();$('#dmStatus').textContent=e.message||'メッセージを読み込めませんでした。';}return false}}
  function saveDraft(){if(active)drafts.set(active,{text:$('#dmInput').value,id:draftId})}
  async function open(id){if(!account())return;$('#dmPeerAvatar').replaceChildren();beforeOpen();createToken++;saveDraft();readOnly=true;activeThread=null;$('#dmForm').hidden=true;active=id;convToken++;messages=[];accessSince=0;older=null;const draft=drafts.get(id);$('#dmInput').value=draft?.text||'';draftId=draft?.id||crypto.randomUUID();$('#dmConversation').hidden=false;$('#mtChat').hidden=true;$('#privateChatList').hidden=true;window.dispatchEvent(new Event('ikigai-direct-open'));$('#dmPanel').hidden=true;$('#dmPeer').textContent=threads.find(t=>t.id===id)?.peerName||'個別トーク';$('#dmMessages').replaceChildren();$('#dmStatus').textContent='読み込んでいます…';$('#dmSend').disabled=sends.has(id);$('#dmInput').disabled=sends.has(id);if(started){clearTimeout(timer);timer=setTimeout(cycle,8000)}await refreshMessages(false,true)}
  function leave(){createToken++;saveDraft();active=null;convToken++;$('#dmConversation').hidden=true;$('#mtChat').hidden=false;$('#dmPanel').hidden=true;}
  async function create(memberUid){
    if(!isAdmin())throw Error('管理者のみ開始できます。');$('#dmPeerAvatar').replaceChildren();beforeOpen();leave();const token=++createToken,uid=account();$('#dmConversation').hidden=false;$('#mtChat').hidden=true;$('#privateChatList').hidden=true;window.dispatchEvent(new Event('ikigai-direct-open'));$('#dmPeer').textContent='個別トーク';$('#dmMessages').replaceChildren();$('#dmStatus').textContent='個別トークを開いています…';$('#dmSend').disabled=true;
    try{const data=await request({action:'create',memberUid});if(token!==createToken||account()!==uid)return;await open(data.thread.id);void refreshInbox()}catch(e){if(token===createToken)$('#dmStatus').textContent=e.message||'個別トークを開けませんでした。';throw e}
  }
  $('#dmForm').onsubmit=async e=>{
    e.preventDefault();if(readOnly||!active||!visible())return;const id=active;if(sends.has(id))return;const text=$('#dmInput').value.trim();if(!text)return;
    const token=convToken,uid=account(),messageId=draftId;sends.add(id);$('#dmSend').disabled=true;$('#dmInput').disabled=true;$('#dmStatus').textContent='送信しています…';
    const optimistic={id:messageId,threadId:id,senderUid:uid,text,at:new Date().toISOString(),pending:true};messages=messages.filter(m=>m.id!==messageId);messages.push(optimistic);renderMessages(true);
    try{const data=await request({action:'send',threadId:id,text,id:messageId});if(account()!==uid)return;drafts.delete(id);if(token!==convToken)return;
      mergeMessages([{...data.message,pending:false,failed:false}]);$('#dmInput').value='';draftId=crypto.randomUUID();renderMessages(true);$('#dmStatus').textContent='送信しました。';void refreshInbox();
    }catch(err){if(token===convToken){const m=messages.find(m=>m.id===messageId);if(m){m.pending=false;m.failed=true}renderMessages();$('#dmStatus').textContent=err.message||'送信できませんでした。入力内容を残しています。';}}
    finally{sends.delete(id);if(active===id){$('#dmSend').disabled=false;$('#dmInput').disabled=false}}
  };
  $('#dmRefresh').onclick=refreshInbox;$('#dmBack').onclick=()=>{leave();window.dispatchEvent(new Event('ikigai-direct-back'))};$('#dmOlder').onclick=()=>refreshMessages(true);
  async function cycle(){clearTimeout(timer);if(!started||!visible()||polling)return;polling=true;try{const results=await Promise.all([refreshInbox(),active&&!$('#v-mates').hidden?refreshMessages():Promise.resolve()]);pollFailures=results.some(result=>result===false)?pollFailures+1:0}finally{polling=false;if(started&&visible())timer=setTimeout(cycle,pollFailures?Math.min(300000,30000*Math.pow(2,pollFailures-1)):active&&!$('#v-mates').hidden?8000:30000)}}
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(started&&visible())cycle()});
  function start(){if(started){if(visible()&&!timer&&!polling)cycle();return}started=true;cycle()}
  function stop(){$('#dmPeerAvatar').replaceChildren();pollFailures=0;sends.clear();cancelling.clear();$('#dmInput').disabled=false;started=false;clearTimeout(timer);inboxToken++;convToken++;leave();threads=[];messages=[];drafts.clear();localReads.clear();$('#dmInput').value='';$('#dmInbox').replaceChildren();$('#dmMessages').replaceChildren();dots()}
  return {start,stop,leave,create,open,refresh:refreshInbox};
}
