import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createNotificationState,notificationReadScope,canReconcileEmptyBadge} from '../ikigai-production/notification-state.js';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const before=Date.now()-1000;
const source=await readFile(new URL('../ikigai-production/app-badge.js',import.meta.url),'utf8');
function bridge(){
 const posts=[],listeners=new Map(),workerListeners=new Map(),documentListeners=new Map();let visible=true;
 const context=vm.createContext({Date,document:{get visibilityState(){return visible?'visible':'hidden'},addEventListener:(name,cb)=>documentListeners.set(name,cb)},window:{addEventListener:(name,cb)=>listeners.set(name,cb)},navigator:{serviceWorker:{ready:Promise.resolve({active:{postMessage:message=>posts.push(message)}}),addEventListener:(name,cb)=>workerListeners.set(name,cb)}}});
 vm.runInContext(source.replaceAll('export ',''),context);
 const flush=async()=>{await Promise.resolve();await Promise.resolve()};
 return {posts,setVisible:value=>visible=value,async bind(id=uid){context.setBadgeAccount(id);await flush()},async send(name,detail){listeners.get(name)?.({detail});await flush()},async activate(){workerListeners.get('controllerchange')?.();await flush()},async resume(){documentListeners.get('visibilitychange')?.();await flush()}};
}
test('confirming an in-app notification forwards its exact target and timestamp to the native badge',async()=>{
 const b=bridge();await b.bind();let seen={};const state=createNotificationState({getSeen:()=>seen,onSeen:(next,rows)=>{seen=next;for(const row of rows)void b.send('ikigai-notification-ui-read',notificationReadScope(row))}});
 state.publish('direct',[{id:'thread',version:'v1',at:new Date(before).toISOString(),target:'mates',kind:'talk',threadId:'thread'}]);state.acknowledge();await Promise.resolve();
 const message=b.posts.find(post=>post.type==='ikigai-badge-read');assert.equal(message.account,uid);assert.equal(message.scope.threadId,'thread');assert.deepEqual(Array.from(message.scope.kinds),['talk']);assert.ok(message.before>=before&&message.before<=Date.now());
});
test('zero shown during loading, failed sources or genuine unread records is not sufficient to clear the badge',()=>{
 const ready={growth:true,reactions:true,announcements:true,publicTalk:true,direct:true,groups:true};
 const input={unread:0,ready,community:true,talkReady:true,introduced:true,isAdmin:false};
 assert.equal(canReconcileEmptyBadge(input),true);
 for(const missing of Object.keys(ready))assert.equal(canReconcileEmptyBadge({...input,ready:{...ready,[missing]:false}}),false);
 assert.equal(canReconcileEmptyBadge({...input,unread:1}),false);assert.equal(canReconcileEmptyBadge({...input,talkReady:false}),false);
 assert.equal(canReconcileEmptyBadge({...input,community:false,ready:{growth:true,reactions:true}}),true);
});
test('an authenticated, visible, fully loaded empty inbox sends a cutoff-based reconciliation once',async()=>{
 const b=bridge();await b.bind();const detail={account:uid,ready:true,unread:0,before};
 await b.send('ikigai-notification-reconcile',detail);await b.send('ikigai-notification-reconcile',detail);
 const messages=b.posts.filter(post=>post.type==='ikigai-badge-reconcile');assert.equal(messages.length,1);assert.equal(messages[0].account,uid);assert.equal(messages[0].before,before);
});
test('mismatched owners, background pages, loading states and positive counts never reconcile to zero',async()=>{
 const b=bridge();await b.bind();const detail={account:uid,ready:true,unread:0,before};
 for(const update of [{account:other},{ready:false},{unread:1},{before:Date.now()+100000}])await b.send('ikigai-notification-reconcile',{...detail,...update});
 b.setVisible(false);await b.send('ikigai-notification-reconcile',detail);assert.equal(b.posts.some(post=>post.type==='ikigai-badge-reconcile'),false);
});
test('worker activation replays reconciliation, but switching owner removes the old request',async()=>{
 const b=bridge();await b.bind();await b.send('ikigai-notification-reconcile',{account:uid,ready:true,unread:0,before});await b.activate();assert.equal(b.posts.filter(post=>post.type==='ikigai-badge-reconcile').length,2);
 await b.bind(other);await b.activate();assert.equal(b.posts.filter(post=>post.type==='ikigai-badge-reconcile').length,2);
});
test('non-push admin notices and invalid event times cannot trigger a native clear',()=>{
 assert.equal(notificationReadScope({kind:'admin',at:new Date(before).toISOString()}),null);assert.equal(notificationReadScope({kind:'talk',at:'invalid'}),null);
});
test('UI confirmation includes the delivery-job timestamp while retaining a fixed confirmation cutoff',()=>{
 const scope=notificationReadScope({kind:'like',postKey:'post',at:new Date(before).toISOString()},before+100);
 assert.equal(scope.before,before+100);assert.equal(scope.postKey,'post');assert.deepEqual(scope.kinds,['like']);
});
