/** Shared numeric limits keep placement and spatial-grid iteration in a safe range. */
export const MAX_POSE_COORD = 1e7;
export const PLACEMENT_MARGIN = 64;
export type PlacementBounds = readonly [number, number, number, number] | null;
export function finitePose(x: number, z: number, heading: number): boolean {
  return Number.isFinite(x) && Number.isFinite(z) && Number.isFinite(heading)
    && Math.abs(x) <= MAX_POSE_COORD && Math.abs(z) <= MAX_POSE_COORD && Math.abs(heading) <= MAX_POSE_COORD;
}
export function safePlacement(x: number, z: number, heading: number, bounds: PlacementBounds): boolean {
  return finitePose(x, z, heading) && (!bounds ||
    x >= bounds[0] - PLACEMENT_MARGIN && z >= bounds[1] - PLACEMENT_MARGIN &&
    x <= bounds[2] + PLACEMENT_MARGIN && z <= bounds[3] + PLACEMENT_MARGIN);
}
interface Placeable {
  bounds: PlacementBounds;
  place(x: number, z: number, heading: number): boolean | void;
}
/** Both URL keys use this path. A refusal must let startup choose its normal fallback. */
export function placeUrlPose(vehicle: Placeable, origin: readonly [number, number], pose: readonly number[]): boolean {
  const heading = pose[2] ?? 0;
  if (!finitePose(pose[0], pose[1], heading)) return false;
  const x = pose[0] - origin[0], z = origin[1] - pose[1], radians = heading * Math.PI / 180;
  return safePlacement(x, z, radians, vehicle.bounds) && vehicle.place(x, z, radians) === true;
}
