import type { Building } from './buildings';
import { depth } from './home-site';
import type { Site } from './terrain';

/**
 * The house on D.R.'s Lane (Judique area), built by hand in place of its surveyed box (drlane-house.ts), and the yard
 * around it: a level pad, the mown lawn, the gravel drive to the north-west end and the gravel apron at the shed.
 *
 * The place is not written here. It comes from the surveyed building record: the middle of the survey's box, its long
 * axis and the level of its ground. If a new survey changes that record, the place is left as the survey has it.
 *
 * House axes: u runs along the survey's long axis, toward the south-east end with the taller part; v runs across it,
 * toward the lane (south-west). All layout in drlane-house.ts is in these metres, from the middle of the surveyed box.
 */
type P = [number, number];

/** The game's number for the surveyed box, the size that box must still have, and its axis (the house is not the same at both ends). */
const BUILDING = 273, LENGTH = 24.05, WIDTH = 11.83, AXIS = 145;

/** Level ground under the house, its deck and the shed, and how far the slope around it blends back to the survey. */
const PAD: P[] = [[-11, -5.5], [11.5, -5.5], [11.5, 10.5], [14.2, 10.5], [14.2, 19.2], [6.8, 19.2], [6.8, 8], [-11, 8]];
const PAD_MARGIN = 4;
/** The drive: from the lane to the gravel in front of the north-west end. Its middle line, then the gravel there. */
export const DRIVE: P[] = [[-9.4, 32.5], [-9.3, 24], [-9.0, 14]];
const DRIVE_HALF = 1.6;
const DRIVE_PAD: P[] = [[-12.6, 5.3], [-5.6, 5.3], [-5.6, 9], [-7.6, 14.5], [-10.6, 14.5], [-12.6, 11.5]];
/** The gravel apron in front of the shed, open to the lane, where a car can turn. */
export const APRON: P[] = [[7.9, 17.9], [13.8, 17.9], [16.2, 25], [17.2, 31.9], [3.6, 31.9], [5.4, 25.5], [7.9, 21]];
/** The garden bed along the lane, edged with stones on both sides. */
export const BED: P[] = [[-6.6, 30.4], [3.2, 30.4], [4.6, 27.8], [3.4, 24.6], [-0.6, 23.2], [-4.6, 22.6], [-6.6, 23.8]];
/** Mown grass: the lawn round the house, from the trees at the back to the lane. */
const LAWN: P[] = [[-11.5, -7.5], [15, -7.5], [15.5, 10], [16.5, 18], [18, 31.8], [-7.6, 31.8], [-7.4, 16], [-11.2, 16], [-11.8, 4]];

const GRAVEL = 8, GRASS = 12;   // road-field kinds: 8 is the even stone of a yard, 12 is mown grass
const EDGE = 1.8;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Distance to a line of points. */
function along(pts: readonly P[], u: number, v: number): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [au, av] = pts[i - 1], [bu, bv] = pts[i], du = bu - au, dv = bv - av;
    const t = Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / (du * du + dv * dv || 1)));
    best = Math.min(best, Math.hypot(u - au - du * t, v - av - dv * t));
  }
  return best;
}

export class DrLaneSite implements Site {
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands: the house, the shed and the open yard. */
  readonly clear: number[][] = [];
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw: number;
  /** The level of the pad, in true metres above the sea. */
  readonly level: number;
  /** The lane keeps its own height and surface: the yard stops at its edge. */
  readonly preserveRoads = true;
  private ox: number; private oz: number; private sin: number; private cos: number;

  /** The surveyed box of this house, or null when the survey no longer has it as it was. */
  static find(list: readonly Building[]): Building | null {
    const b = list.find((b) => b.id === BUILDING);
    return b && b.kind === 'house' && Math.abs(b.length - LENGTH) < 1 && Math.abs(b.width - WIDTH) < 1 && Math.abs(b.axisDeg - AXIS) < 5 ? b : null;
  }

  constructor(building: Building, village: readonly [number, number]) {
    const axis = (building.axisDeg * Math.PI) / 180;
    this.sin = Math.sin(axis); this.cos = Math.cos(axis);
    this.yaw = Math.PI / 2 - axis;
    this.ox = building.x - village[0]; this.oz = village[1] - building.y;
    this.origin = Object.freeze({ x: this.ox, z: this.oz });
    this.level = building.ground;
    const corners = [this.world(-24, -14), this.world(24, -14), this.world(24, 36), this.world(-24, 36)];
    this.box = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z))];
    // Tree-free strips, 3 m deep, over the lawn and the gravel. The trees at the back and the grove past the drive stay.
    const step = 1.5, strip = 3;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && (depth(LAWN, u, v) > -0.5 || depth(DRIVE_PAD, u, v) > -1 || along(DRIVE, u, v) < DRIVE_HALF + 1);
        if (open && start === null) start = x;
        if (!open && start !== null) { this.clear.push([start - step, z, x, z + strip]); start = null; }
      }
    }
  }

  /** House metres to world metres. */
  world(u: number, v: number): { x: number; z: number } { return { x: this.ox + u * this.sin + v * this.cos, z: this.oz - u * this.cos + v * this.sin }; }
  local(x: number, z: number): { u: number; v: number } {
    const dx = x - this.ox, dz = z - this.oz;
    return { u: dx * this.sin - dz * this.cos, v: dx * this.cos + dz * this.sin };
  }
  /** The middle of the surveyed box. One object for the whole visit: the house reads it every frame. */
  readonly origin: { readonly x: number; readonly z: number };
  /** Compass heading (clockwise from north) of a direction given in house axes. */
  heading(du: number, dv: number): number { return Math.atan2(du * this.sin + dv * this.cos, du * this.cos - dv * this.sin); }

  height(x: number, z: number, surveyed: number): number {
    const { u, v } = this.local(x, z);
    const d = depth(PAD, u, v);
    if (d <= -PAD_MARGIN) return surveyed;
    return this.level + (surveyed - this.level) * (d >= 0 ? 0 : smooth(0, PAD_MARGIN, -d));
  }

  surface(x: number, z: number): { dist: number; half: number; kind: number } | null {
    const { u, v } = this.local(x, z);
    if (u < -16 || u > 21 || v < -11 || v > 32.5) return null;
    // Earlier surfaces win where two overlap: the drive, its gravel by the house, the apron, then the lawn.
    let kind = 0, deep = -EDGE, inside = false;
    const take = (d: number, k: number) => {
      if (d <= -EDGE) return;
      if (d >= 0 && !inside) { inside = true; kind = k; }
      if (!inside && d > deep) kind = k;
      if (d > deep) deep = d;
    };
    take(DRIVE_HALF - along(DRIVE, u, v), GRAVEL);
    take(depth(DRIVE_PAD, u, v), GRAVEL);
    take(depth(APRON, u, v), GRAVEL);
    take(depth(LAWN, u, v), GRASS);
    // As in the house yard at Judique: the field reads as a road ten metres to a side whose edge is the surface's edge.
    return kind ? { dist: Math.max(6.5, 10 - deep), half: 10, kind } : null;
  }
}
