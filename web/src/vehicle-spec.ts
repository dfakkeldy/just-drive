import type * as THREE from 'three';
import type { DriftSpec } from './drift-rules';

/** Shared specs contain only plain data; copied variants remain legal inputs. */
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** Freeze the complete shared spec, including nested objects and numeric lists. */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Metres, seconds, radians; acceleration and power are per unit mass. Shared surface rules stay in Vehicle. */
export type VehicleSpec = DeepReadonly<{
  /** Absent for motors: their arithmetic and random sequence stay unchanged. */
  locomotion?: 'horse';
  wheelbase: number; track: number; rearTrack?: number; wheelRadius: number;
  /** Project the body's contact height to each axle (0 retains the original compact-car guard). */
  contactPlane: number;
  halfLength: number; halfWidth: number; height: number; mass?: number;
  /**
   * What other things collide with: an approximate, arcade shape. Circles along the centre line (offsets in
   * metres, positive forward) of one radius. Optional circleSides can offset centres right/left. Along the sides, neighbours should stand close enough that a solid
   * cannot pass between them into the widest part of the body; both ends are rounded, so a thin solid can enter
   * a corner of the drawn body before it touches (up to about half a metre at the truck's bumper corners; the
   * car's own three circles are looser than that along its sides). The other numbers are stored, not derived,
   * so that the car keeps the exact literals it had before there was a spec.
   */
  envelope: {
    circles: readonly number[]; radius: number;
    /** Optional rightward offset for each centre. Omitted retains the legacy centreline arithmetic. */
    circleSides?: readonly number[];
    /** Solids further than this from the centre are skipped before the circle test. */
    reach: number;
    /** The rectangle swept against mailboxes and posts. */
    sweepHalfWidth: number; sweepHalfLength: number;
    /** A loose yard piece higher than this above the ground passes over the body. */
    overhead: number;
    /** The rectangle of grass pressed flat. */
    grassHalfWidth: number; grassHalfLength: number;
    /** How far past the map wall the barricade stands, so the nose stops short of the boards. */
    nose: number;
  };
  engineAcceleration: number; enginePower: number; tractionShare: number;
  reverseSpeed: number; reverseAcceleration: number; brake: number; handbrake: number; aeroDrag: number;
  cornering: number; maxSteer: number; steerBaseRate: number; steerSpeedRate: number; steerSpeedScale: number; steerReturnRate: number;
  gripLock: number; landingForward: number; landingSideways: number;
  pitchGain: number; pitchLimit: number; rollGain: number; rollLimit: number; leanRate: number;
  shakePitch: number; shakeRoll: number; shakeHeight: number; washboardYaw: number; washboardSideways: number;
  hardSteerDrag: number;
  /** Fraction of lateral inertia retained during yaw; omitted preserves the original arcade velocity rotation. */
  lateralInertia?: number;
  chase: { back: number; height: number; lookAhead: number; lookHeight: number; speedBack: number; maxSpeedBack: number };
  /** Coupler point, positive back from the root, used only by an attached towing body. */
  hitch?: { back: number; height: number };
  /** How this ride slides (drift-rules.ts). Absent: it never drifts (the dirt bike and the horse). */
  drift?: DriftSpec;
}>;

/** A replaceable visual body. Wheel spin is local X; each front wheel has its own Y steering parent. */
export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  wheels: { fl: THREE.Object3D; fr: THREE.Object3D; rl: THREE.Object3D; rr: THREE.Object3D };
  extraWheels?: THREE.Object3D[];
  steer: { fl: THREE.Object3D; fr: THREE.Object3D };
  driverEye: THREE.Object3D;
  /** Optional delivery hand; absent retains the original window throw. */
  mailOrigin?: THREE.Object3D;
  brakeLights: THREE.Mesh[];
  /** A head lamp batched into a model's one draw (night.ts finds other lamps by their parts): `beam` is where the night's
   * beam starts, aimed along its -z (on a steered part, it turns with it); `lens` is the light the lens gives off. */
  headlamp?: { beam: THREE.Object3D; lens: THREE.Color };
  beacon?: THREE.Mesh;
  signLight?: THREE.Mesh;
  driverWindow?: THREE.Mesh;
  /** Called after body placement, using the controller's deck-aware drawn-ground query. */
  animate?(dt: number, speed: number, ground: (x: number, z: number) => number | null, groundRevision?: number): void;
  resetPose?(): void;
  setWindowDown?(down: boolean): void;
  setDirt?(amount: number): void;
  /** Wheel offsets from the sprung body plane, in metres; positive compresses the suspension. */
  setTravel?(fl: number, fr: number, rl: number, rr: number): void;
  checkpointPose?(): () => void;
  setRiderVisible?(visible: boolean): void;
}

/** The original car, with the original arithmetic constants (including its three-circle collision envelope). */
export const CAR_SPEC: VehicleSpec = deepFreeze({
  wheelbase: 2.62, track: 1.57, wheelRadius: 0.35,
  contactPlane: 0, halfLength: 2.3, halfWidth: 0.95, height: 1.955,
  envelope: { circles: [-1.35, 0, 1.35], radius: 0.95, reach: 3.4, sweepHalfWidth: .96, sweepHalfLength: 2.31, overhead: 1.3, grassHalfWidth: 1.35, grassHalfLength: 2.8, nose: 3.2 },
  engineAcceleration: 4.8, enginePower: 95, tractionShare: 0.62,
  reverseSpeed: 9, reverseAcceleration: 2.6, brake: 9.5, handbrake: 5.5, aeroDrag: 0.001,
  cornering: 1.7, maxSteer: 0.6, steerBaseRate: 0.5, steerSpeedRate: 2.2, steerSpeedScale: 7, steerReturnRate: 3.2,
  gripLock: 1.15, landingForward: 0.92, landingSideways: 0.6,
  pitchGain: 0.006, pitchLimit: 0.035, rollGain: 0.007, rollLimit: 0.06, leanRate: 6,
  shakePitch: 0.02, shakeRoll: 0.03, shakeHeight: 0.04, washboardYaw: 0.02, washboardSideways: 0.5,
  hardSteerDrag: 3.2,
  // Loose and playful: a light car that swings out easily on gravel and holds a lively angle.
  drift: { angle: .42, maxAngle: .75, rotate: 3.2, carve: 1.15, scrub: .55, looseSpeed: 8, firmSpeed: 13, liftSpeed: 15, towed: .5 },
  chase: { back: 7.4, height: 2.9, lookAhead: 3.5, lookHeight: 1.25, speedBack: 0.06, maxSpeedBack: 2.5 },
});
