// How sharp the picture is drawn. This game's cost is mostly the number of pixels: at twice the size in each
// direction (a Retina screen) a frame takes about two and a half times as long. So when the frame rate falls, the
// picture is drawn with fewer pixels and stretched to the screen, and when there is room again it gets its pixels
// back. A player sees a slightly softer picture; a player does not see a slow one.
// The class only does the reckoning (no browser in it), so it can be checked by itself: tools/sharpness-check.mjs.
//
// How it decides. Every judgement that the picture is slow rests on two windows of frames or more (a second and a
// half): two slow windows in a row, or a slow one, a good one and a slow one that are slow together.
//
//   Going down is a measurement. When the rate is under 52, a softer step is tried, and its rate is compared with
//   the rate before. If it is 52 or more, that step is the answer. If it is better but still slow, the two rates give
//   the cost of a frame as "fixed part + part for each pixel", and the governor goes to the sharpest step that should
//   reach the rate (or one more step down, when none should), and compares again. If a step bought nothing (the
//   browser holds the page at 30 a second, or the processor is the limit), pixels are not the cost: the governor
//   goes back to the step before, and from there looks upward for as long as a sharper step is as fast. So the
//   picture rests on the sharpest step that gives the best rate there is. Then it leaves the pixels alone for a
//   while (30 seconds, doubling to two minutes). The first time, it looks once more a few seconds later: one look
//   may have met a busy moment.
//
//   Going up is a try, because a screen that shows 60 pictures a second hides how much room there is. A step that
//   was left because it was too slow is not tried again before its penalty has run, and each further failure
//   doubles the penalty, to half a minute. Only a step that has held for a minute is forgiven. So a step that holds
//   for some seconds and then fails, again and again, is tried once every half minute and no more.
//
//   A long frame now and then (a land tile arriving, a tab that was away) is not a slow picture, and is left out:
//   one in two seconds. Long frames that keep coming are counted. And one slow window alone never starts a look.

/** Pixel ratios the picture may be drawn at, coarsest first. Steps, so the drawing buffer is not remade all the time. */
export const STEPS = [1, 1.15, 1.3, 1.5, 1.75, 2];

const WINDOW = 0.75;        // seconds of frames in one measurement
const SLOW = 52;            // frames a second: under this, look for a softer step
const FULL = 58;            // frames a second: at or over this the picture keeps up with the screen
const GOAL = 54;            // the rate a step should reach by the cost model: a little over SLOW, so that it then holds
const STEADY = 3;           // seconds at full speed before a try upward
const LONG = 10;            // seconds between SLOW and FULL before a try upward (the sharper step may cost nothing)
const TRIAL = 5;            // seconds: within this a step just tried upward goes back at the first slow window
const HELD = 60;            // seconds a step must hold before its penalty, and the wait between looks, is forgiven
const FIRST_PENALTY = 4;    // seconds a step that was left is not tried again; doubles with each failure
const LONGEST_PENALTY = 30; // seconds: so a scene that has become light gets its pixels back within about a minute
const LOOK = 0.82;          // a look goes to the sharpest step with at most this share of the pixels
const FAR_LOOK = 0.6;       // the same when the rate is far too low, so a weak computer is not slow for long
const HELPS = 1.03;         // a softer step must raise the rate by this factor to count as help
const SECOND_LOOK = 4;      // seconds before the second look, after the first bought nothing
const NO_SALE = 30;         // seconds without a look, after looks that did not reach SLOW; doubles
const LONGEST_NO_SALE = 120;
const HITCH_EVERY = 2;      // seconds: one long frame in this time is a hitch and is left out

interface Window { frames: number; time: number }
// A look. `base`: where it began. `from`: the step the present one is compared with (the step before it on the way
// down; the best step so far on the way up). `slow`: the steps measured too slow on the way down. `up`: softer
// bought nothing, and the look now goes upward.
interface Search { base: number; baseRate: number; from: number; fromRate: number; slow: number[]; up: boolean }

export class Sharpness {
  /** The pixel ratio to draw at now. */
  ratio: number;
  private readonly steps: number[];
  private at: number;
  private times: number[] = [];
  private span = 0;
  private clock = 0;                      // seconds of frames seen
  private hold = 0;                       // seconds to skip after a change: a new drawing buffer costs a frame or two
  private last: Window | null = null;     // the window before this one, on the same step
  private before: Window | null = null;   // and the one before that
  private heldFor = 0;                    // seconds at SLOW or better since the picture was last found slow
  private fullFor = 0;                    // seconds at FULL or better, without a break
  private trying = false;                 // the present step was reached by a try upward, less than TRIAL ago
  private readonly penalty: number[];     // for each step: how long it is left alone after its next failure
  private readonly notBefore: number[];   // for each step: the clock time before which it is not tried upward
  private search: Search | null = null;
  private fruitless = 0;                  // looks in a row that did not reach SLOW
  private noSaleUntil = 0;                // the clock time before which no look is made
  private hitches = 2;                    // long frames that may still be left out (one more every HITCH_EVERY)

  /** `most`: the screen's own pixel ratio, or the game's limit if that is lower. */
  constructor(most: number) {
    const top = Number.isFinite(most) && most > 0 ? most : 1;
    this.steps = STEPS.filter((s) => s < top - 0.01);
    this.steps.push(top);
    this.at = this.steps.length - 1;
    this.ratio = top;
    this.penalty = this.steps.map(() => FIRST_PENALTY);
    this.notBefore = this.steps.map(() => 0);
  }

  /**
   * Call once a frame with the real time since the last one, in seconds. `busy`: the land is still loading, or the
   * tab is hidden: such frames say nothing about the picture's cost and are left out.
   * Returns true when `ratio` has changed.
   */
  frame(dt: number, busy = false): boolean {
    if (!(dt > 0) || !Number.isFinite(dt)) return false;
    this.clock += dt;
    if (busy) { this.times.length = 0; this.span = 0; this.last = this.before = null; return false; }
    if (this.hold > 0) { this.hold -= dt; return false; }
    this.times.push(dt); this.span += dt;
    if (this.span < WINDOW) return false;
    const now = this.measure();
    this.times.length = 0; this.span = 0;
    const rate = now.frames / now.time, b = this.last, c = this.before;
    const both = b ? (now.frames + b.frames) / (now.time + b.time) : null;
    this.before = b; this.last = now;

    if (this.search) return both === null ? false : this.measured(both);

    if (rate >= SLOW) {
      this.heldFor += now.time;
      this.fullFor = rate >= FULL ? this.fullFor + now.time : 0;
      if (this.heldFor >= TRIAL) this.trying = false;
      if (this.heldFor >= HELD) { this.penalty[this.at] = FIRST_PENALTY; this.fruitless = 0; this.noSaleUntil = 0; }
      const up = this.at + 1;
      if (up < this.steps.length && this.clock >= this.notBefore[up] && (this.fullFor >= STEADY || this.heldFor >= LONG)) {
        this.go(up);
        this.trying = true;
        return true;
      }
      return false;
    }
    this.fullFor = 0;
    if (this.trying) {
      // A step just tried upward goes straight back: the step below was good a moment ago.
      const tried = this.at;
      this.left(tried);
      return this.go(tried - 1);
    }
    // One slow window is not yet a slow picture. It is one when the window before was slow too. It is also one
    // when that window was good, the one before it was slow, and the three together are slow: frames that come
    // late again and again make every other window slow. (The rate must not be an average over the moment a
    // scene got heavy: it is what the softer step is compared with.)
    let base: number | null = null;
    if (b && b.frames / b.time < SLOW) base = both;
    else if (b && c && c.frames / c.time < SLOW) {
      const three = (now.frames + b.frames + c.frames) / (now.time + b.time + c.time);
      if (three < SLOW) base = three;
    }
    if (base === null) return false;
    this.heldFor = 0;
    if (this.steps.length === 1 || this.clock < this.noSaleUntil) return false;
    if (this.at === 0) {
      // Nothing softer to try. Perhaps a sharper step costs nothing (a page held at 30 pictures a second).
      this.search = { base: 0, baseRate: base, from: 0, fromRate: base, slow: [], up: true };
      this.wait(false);
      return this.go(1);
    }
    this.search = { base: this.at, baseRate: base, from: this.at, fromRate: base, slow: [this.at], up: false };
    return this.go(this.below(this.at, base < SLOW * 0.7 ? FAR_LOOK : LOOK));
  }

  /** In a look: `rate` is what the present step gives. Decides where to go from it. */
  private measured(rate: number): boolean {
    const s = this.search!;
    if (rate >= SLOW) { this.fruitless = 0; return this.end(this.at); }
    if (s.up) {
      // On the way up: a sharper step is kept if it is as fast as the step where the way up began.
      if (rate * HELPS < s.fromRate) return this.end(s.from);
      s.from = this.at;
      return this.climb();
    }
    if (rate < s.fromRate * HELPS) {
      // This step bought nothing: pixels are not the cost here. Back to the step before it, or sharper if that is free.
      this.wait(s.from === s.base);
      s.up = true;
      return this.climb();
    }
    if (this.at === 0) return this.end(0);   // better, still slow, and there is nothing softer
    // Better, but still slow. The cost of a frame as fixed + each x (ratio squared), from the rate where the look
    // began and the rate here; then the sharpest softer step that should reach the goal.
    const q0 = this.steps[s.base] ** 2, q1 = this.steps[this.at] ** 2;
    let each = (1 / s.baseRate - 1 / rate) / (q0 - q1), fixed = 1 / s.baseRate - each * q0;
    if (fixed < 0) { fixed = 0; each = 1 / (rate * q1); }
    let to = -1;
    for (let k = 0; k < this.at; k++) if (fixed + each * this.steps[k] ** 2 <= 1 / GOAL) to = k;
    if (to < 0) to = this.below(this.at, LOOK);   // none should: one more step down, and measure
    s.slow.push(this.at);
    s.from = this.at; s.fromRate = rate;
    return this.go(to);
  }

  /** On the way up: to the next sharper step, unless there is none or it was measured too slow in this look. */
  private climb(): boolean {
    const s = this.search!, next = s.from + 1;
    return next < this.steps.length && !s.slow.includes(next) ? this.go(next) : this.end(s.from);
  }

  /** A look bought nothing: no further look for a while. `first`: it was the first step of a look. */
  private wait(first: boolean): void {
    this.noSaleUntil = this.clock + (first && this.fruitless === 0 ? SECOND_LOOK : Math.min(LONGEST_NO_SALE, NO_SALE * 2 ** Math.max(0, this.fruitless - 1)));
    this.fruitless++;
  }

  /** The look ends with the picture on step `to`. The steps above it that were measured too slow get their penalty. */
  private end(to: number): boolean {
    const s = this.search!;
    this.search = null;
    for (const k of s.slow) if (k > to) this.left(k);
    return this.go(to);
  }

  /** Step `k` was too slow: it is not tried upward again until its penalty has run. */
  private left(k: number): void {
    this.notBefore[k] = this.clock + this.penalty[k];
    this.penalty[k] = Math.min(LONGEST_PENALTY, this.penalty[k] * 2);
  }

  /** The sharpest step with at most `share` of step `k`'s pixels (the softest step, if there is none). */
  private below(k: number, share: number): number {
    let to = 0;
    for (let j = 1; j < k; j++) if (this.steps[j] ** 2 <= share * this.steps[k] ** 2) to = j;
    return to;
  }

  /** Frames and time of the window, without the long frames that the hitch allowance covers. */
  private measure(): Window {
    this.hitches = Math.min(2, this.hitches + this.span / HITCH_EVERY);
    const sorted = this.times.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1];
    let frames = sorted.length, time = this.span;
    while (this.hitches >= 1 && frames > 4 && sorted[frames - 1] > 3 * median) { time -= sorted[frames - 1]; frames--; this.hitches--; }
    return { frames, time };
  }

  private go(to: number): boolean {
    this.trying = false;
    this.heldFor = 0; this.fullFor = 0; this.last = this.before = null;
    if (to === this.at) return false;
    this.at = to; this.ratio = this.steps[to];
    this.hold = 0.25;
    return true;
  }
}
