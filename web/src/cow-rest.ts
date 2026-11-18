import type { Road } from './roads';
import { RAIL, railPoint, roadLength } from './guardrail-rules';

/** Whole stock-cow model bounds, including head tracking, tail and up to .4m hoof adjustment.
 * Tests enclose the real rig over its full allowed pitch/roll/head range. */
export const COW_REST = { shoulder: 1.4, width: .65, length: 1.8, height: 1.9, padding: .05,
  railHalf: .15, clearance: .2, lateralStep: .1, alongStep: .25, localReach: 4 } as const;
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

/** First move inward from the old home; then search the nearest quarter-metre road stations.
 * `clear` can conservatively include rails that have not streamed in yet. */
export function cowRest(road: Road, along: number, side: number, ground: CowGround, clear: (body: CowBody) => boolean): CowRest | null {
  const length = roadLength(road), start = Math.max(0, Math.min(length, along));
  const at = (s: number): CowRest | null => {
    const line = road.halfWidth + RAIL.shoulder;
    const outer = line - COW_REST.width - COW_REST.padding - COW_REST.railHalf - COW_REST.clearance;
    const inner = Math.max(0, line - COW_REST.localReach), steps = Math.ceil((outer - inner) / COW_REST.lateralStep);
    for (let step = 0; step <= steps; step++) {
      const offset = Math.max(inner, outer - step * COW_REST.lateralStep);
      const p = railPoint(road, s, side * offset), body = cowBody(p.x, p.z, p.heading, ground);
      if (body && clear(body)) return { ...body, along: s };
    }
    return null;
  };
  const centre = railPoint(road, start);
  if (ground(centre.x, centre.z) === null) return null; // Wait for local land before searching.
  const local = at(start); if (local) return local;
  const extent = Math.max(start, length - start);
  for (let distance = COW_REST.alongStep; distance < extent + COW_REST.alongStep; distance += COW_REST.alongStep) {
    for (const sign of [1, -1]) {
      const target = start + sign * distance, previous = target - sign * COW_REST.alongStep;
      if (target < 0 && previous <= 0 || target > length && previous >= length) continue;
      const found = at(Math.max(0, Math.min(length, target))); if (found) return found;
    }
  }
  return null;
}
