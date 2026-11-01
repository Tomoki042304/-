const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function prepareGrowthPhoto(file){
 if(!file||file.size>25*1024*1024||file.type&&!/^image\//.test(file.type))throw Error('25MB以内の写真を選んでください。');
 const source=URL.createObjectURL(file),image=new Image();
 try{
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('写真を読み込めませんでした。別の写真を選んでください。'));image.src=source});
  if(!image.naturalWidth||!image.naturalHeight)throw Error('写真を読み込めませんでした。');
  let scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');
  for(let pass=0;pass<4;pass++){
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
   for(const quality of [.82,.65,.48]){const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=160000){canvas.width=canvas.height=1;return blob}}
   scale*=.75;
  }
  throw Error('写真を小さくできませんでした。別の写真を選んでください。');
 }finally{URL.revokeObjectURL(source)}
}
export function mountGrowthPhotos({request,account,allowed,notify}){
 const $=s=>document.querySelector(s);let draft=null,sequence=0,preparing=false,epoch=0,owner=account();
 const cache=new Map(),pending=new Map(),targets=new Set();let running=0;const queue=[];
 const dialog=$('#growthPhotoDialog'),viewer=$('#growthPhotoFull');
 $('#growthPhotoClose').onclick=()=>dialog.close();
 function resetImages(){epoch++;for(const record of cache.values())URL.revokeObjectURL(record.url);cache.clear();pending.clear();for(const task of queue.splice(0))task.reject(Error('停止しました'));for(const el of targets)observer?.unobserve(el);targets.clear();if(dialog.open)dialog.close();viewer.removeAttribute('src')}
 function identity(){if(owner!==account()){resetImages();clear(false);owner=account()}return allowed()&&!!owner}
 function preview(){const box=$('#postPhotoPreview');box.hidden=!draft;const img=$('#postPhotoPreviewImage');if(draft)img.src=draft.url;else img.removeAttribute('src');$('#postPhotoStatus').textContent=preparing?'写真を準備しています…':draft?'写真を1枚添付します。':''}
 function clear(cleanup=true,keepId=null){sequence++;if(draft){if(cleanup&&draft.uploadedIds?.size&&identity())for(const id of draft.uploadedIds)if(id!==keepId)void request({action:'delete',id}).catch(()=>{});URL.revokeObjectURL(draft.url)}draft=null;preparing=false;$('#postPhotoFile').value='';preview()}
 $('#postPhotoFile').onchange=async event=>{
  const file=event.target.files?.[0];if(!file||!identity())return;const turn=++sequence,who=account();preparing=true;preview();
  try{const blob=await prepareGrowthPhoto(file);if(turn!==sequence||who!==account())return;clear();draft={id:crypto.randomUUID(),blob,url:URL.createObjectURL(blob),uploadedIds:new Set()};preparing=false;preview()}
  catch(error){if(turn===sequence)notify(error.message)}finally{if(turn===sequence){preparing=false;preview()}}
 };
 $('#postPhotoRemove').onclick=()=>clear();
 function work(){while(running<2&&queue.length){const item=queue.shift();running++;Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{running--;work()})}}
 function queued(task){return new Promise((resolve,reject)=>{queue.push({task,resolve,reject});work()})}
 function prune(){for(const el of targets)if(!el.isConnected){observer?.unobserve(el);targets.delete(el)}for(const [key,value] of cache){if(cache.size<=12)break;if(viewer.src!==value.url&&![...targets].some(el=>el.dataset.photoKey===key&&el._photoVisible)){cache.delete(key);URL.revokeObjectURL(value.url);for(const el of targets)if(el.dataset.photoKey===key){el._photoUrl='';el.querySelector('img').removeAttribute('src');el.querySelector('img').hidden=true;el.querySelector('span').hidden=false}}}}
 function read(author,id){
  const key=author+'/'+id;if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return Promise.resolve(value.url)}
  if(pending.has(key))return pending.get(key);const token=epoch,who=account();
  const job=queued(async()=>{if(token!==epoch||who!==account()||!identity())throw Error('停止しました');const blob=await request({action:'read',author,id});if(token!==epoch||who!==account()||blob.type!=='image/jpeg')throw Error('写真を読み込めませんでした');const url=URL.createObjectURL(blob);cache.set(key,{url});prune();return url}).finally(()=>{if(token===epoch)pending.delete(key)});pending.set(key,job);return job;
 }
 async function load(el){
  if(!identity()||!el.isConnected)return;const token=epoch;
  try{const url=await read(el.dataset.author,el.dataset.id);if(token!==epoch||!el.isConnected)return;el.querySelector('img').src=url;el.querySelector('img').hidden=false;el.querySelector('span').hidden=true;el._photoUrl=url}
  catch{if(token===epoch&&el.isConnected){el.querySelector('span').textContent='写真を再読み込み';el.querySelector('span').hidden=false}}
 }
 const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{for(const entry of entries){entry.target._photoVisible=entry.isIntersecting;if(entry.isIntersecting)void load(entry.target)}},{rootMargin:'160px'}):null;
 function attach(container,{author,id,preview:small=false}){
  if(!UUID.test(author||'')||!UUID.test(id||'')||!identity())return;
  prune();const frame=document.createElement(small?'div':'button');if(!small)frame.type='button';frame.className='growth-photo'+(small?' small':'');frame.dataset.author=author;frame.dataset.id=id;frame.dataset.photoKey=author+'/'+id;
  const image=document.createElement('img');image.alt='成長ログの写真';image.decoding='async';image.hidden=true;const label=document.createElement('span');label.textContent='写真を読み込み中…';frame.append(image,label);container.append(frame);targets.add(frame);
  if(!small){frame.setAttribute('aria-label','成長ログの写真を大きく表示');frame.onclick=event=>{event.preventDefault();event.stopPropagation();if(frame._photoUrl){viewer.src=frame._photoUrl;dialog.showModal()}else void load(frame)}}
  if(observer)observer.observe(frame);else void load(frame);
 }
 if($('#postPhotoFile').files?.length)void $('#postPhotoFile').onchange({target:$('#postPhotoFile')});
 return {attach,getDraft:()=>draft,isPreparing:()=>preparing,uploaded:id=>{if(draft)draft.uploadedIds.add(id)},clear,stop(){clear(false);resetImages()}};
}
