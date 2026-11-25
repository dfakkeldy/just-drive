// A house on Blackstone Road, Mabou (web/src/blackstone-house.ts) in the real page, desktop and LOW:
//   1. it builds near the car within its triangle ceiling, and LOW draws fewer triangles than desktop;
//   2. the surveyed box it stands for is not drawn (with ?blackstone=0 the box is there, on desktop and LOW);
//   3. the house, east barn and west shed push the real vehicle out while the front driveway apron stays open;
//   4. Judique has no such house. The page throws nothing, and each view leaves a picture.
// The desktop view runs first: the LOW and box views read what it measured.
// RUN=blackstone-browser.mjs VIEWS="desktop|at=630789,5109876,112 low|q=low&at=630789,5109876,112 box|blackstone=0&at=630789,5109876,112 boxlow|q=low&blackstone=0&at=630789,5109876,112 judique|area=judique&x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const CEILING = { desktop: 14000, low: 5500 };
const [out, ...urls] = process.argv.slice(2);

const boxPoints = (frame) => `(() => {
  const m = window.mmm, b = m.buildings, f = ${JSON.stringify(frame)};
  const pos = b.mesh.geometry.attributes.position, p = m.camera.position.clone();
  b.mesh.updateWorldMatrix(true, false);
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(b.mesh.matrixWorld);
    const dx = p.x - f.x, dz = p.z - f.z, u = dx * f.u[0] + dz * f.u[1], v = dx * f.v[0] + dz * f.v[1];
    if (Math.abs(u) <= 12.42 / 2 + 0.5 && Math.abs(v) <= 8.7 / 2 + 0.5) n++;
  }
  return n;
})()`;
const frameOf = `(() => { const s = window.mmm.blackstone.site, o = s.origin, a = s.world(1, 0), b = s.world(0, 1);
  return { x: o.x, z: o.z, u: [a.x - o.x, a.z - o.z], v: [b.x - o.x, b.z - o.z] }; })()`;

for (const url of urls) {
  const page = await open(url);
  try {
    const params = new URL(url).searchParams, name = params.get('name');
    await page.send('Page.bringToFront');
    if (params.get('area') && params.get('area') !== 'mabou') {
      assert.equal(await page.read('window.mmm.blackstone'), null, 'non-Mabou area has no Blackstone Road house');
      console.log(`PASS ${name}: no Blackstone Road house outside Mabou`);
    } else if (params.get('blackstone') === '0') {
      assert.equal(await page.read('window.mmm.blackstone'), null, '?blackstone=0 builds no house');
      const n = await page.read(boxPoints(JSON.parse(readFileSync(`${out}/blackstone-desktop.json`, 'utf8')).frame));
      assert.ok(n > 0, `?blackstone=0: the surveyed box is drawn (${n} points)`);
      console.log(`PASS ${name}: the surveyed box is drawn with ?blackstone=0 (${n} points)`);
    } else {
      for (let i = 0; i < 180 && !await page.read('!!window.mmm.blackstone && window.mmm.blackstone.triangles > 0 && !window.mmm.blackstone.waiting'); i++) await sleep(500);
      assert.ok(await page.read('!!window.mmm.blackstone && window.mmm.blackstone.triangles > 0 && !window.mmm.blackstone.waiting'), `${name}: the house never built`);
      const state = await page.read(`(() => { const h = window.mmm.blackstone; return { house: h.triangles, low: window.mmm.low, shown: h.group.visible }; })()`);
      console.log(name, 'measured', JSON.stringify(state));
      const limit = params.get('q') === 'low' ? CEILING.low : CEILING.desktop;
      assert.ok(state.house > 1000 && state.shown, `${name}: the house is built and drawn`);
      assert.ok(state.house <= limit, `${name}: house triangles ${state.house} > ${limit}`);
      if (params.get('q') === 'low') {
        assert.ok(state.low, 'LOW is on');
        const desktop = JSON.parse(readFileSync(`${out}/blackstone-desktop.json`, 'utf8'));
        assert.ok(state.house < desktop.house, `LOW is simpler (${state.house} < ${desktop.house})`);
      }
      const frame = await page.read(frameOf);
      if (params.get('q') !== 'low') writeFileSync(`${out}/blackstone-desktop.json`, JSON.stringify({ ...state, frame }));
      assert.equal(await page.read(boxPoints(frame)), 0, `${name}: the surveyed box is not drawn under the house`);

      // Main house, east gambrel barn and west shed push the car out; front driveway apron admits it.
      const contact = await page.read(`(() => {
        const m = window.mmm, h = m.blackstone, v = m.vehicle, saved = { x: v.x, z: v.z, vx: v.vx, vz: v.vz, speed: v.speed };
        try {
          const w1 = h.site.world(-2, 0); Object.assign(v, { x: w1.x, z: w1.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const wallPush = Math.hypot(v.x - w1.x, v.z - w1.z);
          const wBarn = h.site.world(43.5, 4.0); Object.assign(v, { x: wBarn.x, z: wBarn.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const barnPush = Math.hypot(v.x - wBarn.x, v.z - wBarn.z);
          const wShed = h.site.world(-18.0, -8.5); Object.assign(v, { x: wShed.x, z: wShed.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const shedPush = Math.hypot(v.x - wShed.x, v.z - wShed.z);
          const wDrv = h.site.world(0, -13.5); Object.assign(v, { x: wDrv.x, z: wDrv.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const drvPush = Math.hypot(v.x - wDrv.x, v.z - wDrv.z);
          return { wallPush, barnPush, shedPush, drvPush };
        } finally { Object.assign(v, saved); }
      })()`);
      assert.ok(contact.wallPush > 2.5, `${name}: house pushes car out (${contact.wallPush.toFixed(2)} m)`);
      assert.ok(contact.barnPush > 2.0, `${name}: east barn pushes car out (${contact.barnPush.toFixed(2)} m)`);
      assert.ok(contact.shedPush > 0.8, `${name}: west shed pushes car out (${contact.shedPush.toFixed(2)} m)`);
      assert.equal(contact.drvPush, 0, `${name}: front driveway admits a car (${contact.drvPush})`);
      console.log(`PASS ${name}: house ${state.house} triangles; no surveyed box; wall ${contact.wallPush.toFixed(1)} m, barn ${contact.barnPush.toFixed(1)} m, shed ${contact.shedPush.toFixed(1)} m; driveway open`);
    }
    await page.shot(`${out}/${name}.png`);
    assert.deepEqual(page.errors, [], `${name}: the page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS blackstone-browser');
