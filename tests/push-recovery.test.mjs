import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../ikigai-production/push-notifications.js',import.meta.url),'utf8').replaceAll('export ','');
const flush=async()=>{for(let i=0;i<100;i++)await Promise.resolve()};
function fixture({ready,permission='default',subscription=null,subscribe,request}={}){
 let asks=0,removed=0,subscribes=0;const calls=[],timers=new Map();let seq=0;
 const sub=subscription||{endpoint:'https://push.test/device',toJSON:()=>({endpoint:'https://push.test/device'}),unsubscribe:async()=>{removed++;return true}};
 const reg={pushManager:{getSubscription:async()=>subscription,subscribe:()=>{subscribes++;return subscribe?subscribe():Promise.resolve(sub)}}};
 const nodes=Object.fromEntries(['pushEnable','pushDisable','pushStatus'].map(k=>['#'+k,{disabled:false,textContent:''}]));
 const notify={permission,requestPermission:()=>{asks++;return Promise.resolve('granted')}};
 const context={Promise,WeakMap,Uint8Array,atob,Error,window:{PushManager:{},Notification:notify},Notification:notify,navigator:{userAgent:'iPhone',standalone:true,serviceWorker:{ready:ready||Promise.resolve(reg),getRegistration:async()=>reg}},matchMedia:()=>({matches:true}),document:{querySelector:s=>nodes[s]},setTimeout:(cb,ms)=>{const id=++seq;timers.set(id,{cb,ms});return id},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source,context);
 const rpc=async payload=>{calls.push(payload.action);if(request)return request(payload);if(payload.action==='status')return {enabled:true};if(payload.action==='key')return {publicKey:'AQ',keyId:'one'};return {enabled:true}};
 return {context,nodes,calls,reg,sub,rpc,get asks(){return asks},get removed(){return removed},get subscribes(){return subscribes},expire(ms){for(const[id,t]of [...timers])if(t.ms===ms){timers.delete(id);t.cb()}}};
}
test('permission request runs directly in tap; successful setup reports progress',async()=>{
 const f=fixture(),progress=[];const result=f.context.enableDevicePush(f.rpc,x=>progress.push(x));assert.equal(f.asks,1);await result;assert.deepEqual(f.calls,['key','subscribe']);assert.equal(f.subscribes,1);assert.ok(progress.some(x=>x.includes('登録')));
});
test('service worker never becoming ready times out and restores the button',async()=>{
 const f=fixture({ready:new Promise(()=>{})});f.context.mountPushNotifications({request:f.rpc,allowed:()=>true});
 const attempt=f.nodes['#pushEnable'].onclick();await flush();assert.equal(f.nodes['#pushEnable'].disabled,true);f.expire(12000);await attempt;
 assert.equal(f.nodes['#pushEnable'].disabled,false);assert.match(f.nodes['#pushStatus'].textContent,/開き直して/);assert.equal(f.subscribes,0);
});
test('network timeout can be retried; no permanent busy state remains',async()=>{
 let blocked=true;const f=fixture({permission:'granted',request:p=>blocked?new Promise(()=>{}):p.action==='key'?{publicKey:'AQ',keyId:'one'}:{enabled:true}});
 f.context.mountPushNotifications({request:f.rpc,allowed:()=>true});let attempt=f.nodes['#pushEnable'].onclick();await flush();f.expire(12000);await attempt;assert.equal(f.nodes['#pushEnable'].disabled,false);
 blocked=false;await f.nodes['#pushEnable'].onclick();assert.match(f.nodes['#pushStatus'].textContent,/有効にしました/);
});
test('existing enabled subscription is kept and server failure cleans up a new subscription',async()=>{
 const sub={endpoint:'existing'};const existing=fixture({permission:'granted',subscription:sub});await existing.context.enableDevicePush(existing.rpc);assert.equal(existing.subscribes,0);assert.deepEqual(existing.calls,['status']);
 const failed=fixture({permission:'granted',request:p=>p.action==='key'?{publicKey:'AQ',keyId:'one'}:Promise.reject(Error('save failed'))});await assert.rejects(failed.context.enableDevicePush(failed.rpc),/save failed/);assert.equal(failed.removed,1);
});
test('denied permission gives instructions without reopening the prompt',async()=>{
 const f=fixture({permission:'denied'});await assert.rejects(f.context.enableDevicePush(f.rpc),/端末の設定/);assert.equal(f.asks,0);assert.equal(f.calls.length,0);
});
test('timed-out subscribe is reused on retry instead of creating duplicates',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const f=fixture({permission:'granted',subscribe:()=>pending});
 const first=f.context.enableDevicePush(f.rpc);await flush();f.expire(20000);await assert.rejects(first,/時間がかかっています/);
 const second=f.context.enableDevicePush(f.rpc);await flush();assert.equal(f.subscribes,1);resolve(f.sub);await second;assert.equal(f.subscribes,1);
});
test('onboarding recovers after loading failure and waits for a new tap before asking permission',async()=>{
 const app=fs.readFileSync(new URL('../ikigai-production/app.js',import.meta.url),'utf8');const start=app.indexOf('obPushEnabled=false;let pushAttempt'),end=app.indexOf('\n    }\n\n    if(obStep===3)',start);
 let loads=0,enables=0;const nodes={'#obPushEnable':{disabled:true,isConnected:true,textContent:'携帯の通知を許可する'},'#obComplete':{disabled:true},'#obPushStatus':{}};
 const c={uid:'one',obStep:4,obPushEnabled:false,$:s=>nodes[s],window:{appAuth:{push:()=>{}}},Promise,setTimeout,clearTimeout,loadFixture:()=>++loads===1?Promise.reject(Error('offline')):Promise.resolve({enableDevicePush:async()=>{enables++},devicePushEnabled:async()=>false})};
 vm.createContext(c);vm.runInContext(app.slice(start,end).replaceAll("import('./push-notifications.js')",'loadFixture()'),c);await flush();
 assert.equal(nodes['#obPushEnable'].disabled,false);assert.match(nodes['#obPushStatus'].textContent,/再読み込み/);
 await nodes['#obPushEnable'].onclick();assert.equal(enables,0);assert.match(nodes['#obPushStatus'].textContent,/もう一度/);
 await nodes['#obPushEnable'].onclick();assert.equal(enables,1);assert.equal(nodes['#obComplete'].disabled,false);
});

test('installation guide comes before personal details and supports going back without losing fields',()=>{
 const app=fs.readFileSync(new URL('../ikigai-production/app.js',import.meta.url),'utf8');
 const start=app.indexOf('function renderOnboard(){'),end=app.indexOf("\n  $('#obForm').addEventListener('submit'",start);
 const nodes={'#obForm':{innerHTML:''},'#obCopyAppUrl':{},'#obInstallStatus':{isConnected:true}};
 const spans=Array.from({length:6},()=>({classList:{toggle(){}}}));
 const c={obStep:-1,ob:{name:'入力済み',greeting:'こんにちは'},OB_STEPS:5,navigator:{standalone:false,clipboard:{writeText:async()=>{}}},matchMedia:()=>({matches:false}),document:{querySelectorAll:()=>spans,querySelector:()=>null},window:{scrollTo(){}},$:s=>nodes[s]||null,esc:s=>s,readOnboard(){},paintAvatar(){}};
 vm.createContext(c);vm.runInContext(app.slice(start,end),c);c.renderOnboard();
 assert.match(nodes['#obForm'].innerHTML,/STEP 1 \/ 6/);assert.match(nodes['#obForm'].innerHTML,/共有/);assert.match(nodes['#obForm'].innerHTML,/ホーム画面に追加/);assert.doesNotMatch(nodes['#obForm'].innerHTML,/id="obName"/);
 nodes['#obBack']={};c.obStep=0;c.renderOnboard();assert.match(nodes['#obForm'].innerHTML,/STEP 2 \/ 6/);assert.match(nodes['#obForm'].innerHTML,/入力済み/);
 nodes['#obBack'].onclick();assert.equal(c.obStep,-1);assert.match(nodes['#obForm'].innerHTML,/共有/);assert.equal(c.ob.name,'入力済み');
});
