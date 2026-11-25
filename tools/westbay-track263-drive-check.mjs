// Same-path drive proof for the West Bay track 263 trough delta (Hill 1 and Hill 2.5, car and pickup, forward and reverse).
// Reads tools/westbay-track263-delta/hashes.json to detect before/after land state (fails on mixed/unknown).
// On 'after' land: asserts arrival and < 50 mm sink (ownTyre, adjusted drawnTyre, float, body) at Hill 1 and Hill 2.5.
// On 'before' land: asserts the known trough failure (> 200 mm at Hill 1, > 800 mm at Hill 2.5), and fails if --require-after is passed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { png } from './quarry-height-read.mjs';
import { wheelVertices } from './fleet-wheel-vertices.mjs';
import { wheelPothole } from './fleet-wheel-contact.mjs';
import { followPath } from './fleet-quarry-path.mjs';

const root = process.cwd();
const requireAfter = process.argv.includes('--require-after');
const bakedRoot = resolve(root, process.env.WESTBAY_BAKED_ROOT ?? 'data/baked');
const base = resolve(bakedRoot, 'areas/westbay');
const receipt = JSON.parse(readFileSync(resolve(root, 'tools/westbay-track263-delta/hashes.json'), 'utf8'));

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const states = new Set();
for (const entry of receipt.files) {
  const digest = sha(readFileSync(resolve(bakedRoot, entry.file)));
  if (digest === entry.before) states.add('before');
  else if (digest === entry.sha256) states.add('after');
  else assert.fail(`Unknown West Bay tile bytes for ${entry.file}: ${digest}`);
}
assert.equal(states.size, 1, `Mixed before/after West Bay tiles: ${[...states].join(', ')}`);
const landState = [...states][0];
if (requireAfter) assert.equal(landState, 'after', 'Expected after land (--require-after)');

const context = new Proxy(
  { measureText: t => ({ width: String(t).length * 8 }), createLinearGradient: () => ({ addColorStop() {} }) },
  { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) },
);
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.fetch = async p => new Response(readFileSync(p));
globalThis.createImageBitmap = async b => png(Buffer.from(await b.arrayBuffer()));
globalThis.OffscreenCanvas = class {
  getContext() {
    let img;
    return { drawImage(b) { img = b; }, getImageData() { return { data: img.pixels }; } };
  }
};

const bundled = await build({
  stdin: {
    contents: [
      "export {Vehicle} from './web/src/vehicle';",
      "export {Terrain} from './web/src/terrain';",
      "export {Roads} from './web/src/roads';",
      "export {QuarrySite} from './web/src/quarry-site';",
      "export {createCar} from './web/src/car';",
      "export {createTruck, TRUCK_SPEC} from './web/src/truck';",
      "export {CAR_SPEC} from './web/src/vehicle-spec';",
      "export {potholeDepth, potholeDensity, setDiagnosticPotholes} from './web/src/defects';",
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.env.DEV': 'true' },
  logLevel: 'silent',
  plugins: [{
    name: 'three-ext',
    setup(b) {
      b.onResolve({ filter: /^three(?:\/.*)?$/ }, a => ({
        path: a.path === 'three'
          ? pathToFileURL(resolve(root, 'web/node_modules/three/build/three.module.js')).href
          : pathToFileURL(resolve(root, 'web/node_modules/three', a.path.slice(6).replace('addons/', 'examples/jsm/'))).href,
        external: true,
      }));
    },
  }],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
const roadData = JSON.parse(readFileSync(resolve(base, 'roads.json'), 'utf8'));
// Exact crossing path from tools/fleet-main-contact-check.mjs (track 263 pts[204..214]).
const forwardPath = [
  [-10752.56, -1082.09], [-10748.89, -1080.49], [-10745.25, -1078.84], [-10741.65, -1077.11],
  [-10738.13, -1075.26], [-10734.71, -1073.23], [-10731.43, -1070.99], [-10728.32, -1068.54],
  [-10725.33, -1065.93], [-10722.49, -1063.14], [-10719.89, -1060.13],
].map(([x, z]) => ({ x, z }));
const reversePath = [...forwardPath].reverse();

async function driveOne(hill, kind, path, potholes) {
  mod.setDiagnosticPotholes(potholes);
  const start = { ...path[0], heading: Math.atan2(path[1].x - path[0].x, -path[1].z + path[0].z) };
  const terrain = new mod.Terrain(manifest, base, {}, hill, -0.2);
  const site = new mod.QuarrySite(manifest.village);
  terrain.sites.push(site);
  terrain.coast = site;
  const ids = new Set();
  const size = manifest.size / 256;
  for (let x = start.x - 260; x <= start.x + 260; x += 120) {
    for (let z = start.z - 260; z <= start.z + 260; z += 120) {
      ids.add(`${Math.floor((x + manifest.village[0] - manifest.origin[0]) / size)}_${Math.floor((z - manifest.village[1] + manifest.origin[1]) / size)}`);
    }
  }
  for (const id of ids) {
    const [i, j] = id.split('_').map(Number);
    await terrain.loadNow(8, i, j);
  }
  terrain.group.traverse(n => { if (n.isMesh) n.visible = true; });
  terrain.group.updateMatrixWorld(true);

  const roads = new mod.Roads(roadData, manifest.village, terrain);
  const rig = kind === 'car' ? mod.createCar(false) : mod.createTruck(false);
  const v = new mod.Vehicle(rig, terrain, roads, -0.2, kind === 'car' ? mod.CAR_SPEC : mod.TRUCK_SPEC);
  let seed = 1;
  v.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  v.assist = 0; v.strongHelp = false; v.touchSpeedLimit = false;
  assert.ok(v.place(start.x, start.z, start.heading), 'crossing start accepted');
  for (let i = 0; i < 240; i++) v.update(1 / 120, { throttle: 0, steer: 0, handbrake: true });

  const wheels = [...new Set([...Object.values(rig.wheels), ...(rig.extraWheels ?? [])])];
  const tyres = wheels.map(w => wheelVertices(THREE, rig, w));
  const bodySamples = [];
  rig.root.traverse(m => {
    if (!m.isMesh || m === rig.riderMesh) return;
    for (let p = m; p && p !== rig.root; p = p.parent) if (wheels.includes(p)) return;
    const a = m.geometry.attributes.position, cells = new Map();
    for (let i = 0; i < a.count; i++) {
      if (a.getY(i) > 1) continue;
      const key = `${Math.floor(a.getX(i))},${Math.floor(a.getZ(i))}`, old = cells.get(key);
      if (old === undefined || a.getY(i) < a.getY(old)) cells.set(key, i);
    }
    for (const i of cells.values()) bodySamples.push({ m, i });
  });

  const p = new THREE.Vector3(), c = new THREE.Vector3();
  const member = { state: 'DRIVEN', id: kind, vehicle: v };
  const stats = { drawnTyre: 0, drawnAdj: 0, troughDrawnNoPot: 0, ownTyre: 0, float: 0, body: 0, progress: 0, arrived: false };
  const state = {};
  for (let tick = 0; tick < 12000; tick++) {
    let input;
    try { input = followPath(v, path, state, 4); }
    catch (err) {
      if (landState === 'before' && String(err.message).startsWith('Physical driver cannot progress')) break;
      throw err;
    }
    stats.progress = Math.max(stats.progress, state.at ?? 0);
    v.update(1 / 120, input);
    rig.root.updateMatrixWorld(true);
    const s263 = path === forwardPath ? 812.59 + (state.at ?? 0) : 852.40 - (state.at ?? 0);
    const inTrough = s263 >= 826 && s263 <= 854;
    const depth = potholes ? Math.max(...wheels.map((_, i) => wheelPothole(member, i, terrain, mod.potholeDepth, mod.potholeDensity))) : 0;
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i], gaps = [Infinity, Infinity];
      w.getWorldPosition(c);
      for (const local of tyres[i]) {
        p.copy(local).applyMatrix4(w.matrixWorld);
        if (p.y > c.y + 0.001) continue;
        const drawn = terrain.meshHeightAt(p.x, p.z, true), physics = terrain.heightAt(p.x, p.z);
        assert.notEqual(drawn, null); assert.notEqual(physics, null);
        const mm = Math.abs(physics - drawn);
        stats.drawnTyre = Math.max(stats.drawnTyre, drawn - p.y);
        stats.drawnAdj = Math.max(stats.drawnAdj, drawn - p.y - mm - depth);
        if (inTrough) stats.troughDrawnNoPot = Math.max(stats.troughDrawnNoPot, drawn - p.y - depth);
        stats.ownTyre = Math.max(stats.ownTyre, physics - p.y - depth);
        gaps[local.x < 0 ? 0 : 1] = Math.min(gaps[local.x < 0 ? 0 : 1], p.y - drawn);
      }
      stats.float = Math.max(stats.float, ...gaps);
    }
    for (const { m, i } of bodySamples) {
      m.getVertexPosition(i, p).applyMatrix4(m.matrixWorld);
      const h = terrain.meshHeightAt(p.x, p.z, true);
      assert.notEqual(h, null);
      stats.body = Math.max(stats.body, h - p.y);
    }
    if (input.arrived) { stats.arrived = true; break; }
  }
  return stats;
}

const rows = [];
const cases = landState === 'after'
  ? [
      { dir: 'fwd', path: forwardPath, potholes: true },
      { dir: 'fwd', path: forwardPath, potholes: false },
      { dir: 'rev', path: reversePath, potholes: false },
    ]
  : [{ dir: 'fwd', path: forwardPath, potholes: true }];

for (const { dir, path, potholes } of cases) {
  for (const hill of [1, 2.5]) {
    for (const kind of ['car', 'truck']) {
      const s = await driveOne(hill, kind, path, potholes);
      const row = {
        state: landState, dir, potholes, hill, kind, arrived: s.arrived,
        progressM: +s.progress.toFixed(2),
        drawnTyreMm: +(s.drawnTyre * 1000).toFixed(1),
        drawnAdjMm: +(s.drawnAdj * 1000).toFixed(1),
        troughDrawnMm: +(s.troughDrawnNoPot * 1000).toFixed(1),
        ownTyreMm: +(s.ownTyre * 1000).toFixed(1),
        floatMm: +(s.float * 1000).toFixed(1),
        bodyMm: +(s.body * 1000).toFixed(1),
      };
      rows.push(row);
      console.log(`DRIVE ${JSON.stringify(row)}`);
      if (landState === 'after') {
        assert.equal(s.arrived, true, `after land must finish crossing (${JSON.stringify(row)})`);
        assert.ok(s.ownTyre < 0.05, `ownTyre >= 50 mm: ${JSON.stringify(row)}`);
        assert.ok(s.drawnAdj < 0.05, `drawnAdj >= 50 mm: ${JSON.stringify(row)}`);
        assert.ok(s.troughDrawnNoPot < 0.05, `troughDrawnNoPot >= 50 mm: ${JSON.stringify(row)}`);
        assert.ok(s.float < 0.05, `float >= 50 mm: ${JSON.stringify(row)}`);
        assert.ok(s.body < 0.05, `body >= 50 mm: ${JSON.stringify(row)}`);
      }
    }
  }
}

if (landState === 'before') {
  const h1Car = rows.find(r => r.hill === 1 && r.kind === 'car');
  const h25Car = rows.find(r => r.hill === 2.5 && r.kind === 'car');
  assert.ok(h1Car.ownTyreMm > 200, `expected >200 mm before sink at Hill 1, got ${h1Car.ownTyreMm}`);
  assert.ok(!h25Car.arrived && h25Car.ownTyreMm > 800, `expected stalled >800 mm before sink at Hill 2.5, got ${JSON.stringify(h25Car)}`);
  console.log('PASS westbay-track263-drive (before land negative control verified; trough > 200 mm / > 800 mm)');
} else {
  console.log('PASS westbay-track263-drive (after land: all Hill 1 and Hill 2.5 crossings arrive with sink < 50 mm)');
}
