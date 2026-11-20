#!/usr/bin/env node
// The camera drone in a real browser (web/src/drone.ts, drone-rules.ts), flown with the keyboard alone and then with
// the phone sticks. Desktop: F lifts it off the roof and the car stays put; Space climbs; W flies forward; ←/→ turn;
// ↑/↓ tilt the camera and do not move it; no mail is thrown from it; R flies it home and it lands on the roof; F lands
// at once; the arrows drive the car again afterwards. Phone: DRONE beside Pause launches it, the two sticks fly it,
// RETURN twice lands it, and the driving controls come back. Pictures (and a frame-by-frame recording with RECORD=1)
// go to the output folder.
// Usage: RUN=drone-browser.mjs VIEWS="drone|radio=0" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';

const [outDir, first] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const RECORD = process.env.RECORD === '1';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures.push(label); };

async function page(width, height, touch) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 240000 });
  const errors = [];
  const read = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  const until = async (expr, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await read(expr)) return true; await sleep(80); } return !!(await read(expr)); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Runtime.evaluate', { expression: 'window.addEventListener("error",e=>{(window.qaErrors??=[]).push(String(e.message))})' });
  const codes = { Space: ' ', ArrowUp: '', ArrowDown: '', ArrowLeft: '', ArrowRight: '', ShiftLeft: '' };
  const vk = { Space: 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ShiftLeft: 16 };
  const key = async (code, down) => {
    const k = code in codes ? (code.startsWith('Arrow') ? code : code === 'Space' ? ' ' : 'Shift') : code.slice(3).toLowerCase();
    await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: k, windowsVirtualKeyCode: vk[code] ?? k.toUpperCase().charCodeAt(0) });
  };
  const hold = async (code, ms) => { await key(code, true); await sleep(ms); await key(code, false); };
  const tap = (code) => hold(code, 40);
  const frames = [];
  const shot = async (name) => {
    const data = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
    writeFileSync(`${outDir}/${name}.png`, Buffer.from(data, 'base64'));
  };
  let recording = null;
  const record = async (name, every = 120) => {
    if (!RECORD) return async () => {};
    mkdirSync(`${outDir}/${name}`, { recursive: true });
    let n = 0, on = true;
    recording = (async () => { while (on) { const d = (await send('Page.captureScreenshot', { format: 'jpeg', quality: 62 })).result.data; writeFileSync(`${outDir}/${name}/${String(n++).padStart(4, '0')}.jpg`, Buffer.from(d, 'base64')); await sleep(every); } })();
    return async () => { on = false; await recording; frames.push([name, n]); };
  };
  const touchAt = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
  const centre = async (id) => JSON.parse(await read(`JSON.stringify((r=>({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}))(document.getElementById('${id}').getBoundingClientRect()))`));
  const load = async (extra) => {
    const url = new URL(first);
    url.searchParams.set('hud', '1'); url.searchParams.set('title', '1'); url.searchParams.set('radio', '0');
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    await send('Page.navigate', { url: url.href });
    assert.ok(await until(`!!document.getElementById('titleStart')`, 240000), 'title card');
    await read(`document.getElementById('titleStart').click();document.activeElement?.blur()`);
    assert.ok(await until(`String(document.title).startsWith('settled')`, 300000), 'settled after start');
    await sleep(800);
  };
  const close = async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); };
  return { send, read, until, key, hold, tap, shot, record, touchAt, centre, load, close, errors };
}

const state = `JSON.stringify({active:mmm.drone.active,returning:mmm.drone.returning,x:mmm.drone.state.x,y:mmm.drone.state.y,z:mmm.drone.state.z,yaw:mmm.drone.state.yaw,
  speed:Math.hypot(mmm.drone.state.vx,mmm.drone.state.vz),pitch:mmm.drone.pitch,height:mmm.drone.height,distance:mmm.drone.distance,
  car:{x:mmm.vehicle.x,z:mmm.vehicle.z,y:mmm.vehicle.y,speed:mmm.vehicle.speed},hud:document.getElementById('hud').textContent,
  tcOn:document.body.classList.contains('tcOn'),delivered:mmm.shift?.mail?.delivered??null,mail:document.getElementById('mailButton')?.hidden??null})`;

async function flightMap(p, phone) {
  const sample=await p.read(`(()=>{const e=document.getElementById('miniMap'),r=e.getBoundingClientRect(),c=document.getElementById('miniMapCanvas'),g=c.getContext('2d');window.flightMapSample=null;const map=mmm.miniMap,original=map.update.bind(map);map.update=(...args)=>{window.flightMapSample=args;return original(...args)};const fill=g.fillText.bind(g);window.flightNorth=0;g.fillText=(text,...args)=>{if(text==='N')flightNorth++;return fill(text,...args)};return {visible:!e.hidden&&r.width>0&&r.height>0,parent:e.parentElement===document.body,folded:e.classList.contains('folded')}})()`);
  check(sample.visible&&sample.parent&&!sample.folded,'flight map is open and painted outside the hidden driving HUD');
  await sleep(400);
  check(await p.read(`flightNorth>0&&Math.abs(flightMapSample[1]-mmm.drone.state.x)<2&&Math.abs(flightMapSample[2]-mmm.drone.state.z)<2&&Math.abs(flightMapSample[3]+mmm.drone.state.yaw)<.1&&flightMapSample[7]===mmm.vehicle`),'map follows drone position and heading, paints north and marks the parked car');
  if(phone)check(await p.read(`(()=>{const b=document.getElementById('miniMap').getBoundingClientRect();return ['droneLeft','droneRight','droneReturn','hud','gear','pauseButton'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return b.right<=r.left||b.left>=r.right||b.bottom<=r.top||b.top>=r.bottom})})()`),'phone flight map clears sticks, Return, chip, Pause and gear');
}

// ---- desktop, keyboard only -------------------------------------------------------------------------
{
  const p = await page(1280, 720, false);
  await p.load({ q: 'high' });
  // On the paved road nearest Mabou village's centre (the land's origin), so the flight passes over the village.
  await p.read(`(()=>{const r=mmm.roads.nearest(0,0,400,r=>r.kind<=2);if(!r)throw Error('no village road');mmm.vehicle.place(r.x,r.z,r.heading);mmm.driveVehicle(0,{throttle:0,steer:0,handbrake:true});})()`);
  await sleep(1000); await p.until(`String(document.title).startsWith('settled')`, 120000); await sleep(800);
  const s = async () => JSON.parse(await p.read(state));
  const stop = await p.record('rec-desktop');
  const parked = await s();
  console.log('START', JSON.stringify(parked.car), 'from the village centre', Math.hypot(parked.car.x, parked.car.z).toFixed(0), 'm');
  await p.tap('KeyF');
  check(await p.until('mmm.drone.active'), 'F launches the drone');
  await sleep(1600);
  await flightMap(p, false);
  check(await p.read(`!document.getElementById('droneHints').hidden&&document.querySelectorAll('#droneHints kbd').length===8`),'grouped desktop keycaps appear at launch');
  await p.read(`document.getElementById('pauseButton').click();document.querySelector('#pauseKeys summary').click()`);
  check(await p.read(`document.querySelector('#pauseKeys dl').textContent.includes('Mouse wheelTop speed')&&document.querySelector('#pauseKeys dl').textContent.includes('RFly back')`),'pause Keys lists drone controls');
  await p.read(`document.getElementById('resumeGame').click()`);
  let a = await s();
  check(a.y > parked.car.y + 3 && Math.hypot(a.x - parked.car.x, a.z - parked.car.z) < 0.5, `it lifts straight off the roof: ${(a.y - parked.car.y).toFixed(1)} m over the car`);
  // ↓ tilts the camera down: the drone and the car below it.
  const pitch0 = a.pitch; await p.hold('ArrowDown', 900); await sleep(300);
  a = await s();
  check(a.pitch < pitch0 - 0.4 && Math.hypot(a.x - parked.car.x, a.z - parked.car.z) < 0.5, `↓ tilts the camera down (${pitch0.toFixed(2)} → ${a.pitch.toFixed(2)}) and does not move the drone`);
  await p.shot('01-desktop-takeoff-looking-down');
  // Space climbs.
  await p.hold('Space', 2500); await sleep(500);
  const climbed = await s();
  check(climbed.height > 12, `Space climbs: ${climbed.height?.toFixed(1)} m above the ground`);
  check(/^DRONE   height \d+ m   distance \d+ m/.test(climbed.hud) && climbed.hud.includes('↑/↓: camera'), 'HUD shows height, distance and the keyboard keys: ' + climbed.hud.split('\n')[0]);
  // ↑ tilts back up, without moving it.
  await p.hold('ArrowUp', 700); await sleep(400);
  a = await s();
  check(a.pitch > climbed.pitch + 0.3 && Math.hypot(a.x - climbed.x, a.z - climbed.z) < 0.5 && a.speed < 0.2, `↑ tilts the camera up (${climbed.pitch.toFixed(2)} → ${a.pitch.toFixed(2)}) and does not fly`);
  // ←: turns left.
  await p.hold('ArrowLeft', 600); await sleep(500);
  const turned = await s();
  check(turned.yaw > a.yaw + 0.5 && Math.hypot(turned.x - a.x, turned.z - a.z) < 0.5, `← turns the drone (${a.yaw.toFixed(2)} → ${turned.yaw.toFixed(2)})`);
  await p.hold('ArrowRight', 600); await sleep(500);
  // W flies forward, level, the way it faces; the car stays put.
  const before = await s();
  await p.hold('KeyW', 3000);
  const moving = await s(); await sleep(2500);
  const after = await s();
  const fx = -Math.sin(before.yaw), fz = -Math.cos(before.yaw), along = (after.x - before.x) * fx + (after.z - before.z) * fz;
  check(along > 20 && Math.abs(after.y - before.y) < 1.5, `W flies forward and level: ${along.toFixed(0)} m, height change ${(after.y - before.y).toFixed(2)} m`);
  check(moving.speed > 8 && after.speed < 0.3, `it brakes to a hover when the key is let go (${moving.speed.toFixed(1)} → ${after.speed.toFixed(2)} m/s)`);
  check(Math.hypot(after.car.x - parked.car.x, after.car.z - parked.car.z) < 0.05, 'the car stays where it was');
  check(after.mail === true, 'no mail button while the drone flies');
  check(await p.read(`!document.getElementById('cameraButton').getClientRects().length`), 'no CAMERA button while the drone flies');
  await p.hold('Space', 3000); await p.hold('ArrowDown', 500); await sleep(800);
  await p.shot('02-desktop-flying-keyboard-only');
  // Over the village: a long straight flight with W at a higher top speed (the wheel), toward the village centre.
  const toVillage = await p.read(`(()=>{const s=mmm.drone.state;return Math.atan2(s.x,s.z)})()`);   // yaw that faces (0,0)
  await p.read(`mmm.drone.state.yaw=${toVillage}`);
  const farFromCar = Math.hypot(parked.car.x, parked.car.z);
  for (let i = 0; i < 3; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 360, deltaX: 0, deltaY: -100 });
  const flyFor = Math.max(2500, Math.min(14000, farFromCar / 25 * 1000));
  await p.hold('KeyW', flyFor); await sleep(2500);
  await p.hold('ArrowUp', 500);
  await p.until(`String(document.title).startsWith('settled')`, 60000);
  const village = await s();
  console.log('VILLAGE', JSON.stringify({ x: village.x, z: village.z, height: village.height, distance: village.distance, fromCentre: Math.hypot(village.x, village.z) }));
  await p.shot('03-desktop-over-mabou-village');
  await p.hold('ArrowDown', 1600); await sleep(400);
  await p.shot('04-desktop-looking-down-over-the-village');
  // R: the flight home; it sets down on the roof and driving resumes.
  await p.tap('KeyR');
  check(await p.until('mmm.drone.returning'), 'R starts the flight home');
  await p.until(`mmm.drone.distance < 25`, 60000);
  await p.shot('05-desktop-coming-home');
  check(await p.until('!mmm.drone.active', 30000), 'the return flight lands it and driving resumes');
  const home = await s();
  check(!home.active && Math.hypot(home.car.x - parked.car.x, home.car.z - parked.car.z) < 0.05, 'back at the car');
  // F twice: up and straight back down.
  await p.tap('KeyF'); await sleep(500); await p.tap('KeyF'); await sleep(300);
  check(!(await s()).active, 'F again lands it at once');
  // A key held through a landing (↑ tilting the camera) does not drive the car off by its key repeat.
  await p.tap('KeyF'); await sleep(800);
  await p.key('ArrowUp', true); await sleep(300); await p.tap('KeyF');
  for (let i = 0; i < 12; i++) { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'ArrowUp', key: 'ArrowUp', windowsVirtualKeyCode: 38, autoRepeat: true }); await sleep(80); }
  const held = await s(); await p.key('ArrowUp', false);
  check(!held.active && Math.abs(held.car.speed) < 0.3, `a held ↑ at landing does not drive the car (${held.car.speed.toFixed(2)} m/s)`);
  // Nor does a key held while driving fly the drone off at launch.
  await sleep(300); await p.key('KeyW', true); await sleep(200); await p.tap('KeyF');
  for (let i = 0; i < 12; i++) { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87, autoRepeat: true }); await sleep(80); }
  const launched = await s(); await p.key('KeyW', false);
  check(launched.active && launched.speed < 0.5, `a W held through launch does not fly the drone off (${launched.speed.toFixed(2)} m/s)`);
  await p.tap('KeyF'); await sleep(300);
  // The arrows drive the car again.
  await p.hold('ArrowUp', 1500);
  const driven = await s(); check(Math.abs(driven.car.speed) > 1 || Math.hypot(driven.car.x - home.car.x, driven.car.z - home.car.z) > 1, 'after landing, ↑ drives the car: ' + driven.car.speed.toFixed(2) + ' m/s');
  await stop();
  const errors = await p.read('window.qaErrors ?? []');
  check(errors.length === 0, 'no page errors: ' + JSON.stringify(errors));
  await p.close();
}

// ---- phone, touch only ------------------------------------------------------------------------------
for (const [w, h, name] of [[390, 844, 'portrait'], [844, 390, 'landscape']]) {
  const p = await page(w, h, true);
  await p.load({ q: 'low', touch: '1' });
  const s = async () => JSON.parse(await p.read(state));
  const button = await p.centre('droneButton');
  check(button.w >= 56 && button.h >= 56, `${name}: DRONE button is a full touch target (${button.w}x${button.h})`);
  const overlap = await p.read(`(()=>{const b=document.getElementById('droneButton').getBoundingClientRect();return ['gear','pauseButton','hud','phoneLine','tcReset','tcView','tcHorn','miniMap','mailButton','cameraButton'].filter(id=>{const e=document.getElementById(id);if(!e||!e.getClientRects().length)return false;const r=e.getBoundingClientRect();return r.width>1&&r.left<b.right-1&&r.right>b.left+1&&r.top<b.bottom-1&&r.bottom>b.top+1;})})()`);
  check(overlap.length === 0, `${name}: DRONE button overlaps nothing ${JSON.stringify(overlap)}`);
  await p.shot(`10-phone-${name}-driving-with-drone-button`);
  const stop = await p.record(`rec-phone-${name}`);
  const parked = await s();
  await p.touchAt('touchStart', [button]); await p.touchAt('touchEnd', []);
  check(await p.until('mmm.drone.active'), `${name}: DRONE launches it`);
  check(await p.until(`!document.body.classList.contains('tcOn') && !document.getElementById('droneLeft').hidden && !document.getElementById('droneRight').hidden && !document.getElementById('droneReturn').hidden`), `${name}: driving controls give way to the two sticks and RETURN`);
  await sleep(1500);
  await flightMap(p, true);
  check(await p.read(`document.querySelector('#droneLeft span').textContent==='Climb · turn'&&document.getElementById('droneReturn').textContent==='Return to car'`),'touch labels explain climb, turn and return');
  // Left stick up: climb.
  const left = await p.centre('droneLeft'), right = await p.centre('droneRight');
  const push = async (c, dx, dy, ms) => {
    await p.touchAt('touchStart', [c]);
    for (let t = 0; t < ms; t += 100) { await p.touchAt('touchMove', [{ x: c.x + dx, y: c.y + dy }]); await sleep(100); }
    await p.touchAt('touchEnd', []);
  };
  const a = await s();
  await push(left, 0, -left.h * 0.4, 2000); await sleep(400);
  const b = await s();
  check(b.y > a.y + 4, `${name}: left stick up climbs (${(b.y - a.y).toFixed(1)} m)`);
  await push(right, 0, -right.h * 0.4, 2500);
  const c = await s();
  check(Math.hypot(c.x - b.x, c.z - b.z) > 10, `${name}: right stick up flies forward (${Math.hypot(c.x - b.x, c.z - b.z).toFixed(0)} m)`);
  await push(left, left.w * 0.4, 0, 800); await sleep(500);
  const d = await s();
  check(d.yaw < c.yaw - 0.3, `${name}: left stick right turns right`);
  await sleep(1500);
  check(/^DRONE height \d+ m\ndistance \d+ m/.test(d.hud) && !d.hud.includes('WASD'), `${name}: phone HUD shows the readout, two short lines, without keys: ${JSON.stringify(d.hud)}`);
  const hidden = await p.read(`['cameraButton','stopHint','mailScore'].filter(id=>{const e=document.getElementById(id);return e&&e.getClientRects().length>0})`);
  check(hidden.length === 0, `${name}: CAMERA, the stop hint and the score give the sticks room ${JSON.stringify(hidden)}`);
  const hudClear = await p.read(`(()=>{const h=document.getElementById('hud').getBoundingClientRect();return ['pauseButton','gear'].filter(id=>{const r=document.getElementById(id).getBoundingClientRect();return h.left<r.right&&h.right>r.left&&h.top<r.bottom&&h.bottom>r.top})})()`);
  check(hudClear.length === 0, `${name}: the readout clears Pause and the gear ${JSON.stringify(hudClear)}`);
  await p.shot(`11-phone-${name}-flying`);
  const ret = await p.centre('droneReturn');
  const sticksClear = await p.read(`(()=>{const ids=['droneLeft','droneRight','droneReturn','gear','pauseButton','miniMap'];const r=ids.map(i=>document.getElementById(i).getBoundingClientRect());const out=[];for(let i=0;i<r.length;i++)for(let j=i+1;j<r.length;j++)if(r[i].left<r[j].right&&r[i].right>r[j].left&&r[i].top<r[j].bottom&&r[i].bottom>r[j].top)out.push(ids[i]+'/'+ids[j]);for(const x of r)if(x.left<0||x.top<0||x.right>innerWidth||x.bottom>innerHeight)out.push('off screen');return out})()`);
  check(sticksClear.length === 0, `${name}: sticks, RETURN, gear and Pause do not overlap and stay on screen ${JSON.stringify(sticksClear)}`);
  await p.touchAt('touchStart', [ret]); await p.touchAt('touchEnd', []);
  check(await p.until('mmm.drone.returning'), `${name}: RETURN flies it home`);
  await sleep(1200);
  await p.shot(`12-phone-${name}-returning`);
  await p.touchAt('touchStart', [ret]); await p.touchAt('touchEnd', []);
  check(await p.until(`!mmm.drone.active && document.body.classList.contains('tcOn') && document.getElementById('droneLeft').hidden`), `${name}: RETURN again lands it and the driving controls come back`);
  const end = await s();
  check(Math.hypot(end.car.x - parked.car.x, end.car.z - parked.car.z) < 0.05, `${name}: the car stayed put`);
  await stop();
  const errors = await p.read('window.qaErrors ?? []');
  check(errors.length === 0, `${name}: no page errors ` + JSON.stringify(errors));
  await p.close();
}

console.log(failures.length ? `DRONE_BROWSER FAIL ${failures.length}: ${failures.join('; ')}` : 'DRONE_BROWSER PASS');
exitCheck(failures.length ? 1 : 0);
