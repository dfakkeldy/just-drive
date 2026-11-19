// Parcel tag, the first room game. Pure rules: the room server runs them on the position reports it accepted,
// and node checks run them as they are (tools/tag-rules-check.mjs). No DOM, no three.js, no clock of its own.
//
// One parcel. It waits at a fair point on a real road between the players; the first car over it holds it. The holder
// scores a point for each second held while playing (driving, on the roads, inside the play area, and never at a church
// ground, a cemetery or the school bus stop). Another car steals it by closing to within about 3 m. A new holder cannot
// be robbed for 3 seconds. A holder parked, off the roads, out of the area or silent for 10 seconds drops it there,
// and may not pick it straight back up for 3 seconds.
import type { Field, Quiet } from './game-wire';

export const TAG = Object.freeze({
  kind: 1,
  countdownMs: 5000, roundMs: 180000, overMs: 30000,
  /** A car over a loose parcel picks it up; a car this close to the holder, and closing, steals it. */
  pickupM: 4, stealM: 3, closingMps: 1.5,
  immuneMs: 3000,
  /** A holder this long parked, off the roads, out of the area, in a quiet place or unheard drops the parcel. */
  idleMs: 10000, silentMs: 2000, parkedMps: 0.5, offRoadM: 30,
  /** A report further from the last than this (plus what 60 m/s covers) is a jump, flagged or not. */
  jumpM: 15, jumpMps: 60,
  /** Players this close to the host when it starts take part from the start; others join by driving into the area. */
  startReachM: 500,
  /** The host's page sends the roads this far round it (game-field.ts): the whole play area must lie inside. */
  fieldReachM: 580,
  /** Where a dropped or starting parcel may lie: road points this far apart. */
  spotM: 20,
});
export const TAG_PAYLOAD = 22;
/** The play area grows with the players at the start: about 220 m across two, about 400 m across a full room. */
export const playRadius = (n: number): number => Math.round(Math.min(420, 150 + 50 * Math.sqrt(Math.max(2, n))));

export interface Pt { x: number; z: number }
export interface Report extends Pt { vx: number; vz: number; parked: boolean; teleport: boolean }
interface Seen extends Report { at: number }
export interface TagPlayer { id: number; ms: number }
/** Everything a round is, as plain data: the room keeps it through a sleep. */
export interface TagState {
  field: Field; centre: Pt; radius: number; parcel: Pt;
  holder: number; immuneUntil: number; idleSince: number; credited: number;
  /** The last car to drop the parcel, and when: it may not pick it straight back up. */
  dropper?: number; droppedAt?: number;
  players: TagPlayer[]; seen: [number, Seen][];
}
/** What a player's game is told, beside the score table. */
export interface TagView { holder: number; immune: number; parcel: Pt; centre: Pt; radius: number }

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Distance from p to the segment a-b. */
export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
export function roadDistance(field: Field, p: Pt): number {
  let best = Infinity;
  for (const l of field.roads) for (let i = 2; i < l.length; i += 2) best = Math.min(best, segmentDistance(p.x, p.z, l[i - 2], l[i - 1], l[i], l[i + 1]));
  return best;
}
export const isQuiet = (quiet: readonly Quiet[], p: Pt): boolean => quiet.some(q => Math.hypot(p.x - q.x, p.z - q.z) <= q.r);
/** Points along every road line, no further apart than `step`. */
export function roadPoints(field: Field, step = TAG.spotM): Pt[] {
  const out: Pt[] = [];
  for (const l of field.roads) {
    out.push({ x: l[0], z: l[1] });
    for (let i = 2; i < l.length; i += 2) {
      const ax = l[i - 2], az = l[i - 1], n = Math.max(1, Math.ceil(Math.hypot(l[i] - ax, l[i + 1] - az) / step));
      for (let j = 1; j <= n; j++) out.push({ x: ax + (l[i] - ax) * j / n, z: az + (l[i + 1] - az) * j / n });
    }
  }
  return out;
}
/** The road point that is the shortest worst drive for everyone (ties: the shortest total). */
export function fairPoint(spots: readonly Pt[], players: readonly Pt[]): Pt | null {
  let best: Pt | null = null, worst = Infinity, total = Infinity;
  for (const s of spots) {
    let w = 0, t = 0;
    for (const p of players) { const d = Math.hypot(s.x - p.x, s.z - p.z); w = Math.max(w, d); t += d; }
    if (w < worst - 1e-6 || Math.abs(w - worst) <= 1e-6 && t < total) { best = s; worst = w; total = t; }
  }
  return best;
}

export class TagRound {
  readonly s: TagState;
  private readonly seen: Map<number, Seen>;
  private readonly spots: Pt[];
  constructor(s: TagState) {
    this.s = s; this.seen = new Map(s.seen);
    this.spots = roadPoints(s.field).filter(p => Math.hypot(p.x - s.centre.x, p.z - s.centre.z) <= s.radius && !isQuiet(s.field.quiet, p));
  }
  /**
   * A new round, or null when it cannot be fair: fewer than two players near the host, or no open road near them.
   * `players` are the game-capable seats with a place, the host among them.
   */
  static start(field: Field, players: readonly (Pt & { id: number })[], host: number): TagRound | null {
    const h = players.find(p => p.id === host);
    if (!h) return null;
    const near = players.filter(p => Math.hypot(p.x - h.x, p.z - h.z) <= TAG.startReachM);
    if (near.length < 2) return null;
    const radius = playRadius(near.length);
    const open = roadPoints(field).filter(p => !isQuiet(field.quiet, p) && Math.hypot(p.x - h.x, p.z - h.z) + radius <= TAG.fieldReachM);
    const centre = fairPoint(open, near);
    if (!centre) return null;
    return new TagRound({ field, centre, radius, parcel: { ...centre }, holder: 0, immuneUntil: 0, idleSince: 0,
      credited: 0, players: near.slice(0, 24).map(p => ({ id: p.id, ms: 0 })), seen: [] });
  }
  /** The countdown is over: play starts now. Reports from the countdown do not count as a previous place. */
  begin(now: number): void { this.s.credited = now; this.seen.clear(); }
  table(): { id: number; score: number }[] { return this.s.players.map(p => ({ id: p.id, score: Math.floor(p.ms / 1000) })); }
  private player(id: number): TagPlayer | undefined { return this.s.players.find(p => p.id === id); }
  private quiet(p: Pt): boolean { return isQuiet(this.s.field.quiet, p); }
  private idle(r: Report): boolean {
    return r.parked || Math.hypot(r.vx, r.vz) < TAG.parkedMps || roadDistance(this.s.field, r) > TAG.offRoadM
      || Math.hypot(r.x - this.s.centre.x, r.z - this.s.centre.z) > this.s.radius || this.quiet(r);
  }
  /** Where a dropped parcel lies: where the holder was, unless that is off the roads, out of the area or quiet. */
  private resting(p: Pt): Pt {
    if (Math.hypot(p.x - this.s.centre.x, p.z - this.s.centre.z) <= this.s.radius && roadDistance(this.s.field, p) <= TAG.offRoadM && !this.quiet(p)) return { x: p.x, z: p.z };
    let best = this.s.centre, d = Infinity;
    for (const s of this.spots) { const e = Math.hypot(s.x - p.x, s.z - p.z); if (e < d) { d = e; best = s; } }
    return { x: best.x, z: best.z };
  }
  private drop(p: Pt, now: number): void {
    this.s.parcel = this.resting(p); this.s.dropper = this.s.holder; this.s.droppedAt = now;
    this.s.holder = 0; this.s.idleSince = 0; this.s.immuneUntil = 0;
  }
  /** The time the holder became idle (parked, off road, silent...), or 0 while it plays. */
  private idleFrom(now: number): number {
    if (this.s.idleSince) return this.s.idleSince;
    const h = this.seen.get(this.s.holder);
    if (!h) return this.s.credited;
    return now - h.at > TAG.silentMs ? h.at : 0;
  }
  /** Scores up to now, and the drop of an idle holder. True when the table or the parcel changed. */
  tick(now: number): boolean {
    if (!this.s.holder) { this.s.credited = Math.max(this.s.credited, now); return false; }
    const from = this.idleFrom(now), dropAt = from ? from + TAG.idleMs : Infinity, p = this.player(this.s.holder);
    const end = Math.min(now, from || Infinity), before = p ? Math.floor(p.ms / 1000) : 0;
    if (p && end > this.s.credited) p.ms += end - this.s.credited;
    this.s.credited = Math.max(this.s.credited, now);
    let changed = !!p && Math.floor(p.ms / 1000) !== before;
    if (now >= dropAt) { const h = this.seen.get(this.s.holder); this.drop(h ?? this.s.parcel, dropAt); changed = true; }
    return changed;
  }
  /** One accepted position report. True when what the players are told changed. */
  report(id: number, r: Report, now: number): boolean {
    let changed = this.tick(now);
    const prev = this.seen.get(id);
    const jumped = r.teleport || !!prev && Math.hypot(r.x - prev.x, r.z - prev.z) > TAG.jumpM + TAG.jumpMps * Math.max(0, now - prev.at) / 1000;
    this.seen.set(id, { x: r.x, z: r.z, vx: r.vx, vz: r.vz, parked: r.parked, teleport: r.teleport, at: now });
    if (!this.player(id)) {
      if (Math.hypot(r.x - this.s.centre.x, r.z - this.s.centre.z) > this.s.radius || this.s.players.length >= 24) return changed;
      this.s.players.push({ id, ms: 0 }); changed = true;
    }
    if (id === this.s.holder) {
      // A reset or a jump drops the parcel where the car was before it.
      if (jumped) { this.drop(prev ?? r, now); return true; }
      this.s.idleSince = this.idle(r) ? this.s.idleSince || now : 0;
      return changed;
    }
    if (jumped || !prev || this.quiet(r)) return changed;
    if (!this.s.holder) {
      if (id === this.s.dropper && now - (this.s.droppedAt ?? 0) < TAG.immuneMs) return changed;
      if (this.quiet(this.s.parcel) || segmentDistance(this.s.parcel.x, this.s.parcel.z, prev.x, prev.z, r.x, r.z) > TAG.pickupM) return changed;
      this.s.holder = id; this.s.immuneUntil = 0; this.s.idleSince = this.idle(r) ? now : 0;
      return true;
    }
    if (now < this.s.immuneUntil) return changed;
    const h = this.seen.get(this.s.holder);
    if (!h || this.quiet(h)) return changed;
    // The closest approach since this car's last report, the holder carried along its own last velocity.
    const at = (t: number) => { const dt = clamp((t - h.at) / 1000, -1, .6); return { x: h.x + h.vx * dt, z: h.z + h.vz * dt }; };
    const h0 = at(prev.at), h1 = at(now);
    const r0x = prev.x - h0.x, r0z = prev.z - h0.z, r1x = r.x - h1.x, r1z = r.z - h1.z;
    if (segmentDistance(0, 0, r0x, r0z, r1x, r1z) > TAG.stealM) return changed;
    const vx = r.vx - h.vx, vz = r.vz - h.vz, d0 = Math.hypot(r0x, r0z);
    const closing = d0 > 1e-6 ? -(r0x * vx + r0z * vz) / d0 : Math.hypot(vx, vz);
    if (closing < TAG.closingMps) return changed;
    this.s.holder = id; this.s.immuneUntil = now + TAG.immuneMs; this.s.idleSince = this.idle(r) ? now : 0;
    return true;
  }
  /** A player left the room: the holder's parcel drops where it was last heard. */
  leave(id: number, now: number): boolean {
    let changed = this.tick(now);
    if (id === this.s.holder) { this.drop(this.seen.get(id) ?? this.s.parcel, now); changed = true; }
    this.seen.delete(id);
    return changed;
  }
  /** Where the parcel is now: on the holder's car (as last heard), or lying on the road. */
  where(): Pt { const h = this.s.holder ? this.seen.get(this.s.holder) : undefined; return h ? { x: h.x, z: h.z } : this.s.parcel; }
  snapshot(): TagState { return { ...this.s, seen: [...this.seen] }; }
  payload(now: number): Uint8Array {
    const b = new Uint8Array(TAG_PAYLOAD), v = new DataView(b.buffer), p = this.where();
    v.setUint16(0, this.s.holder, true);
    v.setUint16(2, clamp(Math.round(this.s.immuneUntil - now), 0, 65535), true);
    v.setInt32(4, Math.round(p.x * 100), true); v.setInt32(8, Math.round(p.z * 100), true);
    v.setInt32(12, Math.round(this.s.centre.x), true); v.setInt32(16, Math.round(this.s.centre.z), true);
    v.setUint16(20, clamp(Math.round(this.s.radius), 0, 65535), true);
    return b;
  }
}
export function readTagPayload(v: DataView, at: number): TagView {
  return { holder: v.getUint16(at, true), immune: v.getUint16(at + 2, true),
    parcel: { x: v.getInt32(at + 4, true) / 100, z: v.getInt32(at + 8, true) / 100 },
    centre: { x: v.getInt32(at + 12, true), z: v.getInt32(at + 16, true) }, radius: v.getUint16(at + 20, true) };
}
