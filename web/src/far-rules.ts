/** Standard terrestrial refraction. Shared by renderer and offline sightline checks. */
export const EARTH_RADIUS = 6_371_000;
export const REFRACTION_K = 0.13;
export const CURVATURE = (1 - REFRACTION_K) / (2 * EARTH_RADIUS);
export const FAR_RADIUS = 90_000;
export const SEA_MIN_RADIUS = 300_000;
export function seaRadius(eye: number): number { return Math.max(SEA_MIN_RADIUS,Math.sqrt((Math.max(0,eye)+100)/CURVATURE)*1.2); }
/** The authorised distant-only bend: all near vertices retain exact coordinates. */
export const CURVE_START = 3_000;
export const CURVE_FULL = 5_000;
export function renderDrop(distance: number): number {
  const t = Math.max(0,Math.min(1,(distance-CURVE_START)/(CURVE_FULL-CURVE_START)));
  return Math.max(0,curvatureDrop(distance)-curvatureDrop(CURVE_START))*t*t*(3-2*t);
}
export function curvatureDrop(distance: number): number { return distance * distance * CURVATURE; }
export const CURVE_GLSL = /* glsl */ `
float farDrop(vec2 delta) {
 float d = length(delta);
 return max(0.0, (dot(delta,delta) - ${CURVE_START.toFixed(1)} * ${CURVE_START.toFixed(1)}) * ${CURVATURE.toPrecision(16)}) * smoothstep(${CURVE_START.toFixed(1)},${CURVE_FULL.toFixed(1)},d);
}
`;
/** Horizontal root bounds in world x/z, with north mapped to -z. */
export function worldRoot(root: readonly number[], origin: readonly number[]): [number, number, number, number] {
  return [root[0] - origin[0], origin[1] - root[3], root[2] - origin[0], origin[1] - root[1]];
}
export function apparentSlope(observer: number, target: number, distance: number): number {
  return (target - curvatureDrop(distance) - observer) / distance;
}
/** Maximum intervening slope includes the curved ocean, not just dry DEM samples. */
export function sightline(observer: number, target: number, distance: number, profile: readonly [number, number][]): boolean {
  const slope = apparentSlope(observer, target, distance);
  return profile.every(([d, h]) => d <= 0 || d >= distance || apparentSlope(observer, Math.max(0, h), d) < slope);
}
export interface FarLevel { file: string; cell: number; vertices: number; indices: number; triangles: number; bytes: number; sha256: string }
export interface FarFile {
  crs: string; root: [number, number, number, number]; origin: [number, number]; radius: number;
  anchor: [number, number];
  source: string; sourceDate: string; sourceUrl: string;
  /** coarse: the phone's "Coarse" far views (tools/far-pack.mjs --coarse); packs baked before it have only two levels. */
  levels: { desktop: FarLevel; low: FarLevel; coarse?: FarLevel };
}
