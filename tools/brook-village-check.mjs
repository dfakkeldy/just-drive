// Node check for the Brook Village general store and St. John the Baptist Church (web/src/brook-village-site.ts, web/src/brook-village.ts):
//   1. BrookVillageSite.find matches buildings 69 and 1570 in Mabou, refuses >=0.5 m shift, resize or >=0.5 deg turn
//      on either building, and every accepted boundary shift/turn still leaves Highway 252, Lake Ainslie Chapel Road
//      and Track 202 solids and L8 fields untouched;
//   2. pads, store gravel lot, church gravel turnaround, mown church lawn, tree-clear strips, service-drop aims and
//      maxTexel road-field tiles agree with baked Mabou land and leave all three public roads bit-for-bit untouched across L5-L8;
//   3. BrookVillage builds finite geometry on desktop and LOW (LOW simpler, explicit building + full triangle caps),
//      uses zero-allocation readiness, keeps all 4 parked vehicles non-overlapping and off the roads, stops a car at
//      every structure and parked vehicle, and sweeps the store gravel lot entrance and church gravel turnaround cleanly
//      for car, pickup truck and SXS;
//   4. grounding uses drawn triangles (not heightAt) for both landmarks and parked vehicles across 7 -> 8 -> 7 at 2.5x
//      and 3x exaggeration, zero downhill corner gaps exist at 3x, old geometries dispose on ground change and stay
//      retained across visibility toggles, and drone roof boxes + live roofAt cover every built vertex.
// node tools/run-node-check.mjs tools/brook-village-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { clearBoxes } from '../web/src/buildings.ts';
import { roofHeights } from '../web/src/drone.ts';
import { PARKED_SIZE } from '../web/src/parked.ts';
import { Streams } from '../web/src/streams.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { Terrain } from '../web/src/terrain.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import {
  BrookVillage, CHURCH_FLAGPOLE, CHURCH_NAVE, CHURCH_PORTICO, CHURCH_RAMP,
  CHURCH_SIGNBOARD, CHURCH_STEPS, CHURCH_TOWER, CHURCH_WINGS,
  STORE_CONTAINER, STORE_CURB, STORE_MAIN, STORE_REAR,
} from '../web/src/brook-village.ts';
import {
  BROOK_CHURCH_BUILDING, BROOK_PARKED_SPOTS, BROOK_STORE_BUILDING,
  BrookVillageSite, CHURCH_CENTER_V,
} from '../web/src/brook-village-site.ts';

const AREA = 'data/baked/terrain/';
const manifest = JSON.parse(readFileSync(`${AREA}manifest.json`, 'utf8'));
const buildings = JSON.parse(readFileSync(`${AREA}buildings.json`, 'utf8')).buildings;
const roads = JSON.parse(readFileSync(`${AREA}roads.json`, 'utf8')).roads;
const props = JSON.parse(readFileSync(`${AREA}props.json`, 'utf8'));
const streamsData = JSON.parse(readFileSync(`${AREA}${manifest.streams.file}`, 'utf8'));
const streams = new Streams(streamsData, manifest.village);

// 1. Site lookup against the baked Mabou catalog (tight <0.5 m / <0.5 deg guard on both buildings).
const found = BrookVillageSite.find(buildings);
assert.ok(found && found.store.id === BROOK_STORE_BUILDING && found.church.id === BROOK_CHURCH_BUILDING,
  'BrookVillageSite.find finds store 69 and church 1570 in Mabou');
assert.equal(BrookVillageSite.find([{ ...found.store, length: found.store.length + 0.6 }, found.church]), null, 'resized store ignored');
assert.equal(BrookVillageSite.find([{ ...found.store, axisDeg: found.store.axisDeg + 0.6 }, found.church]), null, 'turned store ignored');
assert.equal(BrookVillageSite.find([{ ...found.store, x: found.store.x + 0.6 }, found.church]), null, 'shifted store ignored');
assert.equal(BrookVillageSite.find([found.store, { ...found.church, length: found.church.length + 0.6 }]), null, 'resized church ignored');
assert.equal(BrookVillageSite.find([found.store, { ...found.church, axisDeg: found.church.axisDeg + 0.6 }]), null, 'turned church ignored');
assert.equal(BrookVillageSite.find([found.store, { ...found.church, y: found.church.y + 0.6 }]), null, 'shifted church ignored');
assert.equal(BrookVillageSite.find([found.store]), null, 'missing church ignored');
assert.equal(BrookVillageSite.find([found.church]), null, 'missing store ignored');

const site = new BrookVillageSite(found, manifest.village);
assert.ok(site.clear.length >= 10, `tree-clear strips generated (${site.clear.length})`);

// Service drops re-aim cleanly onto the exposed pole-facing store front gable and church NE wall.
const aimedProps = site.adjustProps(props);
const storeDrop = aimedProps.serviceDrops.find((d) => d.building === BROOK_STORE_BUILDING);
const churchDrop = aimedProps.serviceDrops.find((d) => d.building === BROOK_CHURCH_BUILDING);
assert.ok(storeDrop && Math.abs(storeDrop.height - 4.75) < 0.01, 'store service drop re-aimed');
assert.ok(churchDrop && Math.abs(churchDrop.height - 4.55) < 0.01, 'church service drop re-aimed');

// Every tile painted within maxTexel must already have a baked road field so no coarse tile allocates a new texture.
const roadLevels = Object.keys(manifest.roads.levels).map(Number);
const coarsestRoadTexel = manifest.size / 2 ** Math.min(...roadLevels) / 256;
assert.ok(site.maxTexel <= 2 && site.maxTexel <= coarsestRoadTexel, `site paints only L8 (${site.maxTexel} <= ${coarsestRoadTexel})`);
for (const level of Object.keys(manifest.levels).map(Number)) {
  const size = manifest.size / 2 ** level;
  if (size / 256 > site.maxTexel) continue;
  const fields = new Set(manifest.roads.levels[level] ?? []);
  for (const x of [site.box[0], site.box[2]]) for (const z of [site.box[1], site.box[3]]) {
    const i = Math.floor((x + manifest.village[0] - manifest.origin[0]) / size);
    const j = Math.floor((manifest.origin[1] - (manifest.village[1] - z)) / size);
    assert.ok(fields.has(`${i}_${j}`), `site tile ${level}/${i}_${j} has a baked road field`);
  }
}

// 2. Pads, store gravel lot, church gravel turnaround and mown west church lawn.
const storePadW = site.store.world(0, 0);
assert.equal(site.height(storePadW.x, storePadW.z, 40.0), site.store.level, 'store pad is level at store.ground');
const churchPadW = site.church.world(1, CHURCH_CENTER_V);
assert.equal(site.height(churchPadW.x, churchPadW.z, 38.0), site.church.level, 'church pad is level at church.ground');
const storeLotW = site.store.world(2, 10);
assert.equal(site.surface(storeLotW.x, storeLotW.z, undefined, 8)?.kind, 8, 'store west lot paints as gravel');
assert.equal(site.surface(storeLotW.x, storeLotW.z, undefined, 7), null, 'L7 store surface stays untouched');
const churchApronW = site.church.world(19, CHURCH_CENTER_V);
assert.equal(site.surface(churchApronW.x, churchApronW.z, undefined, 8)?.kind, 8, 'church turnaround paints as gravel');
const churchLawnW = site.church.world(0, -25);
assert.equal(site.surface(churchLawnW.x, churchLawnW.z, undefined, 8)?.kind, 12, 'church west lawn paints as mown grass');
assert.equal(site.surface(churchLawnW.x, churchLawnW.z, undefined, 7), null, 'L7 church surface stays untouched');

// Verify no parked vehicles overlap each other or any fixed structure box.
assert.equal(BROOK_PARKED_SPOTS.length, 4, 'Brook Village has 4 generic parked vehicles');
const spotRect = (sp) => {
  const [L, W] = PARKED_SIZE[sp.type];
  const n = Math.hypot(sp.du, sp.dv);
  const fx = sp.du / n, fz = sp.dv / n;
  const du = Math.abs(fx) * (L / 2) + Math.abs(fz) * (W / 2);
  const dv = Math.abs(fz) * (L / 2) + Math.abs(fx) * (W / 2);
  return { u0: sp.u - du, u1: sp.u + du, v0: sp.v - dv, v1: sp.v + dv };
};
for (let i = 0; i < BROOK_PARKED_SPOTS.length; i++) {
  const a = spotRect(BROOK_PARKED_SPOTS[i]);
  for (let j = i + 1; j < BROOK_PARKED_SPOTS.length; j++) {
    if (BROOK_PARKED_SPOTS[i].place !== BROOK_PARKED_SPOTS[j].place) continue;
    const b = spotRect(BROOK_PARKED_SPOTS[j]);
    const overlap = a.u0 < b.u1 - 0.1 && a.u1 > b.u0 + 0.1 && a.v0 < b.v1 - 0.1 && a.v1 > b.v0 + 0.1;
    assert.equal(overlap, false, `parked spots ${i} and ${j} do not overlap`);
  }
  const boxes = BROOK_PARKED_SPOTS[i].place === 'store'
    ? [
      ['storeMain', STORE_MAIN.u0, STORE_MAIN.u1 + 0.7, STORE_MAIN.v0, STORE_MAIN.v1],
      ['storeRear', STORE_REAR.u0, STORE_REAR.u1, STORE_REAR.v0, STORE_REAR.v1],
      ['container', STORE_CONTAINER.u0, STORE_CONTAINER.u1, STORE_CONTAINER.v0 - 0.4, STORE_CONTAINER.v1],
    ]
    : [
      ['churchNave', CHURCH_NAVE.u0, CHURCH_NAVE.u1, CHURCH_NAVE.v0, CHURCH_NAVE.v1],
      ['churchWings', CHURCH_WINGS.u0, CHURCH_WINGS.u1, CHURCH_WINGS.v0, CHURCH_WINGS.v1],
      ['churchPortico', CHURCH_PORTICO.u0, CHURCH_STEPS.u1, CHURCH_PORTICO.v0, CHURCH_PORTICO.v1],
      ['churchRamp', CHURCH_RAMP.u0, CHURCH_RAMP.u1, CHURCH_RAMP.v0, CHURCH_RAMP.v1],
    ];
  for (const [name, u0, u1, v0, v1] of boxes) {
    const overlap = a.u0 < u1 + 0.1 && a.u1 > u0 - 0.1 && a.v0 < v1 + 0.1 && a.v1 > v0 - 0.1;
    assert.equal(overlap, false, `parked spot ${i} stays clear of ${name}`);
  }
}

// 3. Build BrookVillage on desktop and LOW against a flat stand-in terrain; verify zero surfaceAt calls in ready().
let surfaceAtCalls = 0;
const flatTerrain = {
  heightAt: () => site.store.level,
  meshHeightAt: () => site.store.level,
  levelAt: () => 8,
  surfaceAt: () => { surfaceAtCalls++; return { level: 8 }; },
};
const build = (low) => {
  const bv = new BrookVillage(site, flatTerrain, (m) => m, low);
  bv.update(new THREE.Vector3(site.origin.x, site.store.level, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
  assert.ok(!bv.waiting && bv.group.visible && bv.triangles > 0, `built (low=${low})`);
  assert.equal(bv.parkedCount, 4, `4 instanced parked vehicles (low=${low})`);
  return bv;
};
const desktop = build(false), low = build(true);
assert.equal(surfaceAtCalls, 0, 'readiness check never allocates via surfaceAt');
assert.ok(desktop.triangles >= 2000 && desktop.triangles <= 12000, `desktop landmark triangles ${desktop.triangles} in range`);
assert.ok(low.triangles >= 1000 && low.triangles <= 5000, `LOW landmark triangles ${low.triangles} in range`);
assert.ok(low.triangles < desktop.triangles * 0.75, `LOW (${low.triangles}) is simpler than desktop (${desktop.triangles})`);
assert.ok(desktop.parkedTriangles > 0 && desktop.totalTriangles <= 14000, `desktop total triangles ${desktop.totalTriangles} <= 14000`);
assert.ok(low.totalTriangles <= 7000 && low.totalTriangles < desktop.totalTriangles, `LOW total triangles ${low.totalTriangles} <= 7000`);

for (const bv of [desktop, low]) {
  let instancedCount = 0, instancedMeshes = 0, visibleMeshes = 0, fullTris = 0;
  bv.group.traverse((o) => {
    if (o.isMesh) {
      visibleMeshes++;
      const pos = o.geometry.getAttribute('position').array;
      for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), 'finite geometry');
      const perMesh = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.getAttribute('position').count / 3;
      if (o.isInstancedMesh) { instancedMeshes++; instancedCount += o.count; fullTris += perMesh * o.count; }
      else fullTris += perMesh;
    }
  });
  assert.equal(visibleMeshes, 7, 'feature draws 7 meshes (store + store signs + church + church signs + 3 instanced vehicle meshes)');
  assert.equal(instancedMeshes, 3, 'parked cars share 3 instanced meshes (car, SUV, pickup)');
  assert.equal(instancedCount, 4, 'all 4 parked cars instanced');
  assert.equal(fullTris, bv.totalTriangles, 'totalTriangles matches traversed meshes');
}

// Solids check: structures and parked cars stop a car; continuous drive-in & turnaround routes stay open.
const pushAt = (frame, u, v, heading = 0, spec = CAR_SPEC) => {
  const w = frame.world(u, v), car = { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, heading, spec };
  desktop.resolveSolids(car);
  return Math.hypot(car.x - w.x, car.z - w.z);
};
assert.ok(pushAt(site.store, 3, 0) > 2.5, 'store main block pushes car out');
assert.ok(pushAt(site.store, -6, 0) > 2.0, 'store rear extension pushes car out');
assert.ok(pushAt(site.store, 4, 14.9) > 0.8, 'store shipping container pushes car out');
for (let i = 0; i < BROOK_PARKED_SPOTS.length; i++) {
  const sp = BROOK_PARKED_SPOTS[i];
  const frame = sp.place === 'store' ? site.store : site.church;
  assert.ok(pushAt(frame, sp.u, sp.v, frame.heading(sp.du, sp.dv)) > 0.5,
    `parked vehicle ${i} (${sp.place} at ${sp.u}, ${sp.v}) pushes car out`);
}
assert.ok(pushAt(site.church, 1, CHURCH_CENTER_V) > 4.0, 'church nave pushes car out');
assert.ok(pushAt(site.church, -5, CHURCH_CENTER_V - 7.5) > 1.0, 'church west wing pushes car out');
assert.ok(pushAt(site.church, 14, CHURCH_CENTER_V) > 1.0, 'church front portico pushes car out');
assert.ok(pushAt(site.church, 14, CHURCH_CENTER_V - 6.0) > 0.4, 'church ramp pushes car out');
assert.ok(pushAt(site.church, CHURCH_FLAGPOLE.u, CHURCH_FLAGPOLE.v) > 0.1, 'church flagpole pushes car out');
assert.ok(pushAt(site.church, CHURCH_SIGNBOARD.u, CHURCH_SIGNBOARD.v) > 0.2, 'church signboard pushes car out');

// Continuous swept routes: store west parking drive-in and church gravel turnaround loop.
const driveRoutes = [
  ['Store west lot drive-in', site.store, [[18.0, 11.4], [11.5, 11.2], [5.0, 11.2], [0.5, 11.0]]],
  ['Church front gravel turnaround', site.church, [[28.5, -12.0], [20.5, -6.0], [20.5, 5.5], [20.5, 14.0], [28.5, 22.0]]],
];
for (const [routeName, frame, pts] of driveRoutes) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [u0, v0] = pts[i], [u1, v1] = pts[i + 1];
    const segLen = Math.hypot(u1 - u0, v1 - v0);
    const steps = Math.max(1, Math.ceil(segLen / 0.5));
    const hdg = frame.heading(u1 - u0, v1 - v0);
    for (let k = 0; k <= steps; k++) {
      const f = k / steps, u = u0 + (u1 - u0) * f, v = v0 + (v1 - v0) * f;
      for (const [vName, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['sxs', SXS_SPEC]]) {
        assert.equal(pushAt(frame, u, v, hdg, spec), 0,
          `${routeName} blocked for ${vName} at (${u.toFixed(1)}, ${v.toFixed(1)})`);
      }
    }
  }
}

// Collect sampled carriageway points (centreline + both edges, every 1 m) for Highway 252, Lake Ainslie Chapel Rd and Track 202.
const roadSamples = [];
for (const road of roads) {
  if (![30, 32, 34, 40, 202].includes(road.id)) continue;
  const roadName = road.name || `road-${road.id}`;
  for (let k = 0; k < road.pts.length - 1; k++) {
    const [e0, n0] = road.pts[k], [e1, n1] = road.pts[k + 1];
    const x0 = e0 - manifest.village[0], z0 = manifest.village[1] - n0;
    const x1 = e1 - manifest.village[0], z1 = manifest.village[1] - n1;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-4) continue;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    if (mx < site.box[0] - 20 || mx > site.box[2] + 20 || mz < site.box[1] - 20 || mz > site.box[3] + 20) continue;
    const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
    const nx = -tz, nz = tx, heading = Math.atan2(tx, -tz);
    const steps = Math.max(1, Math.ceil(len));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps, cx = x0 + (x1 - x0) * f, cz = z0 + (z1 - z0) * f;
      for (const side of [-road.halfWidth, 0, road.halfWidth]) {
        roadSamples.push({ roadName, x: cx + nx * side, z: cz + nz * side, heading, side });
      }
    }
  }
}
assert.ok(roadSamples.length > 250, `sampled ${roadSamples.length} carriageway centre/edge points`);

// Every Highway 252, Lake Ainslie Chapel Rd and Track 202 carriageway point stays clear of all solids.
for (const pt of roadSamples) {
  for (const hdg of [pt.heading, pt.heading + Math.PI]) {
    for (const [label, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['sxs', SXS_SPEC]]) {
      const car = { x: pt.x, z: pt.z, vx: 0, vz: 0, speed: 0, heading: hdg, spec };
      desktop.resolveSolids(car);
      assert.equal(Math.hypot(car.x - pt.x, car.z - pt.z), 0,
        `${label} hits solid on ${pt.roadName} (side=${pt.side.toFixed(1)} m) at (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)})`);
    }
  }
}

// Accepted survey boundary shift + turn combinations leave all three public roads clear of solids.
for (const [label, sDelta, cDelta] of [
  ['store +0.49m SE + 0.49deg', { x: found.store.x + 0.34, y: found.store.y - 0.34, axisDeg: found.store.axisDeg + 0.49 }, {}],
  ['store -0.49m SW - 0.49deg', { x: found.store.x - 0.34, y: found.store.y - 0.34, axisDeg: found.store.axisDeg - 0.49 }, {}],
  ['church +0.49m N + 0.49deg', {}, { y: found.church.y + 0.49, axisDeg: found.church.axisDeg + 0.49 }],
  ['church +0.49m N - 0.49deg', {}, { y: found.church.y + 0.49, axisDeg: found.church.axisDeg - 0.49 }],
]) {
  const shifted = BrookVillageSite.find([{ ...found.store, ...sDelta }, { ...found.church, ...cDelta }]);
  assert.ok(shifted, `boundary case ${label} accepted`);
  const shiftedSite = new BrookVillageSite(shifted, manifest.village);
  const shiftedBv = new BrookVillage(shiftedSite, flatTerrain, (m) => m, false);
  for (const pt of roadSamples) {
    for (const hdg of [pt.heading, pt.heading + Math.PI]) {
      for (const [vName, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['sxs', SXS_SPEC]]) {
        const car = { x: pt.x, z: pt.z, vx: 0, vz: 0, speed: 0, heading: hdg, spec };
        shiftedBv.resolveSolids(car);
        assert.equal(Math.hypot(car.x - pt.x, car.z - pt.z), 0,
          `boundary ${label}: ${vName} hits solid on ${pt.roadName}`);
      }
    }
  }
}

// 4. Production Terrain L5-L8 bit-for-bit road parity along Highway 252, Lake Ainslie Chapel Rd and Track 202.
function decodePng(buf) {
  let off = 8, w = 0, h = 0, colorType = 2; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, out = new Uint8Array(w * h * bpp);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0, c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      out[row + x] = (v + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  return { w, h, bpp, data: out };
}
function loadLevel(level, exag, applySite = true) {
  const tileSize = manifest.size / 2 ** level, seg = 128, step = tileSize / seg, mpp = tileSize / 256;
  const { scale, offset } = manifest.height;
  const active = applySite && mpp <= site.maxTexel;
  const cache = new Map();
  const tileFor = (x, z) => {
    const ti = Math.floor((x + manifest.village[0] - manifest.origin[0]) / tileSize);
    const tj = Math.floor((manifest.origin[1] - (manifest.village[1] - z)) / tileSize);
    const key = `${ti}_${tj}`;
    if (!cache.has(key)) {
      const { w, data: rgb } = decodePng(readFileSync(`${AREA}${level}/${ti}_${tj}.png`));
      const x0 = manifest.origin[0] + ti * tileSize - manifest.village[0];
      const z0 = manifest.village[1] - (manifest.origin[1] - tj * tileSize);
      cache.set(key, { w, T: w - 1, rgb, x0, z0, ti, tj });
    }
    return cache.get(key);
  };
  const pix = (t, px, py) => { const k = (py * t.w + px) * 3; return offset + (t.rgb[k] * 256 + t.rgb[k + 1]) * scale; };
  const sampleH = (x, z, raw) => active && x >= site.box[0] && x <= site.box[2] && z >= site.box[1] && z <= site.box[3] ? site.height(x, z, raw) : raw;
  const heightAt = (x, z) => {
    const t = tileFor(x, z);
    const fa = ((x - t.x0) / tileSize) * t.T, fb = ((z - t.z0) / tileSize) * t.T;
    const a = Math.max(0, Math.min(Math.floor(fa), t.T - 1)), b = Math.max(0, Math.min(Math.floor(fb), t.T - 1));
    const u = fa - a, v = fb - b;
    const rawH = (pix(t, a, b) * (1 - u) + pix(t, a + 1, b) * u) * (1 - v) + (pix(t, a, b + 1) * (1 - u) + pix(t, a + 1, b + 1) * u) * v;
    return sampleH(x, z, rawH) * exag;
  };
  const gridY = (t, a, b) => {
    const gx = t.x0 + a * step, gz = t.z0 + b * step;
    const px = Math.min(t.T, Math.round((a / seg) * t.T)), py = Math.min(t.T, Math.round((b / seg) * t.T));
    return sampleH(gx, gz, pix(t, px, py)) * exag;
  };
  const meshY = (x, z) => {
    const t = tileFor(x, z);
    const fa = (x - t.x0) / step, fb = (z - t.z0) / step;
    const a = Math.max(0, Math.min(Math.floor(fa), seg - 1)), b = Math.max(0, Math.min(Math.floor(fb), seg - 1));
    const fu = fa - a, fv = fb - b;
    const h00 = gridY(t, a, b), h10 = gridY(t, a + 1, b), h01 = gridY(t, a, b + 1), h11 = gridY(t, a + 1, b + 1);
    return fu + fv <= 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
  };
  return { heightAt, meshY, exag };
}

THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.fetch = async (path) => new Response(readFileSync(String(path)));
globalThis.createImageBitmap = async (blob) => {
  const p = decodePng(Buffer.from(await blob.arrayBuffer()));
  const pixels = new Uint8ClampedArray(p.w * p.h * 4);
  for (let i = 0; i < p.w * p.h; i++) {
    pixels[i * 4] = p.data[i * p.bpp];
    pixels[i * 4 + 1] = p.data[i * p.bpp + 1];
    pixels[i * 4 + 2] = p.data[i * p.bpp + 2];
    pixels[i * 4 + 3] = p.bpp === 4 ? p.data[i * p.bpp + 3] : 255;
  }
  return { pixels, width: p.w, height: p.h, close() {} };
};
globalThis.OffscreenCanvas = class {
  getContext() {
    let bmp;
    return { clearRect() {}, drawImage(b) { bmp = b; }, getImageData() { return { data: bmp.pixels }; } };
  }
};
const shared = {
  sunDir: { value: new THREE.Vector3(0.5, 0.7, 0.5) },
  sunCol: { value: new THREE.Color(1, 1, 1) },
  skyCol: { value: new THREE.Color(0.5, 0.7, 1) },
  fogCol: { value: new THREE.Color(0.7, 0.8, 0.9) },
  fogNear: { value: 200 }, fogFar: { value: 12000 }, time: { value: 0 },
};
const surveyedClear = [
  ...clearBoxes(found.store, manifest.village, 2.5),
  ...clearBoxes(found.church, manifest.village, 2.5),
];
const mainSrc = readFileSync('web/src/main.ts', 'utf8');
assert.ok(mainSrc.includes('clear.push(...clearBoxes(brookVillageBoxes.store, manifest.village, 2.5))')
  && mainSrc.includes('clear.push(...clearBoxes(brookVillageBoxes.church, manifest.village, 2.5))'),
  'main.ts preserves store 69 and church 1570 clearBoxes in regular terrain.clear for L5-L7 parity');

// Sample Stream 397 (mapped brook beside the store) across its channel and banks inside the site box.
const brookSamples = [];
for (const s of streamsData.streams) {
  if (![397, 398].includes(s.id)) continue;
  for (let k = 0; k < s.pts.length - 1; k++) {
    const [e0, n0] = s.pts[k], [e1, n1] = s.pts[k + 1];
    const x0 = e0 - manifest.village[0], z0 = manifest.village[1] - n0;
    const x1 = e1 - manifest.village[0], z1 = manifest.village[1] - n1;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-4) continue;
    const tx = (x1 - x0) / len, tz = (z1 - z0) / len, nx = -tz, nz = tx;
    const steps = Math.max(1, Math.ceil(len));
    for (let i = 0; i <= steps; i++) {
      const f = i / steps, cx = x0 + (x1 - x0) * f, cz = z0 + (z1 - z0) * f;
      if (cx < site.box[0] - 4 || cx > site.box[2] + 4 || cz < site.box[1] - 4 || cz > site.box[3] + 4) continue;
      for (const side of [-1.0, -0.5, 0, 0.5, 1.0]) {
        brookSamples.push({ id: s.id, x: cx + nx * side, z: cz + nz * side, side });
      }
    }
  }
}
assert.ok(brookSamples.length >= 100, `sampled ${brookSamples.length} brook channel/bank points`);

for (const level of [5, 6, 7, 8]) {
  const baseTerrain = new Terrain(manifest, AREA.slice(0, -1), shared, 2.5, 0, [...surveyedClear], { streams });
  const siteTerrain = new Terrain(manifest, AREA.slice(0, -1), shared, 2.5, 0, [...surveyedClear], { streams });
  siteTerrain.sites.push(site);
  for (const box of site.clear) siteTerrain.addTreeClear(box);
  const tileSize = manifest.size / 2 ** level;
  const needed = new Set();
  for (const pt of [...roadSamples, ...brookSamples]) {
    const ti = Math.floor((pt.x + manifest.village[0] - manifest.origin[0]) / tileSize);
    const tj = Math.floor((manifest.origin[1] - (manifest.village[1] - pt.z)) / tileSize);
    needed.add(`${ti}_${tj}`);
  }
  for (const key of needed) {
    const [ti, tj] = key.split('_').map(Number);
    await baseTerrain.loadNow(level, ti, tj);
    await siteTerrain.loadNow(level, ti, tj);
  }
  for (const pt of roadSamples) {
    assert.equal(siteTerrain.meshHeightAt(pt.x, pt.z), baseTerrain.meshHeightAt(pt.x, pt.z),
      `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production meshHeightAt bit-for-bit unchanged`);
    const sb = baseTerrain.surfaceAt(pt.x, pt.z), ss = siteTerrain.surfaceAt(pt.x, pt.z);
    assert.ok(sb && ss, `L${level} surfaceAt present`);
    assert.equal(ss.kind, sb.kind, `L${level} ${pt.roadName} surfaceAt.kind unchanged`);
    assert.equal(ss.halfWidth, sb.halfWidth, `L${level} ${pt.roadName} surfaceAt.halfWidth unchanged`);
    assert.equal(ss.roadDist, sb.roadDist, `L${level} ${pt.roadName} surfaceAt.roadDist bit-for-bit unchanged`);
    assert.equal(ss.canopy, sb.canopy, `L${level} ${pt.roadName} protected road canopy unchanged`);
  }
  if (level === 8) {
    // Streams-enabled brook bed height and surface parity across Stream 397 (and nearby Stream 398).
    for (const pt of brookSamples) {
      assert.equal(siteTerrain.meshHeightAt(pt.x, pt.z), baseTerrain.meshHeightAt(pt.x, pt.z),
        `L8 brook ${pt.id} (side=${pt.side.toFixed(1)} m) bed meshHeightAt bit-for-bit unchanged`);
      const sb = baseTerrain.surfaceAt(pt.x, pt.z), ss = siteTerrain.surfaceAt(pt.x, pt.z);
      assert.ok(sb && ss, 'L8 brook surfaceAt present');
      assert.equal(ss.kind, sb.kind, `L8 brook ${pt.id} surfaceAt.kind unchanged`);
      assert.equal(ss.roadDist, sb.roadDist, `L8 brook ${pt.id} surfaceAt.roadDist unchanged`);
    }
    // Canopy clearing proof: site clears real surveyed canopy inside cleared grounds without touching road edges.
    let clearedNonZero = 0, testedOpen = 0;
    for (let x = Math.ceil(site.box[0]); x <= Math.floor(site.box[2]); x += 1) {
      for (let z = Math.ceil(site.box[1]); z <= Math.floor(site.box[3]); z += 1) {
        if (!site.clearCanopy(x, z, 8)) continue;
        testedOpen++;
        const sb = baseTerrain.surfaceAt(x, z), ss = siteTerrain.surfaceAt(x, z);
        assert.ok(sb && ss, 'L8 open ground surfaceAt present');
        assert.equal(ss.canopy, 0, `L8 cleared ground (${x}, ${z}) canopy cleared to 0`);
        if (sb.canopy > 0.5) clearedNonZero++;
      }
    }
    assert.ok(testedOpen >= 200 && clearedNonZero >= 20,
      `L8 canopy clearing removed ${clearedNonZero} real canopy samples across ${testedOpen} cleared cells`);
  }
}

function meshYBoundsIn(group, u0, u1, v0, v1) {
  let minY = Infinity, maxY = -Infinity;
  for (const child of group.children) {
    const pos = child.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
      if (u >= u0 - 0.3 && u <= u1 + 0.3 && v >= v0 - 0.3 && v <= v1 + 0.3) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minY, maxY };
}

for (const exag of [2.5, 3]) {
  const L8 = loadLevel(8, exag);
  for (const isLow of [false, true]) {
    let drawn = 7, cached = 7, pending = 0, meshBias = 0;
    const realTerrain = {
      heightAt: (x, z) => L8.heightAt(x, z) + 0.75,
      meshHeightAt: (x, z, drawnOnly) => (drawnOnly && drawn === 8 ? L8.meshY(x, z) + meshBias : L8.heightAt(x, z) + 0.75),
      drawnLevelAt: () => drawn,
      levelAt: () => cached,
      get pending() { return pending; },
    };
    const bv = new BrookVillage(site, realTerrain, (m) => m * exag, isLow);
    const preW = site.church.world(1, CHURCH_CENTER_V), preCar = { x: preW.x, z: preW.z, vx: 0, vz: 0, speed: 0, heading: 0 };
    bv.resolveSolids(preCar);
    assert.ok(Math.hypot(preCar.x - preW.x, preCar.z - preW.z) > 4.0, `exag=${exag} low=${isLow}: solids active before L8 build`);

    bv.update(new THREE.Vector3(site.origin.x, site.store.level * exag, site.origin.z + 800), 0, { x: site.origin.x, z: site.origin.z + 800 });
    assert.equal(bv.group.visible, false, `L7 exag=${exag} low=${isLow}: hidden until L8 is drawn`);
    assert.equal(bv.waiting, false, `L7 exag=${exag} low=${isLow}: waiting=false when pending=0`);
    pending = 1;
    assert.equal(bv.waiting, true, `exag=${exag} low=${isLow}: waiting=true while terrain.pending > 0`);
    pending = 0;
    drawn = 8; cached = 8;
    bv.update(new THREE.Vector3(site.origin.x, site.store.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(bv.group.visible, true, `L8 exag=${exag} low=${isLow}: visible once L8 is drawn`);
    assert.equal(bv.waiting, false, `L8 exag=${exag} low=${isLow}: waiting=false once built`);

    const storeGroup = bv.group.children[0], churchGroup = bv.group.children[1], parkedGroup = bv.group.children[2];
    const firstStoreGeo = storeGroup.children[0].geometry;
    const firstChurchGeo = churchGroup.children[0].geometry;

    // All 4 parked cars sit on drawn meshY, not heightAt.
    const mat = new THREE.Matrix4(), pos3 = new THREE.Vector3();
    let checkedCars = 0;
    for (const child of parkedGroup.children) {
      if (!child.isInstancedMesh) continue;
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, mat);
        pos3.setFromMatrixPosition(mat);
        const wantY = L8.meshY(pos3.x, pos3.z);
        assert.ok(Math.abs(pos3.y - wantY) < 0.02, `exag=${exag} low=${isLow}: parked car ${checkedCars} sits on drawn meshY`);
        checkedCars++;
      }
    }
    assert.equal(checkedCars, 4, 'all 4 parked cars verified on drawn terrain');

    if (!isLow) {
      // Every single vertex of BOTH store and church meshes must be covered by live brookVillage.roofAt.
      for (const [label, grp, frame] of [['store', storeGroup, site.store], ['church', churchGroup, site.church]]) {
        for (const child of grp.children) {
          const pos = child.geometry.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
            const w = frame.world(u, v);
            const liveRoofH = bv.roofAt(w.x, w.z);
            assert.ok(Number.isFinite(liveRoofH) && liveRoofH >= y,
              `exag=${exag}: live roofAt (${liveRoofH.toFixed(3)}) covers ${label} vertex (${u.toFixed(2)}, ${v.toFixed(2)}) y=${y.toFixed(3)}`);
          }
        }
      }
      // Static roofBoxes cover peak of store, church steeple, flagpole and signboard.
      const ownRoofAt = roofHeights(site.roofBoxes(), manifest.village, exag, 0);
      for (const [sName, grp, frame, u0, u1, v0, v1] of [
        ['storeMain', storeGroup, site.store, STORE_MAIN.u0, STORE_MAIN.u1, STORE_MAIN.v0, STORE_MAIN.v1],
        ['storeContainer', storeGroup, site.store, STORE_CONTAINER.u0, STORE_CONTAINER.u1, STORE_CONTAINER.v0, STORE_CONTAINER.v1],
        ['churchSteeple', churchGroup, site.church, CHURCH_TOWER.u0, CHURCH_TOWER.u1, CHURCH_TOWER.v0, CHURCH_TOWER.v1],
        ['churchSign', churchGroup, site.church, CHURCH_SIGNBOARD.u - 0.5, CHURCH_SIGNBOARD.u + 0.5, CHURCH_SIGNBOARD.v - 1.2, CHURCH_SIGNBOARD.v + 1.2],
      ]) {
        const bounds = meshYBoundsIn(grp, u0, u1, v0, v1);
        const cw = frame.world((u0 + u1) / 2, (v0 + v1) / 2);
        const roofH = ownRoofAt(cw.x, cw.z);
        assert.ok(Number.isFinite(roofH) && roofH >= bounds.maxY,
          `exag=${exag}: static roofBoxes at ${sName} (${roofH.toFixed(3)}) covers built peak (${bounds.maxY.toFixed(3)})`);
      }
      // Sagged service-drop wire path (matching props.ts) must reach both anchors without clipping the built meshes.
      bv.group.updateMatrixWorld(true);
      const buildingMeshes = [...storeGroup.children, ...churchGroup.children].filter((c) => c.isMesh);
      const raycaster = new THREE.Raycaster();
      const origSides = buildingMeshes.map((m) => m.material.side);
      for (const m of buildingMeshes) m.material.side = THREE.DoubleSide;
      try {
        for (const [label, drop, pole] of [
          ['store', storeDrop, props.poles.find((p) => p.road === storeDrop.road && p.n === storeDrop.n)],
          ['church', churchDrop, props.poles.find((p) => p.road === churchDrop.road && p.n === churchDrop.n)],
        ]) {
          assert.ok(pole, `${label} service-drop pole found`);
          const px = pole.x - manifest.village[0], pz = manifest.village[1] - pole.y;
          const h = (pole.heading * Math.PI) / 180;
          const ax = px - Math.cos(h) * 0.38, az = pz - Math.sin(h) * 0.38;
          const bx = drop.x - manifest.village[0], bz = manifest.village[1] - drop.y;
          const ya = L8.heightAt(px, pz), yb = drop.ground * exag;
          const span = Math.hypot(bx - px, bz - pz);
          const sag = Math.min(0.65, span * 0.018);
          const wirePt = (t) => new THREE.Vector3(
            ax + (bx - ax) * t,
            ya + 6.71 + (yb + drop.height - ya - 6.71) * t - 4 * t * (1 - t) * sag,
            az + (bz - az) * t,
          );
          for (let seg = 0; seg < 10; seg++) {
            const t0 = seg / 10, t1 = Math.min((seg + 1) / 10, 0.995);
            const p0 = wirePt(t0), p1 = wirePt(t1);
            const dir = p1.clone().sub(p0), len = dir.length();
            raycaster.set(p0, dir.normalize());
            raycaster.near = 0;
            raycaster.far = len;
            const hits = raycaster.intersectObjects(buildingMeshes, false);
            assert.equal(hits.length, 0,
              `exag=${exag}: ${label} service wire seg ${seg} clips model ${hits[0]?.distance.toFixed(2)} m into segment`);
          }
        }
      } finally {
        buildingMeshes.forEach((m, i) => { m.material.side = origSides[i]; });
      }
      // Downhill grounding on sloped props (shipping container, flagpole, church signboard).
      for (const [sName, grp, frame, u0, u1, v0, v1] of [
        ['storeContainer', storeGroup, site.store, STORE_CONTAINER.u0, STORE_CONTAINER.u1, STORE_CONTAINER.v0, STORE_CONTAINER.v1],
        ['churchFlagpole', churchGroup, site.church, CHURCH_FLAGPOLE.u - 0.3, CHURCH_FLAGPOLE.u + 0.3, CHURCH_FLAGPOLE.v - 0.3, CHURCH_FLAGPOLE.v + 0.3],
        ['churchSignboard', churchGroup, site.church, CHURCH_SIGNBOARD.u - 0.4, CHURCH_SIGNBOARD.u + 0.4, CHURCH_SIGNBOARD.v - 1.2, CHURCH_SIGNBOARD.v + 1.2],
      ]) {
        const bounds = meshYBoundsIn(grp, u0, u1, v0, v1);
        let lowestG = Infinity;
        for (const [cu, cv] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) {
          const w = frame.world(cu, cv);
          lowestG = Math.min(lowestG, L8.meshY(w.x, w.z));
        }
        assert.ok(bounds.minY <= lowestG - 0.05,
          `exag=${exag}: ${sName} bottom (${bounds.minY.toFixed(3)}) sits below lowest corner (${lowestG.toFixed(3)})`);
      }
    }

    // Visibility toggle retention & disposal on ground change.
    drawn = 7; cached = 8;
    bv.update(new THREE.Vector3(site.origin.x, site.store.level * exag, site.origin.z + 1200), 0, { x: site.origin.x, z: site.origin.z + 1200 });
    assert.equal(bv.group.visible, false, 'hides on L7');
    drawn = 8;
    bv.update(new THREE.Vector3(site.origin.x, site.store.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(bv.group.visible, true, 'returns cleanly on L8');
    assert.equal(storeGroup.children[0].geometry, firstStoreGeo, 'retains store geometry across visibility toggles');
    assert.equal(churchGroup.children[0].geometry, firstChurchGeo, 'retains church geometry across visibility toggles');

    let disposedStore = false, disposedChurch = false;
    const origS = firstStoreGeo.dispose.bind(firstStoreGeo);
    const origC = firstChurchGeo.dispose.bind(firstChurchGeo);
    firstStoreGeo.dispose = () => { disposedStore = true; origS(); };
    firstChurchGeo.dispose = () => { disposedChurch = true; origC(); };
    meshBias = 0.25;
    bv.update(new THREE.Vector3(site.origin.x, site.store.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(disposedStore, true, 'old store geometry disposed on ground change');
    assert.equal(disposedChurch, true, 'old church geometry disposed on ground change');
  }
}

// Frame order, lazy chunk, tree-only clear boxes and live roofAt wiring in main.ts.
const terrainIdx = mainSrc.indexOf("name: 'terrain', segment: 'landscape'");
const bvIdx = mainSrc.indexOf("name: 'brookVillage', segment: 'landscape', ending: true");
assert.ok(terrainIdx >= 0 && bvIdx > terrainIdx, 'main.ts updates brookVillage in landscape (ending: true) after terrain');
assert.ok(mainSrc.includes("name !== 'brookVillage'"), 'main.ts excludes brookVillage from before-camera places loop');
assert.ok(mainSrc.includes('brookVillageSite.clear) terrain.addTreeClear'), 'main.ts registers brookVillage clear boxes as tree-only');
assert.ok(mainSrc.includes("early(import('./brook-village'))"), 'main.ts lazy-loads brook-village only when present');
assert.ok(mainSrc.includes('brookVillage ? brookVillage.roofAt(x, z) : -Infinity'), 'main.ts wires live brookVillage.roofAt into drone roofAt');

console.log(`PASS brook-village: desktop ${desktop.triangles} landmark / ${desktop.totalTriangles} total tris, LOW ${low.triangles} landmark / ${low.totalTriangles} total tris, 4 instanced parked cars (3 meshes), production Terrain L5-L8 Hwy 252 / Lake Ainslie Chapel Rd / Track 202 bit-for-bit untouched, swept lot & church turnaround open, all roof boxes & downhill corners verified`);
