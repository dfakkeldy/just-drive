// Node checks for all four generic side-by-side garage models, specs, envelopes, display batches and ?car= links.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import * as THREE from '../web/node_modules/three/build/three.module.js';
const require = createRequire(resolve(process.cwd(), 'web/package.json'));
const ts = require('typescript');
import { createSxs, SXS_SPEC } from '../web/src/sxs.ts';
import {
  createSxsUtility, SXS_UTILITY_SPEC,
  createSxsCrew, SXS_CREW_SPEC,
  createSxsCabin, SXS_CABIN_SPEC,
} from '../web/src/sxs-variants.ts';
import { GARAGE, readVehicle, isDroneVehicle, VEHICLE_KEY } from '../web/src/garage.ts';
import { SXS_KINDS, isSxsKind } from '../web/src/ride-kinds.ts';
import { fleetDisplay, drivableDisplay, isDisplayKind } from '../web/src/fleet-models.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { inspectTruck } from './truck-geometry.mjs';
import { inspectSolids } from './sxs-solids.mjs';
import { posedEnvelopeCoverage } from './sxs-envelope.mjs';

const MODELS = [
  { id: 'sxs', name: 'Side by side: sport', build: createSxs, spec: SXS_SPEC, minTop: 150, maxTop: 162, maxTravel: .24 },
  { id: 'sxs-utility', name: 'Side by side: utility cab', build: createSxsUtility, spec: SXS_UTILITY_SPEC, minTop: 100, maxTop: 118, maxTravel: .17 },
  { id: 'sxs-crew', name: 'Side by side: crew cab', build: createSxsCrew, spec: SXS_CREW_SPEC, minTop: 92, maxTop: 110, maxTravel: .17 },
  { id: 'sxs-cabin', name: 'Side by side: full cabin', build: createSxsCabin, spec: SXS_CABIN_SPEC, minTop: 114, maxTop: 132, maxTravel: .20 },
];

const roads = { roads: [], nearest: () => null, deckHeight: () => null };
const flatGravel = {
  heightAt: () => 0,
  surfaceAt: () => ({ kind: 3, deck: false, ground: 0, roadDist: 0, halfWidth: 10000, canopy: 0, level: 8 }),
  withContactHeight: (_p, f) => f(),
};

function levelTopKmh(spec) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const wheels = Object.fromEntries(['fl', 'fr', 'rl', 'rr'].map(k => [k, new THREE.Group()]));
  const rig = { root, body, wheels, steer: { fl: new THREE.Group(), fr: new THREE.Group() }, driverEye: new THREE.Object3D(), brakeLights: [] };
  const v = new Vehicle(rig, flatGravel, roads, -10000, spec);
  v.assist = 0; v.place(0, 0, 0);
  for (let i = 0; i < 120 * 60; i++) v.update(1 / 120, { throttle: 1, steer: 0, handbrake: false });
  return v.speed * 3.6;
}

const statsById = {};
for (const m of MODELS) {
  assert.ok(isSxsKind(m.id), `${m.id} is an SXS_KIND`);
  const entry = GARAGE.find(g => g.id === m.id);
  assert.ok(entry, `GARAGE includes ${m.id}`);
  assert.equal(entry.name, m.name, `GARAGE name for ${m.id}`);
  assert.equal(entry.spec, m.spec, `GARAGE spec for ${m.id}`);

  const rig = m.build(false, { removableRider: true });
  const lowRig = m.build(false, { low: true, removableRider: true });
  const st = inspectTruck(rig);
  const stLow = inspectTruck(lowRig);
  const solids = inspectSolids(rig);
  const cov = posedEnvelopeCoverage(rig, m.spec);
  const e = m.spec.envelope;
  const frontOver = Math.max(...e.circles) + e.radius + st.bounds.min[2];
  const rearOver = -Math.min(...e.circles) + e.radius - st.bounds.max[2];
  const topKmh = levelTopKmh(m.spec);

  statsById[m.id] = {
    tris: st.triangles, lowTris: stLow.triangles, calls: st.calls, mats: st.materials,
    dims: st.dimensions.map(x => +x.toFixed(3)), minY: +st.bounds.min[1].toFixed(4),
    closed: solids.closed, inward: solids.inward,
    covMiss: cov.misses, covUnres: cov.unresolved, maxOut: +cov.maxVertexOutsideEnvelope.toFixed(4),
    frontOver: +frontOver.toFixed(3), rearOver: +rearOver.toFixed(3),
    topKmh: +topKmh.toFixed(1), mass: m.spec.mass,
  };
  console.log('SXS VARIANT', m.id, JSON.stringify(statsById[m.id]));

  // Budget & soundness
  assert.ok(st.triangles <= 40000, `${m.id} triangles <= 40000 (${st.triangles})`);
  assert.ok(st.calls <= 30, `${m.id} calls <= 30 (${st.calls})`);
  assert.ok(st.materials <= 8, `${m.id} materials <= 8 (${st.materials})`);
  assert.ok(st.finite && st.normals && !st.flat && !st.reversed && !st.twisted, `${m.id} sound geometry`);
  assert.ok(solids.closed > 40 && solids.inward === 0, `${m.id} outward-facing solids (${JSON.stringify(solids)})`);
  assert.ok(Math.abs(st.bounds.min[1]) < .015, `${m.id} sits on ground (minY=${st.bounds.min[1]})`);

  // Wheel pivots and suspension travel
  const halfTrack = m.spec.track / 2, halfBase = m.spec.wheelbase / 2;
  assert.ok(st.pivots.every((p, i) => !p.underBody
    && Math.abs(p.spin[1] - m.spec.wheelRadius) < 1e-6
    && Math.abs(p.axle[2] - (i < 2 ? -halfBase : halfBase)) < 1e-6
    && Math.abs(p.axle[0] - (i % 2 ? halfTrack : -halfTrack)) < 1e-6), `${m.id} wheel pivots`);
  assert.equal(rig.brakeLights.length, 1, `${m.id} has 1 brake light mesh`);
  assert.ok(rig.brakeLights[0].material.emissiveIntensity > 0, `${m.id} brake light emissive`);

  // Envelope coverage & standoff
  assert.equal(cov.misses, 0, `${m.id} envelope misses (${JSON.stringify(cov.examples)})`);
  assert.equal(cov.unresolved, 0, `${m.id} envelope unresolved`);
  assert.ok(cov.maxVertexOutsideEnvelope < .03, `${m.id} max vertex outside envelope (${cov.maxVertexOutsideEnvelope})`);
  assert.ok(frontOver <= .15 + 1e-6, `${m.id} front overreach <= 15 cm (${frontOver})`);
  assert.ok(rearOver <= .15 + 1e-6, `${m.id} rear overreach <= 15 cm (${rearOver})`);

  // Travel deforms wheels and restores neutral
  rig.setTravel(.15, -.12, .10, -.14);
  assert.ok(Math.abs(rig.wheels.fl.parent.position.y - .15) < 1e-6, `${m.id} travel moves fl wheel`);
  assert.ok(Math.abs(rig.wheels.fr.parent.position.y + .12) < 1e-6, `${m.id} travel moves fr wheel`);

  if (m.id !== 'sxs') {
    // Replay checkpointPose() must restore deformed suspension vertex buffers.
    const snap = [];
    rig.root.traverse(o => { if (o.isMesh && o.parent?.name.includes('coil-over')) snap.push([o, Float32Array.from(o.geometry.attributes.position.array)]); });
    assert.ok(snap.length > 0, `${m.id} has deformable suspension meshes`);
    const restore = rig.checkpointPose();
    rig.body.position.y = .09;
    rig.body.rotation.set(.08, 0, -.06);
    rig.setTravel(-m.maxTravel, m.maxTravel, -m.maxTravel, m.maxTravel);
    let maxMoved = 0;
    for (const [o, base] of snap) {
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i++) maxMoved = Math.max(maxMoved, Math.abs(a[i] - base[i]));
    }
    assert.ok(maxMoved > .05, `${m.id} replay pose visibly deforms suspension (${maxMoved})`);
    restore();
    let maxResid = 0;
    for (const [o, base] of snap) {
      const a = o.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i++) maxResid = Math.max(maxResid, Math.abs(a[i] - base[i]));
    }
    assert.ok(maxResid < 1e-6, `${m.id} checkpointPose restores suspension vertices (${maxResid})`);

    // Tyre mesh closure: every wheel mesh must have zero open boundary edges.
    for (const [wName, wGroup] of Object.entries(rig.wheels)) {
      let openEdges = 0;
      wGroup.traverse(o => {
        if (!o.isMesh) return;
        const pos = o.geometry.attributes.position, idx = o.geometry.index;
        const key = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
        const counts = new Map();
        const n = idx ? idx.count : pos.count;
        for (let i = 0; i < n; i += 3) {
          const vs = [idx ? idx.getX(i) : i, idx ? idx.getX(i + 1) : i + 1, idx ? idx.getX(i + 2) : i + 2].map(key);
          for (let e = 0; e < 3; e++) {
            const a = vs[e], b = vs[(e + 1) % 3], k = a < b ? `${a}|${b}` : `${b}|${a}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
        for (const c of counts.values()) if (c === 1) openEdges++;
      });
      assert.equal(openEdges, 0, `${m.id} wheel ${wName} has ${openEdges} open boundary edges`);
    }

    // Tyre-vs-body clearance at rest, full compression, full droop, and full steering lock.
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    rig.setTravel(0, 0, 0, 0);
    rig.root.updateMatrixWorld(true);
    const bodyMeshes = [];
    rig.body.traverse(o => { if (o.isMesh) bodyMeshes.push(o); });
    const savedSides = bodyMeshes.map(bm => bm.material.side);
    for (const bm of bodyMeshes) bm.material.side = THREE.DoubleSide;
    try {
      const ray = new THREE.Raycaster();
      const dir = new THREE.Vector3(0.3713906763541037, 0.5570860145311556, 0.7427813527082074);
      const v = new THREE.Vector3();
      for (const travel of [0, m.maxTravel, -m.maxTravel]) {
        for (const steer of [0, m.spec.maxSteer, -m.spec.maxSteer]) {
          rig.steer.fl.rotation.y = steer;
          rig.steer.fr.rotation.y = steer;
          rig.setTravel(travel, travel, travel, travel);
          rig.root.updateMatrixWorld(true);
          let hits = 0, sample = null;
          for (const [wName, wGroup] of Object.entries(rig.wheels)) {
            wGroup.traverse(o => {
              if (!o.isMesh) return;
              const pos = o.geometry.attributes.position;
              const step = Math.max(1, Math.floor(pos.count / 160));
              for (let i = 0; i < pos.count; i += step) {
                v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
                ray.set(v, dir);
                for (const bm of bodyMeshes) {
                  const isect = ray.intersectObject(bm, false);
                  if (isect.length % 2 === 1) {
                    hits++;
                    sample ??= { wheel: wName, mat: bm.material.name, v: v.toArray().map(n => +n.toFixed(3)) };
                    break;
                  }
                }
              }
            });
          }
          assert.equal(hits, 0, `${m.id} tyre vertices inside bodywork at travel=${travel} steer=${steer}: ${hits} (${JSON.stringify(sample)})`);
        }
      }
    } finally {
      bodyMeshes.forEach((bm, i) => { bm.material.side = savedSides[i]; });
      rig.steer.fl.rotation.y = 0;
      rig.steer.fr.rotation.y = 0;
    }

    // Enclosed cab side-window coverage: zero slits along the raked A-pillar or top sash on either side.
    rig.root.updateMatrixWorld(true);
    const doorRay = new THREE.Raycaster();
    const glazeMeshes = bodyMeshes.filter(bm => bm.material.name === 'Cab glazing' || bm.material.name === 'Satin cab trim');
    const winBounds = m.id === 'sxs-utility'
      ? { wsBot: -.76, wsTop: -.48, rear: .40, yBot: 1.20, yTop: 1.85 }
      : m.id === 'sxs-crew'
      ? { wsBot: -1.12, wsTop: -.84, rear: -.16, yBot: 1.22, yTop: 1.89 }
      : { wsBot: -1.06, wsTop: -.76, rear: -.08, yBot: 1.21, yTop: 1.87 };
    for (const side of [-1, 1]) {
      const originX = side * 1.4, dirX = -side;
      for (let yi = 0; yi <= 10; yi++) {
        const y = winBounds.yBot + (winBounds.yTop - winBounds.yBot) * (yi / 10);
        const t = (y - winBounds.yBot) / (winBounds.yTop - winBounds.yBot);
        const zFront = winBounds.wsBot + (winBounds.wsTop - winBounds.wsBot) * t;
        for (const z of [zFront + .005, zFront + .015, zFront + .04, (zFront + winBounds.rear) / 2, winBounds.rear]) {
          doorRay.set(new THREE.Vector3(originX, y, z), new THREE.Vector3(dirX, 0, 0));
          const hit = doorRay.intersectObjects(glazeMeshes, false).find(h => h.distance < .78);
          assert.ok(hit, `${m.id} side=${side} front-door window has open slit at y=${y.toFixed(3)} z=${z.toFixed(3)}`);
        }
      }
      if (m.id === 'sxs-cabin') {
        for (const [y, z] of [[1.842, -.744], [1.85, -.4]]) {
          doorRay.set(new THREE.Vector3(originX, y, z), new THREE.Vector3(dirX, 0, 0));
          const hit = doorRay.intersectObjects(glazeMeshes, false).find(h => h.distance < .78);
          assert.ok(hit, `sxs-cabin side=${side} upper seam slit at y=${y} z=${z}`);
        }
      }
    }
  }
  rig.setTravel(0, 0, 0, 0);
  assert.equal(rig.wheels.fl.parent.position.y, 0, `${m.id} travel restores neutral`);

  // Top speed within target band
  assert.ok(topKmh >= m.minTop && topKmh <= m.maxTop, `${m.id} gravel top ${topKmh.toFixed(1)} km/h in [${m.minTop}, ${m.maxTop}]`);

  // Display batches for LOW / AI
  assert.ok(isDisplayKind(m.id), `${m.id} is a display kind`);
  const parked = fleetDisplay(m.id), drivable = drivableDisplay(m.id);
  const drawCount = r => { let d = 0; r.root.traverseVisible(o => { if (o.isMesh) d++; }); return d; };
  assert.equal(drawCount(parked), 5, `${m.id} parked display = 5 draws`);
  assert.equal(drawCount(drivable), 5, `${m.id} drivable display = 5 draws`);
}

// Physical differentiation across the 4 models: sport is lightest & fastest; crew cab is heaviest & longest wheelbase.
assert.ok(SXS_SPEC.mass < SXS_UTILITY_SPEC.mass && SXS_UTILITY_SPEC.mass < SXS_CABIN_SPEC.mass && SXS_CABIN_SPEC.mass < SXS_CREW_SPEC.mass, 'mass ordering');
assert.ok(SXS_CREW_SPEC.wheelbase > SXS_UTILITY_SPEC.wheelbase && SXS_CABIN_SPEC.wheelbase > SXS_UTILITY_SPEC.wheelbase, '4-seat wheelbase longer than 2-seat utility');
assert.ok(statsById.sxs.topKmh > statsById['sxs-cabin'].topKmh && statsById['sxs-cabin'].topKmh > statsById['sxs-utility'].topKmh && statsById['sxs-utility'].topKmh > statsById['sxs-crew'].topKmh, 'top speed ordering');

// Saved games and ?vehicle= / ?car= link compatibility
for (const id of SXS_KINDS) {
  assert.equal(readVehicle(new URLSearchParams(`vehicle=${id}`)).id, id, `?vehicle=${id}`);
  assert.equal(readVehicle(new URLSearchParams(`car=${id}`)).id, id, `?car=${id}`);
  assert.equal(readVehicle(new URLSearchParams(), true, () => ({ getItem: k => k === VEHICLE_KEY ? id : null })).id, id, `saved ${id} in explore`);
  assert.equal(isDroneVehicle(new URLSearchParams(`car=${id}`), true, () => ({ getItem: () => 'drone' })), false, `?car=${id} overrides saved drone`);
}
// ?vehicle= wins over ?car= when both exist
assert.equal(readVehicle(new URLSearchParams('vehicle=sxs-crew&car=sxs')).id, 'sxs-crew', '?vehicle= wins over ?car=');
// Unknown ?car= falls back cleanly to mail car
assert.equal(readVehicle(new URLSearchParams('car=unknown')).id, 'car', 'unknown ?car= falls back to car');

// Zero-allocation hot path check on sxs-variants.ts
const srcText = readFileSync(resolve(process.cwd(), 'web/src/sxs-variants.ts'), 'utf8');
const src = ts.createSourceFile('web/src/sxs-variants.ts', srcText, ts.ScriptTarget.Latest, true);
const hot = new Set(['setTravel', 'updateTravelNormals']);
let allocations = 0;
const walk = n => {
  if ((ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name && hot.has(n.name.getText(src))) {
    const visit = x => {
      if (ts.isNewExpression(x) || ts.isArrayLiteralExpression(x) || ts.isObjectLiteralExpression(x)
        || ts.isArrowFunction(x) || ts.isFunctionExpression(x) || ts.isFunctionDeclaration(x)) allocations++;
      ts.forEachChild(x, visit);
    };
    if (n.body) visit(n.body);
  } else ts.forEachChild(n, walk);
};
walk(src);
assert.equal(allocations, 0, `sxs-variants.ts hot path has ${allocations} allocations`);
const trailing = srcText.split('\n').flatMap((line, i) => /[\t ]+$/.test(line) ? [i + 1] : []);
assert.deepEqual(trailing, [], 'sxs-variants.ts has no trailing whitespace');

console.log('PASS all four side-by-side variants: geometry, solids, envelopes, physics, display batches and ?car= links');
