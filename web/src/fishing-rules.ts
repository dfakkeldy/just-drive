/** All distances in metres, speeds in m/s, fixed-step seconds. No browser or renderer. */
export const DECKHAND_RULES = { stop: 1.5, speed: 0.3, radius: 4.2, height: 0.18, maxStep: 0.1 } as const;
export interface FishingSample {
  distance: number; speed: number; sideways: number; y: number; deck: number | null;
  airborne: boolean; eligible: boolean; placement: number; x: number; z: number;
}
export class FishingJudge {
  offered = false;
  stopped = 0;
  private placement = -1;
  private x = 0; private z = 0;
  private observed = false;
  cancel(): void { this.stopped = 0; this.observed = false; }
  reset(): void { this.offered = false; this.cancel(); }
  step(dt: number, s: FishingSample): boolean {
    const continuous = this.observed && s.placement === this.placement && Math.hypot(s.x - this.x, s.z - this.z) <= 0.6 + dt * 55;
    this.observed = true; this.placement = s.placement; this.x = s.x; this.z = s.z;
    if (this.offered || dt <= 0 || dt > DECKHAND_RULES.maxStep || !s.eligible || !continuous || s.airborne || s.deck === null
      || Math.abs(s.y - s.deck) > DECKHAND_RULES.height || s.distance > DECKHAND_RULES.radius
      || Math.abs(s.speed) >= DECKHAND_RULES.speed || Math.abs(s.sideways) >= DECKHAND_RULES.speed) {
      this.stopped = 0; return false;
    }
    this.stopped += dt;
    if (this.stopped + 1e-9 < DECKHAND_RULES.stop) return false;
    this.offered = true; return true;
  }
}
