// Distances in metres from the start beam. Times in simulation seconds.
export const DRAG_DISTANCE = 402;
export const DRAG_TRAP = 20.1168; // 66 ft speed trap ending at the finish
export const DRAG_STAGE = 0.8;
export const DRAG_AMBER = 0.5;
export const DRAG_GREEN = DRAG_STAGE + 3 * DRAG_AMBER;
export const PACE_REACTION = 0.25;
export const PACE_ET = 16.4;

export interface DragResult { reaction: number; elapsed: number; trapKmh: number }
export type DragPhase = 'staged' | 'amber-1' | 'amber-2' | 'amber-3' | 'green' | 'running' | 'red' | 'aborted' | 'finished';

export class DragRun {
  time = 0;
  launch: number | null = null;
  trap: number | null = null;
  fault: 'red' | 'aborted' | null = null;
  result: DragResult | null = null;

  private previous: number;

  constructor(private readonly staged: number) {
    this.previous = staged;
  }

  get phase(): DragPhase {
    if (this.fault) return this.fault;
    if (this.result) return 'finished';
    if (this.launch !== null) return 'running';
    if (this.time >= DRAG_GREEN) return 'green';
    if (this.time >= DRAG_STAGE + 2 * DRAG_AMBER) return 'amber-3';
    if (this.time >= DRAG_STAGE + DRAG_AMBER) return 'amber-2';
    return this.time >= DRAG_STAGE ? 'amber-1' : 'staged';
  }

  get active(): boolean { return this.fault === null && this.result === null; }

  step(dt: number, along: number, inLane: boolean): void {
    if (!this.active) return;
    if (!inLane || along < -20) { this.fault = 'aborted'; return; }
    const before = this.time;
    this.time += dt;
    const crossed = (beam: number) => this.previous < beam && along >= beam
      ? before + dt * (beam - this.previous) / (along - this.previous) : null;
    if (this.launch === null) {
      if (along < this.staged - 0.5) { this.fault = 'aborted'; return; }
      // Give the car room to settle. A larger move toward the beam before green is a foul.
      const foul = crossed(Math.min(0, this.staged + 0.35));
      if (foul !== null && foul < DRAG_GREEN) { this.fault = 'red'; return; }
      this.launch = crossed(0);
    }
    if (this.launch !== null) {
      // Re-entering the speed trap starts a fresh sample, so backing across it cannot inflate the speed.
      const entry = DRAG_DISTANCE - DRAG_TRAP;
      this.trap = along < entry ? null : this.trap ?? crossed(entry);
      const finish = crossed(DRAG_DISTANCE);
      if (finish !== null && this.trap !== null) {
        this.result = { reaction: this.launch - DRAG_GREEN, elapsed: finish - this.launch, trapKmh: 3.6 * DRAG_TRAP / (finish - this.trap) };
      }
    }
    this.previous = along;
  }
}

// Smooth acceleration in the other lane. Reach the finish 16.4 s after launch,
// then slow down over the runway ahead. This car has no collision body.
const PACE_RAMP = 7;
const rise = (t: number) => t + PACE_RAMP * Math.expm1(-t / PACE_RAMP);
const PACE_TOP = DRAG_DISTANCE / rise(PACE_ET);
const PACE_FINISH_SPEED = PACE_TOP * (1 - Math.exp(-PACE_ET / PACE_RAMP));
const PACE_BRAKE_TIME = 7;
export function paceDistance(time: number): number {
  const t = Math.max(0, time - DRAG_GREEN - PACE_REACTION);
  if (t <= PACE_ET) return PACE_TOP * rise(t);
  const braking = Math.min(PACE_BRAKE_TIME, t - PACE_ET);
  return DRAG_DISTANCE + PACE_FINISH_SPEED * braking * (1 - braking / (2 * PACE_BRAKE_TIME));
}

export function recordDragBest(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined, vehicle: string, elapsed?: number): number | null {
  const key = 'mmm.drag.402.' + vehicle;
  let best = null;
  try {
    const stored = Number(storage?.getItem(key));
    if (Number.isFinite(stored) && stored > 0) best = stored;
  } catch { /* blocked storage */ }
  if (elapsed !== undefined && Number.isFinite(elapsed) && elapsed > 0 && (best === null || elapsed < best)) {
    best = elapsed;
    try { storage?.setItem(key, String(elapsed)); } catch { /* show the new time for this visit */ }
  }
  return best;
}
