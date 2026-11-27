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
      if (params.get('q') !== 'low') {
        // Real browser Shift.update -> Ruts -> Complaints -> ScoreStream check on L8 Blackstone:
        // nearby Blackstone Road (within 25 m of house 1454) and front gravel driveway (kind 8) stay track-free;
        // mown front lawn (kind 12) leaves tracks, files lawnDamage, and scores both lawnDamage and rut events.
        const rutsCheck = await page.read(`(() => {
          const m = window.mmm, h = m.blackstone, s = h.site, v = m.vehicle, shift = m.shift;
          const saved = { x: v.x, z: v.z, y: v.y, heading: v.heading, vx: v.vx, vz: v.vz, speed: v.speed, airborne: v.airborne };
          const stepAlong = (pts) => {
            shift.ruts.reset();
            const scoreBefore = shift.score.reported, callsBefore = shift.complaints.all.length;
            for (let i = 0; i < pts.length; i++) {
              const cur = pts[i], next = pts[Math.min(i + 1, pts.length - 1)], prev = pts[Math.max(i - 1, 0)];
              const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;
              Object.assign(v, { x: cur.x, z: cur.z, y: m.terrain.heightAt(cur.x, cur.z) ?? v.y, heading: Math.atan2(dx, -dz), vx: (dx / len) * 5, vz: (dz / len) * 5, speed: 5, airborne: false });
              shift.update(0.05, v);
            }
            const surf = m.terrain.surfaceAt(v.x, v.z, v.y);
            const delta = shift.score.reported - scoreBefore;
            const events = delta > 0 ? shift.score.recent.slice(-delta).map((e) => e.kind) : [];
            const calls = shift.complaints.all.slice(callsBefore).map((c) => c.kind);
            return {
              count: shift.ruts.count, lawns: shift.ruts.lawns,
              kind: surf?.kind ?? -1, roadDist: surf?.roadDist ?? 99, halfWidth: surf?.halfWidth ?? 0,
              distToHouse: Math.hypot(v.x - s.origin.x, v.z - s.origin.z),
              events, calls,
            };
          };
          try {
            const road = stepAlong(Array.from({ length: 16 }, (_, i) => s.world(-6 + i * 0.8, -21.8)));
            const drive = stepAlong(Array.from({ length: 15 }, (_, i) => s.world(-6 + i * 0.8, -13.0)));
            const lawn = stepAlong(Array.from({ length: 24 }, (_, i) => s.world(16 + i * 0.8, -11.5)));
            return { road, drive, lawn };
          } finally {
            shift.ruts.reset();
            Object.assign(v, saved);
          }
        })()`);
        assert.equal(rutsCheck.road.kind, 3, `${name}: nearby Blackstone Road is kind 3 gravel road`);
        assert.ok(rutsCheck.road.distToHouse < 28, `${name}: road control is inside 35 m house reach (${rutsCheck.road.distToHouse.toFixed(1)} m)`);
        assert.equal(rutsCheck.road.count, 0, `${name}: Blackstone Road leaves no ruts`);
        assert.equal(rutsCheck.road.lawns, 0, `${name}: Blackstone Road counts no lawn damage`);
        assert.deepEqual(rutsCheck.road.events, [], `${name}: Blackstone Road scores no lawn events`);
        assert.equal(rutsCheck.drive.kind, 8, `${name}: front driveway is kind 8 gravel`);
        assert.equal(rutsCheck.drive.count, 0, `${name}: front driveway leaves no ruts`);
        assert.deepEqual(rutsCheck.drive.events, [], `${name}: front driveway scores no lawn events`);
        assert.equal(rutsCheck.lawn.kind, 12, `${name}: east front lawn is kind 12 mown grass`);
        assert.ok(rutsCheck.lawn.count >= 20 && rutsCheck.lawn.lawns === 1, `${name}: mown lawn leaves ruts (${JSON.stringify(rutsCheck.lawn)})`);
        assert.ok(rutsCheck.lawn.calls.includes('lawnDamage'), `${name}: mown lawn files lawnDamage complaint`);
        assert.ok(rutsCheck.lawn.events.includes('lawnDamage') && rutsCheck.lawn.events.includes('rut'),
          `${name}: mown lawn emits lawnDamage and rut score events (${rutsCheck.lawn.events.join(',')})`);
      }
      console.log(`PASS ${name}: house ${state.house} triangles; no surveyed box; wall ${contact.wallPush.toFixed(1)} m, barn ${contact.barnPush.toFixed(1)} m, shed ${contact.shedPush.toFixed(1)} m; driveway open`);
    }
    await page.shot(`${out}/${name}.png`);
    if (name === 'desktop') {
      // Loaded Mabou paved-atlas lot within 28 m of house 138 (and >20 m off any road): must stay track-free through Shift.update.
      await page.read(`(() => {
        const m = window.mmm, [ve, vn] = m.terrain.manifest.village;
        const x = 624121 - ve, z = vn - 5103339;
        m.vehicle.place(x, z, Math.PI / 2);
        m.terrain.paved?.update(x, z);
      })()`);
      for (let i = 0; i < 120 && !await page.read(`(() => {
        const m = window.mmm, v = m.vehicle, s = m.terrain.surfaceAt(v.x, v.z, v.y);
        return m.terrain.pending === 0 && (m.terrain.paved?.pending ?? 0) === 0 && !!s && s.level >= 6 && (m.terrain.paved?.lotClassAt(v.x, v.z) ?? 0) === 1;
      })()`); i++) await sleep(250);
      const lotCheck = await page.read(`(() => {
        const m = window.mmm, v = m.vehicle, shift = m.shift, [ve, vn] = m.terrain.manifest.village;
        const x0 = 624121 - ve, z0 = vn - 5103339;
        shift.ruts.reset();
        const scoreBefore = shift.score.reported, callsBefore = shift.complaints.all.length;
        for (let i = 0; i < 16; i++) {
          const x = x0 + i * 0.75, z = z0;
          Object.assign(v, { x, z, y: m.terrain.heightAt(x, z) ?? v.y, heading: Math.PI / 2, vx: 5, vz: 0, speed: 5, airborne: false });
          shift.update(0.05, v);
        }
        const s = m.terrain.surfaceAt(v.x, v.z, v.y);
        const delta = shift.score.reported - scoreBefore;
        return {
          lotClass: m.terrain.paved?.lotClassAt(v.x, v.z) ?? 0,
          level: s?.level ?? -1, canopy: s?.canopy ?? 99, roadDist: s?.roadDist ?? 0, halfWidth: s?.halfWidth ?? 0,
          count: shift.ruts.count, lawns: shift.ruts.lawns,
          calls: shift.complaints.all.slice(callsBefore).map((c) => c.kind),
          events: delta > 0 ? shift.score.recent.slice(-delta).map((e) => e.kind) : [],
        };
      })()`);
      assert.equal(lotCheck.lotClass, 1, `desktop: Mabou paved lot loaded class 1 (${JSON.stringify(lotCheck)})`);
      assert.ok(lotCheck.level >= 6 && lotCheck.canopy < 1.6 && lotCheck.roadDist > lotCheck.halfWidth + 0.6,
        `desktop: paved lot spot is off-road open ground (${JSON.stringify(lotCheck)})`);
      assert.equal(lotCheck.count, 0, 'desktop: Mabou paved atlas lot leaves no ruts');
      assert.equal(lotCheck.lawns, 0, 'desktop: Mabou paved atlas lot counts no lawn damage');
      assert.deepEqual(lotCheck.calls, [], 'desktop: Mabou paved atlas lot files no complaint');
      assert.deepEqual(lotCheck.events, [], 'desktop: Mabou paved atlas lot scores no event');
      console.log(`PASS desktop paved-lot control: class=${lotCheck.lotClass}, roadDist=${lotCheck.roadDist.toFixed(1)} m, 0 strips, 0 events`);
    }
    assert.deepEqual(page.errors, [], `${name}: the page threw nothing`);
  } finally { await page.close(); }
}
console.log('PASS blackstone-browser');
