export function mountGroups({request,account,nameOf,compose}){
 const $=s=>document.querySelector(s);let rooms=[],active=null,messages=[],older=null,isAdmin=false,timer=0,started=false,epoch=0,roomEpoch=0,busy=false,loading=false,listCursor=null,listPages=1;
 const drafts=new Map();let createDraft={id:crypto.randomUUID(),signature:''};
 const visible=()=>account()&&document.visibilityState==='visible'&&!$('#v-mates').hidden&&!$('#mtChat').hidden;
 const button=(text,fn)=>{const el=document.createElement('button');el.type='button';el.className='small-btn';el.textContent=text;el.onclick=fn;return el};
 function status(text){$('#groupStatus').textContent=text}
 function remember(){if(active){const old=drafts.get(active.id)||{};drafts.set(active.id,{...old,text:$('#groupText').value})}}
 function leave(){remember();++roomEpoch;active=null;messages=[];older=null;$('#groupMessages').replaceChildren();$('#groupRoom').hidden=true;$('#groupCommon').hidden=false;$('#groupText').value='';status('')}
 function renderInvites(){
  const box=$('#groupInviteList');box.replaceChildren();$('#groupInviteCount').textContent=rooms.length?'（'+rooms.length+'件）':'';
  for(const room of [...rooms].sort((a,b)=>b.at.localeCompare(a.at))){
   const card=document.createElement('article');card.className='group-invite';card.dataset.groupId=room.id;
   const title=document.createElement('b');title.textContent=room.name;const text=document.createElement('p');text.textContent=room.description||'仲間を募集しています。';
   const meta=document.createElement('small');meta.textContent=nameOf(room.ownerUid)+'からの招待・'+new Date(room.at).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'});
   const actions=document.createElement('div');actions.className='group-actions';actions.append(button(room.joined?'グループを開く':'参加する',()=>join(room)));
   if(isAdmin){const del=button('削除',()=>remove(room));del.classList.add('group-delete');actions.append(del)}
   card.append(title,text,meta,actions);box.append(card);
  }
  $('#groupInviteStatus').textContent=rooms.length?'招待は全会員に表示されます。会話は参加者と管理者だけが閲覧できます。':'グループの招待はまだありません。「グループ作成」から仲間を募集できます。';
  $('#groupInvitesMore').hidden=!listCursor;
 }
 async function refreshList(more=false){
  if(loading||!visible())return;loading=true;const uid=account(),version=epoch;
  try{const data=await request({action:'list',...(more&&listCursor?{cursor:listCursor}:{})});if(uid!==account()||version!==epoch)return;
   let all=data.groups,cursor=data.cursor;
   if(!more){for(let page=1;page<listPages&&cursor;page++){const next=await request({action:'list',cursor});if(uid!==account()||version!==epoch)return;all.push(...next.groups);cursor=next.cursor}}
   isAdmin=!!data.isAdmin;rooms=more?[...new Map([...rooms,...all].map(r=>[r.id,r])).values()]:all;if(more)listPages++;listCursor=cursor;renderInvites();
  }catch(error){if(uid===account()&&version===epoch)$('#groupInviteStatus').textContent=error.message||'招待を更新できませんでした。'}finally{if(version===epoch)loading=false}
 }
 function renderMessages(scroll=false){
  const box=$('#groupMessages'),near=box.scrollHeight-box.scrollTop-box.clientHeight<80,top=box.scrollTop,height=box.scrollHeight;box.replaceChildren();
  for(const m of messages){
   const mine=m.senderUid===account(),row=document.createElement('div');row.className='group-message'+(mine?' mine':'');row.dataset.messageId=m.id;
   const name=document.createElement('small');name.textContent=nameOf(m.senderUid);const body=document.createElement('p');body.textContent=m.unsent?'送信を取り消しました':m.text;body.className='group-bubble';
   const time=document.createElement('small');time.textContent=new Date(m.at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   row.append(name,body,time);if(mine&&!m.unsent)row.append(button('送信取り消し',()=>unsend(m.id)));box.append(row);
  }
  if(scroll||near)box.scrollTop=box.scrollHeight;else box.scrollTop=top+Math.max(0,box.scrollHeight-height);$('#groupOlder').hidden=!older;
 }
 async function loadMessages(more=false){
  if(!active||!visible())return;const id=active.id,uid=account(),version=roomEpoch;
  try{const data=await request({action:'messages',groupId:id,...(more&&older?{cursor:older}:{})});if(uid!==account()||version!==roomEpoch||active?.id!==id)return;
   isAdmin=!!data.isAdmin;active=data.group;$('#groupRoomTitle').textContent=active.name;$('#groupDelete').hidden=!isAdmin;
   const map=new Map(messages.map(m=>[m.id,m]));for(const m of data.messages){const old=map.get(m.id);map.set(m.id,{...m,...(old?.unsent?{unsent:true,text:''}:{})})}messages=[...map.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));if(more||messages.length===data.messages.length)older=data.cursor;renderMessages();status(messages.length?'':'まだメッセージはありません。');
  }catch(error){if(uid!==account()||version!==roomEpoch)return;if([403,404,410].includes(error.status)){leave();rooms=rooms.filter(r=>r.id!==id);renderInvites();$('#groupInviteStatus').textContent=error.message}else status(error.message||'会話を読み込めませんでした。')}
 }
 async function open(room){
  remember();++roomEpoch;active=room;messages=[];older=null;$('#groupCommon').hidden=true;$('#groupRoom').hidden=false;$('#groupRoomTitle').textContent=room.name;$('#groupDelete').hidden=!isAdmin;$('#groupMessages').replaceChildren();$('#groupText').value=drafts.get(room.id)?.text||'';status('読み込んでいます…');await loadMessages();
 }
 async function join(room){
  if(busy)return;busy=true;const uid=account(),version=epoch;$('#groupInviteStatus').textContent='グループを開いています…';
  try{const data=room.joined?{group:room}:await request({action:'join',groupId:room.id});if(uid!==account()||version!==epoch)return;rooms=rooms.map(r=>r.id===room.id?data.group:r);renderInvites();await open(data.group)}catch(error){if(uid===account()&&version===epoch)$('#groupInviteStatus').textContent=error.message||'参加できませんでした。'}finally{if(version===epoch)busy=false}
 }
 async function remove(room){
  if(busy||!isAdmin||!confirm('「'+room.name+'」を削除しますか？参加者全員が会話を閲覧・送信できなくなります。'))return;
  busy=true;const uid=account(),version=epoch;
  try{await request({action:'delete',groupId:room.id});if(uid!==account()||version!==epoch)return;if(active?.id===room.id)leave();drafts.delete(room.id);rooms=rooms.filter(r=>r.id!==room.id);renderInvites();$('#groupInviteStatus').textContent='グループを削除しました。'}catch(error){if(uid===account()&&version===epoch){status(error.message);$('#groupInviteStatus').textContent=error.message}}finally{if(version===epoch)busy=false}
 }
 async function unsend(id){
  if(busy||!active)return;busy=true;const room=active.id,uid=account(),version=roomEpoch,session=epoch;
  try{const data=await request({action:'unsend',groupId:room,id});if(uid!==account()||version!==roomEpoch)return;messages=messages.map(m=>m.id===id?data.message:m);renderMessages()}catch(error){if(uid===account()&&version===roomEpoch)status(error.message)}finally{if(session===epoch)busy=false}
 }
 $('#groupCreateSubmit').onclick=async()=>{
  if(busy||!account())return;const name=$('#groupName').value.trim(),description=$('#groupDescription').value.trim();
  if(!name){$('#groupCreateStatus').textContent='グループ名を入力してください。';$('#groupName').focus();return}
  const signature=JSON.stringify([name,description]);if(signature!==createDraft.signature)createDraft={id:crypto.randomUUID(),signature};
  busy=true;const uid=account(),version=epoch;$('#groupCreateSubmit').disabled=true;$('#groupCreateStatus').textContent='招待を公開しています…';
  try{const data=await request({action:'create',groupId:createDraft.id,name,description});if(uid!==account()||version!==epoch)return;isAdmin=!!data.isAdmin;rooms=[data.group,...rooms.filter(r=>r.id!==data.group.id)];renderInvites();$('#groupName').value='';$('#groupDescription').value='';$('#groupCreateStatus').textContent='';createDraft={id:crypto.randomUUID(),signature:''};compose('free');$('#groupInvites').open=true;await open(data.group)}catch(error){if(uid===account()&&version===epoch)$('#groupCreateStatus').textContent=error.message||'招待を公開できませんでした。'}finally{if(version===epoch){busy=false;$('#groupCreateSubmit').disabled=false}}
 };
 $('#groupComposer').onsubmit=async event=>{
  event.preventDefault();if(busy||!active||!account())return;const text=$('#groupText').value.trim();if(!text)return;
  const id=active.id,uid=account(),version=roomEpoch,session=epoch,old=drafts.get(id)||{};const draft={text,id:old.text===text&&old.id?old.id:crypto.randomUUID()};drafts.set(id,draft);
  busy=true;$('#groupSend').disabled=true;$('#groupText').disabled=true;status('送信しています…');
  try{const data=await request({action:'send',groupId:id,id:draft.id,text});if(uid!==account()||version!==roomEpoch)return;drafts.delete(id);$('#groupText').value='';messages=[...messages.filter(m=>m.id!==data.message.id),data.message].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));renderMessages(true);status('')}
  catch(error){if(uid===account()&&version===roomEpoch){if([403,404,410].includes(error.status)){leave();$('#groupInviteStatus').textContent=error.message;void refreshList()}else status(error.message||'送信できませんでした。入力は残っています。')}}
  finally{if(session===epoch){busy=false;$('#groupSend').disabled=false;$('#groupText').disabled=false}}
 };
 $('#groupBack').onclick=leave;$('#groupDelete').onclick=()=>active&&remove(active);$('#groupInvitesMore').onclick=()=>refreshList(true);$('#groupRefresh').onclick=()=>refreshList();$('#groupOlder').onclick=()=>loadMessages(true);
 $('#groupText').oninput=remember;
 async function poll(){if(!visible())return;await Promise.allSettled([refreshList(),active?loadMessages():Promise.resolve()])}
 function start(){if(started){void poll();return}started=true;void poll();timer=setInterval(()=>void poll(),15000)}
 function stop(){started=false;clearInterval(timer);++epoch;leave();busy=false;loading=false;rooms=[];drafts.clear();isAdmin=false;listCursor=null;listPages=1;createDraft={id:crypto.randomUUID(),signature:''};$('#groupName').value='';$('#groupDescription').value='';$('#groupRoomTitle').textContent='';$('#groupCreateStatus').textContent='';$('#groupCreateSubmit').disabled=false;$('#groupSend').disabled=false;$('#groupText').disabled=false;renderInvites()}
 document.addEventListener('visibilitychange',()=>{if(started)void poll()});window.addEventListener('focus',()=>{if(started)void poll()});window.addEventListener('ikigai-refresh-data',event=>{if(started){const task=poll();event.detail?.tasks?.push(task)}});
 return {start,stop,leave};
}
