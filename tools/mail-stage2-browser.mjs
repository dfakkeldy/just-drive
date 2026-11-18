// Run only through tools/yard-shots.sh and its tools/browser.sh browser lease.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const [out, url] = process.argv.slice(2), port = process.env.CDP_PORT;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const c = await cdp(tab.webSocketDebuggerUrl);
const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const key = async code => {
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: code.slice(3).toLowerCase() });
  await sleep(90);
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: code.slice(3).toLowerCase() });
};
const shot = async name => {
  await read(`window.stage2RAF=requestAnimationFrame;window.requestAnimationFrame=callback=>{window.stage2Frame=callback;return 0;}`);
  await sleep(150);
  try {
    await read(`(()=>{const {camera,renderer,scene,props,terrain}=mmm,p=props.mail[window.stage2Index];
      const h=p.heading*Math.PI/180,nx=Math.sin(h),nz=-Math.cos(h),y=terrain.heightAt(p.x,p.z);
      camera.position.set(p.x+nx*4.5+nz*2.2,y+2.7,p.z+nz*4.5-nx*2.2);
      camera.lookAt(p.x,y+.8,p.z);camera.updateMatrixWorld();props.update(camera,0);renderer.render(scene,camera);})()`);
    const result = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/${name}.png`, Buffer.from(result.result.data, 'base64'));
  } finally { await read(`window.requestAnimationFrame=stage2RAF;if(window.stage2Frame)stage2RAF(stage2Frame);`); }
};

try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  for (const [width, height, touch] of [[1280, 900, false], [390, 844, true]]) {
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: 5 });
    const target = new URL(url); target.searchParams.set('mode', 'mail'); target.searchParams.set('hud', '1');
    target.searchParams.set('radio', '0'); target.searchParams.set('q', touch ? 'low' : 'high');
    if (touch) target.searchParams.set('touch', '1');
    await c.send('Page.navigate', { url: target.href });
    let ready = false;
    for (let i = 0; i < 240; i++) { await sleep(500); if (await read(`document.title.startsWith('settled') && !!window.mmm?.shift?.mail`)) { ready = true; break; } }
    assert.ok(ready, 'mail shift settles');
    for (const code of ['KeyM', 'KeyE']) {
      await sleep(300);
      const before = await read('mmm.shift.mail.thrown'); await key(code);
      assert.ok(await read('mmm.shift.mail.thrown') > before, code + ' throws real mail');
    }
    if (touch) {
      const point = await read(`(()=>{const r=document.getElementById('mailButton').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      const before = await read('mmm.shift.mail.thrown');
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, ...point }] });
      await sleep(350); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.ok(await read('mmm.shift.mail.thrown') > before, 'phone mail button throws');
    }
    const index = await read(`(()=>{const {props,terrain,vehicle}=mmm;
      window.stage2Sites=props.mail.map(p=>[p.x,p.z,p.heading]);
      const ranked=props.mail.map((p,i)=>({i,d:Math.hypot(p.x-vehicle.x,p.z-vehicle.z)})).sort((a,b)=>a.d-b.d);
      return window.stage2Index=ranked.find(({i})=>terrain.heightAt(props.mail[i].x,props.mail[i].z)!==null&&mmm.shift.mail.service.condition(i)==='ready'&&!props.mail[i].motion.down)?.i??-1;})()`);
    assert.ok(index >= 0, 'a real loaded roadside mailbox is available');
    const aim = await read(`(window.stage2Pose=()=>{const {props,vehicle:v,shift}=mmm,p=props.mail[stage2Index],mail=shift.mail;
      mail.reset();const h=(p.heading-270)*Math.PI/180,rx=Math.cos(h),rz=Math.sin(h),fx=Math.sin(h),fz=-Math.cos(h);
      for(const side of [2.9,3.1,3.4])for(let ahead=-.8;ahead<=.8;ahead+=.04){
        v.place(p.x-rx*side-fx*ahead,p.z-rz*side-fz*ahead,h);mail.prepareThrow(v,0);
        if(mail.cue){window.stage2Index=mail.cueIndex;return {side,ahead,index:mail.cueIndex};}
      }return null;})()`);
    assert.ok(aim, 'a real due box has a throw-now pose');
    await key('KeyM');
    const flight = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/mail-stage2-throw-${width}.png`, Buffer.from(flight.result.data, 'base64'));
    await sleep(1400);
    assert.ok(await read('mmm.shift.mail.delivered') > 0, 'real M input delivers through a due opening');
    const remaining = await read('mmm.shift.remaining[stage2Index]');
    assert.ok(remaining > 0, 'the day-one stop has another physical piece due');
    await read(`(()=>{const {shift,props,camera}=mmm,i=stage2Index;shift.today.down[i]=true;props.knockMailbox(i,0,0,true);props.mail[i].motion.angle=Math.PI*.49;props.update(camera,2);})()`);
    assert.ok(await read('stage2Pose()'), 'a marked pre-existing down stop has a ground-drop pose');
    await key('KeyM'); await sleep(1400);
    assert.equal(await read('mmm.shift.remaining[stage2Index]'), remaining-1, 'real M ground drop serves the pre-existing stop');
    assert.equal(await read('mmm.shift.mail.lawn+mmm.shift.mail.ditch'), 0, 'authorised down-stop drop is not scored as a miss');
    await shot(`mail-stage2-pre-existing-${width}`);

    const records = [];
    for (const [speed, damage, name] of [[1, 1, 'lean'], [3, 2, 'dent'], [8, 3, 'down']]) {
      const actual = await read(`(()=>{const {props,vehicle:v,shift,terrain,camera}=mmm,p=props.mail[stage2Index],mail=shift.mail;
        props.resetShift();mail.reset();v.place(p.x,p.z,0);v.vx=${speed};v.vz=0;
        mail.update(1/60,v,false);v.place(p.x-5,p.z+5,0);props.update(camera,2);
        return {damage:p.motion.damage,down:props.downCount,site:[p.x,p.z],misses:mail.lawn+mail.ditch};})()`);
      assert.equal(actual.damage, damage, name + ' through real Mail.update car contact');
      records.push(actual); await shot(`mail-stage2-${name}-${width}`);
    }
    assert.equal(await read('JSON.stringify(mmm.props.mail.map(p=>[p.x,p.z,p.heading]))===JSON.stringify(stage2Sites)'), true, 'all mailbox sites and headings stay fixed');
    await read(`mmm.shift.startOver()`);
    assert.equal(await read('mmm.props.mail[stage2Index].motion.damage'), 0, 'new shift clears player damage');
    assert.equal(await read('mmm.shift.mail.lawn+mmm.shift.mail.ditch'), 0, 'new shift clears missed throws');
    assert.equal(await read('document.documentElement.scrollWidth>innerWidth'), false, 'no viewport overflow');
    writeFileSync(`${out}/mail-stage2-${width}.json`, JSON.stringify({ width, height, index, aim, records }, null, 2));
    console.log(`PASS Stage 2 ${width}x${height}: M/E${touch ? '/touch' : ''}, lane-centre delivery, pre-existing ground drop, real car contacts, lean/dent/down pictures, unchanged sites and next shift`);
  }
  assert.equal(c.errors.length, 0, 'no page errors');
} finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); c.close(); }
