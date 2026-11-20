import { finitePose, safePlacement, type PlacementBounds } from './placement-pose';
import { sunAngles } from './sun';

export const HALIFAX = 'America/Halifax';
export const HORIZON = -0.83;
const MINUTE = 60000;
const DAY = 86400000;
interface Formats { wall: Intl.DateTimeFormat; time: Intl.DateTimeFormat; zone: Intl.DateTimeFormat }
let cachedFormats: Formats | undefined;
/** No Intl access at import: ordinary play must also boot without time-zone support. */
function formats(): Formats {
  if (!cachedFormats) {
    const wall = new Intl.DateTimeFormat('en-CA', {
      timeZone: HALIFAX, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const time = new Intl.DateTimeFormat('en-CA', { timeZone: HALIFAX, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const zone = new Intl.DateTimeFormat('en-CA', { timeZone: HALIFAX, timeZoneName: 'short' });
    cachedFormats = { wall, time, zone };
  }
  return cachedFormats;
}
const UNAVAILABLE = 'Light study unavailable: Halifax time-zone data could not load. Using the original game light.';

export function validStudyDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || +date.slice(0, 4) < 1880 || +date.slice(0, 4) > 2200) return false;
  const instant = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+instant) && instant.toISOString().slice(0, 10) === date;
}
const validTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
function wallStamp(instant: number): number {
  const parts = formats().wall.formatToParts(instant);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)!.value;
  return +new Date(`${part('year').padStart(4, '0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
}
export interface WallTime { when: Date; adjustment: 'exact' | 'fold' | 'gap' }
/** Intl supplies actual Halifax rules. A fold chooses the earlier instant; a gap moves forward by its size.
 * In modern Halifax, March 01:30 exists, 02:30 becomes 03:30; November 01:30 chooses ADT.
 */
export function halifaxTime(date: string, time: string): WallTime {
  if (!validStudyDate(date) || !validTime(time)) throw new RangeError('Use a real date and HH:mm time');
  const wall = +new Date(`${date}T${time}:00Z`);
  // Read offsets on both sides of the requested day, including either side of a clock change.
  const offsets = new Set([-DAY, 0, DAY].map(delta => wallStamp(wall + delta) - (wall + delta)));
  const candidates = [...offsets].map(offset => wall - offset).sort((a, b) => a - b);
  const exact = candidates.filter(instant => wallStamp(instant) === wall);
  if (exact.length) return { when: new Date(exact[0]), adjustment: exact.length > 1 ? 'fold' : 'exact' };
  const forward = candidates.filter(instant => wallStamp(instant) > wall)
    .sort((a, b) => wallStamp(a) - wallStamp(b))[0];
  if (forward === undefined) throw new RangeError('Halifax time could not be resolved');
  return { when: new Date(forward), adjustment: 'gap' };
}
export const localTime = (when: Date): string => formats().time.format(when);
export const localZone = (when: Date): string => formats().zone.formatToParts(when).find(p => p.type === 'timeZoneName')!.value;
export interface LightStudy { active: boolean; date: string; time: string; when?: Date; adjustment?: WallTime['adjustment']; message?: string }
/** No date (or mail play) retains the original boot moment and settings exactly. */
export function readLightStudy(params: URLSearchParams, driveAround: boolean, note: (text: string) => void = console.info): LightStudy {
  const hour = parseFloat(params.get('hour') ?? '16.75'), minutes = Math.round(hour * 60);
  const hourTime = Number.isFinite(hour) && hour >= 0 && hour < 24 && minutes < 1440
    ? `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` : '';
  const fallback: LightStudy = { active: false, date: '2026-10-10', time: hourTime || '16:45' };
  const fail = (message: string, date = fallback.date): LightStudy => {
    note(message);
    return { ...fallback, date, message, when: new Date(Date.UTC(2026, 9, 10, 3) + (hourTime ? hour : 16.75) * 3600e3) };
  };
  if (!driveAround || !params.has('date')) return fallback;
  const date = params.get('date')!, time = params.get('time') ?? hourTime;
  if (!validStudyDate(date)) return fail('Light study: use a real date from 1880–2200. Using the original game light.');
  if (!validTime(time)) {
    const field = params.has('time') ? 'time' : 'hour';
    return fail(`Light study: invalid ${field}; choose a time from 00:00 to 23:59. The selected date is kept.`, date);
  }
  try {
    const resolved = halifaxTime(date, time);
    return { active: true, date, time: localTime(resolved.when), ...resolved };
  } catch { return fail(UNAVAILABLE); }
}
/** The light never comes from below the ground: at night the sun's light fades out instead (night-rules.ts).
 * Reported solar angles remain astronomical. */
export const studyLightingElevation = (elevation: number, active: boolean): number => active && elevation < 0 ? 0.5 : elevation;

/** Study scale never reads saved preferences. The explicit URL still wins. */
export function studyScale(params: URLSearchParams, active: boolean, saved: () => string | null): number {
  const fallback = active ? 1 : 1.5;
  const asked = parseFloat(params.get('exag') ?? (active ? '1' : saved() ?? '1.5'));
  return Math.max(1, Math.min(3, Number.isFinite(asked) ? asked : fallback));
}
export interface SunEvent { when: Date; az: number; el: number }
export interface Ephemeris { sunrise?: SunEvent; sunset?: SunEvent; highest: SunEvent }
/** Solve the game's own formula at a level horizon; local days can be 23 or 25 hours. Boot/UI only. */
export function ephemeris(date: string, lat: number, lon: number): Ephemeris {
  const start = +halifaxTime(date, '00:00').when;
  const end = +halifaxTime(date, '23:59').when + MINUTE;
  const elevation = (ms: number) => sunAngles(new Date(ms), lat, lon).el;
  const event = (ms: number): SunEvent => ({ when: new Date(ms), ...sunAngles(new Date(ms), lat, lon) });
  let sunrise: SunEvent | undefined, sunset: SunEvent | undefined, peak = start;
  let previous = elevation(start);
  for (let t = start + 10 * MINUTE; t <= end; t = Math.min(t + 10 * MINUTE, end)) {
    const current = elevation(t);
    if (current > elevation(peak)) peak = t;
    if ((previous < HORIZON) !== (current < HORIZON)) {
      let a = t - 10 * MINUTE, b = t;
      for (let i = 0; i < 20; i++) {
        const mid = (a + b) / 2;
        if ((elevation(mid) < HORIZON) === (previous < HORIZON)) a = mid; else b = mid;
      }
      if (current > previous) sunrise = event((a + b) / 2); else sunset = event((a + b) / 2);
    }
    previous = current;
    if (t === end) break;
  }
  let a = Math.max(start, peak - 10 * MINUTE), b = Math.min(end, peak + 10 * MINUTE);
  for (let i = 0; i < 40; i++) {
    const l = a + (b - a) / 3, r = b - (b - a) / 3;
    if (elevation(l) < elevation(r)) a = l; else b = r;
  }
  return { sunrise, sunset, highest: event((a + b) / 2) };
}

const CSS = `
#lightStudy{border-bottom:1px solid #71897e;padding:0 0 10px;margin:0 0 12px;font:13px/1.4 var(--text)}
#lightStudy summary{cursor:pointer;font-weight:700;min-height:32px;display:list-item}
#lightStudy .lightFields{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
#settings #lightStudy label{flex:1;min-width:100px;margin:0}
#settings #lightStudy input{display:block;box-sizing:border-box;min-width:0;width:100%;max-width:100%;min-height:40px;padding:5px;color:inherit;background:var(--panel-solid);border:1px solid #89afa2;border-radius:4px;font:inherit;color-scheme:dark}
#lightStudy button{font:700 13px var(--text);min-height:40px;margin:8px 0;padding:5px 14px;background:#20362e;border:1px solid #89afa2;border-radius:5px;color:inherit;cursor:pointer}
#lightStudy p{margin:5px 0}#lightStudy small{display:block;font-size:11px;line-height:1.4;margin-top:5px}
#lightStudy [hidden]{display:none}#lightStudy output{display:block}#lightStudy .lightNight{color:#ffddaf}
`;
/** Existing settings owns opening/closing and driving input isolation. Nothing runs per frame. */
export interface StudyPosition { e: number; n: number; heading: number }
/** Player placement is deliberately distinct from the legacy at test control. */
export function readDrivePosition(params: URLSearchParams, origin?: readonly [number, number], bounds: PlacementBounds = null): [number, number, number] | undefined {
  const fields = params.get('driveAt')?.split(',');
  if (!fields || fields.length !== 3 || fields.some(value => !value.trim())) return undefined;
  const values = fields.map(Number);
  if (!finitePose(values[0], values[1], values[2])) return undefined;
  if (origin && !safePlacement(values[0] - origin[0], origin[1] - values[1], values[2] * Math.PI / 180, bounds)) return undefined;
  return values as [number, number, number];
}
/** Keep the player's normal title/credits/radio flow on study and leave links. */
export function studyQuery(params: URLSearchParams, pose?: StudyPosition, leave = false): URLSearchParams {
  const query = new URLSearchParams(params);
  for (const key of ['at', 'road', 'f', 'dir', 'demo', 'cam', 'camground', 'shot', 'title', 'hour']) query.delete(key);
  if (pose && [pose.e, pose.n, pose.heading].every(Number.isFinite)) query.set('driveAt', [pose.e, pose.n, pose.heading].join(','));
  if (leave) { query.delete('date'); query.delete('time'); query.delete('exag'); }
  query.set('mode', 'explore');
  return query;
}
export function lightStudyUI(study: LightStudy, when: Date, lat: number, lon: number, getPosition?: () => StudyPosition): void {
  const panel = document.getElementById('settings');
  if (!panel) return;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
  const control = document.createElement('details'); control.id = 'lightStudy';
  control.innerHTML = `<summary>Light study</summary><div class="lightFields"><label>Date<input aria-label="Light study date" type="date" min="1880-01-01" max="2200-12-31" required></label><label>Time<input aria-label="Light study time" type="time" lang="en-GB" step="60" required><small class="lightClock"></small></label></div><button type="button">Apply</button> <button type="button" class="lightLeave">Leave study</button><output aria-live="polite"></output><small>One land season: October leaves, no snow.</small><small>Sun direction and height fit the date; the land’s look does not.</small><small>Level horizon (−0.83°); hills can hide the sun.</small>`;
  const date = control.querySelector<HTMLInputElement>('[type=date]')!, time = control.querySelector<HTMLInputElement>('[type=time]')!;
  date.value = study.date; time.value = study.time;
  let notice = study.message;
  const output = control.querySelector('output')!;
  const render = () => {
    control.querySelector('.lightClock')!.textContent = validTime(time.value) ? `${time.value} · 24-hour` : 'Use HH:mm';
    if (!validStudyDate(date.value) || !validTime(time.value)) { output.textContent = 'Choose a real date and time.'; return; }
    try {
      const resolved = halifaxTime(date.value, time.value), day = ephemeris(date.value, lat, lon);
      const now = sunAngles(resolved.when, lat, lon);
      const roundedTime = (instant: Date) => localTime(new Date(Math.round(+instant / MINUTE) * MINUTE));
      const riseSet = (event?: SunEvent) => event ? `${roundedTime(event.when)} · ${Math.round(event.az)}°` : 'None on this date';
      output.replaceChildren();
      for (const text of [
        ...(notice ? [notice] : []),
        ...(date.value < '1902-06-15' ? ['Before 15 June 1902 Halifax kept local mean time (GMT−4:14:24).'] : []),
        `${localTime(resolved.when)} ${localZone(resolved.when)} · America/Halifax`,
        `Sunrise ${riseSet(day.sunrise)}`, `Sunset ${riseSet(day.sunset)}`,
        `At this time ${now.el.toFixed(1)}° high · ${Math.round(now.az)}° azimuth`,
        ...(+resolved.when !== +when ? ['Apply to see it.'] : []),
        `Highest ${day.highest.el.toFixed(1)}° at ${roundedTime(day.highest.when)}`,
        ...(resolved.adjustment === 'gap' ? ['Clock change: this time moves forward to ' + localTime(resolved.when) + '.'] : []),
        ...(resolved.adjustment === 'fold' ? ['Clock change: the first occurrence (ADT) is used.'] : []),
        ...(study.adjustment === 'gap' && date.value === study.date && time.value === study.time ? ['Clock change: the missing time moved forward to ' + study.time + '.'] : []),
        ...(now.el < HORIZON ? ['Night look: head lamps, lamp light and stars. No moon.'] : []),
      ]) {
        const p = document.createElement('p'); p.textContent = text;
        if (text.startsWith('Night')) p.className = 'lightNight';
        output.append(p);
      }
    } catch { output.textContent = notice ?? UNAVAILABLE; }
  };
  control.addEventListener('keydown', ev => ev.stopPropagation()); // Key releases still clear the game's held keys.
  const changed = () => { notice = undefined; render(); };
  date.addEventListener('change', changed); time.addEventListener('change', changed);
  control.addEventListener('toggle', () => { if (control.open) render(); });
  control.querySelector('button')!.addEventListener('click', () => {
    if (!date.reportValidity() || !time.reportValidity() || !validStudyDate(date.value) || !validTime(time.value)) return;
    try { halifaxTime(date.value, time.value); } catch { output.textContent = UNAVAILABLE; return; }
    const query = studyQuery(new URLSearchParams(location.search), getPosition?.());
    query.set('date', date.value); query.set('time', time.value);
    location.search = query.toString();
  });
  const leave = control.querySelector<HTMLButtonElement>('.lightLeave')!;
  leave.hidden = !study.active && !study.message;
  leave.addEventListener('click', () => { location.search = studyQuery(new URLSearchParams(location.search), getPosition?.(), true).toString(); });
  control.open = study.active || !!study.message;
  render();
  const weather = panel.querySelector('#weatherSet');
  (weather ?? panel.querySelector('#settingsHeader'))?.after(control);
  if (study.active) {
    // Capture before the game's existing slider listener, which remembers ordinary game preferences.
    panel.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.id !== 'exag') return;
      event.stopImmediatePropagation();
      const query = studyQuery(new URLSearchParams(location.search), getPosition?.());
      query.set('date', study.date); query.set('time', study.time); query.set('exag', target.value);
      location.search = query.toString();
    }, true);
  }
}
