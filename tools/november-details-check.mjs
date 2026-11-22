import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Buildings, buildingSites } from '../web/src/buildings.ts';
import { baxtersCoveBuildingArt, littleMabouBuildingArt, NovemberBuildings, novemberFootprints, TRAILHEAD_FENCE } from '../web/src/november-buildings.ts';
import { BAXTERS_COVE_LOT, littleMabouMarshRail, NovemberRoadDetails } from '../web/src/november-road-details.ts';
import { littleMabouPonyTruss, PONY_TRUSS } from '../web/src/november-bridges.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { TRAILER_SPEC } from '../web/src/trailer.ts';
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
  const tagged = mabouRoads.roads.map(littleMabouPonyTruss);
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
  const flatGround = {
    level: 8, manifest: mabouManifest, dataRevision: 1, exag: 1.5, seaLevel: -0.2, low: false,
    heightAt: () => 2.5,
    surfaceAt: () => ({ ground: 2.5, level: 8, kind: 2, halfWidth: 3, roadDist: 0, canopy: 0, washboard: false }),
  };
  const net = new Roads({ roads: tagged }, mabouManifest.village, flatGround);
  const rails = net.guardrails;
  assert.ok(rails, 'modern Mabou roads construct guardrails with pony-truss rail solids');
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (const id of [45, 46]) {
    const r = net.roads.find(x => x.id === id);
    const [ax, az] = r.pts[0], [bx, bz] = r.pts[r.pts.length - 1];
    const dx = bx - ax, dz = bz - az, span = Math.hypot(dx, dz), ux = dx / span, uz = dz / span;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, heading = Math.atan2(dx, -dz);
    assert.equal(net.deckHeight(mx, mz), 2.55, `bridge ${id} keeps exact deckHeight`);
    const mesh = net.group.children.find(c => c.name === `pony-truss-${id}`);
    assert.ok(mesh?.geometry, `bridge ${id} builds one pony-truss mesh`);
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.getAttribute('position'), col = mesh.geometry.getAttribute('color');
    assert.ok(pos && col && pos.array.every(Number.isFinite), `bridge ${id} has finite vertex-coloured geometry`);
    assert.ok(pos.count / 3 < 800, `bridge ${id} stays within triangle budget (${pos.count / 3})`);
    let maxY = -Infinity, maxHalf = 0;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      maxY = Math.max(maxY, py);
      maxHalf = Math.max(maxHalf, Math.abs(-(px - ax) * uz + (pz - az) * ux));
    }
    assert.ok(maxY - 2.55 >= 2.0 && maxY - 2.55 <= 2.6, `bridge ${id} truss height matches pony-truss proportions (${(maxY - 2.55).toFixed(2)} m)`);
    assert.ok(maxHalf < r.halfWidth && maxHalf >= PONY_TRUSS.half, `bridge ${id} is narrow one-lane (${(maxHalf * 2).toFixed(2)} m wide)`);
    // Lateral wheel support matches the rendered asphalt lane: supported inside clearHalf, null beyond the deck.
    for (const offset of [0, -1.5, 1.5, -2.0, 2.0]) {
      const x = mx - uz * offset, z = mz + ux * offset;
      const y = net.deckHeight(x, z);
      assert.equal(y, 2.55, `bridge ${id} supports lane at offset ${offset}`);
      ray.set(new THREE.Vector3(x, y + 0.5, z), down);
      const hit = ray.intersectObject(mesh)[0];
      assert.ok(hit && Math.abs(hit.point.y - y) < 1e-4, `bridge ${id} asphalt mesh matches deckHeight at offset ${offset}`);
    }
    for (const offset of [-2.75, 2.75]) {
      const x = mx - uz * offset, z = mz + ux * offset;
      assert.equal(net.deckHeight(x, z), null, `bridge ${id} gives no wheel support at ${offset} m beyond rendered deck`);
      ray.set(new THREE.Vector3(x, 10, z), down);
      assert.equal(ray.intersectObject(mesh).length, 0, `bridge ${id} has no mesh at ${offset} m beyond deck`);
    }
    // Centred car, truck and loaded trailer pass cleanly; off-centre 1.10 m truck and trailer are pushed back from the rail.
    const probeAt = (offset, spec) => {
      const p = { x: mx - uz * offset, z: mz + ux * offset, heading, vx: 0, vz: 0, speed: 0, spec };
      rails.block(p, 1 / 120);
      return { moved: Math.hypot(p.x - (mx - uz * offset), p.z - (mz + ux * offset)), lat: -(p.x - mx) * uz + (p.z - mz) * ux };
    };
    for (const [label, spec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC], ['trailer', TRAILER_SPEC]]) {
      const centred = probeAt(0, spec);
      assert.ok(centred.moved < 1e-7, `bridge ${id} accepts centred ${label}`);
      const halfTrack = ((spec.rearTrack ?? spec.track) / 2);
      for (const side of [-1, 1]) {
        assert.equal(net.deckHeight(mx - uz * side * halfTrack, mz + ux * side * halfTrack), 2.55, `bridge ${id} supports centred ${label} wheels`);
      }
    }
    for (const [label, spec] of [['truck', TRUCK_SPEC], ['trailer', TRAILER_SPEC]]) {
      for (const side of [-1, 1]) {
        const off = probeAt(side * 1.1, spec);
        assert.ok(off.moved > 0.25, `bridge ${id} rejects ${side * 1.1} m off-centre ${label} overlapping inner rail`);
        assert.ok(Math.abs(off.lat) + spec.envelope.radius <= PONY_TRUSS.railInner + 0.01, `bridge ${id} keeps resolved ${label} inside inner rail`);
      }
    }
  }
  // Other Mabou bridges keep the generic modern deck.
  const otherBridge = net.roads.find(r => r.id === 50);
  assert.ok(otherBridge && !otherBridge.ponyTruss, 'Mabou Harbour Road bridge stays generic');
  assert.equal(net.deckHeight(otherBridge.pts[0][0], otherBridge.pts[0][1]), 2.55);
  assert.ok(!net.group.children.some(c => c.name === 'pony-truss-50'));
  for (const child of [...net.group.children]) child.geometry?.dispose();
  // No bridge in any other area pack matches (including Highway 19 ids 45/46 in Judique and Canso Causeway).
  for (const dir of ['areas/judique', 'areas/porthood', 'areas/pointtupper', 'areas/westbay', 'areas/cansocauseway']) {
    const d = read(dir, 'roads');
    assert.deepEqual(d.roads.map(littleMabouPonyTruss).filter(r => r.ponyTruss), [], `${dir} has no Little Mabou pony truss`);
  }
  console.log('PASS Little Mabou Road steel pony-truss bridges (ids 45 and 46; lane support, rail solids, truck/trailer poses)');
}
console.log('PASS Little Mabou homes, shed and marsh rail; access and bridge exclusions');
console.log('PASS two Highway 19 aprons both land packs, gravel driveway, hillside gravel, building batches and three view starts');
