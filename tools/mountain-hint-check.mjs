// River Denys Mountain Road side-by-side hint and safe in-place vehicle switch.
// Run: node tools/run-node-check.mjs tools/mountain-hint-check.mjs
// The baked Judique road assertions run when data/baked/areas/judique/roads.json exists and SKIP cleanly in CI.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {
  DEFAULT_SXS_ID,
  MOUNTAIN_HINT_DURATION,
  MOUNTAIN_HINT_TEXT,
  MOUNTAIN_ROAD_NAME,
  MountainApproach,
  MountainHintState,
  defaultSideBySideId,
  isMountainHintEligibleRide,
  isSideBySideId,
  mountainSwitchLabel,
  safeSwapRide,
} from '../web/src/mountain-hint-rules.ts';
import { GARAGE } from '../web/src/garage.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { TRUCK_SPEC, createTruck } from '../web/src/truck.ts';
import { Towing } from '../web/src/towing.ts';
import { Fleet } from '../web/src/fleet.ts';
import { AreaContacts } from '../web/src/world-contacts.ts';
import { pushOut } from '../web/src/parked.ts';
import { CHURCH_ORIGIN, CHURCH_START } from '../web/src/church-site.ts';
import { ROUGH_STRETCHES } from '../web/src/rough-roads.ts';
import { Roads } from '../web/src/roads.ts';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// 1. Copy, device labels, ride eligibility and default side-by-side target.
ok(MOUNTAIN_HINT_TEXT === 'Rough road ahead: the side-by-side handles it better', 'exact hint wording');
ok(mountainSwitchLabel('touch') === 'Switch to side-by-side', 'touch switch label');
ok(mountainSwitchLabel('keyboard') === 'Switch to side-by-side · Enter', 'keyboard switch label');
ok(mountainSwitchLabel('gamepad') === 'Switch to side-by-side · Y / Triangle', 'gamepad switch label');

ok(isMountainHintEligibleRide('car'), 'car is eligible');
ok(isMountainHintEligibleRide('truck'), 'pickup is eligible');
for (const excluded of ['sxs', 'sxs-utility', 'sxs_sport', 'horse', 'bike', 'drone', '']) {
  ok(!isMountainHintEligibleRide(excluded), `${excluded || '(empty)'} is excluded`);
}
ok(isSideBySideId('sxs') && isSideBySideId('sxs-crew') && !isSideBySideId('car') && !isSideBySideId('truck'), 'side-by-side id matcher');
const targetId = defaultSideBySideId(GARAGE);
ok(targetId === DEFAULT_SXS_ID && GARAGE.some(e => e.id === targetId), `default side-by-side id resolves in GARAGE (${targetId})`);
ok(defaultSideBySideId([{ id: 'car' }, { id: 'sxs-utility' }, { id: 'sxs-sport' }]) === 'sxs-utility', 'lineup fallback picks first side-by-side when sxs is absent');

// 2. Synthetic road network: River Denys Mountain Road climbing north from Highway 105 to the church.
function makeSynthRoads() {
  const village = [631000, 5078000];
  const toWorld = ([e, n]) => [e - village[0], village[1] - n];
  const church = [631000, 5080500];
  const hwyPts = [];
  for (let e = 630000; e <= 632000; e += 20) hwyPts.push(toWorld([e, 5076500]));
  const mtnPts = [];
  for (let n = 5076500; n <= 5080350; n += 25) mtnPts.push(toWorld([631000, n]));
  const hwy = { id: 1, name: 'Highway 105', kind: 2, halfWidth: 4, bridge: false, pts: hwyPts };
  const mtn = { id: 2, name: MOUNTAIN_ROAD_NAME, kind: 4, halfWidth: 1.5, bridge: false, pts: mtnPts };
  const roads = [hwy, mtn];
  const nearest = (x, z, reach = 60, filter) => {
    let best = null;
    for (const road of roads) {
      if (filter && !filter(road)) continue;
      for (let s = 0; s < road.pts.length - 1; s++) {
        const [ax, az] = road.pts[s], [bx, bz] = road.pts[s + 1];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d <= reach && (!best || d < best.dist)) best = { road, dist: d, x: px, z: pz, heading: Math.atan2(dx, -dz), seg: s, t };
      }
    }
    return best;
  };
  return { village, church, toWorld, roads: { roads, nearest } };
}

{
  const { village, church, toWorld, roads } = makeSynthRoads();
  const approach = new MountainApproach(roads, village, church);
  ok(approach.size === 1, 'approach resolves River Denys Mountain Road');

  const [footX, footZ] = toWorld([631000, 5076540]);
  const [hwyX, hwyZ] = toWorld([630700, 5076500]);
  const [nearChurchX, nearChurchZ] = toWorld([631000, 5080340]);

  ok(approach.isDrivingTowardChurch({ x: footX, z: footZ, heading: 0, speed: 5 }), 'fires heading north toward church at the foot');
  ok(!approach.isDrivingTowardChurch({ x: footX, z: footZ, heading: Math.PI, speed: 5 }), 'does not fire heading south away from church');
  ok(!approach.isDrivingTowardChurch({ x: footX, z: footZ, heading: 0, speed: 0.1 }), 'does not fire while stopped');
  ok(!approach.isDrivingTowardChurch({ x: hwyX, z: hwyZ, heading: Math.PI / 2, speed: 15 }), 'does not fire on Highway 105');
  ok(!approach.isDrivingTowardChurch({ x: nearChurchX, z: nearChurchZ, heading: 0, speed: 5 }), 'does not fire right at the church');
  ok(!approach.outsideChurchClearance({ x: nearChurchX, z: nearChurchZ }), 'near-church position is inside clearance');

  // Hint fires ONCE per visit at the road, never a second time after dismiss or timeout.
  const state = new MountainHintState();
  const onApproach = approach.isDrivingTowardChurch({ x: footX, z: footZ, heading: 0, speed: 5 });
  ok(state.update(0.1, { active: true, rideKind: 'car', onApproach, airborne: false, sunk: false, outsideChurch: true }), 'hint fires on first entry in car');
  ok(state.shown && state.visible, 'state marks shown and visible');
  state.dismiss();
  ok(!state.visible && state.shown, 'dismiss hides hint while keeping shown=true');
  ok(!state.update(0.1, { active: true, rideKind: 'car', onApproach: true, airborne: false, sunk: false, outsideChurch: true }), 'does not fire a second time in the same visit after dismiss');

  // Entering the church clearance (e.g. via Places jump) auto-dismisses an active hint so it cannot switch at the church.
  const jumped = new MountainHintState();
  ok(jumped.update(0.1, { active: true, rideKind: 'car', onApproach: true, airborne: false, sunk: false, outsideChurch: true }), 'hint opens at road foot');
  ok(!jumped.update(0.1, { active: true, rideKind: 'car', onApproach: false, airborne: false, sunk: false, outsideChurch: false }), 'hint clears immediately inside church clearance');
  ok(!jumped.visible && jumped.shown, 'cleared hint stays hidden and does not refire');

  // Timeout hides the hint and still prevents refiring.
  const timed = new MountainHintState();
  ok(timed.update(0.1, { active: true, rideKind: 'truck', onApproach: true, airborne: false, sunk: false, outsideChurch: true }), 'hint fires in pickup');
  ok(timed.update(MOUNTAIN_HINT_DURATION / 2, { active: true, rideKind: 'truck', onApproach: true, airborne: false, sunk: false, outsideChurch: true }), 'stays visible mid-window');
  ok(!timed.update(MOUNTAIN_HINT_DURATION, { active: true, rideKind: 'truck', onApproach: true, airborne: false, sunk: false, outsideChurch: true }), 'auto-hides after duration');
  ok(!timed.update(0.1, { active: true, rideKind: 'truck', onApproach: true, airborne: false, sunk: false, outsideChurch: true }), 'never fires again after timeout');

  // Never fires in excluded rides (sxs, horse, bike, drone).
  for (const rideKind of ['sxs', 'horse', 'bike', 'drone']) {
    const excluded = new MountainHintState();
    ok(!excluded.update(0.1, { active: true, rideKind, onApproach: true, airborne: false, sunk: false, outsideChurch: true }), `never fires while in ${rideKind}`);
    ok(!excluded.shown && !excluded.visible, `${rideKind} leaves shown=false`);
  }
}

// 3. Safe in-place switch on real Vehicle (car -> sxs and truck -> sxs): stops first, keeps exact position and heading.
function makeRig() {
  const n = () => new THREE.Object3D();
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  return { root, body, wheels: { fl: n(), fr: n(), rl: n(), rr: n() }, steer: { fl: n(), fr: n() }, driverEye: n(), brakeLights: [] };
}
function makeFlatTerrain(ground = 42, loaded = () => true, slopeX = 0.04) {
  const surface = (x, z) => loaded(x, z)
    ? { ground: ground + x * slopeX, canopy: 0, roadDist: Math.abs(z), halfWidth: 2.6, kind: 3, level: 8, washboard: false, gravel: true, rough: false, water: false, bridge: false, deck: false }
    : null;
  return {
    seaLevel: -0.2,
    cartRoads: false,
    sites: [],
    withContactHeight(_body, read) { return read(); },
    withGroundContact(_body, read) { return read(); },
    heightAt(x, z) { const s = surface(x, z); return s ? s.ground : null; },
    meshHeightAt(x, z) { const s = surface(x, z); return s ? s.ground : null; },
    surfaceAt: surface,
    coverAt: () => 0,
    waterAt: () => false,
  };
}
function makeStraightRoads() {
  const road = { id: 1, name: MOUNTAIN_ROAD_NAME, kind: 3, halfWidth: 2.6, bridge: false, pts: [[-100, 0], [500, 0]] };
  return {
    roads: [road],
    deckHeight: () => null,
    nearest(x, z, reach = 60, filter) {
      if (filter && !filter(road)) return null;
      const cx = Math.max(-100, Math.min(500, x)), dist = Math.hypot(x - cx, z);
      if (dist > reach) return null;
      return { road, seg: 0, t: (cx + 100) / 600, dist, x: cx, z: 0, heading: Math.PI / 2 };
    },
  };
}

for (const [label, fromSpec] of [['car', CAR_SPEC], ['truck', TRUCK_SPEC]]) {
  const terrain = makeFlatTerrain(42);
  const roads = makeStraightRoads();
  const current = new Vehicle(makeRig(), terrain, roads, -0.2, fromSpec);
  current.assist = 0;
  current.bounds = [-200, -200, 600, 200];
  ok(current.place(25, 0.3, 1.35), `${label} places on sloped road`);
  for (let i = 0; i < 90; i++) current.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
  ok(current.speed > 4, `${label} is moving before swap (speed=${current.speed.toFixed(2)} m/s)`);
  const beforeX = current.x, beforeZ = current.z, beforeHeading = current.heading;

  const swapped = safeSwapRide(current, () => {
    const next = new Vehicle(makeRig(), terrain, roads, -0.2, SXS_SPEC);
    next.assist = 0;
    next.bounds = current.bounds;
    return next;
  });
  ok(swapped.ok, `${label} -> sxs swap succeeds`);
  ok(current.speed === 0 && current.vx === 0 && current.vz === 0, `${label} is stopped before swap`);
  const next = swapped.vehicle;
  ok(Math.abs(next.x - beforeX) < 1e-6 && Math.abs(next.z - beforeZ) < 1e-6, `${label} -> sxs keeps exact position (${next.x.toFixed(3)}, ${next.z.toFixed(3)})`);
  ok(Math.abs(next.heading - beforeHeading) < 1e-6, `${label} -> sxs keeps exact heading`);
  ok(next.speed === 0 && next.vx === 0 && next.vz === 0, `${label} -> sxs starts stopped`);
  const expectedGround = terrain.heightAt(next.x, next.z);
  ok(expectedGround !== null && Math.abs(next.y - expectedGround) < 0.15, `${label} -> sxs sits on top of sloped ground (y=${next.y.toFixed(2)} ground=${expectedGround.toFixed(2)})`);

  const xStart = next.x;
  for (let i = 0; i < 60; i++) next.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
  ok(next.x > xStart + 2 && next.speed > 4, `${label} -> sxs drives forward cleanly after swap`);
}

// 4. Failed swaps restore the old ride's velocity cleanly and never throw.
{
  const terrain = makeFlatTerrain(42);
  const roads = makeStraightRoads();
  const airCar = new Vehicle(makeRig(), terrain, roads, -0.2, CAR_SPEC);
  airCar.place(10, 0, Math.PI / 2);
  airCar.airborne = true; airCar.vx = 8; airCar.speed = 8;
  const airRes = safeSwapRide(airCar, () => new Vehicle(makeRig(), terrain, roads, -0.2, SXS_SPEC));
  ok(!airRes.ok && airRes.reason.length > 0 && airCar.speed === 8, 'refuses swap while airborne and preserves speed');

  const wetCar = new Vehicle(makeRig(), terrain, roads, -0.2, CAR_SPEC);
  wetCar.place(10, 0, Math.PI / 2);
  wetCar.sunk = 0.2; wetCar.vx = 3; wetCar.speed = 3;
  const wetRes = safeSwapRide(wetCar, () => new Vehicle(makeRig(), terrain, roads, -0.2, SXS_SPEC));
  ok(!wetRes.ok && wetCar.speed === 3, 'refuses swap while in water and preserves speed');

  const voidTerrain = makeFlatTerrain(42, () => false);
  const car = new Vehicle(makeRig(), terrain, roads, -0.2, CAR_SPEC);
  car.place(10, 0, Math.PI / 2);
  car.vx = 7; car.speed = 7;
  const voidRes = safeSwapRide(
    car,
    () => new Vehicle(makeRig(), voidTerrain, roads, -0.2, SXS_SPEC),
    pose => voidTerrain.heightAt(pose.x, pose.z) !== null,
  );
  ok(!voidRes.ok && car.speed === 7 && car.vx === 7, 'refuses swap on unloaded ground and preserves velocity');

  // Placement guard rejection restores current ride velocity.
  const guardedCar = new Vehicle(makeRig(), terrain, roads, -0.2, CAR_SPEC);
  guardedCar.place(10, 0, Math.PI / 2);
  guardedCar.vx = 9; guardedCar.vz = 1; guardedCar.speed = 9;
  const guardRes = safeSwapRide(guardedCar, () => {
    const next = new Vehicle(makeRig(), terrain, roads, -0.2, SXS_SPEC);
    next.placementGuard = () => false;
    return next;
  });
  ok(!guardRes.ok && guardedCar.vx === 9 && guardedCar.vz === 1 && guardedCar.speed === 9,
    'placement refusal restores old ride velocity');

  // Construction exception is caught and restores old ride velocity without throwing.
  const crashCar = new Vehicle(makeRig(), terrain, roads, -0.2, CAR_SPEC);
  crashCar.place(10, 0, Math.PI / 2);
  crashCar.vx = 6; crashCar.speed = 6;
  const crashRes = safeSwapRide(crashCar, () => { throw new Error('boom'); });
  ok(!crashRes.ok && crashRes.reason.length > 0 && crashCar.vx === 6 && crashCar.speed === 6,
    'builder error returns failure reason and restores old ride velocity');

  // Target footprint overlapping a nearby solid (clear for CAR_SPEC, blocked for SXS_SPEC) refuses swap cleanly.
  const tightCar = new Vehicle(makeRig(), terrain, roads, -0.2, CAR_SPEC);
  tightCar.place(20, 0, Math.PI / 2);
  tightCar.vx = 5; tightCar.speed = 5;
  const contacts = new AreaContacts();
  const nearbySolid = [{ x: 20, z: 1.55, half: 1.5, halfWidth: 0.5, heading: Math.PI / 2 }];
  contacts.add({ resolve: body => pushOut(body, nearbySolid, true) });
  ok(contacts.allows({ x: 20, z: 0, y: 42, heading: Math.PI / 2, spec: CAR_SPEC }), 'car clears nearby solid before swap');
  ok(!contacts.allows({ x: 20, z: 0, y: 42, heading: Math.PI / 2, spec: SXS_SPEC }), 'wider/different sxs footprint hits nearby solid');
  const blockedRes = safeSwapRide(
    tightCar,
    () => new Vehicle(makeRig(), terrain, roads, -0.2, SXS_SPEC),
    pose => contacts.allows({ ...pose, y: 42, spec: SXS_SPEC }) ? true : 'No clear room to switch here',
  );
  ok(!blockedRes.ok && blockedRes.reason === 'No clear room to switch here' && tightCar.vx === 5 && tightCar.speed === 5,
    'solo swap refuses when target sxs footprint overlaps a solid and preserves car velocity');
}

// 5. Empty-trailer Towing cleanHooks() excludes trailer guards/onPlaced and detach() clears towLoad cleanly.
{
  const terrain = makeFlatTerrain(42, () => true, 0);
  const roads = makeStraightRoads();
  const truck = new Vehicle(createTruck(false, true), terrain, roads, -0.2, TRUCK_SPEC);
  truck.assist = 0;
  let priorGuardCalls = 0, priorPlacedCalls = 0;
  const priorGuard = () => { priorGuardCalls++; return true; };
  const priorPlaced = () => { priorPlacedCalls++; };
  truck.placementGuard = priorGuard;
  truck.onPlaced = priorPlaced;
  truck.place(30, 0, Math.PI / 2);
  const tow = new Towing(truck, terrain, roads, false, false, {}, true, true);
  ok(tow.attached && truck.placementGuard !== priorGuard && truck.onPlaced !== priorPlaced, 'towing installed its own guard and onPlaced');
  const clean = tow.cleanHooks();
  ok(clean.placementGuard === priorGuard && clean.onPlaced === priorPlaced, 'cleanHooks exposes pre-towing guard and onPlaced');
  const swapped = safeSwapRide(truck, () => {
    const next = new Vehicle(makeRig(), terrain, roads, -0.2, SXS_SPEC);
    next.placementGuard = clean.placementGuard;
    next.onPlaced = clean.onPlaced;
    return next;
  });
  ok(swapped.ok, 'empty-trailer truck swaps cleanly to sxs');
  tow.detach();
  ok(!tow.attached && truck.towLoad === null && swapped.vehicle.placementGuard === priorGuard && swapped.vehicle.onPlaced === priorPlaced,
    'detached towing leaves no trailer guard or onPlaced on swapped sxs');
  ok(Math.abs(swapped.vehicle.x - 30) < 1e-6 && Math.abs(swapped.vehicle.z) < 1e-6 && Math.abs(swapped.vehicle.heading - Math.PI / 2) < 1e-6,
    'empty-trailer swap keeps exact position and heading without trailer placement shift');
}

// 6. Fleet switchToMember('sxs') preserves the session, truck, trailer and fleet state; enforces 6 m parked reach,
//    catches thrown ramp/ground queries, and restores pickup velocity/handbrake + notifies onSettled on mid-unload abort.
{
  // 6a. Level road: unloads sxs, returns pending: true, and fires onSettled(true) only after sxs takes the wheel.
  const terrain = makeFlatTerrain(42, () => true, 0);
  const roads = makeStraightRoads();
  const truck = new Vehicle(createTruck(false, true), terrain, roads, -0.2, TRUCK_SPEC);
  truck.assist = 0; truck.bounds = [-200, -200, 600, 200];
  truck.place(40, 0, Math.PI / 2);
  const tow = new Towing(truck, terrain, roads, true, false, {}, true, true);
  const scene = new THREE.Scene();
  scene.add(truck.car.root, tow.trailer.root);
  let selectedId = 'truck';
  const fleet = new Fleet(truck, tow, terrain, roads, scene, true, m => { selectedId = m.id; }, -0.2);
  ok(fleet.members.length === 3 && fleet.driven.id === 'truck', 'fleet boots with truck, sxs and bike');
  fleet.handbrake = false; truck.vx = 3; truck.speed = 3;
  const settled = [];
  const res = fleet.switchToMember('sxs', (success, reason) => settled.push({ success, reason }));
  ok(res.ok && res.pending === true && fleet.busy, 'fleet switchToMember starts pending unload transition without reloading');
  ok(settled.length === 0, 'onSettled does not fire before unload finishes');
  for (let i = 0; i < 600 && fleet.busy; i++) {
    fleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => fleet.resolve());
    fleet.refresh(1 / 60);
  }
  ok(!fleet.busy && fleet.driven.id === 'sxs' && selectedId === 'sxs', `fleet handoff completes directly into sxs (driven=${fleet.driven.id})`);
  ok(settled.length === 1 && settled[0].success === true, 'onSettled(true) fires once unload hands control to sxs');
  ok(fleet.members.some(m => m.id === 'truck' && m.state === 'PARKED') && tow.attached, 'truck and trailer remain intact in the fleet session');

  // 6b. Parked sxs reach check: driving truck > 6 m away refuses handoff and keeps truck moving; within 6 m succeeds.
  // Switch back to truck while right next to it, fold ramps, and drive the truck 35 m away from the parked sxs.
  fleet.refresh(1 / 60);
  const truckIdx = fleet.actions.findIndex(a => a.kind === 'drive' && a.id === 'truck');
  ok(truckIdx >= 0, 'truck drive action is available while next to trailer');
  fleet.actionIndex = truckIdx;
  ok(fleet.activate(), 'handoff back to truck succeeds');
  for (let i = 0; i < 200 && fleet.busy; i++) {
    fleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => fleet.resolve());
    fleet.refresh(1 / 60);
  }
  ok(!fleet.busy && fleet.driven.id === 'truck', 'back in truck with sxs parked behind');
  // While still within 6 m of parked sxs, switchToMember('sxs') hands off synchronously.
  const nearRes = fleet.switchToMember('sxs');
  ok(nearRes.ok && !nearRes.pending && fleet.driven.id === 'sxs', 'parked sxs within 6 m switches synchronously');
  for (let i = 0; i < 200 && fleet.busy; i++) {
    fleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => fleet.resolve());
    fleet.refresh(1 / 60);
  }
  fleet.refresh(1 / 60);
  fleet.actionIndex = fleet.actions.findIndex(a => a.kind === 'drive' && a.id === 'truck');
  ok(fleet.actionIndex >= 0 && fleet.activate(), 'back to truck for far-reach check');
  for (let i = 0; i < 200 && fleet.busy; i++) {
    fleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => fleet.resolve());
    fleet.refresh(1 / 60);
  }
  // Drive truck far forward (gates auto-fold when throttling forward).
  fleet.handbrake = false;
  for (let i = 0; i < 420; i++) {
    fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
    fleet.refresh(1 / 60);
  }
  const sxsMember = fleet.members.find(m => m.id === 'sxs');
  ok(sxsMember && sxsMember.state === 'PARKED', 'sxs remains parked behind');
  const distAway = Math.hypot(truck.x - sxsMember.vehicle.x, truck.z - sxsMember.vehicle.z);
  ok(distAway > 20 && truck.speed > 2, `truck drove away from parked sxs (dist=${distAway.toFixed(1)} m, speed=${truck.speed.toFixed(1)} m/s)`);
  const preSpeed = truck.speed, preVx = truck.vx;
  const farRes = fleet.switchToMember('sxs');
  ok(!farRes.ok && !!farRes.reason && farRes.reason.toLowerCase().includes('far'), `parked sxs beyond 6 m refuses handoff (${farRes.reason})`);
  ok(fleet.driven.id === 'truck' && fleet.handbrake === false && truck.speed === preSpeed && truck.vx === preVx,
    'out-of-reach parked handoff restores truck velocity and handbrake');

  // 6c. Too-steep slope behind trailer: refuses unload cleanly and restores truck velocity and handbrake.
  const steepTerrain = makeFlatTerrain(42, () => true, 0.35);
  const steepTruck = new Vehicle(createTruck(false, true), steepTerrain, roads, -0.2, TRUCK_SPEC);
  steepTruck.assist = 0; steepTruck.bounds = [-200, -200, 600, 200];
  steepTruck.place(40, 0, Math.PI / 2);
  const steepTow = new Towing(steepTruck, steepTerrain, roads, true, false, {}, true, true);
  const steepScene = new THREE.Scene();
  steepScene.add(steepTruck.car.root, steepTow.trailer.root);
  const steepFleet = new Fleet(steepTruck, steepTow, steepTerrain, roads, steepScene, true, () => {}, -0.2);
  steepFleet.handbrake = false; steepTruck.vx = 5; steepTruck.speed = 5;
  const steepRes = steepFleet.switchToMember('sxs');
  ok(!steepRes.ok && !!steepRes.reason, `steep fleet switch returns feedback reason (${steepRes.reason})`);
  ok(!steepFleet.busy && steepFleet.driven.id === 'truck' && steepFleet.handbrake === false && steepTruck.speed === 5,
    'refused steep fleet switch restores truck velocity and handbrake');

  // 6d. Thrown ground/ramp query inside switchToMember: catches cleanly and restores truck velocity and handbrake.
  let throwGround = false;
  const flakyTerrain = {
    ...makeFlatTerrain(42, () => true, 0),
    heightAt(x, z) { if (throwGround) throw new Error('ramp query boom'); return 42; },
  };
  const flakyTruck = new Vehicle(createTruck(false, true), flakyTerrain, roads, -0.2, TRUCK_SPEC);
  flakyTruck.assist = 0; flakyTruck.bounds = [-200, -200, 600, 200];
  flakyTruck.place(40, 0, Math.PI / 2);
  const flakyTow = new Towing(flakyTruck, flakyTerrain, roads, true, false, {}, true, true);
  const flakyScene = new THREE.Scene();
  flakyScene.add(flakyTruck.car.root, flakyTow.trailer.root);
  const flakyFleet = new Fleet(flakyTruck, flakyTow, flakyTerrain, roads, flakyScene, true, () => {}, -0.2);
  flakyFleet.handbrake = false; flakyTruck.vx = 6; flakyTruck.speed = 6;
  throwGround = true;
  const flakyRes = flakyFleet.switchToMember('sxs');
  throwGround = false;
  ok(!flakyRes.ok && !!flakyRes.reason, `thrown query in switchToMember returns failure reason (${flakyRes.reason})`);
  ok(!flakyFleet.busy && flakyFleet.driven.id === 'truck' && flakyFleet.handbrake === false && flakyTruck.vx === 6 && flakyTruck.speed === 6,
    'thrown query in switchToMember restores truck velocity and handbrake');

  // 6e. Mid-unload abort (obstacle enters loading path after unload starts): rolls back to pickup, restores pre-stop
  //     velocity & handbrake, and notifies onSettled(false, reason) so the hint is not consumed.
  let blockBehindTrailer = false;
  const abortTerrain = makeFlatTerrain(42, () => true, 0);
  const abortTruck = new Vehicle(createTruck(false, true), abortTerrain, roads, -0.2, TRUCK_SPEC);
  abortTruck.assist = 0; abortTruck.bounds = [-200, -200, 600, 200];
  abortTruck.place(40, 0, Math.PI / 2);
  const abortTow = new Towing(abortTruck, abortTerrain, roads, true, false, {}, true, true);
  const abortScene = new THREE.Scene();
  abortScene.add(abortTruck.car.root, abortTow.trailer.root);
  const abortContacts = {
    revision: 0,
    allows(p) { return !blockBehindTrailer || p.x > abortTow.x - 4.5; },
  };
  const abortFleet = new Fleet(abortTruck, abortTow, abortTerrain, roads, abortScene, true, () => {}, -0.2, abortContacts);
  abortFleet.handbrake = false; abortTruck.vx = 4.5; abortTruck.speed = 4.5;
  const abortSettled = [];
  const abortStart = abortFleet.switchToMember('sxs', (success, reason) => abortSettled.push({ success, reason }));
  ok(abortStart.ok && abortStart.pending === true && abortFleet.busy, 'mid-unload test starts pending unload');
  // Step past gate lowering so cargo begins unloading, then block the ground behind the trailer.
  for (let i = 0; i < 80 && abortFleet.busy; i++) {
    abortFleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => abortFleet.resolve());
    abortFleet.refresh(1 / 60);
  }
  ok(abortFleet.busy && abortSettled.length === 0, 'unload is mid-flight before obstacle appears');
  blockBehindTrailer = true;
  abortContacts.revision++;
  for (let i = 0; i < 300 && abortFleet.busy; i++) {
    abortFleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => abortFleet.resolve());
    abortFleet.refresh(1 / 60);
  }
  ok(!abortFleet.busy && abortFleet.driven.id === 'truck', 'mid-unload obstacle aborts back to pickup');
  ok(abortFleet.handbrake === false && abortTruck.vx === 4.5 && abortTruck.speed === 4.5,
    `mid-unload abort restores pickup pre-stop velocity and handbrake (speed=${abortTruck.speed}, handbrake=${abortFleet.handbrake})`);
  ok(abortSettled.length === 1 && abortSettled[0].success === false && !!abortSettled[0].reason,
    `mid-unload abort notifies onSettled(false, reason) (${abortSettled[0]?.reason})`);

  // 6f. One-time terrain exception during a pending unload (after switchToMember returned pending: true) AND
  //     refused fleet.restart(..., 'place-jump') to unloaded terrain:
  //     refused jump returns false without cancelling the unload; terrain exception rolls back cleanly and calls onSettled(false, reason).
  let throwOnce = false;
  const errTerrain = {
    ...makeFlatTerrain(42, x => x < 200, 0),
    heightAt(x, z) {
      if (throwOnce) { throwOnce = false; throw new Error('mid-unload terrain error'); }
      return x < 200 ? 42 : null;
    },
  };
  const errTruck = new Vehicle(createTruck(false, true), errTerrain, roads, -0.2, TRUCK_SPEC);
  errTruck.assist = 0; errTruck.bounds = [-200, -200, 600, 200];
  errTruck.place(40, 0, Math.PI / 2);
  const errTow = new Towing(errTruck, errTerrain, roads, true, false, {}, true, true);
  const errScene = new THREE.Scene();
  errScene.add(errTruck.car.root, errTow.trailer.root);
  const errFleet = new Fleet(errTruck, errTow, errTerrain, roads, errScene, true, () => {}, -0.2);
  errFleet.handbrake = false; errTruck.vx = 4; errTruck.speed = 4;
  const errSettled = [];
  const errStart = errFleet.switchToMember('sxs', (success, reason) => errSettled.push({ success, reason }));
  ok(errStart.ok && errStart.pending === true && errFleet.busy, 'pending unload starts for jump/exception checks');
  // Refused place jump to unloaded terrain (x=350, beyond the 120 m road search from loaded x<200) returns false.
  ok(errFleet.restart(350, 0, Math.PI / 2, 'place-jump') === false, 'refused place-jump to unloaded terrain returns false');
  ok(errFleet.busy && errSettled.length === 0, 'refused place-jump leaves pending unload active');
  // Trigger terrain change + one-time terrain query throw during pending unload.
  errTerrain.fleetGroundChanged?.(35, -5, 20);
  throwOnce = true;
  errFleet.drive(1 / 60, { throttle: 0, steer: 0, handbrake: false }, () => errFleet.resolve());
  errFleet.refresh(1 / 60);
  ok(!errFleet.busy && errFleet.driven.id === 'truck', 'one-time terrain throw during pending unload rolls back to pickup');
  ok(errFleet.handbrake === false && errTruck.vx === 4 && errTruck.speed === 4,
    'terrain throw during pending unload restores pickup velocity and handbrake');
  ok(errSettled.length === 1 && errSettled[0].success === false && !!errSettled[0].reason,
    `terrain throw during pending unload notifies onSettled(false, reason) (${errSettled[0]?.reason})`);
}

// 7. Baked Judique roads.json verification (SKIP cleanly in CI when data/baked is absent).
const roadsPath = process.env.MMM_ROOT ? `${process.env.MMM_ROOT}/data/baked/areas/judique/roads.json` : 'data/baked/areas/judique/roads.json';
const manifestPath = process.env.MMM_ROOT ? `${process.env.MMM_ROOT}/data/baked/areas/judique/manifest.json` : 'data/baked/areas/judique/manifest.json';
if (!existsSync(roadsPath) || !existsSync(manifestPath)) {
  console.log('SKIP baked Judique roads: no data/baked (CI)');
} else {
  const roadData = JSON.parse(readFileSync(roadsPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const village = manifest.village;
  const dummyTerrain = { cartRoads: false, heightAt: () => 50, surfaceAt: () => null };
  const roads = new Roads(roadData, village, dummyTerrain);
  const approach = new MountainApproach(roads, village, CHURCH_ORIGIN);
  ok(approach.size >= 3, `baked Judique resolves River Denys Mountain Road and River Denys Road rough spans (${approach.size})`);

  const atRoad = (predicate, pointIndex, flip = false) => {
    const r = roads.roads.find(predicate);
    assert.ok(r, 'expected baked road exists');
    const i = Math.max(0, Math.min(r.pts.length - 2, pointIndex));
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    return { x: ax, z: az, heading: Math.atan2(bx - ax, -(bz - az)) + (flip ? Math.PI : 0), speed: 6 };
  };

  ok(approach.isDrivingTowardChurch(atRoad(r => r.name === MOUNTAIN_ROAD_NAME && r.kind === 3, 5, false)),
    'baked: fires at foot of River Denys Mountain Road heading toward church');
  ok(!approach.isDrivingTowardChurch(atRoad(r => r.name === MOUNTAIN_ROAD_NAME && r.kind === 3, 5, true)),
    'baked: does not fire at foot of River Denys Mountain Road heading away from church');
  ok(approach.isDrivingTowardChurch(atRoad(r => r.name === MOUNTAIN_ROAD_NAME && r.kind === 4, 50, false)),
    'baked: fires on River Denys Mountain Road track heading toward church');
  ok(!approach.isDrivingTowardChurch(atRoad(r => r.name === MOUNTAIN_ROAD_NAME && r.kind === 4, 50, true)),
    'baked: does not fire southbound down River Denys Mountain Road');
  ok(!approach.isDrivingTowardChurch(atRoad(r => r.name === 'Highway 105', 100, false)),
    'baked: does not fire on Highway 105');
  ok(!approach.isDrivingTowardChurch(atRoad(r => r.name === 'River Denys Road' && r.kind === 2, 10, false)),
    'baked: does not fire on paved River Denys Road near Judique village');

  const rough0 = ROUGH_STRETCHES[0].from;
  const rough0W = [rough0[0] - village[0], village[1] - rough0[1]];
  const r98 = roads.roads.find(r => r.name === 'River Denys Road' && r.kind === 3);
  const idx0 = r98.pts.findIndex(p => Math.hypot(p[0] - rough0W[0], p[1] - rough0W[1]) < 0.5);
  ok(idx0 > 0, 'baked: found ROUGH_STRETCHES[0] vertex on River Denys Road');
  ok(approach.isDrivingTowardChurch(atRoad(r => r === r98, idx0, false)),
    'baked: fires at rough mountain start on River Denys Road heading toward church');
  ok(!approach.isDrivingTowardChurch(atRoad(r => r === r98, idx0, true)),
    'baked: does not fire westbound away from church on River Denys Road');

  const cs = { x: CHURCH_START.e - village[0], z: village[1] - CHURCH_START.n, heading: CHURCH_START.heading, speed: 6 };
  ok(!approach.isDrivingTowardChurch(cs), 'baked: does not fire at CHURCH_START');
  ok(!approach.outsideChurchClearance(cs), 'baked: CHURCH_START is inside church clearance');
}

console.log(`PASS mountain-hint: ${checks} checks`);
