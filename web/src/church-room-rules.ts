import type { InteriorResult } from './interiors';
import { railPoint, type Rail, type RailPoint, type RailStop } from './church-room';

export interface VisitInput { walk: number; look: number }
/** Metres per second: an unhurried walk. Stepping back is slower. */
export const WALK_PACE = 1.5, BACK_PACE = 1.1;
const ACCELERATION = 4, LOOK_RATE = 3.5, LOOK_LIMIT = 1.25;

/**
 * A quiet walk on a rail. No timer and no score: the visitor sets the pace, may step back, and may look to the sides.
 * The walk halts at each stop; letting go and pressing forward again moves on. Rendering never changes these rules.
 */
export class ChurchVisit {
  distance = 0; speed = 0; look = 0; elapsed = 0;
  /** Index of the last stop reached. The visit starts at the first one. */
  reached = 0;
  halted = false;
  letter = false;
  result: InteriorResult | null = null;
  private released = false;
  constructor(readonly rail: Rail, readonly mail: boolean) {}
  get stop(): RailStop { return this.rail.stops[this.reached]; }
  /** The stop whose words are showing: the last one reached, while the visitor is still near it. */
  get reading(): RailStop | null { return Math.abs(this.distance - this.stop.at) < 2.5 ? this.stop : null; }
  get position(): RailPoint { return railPoint(this.rail, this.distance); }
  /** Radians, positive to the right. */
  get lookAngle(): number { return this.look * LOOK_LIMIT; }
  get message(): string {
    const stop = this.reading;
    if (!stop) return '';
    return stop.id === 'vestry' && this.letter ? `${stop.text}\nYou leave one letter on the chest of drawers.` : stop.text;
  }
  leave(): void {
    if (this.result) return;
    this.result = this.letter ? { delivered: true, note: 'One letter left in the vestry.' }
      : { delivered: false, note: this.mail ? 'The letter for the vestry went back out the door.' : 'A quiet visit.' };
  }
  update(dt: number, input: VisitInput): void {
    let left = Math.max(0, dt);
    while (left > 1e-8 && !this.result) { const step = Math.min(left, 1 / 60); this.step(step, input); left -= step; }
  }
  private step(dt: number, input: VisitInput): void {
    this.elapsed += dt;
    const turn = Math.max(-1, Math.min(1, input.look)) - this.look, most = LOOK_RATE * dt;
    this.look += Math.max(-most, Math.min(most, turn));
    const walk = Math.max(-1, Math.min(1, input.walk));
    if (this.halted) {
      if (Math.abs(walk) < .15) this.released = true;
      if (this.released && Math.abs(walk) > .15) this.halted = false;
      else { this.speed = 0; return; }
    }
    const wanted = walk > .15 ? WALK_PACE * walk : walk < -.15 ? BACK_PACE * walk : 0;
    const change = ACCELERATION * dt;
    this.speed += Math.max(-change, Math.min(change, wanted - this.speed));
    const next = this.rail.stops[this.reached + 1];
    let to = this.distance + this.speed * dt;
    if (next && to >= next.at) {
      to = next.at; this.reached++; this.speed = 0; this.halted = true; this.released = false;
      if (next.id === 'vestry' && this.mail) this.letter = true;
      if (this.reached === this.rail.stops.length - 1) { this.distance = to; this.leave(); return; }
    }
    if (to <= 0) { to = 0; this.speed = Math.max(0, this.speed); }
    this.distance = to;
  }
}
