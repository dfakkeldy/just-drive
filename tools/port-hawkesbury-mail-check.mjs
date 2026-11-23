// Node check for Town of Port Hawkesbury no-mailbox boundary, route rules, Post Office site, and pipeline step 29.
// Run via: node tools/run-node-check.mjs tools/port-hawkesbury-mail-check.mjs [--mutations]
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import {
  PH_POST_OFFICE,
  PORT_HAWKESBURY_BOUNDARY,
  PORT_HAWKESBURY_BOUNDARY_SOURCE,
  PORT_HAWKESBURY_BOUNDS,
  aimPostOfficeDrops,
  countPortHawkesburyHouses,
  filterPointTupperProps,
  inPortHawkesbury,
  poToLocal,
  poToMap,
  postOfficeClear,
  postOfficeDropMap,
  postOfficeReplaceBuildings,
  postOfficeSolids,
} from '../web/src/port-hawkesbury-mail.ts';
import { PortHawkesburyPostOffice } from '../web/src/ph-post-office.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { Route, buildPointTupperRoute } from '../web/src/route.ts';
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

// 3. Synthetic legacy + clean props filtering, shared-frame normalization, non-pointtupper pass-through, and Props mail/drop behaviour.
{
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
    serviceDrops: [{ building: 149, road: 181, n: 0, x: 627800, y: 5052400, height: 3.0, ground: 16.7, groundX: 627800, groundY: 5052400 }],
  };

  // Non-pointtupper areas stay untouched.
  const mabouOut = filterPointTupperProps(synthetic, 'mabou', 50);
  assert.equal(mabouOut, synthetic, 'filterPointTupperProps must not touch non-pointtupper areas');

  // Legacy Point Tupper fixture (with inside-town boxes) filters them out cleanly.
  const filtered = filterPointTupperProps(synthetic, 'pointtupper', 42, true);
  assert.equal(filtered.mailboxes.length, 3, 'both inside-town mailboxes removed, 3 outside kept');
  assert.equal(filtered.mailboxes.filter(m => inPortHawkesbury(m.x, m.y)).length, 0);
  assert.equal(filtered.mailboxes[0].group, null, 'straddling shared frame reduced to 1 box becomes a single post');
  assert.equal(filtered.mailboxes[1].group, 20, 'intact outside shared frame keeps its group');
  assert.equal(filtered.mailboxes[2].group, 20);
  assert.equal(filtered.communityBoxes.length, 1, 'inside-town community box removed, outside kept');
  assert.equal(filtered.mailDrops.length, 1, 'exactly one town post office drop added');
  assert.equal(filtered.mailDrops[0].customers, 42);
  assert.equal(filtered.mailDrops[0].label, 'Port Hawkesbury Post Office');
  assert.equal(filtered.poles.length, 1, 'poles inside town remain intact');
  assert.equal(filtered.serviceDrops[0].height, PH_POST_OFFICE.serviceDrop.height, 'building 149 drop re-aimed');
  assert.equal(filtered.serviceDrops[0].ground, null);

  // Clean fresh-bake fixture (already 0 inside-town boxes) stays clean and still gets the 1 Post Office drop.
  const cleanBake = { ...synthetic, mailboxes: [outsideA, outsidePairA, outsidePairB].map(m => ({ ...m, group: m.group === 10 ? null : m.group })), communityBoxes: [] };
  const cleanFiltered = filterPointTupperProps(cleanBake, 'pointtupper', 42, true);
  assert.equal(cleanFiltered.mailboxes.length, 3);
  assert.equal(cleanFiltered.mailDrops.length, 1);

  // Instantiating Props with filtered data.
  const propsObj = new Props(filtered, VILLAGE, stubTerrain);
  assert.equal(propsObj.mail.length, 3);
  assert.equal(propsObj.mail.filter(m => inPortHawkesbury(VILLAGE[0] + m.x, VILLAGE[1] - m.z)).length, 0);
  const poSites = propsObj.sites.filter(s => s.kind === 'postOffice');
  assert.equal(poSites.length, 1, 'Props registers the Post Office as one postOffice site');
  assert.equal(poSites[0].customers, 42);
  assert.equal(propsObj.totalCustomers, 3 + 30 + 42, 'totalCustomers includes outside boxes, outside community site (2x15), and town Post Office');
  // Post Office drop does NOT add a community cabinet obstacle to guardrails.
  const railInTown = propsObj.railObstacles.filter(o => inPortHawkesbury(VILLAGE[0] + o.x, VILLAGE[1] - o.z));
  assert.equal(railInTown.length, 1, 'only the pole is a rail obstacle in town, not mailboxes or post office cabinet');
  // Drop hit zone sits cleanly on the open front apron: rejects hits inside the vestibule or main block, accepts apron hits.
  const po = poSites[0];
  const poIndex = propsObj.mail.length + propsObj.sites.indexOf(po);
  const bounds = { x0: po.x - 10, x1: po.x + 10, z0: po.z - 10, z1: po.z + 10 };
  const cands = propsObj.mailCandidates(bounds);
  assert.ok(cands.sites.includes(propsObj.sites.indexOf(po)), 'mailCandidates includes the Post Office drop');
  const [vestE, vestN] = poToMap(12.2, 6.5);
  const vestHit = propsObj.mailHit(vestE - VILLAGE[0], 18.0, VILLAGE[1] - vestN, vestE - VILLAGE[0], 16.7, VILLAGE[1] - vestN, true, cands);
  assert.equal(vestHit, -1, 'mailHit rejects a landing inside the vestibule footprint');
  const [mainE, mainN] = poToMap(0, 0);
  const mainHit = propsObj.mailHit(mainE - VILLAGE[0], 18.0, VILLAGE[1] - mainN, mainE - VILLAGE[0], 16.7, VILLAGE[1] - mainN, true, cands);
  assert.equal(mainHit, -1, 'mailHit rejects a landing inside the main building');
  const hit = propsObj.mailHit(po.x, 18.0, po.z, po.x, 16.7, po.z, true, cands);
  assert.equal(hit, poIndex, 'mailHit lands on the open front Post Office apron');
  assert.equal(propsObj.serve(poIndex), 42, 'first serve delivers all 42 town customers');
  assert.equal(propsObj.serve(poIndex), 0, 'second serve is a no-op');
  // Build the cell around the Post Office and verify zero mailbox or community cabinet meshes are created there.
  propsObj.update({ getWorldPosition: v => v.set(po.x, 16.7, po.z) }, 0);
  const drawnNames = [];
  propsObj.group.traverse(o => {
    if (o.isInstancedMesh && o.parent?.name === `Props cell ${Math.floor(po.x / 256)},${Math.floor(po.z / 256)}`) {
      drawnNames.push(o.name);
    }
  });
  assert.ok(!drawnNames.includes('cabinet'), `Post Office cell must draw no community cabinet meshes, saw ${drawnNames}`);
  assert.ok(!drawnNames.includes('post') && !drawnNames.includes('wood'), `Post Office cell must draw no mailbox posts, saw ${drawnNames}`);
}

// 4. Route: buildPointTupperRoute and Route(roads, props, false, customRun) exclude town houses and include the Post Office + outside rural stops.
{
  const drop = postOfficeDropMap();
  const roadData = {
    roads: [
      { id: 1, name: 'Pitt Street', kind: 2, halfWidth: 3.0, bridge: false, pts: [[drop.x - 30, drop.y + 12], [drop.x + 30, drop.y + 12]] },
      { id: 2, name: 'Point Tupper Road', kind: 2, halfWidth: 3.0, bridge: false, pts: [[628900, 5049600], [629200, 5049600]] },
    ],
  };
  const roads = new Roads(roadData, VILLAGE, stubTerrain);
  const unfilteredProps = {
    mail: [
      { x: 627850 - VILLAGE[0], z: VILLAGE[1] - 5052450, heading: 0, served: false, motion: {} }, // inside Port Hawkesbury
      { x: 628950 - VILLAGE[0], z: VILLAGE[1] - 5049605, heading: 0, served: false, motion: {} }, // outside (Point Tupper)
    ],
    sites: [
      { x: drop.x - VILLAGE[0], z: VILLAGE[1] - drop.y, heading: drop.heading, served: false, customers: 1004, kind: 'postOffice', reach: drop.radius, label: drop.label },
      { x: 627880 - VILLAGE[0], z: VILLAGE[1] - 5052470, heading: 0, served: false, customers: 16, kind: 'community', reach: 4 }, // spurious in-town cabinet
    ],
  };
  Route.reachable = null;
  const run = buildPointTupperRoute(roads, unfilteredProps, VILLAGE);
  assert.deepEqual(run.rural, [1], 'only the outside-town rural mailbox is on the route; town house box excluded');
  assert.deepEqual(run.sites, [2], 'only the Post Office drop is a town site stop');
  assert.equal(run.stops.length, 2);
  assert.equal(run.stops[0].hit.road.name, 'Pitt Street', 'Post Office stop snaps to Pitt Street');
  assert.equal(run.stops[1].hit.road.name, 'Point Tupper Road');

  const routeObj = new Route(roads, unfilteredProps, false, run);
  assert.equal(routeObj.runs.length, 1);
  assert.equal(routeObj.forDay(1).stops.length, 2);
  assert.equal(routeObj.members.get(2)?.hit.road.name, 'Pitt Street');
  assert.equal(routeObj.members.has(0), false, 'town house stop absent from Route.members');
}

// 5. Post Office solids (including rear loading dock platform and SW lobby landing), clear boxes, and lazy proximity gate.
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
  // Explicitly verify outer edge of the 0.85 m rear loading dock platform and front SW lobby landing push a car out
  // (car oriented parallel to each edge so the main building wall behind it is out of reach).
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
}

// 6. Real baked Point Tupper land checks (supports BOTH legacy baked land and clean fresh bakes; skipped if data/ is absent).
if (HAS_DATA) {
  const manifest = JSON.parse(readFileSync(join(AREA, 'manifest.json'), 'utf8'));
  const rawProps = JSON.parse(readFileSync(join(AREA, 'props.json'), 'utf8'));
  const rawBuildings = JSON.parse(readFileSync(join(AREA, 'buildings.json'), 'utf8')).buildings;
  const rawRoads = JSON.parse(readFileSync(join(AREA, 'roads.json'), 'utf8'));
  const V = manifest.village;

  const rawInside = rawProps.mailboxes.filter(m => inPortHawkesbury(m.x, m.y));
  const rawOutside = rawProps.mailboxes.filter(m => !inPortHawkesbury(m.x, m.y));
  assert.ok(rawOutside.length >= 600, `expected outside boxes to preserve, got ${rawOutside.length}`);

  const townHouses = countPortHawkesburyHouses(rawBuildings.filter(b => b.buildingId === undefined || b.buildingId === b.id));
  assert.ok(townHouses >= 900, `expected >= 900 houses in Port Hawkesbury, got ${townHouses}`);

  const filtered = filterPointTupperProps(rawProps, 'pointtupper', townHouses, true);
  assert.equal(filtered.mailboxes.length, rawOutside.length, 'every outside mailbox preserved, every inside mailbox removed');
  assert.equal(filtered.mailboxes.filter(m => inPortHawkesbury(m.x, m.y)).length, 0, 'ZERO mailboxes inside Town of Port Hawkesbury');
  assert.equal(filtered.poles.length, rawProps.poles.length, 'all poles preserved');
  assert.equal(filtered.mailDrops.length, 1, 'exactly one town Post Office drop');
  assert.equal(filtered.mailDrops[0].customers, townHouses);

  const propsObj = new Props(filtered, V, stubTerrain);
  assert.equal(propsObj.mail.filter(m => inPortHawkesbury(V[0] + m.x, V[1] - m.z)).length, 0);
  assert.equal(propsObj.mail.length, rawOutside.length);
  assert.equal(propsObj.sites.filter(s => s.kind === 'postOffice').length, 1);
  assert.equal(propsObj.totalCustomers, rawOutside.length + townHouses);

  // Route on real Point Tupper roads.
  const roads = new Roads(rawRoads, V, stubTerrain);
  Route.reachable = null;
  const ptRoute = buildPointTupperRoute(roads, propsObj, V);
  assert.equal(ptRoute.rural.filter(i => inPortHawkesbury(V[0] + propsObj.mail[i].x, V[1] - propsObj.mail[i].z)).length, 0, 'zero town houses in route');
  assert.equal(ptRoute.sites.length, 1, 'one town Post Office stop in route');
  assert.equal(ptRoute.stops[0].hit.road.name, 'Pitt Street');
  assert.ok(ptRoute.rural.length >= 600, `outside rural stops kept (${ptRoute.rural.length})`);

  // Building replacement removes 149, 3081, 3082 (and works when renumbered).
  const kept = postOfficeReplaceBuildings(rawBuildings);
  const removedIds = rawBuildings.filter(b => !kept.includes(b)).map(b => b.id).sort((a, b) => a - b);
  assert.deepEqual(removedIds, [149, 3081, 3082]);
  const renumbered = rawBuildings.map(b => ({ ...b, id: b.id + 9000, ...(b.buildingId === undefined ? {} : { buildingId: b.buildingId + 9000 }) }));
  assert.deepEqual(postOfficeReplaceBuildings(renumbered).map(b => [b.x, b.y]), kept.map(b => [b.x, b.y]));

  // Service drop for building 149 lands on the Post Office SE front wall below the 6.5 m cornice.
  const drop149 = filtered.serviceDrops.find(d => d.building === 149);
  assert.ok(drop149, 'service drop for building 149 exists');
  const [dlx, dlz] = poToLocal(drop149.x, drop149.y);
  const [mx0, mx1, , mz1] = PH_POST_OFFICE.rects[0];
  assert.ok(dlx >= mx0 - 0.1 && dlx <= mx1 + 0.1 && Math.abs(dlz - mz1) < 0.15, `drop 149 on SE wall (${dlx.toFixed(2)}, ${dlz.toFixed(2)})`);
  assert.ok(drop149.height > 3.0 && drop149.height < 6.0 && drop149.ground === null);

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
  console.log(`PASS real pointtupper data: ${rawInside.length} town boxes filtered, ${rawOutside.length} outside kept, 1 Post Office drop (${townHouses} customers)`);
} else {
  console.log('NOTE data/baked/areas/pointtupper absent: ran synthetic + pipeline checks only');
}

// 7. Pipeline check: areas.py declares POINTTUPPER.no_mailbox_polygons and 29_bake_props.py filters placed box locations
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
# Find a real point just inside the eastern boundary and a road segment 25 m outside it, so the house is inside
# while its placed roadside box stands outside the legal boundary (preserving outside-town boxes).
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

// 8. Wiring check in web/src/main.ts.
{
  const mainSrc = readFileSync(MAIN_TS, 'utf8');
  assert.match(mainSrc, /filterPointTupperProps\(/, 'main.ts filters Point Tupper props');
  assert.match(mainSrc, /buildPointTupperRoute\(/, 'main.ts wires buildPointTupperRoute into Shift');
  assert.match(mainSrc, /postOfficeReplaceBuildings\(/, 'main.ts replaces the surveyed Post Office building');
  assert.match(mainSrc, /postOfficeClear\(/, 'main.ts clears trees and lot props under the Post Office');
  assert.match(mainSrc, /import\('\.\/ph-post-office'\)/, 'main.ts lazily loads the Post Office chunk');
}

console.log('PASS port-hawkesbury-mail-check');

// 9. Mutation tests (--mutations).
if (process.argv.includes('--mutations')) {
  const mutants = [
    {
      name: 'skip-town-filter',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const keptBoxes = rawBoxes.filter(m => !inPortHawkesbury(m.x, m.y));',
      to: 'const keptBoxes = rawBoxes.slice();',
    },
    {
      name: 'drop-post-office-stop',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const mailDrops: RawMailDrop[] = [...existingDrops, { ...drop, customers }];',
      to: 'const mailDrops: RawMailDrop[] = [...existingDrops];',
    },
    {
      name: 'skip-singleton-frame-reset',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const mailboxes = keptBoxes.map(m => m.group !== null && (groupCounts.get(m.group) ?? 0) < 2 ? { ...m, group: null } : m);',
      to: 'const mailboxes = keptBoxes;',
    },
    {
      name: 'drop-overlaps-vestibule',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: "dropLocal: Object.freeze({ x: 12.2, z: 14.5, heading: 137, radius: 4.5, label: 'Port Hawkesbury Post Office' }),",
      to: "dropLocal: Object.freeze({ x: 12.6, z: 11.4, heading: 137, radius: 6, label: 'Port Hawkesbury Post Office' }),",
    },
    {
      name: 'skip-loading-dock-solid',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'const raw: Solid[] = [...PH_POST_OFFICE.rects, ...PH_POST_OFFICE.solidExtras].map(([x0, x1, z0, z1]) => {',
      to: 'const raw: Solid[] = PH_POST_OFFICE.rects.map(([x0, x1, z0, z1]) => {',
    },
    {
      name: 'route-keeps-town-houses',
      file: 'web/src/route.ts',
      from: 'if (inPortHawkesbury(e, n)) return;',
      to: 'if (false && inPortHawkesbury(e, n)) return;',
    },
    {
      name: 'draw-community-cabinet-at-post-office',
      file: 'web/src/props.ts',
      from: "this.sites.forEach((p, i) => { if (p.kind === 'community') this.cell(p).sites.push(i); });",
      to: 'this.sites.forEach((p, i) => this.cell(p).sites.push(i));',
    },
    {
      name: 'skip-building-replacement',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'return list.filter(b => !onSpot(b) && !groups.has(b.buildingId ?? b.id));',
      to: 'return list;',
    },
    {
      name: 'skip-service-drop-reaim',
      file: 'web/src/port-hawkesbury-mail.ts',
      from: 'return drops.map(d => d.building === target.building',
      to: 'return drops.map(d => false && d.building === target.building',
    },
    {
      name: 'skip-main-wiring',
      file: 'web/src/main.ts',
      from: 'const data = filterPointTupperProps(mabouAimed, AREA.id, countPortHawkesburyHouses(properties), !!postOfficeChunk);',
      to: 'const data = mabouAimed;',
    },
  ];

  const dir = mkdtempSync(join(tmpdir(), 'mmm-ph-mail-mut-'));
  try {
    // Build one unmodified bundle for main.ts overlay checks.
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
      const targetAbs = resolve(ROOT, m.file);
      const original = readFileSync(targetAbs, 'utf8');
      assert.ok(original.includes(m.from), `mutant ${m.name} anchor missing in ${m.file}`);
      const mutated = original.replace(m.from, m.to);
      let res;
      if (m.file === 'web/src/main.ts') {
        const mutMain = join(dir, `${m.name}-main.ts`);
        writeFileSync(mutMain, mutated);
        // First confirm the unmodified main.ts passes through the exact same harness.
        const ctrl = spawnSync(process.execPath, [baseBundle], { env: { ...process.env, MMM_ROOT: ROOT, MMM_MAIN_TS: targetAbs }, stdio: 'pipe' });
        assert.equal(ctrl.status, 0, `main.ts control failed: ${ctrl.stderr}`);
        res = spawnSync(process.execPath, [baseBundle], { env: { ...process.env, MMM_ROOT: ROOT, MMM_MAIN_TS: mutMain }, stdio: 'pipe' });
        assert.match(res.stderr.toString(), /main\.ts filters Point Tupper props/, `mutant ${m.name} failed for wrong reason: ${res.stderr}`);
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
                  if (resolve(a.path) === targetAbs) return { contents: mutated, loader: a.path.endsWith('.ts') ? 'ts' : 'js' };
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
