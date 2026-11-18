// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
async function shot(name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, 'base64'));
}
async function page(phone = false, query = '') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await c.send('Page.navigate', { url: new URL(`/?x=1&hud=1&radio=0&res=1&scene=0&at=623766,5103484,45&${phone ? 'touch=1&q=low&' : ''}${query}`, first).href });
  let ready = false;
  for (let i = 0; i < 360; i++) {
    await sleep(500);
    ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.shift");
    if (ready) break;
  }
  assert.equal(ready, true, 'Mabou settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
  await read("document.getElementById('titleStart')?.click();document.activeElement?.blur();window.busRAF=requestAnimationFrame;requestAnimationFrame=f=>{window.busFrame=f;return 0}");
  await sleep(120);
}
async function setup() {
  return read(`(async()=>{
    const {BUS}=await import('/src/school-bus-rules.ts');const stop=BUS.stop;
    const {schoolBus:s,vehicle:v,shift}=mmm;
    s.reset(); shift.elapsed=0; s.setPaused(false); v.damageActive=true;
    const pose={x:0,z:0,heading:0};
    const place=(along,side=-1.8,reverse=false)=>{s.road.at(along,side,pose);v.restart(pose.x,pose.z,pose.heading+(reverse?Math.PI:0));v.assist=0;v.damageActive=true;};
    place(stop-45);s.step(stop/BUS.speed,v,true,0);
    const tick=(seconds,drive=false,reverse=false)=>{
      for(let i=0;i<Math.round(seconds*120);i++) {
        let input={throttle:0,steer:0,handbrake:true};
        if(drive){const along=s.road.alongAt(v.x,v.z);s.road.at(along+(reverse?-7:7),-1.8,pose);
          const heading=Math.atan2(pose.x-v.x,-(pose.z-v.z));const error=Math.atan2(Math.sin(heading-v.heading),Math.cos(heading-v.heading));
          input={throttle:v.speed<5?1:0,steer:Math.max(-1,Math.min(1,error*2.5)),handbrake:false};}
        mmm.driveVehicle(1/120,input);
      }
      return {score:s.score,along:s.rules.along,wait:s.rules.wait,calls:shift.complaints.all.length,x:v.x,z:v.z};
    };
    const view=()=>{const {camera:c,renderer:r,terrain:t}=mmm;
      const h=s.solid.heading,range=c.aspect<1?1.4:1;
      c.position.set(s.solid.x+range*(14*Math.sin(h)-14*Math.cos(h)),(t.heightAt(s.solid.x,s.solid.z)??0)+5,s.solid.z+range*(-14*Math.cos(h)-14*Math.sin(h)));
      c.lookAt(s.solid.x,(t.heightAt(s.solid.x,s.solid.z)??0)+1.4,s.solid.z);c.updateMatrixWorld();s.update(c);shift.refreshUI(v);r.render(mmm.scene,c);};
    window.busQA={place,tick,view,stop};view();
    return {road:s.road.points.length,length:s.rules.length,flashing:s.rules.flashing,visible:s.group.visible};
  })()`);
}
try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  for (const phone of [false, true]) {
    await page(phone); const start = await setup();
    assert.ok(start.length > 350 && start.length < 450); assert.equal(start.flashing, true); assert.equal(start.visible, true);
    assert.equal(await read('mmm.schoolBus.art.arm.visible'), true, 'stop arm is out');
    const lamps = await read('mmm.schoolBus.art.lamps.map(l=>l.visible)');
    assert.equal(lamps.filter(Boolean).length, 1, 'one red lamp bank at a time');
    await read('busQA.tick(.5);busQA.view()');
    assert.notDeepEqual(await read('mmm.schoolBus.art.lamps.map(l=>l.visible)'), lamps, 'red lamp banks alternate');
    await read('busQA.place(busQA.stop-17);mmm.schoolBus.step(1/120,mmm.vehicle,true,0);busQA.view()'); await shot(phone ? 'school-bus-phone' : 'school-bus-desktop');
    const wait = await read('busQA.tick(2)'); assert.equal(wait.score, 0); assert.equal(wait.along, 180); assert.ok(wait.wait > 17.4);
    const pass = await read('busQA.tick(9,true)'); console.log(phone ? 'phone pass' : 'desktop pass', pass);
    assert.equal(pass.score, -100, 'real driving past red lights deducts points'); assert.equal(pass.calls, 0, 'score penalty adds no career complaint');
    assert.equal(await read('mmm.shift.roadsideScore'), -100);
    await read('busQA.view()'); await shot(phone ? 'school-bus-phone-penalty' : 'school-bus-desktop-penalty');
    assert.match(await read('mmm.schoolBus.hint'), /-100 points/);
    const stopped = await read(`(()=>{const s=mmm.schoolBus,wait=s.rules.wait;
      document.getElementById('endShift').click();mmm.driveVehicle(.05,{throttle:1,steer:0,handbrake:false});
      return {before:wait,after:s.rules.wait,paused:s.paused};})()`);
    assert.equal(stopped.before, stopped.after, 'report pauses the real driving path');
    assert.equal(stopped.paused, true, 'Shift pauses its registered roadside actor');
    await read('mmm.shift.ended=false');
    await read('mmm.schoolBus.reset();mmm.schoolBus.update(mmm.camera)'); assert.equal(await read('mmm.schoolBus.score'), 0);
    await read('mmm.schoolBus.notice=6;mmm.shift.elapsed=7200;mmm.schoolBus.update(mmm.camera)'); assert.equal(await read('mmm.schoolBus.group.visible'), false, 'bus leaves at noon');
    assert.equal(await read('mmm.schoolBus.hint'), '', 'no stale penalty hint after noon');
    await page(phone);await setup();
    await read('busQA.place(busQA.stop+17,-1.8,true)');
    const oncoming=await read('busQA.tick(9,true,true)');
    assert.equal(oncoming.score,-100,'real oncoming pass deducts points');
    console.log('PASS Mabou', phone ? 'phone' : 'desktop', '20 s stop, real pass, score, pause, reset, noon');
  }
  await page(false, 'mode=explore'); assert.equal(await read('mmm.schoolBus'), null, 'no shift clock or scoring in free drive');
  await page(false, 'era=1884'); assert.equal(await read('mmm.schoolBus'), null, 'no modern bus in 1884');
  assert.deepEqual(errors, [], 'runtime exceptions');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(()=>{}); }
