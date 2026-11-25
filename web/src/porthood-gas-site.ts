import type { Building } from './buildings';
import { depth } from './home-site';
import type { ParkedType } from './parked';
import type { Site } from './terrain';

/**
 * The Port Hood service station and gas bar at the corner of High Road and Dunmore Road (Port Hood area),
 * built by hand in place of its surveyed box (building 522, porthood-gas.ts), with its paved forecourt,
 * concrete pump apron, rear gravel service yard, mown corner lawns, fuel island, price pylon, east storage
 * shed, shipping container, cargo trailer and full lot of parked vehicles.
 *
 * The place comes from the surveyed building record: the centre of building 522, its long axis and its
 * ground height. If a new survey changes that record, the place stays as the survey has it.
 *
 * Local axes: u runs along the survey's long axis (east-northeast at 83 deg, parallel to High Road, toward
 * the east lean-to wing and storage shed); v runs across it (south-southeast, away from High Road; High Road
 * lies on -v at v ~ -27.2 m, and Dunmore Road sweeps along -u / +v on the west and southwest sides).
 * All layout in porthood-gas.ts is in these metres, from the centre of the surveyed box.
 */
type P = [number, number];

/** The game's number for the surveyed box, its surveyed centre, size and axis. */
export const PORT_HOOD_GAS_BUILDING = 522;
const LENGTH = 19.23, WIDTH = 12.54, AXIS = 83;
const SITE_REF: P = [614501.66, 5096458.7];
const SITE_REACH = 0.5, SIZE_TOL = 0.5, AXIS_TOL = 0.5;

/** Baked High Road point 248 (48 m WNW of building 522), angled so the station, fuel canopy, price pylon and packed lot fill the view.
 * Heading is clockwise from north in radians (118 degrees). */
export const PORT_HOOD_GAS_START = { e: 614458.74, n: 5096480.17, road: 'High Road', heading: (118 * Math.PI) / 180 };

/** Level ground under the main service station building and east wing; outside it blends back to the lot's slope. */
const PAD: P[] = [[-8.2, -6.2], [10.8, -6.2], [10.8, 5.2], [-8.2, 5.2]];
const PAD_MARGIN = 3.0;

/**
 * Paved asphalt forecourt and driveways in site (u, v):
 * - main forecourt between the building and High Road, extending east to the dark storage shed;
 * - west storefront apron and entrance curving southwest to meet Dunmore Road cleanly.
 */
export const LOT_ASPHALT: P[] = [
  [-36.5, -24.2], [23.0, -24.2], [23.0, -5.0], [18.5, -2.0],
  [10.8, -2.0], [10.8, 5.2], [-15.5, 5.2], [-29.0, 9.5],
  [-41.5, 9.5], [-43.5, 2.0], [-36.5, -8.0],
];

/** Concrete fuel apron spanning from the front of the service bays across both fuel lanes under the pump island. */
export const APRON_CONCRETE: P[] = [
  [-10.2, -17.4], [6.8, -17.4], [6.8, -5.2], [-10.2, -5.2],
];

/** Rear gravel work and service parking yard behind the south wall of the station. */
export const REAR_GRAVEL: P[] = [
  [-15.5, 4.5], [19.5, 4.5], [19.5, 13.8], [-15.5, 13.8],
];

/** Mown corner lawn across the southwest triangle (around the pylon price sign) and northwest verge. */
export const LAWN_SW: P[] = [
  [-44.0, 6.0], [-14.0, 4.5], [16.0, 12.5], [14.0, 22.0],
  [-8.0, 27.0], [-29.0, 26.5], [-39.5, 16.5],
];
export const LAWN_NW: P[] = [
  [-54.0, -23.5], [-35.5, -23.5], [-36.0, -7.5], [-43.0, 3.0], [-51.5, -6.0],
];

const ASPHALT = 2, GRAVEL = 8, CONCRETE = 9, GRASS = 12;
const EDGE = 1.6;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Mapped High Road and Dunmore Road centrelines in fixed EPSG:2961 map metres (halfWidth = 3.0 m each). */
const HIGH_ROAD_MAP: readonly P[] = [
  [614411.29, 5096472.96], [614427.10, 5096475.39], [614442.92, 5096477.78], [614458.74, 5096480.17],
  [614474.56, 5096482.54], [614490.42, 5096484.71], [614506.30, 5096486.66], [614522.15, 5096488.78],
  [614537.99, 5096491.08], [614553.82, 5096493.39],
];
const DUNMORE_ROAD_MAP: readonly P[] = [
  [614430.92, 5096475.94], [614441.57, 5096464.00], [614452.22, 5096452.07], [614462.83, 5096440.11],
  [614473.35, 5096428.05], [614483.71, 5096415.88], [614493.22, 5096403.05],
];

function polylineDist(pts: readonly P[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

/**
 * Margin from road centreline that protects every texel contributing to a 4-texel bilinear surfaceAt() query on the
 * 3.0 m carriageway (3.0 + mpp * sqrt(2) + quantization cushion): 5.0 m at L8 (1 m/texel), 6.5 m at L7 (2 m/texel).
 */
const roadPaintMargin = (level?: number): number => (level !== undefined && level <= 7 ? 6.5 : 5.0);

/** Generic random parked vehicle layout in site (u, v): fuelling at the pumps and packed across every lot row. */
export interface GasParkedSpot {
  readonly u: number;
  readonly v: number;
  /** Direction the nose points, in site (du, dv). */
  readonly du: number;
  readonly dv: number;
  readonly type: 0 | 1 | 2;
}

export const GAS_PARKED_SPOTS: readonly GasParkedSpot[] = [
  // At the outer fuel pump lane (2 vehicles fuelling beside the two dispensers; entire inner south fuel lane stays open).
  { u: -8.4, v: -16.1, du: 1, dv: 0.02, type: 2 },
  { u: -2.2, v: -16.1, du: 1, dv: -0.02, type: 1 },
  // Northwest High Road frontage row (6 vehicles set back from High Road so combined max shift+turn stays clear).
  { u: -33.0, v: -18.3, du: 0.04, dv: 1, type: 2 },
  { u: -30.0, v: -18.3, du: -0.03, dv: -1, type: 1 },
  { u: -27.0, v: -18.3, du: 0.02, dv: 1, type: 0 },
  { u: -24.0, v: -18.3, du: -0.04, dv: 1, type: 2 },
  { u: -21.0, v: -18.3, du: 0.03, dv: -1, type: 1 },
  { u: -18.0, v: -18.3, du: -0.02, dv: 1, type: 0 },
  // West lot edge row (3 vehicles along the west lawn edge, clear of the Dunmore Road drive-in lane).
  { u: -34.2, v: -12.5, du: 1, dv: -0.08, type: 1 },
  { u: -33.5, v: -9.0, du: 1, dv: -0.05, type: 0 },
  { u: -32.8, v: -5.5, du: 1, dv: -0.06, type: 2 },
  // West storefront nose-in spaces (3 vehicles right outside the office entrance).
  { u: -11.8, v: -3.2, du: 1, dv: 0.03, type: 1 },
  { u: -11.8, v: 0.2, du: 1, dv: 0.02, type: 0 },
  { u: -11.8, v: 3.6, du: 1, dv: -0.03, type: 2 },
  // West lot mid-row along the southwest lawn edge (3 vehicles facing the lot, leaving Dunmore entrance wide open).
  { u: -26.5, v: 4.5, du: 0.02, dv: -1, type: 0 },
  { u: -23.0, v: 4.5, du: 0.04, dv: -1, type: 0 },
  { u: -19.5, v: 4.5, du: -0.03, dv: -1, type: 1 },
  // East High Road frontage row (3 vehicles east of the High Road exit lane).
  { u: 9.2, v: -18.8, du: -0.03, dv: 1, type: 0 },
  { u: 12.6, v: -18.8, du: 0.04, dv: -1, type: 1 },
  { u: 16.0, v: -18.8, du: -0.02, dv: 1, type: 2 },
  // East lot packed in front of the dark storage shed and east service bay (4 vehicles).
  { u: 13.2, v: -14.4, du: -1, dv: 0.04, type: 0 },
  { u: 13.2, v: -11.3, du: -1, dv: -0.03, type: 2 },
  { u: 12.6, v: -8.2, du: -1, dv: 0.02, type: 1 },
  { u: 8.2, v: -8.8, du: 0.03, dv: 1, type: 0 },
  // Rear gravel service apron behind the station (4 vehicles).
  { u: -2.5, v: 9.4, du: 0.02, dv: -1, type: 2 },
  { u: 1.2, v: 9.4, du: -0.04, dv: 1, type: 0 },
  { u: 4.8, v: 9.4, du: 0.03, dv: -1, type: 1 },
  { u: 8.5, v: 9.4, du: -0.02, dv: -1, type: 2 },
];

export type GasParkedSpotType = ParkedType;

export class PortHoodGasSite implements Site {
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands: the paved lot, station, shed and corner lawns. */
  readonly clear: number[][] = [];
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw: number;
  /** The level of the station pad, in true metres above the sea. */
  readonly level: number;
  /** Paint, grade and clear canopy only on L8 (1 m/texel) so L5-L7 roads and canopy hull stay bit-for-bit untouched. */
  readonly maxTexel = 1;
  /** The centre of the surveyed box. One object for the whole visit. */
  readonly origin: { readonly x: number; readonly z: number };
  private ox: number; private oz: number; private sin: number; private cos: number;
  private bx: number; private by: number; private axisDeg: number;
  private highRoadWorld: P[]; private dunmoreRoadWorld: P[];

  /** The surveyed box of this gas station, or null when the survey no longer has it where and as it was. */
  static find(list: readonly Building[]): Building | null {
    const b = list.find((b) => b.id === PORT_HOOD_GAS_BUILDING);
    return b && b.kind === 'shed'
      && Math.hypot(b.x - SITE_REF[0], b.y - SITE_REF[1]) < SITE_REACH
      && Math.abs(b.length - LENGTH) < SIZE_TOL && Math.abs(b.width - WIDTH) < SIZE_TOL && Math.abs(b.axisDeg - AXIS) < AXIS_TOL
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
    this.highRoadWorld = HIGH_ROAD_MAP.map(([e, n]) => [e - village[0], village[1] - n]);
    this.dunmoreRoadWorld = DUNMORE_ROAD_MAP.map(([e, n]) => [e - village[0], village[1] - n]);
    const corners = [
      this.world(-54.5, -25.5), this.world(28.5, -25.5),
      this.world(28.5, 28.0), this.world(-54.5, 28.0),
    ];
    this.box = [
      Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)),
      Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z)),
    ];
    // Tree-free strips, 3 m deep, across the paved lot, concrete apron, rear gravel yard and corner lawns.
    const step = 1.5, strip = 3;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && this.isOpenLot(u, v);
        if (open && start === null) start = x;
        if (!open && start !== null) { this.clear.push([start - step, z, x, z + strip]); start = null; }
      }
    }
  }

  private roadCenterDist(x: number, z: number): number {
    return Math.min(polylineDist(this.highRoadWorld, x, z), polylineDist(this.dunmoreRoadWorld, x, z));
  }

  private isOpenLot(u: number, v: number): boolean {
    return depth(LOT_ASPHALT, u, v) > -0.5
      || depth(REAR_GRAVEL, u, v) > -0.5
      || depth(LAWN_SW, u, v) > -0.5
      || depth(LAWN_NW, u, v) > -0.5
      || (u >= 17.0 && u <= 26.5 && v >= -17.5 && v <= -10.0);
  }

  /** Site metres to world metres. */
  world(u: number, v: number): { x: number; z: number } {
    return { x: this.ox + u * this.sin + v * this.cos, z: this.oz - u * this.cos + v * this.sin };
  }
  /** Site metres to EPSG:2961 map metres. */
  map(u: number, v: number): [number, number] {
    return [this.bx + u * this.sin + v * this.cos, this.by + u * this.cos - v * this.sin];
  }
  /** World metres to site metres. */
  local(x: number, z: number): { u: number; v: number } {
    const dx = x - this.ox, dz = z - this.oz;
    return { u: dx * this.sin - dz * this.cos, v: dx * this.cos + dz * this.sin };
  }
  /** Compass heading (clockwise from north) of a direction given in site axes. */
  heading(du: number, dv: number): number {
    return Math.atan2(du * this.sin + dv * this.cos, du * this.cos - dv * this.sin);
  }

  /** Roof boxes for the drone flight floor: main station, east wing, fuel island, price pylon, east shed, container, trailer. */
  roofBoxes(): Pick<Building, 'x' | 'y' | 'ground' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge'>[] {
    const box = (u0: number, u1: number, v0: number, v1: number, eave: number, ridge: number, ground = this.level) => {
      const [x, y] = this.map((u0 + u1) / 2, (v0 + v1) / 2);
      return { x, y, ground, axisDeg: this.axisDeg, length: u1 - u0, width: v1 - v0, eave, ridge };
    };
    return [
      box(-7.68, 6.68, -5.72, 4.72, 4.80, 5.05),                       // main service station parapet & roof cap
      box(6.5, 10.44, -4.56, 3.36, 2.60, 3.30),                        // lower east service wing
      box(-8.8, -1.2, -14.0, -12.0, 4.85, 4.95, this.level),           // fuel island overhead light arms & sign beam
      box(-15.2, -12.8, 17.8, 20.2, 6.95, 6.95, this.level - 0.92),    // freestanding price pylon sign cabinet
      box(17.32, 22.18, -15.4, -11.0, 2.60, 3.80, this.level + 0.52),  // east dark storage shed (g = 29.035 m)
      box(22.94, 25.66, -17.06, -10.74, 2.70, 2.70, this.level + 0.56),// east shipping container (g = 29.076 m)
      box(12.56, 17.04, -5.44, -3.16, 2.45, 2.45, this.level),         // enclosed cargo trailer
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
    if (u < -54.5 || u > 28.5 || v < -25.5 || v > 28.0) return false;
    if (this.roadCenterDist(x, z) < (level !== undefined && level <= 7 ? 13.5 : 5.0)) return false;
    return this.isOpenLot(u, v);
  }

  surface(x: number, z: number, _ground?: number, level?: number): { dist: number; half: number; kind: number } | null {
    // Paint paved lot, concrete apron, rear gravel and corner lawns only on L8 so L5-L7 roads and hull stay untouched.
    if (level !== undefined && level <= 7) return null;
    const { u, v } = this.local(x, z);
    if (u < -54.5 || u > 28.5 || v < -25.5 || v > 28.0) return null;
    if (this.roadCenterDist(x, z) < roadPaintMargin(level)) return null;
    const dConc = depth(APRON_CONCRETE, u, v);
    if (dConc > -0.3) return { dist: Math.max(6.5, 10 - dConc), half: 10, kind: CONCRETE };
    const dLot = depth(LOT_ASPHALT, u, v);
    if (dLot > -0.6) return { dist: Math.max(6.5, 10 - dLot), half: 10, kind: ASPHALT };
    const dRear = depth(REAR_GRAVEL, u, v);
    if (dRear > -0.6) return { dist: Math.max(6.5, 10 - dRear), half: 10, kind: GRAVEL };
    const dLawn = Math.max(depth(LAWN_SW, u, v), depth(LAWN_NW, u, v));
    if (dLawn > -EDGE) return { dist: Math.max(6.5, 10 - dLawn), half: 10, kind: GRASS };
    return null;
  }
}
