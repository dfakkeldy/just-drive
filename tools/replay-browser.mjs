// Instant replay in the real game (the project brief), desktop and phone: drive on Mabou Harbour Road, knock the car to a
// stop, open the replay (I on desktop; the Pause button and the pause screen's button on the phone), and prove that
// the drawn car follows the path it really drove, that the camera is outside the car and holds the car and the mark
// in frame at the slow moment, that play, pause, scrub, slow motion and close work, that closing puts the car and the
// camera back, and that a clip saves with its caption (where the browser can record). The end card and the day's
// report open the replay too. Pictures, a clip frame and the clip itself are kept as evidence.
// RUN=replay-browser.mjs HUD=1 VIEWS="replay|x=1" tools/yard-shots.sh 1280 800
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const port = process.env.CDP_PORT, base = new URL(process.argv[3]).origin;
const out = join(process.env.MMM_CHECK_OUT ?? process.argv[2], 'evidence/replay');
mkdirSync(out, { recursive: true });
const report = [];

for (const [name, width, height, touch, ride] of [['desktop', 1280, 800, false, 'car'], ['phone', 393, 852, true, 'car'], ['bike', 1280, 800, false, 'bike']]) {
  const full = ride === 'car', viaPause = touch || ride === 'bike';
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 120000 });
  const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
  const key = async (code, k, down = true, up = true) => {
    if (down) await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0 });
    if (up) await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k });
  };
  const tap = async selector => {
    const r = await read(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}})()`);
    assert.ok(r, `${name}: ${selector} exists`);
    assert.ok(r.hit, `${name}: ${selector} is on top where it is drawn`);
    if (touch) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    }
    await sleep(120);
  };
  // Every node of the drawn ride (body, wheels, bones, rider) and the camera, as numbers: equal means exactly restored.
  const rigState = () => read(`(()=>{const a=[];mmm.replayRig.root.traverse(o=>{a.push(...o.position.toArray(),...o.quaternion.toArray(),...o.scale.toArray(),o.visible?1:0);if(o.material&&typeof o.material.emissiveIntensity==='number')a.push(o.material.emissiveIntensity)});const c=mmm.camera;a.push(...c.position.toArray(),...c.quaternion.toArray(),c.fov);return a})()`);
  const shot = async file => { const s = await c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(out, file), Buffer.from(s.result.data, 'base64')); };
  const state = () => read(`(()=>{const r=mmm.replay,c=mmm.camera,root=r.rig?.root,v=mmm.vehicle;const p=(x,y,z)=>{const q=c.position.clone().set(x,y,z).project(c);return [q.x,q.y,q.z]};
    return {t:r.t,playing:r.playing,slow:r.slow,active:r.active,kind:r.shotKind,from:r.from,to:r.to,
      root:root?[root.position.x,root.position.y,root.position.z]:null,cam:[c.position.x,c.position.y,c.position.z],veh:[v.x,v.y,v.z],
      car:root?p(root.position.x,root.position.y+0.8,root.position.z):null,mark:r.moment&&root?p(r.moment.x,r.moment.y+0.5,r.moment.z):null}})()`);
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: touch ? 2 : 1, mobile: touch });
    if (touch) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await c.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out }).catch(() => {});
    await c.send('Page.navigate', { url: `${base}/?test=1&road=Mabou%20Harbour%20Road&f=0.35&hud=1&radio=0&engine=0${ride === 'bike' ? '&vehicle=bike' : ''}${touch ? '&touch=1&q=low' : ''}` });
    let ready = false;
    for (let i = 0; i < 360; i++) { await sleep(500); if (await read(`document.title.startsWith('settled') && !!window.mmm?.replay`)) { ready = true; break; } }
    assert.ok(ready, `${name}: settled`);
    // The recorder runs in every mode, also while the ride stands parked as the land settles: samples, but no marks yet.
    assert.equal(await read(`mmm.replay.recorder.buffer.count > 0 && mmm.replay.recorder.marks.length === 0`), true, `${name}: recording from the start, nothing marked before driving`);
    assert.equal(await read(`document.getElementById('replayPanel').hidden`), true);

    // ---- drive, with an independent log of where the car really was, every frame ---------------------------------
    // The drawn rig's own place every frame: the path the replay must redraw (for the bike, lean shifts it off the ride's x, z).
    await read(`window.__path=[];(function log(){const p=mmm.replayRig.root.position;window.__path.push([p.x,p.y,p.z]);window.__log=requestAnimationFrame(log)})();true`);
    await key('KeyW', 'w', true, false); await sleep(3000);
    await key('KeyD', 'd', true, false); await sleep(900); await key('KeyD', 'd', false, true);
    await key('KeyA', 'a', true, false); await sleep(700); await key('KeyA', 'a', false, true);
    await sleep(900);
    await key('KeyW', 'w', false, true);
    const speed = await read(`Math.hypot(mmm.vehicle.vx,mmm.vehicle.vz)`);
    assert.ok(speed > 8, `${name}: the car got going (${speed.toFixed(1)} m/s)`);
    // A forced stop from the page, standing in for a wall: the ride loses its speed in one frame and bounces back a
    // little (a stop to exactly zero reads as a placement). The recorder reads only the motion, as for a real hit;
    // real collisions, brakes, placements and teleports are the node row's cases.
    await read(`(()=>{const v=mmm.vehicle,k=-0.03;v.vx*=k;v.vz*=k;v.speed*=k;return true})()`);
    await sleep(1500);
    await read(`cancelAnimationFrame(window.__log);true`);
    const path = await read(`window.__path`);
    const travelled = path.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - path[i][0], p[2] - path[i][2]), 0);
    assert.ok(travelled > 25, `${name}: drove ${travelled.toFixed(1)} m`);
    const marks = await read(`mmm.replay.recorder.marks.map(m=>({kind:m.kind,strength:m.strength,quiet:m.quiet}))`);
    assert.ok(marks.some(m => m.kind === 'hit' && Math.abs(m.strength - speed) < 3), `${name}: the knock is marked ${JSON.stringify(marks)} (speed ${speed.toFixed(1)})`);
    const bytes = await read(`mmm.replay.recorder.buffer.bytes`);
    assert.ok(bytes < 80000, `${name}: recorder memory ${bytes} bytes`);

    // ---- open the replay ------------------------------------------------------------------------------------------
    let before = null;
    if (viaPause) {
      if (touch) await tap('#pauseButton'); else await key('KeyP', 'p');
      assert.equal(await read(`document.getElementById('pauseScreen').hidden`), false, `${name}: pause screen`);
      before = await rigState();
      assert.equal(await read(`document.getElementById('pauseReplay').disabled`), false, `${name}: replay button ready`);
      await tap('#pauseReplay');
    } else await key('KeyI', 'i');
    await sleep(200);
    assert.equal(await read(`mmm.replay.active`), true, `${name}: replay open`);
    const layout = await read(`(()=>{const ids=['replayPlay','replayScrub','replaySlow','replayClose'];return {
      pause:document.getElementById('pauseScreen').hidden, hud:getComputedStyle(document.getElementById('hud')).visibility,
      buttons:ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,h:r.height,w:r.width,in:r.x>=0&&r.y>=0&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e}}),
      save:!document.getElementById('replaySave').hidden, format:mmm.replay.clipFormat}})()`);
    assert.equal(layout.pause, true, `${name}: the pause screen steps aside`);
    assert.equal(layout.hud, 'hidden', `${name}: the HUD steps aside`);
    for (const b of layout.buttons) assert.ok(b.h >= 44 && b.w >= 44 && b.in && b.hit, `${name}: ${b.id} is a reachable 44 px target ${JSON.stringify(b)}`);
    assert.equal(layout.save, !!layout.format, `${name}: Save clip shows exactly where the browser can record`);
    const moment = await read(`mmm.replay.moment&&{t:mmm.replay.moment.t,strength:mmm.replay.moment.strength}`);
    assert.ok(moment, `${name}: a slow-motion moment`);

    // ---- play it through: the drawn car on the driven path, the camera outside, the mark in frame -----------------
    const frozen = await read(`[mmm.vehicle.x,mmm.vehicle.z]`);
    const samples = [];
    for (let i = 0; i < 400; i++) {
      const s = await state(); s.wall = performance.now() / 1000; samples.push(s);
      if (!s.playing) break;
      await sleep(60);
    }
    assert.ok(!samples.at(-1).playing && Math.abs(samples.at(-1).t - samples.at(-1).to) < 1e-6, `${name}: plays to the end and stops`);
    assert.deepEqual(await read(`[mmm.vehicle.x,mmm.vehicle.z]`), frozen, `${name}: the game stays paused under the replay`);
    const near = (p) => { let best = Infinity, at = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], dx = b[0] - a[0], dz = b[2] - a[2], len = dx * dx + dz * dz;
        const u = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / len)) : 0;
        const d = Math.hypot(p[0] - a[0] - u * dx, p[2] - a[2] - u * dz);
        if (d < best) { best = d; at = i; }
      }
      return { d: best, at }; };
    // Progress in metres along the driven path: the knock's small bounce back and the stop are within 0.5 m.
    const along = [0]; for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][2] - path[i - 1][2]));
    let worst = 0, lastAlong = 0, orbitSeen = 0;
    for (const s of samples) {
      const n = near(s.root);
      worst = Math.max(worst, n.d);
      assert.ok(along[n.at] >= lastAlong - 0.5, `${name}: the replay moves forward along the path (${along[n.at].toFixed(2)} m after ${lastAlong.toFixed(2)} m)`);
      lastAlong = Math.max(lastAlong, along[n.at]);
      const outside = Math.hypot(s.cam[0] - s.root[0], s.cam[1] - s.root[1], s.cam[2] - s.root[2]);
      assert.ok(outside >= 3, `${name}: the camera is outside the car (${outside.toFixed(2)} m)`);
      if (Math.abs(s.t - moment.t) <= 0.6) {
        assert.equal(s.kind, 'orbit', `${name}: orbit at the moment`);
        for (const [what, q] of [['car', s.car], ['mark', s.mark]]) assert.ok(Math.abs(q[0]) <= 1 && Math.abs(q[1]) <= 1 && q[2] < 1, `${name}: ${what} in frame at t-m=${(s.t - moment.t).toFixed(2)} ${JSON.stringify(q)}`);
        orbitSeen++;
      }
    }
    assert.ok(worst < 0.35, `${name}: the drawn car stays on the driven path (worst ${worst.toFixed(3)} m)`);
    assert.ok(orbitSeen >= 3, `${name}: ${orbitSeen} samples at the slow moment`);
    const rate = (pick) => { let replay = 0, wall = 0; for (let i = 1; i < samples.length; i++) if (pick(samples[i - 1]) && pick(samples[i]) && samples[i].playing) { replay += samples[i].t - samples[i - 1].t; wall += samples[i].wall - samples[i - 1].wall; } return wall > 0 ? replay / wall : NaN; };
    const slowRate = rate(s => Math.abs(s.t - moment.t) < 0.45), fullRate = rate(s => s.t < moment.t - 2.2);
    assert.ok(slowRate / fullRate <= 0.5, `${name}: slow motion at the moment (${slowRate.toFixed(2)} against ${fullRate.toFixed(2)})`);
    report.push({ name, travelled: +travelled.toFixed(1), knock: +speed.toFixed(1), samples: samples.length, worstMetres: +worst.toFixed(3), orbitSamples: orbitSeen, slowRate: +slowRate.toFixed(2), fullRate: +fullRate.toFixed(2) });

    // ---- the controls ---------------------------------------------------------------------------------------------
    await tap('#replayPlay');   // at the end, Play starts again from the beginning
    let s = await state();
    assert.ok(s.playing && s.t - s.from < 1.5, `${name}: Play from the end restarts (${(s.t - s.from).toFixed(2)})`);
    await read(`(()=>{const e=document.getElementById('replayScrub');e.value=String(${moment.t}-mmm.replay.from);e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await sleep(250); s = await state();
    assert.ok(!s.playing && Math.abs(s.t - moment.t) < 0.02, `${name}: scrub to the moment pauses there (${(s.t - moment.t).toFixed(3)})`);
    await shot(`${name}-moment.png`);
    const held = await state(); await sleep(400);
    assert.deepEqual((await state()).root, held.root, `${name}: paused replay holds the car`);
    if (!touch) {
      await key('ArrowLeft', 'ArrowLeft'); await sleep(150);
      assert.ok(Math.abs((await state()).t - (moment.t - 1)) < 0.02, `${name}: Left steps back a second`);
      await key('Space', ' '); await sleep(150); assert.equal((await state()).playing, true, `${name}: Space plays`);
      await key('Space', ' '); await sleep(150); assert.equal((await state()).playing, false, `${name}: Space pauses`);
    }
    await tap('#replaySlow');
    assert.equal(await read(`document.getElementById('replaySlow').getAttribute('aria-pressed')`), 'true', `${name}: slow motion on`);
    await read(`(()=>{const e=document.getElementById('replayScrub');e.value='0';e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await tap('#replayPlay');
    const a = await state(); a.wall = performance.now() / 1000; await sleep(1200); const b = await state(); b.wall = performance.now() / 1000;
    const slowButton = (b.t - a.t) / (b.wall - a.wall);
    assert.ok(slowButton > 0 && slowButton <= 0.45 * fullRate, `${name}: the button plays at a quarter (${slowButton.toFixed(2)} against ${fullRate.toFixed(2)})`);
    await tap('#replaySlow'); await tap('#replayPlay');

    // ---- save a clip ---------------------------------------------------------------------------------------------
    if (layout.format && full) {
      await tap('#replaySave');
      assert.equal(await read(`!!mmm.replay.clip`), true, `${name}: recording a clip`);
      await sleep(1500);
      const frame = await read(`(()=>{const k=mmm.replay.clip;if(!k)return null;const x=k.ctx.getImageData(0,Math.floor(k.canvas.height*.88),Math.floor(k.canvas.width*.6),Math.ceil(k.canvas.height*.12)).data;let bright=0;for(let i=0;i<x.length;i+=4)if(x[i]>235&&x[i+1]>235&&x[i+2]>235)bright++;return {url:k.canvas.toDataURL('image/png'),w:k.canvas.width,h:k.canvas.height,bright,caption:k.caption}})()`);
      assert.ok(frame, `${name}: clip canvas`);
      writeFileSync(join(out, `${name}-clip-frame.png`), Buffer.from(frame.url.split(',')[1], 'base64'));
      assert.ok(frame.bright > 40, `${name}: the caption is drawn into the clip (${frame.bright} bright pixels)`);
      assert.equal(frame.caption, 'Mabou Mail Madness · mmm.fakkeldy.ca', `${name}: caption text`);
      assert.ok(frame.w % 2 === 0 && frame.h % 2 === 0 && Math.max(frame.w, frame.h) <= (touch ? 960 : 1280), `${name}: clip size ${frame.w}x${frame.h}`);
      let clip = null;
      for (let i = 0; i < 120 && !clip; i++) { await sleep(500); clip = await read(`mmm.replay.lastClip&&{size:mmm.replay.lastClip.size,type:mmm.replay.lastClip.type,name:mmm.replay.lastClip.name}`); }
      assert.ok(clip && clip.size > 20000 && clip.type.startsWith('video/'), `${name}: a clip file ${JSON.stringify(clip)}`);
      const data = await read(`new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result.split(',')[1]);f.readAsDataURL(mmm.replay.lastClip)})`);
      writeFileSync(join(out, `${name}-${clip.name}`), Buffer.from(data, 'base64'));
      assert.equal(await read(`!!document.getElementById('replayDownload')`), true, `${name}: the download link stays offered`);
      report.at(-1).clip = clip;
      await tap('#replayBack');
    } else if (full) report.at(-1).clip = 'this browser cannot record: Save clip hidden';

    // ---- close: the car and the camera come back exactly; the key path resumes the game --------------------------
    await tap('#replayClose');
    assert.equal(await read(`mmm.replay.active`), false, `${name}: closed`);
    assert.equal(await read(`document.getElementById('replayPanel').hidden`), true);
    if (viaPause) {
      // Opened from the pause screen: closing goes back to it, with the car and camera exactly as they were.
      assert.equal(await read(`document.getElementById('pauseScreen').hidden`), false, `${name}: back on the pause screen`);
      assert.deepEqual(await rigState(), before, `${name}: every node of the car and the camera restored exactly`);
      await tap('#resumeGame');
    } else {
      assert.equal(await read(`document.getElementById('pauseScreen').hidden`), true, `${name}: the key path resumes play`);
      // From the pause screen on desktop too: the button, and the exact restore.
      await key('KeyP', 'p'); await sleep(150);
      const pausedAt = await rigState();
      await tap('#pauseReplay'); await sleep(300);
      assert.equal(await read(`mmm.replay.active`), true, `${name}: the pause screen opens the replay`);
      await key('Escape', 'Escape'); await sleep(150);
      assert.equal(await read(`mmm.replay.active`), false, `${name}: Esc closes the replay`);
      assert.equal(await read(`document.getElementById('pauseScreen').hidden`), false, `${name}: Esc returns to the pause screen, not past it`);
      assert.deepEqual(await rigState(), pausedAt, `${name}: every node of the car and the camera restored exactly`);
      await tap('#resumeGame');
    }
    // The game runs again: the clock moves, and (after R puts the ride back on the road, clear of whatever the knock
    // left it against) the pedal drives it.
    const clock = await read(`mmm.shift.elapsed`); await sleep(500);
    assert.ok(await read(`mmm.shift.elapsed`) > clock, `${name}: the game clock runs again after the replay`);
    // The pedal first, where the knock left the ride. Only if that fails (the forced stop can leave it against a
    // tree or on a steep bank) is it put back on the road with R, and the row says so with the ride's state.
    await key('KeyW', 'w', true, false); await sleep(1200); await key('KeyW', 'w', false, true);
    let drove = Math.abs(await read(`mmm.vehicle.speed`)) > 0.5 ? 'pedal' : null;
    if (!drove) {
      const stuck = await read(`(()=>{const v=mmm.vehicle;return {x:v.x,z:v.z,speed:v.speed,airborne:v.airborne,surface:v.surfaceName,road:v.roadName}})()`);
      console.log(`NOTE ${name}: the pedal did not move the ride where the knock left it: ${JSON.stringify(stuck)}; R puts it back on the road`);
      await key('KeyR', 'r'); await sleep(400);
      await key('KeyW', 'w', true, false); await sleep(1200); await key('KeyW', 'w', false, true);
      if (Math.abs(await read(`mmm.vehicle.speed`)) > 0.5) drove = 'R then pedal';
    }
    assert.ok(drove, `${name}: the car drives again after the replay`);
    report.at(-1).droveAgain = drove;

    if (!full) { console.log(`PASS ${name}: ${JSON.stringify(report.at(-1))}`); continue; }
    // ---- an end card and the day's report offer the replay too --------------------------------------------------
    await read(`mmm.endings.offer('Test','A card',['A line.'],[{label:'Carry on',action:()=>mmm.endings.close()}]);true`);
    await sleep(150);
    await tap('#endingReplay');
    assert.equal(await read(`mmm.replay.active`), true, `${name}: the end card opens the replay`);
    assert.equal(await read(`getComputedStyle(document.getElementById('endingFrame')).visibility`), 'hidden', `${name}: the card steps aside`);
    await tap('#replayClose');
    assert.equal(await read(`mmm.endings.busy && !mmm.replay.active && getComputedStyle(document.getElementById('endingFrame')).visibility==='visible'`), true, `${name}: back to the card`);
    await tap('#endingChoices button');
    assert.equal(await read(`mmm.endings.busy`), false, `${name}: the card's own choice still works`);
    await read(`mmm.shift.end();true`); await sleep(300);
    assert.equal(await read(`!document.getElementById('shiftReport').hidden`), true, `${name}: the day's report shows`);
    {
      await read(`document.querySelector('#shiftReport .reportFooter').scrollIntoView();true`);
      await tap('#reportReplay');
      assert.equal(await read(`mmm.replay.active`), true, `${name}: the day's report opens the replay`);
      await shot(`${name}-from-report.png`);
      await tap('#replayClose');
      assert.equal(await read(`!mmm.replay.active && !document.getElementById('shiftReport').hidden`), true, `${name}: back to the report`);
    }
    console.log(`PASS ${name}: ${JSON.stringify(report.at(-1))}`);
  } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
}
writeFileSync(join(out, 'replay.json'), JSON.stringify(report, null, 1));
console.log('PASS replay browser: desktop and phone');
