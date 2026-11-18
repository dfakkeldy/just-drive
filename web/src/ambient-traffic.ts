import * as THREE from 'three';
import { vehicleShape, pushOut, PARKED_COLOURS, type Solid } from './parked';
import { Mesher } from './yard-kit';
import { SceneRoad } from './road-scene-rules';
import type { Road, Roads } from './roads';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';

type Pt = readonly [number, number];
type Car = {
  mesh: THREE.Mesh; path: SceneRoad; along: number; speed: number; active: boolean; solid: Solid; solids: Solid[];
  /** Metres right of the centre line (LANE in the lane); less while easing past a stopped player. */
  side: number; held: number; passing: boolean; waited: number; passAt: number;
  /** Ground height and place on the path when the car was last stood on the ground (a far car out of view is not). */
  y: number; placedAt: number;
};
/** A side road that meets the highway: where on the path, the meeting point, and the side road's direction away from it. */
type Junction = { along: number; x: number; z: number; sx: number; sz: number };

const LANE = 1.65, CRUISE = 12, JOIN = 5, PATIENCE = 6, QUEUE = 40;
// Passing a stopped player: a car closer than CLEAR (centre to centre, across the road) is blocked. After HOLD seconds
// stopped behind a stopped player, with no oncoming car within ONCOMING (a pass takes about 6 s), it eases to EASE metres
// from the player (toward the centre line, at most to the oncoming lane's centre), creeping at CREEP, and passes at
// PASS_SPEED. An oncoming car, a player who moves toward the centre line, or a player who rolls on (faster than ROLLING
// along the road: slow traffic to follow, not a stop to pass) ends the pass: the car brakes, drops back behind the
// player, holding its line while it is beside them, and returns to its lane. It finishes the pass instead (on its
// line, never steering toward the player, at most EDGE metres left of the centre line, inside the paved edge of a 3 m
// half-width road) only when it cannot drop back and will be past soon: it cannot stop 2 m short of the player's tail
// (TAIL: half its length plus half the player's) at the closing speed, it is clear of the player across the road
// (APART) or beside them, and, unless the player is still (a car cannot drop back from a still player), it will be
// 8 m past within FINISH seconds at the closing speed. A stopped oncoming car more than ZONE metres beyond the player
// is not in the way of the pass and its return.
const CLEAR = 2.4, EASE = 2.6, HOLD = 3, ONCOMING = 150, PASS_SPEED = 6, SIDE_RATE = 1.5, CREEP = 1, TAIL = 4.75, EDGE = 2.1, APART = 1.9, ZONE = 40, ROLLING = 1, FINISH = 3;
// The camera test of a car that has not been stood on the ground for a while widens by this much per metre driven since
// (a highway grade is under 15%), so a car out of sight that climbed or fell is still seen when the camera turns to it.
const DRIFT = .15, DRIFT_MAX = 60;
// Cars further than NEAR and out of the camera read no ground, so they keep no far land tile in memory.
const NEAR = 150;
const NO_JUNCTIONS: Junction[] = [];
// The map gives no travel direction, and these pieces are one-way carriageways or ramps: two-way cars would drive the wrong way.
const ONE_WAY = /\b(NB|SB|EB|WB)\b|Ramp|Rotary/;
// One body colour per pool slot (blue, red, silver, black), from the parked-car palette. LOW uses the first two.
const BODIES = [PARKED_COLOURS[8], PARKED_COLOURS[9], PARKED_COLOURS[2], PARKED_COLOURS[6]];

/**
 * Highway pieces joined end to end into continuous roads. The map splits a highway at every bridge, so a car that kept
 * to one piece stopped before each bridge. Where three pieces meet, the straightest one under 45 degrees continues.
 */
export function highwayChains(roads: readonly Road[]): { pts: Pt[]; pieces: Set<Road>; halfWidth: number }[] {
  const pieces = roads.filter(r => r.kind === 1 && r.halfWidth >= 3 && r.pts.length > 1 && !ONE_WAY.test(r.name ?? ''));
  const used = new Set<Road>(), chains: { pts: Pt[]; pieces: Set<Road>; halfWidth: number }[] = [];
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN;
  const unit = (a: Pt, b: Pt) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  const extend = (pts: Pt[], chain: Set<Road>) => {
    for (;;) {
      const end = pts[pts.length - 1], [fx, fz] = unit(pts[pts.length - 2], end);
      let best: { pts: Pt[]; road: Road; cos: number } | null = null, count = 0;
      for (const r of pieces) {
        if (used.has(r)) continue;
        const start = near(r.pts[0], end), finish = near(r.pts[r.pts.length - 1], end);
        if (!start && !finish) continue;
        count++;
        const p = start ? r.pts : [...r.pts].reverse(), [gx, gz] = unit(p[0], p[1]), cos = fx * gx + fz * gz;
        if (!best || cos > best.cos) best = { pts: p, road: r, cos };
      }
      if (!best || count > 1 && best.cos < .7) return;
      used.add(best.road); chain.add(best.road); pts.push(...best.pts.slice(1));
    }
  };
  for (const r of pieces) {
    if (used.has(r)) continue;
    used.add(r);
    const chain = new Set([r]), pts: Pt[] = [...r.pts];
    extend(pts, chain); pts.reverse(); extend(pts, chain); pts.reverse();
    chains.push({ pts, pieces: chain, halfWidth: Math.max(...[...chain].map(p => p.halfWidth)) });
  }
  return chains;
}

/** Where other roads end on a chain's middle (side roads join a highway between its piece ends), sorted along it. */
function junctionsOn(path: SceneRoad, own: Set<Road>, roads: readonly Road[], reach: number): Junction[] {
  const pts = path.points, length = path.cumulative[path.cumulative.length - 1], out: Junction[] = [];
  // Segments in 64 m cells, so each road end tests only the few segments near it (a chain has thousands).
  const CELL = 64, cells = new Map<string, number[]>(), key = (cx: number, cz: number) => cx + ',' + cz;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    for (let cx = Math.floor((Math.min(a[0], b[0]) - reach) / CELL); cx <= Math.floor((Math.max(a[0], b[0]) + reach) / CELL); cx++)
      for (let cz = Math.floor((Math.min(a[1], b[1]) - reach) / CELL); cz <= Math.floor((Math.max(a[1], b[1]) + reach) / CELL); cz++) {
        const list = cells.get(key(cx, cz)); if (list) list.push(i); else cells.set(key(cx, cz), [i]);
      }
  }
  for (const r of roads) {
    if (own.has(r) || r.kind > 3 || !r.pts.length) continue;
    for (const [[x, z], [ix, iz]] of [[r.pts[0], r.pts[1] ?? r.pts[0]], [r.pts[r.pts.length - 1], r.pts[r.pts.length - 2] ?? r.pts[0]]]) {
      let best = reach, along = -1;
      for (const i of cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
        const a = pts[i], b = pts[i + 1];
        const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (d * d)));
        const gap = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
        if (gap < best) { best = gap; along = path.cumulative[i] + d * t; }
      }
      // A road end at the chain's own ends is the end of the road: cars stop there anyway. Two ends at one place on the
      // same side are one junction; the two sides of a crossroads are two.
      const l = Math.hypot(ix - x, iz - z) || 1, sx = (ix - x) / l, sz = (iz - z) / l;
      if (along < 20 || along > length - 20 || out.some(j => Math.abs(j.along - along) < 5 && j.sx * sx + j.sz * sz > 0)) continue;
      out.push({ along, x, z, sx, sz });
    }
  }
  return out.sort((a, b) => a.along - b.along);
}

/** Where a car on the same bend would stand across the start tangent: a point on a circular arc at chord length d,
 * with the tangent turned by `turn`, lies d·sin(turn/2) to the right. So a bend neither hides a car in the lane nor
 * brings in one in the other lane, as a straight line from the heading would. */
export function bendOffset(dx: number, dz: number, heading: number, otherHeading: number): number {
  const turn = Math.atan2(Math.sin(otherHeading - heading), Math.cos(otherHeading - heading));
  return (dx * Math.cos(heading) + dz * Math.sin(heading)) - Math.hypot(dx, dz) * Math.sin(turn / 2);
}
/** Small fixed pool on the highways. Cars keep the right lane, stop at a road's end, and recycle out of sight. */
export class AmbientTraffic {
  readonly group = new THREE.Group();
  /** Forward then reverse of each chain, in pairs. */
  readonly paths: SceneRoad[] = [];
  readonly cars: Car[] = [];
  private readonly junctions = new Map<SceneRoad, Junction[]>();
  /** Each path's opposite carriageway: the same chain driven the other way. */
  private readonly partner = new Map<SceneRoad, SceneRoad>();
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 5);
  private readonly probe = { x: 0, z: 0, heading: 0 };
  private cursor = 0;
  private live = true;
  /** Other drivers on the road (the Point Tupper AI). Going the car's way (within 60°): it keeps its distance behind
   * one in its line, measured round the bend. Crossing (a junction): it stops for one across its path within 20 m.
   * Coming the other way within ONCOMING, near its line: it ends or forbids a pass, as an oncoming traffic car does.
   * A spawn keeps 35 m from one. main.ts passes a fixed array, so reading it adds no allocation. One marked `queue`
   * (the Canso canal barrier and its waiting cars) also forbids a pass round a player stopped within QUEUE metres of it. */
  others: readonly { readonly x: number; readonly z: number; readonly heading: number; readonly speed: number;
    readonly spec: { readonly halfLength: number }; readonly queue?: boolean }[] = [];
  /** A place where no car may spawn now (the closed canal span). */
  keepOut: ((x: number, z: number) => boolean) | null = null;
  /** The player's place at the last step, for its speed along the road (any vehicle, any heading). */
  private lastX = NaN; private lastZ = NaN;
  constructor(private readonly roads: Roads, private readonly terrain: Terrain, low: boolean) {
    for (const chain of highwayChains(roads.roads)) {
      const forward = new SceneRoad(chain.pts, 0, 1);
      const length = forward.cumulative[forward.cumulative.length - 1];
      if (length <= 100) continue;
      const reverse = new SceneRoad([...chain.pts].reverse(), 0, 1);
      const ahead = junctionsOn(forward, chain.pieces, roads.roads, chain.halfWidth + 4);
      this.paths.push(forward, reverse);
      this.partner.set(forward, reverse); this.partner.set(reverse, forward);
      this.junctions.set(forward, ahead);
      this.junctions.set(reverse, ahead.map(j => ({ ...j, along: length - j.along })).reverse());
    }
    if (!this.paths.length) return;
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (let i = 0; i < (low ? 2 : 4); i++) {
      const m = new Mesher(), body = new THREE.Color(BODIES[i]);
      vehicleShape(m, 0, null, [body.r, body.g, body.b]);
      const mesh = new THREE.Mesh(m.geometry(), material); mesh.visible = false; this.group.add(mesh);
      const solid = { x: 0, z: 0, heading: 0, half: 2.25, halfWidth: .9 };
      this.cars.push({ mesh, path: this.paths[0], along: 0, speed: 0, active: false, solid, solids: [solid],
        side: LANE, held: 0, passing: false, waited: 0, passAt: -1, y: 0, placedAt: 0 });
    }
  }
  private readonly pose = { x: 0, z: 0, heading: 0 };
  private readonly next = { x: 0, z: 0, heading: 0 };
  private inView(x: number, y: number, z: number, slack = 0): boolean {
    this.sphere.center.set(x, y + 1, z); this.sphere.radius = 5 + slack;
    return this.frustum.intersectsSphere(this.sphere);
  }
  /** Once a frame: recycle and spawn out of sight, and stand the cars on the ground. `live` false (a multiplayer room) clears the road. */
  update(camera: THREE.Camera, player: Vehicle, live = true): void {
    this.live = live;
    if (!live) { for (const c of this.cars) c.active = c.mesh.visible = false; return; }
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.matrix);
    for (const c of this.cars) {
      if (c.active) {
        // The car's own place, at its last known ground height, widened by how far it has driven since it was placed.
        const far = Math.hypot(c.solid.x - player.x, c.solid.z - player.z);
        const seen = this.inView(c.solid.x, c.y, c.solid.z, Math.min(DRIFT_MAX, DRIFT * Math.abs(c.along - c.placedAt)));
        // Out of the camera, a car at its road's end (where it waits) or far away goes back to the pool.
        if (!seen && (c.along > c.path.cumulative[c.path.cumulative.length - 1] - 25 || far > 650)) { c.active = c.mesh.visible = false; }
        // A far car out of view is not stood on the ground (no far tile read), so it is hidden: never a still copy left behind.
        else { if (seen || far < NEAR) this.place(c); else c.mesh.visible = false; continue; }
      }
      // One bounded attempt per frame and slot, independent of road network size.
      const n = this.cursor++, path = this.paths[n % this.paths.length], pose = this.pose;
      const along = 20 + ((n * 97) % Math.max(1, path.cumulative[path.cumulative.length - 1] - 60));
      path.at(along, LANE, pose);
      // Spawn 100–600 m away and out of the camera. Distance first: a far try reads no ground, so it touches no far tile.
      const far = Math.hypot(pose.x - player.x, pose.z - player.z);
      if (far > 600 || far <= 100 || this.crowded(pose.x, pose.z) || this.facesPass(path, along) || this.keepOut?.(pose.x, pose.z)) continue;
      const y = this.ground(pose.x, pose.z);
      if (y === null || this.inView(pose.x, y, pose.z)) continue;
      c.path = path; c.along = along; c.speed = 0; c.active = true; c.side = LANE; c.held = 0; c.passing = false; c.waited = 0; c.passAt = -1;
      c.y = y; c.placedAt = along;
      c.solid.x = pose.x; c.solid.z = pose.z; c.solid.heading = pose.heading; this.place(c);
    }
  }
  private crowded(x: number, z: number): boolean {
    for (const o of this.cars) if (o.active && Math.hypot(o.solid.x - x, o.solid.z - z) < 35) return true;
    for (const o of this.others) if (Math.hypot(o.x - x, o.z - z) < 35) return true;
    return false;
  }
  /**
   * True when no car on the opposite carriageway comes toward c within ONCOMING metres ahead, measured along the road.
   * One that has gone by does not count, nor a stopped one beyond `zone` (it is not in the way of the pass).
   */
  private oncomingClear(c: Car, zone: number): boolean {
    const back = this.partner.get(c.path), length = c.path.cumulative[c.path.cumulative.length - 1];
    for (const o of this.cars) {
      if (!o.active || o.path !== back) continue;
      const gap = length - o.along - c.along;   // o's place on c's path, ahead of c
      if (gap > -5 && gap < ONCOMING && (o.speed > .5 || gap < zone)) return false;
    }
    const fx = Math.sin(c.solid.heading), fz = -Math.cos(c.solid.heading);
    for (const o of this.others) {
      const dx = o.x - c.solid.x, dz = o.z - c.solid.z, gap = dx * fx + dz * fz;
      // Near the car's line (round the bend): not a driver on another road off to the side.
      if (Math.cos(o.heading - c.solid.heading) < -.5 && gap > -5 && gap < ONCOMING && Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading + Math.PI)) < 8
        && (Math.abs(o.speed) > .5 || gap < zone)) return false;
    }
    return true;
  }
  /** True when a stopped queue (a barrier or the cars waiting at it) stands in the car's lane within QUEUE metres ahead. */
  private queued(c: Car): boolean {
    const fx = Math.sin(c.solid.heading), fz = -Math.cos(c.solid.heading);
    for (const o of this.others) {
      if (!o.queue) continue;
      const dx = o.x - c.solid.x, dz = o.z - c.solid.z, gap = dx * fx + dz * fz;
      // The bend offset also rules out one facing across or back: it lands far off the car's lane.
      if (gap > 0 && gap < QUEUE && Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading) - (LANE - c.side)) < CLEAR) return true;
    }
    return false;
  }
  /** True when a spawn at `along` on `path` would come toward a passing car within ONCOMING metres. */
  private facesPass(path: SceneRoad, along: number): boolean {
    const length = path.cumulative[path.cumulative.length - 1];
    for (const p of this.cars) {
      if (!p.active || !p.passing || this.partner.get(p.path) !== path) continue;
      const gap = length - along - p.along;
      if (gap > -5 && gap < ONCOMING) return true;
    }
    return false;
  }
  private ground(x: number, z: number): number | null {
    const y = this.terrain.heightAt(x, z), deck = this.roads.deckHeight(x, z);
    return y === null ? null : Math.max(y, deck ?? y);
  }
  /** Stand a car on the ground, nose up or down with the slope like a parked car. */
  place(c: Car): void {
    const { x, z, heading } = c.solid, fx = Math.sin(heading) * 1.4, fz = -Math.cos(heading) * 1.4;
    const y = this.ground(x, z), nose = this.ground(x + fx, z + fz), tail = this.ground(x - fx, z - fz);
    c.mesh.visible = y !== null;
    if (y === null) return;
    c.y = y; c.placedAt = c.along;
    c.mesh.position.set(x, y + .03, z);
    c.mesh.rotation.set(0, Math.PI / 2 - heading, nose === null || tail === null ? 0 : Math.atan2(nose - tail, 2.8), 'YXZ');
  }
  resolve(body: Parameters<typeof pushOut>[0]): void {
    for (const c of this.cars) if (c.active && c.mesh.visible) pushOut(body, c.solids);
  }
  step(dt: number, player: Vehicle): void {
    if (!this.live) return;
    const still = Math.abs(player.speed ?? 0) < .5;
    const moveX = Number.isFinite(this.lastX) ? (player.x - this.lastX) / dt : 0, moveZ = Number.isFinite(this.lastZ) ? (player.z - this.lastZ) / dt : 0;
    this.lastX = player.x; this.lastZ = player.z;
    for (const c of this.cars) {
      if (!c.active) continue;
      const fx = Math.sin(c.solid.heading), fz = -Math.cos(c.solid.heading);
      let target = CRUISE, side = LANE;
      // The player ahead: measured across the road from the centre line at the player, so a curve neither hides a
      // player in the lane nor brings in one in the other lane.
      const ahead = (player.x - c.solid.x) * fx + (player.z - c.solid.z) * fz;
      // The player's speed along this car's road (a teleport is not a speed), and how fast the car closes on them.
      const away = Math.max(-40, Math.min(40, moveX * fx + moveZ * fz)), closing = c.speed - away, rolling = away > ROLLING;
      if (ahead > -8 && ahead < 32) {
        const p = this.probe; c.path.at(c.along + Math.max(0, ahead), 0, p);
        const across = (player.x - p.x) * Math.cos(p.heading) + (player.z - p.z) * Math.sin(p.heading);   // right of the centre line
        // No pass for a player less than EASE - LANE (0.95 m) right of the centre line.
        const passSide = Math.min(LANE, across - EASE), canPass = passSide >= -LANE, clear = this.oncomingClear(c, ahead + ZONE);
        // Finish the pass only if the car cannot drop back: unable to stop (8 m/s², at the closing speed) 2 m short of the
        // player's tail, clear across or beside, and (unless the player is still) 8 m past within FINISH seconds.
        const unstoppable = ahead < TAIL || closing > .5 && Math.abs(across - c.side) >= APART && ahead - TAIL - 2 < closing * closing / 16;
        const finish = unstoppable && (!rolling || closing > 0 && ahead + 8 < closing * FINISH);
        if (c.passing && !finish && (!canPass || !clear || rolling)) { c.passing = false; c.held = 0; }
        if (c.passing) side = finish ? Math.max(-EDGE, passSide) : passSide;
        // A car that ended a pass beside the player holds its line (never toward them) until it has dropped back.
        else if (ahead < TAIL + 1 && c.side < LANE - .05) side = Math.min(LANE, c.side);
        // In the car's line, or (not passing) in its lane: a car that ended a pass brakes behind the player.
        if (ahead > -4 && (Math.abs(across - c.side) < CLEAR || !c.passing && Math.abs(across - LANE) < CLEAR)) {
          // 3 m/s² to a stop 12 m behind. A car easing out to pass creeps while it is well behind; past the point of no
          // return it creeps on by (stopped there, it would stand in the oncoming lane).
          target = Math.min(target, c.passing && (ahead > 8 || finish) ? CREEP : Math.sqrt(6 * Math.max(0, ahead - 12)));
          if (still && canPass && c.speed < .5 && clear && !this.queued(c)) { if ((c.held += dt) > HOLD) c.passing = true; }
          else if (!c.passing) c.held = 0;
        }
        if (c.passing) target = Math.min(target, PASS_SPEED);
      } else { c.passing = false; c.held = 0; }
      // Keep a gap behind the next car in the same lane.
      for (const o of this.cars) {
        const gap = o.along - c.along;
        if (o !== c && o.active && o.path === c.path && gap > 0 && gap < 32) target = Math.min(target, Math.max(0, (gap - 12) * .5));
      }
      for (const o of this.others) {
        const dx = o.x - c.solid.x, dz = o.z - c.solid.z, gap = dx * fx + dz * fz, along = Math.cos(o.heading - c.solid.heading);
        // Coming the other way is oncomingClear's business: near ±180° the bend offset would wrap either way.
        if (gap <= 0 || gap >= 32 || along < -.5) continue;
        // Within 60° but turning onto the highway from a side road (not yet on the car's bend): the straight test too.
        const across = gap < 20 && Math.abs(dx * Math.cos(c.solid.heading) + dz * Math.sin(c.solid.heading)) < .9 + o.spec.halfLength + .3;
        if (along > .5 ? Math.abs(bendOffset(dx, dz, c.solid.heading, o.heading) - (LANE - c.side)) < CLEAR || along < .95 && across : across)
          target = Math.min(target, Math.max(0, (gap - 12) * .5));
      }
      // Give way while the player waits in a side road's mouth (on that road, off the highway), for at most PATIENCE
      // seconds stopped. A car that cannot stop 10 m short (even braking at 8 m/s²) carries on. Cars never cross lanes.
      let giving: Junction | null = null;
      for (const j of this.junctions.get(c.path) ?? NO_JUNCTIONS) {
        const a = j.along - c.along;
        if (a < 0 || j.along <= c.passAt) continue;
        if (a > 35) break;
        if (a - 10 < c.speed * c.speed / 16 && c.speed > 1 || a < 8) continue;
        const px = player.x - j.x, pz = player.z - j.z, out = px * j.sx + pz * j.sz;
        if (out > 3 && out < 20 && Math.abs(px * j.sz - pz * j.sx) < 5) { target = Math.min(target, Math.sqrt(6 * Math.max(0, a - 10))); giving = j; }   // 3 m/s² to a stop 10 m short
      }
      if (!giving) c.waited = 0;
      else if (c.speed < .5 && (c.waited += dt) > PATIENCE) { c.passAt = giving.along; c.waited = 0; }
      // Stop before the path end. It recycles there once out of the camera.
      target = Math.min(target, Math.max(0, (c.path.cumulative[c.path.cumulative.length - 1] - 15 - c.along) * .5));
      c.speed += Math.max(-8 * dt, Math.min(2 * dt, target - c.speed));
      c.side += Math.max(-SIDE_RATE * dt, Math.min(SIDE_RATE * dt, side - c.side));
      const next = this.next; c.path.at(c.along + c.speed * dt, c.side, next);
      // Near the player, do not drive onto land that has not loaded. Far away, read no ground (no far tile kept).
      if (Math.hypot(next.x - player.x, next.z - player.z) < NEAR && this.ground(next.x, next.z) === null) continue;
      c.along += c.speed * dt; c.solid.x = next.x; c.solid.z = next.z; c.solid.heading = next.heading;
    }
  }
}
