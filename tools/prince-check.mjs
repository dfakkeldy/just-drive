// Node check for a house on Prince Street, Port Hawkesbury (web/src/prince-site.ts, web/src/prince-house.ts):
//   1. PrinceSite.find matches the surveyed box in Point Tupper and refuses a moved or resized box;
//   2. site pad, driveway, mown lawn, tree-clear strips and service drop re-aiming agree with the baked land and keep off Prince Street;
//   3. PrinceHouse builds finite geometry on desktop and LOW (LOW simpler), stops a car at the walls/carport posts/shed/hedges,
//      and keeps the driveway and carport parking bay open for a car.
// node tools/run-node-check.mjs tools/prince-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { roofHeights } from '../web/src/drone.ts';
import { CARPORT, MAIN, PrinceHouse, REAR, SHED } from '../web/src/prince-house.ts';
import { PRINCE_BUILDING, PrinceSite } from '../web/src/prince-site.ts';

const AREA = 'data/baked/areas/pointtupper/';
const manifest = JSON.parse(readFileSync(`${AREA}manifest.json`, 'utf8'));
const buildings = JSON.parse(readFileSync(`${AREA}buildings.json`, 'utf8')).buildings;
const roads = JSON.parse(readFileSync(`${AREA}roads.json`, 'utf8')).roads;
const props = JSON.parse(readFileSync(`${AREA}props.json`, 'utf8'));

// 1. Site lookup against the baked Point Tupper catalog.
const found = PrinceSite.find(buildings);
assert.ok(found && found.id === PRINCE_BUILDING, 'PrinceSite.find finds the surveyed box in Point Tupper');
assert.equal(PrinceSite.find([{ ...found, length: found.length + 2 }]), null, 'a resized box is ignored');
assert.equal(PrinceSite.find([{ ...found, axisDeg: found.axisDeg + 15 }]), null, 'a turned box is ignored');
assert.equal(PrinceSite.find([{ ...found, x: found.x + 500 }]), null, 'a moved box is ignored');

const site = new PrinceSite(found, manifest.village);
assert.equal(site.preserveRoads, true, 'Prince Street keeps its height and asphalt');
assert.ok(site.clear.length >= 6, `tree-clear strips generated (${site.clear.length})`);

// 2. Pad, driveway, lawn and road clearance.
const padW = site.world(0, 0);
assert.equal(site.height(padW.x, padW.z, 36.2), site.level, 'house pad is level at building.ground');
const farW = site.world(0, -21);
assert.equal(site.height(farW.x, farW.z, 34.8), 34.8, 'Prince Street is outside the pad blend');
const drvW = site.world(5.0, -10.0);
assert.equal(site.surface(drvW.x, drvW.z)?.kind, 8, 'driveway paints as weathered gravel/stone');
const lawnW = site.world(-3.0, -10.0);
assert.equal(site.surface(lawnW.x, lawnW.z)?.kind, 12, 'front yard paints as mown lawn');

// Service drop for this house re-aims onto the SE gable wall (u = +1.5) below the roof rake.
const aimed = site.aimDrops(props.serviceDrops);
const drop = aimed.find((d) => d.building === PRINCE_BUILDING);
assert.ok(drop, 'service drop for the house exists');
const dropUV = site.local(drop.x - manifest.village[0], manifest.village[1] - drop.y);
assert.ok(Math.abs(dropUV.u - MAIN.u1) < 0.05 && dropUV.v > -MAIN.half && dropUV.v < MAIN.half, `drop lands on SE gable (${JSON.stringify(dropUV)})`);
assert.ok(drop.height > CARPORT.eave + 1 && drop.height < MAIN.eave, `drop height ${drop.height} fits upper SE wall`);

// Combined drone flight floor (surveyed boxes excluding the replaced box, plus authored roofBoxes):
// covers rear wing, shed and chimney, and drops to the carport height over the carport and -Infinity behind it.
const boxRoofAt = roofHeights(buildings.filter((b) => b !== found), manifest.village, 2.5, 0);
const ownRoofAt = roofHeights(site.roofBoxes(), manifest.village, 2.5, 0);
const roofAt = (x, z) => Math.max(boxRoofAt(x, z), ownRoofAt(x, z));
const padLift = site.level * 2.5;
const rearEdgeW = site.world(-3, REAR.v1 - 0.1);
assert.ok(roofAt(rearEdgeW.x, rearEdgeW.z) >= padLift + REAR.top, 'drone roof floor covers rear wing edge');
const shedRidgeW = site.world((SHED.u0 + SHED.u1) / 2, (SHED.v0 + SHED.v1) / 2);
assert.ok(roofAt(shedRidgeW.x, shedRidgeW.z) >= padLift + SHED.ridge + 0.14, 'drone roof floor covers backyard shed ridge');
const chimW = site.world(MAIN.u0 - 0.3, -1.1);
assert.ok(roofAt(chimW.x, chimW.z) >= padLift + 8.55, 'drone roof floor covers chimney');
const carportW = site.world(5.1, -2.0);
assert.ok(Math.abs(roofAt(carportW.x, carportW.z) - (padLift + 4.14)) < 0.05, `drone roof floor over carport is carport height, not old survey box (${roofAt(carportW.x, carportW.z) - padLift})`);
const behindCarportW = site.world(5.0, 5.9);
assert.equal(roofAt(behindCarportW.x, behindCarportW.z), -Infinity, 'open space behind carport has no phantom survey roof floor');

// 3. Build PrinceHouse on desktop and LOW against a flat stand-in terrain.
const terrain = {
  heightAt: () => site.level,
  surfaceAt: () => ({ level: 8 }),
};
const build = (low) => {
  const house = new PrinceHouse(site, terrain, (m) => m, low);
  house.update(new THREE.Vector3(site.origin.x, site.level, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
  assert.ok(!house.waiting && house.group.visible && house.triangles > 0, `built (low=${low})`);
  return house;
};
const desktop = build(false), low = build(true);
assert.ok(desktop.triangles >= 2000 && desktop.triangles <= 12000, `desktop triangles ${desktop.triangles} in range`);
assert.ok(low.triangles < desktop.triangles * 0.75, `LOW (${low.triangles}) is simpler than desktop (${desktop.triangles})`);

// Every vertex coordinate is finite and all solids stay off Prince Street's carriageway.
for (const h of [desktop, low]) {
  h.group.traverse((o) => {
    if (o.isMesh) {
      const pos = o.geometry.getAttribute('position').array;
      for (let i = 0; i < pos.length; i++) assert.ok(Number.isFinite(pos[i]), 'finite geometry');
    }
  });
}

// Walls, shed and hedges push a car out; driveway and open carport parking bay leave a car free.
const pushAt = (u, v) => {
  const w = site.world(u, v), car = { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, heading: 0 };
  desktop.resolveSolids(car);
  return Math.hypot(car.x - w.x, car.z - w.z);
};
assert.ok(pushAt(-3, 0) > 2, 'main house pushes car out');
assert.ok(pushAt(-3, REAR.v1 - 0.5) > 0.4, 'rear lean-to pushes car out');
assert.ok(pushAt(4, SHED.v0 + 1.5) > 1, 'backyard shed pushes car out');
assert.ok(pushAt(CARPORT.u1 - 0.08, CARPORT.vMid) > 0.2, 'middle SE carport post pushes car out');
assert.ok(pushAt(CARPORT.u1 - 0.08, CARPORT.v1 - 0.12) > 0.2, 'rear SE carport post pushes car out');
assert.ok(pushAt(-1, -14.8) > 0.3, 'front hedge pushes car out');
assert.equal(pushAt(5.0, -11.0), 0, 'driveway is open for a car');
assert.equal(pushAt(4.2, -1.5), 0, 'carport parking bay is open for a car');

// Every Prince Street carriageway point stays clear of all house solids.
const princeRoad = roads.find((r) => r.name === 'Prince Street');
assert.ok(princeRoad, 'Prince Street present in roads.json');
for (const [e, n] of princeRoad.pts) {
  const x = e - manifest.village[0], z = manifest.village[1] - n;
  if (Math.hypot(x - site.origin.x, z - site.origin.z) > 60) continue;
  const car = { x, z, vx: 0, vz: 0, speed: 0, heading: 0 };
  desktop.resolveSolids(car);
  assert.equal(Math.hypot(car.x - x, car.z - z), 0, `no solid reaches Prince Street at (${e.toFixed(1)}, ${n.toFixed(1)})`);
}

// 4. Baked-land rendered-triangle clearance for driveway and sidewalk across 7 -> 8 -> 7 (including cached L8 height while L7 is drawn), desktop and LOW, at 2.5x exaggeration.
function decodePngRgb(buf) {
  let off = 8, w = 0, h = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), bpp = 3, stride = w * bpp, out = new Uint8Array(w * h * bpp);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = y * stride, prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[prev + x] : 0, c = x >= bpp && y > 0 ? out[prev + x - bpp] : 0;
      out[row + x] = (v + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  return { w, h, rgb: out };
}
function loadLevel(level, exag) {
  const tileSize = manifest.size / 2 ** level, ti = Math.floor((found.x - manifest.origin[0]) / tileSize), tj = Math.floor((manifest.origin[1] - found.y) / tileSize);
  const { w, rgb } = decodePngRgb(readFileSync(`${AREA}${level}/${ti}_${tj}.png`));
  const x0 = manifest.origin[0] + ti * tileSize - manifest.village[0], z0 = manifest.village[1] - (manifest.origin[1] - tj * tileSize);
  const seg = 128, step = tileSize / seg, { scale, offset } = manifest.height, T = w - 1;
  const pix = (px, py) => { const k = (py * w + px) * 3; return offset + (rgb[k] * 256 + rgb[k + 1]) * scale; };
  // Bilinear heightAt (matching terrain.ts:1132) with site.height applied.
  const heightAt = (x, z) => {
    const fa = ((x - x0) / tileSize) * T, fb = ((z - z0) / tileSize) * T;
    const a = Math.min(Math.floor(fa), T - 1), b = Math.min(Math.floor(fb), T - 1), u = fa - a, v = fb - b;
    const rawH = (pix(a, b) * (1 - u) + pix(a + 1, b) * u) * (1 - v) + (pix(a, b + 1) * (1 - u) + pix(a + 1, b + 1) * u) * v;
    return site.height(x, z, rawH) * exag;
  };
  // Rendered terrain triangle height (seg = 128, PlaneGeometry diagonal split).
  const gridY = (a, b) => {
    const gx = x0 + a * step, gz = z0 + b * step;
    const px = Math.min(T, Math.round((a / seg) * T)), py = Math.min(T, Math.round((b / seg) * T));
    return site.height(gx, gz, pix(px, py)) * exag;
  };
  const meshY = (x, z) => {
    const fa = (x - x0) / step, fb = (z - z0) / step, a = Math.floor(fa), b = Math.floor(fb), fu = fa - a, fv = fb - b;
    const h00 = gridY(a, b), h10 = gridY(a + 1, b), h01 = gridY(a, b + 1), h11 = gridY(a + 1, b + 1);
    return fu + fv <= 1 ? h00 + fu * (h10 - h00) + fv * (h01 - h00) : h11 + (1 - fu) * (h01 - h11) + (1 - fv) * (h10 - h11);
  };
  return { heightAt, meshY, exag };
}
for (const exag of [2.5, 3]) {
  const L7 = loadLevel(7, exag), L8 = loadLevel(8, exag);
  for (const isLow of [false, true]) {
    let drawn = 7, heightSource = L7;
    const realTerrain = {
      heightAt: (x, z) => heightSource.heightAt(x, z),
      surfaceAt: () => ({ level: heightSource === L8 ? 8 : 7 }),
      drawnLevelAt: () => drawn,
    };
    const h = new PrinceHouse(site, realTerrain, (m) => m * exag, isLow);
    const checkClearance = (label, drawnTile, dist = 0) => {
      h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + dist), 0, { x: site.origin.x, z: site.origin.z + dist });
      const mesh = h.group.children[0].children[0], pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.getIndex();
      let minDrive = Infinity, minWalk = Infinity, nDrive = 0, nWalk = 0;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const ax = pos.getX(i0), ay = pos.getY(i0), az = pos.getZ(i0);
        const bx = pos.getX(i1), by = pos.getY(i1), bz = pos.getZ(i1);
        const cx = pos.getX(i2), cy = pos.getY(i2), cz = pos.getZ(i2);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const len = Math.hypot((by - ay) * (cz - az) - (bz - az) * (cy - ay), ny, (bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
        if (len < 1e-6 || Math.abs(ny) / len < 0.85) continue;
        const cu = (ax + bx + cx) / 3, cv = (az + bz + cz) / 3;
        const isDrive = cu >= 2.2 && cu <= 8.1 && cv >= -18.9 && cv <= -5.3;
        const isWalk = !isDrive && cv >= -17.65 && cv <= -16.25 && cu >= -9.05 && cu <= 17.45;
        if (!isDrive && !isWalk) continue;
        for (const [w0, w1, w2] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
          const u = w0 * ax + w1 * bx + w2 * cx, y = w0 * ay + w1 * by + w2 * cy, v = w0 * az + w1 * bz + w2 * cz;
          const ww = site.world(u, v), clear = y - drawnTile.meshY(ww.x, ww.z);
          if (isDrive) { if (clear < minDrive) minDrive = clear; nDrive++; }
          else { if (clear < minWalk) minWalk = clear; nWalk++; }
        }
      }
      assert.ok(nDrive > 50 && nWalk > 50, `${label} exag=${exag} low=${isLow}: checked drive=${nDrive} walk=${nWalk}`);
      assert.ok(minDrive > 0.01, `${label} exag=${exag} low=${isLow}: driveway clears rendered terrain (${(minDrive * 100).toFixed(1)} cm)`);
      assert.ok(minWalk > 0.01, `${label} exag=${exag} low=${isLow}: sidewalk clears rendered terrain (${(minWalk * 100).toFixed(1)} cm)`);
    };
    // 7 -> 8 -> 7 (cached L8 height, outbound while still visible at 1180 m) -> 7 (L8 evicted)
    drawn = 7; heightSource = L7; checkClearance('L7 initial', L7, 0);
    drawn = 8; heightSource = L8; checkClearance('L8 fine', L8, 0);
    drawn = 7; heightSource = L8; checkClearance('L7 drawn with L8 cached at 1180 m', L7, 1180);
    drawn = 7; heightSource = L7; checkClearance('L7 after L8 eviction', L7, 0);
  }
}
// Frame order: main.ts must update PrinceHouse in the landscape segment after terrain selection so the first L8 -> L7 frame rebuilds before render.
const mainSrc = readFileSync('web/src/main.ts', 'utf8');
const terrainIdx = mainSrc.indexOf("name: 'terrain', segment: 'landscape'");
const princeIdx = mainSrc.indexOf("name: 'prince', segment: 'landscape'");
assert.ok(terrainIdx >= 0 && princeIdx > terrainIdx, 'main.ts updates prince in landscape after terrain selection');
assert.ok(mainSrc.includes("filter(([name]) => name !== 'prince')"), 'main.ts excludes prince from before-camera places loop');

console.log(`PASS prince: desktop ${desktop.triangles} tris, LOW ${low.triangles} tris, drop on SE gable, roof floor, 7->8->7 driveway/sidewalk clearance (2.5x & 3x), after-terrain frame order, driveway and carport open, Prince Street clear`);
