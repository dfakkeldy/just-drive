/** All distances are metres. A single prevailing wind FROM WSW; the rotor normal faces it. */
export const WIND_HEADING = 247.5 * Math.PI / 180;
/** The near renderer never adds outside-root turbines; FarTurbines owns curved far instances. */
export const FAR_TURBINES = false;
export const TIP_SPEED = 70;
export type LightClass = 'A0' | 'A1' | 'A2' | 'W';
export type TowerKind = 'standard' | 'double' | 'crossing';
export interface ObstructionLight { readonly frac: number; readonly kind: 'red-steady' | 'red-flash' | 'white-strobe' }
export interface TallPoint { e: number; n: number; ground: number | null }
export interface Turbine extends TallPoint { hub: number; diameter: number; farm?: string; source?: string; date?: string; confidence?: string }
export interface Mast extends TallPoint { height: number; station?: number; reason?: string; light?: LightClass; kind?: TowerKind; source?: string }
export interface PowerLine { pts: [number, number][]; towers: Mast[]; spans: { sag: number; ground: number[]; clearance: number[] }[]; circuits?: 1 | 2; ref?: string; source?: string }
export interface TallFile {
  version?: number;
  crs: string; root: [number, number, number, number]; mid: [number, number, number, number]; anchor: [number, number];
  turbines: Turbine[]; far: Turbine[]; towers: Mast[]; lines: PowerLine[];
}
/** Transport Canada Standard 621 §5.3 / Figure 5-1 red night-light height classes (metres AGL). */
export function mastLightClass(height: number): 'A0' | 'A1' | 'A2' {
  if (height <= 45) return 'A0';
  if (height <= 105) return 'A1';
  return 'A2';
}
/** Vertical light levels for communication masts (A0/A1/A2 red) and Auld's Cove crossing towers (W white strobes). */
export function obstructionLights(lightClass: LightClass): readonly ObstructionLight[] {
  if (lightClass === 'A0') return [{ frac: 1, kind: 'red-steady' }];
  if (lightClass === 'A1') return [{ frac: 1, kind: 'red-flash' }, { frac: 0.5, kind: 'red-steady' }];
  if (lightClass === 'A2') return [{ frac: 1, kind: 'red-flash' }, { frac: 0.75, kind: 'red-steady' }, { frac: 0.5, kind: 'red-flash' }, { frac: 0.25, kind: 'red-steady' }];
  return [{ frac: 1, kind: 'white-strobe' }, { frac: 0.67, kind: 'white-strobe' }, { frac: 0.33, kind: 'white-strobe' }];
}
/** Horizontal scale for a transmission tower: keeps 158 m Strait crossing towers and 48 m causeway towers slender. */
export function towerWidthScale(height: number, kind?: TowerKind): number {
  if (kind === 'crossing') return 44;
  return Math.min(height, 36);
}
export function rotorRate(diameter: number): number { return TIP_SPEED / (diameter / 2); }
export function rotorPhase(e: number, n: number): number {
  let h = Math.imul(Math.round(e * 100), 73856093) ^ Math.imul(Math.round(n * 100), 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296 * Math.PI * 2;
}
export function rotorAngle(diameter: number, e: number, n: number, seconds: number): number {
  return (rotorPhase(e, n) + rotorRate(diameter) * seconds) % (Math.PI * 2);
}
export function wireHeight(a: number, b: number, sag: number, t: number): number {
  return a * (1 - t) + b * t - 4 * sag * t * (1 - t);
}
/** Apply the same ground stretch as the land, while retaining real wire clearance above that ground. */
export function wireWorldHeight(a: number, b: number, sag: number, t: number, ground: number, exag: number, sea: number): number {
  const stretched = ground > sea ? sea + (ground - sea) * exag : ground;
  return wireHeight(a, b, sag, t) + stretched - ground;
}
export function inBox(p: TallPoint, b: readonly number[]): boolean { return p.e >= b[0] && p.e <= b[2] && p.n >= b[1] && p.n <= b[3]; }
export function pointSegment(e: number, n: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((e - a[0]) * dx + (n - a[1]) * dy) / l)) : 0;
  return Math.hypot(e - a[0] - t * dx, n - a[1] - t * dy);
}
export function inFootprint(e: number, n: number, pts: readonly (readonly number[])[]): boolean {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > n) !== (b[1] > n) && e < (b[0] - a[0]) * (n - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
