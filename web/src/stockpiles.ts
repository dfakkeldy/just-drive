import * as THREE from 'three';
import type { Manifest, Terrain } from './terrain';

type Vertex = [number, number, number, number]; // east, north, DTM, measured surface
export interface Mound { vertices: Vertex[]; indices: number[]; axis: number }
export interface Pile { id: string; kind: 'coal' | 'logs'; center: [number, number]; high: Mound[]; low: Mound[] }
export interface PileFile { version: 1; crs: 'EPSG:2961'; area: string; piles: Pile[] }
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid stockpile record');
  return v as Record<string, unknown>;
}
function finite(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Invalid stockpile number');
  return v;
}
function array(v: unknown, cap: number): unknown[] {
  if (!Array.isArray(v) || v.length > cap) throw new Error('Invalid stockpile array');
  return v;
}
export function parseStockpiles(value: unknown, area: string): PileFile {
  const d = record(value);
  if (d.version !== 1 || d.crs !== 'EPSG:2961' || d.area !== area) throw new Error('Invalid stockpile pack');
  const piles = array(d.piles, 8).map(value => {
    const p = record(value), center = array(p.center, 2).map(finite);
    if (center.length !== 2 || typeof p.id !== 'string' || !/^(DAPI40|DASA42)\/\d+$/.test(p.id) || (p.kind !== 'coal' && p.kind !== 'logs')) throw new Error('Invalid stockpile site');
    const parts = (v: unknown): Mound[] => array(v, 64).map(value => {
      const m = record(value), vertices = array(m.vertices, 10000).map(value => {
        const v = array(value, 4).map(finite);
        if (v.length !== 4 || Math.hypot(v[0]-center[0], v[1]-center[1]) > 1000 || v[2] < -10 || v[2] > 500 || v[3] < v[2] || v[3]-v[2] > 12) throw new Error('Invalid stockpile vertex');
        return v as Vertex;
      });
      const indices = array(m.indices, 60000).map(finite);
      if (!vertices.length || !indices.length || indices.length % 3 || indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length)) throw new Error('Invalid stockpile faces');
      return { vertices, indices, axis: finite(m.axis) };
    });
    return { id: p.id, kind: p.kind, center: center as [number, number], high: parts(p.high), low: parts(p.low) } as Pile;
  });
  if (new Set(piles.map(p => p.id)).size !== piles.length) throw new Error('Duplicate stockpile site');
  return { version: 1, crs: 'EPSG:2961', area, piles };
}
export function pileHeight(v: Vertex, terrain: Pick<Terrain, 'seaLevel' | 'exag'>): number {
  const ground = v[2] > terrain.seaLevel ? terrain.seaLevel + (v[2]-terrain.seaLevel)*terrain.exag : v[2];
  return ground + v[3]-v[2];
}
/**
 * Match the rendered terrain's finest 2 m lattice, including face interiors. `plan` moves vertices in the map
 * (a straightened outline); the split count still comes from the baked grid, so faces that share an edge split
 * it alike and the skin has no cracks.
 */
export function denseMound(m: Mound, plan?: [number, number][]): Mound {
  const vertices: Vertex[] = [], indices: number[] = [], seen = new Map<string, number>();
  const add = (v: Vertex) => {
    const key=`${v[0].toFixed(4)}_${v[1].toFixed(4)}`;
    let i=seen.get(key); if(i===undefined){i=vertices.length;seen.set(key,i);vertices.push(v);} return i;
  };
  for(let k=0;k<m.indices.length;k+=3){
    const ids=m.indices.slice(k,k+3), [a0,b0,c0]=ids.map(i=>m.vertices[i]);
    const n=Math.max(1,Math.ceil(Math.max(Math.abs(b0[0]-a0[0]),Math.abs(b0[1]-a0[1]),Math.abs(c0[0]-a0[0]),Math.abs(c0[1]-a0[1]))/2));
    const [a,b,c]=ids.map(i=>plan ? [plan[i][0],plan[i][1],m.vertices[i][2],m.vertices[i][3]] as Vertex : m.vertices[i]);
    const at=(u:number,v:number)=>add(a.map((x,j)=>x+(b[j]-x)*u/n+(c[j]-x)*v/n) as Vertex);
    for(let u=0;u<n;u++)for(let v=0;v<n-u;v++){
      indices.push(at(u,v),at(u+1,v),at(u,v+1));
      if(u+v<n-1)indices.push(at(u+1,v),at(u+1,v+1),at(u,v+1));
    }
  }
  return {vertices,indices,axis:m.axis};
}
/** Repeatable 0..1 noise from map coordinates (integer maths only: the same on every machine). */
export function pileNoise(east: number, north: number, salt = 0): number {
  let h = Math.imul(Math.round(east * 8) | 0, 374761393) ^ Math.imul(Math.round(north * 8) | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Edges with a face on one side only, each with its unit outward direction in map coordinates. */
export function moundRim(m: Mound): { a: number; b: number; out: [number, number] }[] {
  const edges = new Map<number, { a: number; b: number; c: number; n: number }>(), n = m.vertices.length;
  for (let i = 0; i < m.indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = m.indices[i + k], b = m.indices[i + (k + 1) % 3], c = m.indices[i + (k + 2) % 3];
    const key = Math.min(a, b) * n + Math.max(a, b), edge = edges.get(key);
    if (edge) edge.n++; else edges.set(key, { a, b, c, n: 1 });
  }
  return [...edges.values()].filter(e => e.n === 1).map(({ a, b, c }) => {
    const A = m.vertices[a], B = m.vertices[b], C = m.vertices[c];
    let x = B[1] - A[1], y = A[0] - B[0];
    const length = Math.hypot(x, y) || 1;
    if (x * (C[0] - A[0]) + y * (C[1] - A[1]) > 0) { x = -x; y = -y; }   // away from the face's third corner
    return { a, b, out: [x / length, y / length] as [number, number] };
  });
}
/** How far the stack outline may move from the baked faces (the bake keeps 3 m from roads, 4 m from buildings). */
export const OUTLINE_SHIFT = 1.5;
/** The share of its baked area a face must keep when the outline is straightened. */
export const FOLD_SHARE = 0.05;
/** How far a stub log's end may stand out of a stack wall, metres. */
export const STUB_REACH = 0.35;
const STUB_LENGTH = 1.6, STUB_RADIUS = 0.2, WALL_FOOT = 0.3, COAL_FOOT = 0.35;
/**
 * Map positions with the outline straightened. The bake's outline steps along its 4 or 8 m grid; each outline
 * vertex moves towards its two neighbours on the outline, never more than OUTLINE_SHIFT from where it was baked.
 */
export function straighten(m: Mound, rim = moundRim(m)): [number, number][] {
  const next = new Map<number, number[]>();
  for (const { a, b } of rim) { next.set(a, [...(next.get(a) ?? []), b]); next.set(b, [...(next.get(b) ?? []), a]); }
  let plan = m.vertices.map(v => [v[0], v[1]] as [number, number]);
  for (let pass = 0; pass < 2; pass++) plan = plan.map((p, i) => {
    const near = next.get(i);
    if (near?.length !== 2) return p;   // inside the pile, or a pinch point
    const q: [number, number] = [p[0] / 2 + (plan[near[0]][0] + plan[near[1]][0]) / 4, p[1] / 2 + (plan[near[0]][1] + plan[near[1]][1]) / 4];
    const moved = Math.hypot(q[0] - m.vertices[i][0], q[1] - m.vertices[i][1]);
    return moved <= OUTLINE_SHIFT ? q : [m.vertices[i][0] + (q[0] - m.vertices[i][0]) * OUTLINE_SHIFT / moved, m.vertices[i][1] + (q[1] - m.vertices[i][1]) * OUTLINE_SHIFT / moved];
  });
  // The moved outline must not fold a face over or flatten it to a sliver (under a twentieth of its area): the
  // corners of such a face go back to where they were baked.
  const turn = (at: (i: number) => ArrayLike<number>, a: number, b: number, c: number) =>
    (at(b)[0] - at(a)[0]) * (at(c)[1] - at(a)[1]) - (at(b)[1] - at(a)[1]) * (at(c)[0] - at(a)[0]);
  for (let folded = true; folded;) {
    folded = false;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i], b = m.indices[i + 1], c = m.indices[i + 2];
      const baked = turn(k => m.vertices[k], a, b, c);
      if (turn(k => plan[k], a, b, c) * baked >= FOLD_SHARE * baked * baked) continue;
      for (const k of [a, b, c]) plan[k] = [m.vertices[k][0], m.vertices[k][1]];
      folded = true;
    }
  }
  return plan;
}
export interface Stub { a: number; b: number; t: number; rise: number; reach: number; side: 1 | -1; girth: number }
export interface Stack {
  /** One per pack vertex: map position with the outline straightened, and height above the ground. */
  points: { east: number; north: number; height: number }[];
  faces: number[];
  walls: { a: number; b: number }[];
  /** Short logs that stand out of the walls the log ends face. */
  stubs: Stub[];
  /** Unit direction of the row in map coordinates; the logs lie across it. */
  along: [number, number];
}
/**
 * A measured log stack as a solid block: the pack's top faces, walls down to the ground on its outline, and a
 * bounded number of stub logs. The bake samples heights every 4 or 8 m, which smears a stack's upright sides into a
 * ramp and steps its outline along the grid, so the outline is straightened (see `straighten`) and its
 * heights lifted towards the heights just inside. The logs are a suggestion, not surveyed objects.
 */
export function stackShape(m: Mound, low: boolean): Stack {
  const rim = moundRim(m), along: [number, number] = [Math.cos(m.axis), Math.sin(m.axis)], across: [number, number] = [-along[1], along[0]];
  const outline = new Set(rim.flatMap(e => [e.a, e.b])), touch = new Map<number, Set<number>>();
  for (let i = 0; i < m.indices.length; i += 3) for (let k = 0; k < 3; k++) {
    const a = m.indices[i + k];
    if (!touch.has(a)) touch.set(a, new Set());
    touch.get(a)!.add(m.indices[i + (k + 1) % 3]).add(m.indices[i + (k + 2) % 3]);
  }
  const plan = straighten(m, rim);
  const raw = m.vertices.map(v => v[3] - v[2]);
  const points = plan.map(([east, north], i) => ({ east, north, height: outline.has(i) ? Math.max(raw[i], 0.85 * Math.max(...[...touch.get(i) ?? []].map(k => raw[k]))) : raw[i] }));
  const stubs: Stub[] = [], perEdge = low ? 2 : 3;
  for (const { a, b, out } of rim) {
    const facing = out[0] * across[0] + out[1] * across[1];
    if (Math.abs(facing) < 0.5) continue;   // the log ends face the long walls only
    for (let k = 0; k < perEdge; k++) {
      const east = m.vertices[a][0] + m.vertices[b][0], north = m.vertices[a][1] + m.vertices[b][1], r = (salt: number) => pileNoise(east, north, k * 8 + salt);
      // The first stub of each edge lies on the top edge, so the skyline of a wall is a row of log ends, not a ruled line.
      stubs.push({ a, b, t: (k + 0.2 + 0.6 * r(1)) / perEdge, rise: k === 0 ? 1 : 0.3 + 0.6 * r(2), reach: 0.05 + (STUB_REACH - 0.05) * r(3), side: facing > 0 ? 1 : -1, girth: 0.85 + 0.4 * r(4) });
    }
  }
  return { points, faces: m.indices, walls: rim.map(({ a, b }) => ({ a, b })), stubs, along };
}
/** The stub logs of a whole site, thinned evenly to the quality's cap. */
export function stubLayout(stacks: Stack[], low: boolean): { stack: number; stub: Stub }[] {
  const all = stacks.flatMap((s, stack) => s.stubs.map(stub => ({ stack, stub }))), cap = low ? 384 : 1536, stride = Math.max(1, Math.ceil(all.length / cap));
  return all.filter((_, i) => i % stride === 0);
}
type Ground = Pick<Terrain, 'seaLevel' | 'exag'> & Partial<Pick<Terrain, 'meshHeightAt' | 'surfaceAt'>>;
interface Seat { fit: (force?: boolean) => boolean; refits: number }
interface Site extends Seat { id: string; group: THREE.Group; center: [number, number]; radius: number }
/** One number for an 8 m cell of the map (the cell indices stay below 2^20; a pile's box is tested first). */
const cell = (x: number, y: number) => x * 1048576 + y;
const linear = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
const glsl = (c: THREE.Color) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
const END_PALE = linear(0.80, 0.69, 0.50), END_DARK = linear(0.62, 0.52, 0.38), BARK_PALE = linear(0.40, 0.33, 0.25), BARK_DARK = linear(0.28, 0.22, 0.17), GAP = linear(0.10, 0.08, 0.06);
/**
 * One material for both skins, with no texture. A vertex with a row direction (`logAxis`) is part of a log stack:
 * its colour is a solid pattern of logs lying across the row, packed like a real stack, so a wall the ends face
 * shows discs, the top shows the logs side by side, and an end wall shows them lengthwise. The pattern fades to
 * its mean colour before it is finer than the picture. Coal vertices carry no direction and keep their own colour.
 */
function skinMaterial(): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute vec2 logAxis;\nvarying vec2 vLogAxis;\nvarying vec3 vLogWorld;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLogAxis = logAxis;\n  vLogWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec2 vLogAxis;\nvarying vec3 vLogWorld;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  vec3 logDx = dFdx(vLogWorld), logDy = dFdy(vLogWorld);   // derivatives are taken outside the branch
  if (dot(vLogAxis, vLogAxis) > 0.25) {
    vec2 rowDir = normalize(vLogAxis);
    vec3 face = normalize(cross(logDx, logDy));
    float endOn = smoothstep(0.3, 0.6, abs(face.z * rowDir.x - face.x * rowDir.y));
    vec2 p = vec2(dot(vLogWorld.xz, rowDir), vLogWorld.y) / 0.46;
    float fine = max(abs(dot(logDx.xz, rowDir)) + abs(dot(logDy.xz, rowDir)), abs(logDx.y) + abs(logDy.y)) / 0.46;
    float row = floor(p.y / 0.866);
    float px = p.x + 0.5 * mod(row, 2.0);
    vec2 d = vec2(fract(px) - 0.5, (p.y / 0.866 - row - 0.5) * 0.866);
    float r = length(d), tone = fract(sin(dot(mod(vec2(floor(px), row), 289.0), vec2(12.9898, 78.233))) * 43758.5453);
    float inside = 1.0 - smoothstep(0.40, 0.47, r);
    vec3 endGrain = mix(${glsl(END_DARK)}, ${glsl(END_PALE)}, tone) * (0.8 + 0.2 * smoothstep(0.0, 0.3, r));
    vec3 bark = mix(${glsl(BARK_DARK)}, ${glsl(BARK_PALE)}, tone) * (0.4 + 0.6 * sqrt(max(0.0, 1.0 - 4.0 * r * r)));
    vec3 mean = mix(${glsl(BARK_DARK.clone().lerp(BARK_PALE, 0.5).multiplyScalar(0.8))}, ${glsl(GAP.clone().lerp(END_DARK.clone().lerp(END_PALE, 0.5), 0.72))}, endOn);
    diffuseColor.rgb = mix(mix(bark, mix(${glsl(GAP)}, endGrain, inside), endOn), mean, smoothstep(0.35, 0.9, fine));
  }`);
  };
  material.customProgramCacheKey = () => 'stockpile-skin-r170-2';
  return material;
}
/** Measured coal skins and solid log stacks with stub logs, no imagery or textures: three draw calls at most. */
export class Stockpiles {
  readonly group = new THREE.Group();
  readonly sites: Site[] = [];
  private next = 0;
  private warm = 0;
  private dummy = new THREE.Object3D();
  private buckets = new Map<number, [Vertex, Vertex, Vertex][]>();
  private boxes: number[][] = [];
  static async load(manifest: Manifest, getJson: (path: string) => Promise<unknown>, terrain: Terrain, low: boolean, area: string): Promise<Stockpiles | null> {
    if (!manifest.stockpiles) return null;
    try {
      const data = parseStockpiles(await getJson(manifest.stockpiles.file), area);
      if (data.piles.length !== manifest.stockpiles.count) throw new Error('Stockpile count mismatch');
      return new Stockpiles(data, manifest.village, terrain, low);
    } catch (error) { console.warn('stockpiles unavailable', error); return null; }
  }
  constructor(readonly data: PileFile, private origin: [number, number], private terrain: Ground, private low: boolean) {
    this.group.name = 'stockpiles';
    const skin = skinMaterial();
    const stubGeometry = new THREE.CylinderGeometry(STUB_RADIUS, STUB_RADIUS, STUB_LENGTH, low ? 5 : 6).rotateZ(Math.PI / 2);
    stubGeometry.deleteAttribute('uv');
    const normals = stubGeometry.getAttribute('normal'), colours: number[] = [];
    for (let i = 0; i < normals.count; i++) colours.push(...(Math.abs(normals.getX(i)) > 0.8 ? END_PALE : BARK_DARK).toArray());
    stubGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    const stubMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const pile of data.piles) {
      const parts = low ? pile.low : pile.high;
      if (!parts.length) continue;
      const group = new THREE.Group(); group.visible = false; this.group.add(group);
      const { points, seat } = pile.kind === 'coal' ? this.coal(parts, group, skin) : this.logs(parts, group, skin, stubGeometry, stubMaterial);
      const radius = Math.max(...points.map(p => Math.hypot(p.east - pile.center[0], p.north - pile.center[1])));
      this.sites.push(Object.assign(seat, { id: pile.id, group, center: pile.center, radius }));
      // Suppress false tree returns, canopy and grass only inside the baked faces, in either quality. The land
      // asks for every texel it builds, so each pile has its own box and the 8 m cells have number keys.
      const box = [Infinity, Infinity, -Infinity, -Infinity]; this.boxes.push(box);
      for (const mound of [...pile.high, ...pile.low]) for (let i = 0; i < mound.indices.length; i += 3) {
        const triangle = mound.indices.slice(i, i + 3).map(k => mound.vertices[k]) as [Vertex, Vertex, Vertex];
        const east = triangle.map(v => v[0]), north = triangle.map(v => v[1]);
        box[0] = Math.min(box[0], ...east); box[1] = Math.min(box[1], ...north); box[2] = Math.max(box[2], ...east); box[3] = Math.max(box[3], ...north);
        for (let x = Math.floor(Math.min(...east) / 8); x <= Math.floor(Math.max(...east) / 8); x++)
          for (let y = Math.floor(Math.min(...north) / 8); y <= Math.floor(Math.max(...north) / 8); y++) {
            const key = cell(x, y), bucket = this.buckets.get(key) ?? []; bucket.push(triangle); this.buckets.set(key, bucket);
          }
      }
    }
    if (!this.sites.length) { skin.dispose(); stubGeometry.dispose(); stubMaterial.dispose(); }
  }
  /** Ground height in the game at a map point as the pack measured it: used until the drawn land is read. */
  private baked(dtm: number): number { return pileHeight([0, 0, dtm, dtm], this.terrain); }
  /**
   * The land under a map point, or null while it is not loaded finely enough to stand a pile on. `exact` says the
   * height is the drawn mesh's. The land draws only the tiles in view, so out of view the height is the land's own
   * sample (close to the mesh, not equal to it).
   */
  private drawn(east: number, north: number, out: { exact: boolean }): number | null {
    const x = east - this.origin[0], z = this.origin[1] - north, surface = this.terrain.surfaceAt!(x, z);
    if (!surface || surface.level < 6) return null;
    const mesh = this.terrain.meshHeightAt!(x, z, true);
    out.exact = mesh !== null;
    return mesh ?? surface.ground;
  }
  /**
   * Seats a site on the drawn land. Reading it for every vertex costs a few milliseconds, so a few probe points
   * are read on each pass and the rest only when a probe has moved (a tile changed detail under the pile).
   * A height read from the drawn mesh stays until the mesh is read again with another value: turning the camera
   * takes tiles out of the picture, and that must not move a pile or read it again. Each pass also reads the next
   * few points in turn, so within some passes every point is compared with the land again (a tile without a probe).
   * `force` reads everything again (the browser check times it). False while the land is too coarse to stand on.
   */
  private seat(points: { east: number; north: number }[], ground: Float32Array, apply: () => void): Seat {
    const stride = Math.max(1, Math.floor(points.length / 32)), read = { exact: false };
    // How each height was read: 0 not yet, 1 the land's sample, 2 the drawn mesh.
    const probes = new Float64Array(Math.ceil(points.length / stride)).fill(NaN), probeFrom = new Uint8Array(probes.length), from = new Uint8Array(points.length);
    let known = 0, turn = 0;
    const site: Seat = { refits: 0, fit: (force = false): boolean => {
      if (!this.terrain.meshHeightAt || !this.terrain.surfaceAt) return true;   // geometry fixtures have no drawn land
      let changed = force, land = false;
      for (let k = 0; k < probes.length; k++) {
        const y = this.drawn(points[k * stride].east, points[k * stride].north, read), source = read.exact ? 2 : 1;
        if (y === null) continue;
        land = true;
        if (source < probeFrom[k]) continue;
        const now = Math.round(y * 50);
        if (now === probes[k] && source === probeFrom[k]) continue;
        probes[k] = now; probeFrom[k] = source; changed = true;
      }
      for (let n = Math.min(32, points.length); n > 0 && !changed; n--, turn = (turn + 1) % points.length) {
        const y = this.drawn(points[turn].east, points[turn].north, read), source = read.exact ? 2 : 1;
        if (y !== null && (source > from[turn] || (source === from[turn] && Math.abs(y - ground[turn]) > 0.02))) changed = true;
      }
      // Land that turned coarse under a seated pile (a jump away and back) hides it until fine land is there again.
      if (!changed) return land && known > 0;
      points.forEach((p, i) => {
        const y = this.drawn(p.east, p.north, read), source = read.exact ? 2 : 1;
        if (y === null || source < from[i]) return;
        if (!from[i]) known++;
        ground[i] = y; from[i] = source;
      });
      apply(); site.refits++;
      return land && known > 0;
    } };
    return site;
  }
  /** Coal lies in the terrain already (the land's height model holds the pile): a lumpy dark skin just above it. */
  private coal(parts: Mound[], group: THREE.Group, material: THREE.Material): { points: { east: number; north: number }[]; seat: Seat } {
    const dense = parts.map(m => denseMound(m, straighten(m))), points: { east: number; north: number; lift: number }[] = [], indices: number[] = [], colours: number[] = [], start: number[] = [];
    for (const mound of dense) {
      const offset = points.length, edge = new Set(moundRim(mound).flatMap(e => [e.a, e.b]));
      mound.vertices.forEach((v, i) => {
        // The outline goes under the ground, so the skin ends where it meets the land, with no lifted edge.
        points.push({ east: v[0], north: v[1], lift: edge.has(i) ? -COAL_FOOT : 0.14 + 0.36 * pileNoise(v[0], v[1], 1) });
        start.push(this.baked(v[2]));
        // Dark grey, a little warm (the sky's light on a shaded face is blue), uneven like broken coal.
        const shade = 0.14 + 0.16 * pileNoise(v[0], v[1], 2) + (pileNoise(v[0], v[1], 3) > 0.92 ? 0.07 : 0);
        colours.push(...linear(shade + 0.012, shade + 0.006, shade).toArray());
      });
      indices.push(...mound.indices.map(i => i + offset));
    }
    const ground = Float32Array.from(start), position = new THREE.Float32BufferAttribute(points.length * 3, 3), geometry = new THREE.BufferGeometry();
    const apply = () => {
      points.forEach((p, i) => position.setXYZ(i, p.east - this.origin[0], ground[i] + p.lift, this.origin[1] - p.north));
      position.needsUpdate = true; geometry.computeBoundingSphere(); geometry.computeVertexNormals();   // normals: the shadow bias needs them
    };
    geometry.setAttribute('position', position); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geometry.setAttribute('logAxis', new THREE.Float32BufferAttribute(points.length * 2, 2)); geometry.setIndex(indices); apply();
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = !this.low; group.add(mesh);
    return { points, seat: this.seat(points, ground, apply) };
  }
  /** Log stacks stand on the yard: solid blocks to the measured height, their sides down into the ground. */
  private logs(parts: Mound[], group: THREE.Group, material: THREE.Material, stubGeometry: THREE.BufferGeometry, stubMaterial: THREE.Material): { points: { east: number; north: number }[]; seat: Seat } {
    const stacks = parts.map(m => stackShape(m, this.low)), offsets: number[] = [], points: Stack['points'] = [], start: number[] = [];
    stacks.forEach((s, k) => { offsets.push(points.length); points.push(...s.points); start.push(...parts[k].vertices.map(v => this.baked(v[2]))); });
    const ground = Float32Array.from(start), indices: number[] = [], axis: number[] = [];
    // Top vertices first, one per point; then four of its own for each wall, so every face shades flat.
    const corners: { point: number; top: boolean }[] = points.map((_, point) => ({ point, top: true }));
    stacks.forEach((s, k) => {
      const o = offsets[k], row = [s.along[0], -s.along[1]];   // map north is the game's -z
      for (let i = 0; i < s.points.length; i++) axis.push(...row);
      indices.push(...s.faces.map(i => i + o));
      for (const wall of s.walls) {
        const c = corners.length;
        corners.push({ point: wall.a + o, top: true }, { point: wall.b + o, top: true }, { point: wall.a + o, top: false }, { point: wall.b + o, top: false });
        for (let i = 0; i < 4; i++) axis.push(...row);
        indices.push(c, c + 2, c + 1, c + 1, c + 2, c + 3);   // wound so that the normals (shadow bias) point out of the stack
      }
    });
    const position = new THREE.Float32BufferAttribute(corners.length * 3, 3), geometry = new THREE.BufferGeometry();
    const stubs = stubLayout(stacks, this.low), batch = stubs.length ? new THREE.InstancedMesh(stubGeometry, stubMaterial, stubs.length) : null;
    const apply = () => {
      corners.forEach((c, i) => { const p = points[c.point]; position.setXYZ(i, p.east - this.origin[0], ground[c.point] + (c.top ? p.height : -WALL_FOOT), this.origin[1] - p.north); });
      position.needsUpdate = true; geometry.computeBoundingSphere(); geometry.computeVertexNormals();   // normals: the shadow bias needs them
      if (!batch) return;
      stubs.forEach(({ stack, stub }, i) => {
        const s = stacks[stack], a = points[stub.a + offsets[stack]], b = points[stub.b + offsets[stack]], t = stub.t, radius = STUB_RADIUS * stub.girth;
        const floor = ground[stub.a + offsets[stack]] * (1 - t) + ground[stub.b + offsets[stack]] * t, height = a.height * (1 - t) + b.height * t;
        // The log lies across the row. Its outer end stands `reach` out of the wall; the rest is inside the stack.
        const inset = (STUB_LENGTH / 2 - stub.reach) * stub.side;
        const east = a.east + (b.east - a.east) * t + s.along[1] * inset, north = a.north + (b.north - a.north) * t - s.along[0] * inset;
        this.dummy.position.set(east - this.origin[0], floor + Math.max(radius, stub.rise * height - radius * 0.4), this.origin[1] - north);
        this.dummy.rotation.set(0, Math.atan2(s.along[0], -s.along[1]), 0); this.dummy.scale.set(1, stub.girth, stub.girth); this.dummy.updateMatrix();
        batch.setMatrixAt(i, this.dummy.matrix);
      });
      batch.instanceMatrix.needsUpdate = true; batch.computeBoundingSphere();
    };
    geometry.setAttribute('position', position); geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(corners.length * 3).fill(1), 3));
    geometry.setAttribute('logAxis', new THREE.Float32BufferAttribute(axis, 2)); geometry.setIndex(indices); apply();
    const mesh = new THREE.Mesh(geometry, material); mesh.receiveShadow = !this.low; group.add(mesh);
    if (batch) { batch.receiveShadow = !this.low; group.add(batch); }
    return { points, seat: this.seat(points, ground, apply) };
  }
  readonly excludes = (east: number, north: number): boolean => {
    let boxed = false;
    for (const b of this.boxes) if (east >= b[0] && east <= b[2] && north >= b[1] && north <= b[3]) { boxed = true; break; }
    if (!boxed) return false;
    const triangles = this.buckets.get(cell(Math.floor(east / 8), Math.floor(north / 8)));
    if (!triangles) return false;
    for (let i = 0; i < triangles.length; i++) {
      const a = triangles[i][0], b = triangles[i][1], c = triangles[i][2];
      const ab = (b[0] - a[0]) * (north - a[1]) - (b[1] - a[1]) * (east - a[0]), bc = (c[0] - b[0]) * (north - b[1]) - (c[1] - b[1]) * (east - b[0]), ca = (a[0] - c[0]) * (north - c[1]) - (a[1] - c[1]) * (east - c[0]);
      if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true;
    }
    return false;
  };
  update(camera: { x: number; z: number }): void {
    const now = performance.now();
    if (now < this.next) return;
    this.next = now + 350;
    // First pass: every pile is in the picture once, wherever the camera is, so three.js builds the two shaders
    // with the scene and not at first sight in the middle of a drive. The next pass culls by distance as usual.
    const warming = this.warm++ === 0;
    for (const site of this.sites) {
      const near = Math.hypot(camera.x - (site.center[0] - this.origin[0]), camera.z - (this.origin[1] - site.center[1])) < (this.low ? 550 : 1000) + site.radius;
      site.group.visible = warming || (near && site.fit());
      for (const mesh of site.group.children) mesh.frustumCulled = !warming;
    }
  }
}
