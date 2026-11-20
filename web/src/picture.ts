// How sharp the picture is drawn: the player's choice, in the settings panel.
// Touch skips measurement. Phone detail uses its own saved choice and defaults to Balanced at ratio 1.35;
// full detail uses the desktop saved choice, or Sharp when none is saved.
// A Retina screen has four pixels where an ordinary screen has one, and this game's cost is mostly the number of
// pixels. So the choice is how many of the screen's pixels are drawn (the browser stretches the picture to the
// screen). The numbers are pixel ratios: 2 is every pixel of a Retina screen, 1 is a quarter of them.
//
// At the first visit nobody has chosen yet. Then the game measures once (FirstChoice below): it draws at Sharp for
// some seconds of play, and steps down only if that is slow and the softer picture is clearly faster. The result is
// saved like a choice by hand, and nothing changes by itself after that. This is not a governor that follows the
// frame rate all the time: one was built and failed its review three times (pull request 11).
import type { WebGLRenderer } from 'three';
import { qualityStore } from './quality-store';

export const PICTURE = { sharp: 2, balanced: 1.5, fast: 1 } as const;
export type Picture = keyof typeof PICTURE;
const ORDER: Picture[] = ['sharp', 'balanced', 'fast'];
const KEY = 'mmm.picture';
const PHONE_KEY = 'mmm.phone.picture';
export const phonePictureRatio = (choice: Picture, screen: number): number =>
  Math.min(screen > 0 ? screen : 1, choice === 'balanced' ? 1.35 : PICTURE[choice]);

// Keep Balanced when Sharp equals it, so the default always has a visible selected button.
export const phonePictureChoices = (screen: number): Picture[] =>
  ORDER.filter((choice) => !ORDER.some(other => other !== choice &&
    phonePictureRatio(choice, screen) === phonePictureRatio(other, screen) &&
    (other === 'balanced' || choice === 'fast' && other === 'sharp')));
const NAMES: Record<Picture, string> = { sharp: 'Sharp', balanced: 'Balanced', fast: 'Fast' };

/** The pixel ratio for a choice on a screen with the given ratio: never more pixels than the screen has. */
export const pictureRatio = (choice: Picture, screen: number): number => Math.min(screen > 0 ? screen : 1, PICTURE[choice]);

/** The choices that give different pictures on this screen, sharpest first (an ordinary screen has one). */
export const pictureChoices = (screen: number): Picture[] =>
  ORDER.filter((choice, k) => k === 0 || pictureRatio(choice, screen) < pictureRatio(ORDER[k - 1], screen));

/**
 * The steps of the one measurement on this screen, sharpest first. A step is worth measuring only if it draws at
 * most four fifths of the pixels of the step before: a smaller cut cannot show a clear gain, and would end the
 * measurement before a far softer choice that does help was tried. (A screen ratio of 1.6: Sharp, then Fast.)
 */
export function pictureLadder(screen: number): Picture[] {
  const ladder: Picture[] = [ORDER[0]];
  for (const choice of ORDER.slice(1)) {
    const last = pictureRatio(ladder[ladder.length - 1], screen);
    if (pictureRatio(choice, screen) ** 2 <= 0.8 * last ** 2) ladder.push(choice);
  }
  return ladder;
}

/** The saved choice, or null when nothing (or nothing sensible) is saved. */
export function savedPicture(key = KEY): Picture | null {
  let saved: string | null = null;
  saved = qualityStore().read(key) ?? null;
  return saved !== null && Object.hasOwn(PICTURE, saved) ? saved as Picture : null;
}

const SETTLE = 1.5;   // seconds of frames left out after each change: a new drawing buffer, shaders, the first tiles
const MEASURE = 4;    // seconds of frames that make one measurement
const ENOUGH = 55;    // frames a second: at or over this, the choice is kept. Over 52 on purpose: the first scene
                      // may be a light one, and the choice has to do for heavier ones too.
const NEAR = 1e-6;     // frame times are added up in floating point: a rate that is 55 or a gain that is a tenth
                      // by the numbers must not miss the line by a rounding error
const GAIN = 1.1;     // a softer choice must be this much faster, or pixels are not what makes the picture slow
                      // (a browser that holds the page at 30 a second, a slow processor): then the sharper one stays.

/**
 * The one measurement at the first visit. No browser in it, so it can be checked by itself (tools/picture-check).
 * It goes down the ladder: measure the sharpest choice; if that is fast enough, done. If not, measure the next one;
 * if that is not clearly faster, go back and be done; if it is fast enough, done; else on to the next.
 * A frame counts only while the game is being played and the land is not loading. Frames are added up, not cut into
 * windows, so loading frames that come every second only make the measurement take longer.
 */
export class FirstChoice {
  /** The answer, once there is one. */
  result: Picture | null = null;
  /** Frames a second measured at the answer (0 when nothing was measured). */
  rate = 0;
  private at = 0;
  private skip = SETTLE;
  private time = 0;
  private frames = 0;
  private rates: number[] = [];
  constructor(private readonly ladder: Picture[]) { if (ladder.length < 2) this.result = ladder[0] ?? 'sharp'; }
  /** The choice to draw with now. */
  get trying(): Picture { return this.result ?? this.ladder[this.at]; }
  /** Call once a frame. `busy`: not playing, loading, or the tab is hidden. Returns true when `trying` changed. */
  frame(dt: number, busy: boolean): boolean {
    if (this.result || busy || !(dt > 0) || !(dt < 1)) return false;   // a frame of a second or more is a stall, not a rate
    if (this.skip > 0) { this.skip -= dt; return false; }
    this.time += dt; this.frames++;
    if (this.time < MEASURE - NEAR) return false;
    const rate = this.frames / this.time;
    this.rates[this.at] = rate;
    const before = this.at > 0 ? this.rates[this.at - 1] : 0;
    if (this.at > 0 && rate < before * GAIN - NEAR) { this.result = this.ladder[this.at - 1]; this.rate = before; return true; }   // bought nothing: the sharper one
    if (rate >= ENOUGH - NEAR || this.at === this.ladder.length - 1) { this.result = this.ladder[this.at]; this.rate = rate; return false; }
    this.at++; this.skip = SETTLE; this.time = 0; this.frames = 0;
    return true;
  }
}

/** What the game's frame loop holds: call `frame` once a frame until `measuring` is false. */
export interface PictureControl { readonly measuring: boolean; frame(dt: number, busy: boolean): void }

/**
 * Sets the renderer to the saved choice, or starts the one measurement when nothing is saved, and adds the control
 * to the settings panel, before `before`.
 * On a screen where every choice gives the same picture (an ordinary screen), there is no control and no measurement.
 * `measured` is told the result of the one measurement and the rate at it (a slow result gets a nudge: detail.ts).
 * The control is three buttons, not a list: the arrow keys drive the car, and a list that has the focus would
 * change with them.
 */
export function pictureSetting(renderer: WebGLRenderer, panel: HTMLElement | null, before: HTMLElement | null,
  measured?: (choice: Picture, framesASecond: number) => void, touch = false, phone = false): PictureControl {
  const key = phone ? PHONE_KEY : KEY;
  const ratio = phone ? phonePictureRatio : pictureRatio;
  const ladder = pictureLadder(devicePixelRatio), choices = phone ? phonePictureChoices(devicePixelRatio) : pictureChoices(devicePixelRatio), saved = savedPicture(key);
  let first = !touch && saved === null && ladder.length > 1 ? new FirstChoice(ladder) : null;
  let choice: Picture = saved ?? (phone ? 'balanced' : ladder[0]);
  const draw = (next: Picture) => { choice = next; renderer.setPixelRatio(ratio(next, devicePixelRatio)); };   // remakes the drawing buffer at the size last set
  const keep = (next: Picture) => { qualityStore().intend(key, next); };
  draw(choice);
  let show = () => {};
  if (panel && choices.length > 1) {
    const group = Object.assign(document.createElement('div'), { id: 'picture' });
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Picture');
    group.style.cssText = 'margin-top:12px';
    const title = Object.assign(document.createElement('div'), { textContent: 'Picture' });
    title.style.marginBottom = '6px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px';
    const buttons = (phone ? choices : ORDER).map((key) => {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: NAMES[key] });
      button.dataset.picture = key;
      button.style.cssText = 'flex:1;min-height:36px;border-radius:6px;border:1px solid #6b7780;color:inherit;font:inherit;cursor:pointer';
      button.addEventListener('click', () => { first = null; draw(key); keep(key); show(); });   // a choice by hand ends the measurement
      return button;
    });
    const note = Object.assign(document.createElement('small'), { textContent: 'Fast draws fewer pixels, for more frames a second.' });
    note.style.cssText = 'display:block;margin-top:4px';
    show = () => {
      for (const b of buttons) { const on = phone ? ratio(b.dataset.picture as Picture, devicePixelRatio) === ratio(choice, devicePixelRatio) : b.dataset.picture === choice; b.setAttribute('aria-pressed', String(on)); b.style.background = 'none'; b.style.borderColor = on ? 'var(--settings-accent,var(--maple))' : '#6b7780'; b.style.borderWidth = on ? '2px' : '1px'; b.textContent = `${on ? '✓ ' : ''}${NAMES[b.dataset.picture as Picture]}`; }
      group.dataset.measuring = String(first !== null);
    };
    row.append(...buttons);
    group.append(title, row, note);
    panel.insertBefore(group, before);
  }
  show();
  return {
    get measuring() { return first !== null; },
    frame(dt, busy) {
      if (!first) return;
      const changed = first.frame(dt, busy);
      if (first.result) {
        const result = first.result, rate = first.rate;
        first = null;
        measured?.(result, rate);
        if (result !== choice) draw(result);
        keep(result); show();
      } else if (changed) { draw(first.trying); show(); }
    },
  };
}
