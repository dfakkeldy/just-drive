/**
 * Pure rules for Today's board: what a posted Today's run result is, what the board server takes and refuses, how a
 * board ranks and keeps its rows, when a board is deleted, and how often one address may knock. The game and the
 * Worker (server/src/board.ts) both use this file, so the server scores a run with the very rules the game played it
 * by (daily-rules, score-rules). No DOM, no Cloudflare type, no storage, no clock of its own: `now` is passed in.
 */
import {
  BingoCard, CARD_BONUS, CARD_SIZE, DAILY_LIMIT, LINES, LINE_BONUS, atlanticDate, betterDaily, bingoBonus, dailyArea, dailyPlan, drawCard,
  packFilled, supplyFor, type DailyPlan, type DailyResult, type Square, type Supply,
} from './daily-rules';
import { COMBO_CAP, DRIFT_MARKS, LADDER, PENALTIES, POINTS, ScoreBook, ladderFactor, novelty, scores } from './score-rules';
import { LOOSE, looseSurface } from './drift-rules';
import type { ScoreEvent } from './score-events';
import { inventedName, readHandle } from './mp/social';

export const BOARD_VERSION = 1;
/** Rows kept on one board (one area, one Atlantic day). */
export const BOARD_KEEP = 100;
/** A board is deleted when it is older than this many days. */
export const BOARD_DAYS = 60;
/** Results one board takes in its day, at most. A post writes four rows at most, so each board stays under 8,000 of the
 * free plan's 100,000 rows written a day; areas × POSTS_PER_BOARD × 4 must stay well under that when areas are added. */
export const POSTS_PER_BOARD = 2000;
/** Facts one run may send. A busy real run makes a few hundred; 2000 keeps the server's check (about 2 ms) far inside the free plan's 10 ms of CPU. */
export const MAX_EVENTS = 2000;
/** Facts in any one second of play, at most: twice the most a real second makes (a six-box frame knocked flat makes
 * about thirty, with ruts and spilled mail on top). */
export const BURST = 80;
/** Seconds: a fact may land in the frame that ends the run, just after the clock's limit. */
export const SLACK = 1;
/** A run begun just before midnight in Mabou may still post to its own day for this long after. */
export const GRACE_MS = 60 * 60e3;
/** Bytes of one posted result, at most. */
export const MAX_BODY = 128 * 1024;
/** The device id: letters made on the device from its own random secret, one id per board (board.ts boardDevice), so
 * two days' boards cannot be linked; never anything about the device itself. */
export const DEVICE = /^[A-Za-z0-9_-]{22,64}$/;
/** /board/v1/<area>/<YYYY-MM-DD>: POST a result, GET the board. */
export const BOARD_PATH = /^\/board\/v(\d+)\/([a-z0-9-]{1,24})\/(\d{4}-\d{2}-\d{2})$/;
export const boardPath = (area: string, date: string): string => `/board/v${BOARD_VERSION}/${area}/${date}`;

/** Paid kinds that cannot happen in Today's run: the Boss (boss.ts) is not in it. A post that carries one is refused. */
export const NOT_DAILY: readonly string[] = Object.freeze(['lostBoss']);
/** The facts that change a Today's run score: the paid kinds and the penalties. Nothing else is sent. */
export const SENT_KINDS: readonly string[] = Object.freeze([...Object.keys(POINTS).filter(k => !NOT_DAILY.includes(k)), ...Object.keys(PENALTIES)]);
/** True for a fact the run sends with its result. A fact that cannot score (a protected place, an animal, a person, an
 * unpaid kind) changes neither the points nor the card, so it stays on the device. */
export const sendsEvent = (e: ScoreEvent): boolean => PENALTIES[e.kind] !== undefined || scores(e);
/** One sent fact: its kind and its play seconds, exactly as the game had them. A drift is paid by its size, so it also
 * carries what score-rules' eventSize reads: metres, mean angle (degrees), mean speed (m/s), a loose surface (1) or a
 * firm one (0), and a clean end (1). Nothing else of it (no place, no position) is sent. */
export type WireEvent = [kind: string, time: number] | [kind: string, time: number, length: number, angle: number, speed: number, loose: number, clean: number];
export const wireEvent = (e: ScoreEvent): WireEvent => e.kind === 'drift' && e.drift
  ? [e.kind, e.time, e.drift.length, e.drift.angle, e.speed, looseSurface(e.drift.surface) ? 1 : 0, e.drift.clean ? 1 : 0] : [e.kind, e.time];
/** A sent fact as the score rules hear it: on the route (a protected place is never sent), with a drift's size facts. */
function asEvent(w: WireEvent): ScoreEvent {
  if (w.length === 2) return { kind: w[0], place: 'route', speed: 0, time: w[1] };
  const [kind, time, length, angle, speed, loose, clean] = w;
  return { kind, place: 'route', speed, time, drift: { angle, peak: angle, length, seconds: 0, speed, surface: loose ? LOOSE[0] : 'paved',
    clean: clean === 1, x0: 0, z0: 0, x1: 0, z1: 0 } };
}
/** A well-formed sent fact: a kind and a time; for a drift, also its five size facts, each a number of at least 0 (flags 0
 * or 1). A drift sent without them is paid at size 1, as the game pays one it has no facts for. */
const wellFormed = (e: unknown): boolean => Array.isArray(e) && typeof e[0] === 'string' && finite(e[1]) && (e.length === 2
  || e.length === 7 && e[0] === 'drift' && e.slice(2, 5).every(v => finite(v) && v >= 0) && (e[5] === 0 || e[5] === 1) && (e[6] === 0 || e[6] === 1));

/** What the game says its run scored. The server scores the facts again and never stores a claim. */
export interface Claim { points: number; step: number; time: number; squares: number }
export interface Post {
  v: number; area: string; date: string; seed: number;
  /** What the area supplied to the card on the device (daily-rules Supply): the server draws the same card from it. */
  supply: Supply;
  events: WireEvent[];
  /** Play seconds when the run ended. */
  played: number;
  claim: Claim;
  handle: string; device: string;
}
/** One row of a board. Nothing else is stored with it: no address, no account, no email. */
export interface Row {
  id: number; handle: string; points: number;
  /** Discipline step reached, 0 to LADDER.length. */
  step: number;
  /** Seconds: when the ladder reached Fired, or the play time of a run that was not fired. */
  time: number;
  /** packFilled of the bingo card. */
  squares: number;
  vehicle: string; device: string;
}
export type PublicRow = Omit<Row, 'device'>;
export interface BoardView { v: number; area: string; date: string; posts: number; rows: PublicRow[] }
export interface Posted { id: number; rank: number | null; posts: number; board: BoardView }

/** Plays the sent facts through the game's own rules, in the game's own order: Get Fired scores each fact, then the
 * bingo card hears it and pays its lines and the full card (daily.ts). Returns what the device should have shown. */
export function replay(squares: readonly Square[], events: readonly WireEvent[]): DailyResult {
  const book = new ScoreBook(), card = new BingoCard(squares);
  let firedAt: number | null = null;
  for (const w of events) {
    const e = asEvent(w), time = e.time;
    book.add(e);
    if (book.fired) firedAt ??= time;
    const heard = card.hear(e);
    if (heard.lines) book.award('bingo:line', heard.lines * LINE_BONUS);
    if (heard.full) book.award('bingo:card', CARD_BONUS);
    if (book.fired) firedAt ??= time;
  }
  return { step: book.step, total: Math.round(book.total), firedAt: firedAt === null ? null : Math.round(firedAt * 10) / 10, filled: packFilled(card.filled) };
}

const TOP = COMBO_CAP * ladderFactor(LADDER.length);
/** Every fact a run could ever be paid for, best first: each kind's first and its fading repeats, at the full combo on
 * the top rung. No run can beat the best n of these with n facts. */
const BIGGEST: Readonly<Record<string, number>> = { drift: DRIFT_MARKS.most * DRIFT_MARKS.clean };
// Only what a Today's run can send counts: the Boss's bonus would loosen the bound for nothing.
const BEST_FACTS: readonly number[] = Object.freeze(Object.entries(POINTS).filter(([kind]) => !NOT_DAILY.includes(kind)).flatMap(([kind, base]) => {
  const out: number[] = [];
  for (let k = 0; k < MAX_EVENTS; k++) { const v = Math.round(base * (BIGGEST[kind] ?? 1) * novelty(k) * TOP); if (v <= 0) break; out.push(v); }
  return out;
}).sort((a, b) => b - a));
/** The most points the score rules allow a run of this many play seconds: at most BURST facts a second, each paid as
 * well as the rules ever pay, and every bingo line and the full card. */
export function ceiling(seconds: number): number {
  const facts = Math.min(MAX_EVENTS, Math.floor((Math.max(0, seconds) + SLACK) * BURST));
  let points = 0;
  for (let i = 0; i < facts && i < BEST_FACTS.length; i++) points += BEST_FACTS[i];
  return points + bingoBonus(LINES.length, true);
}
/** The most points any Today's run can hold. */
export const MAX_RUN = ceiling(DAILY_LIMIT);

export type Refusal = 'shape' | 'area' | 'day' | 'seed' | 'card' | 'events' | 'above' | 'posted' | 'rate' | 'full' | 'off' | 'big';
/** What the game shows for each refusal. Dry, never cross. */
export const REFUSALS: Readonly<Record<Refusal, { status: number; text: string }>> = Object.freeze({
  shape: { status: 400, text: 'The board could not read that result. It stays on your card and your share line.' },
  area: { status: 404, text: 'There is no board for that place.' },
  day: { status: 400, text: 'That run is from another day. The board takes today’s run only.' },
  seed: { status: 400, text: 'That was not today’s run. Reload the page for today’s card.' },
  card: { status: 400, text: 'That was not today’s card. Reload the page for today’s card.' },
  events: { status: 400, text: 'The run’s record does not add up: more offences in one second than a car can manage, or some after the clock stopped.' },
  above: { status: 400, text: 'Those points are more than the rules give for that run. The board keeps what the rules give.' },
  posted: { status: 409, text: 'This device has already posted today’s run. The board takes one a day, like the mail.' },
  rate: { status: 429, text: 'Too many tries from one place at once. Wait a minute and try again.' },
  full: { status: 503, text: 'Today’s board has taken all the runs it can. Try again tomorrow.' },
  off: { status: 503, text: 'The board is closed for now. Try later.' },
  big: { status: 413, text: 'That result is too long for the board.' },
});

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const SUPPLY_KEYS = ['boxes', 'lawns', 'relief', 'painter', 'fish'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The day a post may be for: today in Mabou, or yesterday for a run that ended just after midnight. */
export const postDay = (date: string, now: number): boolean =>
  DATE.test(date) && (date === atlanticDate(new Date(now)) || date === atlanticDate(new Date(now - GRACE_MS)));
/** When a board is deleted: the start of its 61st day after (04:00 UTC is midnight in Mabou in winter). */
export const expiresAt = (date: string): number => Date.parse(`${date}T04:00:00Z`) + (BOARD_DAYS + 1) * 86400e3;
/** A board may be read from its own day until it is deleted; never a day still to come. */
export const readableDay = (date: string, now: number): boolean =>
  DATE.test(date) && !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) && date <= atlanticDate(new Date(now)) && expiresAt(date) > now;

export type Verdict = { ok: true; row: Omit<Row, 'id'>; result: DailyResult; plan: DailyPlan } | { ok: false; error: Refusal };

/** Everything the server decides about one posted result, before the board's own checks (one post per device, the
 * board's day cap). `area` and `date` come from the address; `now` is the server's clock. */
export function judgePost(body: unknown, area: string, date: string, now: number, random: () => number = Math.random): Verdict {
  const no = (error: Refusal): Verdict => ({ ok: false, error });
  if (!isObject(body) || body.v !== BOARD_VERSION || body.area !== area || body.date !== date || !Number.isSafeInteger(body.seed)
    || !isObject(body.supply) || !SUPPLY_KEYS.every(k => typeof (body.supply as Record<string, unknown>)[k] === 'boolean')
    || !Array.isArray(body.events) || !finite(body.played) || !isObject(body.claim) || typeof body.handle !== 'string' || body.handle.length > 32
    || typeof body.device !== 'string' || !DEVICE.test(body.device)) return no('shape');
  const c = body.claim;
  if (!finite(c.points) || !Number.isSafeInteger(c.step) || !finite(c.time) || !Number.isSafeInteger(c.squares)) return no('shape');
  const claim = c as unknown as Claim;
  if (body.events.length > MAX_EVENTS) return no('events');
  if (!body.events.every(wellFormed)) return no('shape');
  if (!dailyArea(area)) return no('area');
  if (!postDay(date, now)) return no('day');
  const plan = dailyPlan(date, area);
  if (body.seed !== plan.seed) return no('seed');
  const supply = body.supply as unknown as Supply;
  const squares = drawCard(plan.seed, supplyFor(plan, { boxes: supply.boxes, lawns: supply.lawns, relief: supply.relief, painter: supply.painter, fish: supply.fish }));
  if (squares.length !== CARD_SIZE) return no('card');
  const events = body.events as WireEvent[], played = body.played;
  if (played < 0 || played > plan.limit) return no('events');
  let last = 0;
  for (let i = 0; i < events.length; i++) {
    const [kind, time] = events[i];
    if (!SENT_KINDS.includes(kind) || time < last || time > played + SLACK) return no('events');
    // No more than BURST facts inside any one second of play.
    if (i >= BURST && time - events[i - BURST][1] < 1) return no('events');
    last = time;
  }
  // Above the rules: more than the sent facts score again, or more than any run of this length can hold. (A replayed run
  // never passes the ceiling, which tools/board-rules-check.mjs asserts; the ceiling stays as the stated bound.)
  const result = replay(squares, events), most = ceiling(played);
  if (claim.points > result.total || claim.step > result.step || (claim.squares & ~result.filled) !== 0
    || result.firedAt !== null && claim.time < result.firedAt - .05 || claim.points > most || result.total > most) return no('above');
  return { ok: true, plan, result, row: {
    handle: readHandle(body.handle) ?? inventedName(random), points: result.total, step: result.step,
    time: result.firedAt ?? Math.round(played * 10) / 10, squares: result.filled, vehicle: plan.vehicle, device: body.device,
  } };
}

/** A row as a Today's run result, for the game's own order (daily-rules betterDaily). */
export const rowResult = (r: Pick<Row, 'step' | 'points' | 'time' | 'squares'>): DailyResult =>
  ({ step: r.step, total: r.points, firedAt: r.step >= LADDER.length ? r.time : null, filled: r.squares });
/** Board order: the game's own (higher rung; the faster Fired; more squares; more points), and the earlier post on a tie. */
export const rowOrder = (a: Row, b: Row): number =>
  betterDaily(rowResult(a), rowResult(b)) ? -1 : betterDaily(rowResult(b), rowResult(a)) ? 1 : a.id - b.id;

/** One board in memory: its kept rows in order, and how many results it has taken today. The next row's id is posts + 1. */
export class BoardBook {
  readonly rows: Row[];
  constructor(rows: readonly Row[], public posts: number) { this.rows = [...rows].sort(rowOrder); }
  get full(): boolean { return this.posts >= POSTS_PER_BOARD; }
  /** Places a new row. `seen`: the id of the row this device id already posted to this board, or null (the store keeps
   * every device id, also after its row fell off the top). Its rank (1 is first), or null when it falls outside the top
   * BOARD_KEEP; and the rows that fell off. The same result sent again by the same device (its answer was lost on the
   * way) is answered with its place, unchanged; anything else from that device is refused, and `gone` says its row has
   * fallen off the top (so the board cannot tell whether this is the same result). */
  add(row: Row, seen: number | null): { error: 'posted' | 'full'; gone?: true } | { id: number; rank: number | null; dropped: Row[]; again?: true } {
    if (seen !== null) {
      const i = this.rows.findIndex(r => r.id === seen), had = this.rows[i];
      if (!had) return { error: 'posted', gone: true };
      return had.device === row.device && had.points === row.points && had.step === row.step && had.time === row.time && had.squares === row.squares
        ? { id: had.id, rank: i + 1, dropped: [], again: true } : { error: 'posted' };
    }
    if (this.full) return { error: 'full' };
    this.posts++;
    this.rows.push(row); this.rows.sort(rowOrder);
    const dropped = this.rows.splice(BOARD_KEEP), i = this.rows.indexOf(row);
    return { id: row.id, rank: i < 0 ? null : i + 1, dropped };
  }
  /** What anyone may read: never a device id. */
  view(area: string, date: string): BoardView {
    return { v: BOARD_VERSION, area, date, posts: this.posts, rows: this.rows.map(({ device: _device, ...row }) => row) };
  }
}

/** The rate limit's key for an address: an IPv4 address as it is; an IPv6 address by its /64, which one home or phone
 * holds whole (otherwise one connection would have endless fresh addresses). Never stored. */
export function addressKey(address: string): string {
  if (!address.includes(':')) return address;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (v4) return v4[1];
  const [head, tail = ''] = address.toLowerCase().split('::'), a = head ? head.split(':') : [], b = tail ? tail.split(':') : [];
  const groups = address.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return `${groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
/** How often one address may knock, kept in memory only: a token bucket per key, forgotten when the Worker sleeps. */
export class Meters {
  private readonly seen = new Map<string, { tokens: number; stamp: number }>();
  constructor(readonly burst: number, readonly everyMs: number, readonly most = 5000) {}
  allow(key: string, now: number): boolean {
    let m = this.seen.get(key);
    if (m) { m.tokens = Math.min(this.burst, m.tokens + Math.max(0, now - m.stamp) / this.everyMs); m.stamp = now; }
    else {
      if (this.seen.size >= this.most) this.forget(now);
      this.seen.set(key, m = { tokens: this.burst, stamp: now });
    }
    if (m.tokens < 1) return false;
    m.tokens -= 1;
    return true;
  }
  get size(): number { return this.seen.size; }
  /** Drops the keys that are full again; if that is not enough, the older half. */
  private forget(now: number): void {
    for (const [key, m] of this.seen) if (m.tokens + (now - m.stamp) / this.everyMs >= this.burst) this.seen.delete(key);
    if (this.seen.size < this.most) return;
    let drop = this.seen.size >> 1;
    for (const key of this.seen.keys()) { if (drop-- <= 0) break; this.seen.delete(key); }
  }
}
/** Posts: four at once, then one each half minute. A player posts once a day; a shared address (a school) a few. */
export const POST_RATE = Object.freeze({ burst: 4, everyMs: 30e3 });
/** Reads: twenty at once, then one each two seconds. */
export const READ_RATE = Object.freeze({ burst: 20, everyMs: 2e3 });

/** Sixteen bytes as URL-safe letters: a device's random secret, or its id for one board (board.ts boardDevice). */
export function newDevice(bytes: Uint8Array): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0), chars = Math.min(4, Math.ceil((bytes.length - i) * 4 / 3));
    for (let j = 0; j < chars; j++) out += abc[n >> 18 - 6 * j & 63];
  }
  return out;
}
/** The rank as the share card and the board say it. */
export const rankText = (rank: number | null, posts: number): string =>
  rank !== null ? `#${rank} of ${posts.toLocaleString('en-CA')} on the board` : `outside the board’s top ${BOARD_KEEP} (${posts.toLocaleString('en-CA')} posted)`;

/** Reads a board as it came over the network: anything malformed is no board. */
export function readBoard(value: unknown): BoardView | null {
  if (!isObject(value) || value.v !== BOARD_VERSION || typeof value.area !== 'string' || typeof value.date !== 'string' || !DATE.test(value.date)
    || !Number.isSafeInteger(value.posts) || !Array.isArray(value.rows) || value.rows.length > BOARD_KEEP) return null;
  const rows: PublicRow[] = [];
  for (const r of value.rows) {
    if (!isObject(r) || !Number.isSafeInteger(r.id) || typeof r.handle !== 'string' || !finite(r.points) || !Number.isSafeInteger(r.step)
      || !finite(r.time) || !Number.isSafeInteger(r.squares) || typeof r.vehicle !== 'string') return null;
    const step = r.step as number;
    if (step < 0 || step > LADDER.length) return null;
    rows.push({ id: r.id as number, handle: r.handle.slice(0, 32), points: r.points, step, time: r.time, squares: r.squares as number, vehicle: r.vehicle.slice(0, 16) });
  }
  return { v: BOARD_VERSION, area: value.area, date: value.date, posts: value.posts as number, rows };
}
