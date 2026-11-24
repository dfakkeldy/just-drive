/** Unpaused real seconds: warning, canal transit, clearance, then an open road. */
export const CANAL_CYCLE = 100;
export const CANAL_WARNING = 12;
/** The deck swings open from here while a vessel passes. */
export const CANAL_TRANSIT = 20;
/** Seconds spent swinging the bridge open at transit start and closed at transit end. */
export const CANAL_SWING_SECONDS = 6;
/** Traffic stops for the barrier from here, 3 s before it drops, so a car never runs through a falling arm. */
export const CANAL_STOPPING = CANAL_WARNING - 3;
export interface CanalState { closed: boolean; stopping: boolean; passing: boolean; progress: number; queue: number; vessel: number }
/** Pass `out` on per-frame and per-step paths: the state is written into it, with no allocation. */
export function canalState(seconds: number, out: CanalState = { closed: false, stopping: false, passing: false, progress: 0, queue: 0, vessel: 0 }): CanalState {
  const t = ((seconds % CANAL_CYCLE) + CANAL_CYCLE) % CANAL_CYCLE;
  out.closed = t >= CANAL_WARNING && t < 64;
  out.stopping = t >= CANAL_STOPPING && t < 64;
  out.passing = t >= CANAL_TRANSIT && t < 56;
  out.progress = Math.max(0, Math.min(1, (t - 20) / 36));
  out.queue = t < 12 || t >= 72 ? 0 : Math.min(3, Math.floor((t - 12) / 3) + 1);
  out.vessel = Math.floor(seconds / CANAL_CYCLE) % 4;
  return out;
}

/** Smooth swing bridge opening fraction in [0, 1]: 0 locked closed, 1 fully open parallel to the canal. */
export function canalSwing(seconds: number): number {
  const t = ((seconds % CANAL_CYCLE) + CANAL_CYCLE) % CANAL_CYCLE;
  if (t <= CANAL_TRANSIT || t >= 56) return 0;
  if (t < CANAL_TRANSIT + CANAL_SWING_SECONDS) {
    const u = (t - CANAL_TRANSIT) / CANAL_SWING_SECONDS;
    return u * u * (3 - 2 * u);
  }
  if (t <= 56 - CANAL_SWING_SECONDS) return 1;
  const u = (56 - t) / CANAL_SWING_SECONDS;
  return u * u * (3 - 2 * u);
}

/** A swept stop line. Cars already on the span can leave during the warning. */
export function stopAtGate(before: number, after: number, side: number, gate: number): number {
  const line = side * gate;
  return side * before >= gate - 1e-6 && side * after < gate ? line : after;
}
