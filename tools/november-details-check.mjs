import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buildings, buildingSites } from '../web/src/buildings.ts';
import { baxtersCoveBuildingArt, littleMabouBuildingArt, NovemberBuildings, novemberFootprints, TRAILHEAD_FENCE } from '../web/src/november-buildings.ts';
import { BAXTERS_COVE_LOT, littleMabouMarshRail, NovemberRoadDetails } from '../web/src/november-road-details.ts';
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
    for (const p of source.outline) assert.equal(lot.surface(...world(p)), null, 'the lot stays off the wharf');
  }
  const mapped = read(dir, 'buildings').buildings, copy = structuredClone(mapped);
  const art = baxtersCoveBuildingArt(mapped);
  assert.deepEqual(mapped, copy, 'the survey list is not edited');
  const at = (x, y) => art.buildings.find(b => Math.hypot(b.x - x, b.y - y) < 2);
  const long = at(616254.85, 5079386.99), gambrel = at(616282, 5079339), house = at(617083, 5079233.8);
  assert.deepEqual([long.kind, art.styles[long.id].wall, art.styles[long.id].barnDoors], ['barn', '#ae8e51', 5]);
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
console.log('PASS Little Mabou homes, shed and marsh rail; access and bridge exclusions');
console.log('PASS two Highway 19 aprons both land packs, gravel driveway, hillside gravel, building batches and three view starts');
