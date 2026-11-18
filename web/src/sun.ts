import { Vector3 } from 'three';

const RAD = Math.PI / 180;

/** Sun azimuth (from north, clockwise) and elevation in degrees. Low-precision almanac formula, good to about 0.1 degree. */
export function sunAngles(date: Date, latDeg: number, lonDeg: number): { az: number; el: number } {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.46 + 0.9856474 * n) * RAD;
  const g = (357.528 + 0.9856003 * n) * RAD;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) * 15 * RAD;
  const H = gmst + lonDeg * RAD - ra;
  const lat = latDeg * RAD;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { az: ((az / RAD) % 360 + 360) % 360, el: el / RAD };
}

/** World frame: +x east, +y up, -z north. */
export function directionFromAngles(azDeg: number, elDeg: number): Vector3 {
  const az = azDeg * RAD, el = elDeg * RAD;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}
