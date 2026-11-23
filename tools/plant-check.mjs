// Bundle with web/node_modules/.bin/esbuild, then run with Node (tools/check-plant.sh). No browser or map fetches.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {
  craneX, hotSpotState, PLANT_DOOR_RADIUS, PLANT_GOAL_Z, PLANT_HALF_WIDTH,
  PLANT_MAX_INTEGRITY, PLANT_TIME_LIMIT, plantBonus, plantLayout, PlantRun, plantScore,
} from '../web/src/plant-rules.ts';
import { YardSite } from '../web/src/yard-site.ts';
import { Interiors } from '../web/src/interiors.ts';
import { Shift } from '../web/src/shift.ts';
import { nextCareer, freshCareer } from '../web/src/shift-rules.ts';
import { Roads } from '../web/src/roads.ts';

const step = 1 / 60;

// 1. Seeded daily layouts are deterministic and vary across days.
assert.deepEqual(plantLayout(17), plantLayout(17), 'same day keeps the same plant layout');
assert.notDeepEqual(plantLayout(17), plantLayout(18), 'different days change the plant layout');
const layout1 = plantLayout(1);
assert.ok(layout1.conveyors.length >= 6, 'plant has multiple conveyors');
assert.ok(layout1.hotSpots.length >= 12, 'plant has multiple hot floor grates');
assert.ok(layout1.cranes.length >= 5, 'plant has multiple moving cranes');

// 2. Careful carrier agent completes a clean run in 1-2 minutes across multiple seeded days.
function carefulInput(run) {
  const belt = run.conveyorAt(run.x, run.z);
  let targetX = run.x;
  let forward = 1;

  // Find the closest upcoming hot-spot row and closest upcoming crane.
  const aheadSpots = run.layout.hotSpots.filter(s => s.z + s.halfZ + 0.35 > run.z);
  const nextSpotZ = aheadSpots.length ? Math.min(...aheadSpots.map(s => s.z)) : Infinity;
  const nextCrane = run.layout.cranes.find(c => c.z + c.halfZ + 0.55 > run.z) ?? null;
  const nextCraneZ = nextCrane ? nextCrane.z : Infinity;

  // Prefer the forward boost lane in Bay 1's split longitudinal conveyor when clear.
  if (run.z > 34 && run.z < 43) {
    const boost = run.layout.conveyors.find(c => c.vz > 0);
    if (boost) targetX = (boost.x0 + boost.x1) / 2;
  } else if (nextSpotZ < nextCraneZ && nextSpotZ - run.z < 7.5) {
    const row = aheadSpots.filter(s => Math.abs(s.z - nextSpotZ) < 1.5);
    const maxHalfZ = Math.max(...row.map(s => s.halfZ));
    const dangerAt = (x, lookAhead) => row.some(s => {
      if (Math.abs(x - s.x) >= s.halfX + 0.42) return false;
      for (let dt = 0; dt <= lookAhead; dt += 0.2) {
        if (hotSpotState(s, run.elapsed + dt).state === 'hot') return true;
      }
      return false;
    });
    // Cross through the center of a cool grate (or the gap on 2-grate rows).
    const lanes = [...new Set([...row.map(s => s.x), 0])].sort((a, b) => Math.abs(a - run.x) - Math.abs(b - run.x));
    const safe = lanes.find(lx => !dangerAt(lx, 2.3));
    if (safe !== undefined) targetX = safe;
    const clearBefore = (nextSpotZ - maxHalfZ - 0.55) - run.z;
    if (clearBefore < 0.9 && clearBefore > -0.15 && (dangerAt(run.x, 2.1) || Math.abs(run.x - targetX) > 0.35)) {
      forward = 0;
    }
  } else if (nextCrane && nextCraneZ - run.z < 7.5) {
    const blocked = (x) => {
      for (let dt = 0; dt <= 1.05; dt += 0.15) {
        if (Math.abs(x - craneX(nextCrane, run.elapsed + dt)) < nextCrane.halfX + 0.62) return true;
      }
      return false;
    };
    // Stick to the nearer outer lane (wide-open window every cycle, no oscillation).
    targetX = run.x <= 0 ? -5.5 : 5.5;
    const clearBefore = (nextCrane.z - nextCrane.halfZ - 0.65) - run.z;
    if (clearBefore < 0.9 && clearBefore > -0.15 && (blocked(run.x) || Math.abs(run.x - targetX) > 0.45)) {
      forward = 0;
    }
  }

  const dx = targetX - run.x;
  const counter = -belt.vx / 3.15;
  const side = Math.max(-1, Math.min(1, dx * 1.6 + counter));
  return { forward, side };
}

for (const day of [1, 2, 3, 17, 90]) {
  const run = new PlantRun(day);
  for (let i = 0; i < 60 * 140 && !run.result; i++) run.update(step, carefulInput(run));
  assert.equal(run.result?.delivered, true, `careful day ${day} delivers`);
  assert.equal(run.hits, 0, `careful day ${day} takes zero hits`);
  assert.equal(run.integrity, PLANT_MAX_INTEGRITY);
  assert.ok(run.elapsed >= 45 && run.elapsed <= 105, `day ${day} clean run takes about 1 minute: ${run.elapsed.toFixed(1)}s`);
  assert.ok((run.result.score ?? 0) >= 1200, `day ${day} high score: ${run.result.score}`);
  assert.equal(run.result.bonus, 40, `day ${day} earns top $40 shift tip`);
}

// 3. Conveyors push idle player and can be counter-steered.
{
  const run = new PlantRun(1);
  const cross = run.layout.conveyors[0];
  run.x = 0;
  run.z = (cross.z0 + cross.z1) / 2;
  run.update(1.0, { forward: 0, side: 0 });
  assert.equal(Math.sign(run.x), Math.sign(cross.vx), 'cross-conveyor carries an idle player in its belt direction');
  assert.ok(Math.abs(run.x) > 1.5, 'conveyor drift is noticeable');
  const pushedX = run.x;
  run.update(1.0, { forward: 0, side: -Math.sign(cross.vx) });
  assert.ok(Math.abs(run.x) < Math.abs(pushedX), 'counter-steering overcomes the cross-conveyor');
}

// 4. Hot spots warn before heating and ruin the parcel after 3 hits.
{
  const run = new PlantRun(1);
  const spot = run.layout.hotSpots[0];
  // Advance to a hot moment of spot 0.
  let hotAt = 0;
  while (hotSpotState(spot, hotAt).state !== 'hot' && hotAt < 20) hotAt += 0.05;
  assert.equal(hotSpotState(spot, hotAt).state, 'hot', 'hot spot enters hot phase');
  assert.equal(hotSpotState(spot, hotAt - 0.5).state, 'warn', 'hot spot warns before erupting');

  for (let hit = 1; hit <= PLANT_MAX_INTEGRITY; hit++) {
    run.invuln = 0;
    run.stagger = 0;
    run.elapsed = hotAt;
    run.x = spot.x;
    run.z = spot.z;
    run.update(step, { forward: 0, side: 0 });
    assert.equal(run.hits, hit, `hit ${hit} recorded`);
    assert.equal(run.integrity, PLANT_MAX_INTEGRITY - hit);
    assert.equal(run.lastHazard, 'hotSpot');
  }
  assert.equal(run.phase, 'ruined', 'third hit ruins the parcel');
  run.update(3.0, { forward: 0, side: 0 });
  assert.equal(run.result?.delivered, false, 'ruined parcel finishes as a loss');
  assert.match(run.result?.note ?? '', /ruined/i);
}

// 5. Overhead moving crane beam hits the player when overlapping.
{
  const run = new PlantRun(2);
  const crane = run.layout.cranes[0];
  run.elapsed = 1.0;
  run.x = craneX(crane, run.elapsed);
  run.z = crane.z;
  run.update(step, { forward: 0, side: 0 });
  assert.equal(run.hits, 1);
  assert.equal(run.lastHazard, 'crane');
  assert.equal(run.integrity, 2);
}

// 6. Time limit ends the run as a loss.
{
  const run = new PlantRun(3);
  run.update(PLANT_TIME_LIMIT + 0.1, { forward: 0, side: 0 });
  assert.equal(run.phase, 'timeout');
  run.update(3.0, { forward: 0, side: 0 });
  assert.equal(run.result?.delivered, false);
  assert.match(run.result?.note ?? '', /shutter closed/i);
}

// 7. Leaving early loses; leaving after reaching dispatch preserves win & bonus; finished fade-out keeps terminal score/message.
{
  const early = new PlantRun(4);
  early.leave();
  assert.equal(early.result?.delivered, false);
  assert.equal(early.score, 0, 'early leave keeps zero score during fade-out');
  assert.match(early.message, /Left the shop floor/, 'early leave keeps terminal message during fade-out');

  const won = new PlantRun(4);
  won.invuln = 1.0; // crossing finish line while invuln must clear invuln cleanly
  for (let i = 0; i < 60 * 140 && won.phase === 'running'; i++) won.update(step, carefulInput(won));
  assert.equal(won.phase, 'delivered');
  assert.equal(won.invuln, 0, 'delivery clears invuln so parcel cannot freeze red');
  won.leave();
  assert.equal(won.result?.delivered, true, 'leaving during celebration keeps delivery');
  assert.equal(won.result?.bonus, 40, 'leaving during celebration keeps bonus');
  assert.equal(won.score, won.finalScore, 'finished win keeps final score during fade-out');
  assert.match(won.message, /Delivered to Dispatch/, 'finished win keeps win message during fade-out');
}

// 8. Scoring and bonus tiers.
assert.equal(plantBonus(1300), 40);
assert.equal(plantBonus(1000), 30);
assert.equal(plantBonus(800), 20);
assert.equal(plantBonus(600), 15);
assert.ok(plantScore(65, 3, 0) > plantScore(90, 2, 1));
assert.equal(nextCareer(freshCareer(), 'clear', 0, 40).pay, 385, 'nextCareer adds indoor bonus to shift pay');

// 9. Scene build, draw calls, shadows, inward-facing rays, door reach, and Shift bonus integration.
const pen = new Proxy({}, {
  get: (_, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop() {} })
    : key === 'measureText' ? () => ({ width: 120 }) : () => {},
  set: () => true,
});
const elements = new Map();
class Element {
  hidden = false; textContent = ''; children = []; listeners = new Map(); scrollTop = 0; width = 160; height = 90;
  style = { values: new Map(), setProperty(k, v) { this.values.set(k, v); }, removeProperty(k) { this.values.delete(k); } };
  names = new Set(); classList = { add: c => this.names.add(c), remove: c => this.names.delete(c) };
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  after() {}
  append(...nodes) { this.children.push(...nodes); for (const n of nodes) if (n.id) elements.set(n.id, n); }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {} click() { this.listeners.get('click')?.(); }
  getContext() { return pen; }
}
globalThis.document = {
  head: new Element(),
  body: new Element(),
  createElement() { return new Element(); },
  getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('No storage'); } });

const { PlantInterior, plantDoor } = await import('../web/src/interior-plant.ts');
const plant = new PlantInterior(1);
plant.scene.updateMatrixWorld(true);
assert.ok(plant.parts.drawCalls <= 18, `plant draw calls <= 18: got ${plant.parts.drawCalls}`);
assert.ok(plant.parts.triangles > 500 && plant.parts.triangles < 20000, `plant triangles reasonable: ${plant.parts.triangles}`);
plant.scene.traverse(o => {
  if (o.isMesh) { assert.equal(o.castShadow, false); assert.equal(o.receiveShadow, false); }
  if (o.isLight) assert.ok(!o.castShadow, 'no light casts a shadow');
});
const ray = new THREE.Raycaster();
const cast = (from, dir) => { ray.set(new THREE.Vector3(...from), new THREE.Vector3(...dir).normalize()); ray.far = 40; return ray.intersectObjects(plant.scene.children, true)[0]; };
assert.ok(cast([0, 2, -20], [0, -1, 0])?.distance < 2.1, 'floor faces upward');
assert.ok(cast([0, 2, -20], [0, 1, 0])?.distance < 7.0, 'roof faces downward');
assert.ok(cast([0, 2, -20], [-1, 0, 0])?.distance < 10.0, 'left wall faces inward');
assert.ok(cast([0, 2, -20], [1, 0, 0])?.distance < 10.0, 'right wall faces inward');
assert.ok(cast([0, 2, -PLANT_GOAL_Z], [0, 0, -1])?.distance < 10.0, 'far wall faces inward');
plant.update(0, { throttle: 0, steer: 0, handbrake: false, touch: true });
assert.match(plant.readout, /WALK \/ BACK/, 'touch hint shows on phone');
plant.update(0, { throttle: 0, steer: 0, handbrake: false, touch: false });
assert.match(plant.readout, /W\/S/, 'keyboard hint shows on desktop');
// Crossing the finish line and entering 'finished' keeps camera inside Dispatch Cage and parcel on counter.
plant.run.z = PLANT_GOAL_Z - 0.1;
plant.update(0.3, { throttle: 1, steer: 0, handbrake: false });
assert.equal(plant.run.phase, 'delivered');
const winCamZ = plant.camera.position.z;
plant.leave();
plant.update(0.016, { throttle: 0, steer: 0, handbrake: false });
assert.equal(plant.run.phase, 'finished');
assert.equal(plant.camera.position.z, winCamZ, 'camera stays in Dispatch Cage during win fade-out');
plant.dispose();
assert.equal(plant.scene.children.length, 0, 'dispose releases scene');

// Door geometry at Harbour Ridge Works Yard.
const village = [624271, 5103301];
const yardSite = new YardSite(village, 'invented');
const door = plantDoor(yardSite);
assert.equal(door.id, 'plant');
assert.equal(door.radius, PLANT_DOOR_RADIUS);
const staffLotCar = yardSite.world(6, -22);
const highwayCar = yardSite.world(44, -82);
assert.ok(Math.hypot(staffLotCar.x - door.position.x, staffLotCar.z - door.position.z) < door.radius, 'reachable from staff lot');
assert.ok(Math.hypot(highwayCar.x - door.position.x, highwayCar.z - door.position.z) > door.radius, 'not reachable from Highway 19');

// Interiors + Shift end-to-end receipt, bonus pay, duplicate protection, and reset.
const flatTerrain = { heightAt: () => 0, surfaceAt: () => ({ ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }) };
const stubRoads = new Roads({ roads: [{ id: 1, name: 'Highway 19', kind: 1, halfWidth: 4, bridge: false, pts: [[0, 0], [500, 0]] }] }, [0, 0], flatTerrain);
const stubMail = { delivered: 0, lawn: 0, ditch: 0, down: 0, reset() {} };
const shift = new Shift(null, stubMail, stubRoads, flatTerrain, [], village, true, new URLSearchParams('day=1'), () => {});
const doors = new Interiors(() => shift.career.day, () => '10:05', r => shift.interiorResult(r));
doors.register(door);
doors.update(0.1, { throttle: 0, steer: 0, handbrake: false }, { x: staffLotCar.x, z: staffLotCar.z, speed: 0 }, true);
assert.equal(elements.get('doorPrompt').hidden, false, 'prompt appears when stopped at Harbour Ridge Shop');
doors.enter();
assert.ok(globalThis.document.body.names.has('indoorOn') && globalThis.document.body.names.has('indoorGo'), 'indoor phone controls enable WALK pedal');
assert.equal(globalThis.document.body.style.values.get('--indoor-go'), '"WALK"');
assert.equal(globalThis.document.body.style.values.get('--indoor-steer'), '"SIDE"');
// Complete the run via the real PlantInterior inside Interiors.
doors.update(0.41, { throttle: 0, steer: 0, handbrake: false }, { x: staffLotCar.x, z: staffLotCar.z, speed: 0 }, false);
const active = doors.game;
for (let i = 0; i < 60 * 140 && !active.result; i++) {
  const inp = carefulInput(active.run);
  doors.update(step, { throttle: inp.forward, steer: inp.side, handbrake: false }, { x: staffLotCar.x, z: staffLotCar.z, speed: 0 }, false);
}
doors.update(0.41, { throttle: 0, steer: 0, handbrake: false }, { x: staffLotCar.x, z: staffLotCar.z, speed: 0 }, false);
assert.equal(doors.busy, false, 'returned to car after crossing the plant');
assert.equal(shift.indoorParcels, 1);
assert.equal(shift.indoorBonus, 40);
assert.match(elements.get('stopHint').textContent, /\+\$40 bonus/);
// Duplicate receipt cannot double the bonus.
shift.interiorResult({ door, result: { delivered: true, bonus: 40, score: 1300, note: 'dup' } });
assert.equal(shift.indoorBonus, 40, 'duplicate receipt ignored');
shift.end();
const stats = elements.get('reportStats').children;
const bonusIdx = stats.findIndex(el => el.textContent === 'Indoor bonus');
assert.ok(bonusIdx >= 0 && stats[bonusIdx + 1].textContent === '$40', 'shift report lists Indoor bonus $40');
const dayPayIdx = stats.findIndex(el => el.textContent === 'Day pay');
assert.equal(stats[dayPayIdx + 1].textContent, '$385', 'day pay includes $40 plant tip');
elements.get('startOver').click();
assert.equal(shift.indoorBonus, 0, 'startOver resets indoorBonus');

console.log(`PASS: steel plant rules (5 clean 1-min runs, conveyors, hot spots, cranes, timeout, ruin, walk-out); scene ${plant.parts.triangles} tris in ${plant.parts.drawCalls} draws; door at Harbour Ridge Shop; Shift +$40 bonus and report.`);
