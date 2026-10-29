const ID=/^[A-Za-z0-9_-]{11}$/;
function plain(text){return String(text||'').replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|[0-9]+);/gi,x=>{const named={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};if(named[x.toLowerCase()])return named[x.toLowerCase()];const n=x[2].toLowerCase()==='x'?parseInt(x.slice(3,-1),16):parseInt(x.slice(2,-1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):''})}
export function mountYoutubeRecommendations({request,allowed}){
  const $=s=>document.querySelector(s),list=$('#youtubeList'),status=$('#youtubeStatus');
  let controller=null,epoch=0,loaded=null,returnFocus=null,loadedAt=0,busy=false;
  function close(){const frame=$('#youtubePlayer iframe');if(frame)frame.remove();$('#youtubePlayer').hidden=true;if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null}
  function stop(){epoch++;controller?.abort();controller=null;busy=false;close()}
  $('#youtubeClose').onclick=close;
  function play(video,button){close();returnFocus=button;const box=$('#youtubePlayer'),slot=$('#youtubeFrame');slot.replaceChildren();const iframe=document.createElement('iframe');iframe.src='https://www.youtube-nocookie.com/embed/'+video.id+'?autoplay=1&playsinline=1&rel=0';iframe.title=plain(video.title);iframe.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';iframe.allowFullscreen=true;iframe.referrerPolicy='strict-origin-when-cross-origin';slot.append(iframe);$('#youtubePlayerTitle').textContent=plain(video.title);$('#youtubeExternal').href='https://www.youtube.com/watch?v='+video.id;box.hidden=false;box.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});$('#youtubePlayerTitle').focus({preventScroll:true})}
  function render(data){list.replaceChildren();for(const video of data.videos){if(!ID.test(video.id))continue;const article=document.createElement('article');article.className='card youtube-card';const button=document.createElement('button');button.type='button';button.className='youtube-video';button.setAttribute('aria-label',plain(video.title)+'を再生');const thumb=document.createElement('div');thumb.className='youtube-thumb';const image=document.createElement('img');let thumbnail='';try{const u=new URL(video.thumbnail);if(u.protocol==='https:'&&u.hostname==='i.ytimg.com'&&!u.username&&!u.password&&!u.port)thumbnail=u.href}catch{}if(thumbnail)image.src=thumbnail;else image.hidden=true;image.alt='';image.loading='lazy';image.referrerPolicy='no-referrer';const icon=document.createElement('span');icon.className='youtube-play';icon.textContent='▶';icon.setAttribute('aria-hidden','true');thumb.append(image,icon);const title=document.createElement('b');title.textContent=plain(video.title);button.append(thumb,title);button.onclick=()=>play(video,button);const channel=document.createElement('p');channel.className='youtube-channel';channel.textContent=plain(video.channel);article.append(button,channel);list.append(article)}status.textContent=data.partial?'一部のチャンネルを読み込めませんでした。時間をおいて再読み込みしてください。':data.stale?'動画の更新待ちです。前回取得した候補を表示しています。':data.videos.length?'登録チャンネルのYouTube動画です。':data.channelCount?'再生できる動画はまだ見つかりません。':'管理者がチャンネルを登録すると動画が表示されます。';$('#youtubeMore').hidden=data.nextCursor===null;$('#youtubeMore').disabled=false;$('#youtubeRetry').hidden=!data.partial;const time=$('#youtubeUpdated');time.textContent='取得：'+new Date(data.updatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
  async function open(force=false,more=false){
    if(!allowed()){stop();loaded=null;list.replaceChildren();$('#youtubeMore').hidden=true;$('#youtubeUpdated').textContent='';status.textContent='管理者の承認後におすすめ動画を見られます。';return}
    if(busy&&!force)return;
    if(!force&&!more&&loaded&&Date.now()-loadedAt<60000){render(loaded);return}
    if(more&&!loaded?.nextCursor)return;
    stop();const token=epoch;busy=true;controller=new AbortController();status.textContent='動画を読み込んでいます…';$('#youtubeMore').disabled=true;$('#youtubeRetry').hidden=true;
    if(!more){list.replaceChildren();$('#youtubeMore').hidden=true;$('#youtubeUpdated').textContent=''}
    try{
      const result=await request(more?loaded.nextCursor:'0',{signal:controller.signal,revision:more?loaded.revision:undefined});if(token!==epoch)return;
      if(!result||result.topic!=='all'||!Array.isArray(result.videos)||!Number.isFinite(Date.parse(result.updatedAt)))throw Error('動画一覧を読み込めませんでした。');
      if(more){const seen=new Set(loaded.videos.map(v=>v.id));result.videos=[...loaded.videos,...result.videos.filter(v=>!seen.has(v.id))]}
      loaded=result;loadedAt=Date.now();render(result);
    }catch(err){if(token!==epoch||err?.name==='AbortError')return;status.textContent=err?.message||'動画一覧を読み込めませんでした。';$('#youtubeRetry').hidden=false;if(more){$('#youtubeMore').disabled=false;$('#youtubeMore').hidden=false}}
    finally{if(token===epoch){controller=null;busy=false}}
  }
  $('#youtubeRetry').onclick=()=>open(true);
  $('#youtubeMore').onclick=()=>open(false,true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')close()});
  return {open,stop,invalidate(){stop();loaded=null;loadedAt=0}};
}
