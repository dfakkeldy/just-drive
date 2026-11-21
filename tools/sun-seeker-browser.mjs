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
  const setTime = async (date, time, shown = time) => {
    await read(`(() => {
      const a = document.querySelector('#sunSeeker [type=date]'), b = document.querySelector('#sunSeeker [aria-label="Sun time"]');
      a.value = ${JSON.stringify(date)}; b.value = ${JSON.stringify(time)};
      b.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(`document.querySelector('#sunSeeker [role=status]').textContent.startsWith('${shown}')`);
  };
  const position = () => read('[mmm.vehicle.x, mmm.vehicle.y, mmm.vehicle.z, mmm.vehicle.speed]');
  const direction = () => read("mmm.scene.getObjectByName('near-sea').material.uniforms.sunDir.value.toArray()");
  const table = () => read("document.querySelector('.sunReadings tbody').textContent");
  const groundReady = () => wait("!!document.querySelector('.sunReadings tbody td:nth-child(3)') && !document.querySelector('#sunSeeker [role=status]').textContent.includes('Loading hill line')", 30_000);
  const shot = async file => {
    const s = await c.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(out, file + '.png'), Buffer.from(s.result.data, 'base64'));
  };
  const capture = async (date, time, zone) => {
    await read(`(() => {
      const picture = window.sunPicture = { text: [] };
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        picture.text.push(text);
        return fillText.call(this, text, ...args);
      };
      const inspect = async (name, blob, delivery) => {
        const image = await createImageBitmap(blob);
        Object.assign(picture, { name, delivery, mime: blob.type, width: image.width, height: image.height });
        image.close();
      };
      if (${touch}) Object.defineProperties(navigator, {
        canShare: { value: ({ files }) => files[0].type === 'image/png' },
        share: { value: ({ files }) => inspect(files[0].name, files[0], 'share') },
      });
      else {
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (!this.download.startsWith('sun-seeker-')) return click.call(this);
          void fetch(this.href).then(res => res.blob()).then(blob => inspect(this.download, blob, 'download'));
        };
      }
    })()`);
    await click('.sunSave');
    await wait("!!sunPicture.name && document.querySelector('.sunSaveStatus').textContent === 'Picture saved'");
    const result = await read('sunPicture');
    assert.equal(result.name, `sun-seeker-mabou-${date}-${time.replace(':', '')}.png`);
    assert.equal(result.mime, 'image/png');
    assert.equal(result.delivery, touch ? 'share' : 'download');
    assert.deepEqual([result.width, result.height], await read('[mmm.renderer.domElement.width, mmm.renderer.domElement.height]'));
    assert.ok(result.text.includes(`Sun Seeker · ${date} · ${time} ${zone}`));
    assert.ok(result.text.some(text => /^\d{2}:00$/.test(text)), 'the PNG paints projected hour labels');
    if (touch) assert.ok(['Rise', 'Noon', 'Set'].every(text => result.text.includes(text)), 'the PNG paints the compact summary');
    else assert.ok(['Sunrise', 'Solar', 'noon', 'Sunset', 'Flat', 'Over', 'heights.'].every(text => result.text.includes(text)), 'the PNG paints the full readings panel');
    console.log(`PASS ${name} exported PNG: ${result.name}, ${result.width}×${result.height}, ${result.delivery}`);
  };
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
    if (touch) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const visit = `${base}/?test=1&mode=explore&vehicle=bike&road=Mabou%20Harbour%20Road&hud=1&radio=0&exag=1&shadows=1${touch ? '&touch=1&q=low' : '&q=high&finish=1&clouds=1'}`;
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
    assert.match(await read("document.querySelector('.sunBearing').textContent"), /^S\s+180°$/);
    assert.equal(await read("document.querySelector('.sunReadings').open"), !touch);
    assert.ok(!await read("document.querySelector('.sunSave').hidden"));
    const eye = await read('mmm.camera.position.toArray()');
    if (touch) assert.deepEqual(eye, drivingView, 'the survey begins at the drone camera');
    else assert.deepEqual(eye, [car[0], car[1] + 1.7, car[2]], 'the survey begins at player eye height');
    const before = await read("document.querySelector('#sunSeeker [type=date]').value");
    assert.match(before, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(await read("document.querySelector('.sunDayName').textContent"), 'Today');
    assert.equal(await read("document.querySelectorAll('.sunLabels .sunLabel:not(.hour)').length"), 4);
    const layout = await read(`[...document.querySelectorAll('.sunPanel, #sunSeeker input, #sunSeeker button:not([hidden])')].every(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    })`);
    assert.ok(layout, `${name}: controls stay in the viewport`);

    if (touch) {
      assert.equal(await read("getComputedStyle(document.querySelector('.sunArrowHint')).display"), 'none');
      await click('.sunSummary');
      assert.ok(await read("document.querySelector('.sunReadings').open"));
      await click('.sunSummary');
      assert.ok(!await read("document.querySelector('.sunReadings').open"));
    }
    await setTime('2026-03-08', '02:30', '03:30');
    await groundReady();
    assert.match(await read("document.querySelector('#sunSeeker [role=status]').textContent"), /Clock moved forward/);
    await setTime('2026-11-21', '11:30');
    await read(`(() => {
      const slider = document.querySelector('#sunSeeker [type=range]');
      slider.value = String(11 * 60 + 50);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    assert.equal(await read("document.querySelector('[aria-label=\"Sun time\"]').value"), '11:50');
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
    const noonText = await table();
    assert.match(await read("document.querySelector('.sunNoon').textContent"), /Solar noon\s*11:5\d/);
    assert.match(noonText, /Sunrise\s*\d{2}:\d\d\s*\d{2}:\d\d/);
    if (touch) await shot('phone-collapsed');
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
    await tapKey('ArrowUp', 'ArrowUp');
    await sleep(1200);
    const frame = await read('mmm.renderer.info.render.frame');
    await sleep(400);
    assert.equal(await read('mmm.renderer.info.render.frame'), frame, 'the still scene does not render when idle');
    assert.equal(await table(), noonText, 'panning leaves the surveyed times fixed');
    if (!touch) await shot('desktop-noon');

    if (!touch) {
      await setTime('2026-06-21', '05:20');
      await wait("mmm.scene.getObjectByName('near-sea').material.uniforms.sunDir.value.y < 0.05");
      const dawn = await direction();
      assert.notDeepEqual(dawn, noon, 'world light follows the selected instant');
      await click('.sunFace');
      await sleep(400);
      await shot('desktop-dawn');
      await capture('2026-06-21', '05:20', 'ADT');
      await setTime('2026-06-21', '00:00');
      await wait("mmm.scene.children.some(o => o.material?.name === 'night sky')");
      assert.equal(await read('mmm.scene.children.find(o => o.isDirectionalLight).castShadow'), false, 'night has no sun shadows');
      assert.equal(await read('mmm.finish.skip.clouds'), true, 'the night preview omits Finish cloud shadows');
    } else await capture('2026-11-21', '11:50', 'AST');

    await tapKey('Escape', 'Escape');
    await wait("!document.querySelector('#pauseScreen').hidden && !document.querySelector('#sunSeeker')");
    assert.deepEqual(await read('mmm.camera.position.toArray()'), drivingView, 'leaving restores the camera');
    assert.deepEqual(await direction(), originalSun, 'leaving restores the game light');
    if (!touch) assert.equal(await read('mmm.finish.skip.clouds'), false, 'leaving restores the Finish cloud term');
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
      assert.equal(await read("mmm.scene.getObjectByName('night lamp glow').visible"), false);
      assert.ok(await read(`mmm.terrain.group.children.filter(o => o.visible).every(o =>
        o.material.uniforms.nightLamp.value.w === 0 && o.material.uniforms.nightPool.value.every(pool => pool.w === 0))`));
      await tapKey('Escape', 'Escape');
      await wait("!document.querySelector('#sunSeeker')");
      assert.equal(await read(hasMap), false, 'the preview releases its shadow map when it closes');
      assert.equal(await read("mmm.scene.getObjectByName('night lamp glow').visible"), true);

      const measurements = [];
      for (const exag of [1, 1.5]) {
        // 45.867 N, 61.315 W in UTM 20, with the free camera 1.7 m above ground.
        const church = new URL(visit);
        church.searchParams.set('exag', exag);
        church.searchParams.set('camground', '1');
        church.searchParams.set('cam', '630785.16,5080650.92,1.7,180,-10,51');
        await c.send('Page.navigate', { url: church.href });
        await wait("document.title.startsWith('settled') && !!window.mmm?.vehicle", 120_000);
        const shadowTarget = () => read('mmm.scene.children.find(o => o.isDirectionalLight).target.position.toArray()');
        const before = await shadowTarget();
        await tapKey('KeyP', 'p');
        await click('#pauseSun');
        await wait("!!document.querySelector('#sunSeeker[open]')");
        await setTime('2026-11-21', '11:50');
        await groundReady();
        measurements.push((await table()).trim().replace(/\s+/g, ' ') + ' / ' + await read("document.querySelector('.sunNoon').textContent"));
        await tapKey('Escape', 'Escape');
        const after = await shadowTarget();
        assert.ok(Math.hypot(...after.map((value, i) => value - before[i])) < 2, 'closing restores the free camera shadow target');
        console.log(`Church, EXAG ${exag}: ${measurements.at(-1)}`);
      }
      assert.equal(measurements[0], measurements[1], 'church table is invariant across hill scales');
      writeFileSync(join(out, 'church-times.json'), JSON.stringify({
        latitude: 45.867, longitude: -61.315, eyeAboveGround: 1.7,
        date: '2026-11-21', zone: 'AST',
        times: measurements.map((times, i) => ({ exag: [1, 1.5][i], times })),
      }, null, 2) + '\n');
    }
    console.log(`PASS ${name}: pause and Settings, fixed eye, look input, date and lighting, idle render, close and Resume`);
  } finally {
    c.close();
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
  }
}
