import { GAMES, PHASE, encodeGame, readField, readGameControl, type GameName, type Phase } from '../../web/src/mp/game-wire';
import { TAG, TagRound, type Report, type TagState } from '../../web/src/mp/tag-rules';
import { FLAG, readBody } from '../../web/src/mp/wire';
/**
 * What the room is playing, beside the race: free driving, or one room game. A host picks a game, a countdown starts it,
 * the room judges it from the position reports it accepted, ends it, shows the table for a while, and goes back to free
 * driving. Casual party play, not an anti-cheat service. No Cloudflare type here: a node check runs it as it is.
 *
 * A next game (capture the mail bag, postman versus dogs, hide and seek, the Boss) adds a rules module with this
 * Round shape, a row in GAMES (game-wire.ts) and one in RULES below.
 */
export interface Round {
  begin(now: number): void;
  report(id: number, r: Report, now: number): boolean;
  tick(now: number): boolean;
  leave(id: number, now: number): boolean;
  table(): { id: number; score: number }[];
  payload(now: number): Uint8Array;
  snapshot(): unknown;
}
interface Rules {
  countdownMs: number; roundMs: number; overMs: number;
  start(field: NonNullable<ReturnType<typeof readField>>, players: { id: number; x: number; z: number }[], host: number): Round | null;
  restore(state: unknown): Round | null;
}
const RULES: Record<GameName, Rules> = {
  tag: {
    countdownMs: TAG.countdownMs, roundMs: TAG.roundMs, overMs: TAG.overMs,
    start: (field, players, host) => TagRound.start(field, players, host),
    restore: state => { try { return new TagRound(state as TagState); } catch { return null; } },
  },
};
export interface GameState { host: number; serial: number; game: GameName | null; phase: Phase; until: number; round: unknown }
export const emptyGame = (): GameState => ({ host: 0, serial: 0, game: null, phase: PHASE.free, until: 0, round: null });
export interface Player { id: number; last: Uint8Array | null }

export function reportOf(body: Uint8Array): Report {
  const p = readBody(new DataView(body.buffer, body.byteOffset, body.byteLength), 0);
  return { x: p.x, z: p.z, vx: p.vx, vz: p.vz, parked: !!(p.flags & FLAG.parked), teleport: !!(p.flags & FLAG.teleport) };
}

export class RoomGame {
  state: GameState;
  private round: Round | null = null;
  /** A round may be shortened for local checks only (wrangler dev --var GAME_ROUND_S). */
  constructor(state: GameState | null | undefined = undefined, private roundMs?: number) {
    this.state = state && typeof state === 'object' ? state : emptyGame();
    const rules = this.state.game ? RULES[this.state.game] : null;
    if (this.state.phase !== PHASE.free && rules) this.round = rules.restore(this.state.round);
    if (this.state.phase !== PHASE.free && !this.round) this.free();
  }
  get rules(): Rules | null { return this.state.game ? RULES[this.state.game] : null; }
  /** A race and a game do not share the roads at once. */
  busy(): boolean { return this.state.phase === PHASE.countdown || this.state.phase === PHASE.play; }
  join(id: number): void { if (!this.state.host) { this.state.host = id; } }
  private free(): void { const s = this.state; s.game = null; s.phase = PHASE.free; s.until = 0; s.round = null; this.round = null; }

  /** The host's start or stop. True when it changed the game. `players`: the game-capable seats. */
  command(id: number, m: Record<string, unknown>, players: Player[], bounds: number, now: number, raceBusy = false): boolean {
    const s = this.state, c = readGameControl(m);
    if (!c || id !== s.host) return false;
    this.tick(now);
    if (c.action === 'stop') { if (s.phase === PHASE.free) return false; s.serial++; this.free(); return true; }
    if (this.busy() || raceBusy) return false;
    const placed = players.filter(p => p.last).map(p => ({ id: p.id, ...reportOf(p.last!) }));
    const host = placed.find(p => p.id === id);
    if (!host) return false;
    const field = readField(c.field, bounds, host);
    if (!field) return false;
    const round = RULES[c.game].start(field, placed, id);
    if (!round) return false;
    s.serial++; s.game = c.game; s.phase = PHASE.countdown; s.until = now + RULES[c.game].countdownMs;
    this.round = round; s.round = round.snapshot();
    return true;
  }
  /** Phase changes that are due: the countdown ends, the round ends, the table is put away. */
  tick(now: number): boolean {
    const s = this.state, rules = this.rules;
    if (s.phase === PHASE.free || !rules || !this.round) return false;
    let changed = false;
    if (s.phase === PHASE.countdown && now >= s.until) {
      const start = s.until; s.phase = PHASE.play; s.until = start + (this.roundMs ?? rules.roundMs);
      this.round.begin(start); changed = true;
    }
    if (s.phase === PHASE.play) {
      if (this.round.tick(Math.min(now, s.until))) changed = true;
      if (now >= s.until) { s.phase = PHASE.over; s.until += rules.overMs; changed = true; }
    }
    if (s.phase === PHASE.over && now >= s.until) { this.free(); changed = true; }
    if (changed && this.round) s.round = this.round.snapshot();
    return changed;
  }
  /** One accepted position report. Only a round in play reads it. */
  position(id: number, body: Uint8Array, now: number): boolean {
    let changed = this.tick(now);
    if (this.state.phase !== PHASE.play || !this.round) return changed;
    if (this.round.report(id, reportOf(body), now)) changed = true;
    if (changed) this.state.round = this.round.snapshot();
    return changed;
  }
  leave(id: number, remaining: number[], now: number): boolean {
    let changed = this.tick(now);
    if (this.state.host === id) { this.state.host = remaining[0] ?? 0; changed = true; }
    if (this.round && this.state.phase === PHASE.play && this.round.leave(id, now)) { changed = true; this.state.round = this.round.snapshot(); }
    return changed;
  }
  /** When the room must look again even if nobody speaks: the end of the phase. */
  deadline(): number { return this.state.phase === PHASE.free ? 0 : this.state.until; }
  frame(now: number): ArrayBuffer {
    const s = this.state, playing = s.phase !== PHASE.free && !!this.round && !!s.game;
    return encodeGame({ kind: playing ? GAMES[s.game!].kind : 0, phase: playing ? s.phase : PHASE.free, host: s.host, serial: s.serial,
      left: playing ? s.until - now : 0, table: playing ? this.round!.table() : [] }, playing ? this.round!.payload(now) : null);
  }
}
