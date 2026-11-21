import type { Building } from './buildings';
import type { Site } from './terrain';
import type { Solid } from './parked';

/**
 * River Denys Mountain church, measured from the owner's phone scan of the outside (21 Nov 2026), in metres.
 * The scan fixes the walls, openings, steps and ramp. The scan has no roof: the ridge comes from the LiDAR, and the
 * belfry above the scan's top (6.9 m) from the LiDAR top (10.8 m) and the owner's dash cam stills.
 *
 * Frame: the origin is the middle of the front (WNW) gable wall at ground level. +x points to the tower (297.65
 * degrees), +z to the NNE side (27.65 degrees). World +x is east and +z is south; all model axes keep their handedness.
 */
export const CHURCH_ORIGIN = [630836.69, 5080641.18] as const;
export const CHURCH_SCALE = 1;
export const CHURCH_HEADING = 297.65 * Math.PI / 180;
export const CHURCH_GEOM = {
  "nave": { "x0": -11.9, "x1": 0, "zn": 4.02, "zs": 4.02, "eave": 4.6, "ridge": 7.3 },
  "tower": { "x1": 2.0, "zn": 0.875, "zs": 1.15, "top": 9.0 },
  "cupola": { "x": 1.0, "z": 0.14, "r": 0.5, "base": 9.0, "top": 9.75, "dome": 10.75, "cross": 11.55 },
  "vestry": { "x0": -15.95, "z0": 0.05, "z1": 3.75, "eave": 2.85, "ridge": 4.25 }
} as const;
/** Faces: nave_n and tower_n are the SSW (-z) walls, nave_s, tower_s and vestry_s the NNE (+z) walls. On a long wall
 * `u` is x; on the front gable (west) and the tower front (tower_w) `u` is z. `y0` and `y1` are heights above the
 * ground at the origin; an arch's `y1` is where its round head starts. */
export const CHURCH_FEATURES = {
  "openings": [
    { "kind": "door", "face": "tower_w", "u": 0.02, "y0": 0.4, "y1": 2.4, "w": 0.95 },
    { "kind": "arch", "face": "nave_n", "u": -9.49, "y0": 1.3, "y1": 3.0, "w": 0.9 },
    { "kind": "arch", "face": "nave_n", "u": -6.49, "y0": 1.3, "y1": 3.0, "w": 0.9 },
    { "kind": "arch", "face": "nave_n", "u": -3.38, "y0": 1.3, "y1": 3.0, "w": 0.9 },
    { "kind": "arch", "face": "nave_s", "u": -9.84, "y0": 1.3, "y1": 3.0, "w": 0.9 },
    { "kind": "arch", "face": "nave_s", "u": -6.57, "y0": 1.3, "y1": 3.0, "w": 0.9 },
    { "kind": "arch", "face": "nave_s", "u": -3.63, "y0": 1.3, "y1": 3.0, "w": 0.9 },
    { "kind": "rect", "face": "west", "u": 1.51, "y0": 4.82, "y1": 5.9, "w": 0.62 },
    { "kind": "rect", "face": "west", "u": -1.28, "y0": 4.82, "y1": 5.9, "w": 0.62 },
    { "kind": "sign", "face": "west", "u": 2.64, "y0": 1.36, "y1": 2.3, "w": 2.4 },
    { "kind": "rect", "face": "tower_w", "u": 0.14, "y0": 8.0, "y1": 8.45, "w": 0.7 },
    { "kind": "arch", "face": "tower_s", "u": 0.97, "y0": 1.3, "y1": 2.67, "w": 0.65 },
    { "kind": "door", "face": "tower_n", "u": 1.08, "y0": 0.4, "y1": 2.4, "w": 0.95 },
    { "kind": "door", "face": "vestry_s", "u": -13.6, "y0": 0.45, "y1": 2.26, "w": 0.8 },
    { "kind": "rect", "face": "vestry_s", "u": -14.81, "y0": 1.28, "y1": 2.38, "w": 0.67 },
    { "kind": "rect", "face": "vestry_n", "u": -14.0, "y0": 1.28, "y1": 2.38, "w": 0.67 }
  ],
  "steps": { "face": "tower_w", "u": 0.02, "width": 1.3, "rise": 0.4, "run": 1.5, "count": 3 },
  /** From the tower's side door along the front gable, down to the ground. */
  "ramp": { "face": "tower_n", "u": 1.05, "width": 1.2, "rise": 0.4, "run": 3.5 },
  /** The landing at the vestry's side door. */
  "landing": { "face": "vestry_s", "u": -13.6, "width": 1.2, "depth": 1.2, "rise": 0.45 }
} as const;

/**
 * What stands on the grounds, in model metres, from the same scan: the row of rocks along the lot, a rock beside the
 * lane, the granite monument in front, and the tall wayside cross on the lane. `h` is the height above the ground, `w`
 * and `t` the footprint, `ry` the turn in the model frame (for the rocks it only varies their look). The wayside cross
 * faces bearing 85.8 degrees, toward the lane, so its arms run along bearing 175.8: ry = 297.65 - 175.8 degrees.
 * The last twelve rocks lie outside the scan: they keep the positions from the owner's earlier drone model.
 */
export const CHURCH_GROUNDS = {
  "rocks": [
    [19.56, 7.69, 0.18, 0.43, 0.31, 0.5], [18.23, 7.46, 0.18, 0.26, 0.24, 1.9], [16.49, 7.08, 0.31, 0.77, 0.65, 3.1],
    [14.19, 6.6, 0.31, 0.88, 0.69, 0.3], [11.55, 6.33, 0.42, 0.86, 0.61, 2.2], [9.4, 6.18, 0.21, 0.95, 0.87, 1.2],
    [7.63, 5.8, 0.24, 0.96, 0.85, 2.6], [5.83, 5.71, 0.34, 0.85, 0.74, 0.8], [4.48, 5.35, 0.25, 0.94, 0.9, 1.7],
    [1.28, 5.01, 0.32, 0.88, 0.78, 2.9], [-40.43, -34.7, 0.76, 2.14, 1.77, 1.3],
    [22.2, 7.9, 0.3, 0.9, 0.7, 0.4], [23.78, 8.14, 0.3, 0.9, 0.7, 2.4], [26.23, 8.64, 0.3, 0.9, 0.7, 1.1],
    [7.26, 18.1, 0.3, 0.9, 0.7, 2.0], [10.75, 17.01, 0.3, 0.9, 0.7, 0.2], [12.92, 16.58, 0.3, 0.9, 0.7, 2.7],
    [16.48, 15.69, 0.3, 0.9, 0.7, 1.5], [18.19, 14.94, 0.3, 0.9, 0.7, 0.9], [20.23, 14.46, 0.3, 0.9, 0.7, 2.2],
    [22.2, 13.97, 0.3, 0.9, 0.7, 0.6], [24.17, 13.02, 0.3, 0.9, 0.7, 1.8], [26.08, 12.21, 0.3, 0.9, 0.7, 2.9]
  ],
  "monument": { "x": 11.85, "z": 0.78, "h": 1.99, "w": 0.85 },
  "wayside": { "x": -42.47, "z": -39.9, "h": 4.25, "arm": 1.6, "armAt": 3.25, "ry": 2.13 }
} as const;

/**
 * The mown lane from behind the church to the cemetery gap, in model metres: the middle of the ground the scan
 * walked, steered round the wayside cross. The scan strip is as wide as the phone could see, so the mown width
 * is an estimate from the dash cam stills.
 */
export const CHURCH_LANE = {
  half: 2.0,
  pts: [[-13.45, -3.88], [-16.71, -8.38], [-20.58, -14.26], [-25.13, -18.65], [-29.6, -23.08], [-33.98, -27.56],
    [-36.41, -33.06], [-38.57, -38.7], [-41.71, -43.83], [-45.29, -48.72], [-49.18, -53.12], [-50.5, -54.35]]
} as const;
/** The gravel lot by the road (from the owner's drone model), in model metres: x0, z0, x1, z1. */
const LOT = [4.0, 6.3, 26.5, 16.8] as const;

/** Baked road 99, point 939: 80 m along River Denys Road before its nearest church approach.
 * The stored segment runs toward the church; heading is its precomputed angle, clockwise from north in radians. */
export const CHURCH_START = { e: 630770.2, n: 5080667.56, road: 'River Denys Road', heading: 1.4629045852966263 };

/** Distance from a point to the lane's middle line, in model metres. */
export function laneDistance(x: number, z: number): number {
  let best = Infinity;
  const p = CHURCH_LANE.pts;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], dx = p[i][0] - ax, dz = p[i][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

export class ChurchSite implements Site {
  private readonly sin = Math.sin(CHURCH_HEADING);
  private readonly cos = Math.cos(CHURCH_HEADING);
  readonly yaw = Math.PI / 2 - CHURCH_HEADING;
  readonly origin: { x: number; z: number };
  readonly box: [number, number, number, number];
  readonly clear: number[][];
  readonly solids: Solid[];
  readonly visualGravel = true;
  constructor(village: readonly [number, number]) {
    this.origin = { x: CHURCH_ORIGIN[0] - village[0], z: village[1] - CHURCH_ORIGIN[1] };
    const bounds = (x0: number, z0: number, x1: number, z1: number): [number, number, number, number] => {
      const p = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => this.world(x, z));
      return [Math.min(...p.map(p => p.x)), Math.min(...p.map(p => p.z)), Math.max(...p.map(p => p.x)), Math.max(...p.map(p => p.z))];
    };
    const lane = CHURCH_LANE.pts, edge = CHURCH_LANE.half + 1.5;
    const laneBox = bounds(Math.min(...lane.map(p => p[0])) - edge, Math.min(...lane.map(p => p[1])) - edge,
      Math.max(...lane.map(p => p[0])) + edge, Math.max(...lane.map(p => p[1])) + edge);
    const yard = bounds(-21, -7.5, 28, 20);
    this.box = [Math.min(yard[0], laneBox[0]), Math.min(yard[1], laneBox[1]), Math.max(yard[2], laneBox[2]), Math.max(yard[3], laneBox[3])];
    const { nave: n, tower: t, vestry: v } = CHURCH_GEOM, { steps: st, ramp, landing } = CHURCH_FEATURES;
    const { monument: m, wayside: w } = CHURCH_GROUNDS, big = CHURCH_GROUNDS.rocks[10];
    // The church and the lot, then a small clearing round each solid that stands on open ground, so no tree grows through it.
    const around = (x: number, z: number, r: number) => bounds(x - r, z - r, x + r, z + r);
    this.clear = [bounds(v.x0 - 1, -t.zn - ramp.run - 0.6, t.x1 + st.run + 0.5, n.zs + 1.6), bounds(LOT[0], LOT[1], LOT[2], LOT[3]),
      around(m.x, m.z, 1.5), around(w.x, w.z, 1.5), around(big[0], big[1], 2)];
    const solid = (x0: number, x1: number, z0: number, z1: number): Solid => ({
      ...this.world((x0 + x1) / 2, (z0 + z1) / 2), half: (x1 - x0) * CHURCH_SCALE / 2,
      halfWidth: (z1 - z0) * CHURCH_SCALE / 2, heading: CHURCH_HEADING,
    });
    this.solids = [solid(n.x0, n.x1, -n.zn, n.zs), solid(n.x1, t.x1, -t.zn, t.zs), solid(v.x0, n.x0, v.z0, v.z1),
      solid(t.x1, t.x1 + st.run, st.u - st.width / 2 - 0.1, st.u + st.width / 2 + 0.1),
      solid(ramp.u - ramp.width / 2 - 0.1, ramp.u + ramp.width / 2 + 0.1, -t.zn - ramp.run, -t.zn),
      solid(landing.u - landing.width / 2 - 0.1, landing.u + landing.width / 2 + 0.1, v.z1, v.z1 + landing.depth),
      solid(m.x - m.w / 2, m.x + m.w / 2, m.z - m.w / 2, m.z + m.w / 2),
      solid(w.x - 0.3, w.x + 0.3, w.z - 0.3, w.z + 0.3),
      solid(big[0] - big[3] / 2, big[0] + big[3] / 2, big[1] - big[4] / 2, big[1] + big[4] / 2)];
  }
  /** Model metres to game metres. +X -> WNW (297.65°), +Z -> NNE (27.65°). */
  world(x: number, z: number): { x: number; z: number } {
    return { x: this.origin.x + CHURCH_SCALE * (x * this.sin + z * this.cos), z: this.origin.z + CHURCH_SCALE * (-x * this.cos + z * this.sin) };
  }
  local(x: number, z: number): { x: number; z: number } {
    const dx = (x - this.origin.x) / CHURCH_SCALE, dz = (z - this.origin.z) / CHURCH_SCALE;
    return { x: dx * this.sin - dz * this.cos, z: dx * this.cos + dz * this.sin };
  }
  /**
   * Replace the surveyed footprint by position; bake IDs can change. A split building is a group: only its largest
   * wing carries the original site, so one wing on the spot takes the whole group with it.
   */
  buildings(list: Building[]): Building[] {
    const onSpot = (b: Building) => { const c = b.site ?? b; return (c.x - 630844.2) ** 2 + (c.y - 5080637.2) ** 2 <= 8 ** 2; };
    const groups = new Set(list.filter(onSpot).map(b => b.buildingId ?? b.id));
    return list.filter(b => !onSpot(b) && !groups.has(b.buildingId ?? b.id));
  }
  height(_x: number, _z: number, surveyed: number): number { return surveyed; }
  /** The mown lane is lawn (kind 12, driven as grass); the lot is visual gravel (kind 11). */
  surface(x: number, z: number): { dist: number; half: number; kind: number } | null {
    const p = this.local(x, z), lane = laneDistance(p.x, p.z);
    if (lane < CHURCH_LANE.half + 1) return { dist: lane, half: CHURCH_LANE.half, kind: 12 };
    const depth = Math.min(p.x - LOT[0], LOT[2] - p.x, p.z - LOT[1], LOT[3] - p.z) * CHURCH_SCALE;
    return depth > -0.8 ? { dist: 10 - Math.min(3.5, depth), half: 10, kind: 11 } : null;
  }
  /** No trees on the mown lane. */
  clearCanopy(x: number, z: number): boolean {
    const p = this.local(x, z);
    return laneDistance(p.x, p.z) < CHURCH_LANE.half + 1;
  }
}
