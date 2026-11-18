/** One gate for the entire simulation. UI/rendering and room peers remain live. */
export class PauseGate {
  private requested = false;
  private settings = false;
  private hidden = false;
  private resetDt = false;
  private wasPaused = false;
  private previous: number | undefined;
  time = 0;
  get blocked(): boolean { return this.requested || this.settings || this.hidden; }
  get screen(): boolean { return this.requested && !this.settings; }
  resetClock(): void { this.resetDt = true; }
  toggle(): void { this.requested = !this.blocked; this.settings = false; this.resetDt = true; }
  resume(): void { this.requested = this.settings = false; this.resetDt = true; }
  setSettings(open: boolean): void { this.settings = open; this.resetDt = true; }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.requested = true;
    this.resetDt = true;
  }
  frame(now: number, room: boolean): { paused: boolean; dt: number } {
    const paused = this.blocked && !room;
    const elapsed = this.previous === undefined ? 0 : Math.max(0, (now - this.previous) / 1000);
    this.previous = now;
    const dt = paused || this.wasPaused || this.resetDt ? 0 : elapsed;
    this.wasPaused = paused;
    this.resetDt = false;
    this.time += dt * 1000;
    return { paused, dt };
  }
}
