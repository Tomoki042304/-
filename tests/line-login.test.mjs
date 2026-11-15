import {test} from 'node:test';
import assert from 'node:assert/strict';
import {oauthTarget,LINE_PROVIDER,mountLineLogin,lineReturnMessage} from '../ikigai-production/line-login.js';
import {onRequest} from '../functions/api/line-login-config.js';
const origin='https://example.supabase.co';
test('OAuth redirects only to this Supabase project and the selected provider',()=>{
 const good=origin+'/auth/v1/authorize?provider=custom%3Aline&state=opaque';
 assert.equal(oauthTarget(good,origin,LINE_PROVIDER),good);
 for(const target of ['https://evil.example/auth/v1/authorize?provider=custom:line',origin+'/elsewhere?provider=custom:line',origin+'/auth/v1/authorize?provider=github','https://user:password@example.supabase.co/auth/v1/authorize?provider=custom:line'])assert.throws(()=>oauthTarget(target,origin,LINE_PROVIDER));
});
function fakeDocument(){
 const document={nodes:[],createElement(){const element={hidden:false,children:[],style:{},append(...children){this.children.push(...children)},setAttribute(){}};document.nodes.push(element);return element},querySelector(){return {before(root){document.root=root}}}};
 return document;
}
test('LINE button is offered only after a successful readiness check',async()=>{
 for(const response of [Response.json({enabled:false}),new Response('',{status:503})]){
  const document=fakeDocument();let shown=false;
  const ui=mountLineLogin({document,onLogin(){},onReady(){shown=true},fetchConfig:async()=>response});await ui.ready;
  assert.equal(shown,false);assert.equal(ui.root.hidden,true);
 }
 const document=fakeDocument();let selected;
 const ui=mountLineLogin({document,onLogin:provider=>selected=provider,onReady:root=>root.hidden=false,fetchConfig:async()=>Response.json({enabled:true})});
 await ui.ready;assert.equal(ui.root.hidden,false);ui.button.onclick();assert.equal(selected,LINE_PROVIDER);
 assert.deepEqual(ui.root.children.map(node=>node.textContent).filter(Boolean),['LINEでログイン']);
 assert.equal(document.nodes.some(node=>node.href),false);
 assert.equal(ui.root.children[1].hidden,true);
});
test('LINE callbacks keep normal entry quiet and report real failures without internal details',()=>{
 assert.equal(lineReturnMessage({hasSession:true}), '');
 assert.equal(lineReturnMessage({hasSession:false}), '');
 assert.equal(lineReturnMessage({hasSession:false,error:{message:'No session defined in URL'}}), '');
 for(const state of [{errorCode:'access_denied'},{error:{message:'sensitive SDK detail'}},{hasSession:true,errorCode:'bad_code_verifier'}]){
  assert.equal(lineReturnMessage(state),'ログインできませんでした。もう一度お試しください。');
 }
});
test('configuration failure leaves the LINE option hidden',async()=>{
 const document=fakeDocument();let shown=false;
 const ui=mountLineLogin({document,onLogin(){},onReady(){shown=true},fetchConfig:async()=>{throw Error('offline')}});
 await ui.ready;assert.equal(shown,false);assert.equal(ui.root.hidden,true);
});
test('LINE rollout fails closed until explicitly enabled on the production origin',async()=>{
 const request=new Request('https://ikigai-shidoroku.pages.dev/api/line-login-config');
 for(const env of [{},{IKIGAI_LINE_LOGIN_READY:'false'},{IKIGAI_LINE_LOGIN_READY:'1'}])assert.deepEqual(await (await onRequest({request,env})).json(),{enabled:false});
 const enabled=await onRequest({request,env:{IKIGAI_LINE_LOGIN_READY:'true'}});
 assert.deepEqual(await enabled.json(),{enabled:true});assert.equal(enabled.headers.get('Cache-Control'),'no-store');
 assert.equal((await onRequest({request:new Request('https://preview.pages.dev/api/line-login-config'),env:{IKIGAI_LINE_LOGIN_READY:'true'}})).status,403);
 assert.equal((await onRequest({request:new Request(request,{method:'POST'}),env:{}})).status,405);
});
