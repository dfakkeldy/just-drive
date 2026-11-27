// Roadside woods (canopy > 1.6) slow motor vehicles to ~1 km/h instead of stopping them dead.
// Players can crawl forward or reverse back out without resetting; solid obstacles still block.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { BRUSH_CRAWL_SPEED, Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { SXS_UTILITY_SPEC, SXS_CREW_SPEC, SXS_CABIN_SPEC } from '../web/src/sxs-variants.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { HORSE_SPEC } from '../web/src/horse.ts';
import { horseSpeedLimit } from '../web/src/horse-motion.ts';
import { BikeRide } from '../web/src/bike-ride.ts';
import { Towing } from '../web/src/towing.ts';
import { Damage } from '../web/src/damage-rules.ts';
import { Ruts } from '../web/src/ruts.ts';
import { pushOut } from '../web/src/parked.ts';

const dt = 1 / 120;
const KMH = 3.6;
const roads = { nearest: () => null, deckHeight: () => null, roads: [] };
const node = () => new THREE.Object3D();

function makeTerrain({ canopy = () => 8, height = () => 0, roadDist = () => 20 } = {}) {
  return {
    seaLevel: -100,
    heightAt: height,
    meshHeightAt: height,
    withContactHeight: (_, read) => read(),
    withGroundContact: (_, read) => read(),
    surfaceAt: (x, z) => ({
      ground: height(x, z),
      kind: 0,
      roadDist: roadDist(x, z),
      halfWidth: 3.5,
      canopy: canopy(x, z),
      level: 8,
      bridge: false,
      washboard: false,
    }),
  };
}

function makeVehicle(spec, terrain, { x = 0, z = 0, heading = Math.PI / 2, trailer = false } = {}) {
  const root = new THREE.Group();
  const rig = {
    root,
    body: node(),
    driverEye: node(),
    brakeLights: [],
    steer: { fl: node(), fr: node() },
    wheels: { fl: node(), fr: node(), rl: node(), rr: node() },
  };
  const v = new Vehicle(rig, terrain, roads, -100, spec);
  assert.ok(v.place(x, z, heading), 'vehicle placement must succeed');
  const tow = trailer ? new Towing(v, terrain, roads) : null;
  if (tow) assert.ok(tow.attached, 'trailer must attach');
  v.assist = 0;
  return { v, tow };
}

function step(v, tow, seconds, input, after) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    v.update(dt, input, () => {
      tow?.step(dt);
      after?.(i);
    });
  }
}

assert.ok(Math.abs(BRUSH_CRAWL_SPEED * KMH - 1) < 1e-9, 'BRUSH_CRAWL_SPEED must be 1 km/h');

// 1. Every motor vehicle pushed into woods at 50 km/h slows down and keeps moving at ~1 km/h (never stops dead).
const motors = [
  ['car', CAR_SPEC, false],
  ['side-by-side', SXS_SPEC, false],
  ['utility side-by-side', SXS_UTILITY_SPEC, false],
  ['crew side-by-side', SXS_CREW_SPEC, false],
  ['cabin side-by-side', SXS_CABIN_SPEC, false],
  ['pickup', TRUCK_SPEC, false],
  ['pickup + trailer', TRUCK_SPEC, true],
];

for (const [name, spec, trailer] of motors) {
  // High-speed entry (50 km/h) with throttle held.
  const entry = makeVehicle(spec, makeTerrain(), { trailer });
  entry.v.vx = entry.v.speed = 50 / KMH;
  if (entry.tow) { entry.tow.vx = 50 / KMH; entry.tow.speed = 50 / KMH; }
  let minSpeedAfterEntry = Infinity;
  step(entry.v, entry.tow, 4, { throttle: 1, steer: 0, handbrake: false }, () => {
    minSpeedAfterEntry = Math.min(minSpeedAfterEntry, entry.v.speed);
  });
  const entryKmh = entry.v.speed * KMH;
  assert.equal(entry.v.surfaceName, 'brush', `${name}: woods must resolve to brush`);
  assert.ok(minSpeedAfterEntry * KMH >= 0.85, `${name}: must not stop dead after fast entry (min ${(minSpeedAfterEntry * KMH).toFixed(2)} km/h)`);
  assert.ok(entryKmh >= 0.9 && entryKmh <= 1.05, `${name}: steady woods crawl must be ~1 km/h (got ${entryKmh.toFixed(3)} km/h)`);

  // From rest in woods: forward throttle, reverse throttle, and clean stop when released.
  const rest = makeVehicle(spec, makeTerrain(), { trailer });
  const x0 = rest.v.x;
  step(rest.v, rest.tow, 3, { throttle: 1, steer: 0, handbrake: false });
  const fwdKmh = rest.v.speed * KMH;
  assert.ok(fwdKmh >= 0.9 && fwdKmh <= 1.05, `${name}: forward from rest must crawl at ~1 km/h (got ${fwdKmh.toFixed(3)} km/h)`);
  assert.ok(rest.v.x - x0 > 0.6, `${name}: forward crawl must cover ground (${(rest.v.x - x0).toFixed(2)} m)`);

  const xPeak = rest.v.x;
  step(rest.v, rest.tow, 3, { throttle: -1, steer: 0, handbrake: false });
  const revKmh = rest.v.speed * KMH;
  assert.ok(revKmh <= -0.9 && revKmh >= -1.05, `${name}: reverse from woods must crawl at ~-1 km/h (got ${revKmh.toFixed(3)} km/h)`);
  assert.ok(xPeak - rest.v.x > 0.6, `${name}: reverse crawl must back out (${(xPeak - rest.v.x).toFixed(2)} m)`);

  step(rest.v, rest.tow, 2, { throttle: 0, steer: 0, handbrake: false });
  assert.equal(rest.v.speed, 0, `${name}: releasing throttle in woods must come to a clean stop`);

  // 10% uphill bank in woods: still able to crawl forward and reverse up.
  const uphill = makeVehicle(spec, makeTerrain({ height: x => x * 0.1 }), { trailer });
  step(uphill.v, uphill.tow, 3, { throttle: 1, steer: 0, handbrake: false });
  const upKmh = uphill.v.speed * KMH;
  assert.ok(upKmh >= 0.85 && upKmh <= 1.05, `${name}: 10% uphill crawl must hold ~1 km/h (got ${upKmh.toFixed(3)} km/h)`);

  // 10% uphill in reverse (car faces downhill, backs up the slope).
  const revUphill = makeVehicle(spec, makeTerrain({ height: x => -x * 0.1 }), { trailer });
  step(revUphill.v, revUphill.tow, 3, { throttle: -1, steer: 0, handbrake: false });
  const revUpKmh = revUphill.v.speed * KMH;
  assert.ok(revUpKmh <= -0.85 && revUpKmh >= -1.05, `${name}: 10% uphill reverse must hold ~-1 km/h (got ${revUpKmh.toFixed(3)} km/h)`);

  // 20% downhill bank in woods: brush still caps speed near ~1 km/h.
  const downhill = makeVehicle(spec, makeTerrain({ height: x => -x * 0.2 }), { trailer });
  step(downhill.v, downhill.tow, 3, { throttle: 1, steer: 0, handbrake: false });
  const downKmh = downhill.v.speed * KMH;
  assert.ok(downKmh >= 0.9 && downKmh <= 1.15, `${name}: 20% downhill crawl must stay near ~1 km/h (got ${downKmh.toFixed(3)} km/h)`);

  console.log('PASS', name, `entry=${entryKmh.toFixed(2)} fwd=${fwdKmh.toFixed(2)} rev=${revKmh.toFixed(2)} up=${upKmh.toFixed(2)} revUp=${revUpKmh.toFixed(2)} down=${downKmh.toFixed(2)} km/h`);
}

// 2. Drive into roadside woods, reverse out AND steer forward out onto open grass, regaining normal speed without resetting.
{
  const strip = makeTerrain({ canopy: x => (x > 2 ? 8 : 0) });
  const { v } = makeVehicle(CAR_SPEC, strip, { x: 0, z: 0, heading: Math.PI / 2 });
  v.vx = v.speed = 40 / KMH;
  step(v, null, 3, { throttle: 1, steer: 0, handbrake: false });
  assert.ok(v.x > 4 && v.surfaceName === 'brush', `car must enter woods (x=${v.x.toFixed(2)}, surf=${v.surfaceName})`);
  assert.ok(v.speed * KMH >= 0.9 && v.speed * KMH <= 1.05, `car must crawl in woods (${(v.speed * KMH).toFixed(2)} km/h)`);

  // Steering in woods turns the car cleanly while crawling forward.
  const headingBefore = v.heading;
  step(v, null, 4, { throttle: 1, steer: -1, handbrake: false });
  assert.ok(Math.abs(v.heading - headingBefore) > 0.2, `car must steer while crawling in woods (delta=${Math.abs(v.heading - headingBefore).toFixed(2)} rad)`);

  // Reverse straight back out of the woods without ever calling respawn.
  v.heading = Math.PI / 2;
  v.vx = v.vz = v.speed = 0;
  let escaped = false;
  for (let sec = 0; sec < 60; sec++) {
    step(v, null, 1, { throttle: -1, steer: 0, handbrake: false });
    if (v.x < 1.5 && v.surfaceName === 'grass') { escaped = true; break; }
  }
  assert.ok(escaped, `car must reverse out of woods without reset (ended at x=${v.x.toFixed(2)}, surf=${v.surfaceName})`);
  // Forward back on grass resumes normal speed (heading west into open x < 2).
  v.heading = -Math.PI / 2;
  v.vx = v.vz = v.speed = 0;
  step(v, null, 3, { throttle: 1, steer: 0, handbrake: false });
  assert.ok(v.speed * KMH > 20, `car must regain normal speed after leaving woods (got ${(v.speed * KMH).toFixed(1)} km/h)`);
  console.log('PASS exit-woods', `escaped at x=${v.x.toFixed(2)}, regained ${(v.speed * KMH).toFixed(1)} km/h`);
}

// 2b. Braking during high-speed woods entry still brakes harder than coasting, and drifting into woods settles to crawl.
{
  const coastCar = makeVehicle(CAR_SPEC, makeTerrain());
  const brakeCar = makeVehicle(CAR_SPEC, makeTerrain());
  coastCar.v.vx = coastCar.v.speed = 50 / KMH;
  brakeCar.v.vx = brakeCar.v.speed = 50 / KMH;
  step(coastCar.v, null, 0.5, { throttle: 1, steer: 0, handbrake: false });
  step(brakeCar.v, null, 0.5, { throttle: -1, steer: 0, handbrake: false });
  assert.ok(brakeCar.v.speed < coastCar.v.speed - 1, `braking at high speed in woods must decelerate faster than throttle (${brakeCar.v.speed.toFixed(2)} vs ${coastCar.v.speed.toFixed(2)} m/s)`);

  // Drift off gravel into dense woods: drift finishes and settles smoothly to ~1 km/h crawl.
  const gravelToWoods = makeTerrain({ canopy: x => (x > 12 ? 8 : 0), roadDist: x => (x > 12 ? 20 : 0) });
  gravelToWoods.surfaceAt = (x, z) => ({
    ground: 0,
    kind: x > 12 ? 0 : 3,
    roadDist: x > 12 ? 20 : 0,
    halfWidth: 5,
    canopy: x > 12 ? 8 : 0,
    level: 8,
    bridge: false,
    washboard: false,
    gravel: x <= 12,
  });
  const { v: drifter } = makeVehicle(CAR_SPEC, gravelToWoods, { x: 0, z: 0, heading: Math.PI / 2 });
  drifter.vx = drifter.speed = 45 / KMH;
  step(drifter, null, 0.35, { throttle: 1, steer: 1, handbrake: true });
  assert.ok(drifter.drift.active, 'setup must enter a real gravel drift before hitting woods');
  let minDriftExitKmh = Infinity;
  step(drifter, null, 5, { throttle: 1, steer: 0, handbrake: false }, () => {
    if (drifter.surfaceName === 'brush') minDriftExitKmh = Math.min(minDriftExitKmh, drifter.speed * KMH);
  });
  assert.equal(drifter.surfaceName, 'brush', 'drifter must reach woods');
  assert.ok(!drifter.drift.active, 'woods must end the drift');
  assert.ok(minDriftExitKmh >= 0.85, `drifting into woods must not stop dead (min ${minDriftExitKmh.toFixed(2)} km/h)`);
  assert.ok(drifter.speed * KMH >= 0.9 && drifter.speed * KMH <= 1.05, `post-drift woods crawl must hold ~1 km/h (got ${(drifter.speed * KMH).toFixed(2)} km/h)`);
  console.log('PASS brake-and-drift', `brake=${(brakeCar.v.speed * KMH).toFixed(1)} vs coast=${(coastCar.v.speed * KMH).toFixed(1)} km/h, driftExit=${(drifter.speed * KMH).toFixed(2)} km/h`);
}

// 3. Solid obstacles (buildings, poles, parked cars, etc.) inside or beside woods stay solid.
{
  const { v } = makeVehicle(CAR_SPEC, makeTerrain(), { x: 0, z: 0, heading: Math.PI / 2 });
  const wall = [{ x: 4, z: 0, half: 0.5, halfWidth: 3, heading: Math.PI / 2 }];
  let impacts = 0;
  v.onSolidImpact = () => { impacts++; };
  step(v, null, 10, { throttle: 1, steer: 0, handbrake: false }, () => {
    pushOut(v, wall);
  });
  const noseX = v.x + Math.max(...CAR_SPEC.envelope.circles) + CAR_SPEC.envelope.radius;
  assert.ok(noseX <= 3.55, `solid obstacle must stop car in woods (nose x=${noseX.toFixed(2)} vs wall x=3.5)`);
  assert.ok(impacts > 0, 'solid obstacle must register contact');
  console.log('PASS solid-in-woods', `nose=${noseX.toFixed(2)} impacts=${impacts}`);
}

// 4. Crawling in woods causes zero damage and zero lawn ruts/complaints.
{
  const t = makeTerrain();
  const { v } = makeVehicle(CAR_SPEC, t, { x: 0, z: 0, heading: Math.PI / 2 });
  const dmg = new Damage();
  v.damageActive = true;
  v.damage = dmg;
  let lawnCalls = 0;
  const ruts = new Ruts(t, [{ id: 1, kind: 'house', x: 5, y: 0 }], [0, 0], false, () => { lawnCalls++; });
  step(v, null, 15, { throttle: 1, steer: 0, handbrake: false }, i => {
    if (i % 2 === 0) ruts.update(v, i * dt);
  });
  assert.equal(dmg.total, 0, `woods crawl must incur $0 repair damage (got $${dmg.total})`);
  assert.equal(ruts.count, 0, `woods crawl must leave 0 lawn ruts (got ${ruts.count})`);
  assert.equal(lawnCalls, 0, `woods crawl must trigger 0 lawn complaints (got ${lawnCalls})`);
  console.log('PASS woods-scoring', 'damage=$0 ruts=0 complaints=0');
}

// 5. Horse and dirt bike keep their own brush speeds untouched.
{
  const t = makeTerrain();
  const { v: horse } = makeVehicle(HORSE_SPEC, t, { x: 0, z: 0, heading: Math.PI / 2 });
  step(horse, null, 8, { throttle: 1, steer: 0, handbrake: false });
  const expectedHorse = horseSpeedLimit('brush', 0);
  assert.ok(Math.abs(horse.speed - expectedHorse) < 0.05, `horse must keep its brush pace ${expectedHorse.toFixed(2)} m/s (got ${horse.speed.toFixed(2)})`);

  const bike = new BikeRide({ root: new THREE.Group(), pose() {}, driverEye: node() }, t, roads, -100);
  assert.ok(bike.place(0, 0, Math.PI / 2));
  step(bike, null, 8, { throttle: 1, steer: 0, handbrake: false });
  assert.ok(bike.speed * KMH > 30, `dirt bike must keep its Sugar Camp brush pace (got ${(bike.speed * KMH).toFixed(1)} km/h)`);
  console.log('PASS horse-and-bike', `horse=${(horse.speed * KMH).toFixed(1)} km/h bike=${(bike.speed * KMH).toFixed(1)} km/h`);
}
