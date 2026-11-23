// Drive the production fixed-step controllers on known profiles without baked land.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { BikeRide } from '../web/src/bike-ride.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { SXS_UTILITY_SPEC, SXS_CREW_SPEC, SXS_CABIN_SPEC } from '../web/src/sxs-variants.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { Towing } from '../web/src/towing.ts';

const dt = 1 / 120;
const coast = { throttle: 0, steer: 0, handbrake: false };
const roads = { nearest: () => null, deckHeight: () => null, roads: [] };
const profiles = {
  flat: () => 0,
  rising: x => x * .2,
  seam: x => x >= 0 ? .41 : 0,
  raisedSeam: x => x >= 0 ? .1 : 0,
  loweredSeam: x => x < 0 ? .12 : 0,
  lip: x => x >= 0 && x < .4 ? .9 : 0,
  crest: x => Math.min(x * .2, 0),
  steep: x => Math.min(x * .32, 0),
  lowDrop: x => x < 0 ? .9 : 0,
  highDrop: x => x < 0 ? 1.8 : 0,
  downhillDrop: x => -.051 * x + (x < 0 ? 2.4 : 0),
  largeCrest: x => Math.min(x * .5, 0),
};

function drive(name, spec, height, speed, { refine = false, push = false } = {}) {
  let offset = 0;
  const ground = (x, z) => height(x, z) + offset;
  const terrain = {
    seaLevel: -100, heightAt: ground, withContactHeight: (_, read) => read(),
    withGroundContact: (_, read) => read(),
    surfaceAt: (x, z) => ({
      ground: ground(x, z), kind: 2, roadDist: 0, halfWidth: 50,
      canopy: 0, level: 8, bridge: false, washboard: false,
    }),
  };
  const node = () => new THREE.Object3D();
  const root = new THREE.Group();
  const v = name === 'bike'
    ? new BikeRide({ root, pose() {}, driverEye: node() }, terrain, roads, -100)
    : new Vehicle({ root, body: node(), brakeLights: [], steer: { fl: node(), fr: node() },
      wheels: { fl: node(), fr: node(), rl: node(), rr: node() } }, terrain, roads, -100, spec);
  assert.ok(v.place(-8, 0, Math.PI / 2));
  const tow = name === 'pickup + trailer' ? new Towing(v, terrain, roads) : null;
  if (tow) assert.ok(tow.attached);
  v.assist = 0;
  v.vx = v.speed = speed;
  const hits = [];
  v.damageActive = true;
  v.damage = { hit: (kind, speed) => hits.push({ kind, speed }), drive() {} };

  let moved = false, takeoff = null, landing = null, trailerAir = false, trailerRise = 0;
  for (let i = 0; i < 750; i++) {
    if (refine && i === 20) offset = 3;
    v.update(dt, coast, () => {
      tow?.step(dt);
      if (tow) { trailerAir ||= tow.airborne; trailerRise = Math.max(trailerRise, tow.vy); }
      if (push && !moved && v.x > 0) { v.z += 1.5; moved = true; }
    });
    if (v.airborne && !takeoff) {
      takeoff = { x: v.x, vx: v.vx, vy: v.vy };
      if (tow) {
        const peak = v.flightPeak;
        const restore = v.checkpointGround();
        v.flightPeak = null;
        restore();
        assert.equal(v.flightPeak, peak, 'trailer rollback preserves the flight peak');
      }
    }
    if (takeoff && !v.airborne) { landing = v.x; break; }
  }
  if (tow) assert.ok(tow.attached);
  return { takeoff, distance: landing === null ? null : landing - takeoff.x, hits, trailerAir, trailerRise };
}

const fleet = [
  ['car', CAR_SPEC], ['bike'], ['side-by-side', SXS_SPEC], ['utility side-by-side', SXS_UTILITY_SPEC],
  ['crew side-by-side', SXS_CREW_SPEC], ['cabin side-by-side', SXS_CABIN_SPEC],
  ['pickup', TRUCK_SPEC], ['pickup + trailer', TRUCK_SPEC],
];
for (const [name, spec] of fleet) {
  for (const profile of ['flat', 'rising', 'seam', 'raisedSeam', 'loweredSeam', 'lip']) {
    const run = drive(name, spec, profiles[profile], 25);
    assert.equal(run.takeoff, null, `${name}: ${profile} must stay grounded`);
    assert.ok(!run.trailerAir && run.trailerRise === 0, `${profile}: trailer stays down with no upward impulse`);
  }
  assert.equal(drive(name, spec, profiles.flat, 25, { refine: true }).takeoff, null, `${name}: a tile rebase stays grounded`);
  assert.equal(drive(name, spec, (_x, z) => z > .75 ? 1.4 : 0, 25, { push: true }).takeoff, null, `${name}: side push stays grounded`);

  const slow = drive(name, spec, profiles.crest, 16);
  const fast = drive(name, spec, profiles.crest, 25);
  const steep = drive(name, spec, profiles.steep, 25);
  for (const [profile, grade, run] of [['slow', .2, slow], ['fast', .2, fast], ['steep', .32, steep]]) {
    assert.ok(run.takeoff && run.distance > .5, `${name}: ${profile} ramp must launch and land: ${JSON.stringify(run)}`);
    // A fixed step can cross the lip before the last approach sample.
    assert.ok(Math.abs(run.takeoff.vy + 9.81 * dt - run.takeoff.vx * grade) < .6, `${name}: ${profile} follows the incoming grade ${JSON.stringify(run.takeoff)}`);
  }
  assert.ok(fast.distance > slow.distance && steep.distance > fast.distance, `${name}: speed and grade increase range`);
  assert.deepEqual(drive(name, spec, profiles.lowDrop, 20).hits, [], `${name}: small drop costs no landing damage`);
  assert.equal(drive(name, spec, profiles.highDrop, 20).hits.filter(hit => hit.kind === 'landing').length, 1, `${name}: large drop reports one landing`);
  assert.ok(drive(name, spec, profiles.downhillDrop, 20).distance > 3, `${name}: a real downhill ledge releases the ride`);
  const slowDrop = drive(name, spec, profiles.highDrop, 2.8);
  assert.ok(slowDrop.takeoff && slowDrop.distance > .3 && slowDrop.takeoff.vy <= 0, `${name}: rolling off a ledge starts a fall`);
  console.log('PASS', name, 'ranges in metres', [slow.distance, fast.distance, steep.distance].map(m => m.toFixed(2)));
}
const largeCrest = drive('car', CAR_SPEC, profiles.largeCrest, 32);
assert.ok(largeCrest.takeoff && largeCrest.takeoff.vy <= Math.sqrt(2 * 9.81 * 3), 'large crest keeps the takeoff limit');
