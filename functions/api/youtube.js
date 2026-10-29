import {requireYoutubeMember,requireYoutubeHost} from '../../server/youtube-member.js';
const TOPICS={aspiration:{label:'志',query:'志 生きがい 目標 考え方'},work:{label:'仕事',query:'仕事 成長 キャリア 学び'},challenge:{label:'挑戦',query:'挑戦 行動力 目標達成'},training:{label:'トレーニング',query:'トレーニング 基礎 フォーム'}};
const AGE=24*60*60*1000,ID=/^[A-Za-z0-9_-]{11}$/;
const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function clean(v){return typeof v==='string'?v.trim():''}
function cached(v,topic){return v&&v.topic===topic&&Array.isArray(v.videos)&&v.videos.length<=6&&v.videos.every(x=>x&&ID.test(x.id)&&typeof x.title==='string'&&typeof x.channel==='string')&&Number.isFinite(Date.parse(v.updatedAt))&&Date.parse(v.updatedAt)<=Date.now()+60000&&Date.now()-Date.parse(v.updatedAt)<AGE*2}
export async function onRequest({request,env}){
  const settings=new URL(request.url).searchParams.get('action')==='channels';
  if(!['GET',...(settings?['POST']:[])].includes(request.method))return reply(405,{message:'利用できない操作です。'});
  const topic=new URL(request.url).searchParams.get('topic')||'aspiration';
  if(!Object.hasOwn(TOPICS,topic))return reply(400,{code:'topic',message:'テーマを選び直してください。'});
  const permission=await (settings?requireYoutubeHost:requireYoutubeMember)(request);if(!permission.ok)return reply(permission.status,{code:permission.code||'access',message:permission.message});
  if(!env.YT_CACHE?.get||!env.YT_CACHE?.put)return reply(503,{code:'setup',message:'おすすめ動画の接続準備中です。'});
  let config;
  try{config=await env.YT_CACHE.get('youtube:channels:v1','json');if(config&&!validConfig(config))throw Error('config')}catch{return reply(503,{message:'チャンネル設定を読み込めませんでした。'})}
  config=config||{revision:'default',channels:{}};
  if(settings)return channelSettings(request,env,config);
  const selected=config.channels[topic];
  const key=selected?'youtube:v2:'+topic+':'+config.revision:'youtube:v1:'+topic;let previous;
  try{previous=await env.YT_CACHE.get(key,'json')}catch{return reply(503,{code:'cache',message:'動画一覧を読み込めませんでした。時間をおいてお試しください。'})}
  const valid=cached(previous,topic);
  if(valid&&Date.now()-Date.parse(previous.updatedAt)<AGE)return reply(200,{...previous,stale:false});
  if(typeof env.YOUTUBE_API_KEY!=='string'||!env.YOUTUBE_API_KEY.trim())return valid?reply(200,{...previous,stale:true}):reply(503,{code:'setup',message:'おすすめ動画の接続準備中です。'});
  const url=new URL('https://www.googleapis.com/youtube/v3/search');
  for(const [k,v] of Object.entries({part:'snippet',type:'video',q:TOPICS[topic].query,maxResults:'6',order:'relevance',safeSearch:'strict',relevanceLanguage:'ja',regionCode:'JP',videoEmbeddable:'true',videoSyndicated:'true'}))url.searchParams.set(k,v);
  if(selected)url.searchParams.set('channelId',selected.id);
  url.searchParams.set('key',env.YOUTUBE_API_KEY);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal,redirect:'manual'});
    if(!response.ok){if(valid)return reply(200,{...previous,stale:true});return reply(503,{code:'provider',message:'動画を取得できませんでした。接続設定やAPIの利用上限を確認し、時間をおいてお試しください。'})}
    const result=await response.json();if(!Array.isArray(result.items))throw Error('invalid response');
    const seen=new Set(),videos=[];
    for(const item of result.items){const id=item?.id?.videoId,snippet=item?.snippet;if(!ID.test(id)||!snippet||(selected&&snippet.channelId!==selected.id)||!clean(snippet.title)||seen.has(id)||['live','upcoming'].includes(snippet.liveBroadcastContent))continue;seen.add(id);let thumbnail='';try{const image=new URL(snippet.thumbnails?.high?.url||snippet.thumbnails?.medium?.url||'');if(image.protocol==='https:'&&image.hostname==='i.ytimg.com'&&!image.username&&!image.password&&!image.port)thumbnail=image.href}catch{}videos.push({id,title:clean(snippet.title).slice(0,200),channel:clean(snippet.channelTitle).slice(0,120),thumbnail});if(videos.length===6)break}
    const data={topic,label:TOPICS[topic].label,updatedAt:new Date().toISOString(),videos};
    await env.YT_CACHE.put(key,JSON.stringify(data),{expirationTtl:172800});
    return reply(200,{...data,stale:false});
  }catch{if(valid)return reply(200,{...previous,stale:true});return reply(503,{code:'unavailable',message:'動画を取得できませんでした。時間をおいてお試しください。'})}
  finally{clearTimeout(timer)}
}

const CHANNEL=/^UC[A-Za-z0-9_-]{22}$/;
function validConfig(c){return typeof c.revision==='string'&&c.revision.length<=80&&c.channels&&typeof c.channels==='object'&&Object.entries(c.channels).every(([t,v])=>Object.hasOwn(TOPICS,t)&&v&&CHANNEL.test(v.id)&&typeof v.title==='string')}
function channelRef(value){
  let text=clean(value);if(!text)return null;
  if(text.startsWith('https://')){const u=new URL(text);if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname)||u.username||u.password||u.port)throw Error('url');const parts=u.pathname.split('/').filter(Boolean);text=parts[0]==='channel'&&parts.length===2?parts[1]:parts.length===1?decodeURIComponent(parts[0]):'';}
  if(CHANNEL.test(text))return {id:text};
  if(/^@[^\s/?#]{1,100}$/u.test(text))return {handle:text};
  throw Error('channel');
}
async function channelSettings(request,env,config){
  if(request.method==='GET')return reply(200,config);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,{message:'JSON形式で送信してください。'});
  let payload,refs={};
  try{const raw=await request.text();if(raw.length>5000)throw Error('size');payload=JSON.parse(raw);if(!payload.channels||typeof payload.channels!=='object'||Array.isArray(payload.channels))throw Error('payload');for(const t of Object.keys(TOPICS)){const v=payload.channels[t]??'';if(typeof v!=='string'||v.length>300)throw Error('value');refs[t]=channelRef(v)}}catch{return reply(400,{message:'チャンネルURL、@ユーザー名、またはUCで始まるチャンネルIDを入力してください。'})}
  const channels={};
  try{
    for(const [topic,ref] of Object.entries(refs)){
      if(!ref)continue;
      // Reuse an already verified channel without spending API quota.
      if(ref.id&&config.channels[topic]?.id===ref.id){channels[topic]=config.channels[topic];continue}
      if(!env.YOUTUBE_API_KEY)throw Error('setup');
      const url=new URL('https://www.googleapis.com/youtube/v3/channels');url.searchParams.set('part','snippet');url.searchParams.set(ref.id?'id':'forHandle',ref.id||ref.handle);url.searchParams.set('key',env.YOUTUBE_API_KEY);
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{const r=await fetch(url,{signal:controller.signal,redirect:'manual'});if(!r.ok)throw Error('provider');const data=await r.json(),item=data.items?.[0];if(!item||!CHANNEL.test(item.id))return reply(400,{message:TOPICS[topic].label+'のチャンネルが見つかりません。入力を確認してください。'});channels[topic]={id:item.id,title:clean(item.snippet?.title).slice(0,120)}}finally{clearTimeout(timer)}
    }
    const data={revision:crypto.randomUUID(),channels};
    await env.YT_CACHE.put('youtube:channels:v1',JSON.stringify(data));
    return reply(200,data);
  }catch{return reply(503,{message:'チャンネルを確認・保存できませんでした。時間をおいてお試しください。'})}
}
