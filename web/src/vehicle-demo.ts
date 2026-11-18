import { MathUtils } from 'three';
import type { RoadHit } from './roads';
import type { Input, Vehicle } from './vehicle';

/** A coupled demo rig follows a point in its lane, including the bend ahead of the front axle. */
export function wideDemo(v: Vehicle, hit: RoadHit, heading: number, cruise: number): Input {
  const width = Math.max(v.spec.envelope.sweepHalfWidth, v.towLoad?.halfWidth ?? 0), half = hit.road.halfWidth;
  const lane = Math.min(Math.max(half * .5, width + .08), Math.max(0, half - width - .08));
  const forward = Math.cos(hit.heading - heading) >= 0, pts = hit.road.pts;
  let seg = hit.seg, fraction = hit.t, left = Math.max(7, Math.abs(v.speed) * .7);
  while (true) {
    const a = pts[seg], b = pts[seg + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const available = length * (forward ? 1 - fraction : fraction);
    if (left <= available || (forward ? seg === pts.length - 2 : seg === 0)) {
      fraction = MathUtils.clamp(fraction + (forward ? 1 : -1) * left / (length || 1), 0, 1);
      const targetHeading = Math.atan2(b[0] - a[0], a[1] - b[1]) + (forward ? 0 : Math.PI);
      const x = a[0] + (b[0] - a[0]) * fraction + Math.cos(targetHeading) * lane;
      const z = a[1] + (b[1] - a[1]) * fraction + Math.sin(targetHeading) * lane;
      const distance = Math.max(1, Math.hypot(x - v.x, z - v.z));
      const error = Math.atan2(Math.sin(Math.atan2(x - v.x, v.z - z) - v.heading), Math.cos(Math.atan2(x - v.x, v.z - z) - v.heading));
      const angle = Math.atan2(2 * v.spec.wheelbase * Math.sin(error), distance);
      const mu = v.surfaceName === 'washboard' ? .6 : v.surfaceName === 'gravel' ? .72 : 1;
      const lock = Math.min(v.spec.maxSteer, Math.atan(v.spec.wheelbase * v.spec.gripLock * v.spec.cornering * mu * 9.81 / Math.max(v.speed * v.speed, 4)));
      const target = cruise * (1 - .45 * Math.min(1, Math.abs(error)));
      return { throttle: MathUtils.clamp((target - v.speed) * .8, -1, 1), steer: MathUtils.clamp(angle / lock, -1, 1), handbrake: false };
    }
    left -= available; seg += forward ? 1 : -1; fraction = forward ? 0 : 1;
  }
}
