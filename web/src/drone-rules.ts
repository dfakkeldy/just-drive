// How the camera drone flies: plain numbers, no three.js, so a Node check can fly it (tools/drone-rules-check.mjs).
// It flies like a real camera drone: the sticks ask for a speed, not a push. Let go and it brakes to a hover and
// holds its height. W/S and A/D move it level, relative to where it faces; turning is its own control.

export interface DroneState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Where the drone faces, in the camera's convention: 0 looks toward -z, positive turns left. */
  yaw: number; yawRate: number;
}
/** Stick positions, each from -1 to 1. */
export interface DroneCommand { forward: number; right: number; up: number; turn: number }
/** What is under the drone, in world heights. `ground` null: no land is known there (off the map or not loaded). */
export interface DroneGround { ground: number | null; floor: number | null }

export const DRONE = {
  /** The top speed a new flight starts with, m/s (about a camera drone's normal mode). The wheel changes it. */
  speed: 15, minSpeed: 2, maxSpeed: 60,
  /** Clearance kept over the ground, trees and roofs, metres. */
  clearance: 2,
  /** The highest it flies above the ground under it: Canada's 122 m limit for small drones. */
  ceiling: 120,
  /** The farthest it flies from the vehicle, metres: the radio link of a small drone. */
  range: 2000,
  /** Full left or right stick turns it this fast, rad/s (about 90 degrees a second). */
  turnRate: 1.6,
  /** How quickly the speed follows the sticks (1/s): speeding up, and braking to a hover. */
  accel: 1.8, brake: 2.8, vertical: 3.2, turn: 6,
} as const;

/** The camera gimbal: from straight down to a little above the horizon (radians), and the tilt speed of a held key. */
export const GIMBAL = { min: -1.55, max: 0.45, rate: 1.1, ease: 10 } as const;

/**
 * Tilts the gimbal for one frame: `input` -1 (down) to 1 (up), held arrow keys. The tilt speeds up and stops smoothly,
 * and stops at either end. `rate` is carried between frames.
 */
export function stepGimbal(g: { pitch: number; rate: number }, input: number, dt: number): void {
  g.rate += (Math.max(-1, Math.min(1, input)) * GIMBAL.rate - g.rate) * (1 - Math.exp(-GIMBAL.ease * dt));
  g.pitch += g.rate * dt;
  if (g.pitch <= GIMBAL.min) { g.pitch = GIMBAL.min; if (g.rate < 0) g.rate = 0; }
  if (g.pitch >= GIMBAL.max) { g.pitch = GIMBAL.max; if (g.rate > 0) g.rate = 0; }
}

/** Up and down speed for a top speed: a drone climbs slower than it flies. */
export const climbRate = (speed: number): number => Math.min(8, Math.max(2.5, speed * 0.4));

/** The wheel: one notch up is a quarter faster, one down a fifth slower, within the limits. */
export function wheelSpeed(speed: number, deltaY: number): number {
  return Math.min(DRONE.maxSpeed, Math.max(DRONE.minSpeed, speed * (deltaY < 0 ? 1.25 : 0.8)));
}

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Standalone drone mode: how far ahead land must be ready for full speed, and how close it brakes to a hover. */
export const DRONE_LOAD = {
  /** Probe distances ahead (metres), close together near the drone so a path past a tile corner is not missed; stays
   * inside the phone tile-split radius even at the 120 m ceiling. */
  probes: [0, 12, 25, 38, 50, 80, 110, 145, 180, 215, 250, 285, 320] as readonly number[],
  /** Full top speed when at least this many metres ahead are ready. */
  full: 320,
  /** Hold still when unready land is within this distance (metres). */
  stop: 50,
} as const;

/**
 * Caps horizontal speed when land ahead is still loading (`clear` is the farthest ready probe distance, metres;
 * negative when the ground directly under the drone is not ready). Returns 0 near unready land so the drone brakes
 * to a hover before crossing onto coarse or unloaded ground.
 */
export function loadSpeedCap(speed: number, clear: number): number {
  if (clear <= DRONE_LOAD.stop) return 0;
  if (clear >= DRONE_LOAD.full) return speed;
  return Math.min(speed, speed * ((clear - DRONE_LOAD.stop) / (DRONE_LOAD.full - DRONE_LOAD.stop)));
}

/**
 * One step. `home` is the vehicle (x, z) the range is measured from, or null in standalone drone mode (no range limit).
 * `land` is a point to fly to instead of the sticks (the return flight); near it the floor no longer holds the drone up,
 * so it can set down on the roof. Returns the distance to `land`, or Infinity.
 */
export function stepDrone(s: DroneState, cmd: DroneCommand, dt: number, speed: number, under: DroneGround,
  home: { x: number; z: number } | null, land?: { x: number; y: number; z: number },
  sampleUnder?: (x: number, z: number) => DroneGround): number {
  if (dt <= 0) return land ? Math.hypot(land.x - s.x, land.y - s.y, land.z - s.z) : Infinity;
  const climb = climbRate(speed);
  let wantX: number, wantZ: number, wantY: number, wantTurn: number;
  let toLand = Infinity, flat = Infinity;
  if (land) {
    const dx = land.x - s.x, dz = land.z - s.z, dy = land.y - s.y;
    flat = Math.hypot(dx, dz); toLand = Math.hypot(dx, dy, dz);
    // Faster while far (up to 80 m/s), slowing to a crawl over the roof. F lands at once for the impatient.
    const v = Math.min(Math.max(speed, 12, Math.min(flat / 6, 80)), flat * 1.2 + 0.3);
    wantX = flat > 1e-6 ? dx / flat * v : 0; wantZ = flat > 1e-6 ? dz / flat * v : 0;
    // Hold height until over the vehicle, then come down; climb at once if the vehicle sits higher.
    wantY = flat > 3 && dy < 0 ? 0 : clamp(dy * 1.5, -climb, climb);
    // Face the way home while it is still some way off.
    const face = Math.atan2(-dx, -dz), turn = Math.atan2(Math.sin(face - s.yaw), Math.cos(face - s.yaw));
    wantTurn = flat > 6 ? clamp(turn * 2, -DRONE.turnRate, DRONE.turnRate) : 0;
  } else {
    let f = clamp(cmd.forward, -1, 1), r = clamp(cmd.right, -1, 1);
    const length = Math.hypot(f, r);
    if (length > 1) { f /= length; r /= length; }   // a diagonal is not faster
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    // Forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw): level, whatever the camera's tilt.
    wantX = (-sin * f + cos * r) * speed; wantZ = (-cos * f - sin * r) * speed;
    const u = clamp(cmd.up, -1, 1);
    wantY = u * (u > 0 ? climb : climb * 0.8);
    wantTurn = clamp(cmd.turn, -1, 1) * DRONE.turnRate;
  }
  // Horizontal speed follows the sticks: gently when speeding up, harder when braking.
  const now = Math.hypot(s.vx, s.vz), want = Math.hypot(wantX, wantZ);
  const k = ease(want > now ? DRONE.accel : DRONE.brake, dt);
  s.vx += (wantX - s.vx) * k; s.vz += (wantZ - s.vz) * k;
  s.vy += (wantY - s.vy) * ease(DRONE.vertical, dt);
  s.yawRate += (wantTurn - s.yawRate) * ease(DRONE.turn, dt);
  s.yaw += s.yawRate * dt;
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;

  // The radio link: past the range it is held at the edge, and the outward part of its speed is taken away.
  if (home) {
    const hx = s.x - home.x, hz = s.z - home.z, out = Math.hypot(hx, hz);
    if (out > DRONE.range) {
      const nx = hx / out, nz = hz / out, along = s.vx * nx + s.vz * nz;
      s.x = home.x + nx * DRONE.range; s.z = home.z + nz * DRONE.range;
      if (along > 0) { s.vx -= along * nx; s.vz -= along * nz; }
    }
  }
  // A soft floor over the ground, trees and roofs, except right over the landing spot.
  const landing = land !== undefined && flat < 4;
  if (under.floor !== null && !landing && s.y < under.floor) {
    s.y += (under.floor - s.y) * ease(8, dt);
    s.y = Math.max(s.y, under.floor - 1.5);   // never far into a tree, whatever the frame time
    if (s.vy < 0) s.vy = 0;
  }
  const post = sampleUnder ? sampleUnder(s.x, s.z) : under;
  const gNow = under.ground !== null && post.ground !== null ? Math.max(under.ground, post.ground) : (post.ground ?? under.ground);
  // A soft ceiling over the ground under it.
  if (gNow !== null) {
    const top = gNow + DRONE.ceiling;
    if (s.y > top) { s.y += (top - s.y) * ease(3, dt); if (s.vy > 0) s.vy = 0; }
  }
  // Final floor constraint: never pass under known ground (even on final approach), or below sea level over void.
  const hasFloor = under.floor !== null || post.floor !== null;
  const hardFloor = landing
    ? (post.ground !== null ? post.ground + 0.5 : under.ground !== null ? under.ground + 0.5 : -0.2 + 0.5)
    : gNow !== null ? gNow + 0.5
    : !hasFloor ? -0.2 + DRONE.clearance : -Infinity;
  if (s.y < hardFloor) { s.y = hardFloor; if (s.vy < 0) s.vy = 0; }
  return land ? Math.hypot(land.x - s.x, land.y - s.y, land.z - s.z) : toLand;
}

/** The readout: height over the ground under the drone, distance from the vehicle (null in standalone drone mode), whole metres. */
export function droneReadout(heightAboveGround: number | null, distance: number | null, speed: number, maxSpeed: number, returning: boolean, yaw = 0, loading = false): string {
  const h = heightAboveGround === null ? '–' : `${Math.max(0, heightAboveGround).toFixed(0)} m`;
  const state = returning ? 'returning'
    : distance !== null && distance >= DRONE.range - 1 ? 'at range limit'
    : heightAboveGround !== null && heightAboveGround >= DRONE.ceiling - 1 ? 'at height limit'
    : loading ? 'loading land' : '';
  const heading = ['N','NE','E','SE','S','SW','W','NW'][((Math.round(-yaw / (Math.PI / 4)) % 8) + 8) % 8];
  const from = distance === null ? '' : ` · From the car ${distance.toFixed(0)} m`;
  return `DRONE · Height ${h}${from} · Speed ${speed.toFixed(0)} m/s${Math.round(maxSpeed) !== DRONE.speed ? ` (max ${maxSpeed.toFixed(0)})` : ''} · Heading ${heading}${state ? ` · ${state}` : ''}`;
}
