import type { Pose, Point } from './road-scene-rules';

/** One invented stop on the real Birch Street loop. Times are real seconds except the daily clock window. */
export const BUS = Object.freeze({ road: 'Birch Street', stop: 180, speed: 5, dwell: 20, draw: 300,
  half: 4.3, halfWidth: 1.2, lane: 1.35, penalty: 100 });

export class BusRules {
  along = 0;
  wait = 0;
  stops = 0;
  private get nextStop(): number { return BUS.stop + this.stops * this.length; }
  constructor(readonly length: number) {}
  reset(): void { this.along = this.wait = this.stops = 0; }
  active(clockSeconds: number): boolean { return clockSeconds >= 10 * 3600 && clockSeconds < 12 * 3600; }
  get flashing(): boolean { return this.wait > 0; }
  step(dt: number, clockSeconds: number, clear: boolean): void {
    if (dt <= 0 || !this.active(clockSeconds)) return;
    if (this.flashing) { this.wait = Math.max(0, this.wait - dt); return; }
    if (!clear) return;
    const advance = Math.min(BUS.speed * dt, this.nextStop - this.along);
    this.along += advance;
    if (this.along >= this.nextStop) { this.wait = BUS.dwell; this.stops++; }
  }
}

/** Full passes in either direction, once per flash interval. Recovery placements never count. */
export class BusPass {
  private side = 0;
  private charged = false;
  private previous: Point | null = null;
  private placement = -1;
  reset(): void { this.side = 0; this.charged = false; this.previous = null; }
  sample(player: Point, bus: Pose, flashing: boolean, placement: number): boolean {
    if (!flashing) { this.reset(); this.placement = placement; return false; }
    if (placement !== this.placement) { this.reset(); this.placement = placement; }
    const previous = this.previous;
    const jumped = previous !== null && Math.hypot(player.x - previous.x, player.z - previous.z) > 25;
    if (!this.previous) this.previous = { x: player.x, z: player.z };
    else { this.previous.x = player.x; this.previous.z = player.z; }
    if (jumped) { this.side = 0; return false; }
    const dx = player.x - bus.x, dz = player.z - bus.z;
    const along = dx * Math.sin(bus.heading) - dz * Math.cos(bus.heading);
    const across = dx * Math.cos(bus.heading) + dz * Math.sin(bus.heading);
    if (Math.hypot(dx, dz) > 30) { this.side = 0; return false; }
    const side = along < -7 ? -1 : along > 7 ? 1 : 0;
    if (!this.side) { if (Math.abs(across) <= 8) this.side = side; return false; }
    if (!side || side === this.side || this.charged) return false;
    this.charged = true;
    return true; // completed pass
  }
}
