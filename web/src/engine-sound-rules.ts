// The arithmetic of the driving sounds: which gear, how fast the engine turns, how hard it works, and what the tyres
// say on each surface. No audio here, so a Node check can hold every number (tools/engine-sound-check.mjs).
// engine-sound.ts turns these numbers into a Web Audio graph. Every sound is synthesised: no recordings, no samples.

import { WASHBOARD_WAVE } from './defects';

export type EngineKind = 'car' | 'truck' | 'sxs' | 'bike';

export interface EngineProfile {
  /** Engine speeds in revolutions per minute. */
  idle: number; redline: number;
  /** Firing pulses per crankshaft turn: a four-stroke fires every other turn per cylinder, a two-stroke single every turn. */
  pulses: number;
  /** Road speed (m/s) at the redline in each gear. Absent for a belt drive (CVT), which holds its engine speed instead. */
  gears?: readonly number[];
  /** The voice: saw for a car's growl, square for the bike's two-stroke buzz. */
  wave: OscillatorType;
  /** How loud the engine sits under the other game sounds, 0 to 1. */
  level: number;
  /** How much of the voice's upper harmonics the filter lets through at full load (a multiple of the firing frequency). */
  bright: number;
  /** Tyre noise scale: a bike has two narrow tyres, a truck four wide ones. */
  tyres: number;
}

export const ENGINES: Readonly<Record<EngineKind, EngineProfile>> = {
  // A small four-cylinder with a five-speed box.
  car: { idle: 800, redline: 6200, pulses: 2, gears: [9, 16, 24, 32, 42], wave: 'sawtooth', level: .5, bright: 7, tyres: 1 },
  // A big V8 and a four-speed automatic: low, slow and deep.
  truck: { idle: 650, redline: 4800, pulses: 4, gears: [10, 18, 28, 40], wave: 'sawtooth', level: .58, bright: 5, tyres: 1.2 },
  // A parallel twin on a belt (CVT): the engine speed follows the pedal, not the road.
  sxs: { idle: 1200, redline: 7200, pulses: 1, wave: 'sawtooth', level: .5, bright: 8, tyres: 1 },
  // A two-stroke single, five close gears: buzzy and high.
  bike: { idle: 1500, redline: 9800, pulses: 1, gears: [7, 12, 17, 23, 30], wave: 'square', level: .42, bright: 9, tyres: .7 },
};

/** The garage id of a motor, or null for the horse (hooves have their own sound, horse-sound.ts) and anything unknown. */
export function engineKind(id: string): EngineKind | null {
  return id === 'car' || id === 'truck' || id === 'sxs' || id === 'bike' ? id : null;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * The gear for this road speed, given the gear the box is in now. Up a gear when the engine nears the shift point (late
 * under full throttle, early when cruising); down only well below it, so the box does not hunt between two gears.
 * Gear numbers start at 1. A belt drive is always in gear 1.
 */
export function gearFor(p: EngineProfile, speed: number, throttle: number, current: number): number {
  const gears = p.gears;
  if (!gears) return 1;
  const v = Math.abs(speed);
  let g = Math.min(Math.max(1, Math.round(current) || 1), gears.length);
  const up = .5 + .4 * clamp(throttle);   // fraction of the redline speed where the box changes up
  while (g < gears.length && v > gears[g - 1] * up) g++;
  while (g > 1 && v < gears[g - 2] * .42) g--;
  return g;
}

export interface EngineInput {
  speed: number;       // forward speed, m/s (negative backing up)
  throttle: number;    // -1 to 1, as the controls give it (negative is brake or reverse)
  airborne: boolean;
  /** Nose-up slope in radians: uphill makes the engine work harder. */
  grade: number;
  towing: boolean;
}

export interface EngineState { gear: number; rpm: number; load: number; frequency: number; gain: number; cutoff: number }

/**
 * Engine speed, load and the voice settings for one moment. `gear` is the gear before this moment (see gearFor).
 * The numbers are targets: engine-sound.ts glides toward them, so a gear change is a quick drop, not a click.
 */
export function engineState(p: EngineProfile, input: EngineInput, gear: number): EngineState {
  const v = Math.abs(input.speed);
  // Backing up, the pedal is the reverse pedal (negative throttle), and the box stays in its one reverse gear. The rule is
  // vehicle.ts's own: a pulled-back pedal below 0.5 m/s forward is reverse; above it, the brake.
  const reversing = input.speed < .5 && input.throttle < 0;
  // Forward pedal while still rolling back faster than 0.5 m/s is vehicle.ts's brake, not load.
  const push = reversing ? clamp(-input.throttle) : input.speed > -.5 ? clamp(input.throttle) : 0;
  const g = reversing || input.speed < -.2 ? 1 : gearFor(p, input.speed, push, gear);
  let rpm: number;
  if (input.airborne) {
    // Wheels off the ground spin free: the engine flares with the pedal.
    rpm = p.idle + (p.redline - p.idle) * .95 * push;
  } else if (!p.gears) {
    // A belt drive engages above idle and holds a high, even note while the pedal is down.
    const engaged = 2600 + 3400 * push + 1200 * clamp(v / 22);
    rpm = push > 0 || v > 1 ? Math.max(p.idle, push > 0 ? engaged : p.idle + 1400 * clamp(v / 22)) : p.idle;
  } else {
    const top = p.gears[g - 1];
    rpm = Math.max(p.idle, p.redline * v / top);
    // Pulling away, the clutch slips: the engine rises with the pedal before the road speed carries it.
    if (g === 1 && push > 0) rpm = Math.max(rpm, p.idle + (p.redline * .45 - p.idle) * push);
  }
  rpm = Math.min(rpm, p.redline);
  const spin = clamp((rpm - p.idle) / (p.redline - p.idle));
  let load: number;
  if (push > 0) load = clamp(push * (.65 + .35 * (1 - spin)) + clamp(Math.sin(input.grade) * 4, 0, .3) + (input.towing ? .15 : 0));
  else load = v > 1 ? .06 : .18;   // coasting, the engine is pushed by the car; at rest it idles
  if (input.airborne) load = .25 + .4 * push;
  const frequency = rpm / 60 * p.pulses;
  return {
    gear: g, rpm, load,
    frequency,
    gain: p.level * (.38 + .62 * load) * (.55 + .45 * spin),
    cutoff: clamp(frequency * (2 + p.bright * load), 160, 6000),
  };
}

export interface TyreState { gain: number; frequency: number; q: number; rate: number; depth: number }

/**
 * The tyre noise for a surface (the names in vehicle.ts SURFACES) at a road speed: filtered noise, opened and shut by a
 * pulse. Asphalt is a soft high hiss; gravel a mid crunch that chatters; washboard a low rattle at the ridge rate
 * (speed over the ridge spacing); grass and brush a low swish. In the air, silence.
 */
export function tyreState(surface: string, speed: number, airborne: boolean, scale = 1): TyreState {
  const v = Math.abs(speed);
  if (airborne || v < .3) return { gain: 0, frequency: 1000, q: .7, rate: 1, depth: 0 };
  let t: TyreState;
  switch (surface) {
    case 'pavement': case 'concrete':
      t = { gain: .16 * clamp(v / 30) ** 1.4, frequency: 3200, q: .45, rate: 1, depth: 0 }; break;
    case 'gravel':
      t = { gain: .3 * clamp(v / 18) ** .8, frequency: 1150, q: .9, rate: 9 + v * .8, depth: .3 }; break;
    case 'dirt track':
      t = { gain: .22 * clamp(v / 18) ** .8, frequency: 820, q: .8, rate: 7 + v * .6, depth: .25 }; break;
    case 'rail trail':
      t = { gain: .16 * clamp(v / 18) ** .8, frequency: 1400, q: .7, rate: 10 + v * .8, depth: .18 }; break;
    case 'washboard':
      t = { gain: .42 * clamp(v / 12) ** .7, frequency: 360, q: 1.1, rate: Math.min(60, v / WASHBOARD_WAVE), depth: .85 }; break;
    case 'grass': case 'brush':
      t = { gain: .14 * clamp(v / 14), frequency: 620, q: .55, rate: 5 + v * .4, depth: .2 }; break;
    default:
      t = { gain: 0, frequency: 1000, q: .7, rate: 1, depth: 0 };
  }
  t.gain *= scale;
  return t;
}

/** How much of the driving sound stays while the radio plays: the music sits on top. */
export const RADIO_DUCK = .55;

/**
 * The whole driving sound at slider 1 is scaled by this before the speakers. The loudest case (the truck flat out on
 * washboard, with the rasp) sums to about 1.5 before it, so the output stays under full scale without a compressor.
 */
export const OUTPUT_TRIM = .6;
