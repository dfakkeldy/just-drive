import { draw } from './shift-rules';
import type { InteriorResult } from './interiors';

/**
 * Pure rules for the Harbour Ridge steel plant package run.
 * Metres, metres/second, and real seconds. No DOM, no three.js: rendering never changes these rules.
 */

export const PLANT_HALF_WIDTH = 6.2;
export const PLANT_LENGTH = 135;
export const PLANT_GOAL_Z = 132.5;
export const PLANT_DOOR_RADIUS = 12;
export const PLANT_TIME_LIMIT = 120;
export const PLANT_MAX_INTEGRITY = 3;
export const PLAYER_RADIUS = 0.48;

export const WALK_SPEED = 2.65;
export const BACK_SPEED = 1.85;
export const STRAFE_SPEED = 3.15;
const ACCEL = 18;
const HIT_INVULN = 1.6;
const HIT_STAGGER = 0.35;
const HIT_KNOCKBACK = 1.4;
const WIN_BEAT = 2.8;
const LOSS_BEAT = 2.4;

export interface PlantInput {
  /** Forward (+1) or backward (-1). */
  forward: number;
  /** Strafe right (+1) or left (-1). */
  side: number;
}

export interface ConveyorSpec {
  readonly id: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  /** Velocity pushed onto the carrier in metres/second. */
  readonly vx: number;
  readonly vz: number;
}

export interface HotSpotSpec {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly period: number;
  readonly active: number;
  readonly warn: number;
  readonly phase: number;
}

export interface CraneSpec {
  readonly id: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly minX: number;
  readonly maxX: number;
  /** Angular sweep speed in radians/second. */
  readonly speed: number;
  readonly phase: number;
}

export interface PlantLayout {
  readonly conveyors: readonly ConveyorSpec[];
  readonly hotSpots: readonly HotSpotSpec[];
  readonly cranes: readonly CraneSpec[];
}

export type HotSpotPhase = 'cool' | 'warn' | 'hot';
export interface HotSpotReading {
  readonly state: HotSpotPhase;
  /** 0 when cool, 0..1 rising during warn, 1 while hot. */
  readonly intensity: number;
}

export type PlantPhase = 'running' | 'delivered' | 'ruined' | 'timeout' | 'finished';
export type HazardKind = 'hotSpot' | 'crane' | null;

/** Current state of one floor hot spot at elapsed seconds. */
export function hotSpotState(spot: HotSpotSpec, elapsed: number): HotSpotReading {
  const t = (((elapsed + spot.phase) % spot.period) + spot.period) % spot.period;
  const hotStart = spot.period - spot.active;
  const warnStart = hotStart - spot.warn;
  if (t >= hotStart) return { state: 'hot', intensity: 1 };
  if (t >= warnStart) return { state: 'warn', intensity: (t - warnStart) / Math.max(0.01, spot.warn) };
  return { state: 'cool', intensity: 0 };
}

/** Current centre X of one overhead crane load at elapsed seconds. */
export function craneX(crane: CraneSpec, elapsed: number): number {
  const mid = (crane.minX + crane.maxX) / 2;
  const amp = (crane.maxX - crane.minX) / 2;
  return mid + Math.sin(elapsed * crane.speed + crane.phase) * amp;
}

/** Deterministic daily plant layout across three 45 m bays. Every hazard leaves a clean passing window. */
export function plantLayout(day: number): PlantLayout {
  const sign = (id: number, salt: number): -1 | 1 => (draw(day, id, salt) < 0.5 ? -1 : 1);
  const frac = (id: number, salt: number): number => draw(day, id, salt);
  const d1 = sign(1, 401), d2 = sign(2, 402), d3 = sign(3, 403);
  const boostLeft = sign(4, 404) < 0;

  const conveyors: ConveyorSpec[] = [
    // Bay 1: cross-belts plus one forward boost and one reverse headwind lane.
    { id: 0, x0: -PLANT_HALF_WIDTH, x1: PLANT_HALF_WIDTH, z0: 8, z1: 14.5, vx: d1 * 1.95, vz: 0 },
    { id: 1, x0: -PLANT_HALF_WIDTH, x1: PLANT_HALF_WIDTH, z0: 22, z1: 28.5, vx: -d1 * 2.05, vz: 0 },
    { id: 2, x0: -5.6, x1: -0.6, z0: 36, z1: 42.5, vx: 0, vz: boostLeft ? 1.45 : -1.6 },
    { id: 3, x0: 0.6, x1: 5.6, z0: 36, z1: 42.5, vx: 0, vz: boostLeft ? -1.6 : 1.45 },
    // Bay 2: cross-belt between hot-floor rows.
    { id: 4, x0: -PLANT_HALF_WIDTH, x1: PLANT_HALF_WIDTH, z0: 61, z1: 67, vx: d2 * 2.15, vz: 0 },
    // Bay 3: opposing cross-belts before the heavy cranes.
    { id: 5, x0: -PLANT_HALF_WIDTH, x1: PLANT_HALF_WIDTH, z0: 95, z1: 101, vx: -d2 * 2.2, vz: 0 },
    { id: 6, x0: -PLANT_HALF_WIDTH, x1: PLANT_HALF_WIDTH, z0: 118, z1: 123.2, vx: d3 * 2.25, vz: 0 },
  ];

  const p1 = frac(10, 411) * 5.8;
  const p2 = frac(11, 412) * 5.4;
  const p3 = frac(12, 413) * 5.2;
  const p4 = frac(13, 414) * 5.0;
  const p5 = frac(14, 415) * 4.8;
  const p6 = frac(15, 416) * 4.8;

  const hotSpots: HotSpotSpec[] = [
    // Bay 1: alternating left/right pair.
    { id: 0, x: -2.8 * d1, z: 18.2, halfX: 2.2, halfZ: 1.5, period: 5.8, active: 2.0, warn: 1.2, phase: p1 },
    { id: 1, x: 2.8 * d1, z: 18.2, halfX: 2.2, halfZ: 1.5, period: 5.8, active: 2.0, warn: 1.2, phase: p1 + 2.9 },
    // Bay 2 Row A: outer pair vs centre.
    { id: 2, x: -4.1, z: 51.8, halfX: 1.65, halfZ: 1.6, period: 5.4, active: 1.9, warn: 1.2, phase: p2 },
    { id: 3, x: 0, z: 51.8, halfX: 1.65, halfZ: 1.6, period: 5.4, active: 1.9, warn: 1.2, phase: p2 + 2.7 },
    { id: 4, x: 4.1, z: 51.8, halfX: 1.65, halfZ: 1.6, period: 5.4, active: 1.9, warn: 1.2, phase: p2 },
    // Bay 2 Row B: two wide plates half a cycle apart.
    { id: 5, x: -3.0, z: 70.6, halfX: 2.35, halfZ: 1.7, period: 5.2, active: 1.9, warn: 1.2, phase: p3 },
    { id: 6, x: 3.0, z: 70.6, halfX: 2.35, halfZ: 1.7, period: 5.2, active: 1.9, warn: 1.2, phase: p3 + 2.6 },
    // Bay 2 Row C: staggered opposite Row A.
    { id: 7, x: -4.1, z: 76.8, halfX: 1.65, halfZ: 1.6, period: 5.0, active: 1.85, warn: 1.2, phase: p4 + 2.5 },
    { id: 8, x: 0, z: 76.8, halfX: 1.65, halfZ: 1.6, period: 5.0, active: 1.85, warn: 1.2, phase: p4 },
    { id: 9, x: 4.1, z: 76.8, halfX: 1.65, halfZ: 1.6, period: 5.0, active: 1.85, warn: 1.2, phase: p4 + 2.5 },
    // Bay 3 Row D & E: flanked hot grates between crane tracks.
    { id: 10, x: -3.0, z: 109.5, halfX: 2.15, halfZ: 1.55, period: 4.8, active: 1.8, warn: 1.2, phase: p5 },
    { id: 11, x: 3.0, z: 109.5, halfX: 2.15, halfZ: 1.55, period: 4.8, active: 1.8, warn: 1.2, phase: p5 + 2.4 },
    { id: 12, x: -3.5, z: 125.6, halfX: 1.85, halfZ: 1.4, period: 4.8, active: 1.8, warn: 1.2, phase: p6 },
    { id: 13, x: 3.5, z: 125.6, halfX: 1.85, halfZ: 1.4, period: 4.8, active: 1.8, warn: 1.2, phase: p6 + 2.4 },
  ];

  const cPhase = (id: number) => frac(20 + id, 420 + id) * Math.PI * 2;
  const cranes: CraneSpec[] = [
    // Bay 1: one steady crane.
    { id: 0, z: 32.8, halfX: 1.6, halfZ: 0.72, minX: -4.4, maxX: 4.4, speed: 0.92, phase: cPhase(0) },
    // Bay 2: two overhead girders.
    { id: 1, z: 57.5, halfX: 1.7, halfZ: 0.75, minX: -4.4, maxX: 4.4, speed: 1.06, phase: cPhase(1) },
    { id: 2, z: 82.8, halfX: 1.75, halfZ: 0.78, minX: -4.3, maxX: 4.3, speed: 1.16, phase: cPhase(2) },
    // Bay 3: three heavier, faster bridge cranes.
    { id: 3, z: 104.5, halfX: 1.85, halfZ: 0.8, minX: -4.2, maxX: 4.2, speed: 1.24, phase: cPhase(3) },
    { id: 4, z: 114.5, halfX: 1.85, halfZ: 0.8, minX: -4.2, maxX: 4.2, speed: 1.32, phase: cPhase(3) + Math.PI },
    { id: 5, z: 129.0, halfX: 1.9, halfZ: 0.82, minX: -4.2, maxX: 4.2, speed: 1.38, phase: cPhase(5) },
  ];

  return { conveyors, hotSpots, cranes };
}

/** Dollar tip paid into the shift for a completed run, based on final score. */
export function plantBonus(score: number): number {
  if (score >= 1200) return 40;
  if (score >= 950) return 30;
  if (score >= 750) return 20;
  return 15;
}

/** Final score for a successful delivery. */
export function plantScore(elapsed: number, integrity: number, hits: number): number {
  const timeBonus = Math.round(Math.max(0, PLANT_TIME_LIMIT - elapsed) * 5);
  const cleanBonus = hits === 0 ? 200 : 0;
  return Math.max(100, 500 + integrity * 150 + timeBonus + cleanBonus - hits * 150);
}

export class PlantRun {
  readonly layout: PlantLayout;
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  elapsed = 0;
  integrity = PLANT_MAX_INTEGRITY;
  hits = 0;
  invuln = 0;
  stagger = 0;
  phase: PlantPhase = 'running';
  timer = 0;
  lastHazard: HazardKind = null;
  finalScore = 0;
  bonus = 0;
  result: InteriorResult | null = null;

  constructor(readonly day: number) {
    this.layout = plantLayout(day);
  }

  /** Which bay (1..3) the carrier is currently in. */
  get bay(): 1 | 2 | 3 {
    return this.z < 45 ? 1 : this.z < 90 ? 2 : 3;
  }

  /** Progress along the plant floor (0..1). */
  get progress(): number {
    return Math.max(0, Math.min(1, this.z / PLANT_GOAL_Z));
  }

  get timeLeft(): number {
    return Math.max(0, PLANT_TIME_LIMIT - this.elapsed);
  }

  /** Live running score (or locked final score once finished/delivered). */
  get score(): number {
    if (this.phase === 'delivered' || (this.phase === 'finished' && this.result?.delivered)) return this.finalScore;
    if (this.phase === 'ruined' || this.phase === 'timeout' || this.phase === 'finished') return 0;
    const distancePts = Math.round(this.progress * 500);
    const integrityPts = this.integrity * 150;
    const cleanPts = this.hits === 0 ? 200 : 0;
    return Math.max(0, distancePts + integrityPts + cleanPts - this.hits * 150);
  }

  /** Conveyor push velocity at a floor point. */
  conveyorAt(x: number, z: number): { vx: number; vz: number } {
    for (const c of this.layout.conveyors) {
      if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1) return { vx: c.vx, vz: c.vz };
    }
    return { vx: 0, vz: 0 };
  }

  get message(): string {
    if (this.phase === 'delivered' || (this.phase === 'finished' && this.result?.delivered)) {
      return `Delivered to Dispatch. Score ${this.finalScore} · Tip +$${this.bonus}.`;
    }
    if (this.phase === 'ruined') return 'Parcel ruined on the plant floor. Returning to car.';
    if (this.phase === 'timeout') return 'Dispatch shutter closed. Returning to car.';
    if (this.phase === 'finished') return this.result?.note ?? 'Left the shop floor.';
    if (this.invuln > 0.6) {
      return this.lastHazard === 'crane'
        ? `Clipped by a crane beam. Parcel ${this.integrity}/${PLANT_MAX_INTEGRITY}.`
        : `Scorched on a hot grate. Parcel ${this.integrity}/${PLANT_MAX_INTEGRITY}.`;
    }
    if (this.z < 7) return 'Cross to the green Dispatch Cage. Dodge hot grates and cranes.';
    if (this.z >= 43 && this.z < 48) return 'Safe crossing. Bay 2: grates glow amber before heating.';
    if (this.z >= 88 && this.z < 93) return 'Safe crossing. Bay 3: crane span to Dispatch Cage.';
    if (this.z >= 123) return 'Dispatch Cage ahead. Clear the final crane beam.';
    if (this.bay === 1) return 'Bay 1 · Conveyors: counter-steer belts; take the green lane.';
    if (this.bay === 2) return 'Bay 2 · Hot Floor: cross dark iron; avoid glowing grates.';
    return 'Bay 3 · Crane Span: watch yellow floor shadows under loads.';
  }

  leave(): void {
    if (this.result) return;
    if (this.phase === 'delivered') {
      this.result = {
        delivered: true,
        score: this.finalScore,
        bonus: this.bonus,
        note: `Crossed Harbour Ridge Shop in ${Math.round(this.elapsed)} s. Score ${this.finalScore}. Shop tip: $${this.bonus}.`,
      };
    } else if (this.phase === 'ruined') {
      this.result = { delivered: false, score: 0, note: 'Parcel ruined on the plant floor.' };
    } else if (this.phase === 'timeout') {
      this.result = { delivered: false, score: 0, note: 'Dispatch shutter closed before you crossed.' };
    } else {
      this.result = { delivered: false, score: 0, note: 'Left the shop floor with the parcel.' };
    }
    this.phase = 'finished';
  }

  update(dt: number, input: PlantInput): void {
    let left = Math.max(0, dt);
    while (left > 1e-8 && !this.result) {
      const step = Math.min(left, 1 / 60);
      this.step(step, input);
      left -= step;
    }
  }

  private takeHit(kind: Exclude<HazardKind, null>): void {
    this.integrity = Math.max(0, this.integrity - 1);
    this.hits++;
    this.lastHazard = kind;
    this.invuln = HIT_INVULN;
    this.stagger = HIT_STAGGER;
    this.vx = 0;
    this.vz = 0;
    this.z = Math.max(0, this.z - HIT_KNOCKBACK);
    if (this.integrity <= 0) {
      this.phase = 'ruined';
      this.timer = LOSS_BEAT;
    }
  }

  private step(dt: number, input: PlantInput): void {
    if (this.phase !== 'running') {
      this.timer -= dt;
      if (this.timer <= 1e-6) this.leave();
      return;
    }
    this.elapsed += dt;
    if (this.elapsed >= PLANT_TIME_LIMIT) {
      this.elapsed = PLANT_TIME_LIMIT;
      this.vx = this.vz = 0;
      this.invuln = this.stagger = 0;
      this.phase = 'timeout';
      this.timer = LOSS_BEAT;
      return;
    }
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.stagger > 0) this.stagger = Math.max(0, this.stagger - dt);

    const fwd = this.stagger > 0 ? 0 : Math.max(-1, Math.min(1, input.forward));
    const side = this.stagger > 0 ? 0 : Math.max(-1, Math.min(1, input.side));
    const wantVz = fwd > 0.1 ? fwd * WALK_SPEED : fwd < -0.1 ? fwd * BACK_SPEED : 0;
    const wantVx = Math.abs(side) > 0.08 ? side * STRAFE_SPEED : 0;

    const dv = ACCEL * dt;
    this.vx += Math.max(-dv, Math.min(dv, wantVx - this.vx));
    this.vz += Math.max(-dv, Math.min(dv, wantVz - this.vz));

    const belt = this.conveyorAt(this.x, this.z);
    this.x = Math.max(-PLANT_HALF_WIDTH, Math.min(PLANT_HALF_WIDTH, this.x + (this.vx + belt.vx) * dt));
    this.z = Math.max(0, Math.min(PLANT_LENGTH, this.z + (this.vz + belt.vz) * dt));

    if (this.z >= PLANT_GOAL_Z) {
      this.z = PLANT_GOAL_Z;
      this.vx = this.vz = 0;
      this.invuln = this.stagger = 0;
      this.finalScore = plantScore(this.elapsed, this.integrity, this.hits);
      this.bonus = plantBonus(this.finalScore);
      this.phase = 'delivered';
      this.timer = WIN_BEAT;
      return;
    }

    if (this.invuln <= 0) {
      for (const spot of this.layout.hotSpots) {
        if (Math.abs(this.x - spot.x) < spot.halfX + PLAYER_RADIUS * 0.65 &&
            Math.abs(this.z - spot.z) < spot.halfZ + PLAYER_RADIUS * 0.65 &&
            hotSpotState(spot, this.elapsed).state === 'hot') {
          this.takeHit('hotSpot');
          return;
        }
      }
      for (const crane of this.layout.cranes) {
        const cx = craneX(crane, this.elapsed);
        if (Math.abs(this.x - cx) < crane.halfX + PLAYER_RADIUS &&
            Math.abs(this.z - crane.z) < crane.halfZ + PLAYER_RADIUS) {
          this.takeHit('crane');
          return;
        }
      }
    }
  }
}
