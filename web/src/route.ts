import type { Props } from './props';
import type { Road, RoadHit, Roads } from './roads';

// Road names, not prop indices, define this carrier's territory and driving order.
export const ROUTE_ROADS = [
  'Highway 19', 'Southwest Ridge Road', 'MacKillop Road', 'MacLeods Road',
  'Rankinville Road', 'Beaton Road', 'Sergeant Lane', 'Murray Hill Road', 'Mull River Road',
  'Whycocomagh Port Hood Road', 'Upper Glencoe Road', 'Glencoe Road', 'Old Mull River Road',
  'Highway 252', 'Smithville Road', 'Blackstone Road', 'Murphys Hill Road', 'Highway 19',
  'Glenora Falls Road', 'Mabou Harbour Road', 'Northeast Mabou Road', 'MacDonald Glen Road',
  'Mabou Mines Road', 'Mabou Mines Branch', 'Mountain Road', 'Maple Street', 'Birch Street', 'Meadow Road',
] as const;
// Contiguous cuts, counted against baked props by tools/route-check.mjs.
export const RUNS = [
  { name: 'Highway 19 southwest', short: 'HWY 19 SOUTHWEST', end: 1 },
  { name: 'Southwest Ridge', short: 'SOUTHWEST RIDGE', end: 4 },
  { name: 'Rankinville and Mull River', short: 'RANKINVILLE / MULL RIVER', end: 13 },
  { name: 'Highway 252', short: 'HIGHWAY 252', end: 14 },
  { name: 'Smithville', short: 'SMITHVILLE', end: 17 },
  { name: 'Highway 19 and Glenora', short: 'HWY 19 / GLENORA', end: 19 },
  { name: 'Mabou Harbour', short: 'MABOU HARBOUR', end: 20 },
  { name: 'Northeast, Mines and village', short: 'NORTHEAST / MINES / VILLAGE', end: 28 },
] as const;
interface Point { x: number; z: number }
interface Piece { road: Road; reverse: boolean; offset: number; cum: number[]; length: number }
interface Line { pieces: Piece[]; length: number; start: Point; end: Point }
export interface RouteStop { index: number; section: number; along: number; hit: RoadHit }
export interface Run { name: string; short: string; rural: number[]; sites: number[]; stops: RouteStop[]; start: { x: number; z: number; heading: number } | null }
const point = (p: [number, number]): Point => ({ x: p[0], z: p[1] });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const first = (p: Piece) => point(p.road.pts[p.reverse ? p.road.pts.length - 1 : 0]);
const last = (p: Piece) => point(p.road.pts[p.reverse ? 0 : p.road.pts.length - 1]);

/** Join the baked pieces (including bridges) before measuring distance along a named road. */
function line(roads: Road[]): Line | null {
  const waiting: Piece[] = roads.map((road) => {
    const cum = [0];
    for (let i = 1; i < road.pts.length; i++) cum.push(cum[i - 1] + distance(point(road.pts[i - 1]), point(road.pts[i])));
    return { road, reverse: false, offset: 0, cum, length: cum[cum.length - 1] };
  });
  const seed = waiting.shift(); if (!seed) return null;
  const pieces = [seed];
  while (waiting.length) {
    let best = { i: 0, prepend: false, reverse: false, distance: Infinity };
    for (let i = 0; i < waiting.length; i++) for (const prepend of [false, true]) for (const reverse of [false, true]) {
      const p = { ...waiting[i], reverse };
      const d = prepend ? distance(last(p), first(pieces[0])) : distance(last(pieces[pieces.length - 1]), first(p));
      if (d < best.distance) best = { i, prepend, reverse, distance: d };
    }
    const p = waiting.splice(best.i, 1)[0]; p.reverse = best.reverse;
    if (best.prepend) pieces.unshift(p); else pieces.push(p);
  }
  let length = 0;
  for (const p of pieces) { p.offset = length; length += p.length; }
  return { pieces, length, start: first(pieces[0]), end: last(pieces[pieces.length - 1]) };
}
function along(line: Line, hit: RoadHit): number {
  const p = line.pieces.find((p) => p.road.id === hit.road.id)!;
  const s = p.cum[hit.seg] + (p.cum[hit.seg + 1] - p.cum[hit.seg]) * hit.t;
  return p.offset + (p.reverse ? p.length - s : s);
}
function at(line: Line, s: number): Point {
  s = Math.max(0, Math.min(line.length, s));
  const p = line.pieces.find((p) => s <= p.offset + p.length) ?? line.pieces[line.pieces.length - 1];
  const local = p.reverse ? p.length - (s - p.offset) : s - p.offset;
  let i = 0; while (i < p.cum.length - 2 && p.cum[i + 1] < local) i++;
  const t = (local - p.cum[i]) / (p.cum[i + 1] - p.cum[i] || 1);
  const a = point(p.road.pts[i]), b = point(p.road.pts[i + 1]);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

export class Route {
  readonly runs: Run[];
  readonly members = new Map<number, RouteStop>();
  readonly rural: number[] = [];
  readonly downCandidates: number[] = [];
  readonly late: number;

  /** Set before the route is built: a box the car cannot reach (outside the map's wall) is not on the route. */
  static reachable: ((x: number, z: number) => boolean) | null = null;

  constructor(roads: Roads, props: Pick<Props, 'mail' | 'sites'> | null, enabled = true) {
    this.runs = enabled ? RUNS.map((r) => ({ ...r, rural: [], sites: [], stops: [], start: null }))
      : [{ name: 'Local roads', short: 'LOCAL ROADS', rural: [], sites: [], stops: [], start: null }];
    if (!enabled) { this.late = -1; return; }
    const lines = new Map<string, Line>();
    for (const name of new Set(ROUTE_ROADS)) {
      const l = line(roads.roads.filter((r) => r.name === name && r.kind >= 1 && r.kind <= 3));
      if (l) lines.set(name, l);
    }
    const highway = lines.get('Highway 19');
    const centre = roads.nearest(0, 0, 1000, (r) => r.name === 'Highway 19' && r.kind >= 1 && r.kind <= 3);
    const village = highway && centre ? along(highway, centre) : 0;
    // Easting increases from the southwest end to the northeast end of Highway 19.
    const highwayForward = !highway || highway.start.x < highway.end.x;
    const directions: boolean[] = [];
    let previous: Point | null = null;
    ROUTE_ROADS.forEach((name, section) => {
      const l = lines.get(name); if (!l) { directions.push(true); return; }
      const forward = name === 'Highway 19' ? highwayForward : !previous || distance(previous, l.start) <= distance(previous, l.end);
      directions.push(forward);
      previous = section === 0 ? at(l, village) : forward ? l.end : l.start;
    });
    if (props) {
      const targets = [...props.mail, ...props.sites];
      targets.forEach((p, index) => {
        // Filter public roads BEFORE testing membership, so a neighbour's road wins fairly.
        const hit = roads.nearest(p.x, p.z, 256, (r) => r.kind >= 1 && r.kind <= 3);
        if (!hit?.road.name) return;
        if (Route.reachable && !(Route.reachable(p.x, p.z) && Route.reachable(hit.x, hit.z))) return;
        const l = lines.get(hit.road.name); if (!l) return;
        const s = along(l, hit);
        const section = hit.road.name === 'Highway 19'
          ? ((highwayForward ? s < village : s > village) ? 0 : 17)
          : ROUTE_ROADS.findIndex((name) => name === hit.road.name);
        const stop = { index, section, along: directions[section] ? s : l.length - s, hit };
        this.members.set(index, stop);
        const run = this.runs[RUNS.findIndex((r) => section < r.end)];
        run.stops.push(stop);
        (index < props.mail.length ? run.rural : run.sites).push(index);
        if (index < props.mail.length) this.rural.push(index);
      });
      const frames = new Map<object, number>();
      for (const p of props.mail) frames.set(p.motion, (frames.get(p.motion) ?? 0) + 1);
      this.downCandidates.push(...this.rural.filter((i) => frames.get(props.mail[i].motion) === 1));
    }
    for (const run of this.runs) {
      run.stops.sort((a, b) => a.section - b.section || a.along - b.along || a.index - b.index);
      const stop = run.stops[0];
      if (!stop) continue;
      const l = lines.get(stop.hit.road.name!)!;
      const s = along(l, stop.hit), direction = directions[stop.section] ? 1 : -1;
      // Clamp the approach at a baked road edge rather than spawning off the network.
      const before = Math.max(0, Math.min(l.length, s - direction * 30));
      const p = at(l, before), ahead = at(l, before + direction * 2);
      run.start = { ...p, heading: Math.atan2(ahead.x - p.x, -(ahead.z - p.z)) };
    }
    const lastRun = this.runs[this.runs.length - 1];
    this.late = lastRun.rural.find((i) => this.members.get(i)?.hit.road.name === 'Birch Street') ?? lastRun.rural[0] ?? -1;
  }

  forDay(day: number, forced = 0): Run { return this.runs[forced > 0 ? forced - 1 : (day - 1) % this.runs.length]; }
}
