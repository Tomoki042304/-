import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHomeLineResume} from '../ikigai-production/home-session.js';
function fixture(overrides={}){
 const rows=new Map(),tasks=[];let resumes=0;
 const storage={getItem:k=>rows.get(k)||null,setItem:(k,v)=>rows.set(k,v)};
 const options={enabled:true,standalone:true,callback:false,storage,onResume:()=>resumes++,schedule:fn=>tasks.push(fn),...overrides};
 return {control:createHomeLineResume(options),options,rows,get resumes(){return resumes},run(){while(tasks.length)tasks.shift()()}};
}
test('fresh installed app resumes the same LINE provider once, after config and initial session checks',()=>{
 for(const order of ['ready-first','session-first']){
  const f=fixture();if(order==='ready-first'){f.control.ready();f.control.auth('INITIAL_SESSION',null)}else{f.control.auth('INITIAL_SESSION',null);f.control.ready()}
  assert.equal(f.resumes,0);f.run();assert.equal(f.resumes,1);f.control.ready();f.control.auth('INITIAL_SESSION',null);f.run();assert.equal(f.resumes,1);
 }
});
test('a stored session keeps its account without starting another OAuth flow',()=>{
 const f=fixture();f.control.ready();f.control.auth('INITIAL_SESSION',{user:{id:'existing-account'}});f.run();assert.equal(f.resumes,0);
 const again=fixture({storage:f.options.storage});again.control.ready();again.control.auth('INITIAL_SESSION',null);again.run();assert.equal(again.resumes,0);
});
test('callback errors, regular browsers, and non-LINE deployments never auto-redirect',()=>{
 for(const options of [{callback:true},{standalone:false},{enabled:false}]){
  const f=fixture(options);f.control.ready();f.control.auth('INITIAL_SESSION',null);f.run();assert.equal(f.resumes,0);
 }
});
test('sign-out and password recovery cancel even an already queued resume',()=>{
 for(const event of ['SIGNED_OUT','PASSWORD_RECOVERY']){
  const f=fixture();f.control.ready();f.control.auth('INITIAL_SESSION',null);f.control.auth(event,null);f.run();assert.equal(f.resumes,0);
 }
});
test('failed or interrupted OAuth is not looped on reload, and blocked storage falls back to manual login',()=>{
 const f=fixture();f.control.auth('INITIAL_SESSION',null);f.control.ready();f.run();assert.equal(f.resumes,1);
 const reload=fixture({storage:f.options.storage});reload.control.auth('INITIAL_SESSION',null);reload.control.ready();reload.run();assert.equal(reload.resumes,0);
 const denied=fixture({storage:{getItem(){throw Error()},setItem(){throw Error()}}});denied.control.ready();denied.control.auth('INITIAL_SESSION',null);denied.run();assert.equal(denied.resumes,0);
});
test('resume marker contains no account data, sessions or tokens',()=>{
 const f=fixture();f.control.ready();f.control.auth('INITIAL_SESSION',null);f.run();assert.deepEqual([...f.rows.values()],['started']);
 const session=fixture();session.control.auth('INITIAL_SESSION',{access_token:'secret',user:{id:'private'}});assert.deepEqual([...session.rows.values()],['done']);
});
