#!/usr/bin/env node
// The mail car in the real game, both bodies: the Blender car (the default, also ?car=blender) and the code car (?car=code).
// Same road, hour, camera and drive for each pair; pictures plus a few measured facts.
//
//   OUT=data/work/threads/blender-car/pass4 RUN=blender-car-drive.mjs VIEWS="x|x=1" tools/yard-shots.sh 1440 1000
//   ONLY=hwy19-noon-chase,night-rear  limits the views.   CARS=blender  limits the bodies.
//   BLOCK=1 adds the fallback test: the model file is blocked and the game must still start, on the code car.
//   ERA=1 adds Mabou 1884: the horse is the ride and the model file is not fetched; ?vehicle=car gives the car.
//   START=1 measures a phone's first start (LOW quality, nothing cached), with the code car and with the Blender
//   car: asset requests, bytes, and the time to a settled page. Three starts each.
//   SLOW=1 measures a slow phone's first start on a throttled line: does the model arrive in time, or does the
//   game fall back to the code car? Three starts for each line speed.
//   CUT=1 adds files that arrive damaged (the browser is handed a cut file in place of the real one): the game
//   must start on the code car, with the trim its mode asks for, one console warning and no console error.
// Then: python3 tools/blender/drive-sheet.py <OUT>
//
// Lamp states: the game itself only flashes the amber lamp (main.ts) and lights the brake lamps when towing
// (towing.ts). There is no headlight beam and no dusk switch in the game today. For the night pictures this
// script sets the brake lamps to the towing code's "braking" value and holds the amber lamp at its "on" value,
// so every lamp the car has can be seen at once. Nothing here changes what the game does on its own.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const [out, first] = process.argv.slice(2), port = process.env.CDP_PORT;
assert.ok(out && first && port, 'run through tools/yard-shots.sh (see the top of this file)');
const origin = new URL(first).origin;
const HWY = 'road=Highway 19&f=0.03', MINES = 'road=Mabou Mines Road&f=0.3';
// Highway 19 at f=0.03 is in the village, heading about 51 degrees; the Mines Road point heads about 328.
const NIGHT = 'hour=22';
const LAMPS_ON = `(() => { const car = mmm.vehicle.car;
  for (const lamp of car.brakeLights) lamp.material.emissiveIntensity = 2.5;
  if (car.beacon) Object.defineProperty(car.beacon.material, 'emissiveIntensity', { get: () => 2.2, set() {}, configurable: true });
  return car.brakeLights.length; })()`;
const VIEWS = [
  { name: 'hwy19-noon-chase', query: `${HWY}&hour=12&demo=5` },
  { name: 'hwy19-noon-seat', query: `${HWY}&hour=12&demo=5&view=seat` },
  { name: 'hwy19-dusk-chase', query: `${HWY}&hour=18.2&demo=5` },
  { name: 'hwy19-dusk-seat', query: `${HWY}&hour=18.2&demo=5&view=seat` },
  { name: 'mines-noon-chase', query: `${MINES}&hour=12&demo=6`, measure: true },
  { name: 'mines-noon-seat', query: `${MINES}&hour=12&demo=6&view=seat` },
  { name: 'mines-dusk-chase', query: `${MINES}&hour=18.2&demo=6` },
  { name: 'mines-dusk-seat', query: `${MINES}&hour=18.2&demo=6&view=seat` },
  // A muddy run: full dirt, seen from the roadside as the car stops.
  { name: 'mines-muddy', query: `${MINES}&hour=12&demo=6`, before: 'mmm.vehicle.car.setDirt?.(1)', side: true },
  // Night: every lamp. Rear: tail, brake, high brake, amber lamp, the sign's back. Front: head lamp units and the sign.
  { name: 'night-rear', query: `${HWY}&${NIGHT}`, before: LAMPS_ON, around: { back: 6.2, side: 1.6, up: 1.7, fov: 40 } },
  { name: 'night-front', query: `${HWY}&${NIGHT}`, before: LAMPS_ON, around: { back: -6.4, side: 1.5, up: 1.5, fov: 40 } },
  { name: 'dusk-front', query: `${HWY}&hour=18.2`, around: { back: -6.4, side: 1.5, up: 1.5, fov: 40 } },
  // The seat at night: what the driver sees of the cabin when only the lamps and the sky's last light are left.
  { name: 'night-seat', query: `${HWY}&${NIGHT}&demo=5&view=seat` },
  // A phone's car (the LOW file), from the seat: phones use this view too.
  { name: 'phone-seat', query: `${HWY}&hour=12&demo=5&view=seat&q=low`, low: true },
  // Kept for later (it needs the guard rails and the Highland bull in the game): the car at night, lamps on,
  // facing the bull on the Mabou Mines Road. Give it the bull's place and remove `skip`.
  { name: 'night-bull', query: `at=619093,5109326,317&${NIGHT}`, before: LAMPS_ON, around: { back: 7, side: 2.2, up: 1.8, fov: 45 }, skip: true },
];
const only = process.env.ONLY?.split(',');
const cars = (process.env.CARS ?? 'code,blender').split(',');
const facts = [];

/** `served` hands the browser these bytes in place of the model file (a damaged download), with a 200 answer. */
async function open(url, block = [], served = null) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const problems = [], warnings = [];
  let c;
  c = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
    if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push('console.error: ' + d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') warnings.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon/.test(d.params.entry.url ?? '')) problems.push('browser log: ' + d.params.entry.text.slice(0, 200));
    if (d.method === 'Fetch.requestPaused' && served) c.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: served.type ?? 'model/gltf-binary' }], body: served.body.toString('base64') }).catch(() => {});
  } });
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.ok(!r.result.exceptionDetails, `${expression.slice(0, 80)}: ${JSON.stringify(r.result.exceptionDetails)?.slice(0, 400)}`);
    return r.result.result.value;
  };
  await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable'); await c.send('Log.enable');
  if (block.length) await c.send('Network.setBlockedURLs', { urls: block });
  if (served) await c.send('Fetch.enable', { patterns: [{ urlPattern: '*mail-car*.glb', requestStage: 'Request' }] });
  // The default resource-timing buffer holds 250 entries; a full land load passes that, and the model request would drop out.
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'performance.setResourceTimingBufferSize(10000)' });
  await c.send('Page.navigate', { url });
  const close = async () => { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); };
  return { c, read, close, problems, warnings };
}
// What the car is, read from the running game: which body, its size, and how it stands on the road.
const STATE = `(() => { const v = mmm.vehicle, car = v.car, p = car.root.position.clone(); let triangles = 0, meshes = 0;
  car.root.traverse(o => { if (o.isMesh && o.visible) { meshes++; triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
  const gaps = Object.values(car.wheels).map(w => { w.getWorldPosition(p); const ground = mmm.terrain.heightAt(p.x, p.z); return ground === null ? null : +(p.y - ${0.35} - ground).toFixed(3); });
  car.root.updateMatrixWorld(true);
  const wheels = Object.fromEntries(Object.entries(car.wheels).map(([key, w]) => [key, car.root.worldToLocal(w.getWorldPosition(p)).toArray().map(n => +n.toFixed(4))]));
  return { body: car.root.name === 'car_root' ? 'blender' : 'code', triangles: Math.round(triangles), meshes, speed: +v.speed.toFixed(2), gaps, wheels,
    lean: [car.body.rotation.x, car.body.rotation.z, car.body.position.y].map(n => +n.toFixed(4)), low: mmm.low }; })()`;

for (const view of VIEWS) {
  if (view.skip || (only && !only.includes(view.name))) continue;
  for (const car of cars) {
    const page = await open(`${origin}/?${view.query}&car=${car}&hud=0&shadows=1`);
    try {
      let settled = false; const samples = [];
      for (let i = 0; i < 1500 && !settled; i++) {
        await sleep(100);
        settled = await page.read('document.title === "settled"');
        // While the car drives the washboard, note how the body moves on its springs and where the wheels are.
        if (view.measure && i % 2 === 0 && await page.read('!!window.mmm?.vehicle && Math.abs(mmm.vehicle.speed) > 2')) samples.push(await page.read(STATE));
      }
      assert.ok(settled, `${view.name}/${car} did not settle: ${page.problems.join(' | ')}`);
      if (view.before) await page.read(view.before);
      if (view.around || view.side) {
        // A fixed camera near the stopped car, placed from the car's own position and heading.
        const a = view.around ?? { back: 1.2, side: 6.0, up: 1.45, fov: 42 };
        await page.read(`(() => { const v = mmm.vehicle, cam = mmm.camera, h = v.heading, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
          const place = () => { cam.position.set(v.x - fx * ${a.back} + rx * ${a.side}, v.y + ${a.up}, v.z - fz * ${a.back} + rz * ${a.side}); cam.lookAt(v.x, v.y + .95, v.z); if (cam.fov !== ${a.fov}) { cam.fov = ${a.fov}; cam.updateProjectionMatrix(); } };
          const render = mmm.renderer.render.bind(mmm.renderer); let busy = false;
          mmm.renderer.render = (scene, camera, ...rest) => { if (camera === cam && !busy) { busy = true; place(); busy = false; } return render(scene, camera, ...rest); }; place(); return true; })()`);
      }
      await sleep(900);
      const state = await page.read(STATE);
      const shot = await page.c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/${car}-${view.name}.png`, Buffer.from(shot.result.data, 'base64'));
      assert.deepEqual(page.problems, [], `${view.name}/${car}: page errors`);
      assert.equal(state.body, car, `${view.name}: asked for the ${car} car`);
      assert.equal(state.low, !!view.low, `${view.name}: ${view.low ? 'the phone (LOW) quality' : 'desktop quality'}`);
      if (car === 'blender') assert.ok(view.low ? state.triangles < 8000 : state.triangles > 8000, `${view.name}: ${view.low ? 'the LOW file' : 'the desktop file'} (${state.triangles} triangles)`);
      // Each wheel's centre is one wheel radius above the car's contact plane, at the wheelbase and track: the same
      // for both bodies, so the game's own ground-following puts both on the road in the same way.
      for (const [key, at] of Object.entries(state.wheels)) {
        const want = [key.endsWith('l') ? -.785 : .785, .35, key.startsWith('f') ? -1.31 : 1.31];
        want.forEach((n, i) => assert.ok(Math.abs(at[i] - n) < .002, `${car}/${view.name}: wheel ${key} is at ${at}, not ${want}`));
      }
      const row = { view: view.name, car, ...state, warnings: page.warnings.length };
      if (samples.length) {
        const span = pick => { const values = samples.map(pick); return [Math.min(...values), Math.max(...values)].map(n => +n.toFixed(4)); };
        row.drive = { samples: samples.length, pitch: span(s => s.lean[0]), roll: span(s => s.lean[1]), heave: span(s => s.lean[2]),
          wheelGap: span(s => Math.max(...s.gaps.filter(g => g !== null).map(Math.abs))) };
        assert.ok(row.drive.pitch[1] - row.drive.pitch[0] > .001 || row.drive.roll[1] - row.drive.roll[0] > .001, `${car}: the body moves on its springs on the washboard`);
        // The game lays one flat plane through four wheel contacts, so on rough ground a wheel can be some
        // centimetres off the land under it, for either body. This only guards against a car that floats or sinks.
        assert.ok(row.drive.wheelGap[1] < .25, `${car}: the wheels stay near the road (largest gap ${row.drive.wheelGap[1]} m)`);
      }
      facts.push(row); console.log(JSON.stringify(row));
    } finally { await page.close(); }
  }
}

if (process.env.BLOCK === '1') {
  // The model file cannot be fetched: the game must start anyway, on the code car, with no page error.
  for (const [label, block] of [['file blocked', ['*mail-car*.glb']]]) {
    const page = await open(`${origin}/?${HWY}&hour=12&hud=0&shadows=1`, block);      // the default path: no car is named
    try {
      let settled = false, firstBody = null;
      for (let i = 0; i < 1500 && !settled; i++) {
        await sleep(100);
        // The car the game holds, from the first moment it holds one: never an empty rig.
        firstBody ??= await page.read(`window.mmm?.vehicle ? (() => { let n = 0; mmm.vehicle.car.root.traverse(o => { if (o.isMesh) n++; }); return { body: mmm.vehicle.car.root.name === 'car_root' ? 'blender' : 'code', meshes: n }; })() : null`);
        settled = await page.read('document.title === "settled"');
      }
      assert.ok(settled, `fallback (${label}) did not settle: ${page.problems.join(' | ')}`);
      const state = await page.read(STATE);
      const shot = await page.c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/fallback-hwy19-noon-chase.png`, Buffer.from(shot.result.data, 'base64'));
      assert.deepEqual(page.problems, [], 'fallback: no page error');
      assert.equal(state.body, 'code', 'fallback: the code car is used');
      assert.ok(firstBody && firstBody.body === 'code' && firstBody.meshes > 5, 'fallback: the first car the game holds is the whole code car');
      assert.ok(page.warnings.some(w => w.includes('Blender mail car')), 'fallback: one plain console line says why');
      const row = { view: `fallback: ${label}`, ...state, firstBody, warnings: page.warnings };
      facts.push(row); console.log(JSON.stringify(row));
    } finally { await page.close(); }
  }
}
if (process.env.START === '1') {
  // A phone's first start: LOW quality, touch controls, an empty cache. What does the car cost? Counted: the
  // game's own files (land, models, sound, data). Left out: the dev server's script modules, which a published
  // build sends as one file. Time: from the address to the page's own "settled" signal.
  const start = async (label, extra) => {
    const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const urls = new Map(), sizes = new Map(), problems = [];
    const c = await cdp(tab.webSocketDebuggerUrl, { onEvent: d => {
      if (d.method === 'Network.requestWillBeSent') urls.set(d.params.requestId, d.params.request.url);
      if (d.method === 'Network.loadingFinished') sizes.set(d.params.requestId, d.params.encodedDataLength);
      if (d.method === 'Runtime.exceptionThrown') problems.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    } });
    const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true })).result.result?.value;
    try {
      await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
      const began = Date.now(); let carAt = null, settledAt = null;
      await c.send('Page.navigate', { url: `${origin}/?q=low&touch=1${extra}` });
      for (let i = 0; i < 3000 && settledAt === null; i++) {
        await sleep(50);
        if (carAt === null && await read('!!window.mmm?.vehicle')) carAt = Date.now() - began;
        if (await read('document.documentElement.dataset.mmmReady === "true"')) settledAt = Date.now() - began;
      }
      assert.ok(settledAt !== null, `${label}: the page did not settle (${problems.join(' | ')})`);
      await sleep(500);
      const body = await read(`mmm.vehicle.car.root.name === 'car_root' ? 'blender' : 'code'`), low = await read('mmm.low');
      let requests = 0, bytes = 0, model = 0, modelBytes = 0;
      for (const [id, url] of urls) {
        if (!/^https?:/.test(url) || !sizes.has(id)) continue;
        const path = new URL(url).pathname;
        if (/^\/(src\/|@|node_modules\/|\.vite\/)/.test(path) || path === '/' || /\.(ts|js|css|html)$/.test(path)) continue;
        requests++; bytes += sizes.get(id);
        if (path.startsWith('/models/mail-car')) { model++; modelBytes += sizes.get(id); }
      }
      return { label, body, low, requests, bytes, modelRequests: model, modelBytes, carAtMs: carAt, settledAtMs: settledAt, problems: problems.length };
    } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
  };
  await start('warm-up (not counted)', '&car=code');          // the dev server compiles its modules on the first visit
  for (const [label, extra, body] of [['phone start, code car (?car=code)', '&car=code', 'code'], ['phone start, Blender car (the default)', '', 'blender']]) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await start(label, extra));
    for (const run of runs) { assert.equal(run.body, body, `${label}: the car`); assert.equal(run.low, true, `${label}: phone quality`); assert.equal(run.problems, 0, `${label}: no page error`); }
    const middle = key => runs.map(run => run[key]).sort((a, b) => a - b)[1];
    const row = { view: label, requests: middle('requests'), bytes: middle('bytes'), modelRequests: runs[0].modelRequests, modelBytes: runs[0].modelBytes,
      carAtMs: middle('carAtMs'), settledAtMs: middle('settledAtMs'), settledAll: runs.map(run => run.settledAtMs), carAll: runs.map(run => run.carAtMs) };
    facts.push(row); console.log(JSON.stringify(row));
  }
}
if (process.env.SLOW === '1') {
  // A slow phone's first start: LOW quality, an empty cache, a throttled line (all requests, also the dev server's
  // script modules, so the absolute times are longer than a published build's). For each start: when the model
  // file was asked for and when it was all here, when the game had its car, and which car that was.
  // The game waits up to 8 s for the model from the moment it needs the car. Before, the 8 s counted from the
  // model's request: a start whose model took longer than 8,000 ms would have had the code car.
  const slow = async (label, kbps, latency) => {
    const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const asked = new Map(), done = new Map(), warnings = [];
    let began = 0;
    const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 600000, onEvent: d => {
      if (d.method === 'Network.requestWillBeSent' && d.params.request.url.includes('/models/mail-car')) asked.set(d.params.requestId, Date.now() - began);
      if (d.method === 'Network.loadingFinished' && asked.has(d.params.requestId)) done.set(d.params.requestId, Date.now() - began);
      if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') warnings.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160));
    } });
    const read = async expression => (await c.send('Runtime.evaluate', { expression, returnByValue: true })).result.result?.value;
    try {
      await c.send('Runtime.enable'); await c.send('Page.enable'); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
      await c.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: kbps * 125, uploadThroughput: kbps * 125 });
      began = Date.now(); let carAt = null;
      await c.send('Page.navigate', { url: `${origin}/?q=low&touch=1` });
      for (let i = 0; i < 2400 && carAt === null; i++) { await sleep(250); if (await read('!!window.mmm?.vehicle')) carAt = Date.now() - began; }
      assert.ok(carAt !== null, `${label}: no car after ten minutes`);
      const body = await read(`mmm.vehicle.car.root.name === 'car_root' ? 'blender' : 'code'`);
      const id = [...asked.keys()][0], modelAskedAtMs = asked.get(id) ?? null, modelHereAtMs = done.get(id) ?? null;
      return { label, body, modelAskedAtMs, modelHereAtMs, modelTookMs: modelHereAtMs === null ? null : modelHereAtMs - modelAskedAtMs, carAtMs: carAt, said: warnings.filter(w => w.includes('Blender mail car')).length };
    } finally { c.close(); await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
  };
  for (const [label, kbps, latency] of [['4 Mbit/s, 100 ms', 4000, 100], ['1.6 Mbit/s, 150 ms', 1600, 150], ['0.75 Mbit/s, 300 ms', 750, 300]]) {
    const runs = [];
    for (let i = 0; i < 3; i++) { runs.push(await slow(label, kbps, latency)); console.log(JSON.stringify(runs.at(-1))); }
    const row = { view: `slow phone start: ${label}`, starts: runs.length, fellBackNow: runs.filter(run => run.body === 'code').length,
      wouldHaveFallenBackBefore: runs.filter(run => run.modelTookMs === null || run.modelTookMs > 8000).length,
      modelTookMs: runs.map(run => run.modelTookMs), carAtMs: runs.map(run => run.carAtMs), bodies: runs.map(run => run.body) };
    facts.push(row); console.log(JSON.stringify(row));
  }
}
if (process.env.CUT === '1') {
  // The model file arrives damaged. Each time: the code car from the first moment, with the trim the mode asks for
  // (mail: sign and lamp; explore: neither), one console warning that says why, and no console error at all.
  const whole = readFileSync(new URL('../web/public/models/mail-car.glb', import.meta.url)), json = whole.readUInt32LE(12);
  const longer = Buffer.from(whole); longer.writeUInt32LE(whole.length + 4, 8);
  const CASES = [
    ['cut 300 bytes before the end', whole.subarray(0, whole.length - 300), 'hour=12', true],
    ['cut in the middle', whole.subarray(0, whole.length >> 1), 'hour=12', true],
    ['cut inside its JSON', whole.subarray(0, 20 + (json >> 1)), 'hour=12', true],
    ['a header with the wrong length', longer, 'hour=12', true],
    ['cut 300 bytes before the end, explore mode', whole.subarray(0, whole.length - 300), 'hour=12&mode=explore', false],
  ];
  for (const [label, body, query, trim] of CASES) {
    const page = await open(`${origin}/?${HWY}&${query}&hud=0&shadows=1`, [], { body });      // the default path
    try {
      let settled = false, firstBody = null;
      const look = `window.mmm?.vehicle ? (() => { const car = mmm.vehicle.car; let n = 0; car.root.traverse(o => { if (o.isMesh) n++; });
        return { body: car.root.name === 'car_root' ? 'blender' : 'code', meshes: n, sign: !!car.signLight?.visible, lamp: !!car.beacon?.visible }; })() : null`;
      for (let i = 0; i < 1500 && !settled; i++) { await sleep(100); firstBody ??= await page.read(look); settled = await page.read('document.title === "settled"'); }
      assert.ok(settled, `${label} did not settle: ${page.problems.join(' | ')}`);
      const last = await page.read(look);
      if (label === CASES[0][0]) { const shot = await page.c.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/fallback-cut-file.png`, Buffer.from(shot.result.data, 'base64')); }
      assert.deepEqual(page.problems, [], `${label}: no console error and no page error`);
      assert.ok(firstBody?.body === 'code' && firstBody.meshes > 5 && last.body === 'code', `${label}: the code car, from the first moment (${JSON.stringify(firstBody)})`);
      assert.deepEqual([last.sign, last.lamp], [trim, trim], `${label}: the fallback car has ${trim ? 'its mail sign and lamp' : 'no mail sign and no lamp'}`);
      const said = page.warnings.filter(w => w.includes('Blender mail car'));
      assert.equal(said.length, 1, `${label}: one console line says why (${page.warnings.length} warnings)`);
      const row = { view: `damaged file: ${label}`, firstBody, last, said: said[0].slice(0, 160), warnings: page.warnings.length };
      facts.push(row); console.log(JSON.stringify(row));
    } finally { await page.close(); }
  }
}
if (process.env.ERA === '1') {
  // Mabou 1884: the ride is the horse, and the car's model file is not fetched. The car is built there only on request.
  for (const [label, query, root, fetched] of [['1884', 'era=1884', 'Saddle horse', false], ['1884, car asked for', 'era=1884&vehicle=car', 'car_root', true]]) {
    const page = await open(`${origin}/?${query}&hud=0&shadows=1`);      // the default path
    try {
      let settled = false;
      for (let i = 0; i < 1500 && !settled; i++) { await sleep(100); settled = await page.read('document.title === "settled"'); }
      assert.ok(settled, `${label} did not settle: ${page.problems.join(' | ')}`);
      // Also: when the model file was asked for, among everything else the page fetched (it must not wait for the land).
      const state = await page.read(`(() => { const all = performance.getEntriesByType('resource'), model = all.find(e => e.name.includes('/models/mail-car'));
        return { root: mmm.vehicle.car.root.name, fetched: !!model, requests: all.length,
          ...(model ? { modelAskedAtMs: Math.round(model.startTime), modelHereAtMs: Math.round(model.responseEnd), askedBeforeIt: all.filter(e => e.startTime < model.startTime).length,
            lastOtherRequestAtMs: Math.round(Math.max(...all.filter(e => e !== model).map(e => e.startTime))) } : {}) }; })()`);
      if (state.fetched) assert.ok(state.modelAskedAtMs < state.lastOtherRequestAtMs, `${label}: the model file is asked for while the land still loads (${state.modelAskedAtMs} ms; last other request ${state.lastOtherRequestAtMs} ms)`);
      const shot = await page.c.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/era-${fetched ? 'car' : 'horse'}.png`, Buffer.from(shot.result.data, 'base64'));
      assert.deepEqual(page.problems, [], `${label}: no page error`);
      assert.equal(state.root, root, `${label}: the ride`);
      assert.equal(state.fetched, fetched, `${label}: the model file is ${fetched ? '' : 'not '}fetched`);
      const row = { view: `era: ${label}`, ...state, warnings: page.warnings.length };
      facts.push(row); console.log(JSON.stringify(row));
    } finally { await page.close(); }
  }
}
writeFileSync(`${out}/drive.json`, JSON.stringify(facts, null, 2) + '\n');
console.log(`blender-car-drive: ${facts.length} rows written to ${out}/drive.json`);
