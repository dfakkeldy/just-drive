// Port Hood service station and gas bar (web/src/porthood-gas.ts) in the real page, desktop and LOW:
//   1. it builds near the car within explicit station and full-feature (station + 28 instanced parked vehicles) triangle
//      ceilings, LOW draws fewer triangles than desktop, and all 28 parked vehicles share 3 instanced meshes;
//   2. the surveyed box (building 522) is not drawn (with ?porthoodgas=0 the box is there, on desktop and LOW);
//   3. the station, fuel pump island, east storage shed and parked cars push the real vehicle out through the live
//      registered driveVehicle / siteContacts contact path while the swept inner south fuel lane stays open;
//   4. Mabou has no such station. The page throws nothing, and each view leaves a picture.
// The desktop view runs first: the LOW and box views read what it measured.
// RUN=porthood-gas-browser.mjs VIEWS="desktop|area=porthood&at=614485,5096484,83 low|area=porthood&q=low&at=614485,5096484,83 box|area=porthood&porthoodgas=0&at=614485,5096484,83 boxlow|area=porthood&q=low&porthoodgas=0&at=614485,5096484,83 mabou|x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

// Separate explicit ceilings for station+signs alone and full feature (station + signs + all 28 instanced vehicles).
const STATION_CEILING = { desktop: 5000, low: 2500 };
const TOTAL_CEILING = { desktop: 12000, low: 9000 };
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
        let instMeshes = 0, instCount = 0, featureTris = 0, visibleMeshes = 0;
        st.group.traverse((o) => {
          if (o.isMesh && o.visible) {
            visibleMeshes++;
            const per = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
            if (o.isInstancedMesh) { instMeshes++; instCount += o.count; featureTris += per * o.count; }
            else featureTris += per;
          }
        });
        return {
          tris: st.triangles,
          featureTris,
          visibleMeshes,
          low: window.mmm.low,
          shown: st.group.visible,
          instMeshes,
          instCount,
          calls: window.mmm.renderer.info.render.calls,
          totalTris: window.mmm.renderer.info.render.triangles,
        };
      })()`);
      console.log(name, 'measured', JSON.stringify(state));
      const isLow = params.get('q') === 'low';
      const stationLimit = isLow ? STATION_CEILING.low : STATION_CEILING.desktop;
      const fullLimit = isLow ? TOTAL_CEILING.low : TOTAL_CEILING.desktop;
      assert.ok(state.tris > 1000 && state.shown, `${name}: station is built and drawn`);
      assert.ok(state.tris <= stationLimit, `${name}: station triangles ${state.tris} > ${stationLimit}`);
      assert.ok(state.featureTris <= fullLimit, `${name}: full feature triangles ${state.featureTris} > ${fullLimit}`);
      assert.equal(state.visibleMeshes, 5, `${name}: 5 visible feature meshes (station + signs + 3 instanced vehicle meshes)`);
      assert.equal(state.instMeshes, 3, `${name}: 3 instanced vehicle meshes`);
      assert.equal(state.instCount, 28, `${name}: 28 instanced parked vehicles`);
      if (isLow) {
        assert.ok(state.low, 'LOW is on');
        const desktop = JSON.parse(readFileSync(`${out}/porthood-gas-desktop.json`, 'utf8'));
        assert.ok(state.tris < desktop.tris, `LOW station is simpler (${state.tris} < ${desktop.tris})`);
        assert.ok(state.featureTris < desktop.featureTris, `LOW full feature is simpler (${state.featureTris} < ${desktop.featureTris})`);
      }
      const frame = await page.read(frameOf);
      if (!isLow) writeFileSync(`${out}/porthood-gas-desktop.json`, JSON.stringify({ ...state, frame }));
      assert.equal(await page.read(boxPoints(frame)), 0, `${name}: the surveyed box 522 is not drawn under the station`);

      // Exercise the real registered vehicle contact path (driveVehicle -> resolveYardSolids -> soloContacts -> portHoodGas):
      // main station, fuel pump island, east shed and parked vehicles push the real vehicle out; swept inner fuel lane admits it.
      const contact = await page.read(`(() => {
        const m = window.mmm, st = m.portHoodGas, v = m.vehicle;
        const saved = { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, speed: v.speed, heading: v.heading, airborne: v.airborne };
        const stopped = { throttle: 0, steer: 0, handbrake: true };
        try {
          const test = (u, vCoord, du = 1, dv = 0) => {
            const w = st.site.world(u, vCoord);
            const gy = m.terrain.meshHeightAt?.(w.x, w.z, true) ?? m.terrain.heightAt(w.x, w.z) ?? v.y;
            Object.assign(v, { x: w.x, y: gy, z: w.z, vx: 0, vy: 0, vz: 0, speed: 0, heading: st.site.heading(du, dv), airborne: false });
            m.driveVehicle(1 / 60, stopped);
            return Math.hypot(v.x - w.x, v.z - w.z);
          };
          let maxLanePush = 0;
          for (let u = -14; u <= 2; u += 1.5) {
            maxLanePush = Math.max(maxLanePush, test(u, -9.2, 1, 0));
          }
          return {
            wallPush: test(0, 0),
            pumpPush: test(-5, -13),
            shedPush: test(20, -13),
            parkedPush: test(-2.2, -16.1),
            lanePush: maxLanePush,
          };
        } finally { Object.assign(v, saved); }
      })()`);
      assert.ok(contact.wallPush > 2.5, `${name}: station pushes car out via driveVehicle (${contact.wallPush.toFixed(2)} m)`);
      assert.ok(contact.pumpPush > 0.6, `${name}: pump island pushes car out via driveVehicle (${contact.pumpPush.toFixed(2)} m)`);
      assert.ok(contact.shedPush > 1.5, `${name}: east shed pushes car out via driveVehicle (${contact.shedPush.toFixed(2)} m)`);
      assert.ok(contact.parkedPush > 0.5, `${name}: parked vehicle pushes car out via driveVehicle (${contact.parkedPush.toFixed(2)} m)`);
      assert.ok(contact.lanePush < 0.05, `${name}: swept inner fuel lane admits car via driveVehicle (max drift ${contact.lanePush.toFixed(3)} m)`);
      console.log(`PASS ${name}: station ${state.tris} / full ${state.featureTris} tris (${state.instCount} parked cars in ${state.instMeshes} instanced meshes); no surveyed box; live driveVehicle contact wall ${contact.wallPush.toFixed(1)} m, pump ${contact.pumpPush.toFixed(1)} m, shed ${contact.shedPush.toFixed(1)} m, parked ${contact.parkedPush.toFixed(1)} m; swept lane open (${contact.lanePush.toFixed(3)} m)`);
    }
    await page.shot(`${out}/${name}.png`);
    assert.deepEqual(page.errors, [], `${name}: the page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS porthood-gas-browser');
