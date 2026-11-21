// A real failed HTTP request, then a failed factory, must lead to the existing retryable area screen. The request is the
// park's module: /src/quarry-feature.ts on the dev server, chunks/quarry-feature-<hash>.js in the published build.
import assert from 'node:assert/strict';
import {writeFileSync,createReadStream,statSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
export async function quarryFailure(out,first,root){
let server,origin=first?new URL(first).origin:'http://localhost';
if(root){server=createServer((req,res)=>{try{let path=new URL(req.url,'http://localhost').pathname;if(/^\/(?:mabou|westbay|judique)?$/.test(path))path='/index.html';const file=resolve(root,'.'+path);assert.ok(file.startsWith(resolve(root)+'/'));assert.ok(statSync(file).isFile());res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'})[extname(file)]??'application/octet-stream');createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://localhost:'+server.address().port;}
const tab=await(await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/new?about:blank`,{method:'PUT'})).json();let c,action='network',intercepted=0;
const rows=[],failures=[];
const check=(name,ok)=>{rows.push({name,exit:ok?0:1});console.log(ok?'PASS':'FAIL',name);if(!ok)failures.push(name);};
try{
 c=await cdp(tab.webSocketDebuggerUrl,{onEvent:m=>{if(m.method==='Fetch.requestPaused'){intercepted++;const {requestId}=m.params;void(action==='network'?c.send('Fetch.failRequest',{requestId,errorReason:'Failed'}):c.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from("export function load(){throw Error('injected factory failure')}").toString('base64')}));}}});
 await c.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:false});
 await c.send('Runtime.disable');await c.send('Page.enable');await c.send('Fetch.enable',{patterns:[{urlPattern:'*quarry-feature*',requestStage:'Request'}]});
 const read=async expression=>(await c.send('Runtime.evaluate',{expression,returnByValue:true})).result.result.value;
 for(action of ['network','factory']){
  intercepted=0;const seeded=await c.send('Page.addScriptToEvaluateOnNewDocument',{source:"sessionStorage.setItem('mmm.trip.quarry',JSON.stringify({x:-9966.618346,z:1427.476926,heading:0}));"});await c.send('Page.navigate',{url:origin+'/?trip=quarry&title=1&q=low&radio=0'});
  for(let i=0;i<160;i++){await sleep(250);if(await read("!!document.getElementById('areaMessage')||!!window.mmm"))break;}
  const result=await read("({screen:!!document.getElementById('areaMessage'),retry:[...document.querySelectorAll('#areaMessage button')].some(b=>b.textContent==='Retry'),navigation:document.querySelectorAll('#areaMessage a').length,trip:new URLSearchParams(location.search).has('trip'),hud:!!document.getElementById('tripHud')})");
  const extra=await read("({saved:sessionStorage.getItem('mmm.trip.quarry'),targets:[...document.querySelectorAll('#areaMessage button,#areaMessage a')].map(n=>{const r=n.getBoundingClientRect();return {text:n.textContent,w:r.width,h:r.height,font:getComputedStyle(n).fontSize};}),scroll:(()=>{const r=document.getElementById('areaMessage');r.scrollTop=r.scrollHeight;return r.scrollTop>0&&r.scrollHeight>r.clientHeight;})()})");
  check('P4-D failed '+action+' clears active saved trip',extra.saved===null);
  check('P4-F '+action+' screen touch targets and short-screen scroll',extra.targets.every(n=>n.w>=44&&n.h>=44&&parseFloat(n.font)>=20)&&extra.scroll);
  rows.push({action,intercepted,...result,...extra});console.log(action,JSON.stringify(rows.at(-1)));
  await c.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:seeded.result.identifier});
  assert.ok(intercepted>0,'actual quarry-feature network request was intercepted');assert.ok(result.screen&&result.retry&&result.navigation>0&&!result.trip&&!result.hud,'usable existing area screen, retry, navigation, terminated trip');
  // Retry is an actual click after removing the failed interception, and must start the game.
  await c.send('Fetch.disable');await read("document.querySelector('#areaMessage button').click()");
  let ready=false;for(let i=0;i<1000;i++){await sleep(250);if(await read("document.documentElement.dataset.mmmReady==='true'&&!!document.querySelector('canvas')&&!document.getElementById('areaMessage')")){ready=true;break;}}assert.ok(ready,'actual retry loads West Bay');
  if(!root){await c.send('Page.navigate',{url:origin+'/?trip=quarry&title=1&q=low&radio=0'});let atStart=false,first=null,placed=null;for(let i=0;i<1000;i++){await sleep(250);const state=await read("window.mmm?.journey?({ready:document.documentElement.dataset.mmmReady==='true',spawned:!mmm.fleet||mmm.fleet.spawned,busy:!!mmm.fleet?.busy,distance:Math.hypot(mmm.vehicle.x-mmm.journey.route.start.x,mmm.vehicle.z-mmm.journey.route.start.z),x:mmm.vehicle.x,z:mmm.vehicle.z}):null");if(!state)continue;first??=state;if(!state.ready||!state.spawned||state.busy)continue;placed=state;atStart=state.distance<1;break;}console.log('REOPEN_READY',JSON.stringify({action,first,placed}));check('P4-D reopening trip after actual Retry starts at route start',atStart);}
  await c.send('Fetch.enable',{patterns:[{urlPattern:'*quarry-feature*',requestStage:'Request'}]});
 }
 // The existing, non-park area failure still uses its original message and navigation.
 await c.send('Fetch.disable');action='network';await c.send('Fetch.enable',{patterns:[{urlPattern:'*areas/judique/manifest.json*',requestStage:'Request'}]});
 await c.send('Page.navigate',{url:origin.replace('127.0.0.1','localhost')+'/judique?site=just&title=1&q=low&radio=0'});
 for(let i=0;i<160;i++){await sleep(250);if(await read("!!document.getElementById('areaMessage')"))break;}
 assert.ok(await read("!!document.getElementById('areaMessage')"),'ordinary failed area uses its existing error screen');
 const ordinary=await read("({text:document.querySelector('#areaMessage p')?.textContent,retry:!!document.querySelector('#areaMessage button'),links:[...document.querySelectorAll('#areaMessage a')].map(a=>({text:a.textContent,href:new URL(a.href).pathname,h:a.getBoundingClientRect().height})),scroll:(()=>{const r=document.getElementById('areaMessage');r.scrollTop=r.scrollHeight;return r.scrollTop>0;})()})");
 check('P4-F ordinary failed area retains its message/navigation and scrolls with 44px links',!!ordinary.text&&!ordinary.retry&&ordinary.links.length===6&&ordinary.links.every(a=>a.h>=44)&&ordinary.scroll);rows.push({ordinary});
 await c.send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(out+`/pass4-${root?'published':'dev'}-area-error.png`,Buffer.from(r.result.data,'base64')));
 writeFileSync(out+`/pass4-${root?'published':'dev'}-failure.json`,JSON.stringify(rows,null,2));
assert.deepEqual(failures,[]);
}finally{if(c){await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/close/${tab.id}`).catch(()=>{});c.close();}if(server)await new Promise(r=>server.close(r));}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await quarryFailure(process.argv[2],process.argv[3],process.env.QUARRY_PUBLIC_ROOT);
