import { ANIMAL } from './road-animal-rules';

/**
 * Where the yard props stand: a parked car, SUV or pickup, a small utility trailer, a motorhome, a ride-on mower and a
 * black-and-white farm dog, at some of the mapped houses. Pure: no three.js, no DOM, no land data.
 *
 * The choice is a seeded hash of the house's map id, and nothing else: the same houses get the same things on every
 * run, and nothing here reads an observation of a real yard (no dash cam, no reference file, no building style, no
 * mailbox). A prop stands on its own house's lot: nearer that house than any other building, within `reach` of its
 * walls, and clear of every road, track and drive, every driveway mouth, every other building and every hand-built
 * site. No people, no badges and no lettering: the shapes are drawn in parked.ts and yard-props.ts.
 */
export type YardPropKind = 'car' | 'suv' | 'pickup' | 'trailer' | 'motorhome' | 'mower' | 'dog-lying' | 'dog-sitting';
export const YARD_PROP_KINDS: readonly YardPropKind[] = Object.freeze(['car', 'suv', 'pickup', 'trailer', 'motorhome', 'mower', 'dog-lying', 'dog-sitting']);
/** Length and width in metres. The first three are the parked car, SUV and pickup of parked.ts (its PARKED_SIZE reads these). */
export const YARD_PROP_SIZE: Readonly<Record<YardPropKind, readonly [number, number]>> = Object.freeze({
  car: [4.5, 1.8], suv: [4.7, 1.9], pickup: [5.7, 2.0], trailer: [3.6, 1.8], motorhome: [7.4, 2.4], mower: [1.8, 1.1],
  'dog-lying': [1.0, 0.5], 'dog-sitting': [0.75, 0.45],
});
/** A dog is never solid and never scores (score-rules.ts NEVER): when a car comes close it slips away, as a waiting
 *  roadside animal does (road-animal-rules.ts ANIMAL.shy). Everything else stops the car like a parked car. */
export const yardPropSolid = (kind: YardPropKind): boolean => kind !== 'dog-lying' && kind !== 'dog-sitting';

/**
 * vehicle, other, dog: the share of houses that get a car, SUV or pickup; a trailer, motorhome or mower; a dog.
 * public: metres a prop keeps past a public road's edge: its shoulder, ditch and mailboxes, and any sidewalk (a walk
 *   and its buffer reach at most 3.5 m, sidewalk-layout.ts). drive: past the edge of a track, drive or trail.
 * mouth: metres from where a track or drive leaves a public road. wall: from any building's walls.
 * apart: between two props. reach: the lot, at most this far from the house's own walls.
 */
export const YARD_PROPS = Object.freeze({ seed: 0x5a4d17, vehicle: 1 / 3, other: 1 / 15, dog: 1 / 24,
  public: 5.5, drive: 1.2, mouth: 9, wall: 1.2, apart: 1, reach: 14 });

type XZ = readonly [number, number];
/** A mapped house in world metres: centre, the heading of its long axis (as Building.axisDeg, in radians), its sizes
 *  and its footprint. `id` is the map's identity for the house: the only thing the seeded choice reads. */
export interface YardHouse { id: number; x: number; z: number; axis: number; length: number; width: number; footprint: readonly XZ[] }
export interface YardRoad { kind: number; halfWidth: number; pts: readonly XZ[] }
export interface YardInput {
  houses: readonly YardHouse[];
  /** Every building's footprint in world metres, houses included. `id` is the building's identity: the wings of a
   *  building drawn as wings share the id of the house they make up (Building.buildingId). */
  buildings: readonly { id: number; footprint: readonly XZ[] }[];
  roads: readonly YardRoad[];
  /** World boxes [x0, z0, x1, z1] of hand-built sites: nothing is placed in or at a house inside one. */
  excluded: readonly (readonly number[])[];
  seed?: number;
}
/** One prop: its centre, the heading of its nose (forward is (sin h, -cos h)), half its length and width, the house
 *  it stands at, and a number in [0, 1) that picks its paint. */
export interface YardProp { kind: YardPropKind; x: number; z: number; heading: number; half: number; halfWidth: number; house: number; tone: number }

/** A small repeatable hash of (seed, id) into a 32-bit state. */
export function yardHash(seed: number, id: number): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul(id >>> 0, 0xc2b2ae35) ^ Math.imul(Math.floor(id / 4294967296), 0x27d4eb2f);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
function random(state: number): () => number {
  let s = state >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** What a house gets, from its id alone: at most one vehicle, one of the rarer things and one dog. */
export function yardWants(id: number, seed: number = YARD_PROPS.seed): { kinds: YardPropKind[]; rnd: () => number } {
  const rnd = random(yardHash(seed, id)), kinds: YardPropKind[] = [];
  const vehicle = rnd(), which = rnd(), other = rnd(), whichOther = rnd(), dog = rnd(), pose = rnd();
  if (vehicle < YARD_PROPS.vehicle) kinds.push(which < 0.36 ? 'pickup' : which < 0.68 ? 'suv' : 'car');
  if (other < YARD_PROPS.other) kinds.push((['trailer', 'motorhome', 'mower'] as const)[Math.min(2, Math.floor(whichOther * 3))]);
  if (dog < YARD_PROPS.dog) kinds.push(pose < 0.5 ? 'dog-lying' : 'dog-sitting');
  return { kinds, rnd };
}

// ---- Plane geometry: a rectangle is a centre, a heading of its long axis and two half sizes. ----
interface Rect { x: number; z: number; heading: number; half: number; halfWidth: number }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** A point in a rectangle's own axes: along its long axis, then across. */
function inRect(r: Rect, x: number, z: number): [number, number] {
  const ax = Math.sin(r.heading), az = -Math.cos(r.heading), dx = x - r.x, dz = z - r.z;
  return [dx * ax + dz * az, dx * -az + dz * ax];
}
export function rectCorners(r: Rect): [number, number][] {
  const ax = Math.sin(r.heading), az = -Math.cos(r.heading);
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [r.x + ax * a * r.half - az * b * r.halfWidth, r.z + az * a * r.half + ax * b * r.halfWidth]);
}
function pointSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
/** Metres between a rectangle and a segment: 0 when they touch or cross. */
export function rectSegment(r: Rect, ax: number, az: number, bx: number, bz: number): number {
  const [a0, b0] = inRect(r, ax, az), [a1, b1] = inRect(r, bx, bz);
  // Clip the segment to the box (Liang-Barsky): any part left inside means they meet.
  let t0 = 0, t1 = 1;
  const da = a1 - a0, db = b1 - b0;
  const clip = (p: number, q: number) => { if (p === 0) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
  if (clip(-da, a0 + r.half) && clip(da, r.half - a0) && clip(-db, b0 + r.halfWidth) && clip(db, r.halfWidth - b0) && t0 <= t1) return 0;
  const box = (a: number, b: number) => Math.hypot(Math.max(Math.abs(a) - r.half, 0), Math.max(Math.abs(b) - r.halfWidth, 0));
  let d = Math.min(box(a0, b0), box(a1, b1));
  for (const [cx, cz] of rectCorners(r)) d = Math.min(d, pointSegment(cx, cz, ax, az, bx, bz));
  return d;
}
function insidePolygon(x: number, z: number, poly: readonly XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Metres between a rectangle and a building's footprint: 0 when they overlap. */
export function rectPolygon(r: Rect, poly: readonly XZ[]): number {
  if (insidePolygon(r.x, r.z, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    d = Math.min(d, rectSegment(r, ax, az, bx, bz));
    if (d === 0) return 0;
  }
  return d;
}
function pointPolygon(x: number, z: number, poly: readonly XZ[]): number {
  if (insidePolygon(x, z, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; d = Math.min(d, pointSegment(x, z, ax, az, bx, bz)); }
  return d;
}
const rectRect = (a: Rect, b: Rect): number => {
  const c = rectCorners(a);
  let d = Infinity;
  for (let i = 0; i < 4; i++) d = Math.min(d, rectSegment(b, c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1]));
  return Math.abs(inRect(b, a.x, a.z)[0]) <= b.half && Math.abs(inRect(b, a.x, a.z)[1]) <= b.halfWidth ? 0 : d;
};
function rectBox(r: Rect): [number, number, number, number] {
  const c = rectCorners(r);
  return [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];
}

// ---- A coarse grid, so a house reads only the roads and buildings near it. ----
const CELL = 64;
class Grid<T> {
  private cells = new Map<string, T[]>();
  add(item: T, box: readonly number[]): void {
    for (let i = Math.floor(box[0] / CELL); i <= Math.floor(box[2] / CELL); i++) for (let j = Math.floor(box[1] / CELL); j <= Math.floor(box[3] / CELL); j++) {
      const key = `${i},${j}`, list = this.cells.get(key);
      if (list) list.push(item); else this.cells.set(key, [item]);
    }
  }
  near(box: readonly number[]): Set<T> {
    const out = new Set<T>();
    for (let i = Math.floor(box[0] / CELL); i <= Math.floor(box[2] / CELL); i++) for (let j = Math.floor(box[1] / CELL); j <= Math.floor(box[3] / CELL); j++) for (const t of this.cells.get(`${i},${j}`) ?? []) out.add(t);
    return out;
  }
}
interface Segment { ax: number; az: number; bx: number; bz: number; halfWidth: number; isPublic: boolean }
const isPublic = (kind: number) => kind >= 1 && kind <= 3;

/** The places to try for one prop at one house, best first: beside a mapped drive, then beside the house, then in front. */
function spots(kind: YardPropKind, house: YardHouse, drives: Segment[], toward: number, rnd: () => number): Rect[] {
  const [length, width] = YARD_PROP_SIZE[kind], half = length / 2, halfWidth = width / 2, out: Rect[] = [];
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
    const off = d.halfWidth + YARD_PROPS.drive + halfWidth + 0.3;
    for (let t = half; t <= len - half; t += 2.5) {
      const px = d.ax + ((d.bx - d.ax) * t) / len, pz = d.az + ((d.bz - d.az) * t) / len;
      if (Math.hypot(px - house.x, pz - house.z) > hf + hs + YARD_PROPS.reach) continue;
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
 * Choose every yard prop of an area. Stable: the result depends only on the inputs and the seed, never on time or on
 * the order of `houses`. Each house gets at most one vehicle, one trailer, motorhome or mower, and one dog.
 */
export function chooseYardProps(input: YardInput): YardProp[] {
  const seed = input.seed ?? YARD_PROPS.seed, reach = YARD_PROPS.reach;
  const roads = new Grid<Segment>(), drives: Segment[] = [], mouths: XZ[] = [], publics: Segment[] = [];
  for (const r of input.roads) for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i], s: Segment = { ax, az, bx, bz, halfWidth: r.halfWidth, isPublic: isPublic(r.kind) };
    roads.add(s, [Math.min(ax, bx) - r.halfWidth, Math.min(az, bz) - r.halfWidth, Math.max(ax, bx) + r.halfWidth, Math.max(az, bz) + r.halfWidth]);
    (s.isPublic ? publics : drives).push(s);
  }
  // A driveway mouth: where a track or drive comes to a public road's edge.
  const pubGrid = new Grid<Segment>();
  for (const s of publics) pubGrid.add(s, [Math.min(s.ax, s.bx) - 8, Math.min(s.az, s.bz) - 8, Math.max(s.ax, s.bx) + 8, Math.max(s.az, s.bz) + 8]);
  for (const r of input.roads) if (!isPublic(r.kind)) for (const [x, z] of r.pts)
    for (const s of pubGrid.near([x, z, x, z])) if (pointSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.halfWidth + 6) { mouths.push([x, z]); break; }
  const mouthGrid = new Grid<XZ>();
  for (const m of mouths) mouthGrid.add(m, [m[0], m[1], m[0], m[1]]);
  const buildings = new Grid<{ id: number; footprint: readonly XZ[] }>();
  for (const b of input.buildings) { const f = b.footprint; if (f.length >= 3) buildings.add(b, [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1])), Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))]); }
  const placed: YardProp[] = [], placedGrid = new Grid<YardProp>();
  const overlaps = (b: readonly number[], e: readonly number[]) => b[0] <= e[2] && b[2] >= e[0] && b[1] <= e[3] && b[3] >= e[1];

  for (const house of [...input.houses].sort((a, b) => a.id - b.id)) {
    if (house.footprint.length < 3 || input.excluded.some((e) => overlaps([house.x, house.z, house.x, house.z], e))) continue;
    const { kinds, rnd } = yardWants(house.id, seed);
    if (!kinds.length) continue;
    const span = Math.hypot(house.length, house.width) / 2 + reach + 4, area = [house.x - span, house.z - span, house.x + span, house.z + span];
    const nearRoads = [...roads.near([area[0] - 60, area[1] - 60, area[2] + 60, area[3] + 60])];
    const nearBuildings = [...buildings.near(area)], own = house.footprint;
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
    const wings = nearBuildings.filter((b) => b.id === house.id).map((b) => b.footprint), others = nearBuildings.filter((b) => b.id !== house.id).map((b) => b.footprint);
    const fits = (r: Rect): boolean => {
      const box = rectBox(r);
      if (input.excluded.some((e) => overlaps(box, e))) return false;
      const round = Math.hypot(r.half, r.halfWidth);
      for (const s of fitRoads) {
        const clear = s.halfWidth + (s.isPublic ? YARD_PROPS.public : YARD_PROPS.drive);
        // The circle round the prop first: a segment past it by the clearance cannot be nearer the rectangle.
        if (pointSegment(r.x, r.z, s.ax, s.az, s.bx, s.bz) - round >= clear) continue;
        if (rectSegment(r, s.ax, s.az, s.bx, s.bz) < clear) return false;
      }
      for (const m of mouthGrid.near([box[0] - YARD_PROPS.mouth, box[1] - YARD_PROPS.mouth, box[2] + YARD_PROPS.mouth, box[3] + YARD_PROPS.mouth])) {
        const [a, b] = inRect(r, m[0], m[1]);
        if (Math.hypot(Math.max(Math.abs(a) - r.half, 0), Math.max(Math.abs(b) - r.halfWidth, 0)) < YARD_PROPS.mouth) return false;
      }
      if (rectPolygon(r, own) < YARD_PROPS.wall) return false;
      for (const f of [...wings, ...others]) if (rectPolygon(r, f) < YARD_PROPS.wall) return false;
      // On this house's lot: every corner and the centre nearer this house than any other building, and within reach.
      for (const [x, z] of [...rectCorners(r), [r.x, r.z]]) {
        const mine = pointPolygon(x, z, own);
        if (mine > reach) return false;
        for (const f of others) if (pointPolygon(x, z, f) <= mine) return false;
      }
      for (const p of placedGrid.near([box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2])) if (rectRect(r, p) < YARD_PROPS.apart) return false;
      return true;
    };
    for (const kind of kinds) {
      const tone = rnd(), spot = spots(kind, house, nearDrives, toward, rnd).find(fits);
      if (!spot) continue;
      const prop: YardProp = { kind, x: spot.x, z: spot.z, heading: Math.atan2(Math.sin(spot.heading), Math.cos(spot.heading)), half: spot.half, halfWidth: spot.halfWidth, house: house.id, tone };
      placed.push(prop); placedGrid.add(prop, rectBox(prop));
    }
  }
  return placed;
}

/** Whether a dog stays out of sight: it slips away once a car's body is within ANIMAL.shy of it (as a waiting roadside
 *  animal does) and comes back only when the car is `back` metres off. `gap` is metres from the dog to the car's body. */
export const DOG_BACK = 12;
export function dogAway(away: boolean, gap: number): boolean { return away ? gap < DOG_BACK : gap < ANIMAL.shy; }
