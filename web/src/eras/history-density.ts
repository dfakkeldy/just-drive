/**
 * One area's 1884 residence counts, in the shape the offline layout generator reads.
 * Counts only; house positions in the game are invented. Not imported by the player bundle.
 */
import { DENSITY_CELL, DENSITY_ORIGIN, DENSITY_SIZE, RESIDENCES_1884, VILLAGE_FOOTPRINT_1884, VILLAGE_RESIDENCES_1884, densityCellId } from './mabou-1884-density';
import { JUDIQUE_DENSITY } from './judique-1884-density';
export interface DensitySpec {
  readonly area: 'mabou' | 'judique';
  /** South-west corner of the counted square, EPSG:2961. */
  readonly origin: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  /** Rows run south to north; columns west to east. */
  readonly residences: readonly (readonly number[])[];
  readonly villageResidences: number;
  readonly village: readonly (readonly [number, number])[];
  /** Village street ranking centre, in game x/z metres from the area's village origin. */
  readonly streetCentre: readonly [number, number];
}
export const MABOU_DENSITY: DensitySpec = Object.freeze({ area: 'mabou', origin: DENSITY_ORIGIN, width: DENSITY_SIZE, height: DENSITY_SIZE,
  cell: DENSITY_CELL, residences: RESIDENCES_1884, villageResidences: VILLAGE_RESIDENCES_1884, village: VILLAGE_FOOTPRINT_1884, streetCentre: [-35, 100] as const });
export const DENSITY_SPECS: Readonly<Record<DensitySpec['area'], DensitySpec>> = Object.freeze({ mabou: MABOU_DENSITY, judique: JUDIQUE_DENSITY });
export function specCellAt(spec: DensitySpec, e: number, n: number): string | null {
  const x = e - spec.origin[0], y = n - spec.origin[1];
  return x < 0 || y < 0 || x >= spec.width || y >= spec.height ? null : densityCellId(Math.floor(x / spec.cell), Math.floor(y / spec.cell));
}
export function inSpecVillage(spec: DensitySpec, e: number, n: number): boolean {
  let inside = false; const p = spec.village;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > n) !== (p[j][1] > n) && e < (p[j][0] - p[i][0]) * (n - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  return inside;
}
export { densityCellId };
