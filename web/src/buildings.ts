import * as THREE from 'three';
import { snowRoof } from './weather-surfaces';

export interface Building {
  /** A split group shares one identity; only its largest wing carries the original site. */
  buildingId?: number; site?: Building;
  id: number; x: number; y: number; ground: number; footprint: [number, number][];
  /** Raised floor and lowest surveyed mesh corner for a building on a slope. */
  floorGround?: number; foundationGround?: number;
  axisDeg: number; length: number; width: number; eave: number; ridge: number;
  roof: 'gable' | 'flat' | 'shed'; kind: 'house' | 'barn' | 'shed' | 'large'; confidence: number;
  /** A large building measured as blocks (pipeline/big_buildings.py): each block has its own height. A tank is round:
   *  `length` is its diameter, `eave` the top of its shell, `ridge` the top of its roof, and `footprint` is points
   *  on its circle (the box round them is the square round the tank). */
  shape?: 'block' | 'tank';
}

/** One property per mapped building, at its unchanged pre-split position. */
export const buildingSites = (list: Building[]): Building[] => list
  .filter((b) => b.buildingId === undefined || b.buildingId === b.id)
  .map((b) => b.site ?? b);

/** Everything with a roof today, for a scene that removes the tree layer under the roofs and does not draw them: one
 *  record per building (buildingSites), and every further block of a large building. */
export const roofSites = (list: Building[]): Building[] => [...buildingSites(list),
  ...list.filter((b) => b.shape !== undefined && b.buildingId !== undefined && b.buildingId !== b.id)];

/** World boxes [x0, z0, x1, z1] under one building, each grown by `margin`, so the terrain's tree layer is removed
 *  there. A tank: the square round its circle. A block can be 300 m long and turned, and one box round it would clear
 *  a square of forest beside it, so a block is cleared in cells of at most 12 m. Any other building: the box of its
 *  footprint, and that of its site. */
export function clearBoxes(b: Building, origin: [number, number], margin: number): number[][] {
  const cx = b.x - origin[0], cz = origin[1] - b.y;
  if (b.shape === 'tank') { const radius = b.length / 2; return [[cx - radius - margin, cz - radius - margin, cx + radius + margin, cz + radius + margin]]; }
  const boxes: number[][] = [];
  if (b.shape === 'block') {
    const a = THREE.MathUtils.degToRad(b.axisDeg);
    const ux = Math.sin(a), uz = -Math.cos(a), vx = Math.cos(a), vz = Math.sin(a), L = b.length / 2, W = b.width / 2;
    const nu = Math.ceil(b.length / 12), nv = Math.ceil(b.width / 12);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const cell = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([p, q]) => { const u = -L + p * b.length / nu, v = -W + q * b.width / nv; return [cx + ux * u + vx * v, cz + uz * u + vz * v]; });
      boxes.push([Math.min(...cell.map((c) => c[0])) - margin, Math.min(...cell.map((c) => c[1])) - margin, Math.max(...cell.map((c) => c[0])) + margin, Math.max(...cell.map((c) => c[1])) + margin]);
    }
  } else for (const footprint of [b.footprint, ...(b.site ? [b.site.footprint] : [])]) {
    const xs = footprint.map((p) => p[0] - origin[0]), zs = footprint.map((p) => origin[1] - p[1]);
    boxes.push([Math.min(...xs) - margin, Math.min(...zs) - margin, Math.max(...xs) + margin, Math.max(...zs) + margin]);
  }
  return boxes;
}

export interface BuildingStyle {
  wall: string; roof: string; trim: string;
  roofMaterial: 'shingle' | 'metal';
  entrance: 'none' | 'small steps' | 'front porch' | 'deck' | 'wrap-around';
  chimney: boolean; dormer: boolean; shutters: boolean; satelliteDish: boolean; skirting: boolean; silo: boolean;
  door?: string;
  rollUpDoor?: boolean;
  boardAndBatten?: boolean;
  metalCladding?: boolean;
  bareEnd?: { side: -1 | 1; wall: string };
  barnDoors?: number;
  solarSide?: -1 | 1;
  steppedShed?: boolean;
  windowWall?: boolean;
  doorWindows?: boolean;
  roofShape?: 'flat' | 'gable' | 'hip' | 'gambrel';
  front?: { end: boolean; side: -1 | 1 };
  siloPosition?: { u: number; v: number; diameter: number; height: number };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isPaint = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const isStyle = (s: unknown): s is BuildingStyle => {
  if (!isRecord(s)) return false;
  if (![s.wall, s.roof, s.trim].every(isPaint)) return false;
  if (s.roofMaterial !== 'shingle' && s.roofMaterial !== 'metal') return false;
  if (!['none', 'small steps', 'front porch', 'deck', 'wrap-around'].includes(String(s.entrance))) return false;
  if (!['chimney', 'dormer', 'shutters', 'satelliteDish', 'skirting', 'silo'].every((k) => typeof s[k] === 'boolean')) return false;
  if (s.door !== undefined && !isPaint(s.door)) return false;
  if (![s.rollUpDoor, s.boardAndBatten, s.steppedShed, s.windowWall, s.doorWindows].every((value) => value === undefined || typeof value === 'boolean')) return false;
  if (s.metalCladding !== undefined && typeof s.metalCladding !== 'boolean') return false;
  if (s.bareEnd !== undefined && (!isRecord(s.bareEnd) || !isPaint(s.bareEnd.wall) ||
      (s.bareEnd.side !== -1 && s.bareEnd.side !== 1))) return false;
  if (s.barnDoors !== undefined && (typeof s.barnDoors !== 'number' || ![1, 2, 3, 4, 5].includes(s.barnDoors))) return false;
  if (s.solarSide !== undefined && s.solarSide !== -1 && s.solarSide !== 1) return false;
  if (s.roofShape !== undefined && !['flat', 'gable', 'hip', 'gambrel'].includes(String(s.roofShape))) return false;
  if (s.front !== undefined && (!isRecord(s.front) || typeof s.front.end !== 'boolean' || (s.front.side !== -1 && s.front.side !== 1))) return false;
  if (s.siloPosition !== undefined) {
    const p = s.siloPosition;
    if (!isRecord(p) || !['u', 'v', 'diameter', 'height'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k]))) return false;
    if (typeof p.diameter !== 'number' || typeof p.height !== 'number' || p.diameter <= 0 || p.height <= 0) return false;
  }
  return !s.silo || s.siloPosition !== undefined;
};

/** Parse the optional scenery file once at the network boundary. */
export function readBuildingStyles(data: unknown): Record<string, BuildingStyle> {
  if (!isRecord(data) || data.version !== 1 || !isRecord(data.styles)) throw new Error('Invalid building styles file');
  const result: Record<string, BuildingStyle> = {};
  for (const [id, style] of Object.entries(data.styles)) {
    if (!isStyle(style)) throw new Error(`Invalid building style ${id}`);
    result[id] = style;
  }
  return result;
}

type BuildingPaint = Record<string, BuildingStyle>;
type FacadeStudy = { study: 'window-light' | 'wall-shadows'; low: boolean; sunDir: THREE.Vector3; styles?: BuildingPaint };

export function buildingAppearance(flag: string | null, low: boolean, sunDir: THREE.Vector3, styles?: BuildingPaint): BuildingPaint | FacadeStudy | undefined {
  return flag === 'window-light' || flag === 'wall-shadows' ? { study: flag, low, sunDir, styles } : styles;
}

function isFacadeStudy(paint: BuildingPaint | FacadeStudy): paint is FacadeStudy {
  return typeof paint.study === 'string';
}

type FacadeRange = { x: number; z: number; first: number; end: number };
const facadeCellSize = 128;

// Keep one draw and the original primitive order. Near-coplanar glass must still draw after its
// backing. Crossing a cell selects a precomputed full or reduced sequence for each part of the mesh.
function streamFacadeDetail(mesh: THREE.Mesh, ranges: FacadeRange[]): void {
  if (!ranges.length) return;
  const geo = mesh.geometry, count = geo.getAttribute('position').count;
  const source = new Uint32Array(count);
  for (let i = 0; i < count; i++) source[i] = i;
  const parts: Array<{ x: number; z: number; full: Uint32Array; far: Uint32Array }> = [];
  let vertex = 0, span = 0;
  while (span < ranges.length) {
    const { x, z } = ranges[span], begin = vertex, far: number[] = [];
    do {
      const { first, end } = ranges[span++];
      while (vertex < first) far.push(vertex++);
      vertex = end;
    } while (span < ranges.length && ranges[span].x === x && ranges[span].z === z);
    parts.push({ x, z, full: source.subarray(begin, vertex), far: Uint32Array.from(far) });
  }
  const tail = source.subarray(vertex);
  const indices = source.slice();
  const index = new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(index);
  let lastX = NaN, lastZ = NaN;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    // Only the driver's view picks the cell. A directional shadow camera sits far up the sun line.
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) return;
    const world = camera.matrixWorld.elements;
    const x = Math.floor(world[12] / facadeCellSize), z = Math.floor(world[14] / facadeCellSize);
    if (x === lastX && z === lastZ) return;
    lastX = x; lastZ = z;
    let used = 0;
    for (const part of parts) {
      const near = Math.abs(part.x - x) <= 2 && Math.abs(part.z - z) <= 2;
      const selected = near ? part.full : part.far;
      indices.set(selected, used);
      used += selected.length;
    }
    indices.set(tail, used);
    used += tail.length;
    geo.setDrawRange(0, used);
    index.clearUpdateRanges();
    index.addUpdateRange(0, used);
    index.needsUpdate = true;
  };
}

type RGB = [number, number, number];

const WALLS: Record<Building['kind'], RGB[]> = {
  house: [[0.78, 0.77, 0.71], [0.69, 0.66, 0.53], [0.48, 0.53, 0.54], [0.72, 0.64, 0.40], [0.42, 0.46, 0.47], [0.36, 0.29, 0.22], [0.50, 0.45, 0.36], [0.66, 0.66, 0.62]],
  barn: [[0.34, 0.08, 0.06], [0.40, 0.37, 0.33], [0.30, 0.28, 0.26], [0.55, 0.52, 0.46]],
  shed: [[0.45, 0.43, 0.40], [0.62, 0.61, 0.57], [0.34, 0.10, 0.08], [0.36, 0.34, 0.30]],
  large: [[0.66, 0.63, 0.56], [0.55, 0.36, 0.28], [0.70, 0.70, 0.68]],
};
const TANKS: RGB[] = [[0.80, 0.80, 0.77], [0.71, 0.73, 0.73], [0.62, 0.65, 0.63]];
const ROOFS: [number, number, number][] = [[0.11, 0.11, 0.12], [0.16, 0.15, 0.14], [0.20, 0.13, 0.10], [0.13, 0.20, 0.16], [0.30, 0.09, 0.07], [0.30, 0.31, 0.32]];

const hash = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// THREE.Color converts sRGB hex paint to the linear vertex colours expected by the material.
const rgbCache = new Map<string, RGB>();
const scratchColor = new THREE.Color();
const rgb = (hex: string): RGB => {
  let c = rgbCache.get(hex);
  if (!c) { scratchColor.set(hex); c = [scratchColor.r, scratchColor.g, scratchColor.b]; rgbCache.set(hex, c); }
  return c;
};

/** Measured LiDAR envelopes with stable, inexpensive rural facade details. */
export class Buildings {
  readonly mesh: THREE.Mesh;
  readonly triangles: number;
  /** World boxes [x0, z0, x1, z1] under the buildings, so the terrain's tree layer is removed there. */
  readonly clear: number[][] = [];

  constructor(list: Building[], village: [number, number], exag: number, seaLevel: number, paint: BuildingPaint | FacadeStudy = {},
    details?: { pos: readonly number[]; col: readonly number[] }, winter?: THREE.IUniform) {
    const { styles = {}, study, low, sunDir } = isFacadeStudy(paint) ? paint : { styles: paint, study: undefined, low: false, sunDir: undefined };
    const pos: number[] = [], col: number[] = [];
    const snowHeight: number[] | null = winter ? [] : null;
    let snowBase = 0;
    const triN = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number,
      colourA: RGB, shade = 1, colourB = colourA, colourC = colourA) => {
      pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      snowHeight?.push(ay - snowBase, by - snowBase, cy - snowBase);
      col.push(
        colourA[0] * shade, colourA[1] * shade, colourA[2] * shade,
        colourB[0] * shade, colourB[1] * shade, colourB[2] * shade,
        colourC[0] * shade, colourC[1] * shade, colourC[2] * shade,
      );
    };
    const quadN = (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, k: RGB, shade = 1, top = k) => {
      triN(ax, ay, az, bx, by, bz, cx, cy, cz, k, shade, k, top);
      triN(ax, ay, az, cx, cy, cz, dx, dy, dz, k, shade, top, top);
    };
    const reverseQuadN = (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, k: RGB, shade = 1, top = k) => {
      triN(ax, ay, az, cx, cy, cz, bx, by, bz, k, shade, top, k);
      triN(ax, ay, az, dx, dy, dz, cx, cy, cz, k, shade, top, top);
    };

    const windowLight = study === 'window-light';
    const simpleWindows = low && windowLight;
    const simpleSiding = low && study === 'wall-shadows';
    const facadeRanges: FacadeRange[] | undefined = simpleSiding ? [] : undefined;
    const wallShadows = !low && study === 'wall-shadows';
    const closedWallRanges: number[] | undefined = wallShadows ? [] : undefined;
    // The two-sided paint hides an inward face, but the shadow lookup still offsets along its normal.
    // Keep the same diagonal and vertices. Swap the winding so a wall receives the sun from outside.
    const shellWallN = wallShadows ? reverseQuadN : quadN;
    const shellEndN = (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number, colour: RGB) =>
      wallShadows ? triN(ax, ay, az, cx, cy, cz, bx, by, bz, colour) : triN(ax, ay, az, bx, by, bz, cx, cy, cz, colour);

    // The game's Lambert material interpolates these six existing pane vertices in linear light.
    const upperPane: RGB = [0.19, 0.30, 0.37], lowerPane: RGB = [0.027, 0.046, 0.045];
    for (const b of list) {
      const cx = b.x - village[0], cz = village[1] - b.y;
      const nearPaint = facadeRanges && Math.max(b.length, b.width) <= facadeCellSize ? (first: number, end = pos.length / 3) => {
        if (end > first) facadeRanges.push({ x: Math.floor(cx / facadeCellSize), z: Math.floor(cz / facadeCellSize), first, end });
      } : undefined;
      const floorGround = b.floorGround ?? b.ground;
      const base = seaLevel + (floorGround - seaLevel) * exag;
      const foundationDepth = (depth: number) => Math.min(-depth,
        ((b.foundationGround ?? floorGround) - floorGround) * exag - 0.1);
      snowBase = base;
      const a = THREE.MathUtils.degToRad(b.axisDeg);
      const ux = Math.sin(a), uz = -Math.cos(a), vx = Math.cos(a), vz = Math.sin(a);   // along the ridge, across it
      const L = b.length / 2, W = b.width / 2;
      // u along the ridge, v across, h above the ground at the building.
      const triP = (au: number, av: number, ah: number, bu: number, bv: number, bh: number, cu: number, cv: number, ch: number, colour: RGB, shade = 1) =>
        triN(cx + ux * au + vx * av, base + ah, cz + uz * au + vz * av,
          cx + ux * bu + vx * bv, base + bh, cz + uz * bu + vz * bv,
          cx + ux * cu + vx * cv, base + ch, cz + uz * cu + vz * cv, colour, shade);
      const quadP = (au: number, av: number, ah: number, bu: number, bv: number, bh: number,
        cu: number, cv: number, ch: number, du: number, dv: number, dh: number, colour: RGB, shade = 1, top = colour) =>
        quadN(cx + ux * au + vx * av, base + ah, cz + uz * au + vz * av,
          cx + ux * bu + vx * bv, base + bh, cz + uz * bu + vz * bv,
          cx + ux * cu + vx * cv, base + ch, cz + uz * cu + vz * cv,
          cx + ux * du + vx * dv, base + dh, cz + uz * du + vz * dv, colour, shade, top);
      const shellWallP = (au: number, av: number, ah: number, bu: number, bv: number, bh: number,
        cu: number, cv: number, ch: number, du: number, dv: number, dh: number, colour: RGB, shade = 1) =>
        shellWallN(cx + ux * au + vx * av, base + ah, cz + uz * au + vz * av,
          cx + ux * bu + vx * bv, base + bh, cz + uz * bu + vz * bv,
          cx + ux * cu + vx * cv, base + ch, cz + uz * cu + vz * cv,
          cx + ux * du + vx * dv, base + dh, cz + uz * du + vz * dv, colour, shade);
      const shellEndP = (au: number, av: number, ah: number, bu: number, bv: number, bh: number, cu: number, cv: number, ch: number, colour: RGB) =>
        shellEndN(cx + ux * au + vx * av, base + ah, cz + uz * au + vz * av,
          cx + ux * bu + vx * bv, base + bh, cz + uz * bu + vz * bv,
          cx + ux * cu + vx * cv, base + ch, cz + uz * cu + vz * cv, colour);
      if (b.shape === 'tank') {
        // A storage tank: a steel shell up to the measured rim, and a low cone up to the measured top.
        const radius = b.length / 2, shell = TANKS[Math.floor(hash(b.id) * TANKS.length)];
        const cap: RGB = [shell[0] * 0.86, shell[1] * 0.86, shell[2] * 0.86], topY = base + b.ridge;
        const tankFoot = foundationDepth(7 * Math.max(1, exag));
        const segments = 32;
        for (let i = 0; i < segments; i++) {
          const t0 = i * Math.PI * 2 / segments, t1 = (i + 1) * Math.PI * 2 / segments;
          const x0 = cx + Math.cos(t0) * radius, z0 = cz + Math.sin(t0) * radius;
          const x1 = cx + Math.cos(t1) * radius, z1 = cz + Math.sin(t1) * radius;
          quadN(x0, base + tankFoot, z0, x1, base + tankFoot, z1, x1, base + b.eave, z1, x0, base + b.eave, z0, shell, 0.8 + 0.2 * Math.cos((i + 0.5) * Math.PI * 2 / segments));
          triN(x0, base + b.eave, z0, x1, base + b.eave, z1, cx, topY, cz, cap);
        }
        this.clear.push(...clearBoxes(b, village, 2.5));
        continue;
      }
      const identity = b.buildingId ?? b.id;
      const primary = identity === b.id;
      const paint = styles[identity];
      // Wing joints use simple roofs. Property accessories are never multiplied,
      // and uncertain porches/dormers are omitted rather than put on an inner wall.
      const style = b.buildingId !== undefined && paint ? { ...paint,
        entrance: 'none' as const, dormer: false, satelliteDish: false, solarSide: undefined, steppedShed: false, windowWall: false,
        chimney: primary && paint.chimney, silo: primary && paint.silo,
        roofShape: paint.roofShape === 'flat' || b.roof === 'flat' ? 'flat' as const : 'gable' as const,
      } : paint;
      const wall = style ? rgb(style.wall) : WALLS[b.kind][Math.floor(hash(identity) * WALLS[b.kind].length)];
      const endWall = (side: number) => style?.bareEnd?.side === side ? rgb(style.bareEnd.wall) : wall;
      const roofPalette = b.kind === 'barn' ? [ROOFS[3], ROOFS[4], ROOFS[5]] : ROOFS;
      const roof = style ? rgb(style.roof) : roofPalette[Math.floor(hash(identity + 0.5) * roofPalette.length)];
      // Walls and foundation run below the ground line so a slope never shows a gap.
      // Large mapped blocks span wide slopes and coarse parent terrain meshes, so scale depth with exaggeration.
      const foot = foundationDepth(b.shape === 'block' ? 7 * Math.max(1, exag) : 3);
      const shape = style?.roofShape ?? (b.buildingId !== undefined && b.roof !== 'flat' ? 'gable' : b.roof);
      const flat = shape === 'flat';
      const shed = shape === 'shed';
      const e = b.eave, r = b.ridge;
      const stepped = shed && !!style?.steppedShed;
      const split = L * 0.23, upperEave = e + 1.0, lowerHigh = e + 1.1;
      // Walls. The two long walls are a little darker so the corners read.
      const wallStart = pos.length / 3;
      shellWallP(-L, -W, foot, L, -W, foot, L, -W, e, -L, -W, e, wall, 0.92);
      shellWallP(L, W, foot, -L, W, foot, -L, W, e, L, W, e, wall, 0.92);
      shellWallP(L, -W, foot, L, W, foot, L, W, e, L, -W, e, endWall(1));
      shellWallP(-L, W, foot, -L, -W, foot, -L, -W, e, -L, W, e, endWall(-1));
      closedWallRanges?.push(wallStart, pos.length / 3);
      const trim: RGB = style ? rgb(style.trim) : b.kind === 'house' ? [0.79, 0.77, 0.69] : [0.56, 0.54, 0.47];
      const foundation: RGB = style?.skirting ? rgb('#dddeda') : [0.23, 0.23, 0.21];
      const glass: RGB = [0.065, 0.105, 0.13];
      const door: RGB = style?.door ? rgb(style.door) : b.kind === 'house' ? (hash(identity + 3) > 0.5 ? [0.17, 0.22, 0.20] : [0.29, 0.12, 0.09]) : [wall[0] * 0.52, wall[1] * 0.52, wall[2] * 0.52];
      // Facade rectangles use a local horizontal coordinate and an outward offset.
      const panel = (end: boolean, side: number, u0: number, u1: number, y0: number, y1: number, colour: RGB, offset = 0.025) => {
        const pane = windowLight && colour === glass;
        const face = wallShadows && (end ? side > 0 : side < 0) ? reverseQuadN : quadN;
        const lo = pane ? lowerPane : colour, hi = pane ? upperPane : colour;
        const by0 = base + y0, by1 = base + y1;
        if (end) {
          const s = side * (L + offset);
          const ax = cx + ux * s + vx * u0, az = cz + uz * s + vz * u0;
          const bx = cx + ux * s + vx * u1, bz = cz + uz * s + vz * u1;
          face(ax, by0, az, bx, by0, bz, bx, by1, bz, ax, by1, az, lo, 1, hi);
        } else {
          const s = side * (W + offset);
          const ax = cx + ux * u0 + vx * s, az = cz + uz * u0 + vz * s;
          const bx = cx + ux * u1 + vx * s, bz = cz + uz * u1 + vz * s;
          face(ax, by0, az, bx, by0, bz, bx, by1, bz, ax, by1, az, lo, 1, hi);
        }
      };
      const box = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, colour: RGB) => {
        quadP(u0, v0, y0, u1, v0, y0, u1, v0, y1, u0, v0, y1, colour, 0.9);
        quadP(u1, v1, y0, u0, v1, y0, u0, v1, y1, u1, v1, y1, colour, 0.9);
        quadP(u1, v0, y0, u1, v1, y0, u1, v1, y1, u1, v0, y1, colour);
        quadP(u0, v1, y0, u0, v0, y0, u0, v0, y1, u0, v1, y1, colour);
        quadP(u0, v0, y1, u1, v0, y1, u1, v1, y1, u0, v1, y1, colour);
      };
      const opening = (end: boolean, side: number, u: number, bottom: number, width: number, height: number, isDoor = false) => {
        const half = width / 2, t = isDoor ? 0.105 : 0.09;
        const trimStart = pos.length / 3;
        panel(end, side, u - half - t, u + half + t, bottom - t, bottom + height + t, trim, 0.035);
        nearPaint?.(trimStart);
        // The door or pane remains in the distant facade; only the raised trim leaves.
        panel(end, side, u - half, u + half, bottom, bottom + height, isDoor ? door : glass, 0.05);
        const sashStart = pos.length / 3;
        if (!isDoor) {
          if (style?.shutters) for (const sign of [-1, 1]) {
            const edge = u + sign * (half + t + 0.04);
            panel(end, side, Math.min(edge, edge + sign * width * 0.28), Math.max(edge, edge + sign * width * 0.28), bottom - 0.03, bottom + height + 0.03, rgb('#394548'), 0.045);
          }
          // In the small drawing buffer the 5 cm upright dwindles to a pixel. The horizontal sash still reads
          // from the road at delivery distance, so LOW keeps it with the perimeter and shutters.
          if (b.kind !== 'large' || !style) {
            if (!simpleWindows) panel(end, side, u - 0.025, u + 0.025, bottom, bottom + height, trim, 0.065);
            panel(end, side, u - half, u + half, bottom + height * 0.52, bottom + height * 0.52 + 0.035, trim, 0.065);
          }
        }
        nearPaint?.(sashStart);
      };
      // Blocks of one building stand wall to wall: an eave that hangs over would cut into the next block's roof.
      const over = b.shape === 'block' ? 0 : flat ? 0.20 : 0.30;
      const roofFace = (u0: number, u1: number, v0: number, v1: number, h0: number, h1: number, shade = 1) => {
        quadP(u0, v0, h0, u1, v0, h0, u1, v1, h1, u0, v1, h1, roof, shade);
        if (style?.roofMaterial === 'metal' || (!style && b.kind === 'barn')) {
          const seamStart = pos.length / 3;
          const seam: RGB = [Math.min(1, roof[0] * 1.17 + 0.012), Math.min(1, roof[1] * 1.17 + 0.012), Math.min(1, roof[2] * 1.17 + 0.012)];
          // Sparse standing seams read from the road without subpixel strips across every 0.5 m panel.
          for (let u = u0 + 0.65; u < u1 - 0.1; u += 1.5) {
            quadP(u, v0, h0 + 0.025, u + 0.035, v0, h0 + 0.025, u + 0.035, v1, h1 + 0.025, u, v1, h1 + 0.025, seam, shade);
          }
          nearPaint?.(seamStart);
        }
      };
      if (flat) {
        roofFace(-L - over, L + over, -W - over, W + over, r, r);
        for (const side of [-1, 1]) {
          panel(false, side, -L - over, L + over, e, r, wall);
          panel(true, side, -W - over, W + over, e, r, wall);
        }
      } else if (shape === 'hip') {
        const inset = Math.min(L * 0.55, W);
        roofFace(-L + inset, L - inset, -W, 0, e, r);
        roofFace(-L + inset, L - inset, 0, W, r, e, 0.85);
        for (const side of [-1, 1]) {
          const tip = side * (L - inset);
          triP(side * L, -W, e, side * L, W, e, tip, 0, r, roof);
          triP(side * L, -W, e, tip, 0, r, tip, -W, e, roof);
          triP(side * L, W, e, tip, W, e, tip, 0, r, roof, 0.85);
        }
      } else if (shape === 'gambrel') {
        const bend = W * 0.62, h = e + (r - e) * 0.72;
        for (const side of [-1, 1]) {
          roofFace(-L - over, L + over, side * (W + over), side * bend, e - 0.1, h, side === 1 ? 0.85 : 1);
          roofFace(-L - over, L + over, side * bend, 0, h, r, side === 1 ? 0.85 : 1);
          const u = side * L;
          // The gable above the eave takes the end wall's paint, as the plain gable does.
          quadP(u, -W, e, u, W, e, u, bend, h, u, -bend, h, endWall(side));
          triP(u, -bend, h, u, bend, h, u, 0, r, endWall(side));
        }
      } else if (stepped) {
        // Two parallel shed roofs. Close the step with a wall above the lower roof.
        const drop = (low: number, high: number) => over * (high - low) / (2 * W);
        roofFace(-L - over, split, -W - over, W, upperEave - drop(upperEave, r), r);
        roofFace(split, L + over, -W - over, W, e - drop(e, lowerHigh), lowerHigh, 0.9);
        panel(false, -1, -L, split, e, upperEave, wall);
        panel(false, 1, -L, split, e, r, wall);
        panel(false, 1, split, L, e, lowerHigh, wall);
        quadP(-L, -W, e, -L, W, e, -L, W, r, -L, -W, upperEave, wall);
        triP(L, -W, e, L, W, e, L, W, lowerHigh, wall);
        quadP(split, -W, e, split, W, lowerHigh, split, W, r, split, -W, upperEave, wall);
        panel(false, 1, -L - over, split, r - 0.17, r, trim, 0.035);
        panel(false, 1, split, L + over, lowerHigh - 0.17, lowerHigh, trim, 0.035);
      } else if (shed) {
        const slope = (r - e) / (2 * W);
        roofFace(-L - over, L + over, -W - over, W, e - over * slope, r);
        panel(false, 1, -L, L, e, r, wall);
        for (const side of [-1, 1]) triP(side * L, -W, e, side * L, W, e, side * L, W, r, wall);
      } else {
        const gableStart = pos.length / 3;
        shellEndP(L, -W, e, L, W, e, L, 0, r, endWall(1));
        shellEndP(-L, W, e, -L, -W, e, -L, 0, r, endWall(-1));
        closedWallRanges?.push(gableStart, pos.length / 3);
        const drop = (over * (r - e)) / W;
        roofFace(-L - over, L + over, -W - over, 0, e - drop, r);
        roofFace(-L - over, L + over, W + over, 0, e - drop, r, 0.85);
        if (style?.solarSide && W >= 2.5 && L >= 2.5) {
          const side = style.solarSide;
          const row = (u0: number, u1: number, v0: number, v1: number, lift: number, colour: RGB) => {
            const h0 = r - (r - e) * v0 / W + lift, h1 = r - (r - e) * v1 / W + lift;
            quadP(u0, side * v0, h0, u1, side * v0, h0, u1, side * v1, h1, u0, side * v1, h1, colour);
          };
          const frame = rgb('#727a7d'), cell = rgb('#26394d');
          for (let column = 0; column < 4; column++) {
            const u = -2.18 + column * 1.10;
            for (const v of [W * 0.17, W * 0.53]) {
              row(u, u + 1.06, v, v + W * 0.32, 0.08, frame);
              row(u + 0.035, u + 1.025, v + 0.035, v + W * 0.32 - 0.035, 0.09, cell);
            }
          }
        }
      }
      const cornerStart = pos.length / 3;
      for (const side of [-1, 1]) {
        panel(false, side, -L, L, foot, Math.min(0.38, e * 0.15), foundation, 0.016);
        panel(true, side, -W, W, foot, Math.min(0.38, e * 0.15), foundation, 0.016);
        for (const corner of [-1, 1]) {
          const u = corner * L, v = corner * W;
          panel(false, side, u - (corner === 1 ? 0.14 : 0), u + (corner === -1 ? 0.14 : 0), 0.38, e, trim, 0.04);
          panel(true, side, v - (corner === 1 ? 0.14 : 0), v + (corner === -1 ? 0.14 : 0), 0.38, e, trim, 0.04);
        }
        // Fascia follows the measured roof slope, including both rake edges.
        const edgeHeight = flat ? r : shed && side === 1 ? r : e - over * (r - e) / (shed ? 2 * W : W);
        if (!stepped) panel(false, side, -L - over, L + over, edgeHeight - 0.14, edgeHeight, trim, shed && side === 1 ? 0.01 : over + 0.01);
        if (!stepped && !flat && shape !== 'hip' && shape !== 'gambrel') {
          const v = L + over + 0.01;
          const rake = (v0: number, v1: number, y0: number, y1: number) => quadP(side * v, v0, y0, side * v, v1, y1, side * v, v1, y1 - 0.14, side * v, v0, y0 - 0.14, trim);
          if (shed) rake(-W - over, W, e - over * (r - e) / (2 * W), r);
          else {
            const low = e - over * (r - e) / W;
            rake(-W - over, 0, low, r); rake(0, W + over, r, low);
          }
        }
      }
      nearPaint?.(cornerStart);
      // Shallow clapboard courses, kept behind openings and corner trim.
      // Muted bands suggest weathered shingles without adding a texture or draw call.
      if (style?.boardAndBatten || style?.metalCladding) {
        for (const side of [-1, 1]) for (const end of [false, true]) {
          const span = end ? W : L;
          const base = end ? endWall(side) : wall;
          const raised: RGB = [base[0] * 1.15, base[1] * 1.14, base[2] * 1.12];
          const spacing = style.metalCladding ? 0.65 : 0.42;
          for (let u = -span + 0.28; u < span - 0.14; u += spacing) {
            const high = end && style.metalCladding && shape === 'gable' ? e + (r - e) * (1 - Math.abs(u) / W) - 0.06 : e;
            panel(end, side, u, u + 0.046, 0.38, high, raised, 0.022);
          }
        }
      } else if (!simpleSiding && (b.kind === 'house' || b.kind === 'barn')) {
        const course: RGB = [wall[0] * 0.95, wall[1] * 0.95, wall[2] * 0.95];
        const sides = style && b.kind === 'house' ? [style.front?.side ?? 1] : [-1, 1];
        for (let y = 0.65; y < e - 0.15; y += style ? 0.64 : b.kind === 'barn' ? 0.44 : 0.32) {
          // Spend siding detail on one long wall and one end wall. The other walls
          // keep their paint; this pays for porches and windows without more draw calls.
          for (const side of sides) {
            panel(false, side, -L + 0.14, L - 0.14, y, y + 0.018, course, 0.022);
            panel(true, side, -W + 0.14, W - 0.14, y, y + 0.018, course, 0.022);
          }
        }
      }
      if (b.kind === 'house') {
        const front = style?.front?.side ?? (hash(identity + 2) > 0.5 ? 1 : -1);
        const frontEnd = style?.front?.end ?? false;
        const span = frontEnd ? W : L;
        const depth = frontEnd ? L : W;
        const tallFront = stepped && !!style?.windowWall && !frontEnd && front === 1;
        const deckHeight = tallFront ? 0.62 : 0.23;
        const doorU = tallFront ? span * 0.57 : span > 4 ? -span * 0.25 : 0;
        const quadF = (au: number, av: number, ah: number, bu: number, bv: number, bh: number,
          cu: number, cv: number, ch: number, du: number, dv: number, dh: number, colour: RGB) =>
          frontEnd ? quadP(av, au, ah, bv, bu, bh, cv, cu, ch, dv, du, dh, colour)
            : quadP(au, av, ah, bu, bv, bh, cu, cv, ch, du, dv, dh, colour);
        const triF = (au: number, av: number, ah: number, bu: number, bv: number, bh: number,
          cu: number, cv: number, ch: number, colour: RGB) =>
          frontEnd ? triP(av, au, ah, bv, bu, bh, cv, cu, ch, colour)
            : triP(au, av, ah, bu, bv, bh, cu, cv, ch, colour);
        const frontBox = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, colour: RGB) => {
          if (frontEnd) box(v0, v1, u0, u1, y0, y1, colour);
          else box(u0, u1, v0, v1, y0, y1, colour);
        };
        const dh = Math.min(2.05, e - 0.35), dw = Math.min(0.95, b.length * 0.22);
        if (dh > 1.1) opening(frontEnd, front, doorU, tallFront ? deckHeight : 0.22, dw, dh, true);
        if (tallFront) {
          const wood = rgb('#ad8c69');
          // Off the upper wall's own plane (0.025), under the glass (0.05): the two would z-fight.
          panel(false, front, -L + 0.2, split - 0.18, deckHeight + 0.22, r - 0.32, wood, 0.035);
          const start = -L + 0.51, step = (split - 0.34 - start) / 4;
          for (let i = 0; i < 4; i++) {
            const u = start + i * step;
            panel(false, front, u, u + step - 0.11, deckHeight + 0.44, r - 0.54, glass, 0.05);
            panel(false, front, u, u + step - 0.11, 3.72, 3.8, trim, 0.065);
          }
        }
        const storeys = Math.max(1, Math.min(3, Math.floor((e + 0.3) / 2.65)));
        const floor = e / storeys, wh = Math.min(1.25, floor * 0.43);
        const columns = Math.max(1, Math.min(9, Math.floor((b.length - 1.5) / 2.7)));
        for (const side of [-1, 1]) for (let row = 0; row < storeys; row++) {
          const y = row * floor + Math.max(0.65, (floor - wh) * 0.48);
          for (let c = 0; c < columns; c++) {
            const u = -L + (c + 0.5) * b.length / columns;
            if (tallFront && side === front) continue;
            if (!frontEnd && side === front && row === 0 && Math.abs(u - doorU) < 1.2) continue;
            opening(false, side, u, y, Math.min(1.1, b.length / columns * 0.48), wh);
          }
        }
        for (const side of [-1, 1]) {
          if (W > 2) for (const v of [-W * 0.48, W * 0.48]) {
            if (frontEnd && side === front && Math.abs(v - doorU) < 1.2) continue;
            opening(true, side, v, 0.85, Math.min(0.95, W * 0.35), Math.min(1.2, e * 0.38));
          }
          if ((shape === 'gable' || shape === 'gambrel') && r - e > 1.5) opening(true, side, 0, e + 0.25, 0.6, Math.min(0.7, (r - e) * 0.3));
        }
        const entrance = b.buildingId !== undefined ? 'none' : style?.entrance ?? (hash(identity + 6) > 0.4 ? 'small steps' : 'none');
        if (dh > 1.1 && entrance !== 'none') {
          const steps = entrance === 'small steps';
          const half = steps ? 0.85 : Math.min(span - 0.4, entrance === 'wrap-around' ? span * 0.85 : 2.5);
          const reach = steps ? 0.85 : 2.2;
          const v0 = front === 1 ? depth : -depth - reach, v1 = front === 1 ? depth + reach : -depth;
          const u0 = tallFront ? -span : Math.max(-span, doorU - half);
          const u1 = tallFront ? span : Math.min(span, doorU + half);
          const porchFoot = b.foundationGround === undefined ? -0.3 : foundationDepth(0.3);
          frontBox(u0, u1, v0, v1, tallFront ? deckHeight - 0.22 : porchFoot, deckHeight, steps ? foundation : rgb('#857c68'));
          frontBox(doorU - 0.65, doorU + 0.65, front * (depth + reach + 0.35) - 0.18, front * (depth + reach + 0.35) + 0.18, -0.2, 0.1, foundation);
          if (entrance === 'wrap-around') frontBox(-span - 1.8, -span, -depth, depth + (front === 1 ? reach : 0), porchFoot, 0.23, rgb('#857c68'));
          if (entrance === 'deck') {
            const v = front * (depth + reach - 0.12);
            const posts = tallFront ? [u0 + 0.12, -span / 3, span / 3, u1 - 0.12] : [u0 + 0.12, u1 - 0.12];
            const top = deckHeight + 0.87;
            for (const u of posts) frontBox(u - 0.06, u + 0.06, v - 0.06, v + 0.06, tallFront ? foot : deckHeight, top, trim);
            frontBox(u0 + 0.12, u1 - 0.12, v - 0.045, v + 0.045, top - 0.08, top, trim);
            if (tallFront) {
              for (let u = u0 + 0.32; u < u1 - 0.2; u += 0.23) {
                frontBox(u - 0.018, u + 0.018, v - 0.023, v + 0.023, deckHeight, top, trim);
              }
              for (const u of [u0 + 0.12, u1 - 0.12]) {
                frontBox(u - 0.045, u + 0.045, Math.min(v, front * depth), Math.max(v, front * depth), top - 0.08, top, trim);
              }
            }
          }
          if (entrance === 'front porch' || entrance === 'wrap-around') {
            const top = Math.min(2.65, e - 0.22);
            for (const u of [u0 + 0.12, u1 - 0.12]) {
              const v = front * (depth + reach - 0.12);
              frontBox(u - 0.07, u + 0.07, v - 0.07, v + 0.07, 0.23, top, trim);
            }
            quadF(u0 - 0.15, front * depth, top + 0.23, u1 + 0.15, front * depth, top + 0.23, u1 + 0.15, front * (depth + reach + 0.15), top, u0 - 0.15, front * (depth + reach + 0.15), top, roof);
          }
        }
        if (style?.dormer && !flat && !shed && shape !== 'hip' && span > 3) {
          const v = front * W * 0.58, d = Math.min(1.2, W * 0.28);
          const y = r - (r - e) * 0.58, top = Math.min(r - 0.32, y + 1.25);
          box(-0.9, 0.9, Math.min(v, v - front * d), Math.max(v, v - front * d), y - 0.15, top, wall);
          panel(false, front, -0.65, 0.65, y + 0.12, top - 0.12, trim, Math.abs(v) - W + 0.035);
          panel(false, front, -0.48, 0.48, y + 0.22, top - 0.21, glass, Math.abs(v) - W + 0.05);
          const peak = Math.min(r, top + 0.4);
          triP(-1, v, top, 1, v, top, 0, v, peak, wall);
          for (const side of [-1, 1]) quadP(side, v + front * 0.15, top, side, v - front * d, top, 0, v - front * d, peak, 0, v + front * 0.15, peak, roof);
        }
        if (style?.satelliteDish) {
          const u = doorU + 1.4, v = front * (depth + 0.35), y = Math.min(e - 0.3, 2.5);
          frontBox(u - 0.035, u + 0.035, v - 0.04, v + 0.04, y - 0.5, y, foundation);
          const dish = rgb('#a3aaa9');
          for (let i = 0; i < 8; i++) {
            const a0 = i * Math.PI / 4, a1 = (i + 1) * Math.PI / 4;
            triF(u, v - front * 0.12, y, u + Math.cos(a0) * 0.38, v, y + Math.sin(a0) * 0.32, u + Math.cos(a1) * 0.38, v, y + Math.sin(a1) * 0.32, dish);
          }
          triF(u, v, y - 0.28, u + 0.04, v, y - 0.28, u, v + front * 0.4, y - 0.08, foundation);
        }
        if (primary && (style?.chimney ?? (hash(identity + 4) > 0.45)) && L > 3 && W > 2) {
          const u = L * 0.45, v = W * 0.3;
          const roofY = flat ? r : shed ? e + (r - e) * 0.65 : r - (r - e) * 0.3;
          box(u - 0.28, u + 0.28, v - 0.26, v + 0.26, roofY - 0.4, roofY + 1.05, [0.27, 0.18, 0.14]);
          box(u - 0.34, u + 0.34, v - 0.32, v + 0.32, roofY + 1.05, roofY + 1.16, foundation);
        }
      } else if (b.kind === 'barn') {
        const doorCount = style?.barnDoors ?? 1;
        const frontEnd = style?.barnDoors ? style.front?.end ?? true : true;
        const front = style?.barnDoors ? style.front?.side ?? 1 : 1;
        const span = frontEnd ? b.width : b.length;
        const stride = span / doorCount;
        const wide = Math.min(4.5, stride * (style?.barnDoors && frontEnd ? 0.25 : 0.55));
        const tall = Math.min(3.3, e - 0.2);
        for (let i = 0; i < doorCount && tall > 0.8; i++) {
          const u = stride * (i + 0.5) - span / 2;
          opening(frontEnd, front, u, 0.05, wide, tall, true);
          if (!style?.barnDoors || wide > 2) panel(frontEnd, front, u - 0.035, u + 0.035, 0.05, tall, trim, 0.067);
          panel(frontEnd, front, u - wide * 0.65, u + wide * 0.65, tall + 0.2, tall + 0.28, foundation, 0.07);
        }
        for (const side of [-1, 1]) {
          if (!frontEnd && side === front) continue;
          for (const u of [-L * 0.55, L * 0.55]) if (e > 2.2) opening(false, side, u, e * 0.5, 0.7, 0.65);
        }
      } else if (b.kind === 'large' && style && b.shape !== 'block') {
        // Low apartments and village shops need a readable rhythm of doors and windows too. A block is one part of a
        // large mapped hall (big_buildings.py: plants, malls, arenas; some over 60 m high): it keeps the plain end door below.
        const rows = Math.max(1, Math.min(3, Math.floor((e + 0.3) / 2.65)));
        const floor = e / rows;
        const columns = Math.max(1, Math.min(14, Math.floor(b.length / 3.6)));
        for (const side of [-1, 1]) for (let row = 0; row < rows; row++) {
          for (let c = 0; c < columns; c++) {
            const u = -L + (c + 0.5) * b.length / columns;
            if (row === 0 && c % 4 === 1) opening(false, side, u, 0.18, 0.95, Math.min(2.05, floor - 0.3), true);
            else opening(false, side, u, row * floor + 0.8, 1.25, Math.min(1.2, floor - 1));
          }
        }
        for (const side of [-1, 1]) for (const v of [-W * 0.5, W * 0.5]) {
          if (e > 2) opening(true, side, v, 0.85, 1.2, Math.min(1.2, e - 1.1));
        }
      } else if (e > 1.3) {
        const end = style?.front?.end ?? true;
        const side = style?.front?.side ?? (hash(identity + 1) > 0.5 ? 1 : -1);
        const span = end ? b.width : b.length;
        const width = style?.rollUpDoor ? Math.min(span * 0.72, 4.8) : Math.min(span * 0.45, b.kind === 'large' ? 3 : 1.15);
        const height = Math.min(style?.rollUpDoor ? 2.4 : 2.2, e - 0.25);
        opening(end, side, 0, 0.12, width, height, true);
        if (style?.rollUpDoor) for (let y = 0.43; y < height; y += 0.31) {
          panel(end, side, -width / 2, width / 2, y, y + 0.019, door, 0.06);
          panel(end, side, -width / 2, width / 2, y + 0.019, y + 0.033, [door[0] * 0.7, door[1] * 0.7, door[2] * 0.7], 0.061);
        }
        if (style?.doorWindows && height > 1.5) {
          const stride = width / 5;
          for (let i = 0; i < 5; i++) {
            const u = (i - 2) * stride;
            panel(end, side, u - stride * 0.39, u + stride * 0.39, height - 0.47, height - 0.15, glass, 0.07);
          }
        }
      }
      if (primary && style?.silo && style.siloPosition) {
        const site = b.site ?? b, angle = site.axisDeg * Math.PI / 180;
        const sx = site.x - village[0], sz = village[1] - site.y;
        const sa = Math.sin(angle), ca = Math.cos(angle);
        const sX = (u: number, v: number) => sx + sa * u + ca * v;
        const sZ = (u: number, v: number) => sz - ca * u + sa * v;
        const { u, v, diameter, height } = style.siloPosition;
        const radius = diameter / 2, cap = height - 2;
        const concrete = rgb('#c3c5bf'), red = rgb('#a04438'), white = rgb('#e2e1d8');
        const segments = 16;
        const siloFoot = base + foundationDepth(1);
        const topX = sX(u, v), topZ = sZ(u, v), topY = base + height;
        for (let i = 0; i < segments; i++) {
          const a0 = i * Math.PI * 2 / segments, a1 = (i + 1) * Math.PI * 2 / segments;
          const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
          const x0 = sX(u + c0 * radius, v + s0 * radius), z0 = sZ(u + c0 * radius, v + s0 * radius);
          const x1 = sX(u + c1 * radius, v + s1 * radius), z1 = sZ(u + c1 * radius, v + s1 * radius);
          quadN(x0, siloFoot, z0, x1, siloFoot, z1, x1, base + cap, z1, x0, base + cap, z0, concrete, 0.83 + 0.17 * c0);
          const colour = i % 2 === 0 ? red : white;
          // Three latitude bands form a rounded striped dome, 14 m total height.
          for (let j = 0; j < 3; j++) {
            const t0 = j * Math.PI / 6, t1 = (j + 1) * Math.PI / 6;
            const r0 = radius * Math.cos(t0), y0 = base + (cap + 2 * Math.sin(t0));
            const p0x = sX(u + c0 * r0, v + s0 * r0), p0z = sZ(u + c0 * r0, v + s0 * r0);
            const p1x = sX(u + c1 * r0, v + s1 * r0), p1z = sZ(u + c1 * r0, v + s1 * r0);
            if (j === 2) triN(p0x, y0, p0z, p1x, y0, p1z, topX, topY, topZ, colour);
            else {
              const r1 = radius * Math.cos(t1), y1 = base + (cap + 2 * Math.sin(t1));
              quadN(p0x, y0, p0z, p1x, y0, p1z,
                sX(u + c1 * r1, v + s1 * r1), y1, sZ(u + c1 * r1, v + s1 * r1),
                sX(u + c0 * r1, v + s0 * r1), y1, sZ(u + c0 * r1, v + s0 * r1), colour);
            }
          }
        }
        const x0 = sX(u - radius - 1, v - radius - 1), z0 = sZ(u - radius - 1, v - radius - 1);
        const x1 = sX(u + radius + 1, v + radius + 1), z1 = sZ(u + radius + 1, v + radius + 1);
        const x2 = sX(u - radius - 1, v + radius + 1), z2 = sZ(u - radius - 1, v + radius + 1);
        const x3 = sX(u + radius + 1, v - radius - 1), z3 = sZ(u + radius + 1, v - radius - 1);
        this.clear.push([Math.min(x0, x1, x2, x3), Math.min(z0, z1, z2, z3), Math.max(x0, x1, x2, x3), Math.max(z0, z1, z2, z3)]);
      }
      this.clear.push(...clearBoxes(b, village, 2.5));
    }
    // Hand-built roofs and park props share the ordinary building draws and their water reflection.
    if (details) {
      for (const value of details.pos) pos.push(value);
      for (const value of details.col) col.push(value);
    }
    this.triangles = pos.length / 9;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // The LOW paint stays in linear light. A normalized byte retains the ramp at a quarter of the colour bandwidth.
    if (low) {
      const bytes = new Uint8Array(col.length);
      for (let i = 0; i < col.length; i++) {
        const v = col[i];
        bytes[i] = Math.round(255 * (v < 0 ? 0 : v > 1 ? 1 : v));
      }
      geo.setAttribute('color', new THREE.BufferAttribute(bytes, 3, true));
    } else {
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    geo.computeVertexNormals();
    if (low) {
      const normals = geo.getAttribute('normal').array;
      const packed = new Int8Array(normals.length);
      for (let i = 0; i < normals.length; i++) packed[i] = Math.round(normals[i] * 127);
      geo.setAttribute('normal', new THREE.BufferAttribute(packed, 3, true));
    }
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    if (winter && snowHeight) {
      // The appended mixed detail batch has no building-relative heights. Leave it unpainted.
      const heights = new Float32Array(pos.length / 3);
      heights.set(snowHeight);
      geo.setAttribute('snowHeight', new THREE.BufferAttribute(heights, 1));
      snowRoof(this.mesh.material as THREE.MeshLambertMaterial, winter);
    }
    if (closedWallRanges && sunDir) {
      // The world-space mesh and the directional sun stay fixed for this load. Each marked flat face
      // gets one depth decision. The shadow camera follows the driver along this same sun direction.
      const normals = geo.getAttribute('normal');
      const wall = new Uint8Array(normals.count);
      for (let r = 0; r < closedWallRanges.length; r += 2) {
        for (let i = closedWallRanges[r]; i < closedWallRanges[r + 1]; i += 3) {
          const facing = normals.getX(i) * sunDir.x + normals.getY(i) * sunDir.y + normals.getZ(i) * sunDir.z;
          wall.fill(facing > 0 ? 2 : 1, i, i + 3);
        }
      }
      geo.setAttribute('closedWall', new THREE.BufferAttribute(wall, 1));
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.onBeforeCompile = shader => {
        // Zero is an open surface, one is a back face, and two faces the sun. Clip only the last case.
        shader.vertexShader = 'attribute float closedWall;\n' + shader.vertexShader.replace('#include <project_vertex>',
          '#include <project_vertex>\nif (closedWall > 1.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
      };
      this.mesh.customDepthMaterial = depth;
    }
    if (facadeRanges) streamFacadeDetail(this.mesh, facadeRanges);
    this.mesh.frustumCulled = false;
  }
}
