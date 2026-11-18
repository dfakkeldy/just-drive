import { Drift, type DriftFacts } from './drift-rules';
import { safePlacement } from './placement-pose';
import * as THREE from 'three';
import { BIKE_SPEC, type Bike } from './bike';
import type { VehicleSpec } from './vehicle-spec';
import type { Ride, RideInput, JumpRecord } from './ride';
import type { VehiclePlacement } from './vehicle';
import type { Terrain, Surface } from './terrain';
import type { Roads } from './roads';
import type { Damage } from './damage-rules';
import { washboard, potholeDepth, potholeDensity } from './defects';

export const BIKE_STEP = 1 / 120, BIKE_WHEELBASE = BIKE_SPEC.wheelbase, BIKE_RADIUS = BIKE_SPEC.wheelRadius;
const G = 9.81, TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
const SURFACES = {
  concrete: { top: 115 / 3.6, accel: 6.4, grip: 1.35, rough: 0, name: 'concrete' },
  paved: { top: 115 / 3.6, accel: 6.4, grip: 1.35, rough: 0, name: 'pavement' },
  gravel: { top: 104 / 3.6, accel: 5.9, grip: 1.05, rough: .015, name: 'gravel' },
  trail: { top: 100 / 3.6, accel: 5.8, grip: 1.1, rough: .009, name: 'rail trail' },
  track: { top: 92 / 3.6, accel: 5.4, grip: .9, rough: .035, name: 'dirt track' },
  grass: { top: 88 / 3.6, accel: 5.2, grip: .85, rough: .045, name: 'grass' },
  brush: { top: 38 / 3.6, accel: 3, grip: .7, rough: .07, name: 'brush' },
  washboard: { top: 78 / 3.6, accel: 4.9, grip: .7, rough: .095, name: 'washboard' },
};
/** Two wheel samples, fixed-step dynamics and independent air attitude. The car class is untouched. */
export class BikeRide implements Ride {
  x = 0; z = 0; y = 0; heading = 0;
  vx = 0; vz = 0; vy = 0; pitch = 0; roll = 0; steerAngle = 0; speed = 0;
  airborne = false; sunk = 0; atEdge = false;
  damage: Damage | null = null; damageActive = false; desktopPull = false;
  get activeTouchSpeedLimit(): number { return 0; }
  /** The dirt bike has its own rear-brake slide below; it never enters the cars' drift (drift-rules.ts). */
  readonly drift = new Drift(); canDrift = false;
  takeDrift(): DriftFacts | null { return null; }
  assist = 0; strongHelp = false; touchSpeedLimit = false; helpYaw = 0; lightHelpYaw = 0;
  bounds: [number, number, number, number] | null = null;
  placementGuard: ((pose: VehiclePlacement) => boolean) | null = null;
  surfaceName = ''; roadName: string | null = null;
  wheelie = 0; wheelieRate = 0; pitchRate = 0; whip = 0;
  frontTravel = 0; rearTravel = 0; compression = 0;
  crashTime = 0; crashes = 0;
  /** Current flight, then the last completed flight. Values use seconds, metres, whole turns. */
  jump: JumpRecord = { airTime: 0, peakHeight: 0, distance: 0, pitchRotations: 0, clean: false };
  lastJump: JumpRecord | null = null;
  private acc = 0; private stepping = false; private elapsed = 0; private spin = 0;
  private prevGround = 0;
  private ready = false;
  private frontHeight = 0; private rearHeight = 0; private sampledY = 0;
  private contacts = [{ x: 0, z: 0, y: 0, h: null as number | null }, { x: 0, z: 0, y: 0, h: null as number | null }];
  private lastSafe: VehiclePlacement | null = null;
  private roadTrail: VehiclePlacement[] = [];
  private launchX = 0; private launchZ = 0; private airPitch = 0;
  private crashHeading = 0; private stand = 0;

  constructor(readonly car: Bike, private terrain: Pick<Terrain, 'heightAt' | 'surfaceAt' | 'withContactHeight'> & {readonly cartRoads?:boolean}, readonly roads: Pick<Roads, 'nearest' | 'deckHeight'> & Partial<Pick<Roads, 'guardrails'>>, private seaLevel: number, readonly spec: VehicleSpec = BIKE_SPEC) {}

  private groundAt(x: number, z: number): number | null {
    const g = this.terrain.heightAt(x, z), deck = this.roads.deckHeight(x, z);
    return g === null ? null : deck === null ? g : Math.max(g, deck);
  }
  place(x: number, z: number, heading: number): boolean {
    if (!safePlacement(x, z, heading, this.bounds)) return false;
    const pose = { x, z, heading };
    if (this.placementGuard && !this.placementGuard(pose)) return false;
    if (!safePlacement(pose.x, pose.z, pose.heading, this.bounds)) return false;
    this.x = pose.x; this.z = pose.z; this.heading = pose.heading;
    this.vx = this.vz = this.vy = this.speed = this.pitchRate = this.wheelie = this.wheelieRate = this.whip = 0;
    this.pitch = this.roll = this.steerAngle = this.compression = this.crashTime = this.sunk = 0;
    if (!this.stepping) this.acc = 0;
    this.airborne = false;
    this.y = this.groundAt(this.x, this.z) ?? this.y;
    this.ready = this.capture();
    if (this.ready) {
      this.y = this.prevGround = Math.max((this.frontHeight + this.rearHeight) / 2, this.groundAt(this.x, this.z) ?? -Infinity);
      this.pitch = Math.atan2(this.frontHeight - this.rearHeight, this.spec.wheelbase);
      this.sampledY = this.y;
      if (this.y > this.seaLevel + .05) this.lastSafe = { ...pose };
    }
    this.sync(0);
    return true;
  }
  /** Restore support history only; selection never searches for or installs a new pose. */
  resumeAfterParking(travel?: readonly number[], spin?: number): boolean {
    this.ready = this.capture(); if (!this.ready) return false;
    this.prevGround = (this.frontHeight + this.rearHeight) / 2; this.acc = 0; if (spin !== undefined) this.spin = spin;
    if (travel) { this.frontTravel = travel[0] ?? 0; this.rearTravel = travel[2] ?? 0; }
    return true;
  }
  resetControlHistory(): void { this.helpYaw = this.lightHelpYaw = 0; this.lastJump = null; }
  resetVisit(): void { this.lastSafe = null; this.roadTrail.length = 0; this.lastJump = null; this.jump = { airTime: 0, peakHeight: 0, distance: 0, pitchRotations: 0, clean: false }; this.crashTime = this.sunk = 0; }
  restart(x: number, z: number, heading: number): void { this.lastSafe = null; this.roadTrail.length = 0; this.lastJump = null; this.place(x, z, heading); }
  respawn(): void {
    let distance = 0;
    while (this.roadTrail.length > 1 && distance < 35) { const a = this.roadTrail.pop()!, b = this.roadTrail[this.roadTrail.length - 1]; distance += Math.hypot(a.x - b.x, a.z - b.z); }
    const crumb = this.roadTrail[this.roadTrail.length - 1];
    const near = this.roads.nearest(this.x, this.z, 1600, r => r.kind <= 5 && !r.bridge);
    const b = this.bounds;
    const usable = (p: VehiclePlacement | null | undefined) => p && (!b || p.x > b[0] + 2 && p.x < b[2] - 2 && p.z > b[1] + 2 && p.z < b[3] - 2)
      && (this.groundAt(p.x, p.z) ?? -Infinity) > this.seaLevel - .1;
    let safe = [crumb, near, this.lastSafe].find(usable);
    if (!safe && b) {
      const point = this.roads.nearest(clamp(this.x, b[0] + 60, b[2] - 60), clamp(this.z, b[1] + 60, b[3] - 60), 2000, r => r.kind <= 3 && !r.bridge);
      if (usable(point)) safe = point!;
    }
    if (safe) this.place(safe.x, safe.z, safe.heading);
  }
  onSolidImpact(speed: number): void { if (this.damageActive) this.damage?.hit('impact', speed); if (speed > 7 && !this.crashTime) this.crash(); }
  private crash(): void {
    if (this.crashTime) return;
    this.crashes++; this.crashTime = BIKE_STEP; this.crashHeading = this.heading;
    if (this.airborne) this.finishJump(false);
    this.airborne = false; this.wheelie = this.wheelieRate = this.pitchRate = 0;
  }
  private capture(): boolean {
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    for (let i = 0; i < 2; i++) {
      const p = this.contacts[i], along = (i ? -1 : 1) * this.spec.wheelbase / 2;
      p.x = this.x + fx * along; p.z = this.z + fz * along;
      p.y = this.y + this.spec.contactPlane * Math.sin(this.pitch - this.wheelie) * along;
      p.h = this.terrain.withContactHeight(p, () => this.groundAt(p.x, p.z));
    }
    this.sampledY = this.y;
    if (this.contacts.some(p => p.h === null)) return false;
    this.frontHeight = this.contacts[0].h!; this.rearHeight = this.contacts[1].h!;
    return true;
  }
  private correctGround(): void {
    // Re-sample the SAME old positions at the old body height. A finer tile is not a take-off impulse.
    let correction = 0, known = true;
    this.terrain.withContactHeight({ y: this.sampledY }, () => {
      for (const p of this.contacts) { const now = this.terrain.withContactHeight(p, () => this.groundAt(p.x, p.z)); if (now === null || p.h === null) known = false; else correction += (now - p.h) / 2; }
    });
    if (known && Math.abs(correction) > 1e-6) { this.y += correction; this.prevGround += correction; }
  }
  update(dt: number, input: RideInput, afterStep?: () => void): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    const safeInput = { throttle: Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : 0, steer: Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0, handbrake: !!input.handbrake, pull: !!input.pull };
    if (!this.ready) { this.place(this.x, this.z, this.heading); return; }
    this.acc = Math.min(.1, this.acc + dt);
    while (this.acc + 1e-10 >= BIKE_STEP) {
      const safeBefore = this.lastSafe;
      this.stepping = true;
      try { this.step(BIKE_STEP, safeInput); afterStep?.(); } finally { this.stepping = false; }
      if (this.crashTime && safeBefore) this.lastSafe = safeBefore;
      this.acc -= BIKE_STEP;
    }
    this.sync(dt);
  }
  private surface(s: Surface): typeof SURFACES[keyof typeof SURFACES] {
    if (this.terrain.cartRoads && this.roads.deckHeight(this.x,this.z)!==null) return s.kind===4?SURFACES.track:s.washboard?SURFACES.washboard:SURFACES.gravel;
    if (s.deck) return SURFACES.concrete;
    if (this.roads.deckHeight(this.x, this.z) !== null) return SURFACES.paved;
    if (s.kind === 0 || s.roadDist > s.halfWidth + .4) return s.canopy > 1.6 ? SURFACES.brush : SURFACES.grass;
    return s.kind === 9 ? SURFACES.concrete : s.kind <= 2 || s.kind === 13 ? SURFACES.paved : s.washboard ? SURFACES.washboard : s.kind === 5 ? SURFACES.trail : s.kind === 4 ? SURFACES.track : SURFACES.gravel;
  }
  private beginJump(): void {
    this.airborne = true; this.launchX = this.x; this.launchZ = this.z; this.airPitch = 0;
    this.pitchRate = this.wheelieRate; this.wheelie = this.wheelieRate = 0;
    this.jump = { airTime: 0, peakHeight: 0, distance: 0, pitchRotations: 0, clean: false };
  }
  private finishJump(clean: boolean): void {
    this.jump.clean = clean;
    this.jump.pitchRotations = Math.sign(this.airPitch) * Math.floor((Math.abs(this.airPitch) + 1e-6) / TAU);
    this.lastJump = { ...this.jump };
  }
  private step(dt: number, input: RideInput): void {
    const s = this.terrain.surfaceAt(this.x, this.z);
    if (!s) { this.vx = this.vz = this.speed = 0; return; }
    this.correctGround();
    if (!this.capture()) { this.vx = this.vz = this.speed = 0; return; }
    const surf = this.surface(s); this.surfaceName = surf.name;
    this.elapsed += dt;
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = Math.sin(this.heading);
    let forward = this.vx * fx + this.vz * fz, sideways = this.vx * rx + this.vz * rz;
    const centre = this.groundAt(this.x, this.z) ?? (this.frontHeight + this.rearHeight) / 2;
    const ground = Math.max((this.frontHeight + this.rearHeight) / 2, centre);
    const slope = this.frontHeight < centre - .25 && this.rearHeight >= centre - .25
      ? Math.atan2((centre - this.rearHeight) * 2, this.spec.wheelbase)
      : Math.atan2(this.frontHeight - this.rearHeight, this.spec.wheelbase);
    const gvel = clamp((ground - this.prevGround) / dt, -30, 30); this.prevGround = ground;
    if (this.crashTime > 0) {
      this.crashTime += dt; this.vx *= .97; this.vz *= .97;
      if (this.damageActive) this.damage?.drive(dt, 0, surf.name, 0, false);   // repair cooldowns run on through a tumble
      this.x += this.vx * dt; this.z += this.vz * dt; this.y = Math.max(ground, centre, this.groundAt(this.x, this.z) ?? -Infinity); this.pitch = this.roll = 0;
      this.roads.guardrails?.block(this, dt);
      this.wall(); this.speed = Math.hypot(this.vx, this.vz);
      if (this.crashTime >= 1.6) { const safe = this.lastSafe ?? { x: this.x, z: this.z, heading: this.crashHeading }; this.place(safe.x, safe.z, safe.heading); }
      return;
    }
    // On a convex crest the contact plane drops out from under the free ballistic path.
    // A slow walk off an edge follows the ground; a moving bike retains its last real slope velocity.
    if (!this.airborne && Math.abs(forward) > 3 && this.y + this.vy * dt - .5 * G * dt * dt > ground + Math.max(0, gvel) * dt + .035) this.beginJump();
    if (this.airborne) {
      this.y += this.vy * dt - .5 * G * dt * dt; this.vy -= G * dt;
      // GO/W noses forward; BRAKE/S pulls back. Release to retain a controlled angular speed briefly.
      this.pitchRate += (-input.throttle * 7.2 - this.pitchRate * (input.throttle ? .65 : 2.8)) * dt;
      this.pitchRate = clamp(this.pitchRate, -6, 6);
      const change = this.pitchRate * dt; this.pitch += change; this.airPitch += change;
      this.roll += (-input.steer * .85 - this.roll) * Math.min(1, dt * 5);
      this.whip += (-input.steer * .5 - this.whip) * Math.min(1, dt * 5);
      this.jump.airTime += dt;
      this.jump.peakHeight = Math.max(this.jump.peakHeight, this.y - centre);
      this.jump.distance = Math.hypot(this.x - this.launchX, this.z - this.launchZ);
      this.jump.pitchRotations = Math.sign(this.airPitch) * Math.floor((Math.abs(this.airPitch) + 1e-6) / TAU);
      // First wheel contact, measured using the rotated axle line, rather than waiting for the torso to hit.
      const normalY = Math.sin(this.roll) * Math.cos(this.pitch);
      const tyreHeight = this.spec.wheelRadius * Math.sqrt(Math.max(0, 1 - normalY * normalY)) + .07 * Math.abs(normalY);
      const clearance = Math.abs(Math.sin(this.pitch)) * this.spec.wheelbase / 2 + tyreHeight - this.spec.wheelRadius;
      if (this.y <= centre + Math.max(0, clearance) && this.vy < 0) {
        const clean = Math.abs(angle(this.pitch - slope)) < .62 && Math.abs(this.roll) < .72 && Math.abs(this.pitchRate) < 5.8;
        this.finishJump(clean); this.airborne = false;
        if (this.damageActive) this.damage?.hit('landing', -this.vy);   // a bad landing costs as much as a good one
        if (!clean) { this.crash(); return; }
        this.compression = clamp(-this.vy * .024, .04, .24);
        this.y = ground; this.vy = gvel; this.pitch = slope; this.pitchRate = 0; this.whip = 0;
        forward *= .96; sideways *= .6;
      }
    } else {
      const t = input.throttle, speed = Math.abs(forward);
      let acceleration = t >= 0 ? t * surf.accel * Math.max(0, 1 - (speed / surf.top) ** 2) : forward > .1 ? t * 10 : forward > -5 ? t * 3 : 0;
      if (input.handbrake) { acceleration -= Math.sign(forward) * Math.min(5, speed / dt); sideways += input.steer * speed * dt * 1.4; }
      acceleration -= G * Math.sin(slope);
      if (t === 0 && speed < .08 && Math.abs(slope) < .1) forward = 0;
      else { acceleration -= Math.sign(forward) * .18; forward += acceleration * dt; }
      forward = clamp(forward, -5, 34);
      const maxYaw = Math.min(1.8, surf.grip * G / Math.max(speed, 2));
      const targetRoll = speed > 2 ? -Math.atan(speed * input.steer * maxYaw / G) : 0;
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * (speed > 8 ? 3 : 6));
      const yaw = speed > 5 ? -Math.tan(this.roll) * G / Math.max(speed, 2) * Math.sign(forward) : forward * Math.tan(input.steer * .65) / this.spec.wheelbase;
      this.steerAngle += (input.steer * Math.min(.65, Math.atan(this.spec.wheelbase * maxYaw / Math.max(speed, 1))) - this.steerAngle) * Math.min(1, dt * 5);
      this.heading += yaw * dt;
      sideways *= Math.max(0, 1 - dt * (input.handbrake ? 1.1 : 8));
      if (input.pull && forward > 3 && t > 0) this.wheelieRate += ((t - .42) * 2.8 + Math.max(0, this.wheelie - .6) * 2 - this.wheelieRate * 2.6) * dt;
      else this.wheelieRate += (-this.wheelie * 8 - this.wheelieRate * 4) * dt;
      this.wheelie = Math.max(0, this.wheelie + this.wheelieRate * dt);
      if (this.wheelie === 0) this.wheelieRate = Math.max(0, this.wheelieRate);
      if (this.wheelie > 1.38) { this.crash(); return; }
      this.pitch = slope + this.wheelie; this.whip *= Math.max(0, 1 - dt * 8);   // a whip never outlives the flight
      this.y = ground; this.vy = gvel;
      // Real ridges remain. Deterministic vibration and small lateral skips are less harsh than the car.
      const phase = this.x * Math.sin(this.heading) - this.z * Math.cos(this.heading);
      const ridge = s.washboard ? washboard(phase) : 0;
      const hole = s.kind > 0 && s.roadDist < s.halfWidth ? potholeDepth(this.x, this.z, potholeDensity(s.kind, s.washboard)) : 0;
      const rough = Math.sin(phase * 4.1) * surf.rough * Math.min(speed / 10, 1);
      this.frontTravel = clamp(rough + ridge * .6 + hole * .4 + this.compression + (t < 0 ? .08 : 0), -.09, .24);
      this.rearTravel = clamp(-rough * .7 + ridge * .4 + this.compression * .7, -.09, .20);
      if (s.washboard) { sideways += Math.sin(phase * 2.3) * speed * dt * .11; forward *= 1 - dt * Math.abs(ridge) * .32; }
      this.stand += ((s.washboard || surf.rough > .02 ? .85 : 0) - this.stand) * Math.min(1, dt * 5);
    }
    this.compression *= Math.max(0, 1 - dt * 6);
    // Mail with ?vehicle=bike: wear and its cooldowns run as they do for the car (no ditch depth: a bike rides out).
    if (this.damageActive) this.damage?.drive(dt, Math.abs(forward), surf.name, 0, this.airborne);
    if (this.airborne) { this.frontTravel *= .96; this.rearTravel *= .96; this.stand = Math.min(1, this.stand + dt * 4); }
    if (!this.airborne) {
      const nfx = Math.sin(this.heading), nfz = -Math.cos(this.heading);
      this.vx = nfx * forward + Math.cos(this.heading) * sideways; this.vz = nfz * forward + Math.sin(this.heading) * sideways;
    }
    const horizontal = Math.hypot(this.vx, this.vz);
    if (horizontal > 34) { this.vx *= 34 / horizontal; this.vz *= 34 / horizontal; }
    this.x += this.vx * dt; this.z += this.vz * dt; this.wall();
    this.speed = this.vx * Math.sin(this.heading) - this.vz * Math.cos(this.heading);
    this.roads.guardrails?.block(this, dt);
    this.spin += this.speed * dt / this.spec.wheelRadius;
    const newGround = this.groundAt(this.x, this.z);
    if (newGround !== null && this.y < newGround) {
      if (this.airborne && this.vy < 0 && this.jump.airTime > .06) {
        const clean = Math.abs(angle(this.pitch - slope)) < .62 && Math.abs(this.roll) < .72 && Math.abs(this.pitchRate) < 5.8;
        this.finishJump(clean); this.airborne = false;
        if (this.damageActive) this.damage?.hit('landing', -this.vy);
        if (!clean) this.crash();
        this.compression = clamp(-this.vy * .024, .04, .24); this.pitchRate = 0; this.whip = 0;
      }
      this.y = newGround;
    }
    if (!s.bridge && ((s.water && this.y < (s.waterLimit ?? s.ground+.25)) || s.ground < this.seaLevel - .25 && this.y < this.seaLevel + .1) && this.roads.deckHeight(this.x, this.z) === null) {
      this.sunk += dt; this.vx *= 1 - dt * 3; this.vz *= 1 - dt * 3; this.speed *= 1 - dt * 3;
      if (this.sunk > 1.4) this.respawn();
    } else {
      this.sunk = 0;
      if (!this.airborne && this.wheelie < .15 && newGround !== null && newGround > this.seaLevel + .05 && Math.abs(slope) < .45 && this.speed > 2 && !this.atEdge) {
        this.lastSafe = { x: this.x, z: this.z, heading: this.heading };
        if (s.kind > 0 && s.kind <= 5 && s.roadDist <= s.halfWidth) {
          const tip = this.roadTrail[this.roadTrail.length - 1];
          if (!tip || Math.hypot(tip.x - this.x, tip.z - this.z) > 8) { this.roadTrail.push({ ...this.lastSafe }); if (this.roadTrail.length > 80) this.roadTrail.shift(); }
        }
      }
    }
  }
  private wall(): void {
    this.atEdge = false;
    if (!this.bounds) return;
    const [x0, z0, x1, z1] = this.bounds;
    const x = clamp(this.x, x0, x1), z = clamp(this.z, z0, z1);
    if (x !== this.x || z !== this.z) { this.atEdge = true; this.x = x; this.z = z; this.vx = this.vz = this.speed = 0; }
  }
  private sync(dt: number): void {
    const root = this.car.root;
    // Lift about the rear contact for a wheelie. Lean pivots about the contact line.
    const lift = !this.airborne && !this.crashTime ? Math.sin(this.wheelie) * this.spec.wheelbase / 2 : 0;
    const suspension = this.airborne || this.crashTime ? 0 : (this.frontTravel + this.rearTravel) / 2;
    const attitude = this.airborne || this.crashTime ? 0 : Math.atan2((this.rearTravel - this.frontTravel) * Math.cos(this.roll), this.spec.wheelbase);
    const sideways = !this.airborne ? -Math.sin(this.roll) * this.spec.wheelRadius : 0;
    const normalY = Math.sin(this.roll) * Math.cos(this.pitch + attitude);
    const axleHeight = this.airborne ? this.spec.wheelRadius : this.spec.wheelRadius * Math.sqrt(Math.max(0, 1 - normalY * normalY)) + .07 * Math.abs(normalY);
    root.position.set(this.x + Math.cos(this.heading) * sideways, this.y + axleHeight + lift - suspension * Math.cos(this.roll), this.z + Math.sin(this.heading) * sideways);
    root.rotation.set(this.pitch + attitude, -this.heading + this.whip, this.roll, 'YXZ');
    this.car.pose({ steer: this.steerAngle, spin: this.spin, front: this.frontTravel, rear: this.rearTravel, stand: this.stand,
      foot: !this.airborne && Math.abs(this.speed) < 1 ? 1 : 0, dive: this.frontTravel, crash: this.crashTime, ground: this.y, pitch: this.pitch, roll: this.roll });
    if (dt > 0) this.roadName = this.roads.nearest(this.x, this.z, 14)?.road.name ?? null;
  }
}
