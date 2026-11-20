import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buildings } from '../web/src/buildings.ts';
import { NovemberBuildings, novemberFootprints } from '../web/src/november-buildings.ts';
import { NovemberRoadDetails } from '../web/src/november-road-details.ts';
import { areaPlaces, nearestPlacement, placesFor } from '../web/src/places.ts';
import { Roads } from '../web/src/roads.ts';
import { drawnRoadBytes, paintSiteSurface } from '../web/src/terrain.ts';

const read = (dir, file) => JSON.parse(readFileSync(`data/baked/${dir}/${file}.json`, 'utf8'));
const byte = (sample, flags) => {
  const bytes = new Uint8ClampedArray([128, 52, flags, 0]);
  paintSiteSurface(bytes, 0, sample, 128, .1, .05);
  return bytes;
};

// The bridge paint mask and pavement flags must be independent on the same tile.
const road = new Uint8Array([128, 52, 68, 0, 128, 52, 65, 0, 128, 52, 33, 0]);
const paintMask = new Uint8Array([0, 0, 1]);
assert.deepEqual([...drawnRoadBytes(road, paintMask)], [128, 52, 3, 0, 128, 52, 65, 0, 128, 52, 32, 0]);
assert.deepEqual([...road], [128, 52, 68, 0, 128, 52, 65, 0, 128, 52, 33, 0], 'CPU road flags stay intact');

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
console.log('PASS two Highway 19 aprons both land packs, gravel driveway, hillside gravel, building batches and three view starts');
