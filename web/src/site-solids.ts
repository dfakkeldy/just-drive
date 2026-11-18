import type { Solid } from './parked';

/** pushOut skips a solid whose centre is more than `half` plus the car's reach away on either world axis. A turned
 *  rectangle reaches up to hypot(half, halfWidth) on an axis, so a corner could be skipped. Each solid is turned so
 *  that `half` is its long side, then cut along its length into strips narrow enough that no corner reaches more
 *  than CORNER_SLACK past `half` (less than the bike's slack in pushOut). */
export const CORNER_SLACK = 0.4;
export function strips(s: Solid): Solid[] {
  const t = s.halfWidth > s.half ? { ...s, half: s.halfWidth, halfWidth: s.half, heading: s.heading + Math.PI / 2 } : s;
  const widest = Math.sqrt((t.half + CORNER_SLACK) ** 2 - t.half ** 2), n = Math.ceil(2 * t.halfWidth / widest - 1e-9);
  const w = t.halfWidth / n, vx = Math.cos(t.heading), vz = Math.sin(t.heading);
  return Array.from({ length: n }, (_, i) => { const off = -t.halfWidth + w * (2 * i + 1); return { ...t, x: t.x + vx * off, z: t.z + vz * off, halfWidth: w }; });
}
