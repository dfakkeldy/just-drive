import { checkStations, radioTextToCheck, JUST_START_DIAL, MUSIC_CREDIT_TEXT } from './radio-expectations.mjs';
import { AREAS } from '../web/src/area.ts';
import { RECEPTION, bandOf, comesIn, signalAt } from '../web/src/radio-reception.ts';
// Real phone/player checks. Run only through yard-shots.sh, one owned browser job at a time.
// WEB_PORT=5351 CDP_PORT=9551 VITE_MP=1 RUN=just-drive-check.mjs tools/yard-shots.sh
import assert from 'node:assert/strict';
import { assertMailCar } from './mail-car-body.mjs';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {build} from '../web/node_modules/esbuild/lib/main.js';
const [out]=process.argv.slice(2),port=process.env.CDP_PORT ?? '9551',web=process.env.WEB_PORT ?? '5351';
const words=['mail','post','route','shift','carrier','delivery'];
const forbidden=new RegExp('\\b('+words.join('|')+')\\b','i');
const results=[],strings=[],catalogue=JSON.parse(readFileSync(new URL('./radio_stations.json',import.meta.url),'utf8'));

const baselineHead=execFileSync('git',['merge-base','HEAD','origin/main'],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Compare main's non-music title copy; music is checked independently against the editable catalogue.
const baselineSource=execFileSync('git',['show',baselineHead+':web/src/title.ts'],{encoding:'utf8'});
const baseline=await build({stdin:{contents:baselineSource,resolveDir:new URL('../web/src/',import.meta.url).pathname,loader:'ts'},bundle:true,format:'esm',platform:'browser',write:false});
const baselineData='data:text/javascript;base64,'+Buffer.from(baseline.outputFiles[0].text).toString('base64');
async function page(host,path,width,height,verify,missingRadio=false) {
 const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 const ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),requests=[],errors=[];
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Network.requestWillBeSent') requests.push(m.params.request.url);else if(m.method==='Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error(method+' timed out')),20000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
 const read=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 const until=async expression=>{const end=Date.now()+90000;while(Date.now()<end){if(await read(expression))return;await sleep(150);}throw Error('timeout '+expression+' errors '+errors.join('; '));};
 const clean=async label=>{
  if(process.env.RADIO_MAIL_LEAK==='1')await read(`document.getElementById('radio')?.append(' mail')`);
  // One read for the page text and the radio readout. The game's next frame can hide the readout (the Places panel
  // stops the game), and a hidden readout gives its text without the line break. With two reads, a frame between
  // them left the station name in the page text with nothing to take it out.
  // The title's link to the other game (#titleOtherGame, #189) names Mabou Mail Madness on purpose; Dan asked for plain links both
  // ways (the project brief). It is asserted on its own below; leave only it out of the forbidden-word scan.
  const {body,radio}=await read(`(()=>{const r=document.getElementById('radio'),o=document.getElementById('titleOtherGame');let b=document.body.innerText;if(o&&o.innerText)b=b.replace(o.innerText,'');return {body:b,radio:{text:r?.innerText??'',station:r?.querySelector('b')?.textContent??'',track:r?.querySelector('span')?.textContent??''}};})()`);
  const scanned=radioTextToCheck(body,radio,catalogue),canvas=await read('window.__drawnTexts');
  strings.push({host,path,label,text:body,radio,canvas});
  for(const line of canvas)assert.doesNotMatch(line,forbidden,label+' canvas: '+line);
  assert.doesNotMatch(scanned.radio,forbidden,label+' radio outside catalogue fields');
  assert.doesNotMatch(scanned.body,forbidden,label);
  assert.ok(!requests.some(u=>/\/radio\.json(?:\?|$)/.test(u)),label+' no radio list request');
 };
 const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(`${out}/${name}.png`,Buffer.from(r.data,'base64'));};
 try {
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});await send('Emulation.setTouchEmulationEnabled',{enabled:width<1000});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__jdDoc=Math.random().toString(36);window.__drawnTexts=[];window.__textCalls=0;for(const key of ['fillText','strokeText']){const original=CanvasRenderingContext2D.prototype[key];CanvasRenderingContext2D.prototype[key]=function(text,...args){const value=String(text);window.__textCalls++;if(!window.__drawnTexts.includes(value))window.__drawnTexts.push(value);return original.call(this,text,...args);};}localStorage.clear();localStorage.setItem('mmm.mode','mail');window.__modeAccess=[];const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(k){if(k==='mmm.mode')__modeAccess.push('read');return get.call(this,k);};Storage.prototype.setItem=function(k,v){if(k==='mmm.mode')__modeAccess.push('write');return set.call(this,k,v);};`});
  if(process.env.RADIO_DROP_STATION === '1') await send('Page.addScriptToEvaluateOnNewDocument',{source:`const originalFetch=window.fetch;window.fetch=async function(...args){const response=await originalFetch.apply(this,args);if(String(args[0]).endsWith('/radio-just.json')&&response.ok){const data=await response.json();data.stations.pop();return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});}return response;};`});
  if(missingRadio) await send('Network.setBlockedURLs',{urls:[missingRadio==='mail'?'*radio.json*':'*radio-just.json*']});
  await send('Page.navigate',{url:`http://${host}:${web}${path}`});
  await verify({read,until,send,requests,errors,clean,shot});
  assert.deepEqual(errors,[],'no uncaught errors');results.push({host,path,width,height,ok:true});console.log('PASS '+host+path+' '+width+'x'+height);
 } finally {await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});ws.close();}
}
// Reception (the owner, 20 Nov 2026): only the mail shift has it. Just driving, on the Just Drive site and in the mail
// game's "Just drive" mode, hears every station everywhere. A whole turn of the dial at a place, in one read so that no
// frame moves the car between steps, gives each stop's dial and its readout word. It leaves the radio off, so keep it
// the last step on its page.
const village=id=>JSON.parse(readFileSync(new URL(id==='mabou'?'../data/baked/terrain/manifest.json':`../data/baked/areas/${id}/manifest.json`,import.meta.url),'utf8')).village;
const dialWalk=(p,[e,n])=>p.read(`(()=>{const r=mmm.radio,dials=r.stations.map(s=>s.dial),walk=[];r.setPlace(${e},${n});
  for(let k=0;k<=dials.length&&r.station>=0;k++)r.next();
  for(let k=0;k<=dials.length;k++){r.next();if(r.station<0)break;walk.push(dials[r.station]+' '+r.reception.band);}
  return {dials,walk};})()`);
/** What the mail shift's table lets in at a place: each station that comes in, with its word. */
const mailTable=(dials,[e,n])=>dials.filter(dial=>comesIn(signalAt(RECEPTION,dial,e,n))).map(dial=>dial+' '+bandOf(signalAt(RECEPTION,dial,e,n)));
async function everyStation(p,id,label){
 const place=village(id),{dials,walk}=await dialWalk(p,place);
 assert.ok(mailTable(dials,place).length<dials.length,`${label}: the mail table loses a station at ${id}, so this walk tests something`);
 assert.deepEqual([...walk].sort(),dials.map(dial=>dial+' clear').sort(),`${label}: the dial stops at every station at ${id}, and each is clear: ${walk.join(', ')}`);
}
const titleReady=`!!document.getElementById('titleStart') && !!window.mmm?.gameMode && document.documentElement.dataset.mmmReady==='true' && (window.mmm.vehicleId==='horse' || new URLSearchParams(location.search).get('radio')==='0' || typeof window.mmm.radio!=='undefined')`;
for(const [width,height,name] of [[390,844,'just-drive-portrait'],[844,390,'just-drive-landscape']]) await page('localhost','/mabou?site=just&touch=1&q=low',width,height,async p=>{
 await p.until(titleReady);await p.clean('title');
 assert.match(await p.read(`document.querySelector('#titleOtherGame a')?.href??''`),/^https:\/\/mmm\.fakkeldy\.ca\//,'title links to the mail game');
 assert.ok(p.requests.some(u=>u.includes('/radio-just.json')));
 checkStations(await p.read('mmm.radio.stations'));
 assert.equal(await p.read(`mmm.radio.stations[mmm.radio.station].dial`),JUST_START_DIAL);
 assert.equal(await p.read(`mmm.radio.storageKey`),'mmm.radio.just');
 await p.read(`document.querySelector('#titleControls details summary').click()`);
 assert.equal(await p.read(`(()=>{const d=document.querySelector('#titleControls details'),e=[...d.querySelectorAll('dt')].find(e=>e.textContent==='RADIO');return d.open&&!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible';})()`),true,'All controls reveals the visible RADIO row');
 assert.match(await p.read(`document.getElementById('titleCard').innerText`),/RADIO/);
 await p.read(`document.querySelector('#titleControls details summary').click()`);
 assert.equal(await p.read('document.title'),'Just Drive: Mabou');assert.equal(await p.read(`document.querySelector('#title h1').innerText`),'Just Drive: Mabou');
 assert.equal(await p.read('mmm.gameMode'),'explore');assert.deepEqual(await p.read('__modeAccess'),[]);
 assert.equal(await p.read(`!!document.getElementById('modeMail')`),false);
 assert.equal(await p.read(`document.getElementById('titleCard').innerText.includes('It is not a map for navigation or for safety.')`),true);
 // The card may scroll inside itself on a phone (start-here.ts), so its box always fits; also require Start fully in view
 // and uncovered, nothing hidden sideways, and on the upright phone that the whole card fits with nothing hidden in that scroll.
 const fit=await p.read(`(()=>{const c=document.getElementById('titleCard'),r=c.getBoundingClientRect(),s=document.getElementById('titleStart').getBoundingClientRect(),hit=document.elementFromPoint(s.left+s.width/2,s.top+s.height/2);return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,inner:c.scrollHeight-c.clientHeight,wide:c.scrollWidth-c.clientWidth,start:[s.top,s.bottom],startShown:s.top>=r.top&&s.bottom<=r.bottom&&s.bottom<=innerHeight&&!!hit&&hit.closest('#titleStart')!==null};})()`);
 assert.ok(fit.left>=0&&fit.top>=0&&fit.right<=fit.w&&fit.bottom<=fit.h&&fit.startShown&&fit.wide<=1&&(width!==390||fit.inner<=1),JSON.stringify(fit));
 await p.shot(name);
 await p.read(`document.getElementById('titleCredits').click()`);assert.equal(await p.read(`document.querySelector('#titleLegal > p:first-child#titleContact a')?.getAttribute('href')==='mailto:justdrive@fakkeldy.ca'&&document.getElementById('titleContact').textContent==='Something wrong, or you want a place removed? Write to justdrive@fakkeldy.ca.'&&document.getElementById('titleContact').getClientRects().length>0`),true,'credits begin with the contact line');assert.equal(await p.read(`document.querySelector('#titleContact + #titleAbout a')?.getAttribute('href')`),'https://justdrive.fakkeldy.ca/about','About link follows the contact line');assert.equal(await p.read(`document.querySelector('#titleAbout #titleHelp')?.getAttribute('href')`),'https://justdrive.fakkeldy.ca/help','Help link beside About');assert.equal(await p.read(`document.getElementById('titleMusic').textContent`),MUSIC_CREDIT_TEXT);await p.clean('credits');await p.read(`document.getElementById('titleCredits').click();document.getElementById('titleStart').click()`);await sleep(500);await p.clean('HUD');
 // This runs before the settings and places steps on purpose: it must run even when a later step is red.
 await assertMailCar(p.read,'blender','Just Drive '+name);
 // The car is a model file: its words are in its own picture, not drawn on a canvas, so the text scan cannot see
 // them. Read the car itself. In Just Drive it is off duty: no roof sign, no lamp, a sign picture without words
 // and the plate that says MABOU (web/src/car-model.ts: the atlas slides 0.5 and 0.25).
 const justCar=await p.read(`(()=>{const c=mmm.vehicle.car;let plate=null;c.root.traverse(o=>{if(o.isMesh&&o.material.name==='Sign atlas'&&o!==c.signLight)plate=o.material.map.offset.x;});
  return {sign:c.signLight.visible,lamp:c.beacon.visible,plate,words:c.signLight.material.map?.offset.x};})()`);
 assert.deepEqual(justCar,{sign:false,lamp:false,plate:.25,words:.5},'the Just Drive car is the model car, off duty, with no mail words on its sign or plate');
 await p.read(`document.getElementById('gear').click()`);await p.clean('settings');
 await p.read(`document.getElementById('gear').click();document.getElementById('placesButton').click()`);await p.clean('places');await p.read(`document.getElementById('placesClose').click()`);
 await p.send('Page.reload',{ignoreCache:true});await p.until(titleReady);assert.equal(await p.read('mmm.gameMode'),'explore');assert.deepEqual(await p.read('__modeAccess'),[]);await p.clean('reload');
 assert.ok(await p.read(`window.__textCalls>0 && window.__drawnTexts.includes('MAP ENDS')`),'real canvas calls recorded (the map-edge sign)');
 if(width===390){const previous=await p.read('__jdDoc');await p.read(`(async()=>{const d=await import('/src/detail.ts');d.saveDetail('high');d.writeVerified(d.DETAIL_TRYING,null);const q=await import('/src/touch-quality.ts');const guard=q.startTouchQuality(true,null);const probe=document.createElement('canvas');guard.watch(probe);probe.dispatchEvent(new Event('webglcontextlost'));})()`).catch(error=>{if(!/context.*destroyed|Cannot find context/i.test(error.message))throw error;});await p.until(`window.__jdDoc!==${JSON.stringify(previous)} && !!window.mmm?.gameMode && document.documentElement.dataset.mmmReady==='true'`);assert.equal(await p.read('location.pathname'),'/mabou');assert.equal(await p.read('location.hostname'),'localhost');assert.equal(await p.read(`new URLSearchParams(location.search).get('site')`),'just');await p.clean('Full detail fallback reload');}
});
await page('localhost','/mabou?site=just&mode=mail&q=low',1280,900,async p=>{
 await p.until(titleReady);assert.equal(await p.read('mmm.gameMode'),'explore');await p.clean('desktop title');
 assert.equal(await p.read(`mmm.vehicle.car.signLight.visible`),false);assert.equal(await p.read(`mmm.vehicle.car.beacon.visible`),false);
 await p.read(`document.getElementById('titleStart').click()`);await sleep(300);await p.clean('desktop HUD');assert.match(await p.read(`document.getElementById('hud').innerText`),/WASD/);
 await p.read(`document.getElementById('gear').click()`);await p.clean('desktop settings');
});
await page('localhost','/mabou?site=just&vehicle=bike&q=low',1280,900,async p=>{await p.until(titleReady);await p.clean('desktop bike title');assert.equal(await p.read('mmm.vehicleId'),'bike');await p.read(`document.getElementById('titleStart').click()`);await sleep(300);await p.clean('desktop bike HUD');});
await page('justdrive.localhost','/judique?area=mabou&touch=1&q=low',390,844,async p=>{
 await p.until(titleReady);assert.equal(await p.read('document.title'),'Just Drive: Judique');assert.equal(await p.read('mmm.gameMode'),'explore');await p.clean('host/path title');
 assert.ok(p.requests.some(u=>u.includes('/areas/judique/manifest.json')));assert.ok(!p.requests.some(u=>u.includes('/terrain/manifest.json')));
 await p.read(`document.getElementById('titleStart').click();document.getElementById('gear').click();const select=document.getElementById('siteArea');select.value='mabou';select.dispatchEvent(new Event('change'));`);await p.until(`location.pathname==='/mabou' && !!document.getElementById('titleStart')`);assert.equal(await p.read('location.hostname'),'justdrive.localhost');assert.equal(await p.read(`new URLSearchParams(location.search).has('area')`),false);
});
await page('justdrive.localhost','/?area=judique&touch=1&q=low',390,844,async p=>{await p.until(titleReady);assert.equal(await p.read('document.title'),'Just Drive: Mabou');assert.ok(p.requests.some(u=>u.includes('/terrain/manifest.json')));assert.ok(!p.requests.some(u=>u.includes('/areas/judique/manifest.json')));await p.clean('root ignores area query');});
await page('justdrive.localhost','/westbay?area=mabou&touch=1&q=low',390,844,async p=>{
 await p.until(titleReady);assert.equal(await p.read('document.title'),'Just Drive: West Bay');assert.ok(p.requests.some(u=>u.includes('/areas/westbay/manifest.json')));checkStations(await p.read('mmm.radio.stations'));assert.equal(await p.read('mmm.radio.storageKey'),'mmm.radio.just');await p.clean('West Bay title');
 await everyStation(p,'westbay','Just Drive');
});
// The mail game's "Just drive" mode hears every station too, at Mabou, where the mail shift hears only two.
await page('localhost','/?mode=explore&touch=1&q=low',390,844,async p=>{
 await p.until(titleReady);assert.equal(await p.read('mmm.gameMode'),'explore');assert.equal(await p.read('mmm.radio.storageKey'),'mmm.radio');
 await everyStation(p,'mabou','the mail game\'s Just drive mode');
});
await page('localhost','/mabou?site=just&q=low',1280,900,async p=>{
 await p.until(titleReady);assert.equal(await p.read('mmm.radio'),null);assert.equal(await p.read(`!!document.getElementById('radio')`),false);assert.doesNotMatch(await p.read(`document.getElementById('titleCard').innerText`),/\bradio\b/i);await p.clean('missing radio title');
 await p.read(`document.getElementById('titleStart').click()`);await sleep(300);assert.doesNotMatch(await p.read(`document.getElementById('hud').innerText`),/T: radio/);await p.clean('missing radio HUD');
},true);
await page('localhost','/nowhere?site=just&touch=1&q=low',390,844,async p=>{
 await p.until(`!!document.getElementById('areaMessage')`);await p.clean('unknown area');assert.match(await p.read('document.body.innerText'),/does not exist yet/);assert.deepEqual(await p.read(`[...document.querySelectorAll('#areaMessage a')].map(a=>new URL(a.href).pathname)`),AREAS.map(a=>'/'+a.id));
});
await page('localhost','/mabou?site=just&vehicle=bike&touch=1&q=low',390,844,async p=>{await p.until(titleReady);await p.clean('bike title');assert.equal(await p.read('mmm.vehicleId'),'bike');await p.read(`document.getElementById('titleStart').click()`);await p.clean('bike HUD');});
for(const vehicle of ['truck','sxs'])await page('localhost',`/mabou?site=just&vehicle=${vehicle}&q=low`,1280,900,async p=>{await p.until(titleReady);assert.equal(await p.read('mmm.vehicleId'),vehicle);await p.clean(vehicle+' world canvas');});
for(const [name,path,blocked] of [['present','/?touch=1&q=low',false],['disabled','/?touch=1&q=low&radio=0',false],['missing','/?touch=1&q=low','mail']])await page('localhost',path,390,844,async p=>{
 await p.until(titleReady);assert.equal(await p.read('mmm.gameMode'),'mail');assert.equal(await p.read(`document.getElementById('modeMail').textContent`),'Deliver the mail');
 if(name==='present'){assert.ok(p.requests.some(u=>u.includes('/radio.json')));checkStations(await p.read('mmm.radio.stations'));assert.equal(await p.read('mmm.radio.storageKey'),'mmm.radio');}
 // The contact and About lines have their own asserts (Just Drive cards above, the mail card in explore-check); leave them out on both sides so the comparison holds before and after it reaches main.
 // The open pavement credit (#nsPavedCredit) shows only when the land has paved lots; site-title-check and paved-web-check assert it, so leave it out on both sides too.
 // The Get Fired choice (#modeFired) is pinned here and in site-title-check, then left out on both sides.
 assert.deepEqual(await p.read(`[...document.querySelectorAll('#modeChoice #modeFired')].map(b=>b.textContent)`),['Get fired']);
 // Today's run (#dailyChoice) likewise: pinned here and in site-title-check, then left out on both sides.
 // The Boss's ride-along line (#titleBoss) is added to the card by ride-along.ts, not by the title, on every mail-play
 // page (hidden on other days, but textContent still reads it). ride-along-browser asserts it; leave it out on both sides.
 assert.deepEqual(await p.read(`[...document.querySelectorAll('#dailyChoice #modeDaily')].map(b=>b.textContent)`),['Today’s run: five minutes, complaint bingo']);
 const before=await p.read(`(()=>{const e=document.getElementById('titleCard').cloneNode(true);const promise=e.querySelector('.tag');if(promise.textContent!=='A route you cannot win')throw Error('promise');promise.textContent='Preview build · a route you cannot win';const footer=e.querySelector('.titleFooter');if(footer?.textContent!=='Preview build · Cape Breton, Nova Scotia')throw Error('preview footer');footer.remove();const more=e.querySelector('#titleControls summary');if(more?.textContent!=='All controls')throw Error('full control list');more.remove();const modes=e.querySelector('#modeChoice');e.prepend(modes);e.querySelector('.mpControl')?.remove();e.querySelector('#titleContact')?.remove();e.querySelector('#titleAbout')?.remove();e.querySelector('#titleMusic')?.remove();e.querySelector('#nsPavedCredit')?.remove();e.querySelector('#titleOtherGame')?.remove();e.querySelector('#modeFired')?.remove();e.querySelector('#dailyChoice')?.remove();e.querySelector('#titleBoss')?.remove();return e.textContent;})()`);
 const old=await p.read(`(async()=>{document.getElementById('title').remove();const m=await import(${JSON.stringify(baselineData)});m.createTitle(true,()=>{});document.getElementById('titleContact')?.remove();document.getElementById('titleAbout')?.remove();document.getElementById('titleMusic')?.remove();document.getElementById('nsPavedCredit')?.remove();document.getElementById('titleOtherGame')?.remove();document.getElementById('modeFired')?.remove();document.getElementById('dailyChoice')?.remove();document.getElementById('titleBoss')?.remove();return document.getElementById('titleCard').textContent;})()`);
 assert.equal(before.replace(/\s+/g,' ').trim(),old.replace(/\s+/g,' ').trim(),'non-music title text matches main after approved presentation edits; music checked separately: '+name);console.log('PASS plain title comparison '+name);
 if(name==='present'){const place=village('mabou'),{dials,walk}=await dialWalk(p,place);assert.deepEqual([...walk].sort(),mailTable(dials,place).sort(),'the mail shift keeps its reception at Mabou: '+walk.join(', '));}
},blocked);
for(const brand of ['mail','just'])for(const vehicle of ['car','bike']) await page('localhost',(brand==='just'?'/mabou?site=just&era=1884&touch=1&q=low':'/?era=1884&touch=1&q=low')+'&vehicle='+vehicle,390,844,async p=>{
 await p.until(titleReady);assert.equal(await p.read('mmm.era.id'),'1884');checkStations(await p.read('mmm.radio.stations'));
 assert.equal(await p.read('mmm.radio.storageKey'),brand==='just'?'mmm.radio.just':'mmm.radio');
 assert.equal(await p.read(`document.getElementById('titleMusic').textContent`),MUSIC_CREDIT_TEXT);
});
for(const brand of ['mail','just'])for(const selection of ['', '&vehicle=horse']) await page('localhost',(brand==='just'?'/mabou?site=just&era=1884&touch=1&q=low':'/?era=1884&touch=1&q=low')+selection,390,844,async p=>{
 await p.until(titleReady);
 assert.equal(await p.read('mmm.era.id'),'1884');assert.equal(await p.read('mmm.vehicleId'),'horse');
 assert.equal(await p.read('!!mmm.radio'),false);assert.equal(await p.read(`!!document.getElementById('radio')`),false);
 assert.equal(p.requests.some(u=>/\/audio\/radio(?:-just)?\.json(?:\?|$)/.test(u)),false,'horse never requests a radio list');
 assert.doesNotMatch(await p.read(`document.querySelector('#title dl').textContent`),/radio|station|horn/i);
 await p.read(`document.getElementById('titleStart').click()`);
 assert.equal(await p.read('!!mmm.radio'),false);
});
writeFileSync(`${out}/player-strings.json`,JSON.stringify(strings,null,2));
writeFileSync(`${out}/browser-results.json`,JSON.stringify({words,baseline:baselineHead,results},null,2));
console.log('PASS forbidden words: '+words.join(', ')+'; no mail radio requests; all catalogue stations in Mabou/West Bay and both 1884 brands; every station clear when just driving (Just Drive at West Bay, the mail game Just drive mode at Mabou) and the mail shift reception at Mabou; null-radio hints; storage isolation; both phone fits; real canvas text; path-only root and quality fallback; actual host/path and area switch; unknown area; bike; main title text with reviewed music geography');
