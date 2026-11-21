import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, sleep, exitCheck } from './cdp.mjs';

const [out, first] = process.argv.slice(2);
const evidence = process.env.DRAG_EVIDENCE ?? (process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'airport-drag') : out);
mkdirSync(evidence, { recursive: true });
const phase = "document.querySelector('#airportDrag .dragTree')?.dataset.phase";
const staged = "document.querySelector('#airportDrag:not([hidden]) .dragStage:not([disabled]):not([hidden])')";
const status = "document.querySelector('#airportDrag .dragStatus').textContent";

async function until(tab, condition, label, ms = 45000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await tab.read(condition);
    if (value) return value;
    await sleep(55);
  }
  assert.fail(label + ': ' + JSON.stringify(await tab.read(`({phase:${phase},status:${status},x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed})`)));
}
const click = (tab, selector) => tab.read(`document.querySelector(${JSON.stringify(selector)}).click()`);
async function press(tab, code, keyName, number) {
  const key = { code, key: keyName, windowsVirtualKeyCode: number };
  await tab.send('Input.dispatchKeyEvent', { ...key, type: 'rawKeyDown' });
  await tab.send('Input.dispatchKeyEvent', { ...key, type: 'keyUp' });
}
async function openPlaces(tab) {
  await press(tab, 'KeyL', 'l', 76);
  assert.ok(await tab.read("!document.querySelector('#placesPanel').hidden"), 'L opens Places');
}
async function pedal(tab, down, phone = false) {
  if (!phone) return tab.send('Input.dispatchKeyEvent', { type: down ? 'rawKeyDown' : 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  const point = down ? await tab.read(`(() => {const r=document.querySelector('#tcGo').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`) : null;
  return tab.send('Input.dispatchTouchEvent', { type: down ? 'touchStart' : 'touchEnd', touchPoints: point ? [point] : [] });
}

const rows = [];
for (const vehicle of ['car', 'truck', 'sxs', 'bike']) {
  const phone = vehicle === 'bike';
  const url = new URL(first);
  url.search = new URLSearchParams({ area: 'pointtupper', mode: 'explore', site: 'just', vehicle, q: 'high', res: '1', hour: '13', mp: '0',
    ...(vehicle === 'car' ? {} : { start: 'airport-drag' }), ...(phone ? { q: 'low', touch: '1' } : {}) });
  // hour is a test key. title=1 still exercises the player start and title flow.
  url.searchParams.set('title', '1');
  const tab = await open(url.href);
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: phone ? 390 : 1280, height: phone ? 844 : 720, deviceScaleFactor: 1, mobile: phone });
    if (phone) await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    assert.equal(await tab.read('mmm.vehicleId'), vehicle);
    assert.ok(await tab.read("!document.querySelector('#title').hidden"), 'title remains on the start link');
    await click(tab, '#titleStart');
    if (vehicle === 'car') {
      await openPlaces(tab);
      assert.match(await tab.read("document.querySelector('[data-place=airport-drag]').innerText"), /Port Hawkesbury Airport/);
      await click(tab, '[data-place=airport-drag]');
    }
    await until(tab, `!!${staged}`, vehicle + ' can stage on the runway');
    assert.equal(await tab.read("getComputedStyle(document.querySelector('#airportDrag')).position"), 'fixed', 'the airport chunk paints its HUD');
    if (phone) assert.ok(await tab.read(`(() => {
      const card = document.querySelector('#airportDrag').getBoundingClientRect();
      const go = document.querySelector('#tcGo').getBoundingClientRect();
      return card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom < go.top;
    })()`), 'the phone drag card fits above the pedal');
    assert.deepEqual(await tab.read('mmm.terrain.uniforms.airportDrag.value.toArray()'), [245, 647, 5, 4]);
    await tab.read(`localStorage.removeItem('mmm.drag.402.${vehicle}')`);

    if (vehicle === 'car') {
      assert.match(await tab.read("document.querySelector('#hud').innerText"), /airport runway/);
      await press(tab, 'Enter', 'Enter', 13);
      await until(tab, `${phase} === 'staged'`, 'Enter stages');
      await openPlaces(tab);
      await click(tab, '[data-place=airport-drag]');
      await until(tab, `!!${staged} && ${phase} === 'idle'`, 'a Places jump clears staging');

      await click(tab, '.dragStage');
      const reverse = { code: 'KeyS', key: 's', windowsVirtualKeyCode: 83 };
      await tab.send('Input.dispatchKeyEvent', { ...reverse, type: 'rawKeyDown' });
      try { await until(tab, `${phase} === 'aborted'`, 'backing out of staging cancels the run'); }
      finally { await tab.send('Input.dispatchKeyEvent', { ...reverse, type: 'keyUp' }); }
      await click(tab, '.dragLeave');
      await until(tab, `${phase} === 'idle'`, 'Close clears the cancelled run');
      await openPlaces(tab);
      await click(tab, '[data-place=airport-drag]');
      await until(tab, `!!${staged}`, 'can stage after returning');

      await click(tab, '.dragStage');
      await pedal(tab, true);
      try { await until(tab, `${phase} === 'red'`, 'early throttle trips the red light'); }
      finally { await pedal(tab, false); }
      assert.equal(await tab.read("localStorage.getItem('mmm.drag.402.car')"), null, 'a foul cannot save a best time');
      await click(tab, '.dragBack');
      await until(tab, `!!${staged}`, 'back to start stages again');
    }

    if (vehicle === 'sxs') {
      await tab.read(`(() => {
        const buttons = Array.from({length:16}, (_, i) => ({pressed:i===3,value:i===3?1:0}));
        const pad = {index:0,mapping:'standard',connected:true,axes:[0,0,0,0],buttons};
        Object.defineProperty(navigator, 'getGamepads', {configurable:true,value:() => [pad]});
        window.dispatchEvent(new Event('gamepadconnected'));
      })()`);
    } else await click(tab, '.dragStage');
    await until(tab, `${phase} === 'staged'`, vehicle === 'sxs' ? 'gamepad Y stages' : 'the stage lamp lights');
    if (vehicle === 'sxs') await tab.read("delete navigator.getGamepads");

    if (vehicle === 'car') {
      // Fixed view of both lanes at staging. The shader paint adds no mesh.
      // Isolate the pace car's draw and triangles in the same scene and camera.
      await until(tab, 'mmm.airportDrag.rival.visible', 'the pace car rests on drawn ground');
      const cost = await tab.read(`(() => {
        const {renderer, scene, camera, airportDrag} = mmm;
        const {rival, strip} = airportDrag, view = camera.clone();
        const p = strip.point(-16, 0), q = strip.point(15, 0);
        view.position.set(p.x, rival.position.y + 8, p.z);
        view.lookAt(q.x, rival.position.y, q.z);
        const auto = renderer.info.autoReset;
        function count(show) {
          rival.visible = show;
          renderer.info.reset();
          renderer.render(scene, view);
          const {calls, triangles} = renderer.info.render;
          return {calls, triangles};
        }
        try {
          renderer.info.autoReset = false;
          count(true);
          return {off:count(false), on:count(true), triangles:(rival.geometry.index?.count ?? rival.geometry.attributes.position.count)/3};
        } finally { rival.visible = true; renderer.info.autoReset = auto; renderer.info.reset(); }
      })()`);
      const calls = cost.on.calls - cost.off.calls;
      console.log('Runway budget scene', JSON.stringify(cost));
      assert.ok(calls >= 1 && calls <= 2, 'one mesh per pass, at most two passes');
      assert.equal(cost.on.triangles - cost.off.triangles, calls * cost.triangles, 'only the pace car triangles are added');
      assert.ok(cost.triangles <= 400, JSON.stringify(cost));
      await until(tab, `${phase} === 'amber-2'`, 'the second amber lights');
      await tab.shot(join(evidence, '01-start-tree.png'));
    }
    await until(tab, `${phase} === 'green'`, 'green holds until launch');
    await pedal(tab, true, phone);
    try {
      if (vehicle === 'car') {
        await until(tab, `${phase} === 'running' && mmm.airportDrag.strip.along(mmm.vehicle.x, mmm.vehicle.z) > 145`, 'real drive reaches mid-strip');
        await tab.shot(join(evidence, '02-mid-run.png'));
        await pedal(tab, false);
        await press(tab, 'KeyP', 'p', 80);
        await until(tab, "!document.querySelector('#pauseScreen').hidden", 'P pauses the solo race');
        const before = await tab.read('[mmm.airportDrag.run.time, mmm.vehicle.x, mmm.vehicle.z]');
        await sleep(250);
        assert.deepEqual(await tab.read('[mmm.airportDrag.run.time, mmm.vehicle.x, mmm.vehicle.z]'), before, 'the race clock and car both freeze');
        await press(tab, 'KeyP', 'p', 80);
        await until(tab, "document.querySelector('#pauseScreen').hidden", 'P resumes the race');
        await pedal(tab, true);
      }
      await until(tab, `${phase} === 'finished'`, vehicle + ' drives through the finish', 90000);
    } finally { await pedal(tab, false, phone); }

    const result = await tab.read(`(() => {
      const r = document.querySelector('.dragResult').innerText;
      return {text:r,best:Number(localStorage.getItem('mmm.drag.402.${vehicle}')),status:${status}, along:mmm.airportDrag.strip.along(mmm.vehicle.x,mmm.vehicle.z)};
    })()`);
    const times = result.text.match(/Reaction\s+(\d+\.\d+) s\s+Elapsed\s+(\d+\.\d+) s\s+Trap speed\s+(\d+\.\d+) km\/h/);
    assert.ok(times, result.text);
    assert.ok(Number(times[1]) >= 0 && Number(times[1]) < 4 && Number(times[3]) > 60 && Number(times[3]) < 190, result.text);
    assert.equal(Number(times[2]), Number(result.best.toFixed(3)), 'the result card prints the saved ET');
    assert.match(result.status, /You win|Pace car wins|Dead heat/);
    assert.ok(result.best > 7 && result.best < 40 && result.along > 398, JSON.stringify(result));
    if (vehicle === 'car') {
      await tab.shot(join(evidence, '03-result-card.png'));
      await tab.navigate(url.href);
      await click(tab, '#titleStart');
      await openPlaces(tab);
      await click(tab, '[data-place=airport-drag]');
      await until(tab, `!!${staged}`, 'can stage after reload');
      assert.match(await tab.read("document.querySelector('.dragBest').innerText"), /Vehicle best/);
    }
    rows.push({ vehicle, ...result });
    console.log('PASS drag race', JSON.stringify(rows.at(-1)));
    assert.deepEqual(tab.errors, []);
  } finally { await tab.close(); }
}
writeFileSync(join(evidence, 'results.json'), JSON.stringify(rows, null, 2));
exitCheck(0);
