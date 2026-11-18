// The player's date, time and weather mood. A mood changes the numbers of the sun, sky and haze uniforms that the
// game already has (main.ts): no texture, geometry or draw is added, and 'clear' changes nothing at all.
import { halifaxTime, validStudyDate, type StudyPosition } from './light-study';

export const DEFAULT_DATE = '2026-10-10', DEFAULT_HOUR = 16.75;
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/** An Atlantic wall-clock hour on a date, as an instant. Halifax clock changes follow the light study's tested policy.
 * Winter is AST (UTC-4) and summer is ADT (UTC-3). The fraction of a minute is kept: on the default date every hour
 * gives the instant of the old fixed UTC-3 formula exactly, so tool views with `hour=` keep their light. */
export function atlanticMoment(date: string, hour: number): Date {
  const minutes = Math.min(1439, Math.floor(hour * 60));
  const day = Date.parse(`${date}T00:00:00Z`);
  const offset = +halifaxTime(date, clock(minutes)).when - (day + minutes * 60000);
  return new Date(day + offset + hour * 3600e3);
}

export type Mood = 'clear' | 'overcast' | 'fog';
export const MOODS: readonly (readonly [Mood, string])[] = [['clear', 'Clear'], ['overcast', 'Overcast'], ['fog', 'Fog / haze']];
export interface Weather {
  date: string;
  /** The player's HH:mm (`playerTime`), or '' when the tool control `hour` (or nothing) sets the clock. */
  time: string;
  hour: number;
  /** A valid player date or time is in the address: the player set the clock, not a tool. */
  chosen: boolean;
  mood: Mood;
}
/** `playerDate`, `playerTime` and `weather` are player choices. `hour` stays a tool control (visit.ts): it sets the
 * clock only when no valid `playerTime` is given. Every bad value falls back to the game's own light. */
export function weatherSettings(params: URLSearchParams): Weather {
  const askedDate = params.get('playerDate') ?? '', askedTime = params.get('playerTime') ?? '';
  const time = validTime(askedTime) ? askedTime : '';
  const toolHour = parseFloat(params.get('hour') ?? '');
  const hour = time ? +time.slice(0, 2) + +time.slice(3) / 60
    : Number.isFinite(toolHour) && toolHour >= 0 && toolHour < 24 ? toolHour : DEFAULT_HOUR;
  const asked = params.get('weather');
  const date = validStudyDate(askedDate) ? askedDate : DEFAULT_DATE;
  return { date, time, hour, chosen: date === askedDate || !!time, mood: MOODS.find(([mood]) => mood === asked)?.[0] ?? 'clear' };
}
/** The clock shown in the settings: the player's own time, or the tool hour to the nearest minute. */
export const weatherClock = (weather: Weather): string => weather.time || clock(Math.min(1439, Math.round(weather.hour * 60)));
/** The instant the sun is computed for. Without time-zone data the game keeps its old fixed UTC-3 light. */
export function weatherMoment(weather: Weather): Date {
  try { return weather.time ? halifaxTime(weather.date, weather.time).when : atlanticMoment(weather.date, weather.hour); }
  catch { return new Date(Date.UTC(2026, 9, 10, 3) + weather.hour * 3600e3); }
}

/** What a mood does to the existing light numbers. `null` (clear) leaves every value as it was. */
export interface MoodLook {
  /** Direct sun that is left. */
  sun: number;
  /** How far the sky fill moves to the haze colour (a flat, grey light). */
  flat: number;
  /** Haze density of the land and sea shaders. */
  haze: number;
  /** How much the haze takes the colour of a low sun and dims with it (0 to 1). */
  dusk: number;
  /** Sky dome: turbidity, Rayleigh and Mie coefficients, and how tightly the glow hugs the sun (clear is 0.82). */
  turbidity: number; rayleigh: number; mie: number; glow: number;
  /** Share of a night's stars that still show. */
  stars: number;
}
export const CLEAR_HAZE = 0.000032;
/** Only the land, sea and grass shaders take the haze; trees, roads and buildings do not. So the fog mood is a haze
 * a few kilometres deep, not a dense fog: denser, and far trees and houses stand in full colour on whitened ground. */
export function moodLook(mood: Mood): MoodLook | null {
  // A pale, even cloud sheet: the glow is spread over the whole dome, and the land gets little direct sun.
  if (mood === 'overcast') return { sun: 0.22, flat: 0.8, haze: CLEAR_HAZE, dusk: 0, turbidity: 20, rayleigh: 0.4, mie: 0.05, glow: 0.3, stars: 0 };
  // A milky sky whose horizon has the colour of the haze, so far hills fade into it.
  if (mood === 'fog') return { sun: 0.6, flat: 0.5, haze: 0.0003, dusk: 1, turbidity: 10, rayleigh: 2.2, mie: 0.01, glow: 0.82, stars: 0.4 };
  return null;
}

const CSS = `
#weatherSet{border-bottom:1px solid #71897e;padding:0 0 10px;margin:0 0 12px;font:13px/1.4 var(--text);max-width:300px}
#weatherSet summary{cursor:pointer;font-weight:700;min-height:32px;display:list-item}
#weatherSet form{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
#settings #weatherSet label{flex:1 1 120px;min-width:120px;margin:0}
#settings #weatherSet label.wide{flex-basis:100%}
#settings #weatherSet :is(input,select){display:block;box-sizing:border-box;min-width:0;width:100%;max-width:100%;min-height:40px;padding:5px;color:inherit;background:var(--panel-solid);border:1px solid #89afa2;border-radius:4px;font:inherit;color-scheme:dark}
#weatherSet button{flex:1 1 100%;font:700 13px var(--text);min-height:40px;padding:5px 14px;background:#20362e;border:1px solid #89afa2;border-radius:5px;color:inherit;cursor:pointer}
#weatherSet small{display:block;flex-basis:100%;font-size:11px;line-height:1.4}
body.tcOn #weatherSet{max-width:none}
body.tcOn #weatherSet summary{min-height:56px;box-sizing:border-box;padding:16px 0}
body.tcOn #settings #weatherSet :is(input,select){min-height:56px;font-size:16px}
body:not(.tcOn) #settings:has(#weatherSet){box-sizing:border-box;max-height:calc(100% - 84px - var(--map-credit-space,0px) - var(--test-safe-top,env(safe-area-inset-top,0px)) - var(--test-safe-bottom,env(safe-area-inset-bottom,0px)));overflow-y:auto;overscroll-behavior:contain}
`;
/** The address Apply loads: the three player keys, and no tool or light-study clock beside them.
 * With a finite pose (drive around) the player's place goes along as `driveAt`, a player key. */
export function weatherAddress(href: string, date: string, time: string, mood: string, pose?: StudyPosition): URL {
  const url = new URL(href);
  for (const key of ['hour', 'date', 'time']) url.searchParams.delete(key);
  url.searchParams.set('playerDate', date); url.searchParams.set('playerTime', time); url.searchParams.set('weather', mood);
  if (pose && [pose.e, pose.n, pose.heading].every(Number.isFinite)) url.searchParams.set('driveAt', [pose.e, pose.n, pose.heading].join(','));
  return url;
}
/** A closed section in the settings panel, like the light study. The panel owns opening, closing and pointer isolation. */
export function weatherUI(weather: Weather, getPosition?: () => StudyPosition): void {
  const panel = document.getElementById('settings');
  if (!panel) return;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
  const control = document.createElement('details'); control.id = 'weatherSet';
  control.innerHTML = `<summary>Date, time and weather</summary><form><label>Date<input aria-label="Date, Atlantic time" type="date" min="1880-01-01" max="2200-12-31" required></label><label>Time<input aria-label="Time, Atlantic time" type="time" lang="en-GB" step="60" required></label><label class="wide">Weather<select aria-label="Weather"></select></label><button type="submit">Apply</button><small>Atlantic time. The sun follows the date; the land keeps its October look. The page loads again.</small></form>`;
  const form = control.querySelector('form')!, day = control.querySelector<HTMLInputElement>('[type=date]')!;
  const time = control.querySelector<HTMLInputElement>('[type=time]')!, select = control.querySelector('select')!;
  day.value = weather.date; time.value = weatherClock(weather);
  for (const [value, text] of MOODS) select.add(Object.assign(document.createElement('option'), { value, text, selected: value === weather.mood }));
  control.addEventListener('keydown', event => event.stopPropagation());   // typing a date must not drive; key releases still clear held keys
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!validStudyDate(day.value) || !validTime(time.value.slice(0, 5))) return;
    let pose: StudyPosition | undefined;
    try { pose = getPosition?.(); } catch { /* the car is not made yet (still loading): apply without a place */ }
    location.assign(weatherAddress(location.href, day.value, time.value.slice(0, 5), select.value, pose));
  });
  control.open = weather.mood !== 'clear' || weather.date !== DEFAULT_DATE || !!weather.time;
  panel.insertBefore(control, panel.querySelector('label[for="exag"]'));
}
