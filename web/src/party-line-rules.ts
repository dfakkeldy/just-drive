/**
 * Pure rules for the Party Line's call-ins in Get Fired: which recorded call plays, when, and with which nickname.
 * No DOM and no audio (party-line.ts plays them on the car radio). A call is about the player's own run: the score
 * stream says what happened, these rules pick a call about it, and the radio plays it into the next pause of 94.9.
 * The player's name is never in a recording; the screen shows it as text (radioLine, endLine).
 */
import type { ScoreEvent } from './score-events';
import { scores } from './score-rules';
import { readHandle } from './mp/social';

/** What a call is about, by score-stream kind. A kind with no row never brings a call: rocking or leaning a box is too
 * small, and a hit (sceneHit), an animal, the roadside break and the school bus are never a joke on the radio. */
export const ABOUT: Readonly<Record<string, string>> = Object.freeze({
  boxDown: 'box', 'box:dent': 'box', 'box:down': 'box',
  lawnDamage: 'lawn', rut: 'lawn',
  lawnMail: 'mail', ditchMail: 'mail',
  sceneHorn: 'horn', sceneDust: 'dust',
  missing: 'missing', late: 'late', flag: 'flag',
});
/** The calls for each step of the discipline ladder are about 'step1' (coaching chat) to 'step7' (Fired). */
export const STEPS = 7;
export const ABOUTS: readonly string[] = Object.freeze([...new Set(Object.values(ABOUT)), ...Array.from({ length: STEPS }, (_, i) => `step${i + 1}`)]);
/** The kind of nickname a caller gives for what the player does most. */
export const NICK: Readonly<Record<string, string>> = Object.freeze({
  box: 'box', lawn: 'lawn', mail: 'mail', horn: 'painter', dust: 'painter', missing: 'general', late: 'general', flag: 'general',
});
export const NICK_KINDS: readonly string[] = Object.freeze(['box', 'lawn', 'mail', 'painter', 'general']);

/** An offence call starts this many seconds after the offence or never: a saved clip of the run holds both. */
export const WITHIN = 6;
/** A ladder step waits longer for its pause, and an offence never takes its place. */
export const STEP_WITHIN = 12;
/** Seconds from the end of one call to the start of an offence call: the station is still a station. */
export const APART = 20;
/** A ladder step may follow a call sooner. */
export const STEP_APART = 4;
/** A pause of the station counts while this many seconds of it are left (the call starts inside it, not after it). */
export const LEAD = 0.12;
/** The longest call or nickname that is read from the list, in seconds. */
export const LONGEST = 15;

export interface Call { readonly file: string; readonly seconds: number; readonly about: string; readonly caller: string; readonly name: boolean }
export interface Nickname { readonly file: string; readonly seconds: number; readonly kind: string; readonly caller: string; readonly name: string }
export type Gaps = readonly (readonly [number, number])[];
export interface Calls {
  /** The dial the calls play on (94.9). */
  readonly dial: string;
  readonly calls: readonly Call[];
  readonly nicknames: readonly Nickname[];
  /** The pauses of each piece on that dial, by file: [start, end] seconds, in order. */
  readonly gaps: Readonly<Record<string, Gaps>>;
}

const FILE = /^[\w.-]+\.mp3$/, CALLER = /^[a-z]+$/;
const length = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= LONGEST;
/** Reads audio/calls.json. Anything unusable is left out; with no usable call the answer is null (no call-ins). */
export function readCalls(json: unknown): Calls | null {
  const j = json as Partial<Record<keyof Calls, unknown>> | null;
  if (!j || typeof j.dial !== 'string' || !Array.isArray(j.calls)) return null;
  const nicknames: Nickname[] = [];
  for (const n of Array.isArray(j.nicknames) ? j.nicknames as Partial<Nickname>[] : []) {
    if (n && typeof n.file === 'string' && FILE.test(n.file) && length(n.seconds) && typeof n.kind === 'string' && NICK_KINDS.includes(n.kind)
      && typeof n.caller === 'string' && CALLER.test(n.caller) && typeof n.name === 'string' && n.name.trim() && n.name.length <= 40)
      nicknames.push({ file: n.file, seconds: n.seconds, kind: n.kind, caller: n.caller, name: n.name.trim() });
  }
  const calls: Call[] = [];
  for (const c of j.calls as Partial<Call>[]) {
    if (c && typeof c.file === 'string' && FILE.test(c.file) && length(c.seconds) && typeof c.about === 'string' && ABOUTS.includes(c.about)
      && typeof c.caller === 'string' && CALLER.test(c.caller) && typeof c.name === 'boolean'
      // A call that ends on a name needs a caller who has nicknames.
      && (!c.name || nicknames.some(n => n.caller === c.caller)))
      calls.push({ file: c.file, seconds: c.seconds, about: c.about, caller: c.caller, name: c.name });
  }
  if (!calls.length) return null;
  const gaps: Record<string, Gaps> = {};
  if (j.gaps && typeof j.gaps === 'object' && !Array.isArray(j.gaps)) {
    for (const [file, list] of Object.entries(j.gaps as Record<string, unknown>)) {
      if (!FILE.test(file) || !Array.isArray(list)) continue;
      const kept = list.filter((g): g is [number, number] => Array.isArray(g) && g.length === 2 && g.every(Number.isFinite) && 0 <= g[0] && g[0] < g[1])
        .map(([a, b]) => [a, b] as const).sort((a, b) => a[0] - b[0]);
      if (kept.length) gaps[file] = kept;
    }
  }
  return { dial: j.dial, calls, nicknames, gaps };
}

/** True when the piece at `at` seconds is in one of its pauses, with time left to start a call there. */
export function inGap(at: number, gaps: Gaps | undefined): boolean {
  if (!gaps || !Number.isFinite(at)) return false;
  for (const [a, b] of gaps) {
    if (a > at) return false;
    if (at <= b - LEAD) return true;
  }
  return false;
}

/** A call chosen to play: the call, the nickname that follows it (or null), and when the thing it is about happened. */
export interface Pick { readonly call: Call; readonly nickname: Nickname | null; readonly about: string; readonly step: number; readonly at: number }

/** One run of call-ins. Times are seconds on one clock of the caller's choosing. */
export class CallBoard {
  /** The call waiting for a pause, if any. */
  pending: Pick | null = null;
  /** The call that is playing now. */
  onAir: Pick | null = null;
  /** Every call that started this run, in order. */
  readonly played: Pick[] = [];
  private lastEnd = -Infinity;
  private readonly used = new Set<string>();
  private readonly namesUsed = new Set<string>();
  private readonly counts = new Map<string, number>();
  private lastKind = '';
  constructor(readonly list: Calls, private readonly random: () => number = Math.random) {}

  /** A new run: every call may play again. */
  reset(): void {
    this.pending = this.onAir = null; this.played.length = 0; this.lastEnd = -Infinity;
    this.used.clear(); this.namesUsed.clear(); this.counts.clear(); this.lastKind = '';
  }

  /** The nickname kind the player has earned most this run (a tie goes to the latest), or 'general'. */
  topKind(): string {
    let best = 'general', most = 0;
    for (const kind of NICK_KINDS) {
      const n = this.counts.get(kind) ?? 0;
      if (n > most || (n === most && n > 0 && kind === this.lastKind)) { best = kind; most = n; }
    }
    return best;
  }

  /** The nickname this caller gives now: one for the player's top kind, else a general one; a fresh one first, and
   * when every one has been said this run, the first again ("...it was the Lawnmower. Again!"). */
  nicknameFor(caller: string, kind = this.topKind()): Nickname | null {
    for (const want of kind === 'general' ? ['general'] : [kind, 'general']) {
      const all = this.list.nicknames.filter(n => n.caller === caller && n.kind === want);
      if (all.length) return all.find(n => !this.namesUsed.has(n.file)) ?? all[0];
    }
    return null;
  }

  private choose(about: string, step: number, now: number): Pick | null {
    const open = this.list.calls.filter(c => c.about === about && !this.used.has(c.file) && (!c.name || this.nicknameFor(c.caller)));
    if (!open.length) return null;
    const call = open[Math.min(open.length - 1, Math.floor(Math.max(0, this.random()) * open.length))];
    return { call, nickname: call.name ? this.nicknameFor(call.caller) : null, about, step, at: now };
  }

  private fresh(p: Pick | null, now: number): p is Pick {
    return !!p && now - p.at <= (p.step ? STEP_WITHIN : WITHIN);
  }

  /**
   * One event of the score stream, and the ladder step it reached (0: none). Returns a new pick when there is one to
   * fetch, else null. Only an event that scores counts: nothing at a cemetery, a church or the bus stop, no animal,
   * no person, no penalty. A step outranks an offence; a newer offence takes the place of an older one.
   */
  hear(e: ScoreEvent, stepUp: number, now: number): Pick | null {
    const about = ABOUT[e.kind];
    const counted = about !== undefined && scores(e);
    if (counted) { const kind = NICK[about]; this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1); this.lastKind = kind; }
    if (stepUp > 0) {
      const p = this.choose(`step${stepUp}`, stepUp, now);
      if (p) return this.pending = p;
    }
    if (!counted) return null;
    const waiting = this.fresh(this.pending, now) ? this.pending : null;
    if (waiting?.step) return null;
    // The same thing again while its call waits: the same call, a little later (no new fetch).
    if (waiting && waiting.about === about) { this.pending = { ...waiting, at: now }; return null; }
    const p = this.choose(about, 0, now);
    if (p) this.pending = p;
    return p;
  }

  /** The call waiting or playing now, if any (the end card keeps the radio up for it). */
  waiting(now: number): Pick | null { return this.onAir ?? (this.fresh(this.pending, now) ? this.pending : null); }

  /**
   * The call to start now, or null. `tuned`: the radio sounds on the calls' dial. `gap`: its piece is in a pause, or has
   * just ended. `loaded`: the files of a pick are ready to play. A call that waited too long is dropped. A call that
   * starts is never chosen again this run.
   */
  ready(now: number, tuned: boolean, gap: boolean, loaded: (p: Pick) => boolean): Pick | null {
    const p = this.pending;
    if (!p) return null;
    if (!this.fresh(p, now)) { this.pending = null; return null; }
    if (this.onAir || !tuned || !gap || now - this.lastEnd < (p.step ? STEP_APART : APART) || !loaded(p)) return null;
    this.pending = null; this.onAir = p; this.played.push(p);
    this.used.add(p.call.file);
    if (p.nickname) this.namesUsed.add(p.nickname.file);
    return p;
  }

  /** The call on air is over: played to the end, or cut off by the dial or a hold. */
  done(now: number): void {
    if (!this.onAir) return;
    this.onAir = null; this.lastEnd = now;
  }

  /** The last nickname a caller gave this run. */
  lastName(): string | null {
    for (let i = this.played.length - 1; i >= 0; i--) if (this.played[i].nickname) return this.played[i].nickname!.name;
    return null;
  }
}

/** The name the screen shows for the player: the multiplayer handle when it passes the word filter, else the invented call sign. Never spoken. */
export function callSign(stored: unknown, invented: string): string {
  return readHandle(stored) ?? invented;
}
/** The radio line while a call plays. */
export const radioLine = (handle: string): string => `Caller about: ${handle}`;
/** The end card's line, or null when no call came this run. */
export function endLine(calls: number, station: string, handle: string, nickname: string | null): string | null {
  if (calls <= 0) return null;
  return `${station} took ${calls === 1 ? 'a call' : `${calls} calls`} about ${handle}.${nickname ? ` Callers know you as “${nickname}”.` : ''}`;
}
