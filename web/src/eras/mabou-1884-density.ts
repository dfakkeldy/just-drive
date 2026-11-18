/**
 * A.F. Church and Co., topographical township map of Inverness County, Nova Scotia (1884).
 * Scan: David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries.
 * Position error near Mabou: about 200 to 400 m; cell edges are soft, not surveyed boundaries.
 * Counts only; no names; house positions in the game are invented.
 * Six uncertain residence marks are excluded. Village roofs are counted once, separately.
 * No individual mark coordinates, source pixels or local paths are retained here.
 */
export const DENSITY_ORIGIN = [616076, 5095140] as const;
export const DENSITY_SIZE = 16384;
export const DENSITY_CELL = 1000;
/** Rows run south to north; columns west to east. The last strips are 384 m wide. */
export const RESIDENCES_1884: readonly (readonly number[])[] = [
  [0, 2, 0, 3, 2, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 2, 0, 2, 0, 1, 3, 2, 0, 0, 0, 2, 3, 0, 0, 0, 0],
  [0, 2, 0, 5, 0, 0, 0, 1, 1, 1, 0, 1, 1, 2, 1, 5, 0],
  [2, 1, 0, 0, 0, 1, 2, 1, 3, 2, 2, 0, 1, 0, 4, 1, 0],
  [0, 0, 1, 5, 3, 1, 0, 0, 3, 0, 0, 0, 3, 1, 1, 1, 0],
  [0, 3, 3, 2, 1, 2, 1, 0, 1, 0, 0, 0, 1, 2, 3, 1, 0],
  [1, 0, 1, 0, 2, 0, 1, 0, 0, 3, 0, 0, 2, 2, 0, 2, 0],
  [1, 0, 2, 1, 2, 1, 0, 1, 2, 0, 3, 3, 6, 0, 0, 0, 0],
  [0, 2, 1, 1, 0, 2, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 2, 3, 0, 0, 1, 0, 1, 0, 0, 0, 3, 0],
  [0, 0, 6, 3, 2, 0, 2, 4, 2, 1, 3, 6, 0, 0, 0, 2, 0],
  [0, 0, 1, 0, 1, 1, 1, 3, 1, 1, 0, 0, 2, 1, 0, 0, 1],
  [0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 2, 0, 0, 0, 2, 0],
  [0, 0, 2, 2, 0, 0, 1, 1, 1, 1, 0, 2, 0, 1, 1, 0, 0],
  [0, 0, 1, 2, 0, 2, 1, 3, 2, 1, 0, 1, 4, 0, 2, 2, 0],
  [0, 0, 1, 1, 0, 0, 0, 2, 1, 2, 1, 2, 2, 1, 2, 1, 0],
  [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0],
];
export const VILLAGE_RESIDENCES_1884 = 35;
/** Rough inset footprint; boundary uncertainty about 500 m (plausibly 300 to 700 m). */
export const VILLAGE_FOOTPRINT_1884: readonly (readonly [number, number])[] = [[623866.7, 5104012.0], [624455.7, 5104370.1], [625813.6, 5104300.9], [625961.7, 5103622.0], [624761.4, 5102789.8], [623676.1, 5102917.9], [623337.6, 5103463.2]];
export const densityCellId = (column: number, row: number): string =>
  `E${String(column).padStart(2, '0')}-N${String(row).padStart(2, '0')}`;
export function densityCellAt(e: number, n: number): string | null {
  const x=e-DENSITY_ORIGIN[0],y=n-DENSITY_ORIGIN[1];
  return x<0||y<0||x>=DENSITY_SIZE||y>=DENSITY_SIZE?null:densityCellId(Math.floor(x/DENSITY_CELL),Math.floor(y/DENSITY_CELL));
}
export function inVillage1884(e: number, n: number): boolean {
  let inside=false;const p=VILLAGE_FOOTPRINT_1884;
  for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>n)!==(p[j][1]>n)&&e<(p[j][0]-p[i][0])*(n-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;
  return inside;
}
