/**
 * Repairs last one worked shift. Prices include the garage's small-job labour.
 * A landing faster than 4.5 m/s downward costs a shock ($48, then $96).
 * A solid or mailbox hit at 5 m/s costs bumper clips ($22, then $44).
 * A hit at 10 m/s also costs alignment ($55, then $85).
 * A roadside ditch over 0.65 m deep, entered above 3 m/s for 0.35 seconds,
 * costs alignment. Leave the ditch before another entry can worsen it.
 * Washboard above 8 m/s (29 km/h), or other rough ground above 12 m/s
 * (43 km/h): six continuous fast seconds cost a shock; twelve cost a window
 * regulator ($38, then $68). At eighteen/twenty-four seconds they worsen.
 * Slow down or leave rough ground and that timer starts over. Separate hits
 * have a two-second cooldown. Each item appears once and worsens once only.
 * A careful day is $0; a shock and bumper clips cost $70; all first repairs
 * cost $163, above the $135 allowance. There are no complaint rules here.
 */
export const REPAIRS = {
  shock: { name: 'Front shock', prices: [48, 96], hint: 'A front shock is knocking. The garage will hear about it.' },
  window: { name: 'Window regulator', prices: [38, 68], hint: 'The window is stuck down. There goes the quiet.' },
  alignment: { name: 'Wheel alignment', prices: [55, 85], hint: 'Something in the front end. The car pulls left.' },
  bumper: { name: 'Bumper clips', prices: [22, 44], hint: 'A bumper clip let go. Another job for the garage.' },
} as const;
export type RepairId = keyof typeof REPAIRS;
export type DamageCause = 'landing' | 'impact';
export interface Repair { id: RepairId; level: 1 | 2; name: string; price: number }
export class Damage {
  private readonly levels = new Map<RepairId, 1 | 2>();
  private roughTime = 0;
  private roughStage = 0;
  private ditchTime = 0;
  private inDitch = false;
  private cooldown: Record<DamageCause, number> = { landing: 0, impact: 0 };
  hint = '';
  hintTime = 0;
  get items(): Repair[] { return [...this.levels].map(([id, level]) => ({ id, level, name: REPAIRS[id].name, price: REPAIRS[id].prices[level - 1] })); }
  get total(): number { return this.items.reduce((sum, item) => sum + item.price, 0); }
  get windowStuck(): boolean { return this.levels.has('window'); }
  get pulls(): boolean { return this.levels.has('alignment'); }
  reset(): void {
    this.levels.clear(); this.roughTime = this.roughStage = this.ditchTime = 0; this.inDitch = false;
    this.cooldown = { landing: 0, impact: 0 }; this.hint = ''; this.hintTime = 0;
  }
  private add(id: RepairId): void {
    const before = this.levels.get(id) ?? 0;
    if (before === 2) return;
    this.levels.set(id, before === 0 ? 1 : 2);
    // Only a new item speaks. The report records worsening without another readout.
    if (before === 0) { this.hint = REPAIRS[id].hint; this.hintTime = 5; }
  }
  updateHint(dt: number): void { this.hintTime = Math.max(0, this.hintTime - dt); }
  /** Dev/test fixture: comma-separated IDs; repeating one asks for its second level. Unknown IDs are ignored. */
  seed(list: string): void {
    for (const id of list.split(',')) if (Object.hasOwn(REPAIRS, id)) this.add(id as RepairId);
  }
  hit(cause: DamageCause, speed: number): void {
    if (!Number.isFinite(speed) || speed < (cause === 'landing' ? 4.5 : 5) || this.cooldown[cause] > 0) return;
    this.cooldown[cause] = 2;
    if (cause === 'landing') this.add('shock');
    else { this.add('bumper'); if (speed >= 10) this.add('alignment'); }
  }
  /** Called at physics steps; airborne time never counts as rough driving or ditch contact. */
  drive(dt: number, speed: number, surface: string, ditchDepth = 0, airborne = false): void {
    for (const cause of ['landing', 'impact'] as const) this.cooldown[cause] = Math.max(0, this.cooldown[cause] - dt);
    const fast = !airborne && (surface === 'washboard' ? speed > 8 : ['dirt track', 'grass', 'brush'].includes(surface) && speed > 12);
    // Short hops over washboard ridges must not reset the exposure.
    if (fast) this.roughTime += dt;
    else if (!airborne || speed <= (surface === 'washboard' ? 8 : 12)) this.roughTime = this.roughStage = 0;
    while (this.roughStage < 4 && this.roughTime + 1e-8 >= (this.roughStage + 1) * 6) {
      this.add(this.roughStage % 2 === 0 ? 'shock' : 'window'); this.roughStage++;
    }
    if (!airborne && ditchDepth > .65 && speed > 3) {
      this.ditchTime += dt;
      if (!this.inDitch && this.ditchTime + 1e-8 >= .35) { this.add('alignment'); this.inDitch = true; }
    } else {
      this.ditchTime = 0;
      if (!airborne && ditchDepth <= .65) this.inDitch = false;
    }
  }
}
/** A small left offset, at most 0.004 radians. No pull when parked or on phones. */
export function steeringPull(damaged: boolean, speed: number, desktop: boolean): number {
  return damaged && desktop && speed !== 0 ? -.004 * Math.min(1, Math.abs(speed) / 18) : 0;
}
/** Wind masks the radio, without changing the saved volume. */
export function windGain(stuck: boolean, speed: number): number {
  return stuck ? 1 - .65 * Math.min(1, Math.abs(speed) / 25) : 1;
}
