import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const port = process.env.CDP_PORT, base = new URL(process.argv[3]).origin;
const out = join(process.env.MMM_CHECK_OUT ?? process.argv[2], 'evidence/pause');
mkdirSync(out, { recursive: true });
for (const [name, width, height, touch] of [['desktop',1280,900,false],['phone',393,852,true],['phone-wide',844,390,true],['just-desktop',1280,900,false]]) {
 const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 const c = await cdp(tab.webSocketDebuggerUrl);
 const read = async expression => (await c.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.result.value;
 // Enter carries its text, as a real key press does: CDP activates a focused control only then.
 const key = async (code,key) => { await c.send('Input.dispatchKeyEvent',{type:'keyDown',code,key,...(code==='Enter'?{text:'\r'}:{})}); await c.send('Input.dispatchKeyEvent',{type:'keyUp',code,key}); };
 const click = async id => { const r = await read(`(()=>{const e=document.getElementById('${id}');if(e.closest('#pauseScreen'))e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await c.send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1}); await c.send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1}); };
 const snapshot = () => read(`(()=>{const v=mmm.vehicle;return [v.x,v.y,v.z,v.speed,v.vx,v.vz,mmm.shift.elapsed,document.getElementById('shiftHud').textContent]})()`);
 try {
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});
  const origin = new URL(base); if(name.startsWith('just-')) origin.hostname = 'localhost';
  await c.send('Page.navigate',{url:`${origin.origin}/?test=1&vehicle=bike&road=Mabou%20Harbour%20Road&hud=1&radio=0&q=low${name.startsWith('just-')?'&site=just&mode=explore':''}${touch?'&touch=1':''}`});
  let ready = false;
  for(let i=0;i<240;i++){ await sleep(500); if(await read(`(document.documentElement.dataset.mmmReady==='true' || document.title.startsWith('settled')) && !!window.mmm?.vehicle`)){ready=true;break;} }
  assert.ok(ready,`${name} settled`);
  // Real pedal input releases daily-start parking. Then let the bike roll without a pedal.
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'}); await sleep(1800);
  await c.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'});
  assert.ok(Math.abs((await snapshot())[3])>.3,`${name}: bike rolling`);
  await click('gear'); await sleep(200); const frozen = await snapshot(); await sleep(1200);
  assert.deepEqual(await snapshot(),frozen,`${name}: Settings freezes bike and shift`);
  await key('Escape','Escape'); assert.equal(await read(`document.activeElement.id`),'gear','Escape restores gear focus'); await sleep(500); assert.notDeepEqual((await snapshot()).slice(0,3),frozen.slice(0,3),`${name}: bike resumes`);
  await key('KeyP','p'); await sleep(100); assert.equal(await read(`document.getElementById('pauseScreen').hidden`),false);
  assert.equal(await read(`document.getElementById('pauseTitle').textContent`),'Paused','bike pause title');
  assert.equal(await read(`document.activeElement.id`),'resumeGame','pause focuses Resume');
  assert.equal(await read(`document.querySelector('#pauseKeys').open`),false,'keys start closed');
  assert.equal(await read(`document.querySelector('#pauseScreen pre')`),null,'no HUD dump');
  assert.equal(await read(`document.getElementById('pauseRadio').textContent`),'Radio quiet','quiet radio line');
  assert.equal(await read(`document.getElementById('pauseRace').hidden`),true,'no idle race line');
  assert.equal(await read(`document.getElementById('pauseEndShift').hidden`),name.startsWith('just-'),'End shift is shown only in the mail pause card');
  await key('Enter','Enter');assert.equal(await read(`document.getElementById('pauseScreen').hidden`),true,'Enter on Resume resumes');await key('KeyP','p');
  await read(`document.getElementById('pauseSettings').focus()`);
  if(name.startsWith('just-')) {
   assert.equal(await read(`document.getElementById('pauseHome')?.href`),'https://justdrive.fakkeldy.ca/','Just Drive links its front page');
   await key('Tab','Tab');assert.equal(await read(`document.activeElement.id`),'pauseHome','Tab from Settings reaches All places');
  } else {
   assert.ok(await read(`(()=>{const e=document.getElementById('pauseEndShift'),s=getComputedStyle(e),r=e.getBoundingClientRect(),p=e.closest('section');return s.fontFamily===getComputedStyle(document.getElementById('pauseSettings')).fontFamily&&s.borderTopWidth==='0px'&&r.height>=44&&Math.abs(r.left-p.getBoundingClientRect().left-parseFloat(getComputedStyle(p).borderLeftWidth)-parseFloat(getComputedStyle(p).paddingLeft))<=1;})()`),'End shift is a quiet sans line on the card content edge with a full touch height');
   assert.equal(await read(`document.getElementById('pauseHome')`),null,'mail has no front-page link');await key('Tab','Tab');assert.equal(await read(`document.activeElement.id`),'pauseEndShift','Tab reaches End shift');}
  await key('Tab','Tab'); assert.equal(await read(`document.activeElement.tagName`),'SUMMARY','Tab wraps to Keys');
  await key('Enter','Enter'); assert.equal(await read(`document.querySelector('#pauseKeys').open`),true,'keyboard opens Keys');
  assert.ok(await read(`document.querySelectorAll('#pauseKeys dt').length>=8`),'full key list');
  await key('Tab','Tab'); assert.equal(await read(`document.activeElement.id`),'resumeGame','Tab reaches Resume');
  const paused=await snapshot(); await sleep(700); assert.deepEqual(await snapshot(),paused);
  await click('pauseSettings'); assert.equal(await read(`document.getElementById('settings').classList.contains('open')`),true);
  await click('gear'); assert.equal(await read(`document.getElementById('pauseScreen').hidden`),false,'Settings returns to pause');
  await key('KeyP','p'); await sleep(300); assert.equal(await read(`document.getElementById('pauseScreen').hidden`),true);
  const geometry=await read(`(()=>{const b=document.getElementById('pauseButton'),r=b.getBoundingClientRect();return {w:r.width,h:r.height,visible:r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b}})()`);
  assert.ok(geometry.w>=44&&geometry.h>=44&&geometry.visible&&geometry.hit,JSON.stringify(geometry));
  if(width>1000)assert.deepEqual(await read(`(()=>{const ids=['bigMapButton','pauseButton','placesButton','gear'].filter(id=>{const e=document.getElementById(id);return e&&!e.hidden&&e.getBoundingClientRect().width>0});return ids.slice(1).map((id,i)=>{const a=document.getElementById(ids[i]).getBoundingClientRect(),b=document.getElementById(id).getBoundingClientRect();return {gap:b.left-a.right,height:b.height,top:b.top===a.top}})})()`),Array.from({length:name.startsWith('just-')?3:1},()=>({gap:8,height:44,top:true})),'desktop chips share an eight-pixel row');
  await click('pauseButton'); await sleep(150); assert.equal(await read(`document.getElementById('pauseScreen').hidden`),false);
  const screen = await read(`(()=>{const r=document.querySelector('#pauseScreen section').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight})()`); assert.ok(screen);
  const shot=await c.send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,`${name}.png`),Buffer.from(shot.result.data,'base64'));
  await key('Escape','Escape'); assert.equal(await read(`document.getElementById('pauseScreen').hidden`),true);
  // Exercise the document visibility boundary, including its latched return screen.
  await read(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`);
  await sleep(150); const hiddenState=await snapshot(); await sleep(500); assert.deepEqual(await snapshot(),hiddenState);
  await read(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
  assert.equal(await read(`document.getElementById('pauseScreen').hidden`),false,'return remains paused');
  await click('resumeGame');
  // Controls that close the panel themselves (END SHIFT on a phone, Enlarge map, Start over) end the Settings pause too.
  await click('gear'); await sleep(200); const held = await snapshot();
  await read(`document.getElementById('settings').classList.remove('open')`); await sleep(150);
  assert.equal(await read(`document.getElementById('pauseScreen').hidden`),true,`${name}: no pause screen after a direct close`);
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'}); await sleep(900);
  await c.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'});
  assert.notDeepEqual((await snapshot()).slice(0,3),held.slice(0,3),`${name}: a panel closed by another control resumes the game`);
  if(!name.startsWith('just-')){await key('KeyP','p');await click('pauseEndShift');await sleep(300);assert.ok(await read(`document.getElementById('pauseScreen').hidden&&!document.getElementById('shiftReport').hidden`),'End shift resumes and opens the report');await key('KeyP','p');assert.ok(await read(`document.getElementById('pauseEndShift').hidden`),'End shift stays hidden after the shift');}
  console.log(`PASS ${name}: rolling bike Settings freeze/resume, P, Esc, phone target, pause screen, Settings nesting and direct panel close`);
 } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
}
