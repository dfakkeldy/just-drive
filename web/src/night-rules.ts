/**
 * The night look's rules: no three.js, so a node check can run them (tools/night-check.mjs).
 *
 * The night look exists only for a chosen clock: the light study (light-study.ts), or the player's own date or time
 * (weather.ts), and only when that clock's sun is below the level horizon. Every other page gets `null` here and
 * builds nothing: today's daytime frames stay as they were.
 */
import { HORIZON } from './light-study';

/** The end of nautical twilight: from here down the land is fully in its night colours. */
export const NIGHT_FULL = -12;
export type RGB = readonly [number, number, number];

/** The colours of the game's light just at sunset (main.ts with the sun at the horizon), linear. */
export const SUNSET = {
  sun: [2.2, 1.364, .792] as RGB,
  sky: [.165, .242, .396] as RGB,
  fog: [.465, .495, .54] as RGB,
  ground: [.22, .20, .15] as RGB,
};
/** A clear, moonless rural night, made readable: a deep blue fill that still shows the hills and the road edge. */
export const NIGHT = {
  sky: [.050, .078, .172] as RGB,
  fog: [.016, .024, .046] as RGB,
  ground: [.010, .011, .016] as RGB,
};

export interface NightPalette {
  /** 0 just below the horizon (the sunset look), 1 from the end of nautical twilight. */
  level: number;
  /** What remains of direct sun light: it is gone a few degrees below the horizon. */
  sunScale: number;
  sky: RGB; fog: RGB; ground: RGB;
  /** The warm glow on the sky at the sun's side, 1 at sunset and gone at full night. */
  glow: number;
  /** How bright the stars are before towns wash them out. */
  stars: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Geometric blend: light falls by orders of magnitude at dusk, and a straight mix would stay bright too long. */
const blend = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => a[i] ** (1 - t) * b[i] ** t) as unknown as RGB;

/** `null` (no night look at all) unless a clock was chosen (the light study's or the player's) and its sun is below the horizon. */
export function nightPalette(elevation: number, studyActive: boolean): NightPalette | null {
  if (!studyActive || !Number.isFinite(elevation) || elevation >= HORIZON) return null;
  const level = smooth(HORIZON, NIGHT_FULL, elevation);
  return {
    level,
    sunScale: 1 - smooth(HORIZON, -4, elevation),
    sky: blend(SUNSET.sky, NIGHT.sky, level),
    fog: blend(SUNSET.fog, NIGHT.fog, level),
    ground: blend(SUNSET.ground, NIGHT.ground, level),
    glow: (1 - level) ** 1.5,
    stars: smooth(.35, .95, level),
  };
}

/** Town light: stars fade within a few kilometres of street lights, and the sky over the town glows a little. */
export function townLight(distance: number, lamps: number, out = { stars: 1, glow: 0 }): { stars: number; glow: number } {
  if (lamps <= 0 || !Number.isFinite(distance)) { out.stars = 1; out.glow = 0; return out; }
  const near = 1 / (1 + (Math.max(distance, 0) / 1600) ** 2), size = Math.min(1, lamps / 8);
  out.stars = 1 - .8 * near * size; out.glow = near * size;
  return out;
}

export interface Place { x: number; z: number }
export interface Pole extends Place { heading: number; light: boolean; transformer: boolean }
export interface YardRule {
  /** Every mapped property and every mailbox: no lamp comes nearer to any of them than `gap`. */
  protectedPlaces: readonly Place[];
  /** Areas that already belong to something (sites, clearings): no lamp inside these boxes [x0, z0, x1, z1]. */
  excluded: readonly (readonly [number, number, number, number])[];
  /** The area's village: yard lights are country lights, not town lights. */
  village: Place;
}
/** Metres from any property or mailbox. A lamp this far from every house marks no house. */
export const YARD_GAP = 250;
export const YARD_FROM_VILLAGE = 1200, YARD_SPACING = 900, YARD_MAX = 10;

/**
 * Invented farm-gate lights on invented poles. A rural transformer pole far from every house, every mailbox and every
 * site gets a dusk-to-dawn lamp. Nothing here reads a real place's identity: poles are the bake's own invented line.
 * The order is the poles' own order, so the same land always gives the same lamps.
 */
export function chooseYardLights(poles: readonly Pole[], rule: YardRule, gap = YARD_GAP): Pole[] {
  const chosen: Pole[] = [];
  // A coarse grid keeps this to one pass over the places, whatever the area's size.
  const CELL = 250, grid = new Map<string, Place[]>();
  for (const p of rule.protectedPlaces) {
    const key = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
    let list = grid.get(key); if (!list) grid.set(key, list = []); list.push(p);
  }
  const reach = Math.ceil(gap / CELL);
  const clear = (q: Place) => {
    const cx = Math.floor(q.x / CELL), cz = Math.floor(q.z / CELL);
    for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++)
      for (const p of grid.get(`${cx + dx},${cz + dz}`) ?? []) if (Math.hypot(p.x - q.x, p.z - q.z) < gap) return false;
    return true;
  };
  for (const pole of poles) {
    if (chosen.length >= YARD_MAX) break;
    if (!pole.transformer || pole.light) continue;
    if (Math.hypot(pole.x - rule.village.x, pole.z - rule.village.z) < YARD_FROM_VILLAGE) continue;
    if (rule.excluded.some(b => pole.x >= b[0] - gap && pole.x <= b[2] + gap && pole.z >= b[1] - gap && pole.z <= b[3] + gap)) continue;
    if (chosen.some(c => Math.hypot(c.x - pole.x, c.z - pole.z) < YARD_SPACING)) continue;
    if (!clear(pole) || !clear(lampHead(pole))) continue;   // the pole and the lit head both keep the gap
    chosen.push(pole);
  }
  return chosen;
}

/** A lamp's head on its pole (props.ts draws a street lamp's arm 1.5 m out toward the pole's heading, 7.82 m up). */
export function lampHead(pole: { x: number; z: number; heading: number }, out = 1.5): Place {
  const h = pole.heading * Math.PI / 180;
  return { x: pole.x + out * Math.sin(h), z: pole.z - out * Math.cos(h) };
}

/** Indices of the nearest `count` lamps within `reach` metres, nearest first. No allocation once `out` has grown. */
export function nearestLamps(lamps: readonly Place[], x: number, z: number, count: number, reach: number, out: number[] = [], distances: number[] = []): number[] {
  out.length = 0; distances.length = 0;
  for (let i = 0; i < lamps.length; i++) {
    const d = Math.hypot(lamps[i].x - x, lamps[i].z - z);
    if (d > reach) continue;
    let at = out.length;
    while (at > 0 && distances[at - 1] > d) at--;
    if (at >= count) continue;
    // Insert at `at` by shifting the tail one place (splice would make a new array for its return value).
    let end = Math.min(out.length, count - 1);
    for (; end > at; end--) { out[end] = out[end - 1]; distances[end] = distances[end - 1]; }
    out[at] = i; distances[at] = d;
  }
  return out;
}

/** The galactic north pole and centre (J2000), for the Milky Way's band across the sky. */
const GALACTIC_POLE = { ra: 192.85948, dec: 27.12825 }, GALACTIC_CENTRE = { ra: 266.40499, dec: -28.93617 };
/** Azimuth (from north, clockwise) and elevation, in degrees, of a star at `when` seen from lat/lon. */
export function starAngles(ra: number, dec: number, when: Date, latDeg: number, lonDeg: number): { az: number; el: number } {
  const RAD = Math.PI / 180, n = when.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const gmst = (18.697374558 + 24.06570982441908 * n) * 15;
  const H = (gmst + lonDeg - ra) * RAD, lat = latDeg * RAD, d = dec * RAD;
  const el = Math.asin(Math.sin(lat) * Math.sin(d) + Math.cos(lat) * Math.cos(d) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(d) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { az: ((az / RAD) % 360 + 360) % 360, el: el / RAD };
}
export function milkyWay(when: Date, latDeg: number, lonDeg: number): { pole: { az: number; el: number }; centre: { az: number; el: number } } {
  return { pole: starAngles(GALACTIC_POLE.ra, GALACTIC_POLE.dec, when, latDeg, lonDeg), centre: starAngles(GALACTIC_CENTRE.ra, GALACTIC_CENTRE.dec, when, latDeg, lonDeg) };
}
