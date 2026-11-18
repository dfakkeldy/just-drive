import type { Road } from './roads';
import { railPoint, roadLength } from './guardrail-rules';
import { railwayRoad } from './railway-road';

export type AnimalPassage = 'clear' | 'blocked' | 'pending';
/** Wild Cape Breton roadside animals. Moose are rare and keep to the gravel back roads. */
export type AnimalSpecies = 'deer' | 'fox' | 'moose';
export const ANIMAL_SPECIES: readonly AnimalSpecies[] = ['deer', 'fox', 'moose'];
export type AnimalBox = readonly number[];
type Point = { x: number; z: number };
export interface AnimalRoute {
  road: Road; along: number; side: number; species: AnimalSpecies;
  /** home: its field. stop: where it stands in the lane. far: the field across the road, where it escapes to when a
   *  car is on its home side. heading: home to stop. When it reaches `far` the two fields swap (crossRoute). */
  home: Point; stop: Point; far: Point; heading: number;
  /** The asphalt between the two road edges, as progress: a near miss counts only in (onto, off). */
  onto: number; off: number;
}
/** waiting: in the field. walking: onto the road. stopped: standing in the lane. leaving: walking off the road.
 *  bolting: startled by a fast car, running off the road. Both go away from the car: home (`dir` -1) or across the road
 *  (`dir` 1). Nobody is ever hurt: a fast pass is a near miss, and no car body ever reaches an animal in the lane. */
export type AnimalState = 'waiting' | 'walking' | 'stopped' | 'leaving' | 'bolting';
export interface AnimalMotion {
  /** progress: 0 home, 1 the lane stop, 2 the far field. */
  state: AnimalState; progress: number; timer: number; cooldown: number; dir: number;
}
/** speed (m/s): faster than this and an animal in the lane has to bolt; slower and it steps off calmly.
 *  startle: metres from the animal (or `reaction` seconds of travel, if further) where a fast car startles it.
 *  yield: a slow car this close sends it off the road at a walk; a closing car from further out, so that it is off the
 *  road `margin` metres before the car arrives. step: it does not step out while a car is this close to its lane stop.
 *  hint: metres, as the painter's: the car, the Heavy pickup
 *  and the side-by-side see it, read it and can brake. read: seconds the HUD must have shown the hint before a
 *  near miss can be a complaint (one second, plus the 0.2 s the HUD line can lag the game). field: metres past the road edge where it waits, out of reach of a car on the verge.
 *  shy: metres between a waiting animal and the body (its reach) of the car or a hitched trailer, only reached by driving
 *  into the field: closer, and it slips out of sight. A car in either lane is far outside it. horn: metres the
 *  horn reaches. keepAway: metres from the fixed animal sites
 *  (the dogs, the bull, the cows) and from the roadside scene, so no two encounters share a road or a hint. */
export const ANIMAL = Object.freeze({ radius: .95, speed: 8, startle: 14, reaction: .7, yield: 10, margin: 6, step: 25, hint: 160,
  read: 1.2, field: 9, shy: 2, horn: 65, keepAway: 350, after: 5, perDay: 4, spacing: 300 });
/** Progress per second over a field-to-lane half (about 11 m): a walk, a trot (about 6.5 m/s), a run (about 15 m/s). */
export const ANIMAL_RATE = Object.freeze({ walk: .16, leave: .6, bolt: 1.4 });
const NAME: Record<AnimalSpecies, string> = { deer: 'deer', fox: 'fox', moose: 'moose' };
/** The instruction first: a landscape phone shows the hint on one clipped line. */
export const ANIMAL_TEXT = Object.freeze(Object.fromEntries(ANIMAL_SPECIES.map(s => [s, {
  approach: `SLOW DOWN: a ${NAME[s]} on the road. HORN to move it along.`,
  missed: `Too close. The ${NAME[s]} made the ditch; someone on a porch saw it all.`,
}])) as Record<AnimalSpecies, { approach: string; missed: string }>);
function hash(value: number): number {
  let n = value | 0; n = Math.imul(n ^ n >>> 16, 0x45d9f3b); n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
  return (n ^ n >>> 16) >>> 0;
}
/** Writes into `out`; the physics step calls this, so it makes nothing. */
export function routePoint(route: AnimalRoute, progress: number, out: Point): Point {
  const a = progress <= 1 ? route.home : route.stop, b = progress <= 1 ? route.stop : route.far, t = progress <= 1 ? progress : progress - 1;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}
/** The crossing half (stop to the far field) as a route of its own, for the safety tests. */
export function farRoute(route: AnimalRoute): AnimalRoute {
  return { ...route, home: route.far, far: route.home };
}
/** After a crossing the far field is home: swap the fields and turn the walking heading. */
export function crossRoute(route: AnimalRoute): void {
  const home = route.home; route.home = route.far; route.far = home; route.side = -route.side;
  route.heading = Math.atan2(route.stop.x - route.home.x, -(route.stop.z - route.home.z));
  asphalt(route);
}
/** Each field is ANIMAL.field metres past its road edge, so the asphalt starts that far along each half. */
export function asphalt(route: AnimalRoute): void {
  const near = Math.hypot(route.stop.x - route.home.x, route.stop.z - route.home.z), far = Math.hypot(route.far.x - route.stop.x, route.far.z - route.stop.z);
  route.onto = ANIMAL.field / near; route.off = 1 + (far - ANIMAL.field) / far;
}
/** A complete padded path must avoid every site, not only its road pause. */
export function routeOutside(route: AnimalRoute, boxes: readonly AnimalBox[]): boolean {
  const pad = ANIMAL.radius + .5;
  for (const b of boxes) if (Math.max(route.home.x, route.stop.x) + pad >= b[0] && Math.min(route.home.x, route.stop.x) - pad <= b[2]
    && Math.max(route.home.z, route.stop.z) + pad >= b[1] && Math.min(route.home.z, route.stop.z) - pad <= b[3]) return false;
  return true;
}
/** True when the route's road pause is at least ANIMAL.keepAway from every given point (its field home is a few metres off). */
export function routeApart(route: AnimalRoute, points: readonly Point[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - route.stop.x, dz = points[i].z - route.stop.z;
    if (dx * dx + dz * dz < ANIMAL.keepAway * ANIMAL.keepAway) return false;
  }
  return true;
}
/** Species from the daily hash: deer most days, foxes often, a moose now and then on a gravel road. */
export function animalSpecies(rank: number, kind: number): AnimalSpecies {
  const roll = (rank >>> 3) % 20;
  return roll === 0 && kind === 3 ? 'moose' : roll < 7 ? 'fox' : 'deer';
}
/** Fixed daily candidates on paved and gravel roads (never highways, bridges or rail), only where `fine` says the finest
 *  baked land exists (elsewhere the route could never be proved and the animal would never appear).
 *  Stream order and camera position never select another home. At most one moose a day. */
export function animalRoutes(roads: readonly Road[], day: number, boxes: readonly AnimalBox[], apart: readonly Point[] = [],
  fine: (x: number, z: number) => boolean = () => true): AnimalRoute[] {
  const candidates: { route: AnimalRoute; rank: number }[] = [];
  for (const road of roads) {
    if (road.kind < 2 || road.kind > 3 || road.bridge || railwayRoad(road) || road.halfWidth < 2) continue;
    const length = roadLength(road);
    for (let station = 50; station < length - 50; station += 100) {
      const rank = hash(day ^ Math.imul(road.id, 7919) ^ Math.imul(station, 104729));
      const along = station + (rank % 31) - 15, side = rank & 1 ? 1 : -1;
      const home = railPoint(road, along, side * (road.halfWidth + ANIMAL.field));
      const stop = railPoint(road, along, side * road.halfWidth * .35), far = railPoint(road, along, -side * (road.halfWidth + ANIMAL.field));
      const route: AnimalRoute = { road, along, side, species: animalSpecies(rank, road.kind), home, stop, far,
        heading: Math.atan2(stop.x - home.x, -(stop.z - home.z)), onto: 0, off: 2 };
      asphalt(route);
      // Both halves clear of the sites here, so a route that could never be proved does not take a daily slot.
      if (fine(home.x, home.z) && fine(stop.x, stop.z) && fine(far.x, far.z) && routeOutside(route, boxes) && routeOutside(farRoute(route), boxes)
        && routeApart(route, apart)) candidates.push({ route, rank });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank || a.route.road.id - b.route.road.id || a.route.along - b.route.along);
  const routes: AnimalRoute[] = [];
  for (const { route } of candidates) {
    if (routes.some(r => Math.hypot(r.home.x - route.home.x, r.home.z - route.home.z) < ANIMAL.spacing)) continue;
    if (route.species === 'moose' && routes.some(r => r.species === 'moose')) route.species = 'deer';
    routes.push(route); if (routes.length === ANIMAL.perDay) break;
  }
  return routes;
}
/** Finest loaded ground and current rail plans are mandatory along the whole body corridor. `ground` gives null for land
 *  not loaded yet (pending) and NaN for land that will never do (no finest tile, or marsh at sea level): blocked. */
export function routeSafety(route: AnimalRoute, ground: (x: number, z: number) => number | null,
  railPassage: (x: number, z: number, radius: number) => AnimalPassage): AnimalPassage {
  const count = Math.ceil(Math.hypot(route.home.x - route.stop.x, route.home.z - route.stop.z) / .4), p = { x: 0, z: 0 };
  let previous: number | null = null, pending = false;
  for (let i = 0; i <= count; i++) {
    routePoint(route, i / count, p);
    const h = ground(p.x, p.z), rail = railPassage(p.x, p.z, ANIMAL.radius + .25);
    if (rail === 'blocked') return 'blocked';
    if (rail === 'pending') pending = true;
    if (h !== null && Number.isNaN(h)) return 'blocked';
    if (h === null) { pending = true; previous = null; continue; }
    if (previous !== null && Math.abs(h - previous) > .3) return 'blocked';
    for (const [dx, dz] of [[ANIMAL.radius, 0], [-ANIMAL.radius, 0], [0, ANIMAL.radius], [0, -ANIMAL.radius]]) {
      const edge = ground(p.x + dx, p.z + dz);
      if (edge !== null && Number.isNaN(edge)) return 'blocked';
      if (edge === null) pending = true;
      else if (Math.abs(edge - h) > .55) return 'blocked';
    }
    previous = h;
  }
  return pending ? 'pending' : 'clear';
}
/** Out of its field and not yet bolting: walking out, standing, or walking off. The states that hint and can be a near miss. */
export function onRoad(a: AnimalMotion): boolean { return a.state !== 'waiting' && a.state !== 'bolting' && a.progress > 0 && a.progress < 2; }
/**
 * Field behaviour, once a frame. `distance` is from the car to the animal's field home, `stopDistance` to its lane stop.
 * Returns true when the animal has just reached the far field (the caller swaps the fields with crossRoute).
 */
export function moveAnimal(a: AnimalMotion, dt: number, distance: number, stopDistance: number): boolean {
  if (dt <= 0) return false;
  a.cooldown = Math.max(0, a.cooldown - dt);
  if (a.state === 'waiting') {
    a.timer = distance < 75 && stopDistance > ANIMAL.step && a.cooldown === 0 ? a.timer + dt : 0;
    if (a.timer >= 2) { a.state = 'walking'; a.timer = 0; }
  } else if (a.state === 'walking') {
    a.progress = Math.min(1, a.progress + dt * ANIMAL_RATE.walk);
    if (a.progress === 1) { a.state = 'stopped'; a.timer = 0; }
  } else if (a.state === 'stopped') {
    a.timer += dt;
    if (a.timer >= 22) leave(a, 'leaving', -1);
  } else {
    const rate = a.state === 'bolting' ? ANIMAL_RATE.bolt : ANIMAL_RATE.leave;
    a.progress = Math.max(0, Math.min(2, a.progress + a.dir * dt * rate));
    if (a.progress === 0 || a.progress === 2) {
      const crossed = a.progress === 2;
      a.state = 'waiting'; a.timer = 0; a.progress = 0; a.dir = -1;
      return crossed;
    }
  }
  return false;
}
export function leave(a: AnimalMotion, how: 'leaving' | 'bolting', dir: number): void { a.state = how; a.timer = 0; a.cooldown = 90; a.dir = dir; }
/** Away from the car's line: across the road (1) when the car is on the home side of where the animal is now, otherwise
 *  home (-1). Only routes with both fields proved safe are used, so either way is open. */
export function escapeDirection(route: AnimalRoute, x: number, z: number, from: Point): number {
  return (x - from.x) * (route.far.x - route.home.x) + (z - from.z) * (route.far.z - route.home.z) < 0 ? 1 : -1;
}
/** The hint, as the painter's: while a moving car closes from ANIMAL.hint or is inside the startle range. */
export function animalHinting(distance: number, closing: number, speed: number): boolean {
  return Math.abs(speed) > 1 && (distance < startleRange(speed) || distance < ANIMAL.hint && closing > 1);
}
export function startleRange(speed: number): number { return Math.max(ANIMAL.startle, Math.abs(speed) * ANIMAL.reaction); }
/** A walking animal needs 1 / ANIMAL_RATE.leave seconds to leave the road; it starts while the car is that far out
 *  at its closing speed, plus ANIMAL.margin. */
export function yieldRange(closing: number): number { return Math.max(ANIMAL.yield, Math.max(0, closing) / ANIMAL_RATE.leave + ANIMAL.margin); }
/** What a car does to an animal in the lane this step. A fast car holds it frozen in the lane until it is inside the
 *  startle range, then it bolts (a near miss); a car at or under ANIMAL.speed sends it off the road early, at a trot. */
export function animalReaction(distance: number, closing: number, speed: number): 'none' | 'yield' | 'startle' {
  if (Math.abs(speed) > ANIMAL.speed) return closing > 0 && distance < startleRange(speed) ? 'startle' : 'none';
  return distance < yieldRange(closing) ? 'yield' : 'none';
}
