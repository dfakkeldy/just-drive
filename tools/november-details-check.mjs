import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Buildings, buildingSites } from '../web/src/buildings.ts';
import { baxtersCoveBuildingArt, littleMabouBuildingArt, NovemberBuildings, novemberFootprints, TRAILHEAD_FENCE } from '../web/src/november-buildings.ts';
import { BAXTERS_COVE_LOT, littleMabouMarshRail, NovemberRoadDetails } from '../web/src/november-road-details.ts';
import { littleMabouPonyTruss, mabouRoadOverrides, PONY_TRUSS, ponyTrussHeight, registerRailContacts } from '../web/src/november-bridges.ts';
import { AreaContacts } from '../web/src/world-contacts.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { Towing } from '../web/src/towing.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { WHARF_SOURCES } from '../web/src/wharf-source.ts';
import { areaPlaces, nearestPlacement, placesFor } from '../web/src/places.ts';
import { planRails, railPoint } from '../web/src/guardrail-rules.ts';
import { railLand } from './guardrail-land.mjs';
import { Roads } from '../web/src/roads.ts';
import { drawnRoadBytes, paintSiteSurface } from '../web/src/terrain.ts';

const read = (dir, file) => JSON.parse(readFileSync(`data/baked/${dir}/${file}.json`, 'utf8'));
const byte = (sample, flags) => {
  const bytes = new Uint8ClampedArray([128, 52, flags, 0]);
  paintSiteSurface(bytes, 0, sample, 128, .1, .05);
  return bytes;
};

for (const area of ['mabou', 'porthood']) {
  const dir = area === 'mabou' ? 'terrain' : 'areas/porthood';
  const { village, mid } = read(dir, 'manifest'), data = read(dir, 'roads');
  const [east, north] = village, world = ([e,n]) => [e-east,north-n];
  const details = new NovemberRoadDetails(data.roads, area, village);
  const roads = new Roads(data, village, {});
  assert.equal(details.bars.length, 2, `${area} displays both Highway 19 stop lines`);
  for (const [i, name] of ['Hunters Road', 'New Rocky Ridge Road'].entries()) {
    const road = data.roads.find(r => r.name === name && r.kind === 3 && details.sites.some(s => s.surface(...world(r.pts[1]))?.paveGravel));
    assert.ok(road, name);
    const site = details.sites.find(s => s.surface(...world(road.pts[1]))?.paveGravel);
    const apron = site.surface(...world(road.pts[1]));
    assert.deepEqual([...byte(apron, 3)], [128,52,2,0], 'only surface kind changes');
    assert.deepEqual([...byte(apron, 1)], [128,52,1,0], 'highway paint remains');
    assert.deepEqual([...byte(apron, 35)], [128,52,35,0], 'washboard stays washboard');
    assert.equal(site.surface(...world(road.pts[5])), null, 'no asphalt 20 m from the junction');
    for (const [x,z] of details.bars[i].points) {
      assert.ok(site.surface(x,z)?.paveGravel, 'stop line on its own apron');
      const hit = roads.nearest(x,z,4,r => r.id === road.id);
      assert.ok(hit && (x-hit.x)*Math.cos(hit.heading)+(z-hit.z)*Math.sin(hit.heading) < 0, 'bar is on the incoming lane');
    }
  }

  if (area === 'mabou') {
    const [drive] = details.added, [site] = details.sites;
    assert.ok(!data.roads.some(r => r.id === drive.id), 'driveway id is free');
    assert.deepEqual([drive.name, drive.kind, drive.bridge], [null, 4, false]);
    const entry = roads.nearest(...world(drive.pts[0]), 2, r => r.name === 'Mabou Harbour Road');
    assert.ok(entry && entry.dist < .5, 'drive connects to Harbour Road');
    for (const p of drive.pts) {
      const sample = site.surface(...world(p));
      assert.equal(byte(sample, 0)[2], 68, 'the wheels read gravel on the drive');
      assert.equal(drawnRoadBytes(byte(sample, 0))[2], 3, 'the same field draws the gravel road material');
      assert.ok(details.excludesTree(...p), 'the bench and garage approach stay clear');
    }
    assert.equal(byte(site.surface(...world(drive.pts[0])), 2)[2], 2, 'the drive cannot paint over the public road');
    for (const p of [620298.22, 620456.84]) {
      assert.ok(data.roads.some(r => r.kind === 4 && r.pavement === 'gravel' && r.pts.some(q => q[0] === p)), 'the existing hillside drive and pad use graded gravel');
    }
  }

  const mapped = read(dir, 'buildings').buildings;
  for (const model of novemberFootprints[area]) {
    assert.ok(model.x > mid[0] && model.x < mid[2] && model.y > mid[1] && model.y < mid[3]);
    assert.ok(mapped.every(b => Math.hypot(b.x - model.x, b.y - model.y) >= 5), 'no duplicate of an existing building');
  }
  for (const low of [true, false]) {
    const models = new NovemberBuildings(area, mapped, village, 1.5, 0, low);
    assert.ok(models.drawing.pos.every(Number.isFinite));
    assert.equal(models.solids.length, area === 'mabou' ? 20 : 1);
    const batch = new Buildings([], village, 1.5, 0, {}, models.drawing);
    assert.equal(batch.triangles, models.drawing.triangles, 'built details use the existing building mesh');
    assert.ok(batch.triangles < 3500, `added details stay within a small triangle envelope: ${batch.triangles}`);
    for (const solid of models.solids) {
      const radius = Math.hypot(solid.half,solid.halfWidth);
      const hit = roads.nearest(solid.x,solid.z,radius+8,r => r.kind <= 3);
      assert.ok(!hit || hit.dist > radius+hit.road.halfWidth, 'new solids stay clear of through roads');
    }
  }

  if (area === 'mabou') {
    const exag = 2.5, house = mapped.find(b => b.id === 900007);
    const [cx, cz] = world([house.x, house.y]), axis = house.axisDeg * Math.PI / 180;
    const drawing = new NovemberBuildings(area, mapped, village, exag, 0, false).drawing;
    let foundationBottom = Infinity, porchBottom = Infinity;
    for (let i = 0; i < drawing.pos.length; i += 3) {
      const x = drawing.pos[i] - cx, y = drawing.pos[i+1], z = drawing.pos[i+2] - cz;
      const along = x*Math.sin(axis)-z*Math.cos(axis), across = x*Math.cos(axis)+z*Math.sin(axis);
      if (Math.abs(across-4.5) < .01 && Math.abs(along) < 6.51) foundationBottom = Math.min(foundationBottom,y);
      if (Math.abs(across+6.62) < .01 && Math.abs(along) < 2.61) porchBottom = Math.min(porchBottom,y);
    }
    // DTM at the harbour-side wall and the uphill bench, in unexaggerated metres.
    assert.ok(foundationBottom <= 62.73*exag, 'foundation reaches the downhill ground at maximum hill height');
    assert.ok(porchBottom <= 64.44*exag, 'porch apron reaches the uphill bench at maximum hill height');
  }

  const want = area === 'mabou' ? [['coal-mines-valley', 55, 270], ['harbour-wharf-view', 922, 199]] : [['marble-hill-view', 56, 225]];
  const list = area === 'mabou' ? placesFor(village) : areaPlaces(area);
  for (const [id, roadId, bearing] of want) {
    const place = list.find(p => p.id === id);
    assert.ok(place?.spawn && place.kind === 'view', id);
    const hit = nearestPlacement(roads, place, village);
    assert.equal(hit?.road.id, roadId, `${id} jumps to its road`);
    assert.ok(hit.dist < .03 && Math.abs(hit.heading * 180 / Math.PI - bearing) < 1e-6);
  }
}
const portHoodBuildings = read('areas/porthood', 'buildings').buildings;
const art = littleMabouBuildingArt(portHoodBuildings);
const at = (list, x, y) => list.find(b => Math.hypot(b.x - x, b.y - y) < 2);
for (const [x, y] of [[615817.26, 5102552.32], [616081.34, 5102382.38]]) {
  const before = at(portHoodBuildings, x, y), after = at(art.buildings, x, y);
  assert.deepEqual(after, { ...before, kind: 'house' }, 'keep the surveyed envelope');
  assert.equal(art.styles[after.buildingId ?? after.id].wall, '#f4f1e9');
}
const shed = at(art.buildings, 615779, 5102552);
assert.equal(shed.kind, 'shed');
assert.equal(art.styles[shed.id].wall, '#a13832');
const mobile = at(art.buildings, 616081.34, 5102382.38), wing = at(art.buildings, 616086.6, 5102381.7);
assert.equal(art.styles[mobile.id].skirting, true);
assert.equal(wing.buildingId, mobile.id);
assert.ok(wing.ridge + wing.ground < mobile.ridge + mobile.ground);
assert.ok(!buildingSites(art.buildings).includes(wing), 'the addition is part of the same property');

const land = railLand(), road = land.roads.roads.find(r => r.id === 44);
const roadData = read('terrain', 'roads').roads;
const source = roadData.find(r => r.id === road.id), observed = littleMabouMarshRail(source);
assert.notEqual(source, observed, 'apply the observation without editing the input');
assert.equal(littleMabouMarshRail(observed), observed, 'keep an existing observed run');
for (const other of roadData.filter(r => r !== source)) assert.equal(littleMabouMarshRail(other), other);
const plan = () => planRails(road, land.ground, land.access, undefined, undefined, land.context);
const key = span => `${span.side}/${span.a.along}`;
const before = new Set(plan().map(key));
road.guardrailRuns = observed.guardrailRuns;
const added = plan().filter(span => !before.has(key(span)));
assert.ok(added.length > 60, 'the existing planner seats at least 114 m of new rail');
for (const {a, b, side} of added) {
  assert.equal(side, 1, 'the run stays on the south shoulder');
  assert.ok(!land.access(road, a));
  for (const p of [a, b]) assert.ok(land.ground(p.x, p.z) > 0);
  assert.ok(railPoint(road, a.along).x + land.village[0] >= 622263, 'the rail starts clear of the bridge');
  assert.ok(railPoint(road, b.along).x + land.village[0] <= 622400, 'the rail stays in the observed stretch');
}
// Baxters Cove Road (Judique pack, 21 Nov dash cam).
{
  const dir = 'areas/judique', { village } = read(dir, 'manifest'), data = read(dir, 'roads');
  const [east, north] = village, world = ([e, n]) => [e - east, north - n];
  const details = new NovemberRoadDetails(data.roads, 'judique', village);
  assert.deepEqual([details.bars.length, details.added.length, details.sites.length], [0, 0, 2], 'two Judique surfaces, no stop lines');
  const [lot, lane] = details.sites;
  for (const p of [[616250, 5079340], [616245, 5079390], [616222, 5079422], [616260, 5079325]]) {
    assert.equal(lot.surface(...world(p))?.kind, 8, `yard gravel at ${p}`);
  }
  assert.equal(lot.surface(...world([616237, 5079352])), null, 'the slipway keeps its own surface');
  for (const source of WHARF_SOURCES.filter(s => s.area === 'judique')) {
    for (const [i, [ae, an]] of source.outline.entries()) {
      const [be, bn] = source.outline[(i + 1) % source.outline.length], steps = Math.ceil(Math.hypot(be - ae, bn - an) / .5);
      for (let j = 0; j <= steps; j++) {
        const p = [ae + (be - ae) * j / steps, an + (bn - an) * j / steps];
        assert.equal(lot.surface(...world(p)), null, `the lot stays off the wharf edge at ${p}`);
      }
    }
  }
  const mapped = read(dir, 'buildings').buildings, copy = structuredClone(mapped);
  const art = baxtersCoveBuildingArt(mapped);
  assert.deepEqual(mapped, copy, 'the survey list is not edited');
  const at = (x, y) => art.buildings.find(b => Math.hypot(b.x - x, b.y - y) < 2);
  const long = at(616254.85, 5079386.99), gambrel = at(616282, 5079339), house = at(617083, 5079233.8);
  assert.deepEqual([long.kind, art.styles[long.id].wall, art.styles[long.id].barnDoors], ['barn', '#9a8559', 5]);
  assert.equal(art.styles[at(616233.9, 5079329.5).id].wall, '#e9e7df');
  assert.equal(art.styles[at(617039, 5079229.5).id].wall, '#8a7b68');
  assert.deepEqual([house.kind, house.eave, house.ridge], ['house', 5.3, 7.81]);
  assert.equal(art.styles[gambrel.id].roofShape, 'gambrel');
  assert.ok(mapped.every(b => Math.hypot(b.x - gambrel.x, b.y - gambrel.y) >= 5), 'the gambrel shed is new');
  for (const p of gambrel.footprint) assert.equal(lot.surface(...world(p)), null, 'grass round the gambrel shed');
  assert.equal(baxtersCoveBuildingArt(art.buildings).buildings.filter(b => b.id === gambrel.id).length, 1, 'added once');
  assert.ok(lane.surface(...world([616433, 5079150]))?.gravelDrive, 'the trailhead lane is gravel');
  const roads = new Roads(data, village, {});
  for (const run of TRAILHEAD_FENCE) for (const [e, n] of run) {
    assert.ok(!roads.nearest(...world([e, n]), 4, r => r.kind <= 3), 'fence posts stand off Baxters Cove Road');
    const trail = roads.nearest(...world([e, n]), 4, r => r.name === 'Judique Flyer Trail');
    assert.ok(!trail || trail.dist > trail.road.halfWidth + 1, 'fence posts stand off the trail');
  }
  for (const low of [true, false]) {
    const models = new NovemberBuildings('judique', mapped, village, 1.5, 0, low);
    assert.ok(models.drawing.pos.every(Number.isFinite));
    assert.equal(models.solids.length, 31, 'kiosk, four shelter posts, fence posts and rails');
    assert.ok(models.drawing.triangles < 1500, `trailhead triangles: ${models.drawing.triangles}`);
    for (const solid of models.solids) {
      const radius = Math.hypot(solid.half, solid.halfWidth);
      const hit = roads.nearest(solid.x, solid.z, radius + 8, r => r.kind <= 3);
      assert.ok(!hit || hit.dist > radius + hit.road.halfWidth, 'trailhead solids stay clear of the road');
    }
  }
  console.log('PASS Baxters Cove harbour lot, shed art, gambrel shed, trailhead lane, kiosk, shelter and fence');
}
// Little Mabou Road grey steel pony-truss bridges (Mabou pack, ids 45 and 46).
{
  const mabouManifest = read('terrain', 'manifest'), mabouRoads = read('terrain', 'roads');
  // Verify the production modern-Mabou gate in mabouRoadOverrides and main.ts.
  const mainSource = readFileSync('web/src/main.ts', 'utf8');
  assert.match(mainSource, /const roadLines = mabouRoadOverrides\(roadData\.roads, ERA\.modern, AREA\.id\);/, 'main.ts uses mabouRoadOverrides production gate');
  const tagged = mabouRoadOverrides(mabouRoads.roads, true, 'mabou');
  assert.ok(tagged.find(r => r.id === 44)?.guardrailRuns?.some(run => run.side === 1), 'modern Mabou override retains Little Mabou marsh south-shoulder rail');
  assert.notEqual(tagged.find(r => r.id === 44)?.guardrailRuns, mabouRoads.roads.find(r => r.id === 44)?.guardrailRuns, 'modern Mabou override applies marsh rail onto road 44');
  assert.deepEqual(mabouRoadOverrides(mabouRoads.roads, false, 'mabou').filter(r => r.ponyTruss), [], '1884 Mabou gets no pony-truss override');
  assert.equal(mabouRoadOverrides(mabouRoads.roads, false, 'mabou').find(r => r.id === 44)?.guardrailRuns, mabouRoads.roads.find(r => r.id === 44)?.guardrailRuns, '1884 Mabou gets no marsh rail override');
  assert.deepEqual(mabouRoadOverrides(mabouRoads.roads, true, 'judique').filter(r => r.ponyTruss), [], 'non-Mabou area gets no pony-truss override');
  assert.equal(mabouRoadOverrides(mabouRoads.roads, true, 'judique').find(r => r.id === 44)?.guardrailRuns, mabouRoads.roads.find(r => r.id === 44)?.guardrailRuns, 'non-Mabou area gets no marsh rail override');
  const matched = tagged.filter(r => r.ponyTruss);
  assert.deepEqual(matched.map(r => r.id).sort((a, b) => a - b), [45, 46], 'only Little Mabou Road bridges 45 and 46 match');
  for (const r of matched) {
    const raw = mabouRoads.roads.find(x => x.id === r.id);
    assert.notEqual(r, raw, `bridge ${r.id} tagged without mutating source`);
    assert.equal(littleMabouPonyTruss(r), r, `bridge ${r.id} tag is idempotent`);
    assert.ok(littleMabouPonyTruss({ ...raw, pts: [...raw.pts].reverse() }).ponyTruss, `reversed span ${r.id} still matches`);
  }
  for (const other of mabouRoads.roads.filter(r => r.id !== 45 && r.id !== 46)) {
    assert.equal(littleMabouPonyTruss(other), other, `road ${other.id} stays unchanged`);
  }
  const makeRealTerrain = (exag, level = 8) => ({
    level, manifest: mabouManifest, dataRevision: 1, exag, seaLevel: -0.2, low: false,
    heightAt: (x, z) => { const h = land.ground(x, z, true); return h === null ? null : h > -0.2 ? -0.2 + (h + 0.2) * exag : h; },
    surfaceAt(x, z) { const s = land.sample(x, z, true); if (!s) return null; const g = s.height > -0.2 ? -0.2 + (s.height + 0.2) * exag : s.height; return { ground: g, level: Math.min(level, s.level), kind: 2, halfWidth: 3, roadDist: 0, canopy: s.canopy, washboard: false }; },
    withContactHeight: (_, read) => read(),
    withGroundContact: (_, read) => read(),
  });
  // Independent baseline deckHeight contract (origin/main Roads.deckHeight): closest polyline point within halfWidth + 1.2,
  // interpolating y0 = s0.ground + 0.05 to y1 = s1.ground + 0.05 where s0/s1 sample 3 m past each bridge end.
  const expectedBaselineDeck = (road, t, x, z) => {
    const p = road.pts, n = p.length;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    let bestD = Infinity, bestS = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = p[i][0], az = p[i][1], dx = p[i + 1][0] - ax, dz = p[i + 1][1] - az, l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (d < bestD) { bestD = d; bestS = cum[i] + Math.hypot(dx, dz) * u; }
    }
    if (bestD > road.halfWidth + 1.2) return null;
    const end = (a, b) => { const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return t.surfaceAt(a[0] + ((a[0] - b[0]) / d) * 3, a[1] + ((a[1] - b[1]) / d) * 3); };
    const y0 = end(p[0], p[1]).ground + 0.05, y1 = end(p[n - 1], p[n - 2]).ground + 0.05;
    return y0 + (y1 - y0) * (bestS / (cum[n - 1] || 1));
  };
  // Exact baseline deck-physics preservation: Roads.deckHeight() matches both untagged Roads and independent origin/main math at 1.5x and 3.0x.
  for (const exag of [1.5, 3.0]) {
    const t = makeRealTerrain(exag, 8);
    const baselineNet = new Roads(mabouRoads, mabouManifest.village, t);
    const ponyNet = new Roads({ roads: tagged }, mabouManifest.village, t);
    for (const id of [45, 46]) {
      const r = ponyNet.roads.find(x => x.id === id);
      const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
      const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span;
      for (const s of [-6, -4.1, -3, -1, 0, span * 0.25, span * 0.5, span * 0.75, span, span + 1, span + 3, span + 4.1, span + 6]) {
        for (const offset of [-4.5, -3.0, -2.0, 0, 2.0, 3.0, 4.5]) {
          const x = ax + ux * s - uz * offset, z = az + uz * s + ux * offset;
          const got = ponyNet.deckHeight(x, z);
          const expected = expectedBaselineDeck(r, t, x, z);
          assert.ok(Object.is(got, baselineNet.deckHeight(x, z)), `bridge ${id} exag=${exag} deckHeight preserves baseline at s=${s.toFixed(1)}, off=${offset}`);
          if (expected === null) assert.equal(got, null, `bridge ${id} exag=${exag} outside baseline support at s=${s.toFixed(1)}, off=${offset}`);
          else assert.ok(got !== null && Math.abs(got - expected) < 1e-9, `bridge ${id} exag=${exag} matches independent origin/main formula at s=${s.toFixed(1)}, off=${offset} (${got} vs ${expected})`);
        }
      }
    }
    for (const child of [...baselineNet.group.children]) child.geometry?.dispose();
    for (const child of [...ponyNet.group.children]) child.geometry?.dispose();
  }
  const realTerrain = makeRealTerrain(1.5, 8);
  const baselineNet = new Roads(mabouRoads, mabouManifest.village, realTerrain);
  const net = new Roads({ roads: tagged }, mabouManifest.village, realTerrain);
  const rails = net.guardrails;
  assert.ok(rails, 'modern Mabou roads construct guardrails with pony-truss rail solids');
  assert.match(mainSource, /if \(roads\.guardrails\) registerRailContacts\(fleetContacts, soloContacts, roads\.guardrails,/, 'main.ts uses shared registerRailContacts');
  const rig = () => { const n = () => new THREE.Object3D(); return { root: n(), body: n(), steer: { fl: n(), fr: n() }, wheels: { fl: n(), fr: n(), rl: n(), rr: n() }, brakeLights: [] }; };
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (const id of [45, 46]) {
    const r = net.roads.find(x => x.id === id);
    const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
    const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, heading = Math.atan2(dx, -dz);
    const midY = net.deckHeight(mx, mz);
    assert.ok(Number.isFinite(midY), `bridge ${id} keeps finite deckHeight`);
    const mesh = net.group.children.find(c => c.name === `pony-truss-${id}`);
    assert.ok(mesh?.geometry, `bridge ${id} builds one pony-truss mesh`);
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute('position'), col = mesh.geometry.getAttribute('color');
    assert.ok(pos && col && pos.array.every(Number.isFinite), `bridge ${id} has finite vertex-coloured geometry`);
    assert.ok(pos.count / 3 < 1000, `bridge ${id} stays within triangle budget (${pos.count / 3})`);
    let maxAboveDeck = -Infinity, maxHalf = 0, maxTrussHalf = 0;
    const y0 = net.deckHeight(ax, az), y1 = net.deckHeight(bx, bz);
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const along = (px - ax) * ux + (pz - az) * uz;
      const across = Math.abs(-(px - ax) * uz + (pz - az) * ux);
      const deckAt = y0 + (y1 - y0) * Math.max(0, Math.min(1, along / span));
      assert.ok(along >= -0.01 && along <= span + 0.01, `bridge ${id} mesh vertex stays inside end-normal bounds (${along.toFixed(4)} vs ${span.toFixed(4)})`);
      maxAboveDeck = Math.max(maxAboveDeck, py - deckAt);
      maxHalf = Math.max(maxHalf, across);
      if (py - deckAt > 0.05) maxTrussHalf = Math.max(maxTrussHalf, across);
    }
    assert.ok(maxAboveDeck >= 2.0 && maxAboveDeck <= 2.6, `bridge ${id} truss height matches pony-truss proportions (${maxAboveDeck.toFixed(2)} m)`);
    assert.ok(maxTrussHalf < r.halfWidth && maxTrussHalf >= PONY_TRUSS.half, `bridge ${id} steel pony truss stays narrow one-lane (${(maxTrussHalf * 2).toFixed(2)} m wide)`);
    assert.ok(maxHalf >= r.halfWidth + 1.2 - 1e-3, `bridge ${id} deck covers full deckHeight support width (${(maxHalf * 2).toFixed(2)} m)`);
    // Rendered deck (asphalt inside trusses + concrete outer shoulders) matches Roads.deckHeight() across the full supported width,
    // including offsets measured from the baked road polyline segments out to ±4.199 m.
    for (const s of [0.05, span * 0.25, span * 0.5, span * 0.75, span - 0.05]) {
      for (const offset of [-4.19, -4.05, -3.4, -3.0, -(PONY_TRUSS.clearHalf - 0.01), -1.0, 0, 1.0, PONY_TRUSS.clearHalf - 0.01, 3.0, 3.4, 4.05, 4.19]) {
        const x = ax + ux * s - uz * offset, z = az + uz * s + ux * offset;
        const y = net.deckHeight(x, z);
        assert.ok(y !== null, `bridge ${id} supports deck at s=${s.toFixed(2)}, offset=${offset}`);
        ray.set(new THREE.Vector3(x, y + 0.5, z), down);
        const hit = ray.intersectObject(mesh)[0];
        assert.ok(hit && Math.abs(hit.point.y - y) < 0.005, `bridge ${id} deck mesh matches deckHeight at s=${s.toFixed(2)}, offset=${offset} (diff=${hit ? Math.abs(hit.point.y - y).toFixed(5) : 'miss'})`);
      }
    }
    for (let seg = 0; seg < r.pts.length - 1; seg++) {
      const [pa0, pa1] = r.pts[seg], [pb0, pb1] = r.pts[seg + 1];
      const sdx = pb0 - pa0, sdz = pb1 - pa1, slen = Math.hypot(sdx, sdz) || 1;
      const sux = sdx / slen, suz = sdz / slen;
      const sampleTs = seg === 0 ? [0.0001, 0.5] : seg === r.pts.length - 2 ? [0.5, 0.9999] : [0.5];
      for (const st of sampleTs) {
        const px = pa0 + sdx * st, pz = pa1 + sdz * st;
        for (const offset of [-4.199, -3.5, -2.2, -2.085, 2.085, 2.2, 3.5, 4.199]) {
          const x = px - suz * offset, z = pz + sux * offset;
          const y = net.deckHeight(x, z);
          assert.ok(y !== null, `bridge ${id} seg ${seg} t=${st} supports polyline edge offset=${offset}`);
          ray.set(new THREE.Vector3(x, y + 0.5, z), down);
          const hits = ray.intersectObject(mesh);
          assert.ok(hits.some(h => Math.abs(h.point.y - y) < 0.005), `bridge ${id} seg ${seg} t=${st} polyline offset=${offset} hits continuous visible deck`);
        }
      }
    }
    // Verify inner steel rails are tied to every interior upright post AND both inclined end posts (no floating rail).
    const panels = Math.max(4, Math.round(span / PONY_TRUSS.targetPanel / 2) * 2);
    const panelLen = span / panels;
    const trussH = ponyTrussHeight(span);
    const endRailS = panelLen * ((PONY_TRUSS.railHeight - PONY_TRUSS.chordSize / 2) / (trussH - PONY_TRUSS.chordSize / 2));
    const gapMid = (PONY_TRUSS.railInner + 0.07 + PONY_TRUSS.half - PONY_TRUSS.postSize / 2) / 2;
    const endGapMid = (PONY_TRUSS.railInner + 0.07 + PONY_TRUSS.half - PONY_TRUSS.endPostSize / 2) / 2;
    for (const side of [-1, 1]) {
      for (let i = 1; i < panels; i++) {
        const s = i * panelLen, yRail = y0 + (y1 - y0) * (s / span) + PONY_TRUSS.railHeight;
        const bx = ax + ux * s - uz * side * gapMid, bz = az + uz * s + ux * side * gapMid;
        ray.set(new THREE.Vector3(bx, yRail + 0.25, bz), down);
        const hits = ray.intersectObject(mesh).filter(h => h.point.y >= yRail - 0.12 && h.point.y <= yRail + 0.12);
        assert.ok(hits.length > 0, `bridge ${id} side=${side} post ${i} has steel bracket tying inner rail to upright`);
      }
      for (const s of [endRailS, span - endRailS]) {
        const yRail = y0 + (y1 - y0) * (s / span) + PONY_TRUSS.railHeight;
        const bx = ax + ux * s - uz * side * endGapMid, bz = az + uz * s + ux * side * endGapMid;
        ray.set(new THREE.Vector3(bx, yRail + 0.25, bz), down);
        const hits = ray.intersectObject(mesh).filter(h => h.point.y >= yRail - 0.12 && h.point.y <= yRail + 0.12);
        assert.ok(hits.length > 0, `bridge ${id} side=${side} inclined end post at s=${s.toFixed(2)} has steel bracket tying inner rail`);
      }
    }
    // Drive a real car across each bridge on real baked terrain in BOTH directions with lateral offset ±0.5 m:
    // clear passes reach the far bank and match untagged baseline deck physics step-for-step.
    for (const dir of [1, -1]) {
      for (const lat of [0, -0.5, 0.5]) {
        const car = new Vehicle(rig(), realTerrain, net, -0.2, CAR_SPEC);
        const baseCar = new Vehicle(rig(), realTerrain, baselineNet, -0.2, CAR_SPEC);
        const startS = dir > 0 ? -6 : span + 6, endS = dir > 0 ? span + 5 : -5;
        const hdg = dir > 0 ? heading : heading + Math.PI;
        for (const v of [car, baseCar]) {
          v.place(ax + ux * startS - uz * lat, az + uz * startS + ux * lat, hdg);
          v.vx = ux * dir * 5; v.vz = uz * dir * 5; v.speed = 5;
        }
        let reachedFar = false;
        for (let step = 0; step < 1200; step++) {
          car.update(1 / 120, { throttle: 0.25, steer: 0, handbrake: false, touch: false });
          baseCar.update(1 / 120, { throttle: 0.25, steer: 0, handbrake: false, touch: false });
          assert.equal(car.x, baseCar.x, `bridge ${id} dir=${dir} lat=${lat} step=${step} x matches baseline`);
          assert.equal(car.y, baseCar.y, `bridge ${id} dir=${dir} lat=${lat} step=${step} y matches baseline`);
          assert.equal(car.z, baseCar.z, `bridge ${id} dir=${dir} lat=${lat} step=${step} z matches baseline`);
          assert.equal(car.airborne, baseCar.airborne, `bridge ${id} dir=${dir} lat=${lat} step=${step} airborne matches baseline`);
          const at = (car.x - ax) * ux + (car.z - az) * uz;
          if (dir > 0 ? at >= endS : at <= endS) { reachedFar = true; break; }
        }
        assert.equal(reachedFar, true, `bridge ${id} dir=${dir} lat=${lat} car reaches far bank`);
      }
    }
    // Off-height rail checks: probes below the span on terrain, with car top 2 cm below deckY on both slopes,
    // outside the inclined portals at 0.60 m above deck (clear of inner rail outer face 2.075 m and inclined truss),
    // 5 m above the deck, and 0.6 m before either inclined portal at 1.8 m above deck must not hit truss rail walls.
    const underGround = realTerrain.heightAt(mx, mz);
    const highEndS = y1 >= y0 ? span - 3.0 : 3.0;
    const highEndDeckY = y0 + (y1 - y0) * (highEndS / span);
    const footprintDrop = (CAR_SPEC.envelope.reach + CAR_SPEC.envelope.radius) * Math.abs(y1 - y0) / span;
    const railOuter = PONY_TRUSS.railInner + 0.07;
    const railOuterClear = railOuter + CAR_SPEC.envelope.radius + 0.02;
    const railOuterHit = railOuter + CAR_SPEC.envelope.radius - 0.03;
    const trussInnerClear = PONY_TRUSS.clearHalf - CAR_SPEC.envelope.radius - 0.02;
    const trussInnerHit = PONY_TRUSS.clearHalf - CAR_SPEC.envelope.radius + 0.04;
    for (const [label, px, pz, probeY] of [
      ['below span', mx - uz * 1.4, mz + ux * 1.4, Math.min(underGround, midY - CAR_SPEC.height - 0.5)],
      ['top 1.5 cm below sloped deck footprint at midspan', mx - uz * 1.6, mz + ux * 1.6, midY - footprintDrop - CAR_SPEC.height - 0.015],
      ['top 1.5 cm below sloped deck footprint near higher end', ax + ux * highEndS - uz * 1.6, az + uz * highEndS + ux * 1.6, highEndDeckY - footprintDrop - CAR_SPEC.height - 0.015],
      ['outside start rail outer face (2 cm clear) at 0.60 m', ax - ux * 1.5 - uz * railOuterClear, az - uz * 1.5 + ux * railOuterClear, y0 + 0.60],
      ['outside end rail outer face (2 cm clear) at 0.60 m', bx + ux * 1.5 - uz * railOuterClear, bz + uz * 1.5 + ux * railOuterClear, y1 + 0.60],
      ['inside mid-span upper truss (2 cm clear) at 1.8 m', mx - uz * trussInnerClear, mz + ux * trussInnerClear, midY + 1.8],
      ['above truss', mx - uz * 1.4, mz + ux * 1.4, midY + 5],
      ['above start inclined portal', ax - ux * 0.6 - uz * 1.6, az - uz * 0.6 + ux * 1.6, y0 + 1.8],
      ['above end inclined portal', bx + ux * 0.6 - uz * 1.6, bz + uz * 0.6 + ux * 1.6, y1 + 1.8],
    ]) {
      const probe = {
        x: px, z: pz, y: probeY, heading,
        vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC,
      };
      const sx = probe.x, sz = probe.z, svx = probe.vx, svz = probe.vz;
      rails.block(probe, 1 / 120);
      rails.blockBridge(probe, 1 / 120);
      assert.equal(probe.x, sx, `bridge ${id} ${label} probe x is not pushed by truss rail`);
      assert.equal(probe.z, sz, `bridge ${id} ${label} probe z is not pushed by truss rail`);
      assert.equal(probe.vx, svx, `bridge ${id} ${label} probe vx is not cancelled by truss rail`);
      assert.equal(probe.vz, svz, `bridge ${id} ${label} probe vz is not cancelled by truss rail`);
    }
    // Paired positive probes on the colliding side of every vertical and lateral boundary.
    for (const [label, px, pz, probeY, minPush] of [
      ['top 2.5 cm above sloped deck footprint at midspan', mx - uz * 1.6, mz + ux * 1.6, midY - footprintDrop - CAR_SPEC.height + 0.025, 0.1],
      ['top 2.5 cm above sloped deck footprint near higher end', ax + ux * highEndS - uz * 1.6, az + uz * highEndS + ux * 1.6, highEndDeckY - footprintDrop - CAR_SPEC.height + 0.025, 0.1],
      ['start rail outer face (3 cm overlap) at 0.60 m', ax - ux * 1.5 - uz * railOuterHit, az - uz * 1.5 + ux * railOuterHit, y0 + 0.60, 0.01],
      ['end rail outer face (3 cm overlap) at 0.60 m', bx + ux * 1.5 - uz * railOuterHit, bz + uz * 1.5 + ux * railOuterHit, y1 + 0.60, 0.01],
      ['mid-span upper truss inner face (4 cm overlap) at 1.8 m', mx - uz * trussInnerHit, mz + ux * trussInnerHit, midY + 1.8, 0.02],
    ]) {
      const hitProbe = {
        x: px, z: pz, y: probeY, heading,
        vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC,
      };
      const sx = hitProbe.x, sz = hitProbe.z;
      rails.blockBridge(hitProbe, 1 / 120);
      const moved = Math.hypot(hitProbe.x - sx, hitProbe.z - sz);
      assert.ok(moved > minPush, `bridge ${id} ${label} collides with visible steel (${moved.toFixed(4)} m)`);
    }
    // Shared production registerRailContacts: test Towing.allowsPose, zero extra yaw on active vehicle, and live coupled trailer rail contact.
    for (const mode of ['solo', 'fleet']) {
      let active = null;
      const soloContacts = new AreaContacts(), fleetContacts = new AreaContacts();
      registerRailContacts(fleetContacts, soloContacts, rails, body => body === active, TRUCK_SPEC);
      const contacts = mode === 'solo' ? soloContacts : fleetContacts;
      const lowIsStart = y0 <= y1;
      const slopeS = lowIsStart ? 3.5 : span - 3.5;
      const slopeDeckY = y0 + (y1 - y0) * (slopeS / span);
      // At slopeDeckY + 0.78 (above inner rail at the lower end, still below inner rail at the higher end),
      // a car clear of the 2.08 m truss face (across = 2.08 - radius - 0.02) must NOT be pushed by the high end's inner rail.
      const slopeAcross = PONY_TRUSS.clearHalf - CAR_SPEC.envelope.radius - 0.02;
      for (const [label, px, pz, py] of [
        ['start portal 1.8 m', ax - ux * 0.6 - uz * 1.6, az - uz * 0.6 + ux * 1.6, y0 + 1.8],
        ['end portal 1.8 m', bx + ux * 0.6 - uz * 1.6, bz + uz * 0.6 + ux * 1.6, y1 + 1.8],
        ['low-end slope clear of upper truss', ax + ux * slopeS - uz * slopeAcross, az + uz * slopeS + ux * slopeAcross, slopeDeckY + 0.78],
      ]) {
        assert.equal(contacts.allows({ x: px, z: pz, y: py, heading, spec: CAR_SPEC }), true, `bridge ${id} ${mode} contacts allow ${label}`);
      }
      const truck = new Vehicle(rig(), realTerrain, net, -0.2, TRUCK_SPEC);
      active = truck;
      const glanceYaw = heading + 0.12;
      truck.place(mx - uz * 0.78, mz + ux * 0.78, glanceYaw);
      truck.vx = Math.sin(glanceYaw) * 4; truck.vz = -Math.cos(glanceYaw) * 4; truck.speed = 4;
      truck.update(1 / 120, { throttle: 0, steer: 0, handbrake: false, touch: false });
      truck.x -= uz * 0.03; truck.z += ux * 0.03;
      const preX = truck.x, preZ = truck.z, preHeading = truck.heading;
      contacts.resolve(truck);
      const resolvedMove = Math.hypot(truck.x - preX, truck.z - preZ);
      const extraYaw = Math.abs(Math.atan2(Math.sin(truck.heading - preHeading), Math.cos(truck.heading - preHeading)));
      assert.ok(resolvedMove > 0.01, `bridge ${id} ${mode} active vehicle gets position correction from bridge rail (${resolvedMove.toFixed(4)} m)`);
      assert.equal(extraYaw, 0, `bridge ${id} ${mode} active vehicle gets zero extra rail steering after Vehicle.step()`);
      truck.place(mx, mz, heading);
      const towing = new Towing(truck, realTerrain, net, true, false, { contacts }, true, true);
      assert.equal(towing.allowsPose({ x: mx, z: mz, heading }), true, `bridge ${id} ${mode} Towing accepts centred truck+trailer`);
      for (const offset of [-0.72, 0.72, -1.1, 1.1]) {
        const off = { x: mx - uz * offset, z: mz + ux * offset, heading };
        assert.equal(towing.allowsPose(off), false, `bridge ${id} ${mode} Towing rejects ${offset} m off-centre truck+trailer`);
      }
      // Live coupled trailer rail contact: place the whole rig inside [0, span] near the rail, then angle the trailer into the rail side.
      const rigS = span - 3.5;
      const rigX = ax + ux * rigS, rigZ = az + uz * rigS;
      truck.place(rigX - uz * 0.55, rigZ + ux * 0.55, heading);
      assert.equal(towing.place(), true, `bridge ${id} ${mode} towing.place succeeds at clear 0.55 m offset`);
      const startTruckAlong = (truck.x - ax) * ux + (truck.z - az) * uz;
      const startTrailerAlong = (towing.x - ax) * ux + (towing.z - az) * uz;
      assert.ok(startTrailerAlong > 2 && startTruckAlong < span - 1, `bridge ${id} ${mode} whole rig sits inside [0, span]`);
      const preTruckLat = -(truck.x - ax) * uz + (truck.z - az) * ux;
      towing.heading = heading - 0.05;
      truck.vx = (ux * Math.cos(0.08) - uz * Math.sin(0.08)) * 4;
      truck.vz = (uz * Math.cos(0.08) + ux * Math.sin(0.08)) * 4;
      truck.speed = 4;
      const preImpactCount = towing.impacts;
      towing.step(1 / 120);
      const postTruckLat = -(truck.x - ax) * uz + (truck.z - az) * ux;
      assert.ok(towing.impacts > preImpactCount, `bridge ${id} ${mode} live trailer rail contact registers an impact`);
      assert.ok(postTruckLat < preTruckLat - 0.05, `bridge ${id} ${mode} live trailer rail contact pushes the coupled rig inward (${(preTruckLat - postTruckLat).toFixed(3)} m)`);
      for (const body of towing.bodies()) {
        const lat = Math.abs(-(body.x - ax) * uz + (body.z - az) * ux);
        assert.ok(lat + body.spec.envelope.radius <= PONY_TRUSS.railInner + 0.02, `bridge ${id} ${mode} contact step keeps body inside rail (${(lat + body.spec.envelope.radius).toFixed(3)})`);
      }
      for (let step = 0; step < 90; step++) {
        truck.update(1 / 120, { throttle: 0.4, steer: -0.15, handbrake: false, touch: false });
        towing.step(1 / 120);
        for (const body of towing.bodies()) {
          const lat = Math.abs(-(body.x - ax) * uz + (body.z - az) * ux);
          assert.ok(lat + body.spec.envelope.radius <= PONY_TRUSS.railInner + 0.02, `bridge ${id} ${mode} follow-up step ${step} keeps body inside rail`);
        }
      }
      const endTruckAlong = (truck.x - ax) * ux + (truck.z - az) * uz;
      const endTrailerAlong = (towing.x - ax) * ux + (towing.z - az) * uz;
      assert.ok(endTruckAlong > startTruckAlong + 0.3, `bridge ${id} ${mode} truck continues forward after rail contact (${(endTruckAlong - startTruckAlong).toFixed(3)} m)`);
      assert.ok(endTrailerAlong > startTrailerAlong + 0.3, `bridge ${id} ${mode} trailer continues forward after rail contact (${(endTrailerAlong - startTrailerAlong).toFixed(3)} m)`);
    }
  }
  // Level 6 -> 7 -> 8 streaming upgrades: each finer bank level replaces and disposes the previous mesh and updates deckHeight to exact bank ground + 0.05.
  {
    let curLevel = 6, bias = 0;
    const streamTerrain = {
      manifest: mabouManifest, dataRevision: 1, exag: 1.5, seaLevel: -0.2, low: false,
      heightAt: (x, z) => realTerrain.heightAt(x, z),
      surfaceAt: (x, z) => { const s = realTerrain.surfaceAt(x, z); return s ? { ...s, ground: s.ground + bias, level: curLevel } : null; },
      withContactHeight: (_, read) => read(), withGroundContact: (_, read) => read(),
    };
    const streamNet = new Roads({ roads: tagged }, mabouManifest.village, streamTerrain);
    for (const id of [45, 46]) {
      const r = streamNet.roads.find(x => x.id === id);
      const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const bankEnd = (a, b) => { const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; return [a[0] + ((a[0] - b[0]) / d) * 3, a[1] + ((a[1] - b[1]) / d) * 3]; };
      const b0 = bankEnd(r.pts[0], r.pts[1]), b1 = bankEnd(r.pts[r.pts.length - 1], r.pts[r.pts.length - 2]);
      let prevMesh = null;
      for (const [lvl, bOff] of [[6, 0.0], [7, 0.25], [8, 0.5]]) {
        curLevel = lvl; bias = bOff; streamTerrain.dataRevision++;
        let disposed = false;
        if (prevMesh) { const orig = prevMesh.geometry.dispose.bind(prevMesh.geometry); prevMesh.geometry.dispose = () => { disposed = true; orig(); }; }
        const h = streamNet.deckHeight(mx, mz);
        const expected = ((streamTerrain.surfaceAt(b0[0], b0[1]).ground + 0.05) + (streamTerrain.surfaceAt(b1[0], b1[1]).ground + 0.05)) / 2;
        assert.ok(Math.abs(h - expected) < 1e-6, `bridge ${id} level ${lvl} deckHeight updates to bank ground + 0.05`);
        const mesh = streamNet.group.children.find(c => c.name === `pony-truss-${id}`);
        assert.ok(mesh, `bridge ${id} level ${lvl} has mesh`);
        if (prevMesh) {
          assert.notEqual(mesh, prevMesh, `bridge ${id} level ${lvl} replaces coarser mesh`);
          assert.equal(disposed, true, `bridge ${id} level ${lvl} disposes replaced mesh geometry`);
        }
        prevMesh = mesh;
      }
    }
    for (const child of [...streamNet.group.children]) child.geometry?.dispose();
  }
  // Contact-first level 6 -> 8 terrain upgrade: each direct contact entry point (solo.allows, fleet.allows, blockBridge)
  // refreshes a stale level-6 deck on its own fresh fixture BEFORE any revision read or deckHeight() call.
  const makeUpgradeFixture = () => {
    let curLevel = 6, bias = 0;
    const upTerrain = {
      manifest: mabouManifest, dataRevision: 1, exag: 1.5, seaLevel: -0.2, low: false,
      heightAt: (x, z) => realTerrain.heightAt(x, z),
      surfaceAt: (x, z) => { const s = realTerrain.surfaceAt(x, z); return s ? { ...s, ground: s.ground + bias, level: curLevel } : null; },
      withContactHeight: (_, read) => read(), withGroundContact: (_, read) => read(),
    };
    const upNet = new Roads({ roads: tagged }, mabouManifest.village, upTerrain);
    const soloUp = new AreaContacts(), fleetUp = new AreaContacts();
    registerRailContacts(fleetUp, soloUp, upNet.guardrails, () => false, CAR_SPEC);
    return {
      upTerrain, upNet, soloUp, fleetUp,
      upgrade(extraBias = 1.5) { curLevel = 8; bias = extraBias; upTerrain.dataRevision++; },
      dispose() { for (const child of [...upNet.group.children]) child.geometry?.dispose(); },
    };
  };
  for (const id of [45, 46]) {
    for (const entry of ['solo', 'fleet', 'blockBridge']) {
      const f = makeUpgradeFixture();
      const r = f.upNet.roads.find(x => x.id === id);
      const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
      const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span, hdg = Math.atan2(dx, -dz);
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const y6 = f.upNet.deckHeight(mx, mz);
      assert.ok(y6 !== null, `bridge ${id} ${entry} seeds level-6 deck`);
      f.upgrade(1.5);
      // Do NOT read revision or call deckHeight() before invoking the direct contact entry point.
      const pose = { x: mx - uz * 1.6, z: mz + ux * 1.6, y: y6 + 1.5 - CAR_SPEC.height - 0.5, heading: hdg, spec: CAR_SPEC };
      if (entry === 'solo') assert.equal(f.soloUp.allows(pose), true, `bridge ${id} direct soloContacts.allows refreshes stale level-6 deck`);
      else if (entry === 'fleet') assert.equal(f.fleetUp.allows(pose), true, `bridge ${id} direct fleetContacts.allows refreshes stale level-6 deck`);
      else {
        const probe = { ...pose, vx: -uz * 4, vz: ux * 4, speed: 0 };
        f.upNet.guardrails.blockBridge(probe, 1 / 120);
        assert.equal(probe.x, pose.x, `bridge ${id} direct blockBridge refreshes stale level-6 deck`);
        assert.equal(probe.z, pose.z, `bridge ${id} direct blockBridge refreshes stale level-6 deck`);
      }
      f.dispose();
    }
  }
  // Revision tracking: unrelated terrain revisions keep contact revisions steady; a deck-only upgrade with fixed planner counts
  // advances fleetContacts.revision; and opposing planner-count / bridge-version deltas NEVER cancel out.
  {
    const f = makeUpgradeFixture();
    const r45 = f.upNet.roads.find(x => x.id === 45), r46 = f.upNet.roads.find(x => x.id === 46);
    const m45x = (r45.pts[0][0] + r45.pts[r45.pts.length - 1][0]) / 2, m45z = (r45.pts[0][1] + r45.pts[r45.pts.length - 1][1]) / 2;
    const m46x = (r46.pts[0][0] + r46.pts[r46.pts.length - 1][0]) / 2, m46z = (r46.pts[0][1] + r46.pts[r46.pts.length - 1][1]) / 2;
    assert.ok(f.upNet.deckHeight(m45x, m45z) !== null, 'bridge 45 seeded at level 6');
    assert.ok(f.upNet.deckHeight(m46x, m46z) !== null, 'bridge 46 seeded at level 6');
    f.upNet.guardrails.audit.samples = 48;
    const rev0Fleet = f.fleetUp.revision, rev0Solo = f.soloUp.revision;
    f.upTerrain.dataRevision++;
    assert.equal(f.fleetUp.revision, rev0Fleet, 'unrelated terrain revision keeps fleetContacts.revision steady');
    assert.equal(f.soloUp.revision, rev0Solo, 'unrelated terrain revision keeps soloContacts.revision steady');
    // 1. Deck-only upgrade with planner counts held fixed at 48 (fails if independent bridge provider is removed).
    f.upgrade(1.0);
    const rev1Fleet = f.fleetUp.revision, rev1Solo = f.soloUp.revision;
    assert.notEqual(rev1Fleet, rev0Fleet, 'deck-only upgrade with fixed planner counts advances fleetContacts.revision');
    assert.notEqual(rev1Solo, rev0Solo, 'deck-only upgrade advances soloContacts.revision');
    f.dispose();
  }
  {
    const f = makeUpgradeFixture();
    for (const id of [45, 46]) {
      const r = f.upNet.roads.find(x => x.id === id);
      const mx = (r.pts[0][0] + r.pts[r.pts.length - 1][0]) / 2, mz = (r.pts[0][1] + r.pts[r.pts.length - 1][1]) / 2;
      assert.ok(f.upNet.deckHeight(mx, mz) !== null, `bridge ${id} seeded at level 6`);
    }
    f.upNet.guardrails.audit.samples = 48;
    const revBeforeFleet = f.fleetUp.revision, revBeforeSolo = f.soloUp.revision;
    // 2. Simultaneous opposing change (samples 48 -> 46 while both decks upgrade +2): independent providers never cancel.
    f.upNet.guardrails.audit.samples = 46;
    f.upgrade(1.0);
    assert.notEqual(f.fleetUp.revision, revBeforeFleet, 'fleetContacts.revision advances even when planner counts fall by the exact deck-version increase');
    assert.notEqual(f.soloUp.revision, revBeforeSolo, 'soloContacts.revision advances on level-8 upgrade');
    f.dispose();
  }
  // Pure read-only allowsBridge check: querying allowsBridge on a fresh Roads instance builds zero meshes and keeps bridgeDeckVersion at 0.
  {
    const freshNet = new Roads({ roads: tagged }, mabouManifest.village, realTerrain);
    const childrenBefore = freshNet.group.children.length;
    const verBefore = freshNet.bridgeDeckVersion;
    const r45 = freshNet.roads.find(x => x.id === 45);
    const [ax, az] = r45.pts[0], [bx, bz] = r45.pts[r45.pts.length - 1];
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, hdg = Math.atan2(bx - ax, -(bz - az));
    assert.equal(freshNet.guardrails.allowsBridge({ x: mx, z: mz, y: 3.6, heading: hdg, spec: CAR_SPEC }), true, 'fresh allowsBridge accepts centred pose');
    assert.equal(freshNet.group.children.length, childrenBefore, 'allowsBridge does not build or add scene meshes');
    assert.equal(freshNet.bridgeDeckVersion, verBefore, 'allowsBridge does not advance bridgeDeckVersion');
    for (const child of [...freshNet.group.children]) child.geometry?.dispose();
  }
  // Independent circle-vs-rail overlap calculator (does not call allowsBridge or pushOut).
  const independentInnerRailOverlap = (pose, ax, az, ux, uz, span) => {
    const env = pose.spec.envelope, sinH = Math.sin(pose.heading), cosH = Math.cos(pose.heading);
    let maxPen = 0;
    for (let i = 0; i < env.circles.length; i++) {
      const off = env.circles[i], side = env.circleSides?.[i] ?? 0;
      const cx = pose.x + sinH * off + cosH * side - ax, cz = pose.z - cosH * off + sinH * side - az;
      const s = cx * ux + cz * uz, across = Math.abs(-cx * uz + cz * ux);
      const ds = s < 0.005 ? 0.005 - s : s > span - 0.005 ? s - (span - 0.005) : 0;
      const da = across < PONY_TRUSS.railInner ? PONY_TRUSS.railInner - across : across > PONY_TRUSS.outerHalf ? across - PONY_TRUSS.outerHalf : 0;
      maxPen = Math.max(maxPen, env.radius - Math.hypot(ds, da));
    }
    return maxPen;
  };
  // High-speed angled portal hits and 75-step full-steer wedge prevention on both bridges:
  // after every step, independent circle-vs-rail overlap is <= 0 AND allowsBridge is true.
  for (const id of [45, 46]) {
    const r = net.roads.find(x => x.id === id);
    const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
    const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span, hdg = Math.atan2(dx, -dz);
    const soloAng = new AreaContacts(), fleetAng = new AreaContacts();
    const car = new Vehicle(rig(), realTerrain, net, -0.2, CAR_SPEC);
    registerRailContacts(fleetAng, soloAng, rails, body => body === car, CAR_SPEC);
    // Case A: Sol's 38-deg, 32 m/s, 75-step half-throttle full-left-steer opposing-rail wedge scenario.
    const angle38 = hdg + (38 * Math.PI) / 180;
    const f38x = Math.sin(angle38), f38z = -Math.cos(angle38);
    car.place(ax - ux * 1.0 + uz * 0.30, az - uz * 1.0 - ux * 0.30, angle38);
    assert.equal(soloAng.allows({ x: car.x, z: car.z, y: car.y, heading: car.heading, spec: CAR_SPEC }), true, `bridge ${id} 38-deg start pose is clear`);
    car.vx = f38x * 32; car.vz = f38z * 32; car.speed = 32;
    for (let step = 0; step < 75; step++) {
      car.update(1 / 120, { throttle: 0.5, steer: -1, handbrake: false, touch: false });
      soloAng.resolve(car);
      const pen = independentInnerRailOverlap({ x: car.x, z: car.z, heading: car.heading, spec: CAR_SPEC }, ax, az, ux, uz, span);
      assert.ok(pen <= 1e-4, `bridge ${id} 38-deg 32 m/s step ${step} has zero independent rail overlap (${pen.toFixed(5)} m)`);
      assert.equal(soloAng.allows({ x: car.x, z: car.z, y: car.y, heading: car.heading, spec: CAR_SPEC }), true, `bridge ${id} 38-deg 32 m/s step ${step} resolves clear of both rails`);
    }
    // Case B: Sol's exact 9.2 m, 0.6 m off-centre, 65-deg opposing-rail wedge where left/right pushes cancel in a single pass.
    const wS = Math.min(9.2, span * 0.53), wY = net.deckHeight(ax + ux * wS, az + uz * wS);
    const wedged = { x: ax + ux * wS - uz * 0.6, z: az + uz * wS + ux * 0.6, y: wY, heading: hdg + (65 * Math.PI) / 180, vx: ux * 8, vz: uz * 8, speed: 0, spec: CAR_SPEC };
    assert.ok(independentInnerRailOverlap(wedged, ax, az, ux, uz, span) > 0.05, `bridge ${id} 65-deg test pose starts deeply wedged`);
    assert.equal(rails.allowsBridge(wedged), false, `bridge ${id} allowsBridge rejects 65-deg wedged pose`);
    rails.blockBridge(wedged, 1 / 120);
    const penAfter = independentInnerRailOverlap(wedged, ax, az, ux, uz, span);
    assert.ok(penAfter <= 1e-4, `bridge ${id} blockBridge resolves 65-deg wedged pose to zero independent overlap (${penAfter.toFixed(5)} m)`);
    assert.equal(rails.allowsBridge(wedged), true, `bridge ${id} allowsBridge accepts resolved pose`);
  }
  // Exact finite rotated bottom-chord underside and high-portal inner-rail tests at 3.0x: measure the rendered steel directly
  // and verify paired clear/contact probes right below/above it (catches flat or untrimmed cutoffs).
  {
    const t3 = makeRealTerrain(3.0, 8);
    const net3 = new Roads({ roads: tagged }, mabouManifest.village, t3);
    const r45 = net3.roads.find(x => x.id === 45);
    const [ax, az] = r45.pts[0], [bx, bz] = r45.pts[r45.pts.length - 1];
    const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span, hdg = Math.atan2(dx, -dz);
    const y0 = net3.deckHeight(ax, az), y1 = net3.deckHeight(bx, bz);
    assert.ok(y0 !== null && y1 !== null && y1 > y0, 'bridge 45 rises from start to end at 3x');
    const mesh3 = net3.group.children.find(c => c.name === 'pony-truss-45');
    const pos3 = mesh3.geometry.getAttribute('position'), col3 = mesh3.geometry.getAttribute('color');
    let minSteelY = Infinity, maxHighRailY = -Infinity;
    for (let i = 0; i < pos3.count; i++) {
      const rCol = col3.getX(i);
      const px = pos3.getX(i), py = pos3.getY(i), pz = pos3.getZ(i);
      const along = (px - ax) * ux + (pz - az) * uz;
      const across = Math.abs(-(px - ax) * uz + (pz - az) * ux);
      if (rCol >= 0.30 && rCol <= 0.35 && along >= -0.05 && along <= 1.0 && across >= PONY_TRUSS.clearHalf - 0.01 && across <= PONY_TRUSS.outerHalf + 0.01) {
        minSteelY = Math.min(minSteelY, py);
      }
      if (rCol >= 0.36 && along >= span - 1.0 && along <= span + 0.05 && across >= PONY_TRUSS.railInner - 0.01 && across <= PONY_TRUSS.railInner + 0.08) {
        maxHighRailY = Math.max(maxHighRailY, py);
      }
    }
    assert.ok(Number.isFinite(minSteelY) && minSteelY > y0, `bridge 45 3x trimmed rotated bottom chord starts slightly above y0 (${(minSteelY - y0).toFixed(6)} m)`);
    assert.ok(Number.isFinite(maxHighRailY) && maxHighRailY < y1 + PONY_TRUSS.railHeight + 0.11, `bridge 45 3x trimmed rotated high inner rail tops slightly below unclipped band`);
    const probeX = ax + ux * 0.2 - uz * 1.6, probeZ = az + uz * 0.2 + ux * 1.6;
    const clearLow = { x: probeX, z: probeZ, y: minSteelY - CAR_SPEC.height - 0.0005, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    const sx = clearLow.x, sz = clearLow.z;
    net3.guardrails.blockBridge(clearLow, 1 / 120);
    assert.equal(clearLow.x, sx, 'bridge 45 3x low-portal probe 0.5 mm below trimmed rotated bottom chord is not pushed');
    assert.equal(clearLow.z, sz, 'bridge 45 3x low-portal probe 0.5 mm below trimmed rotated bottom chord is not pushed');
    const hitLow = { x: probeX, z: probeZ, y: minSteelY - CAR_SPEC.height + 0.001, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    net3.guardrails.blockBridge(hitLow, 1 / 120);
    assert.ok(Math.hypot(hitLow.x - sx, hitLow.z - sz) > 0.01, 'bridge 45 3x low-portal probe 1 mm above trimmed rotated bottom chord collides');
    // Paired high-portal inner-rail probes: 1 mm above trimmed rotated inner rail (clear of inclined end post) vs 3 mm below it.
    const hiX = bx + ux * 1.5 - uz * (PONY_TRUSS.railInner - CAR_SPEC.envelope.radius + 0.04);
    const hiZ = bz + uz * 1.5 + ux * (PONY_TRUSS.railInner - CAR_SPEC.envelope.radius + 0.04);
    const clearHi = { x: hiX, z: hiZ, y: maxHighRailY + 0.001, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    net3.guardrails.blockBridge(clearHi, 1 / 120);
    assert.equal(clearHi.x, hiX, 'bridge 45 3x high-portal probe 1 mm above trimmed rotated inner rail is not pushed');
    assert.equal(clearHi.z, hiZ, 'bridge 45 3x high-portal probe 1 mm above trimmed rotated inner rail is not pushed');
    const hitHi = { x: hiX, z: hiZ, y: maxHighRailY - 0.003, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    net3.guardrails.blockBridge(hitHi, 1 / 120);
    assert.ok(Math.hypot(hitHi.x - hiX, hitHi.z - hiZ) > 0.005, 'bridge 45 3x high-portal probe 3 mm below trimmed rotated inner rail collides');
    // High-portal bottom-chord top clearance at 3x (carY just above the trimmed rotated bottom chord top, clearing inclined end post).
    let maxHighChordY = -Infinity;
    for (let i = 0; i < pos3.count; i++) {
      const rCol = col3.getX(i);
      if (rCol < 0.30 || rCol > 0.35) continue;
      const px = pos3.getX(i), py = pos3.getY(i), pz = pos3.getZ(i);
      const along = (px - ax) * ux + (pz - az) * uz;
      const across = Math.abs(-(px - ax) * uz + (pz - az) * ux);
      if (along >= span - 0.05 && along <= span + 0.05 && across >= PONY_TRUSS.clearHalf - 0.01 && across <= PONY_TRUSS.outerHalf + 0.01) {
        maxHighChordY = Math.max(maxHighChordY, py);
      }
    }
    const hiChordX = bx + ux * 1.58 - uz * (PONY_TRUSS.outerHalf + CAR_SPEC.envelope.radius - 0.04);
    const hiChordZ = bz + uz * 1.58 + ux * (PONY_TRUSS.outerHalf + CAR_SPEC.envelope.radius - 0.04);
    const clearHiChord = { x: hiChordX, z: hiChordZ, y: maxHighChordY + 0.001, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    net3.guardrails.blockBridge(clearHiChord, 1 / 120);
    assert.equal(clearHiChord.x, hiChordX, 'bridge 45 3x high-portal probe 1 mm above trimmed rotated bottom chord is not pushed');
    assert.equal(clearHiChord.z, hiChordZ, 'bridge 45 3x high-portal probe 1 mm above trimmed rotated bottom chord is not pushed');
    const hitHiChord = { x: hiChordX, z: hiChordZ, y: maxHighChordY - 0.01, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    net3.guardrails.blockBridge(hitHiChord, 1 / 120);
    assert.ok(Math.hypot(hitHiChord.x - hiChordX, hitHiChord.z - hiChordZ) > 0.005, 'bridge 45 3x high-portal probe 1 cm below trimmed rotated bottom chord collides');
    // Isolated member probes on Bridge 45 at 3x: top chord, start inclined end post, finish inclined end post (each paired clear + contact).
    const panels45 = Math.max(4, Math.round(span / PONY_TRUSS.targetPanel / 2) * 2), panel45 = span / panels45;
    const h45 = ponyTrussHeight(span), midY45 = (y0 + y1) / 2;
    const endOutClear = PONY_TRUSS.half + PONY_TRUSS.endPostSize / 2 + CAR_SPEC.envelope.radius + 0.02;
    const endOutHit = PONY_TRUSS.half + PONY_TRUSS.endPostSize / 2 + CAR_SPEC.envelope.radius - 0.04;
    const topInClear = PONY_TRUSS.clearHalf - CAR_SPEC.envelope.radius - 0.02;
    const topInHit = PONY_TRUSS.clearHalf - CAR_SPEC.envelope.radius + 0.04;
    // Top chord alone (carY sits at midY45 + h45 + 0.05, above all posts/diagonals/rails, touching only the top chord top half).
    for (const [label, across, expectHit] of [
      ['top chord clear', topInClear, false],
      ['top chord contact', topInHit, true],
    ]) {
      const p = { x: (ax + bx) / 2 - uz * across, z: (az + bz) / 2 + ux * across, y: midY45 + h45 + 0.05, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
      const sx0 = p.x, sz0 = p.z;
      net3.guardrails.blockBridge(p, 1 / 120);
      const d = Math.hypot(p.x - sx0, p.z - sz0);
      if (expectHit) assert.ok(d > 0.01, `bridge 45 ${label} collides (${d.toFixed(4)} m)`);
      else assert.equal(d, 0, `bridge 45 ${label} clears (${d.toFixed(4)} m)`);
    }
    // Start inclined end post alone (s = panel45 * 0.5, carY above inner rail + bottom chord, well outside top chord).
    const startPostS = panel45 * 0.5, startPostY = y0 + (y1 - y0) * (startPostS / span) + 1.1;
    for (const [label, sOff, across, expectHit] of [
      ['start inclined end post clear (outside 0.22 m face)', startPostS - 1.35, endOutClear, false],
      ['start inclined end post contact', startPostS - 1.35, endOutHit, true],
    ]) {
      const p = { x: ax + ux * sOff - uz * across, z: az + uz * sOff + ux * across, y: startPostY, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
      const sx0 = p.x, sz0 = p.z;
      net3.guardrails.blockBridge(p, 1 / 120);
      const d = Math.hypot(p.x - sx0, p.z - sz0);
      if (expectHit) assert.ok(d > 0.01, `bridge 45 ${label} collides (${d.toFixed(4)} m)`);
      else assert.equal(d, 0, `bridge 45 ${label} clears (${d.toFixed(4)} m)`);
    }
    // Finish inclined end post alone (s = span - panel45 * 0.5, carY above inner rail + bottom chord, well outside top chord).
    const endPostS = span - panel45 * 0.5, endPostY = y0 + (y1 - y0) * (endPostS / span) + 1.1;
    for (const [label, sOff, across, expectHit] of [
      ['finish inclined end post clear (outside 0.22 m face)', endPostS + 1.35, endOutClear, false],
      ['finish inclined end post contact', endPostS + 1.35, endOutHit, true],
    ]) {
      const p = { x: ax + ux * sOff - uz * across, z: az + uz * sOff + ux * across, y: endPostY, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
      const sx0 = p.x, sz0 = p.z;
      net3.guardrails.blockBridge(p, 1 / 120);
      const d = Math.hypot(p.x - sx0, p.z - sz0);
      if (expectHit) assert.ok(d > 0.01, `bridge 45 ${label} collides (${d.toFixed(4)} m)`);
      else assert.equal(d, 0, `bridge 45 ${label} clears (${d.toFixed(4)} m)`);
    }
    // Isolated interior Warren diagonal, interior vertical post, interior standoff bracket, end-post standoff bracket,
    // and open truss-window gap probes (paired hit + clearance at exact rendered member edges).
    const smallSpec = { ...CAR_SPEC, height: 0.06, envelope: { ...CAR_SPEC.envelope, circles: [0], radius: 0.08, reach: 0.2 } };
    const tinySpec = { ...CAR_SPEC, height: 0.04, envelope: { ...CAR_SPEC.envelope, circles: [0], radius: 0.005, reach: 0.05 } };
    const deck45At = s => y0 + (y1 - y0) * (s / span);
    const yBase45 = PONY_TRUSS.chordSize * 0.5;
    const diagMidS = panel45 * 1.5, diagMidY = deck45At(diagMidS) + (yBase45 + h45) * 0.5;
    const diagOutClear = PONY_TRUSS.half + PONY_TRUSS.diagSize * 0.5 + smallSpec.envelope.radius + 0.02;
    const diagOutHit = PONY_TRUSS.half + PONY_TRUSS.diagSize * 0.5 + smallSpec.envelope.radius - 0.04;
    const postOutClear = PONY_TRUSS.half + PONY_TRUSS.postSize * 0.5 + smallSpec.envelope.radius + 0.02;
    const postOutHit = PONY_TRUSS.half + PONY_TRUSS.postSize * 0.5 + smallSpec.envelope.radius - 0.04;
    for (const [label, sPos, across, py, spec, expectHit] of [
      ['interior diagonal clear (2 cm outside 0.16 m face)', diagMidS, diagOutClear, diagMidY, smallSpec, false],
      ['interior diagonal contact', diagMidS, diagOutHit, diagMidY, smallSpec, true],
      ['open truss window gap between post 1 and diagonal 1', panel45 * 1.25, diagOutHit, deck45At(panel45 * 1.25) + yBase45 + 0.35, smallSpec, false],
      ['interior vertical post clear (2 cm outside 0.16 m face)', panel45, postOutClear, deck45At(panel45) + (yBase45 + h45) * 0.5, smallSpec, false],
      ['interior vertical post contact', panel45, postOutHit, deck45At(panel45) + (yBase45 + h45) * 0.5, smallSpec, true],
      ['interior standoff bracket contact (isolated between rail and post)', panel45, 2.0825, deck45At(panel45) + PONY_TRUSS.railHeight, tinySpec, true],
      ['gap beside interior standoff bracket', panel45 + 0.25, 2.0825, deck45At(panel45 + 0.25) + PONY_TRUSS.railHeight, tinySpec, false],
      ['start end-post standoff bracket contact', panel45 * ((PONY_TRUSS.railHeight - yBase45) / (h45 - yBase45)), 2.0825, deck45At(panel45 * ((PONY_TRUSS.railHeight - yBase45) / (h45 - yBase45))) + PONY_TRUSS.railHeight, tinySpec, true],
      ['finish end-post standoff bracket contact', span - panel45 * ((PONY_TRUSS.railHeight - yBase45) / (h45 - yBase45)), 2.0825, deck45At(span - panel45 * ((PONY_TRUSS.railHeight - yBase45) / (h45 - yBase45))) + PONY_TRUSS.railHeight, tinySpec, true],
      ['gap beside start end-post standoff bracket', panel45 * ((PONY_TRUSS.railHeight - yBase45) / (h45 - yBase45)) + 0.25, 2.0825, deck45At(panel45 * ((PONY_TRUSS.railHeight - yBase45) / (h45 - yBase45)) + 0.25) + PONY_TRUSS.railHeight, tinySpec, false],
    ]) {
      const p = { x: ax + ux * sPos - uz * across, z: az + uz * sPos + ux * across, y: py, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec };
      const sx0 = p.x, sz0 = p.z;
      net3.guardrails.blockBridge(p, 1 / 120);
      const d = Math.hypot(p.x - sx0, p.z - sz0);
      if (expectHit) assert.ok(d > 0.002, `bridge 45 ${label} collides (${d.toFixed(5)} m)`);
      else assert.equal(d, 0, `bridge 45 ${label} clears (${d.toFixed(5)} m)`);
    }
    // Gap between clipped members on Bridge 46 at 3x: at high top-chord elevation on a sloped span,
    // a car in the clear gap between the clipped top chord and the lower end does NOT hit invisible merged steel.
    {
      const r46 = net3.roads.find(x => x.id === 46);
      const [a6x, a6z] = r46.pts[0], [b6x, b6z] = r46.pts[r46.pts.length - 1];
      const d6x = b6x - a6x, d6z = b6z - a6z, span46 = Math.hypot(d6x, d6z), u6x = d6x / span46, u6z = d6z / span46, hdg46 = Math.atan2(d6x, -d6z);
      const y60 = net3.deckHeight(a6x, a6z), y61 = net3.deckHeight(b6x, b6z);
      const h46 = ponyTrussHeight(span46);
      const gapS = 24.16, gapDeckY = y60 + (y61 - y60) * (gapS / span46);
      const gapY = gapDeckY + h46 + PONY_TRUSS.chordSize * 0.5 + 0.04;
      const gapAcross = PONY_TRUSS.clearHalf - CAR_SPEC.envelope.radius + 0.04;
      const gapProbe = { x: a6x + u6x * gapS - u6z * gapAcross, z: a6z + u6z * gapS + u6x * gapAcross, y: gapY, heading: hdg46, vx: -u6z * 4, vz: u6x * 4, speed: 0, spec: CAR_SPEC };
      const gx0 = gapProbe.x, gz0 = gapProbe.z, gvx0 = gapProbe.vx, gvz0 = gapProbe.vz;
      net3.guardrails.blockBridge(gapProbe, 1 / 120);
      assert.equal(gapProbe.x, gx0, 'bridge 46 3x probe in gap above sloped top chord is not pushed');
      assert.equal(gapProbe.z, gz0, 'bridge 46 3x probe in gap above sloped top chord is not pushed');
      assert.equal(gapProbe.vx, gvx0, 'bridge 46 3x probe in gap keeps exact vx');
      assert.equal(gapProbe.vz, gvz0, 'bridge 46 3x probe in gap keeps exact vz');
    }
    for (const child of [...net3.group.children]) child.geometry?.dispose();
  }
  // Unloaded banks: repeated collision calls during the same terrain revision do not keep re-sampling bank endpoints,
  // and advancing to a loaded revision retries once, builds the deck, and blocks an overlapping vehicle.
  {
    let surfaceCalls = 0;
    const coarseTerrain = {
      level: 5, manifest: mabouManifest, dataRevision: 1, exag: 1.5, seaLevel: -0.2, low: false,
      heightAt: (x, z) => realTerrain.heightAt(x, z),
      surfaceAt: (x, z) => { surfaceCalls++; const s = realTerrain.surfaceAt(x, z); return s ? { ...s, level: coarseTerrain.level } : null; },
      withContactHeight: (_, read) => read(), withGroundContact: (_, read) => read(),
    };
    const coarseNet = new Roads({ roads: tagged }, mabouManifest.village, coarseTerrain);
    const r45 = coarseNet.roads.find(x => x.id === 45);
    const [ax, az] = r45.pts[0], [bx, bz] = r45.pts[r45.pts.length - 1];
    const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, hdg = Math.atan2(dx, -dz);
    const probe = { x: mx - uz * 1.6, z: mz + ux * 1.6, y: 3.55, heading: hdg, vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC };
    const startX = probe.x, startZ = probe.z;
    for (let i = 0; i < 120; i++) coarseNet.guardrails.block(probe, 1 / 120);
    assert.ok(surfaceCalls <= 2, `unloaded bridge banks sample at most once per revision (got ${surfaceCalls})`);
    assert.equal(probe.x, startX, 'unloaded bank does not push before deck exists');
    assert.equal(probe.z, startZ, 'unloaded bank does not push before deck exists');
    coarseTerrain.level = 8;
    coarseTerrain.dataRevision = 2;
    coarseNet.guardrails.block(probe, 1 / 120);
    assert.ok(Math.hypot(probe.x - startX, probe.z - startZ) > 0.1, 'loaded revision retries deck lookup and blocks overlapping vehicle');
    for (const child of [...coarseNet.group.children]) child.geometry?.dispose();
  }
  // Other Mabou bridges keep the generic modern deck.
  const otherBridge = net.roads.find(r => r.id === 50);
  assert.ok(otherBridge && !otherBridge.ponyTruss, 'Mabou Harbour Road bridge stays generic');
  assert.ok(net.deckHeight(otherBridge.pts[0][0], otherBridge.pts[0][1]) !== null);
  assert.ok(!net.group.children.some(c => c.name === 'pony-truss-50'));
  for (const child of [...baselineNet.group.children]) child.geometry?.dispose();
  for (const child of [...net.group.children]) child.geometry?.dispose();
  // No bridge in any other installed area pack matches (including Highway 19 ids 45/46 in Judique and Canso Causeway).
  for (const dir of ['areas/judique', 'areas/porthood', 'areas/pointtupper', 'areas/westbay', 'areas/cansocauseway']) {
    if (!existsSync(`data/baked/${dir}/roads.json`)) continue;
    const d = read(dir, 'roads');
    assert.deepEqual(d.roads.map(littleMabouPonyTruss).filter(r => r.ponyTruss), [], `${dir} has no Little Mabou pony truss`);
  }
  console.log('PASS Little Mabou Road steel pony-truss bridges (ids 45 and 46; exact baseline deck physics, vertical rail bounds, solo+fleet Towing)');
}
console.log('PASS Little Mabou homes, shed and marsh rail; access and bridge exclusions');
console.log('PASS two Highway 19 aprons both land packs, gravel driveway, hillside gravel, building batches and three view starts');
