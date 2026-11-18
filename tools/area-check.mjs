import assert from 'node:assert/strict';
import { Route } from '../web/src/route.ts';
import { AREAS, readArea, utm20ToLatLon, roadStart, validateAreaManifest, loadAreaManifest, AreaNotReady } from '../web/src/area.ts';
const read = query => readArea(new URLSearchParams(query));
const mabou = read(''), judique = read('area=judique');
assert.equal(mabou.id, 'mabou'); assert.equal(read('area=mabou'), mabou);
assert.equal(mabou.base, 'terrain'); assert.equal(judique.base, 'areas/judique');
assert.equal(read('area=porthood').base, 'areas/porthood');
const warnings = [], warn = console.warn;
console.warn = message => warnings.push(message);
for (const id of ['unknown', '../terrain', 'JUDIQUE', '']) assert.equal(read(`area=${id}`), mabou);
console.warn = warn;
assert.equal(warnings.length, 4);
for (const a of AREAS) for (const key of Object.keys(a).filter(key => typeof a[key] === 'boolean')) {
  // Area-owned places: the Judique house/church and the West Bay quarry.
  assert.equal(a[key], a.id === (key === 'quarry' ? 'westbay' : (key === 'home' || key === 'church') ? 'judique' : 'mabou'), `${a.id}.${key}`);
}
assert.equal(AREAS.some(a => a.id === 'fixture'), process.env.AREA_DEV === '1');
const position = utm20ToLatLon(624271, 5103301);
assert.ok(Math.abs(position.lat - 46.0717) < .0005, JSON.stringify(position));
assert.ok(Math.abs(position.lon + 61.392) < .002, JSON.stringify(position));
// Independent PROJ cs2cs EPSG:2961 EPSG:4617 reference at this same point.
assert.ok(Math.abs(position.lat - 46.0719861794) < 1e-7);
assert.ok(Math.abs(position.lon + 61.3930087328) < 1e-7);
const equator = utm20ToLatLon(500000, 0);
assert.equal(equator.lat, 0); assert.equal(equator.lon, -63);
const centre = utm20ToLatLon(500000, 4982950.400);
assert.ok(Math.abs(centre.lat - 45) < 1e-7); assert.equal(centre.lon, -63);
assert.doesNotThrow(() => validateAreaManifest(mabou, { village: [624271, 5103301] }));
assert.doesNotThrow(() => validateAreaManifest(judique, { area: { id: 'judique', name: 'Judique' } }));
assert.throws(() => validateAreaManifest(judique, { area: { id: 'mabou', name: 'Mabou' } }), /Asked for Judique.*Mabou/);
assert.throws(() => validateAreaManifest(judique, {}), /manifest must identify/);
const road = (kind, pts) => ({kind, pts});
const start = roadStart([road(4, [[-1, 0], [1, 0]]), road(2, [[-20, 10], [20, 10]]), road(3, [[20, 20], [20, 30]])]);
assert.deepEqual(start, { x: 0, z: 10, heading: Math.PI / 2 });
assert.deepEqual(roadStart([road(1, [[10, 20], [10, -20]])]), { x: 10, z: 0, heading: 0 });
assert.equal(roadStart([]), null); assert.equal(roadStart([road(5, [[0, 0], [1, 1]])]), null);
assert.equal(roadStart([road(1, [[0, 0], [0, 0]])]), null);
const noReads = new Proxy({}, { get() { throw new Error('A disabled route must not read Mabou roads or props'); } });
const emptyRoute = new Route(noReads, noReads, false);
assert.equal(emptyRoute.runs.length, 1); assert.equal(emptyRoute.forDay(18).name, 'Local roads');
assert.equal(emptyRoute.forDay(18).start, null); assert.equal(emptyRoute.rural.length, 0);
assert.equal(emptyRoute.members.size, 0); assert.equal(emptyRoute.late, -1);
const originalFetch = globalThis.fetch;
try {
  for (const response of [new Response('', {status: 404}), new Response('<!doctype html>'), new Response('', {status: 503})]) {
    globalThis.fetch = async () => response;
    await assert.rejects(loadAreaManifest(judique, '/areas/judique'), error => error instanceof AreaNotReady && error.message === 'Judique is not ready yet.');
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ area: { id: 'porthood', name: 'Port Hood' } }));
  await assert.rejects(loadAreaManifest(judique, '/areas/judique'), /Asked for Judique.*Port Hood/);
  globalThis.fetch = async path => { assert.equal(path, '/game/areas/judique/manifest.json'); return new Response(JSON.stringify({ area: { id: 'judique', name: 'Judique' } })); };
  assert.equal((await loadAreaManifest(judique, '/game/areas/judique')).area.id, 'judique');
} finally { globalThis.fetch = originalFetch; }
console.log(`PASS area parsing, paths, all feature flags, manifest identity/missing land, road spawn, ${process.env.AREA_DEV === '1' ? 'dev' : 'production'} registry; Mabou inverse ${JSON.stringify(position)}`);
