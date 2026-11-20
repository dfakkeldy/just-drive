import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WHARF_FIXTURES, WHARF_HOIST } from '../../web/src/mabou-wharf-props.ts';
import { WHARF, PARK } from '../../web/src/fishing-site.ts';
import { wharfBuildingArt } from '../../web/src/mabou-wharf-buildings.ts';

const land = name => JSON.parse(readFileSync('data/baked/terrain/' + name, 'utf8'));
const local = ([e, n]) => [e - WHARF.e, WHARF.n - n];
const roads = land('roads.json').roads.filter(r => r.pts.some(([e, n]) =>
  Math.abs(e - WHARF.e) < 120 && Math.abs(n - WHARF.n) < 120));
assert.ok(roads.some(r => r.id === 922), 'The wharf access road must be present');
const surveyed = land('buildings.json').buildings;
const art = wharfBuildingArt(surveyed);
const buildings = art.buildings.filter(b => art.styles[b.id]);
assert.equal(buildings.length, 3);
for (const [e, n] of [[618685.9, 5104819.5], [618653.2, 5104764.4]]) {
  const building = buildings.find(b => b.kind === 'barn' && Math.hypot(b.x - e, b.y - n) <= 4);
  assert.ok(building && art.styles[building.id], 'styles belong to the two wharf barns');
}
assert.ok(WHARF_HOIST.u - WHARF_HOIST.halfWidth > PARK.u + 1.5, 'hoist stays outside the pier drive line');

function gap(point, { u, v, yaw, half, halfWidth }) {
  const x = point[0] - u, z = point[1] - v;
  const along = x * Math.sin(yaw) + z * Math.cos(yaw);
  const across = x * Math.cos(yaw) - z * Math.sin(yaw);
  return Math.hypot(Math.max(0, Math.abs(along) - half), Math.max(0, Math.abs(across) - halfWidth));
}

function* samples(line) {
  for (let i = 1; i < line.length; i++) {
    const [x, z] = line[i - 1], [endX, endZ] = line[i];
    const dx = endX - x, dz = endZ - z;
    const steps = Math.ceil(Math.hypot(dx, dz) * 4);
    for (let j = 0; j <= steps; j++) yield [x + dx * j / steps, z + dz * j / steps];
  }
}

for (const road of roads) {
  for (const point of samples(road.pts.map(local))) for (const prop of WHARF_FIXTURES) {
    assert.ok(gap(point, prop) >= road.halfWidth + 1.25,
      `fixture ${prop.u},${prop.v} blocks the drive line on road ${road.id}`);
  }
}
for (const prop of WHARF_FIXTURES) {
  assert.ok(gap([PARK.u, PARK.v], prop) > 4, 'fixture blocks ending parking spot');
  for (const b of buildings) {
    const footprint = b.footprint.map(local);
    assert.ok(gap(local([b.x, b.y]), prop) > 0.1, 'fixture covers a building centre');
    for (const point of samples([...footprint, footprint[0]])) {
      assert.ok(gap(point, prop) > 0.1, `fixture ${prop.u},${prop.v} overlaps building ${b.id}`);
    }
  }
}
console.log(`PASS ${WHARF_FIXTURES.length} wharf fixtures clear of mapped drive lines, three buildings and the parking spot`);
