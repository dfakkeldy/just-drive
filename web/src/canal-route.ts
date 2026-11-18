/** Centre and heading of the water corridor, checked against the baked height tiles.
 * EPSG:2961 metres. The channel is skewed to the road and east of the span midpoint.
 */
export const CANAL_ROUTE = { east: 623681.953, north: 5056107.577, eastward: 0.7193398003386512, northward: -0.6946583704589973, halfLength: 100 };
export function canalBoatPose(progress: number, village: [number, number], out = { x: 0, z: 0, heading: 0 }) {
  const t = (progress - .5) * CANAL_ROUTE.halfLength * 2;
  out.x = CANAL_ROUTE.east + CANAL_ROUTE.eastward * t - village[0]; out.z = village[1] - CANAL_ROUTE.north - CANAL_ROUTE.northward * t;
  out.heading = Math.atan2(CANAL_ROUTE.eastward, -CANAL_ROUTE.northward); return out;
}
