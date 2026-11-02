const $=selector=>document.querySelector(selector);
let activeMenu=null;
const labels={photos:'写真を削除しています',inventory:'保存先を確認しています',legacy:'以前の保存先から削除しています','legacy-wait':'削除の反映を確認しています','legacy-verify':'以前の保存先の削除結果を確認しています',auth:'アカウントを削除しています',documents:'登録情報・成長ログを削除しています',runtime:'トーク・グループなどを削除しています',finish:'削除結果を確認しています'};
function element(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node}
function dialog(title){
 const box=element('dialog',undefined,'card member-action-dialog');box.id='memberActionDialog';const heading=element('h3',title);const content=element('div');const close=element('button','閉じる','small-btn');close.type='button';close.onclick=()=>box.close();box.append(heading,content,close);box.addEventListener('close',()=>box.remove(),{once:true});document.body.append(box);box.showModal();return {box,content,close};
}
async function deletionFlow({request,member,onChange,existing}){
 const {box,content,close}=dialog(existing?'メンバー削除を再開':'メンバーを削除');let job=existing||null,busy=false,requestId=existing?.id||crypto.randomUUID();
 const status=element('p','', 'member-action-status');status.role='status';status.setAttribute('aria-live','polite');
 const proceed=element('button',existing?'削除を再開':'このメンバーを削除','primary member-delete-confirm');proceed.type='button';
 const name=element('p',member?String(member.display_name||'名前未設定'):'進行中のメンバー削除');content.append(name);
 let input,agree;
 if(!existing){
  content.append(element('p','登録情報、成長ログ、トーク、リアクション、写真、問い合わせを削除します。本人が作成したグループと中の会話も削除します。元に戻せません。'));
  content.append(element('p','外部サービスのバックアップ・監査ログや、他の端末に保存されたコピー、他の人が本文に書いた情報は、この操作での消去を保証できません。','muted admin-note'));
  const checkLabel=element('label');agree=element('input');agree.type='checkbox';checkLabel.append(agree,document.createTextNode(' 削除対象と注意事項を確認しました'));content.append(checkLabel);
  const typing=element('label','確認のため「削除」と入力してください');input=element('input');input.autocomplete='off';input.setAttribute('aria-label','削除の確認');typing.append(input);content.append(typing);
  const validate=()=>{proceed.disabled=!agree.checked||input.value!=='削除'};agree.onchange=validate;input.oninput=validate;validate();
 }
 content.append(status,proceed);
 async function run(){
  if(busy)return;if(!job&&(!agree?.checked||input?.value!=='削除'))return;busy=true;proceed.disabled=true;
  try{
   if(!job){status.textContent='削除を開始しています…';const result=await request({action:'start',userId:member.user_id,requestId,confirm:'DELETE'});if(result.done)throw Error('削除状態を確認してください。');job=result.job;requestId=job.id;if(agree)agree.disabled=true;if(input)input.disabled=true;onChange()}
   close.textContent='閉じて後で再開';
   while(box.open){
    status.textContent=labels[job.phase]||'削除を処理しています';
    if(job.retryAfterMs>0){const end=Date.now()+job.retryAfterMs;while(box.open&&Date.now()<end){status.textContent='削除の反映を確認しています（残り約'+Math.ceil((end-Date.now())/1000)+'秒）。';await new Promise(resolve=>setTimeout(resolve,1000))}if(!box.open)break}
    const result=await request({action:'step',requestId});
    if(result.missing)throw Error('処理の状態を確認できません。画面を閉じ、メンバー一覧を更新してください。');
    if(result.done){name.textContent='メンバーの削除が完了しました。';member=null;existing=null;if(input)input.value='';if(agree)agree.checked=false;status.textContent='削除が完了しました。';proceed.hidden=true;close.textContent='閉じる';job=null;onChange();return}
    job=result.job;
   }
  }catch(error){if(box.open){status.textContent=error.message||'削除はまだ完了していません。「削除を再開」から続けてください。';proceed.textContent='削除を再開';proceed.disabled=false}onChange()}
  finally{busy=false}
 }
 proceed.onclick=run;
 box.addEventListener('close',()=>onChange(),{once:true});
 if(existing)void run();
}
export function openMemberActions({anchor,member,currentUid,request,setPlan,onChange}){
 activeMenu?.remove();const menu=element('div',undefined,'member-row-menu');menu.role='menu';
 const plan=element('button','プラン変更');plan.type='button';plan.role='menuitem';plan.disabled=member.is_admin||!['basic','premium'].includes(member.member_plan);
 const remove=element('button','メンバー削除','member-remove-action');remove.type='button';remove.role='menuitem';remove.disabled=member.is_admin||member.user_id===currentUid;
 if(member.is_admin)menu.append(element('small','管理者のプラン変更・削除はできません。'));
 const finish=()=>{menu.remove();anchor.setAttribute('aria-expanded','false');if(activeMenu===menu)activeMenu=null;document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)};
 const outside=event=>{if(!menu.contains(event.target)&&event.target!==anchor)finish()};const escape=event=>{if(event.key==='Escape'){finish();anchor.focus()}};
 plan.onclick=()=>{
  finish();const {box,content}=dialog('プラン変更');content.append(element('p',String(member.display_name||'名前未設定')));
  const select=element('select');select.setAttribute('aria-label','会員プラン');for(const [value,text] of [['basic','ベーシック'],['premium','プレミアム']]){const option=element('option',text);option.value=value;select.append(option)}select.value=member.member_plan;
  const save=element('button','変更を保存','primary');save.type='button';const status=element('p');status.role='status';content.append(select,save,status);
  save.onclick=async()=>{save.disabled=true;select.disabled=true;try{await setPlan(member.user_id,select.value);box.close();onChange()}catch(error){status.textContent=error.message||'プランを保存できませんでした。'}finally{save.disabled=false;select.disabled=false}};
 };
 remove.onclick=()=>{finish();void deletionFlow({member,request,onChange})};
 menu.append(plan,remove);anchor.closest('.admin-member').append(menu);activeMenu=menu;anchor.setAttribute('aria-expanded','true');document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);plan.focus();
}
export async function renderPendingDeletions({container,request,onChange}){
 const value=await request({action:'list'});container.replaceChildren();
 for(const job of value.jobs||[]){const row=element('div',undefined,'member-pending-deletion');row.append(element('p','進行中のメンバー削除：'+(labels[job.phase]||'処理中')));const resume=element('button','削除を再開','small-btn');resume.type='button';resume.onclick=()=>deletionFlow({request,onChange,existing:job});row.append(resume);container.append(row)}
}
