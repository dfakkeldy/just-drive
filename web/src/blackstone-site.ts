import type { Building } from './buildings';
import { depth } from './home-site';
import type { Site } from './terrain';

/**
 * A house on Blackstone Road (Mabou area), built by hand in place of its surveyed box (blackstone-house.ts), and the
 * yard around it: a level pad under the house and decks, the mown lawn around the house and across the wide front
 * island, the gravel driveway loop and spurs to the west shed and east barn, and the roadside mailbox and drop
 * placement.
 *
 * The place is not written here. It comes from the surveyed building record: the middle of the survey's box, its long
 * axis and the level of its ground. If a new survey changes that record, the place is left as the survey has it.
 *
 * House axes: u runs along the survey's long axis (east-south-east, toward the two-storey deck, big front lawn and
 * east gambrel barn); v runs across it, away from Blackstone Road (south-south-west, toward the back woods; Blackstone
 * Road lies on -v). All layout in blackstone-house.ts is in these metres, from the middle of the surveyed box.
 */
type P = [number, number];

/** The game's number for the surveyed box, its surveyed centre, size and axis. */
export const BLACKSTONE_BUILDING = 1454;
const LENGTH = 12.42, WIDTH = 8.7, AXIS = 112;
const SITE_REF: P = [630781.27, 5109855.68];
const SITE_REACH = 5;

/** Level ground under the house, front porch and south-east two-storey deck; outside it blends back to the lot's slope. */
const PAD: P[] = [[-6.8, -8.8], [8.8, -8.8], [8.8, 5.2], [-6.8, 5.2]];
const PAD_MARGIN = 3.5;

/**
 * Gravel driveway polygons in house (u, v):
 * - main front apron from the edge of Blackstone Road past the front porch and south-east deck;
 * - west spur curving past the north-west corner of the house to the small blue shed;
 * - east spur running along the south edge of the front lawn island to the big east gambrel barn and out to the east corner.
 */
export const DRIVE_FRONT: P[] = [
  [-11.2, -22.2], [11.8, -20.2], [13.4, -13.0], [11.8, -5.8],
  [5.2, -5.8], [3.6, -9.2], [-5.8, -9.2], [-8.8, -11.5], [-11.6, -18.5],
];
export const DRIVE_WEST: P[] = [
  [-7.5, -12.5], [-4.8, -10.0], [-7.5, -5.2], [-10.5, -1.5],
  [-15.8, -2.5], [-16.2, -6.2], [-11.8, -8.2],
];
export const DRIVE_EAST: P[] = [
  [8.0, -9.5], [13.0, -10.2], [22.0, -5.4], [36.5, -2.8], [44.8, -4.2],
  [48.2, -16.8], [55.2, -16.2], [53.8, -4.5], [47.2, 2.5], [38.5, 6.2],
  [26.0, 5.2], [12.0, 2.8], [7.8, -2.0],
];

/** Mown lawn across the house frontage, the west lawn under the deciduous trees, and the wide east front lawn island. */
export const LAWN: P[] = [
  [-22.5, -18.8], [50.0, -14.8], [53.5, 8.5], [12.0, 10.5],
  [-17.0, 10.5], [-22.5, 4.0],
];

const GRAVEL = 8, GRASS = 12;   // road-field kinds: 8 is weathered yard gravel/stone, 12 is mown grass
const EDGE = 1.6;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Mapped Blackstone Road and Smithville Road centrelines in house (u, v) metres (halfWidth = 2.6 m each). */
const BLACKSTONE_CL: readonly P[] = [
  [-39.89, -25.28], [43.79, -18.08], [47.7, -17.94], [51.54, -18.12], [55.2, -18.81], [58.68, -20.15],
];
const SMITHVILLE_CL: readonly P[] = [[56.19, -16.93], [60.26, 26.87]];

function polylineDist(pts: readonly P[], u: number, v: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((u - ax) * dx + (v - ay) * dy) / l2)) : 0;
    const d = Math.hypot(u - (ax + dx * t), v - (ay + dy * t));
    if (d < best) best = d;
  }
  return best;
}

/** Minimum distance in metres from either public road centreline (Blackstone Road or Smithville Road). */
const roadCenterDist = (u: number, v: number): number => Math.min(polylineDist(BLACKSTONE_CL, u, v), polylineDist(SMITHVILLE_CL, u, v));

/**
 * Margin from road centreline that protects every texel contributing to a 4-texel bilinear surfaceAt() query on the
 * 2.6 m carriageway (2.6 + mpp * sqrt(2) + quantization cushion): 4.5 m at L8 (1 m/texel), 6.0 m at L7 (2 m/texel).
 */
const roadPaintMargin = (level?: number): number => (level !== undefined && level <= 7 ? 6.0 : 4.5);

/** Surveyed mailbox near this house (before relocation to the west driveway entrance). */
const MAILBOX_SEARCH_M = 35;
/** Real roadside mailbox spot at the west side of the west driveway mouth: dark green plastic pedestal, facing Blackstone Road. */
export const MAILBOX_UV: P = [-11.3, -18.4];
export const MAILBOX_HEADING_DEG = 26.9;

export class BlackstoneSite implements Site {
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands: the house, sheds, barn, driveways and open lawn. */
  readonly clear: number[][] = [];
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw: number;
  /** The level of the pad, in true metres above the sea. */
  readonly level: number;
  /** Paint and grade only on L8 (1 m/texel, where single trees replace the canopy hull) so L5-L7 keep roads and canopy untouched. */
  readonly maxTexel = 1;
  private ox: number; private oz: number; private sin: number; private cos: number;
  private bx: number; private by: number; private axisDeg: number;

  /** The surveyed box of this house, or null when the survey no longer has it where and as it was. */
  static find(list: readonly Building[]): Building | null {
    const b = list.find((b) => b.id === BLACKSTONE_BUILDING);
    return b && b.kind === 'house'
      && Math.hypot(b.x - SITE_REF[0], b.y - SITE_REF[1]) < SITE_REACH
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
    const corners = [this.world(-24.5, -22.5), this.world(55.5, -22.5), this.world(55.5, 13.5), this.world(-24.5, 13.5)];
    this.box = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z))];
    // Tree-free strips, 3 m deep, across the open lawn, house, outbuildings and driveways. Surrounding woods stay.
    const step = 1.5, strip = 3;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && (
          depth(LAWN, u, v) > -0.5 || depth(DRIVE_FRONT, u, v) > -0.5
          || depth(DRIVE_WEST, u, v) > -0.5 || depth(DRIVE_EAST, u, v) > -0.5
        );
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

  /**
   * Place this property's roadside mailbox at the west driveway mouth as a dark-green molded plastic pedestal box
   * (style 7, matching props.ts) and re-aim the house's service drop onto the upper north-west wing wall.
   */
  adjustProps<T extends {
    mailboxes?: Array<{ x: number; y: number; heading: number; style: number; tilt: number; group: number | null; parcelBox: boolean }>;
    serviceDrops?: Array<{ building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }>;
  }>(data: T): T {
    const [mx, my] = this.map(MAILBOX_UV[0], MAILBOX_UV[1]);
    const [dx, dy] = this.map(-5.5, -4.1);
    let bestIdx = -1, bestDist = MAILBOX_SEARCH_M;
    if (Array.isArray(data.mailboxes)) {
      data.mailboxes.forEach((m, i) => {
        const d = Math.hypot(m.x - this.bx, m.y - this.by);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
    }
    const mailboxes = Array.isArray(data.mailboxes) && bestIdx >= 0
      ? data.mailboxes.map((m, i) => (i === bestIdx ? { ...m, x: mx, y: my, heading: MAILBOX_HEADING_DEG, style: 7, tilt: 0, parcelBox: false } : m))
      : data.mailboxes;
    const serviceDrops = Array.isArray(data.serviceDrops)
      ? data.serviceDrops.map((d) => (d.building === BLACKSTONE_BUILDING
        ? { ...d, x: dx, y: dy, height: 5.15, ground: this.level, groundX: this.bx, groundY: this.by } : d))
      : data.serviceDrops;
    return { ...data, mailboxes, serviceDrops };
  }

  /** Roof boxes for the drone flight floor: tall NW wing, main wing, front vestibule, SE deck, west shed, east barn and hoop shelters. */
  roofBoxes(): Pick<Building, 'x' | 'y' | 'ground' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge'>[] {
    const box = (u0: number, u1: number, v0: number, v1: number, eave: number, ridge: number, ground = this.level) => {
      const [x, y] = this.map((u0 + u1) / 2, (v0 + v1) / 2);
      return { x, y, ground, axisDeg: this.axisDeg, length: u1 - u0, width: v1 - v0, eave, ridge };
    };
    return [
      box(-5.6, -1.4, -4.1, 4.1, 5.5, 8.35),      // tall two-storey NW wing
      box(-1.4, 5.0, -4.1, 4.1, 3.1, 6.35),       // lower 1.5-storey main wing and shed dormer
      box(-0.2, 2.5, -6.0, -4.1, 2.95, 5.3),      // front projecting gable vestibule
      box(5.0, 7.8, -3.6, 3.4, 4.75, 4.75),       // two-storey SE wooden deck
      box(-19.8, -16.2, -9.9, -7.1, 2.0, 3.27, this.level + 0.21), // small west blue gambrel shed
      box(39.2, 47.8, 0.9, 7.1, 2.75, 5.77, this.level - 0.98),    // large east two-storey blue gambrel barn
      box(33.8, 36.8, 2.6, 7.8, 2.2, 2.55, this.level - 0.64),     // west arched fabric hoop shelter
      box(48.0, 51.0, 1.2, 5.8, 2.1, 2.45, this.level - 1.1),      // east arched fabric hoop shelter
    ];
  }

  height(x: number, z: number, surveyed: number): number {
    const { u, v } = this.local(x, z);
    const d = depth(PAD, u, v);
    if (d <= -PAD_MARGIN) return surveyed;
    return this.level + (surveyed - this.level) * (d >= 0 ? 0 : smooth(0, PAD_MARGIN, -d));
  }

  clearCanopy(x: number, z: number, level?: number): boolean {
    const { u, v } = this.local(x, z);
    if (u < -24.5 || u > 56.0 || v < -23.0 || v > 13.5) return false;
    // Stay clear of the 6 m canopy-averaging window around Blackstone Road and Smithville Road on L7.
    if (roadCenterDist(u, v) < (level !== undefined && level <= 7 ? 15.0 : 4.5)) return false;
    return depth(LAWN, u, v) > -0.5 || depth(DRIVE_FRONT, u, v) > -0.5 || depth(DRIVE_WEST, u, v) > -0.5 || depth(DRIVE_EAST, u, v) > -0.5;
  }

  surface(x: number, z: number, _ground?: number, level?: number): { dist: number; half: number; kind: number } | null {
    const { u, v } = this.local(x, z);
    if (u < -24.5 || u > 56.0 || v < -23.0 || v > 13.5) return null;
    if (roadCenterDist(u, v) < roadPaintMargin(level)) return null;
    // Gravel driveways win over lawn and keep their own edge depth so the shader feathers their border smoothly.
    const dDrive = Math.max(depth(DRIVE_FRONT, u, v), depth(DRIVE_WEST, u, v), depth(DRIVE_EAST, u, v));
    if (dDrive > -0.6) return { dist: Math.max(6.5, 10 - dDrive), half: 10, kind: GRAVEL };
    const dLawn = depth(LAWN, u, v);
    if (dLawn > -EDGE) return { dist: Math.max(6.5, 10 - dLawn), half: 10, kind: GRASS };
    return null;
  }
}
