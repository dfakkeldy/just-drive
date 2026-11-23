/** Pure settings, date, horizon-clip and visibility rules for the driving sky sun paths. */
import type { SunEvent } from './light-study';

export const SUN_PATHS_KEY = 'sunPaths';
export const SUN_PATHS_STORAGE = 'mmm.sunPaths';
export const SUN_PATHS_LABEL = 'Sun paths in the sky';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Default is off. An explicit URL value (1 or 0) wins over localStorage; blocked storage falls back to off. */
export function readSunPaths(params: URLSearchParams, readSaved: () => string | null): boolean {
  const asked = params.get(SUN_PATHS_KEY);
  if (asked === '1') return true;
  if (asked === '0') return false;
  try { return readSaved() === '1'; } catch { return false; }
}

/** The date the game's sun is set to: active light study wins, otherwise the weather/game date. */
export function gameSunPathDate(lightStudy: { active: boolean; date: string }, weather: { date: string }): string {
  return lightStudy.active ? lightStudy.date : weather.date;
}

/** Short plain date label for today's path, without Intl locale dependencies. */
export function shortPathDate(date: string): string {
  const month = Number(date.slice(5, 7)), day = Number(date.slice(8, 10));
  if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${MONTHS[month - 1]} ${day}`;
  return 'Today';
}

/** Label for today's path; names both today and the season when today overlaps a solstice or equinox path. */
export function todayPathLabel(date: string, matchingSeasonName?: string): string {
  const short = shortPathDate(date);
  return matchingSeasonName ? `${short} · ${matchingSeasonName}` : short;
}

/** Angular threshold (degrees) below which today's stroke overlaps a solstice/equinox stroke on screen. */
export const OVERLAP_DEG = 0.25;

/** Find a seasonal path whose elevation matches today's path closely enough for the strokes to overlap
 *  (covers exact dates, adjacent solstice days like Jun 20 / Dec 20 / Dec 22, and the autumn equinox). */
export function overlappingSeason<T extends { arc: readonly Pick<SunEvent, 'el'>[] }>(
  today: readonly Pick<SunEvent, 'el'>[],
  seasons: readonly T[],
): T | undefined {
  const peak = (arc: readonly Pick<SunEvent, 'el'>[]) => arc.reduce((hi, p) => Math.max(hi, p.el), -90);
  const todayPeak = peak(today);
  let best: T | undefined;
  let bestDiff = OVERLAP_DEG;
  for (const season of seasons) {
    const diff = Math.abs(todayPeak - peak(season.arc));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = season;
    }
  }
  return best;
}

/** Clip an arc at the level horizon (el >= 0°) so LOW's non-depth-writing sea never gets a below-horizon stub painted over it. */
export function clipArcAboveHorizon(arc: readonly Pick<SunEvent, 'az' | 'el'>[]): { az: number; el: number }[] {
  const out: { az: number; el: number }[] = [];
  const interp = (a: Pick<SunEvent, 'az' | 'el'>, b: Pick<SunEvent, 'az' | 'el'>) => {
    const t = -a.el / (b.el - a.el);
    const delta = ((b.az - a.az + 540) % 360) - 180;
    return { az: ((a.az + delta * t) % 360 + 360) % 360, el: 0 };
  };
  for (let i = 0; i < arc.length; i++) {
    const cur = arc[i];
    if (i > 0) {
      const prev = arc[i - 1];
      if ((prev.el < 0 && cur.el > 0) || (prev.el > 0 && cur.el < 0)) out.push(interp(prev, cur));
    }
    if (cur.el >= 0) out.push({ az: cur.az, el: cur.el });
  }
  return out;
}

export interface SkySunPathScreenFlags {
  sunSeeker: boolean;
  bigMap: boolean;
  replay: boolean;
  pauseScreen: boolean;
  interiors: boolean;
}

/** Hide driving sun paths when another full view owns the screen (Sun Seeker draws its own). */
export function skySunPathsVisible(flags: SkySunPathScreenFlags): boolean {
  return !flags.sunSeeker && !flags.bigMap && !flags.replay && !flags.pauseScreen && !flags.interiors;
}
