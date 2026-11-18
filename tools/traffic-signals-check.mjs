import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const require = createRequire(resolve('web/package.json'));
const { build } = require('esbuild');
const temp = mkdtempSync(join(tmpdir(), 'mmm-signals-'));
try {
  const file = join(temp, 'signals.mjs');
  await build({ stdin: { contents: `export * from './traffic-signal-rules'; export * from './traffic-signals'; export { Roads } from './roads'; export * as THREE from 'three';`, resolveDir: resolve('web/src'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent' });
  const { signalLamp, signalStopDistance, SIGNAL_JUNCTIONS, TrafficSignals, DRAW_RANGE, Roads, THREE } = await import(file);
  for (let t = 0; t < 108; t += 0.1) {
    const a = signalLamp(t, 0, 0), b = signalLamp(t, 0, 1);
    assert.ok(a === 'red' || b === 'red', `conflicting traffic at ${t}`);
    assert.equal(signalLamp(t + 54, 0, 0), a);
  }
  for (const [t, a, b] of [[0,'green','red'],[24,'amber','red'],[27,'red','red'],[29,'red','green'],[49,'red','amber'],[52,'red','red']]) {
    assert.equal(signalLamp(t,0,0),a); assert.equal(signalLamp(t,0,1),b);
  }
  const junction = SIGNAL_JUNCTIONS[0], stop = { x: 0, z: 24, dx: 0, dz: 1, halfWidth: 3, phase: 0, junction };
  assert.equal(signalStopDistance([stop], 28, 0, 34, 0, -1), 10);
  assert.equal(signalStopDistance([stop], 28, 0, 24, 0, -1), 0);
  for (const args of [[0,23,0,-1],[10,34,0,-1],[0,34,0,1],[0,110,0,-1]]) assert.equal(signalStopDistance([stop],28,...args),Infinity);
  assert.equal(signalStopDistance([stop],0,0,34,0,-1),Infinity);
  assert.equal(signalStopDistance([stop],24,0,34,0,-1),10);
  const root = 'data/baked/areas/pointtupper/';
  const manifest = JSON.parse(readFileSync(root+'manifest.json'));
  const roadData = JSON.parse(readFileSync(root+'roads.json'));
  let queries = 0;
  const terrain = { cartRoads: false, heightAt: () => { queries++; return 10; } };
  const roads = new Roads(roadData, manifest.village, terrain);
  const signals = new TrafficSignals('pointtupper', manifest.village, roads, terrain, false);
  assert.equal(signals.stops.length,14,'all fourteen approaches must match the baked roads');
  const camera = new THREE.Vector3(0,10,0);
  signals.update(0.01,camera);
  assert.ok(queries <= 14);
  const before = queries;
  for (let i=0;i<20;i++) signals.update(0.01,camera);
  assert.equal(queries,before,'no ground samples each frame');
  signals.update(0,camera,0.6); assert.ok(queries>before,'ground retries while game clock is paused');
  assert.equal(signals.group.children.length,5);
  assert.equal(signals.group.children.reduce((n,m)=>n+m.geometry.index.count/3*m.count,0),924);
  assert.ok(signals.group.children.every(m=>!m.castShadow));
  // Visit each junction so every head takes its ground (heads farther than GROUND_RANGE wait), then judge all fourteen.
  const v = manifest.village, near = j => new THREE.Vector3(j.east - v[0], 10, v[1] - j.north);
  const junctions = SIGNAL_JUNCTIONS.filter(j => j.area === 'pointtupper');
  for (const j of junctions) { signals.update(0, near(j), 0.6); assert.equal(signals.group.visible, true, `${j.id}: drawn near the junction`); }
  const housing = signals.group.children[1], matrix = new THREE.Matrix4(), pole = new THREE.Vector3(), scale = new THREE.Vector3();
  signals.stops.forEach((s, i) => {
    housing.getMatrixAt(i, matrix); scale.setFromMatrixScale(matrix); pole.setFromMatrixPosition(matrix);
    assert.ok(scale.x > 0.5, `head ${i} (${s.junction.id}) placed after a visit`);
    assert.ok(Math.abs(pole.y - (10 + 4.15)) < 1e-4, `head ${i} stands on the sampled ground`);
    assert.ok((s.x - pole.x) * s.dx + (s.z - pole.z) * s.dz > 5, `head ${i}: stop line before the head`);
  });
  // Far from every junction the five meshes (not frustum culled) leave the frame; back near, they return.
  const far = near(junctions[0]).add(new THREE.Vector3(DRAW_RANGE + 2000, 0, 0));
  signals.update(0, far, 0.6); assert.equal(signals.group.visible, false, 'no signal draws far from every junction');
  signals.update(0, near(junctions[0]), 0.6); assert.equal(signals.group.visible, true, 'signals return near a junction');
  // Just inside and just outside the draw range of the nearest head: a wrong range (say 2500 m) fails here.
  for (const [extra, label] of [[-50, 'inside'], [50, 'outside']]) {
    const h = signals.heads[0], spot = new THREE.Vector3(h.x + DRAW_RANGE + extra, 0, h.z);
    const nearest = Math.min(...signals.heads.map(k => Math.hypot(k.x - spot.x, k.z - spot.z)));
    signals.update(0, spot, 0.6);
    assert.equal(signals.group.visible, nearest <= DRAW_RANGE, `cull ${label} the range: nearest head ${nearest.toFixed(0)} m`);
  }
  signals.update(0, near(junctions[0]), 0.6);
  // The lit lamp follows the phase: head 0's lamps must change colour as the cycle moves on.
  const litAt = () => ['red', 'amber', 'green'].filter((_, lamp) => { const c = new THREE.Color(); signals.lamps[lamp].getColorAt(0, c); return c.r + c.g > 0.5; });
  const seen = new Set();
  for (let step = 0; step < 60; step++) {
    signals.update(1, near(junctions[0]), 0);
    const lit = litAt(), want = signalLamp(signals.seconds, signals.heads[0].stop.junction.offset, signals.heads[0].stop.phase);
    assert.deepEqual(lit, [want], `head 0 shows only ${want} at ${signals.seconds.toFixed(1)} s`);
    seen.add(want);
  }
  assert.equal(seen.size, 3, 'head 0 showed red, amber and green within one cycle');
  const historical = new TrafficSignals('pointtupper',manifest.village,roads,terrain,true);
  const other = new TrafficSignals('mabou',manifest.village,roads,terrain,false);
  assert.equal(historical.stops.length,0); assert.equal(other.stops.length,0);
  assert.equal(historical.group.visible,false); assert.equal(other.group.visible,false);
  // main.ts registers and adds the signals only where forArea gives them.
  assert.ok(TrafficSignals.forArea('pointtupper',manifest.village,roads,terrain,false));
  assert.equal(TrafficSignals.forArea('pointtupper',manifest.village,roads,terrain,true),null);
  assert.equal(TrafficSignals.forArea('mabou',manifest.village,roads,terrain,false),null);
  console.log('PASS cycles, clearance, red/amber hook, all 14 baked approaches, all 14 placed past their stop lines, distance cull, bounded samples, 5 draws/924 triangles, era/area gates');
} finally { rmSync(temp,{recursive:true,force:true}); }
