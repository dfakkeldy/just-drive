/** The launch and one flight step are shared by live mail and the throw-now preview. */
export interface Flight { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export interface Launch {
  x: number; y: number; z: number; vx: number; vz: number; heading: number; kind: number; thrown: number; sideOffset?: number;
}
export const MAIL_CYCLE = [0, 1, 0, 2, 1, 0, 2, 0, 3, 1, 2, 0, 1];
export const MAIL_SIZES = [[.34, .065, .23], [.38, .035, .27], [.36, .26, .3], [.72, .55, .62]];
export const FLIGHT_STEP = 1 / 60;
export const PREVIEW_TICKS = 120;
const AIM_LIMIT = .35;
export function launchMail(v: Launch): Flight {
  const rightX = Math.cos(v.heading), rightZ = Math.sin(v.heading);
  const parcel = v.kind >= 2, sideways = parcel ? 6 : 7;
  const variety = Math.sin(v.thrown * 2.4);
  return { x: v.x + rightX * (v.sideOffset ?? .48), y: v.y - .08, z: v.z + rightZ * (v.sideOffset ?? .48),
    vx: v.vx + rightX * sideways + Math.sin(v.heading) * variety * .5,
    vz: v.vz + rightZ * sideways - Math.cos(v.heading) * variety * .5,
    vy: (parcel ? 2.1 : 2.5) + variety * .18 };
}
export function stepMail(p: Flight, kind: number, dt: number): Flight {
  const drag = kind === 1 ? Math.exp(-dt * 1.8) : Math.exp(-dt * .12);
  const vx = p.vx * drag, vz = p.vz * drag, vy = p.vy - (kind === 1 ? 5.8 : 9.81) * dt;
  return { vx, vy, vz, x: p.x + vx * dt, y: p.y + vy * dt, z: p.z + vz * dt };
}

export interface CatchTarget { x: number; z: number; y?: number; ground?: boolean }
type Ground = (x: number, z: number) => number | null;
export type FlightHit = (a: Flight, b: Flight, landed: boolean) => number;
/** One complete physics/contact tick. Prediction and assisted pieces use this same operation. */
export function advanceMail(p: Flight, kind: number, dt: number, ground: Ground, hit: FlightHit) {
  const flight = stepMail(p, kind, dt), floor = ground(flight.x, flight.z);
  const landed = floor !== null && flight.y - MAIL_SIZES[kind][1] / 2 <= floor;
  return { flight, ground: floor, landed, hit: hit(p, flight, landed) };
}
interface Trace { hit: boolean; miss: number }
/** Up to two seconds, stopping at first contact. */
function trace(start: Flight, kind: number, target: CatchTarget, ground: Ground,
  hit: FlightHit, accepts: (index: number) => boolean, targetIndex: number): Trace {
  const level = ground(target.x, target.z);
  if (level === null) return { hit: false, miss: Infinity };
  const targetY = target.y ?? level + 1.2;
  let p = start, miss = Infinity;
  for (let k = 0; k < PREVIEW_TICKS; k++) {
    const contact = advanceMail(p, kind, FLIGHT_STEP, ground, hit), next = contact.flight;
    const index = contact.hit;
    if (index >= 0) return { hit: index === targetIndex && accepts(index), miss: Infinity };
    const distance = Math.hypot(next.x - target.x, next.y - targetY, next.z - target.z);
    if (distance < miss) miss = distance;
    if (contact.landed) break;
    p = next;
  }
  return { hit: false, miss };
}
export interface FlightBounds { x0: number; x1: number; z0: number; z1: number }
/** Drag only reduces horizontal speed. Cover both traces and every bounded aim change, plus landing reach. */
export function previewBounds(start: Flight, heading: number): FlightBounds {
  const rx = Math.cos(heading), rz = Math.sin(heading), fx = Math.sin(heading), fz = -Math.cos(heading);
  const side = start.vx * rx + start.vz * rz, forward = start.vx * fx + start.vz * fz;
  const dx = AIM_LIMIT * (Math.abs(rx * side) + Math.abs(fx * forward));
  const dz = AIM_LIMIT * (Math.abs(rz * side) + Math.abs(fz * forward));
  const duration = PREVIEW_TICKS * FLIGHT_STEP, reach = 1.3000001;
  return { x0: start.x + Math.min(0, start.vx - dx) * duration - reach,
    x1: start.x + Math.max(0, start.vx + dx) * duration + reach,
    z0: start.z + Math.min(0, start.vz - dz) * duration - reach,
    z1: start.z + Math.max(0, start.vz + dz) * duration + reach };
}

export interface ThrowPlan { flight: Flight; hit: boolean; helped: boolean }
export function planMail(start: Flight, kind: number, heading: number, target: CatchTarget, ground: Ground,
  hit: FlightHit, accepts: (index: number) => boolean, targetIndex: number): ThrowPlan {
  const original = trace(start, kind, target, ground, hit, accepts, targetIndex);
  if (original.hit || original.miss >= 2) return { flight: start, hit: original.hit, helped: false };
  const level = ground(target.x, target.z);
  if (level === null) return { flight: start, hit: false, helped: false };
  const rx = Math.cos(heading), rz = Math.sin(heading), fx = Math.sin(heading), fz = -Math.cos(heading);
  const side = start.vx * rx + start.vz * rz, forward = start.vx * fx + start.vz * fz;
  const bound = (value: number, old: number) => Math.max(old - Math.abs(old) * AIM_LIMIT, Math.min(old + Math.abs(old) * AIM_LIMIT, value));
  const dx = target.x - start.x, dz = target.z - start.z, dy = (target.y ?? level + 1.2) - start.y;
  const drag = Math.exp(-FLIGHT_STEP * (kind === 1 ? 1.8 : .12)), gravity = kind === 1 ? 5.8 : 9.81;
  let unitV = 1, scale = 0, best = Infinity, bestSide = side, bestForward = forward, bestLift = start.vy;
  // Solve the actual fixed-step arc. Keep side/forward within 35% and lift within 3 m/s.
  // Lowering the near throw reaches lane-centre boxes without enlarging their openings.
  for (let k = 1; k <= PREVIEW_TICKS; k++) {
    unitV *= drag; scale += unitV * FLIGHT_STEP;
    const time = k * FLIGHT_STEP;
    const s = bound((dx * rx + dz * rz) / scale, side), f = bound((dx * fx + dz * fz) / scale, forward);
    const lift = Math.max(start.vy - 3, Math.min(start.vy + 3, (dy + gravity * FLIGHT_STEP ** 2 * k * (k + 1) / 2) / time));
    const horizontalError = Math.hypot((s * rx + f * fx) * scale - dx, (s * rz + f * fz) * scale - dz);
    const verticalError = Math.abs(lift * time - gravity * FLIGHT_STEP ** 2 * k * (k + 1) / 2 - dy);
    if (horizontalError > (target.ground ? .5 : .0800001) || verticalError > .04) continue;
    const correction = (s - side) ** 2 + (f - forward) ** 2 + (lift - start.vy) ** 2;
    if (correction < best) { best = correction; bestSide = s; bestForward = f; bestLift = lift; }
  }
  if (!Number.isFinite(best)) return { flight: start, hit: false, helped: false };
  const flight = { ...start, vx: bestSide * rx + bestForward * fx, vz: bestSide * rz + bestForward * fz, vy: bestLift };
  const adjusted = trace(flight, kind, target, ground, hit, accepts, targetIndex);
  return adjusted.hit ? { flight, hit: true, helped: true } : { flight: start, hit: false, helped: false };
}
