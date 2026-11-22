import type { Road } from './roads';
import { railPoint, roadLength } from './guardrail-rules';

/** Whole stock-cow model bounds, including head tracking, tail and up to .4m hoof adjustment.
 * Tests enclose the real rig over its full allowed pitch/roll/head range. */
export const COW_REST = { shoulder: 1.4, width: .65, length: 1.8, height: 1.9, padding: .05,
  railHalf: .15, clearance: .2, roadGap: .5, lateralStep: .1, alongStep: .25, localReach: 4 } as const;
export interface CowBody { x: number; z: number; heading: number; halfWidth: number; halfLength: number }
export type CowGround = (x: number, z: number) => number | null;
export interface CowRest extends CowBody { along: number }

export function cowBody(x: number, z: number, heading: number, ground: CowGround): CowBody | null {
  const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
  const supportWidth = COW_REST.shoulder * .25;
  const samples = [ground(x, z), ground(x + fx * .72, z + fz * .72), ground(x - fx * .72, z - fz * .72),
    ground(x + rx * supportWidth, z + rz * supportWidth), ground(x - rx * supportWidth, z - rz * supportWidth)];
  if (samples.some(h => h === null)) return null;
  const [centre, front, back, right, left] = samples as number[];
  if (![centre, front, back, right, left].every(Number.isFinite)) return null;
  const clamp = (v: number) => Math.max(-.55, Math.min(.55, v));
  const pitch = clamp(Math.atan2(front - back, 1.44)), roll = clamp(Math.atan2(right - left, supportWidth * 2));
  const vertical = COW_REST.height * Math.cos(roll) + COW_REST.width * Math.abs(Math.sin(roll));
  return { x, z, heading,
    halfWidth: COW_REST.width * Math.cos(roll) + COW_REST.height * Math.abs(Math.sin(roll)) + COW_REST.padding,
    halfLength: COW_REST.length * Math.cos(pitch) + vertical * Math.abs(Math.sin(pitch)) + COW_REST.padding };
}

const pointSegment = (x: number, z: number, ax: number, az: number, bx: number, bz: number): number => {
  const dx = bx - ax, dz = bz - az, len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0;
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
};
/** Exact 2D segment-to-body rectangle distance, less the rail's collision half-width. */
export function cowRailGap(body: CowBody, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const rx = Math.cos(body.heading), rz = Math.sin(body.heading), fx = Math.sin(body.heading), fz = -Math.cos(body.heading);
  const ax = (a.x - body.x) * rx + (a.z - body.z) * rz, az = (a.x - body.x) * fx + (a.z - body.z) * fz;
  const bx = (b.x - body.x) * rx + (b.z - body.z) * rz, bz = (b.x - body.x) * fx + (b.z - body.z) * fz;
  let lo = 0, hi = 1;
  for (const [p, d, half] of [[ax, bx - ax, body.halfWidth], [az, bz - az, body.halfLength]]) {
    if (Math.abs(d) < 1e-12) { if (Math.abs(p) > half) { lo = 2; break; } }
    else { const x = (-half - p) / d, y = (half - p) / d; lo = Math.max(lo, Math.min(x, y)); hi = Math.min(hi, Math.max(x, y)); }
  }
  if (lo <= hi) return -COW_REST.railHalf;
  const endpoint = (x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x) - body.halfWidth), Math.max(0, Math.abs(z) - body.halfLength));
  let distance = Math.min(endpoint(ax, az), endpoint(bx, bz));
  for (const x of [-body.halfWidth, body.halfWidth]) for (const z of [-body.halfLength, body.halfLength])
    distance = Math.min(distance, pointSegment(x, z, ax, az, bx, bz));
  return distance - COW_REST.railHalf;
}

/** Whole body to the actual road ribbon, including bends through the body box. */
export function cowRoadGap(body: CowBody, road: Road): number {
  let gap = Infinity;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i];
    gap = Math.min(gap, cowRailGap(body, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }) + COW_REST.railHalf - road.halfWidth);
  }
  return gap;
}

/** Search outward into the field, then nearby stations. Never relocate to a distant pasture. */
export function cowRest(road: Road, along: number, side: number, ground: CowGround, clear: (body: CowBody) => boolean, roadGround: CowGround = ground): CowRest | null {
  const length = roadLength(road), start = Math.max(0, Math.min(length, along));
  const at = (s: number): CowRest | null => {
    const centre = railPoint(road, s), roadHeight = roadGround(centre.x, centre.z);
    if (roadHeight === null) return null;
    const inner = road.halfWidth + COW_REST.roadGap + COW_REST.width + COW_REST.padding;
    const steps = Math.ceil(COW_REST.localReach / COW_REST.lateralStep);
    for (let step = 0; step <= steps; step++) {
      const offset = inner + step * COW_REST.lateralStep;
      const p = railPoint(road, s, side * offset), body = cowBody(p.x, p.z, p.heading, ground);
      if (!body || offset - body.halfWidth < road.halfWidth + COW_REST.roadGap - 1e-6) continue;
      const rx = Math.cos(p.heading), rz = Math.sin(p.heading), fx = Math.sin(p.heading), fz = -Math.cos(p.heading);
      const h = ground(p.x, p.z), inward = ground(p.x - rx * side, p.z - rz * side), outward = ground(p.x + rx * side, p.z + rz * side);
      const front = ground(p.x + fx * .72, p.z + fz * .72), back = ground(p.x - fx * .72, p.z - fz * .72);
      const w = COW_REST.shoulder * .25, right = ground(p.x + rx * w, p.z + rz * w), left = ground(p.x - rx * w, p.z - rz * w);
      if (h === null || inward === null || outward === null || front === null || back === null || right === null || left === null) continue;
      // A local ditch or a bank steeper than the rig can stand on is not grazing land.
      if (h < roadHeight || outward < inward || Math.abs(front - back) > Math.tan(.55) * 1.44 || Math.abs(right - left) > Math.tan(.55) * w * 2) continue;
      if (cowRoadGap(body, road) >= COW_REST.roadGap - 1e-6 && clear(body)) return { ...body, along: s };
    }
    return null;
  };
  const centre = railPoint(road, start);
  if (roadGround(centre.x, centre.z) === null) return null; // Wait for unknown road height, not for grazing land on the road.
  const local = at(start); if (local) return local;
  const extent = Math.min(COW_REST.localReach, Math.max(start, length - start));
  for (let distance = COW_REST.alongStep; distance < extent + COW_REST.alongStep; distance += COW_REST.alongStep) {
    for (const sign of [1, -1]) {
      const target = start + sign * distance, previous = target - sign * COW_REST.alongStep;
      if (target < 0 && previous <= 0 || target > length && previous >= length) continue;
      const found = at(Math.max(0, Math.min(length, target))); if (found) return found;
    }
  }
  return null;
}
