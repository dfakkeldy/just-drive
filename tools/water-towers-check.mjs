#!/usr/bin/env node
// Node + mutation contract checks for municipal water towers, standpipes, reservoirs and small vertical tanks.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { WATER_TOWERS } from '../web/src/water-towers-data.ts';
import {
  WaterTowers, buildWaterTowers, waterTowerCanopyExcludes, waterTowerGround, waterTowersForArea,
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
  assert.ok(specs.length >= 25, `expected all verified water towers and standing small tanks (got ${specs.length})`);
  const ids = new Set();
  for (const t of specs) {
    assert.ok(!ids.has(t.id), `duplicate water tower id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.diameter > 1 && t.diameter <= 20, `${t.id}: diameter out of range (${t.diameter})`);
    assert.ok(t.shellHeight > 2 && t.shellHeight <= 35, `${t.id}: shellHeight out of range (${t.shellHeight})`);
    assert.ok(t.roofHeight > 0 && t.roofHeight <= 5, `${t.id}: roofHeight out of range (${t.roofHeight})`);
    assert.ok(Number.isInteger(t.color) && t.color >= 0 && t.color <= 0xffffff, `${t.id}: invalid hex colour`);
    assert.ok(!t.nightLight, `${t.id}: none of the standing water towers/tanks in these areas carry a red night light`);
    assert.ok(typeof t.source === 'string' && t.source.length > 0, `${t.id}: missing public open-data source`);
    assert.ok(t.areas.length >= 1, `${t.id}: missing areas`);

    for (const area of t.areas) {
      assert.ok(AREAS.includes(area), `${t.id}: unexpected area ${area}`);
      if (!hasLand) continue;
      const m = manifests[area];
      const [w, s, ea, no] = m.mid;
      assert.ok(t.e >= w && t.e <= ea && t.n >= s && t.n <= no, `${t.id} outside ${area} mid box`);

      // Baked terrain elevation match (< 0.15 m).
      const land = lands[area];
      const [VE, VN] = land.village;
      const bakedG = land.ground(t.e - VE, VN - t.n, true);
      assert.ok(bakedG !== null && Math.abs(bakedG - t.g) < 0.15,
        `${t.id} (${area}): baked ground mismatch data=${t.g} baked=${bakedG}`);

      // Road clearance: every structure clears all public roads (kind < 4) by >= 10 m,
      // and clears kind-4 service tracks by >= 5 m except Port Hood's dead-end gravel turnaround loop (road 644).
      const x = t.e - VE, z = VN - t.n, r = t.diameter / 2;
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

  // Key municipal landmarks must be present with expected colours and measured heights.
  const pitt = specs.find(t => t.id === 'ph-pitt-street');
  assert.ok(pitt && pitt.kind === 'standpipe' && pitt.rings === 3 && pitt.balcony && pitt.valveHouse, 'Pitt St cobalt-blue standpipe');
  const pittCol = new THREE.Color(pitt.color);
  assert.ok(pittCol.b > pittCol.r * 2.5, 'Pitt St standpipe must be blue');
  assert.ok(Math.abs(pitt.shellHeight + pitt.roofHeight - 26.5) < 0.2, 'Pitt St total height 26.5 m');
  assert.ok(specs.some(t => t.id === 'port-hastings' && t.areas.includes('pointtupper') && t.areas.includes('cansocauseway')),
    'Port Hastings standpipe present in both pointtupper and cansocauseway');
  assert.ok(specs.some(t => t.id === 'mulgrave-north' && t.kind === 'standpipe'), 'Mulgrave North standpipe present');
  assert.ok(specs.some(t => t.id === 'mulgrave-south' && t.kind === 'reservoir'), 'Mulgrave South concrete reservoir present');
  assert.ok(specs.some(t => t.id === 'port-hood-water' && t.areas.includes('porthood')), 'Port Hood water tank present');

  // Demolished Old Tamarac water tower (629723.9, 5053077.0) must NOT be drawn.
  assert.ok(!specs.some(t => Math.hypot(t.e - 629723.9, t.n - 5053077.0) < 50), 'demolished Tamarac water tower must not be built');

  // Empty areas return null and 0 specs.
  for (const empty of EMPTY_AREAS) {
    assert.equal(helpers.waterTowersForArea(empty).length, 0, `${empty} has no water towers`);
    assert.equal(helpers.WaterTowers.forArea(empty, [624000, 5103000], 1.5, SEA, false), null, `${empty} returns null`);
  }

  // Canopy exclusion: covers all 5 municipal tank centres and Pitt St valve house, leaves clear land untouched.
  for (const id of ['ph-pitt-street', 'port-hastings', 'mulgrave-north', 'mulgrave-south', 'port-hood-water']) {
    const t = specs.find(x => x.id === id);
    assert.equal(helpers.waterTowerCanopyExcludes(t.e, t.n, t.areas[0]), true, `canopy excluded at ${id}`);
    assert.equal(helpers.waterTowerCanopyExcludes(t.e + t.diameter + 10, t.n, t.areas[0]), false, `canopy untouched away from ${id}`);
  }
  assert.equal(helpers.waterTowerCanopyExcludes(624000, 5103000, 'mabou'), false, 'Mabou canopy untouched');

  // Vertical ground stretch matches terrain/buildings.
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

      // Every structure has a solid (plus valve house solid where present) and blocks a vehicle driving into it.
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

  // Verify exact top & bottom world Y of Pitt St and Port Hastings standpipes at exag 1.0 and 1.5.
  const pitt = WATER_TOWERS.find(t => t.id === 'ph-pitt-street');
  const hastings = WATER_TOWERS.find(t => t.id === 'port-hastings');
  const ptVillage = manifests.pointtupper.village;
  for (const exag of [1.0, 1.5]) {
    const built = helpers.buildWaterTowers([pitt], ptVillage, exag, SEA, false);
    assert.equal(built.lights, 0, 'Pitt St has no red night light');
    const bb = built.geometry.boundingBox;
    const baseY = helpers.waterTowerGround(pitt.g, exag, SEA);
    assert.ok(Math.abs(bb.min.y - (baseY - 0.7)) < 0.05, `Pitt St plinth seats 0.7 m below ground (exag=${exag})`);
    assert.ok(bb.max.y >= baseY + 26.5 && bb.max.y <= baseY + 27.5, `Pitt St roof + vent top matches 26.5 m (got ${(bb.max.y - baseY).toFixed(2)})`);
    const spanX = bb.max.x - bb.min.x;
    assert.ok(spanX >= pitt.diameter && spanX <= pitt.diameter + 6.0, `Pitt St width includes tank + valve house (${spanX.toFixed(1)} m)`);
    built.geometry.dispose();

    const hBuilt = helpers.buildWaterTowers([hastings], ptVillage, exag, SEA, false);
    const hBase = helpers.waterTowerGround(hastings.g, exag, SEA);
    assert.ok(Math.abs(hBuilt.geometry.boundingBox.min.y - (hBase - 0.7)) < 0.05, `Port Hastings plinth seats 0.7 m below ground (exag=${exag})`);
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
  assert.match(main, /WaterTowers\.forArea\(AREA\.id,\s*manifest\.village,\s*EXAG,\s*SEA_LEVEL,\s*LOW\)/, 'main constructs WaterTowers in modern era');
  assert.match(main, /ERA\.modern\s*\?\s*WaterTowers\.forArea/, 'modern era gate on WaterTowers');
  assert.match(main, /waterTowers\.excludesCanopy/, 'WaterTowers canopy exclusion wired into terrain');
  assert.match(main, /\['waterTowers',\s*waterTowers\s*&&\s*\{\s*resolve:\s*body\s*=>\s*waterTowers\.resolveSolids\(body\)\s*\}\]/, 'WaterTowers solids wired into siteContacts');
}

const baseHelpers = { WaterTowers, buildWaterTowers, waterTowerCanopyExcludes, waterTowerGround, waterTowersForArea };
checkDataAndLand(WATER_TOWERS, baseHelpers);
checkGeometryAndCollisions(baseHelpers);
checkStraitDeduplication(mergeStraitTall);
checkMainWiring();
console.log('PASS water-towers: 29 standing structures, 4 bogus masts removed, clearances, solids, canopy and LOD verified');

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
    ['ground stretch omitted', 'return base > sea ? sea + (base - sea) * exag : base;', 'return base;'],
    ['plinth floats above ground', 'b.addCylinder(cx, baseY - 0.7, cz, rad + plinthPad', 'b.addCylinder(cx, baseY + 0.5, cz, rad + plinthPad'],
    ['canopy exclude disabled', 'if (de * de + dn * dn <= r * r) return true;', 'if (false) return true;'],
    ['solids disabled', 'pushOut(body, this.solids);', 'void body;'],
    ['LOW uses desktop segment count', 'const segs = low', 'const segs = false'],
    ['empty area builds empty mesh', 'if (!specs.length) return null;', 'if (false) return null;'],
    ['wrong material side breaks shader sharing', 'side: THREE.DoubleSide', 'side: THREE.FrontSide'],
  ];
  for (const [label, a, b] of wtMutations) {
    const m = compileModule('web/src/water-towers.ts', a, b);
    assert.throws(() => {
      checkDataAndLand(WATER_TOWERS, m);
      checkGeometryAndCollisions(m);
    }, { name: 'AssertionError' }, `mutant survived: ${label}`);
    console.log(`KILLED ${label}`);
  }

  const straitMut = compileModule(
    'web/src/tall-strait.ts',
    'if (MISCLASSIFIED_WATER_TOWERS.some(([e, n]) => Math.hypot(m.e - e, m.n - n) <= 20)) return false;',
    'if (false) return false;',
  );
  assert.throws(() => checkStraitDeduplication(straitMut.mergeStraitTall), { name: 'AssertionError' }, 'mutant survived: water-tower mast filter removed');
  console.log('KILLED water-tower mast filter removed');

  // Data mutants: red light added, demolished Tamarac restored, and (when land is present) ground mismatch.
  const dataMutants = [
    ['red light added to water tower', arr => { arr[0].nightLight = true; }],
    ['demolished Tamarac restored', arr => { arr.push({ ...arr[0], id: 'tamarac-ghost', e: 629723.9, n: 5053077.0, g: 58.0 }); }],
    ...(hasLand ? [['baked ground offset by 2 m', arr => { arr[0].g += 2.0; }]] : []),
  ];
  for (const [label, mutate] of dataMutants) {
    const copy = structuredClone(WATER_TOWERS);
    mutate(copy);
    assert.throws(() => checkDataAndLand(copy, baseHelpers), { name: 'AssertionError' }, `mutant survived: ${label}`);
    console.log(`KILLED ${label}`);
  }
}
