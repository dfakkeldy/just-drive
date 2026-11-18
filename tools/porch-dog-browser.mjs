#!/usr/bin/env node
// The porch dog in the real page, in headless Chromium.
//   1. On a desktop and on a slow computer (LOW) the model loads, with the triangle count of its contract.
//   2. The head points at the car, on either side, and stops at the limit of a dog's neck when the car is behind.
//      The tail sweeps while the car is close.
//      The dog is drawn only when the car or the camera is near (GUEST_SEEN in web/src/porch-house.ts). The house stays.
//   3. With the model file blocked there is no dog, the house still stands, the page settles and throws nothing.
// The script holds no map position: the car starts on the road by its name, and every other place is worked out
// in the page from where the dog and its house are. It also takes pictures: close, from the road, LOW from far, and no dog.
// Usage (dev server and Chromium come from the shots script; about two minutes):
//   RUN=porch-dog-browser.mjs VIEWS="porch|x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exitCheck, open, sleep } from './cdp.mjs';

const [outDir, first] = process.argv.slice(2);
const base = new URL(first).origin;
const contract = JSON.parse(readFileSync(new URL('./blender/porch-dog-contract.json', import.meta.url), 'utf8'));
const road = (f, more = '') => `${base}/?road=${encodeURIComponent('Beaton Road')}&f=${f}&hud=0&shadows=1${more}`;
const REACH = 1.3;   // NECK_TURN + HEAD_TURN in web/src/porch-dog.ts
const SEEN = 250;    // GUEST_SEEN in web/src/porch-house.ts

const facts = (page) => page.read(`(() => {
  const m = window.mmm, d = m.porchDog;
  return { state: d.state, triangles: d.triangles, house: m.porch.triangles, waiting: m.porch.waiting, low: m.low };
})()`);
// Puts the car beside the dog, in the dog's own metres (right, ahead), and reports where the head points afterwards:
// `off` is the flat angle between the head's line and the line to the car, `turn` is the neck's plus the head's.
const watch = async (page, right, ahead) => {
  await page.read(`(() => {
    const m = window.mmm, g = m.porchDog.group, p = m.camera.position.clone();
    g.updateWorldMatrix(true, false); g.localToWorld(p.set(${right}, 0, ${-ahead}));
    m.vehicle.place(p.x, p.z, 0);
  })()`);
  await page.send('Page.bringToFront');
  await sleep(4000);
  return page.read(`(() => {
    const m = window.mmm, d = m.porchDog, at = m.camera.position.clone(), line = at.clone();
    d.head.updateWorldMatrix(true, false); d.head.getWorldPosition(at); d.head.getWorldDirection(line);
    const head = Math.atan2(-line.x, -line.z), car = Math.atan2(m.vehicle.x - at.x, m.vehicle.z - at.z);
    const off = Math.atan2(Math.sin(head - car), Math.cos(head - car));
    return { off, turn: d.neck.rotation.y + d.head.rotation.y, neck: d.neck.rotation.y, far: Math.hypot(m.vehicle.x - at.x, m.vehicle.z - at.z) };
  })()`);
};
// The tail's pose, read seven times in about a second: how far it swings in that time, in radians.
const tailSwing = async (page) => {
  const seen = [];
  for (let i = 0; i < 7; i++) { seen.push(await page.read('window.mmm.porchDog.tail.rotation.y')); await sleep(170); }
  return Math.max(...seen) - Math.min(...seen);
};
// Puts the car on the road, at the point whose straight distance from the dog is nearest to `metres`. When the camera
// has arrived, it reports the distance that the house measures (the car or the camera, whichever is nearer) and what is drawn.
const stand = async (page, metres) => {
  await page.read(`(() => {
    const m = window.mmm, dog = m.camera.position.clone();
    m.porchDog.group.updateWorldMatrix(true, false); m.porchDog.group.getWorldPosition(dog);
    let best = null;
    for (const r of m.roads.roads) {
      if (r.name !== 'Beaton Road') continue;
      for (let i = 1; i < r.pts.length; i++) for (let t = 0; t < 1; t += 0.05) {
        const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const miss = Math.abs(Math.hypot(x - dog.x, z - dog.z) - ${metres});
        if (!best || miss < best.miss) best = { x, z, miss, heading: Math.atan2(bx - ax, -(bz - az)) };
      }
    }
    m.vehicle.place(best.x, best.z, best.heading);
  })()`);
  await page.send('Page.bringToFront');
  await sleep(4000);
  return page.read(`(() => {
    const m = window.mmm, o = m.porchSite.origin, far = (p) => Math.hypot(p.x - o.x, p.z - o.z);
    return { far: Math.min(far(m.camera.position), far(m.vehicle)), dog: m.porchDog.group.visible, house: m.porch.group.visible };
  })()`);
};
// A free camera at a place in house metres (u toward the road, v across: web/src/porch-site.ts), turned to the dog.
// The car waits behind the camera, so the dog looks at the lens. The map position is worked out in the page.
const picture = async (page, name, u, v, height, fov, more = '') => {
  const cam = await page.read(`(async () => {
    const m = window.mmm, dog = m.camera.position.clone(), p = m.porchSite.world(${u}, ${v});
    const village = (await (await fetch('terrain/manifest.json')).json()).village;
    m.porchDog.group.updateWorldMatrix(true, false); m.porchDog.group.getWorldPosition(dog);
    const heading = (Math.atan2(dog.x - p.x, -(dog.z - p.z)) * 180 / Math.PI + 360) % 360;
    const car = { x: p.x + (p.x - dog.x) * 0.8, z: p.z + (p.z - dog.z) * 0.8 };
    return { e: village[0] + p.x, n: village[1] - p.z, heading, carE: village[0] + car.x, carN: village[1] - car.z };
  })()`);
  const query = `cam=${cam.e.toFixed(2)},${cam.n.toFixed(2)},${height},${cam.heading.toFixed(1)},-2,${fov}&camground=1&at=${cam.carE.toFixed(2)},${cam.carN.toFixed(2)},0`;
  await page.navigate(`${base}/?${query}&hud=0&shadows=1${more}`);
  await page.send('Page.bringToFront'); await sleep(3000);
  await page.shot(`${outDir}/porch-dog-${name}.png`);
};

const said = [];
const page = await open(road(0.985));
try {
  // 1. Desktop.
  const desktop = await facts(page);
  assert.equal(desktop.state, 'here', 'desktop: the dog is on the porch');
  assert.equal(desktop.triangles, contract.snapshot.desktop.triangles, 'desktop: the model of the contract');
  assert.ok(desktop.house > 1000 && !desktop.waiting, 'desktop: the house is built');
  said.push(`desktop: dog ${desktop.triangles} triangles, house ${desktop.house}`);

  // 2. The head follows the car.
  for (const [right, ahead] of [[6, 14], [-6, 14]]) {
    const seen = await watch(page, right, ahead);
    assert.ok(Math.abs(seen.off) < 0.12, `car ${right} m to the right, ${ahead} m ahead: the head points at it (off by ${seen.off.toFixed(3)} rad)`);
    assert.ok(Math.sign(seen.turn) === -Math.sign(right) && Math.abs(seen.turn) > 0.25, `car ${right} m to the right: the head turns to that side (${seen.turn.toFixed(3)} rad)`);
    assert.ok(Math.abs(seen.neck / seen.turn - 0.5 / REACH) < 0.02, 'the neck takes its share of the turn');
    said.push(`car ${right > 0 ? 'right' : 'left'}: turn ${seen.turn.toFixed(2)} rad, off the car by ${seen.off.toFixed(3)} rad`);
  }
  const swing = await tailSwing(page);   // the car is still 15 m from the dog
  assert.ok(swing > 0.1, `car close: the tail sweeps (its pose changes by ${swing.toFixed(3)} rad in a second)`);
  said.push(`car close: the tail swings ${swing.toFixed(2)} rad`);
  const behind = await watch(page, 12, -3);
  assert.ok(Math.abs(Math.abs(behind.turn) - REACH) < 0.02 && behind.turn < 0, `car behind and to the right: the head stops at its limit (${behind.turn.toFixed(3)} rad)`);
  said.push(`car behind: turn ${behind.turn.toFixed(2)} rad (the limit is ${REACH})`);
  assert.deepEqual(page.errors, [], 'desktop: the page threw nothing');

  // The dog is drawn only when near.
  const near = await stand(page, SEEN - 50), away = await stand(page, SEEN + 70);
  assert.ok(near.far < SEEN - 20 && near.dog && near.house, `${near.far.toFixed(0)} m away (under ${SEEN - 20}): the dog and the house are drawn`);
  assert.ok(away.far > SEEN + 20 && away.far < 800 && !away.dog && away.house, `${away.far.toFixed(0)} m away (over ${SEEN + 20}): the house is drawn, and the dog is not`);
  said.push(`dog drawn at ${near.far.toFixed(0)} m, not drawn at ${away.far.toFixed(0)} m (the house is)`);
  assert.deepEqual(page.errors, [], 'near and far: the page threw nothing');

  await picture(page, 'close', 7.9, -3.4, 1.0, 34);
  await picture(page, 'road', 18.0, -7.5, 1.4, 40);

  // 3. A slow computer.
  await page.navigate(road(0.965, '&q=low'));
  const low = await facts(page);
  assert.equal(low.low, true, 'LOW is on');
  assert.equal(low.state, 'here', 'LOW: the dog is on the porch');
  assert.equal(low.triangles, contract.snapshot.low.triangles, 'LOW: the model of the contract');
  said.push(`LOW: dog ${low.triangles} triangles, house ${low.house}`);
  await picture(page, 'low-far', 27.4, -25.7, 1.5, 40, '&q=low');
  assert.deepEqual(page.errors, [], 'LOW: the page threw nothing');

  // 4. No model file.
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Network.setBlockedURLs', { urls: ['*porch-dog*.glb'] });
  await page.navigate(road(0.985, '&again=1'));
  const none = await facts(page);
  assert.equal(none.state, 'absent', 'no model file: there is no dog');
  assert.ok(none.house > 1000 && !none.waiting, 'no model file: the house is built all the same');
  assert.deepEqual(page.errors, [], 'no model file: the page threw nothing');
  await page.send('Page.bringToFront'); await sleep(1500);
  await page.shot(`${outDir}/porch-dog-absent.png`);
  said.push(`no model file: dog ${none.state}, house ${none.house} triangles, no page error`);
  console.log('PASS porch dog in the page\n  ' + said.join('\n  '));
} catch (error) {
  console.error('FAIL porch dog in the page: ' + error.message + (said.length ? '\n  ' + said.join('\n  ') : ''));
  process.exitCode = 1;
} finally { await page.close().catch(() => {}); }
exitCheck();
