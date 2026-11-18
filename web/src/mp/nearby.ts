import type { Ride } from './wire';
export interface Footprint { x: number; z: number; heading: number; spec?: { halfLength: number; halfWidth: number } }
/** Conservative footprint includes the attached trailer. No per-frame pose fields are needed. */
function length(ride?: Ride): number { return ride?.trailer ? 8.5 : ride?.kind === 'truck' ? 3.5 : ride?.kind === 'bike' ? 1.3 : ride?.kind === 'sxs' ? 1.8 : 2.3; }
function width(ride?: Ride): number { return ride?.kind === 'truck' ? 1.35 : ride?.kind === 'bike' ? .55 : ride?.kind === 'sxs' ? .95 : 1; }
/** SAT on the two vehicle axes, including the rearward trailer footprint. */
export function footprintsOverlap(a: Footprint, b: Footprint, ride?: Ride, localRide?: Ride): boolean {
  const al = localRide?.trailer ? length(localRide) : a.spec?.halfLength ?? 2.3, aw = a.spec?.halfWidth ?? width(localRide);
  const bl = length(ride), bw = width(ride);
  const as = Math.sin(a.heading), ac = Math.cos(a.heading), bs = Math.sin(b.heading), bc = Math.cos(b.heading);
  const dx = b.x - bs*(ride?.trailer ? 5 : 0) - a.x + as*(localRide?.trailer ? 5 : 0);
  const dz = b.z + bc*(ride?.trailer ? 5 : 0) - a.z - ac*(localRide?.trailer ? 5 : 0);
  const dot = Math.abs(as*bs+ac*bc), cross = Math.abs(as*bc-ac*bs);
  return Math.abs(dx*as-dz*ac) <= al+bl*dot+bw*cross
    && Math.abs(dx*ac+dz*as) <= aw+bw*dot+bl*cross
    && Math.abs(dx*bs-dz*bc) <= bl+al*dot+aw*cross
    && Math.abs(dx*bc+dz*bs) <= bw+aw*dot+al*cross;
}
export function nearbyOpacity(distance: number, overlaps = false): number {
  if (overlaps) return .35;
  const u = Math.max(0, Math.min(1, (distance-4)/2));
  return .35 + .65*u*u*(3-2*u);
}
export function easeOpacity(current: number, target: number, dt: number): number {
  return current + (target-current)*(1-Math.exp(-10*Math.max(0,Math.min(dt,.1))));
}
