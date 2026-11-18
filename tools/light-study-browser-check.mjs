// One native browser session: notched-phone regression, position-preserving Apply, deep night and fallbacks.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [out,first]=process.argv.slice(2), port=process.env.CDP_PORT;
const base=new URL(first);base.hostname='localhost';base.search='';
const tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
const c=await cdp(tab.webSocketDebuggerUrl), receipts=[];
const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.exceptionDetails)throw Error(JSON.stringify(r.result.exceptionDetails));return r.result.result.value;};
const size=async(width,height)=>c.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
async function ready(){const start=Date.now();while(Date.now()-start<180000){const r=await read('({ready:document.documentElement?.dataset.mmmReady,error:document.getElementById("gameError")?.hidden===false})');if(r.error)throw Error('Game boot failed');if(r.ready==='true'){await sleep(500);return;}await sleep(600);}throw Error('Game never settled');}
// Mark the current document, then wait until another replaces it: a navigation can return before the new
// document exists, and the old one may already be ready. Mid-navigation evaluations can return a protocol
// error with no result; that counts as not yet.
async function arrived(what){for(const start=Date.now();;await sleep(100)){const r=await c.send('Runtime.evaluate',{expression:'window.__lightStudyOld===true',returnByValue:true});if(r.result?.result?.value===false)return;if(Date.now()-start>60000)throw Error(what+' did not load a new document');}}
async function visit(query){await read('window.__lightStudyOld=true');await c.send('Page.navigate',{url:base.href+'?'+query});await arrived('Navigation');await ready();}
async function shot(name){const r=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.result.data,'base64'));console.log('CAPTURED',name);}
const measure=()=>{
  const panel=document.getElementById('settings');panel.scrollTop=panel.scrollHeight;
  const r=panel.getBoundingClientRect(), focusable=[...panel.querySelectorAll('button,input,select,a[href]')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));
  const last=focusable.at(-1), b=last.getBoundingClientRect();
  const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
  return {viewport:[innerWidth,innerHeight],panel:{top:r.top,bottom:r.bottom,height:r.height},maxHeight:getComputedStyle(panel).maxHeight,
    scrollHeight:panel.scrollHeight,scrollTop:panel.scrollTop,last:{label:last.textContent||last.id,top:b.top,bottom:b.bottom,hit:hit===last||last.contains(hit)},
    studyOpen:document.getElementById('lightStudy').open};
};
try {
  await c.send('Page.enable');
  // Observe actual world-space terrain/grass sun uniforms without exposing new production hooks.
  await c.send('Page.addScriptToEvaluateOnNewDocument',{source:`
    for(const type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
      if(!type)continue;const p=type.prototype,names=new WeakMap(),get=p.getUniformLocation,three=p.uniform3f,array=p.uniform3fv;
      p.getUniformLocation=function(program,name){const location=get.call(this,program,name);if(location)names.set(location,name);return location;};
      p.uniform3f=function(location,x,y,z){if(names.get(location)==='sunDir')window.__lightStudySunY=y;return three.call(this,location,x,y,z);};
      p.uniform3fv=function(location,v){if(names.get(location)==='sunDir')window.__lightStudySunY=v[1];return array.call(this,location,v);};
    }`});
  await size(1280,800);
  const baselineStart=Date.now();await visit('site=just&mode=explore&radio=0');
  const baselineMs=Date.now()-baselineStart;
  const normal=await read('({x:window.mmm.vehicle.x,z:window.mmm.vehicle.z,heading:window.mmm.vehicle.heading})');
  for(const key of ['driveAt','at']) {
    const start=Date.now();let timer;
    const limit=Math.max(30000,Math.min(90000,baselineMs*2+5000));
    try {await Promise.race([visit(`site=just&mode=explore&radio=0&${key}=1e20,1e20,0`),new Promise((_,reject)=>{timer=setTimeout(()=>{c.close();reject(Error(key+' hostile pose did not boot within '+limit+' ms'));},limit);})]);}
    finally{clearTimeout(timer);}
    const actual=await read('({x:window.mmm.vehicle.x,z:window.mmm.vehicle.z,heading:window.mmm.vehicle.heading})');
    for(const field of ['x','z','heading'])assert.ok(Math.abs(actual[field]-normal[field])<1e-6,`${key} huge pose falls back to normal start`);
    const result={name:'hostile boot',key,baselineMs,elapsedMs:Date.now()-start,limitMs:limit,normal,actual};receipts.push(result);console.log('HOSTILE',JSON.stringify(result));
  }
  for(const height of [852,765]) for(const dated of [true,false]) {
    await size(393,height);
    await visit(`site=just&mode=explore&test=1&touch=1&q=low&res=1&radio=0&at=622951.3,5104332.1,270${dated?'&date=2026-12-21&time=16:30':''}`);
    await read(`for(const [side,value] of Object.entries({top:59,bottom:34,left:0,right:0}))document.documentElement.style.setProperty('--test-safe-'+side,value+'px');document.getElementById('gear').click();true`);
    await sleep(400);
    assert.equal(await read('document.getElementById("lightStudy").open'),dated,'active-only default opening');
    // Reintroduce exactly the reviewed bad rule against the same page/phone CSS.
    await read(`document.head.appendChild(Object.assign(document.createElement('style'),{id:'oldLightStudyCSS',textContent:'#settings:has(#lightStudy){max-height:calc(100dvh - 90px)}'}));true`);
    const before=await read(`(${measure})()`);
    assert.equal(+before.maxHeight.replace('px',''),height-90,'old rule reproduces wrong height limit');
    if(dated)assert.ok(before.last.bottom>height-34,'old CSS puts final control into or below the unsafe bottom area');
    if(dated&&height===765) {await read('document.getElementById("settings").scrollTop=0');await shot('phone-before-insets-393x765');}
    await read('document.getElementById("oldLightStudyCSS").remove();true');
    const after=await read(`(${measure})()`);
    receipts.push({name:'safe-area',dated,height,insets:{top:59,bottom:34},before,after});
    console.log('SAFE',JSON.stringify(receipts.at(-1)));
    assert.equal(after.panel.top,127);assert.notEqual(after.maxHeight,before.maxHeight,'phone safe-area rule wins');
    assert.ok(after.panel.height<=height-169,'resolved phone height respects both insets');
    assert.ok(after.panel.bottom<=height-42,'panel stays above the bottom safe area');
    assert.ok(after.last.bottom<=height-34&&after.last.hit,'final control reachable inside safe area');
    if(dated) {await read('document.getElementById("settings").scrollTop=0');await shot(`phone-after-insets-393x${height}`);}
  }
  // Move away from the URL's initial point before Apply; prove the current car is what survives reload.
  await size(393,852);
  await visit('site=just&mode=explore&date=2026-12-21&time=16:30&test=1&touch=1&q=low&res=1&radio=0&at=622951.3,5104332.1,270');
  const expected=await read(`(async()=>{const village=(await(await fetch('/terrain/manifest.json')).json()).village,v=window.mmm.vehicle;
    v.place(v.x+12,v.z,v.heading+.2);const pose={e:v.x+village[0],n:village[1]-v.z,heading:v.heading*180/Math.PI};
    const address=new URL(location.href);address.searchParams.delete('test');address.searchParams.delete('res');
    for(const [key,value] of Object.entries({road:'old',shot:'1',cam:'old',title:'1'}))address.searchParams.set(key,value);
    history.replaceState(null,'',address.href);
    const time=document.querySelector('#lightStudy [type=time]');time.value='22:00';time.dispatchEvent(new Event('change',{bubbles:true}));
    const text=document.querySelector('#lightStudy output').textContent;
    if(!text.includes('At this time')||!text.includes('Apply to see it.'))throw Error('Missing preview/readout hint');
    window.__lightStudyOld=true;document.querySelector('#lightStudy button').click();return pose;})()`);
  await arrived('Apply');await ready();   // Apply navigates (location.search)
  const returned=await read(`(async()=>{const village=(await(await fetch('/terrain/manifest.json')).json()).village,v=window.mmm.vehicle;return {e:v.x+village[0],n:village[1]-v.z,heading:v.heading*180/Math.PI,search:location.search,title:!!document.getElementById('title')};})()`);
  const query=new URLSearchParams(returned.search),at=query.get('driveAt').split(',').map(Number);
  for(const [i,key] of ['e','n','heading'].entries()) {assert.ok(Math.abs(at[i]-expected[key])<1e-7,`query preserves ${key}`);assert.ok(Math.abs(returned[key]-expected[key])<.1,`reloaded car preserves ${key}`);}
  for(const key of ['at','road','shot','cam','title','test','res'])assert.equal(query.has(key),false,`${key} override cleared or excluded from title-policy proof`);
  assert.equal(returned.title,true,'PLAYER position retains title card');
  await read('document.getElementById("titleStart").click();true');
  receipts.push({name:'position-apply',expected,returned});console.log('PASS current-position Apply',JSON.stringify(receipts.at(-1)));
  await size(1600,1000);
  await visit('site=just&date=2026-12-21&time=22:00&test=1&shot=1&hud=0&shadows=1&res=1&radio=0');
  const night=await read(`(async()=>{const {readLightStudy,studyLightingElevation}=await import('/src/light-study.ts'),{sunAngles}=await import('/src/sun.ts');const s=readLightStudy(new URLSearchParams(location.search),true),sun=sunAngles(s.when,46.0717,-61.392);return {when:s.when.toISOString(),sun,lightingElevation:studyLightingElevation(sun.el,s.active),actualSunY:window.__lightStudySunY};})()`);
  assert.ok(night.sun.el<0);assert.equal(night.lightingElevation,.5);assert.ok(night.actualSunY>0,'actual GPU sun uniform is above the ground');receipts.push({name:'night',...night});
  await shot('dec-21-2200');
  await size(393,852);
  await visit('site=just&date=9999-12-31&test=1&touch=1&q=low&res=1&radio=0');
  const invalid=await read('({ready:document.documentElement.dataset.mmmReady,text:document.querySelector("#lightStudy output").textContent,open:document.getElementById("lightStudy").open})');
  assert.match(invalid.text,/1880–2200/);assert.equal(invalid.open,true);receipts.push({name:'invalid-date',...invalid});
  const missing=await c.send('Page.addScriptToEvaluateOnNewDocument',{source:'globalThis.Intl=undefined;'});
  await visit('site=just&date=2026-12-21&time=22:00&test=1&touch=1&q=low&res=1&radio=0');
  const fallback=await read('({ready:document.documentElement.dataset.mmmReady,text:document.querySelector("#lightStudy output").textContent,open:document.getElementById("lightStudy").open,scale:+document.getElementById("exag").value})');
  assert.match(fallback.text,/Halifax time-zone data/);assert.equal(fallback.scale,1.5);receipts.push({name:'no-Intl-boot',...fallback});
  await c.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:missing.result.identifier});
  writeFileSync(`${out}/browser-fix-receipts.json`,JSON.stringify(receipts,null,2)+'\n');
  console.log('PASS light-study browser: safe areas dated/plain at both heights, Apply pose/title, 22:00 actual GPU direction, invalid date and no-Intl boot.');
} finally {c.close();await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
