import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {
  COAL_CONVEYORS, COAL_MOUNDS, COAL_YARD, NORTH_BULK_PIER, OIL_TERMINAL, PAPER_WHARF, POWER_PLANT,
  PT_INDUSTRY_BOUNDS,
} from '../web/src/pt-industry-data.ts';
import { PointTupperIndustry, industryGround, planPointTupperIndustry, ptIndustryCanopyExcludes } from '../web/src/pt-industry.ts';
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
const mergedTall = mergeStraitTall(tallRaw);
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

// Verify all active 2 m coal mound cells match baked ground and stay clear of roads.
for (const m of COAL_MOUNDS) {
  let active = 0;
  for (const sp of m.spans) {
    const r = sp[0], c0 = sp[1];
    for (let i = 2; i < sp.length; i++) {
      active++;
      const c = c0 + i - 2;
      const e = m.e0 + c * m.step, n = m.n0 + r * m.step;
      inside(e, n, m.id);
      const baked = land.ground(e - VE, VN - n, true);
      assert.ok(baked !== null && Math.abs(baked - sp[i] / 10) < 0.15, `coal grid ground mismatch ${m.id} (${e},${n})`);
      assert.ok(roadClearance(e, n) >= 1.0, `coal grid cell covers road ${m.id} (${e},${n})`);
    }
  }
  assert.ok(active >= 800, `coal mound ${m.id} has too few active cells: ${active}`);
}

/** Verify loading-arm bases sit strictly inside their supporting concrete pier deck footprint. */
function checkLoadingArmSupport(berth1Arms, berth2Arms) {
  const ba = OIL_TERMINAL.berth1AxisDeg * Math.PI / 180;
  const us = Math.sin(ba), uc = Math.cos(ba), vs = uc, vc = -us;
  for (let i = 0; i < berth1Arms.count; i++) {
    const t = berth1Arms.count > 1 ? i / (berth1Arms.count - 1) : 0.5;
    const e = berth1Arms.start[0] + (berth1Arms.end[0] - berth1Arms.start[0]) * t;
    const n = berth1Arms.start[1] + (berth1Arms.end[1] - berth1Arms.start[1]) * t;
    const de = e - OIL_TERMINAL.berth1Center[0], dn = n - OIL_TERMINAL.berth1Center[1];
    const u = de * us + dn * uc, v = de * vs + dn * vc;
    assert.ok(Math.abs(u) <= OIL_TERMINAL.berth1Length / 2 - 1.0 && Math.abs(v) <= OIL_TERMINAL.berth1Width / 2 - 1.0,
      `Berth 1 loading arm ${i} base floats outside deck (u=${u.toFixed(2)}, v=${v.toFixed(2)})`);
  }
  const dx = OIL_TERMINAL.berth2End[0] - OIL_TERMINAL.berth2Start[0];
  const dn = OIL_TERMINAL.berth2End[1] - OIL_TERMINAL.berth2Start[1];
  const len = Math.hypot(dx, dn), ux = dx / len, un = dn / len, px = -un, pn = ux;
  for (let i = 0; i < berth2Arms.count; i++) {
    const t = berth2Arms.count > 1 ? i / (berth2Arms.count - 1) : 0.5;
    const e = berth2Arms.start[0] + (berth2Arms.end[0] - berth2Arms.start[0]) * t;
    const n = berth2Arms.start[1] + (berth2Arms.end[1] - berth2Arms.start[1]) * t;
    const de = e - OIL_TERMINAL.berth2Start[0], dn2 = n - OIL_TERMINAL.berth2Start[1];
    const along = de * ux + dn2 * un, across = de * px + dn2 * pn;
    assert.ok(along >= 1.0 && along <= len - 1.0 && Math.abs(across) <= OIL_TERMINAL.berth2Width / 2 - 1.0,
      `Berth 2 loading arm ${i} base floats outside deck (along=${along.toFixed(2)}, across=${across.toFixed(2)})`);
  }
}
checkLoadingArmSupport(OIL_TERMINAL.berth1Arms, OIL_TERMINAL.berth2Arms);

/** Verify canopy exclusions clear offshore marine pier returns without clearing dry inland forest. */
assert.equal(ptIndustryCanopyExcludes(629212.5, 5047991.2), true, 'canopy excludes must cover Berth 1 loading arms');
assert.equal(ptIndustryCanopyExcludes(629137.0, 5048138.0), true, 'canopy excludes must cover Berth 2');
assert.equal(ptIndustryCanopyExcludes(628603.0, 5048844.5), true, 'canopy excludes must cover coal pier ship unloader');
assert.equal(ptIndustryCanopyExcludes(628545.0, 5048861.0), true, 'canopy excludes must cover coal pier hopper');
assert.equal(ptIndustryCanopyExcludes(629520.0, 5048220.0), false, 'canopy excludes must not clear onshore forest behind oil terminal');
assert.equal(ptIndustryCanopyExcludes(629360.0, 5048120.0), false, 'canopy excludes must not clear dry shoreline near oil abutment');
assert.equal(ptIndustryCanopyExcludes(629120.0, 5049350.0), false, 'canopy excludes must not clear onshore plant/yard area');

/** Verify shoreline wharf/pier decks and oil approach ramp stay cleanly above baked terrain across all exaggerations. */
function checkShorelineDecks(exag) {
  const decks = [
    ['paper-wharf', PAPER_WHARF.start, PAPER_WHARF.end, PAPER_WHARF.width, industryGround(PAPER_WHARF.baseG, exag, SEA) + PAPER_WHARF.deckLift],
    ['north-bulk', NORTH_BULK_PIER.berthStart, NORTH_BULK_PIER.berthEnd, NORTH_BULK_PIER.berthWidth, industryGround(NORTH_BULK_PIER.baseG, exag, SEA) + NORTH_BULK_PIER.deckLift],
    ['oil-approach', OIL_TERMINAL.approachStart, OIL_TERMINAL.approachEnd, OIL_TERMINAL.approachWidth, SEA + OIL_TERMINAL.deckY],
  ];
  for (const [name, a, b, width, deckTopY] of decks) {
    const dx = b[0] - a[0], dn = b[1] - a[1], len = Math.hypot(dx, dn), px = -dn / len, pn = dx / len;
    for (let k = 0; k <= 12; k++) {
      for (const w of [-width / 2, 0, width / 2]) {
        const e = a[0] + dx * (k / 12) + px * w;
        const n = a[1] + dn * (k / 12) + pn * w;
        const g = land.ground(e - VE, VN - n, true);
        const gY = industryGround(g, exag, SEA);
        assert.ok(deckTopY - gY >= 0.5, `${name} deck buried at exag=${exag} (${e.toFixed(1)},${n.toFixed(1)}): deckY=${deckTopY.toFixed(2)} groundY=${gY.toFixed(2)}`);
      }
    }
  }
  // Verify oil shore-transition ramp clears terrain from shore abutment to approachStart at every exaggeration.
  const ab = OIL_TERMINAL.shoreAbutment, ap = OIL_TERMINAL.approachStart;
  const y0 = industryGround(ab.g, exag, SEA) + ab.deckLift;
  const y1 = SEA + OIL_TERMINAL.deckY;
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    const e = ab.e + (ap[0] - ab.e) * t, n = ab.n + (ap[1] - ab.n) * t;
    const gY = industryGround(land.ground(e - VE, VN - n, true), exag, SEA);
    const deckY = y0 + (y1 - y0) * t;
    assert.ok(deckY - gY >= 0.8, `oil shore ramp buried at exag=${exag} t=${t}: deckY=${deckY.toFixed(2)} groundY=${gY.toFixed(2)}`);
  }
}

function checkPlan(plan, { night, exag }) {
  const sites = new Set();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  let stackFound = false;
  let spansChecked = 0;

  for (const p of plan.pieces) {
    sites.add(p.site);
    inside(p.e, p.n, p.site);
    assert.ok(p.matrix.elements.every(Number.isFinite), `non-finite matrix in ${p.site}`);
    const det = p.matrix.determinant();
    assert.ok(det > 0, `reflection/degenerate matrix (det=${det}) in ${p.site}/${p.kind}`);
    p.matrix.decompose(pos, quat, scale);
    assert.ok(scale.x > 0 && scale.y > 0 && scale.z > 0, `non-positive scale in ${p.site}`);
    assert.ok(Number.isInteger(p.color) && p.color >= 0 && p.color <= 0xffffff, `invalid hex color ${p.color}`);

    // Verify transformed endpoints of every span piece match its intended [A, B] world coordinates.
    if (p.spanEnds) {
      spansChecked++;
      const [expA, expB] = p.spanEnds;
      const localA = p.kind === 'cyl' ? new THREE.Vector3(0, -0.5, 0) : new THREE.Vector3(0, 0, -0.5);
      const localB = p.kind === 'cyl' ? new THREE.Vector3(0, 0.5, 0) : new THREE.Vector3(0, 0, 0.5);
      const actA = localA.applyMatrix4(p.matrix);
      const actB = localB.applyMatrix4(p.matrix);
      assert.ok(actA.distanceTo(expA) < 0.01 && actB.distanceTo(expB) < 0.01,
        `span transformed endpoints mismatch in ${p.site}/${p.kind}: dA=${actA.distanceTo(expA).toFixed(4)} dB=${actB.distanceTo(expB).toFixed(4)}`);

      // Sample along every span (0..1) and verify midspan clearance above any crossed road carriageway.
      const halfThick = p.kind === 'cyl' ? Math.max(scale.x, scale.z) / 2 : scale.y / 2;
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const wx = expA.x + (expB.x - expA.x) * t;
        const wy = expA.y + (expB.y - expA.y) * t;
        const wz = expA.z + (expB.z - expA.z) * t;
        const se = wx + VE, sn = VN - wz;
        const rd = roadClearance(se, sn);
        if (rd < 0.5) {
          const g = land.ground(wx, wz, true);
          const roadY = industryGround(g, exag, SEA);
          const under = (wy - halfThick) - roadY;
          assert.ok(under >= 4.5, `span breaches road clearance (${under.toFixed(2)} m < 4.5 m) at exag=${exag} ${p.site} (${se.toFixed(1)},${sn.toFixed(1)})`);
        }
      }
    }

    // Keep the centre margin and test the footprint of uprights near a road.
    const lowUpright = !p.spanEnds && p.clearance < 4.5;
    const roadDistance = lowUpright ? roadClearance(p.e, p.n) : Infinity;
    assert.ok(roadDistance >= 1.0,
      `low piece too close to road (${roadDistance.toFixed(2)} m) at ${p.site} (${p.e}, ${p.n})`);
    const footprintNearRoad = roadDistance <= Math.hypot(scale.x, scale.z) / 2;
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) {
      const v = new THREE.Vector3(x, y, z).applyMatrix4(p.matrix);
      inside(v.x + VE, VN - v.z, `${p.site} corner`);
      if (y < 0 && footprintNearRoad) {
        const clearance = roadClearance(v.x + VE, VN - v.z);
        assert.ok(clearance >= 0, `upright footprint enters road in ${p.site} (${clearance.toFixed(2)} m)`);
      }
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

  assert.ok(spansChecked >= 150, `expected >= 150 spans checked, got ${spansChecked}`);
  assert.deepEqual([...sites].sort(), ['coal', 'coal-pier', 'north-bulk', 'oil-pier', 'paper-wharf', 'plant'], 'all six industrial sites present');
  assert.ok(stackFound, '101 m tapered concrete stack missing');

  // Verify Berth 1 control house trim tracks buildings.ts:236 base transform at every exaggeration.
  const ch = OIL_TERMINAL.controlHouse;
  const expectedTrimY = SEA + (-0.77 - SEA) * exag + ch.eave + 0.75 / 2;
  const trimPiece = plan.pieces.find((p) => p.site === 'oil-pier' && Math.hypot(p.e - ch.e, p.n - ch.n) < 0.1 && Math.abs(p.matrix.elements[5] - 0.75) < 0.01);
  assert.ok(trimPiece, 'Berth 1 control-house roof trim missing');
  assert.ok(Math.abs(trimPiece.matrix.elements[13] - expectedTrimY) < 0.01,
    `Berth 1 control-house trim floated at exag=${exag}: got ${trimPiece.matrix.elements[13].toFixed(3)}, expected ${expectedTrimY.toFixed(3)}`);

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

// Precompute grid-topological rim flags for every emitted coal triangle so contact checks never classify sunk triangles as rim.
const coalTriIsInterior = (() => {
  const flags = [];
  for (const m of COAL_MOUNDS) {
    const grid = new Int16Array(m.rows * m.cols).fill(-999);
    for (const sp of m.spans) for (let i = 2; i < sp.length; i++) grid[sp[0] * m.cols + sp[1] + i - 2] = sp[i];
    const active = (r, c) => r >= 0 && r < m.rows && c >= 0 && c < m.cols && grid[r * m.cols + c] > -900;
    const isRim = (r, c) => !active(r - 1, c) || !active(r + 1, c) || !active(r, c - 1) || !active(r, c + 1);
    for (let r = 0; r < m.rows - 1; r++) {
      for (let c = 0; c < m.cols - 1; c++) {
        if (!active(r, c) || !active(r, c + 1) || !active(r + 1, c + 1) || !active(r + 1, c)) continue;
        const r0 = isRim(r, c), r1 = isRim(r, c + 1), r2 = isRim(r + 1, c + 1), r3 = isRim(r + 1, c);
        flags.push(!r0 && !r1 && !r2);
        flags.push(!r0 && !r2 && !r3);
      }
    }
  }
  return flags;
})();

function checkCoalContact(coalMesh, exag) {
  const pos = coalMesh.geometry.attributes.position;
  assert.equal(pos.count / 3, coalTriIsInterior.length, 'coal mesh triangle count matches grid topology');
  let minGap = 999, maxGap = -999, sampled = 0;
  for (let ti = 0; ti < coalTriIsInterior.length; ti++) {
    if (!coalTriIsInterior[ti]) continue;
    sampled++;
    const i = ti * 3;
    const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    for (const [wx, wy, wz] of [
      [ax, ay, az], [bx, by, bz], [cx, cy, cz],
      [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3],
    ]) {
      const gm = industryGround(land.ground(wx, wz, true), exag, SEA);
      const gap = wy - gm;
      if (gap < minGap) minGap = gap;
      if (gap > maxGap) maxGap = gap;
    }
  }
  assert.ok(sampled >= 3500, `too few interior coal triangles sampled: ${sampled}`);
  const minAllowed = exag <= 1.5 ? -0.15 : -0.45;
  const maxAllowed = exag <= 1.5 ? 2.0 : 3.6;
  assert.ok(minGap >= minAllowed, `coal mesh dipped too far below terrain at exag=${exag}: minGap=${minGap.toFixed(2)} m`);
  assert.ok(maxGap <= maxAllowed, `coal mesh floated too high above terrain at exag=${exag}: maxGap=${maxGap.toFixed(2)} m`);
}

function checkBuilt(kit, { low, night, hasStockpiles, exag = 1.5 }) {
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
      checkCoalContact(mesh, exag);
      triangles += pos.count / 3;
      continue;
    }
    assert.ok(mesh.isInstancedMesh, `expected InstancedMesh for ${mesh.name}`);
    instances += mesh.count;
    const idx = mesh.geometry.index;
    triangles += mesh.count * (idx ? idx.count / 3 : mesh.geometry.attributes.position.count / 3);
  }
  assert.ok(kit.group.children.length <= (night ? 5 : 4), `too many batches: ${kit.group.children.length}`);
  if (low) assert.ok(triangles < 30000, `LOW triangle count too high: ${triangles}`);
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
    if (a.site === 'plant' && a.kind === 'taper' && s1.y >= 100) {
      assert.ok(Math.abs(s1.y - s3.y) < 0.001, 'stack height stretched with exag');
      const expectedDy = industryGround(a.baseG, 3, SEA) - industryGround(a.baseG, 1, SEA);
      assert.ok(Math.abs((p3.y - p1.y) - expectedDy) < 0.005, 'stack base did not follow stretched ground');
      dryChecked++;
    }
    if ((a.site === 'oil-pier' || a.site === 'coal-pier') && a.baseG === SEA) {
      assert.ok(Math.abs(p3.y - p1.y) < 0.005, `offshore marine piece moved under exag at ${a.site}`);
      marineChecked++;
    }
  }
  assert.ok(dryChecked >= 1 && marineChecked >= 50, 'exag check missed dry or marine pieces');
}

// Run all baseline checks across exag 1, 1.5, and 3
for (const exag of [1, 1.5, 3]) {
  checkShorelineDecks(exag);
  const built = new PointTupperIndustry(land.village, exag, SEA, false, false, false);
  checkPlan(built.plan, { night: false, exag });
  checkBuilt(built, { low: false, night: false, hasStockpiles: false, exag });
}

const dayHigh = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
const nightHigh = new PointTupperIndustry(land.village, 1.5, SEA, false, true, false);
const dayLow = new PointTupperIndustry(land.village, 1.5, SEA, true, false, false);
const withStockpiles = new PointTupperIndustry(land.village, 1.5, SEA, false, false, true);

checkPlan(nightHigh.plan, { night: true, exag: 1.5 });
checkPlan(dayLow.plan, { night: false, exag: 1.5 });

// Verify oil pipe rack continuity across the entire run: every inland bend, shore joint and offshore trestle joint (<= 0.005 m).
function checkOilPipeContinuity(plan, exag, low) {
  const expectedOnshore = low ? 3 : 5;
  const expectedOffshore = low ? 4 : 6;
  const pipeCyls = plan.pieces.filter((p) => p.site === 'oil-pier' && p.kind === 'cyl' && p.spanEnds);
  const nearNode = (pt, e, n, y) => Math.hypot(pt.x + VE - e, VN - pt.z - n) < 5.0 && Math.abs(pt.y - y) < 0.05;

  // 1. Every interior inland bend along onshorePipe
  for (let i = 1; i < OIL_TERMINAL.onshorePipe.length - 1; i++) {
    const node = OIL_TERMINAL.onshorePipe[i];
    const ny = industryGround(node.g, exag, SEA) + node.lift;
    const incoming = pipeCyls.filter((p) => nearNode(p.spanEnds[1], node.e, node.n, ny)).map((p) => p.spanEnds[1]);
    const outgoing = pipeCyls.filter((p) => nearNode(p.spanEnds[0], node.e, node.n, ny)).map((p) => p.spanEnds[0]);
    assert.equal(incoming.length, expectedOnshore, `inland oil bend #${i}: expected ${expectedOnshore} incoming pipes, got ${incoming.length}`);
    assert.equal(outgoing.length, expectedOnshore, `inland oil bend #${i}: expected ${expectedOnshore} outgoing pipes, got ${outgoing.length}`);
    for (const endPt of incoming) {
      const minDist = Math.min(...outgoing.map((s) => endPt.distanceTo(s)));
      assert.ok(minDist < 0.005, `oil pipe gap at inland bend #${i}: ${minDist.toFixed(3)} m`);
    }
  }

  // 2. Shore joint: onshore pipe ends -> sloped transition starts
  const shoreEnd = OIL_TERMINAL.onshorePipe[OIL_TERMINAL.onshorePipe.length - 1];
  const shorePrev = OIL_TERMINAL.onshorePipe[OIL_TERMINAL.onshorePipe.length - 2];
  const jointY = industryGround(shoreEnd.g, exag, SEA) + shoreEnd.lift;
  const sdx = shoreEnd.e - shorePrev.e, sdn = shoreEnd.n - shorePrev.n, sl = Math.hypot(sdx, sdn);
  const spe = -sdn / sl, spn = sdx / sl;
  const onshoreEnds = pipeCyls.filter((p) => nearNode(p.spanEnds[1], shoreEnd.e, shoreEnd.n, jointY)).map((p) => p.spanEnds[1]);
  const transPipes = pipeCyls.filter((p) => nearNode(p.spanEnds[0], shoreEnd.e, shoreEnd.n, jointY) && Math.abs(p.spanEnds[1].y - jointY) > 0.2);
  assert.equal(onshoreEnds.length, expectedOnshore, `expected ${expectedOnshore} onshore pipes at shore joint, got ${onshoreEnds.length}`);
  assert.equal(transPipes.length, expectedOffshore, `expected ${expectedOffshore} transition pipes at shore joint, got ${transPipes.length}`);
  for (const tp of transPipes) {
    const minDist = Math.min(...onshoreEnds.map((oe) => oe.distanceTo(tp.spanEnds[0])));
    assert.ok(minDist < 0.005, `oil pipe transition separated from onshore pipe at shore joint by ${minDist.toFixed(3)} m`);
  }
  for (const oe of onshoreEnds) {
    const de = oe.x + VE - shoreEnd.e, dn = VN - oe.z - shoreEnd.n;
    const along = Math.abs(de * (sdx / sl) + dn * (sdn / sl));
    assert.ok(along < 0.01 && Math.hypot(de - (de * spe + dn * spn) * spe, dn - (de * spe + dn * spn) * spn) < 0.01, 'onshore pipe end off shore-joint axis');
  }

  // 3. Offshore trestle start: sloped transition ends -> offshore approach trestle pipe starts
  const [ae, an] = OIL_TERMINAL.approachStart;
  const offshoreStarts = pipeCyls
    .filter((p) => !transPipes.includes(p) && Math.hypot(p.spanEnds[0].x + VE - ae, VN - p.spanEnds[0].z - an) < 6.0 && p.spanEnds[0].y > OIL_TERMINAL.deckY)
    .map((p) => p.spanEnds[0]);
  assert.equal(offshoreStarts.length, expectedOffshore, `expected ${expectedOffshore} offshore trestle pipe starts, got ${offshoreStarts.length}`);
  for (const tp of transPipes) {
    const minDist = Math.min(...offshoreStarts.map((os) => os.distanceTo(tp.spanEnds[1])));
    assert.ok(minDist < 0.005, `oil pipe transition separated from offshore trestle pipe by ${minDist.toFixed(3)} m`);
  }
}

checkOilPipeContinuity(dayHigh.plan, 1.5, false);
checkOilPipeContinuity(dayLow.plan, 1.5, true);

const sizeOf = (piece) => new THREE.Vector3().setFromMatrixScale(piece.matrix);
const matchesSize = (piece, x, y, z) => {
  const size = sizeOf(piece);
  return Math.abs(size.x - x) < 0.001
    && (y === undefined || Math.abs(size.y - y) < 0.001)
    && Math.abs(size.z - z) < 0.001;
};
const isFender = (piece) => piece.kind === 'box' && matchesSize(piece, 0.95, undefined, 1.7);

function checkOilBerthSides(plan, low) {
  const { berth1Center, berth1AxisDeg, berth1Length, berth1Width, berth1Arms,
    berth2Start, berth2End, berth2Width, berth2Arms, launchWharf, deckY } = OIL_TERMINAL;
  const angle = berth1AxisDeg * Math.PI / 180;
  const berth1Endpoint = (sign) => [
    berth1Center[0] + sign * berth1Length / 2 * Math.sin(angle),
    berth1Center[1] + sign * berth1Length / 2 * Math.cos(angle),
  ];
  const piers = [
    ['Berth 1', berth1Endpoint(-1), berth1Endpoint(1), berth1Width, berth1Arms.faceDeg, deckY + 0.2],
    ['Berth 2', berth2Start, berth2End, berth2Width, berth2Arms.faceDeg, deckY - 0.2],
    ['launch wharf', launchWharf.start, launchWharf.end, launchWharf.width, berth1Arms.faceDeg, launchWharf.deckY],
  ];
  for (const [name, start, end, width, faceDeg, height] of piers) {
    const dx = end[0] - start[0], dn = end[1] - start[1], length = Math.hypot(dx, dn);
    const ux = dx / length, un = dn / length;
    const face = faceDeg * Math.PI / 180;
    const sign = Math.sign(-un * Math.sin(face) + ux * Math.cos(face));
    const pieces = plan.pieces.filter((p) => p.site === 'oil-pier').flatMap((piece) => {
      const de = piece.matrix.elements[12] + VE - start[0];
      const north = VN - piece.matrix.elements[14] - start[1];
      const along = de * ux + north * un;
      const across = sign * (-de * un + north * ux);
      return along >= -0.01 && along <= length + 0.01 && Math.abs(across) < width / 2 + 1
        ? [{ piece, across }] : [];
    });
    const checkSide = (label, match, side) => {
      const fittings = pieces.filter(({ piece }) => match(piece));
      assert.ok(fittings.length > 0, `${name}: no ${label} to check`);
      for (const { across } of fittings) {
        assert.ok(side * across > 0, `${name}: ${label} on the wrong deck side`);
      }
    };
    const fromDeck = (p) => Math.abs(p.clearance - height) < 0.001;
    checkSide('fenders', (p) => isFender(p)
      && Math.abs(p.clearance + sizeOf(p).y - height - 0.2) < 0.001, 1);
    checkSide('bollards', (p) => p.kind === 'cyl' && fromDeck(p) && matchesSize(p, 0.55, 0.85, 0.55), 1);
    if (name !== 'launch wharf') {
      checkSide('lamp poles', (p) => p.kind === 'cyl' && fromDeck(p) && matchesSize(p, 0.24, 9.5, 0.24), -1);
    }
    if (name === 'Berth 2') {
      checkSide('pipe rack', (p) => p.kind === 'cyl' && matchesSize(p, 0.48, length, 0.48), -1);
      if (!low) checkSide('guardrail', (p) => p.kind === 'box' && matchesSize(p, 0.14, 0.14, length), -1);
    }
  }
}

function checkOnshoreOilBents(plan) {
  const boxes = plan.pieces.filter((p) => p.site === 'oil-pier' && p.kind === 'box' && !p.spanEnds);
  for (const node of OIL_TERMINAL.onshorePipe.filter((node) => node.bent)) {
    const offset = (p) => Math.hypot(p.e - node.e, p.n - node.n);
    const beam = boxes.find((p) => offset(p) < 0.01 && matchesSize(p, 5.8, 0.5, 0.5));
    assert.ok(beam, 'onshore oil bent crossbeam missing');
    const legs = boxes.filter((p) => offset(p) < 3 && matchesSize(p, 0.45, node.lift + 1.4, 0.45));
    assert.equal(legs.length, 2, 'onshore oil bent needs two legs');
    const inverse = beam.matrix.clone().invert();
    const legEnds = legs.map((leg) => new THREE.Vector3(0, 0.5, 0).applyMatrix4(leg.matrix).applyMatrix4(inverse));
    for (const end of legEnds) {
      assert.ok(Math.abs(end.x) <= 0.5 && Math.abs(end.z) <= 0.5 && end.y >= -0.5,
        'onshore oil bent leg misses crossbeam');
    }
    assert.ok(legEnds[0].x * legEnds[1].x < 0, 'onshore oil bent legs must support opposite beam ends');
  }
}

checkOilBerthSides(dayHigh.plan, false);
checkOilBerthSides(dayLow.plan, true);
checkOnshoreOilBents(dayHigh.plan);

// LOW sea omits depth writes. Include fenders on decks anchored above sea level.
const UNIT_CORNERS = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => new THREE.Vector3(x, y, z))));
for (const exag of [1, 1.5, 3]) {
  const plan = exag === 1.5 ? dayLow.plan : planPointTupperIndustry(land.village, exag, SEA, true, false);
  for (const p of plan.pieces) {
    if (p.site === 'plant' || p.site === 'coal') continue;
    const fender = isFender(p);
    if (p.baseG > SEA && !fender) continue;
    const minY = Math.min(...UNIT_CORNERS.map((c) => c.clone().applyMatrix4(p.matrix).y));
    const floor = SEA - (fender ? 0.15 : 0.25);
    assert.ok(minY >= floor - 1e-6,
      `LOW marine piece extends below waterline at exag=${exag}: ${p.site}/${p.kind} (minY=${minY.toFixed(2)})`);
  }
}

// Verify the north-bulk-desktop-day camera ray hits the North Bulk shiploader tower itself (not the conveyor truss).
function checkNorthBulkLoaderRay(built) {
  const cam = new THREE.Vector3(626700 - VE, 55, VN - 5051280);
  const target = new THREE.Vector3(626892.0 - VE, 15.0, VN - 5051395.0);
  const dir = target.clone().sub(cam).normalize();
  const dist = target.distanceTo(cam);
  built.group.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(cam, dir, 1, dist + 25);
  const hits = rc.intersectObject(built.group, true);
  assert.ok(hits.length > 0, 'north-bulk camera ray missed industry group');
  assert.equal(hits[0].object.name, 'pt-industry-boxes', `north-bulk ray hit ${hits[0].object.name} instead of shiploader box`);
  const offset = hits[0].point.distanceTo(target);
  assert.ok(offset < 6.0, `north-bulk ray hit ${offset.toFixed(2)} m from shiploader tower target`);
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  hits[0].object.getMatrixAt(hits[0].instanceId, m);
  m.decompose(pos, quat, scale);
  assert.ok(scale.x > 7.5 && scale.y > 16.0 && scale.z > 7.5, `north-bulk ray hit non-tower instance scale=(${scale.x.toFixed(1)},${scale.y.toFixed(1)},${scale.z.toFixed(1)})`);
}
checkNorthBulkLoaderRay(dayHigh);

const statsHigh = checkBuilt(dayHigh, { low: false, night: false, hasStockpiles: false, exag: 1.5 });
const statsNight = checkBuilt(nightHigh, { low: false, night: true, hasStockpiles: false, exag: 1.5 });
const statsLow = checkBuilt(dayLow, { low: true, night: false, hasStockpiles: false, exag: 1.5 });
checkBuilt(withStockpiles, { low: false, night: false, hasStockpiles: true, exag: 1.5 });

assert.ok(statsLow.instances < statsHigh.instances, `LOW instances (${statsLow.instances}) not fewer than HIGH (${statsHigh.instances})`);
assert.ok(statsLow.triangles < statsHigh.triangles, `LOW triangles (${statsLow.triangles}) not fewer than HIGH (${statsHigh.triangles})`);

checkExaggeration(
  planPointTupperIndustry(land.village, 1, SEA, false, false),
  planPointTupperIndustry(land.village, 3, SEA, false, false),
);

if (process.argv.includes('--mutations')) {
  const clonePlan = (p) => ({
    pieces: p.pieces.map((x) => ({
      ...x,
      matrix: x.matrix.clone(),
      ...(x.spanEnds ? { spanEnds: [x.spanEnds[0].clone(), x.spanEnds[1].clone()] } : {}),
    })),
    lights: p.lights.map((l) => ({ ...l })),
  });

  // 1. Reflection matrix (det < 0)
  {
    const m = clonePlan(dayHigh.plan);
    m.pieces[0].matrix.elements[0] *= -1;
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'reflection matrix mutant survived');
    console.log('killed reflection-matrix');
  }
  // 2. Identity rotation on a span (wrong orientation, right midpoint)
  {
    const m = clonePlan(dayHigh.plan);
    const sp = m.pieces.find((x) => x.spanEnds);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    sp.matrix.decompose(pos, q, sc);
    sp.matrix.compose(pos, new THREE.Quaternion(), sc);
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'identity-span mutant survived');
    console.log('killed identity-span');
  }
  // 3. Midspan breaching road clearance
  {
    const m = clonePlan(dayHigh.plan);
    const sp = m.pieces.find((x) => x.spanEnds && x.site === 'oil-pier' && roadClearance(x.e, x.n) < 8);
    assert.ok(sp, 'expected road-crossing oil-pier span');
    sp.spanEnds[0].y -= 6;
    sp.spanEnds[1].y -= 6;
    sp.matrix.elements[13] -= 6;
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'road-midspan mutant survived');
    console.log('killed road-midspan');
  }
  // 4. Floating Berth 1 loading arm outside deck
  {
    const badArms = { ...OIL_TERMINAL.berth1Arms, start: [629194.0, 5048007.0], end: [629222.0, 5047969.0] };
    assert.throws(() => checkLoadingArmSupport(badArms, OIL_TERMINAL.berth2Arms), undefined, 'floating-arm mutant survived');
    console.log('killed floating-arm');
  }
  // 5. Out-of-bounds piece
  {
    const m = clonePlan(dayHigh.plan);
    m.pieces[0] = { ...m.pieces[0], e: east + 50 };
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'out-of-bounds mutant survived');
    console.log('killed out-of-bounds');
  }
  // 6. Road-blocking low post
  {
    const m = clonePlan(dayHigh.plan);
    const roadPt = land.roads.roads[0].pts[0];
    const up = m.pieces.find((x) => !x.spanEnds);
    const idx = m.pieces.indexOf(up);
    m.pieces[idx] = { ...up, e: roadPt[0] + VE, n: VN - roadPt[1], clearance: 0 };
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'road-blocking mutant survived');
    console.log('killed road-blocking');
  }
  // 7. #112 power tower collision
  {
    const m = clonePlan(dayHigh.plan);
    const [te, tn] = tallSupports[0];
    m.pieces[0] = { ...m.pieces[0], e: te, n: tn, clearance: 10 };
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'tower-collision mutant survived');
    console.log('killed tower-collision');
  }
  // 8. Missing 101 m stack
  {
    const m = clonePlan(dayHigh.plan);
    m.pieces = m.pieces.filter((x) => !(x.site === 'plant' && x.kind === 'taper'));
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'missing-stack mutant survived');
    console.log('killed missing-stack');
  }
  // 9. Day light leak
  {
    const m = clonePlan(dayHigh.plan);
    m.lights.push({ e: POWER_PLANT.stack.e, n: POWER_PLANT.stack.n, y: 100, radius: 1, color: 0xff2211 });
    assert.throws(() => checkPlan(m, { night: false, exag: 1.5 }), undefined, 'day-light-leak mutant survived');
    console.log('killed day-light-leak');
  }
  // 10. Bad baked ground sample
  {
    assert.throws(() => checkGroundSamples([['bad-stack', POWER_PLANT.stack.e, POWER_PLANT.stack.n, POWER_PLANT.stack.g + 2.0]]), undefined, 'bad-ground mutant survived');
    console.log('killed bad-ground');
  }
  // 11. Stretched stack height under exag
  {
    const p1 = planPointTupperIndustry(land.village, 1, SEA, false, false);
    const p3 = planPointTupperIndustry(land.village, 3, SEA, false, false);
    const st = p3.pieces.find((x) => x.site === 'plant' && x.kind === 'taper');
    st.matrix.scale(new THREE.Vector3(1, 3, 1));
    assert.throws(() => checkExaggeration(p1, p3), undefined, 'stretched-stack mutant survived');
    console.log('killed stretched-stack');
  }
  // 12. Floating coal mesh (+10 m above terrain)
  {
    const bad = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
    const coal = bad.group.children.find((m) => m.name === 'pt-industry-coal');
    const pos = coal.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + 10);
    assert.throws(() => checkBuilt(bad, { low: false, night: false, hasStockpiles: false, exag: 1.5 }), undefined, 'floating-coal mutant survived');
    console.log('killed floating-coal');
  }
  // 13. Sunk interior coal triangles (-10 m below terrain)
  {
    const bad = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
    const coal = bad.group.children.find((m) => m.name === 'pt-industry-coal');
    const pos = coal.geometry.attributes.position;
    let lowered = 0;
    for (let ti = 0; ti < coalTriIsInterior.length && lowered < 110; ti++) {
      if (!coalTriIsInterior[ti]) continue;
      for (let k = 0; k < 3; k++) pos.setY(ti * 3 + k, pos.getY(ti * 3 + k) - 10);
      lowered++;
    }
    assert.throws(() => checkBuilt(bad, { low: false, night: false, hasStockpiles: false, exag: 1.5 }), undefined, 'sunk-coal mutant survived');
    console.log('killed sunk-coal');
  }
  // 14. Coal mesh flatShading extra program
  {
    const bad = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
    const coal = bad.group.children.find((m) => m.name === 'pt-industry-coal');
    coal.material.flatShading = true;
    assert.throws(() => checkBuilt(bad, { low: false, night: false, hasStockpiles: false, exag: 1.5 }), undefined, 'flat-shading mutant survived');
    console.log('killed coal-flat-shading');
  }
  // 15. Stockpiles duplicate coal mesh
  {
    assert.throws(() => checkBuilt(dayHigh, { low: false, night: false, hasStockpiles: true, exag: 1.5 }), undefined, 'stockpiles-duplicate mutant survived');
    console.log('killed stockpiles-duplicate');
  }
  // 16. Missing North Bulk shiploader tower (conveyor still present; camera ray must fail)
  {
    const bad = new PointTupperIndustry(land.village, 1.5, SEA, false, false, false);
    const boxes = bad.group.children.find((m) => m.name === 'pt-industry-boxes');
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    let removed = 0;
    for (let i = 0; i < boxes.count; i++) {
      boxes.getMatrixAt(i, m);
      m.decompose(pos, quat, scale);
      if (Math.hypot(pos.x + VE - 626894.0, VN - pos.z - 5051392.0) < 12 && pos.y > 6 && scale.y > 5) {
        boxes.setMatrixAt(i, zero);
        removed++;
      }
    }
    boxes.instanceMatrix.needsUpdate = true;
    assert.ok(removed > 0, 'failed to remove North Bulk loader tower for mutant');
    assert.throws(() => checkNorthBulkLoaderRay(bad), undefined, 'missing-north-bulk-loader mutant survived');
    console.log('killed missing-north-bulk-loader');
  }
}

console.log(JSON.stringify({
  buildMs: +dayHigh.group.userData.buildMs.toFixed(1),
  high: statsHigh,
  night: statsNight,
  low: statsLow,
  tallSupportsChecked: tallSupports.length,
}));
