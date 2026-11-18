#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Drives the production fixed-step car, yard contacts and jump judge. No seeded velocity or invented ground.
// The explicit DEV jumpCheck opt-in is required because these checks place the car through a test hook.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { assertMailCar } from './mail-car-body.mjs';
const [out, first] = process.argv.slice(2), base = new URL(first).origin, port = process.env.CDP_PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: m => {  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); } });
const read = async expression => { const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (m.error || m.result.exceptionDetails) throw Error(JSON.stringify(m)); return m.result.result.value; };
const shot = async name => { const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(m.result.data, 'base64')); };
const key = async (code, value, vk) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key: value, windowsVirtualKeyCode: vk, ...(type === 'keyDown' && value === 'Enter' ? { text: '\r' } : {}) }); };
async function load(query = '') {
  await send('Page.navigate', { url: `${base}/?cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1&hud=1&radio=0&title=1${query}` });
  let ready = false;
  for (let i = 0; i < 240; i++) { await sleep(250); if (await read(`document.title.startsWith('settled') && !!window.mmm?.yard?.triangles`)) { ready = true; break; } }
  assert.ok(ready, 'terrain and yard loaded');
  await assertMailCar(read, 'blender', 'jump check');      // this check reads the car's lamp: a fallback car fails it
  const found = await read(`JSON.parse(localStorage.getItem('mmm.endings')??'[]').length`);
  if(found)assert.equal(await read(`document.getElementById('waysOut').textContent`),`Ways out found: ${found}`,'fresh title reads saved endings');
  await read(`document.getElementById('titleStart').click();document.activeElement?.blur()`); await key('KeyF', 'f', 70);
  await read(`window.requestAnimationFrame=fn=>{window.nextFrame=fn;return 0}`); await sleep(100);
  await read(`(async()=>{
    const {SLIP_RAMP:r}=await import('/src/yard-site.ts');
    const {JUMP_LOAD:L}=await import('/src/jump-rules.ts');
    const {vehicle:c,yard,terrain,camera,yardJob:job,endings,shift}=mmm,s=yard.site;
    window.jt={r,c,yard,terrain,camera,job,endings,shift,s,now:performance.now()};
    jt.frame=(dt=1/30)=>{jt.now+=dt*1000;window.nextFrame(jt.now)};
    jt.view=(u,v,h,tu,tv,th=1)=>{const p=s.world(u,v),t=s.world(tu,tv);camera.position.set(p.x,(terrain.heightAt(p.x,p.z)??c.y)+h,p.z);camera.lookAt(t.x,(terrain.heightAt(t.x,t.z)??c.y)+th,t.z);camera.updateMatrixWorld();yard.update(0,c,camera.position);mmm.renderer.render(yard.group.parent,camera)};
    jt.drive=(target=99,reset=false,airShot=false)=>{
      if(reset){endings.close();job.judge.reset()}yard.tidy();
      const p=s.world(-20,r.v);c.place(p.x,p.z,s.heading(-1,0));c.assist=0;c.steerAngle=0;
      let launch=null,land=null,after=false,minClear=99,trace=[],state=job.judge.state;const contact=yard.contacts;
      for(let i=0;i<2400;i++){
        const brake=land!==null;
        mmm.driveVehicle(1/120,{throttle:brake?(Math.abs(c.speed)>.12?-Math.sign(c.speed):0):Math.min(1,Math.max(-1,(target-c.speed)*.9)),steer:0,handbrake:brake,touch:new URLSearchParams(location.search).get('touch')==='1'});
        yard.update(1/120,c,camera.position);
        const l=s.local(c.x,c.z),along=r.u-l.u;if(state!==job.judge.state){trace.push({state:job.judge.state,along,pitch:c.pitch,roll:c.roll,y:c.y,ground:terrain.heightAt(c.x,c.z),eligible:job.judge.previous?.eligible});state=job.judge.state;}
        if(c.airborne&&along>15&&!launch)launch={speed:c.speed,along,y:c.y};
        if(launch&&!c.airborne&&!land)land={along,y:c.y};
        if(along>L.near-2.3&&along<L.near+L.length+2.3)minClear=Math.min(minClear,c.y-.12-yard.jumpTop);
        if(airShot&&along>22.3&&c.airborne){jt.view(-94,-9,4,-90,r.v,1);after=true;break}
        if(endings.busy)break;
      }
      return {eligible:job.judge.previous?.eligible,trace,launch,land,minClear,contacts:yard.contacts-contact,jumps:job.judge.jumps,state:job.judge.state,offer:endings.busy,position:s.local(c.x,c.z),speed:c.speed,after};
    };
  })()`);
}
try {
  await send('Runtime.enable'); await send('Page.enable');
  await load('&jumpCheck=1');
  await read(`localStorage.removeItem('mmm.endings')`);
  const heights = await read(`(async()=>{const {JUMP_LOAD:l}=await import('/src/jump-rules.ts');return [l.near,l.near+l.length].flatMap(a=>[-l.width/2,l.width/2].map(v=>{const p=jt.s.world(jt.r.u-a,jt.r.v+v);return jt.yard.jumpTop-jt.terrain.landHeightAt(p.x,p.z)}))})()`);
  assert.ok(Math.min(...heights)>0 && Math.max(...heights)<1.3,'all obstacle corners are low and above ground');
  console.log('Obstacle corner heights:',heights);
  await read(`jt.view(-79,-21,75,-79,-21,0)`); await shot('lot-above');
  await read(`jt.view(-53,-15,9,-90,-21,.7)`); await shot('run-up');
  const speeds = [];
  for (const target of [14,17,18,99]) speeds.push({ target, ...await read(`jt.drive(${target},true)`) });
  console.log('Measured speed trials:', JSON.stringify(speeds.map(({target,launch,land,contacts,jumps,offer,minClear})=>({target,launch,land,contacts,jumps,offer,minClear}))));
  assert.ok(!speeds[0].offer && speeds[0].contacts > 0 && speeds[0].jumps === 0, 'about 50 km/h hits the load and gives no offer');
  assert.ok(!speeds[1].offer && speeds[1].contacts > 0 && speeds[2].offer, '59.7 km/h clips; 63.2 km/h clears');
  assert.ok(speeds.at(-1).minClear > 0.3, `a full run-up clears by a margin a player can see (${speeds.at(-1).minClear})`);
  assert.ok(speeds.at(-1).offer && speeds.at(-1).contacts === 0, 'full real run-up earns the offer');
  assert.ok(speeds.at(-1).launch.speed >= 19, 'run-up reaches about 70 km/h without seeded speed');
  await read(`jt.drive(99,true,true)`); await shot('jump-air');
  await read(`jt.drive(99,true);jt.view(-117,-8,5,-91,-21,.8)`); await shot('offer-desktop');
  const paused = await read(`(()=>{const before={elapsed:jt.shift.elapsed,x:jt.c.x,z:jt.c.z};for(let i=0;i<120;i++)jt.frame();return {before,after:{elapsed:jt.shift.elapsed,x:jt.c.x,z:jt.c.z},focus:document.activeElement.textContent,dialog:document.getElementById('endingFrame').getAttribute('aria-modal')}})()`);
  assert.deepEqual(paused.after, paused.before, 'offer pauses car and shift in the real main frame');
  assert.equal(paused.focus, 'Take the job'); assert.equal(paused.dialog, 'true');
  // Tab is trapped. Space on the second button means keep the route, never the brake or shift end.
  await key('Tab','Tab',9); assert.equal(await read('document.activeElement.textContent'), 'Keep the route');
  await key('Space',' ',32); assert.equal(await read('jt.endings.busy'), false);
  const elapsed = await read('jt.shift.elapsed'); await read('for(let i=0;i<30;i++)jt.frame()');
  assert.ok(await read(`jt.shift.elapsed > ${elapsed} && !jt.shift.ended`), 'keep the route resumes the shift');
  const again = await read('jt.drive(99,false)'); assert.equal(again.jumps, 2); assert.equal(again.offer, false, 'second clean jump after decline has no offer');

  await load('&jumpCheck=1&touch=1&q=low');
  await read(`jt.shift.career={...jt.shift.career,day:6,pay:1234,warnings:2};localStorage.setItem('mmm.shift.v1',JSON.stringify(jt.shift.career));window.savedCareer=localStorage.getItem('mmm.shift.v1');jt.drive(99,true);jt.view(-117,-8,5,-91,-21,.8)`);
  for (const [w,h] of [[390,844],[844,390],[320,568],[568,280]]) {
    await send('Emulation.setDeviceMetricsOverride', { width:w,height:h,deviceScaleFactor:1,mobile:true });
    await read(`document.documentElement.style.setProperty('--test-safe-top','20px');document.documentElement.style.setProperty('--test-safe-right','24px');document.documentElement.style.setProperty('--test-safe-bottom','20px');document.documentElement.style.setProperty('--test-safe-left','24px');document.getElementById('settings').classList.add('open')`);
    const layout = await read(`(()=>{const root=document.getElementById('endingFrame');return [...root.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,x:r.x,y:r.y,w:r.width,h:r.height,top:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b,inert:document.getElementById('settings').inert}})})()`);
    for (const b of layout) assert.ok(b.h>=56&&b.x>=24&&b.y>=20&&b.x+b.w<=w-24+.1&&b.y+b.h<=h-20+.1&&b.top&&b.inert, `${w}x${h}: safe, full button, above settings ${JSON.stringify(b)}`);
    const frozen = await read(`({x:jt.c.x,z:jt.c.z,elapsed:jt.shift.elapsed})`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:h-5,id:1}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await read('jt.frame()');
    assert.deepEqual(await read(`({x:jt.c.x,z:jt.c.z,elapsed:jt.shift.elapsed})`),frozen,'touch cannot drive through modal');
    await shot(`offer-phone-${w}x${h}`);
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await read(`for(const edge of ['top','right','bottom','left'])document.documentElement.style.removeProperty('--test-safe-'+edge);document.querySelector('#endingChoices button').focus()`);
  await key('Enter','Enter',13);
  assert.ok(await read('jt.endings.finished && !jt.shift.ended && !jt.c.car.beacon.visible'), 'take job ends without a shift report and beacon');
  assert.equal(await read('localStorage.getItem("mmm.shift.v1")===window.savedCareer'),true,'ending awards no daily pay or career update');
  assert.deepEqual(await read('JSON.parse(localStorage.getItem("mmm.endings"))'), ['float-driver']);
  const startCam=await read('jt.camera.position.toArray()'), startTurn=await read('jt.camera.quaternion.toArray()');
  await read('for(let i=0;i<180;i++)jt.frame()'); const midCam=await read('jt.camera.position.toArray()');
  assert.ok(midCam[1]>startCam[1]+5,'ending camera rises'); assert.notDeepEqual(midCam,startCam); assert.notDeepEqual(await read('jt.camera.quaternion.toArray()'),startTurn,'ending camera turns');
  await shot('end-mid-move');
  await read('for(let i=0;i<240;i++)jt.frame()');await shot('end-card');
  for (const [w,h] of [[390,844],[844,390]]) {
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});
    assert.ok(await read(`(()=>{const b=document.querySelector('#endingChoices button'),r=b.getBoundingClientRect();return r.height>=56&&r.top>=12&&r.bottom<=innerHeight-12&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b})()`), 'end card phone button');
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await key('Space',' ',32);
  assert.ok(await read(`!jt.endings.busy && jt.shift.career.day===1 && jt.shift.career.pay===0 && jt.shift.career.warnings===0 && !jt.shift.ended && jt.c.car.beacon.visible && JSON.parse(localStorage.getItem('mmm.shift.v1')).day===1`), 'Space starts over through the settings career reset');
  assert.equal(await read('JSON.parse(localStorage.getItem("mmm.endings")).length'),1,'found endings survive career reset');
  await read(`[...document.querySelectorAll('#settings button')].find(b=>b.textContent==='Controls, credits and data').click()`);
  assert.equal(await read('document.getElementById("waysOut").textContent'), 'Ways out found: 1');await shot('title-found');

  await load('');
  assert.equal((await read('jt.drive(99,true)')).jumps,0,'hook placement is excluded without explicit opt-in');
  await load('&jumpCheck=1&demo=1');
  assert.equal((await read('jt.drive(99,true)')).jumps,0,'demo is excluded even with placement opt-in');
  await load('&jumpCheck=1'); await key('KeyF','f',70);
  assert.equal((await read('jt.drive(99,true)')).jumps,0,'fly camera is excluded');
  // The lot rises past the ramp and "Hill height" stretches that rise: the marked run-up must work at every setting the slider has.
  for (const hill of [1, 2, 2.5]) {
    await load('&jumpCheck=1&exag=' + hill);
    const run = await read('jt.drive(99,true)');
    console.log(`Hill height ${hill}: launch ${(run.launch.speed*3.6).toFixed(1)} km/h, clearance ${run.minClear.toFixed(3)} m`);
    assert.ok(run.offer && run.contacts === 0 && run.minClear > 0.1, `Hill height ${hill}: full run-up clears the load (${JSON.stringify({clear:run.minClear,contacts:run.contacts,offer:run.offer})})`);
  }
  await load('&jumpCheck=1&yard=named');
  assert.ok((await read('jt.drive(99,true)')).offer,'named mode also offers');
  assert.equal(await read('document.querySelector("#endingCard .endingTag").textContent'),'The foreman');
  await load('&jumpCheck=1&yard=closed');
  assert.ok(await read('jt.yard.jumpLoad.length===0 && jt.yard.rampBack.length===0 && jt.yard.site.rampBase===null'), 'closed: no ramp or obstacle');
  assert.equal((await read('jt.drive(99,true)')).offer,false,'closed: no offer');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS real slow/fast jumps, every hill height, pause, decline/repeat, acceptance/camera/storage/reset, title, hooks/demo/fly/closed, safe phone cards, Enter/Space/Tab.');
} finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close(); }
