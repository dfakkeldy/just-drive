import * as THREE from 'three';
import { GARAGE, type GarageEntry } from './garage';
import { DECK_WAIT_SECONDS, Vehicle, nearestDryOnRoad, placementOnSpan, type Input, type VehiclePlacement } from './vehicle';
import { legacyVehicle } from './ride';
import type { Terrain, Site } from './terrain';
import type { Roads } from './roads';
import { Towing } from './towing';
import { TRAILER_SPEC as S, trailerCargo } from './trailer';
import { CAR_SPEC, type Rig, type VehicleSpec } from './vehicle-spec';
import { bodyGap, pushOutBodies, type ContactBody } from './parked';
import { touchesPlayer } from './road-scene-rules';
import { FleetSupport, type FleetPose, type Ground } from './fleet-support';
import { WATER_COVER_CLASS, isDryGround, localGroundSlope } from './water-bounds';
import { movement as fleetMove, teleport, boxTouchesBody, type TeleportKind, type BodySweep, type GateSweep, type SweepPose } from './fleet-motion';
import { FleetSurface } from './fleet-surface';
import { checkpoint, reusableCheckpoint } from './fleet-checkpoint';
import { fleetDisplay } from './fleet-models';
import type { WorldContacts } from './world-contacts';
import type { Bike } from './bike';

// Explore pickup/trailer only. Controllers always own their normal mode rig; cached display rigs never drive.
// Only DRIVEN receives physics. Parked poses and tyre support sleep until a terrain notification.
// main.ts supplies the shared area contact registry; new sites register there, never in this module.
// All physical moves use movement(); only R, start-over, place jumps and new visits use teleport().
// Loading preflights every pose. Abort follows checked history, or holds the rig if its return is blocked.

export type FleetId = 'truck' | 'sxs' | 'bike';
export type FleetState = 'DRIVEN' | 'PARKED' | 'STRAPPED' | 'MOVING';
export interface FleetMember {
  id: FleetId; entry: GarageEntry; rig: Rig; vehicle: Vehicle; state: FleetState;
  support: FleetSupport | null; pose: FleetPose | null; dirty: boolean;
  needsSettling?: boolean;
  displayBones?: [THREE.Bone, THREE.Bone][];
  light: Rig; shown: Rig; lightPose?: FleetPose | null; lightState?: FleetState; lightParent?: THREE.Object3D | null;
}
export interface FleetAction { kind: 'drive' | 'unload' | 'load' | 'park'; id: FleetId; label: string; reason: string }
interface Move { member: FleetMember; frames: FleetPose[]; duration: number; end: 'PARKED' | 'STRAPPED' }
type Snapshot = Saved[] & { world: Map<FleetMember, SweepPose>; gatePose: number[]; supportRevision: number; trailerWorld: SweepPose; trailerMatrix: THREE.Matrix4; presentation(): void; rollback(publish?: boolean): void };
interface Plan { abortReason?: string; history: { member: FleetMember; from: SweepPose; to: SweepPose }[]; moves: Move[]; saved: Snapshot; elapsed: number; index: number; gateTime: number; after: FleetMember; restoreOnAbort?: () => void; onSettled?: (ok: boolean, reason?: string) => void }
interface Saved { member: FleetMember; dirty: boolean; needsSettling?: boolean; state: FleetState; pose: FleetPose | null; body: ContactBody & { pitch: number; roll: number }; parent: THREE.Object3D | null; position: THREE.Vector3; quaternion: THREE.Quaternion }
const STEP = 1 / 120, wrap = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
const FOOT = 4.15, ZONE = 6.8;
const trailerSpec: VehicleSpec = { ...CAR_SPEC, halfLength: S.halfLength, halfWidth: S.halfWidth, height: 2.5, envelope: S.envelope };

/** The sole owner of world rigs. Only driven.vehicle receives fixed physics steps. */
export class Fleet {
  readonly members: FleetMember[];
  driven: FleetMember;
  readonly actions: FleetAction[] = [];
  actionIndex = 0;
  message = '';
  verifyTransitions = !!import.meta.env?.DEV;
  handbrake = true;
  gates = 0;
  readonly gateAngles = [0, 0];
  readonly zone = new THREE.Group();
  private plan: Plan | null = null;
  releaseInput: (() => void) | null = null;
  private switching = 0;
  private switchTo: FleetMember | null = null;
  private switchCameraReady = false;
  private readonly switchEyeFrom = new THREE.Vector3();
  private readonly switchEyeTo = new THREE.Vector3();
  private readonly switchRotationFrom = new THREE.Quaternion();
  private readonly switchRotationTo = new THREE.Quaternion();
  private switchFovFrom = 58;
  private switchFovTo = 58;
  private acc = 0;
  private promptTime = 0;
  private rampDirty = true;
  private gatesDirty = true;
  private gatesNeedSettling = false;
  private contactRevision = -1;
  private readonly bodyStamp: number[] = [];
  private bodyAt = 0;
  private bodiesChanged = false;
  private stampBody(value: number): void {
    const old = this.bodyStamp[this.bodyAt];
    if (old === undefined || Math.abs(old - value) > 1e-7) { this.bodyStamp[this.bodyAt] = value; this.bodiesChanged = true; }
    this.bodyAt++;
  }
  /** Changes to fleet solids wake blocked fits, without stepping or querying a parked controller. */
  private refreshBodyChanges(): void {
    this.bodyAt = 0; this.bodiesChanged = false;
    for (const m of this.members) { const v = m.vehicle;
      this.stampBody(v.x); this.stampBody(v.y); this.stampBody(v.z);
      this.stampBody(v.heading); this.stampBody(v.pitch); this.stampBody(v.roll); this.stampBody(m.state === 'STRAPPED' ? 0 : 1);
    }
    const membersChanged = this.bodiesChanged; this.bodiesChanged = false;
    this.stampBody(this.tow.x); this.stampBody(this.tow.y); this.stampBody(this.tow.z);
    this.stampBody(this.tow.heading); this.stampBody(this.tow.pitch); this.stampBody(this.tow.roll);
    for (const gate of this.tow.trailer.ramps) this.stampBody(gate.rotation.x);
    if (this.bodiesChanged) { this.actualSurface = null; this.surfaceDirty = true; }
    if ((this.bodiesChanged || membersChanged) && this.needsSettling) this.solidsChanged();
  }
  private readonly trailerSupport: FleetSupport;
  private readonly nativePlace = new Map<Vehicle, (x: number, z: number, heading: number, referenceY?: number) => boolean>();
  private teleportTrial = false;
  private readonly nativeRespawn = new Map<Vehicle, () => void>();
  teleportAttempts = 0;
  private visitPending: VehiclePlacement | null = null;
  private visitAccepts: ((pose: VehiclePlacement) => boolean) | undefined;
  private visitCommit: (() => void) | undefined;
  private visitKind: 'new-visit' | 'start-over' | 'place-jump' = 'new-visit';
  private deckWaiting = false;
  private deckWait = 0;
  private spanWaitExhausted = false;
  private allowSpanWait = true;
  private deckWaitCount = 0;
  /** A cold-start request remains queued until its checked placement can finish. */
  get visitQueued(): boolean { return this.visitPending !== null; }
  /** True while waiting on an unbuilt modern bridge span's deck (may be cancelled with R when spawned). */
  get waitingForDeck(): boolean { return this.deckWaiting && this.visitPending !== null; }
  /** Monotonic counter incremented only when a start/restart newly enters an unbuilt-span deck wait. */
  get deckWaitToken(): number { return this.deckWaitCount; }
  private visitDirty = false;
  private spawned = false;
  private readonly physicsFrames = new Map<Vehicle, () => () => void>();
  private rampReason = '';
  private readonly rampProbes: ContactBody[] = [];
  private readonly gateSamples: { x: number; z: number; height: number }[] = [];
  private scriptGroundDirty = false;
  private supportRevision = 0;
  private returnHeld = false;
  private folding = false;
  private lowering = false;
  private zoneReady = false;
  private previousThrottle = 0;
  private reversing = false;
  private readonly parked: ContactBody[] = [];
  private readonly obstacles: ContactBody[] = [];
  private readonly worldBodies: ContactBody[] = [];
  private readonly worldBodiesProvider = () => {
    this.worldBodies.length = 0;
    if (!this.spawned) return this.worldBodies;
    this.worldBodies.push(this.truck, this.trailerPose());
    for (const m of this.members) if (m.id !== 'truck' && m.state !== 'STRAPPED') this.worldBodies.push(m.vehicle);
    return this.worldBodies;
  };
  private readonly trailerBody: ContactBody = { x: 0, z: 0, y: 0, heading: 0, spec: trailerSpec };
  private safe = { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0 };
  private lastTowX = NaN; private lastTowZ = NaN; private lastTowHeading = NaN;
  private readonly local = new THREE.Vector3();
  private readonly world = new THREE.Vector3();
  private readonly inverse = new THREE.Matrix4();
  private readonly displayInverse = new THREE.Matrix4();
  private readonly displayMatrix = new THREE.Matrix4();
  private readonly displayPoint = new THREE.Vector3();
  private readonly stoppedInput: Input = { throttle: 0, steer: 0, handbrake: true };
  private readonly parkedProvider = () => this.parked;
  private readonly groundPoint = { y: 0 };
  private gx = 0; private gz = 0;
  private readonly readGround = () => {
    // The reference is the 1e6 contact height: any site deck counts, as on main (no overpass rule here yet).
    const ground = this.terrain.heightAt(this.gx, this.gz, this.groundPoint.y), deck = this.roads.deckHeight(this.gx, this.gz);
    return ground === null ? null : deck === null ? ground : Math.max(ground, deck);
  };
  readonly ground: Ground = (x, z) => {
    this.gx = x; this.gz = z; this.groundPoint.y = 1e6;
    return this.terrain.withGroundContact(this.groundPoint, this.readGround, true);
  };
  /** A fleet placement stands where fleet ground does (the topmost deck, as on main), so it passes that height on. */
  private reference(x: number, z: number): number | undefined { return this.ground(x, z) ?? undefined; }
  private readonly changed = (x: number, z: number, size: number) => {
    this.supportRevision++;
    if (this.visitPending && this.visitPending.x + 150 >= x && this.visitPending.x - 150 <= x + size && this.visitPending.z + 150 >= z && this.visitPending.z - 150 <= z + size) this.visitDirty = true;
    for (const m of this.members) if (m.state === 'PARKED') {
      for (const wheel of Object.values(m.rig.wheels)) {
        const p = this.world.setFromMatrixPosition(wheel.matrixWorld), r = m.entry.spec.wheelRadius;
        if (p.x + r >= x && p.x - r <= x + size && p.z + r >= z && p.z - r <= z + size) m.dirty = true;
      }
      if (m.id === 'truck') for (const p of this.tow.contacts)
        if (p.x + .4 >= x && p.x - .4 <= x + size && p.z + .4 >= z && p.z - .4 <= z + size) m.dirty = true;
    }
    if (this.tow.x + 15 >= x && this.tow.x - 15 <= x + size && this.tow.z + 15 >= z && this.tow.z - 15 <= z + size) {
      this.rampDirty = this.gatesDirty = true; this.zoneReady = false; if (this.plan) this.scriptGroundDirty = true;
    }
  };

  constructor(readonly truck: Vehicle, readonly tow: Towing, readonly terrain: Terrain, readonly roads: Roads,
    readonly scene: THREE.Scene, readonly low: boolean, private readonly select: (member: FleetMember) => void,
    readonly seaLevel = -.2, readonly contacts?: WorldContacts, deferVisit = false) {
    const truckMember: FleetMember = { id: 'truck', entry: GARAGE.find(e => e.id === 'truck')!, rig: truck.car, vehicle: truck,
      state: 'DRIVEN', support: new FleetSupport(truck.car, truck.spec), pose: null, dirty: false, light: fleetDisplay('truck'), shown: truck.car };
    this.members = [truckMember]; this.driven = truckMember;
    const trailer = tow.trailer;
    const fixed = new THREE.Group();
    this.trailerSupport = new FleetSupport({ root: trailer.root, body: fixed,
      wheels: { fl: trailer.wheels[0], fr: trailer.wheels[1], rl: trailer.wheels[2], rr: trailer.wheels[3] },
      steer: { fl: fixed, fr: fixed }, driverEye: new THREE.Object3D(), brakeLights: [] },
      { ...trailerSpec, wheelRadius: S.wheelRadius });
    // Empty means genuinely empty: no invisible cargo or extra controllers are constructed.
    if (tow.loaded) {
      const cargo = trailer.cargo ?? (trailer.cargo = trailerCargo(trailer.mounts, low));
      for (const id of ['sxs', 'bike'] as const) {
        const entry = GARAGE.find(e => e.id === id)!, rig = cargo[id];
        const vehicle = entry.ride ? legacyVehicle(entry.ride(rig, terrain, roads, seaLevel, entry.spec)) : new Vehicle(rig, terrain, roads, seaLevel, entry.spec);
        vehicle.bounds = truck.bounds; vehicle.desktopPull = truck.desktopPull;
        const light = fleetDisplay(id), displayBones = id === 'bike' ? (light as Bike).bikeMesh.skeleton.bones.map(to => {
          const from = (rig as Bike).bikeMesh.skeleton.bones.find(b => b.name === to.name);
          if (!from) throw new Error('Missing parked bike bone');
          return [from, to] as [THREE.Bone, THREE.Bone];
        }) : undefined;
        this.members.push({ id, entry, rig, vehicle, state: 'STRAPPED', support: new FleetSupport(rig, entry.spec), pose: null, dirty: false, light, displayBones, shown: rig });
      }
    }
    tow.world.parked = this.parkedProvider;
    if (tow.world.yard) tow.world.yard.coupledBodies = this.worldBodiesProvider;
    for (const member of this.members) {
      const place = member.vehicle.place.bind(member.vehicle); this.nativePlace.set(member.vehicle, place);
      member.vehicle.place = (x, z, heading, referenceY) => { return this.teleportTrial ? place(x, z, heading, referenceY ?? this.reference(x, z)) : this.placeMovement(member, x, z, heading); };
      this.nativeRespawn.set(member.vehicle, member.vehicle.respawn.bind(member.vehicle));
      member.vehicle.respawn = () => {
        member.vehicle.stopInWater();
        this.message = 'Use R or RESET to recover this vehicle';
      };
      const prior = member.vehicle.placementGuard;
      member.vehicle.placementGuard = pose => {
        if (prior && !prior(pose)) return false;
        const original = { ...pose };
        for (let distance = 0; distance <= 100; distance += 2) for (const side of [1, -1]) {
          pose.x = original.x + Math.sin(original.heading) * distance * side;
          pose.z = original.z - Math.cos(original.heading) * distance * side;
          if (member.id === 'truck' && prior && !prior(pose)) continue;
          const y = this.ground(pose.x, pose.z);
          if (this.clear({ ...pose, y: y ?? member.vehicle.y, spec: member.entry.spec }, member, this.bodiesExcept(member))) return true;
        }
        Object.assign(pose, original); this.message = 'No clear road position near the parked vehicles'; return false;
      };
      this.contacts?.bindVehicle?.(member.vehicle);
    }
    terrain.fleetGroundChanged = this.changed;
    const paint = new THREE.MeshBasicMaterial({ color: 0xf4be79, side: THREE.DoubleSide, depthWrite: false });
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(.06, 3.2).rotateX(-Math.PI / 2), paint); bar.position.x = side * 1.05; this.zone.add(bar);
      for (const end of [-1, 1]) { const cap = new THREE.Mesh(new THREE.PlaneGeometry(.7, .06).rotateX(-Math.PI / 2), paint); cap.position.set(side * .73, 0, end * 1.6); this.zone.add(cap); }
    }
    this.zone.name = 'Trailer loading zone'; this.zone.renderOrder = 1; this.zone.visible = false; scene.add(this.zone);
    for (const m of this.members) this.physicsFrames.set(m.vehicle, reusableCheckpoint(m.id === 'truck' ? [m.vehicle, this.tow] : [m.vehicle], m.id === 'truck' ? [m.rig.root, this.tow.trailer.root] : [m.rig.root], m.id === 'truck' ? this.members.filter(other => other !== m).flatMap(other => [other.rig.root, other.light.root]) : []));
    this.cacheSafe(); this.refreshBodies(); this.mass(); this.message = 'Handbrake on';
    this.contactRevision = contacts?.revision ?? 0;
    const start = { x: truck.x, z: truck.z, heading: truck.heading };
    if (deferVisit) this.visitPending = start; else this.initializeVisit(start);
  }

  /** Render-only selection. Pose copies occur on state/support changes, not on sleeping frames. */
  draw(camera: THREE.Vector3): void {
    if (!this.spawned) { for (const m of this.members) { m.rig.root.visible = m.light.root.visible = false; } this.tow.trailer.root.visible = false; return; }
    for (const m of this.members) {
      const r = m.rig.root, light = m.light.root;
      if (m.state === 'STRAPPED') r.getWorldPosition(this.displayPoint); else this.displayPoint.set(m.vehicle.x, m.vehicle.y, m.vehicle.z);
      const useLight = m.state !== 'DRIVEN' && (this.low || this.displayPoint.distanceToSquared(camera) > 60 * 60);
      r.visible = !useLight; light.visible = useLight; m.shown = useLight ? m.light : m.rig;
      if (!useLight) continue;
      if (m.lightParent !== r.parent || m.lightState !== m.state || m.lightPose !== m.pose) {
        r.parent?.add(light); light.position.copy(r.position); light.quaternion.copy(r.quaternion); light.scale.copy(r.scale);
        m.light.body.position.copy(m.rig.body.position); m.light.body.quaternion.copy(m.rig.body.quaternion);
        if (m.id === 'bike') {
          const from = (m.rig as Bike).bikeMesh, to = (m.light as Bike).bikeMesh;
          to.position.copy(from.position); to.quaternion.copy(from.quaternion); to.scale.copy(from.scale);
          for (const [source, target] of m.displayBones!) {
            target.position.copy(source.position); target.quaternion.copy(source.quaternion); target.scale.copy(source.scale);
          }
        } else {
          r.updateWorldMatrix(true, true); this.displayInverse.copy(r.matrixWorld).invert();
          const source = [m.rig.wheels.fl, m.rig.wheels.fr, m.rig.wheels.rl, m.rig.wheels.rr, ...(m.rig.extraWheels ?? [])];
          const target = [m.light.wheels.fl, m.light.wheels.fr, m.light.wheels.rl, m.light.wheels.rr, ...(m.light.extraWheels ?? [])];
          for (let i = 0; i < source.length; i++) {
            this.displayMatrix.multiplyMatrices(this.displayInverse, source[i].matrixWorld);
            this.displayMatrix.decompose(target[i].position, target[i].quaternion, target[i].scale);
          }
        }
        light.updateMatrixWorld(true);
        if (m.id === 'bike') { const mesh = (m.light as Bike).bikeMesh; mesh.skeleton.update(); mesh.computeBoundingSphere(); }
        m.lightParent = r.parent; m.lightState = m.state; m.lightPose = m.pose;
      }
    }
  }

  get needsSettling(): boolean { return this.gatesNeedSettling || this.members.some(m => m.needsSettling); }
  get busy(): boolean { return !!this.visitPending || !!this.plan || this.switching > 0 || this.folding || this.lowering; }
  get stage(): string { return this.plan ? this.plan.gateTime < 1 ? 'gates' : `${this.plan.moves[this.plan.index]?.end === 'STRAPPED' ? 'loading' : 'unloading'}-${this.plan.moves[this.plan.index]?.member.id}` : this.switching ? 'switching' : this.folding ? 'folding' : this.lowering ? 'gates' : 'idle'; }
  get action(): FleetAction | undefined { return this.actions[this.actionIndex % Math.max(1, this.actions.length)]; }
  refreshChoices(): void { this.promptTime = 0; this.refresh(0, false); }
  nextAction(): void { this.refreshChoices(); if (this.actions.length > 1 && !this.busy) this.actionIndex = (this.actionIndex + 1) % this.actions.length; }
  private cacheSafe(): void {
    const v = this.driven.vehicle; this.safe.x = v.x; this.safe.z = v.z; this.safe.y = v.y; this.safe.heading = v.heading; this.safe.pitch = v.pitch; this.safe.roll = v.roll;
  }
  private trailerPose(): ContactBody {
    const p = this.trailerBody;
    p.x = this.tow.x - Math.sin(this.tow.heading) * S.bodyOffset; p.z = this.tow.z + Math.cos(this.tow.heading) * S.bodyOffset;
    p.y = this.tow.y; p.heading = this.tow.heading; return p;
  }
  private refreshBodies(): void {
    this.parked.length = 0;
    for (const m of this.members) if (m.state === 'PARKED' && m.id !== 'truck') this.parked.push(m.vehicle);
  }
  private bodiesExcept(member: FleetMember): ContactBody[] {
    const bodies: ContactBody[] = [];
    for (const m of this.members) if (m !== member && (m.state === 'PARKED' || m.state === 'DRIVEN')) bodies.push(m.vehicle);
    if (member.id !== 'truck') bodies.push({ ...this.trailerPose() });
    return bodies;
  }
  private clear(p: ContactBody, member: FleetMember, others: readonly ContactBody[], trailer = true): boolean {
    if (this.contacts && !this.contacts.allows(p)) return false;
    const b = this.truck.bounds, env = p.spec.envelope;
    if (b && (p.x - env.reach < b[0] || p.x + env.reach > b[2] || p.z - env.reach < b[1] || p.z + env.reach > b[3])) return false;
    if (this.tow.world.yard?.allowsBody(p, p.spec, p.y) === false) return false;
    if (this.tow.world.scene?.rules.enabled) for (const s of this.tow.world.scene.placementSolids) if (touchesPlayer(s, p, 0, p.spec)) return false;
    for (const other of others) if ((trailer || other.spec !== trailerSpec) && bodyGap(p, other) < -1e-6) return false;
    return member.id !== 'truck' || this.tow.attached;
  }
  /** Runs inside the existing 120 Hz contact callback. A failed projection restores the last clear pose. */
  resolve(): void {
    if (this.driven.id === 'truck') { this.tow.step(); this.cacheSafe(); return; }
    const v = this.driven.vehicle;
    this.obstacles.length = 0;
    for (const m of this.members) if (m !== this.driven && m.state === 'PARKED') this.obstacles.push(m.vehicle);
    this.obstacles.push(this.trailerPose());
    for (let pass = 0; pass < 8; pass++) {
      pushOutBodies(v, this.obstacles); this.contacts?.resolve(v); this.tow.world.yard?.resolveTowBody(v);
      if (this.clear(v, this.driven, this.obstacles)) { this.cacheSafe(); return; }
    }
    Object.assign(v, this.safe); v.vx = v.vz = v.vy = v.speed = 0;
  }
  drive(dt: number, input: Input, afterStep: () => void): void {
    if (this.visitPending) return;
    if (this.busy) { this.advance(dt); return; }
    const v = this.driven.vehicle;
    if (this.driven.id === 'truck') {
      const wasBrake = this.handbrake;
      if (input.throttle >= 0) this.reversing = false;
      else if (this.previousThrottle >= 0 && Math.abs(v.speed) < .12) this.reversing = true;
      if (input.handbrake) this.handbrake = true;
      else if (input.throttle < 0 && Math.abs(v.speed) < .12) this.handbrake = !this.reversing;
      this.previousThrottle = input.throttle;
      if (input.throttle > 0 || input.throttle < 0 && !this.handbrake) {
        if (this.gates > 0) { this.handbrake = true; const reason = this.gateClear(0, this.gates, () => { this.folding = true; this.message = 'Folding ramps'; this.advance(dt, true); }); if (reason) this.message = reason; return; }
        this.handbrake = false;
      }
      if (wasBrake !== this.handbrake) { this.promptTime = 0; this.rampDirty = true; this.message = this.handbrake ? 'Handbrake on' : `Driving: ${this.driven.entry.name}`; }
      this.stoppedInput.throttle = this.handbrake ? 0 : input.throttle;
      this.stoppedInput.steer = this.handbrake ? 0 : input.steer;
      this.stoppedInput.handbrake = this.handbrake || input.handbrake; this.stoppedInput.touch = input.touch; this.stoppedInput.held = input.held;   // an animal stop stays one (drift-rules)
      input = this.stoppedInput;
    }
    const m = this.driven, before = this.physicsFrames.get(v)!(), undoModel = m.rig.checkpointPose?.();
    const trace: BodySweep[] = [], gates: GateSweep[] = [], others = this.bodiesExcept(m), rootBefore = this.memberPose(m);
    let previous: SweepPose = { x: v.x, y: v.y, z: v.z, heading: v.heading, pitch: v.pitch, roll: v.roll, spec: m.entry.spec };
    let previousTow: SweepPose = { ...this.trailerPose(), pitch: this.tow.pitch, roll: this.tow.roll };
    let parent = this.tow.trailer.root.matrixWorld.clone();
    const record = () => {
      const pose = { x: v.x, y: v.y, z: v.z, heading: v.heading, pitch: v.pitch, roll: v.roll, spec: m.entry.spec };
      trace.push({ from: previous, to: pose, clear: p => this.clear(p, m, others) }); previous = pose;
      if (m.id === 'truck') { const pose = { ...this.trailerPose(), pitch: this.tow.pitch, roll: this.tow.roll }; trace.push({ from: previousTow, to: pose, clear: p => this.clear(p, m, others) }); previousTow = pose;
        const target = new THREE.Matrix4().compose(new THREE.Vector3(this.tow.x,this.tow.y,this.tow.z),new THREE.Quaternion().setFromEuler(new THREE.Euler(this.tow.pitch,-this.tow.heading,this.tow.roll,'YXZ')),this.tow.trailer.root.scale);
        for (const root of this.tow.trailer.ramps) gates.push({root,from:root.rotation.x,to:root.rotation.x,parentFrom:parent,parentTo:target}); parent=target;
      }
    };
    const reason = fleetMove({ rollback: () => { before(); undoModel?.(); if (m.id === 'truck') this.writeGates(); v.vx = v.vz = v.vy = v.speed = 0; this.cacheSafe(); }, propose: () => {
      this.withRampContact(() => v.update(dt, input, () => { afterStep(); record(); }));
      if (m.id === 'truck') this.tow.update(); record();
      if (m.id !== 'truck' && this.gates === 1) trace.push({ from: rootBefore, to: this.memberPose(m), clear: () => true, geometry: p => !this.rampsBlock(m,p) });
      return { bodies: trace, gates, contacts: this.contacts, obstacles: this.gateBodies().filter(p=>p.spec!==m.entry.spec), commit: () => this.cacheSafe() };
    } });
    if (reason) { this.message = reason; return; }
    if (this.driven.id === 'truck') {
      if (this.tow.x !== this.lastTowX || this.tow.z !== this.lastTowZ || this.tow.heading !== this.lastTowHeading) {
        this.rampDirty = this.surfaceDirty = true; this.actualSurface = null; this.zoneReady = false; this.lastTowX = this.tow.x; this.lastTowZ = this.tow.z; this.lastTowHeading = this.tow.heading;
      }
    }
  }

  private gateBodies(): ContactBody[] {
    return this.members.filter(m => m.state !== 'STRAPPED').map(m => ({ ...this.memberPose(m), label: m.entry.name.toLowerCase() }));
  }
  /** The central boundary owns both preflight and commit; callers cannot publish a gate pose first. */
  private gateClear(from = 0, to = 1, commit: () => void = () => {}): string {
    return fleetMove({ gates: this.tow.trailer.ramps.map((root, i) => ({ root, from: from * this.gateAngles[i], to: to * this.gateAngles[i] })),
      contacts: this.contacts, obstacles: this.gateBodies(), commit });
  }
  private memberPose(m: FleetMember): SweepPose {
    const p = m.rig.root.getWorldPosition(new THREE.Vector3());
    const quaternion = m.rig.root.getWorldQuaternion(new THREE.Quaternion()), e = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    return { x: p.x, y: p.y - (m.id === 'bike' ? m.entry.spec.wheelRadius : 0), z: p.z,
      heading: -e.y, pitch: e.x, roll: e.z, quaternion, spec: m.entry.spec };
  }
  private poseMatrix(m: FleetMember, p: SweepPose): THREE.Matrix4 {
    return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + (m.id === 'bike' ? m.entry.spec.wheelRadius : 0), p.z),
      p.quaternion ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch ?? 0, -p.heading, p.roll ?? 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
  }
  private bodySweep(m: FleetMember, pose: FleetPose, deck = false, others = this.bodiesExcept(m)): BodySweep {
    return { from: this.memberPose(m), to: { ...pose, spec: m.entry.spec },
      clear: p => this.clear(p, m, others, !deck),
      geometry: deck && this.surface ? p => !this.surface!.crosses(m.rig, this.poseMatrix(m, p)) : m.id !== 'truck' ? p => !this.rampsBlock(m, p) : undefined };
  }
  private pathGround(pose: FleetPose, spec: VehicleSpec): string {
    const fx = Math.sin(pose.heading), fz = -Math.cos(pose.heading), rx = Math.cos(pose.heading), rz = Math.sin(pose.heading);
    for (const along of [-spec.halfLength, 0, spec.halfLength]) for (const side of [-spec.halfWidth, 0, spec.halfWidth]) {
      const x = pose.x + fx * along + rx * side, z = pose.z + fz * along + rz * side;
      const local = new THREE.Vector3(x, this.tow.y, z).applyMatrix4(this.inverse);
      if (Math.abs(local.x) <= 1.2 && local.z <= FOOT + .05) continue;
      const h = this.ground(x, z); if (h === null) return 'Ground is still loading';
      if (h <= this.seaLevel + .08) return 'Water on the loading path';
      const front = this.ground(x + fx * .25, z + fz * .25), back = this.ground(x - fx * .25, z - fz * .25);
      const left = this.ground(x - rx * .25, z - rz * .25), right = this.ground(x + rx * .25, z + rz * .25);
      if (front === null || back === null || left === null || right === null) return 'Ground is still loading';
      if (Math.max(Math.abs(front - back), Math.abs(left - right)) > .35) return 'A drop on the loading path';
      if (Math.abs(front - back) / .5 > Math.tan(Math.PI / 15) || Math.abs(left - right) / .5 > Math.tan(8 * Math.PI / 180)) return 'Too steep to unload here';
    }
    return '';
  }
  private mass(): void {
    if (this.truck.towLoad) this.truck.towLoad.mass = S.mass + this.members.reduce((sum, m) => sum + (m.state === 'STRAPPED' ? m.entry.spec.mass ?? 0 : 0), 0);
  }
  private point(x: number, z: number): THREE.Vector3 {
    this.world.set(x, 0, z).applyMatrix4(this.tow.trailer.root.matrixWorld); return this.world;
  }
  private localPoint(x: number, z: number): THREE.Vector3 { return this.local.set(x, this.tow.y, z).applyMatrix4(this.inverse); }
  private pathPoint(x: number, z: number, member: FleetMember): THREE.Vector3 {
    const e = this.tow.trailer.root.matrixWorld.elements, h = S.deckHeight + (member.id === 'bike' ? member.entry.spec.wheelRadius : 0);
    const dx = x - e[12] - e[4] * h, dz = z - e[14] - e[6] * h, determinant = e[0] * e[10] - e[8] * e[2];
    return this.local.set((dx * e[10] - dz * e[8]) / determinant, h, (e[0] * dz - e[2] * dx) / determinant);
  }
  private stopped(): boolean { return Math.max(Math.abs(this.truck.speed), Math.hypot(this.truck.vx, this.truck.vz)) < .15 && !this.truck.airborne; }
  private blockedRamp(): string {
    for (const probe of this.rampProbes) if (!this.clear(probe, this.driven, this.parked)) return 'Something blocks the ramps';
    return '';
  }
  private site(): string {
    if (!this.rampDirty) return this.rampReason || this.blockedRamp();
    this.rampDirty = false; this.tow.trailer.root.updateMatrixWorld(true); this.inverse.copy(this.tow.trailer.root.matrixWorld).invert();
    const blocked = (reason: string) => this.rampReason = reason;
    if (!this.stopped()) return blocked('Stop the pickup to unload');
    if (!this.handbrake) return blocked('Set the pickup handbrake first');
    this.rampProbes.length = 0;
    this.gateSamples.length = 0;
    const samples: number[][] = [];
    for (let z = 3; z <= 12; z += .5) {
      const row: number[] = [];
      for (const x of [-1.2, 0, 1.2]) {
        const p = this.point(x, z), h = this.ground(p.x, p.z);
        if (h === null) return blocked('Ground is still loading');
        if (h <= this.seaLevel + .08) return blocked('Water behind the trailer');
        const probe: ContactBody = { x: p.x, z: p.z, y: h, heading: this.tow.heading,
          spec: { ...CAR_SPEC, envelope: { ...CAR_SPEC.envelope, circles: [0], radius: .28, reach: .3 } } };
        this.rampProbes.push(probe);
        row.push(h);
      }
      samples.push(row);
    }
    for (let j = 0; j < samples.length; j++) {
      const row = samples[j];
      if (Math.abs(row[2] - row[0]) / 2.4 > Math.tan(8 * Math.PI / 180)) return blocked('Too steep to unload here');
      if (j) for (let i = 0; i < 3; i++) {
        const change = Math.abs(row[i] - samples[j - 1][i]);
        if (change > .35) return blocked('A drop behind the trailer');
        if (change / .5 > Math.tan(12 * Math.PI / 180)) return blocked('Too steep to unload here');
      }
    }
    const gateReason = this.fitGates(); blocked(gateReason); return gateReason || this.blockedRamp();
  }
  private fitGates(): string {
    this.gatesDirty = false;
    const angles = [0, 0], samples: typeof this.gateSamples = [];
    const reason = fleetMove({ roots: this.tow.trailer.ramps, query: () => {
    // Solve each gate's actual foot against the drawn ground, with the gate thickness included.
    for (let i = 0; i < 2; i++) {
      const ramp = this.tow.trailer.ramps[i], original = ramp.rotation.x;
      let lo = Math.PI / 2, hi = Math.PI * .87;
      for (let pass = 0; pass < 24; pass++) {
        const angle = (lo + hi) / 2; ramp.rotation.x = angle; ramp.updateWorldMatrix(true, false);
        let clearance = Infinity;
        for (const x of [-.51, 0, .51]) {
          const foot = new THREE.Vector3(x, 1.28, .05).applyMatrix4(ramp.matrixWorld), h = this.ground(foot.x, foot.z);
          if (h === null) { ramp.rotation.x = original; return 'Ground is still loading'; }
          clearance = Math.min(clearance, foot.y - h);
        }
        if (clearance > 0) lo = angle; else hi = angle;
      }
      angles[i] = (lo + hi) / 2;
      ramp.rotation.x = angles[i]; ramp.updateWorldMatrix(true, false);
      for (const x of [-.51, 0, .51]) {
        const foot = new THREE.Vector3(x, 1.28, .05).applyMatrix4(ramp.matrixWorld);
        samples.push({ x: foot.x, z: foot.z, height: this.ground(foot.x, foot.z)! });
      }
      ramp.rotation.x = original;
      if (angles[i] > Math.PI * .78) return 'Ramps cannot reach the ground';
    }
      return '';
    } });
    if (reason) { this.gatesNeedSettling = true; return reason; }
    const blocked = fleetMove({ gates: this.tow.trailer.ramps.map((root, i) => ({ root, from: root.rotation.x, to: angles[i] * this.gates })),
      contacts: this.contacts, obstacles: this.gateBodies(), commit: () => {
        this.gateAngles[0] = angles[0]; this.gateAngles[1] = angles[1]; this.gateSamples.length = 0; this.gateSamples.push(...samples);
        this.gatesNeedSettling = false; this.writeGates();
      } });
    if (blocked) this.gatesNeedSettling = true;
    return blocked;
  }
  private surface: FleetSurface | null = null;
  private actualSurface: FleetSurface | null = null;
  private surfaceDirty = true;
  private readonly rampDeck: Site = {
    box: [-Infinity, -Infinity, Infinity, Infinity], height: (_x, _z, h) => h, surface: () => null,
    deckDriving: { kind: 9, halfWidth: 1.1 },
    deckHeight: (x, z) => { const h = this.surface?.height(x, z); return h !== undefined && Number.isFinite(h) ? h : null; },
  };
  /** Trailer meshes supply wheel contact only during a driven rig's synchronous physics query. */
  private withRampContact<T>(read: () => T): T {
    if (this.driven.id === 'truck' || this.gates !== 1) return read();
    if (this.surfaceDirty) this.prepareSurface();
    const sites = this.terrain.sites, added = !sites.includes(this.rampDeck);
    if (added) sites.push(this.rampDeck);
    try { return read(); } finally { if (added) sites.splice(sites.indexOf(this.rampDeck), 1); }
  }
  private rampGround: Ground = (x, z) => {
    const h = this.ground(x, z); if (h === null) return null;
    return Math.max(h, this.surface?.height(x, z) ?? -Infinity);
  };
  private prepareSurface(): void {
    const trailer = this.tow.trailer;
    this.surface = fleetMove({ roots: trailer.ramps, query: () => {
      for (let i = 0; i < trailer.ramps.length; i++) trailer.ramps[i].rotation.x = this.gateAngles[i];
      trailer.root.updateWorldMatrix(true, true);
      return new FleetSurface(trailer.root.children.filter(n => n instanceof THREE.Mesh || trailer.ramps.includes(n as THREE.Group)));
    } });
    this.surfaceDirty = false;
  }

  /** Site owners invalidate the shared registry after moving/removing a solid. */
  solidsChanged(): void {
    for (const m of this.members) if (m.needsSettling) m.dirty = true;
    if (this.gatesNeedSettling) this.gatesDirty = true;
    this.rampDirty = true; this.promptTime = 0; this.visitDirty = !!this.visitPending;
    if (this.plan) this.scriptGroundDirty = true;
  }
  refresh(dt = 0, automatic = true): void {
    try { this.refreshState(dt, automatic); } finally { this.checkedTransition(); }
  }
  private refreshState(dt: number, automatic: boolean): void {
    this.refreshBodyChanges();
    const revision = this.contacts?.revision ?? 0;
    if (revision !== this.contactRevision) { this.contactRevision = revision; this.solidsChanged(); }
    if (this.visitPending) {
      if (this.deckWaiting) {
        if (Number.isFinite(dt) && dt > 0) this.deckWait += Math.min(dt, 0.1);
        const p = this.visitPending, accepts = this.visitAccepts, kind = this.visitKind, onCommit = this.visitCommit;
        const built = this.roads.deckHeight(p.x, p.z) !== null;
        if (built || this.deckWait >= DECK_WAIT_SECONDS) {
          this.visitPending = null; this.visitAccepts = undefined; this.visitCommit = undefined; this.visitDirty = false;
          this.deckWaiting = false; this.deckWait = 0;
          if (!built) this.spanWaitExhausted = true;
          this.allowSpanWait = false;
          let placed = false;
          try {
            placed = kind === 'new-visit' ? this.initializeVisit(p, accepts) : this.restart(p.x, p.z, p.heading, kind, accepts);
          } finally { this.allowSpanWait = true; }
          if (placed) onCommit?.();
        }
      } else if (this.visitDirty) {
        const allow = !this.spanWaitExhausted;
        this.allowSpanWait = allow;
        try { this.initializeVisit(this.visitPending, this.visitAccepts); }
        finally { this.allowSpanWait = true; }
      }
      if (this.visitPending) return;
    }
    if (this.plan?.abortReason && this.scriptGroundDirty) {
      this.scriptGroundDirty = false;
      try { this.abort(this.plan.abortReason); } catch (err) { this.abortOnError(err); }
    }
    if (this.plan && !this.plan.abortReason && this.scriptGroundDirty) {
      try { this.validatePlanGround(); } catch (err) { this.abortOnError(err); }
    }
    // Terrain calls occur only after a relevant tile/deck change, not while a parked vehicle sleeps.
    for (const m of this.members) if (m.state === 'PARKED' && m.dirty && !this.busy) {
      m.dirty = false;
      if (m.id === 'truck') this.settlePair(m);
      else this.settle(m);
    }
    if (this.gates > 0 && this.gatesDirty && !this.busy) { const reason = this.fitGates(); if (reason) this.message = reason; }
    this.promptTime -= dt;
    if (this.promptTime > 0) return; this.promptTime = .15;
    const old = this.action && `${this.action.kind}:${this.action.id}`;
    this.actions.length = 0; this.zone.visible = false;
    if (this.busy) return;
    const speed = Math.max(Math.abs(this.driven.vehicle.speed), Math.hypot(this.driven.vehicle.vx, this.driven.vehicle.vz));
    const stationary = speed < .15 && !this.driven.vehicle.airborne, slow = speed <= .5 && !this.driven.vehicle.airborne;
    if (stationary && !this.standingValid(this.driven)) { this.message = 'Current vehicle is blocked; clear it or use RESET'; return; }
    const add = (kind: FleetAction['kind'], id: FleetId, label: string, reason = '') => this.actions.push({ kind, id, label, reason });
    if (this.driven.id === 'truck') {
      if (!stationary) return;
      const next = this.members.find(m => m.id === 'bike' && m.state === 'STRAPPED') ?? this.members.find(m => m.id === 'sxs' && m.state === 'STRAPPED');
      if (next) {
        if (!this.handbrake) add('park', 'truck', 'PARK: Handbrake');
        else add('unload', next.id, `UNLOAD: ${next.entry.name}`, this.site());
      }
    } else {
      const local = this.localPoint(this.driven.vehicle.x, this.driven.vehicle.z);
      if (local.z > 3 && local.z < 20 && Math.abs(local.x) < 12) {
        if (!this.zoneReady) {
          const p = this.point(0, ZONE), x = p.x, z = p.z, h = this.ground(x, z);
          const height = (side: number, back: number) => { const q = this.point(side, back); return this.ground(q.x, q.z); };
          const front = height(0, ZONE - 1.6), back = height(0, ZONE + 1.6), left = height(-1.05, ZONE), right = height(1.05, ZONE);
          if (h !== null && front !== null && back !== null && left !== null && right !== null) {
            this.zone.position.set(x, h + .035, z);
            this.zone.rotation.set(Math.atan2(front - back, 3.2), -this.tow.heading, Math.atan2(right - left, 2.1), 'YXZ');
            this.zone.updateMatrixWorld(true); let lift = 0, known = true;
            for (const side of [-1.08, 1.08]) for (const back of [-1.63, 1.63]) {
              const corner = new THREE.Vector3(side, 0, back).applyMatrix4(this.zone.matrixWorld), ground = this.ground(corner.x, corner.z);
              if (ground === null) known = false; else lift = Math.max(lift, ground + .025 - corner.y);
            }
            this.zone.position.y += lift; this.zoneReady = known;
          }
        }
        this.zone.visible = this.zoneReady;
        if (slow && Math.abs(local.x) < 1 && Math.abs(local.z - ZONE) < 1 && Math.abs(wrap(this.driven.vehicle.heading - this.tow.heading)) <= 25 * Math.PI / 180) {
          const reason = this.stopped() ? this.site() || this.gateClear(this.gates, 1) : 'Stop the pickup first';
          add('load', this.driven.id, `LOAD: ${this.driven.entry.name}`, reason);
          if (automatic && stationary && !reason && !this.gates) { this.lowering = true; this.message = 'Lowering ramps'; }
        }
      }
    }
    if (!stationary) return;
    for (const m of this.members) if (m.state === 'PARKED') {
      if (this.driveReachGap(m) <= 6 && this.standingValid(m)) add('drive', m.id, `DRIVE: ${m.entry.name}`);
    }
    const index = this.actions.findIndex(a => `${a.kind}:${a.id}` === old); this.actionIndex = index < 0 ? 0 : index;
  }

  private settle(m: FleetMember): void {
    const v = m.vehicle, pose = m.support!.fit(v.x, v.z, v.heading, this.ground, m.pose?.spin ?? 0);
    m.dirty = false;
    if (!pose) { m.needsSettling = true; this.message = 'Ground is still loading'; return; }
    const from = this.memberPose(m);
    const reason = fleetMove({ bodies: [this.bodySweep(m, pose)], commit: () => {
      m.pose = pose; m.needsSettling = false; v.y = pose.y; v.pitch = pose.pitch; v.roll = pose.roll;
      m.rig.setRiderVisible?.(false); m.support!.draw(pose);
      this.plan?.history.push({ member: m, from, to: this.memberPose(m) });
    } });
    if (reason) { m.needsSettling = true; this.message = reason + '; vehicle needs settling'; }
  }
  /** Support-only native fitting inside a movement query; no integration, placement search or host publication. */
  private refitTowSupport(): boolean {
    // The native fitter is private to driving; keep this narrow fleet adapter rather than widening that API.
    const fitting = this.tow as unknown as { grounded: boolean; attitude(placing: boolean, dt: number): void };
    fitting.grounded = false; fitting.attitude(false, 0);
    if (this.tow.contacts.some(p => p.height === null)) return false;
    this.tow.update(); return this.trailerSupport.isSupported(this.ground);
  }
  private settlePair(m: FleetMember): void {
    const roots = [m.rig.root, this.tow.trailer.root], before = { ...m.vehicle }, oldTow = { ...this.trailerPose() };
    const parentFrom = this.tow.trailer.root.matrixWorld.clone();
    let future!: () => void, target!: FleetPose, targetTow!: ContactBody, parentTo!: THREE.Matrix4;
    const derived = fleetMove({ roots, objects: [m.vehicle, this.tow], query: () => {
      const pose = m.support!.fit(m.vehicle.x, m.vehicle.z, m.vehicle.heading, this.ground); if (!pose) return false;
      Object.assign(m.vehicle, { y: pose.y, pitch: pose.pitch, roll: pose.roll }); m.support!.draw(pose); if (!this.refitTowSupport()) return false;
      if (!m.vehicle.resumeAfterParking(pose.travel, pose.spin)) return false;
      target = pose; targetTow = { ...this.trailerPose() }; parentTo = this.tow.trailer.root.matrixWorld.clone();
      future = checkpoint([m.vehicle, this.tow], roots); return true;
    } });
    m.dirty = false;
    if (!derived) { m.needsSettling = true; this.message = 'Ground is still loading'; return; }
    const others = this.bodiesExcept(m), reason = fleetMove({
      bodies: [{ from: before, to: { ...target, spec: m.entry.spec }, clear: p => this.clear(p, m, others) },
        { from: oldTow, to: targetTow, clear: p => this.clear(p, m, others) }],
      gates: this.tow.trailer.ramps.map(root => ({ root, from: root.rotation.x, to: root.rotation.x, parentFrom, parentTo })),
      contacts: this.contacts, obstacles: this.gateBodies().filter(p => p.spec !== m.entry.spec),
      commit: () => { future(); m.pose = target; m.needsSettling = false; this.surfaceDirty = true; this.actualSurface = null; }
    });
    if (reason) { m.needsSettling = true; this.message = reason + '; pickup needs settling'; }
  }
  private rampsBlock(m: FleetMember, p: SweepPose): boolean {
    if (!this.gates || Math.hypot(p.x-this.tow.x,p.z-this.tow.z) > p.spec.envelope.reach + 6) return false;
    if (!this.actualSurface) {
      const trailer = this.tow.trailer; trailer.root.updateWorldMatrix(true, true);
      this.actualSurface = new FleetSurface(trailer.root.children.filter(n => n instanceof THREE.Mesh || trailer.ramps.includes(n as THREE.Group)));
    }
    return this.actualSurface.crosses(m.rig, this.poseMatrix(m, p));
  }
  private standingValid(m: FleetMember): boolean {
    const others = this.bodiesExcept(m);
    return !m.needsSettling && (m.id === 'truck' || !this.rampsBlock(m, this.memberPose(m))) && this.clear(m.vehicle, m, others) && (m.id !== 'truck' || this.clear(this.trailerPose(), m, others));
  }
  private standingSweeps(m: FleetMember): BodySweep[] {
    const sweeps = [this.standingSweep(m)];
    if (m.id === 'truck') { const pose = { ...this.trailerPose() }; sweeps.push({ from: pose, to: pose, clear: p => this.clear(p, m, this.bodiesExcept(m)) }); }
    return sweeps;
  }
  private standingSweep(m: FleetMember): BodySweep {
    const pose = this.memberPose(m);
    return { from: pose, to: pose, clear: p => this.clear(p, m, this.bodiesExcept(m)), geometry: m.id !== 'truck' ? p => !this.rampsBlock(m, p) : undefined };
  }
  private park(m: FleetMember): boolean {
    const v = m.vehicle;
    const reason = fleetMove({ bodies: this.standingSweeps(m), commit: () => {
      v.vx = v.vz = v.vy = v.speed = v.steerAngle = 0;
      if (m.id === 'truck') {
        this.handbrake = true; this.previousThrottle = 0; this.reversing = false; this.tow.resetControls();
        v.car.steer.fl.rotation.y = v.car.steer.fr.rotation.y = 0;
      }
      m.state = m === this.driven ? 'DRIVEN' : 'PARKED'; m.pose = null; m.rig.setRiderVisible?.(false);
    } });
    if (reason) { this.message = reason; return false; }
    this.refreshBodies(); return true;
  }
  private take(m: FleetMember, wake = true): boolean {
    let resume: (() => void) | null = null;
    if (wake) {
      const ready = fleetMove({ roots: [], objects: [m.vehicle], query: () => {
        if (!this.withRampContact(() => m.vehicle.resumeAfterParking(m.pose?.travel, m.pose?.spin))) return false;
        m.vehicle.resetControlHistory(); resume = checkpoint([m.vehicle], []); return true;
      } });
      if (!ready) { this.message = 'Vehicle support is still loading'; return false; }
    }
    const reason = fleetMove({ bodies: this.standingSweeps(m), commit: () => {
      (resume as (() => void) | null)?.(); m.rig.setRiderVisible?.(true); if (wake && m.id !== 'truck') m.support?.wake();
    } });
    if (reason) { this.message = reason; return false; }
    const previous = this.driven;
    if (previous !== m && previous.state === 'DRIVEN') previous.state = 'PARKED';
    this.driven = m; m.state = 'DRIVEN'; m.lightState = undefined;
    this.select(m); this.cacheSafe(); this.refreshBodies(); this.actionIndex = 0; this.promptTime = 0;
    this.message = `Driving: ${m.entry.name}`; return true;
  }
  /** Transition invariant: the selected world controller remains driveable, including while a script locks input. */
  assertDriven(): void {
    const active = this.members.filter(m => m.state === 'DRIVEN');
    if (active.length !== 1 || active[0] !== this.driven || this.driven.rig.root.parent !== this.scene
      || this.driven.vehicle.car !== this.driven.rig || typeof this.driven.vehicle.update !== 'function'
      || ![this.driven.vehicle.x, this.driven.vehicle.y, this.driven.vehicle.z].every(Number.isFinite))
      throw new Error('Fleet transition lost its driven world controller');
  }
  private checkedTransition(): void { if (this.verifyTransitions && this.spawned) this.assertDriven(); }
  private handoff(member: FleetMember, wake = true): boolean {
    if (!this.standingValid(this.driven) || !this.standingValid(member)) { this.message = 'Vehicle is blocked; clear it before taking the wheel'; return false; }
    const saved = this.saved();
    const previous = this.driven;
    if (!this.park(previous)) return false;
    // park() retains the selected controller until take() atomically publishes its replacement.
    if (!this.take(member, wake)) {
      const reason = this.message;
      if (this.restore(saved)) this.message = reason;
      this.checkedTransition(); return false;
    }
    this.checkedTransition(); return true;
  }
  activate(): boolean {
    try { return this.activateAction(); } finally { this.checkedTransition(); }
  }
  private driveReachGap(m: FleetMember): number {
    let gap = bodyGap(this.driven.vehicle, m.vehicle);
    if (m.id === 'truck') gap = Math.min(gap, bodyGap(this.driven.vehicle, this.trailerPose()));
    else if (this.driven.id === 'truck') gap = Math.min(gap, bodyGap(this.trailerPose(), m.vehicle));
    return gap;
  }
  /** Fleet-aware handoff to a carried or parked member (e.g. mountain-road SxS hint) without leaving the session. */
  switchToMember(id: 'sxs' | 'bike', onSettled?: (ok: boolean, reason?: string) => void): { ok: boolean; pending?: boolean; reason?: string } {
    try {
      if (this.busy) return { ok: false, reason: 'Wait for the trailer move to finish' };
      const member = this.members.find(m => m.id === id);
      if (!member) return { ok: false, reason: 'No side-by-side on the trailer' };
      if (this.driven === member) return { ok: true };
      const v = this.driven.vehicle;
      if (v.airborne || v.sunk > 0) return { ok: false, reason: 'Stop on solid ground to switch' };
      const saved = { vx: v.vx, vz: v.vz, vy: v.vy, speed: v.speed, steerAngle: v.steerAngle, handbrake: this.handbrake };
      const restore = () => {
        v.vx = saved.vx; v.vz = saved.vz; v.vy = saved.vy; v.speed = saved.speed; v.steerAngle = saved.steerAngle;
        this.handbrake = saved.handbrake; this.rampDirty = true;
      };
      try {
        v.vx = v.vz = v.vy = v.speed = 0;
        if (this.driven.id === 'truck') this.handbrake = true;
        this.rampDirty = true; this.promptTime = 0;
        if (member.state === 'PARKED') {
          if (this.driveReachGap(member) > 6) {
            restore();
            return { ok: false, reason: 'Side-by-side is too far away to switch' };
          }
          if (!this.handoff(member)) { restore(); return { ok: false, reason: this.message || 'Cannot switch to the side-by-side here' }; }
          this.switchCameraReady = false; this.switchTo = member; this.switching = 1;
          this.message = `Taking the wheel: ${member.entry.name}`;
          return { ok: true };
        }
        if (member.state === 'STRAPPED') {
          if (this.driven.id !== 'truck') { restore(); return { ok: false, reason: 'Park the pickup on level ground to unload' }; }
          if (!this.begin('unload', member)) {
            const reason = this.message || 'Pull onto level ground to unload the side-by-side';
            restore();
            return { ok: false, reason };
          }
          if (this.plan) {
            this.plan.after = member;
            this.plan.restoreOnAbort = restore;
            this.plan.onSettled = onSettled;
          }
          return { ok: true, pending: true };
        }
        restore();
        return { ok: false, reason: 'Side-by-side is not ready to switch' };
      } catch {
        restore();
        return { ok: false, reason: 'Could not switch right now' };
      }
    } finally { this.checkedTransition(); }
  }
  private activateAction(): boolean {
    const cached = this.action; if (!cached || this.busy) return false;
    // Prompts are presentation caches. Rebuild all eligibility checks at the input boundary.
    this.rampDirty = true; this.promptTime = 0; this.refresh(0, false);
    const action = this.actions.find(a => a.kind === cached.kind && a.id === cached.id);
    if (!action || (action.kind === 'unload' && !this.stopped()) || (action.kind === 'drive' && Math.max(Math.abs(this.driven.vehicle.speed), Math.hypot(this.driven.vehicle.vx, this.driven.vehicle.vz)) >= .15)) { this.message = cached.kind === 'drive' ? 'Vehicle is blocked or out of reach; clear it before driving' : 'Stop before using the trailer'; return false; }
    if (action.reason) { this.message = action.reason; return false; }
    const m = this.members.find(m => m.id === action.id)!;
    if (action.kind === 'park') { this.handbrake = true; this.promptTime = 0; return true; }
    if (action.kind === 'drive') {
      if (!this.handoff(m)) return false;
      this.switchCameraReady = false; this.switchTo = m; this.switching = 1;
      this.message = `Taking the wheel: ${m.entry.name}`; return true;
    }
    return this.begin(action.kind, m);
  }

  private saved(): Snapshot {
    const values = this.members.map(member => ({ member, dirty: member.dirty, needsSettling: member.needsSettling, state: member.state, pose: member.pose,
      body: { x: member.vehicle.x, z: member.vehicle.z, y: member.vehicle.y, heading: member.vehicle.heading, pitch: member.vehicle.pitch, roll: member.vehicle.roll, spec: member.entry.spec },
      parent: member.rig.root.parent, position: member.rig.root.position.clone(), quaternion: member.rig.root.quaternion.clone() }));
    const restore = checkpoint([this.tow, ...this.members.map(m => m.vehicle)], [this.zone, this.tow.trailer.root, ...this.members.flatMap(m => [m.rig.root, m.light.root])]);
    const acc = this.acc, previousThrottle = this.previousThrottle, reversing = this.reversing;
    const gates = this.gates, angles = [...this.gateAngles], brake = this.handbrake, driver = this.driven;
    const actions = this.actions.slice(), actionIndex = this.actionIndex, promptTime = this.promptTime, zoneReady = this.zoneReady;
    const displays = this.members.map(m => ({ m, shown: m.shown, pose: m.lightPose, state: m.lightState, parent: m.lightParent }));
    const restorePresentation = this.capturePresentation?.(), drawings = this.members.map(m => m.rig.checkpointPose?.());
    return Object.assign(values, { world: new Map(this.members.map(m => [m, this.memberPose(m)])), gatePose: this.tow.trailer.ramps.map(r => r.rotation.x),
      supportRevision: this.supportRevision, trailerWorld: { ...this.trailerPose(), pitch: this.tow.pitch, roll: this.tow.roll }, trailerMatrix: this.tow.trailer.root.matrixWorld.clone(),
      presentation: () => restorePresentation?.(), rollback: (publish = true) => {
      this.acc = acc; this.previousThrottle = previousThrottle; this.reversing = reversing; restore(); for (const drawing of drawings) drawing?.(); this.gates = gates; this.gateAngles[0] = angles[0]; this.gateAngles[1] = angles[1]; this.handbrake = brake;
      for (const s of values) { s.member.state = s.state; s.member.dirty = s.dirty; s.member.needsSettling = s.needsSettling; s.member.pose = s.pose; }
      this.actions.length = 0; this.actions.push(...actions); this.actionIndex = actionIndex; this.promptTime = promptTime; this.zoneReady = zoneReady;
      for (const d of displays) { d.m.shown = d.shown; d.m.lightPose = d.pose; d.m.lightState = d.state; d.m.lightParent = d.parent; }
      const changed = this.driven !== driver; this.driven = driver;
      if (publish) { if (changed) this.select(driver); restorePresentation?.(); }
      this.refreshBodies(); this.cacheSafe(); this.drawGates();
    } });
  }
  /** The host can retain camera/view state in the same cargo transaction. */
  capturePresentation: (() => () => void) | null = null;
  /** Derive the entire returned assembly on current support. No host selection or draw escapes this query. */
  private refitReturn(source: Snapshot, keepMoving = false): Snapshot | null {
    const current = this.saved(), roots = [this.tow.trailer.root, ...this.members.flatMap(m => [m.rig.root, m.light.root])];
    return fleetMove({ roots, objects: [this.tow, ...this.members.map(m => m.vehicle)], query: () => {
      try {
        source.rollback(false);
        // Every returned member participates, including the driver and cargo attached to the pair.
        for (const m of this.members) { m.dirty = true; m.needsSettling = true; m.lightState = undefined; }
        const truck = this.members[0];
        const fit = (m: FleetMember, deck = false): boolean => {
          const v = m.vehicle, standing = source.world.get(m)!;
          this.scene.add(m.rig.root); v.x=standing.x;v.z=standing.z;v.heading=standing.heading;
          const pose = m.support!.fit(v.x, v.z, v.heading, deck ? this.rampGround : this.ground, m.pose?.spin ?? 0);
          if (!pose) return false;
          Object.assign(v, { y: pose.y, pitch: pose.pitch, roll: pose.roll }); m.pose = pose; m.support!.draw(pose);
          if (!this.withRampContact(() => v.resumeAfterParking(pose.travel, pose.spin))) return false;
          v.vx = v.vz = v.vy = v.speed = 0; v.airborne = false;
          m.rig.setRiderVisible?.(m.state === 'DRIVEN'); m.dirty = false; m.needsSettling = false; return true;
        };
        if (!fit(truck)) return null;
        if (!this.refitTowSupport()) return null; this.surfaceDirty = true; this.actualSurface = null; this.prepareSurface();
        for (const m of this.members) if (m !== truck) {
          if (m.state === 'STRAPPED') { m.dirty = false; m.needsSettling = false; continue; }
          const onRamp = m.state === 'MOVING';
          if (!fit(m, onRamp)) return null;
          if (!m.support!.isSupported(onRamp ? this.rampGround : this.ground)) return null;
          if (onRamp && !keepMoving) m.state = 'PARKED';
        }
        this.refreshBodies();
        for (const m of this.members) {
          const pose = this.memberPose(m), others = this.members.filter(o => o !== m).map(o => this.memberPose(o));
          if (!this.clear(pose, m, others, false)) return null;
          if (m.state !== 'STRAPPED') {
            if (m.id !== 'truck' && this.surface?.crosses(m.rig)) return null;
            for (const along of [-m.entry.spec.halfLength, 0, m.entry.spec.halfLength]) for (const side of [-m.entry.spec.halfWidth, 0, m.entry.spec.halfWidth]) {
              const x = pose.x + Math.sin(pose.heading) * along + Math.cos(pose.heading) * side;
              const z = pose.z - Math.cos(pose.heading) * along + Math.sin(pose.heading) * side, height = this.ground(x, z);
              if (height === null || height <= this.seaLevel + .08) return null;
            }
          }
        }
        const trailer = this.trailerPose();
        if (!this.clear(trailer, truck, this.members.filter(m => m !== truck && m.state !== 'STRAPPED' && source.find(s => s.member === m)?.state !== 'MOVING').map(m => this.memberPose(m)), false)) return null;
        this.assertDriven(); this.cacheSafe(); return this.saved();
      } finally { current.rollback(false); this.surfaceDirty = true; this.actualSurface = null; }
    } });
  }
  /** Moving cargo and its support are checked together, so a coarse gate box cannot reject tyre contact. */
  private carriedClear(from: Snapshot, to: Snapshot, members: FleetMember[]): boolean {
    const root = this.tow.trailer.root, roots = [root, ...members.map(m => m.rig.root)], undo = members.map(m => m.rig.checkpointPose?.());
    return fleetMove({ roots, query: () => {
      try {
        const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
        from.trailerMatrix.decompose(pa, qa, sa); to.trailerMatrix.decompose(pb, qb, sb);
        const span = pa.distanceTo(pb) + qa.angleTo(qb) * 16 + members.reduce((sum,m) => { const a=from.world.get(m)!,b=to.world.get(m)!;return sum+Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z); },0);
        const steps = Math.max(1,Math.ceil(span/.015)), inverse = root.parent!.matrixWorld.clone().invert();
        for(let i=0;i<=steps;i++) {
          const t=i/steps,matrix=new THREE.Matrix4().compose(pa.clone().lerp(pb,t),qa.clone().slerp(qb,t),sa.clone().lerp(sb,t)).premultiply(inverse);
          matrix.decompose(root.position,root.quaternion,root.scale);
          this.tow.trailer.ramps.forEach((gate,n)=>gate.rotation.x=THREE.MathUtils.lerp(from.gatePose[n],to.gatePose[n],t));root.updateWorldMatrix(true,true);
          const surface=new FleetSurface(root.children.filter(n=>n instanceof THREE.Mesh||this.tow.trailer.ramps.includes(n as THREE.Group)));
          for(const m of members) {
            const a=from.world.get(m)!,b=to.world.get(m)!,next=to.find(s=>s.member===m)!.pose!,old=from.find(s=>s.member===m)!.pose??next;
            const rotation=a.quaternion!.clone().slerp(b.quaternion!,t),e=new THREE.Euler().setFromQuaternion(rotation,'YXZ');
            m.support!.draw({...next,x:THREE.MathUtils.lerp(a.x,b.x,t),y:THREE.MathUtils.lerp(a.y,b.y,t),z:THREE.MathUtils.lerp(a.z,b.z,t),heading:-e.y,pitch:e.x,roll:e.z,travel:next.travel.map((v,n)=>THREE.MathUtils.lerp(old.travel[n]??0,v,t)),spin:THREE.MathUtils.lerp(old.spin??0,next.spin??0,t)});
            if(surface.crosses(m.rig))return false;
          }
        }
        return true;
      } finally { for(const restore of undo)restore?.(); }
    } });
  }
  private resumeSupportedPlan(plan: Plan): boolean {
    this.prepareSurface();
    const simulated = new Map(this.members.map(m=>[m,this.memberPose(m)])), replacements: {move:Move;frames:FleetPose[]}[]=[];
    for(let i=plan.index;i<plan.moves.length;i++) {
      const move=plan.moves[i],frames=move.frames.slice(),start=i===plan.index?Math.round(plan.elapsed/move.duration*(frames.length-1)):0;
      for(let n=start;n<frames.length;n++) {
        const old=frames[n];let crossed=false;
        const pose=move.member.support!.fit(old.x,old.z,old.heading,this.rampGround,old.spin??0,move.member.id==='bike'?old.roll:undefined,()=>{crossed=!!this.surface?.crosses(move.member.rig)});
        const others=[...simulated].filter(([m])=>m!==move.member).map(([,p])=>p);
        if(!pose||crossed||this.pathGround(pose,move.member.entry.spec)||!this.clear({...pose,spec:move.member.entry.spec},move.member,others,false))return false;
        if(n>start&&Math.abs(pose.y-frames[n-1].y)>.15)return false;
        frames[n]=pose;
      }
      simulated.set(move.member,{...frames[frames.length-1],spec:move.member.entry.spec});replacements.push({move,frames});
    }
    for(const r of replacements)r.move.frames=r.frames;
    plan.abortReason=undefined;this.scriptGroundDirty=false;return true;
  }
  private restore(saved: Snapshot): boolean {
    const plan = this.plan, changed = saved.supportRevision !== this.supportRevision; this.returnHeld = false;
    if (!plan && !changed) { fleetMove({ commit: () => saved.rollback() }); return true; }
    const current = this.saved(), parentFrom = this.tow.trailer.root.matrixWorld.clone();
    const attempt = (target: Snapshot, history: boolean): string => {
      const simulated = new Map(this.members.map(m => [m, this.memberPose(m)])), bodies: BodySweep[] = [];
      const append = (m: FleetMember, to: SweepPose) => {
        const from = simulated.get(m)!, others = [...simulated].filter(([other]) => other !== m).map(([, p]) => ({ ...p }));
        bodies.push({ from, to, clear: p => this.clear(p, m, others, false) }); simulated.set(m, to);
      };
      if (history && plan) for (let i = plan.history.length - 1; i >= 0; i--) append(plan.history[i].member, plan.history[i].from);
      for (const m of this.members) {
        const a = simulated.get(m)!, b = target.world.get(m)!;
        if (Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z) + Math.abs(wrap(a.heading-b.heading)) + Math.abs((a.pitch??0)-(b.pitch??0)) + Math.abs((a.roll??0)-(b.roll??0)) > 1e-8) append(m, b);
      }
      if (changed) bodies.push({ from: current.trailerWorld, to: target.trailerWorld,
        clear: p => this.clear(p, this.members[0], target.filter(s => s.state !== 'STRAPPED' && s.member.id !== 'truck' && (history || current.find(c => c.member === s.member)?.state !== 'MOVING')).map(s => target.world.get(s.member)!), false) });
      const carried = !history ? current.filter(s => s.state === 'MOVING').map(s => s.member) : [];
      if (carried.length && !this.carriedClear(current, target, carried)) return 'The machine cannot follow the ramp safely';
      const obstacles = target.filter(s => s.state !== 'STRAPPED' && !carried.includes(s.member)).map(s => ({ ...target.world.get(s.member)!, label: s.member.entry.name.toLowerCase() }));
      return fleetMove({ bodies, gates: this.tow.trailer.ramps.map((root, i) => ({ root, from: root.rotation.x, to: target.gatePose[i], parentFrom, parentTo: target.trailerMatrix })),
        contacts: this.contacts, obstacles, commit: () => {
          target.rollback(); if (changed) { saved.presentation(); this.rampDirty = this.gatesDirty = true; this.zoneReady = false; }
        } });
    };
    const target = changed ? this.refitReturn(saved) : saved;
    let reason = target ? attempt(target, true) : 'The former place is no longer safe';
    if (reason && changed) {
      // A newly blocked former slot does not force a stale-ground return. Keep the current assembly supported.
      const held = this.refitReturn(current, true);
      if (held && !attempt(held, false)) { this.returnHeld = true; return true; }
    }
    if (reason) this.message = reason + '; clear the obstruction or start over';
    return !reason;
  }
  private begin(kind: 'unload' | 'load', member: FleetMember): boolean {
    const saved = this.saved();
    if (!this.standingValid(this.driven) || !this.standingValid(this.members[0])) { this.message = 'Pickup is blocked; clear it before using the trailer'; return false; }
    this.rampDirty = true;
    const reason = this.site() || this.gateClear(this.gates, 1); if (reason) { if (this.restore(saved)) this.message = reason; return false; }
    this.prepareSurface();
    const moves: Move[] = [], simulated = new Map<FleetMember, ContactBody>();
    for (const m of this.members) if (m.id !== 'truck') {
      const root = m.rig.root, pos = root.getWorldPosition(new THREE.Vector3());
      simulated.set(m, { x: pos.x, z: pos.z, y: pos.y, heading: m.state === 'STRAPPED' ? this.tow.heading : m.vehicle.heading, spec: m.entry.spec });
    }
    const mountZ = (m: FleetMember) => this.tow.trailer.mounts[m.id as 'sxs' | 'bike'].position.z;
    const parking = (m: FleetMember): [number, number] => [m.id === 'bike' ? 3.8 : -3.8, m.id === 'bike' ? 8.7 : 9.6];
    const append = (m: FleetMember, points: [number, number][], end: Move['end'], duration: number): boolean => {
      const frames: FleetPose[] = [], curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      const steps = Math.max(120, Math.ceil(curve.getLength() / .035));
      for (let i = 0; i <= steps; i++) {
        const local = curve.getPointAt(i / steps), world = new THREE.Vector3(local.x, S.deckHeight + (m.id === 'bike' ? m.entry.spec.wheelRadius : 0), local.z).applyMatrix4(this.tow.trailer.root.matrixWorld);
        // Keep the wheels straight on the narrow deck; turn only after all wheels are clear of the gate.
        const tangent = curve.getTangentAt(i / steps), reverse = kind === 'unload' || end === 'PARKED';
        let wanted = local.z < 5.8 ? this.tow.heading : this.tow.heading + Math.atan2(reverse ? -tangent.x : tangent.x, reverse ? tangent.z : -tangent.z);
        if (kind === 'load' && end === 'PARKED' && i / steps > .65)
          wanted = this.tow.heading + wrap(wanted - this.tow.heading) * (1 - i / steps) / .35;
        const previous = frames[frames.length - 1], oldHeading = previous?.heading ?? simulated.get(m)!.heading;
        const heading = oldHeading + THREE.MathUtils.clamp(wrap(wanted - oldHeading), -.03, .03);
        const spin = previous ? (previous.spin ?? 0) + Math.hypot(world.x - previous.x, world.z - previous.z) / m.entry.spec.wheelRadius * (reverse ? -1 : 1) : 0;
        let rollHint: number | undefined;
        if (m.id === 'bike' && local.z < 6) {
          const rx = Math.cos(heading), rz = Math.sin(heading), left = this.ground(world.x - rx * .1, world.z - rz * .1), right = this.ground(world.x + rx * .1, world.z + rz * .1);
          const landRoll = left !== null && right !== null ? Math.atan2(right - left, .2) : this.tow.roll;
          rollHint = THREE.MathUtils.lerp(this.tow.roll, landRoll, THREE.MathUtils.clamp((local.z - 4.8) / 1.2, 0, 1));
        }
        let crossed = false;
        const pose = m.support!.fit(world.x, world.z, heading, this.rampGround, spin, rollHint, () => { crossed = !!this.surface?.crosses(m.rig); });
        if (!pose) { this.message = 'Ground is still loading'; return false; }
        if (crossed) { this.message = 'The vehicle catches on the trailer'; return false; }
        const groundReason = this.pathGround(pose, m.entry.spec);
        if (groundReason) { this.message = groundReason; return false; }
        const p = { ...pose, spec: m.entry.spec };
        const others = [this.truck, ...[...simulated].filter(([other]) => other !== m).map(([, p]) => p)];
        if (!this.clear(p, m, others, false)) { this.message = 'Something blocks the loading path'; return false; }
        // A support discontinuity is a drop; never animate a teleport across it.
        if (previous && Math.abs(pose.y - previous.y) > .15) { this.message = 'A drop behind the trailer'; return false; }

        frames.push(pose);
      }
      moves.push({ member: m, frames, end, duration }); simulated.set(m, { ...frames[frames.length - 1], spec: m.entry.spec }); return true;
    };
    let valid = true, reordering = false, restored = false;
    try {
      const bike = this.members.find(m => m.id === 'bike')!, sxs = this.members.find(m => m.id === 'sxs')!;
      const unload = (m: FleetMember) => append(m, [[0, mountZ(m)], [0, 4.4], [0, 6.2], parking(m)], 'PARKED', 2.5);
      const load = (m: FleetMember, start: [number, number]): boolean => {
        // Make room to align before a front tyre reaches the narrow gates. No cusp or sideways deck entry.
        const heading = simulated.get(m)!.heading;
        if (start[1] < 7.2 || Math.abs(start[0]) > .15 || Math.abs(wrap(heading - this.tow.heading)) > .08) {
          const back = Math.max(8.4, start[1] + 2.2);
          if (!append(m, [start, [start[0], back - .7], [0, back]], 'PARKED', 1.5)) return false;
          start = [0, back];
        }
        return append(m, [start, [0, 6.2], [0, 4.4], [0, mountZ(m)]], 'STRAPPED', 3.5);
      };
      if (kind === 'unload') {
        if (member.id === 'sxs' && bike.state === 'STRAPPED') valid = unload(bike);
        if (valid) valid = unload(member);
      } else {
        const l = this.pathPoint(member.vehicle.x, member.vehicle.z, member), start: [number, number] = [l.x, l.z];
        if (member.id === 'sxs' && bike.state === 'STRAPPED') {
          reordering = true;
          valid = append(sxs, [start, [-2, ZONE + .8], [-3.8, ZONE + 1.7]], 'PARKED', 1.5);
          if (valid) valid = unload(bike);
          if (valid) valid = load(sxs, [-3.8, ZONE + 1.7]);
          if (valid) valid = load(bike, parking(bike));
        } else valid = load(member, start);
      }
    } finally { restored = this.restore(saved); }
    if (!valid || !restored) return false;
    if (!this.handoff(this.members[0], false)) return false;
    this.plan = { history: [], moves, saved, elapsed: 0, index: 0, gateTime: this.gates, after: this.members[0] };
    this.scriptGroundDirty = false;
    this.message = reordering ? 'Bike clears the deck; side by side loads; bike follows' : `${kind === 'load' ? 'Loading' : 'Unloading'}: ${member.entry.name}`;
    return true;
  }

  private apply(m: FleetMember, pose: FleetPose): boolean {
    const others = this.bodiesExcept(m).filter(p => p.spec !== trailerSpec);
    for (const other of this.members) if (other !== m && other.id !== 'truck' && other.state === 'STRAPPED') others.push(this.memberPose(other));
    const from = this.memberPose(m);
    const reason = fleetMove({ bodies: [this.bodySweep(m, pose, true, others)], commit: () => {
      this.scene.add(m.rig.root); m.pose = pose;
      const v = m.vehicle; v.x = pose.x; v.z = pose.z; v.y = pose.y; v.heading = pose.heading; v.pitch = pose.pitch; v.roll = pose.roll;
      v.vx = v.vz = v.vy = v.speed = 0; m.rig.setRiderVisible?.(false); m.support!.draw(pose);
      this.plan?.history.push({ member: m, from, to: this.memberPose(m) });
    } });
    if (reason) this.message = reason;
    return !reason;
  }
  private abortOnError(err: unknown): void {
    if (!this.plan?.onSettled) throw err;
    this.abort('Could not finish switching; vehicles returned safely');
  }
  private advance(dt: number, checked = false): void {
    const run = () => {
      this.acc = Math.min(.1, this.acc + Math.max(0, dt));
      while (this.acc + 1e-10 >= STEP) { this.acc -= STEP; this.advanceStep(); }
      this.promptTime = 0;
    };
    try {
      // A single checked angular interval owns all the fixed steps in this synchronous frame.
      if (!checked && (this.folding || this.lowering || this.plan && this.plan.gateTime < 1)) {
        const duration = Math.min(.1, this.acc + Math.max(0, dt));
        const end = THREE.MathUtils.clamp(this.gates + (this.folding ? -duration : duration), 0, 1);
        const reason = this.gateClear(this.gates, end, run);
        if (reason) {
          if (this.plan) this.abort(reason + '; vehicles returned safely');
          else { this.folding = this.lowering = false; this.handbrake = true; this.message = reason; }
        }
      } else fleetMove({ commit: run });
    } catch (err) {
      this.abortOnError(err);
    }
  }
  private validatePlanGround(): boolean {
    const plan = this.plan; if (!plan) return true;
    if (this.scriptGroundDirty) {
      this.scriptGroundDirty = false;
      for (const sample of this.gateSamples) {
        const height = this.ground(sample.x, sample.z);
        if (height === null || Math.abs(height - sample.height) > .035) { this.abort('Ground changed; vehicles returned safely'); return false; }
      }
      for (let i = plan.index; i < plan.moves.length; i++) for (const pose of plan.moves[i].frames) for (const sample of pose.samples ?? []) {
        const height = this.rampGround(sample.x, sample.z);
        if (height === null || Math.abs(height - sample.height) > .035) { this.abort('Ground changed; vehicles returned safely'); return false; }
      }
    }
    return true;
  }
  private advanceStep(): void {
    try { this.advanceTransition(); } catch (err) { this.abortOnError(err); } finally { this.checkedTransition(); }
  }
  private advanceTransition(): void {
    if (this.switching > 0) {
      this.switching = Math.max(0, this.switching - STEP);
      if (!this.switching) { if (this.switchTo) this.message = `Driving: ${this.switchTo.entry.name}`; this.switchTo = null; this.releaseInput?.(); }
      return;
    }
    if (this.folding) {
      this.gates = Math.max(0, this.gates - STEP); this.writeGates();
      if (!this.gates) { this.folding = false; this.handbrake = false; this.message = `Driving: ${this.driven.entry.name}`; }
      return;
    }
    if (this.lowering) {
      this.gates = Math.min(1, this.gates + STEP); this.writeGates();
      if (this.gates === 1) { this.lowering = false; this.message = `Ready to load: ${this.driven.entry.name}`; }
      return;
    }
    const plan = this.plan; if (!plan || plan.abortReason) return;
    if (!this.validatePlanGround()) return;
    plan.gateTime = Math.min(1, plan.gateTime + STEP); this.gates = plan.gateTime; this.writeGates();
    if (plan.gateTime < 1) return;
    const move = plan.moves[plan.index]; if (!move) {
      if (!this.take(plan.after)) { this.abort(this.message + '; load cancelled'); return; }
      this.plan = null; this.mass(); plan.onSettled?.(true); return;
    }
    plan.elapsed = Math.min(move.duration, plan.elapsed + STEP);
    const at = Math.min(move.frames.length - 1, Math.round(plan.elapsed / move.duration * (move.frames.length - 1))), pose = move.frames[at];
    // Recheck live solids. A newly moved yard body may invalidate an already checked script.
    const others = this.bodiesExcept(move.member).filter(p => p.spec !== trailerSpec);
    for (const m of this.members) if (m !== move.member && m.id !== 'truck' && m.state === 'STRAPPED') {
      const q = m.rig.root.getWorldPosition(new THREE.Vector3()); others.push({ x: q.x, z: q.z, y: q.y, heading: this.tow.heading, spec: m.entry.spec });
    }
    if (!this.clear({ ...pose, spec: move.member.entry.spec }, move.member, others, false)) { this.abort('Loading path changed; vehicles returned safely'); return; }
    move.member.state = 'MOVING'; this.refreshBodies(); this.tow.trailer.mounts[move.member.id as 'sxs' | 'bike'].root.visible = false;
    if (!this.apply(move.member, pose)) { this.abort(this.message + '; vehicles returned safely'); return; }
    if (plan.elapsed >= move.duration) {
      if (move.end === 'STRAPPED') { if (!this.strap(move.member)) { this.abort(this.message); return; } }
      else { move.member.state = 'PARKED'; this.settle(move.member); }
      plan.index++; plan.elapsed = 0; this.refreshBodies(); this.mass();
    }
  }
  private writeGates(): void { this.surfaceDirty = true; this.actualSurface = null; for (let i = 0; i < 2; i++) this.tow.trailer.ramps[i].rotation.set(this.gateAngles[i] * this.gates, 0, 0); }
  private drawGates(): void {
    const gates = this.tow.trailer.ramps.map((root, i) => ({ root, from: root.rotation.x, to: this.gateAngles[i] * this.gates }));
    if (gates.every(g => Object.is(g.from, g.to))) return;
    const reason = fleetMove({ gates, contacts: this.contacts, obstacles: this.gateBodies(), commit: () => this.writeGates() });
    if (reason) this.message = reason;
  }
  private strap(m: FleetMember): boolean {
    const from = this.memberPose(m);
    const state = m.state, pose = m.pose, undoModel = m.rig.checkpointPose?.();
    const target = fleetMove({ roots: [m.rig.root], query: () => {
      try { this.strapRaw(m); return this.memberPose(m); } finally { m.state = state; m.pose = pose; undoModel?.(); }
    } });
    const others = this.members.filter(other => other !== m).map(other => this.memberPose(other));
    const reason = fleetMove({ bodies: [{ from: this.memberPose(m), to: target,
      clear: p => this.clear(p, m, others, false), geometry: p => !this.surface?.crosses(m.rig, this.poseMatrix(m, p)) }],
      commit: () => { this.strapRaw(m); this.plan?.history.push({ member: m, from, to: this.memberPose(m) }); } });
    if (reason) this.message = reason;
    return !reason;
  }
  private strapRaw(m: FleetMember): void {
    const mount = this.tow.trailer.mounts[m.id as 'sxs' | 'bike']; mount.root.visible = true; mount.root.add(m.rig.root);
    m.state = 'STRAPPED'; m.pose = null; m.rig.setRiderVisible?.(false);
    m.support!.draw({ x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, travel: [0, 0, 0, 0] });
  }
  abort(reason: string): void {
    try { this.abortTransition(reason); } finally { this.checkedTransition(); }
  }
  private abortTransition(reason: string): void {
    let settled: ((ok: boolean, reason?: string) => void) | undefined;
    if (this.plan) { const plan = this.plan; if (!this.restore(plan.saved)) { plan.abortReason = reason; return; }
      if(this.returnHeld){const resumed=this.resumeSupportedPlan(plan);plan.abortReason=resumed?undefined:'Ground changed; return blocked; use Start over';this.message=resumed?'Ground changed; former place blocked; continuing on checked support':plan.abortReason!;return;}
      plan.history.length = 0; this.plan = null; this.switching = 0; this.switchTo = null; this.folding = this.lowering = false;
      plan.restoreOnAbort?.(); settled = plan.onSettled; }
    if (reason.startsWith('Ground changed')) { this.rampDirty = this.gatesDirty = true; this.zoneReady = false; }
    this.message = this.returnHeld ? 'Ground changed; former place blocked; drive the machine clear of the ramp' : reason;
    settled?.(false, this.message);
  }
  /** External contact consumers (including animals) cannot turn a correction into a placement search. */
  private placeMovement(m: FleetMember, x: number, z: number, heading: number): boolean {
    if (this.busy) return false;
    const v = m.vehicle, roots = m.id === 'truck' ? [m.rig.root, this.tow.trailer.root] : [m.rig.root];
    const before = checkpoint(m.id === 'truck' ? [v, this.tow] : [v], roots), undoModel = m.rig.checkpointPose?.();
    const from = this.memberPose(m), fromTow = { ...this.trailerPose(), pitch: this.tow.pitch, roll: this.tow.roll }, parentFrom = this.tow.trailer.root.matrixWorld.clone();
    let parkedPose: FleetPose | null = null;
    const reason = fleetMove({ rollback: () => { before(); undoModel?.(); if (m.id === 'truck') this.writeGates(); }, propose: () => {
      const guard = v.placementGuard; let proposed = false;
      try {
        v.placementGuard = p => { proposed = m.id !== 'truck' || this.tow.allowsPose(p); return proposed; };
        const placed = this.withRampContact(() => this.nativePlace.get(v)!(x, z, heading, this.reference(x, z)));
        if (!placed) proposed = false;
      }
      finally { v.placementGuard = guard; }
      if (m.state === 'PARKED' && m.id !== 'truck') { parkedPose = m.support!.fit(v.x,v.z,v.heading,this.ground,m.pose?.spin??0); if (parkedPose) { Object.assign(v,{y:parkedPose.y,pitch:parkedPose.pitch,roll:parkedPose.roll}); m.support!.draw(parkedPose); } else proposed=false; }
      if (m.id === 'truck') this.tow.update();
      const others = this.bodiesExcept(m), bodies: BodySweep[] = [{ from, to: this.memberPose(m), clear: p => proposed && this.clear(p, m, others) && (m.id === 'truck' || !this.rampsBlock(m, p)) }];
      if (m.id === 'truck') bodies.push({ from: fromTow, to: { ...this.trailerPose(), pitch: this.tow.pitch, roll: this.tow.roll }, clear: p => this.clear(p, m, others) });
      return { bodies, gates: m.id === 'truck' ? this.tow.trailer.ramps.map(root => ({ root, from: root.rotation.x, to: root.rotation.x, parentFrom, parentTo: this.tow.trailer.root.matrixWorld.clone() })) : [],
        contacts: this.contacts, obstacles: this.gateBodies().filter(p => p.spec !== m.entry.spec), commit: () => { if (m.id === 'truck') { this.surfaceDirty = true; this.actualSurface = null; } if (parkedPose) { m.pose=parkedPose; m.needsSettling=false; } if (m === this.driven) this.cacheSafe(); } };
    } });
    if (reason) this.message = reason;
    return !reason;
  }
  private validTeleport(body: ContactBody, member: FleetMember, others: readonly ContactBody[], attached = false): string {
    const bounds = this.truck.bounds, reach = body.spec.envelope.reach;
    if (bounds && (body.x-reach<bounds[0] || body.x+reach>bounds[2] || body.z-reach<bounds[1] || body.z+reach>bounds[3])) return 'Destination is outside the map';
    if (!this.clear(body, member, others)) return 'A solid or another vehicle blocks the destination';
    // Recovery may search conservatively around the real gates, which extend beyond the trailer envelope.
    if (member.id !== 'truck' && !attached && this.gates > 0) {
      const box = new THREE.Box3();
      for (const gate of this.tow.trailer.ramps) { gate.updateWorldMatrix(true, true);
        if (boxTouchesBody(box.setFromObject(gate).expandByScalar(.025), body)) return 'A ramp blocks the destination';
      }
    }
    const fx = Math.sin(body.heading), fz = -Math.cos(body.heading), rx = Math.cos(body.heading), rz = Math.sin(body.heading);
    for (const along of [-body.spec.halfLength, 0, body.spec.halfLength]) for (const side of [-body.spec.halfWidth, 0, body.spec.halfWidth]) {
      const x = body.x + fx * along + rx * side, z = body.z + fz * along + rz * side, h = this.ground(x, z);
      if (h === null) return 'Destination land is still loading';
      if (h <= this.seaLevel + .08) return 'Water at the destination';
      const surface = this.terrain.surfaceAt(x, z);
      const onDeck = this.roads.deckHeight(x, z) !== null || surface?.deck === true;
      const coverClass = this.terrain.coverAt?.(x, z) ?? 0;
      const slope = coverClass === WATER_COVER_CLASS ? localGroundSlope(x, z, this.ground) : 0;
      if (!isDryGround({ ground: h, surface, onDeck, seaLevel: this.seaLevel, coverClass, slope })) return 'Water at the destination';
    }
    return '';
  }
  /** Exactly the four explicit recovery operations may enter teleport; ordinary movement never does. */
  private teleport(kind: TeleportKind, destination?: VehiclePlacement, accepts?: (pose: VehiclePlacement) => boolean): boolean {
    this.teleportAttempts++;
    if (destination && ![destination.x,destination.z,destination.heading].every(Number.isFinite)) { this.message = 'Invalid destination'; return false; }
    const all = kind !== 'road-reset', actor = all ? this.members[0] : this.driven;
    const movers = all || actor.id === 'truck' ? this.members.filter(m => all || m.id === 'truck' || m.state === 'STRAPPED') : [actor];
    const roots = [this.tow.trailer.root, ...this.members.flatMap(m => [m.rig.root, m.light.root])];
    const before = this.saved(), oldDriver = this.driven;
    let accepted: Snapshot | null = null, targets: { body: ContactBody; member: FleetMember; others: ContactBody[]; attached: boolean }[] = [], failure = 'No clear loaded road position';
    this.teleportTrial = true;
    try { fleetMove({ roots, objects: [this.tow, ...this.members.map(m => m.vehicle)], query: () => {
      try {
        if (all) {
          for (const m of this.members) { m.vehicle.resetVisit(); m.vehicle.vx=m.vehicle.vz=m.vehicle.vy=m.vehicle.speed=m.vehicle.steerAngle=0; if (m.id !== 'truck') this.strapRaw(m); }
          this.refreshBodies(); this.gates = 0; this.writeGates();
        } else { if (actor.id === 'truck') { this.gates = 0; this.writeGates(); } this.nativeRespawn.get(actor.vehicle)!(); }
        const base = destination ?? { x: actor.vehicle.x, z: actor.vehicle.z, heading: actor.vehicle.heading };
        const road = this.roads.nearest(base.x, base.z, 40);
        for (const turn of [0, Math.PI]) for (let distance = 0; distance <= 120; distance += 2) {
          const heading = base.heading + turn;
          let x = base.x + Math.sin(heading) * distance, z = base.z - Math.cos(heading) * distance, yaw = heading;
          if (road && distance) {
            const forward = Math.cos(road.heading - heading) >= 0; let seg = road.seg, fraction = road.t, left = distance;
            while (left > 0) {
              const a = road.road.pts[seg], b = road.road.pts[seg + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
              const available = length * (forward ? 1 - fraction : fraction);
              if (left <= available || (forward ? seg === road.road.pts.length - 2 : seg === 0)) {
                fraction = THREE.MathUtils.clamp(fraction + (forward ? 1 : -1) * left / (length || 1), 0, 1);
                x = THREE.MathUtils.lerp(a[0], b[0], fraction); z = THREE.MathUtils.lerp(a[1], b[1], fraction); yaw = Math.atan2(b[0] - a[0], a[1] - b[1]) + (forward ? 0 : Math.PI); break;
              }
              left -= available; seg += forward ? 1 : -1; fraction = forward ? 0 : 1;
            }
          }
          // Fleet's own ground height (a deck where there is one) goes with the pose to the caller's guard (the trailer
          // check judges the pose at its height), as it does to the trailer check below and to place().
          const height = this.ground(x, z);
          if (height === null) { failure = 'Destination land is still loading'; continue; }
          if (height <= this.seaLevel + .08) { failure = 'Water at the destination'; continue; }
          if (accepts && !accepts({x,z,heading:yaw,y:height})) { failure = 'Requested start pose is blocked'; continue; }
          const invalid = this.validTeleport({ x, z, y: height, heading: yaw, spec: actor.entry.spec }, actor, this.bodiesExcept(actor));
          if (invalid) { failure = invalid; continue; }
          if (actor.id === 'truck' && !this.tow.allowsPose({ x, z, heading: yaw, y: this.ground(x, z) ?? undefined })) { failure = 'The trailer destination is blocked'; continue; }
          // This loop owns the road/turn search; do not invoke a nested endpoint-searching guard.
          const guard = actor.vehicle.placementGuard;
          let placed = false;
          try { actor.vehicle.placementGuard = () => true; placed = actor.vehicle.place(x, z, yaw, height); }
          finally { actor.vehicle.placementGuard = guard; }
          if (!placed) { failure = 'Water at the destination'; continue; }
          if (Math.hypot(actor.vehicle.x - x, actor.vehicle.z - z) > 125) continue;
          actor.vehicle.vx=actor.vehicle.vz=actor.vehicle.vy=actor.vehicle.speed=0;
          if (actor.id === 'truck') this.tow.update();
          const stationary = this.members.filter(m => !movers.includes(m) && m.state !== 'STRAPPED').map(m => this.memberPose(m));
          const moving = movers.map(m => ({ member: m, body: this.memberPose(m), attached: m.state === 'STRAPPED' }));
          targets = moving.map(({ member, body, attached }) => ({ member, body, attached, others: [...stationary, ...moving.filter(v => v.member !== member).map(v => v.body),
            ...(actor.id !== 'truck' ? [{ ...this.trailerPose() }] : [])] }));
          if (actor.id === 'truck') targets.push({ member: actor, body: { ...this.trailerPose() }, others: stationary, attached: false });
          if (accepts && !accepts(actor.vehicle)) { failure = 'Requested start pose was not retained'; continue; }
          failure = targets.map(t => this.validTeleport(t.body, t.member, t.others, t.attached)).find(Boolean) ?? '';
          if (!failure) { accepted = this.saved(); return; }
        }
      } finally { before.rollback(); }
    } }); } finally { this.teleportTrial = false; }
    if (!accepted) { this.message = failure || 'No valid destination found'; return false; }
    const chosen = accepted as Snapshot;
    let cancelledPlan: Plan | null = null;
    const reason = teleport({ kind, targets: targets.map(t => ({ body: t.body, valid: () => this.validTeleport(t.body, t.member, t.others, t.attached) || (accepts && t.body.spec === actor.entry.spec && !accepts(t.body) ? 'Requested start pose changed' : '') })), commit: () => {
      chosen.rollback(); this.surfaceDirty = true; this.actualSurface = null; for (const m of movers) { m.needsSettling=false; m.dirty=false; m.vehicle.airborne = m.vehicle.atEdge = false; } if (actor.id === 'truck') this.gatesNeedSettling=false; this.spawned = true; this.tow.trailer.root.visible = true;
      if (all) {
        cancelledPlan = this.plan;
        this.visitPending = null; this.visitAccepts = undefined; this.visitCommit = undefined; this.visitDirty = false;
        this.deckWaiting = false; this.deckWait = 0; this.spanWaitExhausted = false;
        this.plan = null; this.switching = 0; this.switchTo = null; this.folding = this.lowering = false; this.acc = 0;
        this.driven = this.members[0]; this.driven.state = 'DRIVEN'; this.handbrake = true; this.previousThrottle = 0; this.reversing = false; this.tow.resetControls();
        this.select(this.driven); this.rampDirty = this.gatesDirty = true; this.zoneReady = false;
      } else if (this.driven !== oldDriver) { this.driven = oldDriver; this.select(oldDriver); }
      this.refreshBodies(); this.cacheSafe(); this.mass(); this.releaseInput?.(); this.checkedTransition();
    } });
    if (reason) { this.message = reason; return false; }
    (cancelledPlan as Plan | null)?.onSettled?.(false);
    return true;
  }
  /** True when a requested Fleet start lies on an unbuilt modern bridge span over unloaded or wet ground. */
  private waitingOnSpan(pose: VehiclePlacement): boolean {
    const b = this.truck.bounds, reach = this.members[0].entry.spec.envelope.reach;
    if (b && (pose.x - reach < b[0] || pose.x + reach > b[2] || pose.z - reach < b[1] || pose.z + reach > b[3])) return false;
    if (this.roads.deckHeight(pose.x, pose.z) !== null || !placementOnSpan(this.roads, pose.x, pose.z)) return false;
    const h = this.ground(pose.x, pose.z);
    if (h === null || h <= this.seaLevel + .08) return true;
    const surface = this.terrain.surfaceAt(pose.x, pose.z);
    const coverClass = this.terrain.coverAt?.(pose.x, pose.z) ?? 0;
    const slope = coverClass === WATER_COVER_CLASS ? localGroundSlope(pose.x, pose.z, this.ground) : 0;
    return !isDryGround({ ground: h, surface, onDeck: surface?.deck === true, seaLevel: this.seaLevel, coverClass, slope });
  }
  startVisit(x: number, z: number, heading: number, accepts?: (pose: VehiclePlacement) => boolean): boolean {
    if ([x,z,heading].every(Number.isFinite)) { this.spanWaitExhausted = false; return this.initializeVisit({ x, z, heading }, accepts); }
    this.message = 'Invalid starting position'; return false;
  }
  private initializeVisit(pose: VehiclePlacement, accepts?: (pose: VehiclePlacement) => boolean): boolean {
    this.visitPending = null; this.visitAccepts = undefined; this.visitCommit = undefined; this.visitDirty = false;
    this.deckWaiting = false; this.deckWait = 0;
    if (this.allowSpanWait && this.waitingOnSpan(pose)) {
      this.visitPending = { ...pose }; this.visitAccepts = accepts; this.visitKind = 'new-visit';
      this.deckWaiting = true; this.deckWaitCount++; this.message = 'Waiting for bridge deck'; return false;
    }
    if (!this.teleport('new-visit', pose, accepts)) {
      if (!this.spawned && !this.allowSpanWait) {
        const hit = this.roads.nearest(pose.x, pose.z, 8000, r => r.kind <= 3 && !r.bridge)
          ?? this.roads.nearest(pose.x, pose.z, 8000, r => r.kind <= 5 && !r.bridge);
        if (hit && nearestDryOnRoad(hit, (px, pz, heading) => {
          const h = this.ground(px, pz);
          if (h === null || h <= this.seaLevel + .08) return false;
          const surface = this.terrain.surfaceAt(px, pz);
          const onDeck = this.roads.deckHeight(px, pz) !== null || surface?.deck === true;
          const coverClass = this.terrain.coverAt?.(px, pz) ?? 0;
          const slope = coverClass === WATER_COVER_CLASS ? localGroundSlope(px, pz, this.ground) : 0;
          return isDryGround({ ground: h, surface, onDeck, seaLevel: this.seaLevel, coverClass, slope })
            && this.teleport('new-visit', { x: px, z: pz, heading }, accepts);
        })) {
          this.message = 'Handbrake on'; return true;
        }
      }
      if (!this.spawned) { this.visitPending = { ...pose }; this.visitAccepts = accepts; this.visitKind = 'new-visit'; }
      return false;
    }
    this.message = 'Handbrake on'; return true;
  }
  /** Start-over and place jumps discard the old visit only after the complete new assembly is valid. */
  restart(x: number, z: number, heading: number, kind: 'start-over' | 'place-jump' = 'start-over', accepts?: (pose: VehiclePlacement) => boolean, onCommit?: () => void): boolean {
    if (![x, z, heading].every(Number.isFinite)) { this.message = 'Invalid destination'; return false; }
    if (this.allowSpanWait && this.waitingOnSpan({ x, z, heading })) {
      this.visitPending = { x, z, heading }; this.visitAccepts = accepts; this.visitCommit = onCommit; this.visitKind = kind;
      this.visitDirty = false; this.deckWaiting = true; this.deckWait = 0; this.spanWaitExhausted = false; this.deckWaitCount++;
      this.message = 'Waiting for bridge deck'; return false;
    }
    const recovered = this.members.filter(m => m.id !== 'truck' && m.state !== 'STRAPPED' && (m.vehicle.y <= this.seaLevel || m.vehicle.atEdge || !this.inside(m.vehicle)));
    if (!this.teleport(kind, { x, z, heading }, accepts)) return false;
    this.message = recovered.length ? 'Recovered to trailer: ' + recovered.map(m => m.entry.name).join(', ') : 'All vehicles back on the trailer';
    return true;
  }
  private inside(v: VehiclePlacement): boolean { const b = this.truck.bounds; return !b || v.x >= b[0] && v.x <= b[2] && v.z >= b[1] && v.z <= b[3]; }
  respawn(): void {
    if (this.deckWaiting && this.spawned) {
      this.visitPending = null; this.visitAccepts = undefined; this.visitCommit = undefined; this.visitDirty = false;
      this.deckWaiting = false; this.deckWait = 0; this.spanWaitExhausted = false;
    }
    if (this.busy) { this.message = 'Finish loading or use Start over to recover the whole rig'; return; }
    if (this.teleport('road-reset')) this.message = `Back on the road: ${this.driven.entry.name}`;
  }
  /** A one-second move between rigs, or a wide view of a loading sequence. No input reaches physics during it. */
  camera(camera: THREE.PerspectiveCamera, dt: number, view: 'chase' | 'seat' = 'chase'): boolean {
    if (this.visitPending && (!this.spawned || this.deckWaiting)) { const p = this.visitPending, h = this.ground(p.x,p.z); camera.position.set(p.x+10,(h??Math.max(5,this.truck.y))+8,p.z+12); camera.lookAt(p.x,(h??0)+1,p.z); return true; }
    if (this.switching && this.switchTo) {
      if (!this.switchCameraReady) {
        this.switchCameraReady = true; this.switchEyeFrom.copy(camera.position); this.switchRotationFrom.copy(camera.quaternion); this.switchFovFrom = camera.fov;
        const m = this.switchTo, v = m.vehicle, s = v.spec.chase, eye = this.switchEyeTo, aim = new THREE.Vector3();
        if (view === 'seat') {
          m.rig.driverEye.getWorldPosition(eye);
          this.switchRotationTo.setFromEuler(new THREE.Euler(v.pitch * (m.id === 'bike' ? 1 : .8), m.id === 'bike' ? m.rig.root.rotation.y : -v.heading, m.id === 'bike' ? v.roll : 0, 'YXZ'));
          this.switchFovTo = m.id === 'bike' ? 74 : 68;
        } else {
          const tow = m.id === 'truck' ? this.tow.camera() : undefined, heading = tow && this.tow.reverseTime > .5 ? tow.heading : v.heading;
          const back = s.back + (tow?.back ?? 0) + Math.min(Math.abs(v.speed) * s.speedBack, s.maxSpeedBack), side = tow?.side ?? 0;
          eye.set(v.x - Math.sin(heading) * back + Math.cos(heading) * side, v.y + s.height + (tow?.height ?? 0), v.z + Math.cos(heading) * back + Math.sin(heading) * side);
          const ground = this.terrain.surfaceAt(eye.x, eye.z);
          if (ground) eye.y = tow?.followGround ? Math.max(ground.ground, this.roads.deckHeight(eye.x, eye.z) ?? -Infinity) + s.height + tow.height : Math.max(eye.y, ground.ground + ground.canopy * .5 + 1.3);
          const ahead = tow ? -tow.lookBack : s.lookAhead;
          aim.set(v.x + Math.sin(v.heading) * ahead + Math.cos(heading) * (tow?.lookSide ?? 0), v.y + s.lookHeight, v.z - Math.cos(v.heading) * ahead + Math.sin(heading) * (tow?.lookSide ?? 0));
          if (tow?.drop !== undefined) aim.y = eye.y - Math.hypot(aim.x - eye.x, aim.z - eye.z) * tow.drop;
          this.switchRotationTo.setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, aim, new THREE.Vector3(0, 1, 0)));
          this.switchFovTo = m.id === 'bike' ? 60 : tow?.fov ?? 58;
        }
      }
      const progress = 1 - this.switching, eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(this.switchEyeFrom, this.switchEyeTo, eased);
      camera.quaternion.slerpQuaternions(this.switchRotationFrom, this.switchRotationTo, eased);
      camera.fov = THREE.MathUtils.lerp(this.switchFovFrom, this.switchFovTo, eased); camera.updateProjectionMatrix(); return true;
    }
    if (!this.plan) return false;
    const target = this.point(0, 3.8).clone(), aim = target.clone(); aim.y += .8;
    target.x += Math.cos(this.tow.heading) * 14 - Math.sin(this.tow.heading) * 4;
    target.z += Math.sin(this.tow.heading) * 14 + Math.cos(this.tow.heading) * 4; target.y += 8;
    camera.position.lerp(target, Math.min(1, dt * 5)); camera.lookAt(aim); camera.fov = 58; camera.updateProjectionMatrix(); return true;
  }
}
