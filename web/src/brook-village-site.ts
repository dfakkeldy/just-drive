import type { Building } from './buildings';
import { depth } from './home-site';
import type { ParkedType } from './parked';
import type { Site } from './terrain';

/**
 * Brook Village hand-built landmarks along Highway 252 in the Mabou area:
 * 1. The general store at the corner of Highway 252 and Lake Ainslie Chapel Road (surveyed building 69,
 *    with its gravel parking lot, rear extension and west shipping container);
 * 2. St. John the Baptist Roman Catholic Church about 110 m east on the south side of Highway 252
 *    (surveyed building 1570, with its steeple, rear cross-gable wings, pedimented portico, accessible
 *    ramp, gravel turnaround, wide mown west lawn, flagpole and wooden church signboard).
 *
 * Both frames come from their surveyed building records. If a new survey shifts, resizes or turns either
 * building beyond tolerance, the site stays off and the surveyed boxes draw as usual.
 *
 * Store local axes (building 69, axisDeg = 146):
 *   u runs SSE (146 deg) toward the front gable and Lake Ainslie Chapel Road / Highway 252 junction;
 *   v runs WSW (236 deg) toward the west gravel parking lot and shipping container (-v faces east).
 *
 * Church local axes (building 1570, axisDeg = 0):
 *   u runs north (0 deg) toward the front portico, gravel turnaround and Highway 252 (at u ~ +28.8 m);
 *   v runs east (90 deg); the real LiDAR church ridge lies at v = +5.5 m (+5.5 m east of box 1570's centre),
 *   and the wide mown west lawn stretches across negative v toward the flagpole and signboard.
 */
type P = [number, number];

export const BROOK_STORE_BUILDING = 69;
const STORE_REF: P = [631520.09, 5101179.57];
const STORE_LEN = 18.45, STORE_WID = 10.69, STORE_AXIS = 146;

export const BROOK_CHURCH_BUILDING = 1570;
const CHURCH_REF: P = [631625.5, 5101134.0];
const CHURCH_LEN = 22.0, CHURCH_WID = 7.0, CHURCH_AXIS = 0;

const SITE_REACH = 0.5, SIZE_TOL = 0.5, AXIS_TOL = 0.5;

export interface BrookVillageBoxes {
  readonly store: Building;
  readonly church: Building;
}

export interface LocalFrame {
  readonly origin: { readonly x: number; readonly z: number };
  readonly yaw: number;
  readonly level: number;
  readonly axisDeg: number;
  readonly bx: number;
  readonly by: number;
  world(u: number, v: number): { x: number; z: number };
  map(u: number, v: number): [number, number];
  local(x: number, z: number): { u: number; v: number };
  heading(du: number, dv: number): number;
}

function makeFrame(building: Building, village: readonly [number, number]): LocalFrame {
  const axis = (building.axisDeg * Math.PI) / 180;
  const sin = Math.sin(axis), cos = Math.cos(axis);
  const ox = building.x - village[0], oz = village[1] - building.y;
  const origin = Object.freeze({ x: ox, z: oz });
  return {
    origin,
    yaw: Math.PI / 2 - axis,
    level: building.ground,
    axisDeg: building.axisDeg,
    bx: building.x,
    by: building.y,
    world: (u, v) => ({ x: ox + u * sin + v * cos, z: oz - u * cos + v * sin }),
    map: (u, v) => [building.x + u * sin + v * cos, building.y + u * cos - v * sin],
    local: (x, z) => {
      const dx = x - ox, dz = z - oz;
      return { u: dx * sin - dz * cos, v: dx * cos + dz * sin };
    },
    heading: (du, dv) => Math.atan2(du * sin + dv * cos, du * cos - dv * sin),
  };
}

// ---- Store site polygons in store local (u, v) metres ----
/** Level ground pad under the store main block and rear extension (well clear of Lake Ainslie Chapel Rd at u~18.1). */
const STORE_PAD: P[] = [[-9.6, -4.4], [9.8, -4.4], [9.8, 5.2], [-9.6, 5.2]];
const STORE_PAD_MARGIN = 2.6;

/** Gravel parking lot west of the store, front apron toward the highway junction, and narrow east pull-in strip. */
export const STORE_GRAVEL: P[] = [
  [-10.2, -9.2], [13.2, -9.2], [13.2, 19.2], [10.0, 21.5],
  [-9.5, 18.8], [-10.2, 5.2],
];

/** Small mown grass verge west of the shipping container. */
export const STORE_GRASS: P[] = [
  [-10.5, 17.5], [11.5, 18.5], [10.5, 24.0], [-10.5, 23.0],
];

// ---- Church site polygons in church local (u, v) metres ----
/** Real LiDAR church centre offset in building-1570 local (u, v): +1.0 m north, +5.5 m east. */
export const CHURCH_CENTER_U = 1.0;
export const CHURCH_CENTER_V = 5.5;

/** Level pad under the church nave, cross-gable wings, portico and ramp (well clear of Highway 252 at u~28.8). */
const CHURCH_PAD: P[] = [[-11.6, -4.8], [16.4, -4.8], [16.4, 15.8], [-11.6, 15.8]];
const CHURCH_PAD_MARGIN = 3.0;

/** Wide gravel turnaround & parking apron north and east of the church meeting Highway 252. */
export const CHURCH_GRAVEL: P[] = [
  [14.5, -18.0], [23.6, -24.0], [23.6, 24.5], [14.0, 24.5],
  [-4.0, 22.0], [-4.0, 15.0], [14.5, 13.0],
];

/** Wide mown green church lawn stretching west of the church around the flagpole and signboard. */
export const CHURCH_LAWN: P[] = [
  [-15.0, -47.0], [22.6, -47.0], [22.6, 20.0], [-15.0, 20.0],
];

const GRAVEL = 8, GRASS = 12;
const EDGE = 1.6;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Mapped public road centrelines near Brook Village in fixed EPSG:2961 map metres. */
const HWY_252_MAP: readonly P[] = [
  [631471.79, 5101128.44], [631481.65, 5101135.28], [631491.57, 5101142.03], [631501.74, 5101148.38],
  [631512.33, 5101153.97], [631523.34, 5101158.64], [631534.87, 5101161.61], [631546.76, 5101162.57],
  [631558.75, 5101162.41], [631570.74, 5101162.28], [631582.74, 5101162.36], [631594.74, 5101162.47],
  [631606.74, 5101162.57], [631618.74, 5101162.67], [631630.74, 5101162.78], [631642.73, 5101162.88],
  [631654.73, 5101162.99], [631664.30, 5101163.13], [631676.30, 5101163.13],
];
const CHAPEL_RD_MAP: readonly P[] = [
  [631523.81, 5101159.53], [631530.07, 5101164.51], [631536.33, 5101169.49], [631542.58, 5101174.47],
  [631548.84, 5101179.45], [631555.10, 5101184.43], [631561.35, 5101189.41], [631567.61, 5101194.39],
];
const TRACK_202_MAP: readonly P[] = [
  [631494.11, 5101143.93], [631493.33, 5101147.86], [631492.47, 5101151.76], [631491.25, 5101155.55],
  [631489.72, 5101159.22], [631487.96, 5101162.77], [631486.03, 5101166.23], [631483.86, 5101169.56],
  [631481.50, 5101172.75], [631478.96, 5101175.83], [631476.29, 5101178.78], [631473.49, 5101181.62],
  [631470.62, 5101184.39],
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

export interface BrookParkedSpot {
  readonly place: 'store' | 'church';
  readonly u: number;
  readonly v: number;
  readonly du: number;
  readonly dv: number;
  readonly type: ParkedType;
}

/** Generic random parked vehicles (no plates, badges or people), leaving open drive-in/turnaround lanes. */
export const BROOK_PARKED_SPOTS: readonly BrookParkedSpot[] = [
  // Store west gravel parking lot (2 vehicles parked clear of the drive-in lane and container).
  { place: 'store', u: -3.5, v: 9.8, du: 1, dv: 0.04, type: 1 },
  { place: 'store', u: 7.4, v: 9.6, du: -0.95, dv: -0.32, type: 2 },
  // Store east pull-in apron beside the storefront (1 compact car clear of Lake Ainslie Chapel Rd).
  { place: 'store', u: 5.5, v: -6.4, du: 1, dv: -0.05, type: 0 },
  // Church east gravel turnaround edge (1 car parked neatly clear of front steps, ramp and U-turn path).
  { place: 'church', u: 16.5, v: 18.8, du: 0.04, dv: -1, type: 0 },
];

export class BrookVillageSite implements Site {
  readonly store: LocalFrame;
  readonly church: LocalFrame;
  /** World bounding box [x0, z0, x1, z1] covering both the store and church sites. */
  readonly box: [number, number, number, number];
  /** World boxes [x0, z0, x1, z1] where no surveyed tree stands: lots, buildings and open church lawn. */
  readonly clear: number[][] = [];
  /** Paint, grade and clear canopy only on L8 (1 m/texel) so L5-L7 roads and canopy hull stay untouched. */
  readonly maxTexel = 1;
  /** Midpoint between store and church for range checks. */
  readonly origin: { readonly x: number; readonly z: number };
  private hwy252World: P[];
  private chapelRdWorld: P[];
  private track202World: P[];

  /** Find both Brook Village surveyed boxes, or null if either is missing or moved/turned beyond tolerance. */
  static find(list: readonly Building[]): BrookVillageBoxes | null {
    const store = list.find((b) => b.id === BROOK_STORE_BUILDING);
    const church = list.find((b) => b.id === BROOK_CHURCH_BUILDING);
    const okStore = store && store.kind === 'house'
      && Math.hypot(store.x - STORE_REF[0], store.y - STORE_REF[1]) < SITE_REACH
      && Math.abs(store.length - STORE_LEN) < SIZE_TOL
      && Math.abs(store.width - STORE_WID) < SIZE_TOL
      && Math.abs(store.axisDeg - STORE_AXIS) < AXIS_TOL;
    const okChurch = church && church.kind === 'house'
      && Math.hypot(church.x - CHURCH_REF[0], church.y - CHURCH_REF[1]) < SITE_REACH
      && Math.abs(church.length - CHURCH_LEN) < SIZE_TOL
      && Math.abs(church.width - CHURCH_WID) < SIZE_TOL
      && Math.abs(church.axisDeg - CHURCH_AXIS) < AXIS_TOL;
    return okStore && okChurch ? { store, church } : null;
  }

  constructor(boxes: BrookVillageBoxes, village: readonly [number, number]) {
    this.store = makeFrame(boxes.store, village);
    this.church = makeFrame(boxes.church, village);
    this.origin = Object.freeze({
      x: (this.store.origin.x + this.church.origin.x) / 2,
      z: (this.store.origin.z + this.church.origin.z) / 2,
    });
    const toWorld = ([e, n]: P): P => [e - village[0], village[1] - n];
    this.hwy252World = HWY_252_MAP.map(toWorld);
    this.chapelRdWorld = CHAPEL_RD_MAP.map(toWorld);
    this.track202World = TRACK_202_MAP.map(toWorld);

    const pts = [
      this.store.world(-12.5, -11.0), this.store.world(14.5, -11.0),
      this.store.world(14.5, 25.0), this.store.world(-12.5, 25.0),
      this.church.world(-16.5, -48.5), this.church.world(25.0, -48.5),
      this.church.world(25.0, 26.0), this.church.world(-16.5, 26.0),
    ];
    this.box = [
      Math.min(...pts.map((c) => c.x)), Math.min(...pts.map((c) => c.z)),
      Math.max(...pts.map((c) => c.x)), Math.max(...pts.map((c) => c.z)),
    ];

    // Tree-free strips, 3 m deep, across the store lot, church building, turnaround and open west lawn.
    const step = 1.5, strip = 3;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const open = x <= this.box[2] && this.isOpenGround(x, z + strip / 2);
        if (open && start === null) start = x;
        if (!open && start !== null) {
          this.clear.push([start - step, z, x, z + strip]);
          start = null;
        }
      }
    }
  }

  /** True when (x, z) lies too close to Highway 252, Lake Ainslie Chapel Road or Track 202 for painting/canopy edits. */
  private nearRoad(x: number, z: number, extra: number): boolean {
    return polylineDist(this.hwy252World, x, z) < 3.6 + extra
      || polylineDist(this.chapelRdWorld, x, z) < 2.6 + extra
      || polylineDist(this.track202World, x, z) < 1.5 + extra;
  }

  private isOpenGround(x: number, z: number): boolean {
    const s = this.store.local(x, z);
    if (s.u >= -11.0 && s.u <= 14.0 && s.v >= -10.0 && s.v <= 24.5) {
      if (depth(STORE_GRAVEL, s.u, s.v) > -0.5 || depth(STORE_GRASS, s.u, s.v) > -0.5) return true;
    }
    const c = this.church.local(x, z);
    if (c.u >= -16.0 && c.u <= 24.5 && c.v >= -48.0 && c.v <= 25.5) {
      if (depth(CHURCH_GRAVEL, c.u, c.v) > -0.5 || depth(CHURCH_LAWN, c.u, c.v) > -0.5) return true;
    }
    return false;
  }

  /** Re-aim service drops onto the hand-built store front-west upper wall and church front-west eave. */
  adjustProps<T extends {
    serviceDrops?: Array<{ building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }>;
  }>(data: T): T {
    if (!Array.isArray(data.serviceDrops)) return data;
    const [sx, sy] = this.store.map(7.8, 4.6);
    const [cx, cy] = this.church.map(11.8, -0.8);
    const serviceDrops = data.serviceDrops.map((d) => {
      if (d.building === BROOK_STORE_BUILDING) {
        return { ...d, x: sx, y: sy, height: 4.9, ground: this.store.level, groundX: this.store.bx, groundY: this.store.by };
      }
      if (d.building === BROOK_CHURCH_BUILDING) {
        return { ...d, x: cx, y: cy, height: 5.1, ground: this.church.level, groundX: this.church.bx, groundY: this.church.by };
      }
      return d;
    });
    return { ...data, serviceDrops };
  }

  /** Static drone roof boxes covering every hand-built structure at both the store and the church. */
  roofBoxes(): Pick<Building, 'x' | 'y' | 'ground' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge'>[] {
    const mk = (frame: LocalFrame, u0: number, u1: number, v0: number, v1: number, eave: number, ridge: number, ground = frame.level) => {
      const [x, y] = frame.map((u0 + u1) / 2, (v0 + v1) / 2);
      return { x, y, ground, axisDeg: frame.axisDeg, length: u1 - u0, width: v1 - v0, eave, ridge };
    };
    const cv = CHURCH_CENTER_V;
    return [
      // Store main 2-storey gable (+ chimney), rear extension and west shipping container.
      mk(this.store, -2.2, 9.4, -4.3, 5.1, 4.75, 9.55),
      mk(this.store, -9.2, -1.9, -4.1, 4.9, 4.75, 6.65),
      mk(this.store, -8.5, 0.1, 14.6, 17.6, 2.75, 2.75, this.store.level + 0.35),
      mk(this.store, 9.1, 10.5, 18.3, 20.9, 0.85, 0.85, this.store.level + 0.25),
      // Church nave (+ rear finial cross), cross-gable wings, front portico, steeple + cross, flagpole and lawn signboard.
      mk(this.church, -11.0, 13.0, cv - 6.8, cv + 6.8, 5.3, 12.8),
      mk(this.church, -9.8, -1.2, cv - 9.7, cv + 9.7, 4.5, 8.7),
      mk(this.church, 12.2, 15.2, cv - 2.6, cv + 2.6, 3.8, 5.2),
      mk(this.church, 9.0, 12.8, cv - 2.0, cv + 2.0, 14.0, 17.6),
      mk(this.church, -2.8, -1.2, -24.8, -23.2, 8.5, 8.5, this.church.level + 1.2),
      mk(this.church, 9.2, 10.8, -36.5, -33.5, 2.8, 2.8, this.church.level + 1.35),
    ];
  }

  height(x: number, z: number, surveyed: number): number {
    const s = this.store.local(x, z);
    const ds = depth(STORE_PAD, s.u, s.v);
    if (ds > -STORE_PAD_MARGIN) {
      return this.store.level + (surveyed - this.store.level) * (ds >= 0 ? 0 : smooth(0, STORE_PAD_MARGIN, -ds));
    }
    const c = this.church.local(x, z);
    const dc = depth(CHURCH_PAD, c.u, c.v);
    if (dc > -CHURCH_PAD_MARGIN) {
      return this.church.level + (surveyed - this.church.level) * (dc >= 0 ? 0 : smooth(0, CHURCH_PAD_MARGIN, -dc));
    }
    return surveyed;
  }

  clearCanopy(x: number, z: number, level?: number): boolean {
    if (this.nearRoad(x, z, level !== undefined && level <= 7 ? 10.5 : 2.0)) return false;
    return this.isOpenGround(x, z);
  }

  surface(x: number, z: number, _ground?: number, level?: number): { dist: number; half: number; kind: number } | null {
    // Paint gravel lots and church lawn only on L8 so L5-L7 roads and canopy hull stay untouched.
    if (level !== undefined && level <= 7) return null;
    if (this.nearRoad(x, z, 2.1)) return null;

    const s = this.store.local(x, z);
    if (s.u >= -11.5 && s.u <= 14.5 && s.v >= -10.5 && s.v <= 25.0) {
      const dg = depth(STORE_GRAVEL, s.u, s.v);
      if (dg > -0.6) return { dist: Math.max(6.5, 10 - dg), half: 10, kind: GRAVEL };
      const dl = depth(STORE_GRASS, s.u, s.v);
      if (dl > -EDGE) return { dist: Math.max(6.5, 10 - dl), half: 10, kind: GRASS };
    }

    const c = this.church.local(x, z);
    if (c.u >= -16.5 && c.u <= 24.5 && c.v >= -48.5 && c.v <= 26.0) {
      const dg = depth(CHURCH_GRAVEL, c.u, c.v);
      if (dg > -0.6) return { dist: Math.max(6.5, 10 - dg), half: 10, kind: GRAVEL };
      const dl = depth(CHURCH_LAWN, c.u, c.v);
      if (dl > -EDGE) return { dist: Math.max(6.5, 10 - dl), half: 10, kind: GRASS };
    }
    return null;
  }
}
