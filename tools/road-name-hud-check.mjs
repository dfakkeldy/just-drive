#!/usr/bin/env node
// Node check (with --mutations) for HUD road-name lookup (Roads.nameAt: road surface plus 1 m edge tolerance).
// Synthetic cases and source mutants always run (CI-safe without data/baked); Point Tupper baked-land cases
// run automatically when data/baked/areas/pointtupper/roads.json is present.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(resolve(root, file), 'utf8');
const roadsSource = read('web/src/roads.ts');
const vehicleSource = read('web/src/vehicle.ts');
const bikeSource = read('web/src/bike-ride.ts');

const options = {
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
  alias: {
    'three/examples': resolve(root, 'web/node_modules/three/examples'),
    'three/addons': resolve(root, 'web/node_modules/three/examples/jsm'),
    three: resolve(root, 'web/node_modules/three/build/three.module.js'),
  },
};

async function loadBundle(replacements = {}) {
  const entry = `
    export { Roads } from './web/src/roads.ts';
    export { Vehicle } from './web/src/vehicle.ts';
    export { BikeRide } from './web/src/bike-ride.ts';
    export * as THREE from 'three';
  `;
  const result = await build({
    ...options,
    stdin: { contents: entry, resolveDir: root },
    plugins: [{
      name: 'in-memory',
      setup(b) {
        for (const [rel, contents] of Object.entries(replacements)) {
          const abs = resolve(root, rel);
          b.onLoad({ filter: new RegExp(abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ contents, loader: 'ts' }));
        }
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

function flatTerrain() {
  return {
    level: 8,
    heightAt: () => 10,
    surfaceAt: () => ({ ground: 10, level: 8, kind: 2, halfWidth: 3.6, roadDist: 0, canopy: 0, washboard: false, bridge: false, brook: 99 }),
    withContactHeight: (_, readFn) => readFn(),
  };
}

function rig(THREE) {
  const node = () => new THREE.Object3D();
  return { root: node(), body: node(), steer: { fl: node(), fr: node() }, wheels: { fl: node(), fr: node(), rl: node(), rr: node() } };
}

function bikeRig(THREE) {
  const node = () => new THREE.Object3D();
  return { root: node(), pose() {} };
}

function runSynthetic(mod) {
  const terrain = flatTerrain();
  // Road 107: wide paved road (halfWidth 3.6) running along x=0 (E=0, N=-50..50 -> world z=-50..50).
  // Road 200: active railway (halfWidth 2.6, name 'Railroad') running parallel at x=12.
  // Road 374: unnamed driveway (halfWidth 1.5, name null) joining road 107 at (0, 0) heading east.
  // Road 168: named narrow track (halfWidth 1.5, name 'Old Heavy Water Road') parallel at x=-4.7 (edge at x=-3.2).
  const data = {
    roads: [
      { id: 107, name: 'Industrial Park Road', kind: 2, halfWidth: 3.6, bridge: false, pts: [[0, -50], [0, 50]] },
      { id: 200, name: 'Railroad', kind: 3, halfWidth: 2.6, bridge: false, pts: [[12, -50], [12, 50]] },
      { id: 374, name: null, kind: 4, halfWidth: 1.5, bridge: false, pts: [[0, 0], [30, 0]] },
      { id: 168, name: 'Old Heavy Water Road', kind: 4, halfWidth: 1.5, bridge: false, pts: [[-4.7, 20], [-4.7, 50]] },
    ],
  };
  const net = new mod.Roads(data, [0, 0], terrain);
  // 1. Centre and road surface of road 107 -> named.
  assert.equal(net.nameAt(0, -20), 'Industrial Park Road', 'centre of road 107');
  assert.equal(net.nameAt(3.59, -20), 'Industrial Park Road', 'inside right pavement edge');
  // 2. Within 1 m edge tolerance (halfWidth + 1 = 4.6 m) -> named.
  assert.equal(net.nameAt(4.59, -20), 'Industrial Park Road', 'within 1 m tolerance of edge');
  // 3. Past 1 m edge tolerance (in brush between road and rail) -> null.
  assert.equal(net.nameAt(4.62, -20), null, 'just past 1 m edge tolerance returns null');
  assert.equal(net.nameAt(7.0, -20), null, 'brush 7 m off road 107 returns null (old 14 m reach named road 107)');
  // 4. On Railroad -> 'Railroad', never 'Industrial Park Road'.
  assert.equal(net.nameAt(12.0, -20), 'Railroad', 'centre of Railroad');
  assert.equal(net.nameAt(15.5, -20), 'Railroad', 'within 1 m edge of Railroad');
  assert.equal(net.nameAt(15.7, -20), null, 'beyond 1 m edge of Railroad returns null');
  // 5. Unnamed driveway mouth touching road 107 must not blank out road 107 while on pavement.
  assert.equal(net.nameAt(2.5, 0), 'Industrial Park Road', 'unnamed driveway mouth does not mask road 107');
  assert.equal(net.nameAt(6.0, 0), null, 'out on unnamed driveway beyond road 107 edge returns null');
  // 6. On road 107 surface (x=-2.5: d=2.5 <= 3.6, outside=0) vs narrow road 168 at x=-4.7 (d=2.2 > 1.5, outside=0.7):
  //    must name road 107 (whose surface the car is ON), not road 168 (whose centreline is 0.3 m closer but car is OFF it).
  assert.equal(net.nameAt(-2.5, -35), 'Industrial Park Road', 'road surface beats closer narrow road edge margin');
  // 7. Vehicle and BikeRide both wire roadName through Roads.nameAt.
  const car = new mod.Vehicle(rig(mod.THREE), terrain, net, -0.2);
  car.place(7.0, -20, 0);
  car.update(1 / 60, { throttle: 0, steer: 0, handbrake: true, touch: false });
  assert.equal(car.roadName, null, 'Vehicle in brush 7 m off road clears roadName');
  car.place(0, -20, 0);
  car.update(1 / 60, { throttle: 0, steer: 0, handbrake: true, touch: false });
  assert.equal(car.roadName, 'Industrial Park Road', 'Vehicle on road 107 names it');

  const bike = new mod.BikeRide(bikeRig(mod.THREE), terrain, net, -0.2);
  bike.place(7.0, -20, 0);
  bike.update(1 / 60, { throttle: 0, steer: 0, brake: true, touch: false });
  assert.equal(bike.roadName, null, 'BikeRide in brush 7 m off road clears roadName');
  bike.place(12.0, -20, 0);
  bike.update(1 / 60, { throttle: 0, steer: 0, brake: true, touch: false });
  assert.equal(bike.roadName, 'Railroad', 'BikeRide on Railroad names Railroad');
}

function runBakedPointTupper(mod) {
  const base = resolve(root, 'data/baked/areas/pointtupper');
  if (!existsSync(resolve(base, 'roads.json'))) {
    console.log('SKIP baked Point Tupper checks (no data/baked/areas/pointtupper/roads.json)');
    return;
  }
  const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
  const roadData = JSON.parse(readFileSync(resolve(base, 'roads.json'), 'utf8'));
  const [ve, vn] = manifest.village;
  const net = new mod.Roads(roadData, manifest.village, flatTerrain());
  const at = (e, n) => net.nameAt(e - ve, vn - n);

  assert.equal(at(628408, 5051575), 'Industrial Park Road', 'Point Tupper overpass approach on road 107');
  assert.equal(at(628458, 5051637), 'Railroad', 'Point Tupper Railroad 216 east of overpass');
  assert.equal(at(629116, 5049450), 'Industrial Park Road', 'Point Tupper level crossing approach on road 107');
  assert.equal(at(629097, 5049463), 'Railroad', 'Point Tupper Railroad 200 south of crossing');
  // 8 m east of road 107 near overpass approach (brush, clear of roads): must be null.
  assert.equal(at(628416.5, 5051574), null, 'Point Tupper brush 8 m off road 107 returns null');
  // 8 m west of road 107 near level crossing approach (brush, clear of roads): must be null.
  assert.equal(at(629108, 5049447), null, 'Point Tupper brush 8 m off road 107 near crossing returns null');
  console.log('PASS baked Point Tupper HUD road-name checks (both crossings, Railroad, and off-road brush)');
}

const current = await loadBundle();
runSynthetic(current);
runBakedPointTupper(current);
console.log('PASS road-name-hud synthetic rules (surface + 1 m, unnamed filter, surface-over-margin, Vehicle + BikeRide)');

if (process.argv.includes('--mutations')) {
  const mutants = [
    ['old-14m-reach', 'web/src/roads.ts', roadsSource,
      'return this.query(this.cells, x, z, this.maxHalfWidth + 1, namedRoad, 1)?.road.name ?? null;',
      'return this.query(this.cells, x, z, 14)?.road.name ?? null;'],
    ['no-edge-tolerance', 'web/src/roads.ts', roadsSource,
      'return this.query(this.cells, x, z, this.maxHalfWidth + 1, namedRoad, 1)?.road.name ?? null;',
      'return this.query(this.cells, x, z, this.maxHalfWidth + 1, namedRoad, 0)?.road.name ?? null;'],
    ['no-unnamed-filter', 'web/src/roads.ts', roadsSource,
      'return this.query(this.cells, x, z, this.maxHalfWidth + 1, namedRoad, 1)?.road.name ?? null;',
      'return this.query(this.cells, x, z, this.maxHalfWidth + 1, undefined, 1)?.road.name ?? null;'],
    ['no-surface-priority', 'web/src/roads.ts', roadsSource,
      'if (outside <= edgeTolerance && (!best || outside < bestOutside || (outside === bestOutside && d < best.dist))) {',
      'if (outside <= edgeTolerance && (!best || d < best.dist)) {'],
    ['vehicle-old-nearest', 'web/src/vehicle.ts', vehicleSource,
      'if (dt > 0) this.roadName = this.roads.nameAt?.(this.x, this.z) ?? null;',
      'if (dt > 0) this.roadName = this.roads.nearest(this.x, this.z, 14)?.road.name ?? null;'],
    ['bike-old-nearest', 'web/src/bike-ride.ts', bikeSource,
      'if (dt > 0) this.roadName = this.roads.nameAt?.(this.x, this.z) ?? null;',
      'if (dt > 0) this.roadName = this.roads.nearest(this.x, this.z, 14)?.road.name ?? null;'],
  ];
  for (const [name, file, src, from, to] of mutants) {
    assert.equal(src.split(from).length, 2, `${name}: unique anchor in ${file}`);
    const mod = await loadBundle({ [file]: src.replace(from, to) });
    let failed = false;
    try { runSynthetic(mod); } catch (e) { failed = e instanceof assert.AssertionError; }
    assert.ok(failed, `mutant survived: ${name}`);
    console.log(`KILLED ${name}`);
  }
  console.log(`PASS road-name-hud: ${mutants.length} mutants killed`);
}
