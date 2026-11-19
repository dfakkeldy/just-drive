/**
 * Pure rules for Today's run: one Get Fired run a day, the same for every player. The Atlantic date and the area make
 * one seed; the seed fixes the start, the vehicle, the weather mood, the shift day (and so the painter or the fish
 * truck) and the complaint bingo card. No DOM, no three.js and no server: the streak and the first try of the day live
 * in this browser's storage only.
 */
import { draw } from './shift-rules';
import { LADDER, PENALTIES, POINTS, NEVER, scores, stepName } from './score-rules';
import type { ScoreEvent } from './score-events';

/** Real seconds of play: about five minutes. Paused time does not count. */
export const DAILY_LIMIT = 300;
/** Bonus for each completed line of the card (row, column or diagonal), and for the whole card. Flat: no combo, no ladder. */
export const LINE_BONUS = 600;
export const CARD_BONUS = 3000;
/** Where the share text and picture send people. Never the page's own address (a dev server or a preview). */
export const DAILY_ADDRESS = 'https://mmm.fakkeldy.ca/?daily=1';
export const GAME_NAME = 'Mabou Mail Madness';

/** 'YYYY-MM-DD' on the Atlantic wall clock (Halifax), so the day turns over at midnight in Mabou for every player.
 * Without time-zone data it falls back to AST (UTC-4): the date is then off for one hour on summer evenings. */
export function atlanticDate(now: Date, format?: (when: Date) => string): string {
  try {
    const text = (format ?? ((when: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Halifax', year: 'numeric', month: '2-digit', day: '2-digit' }).format(when)))(now);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  } catch { /* no time-zone data */ }
  return new Date(+now - 4 * 3600e3).toISOString().slice(0, 10);
}
/** The calendar day before a 'YYYY-MM-DD' date. */
export function dayBefore(date: string): string { return new Date(Date.parse(`${date}T12:00:00Z`) - 86400e3).toISOString().slice(0, 10); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-11-17' → '17 Nov'. */
export const shortDate = (date: string): string => `${+date.slice(8, 10)} ${MONTHS[+date.slice(5, 7) - 1]}`;

/** FNV-1a over the date and the area: the same day and area always give the same seed. */
export function dailySeed(date: string, area: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${date}|${area}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return h >>> 0;
}

export type DailyScene = 'painter' | 'fish' | 'none';
export type DailyMood = 'clear' | 'overcast' | 'fog';
export interface DailyPlan {
  date: string; area: string; seed: number;
  /** The shift day (shift-rules makeDay, painterDay, fishDay): day % 3 is 1 on a painter day, 2 on a fish day, 0 on neither. */
  day: number; scene: DailyScene;
  /** A start-key value (start-key.ts): road slug and share. */
  start: string;
  vehicle: string; mood: DailyMood;
  limit: number;
}
/** Start places with a dozen or more mailboxes within 500 m (measured on the Mabou land, 18 Nov 2026), away from the church
 * ground. On a painter or fish day the run starts on Mabou Mines Road, a kilometre short of the scene, facing it. */
export const DAILY_STARTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  mabou: Object.freeze(['southwest-ridge-road:0.1', 'murray-hill-road:0.3', 'mountain-road:0.15', 'little-mabou-road:0.7',
    'new-ferry-road:0.3', 'highway-252:0.1', 'northeast-mabou-road:0.4', 'mabou-harbour-road:0.3', 'rankinville-road:0.1']),
});
export const SCENE_START = 'mabou-mines-road';
/** Mail-play vehicles only; the horse is the 1884 ride. Weighted: the mail car most days. */
export const DAILY_VEHICLES: readonly (readonly [string, number])[] = Object.freeze([['car', .6], ['truck', .25], ['sxs', .15]]);
export const DAILY_MOODS: readonly (readonly [DailyMood, number])[] = Object.freeze([['clear', .5], ['overcast', .3], ['fog', .2]]);
const weighted = <T>(r: number, table: readonly (readonly [T, number])[]): T => {
  let acc = 0;
  for (const [value, weight] of table) { acc += weight; if (r < acc) return value; }
  return table[table.length - 1][0];
};
/** Areas that can hold Today's run: a Get Fired route and its start list. */
export const dailyArea = (area: string): boolean => area in DAILY_STARTS;

export function dailyPlan(date: string, area: string): DailyPlan {
  const seed = dailySeed(date, area), r = (salt: number) => draw(seed, 0, salt);
  const roll = r(1), scene: DailyScene = area === 'mabou' ? roll < .2 ? 'painter' : roll < .4 ? 'fish' : 'none' : 'none';
  // A day number in the shift's own range, with the residue that gives today's scene (painter-rules, road-scene-rules).
  const day = 3 * (2 + Math.floor(r(2) * 200)) + (scene === 'painter' ? 1 : scene === 'fish' ? 2 : 0);
  const starts = DAILY_STARTS[area] ?? [];
  const start = scene !== 'none' ? `${SCENE_START}:${(.55 + Math.floor(r(3) * 8) / 100).toFixed(2)}` : starts[Math.floor(r(3) * starts.length)] ?? '';
  return { date, area, seed, day, scene, start, vehicle: weighted(r(4), DAILY_VEHICLES), mood: weighted(r(5), DAILY_MOODS), limit: DAILY_LIMIT };
}

/** What the area can supply on a day: the mailboxes, lawns and the roadside break when the land has them; a scene square
 * only on its own day and only when the scene is really built there (the game passes what it built). */
export interface Supply { boxes: boolean; lawns: boolean; relief: boolean; painter: boolean; fish: boolean }
export const supplyFor = (plan: DailyPlan, has: Supply): Supply =>
  ({ boxes: has.boxes, lawns: has.lawns, relief: has.relief, painter: has.painter && plan.scene === 'painter', fish: has.fish && plan.scene === 'fish' });

export interface SquareSpec { kind: string; needs: keyof Supply; counts: readonly number[]; label: (n: number) => string }
/** The bingo pool: score-stream kinds that the rules pay for (score-rules POINTS), each with the counts a square may ask. */
export const POOL: readonly SquareSpec[] = Object.freeze([
  { kind: 'box:rock', needs: 'boxes', counts: [3, 4, 5], label: n => `Rock ${n} mailboxes` },
  { kind: 'box:lean', needs: 'boxes', counts: [2, 3], label: n => `Lean ${n} mailboxes` },
  { kind: 'box:dent', needs: 'boxes', counts: [1, 2], label: n => n === 1 ? 'Dent a mailbox' : `Dent ${n} mailboxes` },
  { kind: 'box:down', needs: 'boxes', counts: [1, 2, 3], label: n => n === 1 ? 'Flatten a box' : `Flatten ${n} boxes` },
  { kind: 'lawnMail', needs: 'lawns', counts: [1, 2], label: n => n === 1 ? 'Mail on a lawn' : `Mail on ${n} lawns` },
  { kind: 'ditchMail', needs: 'boxes', counts: [1, 2], label: n => n === 1 ? 'Mail in a ditch' : `Mail in ${n} ditches` },
  { kind: 'lawnDamage', needs: 'lawns', counts: [1, 2], label: n => n === 1 ? 'Ruts on a lawn' : `Ruts on ${n} lawns` },
  // A rut fact is about three metres of fresh tyre strips (shift.ts).
  { kind: 'rut', needs: 'lawns', counts: [8, 12, 16], label: n => `${n * 3} m of lawn ruts` },
  { kind: 'relief', needs: 'relief', counts: [1], label: () => 'Seen at the roadside' },
  { kind: 'sceneDust', needs: 'painter', counts: [1], label: () => 'Dust the painter' },
  { kind: 'sceneHorn', needs: 'fish', counts: [1], label: () => 'Horn at the visitor' },
  { kind: 'sceneHit', needs: 'fish', counts: [1], label: () => 'Bump the visitor’s car' },
]);
export interface Square { kind: string; need: number; label: string }
export const CARD_SIZE = 9;
/** Nine squares in reading order. Only kinds the area can supply today; a scene square is always on the card on its day. */
export function drawCard(seed: number, supply: Supply): Square[] {
  const open = POOL.filter(s => supply[s.needs]);
  const ranked = open.map((s, i) => ({ s, i, r: draw(seed, i, 41) - (s.needs === 'painter' || s.needs === 'fish' ? 1 : 0) }))
    .sort((a, b) => a.r - b.r).slice(0, CARD_SIZE);
  // Shuffle the chosen squares into the grid on their own draw, so a scene square is not always in the corner.
  return ranked.sort((a, b) => draw(seed, a.i, 43) - draw(seed, b.i, 43))
    .map(({ s, i }) => { const need = s.counts[Math.floor(draw(seed, i, 47) * s.counts.length)]; return { kind: s.kind, need, label: s.label(need) }; });
}
/** The eight lines of a 3 by 3 card, as reading-order indices. */
export const LINES: readonly (readonly number[])[] = Object.freeze([[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]]);
export const linesDone = (filled: readonly boolean[]): number => LINES.filter(line => line.every(i => filled[i])).length;
export const bingoBonus = (lines: number, full: boolean): number => lines * LINE_BONUS + (full ? CARD_BONUS : 0);

/** The card's live state. Only events that score (score-rules `scores`) count: never at a cemetery, a church ground or the
 * school bus stop, never an animal or a person. */
export class BingoCard {
  readonly counts: number[];
  constructor(readonly squares: readonly Square[]) { this.counts = squares.map(() => 0); }
  get filled(): boolean[] { return this.squares.map((s, i) => this.counts[i] >= s.need); }
  get done(): number { return this.filled.filter(Boolean).length; }
  get lines(): number { return linesDone(this.filled); }
  get full(): boolean { return this.done === this.squares.length; }
  /** Count one fact. Returns the squares it filled and the bonus it earned (new lines, and the full card). */
  hear(e: ScoreEvent): { filled: number[]; bonus: number; lines: number; full: boolean } {
    const none = { filled: [], bonus: 0, lines: 0, full: false };
    if (!scores(e)) return none;
    const beforeLines = this.lines, filled: number[] = [];
    this.squares.forEach((s, i) => {
      if (s.kind !== e.kind || this.counts[i] >= s.need) return;
      if (++this.counts[i] === s.need) filled.push(i);
    });
    if (!filled.length) return none;
    // A square fills only on a card that was not yet full, so the full-card bonus is paid once.
    const lines = this.lines - beforeLines, full = this.full;
    return { filled, bonus: bingoBonus(lines, full), lines, full };
  }
}
/** Nine flags as a number (bit i is square i), for storage. */
export const packFilled = (filled: readonly boolean[]): number => filled.reduce((bits, f, i) => f ? bits | 1 << i : bits, 0);
export const unpackFilled = (bits: number): boolean[] => Array.from({ length: CARD_SIZE }, (_, i) => (bits >> i & 1) === 1);

export interface DailyResult {
  step: number; total: number;
  /** Play seconds when the ladder reached Fired, or null. */
  firedAt: number | null;
  /** packFilled of the card. */
  filled: number;
}
const count = (bits: number): number => unpackFilled(bits).filter(Boolean).length;
/** m:ss of play. */
export const clockText = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** Higher rung first; between two Fired runs the faster; then more squares, then more points. */
export function betterDaily(a: DailyResult, b: DailyResult | null): boolean {
  if (!b) return true;
  if (a.step !== b.step) return a.step > b.step;
  if (a.firedAt !== null && b.firedAt !== null && a.firedAt !== b.firedAt) return a.firedAt < b.firedAt;
  if (count(a.filled) !== count(b.filled)) return count(a.filled) > count(b.filled);
  return a.total > b.total;
}
/** The headline: 'Fired in 3:42', or the rung and points. */
export function headline(r: DailyResult): string {
  return r.step >= LADDER.length && r.firedAt !== null ? `Fired in ${clockText(r.firedAt)}` : `${stepName(r.step)}, ${Math.round(r.total).toLocaleString('en-CA')} points`;
}
export const FILLED_SQUARE = '🟧', EMPTY_SQUARE = '⬜';
/** The share line: plain text, the same result as the picture. A handle goes in only when the player gave one. */
export function resultText(r: DailyResult, date: string, areaName: string, handle = ''): string {
  const filled = unpackFilled(r.filled), name = handle.trim().slice(0, 32);
  const rows = [0, 3, 6].map(i => filled.slice(i, i + 3).map(f => f ? FILLED_SQUARE : EMPTY_SQUARE).join(''));
  return [`${GAME_NAME}, ${shortDate(date)}, ${areaName}: ${headline(r)}, bingo ${count(r.filled)} of ${CARD_SIZE}${name ? ` (${name})` : ''}`, ...rows, DAILY_ADDRESS].join('\n');
}

/** Its own key: never the shift career, never the Get Fired best. */
export const DAILY_KEY = 'mmm.daily.v1';
export interface DailyRecord {
  /** The date of the first finished try below. */
  date: string;
  first: DailyResult;
  /** Finished tries on that date, the first included. */
  tries: number;
  /** Days in a row, ending on `date`, with a finished run. */
  streak: number;
  best: DailyResult & { date: string };
}
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const validResult = (r: DailyResult | undefined): r is DailyResult => !!r && Number.isSafeInteger(r.step) && r.step >= 0 && r.step <= LADDER.length &&
  Number.isFinite(r.total) && (r.firedAt === null || Number.isFinite(r.firedAt) && r.firedAt >= 0) && Number.isSafeInteger(r.filled) && r.filled >= 0 && r.filled < 1 << CARD_SIZE;
const validDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
export function readDaily(area: string, storage: () => Store = () => localStorage): DailyRecord | null {
  try {
    const all = JSON.parse(storage().getItem(DAILY_KEY) ?? '{}') as Record<string, DailyRecord>, r = all?.[area];
    if (r && validDate(r.date) && validResult(r.first) && Number.isSafeInteger(r.tries) && r.tries >= 1 && Number.isSafeInteger(r.streak) && r.streak >= 1 &&
      validResult(r.best) && validDate(r.best.date)) return r;
  } catch { /* A sandbox may refuse storage, or the value is not ours. */ }
  return null;
}
/** The record after one more finished try. A later try on the same date is practice: the first try stands. */
export function nextRecord(prev: DailyRecord | null, date: string, result: DailyResult): { record: DailyRecord; practice: boolean } {
  if (prev && prev.date === date) return { record: { ...prev, tries: prev.tries + 1 }, practice: true };
  const streak = prev && prev.date === dayBefore(date) ? prev.streak + 1 : 1;
  const best = prev && !betterDaily(result, prev.best) ? prev.best : { ...result, date };
  return { record: { date, first: result, tries: 1, streak, best }, practice: false };
}
/** Saves the record. `held` is what this page already knows, for a browser that saves nothing. */
export function saveDaily(area: string, date: string, result: DailyResult, storage: () => Store = () => localStorage, held: DailyRecord | null = null): { record: DailyRecord; practice: boolean } {
  const stored = readDaily(area, storage), prev = held && (!stored || held.date > stored.date || held.date === stored.date && held.tries > stored.tries) ? held : stored;
  const next = nextRecord(prev, date, result);
  try {
    const all = (() => { try { const v = JSON.parse(storage().getItem(DAILY_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } })();
    storage().setItem(DAILY_KEY, JSON.stringify({ ...all, [area]: next.record }));
  } catch { /* Memory still shows it. */ }
  return next;
}

/** Every square kind is paid by the score rules and is never a penalty or an animal scare: a card never asks for what the
 * house pattern forbids. The checks call this; the game does not need to. */
export const poolIsSafe = (): boolean => POOL.every(s => (POINTS[s.kind] ?? 0) > 0 && !(s.kind in PENALTIES) && !NEVER.includes(s.kind) && s.kind !== 'sceneAnimal');
