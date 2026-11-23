import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  // Exact baseline deck-physics preservation: Roads.deckHeight() is Object.is identical to untagged origin/main at both 1.5x and 3.0x.
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
          assert.ok(Object.is(ponyNet.deckHeight(x, z), baselineNet.deckHeight(x, z)), `bridge ${id} exag=${exag} deckHeight preserves baseline at s=${s.toFixed(1)}, off=${offset}`);
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
      assert.ok(along >= -1e-3 && along <= span + 1e-3, `bridge ${id} mesh vertex stays inside [0, span] (${along.toFixed(4)} vs ${span.toFixed(4)})`);
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
      const sux = sdx / slen, suz = sdz / slen, smx = (pa0 + pb0) / 2, smz = (pa1 + pb1) / 2;
      for (const offset of [-4.199, 4.199]) {
        const x = smx - suz * offset, z = smz + sux * offset;
        const y = net.deckHeight(x, z);
        assert.ok(y !== null, `bridge ${id} seg ${seg} supports polyline edge offset=${offset}`);
        ray.set(new THREE.Vector3(x, y + 0.5, z), down);
        const hit = ray.intersectObject(mesh)[0];
        assert.ok(hit && Math.abs(hit.point.y - y) < 0.005, `bridge ${id} seg ${seg} polyline edge offset=${offset} hits visible deck`);
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
    // Off-height rail checks: probes below the span on terrain, with car top 10 cm below the deck on both slopes,
    // 5 m above the deck, and 0.6 m before either inclined portal at 1.8 m above deck must not hit truss rail walls.
    const underGround = realTerrain.heightAt(mx, mz);
    const highEndS = y1 >= y0 ? span - 3.0 : 3.0;
    const highEndDeckY = y0 + (y1 - y0) * (highEndS / span);
    for (const [label, px, pz, probeY] of [
      ['below span', mx - uz * 1.4, mz + ux * 1.4, Math.min(underGround, midY - CAR_SPEC.height - 0.5)],
      ['top 10 cm below deck at midspan', mx - uz * 1.6, mz + ux * 1.6, midY - CAR_SPEC.height - 0.10],
      ['top 10 cm below deck near higher end', ax + ux * highEndS - uz * 1.6, az + uz * highEndS + ux * 1.6, highEndDeckY - CAR_SPEC.height - 0.10],
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
    // Same 1.8 m height inside the full-height mid-span DOES still hit the upper truss.
    {
      const midHigh = {
        x: mx - uz * 1.6, z: mz + ux * 1.6, y: midY + 1.8, heading,
        vx: -uz * 4, vz: ux * 4, speed: 0, spec: CAR_SPEC,
      };
      const sx = midHigh.x, sz = midHigh.z;
      rails.blockBridge(midHigh, 1 / 120);
      assert.ok(Math.hypot(midHigh.x - sx, midHigh.z - sz) > 0.1, `bridge ${id} mid-span 1.8 m probe still collides with upper truss`);
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
  // No bridge in any other area pack matches (including Highway 19 ids 45/46 in Judique and Canso Causeway).
  for (const dir of ['areas/judique', 'areas/porthood', 'areas/pointtupper', 'areas/westbay', 'areas/cansocauseway']) {
    const d = read(dir, 'roads');
    assert.deepEqual(d.roads.map(littleMabouPonyTruss).filter(r => r.ponyTruss), [], `${dir} has no Little Mabou pony truss`);
  }
  console.log('PASS Little Mabou Road steel pony-truss bridges (ids 45 and 46; exact baseline deck physics, vertical rail bounds, solo+fleet Towing)');
}
console.log('PASS Little Mabou homes, shed and marsh rail; access and bridge exclusions');
console.log('PASS two Highway 19 aprons both land packs, gravel driveway, hillside gravel, building batches and three view starts');
