export function mountTalkNotes({request,account,nameOf}){
 const $=s=>document.querySelector(s),dialog=$('#talkNotesDialog'),list=$('#talkNotesList'),status=$('#talkNotesStatus');let rows=[],epoch=0;
 function render(){
  list.replaceChildren();const query=$('#talkNotesSearch').value.trim().toLocaleLowerCase();
  const filtered=rows.filter(row=>[row.name,row.occupation,row.message].some(v=>String(v||'').toLocaleLowerCase().includes(query)));
  for(const row of filtered){const card=document.createElement('details');card.className='talk-note';const head=document.createElement('summary'),title=document.createElement('b'),sub=document.createElement('small');title.textContent=row.name||nameOf(row.uid);sub.textContent=row.occupation||'';head.append(title,sub);card.append(head);
   const body=document.createElement('dl');for(const [key,label] of [['name','名前'],['occupation','職業'],['message','一言']]){const term=document.createElement('dt'),value=document.createElement('dd');term.textContent=label;value.textContent=row[key]||'';body.append(term,value)}
   const time=document.createElement('small'),date=new Date(row.at);time.textContent=Number.isFinite(date.getTime())?'自己紹介日：'+date.toLocaleDateString('ja-JP',{timeZone:'Asia/Tokyo'}):'';card.append(body,time);list.append(card)
  }
  if(!filtered.length){const empty=document.createElement('p');empty.textContent=query?'一致する自己紹介はありません。':'保存された自己紹介はまだありません。';list.append(empty)}
 }
 async function refresh(){
  const actor=account(),token=++epoch;if(!actor){rows=[];list.replaceChildren();status.textContent='自己紹介を送信するとノートを確認できます。';return}
  $('#talkNotesRefresh').disabled=true;status.textContent='自己紹介ノートを読み込んでいます…';
  try{const value=await request();if(token!==epoch||actor!==account())return;if(!Array.isArray(value?.notes))throw Error();rows=value.notes;render();status.textContent=rows.length+'人の自己紹介';}
  catch{if(token===epoch){status.textContent='自己紹介ノートを取得できませんでした。「更新」で再試行してください。';}}
  finally{if(token===epoch)$('#talkNotesRefresh').disabled=false}
 }
 $('#talkNotesOpen').onclick=()=>{if(!account())return;$('#talkNotesSearch').value='';rows=[];list.replaceChildren();dialog.showModal();void refresh()};
 $('#talkNotesClose').onclick=()=>dialog.close();$('#talkNotesRefresh').onclick=()=>void refresh();$('#talkNotesSearch').oninput=render;
 return {clear(){epoch++;rows=[];list.replaceChildren();status.textContent='';$('#talkNotesSearch').value='';$('#talkNotesRefresh').disabled=false;if(dialog.open)dialog.close()}};
}
