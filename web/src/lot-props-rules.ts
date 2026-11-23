import { ANIMAL } from './road-animal-rules';

/**
 * Where the lot props stand: a parked car, SUV or pickup, a small utility trailer, a motorhome, a ride-on mower and a
 * black-and-white farm dog, at some of the mapped houses. Pure: no three.js, no DOM, no land data.
 *
 * The choice is a seeded hash of the house's map id, and nothing else: the same houses get the same things on every
 * run, and nothing here reads an observation of a real yard (no dash cam, no reference file, no building style, no
 * mailbox). A prop stands on its own house's lot: nearer that house than any other building, within `reach` of its
 * walls, and clear of every road, track and drive, every driveway mouth, every other building and every hand-built
 * site. No people, no badges and no lettering: the shapes are drawn in parked.ts and lot-props.ts.
 */
export type LotPropKind = 'car' | 'suv' | 'pickup' | 'trailer' | 'motorhome' | 'mower' | 'dog-lying' | 'dog-sitting';
export const LOT_PROP_KINDS: readonly LotPropKind[] = Object.freeze(['car', 'suv', 'pickup', 'trailer', 'motorhome', 'mower', 'dog-lying', 'dog-sitting']);
/** Length and width in metres. The first three are the parked car, SUV and pickup of parked.ts (its PARKED_SIZE reads these). */
export const LOT_PROP_SIZE: Readonly<Record<LotPropKind, readonly [number, number]>> = Object.freeze({
  car: [4.5, 1.8], suv: [4.7, 1.9], pickup: [5.7, 2.0], trailer: [3.6, 1.8], motorhome: [7.4, 2.4], mower: [1.8, 1.1],
  'dog-lying': [1.0, 0.5], 'dog-sitting': [0.75, 0.45],
});
/** A dog is never solid and never scores (score-rules.ts NEVER): when a car comes close it slips away, as a waiting
 *  roadside animal does (road-animal-rules.ts ANIMAL.shy). Everything else stops the car like a parked car. */
export const lotPropSolid = (kind: LotPropKind): boolean => kind !== 'dog-lying' && kind !== 'dog-sitting';

/**
 * vehicle, other, dog: the share of houses that get a car, SUV or pickup; a trailer, motorhome or mower; a dog.
 * public: metres a prop keeps past a public road's edge: its shoulder, ditch and mailboxes, and any sidewalk (a walk
 *   and its buffer reach at most 3.5 m, sidewalk-layout.ts). drive: past the edge of a track, drive or trail.
 * mouth: metres from where a track or drive leaves a public road. wall: from any building's walls.
 * apart: between two props. reach: the lot, at most this far from the house's own walls. obstacle: from a pole or a box.
 */
export const LOT_PROPS = Object.freeze({ seed: 0x5a4d17, vehicle: 1 / 3, other: 1 / 15, dog: 1 / 24,
  public: 5.5, drive: 1.2, mouth: 9, wall: 1.2, apart: 1, reach: 14, obstacle: 0.8 });

type XZ = readonly [number, number];
/** A mapped house in world metres: centre, the heading of its long axis (as Building.axisDeg, in radians), its sizes
 *  and its footprint. `id` is the map's identity for the house: the only thing the seeded choice reads. */
export interface LotHouse { id: number; x: number; z: number; axis: number; length: number; width: number; footprint: readonly XZ[] }
export interface LotRoad { kind: number; halfWidth: number; pts: readonly XZ[] }
export interface LotInput {
  houses: readonly LotHouse[];
  /** Every building's footprint in world metres, houses included. `id` is the building's identity: the wings of a
   *  building drawn as wings share the id of the house they make up (Building.buildingId). */
  buildings: readonly { id: number; footprint: readonly XZ[] }[];
  roads: readonly LotRoad[];
  /** Drawn things a prop keeps `obstacle` metres from (poles, mailboxes): avoided only, never a reason to pick a house. */
  obstacles?: readonly XZ[];
  /** World boxes [x0, z0, x1, z1] of hand-built sites: nothing is placed in or at a house inside one. */
  excluded: readonly (readonly number[])[];
  seed?: number;
}
/** One prop: its centre, the heading of its nose (forward is (sin h, -cos h)), half its length and width, the house
 *  it stands at, and a number in [0, 1) that picks its paint. */
/** A chosen prop. `house` is the house's map id; `hx`, `hz` its centre (where a view stands to see the prop with the house behind). */
export interface LotProp { kind: LotPropKind; x: number; z: number; heading: number; half: number; halfWidth: number; house: number; hx: number; hz: number; tone: number }

/** A small repeatable hash of (seed, id) into a 32-bit state. */
export function lotHash(seed: number, id: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(id >>> 0, 0xc2b2ae35) ^ Math.imul(Math.floor(id / 4294967296), 0x27d4eb2f);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
function random(state: number): () => number {
  let s = state >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** What a house gets, from its id alone: at most one vehicle, one of the rarer things and one dog. */
export function lotWants(id: number, seed: number = LOT_PROPS.seed): { kinds: LotPropKind[]; rnd: () => number } {
  const rnd = random(lotHash(seed, id)), kinds: LotPropKind[] = [];
  const vehicle = rnd(), which = rnd(), other = rnd(), whichOther = rnd(), dog = rnd(), pose = rnd();
  if (vehicle < LOT_PROPS.vehicle) kinds.push(which < 0.36 ? 'pickup' : which < 0.68 ? 'suv' : 'car');
  if (other < LOT_PROPS.other) kinds.push((['trailer', 'motorhome', 'mower'] as const)[Math.min(2, Math.floor(whichOther * 3))]);
  if (dog < LOT_PROPS.dog) kinds.push(pose < 0.5 ? 'dog-lying' : 'dog-sitting');
  return { kinds, rnd };
}

// ---- Plane geometry: a rectangle is a centre, a heading of its long axis and two half sizes. ----
interface Rect { x: number; z: number; heading: number; half: number; halfWidth: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export function rectCorners(r: Rect): [number, number][] {
  const ax = Math.sin(r.heading), az = -Math.cos(r.heading);
  const hx = ax * r.half, hz = az * r.half, wx = -az * r.halfWidth, wz = ax * r.halfWidth;
  return [
    [r.x + hx + wx, r.z + hz + wz],
    [r.x + hx - wx, r.z + hz - wz],
    [r.x - hx - wx, r.z - hz - wz],
    [r.x - hx + wx, r.z - hz + wz],
  ];
}
function pointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const ex = px - ax - t * dx, ez = pz - az - t * dz;
  return Math.sqrt(ex * ex + ez * ez);
}
function clipSegmentToBox(a0: number, b0: number, a1: number, b1: number, half: number, halfWidth: number): boolean {
  let t0 = 0, t1 = 1;
  const da = a1 - a0, db = b1 - b0;
  let p = -da, q = a0 + half;
  if (p === 0) { if (q < 0) return false; } else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  p = da; q = half - a0;
  if (p === 0) { if (q < 0) return false; } else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  p = -db; q = b0 + halfWidth;
  if (p === 0) { if (q < 0) return false; } else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  p = db; q = halfWidth - b0;
  if (p === 0) { if (q < 0) return false; } else { const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } }
  return t0 <= t1;
}
function rectSegmentWithAxes(r: Rect, rAx: number, rAz: number,
  c0x: number, c0z: number, c1x: number, c1z: number, c2x: number, c2z: number, c3x: number, c3z: number,
  ax: number, az: number, bx: number, bz: number): number {
  const d0x = ax - r.x, d0z = az - r.z, a0 = d0x * rAx + d0z * rAz, b0 = d0x * -rAz + d0z * rAx;
  const d1x = bx - r.x, d1z = bz - r.z, a1 = d1x * rAx + d1z * rAz, b1 = d1x * -rAz + d1z * rAx;
  if (clipSegmentToBox(a0, b0, a1, b1, r.half, r.halfWidth)) return 0;
  const rx0 = Math.max(Math.abs(a0) - r.half, 0), rz0 = Math.max(Math.abs(b0) - r.halfWidth, 0);
  const rx1 = Math.max(Math.abs(a1) - r.half, 0), rz1 = Math.max(Math.abs(b1) - r.halfWidth, 0);
  let d = Math.min(Math.sqrt(rx0 * rx0 + rz0 * rz0), Math.sqrt(rx1 * rx1 + rz1 * rz1));
  let cd = pointSegment(c0x, c0z, ax, az, bx, bz); if (cd < d) d = cd;
  cd = pointSegment(c1x, c1z, ax, az, bx, bz); if (cd < d) d = cd;
  cd = pointSegment(c2x, c2z, ax, az, bx, bz); if (cd < d) d = cd;
  cd = pointSegment(c3x, c3z, ax, az, bx, bz); if (cd < d) d = cd;
  return d;
}
/** Metres between a rectangle and a segment: 0 when they touch or cross. */
export function rectSegment(r: Rect, ax: number, az: number, bx: number, bz: number): number {
  const rAx = Math.sin(r.heading), rAz = -Math.cos(r.heading);
  const hx = rAx * r.half, hz = rAz * r.half, wx = -rAz * r.halfWidth, wz = rAx * r.halfWidth;
  return rectSegmentWithAxes(r, rAx, rAz,
    r.x + hx + wx, r.z + hz + wz, r.x + hx - wx, r.z + hz - wz,
    r.x - hx - wx, r.z - hz - wz, r.x - hx + wx, r.z - hz + wz,
    ax, az, bx, bz);
}
function insidePolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j], xi = pi[0], zi = pi[1], xj = pj[0], zj = pj[1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function rectPolygonWithAxes(r: Rect, rAx: number, rAz: number,
  c0x: number, c0z: number, c1x: number, c1z: number, c2x: number, c2z: number, c3x: number, c3z: number,
  poly: readonly XZ[]): number {
  if (insidePolygon(r.x, r.z, poly)) return 0;
  let d = Infinity;
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const a = poly[i], b = poly[i + 1 === len ? 0 : i + 1];
    const sd = rectSegmentWithAxes(r, rAx, rAz, c0x, c0z, c1x, c1z, c2x, c2z, c3x, c3z, a[0], a[1], b[0], b[1]);
    if (sd === 0) return 0;
    if (sd < d) d = sd;
  }
  return d;
}
/** Metres between a rectangle and a building's footprint: 0 when they overlap. */
export function rectPolygon(r: Rect, poly: readonly XZ[]): number {
  const rAx = Math.sin(r.heading), rAz = -Math.cos(r.heading);
  const hx = rAx * r.half, hz = rAz * r.half, wx = -rAz * r.halfWidth, wz = rAx * r.halfWidth;
  return rectPolygonWithAxes(r, rAx, rAz,
    r.x + hx + wx, r.z + hz + wz, r.x + hx - wx, r.z + hz - wz,
    r.x - hx - wx, r.z - hz - wz, r.x - hx + wx, r.z - hz + wz, poly);
}
function pointPolygon(x: number, z: number, poly: readonly XZ[]): number {
  if (insidePolygon(x, z, poly)) return 0;
  let d = Infinity;
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const a = poly[i], b = poly[i + 1 === len ? 0 : i + 1];
    const sd = pointSegment(x, z, a[0], a[1], b[0], b[1]);
    if (sd < d) d = sd;
  }
  return d;
}
const rectRect = (a: Rect, b: Rect): number => {
  const aAx = Math.sin(a.heading), aAz = -Math.cos(a.heading);
  const bAx = Math.sin(b.heading), bAz = -Math.cos(b.heading);
  const dABx = a.x - b.x, dABz = a.z - b.z;
  if (Math.abs(dABx * bAx + dABz * bAz) <= b.half && Math.abs(dABx * -bAz + dABz * bAx) <= b.halfWidth) return 0;
  const dBAx = -dABx, dBAz = -dABz;
  if (Math.abs(dBAx * aAx + dBAz * aAz) <= a.half && Math.abs(dBAx * -aAz + dBAz * aAx) <= a.halfWidth) return 0;
  const ahx = aAx * a.half, ahz = aAz * a.half, awx = -aAz * a.halfWidth, awz = aAx * a.halfWidth;
  const a0x = a.x + ahx + awx, a0z = a.z + ahz + awz;
  const a1x = a.x + ahx - awx, a1z = a.z + ahz - awz;
  const a2x = a.x - ahx - awx, a2z = a.z - ahz - awz;
  const a3x = a.x - ahx + awx, a3z = a.z - ahz + awz;
  const bhx = bAx * b.half, bhz = bAz * b.half, bwx = -bAz * b.halfWidth, bwz = bAx * b.halfWidth;
  const b0x = b.x + bhx + bwx, b0z = b.z + bhz + bwz;
  const b1x = b.x + bhx - bwx, b1z = b.z + bhz - bwz;
  const b2x = b.x - bhx - bwx, b2z = b.z - bhz - bwz;
  const b3x = b.x - bhx + bwx, b3z = b.z - bhz + bwz;
  let d = rectSegmentWithAxes(b, bAx, bAz, b0x, b0z, b1x, b1z, b2x, b2z, b3x, b3z, a0x, a0z, a1x, a1z);
  let sd = rectSegmentWithAxes(b, bAx, bAz, b0x, b0z, b1x, b1z, b2x, b2z, b3x, b3z, a1x, a1z, a2x, a2z); if (sd < d) d = sd;
  sd = rectSegmentWithAxes(b, bAx, bAz, b0x, b0z, b1x, b1z, b2x, b2z, b3x, b3z, a2x, a2z, a3x, a3z); if (sd < d) d = sd;
  sd = rectSegmentWithAxes(b, bAx, bAz, b0x, b0z, b1x, b1z, b2x, b2z, b3x, b3z, a3x, a3z, a0x, a0z); if (sd < d) d = sd;
  return d;
};
function rectBox(r: Rect): [number, number, number, number] {
  const ax = Math.sin(r.heading), az = -Math.cos(r.heading);
  const ex = Math.abs(ax) * r.half + Math.abs(az) * r.halfWidth;
  const ez = Math.abs(az) * r.half + Math.abs(ax) * r.halfWidth;
  return [r.x - ex, r.z - ez, r.x + ex, r.z + ez];
}

// ---- A coarse grid, so a house reads only the roads and buildings near it. ----
const CELL = 64;
const cellKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);
class Grid<T> {
  private cells = new Map<number, T[]>();
  private seen = new Set<T>();
  add(item: T, box: readonly number[]): void {
    const i0 = Math.floor(box[0] / CELL), i1 = Math.floor(box[2] / CELL);
    const j0 = Math.floor(box[1] / CELL), j1 = Math.floor(box[3] / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = cellKey(i, j), list = this.cells.get(key);
      if (list) { if (list[list.length - 1] !== item) list.push(item); }
      else this.cells.set(key, [item]);
    }
  }
  /** What is in the one cell under a point. */
  at(x: number, z: number): readonly T[] { return this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []; }
  near(box: readonly number[]): T[] {
    const i0 = Math.floor(box[0] / CELL), i1 = Math.floor(box[2] / CELL);
    const j0 = Math.floor(box[1] / CELL), j1 = Math.floor(box[3] / CELL);
    if (i0 === i1 && j0 === j1) return this.cells.get(cellKey(i0, j0)) ?? [];
    const seen = this.seen; seen.clear();
    const out: T[] = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.cells.get(cellKey(i, j));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        if (!seen.has(t)) { seen.add(t); out.push(t); }
      }
    }
    return out;
  }
  someNear(x0: number, z0: number, x1: number, z1: number, test: (t: T) => boolean): boolean {
    const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL);
    const j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    if (i0 === i1 && j0 === j1) {
      const list = this.cells.get(cellKey(i0, j0));
      if (!list) return false;
      for (let k = 0; k < list.length; k++) if (test(list[k])) return true;
      return false;
    }
    const seen = this.seen; seen.clear();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.cells.get(cellKey(i, j));
      if (!list) continue;
      for (let k = 0; k < list.length; k++) {
        const t = list[k];
        if (seen.has(t)) continue;
        seen.add(t);
        if (test(t)) return true;
      }
    }
    return false;
  }
}
interface Segment { ax: number; az: number; bx: number; bz: number; halfWidth: number; isPublic: boolean }
const isPublic = (kind: number) => kind >= 1 && kind <= 3;

/** The places to try for one prop at one house, best first: beside a mapped drive, then beside the house, then in front. */
function spots(kind: LotPropKind, house: LotHouse, drives: Segment[], toward: number, rnd: () => number): Rect[] {
  const [length, width] = LOT_PROP_SIZE[kind], half = length / 2, halfWidth = width / 2, out: Rect[] = [];
  const dog = kind === 'dog-lying' || kind === 'dog-sitting', small = dog || kind === 'mower';
  // The house's axis nearest the road is its front: f along it (toward the road), s across.
  const axes = [house.axis, house.axis + Math.PI / 2, house.axis + Math.PI, house.axis - Math.PI / 2];
  const front = axes.reduce((best, a) => (Math.cos(a - toward) > Math.cos(best - toward) ? a : best), axes[0]);
  const alongU = Math.abs(Math.cos(front - house.axis)) > 0.5;
  const hf = (alongU ? house.length : house.width) / 2, hs = (alongU ? house.width : house.length) / 2;
  const fx = Math.sin(front), fz = -Math.cos(front), sx = Math.cos(front), sz = Math.sin(front);
  const at = (a: number, b: number, heading: number): Rect => ({ x: house.x + fx * a + sx * b, z: house.z + fz * a + sz * b, heading, half, halfWidth });
  // Nose toward the house (pulled in) more often than toward the road (backed in).
  const nose = rnd() < 0.62 ? front + Math.PI : front, side = rnd() < 0.5 ? 1 : -1, turn = (rnd() - 0.5) * 0.12;
  if (!dog) for (const d of drives) {
    // Beside a mapped drive near the house, parallel to it, on either side.
    const len = Math.hypot(d.bx - d.ax, d.bz - d.az), heading = Math.atan2(d.bx - d.ax, -(d.bz - d.az));
    const off = d.halfWidth + LOT_PROPS.drive + halfWidth + 0.3;
    for (let t = half; t <= len - half; t += 2.5) {
      const px = d.ax + ((d.bx - d.ax) * t) / len, pz = d.az + ((d.bz - d.az) * t) / len;
      if (Math.hypot(px - house.x, pz - house.z) > hf + hs + LOT_PROPS.reach) continue;
      for (const s of [side, -side]) out.push({ x: px + Math.cos(heading) * off * s, z: pz + Math.sin(heading) * off * s, heading: heading + (rnd() < 0.5 ? 0 : Math.PI) + turn, half, halfWidth });
    }
  }
  const gap = small ? 1.6 : 1.8;
  if (dog) {
    // Near the front, where a dog keeps an eye on the road; then by the side walls.
    const look = front + (rnd() - 0.5) * 1.6;
    for (const b of [side * (hs * 0.5), -side * (hs * 0.5), 0, side * (hs + 1.5), -side * (hs + 1.5)]) out.push(at(hf + gap + 0.5, b, look));
    for (const s of [side, -side]) out.push(at(hf * 0.4, s * (hs + gap + 0.4), look));
    return out;
  }
  // Beside the house, along its side walls, front corner first; then on a pad in front, to one side.
  const lanes = [hf - half + 1, hf + half * 0.5, 0, -hf + half];
  for (const s of [side, -side]) for (const a of lanes) out.push(at(a, s * (hs + gap + halfWidth), (small ? front + Math.PI / 2 * s : nose) + turn));
  for (const s of [side, -side]) for (const b of [hs - halfWidth, hs + halfWidth + 0.6, 0]) out.push(at(hf + gap + half, s * b, nose + turn));
  if (small) for (const s of [side, -side]) out.push(at(-(hf + gap + halfWidth), s * hs * 0.4, front + Math.PI / 2 + turn));
  return out;
}

/**
 * Choose every lot prop of an area. Stable: the result depends only on the inputs and the seed, never on time or on
 * the order of `houses`. Each house gets at most one vehicle, one trailer, motorhome or mower, and one dog.
 */
export function chooseLotProps(input: LotInput): LotProp[] {
  const seed = input.seed ?? LOT_PROPS.seed, reach = LOT_PROPS.reach;
  const roads = new Grid<Segment>(), drives: Segment[] = [], mouths: XZ[] = [], publics: Segment[] = [];
  for (const r of input.roads) for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], s: Segment = { ax, az, bx, bz, halfWidth: r.halfWidth, isPublic: isPublic(r.kind) };
    // Along a long diagonal segment, piece by piece: its whole bounding box would fill many cells it never crosses.
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2)));
    for (let k = 0; k < steps; k++) {
      const x0 = ax + ((bx - ax) * k) / steps, z0 = az + ((bz - az) * k) / steps, x1 = ax + ((bx - ax) * (k + 1)) / steps, z1 = az + ((bz - az) * (k + 1)) / steps, m = r.halfWidth + 1;
      roads.add(s, [Math.min(x0, x1) - m, Math.min(z0, z1) - m, Math.max(x0, x1) + m, Math.max(z0, z1) + m]);
    }
    (s.isPublic ? publics : drives).push(s);
  }
  // A driveway mouth: where a track or drive comes to a public road's edge.
  const pubGrid = new Grid<Segment>();
  for (const s of publics) {
    const steps = Math.max(1, Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / (CELL / 2)));
    for (let k = 0; k < steps; k++) {
      const x0 = s.ax + ((s.bx - s.ax) * k) / steps, z0 = s.az + ((s.bz - s.az) * k) / steps, x1 = s.ax + ((s.bx - s.ax) * (k + 1)) / steps, z1 = s.az + ((s.bz - s.az) * (k + 1)) / steps, m = s.halfWidth + 7;
      pubGrid.add(s, [Math.min(x0, x1) - m, Math.min(z0, z1) - m, Math.max(x0, x1) + m, Math.max(z0, z1) + m]);
    }
  }
  for (const r of input.roads) if (!isPublic(r.kind)) for (const [x, z] of r.pts)
    if (pubGrid.at(x, z).some((s) => pointSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.halfWidth + 6)) mouths.push([x, z]);
  const mouthGrid = new Grid<XZ>(), things = new Grid<XZ>();
  for (const m of mouths) mouthGrid.add(m, [m[0], m[1], m[0], m[1]]);
  for (const o of input.obstacles ?? []) things.add(o, [o[0], o[1], o[0], o[1]]);
  const buildings = new Grid<{ id: number; footprint: readonly XZ[] }>();
  for (const b of input.buildings) { const f = b.footprint; if (f.length >= 3) buildings.add(b, [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1])), Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))]); }
  const placed: LotProp[] = [], placedGrid = new Grid<LotProp>();
  const overlaps = (b: readonly number[], e: readonly number[]) => b[0] <= e[2] && b[2] >= e[0] && b[1] <= e[3] && b[3] >= e[1];

  for (const house of [...input.houses].sort((a, b) => a.id - b.id)) {
    if (house.footprint.length < 3 || input.excluded.some((e) => overlaps([house.x, house.z, house.x, house.z], e))) continue;
    const { kinds, rnd } = lotWants(house.id, seed);
    if (!kinds.length) continue;
    const span = Math.hypot(house.length, house.width) / 2 + reach + 4, area = [house.x - span, house.z - span, house.x + span, house.z + span];
    const nearExcluded = input.excluded.filter((e) => overlaps(area, e));
    const nearRoads = roads.near([area[0] - 60, area[1] - 60, area[2] + 60, area[3] + 60]);
    const nearBuildings = buildings.near(area), own = house.footprint;
    // The direction to the nearest public road is the house's front.
    let toward = house.axis, best = Infinity;
    for (const s of nearRoads) if (s.isPublic) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, t = clamp(((house.x - s.ax) * dx + (house.z - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const px = s.ax + t * dx, pz = s.az + t * dz, d = Math.hypot(px - house.x, pz - house.z);
      if (d < best && d > 0.01) { best = d; toward = Math.atan2(px - house.x, -(pz - house.z)); }
    }
    // The fit test reads only the roads that can reach the lot.
    const fitRoads = nearRoads.filter((s) => Math.min(s.ax, s.bx) - s.halfWidth - 6 < area[2] && Math.max(s.ax, s.bx) + s.halfWidth + 6 > area[0] && Math.min(s.az, s.bz) - s.halfWidth - 6 < area[3] && Math.max(s.az, s.bz) + s.halfWidth + 6 > area[1]);
    const nearDrives = nearRoads.filter((s) => !s.isPublic && rectSegment({ x: house.x, z: house.z, heading: house.axis, half: house.length / 2, halfWidth: house.width / 2 }, s.ax, s.az, s.bx, s.bz) < reach);
    // Its own wings are walls to keep off, but never a neighbour whose lot it could be.
    const wings: (readonly XZ[])[] = [], others: (readonly XZ[])[] = [];
    for (const b of nearBuildings) (b.id === house.id ? wings : others).push(b.footprint);
    const fits = (r: Rect): boolean => {
      const rAx = Math.sin(r.heading), rAz = -Math.cos(r.heading);
      const hx = rAx * r.half, hz = rAz * r.half, wx = -rAz * r.halfWidth, wz = rAx * r.halfWidth;
      const c0x = r.x + hx + wx, c0z = r.z + hz + wz;
      const c1x = r.x + hx - wx, c1z = r.z + hz - wz;
      const c2x = r.x - hx - wx, c2z = r.z - hz - wz;
      const c3x = r.x - hx + wx, c3z = r.z - hz + wz;
      const ex = Math.abs(rAx) * r.half + Math.abs(rAz) * r.halfWidth;
      const ez = Math.abs(rAz) * r.half + Math.abs(rAx) * r.halfWidth;
      const bx0 = r.x - ex, bz0 = r.z - ez, bx1 = r.x + ex, bz1 = r.z + ez;
      if (nearExcluded.length) {
        for (let i = 0; i < nearExcluded.length; i++) {
          const e = nearExcluded[i];
          if (bx0 <= e[2] && bx1 >= e[0] && bz0 <= e[3] && bz1 >= e[1]) return false;
        }
      }
      const round = Math.hypot(r.half, r.halfWidth);
      for (const s of fitRoads) {
        const clear = s.halfWidth + (s.isPublic ? LOT_PROPS.public : LOT_PROPS.drive);
        // The circle round the prop first: a segment past it by the clearance cannot be nearer the rectangle.
        if (pointSegment(r.x, r.z, s.ax, s.az, s.bx, s.bz) - round >= clear) continue;
        if (rectSegmentWithAxes(r, rAx, rAz, c0x, c0z, c1x, c1z, c2x, c2z, c3x, c3z, s.ax, s.az, s.bx, s.bz) < clear) return false;
      }
      for (const m of mouthGrid.near([bx0 - LOT_PROPS.mouth, bz0 - LOT_PROPS.mouth, bx1 + LOT_PROPS.mouth, bz1 + LOT_PROPS.mouth])) {
        const dx = m[0] - r.x, dz = m[1] - r.z, a = dx * rAx + dz * rAz, b = dx * -rAz + dz * rAx;
        const ux = Math.max(Math.abs(a) - r.half, 0), uz = Math.max(Math.abs(b) - r.halfWidth, 0);
        if (Math.sqrt(ux * ux + uz * uz) < LOT_PROPS.mouth) return false;
      }
      if (things.someNear(bx0 - 1, bz0 - 1, bx1 + 1, bz1 + 1, (o) => {
        const dx = o[0] - r.x, dz = o[1] - r.z, a = dx * rAx + dz * rAz, b = dx * -rAz + dz * rAx;
        const ux = Math.max(Math.abs(a) - r.half, 0), uz = Math.max(Math.abs(b) - r.halfWidth, 0);
        return Math.sqrt(ux * ux + uz * uz) < LOT_PROPS.obstacle;
      })) return false;
      if (rectPolygonWithAxes(r, rAx, rAz, c0x, c0z, c1x, c1z, c2x, c2z, c3x, c3z, own) < LOT_PROPS.wall) return false;
      for (let i = 0; i < wings.length; i++) if (rectPolygonWithAxes(r, rAx, rAz, c0x, c0z, c1x, c1z, c2x, c2z, c3x, c3z, wings[i]) < LOT_PROPS.wall) return false;
      for (let i = 0; i < others.length; i++) if (rectPolygonWithAxes(r, rAx, rAz, c0x, c0z, c1x, c1z, c2x, c2z, c3x, c3z, others[i]) < LOT_PROPS.wall) return false;
      // On this house's lot: every corner and the centre nearer this house than any other building, and within reach.
      const checkLot = (x: number, z: number): boolean => {
        const mine = pointPolygon(x, z, own);
        if (mine > reach) return false;
        for (const f of others) if (pointPolygon(x, z, f) <= mine) return false;
        return true;
      };
      if (!checkLot(c0x, c0z) || !checkLot(c1x, c1z) || !checkLot(c2x, c2z) || !checkLot(c3x, c3z) || !checkLot(r.x, r.z)) return false;
      if (placedGrid.someNear(bx0 - 2, bz0 - 2, bx1 + 2, bz1 + 2, (p) => rectRect(r, p) < LOT_PROPS.apart)) return false;
      return true;
    };
    for (const kind of kinds) {
      const tone = rnd(), spot = spots(kind, house, nearDrives, toward, rnd).find(fits);
      if (!spot) continue;
      const prop: LotProp = { kind, x: spot.x, z: spot.z, heading: Math.atan2(Math.sin(spot.heading), Math.cos(spot.heading)), half: spot.half, halfWidth: spot.halfWidth, house: house.id, hx: house.x, hz: house.z, tone };
      placed.push(prop); placedGrid.add(prop, rectBox(prop));
    }
  }
  return placed;
}

/** Another system's footprint a lot prop must keep clear of: the breakable yard props of mail play (yard-props-rules.ts),
 *  which stand only in some modes and so are not an input to the seeded choice. `heading`: the game's heading of its length. */
export interface Footprint { x: number; z: number; heading: number; half: number; halfWidth: number }
/** The indices of `props` closer than `margin` to any footprint: those are left out where the footprints stand. */
export function overlapping(props: readonly LotProp[], others: readonly Footprint[], margin: number = LOT_PROPS.apart): number[] {
  const grid = new Grid<Footprint>();
  for (const o of others) grid.add(o, rectBox(o));
  const out: number[] = [];
  props.forEach((p, i) => {
    const b = rectBox(p);
    for (const o of grid.near([b[0] - margin, b[1] - margin, b[2] + margin, b[3] + margin])) if (rectRect(p, o) < margin) { out.push(i); return; }
  });
  return out;
}

/** Whether a dog stays out of sight: it slips away once a car's body is within ANIMAL.shy of it (as a waiting roadside
 *  animal does) and comes back only when the car is `back` metres off. `gap` is metres from the dog to the car's body. */
export const DOG_BACK = 12;
export function dogAway(away: boolean, gap: number): boolean { return away ? gap < DOG_BACK : gap < ANIMAL.shy; }
