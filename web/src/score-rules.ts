/** Pure rules for Get Fired: score-stream events in, points, combo and the discipline ladder out. No DOM, no three.js. */
import type { ScoreEvent } from './score-events';

/** Base points. A kind with no row scores nothing; later tasks add rows (drift, airtime, nearMiss, broken props). */
export const POINTS: Readonly<Record<string, number>> = Object.freeze({
  // Thirteen of the fourteen complaint kinds. sceneAnimal (an animal had to get out of the way) has no row: like a hit
  // (NEVER), frightening an animal never gives points.
  lawnMail: 40, ditchMail: 50, lawnDamage: 120, boxDown: 100, missing: 60, stuffed: 50, flag: 30, late: 25,
  indoors: 90, relief: 150, sceneHit: 200, sceneHorn: 80, sceneDust: 120,
  // Mailbox damage grades, once per box and grade.
  'box:rock': 10, 'box:lean': 30, 'box:dent': 60, 'box:down': 60,
  // A burst of tyre strips across a lawn.
  rut: 10,
});
/** Fixed points that ignore combo and ladder, and end a combo. The school bus rule stays a penalty here. */
export const PENALTIES: Readonly<Record<string, number>> = Object.freeze({ schoolBus: -300 });
/** Real places where nothing scores: no points, no combo. */
export const PROTECTED: readonly string[] = Object.freeze(['cemetery', 'church', 'busStop']);
/** Hitting an animal or a person never gives points: the rule for every later kind that names what was hit. */
export const NEVER: readonly string[] = Object.freeze(['animal', 'person']);

/** Offences within this many play seconds of the last keep a combo going. */
export const COMBO_WINDOW = 4;
/** Each new kind of offence inside one combo adds this much to the combo multiplier, up to COMBO_CAP. */
export const COMBO_STEP = .25;
export const COMBO_CAP = 3;
/** A kind grows a combo only for its first few offences in a run: a stale repeat never builds one. */
export const COMBO_FRESH = 3;
/** The first offence of a kind is worth NEW_KIND times its base; the n-th repeat REPEAT^n. There is no floor: a repeat
 * fades to nothing, so no kind pays forever (a rut every three metres of one lawn, all day, stays near zero). */
export const NEW_KIND = 2;
export const REPEAT = .75;
/** Each ladder step reached raises the multiplier by this much. */
export const STEP_BONUS = .25;

export interface Rung { readonly name: string; readonly at: number; readonly steward: string }
/** The discipline ladder. Each step needs more points than the one before, and a bigger gap. */
export const LADDER: readonly Rung[] = Object.freeze([
  { name: 'Coaching chat', at: 250, steward: 'The steward sat in and took notes. You still work here.' },
  { name: 'Verbal warning', at: 700, steward: 'Nothing was written down, says the steward. You still work here.' },
  { name: 'Written warning', at: 1500, steward: 'Grievance filed. You still work here.' },
  { name: 'One-day suspension', at: 2700, steward: 'The union grieves it as excessive. You still work here.' },
  { name: 'Three-day suspension', at: 4400, steward: 'Grieved on procedure: nobody signed the form. You still work here.' },
  { name: 'Hearing', at: 6800, steward: 'The union asks for an adjournment. Granted. You still work here.' },
  { name: 'Fired', at: 10000, steward: 'The union will grieve it in the morning. Hand in the keys.' },
]);
export const CLEAN_RECORD = 'Clean record';

const LABELS: Readonly<Record<string, string>> = Object.freeze({
  lawnMail: 'Mail on a lawn', ditchMail: 'Mail in a ditch', lawnDamage: 'Lawn ploughed', boxDown: 'Mailbox down, customer called',
  missing: 'Stop skipped', stuffed: 'Old flyers left in', flag: 'Flag moved', late: 'Late again', indoors: 'Indoor parcel refused',
  relief: 'Seen at the roadside', sceneHit: 'Bumped the visitor’s car', sceneHorn: 'Horn at the visitor', sceneDust: 'Dust on a painting',
  sceneAnimal: 'An animal had to get out of the way',
  'box:rock': 'Rocked a mailbox', 'box:lean': 'Leaned a mailbox', 'box:dent': 'Dented a mailbox', 'box:down': 'Flattened a mailbox',
  rut: 'Lawn ruts', schoolBus: 'Passed a flashing school bus',
});
export const offenceLabel = (kind: string): string => LABELS[kind] ?? kind;

/** True when this event may earn points at all. */
export function scores(e: ScoreEvent): boolean {
  return !PROTECTED.includes(e.place) && !(e.subject !== undefined && NEVER.includes(e.subject)) && (POINTS[e.kind] ?? 0) > 0;
}
export const comboFactor = (chain: number): number => Math.min(COMBO_CAP, 1 + COMBO_STEP * Math.max(0, chain - 1));
export const novelty = (before: number): number => before === 0 ? NEW_KIND : REPEAT ** before;
export const ladderFactor = (step: number): number => 1 + STEP_BONUS * step;
/** Rungs reached at this total: 0 is a clean record, LADDER.length is Fired. */
export function stepFor(total: number): number {
  let step = 0;
  while (step < LADDER.length && total >= LADDER[step].at) step++;
  return step;
}
export const stepName = (step: number): string => step <= 0 ? CLEAN_RECORD : LADDER[Math.min(step, LADDER.length) - 1].name;

export interface Scored {
  readonly points: number;
  /** Combo multiplier used (1 when no combo). */
  readonly combo: number;
  /** The rung newly reached by this event (0 when none). */
  readonly stepUp: number;
  readonly firstOfKind: boolean;
}
interface Tally { count: number; points: number }

export class ScoreBook {
  total = 0;
  /** Rungs ever reached. The ladder never steps down, even when a penalty lowers the total. */
  step = 0;
  /** Distinct kinds in the current combo. Only a new kind grows it or keeps it open; repeats share it while it lasts. */
  chain = 0;
  chainPoints = 0;
  bestChain = { kinds: 0, points: 0 };
  lastTime = -Infinity;
  readonly kinds = new Map<string, Tally>();
  private readonly chainKinds = new Set<string>();
  get fired(): boolean { return this.step >= LADDER.length; }
  get multiplier(): number { return ladderFactor(this.step); }
  /** Combo multiplier still live at this time (1 when the window has closed). */
  comboAt(time: number): number { return this.comboLeft(time) > 0 ? comboFactor(this.chain) : 1; }
  comboLeft(time: number): number { return this.chain > 0 ? Math.max(0, COMBO_WINDOW - (time - this.lastTime)) : 0; }

  add(e: ScoreEvent): Scored {
    const penalty = PENALTIES[e.kind];
    if (penalty !== undefined) {
      this.total += penalty; this.tally(e.kind, penalty); this.endChain();
      return { points: penalty, combo: 1, stepUp: 0, firstOfKind: false };
    }
    if (!scores(e)) return { points: 0, combo: 1, stepUp: 0, firstOfKind: false };
    const before = this.kinds.get(e.kind)?.count ?? 0;
    if (e.time - this.lastTime > COMBO_WINDOW) this.endChain();
    if (before < COMBO_FRESH && !this.chainKinds.has(e.kind)) { this.chainKinds.add(e.kind); this.chain = this.chainKinds.size; this.lastTime = e.time; }
    const combo = comboFactor(this.chain);
    const points = Math.round(POINTS[e.kind] * novelty(before) * combo * this.multiplier);
    this.total += points; this.tally(e.kind, points);
    this.chainPoints += points;
    if (this.chainPoints > this.bestChain.points) this.bestChain = { kinds: this.chain, points: this.chainPoints };
    const was = this.step;
    this.step = Math.max(this.step, stepFor(this.total));
    return { points, combo, stepUp: this.step > was ? this.step : 0, firstOfKind: before === 0 };
  }
  private tally(kind: string, points: number): void {
    const t = this.kinds.get(kind);
    if (t) { t.count++; t.points += points; } else this.kinds.set(kind, { count: 1, points });
  }
  private endChain(): void { this.chain = 0; this.chainPoints = 0; this.chainKinds.clear(); this.lastTime = -Infinity; }
}

/** The offences that earned most, for the end card. Penalties and zero rows are left out. */
export function topOffences(book: ScoreBook, n = 3): { kind: string; label: string; count: number; points: number }[] {
  return [...book.kinds].filter(([, t]) => t.points > 0)
    .map(([kind, t]) => ({ kind, label: offenceLabel(kind), count: t.count, points: t.points }))
    .sort((a, b) => b.points - a.points || b.count - a.count || (a.kind < b.kind ? -1 : 1)).slice(0, n);
}

/** Points to the next rung, and how far along it the total is (0..1). */
export function progress(total: number, step: number): { next: string; need: number; fraction: number } {
  if (step >= LADDER.length) return { next: '', need: 0, fraction: 1 };
  const from = step === 0 ? 0 : LADDER[step - 1].at, to = LADDER[step].at;
  return { next: LADDER[step].name, need: Math.max(0, to - total), fraction: Math.max(0, Math.min(1, (total - from) / (to - from))) };
}

export interface BestRun { step: number; total: number; timeLeft: number; chain: number }
/** Its own key: never career pay, never mmm.shift.v1. */
export const BEST_KEY = 'mmm.fired.best.v1';
/** Higher rung first, then more points, then more of the day left. */
export function better(run: BestRun, best: BestRun | null): boolean {
  if (!best) return true;
  return run.step !== best.step ? run.step > best.step : run.total !== best.total ? run.total > best.total : run.timeLeft > best.timeLeft;
}
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readBest(storage: () => Store = () => localStorage): BestRun | null {
  try {
    const b = JSON.parse(storage().getItem(BEST_KEY) ?? 'null') as BestRun | null;
    if (b && Number.isSafeInteger(b.step) && b.step >= 0 && b.step <= LADDER.length && Number.isFinite(b.total) &&
      Number.isFinite(b.timeLeft) && b.timeLeft >= 0 && Number.isFinite(b.chain) && b.chain >= 0)
      return { step: b.step, total: b.total, timeLeft: b.timeLeft, chain: b.chain };
  } catch { /* A sandbox may refuse storage, or the value is not ours. */ }
  return null;
}
/** Saves only a better run. Returns the best run after the save (which may be this one). */
export function saveBest(run: BestRun, storage: () => Store = () => localStorage): BestRun {
  const best = readBest(storage);
  if (!better(run, best)) return best!;
  try { storage().setItem(BEST_KEY, JSON.stringify(run)); } catch { /* Memory still shows it. */ }
  return run;
}
/** Shift clock seconds left before 18:00, as words. */
export function timeLeftText(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return minutes === 0 ? 'no time left' : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min left`;
}

/** A protected circle of real ground: a church ground or the school bus stop. Game metres. */
export interface Zone { readonly place: string; readonly x: number; readonly z: number; readonly radius: number }
/** 'route', or the protected place that holds this point. Cemeteries are polygons, so the caller passes their test. */
export function placeAt(x: number, z: number, zones: readonly Zone[], cemetery?: (x: number, z: number) => boolean): string {
  if (cemetery?.(x, z)) return 'cemetery';
  for (const zone of zones) if ((x - zone.x) ** 2 + (z - zone.z) ** 2 <= zone.radius ** 2) return zone.place;
  return 'route';
}
/** Church grounds: every landmark named a church, as a circle round its footprint plus a margin of ground. */
export function churchZones(landmarks: readonly { name: string; footprint: readonly (readonly [number, number])[] }[],
  village: readonly [number, number], margin = 40): Zone[] {
  return landmarks.filter(l => /church/i.test(l.name) && l.footprint.length > 0).map(l => {
    const pts = l.footprint.map(([e, n]) => ({ x: e - village[0], z: village[1] - n }));
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    return { place: 'church', x, z, radius: Math.max(...pts.map(p => Math.hypot(p.x - x, p.z - z))) + margin };
  });
}
/** The school bus stop: its own ground, whether or not the bus is there. */
export const BUS_STOP_RADIUS = 40;
