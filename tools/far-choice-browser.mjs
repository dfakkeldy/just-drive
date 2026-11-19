#!/usr/bin/env node
// "Far views on phone" in the real game, through the far views work overlay (tools/check-far-views-browser.sh):
// phone detail with touch, the choice takes effect AFTER A RELOAD (the switch reloads the page itself).
//  1. Off by default: no far land, tall pack or far turbines, and the Advanced section starts closed.
//  2. Touch: tap the gear, tap "Advanced" (open state remembered), tap Coarse (nothing reloads yet), tap Apply: the page
//     reloads into the coarse scene (coarse far-land level, one far turbine draw, no near tall draws).
//  3. Keyboard: arrow from Coarse to Full moves the choice only; Tab to Apply and Enter: the page reloads into the LOW far
//     scene (LOW level, near tall draws).
//  4. Tap Off, Apply: the page reloads with no far views. ?far=coarse overrides the saved choice and says so.
//  5. Desktop detail: no Advanced section, and the desktop far scene as before.
// FAR_CHOICE_PICTURES=1 instead saves the pictures for the pull request: the Point Tupper start and a Mabou hill view
// at Off, Coarse and Full on a phone, and one desktop view (OUT folder).
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {cdp,cdpFetch,sleep} from './cdp.mjs';
const [out,base]=process.argv.slice(2),port=process.env.CDP_PORT;
const PHONE={width:390,height:844,deviceScaleFactor:3,mobile:true},DESKTOP={width:1280,height:800,deviceScaleFactor:1,mobile:false};
const MABOU_HILLS='area=mabou&cam=622560,5112920,329.39,305,0,60&hour=15';
let tab,c;
const read=async expression=>{const r=await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});return r.result.result.value;};
async function settle(label,{far}={}){
 const since=Date.now();
 for(;;){
  let ready=false;try{ready=await read("!window.__farChoiceMarker&&document.readyState==='complete'&&document.title==='settled'&&!!window.mmm");}catch{/* navigating */}
  if(ready)break;assert.ok(Date.now()-since<240000,label+': page settles');await sleep(300);
 }
 if(far){const t=Date.now();while(!await read('!!mmm.farVisibility')){assert.ok(Date.now()-t<90000,label+': far views load');await sleep(300);}}
 else await sleep(4000); // the far request goes out right after the first drawn frame; give it every chance
 await read('window.__farChoiceMarker=1');
}
async function scene(){
 return read(`(()=>{const m=mmm,draws=g=>{let n=0;g?.traverse(o=>{if(o.isMesh||o.isLine)n++;});return n;};
  return {low:m.low,farLand:m.farLand?.level??null,farTurbineDraws:draws(m.farTurbines?.group),farTurbines:m.farTurbines?.count??0,tallDraws:draws(m.tall?.group),tallSolids:m.tall?.solids.length??0,
   seaTriangles:(()=>{const s=m.scene.getObjectByName('near-sea');return s?s.geometry.index.count/3:null;})(),
   advanced:!!document.getElementById('advanced'),advancedOpen:!!document.getElementById('advanced')?.open,
   checked:document.querySelector('#farPhone input:checked')?.value??null,typed:/Set by the page address/.test(document.getElementById('farPhone')?.textContent??''),
   saved:(()=>{try{return localStorage.getItem('mmm.farPhone');}catch{return 'blocked';}})(),openSaved:(()=>{try{return localStorage.getItem('mmm.advancedOpen');}catch{return 'blocked';}})()};})()`);
}
async function centre(selector){
 const box=await read(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height};})()`);
 assert.ok(box&&box.w>0&&box.h>0,selector+' is on screen');return box;
}
async function tap(selector){const p=await centre(selector);await c.send('Input.synthesizeTapGesture',{x:p.x,y:p.y,gestureSourceType:'touch'});await sleep(400);return p;}
async function key(name,code,text){await c.send('Input.dispatchKeyEvent',{type:text?'keyDown':'rawKeyDown',key:name,code:name,windowsVirtualKeyCode:code,...(text?{text}:{})});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:name,code:name,windowsVirtualKeyCode:code});await sleep(300);}
const stillHere=async()=>{try{return await read('!!window.__farChoiceMarker');}catch{return false;}};
async function page(viewport,url,options){
 await c.send('Emulation.setDeviceMetricsOverride',viewport);await c.send('Emulation.setTouchEmulationEnabled',{enabled:viewport.mobile});
 await c.send('Page.navigate',{url});await settle(url,options);
}
async function openPanel(){if(!await read("document.getElementById('settings').classList.contains('open')"))await tap('#gear');assert.ok(await read("document.getElementById('settings').classList.contains('open')"),'settings open');}
async function check(){
 const phone=`${base}/?${MABOU_HILLS}&mode=explore&vehicle=truck&res=1&q=low&touch=1&radio=0`;
 await c.send('Page.navigate',{url:base+'/favicon.ico'});await read('localStorage.clear()');
 await page(PHONE,phone,{far:false});
 let s=await scene();console.log('OFF',JSON.stringify(s));
 assert.deepEqual([s.low,s.farLand,s.farTurbineDraws,s.tallDraws,s.tallSolids],[true,null,0,0,0],'default phone draws no far views');
 assert.deepEqual([s.advanced,s.advancedOpen,s.checked,s.typed],[true,false,'off',false],'Advanced closed, Off chosen');
 await openPanel();await tap('#advanced > summary');
 s=await scene();assert.deepEqual([s.advancedOpen,s.openSaved],[true,'1'],'a tap opens Advanced and it is remembered');
 const label=await centre('#farPhone label:nth-of-type(2)');assert.ok(label.h>=44,'touch target at least 44 px tall');
 assert.equal(await read('document.getElementById("farPhoneApply").disabled'),true,'Apply waits for a new choice');
 await tap('#farPhone label:nth-of-type(2)');await sleep(1500);assert.ok(await stillHere(),'choosing alone does not reload');
 assert.equal(await read('document.getElementById("farPhoneApply").disabled'),false,'Apply offered for a new choice');
 const apply=await centre('#farPhoneApply');assert.ok(apply.h>=44,'Apply touch target at least 44 px tall');
 await tap('#farPhoneApply');await settle('after Coarse',{far:true});
 const coarse=await scene();console.log('COARSE',JSON.stringify(coarse));
 assert.deepEqual([coarse.farLand,coarse.farTurbineDraws,coarse.tallDraws,coarse.checked,coarse.saved,coarse.advancedOpen],['coarse',1,0,'coarse','coarse',true],'Coarse after the reload');
 assert.ok(coarse.farTurbines>0&&coarse.tallSolids>0,'coarse: every turbine in the one far draw; near solids kept');
 await openPanel();await read("document.querySelector('#farPhone input[value=coarse]').focus()");await key('ArrowRight',39);await sleep(1500);
 assert.ok(await stillHere(),'arrow keys move the choice without reloading');
 assert.equal(await read("document.querySelector('#farPhone input:checked').value"),'full','ArrowRight chose Full');
 await key('Tab',9);assert.equal(await read('document.activeElement?.id'),'farPhoneApply','Tab reaches Apply');
 await key('Enter',13,'\r');await settle('after Full',{far:true});
 const full=await scene();console.log('FULL',JSON.stringify(full));
 assert.deepEqual([full.farLand,full.checked,full.saved],['low','full','full'],'keyboard Full after the reload');
 assert.ok(full.tallDraws>0&&full.farTurbineDraws===1,'Full is the LOW far scene: near tall draws and far turbines');
 assert.ok(coarse.seaTriangles<full.seaTriangles/2,'coarse sea is lighter');
 assert.ok(coarse.farTurbines>full.farTurbines,'coarse far draw also holds the near turbines');
 await openPanel();await tap('#farPhone label:nth-of-type(1)');await tap('#farPhoneApply');await settle('after Off',{far:false});
 s=await scene();console.log('OFF AGAIN',JSON.stringify(s));
 assert.deepEqual([s.farLand,s.tallDraws,s.checked,s.saved],[null,0,'off','off'],'Off after the reload');
 await page(PHONE,phone+'&far=coarse',{far:true});
 s=await scene();assert.deepEqual([s.farLand,s.checked,s.typed,s.saved],['coarse','coarse',true,'off'],'?far= overrides the saved choice and says so');
 await page(DESKTOP,`${base}/?${MABOU_HILLS}&mode=explore&vehicle=truck&res=1&q=high&radio=0`,{far:true});
 s=await scene();console.log('DESKTOP',JSON.stringify(s));
 assert.deepEqual([s.low,s.farLand,s.advanced],[false,'desktop',false],'desktop: no Advanced section, desktop far scene');
 assert.ok(s.tallDraws>0&&s.farTurbineDraws===1);
 writeFileSync(out+'/far-choice.json',JSON.stringify({off:true,coarse,full,desktop:s,logs:c.logs},null,2));
 console.log('PASS far views on phone: Off default; touch and keyboard choice + Apply, each in force after the page reloads; ?far= override; desktop unchanged');
}
async function pictures(){
 const views=[['pointtupper-start','area=pointtupper&mode=explore&vehicle=truck&hour=16.75'],['mabou-hills',MABOU_HILLS+'&mode=explore&vehicle=truck']];
 const counts={};
 for(const [name,query] of views)for(const far of ['off','coarse','full']){
  await page(PHONE,`${base}/?${query}&res=1&hud=0&radio=0&q=low&touch=1&far=${far}`,{far:far!=='off'});await sleep(1500);
  const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/phone-${name}-${far}.png`,Buffer.from(shot.result.data,'base64'));
  counts[`${name}/${far}`]={...await scene(),calls:await read('mmm.renderer.info.render.calls'),triangles:await read('mmm.renderer.info.render.triangles')};console.log(name,far,JSON.stringify(counts[`${name}/${far}`]));
 }
 await page(DESKTOP,`${base}/?${MABOU_HILLS}&mode=explore&vehicle=truck&res=1&hud=0&radio=0&q=high`,{far:true});await sleep(1500);
 const shot=await c.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/desktop-mabou-hills.png`,Buffer.from(shot.result.data,'base64'));
 writeFileSync(out+'/far-choice-pictures.json',JSON.stringify(counts,null,2));
}
try{
 await fetch(base+'/__far-views-mode?mode=after');
 tab=await(await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();c=await cdp(tab.webSocketDebuggerUrl,{deadline:240000});await c.send('Page.enable');
 if(process.env.FAR_CHOICE_PICTURES==='1')await pictures();else await check();
}catch(e){console.error(e.stack);process.exitCode=1;}
finally{c?.close();if(tab)await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{});}
