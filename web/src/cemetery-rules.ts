import type { Place } from './places';
import type { Solid } from './parked';

export type Point = [number, number];
export interface Cemetery {
  id: string; ring: Point[]; area: number;
  wall: Point[][];
  interior: Region[];
  stoneArea: Region[];
  openings: { point: Point; heading: number; width: number; boundaryLength: number; lane: Point[]; bodyRadius: number; track?: number; laneHalfWidth: number; kind: 'gate' | 'track'; path: Point[] }[];
  groundArea: number; suppressed?: string;
  road: { id: number; name: string; point: Point; distance: number } | null;
  /** Compass radians toward the road, in the map frame (east, north). */
  gate: { point: Point; heading: number; track?: number };
}
export interface Region { outer: Point[]; holes: Point[][] }
export interface CemeteryFile { crs: 'EPSG:2961'; area: string; roadsSha256: string; cemeteries: Cemetery[] }
export interface Stone { point: Point; turn: number; kind: number; shade: number }
export function nearestPoint(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy;
  const t = ll ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
export const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export function boundaryDistance(p: Point, ring: Point[]): number {
  let d = Infinity;
  for (let i = 1; i < ring.length; i++) d = Math.min(d, distance(p, nearestPoint(p, ring[i - 1], ring[i])));
  return d;
}
/** Includes the boundary, for prop exclusion as well as stone clearance. */
export function inside(p: Point, ring: Point[]): boolean {
  if (boundaryDistance(p, ring) < 1e-7) return true;
  let hit = false;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
/** The bake owns the adjusted footprint and openings; the renderer does no road clipping. */
export function inRegions(p: Point, regions: Region[]): boolean {
  return regions.some(r => inside(p, r.outer) && !r.holes.some(h => inside(p, h)));
}
export function gateLane(p: Point, c: Cemetery): boolean {
  return c.openings.some(o => {
    const dx = p[0] - o.point[0], dy = p[1] - o.point[1], s = Math.sin(o.heading), n = Math.cos(o.heading);
    return Math.abs(dx * n - dy * s) < o.laneHalfWidth && Math.abs(dx * s + dy * n) < 12;
  });
}

function random(id: string): () => number {
  let seed = 2166136261;
  for (const ch of id) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
/** Tidy rows follow the longest mapped edge. Decorative shapes are never burial records. */
export function stoneLayout(c: Cemetery, low = false): Stone[] {
  if (!c.wall.length || c.suppressed) return [];
  let longest = 0, turn = 0;
  for (let i = 1; i < c.ring.length; i++) {
    const a = c.ring[i - 1], b = c.ring[i], len = distance(a, b);
    if (len > longest) { longest = len; turn = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  const co = Math.cos(turn), si = Math.sin(turn), origin = c.ring[0];
  const uv = c.ring.map(p => [(p[0] - origin[0]) * co + (p[1] - origin[1]) * si, -(p[0] - origin[0]) * si + (p[1] - origin[1]) * co]);
  const us = uv.map(p => p[0]), vs = uv.map(p => p[1]), rnd = random(c.id);
  const candidates: (Stone & { rank: number })[] = [];
  for (let u = Math.min(...us) + 3; u <= Math.max(...us) - 3; u += 3.2) {
    for (let v = Math.min(...vs) + 3; v <= Math.max(...vs) - 3; v += 5) {
      const point: Point = [origin[0] + co * u - si * v, origin[1] + si * u + co * v];
      if (!inRegions(point, c.stoneArea) || gateLane(point, c)) continue;
      // Keep the complete conservative footprint out of the lane, including its far end.
      const cornerInLane = [-0.36, 0.36].some(u => [-0.23, 0.23].some(v => gateLane([point[0] + u * co - v * si, point[1] + u * si + v * co], c)));
      if (cornerInLane) continue;
      candidates.push({ point, turn, kind: Math.floor(rnd() * 3), shade: rnd(), rank: rnd() });
    }
  }
  // A stable spread over the whole site, also for the phone subset.
  return candidates.sort((a, b) => a.rank - b.rank).slice(0, low ? 55 : 220).map(({ rank: _rank, ...s }) => s);
}
/**
 * Road-side edges where the dash cam shows something other than the baked wall (map points along a baked wall line):
 * 'open' draws nothing there, 'hedge' draws a low clipped hedge. The bake's wall, openings and checks are unchanged.
 */
export const ROAD_EDGES: { area: string; a: Point; b: Point; kind: 'open' | 'hedge' }[] = [
  // Judique, the church cemetery east of Highway 19: open lawn to the road, no wall (the project brief brief, item 8).
  { area: 'judique', a: [617103.58, 5081701.95], b: [617115.91, 5081785.47], kind: 'open' },
  // Judique, the larger cemetery opposite: a low clipped hedge along the road, not a wall.
  { area: 'judique', a: [617092.78, 5081792.26], b: [617083.11, 5081745.14], kind: 'hedge' },
  { area: 'judique', a: [617095.34, 5081820.2], b: [617093.38, 5081796.45], kind: 'hedge' },
  { area: 'judique', a: [617096.22, 5081858.37], b: [617095.67, 5081826.8], kind: 'hedge' },
];
/** What stands on one wall segment: the baked wall unless a road-side edge covers both its ends. */
export function edgeKind(area: string, a: Point, b: Point): 'wall' | 'open' | 'hedge' {
  const edge = ROAD_EDGES.find(e => e.area === area && distance(a, nearestPoint(a, e.a, e.b)) < 0.5 && distance(b, nearestPoint(b, e.a, e.b)) < 0.5);
  return edge?.kind ?? 'wall';
}
/** Only subdivide the baked open polylines for terrain fitting. Never reconstruct a mapped ring. */
export function fenceSegments(c: Cemetery, step = 3): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const line of c.wall) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], n = Math.ceil(distance(a, b) / step);
    const p = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let k = 0; k < n; k++) out.push([p(k / n), p((k + 1) / n)]);
  }
  return out;
}

export function fenceSolids(c: Cemetery, origin: Point): Solid[] {
  return fenceSegments(c).map(([a, b]) => ({ x: (a[0] + b[0]) / 2 - origin[0], z: origin[1] - (a[1] + b[1]) / 2,
    half: distance(a, b) / 2, halfWidth: 0.15, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) }));
}
/** The solids a site actually draws: none on an open road edge, and as thick as the hedge on a hedge edge. */
export const HEDGE_THICK = 0.75;
export function drawnSolids(c: Cemetery, origin: Point, area: string): Solid[] {
  return fenceSegments(c).flatMap(([a, b]) => {
    const kind = edgeKind(area, a, b);
    if (kind === 'open') return [];
    return [{ x: (a[0] + b[0]) / 2 - origin[0], z: origin[1] - (a[1] + b[1]) / 2, half: distance(a, b) / 2,
      halfWidth: kind === 'hedge' ? HEDGE_THICK / 2 : 0.15, heading: Math.atan2(b[0] - a[0], b[1] - a[1]) }];
  });
}
export function cemeteryPlaces(cemeteries: Cemetery[], area: Place['area']): Place[] {
  return cemeteries.filter(c => c.road).map(c => {
    const road = c.road!, peers = cemeteries.filter(p => p.road?.name === road.name);
    let suffix = '';
    if (peers.length > 1) {
      const center: Point = [peers.reduce((n, p) => n + p.gate.point[0], 0) / peers.length, peers.reduce((n, p) => n + p.gate.point[1], 0) / peers.length];
      const dx = c.gate.point[0] - center[0], dy = c.gate.point[1] - center[1];
      const heading = Math.atan2(dx, dy), words = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
      suffix = ` (${words[(Math.round(heading / (Math.PI / 4)) + 8) % 8]})`;
    }
    return { id: c.id, area, name: `Cemetery, ${road.name}${suffix}`, kind: 'site', rank: 3, e: c.gate.point[0], n: c.gate.point[1],
      note: `A cemetery near ${road.name}.`, sources: [`terrain/cemeteries.json#${c.id}`] };
  });
}
