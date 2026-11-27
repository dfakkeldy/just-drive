// Brook Village general store and St. John the Baptist Church (web/src/brook-village.ts) in the real page, desktop and LOW:
//   1. builds near the car within explicit landmark and total triangle ceilings, LOW simpler than desktop,
//      4 parked cars in 3 instanced meshes;
//   2. surveyed boxes 69 (store) and 1570 (church) are not drawn (with ?brookvillage=0 both boxes draw);
//   3. store, container, church nave, portico, ramp and parked cars push the real vehicle out via driveVehicle,
//      while the store gravel entrance and church turnaround lane stay open;
//   4. Judique has no Brook Village site. The page throws nothing, and each view leaves a picture.
// RUN=brook-village-browser.mjs VIEWS="desktop|at=631580,5101162,102 low|q=low&at=631580,5101162,102 box|brookvillage=0&at=631580,5101162,102 boxlow|q=low&brookvillage=0&at=631580,5101162,102 judique|area=judique&x=1" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { open, sleep } from './cdp.mjs';

const LANDMARK_CEILING = { desktop: 12000, low: 5000 };
const TOTAL_CEILING = { desktop: 14000, low: 7000 };
const [out, ...urls] = process.argv.slice(2);

const boxPoints = (frames) => `(() => {
  const m = window.mmm, b = m.buildings, fs = ${JSON.stringify(frames)};
  const pos = b.mesh.geometry.attributes.position, p = m.camera.position.clone();
  b.mesh.updateWorldMatrix(true, false);
  let storeN = 0, churchN = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(b.mesh.matrixWorld);
    {
      const f = fs.store, dx = p.x - f.x, dz = p.z - f.z;
      const u = dx * f.u[0] + dz * f.u[1], v = dx * f.v[0] + dz * f.v[1];
      if (Math.abs(u) <= 18.45 / 2 + 0.5 && Math.abs(v) <= 10.69 / 2 + 0.5) storeN++;
    }
    {
      const f = fs.church, dx = p.x - f.x, dz = p.z - f.z;
      const u = dx * f.u[0] + dz * f.u[1], v = dx * f.v[0] + dz * f.v[1];
      if (Math.abs(u) <= 22.0 / 2 + 0.5 && Math.abs(v) <= 7.0 / 2 + 0.5) churchN++;
    }
  }
  return { storeN, churchN };
})()`;

const framesOf = `(() => {
  const mk = (f) => {
    const o = f.origin, a = f.world(1, 0), b = f.world(0, 1);
    return { x: o.x, z: o.z, u: [a.x - o.x, a.z - o.z], v: [b.x - o.x, b.z - o.z] };
  };
  const s = window.mmm.brookVillage.site;
  return { store: mk(s.store), church: mk(s.church) };
})()`;

for (const url of urls) {
  const page = await open(url);
  try {
    const params = new URL(url).searchParams, name = params.get('name');
    await page.send('Page.bringToFront');
    if ((params.get('area') ?? 'mabou') !== 'mabou') {
      assert.equal(await page.read('window.mmm.brookVillage'), null, 'non-Mabou area has no Brook Village site');
      console.log(`PASS ${name}: no Brook Village site outside Mabou`);
    } else if (params.get('brookvillage') === '0') {
      assert.equal(await page.read('window.mmm.brookVillage'), null, '?brookvillage=0 builds no Brook Village site');
      const frames = JSON.parse(readFileSync(`${out}/brook-village-desktop.json`, 'utf8')).frames;
      const n = await page.read(boxPoints(frames));
      assert.ok(n.storeN > 0 && n.churchN > 0, `?brookvillage=0: both surveyed boxes draw (store=${n.storeN}, church=${n.churchN})`);
      console.log(`PASS ${name}: both surveyed boxes drawn with ?brookvillage=0 (store=${n.storeN}, church=${n.churchN})`);
    } else {
      for (let i = 0; i < 180 && !await page.read('!!window.mmm.brookVillage && window.mmm.brookVillage.triangles > 0 && !window.mmm.brookVillage.waiting'); i++) await sleep(500);
      assert.ok(await page.read('!!window.mmm.brookVillage && window.mmm.brookVillage.triangles > 0 && !window.mmm.brookVillage.waiting'), `${name}: Brook Village never built`);
      const state = await page.read(`(() => {
        const bv = window.mmm.brookVillage;
        let instMeshes = 0, instCount = 0, featureTris = 0, visibleMeshes = 0;
        bv.group.traverse((o) => {
          if (o.isMesh && o.visible) {
            visibleMeshes++;
            const per = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
            if (o.isInstancedMesh) { instMeshes++; instCount += o.count; featureTris += per * o.count; }
            else featureTris += per;
          }
        });
        return {
          tris: bv.triangles,
          featureTris,
          visibleMeshes,
          low: window.mmm.low,
          shown: bv.group.visible,
          instMeshes,
          instCount,
          calls: window.mmm.renderer.info.render.calls,
          totalTris: window.mmm.renderer.info.render.triangles,
        };
      })()`);
      console.log(name, 'measured', JSON.stringify(state));
      const isLow = params.get('q') === 'low';
      assert.ok(state.tris > 1000 && state.shown, `${name}: Brook Village built and visible`);
      assert.ok(state.tris <= (isLow ? LANDMARK_CEILING.low : LANDMARK_CEILING.desktop), `${name}: landmark tris within ceiling`);
      assert.ok(state.featureTris <= (isLow ? TOTAL_CEILING.low : TOTAL_CEILING.desktop), `${name}: full tris within ceiling`);
      assert.equal(state.visibleMeshes, 7, `${name}: 7 visible meshes`);
      assert.equal(state.instMeshes, 3, `${name}: 3 instanced vehicle meshes`);
      assert.equal(state.instCount, 4, `${name}: 4 instanced parked cars`);
      if (isLow) {
        assert.ok(state.low, 'LOW is on');
        const desk = JSON.parse(readFileSync(`${out}/brook-village-desktop.json`, 'utf8'));
        assert.ok(state.tris < desk.tris, `LOW landmarks simpler (${state.tris} < ${desk.tris})`);
      }
      const frames = await page.read(framesOf);
      if (!isLow) writeFileSync(`${out}/brook-village-desktop.json`, JSON.stringify({ ...state, frames }));
      const n = await page.read(boxPoints(frames));
      assert.equal(n.storeN, 0, `${name}: surveyed store box 69 not drawn`);
      assert.equal(n.churchN, 0, `${name}: surveyed church box 1570 not drawn`);

      const contact = await page.read(`(() => {
        const m = window.mmm, bv = m.brookVillage, v = m.vehicle;
        const saved = { x: v.x, y: v.y, z: v.z, vx: v.vx, vy: v.vy, vz: v.vz, speed: v.speed, heading: v.heading, airborne: v.airborne };
        const stopped = { throttle: 0, steer: 0, handbrake: true };
        try {
          const test = (frame, u, vCoord, du = 1, dv = 0) => {
            const w = frame.world(u, vCoord);
            const gy = m.terrain.meshHeightAt?.(w.x, w.z, true) ?? m.terrain.heightAt(w.x, w.z) ?? v.y;
            Object.assign(v, { x: w.x, y: gy, z: w.z, vx: 0, vy: 0, vz: 0, speed: 0, heading: frame.heading(du, dv), airborne: false });
            m.driveVehicle(1 / 60, stopped);
            return Math.hypot(v.x - w.x, v.z - w.z);
          };
          return {
            storePush: test(bv.site.store, 3, 0),
            containerPush: test(bv.site.store, 4, 14.9),
            churchPush: test(bv.site.church, 1, 5.5),
            porticoPush: test(bv.site.church, 14, 5.5),
            rampPush: test(bv.site.church, 14.0, -3.0),
            parkedPushes: [
              test(bv.site.store, -5.2, 7.6),
              test(bv.site.store, 6.4, 7.7),
              test(bv.site.store, 5.5, -6.4),
              test(bv.site.church, 16.5, 18.8),
            ],
            storeLane: test(bv.site.store, 5.0, 11.2, -1, 0),
            churchTurn: test(bv.site.church, 20.5, 5.5, 0, 1),
          };
        } finally { Object.assign(v, saved); }
      })()`);
      assert.ok(contact.storePush > 2.5, `${name}: store pushes car out (${contact.storePush.toFixed(2)} m)`);
      assert.ok(contact.containerPush > 0.8, `${name}: container pushes car out (${contact.containerPush.toFixed(2)} m)`);
      assert.ok(contact.churchPush > 4.0, `${name}: church pushes car out (${contact.churchPush.toFixed(2)} m)`);
      assert.ok(contact.porticoPush > 1.0, `${name}: church portico pushes car out (${contact.porticoPush.toFixed(2)} m)`);
      assert.ok(contact.rampPush > 0.4, `${name}: church ramp pushes car out (${contact.rampPush.toFixed(2)} m)`);
      for (let i = 0; i < contact.parkedPushes.length; i++) {
        assert.ok(contact.parkedPushes[i] > 0.5, `${name}: parked car ${i} pushes car out (${contact.parkedPushes[i].toFixed(2)} m)`);
      }
      assert.ok(contact.storeLane < 0.05, `${name}: store lot lane admits car (${contact.storeLane.toFixed(3)} m)`);
      assert.ok(contact.churchTurn < 0.05, `${name}: church turnaround admits car (${contact.churchTurn.toFixed(3)} m)`);
      console.log(`PASS ${name}: ${state.tris} landmark / ${state.featureTris} total tris; no surveyed boxes; live contacts verified`);
    }
    await page.shot(`${out}/${name}.png`);
    assert.deepEqual(page.errors, [], `${name}: page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS brook-village-browser');
