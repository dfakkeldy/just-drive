/** Public road geometry only. All calculations here use EPSG:2961 east/north metres. */
import data from './sidewalks-data.json';
export type Point = [number, number];
export interface WalkRun {
  id: string; area: string; road: string; side: string; start: Point; end: Point;
  width: number; buffer: number; material: string; curb: string; confidence: string;
  bridge?: boolean; note?: string;
}
export interface WalkRoad { id: number; name: string | null; kind: number; halfWidth: number; bridge: boolean; pts: Point[] }
export interface Obstacle { id: string; polygon: Point[] }
export interface WalkSection { centre: Point; normal: Point; inner: Point; outer: Point; road: WalkRoad; lift: number; along: number }
export interface WalkPiece { run: WalkRun; a: WalkSection; b: WalkSection; material: string; buffer?: boolean }
export interface WalkFurniture { run:string; kind:'lamp'|'bench'; point:Point; normal:Point; polygon:Point[] }
export interface PoleMove { index:number; from:Point; to:Point }
export interface WalkPlan { poleMoves:PoleMove[]; furniture: WalkFurniture[]; pieces: WalkPiece[]; skipped: { run: string; reason: string; metres: number }[]; crossings: { run: string; road: number; driveway: boolean }[]; lengths: Record<string, number> }
export const WALK_RUNS = data.runs as WalkRun[];
export const WALK_BUDGET = { draws: 2, desktop: 14000, low: 6000 };
const directions: Record<string, Point> = { 'north-west': [-1, 1], 'north-east': [1, 1], 'south-west': [-1, -1], west: [-1, 0] };
const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const mix = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export function validateWalks(runs = WALK_RUNS): void {
  const ids = new Set<string>();
  for (const r of runs) {
    if (ids.has(r.id) || !r.id || !['mabou', 'porthood', 'pointtupper'].includes(r.area) || !r.road || !directions[r.side]
      || ![r.start, r.end].every(p => p.length === 2 && p.every(Number.isFinite) && p[0] > 600000 && p[0] < 650000 && p[1] > 5000000 && p[1] < 5150000)
      || !Number.isFinite(r.width) || r.width < 1 || r.width > 1.5 || !Number.isFinite(r.buffer) || r.buffer < 0 || r.buffer > 2
      || !['concrete', 'asphalt'].includes(r.material) || !['raised', 'rolled', 'none'].includes(r.curb)
      || !['high', 'medium'].includes(r.confidence)) throw Error(`Invalid sidewalk run ${r.id}`);
    ids.add(r.id);
  }
}
interface Edge { to: number; road: WalkRoad; length: number }
interface Node { p: Point; edges: Edge[] }
/** Snap both limits, then take the shortest connected route on the named road. Never chord across bends. */
export function routeWalk(run: WalkRun, roads: WalkRoad[]): { p: Point; road: WalkRoad }[] {
  const nodes: Node[] = [], keys = new Map<string, number>();
  const node = (p: Point) => { const k = p.map(v => v.toFixed(2)).join(','); let i = keys.get(k); if (i === undefined) { i = nodes.length; keys.set(k, i); nodes.push({ p, edges: [] }); } return i; };
  const segments: { a: number; b: number; road: WalkRoad }[] = [];
  const link = (a: number, b: number, road: WalkRoad) => {
    const length = distance(nodes[a].p, nodes[b].p); nodes[a].edges.push({ to: b, road, length }); nodes[b].edges.push({ to: a, road, length });
  };
  for (const road of roads) if (road.name === run.road && (!run.bridge || road.bridge)) {
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      if (Math.max(a[0], b[0]) < Math.min(run.start[0], run.end[0]) - 200 || Math.min(a[0], b[0]) > Math.max(run.start[0], run.end[0]) + 200
        || Math.max(a[1], b[1]) < Math.min(run.start[1], run.end[1]) - 200 || Math.min(a[1], b[1]) > Math.max(run.start[1], run.end[1]) + 200) continue;
      const ai = node(a), bi = node(b); link(ai, bi, road); segments.push({ a: ai, b: bi, road });
    }
  }
  // Provincial pieces can end a few centimetres apart. Only join vertices inside 0.5 m.
  const cells = new Map<string, number[]>();
  for (let i = 0; i < nodes.length; i++) {
    const p = nodes[i].p, x = Math.floor(p[0]), y = Math.floor(p[1]);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of cells.get(`${x + dx},${y + dy}`) ?? []) if (distance(p, nodes[j].p) <= .5) link(i, j, nodes[i].edges[0].road);
    const key = `${x},${y}`; const bucket = cells.get(key) ?? []; bucket.push(i); cells.set(key, bucket);
  }
  const snap = (p: Point) => {
    let best: { s: typeof segments[number]; p: Point; d: number } | undefined;
    for (const s of segments) { const q = closest(p, nodes[s.a].p, nodes[s.b].p), d = distance(p, q); if (!best || d < best.d) best = { s, p: q, d }; }
    if (!best || best.d > 35) throw Error(`Cannot fit sidewalk ${run.id} to ${run.road}`);
    const i = node(best.p); if (i !== best.s.a) link(i, best.s.a, best.s.road); if (i !== best.s.b) link(i, best.s.b, best.s.road); return i;
  };
  const start = snap(run.start), end = snap(run.end), cost = nodes.map(() => Infinity), from = new Map<number, { id: number; road: WalkRoad }>(), visited = new Set<number>();
  cost[start] = 0;
  // Routes are cropped to the brief's town stretch (hundreds of vertices, startup only).
  while (!visited.has(end)) {
    let u = -1; for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || !Number.isFinite(cost[u])) throw Error(`Disconnected sidewalk ${run.id}`);
    visited.add(u);
    for (const e of nodes[u].edges) if (cost[u] + e.length < cost[e.to]) { cost[e.to] = cost[u] + e.length; from.set(e.to, { id: u, road: e.road }); }
  }
  const result: { p: Point; road: WalkRoad }[] = [];
  for (let u = end; u !== start;) { const prev = from.get(u)!; result.push({ p: nodes[u].p, road: prev.road }); u = prev.id; }
  result.push({ p: nodes[start].p, road: result[result.length - 1].road }); return result.reverse();
}
export function closest(p: Point, a: Point, b: Point): Point {
  const x = b[0] - a[0], y = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y || 1)));
  return mix(a, b, t);
}
function inside(p: Point, poly: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function overlaps(a: Point[], b: Point[]): boolean {
  if (a.some(p => inside(p, b)) || b.some(p => inside(p, a))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p = a[i], q = a[(i + 1) % a.length], r = b[j], s = b[(j + 1) % b.length];
    if (Math.max(p[0], q[0]) < Math.min(r[0], s[0]) || Math.max(r[0], s[0]) < Math.min(p[0], q[0]) || Math.max(p[1], q[1]) < Math.min(r[1], s[1]) || Math.max(r[1], s[1]) < Math.min(p[1], q[1])) continue;
    if (cross(p, q, r) * cross(p, q, s) <= 0 && cross(r, s, p) * cross(r, s, q) <= 0) return true;
  }
  return false;
}
export const piecePolygon = (p: WalkPiece): Point[] => [p.a.inner, p.b.inner, p.b.outer, p.a.outer];
export function sidewalkObstacles(buildings: { footprint: Point[] }[], props: Record<string, { x: number; y: number; modules?: number }[]>): Obstacle[] {
  const result = buildings.map((b, i) => ({ id: `building-${i}`, polygon: b.footprint }));
  for (const kind of ['mailboxes', 'communityBoxes', 'poles', 'lamps', 'benches']) for (const [i, p] of (props[kind] ?? []).entries()) {
    // Include the whole cabinet bank, bench, mailbox box, or pole base, plus walking clearance.
    const r = kind === 'communityBoxes' ? (p.modules ?? 4) * .65 + .6 : kind === 'benches' ? 1.7 : kind === 'mailboxes' ? 1 : .65;
    result.push({ id: `${kind}-${i}`, polygon: [[p.x-r,p.y-r],[p.x+r,p.y-r],[p.x+r,p.y+r],[p.x-r,p.y+r]] });
  }
  return result;
}
