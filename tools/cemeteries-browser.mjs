#!/usr/bin/env node
// The burial-ground shader in the real page, in headless Chromium (the keeper mesh in web/src/cemeteries.ts).
// The sites start hidden, so three.js would build their shader at first sight, in the middle of a drive. A mesh
// with no instance to draw is in every picture and keeps that shader built. Each part below starts on a fresh page,
// on a named road far from every burial ground, then puts the car beside one and looks at it:
//   on       desktop detail, shadows on from the start.
//   off      desktop detail; the Shadows switch goes off far away (three.js needs another shader without shadows).
//   back-on  desktop detail; the page starts with shadows off and the switch goes on far away.
//   lights   desktop detail; one more light joins the scene far away (three.js needs another shader per light count).
//   phone    phone detail.
// In every part the shader is there before first sight, and first sight builds nothing: each shader that the
// burial-ground material holds after the stones are drawn was in the renderer's list before the car went there.
// The check reads that list by shader id. It does not count shaders: other things near a burial ground may build
// theirs at first sight, and that is not this check's subject. The keeper must be in the pictures and make no draw
// call. The script holds no map position: the page says how far every burial ground is.
// Limit: this is about the shader that three.js builds. What a graphics driver does at a first real draw is not seen.
// Usage (dev server and Chromium come from the shots script; about four minutes):
//   RUN=cemeteries-browser.mjs VIEWS="cemeteries|q=high" tools/yard-shots.sh 1280 720
// CEMETERIES_FAMILY=on|off|back-on|lights|phone runs one part. CEMETERIES_EXPECT_MUTATION is set by
// tools/cemeteries-browser-mutations.mjs.
import assert from 'node:assert/strict';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';

const [, first] = process.argv.slice(2);
const web = new URL(first).port, PORT = process.env.CDP_PORT ?? '9333';
const family = process.env.CEMETERIES_FAMILY ?? 'all', marker = process.env.CEMETERIES_EXPECT_MUTATION;
const START = `http://127.0.0.1:${web}/?mp=0&road=Rankinville%20Road&f=0.3`;
const MARGIN = 300;   // metres more than the sight limit of update() in web/src/cemeteries.ts

const said = [];
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); assert.ok(ok, what); };
const READY = `document.documentElement.dataset.mmmReady === 'true' && !!window.mmm?.vehicle`;
// Count the draws of the site meshes only. The keeper gets its own two hooks: the draw calls between them are its own.
const SETUP = `(() => {
  const c = mmm.cemeteries, r = mmm.renderer;
  if (!c) return null;
  const meshes = c.sites.flatMap(s => s.fitted.map(f => f.mesh)), k = c.keeper;
  const t = window.__cemeteryTest = { drawn: 0, kept: 0, keeperCalls: 0, at: 0, material: meshes[0].material };
  for (const mesh of meshes) { const before = mesh.onBeforeRender; mesh.onBeforeRender = function (...a) { t.drawn++; return before.apply(this, a); }; }
  if (k) { k.onBeforeRender = () => { t.at = r.info.render.calls; }; k.onAfterRender = () => { t.kept++; t.keeperCalls += r.info.render.calls - t.at; }; }
  return { sites: c.sites.length, meshes: meshes.length, oneMaterial: meshes.every(m => m.material === t.material) && (!k || k.material === t.material), low: mmm.low };
})()`;
const STATE = `(() => {
  const c = mmm.cemeteries, r = mmm.renderer, t = __cemeteryTest, p = r.properties.get(t.material), v = mmm.vehicle, eye = mmm.camera.position;
  const gap = (x, z) => Math.round(Math.min(...c.sites.map(s => Math.hypot(x - (s.center[0] - c.origin[0]), z - (c.origin[1] - s.center[1])) - s.radius)));
  return { shadows: r.shadowMap.enabled, shown: c.sites.filter(s => s.group.visible).length, drawn: t.drawn, kept: t.kept, keeperCalls: t.keeperCalls,
    car: gap(v.x, v.z), eye: gap(eye.x, eye.z), shader: p.currentProgram?.id ?? null,
    held: p.programs ? [...p.programs.values()].map(q => q.id).sort((a, b) => a - b) : [], all: r.info.programs.map(q => q.id) };
})()`;
// The car goes to the wall of a burial ground and looks at it. The first side where the game accepts the car is used.
const VISIT = `(() => {
  const c = mmm.cemeteries, v = mmm.vehicle, from = s => Math.hypot(s.center[0] - c.origin[0], c.origin[1] - s.center[1]);
  for (const s of [...c.sites].sort((a, b) => from(a) - from(b))) {
    const x = s.center[0] - c.origin[0], z = c.origin[1] - s.center[1], d = s.radius + 30;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if (v.place(x + Math.sin(a) * d, z - Math.cos(a) * d, a + Math.PI) !== false) { mmm.chase(1); return { site: c.sites.indexOf(s), side: k }; }
    }
  }
  return null;
})()`;
const SWITCH = `(() => {
  const label = [...document.querySelectorAll('#settings label')].find(l => l.textContent.trim() === 'Shadows'), box = label?.querySelector('input');
  if (!box) return null;
  box.checked = !box.checked; box.dispatchEvent(new Event('change'));
  return box.checked;
})()`;
const LIGHT = `(() => {
  const sky = mmm.scene.children.find(o => o.isHemisphereLight), extra = sky.clone();
  extra.intensity = 0; mmm.scene.add(extra);
  return mmm.scene.children.filter(o => o.isHemisphereLight).length;
})()`;

async function open(phone, savedShadows) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
  const send = async (method, params) => { const r = await c.send(method, params); assert.ok(!r.error, JSON.stringify(r.error)); return r.result; };
  const read = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const until = async (expression, what, seconds = 150) => {
    for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(250)) {
      // A reload destroys the page's context for a moment: that answer is "not yet".
      try { if (await read(`(() => { try { return !!(${expression}); } catch { return false; } })()`)) return true; }
      catch (error) { if (!/context|navigat|Cannot find/i.test(error.message)) throw error; }
    }
    throw Error(`timeout: ${what}`);
  };
  await send('Page.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', phone ? { width: 390, height: 844, deviceScaleFactor: 1, mobile: true } : { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // The Shadows switch saves its state in the browser. Every part sets what it starts with, so no part reads another's.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { ${savedShadows === null ? "localStorage.removeItem('mmm.shadows')" : `localStorage.setItem('mmm.shadows', '${savedShadows}')`}; } catch {}` });
  const go = async (url) => {
    await send('Page.navigate', { url }); await sleep(300); await until(READY, 'the page is ready');
    for (let n = 0; marker; n++) {
      if (JSON.stringify(await read('globalThis.__mmmMutationSources')) === JSON.stringify([marker])) break;
      if (n === 4) throw Error('The intended source mutation was not loaded');
      await sleep(500); await send('Page.reload', { ignoreCache: true }); await sleep(300); await until(READY, 'the page is ready');
    }
    await send('Page.bringToFront');
  };
  // Pictures go on while the script waits: a number of them must pass before the next reading.
  const frames = async (n) => { const from = await read('mmm.renderer.info.render.frame'); await until(`mmm.renderer.info.render.frame >= ${from + n}`, `${n} more pictures`); };
  const close = async () => { try { await read(`(() => { try { localStorage.removeItem('mmm.shadows'); } catch {} })()`).catch(() => {}); await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); } finally { c.close(); } };
  return { read, until, go, frames, close, errors: c.errors };
}

// change: nothing, 'switch' (the Shadows switch) or 'light' (one more light), made far from every burial ground.
async function run(name, { phone = false, shadowsAtStart = true, change = null } = {}) {
  // shadows=1 keeps shadows on and holds the slow-computer guard off. A saved 0 starts with shadows off; a saved
  // choice holds the guard off too. So only this script changes the shadow state.
  const page = await open(phone, shadowsAtStart ? null : '0');
  try {
    await page.go(START + (shadowsAtStart ? '&shadows=1' : '') + (phone ? '&q=low&touch=1' : '&q=high'));
    await page.frames(20);
    const made = await page.read(SETUP);
    check(!!made && made.sites > 0 && made.meshes > 0 && made.oneMaterial, `${name}: the land has burial grounds, drawn with one material`);
    check(made.low === phone, `${name}: the page runs in ${phone ? 'phone' : 'desktop'} detail`);
    await page.frames(5);
    const limit = (phone ? 600 : 1100) + MARGIN;
    let before = await page.read(STATE);
    const start = before;
    check(before.car > limit && before.eye > limit && before.shown === 0 && before.drawn === 0, `${name}: the car and the camera start more than ${limit} m from every burial ground (car ${before.car} m, camera ${before.eye} m, ${before.shown} shown)`);
    if (!phone) check(before.shadows === shadowsAtStart, `${name}: the page starts with shadows ${shadowsAtStart ? 'on' : 'off'}`);
    check(before.shader !== null && before.all.includes(before.shader), `${name}: the burial-ground shader is built before first sight`);
    if (change) {
      const what = change === 'switch' ? 'the Shadows switch' : 'a new light in the scene';
      const result = await page.read(change === 'switch' ? SWITCH : LIGHT);
      check(result !== null, `${name}: the page has ${change === 'switch' ? 'the Shadows switch' : 'a sky light to copy'}`);
      await page.frames(5);
      const next = await page.read(STATE);
      if (change === 'switch') check(next.shadows !== before.shadows && next.shadows === result, `${name}: the Shadows switch changes the shadow state of the renderer`);
      check(next.shader !== null && next.shader !== before.shader && next.all.includes(next.shader) && next.shown === 0 && next.drawn === 0,
        `${name}: after ${what} the material has the shader for the new state, before first sight`);
      before = next;
    }
    const visit = await page.read(VISIT);
    check(!!visit, `${name}: the game accepts the car beside a burial ground`);
    await page.until(`__cemeteryTest.drawn > 0`, `${name}: a burial ground is drawn`, 120).catch(() => {});
    const seen = await page.read(STATE);
    check(seen.drawn > 0 && seen.shown > 0, `${name}: a burial ground comes into sight and is drawn (car ${seen.car} m from it)`);
    await page.frames(5);
    const after = await page.read(STATE);
    const fresh = after.held.filter(id => !before.all.includes(id));
    check(after.shader !== null && after.held.length > 0 && fresh.length === 0, `${name}: first sight builds no shader (every shader of the material was there before${fresh.length ? '; new: ' + fresh : ''})`);
    check(after.kept > 0 && after.keeperCalls === 0, `${name}: the keeper is in the pictures and makes no draw call (${after.kept} pictures, ${after.keeperCalls} calls)`);
    check(page.errors.length === 0, `${name}: the page threw nothing${page.errors.length ? ': ' + page.errors.join(' | ') : ''}`);
    said.push(`${name}: ${made.sites} burial grounds, ${made.meshes} meshes; start ${start.car} m away with shader ${start.shader}; shader ${before.shader} of ${before.all.length} in the renderer before first sight; site ${visit.site} side ${visit.side}, ${after.drawn} draws; the material holds [${after.held}] after; keeper in ${after.kept} pictures, ${after.keeperCalls} draw calls`);
  } finally { await page.close(); }
}

try {
  if (family === 'all' || family === 'on') await run('on');
  if (family === 'all' || family === 'off') await run('off', { change: 'switch' });
  if (family === 'all' || family === 'back-on') await run('back-on', { shadowsAtStart: false, change: 'switch' });
  if (family === 'all' || family === 'lights') await run('lights', { change: 'light' });
  if (family === 'all' || family === 'phone') await run('phone', { phone: true });
  check(said.length > 0, `CEMETERIES_FAMILY names a part (${family})`);
  console.log('PASS the burial-ground shader in the page\n  ' + said.join('\n  '));
} catch (error) {
  console.error('FAIL the burial-ground shader in the page: ' + error.message + (said.length ? '\n  ' + said.join('\n  ') : ''));
  process.exitCode = 1;
}
exitCheck();
