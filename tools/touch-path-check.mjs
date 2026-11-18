#!/usr/bin/env node
import { cdp, cdpFetch } from './cdp.mjs';
// Real touch input uses the current boxes: a third finger must never steal steering or a pedal.
// RUN=touch-path-check.mjs VIEWS="touch|x=1" tools/yard-shots.sh 900 900
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const [out, first] = process.argv.slice(2);
const base = new URL(first).origin, port = process.env.CDP_PORT ?? '9333';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const pedalsOnly of [false, true]) for (const [width, height] of [[390, 844], [844, 390]]) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const errors = [];
  const { ws, send } = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.text);
  } });
  const read = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    assert.ok(!result.result?.exceptionDetails, JSON.stringify(result.result?.exceptionDetails));
    return result.result?.result?.value;
  };
  const touch = async (type, touchPoints) => { const result = await send('Input.dispatchTouchEvent', { type, touchPoints }); assert.ok(!result.error, JSON.stringify(result.error)); };
  const point = (name, finger) => read(`(() => { const b = document.getElementById('${name}').getBoundingClientRect(); return {id:${finger},x:b.x+b.width/2,y:b.y+b.height/2}; })()`);
  const release = async () => { await touch('touchEnd', []); await sleep(100); };
  try {
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (pedalsOnly) {
      // Mount the real controls in their own tab so assertions read exact throttle, without vehicle physics or frame timing.
      await send('Page.navigate', { url: `${base}/src/touch.ts` });
      for (let i = 0; i < 40; i++) { await sleep(100); if (await read(`location.pathname === '/src/touch.ts' && document.readyState === 'complete'`)) break; }
      const fixture = await send('Runtime.evaluate', { expression: `import('/src/touch.ts').then(({createTouchControls}) => {
        document.body.replaceChildren();
        document.head.appendChild(Object.assign(document.createElement('meta'), {name:'viewport',content:'width=device-width, initial-scale=1'}));
        window.pedalQA = createTouchControls({reset(){},view(){},horn(){}});
        window.pedalIds = {tcGo:[],tcBrake:[]};
        for (const id of Object.keys(pedalIds)) document.getElementById(id).addEventListener('pointerdown', e => pedalIds[id].push(e.pointerId));
      })`, awaitPromise: true });
      assert.ok(!fixture.error && !fixture.result?.exceptionDetails, JSON.stringify(fixture));
      const go1 = await point('tcGo', 11), brake1 = await point('tcBrake', 13);
      const go2 = { ...go1, id: 12, x: go1.x + 18 }, brake2 = { ...brake1, id: 14, x: brake1.x + 18 };
      const expectPedals = async (throttle, goHeld, brakeHeld, message) => {
        assert.deepEqual(await read(`({throttle:pedalQA.state.throttle,go:document.getElementById('tcGo').classList.contains('held'),brake:document.getElementById('tcBrake').classList.contains('held')})`),
          { throttle, go: goHeld, brake: brakeHeld }, message);
      };
      // CDP touchEnd names the fingers to release; touchCancel cancels all, so inject per-pointer cancel/lost events.
      for (const end of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        await touch('touchStart', [go1, go2]);
        await expectPedals(1, true, false, `${end}: two GO fingers hold throttle 1`);
        if (end === 'pointerup') await touch('touchEnd', [go1]);
        else await read(`document.getElementById('tcGo').dispatchEvent(new PointerEvent('${end}', {pointerId:pedalIds.tcGo.at(-2)}))`);
        await expectPedals(1, true, false, `${end}: releasing one of two GO fingers keeps throttle 1`);
        await touch('touchEnd', end === 'pointerup' ? [] : [go2]);
        await expectPedals(0, false, false, `${end}: last held GO finger releases`);
        if (end !== 'pointerup') await release();
        await touch('touchStart', [go1, brake1, brake2]);
        await expectPedals(-1, true, true, `${end}: two BRAKE fingers beat GO`);
        if (end === 'pointerup') await touch('touchEnd', [brake1]);
        else await read(`document.getElementById('tcBrake').dispatchEvent(new PointerEvent('${end}', {pointerId:pedalIds.tcBrake.at(-2)}))`);
        await expectPedals(-1, true, true, `${end}: releasing one of two BRAKE fingers still beats GO`);
        await touch('touchEnd', [brake2]);
        await expectPedals(1, true, false, `${end}: last BRAKE finger gives GO back`);
        await release();
        await expectPedals(0, false, false, `${end}: all pedals released`);
      }
      // Capture must route an off-pedal lift back to its owner, for each pedal.
      for (const [finger, throttle] of [[go1, 1], [brake1, -1]]) {
        await touch('touchStart', [finger]);
        await expectPedals(throttle, throttle === 1, throttle === -1, 'one finger still holds its pedal');
        await touch('touchMove', [{ ...finger, x: 10, y: 10 }]);
        await expectPedals(throttle, throttle === 1, throttle === -1, 'drag outside keeps capture');
        await release();
        await expectPedals(0, false, false, 'lifting outside does not leave a stuck pedal');
      }
      // Move to establish capture, then release it and move again to dispatch lostpointercapture for just that pointer.
      for (const [finger1, finger2, pedal, throttle] of [[go1, go2, 'tcGo', 1], [brake1, brake2, 'tcBrake', -1]]) {
        await touch('touchStart', [finger1, finger2]);
        await touch('touchMove', [{ ...finger1, x: finger1.x - 1 }, finger2]);
        await read(`document.getElementById('${pedal}').releasePointerCapture(pedalIds.${pedal}.at(-2))`);
        await touch('touchMove', [{ ...finger1, x: finger1.x - 2 }, finger2]);
        await expectPedals(throttle, throttle === 1, throttle === -1, 'real lost capture preserves the other finger');
        await touch('touchEnd', [finger2]);
        await expectPedals(0, false, false, 'the finger that lost capture no longer holds the pedal');
        await release();
        await expectPedals(0, false, false, 'real lost capture and final release clear the pedal');
      }
      for (const clear of [`dispatchEvent(new Event('blur'))`, `dispatchEvent(new Event('pagehide'))`, `pedalQA.show(false); pedalQA.show(true)`]) {
        await touch('touchStart', [go1, go2, brake1, brake2]);
        await read(clear);
        await expectPedals(0, false, false, 'blur/hide clears all pedal fingers');
        await release();
        await touch('touchStart', [go1]);
        await expectPedals(1, true, false, 'fresh GO after blur/hide has no stale BRAKE');
        await release();
      }
      // A browser that drops every release event must not leave a pedal down: the lift itself heals it,
      // because no finger is left on the screen. While a finger remains, nothing is cleared.
      await read(`window.swallow = e => e.stopImmediatePropagation(); for (const t of ['pointerup','pointercancel','lostpointercapture']) addEventListener(t, swallow, true)`);
      await touch('touchStart', [go1, go2]);
      await expectPedals(1, true, false, 'GO held by two fingers before the dropped releases');
      await touch('touchEnd', [go1]); await sleep(100);
      await expectPedals(1, true, false, 'one finger still on the screen: a dropped release clears nothing');
      await release();
      await expectPedals(0, false, false, 'the last lift releases GO although its pointer events were dropped');
      await read(`for (const t of ['pointerup','pointercancel','lostpointercapture']) removeEventListener(t, swallow, true)`);
      await touch('touchStart', [go1]);
      await expectPedals(1, true, false, 'GO works again after the healed release');
      await release();
      await expectPedals(0, false, false, 'and releases normally');
      console.log(`PASS ${width}x${height}: pedal pointerup/cancel/lost capture, partial GO/BRAKE release, off-pedal lift, blur/pagehide/hide, dropped release events`);
      continue;
    }
    await send('Page.navigate', { url: `${base}/?touch=1&q=low&hud=1&x=1` });
    let settled = false;
    for (let i = 0; i < 120; i++) { await sleep(500); if (await read(`document.title === 'settled'`)) { settled = true; break; } }
    assert.ok(settled, 'game starts');
    // The page must not zoom on a phone (web/src/no-zoom.ts). A headless desktop browser cannot show Safari's
    // double-tap zoom, so this reads the three things that stop it; the zoom itself was tried in the iOS Simulator.
    assert.equal(await read(`document.documentElement.style.touchAction`), 'pan-x pan-y', 'the root lets a touch scroll and nothing else');
    assert.deepEqual(await read(`['gesturestart', 'gesturechange', 'dblclick'].map((type) => { const e = new Event(type, { bubbles: true, cancelable: true }); document.getElementById('miniMapHead').dispatchEvent(e); return e.defaultPrevented; })`),
      [true, true, true], 'pinch gestures and double clicks are refused');
    await read(`window.touchQA = {global:[]}; document.addEventListener('pointerdown',e => touchQA.global.push([e.target.id,e.clientX,e.clientY]),true); for (const id of ['tcSteer','tcGo','tcBrake','mailButton','c']) {
      touchQA[id] = []; for (const type of ['pointerdown','pointermove','pointerup','pointercancel'])
        document.getElementById(id).addEventListener(type, e => touchQA[id].push([type,e.pointerId]));
    }`);
    const steer = await point('tcTrack', 1), go = await point('tcGo', 2), mail = await point('mailButton', 3), brake = await point('tcBrake', 4);
    const start = await read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})`);
    const moved = { ...steer, x: steer.x + 35 };
    await touch('touchStart', [steer, go]);
    await touch('touchMove', [moved, go]);
    await touch('touchStart', [moved, go, mail]);
    await sleep(1100);
    assert.ok(await read(`['tcSteer','tcGo','mailButton'].every(id => document.getElementById(id).classList.contains('held'))`), 'three independent controls stay held');
    assert.ok(await read(`getComputedStyle(document.getElementById('tcKnob')).transform !== 'matrix(1, 0, 0, 1, 0, 0)'`), 'steering knob moves');
    const driven = await read(`({x:mmm.vehicle.x,z:mmm.vehicle.z,heading:mmm.vehicle.heading})`);
    assert.ok(Math.hypot(driven.x - start.x, driven.z - start.z) > .1, 'GO moves the car');
    assert.ok(Math.abs(driven.heading - start.heading) > .001, 'steering turns the moving car');
    const events = await read('touchQA');
    for (const control of ['tcSteer', 'tcGo', 'mailButton']) assert.equal(events[control].filter(([type]) => type === 'pointerdown').length, 1, control);
    assert.equal(events.c.length, 0, 'control touches do not leak to the canvas');
    writeFileSync(`${out}/touch-${width}x${height}-three-fingers.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    await release();
    assert.ok(await read(`['tcSteer','tcGo','mailButton'].every(id => !document.getElementById(id).classList.contains('held'))`), 'release clears all three controls');
    await sleep(1800);
    assert.match(await read(`document.getElementById('mailScore').textContent`), /(Lawn|Ditch|Delivered) [1-9]/, 'MAIL throws physical mail');
    // Brake has priority, even while GO is still held.
    await touch('touchStart', [go, brake]); await sleep(1500);
    assert.ok(await read('mmm.vehicle.speed < .2'), 'BRAKE wins over GO');
    await release();
    await touch('touchStart', [brake]); await sleep(1200);
    assert.ok(await read('mmm.vehicle.speed < -.05'), 'BRAKE reverses from a stop');
    await touch('touchCancel', []); await sleep(100);
    assert.ok(await read(`!document.getElementById('tcBrake').classList.contains('held')`), 'cancel releases the pedal');
    // A gap inside the full-screen container belongs to the canvas.
    const canvasPoint = await read(`(() => {
      for (let y = innerHeight*.3; y < innerHeight*.75; y += 12) for (let x = innerWidth*.3; x < innerWidth*.7; x += 12)
        if ([-24,0,35,70,94].every(dx => [-24,0,24].every(dy => document.elementFromPoint(x+dx,y+dy)?.id === 'c'))) return {id:5,x,y};
      return null;
    })()`);
    assert.ok(canvasPoint, 'the middle has a clear canvas drag path');
    await touch('touchStart', [canvasPoint]);
    for (let dx = 14; dx <= 70; dx += 14) {
      await sleep(40);
      await touch('touchMove', [{ ...canvasPoint, x: canvasPoint.x + dx }]);
    }
    await sleep(100);
    await release();
    const canvasEvents = await read('touchQA.c');
    assert.ok(canvasEvents.some(([type]) => type === 'pointerdown') && canvasEvents.some(([type]) => type === 'pointermove') && canvasEvents.some(([type]) => type === 'pointerup'), 'canvas receives the whole drag: ' + JSON.stringify({canvasEvents,canvasPoint,global:await read('touchQA.global'),viewport:await read('({w:innerWidth,h:innerHeight,scale:visualViewport.scale,x:visualViewport.offsetLeft,y:visualViewport.offsetTop})')}));
    await touch('touchStart', [await point('cameraButton', 9)]); await release();
    assert.ok(await read(`!document.getElementById('photoTag').hidden`), 'CAMERA creates a photo note by touch');
    const flyKey = async () => {
      await read(`document.activeElement?.blur()`);
      for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent', {type,code:'KeyF',key:'f',windowsVirtualKeyCode:70});
      await sleep(150);
    };
    await flyKey();
    assert.ok(await read(`!document.body.classList.contains('tcOn')`), 'fly mode hides the driving controls');
    assert.ok(await read(`(() => { const b = document.getElementById('photoTag').getBoundingClientRect(); return b.width > 0 && b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; })()`), 'the photo note keeps its viewport position with the grid hidden');
    await touch('touchStart', [await point('gear', 8)]); await release();
    assert.ok(await read(`document.getElementById('settings').classList.contains('open') && getComputedStyle(document.getElementById('endShift')).position === 'static'`), 'gear and panel still work with the driving grid hidden');
    await touch('touchStart', [await point('gear', 8)]); await release();
    await flyKey();
    assert.ok(await read(`document.body.classList.contains('tcOn')`), 'drive mode restores the flow grid');
    await touch('touchStart', [await point('gear', 6)]); await release();
    assert.ok(await read(`document.getElementById('settings').classList.contains('open')`), 'gear opens settings by touch');
    await touch('touchStart', [await point('endShift', 7)]); await release();
    assert.ok(await read(`!document.getElementById('shiftReport').hidden`), 'END SHIFT is pressable by touch over the HUD');
    assert.deepEqual(errors, [], 'no runtime exceptions');
    console.log(`PASS ${width}x${height}: steering, GO, BRAKE/reverse/priority, three fingers + physical mail, release/cancel, canvas drag, fly/drive handoff, gear + END SHIFT`);
  } finally {
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); ws.close();
  }
}
