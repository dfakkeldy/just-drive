import type { Building } from './buildings';
import type { Site } from './terrain';
import type { Solid } from './parked';

/** Owner-measured map frame. World +x is east, +z is south; all model axes keep their handedness. */
export const CHURCH_ORIGIN = [630835.5, 5080641.6] as const;
export const CHURCH_SCALE = 0.66;
export const CHURCH_HEADING = 297 * Math.PI / 180;
export const CHURCH_GEOM = {
  "nave": {
    "x0": -23.1,
    "x1": -1.1,
    "zn": 7.5,
    "zs": 7.2,
    "eave": 7.8,
    "ridge": 13.7
  },
  "tower": {
    "x1": 2.4,
    "zn": 2.3,
    "zs": 2.1,
    "top": 15.0
  },
  "cupola": {
    "x": 0.7,
    "z": -0.15,
    "r": 1.2,
    "base": 15.0,
    "top": 17.4
  },
  "vestry": {
    "x0": -29.1,
    "z0": 0.1,
    "z1": 7.0,
    "eave": 4.5,
    "ridge": 7.2
  }
} as const;
export const CHURCH_FEATURES = {
  "openings": [
    {
      "kind": "arch",
      "face": "nave_n",
      "u": -17.95,
      "y0": 2.9,
      "y1": 5.25,
      "w": 1.45
    },
    {
      "kind": "arch",
      "face": "nave_n",
      "u": -12.5,
      "y0": 2.9,
      "y1": 5.25,
      "w": 1.45
    },
    {
      "kind": "arch",
      "face": "nave_n",
      "u": -7.3,
      "y0": 2.9,
      "y1": 5.25,
      "w": 1.45
    },
    {
      "kind": "arch",
      "face": "nave_s",
      "u": -17.95,
      "y0": 2.9,
      "y1": 5.25,
      "w": 1.45
    },
    {
      "kind": "arch",
      "face": "nave_s",
      "u": -12.5,
      "y0": 2.9,
      "y1": 5.25,
      "w": 1.45
    },
    {
      "kind": "arch",
      "face": "nave_s",
      "u": -7.3,
      "y0": 2.9,
      "y1": 5.25,
      "w": 1.45
    },
    {
      "kind": "arch",
      "face": "west",
      "u": 3.3,
      "y0": 2.9,
      "y1": 4.95,
      "w": 1.1
    },
    {
      "kind": "rect",
      "face": "west",
      "u": 3.4,
      "y0": 9.0,
      "y1": 10.0,
      "w": 0.9
    },
    {
      "kind": "rect",
      "face": "west",
      "u": -3.4,
      "y0": 9.0,
      "y1": 10.0,
      "w": 0.9
    },
    {
      "kind": "sign",
      "face": "west",
      "u": 5.35,
      "y0": 2.2,
      "y1": 3.5,
      "w": 2.6
    },
    {
      "kind": "door",
      "face": "tower_w",
      "u": 0.0,
      "y0": 0.9,
      "y1": 3.7,
      "w": 1.4
    },
    {
      "kind": "rect",
      "face": "tower_w",
      "u": 0.0,
      "y0": 12.7,
      "y1": 13.7,
      "w": 0.8
    },
    {
      "kind": "rect",
      "face": "tower_s",
      "u": 0.7,
      "y0": 12.7,
      "y1": 13.7,
      "w": 0.8
    },
    {
      "kind": "rect",
      "face": "tower_n",
      "u": 0.7,
      "y0": 12.7,
      "y1": 13.7,
      "w": 0.8
    }
  ],
  "steps": {
    "face": "tower_w",
    "u": 0.0,
    "width": 2.4,
    "rise": 0.9,
    "run": 2.6,
    "count": 4
  }
} as const;

/** Baked road 99, point 939: 80 m along River Denys Road before its nearest church approach.
 * The stored segment runs toward the church; heading is its precomputed angle, clockwise from north in radians. */
export const CHURCH_START = { e: 630770.2, n: 5080667.56, road: 'River Denys Road', heading: 1.4629045852966263 };

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
    this.box = bounds(-33, -11, 41, 31);
    this.clear = [bounds(-30, -8, 3, 8), bounds(4, 10, 38, 26)];
    const solid = (x0: number, x1: number, z0: number, z1: number): Solid => ({
      ...this.world((x0 + x1) / 2, (z0 + z1) / 2), half: (x1 - x0) * CHURCH_SCALE / 2,
      halfWidth: (z1 - z0) * CHURCH_SCALE / 2, heading: CHURCH_HEADING,
    });
    const { nave: n, tower: t, vestry: v } = CHURCH_GEOM;
    this.solids = [solid(n.x0, n.x1, -n.zn, n.zs), solid(n.x1, t.x1, -t.zn, t.zs), solid(v.x0, n.x0, v.z0, v.z1),
      solid(t.x1, t.x1 + CHURCH_FEATURES.steps.run, -1.3, 1.3), solid(19.6, 21, 0.3, 1.7)];
  }
  /** Model units to game metres. +X -> WNW (297°), +Z -> NNE (27°). */
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
  surface(x: number, z: number): { dist: number; half: number; kind: number } | null {
    const p = this.local(x, z), depth = Math.min(p.x - 4, 38 - p.x, p.z - 10, 26 - p.z) * CHURCH_SCALE;
    return depth > -0.8 ? { dist: 10 - Math.min(3.5, depth), half: 10, kind: 11 } : null;
  }
}
