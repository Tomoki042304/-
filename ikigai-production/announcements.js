export function mountAnnouncements({request,account,isAdmin,getSeen,markSeen,onChange,onRows=()=>{}}){
 const $=s=>document.querySelector(s);let rows=[],timer=0,started=false,reading=false,publishing=false,epoch=0,draftId=crypto.randomUUID(),attempt=null;
 const visible=()=>document.visibilityState==='visible';
 const unread=()=>{const seen=new Set(getSeen());return rows.filter(r=>!seen.has(r.id)).length};
 const date=at=>new Date(at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
 function renderHome(){
  const card=$('#homeAnnouncements'),list=$('#homeAnnouncementsList');if(!card||!list)return;
  const seen=new Set(getSeen()),unreadRows=account()?rows.filter(r=>!seen.has(r.id)):[];
  const opened=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.id));
  list.replaceChildren();card.hidden=!unreadRows.length;
  const count=$('#homeAnnouncementsCount');if(count)count.textContent=unreadRows.length?'未読 '+unreadRows.length+'件':'';
  for(const row of unreadRows){
   const box=document.createElement('details');box.className='home-announcement';box.dataset.id=row.id;box.open=opened.has(row.id);
   const head=document.createElement('summary'),label=document.createElement('span'),title=document.createElement('b'),time=document.createElement('time');
   head.className='channel-summary';title.textContent=row.title;time.dateTime=row.at;time.textContent=date(row.at);label.append(title,time);
   const expand=document.createElement('span');expand.className='channel-expand';expand.setAttribute('aria-hidden','true');head.append(label,expand);
   const text=document.createElement('p');text.textContent=row.text;
   const read=document.createElement('button');read.type='button';read.className='small-btn';read.textContent='既読にする';read.setAttribute('aria-label',row.title+'を既読にする');
   read.onclick=()=>{acknowledge(row.id);$('#announcementList')?.querySelectorAll('details').forEach(el=>{if(el.dataset.id===row.id)el.querySelector('.inquiry-notice-dot')?.remove()})};
   box.append(head,text,read);list.append(box);
  }
 }
 function acknowledge(id){
  if(!account()||!visible()||!rows.some(r=>r.id===id))return;
  if(!new Set(getSeen()).has(id))markSeen(id);
  renderHome();onChange();
 }
 function render(){
  const list=$('#announcementList'),seen=new Set(getSeen()),opened=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.id));list.replaceChildren();
  for(const row of rows){const box=document.createElement('details');box.className='announcement-item';box.dataset.id=row.id;box.open=opened.has(row.id);const head=document.createElement('summary'),title=document.createElement('b');title.textContent=row.title;head.append(title);if(!seen.has(row.id)){const dot=document.createElement('span');dot.className='inquiry-notice-dot';dot.setAttribute('aria-label','未読のお知らせ');head.append(dot)}const time=document.createElement('small');time.textContent='運営から · '+date(row.at);head.append(time);const text=document.createElement('p');text.textContent=row.text;box.append(head,text);box.addEventListener('toggle',()=>{if(box.open&&$('#notificationsDialog')?.open&&visible()&&!new Set(getSeen()).has(row.id)){acknowledge(row.id);head.querySelector('.inquiry-notice-dot')?.remove()}});list.append(box)}
  const history=$('#announcementHistory');history.replaceChildren();for(const row of rows.slice(0,10)){const item=document.createElement('p');item.className='muted admin-note';item.textContent=date(row.at)+' · '+row.title;history.append(item)}onRows(rows.slice(0,10));renderHome();onChange();
 }
 async function refresh(){
  clearTimeout(timer);if(reading||!started||!account()||!visible())return;reading=true;const token=epoch,uid=account();
  try{const all=[],seenCursors=new Set();let cursor;
   do{const data=await request({action:'list',...(cursor?{cursor}:{})});if(token!==epoch||account()!==uid)return;if(!Array.isArray(data.announcements))throw Error('お知らせを取得できませんでした。');all.push(...data.announcements);cursor=data.cursor;if(cursor){if(seenCursors.has(cursor))throw Error('お知らせを更新できませんでした。');seenCursors.add(cursor)}}while(cursor);
   // Keep an immediately confirmed local publication until the shared index propagates.
   const combined=new Map(rows.filter(r=>r.local).map(r=>[r.id,r]));for(const r of all)combined.set(r.id,r);rows=[...combined.values()].sort((a,b)=>b.at.localeCompare(a.at));render();$('#announcementStatus').textContent=rows.length?'':'運営からのお知らせはまだありません。';
  }catch(e){if(token===epoch)$('#announcementStatus').textContent=e.message||'お知らせを読み込めませんでした。'}
  finally{if(token===epoch){reading=false;if(started&&account())timer=setTimeout(refresh,30000)}}
 }
 function start(){if(started){if(!timer&&!reading)void refresh();return}started=true;void refresh()}
 function stop(){started=false;epoch++;reading=false;clearTimeout(timer);rows=[];$('#announcementList').replaceChildren();$('#announcementHistory').replaceChildren();$('#announcementStatus').textContent='';$('#announcementTitle').value='';$('#announcementText').value='';$('#announcementPublishStatus').textContent='';draftId=crypto.randomUUID();attempt=null;renderHome();onChange()}
 $('#announcementRefresh').onclick=()=>{start();void refresh()};
 $('#announcementForm').onsubmit=async event=>{
  event.preventDefault();if(publishing||!account()||!isAdmin())return;const title=$('#announcementTitle').value.trim(),text=$('#announcementText').value.trim();if(!title||!text)return;
  const fingerprint=JSON.stringify([title,text]);if(attempt&&attempt!==fingerprint)draftId=crypto.randomUUID();attempt=fingerprint;
  const token=epoch,uid=account();publishing=true;$('#announcementSend').disabled=true;$('#announcementTitle').disabled=true;$('#announcementText').disabled=true;$('#announcementPublishStatus').textContent='全メンバーへ配信しています…';
  try{const data=await request({action:'publish',id:draftId,title,text});if(token!==epoch||account()!==uid||!isAdmin())return;if(!data.announcement?.id)throw Error('配信結果を確認できませんでした。');rows=[{...data.announcement,local:true},...rows.filter(r=>r.id!==data.announcement.id)];markSeen(data.announcement.id);render();$('#announcementTitle').value='';$('#announcementText').value='';draftId=crypto.randomUUID();attempt=null;$('#announcementPublishStatus').textContent='全メンバー向けに配信しました。相手の画面への反映には約1分かかる場合があります。';}
  catch(e){if(token===epoch)$('#announcementPublishStatus').textContent=e.message||'配信できませんでした。入力内容を残しています。'}
  finally{publishing=false;$('#announcementSend').disabled=false;$('#announcementTitle').disabled=false;$('#announcementText').disabled=false}
 };
 document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(visible()&&started)void refresh()});
 window.addEventListener('ikigai-refresh-data',event=>{if(started&&account()&&Array.isArray(event.detail?.tasks))event.detail.tasks.push(Promise.resolve().then(refresh))});
 return {start,stop,unread,renderHome,open(){start();render();void refresh()}};
}
