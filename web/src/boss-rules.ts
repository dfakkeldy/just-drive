/**
 * Pure rules for the Boss in Get Fired: what it can see, its pursuit (patrol, on its way, following, pulled over,
 * lost), how fast it may drive and what a pull-over costs. No DOM, no three.js: boss.ts drives the car and the HUD.
 * Distances are game metres, speeds m/s, times play seconds (paused time does not count).
 */

/** Built only in Get Fired, on today's roads, and not with ?boss=0. Not in Today's run (`daily`): its five minutes run on
 * the shift clock, which a pull-over would jump. Multiplayer is checked live (bossLive). */
export function bossEnabled(firedMode: boolean, modern: boolean, params: URLSearchParams, daily = false): boolean {
  return firedMode && !daily && modern && params.get('boss') !== '0';
}
/** The live rule: single player, and only after the first discipline step. */
export function bossLive(multiplayer: boolean, step: number): boolean { return !multiplayer && step >= 1; }

export type BossState = 'patrol' | 'onItsWay' | 'following' | 'pulledOver' | 'lost';
export interface Spot { readonly x: number; readonly z: number }
export interface Pose extends Spot { readonly heading: number }
export interface Mover extends Pose { readonly speed: number }

/** The Boss sees this far at step 1, and SIGHT_PER_STEP more each step after, up to SIGHT_MAX. */
export const SIGHT_BASE = 70;
export const SIGHT_PER_STEP = 10;
export const SIGHT_MAX = 120;
/** Half the angle of its view through the windscreen, either side of straight ahead. */
export const SIGHT_HALF_ANGLE = 65 * Math.PI / 180;
/** Closer than this it sees all round (mirrors, the side windows). */
export const SIGHT_NEAR = 18;
/** An offence it sees is "witnessed" and scores double: score-rules.ts WITNESSED. */

/** "Close behind": the player ahead, within this many metres bumper to bumper, inside FOLLOW_CONE of the Boss's nose. */
export const CLOSE_GAP = 10;
export const FOLLOW_CONE = 35 * Math.PI / 180;
/** Two cars of the game are 4.6 m long: centre to centre is the gap plus this. */
export const CAR_LENGTH = 4.6;
/** Seconds close behind before it flashes and honks. */
export const HOLD = 3;
/** While it flashes: stopped (under STOP m/s) this long is pulled over. Long enough to see the flash and hear the horn
 * first, when the player was already standing still. */
export const STOP = .5;
export const STOP_HOLD = 1.5;
/** Slow (under SLOW m/s, about 10 km/h) with the Boss beside (centre to centre within BESIDE) is pulled over at once. */
export const SLOW = 10 / 3.6;
export const BESIDE = 8;
/** Slow this long with the Boss within STUCK_NEAR is stuck, and pulled over. */
export const STUCK = 4;
export const STUCK_NEAR = 20;
/** Out of close range this long while it flashes, and it stops flashing (it follows on). */
export const SIGNAL_DROP = 4;
/** Out of its sight this long and it gives up, at step 1; LOSE_PER_STEP more each step after, up to LOSE_MAX. */
export const LOSE_BASE = 20;
export const LOSE_PER_STEP = 2;
export const LOSE_MAX = 30;
/** "Lost the Boss" shows this long before it is back on patrol. */
export const LOST_SHOW = 3;
/** After a pull-over it drives off and keeps away this long. */
export const COOLDOWN = 30;
/** Within this of a lead it has seen the place: no lead, back on patrol. */
export const LEAD_REACHED = 30;
/** A lead it cannot reach (no road it may take goes there) is dropped after this long: back on patrol. */
export const ON_WAY_MAX = 150;

/** Shift clock seconds a pull-over costs at a step: twenty minutes at step 1, five more each step after. */
export function clockCost(step: number): number { return (15 + 5 * Math.max(1, step)) * 60; }
/** Sight range at a ladder step. */
export function sightRange(step: number): number { return Math.min(SIGHT_MAX, SIGHT_BASE + SIGHT_PER_STEP * Math.max(0, step - 1)); }
/** Seconds out of sight before it gives up. */
export function loseTime(step: number): number { return Math.min(LOSE_MAX, LOSE_BASE + LOSE_PER_STEP * Math.max(0, step - 1)); }

/** Never more than this share of the player's top speed on an open road. */
export const TOP_SHARE = .8;
export const PATROL_SPEED = 11;
/** Its cruise in a pursuit: faster at each step, never over TOP_SHARE of the player's top speed. */
export function cruise(state: BossState, step: number, playerTop: number): number {
  const want = state === 'onItsWay' || state === 'following' ? 14 + 2 * Math.max(1, step) : PATROL_SPEED;
  return Math.min(want, playerTop * TOP_SHARE);
}
/** Where it may appear: a hidden road this far from the player. Nearer at higher steps (it arrives sooner). */
export function spawnRange(step: number): readonly [number, number] {
  const s = Math.max(1, step);
  return [Math.max(120, 260 - 25 * s), Math.max(300, 550 - 40 * s)];
}
/** Follow speed: hold a gap of FOLLOW_KEEP metres bumper to bumper behind the body ahead, closing at most at `limit`. */
export const FOLLOW_KEEP = 6;
export function followSpeed(gap: number, aheadSpeed: number, limit: number): number {
  return Math.max(0, Math.min(limit, Math.max(0, aheadSpeed) + (gap - FOLLOW_KEEP) * .6));
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Angle off the nose of `from` (0 straight ahead) to `to`. Heading 0 is north (-z), clockwise. */
export function offNose(from: Pose, to: Spot): number { return Math.abs(wrap(Math.atan2(to.x - from.x, -(to.z - from.z)) - from.heading)); }

/**
 * True when the Boss sees a point: near enough, in front (or very near) and not behind a building or a hill.
 * `blocked` tells whether the straight line between them is cut; it is called last, only when the rest says yes.
 */
export function sees(boss: Pose, target: Spot, step: number, blocked?: (a: Spot, b: Spot) => boolean): boolean {
  const d = Math.hypot(target.x - boss.x, target.z - boss.z);
  if (d > sightRange(step)) return false;
  if (d > SIGHT_NEAR && offNose(boss, target) > SIGHT_HALF_ANGLE) return false;
  return !blocked?.(boss, target);
}

/** Close behind: the player ahead of the Boss's nose and within CLOSE_GAP bumper to bumper. */
export function closeBehind(boss: Pose, player: Spot): boolean {
  const d = Math.hypot(player.x - boss.x, player.z - boss.z);
  return d - CAR_LENGTH <= CLOSE_GAP && offNose(boss, player) <= FOLLOW_CONE;
}

/** Axis-aligned boxes [x0, z0, x1, z1] that block sight (buildings), on a grid for a quick line test. */
export class Occluders {
  private readonly cells = new Map<number, number[]>();
  constructor(readonly boxes: readonly (readonly [number, number, number, number])[], private readonly cell = 32) {
    boxes.forEach((b, i) => {
      for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++)
        for (let cz = Math.floor(b[1] / cell); cz <= Math.floor(b[3] / cell); cz++) {
          const k = this.key(cx, cz), list = this.cells.get(k);
          if (list) list.push(i); else this.cells.set(k, [i]);
        }
    });
  }
  private key(cx: number, cz: number): number { return (cx + 32768) * 65536 + (cz + 32768); }
  /** True when the segment a-b passes through a box. Boxes holding either end do not count (a car beside a wall). */
  blocks(a: Spot, b: Spot): boolean {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell / 2))), seen = new Set<number>();
    for (let s = 0; s <= n; s++) {
      const x = a.x + (b.x - a.x) * s / n, z = a.z + (b.z - a.z) * s / n;
      for (const i of this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const box = this.boxes[i];
        if (inside(box, a) || inside(box, b)) continue;
        if (segmentHitsBox(a, b, box)) return true;
      }
    }
    return false;
  }
}
const inside = (b: readonly number[], p: Spot): boolean => p.x >= b[0] && p.x <= b[2] && p.z >= b[1] && p.z <= b[3];
/** Slab test of a segment against a box. */
export function segmentHitsBox(a: Spot, b: Spot, box: readonly number[]): boolean {
  let t0 = 0, t1 = 1;
  for (const [p, d, lo, hi] of [[a.x, b.x - a.x, box[0], box[2]], [a.z, b.z - a.z, box[1], box[3]]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; continue; }
    let u = (lo - p) / d, v = (hi - p) / d;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  return true;
}
/** A hill in the way: the ground rises above the line from eye to eye (`eye` metres up at each end) somewhere between. */
export function hillBetween(a: Spot, b: Spot, ground: (x: number, z: number) => number | null, eye = 1.4, samples = 8): boolean {
  const ga = ground(a.x, a.z), gb = ground(b.x, b.z);
  if (ga === null || gb === null) return false;
  for (let i = 1; i < samples; i++) {
    const t = i / samples, g = ground(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    if (g !== null && g > ga + eye + (gb - ga) * t + .3) return true;
  }
  return false;
}

/** What one tick of the pursuit hands back to the game. */
export type PursuitEvent = 'seen' | 'signal' | 'pulledOver' | 'lost' | null;
export interface PursuitInput {
  readonly boss: Mover;
  readonly player: Mover;
  /** The Boss sees the player this tick (sees(), with the line-of-sight test). */
  readonly seen: boolean;
  /** The Boss's car is on the road (spawned). */
  readonly onRoad: boolean;
}

/** The pursuit. One per run; the state changes only through these methods. */
export class Pursuit {
  state: BossState = 'patrol';
  /** Where the last complaint came from (onItsWay heads there). */
  lead: Spot | null = null;
  /** Where it last saw the player (following heads there). */
  lastSeen: { x: number; z: number } | null = null;
  /** True while it flashes and honks. */
  signal = false;
  pulledOver = 0;
  escaped = 0;
  /** Seconds left: of the lost line, of the cooldown after a pull-over. */
  lostShow = 0;
  cooldown = 0;
  private hold = 0;
  private apart = 0;
  private unseen = 0;
  private stopped = 0;
  private slow = 0;
  private onWay = 0;

  reset(): void {
    this.state = 'patrol'; this.lead = this.lastSeen = null; this.signal = false;
    this.pulledOver = this.escaped = 0; this.lostShow = this.cooldown = 0; this.clearTimers();
  }
  private clearTimers(): void { this.hold = this.apart = this.unseen = this.stopped = this.slow = this.onWay = 0; }
  /** A complaint at this point: the newest is its lead. While it follows the player it keeps following. */
  complaint(at: Spot): void {
    if (this.cooldown > 0 || this.state === 'pulledOver') return;
    this.lead = { x: at.x, z: at.z }; this.onWay = 0;
    if (this.state === 'patrol' || this.state === 'lost') { this.state = 'onItsWay'; this.lostShow = 0; }
  }
  /** Where it drives: the player while it follows, the lead while it is on its way, nowhere on patrol. */
  goal(): Spot | null { return this.state === 'following' ? this.lastSeen : this.state === 'onItsWay' ? this.lead : null; }

  tick(dt: number, step: number, i: PursuitInput): PursuitEvent {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.state === 'pulledOver') return null;
    if (this.state === 'lost') {
      this.lostShow -= dt;
      if (this.lostShow <= 0) { this.state = 'patrol'; this.lostShow = 0; }
    }
    if (this.state === 'onItsWay' && (this.onWay += dt) >= ON_WAY_MAX) { this.state = 'patrol'; this.lead = null; this.onWay = 0; }
    if (!i.onRoad) {
      // Off the road (not yet spawned, or gone round a corner and taken off): a follow runs out like unseen time.
      if (this.state === 'following') return this.outOfSight(dt, step);
      return null;
    }
    if (i.seen && this.cooldown <= 0) {
      const first = this.state !== 'following';
      this.state = 'following'; this.unseen = 0; this.lostShow = 0;
      if (this.lastSeen) { this.lastSeen.x = i.player.x; this.lastSeen.z = i.player.z; } else this.lastSeen = { x: i.player.x, z: i.player.z };
      if (first) { this.hold = this.apart = this.stopped = this.slow = 0; this.signal = false; return 'seen'; }
    } else if (this.state === 'following') {
      const e = this.outOfSight(dt, step);
      if (e) return e;
    }
    if (this.state === 'onItsWay' && this.lead && Math.hypot(this.lead.x - i.boss.x, this.lead.z - i.boss.z) <= LEAD_REACHED) {
      this.lead = null; this.state = 'patrol';
    }
    if (this.state !== 'following') return null;
    const close = i.seen && closeBehind(i.boss, i.player);
    const centre = Math.hypot(i.player.x - i.boss.x, i.player.z - i.boss.z), speed = Math.abs(i.player.speed);
    if (!this.signal) {
      this.hold = close ? this.hold + dt : 0;
      if (this.hold >= HOLD) { this.signal = true; this.apart = this.stopped = this.slow = 0; return 'signal'; }
      return null;
    }
    // Flashing: the player is pulled over by stopping, by crawling with the Boss beside, or by being stuck.
    this.stopped = speed < STOP ? this.stopped + dt : 0;
    this.slow = speed < SLOW && centre <= STUCK_NEAR ? this.slow + dt : 0;
    // Stopping counts only with the Boss still near: a stop at the next junction after getting away is not a pull-over.
    if ((this.stopped >= STOP_HOLD && centre <= STUCK_NEAR) || (speed < SLOW && centre <= BESIDE) || this.slow >= STUCK) return this.pullOver();
    this.apart = close || centre <= STUCK_NEAR ? 0 : this.apart + dt;
    if (this.apart >= SIGNAL_DROP) { this.signal = false; this.hold = 0; }
    return null;
  }
  private outOfSight(dt: number, step: number): PursuitEvent {
    this.unseen += dt;
    if (this.unseen < loseTime(step)) return null;
    this.state = 'lost'; this.escaped++; this.lostShow = LOST_SHOW; this.lead = this.lastSeen = null;
    this.signal = false; this.clearTimers();
    return 'lost';
  }
  private pullOver(): PursuitEvent {
    this.state = 'pulledOver'; this.pulledOver++; this.signal = false; this.clearTimers();
    return 'pulledOver';
  }
  /** After the card: it drives off, keeps away for COOLDOWN, then patrols. */
  release(): void {
    this.state = 'patrol'; this.lead = this.lastSeen = null; this.cooldown = COOLDOWN; this.clearTimers();
  }
}

/** The line under the score while it matters, or '' when the Boss is nowhere near the story. */
export function bossLine(p: Pursuit): string {
  if (p.state === 'lost') return 'Lost the Boss.';
  if (p.state === 'pulledOver') return 'Pulled over.';
  if (p.state === 'following') return p.signal ? 'The Boss is flashing at you. Pull over.' : 'The Boss has seen you.';
  if (p.state === 'onItsWay') return 'The Boss is on its way.';
  return '';
}

/** The card after a pull-over: the Boss at the window, the suspension, the steward. `n` picks the lines (1 = first). */
export const WINDOW: readonly string[] = Object.freeze([
  'The Boss leans in at the window. "Nice day for it." That is all. It is enough.',
  'The Boss taps on the glass and holds up a complaint form. Then another one.',
  'The Boss looks at the mail on the passenger seat for a long time, and sighs.',
  'The Boss at the window: "I had three calls before my coffee."',
]);
export const STEWARD: readonly string[] = Object.freeze([
  'The steward grieves it: you were stopped on a public road, not at the depot.',
  'The steward grieves it: nobody offered you a representative at the window.',
  'The steward grieves it: the Boss was parked on the shoulder without a permit.',
  'The steward grieves it: the clipboard was not the approved clipboard.',
]);
/** The pull-over card. `jumped`: the shift seconds really taken, less than clockCost when 18:00 came first. */
export function pullOverCard(n: number, step: number, jumped = clockCost(step)): { title: string; lines: string[] } {
  const minutes = Math.round(jumped / 60), i = Math.max(0, n - 1);
  return {
    title: 'Pulled over',
    lines: [WINDOW[i % WINDOW.length], `Suspended on the spot: the clock jumps ${minutes} minutes and your combo is gone.`, STEWARD[i % STEWARD.length]],
  };
}
/** The end card's line. */
export function bossSummary(pulled: number, escaped: number, met: boolean): string {
  if (!met) return 'The Boss never came out.';
  const times = (n: number) => n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
  return `Pulled over ${pulled ? times(pulled) : 'never'} · lost the Boss ${escaped ? times(escaped) : 'never'}.`;
}

/**
 * Goal steering for a road follower that cannot reverse. Given the way it points now and the headings of a road
 * that joins ahead, is turning onto it worth it? Each road has two directions; one pointing back at the car is not
 * offered. Returns the better heading's score gain (cos toward the goal), or -Infinity when nothing is better.
 */
export function branchGain(heading: number, goalBearing: number, branchHeading: number): number {
  const keep = Math.cos(wrap(goalBearing - heading));
  let best = -Infinity;
  for (const h of [branchHeading, branchHeading + Math.PI]) {
    if (Math.cos(wrap(h - heading)) < -.3) continue;   // back the way it came
    best = Math.max(best, Math.cos(wrap(goalBearing - h)) - keep);
  }
  return best;
}
/** Turn the car round (only when nobody can see it): the goal is well behind it and not close. */
export function turnRound(boss: Pose, goal: Spot): boolean {
  return Math.hypot(goal.x - boss.x, goal.z - boss.z) > 40 && offNose(boss, goal) > 2.2;
}
/** Bearing (0 north, clockwise) from a point to a point. */
export const bearing = (from: Spot, to: Spot): number => Math.atan2(to.x - from.x, -(to.z - from.z));
/** A car's top speed on an open paved road (vehicle.ts: power over speed against rolling and air drag), m/s. */
export function openRoadTop(spec: { readonly enginePower: number; readonly engineAcceleration: number; readonly aeroDrag: number }, roll = .013): number {
  let v = 0;
  for (let i = 0; i < 400; i++) {
    const push = Math.min(spec.engineAcceleration, spec.enginePower / (v + 1)), drag = roll * 9.81 + spec.aeroDrag * v * v;
    if (push <= drag) break;
    v += .25;
  }
  return v;
}
/** The touch driving help's speed limit on a road kind (vehicle.ts, the same table), m/s: on a phone the player's
 * car goes no faster there, so neither may the Boss's. */
export function roadTop(kind: number): number {
  return (kind === 1 ? 100 : kind === 2 || kind === 13 ? 90 : kind === 3 ? 75 : kind === 5 ? 55 : 50) / 3.6;
}
