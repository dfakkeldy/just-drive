/**
 * Pure rules for the Boss's ride-along days in mail play: which days, where the Boss waits, what it sees, the write-up
 * when it pulls the player over, and what that does to the day's verdict. No DOM, no three.js: ride-along.ts drives the
 * car (the Get Fired Boss's car, boss-car.ts) and the cards. Distances are game metres, speeds m/s, times play seconds
 * unless they say shift seconds (the shift clock, CLOCK_FACTOR times faster).
 */
import { draw } from './shift-rules';
import { BESIDE, SLOW, STOP, STOP_HOLD, STUCK, STUCK_NEAR, roadTop, sees, type Mover, type Pose, type Spot } from './boss-rules';
import { offenceLabel } from './score-rules';

/** About one day in four is a ride-along day: the same days for every player (the career day is the seed). Day 1, the
 * first shift on the route, never is. */
export const RIDE_SHARE = .25;
const SALT = 83;
export function rideAlongDay(day: number): boolean { return Number.isSafeInteger(day) && day > 1 && draw(day, 0, SALT) < RIDE_SHARE; }
/** Mail play only (not Get Fired, so not Today's run), on today's roads, never on the Just Drive site; ?boss=0 or
 * ?rideAlong=0 leaves it out. Multiplayer is checked live (rideAlongLive). */
export function rideAlongEnabled(mailPlay: boolean, modern: boolean, just: boolean, params: URLSearchParams): boolean {
  return mailPlay && modern && !just && params.get('boss') !== '0' && params.get('rideAlong') !== '0';
}
/** Today a ride-along day? ?rideAlong=1 makes every day one (checks and pictures). */
export function rideAlongToday(day: number, params: URLSearchParams): boolean { return params.get('rideAlong') === '1' || rideAlongDay(day); }
/** Single player only. */
export const rideAlongLive = (multiplayer: boolean): boolean => !multiplayer;

/** The start card's line, the shift-start hint and the clean day's end-card line. */
export const START_LINE = 'The Boss is out on the route today.';
export const CLEAN_LINE = 'The Boss had nothing to say. That is the best he does.';
/** The start hint shows this long (play seconds). */
export const START_SHOW = 8;
export const FLASH_LINE = 'The Boss is flashing at you. Pull over.';

/** Where the Boss waits: the day's stops in a seeded order (the first one with a road to wait on wins), parked or
 * crawling, and which way along the road it faces. */
export interface PostPlan { readonly order: readonly number[]; readonly crawl: boolean; readonly reverse: boolean }
export function postPlan(day: number, stops: readonly number[]): PostPlan {
  return { order: [...stops].sort((a, b) => draw(day, a, SALT + 1) - draw(day, b, SALT + 1)),
    crawl: draw(day, 0, SALT + 2) < .5, reverse: draw(day, 0, SALT + 3) < .5 };
}
/** It waits this far before the stop, on the road edge, facing it. */
export const POST_BACK = 45;
/** Crawling: out along this much road from the post at CRAWL_SPEED (about 16 km/h), a wait, a slow turn in the road,
 * back, a wait, a turn, again. */
export const CRAWL_LENGTH = 180;
export const CRAWL_SPEED = 4.5;
export const CRAWL_WAIT = 12;
export const CRAWL_TURN = 4;
/** Where a crawl is `t` seconds after it began, on a stretch `length` long: metres along it, the side of the road
 * (`edge` is its own right edge, negative the other) and the heading added to the road's (0 out, PI back). It turns
 * across the road at each end: side and heading swing together. */
export function crawlPose(t: number, length: number, edge: number): { along: number; side: number; turn: number } {
  const leg = length / CRAWL_SPEED, half = leg + CRAWL_WAIT + CRAWL_TURN;
  let s = ((t % (2 * half)) + 2 * half) % (2 * half);
  const back = s >= half;
  if (back) s -= half;
  const dir = back ? -1 : 1, start = back ? length : 0, base = back ? Math.PI : 0;
  if (s < leg) return { along: start + dir * s * CRAWL_SPEED, side: dir * edge, turn: base };
  const end = length - start;
  if (s < leg + CRAWL_WAIT) return { along: end, side: dir * edge, turn: base };
  const f = (s - leg - CRAWL_WAIT) / CRAWL_TURN;
  return { along: end, side: dir * edge * Math.cos(Math.PI * f), turn: base + Math.PI * f };
}

/** It sees as the Get Fired Boss does at the third step: 90 m through the windscreen, 18 m all round, not through
 * buildings or hills (boss-rules.ts sees). */
export const WATCH_STEP = 3;
export function watchSees(boss: Pose, target: Spot, blocked?: (a: Spot, b: Spot) => boolean): boolean { return sees(boss, target, WATCH_STEP, blocked); }

/** The complaints it can see being earned: the avoidable ones that happen on the road in front of it. Not the
 * end-of-day sweep (a skipped stop, old flyers left in, the late call), a flag (no fault), an indoor desk (indoors) or
 * a box that was down before the shift. */
export const SEEABLE: readonly string[] = Object.freeze(['lawnDamage', 'propertyDamage', 'boxDown', 'lawnMail', 'ditchMail', 'relief', 'sceneHit', 'sceneHorn', 'sceneDust', 'sceneAnimal']);
export function seeable(kind: string, preExisting = false): boolean { return !preExisting && SEEABLE.includes(kind); }

/** Speeding past the Boss: this far over the road's limit (the touch help's table, boss-rules.ts roadTop), within
 * PASS_RANGE of it and in its sight, while it waits at its post. Once per pass: it counts again only after the player
 * has been REARM metres away. */
export const WELL_OVER = 25 / 3.6;
export const PASS_RANGE = 50;
export const REARM = 150;
export function speeding(speed: number, kind: number): boolean { return Math.abs(speed) > roadTop(kind) + WELL_OVER; }
const kmh = (ms: number): number => Math.round(ms * 3.6);
export function speedLabel(speed: number, kind: number): string { return `Speeding past the Boss: ${kmh(Math.abs(speed))} km/h where the limit is ${kmh(roadTop(kind))}`; }
/** A seen offence's words on the cards: the Get Fired labels (score-rules.ts) for complaints and the school bus. */
export const seenLabel = (kind: string): string => offenceLabel(kind);

/** Shift seconds a pull-over costs, and how near 18:00 it may take the clock: a write-up never ends the shift. */
export const CLOCK_COST = 20 * 60;
export const CLOCK_ROOM = 60;
export function clockJump(elapsed: number, shiftLength: number): number { return Math.max(0, Math.min(CLOCK_COST, shiftLength - CLOCK_ROOM - elapsed)); }
/** Out of its sight this long while it follows, and it gives up: the write-up is on file anyway. It also gives up after
 * FOLLOW_MAX of following with no stop near it (the player stopped far up a lane it cannot drive). */
export const LOSE = 25;
export const FOLLOW_MAX = 90;
/** Offences of one kind within this many shift seconds (two of play) are one act, seen once: one knock that downs both
 * boxes on a shared frame. */
export const ONE_ACT = 40;

export type WatchState = 'off' | 'post' | 'following' | 'away';
export interface Offence { readonly kind: string; readonly label: string; /** Shift seconds. */ readonly at: number }
export interface WatchInput {
  readonly boss: Mover;
  readonly player: Mover;
  /** It sees the player this tick (watchSees, with the line-of-sight test). */
  readonly seen: boolean;
  /** Its car is on the road. */
  readonly onRoad: boolean;
}
/**
 * One day's watch. 'post': waiting (parked or crawling) and watching. A seen offence is on file at once; it then
 * follows and flashes ('following') until the player stops near it (pulled over: the write-up) or gets away (it gives
 * up). Then it drives off ('away') and goes back to its post (back()). 'off': not a ride-along day.
 */
export class Watch {
  state: WatchState = 'off';
  readonly seen: Offence[] = [];
  /** Seen since the last write-up: the next card names these. */
  pending: Offence[] = [];
  signal = false;
  pulledOver = 0;
  gaveUp = 0;
  private stopped = 0;
  private slow = 0;
  private unseen = 0;
  private armed = true;
  private followed = 0;
  reset(today: boolean): void {
    this.state = today ? 'post' : 'off'; this.seen.length = 0; this.pending = []; this.signal = false;
    this.pulledOver = this.gaveUp = 0; this.stopped = this.slow = this.unseen = this.followed = 0; this.armed = true;
  }
  get watching(): boolean { return this.state === 'post' || this.state === 'following'; }
  /** An offence it saw: on file at once, and it follows and flashes. False when it was not watching. */
  saw(o: Offence): boolean {
    if (!this.watching) return false;
    const last = this.seen.at(-1);
    if (last && last.kind === o.kind && o.at - last.at <= ONE_ACT) return true;
    this.seen.push(o); this.pending.push(o);
    if (this.state === 'post') { this.state = 'following'; this.signal = true; this.stopped = this.slow = this.unseen = this.followed = 0; }
    return true;
  }
  /** True when this tick is a new speeding pass: at its post, in its sight, near and well over the road's limit. */
  passing(i: WatchInput, kind: number | null): boolean {
    const d = Math.hypot(i.player.x - i.boss.x, i.player.z - i.boss.z);
    if (!this.armed) { if (d > REARM) this.armed = true; return false; }
    if (this.state !== 'post' || !i.seen || !i.onRoad || kind === null || d > PASS_RANGE || !speeding(i.player.speed, kind)) return false;
    this.armed = false;
    return true;
  }
  tick(dt: number, i: WatchInput): 'pulledOver' | 'gaveUp' | null {
    if (this.state !== 'following') return null;
    if (!i.onRoad) return this.giveUp();
    this.unseen = i.seen ? 0 : this.unseen + dt;
    if (this.unseen >= LOSE || (this.followed += dt) >= FOLLOW_MAX) return this.giveUp();
    const centre = Math.hypot(i.player.x - i.boss.x, i.player.z - i.boss.z), speed = Math.abs(i.player.speed);
    // As in Get Fired: stopped with it near, crawling with it beside, or stuck slow with it near.
    this.stopped = speed < STOP ? this.stopped + dt : 0;
    this.slow = speed < SLOW && centre <= STUCK_NEAR ? this.slow + dt : 0;
    if ((this.stopped >= STOP_HOLD && centre <= STUCK_NEAR) || (speed < SLOW && centre <= BESIDE) || this.slow >= STUCK) {
      this.pulledOver++; this.leave();
      return 'pulledOver';
    }
    return null;
  }
  /** The offences the write-up names; the Boss drives off. */
  release(): Offence[] { const written = this.pending; this.pending = []; this.leave(); return written; }
  /** Back at its post, watching again. */
  back(): void { if (this.state === 'away') { this.state = 'post'; this.armed = false; } }
  private giveUp(): 'gaveUp' { this.gaveUp++; this.pending = []; this.leave(); return 'gaveUp'; }
  private leave(): void { this.state = 'away'; this.signal = false; this.stopped = this.slow = this.unseen = this.followed = 0; }
}

export type Verdict = 'clear' | 'warning' | 'suspension';
/** The day's verdict with what the Boss saw: one seen offence is at least a warning; two, or any seen lawn damage, is a
 * suspension. `base` is the existing verdict (shift-rules.ts) on the upheld complaints, which stands for everything
 * unseen. */
export function seenVerdict(base: Verdict, seen: readonly { readonly kind: string }[]): Verdict {
  if (!seen.length) return base;
  if (seen.length >= 2 || seen.some(s => s.kind === 'lawnDamage')) return 'suspension';
  return base === 'clear' ? 'warning' : base;
}

/** The Boss at the window: dry, never cruel. `n` (1 = first) picks the line. */
export const WINDOW: readonly string[] = Object.freeze([
  'The Boss walks up slowly, clipboard first, and writes for a while. "Carry on."',
  'The Boss leans in at the window. "I was only out for a drive." Writes it down anyway.',
  'The Boss reads the write-up back to you, all of it, then asks after your family.',
  'The Boss taps the clipboard twice. "That goes in the file." It is a thick file.',
]);
/** The card after a pull-over. `jumped`: shift seconds the clock really jumped. */
export function writeUpCard(n: number, written: readonly Offence[], jumped: number): { title: string; lines: string[] } {
  const minutes = Math.round(jumped / 60);
  return {
    title: 'Written up',
    lines: [WINDOW[Math.max(0, n - 1) % WINDOW.length],
      written.length ? `Seen by the Boss: ${written.map(o => o.label).join('; ')}.` : 'Seen by the Boss.',
      `${minutes ? `That took ${minutes} minutes. ` : ''}The shift goes on.`],
  };
}
/** The end card's lines on a ride-along day: what it saw, or the clean day's line. */
export function seenReport(seen: readonly Offence[], gaveUp: number): string[] {
  if (!seen.length) return [CLEAN_LINE];
  return [`Seen by the Boss: ${seen.map(o => o.label).join('; ')}.`,
    ...gaveUp ? ['You did not stop for the Boss. It went in the file anyway.'] : []];
}
