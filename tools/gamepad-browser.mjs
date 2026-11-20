#!/usr/bin/env node
// A controller in the real game: a fake navigator.getGamepads (standard layout) is put in before the page loads, then
// plugged in, driven, paused, unplugged and plugged in again. Every ride; the title card; a phone; rumble and its switch.
// RUN=gamepad-browser.mjs HUD=1 VIEWS="pad|x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [out, first] = process.argv.slice(2);
const base = new URL(first).origin, port = process.env.CDP_PORT ?? '9333';
// Pictures and numbers go to $MMM_CHECK_OUT/evidence/gamepad-browser/ (kept by check-all after a pass), else beside the shots.
const evidence = join(process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence') : out, 'gamepad-browser'); mkdirSync(evidence, { recursive: true });
const A = 0, B = 1, X = 2, LB = 4, LT = 6, RT = 7, START = 9, UP = 12, DOWN = 13;
const fake = plugged => `(() => {
  const button = () => ({ pressed: false, touched: false, value: 0 });
  const pad = { id: 'Fake standard pad (gamepad-browser)', index: 0, mapping: 'standard', connected: true, timestamp: 0, axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, button),
    vibrationActuator: { type: 'dual-rumble', effects: [], playEffect(type, params) { this.effects.push({ type, ...params }); return Promise.resolve('complete'); } } };
  let plugged = ${plugged};   // true: the pad was already in, its one connect event long gone (a press during loading)
  Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value() { return [plugged ? pad : null, null, null, null]; } });
  window.fakePad = {
    pad,
    plug() { plugged = true; pad.connected = true; dispatchEvent(new Event('gamepadconnected')); },
    unplug() { plugged = false; pad.connected = false; dispatchEvent(new Event('gamepaddisconnected')); },
    set(i, v) { pad.buttons[i] = { pressed: v >= 0.5, touched: v > 0, value: v }; pad.timestamp++; },
    axis(i, v) { pad.axes[i] = v; pad.timestamp++; },
    clear() { for (let i = 0; i < pad.buttons.length; i++) this.set(i, 0); pad.axes.fill(0); },
  };
})();`;

async function open(query, { width = 1280, height = 720, mobile = false, plugged = false } = {}) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl);
  const read = async expression => {
    await send('Page.bringToFront');
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.removeItem('mmm.rumble'); } catch {}\n${fake(plugged)}` });
  await send('Page.navigate', { url: `${base}/?${query}` });
  let settled = false;
  for (let i = 0; i < 240 && !settled; i++) { await sleep(500); settled = await read(`document.title === 'settled'`); }
  assert.ok(settled, `settled: ${query}`);
  const pad = {
    set: (i, v) => read(`fakePad.set(${i}, ${v})`), axis: (i, v) => read(`fakePad.axis(${i}, ${v})`),
    async press(i) { await this.set(i, 1); await sleep(150); await this.set(i, 0); await sleep(150); },
  };
  const pose = () => read(`({ x: mmm.vehicle.x, z: mmm.vehicle.z, heading: mmm.vehicle.heading, speed: mmm.vehicle.speed })`);
  const key = async (code, down = true) => send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code.replace(/^Key/, '').toLowerCase(), windowsVirtualKeyCode: code.startsWith('Key') ? code.charCodeAt(3) : 0 });
  const shot = async name => writeFileSync(`${evidence}/${name}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const close = async () => { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close(); };
  return { read, send, pad, pose, key, shot, close };
}
const turned = (a, b) => Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
const moved = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const numbers = {};

// 1. The car on a desktop, in the mail game.
{
  const p = await open('x=1&hud=1&radio=0');
  try {
    assert.equal(await p.read('mmm.gamepad.device'), 'keyboard', 'a desktop starts on the keys');
    assert.equal(await p.read(`!!document.getElementById('padRumble')`), false, 'no controller, no rumble switch');
    await p.read('fakePad.plug()'); await sleep(200);
    assert.equal(await p.read('mmm.gamepad.device'), 'keyboard', 'a pad that is only plugged in takes nothing over');
    assert.equal(await p.read(`!!document.getElementById('padRumble')`), false, 'nor does it change Settings');

    await p.pad.set(RT, 0.53); await sleep(200);
    const half = await p.read('mmm.gamepad.state.throttle');
    assert.ok(Math.abs(half - 0.5) < 0.01, `RT is analog: half a trigger gives ${half}`);
    assert.equal(await p.read('mmm.gamepad.device'), 'gamepad', 'a trigger press makes the controller the device');
    assert.equal(await p.read(`document.getElementById('padRumble')?.checked`), true, 'the first use shows the rumble switch, on');
    assert.ok(await p.read(`document.body.classList.contains('padMode')`), 'body.padMode');
    assert.match(await p.read(`document.getElementById('hud').textContent`), /RT\/LT: go\/brake/, 'the HUD shows the controller line');
    assert.doesNotMatch(await p.read(`document.getElementById('hud').textContent`), /WASD/, 'and not the keys');

    const start = await p.pose();
    await p.pad.set(RT, 1); await sleep(2000);
    const straight = await p.pose();
    numbers.carForward = moved(start, straight);
    assert.ok(moved(start, straight) > 2, `RT drives the car: ${moved(start, straight).toFixed(2)} m`);
    await p.pad.axis(0, 0.8); await sleep(200);
    assert.ok(await p.read('mmm.gamepad.state.steer') > 0.5, 'the stick steers');
    await sleep(1300);
    const right = await p.pose();
    numbers.carTurn = turned(straight, right);
    assert.ok(Math.abs(turned(straight, right)) > 0.05, `the stick turns the moving car: ${turned(straight, right).toFixed(3)} rad`);
    await p.pad.axis(0, 0.08); await sleep(200);
    assert.equal(await p.read('mmm.gamepad.state.steer'), 0, 'inside the dead zone the stick is centre');
    await p.shot('desktop-driving');

    await p.pad.set(RT, 0); await p.pad.set(LT, 1); await sleep(200);
    assert.equal(await p.read('mmm.gamepad.state.throttle'), -1, 'LT is the brake');
    let reversed = false;
    for (let i = 0; i < 40 && !reversed; i++) { await sleep(200); reversed = await p.read('mmm.vehicle.speed < -0.05'); }
    assert.ok(reversed, 'LT held brakes the car and then reverses it');
    await p.pad.set(LT, 0);

    await p.pad.set(A, 1); await sleep(150);
    assert.equal(await p.read('mmm.gamepad.state.handbrake'), true, 'A is the handbrake');
    await p.pad.set(A, 0); await sleep(150);

    // X, Y, Back and d-pad down reach the game's own horn, mail, respawn and photo.
    await p.read(`(() => { window.spy = { honk: 0, respawn: 0 }; const h = mmm.ride.honk; mmm.ride.honk = (...a) => { spy.honk++; return h(...a); };
      const proto = Object.getPrototypeOf(mmm.vehicle), r = proto.respawn; proto.respawn = function (...a) { spy.respawn++; return r.apply(this, a); }; })()`);
    await p.pad.press(X);
    assert.equal(await p.read('spy.honk'), 1, 'X sounds the horn, once per press');
    const tally = await p.read(`document.getElementById('mailScore').textContent`);
    await p.pad.press(3); await sleep(1500);
    assert.notEqual(await p.read(`document.getElementById('mailScore').textContent`), tally, 'Y throws mail');
    await p.pad.press(DOWN);
    assert.ok(await p.read(`!document.getElementById('photoTag').hidden`), 'd-pad down takes a photo');
    await p.pad.press(8); await sleep(200);
    assert.equal(await p.read('spy.respawn'), 1, 'Back puts the car back on the road');
    const fov = await p.read('mmm.camera.fov');
    await p.pad.press(B); await sleep(150);
    assert.notEqual(await p.read('mmm.camera.fov'), fov, 'B changes the view (driver’s seat)');
    await p.pad.press(B); await sleep(150);
    assert.equal(await p.read('mmm.camera.fov'), fov, 'B again: back behind');

    // Start pauses; the d-pad walks the pause screen; A chooses; the A that resumed does not pull the handbrake.
    await p.pad.press(START);
    assert.ok(await p.read(`!document.getElementById('pauseScreen').hidden`), 'Start pauses');
    assert.equal(await p.read('document.activeElement.id'), 'resumeGame');
    // Watch replay sits between Resume and Settings; the d-pad skips it while it is disabled (nothing recorded yet).
    const replayReady = await p.read(`!document.getElementById('pauseReplay').disabled && !document.getElementById('pauseReplay').hidden`);
    numbers.replayReady = replayReady;
    if (replayReady) {
      await p.pad.press(DOWN);
      assert.equal(await p.read('document.activeElement.id'), 'pauseReplay', 'd-pad down moves to Watch replay');
      await p.pad.press(A); await sleep(300);
      assert.ok(await p.read(`!document.getElementById('replayPanel').hidden`), 'A on Watch replay opens the replay');
      await p.pad.press(DOWN);
      assert.ok(await p.read(`document.getElementById('replayPanel').contains(document.activeElement)`), 'the d-pad walks the replay controls');
      await p.pad.set(RT, 1); await sleep(200);
      assert.equal(await p.read('mmm.gamepad.state.throttle'), 0, 'RT does not drive behind the replay');
      await p.pad.set(RT, 0); await sleep(150);
      await p.pad.press(B); await sleep(300);
      assert.ok(await p.read(`document.getElementById('replayPanel').hidden && !document.getElementById('pauseScreen').hidden`), 'B closes the replay, back to the pause screen');
      await p.read(`document.getElementById('resumeGame').focus()`);
    }
    await p.pad.press(DOWN);
    if (replayReady) await p.pad.press(DOWN);
    assert.equal(await p.read('document.activeElement.id'), 'pauseSettings', 'd-pad down moves to Settings');
    assert.ok(await p.read(`document.activeElement.classList.contains('padFocus')`), 'and marks it');
    if(await p.read(`!document.getElementById('pauseEndShift').hidden`)){await p.pad.press(DOWN);assert.equal(await p.read('document.activeElement.id'),'pauseEndShift','pad reaches End shift');await p.pad.press(UP);}
    await p.shot('desktop-pause');
    await p.pad.press(UP);
    if (replayReady) await p.pad.press(UP);
    assert.equal(await p.read('document.activeElement.id'), 'resumeGame', 'd-pad up moves back');
    await p.pad.set(A, 1); await sleep(200);
    assert.ok(await p.read(`document.getElementById('pauseScreen').hidden`), 'A on Resume resumes');
    await sleep(150);
    assert.equal(await p.read('mmm.gamepad.state.handbrake'), false, 'the A that resumed is not a handbrake until let go');
    await p.pad.set(A, 0); await sleep(150); await p.pad.set(A, 1); await sleep(150);
    assert.equal(await p.read('mmm.gamepad.state.handbrake'), true, 'a fresh A is');
    await p.pad.set(A, 0); await sleep(150);
    await p.pad.press(START); await p.pad.press(DOWN); if (replayReady) await p.pad.press(DOWN); await p.pad.press(A);
    assert.ok(await p.read(`document.getElementById('settings').classList.contains('open')`), 'A on Settings opens Settings');
    await p.pad.press(B);
    assert.ok(await p.read(`!document.getElementById('settings').classList.contains('open') && document.getElementById('pauseScreen').hidden`), 'B goes back to the game');
    await p.pad.press(START); await p.pad.press(START);
    assert.ok(await p.read(`document.getElementById('pauseScreen').hidden`), 'Start again resumes');

    // Rumble: a hard landing, then with the switch off.
    const drop = `(() => { const v = mmm.vehicle; v.vx = v.vz = v.speed = 0; v.y += 14; v.vy = 0; v.airborne = true; return v.y; })()`;
    await p.read(drop);
    let effects = 0;
    for (let i = 0; i < 30 && !effects; i++) { await sleep(150); effects = await p.read('fakePad.pad.vibrationActuator.effects.length'); }
    const effect = await p.read('fakePad.pad.vibrationActuator.effects[0]');
    numbers.landing = effect;
    assert.ok(effects >= 1 && effect.type === 'dual-rumble' && effect.strongMagnitude > 0 && effect.duration > 0, 'a hard landing rumbles: ' + JSON.stringify(effect));
    // Back while falling is a placement, not a landing.
    await sleep(1500);
    let count = await p.read('fakePad.pad.vibrationActuator.effects.length');
    await p.read(drop); await sleep(500);
    assert.ok(await p.read('mmm.vehicle.airborne'), 'falling');
    await p.pad.press(8); await sleep(2000);
    assert.equal(await p.read('fakePad.pad.vibrationActuator.effects.length'), count, 'Back in mid-air: no landing rumble');
    await p.read(`document.getElementById('padRumble').click()`);
    assert.equal(await p.read(`localStorage.getItem('mmm.rumble')`), '0', 'the switch is saved off');
    await sleep(1500);
    const before = await p.read('fakePad.pad.vibrationActuator.effects.length');
    await p.read(drop); await sleep(3000);
    assert.equal(await p.read('fakePad.pad.vibrationActuator.effects.length'), before, 'switched off: no rumble');
    await p.read(`document.getElementById('padRumble').click()`);

    // The keys take over; the controller takes it back; unplug and plug in again.
    await p.key('KeyW'); await sleep(150); await p.key('KeyW', false); await sleep(150);
    assert.equal(await p.read('mmm.gamepad.device'), 'keyboard', 'a key makes the keyboard the device');
    assert.match(await p.read(`document.getElementById('hud').textContent`), /WASD\/arrows: drive/, 'and the HUD follows');
    await p.pad.set(RT, 1); await sleep(200);
    assert.equal(await p.read('mmm.gamepad.device'), 'gamepad');
    await p.read('fakePad.unplug()'); await sleep(200);
    assert.equal(await p.read('mmm.gamepad.device'), 'keyboard', 'unplugged: back to the keys');
    assert.equal(await p.read('mmm.gamepad.state.throttle'), 0, 'unplugged: no throttle left on');
    await p.read('fakePad.plug()'); await sleep(200);
    const again = await p.pose(); await sleep(1500);
    assert.ok(moved(again, await p.pose()) > 1, 'plugged in again with RT held: drives');
    await p.pad.set(RT, 0);
    console.log(`PASS car: analog RT/LT, stick steering and dead zone, A handbrake, B view, Start pause + d-pad/A/B menus, latch, rumble and switch, keys/controller handover, unplug/replug ${JSON.stringify(numbers)}`);
  } finally { await p.close(); }
}

// 2. The title card: the d-pad and A, and the rows follow the controller.
{
  // The pad was plugged in (and pressed) while the page loaded: its connect event is gone. It must work anyway.
  const p = await open('title=1&hud=1&radio=0', { plugged: true });
  try {
    assert.ok(await p.read(`!document.getElementById('title').hidden`), 'the title card is up');
    assert.match(await p.read(`document.querySelector('#title dl').textContent`), /WASD \/ arrows/, 'keyboard rows first');
    await p.pad.set(LB, 1); await sleep(1300); await p.pad.set(LB, 0); await sleep(150);   // a bumper (no menu move), held past the 1 s look for a missed pad
    await p.pad.press(DOWN);
    assert.match(await p.read(`document.querySelector('#title dl').textContent`), /RT \/ LT/, 'the controller rows replace them');
    assert.notEqual(await p.read('document.activeElement.id'), 'titleStart', 'd-pad down leaves the start button');
    await p.shot('title-controller');
    await p.pad.press(UP);
    assert.equal(await p.read('document.activeElement.id'), 'titleStart', 'd-pad up comes back');
    const start = await p.pose();
    await p.pad.press(A); await sleep(200);
    assert.ok(await p.read(`document.getElementById('title').hidden`), 'A starts');
    await p.pad.set(RT, 1); await sleep(2000);
    assert.ok(moved(start, await p.pose()) > 1, 'and the car drives');
    await p.pad.set(RT, 0);
    console.log('PASS title card with a pad plugged in before load: rows follow the controller, d-pad moves, A starts');
  } finally { await p.close(); }
}

// 3. A phone on LOW detail: the controller hides the touch pad, a finger brings it back.
{
  const p = await open('touch=1&q=low&hud=1&x=1&radio=0', { width: 390, height: 844, mobile: true });
  try {
    const shown = `(() => { const e = document.getElementById('tcSteer'); return !!e && !e.hidden && e.getClientRects().length > 0; })()`;
    assert.ok(await p.read(shown), 'the touch pad shows');
    assert.equal(await p.read('mmm.gamepad.device'), 'touch');
    await p.read('fakePad.plug()');
    const start = await p.pose();
    await p.pad.set(RT, 1); await p.pad.axis(0, -0.7); await sleep(2500);
    assert.ok(!await p.read(shown), 'a controller in use hides the touch pad');
    const after = await p.pose();
    assert.ok(moved(start, after) > 1, `the controller drives on a phone: ${moved(start, after).toFixed(2)} m`);
    assert.ok(Math.abs(turned(start, after)) > 0.02, 'and steers');
    await p.shot('phone-controller');
    await p.pad.set(RT, 0); await p.pad.axis(0, 0);
    const point = { id: 1, x: 195, y: 300 };
    await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert.equal(await p.read('mmm.gamepad.device'), 'touch', 'a finger makes touch the device');
    assert.ok(await p.read(shown), 'and the touch pad is back');
    console.log('PASS phone (LOW): the controller drives and steers, hides the pad; a touch brings it back');
  } finally { await p.close(); }
}

// 4. Every other ride: the same trigger and stick drive and steer it. The bike's bumper lifts the front wheel.
for (const [name, query] of [['truck', 'vehicle=truck&mode=explore&x=1'], ['sxs', 'vehicle=sxs&mode=explore&x=1'], ['bike', 'vehicle=bike&mode=explore&x=1'], ['horse', 'era=1884&vehicle=horse&mode=explore&x=1']]) {
  const p = await open(`${query}&hud=1&radio=0`);
  try {
    assert.equal(await p.read('mmm.vehicleId'), name, `${name} loaded`);
    await p.read('fakePad.plug()');
    const start = await p.pose();
    await p.pad.set(RT, 1); await sleep(2500);
    const straight = await p.pose();
    await p.pad.axis(0, 0.9); await sleep(1500);
    const turn = await p.pose();
    assert.ok(moved(start, straight) > 1.5, `${name}: RT drives: ${moved(start, straight).toFixed(2)} m`);
    assert.ok(Math.abs(turned(straight, turn)) > 0.03, `${name}: the stick steers: ${turned(straight, turn).toFixed(3)} rad`);
    numbers[name] = { forward: +moved(start, straight).toFixed(2), turn: +turned(straight, turn).toFixed(3) };
    if (name === 'bike') {
      await p.pad.axis(0, 0); await p.pad.set(LB, 1);
      let lifted = 0;
      for (let i = 0; i < 20 && lifted <= 0.02; i++) { await sleep(100); lifted = await p.read('mmm.vehicle.wheelie'); }
      assert.ok(lifted > 0.02, `bike: LB + RT lifts the front wheel (${lifted})`);
      await p.pad.set(LB, 0);
      assert.match(await p.read(`document.getElementById('hud').textContent`), /wheelie/, 'bike: the HUD names the wheelie');
    }
    if (name === 'horse') assert.match(await p.read(`document.getElementById('hud').textContent`), /X: whinny/, 'horse: the HUD names the whinny');
    await p.pad.set(X, 1); await sleep(150); await p.pad.set(X, 0);   // horn or whinny: must not throw
    await p.pad.set(RT, 0); await p.pad.axis(0, 0);
    if (name === 'truck') {
      await p.shot('truck-controller');
      // The big map (M) is a menu: the trigger does not drive under it, and B closes it.
      const mapShown = `(() => { const e = document.getElementById('bigMap'); return !!e && !e.hidden; })()`;
      await p.key('KeyM'); await p.key('KeyM', false); await sleep(400);
      assert.ok(await p.read(mapShown), 'truck: M opens the big map');
      await p.pad.set(RT, 1); await sleep(300);
      assert.equal(await p.read('mmm.gamepad.state.throttle'), 0, 'truck: RT does not drive under the map');
      await p.pad.set(RT, 0); await sleep(150);
      await p.pad.press(B); await sleep(200);
      assert.ok(!await p.read(mapShown), 'truck: B closes the big map');
      // D-pad right held: the places list opens and stays put (the held press does not repeat into it); B closes it.
      await p.pad.set(15, 1); await sleep(300);
      assert.ok(await p.read(`!document.getElementById('placesPanel').hidden`), 'truck: d-pad right opens the places list');
      const focusAt = await p.read('document.activeElement.outerHTML.slice(0, 80)');
      await sleep(1200);
      assert.equal(await p.read('document.activeElement.outerHTML.slice(0, 80)'), focusAt, 'truck: a d-pad held into the list does not walk it');
      await p.pad.set(15, 0); await sleep(150);
      await p.pad.press(B); await sleep(200);
      assert.ok(await p.read(`document.getElementById('placesPanel').hidden`), 'truck: B closes the places list');
      // RT held through a drone flight does not drive off at landing: it counts again once let go.
      await p.key('KeyF'); await p.key('KeyF', false); await sleep(400);
      assert.equal(await p.read('mmm.drone.active'), true, 'truck: F launches the drone');
      await p.pad.set(RT, 1); await sleep(300);
      assert.equal(await p.read('mmm.gamepad.state.throttle'), 0, 'truck: RT does not drive while the drone flies');
      await p.key('KeyF'); await p.key('KeyF', false); await sleep(400);
      assert.equal(await p.read('mmm.drone.active'), false, 'truck: F lands the drone');
      await p.pad.set(RT, 1); await sleep(300);
      assert.equal(await p.read('mmm.gamepad.state.throttle'), 0, 'truck: the RT held through the flight is latched');
      await p.pad.set(RT, 0); await sleep(150); await p.pad.set(RT, 1); await sleep(300);
      assert.ok(await p.read('mmm.gamepad.state.throttle') > 0.9, 'truck: a fresh RT drives');
      await p.pad.set(RT, 0); await sleep(150);
      // A modal dialog (as the property-lines notice) owns the pad: B cancels it, through its own cancel handler.
      await p.read(`(() => { const d = document.createElement('dialog'); d.id = 'padDialog'; d.innerHTML = '<button>OK</button>';
        d.addEventListener('cancel', () => { window.padCancelled = true; }); document.body.append(d); d.showModal(); })()`);
      await p.pad.set(RT, 1); await sleep(300);
      assert.equal(await p.read('mmm.gamepad.state.throttle'), 0, 'truck: RT does not drive under a modal dialog');
      await p.pad.set(RT, 0); await sleep(150);
      await p.pad.press(B); await sleep(200);
      assert.ok(await p.read(`!document.getElementById('padDialog').open && window.padCancelled === true`), 'truck: B cancels the dialog');
      assert.ok(await p.read(`document.getElementById('pauseScreen').hidden && !document.getElementById('settings').classList.contains('open')`), 'truck: and does not touch the pause state');
    }
    console.log(`PASS ${name}: RT drives, the stick steers${name === 'bike' ? ', LB lifts the front wheel' : ''}`);
  } finally { await p.close(); }
}
writeFileSync(`${evidence}/numbers.json`, JSON.stringify(numbers, null, 2));
console.log('PASS gamepad-browser', JSON.stringify(numbers));
