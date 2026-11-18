// Which picture this page draws: the old one, or the finish pass (finish.ts) with clouds.
// It is decided once, when the page's modules load, because three things are fixed from the start: the canvas is made
// with or without edge samples, the cloud code is or is not put into the land shaders (finish-shaders.ts), and the trees and wires
// are built for a picture with or without edge samples. So the settings switch loads the page again, as Low detail does.
//
// The default on a desktop at full detail is "the cheap-edge path": the finish with clouds, a canvas without edge
// samples, a world picture with one sample for each pixel, edges smoothed on the finished picture, wires as strips.
// It was measured faster than the old picture: the canvas no longer pays for four samples a pixel.
// A phone, a touch device and low detail keep the old picture.
//
// By default the clouds go only with clear weather (see `fairSky`).
//
// Address flags, for tests:
//   finish=0                    the old picture, exactly (also when the switch is on)
//   finish=1 | 2 | ao | plain   the pass as the flags alone ask for it: no clouds without clouds=1, a canvas with edge
//                               samples without canvasAA=0, four edge samples without finishSamples=0. On any device.
//   clouds=0|1, canvasAA=0|1, finishSamples=0|2|4   change one part of whichever of the two is running.

import { readDetail, SAVE_BLOCKED } from './detail';
import { qualityStore } from './quality-store';

/** 'on' (finish=1), 'small' (finish=2: with the focus blur of a small-world photograph), 'ao' (the contact shade alone)
 * or 'plain' (the control: the chain with every effect at zero). */
export type FinishMode = 'on' | 'small' | 'ao' | 'plain';

export interface FinishChoice {
  /** The detail this choice was made for; main.ts compares it with its own. */
  low: boolean;
  /** null draws the old picture. */
  mode: FinishMode | null;
  /** Clouds in the sky, their shadows, and their picture in water and wet ground. */
  clouds: boolean;
  /** The canvas has edge samples (the old way). Low detail never has them. */
  canvasSamples: boolean;
  /** Edge samples of the pass's world picture; undefined leaves it to the pass (4 at full detail, 0 at low). */
  samples: number | undefined;
  /** The world is drawn with one sample for each pixel: wires are strips, and trees fade by a pattern. */
  oneSample: boolean;
  /** This device gets the finish by default, so it has the settings switch. */
  offered: boolean;
}

const KEY = 'mmm.finish';

/**
 * The clouds are fair-weather clouds with sharp shadows. They are weather, so they go only with the clear mood
 * (weather.ts: `weather=overcast` and `weather=fog` have their own sky), and not into the light study (`date=`,
 * light-study.ts), which shows the game's own sun for a day and must not invent a sky. The rest of the finish stays.
 */
const fairSky = (params: URLSearchParams): boolean => !params.has('date') && params.get('weather') !== 'overcast' && params.get('weather') !== 'fog';

/** The saved switch: false when the player turned the finish off. Nothing saved means on. */
export function savedFinish(): boolean {
  return qualityStore().read(KEY) !== '0';
}

/** `low` and `touch` are the page's detail and device; `saved` is the switch (false = turned off). */
export function finishChoice(params: URLSearchParams, touch: boolean, low: boolean, saved: boolean): FinishChoice {
  const asked = params.get('finish');
  const offered = !touch && !low;
  const flagged: FinishMode | null = asked === '1' ? 'on' : asked === '2' ? 'small' : asked === 'ao' || asked === 'plain' ? asked : null;
  const byDefault = asked === null && offered && saved;
  const mode = byDefault ? 'on' : flagged;
  const flag = (name: string, fallback: boolean) => params.has(name) ? params.get(name) === '1' : fallback;
  const count = Number(params.get('finishSamples'));
  const samples = mode === null ? undefined : params.has('finishSamples') && Number.isInteger(count) && count >= 0 && count <= 4 ? count : byDefault ? 0 : undefined;
  return {
    mode, offered, samples, low,
    clouds: mode !== null && flag('clouds', byDefault && fairSky(params)),
    canvasSamples: !low && (mode === null || flag('canvasAA', !byDefault)),
    oneSample: !low && mode !== null && samples === 0,
  };
}

/** Asked of a spare context, before the game's canvas is made with or without edge samples. */
function brightPictures(): boolean {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return false;
  const can = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return can;
}

const OFF: FinishChoice = { low: false, mode: null, clouds: false, canvasSamples: true, samples: undefined, oneSample: false, offered: false };

/**
 * This page's choice. Only the game page has one (index.html, the canvas with id "c"): the car and truck pages, and a
 * check that loads these modules outside a browser, draw as before.
 * Low detail is `?q=low`, or the saved Low detail switch, or a touch device that did not save Full detail
 * (touch-quality-policy.ts `qualityStart`, which main.ts gets its own `LOW` from; a touch device that it sends back
 * to phone detail after a bad start is not known here, and matters only with the test flags). Everything that
 * depends on the choice (the canvas, the trees through main.ts, the wires, the pass) takes this one value, so the parts agree with
 * each other; main.ts warns if its `LOW` ever differs.
 * A graphics chip that cannot draw into a bright-range picture keeps the old picture: the pass needs one.
 */
export const FINISH: FinishChoice = (() => {
  if (typeof document === 'undefined' || typeof location === 'undefined') return OFF;
  try {
    if (!document.getElementById('c')) return OFF;
    const params = new URLSearchParams(location.search);
    const touch = matchMedia('(pointer: coarse)').matches || params.get('touch') === '1';
    const q = params.get('q'), detail = readDetail();
    const choice = finishChoice(params, touch, q ? q === 'low' : detail === 'low' || touch && detail !== 'high', savedFinish());
    return choice.mode !== null && params.get('finish') === null && !brightPictures() ? OFF : choice;
  } catch { return OFF; }
})();

/**
 * The switch in the settings panel, before `before`: one box for the finish and the clouds together. `on`: what this
 * page draws. A change is saved and the page loads again (`go`; a test gives something else). A typed `finish=` flag
 * wins until the player uses the switch, as `q=` does for Low detail.
 */
export function finishSetting(panel: HTMLElement | null, before: HTMLElement | null, on: boolean,
  go: (search: string) => void = (search) => { if ('?' + search === location.search || !search && !location.search) location.reload(); else location.search = search; }): void {
  if (!panel) return;
  const group = Object.assign(document.createElement('div'), { id: 'finish' });
  group.style.cssText = 'margin-top:12px';
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0';
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: on });
  box.style.width = 'auto';
  label.append(box, 'Clouds and soft light');
  const note = Object.assign(document.createElement('small'), { textContent: 'Clouds with their shadows, soft shade where things meet, and a glow on bright light. The page loads again.' });
  note.style.cssText = 'display:block;margin-top:4px';
  group.append(label, note);
  box.addEventListener('change', () => {
    const want = box.checked;
    // Only "off" is stored: a visit with nothing saved follows the default.
    const saved = qualityStore().intend(KEY, want ? null : '0');
    // Turning it back on needs a saved "off" gone. If that is still there, say so and stay off. (When nothing could
    // be saved at all, the off was only `finish=0` in the address, and dropping that below is enough.)
    if (!saved && want && qualityStore().read(KEY) === '0') { box.checked = false; box.disabled = true; note.textContent = SAVE_BLOCKED; return; }
    const query = new URLSearchParams(location.search);
    for (const key of ['finish', 'clouds', 'canvasAA', 'finishSamples']) query.delete(key);
    if (!saved && !want) query.set('finish', '0');   // a browser that will not save still gets the choice, for this visit
    go(query.toString());
  });
  panel.insertBefore(group, before);
}
