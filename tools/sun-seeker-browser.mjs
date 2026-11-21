import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const port = process.env.CDP_PORT, base = new URL(process.argv[3]).origin;
const out = join(process.env.MMM_CHECK_OUT ?? process.argv[2], 'evidence/sun-seeker-browser');
mkdirSync(out, { recursive: true });

for (const [name, width, height, touch] of [['desktop', 1360, 900, false], ['phone-drone', 393, 852, true]]) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl);
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result.exceptionDetails) throw Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const wait = async (expression, timeout = 15_000) => {
    const until = Date.now() + timeout;
    do { if (await read(expression)) return; await sleep(80); } while (Date.now() < until);
    assert.fail(`${name}: timed out waiting for ${expression}`);
  };
  const key = async (code, key, type = 'keyDown') => c.send('Input.dispatchKeyEvent', { type, code, key });
  const tapKey = async (code, value) => { await key(code, value); await key(code, value, 'keyUp'); };
  const click = selector => read(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const setTime = async (date, time) => {
    await read(`(() => {
      const a = document.querySelector('#sunSeeker [type=date]'), b = document.querySelector('#sunSeeker [type=time]');
      a.value = ${JSON.stringify(date)}; b.value = ${JSON.stringify(time)};
      a.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await wait(`document.querySelector('#sunSeeker [role=status]').textContent.startsWith('${time}')`);
  };
  const position = () => read('[mmm.vehicle.x, mmm.vehicle.y, mmm.vehicle.z, mmm.vehicle.speed]');
  const direction = () => read("mmm.scene.getObjectByName('near-sea').material.uniforms.sunDir.value.toArray()");
  const shot = async file => {
    const s = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, file + '.png'), Buffer.from(s.result.data, 'base64'));
  };
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
    if (touch) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const visit = `${base}/?test=1&mode=explore&vehicle=bike&road=Mabou%20Harbour%20Road&hud=1&radio=0&exag=1&shadows=1${touch ? '&touch=1&q=low' : '&q=high'}`;
    await c.send('Page.navigate', { url: visit });
    await wait("document.title.startsWith('settled') && !!window.mmm?.vehicle", 120_000);
    if (touch) {
      await tapKey('KeyF', 'f');
      await key('Space', ' ');
      await sleep(3600);
      await key('Space', ' ', 'keyUp');
    }
    await tapKey('KeyP', 'p');
    await wait("!document.querySelector('#pauseScreen').hidden");
    const car = await position(), drivingView = await read('mmm.camera.position.toArray()'), originalSun = await direction();
    if (touch) assert.ok(drivingView[1] > car[1] + 4, `drone above the car: ${drivingView[1]} vs ${car[1]}`);
    await click('#pauseSun');
    await wait("!!document.querySelector('#sunSeeker[open]')");
    const eye = await read('mmm.camera.position.toArray()');
    if (touch) assert.deepEqual(eye, drivingView, 'the survey begins at the drone camera');
    else assert.deepEqual(eye, [car[0], car[1] + 1.7, car[2]], 'the survey begins at player eye height');
    const before = await read("document.querySelector('#sunSeeker [type=date]').value");
    assert.match(before, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(await read("document.querySelector('.sunDayName').textContent"), 'Today');
    assert.equal(await read("document.querySelectorAll('.sunLabels .sunLabel:not(.hour)').length"), 4);
    const layout = await read(`[...document.querySelectorAll('.sunPanel, #sunSeeker input, #sunSeeker button')].every(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    })`);
    assert.ok(layout, `${name}: controls stay in the viewport`);

    await setTime('2026-11-21', '11:50');
    await wait("mmm.scene.getObjectByName('near-sea').material.uniforms.sunDir.value.y > 0.39");
    const noon = await direction();
    if (!touch) {
      const shadow = await read(`(() => {
        const light = mmm.scene.children.find(o => o.isDirectionalLight);
        return { on: light.castShadow && !!light.shadow.map, direction: light.position.clone().sub(light.target.position).normalize().toArray() };
      })()`);
      assert.ok(shadow.on, 'the sun casts the selected daylight shadows');
      assert.ok(shadow.direction.every((n, i) => Math.abs(n - noon[i]) < .000001), 'the shadow light follows the sky direction');
    }
    const noonText = await read("document.querySelector('.sunReadings tbody').textContent");
    assert.match(noonText, /Solar noon\s*11:5\d/);
    assert.match(noonText, /Sunrise\s*\d{2}:\d\d\s*\d{2}:\d\d/);
    const turn = () => read('mmm.camera.quaternion.toArray()');
    const facing = await turn();
    if (touch) {
      await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 198, y: 410 }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 254, y: 410 }] });
      await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await tapKey('ArrowLeft', 'ArrowLeft');
    assert.notDeepEqual(await turn(), facing, 'look changes on input');
    assert.deepEqual(await read('mmm.camera.position.toArray()'), eye, 'look leaves the eye still');
    assert.deepEqual(await position(), car, 'the car does not move');

    await click('.sunFace');
    for (let i = 0; i < (touch ? 2 : 3); i++) await tapKey('ArrowUp', 'ArrowUp');
    await sleep(1200);
    const frame = await read('mmm.renderer.info.render.frame');
    await sleep(400);
    assert.equal(await read('mmm.renderer.info.render.frame'), frame, 'the still scene does not render when idle');
    await shot(name + '-noon');

    if (!touch) {
      await setTime('2026-06-21', '05:20');
      await wait("mmm.scene.getObjectByName('near-sea').material.uniforms.sunDir.value.y < 0.05");
      const dawn = await direction();
      assert.notDeepEqual(dawn, noon, 'world light follows the selected instant');
      await click('.sunFace');
      await sleep(400);
      await shot('desktop-dawn');
      await setTime('2026-06-21', '00:00');
      await wait("mmm.scene.children.some(o => o.material?.name === 'night sky')");
      assert.equal(await read('mmm.scene.children.find(o => o.isDirectionalLight).castShadow'), false, 'night has no sun shadows');
    }

    await tapKey('Escape', 'Escape');
    await wait("!document.querySelector('#pauseScreen').hidden && !document.querySelector('#sunSeeker')");
    assert.deepEqual(await read('mmm.camera.position.toArray()'), drivingView, 'leaving restores the camera');
    assert.deepEqual(await direction(), originalSun, 'leaving restores the game light');
    assert.deepEqual(await position(), car, 'leaving returns to the frozen car');
    await click('#pauseSettings');
    await wait("document.querySelector('#settings').classList.contains('open')");
    await click('#gear');
    await wait("!document.querySelector('#pauseScreen').hidden");
    await click('#resumeGame');
    await wait("document.querySelector('#pauseScreen').hidden");
    if (!touch) {
      const hasMap = "mmm.scene.children.some(o => o.isDirectionalLight && o.castShadow && o.shadow.map)";
      await c.send('Page.navigate', { url: visit + '&date=2026-06-21&time=00:00' });
      await wait("document.title.startsWith('settled') && !!window.mmm?.vehicle", 120_000);
      assert.equal(await read(hasMap), false, 'night visit starts without a shadow map');
      await tapKey('KeyP', 'p');
      await click('#pauseSun');
      await wait("!!document.querySelector('#sunSeeker[open]')");
      await setTime('2026-06-21', '13:00');
      await wait(hasMap);
      await wait("mmm.terrain.group.children.some(o => o.visible && o.material?.uniforms?.shadowOn?.value === 1)");
      await tapKey('Escape', 'Escape');
      await wait("!document.querySelector('#sunSeeker')");
      assert.equal(await read(hasMap), false, 'the preview releases its shadow map when it closes');
    }
    console.log(`PASS ${name}: pause and Settings, fixed eye, look input, date and lighting, idle render, close and Resume`);
  } finally {
    c.close();
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
  }
}
