// Port Hood service station and gas bar (web/src/porthood-gas.ts) in the real page, desktop and LOW:
//   1. it builds near the car within its triangle ceiling, LOW draws fewer triangles than desktop, and 25 instanced
//      parked vehicles are drawn across 3 instanced meshes;
//   2. the surveyed box (building 522) is not drawn (with ?porthoodgas=0 the box is there, on desktop and LOW);
//   3. the station, fuel pump island, east storage shed and parked cars push the real vehicle out while the open inner
//      east fuel lane admits it;
//   4. Mabou has no such station. The page throws nothing, and each view leaves a picture.
// The desktop view runs first: the LOW and box views read what it measured.
// RUN=porthood-gas-browser.mjs VIEWS="desktop|area=porthood&at=614485,5096484,83 low|area=porthood&q=low&at=614485,5096484,83 box|area=porthood&porthoodgas=0&at=614485,5096484,83 boxlow|area=porthood&q=low&porthoodgas=0&at=614485,5096484,83 mabou|x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const CEILING = { desktop: 12000, low: 5500 };
const [out, ...urls] = process.argv.slice(2);

const boxPoints = (frame) => `(() => {
  const m = window.mmm, b = m.buildings, f = ${JSON.stringify(frame)};
  const pos = b.mesh.geometry.attributes.position, p = m.camera.position.clone();
  b.mesh.updateWorldMatrix(true, false);
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(b.mesh.matrixWorld);
    const dx = p.x - f.x, dz = p.z - f.z, u = dx * f.u[0] + dz * f.u[1], v = dx * f.v[0] + dz * f.v[1];
    if (Math.abs(u) <= 19.23 / 2 + 0.5 && Math.abs(v) <= 12.54 / 2 + 0.5) n++;
  }
  return n;
})()`;
const frameOf = `(() => { const s = window.mmm.portHoodGas.site, o = s.origin, a = s.world(1, 0), b = s.world(0, 1);
  return { x: o.x, z: o.z, u: [a.x - o.x, a.z - o.z], v: [b.x - o.x, b.z - o.z] }; })()`;

for (const url of urls) {
  const page = await open(url);
  try {
    const params = new URL(url).searchParams, name = params.get('name');
    await page.send('Page.bringToFront');
    if ((params.get('area') ?? 'mabou') !== 'porthood') {
      assert.equal(await page.read('window.mmm.portHoodGas'), null, 'non-Port-Hood area has no Port Hood gas station');
      console.log(`PASS ${name}: no Port Hood gas station outside Port Hood`);
    } else if (params.get('porthoodgas') === '0') {
      assert.equal(await page.read('window.mmm.portHoodGas'), null, '?porthoodgas=0 builds no gas station');
      const n = await page.read(boxPoints(JSON.parse(readFileSync(`${out}/porthood-gas-desktop.json`, 'utf8')).frame));
      assert.ok(n > 0, `?porthoodgas=0: the surveyed box is drawn (${n} points)`);
      console.log(`PASS ${name}: the surveyed box is drawn with ?porthoodgas=0 (${n} points)`);
    } else {
      for (let i = 0; i < 180 && !await page.read('!!window.mmm.portHoodGas && window.mmm.portHoodGas.triangles > 0 && !window.mmm.portHoodGas.waiting'); i++) await sleep(500);
      assert.ok(await page.read('!!window.mmm.portHoodGas && window.mmm.portHoodGas.triangles > 0 && !window.mmm.portHoodGas.waiting'), `${name}: the station never built`);
      const state = await page.read(`(() => {
        const st = window.mmm.portHoodGas;
        let instMeshes = 0, instCount = 0;
        st.group.traverse((o) => { if (o.isInstancedMesh) { instMeshes++; instCount += o.count; } });
        return { tris: st.triangles, low: window.mmm.low, shown: st.group.visible, instMeshes, instCount, calls: window.mmm.renderer.info.render.calls, totalTris: window.mmm.renderer.info.render.triangles };
      })()`);
      console.log(name, 'measured', JSON.stringify(state));
      const limit = params.get('q') === 'low' ? CEILING.low : CEILING.desktop;
      assert.ok(state.tris > 1000 && state.shown, `${name}: station is built and drawn`);
      assert.ok(state.tris <= limit, `${name}: station triangles ${state.tris} > ${limit}`);
      assert.equal(state.instMeshes, 3, `${name}: 3 instanced vehicle meshes`);
      assert.equal(state.instCount, 28, `${name}: 28 instanced parked vehicles`);
      if (params.get('q') === 'low') {
        assert.ok(state.low, 'LOW is on');
        const desktop = JSON.parse(readFileSync(`${out}/porthood-gas-desktop.json`, 'utf8'));
        assert.ok(state.tris < desktop.tris, `LOW is simpler (${state.tris} < ${desktop.tris})`);
      }
      const frame = await page.read(frameOf);
      if (params.get('q') !== 'low') writeFileSync(`${out}/porthood-gas-desktop.json`, JSON.stringify({ ...state, frame }));
      assert.equal(await page.read(boxPoints(frame)), 0, `${name}: the surveyed box 522 is not drawn under the station`);

      // Main station, fuel pump island, east storage shed and parked cars push the car out; inner east fuel lane admits it.
      const contact = await page.read(`(() => {
        const m = window.mmm, st = m.portHoodGas, v = m.vehicle, saved = { x: v.x, z: v.z, vx: v.vx, vz: v.vz, speed: v.speed, heading: v.heading };
        try {
          const test = (u, vCoord, du = 1, dv = 0) => {
            const w = st.site.world(u, vCoord);
            Object.assign(v, { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, heading: st.site.heading(du, dv) });
            st.resolveSolids(v);
            return Math.hypot(v.x - w.x, v.z - w.z);
          };
          return {
            wallPush: test(0, 0),
            pumpPush: test(-5, -13),
            shedPush: test(20, -13),
            parkedPush: test(-2.5, -16.1),
            lanePush: test(-1.5, -9.5, 1, 0),
          };
        } finally { Object.assign(v, saved); }
      })()`);
      assert.ok(contact.wallPush > 2.5, `${name}: station pushes car out (${contact.wallPush.toFixed(2)} m)`);
      assert.ok(contact.pumpPush > 0.6, `${name}: pump island pushes car out (${contact.pumpPush.toFixed(2)} m)`);
      assert.ok(contact.shedPush > 1.5, `${name}: east shed pushes car out (${contact.shedPush.toFixed(2)} m)`);
      assert.ok(contact.parkedPush > 0.5, `${name}: parked vehicle pushes car out (${contact.parkedPush.toFixed(2)} m)`);
      assert.equal(contact.lanePush, 0, `${name}: open inner east fuel lane admits a car (${contact.lanePush})`);
      console.log(`PASS ${name}: station ${state.tris} tris + ${state.instCount} parked cars; no surveyed box; wall ${contact.wallPush.toFixed(1)} m, pump ${contact.pumpPush.toFixed(1)} m, shed ${contact.shedPush.toFixed(1)} m, parked ${contact.parkedPush.toFixed(1)} m; lane open`);
    }
    await page.shot(`${out}/${name}.png`);
    assert.deepEqual(page.errors, [], `${name}: the page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS porthood-gas-browser');
