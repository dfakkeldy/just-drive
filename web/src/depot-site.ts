/**
 * Site geometry, gravel yard, collision solids and door coordinates for the invented Port Hood Mail Depot
 * on Highway 19 in Port Hood. Pure data + math (no three.js meshes).
 */
import { frameToMap, type Frame } from './site-kit';
import type { Solid } from './parked';
import { strips } from './site-solids';
import type { Site } from './terrain';

type Point = [number, number];
type Rect = readonly [x0: number, x1: number, z0: number, z1: number];

/**
 * EPSG:2961. Open, level roadside lot on the northwest side of Highway 19 in Port Hood,
 * ~297 m from Port Hood village (well outside the 150 m researched-place margin) and >43 m from every surveyed building.
 * Local +x faces southeast (az 138°) directly toward Highway 19; +z runs southwest along the highway.
 */
export const DEPOT_FRAME: Frame = { e: 613969.4, n: 5096023.3, az: 138 };
/** Main sorting hall (10 m deep along x, 16 m wide along z). */
export const DEPOT_HALL: Rect = [-5.5, 4.5, -8.0, 8.0];
/** Concrete loading dock and canopy jutting toward the gravel apron (x+). */
export const DEPOT_DOCK: Rect = [4.5, 6.4, -5.2, 1.8];
/** Concrete landing and steps up to the personnel / Boss office entrance. */
export const DEPOT_STEPS: Rect = [4.5, 6.28, 3.6, 5.6];
/** Side supervisor's office wing on the southwest end (z+). */
export const DEPOT_OFFICE: Rect = [-4.2, 4.5, 8.0, 12.2];
/** Door trigger sits on the gravel apron right in front of the loading dock and office steps. */
export const DEPOT_DOOR_LOCAL: readonly [number, number] = [9.2, 2.2];
export const DEPOT_DOOR_RADIUS = 14;
/** Yellow safety bollards flanking the loading bay dock corners. */
export const DEPOT_BOLLARDS: readonly Point[] = [[6.7, -5.4], [6.7, 2.0]];

// Gravel turnaround apron reaching from the depot front out to the northwest edge of Highway 19.
const LOT_LOCAL: readonly Point[] = [
  [-6.8, -9.8], [15.0, -10.8], [15.5, 13.8], [-6.0, 13.5],
];

const corners = ([x0, x1, z0, z1]: Rect): Point[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
function bounds(points: readonly Point[], pad = 0): [number, number, number, number] {
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
}

/** Signed distance to the gravel lot polygon, positive inside. */
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

export class DepotSite implements Site {
  readonly centre: { x: number; z: number };
  readonly doorPosition: { x: number; z: number };
  readonly box: [number, number, number, number];
  readonly clear: number[][];
  readonly solids: Solid[];
  readonly probes: readonly Point[];
  readonly maxTexel = 2;
  private readonly lot: Point[];

  constructor(readonly village: readonly [number, number]) {
    const world = (e: number, n: number): Point => [e - village[0], village[1] - n];
    const fp = (x: number, z: number): Point => world(...frameToMap(DEPOT_FRAME, x, z));
    const [cx, cz] = world(DEPOT_FRAME.e, DEPOT_FRAME.n);
    this.centre = { x: cx, z: cz };
    const [dx, dz] = fp(DEPOT_DOOR_LOCAL[0], DEPOT_DOOR_LOCAL[1]);
    this.doorPosition = { x: dx, z: dz };
    this.lot = LOT_LOCAL.map(([x, z]) => fp(x, z));
    this.box = bounds(this.lot, 2.5);

    const building = [DEPOT_HALL, DEPOT_DOCK, DEPOT_OFFICE].map(r => corners(r).map(([x, z]) => fp(x, z)));
    this.probes = [[cx, cz], [dx, dz], ...building.flat()];
    this.clear = building.map(r => bounds(r, 1.0));
    for (let x = this.box[0]; x < this.box[2]; x += 4) for (let z = this.box[1]; z < this.box[3]; z += 4) {
      if (edgeDepth(this.lot, x + 2, z + 2) > -0.5) this.clear.push([x, z, x + 4, z + 4]);
    }

    const solid = ([x0, x1, z0, z1]: Rect): Solid => {
      const [sx, sz] = fp((x0 + x1) / 2, (z0 + z1) / 2);
      return { x: sx, z: sz, half: (x1 - x0) / 2, halfWidth: (z1 - z0) / 2, heading: DEPOT_FRAME.az * Math.PI / 180 };
    };
    this.solids = [
      solid(DEPOT_HALL),
      solid(DEPOT_DOCK),
      solid(DEPOT_STEPS),
      solid(DEPOT_OFFICE),
      ...DEPOT_BOLLARDS.map(([bx, bz]) => solid([bx - 0.18, bx + 0.18, bz - 0.18, bz + 0.18])),
    ].flatMap(strips);
  }

  height(_x: number, _z: number, surveyed: number): number { return surveyed; }
  surface(x: number, z: number): ReturnType<Site['surface']> {
    const depth = edgeDepth(this.lot, x, z);
    // Uses the game's yard gravel field (kind 8); Highway 19's own pavement stays protected.
    return depth >= -2 ? { dist: Math.max(6.5, 10 - depth), half: 10, kind: 8 } : null;
  }
}
