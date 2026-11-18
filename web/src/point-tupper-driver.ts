import * as THREE from 'three';
import { isTestVisit } from './visit';
import { GARAGE } from './garage';
import { Vehicle, autopilot } from './vehicle';
import { legacyVehicle } from './ride';
import { drivableDisplay, isDisplayKind, type DisplayKind } from './fleet-models';
import { SceneRoad } from './road-scene-rules';
import { bendOffset } from './ambient-traffic';
import { bodyGap, pushOutBodies, type ContactBody } from './parked';
import { deckCounts } from './bridge-contact';
import type { Roads } from './roads';
import type { Terrain } from './terrain';
import type { AreaContacts } from './world-contacts';

/** Whether the page builds the AI at all: Point Tupper today, a player visit (or `aiDriverCheck=1`), not `aiDriver=0`.
 * LOW (phones) builds it from the parked display models (see PointTupperDriver.low). */
export function driverEnabled(area: string, modern: boolean, params: URLSearchParams, development: boolean): boolean {
  const check = params.get('aiDriverCheck') === '1';
  return area === 'pointtupper' && modern && params.get('aiDriver') !== '0' && (check || (!development && !isTestVisit(params)));
}
/** The live rule, read every frame. main.ts calls it with the live era, so a runtime swap to 1884 hides the AI at once. */
export function driverLive(modern: boolean, multiplayer: boolean): boolean { return modern && !multiplayer; }
/** A kind the player is not driving. LOW picks only the kinds with a display model (DISPLAY_KINDS; the car has none). */
export function chooseDriver(playerId: string, random = Math.random, low = false) {
  const choices = GARAGE.filter(e => e.id !== 'horse' && e.id !== playerId && (!low || isDisplayKind(e.id)));
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
}
type Entry = (typeof GARAGE)[number];
type TrafficCar = { readonly active: boolean; readonly side: number;
  readonly solid: { readonly x: number; readonly z: number; readonly heading: number } };
type SignalHook = { stopDistance(x: number, z: number, forwardX: number, forwardZ: number): number };
/** Metres to the nearest traffic car ahead in the AI's way, bumper to bumper (a traffic car is 4.5 m by 1.8 m), within
 * 40 m. Going the same way (within 60°): in the AI's line, measured round the bend. Coming the other way: only one that
 * has pulled out to pass (its line less than 0.85 m right of the centre line) and stands in the AI's line. Crossing
 * (a junction): within 20 m and across the AI's straight path, its length lying across. */
export function trafficGap(x: number, z: number, heading: number, halfWidth: number, halfLength: number, cars: readonly TrafficCar[]): number {
  const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
  let gap = Infinity;
  for (const c of cars) {
    if (!c.active) continue;
    const dx = c.solid.x - x, dz = c.solid.z - z, ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead >= 40) continue;
    const along = Math.cos(c.solid.heading - heading);
    // 0.6 m beyond touching keeps a car on the lane line in the way.
    if (along > .5 ? Math.abs(bendOffset(dx, dz, heading, c.solid.heading)) < halfWidth + 1.5
      : along < -.5 ? c.side < .85 && Math.abs(bendOffset(dx, dz, heading, c.solid.heading + Math.PI)) < halfWidth + 1.5
      : ahead < 20 && Math.abs(dx * rx + dz * rz) < halfWidth + 2.85)
      gap = Math.min(gap, ahead - halfLength - (Math.abs(along) > .5 ? 2.25 : .9));
  }
  return gap;
}
/** The gap to a body (the player, a trailer, a parked fleet rig) when it is in the AI's way, else Infinity: ahead
 * within 40 m and in its line (round the bend; coming the other way, in its line too), or crossing within 20 m. A body
 * behind, beside or in the other lane does not stop the AI; one it is about to touch (under 1 m) always does. */
export function bodyInWay(v: ContactBody, b: ContactBody): number {
  const gap = bodyGap(v, b);
  if (gap < 1) return gap;
  const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), dx = b.x - v.x, dz = b.z - v.z, ahead = dx * fx + dz * fz;
  if (ahead <= 0 || ahead >= 40) return Infinity;
  const along = Math.cos(b.heading - v.heading);
  const inLine = Math.abs(along) > .5
    ? Math.abs(bendOffset(dx, dz, v.heading, b.heading + (along < 0 ? Math.PI : 0))) < v.spec.halfWidth + b.spec.halfWidth + .6
    : ahead < 20 && Math.abs(dx * Math.cos(v.heading) + dz * Math.sin(v.heading)) < v.spec.halfWidth + b.spec.halfLength + .6;
  return inLine ? gap : Infinity;
}
/** Metres to a red or amber stop line ahead, or Infinity when it is green, too far, or too close to stop for at 8 m/s². */
export function signalGap(signals: SignalHook | null, x: number, z: number, heading: number, speed: number): number {
  const stop = signals ? signals.stopDistance(x, z, Math.sin(heading), -Math.cos(heading)) : Infinity;
  return stop >= speed * speed / 16 ? stop : Infinity;
}
export type DriverRig = { rig: { root: THREE.Object3D }, vehicle: Vehicle };
/** Free one AI rig's GPU buffers: geometry, instance buffers, skeletons and materials. Textures stay, because some are
 * shared between rigs (the pickup's reflection map). The game swaps only fleet kinds (pickup, side by side, dirt bike),
 * whose builders make fresh geometry; a Blender car clone shares geometry, which three.js would simply upload again. */
function disposeRig(root: THREE.Object3D): void {
  root.traverse(n => {
    const mesh = n as THREE.Mesh; if (!mesh.isMesh) return;
    mesh.geometry.dispose(); for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    (n as THREE.InstancedMesh).isInstancedMesh && (n as THREE.InstancedMesh).dispose();
    (n as THREE.SkinnedMesh).isSkinnedMesh && (n as THREE.SkinnedMesh).skeleton.dispose();
  });
}
/** One real fleet rig. Steering and physics are the demo's; paths only sample hidden starts. */
export class PointTupperDriver {
  readonly group = new THREE.Group();
  entry!: Entry;
  vehicle!: Vehicle;
  /** Rigs built so far: one at boot, then one per kind swap. */
  builds = 0;
  active = false;
  /** The AI's vehicle while it is on the road, else empty: the same array always, for the traffic to read. */
  readonly onRoad: Vehicle[] = [];
  private cursor = 0;
  private parked = 0;
  private readonly eligible = (r: Roads['roads'][number]) => r.kind <= 3 && r.halfWidth >= this.vehicle.spec.halfWidth + 1.8;
  obstacles: () => readonly ContactBody[] = () => [];
  /** Ambient traffic cars: main.ts passes the pool itself, so reading it adds no allocation. The AI keeps its
   * distance behind one in its lane; one in the other lane is not in the way. */
  traffic: readonly TrafficCar[] = [];
  /** The junction signals; the AI stops at a red or amber it can still stop for (8 m/s²). */
  signals: SignalHook | null = null;
  private readonly contact: { readonly y: number };
  private paths: SceneRoad[] = [];
  private rig!: { root: THREE.Object3D };
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 12);
  private readonly make: (entry: Entry) => DriverRig;
  /** `low`: LOW quality builds the parked display models (drivableDisplay) and leaves the car out. */
  constructor(private readonly roads: Roads, private readonly terrain: Terrain,
    private readonly contacts: AreaContacts, playerId: string, private readonly sea: number, private readonly random = Math.random,
    make?: (entry: Entry) => DriverRig, readonly low = false) {
    this.make = make ?? (entry => {
      if (low && !isDisplayKind(entry.id)) throw new Error(`No LOW display model for ${entry.id}`);
      const rig = low ? drivableDisplay(entry.id as DisplayKind) : entry.build(false, true);
      return { rig, vehicle: entry.ride ? legacyVehicle(entry.ride(rig, this.terrain, this.roads, this.sea, entry.spec))
        : new Vehicle(rig, this.terrain, this.roads, this.sea, entry.spec) };
    });
    const self = this; this.contact = { get y() { return self.vehicle.y; } };
    this.group.visible = false;
    this.mount(chooseDriver(playerId, random, low));
  }
  /** Build a kind. Only called at boot and on a hidden swap, never while the rig can be seen. */
  private mount(entry: Entry): void {
    if (this.rig) { this.group.remove(this.rig.root); disposeRig(this.rig.root); }
    const { rig, vehicle } = this.make(entry);
    this.entry = entry; this.rig = rig; this.vehicle = vehicle; this.builds++;
    this.group.add(rig.root);
    this.paths = this.roads.roads.filter(r => !r.bridge && r.kind <= 3 && r.halfWidth >= entry.spec.halfWidth + 1.8)
      .flatMap(r => [new SceneRoad(r.pts, 0, 1), new SceneRoad([...r.pts].reverse(), 0, 1)])
      .filter(p => p.cumulative.at(-1)! > 120);
  }
  hide(): void { this.active = this.group.visible = false; this.onRoad.length = 0; }
  /** `playerKind` is the kind the player drives now (the fleet member after a switch), not the boot vehicle. */
  update(camera: THREE.Camera, player: Vehicle, enabled: boolean, playerKind: string): void {
    if (!enabled) { this.hide(); return; }
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    if (this.active) {
      this.sphere.center.set(this.vehicle.x, this.vehicle.y + 2, this.vehicle.z);
      // The same kind as the player stays while seen, then leaves; it never vanishes in view.
      if ((playerKind === this.entry.id || Math.hypot(this.vehicle.x - player.x, this.vehicle.z - player.z) > 650 || this.parked > 3) && !this.frustum.intersectsSphere(this.sphere)) this.hide();
      return;
    }
    if (playerKind === this.entry.id) this.mount(chooseDriver(playerKind, this.random, this.low));
    if (!this.paths.length) return;
    const n = this.cursor++, path = this.paths[n % this.paths.length];
    const pose = { x: 0, z: 0, heading: 0 };
    path.at(30 + n * 97 % Math.max(1, path.cumulative.at(-1)! - 80), 1.6, pose);
    const y = this.terrain.heightAt(pose.x, pose.z), distance = Math.hypot(pose.x - player.x, pose.z - player.z);
    // Never at a deck or under one: a place with no reference stands on land, which would drop a spawn on a span into
    // the channel. The cursor moves on, so the next try is elsewhere on the path.
    if (y === null || distance < 120 || distance > 550 || this.roads.deckHeight(pose.x, pose.z) !== null) return;
    this.sphere.center.set(pose.x, y + 2, pose.z);
    if (this.frustum.intersectsSphere(this.sphere)) return;
    const v = this.vehicle;
    if (!this.contacts.allows({ ...pose, y, spec: v.spec }) || !v.place(pose.x, pose.z, pose.heading)) return;
    this.sphere.center.set(v.x,v.y+2,v.z);
    if (this.frustum.intersectsSphere(this.sphere)) return;
    if ([player, ...this.obstacles()].some(b => bodyGap(v,b)<30)) return;
    // Nor right in front of (or behind) a traffic car doing 12 m/s.
    for (const c of this.traffic) if (c.active && Math.hypot(c.solid.x - v.x, c.solid.z - v.z) < 35) return;
    this.parked = 0; this.active = this.group.visible = true; this.onRoad[0] = v;
  }
  step(dt: number, player: Vehicle): void {
    if (!this.active) return;
    const v = this.vehicle, old = { x: v.x, z: v.z, heading: v.heading, y: v.y };
    const hit = this.roads.nearest(v.x, v.z, 12, this.eligible);
    // Only a genuine dead end ahead needs a stop. Connected pieces use demo steering.
    const end = !hit || [hit.road.pts[0], hit.road.pts.at(-1)!].some(([x,z]) => {
      const ahead = (x-v.x)*Math.sin(v.heading)-(z-v.z)*Math.cos(v.heading);
      return ahead > 0 && Math.hypot(x-v.x,z-v.z) < 25 && !this.roads.nearest(x, z, 8, r => r !== hit.road && this.eligible(r));
    });
    const bodies = [player, ...this.obstacles()];
    // The gap to a traffic car ahead is bumper to bumper, like bodyGap. A stop line counts as a body 13 m past it less
    // the AI's half length, so its nose rolls to a stop 1 m short of the line and it brakes hard inside 3 m.
    const queue = Math.min(trafficGap(v.x, v.z, v.heading, v.spec.halfWidth, v.spec.halfLength, this.traffic), signalGap(this.signals, v.x, v.z, v.heading, v.speed) + 13 - v.spec.halfLength);
    let gap = queue;
    for (const b of bodies) gap = Math.min(gap, bodyInWay(v, b));
    const input = autopilot(v, this.roads, end ? 0 : Math.min(8, Math.max(0, (gap - 14) * .4)), this.eligible);
    if (gap < 16 || end) { input.throttle = v.speed > .1 ? -1 : 0; input.handbrake = true; }
    this.terrain.withGroundContact(this.contact, () => v.update(Math.min(dt, .05), input, () => {
      this.contacts.resolve(v); pushOutBodies(v, bodies);
    }));
    this.parked = Math.abs(v.speed) < .2 ? this.parked + dt : 0;
    const next = this.roads.nearest(v.x, v.z, 12, this.eligible);
    const aligned = next && Math.abs(Math.cos(next.heading-v.heading)) > Math.SQRT1_2;
    const heading = next ? next.heading + (Math.cos(next.heading-v.heading)<0 ? Math.PI : 0) : 0;
    const side = next ? (v.x-next.x)*Math.cos(heading)+(v.z-next.z)*Math.sin(heading) : 0;
    if (next && aligned && (side < v.spec.halfWidth || next.dist + v.spec.halfWidth > next.road.halfWidth)) {
      // Keep demo steering's small lateral errors inside the lane without restarting its acceleration.
      const lane = Math.max(v.spec.halfWidth + .05, Math.min(next.road.halfWidth-v.spec.halfWidth-.05, side));
      const pose = { x: next.x+Math.cos(heading)*lane, z: next.z+Math.sin(heading)*lane, heading:v.heading };
      if (this.contacts.allows({...pose,y:v.y,spec:v.spec}) && !bodies.some(b=>bodyGap({...pose,y:v.y,spec:v.spec},b)<.1)) {
        const speed = Math.max(0,v.speed);
        // Re-place at the body's own height: a deck it drives on still counts, one overhead does not.
        v.place(pose.x,pose.z,pose.heading,v.y);v.speed=speed;v.vx=Math.sin(v.heading)*speed;v.vz=-Math.cos(v.heading)*speed;
      } else { v.place(old.x,old.z,old.heading,old.y);v.vx=v.vz=v.speed=0; }
    } else if (!next || next.dist + v.spec.halfWidth > next.road.halfWidth || bodyGap(v, player) < .1) {
      v.place(old.x, old.z, old.heading, old.y); v.vx = v.vz = v.speed = 0;
    }
  }
  resolve(body: Vehicle): void {
    if (!this.active || body === this.vehicle) return;
    const x = body.x, z = body.z;
    pushOutBodies(body, [this.vehicle]);
    if (body.x === x && body.z === z) return;
    // The existing resolver moves horizontally. Recheck the new ground before the rig draws.
    // Only a deck within the body's reach lifts it, so a push under an overpass never puts the player on top of it.
    const ground = this.terrain.heightAt(body.x, body.z, body.y), deck = this.roads.deckHeight(body.x, body.z);
    if (ground === null) { body.x = x; body.z = z; }
    else body.y = Math.max(body.y, ground, deckCounts(deck, body.y, this.terrain.cartRoads) ? deck : ground);
  }
}
