import { frameToMap, type Frame } from './site-kit';
import type { Solid } from './parked';
import { strips } from './site-solids';
import type { Site } from './terrain';

type Point = [number, number];
type Rect = readonly [x0: number, x1: number, z0: number, z1: number];

// EPSG:2961. The roof return in the 1 m surface model runs along the side road.
// The bare-earth model reads about 75.5 m under the shop and 74–75 m on the north lot.
export const SHOP: Frame = { e: 617278, n: 5088796, az: 61 };
export const MAIN: Rect = [-11.9, 11.9, -6.1, 6.1];
export const WING: Rect = [-6.5, 7.8, 6.02, 11.7];
export const PORCH: Rect = [7.8, 9.85, 6.3, 11.7];
export const POSTS = [6.5, 8.98, 11.48];
export const POST_HALF = 0.09;

export interface Tractor extends Frame { color: number; scale: number; cab: boolean }
export const TRACTORS: readonly Tractor[] = [
  { e: 617293.6, n: 5088799.7, az: 94, color: 0x984838, scale: 1.02, cab: false },
  { e: 617292.7, n: 5088806.4, az: 92, color: 0x496c56, scale: 1.14, cab: true },
  { e: 617292.0, n: 5088813.4, az: 94, color: 0x4b7385, scale: 0.94, cab: false },
  { e: 617281.7, n: 5088812.4, az: 85, color: 0xa86c3e, scale: 0.91, cab: false },
  { e: 617280.5, n: 5088818.7, az: 88, color: 0x798384, scale: 1.07, cab: true },
  { e: 617284.1, n: 5088824.4, az: 98, color: 0x794e68, scale: 0.82, cab: false },
];
export const TRACTOR_HALF_LENGTH = 2.12;
export const TRACTOR_HALF_WIDTH = 1.21;

// One connected gravel apron. The inner edge bends around the old store and
// leaves a grass strip between the sales yard and the separate surveyed shed.
const LOT: Point[] = [
  [617265.0, 5088774.2], [617274.0, 5088779.8], [617277.0, 5088777.8],
  [617282.0, 5088780.8], [617285.8, 5088787.1],
  [617293.2, 5088791.1], [617297.0, 5088797.5], [617295.7, 5088823.8],
  [617289.2, 5088828.2], [617278.5, 5088827.5], [617273.3, 5088822.7],
  [617274.2, 5088807.7], [617279.1, 5088798.2], [617266.5, 5088786.2],
  [617260.7, 5088779.5],
];

const corners = ([x0, x1, z0, z1]: Rect): Point[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
function bounds(points: readonly Point[], pad = 0): [number, number, number, number] {
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
}

/** Signed distance to a lot edge, positive toward the gravel. */
function edgeDepth(points: readonly Point[], x: number, z: number): number {
  let inside = false, nearest = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[j], [bx, bz] = points[i];
    const dx = bx - ax, dz = bz - az;
    if ((az > z) !== (bz > z) && x < ax + dx * (z - az) / dz) inside = !inside;
    const along = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    nearest = Math.min(nearest, Math.hypot(x - ax - along * dx, z - az - along * dz));
  }
  return inside ? nearest : -nearest;
}

export class MaryvilleStoreSite implements Site {
  readonly centre: { x: number; z: number };
  readonly box: [number, number, number, number];
  readonly clear: number[][];
  readonly solids: Solid[];
  readonly probes: readonly Point[];
  readonly maxTexel = 2;
  private readonly lot: Point[];

  constructor(readonly village: readonly [number, number]) {
    const world = (e: number, n: number): Point => [e - village[0], village[1] - n];
    const framePoint = (p: Frame, x: number, z: number) => world(...frameToMap(p, x, z));
    const [x, z] = world(SHOP.e, SHOP.n);
    this.centre = { x, z };
    this.lot = LOT.map(([e, n]) => world(e, n));
    this.box = bounds(this.lot, 2.5);

    const building = [MAIN, WING, PORCH].map(r => corners(r).map(([x, z]) => framePoint(SHOP, x, z)));
    const display = TRACTORS.map(t => corners([
      -TRACTOR_HALF_LENGTH * t.scale, TRACTOR_HALF_LENGTH * t.scale,
      -TRACTOR_HALF_WIDTH * t.scale, TRACTOR_HALF_WIDTH * t.scale,
    ]).map(([x, z]) => framePoint(t, x, z)));
    this.probes = [[x, z], ...building.flat(), ...display.flat()];
    this.clear = building.map(r => bounds(r, 0.85));
    // Small boxes follow the gravel edge without taking out the spruce behind the shop.
    for (let x = this.box[0]; x < this.box[2]; x += 3) for (let z = this.box[1]; z < this.box[3]; z += 3) {
      if (edgeDepth(this.lot, x + 1.5, z + 1.5) > -0.5) this.clear.push([x, z, x + 3, z + 3]);
    }

    const solid = (p: Frame, [x0, x1, z0, z1]: Rect): Solid => {
      const [x, z] = framePoint(p, (x0 + x1) / 2, (z0 + z1) / 2);
      return { x, z, half: (x1 - x0) / 2, halfWidth: (z1 - z0) / 2, heading: p.az * Math.PI / 180 };
    };
    const postX = PORCH[1] - 0.15;
    this.solids = [
      solid(SHOP, MAIN), solid(SHOP, WING),
      ...POSTS.map(z => solid(SHOP, [postX - POST_HALF, postX + POST_HALF, z - POST_HALF, z + POST_HALF])),
      ...TRACTORS.map(t => solid(t, [-TRACTOR_HALF_LENGTH * t.scale, TRACTOR_HALF_LENGTH * t.scale,
        -TRACTOR_HALF_WIDTH * t.scale, TRACTOR_HALF_WIDTH * t.scale])),
    ].flatMap(strips);
  }

  height(_x: number, _z: number, surveyed: number): number { return surveyed; }
  surface(x: number, z: number): ReturnType<Site['surface']> {
    const depth = edgeDepth(this.lot, x, z);
    // Use the existing yard gravel field. Its painter protects the public lanes.
    return depth >= -2 ? { dist: Math.max(6.5, 10 - depth), half: 10, kind: 8 } : null;
  }
}
