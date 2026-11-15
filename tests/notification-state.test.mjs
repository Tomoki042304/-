import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createNotificationState,threadNoticeVersion} from '../ikigai-production/notification-state.js';
const at=n=>new Date(1700000000000+n).toISOString();
function fixture(initial={}){let seen=initial,changes=0;const state=createNotificationState({getSeen:()=>seen,onSeen:next=>seen=next,onChange:()=>changes++});return {state,seen:()=>seen,changes:()=>changes}}
const item=(id,target='timeline',n=1)=>({id,target,version:at(n),at:at(n),kind:'log',title:id});
test('bell and matching tabs derive their dots from one unread set',()=>{
 const {state}=fixture();state.publish('posts',[item('post')]);state.publish('talk',[{...item('room','mates'),kind:'talk',threadId:'thread'}]);
 assert.equal(state.unread().length,2);assert.deepEqual(new Set(state.unread().map(row=>row.target)),new Set(['timeline','mates']));
 state.readTarget('timeline');assert.deepEqual(state.unread().map(row=>row.target),['mates']);
 state.acknowledge();assert.equal(state.unread().length,0);
});
test('confirming the bell persists acknowledgement across rerender and reload; new versions relight it',()=>{
 const f=fixture(),row=item('room','mates');f.state.publish('direct',[row]);f.state.acknowledge();
 f.state.publish('direct',[{...row,open(){}}]);assert.equal(f.state.unread().length,0);
 const reload=fixture(f.seen());reload.state.publish('direct',[row]);assert.equal(reload.state.unread().length,0);
 reload.state.publish('direct',[{...row,version:at(2),at:at(2)}]);assert.equal(reload.state.unread().length,1);
});
test('an acknowledgement from an old render cannot clear an update that arrived afterwards',()=>{
 const {state}=fixture();state.publish('posts',[item('post')]);const rendered=state.all();state.publish('posts',[item('post','timeline',2)]);state.acknowledge(rendered);assert.equal(state.unread().length,1);
});
test('destination read acknowledgements match type, conversation and time without clearing other tabs',()=>{
 const {state}=fixture();state.publish('talk',[
  {...item('a','mates'),kind:'talk',threadId:'a'},
  {...item('reaction','mates'),kind:'reaction',threadId:'a'},
  {...item('b','mates'),kind:'talk',threadId:'b'},
  {...item('later','mates',3),kind:'talk',threadId:'a'}]);
 state.publish('posts',[item('post')]);
 state.read({threadId:'a',kinds:['talk'],before:Date.parse(at(2))});assert.deepEqual(state.unread().map(row=>row.id),['reaction','b','later','post']);
 state.readTarget('mates');assert.deepEqual(state.unread().map(row=>row.id),['post']);
});
test('changing owner starts with that owner receipts and has no old account records',()=>{
 let owner='a';const receipts={a:{},b:{}},state=createNotificationState({getSeen:()=>receipts[owner],onSeen:seen=>receipts[owner]=seen});state.publish('direct',[item('thread','mates')]);state.acknowledge();state.clear();owner='b';assert.equal(state.all().length,0);state.publish('direct',[item('thread','mates')]);assert.equal(state.unread().length,1);
});
test('stable incoming message IDs do not relight a thread due to own-message or ordering changes',()=>{
 const thread={updatedAt:at(1),incomingIds:['b','a']};assert.equal(threadNoticeVersion(thread),threadNoticeVersion({...thread,updatedAt:at(2),incomingIds:['a','b']}));assert.notEqual(threadNoticeVersion(thread),threadNoticeVersion({...thread,incomingIds:['a','b','c']}));
});
test('unchanged data and duplicate acknowledgements do not keep scheduling renders or profile writes',()=>{
 const f=fixture();f.state.publish('posts',[item('post')]);const before=f.changes();f.state.publish('posts',[item('post')]);assert.equal(f.changes(),before);f.state.acknowledge();const acknowledged=f.changes();f.state.acknowledge();assert.equal(f.changes(),acknowledged);
});
test('a large current inbox does not resurrect old red dots when acknowledgements are pruned',()=>{
 const f=fixture();f.state.publish('posts',Array.from({length:1100},(_,i)=>item('post'+i)));f.state.acknowledge();assert.equal(f.state.unread().length,0);assert.equal(Object.keys(f.seen()).length,1100);
});
test('the actual bell and tab renderer clears both dots from either acknowledgement path',async()=>{
 const {state}=fixture(),nodes=new Map(),buttons=new Map();
 const element=()=>({hidden:true,attributes:{},setAttribute(key,value){this.attributes[key]=value}});
 for(const id of ['app','bellBtn','reactionDot','growthLogTabDot','dmTabDot','homeLogNew'])nodes.set('#'+id,element());nodes.get('#app').hidden=false;
 for(const target of ['home','timeline','mates','account'])buttons.set(target,{prepend(dot){nodes.set('#'+dot.id,dot)}});
 const document={createElement:element,querySelector:selector=>buttons.get(/data-tab="(.*?)"/.exec(selector)?.[1])};
 const context=vm.createContext({document,uiNotices:state,backend:'cloud',uid:'user',$:selector=>nodes.get(selector)});
 const source=await readFile(new URL('../ikigai-production/app.js',import.meta.url),'utf8'),start=source.indexOf('  function paintNotificationDots(){'),end=source.indexOf('  function renderUiNoticeRows(){',start);vm.runInContext(source.slice(start,end),context);
 state.publish('posts',[item('post')]);context.paintNotificationDots();assert.equal(nodes.get('#reactionDot').hidden,false);assert.equal(nodes.get('#growthLogTabDot').hidden,false);assert.equal(nodes.get('#dmTabDot').hidden,true);
 state.readTarget('timeline');context.paintNotificationDots();assert.equal(nodes.get('#reactionDot').hidden,true);assert.equal(nodes.get('#growthLogTabDot').hidden,true);
 state.publish('direct',[item('thread','mates')]);context.paintNotificationDots();assert.equal(nodes.get('#reactionDot').hidden,false);assert.equal(nodes.get('#dmTabDot').hidden,false);
 state.acknowledge();context.paintNotificationDots();assert.equal(nodes.get('#reactionDot').hidden,true);assert.equal(nodes.get('#dmTabDot').hidden,true);
});
