/** Pure daily rules. Stable IDs are props.json mailbox indices, never civic addresses. */
export const CLOCK_FACTOR = 20;
export const START_TIME = 10 * 3600;
export const END_TIME = 18 * 3600;
/** What the carrier is paid for a worked day, and for the use of their own car on it (the owner's figures). */
export const DAILY_PAY = 210;
export const VEHICLE_ALLOWANCE = 135;
export interface Career { day: number; pay: number; warnings: number; double: boolean; suspended: boolean; carryover: number[]; mailCount?: number }
export const freshCareer = (): Career => ({ day: 1, pay: 0, warnings: 0, double: false, suspended: false, carryover: [] });
/** Mabou rural mailbox removed when Little Mabou Hall became a community site (grok-bots#1347: 469+6 -> 468+7). */
export const MABOU_REMOVED_RURAL_1347 = 217;
export function migrateCareer(career: Career, mailCount: number, siteCount: number): Career {
  const old = career.carryover;
  if (mailCount === 468 && siteCount === 7) {
    if (career.mailCount === 468) return career;
    if (career.mailCount !== undefined && career.mailCount !== 469) return career;
    const carryover = old.length === 475
      ? [...old.slice(0, MABOU_REMOVED_RURAL_1347), ...old.slice(MABOU_REMOVED_RURAL_1347 + 1), 0]
      : old.slice();
    return { ...career, carryover, mailCount: 468 };
  }
  if (mailCount === 469 && siteCount === 6 && career.mailCount === 468) {
    const carryover = old.length === 475
      ? [...old.slice(0, MABOU_REMOVED_RURAL_1347), 0, ...old.slice(MABOU_REMOVED_RURAL_1347, 474)]
      : old.slice();
    return { ...career, carryover, mailCount: 469 };
  }
  return career;
}
export function draw(seed: number, id: number, salt = 0): number {
  let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(id + 1, 0xc2b2ae35) ^ Math.imul(salt + 1, 0x27d4eb2d);
  n = Math.imul(n ^ n >>> 16, 0x7feb352d); n = Math.imul(n ^ n >>> 15, 0x846ca68b);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
export function dayType(day: number): 'flyers' | 'light' | 'ordinary' {
  const n = draw(day, 0, 77); return n < .2 ? 'flyers' : n < .35 ? 'light' : 'ordinary';
}
function pieces(day: number, id: number): number {
  const type = dayType(day), chance = type === 'flyers' ? .97 : type === 'light' ? .28 : .6;
  return draw(day, id) < chance ? 1 + Math.floor(draw(day, id, 1) * 3) : 0;
}
export interface DayDraw { pieces: number[]; stuffed: boolean[]; down: boolean[]; flags: boolean[] }
export interface DayRoute { rural: readonly number[]; sites: readonly number[]; allRural: readonly number[]; downCandidates: readonly number[] }
export function makeDay(day: number, total: number, route: DayRoute, double = false, carryover: readonly number[] = []): DayDraw {
  const result: DayDraw = { pieces: Array(total).fill(0), stuffed: Array(total).fill(false),
    down: Array(total).fill(false), flags: Array(total).fill(false) };
  for (const i of [...route.rural, ...route.sites]) {
    const rural = route.rural.includes(i);
    const a = rural ? pieces(day, i) : 3, b = double ? (rural ? pieces(day - 1, i) : 3) : 0;
    result.pieces[i] = (double ? 2 * Math.max(a, b) : a) + (carryover[i] ?? 0);
  }
  const ranked = (ids: readonly number[], seed: number, salt: number, count: number) => [...ids]
    .sort((a, b) => draw(seed, a, salt) - draw(seed, b, salt)).slice(0, count);
  // Single posts keep a pre-existing fall from taking a whole shared frame down.
  const down = ranked(route.downCandidates.filter((i) => route.rural.includes(i)), day, 4, 1 + Math.floor(draw(day, 0, 4) * 2));
  for (const i of down) result.down[i] = true;
  const due = route.rural.filter((i) => result.pieces[i] > 0);
  for (const i of ranked(due.filter((i) => !result.down[i]), day, 3, Math.max(1, Math.round(due.length / 12)))) result.stuffed[i] = true;
  // Five fixed people across the whole route. Only today's customers can call.
  const flags = ranked(route.allRural, 1, 5, 5);
  for (const i of route.rural) result.flags[i] = flags.includes(i);
  return result;
}
/** One call per four missed stops, from distinct seeded customers. */
export function missedCustomers(day: number, remaining: readonly number[]): number[] {
  const missed = remaining.flatMap((n, i) => n > 0 ? [i] : []);
  return missed.sort((a, b) => draw(day, a, 31) - draw(day, b, 31)).slice(0, Math.min(3, Math.floor(missed.length / 4)));
}
export function clock(seconds: number): string {
  const minute = Math.floor(Math.min(END_TIME, START_TIME + seconds) / 60);
  return `${Math.floor(minute / 60).toString().padStart(2, '0')}:${(minute % 60).toString().padStart(2, '0')}`;
}
/** Property damage (a broken yard or field prop) is avoidable: one property is a warning, two in a day a suspension. */
export const PROPERTY_SUSPENSION = 2;
export function verdict(upheld: { kind: string }[]): 'clear' | 'warning' | 'suspension' {
  const avoidable = upheld.filter((c) => c.kind !== 'late' && c.kind !== 'flag');
  if (avoidable.length === 0) return 'clear';
  if (avoidable.some((c) => c.kind === 'lawnDamage') || avoidable.length >= 3 ||
    avoidable.filter((c) => c.kind === 'propertyDamage').length >= PROPERTY_SUSPENSION) return 'suspension';
  return avoidable.length ? 'warning' : 'clear';
}
export function nextCareer(career: Career, outcome: ReturnType<typeof verdict>, repairs = 0, bonus = 0): Career {
  const suspended = outcome === 'suspension';
  const next: Career = { day: career.day + (suspended ? 2 : 1), pay: career.pay + DAILY_PAY + VEHICLE_ALLOWANCE - repairs + bonus,
    warnings: career.warnings + (outcome === 'warning' ? 1 : 0), double: suspended, suspended, carryover: career.carryover.slice() };
  if (career.mailCount !== undefined) next.mailCount = career.mailCount;
  return next;
}
const KEY = 'mmm.shift.v1';
export function readCareer(): Career {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Career | null;
    if (c && Number.isSafeInteger(c.day) && c.day > 0 && Number.isFinite(c.pay) && c.pay >= 0 &&
      Number.isSafeInteger(c.warnings) && c.warnings >= 0 && typeof c.double === 'boolean' && typeof c.suspended === 'boolean' &&
      (c.carryover === undefined || Array.isArray(c.carryover) && c.carryover.every((n) => Number.isSafeInteger(n) && n >= 0)) &&
      (c.mailCount === undefined || Number.isSafeInteger(c.mailCount) && c.mailCount >= 0))
      return { ...c, carryover: c.carryover ?? [] };
  } catch { /* A sandbox may refuse storage. */ }
  return freshCareer();
}
export function saveCareer(career: Career): void { try { localStorage.setItem(KEY, JSON.stringify(career)); } catch { /* Memory still works. */ } }
