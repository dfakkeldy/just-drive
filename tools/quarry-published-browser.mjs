// Real published build (app.js and its chunks): deferred initialization and actual player controls.
import assert from 'node:assert/strict';
import {quarryFailure} from './quarry-failure-browser.mjs';
import {publishedPotholeHook} from './fleet-published-hook-check.mjs';
import {createServer} from 'node:http';
import {existsSync,readFileSync,createReadStream,statSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const out=resolve(process.argv[2]),root=resolve(process.env.QUARRY_PUBLIC_ROOT??out+'/site');
writeFileSync(out+'/published-pothole-hook.json',JSON.stringify(publishedPotholeHook(root),null,2));
// The published script is app.js and its chunks (web/area-chunks-build.ts); the probe sits in the quarry's chunk.
assert.ok(['app.js',...(existsSync(root+'/chunks')?readdirSync(root+'/chunks').map(name=>'chunks/'+name):[])].some(name=>readFileSync(root+'/'+name,'utf8').includes('__quarryEvaluations')),'build must use QUARRY_EVAL_PROBE=1');
const server=createServer((req,res)=>{try{let path=new URL(req.url,'http://localhost').pathname;if(/^\/(?:mabou|westbay|judique)?\/?$/i.test(path))path='/index.html';const file=resolve(root,'.'+path);assert.ok(file.startsWith(root+'/'));const stat=statSync(file);assert.ok(stat.isFile());res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.mp3':'audio/mpeg','.webmanifest':'application/manifest+json'})[extname(file)]??'application/octet-stream');res.setHeader('Cache-Control','no-store');createReadStream(file).pipe(res);}catch{res.writeHead(404);res.end('Missing');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://localhost:'+server.address().port;
const tab=await(await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/new?about:blank`,{method:'PUT'})).json(),c=await cdp(tab.webSocketDebuggerUrl,{deadline:180000});
const read=async expression=>(await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.result.value;
const until=async expression=>{for(let i=0;i<1800;i++){await sleep(250);if(await read(expression))return;}throw Error('Published quarry page did not settle: '+expression);};
const settled="document.documentElement.dataset.mmmReady==='true'&&!document.getElementById('boot')";
const visit=async path=>{await c.send('Page.navigate',{url:origin+path});await until(settled);};
const results=[],check=async(label,expression)=>{const value=await read(expression);assert.ok(value,label);results.push({label,exit:0});console.log('PASS',label);};
try{
 await c.send('Page.enable');
 if(!process.env.QUARRY_P3_PATH_ONLY){await visit('/?area=mabou&mode=mail&shot=2&q=low&radio=0');
 await check('Published Mabou mail evaluates zero quarry modules','!(globalThis.__quarryEvaluations?.length)');
 await check('Published pothole diagnostic setter is absent or dead',`(async()=>{const asset=performance.getEntriesByType('resource').find(r=>/\\/(?:app\\.js|offline\\/app\\.[^/]+\\.js)(?:\\?|$)/.test(r.name));if(!asset)throw Error('Published app resource absent');const module=await import(asset.name);let globalDenied=false,moduleDenied=false;try{globalThis.setDiagnosticPotholes(false)}catch(error){globalDenied=error instanceof TypeError||/dev server/.test(error.message)}try{module.setDiagnosticPotholes(false)}catch(error){moduleDenied=error instanceof TypeError||/dev server/.test(error.message)}window.__publishedPotholeProof={moduleExports:Object.keys(module),globalDenied,moduleDenied};return globalDenied&&moduleDenied&&!globalThis.mmm})()`);
 writeFileSync(out+'/published-pothole-call.json',JSON.stringify(await read('window.__publishedPotholeProof'),null,2));
 for(const area of readdirSync(root+'/areas',{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='westbay').map(d=>d.name)){
  await visit('/?area='+area+'&mode=explore&vehicle=car&title=1&q=low&radio=0');
  await check('Published '+area+' evaluates zero park modules',"!(globalThis.__quarryEvaluations?.length)&&!document.getElementById('tripHud')");
 }
 for(const vehicle of ['car','bike']){
  await visit('/?trip=quarry-gate&title=1&q=low&radio=0');
  await check('Published quarry initializes all ten implementation modules',"globalThis.__quarryEvaluations.length===10&&globalThis.__quarryEvaluations.includes('quarry-stunt-park.ts')&&!!document.getElementById('tripHud')");
  await check('Published quarry offers both course starts',"!!document.querySelector('[data-place=sugar-camp-upper]')&&!!document.querySelector('[data-place=sugar-camp-lower]')");
  await read(`document.querySelector('#vehicleChoice [data-vehicle="${vehicle}"]').click()`);
  await until(`${settled}&&new URLSearchParams(location.search).get('vehicle')==='${vehicle}'&&!new URLSearchParams(location.search).has('trip')`);
  await check('Actual '+vehicle+' control cancels route and HUD',"!document.getElementById('tripHud')&&document.querySelector('#vehicleChoice [aria-pressed=true]')?.dataset.vehicle==="+JSON.stringify(vehicle));
 }
 await visit('/westbay?site=just&trip=quarry-gate&title=1&q=low&radio=0');
 await read("const select=document.getElementById('siteArea');select.value='judique';select.dispatchEvent(new Event('change'))");
 await until(`${settled}&&location.pathname==='/judique'&&!new URLSearchParams(location.search).has('trip')`);
 await check('Actual Just Drive area control leaves the trip and never initializes quarry in Judique',"!document.getElementById('tripHud')&&!(globalThis.__quarryEvaluations?.length)");
 await visit('/mabou?site=just&trip=quarry&vehicle=car&title=1&q=low&radio=0');
 await check('Contradictory Just Drive vehicle address stays in its current area',"location.pathname==='/mabou'&&!new URLSearchParams(location.search).has('trip')&&document.getElementById('siteArea').value==='mabou'&&!document.getElementById('tripHud')&&!(globalThis.__quarryEvaluations?.length)");
 await visit('/mabou?site=just&trip=quarry&area=judique&title=1&q=low&radio=0');
 await check('Explicit contradictory area wins over the old Just Drive pathname',"location.pathname==='/judique'&&document.getElementById('siteArea').value==='judique'&&!new URLSearchParams(location.search).has('trip')&&!document.getElementById('tripHud')&&!(globalThis.__quarryEvaluations?.length)");
 await visit('/?trip=quarry&mode=mail&title=1&q=low&radio=0');
 await check('Explicit contradictory mode cancels the preset in the published build',"!new URLSearchParams(location.search).has('trip')&&!document.getElementById('tripHud')&&!(globalThis.__quarryEvaluations?.length)");
 }
 await visit('/?site=just&trip=quarry&title=1&q=low&radio=0');
 await check('P4-E bare Just Drive root trip supplies its starting area',"location.pathname==='/westbay'&&new URLSearchParams(location.search).get('trip')==='quarry'&&!!document.getElementById('tripHud')");
 await visit('/?site=just&trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1&title=1&q=low&radio=0');
 await check('P4-E expanded root trip enters West Bay in the actual flat build',"location.pathname==='/westbay'&&new URLSearchParams(location.search).get('trip')==='quarry'&&!!document.getElementById('tripHud')");
 await visit('/judique?site=just&trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1&title=1&q=low&radio=0');
 await check('P3-3 expanded trip path change honours Judique in the actual flat build',"location.pathname==='/judique'&&document.getElementById('siteArea').value==='judique'&&!new URLSearchParams(location.search).has('trip')&&!document.getElementById('tripHud')&&!(globalThis.__quarryEvaluations?.length)");
 await visit('/westbay?site=just&trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1&title=1&q=low&radio=0');
 await check('P3-3 expanded trip plain reload keeps its route',"location.pathname==='/westbay'&&new URLSearchParams(location.search).get('trip')==='quarry'&&!!document.getElementById('tripHud')");
 await c.send('Page.reload');await until(settled);
 await check('P3-3 reload preserves the expanded starting state',"location.pathname==='/westbay'&&new URLSearchParams(location.search).get('trip')==='quarry'&&!!document.getElementById('tripHud')");
 for(const path of ['/westbay/','/WESTBAY']){
  await visit(path+'?site=just&trip=quarry&area=westbay&mode=explore&vehicle=truck&trailer=1&title=1&q=low&radio=0');
  await check('P4-E recognised path '+path+' preserves the trip',"location.pathname==='/westbay'&&new URLSearchParams(location.search).get('trip')==='quarry'&&!!document.getElementById('tripHud')");
 }
 await read("const select=document.getElementById('siteArea');select.value='judique';select.dispatchEvent(new Event('change'))");
 await until(`${settled}&&location.pathname==='/judique'&&!new URLSearchParams(location.search).has('trip')`);
 const history=(await c.send('Page.getNavigationHistory')).result,forward=history.entries[history.currentIndex].id,back=history.entries[history.currentIndex-1].id;
 await c.send('Page.navigateToHistoryEntry',{entryId:back});await until(`${settled}&&location.pathname==='/westbay'&&new URLSearchParams(location.search).has('trip')`);
 await check('P4-E actual Back returns to the saved starting trip',"!!document.getElementById('tripHud')");
 await c.send('Page.navigateToHistoryEntry',{entryId:forward});await until(`${settled}&&location.pathname==='/judique'&&!new URLSearchParams(location.search).has('trip')`);
 await check('P4-E actual Forward honours the later area selection',"!document.getElementById('tripHud')&&!(globalThis.__quarryEvaluations?.length)");
 assert.deepEqual(c.errors,[]);writeFileSync(out+'/published-quarry-check.json',JSON.stringify(results,null,2));
}finally{await cdpFetch(`http://127.0.0.1:${process.env.CDP_PORT}/json/close/${tab.id}`).catch(()=>{});c.close();await new Promise(r=>server.close(r));}

await quarryFailure(out,undefined,root);
