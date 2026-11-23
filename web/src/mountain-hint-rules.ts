import { CHURCH_ORIGIN } from './church-site';
import { ROUGH_STRETCHES } from './rough-roads';
import type { Road, Roads } from './roads';
import type { Device } from './gamepad-rules';

export const MOUNTAIN_HINT_TEXT = 'Rough road ahead: the side-by-side handles it better';
export const MOUNTAIN_HINT_DURATION = 14;
export const MOUNTAIN_ROAD_NAME = 'River Denys Mountain Road';
export const CHURCH_ROAD_NAME = 'River Denys Road';
export const DEFAULT_SXS_ID = 'sxs';

/** Minimum forward speed (m/s) while driving onto the mountain road before the hint shows. */
export const MOUNTAIN_HINT_MIN_SPEED = 0.3;
/** Minimum cosine alignment between vehicle heading and the toward-church road tangent (~63 deg). */
export const MOUNTAIN_HINT_HEADING_COS = 0.45;
/** Stop firing this close to the church so a direct jump to CHURCH_START never shows the hint. */
export const MOUNTAIN_HINT_CHURCH_CLEAR = 220;
/** Metres before the first rough stretch on River Denys Road where the hint may fire. */
export const MOUNTAIN_HINT_LEAD_M = 150;

/** Matches the existing `sxs` ride and any future side-by-side lineup variants. */
export function isSideBySideId(id: string): boolean {
  return id === DEFAULT_SXS_ID || id.startsWith('sxs-') || id.startsWith('sxs_');
}

/** Pick the default side-by-side id from the garage (`sxs`, or the first side-by-side if renamed). */
export function defaultSideBySideId(garage: readonly { id: string }[]): string | null {
  if (garage.some(entry => entry.id === DEFAULT_SXS_ID)) return DEFAULT_SXS_ID;
  return garage.find(entry => isSideBySideId(entry.id))?.id ?? null;
}

/** Car-like rides get the hint; side-by-sides, horses, dirt bikes and the drone never do. */
export function isMountainHintEligibleRide(kind: string): boolean {
  return !!kind && !isSideBySideId(kind) && kind !== 'horse' && kind !== 'bike' && kind !== 'drone';
}

export function mountainSwitchLabel(device: Device): string {
  if (device === 'gamepad') return 'Switch to side-by-side · Y / Triangle';
  if (device === 'keyboard') return 'Switch to side-by-side · Enter';
  return 'Switch to side-by-side';
}

interface ApproachSpan {
  road: Road;
  /** Inclusive segment range [startSeg, endSeg] on this road piece where the hint can trigger. */
  startSeg: number;
  endSeg: number;
  /** +1 when increasing vertex index heads toward the church, -1 when decreasing does. */
  towardSign: 1 | -1;
}

const nearPt = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;

function cumulative(pts: readonly [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return cum;
}

/**
 * Resolves the mountain road approaches toward St. Margaret of Scotland church:
 * 1. River Denys Mountain Road (climbing north from Highway 105 toward the church).
 * 2. The rough mountain stretches of River Denys Road (eastbound from Judique toward the church),
 *    starting just before the first rough stretch and ending short of CHURCH_START.
 */
export class MountainApproach {
  readonly church: { x: number; z: number };
  private readonly spans = new Map<Road, ApproachSpan>();

  constructor(private readonly roads: Pick<Roads, 'roads' | 'nearest'>, village: readonly [number, number],
    churchOrigin: readonly [number, number] = CHURCH_ORIGIN) {
    this.church = { x: churchOrigin[0] - village[0], z: village[1] - churchOrigin[1] };

    // 1. River Denys Mountain Road: any non-bridge piece climbing toward the church.
    for (const road of roads.roads) {
      if (road.bridge || road.name !== MOUNTAIN_ROAD_NAME || road.pts.length < 2) continue;
      const first = road.pts[0], last = road.pts[road.pts.length - 1];
      const dFirst = Math.hypot(first[0] - this.church.x, first[1] - this.church.z);
      const dLast = Math.hypot(last[0] - this.church.x, last[1] - this.church.z);
      const towardSign: 1 | -1 = dLast <= dFirst ? 1 : -1;
      this.spans.set(road, { road, startSeg: 0, endSeg: road.pts.length - 2, towardSign });
    }

    // 2. River Denys Road rough mountain climb toward the church (between first rough stretch and last).
    const judiqueRough = ROUGH_STRETCHES.filter(s => s.area === 'judique' && s.road === CHURCH_ROAD_NAME);
    if (judiqueRough.length) {
      const fromE = judiqueRough[0].from, toE = judiqueRough[judiqueRough.length - 1].to;
      const fromW: [number, number] = [fromE[0] - village[0], village[1] - fromE[1]];
      const toW: [number, number] = [toE[0] - village[0], village[1] - toE[1]];
      const pieces = roads.roads.filter(r => !r.bridge && r.name === CHURCH_ROAD_NAME && (r.kind === 3 || r.kind === 4) && r.pts.length >= 2);
      const startPiece = pieces.find(r => r.pts.some(p => nearPt(p, fromW)));
      if (startPiece) {
        const used = new Set<Road>();
        let piece: Road | undefined = startPiece;
        let firstHit = startPiece.pts.findIndex(p => nearPt(p, fromW));
        while (piece && !used.has(piece)) {
          used.add(piece);
          const cum = cumulative(piece.pts);
          let startSeg = 0;
          if (piece === startPiece && firstHit >= 0) {
            const leadDist = Math.max(0, cum[firstHit] - MOUNTAIN_HINT_LEAD_M);
            let idx = firstHit;
            while (idx > 0 && cum[idx] > leadDist) idx--;
            startSeg = Math.min(idx, piece.pts.length - 2);
          }
          const endHit = piece.pts.findIndex(p => nearPt(p, toW));
          const endSeg = endHit >= 0 ? Math.max(0, Math.min(endHit - 1, piece.pts.length - 2)) : piece.pts.length - 2;
          if (startSeg <= endSeg) {
            this.spans.set(piece, { road: piece, startSeg, endSeg, towardSign: 1 });
          }
          if (endHit >= 0) break;
          const tail: [number, number] = piece.pts[piece.pts.length - 1];
          piece = pieces.find(r => !used.has(r) && nearPt(r.pts[0], tail));
          firstHit = -1;
        }
      }
    }
  }

  get size(): number { return this.spans.size; }

  /** True when the vehicle is still outside the church arrival clearance (220 m). */
  outsideChurchClearance(vehicle: { x: number; z: number }): boolean {
    return Math.hypot(vehicle.x - this.church.x, vehicle.z - this.church.z) >= MOUNTAIN_HINT_CHURCH_CLEAR;
  }

  /** True when the vehicle is driving on a mountain-road approach toward the church. */
  isDrivingTowardChurch(vehicle: { x: number; z: number; heading: number; speed: number }): boolean {
    if (!this.spans.size) return false;
    if (vehicle.speed < MOUNTAIN_HINT_MIN_SPEED) return false;
    if (!this.outsideChurchClearance(vehicle)) return false;
    const hit = this.roads.nearest(vehicle.x, vehicle.z, 20);
    if (!hit) return false;
    const span = this.spans.get(hit.road);
    if (!span || hit.dist > hit.road.halfWidth + 4) return false;
    if (hit.seg < span.startSeg || hit.seg > span.endSeg) return false;
    const towardHeading = span.towardSign > 0 ? hit.heading : hit.heading + Math.PI;
    return Math.cos(vehicle.heading - towardHeading) >= MOUNTAIN_HINT_HEADING_COS;
  }
}

export interface MountainHintProbe {
  active: boolean;
  rideKind: string;
  onApproach: boolean;
  airborne: boolean;
  sunk: boolean;
  /** False when the vehicle is inside the church clearance; auto-dismisses an already-visible hint. */
  outsideChurch?: boolean;
}

/** One-time-per-visit state machine for the mountain road side-by-side hint. */
export class MountainHintState {
  shown = false;
  visible = false;
  remaining = 0;
  switched = false;

  update(dt: number, probe: MountainHintProbe): boolean {
    if (!isMountainHintEligibleRide(probe.rideKind)) {
      this.visible = false;
      this.remaining = 0;
      return false;
    }
    if (this.visible && probe.outsideChurch === false) {
      this.visible = false;
      this.remaining = 0;
      return false;
    }
    if (!probe.active) return this.visible;
    if (this.visible) {
      this.remaining = Math.max(0, this.remaining - Math.max(0, dt));
      if (this.remaining <= 0) this.visible = false;
      return this.visible;
    }
    if (!this.shown && probe.onApproach && probe.outsideChurch !== false && !probe.airborne && !probe.sunk) {
      this.shown = true;
      this.visible = true;
      this.remaining = MOUNTAIN_HINT_DURATION;
    }
    return this.visible;
  }

  dismiss(): void {
    this.visible = false;
    this.remaining = 0;
  }

  completeSwitch(): void {
    this.shown = true;
    this.visible = false;
    this.remaining = 0;
    this.switched = true;
  }
}

export interface SwappableRide {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  vy: number;
  speed: number;
  airborne: boolean;
  sunk: number;
  place(x: number, z: number, heading: number): boolean;
}

export interface SwapPose { x: number; z: number; heading: number }

export type SwapResult<T extends SwappableRide> =
  | { ok: true; vehicle: T; pose: SwapPose }
  | { ok: false; reason: string };

/**
 * Safe in-place ride swap: refuse if airborne, in water, or on unloaded/unsafe ground;
 * stop the current ride first, build the target ride, and place it at the exact same
 * position and heading with zero speed. On any failure (including a thrown builder error),
 * restores the current ride's motion and returns a plain failure reason.
 */
export function safeSwapRide<T extends SwappableRide>(
  current: SwappableRide,
  buildTarget: () => T | null,
  canPlace?: (pose: SwapPose) => boolean | string,
): SwapResult<T> {
  if (current.airborne || current.sunk > 0) return { ok: false, reason: 'Stop on solid ground to switch' };
  if (![current.x, current.z, current.heading].every(Number.isFinite)) return { ok: false, reason: 'Could not switch right now' };
  const pose: SwapPose = { x: current.x, z: current.z, heading: current.heading };
  if (canPlace) {
    let check: boolean | string = false;
    try { check = canPlace(pose); } catch { check = false; }
    if (check !== true) {
      return { ok: false, reason: typeof check === 'string' && check ? check : 'Wait until solid ground is ready to switch' };
    }
  }
  const saved = { vx: current.vx, vz: current.vz, vy: current.vy, speed: current.speed };
  const restore = () => {
    current.vx = saved.vx;
    current.vz = saved.vz;
    current.vy = saved.vy;
    current.speed = saved.speed;
  };
  current.vx = 0;
  current.vz = 0;
  current.vy = 0;
  current.speed = 0;
  try {
    const next = buildTarget();
    if (!next) { restore(); return { ok: false, reason: 'Could not switch right now' }; }
    if (!next.place(pose.x, pose.z, pose.heading)) { restore(); return { ok: false, reason: 'No clear room to switch here' }; }
    if (canPlace && Math.hypot(next.x - pose.x, next.z - pose.z) > 1e-4) {
      let placedCheck: boolean | string = false;
      try { placedCheck = canPlace({ x: next.x, z: next.z, heading: next.heading }); } catch { placedCheck = false; }
      if (placedCheck !== true) {
        restore();
        return { ok: false, reason: typeof placedCheck === 'string' && placedCheck ? placedCheck : 'No clear room to switch here' };
      }
    }
    next.vx = 0;
    next.vz = 0;
    next.vy = 0;
    next.speed = 0;
    return { ok: true, vehicle: next, pose };
  } catch {
    restore();
    return { ok: false, reason: 'Could not switch right now' };
  }
}
