#!/usr/bin/env node
// Standalone drone vehicle in Just Drive (web/src/drone.ts, drone-rules.ts, garage.ts, vehicle-choice.ts, main.ts).
// Checks:
//   - "Drone" choice in Just Drive title card and Settings (desktop and phone); absent in mail play (UI, URL, storage).
//   - Standalone flight: no 2 km range limit, 120 m ceiling, distant building roof floor (>3 km from start), R / ROAD
//     returns to the nearest road, no car mesh or car physics, Places and Big Map work, no forbidden words on Just Drive.
//   - 5 km straight-line flight at full top speed (60 m/s), asserting the ground under the drone stays loaded and drawn
//     at finest detail the entire way, with real-browser loading speed telemetry.
// Usage: RUN=drone-vehicle-browser.mjs VIEWS="drone|mode=explore&radio=0" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cdp, cdpFetch, exitCheck, sleep } from './cdp.mjs';

const [outDir, first] = process.argv.slice(2);
const PORT = process.env.CDP_PORT ?? '9333';
const WORK_SHOTS = process.env.DRONE_WORK_SHOTS === '1';
const root = resolve(import.meta.dirname, '..');
const failures = [];
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures.push(label); };

// Pick a real Mabou building >3 km from village (0, 0) with a tall roof so we can test the distant roof floor.
const terrainDir = resolve(root, 'data/baked/terrain');
const manifest = JSON.parse(readFileSync(resolve(terrainDir, 'manifest.json'), 'utf8'));
const buildings = JSON.parse(readFileSync(resolve(terrainDir, manifest.buildings.file), 'utf8')).buildings;
const [VE, VN] = manifest.village;
const distantBuilding = buildings
  .map(b => ({ ...b, wx: b.x - VE, wz: VN - b.y, dist: Math.hypot(b.x - VE, VN - b.y), h: Math.max(b.ridge, b.eave) }))
  .filter(b => b.dist > 3200 && b.dist < 6500 && b.h >= 7 && b.length >= 10 && b.width >= 8)
  .sort((a, b) => b.h - a.h)[0];
assert.ok(distantBuilding, 'expected a real Mabou building >3.2 km from village centre');

async function page(width, height, touch) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const { send } = await cdp(tab.webSocketDebuggerUrl, { deadline: 300000 });
  const read = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result?.result?.value;
  };
  const until = async (expr, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await read(expr)) return true; await sleep(80); } return !!(await read(expr)); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch });
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const codes = { Space: ' ', ArrowUp: '', ArrowDown: '', ArrowLeft: '', ArrowRight: '', ShiftLeft: '', Escape: 'Escape' };
  const vk = { Space: 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ShiftLeft: 16, Escape: 27 };
  const key = async (code, down) => {
    const k = code in codes ? (code.startsWith('Arrow') || code === 'Escape' ? code : code === 'Space' ? ' ' : 'Shift') : code.slice(3).toLowerCase();
    await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: k, windowsVirtualKeyCode: vk[code] ?? k.toUpperCase().charCodeAt(0) });
  };
  const hold = async (code, ms) => { await key(code, true); await sleep(ms); await key(code, false); };
  const tap = (code) => hold(code, 40);
  const shot = async (name) => {
    const data = (await send('Page.captureScreenshot', { format: 'png' })).result.data;
    const file = `${outDir}/${name}.png`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  };
  const touchAt = (type, points) => send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, id) => ({ ...p, id })) });
  const centre = async (id) => JSON.parse(await read(`JSON.stringify((r=>({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}))(document.getElementById('${id}').getBoundingClientRect()))`));
  const open = async (extra, start = true) => {
    const url = new URL(first);
    url.search = '';
    url.searchParams.set('hud', '1');
    url.searchParams.set('radio', '0');
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    await send('Page.navigate', { url: url.href });
    await until(`typeof window.mmm === 'object'`, 240000);
    await read('window.addEventListener("error",e=>{(window.qaErrors??=[]).push(String(e.message))})');
    if (extra.title === '1') {
      assert.ok(await until(`!!document.getElementById('titleStart')`, 240000), 'title card');
      if (start) {
        await read(`document.getElementById('titleStart').click();document.activeElement?.blur()`);
        assert.ok(await until(`String(document.title).startsWith('settled')`, 300000), 'settled after start');
      }
    } else {
      assert.ok(await until(`String(document.title).startsWith('settled')`, 300000), 'settled');
    }
    await sleep(500);
  };
  const close = async () => { await cdpFetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`); };
  return { send, read, until, key, hold, tap, shot, touchAt, centre, open, close };
}

// Helper injected into page to inspect finest tile level and drawnFine status at (x, z).
const PROBE_EXPR = `(x, z) => {
  const t = mmm.terrain, m = t.manifest;
  if (!window.__finestExists) {
    window.__finestExists = new Set();
    window.__maxLevel = 0;
    for (const [lv, names] of Object.entries(m.levels)) {
      const l = +lv; if (l > window.__maxLevel) window.__maxLevel = l;
      for (const n of names) window.__finestExists.add(l + '/' + n);
    }
  }
  const e = x + m.village[0] - m.origin[0], s = z - (m.village[1] - m.origin[1]);
  let finest = -1, finestCoord = '';
  for (let l = window.__maxLevel; l >= 0; l--) {
    const size = m.size / (2 ** l), coord = Math.floor(e / size) + '_' + Math.floor(s / size);
    if (window.__finestExists.has(l + '/' + coord)) { finest = l; finestCoord = coord; break; }
  }
  const surface = t.surfaceAt(x, z);
  const level = t.levelAt(x, z);
  const drawnFine = finest === 8 ? t.drawnFine.has(finestCoord) : true;
  return { x, z, hasSurface: !!surface, ground: surface?.ground ?? null, level, finest, drawnFine,
    speed: Math.hypot(mmm.drone.state.vx, mmm.drone.state.vz), maxSpeed: mmm.drone.maxSpeed,
    loading: mmm.drone.loading, pending: t.pending, treesVisible: !!mmm.trees?.group.visible };
}`;

// ---- 1. Desktop Just Drive: vehicle choice, controls, distant roof, ceiling, R road, 5 km flight ----
{
  const p = await page(1280, 720, false);
  await p.open({ mode: 'explore', title: '1', q: 'high' }, false);
  const picker = await p.read(`({
    labels: [...document.querySelectorAll('#vehicleChoice button')].map(b => b.textContent),
    kinds: [...document.querySelectorAll('#vehicleChoice button')].map(b => b.dataset.vehicle),
    hasDrone: !!document.querySelector('#vehicleChoice [data-vehicle="drone"]'),
    room: !!document.querySelector('#titleCard .mpControl'),
  })`);
  check(JSON.stringify(picker.kinds) === JSON.stringify(['car', 'sxs', 'bike', 'drone']) && JSON.stringify(picker.labels) === JSON.stringify(['Car', 'Side by side', 'Dirt bike', 'Drone']),
    'desktop Just Drive title card offers Car, Side by side, Dirt bike, Drone: ' + JSON.stringify(picker.labels));

  // Click Drone on the title card -> saves, reloads, opens in standalone drone mode.
  await p.read(`document.querySelector('#vehicleChoice [data-vehicle="drone"]').click()`);
  await p.until(`new URLSearchParams(location.search).get('vehicle') === 'drone'`, 30000);
  await p.until(`!!document.getElementById('titleStart') && typeof window.mmm === 'object'`, 240000);
  await sleep(600);
  const titleState = await p.read(`({
    vehicleId: mmm.vehicleId,
    stored: localStorage.getItem('mmm.vehicle'),
    pressed: document.querySelector('#vehicleChoice [data-vehicle="drone"]')?.getAttribute('aria-pressed'),
    startLabel: document.getElementById('titleStart')?.textContent,
    keysText: document.getElementById('titleControls')?.textContent ?? '',
    room: !!document.querySelector('#titleCard .mpControl'),
    active: mmm.drone.active,
    free: mmm.drone.free,
    carInScene: mmm.scene.children.includes(mmm.vehicle.car.root),
    engineSound: mmm.engineSound,
    noOverlap: (() => {
      const card = document.getElementById('titleCard');
      const rect = s => card.querySelector(s)?.getBoundingClientRect();
      const c = rect('#vehicleChoice'), dl = rect('dl'), st = rect('#titleStart');
      const clear = (a, b) => a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1;
      return !!c && !!dl && !!st && clear(c, dl) && clear(dl, st) && clear(c, st);
    })(),
  })`);
  check(titleState.vehicleId === 'drone' && titleState.stored === 'drone' && titleState.pressed === 'true',
    'selecting Drone switches to standalone drone vehicle: ' + JSON.stringify({ vehicleId: titleState.vehicleId, stored: titleState.stored, pressed: titleState.pressed }));
  check(titleState.startLabel === 'Start flying' && titleState.keysText.includes('WASD') && titleState.keysText.includes('nearest road') && titleState.noOverlap,
    'title card shows drone controls and Start flying without overlap');
  check(picker.room && !titleState.room, 'the car title card offers a room, the standalone drone title card does not: ' + JSON.stringify({ car: picker.room, drone: titleState.room }));
  check(titleState.active && titleState.free && !titleState.carInScene && titleState.engineSound === null,
    'standalone drone starts active and free, with no car mesh or engine sound');

  // Start flying.
  await p.read(`document.getElementById('titleStart').click();document.activeElement?.blur()`);
  assert.ok(await p.until(`String(document.title).startsWith('settled')`, 300000), 'settled after starting drone');
  await sleep(500);

  // Verify HUD text & no car physics (driveVehicle never called during normal flight).
  // Wrap the player's own car physics step on the instance: main.ts calls vehicle.update directly, so wrapping an exposed
  // function would not catch it.
  await p.read(`(() => { const v = mmm.vehicle, orig = v.update.bind(v); window.__driveCalls = 0; v.update = (...a) => { window.__driveCalls++; return orig(...a); }; })()`);
  await p.hold('Space', 1000);
  await p.hold('KeyW', 1200);
  await sleep(600);
  const flightHud = await p.read(`({
    hud: document.getElementById('hud').textContent,
    hints: document.getElementById('droneHints')?.hidden ? '' : document.getElementById('droneHints')?.textContent ?? '',
    driveCalls: window.__driveCalls,
    settingsPressed: document.querySelector('#settingsVehicleChoice [data-vehicle="drone"]')?.getAttribute('aria-pressed'),
    miniMapVisible: document.getElementById('miniMap')?.getClientRects().length > 0,
  })`);
  check(flightHud.driveCalls === 0, 'no car physics ran during drone flight (driveCalls=' + flightHud.driveCalls + ')');
  check(/^DRONE · Height \d+ m · Speed \d+ m\/s/.test(flightHud.hud) && !flightHud.hud.includes('From the car') && flightHud.hints.includes('Nearest road') && flightHud.hints.includes('Places / map') && !flightHud.hints.includes('Land') && !flightHud.hints.includes('Fly back'),
    'standalone drone HUD shows height and speed with no car distance, and the key panel shows road/places/map: ' + flightHud.hud.replace(/\n/g, ' | ') + ' / ' + flightHud.hints);
  check(flightHud.settingsPressed === 'true' && flightHud.miniMapVisible, 'Settings highlights Drone and desktop minimap stays visible');

  // Capture desktop screenshot over Mabou village!
  await p.hold('ArrowDown', 350);
  await sleep(400);
  const desktopShot = await p.shot('01-drone-vehicle-desktop');
  if (WORK_SHOTS) {
    mkdirSync(resolve(root, 'data/work'), { recursive: true });
    copyFileSync(desktopShot, resolve(root, 'data/work/drone-vehicle-desktop.png'));
  }

  // F in standalone drone mode stays in drone mode.
  await p.tap('KeyF');
  await sleep(250);
  check(await p.read(`mmm.drone.active && mmm.drone.free`), 'F stays in standalone drone mode');

  // M opens Big Map, Esc closes; L opens Places, Esc closes.
  await p.tap('KeyM');
  await sleep(250);
  const mapOpen = await p.read(`!!mmm.bigMap?.busy`);
  await p.tap('Escape');
  await sleep(200);
  await p.tap('KeyL');
  await sleep(250);
  const placesOpen = await p.read(`!!mmm.places?.busy`);
  await p.tap('Escape');
  await sleep(200);
  check(mapOpen && placesOpen, `M opens Big Map (${mapOpen}) and L opens Places (${placesOpen})`);

  // 120 m ceiling check: start near 105 m above ground, hold Space, assert held <= 121 m.
  await p.read(`(() => { const g = mmm.terrain.heightAt(mmm.drone.state.x, mmm.drone.state.z) ?? 0; mmm.drone.state.y = g + 108; })()`);
  await p.hold('Space', 4500);
  await sleep(400);
  const ceilState = await p.read(`({ height: mmm.drone.height, hud: document.getElementById('hud').textContent })`);
  check(ceilState.height !== null && ceilState.height >= 117 && ceilState.height <= 121.5 && ceilState.hud.includes('at height limit'),
    `120 m ceiling enforced (${ceilState.height?.toFixed(1)} m)`);

  // Distant roof floor check: move drone over real building >3.2 km from start, settle, descend with ShiftLeft, verify roof floor!
  await p.read(`(() => { mmm.drone.place(${distantBuilding.wx}, ${(distantBuilding.ground * 1.5 + distantBuilding.h + 20).toFixed(2)}, ${distantBuilding.wz}, 0); })()`);
  await p.until(`String(document.title).startsWith('settled')`, 60000);
  await sleep(400);
  const beforeRoof = await p.read(`({ ground: mmm.terrain.surfaceAt(${distantBuilding.wx}, ${distantBuilding.wz})?.ground ?? null, y: mmm.drone.state.y })`);
  // Hold down until the drone stops sinking (it rests on the floor), not for a fixed time: a busy machine descends slower.
  await p.key('ShiftLeft', true);
  for (let i = 0, last = Infinity, still = 0; i < 70 && still < 3; i++) {
    await sleep(300);
    const y = await p.read('mmm.drone.state.y');
    still = Math.abs(y - last) < 0.05 ? still + 1 : 0; last = y;
  }
  await p.key('ShiftLeft', false);
  await sleep(500);
  const afterRoof = await p.read(`({ y: mmm.drone.state.y, ground: mmm.terrain.surfaceAt(${distantBuilding.wx}, ${distantBuilding.wz})?.ground ?? null, height: mmm.drone.height })`);
  const expectedRoofTop = -0.2 + (distantBuilding.ground - (-0.2)) * 1.5 + distantBuilding.h;
  const expectedFloor = expectedRoofTop + 2;
  check(afterRoof.y >= expectedFloor - 1.6 && afterRoof.y <= expectedFloor + 3 && afterRoof.y > (afterRoof.ground ?? 0) + 5,
    `distant roof floor (${(distantBuilding.dist / 1000).toFixed(2)} km from village, roof +${distantBuilding.h.toFixed(1)} m): y=${afterRoof.y.toFixed(1)} within floor ${(expectedFloor - 1.6).toFixed(1)}..${(expectedFloor + 3).toFixed(1)}, ground=${afterRoof.ground?.toFixed(1)}`);

  // R puts the drone back on the nearest road.
  await p.read(`(() => { const s = mmm.drone.state; const hit = mmm.roads.nearest(s.x, s.z, 500); if (hit) { s.x = hit.x + 90; s.z = hit.z + 90; s.vx = 10; } })()`);
  await sleep(150);
  await p.tap('KeyR');
  await sleep(300);
  const afterR = await p.read(`(() => { const s = mmm.drone.state, hit = mmm.roads.nearest(s.x, s.z, 20); return { dist: hit?.dist ?? 999, speed: Math.hypot(s.vx, s.vz), active: mmm.drone.active }; })()`);
  check(afterR.active && afterR.dist < 0.5 && afterR.speed < 0.2,
    `R puts drone back on nearest road (dist=${afterR.dist.toFixed(2)} m, speed=${afterR.speed.toFixed(2)} m/s)`);

  // 5 km straight-line flight at full top speed (60 m/s): start at (0, 2600), fly due north (yaw = 0 -> -z) to z <= -2500 (5.1 km).
  await p.read(`(() => { const g = mmm.terrain.heightAt(0, 2600) ?? 30; mmm.drone.place(0, g + 35, 2600, 0); mmm.drone.maxSpeed = 60; })()`);
  await p.until(`String(document.title).startsWith('settled')`, 60000);
  await sleep(500);
  const start5k = await p.read(`({ x: mmm.drone.state.x, z: mmm.drone.state.z, maxSpeed: mmm.drone.maxSpeed })`);
  const samples = [];
  const t0 = Date.now();
  await p.key('KeyW', true);
  let travelled = 0;
  const maxMs = 240000;
  while (travelled < 5050 && Date.now() - t0 < maxMs) {
    const sample = await p.read(`(${PROBE_EXPR})(mmm.drone.state.x, mmm.drone.state.z)`);
    travelled = Math.hypot(sample.x - start5k.x, sample.z - start5k.z);
    samples.push({ t: (Date.now() - t0) / 1000, travelled, ...sample });
    await sleep(120);
  }
  await p.key('KeyW', false);
  const elapsed = (Date.now() - t0) / 1000;
  const badSurface = samples.filter(s => !s.hasSurface);
  const badLevel = samples.filter(s => s.finest >= 0 && s.level < s.finest);
  const badDrawn = samples.filter(s => s.finest === 8 && !s.drawnFine);
  const speeds = samples.map(s => s.speed);
  const slowedCount = samples.filter(s => s.loading).length;
  const avgSpeed = travelled / Math.max(elapsed, 0.001);
  const peakSpeed = Math.max(...speeds);
  const minSpeedMid = Math.min(...speeds.slice(Math.min(10, speeds.length - 1)));
  console.log('5KM_DESKTOP', JSON.stringify({
    travelled: +travelled.toFixed(1), elapsed: +elapsed.toFixed(1), avgSpeed: +avgSpeed.toFixed(1),
    peakSpeed: +peakSpeed.toFixed(1), minSpeedMid: +minSpeedMid.toFixed(1),
    samples: samples.length, slowedCount, badSurface: badSurface.length, badLevel: badLevel.length, badDrawn: badDrawn.length,
    firstBadLevel: badLevel[0] ?? null, firstBadDrawn: badDrawn[0] ?? null,
  }));
  writeFileSync(`${outDir}/desktop-5km.json`, JSON.stringify({ travelled, elapsed, avgSpeed, peakSpeed, slowedCount, badSurface: badSurface.length, badLevel: badLevel.length, badDrawn: badDrawn.length, samples }, null, 2));
  check(travelled >= 5000, `desktop 5 km straight flight completed: ${travelled.toFixed(0)} m in ${elapsed.toFixed(1)} s (avg ${avgSpeed.toFixed(1)} m/s, peak ${peakSpeed.toFixed(1)} m/s, slowed ${slowedCount}/${samples.length})`);
  check(badSurface.length === 0 && badLevel.length === 0 && badDrawn.length === 0,
    `desktop 5 km ground stayed loaded and drawn at finest level the whole way (badSurface=${badSurface.length}, badLevel=${badLevel.length}, badDrawn=${badDrawn.length})`);
  check(samples.every(s => s.treesVisible), 'trees stayed loaded/visible along the 5 km desktop flight');

  // Throttled network proof (4G: 150 ms latency, 3 Mbps down) flying east 1.2 km into fresh tiles at 60 m/s:
  // the ground under the drone must stay loaded. The slowed count is printed; on the MacBook the cap has not had to act.
  await p.send('Network.enable');
  await p.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 375000, uploadThroughput: 150000 });
  await p.read(`(() => { const g = mmm.terrain.heightAt(0, -2500) ?? 30; mmm.drone.place(0, g + 35, -2500, -Math.PI / 2); mmm.drone.maxSpeed = 60; })()`);
  await sleep(600);
  const tStart = await p.read(`({ x: mmm.drone.state.x, z: mmm.drone.state.z })`);
  const tSamples = [];
  const tt0 = Date.now();
  await p.key('KeyW', true);
  let tDist = 0;
  while (tDist < 1200 && Date.now() - tt0 < 90000) {
    const sample = await p.read(`(${PROBE_EXPR})(mmm.drone.state.x, mmm.drone.state.z)`);
    tDist = Math.hypot(sample.x - tStart.x, sample.z - tStart.z);
    tSamples.push(sample);
    await sleep(120);
  }
  await p.key('KeyW', false);
  await p.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const tElapsed = (Date.now() - tt0) / 1000;
  const tBadSurface = tSamples.filter(s => !s.hasSurface).length;
  const tBadLevel = tSamples.filter(s => s.finest >= 0 && s.level < s.finest).length;
  const tBadDrawn = tSamples.filter(s => s.finest === 8 && !s.drawnFine).length;
  const tSlowed = tSamples.filter(s => s.loading).length;
  console.log('THROTTLED_DESKTOP', JSON.stringify({
    travelled: +tDist.toFixed(1), elapsed: +tElapsed.toFixed(1), avgSpeed: +(tDist / Math.max(tElapsed, 0.001)).toFixed(1),
    peakSpeed: +Math.max(...tSamples.map(s => s.speed)).toFixed(1),
    samples: tSamples.length, slowedCount: tSlowed, badSurface: tBadSurface, badLevel: tBadLevel, badDrawn: tBadDrawn,
  }));
  check(tDist >= 1150 && tBadSurface === 0 && tBadLevel === 0 && tBadDrawn === 0,
    `throttled 1.2 km flight stayed loaded the whole way (dist=${tDist.toFixed(0)} m, slowed=${tSlowed}/${tSamples.length}, badSurface=${tBadSurface}, badLevel=${tBadLevel}, badDrawn=${tBadDrawn})`);

  const errors = await p.read('window.qaErrors ?? []');
  check(errors.length === 0, 'desktop drone vehicle had zero page errors: ' + JSON.stringify(errors));
  await p.close();
}

// ---- 2. Mail play: Drone NEVER appears in UI and ?vehicle=drone / saved storage stays on car ----
{
  const p = await page(1280, 720, false);
  await p.open({ mode: 'mail', vehicle: 'drone', title: '1', q: 'low' }, false);
  const mailState = await p.read(`({
    vehicleId: mmm.vehicleId,
    active: mmm.drone.active,
    free: mmm.drone.free,
    picker: !!document.getElementById('vehicleChoice'),
    settingsPicker: !!document.getElementById('settingsVehicleChoice'),
    stops: mmm.shift.stops,
  })`);
  check(mailState.vehicleId === 'car' && !mailState.active && !mailState.free && !mailState.picker && !mailState.settingsPicker && mailState.stops > 0,
    'mail play rejects ?vehicle=drone and shows no Drone picker: ' + JSON.stringify(mailState));
  await p.read(`localStorage.setItem('mmm.vehicle', 'drone')`);
  await p.open({ mode: 'mail', title: '1', q: 'low' }, false);
  const savedMail = await p.read(`({ vehicleId: mmm.vehicleId, active: mmm.drone.active, free: mmm.drone.free })`);
  check(savedMail.vehicleId === 'car' && !savedMail.active && !savedMail.free,
    'mail play ignores saved mmm.vehicle=drone: ' + JSON.stringify(savedMail));
  // The control for the "no car physics" check: the same counter on the car does count while it drives.
  await p.read(`document.getElementById('titleStart').click();document.activeElement?.blur()`);
  assert.ok(await p.until(`String(document.title).startsWith('settled')`, 300000), 'mail play settled');
  await p.read(`(() => { const v = mmm.vehicle, orig = v.update.bind(v); window.__driveCalls = 0; v.update = (...a) => { window.__driveCalls++; return orig(...a); }; })()`);
  await sleep(1500);
  const carCalls = await p.read('window.__driveCalls');
  check(carCalls > 10, 'the car physics counter counts in mail play (control for the drone check): ' + carCalls);
  await p.close();
}

// ---- 2b. A drone link opened by a player whose saved ride is the dirt bike still flies the drone ----
{
  const p = await page(1280, 720, false);
  await p.open({ mode: 'explore', q: 'low' }, false);
  await p.read(`localStorage.setItem('mmm.vehicle', 'bike')`);
  await p.open({ mode: 'explore', vehicle: 'drone', title: '1', q: 'low' });
  const linked = await p.read(`({ vehicleId: mmm.vehicleId, active: mmm.drone.active, free: mmm.drone.free, errors: window.qaErrors ?? [] })`);
  check(linked.vehicleId === 'drone' && linked.active && linked.free && linked.errors.length === 0,
    'a drone link with a saved dirt bike starts the standalone drone without errors: ' + JSON.stringify(linked));
  await p.close();
}

// ---- 3. Phone Just Drive: portrait (390x844) & landscape (844x390), sticks, ROAD, 2+ km flight ----
for (const [w, h, name] of [[390, 844, 'portrait'], [844, 390, 'landscape']]) {
  const p = await page(w, h, true);
  await p.open({ mode: 'explore', vehicle: 'drone', touch: '1', title: '1', q: 'low' }, false);
  const titleCheck = await p.read(`({
    kinds: [...document.querySelectorAll('#vehicleChoice button')].map(b => b.dataset.vehicle),
    pressed: document.querySelector('#vehicleChoice [data-vehicle="drone"]')?.getAttribute('aria-pressed'),
    startLabel: document.getElementById('titleStart')?.textContent,
    scroll: document.getElementById('titleCard').scrollHeight - document.getElementById('titleCard').clientHeight,
  })`);
  check(JSON.stringify(titleCheck.kinds) === JSON.stringify(['car', 'sxs', 'bike', 'drone']) && titleCheck.pressed === 'true' && titleCheck.startLabel === 'Start flying',
    `phone ${name}: title card shows Drone choice and Start flying`);

  await p.read(`document.getElementById('titleStart').click();document.activeElement?.blur()`);
  assert.ok(await p.until(`String(document.title).startsWith('settled')`, 300000), `phone ${name}: settled`);
  await sleep(600);

  const uiCheck = await p.read(`(() => {
    const ids = ['droneLeft', 'droneRight', 'droneReturn', 'gear', 'pauseButton', 'placesButton', 'hud'];
    const rects = ids.map(id => {
      const el = document.getElementById(id);
      if (!el || !el.getClientRects().length) return [id, null];
      const r = el.getBoundingClientRect();
      return [id, { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }];
    });
    const faults = [];
    for (const [id, r] of rects) {
      if (!r) { faults.push(id + ' hidden'); continue; }
      if (r.l < -0.5 || r.t < -0.5 || r.r > innerWidth + 0.5 || r.b > innerHeight + 0.5) faults.push(id + ' offscreen');
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j];
      if (ra && rb && ra.l < rb.r - 1 && ra.r > rb.l + 1 && ra.t < rb.b - 1 && ra.b > rb.t + 1) faults.push(a + '/' + b);
    }
    return {
      faults,
      returnText: document.getElementById('droneReturn')?.textContent,
      hasDroneBtn: !!document.getElementById('droneButton'),
      hasDrivingHelp: !!document.getElementById('drivingHelp'),
      tcOn: document.body.classList.contains('tcOn'),
      hud: document.getElementById('hud')?.textContent,
    };
  })()`);
  check(uiCheck.faults.length === 0 && uiCheck.returnText === 'ROAD' && !uiCheck.hasDroneBtn && !uiCheck.hasDrivingHelp && !uiCheck.tcOn,
    `phone ${name}: sticks, ROAD, PLACES, Pause, gear and HUD clear with no overlaps (${JSON.stringify(uiCheck.faults)}, button=${uiCheck.returnText})`);
  check(/^DRONE · Height \d+ m\nSpeed \d+ m\/s/.test(uiCheck.hud) && !uiCheck.hud.includes('From the car'), `phone ${name}: standalone phone HUD has no car distance (${JSON.stringify(uiCheck.hud)})`);

  // Touch right stick forward, verify flight, take portrait screenshot, tap ROAD to return to road.
  const right = await p.centre('droneRight');
  const before = await p.read(`({ x: mmm.drone.state.x, z: mmm.drone.state.z })`);
  await p.touchAt('touchStart', [right]);
  for (let t = 0; t < 2000; t += 100) { await p.touchAt('touchMove', [{ x: right.x, y: right.y - right.h * 0.4 }]); await sleep(100); }
  await p.touchAt('touchEnd', []);
  await sleep(400);
  const moved = await p.read(`Math.hypot(mmm.drone.state.x - (${before.x}), mmm.drone.state.z - (${before.z}))`);
  check(moved > 10, `phone ${name}: right stick flies forward (${moved.toFixed(1)} m)`);

  if (name === 'portrait') {
    const phoneShot = await p.shot('02-drone-vehicle-phone-portrait');
    if (WORK_SHOTS) {
      mkdirSync(resolve(root, 'data/work'), { recursive: true });
      copyFileSync(phoneShot, resolve(root, 'data/work/drone-vehicle-phone.png'));
    }
    // Phone 2.5 km fast flight at full speed (60 m/s) to measure LOW-detail phone loading!
    await p.read(`(() => { const g = mmm.terrain.heightAt(0, 2000) ?? 30; mmm.drone.place(0, g + 35, 2000, 0); mmm.drone.maxSpeed = 60; })()`);
    await p.until(`String(document.title).startsWith('settled')`, 60000);
    await sleep(400);
    const pStart = await p.read(`({ x: mmm.drone.state.x, z: mmm.drone.state.z })`);
    const pSamples = [];
    const pt0 = Date.now();
    await p.touchAt('touchStart', [right]);
    let pDist = 0;
    while (pDist < 2550 && Date.now() - pt0 < 180000) {
      await p.touchAt('touchMove', [{ x: right.x, y: right.y - right.h * 0.42 }]);
      const sample = await p.read(`(${PROBE_EXPR})(mmm.drone.state.x, mmm.drone.state.z)`);
      pDist = Math.hypot(sample.x - pStart.x, sample.z - pStart.z);
      pSamples.push({ t: (Date.now() - pt0) / 1000, pDist, ...sample });
      await sleep(120);
    }
    await p.touchAt('touchEnd', []);
    const pElapsed = (Date.now() - pt0) / 1000;
    const pBadSurface = pSamples.filter(s => !s.hasSurface).length;
    const pBadLevel = pSamples.filter(s => s.finest >= 0 && s.level < s.finest).length;
    const pBadDrawn = pSamples.filter(s => s.finest === 8 && !s.drawnFine).length;
    const pSlowed = pSamples.filter(s => s.loading).length;
    console.log('2.5KM_PHONE', JSON.stringify({
      travelled: +pDist.toFixed(1), elapsed: +pElapsed.toFixed(1), avgSpeed: +(pDist / Math.max(pElapsed, 0.001)).toFixed(1),
      peakSpeed: +Math.max(...pSamples.map(s => s.speed)).toFixed(1),
      samples: pSamples.length, slowedCount: pSlowed, badSurface: pBadSurface, badLevel: pBadLevel, badDrawn: pBadDrawn,
    }));
    check(pDist >= 2500 && pBadSurface === 0 && pBadLevel === 0 && pBadDrawn === 0,
      `phone portrait 2.5 km full-speed flight stayed loaded (dist=${pDist.toFixed(0)} m, badSurface=${pBadSurface}, badLevel=${pBadLevel}, badDrawn=${pBadDrawn})`);
  }

  // Tap ROAD button -> puts drone back on nearest road.
  await p.read(`(() => { const s = mmm.drone.state; const hit = mmm.roads.nearest(s.x, s.z, 500); if (hit) { s.x = hit.x + 80; s.z = hit.z + 80; } })()`);
  const roadBtn = await p.centre('droneReturn');
  await p.touchAt('touchStart', [roadBtn]); await p.touchAt('touchEnd', []);
  await sleep(300);
  const roadAfter = await p.read(`mmm.roads.nearest(mmm.drone.state.x, mmm.drone.state.z, 20)?.dist ?? 999`);
  check(roadAfter < 0.5, `phone ${name}: ROAD button returns drone to nearest road (dist=${roadAfter.toFixed(2)} m)`);

  const errors = await p.read('window.qaErrors ?? []');
  check(errors.length === 0, `phone ${name}: zero page errors ` + JSON.stringify(errors));
  await p.close();
}

console.log(failures.length ? `DRONE_VEHICLE_BROWSER FAIL ${failures.length}: ${failures.join('; ')}` : 'DRONE_VEHICLE_BROWSER PASS');
exitCheck(failures.length ? 1 : 0);
