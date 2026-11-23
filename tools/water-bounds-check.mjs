// Pure-rules check for ocean sinking, off-map boundaries and above-ground placement/respawn
// across every land ride (car, side by side, pickup, horse, dirt bike), truck+trailer/fleet, and drone.
// Run: node tools/run-node-check.mjs tools/water-bounds-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {
  DEFAULT_SEA_LEVEL,
  SEA_SURFACE_MARGIN,
  WATER_COVER_CLASS,
  isDryGround,
  isSeaHeight,
  isSurfaceWet,
  isTidalCoverWater,
  safeClampMargin,
  unknownGroundHeight,
} from '../web/src/water-bounds.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { TRUCK_SPEC, createTruck } from '../web/src/truck.ts';
import { HORSE_SPEC } from '../web/src/horse.ts';
import { BikeRide } from '../web/src/bike-ride.ts';
import { BIKE_SPEC } from '../web/src/bike.ts';
import { Towing } from '../web/src/towing.ts';
import { Fleet } from '../web/src/fleet.ts';
import { checkpoint, reusableCheckpoint } from '../web/src/fleet-checkpoint.ts';
import { DRONE, DRONE_LOAD, loadSpeedCap, stepDrone } from '../web/src/drone-rules.ts';
import { Drone, createTerrainReady } from '../web/src/drone.ts';

const SEA = DEFAULT_SEA_LEVEL; // -0.2

// 1. Shared water-bounds pure helpers.
assert.equal(unknownGroundHeight(SEA), SEA - 4, 'unknown ground drops to seabed below sea level');
assert.equal(isSeaHeight(-0.42, SEA), true, 'harbour depth (-0.42) is sea');
assert.equal(isSeaHeight(-0.35, SEA), true, 'shallow cove (-0.35) is sea');
assert.equal(isSeaHeight(-0.19, SEA), true, 'just under ocean surface (-0.19) is sea');
assert.equal(isSeaHeight(-0.17, SEA), false, 'above ocean surface (-0.17) is dry');
assert.equal(isSeaHeight(0.0, SEA), false, 'zero elevation is dry');

assert.equal(isTidalCoverWater(0.1, SEA, WATER_COVER_CLASS, 0, 0.01, false), true, 'flat open cover-4 tidal water is wet');
assert.equal(isTidalCoverWater(12.0, SEA, WATER_COVER_CLASS, 0, 0.01, false), true, 'flat open cover-4 water above 0.40 m is also wet');
assert.equal(isTidalCoverWater(0.1, SEA, WATER_COVER_CLASS, 0, 0.01, true), false, 'coastal road overlapping cover-4 cell stays dry');
assert.equal(isTidalCoverWater(0.1, SEA, WATER_COVER_CLASS, 0, 0.2, false), false, 'steep shoreline bank is not flat water');
assert.equal(isTidalCoverWater(0.1, SEA, WATER_COVER_CLASS, 2.5, 0.01, false), false, 'wooded shore canopy is not open water');
assert.equal(isTidalCoverWater(35, SEA, WATER_COVER_CLASS, 0, 0.01, false, true), false, 'mineral quarry floor is not flat cover-4 water');

assert.equal(isSurfaceWet({ onDeck: true, onRoad: true, ground: -2, canopy: 0, water: true, y: 1, seaLevel: SEA }), false, 'supporting deck over water stays dry');
assert.equal(isSurfaceWet({ onDeck: false, onRoad: false, ground: -0.25, canopy: 0, y: -0.25, seaLevel: SEA }), true, 'shallow ocean (-0.25) is wet');
assert.equal(isDryGround({ ground: null, surface: null, seaLevel: SEA }), false, 'unknown ground is never dry');
assert.equal(isDryGround({ ground: -0.3, surface: { ground: -0.3, canopy: 0 }, seaLevel: SEA }), false, 'sea ground is never dry');
assert.equal(isDryGround({ ground: 3, surface: { ground: 3, canopy: 0, water: true }, seaLevel: SEA }), false, 'lake water is never dry');
assert.equal(isDryGround({ ground: 3, surface: { ground: 3, canopy: 0 }, seaLevel: SEA }), true, 'dry land is dry');
assert.equal(safeClampMargin(0, 100, 300), 25, 'narrow bounds clamp margin does not invert');
assert.equal(safeClampMargin(-2000, 2000, 300), 300, 'wide bounds keep full margin');
console.log('PASS shared water-bounds rules');

function makeRig() {
  const n = () => new THREE.Object3D();
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  return {
    root,
    body,
    wheels: { fl: n(), fr: n(), rl: n(), rr: n() },
    steer: { fl: n(), fr: n() },
    driverEye: n(),
    brakeLights: [],
    pose() {},
    resetPose() {},
  };
}

/** Straight east-west public road along z = 0 from x = xMin to x = xMax (heading east = +PI/2). */
function makeRoads(xMin = -200, xMax = 110, deckFn = () => null) {
  const pts = [];
  for (let x = xMin; x <= xMax; x += 20) pts.push([x, 0]);
  const road = { id: 1, name: 'Harbour Road', kind: 2, halfWidth: 4, gravel: false, washboard: false, bridge: false, pts };
  return {
    roads: [road],
    deckHeight: deckFn,
    nearest(x, z, maxDist, filter) {
      if (filter && !filter(road)) return null;
      const cx = Math.max(xMin, Math.min(xMax, x));
      const dist = Math.hypot(x - cx, z);
      if (dist > maxDist) return null;
      const seg = Math.min(pts.length - 2, Math.max(0, Math.floor((cx - xMin) / 20)));
      const t = (cx - pts[seg][0]) / 20;
      return { road, seg, t, dist, x: cx, z: 0, heading: Math.PI / 2 };
    },
  };
}

/** Build a synthetic terrain function for coast, void edge, rising hill, or all-water worlds. */
function makeTerrain(sampleFn, coverFn = () => 0) {
  return {
    seaLevel: SEA,
    cartRoads: false,
    withContactHeight(_body, read) { return read(); },
    withGroundContact(_body, read) { return read(); },
    heightAt(x, z) {
      const s = sampleFn(x, z);
      return s ? s.ground : null;
    },
    meshHeightAt(x, z) {
      const s = sampleFn(x, z);
      return s ? s.ground : null;
    },
    surfaceAt(x, z) {
      return sampleFn(x, z);
    },
    coverAt(x, z) {
      return coverFn(x, z);
    },
    waterAt(x, z, drawnGround, onDeck = false) {
      if (onDeck) return false;
      const s = sampleFn(x, z);
      if (!s) return true;
      const g = drawnGround ?? s.ground;
      return isSeaHeight(g, SEA) || !!s.water;
    },
  };
}

function makeRide(kind, terrain, roads) {
  if (kind === 'bike') {
    return new BikeRide(makeRig(), terrain, roads, SEA, BIKE_SPEC);
  }
  const specs = { car: CAR_SPEC, sxs: SXS_SPEC, truck: TRUCK_SPEC, horse: HORSE_SPEC };
  const v = new Vehicle(makeRig(), terrain, roads, SEA, specs[kind]);
  v.assist = 0;
  return v;
}

const RIDES = ['car', 'sxs', 'truck', 'horse', 'bike'];
const COAST_DEPTHS = [
  { name: 'harbour (-0.42 m)', depth: -0.42, cover: 0 },
  { name: 'shallow ocean (-0.21 m)', depth: -0.21, cover: 0 },
  { name: 'tidal cover-4 water (+0.10 m)', depth: 0.10, cover: WATER_COVER_CLASS },
  { name: 'high flat cover-4 water (+1.20 m)', depth: 1.20, cover: WATER_COVER_CLASS },
  { name: 'deep ocean (-4.0 m)', depth: -4.0, cover: 0 },
];

// 2. Drive every land ride off the coast into every ocean/water depth: must sink, respawn to dry land, never below ground.
for (const rideKind of RIDES) {
  for (const { name, depth, cover } of COAST_DEPTHS) {
    const roads = makeRoads(-100, 60);
    const terrain = makeTerrain(
      (x, z) => {
        if (x <= 60) {
          return { ground: 3, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
        }
        if (x <= 72) {
          const t = (x - 60) / 12;
          return { ground: 3 + (depth - 3) * t, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
        }
        return { ground: depth, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
      },
      (x) => (x > 72 ? cover : 0),
    );
    const r = makeRide(rideKind, terrain, roads);
    r.bounds = [-200, -200, 400, 200];
    assert.equal(r.place(20, 0, Math.PI / 2), true, `${rideKind} places on dry road (${name})`);
    // Wet placement directly in water must be refused.
    assert.equal(r.place(90, 0, Math.PI / 2), false, `${rideKind} refuses wet place (${name})`);
    let maxX = r.x;
    let sawWater = false;
    let respawns = 0;
    let prevX = r.x;
    for (let step = 0; step < 900; step++) {
      r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      if (r.x > maxX) maxX = r.x;
      if (r.sunk > 0) sawWater = true;
      if (sawWater && prevX - r.x > 3 && r.x <= 62) respawns++;
      const g = terrain.heightAt(r.x, r.z);
      if (g !== null) assert.ok(r.y >= g - 0.5, `${rideKind} never below ground (${name}): y=${r.y} g=${g}`);
      prevX = r.x;
      if (respawns > 0) break;
    }
    assert.ok(sawWater, `${rideKind} enters water state on ${name} (maxX=${maxX.toFixed(1)})`);
    assert.ok(respawns >= 1, `${rideKind} respawns from ${name} (final x=${r.x.toFixed(1)}, sunk=${r.sunk.toFixed(2)})`);
    assert.ok(maxX < 180, `${rideKind} does not cruise across ${name} (maxX=${maxX.toFixed(1)})`);
    const finalG = terrain.heightAt(r.x, r.z);
    assert.ok(finalG !== null && finalG >= SEA + SEA_SURFACE_MARGIN, `${rideKind} respawns on dry ground (${name}): g=${finalG}`);
    assert.ok(r.y >= finalG - 0.05, `${rideKind} respawns on top of ground (${name}): y=${r.y} g=${finalG}`);
  }
}
console.log('PASS all 5 land rides refuse wet placement, sink and respawn across ocean and flat mapped water');

// 2b. Dirt bike beside a bridge (baked bridge flag with no deckHeight) must sink, not drive over submerged ground.
{
  const roads = makeRoads(-100, 60);
  const terrain = makeTerrain((x, z) => {
    if (x <= 60) return { ground: 3, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
    if (x <= 72) {
      const t = (x - 60) / 12;
      return { ground: 3 + (-0.4 - 3) * t, canopy: 0, roadDist: 8, halfWidth: 3.5, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false };
    }
    return { ground: -0.4, canopy: 0, roadDist: 8, halfWidth: 3.5, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false };
  });
  const bike = makeRide('bike', terrain, roads);
  assert.equal(bike.place(20, 0, Math.PI / 2), true);
  let sawWater = false, respawns = 0, prevX = bike.x;
  for (let i = 0; i < 900; i++) {
    bike.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    if (bike.sunk > 0) sawWater = true;
    if (sawWater && prevX - bike.x > 3 && bike.x <= 62) { respawns++; break; }
    prevX = bike.x;
  }
  assert.ok(sawWater && respawns >= 1, 'bike sinks and respawns on submerged ground beside a bridge with no deckHeight');
}
console.log('PASS bike beside a bridge without deckHeight sinks and respawns');

// 3. Drive every land ride into the map-edge wall (bounds set) on rising terrain: stops inside bounds, never below ground.
for (const rideKind of RIDES) {
  const roads = makeRoads(-100, 90);
  const terrain = makeTerrain((x, z) => {
    if (x < -120 || x > 120 || z < -120 || z > 120) return null;
    const hill = x > 60 ? 3 + (x - 60) * 0.12 : 3;
    return { ground: hill, canopy: 0, roadDist: x <= 90 ? Math.abs(z) : 99, halfWidth: 4, kind: x <= 90 ? 2 : 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
  });
  const r = makeRide(rideKind, terrain, roads);
  r.bounds = [-100, -100, 100, 100];
  assert.equal(r.place(40, 0, Math.PI / 2), true, `${rideKind} places inside wall bounds`);
  let hitWall = false;
  for (let step = 0; step < 600; step++) {
    r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    if (r.atEdge) hitWall = true;
    assert.ok(r.x <= 100 + 1e-6, `${rideKind} stays inside east bound: x=${r.x}`);
    const g = terrain.heightAt(r.x, r.z);
    assert.ok(g !== null && r.y >= g - 0.15, `${rideKind} never ends below rising ground at wall: y=${r.y} g=${g}`);
  }
  assert.ok(hitWall, `${rideKind} hits map-edge wall`);
}
console.log('PASS all 5 land rides stop at map-edge wall and stay above rising terrain');

// 4. Drive every land ride past loaded terrain WITHOUT bounds (void tiles + high far land, AND live main.ts:2528 loop).
for (const rideKind of RIDES) {
  const roads = makeRoads(-100, 60);
  const terrain = makeTerrain((x, z) => {
    if (x > 70 && x < 120) return null; // unloaded gap / past edge of loaded tiles
    if (x >= 120) {
      return { ground: 20, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 6, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
    }
    return { ground: 6, canopy: 0, roadDist: x <= 60 ? Math.abs(z) : 99, halfWidth: 4, kind: x <= 60 ? 2 : 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
  });
  // 4a. Direct solver loop.
  const r = makeRide(rideKind, terrain, roads);
  r.bounds = null;
  assert.equal(r.place(20, 0, Math.PI / 2), true, `${rideKind} places on dry road before void edge`);
  let minYInVoid = Infinity, respawns = 0, prevX = r.x;
  for (let step = 0; step < 900; step++) {
    r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    if (r.x > 70 && r.x < 120 && r.y < minYInVoid) minYInVoid = r.y;
    assert.ok(r.x < 118, `${rideKind} never rolls across void into under-terrain far land: x=${r.x}`);
    if (prevX > 69 && r.x <= 62) respawns++;
    prevX = r.x;
    if (respawns > 0) break;
  }
  assert.ok(minYInVoid < 5.5, `${rideKind} sinks instead of rolling on flat y=6 plane over void: minY=${minYInVoid}`);
  assert.ok(respawns >= 1, `${rideKind} respawns from void tiles back to dry land (x=${r.x})`);
  const g = terrain.heightAt(r.x, r.z);
  assert.ok(g !== null && g >= SEA + SEA_SURFACE_MARGIN && r.y >= g - 0.05, `${rideKind} lands on top of dry ground after void respawn`);

  // 4b. Live main.ts:2528 frame loop (calls place() whenever centre tile is missing).
  const rLive = makeRide(rideKind, terrain, roads);
  rLive.bounds = null;
  assert.equal(rLive.place(20, 0, Math.PI / 2), true);
  let leftLoaded = false, recoveredLive = false;
  for (let step = 0; step < 900; step++) {
    if (terrain.surfaceAt(rLive.x, rLive.z)?.level === undefined) {
      leftLoaded = true;
      rLive.place(rLive.x, rLive.z, rLive.heading);
      if (terrain.surfaceAt(rLive.x, rLive.z) !== null && rLive.x <= 62) { recoveredLive = true; break; }
    } else {
      rLive.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    }
  }
  assert.ok(leftLoaded && recoveredLive, `${rideKind} recovers instead of sticking when live loop calls place() on missing tile`);

  // 4b-bridge. Bounded horse on a cached bridge deck (and bounded bike with missing surface) never recurses in place().
  if (rideKind === 'horse') {
    let tilesLost = false;
    const bridgeTerrain = makeTerrain((x, z) => (tilesLost
      ? null
      : { ground: 6, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const deckRoads = { ...roads, deckHeight: (x, z) => (x >= 40 && x <= 70 && Math.abs(z) <= 5 ? 8 : null) };
    const hDeck = makeRide('horse', bridgeTerrain, deckRoads);
    hDeck.bounds = [-100, -100, 100, 100];
    assert.equal(hDeck.place(55, 0, Math.PI / 2), true, 'bounded horse places on loaded bridge deck');
    tilesLost = true;
    assert.equal(hDeck.place(hDeck.x, hDeck.z, hDeck.heading), false, 'bounded horse on cached bridge deck with all tiles lost returns false without stack overflow');

    // Partial tile loss: bridge tile disappears while nearby dry road remains loaded -> recovers cleanly to loaded road.
    let bridgeLost = false;
    const partialTerrain = makeTerrain((x, z) => (bridgeLost && x >= 40
      ? null
      : { ground: 6, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const hPartial = makeRide('horse', partialTerrain, deckRoads);
    hPartial.bounds = [-100, -100, 100, 100];
    assert.equal(hPartial.place(20, 0, Math.PI / 2), true);
    for (let step = 0; step < 180; step++) hPartial.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    assert.equal(hPartial.place(55, 0, Math.PI / 2), true);
    bridgeLost = true;
    assert.equal(hPartial.place(hPartial.x, hPartial.z, hPartial.heading), true, 'bounded horse on vanished bridge tile recovers to loaded road');
    assert.ok(partialTerrain.surfaceAt(hPartial.x, hPartial.z) !== null && hPartial.x < 40, `recovered horse lands on loaded road: x=${hPartial.x}`);

    // Guard shifting a recovery candidate back onto a missing-surface cached deck is rejected, continuing to the dry fallback.
    let guardShiftedHorse = 0;
    const hGuard = makeRide('horse', partialTerrain, deckRoads);
    hGuard.bounds = [-100, -100, 100, 100];
    bridgeLost = false;
    assert.equal(hGuard.place(-60, 0, Math.PI / 2), true);
    for (let step = 0; step < 900 && hGuard.x < 30; step++) hGuard.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    assert.equal(hGuard.place(55, 0, Math.PI / 2), true);
    bridgeLost = true;
    hGuard.placementGuard = (pose) => {
      if (guardShiftedHorse === 0) { guardShiftedHorse++; pose.x = 55; }
      return true;
    };
    assert.equal(hGuard.place(hGuard.x, hGuard.z, hGuard.heading), true, 'horse recovery rejects guard-shifted missing-surface deck and finds earlier dry fallback');
    assert.ok(guardShiftedHorse === 1 && partialTerrain.surfaceAt(hGuard.x, hGuard.z) !== null && hGuard.x < 40, `horse skipped shifted candidate to dry fallback: x=${hGuard.x} shifted=${guardShiftedHorse}`);

    // Rejected map-edge clamped placement falls through to respawn() dry fallback (never strands with desynced model).
    const edgeTerrain = makeTerrain((x, z) => (x > 100
      ? null
      : { ground: 6, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const hEdge = makeRide('horse', edgeTerrain, makeRoads(-100, 100));
    hEdge.bounds = [-100, -100, 100, 100];
    assert.equal(hEdge.place(20, 0, Math.PI / 2), true);
    hEdge.x = 105;
    hEdge.placementGuard = (pose) => {
      if (Math.abs(pose.x - 100) < 1) { pose.x = 105; }
      return true;
    };
    assert.equal(hEdge.place(105, 0, Math.PI / 2), true, 'horse falls through to respawn() when clamped edge placement is shifted off-map by guard');
    assert.ok(edgeTerrain.surfaceAt(hEdge.x, hEdge.z) !== null && hEdge.x < 99, `horse recovered to dry fallback after edge rejection: x=${hEdge.x}`);
    assert.ok(Math.abs(hEdge.car.root.position.x - hEdge.x) < 1e-3, `horse model synced after edge recovery: modelX=${hEdge.car.root.position.x} x=${hEdge.x}`);

    // Guard rejecting EVERY candidate returns false and does not move physics or model to the rejected edge.
    const hRejectAll = makeRide('horse', edgeTerrain, makeRoads(-100, 100));
    hRejectAll.bounds = [-100, -100, 100, 100];
    assert.equal(hRejectAll.place(20, 0, Math.PI / 2), true);
    hRejectAll.x = 105;
    hRejectAll.placementGuard = () => false;
    assert.equal(hRejectAll.place(105, 0, Math.PI / 2), false, 'horse returns false when guard rejects every recovery candidate');
    assert.equal(hRejectAll.x, 105, 'rejected horse physics never moves to unapproved edge');
    assert.ok(Math.abs(hRejectAll.car.root.position.x - 100) > 1, 'rejected horse model never moves to unapproved edge x=100');

    // Guard shifting clamped pose to x=99.8 (centre loaded, front wheels over void x>100) rejects and falls back to x=20.
    const hOverhang = makeRide('horse', edgeTerrain, makeRoads(-100, 100));
    hOverhang.bounds = [-100, -100, 100, 100];
    assert.equal(hOverhang.place(20, 0, Math.PI / 2), true);
    hOverhang.x = 105;
    hOverhang.placementGuard = (pose) => {
      if (Math.abs(pose.x - 100) < 1) { pose.x = 99.8; }
      return true;
    };
    assert.equal(hOverhang.place(105, 0, Math.PI / 2), true, 'horse skips overhanging x=99.8 edge pose and recovers to dry fallback');
    assert.ok(hOverhang.x < 98, `horse recovered away from void overhang: x=${hOverhang.x}`);
  } else if (rideKind === 'bike') {
    let surfaceLost = false;
    const synthTerrain = {
      ...makeTerrain(() => ({ ground: 6, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false })),
      heightAt: () => 6,
      surfaceAt: () => (surfaceLost ? null : { ground: 6, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }),
    };
    const bLost = makeRide('bike', synthTerrain, roads);
    bLost.bounds = [-100, -100, 100, 100];
    assert.equal(bLost.place(55, 0, Math.PI / 2), true);
    surfaceLost = true;
    assert.equal(bLost.place(bLost.x, bLost.z, bLost.heading), false, 'bounded bike with lost surface returns false without stack overflow');

    // Guard shifting a loaded bike recovery candidate onto a missing-surface tile with cached height is rejected, continuing to the dry fallback.
    let bikeBridgeLost = false, guardShiftedBike = 0;
    const bikePartial = {
      ...makeTerrain((x, z) => (bikeBridgeLost && x >= 40
        ? null
        : { ground: 6, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false })),
      heightAt: () => 6,
      surfaceAt: (x, z) => (bikeBridgeLost && x >= 40
        ? null
        : { ground: 6, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }),
    };
    const bGuard = makeRide('bike', bikePartial, roads);
    bGuard.bounds = [-100, -100, 100, 100];
    assert.equal(bGuard.place(-60, 0, Math.PI / 2), true);
    for (let step = 0; step < 600 && bGuard.x < 30; step++) bGuard.update(1 / 60, { throttle: 0.4, steer: 0, handbrake: false });
    assert.equal(bGuard.place(55, 0, Math.PI / 2), true);
    bikeBridgeLost = true;
    bGuard.placementGuard = (pose) => {
      if (guardShiftedBike === 0) { guardShiftedBike++; pose.x = 55; }
      return true;
    };
    assert.equal(bGuard.place(bGuard.x, bGuard.z, bGuard.heading), true, 'bike recovery rejects guard-shifted missing-surface tile and finds earlier dry fallback');
    assert.ok(guardShiftedBike === 1 && bikePartial.surfaceAt(bGuard.x, bGuard.z) !== null && bGuard.x < 40, `bike skipped shifted candidate to dry fallback: x=${bGuard.x} shifted=${guardShiftedBike}`);

    // Rejected map-edge clamped placement on bike falls through to respawn() dry fallback with synced model.
    const bikeEdgeTerrain = makeTerrain((x, z) => (x > 100
      ? null
      : { ground: 6, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const bEdge = makeRide('bike', bikeEdgeTerrain, makeRoads(-100, 100));
    bEdge.bounds = [-100, -100, 100, 100];
    assert.equal(bEdge.place(20, 0, Math.PI / 2), true);
    bEdge.x = 105;
    bEdge.placementGuard = (pose) => {
      if (Math.abs(pose.x - 100) < 1) { pose.x = 105; }
      return true;
    };
    assert.equal(bEdge.place(105, 0, Math.PI / 2), true, 'bike falls through to respawn() when clamped edge placement is shifted off-map by guard');
    assert.ok(bikeEdgeTerrain.surfaceAt(bEdge.x, bEdge.z) !== null && bEdge.x < 99, `bike recovered to dry fallback after edge rejection: x=${bEdge.x}`);
    assert.ok(Math.abs(bEdge.car.root.position.x - bEdge.x) < 1e-3, `bike model synced after edge recovery: modelX=${bEdge.car.root.position.x} x=${bEdge.x}`);

    // Guard rejecting EVERY candidate returns false and does not move bike physics or model to the rejected edge.
    const bRejectAll = makeRide('bike', bikeEdgeTerrain, makeRoads(-100, 100));
    bRejectAll.bounds = [-100, -100, 100, 100];
    assert.equal(bRejectAll.place(20, 0, Math.PI / 2), true);
    bRejectAll.x = 105;
    bRejectAll.placementGuard = () => false;
    assert.equal(bRejectAll.place(105, 0, Math.PI / 2), false, 'bike returns false when guard rejects every recovery candidate');
    assert.equal(bRejectAll.x, 105, 'rejected bike physics never moves to unapproved edge');
    assert.ok(Math.abs(bRejectAll.car.root.position.x - 100) > 1, 'rejected bike model never moves to unapproved edge x=100');

    // Guard shifting clamped pose to x=99.8 (centre loaded, front wheel over void x>100) rejects so bike never strands with ready=false.
    const bOverhang = makeRide('bike', bikeEdgeTerrain, makeRoads(-100, 100));
    bOverhang.bounds = [-100, -100, 100, 100];
    assert.equal(bOverhang.place(20, 0, Math.PI / 2), true);
    bOverhang.x = 105;
    bOverhang.placementGuard = (pose) => {
      if (Math.abs(pose.x - 100) < 1) { pose.x = 99.8; }
      return true;
    };
    assert.equal(bOverhang.place(105, 0, Math.PI / 2), true, 'bike skips overhanging x=99.8 edge pose and recovers to dry fallback');
    assert.ok(bOverhang.x < 98, `bike recovered away from void overhang: x=${bOverhang.x}`);
    const xBeforeDrive = bOverhang.x;
    for (let step = 0; step < 60; step++) bOverhang.update(1 / 60, { throttle: 0.5, steer: 0, handbrake: false });
    assert.ok(Math.abs(bOverhang.x - xBeforeDrive) > 0.5, `bike remains drivable (ready=true) after overhang recovery: dx=${Math.abs(bOverhang.x - xBeforeDrive)}`);
  }

  // 4c. Narrow missing strip into a 20 m rising bank: every ride (including horse) crosses onto the 20 m bank and stays above ground.
  const narrowTerrain = makeTerrain((x, z) => {
    if (x > 55 && x < 56) return null;
    if (x >= 56) return { ground: 20, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
    return { ground: 6, canopy: 0, roadDist: x <= 55 ? Math.abs(z) : 99, halfWidth: 4, kind: x <= 55 ? 2 : 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
  });
  const rNarrow = makeRide(rideKind, narrowTerrain, roads);
  rNarrow.bounds = null;
  assert.equal(rNarrow.place(30, 0, Math.PI / 2), true);
  let maxNarrowX = rNarrow.x;
  for (let step = 0; step < 600; step++) {
    rNarrow.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    if (rNarrow.x > maxNarrowX) maxNarrowX = rNarrow.x;
    const hNow = narrowTerrain.heightAt(rNarrow.x, rNarrow.z);
    if (hNow !== null) assert.ok(rNarrow.y >= hNow - 0.5, `${rideKind} stays above 20 m bank after missing strip: y=${rNarrow.y} g=${hNow}`);
  }
  assert.ok(maxNarrowX >= 56, `${rideKind} actually crosses onto 20 m bank (maxX=${maxNarrowX.toFixed(1)})`);
}
console.log('PASS all 5 land rides sink/respawn off loaded terrain, recover under live missing-tile loop, and stay above rising banks');

// 4d. Dry cover-4 shoreline slopes stay dry during both placement and driving (along contour & diagonally);
// jumping to an unloaded tile that resolves to 20 m flat mapped water settles on top even when wheel contacts are still missing.
{
  const noRoads = { roads: [], deckHeight: () => null, nearest: () => null };
  // 20% east-west slope driven along the north-south contour (bike) and 8.5% diagonal slope (car).
  const contourBank = makeTerrain(
    (x) => ({ ground: 2 + x * 0.2, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }),
    () => WATER_COVER_CLASS,
  );
  const bikeContour = makeRide('bike', contourBank, noRoads);
  assert.equal(bikeContour.place(10, 0, 0), true, 'bike accepts dry 20% cover-4 shoreline slope');
  for (let i = 0; i < 180; i++) {
    bikeContour.update(1 / 60, { throttle: 0.6, steer: 0, handbrake: false });
    assert.equal(bikeContour.sunk, 0, 'bike driving along 20% cover-4 contour stays dry');
  }

  const diagBank = makeTerrain(
    (x, z) => ({ ground: 5 + (x + z) * 0.06, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }),
    () => WATER_COVER_CLASS,
  );
  const carDiag = makeRide('car', diagBank, noRoads);
  assert.equal(carDiag.place(0, 0, 0), true, 'car accepts dry 8.5% diagonal cover-4 slope');
  for (let i = 0; i < 180; i++) {
    carDiag.update(1 / 60, { throttle: 0.6, steer: 0, handbrake: false });
    assert.equal(carDiag.sunk, 0, 'car driving along heading 0 on 8.5% diagonal cover-4 slope stays dry');
  }

  for (const rideKind of ['car', 'bike']) {
    let loaded = false;
    const delayedWet = makeTerrain(
      (x) => {
        if (x < 50) return { ground: 3, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
        if (!loaded) return null;
        return { ground: 20, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
      },
      (x) => (x >= 50 ? WATER_COVER_CLASS : 0),
    );
    const r = makeRide(rideKind, delayedWet, noRoads);
    assert.equal(r.place(0, 0, Math.PI / 2), true);
    r.resetVisit();
    assert.equal(r.place(100, 0, Math.PI / 2), true, `${rideKind} waits for unloaded jump target`);
    loaded = true;
    r.update(1 / 60, { throttle: 0, steer: 0, handbrake: false });
    assert.ok(r.y >= 19.95, `${rideKind} settles on top on FIRST loaded update: y=${r.y}`);
    for (let i = 0; i < 60; i++) r.update(1 / 60, { throttle: 0, steer: 0, handbrake: false });
    assert.ok(r.y >= 19.95, `${rideKind} stays on top of 20 m wet tile: y=${r.y}`);
  }

  // Car with centre loaded at 20 m wet water while wheel samples are still missing: stays at 20 m across updates (never drops to -4.2 m).
  let centreOnly = false;
  const partialWet = makeTerrain(
    (x, z) => {
      if (x < 50) return { ground: 3, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
      if (!centreOnly) return null;
      if (Math.hypot(x - 100, z) < 0.5) return { ground: 20, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
      return null;
    },
    (x) => (x >= 50 ? WATER_COVER_CLASS : 0),
  );
  const carPartial = makeRide('car', partialWet, noRoads);
  assert.equal(carPartial.place(0, 0, Math.PI / 2), true);
  carPartial.resetVisit();
  assert.equal(carPartial.place(100, 0, Math.PI / 2), true);
  centreOnly = true;
  for (let i = 0; i < 10; i++) {
    carPartial.update(1 / 60, { throttle: 0, steer: 0, handbrake: false });
    assert.ok(carPartial.y >= 19.95, `car with missing wheel samples stays at 20 m on update ${i + 1}: y=${carPartial.y}`);
  }
}
console.log('PASS dry cover-4 shoreline slopes stay dry and delayed wet tiles never bury rides');

// 5. Respawn without roads + zero creeping on seabed when no dry ground exists even with sustained throttle.
for (const rideKind of RIDES) {
  const noRoads = { roads: [], deckHeight: () => null, nearest: () => null };
  const terrain = makeTerrain((x) => {
    if (x > 40) return null;
    return { ground: 5, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
  });
  const r = makeRide(rideKind, terrain, noRoads);
  r.bounds = null;
  assert.equal(r.place(0, 0, Math.PI / 2), true);
  let recovered = false, wentOff = false;
  for (let step = 0; step < 1200; step++) {
    r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
    if (r.x > 40) wentOff = true;
    if (wentOff && r.x <= 40) { recovered = true; break; }
  }
  assert.ok(wentOff && recovered, `${rideKind} recovers via last safe pose even when no road exists`);
  const g = terrain.heightAt(r.x, r.z);
  assert.ok(g !== null && r.y >= g - 0.05, `${rideKind} safe fallback is on loaded ground`);

  // Dry island that floods: once nowhere dry exists, ride sinks and stops with ZERO creep under sustained full throttle.
  let flooded = false;
  const floodTerrain = makeTerrain(() => ({ ground: flooded ? -0.35 : 3, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
  const rFlood = makeRide(rideKind, floodTerrain, noRoads);
  assert.equal(rFlood.place(0, 0, Math.PI / 2), true);
  flooded = true;
  for (let step = 0; step < 180; step++) rFlood.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
  const xStopped = rFlood.x, zStopped = rFlood.z;
  for (let step = 0; step < 120; step++) rFlood.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
  assert.equal(Math.hypot(rFlood.vx, rFlood.vz), 0, `${rideKind} holds zero velocity when stranded in water`);
  assert.ok(Math.hypot(rFlood.x - xStopped, rFlood.z - zStopped) < 1e-6, `${rideKind} does not creep across seabed under held throttle`);
}
console.log('PASS respawn recovers without roads and stranded rides hold still with zero seabed creep');

// 6. Non-Fleet Towing void rejection + trailer wheel drop; Fleet water stop (teleportAttempts unchanged!) + explicit R recovery + rollback isolation.
{
  const roads = makeRoads(-120, 60);
  const terrain = makeTerrain((x, z) => {
    if (x > 130) return null;
    if (x <= 60) return { ground: 3, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
    if (x <= 72) {
      const t = (x - 60) / 12;
      return { ground: 3 + (-0.35 - 3) * t, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
    }
    return { ground: -0.35, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
  });
  const truck = new Vehicle(createTruck(false, true), terrain, roads, SEA, TRUCK_SPEC);
  truck.assist = 0;
  truck.bounds = [-200, -200, 400, 200];
  const tow = new Towing(truck, terrain, roads, false, false, {}, true, true);
  assert.equal(tow.allowsPose({ x: 90, z: 0, heading: Math.PI / 2 }), false, 'Towing refuses shallow ocean (-0.35 m)');
  assert.equal(tow.allowsPose({ x: 150, z: 0, heading: Math.PI / 2 }), false, 'Towing refuses void tiles (null ground)');
  assert.equal(tow.allowsPose({ x: 20, z: 0, heading: Math.PI / 2 }), true, 'Towing allows dry road');

  // Towing rejects loaded centre with missing sides AND flat cover-4 water above sea level.
  const partialVoid = makeTerrain((x, z) => (Math.abs(z) > 0.5 ? null : { ground: 3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
  const partialTruck = new Vehicle(createTruck(false, true), partialVoid, roads, SEA, TRUCK_SPEC);
  const partialTow = new Towing(partialTruck, partialVoid, roads, false, false, {}, true, true);
  assert.equal(partialTow.allowsPose({ x: 20, z: 0, heading: Math.PI / 2 }), false, 'Towing refuses loaded road centre with unsupported void sides');

  const highCoverWater = makeTerrain(
    () => ({ ground: 5, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }),
    () => WATER_COVER_CLASS,
  );
  const wetTowTruck = new Vehicle(createTruck(false, true), highCoverWater, { roads: [], deckHeight: () => null, nearest: () => null }, SEA, TRUCK_SPEC);
  const wetTow = new Towing(wetTowTruck, highCoverWater, { roads: [], deckHeight: () => null, nearest: () => null }, false, false, {}, true, true);
  assert.equal(wetTow.allowsPose({ x: 0, z: 0, heading: 0 }), false, 'Towing refuses flat cover-4 water above sea level');

  // Non-Fleet truck+trailer drives off loaded terrain into void: trailer drops toward seabed instead of floating at old height.
  const voidEdgeTerrain = makeTerrain((x, z) => {
    if (x > 68) return null;
    return { ground: 3, canopy: 0, roadDist: x <= 60 ? Math.abs(z) : 99, halfWidth: 4, kind: x <= 60 ? 2 : 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
  });
  const voidTruck = new Vehicle(createTruck(false, true), voidEdgeTerrain, roads, SEA, TRUCK_SPEC);
  voidTruck.assist = 0;
  const voidTow = new Towing(voidTruck, voidEdgeTerrain, roads, false, false, {}, true, true);
  assert.equal(voidTruck.place(56, 0, -Math.PI / 2), true);
  voidTow.update();
  const dryTrailerY = voidTow.y;
  let minTrailerY = dryTrailerY;
  for (let i = 0; i < 600; i++) {
    voidTruck.update(1 / 60, { throttle: -1, steer: 0, handbrake: false }, () => voidTow.step());
    if (voidTow.y < minTrailerY) minTrailerY = voidTow.y;
    if (minTrailerY < dryTrailerY - 1) break;
  }
  assert.ok(minTrailerY < dryTrailerY - 1, `trailer drops when its wheels enter void: dryY=${dryTrailerY} minY=${minTrailerY}`);

  // Fleet driving into shallow ocean: sinks and stops (zero creep), NEVER crosses explicit teleport boundary during drive(), and R recovers cleanly.
  const scene = new THREE.Scene();
  scene.add(truck.car.root, tow.trailer.root);
  truck.place(20, 0, Math.PI / 2);
  const fleet = new Fleet(truck, tow, terrain, roads, scene, true, () => {}, SEA);
  const attemptsBefore = fleet.teleportAttempts;
  for (let step = 0; step < 900; step++) {
    fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
  }
  assert.equal(fleet.teleportAttempts, attemptsBefore, 'Fleet.drive() never crosses explicit teleport boundary');
  const xStopped = truck.x, zStopped = truck.z, yStopped = truck.y;
  for (let step = 0; step < 120; step++) {
    fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
  }
  assert.ok(Math.hypot(truck.x - xStopped, truck.z - zStopped) < 1e-6, 'sunk Fleet truck stops completely without creeping across ocean');
  assert.ok(Math.abs(truck.y - yStopped) < 1e-6, 'sunk Fleet truck stays vertically stationary after stopping');
  fleet.respawn();
  assert.ok(fleet.teleportAttempts > attemptsBefore, 'explicit R triggers Fleet road-reset teleport');
  const gAfter = terrain.heightAt(truck.x, truck.z);
  assert.ok(gAfter !== null && gAfter >= SEA + SEA_SURFACE_MARGIN && truck.y >= gAfter - 0.05, 'explicit R returns Fleet truck on top of dry road');

  // Fleet refuses wet jump / place onto flat mapped water above sea level (no false commit).
  const jumpTerrain = makeTerrain(
    (x, z) => (x < 60
      ? { ground: 3, canopy: 0, roadDist: Math.abs(z), halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }
      : { ground: 5, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }),
    (x) => (x >= 60 ? WATER_COVER_CLASS : 0),
  );
  const jTruck = new Vehicle(createTruck(false, true), jumpTerrain, roads, SEA, TRUCK_SPEC);
  jTruck.assist = 0;
  const jTow = new Towing(jTruck, jumpTerrain, roads, false, false, {}, true, true);
  const jScene = new THREE.Scene(); jScene.add(jTruck.car.root, jTow.trailer.root);
  jTruck.place(20, 0, Math.PI / 2);
  const jFleet = new Fleet(jTruck, jTow, jumpTerrain, roads, jScene, true, () => {}, SEA);
  assert.equal(jTruck.place(100, 0, Math.PI / 2), false, 'Fleet placeMovement refuses flat cover-4 water');
  jFleet.restart(130, 0, 0, 'place-jump');
  assert.notEqual(jFleet.message, 'All vehicles back on the trailer', 'Fleet restart (heading 0, x=130) refuses flat cover-4 water without false success');
  assert.ok(Math.abs(jTruck.x - 20) < 1e-6, 'refused wet Fleet jump (x=130) keeps truck at original dry pose');
  jFleet.restart(300, 0, Math.PI / 2, 'place-jump');
  assert.notEqual(jFleet.message, 'All vehicles back on the trailer', 'Fleet restart (x=300) refuses flat cover-4 water without false success');
  assert.ok(Math.abs(jTruck.x - 20) < 1e-6, 'refused wet Fleet jump (x=300) keeps truck at original dry pose');

  // Fleet checkpoint rollback isolates Vehicle private safe-pose history.
  const noRoads = { roads: [], deckHeight: () => null, nearest: () => null };
  const flatDry = makeTerrain((x) => x > 140 ? null : ({ ground: 4, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
  const vRoll = new Vehicle(makeRig(), flatDry, noRoads, SEA, CAR_SPEC);
  vRoll.place(0, 0, Math.PI / 2);
  const restoreOne = checkpoint([vRoll], [vRoll.car.root]);
  const makeReusable = reusableCheckpoint([vRoll], [vRoll.car.root]);
  const restoreReuse = makeReusable();
  vRoll.place(110, 0, Math.PI / 2);
  restoreReuse();
  vRoll.x = 150;
  vRoll.respawn();
  assert.ok(Math.abs(vRoll.x) < 1, `reusableCheckpoint restores private safe-pose history (got x=${vRoll.x})`);
  vRoll.place(110, 0, Math.PI / 2);
  restoreOne();
  vRoll.x = 150;
  vRoll.respawn();
  assert.ok(Math.abs(vRoll.x) < 1, `checkpoint restores private safe-pose history (got x=${vRoll.x})`);
}
console.log('PASS Towing void checks, Fleet water stop without auto-teleport, explicit R recovery, and rollback isolation');

// 7. Drone: flies freely over water, never passes under ground, rising hills or unknown void, and stops at terrain root edge.
{
  const idle = { forward: 0, right: 0, up: 0, turn: 0 };
  const overSea = { x: 0, y: 15, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0 };
  for (let i = 0; i < 120; i++) stepDrone(overSea, { ...idle, forward: 1 }, 1 / 60, DRONE.speed, { ground: -0.35, floor: 1.5 }, null);
  assert.ok(overSea.z < -20 && overSea.y > 14, 'drone flies freely over open water');

  const diveGround = { x: 0, y: 20, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0 };
  for (let i = 0; i < 600; i++) stepDrone(diveGround, { ...idle, up: -1 }, 1 / 60, DRONE.speed, { ground: 12, floor: 13.5 }, null);
  assert.ok(diveGround.y >= 12.5, `drone never passes under ground: y=${diveGround.y}`);

  const diveVoid = { x: 0, y: 10, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0 };
  for (let i = 0; i < 600; i++) stepDrone(diveVoid, { ...idle, up: -1 }, 1 / 60, DRONE.speed, { ground: null, floor: null }, null);
  assert.ok(diveVoid.y >= SEA + DRONE.clearance - 1e-6, `drone keeps sea floor over unloaded void: y=${diveVoid.y}`);

  // Flying horizontally into a 20 m cliff and a 150 m high cliff (above old 120 m ceiling) via both stepDrone and Drone.update.
  const cliffSample = (_x, z) => (z < -10 ? { ground: 20, floor: 22 } : { ground: 2, floor: 4 });
  const intoCliff = { x: 0, y: 5, z: -9.8, vx: 0, vy: 0, vz: -30, yaw: 0, yawRate: 0 };
  stepDrone(intoCliff, { ...idle, forward: 1 }, 1 / 30, DRONE.maxSpeed, cliffSample(intoCliff.x, intoCliff.z), null, undefined, cliffSample);
  assert.ok(intoCliff.z < -10 && intoCliff.y >= 20.5, `drone stays above 20 m cliff after moving into it: z=${intoCliff.z} y=${intoCliff.y}`);

  const highCliffSample = (_x, z) => (z < -10 ? { ground: 150, floor: 152 } : { ground: 0, floor: 2 });
  const intoHighCliff = { x: 0, y: 50, z: -9.8, vx: 0, vy: 0, vz: -30, yaw: 0, yawRate: 0 };
  stepDrone(intoHighCliff, { ...idle, forward: 1 }, 1 / 30, DRONE.maxSpeed, highCliffSample(intoHighCliff.x, intoHighCliff.z), null, undefined, highCliffSample);
  assert.ok(intoHighCliff.z < -10 && intoHighCliff.y >= 150.5, `old ceiling never pulls drone below 150 m cliff: z=${intoHighCliff.z} y=${intoHighCliff.y}`);

  // Live game call path (main.ts:1003 createTerrainReady(terrain) + main.ts:1608 Drone.update with 6 args, NO explicit sampler).
  const liveCliffTerrain = {
    seaLevel: SEA,
    manifest: { origin: [0, 1000], size: 1000, village: [500, 500], levels: { 0: ['0_0'] } },
    levelAt(x, z) { return x >= -500 && x < 500 && z >= -500 && z < 500 ? 0 : -1; },
    drawnFine: new Set(),
    surfaceAt(_x, z) { return z < -10 ? { ground: 20, canopy: 0 } : { ground: 2, canopy: 0 }; },
  };
  createTerrainReady(liveCliffTerrain);
  const droneFree = new Drone();
  droneFree.free = true;
  Object.assign(droneFree.state, { x: 0, y: 5, z: -9.8, vx: 0, vy: 0, vz: -30, yaw: 0, yawRate: 0 });
  droneFree.update(1 / 30, { ...idle, forward: 1 }, cliffSample(0, -9.8), null, 0, DRONE.maxSpeed);
  assert.ok(droneFree.state.z < -10 && droneFree.state.y >= 20.5, `live free Drone.update (6 args) stays above 20 m cliff: z=${droneFree.state.z} y=${droneFree.state.y}`);

  const droneRoof = new Drone();
  droneRoof.free = false;
  Object.assign(droneRoof.state, { x: 0, y: 5, z: -9.8, vx: 0, vy: 0, vz: -30, yaw: 0, yawRate: 0 });
  droneRoof.update(1 / 30, { ...idle, forward: 1 }, cliffSample(0, -9.8), { x: 0, y: 3, z: 0 }, 0, DRONE.maxSpeed);
  assert.ok(droneRoof.state.z < -10 && droneRoof.state.y >= 20.5, `live roof Drone.update (6 args) stays above 20 m cliff: z=${droneRoof.state.z} y=${droneRoof.state.y}`);

  // Returning to the roof across a steep bank within 4 m never dips below terrain and still lands on the roof.
  const bankSurfaceAt = (_x, z) => ({ ground: 2 + Math.max(0, 4 - Math.abs(z + 1.7) * 4), canopy: 0 });
  createTerrainReady({
    seaLevel: SEA,
    manifest: { origin: [0, 1000], size: 1000, village: [500, 500], levels: { 0: ['0_0'] } },
    levelAt: () => 0,
    drawnFine: new Set(),
    surfaceAt: bankSurfaceAt,
  });
  const returnRoof = { x: 0, y: 3.5, z: 0 };
  const droneReturn = new Drone();
  Object.assign(droneReturn.state, { x: 0, y: 5, z: -2.8, vx: 0, vy: 0, vz: 6, yaw: 0, yawRate: 0 });
  droneReturn.callHome();
  let landed = false;
  for (let i = 0; i < 900 && !landed; i++) {
    const base = bankSurfaceAt(0, droneReturn.state.z).ground;
    landed = droneReturn.update(1 / 30, idle, { ground: base, floor: base + DRONE.clearance }, returnRoof, 0, DRONE.maxSpeed);
    const gHere = bankSurfaceAt(0, droneReturn.state.z).ground;
    assert.ok(droneReturn.state.y >= gHere, `return-to-roof stays above bank: y=${droneReturn.state.y} g=${gHere}`);
  }
  assert.ok(landed, 'returning drone clears the steep bank and still lands on the roof');

  // createTerrainReady stops standalone drone at terrain root edge before entering unmapped far land.
  const fakeTerrain = {
    manifest: { origin: [0, 1000], size: 1000, village: [500, 500], levels: { 0: ['0_0'] } },
    levelAt(x, z) { return x >= -500 && x < 500 && z >= -500 && z < 500 ? 0 : -1; },
    drawnFine: new Set(),
  };
  const ready = createTerrainReady(fakeTerrain);
  assert.equal(ready(0, 0), true, 'inside root is ready');
  assert.equal(ready(600, 0), false, 'outside terrain root is not ready');
  assert.equal(ready(0, -600), false, 'north of terrain root is not ready');
  const clearAhead = (x, z, dx, dz) => {
    let clear = -1;
    for (const d of DRONE_LOAD.probes) {
      if (!ready(x + dx * d, z + dz * d)) break;
      clear = d;
    }
    return clear;
  };
  const distToEdge = clearAhead(460, 0, 1, 0);
  assert.ok(distToEdge <= DRONE_LOAD.stop, `probes see terrain root edge ahead: ${distToEdge}`);
  assert.equal(loadSpeedCap(DRONE.maxSpeed, distToEdge), 0, 'standalone drone stops at terrain root edge');
  const distInward = clearAhead(460, 0, -1, 0);
  assert.equal(loadSpeedCap(DRONE.maxSpeed, distInward), DRONE.maxSpeed, 'standalone drone flies freely back inward');
}
console.log('PASS drone flies over water, never passes under land, cliffs or void, and stops at terrain root edge');
{
  // A height-free placement (placeAt: a visit start, a restart, a ?at= link) on a bridge span whose deck is not built
  // yet is refused for the water under it, as main refuses any wet placement (#130). Once the deck is built, the same
  // placeAt stands the ride on it (just-drive#6).
  const seabed = makeTerrain(() => ({ ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
  const spanned = makeRoads(-200, 110);
  spanned.bridgeRuns = () => [{ roads: new Set([1]), pts: [[-50, 0], [50, 0]] }];
  for (const kind of ['car', 'bike']) {
    let deck = null; spanned.deckHeight = (x, z) => (deck !== null && Math.abs(x) <= 50 && Math.abs(z) <= 4 ? deck : null);
    const r = makeRide(kind, seabed, spanned); r.bounds = [-200, -200, 400, 200];
    assert.equal(r.placeAt(0, 0, Math.PI / 2), false, `${kind}: placeAt on the water under an unbuilt span is refused, as on main`);
    deck = 2;
    assert.equal(r.placeAt(0, 0, Math.PI / 2), true, `${kind}: placeAt on the built deck`);
    assert.ok(Math.abs(r.y - 2) < .1, `${kind}: stands on the deck (y=${r.y})`);
  }
  console.log('PASS a placeAt on an unbuilt span over water is refused as on main; on the built deck it stands on it');
}
{
  // A ride that sinks under a high deck that belongs to another road respawns on the land behind, never on the deck
  // overhead and never in the water (each candidate is judged at its own height).
  const shore = makeTerrain((x) => ({ ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
  const under = makeRoads(-200, 200, (x, z) => (x >= 66 && x <= 140 && Math.abs(z) <= 6 ? 8 : null));
  for (const kind of ['car', 'bike']) {
    const r = makeRide(kind, shore, under); r.bounds = [-200, -200, 400, 200];
    assert.equal(r.place(0, 0, Math.PI / 2), true, `${kind}: starts on the land`);
    let sank = false, back = false, maxY = -Infinity;
    for (let i = 0; i < 1200 && !back; i++) {
      r.update(1 / 60, { throttle: sank ? 0 : 1, steer: 0, handbrake: sank });
      if (r.sunk > 0) sank = true;
      if (sank && r.x < 60 && r.sunk === 0) back = true;
      if (sank) maxY = Math.max(maxY, r.y);
    }
    assert.ok(sank, `${kind}: drives into the water under the deck and sinks`);
    assert.ok(back, `${kind}: respawns on the land behind (x=${r.x.toFixed(1)})`);
    assert.ok(Math.abs(r.y - 1) < .3 && maxY < 4, `${kind}: never stands on the deck overhead (y=${r.y.toFixed(2)}, max ${maxY.toFixed(2)})`);
  }
  console.log('PASS a ride that sinks under a deck respawns on the land behind, never on the deck overhead');
}
{
  // A recovery never stands a ride on water: a placement guard that moves a dry road point onto the water under a span
  // (no height given) is refused, and the ride stays put.
  const shore = makeTerrain((x) => ({ ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
  const roads = makeRoads(-200, 200); roads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [130, 0]] }];
  for (const kind of ['car', 'bike']) {
    const r = makeRide(kind, shore, roads); r.bounds = [-200, -200, 400, 200];
    assert.equal(r.place(20, 0, Math.PI / 2), true);
    r.placementGuard = (pose) => { if (pose.x < 60) pose.x = 100; return true; };
    r.respawn();
    assert.ok(r.x < 60, `${kind}: a recovery moved onto the water under a span by its guard is refused (x=${r.x})`);
  }
  console.log('PASS a recovery never stands a ride on the water under a span');
}
// The parked wait as main.ts runs it while the game waits for the first pedal: save the pose, step, then hold it.
function parkedFrame(r) {
  const { x, z, heading, y } = r;
  r.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
  if (r.parkedPlace(x, z, heading, y)) r.speed = 0;
}
{
  // A restart onto land that is still loading, on a bridge span whose deck is not built: when the land arrives, the
  // wet placement is refused and the ordinary dry recovery takes the ride to a dry road point (as on main).
  let loaded = false;
  const shore = makeTerrain((x) => (x >= 60 && !loaded ? null : { ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
  const road = { id: 1, name: 'Span Road', kind: 2, halfWidth: 4, gravel: false, washboard: false, bridge: false, pts: [[-200, 0], [200, 0]] };
  const roads = { roads: [road], deckHeight: () => null, bridgeRuns: () => [{ roads: new Set([1]), pts: [[70, 0], [130, 0]] }],
    // The span reach (8 m) finds the road under the point; a wider search finds a dry point on the land.
    nearest: (x, z, maxDist, filter) => filter && !filter(road) ? null : maxDist <= 8 ? { road, seg: 0, t: 0, dist: Math.abs(z), x, z: 0, heading: Math.PI / 2 } : { road, seg: 0, t: 0, dist: Math.abs(x - 20), x: 20, z: 0, heading: Math.PI / 2 } };
  for (const kind of ['car', 'bike']) {
    loaded = false;
    const r = makeRide(kind, shore, roads); r.bounds = [-200, -200, 400, 200];
    assert.equal(r.place(20, 0, Math.PI / 2), true);
    r.restart(100, 0, Math.PI / 2);
    for (let i = 0; i < 30; i++) parkedFrame(r);
    assert.ok(Math.abs(r.x - 100) < 1e-9, `${kind}: waits for the land at the restart point`);
    loaded = true;
    for (let i = 0; i < 30; i++) parkedFrame(r);
    assert.ok(Math.abs(r.x - 20) < 1 && Math.abs(r.y - 1) < .3, `${kind}: the wet start is refused and the dry recovery takes it to the land (x=${r.x.toFixed(1)}, y=${r.y.toFixed(2)})`);
  }
  console.log('PASS a restart on an unbuilt span over water ends as on main: refused, then a dry recovery');
}
{
  // The parked hold after a step that began while the ride waited for its land: nowhere dry, so the ride stops in the
  // water at the retry's height, and the hold must not use the old body height (9 m), which would take an unrelated
  // deck 8 m up.
  let loaded = false;
  const sea = makeTerrain(() => (loaded ? { ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false } : null));
  const over = makeRoads(-200, 200, (x, z) => (Math.abs(x - 100) <= 30 && Math.abs(z) <= 6 ? 8 : null));
  for (const kind of ['car', 'bike']) {
    loaded = false;
    const r = makeRide(kind, sea, over); r.bounds = [-200, -200, 400, 200];
    Object.assign(r, { x: 100, z: 0, y: 9 });
    r.restart(100, 0, Math.PI / 2);
    loaded = true;
    let maxY = -Infinity;
    for (let i = 0; i < 120; i++) { parkedFrame(r); maxY = Math.max(maxY, r.y); }
    assert.ok(maxY < 4, `${kind}: the parked hold never stands the ride on the deck overhead (max y=${maxY.toFixed(2)})`);
  }
  console.log('PASS the parked hold after a waiting step never uses the old body height');
}
{
  // The hold is skipped only right after a step that began waiting: any later placement outside that step (a restart, a
  // jump) ends it, and the parked hold works again.
  let loaded = false;
  const land = makeTerrain((x) => (x >= 60 && !loaded ? null : { ground: 1, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
  const roads = makeRoads(-200, 200);
  for (const kind of ['car', 'bike']) {
    loaded = false;
    const r = makeRide(kind, land, roads); r.bounds = [-200, -200, 400, 200];
    r.place(100, 0, Math.PI / 2); r.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
    assert.equal(r.parkedPlace(100, 0, Math.PI / 2, 1), false, `${kind}: no hold right after a step that began waiting`);
    assert.equal(r.place(20, 0, Math.PI / 2), true);
    assert.equal(r.parkedPlace(21, 0, Math.PI / 2, 1), true, `${kind}: an explicit placement ends the skip; the hold works again`);
  }
  console.log('PASS the parked-hold skip lasts only until the next placement outside the waiting step');
}
{
  // A Fleet start (truck with its trailer) on a built deck over water, as main allows: the trailer check is judged at
  // fleet's own ground height (the deck), not at the seabed under it.
  const sea = makeTerrain((x) => ({ ground: x < 0 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
  const deckRoads = makeRoads(-200, 200, (x, z) => (x >= 20 && x <= 200 && Math.abs(z) <= 8 ? 2 : null));
  const truck = new Vehicle(createTruck(false, true), sea, deckRoads, SEA, TRUCK_SPEC); truck.assist = 0;
  assert.equal(truck.place(-60, 0, Math.PI / 2), true);
  const tow = new Towing(truck, sea, deckRoads, false, false, {}, true, true);
  const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
  const fleet = new Fleet(truck, tow, sea, deckRoads, scene, true, () => {}, SEA);
  assert.equal(fleet.startVisit(110, 0, Math.PI / 2), true, 'Fleet starts the truck and trailer on the built deck over water');
  assert.ok(Math.abs(truck.x - 110) < 30 && Math.abs(truck.y - 2) < .2, `the rig stands on the deck (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);
  console.log('PASS a Fleet start with the trailer on a built deck over water stands on the deck, as on main');
}
