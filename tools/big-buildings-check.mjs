// Large buildings as blocks and tanks, on the game's side. Bundle with esbuild (tools/check-big.sh).
//  1. No block or tank stands in a hand-built site. Those sites replace mapped buildings when the game runs, by
//     position or by their clear zones; a block there would be drawn through the hand-built model.
//  2. A block or a tank is drawn closed: a roof over all of it, at its stated height.
//  3. A long turned block clears the trees under itself, not a square of forest round itself: in today's scene, and
//     in the 1884 scene, which draws no modern roof and removes the tree layer under each one.
// It reads every area that has buildings.json. MMM_BAKED names another data/baked folder (a rehearsal).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { AREAS } from '../web/src/area.ts';
import { Buildings, applyBuildingFoundations, buildingSites, clearBoxes, roofSites } from '../web/src/buildings.ts';
import { ChurchSite } from '../web/src/church-site.ts';
import { JudiqueVillageSite } from '../web/src/judique-village-site.ts';
import { PortHawkesburySite } from '../web/src/port-hawkesbury-site.ts';
import { MaryvilleStoreSite } from '../web/src/maryville-store-site.ts';
import { DepotSite } from '../web/src/depot-site.ts';
import { MabouMainSite } from '../web/src/mabou-main-site.ts';
import { HistoryScene } from '../web/src/eras/history-scene.ts';
import { Roads } from '../web/src/roads.ts';
import { COAST_BOX } from '../web/src/coast-site.ts';
import { FishingSite } from '../web/src/fishing-site.ts';
import { HomeSite } from '../web/src/home-site.ts';
import { Home } from '../web/src/home.ts';
import { mineRoadEnd } from '../web/src/mine-site.ts';
import { PorchSite } from '../web/src/porch-site.ts';
import { DrLaneSite } from '../web/src/drlane-site.ts';
import { PrinceSite } from '../web/src/prince-site.ts';
import { QuarrySite } from '../web/src/quarry-site.ts';
import { YardDogSite, YARD_DOG } from '../web/src/yard-dog-site.ts';
import { YardSite } from '../web/src/yard-site.ts';
import { Yard } from '../web/src/yard.ts';

const root = process.env.MMM_ROOT, baked = process.env.MMM_BAKED ?? `${root}/data/baked`;
const source = (name) => fs.readFileSync(`${root}/web/src/${name}`, 'utf8');

/** The hand-built sites of one area, as main.ts makes them: tree-free boxes [x0, z0, x1, z1] in game metres, and
 * the filters that take mapped buildings out of the list by position. */
function sites(area, manifest, list, roads, landmarks, mail) {
  const v = manifest.village, zones = [], filters = [], whole = [];
  const add = (name, boxes) => { for (const box of boxes) zones.push({ name, box }); };
  if (area.landmarks) add('landmark', landmarks.map((lm) => {
    const xs = lm.footprint.map((p) => p[0] - v[0]), zs = lm.footprint.map((p) => v[1] - p[1]);
    return [Math.min(...xs) - 4, Math.min(...zs) - 4, Math.max(...xs) + 4, Math.max(...zs) + 4];
  }));
  if (area.worksYard) { const site = new YardSite(v, 'invented'); whole.push(site.box); add('works yard', site.clear); filters.push(['works yard', (l) => Yard.buildings(l, site, v)]); }
  if (area.home) { const site = new HomeSite(v); whole.push(site.box); add('home', site.clear); filters.push(['home', (l) => Home.buildings(l, site, v)]); }
  if (area.church) { const site = new ChurchSite(v); whole.push(site.box); add('church', site.clear); filters.push(['church', (l) => site.buildings(l)]); }
  if (area.drLane) { const box = DrLaneSite.find(list); if (box) { const site = new DrLaneSite(box, v); whole.push(site.box); add('house on D.R.\'s Lane', site.clear); } }
  if (area.prince) { const box = PrinceSite.find(list); if (box) { const site = new PrinceSite(box, v); whole.push(site.box); add('house on Prince Street', site.clear); } }
  if (area.id === 'judique') { const site = new JudiqueVillageSite(v); add('Judique village', site.clear); filters.push(['Judique village', (l) => site.buildings(l)]); }
  if (area.id === 'porthood') { add('Maryville tractor dealership', new MaryvilleStoreSite(v).clear); add('Port Hood Mail Depot', new DepotSite(v).clear); }
  if (area.id === 'pointtupper') { const site = new PortHawkesburySite(v); add('Port Hawkesbury', site.clear); filters.push(['Port Hawkesbury', (l) => site.buildings(l)]); }
  if (area.quarry) { const site = new QuarrySite(v); whole.push(site.box); add('quarry gate', site.clear); }
  if (area.fishing) { const site = new FishingSite(v); add('wharf', [site.box, ...site.clear]); }
  if (area.coast) add('coast', [[COAST_BOX[0] - v[0], v[1] - COAST_BOX[3], COAST_BOX[2] - v[0], v[1] - COAST_BOX[1]]]);
  if (area.id === 'mabou') { const box = PorchSite.find(list); if (box) { const site = new PorchSite(box, v); whole.push(site.box); add('porch', site.clear); } }
  if (area.id === 'mabou') { const site = new MabouMainSite(v); add('Mabou main street', site.clear); filters.push(['Mabou main street', (l) => site.drawn(l)]); }
  if (area.colliery && manifest.mid) {
    // main.ts: the drive bounds lie EDGE inside the fine map; mine-site.ts keeps two squares clear at the road's end.
    const EDGE = 120, m = manifest.mid;
    const point = mineRoadEnd({ roads: roads.map((r) => ({ ...r, pts: r.pts.map(([e, n]) => [e - v[0], v[1] - n]) })) },
      [m[0] - v[0] + EDGE, v[1] - m[3] + EDGE, m[2] - v[0] - EDGE, v[1] - m[1] - EDGE]);
    if (point) for (const side of [-1, 1]) {
      const offset = point.halfWidth + 18, x = point.x + Math.cos(point.heading) * offset * side, z = point.z + Math.sin(point.heading) * offset * side;
      add('mine', [[x - 14, z - 14, x + 14, z + 14]]);
    }
  }
  if (area.id === 'mabou' && mail) {
    // main.ts: the invented driveway of the yard dog. It gives way to every house, mailbox and other site (the
    // whole box of each site and its tree-free boxes), and in the game also to the tree-free box of any building;
    // a block there would remove it without a word. So the zone is the driveway as it lies without the
    // buildings' boxes, and a block that reaches into it is a fault.
    const site = YardDogSite.create({
      roads: roads.map((r) => ({ ...r, pts: r.pts.map(([e, n]) => [e - v[0], v[1] - n]) })), village: v, mail,
      houses: buildingSites(list).filter((b) => b.kind === 'house').map((b) => ({ x: b.x - v[0], z: v[1] - b.y })),
      excluded: [...whole, ...zones.map((zone) => zone.box)],
    });
    if (site) add('yard dog driveway', site.clear);
  }
  return { zones, filters };
}
// The two lines that the mine's zone above repeats. If they change, change it too.
assert.ok(/const EDGE = 120;/.test(source('main.ts')) && /manifest\.mid\[0\] - VE \+ EDGE, VN - manifest\.mid\[3\] \+ EDGE/.test(source('main.ts')), 'main.ts drive bounds');
assert.ok(source('mine-site.ts').includes('offset = p.halfWidth + 18') && source('mine-site.ts').includes('terrain.clear.push([x - 14, z - 14, x + 14, z + 14])'), 'mine-site.ts clear squares');
// Every site file that the game has is one that this check knows. A new hand-built site must be added above.
// airport-site.ts only paints the baked ground and pushes no clear box: it removes no building, so it has no zone.
{
  const known = ['airport-site.ts', 'church-site.ts', 'coast-site.ts', 'depot-site.ts', 'drlane-site.ts', 'fishing-site.ts', 'home-site.ts', 'judique-village-site.ts', 'mabou-main-site.ts', 'maryville-store-site.ts', 'mine-site.ts', 'porch-site.ts', 'port-hawkesbury-site.ts', 'prince-site.ts', 'quarry-site.ts', 'yard-dog-site.ts', 'yard-site.ts'];
  const found = fs.readdirSync(`${root}/web/src`).filter((name) => /-site\.ts$/.test(name)).sort();
  assert.deepEqual(found, known, 'a hand-built site was added or removed: teach tools/big-buildings-check.mjs its zones');
}

/** Does this block or tank reach into the box? Both are convex, so two shapes apart have a line between them. */
function reaches(b, v, [x0, z0, x1, z1]) {
  if (b.shape === 'tank') {
    const cx = b.x - v[0], cz = v[1] - b.y, dx = Math.max(x0 - cx, 0, cx - x1), dz = Math.max(z0 - cz, 0, cz - z1);
    return dx * dx + dz * dz < (b.length / 2) ** 2;
  }
  const q = b.footprint.map(([e, n]) => [e - v[0], v[1] - n]), box = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (const [nx, nz] of [[1, 0], [0, 1], [q[0][1] - q[1][1], q[1][0] - q[0][0]], [q[1][1] - q[2][1], q[2][0] - q[1][0]]]) {
    const a = q.map((p) => p[0] * nx + p[1] * nz), c = box.map((p) => p[0] * nx + p[1] * nz);
    if (Math.max(...a) <= Math.min(...c) || Math.min(...a) >= Math.max(...c)) return false;
  }
  return true;
}

function faults(area, manifest, list, roads, landmarks, mail) {
  const found = [], large = list.filter((b) => b.shape), { zones, filters } = sites(area, manifest, list, roads, landmarks, mail);
  for (const b of large) for (const zone of zones) if (reaches(b, manifest.village, zone.box)) { found.push(`${area.id} ${b.id} (${b.shape}) reaches into the ${zone.name}`); break; }
  for (const [name, filter] of filters) {
    const left = new Set(filter(list).map((b) => b.id));
    for (const b of large) if (!left.has(b.id)) found.push(`${area.id} ${b.id} (${b.shape}) is taken out by the ${name}`);
  }
  return { found, zones: zones.length, large: large.length };
}

const dispose = (model) => { model.mesh.geometry.dispose(); model.mesh.material.dispose(); };
const minY = (b, village, exag) => {
  const model = new Buildings([b], village, exag, 0);
  const pos = model.mesh.geometry.getAttribute('position').array;
  let low = Infinity;
  for (let i = 1; i < pos.length; i += 3) if (pos[i] < low) low = pos[i];
  dispose(model);
  return low;
};
function decodePng(file) {
  const png = fs.readFileSync(file);
  let off = 8, width = 0, height = 0, channels = 0;
  const chunks = [];
  while (off < png.length) {
    const n = png.readUInt32BE(off), type = png.toString('ascii', off + 4, off + 8), chunk = png.subarray(off + 8, off + 8 + n);
    if (type === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); assert.equal(chunk[8], 8); channels = chunk[9] === 2 ? 3 : chunk[9] === 6 ? 4 : 0; assert.ok(channels); }
    if (type === 'IDAT') chunks.push(chunk);
    off += n + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = width * channels, out = new Uint8Array(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    assert.ok(f <= 4);
    for (let x = 0; x < stride; x++) {
      const k = y * stride + x, a = x >= channels ? out[k - channels] : 0, b = y ? out[k - stride] : 0, c = y && x >= channels ? out[k - stride - channels] : 0;
      out[k] = (raw[y * (stride + 1) + x + 1] + [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
  }
  return { width, height, channels, data: out };
}
function terrainSampler(areaId, dir, manifest) {
  const [ox, oy] = manifest.origin, { size, height: { scale, offset }, levels = {} } = manifest, cache = new Map();
  const levelSets = new Map(Object.entries(levels).map(([lvl, keys]) => [Number(lvl), new Set(keys)]));
  const parentLevels = [6, 5, 4, 3];
  for (const lvl of parentLevels) {
    assert.ok(levelSets.get(lvl)?.size > 0, `${areaId}: manifest missing parent level ${lvl} terrain tiles`);
  }
  const checkLevels = [8, 7, ...parentLevels];
  const readTile = (lvl, tx, ty, bId) => {
    const tileKey = `${tx}_${ty}`;
    if (!levelSets.get(lvl)?.has(tileKey)) return null;
    const key = `${lvl}/${tileKey}`;
    if (!cache.has(key)) {
      const file = `${dir}/${lvl}/${tileKey}.png`;
      assert.ok(fs.existsSync(file), `${areaId} ${bId}: missing manifest terrain tile ${key}.png`);
      cache.set(key, decodePng(file));
    }
    return cache.get(key);
  };
  return (e, n, bId) => {
    let lowest = Infinity;
    for (const lvl of checkLevels) {
      const tsize = size / (1 << lvl), tx = Math.floor((e - ox) / tsize), ty = Math.floor((oy - n) / tsize);
      const tile = readTile(lvl, tx, ty, bId);
      if (!tile) {
        assert.ok(lvl > 6, `${areaId} ${bId}: missing parent level ${lvl} tile ${lvl}/${tx}_${ty} at (${e.toFixed(1)}, ${n.toFixed(1)})`);
        continue;
      }
      const seg = lvl >= 7 ? 128 : 64, step = 256 / seg;
      const u = (e - (ox + tx * tsize)) / tsize * seg, v = ((oy - ty * tsize) - n) / tsize * seg;
      const i0 = Math.max(0, Math.min(seg - 1, Math.floor(u))), j0 = Math.max(0, Math.min(seg - 1, Math.floor(v)));
      const fu = u - i0, fv = v - j0;
      const at = (i, j) => { const k = (j * tile.width + i) * tile.channels; return (tile.data[k] * 256 + tile.data[k + 1]) * scale + offset; };
      const h00 = at(i0 * step, j0 * step), h10 = at((i0 + 1) * step, j0 * step);
      const h01 = at(i0 * step, (j0 + 1) * step), h11 = at((i0 + 1) * step, (j0 + 1) * step);
      const d1 = fu + fv <= 1 ? h00 + (h10 - h00) * fu + (h01 - h00) * fv : h11 + (h01 - h11) * (1 - fu) + (h10 - h11) * (1 - fv);
      const d2 = fu >= fv ? h00 + (h10 - h00) * fu + (h11 - h10) * fv : h00 + (h11 - h01) * fu + (h01 - h00) * fv;
      lowest = Math.min(lowest, d1, d2);
    }
    return Number.isFinite(lowest) ? lowest : null;
  };
}
function perimeterPoints(b) {
  const pts = [], L = b.length / 2, W = b.width / 2;
  if (b.shape === 'tank') {
    for (let k = 0; k < 32; k++) { const t = k * Math.PI * 2 / 32; pts.push([b.x + L * Math.cos(t), b.y + L * Math.sin(t)]); }
    return pts;
  }
  const a = b.axisDeg * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a), vx = Math.cos(a), vy = -Math.sin(a);
  const nu = Math.max(4, Math.ceil(b.length)), nv = Math.max(4, Math.ceil(b.width));
  for (let i = 0; i <= nu; i++) { const u = -L + b.length * i / nu; for (const s of [-W, W]) pts.push([b.x + ux * u + vx * s, b.y + uy * u + vy * s]); }
  for (let j = 0; j <= nv; j++) { const v = -W + b.width * j / nv; for (const s of [-L, L]) pts.push([b.x + ux * s + vx * v, b.y + uy * s + vy * v]); }
  return pts;
}
const cast = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
/** Rays straight down over the whole item: each one must find a roof at the stated height or above. */
function roofed(b, village, step) {
  const model = new Buildings([b], village, 1, 0), angle = b.axisDeg * Math.PI / 180;
  for (const a of Object.values(model.mesh.geometry.attributes)) assert.ok([...a.array].every(Number.isFinite), `finite geometry at ${b.id}`);
  let rays = 0, highest = -Infinity;
  for (let u = -b.length / 2 + .05; u <= b.length / 2; u += step) for (let w = -b.width / 2 + .05; w <= b.width / 2; w += step) {
    if (b.shape === 'tank' && Math.hypot(u, w) > b.length / 2 - .6) continue;
    const x = b.x - village[0] + Math.sin(angle) * u + Math.cos(angle) * w, z = village[1] - b.y - Math.cos(angle) * u + Math.sin(angle) * w;
    cast.set(new THREE.Vector3(x, b.ground + b.ridge + 20, z), down);
    const hits = cast.intersectObject(model.mesh);
    assert.ok(hits.length && hits[0].point.y >= b.ground + b.eave - .5 && hits[0].point.y <= b.ground + b.ridge + .5, `roof at ${b.id} (${u.toFixed(1)}, ${w.toFixed(1)})`);
    highest = Math.max(highest, hits[0].point.y); rays++;
  }
  const clear = model.clear.map((box) => [...box]);
  dispose(model);
  return { rays, highest, clear };
}
/** Assembled multi-block roof check at default 1.5x exaggeration: downward rays across every facing joint must hit a roof. */
function assembledJoints(group, village, styles, label) {
  const exag = 1.5, model = new Buildings(group, village, exag, 0, styles);
  const root = group[0], a = root.axisDeg * Math.PI / 180;
  const ux = Math.sin(a), uy = Math.cos(a), vx = Math.cos(a), vy = -Math.sin(a);
  const boxes = [];
  for (const b of group) {
    const da = Math.abs(((b.axisDeg - root.axisDeg) % 90 + 90) % 90);
    if (Math.min(da, 90 - da) > 1.0) continue;
    const us = b.footprint.map(([e, n]) => (e - root.x) * ux + (n - root.y) * uy);
    const vs = b.footprint.map(([e, n]) => (e - root.x) * vx + (n - root.y) * vy);
    boxes.push({ b, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) });
  }
  let rays = 0;
  const topY = Math.max(...group.map((b) => b.ground * exag + b.ridge)) + 20;
  try {
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j], floorY = Math.min(A.b.ground, B.b.ground) * exag + Math.min(A.b.eave, B.b.eave) - 0.5;
      const ovU0 = Math.max(A.u0, B.u0), ovU1 = Math.min(A.u1, B.u1), gapV = Math.max(A.v0 - B.v1, B.v0 - A.v1);
      if (ovU1 - ovU0 > 2 && gapV >= -0.05 && gapV < 1.5) {
        const midV = A.v0 >= B.v1 - 0.05 ? (B.v1 + A.v0) / 2 : (A.v1 + B.v0) / 2;
        const probes = gapV > 0.05 ? [midV] : [midV - 0.03, midV + 0.03];
        for (let u = ovU0 + 0.5; u <= ovU1 - 0.5; u += 1.0) for (const pv of probes) {
          const e = root.x + ux * u + vx * pv, n = root.y + uy * u + vy * pv;
          cast.set(new THREE.Vector3(e - village[0], topY, village[1] - n), down);
          const hits = cast.intersectObject(model.mesh);
          assert.ok(hits.length && hits[0].point.y >= floorY, `${label}: open roof seam (${gapV.toFixed(2)} m) between blocks ${A.b.id} and ${B.b.id}`);
          rays++;
        }
      }
      const ovV0 = Math.max(A.v0, B.v0), ovV1 = Math.min(A.v1, B.v1), gapU = Math.max(A.u0 - B.u1, B.u0 - A.u1);
      if (ovV1 - ovV0 > 2 && gapU >= -0.05 && gapU < 1.5) {
        const midU = A.u0 >= B.u1 - 0.05 ? (B.u1 + A.u0) / 2 : (A.u1 + B.u0) / 2;
        const probes = gapU > 0.05 ? [midU] : [midU - 0.03, midU + 0.03];
        for (let v = ovV0 + 0.5; v <= ovV1 - 0.5; v += 1.0) for (const pu of probes) {
          const e = root.x + ux * pu + vx * v, n = root.y + uy * pu + vy * v;
          cast.set(new THREE.Vector3(e - village[0], topY, village[1] - n), down);
          const hits = cast.intersectObject(model.mesh);
          assert.ok(hits.length && hits[0].point.y >= floorY, `${label}: open roof seam (${gapU.toFixed(2)} m) between blocks ${A.b.id} and ${B.b.id}`);
          rays++;
        }
      }
    }
  } finally { dispose(model); }
  return rays;
}

// Made-up shapes first: this part needs no baked land.
const V = [600000, 5100000];
const block = (id, e, n, length, width, axisDeg, eave, ridge, roof, extra = {}) => {
  const a = axisDeg * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a), vx = Math.cos(a), vy = -Math.sin(a);
  const footprint = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [e + i * length / 2 * ux + j * width / 2 * vx, n + i * length / 2 * uy + j * width / 2 * vy]);
  return { id, x: e, y: n, ground: 12, footprint, axisDeg, length, width, eave, ridge, roof, kind: 'large', source: 'osm', confidence: .9, nearRoad: null, roadDist: null, shape: 'block', ...extra };
};
// A tank's footprint is 32 points on its circle, counter-clockwise from north (TANK_POINTS in pipeline/big_buildings.py).
const round = (id, e, n, diameter, eave, ridge, roof) => block(id, e, n, diameter, diameter, 0, eave, ridge, roof, {
  shape: 'tank', footprint: Array.from({ length: 32 }, (_, i) => [e - diameter / 2 * Math.sin(i * Math.PI / 16), n + diameter / 2 * Math.cos(i * Math.PI / 16)]),
});
{
  const tank = round(1, V[0] + 100, V[1] + 80, 40, 15, 18, 'gable');
  const drawn = roofed(tank, V, .9);
  assert.ok(drawn.rays > 1000 && Math.abs(drawn.highest - (12 + 18)) < .3, 'the cone of a tank reaches its stated top');
  const model = new Buildings([tank], V, 1, 0);
  for (let t = 0; t < 16; t++) {
    cast.set(new THREE.Vector3(100 + Math.cos(t) * 21.5, 60, -80 + Math.sin(t) * 21.5), down);
    assert.equal(cast.intersectObject(model.mesh).length, 0, 'a tank is round: nothing stands outside its radius');
  }
  dispose(model);
  assert.equal(roofed({ ...tank, ridge: 15, roof: 'flat' }, V, 2).highest.toFixed(2), '27.00', 'a flat tank top');
  // A long turned hall. One box round it would clear four times its own area of forest.
  const hall = block(2, V[0] - 300, V[1] + 500, 300, 40, 37, 7, 7.5, 'flat');
  const drawnHall = roofed(hall, V, 1.3), boxes = drawnHall.clear;
  const raisedHall = { ...hall, shape: undefined };
  const survey = JSON.stringify({ buildings: [raisedHall] });
  const rows = Buffer.alloc(8);
  rows.writeUInt32LE(raisedHall.id, 0);
  rows.writeUInt16LE(300, 4);
  rows.writeUInt16LE(800, 6);
  const companion = { source: createHash('sha256').update(survey).digest('hex'), rows: rows.toString('base64') };
  await applyBuildingFoundations([raisedHall], survey + ' ', companion);
  assert.equal(raisedHall.floorGround, undefined, 'stale survey ignores baked foundations');
  await applyBuildingFoundations([raisedHall], survey, companion);
  assert.equal(raisedHall.floorGround, 15, 'load the baked uphill floor');
  assert.equal(raisedHall.foundationGround, 7, 'load the baked downhill foundation');
  assert.ok(Math.abs(minY(raisedHall, V, 1.5) - 10.4) < 1e-4, 'foundation extends below the low corner');
  const raisedModel = new Buildings([raisedHall], V, 1, 0);
  cast.set(new THREE.Vector3(-300, 40, -500), down);
  assert.equal(cast.intersectObject(raisedModel.mesh)[0].point.y, 22.5, 'roof follows the raised floor');
  dispose(raisedModel);

  let covered = 0, cleared = 0;
  const a = 37 * Math.PI / 180;
  for (let x = -520; x <= -80; x += 2) for (let z = -720; z <= -280; z += 2) {
    const dx = x + 300, dz = z + 500, u = Math.sin(a) * dx - Math.cos(a) * dz, w = Math.cos(a) * dx + Math.sin(a) * dz;
    const on = Math.abs(u) <= 150 && Math.abs(w) <= 20, clear = boxes.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
    assert.ok(!on || clear, 'no tree under the hall');
    covered += on ? 4 : 0; cleared += clear ? 4 : 0;
  }
  assert.ok(Math.abs(covered - 12000) < 400 && cleared < 1.9 * covered, `the hall clears ${cleared} m2 for ${covered} m2 of roof`);
  roofed(block(3, V[0], V[1], 60, 30, 110, 6, 11, 'gable'), V, .8);
  for (const exag of [1, 1.5, 2.5]) {
    assert.ok(Math.abs(minY(hall, V, exag) - (hall.ground * exag - 7 * exag)) < 1e-4, `block foundation scales at exag=${exag}`);
    assert.ok(Math.abs(minY(tank, V, exag) - (tank.ground * exag - 7 * exag)) < 1e-4, `tank shell scales at exag=${exag}`);
    const plain = { ...block(99, V[0], V[1], 12, 8, 0, 5, 7, 'gable'), kind: 'house', shape: undefined };
    assert.ok(Math.abs(minY(plain, V, exag) - (plain.ground * exag - 3)) < 1e-4, `ordinary building keeps 3 m foot at exag=${exag}`);
  }
  {
    const main = block(10, V[0], V[1], 40, 20, 0, 8, 8.2, 'flat', { buildingId: 10 });
    const flush = block(11, V[0] + 15, V[1], 20, 10, 0, 6, 6.2, 'flat', { buildingId: 10 });
    assert.ok(assembledJoints([main, flush], V, {}, 'synthetic flush') > 15, 'touching blocks pass assembled roof joint check');
    const gapped = block(12, V[0] + 15.98, V[1], 20, 10, 0, 6, 6.2, 'flat', { buildingId: 10 });
    assert.throws(() => assembledJoints([main, gapped], V, {}, 'synthetic seam'), /open roof seam/, '0.98 m seam between blocks is caught');
  }
  // A baked colour (step 30) repaints a block but gives it no door and window grid: a block is one part of a large mapped
  // hall (plants, malls, arenas), and the house-scale window grid is only for a large building without a shape (#1288).
  // The paint is shingle on purpose: a metal roof adds seams, which is not what this pins.
  {
    const paint = { wall: '#5f6f7a', roof: '#8e9493', trim: '#e5e5dd', roofMaterial: 'shingle', entrance: 'none', chimney: false, dormer: false,
      shutters: false, satelliteDish: false, skirting: false, silo: false };
    const positions = (b, styles) => {
      const model = new Buildings([b], V, 1, 0, styles), out = [...model.mesh.geometry.getAttribute('position').array];
      dispose(model);
      return out;
    };
    const hallBlock = block(6, V[0] + 40, V[1] - 60, 80, 30, 20, 9, 9, 'flat');
    assert.deepEqual(positions(hallBlock, { 6: paint }), positions(hallBlock, {}), 'a styled block gets no door and window grid: it draws the same shape as an unstyled one');
    const { shape, ...shop } = hallBlock;
    assert.ok(positions(shop, { 6: paint }).length > positions(shop, {}).length, 'a styled large building without a shape gets its doors and windows');
  }
  // The 1884 scene. A large building of two long turned blocks, a tank, and a house with a wing. Each block clears
  // its own cells. (Before, the scene got one record per building and cleared the square round the first block: the
  // second block stayed under trees, and forest beside the first was cleared.)
  {
    const first = { ...hall, buildingId: 2 }, second = block(5, V[0] - 130, V[1] + 560, 200, 40, 127, 9, 9, 'flat', { buildingId: 2 });
    const site = { ...block(7, V[0] + 300, V[1] - 200, 14, 9, 20, 5, 7, 'gable'), kind: 'house', shape: undefined };
    const house = { ...block(7, V[0] + 302, V[1] - 199, 10, 9, 20, 5, 7, 'gable'), kind: 'house', shape: undefined, buildingId: 7, site };
    const wing = { ...block(8, V[0] + 296, V[1] - 203, 5, 4, 20, 3, 4, 'gable'), kind: 'house', shape: undefined, buildingId: 7 };
    const list = [first, second, tank, house, wing], roofs = roofSites(list);
    assert.deepEqual(roofs.map((b) => b.id), [2, 1, 7, 5], 'one record per building, and every further block');
    assert.ok(roofs[2] === site, 'a house with wings is its one unchanged site');
    const ground = () => 12, canvas = () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: (t) => ({ width: t.length * 80 }) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, value) => ((t[k] = value), true) }) });
    const terrain = { cartRoads: true, contactRevision: 1, dataRevision: 1, clear: [], low: false, manifest: { village: V }, coverAt: () => 2, meshContactSource: () => 1,
      meshContactAt(x, z, out) { out.height = 12; out.source = 1; out.drawn = true; return true; }, meshHeightAt: ground };
    const before = globalThis.document;
    globalThis.document = { createElement: canvas };
    try { new HistoryScene(terrain, new Roads({ roads: [] }, V, terrain), null, roofs, ground, { trades: [], farms: [] }); } finally { globalThis.document = before; }
    const cleared = terrain.clear;
    assert.deepEqual(cleared, roofs.flatMap((b) => clearBoxes(b, V, 2)), 'the 1884 scene clears the boxes of every roof, and nothing else here');
    const xs = site.footprint.map((p) => p[0] - V[0]), zs = site.footprint.map((p) => V[1] - p[1]);
    assert.deepEqual(clearBoxes(site, V, 2), [[Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2]], 'a house: the box of its footprint, as before');
    assert.deepEqual(clearBoxes(tank, V, 2), [[100 - 22, -80 - 22, 100 + 22, -80 + 22]], 'a tank: the square round its circle');
    const inBlock = (b, x, z) => { const t = b.axisDeg * Math.PI / 180, dx = x - (b.x - V[0]), dz = z - (V[1] - b.y); return Math.abs(Math.sin(t) * dx - Math.cos(t) * dz) <= b.length / 2 && Math.abs(Math.cos(t) * dx + Math.sin(t) * dz) <= b.width / 2; };
    let roof = 0, bare = 0;
    for (let x = -520; x <= 80; x += 2) for (let z = -760; z <= -280; z += 2) {
      const on = inBlock(first, x, z) || inBlock(second, x, z), clear = cleared.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
      assert.ok(!on || clear, 'no tree under a block of the large building in 1884');
      roof += on ? 4 : 0; bare += clear ? 4 : 0;
    }
    assert.ok(Math.abs(roof - 20000) < 700 && bare < 1.9 * roof, `1884: the two blocks clear ${bare} m2 for ${roof} m2 of roof`);
    assert.ok(source('main.ts').includes('new HistoryScene(terrain, roads, streams, roofSites(buildingList ?? []), ground)'), 'main.ts gives the 1884 scene every roof');
  }
  // The checker itself: a block or a tank planted in each kind of zone is found, and one beside the zone is not.
  assert.ok(reaches(hall, V, [-310, -510, -290, -490]) && !reaches(hall, V, [-200, -700, -150, -650]));
  assert.ok(!reaches(block(4, V[0], V[1], 100, 10, 45, 5, 5, 'flat'), V, [20, 20, 40, 40]), 'a turned block passes the corner of a box that its own bounding box holds');
  assert.ok(reaches(tank, V, [118, -90, 130, -70]) && !reaches(tank, V, [115, -110, 130, -96]), 'a tank is tested as a circle');
}

// The yard dog's driveway on made-up land, so that the zone is proved whatever the baked land holds: a block or a
// tank in it is a fault, one 80 m beside it is not, and without mailbox data there is no driveway and no zone.
{
  const area = AREAS.find((a) => a.id === 'mabou'), manifest = { village: V };
  const e = YARD_DOG.east, n = YARD_DOG.north;
  const house = { ...block(1, e + 700, n + 700, 12, 8, 0, 5, 7, 'gable'), kind: 'house', shape: undefined };
  const roads = [{ id: 1, name: YARD_DOG.road, kind: 3, halfWidth: 2.6, bridge: false, pts: [[e, n - 100], [e, n + 100]] }];
  const mail = [{ x: e + 700 - V[0], z: V[1] - (n + 700) }];
  const zone = sites(area, manifest, [house], roads, [], mail).zones.find((z) => z.name === 'yard dog driveway');
  assert.ok(zone, 'the yard dog driveway is a zone on made-up land');
  const x = (zone.box[0] + zone.box[2]) / 2 + V[0], y = V[1] - (zone.box[1] + zone.box[3]) / 2;
  for (const planted of [block(2, x, y, 12, 8, 0, 5, 5, 'flat'), round(2, x, y, 12, 5, 6, 'gable')]) {
    assert.ok(faults(area, manifest, [house, planted], roads, [], mail).found.includes(`mabou 2 (${planted.shape}) reaches into the yard dog driveway`), 'a large building in the yard dog driveway is found');
    const beside = { ...planted, x: planted.x + 80, footprint: planted.footprint?.map(([px, py]) => [px + 80, py]) };
    assert.deepEqual(faults(area, manifest, [house, beside], roads, [], mail).found, [], 'a large building beside the yard dog driveway is no fault');
  }
  assert.ok(!sites(area, manifest, [house], roads, [], null).zones.some((z) => z.name === 'yard dog driveway'), 'no driveway zone without mailbox data');
}

let areas = 0, large = 0, zones = 0, rays = 0, grounded = 0;
const report = [];
for (const area of AREAS) {
  const dir = `${baked}/${area.base}`, read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8'));
  if (!fs.existsSync(`${dir}/buildings.json`) || !fs.existsSync(`${dir}/manifest.json`)) continue;
  const manifest = read('manifest.json'), list = read('buildings.json').buildings, roads = read('roads.json').roads;
  const styles = manifest.buildingStyles && fs.existsSync(`${dir}/${manifest.buildingStyles.file}`) ? read(manifest.buildingStyles.file).styles : {};
  const sampleGround = manifest.origin && manifest.height ? terrainSampler(area.id, dir, manifest) : null;
  const landmarks = fs.existsSync(`${dir}/landmarks.json`) ? read('landmarks.json') : [];
  // The mail points as main.ts hands them to the yard dog's driveway: every mailbox and community box.
  const mail = manifest.props && fs.existsSync(`${dir}/${manifest.props.file}`) ? (({ mailboxes, communityBoxes }) => [...mailboxes, ...communityBoxes]
    .map((p) => ({ x: p.x - manifest.village[0], z: manifest.village[1] - p.y })))(read(manifest.props.file)) : null;
  const result = faults(area, manifest, list, roads, landmarks, mail);
  assert.deepEqual(result.found, [], 'a large building stands in a hand-built site: leave its outline out (big_buildings_skip in pipeline/areas.py)');
  // The same check must find a planted one. Each zone gets a block and a tank at its middle; each filter gets a
  // block at the place it empties.
  const v = manifest.village, top = Math.max(...list.map((b) => b.id)), { zones: all, filters } = sites(area, manifest, list, roads, landmarks, mail);
  if (area.id === 'mabou') {
    assert.ok(mail?.length, 'Mabou has props.json with mail points: without them the yard dog driveway is not checked');
    assert.ok(all.some((zone) => zone.name === 'yard dog driveway'), 'the yard dog driveway is a zone in Mabou');
  }
  for (const [index, zone] of all.entries()) {
    const e = (zone.box[0] + zone.box[2]) / 2 + v[0], n = v[1] - (zone.box[1] + zone.box[3]) / 2;
    for (const planted of [block(top + 1, e, n, 12, 8, 30 + index, 5, 5, 'flat'), round(top + 1, e, n, 12, 5, 6, 'gable')]) {
      const again = faults(area, manifest, [...list, planted], roads, landmarks, mail).found;
      assert.ok(again.some((line) => line.startsWith(`${area.id} ${top + 1} `)), `a ${planted.shape} planted in the ${zone.name} of ${area.id} is found`);
    }
  }
  for (const [name] of filters) {
    const spot = { 'works yard': () => { const p = new YardSite(v, 'invented').world(20, 0); return [p.x + v[0], v[1] - p.z]; },
      home: () => { const p = new HomeSite(v).world(3.5, -17); return [p.x + v[0], v[1] - p.z]; }, church: () => [630844.2, 5080637.2], 'Judique village': () => [617126.6, 5081683.9], 'Port Hawkesbury': () => [628241.01, 5052612.96], 'Mabou main street': () => [624878.67, 5103595.55] }[name]();
    const again = faults(area, manifest, [...list, block(top + 1, spot[0], spot[1], 12, 8, 0, 5, 5, 'flat')], roads, landmarks, mail).found;
    assert.ok(again.includes(`${area.id} ${top + 1} (block) is taken out by the ${name}`), `a block planted where the ${name} empties the list is found`);
  }
  // The baked blocks and tanks: one property each, no mailbox kind, a closed roof.
  const ids = new Set(list.map((b) => b.id)), properties = new Set(buildingSites(list).map((b) => b.id));
  assert.equal(ids.size, list.length, 'ids are unique');
  for (const b of list.filter((b) => b.shape)) {
    assert.ok((b.shape === 'block' || b.shape === 'tank') && b.kind === 'large' && b.site === undefined, `${area.id} ${b.id}: a large shape has kind large and no site`);
    const rootId = b.buildingId ?? b.id, rootItem = list.find((x) => x.id === rootId);
    assert.ok(rootItem?.shape === b.shape && properties.has(rootId) && (b.id === rootId || !properties.has(b.id)), `${area.id} ${b.id}: one property for each large building`);
    assert.ok(b.shape !== 'tank' || (b.buildingId === undefined && b.length === b.width), `${area.id} ${b.id}: a tank is one round item`);
    assert.ok(b.shape !== 'tank' || (b.footprint.length === 32 && b.footprint.every(([e, n]) => Math.abs(Math.hypot(e - b.x, n - b.y) - b.length / 2) < .03)),
      `${area.id} ${b.id}: a tank's footprint is 32 points on its circle`);
    rays += roofed(b, v, 2.5).rays;
    assert.ok(sampleGround, `${area.id} ${b.id} (${b.shape}): manifest missing origin or height for terrain grounding check`);
    let lowest = Infinity;
    for (const [e, n] of perimeterPoints(b)) {
      const h = sampleGround(e, n, b.id);
      assert.ok(h !== null && Number.isFinite(h), `${area.id} ${b.id} (${b.shape}): missing terrain tile coverage at (${e.toFixed(1)}, ${n.toFixed(1)})`);
      if (h < lowest) lowest = h;
    }
    for (const exag of [1.5, 2.5]) {
      const footY = minY(b, v, exag), groundY = lowest * exag;
      assert.ok(footY <= groundY - 0.5, `${area.id} ${b.id} (${b.shape}) floats at exag=${exag}: foot ${footY.toFixed(2)} > ground ${groundY.toFixed(2)}`);
    }
    grounded++;
  }
  const blockGroups = new Map();
  for (const b of list.filter((x) => x.shape === 'block')) {
    const rootId = b.buildingId ?? b.id;
    if (!blockGroups.has(rootId)) blockGroups.set(rootId, []);
    blockGroups.get(rootId).push(b);
  }
  for (const [rootId, grp] of blockGroups) {
    if (grp.length < 2) continue;
    grp.sort((x, y) => (x.id === rootId ? -1 : y.id === rootId ? 1 : x.id - y.id));
    rays += assembledJoints(grp, v, styles, `${area.id} ${rootId}`);
  }
  assert.equal(roofSites(list).length, buildingSites(list).length + list.filter((b) => b.shape && b.buildingId !== undefined && b.buildingId !== b.id).length);
  assert.ok(list.filter((b) => b.shape).every((b) => roofSites(list).includes(b)), `${area.id}: every block and tank is cleared in the 1884 scene`);
  areas++; large += result.large; zones += result.zones;
  report.push(`${area.id} ${result.large} in ${result.zones} zones`);
}
assert.ok(areas > 0, 'at least one baked area');
console.log(`PASS: no block or tank in a hand-built site (${report.join('; ')}); planted ones are found in every zone; ${rays} roof/joint rays find a closed roof; ${grounded} shapes grounded across levels 3..8 at 1.5x and 2.5x.`);
