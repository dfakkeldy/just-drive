import { ephemeris, halifaxTime, type SunEvent } from './light-study';
import { sunAngles } from './sun';
import { CURVATURE, curvatureDrop } from './far-rules';

const MINUTE = 60_000;
const RAD = Math.PI / 180;
const BEARING_STEP = 1;
export const HILL_RANGE = 6000;
export type HillLine = readonly (number | null)[];

export interface Observer { x: number; y: number; z: number }
export type GroundRay = () => (x: number, z: number, distance: number) => number | null;

/** Terrain is stretched above sea level. The clearance of the eye above it stays in metres. */
export function trueEyeHeight(eye: number, ground: number, exag: number, seaLevel: number): number {
  return eye - Math.max(0, ground - seaLevel) * (1 - 1 / exag);
}

/** Sæmundsson's true-altitude form of Bennett's approximation, plus the solar radius. */
export function apparentUpperLimb(elevation: number): number {
  // Hold the correction below its useful range to avoid a second, false crossing at night.
  const el = Math.max(-2, elevation);
  const refraction = Math.max(0, 1.02 / (60 * Math.tan((el + 10.3 / (el + 5.11)) * RAD)));
  return elevation + refraction + .266;
}

/** Closely space the samples near the eye, where a small rise can hide a large part of the sky. */
export function sampleHillLine(eye: Observer, seaLevel: number, groundRay: GroundRay, exag = 1): HillLine {
  const line: number[] = [];
  const dipSlope = -2 * Math.sqrt(CURVATURE * Math.max(0, eye.y - seaLevel));
  for (let az = 0; az < 360; az += BEARING_STEP) {
    const height = groundRay();
    const east = Math.sin(az * RAD), north = Math.cos(az * RAD);
    let slope = dipSlope;
    for (let distance = 4; ; distance = Math.min(HILL_RANGE, distance + Math.max(4, Math.min(48, distance / 28)))) {
      const ground = height(eye.x + east * distance, eye.z - north * distance, distance);
      if (ground !== null) {
        const surface = seaLevel + Math.max(0, ground - seaLevel) * exag;
        slope = Math.max(slope, (surface - eye.y - curvatureDrop(distance)) / distance);
      }
      if (distance === HILL_RANGE) break;
    }
    line.push(Math.atan(slope) / RAD);
  }
  return line;
}

/** Interpolate across north as well as between other adjacent bearings. */
export function hillElevation(line: HillLine, az: number): number | null {
  const bearing = ((az % 360 + 360) % 360) / BEARING_STEP, i = Math.floor(bearing);
  const a = line[i], b = line[(i + 1) % line.length], f = bearing - i;
  if (f === 0) return a;
  return a === null || b === null ? null : a + (b - a) * f;
}

export function sunArc(date: string, lat: number, lon: number, first?: Date, last?: Date): SunEvent[] {
  const day = ephemeris(date, lat, lon);
  const start = Math.min(+(day.sunrise?.when ?? halifaxTime(date, '00:00').when), +(first ?? Infinity));
  const end = Math.max(+(day.sunset?.when ?? halifaxTime(date, '23:59').when), +(last ?? -Infinity));
  const event = (ms: number) => ({ when: new Date(ms), ...sunAngles(new Date(ms), lat, lon) });
  const arc: SunEvent[] = [];
  for (let t = start; t < end; t += 4 * MINUTE) arc.push(event(t));
  arc.push(event(end));
  return arc;
}

/** First appearance and last disappearance. A ridge can hide the sun again between those times. */
export function hillSunEvents(date: string, lat: number, lon: number, line: HillLine): { sunrise?: SunEvent; sunset?: SunEvent } {
  const start = +halifaxTime(date, '00:00').when, end = +halifaxTime(date, '23:59').when;
  const event = (ms: number) => ({ when: new Date(ms), ...sunAngles(new Date(ms), lat, lon) });
  const above = (ms: number): boolean | null => {
    const { az, el } = event(ms), hill = hillElevation(line, az);
    return hill === null ? null : apparentUpperLimb(el) >= hill;
  };
  let sunrise: SunEvent | undefined, sunset: SunEvent | undefined;
  let previous = above(start);
  for (let t = start + MINUTE; t <= end; t += MINUTE) {
    const current = above(t);
    if (current !== null && previous !== null && current !== previous) {
      let a = t - MINUTE, b = t;
      for (let i = 0; i < 10; i++) {
        const mid = (a + b) / 2;
        if (above(mid) === previous) a = mid;
        else b = mid;
      }
      if (current) sunrise ??= event((a + b) / 2);
      else sunset = event((a + b) / 2);
    }
    previous = current;
  }
  return { sunrise, sunset };
}
