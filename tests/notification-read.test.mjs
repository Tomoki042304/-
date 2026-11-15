import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {mountAnnouncements} from '../ikigai-production/announcements.js';
const source=await readFile(new URL('../ikigai-production/sw.js',import.meta.url),'utf8');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const threadA=uid+':'+other,threadB=uid+':33333333-3333-4333-8333-333333333333';
const now=Date.parse('2026-11-15T10:00:00Z'),at=n=>new Date(now+n).toISOString();
function worker(){
 let saved,badge=0;const listeners=new Map(),notifications=[],navigations=[];
 const database={createObjectStore(){},transaction(){
  const tx={objectStore(){return {get(){const read={};queueMicrotask(()=>{read.result=structuredClone(saved);read.onsuccess()});return read},put(value){saved=structuredClone(value);queueMicrotask(()=>tx.oncomplete())}}}};return tx;
 }};
 const indexedDB={open(){const open={result:database};queueMicrotask(()=>{open.onupgradeneeded();open.onsuccess()});return open}};
 const self={location:{origin:'https://example.test'},registration:{scope:'https://example.test/',async getNotifications(){return notifications.filter(n=>!n.closed)},async showNotification(title,options){notifications.push({...options,title,closed:false,close(){this.closed=true}})}},clients:{async matchAll(){return [{url:'https://example.test/',async focus(){},postMessage(message){navigations.push(message)}}]},async openWindow(url){navigations.push(url)}},addEventListener(name,callback){if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback)}};
 const context=vm.createContext({self,indexedDB,URL,Date,navigator:{async setAppBadge(count){badge=count},async clearAppBadge(){badge=0}}});
 vm.runInContext(source,context);
 async function dispatch(name,event){const pending=[];event.waitUntil=promise=>pending.push(promise);for(const callback of listeners.get(name)||[])callback(event);await Promise.all(pending)}
 const message=(data,origin='https://example.test')=>dispatch('message',{data,source:{url:origin+'/'}});
 return {notifications,navigations,state:()=>saved,badge:()=>badge,
  bind:()=>message({type:'ikigai-badge-account',account:uid}),
  push:(tag,data={})=>dispatch('push',{data:{json:()=>({tag,title:'IKIGAI',data:{account:uid,eventAt:at(-1000),kind:'talk',...data}})}}),
  read:(scope,before=now,account=uid,origin)=>message({type:'ikigai-badge-read',account,scope,before},origin),
  click:notification=>dispatch('notificationclick',{notification})};
}
test('tapping a push navigates but leaves the unread badge until its page reports a read',async()=>{
 const w=worker();await w.bind();await w.push('a',{threadId:threadA});await w.push('b',{threadId:threadB});
 assert.equal(w.badge(),2);await w.click(w.notifications[0]);assert.equal(w.badge(),2);
 assert.equal(w.navigations.at(-1).threadId,threadA);
 await w.read({threadId:threadA,kinds:['talk']});assert.equal(w.badge(),1);assert.deepEqual(w.state().items.map(x=>x.key),['b']);assert.equal(w.notifications[1].closed,false);
});
test('reading one conversation closes only its matching displayed notifications',async()=>{
 const w=worker();await w.bind();await w.push('a',{threadId:threadA});await w.push('b',{threadId:threadB});await w.push('post',{kind:'comment',postKey:'post'});
 await w.read({threadId:threadA});assert.equal(w.badge(),2);assert.deepEqual(w.notifications.map(n=>n.closed),[true,false,false]);
 await w.read({postKey:'post'});assert.equal(w.badge(),1);assert.equal(w.notifications[2].closed,true);
});
test('message reads preserve reactions and unrelated conversations, including delayed pushes',async()=>{
 const w=worker();await w.bind();await w.push('a',{threadId:threadA});await w.push('reaction',{threadId:threadA,kind:'reaction'});
 await w.read({threadId:threadA,kinds:['talk']});assert.deepEqual(w.state().items.map(x=>x.key),['reaction']);
 await w.push('late-other',{threadId:threadB});await w.push('late-reaction',{threadId:threadA,kind:'reaction'});await w.push('late-read',{threadId:threadA});
 assert.deepEqual(w.state().items.map(x=>x.key),['reaction','late-other','late-reaction']);
 await w.read({threadId:threadA,kinds:['reaction']});assert.deepEqual(w.state().items.map(x=>x.key),['late-other']);
});
test('newer notifications survive a read cutoff and older delayed events do not restore the badge',async()=>{
 const w=worker();await w.bind();await w.push('old',{threadId:threadA,eventAt:at(-2000)});await w.push('new',{threadId:threadA,eventAt:at(-500)});
 await w.read({threadId:threadA},now-1000);assert.deepEqual(w.state().items.map(x=>x.key),['new']);assert.equal(w.notifications[1].closed,false);
 await w.push('late-old',{threadId:threadA,eventAt:at(-2000)});assert.equal(w.badge(),1);
});
test('another account or origin cannot clear this account notifications',async()=>{
 const w=worker();await w.bind();await w.push('a',{threadId:threadA});
 await w.read({all:true},now,other);await w.read({all:true},now,uid,'https://unrelated.test');assert.equal(w.badge(),1);assert.equal(w.notifications[0].closed,false);
});
test('announcement and public-talk reads do not clear other destinations',async()=>{
 const w=worker();await w.bind();await w.push('a',{kind:'announcement',announcementId:other});await w.push('b',{kind:'announcement',announcementId:uid});await w.push('public',{publicTalk:true});await w.push('dm',{threadId:threadA});
 await w.read({announcementId:other});await w.read({publicTalk:true,kinds:['talk']});assert.deepEqual(w.state().items.map(x=>x.key),['b','dm']);
});

const directSource=await readFile(new URL('../ikigai-production/direct-messages.js',import.meta.url),'utf8');
function conversation(request){
 const events=[],state={visible:true,active:threadA,token:1};
 const context=vm.createContext({Map,Set,Date,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},window:{dispatchEvent:event=>events.push(event)},readOnly:false,visible:()=>state.visible,account:()=>uid,messages:[{id:'m1',senderUid:other,at:at(-1000)}],localReads:new Map(),request,renderInbox(){},$:()=>({hidden:false})});
 Object.defineProperty(context,'active',{get:()=>state.active});Object.defineProperty(context,'convToken',{get:()=>state.token});
 const start=directSource.indexOf('  async function markRead(token)'),end=directSource.indexOf('  async function refreshMessages',start);
 vm.runInContext(directSource.slice(start,end),context);
 return {events,state,read:()=>context.markRead(1)};
}
test('a successfully loaded conversation marks only the messages actually read',async()=>{
 const c=conversation(async()=>({}));await c.read();assert.equal(c.events.length,1);assert.equal(c.events[0].detail.threadId,threadA);assert.equal(c.events[0].detail.before,now-1000);
});
test('read failures and leaving a conversation during the request never acknowledge its notifications',async()=>{
 const failed=conversation(async()=>{throw Error('offline')});await failed.read();assert.equal(failed.events.length,0);
 let resolve;const c=conversation(()=>new Promise(done=>resolve=done));const pending=c.read();c.state.active=threadB;resolve({});await pending;assert.equal(c.events.length,0);
 const hidden=conversation(async()=>({}));hidden.state.visible=false;await hidden.read();assert.equal(hidden.events.length,0);
});

const appSource=await readFile(new URL('../ikigai-production/app.js',import.meta.url),'utf8');
test('opening the bell list does not mark reactions or other pages as read',async()=>{
 const events=[],profile={seenReactionNotifications:[]},box={querySelectorAll:()=>[],append(){}},dialog={open:false,showModal(){this.open=true}};
 let saves=0;
 const context=vm.createContext({Date,uid,notificationSinceAccount:uid,notificationSince:0,backend:'cloud',growthPending:()=>false,profile,
  renderUiNoticeRows(){},paintNotificationDots(){},uiNotices:{acknowledge(){}},reactionEvents:()=>[{id:'r1',kind:'like',key:'post',text:'reaction',at:at(-1000)}],
  document:{createElement:()=>({dataset:{},append(){}})},$:selector=>selector==='#notificationsDialog'?dialog:box,
  window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.detail=options.detail}},
  postTimeText:()=>'',sortNotificationRows(){},ensureAnnouncements:async()=>({open(){}}),saveProfile(){saves++},renderReactionNotice(){},toast(){},loadNotificationSince(){},openHomeLog(){},openCmts:new Set()});
 const start=appSource.indexOf('  function openReactionNotices(){'),end=appSource.indexOf("  $('#notificationsClose')",start);
 vm.runInContext(appSource.slice(start,end),context);context.openReactionNotices();await Promise.resolve();
 assert.equal(dialog.open,true);assert.equal(events.length,0);assert.equal(saves,0);assert.deepEqual(profile.seenReactionNotifications,[]);
});
test('only rendered, on-screen posts acknowledge their reactions; background/error views do not',()=>{
 const events=[],profile={seenReactionNotifications:[]},state={visible:true,error:false,timeline:true};let saves=0,logReads=0;
 const posts=[{dataset:{postKey:'visible'},shown:true},{dataset:{postKey:'below'},shown:false}].map(post=>({...post,getClientRects:()=>[{}],getBoundingClientRect:()=>({top:post.shown?10:1000,bottom:post.shown?200:1200,left:0,right:300})}));
 const document={get visibilityState(){return state.visible?'visible':'hidden'},querySelectorAll:()=>posts,addEventListener(){}};
 const context=vm.createContext({uiNotices:{readTarget(){}},chatReady:false,chatLoadFailed:false,talkIntroduced:false,Set,Date,Math,innerHeight:800,innerWidth:400,document,backend:'cloud',uid,growthPending:()=>false,feedReady:true,profile,feedAll:[{key:'visible',at:at(-2000)},{key:'below',at:at(-2000)}],homeLogKey:row=>row.key,
  $:selector=>({hidden:selector.startsWith('#v-')&&(selector!=='#v-timeline'||!state.timeline)}),
  reactionEvents:()=>[{id:'visible-reaction',key:'visible',at:at(-1000)},{id:'unseen-reaction',key:'below',at:at(-1000)}],
  markGrowthLogsSeen(){logReads++},saveProfile(){saves++},renderReactionNotice(){},addEventListener(){},clearTimeout(){},setTimeout(){},
  window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,options){this.detail=options.detail}}});
 Object.defineProperty(context,'homeLogError',{get:()=>state.error});
 const start=appSource.indexOf('  const onScreen='),end=appSource.indexOf('  const selectedPostCategories=',start);
 vm.runInContext(appSource.slice(start,end),context);
 state.visible=false;context.readVisibleNotifications();state.visible=true;state.error=true;context.readVisibleNotifications();assert.equal(events.length,0);assert.equal(logReads,0);
 state.error=false;context.readVisibleNotifications();assert.deepEqual(Array.from(profile.seenReactionNotifications),['visible-reaction']);assert.equal(saves,1);assert.equal(logReads,1);assert.deepEqual(events.map(e=>e.detail.postKey),['visible']);
});

test('announcement deep links open the requested body; reading it keeps its text visible',async()=>{
 class Element{
  constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.events={};this.className='';this.open=false;this.hidden=false;this.value=''}
  get isConnected(){return this.root||!!this.parent?.isConnected}
  append(...children){for(const child of children){child.parent=this;this.children.push(child)}}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children)}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null}}
  setAttribute(){}
  addEventListener(name,callback){this.events[name]=callback}
  matches(selector){return selector.startsWith('.')?this.className.split(' ').includes(selector.slice(1)):selector==='details[open]'?this.tag==='details'&&this.open:selector===this.tag}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)])}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 }
 const oldDocument=globalThis.document,oldWindow=globalThis.window,oldEvent=globalThis.CustomEvent;
 const nodes=new Map(),seen=new Set(),events=[];let ui;
 const node=id=>{if(!nodes.has(id)){const element=new Element();element.root=true;nodes.set(id,element)}return nodes.get(id)};
 node('#notificationsDialog').open=true;node('#v-home').hidden=false;
 const document={visibilityState:'visible',querySelector:node,createElement:tag=>new Element(tag),addEventListener(){}};
 globalThis.document=document;globalThis.window={addEventListener(){},dispatchEvent:event=>events.push(event)};globalThis.CustomEvent=class{constructor(type,options){this.detail=options.detail}};
 try{
  const rows=[{id:'a',title:'A',text:'Body A',at:at(-2000)},{id:'b',title:'B',text:'Body B',at:at(-1000)}];
  ui=mountAnnouncements({request:async()=>({announcements:rows}),account:()=>uid,isAdmin:()=>false,getSeen:()=>[...seen],markSeen:id=>seen.add(id),onChange(){},notificationAllowed:()=>true});
  ui.open('b');await new Promise(resolve=>setImmediate(resolve));
  const list=node('#notificationList'),details=list.querySelectorAll('.announcement-item');
  assert.equal(details.find(el=>el.dataset.id==='a').open,false);const selected=details.find(el=>el.dataset.id==='b');assert.equal(selected.open,true);assert.equal(seen.size,0);
  selected.events.toggle();assert.deepEqual([...seen],['b']);assert.equal(events.at(-1).detail.announcementId,'b');
  const acknowledged=events.length;selected.events.toggle();assert.equal(events.length,acknowledged+1);assert.equal(events.at(-1).detail.announcementId,'b');
  const home=node('#homeAnnouncementsList'),homeA=home.querySelectorAll('details').find(el=>el.dataset.id==='a');homeA.open=true;homeA.events.toggle();
  assert.deepEqual([...seen].sort(),['a','b']);const retained=home.querySelectorAll('details').find(el=>el.dataset.id==='a');assert.equal(retained.open,true);assert.equal(retained.children.some(child=>child.textContent==='Body A'),true);
 }finally{ui?.stop();globalThis.document=oldDocument;globalThis.window=oldWindow;globalThis.CustomEvent=oldEvent}
});
