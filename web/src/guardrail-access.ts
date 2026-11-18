import { railwayRoad } from './railway-road';
import type { Roads } from './roads';
import { RAIL, railPoint, type Access, type Ground } from './guardrail-rules';
import { surveyedOpenings } from './surveyed-road-openings';
const NO_PROPS: readonly { x: number; z: number; radius?: number }[] = [];
/** Mapped track lines sometimes end down the bank: require an actual driveable shoulder ramp. */
export function railAccess(roads: Roads, ground: Ground, village?: readonly [number, number], surveyed = true, props: readonly { x: number; z: number; radius?: number }[] = []): Access {
  const openings = surveyed && village ? surveyedOpenings(roads, village) : [];
  // Props are supplied by the area's parsed props.json, in the same world coordinates as roads.
  const cells = new Map<number, { x: number; z: number; radius?: number }[]>();
  const key = (x: number, z: number) => (x + 16384) * 32768 + z + 16384;
  for (const p of props) {
    const k = key(Math.floor(p.x / 64), Math.floor(p.z / 64)), bucket = cells.get(k) ?? [];
    bucket.push(p); cells.set(k, bucket);
  }
  return (road, p) => {
    const cx = Math.floor(p.x / 64), cz = Math.floor(p.z / 64);
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++)
      for (const prop of cells.get(key(i, j)) ?? NO_PROPS)
        if (Math.abs((prop.x - p.x) * Math.cos(p.heading) + (prop.z - p.z) * Math.sin(p.heading)) < (prop.radius ?? .8) + .3
          && Math.abs((prop.x - p.x) * Math.sin(p.heading) - (prop.z - p.z) * Math.cos(p.heading)) < (prop.radius ?? .8) + RAIL.pitch) return true;
    if (openings.some(o => o.road === road && Math.abs(p.along - o.along) <= o.width / 2)) return true;
    const hit = roads.nearest(p.x, p.z, 30, r => r !== road && !railwayRoad(r) && (r.bridge || r.kind <= 4));
    if (!hit || hit.dist > hit.road.halfWidth + (hit.road.kind <= 3 ? RAIL.junction : RAIL.clearance)) return false;
    if (hit.road.kind <= 3 || hit.road.bridge) return true;
    const side = Math.sign((p.x - hit.x) * Math.cos(p.heading) + (p.z - hit.z) * Math.sin(p.heading)) || 1;
    // The rail point already identifies its own side, independent of the crossing track's heading.
    const centre = roads.nearest(p.x, p.z, 20, r => r === road);
    if (!centre) return false;
    const ownSide = Math.sign((p.x - centre.x) * Math.cos(p.heading) + (p.z - centre.z) * Math.sin(p.heading)) || side;
    const a = railPoint(road, p.along, ownSide * road.halfWidth), b = railPoint(road, p.along, ownSide * (road.halfWidth + 8));
    const h = ground(a.x, a.z), f = ground(b.x, b.z);
    return h !== null && f !== null && Math.abs(h - f) <= 1.6;
  };
}
