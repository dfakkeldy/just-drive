import type { Roads, Road } from './roads';
import { railStation } from './guardrail-rules';
// Surveyed openings, EPSG:2961 game coordinates. Widths are rail-clear openings,
// including the approach space between the observed rail ends, not gate-leaf widths.
// This list may only exclude rail. It never starts, extends or chooses a rail run.
export const SURVEYED_ROAD_OPENINGS = [
  { east: 619011, north: 5109683, width: 16 }, // surveyed grassy opening between cliff runs
  { east: 618988, north: 5109228, width: 26 }, // surveyed field-gate opening
  { east: 619002, north: 5109150, width: 16 }, // surveyed gravel-driveway opening
] as const;
export function surveyedOpenings(roads: Roads, village: readonly [number, number]): { road: Road; along: number; width: number }[] {
  return SURVEYED_ROAD_OPENINGS.flatMap(p => {
    const hit = roads.nearest(p.east - village[0], village[1] - p.north, 20, r => r.kind <= 3 && !r.bridge);
    return hit ? [{ road: hit.road, along: railStation(hit.road, hit.seg, hit.t), width: p.width }] : [];
  });
}
