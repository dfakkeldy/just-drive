// Room games on the wire: what the room is playing, beside the race. Shared by the game and the room server.
// No DOM, no three.js. Positions still travel only in the car reports of wire.ts; the room judges every game from them.
//
// The room tells each game-capable player the state as one small binary frame, little-endian:
//   0  u8   TYPE.game (3)
//   1  u8   GAME_WIRE            this layout's version; a game that reads another version ignores the frame
//   2  u8   kind                 0 = free driving, else a GAMES kind
//   3  u8   phase                PHASE.*
//   4  u16  host                 the seat that may start and stop games
//   6  u16  serial               grows with each new game
//   8  u32  left                 ms until this phase ends, counted when the room sent it (no shared clock needed)
//   12 u8   n                    players on the table (at most ROOM_CAP)
//   13 n x [u16 id][u16 score]
//   then the kind's own fixed-size payload (tag-rules.ts: TAG_PAYLOAD bytes)
// A game says what it wants as short JSON (no free text): {t:'game-sync'} once, and the host's
// {t:'game-control', action:'start', game:'tag', field} or {t:'game-control', action:'stop'}.
import { TYPE, ROOM_CAP } from './wire';
import { TAG, TAG_PAYLOAD, readTagPayload, type TagView } from './tag-rules';

export const GAME_WIRE = 1;
export const PHASE = { free: 0, countdown: 1, play: 2, over: 3 } as const;
export type Phase = typeof PHASE[keyof typeof PHASE];
/** The games a host may pick. A new game adds a row, a rules module and its payload; nothing else changes. */
export const GAMES = Object.freeze({ tag: { kind: TAG.kind, name: 'Parcel tag', payload: TAG_PAYLOAD } });
export type GameName = keyof typeof GAMES;
export const gameName = (kind: number): GameName | null =>
  (Object.keys(GAMES) as GameName[]).find(k => GAMES[k].kind === kind) ?? null;
/** The longest a game-control text may be: a field of road lines is the only bulky part. */
export const CONTROL_MAX = 8192;

export interface Score { id: number; score: number }
export interface GameFrame { kind: number; phase: Phase; host: number; serial: number; left: number; table: Score[]; tag: TagView | null }

/** The common head and table; the round writes its payload after them. */
export function encodeGame(f: Omit<GameFrame, 'tag'>, payload: Uint8Array | null): ArrayBuffer {
  const n = Math.min(ROOM_CAP, f.table.length), extra = payload?.byteLength ?? 0;
  const buf = new ArrayBuffer(13 + 4 * n + extra), v = new DataView(buf);
  v.setUint8(0, TYPE.game); v.setUint8(1, GAME_WIRE); v.setUint8(2, f.kind); v.setUint8(3, f.phase);
  v.setUint16(4, f.host, true); v.setUint16(6, f.serial & 65535, true);
  v.setUint32(8, Math.max(0, Math.min(0xffffffff, Math.round(f.left))), true); v.setUint8(12, n);
  for (let i = 0; i < n; i++) { v.setUint16(13 + 4 * i, f.table[i].id, true); v.setUint16(15 + 4 * i, Math.min(65535, f.table[i].score), true); }
  if (payload) new Uint8Array(buf, 13 + 4 * n).set(payload);
  return buf;
}

/** The game's reading of a frame. Anything malformed or of another version is null: the game never trusts the wire. */
export function decodeGame(data: ArrayBuffer): GameFrame | null {
  if (data.byteLength < 13) return null;
  const v = new DataView(data);
  if (v.getUint8(0) !== TYPE.game || v.getUint8(1) !== GAME_WIRE) return null;
  const kind = v.getUint8(2), phase = v.getUint8(3), n = v.getUint8(12);
  if (phase > PHASE.over || n > ROOM_CAP || (kind === 0) !== (phase === PHASE.free)) return null;
  const name = gameName(kind);
  if (kind !== 0 && !name) return null;
  const extra = name ? GAMES[name].payload : 0;
  if (data.byteLength !== 13 + 4 * n + extra) return null;
  const table: Score[] = [];
  for (let i = 0; i < n; i++) table.push({ id: v.getUint16(13 + 4 * i, true), score: v.getUint16(15 + 4 * i, true) });
  const tag = name === 'tag' ? readTagPayload(v, 13 + 4 * n) : null;
  return { kind, phase: phase as Phase, host: v.getUint16(4, true), serial: v.getUint16(6, true), left: v.getUint32(8, true), table, tag };
}

/**
 * Where a round may be played, sent by the host when it starts one: the real roads near the players as lines of whole
 * metres, and the real places where nothing scores (church grounds, cemeteries, the school bus stop) as circles.
 * The room checks it like a race route: bounded, finite, inside the area and near the host.
 */
export interface Quiet { x: number; z: number; r: number }
export interface Field { roads: number[][]; quiet: Quiet[] }
// At these caps the longest field (every number five digits and a sign) still fits one CONTROL_MAX text.
export const FIELD = Object.freeze({ reach: 600, lines: 96, vertices: 400, quiet: 32, quietR: 400 });
export function readField(value: unknown, bounds: number, near: { x: number; z: number }): Field | null {
  const f = value as Field | null;
  if (!f || typeof f !== 'object' || !Array.isArray(f.roads) || !Array.isArray(f.quiet)) return null;
  if (f.roads.length < 1 || f.roads.length > FIELD.lines || f.quiet.length > FIELD.quiet) return null;
  const at = (x: unknown, z: unknown) => Number.isInteger(x) && Number.isInteger(z) && Math.abs(x as number) <= bounds && Math.abs(z as number) <= bounds;
  let vertices = 0;
  for (const line of f.roads) {
    if (!Array.isArray(line) || line.length < 4 || line.length % 2) return null;
    vertices += line.length / 2;
    for (let i = 0; i < line.length; i += 2) {
      if (!at(line[i], line[i + 1]) || Math.hypot(line[i] - near.x, line[i + 1] - near.z) > FIELD.reach + 50) return null;
    }
  }
  if (vertices > FIELD.vertices) return null;
  for (const q of f.quiet) {
    if (!q || !at(q.x, q.z) || !Number.isInteger(q.r) || q.r < 1 || q.r > FIELD.quietR) return null;
  }
  return { roads: f.roads.map(l => l.slice()), quiet: f.quiet.map(({ x, z, r }) => ({ x, z, r })) };
}

export type GameControl = { action: 'start'; game: GameName; field: unknown } | { action: 'stop' };
/** A game-control text, or null. The field is read later, against the room's bounds and the host's place. */
export function readGameControl(m: Record<string, unknown>): GameControl | null {
  if (m.t !== 'game-control') return null;
  if (m.action === 'stop' && Object.keys(m).length === 2) return { action: 'stop' };
  if (m.action === 'start' && typeof m.game === 'string' && Object.prototype.hasOwnProperty.call(GAMES, m.game) && Object.keys(m).length === 4)
    return { action: 'start', game: m.game as GameName, field: m.field };
  return null;
}
