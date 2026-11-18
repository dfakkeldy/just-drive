import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Buildings, buildingSites, readBuildingStyles } from '../web/src/buildings.ts';
import { Ruts } from '../web/src/ruts.ts';

const dir = `${process.env.MMM_ROOT}/data/baked/terrain`;
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const list = read('buildings').buildings, styles = readBuildingStyles(read('building-styles'));
const m = read('manifest'), sites = buildingSites(list), byId = new Map(list.map((b) => [b.id, b]));
assert.equal(new Set(sites.map((b) => b.id)).size, sites.length);
assert.equal(Object.keys(styles).length, sites.length, 'one style per property');
// The styles belong to the properties by id, not only by count: a style under a wing's id would leave its
// property on the fallback colours.
const styleFault = (table) => {
  const ids = new Set(sites.map((b) => String(b.id)));
  return Object.keys(table).find((key) => !ids.has(key)) ?? [...ids].find((id) => !(id in table)) ?? null;
};
assert.equal(styleFault(styles), null, 'every style key is a property id, and every property has a style');
{
  const moved = { ...styles }, wing = list.find((b) => b.buildingId === 64 && b.id !== 64);
  moved[wing.id] = moved[64]; delete moved[64];
  assert.notEqual(styleFault(moved), null, 'a style moved from property 64 to its wing is found');
}
// One property for each building, wherever houses are counted. buildingSites can be applied again without change.
assert.deepEqual(buildingSites(sites), sites);
assert.ok(sites.every((b) => b.buildingId === undefined || b.buildingId === b.id), 'no wing is a property');
// The game's counters of houses (mail, lawn ruts, the roadside break, complaints) must read the properties, not
// the wings: main.ts hands the full list only to the drawing, the yard and the animals (which pick roofs). The porch
// house belongs to the drawing: it finds its own surveyed box in the list and takes that one box out of what is drawn.
{
  const main = fs.readFileSync(`${process.env.MMM_ROOT}/web/src/main.ts`, 'utf8');
  const uses = main.split('\n').filter((line) => /\bbuildingList\b/.test(line));
  const allowed = [/^const buildingList\b/, /new Buildings\((?:porchBox \? PorchHouse\.drawn\(buildingList, porchBox\) : )?buildingList,/, /buildingSites\(buildingList \?\? \[\]\)/, /new Animals\(roads, terrain, buildingList,/, /createTestPark\(params, terrain, yardSite, LOW, buildingList \?\? \[\]\)/,
    // The 1884 scene clears trees under every roof: one record per building and the further blocks of a large one, never a wing.
    /new HistoryScene\(terrain, roads, streams, roofSites\(buildingList \?\? \[\]\), ground\)/,
    /^const porchBox = .*\? PorchSite\.find\(buildingList\) : null;$/,
    // The camera drone keeps over every drawn roof: each wing and block has its own height, and none of them is counted.
    // The boxes Mabou's main street replaces are left out; its own roofs come from mabouMain.roofAt.
    /^const boxRoofAt = roofHeights\(ERA\.modern && buildingList \? mabouSite \? mabouSite\.drawn\(buildingList\) : buildingList : \[\], manifest\.village, EXAG, SEA_LEVEL\);/,
    // The drawing: less the porch house and the places Mabou's main street models (both stay properties).
    /^const drawnBuildings = buildingList && porchBox \? PorchHouse\.drawn\(buildingList, porchBox\) : buildingList;$/,
    // The public wharves keep clear of every drawn footprint, wings included (footprints only, nothing is counted).
    /^const wharves = .*\(buildings \? buildingList \?\? \[\] : \[\]\)\.map\(b => b\.footprint\)\) : null;$/,
    // The yard dog's invented driveway only asks if the list exists. Its houses come from `properties` (next assert).
    /^const yardDogSite = ERA\.modern && AREA\.id === 'mabou' && buildingList && props \? YardDogSite\.create\(\{$/];
  assert.match(main, /YardDogSite\.create\(\{[^}]*houses: properties\.filter\(/, 'the yard dog counts houses from the properties, not from the list with wings');
  const stray = uses.filter((line) => !allowed.some((re) => re.test(line.trim())));
  assert.deepEqual(stray, [], 'main.ts passes the list with wings only to the drawing, the animals, the drone floor and the tree clearing of 1884 (roofSites)');
  const ruts = fs.readFileSync(`${process.env.MMM_ROOT}/web/src/ruts.ts`, 'utf8');
  assert.ok(/for \(const b of buildingSites\(buildings\)\)/.test(ruts), 'lawn ruts index one property per building');
}
const groups = new Map();
// Large buildings drawn as blocks are groups too, but not wings: tools/big-buildings-check.mjs tests those.
for (const b of list) if (b.buildingId !== undefined && b.shape === undefined) {
  if (!groups.has(b.buildingId)) groups.set(b.buildingId, []);
  groups.get(b.buildingId).push(b);
}
const dispose = (model) => { model.mesh.geometry.dispose(); model.mesh.material.dispose(); };
const cast = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
let probes = 0;
for (const [id, wings] of groups) {
  assert.ok(wings.length >= 2 && wings.length <= 4);
  const root = byId.get(id);
  assert.deepEqual(sites.find((b) => b.id === id), root.site, 'property reference remains unchanged');
  const model = new Buildings(wings, m.village, 1, 0, styles);
  const position = model.mesh.geometry.getAttribute('position');
  for (const a of Object.values(model.mesh.geometry.attributes)) assert.ok([...a.array].every(Number.isFinite));
  for (const b of wings) {
    // A wing split from one mapped outline shares its eave. The owner-corrected blocks of the hall (the project brief,
    // pipeline/mabou_main.py) carry their own measured heights; every one of them is marked, and they still face the rays.
    if (wings.some((w) => w.correction === 'mabou-main-1229')) assert.ok(wings.every((w) => w.correction === 'mabou-main-1229'), 'a corrected group is corrected throughout');
    else assert.equal(b.ground + b.eave, root.ground + root.eave, 'shared world eave');
    assert.ok(b.id === id || b.id > Math.max(...sites.filter((s) => s.source !== 'hand').map((s) => s.id)), 'new IDs follow the full original inventory');
    const angle = b.axisDeg * Math.PI / 180;
    // Dense vertical rays include both ends and every eave: a missing roof face fails.
    for (let u = -b.length / 2 + .03; u <= b.length / 2; u += .7) {
      for (let v = -b.width / 2 + .03; v <= b.width / 2; v += .7) {
        const x = b.x - m.village[0] + Math.sin(angle) * u + Math.cos(angle) * v;
        const z = m.village[1] - b.y - Math.cos(angle) * u + Math.sin(angle) * v;
        cast.set(new THREE.Vector3(x, b.ground + b.ridge + 20, z), down);
        const hits = cast.intersectObject(model.mesh);
        assert.ok(hits.length && hits[0].point.y >= b.ground + b.eave - .5, `roof gap at ${b.id}`);
        probes++;
      }
    }
    if (b.id !== id) {
      // Turning property accessories on must not add them to a subsidiary wing.
      const off = new Buildings([b], m.village, 1, 0, { [id]: { ...styles[id], chimney: false, silo: false, entrance: 'none', dormer: false, satelliteDish: false } });
      const on = new Buildings([b], m.village, 1, 0, { [id]: { ...styles[id], chimney: true, silo: true,
        siloPosition: { u: 5, v: 0, diameter: 5, height: 14 }, entrance: 'front porch', dormer: true, satelliteDish: true } });
      assert.deepEqual(on.mesh.geometry.getAttribute('position').array, off.mesh.geometry.getAttribute('position').array);
      dispose(off); dispose(on);
    }
  }
  assert.ok(position.count > 0);
  dispose(model);
}
assert.equal(groups.get(64)?.length, 2, 'mapped inner corner has two wings');
// Behaviour, not only source text: a car that crosses the lawn beside each wing of a split house, with the full
// list of wings handed to the lawn ruts, damages ONE property. (The old code reported the wing's own id too.)
let lawnTests = 0;
for (const [id, wings] of groups) {
  if (byId.get(id).kind !== 'house') continue;
  const hit = [];
  const ruts = new Ruts({ surfaceAt: () => ({ level: 8, canopy: 0, roadDist: 100, halfWidth: 3 }), heightAt: () => 0 }, list, m.village, true, (house) => hit.push(house));
  for (const b of wings) {
    const x = b.x - m.village[0], z = m.village[1] - b.y;
    for (let step = 0; step <= 12; step++) ruts.update({ x: x + step * 0.5, z, vx: 3, vz: 0, heading: Math.PI / 2, airborne: false }, step);
    ruts.update({ x: x + 400, z: z + 400, vx: 0, vz: 0, heading: 0, airborne: false }, 99);   // drive away: the next wing is a new crossing
  }
  assert.deepEqual([...new Set(hit)], [id], `lawn damage beside every wing of house ${id} belongs to that one property`);
  lawnTests++;
}
assert.ok(lawnTests > 0, 'at least one split house exists to test lawn damage on');
console.log(`PASS: ${sites.length} properties, ${groups.size} split groups, one style each, no subsidiary accessories; ${probes} roof rays find coverage.`);
