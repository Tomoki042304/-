const encoder=new TextEncoder();
export function b64url(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
export function unb64(value){if(typeof value!=='string'||value.length>1000||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('base64');return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0))}
const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out};
async function hkdf(ikm,salt,info,length){const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},key,length*8))}
export function validateSubscription(sub){
  if(!sub||typeof sub.endpoint!=='string'||sub.endpoint.length>3000)throw Error('endpoint');const url=new URL(sub.endpoint);const host=url.hostname;
  if(url.protocol!=='https:'||url.username||url.password||url.port||!(['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(host)||host.endsWith('.notify.windows.com')))throw Error('endpoint');
  const p256dh=unb64(sub.keys?.p256dh),auth=unb64(sub.keys?.auth);if(p256dh.length!==65||p256dh[0]!==4||auth.length!==16)throw Error('keys');return {endpoint:url.href,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}};
}
export async function newVapidKey(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {publicKey:b64url(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)}}
export async function encryptedPush(subscription,key,payload){
  const sub=validateSubscription(subscription),publicBytes=unb64(sub.keys.p256dh),auth=unb64(sub.keys.auth);
  const peer=await crypto.subtle.importKey('raw',publicBytes,{name:'ECDH',namedCurve:'P-256'},false,[]),ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const serverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',ephemeral.publicKey)),shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},ephemeral.privateKey,256));
  const ikm=await hkdf(shared,auth,join(encoder.encode('WebPush: info\0'),publicBytes,serverPublic),32),salt=crypto.getRandomValues(new Uint8Array(16));
  const aes=await hkdf(ikm,salt,encoder.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(ikm,salt,encoder.encode('Content-Encoding: nonce\0'),12);
  const plain=join(encoder.encode(JSON.stringify(payload)),new Uint8Array([2]));if(plain.length>3500)throw Error('payload');
  const contentKey=await crypto.subtle.importKey('raw',aes,'AES-GCM',false,['encrypt']),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},contentKey,plain));
  const record=new Uint8Array(4);new DataView(record.buffer).setUint32(0,4096);const body=join(salt,record,new Uint8Array([65]),serverPublic,encrypted);
  const header=b64url(encoder.encode(JSON.stringify({typ:'JWT',alg:'ES256'}))),claims=b64url(encoder.encode(JSON.stringify({aud:new URL(sub.endpoint).origin,exp:Math.floor(Date.now()/1000)+43200,sub:'https://ikigai-shidoroku.pages.dev'})));
  const signing=await crypto.subtle.importKey('jwk',key.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign']),signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,encoder.encode(header+'.'+claims));
  return {body,headers:{'Authorization':'vapid t='+header+'.'+claims+'.'+b64url(signature)+', k='+key.publicKey,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','TTL':'86400','Urgency':'normal'}};
}
export async function digest(text){return b64url(await crypto.subtle.digest('SHA-256',encoder.encode(text)))}
export async function deliverPush(env,uid,payload){
  let cursor;do{
    const page=await env.YT_CACHE.list({prefix:'push:subscription:v1:'+uid+':',limit:10,...(cursor?{cursor}:{})});
    // Send a bounded batch; no notification content or subscription secrets are logged.
    await Promise.all(page.keys.map(async item=>{try{const subscription=await env.YT_CACHE.get(item.name,'json');if(!subscription)return;const vapid=await env.YT_CACHE.get('push:key:v1:'+subscription.keyId,'json');if(!vapid||vapid.uid!==uid)return;const encrypted=await encryptedPush(subscription,vapid,payload),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await fetch(subscription.endpoint,{method:'POST',headers:encrypted.headers,body:encrypted.body,redirect:'manual',signal:controller.signal});if([404,410].includes(response.status)&&env.YT_CACHE.delete)await env.YT_CACHE.delete(item.name)}finally{clearTimeout(timer)}}catch{}}));
    cursor=page.list_complete?null:page.cursor;
  }while(cursor);
}
