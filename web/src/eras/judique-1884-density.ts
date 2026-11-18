/**
 * A.F. Church and Co., topographical township map of Inverness County, Nova Scotia (1884).
 * Scan: David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries.
 * Position error near Judique: about 200 to 400 m (the two frozen fit checks inside the square: 239 m and 325 m);
 * cell edges are soft, not surveyed boundaries. Same method and frozen fit as the Mabou count.
 * Counts only; no names; house positions in the game are invented.
 * Six uncertain residence marks are excluded. The map has no Judique village inset, so village marks are
 * counted in their cells on the county panel and there is no separate village count.
 * No individual mark coordinates, source pixels or local paths are retained here.
 */
import type { DensitySpec } from './history-density';
export const JUDIQUE_DENSITY_ORIGIN = [614028, 5070564] as const;
/** Rows run south to north; columns west to east. The last column is 432 m wide; the last row 384 m. 240 residences. */
export const JUDIQUE_RESIDENCES_1884: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 1, 0, 1, 2, 1, 0, 2, 2, 1, 0, 0, 1, 8, 1, 0],
  [0, 0, 0, 1, 4, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 5, 0, 0, 1],
  [0, 0, 0, 4, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2],
  [0, 0, 0, 4, 2, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
  [0, 0, 0, 3, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3, 2, 2, 1, 0],
  [0, 0, 0, 3, 4, 1, 1, 0, 0, 1, 2, 0, 0, 1, 1, 4, 0, 2, 1],
  [0, 0, 0, 1, 3, 1, 0, 0, 1, 3, 2, 1, 2, 0, 0, 0, 0, 2, 1],
  [0, 0, 0, 4, 4, 0, 0, 1, 0, 0, 0, 0, 0, 3, 2, 3, 1, 0, 0],
  [0, 0, 3, 3, 1, 1, 4, 1, 3, 3, 1, 2, 0, 2, 0, 0, 1, 0, 0],
  [0, 0, 2, 3, 0, 1, 1, 3, 0, 0, 0, 0, 0, 1, 3, 0, 2, 3, 0],
  [0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1],
  [0, 0, 1, 3, 1, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0],
  [0, 0, 0, 1, 2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 1, 2, 1, 1, 4, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0],
  [0, 5, 1, 3, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 1, 0, 0],
  [0, 2, 0, 2, 2, 0, 0, 0, 2, 1, 0, 0, 2, 0, 0, 0, 1, 0, 2],
  [0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];
export const JUDIQUE_VILLAGE_RESIDENCES_1884 = 0;
export const JUDIQUE_VILLAGE_FOOTPRINT_1884: readonly (readonly [number, number])[] = [];
export const JUDIQUE_DENSITY: DensitySpec = Object.freeze({ area: 'judique', origin: JUDIQUE_DENSITY_ORIGIN, width: 18432, height: 16384, cell: 1000,
  residences: JUDIQUE_RESIDENCES_1884, villageResidences: JUDIQUE_VILLAGE_RESIDENCES_1884, village: JUDIQUE_VILLAGE_FOOTPRINT_1884, streetCentre: [0, 0] as const });
