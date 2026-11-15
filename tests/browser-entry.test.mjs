import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountBrowserEntry,openLineLoginInBrowser,consumeBrowserLogin} from '../ikigai-production/browser-entry.js';
function fixture({ua='iPhone Line/15.20.0',installed=false,native=true,fails=false}={}){
 const calls=[],copied=[];let mounted=false;
 const document={querySelector(selector){return selector==='#v-home'?{prepend(){mounted=true}}:null},createElement(){return {style:{},children:[],append(...children){this.children.push(...children)},setAttribute(){}}}};
 const window={matchMedia:()=>({matches:installed}),location:{href:'https://ikigai-shidoroku.pages.dev/?code=secret#access_token=secret',assign:url=>calls.push({url})}};
 const navigator={userAgent:ua,clipboard:{writeText:async text=>copied.push(text)}};
 const ui=mountBrowserEntry({document,window,navigator,loadSdk:async()=>{if(fails)throw Error('private internal error');return {isInClient:()=>native,openWindow:args=>calls.push(args)}}});
 return {ui,calls,copied,get mounted(){return mounted}};
}
test('a LINE user opens the public app in an external browser without forwarding any auth parameters',async()=>{
 const f=fixture();assert.ok(f.mounted);await f.ui.button.onclick();
 assert.deepEqual(f.calls,[{url:'https://ikigai-shidoroku.pages.dev/',external:true}]);
 assert.doesNotMatch(JSON.stringify(f.calls),/secret|access_token|code=/);assert.match(f.ui.status.textContent,/ホーム画面に追加/);
});
test('ordinary LINE in-app browser uses the documented external-browser flag',async()=>{
 const f=fixture({native:false});await f.ui.button.onclick();assert.deepEqual(f.calls,[{url:'https://ikigai-shidoroku.pages.dev/?openExternalBrowser=1'}]);
});
test('installed apps and external browsers do not display a redundant install prompt',()=>{
 assert.equal(fixture({installed:true}).ui,undefined);assert.equal(fixture({ua:'iPhone Safari/605.1'}).ui,undefined);
});
test('SDK failures keep the app usable and offer a copyable, token-free fallback',async()=>{
 const f=fixture({fails:true});await f.ui.button.onclick();assert.equal(f.calls.length,0);assert.equal(f.ui.button.disabled,false);assert.equal(f.ui.fallback.hidden,false);assert.doesNotMatch(f.ui.status.textContent,/private/);
 await f.ui.fallback.onclick();assert.deepEqual(f.copied,['https://ikigai-shidoroku.pages.dev/']);
});
test('LINE login moves a clean intent to the default browser before OAuth starts',async()=>{
 for(const native of [true,false]){
  const calls=[];
  await openLineLoginInBrowser({document:{},window:{location:{assign:url=>calls.push({url})}},loadSdk:async()=>({isInClient:()=>native,openWindow:args=>calls.push(args)})});
  assert.deepEqual(calls,[native?{url:'https://ikigai-shidoroku.pages.dev/?login=line',external:true}:{url:'https://ikigai-shidoroku.pages.dev/?login=line&openExternalBrowser=1'}]);
 }
});
test('browser login intent is consumed once without removing an unrelated auth callback',()=>{
 const history={state:{page:'login'},replaceState(state,title,path){this.path=path}};
 assert.equal(consumeBrowserLogin({href:'https://app.example/?login=line&openExternalBrowser=1&code=callback#keep'},history),true);
 assert.equal(history.path,'/?code=callback#keep');
 assert.equal(consumeBrowserLogin({href:'https://app.example'+history.path},history),false);
});
