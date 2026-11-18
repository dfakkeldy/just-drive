/** Signal locations: OSM road junction geometry + municipal traffic study.
 * See tools/traffic-signals-sources.md. Timings and pole offsets are game approximations.
 * Heading here is atan2(world east, world south), pointing OUT of the junction.
 */
export type Lamp = 'red' | 'amber' | 'green';
export interface SignalApproach { road: string; heading: number; phase: 0 | 1 }
export interface SignalJunction {
  id: string; area: string; east: number; north: number; offset: number;
  approaches: readonly SignalApproach[];
}
export const SIGNAL_JUNCTIONS: readonly SignalJunction[] = [
  { id: 'reeves-pitt', area: 'pointtupper', east: 628146.721, north: 5052750.914, offset: 0, approaches: [
    { road: 'Pitt Street', heading: -0.739683, phase: 1 },
    { road: 'Reeves Street', heading: -2.420960, phase: 0 },
    { road: 'Reeves Street', heading: 1.007178, phase: 0 },
  ] },
  { id: 'reeves-reynolds', area: 'pointtupper', east: 628504.317, north: 5052576.835, offset: 17, approaches: [
    { road: 'Reynolds Street', heading: -0.423356, phase: 1 },
    { road: 'Reynolds Street', heading: 2.705787, phase: 1 },
    { road: 'Reeves Street', heading: 1.131514, phase: 0 },
    { road: 'Reeves Street', heading: -2.028142, phase: 0 },
  ] },
  { id: 'reeves-trunk4', area: 'pointtupper', east: 629039.100, north: 5052260.809, offset: 34, approaches: [
    { road: 'Industrial Park Road', heading: -0.712247, phase: 1 },
    { road: 'Reeves Street', heading: -2.303050, phase: 0 },
    { road: 'Highway 4', heading: 2.406170, phase: 1 },
  ] },
  { id: 'paint-tamarac-trunk4', area: 'pointtupper', east: 629795.243, north: 5052985.769, offset: 11, approaches: [
    { road: 'Paint Street', heading: 1.218240, phase: 1 },
    { road: 'Tamarac Drive', heading: -1.611906, phase: 1 },
    { road: 'Highway 4', heading: 2.772951, phase: 0 },
    { road: 'Highway 4', heading: -0.365006, phase: 0 },
  ] },
];
export const SIGNAL_PERIOD = 54;
/** 24 green / 3 amber / 2 all red, then 20 green / 3 amber / 2 all red. */
export function signalLamp(seconds: number, offset: number, phase: 0 | 1): Lamp {
  const t = ((seconds + offset) % SIGNAL_PERIOD + SIGNAL_PERIOD) % SIGNAL_PERIOD;
  if (phase === 0) return t < 24 ? 'green' : t < 27 ? 'amber' : 'red';
  return t < 29 ? 'red' : t < 49 ? 'green' : t < 52 ? 'amber' : 'red';
}
export interface SignalStop { x: number; z: number; dx: number; dz: number; halfWidth: number; phase: 0 | 1; junction: SignalJunction }
/** Traffic PR #155 hook: pass car centre and unit forward vector each traffic step.
 * Returns metres to stop line (0 while at it), or Infinity when unrestricted.
 * Amber also requests a stop. Vehicles already across the line clear the junction.
 */
export function signalStopDistance(stops: readonly SignalStop[], seconds: number,
  x: number, z: number, forwardX: number, forwardZ: number): number {
  let nearest = Infinity;
  for (const s of stops) {
    if (signalLamp(seconds, s.junction.offset, s.phase) === 'green') continue;
    if (forwardX * s.dx + forwardZ * s.dz > -0.7) continue;
    const rx = x - s.x, rz = z - s.z;
    const distance = rx * s.dx + rz * s.dz;
    if (distance < 0 || distance > 80 || Math.abs(rx * s.dz - rz * s.dx) > s.halfWidth + 1) continue;
    nearest = Math.min(nearest, Math.max(0, distance));
  }
  return nearest;
}
