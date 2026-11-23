import {deckCounts} from './bridge-contact';
import {crestVelocity, GRAVITY as G, hardLanding, LEDGE_DROP} from './ground-motion';
import { safePlacement } from './placement-pose';
import { wideDemo } from './vehicle-demo';
import * as THREE from 'three';
import { CAR_SPEC, type Rig, type VehicleSpec } from './vehicle-spec';
import { type Damage, steeringPull } from './damage-rules';
import { ROUGH_DEPTH, potholeDensity, potholeDepth, washboard } from './defects';
import { winterRoadGrip } from './weather-surfaces';
import { puddleDip } from './rough-roads';
import type { Road, RoadHit, Roads } from './roads';
import { horseSpeedLimit } from './horse-motion';
import { DrivingHelp, forwardTangent } from './driving-help';
import { Drift, slideAngle, type DriftFacts } from './drift-rules';
import type { Surface, Terrain } from './terrain';
import { SEA_SURFACE_MARGIN, WATER_COVER_CLASS, WATER_SINK_SECONDS, isDryGround, isSurfaceWet, localGroundSlope, safeClampMargin, unknownGroundHeight } from './water-bounds';

export interface VehiclePlacement { x: number; z: number; heading: number; y?:number }
/** The most the touch speed limit brakes beyond taking the engine away, in m/s². */
export const LIMIT_BRAKE = 1.2;
/** `held`: the game holds the car (an animal ahead): its handbrake is a brake and never starts a slide. */
export interface Input { throttle: number; steer: number; handbrake: boolean; touch?: boolean; held?: boolean }

/** Water drag per metre of wheel sunk in a puddle, per m/s: a lane-wide pond at 50 km/h slows the car about 0.4 g. */
export const PUDDLE_DRAG = 0.7;
/** Yaw per metre of water on one side more than the other, per m/s: the wet side holds the car back and turns it in. */
export const PUDDLE_PULL = 0.12;
const STEP = 1 / 120;
// Cornering grip, as a multiple of what real tyres give. At 1 the car was calm but could not take a bend at
// speed (the owner's second drive, 10 Nov 2026); this is a game, so the tyres hold harder than life.
// Washboard keeps real grip: that road is meant to be miserable.

// Grip, rolling resistance and roughness for each surface.
const SURFACES = {
  concrete: { mu: 1.0, roll: 0.013, rough: 0.0, name: 'concrete' },
  paved: { mu: 1.0, roll: 0.013, rough: 0.0, name: 'pavement' },
  gravel: { mu: 0.72, roll: 0.03, rough: 0.012, name: 'gravel' },
  track: { mu: 0.62, roll: 0.05, rough: 0.03, name: 'dirt track' },
  trail: { mu: 0.8, roll: 0.02, rough: 0.004, name: 'rail trail' },   // fine crusher dust, graded: the best surface off the pavement
  washboard: { mu: 0.6, roll: 0.06, rough: 0.09, name: 'washboard' },
  // A rough stretch (rough-roads.ts): mud and loose stone in broken ruts. It sounds and throws dirt as a dirt track.
  rough: { mu: 0.55, roll: 0.075, rough: 0.05, name: 'dirt track' },
  grass: { mu: 0.5, roll: 0.09, rough: 0.04, name: 'grass' },
  brush: { mu: 0.42, roll: 0.5, rough: 0.07, name: 'brush' },
};

/**
 * Arcade driving on the terrain height field. The car is one body with a forward and a sideways speed;
 * tyres remove sideways speed up to the grip of the surface, so loose surfaces slide.
 * Heading: 0 = north, clockwise positive. World: +x east, -z north.
 */
/** How far from a bridge span's centre line a respawn road point still counts as on that span (half a wide deck). */
const DECK_REACH = 8;

// A road that is not a bridge piece can still be a deck: a span recovered from the map carries a highway that is not
// flagged as a bridge. Only where the hit lies on such a span (within DECK_REACH of its centre line) does the
// placement take that deck; anywhere else the road stands on land, so a deck overhead cannot take the car. A road id
// alone is not enough: a source road runs for kilometres past the few metres a span carries.
export function spanDeckReference(roads: Pick<Roads, 'deckHeight'> & { bridgeRuns?: Roads['bridgeRuns'] }, hit: Pick<RoadHit, 'x' | 'z' | 'road'>): number | undefined {
  for (const run of roads.bridgeRuns?.() ?? []) {
    if (!run.roads.has(hit.road.id)) continue;
    const p = run.pts;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1][0], az = p[i - 1][1], dx = p[i][0] - ax, dz = p[i][1] - az, len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((hit.x - ax) * dx + (hit.z - az) * dz) / len2)) : 0;
      if (Math.hypot(hit.x - ax - dx * t, hit.z - az - dz * t) <= DECK_REACH) return roads.deckHeight(hit.x, hit.z) ?? undefined;
    }
  }
  return undefined;
}
/** A height-free placement's reference: the deck only where the point lies on a span carrying its nearest road. */
export function placementDeckReference(roads: Pick<Roads, 'deckHeight' | 'nearest'> & { bridgeRuns?: Roads['bridgeRuns'] }, x: number, z: number): number | undefined {
  const hit = roads.nearest(x, z, DECK_REACH);
  return hit ? spanDeckReference(roads, hit) : undefined;
}

export class Vehicle {
  /** Per-instance washboard/shake stream; the default retains the global draw order. */
  private random: () => number = () => Math.random();
  x = 0; z = 0; y = 0; heading = 0;
  vx = 0; vz = 0; vy = 0;
  pitch = 0; roll = 0;
  steerAngle = 0;
  speed = 0;                 // forward speed, m/s
  airborne = false;
  damage: Damage | null = null;
  damageActive = false;
  desktopPull = false;
  /** Optional coupled body. Null preserves the original arithmetic and input path. */
  towLoad: { mass: number; brakeShare: number; dragShare: number; driveMassShare: number; halfWidth?: number } | null = null;
  beforeStep: ((dt: number, input: Input) => Input) | null = null;
  onPlaced: (() => void) | null = null;
  /** Every teleport, restart and respawn passes here before changing ground contacts. */
  placementGuard: ((pose: VehiclePlacement) => boolean) | null = null;
  private readonly placementPose: VehiclePlacement = { x: 0, z: 0, heading: 0 };
  onSolidImpact(speed: number): void { this.drift.hit(this.x, this.z); if (this.spec.locomotion !== 'horse' && this.damageActive) this.damage?.hit('impact', speed); }
  /** The slide state (drift-rules.ts). A spec without `drift` never slides. */
  readonly drift = new Drift();
  /** False for a computer driver: only the player's ride slides. */
  canDrift = true;
  private readonly driftGround = { speed: 0, surface: '', mu: 0, towed: false, turn: 0 };
  private readonly slideSpeed = { forward: 0, right: 0 };
  /** The last finished drift, once (Shift reports it to the score stream). */
  takeDrift(): DriftFacts | null { return this.drift.take(); }
  surfaceName = '';
  /** Water under each wheel this step, metres (front left, front right, rear left, rear right): for the splash. */
  readonly wheelWater = new Float32Array(4);
  roadName: string | null = null;
  sunk = 0;                  // seconds spent in water
  private lean = new THREE.Vector2();
  private spin = 0;
  private lastGood: VehiclePlacement | null = null;
  /** The reference height of the last placement. A retry while land loads keeps it, never the height of the old place. */
  private placeReference: number | undefined;
  /** placeAt chose the height: a retry while land loads asks again, since an unbuilt deck gave no answer. */
  private placeInfer = false;
  private inferX = 0; private inferZ = 0;
  /** Only at the point placeAt used: a car moved since (a refused jump, driving) never asks for a deck again. */
  private inferring(x: number, z: number): boolean { return this.placeInfer && Math.abs(x - this.inferX) < .5 && Math.abs(z - this.inferZ) < .5; }
  /** Where the car has been on the road, one point every 8 m or so, newest last. */
  private trail: VehiclePlacement[] = [];
  /** The playable area in world units [x0, z0, x1, z1]: the fine map data ends just outside it. */
  bounds: [number, number, number, number] | null = null;
  /** True while the car is pressed against the edge of the map. */
  atEdge = false;
  private prevGround = 0;
  private flightPeak: number | null = null;
  private eraPlacementPending=false;
  // Keep the positions actually sampled, so a new tile can be distinguished from car movement.
  private readonly groundContacts = Array.from({ length: 4 }, () => ({ x: 0, z: 0, y: 0, height: null as number | null }));
  private contactsReady = false;
  private readonly contactBody = { y: 0 };   // the body's height when the wheel contacts were last sampled
  private stuck = false;
  private acc = 0;
  /** Steering help, per second: how fast the car straightens along its road with hands off. 0 turns it off. */
  assist = 0.9;
  /** Strong is enabled only by the touch settings; keyboard input never enters it. */
  strongHelp = false;
  touchSpeedLimit = true;
  #heldTouchSpeedLimit = 0;
  // Safe points carry the height the car stood at, so a return picks the same deck or land (VehiclePlacement.y).
  #safeNow: VehiclePlacement = { x: 0, z: 0, heading: 0 };
  #safeBack: VehiclePlacement = { x: 0, z: 0, heading: 0 };
  #hasSafe = false;
  #waterStopped = false;
  #awaitingLoad = true;
  #recovering = false;
  #recovered = false;
  /** The car was waiting for its land when this update began: the parked hold then has no standing height to keep. */
  #waitedThisStep = false;
  /** Inside update's own retry while waiting: a placement there keeps #waitedThisStep; any other one clears it. */
  #retrying = false;
  /** m/s while Strong touch help holds the throttle near its cap; zero otherwise. */
  get activeTouchSpeedLimit(): number { return this.#heldTouchSpeedLimit; }
  helpYaw = 0; // additional Strong yaw, radians/second, for fixed-step checks
  lightHelpYaw = 0;
  private touchRoad: number | null = null;
  private junctionClear = 0;
  private readonly drivingHelp: DrivingHelp;
  private roadHeading: number | null = null;
  private shake = 0;
  private jolt = 0;         // a pothole hit, fading        // how hard rough ground rattles the body, for the eye only

  constructor(readonly car: Rig, private terrain: Terrain, private roads: Roads, private seaLevel: number, readonly spec: VehicleSpec = CAR_SPEC) {
    car.root.rotation.order = 'YXZ';
    this.drivingHelp = new DrivingHelp(roads);
  }

  /** The reference for a re-place at the current pose: the last place's reference while its land is still loading
   *  (this.y is then the old pose's height, which could pick a deck overhead), else the live body height. */
  get retryHeight(): number | undefined { return this.stuck ? (this.inferring(this.x, this.z) ? this.deckReference(this.x, this.z) ?? this.placeReference : this.placeReference) : this.y; }

  place(x: number, z: number, heading: number, referenceY?:number): boolean {
    if (!safePlacement(x, z, heading, this.bounds) || referenceY!==undefined&&!Number.isFinite(referenceY)) return false;
    // Live driving calls place() at the current spot when tiles disappear under the ride; recover instead of freezing off-map.
    // The recovery stays at the car's own height (this.y), so a deck overhead cannot take it.
    if (this instanceof Vehicle && !this.#recovering && this.terrain?.surfaceAt && !this.terrain.surfaceAt(x, z, referenceY ?? this.y) && !this.#awaitingLoad && (this.#hasSafe || this.lastGood || this.trail.length > 0) && Math.hypot(x - this.x, z - this.z) <= 1) {
      this.#recovering = true;
      try {
        if (this.bounds) {
          const cx = THREE.MathUtils.clamp(this.x, this.bounds[0], this.bounds[2]);
          const cz = THREE.MathUtils.clamp(this.z, this.bounds[1], this.bounds[3]);
          const clampedG = this.groundAt(cx, cz, this.y);
          if (this.terrain.surfaceAt(cx, cz, this.y) && clampedG !== null && this.isDryPose(cx, cz, clampedG) && this.place(cx, cz, this.heading, this.y)) return true;
        }
        this.#recovered = false;
        this.respawn();
        return this.#recovered;
      } finally {
        this.#recovering = false;
      }
    }
    const pose = this.placementPose; pose.x = x; pose.z = z; pose.heading = heading; pose.y=referenceY;
    if (this.placementGuard && !this.placementGuard(pose)) return false;
    x = pose.x; z = pose.z; heading = pose.heading;
    if (!safePlacement(x, z, heading, this.bounds) || pose.y!==undefined&&!Number.isFinite(pose.y)) return false;
    // The pose's own reference picks the deck or the land under it, never the old pose's height.
    const land=this.terrain.heightAt(x,z),g=land===null?null:this.groundAt(x,z,pose.y??land);
    if (this instanceof Vehicle && this.#recovering && (g === null || !this.terrain.surfaceAt(x, z, g) || !this.allWheelsSupported(x, z, heading, g))) return false;
    if (g !== null && !this.isDryPose(x, z, g)) return false;
    this.#heldTouchSpeedLimit = 0;
    this.drift.reset();
    this.x = x; this.z = z; this.heading = heading; this.placeReference = pose.y; this.placeInfer = false;
    this.vx = this.vz = this.vy = 0; this.sunk = 0; this.airborne = false;
    this.flightPeak = null;
    if (this.spec.locomotion === 'horse') { this.speed = 0; this.car.resetPose?.(); }
    if (g !== null) {
      this.y = this.prevGround = g; this.stuck = false;
      this.#awaitingLoad = false; this.#waterStopped = false;
      this.#safeNow.x = this.#safeBack.x = x;
      this.#safeNow.z = this.#safeBack.z = z;
      this.#safeNow.heading = this.#safeBack.heading = heading;
      this.#safeNow.y = this.#safeBack.y = g;
      this.#hasSafe = true;
    } else { this.stuck = true; this.#awaitingLoad = true; }   // wait for the ground to load
    if (this.car.setTravel) { this.suspension.fill(0); this.landingCompression = 0; }
    this.captureGround();
    if (this.terrain.cartRoads && g !== null) {
      this.eraPlacementPending=true;
      // Reset on the same four rough wheel contacts the first step measures, including clamped deck ends.
      const s=this.terrain.surfaceAt(x,z,this.y),along=s?.washboard?this.roads.nearest(x,z,14)?.heading??heading:0;
      const ax=Math.sin(along),az=-Math.cos(along);let sum=0,known=true;
      for(const p of this.groundContacts){
        if(p.height===null){known=false;break;}
        let h=p.height;const sw=this.terrain.surfaceAt(p.x,p.z,this.y);
        if(this.spec.locomotion !== 'horse'&&sw&&sw.kind>0&&sw.roadDist<=sw.halfWidth-.2){h-=potholeDepth(p.x,p.z,potholeDensity(sw.kind,sw.washboard,sw.gravel));if(sw.washboard)h-=washboard(p.x*ax+p.z*az);}
        sum+=h;
      }
      if(known){this.y=this.prevGround=sum/4;this.vy=0;this.captureGround();}
    }
    this.sync(0);
    this.onPlaced?.();
    if (this.#recovering) this.#recovered = true;
    if (!this.#retrying) this.#waitedThisStep = false;
    return true;
  }

  /** Resume a parked controller without placing or drawing it. Its existing pose is authoritative. */
  resumeAfterParking(travel?: readonly number[], spin?: number): boolean {
    this.captureGround();
    if (this.groundContacts.some(p => p.height === null)) return false;
    this.prevGround = this.groundContacts.reduce((sum, p) => sum + p.height!, 0) / this.groundContacts.length;
    this.flightPeak = this.airborne ? this.y : null;
    this.acc = 0; this.stuck = false; if (spin !== undefined) this.spin = spin;
    if (travel) for (let i = 0; i < this.suspension.length; i++) this.suspension[i] = travel[i] ?? 0;
    return true;
  }

  /** A new start (a new day): where the car went before no longer counts, so R cannot lead back to yesterday's road. */
  resetControlHistory(): void { this.touchRoad = null; this.junctionClear = 0; this.roadHeading = null; this.helpYaw = this.lightHelpYaw = 0; }
  resetVisit(): void { this.trail.length = 0; this.lastGood = null; this.#hasSafe = false; this.#waterStopped = false; this.#awaitingLoad = true; this.touchRoad = null; this.junctionClear = 0; this.helpYaw = this.lightHelpYaw = 0; this.sunk = 0; this.flightPeak = null; }

  restart(x: number, z: number, heading: number): boolean {
    this.trail.length = 0; this.lastGood = null; this.#hasSafe = false; this.#waterStopped = false; this.#awaitingLoad = true;
    return this.placeAt(x, z, heading);
  }

  /** A placement that gives no height (a ?at= link, a visit start, a mailbox start, a restart). The car takes a deck
   *  only where the point lies on a span that carries its nearest road, the respawn rule; elsewhere it stands on land. */
  placeAt(x: number, z: number, heading: number): boolean {
    const placed = this.place(x, z, heading, this.deckReference(x, z));
    if (placed && this.placeReference === undefined) { this.placeInfer = true; this.inferX = this.x; this.inferZ = this.z; }
    return placed;
  }
  /** Hold the car where it is while it waits for the first pedal. A placeAt placement keeps asking for its deck until
   *  one answers: coarse land arrives (and the car stands on it) before the banks' fine land builds the deck. */
  parkedPlace(x: number, z: number, heading: number, y: number): boolean {
    // A car that was still waiting for its land at the start of the step had no standing height: y is an old body
    // height that could take a deck overhead. That step's own retry placed it; there is nothing to hold.
    if (this.#waitedThisStep) return false;
    const infer = this.inferring(x, z), deck = infer ? this.deckReference(x, z) : undefined;
    const placed = this.place(x, z, heading, deck ?? y);
    this.placeInfer = infer && deck === undefined;
    return placed;
  }
  /** Place again where the car is, as while land loads, keeping how the height was chosen. */
  retryPlace(): boolean {
    const infer = this.inferring(this.x, this.z), deck = infer ? this.deckReference(this.x, this.z) : undefined;
    const placed = this.place(this.x, this.z, this.heading, deck ?? this.retryHeight);
    this.placeInfer = infer && deck === undefined;
    return placed;
  }
  private deckReference(x: number, z: number): number | undefined { return placementDeckReference(this.roads, x, z); }

  /** Hold a sunk ride at rest in water until an explicit reset returns it to dry land. */
  stopInWater(): void {
    this.vx = this.vz = this.vy = this.speed = 0;
    this.flightPeak = null;
    this.#waterStopped = true;
  }

  /** Save and restore ES private recovery state so fleet rollbacks never leak trial poses. */
  checkpointHidden(): { save(): void; restore(): void } {
    let sx = 0, sz = 0, sh = 0, bx = 0, bz = 0, bh = 0, has = false, stopped = false, awaiting = true;
    let sy: number | undefined, by: number | undefined;
    return {
      save: () => {
        sx = this.#safeNow.x; sz = this.#safeNow.z; sh = this.#safeNow.heading; sy = this.#safeNow.y;
        bx = this.#safeBack.x; bz = this.#safeBack.z; bh = this.#safeBack.heading; by = this.#safeBack.y;
        has = this.#hasSafe; stopped = this.#waterStopped; awaiting = this.#awaitingLoad;
      },
      restore: () => {
        this.#safeNow.x = sx; this.#safeNow.z = sz; this.#safeNow.heading = sh; this.#safeNow.y = sy;
        this.#safeBack.x = bx; this.#safeBack.z = bz; this.#safeBack.heading = bh; this.#safeBack.y = by;
        this.#hasSafe = has; this.#waterStopped = stopped; this.#awaitingLoad = awaiting;
      },
    };
  }

  /** Dry ground for a pose standing at g. A deck counts only where it is the ground the pose stands on (g), so a
   *  deck overhead does not make the river under it dry. */
  private isDryPose(x: number, z: number, g: number | null): boolean {
    if (g === null) return false;
    const s = this.terrain.surfaceAt(x, z, g), deck = this.roads.deckHeight(x, z);
    const onDeck = s?.deck === true || (deck !== null && Math.abs(g - deck) < .02);
    const coverClass = this.terrain.coverAt?.(x, z) ?? 0;
    const slope = coverClass === WATER_COVER_CLASS ? localGroundSlope(x, z, (px, pz) => this.groundAt(px, pz, g)) : 0;
    return isDryGround({ ground: g, surface: s, onDeck, seaLevel: this.seaLevel, coverClass, slope });
  }

  private allWheelsSupported(x: number, z: number, heading: number, y: number): boolean {
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
    const probe = this.spec.contactPlane ? { y } : null;
    for (let i = 0; i < 4; i++) {
      const a = (i < 2 ? 1 : -1) * this.spec.wheelbase / 2;
      const b = (i % 2 ? 1 : -1) * (i < 2 ? this.spec.track : this.spec.rearTrack ?? this.spec.track) / 2;
      const wx = x + fx * a + rx * b, wz = z + fz * a + rz * b;
      const wh = probe ? this.terrain.withContactHeight(probe, () => this.groundAt(wx, wz, y)) : this.groundAt(wx, wz, y);
      if (wh === null) return false;
    }
    return true;
  }

  /** A recovery placement: only on loaded, dry ground, judged at the candidate's own reference height. */
  private tryDryPlace(x: number, z: number, heading: number, referenceY?: number): boolean {
    if (!safePlacement(x, z, heading, this.bounds)) return false;
    if (!this.terrain.surfaceAt(x, z, referenceY)) return false;
    const land = this.terrain.heightAt(x, z), g = land === null ? null : this.groundAt(x, z, referenceY ?? land);
    if (!this.isDryPose(x, z, g)) return false;
    const wasRecovering = this.#recovering;
    this.#recovering = true;
    try { return this.place(x, z, heading, referenceY); }
    finally { this.#recovering = wasRecovering; }
  }

  /**
   * Put the car back on the road it came along, a good way back from where it went wrong. Each further call goes
   * further back, so one bad spot cannot trap the car. (The first version put the car on the nearest road point:
   * at the end of a road that was the end itself, and the car fell straight off again.)
   */
  respawn() {
    let back = 0;
    while (this.trail.length > 1 && back < 45) {
      const a = this.trail.pop()!, b = this.trail[this.trail.length - 1];
      back += Math.hypot(a.x - b.x, a.z - b.z);
    }
    while (this.trail.length > 0) {
      const crumb = this.trail[this.trail.length - 1];
      if (this.inside(crumb.x, crumb.z, 30) && this.tryDryPlace(crumb.x, crumb.z, this.inward(crumb.x, crumb.z, crumb.heading), crumb.y)) return;
      this.trail.pop();
    }
    // No trail yet: the nearest public road that is well inside the map.
    const hit = this.roads.nearest(this.x, this.z, 900, (r) => r.kind <= 3 && !r.bridge) ?? null;
    if (hit && this.inside(hit.x, hit.z, 60) && this.tryDryPlace(hit.x, hit.z, this.inward(hit.x, hit.z, hit.heading), this.fallbackReference(hit))) return;
    if (this.lastGood && this.tryDryPlace(this.lastGood.x, this.lastGood.z, this.inward(this.lastGood.x, this.lastGood.z, this.lastGood.heading), this.lastGood.y)) return;
    if (this.#hasSafe) {
      if (this.tryDryPlace(this.#safeBack.x, this.#safeBack.z, this.inward(this.#safeBack.x, this.#safeBack.z, this.#safeBack.heading), this.#safeBack.y)) return;
      if (this.tryDryPlace(this.#safeNow.x, this.#safeNow.z, this.inward(this.#safeNow.x, this.#safeNow.z, this.#safeNow.heading), this.#safeNow.y)) return;
    }
    if (this.bounds) {
      const mx = safeClampMargin(this.bounds[0], this.bounds[2], 300), mz = safeClampMargin(this.bounds[1], this.bounds[3], 300);
      const cx = THREE.MathUtils.clamp(this.x, this.bounds[0] + mx, this.bounds[2] - mx), cz = THREE.MathUtils.clamp(this.z, this.bounds[1] + mz, this.bounds[3] - mz);
      for (const radius of [2000, 8000]) {
        const near = this.roads.nearest(cx, cz, radius, (r) => r.kind <= 3 && !r.bridge);
        if (near && this.tryDryPlace(near.x, near.z, this.inward(near.x, near.z, near.heading), this.fallbackReference(near))) return;
      }
    }
    const wide = this.roads.nearest(this.x, this.z, 8000, (r) => r.kind <= 3 && !r.bridge)
      ?? this.roads.nearest(this.x, this.z, 8000, (r) => r.kind <= 5 && !r.bridge);
    if (wide && this.tryDryPlace(wide.x, wide.z, this.inward(wide.x, wide.z, wide.heading), this.fallbackReference(wide))) return;
    // Nowhere dry to return to: stop the ride instead of rolling on water or void tiles.
    this.stopInWater();
  }

  private clampBounds(): void {
    this.atEdge = false;
    if (!this.bounds) return;
    const [x0, z0, x1, z1] = this.bounds;
    let clamped = false;
    if (this.x < x0) { this.x = x0; clamped = true; this.atEdge = this.vx < 0; this.vx = Math.max(this.vx, 0); }
    if (this.x > x1) { this.x = x1; clamped = true; this.atEdge = this.atEdge || this.vx > 0; this.vx = Math.min(this.vx, 0); }
    if (this.z < z0) { this.z = z0; clamped = true; this.atEdge = this.atEdge || this.vz < 0; this.vz = Math.max(this.vz, 0); }
    if (this.z > z1) { this.z = z1; clamped = true; this.atEdge = this.atEdge || this.vz > 0; this.vz = Math.min(this.vz, 0); }
    // Hitting the wall stops the car, as a barricade would: it does not slide along it.
    if (this.atEdge) { this.drift.hit(this.x, this.z); this.vx *= 0.2; this.vz *= 0.2; }
    if (clamped) {
      const edgeG = this.groundAt(this.x, this.z);
      if (edgeG !== null && this.y < edgeG) { this.y = edgeG; if (this.vy < 0) this.vy = 0; }
    }
  }

  private fallbackReference(hit: RoadHit): number | undefined { return spanDeckReference(this.roads, hit); }

  private inside(x: number, z: number, margin: number): boolean {
    const b = this.bounds;
    return !b || (x > b[0] + margin && x < b[2] - margin && z > b[1] + margin && z < b[3] - margin);
  }

  /** Near the edge of the map, face the car back toward the middle. */
  private inward(x: number, z: number, heading: number): number {
    const b = this.bounds;
    if (!b || this.inside(x, z, 350)) return heading;
    const toX = (b[0] + b[2]) / 2 - x, toZ = (b[1] + b[3]) / 2 - z;
    return Math.sin(heading) * toX - Math.cos(heading) * toZ < 0 ? heading + Math.PI : heading;
  }

  private readonly hoofGround = (x: number, z: number) => this.groundAt(x, z);
  private readonly launchGround = (x: number, z: number, y: number) => this.groundAt(x, z, y);

  private groundAt(x: number, z: number, referenceY=this.y): number | null {
    const deck = this.roads.deckHeight(x, z);
    // A narrow timber deck can sit below an unrelated coarse bank triangle.
    // Hooves follow the actual road deck, not that bank's interpolation.
    // Filled timber-side abutments meet drawn land, which may differ from the decoded coarse sample.
    const apron = this.terrain.bridgeApproaches?.apronHeight(x, z) ?? null;
    if (apron !== null && this.reach(apron,referenceY)) return this.reach(deck,referenceY) ? Math.max(deck,apron) : apron;
    if (this.spec.locomotion === 'horse' && this.reach(deck,referenceY)) return deck;
    const sampled = this.terrain.heightAt(x, z,referenceY);
    // Hooves stand on mesh triangles, not the decoded sample: a wheel can hide a small interpolation gap; a sole cannot.
    // The tile comes from the LOD selection (meshContactAt), never from what the camera happens to see, so turning
    // the view cannot change the ground under a hoof. Site decks and bridges keep their own height.
    const drawn = this.spec.locomotion === 'horse' && !this.terrain.surfaceAt(x, z,referenceY)?.deck ? this.horseMesh(x, z) : null;
    const g = drawn ?? sampled;
    if (g === null) return null;
    return this.reach(deck,referenceY) ? Math.max(deck, g) : g;
  }
  private reach(deck: number | null, referenceY: number): deck is number { return deckCounts(deck, referenceY, this.terrain.cartRoads); }

  private readonly meshProbe = { height: 0, source: 0, drawn: false };
  private horseMesh(x: number, z: number): number | null {
    if (this.terrain.meshContactAt) return this.terrain.meshContactAt(x, z, this.meshProbe) ? this.meshProbe.height : null;
    return this.terrain.meshHeightAt(x, z, true);
  }

  private captureGround(): void {
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = Math.sin(this.heading);
    this.groundContacts.forEach((p, i) => {
      const a = (i < 2 ? 1 : -1) * this.spec.wheelbase / 2, b = (i % 2 ? 1 : -1) * (i < 2 ? this.spec.track : this.spec.rearTrack ?? this.spec.track) / 2;
      p.x = this.x + fx * a + rx * b; p.z = this.z + fz * a + rz * b;
      // A long axle can be over 25 cm uphill from the centre even on the slip's shallow slope.
      // Judge a deck against the body plane at that axle, keeping the same 25 cm underside guard.
      p.y = this.spec.contactPlane ? this.y + this.spec.contactPlane * (Math.sin(this.pitch) * a + Math.sin(this.roll) * b) : this.y;
      p.height = this.spec.contactPlane ? this.terrain.withContactHeight(p, () => this.groundAt(p.x, p.z,p.y)) : this.groundAt(p.x, p.z,p.y);
    });
    this.contactBody.y = this.y;
    this.contactsReady = true;
    if(this.car.setTravel)this.cacheTravelPlane();
  }

  private correctGround(): void {
    if (this.contactsReady) {
      let correction = 0, known = true;
      // Asked again as the body stood when it sampled: a deck counts as ground only for a body near its height, so
      // the same spot reads differently once the car has risen or fallen. That is the car's motion, not new land.
      this.terrain.withContactHeight(this.contactBody, () => {
        for (const p of this.groundContacts) {
          const now = this.spec.contactPlane ? this.terrain.withContactHeight(p, () => this.groundAt(p.x, p.z,p.y)) : this.groundAt(p.x, p.z,p.y);
          if (now === null || p.height === null) known = false;
          else correction += (now - p.height) / 4;
        }
      });
      // Heights changed at the SAME world positions. This is new ground data, not velocity.
      // Rebase both the body and its previous contact height, preserving any real flight velocity.
      if (known && Math.abs(correction) > 1e-6) {
        this.y += correction; this.prevGround += correction;
        if (this.flightPeak !== null) this.flightPeak += correction;
      }
    }
    this.captureGround();
  }

  private readonly savedContacts = this.groundContacts.map(p => ({ ...p }));
  private savedReady = false; private savedY = 0; private savedPrevious = 0;
  private savedFlightPeak: number | null = null;
  private readonly restoreContacts = () => {
    for (let i = 0; i < 4; i++) Object.assign(this.groundContacts[i], this.savedContacts[i]);
    this.contactsReady = this.savedReady; this.contactBody.y = this.savedY; this.prevGround = this.savedPrevious;
    this.flightPeak = this.savedFlightPeak;
    this.correctGround();
  };
  /** Reusable contact checkpoint, requested only by an attached towing body. */
  checkpointGround(): () => void {
    for (let i = 0; i < 4; i++) Object.assign(this.savedContacts[i], this.groundContacts[i]);
    this.savedReady = this.contactsReady; this.savedY = this.contactBody.y; this.savedPrevious = this.prevGround;
    this.savedFlightPeak = this.flightPeak;
    return this.restoreContacts;
  }

  update(dt: number, input: Input, afterStep?: () => void) {
    if (!input.touch || !this.strongHelp || !this.touchSpeedLimit || input.throttle <= 0 || this.airborne || this.stuck) this.#heldTouchSpeedLimit = 0;
    this.#waitedThisStep = this.stuck;
    if (this.stuck) {
      this.#retrying = true;
      try {
        // The retry's own height, not the old body height (which could take a deck overhead).
        const reference = this.retryHeight;
        if (!this.retryPlace()) {
          const land = this.terrain.heightAt(this.x, this.z);
          if (land !== null) {
            this.stuck = false;
            this.respawn();
            if (this.#waterStopped) {
              // Stand at the ground the retry asked for: the old body height could take a deck overhead.
              const gNow = this.groundAt(this.x, this.z, reference ?? land);
              if (gNow !== null) this.y = gNow;
              this.prevGround = this.y; this.airborne = false; this.#awaitingLoad = false;
              this.captureGround(); this.sync(0);
            }
          }
        }
      } finally { this.#retrying = false; }
      return;
    }
    // Advance physics by whole fixed steps.
    const here = this.roads.nearest(this.x, this.z, 9, (r) => r.kind <= 3);
    this.roadHeading = here && here.dist < here.road.halfWidth + 1 ? here.heading : null;
    if (input.touch && this.strongHelp && here && here.dist <= here.road.halfWidth) {
      this.touchRoad = forwardTangent(here.road, here.seg, here.t, this.heading, Math.max(3, Math.abs(this.speed) * 0.3));
      this.junctionClear = this.drivingHelp.clear(this.x, this.z);
    } else { this.touchRoad = null; this.junctionClear = 0; }
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) { this.step(STEP, this.beforeStep ? this.beforeStep(STEP, input) : input); afterStep?.(); this.acc -= STEP; }
    this.sync(dt);
  }

  private step(dt: number, input: Input) {
    this.#heldTouchSpeedLimit = 0;
    this.helpYaw = this.lightHelpYaw = 0;
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading);   // forward
    const rx = Math.cos(this.heading), rz = Math.sin(this.heading);    // right
    let s: Surface | null = this.terrain.surfaceAt(this.x, this.z, this.y);
    if (!s) {
      if (this.bounds) {
        this.clampBounds();
        s = this.terrain.surfaceAt(this.x, this.z, this.y);
      }
      if (!s) {
        // Off known land: treat the void as deep sea so the ride sinks and returns to safe ground.
        const seaFloor = unknownGroundHeight(this.seaLevel);
        this.drift.hit(this.x, this.z);
        if (this.#waterStopped) {
          this.vx = this.vz = this.vy = this.speed = 0;
          const postG = this.groundAt(this.x, this.z);
          if (postG !== null && this.y < postG) this.y = postG;
          this.prevGround = this.y; this.airborne = false;
          return;
        }
        this.vx *= 1 - Math.min(1, 3 * dt); this.vz *= 1 - Math.min(1, 3 * dt);
        this.x += this.vx * dt; this.z += this.vz * dt;
        if (this.bounds) this.clampBounds();
        this.vy -= G * dt;
        this.y += this.vy * dt;
        if (this.y < seaFloor) { this.y = seaFloor; this.vy = 0; }
        const postG = this.groundAt(this.x, this.z);
        if (postG !== null && this.y < postG) { this.y = postG; if (this.vy < 0) this.vy = 0; }
        this.prevGround = postG ?? seaFloor;
        this.airborne = this.y > this.prevGround + 0.05;
        this.speed = this.vx * fx + this.vz * fz;
        this.sunk += dt;
        if (this.sunk > WATER_SINK_SECONDS) this.respawn();
        return;
      }
    }
    this.#awaitingLoad = false;
    const siteDeck=s.deck===true;
    // A wharf or slip ramp turns the road help off; a road bridge and its approaches keep it.
    const helpOff=siteDeck&&s.roadDeck!==true;
    const onDeck = siteDeck || this.reach(this.roads.deckHeight(this.x, this.z),this.y);
    this.correctGround();

    // Wheel contact heights give the attitude of the body.
    const hw = this.spec.track / 2, hl = this.spec.wheelbase / 2;
    // Each wheel sits in whatever the road has under it: a pothole, or the trough of a washboard ridge.
    const along = s.washboard ? this.roads.nearest(this.x, this.z, 14)?.heading ?? this.heading : 0;
    const ax = Math.sin(along), az = -Math.cos(along);
    let deepest = 0;
    let contact = 0;
    let missing = 0;
    let wet = 0, wetSide = 0;   // metres of water under the wheels, and right minus left
    this.wheelWater.fill(0);
    const h = (a: number, b: number) => {
      const wx = this.x + fx * a + rx * b, wz = this.z + fz * a + rz * b;
      const wheel = contact;
      const g = this.groundContacts[contact++].height;
      if (g === null) { missing++; return unknownGroundHeight(this.seaLevel); }
      if (this.spec.locomotion === 'horse') return g;
      const sw = this.terrain.surfaceAt(wx, wz,this.y);
      if (!sw || sw.kind === 0 || sw.roadDist > sw.halfWidth - 0.2) return g;
      let d = sw.rough ? potholeDepth(wx, wz, potholeDensity(sw.kind, sw.washboard, sw.gravel, true), ROUGH_DEPTH)
        : potholeDepth(wx, wz, potholeDensity(sw.kind, sw.washboard, sw.gravel));
      if (d > deepest) deepest = d;
      if (sw.washboard) d += washboard(wx * ax + wz * az);
      const water = puddleDip(wx, wz);
      if (water > 0) { d += water; wet += water; wetSide += b > 0 ? water : -water; this.wheelWater[wheel] = water; }
      return g - d;
    };
    const rearHW = (this.spec.rearTrack ?? this.spec.track) / 2;
    const fl = h(hl, -hw), fr = h(hl, hw), rl = h(-hl, -rearHW), rr = h(-hl, rearHW);
    const ground = (fl + fr + rl + rr) / 4;
    if(this.terrain.cartRoads&&this.eraPlacementPending){this.y=this.prevGround=ground;this.vy=0;this.airborne=false;this.eraPlacementPending=false;}
    const slopeF = Math.atan2((fl + fr) / 2 - (rl + rr) / 2, this.spec.wheelbase);   // nose up is positive
    const slopeR = Math.atan2((fr + rr) / 2 - (fl + rl) / 2, (this.spec.rearTrack === undefined ? this.spec.track : (this.spec.track + this.spec.rearTrack) / 2));       // right side up is positive

    const onRoad = onDeck || (s.kind > 0 && s.roadDist <= s.halfWidth + 0.4);
    if (this.#waterStopped) {
      const coverNow = this.terrain.coverAt?.(this.x, this.z) ?? 0;
      const slopeNow = coverNow === WATER_COVER_CLASS ? localGroundSlope(this.x, this.z, this.hoofGround) : 0;
      if ((!onDeck && missing >= 2) || isSurfaceWet({ onDeck, onRoad, ground: s.ground, canopy: s.canopy, water: s.water, waterLimit: s.waterLimit, mineral: s.mineral, y: this.y, seaLevel: this.seaLevel, coverClass: coverNow, slope: slopeNow })) {
        const centreG = this.groundAt(this.x, this.z);
        const holdY = centreG !== null ? Math.max(ground, centreG) : ground;
        this.vx = this.vz = this.vy = this.speed = 0;
        this.y = holdY; this.prevGround = holdY; this.airborne = false;
        return;
      }
      this.#waterStopped = false;
    }
    const surf = this.terrain.cartRoads && onRoad ? (s.washboard ? SURFACES.washboard : s.kind === 4 ? SURFACES.track : SURFACES.gravel) : siteDeck && s.kind===9 ? SURFACES.concrete : onRoad ? (s.kind <= 2 || s.kind === 9 || s.kind === 13 ? SURFACES.paved : s.washboard ? SURFACES.washboard : s.rough ? SURFACES.rough : s.kind === 12 ? SURFACES.grass : s.kind === 3 || s.kind >= 8 || s.gravel ? SURFACES.gravel : s.kind === 5 ? SURFACES.trail : SURFACES.track)
      : s.mineral ? SURFACES.gravel : s.canopy > 1.6 ? SURFACES.brush : SURFACES.grass;
    this.surfaceName = surf.name;
    const snowGrip = winterRoadGrip(this.terrain.uniforms?.winterCover, onRoad && !onDeck, input.touch);

    let vf = this.vx * fx + this.vz * fz, vl = this.vx * rx + this.vz * rz;
    const headingBefore = this.heading;
    let lateralGrip = 0;

    // Only a crest in the actual path can start a flight. Contact corrections just move the body.
    this.prevGround = ground;
    let launch: number | null = null;
    let centre: number | null = null;
    const ramp = helpOff || onRoad && !onDeck && s.kind >= 8 && s.kind <= 10;
    const acrossLedge = Math.max(fl, fr, rl, rr) - Math.min(fl, fr, rl, rr) >= LEDGE_DROP;
    const travelSpeed = Math.hypot(this.vx, this.vz);
    if (!this.airborne && missing === 0 && travelSpeed > .05 && (travelSpeed > 3 || acrossLedge) && this.spec.locomotion !== 'horse') {
      // On a built ramp, the leading axle loses support before the body reaches the lip.
      centre = this.groundAt(this.x, this.z);
      if (ramp) {
        const reach = hl / travelSpeed;
        const x = this.x + reach * this.vx, z = this.z + reach * this.vz;
        const grade = Math.sin(this.pitch) * vf / travelSpeed + Math.sin(this.roll) * vl / travelSpeed;
        const referenceY = Math.max(this.y, s.ground) + Math.max(0, grade * hl);
        launch = crestVelocity(this.launchGround, x, z, this.vx, this.vz, dt, this.groundAt(x, z, referenceY), referenceY, true, grade);
      }
      launch ??= crestVelocity(this.launchGround, this.x, this.z, this.vx, this.vz, dt, centre, this.y);
    }
    if (launch !== null) {
      this.y = Math.max(this.y, ground, centre ?? ground);
      this.vy = launch;
      this.flightPeak = this.y;
    }
    const free = this.y + this.vy * dt - 0.5 * G * dt * dt;
    if (this.car.setTravel) this.landingCompression *= Math.exp(-12 * dt);
    if (launch !== null || this.airborne && this.spec.locomotion !== 'horse' && free > ground + (this.vy > 0 ? 0 : .05)) {
      this.airborne = true;
      this.flightPeak = Math.max(this.flightPeak ?? this.y, this.y, free);
      this.y = free;
      this.vy -= G * dt;
    } else {
      if (this.airborne && this.vy < -3) {
        if (this.car.setTravel) this.landingCompression = Math.min(.20, -this.vy * .022);
        if (hardLanding(this.flightPeak, ground)) {
          if (this.damageActive) this.damage?.hit('landing', -this.vy);
          vf *= this.spec.landingForward; vl *= this.spec.landingSideways;
        }
      }
      this.airborne = false;
      this.y = ground;
      this.vy = 0;
      this.flightPeak = null;
    }

    // The touch speed limit for this ground, m/s (0: none): the grip model and a slide both keep to it.
    // No limiter on works-yard surfaces (8/9/10): the slipway needs its full run-up.
    // A road bridge deck limits as the road it carries (its own kind 9 is the concrete works-yard surface).
    const kind = siteDeck && s.deckRoadKind !== undefined ? s.deckRoadKind : s.kind;
    const touchLimit = !(input.touch && this.strongHelp && this.touchSpeedLimit) || kind >= 8 && kind <= 10 ? 0 : !onRoad ? 50 / 3.6 : s.washboard ? 50 / 3.6 : s.rough ? 35 / 3.6 : kind === 1 ? 100 / 3.6 : kind === 2 ? 90 / 3.6 : kind === 13 ? 90 / 3.6 : kind === 3 ? 75 / 3.6 : kind === 5 ? 55 / 3.6 : 50 / 3.6;
    // A drift has its own step (driftStep); every other step is the ordinary grip model below, unchanged.
    let slid = false;
    if (this.airborne) { this.drift.airborne(this.x, this.z); this.drift.watch(input, dt); }   // the flick's clocks run in the air too
    else if (this.driftStep(dt, input, surf, slopeF, deepest, vf, vl, touchLimit, wet, snowGrip)) { slid = true; vf = this.slideSpeed.forward; vl = this.slideSpeed.right; }
    if (!this.airborne && !slid) {
      // On washboard the tyres skip from ridge to ridge: the faster the car, the less they hold.
      const skip = surf === SURFACES.washboard ? THREE.MathUtils.clamp(1 - (Math.abs(vf) - 5) / 15, 0.28, 1) : 1;
      const horse = this.spec.locomotion === 'horse';
      const mu = surf.mu * skip * snowGrip, t = input.throttle;
      const hoofGrip = horse ? .9 : mu;
      let a = 0;
      if (t > 0 && vf > -0.5) a += t * Math.min(this.spec.engineAcceleration, this.spec.enginePower / (Math.abs(vf) + 1), hoofGrip * G * this.spec.tractionShare);       // power, then traction
      else if (t < 0 && vf < 0.5) a += t * (vf > -this.spec.reverseSpeed ? this.spec.reverseAcceleration : 0);                                      // reverse
      else if (t !== 0) a -= Math.sign(vf) * Math.abs(t) * this.spec.brake * hoofGrip;                                 // brake
      if (input.touch && this.strongHelp && this.touchSpeedLimit && t > 0 && vf > 0) {
        const limit = touchLimit;
        // Leave ALL engine power below the band, including on hills. Above it the limiter eases the engine off.
        // Far above it (the surface changed under the car, or the help was switched on at speed) it takes the
        // engine away and adds only a light brake: the car slows as if the driver had lifted, never as a hard stop.
        if (limit > 0 && vf >= limit - 1) this.#heldTouchSpeedLimit = limit;
        if (limit > 0) a -= Math.min(Math.max(0, vf - limit + 1) * 4, a + LIMIT_BRAKE);
      }
      if (input.handbrake) a -= Math.sign(vf) * Math.min(this.spec.handbrake * hoofGrip, Math.abs(vf) / dt);
      if (this.towLoad && this.spec.mass) {
        const load = this.towLoad, total = this.spec.mass + load.mass;
        const braking = t !== 0 && t * vf < 0 || input.handbrake;
        a *= braking ? (this.spec.mass + load.mass * load.brakeShare) / total : this.spec.mass / (this.spec.mass + load.mass * load.driveMassShare);
      }
      // Hoof pacing on a deck counters its exaggerated grade; timber has no washboard ruts.
      // Off the deck, the original horse grade caps and effort still apply.
      a -= horse && onDeck ? 0 : G * Math.sin(slopeF);
      const hard = Math.abs(input.steer);
      if (hard > 0.6 && Math.abs(vf) > 13) a -= Math.sign(vf) * this.spec.hardSteerDrag * ((hard - 0.6) / 0.4) * Math.min(1, (Math.abs(vf) - 13) / 10);
      const drag = (horse ? .022 : surf.roll) * G + (this.towLoad && this.spec.mass ? this.spec.aeroDrag * vf * vf * (1 + this.towLoad.dragShare * this.towLoad.mass / this.spec.mass) : this.spec.aeroDrag * vf * vf) + (!horse && surf === SURFACES.brush ? 0.9 * Math.abs(vf) : 0)
        + deepest * 45 * Math.min(1, Math.abs(vf) / 3)   // a wheel in a pothole drags hard
        + wet * PUDDLE_DRAG * Math.abs(vf);              // and water holds the wheels back
      // Resistance cannot reverse the car: it only brings it to rest.
      if (Math.abs(vf) > 0.05 || Math.abs(a) > drag) a -= Math.sign(vf || a) * Math.min(drag, Math.abs(vf) / dt + Math.abs(a));
      vf += a * dt;
      if (horse) vf = THREE.MathUtils.clamp(vf, -this.spec.reverseSpeed, horseSpeedLimit(onDeck ? 'gravel' : surf.name, onDeck ? 0 : slopeF));
      if (Math.abs(vf) < 0.03 && t === 0 && Math.abs(G * Math.sin(slopeF)) < surf.roll * G + 0.6) vf = 0;   // parked

      // Tyres take sideways speed away, up to their grip. A cross slope pulls the car downhill.
      vl -= G * Math.sin(slopeR) * dt * 0.35;
      const corner = surf === SURFACES.washboard ? 1 : this.spec.cornering;
      const grip = corner * hoofGrip * G * dt * (input.handbrake ? 0.3 : 1);
      if (this.spec.lateralInertia === undefined) vl -= THREE.MathUtils.clamp(vl, -grip, grip);
      else lateralGrip = grip;
      this.lean.set(a, 0);

      // Steering: less lock at speed.
      // A key or a thumb asks for full lock at once. The front wheels turn only as far as the tyres can hold at
      // this speed (a little past it, so the car can still be made to slide), and they turn in more slowly the
      // faster the car goes. Before this limit, full lock at highway speed asked for several g of cornering:
      // the car swung from side to side and was "all over the road".
      const v = Math.abs(vf);
      const gripLock = Math.atan((this.spec.wheelbase * this.spec.gripLock * corner * mu * G) / Math.max(v * v, 4));
      const maxSteer = Math.min(this.spec.maxSteer, gripLock);
      const ask = THREE.MathUtils.clamp(input.steer, -1, 1);
      const pull = steeringPull(this.damageActive && !!this.damage?.pulls, v, this.desktopPull);
      const target = THREE.MathUtils.clamp(ask * maxSteer + pull, -maxSteer, maxSteer);
      const away = Math.abs(target) > Math.abs(this.steerAngle) && target * this.steerAngle >= 0;
      const rate = away ? this.spec.steerBaseRate + this.spec.steerSpeedRate / (1 + v / this.spec.steerSpeedScale) : this.spec.steerReturnRate;   // quick back to centre, gentle turn-in
      this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -rate * dt, rate * dt);
      this.steerAngle = THREE.MathUtils.clamp(this.steerAngle, -maxSteer, maxSteer);
      const yaw = (vf * Math.tan(this.steerAngle)) / this.spec.wheelbase;
      this.heading += yaw * dt;
      // The light help is continuous for a thumb, and EXACTLY the old equation
      // for keyboard asks -1, 0, 1 (including its operation order and 0.4 rad gate).
      const light = input.touch ? 1 - Math.abs(ask) : ask === 0 ? 1 : 0;
      if (!helpOff && this.assist > 0 && light > 0 && this.roadHeading !== null && v > 2) {
        let err = Math.atan2(Math.sin(this.roadHeading - this.heading), Math.cos(this.roadHeading - this.heading));
        if (Math.abs(err) > Math.PI / 2) err -= Math.sign(err) * Math.PI;
        if (Math.abs(err) < 0.4) {
          const change = err * this.assist * dt;
          this.lightHelpYaw = (ask === 0 ? change : change * light) / dt;
          this.heading += ask === 0 ? change : change * light;
        }
      }
      if (!helpOff && input.touch && this.strongHelp && this.touchRoad !== null && onRoad && vf > 5 && input.throttle > 0 && !input.handbrake) {
        let err = Math.atan2(Math.sin(this.touchRoad - this.heading), Math.cos(this.touchRoad - this.heading));
        if (Math.abs(err) > Math.PI / 2) err -= Math.sign(err) * Math.PI;
        const yieldToThumb = Math.max(0, 1 - Math.abs(ask) / 0.55);
        const aligned = Math.max(0, Math.min(1, (0.6 - Math.abs(err)) / 0.25));
        this.helpYaw = err * 7 * yieldToThumb * yieldToThumb * aligned * this.junctionClear * Math.min(1, (vf - 5) / 4);
        this.heading += this.helpYaw * dt;
      }
      if (surf === SURFACES.washboard) {
        // The car wanders by itself, more with speed, and the wheel rate of the ridges shakes everything.
        this.heading += (this.random() - 0.5) * this.spec.washboardYaw * Math.abs(vf) * (1.2 - skip) * dt * 6;
        vl += (this.random() - 0.5) * this.spec.washboardSideways * Math.abs(vf) * (1.1 - skip) * dt * 4;
      }
      // Water on one side holds that side back: the car turns toward it. A pure function of where the wheels are.
      if (wetSide !== 0) this.heading += wetSide * PUDDLE_PULL * vf * dt;
      if (deepest > 0.03 && Math.abs(vf) > 2) this.jolt = Math.max(this.jolt, deepest * 6);
      this.lean.y = vf * yaw;

      this.shake = surf.rough * Math.min(Math.abs(vf), 20) + this.jolt;
      this.jolt *= Math.max(0, 1 - 9 * dt);
    }

    if (this.spec.lateralInertia !== undefined && !slid) {
      // Change coordinates, not energy: carry the same momentum into the new heading, then dissipate slip.
      const angle = (this.heading - headingBefore) * this.spec.lateralInertia;
      const cos = Math.cos(angle), sin = Math.sin(angle), forward = vf;
      vf = forward * cos + vl * sin;
      vl = vl * cos - forward * sin;
      vl -= THREE.MathUtils.clamp(vl, -lateralGrip, lateralGrip);
    }
    // Rebuild the world velocity along the new heading.
    const nfx = Math.sin(this.heading), nfz = -Math.cos(this.heading), nrx = Math.cos(this.heading), nrz = Math.sin(this.heading);
    this.vx = nfx * vf + nrx * vl; this.vz = nfz * vf + nrz * vl;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // The edge of the map is a wall the car cannot pass: beyond it there is no road data to drive on.
    this.clampBounds();
    // A wide axle can straddle a bank while the chassis is still on its upper surface.
    if (missing > 0) {
      const postG = this.groundAt(this.x, this.z);
      if (postG !== null && this.y < postG) { this.y = postG; if (this.vy < 0) this.vy = 0; }
    } else if (!this.airborne && this.spec.locomotion !== 'horse' && ground < s.ground - .4) {
      const postG = this.groundAt(this.x, this.z);
      if (postG !== null) this.y = Math.max(this.y, postG - .4);
    }
    if (this.spec.locomotion !== 'horse' && this.damageActive && this.damage) {
      let depth = 0;
      if (!onDeck && !onRoad && s.level >= 7 && s.roadDist < s.halfWidth + 6) {
        const road = this.roads.nearest(this.x, this.z, 16, r => r.kind <= 3 && !r.bridge);
        if (road) depth = (this.groundAt(road.x, road.z) ?? ground) - ground;
      }
      this.damage.drive(dt, Math.abs(vf), surf.name, depth, this.airborne);
    }
    this.speed = vf;
    this.roads.guardrails?.block(this, dt);
    this.spin += (vf * dt) / this.spec.wheelRadius;

    const k = this.airborne ? 2 : 14;
    this.pitch += (slopeF - this.pitch) * Math.min(1, k * dt);
    this.roll += (slopeR - this.roll) * Math.min(1, k * dt);


    // Water or off loaded land: the car is lost after a moment, then it comes back on safe dry ground.
    const coverClass = this.terrain.coverAt?.(this.x, this.z) ?? 0;
    const slope = coverClass === WATER_COVER_CLASS ? localGroundSlope(this.x, this.z, this.hoofGround) : 0;
    if ((!onDeck && missing >= 2) || isSurfaceWet({ onDeck, onRoad, ground: s.ground, canopy: s.canopy, water: s.water, waterLimit: s.waterLimit, mineral: s.mineral, y: this.y, seaLevel: this.seaLevel, coverClass, slope })) {
      this.sunk += dt;
      this.drift.hit(this.x, this.z);   // into the water: a slide ends here and is not clean
      this.vx *= 1 - Math.min(1, 3 * dt); this.vz *= 1 - Math.min(1, 3 * dt);
      if (this.sunk > WATER_SINK_SECONDS) this.respawn();
    } else {
      this.sunk = 0;
      if (!this.airborne && !this.atEdge && missing === 0 && ground >= this.seaLevel + SEA_SURFACE_MARGIN) {
        if (!this.#hasSafe) {
          this.#safeNow.x = this.#safeBack.x = this.x;
          this.#safeNow.z = this.#safeBack.z = this.z;
          this.#safeNow.heading = this.#safeBack.heading = this.heading;
          this.#safeNow.y = this.#safeBack.y = this.y;
          this.#hasSafe = true;
        } else if (Math.hypot(this.x - this.#safeNow.x, this.z - this.#safeNow.z) >= 12) {
          this.#safeBack.x = this.#safeNow.x; this.#safeBack.z = this.#safeNow.z; this.#safeBack.heading = this.#safeNow.heading; this.#safeBack.y = this.#safeNow.y;
          this.#safeNow.x = this.x; this.#safeNow.z = this.z; this.#safeNow.heading = this.heading; this.#safeNow.y = this.y;
        }
      }
      if (onRoad && (!onDeck || !this.airborne) && Math.abs(vf) > 2) {
        this.lastGood = { x: this.x, z: this.z, heading: this.heading, y:this.y };
        const tip = this.trail[this.trail.length - 1];
        if (!tip || Math.hypot(tip.x - this.x, tip.z - this.z) > 8) {
          this.trail.push({ x: this.x, z: this.z, heading: vf < 0 ? this.heading + Math.PI : this.heading, y:this.y });
          if (this.trail.length > 80) this.trail.shift();
        }
      }
    }
  }

  /**
   * One grounded step of a slide (drift-rules.ts), or false when the body is not sliding and the grip model drives it.
   * The body keeps one speed along its path; the rules turn the path and set the slide angle between path and heading.
   * No driving help acts here: the light and the strong help would pull the nose back to the road and fight the slide.
   */
  private driftStep(dt: number, input: Input, surf: (typeof SURFACES)[keyof typeof SURFACES], slopeF: number, deepest: number, vf: number, vl: number, touchLimit: number, wet = 0, snowGrip = 1): boolean {
    const spec = this.spec.drift, d = this.drift;
    if (!spec || !this.canDrift || this.spec.locomotion === 'horse') return false;
    d.watch(input, dt);
    if (input.held) d.held(this.x, this.z);   // a stop for an animal ends a slide, never scores it
    const skip = surf === SURFACES.washboard ? THREE.MathUtils.clamp(1 - (Math.abs(vf) - 5) / 15, 0.28, 1) : 1;
    const g = this.driftGround;
    let v = Math.hypot(vf, vl);
    g.speed = vf > 0 ? v : 0; g.surface = surf.name; g.mu = surf.mu * skip * snowGrip; g.towed = !!this.towLoad;
    if (!d.active) {
      const side = d.begins(spec, input, g);
      if (!side) return false;
      d.begin(side, input.handbrake ? 'handbrake' : 'lift', slideAngle(vf, vl), this.x, this.z, input.steer);
    }
    if (!(vf > 0)) { d.finish('lost', this.x, this.z); return false; }
    // The front wheels turn as the grip model turns them (its lock at this speed, its turn-in and return rates), and the yaw
    // they would give on grip is the least the path turns into the slide: a slide never runs wide of the wheel.
    const corner = surf === SURFACES.washboard ? 1 : this.spec.cornering;
    const lock = Math.min(this.spec.maxSteer, Math.atan((this.spec.wheelbase * this.spec.gripLock * corner * g.mu * G) / Math.max(v * v, 4)));
    const ask = THREE.MathUtils.clamp(input.steer, -1, 1), wheel = ask * lock;
    const away = Math.abs(wheel) > Math.abs(this.steerAngle) && wheel * this.steerAngle >= 0;
    const steerRate = away ? this.spec.steerBaseRate + this.spec.steerSpeedRate / (1 + v / this.spec.steerSpeedScale) : this.spec.steerReturnRate;
    this.steerAngle = THREE.MathUtils.clamp(this.steerAngle + THREE.MathUtils.clamp(wheel - this.steerAngle, -steerRate * dt, steerRate * dt), -lock, lock);
    g.turn = vf * Math.tan(this.steerAngle) / this.spec.wheelbase;
    // Along the path: the engine and brakes as in the grip model, less what the slide scrubs off.
    const t = input.throttle, mu = g.mu;
    let a = 0;
    if (t > 0) a += t * Math.min(this.spec.engineAcceleration, this.spec.enginePower / (v + 1), mu * G * this.spec.tractionShare);
    else if (t < 0) a += t * this.spec.brake * mu;
    // The touch speed limit eases the engine off in a slide as on grip.
    if (touchLimit > 0 && t > 0) {
      if (v >= touchLimit - 1) this.#heldTouchSpeedLimit = touchLimit;
      a -= Math.min(Math.max(0, v - touchLimit + 1) * 4, a + LIMIT_BRAKE);
    }
    if (input.handbrake) a -= this.spec.handbrake * mu;
    if (this.towLoad && this.spec.mass) {
      const load = this.towLoad, total = this.spec.mass + load.mass;
      a *= t < 0 || input.handbrake ? (this.spec.mass + load.mass * load.brakeShare) / total : this.spec.mass / (this.spec.mass + load.mass * load.driveMassShare);
    }
    a -= G * Math.sin(slopeF);
    const measured = slideAngle(vf, vl), m = d.step(spec, input, g, measured, dt);
    const aero = this.towLoad && this.spec.mass ? this.spec.aeroDrag * (1 + this.towLoad.dragShare * this.towLoad.mass / this.spec.mass) : this.spec.aeroDrag;
    const drag = surf.roll * G + aero * v * v + (surf === SURFACES.brush ? .9 * v : 0) + deepest * 45 * Math.min(1, v / 3) + wet * PUDDLE_DRAG * v + m.scrub;
    v = Math.max(0, v + (a - drag) * dt);
    // The path turns; the nose leads it by the new slide angle.
    this.heading = this.heading - measured + m.pathRate * dt + m.angle;
    this.slideSpeed.forward = v * Math.cos(m.angle); this.slideSpeed.right = -v * Math.sin(m.angle);
    this.lean.set(a, v * m.pathRate);
    if (deepest > 0.03 && v > 2) this.jolt = Math.max(this.jolt, deepest * 6);
    this.shake = surf.rough * Math.min(v, 20) + this.jolt;
    this.jolt *= Math.max(0, 1 - 9 * dt);
    d.check(spec, v, this.x, this.z);
    return true;
  }

  private bodyLean = new THREE.Vector2();
  private suspension = [0, 0, 0, 0];
  private landingCompression = 0;

  private readonly travelPoint = new THREE.Vector3();
  private readonly travelUp = new THREE.Vector3();
  private travelX=0; private travelZ=0; private travelSin=0; private travelCos=1;
  private travelGround=0; private travelForward=0; private travelRight=0; private travelTwist=0;

  /** The four raw contact heights have already been read by captureGround. No further terrain query is needed. */
  private cacheTravelPlane():void {
    const fl=this.groundContacts[0].height??this.y,fr=this.groundContacts[1].height??this.y;
    const rl=this.groundContacts[2].height??this.y,rr=this.groundContacts[3].height??this.y;
    const front=(fr-fl)/this.spec.track,rear=(rr-rl)/(this.spec.rearTrack??this.spec.track);
    this.travelX=this.x;this.travelZ=this.z;this.travelSin=Math.sin(this.heading);this.travelCos=Math.cos(this.heading);
    this.travelGround=(fl+fr+rl+rr)/4;
    this.travelForward=(fl+fr-rl-rr)/(2*this.spec.wheelbase);
    this.travelRight=(front+rear)/2;this.travelTwist=(front-rear)/this.spec.wheelbase;
  }

  /** Cached bilinear contact patch, solved along root up. Hot path: no arrays, closures, objects or terrain calls. */
  private wheelTravel(x: number, z: number, steer: number): number {
    const radius=this.spec.wheelRadius,root=this.car.root.matrixWorld,up=this.travelUp.set(0,1,0).transformDirection(root);
    const cos=Math.cos(steer),sin=Math.sin(steer),shoulder=Math.max(.04,this.spec.halfWidth-Math.abs(x))*.65;
    const ua=up.x*this.travelSin-up.z*this.travelCos,ub=up.x*this.travelCos+up.z*this.travelSin;
    const point=this.travelPoint;let travel=0;
    for(let pass=0;pass<3;pass++){
      let gap=Infinity,derivative=1;
      for(let side=-1;side<=1;side+=2)for(let j=-3;j<=3;j++){
        const angle=j*Math.PI/6,across=side*shoulder,along=radius*Math.sin(angle);
        point.set(x+across*cos+along*sin,radius-radius*Math.cos(angle),z-across*sin+along*cos).applyMatrix4(root).addScaledVector(up,travel);
        const dx=point.x-this.travelX,dz=point.z-this.travelZ,a=dx*this.travelSin-dz*this.travelCos,b=dx*this.travelCos+dz*this.travelSin;
        const height=this.travelGround+this.travelForward*a+this.travelRight*b+this.travelTwist*a*b;
        const clearance=point.y-height;
        if(clearance<gap){gap=clearance;derivative=up.y-this.travelForward*ua-this.travelRight*ub-this.travelTwist*(ua*b+a*ub);}
      }
      if(Math.abs(gap)<.0001||derivative<=.1)break;
      travel=THREE.MathUtils.clamp(travel-gap/derivative,-.5,.5);
    }
    return travel;
  }

  private sync(dt: number) {
    const c = this.car;
    c.root.position.set(this.x, this.y, this.z);
    c.root.rotation.set(this.pitch, -this.heading, this.roll);
    // The body leans on its springs: back under power, out of a corner.
    const k = Math.min(1, this.spec.leanRate * dt);
    this.bodyLean.x += (THREE.MathUtils.clamp(this.lean.x * this.spec.pitchGain, -this.spec.pitchLimit, this.spec.pitchLimit) - this.bodyLean.x) * k;
    this.bodyLean.y += (THREE.MathUtils.clamp(this.lean.y * this.spec.rollGain, -this.spec.rollLimit, this.spec.rollLimit) - this.bodyLean.y) * k;
    c.body.rotation.set(this.bodyLean.x + (this.random() - 0.5) * this.shake * this.spec.shakePitch, 0, this.bodyLean.y + (this.random() - 0.5) * this.shake * this.spec.shakeRoll);
    c.body.position.y = (this.random() - 0.5) * this.shake * this.spec.shakeHeight;
    c.steer.fl.rotation.y = c.steer.fr.rotation.y = -this.steerAngle;
    c.wheels.fl.rotation.x=-this.spin;c.wheels.fr.rotation.x=-this.spin;
    c.wheels.rl.rotation.x=-this.spin;c.wheels.rr.rotation.x=-this.spin;
    if(c.extraWheels)for(let i=0;i<c.extraWheels.length;i++)c.extraWheels[i].rotation.x=-this.spin;
    if (c.setTravel) {
      // Frame-owned scratch and cached coefficients only; sync creates no arrays or closures and reads no land.
      c.root.updateMatrixWorld(true);
      c.body.position.y -= this.landingCompression;
      c.body.updateMatrix();
      for (let i = 0; i < 4; i++) {
        const a = (i < 2 ? 1 : -1) * this.spec.wheelbase / 2;
        const b = (i % 2 ? 1 : -1) * (i < 2 ? this.spec.track : this.spec.rearTrack ?? this.spec.track) / 2;
        const bodyOffset = this.travelPoint.set(b, 0, -a).applyMatrix4(c.body.matrix).y;
        this.suspension[i] = (this.airborne ? -.18 : this.wheelTravel(b, -a, i < 2 ? -this.steerAngle : 0)) - bodyOffset;
      }
      c.setTravel(this.suspension[0], this.suspension[1], this.suspension[2], this.suspension[3]);
    }
    c.animate?.(dt, this.speed, this.hoofGround, this.terrain.contactRevision);
    if (dt > 0) {
      const hit = this.roads.nearest(this.x, this.z, 14);
      this.roadName = hit ? hit.road.name : null;
    }
  }
}

/** Drives along the nearest road: used for demos and for screenshots of the car in motion. */
/** `toward`: a heading to choose the road's direction by (a turn at a junction); the car's own heading when omitted. */
export function autopilot(v: Vehicle, roads: Roads, cruise = 16, eligible?: (road: Road) => boolean, toward?: number): Input {
  const hit = roads.nearest(v.x, v.z, 40, (r) => r.kind <= 3 && (!eligible || eligible(r)));
  if (!hit) return { throttle: 0, steer: 0, handbrake: false };
  let want = hit.heading;
  // A road line has two directions; take the one closer to where the car points (or to `toward`).
  if (Math.cos(want - (toward ?? v.heading)) < 0) want += Math.PI;
  const err = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
  if (v.towLoad && v.spec.envelope !== CAR_SPEC.envelope) return wideDemo(v, hit, want, cruise);
  // Keep to the right-hand lane: aim a little right of the centre line.
  const rx = Math.cos(want), rz = Math.sin(want);
  const side = (v.x - hit.x) * rx + (v.z - hit.z) * rz - Math.min(hit.road.halfWidth * 0.5, 1.6);
  const steer = THREE.MathUtils.clamp(err * 1.6 - side * 0.12, -1, 1);
  const target = cruise * (1 - 0.6 * Math.min(1, Math.abs(err) * 2));
  return { throttle: THREE.MathUtils.clamp((target - v.speed) * 0.5, -1, 1), steer, handbrake: false };
}
