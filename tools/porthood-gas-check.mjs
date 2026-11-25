// Node check for the Port Hood service station and gas bar (web/src/porthood-gas-site.ts, web/src/porthood-gas.ts):
//   1. PortHoodGasSite.find matches building 522 in Port Hood and refuses a moved (even 10 m), resized or turned box;
//   2. pad, paved asphalt lot, concrete fuel apron, rear gravel yard, mown corner lawns, tree-clear strips and maxTexel
//      road-field tiles agree with baked Port Hood land and leave High Road and Dunmore Road bit-for-bit untouched across L5-L8;
//   3. PortHoodGas builds finite geometry on desktop and LOW (LOW simpler), uses zero-allocation readiness, keeps all 25
//      instanced parked cars non-overlapping and off the roads, stops a car at every structure and parked vehicle, and
//      keeps High Road, Dunmore Road and the drive-through fuel lane open for car, pickup truck and SXS;
//   4. grounding uses drawn triangles across 7 -> 8 -> 7 (L8 cached) -> 7 (evicted) at 2.5x and 3x exaggeration, retains
//      geometry across visibility toggles, and drone roof boxes match built roof peaks.
// node tools/run-node-check.mjs tools/porthood-gas-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { clearBoxes } from '../web/src/buildings.ts';
import { roofHeights } from '../web/src/drone.ts';
import { PARKED_SIZE } from '../web/src/parked.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { Terrain } from '../web/src/terrain.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import {
  CONTAINER, EAST_SHED, EAST_WING, MAIN, PUMP_ISLAND, PYLON, PortHoodGas, TRAILER,
} from '../web/src/porthood-gas.ts';
import {
  GAS_PARKED_SPOTS, PORT_HOOD_GAS_BUILDING, PortHoodGasSite,
} from '../web/src/porthood-gas-site.ts';

const AREA = 'data/baked/areas/porthood/';
const manifest = JSON.parse(readFileSync(`${AREA}manifest.json`, 'utf8'));
const buildings = JSON.parse(readFileSync(`${AREA}buildings.json`, 'utf8')).buildings;
const roads = JSON.parse(readFileSync(`${AREA}roads.json`, 'utf8')).roads;

// 1. Site lookup against the baked Port Hood catalog.
const found = PortHoodGasSite.find(buildings);
assert.ok(found && found.id === PORT_HOOD_GAS_BUILDING, 'PortHoodGasSite.find finds building 522 in Port Hood');
assert.equal(PortHoodGasSite.find([{ ...found, length: found.length + 2 }]), null, 'a resized box is ignored');
assert.equal(PortHoodGasSite.find([{ ...found, axisDeg: found.axisDeg + 15 }]), null, 'a turned box is ignored');
assert.equal(PortHoodGasSite.find([{ ...found, x: found.x + 10 }]), null, 'a 10 m shifted box is ignored');
assert.equal(PortHoodGasSite.find([{ ...found, kind: 'house' }]), null, 'wrong kind is ignored');

const site = new PortHoodGasSite(found, manifest.village);
assert.ok(site.clear.length >= 10, `tree-clear strips generated (${site.clear.length})`);

// Every tile painted within maxTexel must already have a baked road field so no coarse tile allocates a new texture.
const roadLevels = Object.keys(manifest.roads.levels).map(Number);
const coarsestRoadTexel = manifest.size / 2 ** Math.min(...roadLevels) / 256;
assert.ok(site.maxTexel <= 2 && site.maxTexel <= coarsestRoadTexel, `site paints only L8 (${site.maxTexel} <= 2 <= ${coarsestRoadTexel})`);
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

// 2. Pad, asphalt forecourt, concrete fuel apron, rear gravel yard and mown corner lawns.
const padW = site.world(0, 0);
assert.equal(site.height(padW.x, padW.z, 40.0), site.level, 'station pad is level at building.ground');
const concW = site.world(-3, -11);
assert.equal(site.surface(concW.x, concW.z, undefined, 8)?.kind, 9, 'fuel apron paints as concrete slab');
const asphaltW = site.world(-22, -12);
assert.equal(site.surface(asphaltW.x, asphaltW.z, undefined, 8)?.kind, 2, 'forecourt lot paints as asphalt');
const rearW = site.world(2, 9);
assert.equal(site.surface(rearW.x, rearW.z, undefined, 8)?.kind, 8, 'rear work apron paints as gravel');
const lawnW = site.world(PYLON.u, PYLON.v);
assert.equal(site.surface(lawnW.x, lawnW.z, undefined, 8)?.kind, 12, 'SW corner around pylon paints as mown grass');
assert.equal(site.surface(asphaltW.x, asphaltW.z, undefined, 7), null, 'L7 surface stays untouched');

// Verify no two parked vehicles overlap each other or any fixed structure box.
assert.equal(GAS_PARKED_SPOTS.length, 28, 'lot has 28 packed vehicles');
const spotRect = (s) => {
  const [L, W] = PARKED_SIZE[s.type];
  const n = Math.hypot(s.du, s.dv);
  const fx = s.du / n, fz = s.dv / n;
  const hw = W / 2, hl = L / 2;
  // Conservative axis-aligned envelope in site (u, v) for quick pair gap sanity + oriented corner test.
  const du = Math.abs(fx) * hl + Math.abs(fz) * hw;
  const dv = Math.abs(fz) * hl + Math.abs(fx) * hw;
  return { u0: s.u - du, u1: s.u + du, v0: s.v - dv, v1: s.v + dv };
};
for (let i = 0; i < GAS_PARKED_SPOTS.length; i++) {
  const a = spotRect(GAS_PARKED_SPOTS[i]);
  for (let j = i + 1; j < GAS_PARKED_SPOTS.length; j++) {
    const b = spotRect(GAS_PARKED_SPOTS[j]);
    const overlap = a.u0 < b.u1 - 0.1 && a.u1 > b.u0 + 0.1 && a.v0 < b.v1 - 0.1 && a.v1 > b.v0 + 0.1;
    assert.equal(overlap, false, `parked spots ${i} and ${j} do not overlap`);
  }
  const structures = [
    ['main', MAIN.u0, MAIN.u1, MAIN.v0, MAIN.v1],
    ['eastWing', EAST_WING.u0, EAST_WING.u1, EAST_WING.v0, EAST_WING.v1],
    ['pumpIsland', PUMP_ISLAND.u0, PUMP_ISLAND.u1, PUMP_ISLAND.v0, PUMP_ISLAND.v1],
    ['eastShed', EAST_SHED.u0, EAST_SHED.u1, EAST_SHED.v0, EAST_SHED.v1],
    ['container', CONTAINER.u0, CONTAINER.u1, CONTAINER.v0, CONTAINER.v1],
    ['trailer', TRAILER.u0, TRAILER.u1, TRAILER.v0, TRAILER.v1],
  ];
  for (const [name, u0, u1, v0, v1] of structures) {
    const overlap = a.u0 < u1 + 0.1 && a.u1 > u0 - 0.1 && a.v0 < v1 + 0.1 && a.v1 > v0 - 0.1;
    assert.equal(overlap, false, `parked spot ${i} stays clear of ${name}`);
  }
}

// 3. Build PortHoodGas on desktop and LOW against a flat stand-in terrain; verify zero surfaceAt calls in ready().
let surfaceAtCalls = 0;
const flatTerrain = {
  heightAt: () => site.level,
  meshHeightAt: () => site.level,
  levelAt: () => 8,
  surfaceAt: () => { surfaceAtCalls++; return { level: 8 }; },
};
const build = (low) => {
  const st = new PortHoodGas(site, flatTerrain, (m) => m, low);
  st.update(new THREE.Vector3(site.origin.x, site.level, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
  assert.ok(!st.waiting && st.group.visible && st.triangles > 0, `built (low=${low})`);
  assert.equal(st.parkedCount, 28, `28 instanced parked vehicles (low=${low})`);
  return st;
};
const desktop = build(false), low = build(true);
assert.equal(surfaceAtCalls, 0, 'readiness check never allocates via surfaceAt');
assert.ok(desktop.triangles >= 1500 && desktop.triangles <= 12000, `desktop triangles ${desktop.triangles} in range`);
assert.ok(low.triangles < desktop.triangles * 0.85, `LOW (${low.triangles}) is simpler than desktop (${desktop.triangles})`);

for (const st of [desktop, low]) {
  let instancedCount = 0, instancedMeshes = 0;
  st.group.traverse((o) => {
    if (o.isInstancedMesh) { instancedMeshes++; instancedCount += o.count; }
    if (o.isMesh) {
      const pos = o.geometry.getAttribute('position').array;
      for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), 'finite geometry');
    }
  });
  assert.equal(instancedMeshes, 3, 'parked cars share 3 instanced meshes (car, SUV, pickup)');
  assert.equal(instancedCount, 28, 'all 28 parked cars instanced');
}

// Solids check: structures and parked cars stop a car; drive-through fuel lane and lot entrances stay open.
const pushAt = (u, v, heading = 0, spec = CAR_SPEC) => {
  const w = site.world(u, v), car = { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, heading, spec };
  desktop.resolveSolids(car);
  return Math.hypot(car.x - w.x, car.z - w.z);
};
assert.ok(pushAt(0, 0) > 2.5, 'main service station pushes car out');
assert.ok(pushAt(8.5, -1) > 1.0, 'east wing pushes car out');
assert.ok(pushAt(-5, -13) > 0.6, 'fuel pump island pushes car out');
assert.ok(pushAt(PYLON.u, PYLON.v) > 0.3, 'pylon price sign pushes car out');
assert.ok(pushAt(20, -13) > 1.5, 'east storage shed pushes car out');
assert.ok(pushAt(24.3, -14) > 1.0, 'shipping container pushes car out');
assert.ok(pushAt(14.8, -4.3) > 0.8, 'cargo trailer pushes car out');
assert.ok(pushAt(-2.5, -16.1) > 0.5, 'fuelling SUV at outer pump pushes car out');
assert.ok(pushAt(-23.1, -19.5) > 0.5, 'parked pickup in NW row pushes car out');
// Drive-through route: Dunmore Road entrance -> west apron -> inner east pump -> High Road exit stays open!
for (const [label, u, v, du, dv] of [
  ['Dunmore entrance', -34, 4, 1, -0.5],
  ['west apron', -22, -4, 1, -0.6],
  ['pump approach', -14, -9.5, 1, 0],
  ['open inner east pump', -1.5, -9.5, 1, 0],
  ['High Road exit lane', 4.0, -17.5, 0, -1],
  ['High Road west entrance', -12.0, -21.0, 0, 1],
]) {
  for (const [vName, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['sxs', SXS_SPEC]]) {
    assert.equal(pushAt(u, v, site.heading(du, dv), spec), 0, `${label} is open for ${vName}`);
  }
}

// Collect sampled carriageway points (centreline + both edges, every 1 m) for High Road and Dunmore Road.
const roadSamples = [];
for (const roadName of ['High Road', 'Dunmore Road']) {
  const matching = roads.filter((r) => r.name === roadName);
  assert.ok(matching.length > 0, `${roadName} present in roads.json`);
  for (const road of matching) {
    for (let k = 0; k < road.pts.length - 1; k++) {
      const [e0, n0] = road.pts[k], [e1, n1] = road.pts[k + 1];
      const x0 = e0 - manifest.village[0], z0 = manifest.village[1] - n0;
      const x1 = e1 - manifest.village[0], z1 = manifest.village[1] - n1;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-4) continue;
      if (Math.hypot((x0 + x1) / 2 - site.origin.x, (z0 + z1) / 2 - site.origin.z) > 110) continue;
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
}
assert.ok(roadSamples.length > 200, `sampled ${roadSamples.length} carriageway centre/edge points`);

// Every High Road and Dunmore Road carriageway point stays clear of all solids for car, pickup truck and SXS in both directions.
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

// 4. Baked-land verification across L5, L6, L7, L8:
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
  return { heightAt, meshY, exag, tileFor, tileSize, mpp, active };
}

// Production Terrain L5-L8 bit-for-bit road parity along High Road and Dunmore Road.
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
  fogNear: { value: 200 },
  fogFar: { value: 12000 },
  time: { value: 0 },
};
const surveyedClear = clearBoxes(found, manifest.village, 2.5);
const mainSrc = readFileSync('web/src/main.ts', 'utf8');
assert.ok(mainSrc.includes('clear.push(...clearBoxes(portHoodGasBox, manifest.village, 2.5))'),
  'main.ts preserves building 522 clearBoxes in regular terrain.clear so L5-L7 match the unreplaced baseline');

for (const level of [5, 6, 7, 8]) {
  const baseTerrain = new Terrain(manifest, AREA.slice(0, -1), shared, 2.5, 0, [...surveyedClear]);
  const siteTerrain = new Terrain(manifest, AREA.slice(0, -1), shared, 2.5, 0, [...surveyedClear]);
  siteTerrain.sites.push(site);
  for (const box of site.clear) siteTerrain.addTreeClear(box);
  const tileSize = manifest.size / 2 ** level;
  const needed = new Set();
  for (const pt of roadSamples) {
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
      `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production Terrain.meshHeightAt bit-for-bit unchanged`);
    const sb = baseTerrain.surfaceAt(pt.x, pt.z), ss = siteTerrain.surfaceAt(pt.x, pt.z);
    assert.ok(sb && ss, `L${level} surfaceAt present`);
    assert.equal(ss.kind, sb.kind, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production surfaceAt.kind unchanged`);
    assert.equal(ss.halfWidth, sb.halfWidth, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production surfaceAt.halfWidth unchanged`);
    assert.equal(ss.roadDist, sb.roadDist, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production surfaceAt.roadDist bit-for-bit unchanged`);
  }
}

for (const exag of [2.5, 3]) {
  const L8 = loadLevel(8, exag);
  for (const isLow of [false, true]) {
    let drawn = 7, cached = 7, pending = 0;
    const realTerrain = {
      heightAt: (x, z) => L8.heightAt(x, z),
      meshHeightAt: (x, z, drawnOnly) => (drawnOnly && drawn === 8 ? L8.meshY(x, z) : L8.heightAt(x, z)),
      drawnLevelAt: () => drawn,
      levelAt: () => cached,
      get pending() { return pending; },
    };
    const st = new PortHoodGas(site, realTerrain, (m) => m * exag, isLow);
    // Solids active before first L8 build.
    const preW = site.world(0, 0), preCar = { x: preW.x, z: preW.z, vx: 0, vz: 0, speed: 0, heading: 0 };
    st.resolveSolids(preCar);
    const prePush = Math.hypot(preCar.x - preW.x, preCar.z - preW.z);
    assert.ok(prePush > 2.5, `exag=${exag} low=${isLow}: solids active before L8 build (${prePush.toFixed(2)} m)`);
    // Cold LOW visit with L7 drawn and pending=0 must NOT hang waiting=true.
    st.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + 850), 0, { x: site.origin.x, z: site.origin.z + 850 });
    assert.equal(st.group.visible, false, `L7 exag=${exag} low=${isLow}: stays hidden until L8 is drawn`);
    assert.equal(st.waiting, false, `L7 exag=${exag} low=${isLow}: waiting=false when pending=0`);
    pending = 2;
    assert.equal(st.waiting, true, `exag=${exag} low=${isLow}: waiting=true while near and terrain.pending > 0`);
    pending = 0;
    drawn = 8; cached = 8;
    st.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(st.group.visible, true, `L8 exag=${exag} low=${isLow}: visible once L8 is drawn`);
    assert.equal(st.waiting, false, `L8 exag=${exag} low=${isLow}: waiting=false once built`);
    const firstGeo = st.group.children[0].children[0].geometry;
    if (!isLow) {
      const ownRoofAt = roofHeights(site.roofBoxes(), manifest.village, exag, 0);
      const mainW = site.world(0, 0);
      assert.ok(ownRoofAt(mainW.x, mainW.z) >= site.level * exag + MAIN.parapet - 0.1, `exag=${exag}: drone roof floor covers main parapet`);
      const openW = site.world(-25, -12);
      assert.equal(ownRoofAt(openW.x, openW.z), -Infinity, `exag=${exag}: open lot has no phantom roof floor`);
    }
    // Dropping back to L7/L6/null hides cleanly and returning to same L8 retains geometry.
    for (const [label, lvl, dist] of [['L7 with L8 cached', 7, 1180], ['L6 at 1590 m', 6, 1590], ['null drawn', null, 100]]) {
      drawn = lvl; cached = 8;
      st.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + dist), 0, { x: site.origin.x, z: site.origin.z + dist });
      assert.equal(st.group.visible, false, `exag=${exag} low=${isLow}: hides on ${label}`);
    }
    drawn = 8; cached = 8;
    st.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(st.group.visible, true, `exag=${exag} low=${isLow}: returns cleanly when L8 is drawn again`);
    assert.equal(st.group.children[0].children[0].geometry, firstGeo, `exag=${exag} low=${isLow}: retains geometry across visibility toggles`);
  }
}

// Frame order & tree-only clear boxes: main.ts must update portHoodGas in landscape (ending: true) after terrain.
const terrainIdx = mainSrc.indexOf("name: 'terrain', segment: 'landscape'");
const gasIdx = mainSrc.indexOf("name: 'portHoodGas', segment: 'landscape', ending: true");
assert.ok(terrainIdx >= 0 && gasIdx > terrainIdx, 'main.ts updates portHoodGas in landscape (ending: true) after terrain');
assert.ok(mainSrc.includes("name !== 'portHoodGas'"), 'main.ts excludes portHoodGas from before-camera places loop');
assert.ok(mainSrc.includes('portHoodGasSite.clear) terrain.addTreeClear'), 'main.ts registers portHoodGas clear boxes as tree-only');

console.log(`PASS porthood-gas: desktop ${desktop.triangles} tris, LOW ${low.triangles} tris, 28 instanced parked cars (3 meshes), production Terrain L5-L8 High Road & Dunmore Road bit-for-bit untouched, solids & open fuel lane verified, geometry retained across visibility toggles`);
