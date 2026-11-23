import type { Building } from './buildings';
import { depth } from './home-site';
import type { Site } from './terrain';

/**
 * A house on Prince Street, Port Hawkesbury (Point Tupper area), built by hand in place of its surveyed box
 * (prince-house.ts), with its yard: a level pad under the house, carport and shed, the mown lawn, and the straight
 * driveway from Prince Street into the carport.
 *
 * The place is not written here. It comes from the surveyed building record: the middle of the survey's box, its long
 * axis and the level of its ground. If a new survey changes that record, the place is left as the survey has it.
 *
 * House axes: u runs along the survey's long axis (south-east along Prince Street, toward the carport); v runs across
 * it, away from Prince Street (south-west, toward the backyard; Prince Street lies on -v). All layout in
 * prince-house.ts is in these metres, from the middle of the surveyed box.
 */
type P = [number, number];

/** The game's number for the surveyed box, the size that box must still have, its axis, and a nearby Prince Street road point. */
export const PRINCE_BUILDING = 1308;
const LENGTH = 17.01, WIDTH = 11.09, AXIS = 142;
const STREET_REF: P = [627652, 5053009];
const STREET_REACH = 45;

/** Level ground under the house, front deck, carport and backyard shed; outside it blends back to the lot's slope. */
const PAD: P[] = [[-8.6, -6.8], [8.8, -6.8], [8.8, 4.4], [6.6, 4.4], [6.6, 13.5], [1.6, 13.5], [1.6, 7.6], [-8.6, 7.6]];
const PAD_MARGIN = 3.5;

/** The driveway: straight from the edge of Prince Street into the carport (inset slightly so terrain cells stay under the draped surface). */
export const DRIVE: P[] = [[3.3, -18.4], [6.9, -18.4], [6.8, -15.5], [6.8, 3.4], [3.4, 3.4], [3.4, -15.5]];
/** Mown lawn across the front, sides and backyard, keeping clear of the neighbouring lots and Prince Street. */
export const LAWN: P[] = [[-9.5, -18.8], [17.5, -18.8], [17.5, 16.5], [-9.5, 16.5]];

const GRAVEL = 8, GRASS = 12;   // road-field kinds: 8 is weathered yard gravel/stone, 12 is mown grass
const EDGE = 1.6;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class PrinceSite implements Site {
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands: the house, carport, shed, driveway and open lawn. */
  readonly clear: number[][] = [];
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw: number;
  /** The level of the pad, in true metres above the sea. */
  readonly level: number;
  /** Prince Street keeps its own height and asphalt surface: the yard stops at its edge. */
  readonly preserveRoads = true;
  private ox: number; private oz: number; private sin: number; private cos: number;
  private bx: number; private by: number; private axisDeg: number;

  /** The surveyed box of this house, or null when the survey no longer has it where and as it was. */
  static find(list: readonly Building[]): Building | null {
    const b = list.find((b) => b.id === PRINCE_BUILDING);
    return b && b.kind === 'house'
      && Math.hypot(b.x - STREET_REF[0], b.y - STREET_REF[1]) < STREET_REACH
      && Math.abs(b.length - LENGTH) < 1 && Math.abs(b.width - WIDTH) < 1 && Math.abs(b.axisDeg - AXIS) < 5
      ? b : null;
  }

  constructor(building: Building, village: readonly [number, number]) {
    const axis = (building.axisDeg * Math.PI) / 180;
    this.sin = Math.sin(axis); this.cos = Math.cos(axis);
    this.yaw = Math.PI / 2 - axis;
    this.bx = building.x; this.by = building.y; this.axisDeg = building.axisDeg;
    this.ox = building.x - village[0]; this.oz = village[1] - building.y;
    this.origin = Object.freeze({ x: this.ox, z: this.oz });
    this.level = building.ground;
    const corners = [this.world(-11.5, -20.5), this.world(19.5, -20.5), this.world(19.5, 18.5), this.world(-11.5, 18.5)];
    this.box = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z))];
    // Tree-free strips, 3 m deep, across the lawn, house, carport, shed and driveway. Mature trees behind the yard stay.
    const step = 1.5, strip = 3;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && (depth(LAWN, u, v) > -0.5 || depth(DRIVE, u, v) > -0.5);
        if (open && start === null) start = x;
        if (!open && start !== null) { this.clear.push([start - step, z, x, z + strip]); start = null; }
      }
    }
  }

  /** House metres to world metres. */
  world(u: number, v: number): { x: number; z: number } { return { x: this.ox + u * this.sin + v * this.cos, z: this.oz - u * this.cos + v * this.sin }; }
  /** House metres to EPSG:2961 map metres. */
  map(u: number, v: number): [number, number] { return [this.bx + u * this.sin + v * this.cos, this.by + u * this.cos - v * this.sin]; }
  local(x: number, z: number): { u: number; v: number } {
    const dx = x - this.ox, dz = z - this.oz;
    return { u: dx * this.sin - dz * this.cos, v: dx * this.cos + dz * this.sin };
  }
  /** The middle of the surveyed box. One object for the whole visit: the house reads it every frame. */
  readonly origin: { readonly x: number; readonly z: number };
  /** Compass heading (clockwise from north) of a direction given in house axes. */
  heading(du: number, dv: number): number { return Math.atan2(du * this.sin + dv * this.cos, du * this.cos - dv * this.sin); }

  /** Re-aim the house's service drop onto the upper south-east gable wall, matching the real attachment. */
  aimDrops<T extends { building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }>(drops: T[]): T[] {
    const [x, y] = this.map(1.5, -3.7);
    return drops.map((d) => (d.building === PRINCE_BUILDING ? { ...d, x, y, height: 4.65, ground: this.level, groundX: this.bx, groundY: this.by } : d));
  }

  /** Roof boxes for the drone flight floor: main house, chimney, rear lean-to wing, carport and backyard shed. */
  roofBoxes(): Pick<Building, 'x' | 'y' | 'ground' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge'>[] {
    const box = (u0: number, u1: number, v0: number, v1: number, eave: number, ridge: number) => {
      const [x, y] = this.map((u0 + u1) / 2, (v0 + v1) / 2);
      return { x, y, ground: this.level, axisDeg: this.axisDeg, length: u1 - u0, width: v1 - v0, eave, ridge };
    };
    return [
      box(-7.5, 1.5, -5.5, 4.1, 5.15, 7.56),   // main house and front vestibule
      box(-8.2, -7.5, -2.2, -0.7, 8.6, 8.6),   // exterior NW brick chimney
      box(-7.5, 1.5, 4.1, 6.7, 2.85, 4.48),    // rear 1-storey lean-to wing
      box(1.5, 8.2, -5.5, 3.5, 2.7, 4.14),     // attached SE carport
      box(3.0, 6.6, 8.0, 12.8, 2.15, 3.4),     // detached backyard shed
    ];
  }

  height(x: number, z: number, surveyed: number): number {
    const { u, v } = this.local(x, z);
    const d = depth(PAD, u, v);
    if (d <= -PAD_MARGIN) return surveyed;
    return this.level + (surveyed - this.level) * (d >= 0 ? 0 : smooth(0, PAD_MARGIN, -d));
  }

  surface(x: number, z: number): { dist: number; half: number; kind: number } | null {
    const { u, v } = this.local(x, z);
    if (u < -11.5 || u > 19.5 || v < -20.5 || v > 18.5) return null;
    // Earlier surfaces win where two overlap: the driveway, then the mown lawn.
    let kind = 0, deep = -EDGE, inside = false;
    const take = (d: number, k: number) => {
      if (d <= -EDGE) return;
      if (d >= 0 && !inside) { inside = true; kind = k; }
      if (!inside && d > deep) kind = k;
      if (d > deep) deep = d;
    };
    take(depth(DRIVE, u, v), GRAVEL);
    take(depth(LAWN, u, v), GRASS);
    return kind ? { dist: Math.max(6.5, 10 - deep), half: 10, kind } : null;
  }
}
