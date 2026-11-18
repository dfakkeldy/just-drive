import { draw } from './shift-rules';
import type { InteriorResult } from './interiors';
export interface MineInput { brake: boolean; lean: number }
export interface Fork { direction: -1 | 1; number: number; oldNumber: number }
export function mineLayout(day: number): Fork[] {
  return Array.from({ length: 3 }, (_, i) => ({ direction: draw(day, i, 301) < .5 ? -1 : 1,
    number: 1 + Math.floor(draw(day, i, 302) * 3), oldNumber: 4 + Math.floor(draw(day, i, 303) * 3) }));
}
export type MinePhase = 'rolling' | 'tipped' | 'deadEnd' | 'winching' | 'signed' | 'returning' | 'finished';
/** Metres, metres/second, and real seconds. Rendering never changes these rules. */
export class MineRun {
  readonly layout: Fork[];
  stage = 0; progress = 0; speed = 0; elapsed = 0; tips = 0;
  phase: MinePhase = 'rolling'; timer = 0; wrong = false;
  result: InteriorResult | null = null;
  private signed = false;
  constructor(day: number) { this.layout = mineLayout(day); }
  get distance(): number { return this.stage * 54 + this.progress; }
  get message(): string {
    if (this.phase === 'tipped') return 'Parcel airborne. Rails remain in place. Eight seconds lost.';
    if (this.phase === 'deadEnd' || this.phase === 'winching') return `Moved. Try No. ${this.layout[this.stage].number}. Signed, the night shift. Winch requested.`;
    if (this.phase === 'signed') return 'Signature received. Reading it is a separate service.';
    if (this.phase === 'returning') return 'Winching to daylight. Return postage included.';
    if (this.stage === 3) return this.progress > 16 ? 'BRAKE. Buffer ahead. Arrive below 5 km/h.' : 'Coal face ahead. Signature required.';
    if (this.progress < 12 && this.stage === 0) return 'Parcel for the night shift. Signature required. The crew has moved.';
    if (this.progress < 32) return 'BRAKE before the bend. Keep below 15 km/h.';
    const f = this.layout[this.stage];
    return `Lean ${f.direction < 0 ? 'LEFT' : 'RIGHT'} for No. ${f.number}. Follow the bright chalk.`;
  }
  leave(): void {
    this.result = { delivered: this.signed, note: this.signed ? 'Night shift signed. Reading the signature is a separate service.' : 'Returned to daylight with the parcel.' };
    this.phase = 'finished';
  }
  private tip(rewind: number): void {
    this.phase = 'tipped'; this.timer = 8; this.progress = rewind; this.speed = 0; this.wrong = false; this.tips++;
  }
  update(dt: number, input: MineInput): void {
    // Small steps keep bend and buffer checks reliable during a slow frame.
    let left = Math.max(0, dt);
    while (left > 1e-8 && !this.result) { const step = Math.min(left, 1 / 60); this.step(step, input); left -= step; }
  }
  private step(dt: number, input: MineInput): void {
    this.elapsed += dt;
    if (this.phase !== 'rolling') {
      this.timer -= dt;
      if (this.timer > 1e-6) return;
      if (this.phase === 'tipped') this.phase = 'rolling';
      else if (this.phase === 'deadEnd') { this.phase = 'winching'; this.timer = 3; }
      else if (this.phase === 'winching') { this.phase = 'rolling'; this.progress = 42; this.speed = 0; this.wrong = false; }
      else if (this.phase === 'signed') { this.phase = 'returning'; this.timer = 4; }
      else if (this.phase === 'returning') this.leave();
      return;
    }
    const previous = this.progress;
    this.speed = Math.max(0, Math.min(9, this.speed + (.78 - .045 * this.speed - (input.brake ? 3.6 : 0)) * dt));
    this.progress += this.speed * dt;
    if (this.stage < 3) {
      if (previous < 28 && this.progress >= 28 && this.speed > 4.2) { this.tip(25); return; }
      if (previous < 48 && this.progress >= 48) this.wrong = input.lean * this.layout[this.stage].direction < .25;
      if (this.progress >= 54) {
        if (this.wrong) { this.progress = 54; this.speed = 0; this.phase = 'deadEnd'; this.timer = 3; }
        else { this.stage++; this.progress = 0; this.wrong = false; }
      }
    } else if (this.progress >= 34) {
      if (this.speed >= 1.4) this.tip(21);
      else { this.progress = 34; this.speed = 0; this.signed = true; this.phase = 'signed'; this.timer = 3; }
    }
  }
}
