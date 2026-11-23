import {deckCounts} from './bridge-contact';
import {crestVelocity, GRAVITY as G, LEDGE_DROP} from './ground-motion';
import * as THREE from 'three';
import { TRAILER_SPEC as S, createTrailer, type Trailer } from './trailer';
import type { Input, Vehicle, VehiclePlacement } from './vehicle';
import type { Terrain } from './terrain';
import type { Roads } from './roads';
import { CAR_SPEC, type VehicleSpec } from './vehicle-spec';
import type { SchoolBus } from './school-bus';
import { bodyGap, pushOut, pushOutBodies, type ContactBody, type Pushable, type Solid } from './parked';
import type { Yard } from './yard';
import type { RoadScene } from './road-scene';
import type { Props } from './props';
import type { WorldContacts } from './world-contacts';
import { touchesPlayer } from './road-scene-rules';
import { DEFAULT_SEA_LEVEL, WATER_COVER_CLASS, isDryGround, localGroundSlope, unknownGroundHeight } from './water-bounds';

const clamp = THREE.MathUtils.clamp, wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const STEP = 1 / 120;
const POSE_NUMBERS = ['x','z','y','heading','pitch','roll','vy','lateralSpeed','sway','swayRate','reverseTime','jolt','hx','hz','hitchY','yawRate','filteredThumb','previousGround','slopeX','slopeZ'] as const;
const POSE_FLAGS = ['airborne','grounded','samplesReady','supportMissing','jackContact'] as const;
export interface TowWorld { contacts?: WorldContacts; yard?: Yard | null; scene?: RoadScene | null; bus?: SchoolBus | null; props?: Props | null; parked?: () => readonly ContactBody[]; solids?: readonly Solid[] }
/** Optional attachment: construction with attached=false changes no truck state or random-number sequence. */
export class Towing {
  private safe: ReturnType<Towing['snapshot']> | null = null;
  private impactSpeed = 0;
  private impactEvents = 0;
  private readonly bodyProvider = () => this.bodies();
  private model: Trailer | null = null;
  get trailer(): Trailer {
    if (!this.model) {
      this.model = createTrailer(this.loaded, this.low); this.model.root.visible = this.attached;
    }
    return this.model;
  }
  attached = false;
  low = false;
  reason = '';
  help: boolean;
  x = 0; z = 0; y = 0; heading = 0; pitch = 0; roll = 0; vy = 0;
  airborne = false; lateralSpeed = 0; sway = 0; swayRate = 0; clunks = 0; impacts = 0;
  reverseTime = 0;
  onClunk: (() => void) | null = null;
  private jolt = 0;
  private jackContact = false;
  readonly contacts = Array.from({ length: 4 }, () => ({ x: 0, z: 0, y: 0, ground: 0, height: null as number | null, plane: 0 }));
  private previousGround = 0;
  private samplesReady = false;
  private supportMissing = false;
  private readonly groundSamples = Array.from({ length: 4 }, () => ({ x: 0, z: 0, plane: 0, height: 0 }));
  private hitchY = 0;
  private slopeX = 0; private slopeZ = 0;
  private readonly centre = new THREE.Vector3();
  private readonly rotation = new THREE.Matrix4();
  private readonly spinMatrix = new THREE.Matrix4();
  private readonly axle = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly parentInverse = new THREE.Quaternion();
  private readonly wheelRotation = new THREE.Quaternion();
  private previous = { x: 0, z: 0, heading: 0, y: 0 };
  private hx = 0; private hz = 0; private yawRate = 0; private spin = 0; private grounded = false;
  private filteredThumb = 0; private reverseHeading: number | null = null;
  private input: Input = { throttle: 0, steer: 0, handbrake: false };
  private priorGuard: Vehicle['placementGuard'] = null;
  private priorPlaced: Vehicle['onPlaced'] = null;
  private priorBefore: Vehicle['beforeStep'] = null;
  private readonly footprint: VehicleSpec = { ...CAR_SPEC, halfLength: S.halfLength, halfWidth: S.halfWidth, envelope: S.envelope, height: 2.5 };
  private readonly probe: Pushable & { spec: VehicleSpec; y: number; car: { root: { position: { x: number; z: number } } } };
  private readonly local = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly hitchPoint = new THREE.Vector3();
  private readonly groundPoint = { y: 0 };
  private groundX = 0; private groundZ = 0;
  private readonly readGround = () => {
    const deck = this.roads.deckHeight(this.groundX, this.groundZ),g = this.terrain.heightAt(this.groundX, this.groundZ,this.groundPoint.y);
    return g === null ? null : deckCounts(deck,this.groundPoint.y,this.terrain.cartRoads) ? Math.max(g,deck) : g;
  };
  private readonly launchGround = (x: number, z: number, y: number) => this.ground(x, z, y);
  private readonly refined = new Float64Array(4);
  private readonly assistedInput: Input = { throttle: 0, steer: 0, handbrake: false };
  private readonly collectImpact = (speed: number) => { this.impactEvents++; this.impactSpeed = Math.max(this.impactSpeed, speed); };
  private readonly liveBodies: ContactBody[] = [
    { x: 0, z: 0, y: 0, heading: 0, spec: CAR_SPEC, vx: 0, vz: 0 },
    { x: 0, z: 0, y: 0, heading: 0, spec: this.footprint, vx: 0, vz: 0 },
  ];
  private readonly saved = {
    vehicle: { x: 0, z: 0, y: 0, heading: 0, pitch: 0, roll: 0, airborne: false },
    trailer: {} as Record<string, number | boolean>,
    contacts: this.contacts.map(p => ({ ...p })), samples: this.groundSamples.map(p => ({ ...p })),
    bodies: this.liveBodies.map(p => ({ ...p })), ground: null as (() => void) | null, world: [] as (() => void)[],
  };
  private placementTrial: Towing | null = null;
  constructor(readonly vehicle: Vehicle, readonly terrain: Terrain, readonly roads: Roads, readonly loaded = true,
    private readonly touch = false, readonly world: TowWorld = {}, attached = true, low = false) {
    this.low = low;
    this.help = touch; this.liveBodies[0].spec = vehicle.spec; this.saved.bodies[0].spec = vehicle.spec;
    this.probe = { x: 0, z: 0, y: 0, heading: 0, vx: 0, vz: 0, speed: 0, spec: this.footprint,
      car: { root: { position: { x: 0, z: 0 } } }, onSolidImpact: speed => { this.impactEvents++; this.impactSpeed = Math.max(this.impactSpeed, speed); } };
    for (const key of POSE_NUMBERS) this.saved.trailer[key] = this[key];
    for (const key of POSE_FLAGS) this.saved.trailer[key] = this[key];
    if (attached) this.attach();
  }
  attach(): void {
    const v = this.vehicle;
    if (this.attached || !v.spec.hitch || !v.spec.mass) return;
    this.priorGuard = v.placementGuard; this.priorPlaced = v.onPlaced; this.priorBefore = v.beforeStep;
    const pose = { x: v.x, z: v.z, heading: v.heading, y:v.y };
    if (!this.allowPlacement(pose)) { this.reason = 'No room to attach the trailer here.'; return; }
    this.attached = true; this.reason = '';
    if (this.model) this.model.root.visible = true;
    v.towLoad = { mass: this.loaded ? S.loadedMass : S.mass, brakeShare: S.brakeShare, dragShare: S.dragShare, driveMassShare: S.driveMassShare, halfWidth: S.envelope.sweepHalfWidth };
    v.placementGuard = candidate => this.allowPlacement(candidate);
    let placed = false;
    v.onPlaced = () => { this.priorPlaced?.(); placed = this.place(); };
    v.beforeStep = (dt, input) => this.control(dt, this.priorBefore ? this.priorBefore(dt, input) : input);
    v.place(pose.x, pose.z, pose.heading,pose.y);
    if (!placed) { this.detach(); this.reason = 'The trailer placement was refused.'; if (this.model) this.model.root.visible = false; }
    else {
      if (this.world.scene) this.world.scene.coupledBody = this.probe;
      if (this.world.bus) this.world.bus.coupledBody = this.probe;
      if (this.world.yard) this.world.yard.coupledBodies = this.bodyProvider;
    }
  }
  detach(): void {
    if (!this.attached) return;
    const v = this.vehicle; v.towLoad = null; v.placementGuard = this.priorGuard; v.onPlaced = this.priorPlaced; v.beforeStep = this.priorBefore;
    this.vehicle.car.body.position.z = 0;
    if (this.world.scene?.coupledBody === this.probe) this.world.scene.coupledBody = null;
    if (this.world.bus?.coupledBody === this.probe) this.world.bus.coupledBody = null;
    if (this.world.yard?.coupledBodies === this.bodyProvider) this.world.yard.coupledBodies = null;
    this.attached = false;
  }
  /** The host hooks installed before this trailer attached, so an in-place swap never copies trailer guards. */
  cleanHooks(): { placementGuard: Vehicle['placementGuard']; onPlaced: Vehicle['onPlaced'] } {
    return { placementGuard: this.attached ? this.priorGuard : this.vehicle.placementGuard, onPlaced: this.attached ? this.priorPlaced : this.vehicle.onPlaced };
  }
  get angle(): number { return wrap(this.vehicle.heading - this.heading); }
  private hitch(): THREE.Vector3 {
    const v = this.vehicle, h = v.spec.hitch!;
    this.local.set(0, h.height, h.back).applyEuler(this.euler.set(v.pitch, -v.heading, v.roll, 'YXZ'));
    return this.hitchPoint.set(v.x + this.local.x, v.y + this.local.y, v.z + this.local.z);
  }
  private ground(x: number, z: number, y = this.y): number | null {
    this.groundX = x; this.groundZ = z; this.groundPoint.y = y;
    return this.terrain.withGroundContact(this.groundPoint, this.readGround, true);
  }
  /** Compute without installing a scene object or changing the driving vehicle. Used only by placement search. */
  private buildPlacement(): void {
    const v = this.vehicle, h = this.hitch(); this.heading = v.heading;
    this.x = h.x - Math.sin(this.heading) * S.drawbar; this.z = h.z + Math.cos(this.heading) * S.drawbar;
    this.y = this.ground(this.x, this.z,v.y) ?? v.y; this.vy = 0; this.pitch = v.pitch; this.roll = v.roll;
    this.sway = this.swayRate = this.yawRate = this.filteredThumb = this.reverseTime = 0; this.reverseHeading = null;
    this.airborne = false; this.grounded = false; this.jackContact = false; this.hx = h.x; this.hz = h.z; this.hitchY = h.y;
    this.previous.x = v.x; this.previous.z = v.z; this.previous.y = v.y; this.previous.heading = v.heading;
    this.samplesReady = false; this.supportMissing = false;
    for (const p of this.contacts) p.height = null;
    this.attitude(true); this.prepareProbe();
  }
  private copyPose(from: Towing): void {
    for (const key of POSE_NUMBERS) this[key] = from[key];
    for (const key of POSE_FLAGS) this[key] = from[key];
    this.reverseHeading = null; Object.assign(this.previous, from.previous);
    for (let i = 0; i < 4; i++) { Object.assign(this.contacts[i], from.contacts[i]); Object.assign(this.groundSamples[i], from.groundSamples[i]); }
  }
  place(): boolean {
    if (!this.attached) return false;
    // Vehicle.place kept its former pitch/roll; validPair uses those exact values before any installation.
    if (!this.validPair({ x: this.vehicle.x, z: this.vehicle.z, heading: this.vehicle.heading, y:this.vehicle.y })) return false;
    this.copyPose(this.placementTrial!); this.prepareProbe();
    this.rememberValid(); this.update(); return true;
  }
  /** Test the entire pair, never shorten the tongue. Search forward on the same road if blocked. */
  allowPlacement(pose: VehiclePlacement): boolean {
    const original = { ...pose };
    for (const turn of [0, Math.PI]) {
    const start = { ...pose, heading: pose.heading + turn }, road = this.roads.nearest(start.x, start.z, 25);
    for (let distance = 0; distance <= 120; distance += .5) {
      const trial = { ...start };
      if (distance > 0) {
        if (road) {
          const pts = road.road.pts, forward = Math.cos(road.heading - start.heading) >= 0;
          let seg = road.seg, fraction = road.t, remaining = distance;
          while (remaining > 0) {
            const a = pts[seg], b = pts[seg + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const available = length * (forward ? 1 - fraction : fraction);
            if (remaining <= available || (forward ? seg === pts.length - 2 : seg === 0)) {
              fraction = clamp(fraction + (forward ? 1 : -1) * remaining / (length || 1), 0, 1);
              trial.x = a[0] + (b[0] - a[0]) * fraction; trial.z = a[1] + (b[1] - a[1]) * fraction;
              trial.heading = Math.atan2(b[0] - a[0], a[1] - b[1]) + (forward ? 0 : Math.PI); break;
            }
            remaining -= available; seg += forward ? 1 : -1; fraction = forward ? 0 : 1;
          }
        } else { trial.x += Math.sin(start.heading) * distance; trial.z -= Math.cos(start.heading) * distance; }
      }
      if (this.priorGuard) {
        const guarded = { ...trial };
        if (!this.priorGuard(guarded) || Math.hypot(guarded.x - trial.x, guarded.z - trial.z) > 1e-6 || Math.abs(wrap(guarded.heading - trial.heading)) > 1e-6) continue;
      }
      if (!this.validPair(trial)) continue;
      Object.assign(pose, trial); return true;
    }
    }
    Object.assign(pose, original); return false;
  }
  /** Endpoint check for explicit recovery; performs no placement or search. */
  allowsPose(pose: VehiclePlacement): boolean { return this.validPair(pose); }
  private validPair(pose: VehiclePlacement): boolean {
    const v = this.vehicle;
    if (!this.placementTrial) this.placementTrial = new Towing(Object.create(v) as Vehicle, this.terrain, this.roads, this.loaded, this.touch, this.world, false);
    const trial = this.placementTrial, body = trial.vehicle;
    const deck = this.roads.deckHeight(pose.x, pose.z),land = this.terrain.heightAt(pose.x, pose.z,pose.y);
    body.x = pose.x; body.z = pose.z; body.heading = pose.heading; body.y = land === null ? v.y : deckCounts(deck,pose.y??land,this.terrain.cartRoads) ? Math.max(land,deck) : land;
    body.pitch = v.pitch; body.roll = v.roll; body.vx = body.vz = body.vy = body.speed = 0;
    trial.buildPlacement();
    if (!trial.pairClear()) return false;
    // Placement adds water and full-body map margins to the SAME final-pose contact test used by each step.
    const bodies = trial.bodies(), bounds = v.bounds, waitingRoad = land === null && this.roads.nearest(pose.x, pose.z, 30) !== null;
    for (const p of bodies) {
      const fx = Math.sin(p.heading), fz = -Math.cos(p.heading), spec = p.spec;
      if (this.world.scene?.rules.enabled) for (const solid of this.world.scene.placementSolids) if (touchesPlayer(solid, p, .35, spec)) return false;
      if (this.world.bus) for (const solid of this.world.bus.placementSolids) if (touchesPlayer(solid, p, .35, spec)) return false;
      for (const a of [-spec.halfLength, 0, spec.halfLength]) for (const w of [-spec.halfWidth, spec.halfWidth]) {
        const x = p.x + fx * a + Math.cos(p.heading) * w, z = p.z + fz * a + Math.sin(p.heading) * w;
        if (bounds && (x < bounds[0] || x > bounds[2] || z < bounds[1] || z > bounds[3])) return false;
        const g = this.ground(x, z,p.y);
        if(g===null){if(!waitingRoad)return false;continue;}
        // The pose's own height picks the deck or the land under it (#6); #130's dry-ground rule then judges it.
        const deck=this.roads.deckHeight(x,z),surface=this.terrain.surfaceAt?.(x,z,p.y)??null;
        const onDeck=(deck!==null&&Math.abs(g-deck)<.02)||(surface?.deck===true&&Math.abs(surface.ground-g)<.02);
        const sea=typeof this.terrain.seaLevel==='number'?this.terrain.seaLevel:DEFAULT_SEA_LEVEL;
        const coverClass=this.terrain.coverAt?.(x,z)??0;
        const slope=coverClass===WATER_COVER_CLASS?localGroundSlope(x,z,(px,pz)=>this.ground(px,pz,p.y)):0;
        if(!isDryGround({ground:g,surface,onDeck,seaLevel:sea,coverClass,slope})||this.terrain.waterAt?.(x,z,g,onDeck))return false;
      }
    }
    return true;
  }
  /** Side-offset circles may extend beyond the nominal body rectangle (for example exposed tyres). */
  private lateralCirclesInBounds(p: VehiclePlacement, spec: VehicleSpec): boolean {
    const bounds = this.vehicle.bounds, env = spec.envelope;
    if (!bounds || !env.circleSides) return true;
    const sin = Math.sin(p.heading), cos = Math.cos(p.heading);
    for (let i = 0; i < env.circles.length; i++) {
      const a = env.circles[i], side = env.circleSides[i] ?? 0;
      const x = p.x + sin * a + cos * side, z = p.z - cos * a + sin * side;
      if (x - env.radius < bounds[0] - 1e-7 || x + env.radius > bounds[2] + 1e-7 || z - env.radius < bounds[1] - 1e-7 || z + env.radius > bounds[3] + 1e-7) return false;
    }
    return true;
  }
  /** A thumb chooses trailer curvature. Stabilise hitch angle and reject short accidental thumb movements. */
  control(dt: number, input: Input): Input {
    if (!this.attached) return input;
    this.input = input;
    const v = this.vehicle;
    this.reverseTime = input.throttle < 0 && v.speed < .2 ? Math.min(2, this.reverseTime + dt) : 0;
    if (!this.help || input.throttle >= 0 && v.speed > -.2 || v.speed > .2) { this.reverseHeading = null; this.filteredThumb = 0; return input; }
    this.filteredThumb += (input.steer - this.filteredThumb) * Math.min(1, dt * 3);
    const thumb = Math.abs(this.filteredThumb) < .065 ? 0 : this.filteredThumb;
    // Desired heading increases for left thumb: the reversing tail then moves left.
    if (this.reverseHeading === null) this.reverseHeading = this.heading;
    const curvature = -thumb * .075;
    this.reverseHeading += Math.abs(v.speed) * curvature * dt;
    const headingError = clamp(wrap(this.reverseHeading - this.heading), -.4, .4);
    const desiredRate = Math.abs(v.speed) * (curvature + .6 * headingError);
    const k = desiredRate / Math.min(-.7, v.speed), hitchBack = v.spec.hitch!.back;
    const desiredAngle = clamp(Math.atan(k * hitchBack) + Math.asin(clamp(k * S.drawbar / Math.sqrt(1 + (k * hitchBack) ** 2), -.85, .85)), -.90, .90);
    const error = wrap(this.angle - desiredAngle);
    // For reversing, positive wheel lock makes truck heading decrease and reduces positive articulation.
    const yaw = desiredRate - error * Math.max(.8, Math.abs(v.speed) * .45);
    const wheel = Math.atan(yaw * v.spec.wheelbase / Math.min(-.7, v.speed));
    const out = this.assistedInput;
    out.throttle = input.throttle; out.handbrake = input.handbrake; out.touch = input.touch; out.steer = clamp(wheel / v.spec.maxSteer, -1, 1);
    return out;
  }
  /** Called once after each production 120 Hz truck step and its contacts. */
  step(dt = STEP): void {
    if (!this.attached) return;
    const v = this.vehicle, h = this.hitch();
    if (Math.hypot(v.x - this.previous.x, v.z - this.previous.z) > 8 || !Number.isFinite(this.heading)) { this.place(); return; }
    dt = clamp(dt, 0, .1); if (!dt) return;
    const ux = (h.x - this.hx) / dt, uz = (h.z - this.hz) / dt, speed = Math.hypot(ux, uz);
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = Math.cos(this.heading), rz = Math.sin(this.heading);
    let mu = 0;
    for (const wheel of this.contacts) {
      const surface = this.terrain.surfaceAt(wheel.x, wheel.z,wheel.y);
      mu += (surface && surface.roadDist <= surface.halfWidth + .4 ? surface.washboard ? .38 : surface.kind <= 2 || surface.kind === 9 || surface.kind === 13 ? 1 : .72 : .5) / 4;
    }
    const truckYaw = wrap(v.heading - this.previous.heading) / dt;
    const high = clamp((speed - 95 / 3.6) / 9, 0, 1);
    this.swayRate += (-25 * this.sway - 2.5 * this.swayRate + high * (truckYaw - this.yawRate) / dt * 1.4) * dt;
    this.swayRate = clamp(this.swayRate, -.25, .25); this.sway = clamp(this.sway + this.swayRate * dt, -.065, .065);
    this.yawRate = truckYaw;
    const rate = (ux * rx + uz * rz) / S.drawbar;
    const gripRate = mu * 9.81 / Math.max(2, speed);
    this.heading = wrap(this.heading + clamp(rate, -gripRate, gripRate) * dt + this.swayRate * dt);
    this.lateralSpeed = ux * rx + uz * rz - S.drawbar * clamp(rate, -gripRate, gripRate);
    if (Math.abs(this.angle) >= S.jackknife) {
      this.heading = wrap(v.heading - Math.sign(this.angle) * S.jackknife);
      if (v.speed < 0) {
        if (!this.jackContact) { this.clunks++; v.onSolidImpact(Math.abs(v.speed)); this.jolt = .07; this.onClunk?.(); }
        this.jackContact = true;
        v.x = this.previous.x; v.z = this.previous.z; v.heading = this.previous.heading;
        v.vx = v.vz = v.speed = 0; v.steerAngle *= .8;
        this.heading = wrap(v.heading - Math.sign(this.angle) * S.jackknife);
      }
      this.sway = this.swayRate = 0;
    } else if (Math.abs(this.angle) < S.jackknife - .02 || v.speed > .2) this.jackContact = false;
    const hitch = this.hitch();
    this.x = hitch.x - Math.sin(this.heading) * S.drawbar; this.z = hitch.z + Math.cos(this.heading) * S.drawbar;
    // Start from the coupled axle position, not a horizontal approximation, before sampling its wheels.
    this.solveCoupler(); this.attitude(false, dt);
    this.collide(dt);
    const now = this.hitch(); this.hx = now.x; this.hz = now.z; this.hitchY = now.y;
    this.previous.x = v.x; this.previous.z = v.z; this.previous.y = v.y; this.previous.heading = v.heading;
    this.spin -= (ux * fx + uz * fz) * dt / S.wheelRadius;
  }
  /** New tile detail is measured at the old world contacts, under their original deck-eligibility plane. */
  private correctGround(): void {
    if (!this.samplesReady) return;
    let correction = 0;
    for (let i = 0; i < 4; i++) {
      const p = this.groundSamples[i], now = this.ground(p.x, p.z, p.plane);
      if (now === null) return;
      this.refined[i] = now; correction += (now - p.height) / 4;
    }
    this.y += correction; this.previousGround += correction;
    for (let i = 0; i < 4; i++) this.groundSamples[i].height = this.refined[i];
  }
  private solveCoupler(): void {
    const h = this.hitch(), a = S.couplerHeight * Math.cos(this.roll), radius = Math.hypot(a, S.drawbar);
    // A vertical constraint can lift the axle; it cannot stretch the drawbar.
    const bounded = clamp(this.y, h.y - radius + .0001, h.y + radius - .0001);
    if (Math.abs(bounded - this.y) > 1e-8) { this.y = bounded; this.vy = this.vehicle.vy; this.airborne = true; }
    this.pitch = Math.asin(clamp((h.y - this.y) / radius, -1, 1)) - Math.atan2(a, S.drawbar);
    this.local.set(0, S.couplerHeight, -S.drawbar).applyEuler(this.euler.set(this.pitch, -this.heading, this.roll, 'YXZ'));
    this.x = h.x - this.local.x; this.z = h.z - this.local.z;
  }
  private attitude(placing: boolean, dt = STEP): void {
    if (!placing) this.correctGround();
    this.euler.set(this.pitch, -this.heading, this.roll, 'YXZ');
    const sea = typeof this.terrain.seaLevel === 'number' ? this.terrain.seaLevel : DEFAULT_SEA_LEVEL;
    let total = 0, known = true;
    for (let i = 0; i < 4; i++) {
      const p = this.contacts[i];
      const z = i < 2 ? -S.axleSpacing / 2 : S.axleSpacing / 2, x = i % 2 ? S.track / 2 : -S.track / 2;
      // Sample the projected wheel contact, so the cached patch and the drawn axle cover the same land.
      this.local.set(x, 0, z).applyEuler(this.euler);
      p.x = this.x + this.local.x; p.z = this.z + this.local.z; p.plane = this.y + this.local.y;
      p.height = this.ground(p.x, p.z, placing ? undefined : p.plane);
      if (p.height === null) {
        known = false;
        if (!placing && this.grounded) p.ground = unknownGroundHeight(sea);
      } else p.ground = p.height;
      total += p.ground / 4;
    }
    if (!known && (placing || !this.grounded)) {
      // Unknown support before first settling is not a fall or a landing. Carry the last pose with the moving hitch.
      this.supportMissing = true;
      this.y += this.hitch().y - this.hitchY; this.vy = this.vehicle.vy;
      this.solveCoupler(); return;
    }
    if (known) {
      for (let i = 0; i < 4; i++) { const p = this.groundSamples[i], contact = this.contacts[i]; p.x = contact.x; p.z = contact.z; p.plane = contact.plane; p.height = contact.height!; }
      this.samplesReady = true;
    }
    const { vx, vz } = this.vehicle;
    let launch: number | null = null;
    if (!placing && this.grounded && known && !this.supportMissing && !this.airborne
      && vx * vx + vz * vz > .05 ** 2
      && (Math.abs(total - this.previousGround) > .015 || this.y - total >= LEDGE_DROP / 2)) {
      const centre = this.ground(this.x, this.z);
      launch = crestVelocity(this.launchGround, this.x, this.z, vx, vz, dt, centre, this.y);
      if (launch !== null) {
        this.y = Math.max(this.y, total, centre ?? total);
        this.vy = launch;
      }
    }
    this.supportMissing = false; this.previousGround = total;
    const free = this.y + this.vy * dt - .5 * G * dt * dt;
    if (launch !== null || !placing && this.grounded && this.airborne && free > total + (this.vy > 0 ? 0 : .05)) {
      this.y = free; this.vy -= G * dt; this.airborne = true;
    }
    else {
      if (this.airborne && this.vy < -3) { this.vehicle.vx *= .96; this.vehicle.vz *= .96; this.vehicle.speed *= .96; }
      this.y = total; this.vy = 0; this.airborne = false;
    }
    this.fitPlane();
    this.grounded = true;
    this.solveCoupler();
  }
  private fitPlane(): void {
    const p = this.contacts;
    const ax = (p[1].x + p[3].x - p[0].x - p[2].x) / 2, az = (p[1].z + p[3].z - p[0].z - p[2].z) / 2;
    const bx = (p[2].x + p[3].x - p[0].x - p[1].x) / 2, bz = (p[2].z + p[3].z - p[0].z - p[1].z) / 2;
    const ah = (p[1].ground + p[3].ground - p[0].ground - p[2].ground) / 2;
    const bh = (p[2].ground + p[3].ground - p[0].ground - p[1].ground) / 2, det = ax * bz - az * bx;
    if (Math.abs(det) < 1e-6) return;
    this.slopeX = (ah * bz - az * bh) / det; this.slopeZ = (ax * bh - ah * bx) / det;
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    this.roll = Math.atan2(this.slopeX * cos + this.slopeZ * sin, Math.hypot(1, -this.slopeX * sin + this.slopeZ * cos));
  }
  /** Parking releases thumb filtering and reverse-camera history without changing the pair's pose. */
  resetControls(): void {
    this.reverseTime = this.filteredThumb = 0; this.reverseHeading = null;
    this.input.throttle = this.input.steer = this.assistedInput.throttle = this.assistedInput.steer = 0;
    this.input.handbrake = this.assistedInput.handbrake = true;
  }
  /** Refresh vertical support without re-placing or straightening an articulated parked pair. */
  settleGround(): void { this.correctGround(); this.solveCoupler(); this.update(); }
  private prepareProbe(): void {
    const p = this.probe, v = this.vehicle;
    p.x = this.x - Math.sin(this.heading) * S.bodyOffset; p.z = this.z + Math.cos(this.heading) * S.bodyOffset;
    p.y = this.y; p.heading = this.heading; p.vx = v.vx; p.vz = v.vz; p.speed = v.speed;
  }
  /** Live truck and trailer envelopes, shared with nearby AI. */
  bodies(): ContactBody[] {
    const v = this.vehicle, truck = this.liveBodies[0], trailer = this.liveBodies[1];
    truck.x = v.x; truck.z = v.z; truck.y = v.y; truck.heading = v.heading; truck.vx = v.vx; truck.vz = v.vz;
    trailer.x = this.x - Math.sin(this.heading) * S.bodyOffset; trailer.z = this.z + Math.cos(this.heading) * S.bodyOffset;
    trailer.y = this.y; trailer.heading = this.heading; trailer.vx = v.vx; trailer.vz = v.vz;
    return this.liveBodies;
  }
  private pairClear(): boolean {
    const bodies = this.bodies();
    for (const p of bodies) {
      if (!this.lateralCirclesInBounds(p, p.spec)) return false;
      if (this.world.contacts && !this.world.contacts.allows(p)) return false;
      if (this.world.solids) for (const solid of this.world.solids) if (touchesPlayer(solid, p, -1e-7, p.spec)) return false;
      if (this.world.yard?.allowsBody?.(p, p.spec, p.y) === false) return false;
      if (this.world.scene?.rules.enabled) for (const solid of this.world.scene.placementSolids) if (touchesPlayer(solid, p, -1e-7, p.spec)) return false;
      if (this.world.parked) for (const parked of this.world.parked()) if (bodyGap(p, parked) < -1e-7) return false;
      if (this.world.bus) for (const solid of this.world.bus.placementSolids) if (touchesPlayer(solid, p, -1e-7, p.spec)) return false;
    }
    const b = this.vehicle.bounds;
    if (b) {
      const v = this.vehicle, p = bodies[1], fx = Math.sin(p.heading), fz = Math.cos(p.heading);
      const ex = Math.abs(fx) * S.halfLength + Math.abs(fz) * S.halfWidth, ez = Math.abs(fz) * S.halfLength + Math.abs(fx) * S.halfWidth;
      if (v.x < b[0] - 1e-7 || v.x > b[2] + 1e-7 || v.z < b[1] - 1e-7 || v.z > b[3] + 1e-7 || p.x < b[0] + ex - 1e-7 || p.x > b[2] - ex + 1e-7 || p.z < b[1] + ez - 1e-7 || p.z > b[3] - ez + 1e-7) return false;
    }
    return true;
  }
  private snapshot() {
    const v = this.vehicle, saved = this.saved, bodies = this.bodies();
    saved.vehicle.x = v.x; saved.vehicle.z = v.z; saved.vehicle.y = v.y; saved.vehicle.heading = v.heading;
    saved.vehicle.pitch = v.pitch; saved.vehicle.roll = v.roll; saved.vehicle.airborne = v.airborne;
    for (const key of POSE_NUMBERS) saved.trailer[key] = this[key];
    for (const key of POSE_FLAGS) saved.trailer[key] = this[key];
    for (let i = 0; i < 4; i++) { Object.assign(saved.contacts[i], this.contacts[i]); Object.assign(saved.samples[i], this.groundSamples[i]); }
    Object.assign(saved.bodies[0], bodies[0]); Object.assign(saved.bodies[1], bodies[1]);
    saved.ground = v.checkpointGround(); saved.world.length = 0;
    if (this.world.yard?.captureTowMotion) saved.world.push(this.world.yard.captureTowMotion(saved.bodies));
    if (this.world.scene?.captureTowMotion) saved.world.push(this.world.scene.captureTowMotion(saved.bodies));
    if (this.world.bus) saved.world.push(this.world.bus.captureTowMotion(saved.bodies));
    return saved;
  }
  private rememberValid(): void { this.safe = this.snapshot(); }
  private restoreValid(): void {
    const old = this.safe; if (!old) return;
    Object.assign(this.vehicle, old.vehicle); Object.assign(this, old.trailer);
    for (let i = 0; i < 4; i++) { Object.assign(this.contacts[i], old.contacts[i]); Object.assign(this.groundSamples[i], old.samples[i]); }
    for (const restore of old.world) restore();
    old.ground!(); this.correctGround(); this.solveCoupler();
    this.vehicle.vx = this.vehicle.vz = this.vehicle.vy = this.vehicle.speed = this.vy = 0;
  }
  private collide(dt: number): void {
    const v = this.vehicle, notify = v.onSolidImpact;
    this.impactSpeed = 0; v.onSolidImpact = this.collectImpact;
    try {
      // An actor's proposed move cannot displace a valid stationary rig into another contact.
      if (this.safe) for (const restore of this.safe.world) restore();
      for (let pass = 0; pass < 12; pass++) {
        this.projectTrailer(pass === 0 ? dt : 0);
        const tx = v.x, tz = v.z;
        this.world.contacts?.resolve(v);
        this.world.yard?.resolveTowBody(v); this.world.yard?.resolveSolids(v, true);
        if (this.world.solids) pushOut(v, this.world.solids, true);
        if (this.world.scene?.rules.enabled) pushOut(v, this.world.scene.placementSolids, true);
        if (this.world.parked) pushOutBodies(v, this.world.parked());
        if (this.world.bus) pushOut(v, this.world.bus.placementSolids, true);
        const bounds = v.bounds;
        if (bounds) { v.x = clamp(v.x, bounds[0], bounds[2]); v.z = clamp(v.z, bounds[1], bounds[3]); }
        const dx = v.x - tx, dz = v.z - tz; this.x += dx; this.z += dz;
        if (Math.hypot(dx, dz) > 1e-7) v.vx = v.vz = v.speed = 0;
        if (this.pairClear()) break;
      }
      if (!this.pairClear()) this.restoreValid();
      // A newly built static scene has no old clear pose; use the same full-pair placement guard.
      if (!this.pairClear()) {
        this.recoverPlacement();
      }
      this.prepareProbe(); this.rememberValid();
    } finally { v.onSolidImpact = notify; }
    if (this.impactSpeed > 0) { this.impacts++; notify.call(v, this.impactSpeed); }
  }
  private recoverPlacement(): void {
    const v = this.vehicle, pose = { x: v.x, z: v.z, heading: v.heading, y:v.y };
    if (!this.allowPlacement(pose)) throw new Error('No clear coupled pose after static scene change');
    v.place(pose.x, pose.z, pose.heading,pose.y);
  }
  private projectTrailer(dt: number): void {
    const v = this.vehicle, p = this.probe, fx = Math.sin(this.heading), fz = -Math.cos(this.heading);
    p.x = this.x - fx * S.bodyOffset; p.z = this.z - fz * S.bodyOffset; p.y = this.y;
    p.heading = this.heading; p.vx = v.vx; p.vz = v.vz; p.speed = v.speed;
    const oldX = p.x, oldZ = p.z, impactBefore = this.impactSpeed;
    const rails = this.roads.guardrails;
    rails?.clearBridgeHit();
    this.world.contacts?.resolve(p);
    const contactEvents = this.impactEvents;
    const activeSites = this.world.contacts && 'lastActiveSites' in this.world.contacts ? (this.world.contacts as { lastActiveSites: number }).lastActiveSites : 1;
    const bridgeOnly = activeSites === 1 && rails?.bridgeHitMatches(p, p.x - oldX, p.z - oldZ) === true;
    let otherHit = false, px = p.x, pz = p.z, pvx = p.vx, pvz = p.vz;
    this.world.yard?.resolveTowBody(p);
    if (p.x !== px || p.z !== pz || p.vx !== pvx || p.vz !== pvz) { otherHit = true; px = p.x; pz = p.z; pvx = p.vx; pvz = p.vz; }
    if (this.world.solids) { pushOut(p, this.world.solids, true); if (p.x !== px || p.z !== pz || p.vx !== pvx || p.vz !== pvz) { otherHit = true; px = p.x; pz = p.z; pvx = p.vx; pvz = p.vz; } }
    const scene = this.world.scene;
    if (scene?.rules.enabled) { pushOut(p, scene.placementSolids, true); if (p.x !== px || p.z !== pz || p.vx !== pvx || p.vz !== pvz) { otherHit = true; px = p.x; pz = p.z; pvx = p.vx; pvz = p.vz; } }
    if (this.world.parked) { pushOutBodies(p, this.world.parked()); if (p.x !== px || p.z !== pz || p.vx !== pvx || p.vz !== pvz) { otherHit = true; px = p.x; pz = p.z; pvx = p.vx; pvz = p.vz; } }
    if (this.world.bus) { pushOut(p, this.world.bus.placementSolids, true); if (p.x !== px || p.z !== pz || p.vx !== pvx || p.vz !== pvz) { otherHit = true; px = p.x; pz = p.z; pvx = p.vx; pvz = p.vz; } }
    const factor = dt > 0 ? this.world.props?.hitCar(p.x, p.z, p.heading, p.vx, p.vz, oldX - p.vx * dt, oldZ - p.vz * dt, this.footprint) ?? 1 : 1;
    if (factor !== 1) otherHit = true;
    const b = v.bounds;
    if (b) {
      const ex = Math.abs(fx) * S.halfLength + Math.abs(Math.cos(this.heading)) * S.halfWidth;
      const ez = Math.abs(fz) * S.halfLength + Math.abs(Math.sin(this.heading)) * S.halfWidth;
      p.x = clamp(p.x, b[0] + ex, b[2] - ex); p.z = clamp(p.z, b[1] + ez, b[3] - ez);
      if (p.x !== px || p.z !== pz) otherHit = true;
    }
    const dx = p.x - oldX, dz = p.z - oldZ;
    const ponyGraze = bridgeOnly && !otherHit && this.impactEvents === contactEvents;
    if (Math.hypot(dx, dz) > 1e-7) {
      // Move the coupled pair out together, then kill the velocity into the contact through the hitch.
      v.x += dx; v.z += dz; this.x += dx; this.z += dz;
      const normal = Math.hypot(dx, dz), into = (v.vx * dx + v.vz * dz) / normal;
      if (into < 0) {
        this.impactSpeed = Math.max(this.impactSpeed, -into);
        // Preserve tangential slide only on shallow pony-truss rail grazes; ordinary contacts stop as before.
        if (ponyGraze && -into <= Math.hypot(v.vx, v.vz) * 0.65) {
          v.vx -= (dx / normal) * into; v.vz -= (dz / normal) * into;
          v.speed = v.vx * Math.sin(v.heading) - v.vz * Math.cos(v.heading);
        } else { v.vx = v.vz = v.speed = 0; }
      } else if (this.impactSpeed > impactBefore && !ponyGraze) { v.vx = v.vz = v.speed = 0; }
    } else {
      v.vx = p.vx; v.vz = p.vz; v.speed = p.speed;
      if (this.impactSpeed > impactBefore) v.vx = v.vz = v.speed = 0;
    }
    v.vx *= factor; v.vz *= factor; v.speed *= factor;
  }
  /** Drawing uses only the four cached contact heights. Rays and tread scans belong in tests. */
  update(): void {
    if (!this.attached) return;
    const model = this.trailer, r = model.root;
    r.position.set(this.x, this.y, this.z); r.rotation.set(this.pitch, -this.heading, this.roll); r.updateMatrixWorld(true);
    this.spinMatrix.makeRotationX(this.spin);
    r.getWorldQuaternion(this.parentInverse).invert();
    this.up.set(-this.slopeX, 1, -this.slopeZ).normalize();
    this.axle.set(Math.cos(this.heading), 0, Math.sin(this.heading)).addScaledVector(this.up, -(Math.cos(this.heading) * this.up.x + Math.sin(this.heading) * this.up.z)).normalize();
    this.back.crossVectors(this.axle, this.up).normalize();
    this.rotation.makeBasis(this.axle, this.up, this.back).multiply(this.spinMatrix);
    this.wheelRotation.setFromRotationMatrix(this.rotation);
    for (let i = 0; i < 4; i++) {
      const z = i < 2 ? -S.axleSpacing / 2 : S.axleSpacing / 2, x = i % 2 ? S.track / 2 : -S.track / 2;
      const wheel = model.wheels[i];
      if (this.airborne || this.supportMissing) { wheel.position.set(x, S.wheelRadius, z); wheel.rotation.set(this.spin, 0, 0); continue; }
      this.centre.set(x, 0, z).applyMatrix4(r.matrixWorld);
      const contact = this.contacts[i];
      this.centre.y = contact.ground + this.slopeX * (this.centre.x - contact.x) + this.slopeZ * (this.centre.z - contact.z);
      this.centre.addScaledVector(this.up, S.wheelRadius);
      this.contacts[i].y = this.centre.y;
      this.local.copy(this.centre); r.worldToLocal(this.local); wheel.position.copy(this.local);
      wheel.quaternion.copy(this.parentInverse).multiply(this.wheelRotation);
    }
    const braking = this.input.handbrake || this.input.throttle * this.vehicle.speed < -.1;
    this.vehicle.car.body.position.z = this.jolt; this.jolt *= .55;
    const intensity = braking ? 2.5 : .3;
    for (let i = 0; i < model.tailLamps.length; i++) (model.tailLamps[i].material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
    for (let i = 0; i < this.vehicle.car.brakeLights.length; i++) (this.vehicle.car.brakeLights[i].material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
  }
  camera(): { back: number; side: number; height: number; lookBack: number; lookSide: number; heading: number; followGround: boolean; drop?: number; fov: number } | undefined {
    if (!this.attached) return undefined;
    const reversing = this.reverseTime > .5;
    const v = this.vehicle, chase = v.spec.chase;
    const speedBack = Math.min(Math.abs(v.speed) * chase.speedBack, chase.maxSpeedBack);
    const back = reversing ? 4.2 : Math.max(6.4, (this.touch ? 18.2 : 18.55) - chase.back - speedBack);
    let side = reversing ? 8 : this.touch ? -5 : -4.8;
    const road = this.roads.nearest(v.x, v.z, 15, r => r.kind <= 3);
    if (!reversing && road && road.road.halfWidth < 3.2) {
      let heading = road.heading; if (Math.cos(heading - v.heading) < 0) heading += Math.PI;
      const lane = (v.x - road.x) * Math.cos(heading) + (v.z - road.z) * Math.sin(heading);
      side = Math.max(side, -.6 - lane);
    }
    return { back, side, height: reversing ? 1.8 : 1.5, lookBack: reversing ? 6 : -.5, lookSide: reversing ? -3.5 : 0,
      heading: reversing ? this.heading : v.heading, followGround: !reversing, drop: reversing ? undefined : .19,
      fov: reversing ? 58 : this.touch ? 52 : 54 };
  }
}

export function trailerHelpSetting(tow: Towing, panel: HTMLElement | null, before: HTMLElement | null): void {
  try { const saved = localStorage.getItem('mmm.trailerHelp'); if (saved !== null) tow.help = saved === 'on'; } catch { /* this visit only */ }
  // Unlock a short, quiet mechanical clunk only after the player's first gesture.
  let audio: AudioContext | null = null;
  const warm = () => { try { audio ??= new AudioContext(); void audio.resume().catch(() => {}); } catch { /* audio is optional */ } };
  window.addEventListener('pointerdown', warm, { once: true }); window.addEventListener('keydown', warm, { once: true });
  tow.onClunk = () => {
    if (!audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(95, audio.currentTime); oscillator.frequency.exponentialRampToValueAtTime(32, audio.currentTime + .1);
    gain.gain.setValueAtTime(.055, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .12);
    oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + .13);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  };
  if (!panel) return;
  const group = document.createElement('div'); group.id = 'trailerHelp'; group.style.marginTop = '12px';
  group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Trailer help');
  const title = document.createElement('div'); title.textContent = 'Trailer help';
  const hint = document.createElement('div'); hint.textContent = 'In reverse, steer where the trailer tail should go.'; hint.style.cssText = 'font-size:12px;margin:6px 0';
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px';
  const buttons = [true, false].map(on => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = on ? 'On' : 'Off';
    button.dataset.trailerHelp = on ? 'on' : 'off'; button.style.cssText = 'flex:1;min-height:36px;border:1px solid #6b7780;border-radius:6px;color:inherit;font:inherit';
    button.onclick = () => { tow.help = on; try { localStorage.setItem('mmm.trailerHelp', on ? 'on' : 'off'); } catch { /* this visit only */ } show(); };
    return button;
  });
  const show = () => buttons.forEach((b, i) => { const selected = tow.help === (i === 0); b.setAttribute('aria-pressed', String(selected)); b.style.background = selected ? '#3d6f8f' : 'none'; });
  row.append(...buttons); group.append(title, hint, row); panel.insertBefore(group, before); show();
}
