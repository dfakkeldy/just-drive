#!/usr/bin/env node
// Node only. esbuild bundles, counters and mutants stay in memory; no repository rewrites.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const source = read('web/src/roads.ts');
const frozen = JSON.parse(read('tools/baseline/frozen.json'));
assert.ok(frozen['roads-old.ts'], 'old roads must have a frozen hash');
assert.equal(createHash('sha256').update(read('tools/baseline/roads-old.ts')).digest('hex'), frozen['roads-old.ts'],
  'roads-old.ts was edited; frozen files are never edited (tools/baseline/README.md)');
const options = { bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent',
  alias: { three: resolve(root, 'web/node_modules/three/build/three.module.js') } };
async function bundle(entry, replacement) {
  const result = await build({ ...options, stdin: { contents: entry, resolveDir: root }, plugins: replacement === undefined ? [] : [{
    name: 'roads-in-memory', setup(b) { b.onLoad({ filter: /[/\\]web[/\\]src[/\\]roads\.ts$/ }, () => ({ contents: replacement, loader: 'ts' })); }
  }] });
  return { module: await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')), inputs: result.metafile.inputs };
}
const oldBuild = await bundle("export {Roads} from './tools/baseline/roads-old.ts';");
assert.deepEqual(Object.keys(oldBuild.inputs).filter(p => resolve(p).startsWith(resolve(root, 'web/src') + '/')), [],
  'frozen oracle must not import any current game module');
// Prove the isolation guard, without changing a frozen file on disk.
const leak = await bundle("export {Roads} from './tools/baseline/roads-old.ts'; export {Roads as leaked} from './web/src/roads.ts';");
assert.ok(Object.keys(leak.inputs).some(p => resolve(p) === resolve(root, 'web/src/roads.ts')), 'guard sees a current-source leak');
const entry = "export {Roads} from './web/src/roads.ts'; export {Vehicle} from './web/src/vehicle.ts'; export * as THREE from 'three'; export {AREAS} from './web/src/area.ts';";
const current = (await bundle(entry)).module, Old = oldBuild.module.Roads;
const random = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
const numeric = (a, b, label) => assert.ok(Object.is(a, b), `${label}: ${a} != ${b}`);
function hitEqual(a, b, old, next, label) {
  assert.equal(a === null, b === null, `${label}: hit presence`);
  if (!a) return;
  const index = old.roads.indexOf(a.road);
  assert.equal(b.road, next.roads[index], `${label}: same source road identity`);
  for (const key of ['id', 'kind', 'halfWidth']) numeric(a.road[key], b.road[key], `${label}: road.${key}`);
  for (const key of ['dist', 'x', 'z', 'heading', 'seg', 't']) numeric(a[key], b[key], `${label}: ${key}`);
  assert.equal(b.road.pts[b.seg], next.roads[index].pts[a.seg], `${label}: same source segment`);
}
function terrainFixture() {
  return { level: 8, heightAt: (x, z) => 40 + x * .0002 + z * .0003 + (x * x + 2 * z * z) * 1e-6,
    surfaceAt(x, z) { return { ground: this.heightAt(x, z), level: this.level, kind: 2, halfWidth: 4, roadDist: 0, canopy: 0, washboard: false }; },
    withContactHeight: (_, read) => read() };
}
function dispose(net) {
  for (const mesh of [...net.group.children]) mesh.geometry.dispose();
  net.deckMat?.dispose(); net.timberMat?.dispose();
  net.modern?.material.dispose(); for(const r of net.modern?.spans??[])r.geometry?.dispose();
}
const cases = [];
for (const area of current.AREAS) {
  const base = `data/baked/${area.base}`, manifest = JSON.parse(read(`${base}/manifest.json`));
  const data = JSON.parse(read(`${base}/roads.json`)), village = manifest.village;
  const local = data.roads.flatMap(r => r.pts.map(([e, n]) => [e - village[0], village[1] - n]));
  const bounds = local.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
  const rng = random(0x524f4144), points = [];
  // 2,400 seeded points per area: half across its box, half near real segments.
  for (let i = 0; i < 2400; i++) {
    if (i % 2) {
      const road = data.roads[Math.floor(rng() * data.roads.length)], s = Math.floor(rng() * (road.pts.length - 1));
      const a = road.pts[s], b = road.pts[s + 1], t = rng();
      points.push([a[0] + (b[0] - a[0]) * t - village[0] + (rng() - .5) * 40,
        village[1] - a[1] - (b[1] - a[1]) * t + (rng() - .5) * 40]);
    } else points.push([bounds[0] + rng() * (bounds[2] - bounds[0]), bounds[1] + rng() * (bounds[3] - bounds[1])]);
  }
  // On and beside EVERY bridge segment, including endpoints and just over the allowed edge.
  let bridges = 0;
  for (const road of data.roads.filter(r => r.bridge)) for (let s = 0; s < road.pts.length - 1; s++) {
    bridges++;
    const a = road.pts[s], b = road.pts[s + 1], dx = b[0] - a[0], dz = a[1] - b[1], len = Math.hypot(dx, dz) || 1;
    for (const t of [0, .5, 1]) for (const side of [0, -road.halfWidth, road.halfWidth, -road.halfWidth - 1.2, road.halfWidth + 1.2, road.halfWidth + 1.200001, 12.000001]) {
      points.push([a[0] + dx * t - village[0] - dz / len * side, village[1] - a[1] + dz * t + dx / len * side]);
    }
  }
  // Borders and negative local cells, plus each grid edge (including row-wrap aliases).
  for (const x of [bounds[0], bounds[2], -129, -64, -.001, 0, 64]) for (const z of [bounds[1], bounds[3], -129, -64, 0, 64]) {
    for (const epsilon of [-1e-8, 0, 1e-8]) points.push([Math.floor(x / 64) * 64 + epsilon, Math.floor(z / 64) * 64 + epsilon]);
  }
  for (const x of [bounds[0] - 128, bounds[2] + 128, -1e9, 1e9]) for (const z of [bounds[1] - 128, bounds[3] + 128, -5100000, 5100000]) points.push([x, z]);
  cases.push({ name: area.id, data, village, points, bridges });
}
const road = (id, pts, bridge = true, halfWidth = 4) => ({ id, pts: pts.map(([x, z]) => [x, -z]), bridge, halfWidth, name: null, kind: 2 });
function synthetic(name, roads, points) { cases.push({ name, data: { roads }, village: [0, 0], points, bridges: roads.filter(r => r.bridge).length }); }
synthetic('no-bridge', [road(1, [[-200, -200], [200, 200]], false)], [[0, 0], [-64, -64], [64, 64], [0, 7], [1e8, 0]]);
// Same-cell and adjacent-cell ties must choose the old source segment, not the first new candidate.
synthetic('crossing-decks', [road(1, [[-80, 0], [80, 0]]), road(2, [[0, -80], [0, 80]]), road(3, [[-80, 2], [80, 2]])],
  [[0, 0], [1, 1], [-1, -1], [0, 2], [-64, 0], [64, 0], [63.999999, 1], [64.000001, 1]]);
synthetic('edge-deck', [road(1, [[65, -2], [65, 2]]), road(2, [[-65, -66], [-65, -62]])],
  [[63, 0], [64, 0], [64, -1], [-63, -64], [-64, -64], [65, 6.2], [65, 6.200001]]);
synthetic('raw-UTM', [road(1, [[620000, 5100000], [620080, 5100064]]), road(2, [[-620000, -5100000], [-619990, -5100000]], false)],
  [[620000, 5100000], [620040, 5100032], [-620000, -5100000], [620080, 5100064], [0, 0]]);
synthetic('empty', [], [[0, 0], [-64, -64], [5100000, -5100000]]);
function checkKeys(net) {
  // Observe every occupied key against its inverse; out-of-grid aliases must be misses.
  const seen = new Set();
  for (const key of net.cells.keys()) {
    assert.equal(typeof key, 'number', 'grid key must be numeric');
    assert.ok(Number.isSafeInteger(key) && key >= 0, 'exact nonnegative key');
    const x = key % net.columns + net.minCX, z = Math.floor(key / net.columns) + net.minCZ;
    numeric(net.cellKey(x, z), key, 'key inverse'); assert.ok(!seen.has(key)); seen.add(key);
  }
  for (const z of [net.minCZ, net.maxCZ]) {
    numeric(net.cellKey(net.minCX - 1, z), -1, 'left outside key');
    numeric(net.cellKey(net.maxCX + 1, z), -1, 'right outside key');
  }
  for (const x of [net.minCX, net.maxCX]) {
    numeric(net.cellKey(x, net.minCZ - 1), -1, 'top outside key');
    numeric(net.cellKey(x, net.maxCZ + 1), -1, 'bottom outside key');
  }
  for (const key of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) numeric(net.cellKey(key, key), -1, 'huge outside key');
  for (const bucket of net.bridgeCells.values()) for (const [ri] of bucket) assert.ok(net.roads[ri].bridge, 'bridge grid contains only bridges');
}
const filters = [undefined, r => r.bridge, r => !r.bridge && r.kind <= 3, r => r.kind === 5, r => r.id % 2 === 0];
function verify(Roads, report = false) {
  for (const test of cases) {
    const ground = terrainFixture(), old = new Old(test.data, test.village, ground), next = new Roads(test.data, test.village, ground);
    try {
      assert.deepEqual(next.roads, old.roads, `${test.name}: every source road field (Object.is numbers)`);
      if (test.data.roads.length) checkKeys(next);
      for (let i = 0; i < test.points.length; i++) {
        const [x, z] = test.points[i], label = `${test.name} point ${i}`;
        // Cover default and every caller's reach class, plus filters. Large spawn reaches are sampled sparsely.
        const reaches = i % 101 === 0 ? [0, 8, 9, 12, 14, 16, 24, 40, 60, 70, 80, 120, 256, 900, 2000] : [12, 60];
        for (const reach of reaches) {
          const filter = filters[i % filters.length];
          hitEqual(old.nearest(x, z, reach, filter), next.nearest(x, z, reach, filter), old, next, `${label} reach ${reach}`);
        }
        hitEqual(old.nearest(x, z), next.nearest(x, z), old, next, `${label} default`);
        const height=next.deckHeight(x,z);assert.ok(height===null||Number.isFinite(height),`${label} finite modern support`);
      }
      // Bridge elevations/approaches intentionally changed. Their production triangle and driving
      // contracts (including channel-height mutants) live in bridges-check.mjs, not this frozen key oracle.
      if (report) console.log(`PASS ${test.name}: ${test.points.length} points${current.AREAS.some(a => a.id === test.name) ? ' (2400 seeded)' : ''}, ${test.bridges} bridge segments; Object.is + source segment identity`);
    } finally { dispose(old); dispose(next); }
  }
}
verify(current.Roads, true);
// Sparse grids can have large cell indices without allocating their empty rectangle.
const large = new current.Roads({ roads: [road(1, [[0, 0], [1, 0]], false),
  road(2, [[(2 ** 26 - 1) * 64, (2 ** 26 - 1) * 64], [(2 ** 26 - 1) * 64 + 1, (2 ** 26 - 1) * 64]], false)] }, [0, 0], terrainFixture());
try { checkKeys(large); numeric(large.cellKey(2 ** 26 - 1, 2 ** 26 - 1), 2 ** 52 - 1, '52-bit key remains exact'); }
finally { dispose(large); }
assert.throws(() => new current.Roads({ roads: [road(1, [[0, 0], [1, 0]], false),
  road(2, [[2 ** 28 * 64, 2 ** 28 * 64], [2 ** 28 * 64 + 1, 2 ** 28 * 64]], false)] }, [0, 0], terrainFixture()), RangeError,
  'unsafe grids fail before inserting colliding keys');
// Counter hooks wrap each grid Map.get and deckHeight ONLY in this Node harness. No game hook ships.
// Each old query constructs exactly one key string per observed string-key get; new gets require numbers.
function count(net) {
  const stats = { strings: 0, deckCalls: 0, bridgeEarly: 0, bridgeCandidates: 0 };
  for (const grid of [net.cells, net.bridgeCells].filter(Boolean)) {
    const get = grid.get.bind(grid);
    grid.get = key => { if (typeof key === 'string') stats.strings++; const value = get(key);
      if (grid === net.bridgeCells && value) stats.bridgeCandidates += value.length; return value; };
  }
  const deck = net.deckHeight.bind(net);
  net.deckHeight = (x, z) => { stats.deckCalls++; const before = stats.bridgeCandidates, value = deck(x, z);
    if (value===null) stats.bridgeEarly++;
    return value; };
  return stats;
}
function rig(THREE) { const node = () => new THREE.Object3D(); return { root: node(), body: node(), steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() } }; }
function vehiclePair(ground, data, village, x, z, dt, label) {
  const old = new Old(data, village, ground), next = new current.Roads(data, village, ground);
  try {
    const vehicles = [old, next].map(net => new current.Vehicle(rig(current.THREE), ground, net, -.2));
    for (const vehicle of vehicles) vehicle.place(x, z, 0);
    const stats = [count(old), count(next)], rng = random(0x434152);
    for (let i = 0; i < 120; i++) {
      const seed = Math.floor(rng() * 2 ** 32), input = { throttle: i % 40 < 20 ? .3 : 0, steer: .1, handbrake: false, touch: i % 2 === 0 };
      const before = stats.map(s => ({ ...s }));
      const saveRandom = Math.random;
      try { for (const vehicle of vehicles) { Math.random = random(seed); vehicle.update(dt, input); } } finally { Math.random = saveRandom; }
      for (const key of ['x', 'z', 'y', 'vx', 'vz', 'vy', 'heading', 'pitch', 'roll', 'speed', 'steerAngle']) {
        // Only explicit bridge drives change elevation/triangulation. Mabou road remains exact.
        if(label!=='Mabou bridge'&&label!=='crossing decks')numeric(vehicles[0][key], vehicles[1][key], `${label} vehicle ${i} ${key}`);
        else {
          assert.ok(Number.isFinite(vehicles[1][key]),`${label} finite ${key}`);
          if(label==='crossing decks')assert.ok(Math.abs(vehicles[0][key]-vehicles[1][key])<(['y','vy'].includes(key)?.5:.05),`${label} bounded triangulation change ${key}: ${vehicles[0][key]} / ${vehicles[1][key]}`);
        }
      }
      for (let j = 0; j < 2; j++) {
        const calls=stats[j].deckCalls-before[j].deckCalls,steps=dt===1/120?1:2;
        if(ground.sites?.some(s=>s.deckDriving))assert.ok(calls>=8*steps&&calls<=9*steps,`${label} deck metadata avoids the redundant centre query`);
        else numeric(calls,9*steps,`${label} calls/update`);
      }
      numeric(stats[1].strings - before[1].strings, 0, `${label} zero key strings/update`);
    }
    console.log(`COUNT ${label} dt=${dt}: per vehicle.update strings ${stats[0].strings / 120} -> ${stats[1].strings / 120}; deckHeight ${stats[0].deckCalls / 120} -> ${stats[1].deckCalls / 120}; bridge-grid early ${stats[1].bridgeEarly}/${stats[1].deckCalls}`);
    return stats;
  } finally { dispose(old); dispose(next); }
}
for (const dt of [1 / 120, 1 / 60]) {
  const stats = vehiclePair(terrainFixture(), cases.find(t => t.name === 'no-bridge').data, [0, 0], 0, 0, dt, 'no bridge');
  numeric(stats[1].bridgeEarly, stats[1].deckCalls, 'all no-bridge calls return through empty grid');
  assert.throws(() => numeric(stats[0].strings, 0, 'zero-string gate on OLD queries'), assert.AssertionError, 'old allocation behavior must fail the new gate');
  const decks = vehiclePair(terrainFixture(), cases.find(t => t.name === 'crossing-decks').data, [0, 0], 0, 0, dt, 'crossing decks');
  numeric(decks[1].bridgeEarly, 0, 'real deck is never skipped');
}
// Also measure actual Vehicle against actual baked Mabou ground, using the phone harness adapter.
process.chdir(resolve(root, 'web'));
try {
  const { module: adapter } = await bundle("export {makeGround,preload,manifest,bakedRoads} from './tools/phone-ground.mjs';");
  const { terrain } = adapter.makeGround();
  const sample = cases.find(t => t.name === 'mabou'), bridge = sample.data.roads.find(r => r.bridge);
  const road = sample.data.roads.find(r => !r.bridge && r.kind <= 3);
  for (const [name, r] of [['Mabou road', road], ['Mabou bridge', bridge]]) {
    const [e, n] = r.pts[Math.floor(r.pts.length / 2)], x = e - sample.village[0], z = sample.village[1] - n;
    await adapter.preload(terrain, [[x, z]], 180);
    vehiclePair(terrain, sample.data, sample.village, x, z, 1 / 120, name);
  }
  for (const tile of terrain.tiles.values()) { tile.mesh?.geometry.dispose(); tile.mesh?.material.dispose(); }
} finally { process.chdir(root); }
if (process.argv.includes('--mutations')) {
  const changes = [
    ['row-key-collision', 'this.columns * (cz - this.minCZ)', '(cz - this.minCZ)'],
    ['missing-neighbour', 'cx <= cx0 + span', 'cx < cx0 + span'],
    ['outside-wraps-row', 'if (cx < this.minCX || cx > this.maxCX || cz < this.minCZ || cz > this.maxCZ) return -1;', 'if (false) return -1;'],
  ];
  for (const [name, from, to] of changes) {
    assert.equal(source.split(from).length, 2, `${name}: unique mutation site`);
    const mutant = (await bundle("export {Roads} from './web/src/roads.ts';", source.replace(from, to))).module;
    let failure;
    try { verify(mutant.Roads); } catch (error) { failure = error; }
    assert.ok(failure instanceof assert.AssertionError, `${name}: must fail an equivalence/range assertion, not setup`);
    console.log(`MUTATION ${name} rejected: ${failure.message.split('\n')[0]}`);
  }
}
console.log('PASS road key equivalence, frozen isolation, numeric range, per-update counters (timing is not a gate)');
