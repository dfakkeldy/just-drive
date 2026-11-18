import { latLonToUtm20, roadStarts } from './start-here';
import type { Road } from './roads';
// Official community position: https://geonames.nrcan.gc.ca/search-place-names/unique?id=CAXLL
export const MARBLE_MOUNTAIN = latLonToUtm20(45.818323, -61.042516);
/** Centreline distance within the playable box. Orient the tangent south toward West Bay and the quarry. */
export function sugarCampStart(roads: readonly Road[], village: [number, number], bounds: readonly number[]) {
  const pose = roadStarts(MARBLE_MOUNTAIN, village, roads, [], bounds, 1)[0];
  if (pose && Math.cos(pose.heading) > 0) pose.heading += Math.PI;
  return pose;
}
