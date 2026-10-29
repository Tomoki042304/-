// IKIGAI app — screens and features. Data access goes through window.claude (see main.js).
(function(){
  const pad=n=>String(n).padStart(2,'0');
  const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const parseIso=k=>{const[y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d||1)};
  const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'});
  const japanDayKey=()=>{const p=Object.fromEntries(dayFormatter.formatToParts(new Date()).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`};
  const TODAY=parseIso(japanDayKey());
  let todayKey=iso(TODAY);
  const WD=['日','月','火','水','木','金','土'];
  const CHECK='<svg class="i" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
  const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
  const mondayOf=d=>addDays(d,-((d.getDay()+6)%7));
  const md=d=>`${d.getMonth()+1}/${d.getDate()}`;
  const dotDate=d=>d?d.replace(/-/g,'.'):'';        // "2027-03-31" -> "2027.03.31"
  const toDateInput=v=>v&&v.length===7?v+'-01':(v||'');   // older month-only values
  // optional date: a checkbox decides whether the date input is used at all
  const dateField=(id,val)=>`<div class="date-pick"><label><input type="checkbox" data-datefor="${id}" ${val?'checked':''}>日付を決める</label><input type="date" id="${id}" value="${esc(toDateInput(val))}" ${val?'':'hidden'} aria-label="日付"></div>`;
  const dateVal=id=>{const el=document.getElementById(id);return el&&!el.hidden?el.value:''};
  document.addEventListener('change',e=>{const id=e.target.dataset&&e.target.dataset.datefor;if(!id)return;
    const el=document.getElementById(id);el.hidden=!e.target.checked;if(e.target.checked)el.focus()});
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const clone=o=>JSON.parse(JSON.stringify(o));
  function toast(msg){const t=$('#toast');t.textContent=msg;t.hidden=false;clearTimeout(t._h);t._h=setTimeout(()=>t.hidden=true,2400)}

  // Japanese input: no form is sent while a conversion is still open, or the text being converted would be lost.
  // Pressing the save button also ends the conversion (Safari confirms it on mouse/touch down), so a send that
  // follows such a press, or comes right after a conversion ended, is held back too: the person sees the
  // confirmed text and presses again.
  let composing=false,compEndAt=0,pressedWhileComposing=0;
  document.addEventListener('compositionstart',()=>{composing=true},true);
  document.addEventListener('compositionend',()=>{compEndAt=Date.now();setTimeout(()=>{composing=false},0)},true);
  const notePress=e=>{
    const b=e.target&&e.target.closest&&e.target.closest('button,input[type="submit"]');
    if(composing&&b&&b.form&&b.type==='submit')pressedWhileComposing=Date.now();
  };
  document.addEventListener('pointerdown',notePress,true);
  document.addEventListener('mousedown',notePress,true);
  document.addEventListener('touchstart',notePress,{capture:true,passive:true});
  // the Enter that only confirms a conversion must not send the form (Safari reports it as keyCode 229)
  document.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.form&&(e.isComposing||e.keyCode===229||composing))e.preventDefault();
  },true);
  document.addEventListener('submit',e=>{
    const now=Date.now(),held=composing||now-pressedWhileComposing<3000||now-compEndAt<500;
    pressedWhileComposing=0;
    if(!held)return;
    e.preventDefault();e.stopImmediatePropagation();
    toast('文字の変換を確定してから、もう一度押してください');
  },true);

  // ---------- data ----------
  const defaultProfile=()=>({
    registered:false,
    nick:'',
    aff:'',
    shi:'',
    shiSince:todayKey,
    share:true,
    checks:{},
    milestones:[0,1,2,3,4].map(()=>({t:'',ym:'',done:false}))   // last = goal
  });
  let profile=defaultProfile(), photo='', reflections=[];

  // storage: the viewer's private db subtree when available, else this browser
  const LK={p:'ikigai.v4.profile',r:'ikigai.v4.reflections',ph:'ikigai.v4.photo'};
  const local={get(k){try{return JSON.parse(localStorage.getItem(k))}catch(e){return null}},
               set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},
               del(k){try{localStorage.removeItem(k)}catch(e){}}};
  let backend='local',db=null,base='',uid=null,userNs=null;
  // signed in but not yet approved by a host: personal features work, the shared ones stay closed
  let approved=false;
  const pending=()=>backend==='cloud'&&!approved;
  const PENDING_BOX=what=>`<div class="card empty"><svg class="i" viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg><b style="color:var(--ink)">ホストの承認をお待ちください</b>承認されると、${what}が使えるようになります。</div>`;
  const pRef=()=>db.doc(base+'/profile');
  const phRef=()=>db.doc(base+'/goalphoto');
  const rCol=()=>pRef().collection('reflections');

  // Supabase build: never mix this browser's leftovers into an account, never fall back to it silently
  const STRICT=!!(window.appAuth&&window.appAuth.strict);
  let loadFailed=false,offerLocal=null;
  function loadLocal(){
    const p=local.get(LK.p);if(p)profile=Object.assign(defaultProfile(),p);
    photo=local.get(LK.ph)||'';
    reflections=local.get(LK.r)||[];
  }
  // what this browser kept from before login, or null when there is nothing worth offering
  function localLeftovers(){
    const p=local.get(LK.p),r=local.get(LK.r),ph=local.get(LK.ph);
    const refl=Array.isArray(r)?r.filter(x=>x&&x.id):[];
    const used=p&&(p.shi||p.nick||(Array.isArray(p.milestones)&&p.milestones.some(m=>m&&m.t))||Object.keys(p.checks||{}).length);
    return used||refl.length||ph?{p:p||null,r:refl,ph:typeof ph==='string'?ph:''}:null;
  }
  const clearLocal=()=>{local.del(LK.p);local.del(LK.r);local.del(LK.ph)};

  // changes the account has not received yet (kept in memory only, never written to this device)
  const unsaved={profile:false,refl:new Set()};
  const hasUnsaved=()=>unsaved.profile||unsaved.refl.size>0;
  let pRun=null,pDirty=false;
  // resolves true only once the latest profile is really stored
  async function saveProfile(quiet){
    if(backend!=='cloud'){if(!local.set(LK.p,profile)){toast('この端末に保存できませんでした');return false}return true}
    unsaved.profile=true;
    if(pRun){pDirty=true;return pRun}
    pRun=(async()=>{
      try{do{pDirty=false;await pRef().set(clone(profile))}while(pDirty);unsaved.profile=false;return true}
      catch(e){return false}
      finally{pRun=null}
    })();
    const ok=await pRun;
    showUnsaved();
    if(ok)syncMember();else if(!quiet)toast('保存できませんでした。通信状況を確認してください');
    return ok;
  }
  // the warning strip stays while anything is unsaved; saving is retried on reconnect, on return and every 30s
  let retryTimer=0,retrying=false;
  function showUnsaved(){
    const on=hasUnsaved();$('#unsavedBar').hidden=!on;
    if(on&&!retryTimer)retryTimer=setInterval(retryUnsaved,30000);
    if(!on&&retryTimer){clearInterval(retryTimer);retryTimer=0}
  }
  async function retryUnsaved(){
    if(retrying||!hasUnsaved()||backend!=='cloud')return;
    retrying=true;
    try{
      if(unsaved.profile)await saveProfile(true);
      for(const id of [...unsaved.refl]){const r=reflections.find(x=>x.id===id);if(r)await saveReflection(r,true);else unsaved.refl.delete(id)}
    }finally{retrying=false;showUnsaved()}
    toast(hasUnsaved()?'まだ保存できていません。通信状況を確認してください':'保存しました');
  }
  $('#unsavedRetry').onclick=retryUnsaved;
  addEventListener('online',retryUnsaved);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')retryUnsaved()});
  // closing or reloading now would lose the changes: let the browser ask first
  // (Safari asks only when returnValue is a non-empty string; the browser shows its own wording, not this text)
  addEventListener('beforeunload',e=>{
    if(!hasUnsaved())return;
    const msg='保存できていない変更があります。このまま離れると失われます。';
    e.preventDefault();e.returnValue=msg;return msg;
  });

  // ---------- members (shared: members/<uid>, each person writes only their own) ----------
  let mWriting=false,mDirty=false,lastMember='';
  const MEMBER_KEYS=['uid','nick','aff','avatar','shi','lastCheck','streak','goal','progress','total'];
  function memberPayload(){
    const ms=profile.milestones,days=Object.keys(profile.checks).sort();
    return{uid,nick:profile.nick||'',aff:profile.aff||'',avatar:safeImg(profile.avatar),shi:profile.shi,lastCheck:days[days.length-1]||'',streak:streak(),goal:goal().t,progress:ms.filter(m=>m.done).length,total:ms.length};
  }
  // the stored members row in the same shape memberPayload() produces ('off' when there is none)
  const memberKey=m=>m?JSON.stringify(Object.fromEntries(MEMBER_KEYS.map(k=>[k,m[k]]))):'off';
  async function syncMember(){
    if(backend!=='cloud'||!uid||!profile.registered)return;
    if(mWriting){mDirty=true;return}
    mWriting=true;
    try{
      // just opened, so what is stored is unknown: read our own row first, so an unchanged row is never rewritten
      // (if it cannot be read, nothing is written either)
      if(!lastMember){const cur=await db.doc('members/'+uid).get();lastMember=memberKey(cur.exists?cur.data():null)}
      do{
        mDirty=false;
        const want=profile.share?JSON.stringify(memberPayload()):'off';
        if(want===lastMember)continue;
        if(want==='off')await db.doc('members/'+uid).delete();
        else await db.doc('members/'+uid).set(JSON.parse(want));
        lastMember=want;
      }while(mDirty);
    }catch(e){/* read-only viewers cannot join; the list still shows */}
    finally{mWriting=false}
  }
  let members=[],memberTok=0;
  function subscribeMembers(){
    db.collection('members').onSnapshot(snap=>{
      members=snap.docs.map(d=>d.data()).filter(m=>m&&m.uid);
      const mine=members.find(m=>m.uid===uid);
      lastMember=mine?JSON.stringify(Object.fromEntries(MEMBER_KEYS.map(k=>[k,mine[k]]))):(lastMember==='off'?'off':'');
      renderMembers();renderChat();renderBuddies();renderFeed();
    },()=>{members=[];renderMembers()});
  }
  const COLORS=['#7a1f33','#9c3348','#5c1a2a','#b4596b','#8a3a2e','#6b2c47','#a0455a','#4e2430'];
  const colorOf=id=>{let h=0;for(const c of id)h=(h*31+c.charCodeAt(0))>>>0;return COLORS[h%COLORS.length]};
  let yesterdayKey=iso(addDays(TODAY,-1));
  const liveStreak=m=>(m.lastCheck===todayKey||m.lastCheck===yesterdayKey)?(m.streak||0):0;
  async function renderMembers(){
    const box=$('#members');
    if(backend!=='cloud'){
      $('#mCount').textContent='–';$('#mToday').textContent='–';
      box.innerHTML=`<div class="card empty"><svg class="i" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><b style="color:var(--ink)">メンバー一覧はまだ表示できません</b>ログインすると、参加しているメンバーが表示されます。</div>`;
      return;
    }
    if(pending()){$('#mCount').textContent='–';$('#mToday').textContent='–';box.innerHTML=PENDING_BOX('メンバー一覧');return}
    const list=[...members].sort((a,b)=>((b.lastCheck===todayKey)-(a.lastCheck===todayKey))||(liveStreak(b)-liveStreak(a)));
    $('#mCount').textContent=list.length;
    $('#mToday').textContent=list.filter(m=>m.lastCheck===todayKey).length;
    if(!list.length){
      box.innerHTML=`<div class="card empty"><svg class="i" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg><b style="color:var(--ink)">まだ参加メンバーがいません</b>仲間がアプリに登録すると、ここに並びます。</div>`;
      return;
    }
    const tok=++memberTok;
    let ps={};
    try{ps=await userNs.profiles(list.map(m=>m.uid))}catch(e){}
    if(tok!==memberTok)return;
    box.innerHTML='';
    list.forEach(m=>{
      const p=ps[m.uid]||{},me=m.uid===uid,name=m.nick||p.name||(me?'あなた':'メンバー'),on=m.lastCheck===todayKey;
      const pct=m.total?Math.round((m.progress||0)/m.total*100):0;
      const el=document.createElement('article');el.className='card member';
      el.innerHTML=`<div class="who"><div class="avatar" style="background-color:${colorOf(m.uid)}"></div><div><b></b><span class="job"></span><span class="streak"></span></div><span class="chk ${on?'on':''}">${on?'✓ 今日できた':'今日はまだ'}</span></div>
        <p class="shi"></p>
        <div class="goalline"><span class="g"></span><span class="bar"><i style="width:${pct}%"></i></span><span>${m.progress||0}/${m.total||0}</span></div>`;
      paintAvatar(el.querySelector('.avatar'),m.avatar,name);
      el.querySelector('b').textContent=name;
      if(me){const t=document.createElement('em');t.textContent='あなた';el.querySelector('b').append(t)}
      const job=el.querySelector('.job');job.textContent=m.aff||'';job.hidden=!m.aff;
      el.querySelector('.streak').textContent=`連続 ${liveStreak(m)} 日　GIVE ${giveCount(m.uid)}`;
      el.querySelector('.shi').textContent=m.shi||'';
      el.querySelector('.g').textContent='ゴール：'+(m.goal||'—');
      box.append(el);
    });
  }
  // ---------- timeline (成長ログ): each person keeps posts, reactions and comments in posts/<uid> ----------
  const POST_CATEGORIES=['仕事','日常','トレーニング','挑戦','成長','努力','継続','学び','達成','気づき','感謝','交流','健康','その他'];
  const postCategoriesOf=x=>[...new Set((Array.isArray(x.categories)?x.categories:[x.category]).filter(c=>POST_CATEGORIES.includes(c)))].slice(0,3);
  let feedAll=[],likesAll=[],cmtsAll=[],myPosts=[],myLikes=[],myCmts=[],postWriting=false,postAgain=false,feedReady=false,homeLogError=false;
  let tlQuery='',tlMine=false;const openCmts=new Set();
  const MAX_POSTS=100,MAX_LIKES=500,MAX_CMTS=300;
  function subscribeFeed(){
    db.collection('posts').onSnapshot(snap=>{
      const all=[],likes=[],cmts=[];
      snap.docs.forEach(d=>{
        const v=d.data()||{};
        if(Array.isArray(v.posts))v.posts.forEach(x=>{if(x&&typeof x.text==='string'&&typeof x.at==='string')all.push({id:String(x.id||''),text:x.text.slice(0,500),at:x.at,uid:d.id,categories:postCategoriesOf(x)})});
        if(Array.isArray(v.likes))v.likes.forEach(k=>{if(typeof k==='string')likes.push({by:d.id,key:k})});
        if(Array.isArray(v.comments))v.comments.forEach(c=>{if(c&&typeof c.text==='string'&&typeof c.key==='string'&&typeof c.at==='string')cmts.push({id:String(c.id||''),key:c.key,text:c.text.slice(0,300),at:c.at,uid:d.id})});
        if(d.id===uid){myPosts=Array.isArray(v.posts)?clone(v.posts):[];myLikes=Array.isArray(v.likes)?clone(v.likes):[];myCmts=Array.isArray(v.comments)?clone(v.comments):[]}
      });
      all.sort((p,q)=>q.at.localeCompare(p.at));cmts.sort((p,q)=>p.at.localeCompare(q.at));
      feedAll=all;likesAll=likes;cmtsAll=cmts;feedReady=true;homeLogError=false;renderFeed();
    },()=>{feedReady=true;homeLogError=true;renderFeed()});
  }
  async function flushPosts(){
    if(postWriting){postAgain=true;return}
    postWriting=true;
    try{do{postAgain=false;await db.doc('posts/'+uid).set({posts:clone(myPosts),likes:clone(myLikes),comments:clone(myCmts)})}while(postAgain)}
    catch(e){toast('保存できませんでした。通信状況を確認してください')}
    finally{postWriting=false}
  }
  const agoText=at=>{const d=new Date(at),m=Math.floor((Date.now()-d)/60000);if(isNaN(m))return'';if(m<1)return'たった今';if(m<60)return`${m}分前`;if(m<1440)return`${Math.floor(m/60)}時間前`;return`${d.getMonth()+1}月${d.getDate()}日`};
  const postTimeText=at=>{const d=new Date(at);return isNaN(d)?'':d.toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})};
  const FIRE='<svg class="i" viewBox="0 0 24 24"><path d="M12 22c4 0 7-2.8 7-7 0-3.5-2.4-6.2-4.2-8.2-.4 2-1.6 3.4-2.8 3.4 0-3-1-6-3.6-8.2C8.6 5.6 5 9 5 14.5 5 18.9 8 22 12 22z"/><path d="M12 22c-1.7 0-3-1.3-3-3.1 0-1.9 1.6-3.3 3-4.9 1.4 1.6 3 3 3 4.9 0 1.8-1.3 3.1-3 3.1z"/></svg>';
  const BUBBLE='<svg class="i" viewBox="0 0 24 24"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.4A8.5 8.5 0 1 1 21 12z"/></svg>';
  function avatarEl(id,cls){const a=document.createElement('div');a.className='avatar'+(cls?' '+cls:'');a.style.backgroundColor=colorOf(id);paintAvatar(a,avatarOf(id),nameOf(id));return a}
  // A two-second preview rotates existing feed data only, never a second network feed.
  const homeLogCard=$('#homeLogCard'),homeLogMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const HOME_LOG_INTERVAL=2000;
  let homeLogItems=[],homeLogIndex=0,homeLogTimer=0,homeLogPaused=homeLogMotion.matches,homeLogHover=false,homeLogFocusPaused=false,homeLogTouching=false,homeLogInView=!('IntersectionObserver' in window);
  const homeLogKey=x=>x?x.uid+':'+x.id:'';
  function homeLogCanRun(){
    return !!homeLogCard&&!homeLogCard.hidden&&!$('#app').hidden&&!$('#v-home').hidden
      &&document.visibilityState==='visible'&&backend==='cloud'&&!pending()&&!homeLogError
      &&homeLogItems.length>1&&!homeLogPaused&&!homeLogHover&&!homeLogFocusPaused&&!homeLogTouching&&homeLogInView;
  }
  function stopHomeLogTimer(){clearTimeout(homeLogTimer);homeLogTimer=0}
  function syncHomeLogTimer(reset=false){
    if(reset||!homeLogCanRun())stopHomeLogTimer();
    if(!homeLogCanRun()||homeLogTimer)return;
    homeLogTimer=setTimeout(()=>{homeLogTimer=0;if(homeLogCanRun()){homeLogIndex=(homeLogIndex+1)%homeLogItems.length;paintHomeLog(true);syncHomeLogTimer()}},HOME_LOG_INTERVAL);
  }
  function paintHomeLog(animate=false,direction=1){
    if(!homeLogCard)return;
    const x=homeLogItems[homeLogIndex];if(!x)return;
    const preview=$('#homeLogPreview'),viewport=$('#homeLogViewport');
    if(preview.getAnimations)preview.getAnimations().forEach(a=>a.cancel());
    if(viewport)viewport.querySelectorAll('.home-log-ghost').forEach(x=>x.remove());
    const old=animate&&!homeLogMotion.matches&&viewport&&preview.dataset.postKey?preview.cloneNode(true):null;
    const name=nameOf(x.uid),av=$('#homeLogAvatar');av.style.backgroundColor=colorOf(x.uid);av.setAttribute('role','img');av.setAttribute('aria-label',name+'のプロフィール');paintAvatar(av,avatarOf(x.uid),name);
    $('#homeLogName').textContent=name;$('#homeLogTime').textContent=postTimeText(x.at);$('#homeLogTime').dateTime=x.at;
    $('#homeLogText').textContent=x.text;
    const tags=$('#homeLogTags');tags.replaceChildren();postCategoriesOf(x).forEach(c=>{const tag=document.createElement('span');tag.className='post-category';tag.textContent=c;tags.append(tag)});tags.hidden=!tags.childElementCount;
    preview.dataset.postKey=homeLogKey(x);preview.setAttribute('aria-label',name+'の成長ログを開く');
    if(animate&&!homeLogMotion.matches&&typeof preview.animate==='function'){
      const options={duration:280,easing:'ease-out',fill:'both'};
      if(old){
        old.removeAttribute('id');old.querySelectorAll('[id]').forEach(x=>x.removeAttribute('id'));old.removeAttribute('href');old.tabIndex=-1;old.inert=true;old.setAttribute('aria-hidden','true');old.classList.add('home-log-ghost');viewport.append(old);
        old.animate([{transform:'translateX(0)'},{transform:`translateX(${-direction*100}%)`}],options);
      }
      const animation=preview.animate([{transform:`translateX(${direction*100}%)`},{transform:'translateX(0)'}],options);
      const done=()=>{if(old)old.remove()};animation.onfinish=done;animation.oncancel=done;
    }

  }
  function updateNewLogBadge(){
    const badge=$('#homeLogNew');if(!badge)return;
    const seen=Date.parse(profile.growthLogSeenAt||'')||0;
    const count=backend==='cloud'&&!pending()&&feedReady&&!homeLogError?feedAll.filter(x=>x.uid!==uid&&Number.isFinite(Date.parse(x.at))&&Date.parse(x.at)>seen&&Date.parse(x.at)<=Date.now()).length:0;
    const label=count?'新着 '+count+'件':'';if(badge.textContent!==label)badge.textContent=label;badge.hidden=!count;
  }
  function markGrowthLogsSeen(){
    if(backend!=='cloud'||pending()||!feedReady||homeLogError||$('#app').hidden||$('#v-timeline').hidden||document.visibilityState!=='visible')return;
    const now=Date.now(),seen=Date.parse(profile.growthLogSeenAt||'')||0;
    if(!feedAll.some(x=>x.uid!==uid&&Date.parse(x.at)>seen&&Date.parse(x.at)<=now))return;
    profile.growthLogSeenAt=new Date(now).toISOString();saveProfile(true);updateNewLogBadge();
  }
  function renderHomeLog(){
    updateNewLogBadge();
    if(!homeLogCard)return;
    const allowed=backend==='cloud'&&!!uid&&!pending();homeLogCard.hidden=!allowed;
    const previous=homeLogItems[homeLogIndex],first=homeLogKey(homeLogItems[0]);
    if(!allowed||!feedReady||homeLogError||!feedAll.length){
      homeLogItems=[];homeLogIndex=0;stopHomeLogTimer();$('#homeLogPreview').hidden=true;
      $('#homeLogText').textContent='';$('#homeLogName').textContent='';$('#homeLogTime').textContent='';$('#homeLogTags').replaceChildren();paintAvatar($('#homeLogAvatar'),'','');delete $('#homeLogPreview').dataset.postKey;
      $('#homeLogEmpty').hidden=!allowed;$('#homeLogEmpty').textContent=!feedReady?'読み込んでいます…':homeLogError?'投稿を取得できませんでした。通信状況を確認してください。':'まだ成長ログの投稿はありません。';return;
    }
    homeLogItems=feedAll.slice(0,10);
    const selected=homeLogItems.findIndex(x=>homeLogKey(x)===homeLogKey(previous));
    const fresh=first!==homeLogKey(homeLogItems[0])&&!homeLogPaused&&!homeLogHover&&!homeLogFocusPaused&&!homeLogTouching;
    homeLogIndex=selected<0||fresh?0:selected;
    $('#homeLogEmpty').hidden=true;$('#homeLogPreview').hidden=false;
    paintHomeLog();syncHomeLogTimer(homeLogKey(previous)!==homeLogKey(homeLogItems[homeLogIndex])||previous?.text!==homeLogItems[homeLogIndex].text);
  }
  function openHomeLog(key){
    if(backend!=='cloud'||pending())return;
    tlQuery='';tlMine=false;$('#tlSearch').value='';$('#tlMine').setAttribute('aria-pressed','false');go('timeline');
    if(key){const post=[...document.querySelectorAll('#feed [data-post-key]')].find(x=>x.dataset.postKey===key);if(post){post.tabIndex=-1;post.focus({preventScroll:true});post.scrollIntoView({behavior:homeLogMotion.matches?'auto':'smooth',block:'start'})}}
  }
  if(homeLogCard){
    const preview=$('#homeLogPreview');let swipe=null,suppressClickUntil=0;
    // Gracefully hide the previous toolbar if an older HTML shell is cached.
    if($('#homeLogControls'))$('#homeLogControls').hidden=true;if($('#homeLogOpen'))$('#homeLogOpen').hidden=true;
    if(preview.tagName!=='A'){preview.tabIndex=0;preview.setAttribute('role','link')}
    $('#homeLogAll').onclick=()=>openHomeLog();
    preview.addEventListener('click',e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;e.preventDefault();if(Date.now()<suppressClickUntil)return;openHomeLog(homeLogKey(homeLogItems[homeLogIndex]))});
    preview.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();openHomeLog(homeLogKey(homeLogItems[homeLogIndex]))}});
    const step=n=>{if(homeLogItems.length<2)return;homeLogIndex=(homeLogIndex+n+homeLogItems.length)%homeLogItems.length;paintHomeLog(true,n);syncHomeLogTimer(true)};
    preview.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;swipe={id:e.pointerId,x:e.clientX,y:e.clientY};homeLogTouching=true;syncHomeLogTimer();try{preview.setPointerCapture(e.pointerId)}catch(_){}});
    const release=(e,cancelled=false)=>{
      if(!swipe||swipe.id!==e.pointerId)return;
      const dx=e.clientX-swipe.x,dy=e.clientY-swipe.y;swipe=null;homeLogTouching=false;
      if(!cancelled&&Math.abs(dx)>=45&&Math.abs(dx)>Math.abs(dy)*1.2){e.preventDefault();suppressClickUntil=Date.now()+500;homeLogFocusPaused=false;if(document.activeElement===preview)preview.blur();step(dx<0?1:-1)}
      else if(cancelled||Math.abs(dx)>10||Math.abs(dy)>10)suppressClickUntil=Date.now()+500;
      syncHomeLogTimer(true);
    };
    preview.addEventListener('pointerup',e=>release(e));preview.addEventListener('pointercancel',e=>release(e,true));
    homeLogCard.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){homeLogHover=true;syncHomeLogTimer()}});
    homeLogCard.addEventListener('pointerleave',()=>{homeLogHover=false;syncHomeLogTimer(true)});
    homeLogCard.addEventListener('focusin',()=>{homeLogFocusPaused=true;syncHomeLogTimer()});homeLogCard.addEventListener('focusout',()=>setTimeout(()=>{if(!homeLogCard.contains(document.activeElement))homeLogFocusPaused=false;syncHomeLogTimer(true)},0));
    if('IntersectionObserver' in window)new IntersectionObserver(entries=>{homeLogInView=entries[0].isIntersecting&&entries[0].intersectionRatio>=.1;syncHomeLogTimer(true)},{threshold:.1}).observe(homeLogCard);
    const motionChanged=e=>{homeLogPaused=e.matches;paintHomeLog();syncHomeLogTimer(true)};
    if(homeLogMotion.addEventListener)homeLogMotion.addEventListener('change',motionChanged);else if(homeLogMotion.addListener)homeLogMotion.addListener(motionChanged);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible'){swipe=null;homeLogTouching=false}syncHomeLogTimer(true)});addEventListener('pagehide',()=>{swipe=null;homeLogTouching=false;stopHomeLogTimer()});addEventListener('pageshow',()=>syncHomeLogTimer(true));
  }

  function renderFeed(){
    markGrowthLogsSeen();renderHomeLog();
    const box=$('#feed');
    const pa=$('#postAvatar');pa.style.backgroundColor=uid?colorOf(uid):'var(--accent)';paintAvatar(pa,profile.avatar,profile.nick);
    if(backend!=='cloud'){box.innerHTML=`<div class="card empty"><b style="color:var(--ink)">成長ログはまだ使えません</b>ログインすると、仲間の投稿が見られます。</div>`;return}
    if(pending()){box.innerHTML=PENDING_BOX('成長ログ');return}
    if(!feedReady){box.innerHTML='<div class="card empty">読み込んでいます…</div>';return}
    const q=tlQuery.toLowerCase();
    const list=feedAll.filter(x=>(!tlMine||x.uid===uid)&&(!q||x.text.toLowerCase().includes(q)||nameOf(x.uid).toLowerCase().includes(q)||postCategoriesOf(x).some(c=>c.includes(q))));
    if(!list.length){box.innerHTML=feedAll.length
      ?`<div class="card empty"><b style="color:var(--ink)">該当する投稿がありません</b>検索の言葉や「自分の投稿」の切り替えを見直してください。</div>`
      :`<div class="card empty"><svg class="i" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><b style="color:var(--ink)">最初の記録を書いてみよう</b>今日の学びを共有すると、仲間の学びも深まります。</div>`;return}
    box.innerHTML='';
    list.slice(0,100).forEach(x=>{
      const key=x.uid+':'+x.id,fires=likesAll.filter(l=>l.key===key).length,mine=myLikes.includes(key);
      const cs=cmtsAll.filter(c=>c.key===key),open=openCmts.has(key);
      const el=document.createElement('article');el.className='card post';el.dataset.postKey=key;
      el.innerHTML=`<div class="head"><div><b></b><span></span></div></div><p class="text"></p>
        <div class="acts"><button type="button" class="react cheer" data-like="${esc(key)}" aria-pressed="${mine}" aria-label="応援する"><span class="emo" aria-hidden="true">💪</span><span>${fires}</span></button><button type="button" class="react" data-cmt="${esc(key)}" aria-pressed="${open}" aria-label="コメント">${BUBBLE}<span>${cs.length}</span></button>${x.uid===uid?`<button type="button" class="del-post" data-del-post="${esc(x.id)}">削除</button>`:''}</div>`;
      el.querySelector('.head').prepend(avatarEl(x.uid));
      el.querySelector('b').textContent=nameOf(x.uid);
      el.querySelector('.head span').textContent=postTimeText(x.at);
      el.querySelector('.text').textContent=x.text;
      const categories=postCategoriesOf(x);
      if(categories.length){const tags=document.createElement('div');tags.className='post-tags';categories.forEach(category=>{const tag=document.createElement('span');tag.className='post-category';tag.textContent=category;tags.append(tag)});el.querySelector('.text').before(tags)}
      if(open){
        const wrap=document.createElement('div');wrap.className='comments';
        cs.forEach(c=>{const row=document.createElement('div');row.className='cmt';const d=document.createElement('div');
          d.innerHTML='<b></b><p></p>';d.querySelector('b').textContent=nameOf(c.uid);const t=document.createElement('small');t.textContent=agoText(c.at);d.querySelector('b').append(t);
          d.querySelector('p').textContent=c.text;row.append(avatarEl(c.uid),d);wrap.append(row)});
        const f=document.createElement('form');f.className='cmt-form';f.dataset.cmtForm=key;
        f.innerHTML='<input type="text" maxlength="300" placeholder="コメントを書く" aria-label="コメント"><button type="submit">送信</button>';
        wrap.append(f);el.append(wrap);
      }
      box.append(el);
    });
  }
  const selectedPostCategories=()=>[...document.querySelectorAll('#postCategories input:checked')].map(x=>x.value);
  function updatePostCategories(){
    const count=selectedPostCategories().length;
    document.querySelectorAll('#postCategories input').forEach(x=>{x.disabled=!x.checked&&count>=3});
    $('#postCategoryHint').textContent=`1〜3つ選んでください（${count} / 3）`;
  }
  $('#postCategories').addEventListener('change',updatePostCategories);
  const openComposer=on=>{$('#postForm').hidden=!on;$('#writeBtn').hidden=on;if(on)$('#postText').focus()};
  $('#writeBtn').onclick=()=>{if(backend!=='cloud'||!uid){toast('ログインすると投稿できます');return}if(pending()){toast('ホストの承認後に投稿できます');return}openComposer(true)};
  $('#postCancel').onclick=()=>openComposer(false);
  $('#tlSearch').addEventListener('input',e=>{tlQuery=e.target.value.trim();renderFeed()});
  $('#tlMine').onclick=()=>{tlMine=!tlMine;$('#tlMine').setAttribute('aria-pressed',tlMine);renderFeed()};
  $('#postText').addEventListener('input',e=>{$('#postCount').textContent=`${e.target.value.length} / 500`});
  $('#postForm').addEventListener('submit',e=>{
    e.preventDefault();
    if(backend!=='cloud'||!uid){toast('ログインすると投稿できます');return}
    if(pending()){toast('ホストの承認後に投稿できます');return}
    const text=$('#postText').value.trim();
    if(!text){toast('投稿する内容を書いてください');return}
    const categories=selectedPostCategories();
    if(categories.length<1||categories.length>3||categories.some(c=>!POST_CATEGORIES.includes(c))){toast('記録の種類は1〜3つ選んでください');$('#postCategories input:checked, #postCategories input:not(:disabled)').focus();return}
    const post={categories,category:categories[0],id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),text:text.slice(0,500),at:new Date().toISOString()};
    myPosts.push(post);if(myPosts.length>MAX_POSTS)myPosts=myPosts.slice(-MAX_POSTS);
    feedAll=[{...post,uid},...feedAll];
    document.querySelectorAll('#postCategories input:checked').forEach(x=>{x.checked=false});updatePostCategories();
    $('#postText').value='';$('#postCount').textContent='0 / 500';openComposer(false);
    renderFeed();flushPosts();toast('投稿しました');
  });
  $('#feed').addEventListener('submit',e=>{
    const f=e.target.closest('[data-cmt-form]');if(!f)return;e.preventDefault();
    const input=f.querySelector('input'),text=input.value.trim();if(!text)return;
    const c={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),key:f.dataset.cmtForm,text:text.slice(0,300),at:new Date().toISOString()};
    myCmts.push(c);if(myCmts.length>MAX_CMTS)myCmts=myCmts.slice(-MAX_CMTS);
    cmtsAll=[...cmtsAll,{...c,uid}];renderFeed();flushPosts();
  });
  let delArmed='';
  $('#feed').addEventListener('click',e=>{
    const lk=e.target.closest('[data-like]');
    if(lk){
      if(backend!=='cloud'||!uid||pending())return;
      const key=lk.dataset.like,i=myLikes.indexOf(key);
      if(i<0){myLikes.push(key);if(myLikes.length>MAX_LIKES)myLikes=myLikes.slice(-MAX_LIKES);likesAll.push({by:uid,key})}
      else{myLikes.splice(i,1);likesAll=likesAll.filter(l=>!(l.by===uid&&l.key===key))}
      renderFeed();flushPosts();return;
    }
    const cb=e.target.closest('[data-cmt]');
    if(cb){const k=cb.dataset.cmt;openCmts.has(k)?openCmts.delete(k):openCmts.add(k);renderFeed();
      if(openCmts.has(k)){const f=[...document.querySelectorAll('[data-cmt-form]')].find(x=>x.dataset.cmtForm===k);if(f)f.querySelector('input').focus()}return}
    const dp=e.target.closest('[data-del-post]');
    if(dp){
      const id=dp.dataset.delPost;
      if(delArmed!==id){delArmed=id;dp.textContent='本当に削除';setTimeout(()=>{if(delArmed===id){delArmed='';dp.textContent='削除'}},3000);return}
      delArmed='';myPosts=myPosts.filter(p=>p.id!==id);feedAll=feedAll.filter(p=>!(p.uid===uid&&p.id===id));
      renderFeed();flushPosts();toast('投稿を削除しました');
    }
  });

  // ---------- buddy chat: each person keeps their own messages in chats/<uid> ----------
  let chatReads={},giveReads={},myReadAt='',myGiveReadAt='',readTimer=0,chatMode='chat',chatAll=[],myMsgs=[],chatWriting=false,chatAgain=false,giveMode=false,giveTo='',chatReady=false;
  const MAX_MY_MSGS=200;
  const memberOf=id=>members.find(m=>m.uid===id);
  const nameOf=id=>{const m=memberOf(id);return(m&&m.nick)||(id===uid?(profile.nick||'あなた'):'メンバー')};
  const avatarOf=id=>{const m=memberOf(id);return m?m.avatar:(id===uid?profile.avatar:'')};
  const giveCount=id=>chatAll.filter(x=>x.type==='give'&&x.to===id&&!x.unsent).length;
  function subscribeChat(){
    db.collection('chats').onSnapshot(snap=>{
      const all=[],reads={},greads={};
      snap.docs.forEach(d=>{
        const v=d.data()||{};if(typeof v.readAt==='string')reads[d.id]=v.readAt;if(typeof v.giveReadAt==='string')greads[d.id]=v.giveReadAt;
        if(d.id===uid&&typeof v.readAt==='string'&&v.readAt>myReadAt)myReadAt=v.readAt;
        if(d.id===uid&&typeof v.giveReadAt==='string'&&v.giveReadAt>myGiveReadAt)myGiveReadAt=v.giveReadAt;
        const arr=v.msgs;if(!Array.isArray(arr))return;
        arr.forEach(x=>{if(x&&typeof x.text==='string'&&typeof x.at==='string')all.push({id:String(x.id||''),type:x.type==='give'?'give':'msg',to:String(x.to||''),text:x.unsent?'':x.text.slice(0,300),unsent:x.unsent===true,at:x.at,uid:d.id})});
        if(d.id===uid)myMsgs=clone(arr);
      });
      all.sort((p,q)=>p.at.localeCompare(q.at));
      chatAll=all;chatReads=reads;giveReads=greads;chatReady=true;
      renderChat();renderBuddies();renderMembers();
    },()=>{chatReady=true;renderChat()});
  }
  async function flushChat(){
    if(chatWriting){chatAgain=true;return}
    chatWriting=true;
    try{do{chatAgain=false;await db.doc('chats/'+uid).set({msgs:clone(myMsgs),readAt:myReadAt,giveReadAt:myGiveReadAt})}while(chatAgain)}
    catch(e){toast('送信できませんでした。通信状況を確認してください')}
    finally{chatWriting=false}
  }
  const hhmm=iso=>{const d=new Date(iso);return isNaN(d)?'':`${d.getHours()}:${pad(d.getMinutes())}`};
  const dayLabel=at=>{const d=new Date(at);if(isNaN(d))return'';const k=iso(d);return k===todayKey?'今日':k===yesterdayKey?'昨日':`${d.getMonth()+1}月${d.getDate()}日`};
  function mkAvatar(id){const a=document.createElement('div');a.className='avatar';a.setAttribute('role','img');a.setAttribute('aria-label',nameOf(id)+'のプロフィール');a.style.backgroundColor=colorOf(id);paintAvatar(a,avatarOf(id),nameOf(id));return a}
  function markRead(){
    if(backend!=='cloud'||!uid||pending()||!chatReady||$('#v-mates').hidden||document.visibilityState!=='visible')return;
    const give=chatMode==='give';
    const newest=chatAll.filter(x=>x.uid!==uid).reduce((a,x)=>x.at>a?x.at:a,'');   // one room: every message counts
    if(!newest||newest<=(give?myGiveReadAt:myReadAt))return;
    if(give)myGiveReadAt=newest;else myReadAt=newest;
    clearTimeout(readTimer);readTimer=setTimeout(flushChat,1500);
  }
  document.addEventListener('visibilitychange',()=>{markRead();markGrowthLogsSeen()});
  const readCount=(at,give)=>Object.entries(give?giveReads:chatReads).filter(([id,r])=>id!==uid&&r>=at).length;
  let unsendOpen='';
  function unsendMsg(id){
    const m=myMsgs.find(v=>v.id===id);if(!m)return;
    m.unsent=true;m.text='';unsendOpen='';
    chatAll=chatAll.map(v=>v.uid===uid&&v.id===id?{...v,unsent:true,text:''}:v);
    renderChat();renderBuddies();flushChat();toast('送信を取り消しました');
  }
  const chatHideKey=x=>JSON.stringify([x.uid,x.id,x.at]);
  async function deleteMyChat(id){
    const message=chatAll.find(x=>x.uid===uid&&x.id===id);if(!message||pending())return;
    const hidden=Array.isArray(profile.hiddenChatMessages)?profile.hiddenChatMessages:[];
    profile.hiddenChatMessages=[...new Set([...hidden,chatHideKey(message)])].slice(-2000);
    unsendOpen='';renderChat();
    if(await saveProfile())toast('自分の画面から削除しました');
  }
  document.addEventListener('click',e=>{if(unsendOpen&&!e.composedPath().includes($('#chatLog'))){unsendOpen='';renderChat()}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&unsendOpen){unsendOpen='';renderChat()}});
  $('#chatLog').addEventListener('click',e=>{
    const u=e.target.closest('[data-unsend]');if(u){unsendMsg(u.dataset.unsend);return}
    const del=e.target.closest('[data-chat-delete]');if(del){deleteMyChat(del.dataset.chatDelete);return}
    const b=e.target.closest('[data-mine]');if(b){unsendOpen=unsendOpen===b.dataset.mine?'':b.dataset.mine;renderChat()}
  });
  // LINE-style long press (and right click) on your own bubble also opens the menu
  let pressT=0;
  $('#chatLog').addEventListener('pointerdown',e=>{const b=e.target.closest('[data-mine]');if(!b)return;clearTimeout(pressT);pressT=setTimeout(()=>{unsendOpen=b.dataset.mine;renderChat();if(navigator.vibrate)try{navigator.vibrate(15)}catch(_){}},450)});
  ['pointerup','pointerleave','pointercancel'].forEach(t=>$('#chatLog').addEventListener(t,()=>clearTimeout(pressT)));
  $('#chatLog').addEventListener('contextmenu',e=>{const b=e.target.closest('[data-mine]');if(!b)return;e.preventDefault();unsendOpen=b.dataset.mine;renderChat()});
  $('#chatLog').addEventListener('keydown',e=>{const b=e.target.closest('[data-mine]');if(b&&(e.key==='Enter'||e.key===' ')){e.preventDefault();unsendOpen=b.dataset.mine;renderChat()}});
  function renderChat(){
    const log=$('#chatLog');
    if(backend!=='cloud'){log.innerHTML=`<div class="empty"><b style="color:var(--ink)">チャットはまだ使えません</b>ログインすると、仲間とチャットできます。</div>`;return}
    if(pending()){log.innerHTML=PENDING_BOX('トーク');return}
    if(!chatReady){log.innerHTML='<div class="empty">読み込んでいます…</div>';return}
    const nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<80;
    const hiddenMessages=new Set(Array.isArray(profile.hiddenChatMessages)?profile.hiddenChatMessages:[]);
    const list=chatAll.filter(x=>!hiddenMessages.has(chatHideKey(x))).slice(-150);
    if(!list.length){log.innerHTML=chatMode==='give'
      ?`<div class="empty"><svg class="i" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg><b style="color:var(--ink)">最初のGIVEを贈ろう</b>仲間への感謝や称賛を、ひとこと送ってみましょう。</div>`
      :`<div class="empty"><svg class="i" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><b style="color:var(--ink)">最初のひとことを送ろう</b>今日の宣言や、仲間への応援を書いてみましょう。</div>`;return}
    log.innerHTML='';let lastDay='',prevU='',prevT=0;
    list.forEach(x=>{
      const day=dayLabel(x.at);
      if(day&&day!==lastDay){const dd=document.createElement('div');dd.className='chat-day';dd.textContent=day;log.append(dd);lastDay=day;prevU=''}
      if(x.unsent){const n=document.createElement('div');n.className='chat-sys';n.textContent=(x.uid===uid?'あなた':nameOf(x.uid))+'がメッセージの送信を取り消しました';log.append(n);prevU='';return}
      const me=x.uid===uid,tm=new Date(x.at).getTime(),first=x.uid!==prevU||tm-prevT>5*60000;
      prevU=x.uid;prevT=tm;
      const row=document.createElement('div');row.className='msg'+(me?' me':'')+(first?' first':' cont');
      const body=document.createElement('div');body.className='body';
      if(!me&&first){const f=document.createElement('span');f.className='from';f.textContent=nameOf(x.uid);body.append(f)}
      const line=document.createElement('div');line.className='line';
      const bub=document.createElement('div');bub.className='bubble'+(x.type==='give'?' give':'');
      if(me){bub.dataset.mine=x.id;bub.tabIndex=0;bub.setAttribute('aria-label','メッセージ（タップで送信取り消し・削除メニュー）')}
      if(x.type==='give'&&x.to){const g=document.createElement('span');g.className='gto';g.textContent=`→ ${nameOf(x.to)}へ`;bub.append(g,document.createTextNode(x.text))}
      else bub.textContent=x.text;
      const meta=document.createElement('div');meta.className='meta';
      if(me){const n=readCount(x.at);if(n){const r=document.createElement('span');r.className='read';r.textContent=`既読 ${n}`;meta.append(r)}}
      const t=document.createElement('time');t.textContent=hhmm(x.at);meta.append(t);
      line.append(bub,meta);body.append(line);
      if(!me){if(first)row.append(mkAvatar(x.uid));else{const sp=document.createElement('span');sp.className='av-sp';row.append(sp)}}
      row.append(body);log.append(row);
      if(me&&unsendOpen===x.id){const m=document.createElement('div');m.className='unsend-menu';m.innerHTML='<button type="button" data-unsend="'+esc(x.id)+'">送信取り消し</button><button type="button" data-chat-delete="'+esc(x.id)+'">削除</button>';body.append(m)}
    });
    if(nearBottom||renderChat.stick){log.scrollTop=log.scrollHeight;renderChat.stick=false}
    markRead();
  }
  function renderBuddies(){
    const strip=$('#buddyStrip'),chips=$('#giveChips');
    const others=members.filter(m=>m.uid!==uid).sort((p,q)=>giveCount(q.uid)-giveCount(p.uid));
    if(pending()){strip.innerHTML='<p class="muted" style="font-size:12px">ホストの承認後に、仲間が表示されます。</p>';chips.innerHTML='';return}
    if(backend!=='cloud'||!others.length){
      strip.innerHTML=`<p class="muted" style="font-size:12px">${backend!=='cloud'?'ログインすると仲間が表示されます。':'仲間がアプリに登録すると、ここに並びます。'}</p>`;chips.innerHTML='';return}
    strip.innerHTML='';chips.innerHTML='';
    others.forEach(m=>{
      const b=document.createElement('button');b.type='button';b.className='buddy';b.dataset.give=m.uid;b.setAttribute('aria-pressed',giveMode&&giveTo===m.uid);
      const n=document.createElement('span'),g=document.createElement('b');n.textContent=m.nick||'メンバー';g.textContent=`GIVE ${giveCount(m.uid)}`;
      b.append(mkAvatar(m.uid),n,g);strip.append(b);
      const c=document.createElement('button');c.type='button';c.dataset.give=m.uid;c.textContent=m.nick||'メンバー';c.setAttribute('aria-pressed',giveTo===m.uid);chips.append(c);
    });
  }
  function setGive(on,to){
    giveMode=on;if(to!==undefined)giveTo=to;if(!on)giveTo='';if(!giveMode&&chatMode==='give')giveMode=true;
    $('#giveBtn').setAttribute('aria-pressed',giveMode);$('#giveTo').hidden=true;
    $('#chatInput').placeholder=giveMode?'感謝や称賛のメッセージを入力':'メッセージを入力';
    renderBuddies();
  }
  $('#giveBtn').onclick=()=>setGive(!giveMode);
  $('#buddyStrip').addEventListener('click',e=>{const b=e.target.closest('[data-give]');if(!b)return;setGive(true,b.dataset.give);$('#chatInput').focus()});
  $('#giveChips').addEventListener('click',e=>{const b=e.target.closest('[data-give]');if(!b)return;setGive(true,b.dataset.give);$('#chatInput').focus()});
  // LINE-style input: Enter adds a new line, the send button sends (Ctrl/⌘+Enter also sends)
  function fitChatInput(){const t=$('#chatInput');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,132)+'px'}
  $('#chatInput').addEventListener('input',fitChatInput);
  $('#chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.isComposing){e.preventDefault();$('#composer').requestSubmit()}});
  $('#composer').addEventListener('submit',e=>{
    e.preventDefault();
    if(backend!=='cloud'||!uid){toast('ログインするとチャットできます');return}
    if(pending()){toast('ホストの承認後にトークできます');return}
    const input=$('#chatInput'),text=input.value.trim();
    if(!text){toast(giveMode?'贈る言葉を書いてください':'メッセージを入力してください');return}
    const msg={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),type:giveMode?'give':'msg',to:giveMode?giveTo:'',text:text.slice(0,300),at:new Date().toISOString()};
    myMsgs.push(msg);if(myMsgs.length>MAX_MY_MSGS)myMsgs=myMsgs.slice(-MAX_MY_MSGS);
    chatAll=[...chatAll,{...msg,uid}];
    input.value='';fitChatInput();renderChat.stick=true;
    if(giveMode)setGive(chatMode==='give','');
    renderChat();renderBuddies();flushChat();
  });
  document.querySelectorAll('[data-mt]').forEach(b=>b.onclick=()=>{
    const t=b.dataset.mt;document.querySelectorAll('[data-mt]').forEach(x=>x.setAttribute('aria-selected',x===b));
    $('#mtChat').hidden=t==='members';$('#mtMembers').hidden=t!=='members';
    if(t!=='members'){chatMode=t;$('#talkTitle').textContent=t==='give'?'GIVE BUDDIES':'GIVE BUDDIES';$('#buddyCard').hidden=true;setGive(t==='give','');renderChat.stick=true;renderChat()}
  });

  async function savePhoto(){
    if(backend!=='cloud'){if(photo){if(!local.set(LK.ph,photo)){toast('写真が大きすぎて保存できませんでした');return false}}else local.del(LK.ph);return true}
    try{photo?await phRef().set({src:photo}):await phRef().delete();return true}
    catch(e){toast('写真を保存できませんでした');return false}
  }
  async function saveReflection(r,quiet){
    if(backend!=='cloud'){if(!local.set(LK.r,reflections)){toast('この端末に保存できませんでした');return false}return true}
    unsaved.refl.add(r.id);
    try{await rCol().doc(r.id).set(clone(r));unsaved.refl.delete(r.id);return true}
    catch(e){if(!quiet)toast('保存できませんでした。通信状況を確認してください');return false}
    finally{showUnsaved()}
  }

  async function initCloud(){
    // Supabase build: a signed-in person whose records cannot be read gets an error screen, not this browser's copy
    const none=()=>{if(STRICT)loadFailed=true;return setStatus()};
    if(!window.claude||!window.claude.use)return none();
    try{
      const [d,u]=await Promise.all([window.claude.use('db'),window.claude.use('user')]);
      if(!d||!u)return none();
      const id=await u.id();if(!id)return none();
      db=d;base='data/users/'+id;uid=id;userNs=u;
      const [p,ph,rs]=await Promise.all([pRef().get(),phRef().get(),rCol().get()]);
      backend='cloud';
      if(STRICT){
        // only this account's own records; this browser's leftovers are offered, never copied on their own
        profile=p.exists?Object.assign(defaultProfile(),clone(p.data())):defaultProfile();
        photo=ph.exists?ph.data().src||'':'';
        reflections=rs.docs.map(x=>clone(x.data()));
        if(!p.exists)offerLocal=localLeftovers();
      }else{
        if(p.exists)profile=Object.assign(defaultProfile(),clone(p.data()));
        else{await pRef().set(clone(profile))}            // first visit: carry over what this browser had
        if(ph.exists)photo=ph.data().src||'';else if(photo)await phRef().set({src:photo});
        if(rs.size)reflections=rs.docs.map(x=>clone(x.data()));
        else for(const r of reflections)await rCol().doc(r.id).set(clone(r));
      }
      // the Firebase adapter has no approval step, so everyone there counts as approved
      approved=u.isMember?await u.isMember().catch(()=>false):true;
      renderAll();fillForm();
      if(approved)openShared();else watchApproval();
      syncMember();
      u.isOwner().then(setOwnerView).catch(()=>setOwnerView(false));
    }catch(e){backend='local';db=null;uid=null;if(STRICT){loadFailed=true;return}}
    setStatus();renderMembers();
  }
  // members, talk, growth log and the meeting link: only once a host has approved this person
  let sharedOpen=false;
  function openShared(){
    if(sharedOpen)return;sharedOpen=true;
    subscribeMembers();subscribeChat();subscribeFeed();subscribeQuotes();subscribeMeeting();
    if(!$('#v-soon').hidden)openYoutube();
  }
  function watchApproval(){
    renderMembers();renderFeed();renderChat();renderBuddies();renderZoom();
    const check=async()=>{
      if(approved||document.visibilityState!=='visible')return;
      if(!(await userNs.isMember().catch(()=>false)))return;
      approved=true;clearInterval(timer);openShared();
      renderMembers();renderFeed();renderChat();renderBuddies();renderZoom();
      toast('ホストに承認されました。仲間の機能が使えます');
    };
    const timer=setInterval(check,60000);
    document.addEventListener('visibilitychange',check);
  }
  function setStatus(){
    $('#storeStatus').textContent=backend==='cloud'
      ?'データはあなたのアカウントに保存されます（どの端末からでも同じ内容）'
      :'データはこの端末のブラウザにだけ保存されています';
  }

  // ---------- check stats ----------
  const isOn=k=>!!profile.checks[k];
  let checkSaving=false;
  async function completeDay(key){
    refreshDayClock();
    const day=key||todayKey;
    if(day!==todayKey||checkSaving||isOn(day)||loadFailed)return false;
    checkSaving=true;profile.checks[day]=true;renderHome();renderCheck();
    try{const ok=await saveProfile();if(ok)toast('チェックしました');return ok}
    finally{checkSaving=false;renderHome();renderCheck()}
  }
  function monthStats(y,m){
    let on=0,days=0;const last=new Date(y,m+1,0).getDate();
    for(let d=1;d<=last;d++){const dt=new Date(y,m,d);if(dt>TODAY)break;days++;if(isOn(iso(dt)))on++}
    return{on,days,rate:days?Math.round(on/days*100):0};
  }
  function streak(){let n=0,d=new Date(TODAY);if(!isOn(iso(d)))d=addDays(d,-1);while(isOn(iso(d))){n++;d=addDays(d,-1)}return n}

  // ---------- reflection periods ----------
  const curKey={week:iso(mondayOf(TODAY)),month:`${TODAY.getFullYear()}-${pad(TODAY.getMonth()+1)}`};
  const findR=(type,key)=>reflections.find(r=>r.type===type&&r.key===key);
  function periodLabel(type,key){
    if(type==='week'){const s=parseIso(key);return `${s.getFullYear()}年 ${md(s)}（月）〜 ${md(addDays(s,6))}（日）`}
    const[y,m]=key.split('-').map(Number);return `${y}年${m}月`;
  }
  function sortKey(r){if(r.type==='week')return iso(addDays(parseIso(r.key),6));const[y,m]=r.key.split('-').map(Number);return iso(new Date(y,m,0))}

  // ---------- home ----------
  // 365 short lines under the aspiration, one for each day of the year (same for everyone on that date)
  const HERO_LINES=["志は、毎日の小さな行動で磨かれる", "今日の一歩が、未来の自分をつくる", "昨日の自分を、ほんの少し越えていこう", "続けた日々が、いちばんの自信になる", "迷ったら、志に立ち返ればいい", "小さな約束を守ることから、始めよう", "仲間がいるから、もう一歩進める", "朝の過ごし方が、一日を決める", "できなかった日も、また今日から", "想いは、行動にしてはじめて伝わる", "今日できることを、今日のうちに", "志を語れる人は、強くなれる", "感謝を伝えると、自分も前に進める", "積み重ねは、裏切らない", "始めるのに、遅すぎることはない", "完璧より、まず一歩", "一日一歩、三日で三歩", "失敗は、挑戦した人だけの勲章", "焦らず、腐らず、諦めず", "笑顔は、いちばん近くの人を明るくする", "自分との約束を、いちばん大切に", "未来は、今日の選択の先にある", "やると決めたら、もう半分できている", "「ありがとう」は、何度言ってもいい", "早起きは、自分への最初の贈り物", "深呼吸ひとつで、心は整う", "誰かの挑戦を、全力で応援しよう", "今日の自分に、花丸をあげよう", "小さな勝ちを、積み上げていこう", "夢は、言葉にすると近づいてくる", "目の前の一人を、大切にしよう", "悩んだ時間も、ちゃんと力になっている", "変われるのは、いつだって今日から", "行動は、不安を小さくする", "朝日を浴びて、心をリセット", "目標は、紙に書くと動き出す", "できる理由を、探してみよう", "自分の機嫌は、自分でとる", "一流は、準備で決まる", "迷うなら、ワクワクする方へ", "人の良いところを、ひとつ見つけよう", "今日は、昨日の続きじゃない", "小さな習慣が、大きな人生をつくる", "一度決めたら、まず七日続けよう", "ゆっくりでも、止まらなければいい", "挑戦する人は、いつも美しい", "「できた」を数えて、眠りにつこう", "言い訳より、工夫をひとつ", "自分を信じる力は、行動から生まれる", "今日会う人に、元気を届けよう", "限界は、思い込みのことが多い", "志が、迷いを晴らしてくれる", "小さな親切が、世界を変える", "学ぶことを、楽しもう", "疲れたら、休むことも前進", "本気の人に、本気の仲間が集まる", "やりたいことを、ひとつ口に出そう", "朝の静けさは、考える時間", "今日の努力は、明日の余裕になる", "背伸びした分だけ、背は伸びる", "誰かのために動くと、力が湧く", "できないことより、できることを", "今日一日を、丁寧に生きよう", "自分のペースで、自分の道を", "思い立った日が、吉日", "大切なことは、いつもシンプル", "苦手なことにも、一度向き合ってみよう", "言葉を変えると、行動が変わる", "いい一日は、いい朝から", "人と比べず、昨日と比べる", "挑んだ分だけ、景色は変わる", "続ける人が、最後に笑う", "一歩を小さくすれば、必ず進める", "気づいたら、すぐやってみよう", "仲間の成功を、自分のことのように喜ぼう", "感情に名前をつけると、心が落ち着く", "やる気は、動いてから湧いてくる", "今日を、誰かの記念日にしよう", "信頼は、小さな約束の積み重ね", "失敗から学べば、それは経験になる", "心が動いたら、それが答え", "朝の一杯の水から、始めよう", "自分に優しく、目標には厳しく", "変化を、楽しんでみよう", "感謝できることを、三つ数えよう", "誰かの「ありがとう」を、集めにいこう", "小さな成功体験が、自信を育てる", "目標を、仲間に宣言しよう", "迷った時は、原点を思い出そう", "今日の自分が、一番若い", "できることを、できるだけ", "本気で生きると、毎日が楽しい", "人を笑顔にした数が、豊かさになる", "休む勇気も、持っていよう", "変わらない毎日に、小さな変化を", "今日の積み重ねが、一年後の自分", "話すより、まず聴いてみよう", "好きなことに、夢中になろう", "決断は、早いほど身軽になる", "まずやってみて、あとで整える", "自分の言葉で、志を語ろう", "小さな挑戦を、ひとつ選ぼう", "誰かと比べるより、昨日より一歩", "困った時ほど、笑ってみよう", "今日の学びを、ひとつ持ち帰ろう", "時間は、未来の自分への投資", "一緒に頑張れる仲間は、宝物", "人の話に、最後まで耳を傾けよう", "やり切った日は、よく眠れる", "あきらめなければ、それは途中", "朝の宣言で、一日のスイッチを入れよう", "前を向けば、道は見えてくる", "自分の可能性に、ふたをしない", "今日も、自分を応援しよう", "目標までの距離より、進んだ距離を見よう", "気持ちのいい挨拶から、始めよう", "誰かの一歩を、そっと後押ししよう", "悔しさは、伸びしろのサイン", "集中する時間を、ひとつ作ろう", "心に余白を、つくっておこう", "周りの人は、自分を映す鏡", "感謝は、心を強くする", "できない日があっても、大丈夫", "自分らしさは、続けた先に見つかる", "今日の一言が、誰かを救うかもしれない", "未来の自分に、胸を張れる選択を", "挑戦の数だけ、物語が生まれる", "小さな「やった」を、大切に", "人を信じることから、始めよう", "迷いながらでも、進めばいい", "自分の決めたことを、やり抜こう", "朝の時間は、自分だけのもの", "知ることは、楽しい", "動けば、何かが変わる", "今日は、新しい自分に出会う日", "誰かの頑張りに、気づける人に", "一日の終わりに、自分をほめよう", "まっすぐな想いは、必ず届く", "困難は、成長の入口", "今日の汗が、明日の笑顔になる", "ひとりで抱えず、仲間に頼ろう", "ゴールを思い描いて、今日を始めよう", "言葉にした目標は、もう動き出している", "やさしさは、強さのひとつ", "新しいことを、ひとつ試してみよう", "人の役に立てた日は、心が温かい", "自分の成長を、楽しもう", "目の前のことに、全力で", "今日の自分を、信じてみよう", "笑顔で過ごせば、運も味方する", "転んでも、起き上がればいい", "大事なのは、続けること", "朝のひと工夫が、一日を軽くする", "挑戦しない後悔より、挑戦した経験を", "今日も、志とともに", "人とのご縁を、大切に", "「どうせ」を「せっかく」に変えよう", "やってみたら、意外とできる", "今日の小さな前進を、祝おう", "未来は、自分の手でつくれる", "迷わず、まず手を動かそう", "仲間の言葉に、背中を押してもらおう", "深く考えるより、一歩踏み出そう", "自分の強みを、ひとつ活かそう", "誰かの役に立つことが、生きがいになる", "朝の空気を、胸いっぱいに", "継続は、才能を超えていく", "自分の心の声を、聴いてみよう", "大きな夢も、小さな一歩から", "今日は、昨日よりいい日にしよう", "人生は、選択の積み重ね", "相手の立場で、考えてみよう", "自分の時間を、大切に使おう", "仲間と分かち合うと、喜びは倍になる", "目標は、高くていい", "できたことを、仲間に伝えよう", "悩みは、言葉にすると軽くなる", "今この瞬間を、大切に", "朝の決意を、夜まで持ち続けよう", "誰かのお手本になる一日を", "苦しい時こそ、志を思い出そう", "今日の挑戦が、明日の当たり前になる", "人は、何度でもやり直せる", "いい言葉を、口ぐせにしよう", "ていねいな仕事は、人の心に残る", "自分を大切にできる人は、人も大切にできる", "一日をふり返る時間を、持とう", "小さな改善を、毎日続けよう", "感動したことを、誰かに話そう", "今日の自分を、未来の自分が見ている", "迷ったら、誠実な方を選ぼう", "やりたいことを、後回しにしない", "仲間の存在が、続ける力になる", "自分の機嫌が、周りの空気をつくる", "どんな日も、学びがある", "朝の一歩が、人生の一歩", "勇気は、使うほど大きくなる", "周りに感謝できる人は、伸び続ける", "まずは、五分だけやってみよう", "自分の言葉に、責任を持とう", "今日の目標を、ひとつに絞ろう", "人の喜ぶ顔を、思い浮かべよう", "積み重ねた日々が、志を形にする", "自分にできる最善を、今日も", "過去は変えられない、未来はつくれる", "休んだら、また歩き出せばいい", "人の挑戦を、笑わない人でいよう", "今日は、何に挑戦しよう", "うまくいかない日も、意味がある", "目標を、毎朝見直そう", "感謝の気持ちを、行動で示そう", "自分を変えたいなら、習慣を変えよう", "笑顔の多い人に、人は集まる", "本気で向き合えば、必ず伝わる", "今日の一日に、意味を見つけよう", "新しい朝に、新しい気持ちで", "やると決めた自分を、誇りに思おう", "相手を認めると、自分も認められる", "小さな約束を、今日も守ろう", "朝の宣言は、未来への約束", "迷う時間を、動く時間に", "今日のがんばりは、誰かが見ている", "ひとつの行動が、流れを変える", "仲間と共に、昨日の自分を越えよう", "自分の人生の、主人公になろう", "ゆずれない想いを、持ち続けよう", "できるまで、やってみよう", "今日も、誰かの力になろう", "朝の一言で、チームの空気は変わる", "自分を信じて、もう一歩", "大切な人に、想いを伝えよう", "楽しむ人が、いちばん強い", "一歩踏み出せば、景色が変わる", "自分の成長は、自分で決められる", "今日の選択に、誇りを持とう", "誰かのために、時間を使ってみよう", "目標を、声に出して読んでみよう", "小さなことにも、全力で", "困っている人に、声をかけよう", "朝の光は、新しい始まりの合図", "心が折れそうな日は、仲間を頼ろう", "すぐにできることから、始めよう", "自分の弱さも、受け入れよう", "今日の出会いに、感謝しよう", "続けていれば、道は開ける", "人を責めるより、仕組みを見直そう", "言葉は、未来をつくる種", "今日できた小さな成長を、喜ぼう", "自分の想いに、正直に生きよう", "ひとつずつ、着実に", "今日も、志を胸に一日を", "人の話から、学べることは多い", "迷ったら、未来の自分に聞いてみよう", "朝の時間を、味方につけよう", "期待されるより、期待を超えよう", "失敗を恐れず、まず試そう", "誰かを応援すると、自分も元気になる", "今日の行動が、信頼をつくる", "心を込めて、仕事をしよう", "自分の可能性は、まだまだある", "仲間がいるから、続けられる", "目標に向かう毎日が、楽しい", "今日の「ありがとう」を、増やそう", "変わる勇気を、持とう", "朝の静かな時間に、志を確かめよう", "一つの成功は、多くの挑戦の上にある", "人のせいにしない強さを", "今日の課題に、正面から向き合おう", "自分の言葉で、誰かを励まそう", "できることを増やす喜びを", "今日の一日を、楽しみきろう", "困難も、仲間となら乗り越えられる", "朝の決断が、一日の質を決める", "目の前のことを、ていねいに", "挑戦し続ける自分で、いよう", "人の成長を、喜べる人に", "今日も、あなたらしく", "小さな気づきを、大切にしよう", "目標がある毎日は、輝いている", "感謝を忘れない人で、いよう", "やらない理由より、やる理由を", "朝の一歩を、軽やかに", "自分を磨く時間を、つくろう", "人とのつながりが、力になる", "今日のひと手間が、未来を変える", "迷いは、真剣に生きている証", "誰かの夢を、笑わずに聴こう", "自分で決めた道を、歩こう", "今日の自分に、できる限りを", "朝の約束を、守り抜こう", "悔いのない一日を、送ろう", "仲間と見る景色は、格別", "自分の心に、火をともそう", "一歩ずつでも、確かに前へ", "今日も、新しい自分を楽しもう", "人の想いを、受け取れる人に", "目標までの道のりを、楽しもう", "朝の空を、見上げてみよう", "小さな勇気を、出してみよう", "自分の役割に、誇りを持とう", "今日学んだことを、誰かに伝えよう", "周りを明るくする一言を", "挑戦を、楽しめる人に", "今日の自分に、ありがとう", "未来の仲間のために、今日を生きよう", "志ある一日を、今日も", "朝が来るたび、人は生まれ変われる", "続けてきた自分を、信じよう", "人を思いやる気持ちを、行動に", "今日も、一歩ずつ", "大きな一歩より、確かな一歩", "自分の可能性を、広げていこう", "仲間とともに、最高の朝を", "今日という日は、二度と来ない", "想いを、ひとつ形にしよう", "迷ったら、仲間に相談しよう", "朝の時間に、未来を描こう", "できた自分を、ちゃんと認めよう", "人の良さを、言葉にして伝えよう", "今日の挑戦を、楽しもう", "志を持つ人は、何度でも立ち上がれる", "一年後の自分に、恥じない今日を", "小さな積み重ねが、大きな自信に", "今日も、最高の朝を", "根っこが育つ時期は、外からは見えない", "今日の自分に、ひとつだけ宿題を", "良い習慣は、良い仲間から", "声をかけた分だけ、つながりは深まる", "昨日の反省は、今日の作戦", "自分の「好き」を、大切に育てよう", "やる前の不安は、やった後の自信に変わる", "朝の五分が、夜の満足をつくる", "ひとつの学びを、明日に活かそう", "誰かの背中が、誰かの勇気になる", "いまの頑張りに、未来がうなずいている", "目標は、分ければ届く", "大切な人の顔を、思い浮かべて動こう", "今日のテーマを、ひとつ決めよう", "喜びは、分けると増えていく", "本当にやりたいことに、時間を使おう", "できない自分も、伸びていく途中", "たまには、遠回りも悪くない", "明るい言葉は、明るい未来を呼ぶ", "自分の歩幅で、歩いていこう", "手を動かすと、心もついてくる", "誰かを想う朝は、力が湧く", "あの日の決意を、思い出そう", "今日の一日に、小さな冒険を", "信じて待つことも、ひとつの強さ", "自分との対話を、大切に", "目標を思うだけで、胸が高鳴る日を", "小さな一歩も、続ければ旅になる", "頼ることは、弱さじゃない", "今日も、心のこもった挨拶を", "夢中になれることが、ある幸せ", "悩んだら、紙に書き出してみよう", "一緒に笑える仲間に、感謝を", "自分の約束が、自分をつくる", "今日の選択が、明日の自分を連れてくる", "少しの勇気で、世界は広がる", "誰かのひと言を、宝物にしよう", "今日は、どんな自分でいたいだろう", "磨いた分だけ、志は光る", "ひと区切りついたら、自分をねぎらおう", "明日の朝が、楽しみになる夜を"];
  function renderHome(){
    renderHomeLog();
    { // day of the year (0–364; Dec 31 of a leap year wraps to the first line) → a different line every day
      const doy=Math.round((TODAY-new Date(TODAY.getFullYear(),0,1))/864e5);
      void doy;   // the daily lines are kept in HERO_LINES; this spot now shows the final goal
      const fg=goal().t;
      $('#heroLine').textContent=fg?`最終目標：${fg}`:'最終目標は、プロフィールの変更から設定できます'; }
    $('#shiText').innerHTML=profile.shi?esc(profile.shi).replace(/\n/g,'<br>'):'<span style="opacity:.7">アカウントから志を書いてみよう</span>';
    document.querySelector('.hero .kicker').textContent=profile.nick?`${profile.nick}の志`:'MY ASPIRATION';
    const ha=$('#heroAvatar');ha.hidden=!profile.nick&&!profile.avatar;paintAvatar(ha,profile.avatar,profile.nick);
    $('#daysLine').hidden=true;   // 「志を立てて〇日目」は表示しない
    $('#daysSince').textContent=Math.max(1,Math.round((TODAY-parseIso(profile.shiSince))/864e5)+1);
    const on=isOn(todayKey);
    $('#todayCheck').setAttribute('aria-pressed',on);
    $('#todayCheck').disabled=on||checkSaving||loadFailed;
    $('#todayTitle').textContent=on?'今日のタスク、やり遂げた！':'今日、自分が決めたタスクをやり遂げた？';
    $('#todaySub').textContent=on?'次は明日0:00（日本時間）から':'1日1回。やり遂げたらタップしてチェック';
    $('#todayCheckLabel').textContent=checkSaving?'保存中…':on?'チェック済み':'やり遂げた';
    $('#todayStreak').textContent=`連続 ${streak()} 日`;
    const wDone=!!findR('week',curKey.week),mon=parseIso(curKey.week);
    $('#hRfStatus').textContent=wDone?'今週分は記入済み':'未記入・日曜までに書こう';
    $('#hRfStatus').className=wDone?'':'due';
    $('#hRfCount').textContent=`${reflections.filter(r=>r.type==='week').length}件`;
    $('#hRfWeek').innerHTML=[0,1,2,3,4,5,6].map(i=>{const d=addDays(mon,i);return`<i class="${isOn(iso(d))?'on':''} ${d>TODAY?'fut':''}" title="${md(d)}"></i>`}).join('');
    $('#hRfBtn').textContent=wDone?'見直す':'振り返る';$('#hRfBtn').classList.toggle('done',wDone);
    renderGoal();renderMap();
  }
  $('#todayCheck').onclick=()=>completeDay();



  // ---------- milestone list editor: the person decides how many points ----------
  const MAX_MS=20;
  const MS_PH=['例：やりたいことを100個書く','例：先輩3人に話を聞く','例：企画書を完成させる','例：協力者を集める','例：小さく試してみる','例：結果を振り返る'];
  function mountMsEditor(box,prefix,list){
    const read=()=>list.forEach((m,i)=>{const t=document.getElementById(prefix+'T'+i);if(t){m.t=t.value.trim();m.ym=dateVal(prefix+'D'+i)}});
    const draw=()=>{
      box.innerHTML=`<div class="ms-count"><span>途中の地点<b>${list.length}</b>個</span><div class="stepper"><button type="button" data-step="-1" aria-label="地点を1つ減らす">−</button><button type="button" data-step="1" aria-label="地点を1つ増やす">＋</button></div></div>`
        +list.map((m,i)=>`<div class="ms-edit"><div class="ms-row"><span class="ms-no">${i+1}</span><input type="text" id="${prefix}T${i}" value="${esc(m.t)}" placeholder="${MS_PH[i%MS_PH.length]}" aria-label="地点${i+1}の名前"><button type="button" class="icon-btn" data-del="${i}" aria-label="地点${i+1}を削除">×</button></div>${dateField(prefix+'D'+i,m.ym)}</div>`).join('')
        +(list.length<MAX_MS?`<button type="button" class="ghost add-ms" data-step="1">＋ 地点を追加</button>`:'');
    };
    box.onclick=e=>{
      const st=e.target.closest('[data-step]'),dl=e.target.closest('[data-del]');if(!st&&!dl)return;
      read();
      if(st){const d=+st.dataset.step;if(d>0){if(list.length<MAX_MS)list.push({t:'',ym:'',done:false});else toast(`地点は${MAX_MS}個までです`)}else if(list.length)list.pop()}
      if(dl)list.splice(+dl.dataset.del,1);
      draw();
      if(st&&+st.dataset.step>0){const t=document.getElementById(prefix+'T'+(list.length-1));if(t)t.focus()}
    };
    draw();
    return read;
  }

  // ---------- morning meeting link: set by the owner in config/meeting, shown to everyone ----------
  let meeting={url:'',when:'',memo:''},isOwnerView=false;
  const safeUrl=u=>/^https:\/\/[^\s<>"]+$/i.test(u||'')?u:'';
  function renderZoom(){
    if(pending()){$('#zoomView').hidden=true;$('#zoomEmpty').hidden=false;$('#zoomEmpty').textContent='ホストの承認後に、朝会のリンクが表示されます。';$('#zoomEditBtn').hidden=true;return}
    const url=safeUrl(meeting.url),has=!!url||!!meeting.when;
    $('#zoomView').hidden=!has;$('#zoomEmpty').hidden=has;
    $('#zoomEmpty').textContent=isOwnerView?'「編集」から朝会のZoomリンクを登録してください。':'朝会のZoomリンクはまだ登録されていません。';
    $('#zoomEditBtn').hidden=!isOwnerView||!$('#zoomForm').hidden;
    if(has){
      $('#zoomWhen').textContent=meeting.when||'次回の朝会';$('#zoomMemo').textContent=meeting.memo||'';$('#zoomMemo').hidden=!meeting.memo;
      $('#zoomJoin').href=url||'#';$('#zoomUrl').textContent=url||(isOwnerView?'Zoomのリンクは「編集」から登録してください':'Zoomのリンクは準備中です');
      $('#zoomJoin').hidden=!url;$('#zoomCopy').hidden=!url;
    }
  }
  function subscribeMeeting(){
    db.doc('config/meeting').onSnapshot(snap=>{
      const v=snap.exists?snap.data():{};
      meeting={url:typeof v.url==='string'?v.url:'',when:typeof v.when==='string'?v.when:'',memo:typeof v.memo==='string'?v.memo:''};
      renderZoom();
    },()=>{});
  }
  $('#zoomEditBtn').onclick=()=>{$('#zUrl').value=meeting.url;$('#zWhen').value=meeting.when;$('#zMemo').value=meeting.memo;$('#zoomForm').hidden=false;$('#zoomView').hidden=true;$('#zoomEmpty').hidden=true;$('#zoomEditBtn').hidden=true;$('#zUrl').focus()};
  $('#zCancel').onclick=()=>{$('#zoomForm').hidden=true;renderZoom()};
  $('#zoomForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const url=$('#zUrl').value.trim();
    if(url&&!safeUrl(url)){toast('URLは https:// から始まる形で入れてください');return}
    const next={url,when:$('#zWhen').value.trim().slice(0,60),memo:$('#zMemo').value.trim().slice(0,200)};
    try{await db.doc('config/meeting').set(next);meeting=next;$('#zoomForm').hidden=true;renderZoom();toast('朝会のリンクを保存しました')}
    catch(err){toast('保存できませんでした。通信状況を確認してください')}
  });
  $('#zoomCopy').onclick=()=>{
    const url=safeUrl(meeting.url);if(!url)return;
    const done=()=>toast('リンクをコピーしました');
    const fallback=()=>{const r=document.createRange();r.selectNodeContents($('#zoomUrl'));const sel=getSelection();sel.removeAllRanges();sel.addRange(r);toast('リンクを選択しました。コピーしてください')};
    try{navigator.clipboard.writeText(url).then(done,fallback)}catch(err){fallback()}
  };

  // ---------- daily quote: one per day, the same for everyone on that date ----------
  const QUOTES=[
    ['志を立てて以て万事の源と為す','吉田松陰'],
    ['千里の行も足下に始まる','老子'],
    ['学びて思わざれば則ち罔し、思いて学ばざれば則ち殆し','孔子『論語』'],
    ['故きを温ねて新しきを知る','孔子『論語』'],
    ['三人行えば必ず我が師あり','孔子『論語』'],
    ['過ぎたるは猶及ばざるがごとし','孔子『論語』'],
    ['己の欲せざる所は人に施す勿れ','孔子『論語』'],
    ['至誠にして動かざる者は、未だ之れ有らざるなり','孟子'],
    ['為せば成る 為さねば成らぬ何事も 成らぬは人の為さぬなりけり','上杉鷹山'],
    ['天は自ら助くる者を助く','サミュエル・スマイルズ『自助論』'],
    ['初心忘るべからず','世阿弥『花鏡』'],
    ['人間到る処青山あり','月性'],
    ['知ることの難きに非ず、行うことの難きなり','『書経』'],
    ['志あるところに道あり','英語のことわざ'],
    ['人事を尽くして天命を待つ','ことわざ'],
    ['雨垂れ石を穿つ','ことわざ'],
    ['七転び八起き','ことわざ'],
    ['好きこそ物の上手なれ','ことわざ'],
    ['石の上にも三年','ことわざ'],
    ['一期一会','茶道の心得'],
    ['少年老い易く学成り難し、一寸の光陰軽んずべからず','伝・朱熹'],
    ['塵も積もれば山となる','ことわざ'],
    ['急がば回れ','ことわざ'],
    ['継続は力なり','ことわざ']
  ];
  let quoteList=[];
  const dayHash=k=>{let h=2166136261;for(const c of k)h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h};
  function renderQuote(){
    const list=quoteList.length?quoteList.map(q=>[q.text,q.by||'']):QUOTES;
    const [text,by]=list[dayHash(todayKey+'#quote')%list.length];
    $('#quoteDate').textContent=`${TODAY.getMonth()+1}月${TODAY.getDate()}日の名言`;
    $('#quoteText').textContent=text;$('#quoteBy').textContent=by;$('#quoteBy').hidden=!by;
    const c=$('#quoteCard');c.classList.remove('in');void c.offsetWidth;c.classList.add('in');
  }

  // owner-only editor; the list lives in config/quotes, readable by every member
  const parseQuotes=t=>t.split('\n').map(l=>l.trim()).filter(Boolean).slice(0,1000).map(l=>{const i=l.search(/[｜|]/);return i<0?{text:l.slice(0,300),by:''}:{text:l.slice(0,i).trim().slice(0,300),by:l.slice(i+1).trim().slice(0,80)}}).filter(q=>q.text);
  function subscribeQuotes(){
    db.doc('config/quotes').onSnapshot(snap=>{
      const v=snap.exists?snap.data():{};
      quoteList=Array.isArray(v.list)?v.list.filter(q=>q&&typeof q.text==='string').map(q=>({text:q.text,by:typeof q.by==='string'?q.by:''})):[];
      if(!$('#app').hidden)renderQuote();
      if(document.activeElement!==$('#quoteInput')){$('#quoteInput').value=quoteList.map(q=>q.by?`${q.text}｜${q.by}`:q.text).join('\n');$('#quoteNum').textContent=`${quoteList.length}件`}
    },()=>{});
  }
  $('#quoteInput').addEventListener('input',e=>{$('#quoteNum').textContent=`${parseQuotes(e.target.value).length}件`});
  $('#quoteForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const list=parseQuotes($('#quoteInput').value);
    try{await db.doc('config/quotes').set({list});toast(`名言を${list.length}件保存しました`)}
    catch(err){toast('保存できませんでした。名言の数を減らすか、通信状況を確認してください')}
  });

  // ---------- goal ----------
  const goal=()=>profile.milestones[profile.milestones.length-1];
  function renderGoal(){
    const g=goal(),card=$('#goalCard');
    card.style.backgroundImage=photo?`url("${photo}")`:'';
    $('#goalHint').hidden=!!photo;
    $('#goalTitle').textContent=g.t||'ゴールを設定しよう';
    $('#goalKicker').textContent=g.ym?`GOAL ・ ${dotDate(g.ym)}`:'GOAL';
    let left='';
    if(g.done)left='達成おめでとう！';
    else if(g.ym){const[y,m,d]=g.ym.split('-').map(Number);const days=Math.ceil(((d?new Date(y,m-1,d):new Date(y,m,0))-TODAY)/864e5);left=days>=0?`あと <b>${days}</b> 日`:'予定を過ぎています。見直してみよう'}
    $('#goalLeft').innerHTML=left;
  }
  let draftPhoto='',draftMs=[],readMs=()=>{};
  function openGoalEditor(){
    const g=goal();
    $('#gTitle').value=g.t;$('#gDateWrap').innerHTML=dateField('gDate',g.ym);
    draftPhoto=photo;showThumb();
    draftMs=clone(profile.milestones.slice(0,-1));readMs=mountMsEditor($('#msEdit'),'ms',draftMs);
    $('#goalEditor').hidden=false;$('#gTitle').focus();
  }
  function showThumb(){const t=$('#gThumb');t.style.backgroundImage=draftPhoto?`url("${draftPhoto}")`:'';t.textContent=draftPhoto?'':'なし'}
  $('#goalEditBtn').onclick=()=>$('#goalEditor').hidden?openGoalEditor():($('#goalEditor').hidden=true);
  $('#goalCancel').onclick=()=>{$('#goalEditor').hidden=true};
  $('#gPhotoClear').onclick=()=>{draftPhoto='';showThumb()};
  $('#gPhoto').addEventListener('change',async e=>{
    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
    try{const c=await cropPhoto(f);if(c){draftPhoto=c;showThumb()}}catch(err){toast('この写真は読み込めませんでした')}
  });
  // crop dialog: drag + zoom inside a 16:9 frame, then a JPEG small enough for one stored document
  function cropPhoto(file,square){
    return new Promise((resolve,reject)=>{
      const fr=new FileReader();fr.onerror=reject;
      fr.onload=()=>{const img=$('#cropImg');img.onerror=reject;img.onload=()=>start(img);img.src=fr.result};
      fr.readAsDataURL(file);
      function start(img){
        const box=$('#crop'),view=$('#cropView'),zoom=$('#cropZoom');
        box.hidden=false;zoom.value=1;
        view.style.aspectRatio=square?'1 / 1':'16 / 9';view.classList.toggle('round',!!square);
        $('#cropTitle').textContent=square?'プロフィール写真の範囲を選ぶ':'写真の範囲を選ぶ';
        const iw=img.naturalWidth,ih=img.naturalHeight;
        let VW,VH,base,scale,x,y;
        const clamp=()=>{x=Math.min(0,Math.max(VW-iw*scale,x));y=Math.min(0,Math.max(VH-ih*scale,y))};
        const paint=()=>{img.style.width=iw*scale+'px';img.style.height=ih*scale+'px';img.style.transform=`translate(${x}px,${y}px)`};
        const layout=()=>{const r=view.getBoundingClientRect();VW=r.width;VH=r.height;base=Math.max(VW/iw,VH/ih);scale=base*zoom.value;
          x=(VW-iw*scale)/2;y=(VH-ih*scale)/2;clamp();paint()};
        requestAnimationFrame(layout);
        let drag=null;
        view.onpointerdown=e=>{drag={px:e.clientX,py:e.clientY,x,y};view.setPointerCapture(e.pointerId)};
        view.onpointermove=e=>{if(!drag)return;x=drag.x+e.clientX-drag.px;y=drag.y+e.clientY-drag.py;clamp();paint()};
        view.onpointerup=view.onpointercancel=()=>{drag=null};
        zoom.oninput=()=>{const cx=(VW/2-x)/scale,cy=(VH/2-y)/scale;scale=base*zoom.value;x=VW/2-cx*scale;y=VH/2-cy*scale;clamp();paint()};
        const done=val=>{box.hidden=true;view.onpointerdown=view.onpointermove=view.onpointerup=view.onpointercancel=zoom.oninput=null;
          $('#cropOk').onclick=$('#cropCancel').onclick=null;img.removeAttribute('src');resolve(val)};
        $('#cropCancel').onclick=()=>done(null);
        $('#cropOk').onclick=()=>{
          const sx=-x/scale,sy=-y/scale,sw=VW/scale,sh=VH/scale;
          let w=square?320:1280,q=.8,out='';const limit=square?45000:230000;
          for(let i=0;i<6;i++){
            const c=document.createElement('canvas');c.width=w;c.height=square?w:Math.round(w*9/16);
            c.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);
            out=c.toDataURL('image/jpeg',q);
            if(out.length<limit)break;
            w=Math.round(w*.82);q=Math.max(.5,q-.06);
          }
          done(out);
        };
      }
    });
  }
  $('#goalEditor').addEventListener('submit',async e=>{
    e.preventDefault();
    const g=goal();
    g.t=$('#gTitle').value.trim()||g.t;g.ym=dateVal('gDate');
    readMs();profile.milestones=[...draftMs,g];selMs=null;
    const ok=await saveProfile();let phOk=true;
    if(draftPhoto!==photo){const prev=photo;photo=draftPhoto;if(!(phOk=await savePhoto()))photo=prev}
    $('#goalEditor').hidden=true;renderHome();if(ok&&phOk)toast('ゴールを保存しました');
  });

  // ---------- roadmap dial: hairline ring, points clockwise from 12 o'clock, goal last ----------
  const CX=210,CY=145,R=88;
  const ptAt=(i,n,r=R)=>{const a=(-90+i*360/n)*Math.PI/180;return[CX+r*Math.cos(a),CY+r*Math.sin(a),Math.cos(a),Math.sin(a)]};
  let selMs=null;
  function renderMap(){
    const ms=profile.milestones,n=ms.length,cur=ms.findIndex(m=>!m.done);
    if(selMs===null)selMs=cur<0?n-1:cur;
    const done=ms.filter(m=>m.done).length,pct=Math.round(done/n*100);
    const far=ms.reduce((a,m,i)=>m.done?i:a,-1);   // furthest finished point
    let s=`<circle class="ring" cx="${CX}" cy="${CY}" r="${R}"/>`;
    for(let k=0;k<60;k++){if(k%12===0)continue;const a=k*6*Math.PI/180,r1=R+6,r2=R+(k%3===0?10:8);
      s+=`<line class="tick" x1="${CX+r1*Math.sin(a)}" y1="${CY-r1*Math.cos(a)}" x2="${CX+r2*Math.sin(a)}" y2="${CY-r2*Math.cos(a)}"/>`}
    if(ms[n-1].done)s+=`<circle class="prog" cx="${CX}" cy="${CY}" r="${R}"/>`;
    else if(far>0){const[x,y]=ptAt(far,n),large=far*360/n>180?1:0;s+=`<path class="prog" d="M${CX} ${CY-R} A${R} ${R} 0 ${large} 1 ${x} ${y}"/>`}
    ms.forEach((m,i)=>{
      const[x,y,c,sn]=ptAt(i,n),[lx,ly]=ptAt(i,n,R+20),last=i===n-1;
      const anc=c>.3?'start':c<-.3?'end':'middle',dy=sn<-.5?-2:sn>.5?10:4;
      const name=m.t||(last?'ゴール':`地点${i+1}`);
      s+=`<g class="ms ${m.done?'done':''} ${i===selMs?'sel':''}" data-ms="${i}" tabindex="0" role="button" aria-label="${esc(name)}">
        <circle cx="${x}" cy="${y}" r="${n>12?9:14}" fill="transparent"/>
        <circle class="halo" cx="${x}" cy="${y}" r="11"/>
        ${last?`<rect class="pt" x="${x-6}" y="${y-6}" width="12" height="12" transform="rotate(45 ${x} ${y})"/>`:`<circle class="pt" cx="${x}" cy="${y}" r="5"/>`}
        ${false?`<text class="lbl ${m.t?'':'ph'}" x="${lx}" y="${ly+dy}" text-anchor="${anc}">${esc(name.length>8?name.slice(0,8)+'…':name)}</text>`:''}
      </g>`;
    });
    const g=goal();let left='';
    if(g.done)left='GOAL 達成';
    else if(g.ym){const[y,mo,d]=g.ym.split('-').map(Number);const days=Math.ceil(((d?new Date(y,mo-1,d):new Date(y,mo,0))-TODAY)/864e5);left=days>=0?`あと${days}日`:'予定日を過ぎています'}
    s+=`<text class="big" x="${CX}" y="${CY+14}" text-anchor="middle">${pct}</text>
      <text class="unit" x="${CX+2}" y="${CY+38}" text-anchor="middle">PERCENT</text>
      ${left?`<text class="left" x="${CX}" y="${CY+62}" text-anchor="middle">${left}</text>`:''}`;
    const mapEl=$('#map');if(mapEl)mapEl.innerHTML=s;
    if($('#mapProgress'))$('#mapProgress').textContent=`${ms.filter(m=>m.done).length} / ${ms.length}`;
    const m=ms[selMs];
    const tag=m.done?'達成済み':selMs===cur?'いまここ':'これから';
    $('#msDetail').innerHTML=`<div><b>${esc(m.t||'「ゴールを編集」から名前を入れよう')}</b><span>${m.ym?esc(dotDate(m.ym))+' ・ ':''}${tag}</span></div><button class="small-btn ${m.done?'on':''}" id="msToggle">${m.done?'✓ 達成':'達成にする'}</button>`;
    $('#msToggle').onclick=()=>{m.done=!m.done;saveProfile();if(m.done)toast(selMs===ms.length-1?'ゴール達成、おめでとう！':'地点を達成しました');renderMap();renderGoal()};
  }

  // ---------- calendar ----------
  let viewY=TODAY.getFullYear(),viewM=TODAY.getMonth();
  function calCells(y,m){
    const first=new Date(y,m,1).getDay(),last=new Date(y,m+1,0).getDate();
    let h=WD.map((w,i)=>`<div class="wd ${i===0?'sun':''}">${w}</div>`).join('');
    for(let i=0;i<first;i++)h+='<div></div>';
    for(let d=1;d<=last;d++){
      const dt=new Date(y,m,d),k=iso(dt),fut=dt>TODAY,on=isOn(k);
      h+=`<button class="${on?'on':''} ${k===todayKey?'today':''} ${fut?'future':''}" data-day="${k}" ${(k!==todayKey||on||checkSaving||loadFailed)?'disabled':''} aria-pressed="${on}" aria-label="${m+1}月${d}日">${d}${on?CHECK:''}</button>`;
    }
    return h;
  }
  function renderCheck(){
    const st=monthStats(viewY,viewM);
    $('#stRate').textContent=st.rate+'%';$('#stDays').textContent=st.on;$('#stStreak').textContent=streak();
    $('#calTitle').textContent=`${viewY}年${viewM+1}月`;
    $('#cal').innerHTML=calCells(viewY,viewM);
    $('#nextM').disabled=viewY===TODAY.getFullYear()&&viewM===TODAY.getMonth();
  }
  $('#cal').addEventListener('click',e=>{const b=e.target.closest('[data-day]');if(b&&!b.disabled)completeDay(b.dataset.day)});
  $('#prevM').onclick=()=>{viewM--;if(viewM<0){viewM=11;viewY--}renderCheck()};
  $('#nextM').onclick=()=>{viewM++;if(viewM>11){viewM=0;viewY++}renderCheck()};

  // ---------- reflection ----------
  const Q={
    week:[{k:'good',l:'今週の良かった事',ph:'例：説明会で準備した質問を2つとも聞けた'},
          {k:'improve',l:'今週の改善点',ph:'例：水曜に寝坊して朝の行動が崩れた'},
          {k:'resolve',l:'来週の決意',ph:'例：23時半には布団に入る'}],
    month:[{k:'good',l:'今月の良かった事',ph:'例：ゼミの企画を自分から提案して形にした'},
           {k:'improve',l:'今月の改善点',ph:'例：ESを後回しにして締切前に焦った'},
           {k:'resolve',l:'来月の決意',ph:'例：インターン先を決めて応募する'}]
  };
  let rfType='week',editKey={...curKey};
  function renderReflect(){
    document.querySelectorAll('[data-rf]').forEach(b=>b.setAttribute('aria-selected',b.dataset.rf===rfType));
    const isW=rfType==='week',key=editKey[rfType],isCur=key===curKey[rfType];
    const saved=findR(rfType,key);
    $('#rfTitle').textContent=isCur?(isW?'今週の振り返り':`${TODAY.getMonth()+1}月の振り返り`):(isW?'週の振り返りを編集':'月の振り返りを編集');
    $('#rfPeriod').innerHTML=`${esc(periodLabel(rfType,key))}${isCur?(isW?'・日曜までに記入':'・月末までに記入'):''} ・ <span class="status ${saved?'done':'todo'}">${saved?'記入済み':'未記入'}</span>`;

    $('#rfSummary').hidden=!isW;
    if(isW){
      const mon=parseIso(key);let on=0,past=0,strip='';
      for(let i=0;i<7;i++){const d=addDays(mon,i),k=iso(d),fut=d>TODAY;if(!fut){past++;if(isOn(k))on++}
        strip+=`<div><span>${WD[d.getDay()]}</span><i class="${isOn(k)?'on':''} ${fut?'fut':''}">${d.getDate()}</i></div>`}
      $('#rfSummary').innerHTML=`<div class="card-head"><b style="font-size:15px">この週の行動チェック</b><span class="mono">${on} / ${past} 日</span></div><div class="strip">${strip}</div>`;
    }

    const v=saved||{};
    $('#rfForm').innerHTML=Q[rfType].map((q,i)=>`<div class="q"><label for="rf-${q.k}"><span class="n">${i+1}</span>${q.l}</label><textarea id="rf-${q.k}" rows="3" placeholder="${q.ph}">${esc(v[q.k]||'')}</textarea></div>`).join('')
      +`<button class="primary" type="submit">${saved?'振り返りを更新する':'振り返りを保存する'}</button>`
      +(isCur?'':`<button class="ghost" type="button" id="rfBackCur">${isW?'今週':'今月'}の振り返りに戻る</button>`);
    const back=$('#rfBackCur');if(back)back.onclick=()=>{editKey[rfType]=curKey[rfType];renderReflect()};
    renderBox();
  }
  document.querySelectorAll('[data-rf]').forEach(b=>b.onclick=()=>{rfType=b.dataset.rf;renderReflect()});
  $('#rfForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const key=editKey[rfType];
    const r={id:`${rfType}-${key}`,type:rfType,key,savedAt:new Date().toISOString()};let filled=0;
    Q[rfType].forEach(q=>{r[q.k]=$('#rf-'+q.k).value.trim();if(r[q.k])filled++});
    if(!filled){toast('ひとつ以上書くと保存できます');return}
    const i=reflections.findIndex(x=>x.id===r.id);
    if(i<0)reflections.push(r);else reflections[i]=r;
    if(await saveReflection(r))toast('過去の成長に保存しました');
    renderReflect();renderHome();
  });

  // ---------- reflection box ----------
  const boxFilter='week';
  function renderBox(){
    const w=reflections.filter(r=>r.type==='week').length,m=reflections.filter(r=>r.type==='month').length;
    $('#boxCount').textContent=`${w}件`;
    document.querySelectorAll('#boxChips button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.f===boxFilter));
    const list=reflections.filter(r=>boxFilter==='all'||r.type===boxFilter).sort((a,b)=>sortKey(b).localeCompare(sortKey(a))||(a.type==='month'?-1:1));
    if(!list.length){
      $('#boxList').innerHTML=`<div class="empty"><svg class="i" viewBox="0 0 24 24"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1zM10 12h4"/></svg><b style="color:var(--ink)">まだ振り返りがありません</b>上のフォームで保存すると、ここにたまっていきます。</div>`;
      return;
    }
    $('#boxList').innerHTML=list.map(r=>`<button type="button" class="past-row" data-open="${esc(r.id)}"><span><b class="pd">${esc(periodLabel(r.type,r.key))}</b><small>${esc(r.resolve||r.good||r.improve)}</small></span><svg class="i chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>`).join('');
  }
  // tapping a week opens it as its own page, like a profile
  let rfOpenId='';
  $('#boxList').addEventListener('click',e=>{const b=e.target.closest('[data-open]');if(!b)return;rfOpenId=b.dataset.open;go('rfview')});
  function renderRfView(){
    const r=reflections.find(x=>x.id===rfOpenId);
    if(!r){$('#rfvTitle').textContent='振り返りが見つかりません';$('#rfvSecs').innerHTML='';$('#rfvWeek').innerHTML='';$('#rfvCount').textContent='';return}
    const s0=parseIso(r.key),s6=addDays(s0,6);
    $('#rfvTitle').textContent=`${md(s0)}（月）〜 ${md(s6)}（日）`;
    {const t=new Date(Date.UTC(s0.getFullYear(),s0.getMonth(),s0.getDate()+3)),y=t.getUTCFullYear(),w=Math.ceil(((t-Date.UTC(y,0,1))/864e5+1)/7);$('#rfvWeekNo').textContent=`${y}年 第${w}週`}
    const av=$('#rfvAvatar');av.style.backgroundColor=uid?colorOf(uid):'var(--accent)';paintAvatar(av,profile.avatar,profile.nick);$('#rfvName').textContent=profile.nick||'わたし';
    let on=0;const mon=parseIso(r.key);
    $('#rfvWeek').innerHTML=[0,1,2,3,4,5,6].map(i=>{const d=addDays(mon,i),k=iso(d),c=isOn(k);if(c)on++;return`<i class="${c?'on':''}" title="${WD[d.getDay()]}">${d.getDate()}</i>`}).join('');
    $('#rfvCount').textContent=`${on}/7`;
    const box=$('#rfvSecs');box.innerHTML='';
    Q[r.type].forEach(q=>{const c=document.createElement('div');c.className='card rfv-sec';c.innerHTML='<span class="lab2"></span><p></p>';
      c.querySelector('.lab2').textContent=q.l;c.querySelector('p').textContent=r[q.k]||'—';box.append(c)});
  }
  $('#rfvEdit').onclick=()=>{const r=reflections.find(x=>x.id===rfOpenId);if(!r)return;rfType=r.type;editKey[r.type]=r.key;go('reflect')};

  // ---------- avatar ----------
  const safeImg=v=>typeof v==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(v)?v:'';
  function paintAvatar(el,src,name){
    const ok=safeImg(src);
    el.style.backgroundImage=ok?`url("${ok}")`:'';
    el.textContent=ok?'':(name||'志').slice(0,1);
  }

  // ---------- account ----------
  let draftAvatar='';
  function fillForm(){
    $('#fNick').value=profile.nick||'';$('#fAff').value=profile.aff||'';
    draftAvatar=profile.avatar||'';paintAvatar($('#fAvatar'),draftAvatar,profile.nick);
    $('#fShi').value=profile.shi;$('#fGoal').value=goal().t||'';$('#fShare').checked=profile.share!==false;
    renderAccount();
  }
  function renderAccount(){
    $('#accName').textContent=profile.nick?profile.nick:'わたしのページ';
    $('#accAff').textContent=profile.aff||'';
    paintAvatar($('#accAvatar'),profile.avatar,profile.nick);
  }
  $('#ikForm').addEventListener('submit',e=>{
    e.preventDefault();
    const nick=$('#fNick').value.trim(),shi=$('#fShi').value.trim();
    if(!nick){toast('名前を入れてください');return}
    if(shi&&[...shi].length!==2&&[...shi].length!==4){toast('志言は二字か四字の熟語で入れてください');return}
    profile.nick=nick;profile.aff=$('#fAff').value.trim();profile.avatar=draftAvatar;goal().t=$('#fGoal').value.trim();
    if(shi&&shi!==profile.shi){profile.shi=shi;profile.shiSince=todayKey}
    renderHome();renderAccount();
    saveProfile().then(ok=>{if(ok)toast('プロフィールを保存しました')});
  });
  $('#fPhoto').addEventListener('change',async e=>{
    const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
    try{const c=await cropPhoto(f,true);if(c){draftAvatar=c;paintAvatar($('#fAvatar'),c,$('#fNick').value)}}catch(err){toast('この写真は読み込めませんでした')}
  });
  $('#fPhotoClear').onclick=()=>{draftAvatar='';paintAvatar($('#fAvatar'),'',$('#fNick').value)};

  // ---------- first-run registration: membership questions ----------
  // answers go to applications/<uid>: the member writes their own, only the owner can read them all
  const OB_STEPS=4;
  let obStep=0,ob={};
  const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function openOnboard(){
    ob={name:profile.nick||'',avatar:profile.avatar||'',referrer:'',email:window.appAuth?window.appAuth.email():'',age:'',job:profile.aff||'',sns:'',reason:'',shi:profile.shi||'',goal:goal().t||''};
    obStep=0;
    $('#app').hidden=true;$('#onboard').hidden=false;
    renderOnboard();
  }
  function readOnboard(){
    const v=id=>{const el=document.getElementById(id);return el?el.value.trim():''};
    if(obStep===0){ob.name=v('obName');ob.referrer=v('obRef');ob.email=v('obEmail');ob.age=v('obAge')}
    if(obStep===1){ob.job=v('obJob');ob.sns=v('obSns');ob.reason=v('obReason')}
    if(obStep===2){ob.shi=v('obShi');ob.goal=v('obGoal')}
  }
  function renderOnboard(){
    document.querySelectorAll('#obBar span').forEach((s,i)=>s.classList.toggle('on',i<=obStep));
    const head=(t,sub)=>`<div><div class="ob-step">STEP ${obStep+1} / ${OB_STEPS}</div><h1 class="ob-title">${t}</h1><p class="muted">${sub}</p></div>`;
    const req='<span class="req">必須</span>',opt='<span class="muted" style="font-size:11px;margin-left:4px">任意</span>';
    let body='';
    if(obStep===0)body=head('入会のご案内','はじめに、あなたのことを教えてください。お名前はメンバーにも表示されます。')
      +`<div class="field"><label for="obName">お名前${req}</label><input type="text" id="obName" maxlength="30" value="${esc(ob.name)}" placeholder="例：山田 太郎" autocomplete="name"></div>
        <div class="field"><label for="obRef">紹介者の名前${req}</label><input type="text" id="obRef" maxlength="30" value="${esc(ob.referrer)}" placeholder="例：佐藤 花子"></div>
        <div class="field"><label for="obEmail">メールアドレス${req}</label><input type="text" id="obEmail" inputmode="email" maxlength="120" value="${esc(ob.email)}" placeholder="name@example.com" autocomplete="email"></div>
        <div class="field"><label for="obAge">ご年齢${req}</label><input type="text" id="obAge" inputmode="numeric" maxlength="3" value="${esc(ob.age)}" placeholder="例：28"></div>`;
    if(obStep===1)body=head('入会について','お仕事と、入会を希望する理由を教えてください。')
      +`<div class="field"><label for="obJob">お仕事${req}</label><input type="text" id="obJob" maxlength="40" value="${esc(ob.job)}" placeholder="例：会社員、大学生、パーソナルトレーナー"></div>
        <div class="field"><label for="obSns">SNSアカウントURL${opt}</label><input type="text" id="obSns" inputmode="url" maxlength="200" value="${esc(ob.sns)}" placeholder="https://www.instagram.com/..."></div>
        <div class="field"><label for="obReason">入会希望の理由${req}</label><textarea id="obReason" rows="5" maxlength="800" placeholder="例：同じ志を持つ仲間と、朝の習慣を続けたいからです">${esc(ob.reason)}</textarea></div>
        <p class="muted" style="font-size:12px">メールアドレス・ご年齢・紹介者・入会理由は運営だけが確認し、ほかのメンバーには表示されません。</p>`;
    if(obStep===2)body=head('志言の設定','あなたの志を、二字熟語か四字熟語で表しましょう。短い言葉ほど、毎朝思い出しやすくなります。ホームのいちばん上に表示され、あとから変更もできます。')
      +`<div class="field"><label for="obShi">志言（二字熟語・四字熟語）${req}</label><input type="text" id="obShi" maxlength="4" value="${esc(ob.shi)}" placeholder="例：挑戦　／　一意専心" autocomplete="off"></div>
        <div class="field" style="margin-top:8px"><label for="obGoal">ワクワクする最終目標の設定${req}</label><span class="muted" style="font-size:12px">自分が本当に達成したい最終目標を、なるべく簡潔に書きましょう。</span><input type="text" id="obGoal" maxlength="40" value="${esc(ob.goal)}" placeholder="例：自分の店を持つ"></div>`;
    if(obStep===3)body=head('アイコンの写真','最後に、トークや成長ログで表示されるアイコンの写真を登録しましょう。あとから変更もできます。')
      +`<div class="ob-photo"><div class="avatar big" id="obAvatar"></div>
          <label class="file-btn">写真を選ぶ<input type="file" id="obAvatarFile" accept="image/*"></label>
          <button type="button" class="small-btn" id="obAvatarClear">写真を外す</button>
          <p class="muted" style="font-size:12px;text-align:center">写真は丸く切り取って表示されます。登録しない場合は、お名前の頭文字のアイコンになります。</p></div>`;
    body+=`<div class="btn-row">${obStep>0?'<button type="button" class="ghost" id="obBack">戻る</button>':''}<button type="submit" class="primary">${obStep===OB_STEPS-1?'登録してはじめる':'次へ'}</button></div>`;
    $('#obForm').innerHTML=body;
    if(obStep===3){
      const pa=()=>paintAvatar($('#obAvatar'),ob.avatar,ob.name);pa();
      $('#obAvatarFile').onchange=async e=>{const f=e.target.files&&e.target.files[0];e.target.value='';if(!f)return;
        try{const c=await cropPhoto(f,true);if(c){ob.avatar=c;pa()}}catch(err){toast('この写真は読み込めませんでした')}};
      $('#obAvatarClear').onclick=()=>{ob.avatar='';pa()};
    }
    const back=$('#obBack');if(back)back.onclick=()=>{readOnboard();obStep--;renderOnboard()};
    const first=$('#obForm input[type=text],#obForm textarea');if(first)first.focus();
    window.scrollTo(0,0);
  }
  $('#obForm').addEventListener('submit',async e=>{
    e.preventDefault();readOnboard();
    if(obStep===0){
      if(!ob.name){toast('お名前を入れてください');return}
      if(!ob.referrer){toast('紹介者の名前を入れてください');return}
      if(!EMAIL_RE.test(ob.email)){toast('メールアドレスの形を確認してください');return}
      const n=Number(ob.age);if(!/^\d{1,3}$/.test(ob.age)||n<10||n>110){toast('ご年齢は数字で入れてください');return}
    }
    if(obStep===1){
      if(!ob.job){toast('お仕事を入れてください');return}
      if(ob.sns&&!/^https?:\/\/[^\s<>"]+$/i.test(ob.sns)){toast('SNSのURLは https:// から始まる形で入れてください');return}
      if(!ob.reason){toast('入会希望の理由を書いてください');return}
    }
    if(obStep===2){
      if(!ob.shi){toast('志言を入れてください');return}
      if(![...ob.shi].length||(([...ob.shi].length)!==2&&[...ob.shi].length!==4)){toast('志言は二字か四字の熟語で入れてください');return}
      if(!ob.goal){toast('ワクワクする最終目標を書いてください');return}
    }
    if(obStep<OB_STEPS-1){obStep++;renderOnboard();return}
    profile.nick=ob.name;profile.aff=ob.job;profile.avatar=ob.avatar;profile.registered=true;
    if(ob.shi!==profile.shi){profile.shi=ob.shi;profile.shiSince=todayKey}
    goal().t=ob.goal;
    saveProfile();
    if(backend==='cloud'&&uid){
      try{await db.doc('applications/'+uid).set({name:ob.name,referrer:ob.referrer,email:ob.email,age:Number(ob.age),job:ob.job,sns:ob.sns,reason:ob.reason,at:new Date().toISOString()})}
      catch(err){toast('入会情報を送れませんでした。あとで運営に連絡してください')}
    }
    showApp();go('home');toast(`ようこそ、${profile.nick}`);
  });

  // Administrator-only account screen. No roster data is kept in browser storage.
  let adminRows=[],adminLoadToken=0,adminLoaded=false;
  function setOwnerView(owner){
    isOwnerView=!!owner;
    if(!isOwnerView&&inquiryUi)inquiryUi.clearAdmin();
    $('#adminEntry').hidden=!isOwnerView;$('#appCard').hidden=!isOwnerView;
    if(!isOwnerView){
      ++channelSettingsToken;channelSettingsLoaded=false;channelSettingsRevision='';if($('#youtubeChannelInput')){$('#youtubeChannelInput').value='';$('#youtubeChannelInput').disabled=true;$('#youtubeRegisteredChannels').replaceChildren();$('#youtubeChannelCount').textContent='';$('#youtubeChannelsDetails').open=false;}
      ++adminLoadToken;adminRows=[];adminLoaded=false;$('#adminRoster').replaceChildren();$('#appList').replaceChildren();
      $('#adminSummary').textContent='';$('#adminCheckDay').textContent='';$('#adminUpdated').textContent='';
      if(!$('#accAdmin').hidden)showAcc('menu');
    }
    renderZoom();
  }
  function renderAdminRoster(){
    if(!isOwnerView||$('#accAdmin').hidden||!adminLoaded)return;
    const box=$('#adminRoster'),query=$('#adminSearch').value.trim().toLocaleLowerCase('ja-JP'),filter=$('#adminFilter').value;
    const done=adminRows.filter(r=>r.checked_today===true).length,unknown=adminRows.filter(r=>r.checked_today!==true&&r.checked_today!==false).length;
    $('#adminSummary').textContent=`在籍 ${adminRows.length}人 ／ チェック済み ${done}人 ／ 未チェック ${adminRows.length-done-unknown}人 ／ 未取得 ${unknown}人`;
    const rows=adminRows.filter(r=>(!query||String(r.display_name||'').toLocaleLowerCase('ja-JP').includes(query))&&(filter==='all'||(filter==='done'&&r.checked_today===true)||(filter==='pending'&&r.checked_today===false)||(filter==='unknown'&&r.checked_today!==true&&r.checked_today!==false)));
    box.replaceChildren();
    if(!rows.length){const p=document.createElement('p');p.className='muted admin-note';p.textContent=adminRows.length?'条件に合うメンバーはいません。':'在籍メンバーはまだいません。';box.append(p);return}
    rows.forEach(r=>{
      const row=document.createElement('article');row.className='admin-member';
      const name=String(r.display_name||'名前未設定'),av=document.createElement('div');av.className='avatar';av.style.backgroundColor=colorOf(String(r.user_id));av.setAttribute('role','img');av.setAttribute('aria-label',name+'のプロフィール');paintAvatar(av,r.avatar,name);
      const person=document.createElement('div');person.className='admin-person';const title=document.createElement('b');title.textContent=name;const role=document.createElement('small');role.textContent=r.is_admin?'管理者':'メンバー';if(r.user_id===uid)role.textContent+=' ・ あなた';person.append(title,role);
      const state=document.createElement('span');state.className='admin-check'+(r.checked_today===true?' done':'');state.textContent=r.checked_today===true?'✓ チェック済み':r.checked_today===false?'未チェック':'未取得';
      if(r.checked_today!==true&&r.checked_today!==false)state.title='行動チェックの記録をまだ取得できていません。未チェックの人数には含めません。';
      row.append(av,person,state);box.append(row);
    });
  }
  async function loadAdminMembers(){
    if(!isOwnerView||$('#accAdmin').hidden||!userNs)return;
    const token=++adminLoadToken,active=()=>token===adminLoadToken&&!$('#accAdmin').hidden&&isOwnerView;
    $('#adminRefresh').disabled=true;adminRows=[];adminLoaded=false;$('#adminRoster').replaceChildren();$('#adminSummary').textContent='読み込んでいます…';$('#adminCheckDay').textContent='';$('#adminUpdated').textContent='';
    try{
      if(!await userNs.isOwner()){if(active())setOwnerView(false);return}
      if(!active())return;
      if(!userNs.adminMembers)throw {code:'PGRST202'};
      const rows=await userNs.adminMembers.list();if(!active())return;
      if(!Array.isArray(rows))throw Error('Invalid roster');
      adminRows=rows.filter(r=>r&&typeof r.user_id==='string').sort((a,b)=>String(a.display_name||'').localeCompare(String(b.display_name||''),'ja'));
      const days=[...new Set(adminRows.map(r=>r.check_day).filter(Boolean))];
      if(days.length>1)throw Error('Mismatched check dates');
      $('#adminCheckDay').textContent=days.length?String(days[0]).replace(/-/g,'/')+' の行動チェック（日本時間）':'今日の行動チェック（日本時間）';
      adminLoaded=true;renderAdminRoster();$('#adminUpdated').textContent='最終取得：'+postTimeText(new Date().toISOString());
    }catch(err){
      if(!active())return;
      adminRows=[];adminLoaded=false;$('#adminRoster').replaceChildren();
      if(err&&err.code==='42501'){setOwnerView(false);return}
      $('#adminSummary').textContent=err&&['PGRST202','42883'].includes(err.code)?'管理者一覧の準備がまだ完了していません。':'一覧を取得できませんでした。「更新」で再試行してください。';
    }finally{if(token===adminLoadToken)$('#adminRefresh').disabled=false}
  }
  $('#adminRefresh').onclick=()=>{loadAdminMembers();renderApplicants()};
  $('#adminSearch').addEventListener('input',renderAdminRoster);$('#adminFilter').addEventListener('change',renderAdminRoster);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!$('#accAdmin').hidden)loadAdminMembers()});

  // owner-only list of membership answers
  // Hosts remove only explicitly declined applications. Pending and approved records stay.
  // Access is still decided by the host-only approval list; Auth and personal records are untouched.
  let appArmed='';
  async function renderApplicants(){
    const box=$('#appList');if(!box||$('#appCard').hidden||$('#accAdmin').hidden||!isOwnerView||!db)return;
    try{
      const snap=await db.collection('applications').get();
      const ap=userNs&&userNs.approvals;
      const okIds=ap?new Set((await ap.list()).map(x=>x.user_id)):null;
      if(!isOwnerView||$('#accAdmin').hidden)return;
      let rows=snap.docs.map(d=>{const v=d.data();return v?{...v,_id:d.id}:null}).filter(Boolean).sort((p,q)=>String(q.at||'').localeCompare(String(p.at||'')));
      if(okIds&&ap.removeDeclined){
        const removed=new Set();let failed=false;
        for(const r of rows.filter(r=>r.status==='declined'&&!okIds.has(r._id))){
          try{if(await ap.removeDeclined(r._id))removed.add(r._id)}catch(err){failed=true}
        }
        rows=rows.filter(r=>!removed.has(r._id));
        if(failed)toast('見送った申込の削除を再試行してください');
      }
      if(!isOwnerView||$('#accAdmin').hidden)return;
      $('#appCount').textContent=`${rows.length}件`;
      if(!rows.length){box.innerHTML='<p class="muted">まだ申込はありません。</p>';return}
      box.innerHTML='';
      rows.forEach(r=>{
        const d=document.createElement('details');d.className='past';
        d.innerHTML='<summary><span class="lbl"><b></b><small></small></span><svg class="i chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></summary><dl></dl>';
        d.querySelector('b').textContent=String(r.name||'（名前なし）');
        const st=okIds?(okIds.has(r._id)?'承認済み':r.status==='declined'?'見送り':'承認待ち'):'';
        d.querySelector('small').textContent=[st,r.age?r.age+'歳':'',r.job,r.at?String(r.at).slice(0,10).replace(/-/g,'.'):''].filter(Boolean).join(' ・ ');
        const dl=d.querySelector('dl');
        [['紹介者',r.referrer],['メールアドレス',r.email],['ご年齢',r.age?r.age+'歳':''],['お仕事',r.job],['SNS',r.sns],['入会希望の理由',r.reason]].forEach(([k,v])=>{
          const w=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;
          if(k==='SNS'&&/^https?:\/\/[^\s<>"]+$/i.test(String(v||''))){const a=document.createElement('a');a.href=v;a.target='_blank';a.rel='noopener noreferrer';a.textContent=v;a.style.color='var(--accent)';dd.append(a)}
          else dd.textContent=String(v||'—');
          w.append(dt,dd);dl.append(w)});
        if(okIds){
          const row=document.createElement('div');row.className='btn-row';row.style.marginTop='10px';
          const mk=(label,act,warn)=>{const b=document.createElement('button');b.type='button';b.className='small-btn'+(warn?' warn':'');b.textContent=label;b.dataset.appAct=act;b.dataset.appId=r._id;row.append(b)};
          if(okIds.has(r._id))mk('承認を取り消す','revoke',true);
          else{mk('承認する','approve');mk(r.status==='declined'?'申込記録を削除':'見送る','decline',true)}
          d.append(row);
        }
        box.append(d);
      });
    }catch(err){box.innerHTML='<p class="muted">一覧を読み込めませんでした。</p>'}
  }
  $('#appList').addEventListener('click',async e=>{
    const b=e.target.closest('[data-app-act]');if(!b||!isOwnerView||$('#accAdmin').hidden||!userNs||!userNs.approvals)return;
    const act=b.dataset.appAct,id=b.dataset.appId,key=act+':'+id;
    if(act!=='approve'&&appArmed!==key){appArmed=key;b.textContent='もう一度押して確定';setTimeout(()=>{if(appArmed===key){appArmed='';renderApplicants()}},3000);return}
    appArmed='';b.disabled=true;
    try{
      if(act==='approve'){await userNs.approvals.approve(id);toast('承認しました')}
      else if(act==='revoke'){await userNs.approvals.revoke(id);toast('承認を取り消しました')}
      else{
        const ref=db.doc('applications/'+id),cur=await ref.get();
        if(!cur.exists){renderApplicants();return}
        if((await userNs.approvals.list()).some(x=>x.user_id===id)){toast('承認済みの申込は削除できません');renderApplicants();return}
        await ref.set({...cur.data(),status:'declined',declinedAt:new Date().toISOString()});
        if(!userNs.approvals.removeDeclined||!await userNs.approvals.removeDeclined(id))throw Error('application not removed');
        toast('見送りにして申込記録を削除しました');
      }
    }catch(err){toast('変更できませんでした。通信状況を確認してください')}
    renderApplicants();loadAdminMembers();
  });
  function showApp(){
    $('#onboard').hidden=true;$('#app').hidden=false;renderQuote();renderZoom();
    renderAll();fillForm();size();
  }
  // Brief opening curtain: leaves after 0.3s once data is ready; a tap skips it
  const curtain=(()=>{
    const sp=$('#splash');let minDone=false,ready=false,gone=false;
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const leave=cls=>{if(gone)return;gone=true;if(reduce)sp.hidden=true;else sp.classList.add(cls)};
    sp.addEventListener('animationend',e=>{if(e.animationName==='spOut')sp.hidden=true});
    sp.addEventListener('click',()=>{if(ready)leave('skip');else minDone=true});
    setTimeout(()=>{minDone=true;if(ready)leave('out')},reduce?0:300);
    return{ready(){ready=true;if(minDone)leave('out')}};
  })();
  function boot(){curtain.ready();proceed()}
  function proceed(){
    if(loadFailed)return showLoadError();
    if(offerLocal)return openMigrate();
    let out=false;try{out=localStorage.getItem(LOGOUT_KEY)==='1'}catch(e){}
    if(out)return showEnd('ログアウトしています','もう一度使うときは、ログインしてください。','ログインする');
    if(!profile.registered&&!profile.shi)return openOnboard();
    if(!profile.registered){profile.registered=true;saveProfile()}   // set up before registration existed
    showApp();
  }
  $('#fShare').addEventListener('change',e=>{profile.share=e.target.checked;saveProfile();toast(profile.share?'仲間ページに表示します':'仲間ページから外しました')});
  // logout: the identity comes from the signed-in account, so this ends the session in this app on this device
  const LOGOUT_KEY='ikigai.loggedOut';
  function showEnd(title,text,btn){
    if(shinAi)shinAi.reset();
    if(youtubeRecommendations)youtubeRecommendations.stop();
    if(inquiryUi)inquiryUi.stop();
    $('#app').hidden=true;$('#onboard').hidden=true;$('#endScreen').hidden=false;
    $('#endTitle').textContent=title;$('#endText').textContent=text;$('#endBtn').textContent=btn;window.scrollTo(0,0);
  }
  $('#logoutBtn').onclick=()=>{
    if(window.appAuth){window.appAuth.signOut();return}   // real sign-out; main.js reloads to the login screen
    try{localStorage.setItem(LOGOUT_KEY,'1')}catch(e){}showEnd('ログアウトしました','またいつでも戻ってきてください。','ログインする')};
  $('#endBtn').onclick=()=>{try{localStorage.removeItem(LOGOUT_KEY)}catch(e){}location.reload()};

  // signed in, but the account's records could not be read: nothing can be written until they load
  function showLoadError(){
    $('#app').hidden=true;$('#onboard').hidden=true;$('#loadErr').hidden=false;window.scrollTo(0,0);
  }
  $('#loadRetry').onclick=()=>location.reload();
  $('#loadLogout').onclick=()=>{if(window.appAuth)window.appAuth.signOut()};

  // a new account on a browser that still holds records from before login: only the person decides
  let migArmed=false;
  function openMigrate(){
    const o=offerLocal,cut=s=>{const a=[...String(s||'')];return esc(a.length>20?a.slice(0,20).join('')+'…':a.join(''))};
    const g=o.p&&Array.isArray(o.p.milestones)?o.p.milestones[o.p.milestones.length-1]:null;
    const items=[];
    if(o.p&&o.p.nick)items.push(`名前：「${cut(o.p.nick)}」`);
    if(o.p&&o.p.shi)items.push(`志言：「${cut(o.p.shi)}」`);
    if(g&&g.t)items.push(`最終目標：「${cut(g.t)}」`);
    items.push(`振り返り：${o.r.length}件`,`目標の写真：${o.ph?'あり':'なし'}`);
    $('#migList').innerHTML=items.map(t=>`<li>${t}</li>`).join('');
    $('#migErr').textContent='';migArmed=false;$('#migDelete').textContent='この端末から消す';
    $('#app').hidden=true;$('#onboard').hidden=true;$('#migrate').hidden=false;window.scrollTo(0,0);
  }
  const migBtns=()=>['#migMove','#migSkip','#migDelete'].map(s=>$(s));
  const leaveMigrate=()=>{offerLocal=null;$('#migrate').hidden=true;proceed()};
  $('#migMove').onclick=async()=>{
    const o=offerLocal;if(!o)return;
    migBtns().forEach(b=>b.disabled=true);$('#migErr').textContent='';
    const next=Object.assign(defaultProfile(),o.p||{});
    try{
      // the profile goes last: until it exists, this offer comes back if anything failed halfway
      for(const r of o.r)await rCol().doc(r.id).set(clone(r));
      if(o.ph)await phRef().set({src:o.ph});
      await pRef().set(clone(next));
    }catch(e){
      $('#migErr').textContent='移せませんでした。通信の状況を確かめて、もう一度押してください（この端末の記録は消していません）。';
      migBtns().forEach(b=>b.disabled=false);return;
    }
    profile=next;photo=o.ph;reflections=o.r.map(clone);
    clearLocal();migBtns().forEach(b=>b.disabled=false);
    renderAll();fillForm();syncMember();toast('この端末の記録を、アカウントに移しました');leaveMigrate();
  };
  $('#migSkip').onclick=()=>leaveMigrate();
  $('#migDelete').onclick=()=>{
    if(!migArmed){
      migArmed=true;$('#migDelete').textContent='本当に消す（元に戻せません）';
      $('#migErr').textContent='もう一度押すと、この端末に残っている記録を消します。アカウントの記録には影響しません。';return;
    }
    clearLocal();toast('この端末の記録を消しました');leaveMigrate();
  };
  // account deletion: removes every document this person owns
  $('#delOpen').onclick=()=>{$('#delBox').hidden=false;$('#delConfirm').value='';$('#delConfirm').focus()};
  $('#delCancel').onclick=()=>{$('#delBox').hidden=true};
  $('#delGo').onclick=async()=>{
    if($('#delConfirm').value.trim()!=='削除'){toast('「削除」と入力してください');return}
    const btn=$('#delGo');btn.disabled=true;btn.textContent='削除しています…';
    let failed=false;
    if(backend==='cloud'&&uid){
      const refs=[pRef(),phRef(),db.doc('members/'+uid),db.doc('chats/'+uid),db.doc('posts/'+uid),db.doc('applications/'+uid),...reflections.map(r=>rCol().doc(r.id))];
      profile=defaultProfile();profile.share=false;   // stop the member sync from re-creating the card
      for(const r of refs){try{await r.delete()}catch(e){failed=true}}
    }
    [LK.p,LK.r,LK.ph].forEach(k=>local.del(k));
    profile=defaultProfile();photo='';reflections=[];myMsgs=[];myPosts=[];myLikes=[];myCmts=[];
    btn.disabled=false;btn.textContent='アカウントを削除する';$('#delBox').hidden=true;
    if(window.appAuth&&!failed){
      const r=await window.appAuth.deleteAccount();
      if(!r.ok&&r.code==='needs-server'){
        showEnd('記録を削除しました','あなたの志・振り返り・投稿などの記録はすべて削除しました。ログイン情報（メールアドレス）の削除は、まだアプリからはできません。完全な削除を希望する場合は、運営にご連絡ください。','ログアウトする');
        $('#endBtn').onclick=()=>window.appAuth.signOut();
        return;
      }
      if(!r.ok){
        showEnd('ログイン情報だけ残っています',r.code==='auth/requires-recent-login'?'記録はすべて削除しました。ログイン情報も消すには、一度ログインし直してから、もう一度「アカウントを削除」を押してください。':'記録はすべて削除しました。ログイン情報の削除は、時間をおいてもう一度お試しください。','ログイン画面へ');
        $('#endBtn').onclick=()=>window.appAuth.signOut();
        return;
      }
    }
    showEnd(failed?'一部のデータを削除できませんでした':'アカウントを削除しました',failed?'通信状況を確認して、もう一度お試しください。':'ご利用ありがとうございました。','最初から登録する');
  };
  const talkToggle=$('#talkAboutToggle'),talkAbout=$('#talkAboutText');
  if(talkToggle&&talkAbout)talkToggle.onclick=()=>{const expanded=talkToggle.getAttribute('aria-expanded')!=='true';talkToggle.setAttribute('aria-expanded',String(expanded));talkToggle.textContent=expanded?'−':'＋';talkToggle.setAttribute('aria-label',expanded?'GIVE BUDDIESの説明を閉じる':'GIVE BUDDIESの説明を開く');talkAbout.hidden=!expanded};
  let youtubeRecommendations=null,youtubeLoading=false;
  async function openYoutube(){
    if(youtubeLoading)return;
    if(!youtubeRecommendations){
      youtubeLoading=true;
      try{const module=await import('./youtube-recommendations.js');youtubeRecommendations=module.mountYoutubeRecommendations({
        allowed:()=>backend==='cloud'&&!!uid&&!pending(),
        request:(cursor,options)=>{if(!window.appAuth?.youtubeRecommendations)throw Error('おすすめ動画の接続準備中です。');return window.appAuth.youtubeRecommendations(cursor,options)}
      })}catch(_){const status=$('#youtubeStatus');if(status)status.textContent='動画画面を開けませんでした。再読み込みしてください。';else toast('新しい動画画面を表示するには再読み込みしてください。');return}
      finally{youtubeLoading=false}
    }
    if(!$('#v-soon').hidden)youtubeRecommendations.open();
  }
  let shinAi=null,shinAiLoading=false;
  $('#aiBtn').onclick=async()=>{
    if(backend!=='cloud'||!uid){toast('ログインするとSHIN AIを使えます');return}
    if(pending()){toast('管理者の承認後にSHIN AIを使えます');return}
    if(shinAiLoading)return;
    if(!shinAi){
      shinAiLoading=true;
      try{
        const module=await import('./shin-ai.js');
        shinAi=module.mountShinAI({
          request:(payload,options)=>{if(!window.appAuth?.shinAi)throw Error('SHIN AIの接続準備中です。');return window.appAuth.shinAi(payload,options)},
          getContext:({goal:useGoal,logs:useLogs})=>{
            const parts=[];
            if(useGoal){parts.push('自分の志：'+String(profile.shi||'未設定'));const last=profile.milestones?.at(-1);if(last?.t)parts.push('自分の最終目標：'+last.t)}
            if(useLogs)myPosts.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,3).forEach(x=>parts.push('自分の成長ログ（'+postTimeText(x.at)+'）：'+String(x.text||'')));
            return parts.join('\n').slice(0,4000);
          }
        });
      }catch(_){toast('SHIN AIを開けませんでした。再読み込みしてください。');return}
      finally{shinAiLoading=false}
    }
    go('ai');
  };
  $('#bellBtn').onclick=()=>toast(findR('week',curKey.week)?'新しいお知らせはありません':'今週の振り返りを日曜までに書きましょう');

  let channelSettingsBusy=false,channelSettingsLoaded=false,channelSettingsToken=0,channelSettingsRevision='';
  function renderRegisteredChannels(channels){
    const list=$('#youtubeRegisteredChannels');list.replaceChildren();$('#youtubeChannelCount').textContent='（'+channels.length+'件）';
    for(const c of channels){const row=document.createElement('div');row.className='registered-channel';const link=document.createElement('a');link.href='https://www.youtube.com/channel/'+c.id;link.target='_blank';link.rel='noopener noreferrer';link.textContent=c.title||c.id;const remove=document.createElement('button');remove.type='button';remove.className='small-btn';remove.textContent='登録解除';remove.setAttribute('aria-label',(c.title||c.id)+'の登録を解除');remove.onclick=()=>youtubeChannelSettings({op:'remove',id:c.id});row.append(link,remove);list.append(row)}
    if(!channels.length)list.textContent='登録チャンネルはまだありません。';
  }
  async function youtubeChannelSettings(change){
    const form=$('#youtubeChannelsForm');if(!form||!isOwnerView||channelSettingsBusy)return;
    const input=$('#youtubeChannelInput'),status=$('#youtubeChannelsStatus'),token=++channelSettingsToken;
    if(change?.op==='add'&&!input.value.trim()){status.textContent='チャンネルを入力してください。';input.focus();return}
    channelSettingsBusy=true;form.querySelectorAll('button,input').forEach(e=>e.disabled=true);
    status.textContent=change?'登録内容を保存しています…':'登録チャンネルを読み込んでいます…';
    try{
      if(!window.appAuth?.youtubeChannels)throw Error('画面を更新するには再読み込みしてください。');
      const data=await window.appAuth.youtubeChannels(change?{...change,revision:channelSettingsRevision}:undefined);
      if(token!==channelSettingsToken||!isOwnerView)return;
      if(!Array.isArray(data.channels))throw Error('最新の画面を表示するには再読み込みしてください。');
      channelSettingsLoaded=true;channelSettingsRevision=data.revision;renderRegisteredChannels(data.channels);
      if(change?.op==='add'&&!data.duplicate)input.value='';
      status.textContent=data.duplicate?'このチャンネルは登録済みです。':change?'保存しました。反映まで約1分かかる場合があります。':'';
      if(change&&youtubeRecommendations)youtubeRecommendations.invalidate();
    }catch(e){if(token===channelSettingsToken)status.textContent=e.name==='AbortError'?'時間がかかっています。「更新」で保存結果を確認してください。':e.message||'設定を読み込めませんでした。';}
    finally{channelSettingsBusy=false;if(token===channelSettingsToken&&isOwnerView){form.querySelectorAll('button,input').forEach(e=>e.disabled=false);input.disabled=!channelSettingsLoaded;$('#youtubeChannelsSave').disabled=!channelSettingsLoaded}}
  }
  const channelForm=$('#youtubeChannelsForm');
  if(channelForm){channelForm.onsubmit=e=>{e.preventDefault();youtubeChannelSettings({op:'add',channel:$('#youtubeChannelInput').value.trim()})};$('#youtubeChannelsReload').onclick=()=>youtubeChannelSettings();$('#youtubeChannelsDetails').addEventListener('toggle',()=>{if($('#youtubeChannelsDetails').open&&!channelSettingsLoaded)youtubeChannelSettings()});}

  let inquiryUi=null,inquiryLoading=null;
  async function openInquiry(which){
    if(!['settings','admin'].includes(which))return;
    try{
      if(!inquiryUi){if(!inquiryLoading)inquiryLoading=import('./inquiry.js');const module=await inquiryLoading;
        if(!inquiryUi)inquiryUi=module.mountInquiry({request:(...args)=>{if(!window.appAuth?.inquiry)throw Error('連絡機能を更新するには再読み込みしてください。');return window.appAuth.inquiry(...args)},account:()=>backend==='cloud'&&!$('#app').hidden&&uid?uid:null,isAdmin:()=>isOwnerView,name:()=>profile.nick||''});}
      if((which==='settings'&&!$('#accSettings').hidden)||(which==='admin'&&isOwnerView&&!$('#accAdmin').hidden))inquiryUi.open(which);
    }catch(e){const status=$(which==='admin'?'#inquiryAdminStatus':'#inquiryStatus');if(status)status.textContent='連絡欄を開けませんでした。再読み込みしてください。';inquiryLoading=null;}
  }
  function showAcc(which){
    if(!['menu','profile','settings','admin'].includes(which))which='menu';
    if(which==='admin'&&!isOwnerView)which='menu';
    if(which!=='admin')++adminLoadToken;
    $('#accMenu').hidden=which!=='menu';$('#accProfile').hidden=which!=='profile';$('#accSettings').hidden=which!=='settings';$('#accAdmin').hidden=which!=='admin';
    if(which==='profile')fillForm();
    if(which==='settings'||which==='admin')openInquiry(which);
    if(which==='admin'){loadAdminMembers();renderApplicants()}
    window.scrollTo(0,0);
    pushNav({v:'account',a:which});
  }
  document.addEventListener('click',e=>{const b=e.target.closest('[data-acc]');if(b)showAcc(b.dataset.acc)});

  // Day keys follow Japan time, matching the administrator's server-side status date.
  // Refresh display only: never erase history or rebuild a reflection/comment draft at midnight.
  let dayTimer=0;
  function refreshDayClock(){
    const next=japanDayKey();if(next===todayKey)return false;
    const oldWeek=curKey.week,oldMonth=curKey.month,currentMonth=viewY===TODAY.getFullYear()&&viewM===TODAY.getMonth();
    TODAY.setTime(parseIso(next).getTime());todayKey=next;yesterdayKey=iso(addDays(TODAY,-1));
    curKey.week=iso(mondayOf(TODAY));curKey.month=`${TODAY.getFullYear()}-${pad(TODAY.getMonth()+1)}`;
    if($('#v-reflect').hidden){if(editKey.week===oldWeek)editKey.week=curKey.week;if(editKey.month===oldMonth)editKey.month=curKey.month}
    if(currentMonth){viewY=TODAY.getFullYear();viewM=TODAY.getMonth()}
    renderHome();renderCheck();renderMembers();renderChat();renderQuote();
    if(isOwnerView&&!$('#accAdmin').hidden)loadAdminMembers();
    return true;
  }
  function scheduleDayClock(){
    clearTimeout(dayTimer);
    const nextMidnight=Date.parse(japanDayKey()+'T00:00:00+09:00')+86400000;
    dayTimer=setTimeout(()=>{refreshDayClock();scheduleDayClock()},Math.max(50,nextMidnight-Date.now()+30));
  }
  function resumeDayClock(){refreshDayClock();scheduleDayClock()}
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resumeDayClock()});
  addEventListener('focus',resumeDayClock);addEventListener('pageshow',resumeDayClock);

  // ---------- navigation ----------
  const views=['home','check','reflect','rfview','timeline','mates','ai','soon','account'];
  function go(tab){
    if(tab==='ai'&&(!shinAi||backend!=='cloud'||!uid||pending()))tab='home';
    refreshDayClock();
    views.forEach(v=>{const view=$('#v-'+v);if(view)view.hidden=v!==tab});
    const navTab=(tab==='check'||tab==='reflect'||tab==='rfview'||tab==='ai')?'home':tab;
    document.querySelectorAll('nav.tabs button').forEach(b=>{if(b.dataset.tab===navTab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
    if(tab==='reflect')renderReflect();
    if(tab==='timeline')renderFeed();
    if(tab==='rfview')renderRfView();
    if(tab==='account'){fillForm();showAcc('menu')}
    if(tab==='mates'){renderChat.stick=true;renderChat()}
    if(tab==='home')renderHomeLog();
    if(tab==='soon')openYoutube();else if(youtubeRecommendations)youtubeRecommendations.stop();
    syncHomeLogTimer(true);
    window.scrollTo(0,0);
    if(tab!=='account')pushNav({v:tab,a:tab==='rfview'?rfOpenId:undefined});
  }
  // Safari-style ‹ › : a small history of the screens visited in this session
  let navHist=[{v:'home'}],navIdx=0,navReplay=false;
  function updNav(){$('#navBack').disabled=navIdx<=0;$('#navFwd').disabled=navIdx>=navHist.length-1}
  function pushNav(e){
    if(navReplay)return;
    const cur=navHist[navIdx];if(cur&&cur.v===e.v&&cur.a===e.a)return;
    navHist=navHist.slice(0,navIdx+1);navHist.push(e);
    if(navHist.length>50)navHist.shift();
    navIdx=navHist.length-1;updNav();
  }
  function navTo(i){
    if(i<0||i>=navHist.length)return;
    const e=navHist[i];navReplay=true;
    try{if(e.v==='rfview')rfOpenId=e.a||'';go(e.v);if(e.v==='account')showAcc(e.a||'menu')}finally{navReplay=false}
    navIdx=i;updNav();
  }
  $('#navBack').onclick=()=>navTo(navIdx-1);
  $('#navFwd').onclick=()=>navTo(navIdx+1);
  document.addEventListener('click',e=>{const t=e.target.closest('[data-tab],[data-goto]');if(t)go(t.dataset.tab||t.dataset.goto)});

  // ---------- hero ambience ----------
  const cv=$('#heroCanvas'),cx=cv.getContext('2d');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W,H,dots=[],t=0;
  function size(){const r=cv.getBoundingClientRect(),d=devicePixelRatio||1;W=r.width;H=r.height;cv.width=W*d;cv.height=H*d;cx.setTransform(d,0,0,d,0,0);
    dots=Array.from({length:40},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.6+.4,v:Math.random()*.25+.05}))}
  function draw(){if(!W||!H)return;   // canvas not measured yet (app still hidden)
    cx.clearRect(0,0,W,H);
    const g=cx.createRadialGradient(W*.85,H*.2,0,W*.85,H*.2,W*.6);g.addColorStop(0,'rgba(255,205,212,.35)');g.addColorStop(1,'rgba(255,205,212,0)');cx.fillStyle=g;cx.fillRect(0,0,W,H);
    cx.strokeStyle='rgba(255,255,255,.08)';cx.lineWidth=1;
    for(let k=0;k<5;k++){cx.beginPath();for(let x=0;x<=W;x+=8){const y=H*.72+k*10+Math.sin(x/40+t/900+k)*4;x?cx.lineTo(x,y):cx.moveTo(x,y)}cx.stroke()}
    cx.fillStyle='rgba(255,255,255,.7)';dots.forEach(d=>{d.y-=d.v;if(d.y<0)d.y=H;cx.beginPath();cx.arc(d.x,d.y,d.r,0,7);cx.fill()});
  }
  function loop(ts){t=ts;draw();if(!reduce)requestAnimationFrame(loop)}

  function renderAll(){renderHome();renderCheck();if(!$('#v-reflect').hidden)renderReflect();else renderBox()}

  if(!STRICT)loadLocal();   // the Supabase build shows nothing from this browser before the account has loaded
  renderAll();renderMembers();fillForm();
  const h=location.hash.slice(1);if(views.includes(h))go(h);
  addEventListener('resize',size);requestAnimationFrame(loop);
  scheduleDayClock();
  initCloud().then(boot,boot);
})();
