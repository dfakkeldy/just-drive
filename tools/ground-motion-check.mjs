// Drive the production fixed-step controllers on known profiles without baked land.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { BikeRide } from '../web/src/bike-ride.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { Towing } from '../web/src/towing.ts';

const dt = 1 / 120;
const coast = { throttle: 0, steer: 0, handbrake: false };
const roads = { nearest: () => null, deckHeight: () => null, roads: [] };
const profiles = {
  flat: () => 0,
  rising: x => x * .2,
  seam: x => x >= 0 ? .41 : 0,
  lip: x => x >= 0 && x < .4 ? .9 : 0,
  crest: x => Math.min(x * .2, 0),
  steep: x => Math.min(x * .32, 0),
  lowDrop: x => x < 0 ? .9 : 0,
  highDrop: x => x < 0 ? 1.8 : 0,
};

function drive(name, spec, height, speed, { refine = false, push = false } = {}) {
  let offset = 0;
  const ground = (x, z) => height(x, z) + offset;
  const terrain = {
    seaLevel: -100, heightAt: ground, withContactHeight: (_, read) => read(),
    withGroundContact: (_, read) => read(),
    surfaceAt: (x, z) => ({
      ground: ground(x, z), kind: 9, roadDist: 0, halfWidth: 50,
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

  let moved = false, takeoff = null, landing = null;
  for (let i = 0; i < 500; i++) {
    if (refine && i === 20) offset = 3;
    v.update(dt, coast, () => {
      tow?.step(dt);
      if (push && !moved && v.x > 0) { v.z += 1.5; moved = true; }
    });
    if (v.airborne && !takeoff) takeoff = { x: v.x, vx: v.vx, vy: v.vy };
    if (takeoff && !v.airborne) { landing = v.x; break; }
  }
  if (tow) assert.ok(tow.attached);
  return { takeoff, distance: landing === null ? null : landing - takeoff.x, hits };
}

for (const [name, spec] of [['car', CAR_SPEC], ['bike'], ['side-by-side', SXS_SPEC], ['pickup', TRUCK_SPEC], ['pickup + trailer', TRUCK_SPEC]]) {
  for (const profile of ['flat', 'rising', 'seam', 'lip']) {
    assert.equal(drive(name, spec, profiles[profile], 25).takeoff, null, `${name}: ${profile} must stay grounded`);
  }
  assert.equal(drive(name, spec, profiles.flat, 25, { refine: true }).takeoff, null, `${name}: a tile rebase stays grounded`);
  assert.equal(drive(name, spec, (_x, z) => z > .75 ? 1.4 : 0, 25, { push: true }).takeoff, null, `${name}: side push stays grounded`);

  const slow = drive(name, spec, profiles.crest, 16);
  const fast = drive(name, spec, profiles.crest, 25);
  const steep = drive(name, spec, profiles.steep, 25);
  for (const [profile, grade, run] of [['slow', .2, slow], ['fast', .2, fast], ['steep', .32, steep]]) {
    assert.ok(run.takeoff && run.distance > .5, `${name}: ${profile} ramp must launch and land: ${JSON.stringify(run)}`);
    assert.ok(Math.abs(run.takeoff.vy + 9.81 * dt - run.takeoff.vx * grade) < .35, `${name}: ${profile} follows the incoming grade`);
  }
  assert.ok(fast.distance > slow.distance && steep.distance > fast.distance, `${name}: speed and grade increase range`);
  assert.deepEqual(drive(name, spec, profiles.lowDrop, 20).hits, [], `${name}: small drop costs no landing damage`);
  assert.equal(drive(name, spec, profiles.highDrop, 20).hits.filter(hit => hit.kind === 'landing').length, 1, `${name}: large drop reports one landing`);
  console.log('PASS', name, 'ranges in metres', [slow.distance, fast.distance, steep.distance].map(m => m.toFixed(2)));
}
