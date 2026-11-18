import type { Road } from './roads';

/** Explicit source tags win. Older provincial bakes use the exact class label `Railroad`.
 * A road called Railway Road or Active Rail Road is not that class. */
export function railwayRoad(road: Pick<Road, 'name' | 'railway' | 'tags'>): boolean {
  const tag = road.railway ?? road.tags?.railway;
  if (tag !== undefined) return tag === true || typeof tag === 'string' && !['no', 'false', '0', ''].includes(tag);
  return road.name === 'Railroad';
}
