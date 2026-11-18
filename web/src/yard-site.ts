import type { Site } from './terrain';

/**
 * The contractor's works yard on Highway 19, south-west of the village: where it is, how its ground lies, and the one
 * switch that decides how much of it the game shows.
 *
 * Yard axes: u runs along the main shop (north-east is positive), v runs across it (positive is away from the
 * highway, to the south-east). All layout in yard.ts is written in these metres.
 */

/**
 * The three outcomes of asking the owners:
 *  - 'named': they said yes. The sign carries their own name (set NAMED_SIGN), and the yard is open.
 *  - 'invented': not asked yet. The yard is open under an invented name.
 *  - 'closed': they said no. A barrier closes the entrance, the car cannot enter the property at all, there is
 *    no sign, and the buildings are the plain boxes that every other building has.
 * ?yard=closed (or named, invented) in the address bar overrides it for a test.
 */
export type YardMode = 'named' | 'invented' | 'closed';
export const YARD_MODE: YardMode = 'invented';

/** The sign at the entrance. The invented name is not a real business; the real one is added only after a yes. */
export const INVENTED_SIGN = { name: 'HARBOUR RIDGE', line: 'CIVIL & MARINE LTD.' };
export const NAMED_SIGN = { name: '', line: '' };

export function yardMode(params: URLSearchParams): YardMode {
  const asked = params.get('yard');
  return asked === 'named' || asked === 'invented' || asked === 'closed' ? asked : YARD_MODE;
}

// The middle of the shop as first measured (EPSG:2961), and the direction of its long axis from north.
const ORIGIN_E = 620594.28, ORIGIN_N = 5099369.34, AXIS = (47 * Math.PI) / 180;
const SIN = Math.sin(AXIS), COS = Math.cos(AXIS);

/** The shop's main (office) door, in yard metres. It faces the staff lot, toward the highway. */
export const DOOR = { u: 6, v: -15.9 };
/** Where the yard's mailbox stands when the yard is open: beside that door, inside the lot. */
export const MAILBOX = { u: 9.6, v: -16.6 };
/** Where the yard's mailbox was baked: at the mouth of the driveway. */
export const MAILBOX_BAKED = { u: 44.2, v: -82.7 };

/** Trial slip: low end, rising toward -u. Four rows of two 4 x 2.4 m panels. */
// The lane rises about 0.4 m toward the high end: 1.9 m above the toe leaves about 1.5 m of cribbing there.
export const SLIP_RAMP = { u: -67, v: -21, lead: 1.2, length: 16, width: 4.8, toe: 0.12, rise: 1.9 };

/** Height above the low-end bedding. The lead-in and concrete share exact edge heights. */
export function slipLift(along: number): number {
  const r = SLIP_RAMP;
  return along < r.lead ? r.toe * along / r.lead : r.toe + (r.rise - r.toe) * (along - r.lead) / r.length;
}

type P = [number, number];
interface Area { kind: number; pts: P[]; box: [number, number, number, number] }

const area = (kind: number, pts: P[]): Area => ({
  kind, pts,
  box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
});
const rect = (kind: number, u0: number, v0: number, u1: number, v1: number) => area(kind, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);

const GRAVEL = 8, CONCRETE = 9, SAND = 10;   // road-field kinds; 1 to 5 belong to roads and trails

/** The big pad to the north-east. It was forest when the land was surveyed, so the game grades it. */
const PAD_B: P[] = [[173, -15], [200, 0], [290, 0], [300, 3], [300, 53], [320, 140], [233, 143], [233, 183], [207, 183], [207, 143], [133, 127], [117, 87], [103, 73], [103, 52], [170, 48]];

// Surfaces, read off the provincial aerial photo (looked at, never shipped). Earlier entries win where two overlap,
// and the gravel runs on under the concrete so no grass shows at a joint.
const AREAS: Area[] = [
  rect(CONCRETE, -18, -36.5, 36.5, -14.5),                       // staff lot
  rect(CONCRETE, -27.5, -36, -17, -20),                          // its south-west end
  area(CONCRETE, [[35.5, -74], [31, -86.5], [51, -84.5], [46, -74]]),   // the mouth at the highway
  rect(CONCRETE, 35.5, -75, 46, 23),                             // driveway
  rect(CONCRETE, 6, 10, 46, 23),                                 // apron behind the north-east end
  rect(CONCRETE, 45, -2, 59.5, 10.5),                            // fuel island pad
  rect(GRAVEL, 44, -41, 58, 0),                                  // overflow parking beside the driveway
  area(GRAVEL, [[-52, 9], [62, 9], [62, -39], [157, -39], [160, 50], [135, 62], [60, 73], [-52, 73]]),   // back yard and the tank pad
  area(GRAVEL, PAD_B),
  area(SAND, [[-150, -50], [-52, -50], [-34, -28], [-47.5, -15.5], [-47.5, 12], [-30, 12], [-30, 60], [-50, 73], [-50, 103], [-38, 153], [-38, 195], [-120, 195], [-150, 153]]),
  rect(SAND, -52, -16, -17, 12),
];

/** Signed distance to a polygon's edge: positive inside. */
function depth(pts: P[], u: number, v: number): number {
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

const PAD_BOX = area(GRAVEL, PAD_B).box;
const GRADE_MARGIN = 14, EDGE = 1.8;
/** The pad falls gently to the north-east and rises toward the hill, about as the hillside did. */
const padHeight = (u: number, v: number) => 53.5 + 0.03 * (v - 40) - 0.008 * (u - 180);

/** The mown lawn between the shop and the highway. It has one tree, which the yard model plants. */
const LAWN: P[] = [[-150, -50], [-152, -76], [-80, -85], [0, -82.5], [36, -80], [36, -37], [-18, -37], [-28, -36], [-34, -28], [-52, -50]];

/** The property as a whole, from just inside the highway shoulder back to the trees: closed mode keeps the car out of it. */
export const PROPERTY: P[] = [[-170, -74], [-150, -77.5], [-80, -86], [0, -83.5], [40, -80.5], [120, -73.5], [150, -72.5], [250, -59.5], [340, -50], [340, 200], [-170, 210]];

export class YardSite implements Site {
  readonly box: [number, number, number, number];
  /** Null until the matching model and solids exist; frozen to their bedding height until a rebuild. */
  rampBase: number | null = null;
  private ox: number; private oz: number;
  /** World boxes [x0, z0, x1, z1] where no tree stands: the yard has grown since the land was surveyed. */
  readonly clear: number[][] = [];

  constructor(village: [number, number], readonly mode: YardMode) {
    this.ox = ORIGIN_E - village[0]; this.oz = village[1] - ORIGIN_N;
    const corners = [this.world(-190, -100), this.world(360, -100), this.world(360, 230), this.world(-190, 230)];
    this.box = [Math.min(...corners.map((c) => c.x)), Math.min(...corners.map((c) => c.z)), Math.max(...corners.map((c) => c.x)), Math.max(...corners.map((c) => c.z))];
    // Tree-free strips, 6 m deep, over every surface and over the graded banks of the big pad.
    const step = 3, strip = 6;
    for (let z = this.box[1]; z < this.box[3]; z += strip) {
      let start: number | null = null;
      for (let x = this.box[0]; x <= this.box[2] + step; x += step) {
        const { u, v } = this.local(x, z + strip / 2);
        const open = x <= this.box[2] && (this.kindAt(u, v) > 0 || depth(PAD_B, u, v) > -GRADE_MARGIN || depth(LAWN, u, v) > 0);
        if (open && start === null) start = x;
        if (!open && start !== null) { this.clear.push([start - step, z, x, z + strip]); start = null; }
      }
    }
  }

  /** Yard metres to world metres. */
  world(u: number, v: number): { x: number; z: number } { return { x: this.ox + u * SIN + v * COS, z: this.oz - u * COS + v * SIN }; }
  local(x: number, z: number): { u: number; v: number } {
    const dx = x - this.ox, dz = z - this.oz;
    return { u: dx * SIN - dz * COS, v: dx * COS + dz * SIN };
  }
  /** A world direction (or velocity) in yard axes, and back. */
  localDir(dx: number, dz: number): { u: number; v: number } { return { u: dx * SIN - dz * COS, v: dx * COS + dz * SIN }; }
  worldDir(du: number, dv: number): { x: number; z: number } { return { x: du * SIN + dv * COS, z: -du * COS + dv * SIN }; }
  get origin(): { x: number; z: number } { return { x: this.ox, z: this.oz }; }
  /** The shop's main door, for the interior that will open from it: a world position and the way the door faces. */
  get door(): { x: number; z: number; heading: number } { return { ...this.world(DOOR.u, DOOR.v), heading: this.heading(0, -1) }; }
  /** Rotation about the vertical axis that turns a model's local +x along u and local +z along v. */
  readonly yaw = Math.PI / 2 - AXIS;
  /** Compass heading (clockwise from north) of a direction given in yard axes. */
  heading(du: number, dv: number): number { return Math.atan2(du * SIN + dv * COS, du * COS - dv * SIN); }

  private kindAt(u: number, v: number): number {
    for (const a of AREAS) if (u >= a.box[0] && u <= a.box[2] && v >= a.box[1] && v <= a.box[3] && depth(a.pts, u, v) >= 0) return a.kind;
    return 0;
  }

  /** How far inside the property line a world point is (negative outside). */
  inProperty(x: number, z: number): number { const { u, v } = this.local(x, z); return depth(PROPERTY, u, v); }

  height(x: number, z: number, surveyed: number): number {
    const { u, v } = this.local(x, z);
    if (u < PAD_BOX[0] - GRADE_MARGIN || u > PAD_BOX[2] + GRADE_MARGIN || v < PAD_BOX[1] - GRADE_MARGIN || v > PAD_BOX[3] + GRADE_MARGIN) return surveyed;
    const d = depth(PAD_B, u, v);
    if (d <= -GRADE_MARGIN) return surveyed;
    const w = d >= 0 ? 0 : (-d / GRADE_MARGIN) ** 2 * (3 - (2 * -d) / GRADE_MARGIN);
    return padHeight(u, v) * (1 - w) + surveyed * w;
  }

  /** Exact separate deck, never baked into the coarse terrain grid. Closed mode leaves only the surveyed ground. */
  deckHeight(x: number, z: number): number | null {
    if (this.rampBase === null || this.mode === 'closed' || x < this.box[0] || x > this.box[2] || z < this.box[1] || z > this.box[3]) return null;
    const dx = x - this.ox, dz = z - this.oz, u = dx * SIN - dz * COS, v = dx * COS + dz * SIN;
    const r = SLIP_RAMP, along = r.u - u;
    if (along < 0 || along > r.lead + r.length || Math.abs(v - r.v) > r.width / 2) return null;
    return this.rampBase + slipLift(along);
  }

  surface(x: number, z: number): { dist: number; half: number; kind: number } | null {
    const { u, v } = this.local(x, z);
    let kind = 0, deep = -EDGE, inside = false;
    for (const a of AREAS) {
      if (u < a.box[0] - EDGE || u > a.box[2] + EDGE || v < a.box[1] - EDGE || v > a.box[3] + EDGE) continue;
      const d = depth(a.pts, u, v);
      if (d <= -EDGE) continue;
      if (d >= 0 && !inside) { inside = true; kind = a.kind; }
      if (!inside && d > deep) kind = a.kind;
      if (d > deep) deep = d;
    }
    // The field reads as a road ten metres to a side whose edge is the edge of the surface. Samples just outside
    // the edge carry it too, so the shader can draw the edge between samples and not as steps.
    return kind ? { dist: Math.max(6.5, 10 - deep), half: 10, kind } : null;
  }
}
