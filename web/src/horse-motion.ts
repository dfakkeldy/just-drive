/** Stride phase is in cycles. Legs are front left, front right, rear left, rear right. */
export const GAITS = {
  stand: { hz: 0, stance: 1, stride: 0, lift: 0, beats: [0, 0, 0, 0] },
  walk: { hz: 1, stance: .68, stride: .52, lift: .12, beats: [0, .5, .75, .25] },
  trot: { hz: 1.65, stance: .46, stride: .76, lift: .22, beats: [0, .5, .5, 0] },
  canter: { hz: 1.8, stance: .32, stride: 1.12, lift: .36, beats: [.62, .31, .31, 0] },
  // Rotary: LH, RH, RF, LF; extended flight .34-.43, collected flight .78-1.
  gallop: { hz: 2.1, stance: .20, stride: 1.55, lift: .47, beats: [.58, .43, 0, .14] },
};
export type Gait = keyof typeof GAITS;
export function gaitAt(speed: number): Gait {
  const v = Math.abs(speed);
  return v < .12 ? 'stand' : speed < 0 || v < 2.5 ? 'walk' : v < 5 ? 'trot' : v < 8 ? 'canter' : 'gallop';
}
export interface HoofCycle { z: number; lift: number; planted: boolean; swing: number }
export function hoofCycle(gait: Gait, phase: number, leg: number, out: HoofCycle = {z:0,lift:0,planted:false,swing:0}, stride = GAITS[gait].stride): HoofCycle {
  const g = GAITS[gait], p = ((phase - g.beats[leg]) % 1 + 1) % 1;
  out.planted = p < g.stance;
  if (out.planted) { out.z = stride * (p / g.stance - .5); out.lift = 0; out.swing = 0; }
  else { const swing = (p - g.stance) / (1 - g.stance); out.swing = swing; out.z = stride * (.5 - swing * swing * (3 - 2 * swing)); out.lift = g.lift * Math.sin(Math.PI * swing) ** 1.25; }
  return out;
}
/** The body travels exactly this distance during the contact part of a stride. */
export function contactTravel(speed: number): number {
  const gait = gaitAt(speed), hz = strideAdvance(1, speed);
  return hz > 0 ? Math.abs(speed) * GAITS[gait].stance / hz : 0;
}
/** Forward speed cap in m/s. Steep descents require shorter, careful steps. */
export function horseSpeedLimit(surface: string, slope: number): number {
  const base = surface === 'brush' ? 4.5 : surface === 'grass' ? 10 : surface === 'washboard' ? 7.5
    : surface === 'dirt track' ? 9 : surface === 'gravel' ? 11 : 12.5;
  return base * (slope > 0 ? Math.max(.28, 1 - slope * 2) : Math.max(.35, 1 + Math.min(0, slope + .08) * 2.5));
}

/** One shared stride clock: visual landing events drive the sound, including when the gait changes. */
export function strideAdvance(dt: number, speed: number): number {
  const gait = gaitAt(speed), g = GAITS[gait];
  return dt * g.hz * (gait === 'walk' ? Math.min(1.3, Math.abs(speed) / 1.67) : 1);
}
