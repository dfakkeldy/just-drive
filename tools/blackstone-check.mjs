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
import { roofHeights } from '../web/src/drone.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { paintSiteSurface } from '../web/src/terrain.ts';
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
  drawnLevelAt: () => null,
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

// Every Blackstone Road and Smithville Road centre and carriageway-edge point stays clear of all solids AND the
// relocated mailbox (Props.hitCar sweep envelope) for car, pickup truck and SXS in both travel directions.
const [mbMapX, mbMapY] = site.map(MAILBOX_UV[0], MAILBOX_UV[1]);
const mbWorldX = mbMapX - manifest.village[0], mbWorldZ = manifest.village[1] - mbMapY;
for (const pt of roadSamples) {
  for (const dir of [0, Math.PI]) {
    const hdg = pt.heading + dir;
    const car = { x: pt.x, z: pt.z, vx: 0, vz: 0, speed: 0, heading: hdg };
    desktop.resolveSolids(car);
    assert.equal(Math.hypot(car.x - pt.x, car.z - pt.z), 0,
      `no solid reaches ${pt.roadName} (side=${pt.side.toFixed(1)} m) at (${pt.x.toFixed(1)}, ${pt.z.toFixed(1)})`);
    const rx = Math.cos(hdg), rz = Math.sin(hdg);
    const px = mbWorldX - pt.x, pz = mbWorldZ - pt.z;
    for (const [label, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['sxs', SXS_SPEC]]) {
      const hit = Math.abs(px * rx + pz * rz) <= spec.envelope.sweepHalfWidth
        && Math.abs(px * rz - pz * rx) <= spec.envelope.sweepHalfLength;
      assert.ok(!hit, `${label} hits relocated mailbox from ${pt.roadName} (side=${pt.side.toFixed(1)} m)`);
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

// Verify zero production mesh height (ground + averaged canopy hull) or 4-texel bilinear surfaceAt() road changes
// along Blackstone Road and Smithville Road across L5, L6, L7, L8.
const dScale = manifest.roads.encoding.distance, wScale = manifest.roads.encoding.halfWidth, zero = 128;
const cs = manifest.canopy.scale, hasTrees = new Set(manifest.trees?.tiles ?? []);
const smoothstep = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
for (const level of [5, 6, 7, 8]) {
  const tileSize = manifest.size / 2 ** level, seg = 128, step = 256 / seg, mpp = tileSize / 256;
  const active = mpp <= site.maxTexel, win = Math.max(2, Math.round(6 / Math.max(mpp, 1))), stride = Math.max(1, Math.round(win / 2));
  const { scale, offset } = manifest.height;
  const tileCache = new Map();
  const buildTile = (ti, tj) => {
    const key = `${ti}_${tj}`;
    if (tileCache.has(key)) return tileCache.get(key);
    const png = decodePng(readFileSync(`${AREA}${level}/${key}.png`));
    const rpng = decodePng(readFileSync(`${AREA}${level}/${key}.r.png`));
    const S = png.w, T = S - 1, x0 = manifest.origin[0] + ti * tileSize - manifest.village[0], z0 = manifest.village[1] - (manifest.origin[1] - tj * tileSize);
    const hull = !(level === 8 && hasTrees.has(key));
    const buildSide = (withSite) => {
      const road = new Uint8ClampedArray(S * S * 4), ground = new Float32Array(S * S), canopy = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        road[i * 4] = rpng.data[i * rpng.bpp];
        road[i * 4 + 1] = rpng.data[i * rpng.bpp + 1];
        road[i * 4 + 2] = rpng.data[i * rpng.bpp + 2];
        road[i * 4 + 3] = rpng.bpp === 4 ? rpng.data[i * 4 + 3] : 255;
      }
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const k = py * S + px, x = x0 + px * mpp, z = z0 + py * mpp;
        let raw = offset + (png.data[k * 3] * 256 + png.data[k * 3 + 1]) * scale;
        if (withSite && active && x >= site.box[0] && x <= site.box[2] && z >= site.box[1] && z <= site.box[3]) {
          raw = site.height(x, z, raw);
          const f = site.surface(x, z, raw, level);
          if (f) paintSiteSurface(road, k * 4, f, zero, dScale, wScale);
        }
        ground[k] = raw * 2.5;
        let c = png.data[k * 3 + 2] * cs;
        if (road[k * 4 + 2] > 0) {
          const d = Math.abs(road[k * 4] - zero) * dScale, hw = road[k * 4 + 1] * wScale;
          c *= smoothstep(hw + 0.8, hw + 4.5, d);
        }
        if (withSite && active && x >= site.box[0] && x <= site.box[2] && z >= site.box[1] && z <= site.box[3] && site.clearCanopy(x, z, level)) c = 0;
        canopy[k] = c;
      }
      const gridY = (a, b) => {
        const ga = a * step, gb = b * step, k0 = gb * S + ga;
        let c = 0;
        if (hull) {
          let cnt = 0;
          for (let vv = -win; vv <= win; vv += stride) {
            const bb = gb + vv; if (bb < 0 || bb > T) continue;
            for (let uu = -win; uu <= win; uu += stride) {
              const aa = ga + uu; if (aa >= 0 && aa <= T) { c += canopy[bb * S + aa]; cnt++; }
            }
          }
          c /= cnt;
          if (road[k0 * 4 + 2] > 0) {
            const hw = road[k0 * 4 + 1] * wScale;
            c *= smoothstep(hw + 0.8, hw + 6, Math.abs(road[k0 * 4] - zero) * dScale);
          }
        }
        return ground[k0] + c;
      };
      const meshY = (x, z) => {
        const fa = ((x - x0) / tileSize) * seg, fb = ((z - z0) / tileSize) * seg;
        const a = Math.max(0, Math.min(Math.floor(fa), seg - 1)), b = Math.max(0, Math.min(Math.floor(fb), seg - 1));
        const fu = fa - a, fv = fb - b;
        const h00 = gridY(a, b), h10 = gridY(a + 1, b), h01 = gridY(a, b + 1), h11 = gridY(a + 1, b + 1);
        return fu + fv <= 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
      };
      const roadSample = (x, z) => {
        const fa = ((x - x0) / tileSize) * T, fb = ((z - z0) / tileSize) * T;
        const a = Math.max(0, Math.min(Math.floor(fa), T - 1)), b = Math.max(0, Math.min(Math.floor(fb), T - 1));
        const u = fa - a, v = fb - b, k = (Math.min(Math.round(fb), T) * S + Math.min(Math.round(fa), T)) * 4, k00 = (b * S + a) * 4;
        const whole = road[k00 + 2] > 0 && road[k00 + 6] > 0 && road[k00 + S * 4 + 2] > 0 && road[k00 + S * 4 + 6] > 0;
        const distByte = whole
          ? (road[k00] * (1 - u) + road[k00 + 4] * u) * (1 - v) + (road[k00 + S * 4] * (1 - u) + road[k00 + S * 4 + 4] * u) * v
          : road[k];
        return { kind: road[k + 2] & 15, halfWidth: road[k + 1] * wScale, roadDist: Math.abs(distByte - zero) * dScale };
      };
      return { meshY, roadSample };
    };
    const res = { base: buildSide(false), site: buildSide(true) };
    tileCache.set(key, res);
    return res;
  };
  for (const pt of roadSamples) {
    const ti = Math.floor((pt.x + manifest.village[0] - manifest.origin[0]) / tileSize);
    const tj = Math.floor((manifest.origin[1] - (manifest.village[1] - pt.z)) / tileSize);
    const { base, site: withSite } = buildTile(ti, tj);
    const dy = Math.abs(withSite.meshY(pt.x, pt.z) - base.meshY(pt.x, pt.z));
    assert.ok(dy < 1e-6, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) production mesh height unchanged (dy=${dy.toFixed(4)} m)`);
    const rb = base.roadSample(pt.x, pt.z), rs = withSite.roadSample(pt.x, pt.z);
    assert.equal(rs.kind, rb.kind, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) surfaceAt kind unchanged`);
    assert.equal(rs.halfWidth, rb.halfWidth, `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) surfaceAt halfWidth unchanged`);
    assert.ok(Math.abs(rs.roadDist - rb.roadDist) < 1e-6,
      `L${level} ${pt.roadName} (side=${pt.side.toFixed(1)} m) surfaceAt roadDist unchanged (${rb.roadDist.toFixed(3)} -> ${rs.roadDist.toFixed(3)})`);
  }
}

for (const exag of [2.5, 3]) {
  const L7 = loadLevel(7, exag), L8 = loadLevel(8, exag);
  for (const isLow of [false, true]) {
    let drawn = 7, heightSource = L7;
    const realTerrain = {
      heightAt: (x, z) => heightSource.heightAt(x, z),
      meshHeightAt: (x, z, drawnOnly) => (drawnOnly ? (drawn === 8 ? L8 : L7) : heightSource).meshY(x, z),
      drawnLevelAt: () => drawn,
      levelAt: () => (heightSource === L8 ? 8 : 7),
    };
    const h = new BlackstoneHouse(site, realTerrain, (m) => m * exag, isLow);
    const checkGrounded = (label, drawnTile, dist = 0) => {
      h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + dist), 0, { x: site.origin.x, z: site.origin.z + dist });
      const mesh = h.group.children[0].children[0], pos = mesh.geometry.getAttribute('position');
      assert.ok(pos.count > 9000, `${label} exag=${exag} low=${isLow}: geometry rebuilt (${pos.count / 3} tris)`);
      // Parcel box base sits directly on the drawn triangle (catches stale cached L8 height or missed LOD rebuild).
      const pbW = site.world(PARCEL_BOX.u, PARCEL_BOX.v), pbGround = drawnTile.meshY(pbW.x, pbW.z);
      let pbLo = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
        if (Math.abs(u - PARCEL_BOX.u) <= 0.6 && Math.abs(v - PARCEL_BOX.v) <= 0.5 && y < pbLo) pbLo = y;
      }
      assert.ok(Math.abs(pbLo - pbGround) < 0.03,
        `${label} parcel box exag=${exag} low=${isLow}: base matches drawn ground (${(pbLo - pbGround).toFixed(3)} m)`);
      // Detached outbuildings sit buried into the drawn ground with roofs above.
      for (const [tag, box] of [['west-shed', WEST_SHED], ['east-barn', EAST_BARN]]) {
        const cu = (box.u0 + box.u1) / 2, cv = (box.v0 + box.v1) / 2, gw = site.world(cu, cv);
        const groundY = drawnTile.meshY(gw.x, gw.z);
        let loY = Infinity, hiY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i), y = pos.getY(i), v = pos.getZ(i);
          if (u >= box.u0 - 0.5 && u <= box.u1 + 0.5 && v >= box.v0 - 0.5 && v <= box.v1 + 0.5) {
            if (y < loY) loY = y;
            if (y > hiY) hiY = y;
          }
        }
        assert.ok(loY < groundY - 0.2, `${label} ${tag} exag=${exag} low=${isLow}: foundation buried (${(loY - groundY).toFixed(2)} m)`);
        assert.ok(hiY > groundY + box.eave, `${label} ${tag} exag=${exag} low=${isLow}: roof above ground (${(hiY - groundY).toFixed(2)} m)`);
      }
      // On L8 desktop, check drone roof floor matches actual built roof peaks for house and detached structures.
      if (drawn === 8 && !isLow) {
        const ownRoofAt = roofHeights(site.roofBoxes(), manifest.village, exag, 0);
        const structures = [
          ['nw-wing', NW_WING.u0, NW_WING.u1, -NW_WING.half, NW_WING.half, site.level * exag + NW_WING.ridge + 0.5],
          ['west-shed', WEST_SHED.u0, WEST_SHED.u1, WEST_SHED.v0, WEST_SHED.v1, drawnTile.meshY(...Object.values(site.world(-18, -8.5))) + WEST_SHED.ridge + 0.5],
          ['east-barn', EAST_BARN.u0, EAST_BARN.u1, EAST_BARN.v0, EAST_BARN.v1, drawnTile.meshY(...Object.values(site.world(43.5, 4.0))) + EAST_BARN.ridge + 0.5],
          ['hoop-west', HOOP_WEST.u0, HOOP_WEST.u1, HOOP_WEST.v0, HOOP_WEST.v1, drawnTile.meshY(...Object.values(site.world(35.3, 5.2))) + HOOP_WEST.ridge + 0.5],
          ['hoop-east', HOOP_EAST.u0, HOOP_EAST.u1, HOOP_EAST.v0, HOOP_EAST.v1, drawnTile.meshY(...Object.values(site.world(49.5, 3.5))) + HOOP_EAST.ridge + 0.5],
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
    };
    drawn = 7; heightSource = L7; checkGrounded('L7 initial', L7, 0);
    drawn = 8; heightSource = L8; checkGrounded('L8 fine', L8, 0);
    drawn = 7; heightSource = L8; checkGrounded('L7 drawn with L8 cached at 1180 m', L7, 1180);
    drawn = 7; heightSource = L7; checkGrounded('L7 after L8 eviction', L7, 0);
    // When visible terrain drops below L7 (e.g. LOW at 1590 m on L6), the house hides instead of keeping stale L7 grounding.
    drawn = 6; heightSource = L7;
    h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + 1590), 0, { x: site.origin.x, z: site.origin.z + 1590 });
    assert.equal(h.group.visible, false, `exag=${exag} low=${isLow}: hides cleanly when drawn terrain drops below L7`);
  }
}

// Frame order & tree-only clear boxes: main.ts must update BlackstoneHouse in landscape after terrain and add clear boxes via addTreeClear.
const mainSrc = readFileSync('web/src/main.ts', 'utf8');
const terrainIdx = mainSrc.indexOf("name: 'terrain', segment: 'landscape'");
const bsIdx = mainSrc.indexOf("name: 'blackstone', segment: 'landscape'");
assert.ok(terrainIdx >= 0 && bsIdx > terrainIdx, 'main.ts updates blackstone in landscape after terrain selection');
assert.ok(mainSrc.includes("name !== 'blackstone'"), 'main.ts excludes blackstone from before-camera places loop');
assert.ok(mainSrc.includes('blackstoneSite.clear) terrain.addTreeClear'), 'main.ts registers blackstone clear boxes as tree-only so coarse terrain stays untouched');

console.log(`PASS blackstone: desktop ${desktop.triangles} tris, LOW ${low.triangles} tris, L5-L8 production hull & bilinear road surfaceAt untouched, road-edge solids & mailbox sweep clear (car/truck/sxs), rear SE deck collider, 7->8->7->6 grounding & roof floor (2.5x & 3x)`);
