import {deckCounts} from './bridge-contact';
import {MAX_GROUND_RISE_SPEED} from './ground-motion';
import { Drift, type DriftFacts } from './drift-rules';
import { safePlacement } from './placement-pose';
import * as THREE from 'three';
import { BIKE_SPEC, type Bike } from './bike';
import type { VehicleSpec } from './vehicle-spec';
import type { Ride, RideInput, JumpRecord } from './ride';
import { placementDeckReference, type VehiclePlacement } from './vehicle';
import type { Terrain, Surface } from './terrain';
import type { Roads } from './roads';
import type { Damage } from './damage-rules';
import { ROUGH_DEPTH, washboard, potholeDepth, potholeDensity } from './defects';
import { puddleDip } from './rough-roads';
import { PUDDLE_DRAG } from './vehicle';
import { WATER_COVER_CLASS, WATER_SINK_SECONDS, isDryGround, isSeaHeight, isTidalCoverWater, localGroundSlope, safeClampMargin, unknownGroundHeight } from './water-bounds';

export const BIKE_STEP = 1 / 120, BIKE_WHEELBASE = BIKE_SPEC.wheelbase, BIKE_RADIUS = BIKE_SPEC.wheelRadius;
const G = 9.81, TAU = Math.PI * 2;
const MAX_HORIZONTAL_SPEED = 44; // m/s, with headroom above the 150 km/h level-ground top
const clamp = THREE.MathUtils.clamp;
const angle = (v: number) => Math.atan2(Math.sin(v), Math.cos(v));
// Nominal tops allow for the constant 0.18 m/s² rolling loss in the drive step.
const SURFACES = {
  concrete: { top: 152.16 / 3.6, accel: 6.4, grip: 1.35, rough: 0, name: 'concrete' },
  paved: { top: 152.16 / 3.6, accel: 6.4, grip: 1.35, rough: 0, name: 'pavement' },
  gravel: { top: 147.26 / 3.6, accel: 5.9, grip: 1.05, rough: .015, name: 'gravel' },
  trail: { top: 147.30 / 3.6, accel: 5.8, grip: 1.1, rough: .009, name: 'rail trail' },
  track: { top: 142.39 / 3.6, accel: 5.4, grip: .9, rough: .035, name: 'dirt track' },
  grass: { top: 122.13 / 3.6, accel: 5.2, grip: .85, rough: .045, name: 'grass' },
  brush: { top: 38 / 3.6, accel: 3, grip: .7, rough: .07, name: 'brush' },
  washboard: { top: 78 / 3.6, accel: 4.9, grip: .7, rough: .095, name: 'washboard' },
  // A rough stretch (rough-roads.ts): broken ruts, mud and loose stone. Heard and thrown as a dirt track.
  rough: { top: 70 / 3.6, accel: 4.6, grip: .75, rough: .07, name: 'dirt track' },
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
  /** Water under the wheels this step, metres, in the car's order (the bike uses front left and rear left). */
  readonly wheelWater = new Float32Array(4);
  readonly singleTrack = true;
  wheelie = 0; wheelieRate = 0; pitchRate = 0; whip = 0;
  frontTravel = 0; rearTravel = 0; compression = 0;
  crashTime = 0; crashes = 0;
  /** Current flight, then the last completed flight. Values use seconds, metres, whole turns. */
  jump: JumpRecord = { airTime: 0, peakHeight: 0, distance: 0, pitchRotations: 0, clean: false };
  lastJump: JumpRecord | null = null;
  private acc = 0; private stepping = false; private elapsed = 0; private spin = 0;
  private prevGround = 0;
  private ready = false;
  /** The reference height of the last placement or resume; a retry while land loads keeps it. */
  private placeReference: number | undefined;
  private frontHeight = 0; private rearHeight = 0; private sampledY = 0;
  private contacts = [{ x: 0, z: 0, y: 0, h: null as number | null }, { x: 0, z: 0, y: 0, h: null as number | null }];
  private lastSafe: VehiclePlacement | null = null;
  private roadTrail: VehiclePlacement[] = [];
  private launchX = 0; private launchZ = 0; private airPitch = 0;
  private crashHeading = 0; private stand = 0;
  #waterStopped = false; #awaitingLoad = true; #recovering = false; #recovered = false;
  /** The bike was waiting for its land when this update began: the parked hold then has no standing height to keep. */
  #waitedThisStep = false;
  /** Inside update's own retry while waiting: a placement there keeps #waitedThisStep; any other one clears it. */
  #retrying = false;

  constructor(readonly car: Bike, private terrain: Pick<Terrain, 'heightAt' | 'surfaceAt' | 'withContactHeight'> & { readonly cartRoads?: boolean; coverAt?: (x: number, z: number) => number }, readonly roads: Pick<Roads, 'nearest' | 'deckHeight'> & Partial<Pick<Roads, 'guardrails'>>, private seaLevel: number, readonly spec: VehicleSpec = BIKE_SPEC) {}

  private groundAt(x: number, z: number,referenceY=this.y): number | null {
    const g = this.terrain.heightAt(x, z,referenceY), deck = this.roads.deckHeight(x, z);
    return g === null ? null : deckCounts(deck,referenceY,this.terrain.cartRoads) ? Math.max(g,deck) : g;
  }
  /** Dry ground for a pose standing at g (see Vehicle.isDryPose): a deck counts only where it is that ground. */
  private isDryPose(x: number, z: number, g: number | null): boolean {
    if (g === null) return false;
    const s = this.terrain.surfaceAt(x, z, g), deck = this.roads.deckHeight(x, z);
    const onDeck = !!s?.deck || (deck !== null && Math.abs(g - deck) < .02);
    const coverClass = this.terrain.coverAt?.(x, z) ?? 0;
    const slope = coverClass === WATER_COVER_CLASS ? localGroundSlope(x, z, (px, pz) => this.groundAt(px, pz, g)) : 0;
    return isDryGround({ ground: g, surface: s, onDeck, seaLevel: this.seaLevel, coverClass, slope });
  }
  /** The ground a candidate pose stands on, at its own reference height (the land when it gives none). */
  private poseGround(x: number, z: number, referenceY?: number): number | null {
    const land = this.terrain.heightAt(x, z);
    return land === null ? null : this.groundAt(x, z, referenceY ?? land);
  }
  private bothWheelsSupported(x: number, z: number, heading: number, y: number): boolean {
    const fx = Math.sin(heading), fz = -Math.cos(heading), half = this.spec.wheelbase / 2;
    const probe = { y };
    return this.terrain.withContactHeight(probe, () => this.groundAt(x + fx * half, z + fz * half, y)) !== null
      && this.terrain.withContactHeight(probe, () => this.groundAt(x - fx * half, z - fz * half, y)) !== null;
  }
  /** Hold a sunk bike at rest in water until an explicit reset returns it to dry land. */
  stopInWater(): void {
    this.vx = this.vz = this.vy = this.speed = 0;
    this.#waterStopped = true;
  }
  /** Save and restore ES private recovery state so fleet rollbacks never leak trial poses. */
  checkpointHidden(): { save(): void; restore(): void } {
    let stopped = false, awaiting = true;
    return {
      save: () => { stopped = this.#waterStopped; awaiting = this.#awaitingLoad; },
      restore: () => { this.#waterStopped = stopped; this.#awaitingLoad = awaiting; },
    };
  }
  place(x: number, z: number, heading: number, referenceY?:number): boolean {
    if (!safePlacement(x, z, heading, this.bounds) || referenceY!==undefined&&!Number.isFinite(referenceY)) return false;
    // Tiles gone under the live ride: recover at the bike's own height (this.y), so a deck overhead cannot take it.
    if (this instanceof BikeRide && !this.#recovering && this.terrain?.surfaceAt && !this.terrain.surfaceAt(x, z, referenceY ?? this.y) && !this.#awaitingLoad && (this.lastSafe || this.roadTrail.length > 0) && Math.hypot(x - this.x, z - this.z) <= 1) {
      this.#recovering = true;
      try {
        if (this.bounds) {
          const cx = clamp(this.x, this.bounds[0], this.bounds[2]);
          const cz = clamp(this.z, this.bounds[1], this.bounds[3]);
          if (this.terrain.surfaceAt(cx, cz, this.y) && this.isDryPose(cx, cz, this.groundAt(cx, cz, this.y)) && this.place(cx, cz, this.heading, this.y)) return true;
        }
        this.#recovered = false;
        this.respawn();
        return this.#recovered;
      } finally {
        this.#recovering = false;
      }
    }
    const pose:VehiclePlacement = { x, z, heading, y:referenceY };
    if (this.placementGuard && !this.placementGuard(pose)) return false;
    if (!safePlacement(pose.x, pose.z, pose.heading, this.bounds) || pose.y!==undefined&&!Number.isFinite(pose.y)) return false;
    const gAt = this.poseGround(pose.x, pose.z, pose.y);
    if (this instanceof BikeRide && this.#recovering) {
      if (gAt === null || !this.terrain.surfaceAt(pose.x, pose.z, gAt) || !this.bothWheelsSupported(pose.x, pose.z, pose.heading, gAt)) return false;
    }
    if (gAt !== null && !this.isDryPose(pose.x, pose.z, gAt)) return false;
    this.x = pose.x; this.z = pose.z; this.heading = pose.heading;this.placeReference=pose.y;this.placeInfer=false;
    this.vx = this.vz = this.vy = this.speed = this.pitchRate = this.wheelie = this.wheelieRate = this.whip = 0;
    this.pitch = this.roll = this.steerAngle = this.compression = this.crashTime = this.sunk = 0;
    if (!this.stepping) this.acc = 0;
    this.airborne = false;
    this.y = gAt ?? this.y;
    this.ready = this.capture();
    if (this.ready) {
      this.#awaitingLoad = false; this.#waterStopped = false;
      this.y = this.prevGround = Math.max((this.frontHeight + this.rearHeight) / 2, this.groundAt(this.x, this.z) ?? -Infinity);
      this.pitch = Math.atan2(this.frontHeight - this.rearHeight, this.spec.wheelbase);
      this.sampledY = this.y;
      if (this.isDryPose(this.x, this.z, this.groundAt(this.x, this.z, this.y))) this.lastSafe = { ...pose, y:this.y };
    } else this.#awaitingLoad = true;
    this.sync(0);
    if (this.#recovering) this.#recovered = true;
    if (!this.#retrying) this.#waitedThisStep = false;
    return true;
  }
  /** Restore support history only; selection never searches for or installs a new pose. */
  resumeAfterParking(travel?: readonly number[], spin?: number): boolean {
    this.placeReference = this.y; this.ready = this.capture(); if (!this.ready) return false;
    this.prevGround = (this.frontHeight + this.rearHeight) / 2; this.acc = 0; if (spin !== undefined) this.spin = spin;
    if (travel) { this.frontTravel = travel[0] ?? 0; this.rearTravel = travel[2] ?? 0; }
    return true;
  }
  resetControlHistory(): void { this.helpYaw = this.lightHelpYaw = 0; this.lastJump = null; }
  resetVisit(): void { this.lastSafe = null; this.roadTrail.length = 0; this.lastJump = null; this.jump = { airTime: 0, peakHeight: 0, distance: 0, pitchRotations: 0, clean: false }; this.crashTime = this.sunk = 0; this.#waterStopped = false; this.#awaitingLoad = true; }
  restart(x: number, z: number, heading: number): void { this.lastSafe = null; this.roadTrail.length = 0; this.lastJump = null; this.#waterStopped = false; this.#awaitingLoad = true; this.placeAt(x, z, heading); }
  respawn(): void {
    let distance = 0;
    while (this.roadTrail.length > 1 && distance < 35) { const a = this.roadTrail.pop()!, b = this.roadTrail[this.roadTrail.length - 1]; distance += Math.hypot(a.x - b.x, a.z - b.z); }
    const b = this.bounds;
    const mx = b ? safeClampMargin(b[0], b[2], 2) : 0, mz = b ? safeClampMargin(b[1], b[3], 2) : 0;
    // Each candidate is judged and placed at its own height (a crumb or a safe point keeps the deck it was on; a road
    // point stands on land).
    const usable = (p: VehiclePlacement | null | undefined): p is VehiclePlacement => !!p
      && (!b || (p.x > b[0] + mx && p.x < b[2] - mx && p.z > b[1] + mz && p.z < b[3] - mz))
      && !!this.terrain.surfaceAt(p.x, p.z, p.y)
      && this.isDryPose(p.x, p.z, this.poseGround(p.x, p.z, p.y));
    const placeCandidate = (p: VehiclePlacement | null | undefined): boolean => {
      if (!usable(p)) return false;
      const wasRecovering = this.#recovering;
      this.#recovering = true;
      try { return this.place(p.x, p.z, p.heading, p.y); }
      finally { this.#recovering = wasRecovering; }
    };
    while (this.roadTrail.length > 0) {
      const crumb = this.roadTrail[this.roadTrail.length - 1];
      if (placeCandidate(crumb)) return;
      this.roadTrail.pop();
    }
    const near = this.roads.nearest(this.x, this.z, 1600, r => r.kind <= 5 && !r.bridge);
    for (const candidate of [near, this.lastSafe]) {
      if (placeCandidate(candidate)) return;
    }
    if (b) {
      const cxMargin = safeClampMargin(b[0], b[2], 60), czMargin = safeClampMargin(b[1], b[3], 60);
      const cx = clamp(this.x, b[0] + cxMargin, b[2] - cxMargin), cz = clamp(this.z, b[1] + czMargin, b[3] - czMargin);
      for (const radius of [2000, 8000]) {
        const point = this.roads.nearest(cx, cz, radius, r => r.kind <= 3 && !r.bridge);
        if (placeCandidate(point)) return;
      }
    }
    const wide = this.roads.nearest(this.x, this.z, 8000, r => r.kind <= 3 && !r.bridge)
      ?? this.roads.nearest(this.x, this.z, 8000, r => r.kind <= 5 && !r.bridge);
    if (placeCandidate(wide)) return;
    this.stopInWater();
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
      p.h = this.terrain.withContactHeight(p, () => this.groundAt(p.x, p.z,p.y));
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
      for (const p of this.contacts) { const now = this.terrain.withContactHeight(p, () => this.groundAt(p.x, p.z,p.y)); if (now === null || p.h === null) known = false; else correction += (now - p.h) / 2; }
    });
    if (known && Math.abs(correction) > 1e-6) { this.y += correction; this.prevGround += correction; }
  }
  /** The reference for a re-place at the current pose (see Vehicle.retryHeight). */
  get retryHeight(): number | undefined { return this.ready ? this.y : this.inferring(this.x, this.z) ? placementDeckReference(this.roads, this.x, this.z) ?? this.placeReference : this.placeReference; }
  private placeInfer = false;
  private inferX = 0; private inferZ = 0;
  private inferring(x: number, z: number): boolean { return this.placeInfer && Math.abs(x - this.inferX) < .5 && Math.abs(z - this.inferZ) < .5; }
  /** See Vehicle.placeAt: a height-free placement stands on the deck it lies on, else on land. */
  placeAt(x: number, z: number, heading: number): boolean {
    const placed = this.place(x, z, heading, placementDeckReference(this.roads, x, z));
    if (placed && this.placeReference === undefined) { this.placeInfer = true; this.inferX = this.x; this.inferZ = this.z; }
    return placed;
  }
  parkedPlace(x: number, z: number, heading: number, y: number): boolean {
    // As Vehicle.parkedPlace: a bike still waiting for its land at the start of the step has no standing height.
    if (this.#waitedThisStep) return false;
    const infer = this.inferring(x, z), deck = infer ? placementDeckReference(this.roads, x, z) : undefined;
    const placed = this.place(x, z, heading, deck ?? y);
    this.placeInfer = infer && deck === undefined;
    return placed;
  }
  retryPlace(): boolean {
    const infer = this.inferring(this.x, this.z), deck = infer ? placementDeckReference(this.roads, this.x, this.z) : undefined;
    const placed = this.place(this.x, this.z, this.heading, deck ?? this.retryHeight);
    this.placeInfer = infer && deck === undefined;
    return placed;
  }
  update(dt: number, input: RideInput, afterStep?: () => void): void {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.#waitedThisStep = !this.ready;
    const safeInput = { throttle: Number.isFinite(input.throttle) ? clamp(input.throttle, -1, 1) : 0, steer: Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0, handbrake: !!input.handbrake, pull: !!input.pull };
    if (!this.ready) {
      this.#retrying = true;
      try {
        // The retry's own height, not the old body height (which could take a deck overhead).
        const reference = this.retryHeight;
        if (!this.retryPlace()) {
          const land = this.terrain.heightAt(this.x, this.z);
          if (land !== null) {
            this.respawn();
            if (this.#waterStopped) {
              // Stand at the ground the retry asked for: the old body height could take a deck overhead.
              const gNow = this.groundAt(this.x, this.z, reference ?? land);
              if (gNow !== null) this.y = gNow;
              this.prevGround = this.y; this.airborne = false; this.#awaitingLoad = false;
              this.ready = this.capture();
              if (this.ready) {
                this.y = this.prevGround = Math.max(this.y, (this.frontHeight + this.rearHeight) / 2, gNow ?? -Infinity);
                this.pitch = Math.atan2(this.frontHeight - this.rearHeight, this.spec.wheelbase);
                this.sampledY = this.y;
              }
              this.sync(0);
            }
          }
        }
      } finally { this.#retrying = false; }
      return;
    }
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
    if (this.terrain.cartRoads && deckCounts(this.roads.deckHeight(this.x,this.z),this.y,this.terrain.cartRoads)) return s.kind===4?SURFACES.track:s.washboard?SURFACES.washboard:SURFACES.gravel;
    if (s.deck) return s.washboard?SURFACES.washboard:s.kind===9?SURFACES.concrete:s.kind<=2?SURFACES.paved:s.kind===5?SURFACES.trail:s.kind===4?SURFACES.track:SURFACES.gravel;
    if (!s.deck && deckCounts(this.roads.deckHeight(this.x, this.z),this.y,this.terrain.cartRoads)) return SURFACES.paved;
    if (s.kind === 0 || s.roadDist > s.halfWidth + .4) return s.mineral ? SURFACES.gravel : s.canopy > 1.6 ? SURFACES.brush : SURFACES.grass;
    return s.kind === 9 ? SURFACES.concrete : s.kind <= 2 || s.kind === 13 ? SURFACES.paved : s.washboard ? SURFACES.washboard : s.rough ? SURFACES.rough : s.kind === 5 ? SURFACES.trail : s.kind === 4 && (!s.gravel || this.terrain.cartRoads) ? SURFACES.track : SURFACES.gravel;
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
  private sinkOffMap(dt: number): void {
    const seaFloor = unknownGroundHeight(this.seaLevel);
    if (this.#waterStopped) {
      this.vx = this.vz = this.vy = this.speed = 0;
      const postG = this.groundAt(this.x, this.z);
      if (postG !== null && this.y < postG) this.y = postG;
      this.prevGround = this.y; this.airborne = false;
      return;
    }
    this.vx *= 1 - Math.min(1, dt * 3); this.vz *= 1 - Math.min(1, dt * 3);
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.wall();
    this.vy -= G * dt;
    this.y += this.vy * dt;
    if (this.y < seaFloor) { this.y = seaFloor; this.vy = 0; }
    const postG = this.groundAt(this.x, this.z);
    if (postG !== null && this.y < postG) { this.y = postG; if (this.vy < 0) this.vy = 0; }
    this.prevGround = postG ?? seaFloor;
    this.airborne = this.y > this.prevGround + 0.05;
    this.speed = this.vx * Math.sin(this.heading) - this.vz * Math.cos(this.heading);
    this.sunk += dt;
    if (this.sunk > WATER_SINK_SECONDS) this.respawn();
  }
  private step(dt: number, input: RideInput): void {
    let s = this.terrain.surfaceAt(this.x, this.z, this.y);
    if (!s) {
      this.wall();
      s = this.terrain.surfaceAt(this.x, this.z, this.y);
      if (!s) { this.sinkOffMap(dt); return; }
      const edgeG = this.groundAt(this.x, this.z);
      if (edgeG !== null && this.y < edgeG) { this.y = edgeG; if (this.vy < 0) this.vy = 0; }
    }
    this.correctGround();
    if (!this.capture()) {
      this.wall();
      if (!this.capture()) { this.sinkOffMap(dt); return; }
    }
    this.#awaitingLoad = false;
    const surf = this.surface(s); this.surfaceName = surf.name;
    this.elapsed += dt;
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = Math.sin(this.heading);
    let forward = this.vx * fx + this.vz * fz, sideways = this.vx * rx + this.vz * rz;
    const centre = this.groundAt(this.x, this.z) ?? (this.frontHeight + this.rearHeight) / 2;
    const ground = Math.max((this.frontHeight + this.rearHeight) / 2, centre);
    const slope = this.frontHeight < centre - .25 && this.rearHeight >= centre - .25
      ? Math.atan2((centre - this.rearHeight) * 2, this.spec.wheelbase)
      : Math.atan2(this.frontHeight - this.rearHeight, this.spec.wheelbase);
    if (this.#waterStopped) {
      const onDeckNow = !!s.deck || deckCounts(this.roads.deckHeight(this.x, this.z), this.y, this.terrain.cartRoads);
      const onRoadNow = onDeckNow || (s.kind > 0 && s.roadDist <= s.halfWidth + .4);
      const coverNow = this.terrain.coverAt?.(this.x, this.z) ?? 0;
      const slopeNow = coverNow === WATER_COVER_CLASS ? localGroundSlope(this.x, this.z, (px, pz) => this.groundAt(px, pz)) : 0;
      const wetNow = !onDeckNow && (
        (s.water && this.y < (s.waterLimit ?? s.ground + .25))
        || isSeaHeight(s.ground, this.seaLevel)
        || isTidalCoverWater(s.ground, this.seaLevel, coverNow, s.canopy, slopeNow, onRoadNow, !!s.mineral)
      );
      if (wetNow) { this.vx = this.vz = this.vy = this.speed = 0; this.y = ground; this.prevGround = ground; this.airborne = false; return; }
      this.#waterStopped = false;
    }
    const gvel = clamp((ground - this.prevGround) / dt, -30, MAX_GROUND_RISE_SPEED); this.prevGround = ground;
    if (this.crashTime > 0) {
      this.crashTime += dt; this.vx *= .97; this.vz *= .97;
      this.wheelWater.fill(0);   // a tumbling bike throws no spray and makes no splash
      if (this.damageActive) this.damage?.drive(dt, 0, surf.name, 0, false);   // repair cooldowns run on through a tumble
      this.x += this.vx * dt; this.z += this.vz * dt; this.y = Math.max(ground, centre, this.groundAt(this.x, this.z) ?? -Infinity); this.pitch = this.roll = 0;
      this.roads.guardrails?.block(this, dt);
      this.wall(); this.speed = Math.hypot(this.vx, this.vz);
      if (this.crashTime >= 1.6) {
        const candidate: VehiclePlacement = this.lastSafe ?? { x: this.x, z: this.z, heading: this.crashHeading, y: this.y };
        const safe = this.isDryPose(candidate.x, candidate.z, this.poseGround(candidate.x, candidate.z, candidate.y)) ? candidate : null;
        if (safe) this.place(safe.x, safe.z, safe.heading, safe.y);
        else this.respawn();
      }
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
      forward = clamp(forward, -5, MAX_HORIZONTAL_SPEED);
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
      const hole = !(s.kind > 0 && s.roadDist < s.halfWidth) ? 0 : s.rough ? potholeDepth(this.x, this.z, potholeDensity(s.kind, s.washboard, s.gravel, true), ROUGH_DEPTH)
        : potholeDepth(this.x, this.z, potholeDensity(s.kind, s.washboard, s.gravel));
      // Water holds both wheels back (vehicle.ts PUDDLE_DRAG per wheel, so twice that) and the front dips into it.
      const water = puddleDip(this.x, this.z);
      this.wheelWater[0] = this.wheelWater[2] = water;
      if (water > 0) forward *= Math.max(0, 1 - dt * 2 * water * PUDDLE_DRAG);
      const rough = Math.sin(phase * 4.1) * surf.rough * Math.min(speed / 10, 1);
      this.frontTravel = clamp(rough + ridge * .6 + (hole + water) * .4 + this.compression + (t < 0 ? .08 : 0), -.09, .24);
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
    if (horizontal > MAX_HORIZONTAL_SPEED) {
      this.vx *= MAX_HORIZONTAL_SPEED / horizontal;
      this.vz *= MAX_HORIZONTAL_SPEED / horizontal;
    }
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
    const onDeck = !!s.deck || deckCounts(this.roads.deckHeight(this.x, this.z), this.y, this.terrain.cartRoads);
    const onRoad = onDeck || (s.kind > 0 && s.roadDist <= s.halfWidth + .4);
    const coverClass = this.terrain.coverAt?.(this.x, this.z) ?? 0;
    const waterSlope = coverClass === WATER_COVER_CLASS ? localGroundSlope(this.x, this.z, (px, pz) => this.groundAt(px, pz)) : 0;
    if (!onDeck && (
      (s.water && this.y < (s.waterLimit ?? s.ground + .25))
      || (isSeaHeight(s.ground, this.seaLevel) && this.y < this.seaLevel + .1)
      || (isTidalCoverWater(s.ground, this.seaLevel, coverClass, s.canopy, waterSlope, onRoad, !!s.mineral) && this.y < s.ground + .25)
    )) {
      this.sunk += dt; this.vx *= 1 - dt * 3; this.vz *= 1 - dt * 3; this.speed *= 1 - dt * 3;
      if (this.sunk > 1.4) this.respawn();
    } else {
      this.sunk = 0;
      if (!this.airborne && this.wheelie < .15 && newGround !== null && newGround > this.seaLevel + .05 && Math.abs(slope) < .45 && this.speed > 2 && !this.atEdge && this.isDryPose(this.x, this.z, this.groundAt(this.x, this.z, this.y)) && this.bothWheelsSupported(this.x, this.z, this.heading, newGround)) {
        this.lastSafe = { x: this.x, z: this.z, heading: this.heading, y:this.y };
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
