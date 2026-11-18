import type { Site } from './terrain';

/**
 * Red Roof by the Brook in Judique. This site clears trees for the lawn, adjusts the brook's bed,
 * and adds the driveway, grass and rock wall around the modelled house.
 *
 * House axes: u runs along the house toward its north end, v runs across it toward the brook (east-north-east).
 * All layout in home.ts is written in these metres, from the middle of the house.
 */
const ORIGIN_E = 618687.3, ORIGIN_N = 5074423.9, AXIS = (345.7 * Math.PI) / 180;
const SIN = Math.sin(AXIS), COS = Math.cos(AXIS);

type P = [number, number];

/** The house body: 66 ft by 16 ft. */
export const HOUSE = { length: 20.12, width: 4.88 };
/** The lawn's level under the house, in true metres above the sea. */
export const PAD = 20.6;

/** The old cottage and the small shed, which the survey measured as one box. */
export const COTTAGE = { u: 6.75, v: -19.9, du: -0.452, dv: 0.893, length: 8.0, width: 6.3 };
export const SHED = { u: -0.3, v: -13.8, du: -0.916, dv: -0.401, length: 3.6, width: 2.5 };

/** The brook as it runs now: [u, v, bed level in true metres]. It flows toward the first point. */
export const BROOK: [number, number, number][] = [
  [40, -43.5, 17.95], [42, -30, 18.05], [41, -15, 18.3], [38, -3, 18.4], [33, 5, 18.55], [28, 7.9, 18.6], [24.6, 9.1, 18.65],
  [19.5, 9, 18.7], [15.5, 11.7, 18.74], [12, 14.1, 18.76], [8.4, 16.9, 18.8], [4.8, 19.7, 18.95], [1.5, 23, 19.1],
  [-1.7, 27.1, 19.2], [-6.7, 26.9, 19.23], [-12.5, 29, 19.26], [-23, 35, 19.3], [-34.1, 40.8, 19.5],
];
/** Half the width of the flat bed, and how far the banks reach. */
export const BROOK_BED = 2.4, BROOK_BANK = 6.5;
/** The rock wall between the lawn and the brook. */
export const RIPRAP: P[] = [[12.8, 6], [10.7, 8], [8.2, 9.4], [4.9, 11.1], [2, 12.8], [-0.2, 15.1], [-3, 17.7], [-4.5, 19.8], [-7.1, 22.5]];

/** The driveway's middle line, from the end of the public road to the door. */
export const DRIVE: P[] = [[25.5, -20.6], [24.1, -22], [21.9, -18.5], [20, -14.8], [17.7, -11.7], [15, -9.1], [11.6, -7.1], [9.3, -6]];
const DRIVE_HALF = 1.7;
const DRIVE_PAD: P[] = [[15.5, -7.2], [14.6, -3.4], [11, -2.9], [6.2, -3.1], [6.3, -7.4], [9.5, -9.2], [13.2, -9.4]];

/** Mown grass. */
const LAWN: P[] = [[22, -9], [18, -2.5], [13.5, 5.2], [10.5, 7.3], [5, 10.3], [1.8, 12.1], [-0.4, 14.4], [-3.2, 17], [-7.5, 21.2],
  [-17, 13], [-22, 13], [-33, 13.5], [-34, -8], [-27.5, -15], [-12, -13], [0, -10.5], [4, -11], [10, -12.5], [16, -13]];
/** The ground that was levelled for the house. */
const GRADE: P[] = [[15, -9], [13, 4.3], [9.5, 6.8], [4.5, 9.8], [1.5, 11.6], [-1, 13.8], [-4, 16.4], [-8, 20.3], [-17, 12], [-18, -7], [-6, -9], [4, -9.5]];
const GRADE_MARGIN = 3;
/** Everything that has been cleared since the survey: no forest here, only the trees home.ts plants. */
const CLEARED: P[] = [[30.4, -90], [29.8, -51.5], [28.6, -18.8], [34, 6], [22, 31.4], [-15.7, 33], [-52.8, 29.6], [-48.6, 0.7], [-38.3, -27.6],
  [-26.5, -53.5], [-16.2, -73.6], [-4.5, -95]];

const GRAVEL = 8, GRASS = 12;   // road-field kinds: 8 is the even stone of a yard, 12 is mown grass

/** Signed distance to a polygon's edge: positive inside. */
export function depth(pts: P[], u: number, v: number): number {
  let inside = false, best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [au, av] = pts[j], [bu, bv] = pts[i];
    if ((av > v) !== (bv > v) && u < ((bu - au) * (v - av)) / (bv - av) + au) inside = !inside;
    const du = bu - au, dv = bv - av;
    const t = Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / (du * du + dv * dv || 1)));
    const d = Math.hypot(u - au - du * t, v - av - dv * t);
    if (d < best) best = d;
  }
  return inside ? best : -best;
}
/** Distance to a line of points. */
function along(pts: readonly (readonly number[])[], u: number, v: number): { d: number; i: number; t: number } {
  let best = { d: Infinity, i: 0, t: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [au, av] = pts[i - 1], [bu, bv] = pts[i], du = bu - au, dv = bv - av;
    const t = Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / (du * du + dv * dv || 1)));
    const d = Math.hypot(u - au - du * t, v - av - dv * t);
    if (d < best.d) best = { d, i, t };
  }
  return best;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const boxOf = (pts: readonly (readonly number[])[], pad: number): [number, number, number, number] =>
  [Math.min(...pts.map((p) => p[0])) - pad, Math.min(...pts.map((p) => p[1])) - pad, Math.max(...pts.map((p) => p[0])) + pad, Math.max(...pts.map((p) => p[1])) + pad];
const within = (b: [number, number, number, number], u: number, v: number) => u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3];

const BROOK_BOX = boxOf(BROOK, BROOK_BANK), GRADE_BOX = boxOf(GRADE, GRADE_MARGIN), DRIVE_BOX = boxOf(DRIVE, DRIVE_HALF + 2);
const SURFACES: { kind: number; pts: P[]; box: [number, number, number, number] }[] =
  [DRIVE_PAD].map((pts) => ({ kind: GRAVEL, pts, box: boxOf(pts, 2) })).concat([{ kind: GRASS, pts: LAWN, box: boxOf(LAWN, 2) }]);
const EDGE = 1.8;

export class HomeSite implements Site {
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands. */
  readonly clear: number[][] = [];
  private ox: number; private oz: number;
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw = Math.PI / 2 - AXIS;

  constructor(village: readonly [number, number]) {
    this.ox = ORIGIN_E - village[0]; this.oz = village[1] - ORIGIN_N;
    const corners = [this.world(-60, -100), this.world(50, -100), this.world(50, 50), this.world(-60, 50)];
    this.box = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z))];
    // Tree-free strips, 4 m deep, over the cleared land and the brook.
    const step = 2, strip = 4;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && (depth(CLEARED, u, v) > 0 || (within(BROOK_BOX, u, v) && along(BROOK, u, v).d < BROOK_BED + 2));
        if (open && start === null) start = x;
        if (!open && start !== null) { this.clear.push([start - step, z, x, z + strip]); start = null; }
      }
    }
  }

  /** House metres to world metres. */
  world(u: number, v: number): { x: number; z: number } { return { x: this.ox + u * SIN + v * COS, z: this.oz - u * COS + v * SIN }; }
  local(x: number, z: number): { u: number; v: number } {
    const dx = x - this.ox, dz = z - this.oz;
    return { u: dx * SIN - dz * COS, v: dx * COS + dz * SIN };
  }
  get origin(): { x: number; z: number } { return { x: this.ox, z: this.oz }; }
  /** Compass heading (clockwise from north) of a direction given in house axes. */
  heading(du: number, dv: number): number { return Math.atan2(du * SIN + dv * COS, du * COS - dv * SIN); }
  /** True height of the brook's water at a point near it. */
  brookLevel(u: number, v: number): number {
    const hit = along(BROOK, u, v);
    return BROOK[hit.i - 1][2] + (BROOK[hit.i][2] - BROOK[hit.i - 1][2]) * hit.t + 0.14;
  }

  height(x: number, z: number, surveyed: number): number {
    const { u, v } = this.local(x, z);
    let h = surveyed;
    if (within(GRADE_BOX, u, v)) {
      const d = depth(GRADE, u, v);
      if (d > -GRADE_MARGIN) h = PAD + (h - PAD) * (d >= 0 ? 0 : smooth(0, GRADE_MARGIN, -d));
    }
    if (within(DRIVE_BOX, u, v)) {
      // The driveway climbs evenly from the road to the lawn; the survey has an old bank across its line.
      const hit = along(DRIVE, u, v);
      if (hit.d < DRIVE_HALF + 3) {
        const s = (hit.i - 1 + hit.t) / (DRIVE.length - 1), level = 19.7 + (PAD - 19.7) * smooth(0, 1, s);
        h = level + (h - level) * smooth(DRIVE_HALF + 0.5, DRIVE_HALF + 3, hit.d);
      }
    }
    if (within(BROOK_BOX, u, v)) {
      const hit = along(BROOK, u, v);
      if (hit.d < BROOK_BANK) {
        const bed = BROOK[hit.i - 1][2] + (BROOK[hit.i][2] - BROOK[hit.i - 1][2]) * hit.t;
        // The cut ends in the surveyed ground: over the last two metres the limit rises out of reach.
        h = Math.min(h, bed + 1.9 * smooth(BROOK_BED, BROOK_BANK, hit.d) + 8 * smooth(BROOK_BANK - 2, BROOK_BANK, hit.d));
      }
    }
    return h;
  }

  surface(x: number, z: number): { dist: number; half: number; kind: number } | null {
    const { u, v } = this.local(x, z);
    let kind = 0, deep = -EDGE, inside = false;
    // Earlier surfaces win where two overlap: the driveway, then the gravel at the door, then the lawn.
    const take = (d: number, k: number) => {
      if (d <= -EDGE) return;
      if (d >= 0 && !inside) { inside = true; kind = k; }
      if (!inside && d > deep) kind = k;
      if (d > deep) deep = d;
    };
    if (within(DRIVE_BOX, u, v)) take(DRIVE_HALF - along(DRIVE, u, v).d, GRAVEL);
    for (const a of SURFACES) if (within(a.box, u, v)) take(depth(a.pts, u, v), a.kind);
    // As in the works yard: the field reads as a road ten metres to a side whose edge is the edge of the surface.
    return kind ? { dist: Math.max(6.5, 10 - deep), half: 10, kind } : null;
  }
}
