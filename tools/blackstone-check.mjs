// Node check for a house on Blackstone Road, Mabou (web/src/blackstone-site.ts, web/src/blackstone-house.ts):
//   1. BlackstoneSite.find matches building 1454 in Mabou and refuses a moved, resized or turned box;
//   2. pad, driveways, mown lawn, tree-clear strips, maxTexel road-field tiles, mailbox relocation (style 7) and
//      service drop re-aiming agree with the baked land and keep off Blackstone Road and Smithville Road;
//   3. BlackstoneHouse builds finite geometry on desktop and LOW (LOW simpler), stops a car at walls/porch/deck/sheds/
//      barn/parcel chest, and keeps the front driveway, east barn loop, west spur, Blackstone Road and Smithville Road open;
//   4. draped gravel driveway clears rendered terrain triangles across 7 -> 8 -> 7 at 2.5x and 3x exaggeration.
// node tools/run-node-check.mjs tools/blackstone-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { roofHeights } from '../web/src/drone.ts';
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

// 1. Site lookup against the baked Mabou catalog.
const found = BlackstoneSite.find(buildings);
assert.ok(found && found.id === BLACKSTONE_BUILDING, 'BlackstoneSite.find finds building 1454 in Mabou');
assert.equal(BlackstoneSite.find([{ ...found, length: found.length + 2 }]), null, 'a resized box is ignored');
assert.equal(BlackstoneSite.find([{ ...found, axisDeg: found.axisDeg + 15 }]), null, 'a turned box is ignored');
assert.equal(BlackstoneSite.find([{ ...found, x: found.x + 500 }]), null, 'a moved box is ignored');

const site = new BlackstoneSite(found, manifest.village);
assert.ok(site.clear.length >= 8, `tree-clear strips generated (${site.clear.length})`);
// Blackstone Road and Smithville Road must stay completely outside the pad grading blend.
for (const r of roads) {
  if (r.name !== 'Blackstone Road' && r.name !== 'Smithville Road') continue;
  for (const [e, n] of r.pts) {
    const wx = e - manifest.village[0], wz = manifest.village[1] - n;
    if (wx < site.box[0] - 5 || wx > site.box[2] + 5 || wz < site.box[1] - 5 || wz > site.box[3] + 5) continue;
    assert.equal(site.height(wx, wz, 89.5), 89.5, `${r.name} stays outside pad grading`);
  }
}

// Every tile painted within maxTexel must already have a baked road field so no coarse tile allocates a new texture.
const roadLevels = Object.keys(manifest.roads.levels).map(Number);
const coarsestRoadTexel = manifest.size / 2 ** Math.min(...roadLevels) / 256;
assert.ok(site.maxTexel <= coarsestRoadTexel, `site paints no tile coarser than baked road fields (${site.maxTexel} <= ${coarsestRoadTexel})`);
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
const roadW = site.world(0, -21.8);
assert.equal(site.height(roadW.x, roadW.z, 89.8), 89.8, 'Blackstone Road is outside the pad blend');
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

// Drone flight floor covers tall NW wing, main wing, vestibule, SE deck, west shed, east barn and hoop shelters.
const boxRoofAt = roofHeights(buildings.filter((b) => b !== found), manifest.village, 2.5, 0);
const ownRoofAt = roofHeights(site.roofBoxes(), manifest.village, 2.5, 0);
const roofAt = (x, z) => Math.max(boxRoofAt(x, z), ownRoofAt(x, z));
const padLift = site.level * 2.5;
const nwW = site.world(-3.5, 0);
assert.ok(roofAt(nwW.x, nwW.z) >= padLift + NW_WING.ridge, 'drone roof floor covers tall NW wing ridge');
const barnW = site.world((EAST_BARN.u0 + EAST_BARN.u1) / 2, (EAST_BARN.v0 + EAST_BARN.v1) / 2);
assert.ok(roofAt(barnW.x, barnW.z) >= padLift + EAST_BARN.ridge, 'drone roof floor covers east gambrel barn ridge');
const shedW = site.world((WEST_SHED.u0 + WEST_SHED.u1) / 2, (WEST_SHED.v0 + WEST_SHED.v1) / 2);
assert.ok(roofAt(shedW.x, shedW.z) >= padLift + WEST_SHED.ridge, 'drone roof floor covers west gambrel shed ridge');
const openLawnW = site.world(24, -10);
assert.equal(roofAt(openLawnW.x, openLawnW.z), -Infinity, 'open east lawn has no phantom roof floor');

// 3. Build BlackstoneHouse on desktop and LOW against a flat stand-in terrain.
const flatTerrain = { heightAt: () => site.level, surfaceAt: () => ({ level: 8 }) };
const build = (low) => {
  const house = new BlackstoneHouse(site, flatTerrain, (m) => m, low);
  house.update(new THREE.Vector3(site.origin.x, site.level, site.origin.z), 0, { x: site.origin.x, z: site.origin.z });
  assert.ok(!house.waiting && house.group.visible && house.triangles > 0, `built (low=${low})`);
  return house;
};
const desktop = build(false), low = build(true);
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

// Solids stop a car at house, porch, SE deck, west shed, east barn, hoop shelters and parcel box; driveways stay open.
const pushAt = (u, v) => {
  const w = site.world(u, v), car = { x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, heading: 0 };
  desktop.resolveSolids(car);
  return Math.hypot(car.x - w.x, car.z - w.z);
};
assert.ok(pushAt(-3, 0) > 2, 'NW wing pushes car out');
assert.ok(pushAt(2, 0) > 2, 'main wing pushes car out');
assert.ok(pushAt(1.1, PORCH.v0 + 0.4) > 0.5, 'front porch pushes car out');
assert.ok(pushAt(6.4, 0) > 0.8, 'SE two-storey deck pushes car out');
assert.ok(pushAt(-18, -8.5) > 0.8, 'west gambrel shed pushes car out');
assert.ok(pushAt(43.5, 4.0) > 2, 'east gambrel barn pushes car out');
assert.ok(pushAt(36.2, 5.5) > 0.8, 'west hoop shelter pushes car out');
assert.ok(pushAt(49.5, 3.5) > 0.8, 'east hoop shelter pushes car out');
assert.ok(pushAt(PARCEL_BOX.u, PARCEL_BOX.v) > 0.2, 'parcel chest pushes car out');
assert.equal(pushAt(0, -13.5), 0, 'front driveway apron is open for a car');
assert.equal(pushAt(22, -3.5), 0, 'east barn driveway spur is open for a car');
assert.equal(pushAt(-10.5, -6.5), 0, 'west shed driveway spur is open for a car');
assert.equal(pushAt(28, -11), 0, 'east front lawn island is open');

// Every Blackstone Road and Smithville Road carriageway point stays clear of all solids.
for (const roadName of ['Blackstone Road', 'Smithville Road']) {
  const road = roads.find((r) => r.name === roadName);
  assert.ok(road, `${roadName} present in roads.json`);
  for (const [e, n] of road.pts) {
    const x = e - manifest.village[0], z = manifest.village[1] - n;
    if (Math.hypot(x - site.origin.x, z - site.origin.z) > 90) continue;
    const car = { x, z, vx: 0, vz: 0, speed: 0, heading: 0 };
    desktop.resolveSolids(car);
    assert.equal(Math.hypot(car.x - x, car.z - z), 0, `no solid reaches ${roadName} at (${e.toFixed(1)}, ${n.toFixed(1)})`);
  }
}

// 4. Baked-land rendered-triangle clearance for draped gravel driveways across 7 -> 8 -> 7 at 2.5x and 3x exaggeration.
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
  const tileSize = manifest.size / 2 ** level, seg = 128, step = tileSize / seg;
  const { scale, offset } = manifest.height;
  const cache = new Map();
  const tileFor = (x, z) => {
    const ti = Math.floor((x + manifest.village[0] - manifest.origin[0]) / tileSize);
    const tj = Math.floor((manifest.origin[1] - (manifest.village[1] - z)) / tileSize);
    const key = `${ti}_${tj}`;
    if (!cache.has(key)) {
      const { w, rgb } = decodePngRgb(readFileSync(`${AREA}${level}/${ti}_${tj}.png`));
      const x0 = manifest.origin[0] + ti * tileSize - manifest.village[0];
      const z0 = manifest.village[1] - (manifest.origin[1] - tj * tileSize);
      cache.set(key, { w, T: w - 1, rgb, x0, z0 });
    }
    return cache.get(key);
  };
  const pix = (t, px, py) => { const k = (py * t.w + px) * 3; return offset + (t.rgb[k] * 256 + t.rgb[k + 1]) * scale; };
  const heightAt = (x, z) => {
    const t = tileFor(x, z);
    const fa = ((x - t.x0) / tileSize) * t.T, fb = ((z - t.z0) / tileSize) * t.T;
    const a = Math.max(0, Math.min(Math.floor(fa), t.T - 1)), b = Math.max(0, Math.min(Math.floor(fb), t.T - 1));
    const u = fa - a, v = fb - b;
    const rawH = (pix(t, a, b) * (1 - u) + pix(t, a + 1, b) * u) * (1 - v) + (pix(t, a, b + 1) * (1 - u) + pix(t, a + 1, b + 1) * u) * v;
    return site.height(x, z, rawH) * exag;
  };
  const gridY = (t, a, b) => {
    const gx = t.x0 + a * step, gz = t.z0 + b * step;
    const px = Math.min(t.T, Math.round((a / seg) * t.T)), py = Math.min(t.T, Math.round((b / seg) * t.T));
    return site.height(gx, gz, pix(t, px, py)) * exag;
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

for (const exag of [2.5, 3]) {
  const L7 = loadLevel(7, exag), L8 = loadLevel(8, exag);
  for (const isLow of [false, true]) {
    let drawn = 7, heightSource = L7;
    const realTerrain = {
      heightAt: (x, z) => heightSource.heightAt(x, z),
      surfaceAt: () => ({ level: heightSource === L8 ? 8 : 7 }),
      drawnLevelAt: () => drawn,
    };
    const h = new BlackstoneHouse(site, realTerrain, (m) => m * exag, isLow);
    const checkGrounded = (label, drawnTile, dist = 0) => {
      h.update(new THREE.Vector3(site.origin.x, site.level * exag, site.origin.z + dist), 0, { x: site.origin.x, z: site.origin.z + dist });
      const mesh = h.group.children[0].children[0], pos = mesh.geometry.getAttribute('position');
      assert.ok(pos.count > 9000, `${label} exag=${exag} low=${isLow}: geometry rebuilt (${pos.count / 3} tris)`);
      // Verify the east barn and west shed sit on the rendered terrain (foundation extends below ground, roof well above).
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
    };
    drawn = 7; heightSource = L7; checkGrounded('L7 initial', L7, 0);
    drawn = 8; heightSource = L8; checkGrounded('L8 fine', L8, 0);
    drawn = 7; heightSource = L8; checkGrounded('L7 drawn with L8 cached at 1180 m', L7, 1180);
    drawn = 7; heightSource = L7; checkGrounded('L7 after L8 eviction', L7, 0);
  }
}

// Frame order: main.ts must update BlackstoneHouse in the landscape segment after terrain selection.
const mainSrc = readFileSync('web/src/main.ts', 'utf8');
const terrainIdx = mainSrc.indexOf("name: 'terrain', segment: 'landscape'");
const bsIdx = mainSrc.indexOf("name: 'blackstone', segment: 'landscape'");
assert.ok(terrainIdx >= 0 && bsIdx > terrainIdx, 'main.ts updates blackstone in landscape after terrain selection');
assert.ok(mainSrc.includes("name !== 'blackstone'"), 'main.ts excludes blackstone from before-camera places loop');

console.log(`PASS blackstone: desktop ${desktop.triangles} tris, LOW ${low.triangles} tris, style-7 green mailbox at west entrance, drop on NW wing, roof floor, 7->8->7 grounding (2.5x & 3x), after-terrain frame order, driveways and roads clear`);
