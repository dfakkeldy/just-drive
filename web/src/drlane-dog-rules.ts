import { dogAway } from './lot-props-rules';

/**
 * Where the white dog at the house on D.R.'s Lane goes (drlane-dog.ts), in house metres (drlane-site.ts): u toward the
 * taller end, v toward the lane. It rests at a spot, then walks to the next one along a fixed line of spots on the
 * drive and the lawn, and back again. Each straight walk between two neighbours keeps clear of the house, the deck, the
 * shed, the garden bed, the woodpile and the tree trunks (tools/drlane-dog-check.mjs measures it).
 *
 * The dog is never solid. Like the farm dogs at houses (lot-props.ts) it slips away once a car's body comes within
 * ANIMAL.shy of it, and it is back only when the car is DOG_BACK metres off: then at the spot farthest from the car.
 */
export const DOG_SPOTS: readonly (readonly [number, number])[] = [
  [-7.9, 25.6],   // the mouth of the drive, where it met the car
  [-8.9, 19.0], [-8.4, 11.6], [-4.6, 9.6], [-1.4, 10.6], [2.6, 9.2], [5.4, 11.0], [5.3, 21.8], [10.6, 22.4],
];
/** Walking pace in metres a second, and how long a rest lasts. */
export const DOG_WALK = 1.1, DOG_REST: readonly [number, number] = [3, 9];

export class DrLaneDogRules {
  u: number; v: number;
  /** The way the dog faces, as a direction in house axes. */
  fu = 0; fv = 1;
  moving = false;
  /** Out of sight: a car came right up to it. */
  away = false;
  private at = 0; private next = 0; private step = 1; private rest: number;
  /** Where the car was last seen near, so the dog can come back far from it after the car has gone off. */
  private lastCar: { u: number; v: number } | null = null;

  constructor(private rnd: () => number) {
    [this.u, this.v] = DOG_SPOTS[0];
    this.rest = DOG_REST[0] + rnd() * (DOG_REST[1] - DOG_REST[0]);
  }

  /** `car` is the car's middle in house metres, or null when it is far; `reach` its half length. */
  update(dt: number, car: { u: number; v: number } | null, reach: number): void {
    const gap = car ? Math.hypot(car.u - this.u, car.v - this.v) - reach : Infinity;
    if (car) this.lastCar = { u: car.u, v: car.v };
    const was = this.away;
    this.away = dogAway(this.away, gap);
    if (this.away) { this.moving = false; return; }
    if (was && this.lastCar) this.reappear(this.lastCar);
    if (!this.moving) {
      // At rest the dog watches a car that is near, as a dog in a yard does.
      if (car && gap < 30) { const d = Math.hypot(car.u - this.u, car.v - this.v) || 1; this.fu = (car.u - this.u) / d; this.fv = (car.v - this.v) / d; }
      this.rest -= dt;
      if (this.rest > 0) return;
      if (this.at + this.step < 0 || this.at + this.step >= DOG_SPOTS.length) this.step = -this.step;
      this.next = this.at + this.step;
      this.moving = true;
    }
    const [tu, tv] = DOG_SPOTS[this.next], du = tu - this.u, dv = tv - this.v, d = Math.hypot(du, dv), go = DOG_WALK * dt;
    if (d > 0) { this.fu = du / d; this.fv = dv / d; }
    if (d <= go) {
      this.u = tu; this.v = tv; this.at = this.next; this.moving = false;
      this.rest = DOG_REST[0] + this.rnd() * (DOG_REST[1] - DOG_REST[0]);
    } else { this.u += (du / d) * go; this.v += (dv / d) * go; }
  }

  /** Back in sight, unseen on its way: at rest on the spot farthest from the car. */
  private reappear(car: { u: number; v: number }): void {
    let best = 0, far = -1;
    DOG_SPOTS.forEach(([u, v], i) => { const d = Math.hypot(u - car.u, v - car.v); if (d > far) { far = d; best = i; } });
    [this.u, this.v] = DOG_SPOTS[best];
    this.at = this.next = best; this.moving = false;
    this.rest = DOG_REST[1];
  }
}
