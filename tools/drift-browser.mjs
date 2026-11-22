// Only run through tools/yard-shots.sh, which owns tools/browser.sh and its shared slot.
// One scripted drift on a real gravel road, on the real frame loop, through the real controls: on the desktop the keys
// (Space and a turn, then the throttle and counter-steer), on a LOW phone GO and BRAKE held together, then GO and the
// thumb. Each time: the slide starts, holds and ends, the meter shows only while it lasts, dust leaves the rear wheels,
// the tyres change their sound, and the drift reaches the score stream; in Get Fired it scores. Mail play and Just Drive
// drift too. Pictures of each slide are kept in the output folder.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const errors = [];
const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 300000, onEvent: e => {
  if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
} });
const read = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r));
  return r.result.result.value;
};
const shot = async name => writeFileSync(`${out}/${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const CODES = { ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Space: 32 };
const key = (type, code) => c.send('Input.dispatchKeyEvent', { type, code, key: code === 'Space' ? ' ' : code, windowsVirtualKeyCode: CODES[code] ?? 0 });
const touch = async (type, touchPoints) => { const r = await c.send('Input.dispatchTouchEvent', { type, touchPoints }); assert.ok(!r.error, JSON.stringify(r.error)); };
const settle = async () => { for (let i = 0; i < 160; i++) { await sleep(500); if (await read("document.documentElement.dataset.mmmReady === 'true'")) return; } throw Error('no settle'); };
async function page(phone, query, host = '127.0.0.1') {
  await c.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 800, deviceScaleFactor: 1, mobile: phone });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: phone, maxTouchPoints: 5 });
  const url = new URL(`/?x=1&title=1&hud=1&radio=0&res=1&scene=0&day=1&run=1&${phone ? 'touch=1&q=low&' : ''}${query}`, first); url.hostname = host;
  await c.send('Page.navigate', { url: url.href });
  let ready = false;
  for (let i = 0; i < 360 && !ready; i++) { await sleep(500); ready = await read("document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.vehicle && !!window.mmm?.driftFeedback"); }
  assert.equal(ready, true, 'the page settles');
  assert.equal(await read("!!document.querySelector('vite-error-overlay')"), false);
  if (await read("!!document.getElementById('titleStart')")) { await read("document.getElementById('titleStart').click();document.activeElement?.blur()"); await sleep(400); }
}
// The nearest straight 140 m of gravel road (kind 3, no washboard, no bridge), with both ends on ordinary ground.
// Every straight 140 m of gravel road clear of protected places, nearest first.
const findGravel = `(()=>{const {roads:r,vehicle:v,shift:s}=mmm;const found=[];
  for(const road of r.roads){if(road.kind!==3||road.bridge||road.washboard)continue;const p=road.pts;
    for(let i=0;i+1<p.length;i++){let len=0,j=i,ok=true;const h0=Math.atan2(p[i+1][0]-p[i][0],-(p[i+1][1]-p[i][1]));
      while(j+1<p.length&&len<140){const dx=p[j+1][0]-p[j][0],dz=p[j+1][1]-p[j][1],h=Math.atan2(dx,-dz);
        if(Math.abs(Math.atan2(Math.sin(h-h0),Math.cos(h-h0)))>.2){ok=false;break;}len+=Math.hypot(dx,dz);j++;}
      if(!ok||len<140)continue;
      if(s?.placeAt&&(s.placeAt(p[i][0],p[i][1])!=='route'||s.placeAt(p[j][0],p[j][1])!=='route'))continue;
      found.push({d:Math.hypot(p[i][0]-v.x,p[i][1]-v.z),x:p[i][0],z:p[i][1],heading:h0,road:road.name});}}
  found.sort((a,b)=>a.d-b.d);window.driftQAs=found;return found.length;})()`;
// A frame sampler: what the player sees and hears while the drift runs.
const sampler = `(()=>{window.driftLog=[];const tick=()=>{const v=mmm.vehicle,m=document.getElementById('driftMeter'),e=mmm.engineSound?.snapshot;
  driftLog.push({active:v.drift.active,angle:v.drift.angle,ended:v.drift.ended,surface:v.surfaceName,speed:Math.hypot(v.vx,v.vz),
    meter:!!m&&!m.hidden&&getComputedStyle(m).display!=='none',text:m?.textContent??'',dust:mmm.driftFeedback.alive,tyre:e?.built?e.tyre:null,help:v.helpYaw,light:v.lightHelpYaw});
  if(driftLog.length<2000)requestAnimationFrame(tick);};requestAnimationFrame(tick);})()`;
/** Restart on the nearest candidate whose ground really reads gravel under the car (the road list and the ground agree). */
async function onGravel() {
  const count = await read(findGravel);
  assert.ok(count > 0, 'a straight gravel road');
  for (let i = 0; i < Math.min(count, 12); i++) {
    const at = await read(`(window.driftQA=driftQAs[${i}])`);
    await read('mmm.vehicle.restart(driftQA.x,driftQA.z,driftQA.heading)'); await settle();
    await read('mmm.vehicle.restart(driftQA.x,driftQA.z,driftQA.heading)'); await settle(); await sleep(300);
    if (await read('mmm.vehicle.surfaceName') === 'gravel') { await read('mmm.vehicle.restart(driftQA.x,driftQA.z,driftQA.heading)'); return at; }
    console.log('not gravel underfoot, next', JSON.stringify(at));
  }
  assert.fail('no gravel road with gravel under the car');
}
const launch = speed => read(`(()=>{const v=mmm.vehicle,h=driftQA.heading;v.vx=${speed}*Math.sin(h);v.vz=-${speed}*Math.cos(h);v.speed=${speed};return v.surfaceName})()`);
function verdict(name, log, facts) {
  const sliding = log.filter(s => s.active), before = log.slice(0, log.findIndex(s => s.active)), after = log.slice(log.findLastIndex(s => s.active) + 1);
  assert.ok(sliding.length > 20, `${name}: the slide lasted ${sliding.length} frames`);
  const peak = Math.max(...sliding.map(s => Math.abs(s.angle))) * 180 / Math.PI;
  assert.ok(peak > 15, `${name}: peak angle ${peak}`);
  assert.ok(after.length > 10 && after.every(s => !s.active), `${name}: it ended and stayed ended`);
  assert.ok(['straightened', 'slowed', 'hit'].includes(after.at(-1).ended), `${name}: ended ${after.at(-1).ended}`);
  assert.ok(sliding.filter(s => s.meter).length > sliding.length * .8, `${name}: the meter shows while sliding`);
  assert.ok(before.every(s => !s.meter) && after.slice(5).every(s => !s.meter), `${name}: and only then`);
  assert.match(sliding.find(s => s.meter).text, /^DRIFT\d+° · \d+ m$/);
  assert.ok(Math.max(...sliding.map(s => s.dust)) > 3, `${name}: dust from the rear wheels`);
  assert.equal(log.at(-1).dust, 0, `${name}: the dust settles`);
  assert.ok(sliding.every(s => s.help === 0 && s.light === 0), `${name}: no steering help acts in the slide`);
  const rolling = before.filter(s => s.tyre !== null).map(s => s.tyre), slid = sliding.filter(s => s.tyre !== null).map(s => s.tyre);
  if (rolling.length && slid.length) assert.ok(Math.max(...slid) > Math.max(...rolling) * 1.25, `${name}: the tyres sound different ${Math.max(...rolling)} ${Math.max(...slid)}`);
  else console.log(name, 'engine sound not built in this browser: tyre sound unchecked here (drift-rules holds its numbers)');
  assert.ok(facts, `${name}: the drift reached the score stream`);
  // Begun on the gravel road; a drift curves its path, so on this straight test road it may run out onto the grass shoulder.
  assert.equal(sliding[0].surface, 'gravel', `${name}: the drift began on gravel`);
  assert.ok(['gravel', 'grass'].includes(facts.drift.surface), `${name}: mostly on ${facts.drift.surface}`); assert.ok(facts.drift.length > 6 && facts.drift.seconds > .6);
  console.log(name, JSON.stringify({ frames: sliding.length, peak: +peak.toFixed(1), ended: after.at(-1).ended, dust: Math.max(...sliding.map(s => s.dust)),
    tyre: [rolling.length ? Math.max(...rolling) : null, slid.length ? Math.max(...slid) : null], facts: facts.drift }));
}
// The newest drift fact: from the score stream, or (Just Drive has no shift and no stream) straight from the ride.
const lastDrift = "(()=>{const r=mmm.shift?.score?.recent;if(r)return r.filter(e=>e.kind==='drift').at(-1)??null;const f=mmm.vehicle.takeDrift();return f?{kind:'drift',place:'route',drift:f}:null})()";
// Every HUD piece and control by id (phone-layout.ts #phoneHud is only the full-screen grid that holds the phone ones).
const overlap = `(()=>{const a=document.getElementById('driftMeter').getBoundingClientRect();
  return ['hud','shiftHud','stopHint','miniMap','relief','radio','photoTag','mailScore','endShift','pauseButton','gear','credit','mailButton','cameraButton','firedHud','firedNote','phoneStatus','phoneTop','tcSteer','tcGo','tcBrake','tcReset','tcView','tcHorn','placesButton'].filter(id=>{
    const e=document.getElementById(id);if(!e)return false;const s=getComputedStyle(e),b=e.getBoundingClientRect();
    return s.display!=='none'&&s.visibility!=='hidden'&&b.width>0&&a.top<b.bottom&&b.top<a.bottom&&a.left<b.right&&b.left<a.right;});})()`;
const inside = "(()=>{const r=document.getElementById('driftMeter').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()";

async function keyboardDrift(name, pictures) {
  assert.ok(await read(`document.getElementById('endShift').classList.contains('inPanel')&&document.getElementById('endShift').getBoundingClientRect().width===0`),'END SHIFT stays in closed Settings');
  const at = await onGravel(); console.log(name, 'gravel', JSON.stringify(at));
  const before = await read(lastDrift);
  await key('keyDown', 'ArrowUp'); assert.equal(await launch(16), 'gravel', 'standing on gravel');
  await read(sampler); await sleep(150);
  // Handbrake and the wheel right: the tail swings out.
  await key('keyDown', 'Space'); await key('keyDown', 'ArrowRight'); await sleep(350);
  await key('keyUp', 'Space'); await key('keyUp', 'ArrowRight');
  // Throttle held, counter-steer held: the slide holds wide; then the wheel straight.
  await key('keyDown', 'ArrowLeft');
  for (let i = 0; i < 3; i++) { await sleep(250); if (pictures) await shot(`drift-${name}-${i + 1}`); }
  if (pictures) { assert.deepEqual(await read(overlap), [], `${name}: the meter covers no other HUD piece`); assert.equal(await read(inside), true); }
  await key('keyUp', 'ArrowLeft'); await sleep(1600); await key('keyUp', 'ArrowUp'); await sleep(1200);
  const facts = await read(lastDrift);
  assert.notDeepEqual(facts, before, `${name}: a new drift fact`);
  verdict(name, await read('driftLog'), facts);
  return facts;
}

try {
  await c.send('Runtime.enable'); await c.send('Page.enable');
  // Get Fired, desktop keys: the drift scores, with the clean bonus when nothing was hit.
  await page(false, 'mode=fired');
  const desktop = await keyboardDrift('desktop', true);
  const book = await read("(()=>{const k=mmm.fired.book.kinds.get('drift');return {points:k?.points??0,count:k?.count??0,total:mmm.fired.book.total}})()");
  console.log('desktop book', JSON.stringify(book));
  if (desktop.place === 'route' && !desktop.subject) assert.ok(book.points > 0 && book.count >= 1, 'Get Fired scores the drift');
  const line = await read("document.getElementById('firedHud').textContent");
  if (desktop.drift.clean) assert.match(line, /Sideways down the road · clean/, 'the clean bonus is named');

  // Get Fired on a LOW phone: GO and BRAKE together are the handbrake.
  await page(true, 'mode=fired');
  assert.ok(await read(`document.getElementById('endShift').classList.contains('inPanel')&&document.getElementById('endShift').getBoundingClientRect().width===0`),'END SHIFT stays in closed Settings');
  const at = await onGravel(); console.log('phone gravel', JSON.stringify(at));
  const pads = await read(`(()=>{const p=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width}};return {steer:p('tcTrack'),go:p('tcGo'),brake:p('tcBrake')}})()`);
  const range = Math.max(60, pads.steer.w * .36);
  const steer = dx => ({ id: 1, x: pads.steer.x + dx, y: pads.steer.y }), go = { id: 2, x: pads.go.x, y: pads.go.y }, brake = { id: 3, x: pads.brake.x, y: pads.brake.y };
  await touch('touchStart', [steer(0), go]); assert.equal(await launch(16), 'gravel');
  await read(sampler); await sleep(150);
  await touch('touchMove', [steer(range), go]);
  // Held a moment (drift-rules.ts CHORD_SECONDS), GO and BRAKE together are the handbrake.
  await touch('touchStart', [steer(range), go, brake]); await sleep(260);
  assert.equal(await read('mmm.vehicle.drift.active || mmm.vehicle.drift.ended !== ""'), true, 'GO and BRAKE together with a turn start the slide');
  await sleep(90);
  await touch('touchMove', [steer(-range * .55), go]);
  for (let i = 0; i < 3; i++) { await sleep(250); await shot(`drift-phone-${i + 1}`); }
  assert.deepEqual(await read(overlap), [], 'phone: the meter covers no other control or HUD piece');
  assert.equal(await read(inside), true);
  await touch('touchMove', [steer(0), go]); await sleep(1600); await touch('touchEnd', []); await sleep(1200);
  verdict('phone', await read('driftLog'), await read(lastDrift));
  assert.equal(await read('mmm.vehicle.drift.active'), false);

  // Mail play: the same drift; the stream records it and nothing scores it.
  await page(false, 'mode=mail');
  await keyboardDrift('mail', false);
  assert.equal(await read('mmm.fired'), null);
  // Just Drive: drifting is on there too.
  await page(false, 'site=just', 'localhost');
  await keyboardDrift('just-drive', true);
  assert.deepEqual(errors, [], 'runtime exceptions');
  console.log('PASS drift: desktop keys and phone pedals on a real gravel road; Get Fired scores it; mail play and Just Drive drift too');
} finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {}); }
