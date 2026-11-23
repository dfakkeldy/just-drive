// Pure-rules check for ocean sinking, off-map boundaries and above-ground placement/respawn
// across every land ride (car, side by side, pickup, horse, dirt bike), truck+trailer/fleet, and drone.
// Run: node tools/run-node-check.mjs tools/water-bounds-check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { build } from '../web/node_modules/esbuild/lib/main.js';
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
import { DECK_WAIT_SECONDS, Vehicle } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { TRUCK_SPEC, createTruck } from '../web/src/truck.ts';
import { HORSE_SPEC } from '../web/src/horse.ts';
import { BikeRide } from '../web/src/bike-ride.ts';
import { BIKE_SPEC } from '../web/src/bike.ts';
import { Towing } from '../web/src/towing.ts';
import { Fleet } from '../web/src/fleet.ts';
import { placeAtStart } from '../web/src/start-here.ts';
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
// The parked wait as main.ts runs it while the game waits for the first pedal: save the pose, step, then hold it.
function parkedFrame(r) {
  const { x, z, heading, y } = r;
  r.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
  if (r.parkedPlace(x, z, heading, y)) r.speed = 0;
}

function runDeckWaitTests(api, quiet = false) {
  const log = (...args) => { if (!quiet) console.log(...args); };
  const mkRide = (kind, terrain, roads) => {
    if (kind === 'bike') return new api.BikeRide(makeRig(), terrain, roads, SEA, api.BIKE_SPEC);
    const v = new api.Vehicle(makeRig(), terrain, roads, SEA, api.CAR_SPEC);
    v.assist = 0;
    return v;
  };
  const mkTruck = (terrain, roads) => {
    const t = new api.Vehicle(api.createTruck(false, true), terrain, roads, SEA, api.TRUCK_SPEC);
    t.assist = 0;
    return t;
  };
  const mkSpanRoads = (deckRef) => {
    const road = { id: 1, name: 'Span Road', kind: 2, halfWidth: 4, gravel: false, washboard: false, bridge: false, pts: [[-200, 0], [200, 0]] };
    return {
      roads: [road],
      deckHeight: (x, z) => (deckRef.y !== null && x >= 70 && x <= 130 && Math.abs(z) <= 6 ? deckRef.y : null),
      bridgeRuns: () => [{ roads: new Set([1]), pts: [[70, 0], [130, 0]] }],
      // The span reach (8 m) finds the road under the point; a wider search finds a dry point on the land.
      nearest: (x, z, maxDist, filter) => (filter && !filter(road) ? null : maxDist <= 8
        ? { road, seg: 0, t: 0, dist: Math.abs(z), x, z: 0, heading: Math.PI / 2 }
        : { road, seg: 0, t: 0, dist: Math.abs(x - 20), x: 20, z: 0, heading: Math.PI / 2 }),
    };
  };

  // 8a. placeAt on an unbuilt carrying span over water waits without sinking, then stands on the built deck.
  // Direct place(), explicit-height place(), off-span placeAt(), and points outside run.halfWidth are still refused.
  {
    const seabed = makeTerrain(() => ({ ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
    const spanned = makeRoads(-200, 110), elsewhere = makeRoads(-200, 110);
    spanned.bridgeRuns = () => [{ roads: new Set([1]), pts: [[-50, 0], [50, 0]], halfWidth: 4 }];
    elsewhere.bridgeRuns = () => [{ roads: new Set([1]), pts: [[150, 0], [250, 0]], halfWidth: 4 }];
    for (const kind of ['car', 'bike']) {
      let deck = null;
      spanned.deckHeight = (x, z) => (deck !== null && Math.abs(x) <= 50 && Math.abs(z) <= 4 ? deck : null);
      const r = mkRide(kind, seabed, spanned); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(0, 0, Math.PI / 2), false, `${kind}: direct place() in water under an unbuilt span is refused`);
      assert.equal(r.place(0, 0, Math.PI / 2, -3), false, `${kind}: explicit-height place() in water under an unbuilt span is refused`);
      assert.equal(r.placeAt(0, 7, Math.PI / 2), false, `${kind}: placeAt in water 7 m outside a 4 m halfWidth span is refused`);
      const off = mkRide(kind, seabed, elsewhere); off.bounds = [-200, -200, 400, 200];
      assert.equal(off.placeAt(0, 0, Math.PI / 2), false, `${kind}: placeAt in water off any span is refused`);

      assert.equal(r.placeAt(0, 0, Math.PI / 2), true, `${kind}: placeAt on an unbuilt span over water waits for its deck`);
      assert.equal(r.waitingForDeck, true, `${kind}: advertises waitingForDeck while waiting for deck`);
      for (let i = 0; i < 180; i++) parkedFrame(r);
      assert.equal(r.sunk, 0, `${kind}: waiting ride does not sink`);
      assert.ok(Math.abs(r.x) < 1e-9 && Math.abs(r.z) < 1e-9, `${kind}: waiting ride stays at the span (x=${r.x})`);
      assert.ok(kind === 'bike' ? r.ready === false : r.stuck === true, `${kind}: waiting ride holds physics off`);

      // Deck builds (2 m up): next parkedFrame stands the ride on the deck and parkedPlace does not pull it down.
      deck = 2;
      for (let i = 0; i < 3; i++) parkedFrame(r);
      assert.equal(r.waitingForDeck, false, `${kind}: clears waitingForDeck once deck builds`);
      assert.ok(Math.abs(r.y - 2) < .1, `${kind}: stands on the built deck (y=${r.y})`);
      assert.ok(kind === 'bike' ? r.ready === true : r.stuck === false, `${kind}: drivable once the deck builds`);
      const xBefore = r.x;
      for (let i = 0; i < 60; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      assert.ok(r.x > xBefore + 1 && Math.abs(r.y - 2) < .15, `${kind}: drives forward on the built deck (dx=${(r.x - xBefore).toFixed(2)}, y=${r.y.toFixed(2)})`);
    }
    log('PASS placeAt on an unbuilt span over water waits without sinking and stands on the built deck');
  }

  // 8b. Cold-load restart onto unloaded span -> coarse wet land arrives -> stays waiting -> deck builds.
  {
    let loaded = false;
    const deckRef = { y: null };
    const shore = makeTerrain((x) => (x >= 60 && !loaded ? null : { ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: x < 60 ? 8 : 4, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
    const roads = mkSpanRoads(deckRef);
    for (const kind of ['car', 'bike']) {
      loaded = false; deckRef.y = null;
      const r = mkRide(kind, shore, roads); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(20, 0, Math.PI / 2), true);
      assert.equal(r.restart(100, 0, Math.PI / 2), true);
      for (let i = 0; i < 30; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 100) < 1e-9, `${kind}: waits while span land is unloaded`);
      loaded = true;
      for (let i = 0; i < 180; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 100) < 1e-9 && r.sunk === 0, `${kind}: keeps waiting after coarse wet land arrives (x=${r.x}, sunk=${r.sunk})`);
      deckRef.y = 2;
      for (let i = 0; i < 3; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 100) < 1e-9 && Math.abs(r.y - 2) < .1, `${kind}: cold-load restart stands on the deck once built (x=${r.x}, y=${r.y})`);
    }
    log('PASS cold-load restart on an unbuilt span waits across coarse wet land and stands on the built deck');
  }

  // 8c. Deck that never builds (bank stays below level 6): wait ends after DECK_WAIT_SECONDS with dry recovery,
  // parkedPlace does not undo the recovery, and a refused off-span placeAt mid-wait does not reset the clock.
  {
    let loaded = false;
    const deckRef = { y: null };
    const shore = makeTerrain((x) => (x >= 60 && !loaded ? null : { ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: x < 60 ? 8 : 5, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
    const roads = mkSpanRoads(deckRef);
    for (const kind of ['car', 'bike']) {
      loaded = false; deckRef.y = null;
      const r = mkRide(kind, shore, roads); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(20, 0, Math.PI / 2), true);
      assert.equal(r.restart(100, 0, Math.PI / 2), true);
      loaded = true;
      for (let i = 0; i < 60 * 7; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 100) < 1e-9 && r.sunk === 0, `${kind}: still waiting at 7 s (x=${r.x})`);
      // A refused placeAt in open water off the span must not reset the 8 s wait clock.
      assert.equal(r.placeAt(180, 0, Math.PI / 2), false, `${kind}: off-span wet placeAt mid-wait is refused`);
      for (let i = 0; i < 60 * 2; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 20) < 1 && Math.abs(r.y - 1) < .3, `${kind}: deck that never builds recovers to dry land after ${api.DECK_WAIT_SECONDS} s (x=${r.x.toFixed(1)}, y=${r.y.toFixed(2)})`);
      assert.ok(kind === 'bike' ? r.ready === true : r.stuck === false, `${kind}: drivable after dry recovery`);
      const xAfter = r.x;
      for (let i = 0; i < 60; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      assert.ok(r.x > xAfter + 1, `${kind}: drives away from dry fallback (dx=${(r.x - xAfter).toFixed(2)})`);
    }
    // Live restart from a dry off-road pose (with no usable dry road) onto an unbuilt span whose deck never builds
    // must return to the prior dry pose at timeout instead of stranding at -3 m — even if a second off-span restart
    // is refused at 7 s (must not clear the timer or saved dry pose).
    const offRoadWorld = makeTerrain((x) => ({ ground: x < 40 ? 2 : -3, canopy: 0, roadDist: x >= 70 ? 0 : 99, halfWidth: 4, kind: x >= 70 ? 2 : 0, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: x >= 70, deck: false }));
    const wetRoad = makeRoads(70, 150);
    wetRoad.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [150, 0]], halfWidth: 4 }];
    for (const kind of ['car', 'bike']) {
      const r = mkRide(kind, offRoadWorld, wetRoad); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(10, 0, Math.PI / 2), true);
      assert.equal(r.restart(100, 0, Math.PI / 2), true);
      for (let i = 0; i < 60 * 7; i++) parkedFrame(r);
      assert.equal(r.restart(200, 0, Math.PI / 2), false, `${kind}: off-span second restart at 7 s is refused`);
      for (let i = 0; i < 60 * 2; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 10) < .1 && Math.abs(r.y - 2) < .2, `${kind}: failed live restart from off-road dry pose returns to prior dry pose at 8 s even after refused second restart (x=${r.x.toFixed(1)}, y=${r.y.toFixed(2)})`);
      assert.ok(kind === 'bike' ? r.ready === true : r.stuck === false, `${kind}: drivable after returning to prior dry pose`);

      // If destination terrain unloads mid-wait (main.ts missing-surface branch!), waitingForDeck must stay true so the 8 s timer expires and restores the prior dry pose.
      let spanLoaded = true;
      const unloadWorld = makeTerrain((x) => (x < 40
        ? { ground: 2, canopy: 0, roadDist: 99, halfWidth: 4, kind: 0, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }
        : spanLoaded ? { ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false } : null));
      const ru = mkRide(kind, unloadWorld, wetRoad); ru.bounds = [-200, -200, 400, 200];
      assert.equal(ru.place(10, 0, Math.PI / 2), true);
      assert.equal(ru.restart(100, 0, Math.PI / 2), true);
      assert.equal(ru.waitingForDeck, true);
      for (let i = 0; i < 60; i++) parkedFrame(ru);
      spanLoaded = false;
      for (let i = 0; i < 60 * 9; i++) {
        if (!ru.waitingForDeck && unloadWorld.surfaceAt(ru.x, ru.z)?.level === undefined) ru.retryPlace();
        else parkedFrame(ru);
      }
      assert.ok(Math.abs(ru.x - 10) < .1 && Math.abs(ru.y - 2) < .2, `${kind}: mid-wait tile unload preserves deadline and restores prior dry pose (x=${ru.x.toFixed(1)}, y=${ru.y.toFixed(2)})`);
      assert.ok(kind === 'bike' ? ru.ready === true : ru.stuck === false, `${kind}: drivable after mid-wait unload timeout recovery`);

      // Even if the bridge deck appears at 2 s while terrain beneath remains unloaded, the deadline still runs and restores the prior dry pose.
      let deckOnUnload = null;
      const unloadDeckRoads = makeRoads(70, 150, (x, z) => (deckOnUnload !== null && x >= 70 && x <= 150 && Math.abs(z) <= 4 ? deckOnUnload : null));
      unloadDeckRoads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [150, 0]], halfWidth: 4 }];
      spanLoaded = true;
      const rud = mkRide(kind, unloadWorld, unloadDeckRoads); rud.bounds = [-200, -200, 400, 200];
      assert.equal(rud.place(10, 0, Math.PI / 2), true);
      assert.equal(rud.restart(100, 0, Math.PI / 2), true);
      for (let i = 0; i < 60; i++) parkedFrame(rud);
      spanLoaded = false;
      for (let i = 0; i < 60; i++) {
        if (!rud.waitingForDeck && unloadWorld.surfaceAt(rud.x, rud.z)?.level === undefined) rud.retryPlace();
        else parkedFrame(rud);
      }
      deckOnUnload = 8;
      for (let i = 0; i < 60 * 10; i++) {
        if (!rud.waitingForDeck && unloadWorld.surfaceAt(rud.x, rud.z)?.level === undefined) rud.retryPlace();
        else parkedFrame(rud);
      }
      assert.ok(Math.abs(rud.x - 10) < .1 && Math.abs(rud.y - 2) < .2, `${kind}: deck arriving over unloaded terrain still honors 8 s deadline and restores prior dry pose (x=${rud.x.toFixed(1)}, y=${rud.y.toFixed(2)})`);
      assert.ok(kind === 'bike' ? rud.ready === true : rud.stuck === false, `${kind}: drivable after deck-over-unloaded-terrain timeout`);

      // If the starting dry tile unloaded while waiting at a distant unbuilt span, timeout returns to the saved starting
      // coordinates so the camera reloads that tile, and the ride becomes drivable as soon as the starting tile reloads.
      let startTileLoaded = true;
      const distantWorld = makeTerrain((x) => (x < 40
        ? (startTileLoaded ? { ground: 2, canopy: 0, roadDist: 99, halfWidth: 4, kind: 0, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false } : null)
        : { ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
      const rd = mkRide(kind, distantWorld, wetRoad); rd.bounds = [-200, -200, 400, 200];
      assert.equal(rd.place(10, 0, Math.PI / 2), true);
      assert.equal(rd.restart(100, 0, Math.PI / 2), true);
      startTileLoaded = false;
      for (let i = 0; i < 60 * 9; i++) parkedFrame(rd);
      assert.ok(Math.abs(rd.x - 10) < .1, `${kind}: timeout returns to saved starting pose even while starting tile is unloaded (x=${rd.x.toFixed(1)})`);
      startTileLoaded = true;
      for (let i = 0; i < 60; i++) rd.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      assert.ok(rd.x > 11 && Math.abs(rd.y - 2) < .2, `${kind}: drivable once unloaded starting tile reloads after timeout (x=${rd.x.toFixed(1)}, y=${rd.y.toFixed(2)})`);
    }
    // Road vertex fallback keeps walking past a guard-rejected first dry vertex to the next accepted dry vertex.
    const guardWorld = makeTerrain((x) => ({ ground: x <= 323 ? 2 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const guardRoads = makeRoads(-260, 640);
    guardRoads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[330, 0], [640, 0]], halfWidth: 4 }];
    for (const kind of ['car', 'bike']) {
      const r = mkRide(kind, guardWorld, guardRoads); r.bounds = [-300, -200, 700, 200];
      r.placementGuard = (pose) => pose.x <= 310 || pose.x >= 329;
      assert.equal(r.restart(330, 0, Math.PI / 2), true);
      for (let i = 0; i < 60 * 9; i++) parkedFrame(r);
      assert.ok(r.x <= 310.1 && Math.abs(r.y - 2) < .2, `${kind}: dry road vertex search skips guard-rejected first vertex to next dry vertex (x=${r.x.toFixed(1)}, y=${r.y.toFixed(2)})`);
    }
    log('PASS a deck that never builds ends the wait at 8 s with dry recovery that parkedPlace keeps');
  }

  // 8d. A ride that sinks under a high deck respawns on dry land behind, never on the deck overhead —
  // both when the deck belongs to another road AND (for bike) when the deck carries the nearest road and lastSafe is dry.
  {
    const shore = makeTerrain((x) => ({ ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const under = makeRoads(-200, 200, (x, z) => (x >= 66 && x <= 140 && Math.abs(z) <= 6 ? 8 : null));
    for (const kind of ['car', 'bike']) {
      const r = mkRide(kind, shore, under); r.bounds = [-200, -200, 400, 200];
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
    // Bike off-road (no roadTrail) sinking directly under a built carrying span must return to lastSafe at 2 m, not 8 m overhead.
    const bikeOff = makeTerrain((x) => {
      const ground = x <= 40 ? 2 : x < 60 ? 2 + (-0.35 - 2) * (x - 40) / 20 : -0.35;
      return { ground, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false };
    });
    const carrying = makeRoads(-200, 200, (x, z) => (x >= 60 && x <= 140 && Math.abs(z) <= 6 ? 8 : null));
    carrying.bridgeRuns = () => [{ roads: new Set([1]), pts: [[60, 0], [140, 0]], halfWidth: 6 }];
    const b = mkRide('bike', bikeOff, carrying); b.bounds = [-200, -200, 400, 200];
    assert.equal(b.place(10, 0, Math.PI / 2), true);
    let bikeMaxY = -Infinity, bikeSank = false, bikeRecovered = false;
    for (let i = 0; i < 600 && !bikeRecovered; i++) {
      b.update(1 / 60, { throttle: bikeSank ? 0 : 1, steer: 0, handbrake: bikeSank });
      if (b.sunk > 0 && b.x >= 60) bikeSank = true;
      if (bikeSank && b.sunk === 0) bikeRecovered = true;
      bikeMaxY = Math.max(bikeMaxY, b.y);
    }
    assert.ok(bikeSank && bikeRecovered, 'bike: sinks under carrying deck and recovers');
    assert.ok(bikeMaxY < 4, `bike: sinking under a carrying deck uses lastSafe at 2 m, never lifts to 8 m overhead (maxY=${bikeMaxY.toFixed(2)})`);
    // Even when lastSafe is rejected by placementGuard, bike sinking near bounds recovers to dry clamped road at 2 m, never lifting onto 8 m deck overhead.
    {
      const clampedRoad = { id: 2, name: 'Dry Road', kind: 2, halfWidth: 4, gravel: false, washboard: false, bridge: false, pts: [[0, 0], [40, 0]] };
      const bridgeRoad = { id: 1, name: 'Span Road', kind: 2, halfWidth: 4, gravel: false, washboard: false, bridge: false, pts: [[60, 0], [140, 0]] };
      const mixed = {
        roads: [bridgeRoad, clampedRoad],
        deckHeight: (x, z) => (x >= 60 && x <= 140 && Math.abs(z) <= 6 ? 8 : null),
        bridgeRuns: () => [{ roads: new Set([1]), pts: [[60, 0], [140, 0]], halfWidth: 6 }],
        nearest: (x, z, maxDist, filter) => {
          const hit = x >= 55
            ? { road: bridgeRoad, seg: 0, t: 0, dist: Math.abs(z), x: Math.max(60, Math.min(140, x)), z: 0, heading: Math.PI / 2 }
            : { road: clampedRoad, seg: 0, t: 0, dist: Math.abs(z), x: Math.max(0, Math.min(40, x)), z: 0, heading: Math.PI / 2 };
          if (filter && !filter(hit.road)) return null;
          return hit.dist <= maxDist ? hit : null;
        },
      };
      const b2 = mkRide('bike', bikeOff, mixed); b2.bounds = [-20, -200, 68, 200];
      assert.equal(b2.place(10, 0, Math.PI / 2), true);
      let b2MaxY = -Infinity, b2Sank = false, b2Recovered = false;
      for (let i = 0; i < 600 && !b2Recovered; i++) {
        b2.update(1 / 60, { throttle: b2Sank ? 0 : 1, steer: 0, handbrake: b2Sank });
        if (b2.sunk > 0 && b2.x >= 60) {
          b2Sank = true;
          // Reject lastSafe (around x = 50..59) while allowing both clamped dry road (x <= 41) and overhead deck (x >= 60).
          b2.placementGuard = (pose) => pose.x <= 41 || pose.x >= 60;
        }
        if (b2Sank && b2.sunk === 0) b2Recovered = true;
        b2MaxY = Math.max(b2MaxY, b2.y);
      }
      assert.ok(b2Sank && b2Recovered, 'bike: sinks near edge under carrying deck and recovers');
      assert.ok(b2MaxY < 4 && b2.x <= 41, `bike: when lastSafe is rejected, clamped dry road at 2 m wins over 8 m overhead deck (x=${b2.x.toFixed(1)}, maxY=${b2MaxY.toFixed(2)})`);
    }
    log('PASS a ride that sinks under a deck respawns on the land behind, never on the deck overhead');
  }

  // 8e. Recovery never stands a ride on water under an unbuilt span (placementGuard shifting a dry road point onto the span).
  {
    const shore = makeTerrain((x) => ({ ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
    const roads = makeRoads(-200, 200); roads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [130, 0]] }];
    for (const kind of ['car', 'bike']) {
      const r = mkRide(kind, shore, roads); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(20, 0, Math.PI / 2), true);
      r.placementGuard = (pose) => { if (pose.x < 60) pose.x = 100; return true; };
      r.respawn();
      assert.ok(r.x < 60, `${kind}: a recovery moved onto the water under an unbuilt span by its guard is refused (x=${r.x})`);
    }
    log('PASS a recovery never stands a ride on the water under an unbuilt span');
  }

  // 8f. Failed retry with nowhere dry (off-span AND after unbuilt-span timeout) stands at retry height (-3),
  // never at old body height (9 m) or on an unrelated deck overhead (8 m), and stays #waterStopped with zero creep.
  {
    let loaded = false;
    const sea = makeTerrain(() => (loaded ? { ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false } : null));
    const over = makeRoads(-200, 200, (x, z) => (Math.abs(x - 100) <= 30 && Math.abs(z) <= 6 ? 8 : null));
    for (const kind of ['car', 'bike']) {
      loaded = false;
      const r = mkRide(kind, sea, over); r.bounds = [-200, -200, 400, 200];
      Object.assign(r, { x: 100, z: 0, y: 9 });
      r.restart(100, 0, Math.PI / 2);
      loaded = true;
      let maxY = -Infinity;
      for (let i = 0; i < 120; i++) { parkedFrame(r); maxY = Math.max(maxY, r.y); }
      assert.ok(maxY < 4, `${kind}: the parked hold after a failed retry never stands on the deck overhead (max y=${maxY.toFixed(2)})`);
    }
    // Same with an unbuilt-span timeout where nowhere dry exists: stops in water at -3 with zero creep, never takes a later deck overhead.
    let lateDeck = null;
    const allSea = makeTerrain(() => ({ ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 5, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
    const spanOnly = makeRoads(-200, 200, (x, z) => (lateDeck !== null && Math.abs(x - 100) <= 30 && Math.abs(z) <= 6 ? lateDeck : null));
    spanOnly.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [130, 0]] }];
    for (const kind of ['car', 'bike']) {
      lateDeck = null;
      const r = mkRide(kind, allSea, spanOnly); r.bounds = [-200, -200, 400, 200];
      Object.assign(r, { x: 100, z: 0, y: 9 });
      assert.equal(r.restart(100, 0, Math.PI / 2), true);
      for (let i = 0; i < 60 * 9; i++) parkedFrame(r);
      assert.ok(r.y < 0, `${kind}: timed-out wait with nowhere dry stops at seabed height (y=${r.y.toFixed(2)})`);
      const xStop = r.x, zStop = r.z;
      lateDeck = 8;
      for (let i = 0; i < 60; i++) {
        r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
        assert.ok(r.y < 0, `${kind}: #waterStopped ride never jumps to a deck that builds after timeout (y=${r.y.toFixed(2)})`);
      }
      assert.ok(Math.hypot(r.x - xStop, r.z - zStop) < 1e-6, `${kind}: #waterStopped after timeout holds zero seabed creep`);
    }
    log('PASS failed retries with nowhere dry stand at retry height and stay water-stopped with zero creep');
  }

  // 8g. #waterStopped and active sinking before the wait: starting on an unbuilt span clears both, waits without
  // sinking even under full throttle, and drives cleanly once the deck builds.
  {
    let flooded = false, deck = null;
    const world = makeTerrain((x) => ({ ground: flooded || x >= 50 ? -3 : 3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: x >= 50, deck: false }));
    const roads = makeRoads(-100, 200, (x, z) => (deck !== null && x >= 70 && x <= 130 && Math.abs(z) <= 6 ? deck : null));
    roads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [130, 0]] }];
    for (const kind of ['car', 'bike']) {
      flooded = false; deck = null;
      const r = mkRide(kind, world, roads); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(0, 0, Math.PI / 2), true);
      // Flood everything so the ride sinks and enters #waterStopped.
      flooded = true;
      for (let i = 0; i < 180; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      const xStop = r.x;
      for (let i = 0; i < 30; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      assert.ok(Math.hypot(r.x - xStop, r.z) < 1e-6, `${kind}: confirmed #waterStopped before span start`);

      // Now placeAt (not restart!) on the unbuilt span: must clear #waterStopped and sunk, wait without sinking under full throttle.
      assert.equal(r.placeAt(100, 0, Math.PI / 2), true, `${kind}: placeAt from #waterStopped enters span wait`);
      assert.equal(r.sunk, 0, `${kind}: sunk reset on span wait`);
      for (let i = 0; i < 180; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      assert.equal(r.sunk, 0, `${kind}: waiting ride does not sink under held throttle`);
      assert.ok(Math.abs(r.x - 100) < 1e-9, `${kind}: waiting ride does not move under held throttle`);

      // Deck builds (2 m): ride stands on deck and drives forward (proving #waterStopped is cleared).
      deck = 2;
      r.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
      assert.ok(Math.abs(r.y - 2) < .1, `${kind}: stands on built deck after #waterStopped wait (y=${r.y})`);
      for (let i = 0; i < 60; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      assert.ok(r.x > 101 && Math.abs(r.y - 2) < .15, `${kind}: drives cleanly on deck after #waterStopped wait (x=${r.x.toFixed(2)})`);
    }
    // Also: a #waterStopped ride that enters an unbuilt-span wait which later times out onto a built dry deck
    // must NOT carry stale #waterStopped into the retry fallback (which would yank it off the deck to land=-3).
    for (const kind of ['car', 'bike']) {
      let flooded2 = false;
      const seaWithDeck = makeTerrain((x) => ({ ground: flooded2 || x >= 10 ? -3 : 3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: x >= 70, deck: false }));
      const road = { id: 1, name: 'Bridge Road', kind: 2, halfWidth: 4, gravel: false, washboard: false, bridge: false, pts: [[-100, 0], [200, 0]] };
      const rds = {
        roads: [road],
        deckHeight: (x, z) => (x >= 15 && x <= 45 && Math.abs(z) <= 6 ? 8 : null),
        bridgeRuns: () => [{ roads: new Set([1]), pts: [[15, 0], [45, 0]] }, { roads: new Set([1]), pts: [[70, 0], [130, 0]] }],
        nearest: (x, z, maxDist, filter) => (filter && !filter(road) ? null : maxDist <= 8
          ? { road, seg: 0, t: 0, dist: Math.abs(z), x, z: 0, heading: Math.PI / 2 }
          : { road, seg: 0, t: 0, dist: Math.abs(x - 30), x: 30, z: 0, heading: Math.PI / 2 }),
      };
      const r = mkRide(kind, seaWithDeck, rds); r.bounds = [-200, -200, 400, 200];
      assert.equal(r.place(0, 0, Math.PI / 2), true);
      // Drive into water at x=-50 with no dry fallback yet? Flood x < 10 and block x = 30 temporarily to enter #waterStopped.
      let blockDeck = true;
      r.placementGuard = (pose) => !(blockDeck && pose.x >= 15 && pose.x <= 45);
      flooded2 = true;
      for (let i = 0; i < 180; i++) r.update(1 / 60, { throttle: 1, steer: 0, handbrake: false });
      blockDeck = false;
      // Now #waterStopped is true; placeAt on unbuilt span at x=100 (deck never builds), timeout recovers to built deck at x=30, y=8.
      assert.equal(r.placeAt(100, 0, Math.PI / 2), true, `${kind}: placeAt from #waterStopped on unbuilt span`);
      for (let i = 0; i < 60 * 9; i++) parkedFrame(r);
      assert.ok(Math.abs(r.x - 30) < 1 && Math.abs(r.y - 8) < .2, `${kind}: stale #waterStopped never yanks timed-out recovery off the 8 m deck (x=${r.x.toFixed(1)}, y=${r.y.toFixed(2)})`);
    }
    log('PASS #waterStopped and sinking clear cleanly into the span wait and drive once the deck builds');
  }

  // 8h. The parked-hold skip lasts only until the next placement outside the waiting step.
  {
    let loaded = false;
    const land = makeTerrain((x) => (x >= 60 && !loaded ? null : { ground: 1, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    const roads = makeRoads(-200, 200);
    for (const kind of ['car', 'bike']) {
      loaded = false;
      const r = mkRide(kind, land, roads); r.bounds = [-200, -200, 400, 200];
      r.place(100, 0, Math.PI / 2); r.update(1 / 60, { throttle: 0, steer: 0, handbrake: true });
      assert.equal(r.parkedPlace(100, 0, Math.PI / 2, 1), false, `${kind}: no hold right after a step that began waiting`);
      assert.equal(r.place(20, 0, Math.PI / 2), true);
      assert.equal(r.parkedPlace(21, 0, Math.PI / 2, 1), true, `${kind}: an explicit placement ends the skip; the hold works again`);
    }
    log('PASS the parked-hold skip lasts only until the next placement outside the waiting step');
  }

  // 8i. Fleet on an unbuilt bridge span over water: cold start, live jump, camera framing, deck that never builds
  // (shore within 120 m, cold-boot long bridge > 120 m from dry road, and all-water rollback), and #waterStopped recovery.
  {
    let deck = null;
    const sea = makeTerrain((x) => ({ ground: x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: x >= 70, deck: false }));
    const spanRoads = makeRoads(-260, 640, (x, z) => (deck !== null && x >= 70 && x <= 640 && Math.abs(z) <= 8 ? deck : null));
    spanRoads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [640, 0]] }];

    // Cold boot (deferVisit = true) at x = 100 (within 120 m of dry shore at x < 60): must wait for deck, NOT slide to shore!
    {
      deck = null;
      const truck = mkTruck(sea, spanRoads);
      assert.equal(truck.place(-60, 0, Math.PI / 2), true);
      const tow = new api.Towing(truck, sea, spanRoads, false, false, {}, true, true);
      const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
      const fleet = new api.Fleet(truck, tow, sea, spanRoads, scene, true, () => {}, SEA, undefined, true);
      assert.equal(fleet.startVisit(100, 0, Math.PI / 2), false, 'Fleet cold start on unbuilt span queues wait');
      assert.equal(fleet.visitQueued, true, 'Fleet cold start reports visitQueued while waiting for bridge deck');
      assert.equal(fleet.busy, true, 'Fleet cold start is busy while waiting for bridge deck');
      const attempts0 = fleet.teleportAttempts;
      for (let i = 0; i < 180; i++) {
        fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
        fleet.refresh(1 / 60);
      }
      assert.equal(fleet.visitQueued, true, 'Fleet stays waiting for bridge deck at 3 s (does not slide to shore)');
      assert.equal(fleet.teleportAttempts, attempts0, 'Fleet makes zero teleports while waiting for bridge deck');
      assert.equal(truck.sunk, 0, 'Fleet truck does not sink while waiting for bridge deck');
      deck = 8;
      fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, false, 'Fleet finishes queued visit once bridge deck builds');
      assert.equal(fleet.busy, false, 'Fleet is playable once bridge deck builds');
      assert.ok(Math.abs(truck.x - 100) < 30 && Math.abs(truck.y - 8) < .2, `Fleet cold start stands on built deck (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);

      // Cold boot on an unloaded span whose terrain later loads as DRY land must spawn on the next frame (not wait 8 s).
      let loadedDry = false;
      const drySpanLand = makeTerrain((x) => (!loadedDry && x >= 70 ? null : { ground: 2, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
      const drySpanRoads = makeRoads(-260, 640);
      drySpanRoads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[70, 0], [640, 0]], halfWidth: 4 }];
      const truckDry = mkTruck(drySpanLand, drySpanRoads);
      assert.equal(truckDry.place(-60, 0, Math.PI / 2), true);
      const towDry = new api.Towing(truckDry, drySpanLand, drySpanRoads, false, false, {}, true, true);
      const sceneDry = new THREE.Scene(); sceneDry.add(truckDry.car.root, towDry.trailer.root);
      const fleetDry = new api.Fleet(truckDry, towDry, drySpanLand, drySpanRoads, sceneDry, true, () => {}, SEA, undefined, true);
      assert.equal(fleetDry.startVisit(100, 0, Math.PI / 2), false, 'Fleet cold start on unloaded span queues wait');
      assert.equal(fleetDry.waitingForDeck, true);
      loadedDry = true;
      drySpanLand.fleetGroundChanged?.(0, -50, 200);
      fleetDry.refresh(1 / 60);
      assert.equal(fleetDry.visitQueued, false, 'Fleet spawns on next frame once dry terrain loads under unloaded span');
      assert.equal(fleetDry.busy, false, 'Fleet is playable immediately after dry terrain loads');
      assert.ok(Math.abs(truckDry.x - 100) < 30 && Math.abs(truckDry.y - 2) < .2, `Fleet stands on loaded dry land (x=${truckDry.x.toFixed(1)}, y=${truckDry.y.toFixed(2)})`);

      // Place jump to an unbuilt span while the first spawn is still queued must preserve the queued first spawn.
      deck = null;
      let startLoaded = false;
      const firstSpawnLand = makeTerrain((x) => (x < 60
        ? (startLoaded ? { ground: 2, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false } : null)
        : { ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false }));
      const truckFirst = mkTruck(firstSpawnLand, spanRoads);
      startLoaded = true;
      assert.equal(truckFirst.place(-60, 0, Math.PI / 2), true);
      const towFirst = new api.Towing(truckFirst, firstSpawnLand, spanRoads, false, false, {}, true, true);
      startLoaded = false;
      const sceneFirst = new THREE.Scene(); sceneFirst.add(truckFirst.car.root, towFirst.trailer.root);
      const fleetFirst = new api.Fleet(truckFirst, towFirst, firstSpawnLand, spanRoads, sceneFirst, true, () => {}, SEA, undefined, true);
      assert.equal(fleetFirst.startVisit(-20, 0, Math.PI / 2), false, 'first spawn queues while unloaded');
      assert.equal(fleetFirst.restart(330, 0, Math.PI / 2, 'place-jump'), false, 'place-jump to unbuilt span while unspawned is refused without replacing first spawn');
      assert.equal(fleetFirst.waitingForDeck, false, 'unspawned place-jump does not replace pending first spawn with deck wait');
      startLoaded = true;
      firstSpawnLand.fleetGroundChanged?.(-100, -50, 200);
      fleetFirst.refresh(1 / 60);
      assert.equal(fleetFirst.visitQueued, false, 'original first spawn commits once its dry terrain loads');
      assert.ok(Math.abs(truckFirst.x - (-20)) < 30 && Math.abs(truckFirst.y - 2) < .2, `Fleet stands at original first spawn (x=${truckFirst.x.toFixed(1)}, y=${truckFirst.y.toFixed(2)})`);
    }

    // Live Fleet (spawned = true) place-jump to unbuilt span: frames camera over bridge, defers onCommit until commit,
    // refuses off-span water and points outside run.halfWidth without changing deckWaitToken.
    {
      deck = null;
      const truck = mkTruck(sea, spanRoads);
      assert.equal(truck.place(-60, 0, Math.PI / 2), true);
      const tow = new api.Towing(truck, sea, spanRoads, false, false, {}, true, true);
      const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
      const fleet = new api.Fleet(truck, tow, sea, spanRoads, scene, true, () => {}, SEA);
      // Off-span water and outside span width are refused immediately (no deck wait, deckWaitToken unchanged).
      const tok0 = fleet.deckWaitToken;
      assert.equal(fleet.restart(720, 0, Math.PI / 2, 'place-jump'), false);
      assert.equal(fleet.visitQueued, false, 'Fleet off-span wet place-jump is refused immediately without queueing');
      assert.equal(fleet.deckWaitToken, tok0, 'refused off-span jump does not increment deckWaitToken');

      // On-span unbuilt bridge jump waits, aims camera over waiting span, defers onCommit until deck builds.
      let commits = 0;
      assert.equal(fleet.restart(330, 0, Math.PI / 2, 'place-jump', undefined, () => { commits++; }), false);
      assert.equal(fleet.visitQueued, true, 'Fleet live place-jump onto unbuilt span waits for deck');
      assert.equal(fleet.waitingForDeck, true, 'Fleet advertises waitingForDeck during span wait');
      assert.ok(fleet.deckWaitToken > tok0, 'queued span jump increments deckWaitToken');
      assert.equal(commits, 0, 'queued Fleet jump does not run onCommit before placement succeeds');
      // A refused second jump while first is queued does not increment deckWaitToken or run onCommit.
      const tok1 = fleet.deckWaitToken;
      assert.equal(fleet.restart(720, 0, Math.PI / 2, 'place-jump', undefined, () => { commits += 100; }), false);
      assert.equal(fleet.deckWaitToken, tok1, 'refused second jump while queued leaves deckWaitToken unchanged');
      assert.equal(commits, 0, 'refused second jump never fires onCommit');
      const cam = new THREE.PerspectiveCamera(58, 1.5, 0.3, 4000);
      assert.equal(fleet.camera(cam, 1 / 60), true, 'Fleet camera frames the waiting bridge span while spawned');
      assert.ok(Math.abs(cam.position.x - 330) < 30, `Fleet camera moved near waiting span (cam.x=${cam.position.x.toFixed(1)})`);
      deck = 8;
      fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, false, 'Fleet live jump completes once deck builds');
      assert.equal(commits, 1, 'Fleet jump fires onCommit exactly once when deck builds');
      assert.ok(Math.abs(truck.x - 330) < 30 && Math.abs(truck.y - 8) < .2, `Fleet live jump stands on built deck (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);
    }

    // Fleet deck that never builds:
    // (1) Cold boot on long bridge (> 120 m from shore) falls back to wide dry road after 8 s,
    // honors accepts guard (never bypasses it), and does not restart an 8 s wait when shore dries after timeout.
    {
      deck = null;
      const truck = mkTruck(sea, spanRoads);
      assert.equal(truck.place(-60, 0, Math.PI / 2), true);
      const tow = new api.Towing(truck, sea, spanRoads, false, false, {}, true, true);
      const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
      const fleet = new api.Fleet(truck, tow, sea, spanRoads, scene, true, () => {}, SEA, undefined, true);
      fleet.startVisit(330, 0, Math.PI / 2);
      for (let i = 0; i < 60 * 7; i++) fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, true, 'Fleet cold start on long unbuilt span still waits at 7 s');
      for (let i = 0; i < 60 * 2; i++) fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, false, 'Fleet cold start on long unbuilt span ends wait after 8 s');
      assert.ok(truck.x < 60 && Math.abs(truck.y - 1) < .2, `Fleet cold start recovers onto dry road after 8 s (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);

      // Guarded Start-where-I-am candidate on an unbuilt span never queues a deck wait or strands Fleet:
      // candidate 1 fails immediately so Start where I am advances to candidate 2 on dry land.
      const truckG = mkTruck(sea, spanRoads);
      assert.equal(truckG.place(-60, 0, Math.PI / 2), true);
      const towG = new api.Towing(truckG, sea, spanRoads, false, false, {}, true, true);
      const sceneG = new THREE.Scene(); sceneG.add(truckG.car.root, towG.trailer.root);
      const fleetG = new api.Fleet(truckG, towG, sea, spanRoads, sceneG, true, () => {}, SEA, undefined, true);
      const tokG = fleetG.deckWaitToken;
      assert.equal(fleetG.startVisit(330, 0, Math.PI / 2, (pose) => Math.hypot(pose.x - 330, pose.z) < 1e-6), false);
      assert.equal(fleetG.waitingForDeck, false, 'guarded Fleet startVisit on unbuilt span skips deck wait');
      assert.equal(fleetG.deckWaitToken, tokG, 'guarded Fleet startVisit on unbuilt span leaves deckWaitToken unchanged');
      assert.equal(fleetG.startVisit(20, 0, Math.PI / 2, (pose) => Math.hypot(pose.x - 20, pose.z) < 1e-6), true, 'Start where I am advances to next dry candidate and spawns cleanly');
      assert.equal(fleetG.busy, false, 'Fleet is playable after Start where I am takes dry candidate 2');

      // Cold-start after timeout: when shore becomes dry after deadline, visitDirty spawns immediately (no second 8 s wait).
      let shoreDry = true;
      const delayedShore = makeTerrain((x) => ({ ground: shoreDry && x < 60 ? 1 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: x >= 70, deck: false }));
      const truckD = mkTruck(delayedShore, spanRoads);
      assert.equal(truckD.place(-60, 0, Math.PI / 2), true);
      const towD = new api.Towing(truckD, delayedShore, spanRoads, false, false, {}, true, true);
      shoreDry = false;
      const sceneD = new THREE.Scene(); sceneD.add(truckD.car.root, towD.trailer.root);
      const fleetD = new api.Fleet(truckD, towD, delayedShore, spanRoads, sceneD, true, () => {}, SEA, undefined, true);
      // Also verify off-span wet startVisit does NOT increment deckWaitToken (so Start where I am tries next candidate).
      const tokCold = fleetD.deckWaitToken;
      fleetD.startVisit(720, 0, Math.PI / 2);
      assert.equal(fleetD.deckWaitToken, tokCold, 'cold off-span failure does not increment deckWaitToken');
      fleetD.startVisit(100, 0, Math.PI / 2);
      for (let i = 0; i < 60 * 9; i++) fleetD.refresh(1 / 60);
      assert.equal(fleetD.waitingForDeck, false, 'cold wait exhausted after 8 s');
      shoreDry = true;
      delayedShore.fleetGroundChanged?.(0, -50, 200);
      fleetD.refresh(1 / 60);
      assert.equal(fleetD.visitQueued, false, `cold fallback spawns immediately when shore becomes usable after timeout (msg=${fleetD.message} waiting=${fleetD.waitingForDeck} x=${truckD.x})`);
      assert.ok(truckD.x <= 60 && Math.abs(truckD.y - 1) < .2, `cold fallback lands on newly dry shore (x=${truckD.x.toFixed(1)}, y=${truckD.y.toFixed(2)})`);
    }

    // (2) Live jump to unbuilt span whose deck never builds: falls back to dry shore within 120 m, OR preserves old dry pose when all water (without firing onCommit).
    {
      deck = null;
      const truck = mkTruck(sea, spanRoads);
      assert.equal(truck.place(-60, 0, Math.PI / 2), true);
      const tow = new api.Towing(truck, sea, spanRoads, false, false, {}, true, true);
      const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
      const fleet = new api.Fleet(truck, tow, sea, spanRoads, scene, true, () => {}, SEA);
      fleet.restart(100, 0, Math.PI / 2, 'place-jump');
      for (let i = 0; i < 60 * 7; i++) fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, true, 'Fleet live jump still waits at 7 s');
      for (let i = 0; i < 60 * 2; i++) fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, false, 'Fleet live jump ends wait after 8 s');
      assert.ok(truck.x <= 60 && Math.abs(truck.y - 1) < .2, `Fleet live jump recovers to dry shore after 8 s (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);

      // Jump to x = 330 (> 120 m from shore) where deck never builds: atomic rollback keeps previous dry pose playable and never fires onCommit.
      const prevX = truck.x, prevY = truck.y;
      let badCommits = 0;
      fleet.restart(330, 0, Math.PI / 2, 'place-jump', undefined, () => { badCommits++; });
      assert.equal(fleet.visitQueued, true);
      for (let i = 0; i < 60 * 9; i++) fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, false, 'Fleet live jump with no dry shore clears wait after 8 s');
      assert.equal(fleet.busy, false, 'Fleet remains playable after timed-out jump');
      assert.equal(badCommits, 0, 'timed-out Fleet jump with no dry fallback never fires onCommit');
      assert.ok(Math.abs(truck.x - prevX) < 1e-6 && Math.abs(truck.y - prevY) < 1e-6, 'Fleet timed-out jump with nowhere dry preserves exact prior dry pose');
    }

    // (3) Fleet #waterStopped interaction + R cancels pending wait.
    {
      deck = null;
      const truck = mkTruck(sea, spanRoads);
      assert.equal(truck.place(20, 0, Math.PI / 2), true);
      const tow = new api.Towing(truck, sea, spanRoads, false, false, {}, true, true);
      const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
      const fleet = new api.Fleet(truck, tow, sea, spanRoads, scene, true, () => {}, SEA);
      // Drive into water until stopped.
      for (let i = 0; i < 600; i++) fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
      const xStopped = truck.x;
      for (let i = 0; i < 60; i++) fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
      assert.ok(Math.abs(truck.x - xStopped) < 1e-6, 'Fleet truck confirmed water-stopped before span jump');

      // Jump onto unbuilt span: waits without creeping, then stands on built deck and drives forward cleanly.
      fleet.restart(330, 0, Math.PI / 2, 'place-jump');
      assert.equal(fleet.visitQueued, true);
      for (let i = 0; i < 120; i++) {
        fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
        fleet.refresh(1 / 60);
      }
      assert.ok(Math.abs(truck.x - xStopped) < 1e-6, 'Fleet water-stopped truck stays still during span wait');
      deck = 8;
      fleet.refresh(1 / 60);
      assert.equal(fleet.visitQueued, false);
      assert.ok(Math.abs(truck.x - 330) < 30 && Math.abs(truck.y - 8) < .2, `Fleet recovers from water-stop onto built deck (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);
      const xDeck = truck.x;
      for (let i = 0; i < 60; i++) fleet.drive(1 / 60, { throttle: 1, steer: 0, handbrake: false }, () => fleet.resolve());
      assert.ok(truck.x > xDeck + 1, `Fleet drives forward on built deck after water-stop (dx=${(truck.x - xDeck).toFixed(2)})`);

      // Explicit R cancels an active live deck wait and recovers cleanly.
      deck = null;
      assert.equal(fleet.restart(20, 0, Math.PI / 2, 'place-jump'), true);
      fleet.restart(330, 0, Math.PI / 2, 'place-jump');
      assert.equal(fleet.visitQueued, true);
      fleet.respawn();
      assert.equal(fleet.visitQueued, false, 'explicit R cancels pending Fleet deck wait');
    }

    // (4) Built deck startVisit and Start-where-I-am guard (existing regression).
    {
      deck = 8;
      const truck = mkTruck(sea, spanRoads);
      assert.equal(truck.place(-60, 0, Math.PI / 2), true);
      const tow = new api.Towing(truck, sea, spanRoads, false, false, {}, true, true);
      const scene = new THREE.Scene(); scene.add(truck.car.root, tow.trailer.root);
      const fleet = new api.Fleet(truck, tow, sea, spanRoads, scene, true, () => {}, SEA);
      assert.equal(fleet.startVisit(330, 0, Math.PI / 2), true, 'Fleet starts the truck and trailer on the built deck over water');
      assert.ok(Math.abs(truck.x - 330) < 30 && Math.abs(truck.y - 8) < .2, `the rig stands on the deck (x=${truck.x.toFixed(1)}, y=${truck.y.toFixed(2)})`);
      assert.equal(truck.place(-60, 0, Math.PI / 2), true);
      const guard = truck.placementGuard;
      assert.equal(fleet.startVisit(340, 0, Math.PI / 2, pose => guard?.(pose) !== false), true, 'Start where I am: Fleet starts the rig on the built deck through the trailer guard');
      assert.ok(Math.abs(truck.y - 8) < .2, `and it stands on the deck (y=${truck.y.toFixed(2)})`);
    }
    log('PASS Fleet unbuilt-span wait, camera framing, 8 s dry fallbacks, water-stop recovery and built-deck start');
  }

  // 8j. Solo Start-where-I-am (placeAtStart) skips an unbuilt bridge span candidate so candidate search lands immediately on the next dry road;
  // when terrain loads late as wet after an unloaded placeAtStart, retryPlace recovers immediately without entering an 8 s wait;
  // and calling prototype.place on a non-instance test double with unsafe coordinates returns false without throwing.
  {
    assert.equal(api.Vehicle.prototype.place.call({ bounds: null }, NaN, 0, 0), false, 'Vehicle.prototype.place test double returns false without TypeError');
    assert.equal(api.BikeRide.prototype.place.call({ bounds: null }, NaN, 0, 0), false, 'BikeRide.prototype.place test double returns false without TypeError');
    const wetDoubleTerrain = makeTerrain(() => ({ ground: -3, canopy: 0, roadDist: 99, halfWidth: 0, kind: 0, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }));
    assert.equal(api.Vehicle.prototype.place.call({ bounds: null, placementPose: { x: 0, z: 0, heading: 0 }, terrain: wetDoubleTerrain, groundAt: () => -3, isDryPose: () => false }, 0, 0, 0), false, 'Vehicle.prototype.place wet test double returns false without TypeError');
    assert.equal(api.BikeRide.prototype.place.call({ bounds: null, terrain: wetDoubleTerrain, poseGround: () => -3, isDryPose: () => false }, 0, 0, 0), false, 'BikeRide.prototype.place wet test double returns false without TypeError');
    const mixedLand = makeTerrain((x) => ({ ground: x <= -10 ? 2 : -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: x >= -5, deck: false }));
    const spanRoads = makeRoads(-60, 60);
    spanRoads.bridgeRuns = () => [{ roads: new Set([1]), pts: [[-5, 0], [50, 0]], halfWidth: 4 }];
    for (const kind of ['car', 'bike']) {
      const r = mkRide(kind, mixedLand, spanRoads); r.bounds = [-100, -100, 100, 100];
      assert.equal(r.place(-40, 0, Math.PI / 2), true);
      const candidates = [
        { x: 0, z: 0, heading: Math.PI / 2, distance: 0 },
        { x: -20, z: 0, heading: Math.PI / 2, distance: 20 },
      ];
      const chosen = candidates.find(c => api.placeAtStart(r, c));
      assert.equal(chosen?.x, -20, `${kind}: placeAtStart skips unbuilt span candidate and selects dry road at x=-20`);
      assert.equal(r.waitingForDeck, false, `${kind}: placeAtStart dry candidate is not waiting for a deck`);
      assert.equal(r.skipDeckWait, false, `${kind}: placeAtStart restores skipDeckWait after returning`);
      assert.ok(Math.abs(r.x - (-20)) < 1e-6 && Math.abs(r.y - 2) < .2, `${kind}: placeAtStart stands immediately on dry road (x=${r.x.toFixed(1)}, y=${r.y.toFixed(2)})`);

      // Late-loading wet terrain after an unloaded placeAtStart recovers immediately (never enters 8 s wait).
      let loaded = false;
      const lateWet = makeTerrain((x) => (x < 60
        ? { ground: 2, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: false, deck: false }
        : loaded ? { ground: -3, canopy: 0, roadDist: 0, halfWidth: 4, kind: 2, level: 8, washboard: false, gravel: false, rough: false, water: false, bridge: true, deck: false } : null));
      const lateRoads = mkSpanRoads({ y: null });
      const rl = mkRide(kind, lateWet, lateRoads); rl.bounds = [-200, -200, 400, 200];
      assert.equal(api.placeAtStart(rl, { x: 100, z: 0, heading: Math.PI / 2, distance: 0 }), true, `${kind}: unloaded placeAtStart accepts unloaded span`);
      loaded = true;
      for (let i = 0; i < 60; i++) parkedFrame(rl);
      assert.equal(rl.waitingForDeck, false, `${kind}: unloaded placeAtStart never enters deck wait when wet terrain loads late`);
      assert.ok(Math.abs(rl.x - 20) < 1 && Math.abs(rl.y - 2) < .2, `${kind}: unloaded placeAtStart recovers immediately to dry road at x=20 when wet terrain loads late (x=${rl.x.toFixed(1)}, y=${rl.y.toFixed(2)})`);
    }
    log('PASS solo placeAtStart skips unbuilt bridge spans, recovers on late-loaded wet tiles, and handles prototype test doubles');
  }
}

runDeckWaitTests({ Vehicle, BikeRide, Fleet, Towing, createTruck, CAR_SPEC, BIKE_SPEC, TRUCK_SPEC, DECK_WAIT_SECONDS, placeAtStart });

// Mutation checks for every unbuilt-span state across car, bike and Fleet (runs in ~2.5 s).
{
  const root = process.env.MMM_ROOT ?? process.cwd();
  const threeHref = pathToFileURL(resolve(root, 'web/node_modules/three/build/three.module.js')).href;
  const loadApi = async (replacements = {}) => {
    const out = await build({
      stdin: {
        contents: [
          "export { Vehicle, DECK_WAIT_SECONDS } from './web/src/vehicle.ts';",
          "export { BikeRide } from './web/src/bike-ride.ts';",
          "export { Fleet } from './web/src/fleet.ts';",
          "export { Towing } from './web/src/towing.ts';",
          "export { createTruck, TRUCK_SPEC } from './web/src/truck.ts';",
          "export { CAR_SPEC } from './web/src/vehicle-spec.ts';",
          "export { BIKE_SPEC } from './web/src/bike.ts';",
          "export { placeAtStart } from './web/src/start-here.ts';",
        ].join('\n'),
        resolveDir: root,
        loader: 'ts',
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      logLevel: 'silent',
      plugins: [{
        name: 'water-bounds-mutants',
        setup(b) {
          b.onResolve({ filter: /^three$/ }, () => ({ path: threeHref, external: true }));
          for (const [rel, code] of Object.entries(replacements)) {
            const abs = resolve(root, rel);
            b.onLoad({ filter: new RegExp(abs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }, () => ({ contents: code, loader: 'ts' }));
          }
        },
      }],
    });
    return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
  };

  // Unmodified control must pass through the same in-memory esbuild loader.
  runDeckWaitTests(await loadApi(), true);

  const mutants = [
    [
      'car-no-wait',
      'web/src/vehicle.ts',
      `    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && !(allowWait && this.#noDeckWait) && pose.y === undefined
      && (freshWait || (allowWait && this.#deckWait < DECK_WAIT_SECONDS))
      && this.roads.deckHeight(x, z) === null && placementOnSpan(this.roads, x, z);`,
      '    const waitDeck = false;',
      /car: placeAt on an unbuilt span over water waits for its deck/,
    ],
    [
      'bike-no-wait',
      'web/src/bike-ride.ts',
      `    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && !(allowWait && this.#noDeckWait) && pose.y === undefined
      && (freshWait || (allowWait && this.#deckWait < DECK_WAIT_SECONDS))
      && this.roads.deckHeight(pose.x, pose.z) === null && placementOnSpan(this.roads, pose.x, pose.z);`,
      '    const waitDeck = false;',
      /bike: placeAt on an unbuilt span over water waits for its deck/,
    ],
    [
      'car-start-here-waits-on-unbuilt-span',
      'web/src/vehicle.ts',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && !(allowWait && this.#noDeckWait) && pose.y === undefined',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !(allowWait && this.#noDeckWait) && pose.y === undefined',
      /car: placeAtStart skips unbuilt span candidate and selects dry road at x=-20/,
    ],
    [
      'bike-start-here-waits-on-unbuilt-span',
      'web/src/bike-ride.ts',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && !(allowWait && this.#noDeckWait) && pose.y === undefined',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !(allowWait && this.#noDeckWait) && pose.y === undefined',
      /bike: placeAtStart skips unbuilt span candidate and selects dry road at x=-20/,
    ],
    [
      'car-start-here-late-wet-waits',
      'web/src/vehicle.ts',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && !(allowWait && this.#noDeckWait) && pose.y === undefined',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && pose.y === undefined',
      /car: unloaded placeAtStart never enters deck wait when wet terrain loads late/,
    ],
    [
      'bike-start-here-late-wet-waits',
      'web/src/bike-ride.ts',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && !(allowWait && this.#noDeckWait) && pose.y === undefined',
      '    const waitDeck = isSelf && !dry && !this.#recovering && !this.skipDeckWait && pose.y === undefined',
      /bike: unloaded placeAtStart never enters deck wait when wet terrain loads late/,
    ],
    [
      'start-here-no-skip-flag',
      'web/src/start-here.ts',
      "  if ('skipDeckWait' in vehicle) vehicle.skipDeckWait = true;",
      '  // skipDeckWait removed',
      /car: placeAtStart skips unbuilt span candidate and selects dry road at x=-20/,
    ],
    [
      'car-no-wait-bound',
      'web/src/vehicle.ts',
      '      && (freshWait || (allowWait && this.#deckWait < DECK_WAIT_SECONDS))',
      '      && (freshWait || allowWait)',
      /car: deck that never builds recovers to dry land/,
    ],
    [
      'bike-no-wait-bound',
      'web/src/bike-ride.ts',
      '      && (freshWait || (allowWait && this.#deckWait < DECK_WAIT_SECONDS))',
      '      && (freshWait || allowWait)',
      /bike: deck that never builds recovers to dry land/,
    ],
    [
      'car-no-wait-clock',
      'web/src/vehicle.ts',
      '        if (this.#deckWaiting && Number.isFinite(dt) && dt > 0) this.#deckWait += Math.min(dt, 0.1);',
      '        // clock removed',
      /car: deck that never builds recovers to dry land/,
    ],
    [
      'bike-no-wait-clock',
      'web/src/bike-ride.ts',
      '        if (this.#deckWaiting && Number.isFinite(dt) && dt > 0) this.#deckWait += Math.min(dt, 0.1);',
      '        // clock removed',
      /bike: deck that never builds recovers to dry land/,
    ],
    [
      'car-direct-place-waits',
      'web/src/vehicle.ts',
      '      && (freshWait || (allowWait && this.#deckWait < DECK_WAIT_SECONDS))',
      '      && this.#deckWait < DECK_WAIT_SECONDS',
      /car: direct place\(\) in water under an unbuilt span is refused/,
    ],
    [
      'bike-direct-place-waits',
      'web/src/bike-ride.ts',
      '      && (freshWait || (allowWait && this.#deckWait < DECK_WAIT_SECONDS))',
      '      && this.#deckWait < DECK_WAIT_SECONDS',
      /bike: direct place\(\) in water under an unbuilt span is refused/,
    ],
    [
      'car-no-stuck-on-wait',
      'web/src/vehicle.ts',
      '      this.y = this.prevGround = g; this.stuck = true; this.#awaitingLoad = true;',
      '      this.y = this.prevGround = g; this.stuck = false; this.#awaitingLoad = true;',
      /car: waiting ride (does not sink|holds physics off|stays at the span)/,
    ],
    [
      'bike-ready-on-wait',
      'web/src/bike-ride.ts',
      '    this.ready = !waitDeck && this.capture();',
      '    this.ready = this.capture();',
      /bike: waiting ride (does not sink|holds physics off|stays at the span)/,
    ],
    [
      'car-no-parked-hold-gate',
      'web/src/vehicle.ts',
      '    if (this.#waitedThisStep) return false;',
      '    // gate removed',
      /car: (keeps waiting after coarse wet land arrives|stands on the built deck|deck that never builds recovers to dry land|the parked hold after a failed retry never stands on the deck overhead)/,
    ],
    [
      'bike-no-parked-hold-gate',
      'web/src/bike-ride.ts',
      '    if (this.#waitedThisStep) return false;',
      '    // gate removed',
      /bike: (keeps waiting after coarse wet land arrives|stands on the built deck|deck that never builds recovers to dry land|the parked hold after a failed retry never stands on the deck overhead)/,
    ],
    [
      'car-failed-retry-old-raise',
      'web/src/vehicle.ts',
      '              if (gNow !== null) this.y = gNow;',
      '              if (gNow !== null && this.y < gNow) this.y = gNow;',
      /car: the parked hold after a failed retry never stands on the deck overhead/,
    ],
    [
      'bike-failed-retry-old-raise',
      'web/src/bike-ride.ts',
      '              if (gNow !== null) this.y = gNow;',
      '              if (gNow !== null && this.y < gNow) this.y = gNow;',
      /bike: the parked hold after a failed retry never stands on the deck overhead/,
    ],
    [
      'car-refused-placeAt-resets-wait',
      'web/src/vehicle.ts',
      '    this.#freshDeckWait = true;',
      '    this.#freshDeckWait = true; this.#deckWait = 0;',
      /car: deck that never builds recovers to dry land/,
    ],
    [
      'bike-refused-placeAt-resets-wait',
      'web/src/bike-ride.ts',
      '    this.#freshDeckWait = true;',
      '    this.#freshDeckWait = true; this.#deckWait = 0;',
      /bike: deck that never builds recovers to dry land/,
    ],
    [
      'car-stale-waterStopped',
      'web/src/vehicle.ts',
      '    if (freshWait || (g !== null && !waitDeck)) { this.#deckWait = 0; this.#waitFallback = null; }\n    this.#waterStopped = false;',
      '    if (freshWait || (g !== null && !waitDeck)) { this.#deckWait = 0; this.#waitFallback = null; }',
      /car: stale #waterStopped never yanks timed-out recovery off the 8 m deck/,
    ],
    [
      'bike-stale-waterStopped',
      'web/src/bike-ride.ts',
      '    this.#waterStopped = false;\n    this.ready = !waitDeck && this.capture();',
      '    this.ready = !waitDeck && this.capture();',
      /bike: stale #waterStopped never yanks timed-out recovery off the 8 m deck/,
    ],
    [
      'fleet-no-wait-bound',
      'web/src/fleet.ts',
      '        if (ready || this.deckWait >= DECK_WAIT_SECONDS) {',
      '        if (ready) {',
      /Fleet cold start on long unbuilt span ends wait after 8 s/,
    ],
    [
      'fleet-ignores-loaded-dry-terrain',
      'web/src/fleet.ts',
      '        const ready = this.roads.deckHeight(p.x, p.z) !== null || !this.waitingOnSpan(p);',
      '        const ready = this.roads.deckHeight(p.x, p.z) !== null;',
      /Fleet spawns on next frame once dry terrain loads under unloaded span/,
    ],
    [
      'fleet-no-cold-wide-fallback',
      'web/src/fleet.ts',
      '      if (!this.spawned && this.spanWaitExhausted) {',
      '      if (false && !this.spawned && this.spanWaitExhausted) {',
      /Fleet cold start on long unbuilt span ends wait after 8 s/,
    ],
    [
      'fleet-guarded-start-skips-wait',
      'web/src/fleet.ts',
      '    if (this.allowSpanWait && !accepts && this.waitingOnSpan(pose)) {',
      '    if (this.allowSpanWait && this.waitingOnSpan(pose)) {',
      /guarded Fleet startVisit on unbuilt span skips deck wait/,
    ],
    [
      'fleet-cold-retry-restarts-wait',
      'web/src/fleet.ts',
      '        const allow = !this.spanWaitExhausted;',
      '        const allow = true;',
      /cold fallback spawns immediately when shore becomes usable after timeout/,
    ],
    [
      'fleet-camera-ignores-live-wait',
      'web/src/fleet.ts',
      '    if (this.visitPending && (!this.spawned || this.deckWaiting)) {',
      '    if (this.visitPending && !this.spawned) {',
      /Fleet camera frames the waiting bridge span while spawned/,
    ],
    [
      'span-ignores-halfWidth',
      'web/src/vehicle.ts',
      '  return !!hit && onCarryingSpan(roads, hit, x, z, true);',
      '  return !!hit && onCarryingSpan(roads, hit);',
      /car: placeAt in water 7 m outside a 4 m halfWidth span is refused/,
    ],
    [
      'car-no-prior-dry-fallback',
      'web/src/vehicle.ts',
      '              if (this.tryDryPlace(fallback.x, fallback.z, fallback.heading, fallback.y)) return;',
      '              // prior dry fallback removed',
      /car: failed live restart from off-road dry pose returns to prior dry pose/,
    ],
    [
      'car-unloaded-fallback-strands',
      'web/src/vehicle.ts',
      '              if (this.terrain.heightAt(fallback.x, fallback.z) === null && this.place(fallback.x, fallback.z, fallback.heading, fallback.y)) return;',
      '              // unloaded fallback removed',
      /car: timeout returns to saved starting pose even while starting tile is unloaded/,
    ],
    [
      'bike-no-prior-dry-fallback',
      'web/src/bike-ride.ts',
      '              if (this.terrain.surfaceAt(fallback.x, fallback.z, fallback.y)',
      '              if (false && this.terrain.surfaceAt(fallback.x, fallback.z, fallback.y)',
      /bike: failed live restart from off-road dry pose returns to prior dry pose/,
    ],
    [
      'bike-unloaded-fallback-strands',
      'web/src/bike-ride.ts',
      '              } else if (this.terrain.heightAt(fallback.x, fallback.z) === null && this.place(fallback.x, fallback.z, fallback.heading, fallback.y)) return;',
      '              }',
      /bike: timeout returns to saved starting pose even while starting tile is unloaded/,
    ],
    [
      'car-refused-restart-clears-wait',
      'web/src/vehicle.ts',
      '      this.#deckWaiting = prevWaiting; this.#deckWait = prevWait; this.#waitFallback = prevFallback; this.#noDeckWait = prevNoWait;',
      '      // refused restart leaves wait cleared',
      /car: failed live restart from off-road dry pose returns to prior dry pose/,
    ],
    [
      'bike-refused-restart-clears-wait',
      'web/src/bike-ride.ts',
      '      this.#waterStopped = undo.waterStopped; this.#deckWaiting = undo.deckWaiting; this.#deckWait = undo.deckWait;\n      this.#waitFallback = undo.waitFallback; this.#awaitingLoad = undo.awaitingLoad; this.#noDeckWait = undo.noDeckWait;',
      '      // refused restart leaves wait cleared',
      /bike: failed live restart from off-road dry pose returns to prior dry pose/,
    ],
    [
      'bike-respawn-lifts-before-clamped-road',
      'web/src/bike-ride.ts',
      '    for (const candidate of [nearHit, this.lastSafe]) {',
      '    for (const candidate of [nearHit, this.lastSafe, nearHit ? { x: nearHit.x, z: nearHit.z, heading: nearHit.heading, y: spanDeckReference(this.roads, nearHit) } : null]) {',
      /bike: when lastSafe is rejected, clamped dry road at 2 m wins over 8 m overhead deck/,
    ],
    [
      'bike-respawn-lifts-overhead-before-lastSafe',
      'web/src/bike-ride.ts',
      '    for (const candidate of [nearHit, this.lastSafe]) {',
      '    for (const candidate of [nearHit ? { x: nearHit.x, z: nearHit.z, heading: nearHit.heading, y: spanDeckReference(this.roads, nearHit) } : null, this.lastSafe]) {',
      /bike: sinking under a carrying deck uses lastSafe at 2 m/,
    ],
    [
      'car-dry-vertex-stops-at-first-rejected',
      'web/src/vehicle.ts',
      '        && nearestDryOnRoad(wide, (px, pz, heading) => this.inside(px, pz, 2) && this.tryDryPlace(px, pz, this.inward(px, pz, heading)))) return;',
      '        && (() => { const v = nearestDryOnRoad(wide, (px, pz) => this.inside(px, pz, 2) && this.isDryPose(px, pz, this.terrain.heightAt(px, pz))); return !!v && this.tryDryPlace(v.x, v.z, this.inward(v.x, v.z, v.heading)); })()) return;',
      /car: dry road vertex search skips guard-rejected first vertex/,
    ],
    [
      'bike-dry-vertex-stops-at-first-rejected',
      'web/src/bike-ride.ts',
      '    if (wideHit && !usable(wideHit) && nearestDryOnRoad(wideHit, (px, pz, heading) => placeCandidate({ x: px, z: pz, heading }))) return;',
      '    if (wideHit && !usable(wideHit) && placeCandidate(nearestDryOnRoad(wideHit, (px, pz, heading) => usable({ x: px, z: pz, heading })))) return;',
      /bike: dry road vertex search skips guard-rejected first vertex/,
    ],
    [
      'fleet-no-span-wait-visit',
      'web/src/fleet.ts',
      '    if (this.allowSpanWait && !accepts && this.waitingOnSpan(pose)) {',
      '    if (false && this.allowSpanWait && !accepts && this.waitingOnSpan(pose)) {',
      /Fleet cold start on unbuilt span queues wait/,
    ],
    [
      'fleet-no-span-wait-restart',
      'web/src/fleet.ts',
      '    if (this.spawned && this.allowSpanWait && !accepts && this.waitingOnSpan({ x, z, heading })) {',
      '    if (false && this.spawned && this.allowSpanWait && !accepts && this.waitingOnSpan({ x, z, heading })) {',
      /Fleet live place-jump onto unbuilt span waits for deck/,
    ],
    [
      'car-unload-clears-deck-wait',
      'web/src/vehicle.ts',
      '    this.#deckWaiting = waitDeck || keepWait;',
      '    this.#deckWaiting = waitDeck;',
      /car: mid-wait tile unload preserves deadline and restores prior dry pose/,
    ],
    [
      'bike-unload-clears-deck-wait',
      'web/src/bike-ride.ts',
      '    this.#deckWaiting = waitDeck || keepWait;',
      '    this.#deckWaiting = waitDeck;',
      /bike: mid-wait tile unload preserves deadline and restores prior dry pose/,
    ],
    [
      'car-deck-over-unloaded-drops-wait',
      'web/src/vehicle.ts',
      '    const keepWait = g === null && this.#retrying && this.#deckWaiting && this.#deckWait < DECK_WAIT_SECONDS;',
      '    const keepWait = g === null && allowWait && this.#deckWaiting && this.#deckWait < DECK_WAIT_SECONDS;',
      /car: deck arriving over unloaded terrain still honors 8 s deadline/,
    ],
    [
      'bike-deck-over-unloaded-drops-wait',
      'web/src/bike-ride.ts',
      '    const keepWait = !this.ready && this.#retrying && this.#deckWaiting && this.#deckWait < DECK_WAIT_SECONDS;',
      '    const keepWait = !this.ready && allowWait && this.#deckWaiting && this.#deckWait < DECK_WAIT_SECONDS;',
      /bike: deck arriving over unloaded terrain still honors 8 s deadline/,
    ],
    [
      'fleet-unspawned-restart-clobbers-first-spawn',
      'web/src/fleet.ts',
      '    if (this.spawned && this.allowSpanWait && !accepts && this.waitingOnSpan({ x, z, heading })) {',
      '    if (this.allowSpanWait && !accepts && this.waitingOnSpan({ x, z, heading })) {',
      /unspawned place-jump does not replace pending first spawn with deck wait/,
    ],
  ];

  // Also check main.ts wiring for Sol round-1/2 edge cases (keyboard R, gamepad Reset, Start where I am, jumpToPlace, frame-loop holds).
  const mainSrc = readFileSync(resolve(root, 'web/src/main.ts'), 'utf8');
  assert.ok(mainSrc.includes("if (ev.code === 'KeyR' && !ev.repeat && fleet?.waitingForDeck && !interiors.busy && !(mode === 'fly' && drone.active)) { resetToRoad(); return; }"), 'main.ts keyboard R cancels live Fleet deck wait');
  assert.ok(mainSrc.includes('reset: () => { if (!interiors.busy && (!fleet?.busy || fleet.waitingForDeck)) resetToRoad(); },'), 'main.ts gamepad Reset cancels live Fleet deck wait');
  assert.ok(mainSrc.includes('place: s => { const placed = placeAtStart(fleet ? startPlacement : vehicle, s); if (placed) {'), 'main.ts startHere advances to the next dry candidate instead of short-circuiting on a queued Fleet wait');
  assert.ok(mainSrc.includes("if (fleet.restart(x, z, heading, 'place-jump', undefined, () => finishJump(true))) finishJump(true);"), 'main.ts jumpToPlace defers resets and speed zeroing until Fleet placement commits');
  assert.ok(mainSrc.includes("else if (fleet.deckWaitToken !== before) { camReady = false; if (!droneVehicle && !drone.active) mode = 'drive'; }"), 'main.ts jumpToPlace keeps an active roof-launched drone flight until Fleet placement commits');
  assert.ok(mainSrc.includes('if (fleet?.waitingForDeck && fleet.camera(camera, dt, view)) {'), 'main.ts fly branch frames a waiting Fleet bridge span without stowing an active drone');
  assert.ok(mainSrc.includes('else if (terrain.surfaceAt(vehicle.x, vehicle.z)?.level === undefined) { if (vehicle.waitingForDeck) driveVehicle(dt, { ...input, throttle: 0, handbrake: true }); else vehicle.retryPlace(); }'), 'main.ts missing-surface hold does not bypass update() while waiting for deck');
  assert.ok(mainSrc.includes('if (!vehicle.waitingForDeck && (refusal > 0 || demo && drove >= demo) && Math.abs(vehicle.speed) < 0.15)'), 'main.ts animal/demo hold does not freeze deck-wait timer');

  const sourceCache = new Map();
  for (const [name, file, from, to, expectMsg] of mutants) {
    const src = sourceCache.get(file) ?? readFileSync(resolve(root, file), 'utf8');
    sourceCache.set(file, src);
    assert.equal(src.split(from).length, 2, `${name}: expected unique anchor in ${file}`);
    const mutatedApi = await loadApi({ [file]: src.replace(from, to) });
    assert.throws(
      () => runDeckWaitTests(mutatedApi, true),
      err => err instanceof assert.AssertionError && expectMsg.test(err.message),
      `mutant ${name} did not fail on expected assertion`,
    );
    console.log(`KILLED ${name}`);
  }
  console.log(`PASS water-bounds-mutations: ${mutants.length} mutants killed`);
}
