// A house on Prince Street, Port Hawkesbury (web/src/prince-house.ts) in the real page, desktop and LOW:
//   1. it builds near the car within its triangle ceiling, and LOW draws fewer triangles than desktop;
//   2. the surveyed box it stands for is not drawn (with ?prince=0 the box is there, on desktop and LOW);
//   3. the walls push the real vehicle out while the open carport bay admits it;
//   4. Mabou has no such house. The page throws nothing, and each view leaves a picture.
// The desktop view runs first: the LOW and box views read what it measured.
// RUN=prince-browser.mjs VIEWS="desktop|area=pointtupper&at=627652,5053009,142 low|area=pointtupper&q=low&at=627652,5053009,142 box|area=pointtupper&prince=0&at=627652,5053009,142 boxlow|area=pointtupper&q=low&prince=0&at=627652,5053009,142 mabou|x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const CEILING = { desktop: 12000, low: 5000 };
const [out, ...urls] = process.argv.slice(2);

const boxPoints = (frame) => `(() => {
  const m = window.mmm, b = m.buildings, f = ${JSON.stringify(frame)};
  const pos = b.mesh.geometry.attributes.position, p = m.camera.position.clone();
  b.mesh.updateWorldMatrix(true, false);
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(b.mesh.matrixWorld);
    const dx = p.x - f.x, dz = p.z - f.z, u = dx * f.u[0] + dz * f.u[1], v = dx * f.v[0] + dz * f.v[1];
    if (Math.abs(u) <= 17.01 / 2 + 0.5 && Math.abs(v) <= 11.09 / 2 + 0.5) n++;
  }
  return n;
})()`;
const frameOf = `(() => { const s = window.mmm.prince.site, o = s.origin, a = s.world(1, 0), b = s.world(0, 1);
  return { x: o.x, z: o.z, u: [a.x - o.x, a.z - o.z], v: [b.x - o.x, b.z - o.z] }; })()`;

for (const url of urls) {
  const page = await open(url);
  try {
    const params = new URL(url).searchParams, name = params.get('name');
    await page.send('Page.bringToFront');
    if (params.get('area') !== 'pointtupper') {
      assert.equal(await page.read('window.mmm.prince'), null, 'Mabou has no Prince Street house');
      console.log('PASS mabou: no Prince Street house');
    } else if (params.get('prince') === '0') {
      assert.equal(await page.read('window.mmm.prince'), null, '?prince=0 builds no house');
      const n = await page.read(boxPoints(JSON.parse(readFileSync(`${out}/prince-desktop.json`, 'utf8')).frame));
      assert.ok(n > 0, `?prince=0: the surveyed box is drawn (${n} points)`);
      console.log(`PASS ${name}: the surveyed box is drawn with ?prince=0 (${n} points)`);
    } else {
      for (let i = 0; i < 180 && !await page.read('!!window.mmm.prince && window.mmm.prince.triangles > 0 && !window.mmm.prince.waiting'); i++) await sleep(500);
      assert.ok(await page.read('!!window.mmm.prince && window.mmm.prince.triangles > 0 && !window.mmm.prince.waiting'), `${name}: the house never built`);
      const state = await page.read(`(() => { const h = window.mmm.prince; return { house: h.triangles, low: window.mmm.low, shown: h.group.visible }; })()`);
      console.log(name, 'measured', JSON.stringify(state));
      const limit = params.get('q') === 'low' ? CEILING.low : CEILING.desktop;
      assert.ok(state.house > 1000 && state.shown, `${name}: the house is built and drawn`);
      assert.ok(state.house <= limit, `${name}: house triangles ${state.house} > ${limit}`);
      if (params.get('q') === 'low') {
        assert.ok(state.low, 'LOW is on');
        const desktop = JSON.parse(readFileSync(`${out}/prince-desktop.json`, 'utf8'));
        assert.ok(state.house < desktop.house, `LOW is simpler (${state.house} < ${desktop.house})`);
      }
      const frame = await page.read(frameOf);
      if (params.get('q') !== 'low') writeFileSync(`${out}/prince-desktop.json`, JSON.stringify({ ...state, frame }));
      assert.equal(await page.read(boxPoints(frame)), 0, `${name}: the surveyed box is not drawn under the house`);

      // Main house and middle SE carport post push the car out; open carport parking bay leaves it undisturbed.
      const contact = await page.read(`(() => {
        const m = window.mmm, h = m.prince, v = m.vehicle, saved = { x: v.x, z: v.z, vx: v.vx, vz: v.vz, speed: v.speed };
        try {
          const w1 = h.site.world(-3, 0); Object.assign(v, { x: w1.x, z: w1.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const wallPush = Math.hypot(v.x - w1.x, v.z - w1.z);
          const wPost = h.site.world(8.12, -1.0); Object.assign(v, { x: wPost.x, z: wPost.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const postPush = Math.hypot(v.x - wPost.x, v.z - wPost.z);
          const w2 = h.site.world(4.2, -1.5); Object.assign(v, { x: w2.x, z: w2.z, vx: 0, vz: 0, speed: 0 }); h.resolveSolids(v);
          const bayPush = Math.hypot(v.x - w2.x, v.z - w2.z);
          return { wallPush, postPush, bayPush };
        } finally { Object.assign(v, saved); }
      })()`);
      assert.ok(contact.wallPush > 2.5, `${name}: a car inside the house is pushed out (${contact.wallPush.toFixed(2)} m)`);
      assert.ok(contact.postPush > 0.2, `${name}: middle SE carport post pushes car out (${contact.postPush.toFixed(2)} m)`);
      assert.equal(contact.bayPush, 0, `${name}: carport bay admits a car (${contact.bayPush})`);
      console.log(`PASS ${name}: house ${state.house} triangles; no surveyed box; walls push ${contact.wallPush.toFixed(1)} m; mid post pushes ${contact.postPush.toFixed(2)} m; carport bay open`);
    }
    await page.shot(`${out}/${name}.png`);
    assert.deepEqual(page.errors, [], `${name}: the page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS prince-browser');
