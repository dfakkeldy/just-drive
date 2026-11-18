import type { Building } from './buildings';
import { depth } from './home-site';
import type { Site } from './terrain';

/**
 * One house at the end of Beaton Road (Mabou area), improved by hand so that it looks like the real one
 * (porch-house.ts), and the ground around it: a level pad under the house and a mown lawn.
 *
 * The place is not written here. It comes from the surveyed building record: the middle of the survey's box, its
 * long axis and the level of its ground. If a new survey changes that record, the place is left as the survey has it.
 *
 * House axes: u runs along the survey's long axis, toward the road (north-north-east); v runs across it
 * (east-south-east). All layout in porch-house.ts is in these metres, from the middle of the surveyed box.
 */
type P = [number, number];

/** The game's number for the surveyed box, and the size that box must still have. */
const BUILDING = 1337, LENGTH = 15.3, WIDTH = 10.9;

/** The ground that is level under the house and its porch, and how far the slope around it blends back to the survey. */
const PAD: P[] = [[9, -7.5], [9, 7], [-9, 7], [-9, -7.5]];
const PAD_MARGIN = 4.5;
/** Mown grass: from the edge of the road to the fence behind the house. */
const LAWN: P[] = [[13.4, -23], [13.6, -4], [13.2, 9.5], [6, 12], [-10, 12], [-19, 9], [-19, 2], [-12, -14], [-4, -23]];
/** The white board fence along the lawn's far side. */
export const FENCE: P[] = [[12, -24], [-4, -23], [-12, -14], [-19, 2], [-19, 12]];

const GRASS = 12;   // road-field kind: mown grass
const EDGE = 1.8;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class PorchSite implements Site {
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands: the house and the grass close to it. */
  readonly clear: number[][] = [];
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw: number;
  /** The level of the pad, in true metres above the sea. */
  readonly level: number;
  private ox: number; private oz: number; private sin: number; private cos: number;

  /** The surveyed box of this house, or null when the survey no longer has it as it was. */
  static find(list: readonly Building[]): Building | null {
    const b = list.find((b) => b.id === BUILDING);
    return b && b.kind === 'house' && Math.abs(b.length - LENGTH) < 1 && Math.abs(b.width - WIDTH) < 1 ? b : null;
  }

  constructor(building: Building, village: readonly [number, number]) {
    const axis = (building.axisDeg * Math.PI) / 180;
    this.sin = Math.sin(axis); this.cos = Math.cos(axis);
    this.yaw = Math.PI / 2 - axis;
    this.ox = building.x - village[0]; this.oz = village[1] - building.y;
    this.origin = Object.freeze({ x: this.ox, z: this.oz });
    this.level = building.ground;
    const corners = [this.world(-24, -28), this.world(18, -28), this.world(18, 17), this.world(-24, 17)];
    this.box = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z))];
    // Tree-free strips, 3 m deep, over the house and the lawn within 6 m of it.
    const step = 1.5, strip = 3;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && depth(PAD, u, v) > -6 && depth(LAWN, u, v) > -1;
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
    const d = depth(LAWN, u, v);
    // As in the house yard at Judique: the field reads as a road ten metres to a side whose edge is the lawn's edge.
    return d > -EDGE ? { dist: Math.max(6.5, 10 - d), half: 10, kind: GRASS } : null;
  }
}
