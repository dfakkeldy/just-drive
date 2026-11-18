// Brooks. The bake (pipeline/31_bake_streams.py) traces each mapped brook along the channel that the LiDAR shows and
// writes the lines to streams.json. Here the lines become, for each land tile a brook touches, a small field that
// the land shader paints water from (as it paints roads from the road field), and a shallow cut in the ground.
// The bake removes the run below a road and gives its two mouths. StreamCulverts uses those pairs for arch placements.

export interface StreamFile {
  streams: { id: number; name: string; half: number; pts: [number, number][] }[];
  culverts: { stream: number; road: number; a: [number, number]; b: [number, number]; dia: number; mapped: boolean }[];
}

/** What the nearest brook is at a point. */
export interface BrookAt {
  /** Metres from the centre line: negative on the left looking downstream, positive on the right. */
  side: number;
  /** From the point to the nearest point of the centre line, in world x and z (metres). */
  dx: number;
  dz: number;
  /** Half the width of the water, metres. */
  half: number;
  /** The way the water runs, as a compass heading in radians (0 north, clockwise). */
  flow: number;
}

/** How far from a centre line the field of a tile still knows the brook. */
export const BROOK_REACH = 12.5;
/**
 * The furthest from a centre line that anything is painted or cut (the widest water is 2 m to each side, its banks
 * 3 m more), with a metre to spare. A field is made only for tiles whose samples are at most `BROOK_SAMPLE` apart.
 * Together with the reach these give a guarantee: when one of the samples round a point has no brook (it is 12.5 m
 * or more from every line), the point is more than 12.5 - 2.84 x 2 - 0.15 = 6.6 m from a line by the field's own
 * reckoning, in this tile and in the tile across the edge. So a sample with no brook never changes the picture.
 */
export const BROOK_NEAR = 6;
export const BROOK_SAMPLE = 2;
/** The most that rounding the two parts of a stored vector to 0.1 m can add to its length: 0.05 x the root of 2. */
export const BROOK_ROUNDING = 0.071;
const CELL = 32;
const MAP = 200000;      // metres from the village: no brook of this map is further away
const LONGEST = 500;     // metres: no piece of a traced brook is longer than this
const STRIDE = 5;   // ax, az, bx, bz, half

export interface StreamPipe { x: number; z: number; endX: number; endZ: number; dia: number; road: number }

export class Streams {
  readonly pipes: StreamPipe[] = [];
  /** Culvert mouths in world coordinates: `out` points away from the road, along the pipe. Parsed input only now
   * (StreamCulverts draws arches from `pipes`); tools/streams-check.mjs pins it against the baked pairs. */
  readonly mouths: { x: number; z: number; outX: number; outZ: number; dia: number }[] = [];
  private readonly seg: Float32Array;
  private readonly cells = new Map<number, number[]>();
  readonly km: number;

  constructor(data: StreamFile, village: [number, number]) {
    const seg: number[] = [];
    let metres = 0;
    // A broken file must not stop the game, and must not keep it busy either: every number is checked before it
    // sets the length of a loop. A real piece is a few metres long and lies within the map.
    const sane = (v: number) => Number.isFinite(v) && Math.abs(v) < MAP;
    for (const s of Array.isArray(data?.streams) ? data.streams : []) {
      if (!s || !Array.isArray(s.pts) || !(s.half > 0) || !(s.half <= 10)) continue;
      for (let k = 0; k + 1 < s.pts.length; k++) {
        const p = s.pts[k], q = s.pts[k + 1];
        if (!Array.isArray(p) || !Array.isArray(q)) continue;
        const ax = p[0] - village[0], az = village[1] - p[1];
        const bx = q[0] - village[0], bz = village[1] - q[1];
        if (!sane(ax) || !sane(az) || !sane(bx) || !sane(bz)) continue;
        const len = Math.hypot(bx - ax, bz - az);
        if (!(len > 0.01) || len > LONGEST) continue;
        metres += len;
        const i = seg.length / STRIDE;
        seg.push(ax, az, bx, bz, s.half);
        // Each piece is listed in every cell its reach touches, so a look-up reads one cell only.
        const x0 = Math.floor((Math.min(ax, bx) - BROOK_REACH) / CELL), x1 = Math.floor((Math.max(ax, bx) + BROOK_REACH) / CELL);
        const z0 = Math.floor((Math.min(az, bz) - BROOK_REACH) / CELL), z1 = Math.floor((Math.max(az, bz) + BROOK_REACH) / CELL);
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const key = this.key(cx, cz);
          const list = this.cells.get(key);
          if (list) list.push(i); else this.cells.set(key, [i]);
        }
      }
    }
    this.seg = new Float32Array(seg);
    this.km = metres / 1000;
    for (const c of Array.isArray(data?.culverts) ? data.culverts : []) {
      if (!c || !Array.isArray(c.a) || !Array.isArray(c.b)) continue;
      const ax = c.a[0] - village[0], az = village[1] - c.a[1], bx = c.b[0] - village[0], bz = village[1] - c.b[1];
      if (!sane(ax) || !sane(az) || !sane(bx) || !sane(bz)) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (!(len > 1) || len > LONGEST || !(c.dia > 0) || !(c.dia <= 5)) continue;
      const ux = (ax - bx) / len, uz = (az - bz) / len;
      this.pipes.push({ x: ax, z: az, endX: bx, endZ: bz, dia: c.dia, road: c.road });
      this.mouths.push({ x: ax, z: az, outX: ux, outZ: uz, dia: c.dia }, { x: bx, z: bz, outX: -ux, outZ: -uz, dia: c.dia });
    }
  }

  private key(cx: number, cz: number): number { return (cx + 4096) * 8192 + (cz + 4096); }

  /** True when a brook comes within reach of a box (world x and z). A cheap test before a tile builds its field. */
  near(x0: number, z0: number, x1: number, z1: number): boolean {
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) if (this.cells.has(this.key(cx, cz))) return true;
    }
    return false;
  }

  /** Every piece of brook that may reach into a box, in rising order, each once. */
  pieces(x0: number, z0: number, x1: number, z1: number): number[] {
    const found = new Set<number>();
    for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        const list = this.cells.get(this.key(cx, cz));
        if (list) for (const i of list) found.add(i);
      }
    }
    return [...found].sort((a, b) => a - b);
  }

  /** The pieces themselves, five numbers each: ax, az, bx, bz, half width. */
  get segments(): Float32Array { return this.seg; }

  /** The nearest brook within reach of a point. False when there is none; `out` is then left alone. */
  at(x: number, z: number, out: BrookAt): boolean {
    const list = this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!list) return false;
    const s = this.seg;
    let best = BROOK_REACH * BROOK_REACH, hit = -1, bt = 0;
    for (const i of list) {
      const o = i * STRIDE, ax = s[o], az = s[o + 1], dx = s[o + 2] - ax, dz = s[o + 3] - az;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const px = x - (ax + t * dx), pz = z - (az + t * dz), d = px * px + pz * pz;
      // Ties go to the earlier piece, whatever the order of the look-up.
      if (d < best || (d === best && i < hit)) { best = d; hit = i; bt = t; }
    }
    if (hit < 0) return false;
    const o = hit * STRIDE, ax = s[o], az = s[o + 1], dx = s[o + 2] - ax, dz = s[o + 3] - az;
    // Right of the direction of flow is positive. World x is east and z is south, so the cross product is turned.
    const nx = ax + bt * dx - x, nz = az + bt * dz - z;
    const cross = dz * nx - dx * nz;
    out.side = (cross > 0 ? 1 : -1) * Math.sqrt(best);
    out.dx = nx; out.dz = nz;
    out.half = s[o + 4];
    out.flow = Math.atan2(dx, -dz);
    return true;
  }

  /** How far the bed lies below the surveyed ground, `d` metres from the centre line of a brook of this half width. */
  static cut(d: number, half: number): number {
    // The LiDAR already holds the real gully. This adds only a soft crease the width of a few mesh cells, so the
    // painted water lies in a dip and not on a hillside.
    const depth = 0.22 + 0.16 * Math.min(half, 2), reach = half + 2.4;
    if (d >= reach) return 0;
    const t = 1 - d / reach;
    return depth * t * t * (3 - 2 * t);
  }
}

/**
 * The field of one tile for the land shader: RGBA for each sample, row by row.
 *   R, G  from the sample to the nearest point of a centre line, in world x and z: 128 is zero, one step is 0.1 m
 *   B     half width of the water, one step is 0.02 m; 0 means no brook is near this sample
 *   A     direction of flow around the compass, 256 steps
 * Returns null when no sample of the tile is within reach of a brook.
 * Why a vector and not a distance: the shader blends the four samples round a point. A blended vector passes
 * through zero on the centre line, so a brook narrower than one sample comes out whole; and the blend needs no
 * choice between two formulas, so two tiles that share an edge paint the same thing along it.
 * Each piece of brook marks the samples near it (not each sample looking for its brook): a tile is built while the
 * game runs, on a phone too, and this way costs about a twentieth.
 */
export function brookField(streams: Streams, x0: number, z0: number, size: number, samples: number): Uint8Array | null {
  const pieces = streams.pieces(x0, z0, x0 + size, z0 + size);
  if (!pieces.length) return null;
  const n = samples, step = size / (n - 1), seg = streams.segments;
  // Whole precision for the distances: where two brooks meet, two pieces are equally near, and a rounded number
  // would let the later one win.
  const best = new Float64Array(n * n).fill(BROOK_REACH * BROOK_REACH), hit = new Int32Array(n * n).fill(-1), along = new Float64Array(n * n);
  // Pieces come in rising order and only a strictly nearer one takes a sample: ties go to the earlier piece, as in `at`.
  for (const i of pieces) {
    const o = i * STRIDE, ax = seg[o], az = seg[o + 1], dx = seg[o + 2] - ax, dz = seg[o + 3] - az, ll = dx * dx + dz * dz;
    const a0 = Math.max(0, Math.ceil((Math.min(ax, ax + dx) - BROOK_REACH - x0) / step)), a1 = Math.min(n - 1, Math.floor((Math.max(ax, ax + dx) + BROOK_REACH - x0) / step));
    const b0 = Math.max(0, Math.ceil((Math.min(az, az + dz) - BROOK_REACH - z0) / step)), b1 = Math.min(n - 1, Math.floor((Math.max(az, az + dz) + BROOK_REACH - z0) / step));
    for (let b = b0; b <= b1; b++) {
      const z = z0 + b * step;
      for (let a = a0; a <= a1; a++) {
        const x = x0 + a * step;
        const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / ll));
        const px = x - (ax + t * dx), pz = z - (az + t * dz), d = px * px + pz * pz, k = b * n + a;
        if (d < best[k]) { best[k] = d; hit[k] = i; along[k] = t; }
      }
    }
  }
  const out = new Uint8Array(n * n * 4);
  const byte = (v: number) => Math.min(255, Math.max(0, Math.round(128 + v * 10)));
  let any = false;
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const k = b * n + a, q = k * 4;
      if (hit[k] < 0) continue;   // all four bytes stay 0: no brook near
      any = true;
      const o = hit[k] * STRIDE, ax = seg[o], az = seg[o + 1], dx = seg[o + 2] - ax, dz = seg[o + 3] - az;
      const x = x0 + a * step, z = z0 + b * step, t = along[k];
      out[q] = byte(ax + t * dx - x);
      out[q + 1] = byte(az + t * dz - z);
      out[q + 2] = Math.min(255, Math.max(1, Math.round(seg[o + 4] * 50)));
      out[q + 3] = Math.round(((Math.atan2(dx, -dz) / (2 * Math.PI)) % 1 + 1) % 1 * 255);
    }
  }
  return any ? out : null;
}

/**
 * Metres from any point of a tile to the nearest centre line, read from the tile's field: the same maths as the land
 * shader (the brook block of TERRAIN_FRAG in shaders.ts), so the wheels and the picture agree. Keep the two alike.
 * `fa`, `fb`: the point in samples from the tile's north-west corner; `metres`: the size of one sample.
 * Returns 99 when the point is more than `BROOK_NEAR` from a brook: nothing is painted or cut that far out.
 *
 * The four samples round the point each hold the vector to the line; their blend passes through zero on the line.
 * Between two separate brooks the vectors point opposite ways and would also blend to zero, where there is no water.
 * So each sample also sets a floor: a sample that is 8 m from every brook proves that a point 2 m from it is at
 * least 6 m from one (less the rounding of the stored vector, so the floor is never above the truth). On the edge
 * of a tile only the two edge samples count (the others fade out with their share
 * of the blend), so the tile next door gets the same answer along that edge.
 */
export function brookBlend(field: Uint8Array, n: number, metres: number, fa: number, fb: number): number {
  const a = Math.min(Math.max(Math.floor(fa), 0), n - 2), b = Math.min(Math.max(Math.floor(fb), 0), n - 2);
  const u = fa - a, v = fb - b;
  const at = [b * n + a, b * n + a + 1, (b + 1) * n + a, (b + 1) * n + a + 1];
  const share = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
  const away = [Math.hypot(u, v), Math.hypot(u - 1, v), Math.hypot(u, v - 1), Math.hypot(u - 1, v - 1)];
  let x = 0, z = 0, floor = -Infinity;
  for (let i = 0; i < 4; i++) {
    const q = at[i] * 4;
    if (field[q + 2] === 0) return 99;
    const vx = field[q] * 0.1 - 12.8, vz = field[q + 1] * 0.1 - 12.8;
    x += vx * share[i]; z += vz * share[i];
    floor = Math.max(floor, Math.hypot(vx, vz) - BROOK_ROUNDING - away[i] * metres - 20 * (1 - Math.min(1, share[i] * 8)));
  }
  const d = Math.max(Math.hypot(x, z), floor);
  return d > BROOK_NEAR ? 99 : d;
}

/** Metres from a sample of a tile's field to the centre line of its brook; a large number when the sample has none. */
export function brookDistance(field: Uint8Array, k: number): number {
  return field[k * 4 + 2] > 0 ? Math.hypot(field[k * 4] - 128, field[k * 4 + 1] - 128) * 0.1 : 99;
}
