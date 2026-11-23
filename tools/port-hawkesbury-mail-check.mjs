// Node check for Town of Port Hawkesbury no-mailbox boundary, Post Office scenery model, and pipeline step 29.
// Run via: node tools/run-node-check.mjs tools/port-hawkesbury-mail-check.mjs [--mutations]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import {
  PH_POST_OFFICE,
  PORT_HAWKESBURY_BOUNDARY,
  PORT_HAWKESBURY_BOUNDARY_SOURCE,
  PORT_HAWKESBURY_BOUNDS,
  filterPointTupperProps,
  inPortHawkesbury,
  poToLocal,
  poToMap,
  postOfficeClear,
  postOfficeReplaceBuildings,
  postOfficeReplacedIds,
  postOfficeRoofAt,
  postOfficeSolids,
} from '../web/src/port-hawkesbury-mail.ts';
import { PortHawkesburyPostOffice } from '../web/src/ph-post-office.ts';
import { Props } from '../web/src/props.ts';
import { pushOut } from '../web/src/parked.ts';
import { CORNER_SLACK } from '../web/src/site-solids.ts';

const ROOT = process.env.MMM_ROOT ?? process.cwd();
const MAIN_TS = process.env.MMM_MAIN_TS ?? join(ROOT, 'web/src/main.ts');
const AREA = join(ROOT, 'data/baked/areas/pointtupper');
const HAS_DATA = existsSync(join(AREA, 'props.json')) && existsSync(join(AREA, 'buildings.json')) && existsSync(join(AREA, 'roads.json'));
const VILLAGE = [628151.016, 5052750.5];

const stubTerrain = {
  low: false,
  exag: 1.5,
  seaLevel: -0.2,
  surfaceAt: () => ({ level: 8, ground: 16.7 }),
  heightAt: () => 16.7,
  levelAt: () => 8,
  constructionHeightAt: () => 16.7,
};

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 1. Boundary integrity and public source attribution.
assert.ok(PORT_HAWKESBURY_BOUNDARY.length >= 200, 'boundary polygon should keep municipal detail');
assert.match(PORT_HAWKESBURY_BOUNDARY_SOURCE, /Service Nova Scotia/i);
assert.match(PORT_HAWKESBURY_BOUNDARY_SOURCE, /Town of Port Hawkesbury/i);
{
  let area2 = 0;
  const r = PORT_HAWKESBURY_BOUNDARY;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) area2 += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  const areaSqKm = Math.abs(area2) / 2e6;
  assert.ok(areaSqKm > 7.5 && areaSqKm < 9.0, `unexpected municipal area ${areaSqKm.toFixed(2)} km^2`);
}
// Inside Town of Port Hawkesbury: Post Office (Pitt St), Reeves St, Granville St.
assert.equal(inPortHawkesbury(PH_POST_OFFICE.frame.e, PH_POST_OFFICE.frame.n), true, 'Post Office is inside town limits');
assert.equal(inPortHawkesbury(628241, 5052613), true, 'Reeves St is inside town limits');
assert.equal(inPortHawkesbury(627728, 5052338), true, 'Granville Green is inside town limits');
// Outside Town of Port Hawkesbury: Point Tupper, Port Hastings, Mulgrave, Mabou.
assert.equal(inPortHawkesbury(628600, 5049200), false, 'Point Tupper industrial area is outside town limits');
assert.equal(inPortHawkesbury(624800, 5056400), false, 'Port Hastings is outside town limits');
assert.equal(inPortHawkesbury(625800, 5051600), false, 'Mulgrave is outside town limits');
assert.equal(inPortHawkesbury(624300, 5103400), false, 'Mabou is outside town limits');
assert.ok(PORT_HAWKESBURY_BOUNDS[0] < PORT_HAWKESBURY_BOUNDS[2] && PORT_HAWKESBURY_BOUNDS[1] < PORT_HAWKESBURY_BOUNDS[3]);

// 2. Generic Post Office sign only: no brand wording and no civic street-number patterns in source modules.
assert.equal(PH_POST_OFFICE.signText, 'POST OFFICE');
assert.doesNotMatch(PH_POST_OFFICE.signText, /canada\s*post/i);
for (const rel of ['web/src/port-hawkesbury-mail.ts', 'web/src/ph-post-office.ts']) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  assert.doesNotMatch(src, /\b\d{1,5}\s+[A-Z][a-z]+\s+(?:St|Street|Rd|Road|Ln|Lane|Ave|Avenue)\b/, `${rel} must not contain civic street addresses`);
}

// 3. Synthetic legacy + clean props filtering, building replacement & renumbering, shared-frame normalization, and Props cells.
{
  const poMain = { id: 149, x: PH_POST_OFFICE.replaces[0][0], y: PH_POST_OFFICE.replaces[0][1] };
  const poWingA = { id: 3081, buildingId: 149, x: PH_POST_OFFICE.replaces[1][0], y: PH_POST_OFFICE.replaces[1][1], site: poMain };
  const poWingB = { id: 3082, buildingId: 149, x: PH_POST_OFFICE.frame.e + 12, y: PH_POST_OFFICE.frame.n + 14, site: poMain };
  const neighbour = { id: 500, x: PH_POST_OFFICE.frame.e + 120, y: PH_POST_OFFICE.frame.n + 120 };
  const synthBuildings = [poMain, poWingA, poWingB, neighbour];

  // Unconditional building replacement check (runs even without data/ in clean-clone CI).
  assert.deepEqual(postOfficeReplaceBuildings(synthBuildings).map(b => b.id), [500], 'replaces Post Office + wings, keeps neighbour');
  assert.deepEqual([...postOfficeReplacedIds(synthBuildings)].sort((a, b) => a - b), [149, 3081, 3082]);

  // Renumbered rebake fixture: Post Office gets new IDs (9149/93081/93082) and an unrelated building 600 m away gets old ID 149.
  const reMain = { id: 9149, x: poMain.x, y: poMain.y };
  const reWingA = { id: 93081, buildingId: 9149, x: poWingA.x, y: poWingA.y, site: reMain };
  const reWingB = { id: 93082, buildingId: 9149, x: poWingB.x, y: poWingB.y, site: reMain };
  const unrelated149 = { id: 149, x: PH_POST_OFFICE.frame.e + 450, y: PH_POST_OFFICE.frame.n + 420 };
  const reBuildings = [reMain, reWingA, reWingB, unrelated149];
  assert.deepEqual(postOfficeReplaceBuildings(reBuildings).map(b => b.id), [149], 'renumbered Post Office removed, unrelated 149 kept');
  const reIds = postOfficeReplacedIds(reBuildings);
  assert.deepEqual([...reIds].sort((a, b) => a - b), [9149, 93081, 93082]);

  const outsideA = { x: 628950, y: 5049600, heading: 90, style: 0, tilt: 0, group: 10, parcelBox: false };
  const insidePartner = { x: 627850, y: 5052450, heading: 90, style: 0, tilt: 0, group: 10, parcelBox: false };
  const insideSolo = { x: 628100, y: 5052650, heading: 180, style: 2, tilt: 0, group: null, parcelBox: true };
  const outsidePairA = { x: 629100, y: 5049500, heading: 45, style: 1, tilt: 0, group: 20, parcelBox: false };
  const outsidePairB = { x: 629101, y: 5049500, heading: 45, style: 1, tilt: 0, group: 20, parcelBox: false };
  const synthetic = {
    crs: 'EPSG:2961',
    mailboxes: [outsideA, insidePartner, insideSolo, outsidePairA, outsidePairB],
    communityBoxes: [
      { x: 627900, y: 5052500, heading: 0, modules: 2 },
      { x: 629050, y: 5049550, heading: 0, modules: 2 },
    ],
    poles: [{ x: 627820, y: 5052400, heading: 47, road: 181, n: 0, transformer: false, light: true }],
    serviceDrops: [
      { building: 149, road: 181, n: 0, x: 627800, y: 5052400, height: 3.0, ground: 16.7, groundX: 627800, groundY: 5052400 },
      { building: 500, road: 181, n: 1, x: 627920, y: 5052520, height: 3.5, ground: 18.0, groundX: 627920, groundY: 5052520 },
    ],
  };

  // Non-pointtupper areas stay untouched.
  assert.equal(filterPointTupperProps(synthetic, 'mabou'), synthetic, 'filterPointTupperProps must not touch non-pointtupper areas');

  // Legacy Point Tupper fixture (with inside-town boxes) strips every mailbox and cabinet inside town limits.
  const origIds = postOfficeReplacedIds(synthBuildings);
  const filtered = filterPointTupperProps(synthetic, 'pointtupper', origIds);
  assert.equal(filtered.mailboxes.length, 3, 'both inside-town mailboxes removed, 3 outside kept');
  assert.equal(filtered.mailboxes.filter(m => inPortHawkesbury(m.x, m.y)).length, 0);
  assert.equal(filtered.mailboxes[0].group, null, 'straddling shared frame reduced to 1 box becomes a single post');
  assert.equal(filtered.mailboxes[1].group, 20, 'intact outside shared frame keeps its group');
  assert.equal(filtered.mailboxes[2].group, 20);
  assert.equal(filtered.communityBoxes.length, 1, 'inside-town community box removed, outside kept');
  assert.equal(filtered.poles.length, 1, 'poles inside town remain intact');
  assert.equal(filtered.serviceDrops[0].height, PH_POST_OFFICE.serviceDrop.height, 'Post Office drop re-aimed');
  assert.equal(filtered.serviceDrops[0].ground, null);
  assert.equal(filtered.serviceDrops[1].x, 627920, 'neighbour drop untouched');

  // Renumbered utility drops: Post Office (9149) re-aimed, unrelated building given old ID 149 stays untouched.
  const reProps = {
    ...synthetic,
    serviceDrops: [
      { building: 9149, road: 181, n: 0, x: 627800, y: 5052400, height: 3.0, ground: 16.7, groundX: 627800, groundY: 5052400 },
      { building: 149, road: 200, n: 0, x: 628256, y: 5052833, height: 3.4, ground: 21.0, groundX: 628256, groundY: 5052833 },
    ],
  };
  const reFiltered = filterPointTupperProps(reProps, 'pointtupper', reIds);
  const movedDrop = reFiltered.serviceDrops.find(d => d.building === 9149);
  const otherDrop = reFiltered.serviceDrops.find(d => d.building === 149);
  const [mdx, mdz] = poToLocal(movedDrop.x, movedDrop.y);
  assert.ok(Math.abs(mdx - PH_POST_OFFICE.serviceDrop.x) < 0.01 && Math.abs(mdz - PH_POST_OFFICE.serviceDrop.z) < 0.01, 'renumbered Post Office wire re-aimed');
  assert.equal(movedDrop.height, PH_POST_OFFICE.serviceDrop.height);
  assert.equal(movedDrop.ground, null);
  assert.deepEqual(otherDrop, reProps.serviceDrops[1], 'unrelated building with old ID 149 keeps its wire untouched');

  // Clean fresh-bake fixture (already 0 inside-town boxes) passes through cleanly.
  const cleanBake = { ...synthetic, mailboxes: [outsideA, outsidePairA, outsidePairB].map(m => ({ ...m, group: m.group === 10 ? null : m.group })), communityBoxes: [] };
  const cleanFiltered = filterPointTupperProps(cleanBake, 'pointtupper', origIds);
  assert.equal(cleanFiltered.mailboxes.length, 3);
  assert.equal(cleanFiltered.communityBoxes.length, 0);

  // Instantiating Props with filtered data draws zero mailboxes, posts, or community cabinets inside town limits.
  const propsObj = new Props(filtered, VILLAGE, stubTerrain);
  assert.equal(propsObj.mail.length, 3);
  assert.equal(propsObj.mail.filter(m => inPortHawkesbury(VILLAGE[0] + m.x, VILLAGE[1] - m.z)).length, 0);
  assert.equal(propsObj.sites.filter(s => inPortHawkesbury(VILLAGE[0] + s.x, VILLAGE[1] - s.z)).length, 0);
  const railInTown = propsObj.railObstacles.filter(o => inPortHawkesbury(VILLAGE[0] + o.x, VILLAGE[1] - o.z));
  assert.equal(railInTown.length, 1, 'only the pole is a rail obstacle in town, never a mailbox or cabinet');
  const poWorldX = PH_POST_OFFICE.frame.e - VILLAGE[0], poWorldZ = VILLAGE[1] - PH_POST_OFFICE.frame.n;
  propsObj.update({ getWorldPosition: v => v.set(poWorldX, 16.7, poWorldZ) }, 0);
  const cellName = `Props cell ${Math.floor(poWorldX / 256)},${Math.floor(poWorldZ / 256)}`;
  const drawnNames = [];
  propsObj.group.traverse(o => {
    if (o.isInstancedMesh && o.parent?.name === cellName) drawnNames.push(o.name);
  });
  assert.ok(!drawnNames.includes('cabinet'), `town cell must draw no community cabinet meshes, saw ${drawnNames}`);
  assert.ok(!drawnNames.includes('post') && !drawnNames.includes('wood'), `town cell must draw no mailbox posts, saw ${drawnNames}`);
}

// 4. Post Office solids (including rear loading dock platform and SW lobby landing), clear boxes, and lazy proximity gate.
{
  const solids = postOfficeSolids(VILLAGE);
  assert.ok(solids.length >= 8, 'Post Office has strip-cut solids for building, loading dock, SW landing, flagpole and letter box');
  for (const s of solids) {
    assert.ok(s.half >= s.halfWidth && Math.hypot(s.half, s.halfWidth) - s.half <= CORNER_SLACK + 1e-9, 'solid is strip-cut');
    const vx = Math.cos(s.heading), vz = Math.sin(s.heading);
    const car = { x: s.x, z: s.z, vx: 0, vz: 0, speed: 0, heading: 0 };
    pushOut(car, [s]);
    assert.ok(Math.hypot(car.x - s.x, car.z - s.z) > 0.01, 'solid pushes car out');
    const far = { x: s.x + vx * (s.halfWidth + 3), z: s.z + vz * (s.halfWidth + 3), vx: 0, vz: 0, speed: 0, heading: 0 };
    pushOut(far, [s]);
    assert.ok(Math.hypot(far.x - (s.x + vx * (s.halfWidth + 3)), far.z - (s.z + vz * (s.halfWidth + 3))) < 1e-9, 'car 3 m away untouched');
  }
  const wallAz = (PH_POST_OFFICE.frame.az * Math.PI) / 180;
  for (const [label, lx, lz, h] of [['loading dock outer edge', 2.25, -13.4, wallAz + Math.PI / 2], ['SW lobby rail', -6.5, 10.4, wallAz]]) {
    const [e, n] = poToMap(lx, lz);
    const x = e - VILLAGE[0], z = VILLAGE[1] - n;
    const car = { x, z, vx: 0, vz: 0, speed: 0, heading: h };
    pushOut(car, solids);
    assert.ok(Math.hypot(car.x - x, car.z - z) > 0.05, `${label} must push car out`);
  }
  const clear = postOfficeClear(VILLAGE);
  assert.equal(clear.length, PH_POST_OFFICE.rects.length + PH_POST_OFFICE.pads.length);

  // Lazy proximity check: pointtupper-start (village origin, 476 m away) must NOT build the Post Office.
  const po = new PortHawkesburyPostOffice(VILLAGE, stubTerrain, false);
  po.update({ x: 0, z: 0 }, 1000);
  assert.equal(po.built, false, 'Post Office stays unbuilt at pointtupper-start (476 m away)');
  assert.equal(po.group.children.length, 0);
  assert.equal(po.triangles, 0);

  // Hand-built roof heights for the camera drone floor: main block, NE entrance vestibule, rear wing, and off-roof.
  const baseY = 16.7 + 0.15;
  for (const [label, lx, lz, expected] of [
    ['main block roof', 0, 0, baseY + 6.68],
    ['NE entrance vestibule roof', 12.4, 6.4, baseY + 5.18],
    ['NE entrance canopy', 12.1, 10.0, baseY + 3.09],
    ['rear NW wing roof', 9.0, -16.0, baseY + 6.18],
    ['off-building Pitt Street', 0, 20.0, -Infinity],
  ]) {
    const [e, n] = poToMap(lx, lz);
    const wx = e - VILLAGE[0], wz = VILLAGE[1] - n;
    assert.equal(postOfficeRoofAt(wx, wz, VILLAGE, baseY), expected, `postOfficeRoofAt ${label}`);
    assert.equal(po.roofAt(wx, wz), expected, `PortHawkesburyPostOffice.roofAt ${label}`);
  }
}

// 5. Real baked Point Tupper land checks (supports BOTH legacy baked land and clean fresh bakes; skipped if data/ is absent).
if (HAS_DATA) {
  const manifest = JSON.parse(readFileSync(join(AREA, 'manifest.json'), 'utf8'));
  const rawProps = JSON.parse(readFileSync(join(AREA, 'props.json'), 'utf8'));
  const rawBuildings = JSON.parse(readFileSync(join(AREA, 'buildings.json'), 'utf8')).buildings;
  const rawRoads = JSON.parse(readFileSync(join(AREA, 'roads.json'), 'utf8'));
  const V = manifest.village;

  const rawInside = rawProps.mailboxes.filter(m => inPortHawkesbury(m.x, m.y));
  const rawOutside = rawProps.mailboxes.filter(m => !inPortHawkesbury(m.x, m.y));
  assert.ok(rawOutside.length >= 600, `expected outside boxes to preserve, got ${rawOutside.length}`);

  const replacedIds = postOfficeReplacedIds(rawBuildings);
  const filtered = filterPointTupperProps(rawProps, 'pointtupper', replacedIds);
  assert.equal(filtered.mailboxes.length, rawOutside.length, 'every outside mailbox preserved, every inside mailbox removed');
  assert.equal(filtered.mailboxes.filter(m => inPortHawkesbury(m.x, m.y)).length, 0, 'ZERO mailboxes inside Town of Port Hawkesbury');
  assert.equal(filtered.poles.length, rawProps.poles.length, 'all poles preserved');

  const propsObj = new Props(filtered, V, stubTerrain);
  assert.equal(propsObj.mail.filter(m => inPortHawkesbury(V[0] + m.x, V[1] - m.z)).length, 0);
  assert.equal(propsObj.mail.length, rawOutside.length);
  assert.equal(propsObj.sites.filter(s => inPortHawkesbury(V[0] + s.x, V[1] - s.z)).length, 0);

  // Building replacement removes 149, 3081, 3082 (and works when renumbered).
  const kept = postOfficeReplaceBuildings(rawBuildings);
  const removedIds = rawBuildings.filter(b => !kept.includes(b)).map(b => b.id).sort((a, b) => a - b);
  assert.deepEqual(removedIds, [149, 3081, 3082]);
  const renumbered = rawBuildings.map(b => ({ ...b, id: b.id + 9000, ...(b.buildingId === undefined ? {} : { buildingId: b.buildingId + 9000 }) }));
  assert.deepEqual(postOfficeReplaceBuildings(renumbered).map(b => [b.x, b.y]), kept.map(b => [b.x, b.y]));

  // Service drop for the replaced Post Office building lands on the SE front wall below the 6.5 m cornice.
  const poDrop = filtered.serviceDrops.find(d => replacedIds.has(d.building));
  assert.ok(poDrop, 'service drop for replaced Post Office building exists');
  const [dlx, dlz] = poToLocal(poDrop.x, poDrop.y);
  const [mx0, mx1, , mz1] = PH_POST_OFFICE.rects[0];
  assert.ok(dlx >= mx0 - 0.1 && dlx <= mx1 + 0.1 && Math.abs(dlz - mz1) < 0.15, `Post Office drop on SE wall (${dlx.toFixed(2)}, ${dlz.toFixed(2)})`);
  assert.ok(poDrop.height > 3.0 && poDrop.height < 6.0 && poDrop.ground === null);

  // Every solid corner and pad edge clears every road carriageway and kept building.
  const nearRoads = rawRoads.roads.filter(r => r.pts.some(([e, n]) => Math.hypot(e - PH_POST_OFFICE.frame.e, n - PH_POST_OFFICE.frame.n) < 120));
  const roadGap = (e, n) => Math.min(...nearRoads.flatMap(r => r.pts.slice(1).map((q, i) => segDist([e, n], r.pts[i], q) - r.halfWidth)));
  for (const s of postOfficeSolids(V)) {
    const ux = Math.sin(s.heading), uz = -Math.cos(s.heading), vx = Math.cos(s.heading), vz = Math.sin(s.heading);
    for (const [i, j] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const e = V[0] + s.x + ux * s.half * i + vx * s.halfWidth * j;
      const n = V[1] - (s.z + uz * s.half * i + vz * s.halfWidth * j);
      const gap = roadGap(e, n);
      assert.ok(gap >= 0.8, `Post Office solid within ${gap.toFixed(2)} m of a carriageway at ${e.toFixed(1)},${n.toFixed(1)}`);
    }
  }
  const keptRings = kept
    .filter(b => Math.hypot(b.x - PH_POST_OFFICE.frame.e, b.y - PH_POST_OFFICE.frame.n) < 100)
    .map(b => b.footprint);
  const edgeSamples = r => {
    const q = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([x, z]) => poToMap(x, z));
    return q.flatMap((a, i) => {
      const b = q[(i + 1) % 4], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    });
  };
  for (const pad of PH_POST_OFFICE.pads) {
    for (const pt of edgeSamples(pad)) {
      const gap = roadGap(pt[0], pt[1]);
      assert.ok(gap >= 0.35, `Post Office pad edge within ${gap.toFixed(2)} m of a carriageway at ${pt[0].toFixed(1)},${pt[1].toFixed(1)}`);
      assert.ok(!keptRings.some(ring => inRing(pt, ring)), `Post Office pad overlaps a kept building at ${pt}`);
    }
  }
  for (const rect of [...PH_POST_OFFICE.rects, ...PH_POST_OFFICE.solidExtras]) {
    for (const pt of edgeSamples(rect)) {
      assert.ok(!keptRings.some(ring => inRing(pt, ring)), `Post Office structure overlaps a kept building at ${pt}`);
    }
  }
  console.log(`PASS real pointtupper data: ${rawInside.length} town boxes filtered, ${rawOutside.length} outside kept`);
} else {
  console.log('NOTE data/baked/areas/pointtupper absent: ran synthetic + pipeline checks only');
}

// 6. Pipeline check: areas.py declares POINTTUPPER.no_mailbox_polygons and 29_bake_props.py filters placed box locations
// (removing boxes inside Port Hawkesbury while preserving any physical box outside the boundary, even if its house sits just inside).
function pipelineCheckScript(modulePath) {
  return `
import sys, importlib.util
from pathlib import Path
sys.path.insert(0, 'pipeline')
import areas
assert areas.POINTTUPPER.no_mailbox_polygons == ('web/src/port-hawkesbury-boundary.json',), areas.POINTTUPPER.no_mailbox_polygons
assert areas.MABOU.no_mailbox_polygons == ()
if importlib.util.find_spec('osgeo') is None:
    print('NOTE osgeo absent: verified areas.py only')
    raise SystemExit(0)
spec = importlib.util.spec_from_file_location('bake_props', ${JSON.stringify(modulePath)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.ROOT = Path.cwd()
polys = mod.load_no_box_polygons(areas.POINTTUPPER.no_mailbox_polygons)
assert len(polys) == 1
assert mod.in_no_box_polygon((627806.27, 5052413.92), polys) is True
assert mod.in_no_box_polygon((628950.0, 5049600.0), polys) is False
e_max = max(p[0] for p in polys[0][4])
n_at_max = next(p[1] for p in polys[0][4] if p[0] == e_max)
house_near_edge = (e_max - 20.0, n_at_max)
assert mod.in_no_box_polygon(house_near_edge, polys) is True
assert mod.in_no_box_polygon((e_max + 25.0, n_at_max), polys) is False
roads = [
  {'id': 1, 'kind': 2, 'halfWidth': 3.0, 'bridge': False, 'pts': [[627780.0, 5052430.0], [627840.0, 5052430.0]]},
  {'id': 2, 'kind': 2, 'halfWidth': 3.0, 'bridge': False, 'pts': [[628900.0, 5049600.0], [629000.0, 5049600.0]]},
  {'id': 3, 'kind': 2, 'halfWidth': 3.0, 'bridge': False, 'pts': [[e_max + 25.0, n_at_max - 30.0], [e_max + 25.0, n_at_max + 30.0]]},
]
net = mod.Network(roads)
houses = [
  {'id': 10, 'kind': 'house', 'x': 627810.0, 'y': 5052412.0, 'length': 10.0, 'width': 8.0, 'axisDeg': 0.0},
  {'id': 20, 'kind': 'house', 'x': 628950.0, 'y': 5049582.0, 'length': 10.0, 'width': 8.0, 'axisDeg': 0.0},
  {'id': 30, 'kind': 'house', 'x': house_near_edge[0], 'y': house_near_edge[1], 'length': 10.0, 'width': 8.0, 'axisDeg': 0.0},
]
safe = lambda p, on=None: True
boxes_all, _ = mod.place_mailboxes(net, net, houses, [], [], safe, (0.0, 0.0), 0.0)
assert len(boxes_all) == 3, f'unfiltered expected 3, got {len(boxes_all)}'
boxes_ph, _ = mod.place_mailboxes(net, net, houses, [], [], safe, (0.0, 0.0), 0.0, no_box_polys=polys)
assert len(boxes_ph) == 2, f'filtered expected 2 (Point Tupper + outside-boundary road box), got {len(boxes_ph)}'
assert all(not mod.in_no_box_polygon((b['x'], b['y']), polys) for b in boxes_ph)
assert len(mod.boxes_in_sites(boxes_all, (), polys)) == 1
assert len(mod.boxes_in_sites(boxes_ph, (), polys)) == 0
print('PASS pipeline 29_bake_props no_box_polys')
`;
}
execFileSync('python3', ['-c', pipelineCheckScript('pipeline/29_bake_props.py')], { cwd: ROOT, stdio: 'inherit' });

// 7. Wiring check in web/src/main.ts.
{
  const mainSrc = readFileSync(MAIN_TS, 'utf8');
  assert.match(mainSrc, /filterPointTupperProps\(/, 'main.ts filters Point Tupper props');
  assert.match(mainSrc, /postOfficeReplaceBuildings\(/, 'main.ts replaces the surveyed Post Office building');
  assert.match(mainSrc, /postOfficeReplacedIds\(/, 'main.ts resolves replaced Post Office building IDs by position');
  assert.match(mainSrc, /postOffice\.roofAt\(/, 'main.ts feeds hand-built Post Office roofs to the drone floor');
  assert.match(mainSrc, /postOfficeClear\(/, 'main.ts clears trees and lot props under the Post Office');
  assert.match(mainSrc, /import\('\.\/ph-post-office'\)/, 'main.ts lazily loads the Post Office chunk');
}

console.log('PASS port-hawkesbury-mail-check');

// 8. Mutation tests (--mutations).
if (process.argv.includes('--mutations')) {
  const mutants = [
    {
      name: 'skip-town-filter',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const keptBoxes = rawBoxes.filter(m => !inPortHawkesbury(m.x, m.y));',
      to: 'const keptBoxes = rawBoxes.slice();',
    },
    {
      name: 'skip-singleton-frame-reset',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const mailboxes = keptBoxes.map(m => m.group !== null && (groupCounts.get(m.group) ?? 0) < 2 ? { ...m, group: null } : m);',
      to: 'const mailboxes = keptBoxes;',
    },
    {
      name: 'skip-loading-dock-solid',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const raw: Solid[] = [...PH_POST_OFFICE.rects, ...PH_POST_OFFICE.solidExtras].map(([x0, x1, z0, z1]) => {',
      to: 'const raw: Solid[] = PH_POST_OFFICE.rects.map(([x0, x1, z0, z1]) => {',
    },
    {
      name: 'skip-building-replacement',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'return list.filter(b => !replaced.has(b.id) && !replaced.has(b.buildingId ?? b.id));',
      to: 'return list;',
    },
    {
      name: 'skip-service-drop-reaim',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'return drops.map(d => buildingIds.has(d.building)',
      to: 'return drops.map(d => false && buildingIds.has(d.building)',
    },
    {
      name: 'skip-drone-roof',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'if (lx > r[0] - 1 && lx < r[1] + 1 && lz > r[2] - 1 && lz < r[3] + 1) top = h;',
      to: 'if (false && lx > r[0] - 1) top = h;',
    },
    {
      name: 'skip-main-wiring',
      file: 'web/src/main.ts',
      from: 'const data = filterPointTupperProps(mabouAimed, AREA.id, postOfficeReplaced);',
      to: 'const data = mabouAimed;',
      expectError: /main\.ts filters Point Tupper props/,
    },
  ];

  const dir = mkdtempSync(join(tmpdir(), 'mmm-ph-mail-mut-'));
  try {
    const baseBundle = join(dir, 'base.mjs');
    await build({
      entryPoints: [resolve(ROOT, 'tools/port-hawkesbury-mail-check.mjs')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile: baseBundle,
      logLevel: 'silent',
      plugins: [{ name: 'ext', setup(b) { b.onResolve({ filter: /esbuild\/lib\/main\.js$/ }, a => ({ path: resolve(a.resolveDir, a.path), external: true })); } }],
    });

    for (const m of mutants) {
      const targetAbs = realpathSync(resolve(ROOT, m.file));
      const original = readFileSync(targetAbs, 'utf8');
      assert.ok(original.includes(m.from), `mutant ${m.name} anchor missing in ${m.file}`);
      const mutated = original.replace(m.from, m.to);
      let res;
      if (m.file === 'web/src/main.ts') {
        const mutMain = join(dir, `${m.name}-main.ts`);
        writeFileSync(mutMain, mutated);
        const ctrl = spawnSync(process.execPath, [baseBundle], { env: { ...process.env, MMM_ROOT: ROOT, MMM_MAIN_TS: targetAbs }, stdio: 'pipe' });
        assert.equal(ctrl.status, 0, `main.ts control failed: ${ctrl.stderr}`);
        res = spawnSync(process.execPath, [baseBundle], { env: { ...process.env, MMM_ROOT: ROOT, MMM_MAIN_TS: mutMain }, stdio: 'pipe' });
        assert.match(res.stderr.toString(), m.expectError, `mutant ${m.name} failed for wrong reason: ${res.stderr}`);
      } else {
        const out = join(dir, `${m.name}.mjs`);
        await build({
          entryPoints: [resolve(ROOT, 'tools/port-hawkesbury-mail-check.mjs')],
          bundle: true,
          platform: 'node',
          format: 'esm',
          outfile: out,
          logLevel: 'silent',
          plugins: [
            {
              name: 'mutate',
              setup(b) {
                b.onResolve({ filter: /esbuild\/lib\/main\.js$/ }, a => ({ path: resolve(a.resolveDir, a.path), external: true }));
                b.onLoad({ filter: /.*/ }, a => {
                  if (existsSync(a.path) && realpathSync(a.path) === targetAbs) return { contents: mutated, loader: a.path.endsWith('.ts') ? 'ts' : 'js' };
                  return null;
                });
              },
            },
          ],
        });
        res = spawnSync(process.execPath, [out], { env: { ...process.env, MMM_ROOT: ROOT }, stdio: 'pipe' });
      }
      assert.notEqual(res.status, 0, `mutant ${m.name} SURVIVED!`);
      console.log(`KILLED ${m.name}`);
    }
    // Pipeline mutant: verify an unmodified temp copy PASSES first, then confirm skipping no_box_polys FAILS with AssertionError.
    const pipeSrc = readFileSync(join(ROOT, 'pipeline/29_bake_props.py'), 'utf8');
    const anchor = "if in_no_box_polygon((box['x'], box['y']), no_box_polys):";
    assert.ok(pipeSrc.includes(anchor), 'pipeline mutant anchor present');
    const hasOsgeo = spawnSync('python3', ['-c', 'import osgeo'], { stdio: 'pipe' }).status === 0;
    if (hasOsgeo) {
      const ctrlPipe = join(dir, '29_bake_props_ctrl.py');
      writeFileSync(ctrlPipe, pipeSrc);
      const pyCtrl = spawnSync('python3', ['-c', pipelineCheckScript(ctrlPipe)], { cwd: ROOT, stdio: 'pipe' });
      assert.equal(pyCtrl.status, 0, `unmodified temp copy of 29_bake_props.py must pass: ${pyCtrl.stderr}`);

      const mutPipe = join(dir, '29_bake_props_mut.py');
      writeFileSync(mutPipe, pipeSrc.replace(anchor, 'if False:'));
      const pyMut = spawnSync('python3', ['-c', pipelineCheckScript(mutPipe)], { cwd: ROOT, stdio: 'pipe' });
      assert.notEqual(pyMut.status, 0, 'pipeline mutant skip-no-box-polys SURVIVED!');
      assert.match(pyMut.stderr.toString(), /AssertionError/, `pipeline mutant failed for wrong reason: ${pyMut.stderr}`);
      console.log('KILLED pipeline-skip-no-box-polys');
    } else {
      console.log('NOTE osgeo absent: skipped pipeline-skip-no-box-polys');
    }
    console.log(`PASS port-hawkesbury-mail-mutations (${mutants.length + (hasOsgeo ? 1 : 0)} killed)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
