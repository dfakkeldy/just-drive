// The drift state of the arcade motors: when a slide starts, how it holds, how it ends, and what it reports. Pure numbers
// in and out: no DOM, no three.js. vehicle.ts owns the body and calls these once per 120 Hz step;
// tools/drift-rules-check.mjs holds every rule here (and tools/drift-rules-mutations.mjs proves the check can fail).
//
// The rules, in words. The handbrake with the wheel turned at speed swings the tail out (pavement needs more speed than
// loose ground). On loose ground a lift off the throttle and a quick turn-in arms a slide, and it begins only when the
// driver then counter-steers with the throttle back on (a flick): a lift-and-turn-in alone is the ordinary car. After that swing the slide holds only with power and counter-steer: the front
// wheels aim where the car is going, so more counter-steer holds a wider angle and less a narrower one. Wheel straight,
// steering into the slide, a lift, a hit or a slow car: the slide ends, and the ordinary tyres take over. A handbrake still
// held then cannot start another until it is let go.
// A driver who never pulls the handbrake in a turn and never flicks cannot start a slide, so ordinary driving is unchanged.

/** Per-vehicle drift numbers (VehicleSpec.drift). Angles in radians, speeds in m/s. Absent: the ride never drifts. */
export interface DriftSpec {
  /** The slide angle held with full throttle and HOLD_STEER of counter-steer; the swing an entry gives. */
  readonly angle: number;
  /** The widest slide angle. */
  readonly maxAngle: number;
  /** How quickly the slide angle follows what the driver asks, per second: a heavy body rotates slowly. */
  readonly rotate: number;
  /** How hard the path curves at the held angle, as a multiple of the surface grip (mu g). */
  readonly carve: number;
  /** Speed the slide scrubs off, as a multiple of mu g times the sine of the slide angle. */
  readonly scrub: number;
  /** Least speed for a handbrake entry on loose ground, and on pavement or any other firm surface. */
  readonly looseSpeed: number;
  readonly firmSpeed: number;
  /** Least speed for a lift-off entry on loose ground. */
  readonly liftSpeed: number;
  /** A hitched trailer resists: the angle and the rotation are scaled by this, and the entry speeds raised by TOWED_SPEED. */
  readonly towed: number;
}

/** The surfaces (vehicle.ts SURFACES names) that slide easily. Anything else is firm: it needs the handbrake and more speed. */
export const LOOSE: readonly string[] = Object.freeze(['gravel', 'dirt track', 'washboard', 'grass']);
export const looseSurface = (surface: string): boolean => LOOSE.includes(surface);

/** With a hitched trailer every entry needs this much more speed. */
export const TOWED_SPEED = 1.3;
/** A handbrake entry needs at least this much steering. */
export const HANDBRAKE_STEER = .35;
/** A lift-off entry is armed when the throttle was at least LIFT_FROM no more than LIFT_WINDOW seconds ago, is now between
 * LIFT_BRAKE and LIFT_OFF (a lift, not the brake), and the steering is at least LIFT_STEER. It begins if, within LIFT_WINDOW
 * of the turn-in, the throttle is back above LIFT_OFF and the wheel is counter-steered by at least LIFT_COUNTER. */
export const LIFT_FROM = .6, LIFT_OFF = .1, LIFT_BRAKE = -.1, LIFT_WINDOW = .45, LIFT_STEER = .85, LIFT_COUNTER = .3;
/** After an entry the tail swings for this long whatever the wheel says; then the hold rules apply. */
export const SWING_SECONDS = .45;
/** A lift-off swing only grows with the throttle back on; without it the tail steps out by this share of the angle at most. */
export const LIFT_SWING = .15;
/** Counter-steer (0 to 1) that holds the spec angle with full power. More holds wider, up to maxAngle. */
export const HOLD_STEER = .4;
/** The counter-steer the hold reads follows more counter-steer at once but lets go over this many seconds: a key is on or
 * off, and tapping it then holds a steady middle angle, as a thumb or a stick does by moving part way. */
export const HANDS = .25;
/** Power to hold a slide: the throttle maps to POWER_BASE + (1 - POWER_BASE) * throttle; none when lifted or braking. */
export const POWER_BASE = .45;
/** On pavement or another firm surface the tyres want to grip: the held angle is this share. */
export const FIRM_HOLD = .7;
/** The handbrake held swings the tail this much faster. */
export const HANDBRAKE_SWING = 1.6;
/** A slide below this angle that is not growing has ended: the driver straightened. */
export const EXIT_ANGLE = .06;
/** The slide fades from END_SPEED + FADE_SPEED and has ended at END_SPEED (m/s): the driver slowed. */
export const END_SPEED = 4, FADE_SPEED = 3;
/** A slide that leaves the path by more than this past maxAngle (a hit, a wall) has ended. */
export const LOST_ANGLE = .35;
/** The least slide reported to the score stream: a twitch is not a drift. */
export const COUNT_SECONDS = .6, COUNT_ANGLE = .17, COUNT_LENGTH = 6;
/** Phone: GO and BRAKE held together are the handbrake once held CHORD_SECONDS at CHORD_SPEED (m/s) or more. Before that,
 * and slower, BRAKE wins as it always did: stopping and reversing are unchanged, and a thumb rolling from one pedal to the
 * other never pulls it. */
export const CHORD_SECONDS = .15, CHORD_SPEED = 6;
export const phoneHandbrake = (heldSeconds: number, speed: number): boolean => heldSeconds >= CHORD_SECONDS && speed >= CHORD_SPEED;

const G = 9.81;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export interface DriftControls { readonly throttle: number; readonly steer: number; readonly handbrake: boolean }
export interface DriftGround {
  /** Speed along the path, m/s. */
  readonly speed: number;
  /** The surface name under the body (vehicle.ts SURFACES). */
  readonly surface: string;
  /** Grip of that surface. */
  readonly mu: number;
  readonly towed: boolean;
  /** The turn rate the steering asks of the grip model now (vehicle.ts yaw), rad/s, clockwise positive. */
  readonly turn: number;
}
/** What one drift step asks of the body. Reused: read it before the next step. */
export interface DriftMotion {
  /** The new signed slide angle: heading minus the direction of travel, positive with the nose right of the path. */
  angle: number;
  /** How fast the path turns, rad/s, clockwise positive (as heading). */
  pathRate: number;
  /** Speed lost to the slide this step, m/s per second. */
  scrub: number;
  /** The angle the driver asks for now (unsigned): for checks and the meter. */
  target: number;
}
/** One finished drift, as the score stream hears it. */
export interface DriftFacts {
  /** Mean slide angle over the drift, and the widest, in degrees. */
  readonly angle: number;
  readonly peak: number;
  /** Metres travelled and seconds spent sliding. */
  readonly length: number;
  readonly seconds: number;
  /** Mean speed, m/s. */
  readonly speed: number;
  /** The surface most of the drift was on. */
  readonly surface: string;
  /** True when the drift ended on its own, straightened or slowed, without a hit (not in the air, not lost). */
  readonly clean: boolean;
  /** Where it began and ended (world x, z). */
  readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number;
}
export type DriftEnd = 'straightened' | 'slowed' | 'airborne' | 'hit' | 'lost' | 'reset';

/** Signed slide angle of a body moving with forward speed `forward` and rightward speed `right` (vehicle.ts vf, vl). */
export const slideAngle = (forward: number, right: number): number => Math.atan2(-right, forward);

/** The angle (unsigned) the driver asks for with these controls, after the swing. */
export function holdAngle(spec: DriftSpec, c: DriftControls, side: number, surface: string, towed: boolean, steer = c.steer): number {
  const power = c.handbrake ? 1 : c.throttle > 0 ? POWER_BASE + (1 - POWER_BASE) * Math.min(1, c.throttle) : 0;
  const counter = clamp(-steer * side, 0, 1);
  const hold = spec.angle * power * counter / HOLD_STEER * (looseSurface(surface) ? 1 : FIRM_HOLD) * (towed ? spec.towed : 1);
  return Math.min(hold, spec.maxAngle * (towed ? spec.towed : 1));
}

/** The state of one vehicle's slide. One per Vehicle; reset on every placement. */
export class Drift {
  active = false;
  /** Signed slide angle now (0 when not sliding). */
  angle = 0;
  /** +1 a right-hand slide (the nose right of the path), -1 a left-hand one. */
  side = 0;
  /** How the slide began, and how the last one ended. */
  entry: 'handbrake' | 'lift' | '' = '';
  ended: DriftEnd | '' = '';
  /** Seconds since the throttle was last at LIFT_FROM or more. */
  private sinceThrottle = Infinity;
  /** A lift and turn-in to this side (+1, -1; 0 none) may still become a slide for armedFor seconds. */
  private armed = 0; private armedFor = 0;
  /** A slide ended with the handbrake held: no handbrake entry until it is let go. */
  private spent = false;
  private swing = 0;
  /** The counter-steer the hold reads (0 to 1): up at once, down over HANDS seconds. */
  private hands = 0;
  /** Seconds and metres of the slide so far (the meter reads them). */
  seconds = 0; length = 0;
  private peak = 0; private angleTime = 0; private speedTime = 0;
  private x0 = 0; private z0 = 0;
  private readonly surfaces = new Map<string, number>();
  private pending: DriftFacts | null = null;
  private readonly motion: DriftMotion = { angle: 0, pathRate: 0, scrub: 0, target: 0 };

  /** 0 to 1: how far the slide is open, for the sound and the dust. */
  slide(spec: DriftSpec | undefined): number { return this.active && spec ? Math.min(1, Math.abs(this.angle) / spec.angle) : 0; }

  /** Every grounded step, sliding or not: a lift-off entry needs to know when the throttle was last held. */
  watch(c: DriftControls, dt: number): void {
    this.sinceThrottle = c.throttle >= LIFT_FROM ? 0 : this.sinceThrottle + dt;
    this.armedFor -= dt; if (this.armedFor <= 0 || c.handbrake) this.armed = 0;
    if (!c.handbrake) this.spent = false;
  }

  /** The side (+1 or -1) of a slide that should begin now, or 0. Call after watch(). */
  begins(spec: DriftSpec, c: DriftControls, g: DriftGround): number {
    if (this.active || !(g.speed > 0) || c.steer === 0) return 0;
    const loose = looseSurface(g.surface), slower = g.towed ? 1 / TOWED_SPEED : 1;
    if (c.handbrake && !this.spent && Math.abs(c.steer) >= HANDBRAKE_STEER && g.speed >= (loose ? spec.looseSpeed : spec.firmSpeed) / slower) return Math.sign(c.steer);
    if (!loose || c.handbrake || g.speed < spec.liftSpeed / slower) { this.armed = 0; return 0; }
    // The lift and turn-in only arm it: nothing changes for a driver who carries on round the bend.
    if (this.sinceThrottle > 0 && this.sinceThrottle <= LIFT_WINDOW && c.throttle <= LIFT_OFF && c.throttle >= LIFT_BRAKE && Math.abs(c.steer) >= LIFT_STEER) {
      this.armed = Math.sign(c.steer); this.armedFor = LIFT_WINDOW; return 0;
    }
    // The flick: power back on and the wheel the other way. The tail goes out on the turn-in side.
    if (this.armed && c.throttle > LIFT_OFF && -c.steer * this.armed >= LIFT_COUNTER) { const side = this.armed; this.armed = 0; return side; }
    return 0;
  }

  /** Start a slide on this side. `angle` is the measured slide angle now (about 0 from a grip turn). */
  begin(side: number, how: 'handbrake' | 'lift', angle: number, x: number, z: number, steer = side): void {
    this.active = true; this.hands = clamp(-steer * side, 0, 1); this.side = side; this.entry = how; this.ended = ''; this.angle = angle; this.swing = SWING_SECONDS;
    this.seconds = this.length = this.peak = this.angleTime = this.speedTime = 0;
    this.surfaces.clear(); this.x0 = x; this.z0 = z;
  }

  /**
   * One step of a slide. `measured` is the slide angle the body really has now (slideAngle of its velocity): a push from a
   * wall or a rail moves it, and the rules carry on from there. Returns the new angle, the path's turn rate and the scrub.
   */
  step(spec: DriftSpec, c: DriftControls, g: DriftGround, measured: number, dt: number): DriftMotion {
    const m = this.motion, towed = g.towed ? spec.towed : 1;
    const counter = clamp(-c.steer * this.side, 0, 1);
    this.hands = counter >= this.hands ? counter : this.hands + (counter - this.hands) * (1 - Math.exp(-dt / HANDS));
    let target = holdAngle(spec, c, this.side, g.surface, g.towed, -this.hands * this.side);
    if (this.swing > 0) {
      // The swing: the tail goes out to the spec angle on its own; a lift-off swing grows only with the throttle back on.
      const swing = spec.angle * (looseSurface(g.surface) ? 1 : FIRM_HOLD) * towed;
      const power = c.throttle > 0 ? POWER_BASE + (1 - POWER_BASE) * Math.min(1, c.throttle) : 0;
      target = Math.max(target, this.entry === 'lift' ? swing * Math.max(LIFT_SWING, power) : swing);
      this.swing -= dt;
    }
    target *= clamp((g.speed - END_SPEED) / FADE_SPEED, 0, 1);
    const rate = spec.rotate * towed * (c.handbrake ? HANDBRAKE_SWING : 1);
    const size = Math.max(0, measured * this.side);
    const next = size + (target - size) * (1 - Math.exp(-rate * dt));
    m.angle = this.side * next; m.target = target;
    const grip = g.mu * G;
    // The rear slides; the front tyres still grip. Wheel turned into the slide, the path turns at least as the grip model
    // would turn it: a slide never makes the car run wide of the line the driver steers.
    const carve = spec.carve * grip * (.5 + .5 * Math.min(1, next / spec.angle)) / Math.max(g.speed, 4);
    m.pathRate = this.side * Math.max(carve, g.turn * this.side);
    m.scrub = spec.scrub * grip * Math.sin(next);
    this.angle = m.angle;
    this.seconds += dt; this.length += g.speed * dt; this.peak = Math.max(this.peak, next);
    this.angleTime += next * dt; this.speedTime += g.speed * dt;
    this.surfaces.set(g.surface, (this.surfaces.get(g.surface) ?? 0) + g.speed * dt);
    return m;
  }

  /** After a step: has the slide ended? `speed` is the speed along the path now. */
  check(spec: DriftSpec, speed: number, x: number, z: number): DriftEnd | '' {
    if (!this.active) return '';
    const size = Math.abs(this.angle);
    if (speed <= END_SPEED) return this.finish('slowed', x, z);
    if (this.swing <= 0 && size < EXIT_ANGLE && this.motion.target <= size) return this.finish('straightened', x, z);
    if (size > spec.maxAngle + LOST_ANGLE || this.angle * this.side < -EXIT_ANGLE) return this.finish('lost', x, z);
    return '';
  }

  /** The body left the ground mid-slide. */
  airborne(x: number, z: number): void { if (this.active) this.finish('airborne', x, z); }
  /** The body hit something: the slide ends here and is not clean. Outside a slide, nothing. */
  hit(x: number, z: number): void { if (this.active) this.finish('hit', x, z); }

  /** End the slide. A real drift (long, wide and far enough) leaves its facts for take(). */
  finish(how: DriftEnd, x: number, z: number): DriftEnd {
    if (!this.active) return how;
    this.active = false; this.ended = how; this.angle = 0; this.side = 0; this.swing = 0; this.spent = true;
    if (this.seconds >= COUNT_SECONDS && this.peak >= COUNT_ANGLE && this.length >= COUNT_LENGTH) {
      let surface = '', most = -1;
      for (const [name, metres] of this.surfaces) if (metres > most) { most = metres; surface = name; }
      const deg = 180 / Math.PI;
      this.pending = { angle: Math.round(this.angleTime / this.seconds * deg * 10) / 10, peak: Math.round(this.peak * deg * 10) / 10,
        length: Math.round(this.length * 10) / 10, seconds: Math.round(this.seconds * 100) / 100, speed: Math.round(this.speedTime / this.seconds * 10) / 10,
        surface, clean: how === 'straightened' || how === 'slowed', x0: this.x0, z0: this.z0, x1: x, z1: z };
    }
    return how;
  }

  /** A placement, a restart or a respawn: any slide is dropped without a report. */
  reset(): void { if (this.active) this.finish('reset', 0, 0); this.sinceThrottle = Infinity; this.armed = 0; this.spent = false; this.pending = null; }

  /** The last finished drift, once. */
  take(): DriftFacts | null { const p = this.pending; this.pending = null; return p; }
}
