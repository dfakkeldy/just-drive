// Rough stretches and puddles (web/src/rough-roads.ts, puddles.ts): the stretches resolve on the baked roads, the puddle
// rule is seeded and keeps clear of bridges, junctions and the church start, the road bit is painted only where it
// belongs, roads that are not rough drive exactly as before, and the real Vehicle at fixed speeds shakes on a rough
// stretch about as the survey car did (21 Nov 2026: 0.10-0.16 g at 11-19 km/h; ordinary gravel 0.08-0.12 g at 45-55 km/h).
// Run: node tools/run-node-check.mjs tools/rough-road-check.mjs   (the baked-road part SKIPs without data/baked)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Object3D } from '../web/node_modules/three/build/three.module.js';
import { ROUGH_STRETCHES, PUDDLE_POND, PUDDLE_RUT, PUDDLE_POOL, resolveStretch, roughRoads, setPuddleField, puddleDip, puddlesFor, roughSite } from '../web/src/rough-roads.ts';
import { ROUGH_POTHOLES, potholeDensity, potholeDepth } from '../web/src/defects.ts';
import { ROUGH_BIT, paintSiteSurface, placeBoxes } from '../web/src/terrain.ts';
import { Vehicle, PUDDLE_DRAG } from '../web/src/vehicle.ts';
import { BikeRide, BIKE_STEP } from '../web/src/bike-ride.ts';
import { PuddleField } from '../web/src/rough-roads.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { CHURCH_START } from '../web/src/church-site.ts';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. The pothole rule off a rough stretch is the old one, number for number.
for (const kind of [1, 2, 3, 4, 5]) for (const wash of [false, true]) for (const gravel of [false, true]) {
  const old = (kind === 1 ? 0.17 : kind === 2 ? 0.28 : kind === 3 || (kind === 4 && gravel) ? 0.42 : kind === 4 ? 0.36 : 0) + (wash ? 0.2 : 0);
  ok(potholeDensity(kind, wash, gravel) === old && potholeDensity(kind, wash, gravel, false) === old, `density ${kind}/${wash}/${gravel} unchanged`);
  ok(potholeDensity(kind, wash, gravel, true) === old + ROUGH_POTHOLES, `rough adds ${ROUGH_POTHOLES}`);
}
for (let i = 0; i < 4000; i++) { const x = 13.7 + i * 0.37, z = -200 + (i % 61) * 0.29; ok(potholeDepth(x, z, .42, 1) === potholeDepth(x, z, .42), 'deeper=1 is the old depth'); }

// 2. The rough bit: only on mapped gravel (3) and track (4) samples without a high bit, inside the road.
{
  const zero = 128, dScale = 0.1, wScale = 0.05;
  const sample = (flags, dist = 1, half = 2.6) => { const r = new Uint8ClampedArray(4); r[0] = zero + Math.round(dist / dScale); r[1] = Math.round(half / wScale); r[2] = flags; return r; };
  const paint = (r, dist = Math.abs(r[0] - zero) * dScale) => { paintSiteSurface(r, 0, { dist, half: 2.6, kind: 3, rough: true }, zero, dScale, wScale); return r[2]; };
  ok(paint(sample(3)) === (3 | ROUGH_BIT) && paint(sample(4)) === (4 | ROUGH_BIT), 'gravel and track samples turn rough');
  ok(paint(sample(3 | 32)) === (3 | 32 | ROUGH_BIT), 'washboard keeps its bit and turns rough');
  for (const f of [0, 1, 2, 2 | 64, 2 | 128, 4 | 64, 5, 8, 9, 10, 12]) ok(paint(sample(f)) === f, `flags ${f} stay`);
  ok(paint(sample(3, 4.5)) === (3 | ROUGH_BIT), 'a shoulder sample a coarse texel out turns rough, so the drawn shoulder is verge');
  ok(paint(sample(3, 5.4)) === 3, 'a sample beyond the shoulder reach stays');
  ok(paint(sample(3, 1), 3.5) === 3 && paint(sample(4, 0.5), 2) === 4, 'a sample nearer another road than this stretch stays');
  ok(paint(sample(3, 1), 1.8) === (3 | ROUGH_BIT), 'a small distance mismatch still turns rough');
  const r = sample(3); paint(r); ok(r[0] === zero + 10 && r[1] === 52, 'distance and width stay');
}

// 3. A straight test road: the stretch resolves across two pieces, the puddle rule is seeded and keeps clear.
const testRoads = [
  { id: 1, name: 'Test Road', kind: 3, halfWidth: 2.6, bridge: false, pts: [[0, 0], [400, 0], [1000, 0]] },
  { id: 2, name: 'Test Road', kind: 4, halfWidth: 1.5, bridge: false, pts: [[1000, 0], [1600, 0], [2000, 0]] },
  { id: 3, name: 'Side Lane', kind: 4, halfWidth: 1.5, bridge: false, pts: [[700, 0], [700, 300]] },
  { id: 4, name: 'Test Road', kind: 4, halfWidth: 1.5, bridge: true, pts: [[2000, 0], [2012, 0]] },
];
const testStretch = { area: 'test', road: 'Test Road', from: [0, 0], to: [2000, 0], level: 'severe' };
{
  const r = resolveStretch(testRoads, testStretch, [0, 0]);
  ok(r && Math.abs(r.length - 2000) < 1e-6 && r.pts.length === 5, `stretch crosses the joint once: ${r?.pts.length}`);
  ok(resolveStretch(testRoads, { ...testStretch, from: [2000, 0], to: [0, 0] }, [0, 0])?.length === r.length, 'either end may come first');
  ok(resolveStretch(testRoads, { ...testStretch, to: [2000, 5] }, [0, 0]) === null, 'a vertex that moved leaves the stretch out');
  const a = roughRoads(testRoads, 'test', [0, 0], [{ x: 1500, z: 0, r: 40 }], [testStretch]);
  const b = roughRoads(testRoads, 'test', [0, 0], [{ x: 1500, z: 0, r: 40 }], [testStretch]);
  ok(JSON.stringify(a.field.puddles) === JSON.stringify(b.field.puddles), 'the same stretch always holds the same water');
  const ps = a.field.puddles;
  ok(ps.every(p => Math.hypot(p.x - 1500, p.z) > 40), 'none on a keep-clear point');
  ok(ps.every(p => Math.abs(p.x - 700) > 1.5 + 6 || p.z > 10), 'none in a junction mouth');
  ok(ps.every(p => p.x < 2000 - 12), 'none at the stretch end or on the bridge');
  for (const kind of [PUDDLE_POOL, PUDDLE_RUT, PUDDLE_POND]) ok(ps.some(p => p.kind === kind), `a severe stretch holds kind ${kind}`);
  // Pools lie in the potholes the wheels fall into.
  for (const p of ps.filter(q => q.kind === PUDDLE_POOL)) ok(potholeDepth(p.x, p.z, potholeDensity(p.x < 1000 ? 3 : 4, false, false, true)) > 0, `a pool fills a pothole: ${JSON.stringify(p)}`);
  setPuddleField(a.field);
  const pond = ps.find(p => p.kind === PUDDLE_POND);
  ok(Math.abs(puddleDip(pond.x, pond.z) - pond.depth) < 1e-9 && puddleDip(pond.x, pond.z + pond.b + 3) === 0, 'a wheel sinks into the middle of a pond, and not beside it');
  // The site marks only the stretch.
  const site = roughSite(resolveStretch(testRoads, testStretch, [0, 0]));
  ok(site.roadPaint === true && placeBoxes([site]).length === 0 && placeBoxes([{ box: [0, 0, 1, 1] }]).length === 1, 'a rough site box is no placement clearing');
  ok(site.surface(500, 1)?.rough === true && site.surface(500, 30) === null, 'the site reaches the road, not the forest');
  ok(site.affectsTile(256, -128, 256, 8) && !site.affectsTile(256, 512, 256, 8), 'only tiles the stretch crosses are built with it');
  setPuddleField(null);
  ok(puddleDip(pond.x, pond.z) === 0, 'no field: no water');
}

// 4. The real Vehicle at fixed speeds: body shake (vertical acceleration at 10 Hz, less its 1.5 s mean), as the dash cam.
const node = () => new Object3D(), rig = () => ({ root: node(), body: node(), pose() {}, steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() } });
function shake(kmh, kind, { washboard = false, rough = false, water = false } = {}, seconds = 12) {
  const surface = (x, z) => {
    const s = { ground: 100, canopy: 0, kind, washboard, roadDist: Math.abs(z), halfWidth: kind === 4 ? 1.5 : 2.6, bridge: false, brook: 99, level: 8 };
    if (rough) s.rough = true;
    return s;
  };
  const terrain = { heightAt: () => 100, withContactHeight: (_, read) => read(), surfaceAt: surface, meshContactAt: (_x, _z, out) => { out.height = 100; out.source = 8; out.drawn = true; return true; } };
  const road = { id: 1, name: 'Test Road', kind, halfWidth: kind === 4 ? 1.5 : 2.6, bridge: false, pts: [[0, 0], [3000, 0]] };
  const roads = { roads: [road], nearest: (x, z) => ({ road, dist: Math.abs(z), x, z: 0, heading: Math.PI / 2, seg: 0, t: x / 3000 }), deckHeight: () => null };
  setPuddleField(water ? roughRoads(testRoads, 'test', [0, 0], [], [testStretch]).field : null);
  const v = new Vehicle(rig(), terrain, roads, 0, CAR_SPEC);
  v.assist = 0; v.place(20, 0.4, Math.PI / 2);
  const ms = kmh / 3.6, dt = 1 / 120, vys = [];
  let drag = 0;
  for (let i = 0; i < seconds * 120; i++) {
    v.vx = ms; v.vz = 0; v.speed = ms; v.heading = Math.PI / 2;
    const before = v.vx, beforeY = v.y; v.update(dt, { throttle: 0, steer: 0, handbrake: false });
    drag += before - v.vx; v.z = 0.4;
    vys.push((v.y - beforeY) / dt);
  }
  setPuddleField(null);
  // 10 Hz samples, as the survey dash camera records: vertical acceleration from the mean vertical speed over each tenth of a second.
  const tenth = []; for (let i = 0; i + 12 <= vys.length; i += 12) tenth.push(vys.slice(i, i + 12).reduce((a, b) => a + b) / 12);
  const acc = tenth.slice(1).map((y, i) => (y - tenth[i]) / 0.1);
  const k = 15, jolt = acc.map((a, i) => { const w = acc.slice(Math.max(0, i - 7), Math.min(acc.length, i + 8)); return a - w.reduce((p, q) => p + q) / w.length; });
  const rms = Math.sqrt(jolt.slice(k).reduce((p, q) => p + q * q, 0) / Math.max(1, jolt.length - k)) / 9.81;
  return { rms: +rms.toFixed(3), drag: +(drag / seconds).toFixed(3) };
}
const rows = {
  'plain gravel 50 km/h': shake(50, 3), 'plain gravel 15 km/h': shake(15, 3),
  'washboard (Mabou Mines) 15 km/h': shake(15, 3, { washboard: true }), 'washboard (Mabou Mines) 30 km/h': shake(30, 3, { washboard: true }),
  'rough gravel 15 km/h': shake(15, 3, { rough: true }), 'rough gravel 30 km/h': shake(30, 3, { rough: true }),
  'rough gravel + water 15 km/h': shake(15, 3, { rough: true, water: true }), 'rough gravel + water 30 km/h': shake(30, 3, { rough: true, water: true }),
  'plain track 15 km/h': shake(15, 4), 'rough track 15 km/h': shake(15, 4, { rough: true }),
};
console.error(JSON.stringify(rows, null, 1));
ok(rows['rough gravel 15 km/h'].rms > rows['plain gravel 15 km/h'].rms * 1.3, 'a rough stretch shakes more than plain gravel at the same speed');
ok(rows['rough gravel 15 km/h'].rms >= rows['plain gravel 50 km/h'].rms * 0.8, 'at 15 km/h it shakes about as hard as plain gravel at 50 km/h (the dash cam)');
ok(rows['rough gravel + water 30 km/h'].drag > rows['rough gravel 30 km/h'].drag, 'water holds the car back');

// 4b. The bike in water: the same drag per wheel as the car (linear in speed, two wheels), not a wall.
{
  const slow = (kmh, water) => {
    const terrain = { heightAt: () => 0, withContactHeight: (_b, read) => read(), surfaceAt: () => ({ ground: 0, canopy: 0, kind: 3, roadDist: 0, halfWidth: 3, bridge: false, washboard: false, brook: 99, level: 8 }) };
    const road = { id: 1, kind: 3, bridge: false, name: 'Test road', halfWidth: 3, pts: [[-10000, 0], [10000, 0]] };
    const roads = { deckHeight: () => null, nearest: (x, z, d, pred) => !pred || pred(road) ? { x, z: 0, heading: Math.PI / 2, dist: Math.abs(z), road, seg: 0, t: .5 } : null };
    const v = new BikeRide({ root: new THREE.Group(), pose() {}, driverEye: new THREE.Object3D() }, terrain, roads, -.2);
    setPuddleField(water ? new PuddleField([{ x: 0, z: 0, a: 60, b: 60, yaw: 0, depth: water, kind: PUDDLE_POND, seed: 1 }]) : null);
    v.place(0, 0, Math.PI / 2);
    for (let i = 0; i < 30; i++) { v.vx = v.speed = kmh / 3.6; v.vz = 0; v.update(BIKE_STEP, { throttle: 0, steer: 0, handbrake: false }); }
    const before = v.speed; v.update(BIKE_STEP, { throttle: 0, steer: 0, handbrake: false });
    setPuddleField(null);
    return (before - v.speed) / BIKE_STEP;
  };
  for (const kmh of [30, 50, 70]) {
    const extra = slow(kmh, 0.1) - slow(kmh, 0), rule = 2 * 0.1 * PUDDLE_DRAG * kmh / 3.6;
    ok(extra > rule * 0.6 && extra < rule * 1.4, `bike in 0.1 m of water at ${kmh} km/h slows ${extra.toFixed(2)} m/s2 more, about the car's rule for two wheels (${rule.toFixed(2)})`);
  }
}

// 5. The baked River Denys Road: every stretch resolves, and the water keeps clear of the church start.
const baked = process.env.MMM_ROOT ? `${process.env.MMM_ROOT}/data/baked/areas/judique/roads.json` : 'data/baked/areas/judique/roads.json';
if (!existsSync(baked)) console.log('SKIP baked River Denys Road: no data/baked (CI)');
else {
  const data = JSON.parse(readFileSync(baked, 'utf8')).roads, origin = [618000, 5081000];
  const want = { 4800: 2000, 6800: 1500, 11700: 650, 13150: 500, 14350: 1300 };
  ROUGH_STRETCHES.forEach((s, i) => {
    const r = resolveStretch(data, s, origin), expected = Object.values(want)[i];
    ok(r && Math.abs(r.length - expected) < 15, `stretch ${i} resolves on the baked road: ${r?.length.toFixed(0)} m, about ${expected}`);
  });
  const church = { x: CHURCH_START.e - origin[0], z: origin[1] - CHURCH_START.n, r: 40 };
  const all = roughRoads(data, 'judique', origin, [church]);
  ok(all.field.puddles.every(p => Math.hypot(p.x - church.x, p.z - church.z) > 40), 'no puddle on the church start');
  const per = all.stretches.map(r => { const ps = puddlesFor(r, { roads: [], points: [] }); return `${r.stretch.level} ${r.length.toFixed(0)} m: ${(ps.length / r.length * 100).toFixed(1)} per 100 m (ponds ${ps.filter(p => p.kind === PUDDLE_POND).length})`; });
  console.error(per.join('\n'));
  ok(all.field.puddles.length > 100 && all.field.puddles.length < 4000, `puddle count stays bounded: ${all.field.puddles.length}`);
}
console.log(`PASS rough-road: ${checks} checks`);
