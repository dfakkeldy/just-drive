// Rough stretches of gravel roads and tracks, and the puddles that lie on them.
//
// Roughness was set per whole road (pipeline/areas.py `washboard`). A stretch here marks only part of a named road: from
// one road vertex to another. It is painted at run time through a terrain Site (terrain.ts paintSiteSurface, bit 128), so
// the wheels (surfaceAt) and the picture (shaders.ts) read the same samples and no land is baked again.
//
// What "rough" does: more and deeper potholes (defects.ts ROUGH_POTHOLES, ROUGH_DEPTH), muddy sunken wheel paths in the
// picture, a slower, looser surface for the car, and puddles. A puddle is water in a pothole, a long streak in a wheel
// rut, or a pond across the lane. Puddles come from a seeded rule, so the same stretch always holds the same water, and
// the wheels and the picture read the same list (puddles.ts draws them).
//
// Survey of the River Denys Road stretches: Dan's dash cams, 21 Nov 2026 (private notes; no footage in git). The worst
// parts held pothole pools every 4 to 8 m, long water in the ruts, and ponds across the whole lane; he drove them at
// 10 to 19 km/h.

import { POTHOLE_CELL, potholeDensity, potholeIn } from './defects';
import type { Road } from './roads';
import type { Site } from './terrain';

type Point = readonly [number, number];
export type Roughness = 'rough' | 'severe';

/** A stretch of one named road, between two of its vertices (EPSG:2961 east, north), and how bad it is. */
export interface RoughStretch { area: string; road: string; from: Point; to: Point; level: Roughness }

// Chainage in the notes is metres along River Denys Road from Highway 19 (game roads 97, 98, 99).
export const ROUGH_STRETCHES: readonly RoughStretch[] = Object.freeze([
  // 4.8 to 6.8 km: narrower gravel, potholes, soft mud, small muddy puddles. Dan drove 20 to 35 km/h.
  { area: 'judique', road: 'River Denys Road', from: [621534.52, 5080698.42], to: [623137.92, 5079717.18], level: 'rough' },
  // 6.8 to 8.3 km: a rutted two-track. Water in the ruts, pothole pools, four ponds across the lane near 7.8 km. 11 to 19 km/h.
  { area: 'judique', road: 'River Denys Road', from: [623137.92, 5079717.18], to: [624572.72, 5079312.0], level: 'severe' },
  // 11.7 to 12.35 km: water across the road where the gravel turns to track.
  { area: 'judique', road: 'River Denys Road', from: [627738.61, 5080209.18], to: [628330.88, 5080375.57], level: 'rough' },
  // 13.15 to 13.65 km: a pothole field full of water.
  { area: 'judique', road: 'River Denys Road', from: [628914.06, 5080484.29], to: [629359.52, 5080533.13], level: 'rough' },
  // 14.35 to 15.65 km: the descent to the church. Deep washed ruts, loose rock, pothole pools. 8 to 18 km/h.
  // It ends 130 m short of the church start, which stays on a plain track.
  { area: 'judique', road: 'River Denys Road', from: [629795.96, 5080883.77], to: [630717.18, 5080566.15], level: 'severe' },
]);

/** How much water each level holds: the share of potholes that hold water (on average: pools come in clusters), and
 *  metres along the road between rut streaks and between ponds. Survey: 1-2 puddles per 100 m on the rough stretches,
 *  2-4 (with clusters of pools) on the severe ones. */
export const PUDDLE_RULES: Readonly<Record<Roughness, { poolShare: number; rut: [number, number]; pond: [number, number]; pondWidth: [number, number] }>> = Object.freeze({
  rough: { poolShare: 0.08, rut: [60, 120], pond: [150, 280], pondWidth: [0.45, 0.7] },
  severe: { poolShare: 0.2, rut: [25, 50], pond: [55, 120], pondWidth: [0.7, 0.92] },
});

export const PUDDLE_POOL = 0, PUDDLE_RUT = 1, PUDDLE_POND = 2;
/** Metres from the centre line to each wheel rut on a rough stretch (shaders.ts draws them there): a car's half track. */
export const RUT = 0.8;
/** One puddle, in world metres. `a` is the half length along `yaw` (0 = north, clockwise), `b` the half width across.
 *  `depth` is how far a wheel sinks at the middle (a pool sits in a pothole that already holds the wheel). */
export interface Puddle { x: number; z: number; a: number; b: number; yaw: number; depth: number; kind: number; seed: number }

/** A stretch resolved onto the game's road: a world polyline, and the half width and road kind of the segment that
 *  starts at each vertex. */
export interface ResolvedStretch { stretch: RoughStretch; pts: [number, number][]; half: number[]; kind: number[]; washboard: boolean[]; length: number }

const near = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;

/** Follow the named road from `from` to `to`, across the pieces it is split into (end of one = start of the next).
 *  `roads` are the area's road data in east, north (roads.json), as main.ts reads them before converting.
 *  Null when the road data no longer holds both vertices in that order: the stretch is then left out, never guessed. */
export function resolveStretch(roads: readonly Road[], stretch: RoughStretch, origin: Point): ResolvedStretch | null {
  const pieces = roads.filter(r => r.name === stretch.road && !r.bridge && (r.kind === 3 || r.kind === 4));
  for (const [first, last] of [[stretch.from, stretch.to], [stretch.to, stretch.from]] as const) {
    for (const start of pieces) {
      const i = start.pts.findIndex(p => near(p, first));
      if (i < 0) continue;
      const out: ResolvedStretch = { stretch, pts: [], half: [], kind: [], washboard: [], length: 0 };
      let piece: Road | undefined = start, at = i;
      const used = new Set<Road>();
      while (piece && !used.has(piece)) {
        used.add(piece);
        for (let k = at; k < piece.pts.length; k++) {
          const p = piece.pts[k];
          const wash = !!(piece as Road & { washboard?: boolean }).washboard, prev = out.pts.length - 1;
          // The joint: the same vertex ends the piece before. The segment that starts there is this piece's.
          if (prev >= 0 && k === 0) { out.half[prev] = piece.halfWidth; out.kind[prev] = piece.kind; out.washboard[prev] = wash; continue; }
          out.pts.push([p[0] - origin[0], origin[1] - p[1]]); out.half.push(piece.halfWidth); out.kind.push(piece.kind); out.washboard.push(wash);
          if (near(p, last)) {
            for (let j = 1; j < out.pts.length; j++) out.length += Math.hypot(out.pts[j][0] - out.pts[j - 1][0], out.pts[j][1] - out.pts[j - 1][1]);
            return out.pts.length > 1 ? out : null;
          }
        }
        const end: [number, number] = piece.pts[piece.pts.length - 1];
        piece = pieces.find(r => !used.has(r) && near(r.pts[0], end)); at = 0;
      }
    }
  }
  return null;
}

/** A small seeded random stream (mulberry32). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s: RoughStretch) => Math.round(s.from[0] * 10) ^ Math.imul(Math.round(s.from[1] * 10), 2654435761) ^ s.road.length;
const cellShare = (cx: number, cz: number) => ((Math.imul(cx | 0, 374761393) ^ Math.imul(cz | 0, 668265263)) >>> 0) / 4294967296;

/** Distance from a point to a polyline, with the index of the nearest segment. */
function toLine(pts: readonly [number, number][], x: number, z: number, from = 0, to = pts.length - 1): { dist: number; seg: number } {
  let best = Infinity, seg = -1;
  for (let i = Math.max(0, from); i < Math.min(to, pts.length - 1); i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) { best = d; seg = i; }
  }
  return { dist: best, seg };
}

/** Points every `step` metres along the stretch: position, heading (0 = north, clockwise), half width and kind. */
function stations(r: ResolvedStretch, step: number) {
  const out: { s: number; x: number; z: number; yaw: number; half: number; kind: number; washboard: boolean }[] = [];
  let s = 0;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az);
    if (l <= 0) continue;
    const yaw = Math.atan2(bx - ax, -(bz - az));
    for (let t = out.length ? (step - (s % step)) % step : 0; t < l; t += step)
      out.push({ s: s + t, x: ax + (bx - ax) * t / l, z: az + (bz - az) * t / l, yaw, half: r.half[i], kind: r.kind[i], washboard: r.washboard[i] });
    s += l;
  }
  return out;
}

/** Things puddles keep away from, in world metres: other roads' centre lines (junction mouths), bridges and places
 *  such as a start pose. */
export interface PuddleClearance { roads: readonly { pts: [number, number][]; bridge: boolean; half: number }[]; points: readonly { x: number; z: number; r: number }[] }

/** The puddles of one stretch. The same stretch always gives the same list. */
export function puddlesFor(r: ResolvedStretch, clear: PuddleClearance): Puddle[] {
  const rule = PUDDLE_RULES[r.stretch.level], rnd = stream(seedOf(r.stretch)), out: Puddle[] = [];
  const free = (x: number, z: number, reach: number) => {
    if (clear.points.some(p => Math.hypot(x - p.x, z - p.z) < p.r + reach)) return false;
    for (const o of clear.roads) if (toLine(o.pts, x, z).dist < (o.bridge ? 20 : o.half + 6) + reach) return false;
    return true;
  };
  const along = stations(r, 1), ends = (s: number, reach: number) => s < 12 + reach || s > r.length - 12 - reach;
  // Wet and dry runs along the road: the share of full potholes swells and fades over some tens of metres.
  const p1 = rnd() * 6.28, p2 = rnd() * 6.28;
  const cluster = (s: number) => Math.max(0, Math.min(2, 1 + 1.6 * (0.6 * Math.sin(s / 37 + p1) + 0.4 * Math.sin(s / 91 + p2))));
  // Water in the potholes the wheels already fall into (defects.ts): the same cells, a share of them full.
  const seen = new Set<number>();
  for (const st of along) {
    const density = potholeDensity(st.kind, st.washboard, false, true);
    for (let o = -st.half; o <= st.half; o += 1) {
      const x = st.x + Math.cos(st.yaw) * o, z = st.z + Math.sin(st.yaw) * o;
      const cx = Math.floor(x / POTHOLE_CELL), cz = Math.floor(z / POTHOLE_CELL), key = (cx + 40000) * 80000 + cz + 40000;
      if (seen.has(key)) continue;
      seen.add(key);
      const hole = potholeIn(cx, cz, density);
      if (!hole || cellShare(cx, cz) >= rule.poolShare * cluster(st.s) || ends(st.s, 0)) continue;
      const { dist } = toLine(r.pts, hole.x, hole.z);
      // The picture draws a hole only well inside the road edge (shaders.ts: rdist < rhalf - 0.2).
      if (dist > st.half - 0.2 - hole.radius * 0.6 || !free(hole.x, hole.z, hole.radius)) continue;
      out.push({ x: hole.x, z: hole.z, a: hole.radius * 1.1, b: hole.radius * 0.9, yaw: cellShare(cz, cx) * Math.PI, depth: 0.015, kind: PUDDLE_POOL, seed: cellShare(cx + 7, cz) });
    }
  }
  // Long water in a wheel rut.
  const pick = (range: [number, number]) => range[0] + (range[1] - range[0]) * rnd();
  const at = (s: number) => along[Math.min(along.length - 1, Math.max(0, Math.round(s)))];
  for (let s = pick(rule.rut); s < r.length; s += pick(rule.rut)) {
    const st = at(s), a = 1.5 + 3 * rnd(), b = 0.17 + 0.09 * rnd(), side = rnd() < 0.5 ? -1 : 1;
    const off = side * RUT + (rnd() - 0.5) * 0.2;
    const x = st.x + Math.cos(st.yaw) * off, z = st.z + Math.sin(st.yaw) * off;
    if (ends(s, a) || !free(x, z, a)) continue;
    out.push({ x, z, a, b, yaw: st.yaw, depth: 0.04 + 0.02 * rnd(), kind: PUDDLE_RUT, seed: rnd() });
  }
  // A pond across the lane.
  for (let s = pick(rule.pond); s < r.length; s += pick(rule.pond)) {
    const st = at(s), a = 2 + 2.5 * rnd(), b = st.half * pick(rule.pondWidth), off = (rnd() - 0.5) * (st.half - b) * 2;
    const x = st.x + Math.cos(st.yaw) * off, z = st.z + Math.sin(st.yaw) * off;
    if (ends(s, a) || !free(x, z, a)) continue;
    out.push({ x, z, a, b, yaw: st.yaw + (rnd() - 0.5) * 0.3, depth: 0.08 + 0.05 * rnd(), kind: PUDDLE_POND, seed: rnd() });
  }
  return out;
}

const CELL = 8;
const cellKey = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

/** Every puddle of an area, in an 8 m grid: the wheels look up the one cell they are in. */
export class PuddleField {
  readonly cells = new Map<number, Puddle[]>();
  constructor(readonly puddles: readonly Puddle[]) {
    for (const p of puddles) {
      const r = Math.max(p.a, p.b);
      for (let ix = Math.floor((p.x - r) / CELL); ix <= Math.floor((p.x + r) / CELL); ix++)
        for (let iz = Math.floor((p.z - r) / CELL); iz <= Math.floor((p.z + r) / CELL); iz++) {
          const key = cellKey(ix, iz), list = this.cells.get(key);
          if (list) list.push(p); else this.cells.set(key, [p]);
        }
    }
  }
  /** How far a wheel at a world point sinks into water, in metres; 0 when it is dry. A pool's wheel is already in the
   *  pothole, so a pool adds only its thin layer of water. */
  dip(x: number, z: number): number {
    const list = this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return 0;
    let best = 0;
    for (const p of list) {
      const dx = x - p.x, dz = z - p.z, s = Math.sin(p.yaw), c = Math.cos(p.yaw);
      const u = (dx * s - dz * c) / p.a, v = (dx * c + dz * s) / p.b, q = u * u + v * v;
      if (q < 1) best = Math.max(best, p.depth * Math.sqrt(1 - q));
    }
    return best;
  }
}

/** The installed field. Null (no rough stretch in this area or era): every lookup is 0 and nothing changes. */
let field: PuddleField | null = null;
export function setPuddleField(f: PuddleField | null): void { field = f; }
/** Water under a wheel, in metres (vehicle.ts, bike-ride.ts). */
export function puddleDip(x: number, z: number): number { return field ? field.dip(x, z) : 0; }

/** A terrain Site that marks the mapped road samples of one stretch rough. It changes no height, distance or width. */
export function roughSite(r: ResolvedStretch): Site {
  const pad = Math.max(...r.half) + 3;
  const box: Site['box'] = [Infinity, Infinity, -Infinity, -Infinity];
  const segs: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    const s: [number, number, number, number] = [Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad];
    segs.push(s);
    box[0] = Math.min(box[0], s[0]); box[1] = Math.min(box[1], s[1]); box[2] = Math.max(box[2], s[2]); box[3] = Math.max(box[3], s[3]);
  }
  // Segments by 16 m cell, so a sample far from the road costs one map lookup.
  const grid = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (let ix = Math.floor(s[0] / 16); ix <= Math.floor(s[2] / 16); ix++)
      for (let iz = Math.floor(s[1] / 16); iz <= Math.floor(s[3] / 16); iz++) {
        const key = cellKey(ix, iz), list = grid.get(key);
        if (list) list.push(i); else grid.set(key, [i]);
      }
  });
  return {
    box, maxTexel: 2,
    // Only tiles that a segment's padded box reaches: a long stretch's box spans many forest tiles with no road.
    affectsTile: (x, z, size) => segs.some(s => s[0] <= x + size && s[2] >= x && s[1] <= z + size && s[3] >= z),
    height: (_x, _z, ground) => ground,
    surface(x, z) {
      const list = grid.get(cellKey(Math.floor(x / 16), Math.floor(z / 16)));
      if (!list) return null;
      let best = Infinity, seg = 0;
      for (const i of list) { const d = toLine(r.pts, x, z, i, i + 1).dist; if (d < best) { best = d; seg = i; } }
      return best <= r.half[seg] + 3 ? { dist: best, half: r.half[seg], kind: r.kind[seg], rough: true } : null;
    },
  };
}

/** The rough stretches of an area resolved on its roads: the sites that mark them and the puddles they hold.
 *  `keepClear` are world points (with a radius) where no puddle may lie, such as a start pose. */
export function roughRoads(roads: readonly Road[], area: string, origin: Point, keepClear: readonly { x: number; z: number; r: number }[] = [],
  stretches: readonly RoughStretch[] = ROUGH_STRETCHES) {
  const resolved = stretches.filter(s => s.area === area).map(s => resolveStretch(roads, s, origin)).filter((r): r is ResolvedStretch => !!r);
  if (!resolved.length) return null;
  const names = new Set(resolved.map(r => r.stretch.road));
  // Other roads near a stretch: their mouths and any bridge keep the water away.
  const boxes = resolved.map(r => [Math.min(...r.pts.map(p => p[0])) - 40, Math.min(...r.pts.map(p => p[1])) - 40, Math.max(...r.pts.map(p => p[0])) + 40, Math.max(...r.pts.map(p => p[1])) + 40]);
  const others = roads.filter(o => o.bridge || !names.has(o.name ?? ''))
    .map(o => ({ pts: o.pts.map(([e, n]) => [e - origin[0], origin[1] - n] as [number, number]), bridge: o.bridge, half: o.halfWidth }))
    .filter(o => o.pts.some(([x, z]) => boxes.some(b => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3])));
  const puddles = resolved.flatMap(r => puddlesFor(r, { roads: others, points: keepClear }));
  return { stretches: resolved, sites: resolved.map(roughSite), field: new PuddleField(puddles) };
}
