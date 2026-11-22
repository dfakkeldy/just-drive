import * as THREE from 'three';
import type { Roads } from './roads';
import { placeBoxes, type Terrain } from './terrain';
import type { Vehicle } from './vehicle';
import type { Towing } from './towing';
import { TRAILER_SPEC } from './trailer';
import type { Shift } from './shift';
import type { Subject } from './evidence';
import { complaintLine } from './complaints';
import { ANIMAL, ANIMAL_SPECIES, ANIMAL_TEXT, animalRoutes, routePoint, routeOutside, routeApart, routeSafety, moveAnimal, leave, onRoad,
  animalHinting, animalReaction, escapeDirection, farRoute, crossRoute, type AnimalPassage, type AnimalRoute, type AnimalMotion, type AnimalBox, type AnimalSpecies } from './road-animal-rules';
import { ANIMAL_LOOK, roadAnimalMesh } from './road-animal-look';

type Point = { x: number; z: number };
/** The parts of the mail shift the animals use: the day, the complaint list, the photo subjects and the HUD line. */
export type AnimalShift = Pick<Shift, 'career' | 'complaints' | 'elapsed' | 'ended' | 'evidence' | 'roadside' | 'showsHint'>;
type Driver = Pick<Vehicle, 'x' | 'z' | 'heading' | 'speed' | 'vx' | 'vz' | 'spec'>;
interface Resident extends AnimalMotion {
  route: AnimalRoute; visible: boolean; safe: boolean; revision: number;
  /** Seconds the HUD has shown this animal's hint without a break, up to the last step. */
  warned: number; hinting: boolean; distance: number; complained: boolean; subject: Subject;
}
/** Complaint targets: one per daily animal slot, clear of the fish truck (-55) and the painter (-56). */
const TARGET = -60;
const DRAW = 220;
const COUNT: Record<AnimalSpecies, number> = { deer: ANIMAL.perDay, fox: ANIMAL.perDay, moose: 1 };
const LABEL: Record<AnimalSpecies, string> = { deer: 'Deer on the road', fox: 'Fox on the road', moose: 'Moose on the road' };

/**
 * A few wild animals that wander onto the paved and gravel roads each mail day: deer, foxes and now and then a moose.
 * A roadside scene like the fish truck and the painter: it gives the HUD a slow-down hint, and a fast pass after the hint
 * was on screen is a near miss and a complaint from the neighbours. The animal always bolts clear; nobody is hurt.
 * Small fixed population, one instanced draw per species, no fetches, textures or shadow passes, nothing made per step.
 */
export class RoadAnimals {
  readonly group = new THREE.Group();
  readonly residents: Resident[] = [];
  readonly meshes: Record<AnimalSpecies, THREE.InstancedMesh>;
  private day = NaN;
  /** The hitched trailer, a second body the animals keep clear of (reversing, it leads). main.ts sets it with the towing. */
  towed: Pick<Towing, 'attached' | 'x' | 'z'> | null = null;
  private paused = false;
  private live = true;
  private time = 0;
  private misses = 0;
  private afterTime = 0;
  private afterSpecies: AnimalSpecies = 'deer';
  private named: Resident | null = null;
  private readonly subjects: Subject[];
  private readonly slots: Record<AnimalSpecies, number> = { deer: 0, fox: 0, moose: 0 };
  private readonly point = { x: 0, z: 0 };
  private readonly dummy = new THREE.Object3D();
  /** The finest baked land (level 8), where routes can be proved; everywhere when the terrain has no manifest (fixtures). */
  private readonly fine: (x: number, z: number) => boolean;
  /**
   * boxes: hand-built sites and scene corridors no route may cross. apart: points (the fixed animal sites and the roadside
   * scene) no route may come within ANIMAL.keepAway of; main.ts may add to it later, and it is read every frame.
   */
  constructor(private readonly roads: Roads, private readonly terrain: Terrain, private readonly shift: AnimalShift,
    private readonly boxes: readonly AnimalBox[], private readonly apart: readonly Point[] = []) {
    this.group.name = 'Daily road animals';
    this.fine = terrain.manifest && terrain.hasFinest ? (x, z) => terrain.hasFinest(x, z) : () => true;
    this.meshes = { deer: roadAnimalMesh('deer', COUNT.deer), fox: roadAnimalMesh('fox', COUNT.fox), moose: roadAnimalMesh('moose', COUNT.moose) };
    this.group.add(this.meshes.deer, this.meshes.fox, this.meshes.moose);
    this.group.visible = false; this.dummy.rotation.order = 'YXZ';
    this.subjects = Array.from({ length: ANIMAL.perDay }, (_, i) => shift.evidence.register({
      id: `road-animal:${i}`, kind: 'animal', x: 0, z: 0, radius: 1, label: LABEL.deer, active: false, blocking: false }));
    shift.roadside.push(this);
  }
  reset(): void {
    this.day = NaN; this.residents.length = 0; this.misses = 0; this.afterTime = 0; this.named = null;
    this.paused = false; this.time = 0; this.group.visible = false;
    for (const s of this.subjects) s.active = s.blocking = false;
  }
  setPaused(paused: boolean): void { this.paused = paused; }
  /** The nearest animal the player is closing on, or the near-miss line for a few seconds after a complaint. */
  get hint(): string {
    if (this.paused || !this.live) return '';
    if (this.afterTime > 0) return ANIMAL_TEXT[this.afterSpecies].missed;
    return this.named ? ANIMAL_TEXT[this.named.route.species].approach : '';
  }
  reportLine(): string { return this.misses ? `Wildlife: ${this.misses} near ${this.misses === 1 ? 'miss' : 'misses'}. Nobody was hurt.` : ''; }
  /** The horn sends an animal in the lane home at a walk, and keeps one in the field there. */
  honk(player: Driver): void {
    if (this.paused || !this.live || this.shift.ended) return;
    for (let i = 0; i < this.residents.length; i++) {
      const a = this.residents[i], p = routePoint(a.route, a.progress, this.point);
      if (Math.hypot(p.x - player.x, p.z - player.z) >= ANIMAL.horn) continue;
      if (a.state === 'walking' || a.state === 'stopped') leave(a, 'leaving', escapeDirection(a.route, player.x, player.z, p));
      else if (a.state === 'waiting') { a.cooldown = 90; a.timer = 0; }
    }
  }
  /** Height for the safety proof: null while the finest land is still loading, NaN where it never will do (no finest
   *  tile there, or low marsh), so such a route is blocked once instead of re-tested every frame. */
  private ground = (x: number, z: number): number | null => {
    if (!this.fine(x, z)) return NaN;
    const s = this.terrain.surfaceAt(x, z);
    if (!s || s.level < 8) return null;
    return s.ground > this.terrain.seaLevel + .5 ? s.ground : NaN;
  };
  /** Height to draw at: the finest loaded ground, else nothing. */
  private standing(x: number, z: number): number | null {
    const h = this.ground(x, z);
    return h === null || Number.isNaN(h) ? null : h;
  }
  private footing(x: number, z: number, fallback: number): number {
    return this.terrain.meshHeightAt?.(x, z, true) ?? fallback;
  }
  private roadSafe(route: AnimalRoute): boolean {
    const drivable = (r: AnimalRoute['road']) => r.kind >= 1 && r.kind <= 3;
    const home = this.roads.nearest(route.home.x, route.home.z, 20, drivable);
    const stop = this.roads.nearest(route.stop.x, route.stop.z, 20, drivable);
    return (!home || home.dist > home.road.halfWidth + .95) && !!stop && stop.dist + .95 < stop.road.halfWidth;
  }
  private railPassage = (x: number, z: number, radius: number): AnimalPassage => this.roads.guardrails?.animalPassage(x, z, radius) ?? 'clear';
  /**
   * After each 1/120 s player physics step. A fast car closing on an animal in the lane startles it (it bolts away from the
   * car); that is a complaint only when the HUD has shown that animal's hint for the last ANIMAL.read seconds without a
   * break. A slower car sends it off the road at a walk in time. Indexed loops and plain numbers only: nothing is made here.
   */
  step(dt: number, player: Driver, playing: boolean): void {
    if (this.paused || !this.live) return;
    this.afterTime = Math.max(0, this.afterTime - dt);
    // What the HUD shows now is the line from the previous step; only that animal's warning counts.
    const shown = this.afterTime === 0 && this.shift.showsHint(this) ? this.named : null;
    let nearest: Resident | null = null;
    const speed = Math.sqrt(player.vx * player.vx + player.vz * player.vz), towed = this.towed?.attached ? this.towed : null;
    for (let i = 0; i < this.residents.length; i++) {
      const a = this.residents[i];
      a.hinting = false;
      // Only an unbroken warning counts: a damage line or another scene's hint in between starts it again.
      a.warned = a === shown ? a.warned + dt : 0;
      if (!a.visible || !onRoad(a)) continue;
      const p = routePoint(a.route, a.progress, this.point);
      // The nearer of the car and a hitched trailer (only the truck tows, and its reach is within 0.5 m of the trailer's).
      // Math.sqrt, not Math.hypot: hypot makes a heap number per call in V8 (the check counts).
      let bx = player.x, bz = player.z, dx = p.x - bx, dz = p.z - bz, centre = Math.sqrt(dx * dx + dz * dz), distance = centre;
      if (towed) {
        const tx = p.x - towed.x, tz = p.z - towed.z, tc = Math.sqrt(tx * tx + tz * tz);
        if (tc < distance) { bx = towed.x; bz = towed.z; dx = tx; dz = tz; centre = tc; distance = tc; }
      }
      a.distance = distance;
      // From the real velocity, so a sliding or spinning car still reads as closing.
      const closing = centre > 0 ? (player.vx * dx + player.vz * dz) / centre : 0;
      a.hinting = animalHinting(distance, closing, speed);
      const reaction = animalReaction(distance, closing, speed);
      // Away from that body's line from where it is now: it walks off (turning round if it was walking towards that line),
      // or, startled, it runs.
      const dir = reaction === 'none' ? 0 : escapeDirection(a.route, bx, bz, p);
      if (reaction === 'yield' && (a.state !== 'leaving' || dir !== a.dir)) leave(a, 'leaving', dir);
      else if (reaction === 'startle') {
        leave(a, 'bolting', dir); a.hinting = false;
        // A near miss on the asphalt only: one already on the verge or in the ditch was not in the car's way.
        if (playing && !this.shift.ended && !a.complained && a.warned >= ANIMAL.read && a.progress > a.route.onto && a.progress < a.route.off) this.complain(a, i, p);
        continue;
      }
      if (a.hinting && (!nearest || distance < nearest.distance)) nearest = a;
    }
    this.named = nearest;
  }
  private complain(a: Resident, slot: number, p: Point): void {
    a.complained = true; this.misses++; this.afterTime = ANIMAL.after; this.afterSpecies = a.route.species;
    this.shift.complaints.add({ kind: 'sceneAnimal', target: TARGET - slot, at: this.shift.elapsed, x: p.x, z: p.z,
      road: a.route.road.id, customer: `a neighbour on ${a.route.road.name ?? 'the road'}`,
      line: complaintLine('sceneAnimal', this.shift.career.day, TARGET - slot) });
  }
  /** Once a frame: choose the day's routes, move the animals in their fields and draw them. `live` false (a multiplayer
   *  room) clears the roads, as the ambient traffic does. */
  update(dt: number, player: Driver, live = true): void {
    this.live = live;
    if (!live) {
      for (let i = 0; i < this.residents.length; i++) { const a = this.residents[i]; a.state = 'waiting'; a.progress = a.timer = a.warned = 0; a.dir = -1; a.visible = a.hinting = false; }
      for (const s of this.subjects) s.active = s.blocking = false;
      this.named = null; this.group.visible = false; return;
    }
    if (this.paused) return;
    if (this.shift.career.day !== this.day) this.choose(this.shift.career.day);
    this.time += dt;
    for (const species of ANIMAL_SPECIES) this.slots[species] = 0;
    for (let i = 0; i < this.residents.length; i++) {
      const a = this.residents[i], s = this.subjects[i];
      const distance = Math.hypot(a.route.home.x - player.x, a.route.home.z - player.z);
      a.visible = false; s.active = s.blocking = false;
      // The fixed animal sites (read here because they arrive after the first frames) keep their roads to themselves.
      if (distance > DRAW || !routeApart(a.route, this.apart)) continue;
      // Both fields and the whole road between them must be proved, so it can always go away from the car. Proved once per
      // terrain revision; a pending rail plan or missing ground retries next frame, and does not revoke a proved route.
      if (a.revision !== this.terrain.dataRevision) {
        const boxes = placeBoxes(this.terrain.sites), near = this.check(a.route, boxes), far = this.check(farRoute(a.route), boxes);
        const safety = near === 'blocked' || far === 'blocked' ? 'blocked' : near === 'pending' || far === 'pending' ? 'pending' : 'clear';
        if (safety !== 'pending') { a.safe = safety === 'clear'; a.revision = this.terrain.dataRevision; }
      }
      if (!a.safe) continue;
      const before = a.progress, stopDistance = Math.hypot(a.route.stop.x - player.x, a.route.stop.z - player.z);
      if (moveAnimal(a, dt, distance, stopDistance)) crossRoute(a.route);
      const p = routePoint(a.route, a.progress, this.point), ground = this.standing(p.x, p.z);
      if (ground === null) continue;
      // Waiting in its field, it slips out of sight of a car driven right up to it (never on the road or the verge).
      if (a.state === 'waiting' && this.gap(p, player) < ANIMAL.shy) continue;
      a.visible = true;
      const species = a.route.species, look = ANIMAL_LOOK[species], mesh = this.meshes[species], slot = this.slots[species]++;
      const off = a.state === 'leaving' || a.state === 'bolting', heading = a.route.heading + (off && a.dir < 0 ? Math.PI : 0);
      const fx = Math.sin(heading), fz = -Math.cos(heading), reach = look.legZ * 1.5, wide = look.legX * 1.3;
      const front = this.footing(p.x + fx * reach, p.z + fz * reach, ground), back = this.footing(p.x - fx * reach, p.z - fz * reach, ground);
      const right = this.footing(p.x - fz * wide, p.z + fx * wide, ground), left = this.footing(p.x + fz * wide, p.z - fx * wide, ground);
      // A startled deer bounds; foxes and moose run flat.
      const bound = a.state === 'bolting' && species === 'deer' ? Math.abs(Math.sin(this.time * 7)) * .45 : 0;
      this.dummy.position.set(p.x, (front + back + right + left) / 4 + .03 + bound, p.z);
      this.dummy.rotation.set(Math.atan2(front - back, 2 * reach), -heading, Math.atan2(right - left, 2 * wide));
      this.dummy.updateMatrix(); mesh.setMatrixAt(slot, this.dummy.matrix);
      const stride = mesh.geometry.getAttribute('stride');
      stride.setXY(slot, this.time * (a.state === 'bolting' ? 16 : 9) + slot * 2, before !== a.progress ? look.hip * .19 : 0); stride.needsUpdate = true;
      // Blocking the road in a photograph only while it is on the asphalt, as for a near miss.
      s.x = p.x; s.z = p.z; s.y = ground + look.hip; s.active = true; s.blocking = onRoad(a) && a.progress > a.route.onto && a.progress < a.route.off;
    }
    let drawn = 0;
    for (const species of ANIMAL_SPECIES) {
      const mesh = this.meshes[species]; mesh.count = this.slots[species]; mesh.visible = mesh.count > 0; drawn += mesh.count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.group.visible = drawn > 0;
  }
  /** Metres between the animal's body and the nearer of the car's and the trailer's (each a disc of its reach). */
  private gap(p: Point, player: Driver): number {
    let gap = Math.hypot(p.x - player.x, p.z - player.z) - player.spec.envelope.reach;
    const towed = this.towed?.attached ? this.towed : null;
    if (towed) gap = Math.min(gap, Math.hypot(p.x - towed.x, p.z - towed.z) - TRAILER_SPEC.envelope.reach);
    return gap - ANIMAL.radius;
  }
  /** One half of a crossing: off the road at its field end, on the road at its lane stop, clear of sites, rails and steps. */
  private check(route: AnimalRoute, sites: readonly AnimalBox[]): AnimalPassage {
    const outside = this.roadSafe(route) && routeOutside(route, this.boxes) && routeOutside(route, this.terrain.clear) && routeOutside(route, sites);
    return outside ? routeSafety(route, this.ground, this.railPassage) : 'blocked';
  }
  private choose(day: number): void {
    this.day = day; this.residents.length = 0; this.named = null;
    if (this.terrain.cartRoads) return;
    const boxes = [...this.boxes, ...placeBoxes(this.terrain.sites), ...this.terrain.clear];
    for (const route of animalRoutes(this.roads.roads, day, boxes, this.apart, this.fine)) {
      const subject = this.subjects[this.residents.length];
      subject.label = LABEL[route.species]; subject.road = route.road.id; subject.radius = route.species === 'moose' ? 1.5 : 1;
      this.residents.push({ route, state: 'waiting', progress: 0, timer: 0, cooldown: 0, dir: -1, visible: false, safe: false, revision: -1,
        warned: 0, hinting: false, distance: Infinity, complained: false, subject });
    }
  }
}
