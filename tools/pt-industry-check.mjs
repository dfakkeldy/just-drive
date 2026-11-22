import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {
  COAL_CONVEYORS, COAL_MOUNDS, COAL_YARD, NORTH_BULK_PIER, OIL_TERMINAL, PAPER_WHARF, POWER_PLANT,
  PT_INDUSTRY_BOUNDS,
} from '../web/src/pt-industry-data.ts';
import { PointTupperIndustry, industryGround, planPointTupperIndustry } from '../web/src/pt-industry.ts';
import { mergeStraitTall } from '../web/src/tall-strait.ts';
import { railLand } from './guardrail-land.mjs';

const land = railLand('areas/pointtupper');
const [VE, VN] = land.village;
const [west, south, east, north] = PT_INDUSTRY_BOUNDS;
const SEA = -0.2;

function inside(e, n, label = '') {
  assert.ok(e >= west && e <= east && n >= south && n <= north, `outside Point Tupper bounds: ${label} (${e}, ${n})`);
}

const roadSegs = land.roads.roads.flatMap((r) => r.pts.slice(1).map((b, i) => [r.pts[i], b, r.halfWidth]));
function roadClearance(e, n) {
  const x = e - VE, z = VN - n;
  let best = 1e9;
  for (const [a, b, hw] of roadSegs) {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    const d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz) - hw;
    if (d < best) best = d;
  }
  return best;
}

const tallRaw = JSON.parse(readFileSync('data/baked/areas/pointtupper/tall.json', 'utf8'));
const mergedTall = mergeStraitTall(tallRaw, 'pointtupper', land.village, PT_INDUSTRY_BOUNDS);
const tallSupports = [
  ...(mergedTall.lines || []).flatMap((l) => (l.pts || []).map((pt) => [pt[0], pt[1]])),
  ...(mergedTall.towers || []).map((t) => [t.e, t.n]),
];
assert.ok(tallSupports.length > 50, 'expected merged Strait power supports');

function checkGroundSamples(samples) {
  for (const [label, e, n, g] of samples) {
    inside(e, n, label);
    const baked = land.ground(e - VE, VN - n, true);
    assert.ok(baked !== null && Math.abs(baked - g) < 0.15, `baked ground mismatch at ${label}: data=${g} baked=${baked}`);
  }
}

const allSamples = [
  ['stack', POWER_PLANT.stack.e, POWER_PLANT.stack.n, POWER_PLANT.stack.g],
  ['esp', POWER_PLANT.esp.e, POWER_PLANT.esp.n, POWER_PLANT.esp.g],
  ['ashSilo', POWER_PLANT.ashSilo.e, POWER_PLANT.ashSilo.n, POWER_PLANT.ashSilo.g],
  ['crusher', POWER_PLANT.crusher.e, POWER_PLANT.crusher.n, POWER_PLANT.crusher.g],
  ['transferNorth', POWER_PLANT.transferNorth.e, POWER_PLANT.transferNorth.n, POWER_PLANT.transferNorth.g],
  ['intake', POWER_PLANT.intake.e, POWER_PLANT.intake.n, POWER_PLANT.intake.g],
  ...POWER_PLANT.transformers.map((t, i) => [`xfmr${i}`, t.e, t.n, t.g]),
  ['shoreTower', COAL_YARD.shoreTower.e, COAL_YARD.shoreTower.n, COAL_YARD.shoreTower.g],
  ['northStacker', COAL_YARD.northStacker.e, COAL_YARD.northStacker.n, COAL_YARD.northStacker.g],
  ['southStacker', COAL_YARD.southStacker.e, COAL_YARD.southStacker.n, COAL_YARD.southStacker.g],
  ...COAL_YARD.lightMasts.map((m, i) => [`mast${i}`, m.e, m.n, m.g]),
  ...COAL_CONVEYORS.flatMap((r) => r.points.map((p, i) => [`${r.id}[${i}]`, p.e, p.n, p.g])),
  ...OIL_TERMINAL.onshorePipe.map((p, i) => [`oilPipe[${i}]`, p.e, p.n, p.g]),
  ...PAPER_WHARF.conveyor.points.map((p, i) => [`paperConv[${i}]`, p.e, p.n, p.g]),
  ...NORTH_BULK_PIER.conveyor.points.map((p, i) => [`northConv[${i}]`, p.e, p.n, p.g]),
];
checkGroundSamples(allSamples);

// Verify all active coal mound samples match baked ground and stay clear of roads.
for (const m of COAL_MOUNDS) {
  let active = 0;
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const v = m.dtmDm[r * m.cols + c];
      if (v <= -900) continue;
      active++;
      const e = m.e0 + c * m.step, n = m.n0 + r * m.step;
      inside(e, n, m.id);
      const baked = land.ground(e - VE, VN - n, true);
      assert.ok(baked !== null && Math.abs(baked - v / 10) < 0.15, `coal grid ground mismatch ${m.id} (${e},${n})`);
      assert.ok(roadClearance(e, n) >= 1.0, `coal grid cell covers road ${m.id} (${e},${n})`);
    }
  }
  assert.ok(active >= 80, `coal mound ${m.id} has too few active cells: ${active}`);
}

function checkPlan(plan, { night }) {
  const sites = new Set();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  let stackFound = false;

  for (const p of plan.pieces) {
    sites.add(p.site);
    inside(p.e, p.n, p.site);
    assert.ok(p.matrix.elements.every(Number.isFinite), `non-finite matrix in ${p.site}`);
    const det = p.matrix.determinant();
    assert.ok(det > 0, `reflection/degenerate matrix (det=${det}) in ${p.site}/${p.kind}`);
    p.matrix.decompose(pos, quat, scale);
    assert.ok(scale.x > 0 && scale.y > 0 && scale.z > 0, `non-positive scale in ${p.site}`);
    assert.ok(Number.isInteger(p.color) && p.color >= 0 && p.color <= 0xffffff, `invalid hex color ${p.color}`);

    // Verify all 8 bounding corners stay inside Point Tupper bounds.
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(p.matrix);
      inside(v.x + VE, VN - v.z, `${p.site} corner`);
    }

    // Low pieces must clear road carriageways.
    if (p.clearance < 4.5) {
      const rd = roadClearance(p.e, p.n);
      assert.ok(rd >= 1.0, `low piece too close to road (${rd.toFixed(2)} m) at ${p.site} (${p.e}, ${p.n})`);
    }

    // Every industrial piece must clear #112 transmission towers.
    for (const [te, tn] of tallSupports) {
      const td = Math.hypot(p.e - te, p.n - tn);
      assert.ok(td >= 8.0, `piece too close to #112 power tower (${td.toFixed(2)} m) at ${p.site} (${p.e}, ${p.n})`);
    }

    if (p.site === 'plant' && p.kind === 'taper' && scale.y >= 100 && Math.hypot(p.e - POWER_PLANT.stack.e, p.n - POWER_PLANT.stack.n) < 1) {
      stackFound = true;
    }
  }

  assert.deepEqual([...sites].sort(), ['coal', 'coal-pier', 'north-bulk', 'oil-pier', 'paper-wharf', 'plant'], 'all six industrial sites present');
  assert.ok(stackFound, '101 m tapered concrete stack missing');

  if (!night) {
    assert.equal(plan.lights.length, 0, 'day plan must have zero night lights');
  } else {
    assert.ok(plan.lights.length >= 25, `night plan expected >= 25 lights, got ${plan.lights.length}`);
    const hasRedStack = plan.lights.some((l) => l.color === 0xff2211 && Math.hypot(l.e - POWER_PLANT.stack.e, l.n - POWER_PLANT.stack.n) < 10 && l.y > 90);
    const hasGreenMarine = plan.lights.some((l) => l.color === 0x28e868);
    assert.ok(hasRedStack, 'night plan missing red aviation beacons on 101 m stack');
    assert.ok(hasGreenMarine, 'night plan missing green marine dolphin navigation lights');
  }
}

function checkBuilt(kit, { low, night, hasStockpiles }) {
  assert.ok(kit.group.userData.buildMs < 1500, `build time too slow: ${kit.group.userData.buildMs} ms`);
  const names = kit.group.children.map((m) => m.name);
  assert.ok(names.includes('pt-industry-boxes') && names.includes('pt-industry-cylinders') && names.includes('pt-industry-tapered'), 'missing core instanced batches');
  assert.equal(names.includes('pt-industry-coal'), !hasStockpiles, 'coal mesh stockpiles gate mismatch');
  assert.equal(names.includes('pt-industry-lights'), night, 'night lights mesh gate mismatch');

  let triangles = 0, instances = 0;
  for (const mesh of kit.group.children) {
    if (mesh.material.map) assert.fail(`unexpected texture map on ${mesh.name}`);
    if (mesh.name === 'pt-industry-coal') {
      assert.equal(mesh.material.flatShading, false, 'coal mesh must not enable flatShading (avoids extra program)');
      assert.equal(mesh.material.side, THREE.DoubleSide, 'coal mesh matches buildings.ts DoubleSide Lambert program');
      const pos = mesh.geometry.attributes.position;
      const nrm = mesh.geometry.attributes.normal;
      for (let i = 0; i < nrm.count; i++) {
        assert.ok(nrm.getY(i) > 0.1, `coal mesh triangle ${i} not upward-facing (ny=${nrm.getY(i)})`);
      }
      triangles += pos.count / 3;
      continue;
    }
    assert.ok(mesh.isInstancedMesh, `expected InstancedMesh for ${mesh.name}`);
    instances += mesh.count;
    const idx = mesh.geometry.index;
    triangles += mesh.count * (idx ? idx.count / 3 : mesh.geometry.attributes.position.count / 3);
  }
  assert.ok(kit.group.children.length <= (night ? 5 : 4), `too many batches: ${kit.group.children.length}`);
  if (low) assert.ok(triangles < 25000, `LOW triangle count too high: ${triangles}`);
  return { batches: kit.group.children.length, instances, triangles };
}

function checkExaggeration(plan1, plan3) {
  assert.equal(plan1.pieces.length, plan3.pieces.length, 'piece count changed across exag');
  const p1 = new THREE.Vector3(), p3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
  const s1 = new THREE.Vector3(), s3 = new THREE.Vector3();
  let dryChecked = 0, marineChecked = 0;
  for (let i = 0; i < plan1.pieces.length; i++) {
    const a = plan1.pieces[i], b = plan3.pieces[i];
    a.matrix.decompose(p1, q1, s1);
    b.matrix.decompose(p3, q3, s3);
    // Upright structures keep exact true-metre height under exaggeration.
    if (a.site === 'plant' && a.kind === 'taper' && s1.y >= 100) {
      assert.ok(Math.abs(s1.y - s3.y) < 0.001, 'stack height stretched with exag');
      const expectedDy = industryGround(a.baseG, 3, SEA) - industryGround(a.baseG, 1, SEA);
      assert.ok(Math.abs((p3.y - p1.y) - expectedDy) < 0.005, 'stack base did not follow stretched ground');
      dryChecked++;
    }
    if ((a.site === 'oil-pier' || a.site === 'coal-pier') && a.baseG <= SEA) {
      assert.ok(Math.abs(p3.y - p1.y) < 0.005, `marine piece moved under exag at ${a.site}`);
      marineChecked++;
    }
  }
  assert.ok(dryChecked >= 1 && marineChecked >= 50, 'exag check missed dry or marine pieces');
}

// Run all baseline checks
const dayHigh = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
const nightHigh = new PointTupperIndustry(land.village, 1.5, SEA, false, true, false);
const dayLow = new PointTupperIndustry(land.village, 1.5, SEA, true, false, false);
const withStockpiles = new PointTupperIndustry(land.village, 1.5, SEA, false, false, true);

checkPlan(dayHigh.plan, { night: false });
checkPlan(nightHigh.plan, { night: true });
checkPlan(dayLow.plan, { night: false });

const statsHigh = checkBuilt(dayHigh, { low: false, night: false, hasStockpiles: false });
const statsNight = checkBuilt(nightHigh, { low: false, night: true, hasStockpiles: false });
const statsLow = checkBuilt(dayLow, { low: true, night: false, hasStockpiles: false });
checkBuilt(withStockpiles, { low: false, night: false, hasStockpiles: true });

assert.ok(statsLow.instances < statsHigh.instances, `LOW instances (${statsLow.instances}) not fewer than HIGH (${statsHigh.instances})`);
assert.ok(statsLow.triangles < statsHigh.triangles, `LOW triangles (${statsLow.triangles}) not fewer than HIGH (${statsHigh.triangles})`);

checkExaggeration(
  planPointTupperIndustry(land.village, 1, SEA, false, false),
  planPointTupperIndustry(land.village, 3, SEA, false, false),
);

if (process.argv.includes('--mutations')) {
  const clonePlan = (p) => ({
    pieces: p.pieces.map((x) => ({ ...x, matrix: x.matrix.clone() })),
    lights: p.lights.map((l) => ({ ...l })),
  });

  // 1. Reflection matrix (det < 0, the cylinder span bug)
  {
    const m = clonePlan(dayHigh.plan);
    m.pieces[0].matrix.elements[0] *= -1;
    assert.throws(() => checkPlan(m, { night: false }), undefined, 'reflection matrix mutant survived');
    console.log('killed reflection-matrix');
  }
  // 2. Out-of-bounds piece
  {
    const m = clonePlan(dayHigh.plan);
    m.pieces[0] = { ...m.pieces[0], e: east + 50 };
    assert.throws(() => checkPlan(m, { night: false }), undefined, 'out-of-bounds mutant survived');
    console.log('killed out-of-bounds');
  }
  // 3. Road-blocking low post
  {
    const m = clonePlan(dayHigh.plan);
    const roadPt = land.roads.roads[0].pts[0];
    m.pieces[0] = { ...m.pieces[0], e: roadPt[0] + VE, n: VN - roadPt[1], clearance: 0 };
    assert.throws(() => checkPlan(m, { night: false }), undefined, 'road-blocking mutant survived');
    console.log('killed road-blocking');
  }
  // 4. #112 power tower collision
  {
    const m = clonePlan(dayHigh.plan);
    const [te, tn] = tallSupports[0];
    m.pieces[0] = { ...m.pieces[0], e: te, n: tn, clearance: 10 };
    assert.throws(() => checkPlan(m, { night: false }), undefined, 'tower-collision mutant survived');
    console.log('killed tower-collision');
  }
  // 5. Missing 101 m stack
  {
    const m = clonePlan(dayHigh.plan);
    m.pieces = m.pieces.filter((x) => !(x.site === 'plant' && x.kind === 'taper'));
    assert.throws(() => checkPlan(m, { night: false }), undefined, 'missing-stack mutant survived');
    console.log('killed missing-stack');
  }
  // 6. Day light leak
  {
    const m = clonePlan(dayHigh.plan);
    m.lights.push({ e: POWER_PLANT.stack.e, n: POWER_PLANT.stack.n, y: 100, radius: 1, color: 0xff2211 });
    assert.throws(() => checkPlan(m, { night: false }), undefined, 'day-light-leak mutant survived');
    console.log('killed day-light-leak');
  }
  // 7. Bad baked ground sample
  {
    assert.throws(() => checkGroundSamples([['bad-stack', POWER_PLANT.stack.e, POWER_PLANT.stack.n, POWER_PLANT.stack.g + 2.0]]), undefined, 'bad-ground mutant survived');
    console.log('killed bad-ground');
  }
  // 8. Stretched stack height under exag
  {
    const p1 = planPointTupperIndustry(land.village, 1, SEA, false, false);
    const p3 = planPointTupperIndustry(land.village, 3, SEA, false, false);
    const st = p3.pieces.find((x) => x.site === 'plant' && x.kind === 'taper');
    st.matrix.scale(new THREE.Vector3(1, 3, 1));
    assert.throws(() => checkExaggeration(p1, p3), undefined, 'stretched-stack mutant survived');
    console.log('killed stretched-stack');
  }
  // 9. Coal mesh flatShading extra program
  {
    const bad = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
    const coal = bad.group.children.find((m) => m.name === 'pt-industry-coal');
    coal.material.flatShading = true;
    assert.throws(() => checkBuilt(bad, { low: false, night: false, hasStockpiles: false }), undefined, 'flat-shading mutant survived');
    console.log('killed coal-flat-shading');
  }
  // 10. Stockpiles duplicate coal mesh
  {
    assert.throws(() => checkBuilt(dayHigh, { low: false, night: false, hasStockpiles: true }), undefined, 'stockpiles-duplicate mutant survived');
    console.log('killed stockpiles-duplicate');
  }
}

console.log(JSON.stringify({
  buildMs: +dayHigh.group.userData.buildMs.toFixed(1),
  high: statsHigh,
  night: statsNight,
  low: statsLow,
  tallSupportsChecked: tallSupports.length,
}));
