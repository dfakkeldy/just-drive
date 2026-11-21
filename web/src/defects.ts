// Road damage that the eye and the wheels agree on: potholes and washboard.
// The same integer maths runs here (for the wheels) and in the terrain shader (for the picture),
// so a pothole is drawn exactly where the car falls into it.

export const POTHOLE_CELL = 3;          // metres: at most one pothole per cell
export const WASHBOARD_WAVE = 0.62;     // metres between ridges
export const WASHBOARD_DEPTH = 0.045;   // metres, trough to crest
/** A rough stretch (rough-roads.ts) holds this many more potholes per cell, and they are this much deeper.
 *  shaders.ts draws the same share. Measured 21 Nov 2026: pools every 4 to 8 m, often two across the lane. */
export const ROUGH_POTHOLES = 0.3;
export const ROUGH_DEPTH = 1.6;

// Dev-server diagnostic only: no UI, setting or URL can change this flag. Production rejects the setter.
let diagnosticPotholes = true;
export function setDiagnosticPotholes(enabled: boolean): void {
  if (import.meta.env?.DEV !== true) throw new Error('Pothole diagnostics require the dev server');
  diagnosticPotholes = enabled;
}

/** Share of cells that hold a pothole, by road kind (1 highway, 2 paved, 3 gravel, 4 track). A gravel driveway (a track
 *  that surfaceAt marks gravel) is drawn as a gravel road (terrain.ts drawnRoadBytes), so it holds a gravel road's holes.
 *  A rough stretch (only gravel and tracks carry the bit) holds ROUGH_POTHOLES more. */
export function potholeDensity(kind: number, washboard: boolean, gravel = false, rough = false): number {
  const base = kind === 1 ? 0.17 : kind === 2 ? 0.28 : kind === 3 || (kind === 4 && gravel) ? 0.42 : kind === 4 ? 0.36 : 0;
  return base + (washboard ? 0.2 : 0) + (rough ? ROUGH_POTHOLES : 0);
}

function cellHash(cx: number, cz: number): number {
  let h = (Math.imul(cx | 0, 73856093) ^ Math.imul(cz | 0, 19349663)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Depth of the pothole at a world point, in metres; 0 outside one. Mirrors `pothole()` in shaders.ts.
 *  `deeper` scales the floor (ROUGH_DEPTH on a rough stretch); the shader draws where a hole is, not how deep. */
export function potholeDepth(x: number, z: number, density: number, deeper = 1): number {
  if (!diagnosticPotholes || density <= 0) return 0;
  const cx = Math.floor(x / POTHOLE_CELL), cz = Math.floor(z / POTHOLE_CELL), h = cellHash(cx, cz);
  const r1 = (h & 255) / 255, r2 = ((h >>> 8) & 255) / 255, r3 = ((h >>> 16) & 255) / 255, r4 = (h >>> 24) / 255;
  if (r1 >= density) return 0;
  const px = (cx + 0.22 + 0.56 * r2) * POTHOLE_CELL, pz = (cz + 0.22 + 0.56 * r3) * POTHOLE_CELL;
  const radius = 0.25 + 0.4 * r4, d = Math.hypot(x - px, z - pz);
  if (d >= radius) return 0;
  const t = 1 - d / radius;
  return (0.05 + 0.09 * r2) * deeper * Math.min(1, t * 2.2);   // a flat floor with a short, steep rim
}

/** The pothole a 3 m cell holds, or null: centre (metres), radius and floor depth. The puddles fill these holes. */
export function potholeIn(cx: number, cz: number, density: number): { x: number; z: number; radius: number; depth: number } | null {
  if (!diagnosticPotholes || density <= 0) return null;
  const h = cellHash(cx, cz);
  const r1 = (h & 255) / 255, r2 = ((h >>> 8) & 255) / 255, r3 = ((h >>> 16) & 255) / 255, r4 = (h >>> 24) / 255;
  if (r1 >= density) return null;
  return { x: (cx + 0.22 + 0.56 * r2) * POTHOLE_CELL, z: (cz + 0.22 + 0.56 * r3) * POTHOLE_CELL, radius: 0.25 + 0.4 * r4, depth: 0.05 + 0.09 * r2 };
}

/** Height of the washboard ridges at a distance s along the road, in metres below the crest. */
export function washboard(s: number): number {
  return WASHBOARD_DEPTH * (0.5 - 0.5 * Math.cos((s / WASHBOARD_WAVE) * 2 * Math.PI));
}
