import {requireYoutubeMember,requireYoutubeHost} from '../../server/youtube-member.js';
const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/,ID=/^[A-Za-z0-9_-]{11}$/,AGE=86400000,CONFIG='youtube:channels:v2';
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const clean=v=>typeof v==='string'?v.trim():'';
const validChannel=c=>c&&CHANNEL.test(c.id)&&typeof c.title==='string';
async function readConfig(env){
  const c=await env.YT_CACHE.get(CONFIG,'json');
  if(c){if(typeof c.revision!=='string'||!Array.isArray(c.channels)||!c.channels.every(validChannel))throw Error('config');return c}
  // Keep channels already registered in the previous theme-based screen.
  const old=await env.YT_CACHE.get('youtube:channels:v1','json');
  if(old&&(!old.channels||typeof old.channels!=='object'||!Object.values(old.channels).every(validChannel)))throw Error('legacy');
  return {revision:old?.revision||'default',channels:[...new Map(Object.values(old?.channels||{}).map(c=>[c.id,c])).values()]};
}
function channelRef(value){
  let text=clean(value);if(text.length>300)throw Error('length');
  if(text.startsWith('https://')){const u=new URL(text);if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)||u.username||u.password||u.port)throw Error('url');const parts=u.pathname.split('/').filter(Boolean);text=parts[0]==='channel'&&parts.length===2?parts[1]:parts.length===1?decodeURIComponent(parts[0]):'';}
  if(CHANNEL.test(text))return {id:text};if(/^@[^\s/?#]{1,100}$/u.test(text))return {handle:text};throw Error('channel');
}
async function google(env,path,params){
  if(!clean(env.YOUTUBE_API_KEY))throw Error('setup');
  const url=new URL('https://www.googleapis.com/youtube/v3/'+path);for(const [k,v] of Object.entries({...params,key:env.YOUTUBE_API_KEY}))url.searchParams.set(k,v);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const r=await fetch(url,{signal:controller.signal,redirect:'manual',headers:{Accept:'application/json'}});if(!r.ok)throw Error('provider');const data=await r.json();if(!Array.isArray(data.items))throw Error('format');return data.items}finally{clearTimeout(timer)}
}
async function settings(request,env,config){
  if(request.method==='GET')return reply(200,config);
  let payload,ref;
  try{if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw Error('type');const raw=await request.text();if(raw.length>2000)throw Error('size');payload=JSON.parse(raw);if(!['add','remove'].includes(payload.op)||typeof payload.revision!=='string')throw Error('op');if(payload.op==='add'){if(typeof payload.channel!=='string')throw Error('channel');ref=channelRef(payload.channel)}else if(!CHANNEL.test(payload.id))throw Error('id')}catch{return reply(400,{message:'チャンネルURL・@ユーザー名・チャンネルIDを入力してください。画面が古い場合は再読み込みしてください。'})}
  if(payload.revision!==config.revision)return reply(409,{message:'別の変更が保存されています。「更新」で最新の一覧を読み込んでください。'});
  let channels=[...config.channels];
  try{
    if(payload.op==='remove')channels=channels.filter(c=>c.id!==payload.id);
    else{
      if(ref.id&&channels.some(c=>c.id===ref.id))return reply(200,{...config,duplicate:true});
      const items=await google(env,'channels',{part:'snippet',...(ref.id?{id:ref.id}:{forHandle:ref.handle})}),item=items[0];
      if(!item||!CHANNEL.test(item.id))return reply(400,{message:'チャンネルが見つかりません。入力を確認してください。'});
      if(channels.some(c=>c.id===item.id))return reply(200,{...config,duplicate:true});
      channels.push({id:item.id,title:clean(item.snippet?.title).slice(0,120)});
    }
    const next={revision:crypto.randomUUID(),channels};
    await env.YT_CACHE.put(CONFIG,JSON.stringify(next));return reply(200,next);
  }catch{return reply(503,{message:'登録内容を保存できませんでした。時間をおいてお試しください。'})}
}
function cached(v,id){return v&&v.channelId===id&&Array.isArray(v.videos)&&v.videos.length<=6&&v.videos.every(x=>ID.test(x.id)&&x.channelId===id&&typeof x.title==='string'&&typeof x.channel==='string')&&Number.isFinite(Date.parse(v.updatedAt))&&Date.parse(v.updatedAt)<=Date.now()+60000&&Date.now()-Date.parse(v.updatedAt)<AGE*2}
async function channelVideos(channel,env){
  const key='youtube:channel-feed:v1:'+channel.id;let previous;
  try{previous=await env.YT_CACHE.get(key,'json')}catch{throw Error('cache')}
  const valid=cached(previous,channel.id);if(valid&&Date.now()-Date.parse(previous.updatedAt)<AGE)return {...previous,stale:false};
  try{
    const items=await google(env,'search',{part:'snippet',type:'video',channelId:channel.id,maxResults:'6',order:'date',safeSearch:'strict',videoEmbeddable:'true',videoSyndicated:'true'});
    const seen=new Set(),videos=[];
    for(const item of items){const id=item?.id?.videoId,s=item?.snippet;if(!ID.test(id)||!s||s.channelId!==channel.id||!clean(s.title)||seen.has(id)||['live','upcoming'].includes(s.liveBroadcastContent))continue;seen.add(id);let thumbnail='';try{const u=new URL(s.thumbnails?.high?.url||s.thumbnails?.medium?.url||'');if(u.protocol==='https:'&&u.hostname==='i.ytimg.com'&&!u.username&&!u.password&&!u.port)thumbnail=u.href}catch{}videos.push({id,title:clean(s.title).slice(0,200),channel:clean(s.channelTitle).slice(0,120),channelId:channel.id,thumbnail})}
    const data={channelId:channel.id,updatedAt:new Date().toISOString(),videos};await env.YT_CACHE.put(key,JSON.stringify(data),{expirationTtl:172800});return {...data,stale:false};
  }catch{if(valid)return {...previous,stale:true};throw Error('unavailable')}
}
export async function onRequest({request,env}){
  const url=new URL(request.url),isSettings=url.searchParams.get('action')==='channels';
  if(!['GET',...(isSettings?['POST']:[])].includes(request.method))return reply(405,{message:'利用できない操作です。'});
  const permission=await (isSettings?requireYoutubeHost:requireYoutubeMember)(request);if(!permission.ok)return reply(permission.status,{code:permission.code||'access',message:permission.message});
  if(!env.YT_CACHE?.get||!env.YT_CACHE?.put)return reply(503,{message:'おすすめ動画の接続準備中です。'});
  let config;try{config=await readConfig(env)}catch{return reply(503,{message:'チャンネル一覧を読み込めませんでした。'})}
  if(isSettings)return settings(request,env,config);
  const raw=url.searchParams.get('cursor')||'0';if(!/^\d{1,9}$/.test(raw))return reply(400,{message:'一覧を読み込み直してください。'});
  const offset=Number(raw);if(offset>0&&url.searchParams.get('revision')!==config.revision)return reply(409,{message:'登録チャンネルが更新されました。もう一度読み込んでください。'});
  const selected=config.channels.slice(offset,offset+3),results=await Promise.allSettled(selected.map(c=>channelVideos(c,env)));
  const good=results.filter(r=>r.status==='fulfilled').map(r=>r.value),partial=good.length<selected.length;
  if(selected.length&&!good.length)return reply(503,{message:'動画を取得できませんでした。時間をおいてお試しください。'});
  const videos=[],seen=new Set();for(let i=0;i<6;i++)for(const data of good){const v=data.videos[i];if(v&&!seen.has(v.id)){seen.add(v.id);videos.push(v)}}
  return reply(200,{topic:'all',revision:config.revision,updatedAt:good.map(d=>d.updatedAt).sort()[0]||new Date().toISOString(),videos,stale:good.some(d=>d.stale),partial,channelCount:config.channels.length,nextCursor:offset+3<config.channels.length?String(offset+3):null});
}
