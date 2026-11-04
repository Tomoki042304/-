import {messageBlocks,messageShell,dayDivider} from './talk-message-layout.js';
export function mountGroups({request,account,nameOf,compose,beforeOpen=()=>{},onChange=()=>{},avatar=null,day=at=>new Date(at).toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'}),timeLabel=at=>new Date(at).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})}){
 const $=s=>document.querySelector(s);let rooms=[],active=null,messages=[],older=null,isAdmin=false,timer=0,started=false,epoch=0,roomEpoch=0,busy=false,loading=false,listCursor=null,listPages=1,listError='';
 const rosters=new Map();let rosterLoading=false,readPending=false,menuId='',replyTo=null,pressTimer=0,suppressMenuClick=0;const readMarks=new Map();
 const drafts=new Map();let createDraft={id:crypto.randomUUID(),signature:''};
 const visible=()=>account()&&document.visibilityState==='visible'&&!$('#v-mates').hidden&&(!$('#mtChat').hidden||!$('#dmPanel').hidden);
 const button=(text,fn)=>{const el=document.createElement('button');el.type='button';el.className='small-btn';el.textContent=text;el.onclick=fn;return el};
 // A tab opened before this release may load the new module with the previous markup.
 if(!$('#groupReplyContext')&&$('#groupComposer')){const context=document.createElement('div');context.id='groupReplyContext';context.className='give-reply-context';context.hidden=true;const label=document.createElement('span');label.id='groupReplyLabel';const cancel=button('返信を解除',()=>{});cancel.id='groupReplyCancel';context.append(label,cancel);$('#groupComposer').before(context)}
 function status(text){$('#groupStatus').textContent=text}
 function remember(){if(active){const old=drafts.get(active.id)||{};drafts.set(active.id,{...old,text:$('#groupText').value,reply:replyTo})}}
 function leave(){remember();++roomEpoch;menuId='';replyTo=null;renderReply();active=null;messages=[];older=null;$('#groupMessages').replaceChildren();$('#groupParticipants').replaceChildren();$('#groupRoomCount').textContent='';$('#groupParticipantsStatus').textContent='';$('#groupRoom').hidden=true;$('#groupCommon').hidden=false;$('#groupText').value='';status('')}
 function renderInvites(){
  const box=$('#groupInviteList'),joinedRooms=rooms.filter(room=>room.joined);box.replaceChildren();$('#groupInviteCount').textContent=joinedRooms.length?'（'+joinedRooms.length+'件）':'';
  for(const room of [...joinedRooms].sort((a,b)=>b.at.localeCompare(a.at))){const entry=button(room.name,()=>join(room));entry.className='group-list-item';entry.dataset.groupId=room.id;const count=document.createElement('span');count.className='group-member-count';const roster=rosters.get(room.id);count.textContent=roster?.ids?'（'+roster.ids.length+'人参加中）':roster?.error?'（人数取得待ち）':'（人数確認中）';entry.append(count);box.append(entry)}
  $('#groupInviteStatus').textContent=joinedRooms.length?'':'参加中のグループはありません。全体トークの「賛同する」から参加できます。';
  $('#groupInvitesMore').hidden=!listCursor;onChange();void refreshParticipantCounts();
 }
 function invitationCard(room){
  const card=document.createElement('article');card.className='group-invite';card.dataset.groupId=room.id;
  const title=document.createElement('b');title.textContent=room.name;const text=document.createElement('p');text.textContent=room.description||'仲間を募集しています。';
  const meta=document.createElement('small');meta.textContent=nameOf(room.ownerUid)+'からのグループ招待';
  const state=document.createElement('p');state.className='group-invite-state';state.textContent=room.joined?'参加済み':'参加を募集しています';
  const actions=document.createElement('div');actions.className='group-actions';const enter=button(room.joined?'グループを開く':'賛同する',()=>join(room));enter.dataset.groupJoin=room.id;actions.append(enter);
  if(isAdmin){const del=button('削除',()=>remove(room));del.classList.add('group-delete');actions.append(del)}
  card.append(meta,title,text,state,actions);return card;
 }
 async function refreshList(more=false){
  if(loading||!visible())return;loading=true;const uid=account(),version=epoch;
  try{const data=await request({action:'list',...(more&&listCursor?{cursor:listCursor}:{})});if(uid!==account()||version!==epoch)return;
   let all=data.groups,cursor=data.cursor;
   if(!more){for(let page=1;cursor;page++){const next=await request({action:'list',cursor});if(uid!==account()||version!==epoch||!visible())return;all.push(...next.groups);cursor=next.cursor}}
   listError='';isAdmin=data.isAdmin===true;rooms=more?[...new Map([...rooms,...all].map(r=>[r.id,r])).values()]:all;if(more)listPages++;listCursor=cursor;renderInvites();
  }catch(error){if(uid===account()&&version===epoch){listError=error.message||'招待を更新できませんでした。';$('#groupInviteStatus').textContent=listError;onChange()}}finally{if(version===epoch)loading=false}
 }
 function personAvatar(uid){if(avatar)return avatar(uid);const icon=document.createElement('div');icon.className='avatar';icon.textContent=Array.from(nameOf(uid)||'会員')[0];icon.setAttribute('role','img');icon.setAttribute('aria-label',nameOf(uid)+'のアイコン');return icon}
 function renderParticipants(){
  const box=$('#groupParticipants');box.replaceChildren();if(!active)return;
  const roster=rosters.get(active.id);$('#groupRoomCount').textContent=roster?.ids?'（'+roster.ids.length+'人参加中）':'';
  $('#groupParticipantsStatus').textContent=roster?.ids?'参加者':roster?.error?'参加者を取得できませんでした':'参加者を確認しています…';
  for(const uid of roster?.ids||[]){const person=document.createElement('div');person.className='group-participant';person.setAttribute('role','listitem');person.title=nameOf(uid);const name=document.createElement('span');name.textContent=nameOf(uid);person.append(personAvatar(uid),name);box.append(person)}
 }
 async function fetchRoster(id){
  const uid=account(),version=epoch;try{const data=await request({action:'members',groupId:id});if(uid!==account()||version!==epoch)return;
   if(!Array.isArray(data.participants)||!data.participants.every(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id)))throw Error('参加者を確認できませんでした。');
   rosters.set(id,{ids:[...new Set(data.participants)],at:Date.now()});
  }catch(error){if(uid===account()&&version===epoch){const old=rosters.get(id);rosters.set(id,{...old,error:true,at:Date.now()})}}
 }
 async function refreshParticipantCounts(){
  if(rosterLoading||!visible())return;rosterLoading=true;const version=epoch;
  try{const targets=rooms.filter(r=>r.joined&&(r.id===active?.id||!$('#dmPanel').hidden)&&(!rosters.has(r.id)||Date.now()-rosters.get(r.id).at>=30000));
   if(active&&!targets.some(r=>r.id===active.id)&&(!rosters.has(active.id)||Date.now()-rosters.get(active.id).at>=30000))targets.push(active);
   for(let i=0;i<targets.length;i+=2){await Promise.all(targets.slice(i,i+2).map(r=>fetchRoster(r.id)));if(version!==epoch||!visible())return}
   if(targets.length&&version===epoch){renderParticipants();renderInvites()}
  }finally{if(version===epoch)rosterLoading=false}
 }
 function renderReply(){const context=$('#groupReplyContext');context.hidden=!replyTo;$('#groupReplyLabel').textContent=replyTo?nameOf(replyTo.uid)+'さんへの返信：「'+replyTo.quote+'」':''}
 function beginReply(id){const m=messages.find(m=>m.id===id&&!m.unsent&&m.senderUid!==account());if(!m)return;replyTo={uid:m.senderUid,id:m.id,quote:Array.from(m.text.replace(/\s+/g,' ')).slice(0,50).join('')};renderReply();remember();$('#groupText').focus()}
 async function markRead(){
  if(readPending||!active||!visible()||!$('#dmPanel').hidden||$('#groupRoom').hidden)return;
  const incoming=messages.filter(m=>m.senderUid!==account()&&!m.unsent).slice(-40);if(!incoming.length)return;
  const latest=incoming.reduce((at,m)=>m.at>at?m.at:at,''),id=active.id,uid=account(),version=epoch;if((readMarks.get(id)||'')>=latest)return;readPending=true;
  try{await request({action:'read',groupId:id,ids:incoming.map(m=>m.id)});if(uid===account()&&version===epoch)readMarks.set(id,latest)}catch{}finally{if(version===epoch)readPending=false}
 }
 function renderMessages(scroll=false){
  const box=$('#groupMessages'),near=box.scrollHeight-box.scrollTop-box.clientHeight<80,top=box.scrollTop,height=box.scrollHeight;box.replaceChildren();const block=messageBlocks(day);
  for(const m of messages.filter(m=>!m.unsent)){
   const state=block(m.senderUid,m.at);if(state.day)box.append(dayDivider(state.day));
   const mine=m.senderUid===account(),{row,body:messageBody,line}=messageShell({mine,first:state.first,name:nameOf(m.senderUid),avatar:()=>personAvatar(m.senderUid),className:'group-message'+(mine?' mine':'')});row.dataset.messageId=m.id;
   const body=document.createElement('p');body.textContent=m.unsent?'送信を取り消しました':m.text;body.className='group-bubble bubble';if(!m.unsent){body.dataset.reactionScope='private-group';body.dataset.reactionThread=active.id;body.dataset.reactionSender=m.senderUid;body.dataset.reactionMessage=m.id;body.tabIndex=0;body.setAttribute('role','button');body.setAttribute('aria-label',mine?'メッセージの操作とリアクションを開く':'メッセージのリアクションを開く');if(mine)body.dataset.groupMine=m.id}
   const meta=document.createElement('div');meta.className='group-message-meta meta';if(mine&&!m.unsent&&m.readCount>0){const read=document.createElement('small');read.className='group-read-count read';read.textContent='既読 '+m.readCount;meta.append(read)}const time=document.createElement('time');time.textContent=timeLabel(m.at);meta.append(time);line.append(body,meta);if(mine&&!m.unsent&&menuId===m.id){const actions=document.createElement('div');actions.className='group-message-actions';actions.append(button('送信取り消し',()=>unsend(m.id)));messageBody.append(actions)}box.append(row);
  }
  if(scroll||near)box.scrollTop=box.scrollHeight;else box.scrollTop=top+Math.max(0,box.scrollHeight-height);$('#groupOlder').hidden=!older;
 }
 async function loadMessages(more=false){
  if(!active||!visible())return;const id=active.id,uid=account(),version=roomEpoch;
  try{const data=await request({action:'messages',groupId:id,...(more&&older?{cursor:older}:{})});if(uid!==account()||version!==roomEpoch||active?.id!==id)return;
   isAdmin=data.isAdmin===true;active=data.group;$('#groupRoomTitle').textContent=active.name;$('#groupDelete').hidden=!isAdmin;
   const map=new Map(messages.map(m=>[m.id,m]));for(const m of data.messages){const old=map.get(m.id);map.set(m.id,{...m,readCount:Math.max(old?.readCount||0,m.readCount||0),...(old?.unsent?{unsent:true,text:''}:{})})}messages=[...map.values()].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));if(more||messages.length===data.messages.length)older=data.cursor;renderMessages();status(messages.some(m=>!m.unsent)?'':'まだメッセージはありません。');await markRead();
  }catch(error){if(uid!==account()||version!==roomEpoch)return;if([403,404,410].includes(error.status)){leave();window.dispatchEvent(new Event('ikigai-group-back'));rooms=rooms.filter(r=>r.id!==id);renderInvites();$('#groupInviteStatus').textContent=error.message}else status(error.message||'会話を読み込めませんでした。')}
 }
 async function open(room){
  beforeOpen();$('#dmPanel').hidden=true;remember();++roomEpoch;active=room;messages=[];older=null;$('#groupCommon').hidden=true;$('#groupRoom').hidden=false;window.dispatchEvent(new Event('ikigai-group-open'));$('#groupRoomTitle').textContent=room.name;$('#groupDelete').hidden=!isAdmin;$('#groupMessages').replaceChildren();$('#groupText').value=drafts.get(room.id)?.text||'';replyTo=drafts.get(room.id)?.reply||null;renderReply();status('読み込んでいます…');renderParticipants();await Promise.allSettled([loadMessages(),refreshParticipantCounts()]);
 }
 async function join(room){
  if(busy)return;busy=true;const uid=account(),version=epoch;$('#groupInviteStatus').textContent='グループを開いています…';
  try{const data=room.joined?{group:room}:await request({action:'join',groupId:room.id});if(uid!==account()||version!==epoch)return;rooms=rooms.map(r=>r.id===room.id?data.group:r);renderInvites();await open(data.group)}catch(error){if(uid===account()&&version===epoch)$('#groupInviteStatus').textContent=error.message||'参加できませんでした。'}finally{if(version===epoch)busy=false}
 }
 async function remove(room){
  if(busy||!isAdmin||!confirm('「'+room.name+'」を削除しますか？参加者全員が会話を閲覧・送信できなくなります。'))return;
  busy=true;const uid=account(),version=epoch;
  try{await request({action:'delete',groupId:room.id});if(uid!==account()||version!==epoch)return;if(active?.id===room.id){leave();window.dispatchEvent(new Event('ikigai-group-back'))}drafts.delete(room.id);rooms=rooms.filter(r=>r.id!==room.id);renderInvites();$('#groupInviteStatus').textContent='グループを削除しました。'}catch(error){if(uid===account()&&version===epoch){status(error.message);$('#groupInviteStatus').textContent=error.message}}finally{if(version===epoch)busy=false}
 }
 async function createFromTemplate({id,name,description}){
  if(busy||!account())throw Error('別の操作が完了してから、もう一度お試しください。');
  const uid=account(),version=epoch;busy=true;
  try{const data=await request({action:'create',groupId:id,name,description});if(uid!==account()||version!==epoch)throw Error('ログイン状態が変わりました。');isAdmin=data.isAdmin===true;rooms=[data.group,...rooms.filter(r=>r.id!==data.group.id)];renderInvites();return data.group}
  finally{if(version===epoch)busy=false}
 }
 async function unsend(id){
  if(busy||!active)return;busy=true;const room=active.id,uid=account(),version=roomEpoch,session=epoch;
  try{const data=await request({action:'unsend',groupId:room,id});if(uid!==account()||version!==roomEpoch)return;menuId='';messages=messages.map(m=>m.id===id?data.message:m);renderMessages()}catch(error){if(uid===account()&&version===roomEpoch)status(error.message)}finally{if(session===epoch)busy=false}
 }
 $('#groupCreateSubmit').onclick=async()=>{
  if(busy||!account())return;const name=$('#groupName').value.trim(),description=$('#groupDescription').value.trim();
  if(!name){$('#groupCreateStatus').textContent='グループ名を入力してください。';$('#groupName').focus();return}
  const signature=JSON.stringify([name,description]);if(signature!==createDraft.signature)createDraft={id:crypto.randomUUID(),signature};
  busy=true;const uid=account(),version=epoch;$('#groupCreateSubmit').disabled=true;$('#groupCreateStatus').textContent='招待を公開しています…';
  try{const data=await request({action:'create',groupId:createDraft.id,name,description});if(uid!==account()||version!==epoch)return;isAdmin=data.isAdmin===true;rooms=[data.group,...rooms.filter(r=>r.id!==data.group.id)];renderInvites();$('#groupName').value='';$('#groupDescription').value='';$('#groupCreateStatus').textContent='';createDraft={id:crypto.randomUUID(),signature:''};compose('free');$('#groupInvites').open=true;await open(data.group)}catch(error){if(uid===account()&&version===epoch)$('#groupCreateStatus').textContent=error.message||'招待を公開できませんでした。'}finally{if(version===epoch){busy=false;$('#groupCreateSubmit').disabled=false}}
 };
 $('#groupComposer').onsubmit=async event=>{
  event.preventDefault();if(busy||!active||!account())return;const raw=$('#groupText').value.trim();if(!raw)return;if(replyTo&&!messages.some(m=>m.id===replyTo.id&&m.senderUid===replyTo.uid&&!m.unsent)){status('返信元のメッセージが取り消されています。返信を解除してください。');return}const text=replyTo?nameOf(replyTo.uid)+'さんへの返信\n「'+replyTo.quote+'」\n\n'+raw:raw;if(text.length>2000){status('引用を含めて2000文字以内にしてください。');return}
  const id=active.id,uid=account(),version=roomEpoch,session=epoch,old=drafts.get(id)||{};const draft={text:raw,reply:replyTo,signature:text,id:old.signature===text&&old.id?old.id:crypto.randomUUID()};drafts.set(id,draft);
  busy=true;$('#groupSend').disabled=true;$('#groupText').disabled=true;status('送信しています…');
  try{const data=await request({action:'send',groupId:id,id:draft.id,text});if(uid!==account()||version!==roomEpoch)return;drafts.delete(id);$('#groupText').value='';replyTo=null;renderReply();messages=[...messages.filter(m=>m.id!==data.message.id),data.message].sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));renderMessages(true);status('')}
  catch(error){if(uid===account()&&version===roomEpoch){if([403,404,410].includes(error.status)){leave();window.dispatchEvent(new Event('ikigai-group-back'));$('#groupInviteStatus').textContent=error.message;void refreshList()}else status(error.message||'送信できませんでした。入力は残っています。')}}
  finally{if(session===epoch){busy=false;$('#groupSend').disabled=false;$('#groupText').disabled=false}}
 };
 $('#groupBack').onclick=()=>{leave();window.dispatchEvent(new Event('ikigai-group-back'))};$('#groupDelete').onclick=()=>active&&remove(active);$('#groupInvitesMore').onclick=()=>refreshList(true);$('#groupRefresh').onclick=()=>{rosters.clear();void refreshList();void refreshParticipantCounts()};$('#groupOlder').onclick=()=>loadMessages(true);
 $('#groupText').oninput=remember;$('#groupReplyCancel').onclick=()=>{replyTo=null;renderReply();remember()};
 const messageRoot=$('#groupMessages');messageRoot.addEventListener('click',event=>{const bubble=event.target.closest('[data-group-mine]');if(bubble&&Date.now()>=suppressMenuClick){menuId=menuId===bubble.dataset.groupMine?'':bubble.dataset.groupMine;renderMessages()}else if(!bubble&&menuId&&event.target.closest('[data-reaction-message]')){menuId='';renderMessages()}});
 messageRoot.addEventListener('keydown',event=>{const bubble=event.target.closest('[data-group-mine]');if(bubble&&['Enter',' '].includes(event.key)){event.preventDefault();menuId=bubble.dataset.groupMine;renderMessages()}});
 messageRoot.addEventListener('contextmenu',event=>{const bubble=event.target.closest('[data-group-mine]');if(bubble){event.preventDefault();menuId=bubble.dataset.groupMine;renderMessages()}});
 messageRoot.addEventListener('pointerdown',event=>{const bubble=event.target.closest('[data-group-mine]');if(!bubble)return;clearTimeout(pressTimer);pressTimer=setTimeout(()=>{suppressMenuClick=Date.now()+700;menuId=bubble.dataset.groupMine;renderMessages()},450)});
 for(const name of ['pointerup','pointermove','pointercancel','pointerleave'])messageRoot.addEventListener(name,()=>clearTimeout(pressTimer));
 document.addEventListener('click',event=>{if(menuId&&!event.composedPath().includes(messageRoot)){menuId='';renderMessages()}});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menuId){menuId='';renderMessages()}});
 async function poll(){if(!visible())return;await Promise.allSettled([refreshList(),active?loadMessages():Promise.resolve(),refreshParticipantCounts()])}
 function start(){if(started){void poll();return}started=true;void poll();timer=setInterval(()=>void poll(),15000)}
 function stop(){started=false;clearInterval(timer);++epoch;leave();rosters.clear();readMarks.clear();readPending=false;clearTimeout(pressTimer);rosterLoading=false;busy=false;loading=false;rooms=[];drafts.clear();isAdmin=false;listCursor=null;listPages=1;listError='';createDraft={id:crypto.randomUUID(),signature:''};$('#groupName').value='';$('#groupDescription').value='';$('#groupRoomTitle').textContent='';$('#groupCreateStatus').textContent='';$('#groupCreateSubmit').disabled=false;$('#groupSend').disabled=false;$('#groupText').disabled=false;renderInvites()}
 document.addEventListener('visibilitychange',()=>{if(started)void poll()});window.addEventListener('focus',()=>{if(started)void poll()});window.addEventListener('online',()=>{if(started)void poll()});window.addEventListener('ikigai-refresh-data',event=>{if(started){const task=poll();event.detail?.tasks?.push(task)}});
 new MutationObserver(()=>{if(!$('#dmPanel').hidden)void refreshParticipantCounts();else if(active)void markRead()}).observe($('#dmPanel'),{attributes:true,attributeFilter:['hidden']});
 return {start,stop,leave,openById:async id=>{if(!account())return;const data=await request({action:'messages',groupId:id});await open({...data.group,joined:true})},replyTo:(id,groupId)=>{if(active?.id===groupId)beginReply(id)},refreshMemberInfo:()=>{if(active){renderParticipants();renderMessages()}},createFromTemplate,invitationError:()=>listError,invitations:()=>rooms.map(room=>({id:'group-invite:'+room.id,uid:room.ownerUid,at:room.at,groupInvite:true,room})),renderInvitation:invitationCard};
}
