// The house on D.R.'s Lane (web/src/drlane-house.ts) in the real page, in headless Chromium, desktop and LOW:
//   1. it builds near the car within its triangle ceiling, and LOW draws a simpler dog;
//   2. the surveyed box it stands for is not drawn (with ?drlane=0 the box is there, on desktop and LOW, which proves the measure);
//   3. the walls stop the real vehicle;
//   4. the white dog slips away from the car right beside it and is back once the car is well off;
//   5. Mabou has no such house. The page throws nothing, and each view leaves a picture.
// The desktop view runs first: the LOW and box views read what it measured.
// RUN=drlane-browser.mjs VIEWS="desktop|area=judique&at=617736.5,5081379.6,70 low|area=judique&q=low&at=617736.5,5081379.6,70 box|area=judique&drlane=0&at=617736.5,5081379.6,70 boxlow|area=judique&q=low&drlane=0&at=617736.5,5081379.6,70 mabou|x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

// Measured on the MacBook (21 Nov 2026): the house 7,438 triangles, the dog 2,440 on desktop. About 20 % headroom.
const CEILING = { house: 9000, dog: 3000 };
const [out, ...urls] = process.argv.slice(2);

// Corners of the surveyed box are on its outline, so the measure counts drawn building points within half a metre of it.
// `frame` is the house's origin and its u and v directions, read from the built house on the desktop view.
const boxPoints = (frame) => `(() => {
  const m = window.mmm, b = m.buildings, f = ${JSON.stringify(frame)};
  const pos = b.mesh.geometry.attributes.position, p = m.camera.position.clone();
  b.mesh.updateWorldMatrix(true, false);
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(b.mesh.matrixWorld);
    const dx = p.x - f.x, dz = p.z - f.z, u = dx * f.u[0] + dz * f.u[1], v = dx * f.v[0] + dz * f.v[1];
    if (Math.abs(u) <= 24.05 / 2 + 0.5 && Math.abs(v) <= 11.83 / 2 + 0.5) n++;
  }
  return n;
})()`;
const frameOf = `(() => { const s = window.mmm.drLane.site, o = s.origin, a = s.world(1, 0), b = s.world(0, 1);
  return { x: o.x, z: o.z, u: [a.x - o.x, a.z - o.z], v: [b.x - o.x, b.z - o.z] }; })()`;

for (const url of urls) {
  const page = await open(url);
  try {
    const params = new URL(url).searchParams, name = params.get('name');
    await page.send('Page.bringToFront');
    if (params.get('area') !== 'judique') {
      assert.equal(await page.read('window.mmm.drLane'), null, 'Mabou has no house from D.R.\'s Lane');
      console.log('PASS mabou: no house from D.R.\'s Lane');
    } else if (params.get('drlane') === '0') {
      assert.equal(await page.read('window.mmm.drLane'), null, '?drlane=0 builds no house');
      // The site is off, so the measure takes the house's frame from the desktop view.
      const n = await page.read(boxPoints(JSON.parse(readFileSync(`${out}/drlane-desktop.json`, 'utf8')).frame));
      assert.ok(n > 0, `?drlane=0: the surveyed box is drawn (${n} points)`);
      console.log(`PASS box: the surveyed box is drawn with ?drlane=0 (${n} points)`);
    } else {
      for (let i = 0; i < 180 && !await page.read('!!window.mmm.drLane && window.mmm.drLane.triangles > 0 && !window.mmm.drLane.waiting'); i++) await sleep(500);
      assert.ok(await page.read('!!window.mmm.drLane && window.mmm.drLane.triangles > 0 && !window.mmm.drLane.waiting'), `${name}: the house never built`);
      const state = await page.read(`(() => { const h = window.mmm.drLane; return { house: h.triangles, dog: h.dog.triangles, low: window.mmm.low, shown: h.group.visible }; })()`);
      console.log(name, 'measured', JSON.stringify(state));
      assert.ok(state.house > 3000 && state.shown, `${name}: the house is built and drawn`);
      assert.ok(state.house <= CEILING.house, `${name}: house triangles ${state.house} > ${CEILING.house}`);
      assert.ok(state.dog <= CEILING.dog, `${name}: dog triangles ${state.dog} > ${CEILING.dog}`);
      if (params.get('q') === 'low') {
        assert.ok(state.low, 'LOW is on');
        const desktop = JSON.parse(readFileSync(`${out}/drlane-desktop.json`, 'utf8'));
        assert.ok(state.dog < desktop.dog, `LOW: the dog is simpler (${state.dog} < ${desktop.dog})`);
      }
      const frame = await page.read(frameOf);
      if (params.get('q') !== 'low') writeFileSync(`${out}/drlane-desktop.json`, JSON.stringify({ ...state, frame }));
      assert.equal(await page.read(boxPoints(frame)), 0, `${name}: the surveyed box is not drawn under the house`);

      // The real vehicle inside the bungalow is pushed out through a wall.
      const pushed = await page.read(`(() => {
        const m = window.mmm, h = m.drLane, v = m.vehicle, saved = { x: v.x, z: v.z, vx: v.vx, vz: v.vz, speed: v.speed };
        try { const w = h.site.world(-4, 0); Object.assign(v, { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v); return Math.hypot(v.x - w.x, v.z - w.z); }
        finally { Object.assign(v, saved); }
      })()`);
      assert.ok(pushed > 3, `${name}: a car inside the house is pushed out (${pushed.toFixed(2)} m)`);

      // The dog: the car right beside it, then well off along the drive and the lane.
      const beside = await page.read(`(() => {
        const m = window.mmm, h = m.drLane, r = h.dog.rules, reach = m.vehicle.spec?.envelope.reach ?? 3.4;
        const w = h.site.world(r.u, r.v + reach + 1);
        m.vehicle.place(w.x, w.z, h.site.heading(0, -1));
        return { reach, at: [r.u, r.v] };
      })()`);
      let away = false;
      for (let i = 0; i < 100 && !away; i++) { await sleep(150); away = await page.read('window.mmm.drLane.dog.rules.away && !window.mmm.drLane.dog.group.visible'); }
      assert.ok(away, `${name}: the dog slips away from a car right beside it (${JSON.stringify(beside)})`);
      await page.read(`(() => { const m = window.mmm, h = m.drLane, w = h.site.world(-9.3, 60); m.vehicle.place(w.x, w.z, h.site.heading(0, 1)); })()`);
      let back = false;
      for (let i = 0; i < 100 && !back; i++) { await sleep(150); back = await page.read('!window.mmm.drLane.dog.rules.away && window.mmm.drLane.dog.group.visible'); }
      assert.ok(back, `${name}: the dog is back once the car is well off`);
      console.log(`PASS ${name}: house ${state.house} triangles, dog ${state.dog}; no surveyed box; walls push the car ${pushed.toFixed(1)} m; the dog slips away and comes back`);
    }
    await page.shot(`${out}/${name}.png`);
    assert.deepEqual(page.errors, [], `${name}: the page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS drlane-browser');
