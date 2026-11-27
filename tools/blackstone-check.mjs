// Node check for a house on Blackstone Road, Mabou (web/src/blackstone-site.ts, web/src/blackstone-house.ts):
//   1. BlackstoneSite.find matches building 1454 in Mabou and refuses a moved (even 10 m), resized or turned box;
//   2. pad, driveways, mown lawn, tree-clear strips, maxTexel road-field tiles, mailbox relocation (style 7) and
//      service drop re-aiming agree with the baked land and leave Blackstone Road and Smithville Road untouched across L5-L8;
//   3. BlackstoneHouse builds finite geometry on desktop and LOW (LOW simpler), uses zero-allocation levelAt readiness,
//      keeps half >= halfWidth on every solid (including the rear of the SE deck), and keeps driveways and both road
//      carriageway edges open at the road's heading;
//   4. grounding uses drawn triangles (meshHeightAt(x, z, true)) across 7 -> 8 -> 7 (L8 cached) -> 7 (evicted) at 2.5x
//      and 3x exaggeration, and drone roof boxes match the built roof peaks for house, shed, barn and hoop shelters.
// node tools/run-node-check.mjs tools/blackstone-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { clearBoxes } from '../web/src/buildings.ts';
import { roofHeights } from '../web/src/drone.ts';
import { Props } from '../web/src/props.ts';
import { Ruts, isLawnSurface } from '../web/src/ruts.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { Terrain } from '../web/src/terrain.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import {
  BlackstoneHouse, EAST_BARN, HOOP_EAST, HOOP_WEST, MAIN, NW_WING, PARCEL_BOX, PORCH, SE_DECK, WEST_SHED,
} from '../web/src/blackstone-house.ts';
import {
  BLACKSTONE_BUILDING, BlackstoneSite, MAILBOX_HEADING_DEG, MAILBOX_UV,
} from '../web/src/blackstone-site.ts';

const AREA = 'data/baked/terrain/';
const manifest = JSON.parse(readFileSync(`${AREA}manifest.json`, 'utf8'));
const buildings = JSON.parse(readFileSync(`${AREA}buildings.json`, 'utf8')).buildings;
const roads = JSON.parse(readFileSync(`${AREA}roads.json`, 'utf8')).roads;
const props = JSON.parse(readFileSync(`${AREA}props.json`, 'utf8'));

// 1. Site lookup against the baked Mabou catalog (tightly anchored to the building centre).
const found = BlackstoneSite.find(buildings);
assert.ok(found && found.id === BLACKSTONE_BUILDING, 'BlackstoneSite.find finds building 1454 in Mabou');
assert.equal(BlackstoneSite.find([{ ...found, length: found.length + 2 }]), null, 'a resized box is ignored');
assert.equal(BlackstoneSite.find([{ ...found, axisDeg: found.axisDeg + 15 }]), null, 'a turned box is ignored');
assert.equal(BlackstoneSite.find([{ ...found, x: found.x + 10 }]), null, 'a 10 m shifted box is ignored');
assert.equal(BlackstoneSite.find([{ ...found, x: 630789, y: 5109876 }]), null, 'a box moved onto Blackstone Road is ignored');

const site = new BlackstoneSite(found, manifest.village);
assert.ok(site.clear.length >= 8, `tree-clear strips generated (${site.clear.length})`);

// Every tile painted within maxTexel must already have a baked road field so no coarse tile allocates a new texture.
const roadLevels = Object.keys(manifest.roads.levels).map(Number);
const coarsestRoadTexel = manifest.size / 2 ** Math.min(...roadLevels) / 256;
assert.ok(site.maxTexel <= 2 && site.maxTexel <= coarsestRoadTexel, `site paints only L7/L8 (${site.maxTexel} <= 2 <= ${coarsestRoadTexel})`);
for (const level of Object.keys(manifest.levels).map(Number)) {
  const size = manifest.size / 2 ** level;
  if (size / 256 > site.maxTexel) continue;
  const fields = new Set(manifest.roads.levels[level] ?? []);
  for (const x of [site.box[0], site.box[2]]) for (const z of [site.box[1], site.box[3]]) {
    const i = Math.floor((x + manifest.village[0] - manifest.origin[0]) / size);
    const j = Math.floor((z - manifest.village[1] + manifest.origin[1]) / size);
    assert.ok(fields.has(`${i}_${j}`), `site tile ${level}/${i}_${j} has a baked road field`);
  }
}

// 2. Pad, driveways, lawn, mailbox and service drop.
const padW = site.world(0, 0);
assert.equal(site.height(padW.x, padW.z, 90.0), site.level, 'house pad is level at building.ground');
const drvFrontW = site.world(0, -13.0);
assert.equal(site.surface(drvFrontW.x, drvFrontW.z)?.kind, 8, 'front driveway apron paints as gravel');
const drvEastW = site.world(28.0, 0.5);
assert.equal(site.surface(drvEastW.x, drvEastW.z)?.kind, 8, 'east barn driveway spur paints as gravel');
const lawnW = site.world(28.0, -11.0);
assert.equal(site.surface(lawnW.x, lawnW.z)?.kind, 12, 'east front lawn island paints as mown lawn');

const adjusted = site.adjustProps(props);
const [expectedMbX, expectedMbY] = site.map(MAILBOX_UV[0], MAILBOX_UV[1]);
const movedBox = adjusted.mailboxes.find((m) => Math.hypot(m.x - expectedMbX, m.y - expectedMbY) < 0.05);
assert.ok(movedBox, 'mailbox relocated to west driveway entrance');
assert.equal(movedBox.style, 7, 'mailbox uses dark-green plastic pedestal style (7)');
assert.equal(movedBox.heading, MAILBOX_HEADING_DEG, 'mailbox faces Blackstone Road');
assert.equal(movedBox.parcelBox, false, 'generic chest suppressed in favour of the hand-built red/white parcel box');

const drop = adjusted.serviceDrops.find((d) => d.building === BLACKSTONE_BUILDING);
assert.ok(drop, 'service drop for building 1454 exists');
const dropUV = site.local(drop.x - manifest.village[0], manifest.village[1] - drop.y);
assert.ok(Math.abs(dropUV.u - (-5.5)) < 0.05 && Math.abs(dropUV.v - (-4.1)) < 0.05, `drop lands on NW wing wall (${JSON.stringify(dropUV)})`);
assert.ok(drop.height > MAIN.eave && drop.height < NW_WING.eave, `drop height ${drop.height} fits upper NW wing wall`);

// 3. Build BlackstoneHouse on desktop and LOW against a flat stand-in terrain; verify zero surfaceAt calls in ready().
let surfaceAtCalls = 0;
const flatTerrain = {
  heightAt: () => site.level,
  meshHeightAt: () => site.level,
  levelAt: () => 8,
  surfaceAt: () => { surfaceAtCalls++; return { level: 8 }; },
};
const build = (low) => {
  const house = new BlackstoneHouse(site, flatTerrain, (m) => m, low);
  house.update(new THREE.Vector3(site.origin.x, site.level, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
  assert.ok(!house.waiting && house.group.visible && house.triangles > 0, `built (low=${low})`);
  return house;
};
const desktop = build(false), low = build(true);
assert.equal(surfaceAtCalls, 0, 'readiness check never allocates via surfaceAt');
assert.ok(desktop.triangles >= 2500 && desktop.triangles <= 14000, `desktop triangles ${desktop.triangles} in range`);
assert.ok(low.triangles < desktop.triangles * 0.72, `LOW (${low.triangles}) is simpler than desktop (${desktop.triangles})`);

for (const h of [desktop, low]) {
  h.group.traverse((o) => {
    if (o.isMesh) {
      const pos = o.geometry.getAttribute('position').array;
      for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), 'finite geometry');
    }
  });
}

// Solids must have half >= halfWidth and stop a car from every face, including the rear of the SE deck.
const pushAt = (u, v, heading = 0) => {
  const w = site.world(u, v), car = { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, heading };
  desktop.resolveSolids(car);
  return Math.hypot(car.x - w.x, car.z - w.z);
};
assert.ok(pushAt(-3, 0) > 2, 'NW wing pushes car out');
assert.ok(pushAt(2, 0) > 2, 'main wing pushes car out');
assert.ok(pushAt(1.1, PORCH.v0 + 0.4) > 0.5, 'front porch pushes car out');
assert.ok(pushAt(6.4, 0) > 0.8, 'SE two-storey deck centre pushes car out');
assert.ok(pushAt(6.4, 5.0, site.heading(0, -1)) > 0.4, 'SE two-storey deck rear catches an approaching car');
assert.ok(pushAt(-18, -8.5) > 0.8, 'west gambrel shed pushes car out');
assert.ok(pushAt(43.5, 4.0) > 2, 'east gambrel barn pushes car out');
assert.ok(pushAt(35.3, 5.2) > 0.8, 'west hoop shelter pushes car out');
assert.ok(pushAt(49.5, 3.5) > 0.8, 'east hoop shelter pushes car out');
assert.ok(pushAt(PARCEL_BOX.u, PARCEL_BOX.v) > 0.2, 'parcel chest pushes car out');
assert.equal(pushAt(0, -13.5), 0, 'front driveway apron is open for a car');
assert.equal(pushAt(22, -3.5), 0, 'east barn driveway spur is open for a car');
assert.equal(pushAt(-10.5, -6.5), 0, 'west shed driveway spur is open for a car');
assert.equal(pushAt(28, -11), 0, 'east front lawn island is open');

// Collect sampled carriageway points (centreline + both edges, every 1 m) for Blackstone Road and Smithville Road.
const roadSamples = [];
for (const roadName of ['Blackstone Road', 'Smithville Road']) {
  const matching = roads.filter((r) => r.name === roadName);
  assert.ok(matching.length > 0, `${roadName} present in roads.json`);
  for (const road of matching) {
    for (let k = 0; k < road.pts.length - 1; k++) {
      const [e0, n0] = road.pts[k], [e1, n1] = road.pts[k + 1];
      const x0 = e0 - manifest.village[0], z0 = manifest.village[1] - n0;
      const x1 = e1 - manifest.village[0], z1 = manifest.village[1] - n1;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-4) continue;
      if (Math.hypot((x0 + x1) / 2 - site.origin.x, (z0 + z1) / 2 - site.origin.z) > 120) continue;
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
assert.ok(roadSamples.length > 100, `sampled ${roadSamples.length} carriageway centre/edge points`);

// Every Blackstone Road and Smithville Road centre and carriageway-edge segment stays clear of all solids AND the
// relocated mailbox (real Props.hitCar sweep) for car, pickup truck and SXS in both travel directions.
const liveProps = new Props({ ...adjusted, mailboxes: [movedBox], poles: [], serviceDrops: [] }, manifest.village, flatTerrain);
for (const roadName of ['Blackstone Road', 'Smithville Road']) {
  for (const road of roads.filter((r) => r.name === roadName)) {
    for (let k = 0; k < road.pts.length - 1; k++) {
      const [e0, n0] = road.pts[k], [e1, n1] = road.pts[k + 1];
      const x0 = e0 - manifest.village[0], z0 = manifest.village[1] - n0;
      const x1 = e1 - manifest.village[0], z1 = manifest.village[1] - n1;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-4 || Math.hypot((x0 + x1) / 2 - site.origin.x, (z0 + z1) / 2 - site.origin.z) > 120) continue;
      const tx = (x1 - x0) / len, tz = (z1 - z0) / len, nx = -tz, nz = tx;
      for (const side of [-road.halfWidth, 0, road.halfWidth]) {
        const ax = x0 + nx * side, az = z0 + nz * side, bx = x1 + nx * side, bz = z1 + nz * side;
        for (const [fx, fz, gx, gz, hdg, vx, vz] of [
          [ax, az, bx, bz, Math.atan2(tx, -tz), tx * 15, tz * 15],
          [bx, bz, ax, az, Math.atan2(-tx, tz), -tx * 15, -tz * 15],
        ]) {
          for (const [label, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['sxs', SXS_SPEC]]) {
            const factor = liveProps.hitCar(gx, gz, hdg, vx, vz, fx, fz, spec);
            assert.equal(factor, 1, `${label} hits relocated mailbox sweeping ${roadName} (side=${side.toFixed(1)} m)`);
            const steps = Math.max(1, Math.ceil(len));
            for (let s = 0; s <= steps; s++) {
              const f = s / steps, cx = fx + (gx - fx) * f, cz = fz + (gz - fz) * f;
              const car = { x: cx, z: cz, vx: 0, vz: 0, speed: 0, heading: hdg, spec };
              desktop.resolveSolids(car);
              assert.equal(Math.hypot(car.x - cx, car.z - cz), 0,
                `${label} hits solid on ${roadName} (side=${side.toFixed(1)} m) at (${cx.toFixed(1)}, ${cz.toFixed(1)})`);
            }
          }
        }
      }
    }
  }
}

// 4. Baked-land verification across L5, L6, L7, L8:
//    - Blackstone Road and Smithville Road rendered mesh height AND road-field bytes stay 100% untouched on L5-L8;
//    - grounding uses drawn triangles across 7 -> 8 -> 7 (L8 cached) -> 7 (L8 evicted) at 2.5x and 3x exaggeration;
//    - drone roof floor matches built roof peaks for house, west shed, east barn and hoop shelters at 2.5x and 3x.
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

// Verify zero production Terrain meshHeightAt() or surfaceAt() road changes along Blackstone Road and Smithville Road
// across L5, L6, L7, L8 using two real production Terrain instances (base vs site + addTreeClear).
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.fetch = async (path) => new Response(readFileSync(String(path)));
globalThis.createImageBitmap = async (blob) => {
  const p = decodePng(Buffer.from(await blob.arrayBuffer()));
  const pixels = new Uint8ClampedArray(p.w * p.h * 4);
  for (let i = 0; i < p.w * p.h; i++) {
    pixels[i * 4] = p.data[i * p.bpp];
    pixels[i * 4 + 1] = p.data[i * p.bpp + 1];
    pixels[i * 4 + 2] = p.data[i * p.bpp + 2];
    pixels[i * 4 + 3] = p.bpp === 4 ? p.data[i * 4 + 3] : 255;
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
assert.ok(mainSrc.includes('clear.push(...clearBoxes(blackstoneBox, manifest.village, 2.5))'),
  'main.ts preserves building 1454 clearBoxes in regular terrain.clear so L5-L7 match the unreplaced baseline');
for (const level of [5, 6, 7, 8]) {
  // Baseline production config: unreplaced surveyed building 1454 contributes its clearBoxes to terrain.clear.
  const baseTerrain = new Terrain(manifest, AREA.slice(0, -1), shared, 2.5, 0, [...surveyedClear]);
  // Replacement production config: same preserved building clearBoxes + BlackstoneSite + tree-only yard clear boxes.
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
  let sawPosSigned = false, sawNegSigned = false;
  for (const pt of roadSamples) {
    assert.equal(siteTerrain.meshHeightAt(pt.x, pt.z), baseTerrain.meshHeightAt(pt.x, pt.z),
      `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production Terrain.meshHeightAt bit-for-bit unchanged`);
    const sb = baseTerrain.surfaceAt(pt.x, pt.z), ss = siteTerrain.surfaceAt(pt.x, pt.z);
    assert.ok(sb && ss, `L${level} surfaceAt present`);
    assert.equal(ss.kind, sb.kind, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production surfaceAt.kind unchanged`);
    assert.equal(ss.halfWidth, sb.halfWidth, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production surfaceAt.halfWidth unchanged`);
    assert.equal(ss.roadDist, sb.roadDist, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production surfaceAt.roadDist bit-for-bit unchanged`);
    if (ss.kind > 0) {
      assert.ok(Number.isFinite(ss.roadSigned), `L${level} ${pt.roadName} production surfaceAt.roadSigned present`);
      assert.equal(ss.roadSigned, sb.roadSigned, `L${level} ${pt.roadName} production surfaceAt.roadSigned bit-for-bit unchanged`);
      assert.ok(Math.abs(Math.abs(ss.roadSigned) - ss.roadDist) < 1e-9, `L${level} ${pt.roadName} |roadSigned| matches roadDist`);
      if (ss.roadSigned > 0.2) sawPosSigned = true;
      if (ss.roadSigned < -0.2) sawNegSigned = true;
    }
  }
  assert.ok(sawPosSigned && sawNegSigned, `L${level} production Terrain.surfaceAt exposes both signs of roadSigned across road sides`);
  if (level === 8) {
    // Verify production Terrain.surfaceAt.roadSigned matches the raw baked road PNG sign (catches global sign reversal),
    // and verify a deck override resets roadSigned to 0 alongside roadDist.
    const zero = manifest.roads.encoding.signed ? manifest.roads.encoding.zero ?? 128 : 0;
    const dScale = manifest.roads.encoding.distance;
    let verifiedPos = false, verifiedNeg = false;
    for (const key of needed) {
      const [ti, tj] = key.split('_').map(Number);
      const roadPng = decodePng(readFileSync(`${AREA}8/${ti}_${tj}.r.png`));
      const x0 = manifest.origin[0] + ti * tileSize - manifest.village[0];
      const z0 = manifest.village[1] - (manifest.origin[1] - tj * tileSize);
      for (let b = 4; b < 252 && !(verifiedPos && verifiedNeg); b += 4) for (let a = 4; a < 252 && !(verifiedPos && verifiedNeg); a += 4) {
        const k = (b * roadPng.w + a) * roadPng.bpp;
        const rawR = roadPng.data[k], rawKind = roadPng.data[k + 2] & 15;
        if (rawKind === 0 || Math.abs(rawR - zero) < 4) continue;
        const cx = x0 + (a / 256) * tileSize, cz = z0 + (b / 256) * tileSize;
        const surf = baseTerrain.surfaceAt(cx, cz);
        assert.ok(surf && Number.isFinite(surf.roadSigned), 'L8 baked road sample has finite roadSigned');
        const expected = (rawR - zero) * dScale;
        assert.ok(Math.abs(surf.roadSigned - expected) < 1e-6, `L8 roadSigned (${surf.roadSigned}) matches baked byte sign (${expected})`);
        if (expected > 0) verifiedPos = true;
        if (expected < 0) verifiedNeg = true;
      }
    }
    assert.ok(verifiedPos && verifiedNeg, 'L8 production roadSigned verified against raw baked PNG bytes on both sides of the road');
    const deckPt = roadSamples.find((p) => { const s = baseTerrain.surfaceAt(p.x, p.z); return s && Math.abs(s.roadSigned ?? 0) > 1; });
    assert.ok(deckPt, 'found off-centreline road sample for deck roadSigned reset check');
    const deckTerrain = new Terrain(manifest, AREA.slice(0, -1), shared, 2.5, 0, []);
    const baseY = baseTerrain.heightAt(deckPt.x, deckPt.z);
    deckTerrain.sites.push({
      box: [deckPt.x - 4, deckPt.z - 4, deckPt.x + 4, deckPt.z + 4],
      samplesTerrain: false,
      height: (_x, _z, raw) => raw,
      surface: () => null,
      deckContactHeight: () => baseY + 1,
      deckDriving: { kind: 9, halfWidth: 3 },
    });
    const dTi = Math.floor((deckPt.x + manifest.village[0] - manifest.origin[0]) / tileSize);
    const dTj = Math.floor((manifest.origin[1] - (manifest.village[1] - deckPt.z)) / tileSize);
    await deckTerrain.loadNow(8, dTi, dTj);
    const deckSurf = deckTerrain.surfaceAt(deckPt.x, deckPt.z, baseY + 1);
    assert.equal(deckSurf?.deck, true, 'production deck override sets deck=true');
    assert.equal(deckSurf?.roadDist, 0, 'production deck override sets roadDist=0');
    assert.equal(deckSurf?.roadSigned, 0, 'production deck override sets roadSigned=0');
    // Real Ruts on the L8 Blackstone site: mown lawn (kind 12, including the far east island > 35 m from house 1454)
    // takes tyre tracks and files lawn damage for building 1454; Blackstone Road (within 28 m of house 1454) and the
    // gravel driveway stay track-free, and straddling the driveway/lawn edge puts strips only on the lawn wheel.
    const driveLine = (pts) => {
      const hits = [];
      const ruts = new Ruts(siteTerrain, buildings, manifest.village, true, (id) => hits.push(id));
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i], next = pts[Math.min(i + 1, pts.length - 1)], prev = pts[Math.max(i - 1, 0)];
        const dx = next.x - prev.x, dz = next.z - prev.z, len = Math.hypot(dx, dz) || 1;
        const y = siteTerrain.heightAt(cur.x, cur.z) ?? site.level * 2.5;
        ruts.update({ x: cur.x, z: cur.z, y, vx: (dx / len) * 5, vz: (dz / len) * 5, heading: Math.atan2(dx, -dz), airborne: false }, i + 1);
      }
      return { count: ruts.count, lawns: ruts.lawns, hits, mesh: ruts.mesh };
    };
    const lawnPts = Array.from({ length: 24 }, (_, i) => site.world(16 + i * 0.8, -11.5));
    assert.equal(siteTerrain.surfaceAt(lawnPts[0].x, lawnPts[0].z)?.kind, 12, 'L8 Blackstone east front lawn is kind 12');
    const lawnRes = driveLine(lawnPts);
    assert.ok(lawnRes.count >= 20 && lawnRes.lawns === 1, `L8 Blackstone mown lawn leaves ruts (${lawnRes.count} strips, ${lawnRes.lawns} lawns)`);
    assert.deepEqual(lawnRes.hits, [BLACKSTONE_BUILDING], 'L8 Blackstone mown lawn attributes damage to house 1454');
    // Dry ground inside a wide waterLevel site bounding box (null, well below ground, or pointwise 5 cm below the
    // 0.6*exag wet cutoff at each queried point) spends zero extra surfaceAt calls and stays bounded in waterLevel calls.
    for (const [label, waterLevelFn] of [
      ['null waterLevel', () => null],
      ['below-ground waterLevel', () => site.level - 5],
      ['pointwise near-threshold dry waterLevel', (x, z) => (siteTerrain.heightAt(x, z) - 0.6 * 2.5 - 0.05) / 2.5],
    ]) {
      let waterLevelCalls = 0, surfaceCalls = 0;
      const dryWaterSite = {
        box: [Math.min(...lawnPts.map((p) => p.x)) - 20, Math.min(...lawnPts.map((p) => p.z)) - 20,
              Math.max(...lawnPts.map((p) => p.x)) + 20, Math.max(...lawnPts.map((p) => p.z)) + 20],
        samplesTerrain: false,
        height: (_x, _z, raw) => raw,
        surface: () => null,
        waterLevel: (...args) => { waterLevelCalls++; return waterLevelFn(...args); },
      };
      siteTerrain.sites.push(dryWaterSite);
      const origSurfaceAt = siteTerrain.surfaceAt.bind(siteTerrain);
      siteTerrain.surfaceAt = (...args) => { surfaceCalls++; return origSurfaceAt(...args); };
      try {
        const dryRes = driveLine(lawnPts);
        assert.equal(dryRes.count, lawnRes.count, `wide dry water-site bbox (${label}) leaves strip count unchanged`);
        assert.ok(surfaceCalls < 10000, `wide dry water-site bbox (${label}) keeps surfaceAt bounded (${surfaceCalls} < 10000)`);
        assert.ok(waterLevelCalls < 20000, `wide dry water-site bbox (${label}) keeps waterLevel bounded (${waterLevelCalls} < 20000)`);
      } finally {
        siteTerrain.surfaceAt = origSurfaceAt;
        siteTerrain.sites.pop();
      }
    }
    const farIslandPts = Array.from({ length: 12 }, (_, i) => site.world(36 + i * 0.7, -11.5));
    assert.equal(siteTerrain.surfaceAt(farIslandPts[0].x, farIslandPts[0].z)?.kind, 12, 'L8 far east lawn island is kind 12');
    const farIslandRes = driveLine(farIslandPts);
    assert.ok(farIslandRes.count >= 10 && farIslandRes.lawns === 1, `L8 far east lawn island (>35 m) leaves ruts (${farIslandRes.count} strips)`);
    assert.deepEqual(farIslandRes.hits, [BLACKSTONE_BUILDING]);
    // Mixed-surface edge crossing (u=14.3, v=-15.1..-12.3): centre on kind-12 lawn, one tyre on kind-8 gravel driveway.
    const edgePts = Array.from({ length: 8 }, (_, i) => site.world(14.3, -15.1 + i * 0.4));
    const edgeHdg = site.heading(0, 1), edgeRx = Math.cos(edgeHdg), edgeRz = Math.sin(edgeHdg);
    let sawGravelWheel = false, sawLawnWheel = false;
    for (const p of edgePts) {
      assert.equal(siteTerrain.surfaceAt(p.x, p.z)?.kind, 12, 'mixed-edge car centre stays on kind-12 mown lawn');
      for (const side of [-1, 1]) {
        const wk = siteTerrain.surfaceAt(p.x + edgeRx * 0.785 * side, p.z + edgeRz * 0.785 * side)?.kind;
        if (wk === 8) sawGravelWheel = true;
        if (wk === 12) sawLawnWheel = true;
      }
    }
    assert.ok(sawGravelWheel && sawLawnWheel, 'mixed-edge crossing puts one wheel on kind-8 gravel and one on kind-12 lawn');
    const ox8 = manifest.origin[0] - manifest.village[0], oz8 = manifest.village[1] - manifest.origin[1];
    const mpp8 = manifest.size / (2 ** 8 * 256);
    // Exact convex polygon intersection between a rendered strip quad (XZ projection) and an axis-aligned L8 texel.
    const quadHitsBox = (quad, x0, z0, x1, z1) => {
      let poly = quad;
      for (const fn of [
        (p) => x0 - p[0], (p) => p[0] - x1, (p) => z0 - p[1], (p) => p[1] - z1,
      ]) {
        const next = [];
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length], da = fn(a), db = fn(b);
          if (da <= 0) next.push(a);
          if ((da <= 0) !== (db <= 0)) {
            const t = da / (da - db);
            next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        poly = next;
        if (!poly.length) return false;
      }
      let area = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        area += a[0] * b[1] - b[0] * a[1];
      }
      return Math.abs(area) * 0.5 > 1e-10;
    };
    const assertStripsOnLawn = (res, label) => {
      const stripM4 = new THREE.Matrix4(), corner = new THREE.Vector3(), scale = new THREE.Vector3();
      const lengths = [];
      for (let i = 0; i < res.count; i++) {
        res.mesh.getMatrixAt(i, stripM4);
        scale.setFromMatrixScale(stripM4);
        lengths.push(scale.z);
        const quad = [[-0.12, -0.5], [0.12, -0.5], [0.12, 0.5], [-0.12, 0.5]].map(([lx, lz]) => {
          corner.set(lx, 0, lz).applyMatrix4(stripM4);
          return [corner.x, corner.z];
        });
        const minX = Math.min(...quad.map((p) => p[0])), maxX = Math.max(...quad.map((p) => p[0]));
        const minZ = Math.min(...quad.map((p) => p[1])), maxZ = Math.max(...quad.map((p) => p[1]));
        const kx0 = Math.floor((minX - ox8) / mpp8 + 0.5), kx1 = Math.floor((maxX - ox8) / mpp8 + 0.5);
        const kz0 = Math.floor((minZ - oz8) / mpp8 + 0.5), kz1 = Math.floor((maxZ - oz8) / mpp8 + 0.5);
        for (let kx = kx0; kx <= kx1; kx++) for (let kz = kz0; kz <= kz1; kz++) {
          const cx = ox8 + kx * mpp8, cz = oz8 + kz * mpp8;
          if (!quadHitsBox(quad, cx - mpp8 / 2, cz - mpp8 / 2, cx + mpp8 / 2, cz + mpp8 / 2)) continue;
          const surf = siteTerrain.surfaceAt(cx, cz);
          assert.ok(surf, `${label} strip ${i} texel (${kx},${kz}) has surface`);
          assert.notEqual(surf.kind, 8, `${label} strip ${i} never intersects gravel texel (${kx},${kz})`);
          assert.ok(surf.kind === 12 || surf.kind === 0 || surf.roadDist > surf.halfWidth,
            `${label} strip ${i} never intersects road carriageway texel (${kx},${kz}) kind=${surf.kind} dist=${surf.roadDist}`);
        }
        for (let step = 0; step <= 40; step++) {
          const lz = -0.5 + step * 0.025;
          for (const lx of [-0.12, -0.06, 0, 0.06, 0.12]) {
            corner.set(lx, 0, lz).applyMatrix4(stripM4);
            const surf = siteTerrain.surfaceAt(corner.x, corner.z);
            assert.ok(surf && isLawnSurface(surf, false), `${label} strip ${i} point (${lx},${lz}) lands on lawn (kind=${surf?.kind})`);
          }
        }
      }
      return lengths;
    };
    const edgeRes = driveLine(edgePts);
    assert.ok(edgeRes.count > 0, `mixed-edge crossing draws lawn-side strips (${edgeRes.count})`);
    assertStripsOnLawn(edgeRes, 'mixed-edge');
    // Intermediate gravel protrusions, sub-millimetre corner grazes, pitched/rolled corner overlaps, and canopy edges: clipped cleanly.
    for (const [tag, u0, v0, u1, v1] of [
      ['protrusion', 15.15, -14.30, 15.15, -13.50],
      ['corner-graze', 15.22, -14.29, 15.22, -13.49],
      ['submm-corner', 14.15274690, -17.69250120, 13.84016200, -16.95609732],
      ['pitch-roll-corner', 14.74949067, -15.56064423, 14.00820762, -15.25981297],
      ['canopy-edge', -9.37598627, 12.32986155, -8.71133763, 11.88461759],
    ]) {
      const res = driveLine([site.world(u0, v0), site.world(u1, v1)]);
      assert.ok(res.count > 0, `${tag} crossing draws strips (${res.count})`);
      const lens = assertStripsOnLawn(res, tag);
      assert.ok(lens.some((len) => len < 0.949), `${tag} strip is longitudinally clipped (${lens.map((l) => l.toFixed(4)).join(',')})`);
    }
    // 0.8 m step ending at (u=14.40, v=-12.75): requires a shortened strip on the gravel-side wheel rather than full 0.95 m.
    const clippedRes = driveLine([site.world(14.40, -13.55), site.world(14.40, -12.75)]);
    assert.ok(clippedRes.count >= 2, `clipped edge step draws both wheels (${clippedRes.count})`);
    const clippedLengths = assertStripsOnLawn(clippedRes, 'clipped-end');
    assert.ok(clippedLengths.some((len) => len < 0.5), `clipped edge step shortens strip at gravel boundary (${clippedLengths.map((l) => l.toFixed(3)).join(',')})`);
    const drivePts = Array.from({ length: 16 }, (_, i) => site.world(-6 + i * 0.8, -13.0));
    assert.equal(siteTerrain.surfaceAt(drivePts[8].x, drivePts[8].z)?.kind, 8, 'L8 Blackstone front driveway is kind 8 gravel');
    const driveRes = driveLine(drivePts);
    assert.equal(driveRes.count, 0, 'L8 Blackstone gravel driveway leaves no ruts');
    assert.equal(driveRes.lawns, 0, 'L8 Blackstone gravel driveway triggers no lawn damage');
    // Nearby Blackstone Road control: every point is within 28 m of house 1454 (inside the 35 m lawn radius).
    const roadPts = roadSamples
      .filter((pt) => pt.roadName === 'Blackstone Road' && pt.side === 0 && Math.hypot(pt.x - site.origin.x, pt.z - site.origin.z) <= 28)
      .slice(0, 20);
    assert.ok(roadPts.length >= 15, `nearby Blackstone Road samples within 28 m of house 1454 (${roadPts.length})`);
    for (const pt of roadPts) {
      const rs = siteTerrain.surfaceAt(pt.x, pt.z);
      assert.ok(rs && rs.kind === 3 && rs.roadDist <= rs.halfWidth + 0.6, `nearby road point is gravel road (kind=${rs?.kind}, dist=${rs?.roadDist})`);
    }
    const roadRes = driveLine(roadPts);
    assert.equal(roadRes.count, 0, 'L8 Blackstone Road within 28 m of house leaves no ruts');
    assert.equal(roadRes.lawns, 0, 'L8 Blackstone Road within 28 m of house triggers no lawn damage');
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
    const h = new BlackstoneHouse(site, realTerrain, (m) => m * exag, isLow);
    // Consistent collision solids before first L8 build (matches post-build hidden state and drone roof boxes).
    const preW = site.world(-2, 0), preCar = { x: preW.x, z: preW.z, vx: 0, vz: 0, speed: 0, heading: 0 };
    h.resolveSolids(preCar);
    const prePush = Math.hypot(preCar.x - preW.x, preCar.z - preW.z);
    assert.ok(prePush > 2.5, `exag=${exag} low=${isLow}: solids active before L8 build (${prePush.toFixed(2)} m)`);
    // Cold LOW visit at 850 m with L7 drawn and pending=0 must NOT hang waiting=true.
    h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + 850), 0, { x: site.origin.x, z: site.origin.z + 850 });
    assert.equal(h.group.visible, false, `L7 850 m exag=${exag} low=${isLow}: stays hidden until L8 is drawn`);
    assert.equal(h.waiting, false, `L7 850 m exag=${exag} low=${isLow}: waiting=false when pending=0 and L8 not drawn`);
    // While L8 is actively loading (pending > 0), waiting=true.
    pending = 2;
    assert.equal(h.waiting, true, `exag=${exag} low=${isLow}: waiting=true while near and terrain.pending > 0`);
    pending = 0;
    // Once L8 is drawn, build and verify parcel box, detached outbuildings, front west window sill and drone roof floor.
    drawn = 8; cached = 8;
    h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(h.group.visible, true, `L8 exag=${exag} low=${isLow}: visible once L8 is drawn`);
    assert.equal(h.waiting, false, `L8 exag=${exag} low=${isLow}: waiting=false once built`);
    const mesh = h.group.children[0].children[0], firstGeo = mesh.geometry, pos = firstGeo.getAttribute('position');
    assert.ok(pos.count > 9000, `L8 exag=${exag} low=${isLow}: geometry built (${pos.count / 3} tris)`);
    const pbW = site.world(PARCEL_BOX.u, PARCEL_BOX.v), pbGround = L8.meshY(pbW.x, pbW.z);
    let pbLo = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
      if (Math.abs(u - PARCEL_BOX.u) <= 0.6 && Math.abs(v - PARCEL_BOX.v) <= 0.5 && y < pbLo) pbLo = y;
    }
    assert.ok(Math.abs(pbLo - pbGround) < 0.03,
      `L8 parcel box exag=${exag} low=${isLow}: base matches drawn ground (${(pbLo - pbGround).toFixed(3)} m)`);
    const fw = site.world(-3.5, -4.1);
    assert.ok(L8.meshY(fw.x, fw.z) < site.level * exag + 1.1,
      `L8 front west window sill clear of drawn mesh (${(L8.meshY(fw.x, fw.z) - site.level * exag).toFixed(2)} m)`);
    for (const [tag, box] of [['west-shed', WEST_SHED], ['east-barn', EAST_BARN]]) {
      const cu = (box.u0 + box.u1) / 2, cv = (box.v0 + box.v1) / 2, gw = site.world(cu, cv);
      const groundY = L8.meshY(gw.x, gw.z);
      let loY = Infinity, hiY = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
        if (u >= box.u0 - 0.5 && u <= box.u1 + 0.5 && v >= box.v0 - 0.5 && v <= box.v1 + 0.5) {
          if (y < loY) loY = y;
          if (y > hiY) hiY = y;
        }
      }
      assert.ok(loY < groundY - 0.2, `L8 ${tag} exag=${exag} low=${isLow}: foundation buried (${(loY - groundY).toFixed(2)} m)`);
      assert.ok(hiY > groundY + box.eave, `L8 ${tag} exag=${exag} low=${isLow}: roof above ground (${(hiY - groundY).toFixed(2)} m)`);
    }
    if (!isLow) {
      const ownRoofAt = roofHeights(site.roofBoxes(), manifest.village, exag, 0);
      const structures = [
        ['nw-wing', NW_WING.u0, NW_WING.u1, -NW_WING.half, NW_WING.half, site.level * exag + NW_WING.ridge + 0.5],
        ['west-shed', WEST_SHED.u0, WEST_SHED.u1, WEST_SHED.v0, WEST_SHED.v1, L8.meshY(...Object.values(site.world(-18, -8.5))) + WEST_SHED.ridge + 0.5],
        ['east-barn', EAST_BARN.u0, EAST_BARN.u1, EAST_BARN.v0, EAST_BARN.v1, L8.meshY(...Object.values(site.world(43.5, 4.0))) + EAST_BARN.ridge + 0.5],
        ['hoop-west', HOOP_WEST.u0, HOOP_WEST.u1, HOOP_WEST.v0, HOOP_WEST.v1, L8.meshY(...Object.values(site.world(35.3, 5.2))) + HOOP_WEST.ridge + 0.5],
        ['hoop-east', HOOP_EAST.u0, HOOP_EAST.u1, HOOP_EAST.v0, HOOP_EAST.v1, L8.meshY(...Object.values(site.world(49.5, 3.5))) + HOOP_EAST.ridge + 0.5],
      ];
      for (const [tag, u0, u1, v0, v1, ceiling] of structures) {
        let builtPeak = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
          if (u >= u0 - 0.3 && u <= u1 + 0.3 && v >= v0 - 0.3 && v <= v1 + 0.3 && y <= ceiling && y > builtPeak) builtPeak = y;
        }
        const w = site.world((u0 + u1) / 2, (v0 + v1) / 2), floorY = ownRoofAt(w.x, w.z);
        assert.ok(floorY >= builtPeak - 0.15 && floorY <= builtPeak + 0.45,
          `${tag} exag=${exag}: drone roof floor ${floorY.toFixed(2)} matches built peak ${builtPeak.toFixed(2)}`);
      }
      const openLawnW = site.world(24, -10);
      assert.equal(ownRoofAt(openLawnW.x, openLawnW.z), -Infinity, `exag=${exag}: open east lawn has no phantom roof floor`);
    }
    // Dropping back to L7, L6, or null (even with L8 still cached) hides the house cleanly; returning to the SAME L8
    // retains the existing mesh geometry without rebuilding, and hidden collision matches pre-build collision.
    for (const [label, lvl, dist] of [['L7 with L8 cached', 7, 1180], ['L6 at 1590 m', 6, 1590], ['null drawn with L8 cached', null, 100]]) {
      drawn = lvl; cached = 8;
      h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + dist), 0, { x: site.origin.x, z: site.origin.z + dist });
      assert.equal(h.group.visible, false, `exag=${exag} low=${isLow}: hides on ${label}`);
    }
    const hidCar = { x: preW.x, z: preW.z, vx: 0, vz: 0, speed: 0, heading: 0 };
    h.resolveSolids(hidCar);
    assert.equal(Math.hypot(hidCar.x - preW.x, hidCar.z - preW.z), prePush, `exag=${exag} low=${isLow}: hidden collision matches pre-build`);
    drawn = 8; cached = 8;
    h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
    assert.equal(h.group.visible, true, `exag=${exag} low=${isLow}: returns cleanly when L8 is drawn again`);
    assert.equal(h.group.children[0].children[0].geometry, firstGeo, `exag=${exag} low=${isLow}: retains geometry across L8 -> null -> same L8`);
  }
}

// Frame order & tree-only clear boxes: main.ts must update BlackstoneHouse in landscape after terrain (including ending/replay frames).
const terrainIdx = mainSrc.indexOf("name: 'terrain', segment: 'landscape'");
const bsIdx = mainSrc.indexOf("name: 'blackstone', segment: 'landscape', ending: true");
assert.ok(terrainIdx >= 0 && bsIdx > terrainIdx, 'main.ts updates blackstone in landscape (ending: true) after terrain selection');
assert.ok(mainSrc.includes("name !== 'blackstone'"), 'main.ts excludes blackstone from before-camera places loop');
assert.ok(mainSrc.includes('blackstoneSite.clear) terrain.addTreeClear'), 'main.ts registers blackstone clear boxes as tree-only so coarse terrain stays untouched');

console.log(`PASS blackstone: desktop ${desktop.triangles} tris, LOW ${low.triangles} tris, production Terrain L5-L8 meshHeightAt & surfaceAt bit-for-bit untouched, Props.hitCar & solids clear (car/truck/sxs), no L7 loading hang, geometry retained across visibility toggles, ending: true frame order`);
