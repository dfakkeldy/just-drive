// The arithmetic of the driving sounds: which gear, how fast the engine turns, how hard it works, and what the tyres
// say on each surface. No audio here, so a Node check can hold every number (tools/engine-sound-check.mjs).
// engine-sound.ts turns these numbers into a Web Audio graph. Every sound is synthesised: no recordings, no samples.

import { WASHBOARD_WAVE } from './defects';
import { isMotorKind, type MotorKind } from './ride-kinds';

export type EngineKind = MotorKind;

export interface EngineProfile {
  /** Engine speeds in revolutions per minute. */
  idle: number; redline: number;
  /** Firing pulses per crankshaft turn: a four-stroke fires every other turn per cylinder, a two-stroke single every turn. */
  pulses: number;
  /** Road speed (m/s) at the redline in each gear. Absent for a belt drive (CVT), which holds its engine speed instead. */
  gears?: readonly number[];
  /** The voice: saw for a car's growl, square for the bike's two-stroke buzz, custom for a pulse train (`train`). */
  wave: OscillatorType;
  /** How loud the engine sits under the other game sounds, 0 to 1. */
  level: number;
  /** How much of the voice's upper harmonics the filter lets through at full load (a multiple of the firing frequency). */
  bright: number;
  /** Tyre noise scale: a bike has two narrow tyres, a truck four wide ones. */
  tyres: number;
  /** Where the box changes up at full pedal, as a share of the gear's redline speed. Default .9. */
  upshift?: number;
  /** How far the engine flares in the air at full pedal, as a share of the range from idle to redline. Default .95. */
  flare?: number;
  /** The highest filter cutoff, Hz: a big exhaust stays dark however hard the engine works. Default 6000. */
  ceiling?: number;
  /** The gain of the octave-up voice (full detail only). Default UPPER. */
  upper?: number;
  /** The centre of the rasp noise, as a multiple of the firing frequency. Default RASP. */
  rasp?: number;
  /**
   * One whole engine cycle (two crank turns for a four-stroke) as a train of pulses, for `wave: 'custom'`. `lump` is each
   * pulse's height in firing order, `skew` its small timing error (a share of one firing interval), `decay` how long each
   * pulse rings (a share of one firing interval). Uneven pulses put the engine's lower orders under the firing note.
   */
  train?: { lump: readonly number[]; skew: readonly number[]; decay: number };
}

/** The gain of the octave-up voice, unless a profile sets its own. */
export const UPPER = .35;
/** The centre of the rasp noise as a multiple of the firing frequency, unless a profile sets its own. */
export const RASP = 6;

// A cross-plane V8 fires 1-8-4-3-6-5-7-2: left, right, right, left, right, left, left, right. The near (left) bank's
// tailpipe is louder, so each bank's uneven spacing comes through as the lope. Heights and timing errors are by ear.
const V8 = { lump: [1, .6, .52, .94, .58, 1, .9, .55], skew: [0, .03, -.02, .02, -.03, .01, .03, -.02], decay: .8 };

export const ENGINES: Readonly<Record<EngineKind, EngineProfile>> = {
  // A small four-cylinder with a five-speed box.
  car: { idle: 800, redline: 6200, pulses: 2, gears: [9, 16, 24, 32, 42], wave: 'sawtooth', level: .5, bright: 7, tyres: 1 },
  // A big V8 and a six-speed automatic: low, slow and lumpy. Players hold the pedal flat, so the box changes up early, at
  // 74% of the redline. The steps are a truck six-speed's (3.74, 2.00, 1.34, 1.00, 0.77, 0.63): wide at the bottom, so the
  // first changes land low and far apart in speed. The top gear is tall: about 3300 rpm at the truck's top speed (45.5 m/s
  // on pavement), never on the limiter. A dark exhaust (the cutoff stops at 750 Hz), no octave-up voice, and an intake roar
  // just above the firing note.
  truck: { idle: 600, redline: 4800, pulses: 4, gears: [11, 20.6, 30.8, 41.3, 53.6, 65.5], wave: 'custom', level: 1, bright: 2, tyres: 1.2,
    upshift: .74, flare: .62, ceiling: 750, upper: 0, rasp: 2.5, train: V8 },
  // A parallel twin on a belt (CVT): the engine speed follows the pedal, not the road.
  sxs: { idle: 1200, redline: 7200, pulses: 1, wave: 'sawtooth', level: .5, bright: 8, tyres: 1 },
  // A two-stroke single, five close gears: buzzy and high. Top gear reaches the redline at 45.3 m/s, so at the bike's top
  // speed (41.7 m/s on pavement) it turns at 92% of the redline, not on the limiter.
  bike: { idle: 1500, redline: 9800, pulses: 1, gears: [10.6, 18.1, 25.7, 34.8, 45.3], wave: 'square', level: .42, bright: 9, tyres: .7 },
};

/** The garage id of a motor, or null for the horse (hooves have their own sound, horse-sound.ts) and anything unknown. */
export function engineKind(id: string): EngineKind | null {
  return isMotorKind(id) ? id : null;
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
  const up = .5 + ((p.upshift ?? .9) - .5) * clamp(throttle);   // fraction of the redline speed where the box changes up
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

export interface EngineState {
  gear: number; rpm: number; load: number;
  /** The firing frequency, Hz. */
  frequency: number;
  /** The voice oscillator's frequency, Hz: the firing frequency, or one engine cycle for a pulse train. */
  voice: number;
  gain: number; cutoff: number;
  /** The centre of the rasp noise, Hz. */
  rasp: number;
}

/** Firing pulses in one period of the voice: a pulse train holds a whole engine cycle, a plain wave one pulse. */
export function voicePulses(p: EngineProfile): number {
  return p.wave === 'custom' && p.train ? p.train.lump.length : 1;
}

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
    rpm = p.idle + (p.redline - p.idle) * (p.flare ?? .95) * push;
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
    voice: frequency / voicePulses(p),
    gain: p.level * (.38 + .62 * load) * (.55 + .45 * spin),
    cutoff: clamp(frequency * (2 + p.bright * load), 160, p.ceiling ?? 6000),
    rasp: Math.min(5000, frequency * (p.rasp ?? RASP)),
  };
}

/**
 * The truck's voice: one engine cycle of pulses as a Web Audio periodic wave (cosine and sine terms for each harmonic of
 * the cycle). Each pulse is a sharp rise and a decay, placed at its firing slot plus its skew and scaled by its lump.
 * With even pulses, only every `lump.length`-th harmonic (the firing note and its overtones) is left; uneven ones add the
 * orders below it. The browser normalises the wave, so its peak stays 1 whatever the heights.
 */
export function engineWave(p: EngineProfile, harmonics = 160): { real: Float32Array; imag: Float32Array } {
  if (!p.train) throw Error('engineWave needs a pulse train');
  const { lump, skew, decay } = p.train, c = lump.length, tau = decay / c;
  const real = new Float32Array(harmonics + 1), imag = new Float32Array(harmonics + 1);
  for (let h = 1; h <= harmonics; h++) {
    let cs = 0, sn = 0;
    for (let k = 0; k < c; k++) {
      const a = 2 * Math.PI * h * (k + skew[k]) / c;
      cs += lump[k] * Math.cos(a); sn += lump[k] * Math.sin(a);
    }
    // A decaying pulse, exp(-t / tau) from its start: in the frequency domain 1 / (1 + iw).
    const w = 2 * Math.PI * h * tau, d = 1 + w * w;
    real[h] = 2 * (cs - sn * w) / d; imag[h] = 2 * (cs * w + sn) / d;
  }
  return { real, imag };
}

export interface TyreState { gain: number; frequency: number; q: number; rate: number; depth: number }
/** A drift on pavement: a narrow band of the tyre noise, rising with the angle. */
export const SQUEAL = Object.freeze({ gain: .2, frequency: 1500, rise: 450, q: 7 });
/** A drift on loose ground: louder, lower, rougher. */
export const SPRAY = Object.freeze({ gain: 1.1, lower: .2, depth: .5 });

/**
 * The tyre noise for a surface (the names in vehicle.ts SURFACES) at a road speed: filtered noise, opened and shut by a
 * pulse. Asphalt is a soft high hiss; gravel a mid crunch that chatters; washboard a low rattle at the ridge rate
 * (speed over the ridge spacing); grass and brush a low swish. In the air, silence.
 * `slide` (0 to 1, drift-rules.ts) is how far a drift is open: on a firm surface the hiss narrows into a squeal; on loose
 * ground the crunch grows louder, lower and rougher. At 0 the numbers are exactly the rolling ones.
 */
export function tyreState(surface: string, speed: number, airborne: boolean, scale = 1, slide = 0): TyreState {
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
  if (slide > 0 && t.gain > 0) {
    const s = clamp(slide), firm = surface === 'pavement' || surface === 'concrete';
    if (firm) t = { gain: t.gain + SQUEAL.gain * s * clamp(v / 12), frequency: SQUEAL.frequency + SQUEAL.rise * s, q: t.q + (SQUEAL.q - t.q) * s, rate: 1, depth: 0 };
    else t = { gain: t.gain * (1 + SPRAY.gain * s), frequency: t.frequency * (1 - SPRAY.lower * s), q: t.q, rate: t.rate, depth: Math.max(t.depth, SPRAY.depth * s) };
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
