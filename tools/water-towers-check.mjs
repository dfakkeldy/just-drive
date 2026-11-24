#!/usr/bin/env node
// Node + mutation contract checks for municipal water towers, standpipes, reservoirs and small vertical tanks.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { WATER_TOWERS } from '../web/src/water-towers-data.ts';
import {
  WaterTowers, buildWaterTowers, foundationSkirt, waterTowerCanopyExcludes, waterTowerGround, waterTowersForArea,
} from '../web/src/water-towers.ts';
import { MISCLASSIFIED_WATER_TOWERS } from '../web/src/tall-strait-data.ts';
import { mergeStraitTall } from '../web/src/tall-strait.ts';
import { railLand } from './guardrail-land.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { buildSync } = require('esbuild');

const AREAS = ['pointtupper', 'cansocauseway', 'porthood'];
const EMPTY_AREAS = ['mabou', 'judique', 'westbay'];
const SEA = -0.2;
const FALLBACK_VILLAGE = {
  pointtupper: [626316, 5052132],
  cansocauseway: [621196, 5063396],
  porthood: [614028, 5095140],
};
const EXPECTED_IDS = [
  'ph-pitt-street', 'port-hastings', 'mulgrave-north', 'mulgrave-south', 'port-hood-water',
  'port-hood-bin', 'pt-oil-1893', 'pt-oil-1897', 'pt-power-1906', 'ph-wallboard-silo-1', 'ph-wallboard-silo-2',
  'paint-w-1', 'paint-w-2', 'paint-w-3', 'paint-w-4', 'paint-w-5', 'paint-w-6', 'paint-w-7', 'paint-w-8',
  'paint-e-1', 'paint-e-2', 'paint-e-3',
  'mulgrave-dock-1', 'mulgrave-dock-2', 'mulgrave-dock-3', 'mulgrave-dock-4', 'mulgrave-dock-5', 'mulgrave-dock-6',
];
const EXPECTED_PLACEMENTS = [
  'ph-pitt-street:pointtupper', 'port-hastings:pointtupper', 'port-hastings:cansocauseway',
  'mulgrave-north:pointtupper', 'mulgrave-south:pointtupper', 'port-hood-water:porthood',
  'port-hood-bin:porthood', 'pt-oil-1893:pointtupper', 'pt-oil-1897:pointtupper', 'pt-power-1906:pointtupper',
  'ph-wallboard-silo-1:pointtupper', 'ph-wallboard-silo-2:pointtupper',
  'paint-w-1:pointtupper', 'paint-w-2:pointtupper', 'paint-w-3:pointtupper', 'paint-w-4:pointtupper',
  'paint-w-5:pointtupper', 'paint-w-6:pointtupper', 'paint-w-7:pointtupper', 'paint-w-8:pointtupper',
  'paint-e-1:pointtupper', 'paint-e-2:pointtupper', 'paint-e-3:pointtupper',
  'mulgrave-dock-1:pointtupper', 'mulgrave-dock-2:pointtupper', 'mulgrave-dock-3:pointtupper',
  'mulgrave-dock-4:pointtupper', 'mulgrave-dock-5:pointtupper', 'mulgrave-dock-6:pointtupper',
];
const hasLand = AREAS.every(a => existsSync(`${root}data/baked/areas/${a}/manifest.json`));

const lands = hasLand ? Object.fromEntries(AREAS.map(a => [a, railLand(`areas/${a}`)])) : null;
const buildingsByArea = hasLand
  ? Object.fromEntries(AREAS.map(a => [a, JSON.parse(readFileSync(`${root}data/baked/areas/${a}/buildings.json`, 'utf8')).buildings]))
  : null;
const manifests = hasLand
  ? Object.fromEntries(AREAS.map(a => [a, JSON.parse(readFileSync(`${root}data/baked/areas/${a}/manifest.json`, 'utf8'))]))
  : Object.fromEntries(AREAS.map(a => [a, { village: FALLBACK_VILLAGE[a] }]));

function pointSeg(e, n, a, b) {
  const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dn) / l2)) : 0;
  return Math.hypot(e - a[0] - t * dx, n - a[1] - t * dn);
}

function inPoly(e, n, poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > n) !== (yj > n) && e < (xj - xi) * (n - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function checkDataAndLand(specs, helpers) {
  assert.deepEqual(specs.map(t => t.id), EXPECTED_IDS, 'pinned 28 unique structure IDs');
  const placements = specs.flatMap(t => t.areas.map(a => `${t.id}:${a}`));
  assert.equal(new Set(placements).size, placements.length, 'no duplicate (id, area) placements');
  assert.deepEqual(placements, EXPECTED_PLACEMENTS, 'pinned 29 (id, area) placements across pointtupper (26), cansocauseway (1), porthood (2)');

  for (const t of specs) {
    assert.ok(t.diameter > 1 && t.diameter <= 20, `${t.id}: diameter out of range (${t.diameter})`);
    assert.ok(t.shellHeight > 2 && t.shellHeight <= 35, `${t.id}: shellHeight out of range (${t.shellHeight})`);
    assert.ok(t.roofHeight > 0 && t.roofHeight <= 5, `${t.id}: roofHeight out of range (${t.roofHeight})`);
    assert.ok(Number.isInteger(t.color) && t.color >= 0 && t.color <= 0xffffff, `${t.id}: invalid hex colour`);
    assert.ok(!t.nightLight, `${t.id}: no red night light on standing water towers/tanks`);
    assert.ok(typeof t.source === 'string' && t.source.length > 0, `${t.id}: missing public open-data source`);
    assert.ok(t.areas.length >= 1, `${t.id}: missing areas`);

    for (const area of t.areas) {
      assert.ok(AREAS.includes(area), `${t.id}: unexpected area ${area}`);
      if (!hasLand) continue;
      const m = manifests[area];
      const [w, s, ea, no] = m.mid;
      assert.ok(t.e >= w && t.e <= ea && t.n >= s && t.n <= no, `${t.id} outside ${area} mid box`);

      const land = lands[area];
      const [VE, VN] = land.village;
      const bakedG = land.ground(t.e - VE, VN - t.n, true);
      assert.ok(bakedG !== null && Math.abs(bakedG - t.g) < 0.15,
        `${t.id} (${area}): baked ground mismatch data=${t.g} baked=${bakedG}`);

      // Verify actual generated foundation geometry sits below fine baked terrain around the full perimeter at exag = 1, 1.5 and 3.
      const r = t.diameter / 2;
      const rimR = r + (t.diameter >= 9 ? 0.38 : 0.22);
      for (const exag of [1.0, 1.5, 3.0]) {
        const built = helpers.buildWaterTowers([t], land.village, exag, SEA, false);
        const pos = built.geometry.getAttribute('position');
        const cx = t.e - VE, cz = VN - t.n;
        let tankMinY = Infinity, slabMinY = Infinity;
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          if (Math.hypot(vx - cx, vz - cz) <= rimR + 0.25) {
            if (vy < tankMinY) tankMinY = vy;
          } else if (vy < slabMinY) {
            slabMinY = vy;
          }
        }
        built.geometry.dispose();
        assert.ok(Number.isFinite(tankMinY), `${t.id}: missing tank foundation vertices`);
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * Math.PI * 2;
          const eg = land.ground(t.e + Math.cos(ang) * rimR - VE, VN - (t.n + Math.sin(ang) * rimR), true);
          assert.ok(eg !== null, `${t.id}: missing rim ground sample`);
          const edgeY = helpers.waterTowerGround(eg, exag, SEA);
          assert.ok(tankMinY <= edgeY - 0.05,
            `${t.id} (${area}) plinth gap at exag=${exag}: bot=${tankMinY.toFixed(2)} > rimGround=${edgeY.toFixed(2)}`);
        }
        if (t.valveHouse) {
          assert.ok(Number.isFinite(slabMinY), `${t.id}: missing valveHouse slab vertices`);
          const vh = t.valveHouse;
          const a = vh.azDeg * Math.PI / 180;
          const ve = t.e + Math.sin(a) * vh.dist;
          const vn = t.n + Math.cos(a) * vh.dist;
          const yaw = -vh.yawDeg * Math.PI / 180;
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            const lx = sx * (vh.width / 2 + 0.18), lz = sz * (vh.depth / 2 + 0.18);
            const ce = ve + lx * c + lz * sn;
            const cn = vn + lx * sn - lz * c;
            const cg = land.ground(ce - VE, VN - cn, true);
            const cornerY = helpers.waterTowerGround(cg, exag, SEA);
            assert.ok(slabMinY <= cornerY - 0.05,
              `${t.id} valveHouse gap at exag=${exag}: bot=${slabMinY.toFixed(2)} > cornerGround=${cornerY.toFixed(2)}`);
          }
        }
      }

      // Road clearance: every structure clears all public roads (kind < 4) by >= 10 m,
      // and clears kind-4 service tracks by >= 5 m except Port Hood's dead-end gravel turnaround loop (road 644).
      const x = t.e - VE, z = VN - t.n;
      for (const rd of land.roads.roads) {
        if (area === 'porthood' && t.id === 'port-hood-water' && rd.id === 644) continue;
        for (let i = 1; i < rd.pts.length; i++) {
          const d = pointSeg(x, z, rd.pts[i - 1], rd.pts[i]) - rd.halfWidth - r;
          const minClr = rd.kind < 4 ? 10.0 : 5.0;
          assert.ok(d >= minClr, `${t.id} (${area}) too close to road ${rd.id} (kind ${rd.kind}): ${d.toFixed(2)} m`);
        }
      }

      // Building footprint clearance: >= 3.0 m edge-to-edge, never inside a baked building.
      for (const b of buildingsByArea[area]) {
        assert.ok(!inPoly(t.e, t.n, b.footprint), `${t.id} (${area}) inside baked building ${b.id}`);
        for (let i = 0; i < b.footprint.length; i++) {
          const d = pointSeg(t.e, t.n, b.footprint[i], b.footprint[(i + 1) % b.footprint.length]) - r;
          assert.ok(d >= 3.0, `${t.id} (${area}) overlaps baked building ${b.id}: ${d.toFixed(2)} m`);
        }
      }
    }
  }

  const pitt = specs.find(t => t.id === 'ph-pitt-street');
  assert.ok(pitt && pitt.kind === 'standpipe' && pitt.rings === 3 && pitt.balcony && pitt.valveHouse, 'Pitt St cobalt-blue standpipe');
  const pittCol = new THREE.Color(pitt.color);
  assert.ok(pittCol.b > pittCol.r * 2.5, 'Pitt St standpipe must be blue');
  assert.ok(Math.abs(pitt.shellHeight + pitt.roofHeight - 26.5) < 0.2, 'Pitt St total height 26.5 m');
  assert.ok(!specs.some(t => Math.hypot(t.e - 629723.9, t.n - 5053077.0) < 50), 'demolished Tamarac water tower must not be built');

  for (const empty of EMPTY_AREAS) {
    assert.equal(helpers.waterTowersForArea(empty).length, 0, `${empty} has no water towers`);
    assert.equal(helpers.WaterTowers.forArea(empty, [624000, 5103000], 1.5, SEA, false), null, `${empty} returns null`);
  }

  // Canopy exclusion: covers all 5 municipal tank centres AND the Pitt St valve house centre & corners.
  for (const id of ['ph-pitt-street', 'port-hastings', 'mulgrave-north', 'mulgrave-south', 'port-hood-water']) {
    const t = specs.find(x => x.id === id);
    assert.equal(helpers.waterTowerCanopyExcludes(t.e, t.n, t.areas[0]), true, `canopy excluded at ${id}`);
    assert.equal(helpers.waterTowerCanopyExcludes(t.e + t.diameter + 10, t.n, t.areas[0]), false, `canopy untouched away from ${id}`);
  }
  const vh = pitt.valveHouse;
  const va = vh.azDeg * Math.PI / 180;
  const ve = pitt.e + Math.sin(va) * vh.dist;
  const vn = pitt.n + Math.cos(va) * vh.dist;
  assert.equal(helpers.waterTowerCanopyExcludes(ve, vn, 'pointtupper'), true, 'canopy excluded at Pitt St valve house');
  assert.equal(helpers.waterTowerCanopyExcludes(ve - 1.5, vn - 1.0, 'pointtupper'), true, 'canopy excluded at Pitt St valve house corner');
  assert.equal(helpers.waterTowerCanopyExcludes(624000, 5103000, 'mabou'), false, 'Mabou canopy untouched');

  assert.equal(helpers.waterTowerGround(45.0, 1.5, SEA), SEA + (45.0 - SEA) * 1.5, 'dry ground stretches by exag');
  assert.equal(helpers.waterTowerGround(-2.0, 1.5, SEA), -2.0, 'submerged base does not stretch');
}

function checkGeometryAndCollisions(helpers) {
  for (const area of AREAS) {
    const m = manifests[area];
    const specs = helpers.waterTowersForArea(area);
    let desktopTris = 0, lowTris = 0;

    for (const low of [false, true]) {
      const wt = helpers.WaterTowers.forArea(area, m.village, 1.5, SEA, low);
      assert.ok(wt, `${area} WaterTowers constructed`);
      assert.equal(wt.group.children.length, 1, `${area}: single merged mesh (1 draw call)`);
      const mesh = wt.group.children[0];
      assert.equal(mesh.material.vertexColors, true, 'shared vertex-coloured Lambert material');
      assert.equal(mesh.material.type, 'MeshLambertMaterial', 'Lambert material shares buildings shader program');
      assert.equal(mesh.material.side, THREE.DoubleSide, 'DoubleSide matches buildings material program');

      const pos = mesh.geometry.getAttribute('position');
      const norm = mesh.geometry.getAttribute('normal');
      const col = mesh.geometry.getAttribute('color');
      assert.ok(pos && norm && col && pos.count > 0 && pos.count % 3 === 0, `${area}: valid non-indexed triangles`);
      const tris = pos.count / 3;
      if (low) lowTris = tris; else desktopTris = tris;

      for (let i = 0; i < pos.array.length; i++) {
        assert.ok(Number.isFinite(pos.array[i]), `${area}: non-finite vertex position`);
        assert.ok(Number.isFinite(norm.array[i]), `${area}: non-finite normal`);
        assert.ok(Number.isFinite(col.array[i]) && col.array[i] >= 0 && col.array[i] <= 1.001, `${area}: invalid colour`);
      }

      const expectedSolids = specs.length + specs.filter(s => s.valveHouse).length;
      assert.equal(wt.solids.length, expectedSolids, `${area}: solid count`);
      const first = wt.solids[0];
      const car = { x: first.x + first.half * 0.4, z: first.z, heading: 0, vx: -10, vz: 0, speed: 10 };
      wt.resolveSolids(car);
      assert.ok(Math.hypot(car.x - first.x, car.z - first.z) >= first.half, `${area}: resolveSolids pushes vehicle out`);

      wt.dispose();
    }

    assert.ok(lowTris < desktopTris, `${area}: LOW phone geometry (${lowTris} tris) simpler than desktop (${desktopTris} tris)`);
    if (area === 'pointtupper') {
      assert.ok(lowTris <= 4000, `pointtupper LOW triangle ceiling exceeded: ${lowTris}`);
      assert.ok(desktopTris <= 11500, `pointtupper desktop triangle ceiling exceeded: ${desktopTris}`);
    }
    console.log(`PASS ${area}: ${specs.length} structures, desktop=${desktopTris} tris, low=${lowTris} tris`);
  }

  // Directional collision probe on Pitt St valve house: verify rendered width (4.5 m) and depth (3.4 m) axes match pushOut.
  const pitt = WATER_TOWERS.find(t => t.id === 'ph-pitt-street');
  const ptVillage = manifests.pointtupper.village;
  const ptWT = helpers.WaterTowers.forArea('pointtupper', ptVillage, 1.5, SEA, false);
  const vh = pitt.valveHouse;
  const vhSolid = ptWT.solids[1];
  const yaw = -vh.yawDeg * Math.PI / 180;
  // addBox local +X (width = 4.5 m, halfWidthBox = 2.25 m) -> (cos(yaw), -sin(yaw))
  // addBox local +Z (depth = 3.4 m, halfDepthBox = 1.70 m) -> (sin(yaw), cos(yaw))
  const wx = Math.cos(yaw), wz = -Math.sin(yaw);
  const dx = Math.sin(yaw), dz = Math.cos(yaw);
  const probeSpec = { envelope: { radius: 0.4, reach: 0.4, circles: [0] } };
  // Along width axis (rendered half=2.25, solid half=2.40): at 2.60 m (inside 2.40+0.40=2.80) MUST push out; at 3.00 m MUST NOT push.
  const hitW = { x: vhSolid.x + wx * 2.60, z: vhSolid.z + wz * 2.60, heading: 0, vx: -wx * 5, vz: -wz * 5, speed: 5, spec: probeSpec };
  ptWT.resolveSolids(hitW);
  assert.ok(Math.hypot(hitW.x - vhSolid.x, hitW.z - vhSolid.z) > 2.75, 'valve house width wall pushes car out');
  const missW = { x: vhSolid.x + wx * 3.00, z: vhSolid.z + wz * 3.00, heading: 0, vx: 0, vz: 0, speed: 0, spec: probeSpec };
  ptWT.resolveSolids(missW);
  assert.ok(Math.abs(Math.hypot(missW.x - vhSolid.x, missW.z - vhSolid.z) - 3.00) < 1e-4, 'valve house width exterior clear');
  // Along depth axis (rendered half=1.70, solid half=1.85): at 2.45 m (outside 1.85+0.40=2.25, inside swapped 2.40+0.40=2.80) MUST NOT push!
  const missD = { x: vhSolid.x + dx * 2.45, z: vhSolid.z + dz * 2.45, heading: 0, vx: 0, vz: 0, speed: 0, spec: probeSpec };
  ptWT.resolveSolids(missD);
  assert.ok(Math.abs(Math.hypot(missD.x - vhSolid.x, missD.z - vhSolid.z) - 2.45) < 1e-4, 'valve house depth exterior clear (axes not swapped)');
  const hitD = { x: vhSolid.x + dx * 2.05, z: vhSolid.z + dz * 2.05, heading: 0, vx: -dx * 5, vz: -dz * 5, speed: 5, spec: probeSpec };
  ptWT.resolveSolids(hitD);
  assert.ok(Math.hypot(hitD.x - vhSolid.x, hitD.z - vhSolid.z) > 2.20, 'valve house depth wall pushes car out');
  // Rotated corner probe (+wx, -dx corner where |Δx| exceeds half + reach): must still be pushed out (needs coupled=true).
  const cornerX = vhSolid.x + wx * (vh.width / 2) - dx * (vh.depth / 2);
  const cornerZ = vhSolid.z + wz * (vh.width / 2) - dz * (vh.depth / 2);
  const smallSpec = { envelope: { radius: 0.4, reach: 0.25, circles: [0] } };
  const cornerProbe = { x: cornerX, z: cornerZ, heading: 0, vx: 0, vz: 0, speed: 0, spec: smallSpec };
  ptWT.resolveSolids(cornerProbe);
  assert.ok(Math.hypot(cornerProbe.x - cornerX, cornerProbe.z - cornerZ) > 0.35, 'valve house rotated corner pushes car out');
  ptWT.dispose();

  // Verify exact top & bottom world Y of Pitt St and Port Hastings standpipes at exag 1.0, 1.5 and 3.0.
  const hastings = WATER_TOWERS.find(t => t.id === 'port-hastings');
  for (const exag of [1.0, 1.5, 3.0]) {
    const skirt = helpers.foundationSkirt(exag);
    const built = helpers.buildWaterTowers([pitt], ptVillage, exag, SEA, false);
    assert.equal(built.lights, 0, 'Pitt St has no red night light');
    const bb = built.geometry.boundingBox;
    const baseY = helpers.waterTowerGround(pitt.g, exag, SEA);
    assert.ok(Math.abs(bb.min.y - (baseY - skirt)) < 0.05, `Pitt St plinth seats skirt below ground (exag=${exag})`);
    assert.ok(bb.max.y >= baseY + 26.5 && bb.max.y <= baseY + 27.5, `Pitt St roof + vent top matches 26.5 m (got ${(bb.max.y - baseY).toFixed(2)})`);
    built.geometry.dispose();

    const hBuilt = helpers.buildWaterTowers([hastings], ptVillage, exag, SEA, false);
    const hBase = helpers.waterTowerGround(hastings.g, exag, SEA);
    assert.ok(Math.abs(hBuilt.geometry.boundingBox.min.y - (hBase - skirt)) < 0.05, `Port Hastings plinth seats skirt below ground (exag=${exag})`);
    hBuilt.geometry.dispose();
  }

  // Verify generic parametric 'elevated' legged water-tower builder produces valid grounded geometry.
  const leggedSpec = {
    id: 'test-elevated', areas: ['pointtupper'], kind: 'elevated',
    e: 628000, n: 5052000, g: 40, diameter: 10, shellHeight: 28, roofHeight: 2.0,
    legHeight: 18, legCount: 6, color: 0xcfd3d6, trimColor: 0x7b8287, source: 'test',
  };
  const elDesktop = helpers.buildWaterTowers([leggedSpec], ptVillage, 1.0, SEA, false);
  const elLow = helpers.buildWaterTowers([leggedSpec], ptVillage, 1.0, SEA, true);
  assert.ok(elDesktop.geometry.getAttribute('position').count > elLow.geometry.getAttribute('position').count, 'elevated LOW simpler than desktop');
  assert.ok(elDesktop.geometry.boundingBox.min.y < 40 && elDesktop.geometry.boundingBox.max.y >= 70, 'elevated bounds match leg + tank height');
  elDesktop.geometry.dispose();
  elLow.geometry.dispose();
}

function checkStraitDeduplication(merge) {
  assert.equal(MISCLASSIFIED_WATER_TOWERS.length, 4, 'four misclassified UTTO60 water tower masts');
  if (hasLand) {
    const raw = JSON.parse(readFileSync(`${root}data/baked/areas/pointtupper/tall.json`, 'utf8'));
    const merged = merge(raw);
    for (const [e, n] of MISCLASSIFIED_WATER_TOWERS) {
      assert.ok(raw.towers.some(t => Math.hypot(t.e - e, t.n - n) < 5), `raw pointtupper tall.json had bogus mast (${e},${n})`);
      assert.ok(!merged.towers.some(t => Math.hypot(t.e - e, t.n - n) < 20), `merged pointtupper tall.json dropped bogus mast (${e},${n})`);
    }
    assert.ok(merged.towers.length >= 11, `real Strait communication masts preserved (got ${merged.towers.length})`);
  } else {
    const synth = {
      version: 2, crs: 'EPSG:2961', root: [591500, 5037796, 657036, 5103332],
      mid: [620172, 5045988, 632460, 5058276], anchor: [626316, 5052132],
      turbines: [], far: [], lines: [],
      towers: MISCLASSIFIED_WATER_TOWERS.map(([e, n]) => ({ e, n, ground: 50, height: 42 })),
    };
    const merged = merge(synth);
    for (const [e, n] of MISCLASSIFIED_WATER_TOWERS) {
      assert.ok(!merged.towers.some(t => Math.hypot(t.e - e, t.n - n) < 20), `synthetic merge dropped bogus mast (${e},${n})`);
    }
  }
}

function checkMainWiring() {
  const main = readFileSync(`${root}web/src/main.ts`, 'utf8');
  assert.match(main, /ERA\.modern && params\.get\('waterTowers'\) !== '0'\s*\?\s*WaterTowers\.forArea\(AREA\.id, manifest\.village, EXAG, SEA_LEVEL, LOW\)/,
    'main constructs WaterTowers in modern era with waterTowers=0 test gate');
  const wtIdx = main.indexOf('const waterTowers =');
  const treeIdx = main.indexOf('const trees =');
  assert.ok(wtIdx > 0 && treeIdx > wtIdx, 'waterTowers constructed before Trees so individual trees are excluded');
  assert.match(main, /terrain\.canopyExcludes =[\s\S]*?waterTowers\.excludesCanopy/, 'WaterTowers canopy exclusion wired into terrain');
  assert.match(main, /const treeExcludes =[\s\S]*?waterTowers\?\.excludesCanopy\(e, n\)/, 'WaterTowers canopy exclusion wired into Trees');
  assert.match(main, /\['waterTowers',\s*waterTowers\s*&&\s*\{\s*resolve:\s*body\s*=>\s*waterTowers\.resolveSolids\(body\)\s*\}\]/, 'WaterTowers solids wired into siteContacts');
}

const baseHelpers = { WaterTowers, buildWaterTowers, foundationSkirt, waterTowerCanopyExcludes, waterTowerGround, waterTowersForArea };
checkDataAndLand(WATER_TOWERS, baseHelpers);
checkGeometryAndCollisions(baseHelpers);
checkStraitDeduplication(mergeStraitTall);
checkMainWiring();
console.log('PASS water-towers: 28 unique structures (29 area placements), 4 bogus masts removed, slope seating, clearances, solids, canopy/Trees and LOD verified');

if (process.argv.includes('--mutations')) {
  function compileModule(relPath, mutA, mutB) {
    const src = readFileSync(`${root}${relPath}`, 'utf8');
    assert.equal(src.split(mutA).length, 2, `unique mutation target in ${relPath}: ${mutA}`);
    const out = buildSync({
      stdin: { contents: src.replace(mutA, mutB), resolveDir: `${root}web/src`, loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', write: false, external: ['three'],
    }).outputFiles[0].text;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', out)(require, mod, mod.exports);
    return mod.exports;
  }

  const wtMutations = [
    ['ground stretch omitted', 'return base > sea ? sea + (base - sea) * exag : base;', 'return base;', /dry ground stretches by exag/],
    ['plinth floats above ground', 'b.addCylinder(cx, baseY - skirt, cz, rad + plinthPad', 'b.addCylinder(cx, baseY + 0.5, cz, rad + plinthPad', /plinth gap at exag=1|Port Hastings plinth seats skirt below ground/],
    ['fixed 0.7 m skirt fails at exag=3', 'return Math.max(0.75, 0.75 * exag);', 'return 0.7;', /plinth gap at exag=3/],
    ['valve house slab-only gap at exag=3', 'const slabH = skirt + 0.2;', 'const slabH = 0.55;', /valveHouse gap at exag=3/],
    ['canopy exclude disabled', 'if (de * de + dn * dn <= r * r) return true;', 'if (false) return true;', /canopy excluded at ph-pitt-street/],
    ['valve house canopy exclude disabled', 'if (vde * vde + vdn * vdn <= vr * vr) return true;', 'if (false) return true;', /canopy excluded at Pitt St valve house/],
    ['valve house collision axes swapped', 'heading: wide ? Math.PI / 2 - yaw : Math.PI - yaw,', 'heading: yaw,', /valve house (width|depth)/],
    ['valve house corner broadphase clipped', 'pushOut(body, this.solids, true);', 'pushOut(body, this.solids);', /valve house rotated corner pushes car out/],
    ['solids disabled', 'pushOut(body, this.solids, true);', 'void body;', /resolveSolids pushes vehicle out/],
    ['LOW uses desktop segment count', 'const segs = low', 'const segs = false', /LOW phone geometry.*simpler than desktop|LOW triangle ceiling exceeded/],
    ['empty area builds empty mesh', 'if (!specs.length) return null;', 'if (false) return null;', /mabou returns null/],
    ['wrong material side breaks shader sharing', 'side: THREE.DoubleSide', 'side: THREE.FrontSide', /DoubleSide matches buildings material program/],
  ];
  for (const [label, a, b, expectedErr] of wtMutations) {
    if ((label === 'fixed 0.7 m skirt fails at exag=3' || label === 'valve house slab-only gap at exag=3') && !hasLand) continue;
    const m = compileModule('web/src/water-towers.ts', a, b);
    assert.throws(() => {
      checkDataAndLand(WATER_TOWERS, m);
      checkGeometryAndCollisions(m);
    }, { name: 'AssertionError', message: expectedErr }, `mutant survived or failed wrong check: ${label}`);
    console.log(`KILLED ${label}`);
  }

  const straitMut = compileModule(
    'web/src/tall-strait.ts',
    'if (MISCLASSIFIED_WATER_TOWERS.some(([e, n]) => Math.hypot(m.e - e, m.n - n) <= 20)) return false;',
    'if (false) return false;',
  );
  assert.throws(
    () => checkStraitDeduplication(straitMut.mergeStraitTall),
    { name: 'AssertionError', message: /dropped bogus mast/ },
    'mutant survived: water-tower mast filter removed',
  );
  console.log('KILLED water-tower mast filter removed');

  const dataMutants = [
    ['red light added to water tower', arr => { arr[0].nightLight = true; }, /no red night light/],
    ['demolished Tamarac restored', arr => { arr.push({ ...arr[0], id: 'tamarac-ghost', e: 629723.9, n: 5053077.0, g: 58.0 }); }, /pinned 28 unique structure IDs/],
    ...(hasLand ? [['baked ground offset by 2 m', arr => { arr[0].g += 2.0; }, /baked ground mismatch/]] : []),
  ];
  for (const [label, mutate, expectedErr] of dataMutants) {
    const copy = structuredClone(WATER_TOWERS);
    mutate(copy);
    assert.throws(
      () => checkDataAndLand(copy, baseHelpers),
      { name: 'AssertionError', message: expectedErr },
      `mutant survived or failed wrong check: ${label}`,
    );
    console.log(`KILLED ${label}`);
  }
}
