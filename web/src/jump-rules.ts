import { CAR_SPEC, type VehicleSpec } from './vehicle-spec';
import { SLIP_RAMP } from './yard-site';

const r = SLIP_RAMP;
// The lot rises past the ramp, and the "Hill height" setting stretches that rise while the ramp keeps its own.
// The load is short and near enough that a full-throttle run from the marked start clears it at every setting.
export const JUMP_LOAD = {
  near: r.lead + r.length + 2.0,
  length: 4.5,
  width: 5.8,
  height: 0.50,
};
const END = r.lead + r.length;

/** A fixed-step observation in ramp metres. Height is the tyre contact plane, not the roof. */
export interface JumpSample {
  along: number; across: number; y: number; ground: number | null; obstacleTop: number;
  deck: number | null; airborne: boolean; pitch: number; roll: number; speed: number; sideways: number;
  contacts: number; placement: number; eligible: boolean;
}

/** No clock, browser, renderer or car mutation. One judge owns each shift's attempts and offer. */
export class JumpJudge {
  constructor(private readonly spec: VehicleSpec = CAR_SPEC) {}

  state: 'idle' | 'deck' | 'air' | 'settling' | 'clean' = 'idle';
  jumps = 0;
  offered = false;
  private previous: JumpSample | null = null;
  private contacts = 0;
  private seconds = 0;

  cancel(): void { this.state = 'idle'; this.seconds = 0; this.previous = null; }

  reset(): void {
    this.state = 'idle'; this.jumps = 0; this.offered = false; this.previous = null; this.seconds = 0;
  }

  /** Returns true once, when the foreman can interrupt. Declining does not reset `offered`. */
  step(dt: number, s: JumpSample): boolean {
    const REACH = this.spec.halfLength, LANE = r.width / 2 - this.spec.halfWidth;
    const p = this.previous;
    this.previous = s;
    if (dt <= 0) return false;
    const continuous = !p || s.placement === p.placement && Math.hypot(s.along - p.along, s.across - p.across) < 0.6 + dt * 55;
    if (!s.eligible || !continuous) { this.state = 'idle'; this.seconds = 0; return false; }
    if (this.state === 'clean') {
      this.seconds += dt;
      if (!this.offered && (!s.airborne && Math.abs(s.speed) < 0.3 || this.seconds >= 3)) {
        this.offered = true; this.state = 'idle'; return true;
      }
      if (this.offered) this.state = 'idle';
      return false;
    }
    if (this.state === 'idle') {
      if (!s.airborne && s.deck !== null && Math.abs(s.y - s.deck) < 0.16 && s.along > 1 && s.along < END - 3 && Math.abs(s.across) < LANE) this.state = 'deck';
      return false;
    }
    if (this.state === 'deck') {
      if (Math.abs(s.across) > LANE || s.along < 0 || !s.airborne && (s.deck === null || Math.abs(s.y - s.deck) > 0.16)) { this.state = 'idle'; return false; }
      if (s.airborne) {
        if (!p || p.airborne || s.along < END - 1.6 || s.along > END + 0.6 || s.along <= p.along || s.contacts !== p.contacts || s.speed < 4) this.state = 'idle';
        else { this.state = 'air'; this.contacts = s.contacts; }
      }
      return false;
    }
    const far = JUMP_LOAD.near + JUMP_LOAD.length;
    // Reject even a contact with zero closing speed: a push out is not a landing.
    if (s.contacts !== this.contacts || this.state === 'air' && (Math.abs(s.across) > LANE || p && s.along < p.along - 0.05)) {
      this.state = 'idle'; return false;
    }
    if (s.along + REACH >= JUMP_LOAD.near && s.along - REACH <= far && s.y - 0.12 <= s.obstacleTop) {
      this.state = 'idle'; return false;
    }
    const wheels = !s.airborne && s.ground !== null && Math.abs(s.y - s.ground) < 0.16 && Math.abs(s.pitch) < 0.35 && Math.abs(s.roll) < 0.35;
    if (this.state === 'air' && !s.airborne) {
      if (s.along - REACH <= far || !wheels) this.state = 'idle';
      else { this.state = 'settling'; this.seconds = 0; }
    } else if (this.state === 'settling') {
      if (!wheels || s.along - REACH <= far) { this.state = 'idle'; return false; }
      // Two seconds in control, in one piece: a slide starts the count again.
      if (Math.abs(s.sideways) >= 3) { this.seconds = 0; return false; }
      this.seconds += dt;
      if (this.seconds >= 2) { this.jumps++; this.state = 'clean'; this.seconds = 0; }
    }
    return false;
  }
}
