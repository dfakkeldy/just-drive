import { areaAddress, type Site } from './site';
import type { MultiplayerChoice } from './mp/switch';

export interface MapPoint { e: number; n: number }
export interface RoadStart { x: number; z: number; heading: number; distance: number }
interface StartVehicle {
  x: number; z: number; heading: number;
  placementGuard: ((pose: { x: number; z: number; heading: number }) => boolean) | null;
  restart(x: number, z: number, heading: number): void;
}
const sameStartPose = (a: { x: number; z: number; heading: number }, b: RoadStart) =>
  Math.hypot(a.x - b.x, a.z - b.z) < 1e-6 && Math.abs(Math.sin(a.heading - b.heading)) < 1e-6;
/** Keep a refused trial at the old pose. Guards may reverse along the road, but
 * cannot move this candidate elsewhere. Read both the real guard and final pose;
 * a void/no-op restart must never be mistaken for a successful placement. */
export function placeAtStart(vehicle: StartVehicle, start: RoadStart): boolean {
  const guard = vehicle.placementGuard;
  let accepted = false;
  vehicle.placementGuard = pose => { accepted = (!guard || guard.call(vehicle, pose)) && sameStartPose(pose, start); return accepted; };
  try { vehicle.restart(start.x, start.z, start.heading); }
  finally { vehicle.placementGuard = guard; }
  return accepted && sameStartPose(vehicle, start);
}
type PublicRoad = { kind: number; pts: readonly (readonly [number, number])[] };

/** Pipeline Area.mid boxes (EPSG:2961), derived from origin and mid_tiles.
 * start-here-check compares every box with pipeline/areas.py. Overlap keeps the loaded area.
 */
export const AREA_BOXES: readonly { id: string; box: readonly [number, number, number, number] }[] = [
  { id: 'mabou', box: [616076, 5095140, 632460, 5111524] },
  { id: 'judique', box: [614028, 5070564, 632460, 5086948] },
  { id: 'porthood', box: [607884, 5086948, 620172, 5103332] },
  { id: 'pointtupper', box: [620172, 5045988, 632460, 5058276] },
  { id: 'westbay', box: [628364, 5058276, 654988, 5078756] },
  { id: 'cansocauseway', box: [616076, 5054180, 626316, 5072612] },
];

/** Forward Transverse Mercator, UTM 20N on GRS80 (EPSG:2961).
 * Geolocation's WGS84 is treated as coincident with NAD83(CSRS), as in the game's
 * inverse projection. No network/grid lookup; the projection series is sub-metre here.
 */
export function latLonToUtm20(lat: number, lon: number): MapPoint {
  const a = 6378137, f = 1 / 298.257222101, k = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), e4 = e2 * e2, e6 = e4 * e2;
  const phi = lat * Math.PI / 180, lambda = (lon + 63) * Math.PI / 180;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, C = ep2 * cos * cos, A = cos * lambda;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - 35 * e6 / 3072 * Math.sin(6 * phi));
  return {
    e: 500000 + k * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120),
    n: k * (M + N * tan * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720)),
  };
}

export function pickArea(point: MapPoint, loaded = ''): string | null {
  const holds = ({ box: [w, s, e, n] }: typeof AREA_BOXES[number]) =>
    point.e >= w && point.e <= e && point.n >= s && point.n <= n;
  return (AREA_BOXES.find(a => a.id === loaded && holds(a)) ?? AREA_BOXES.find(holds))?.id ?? null;
}

/** One scan, with no radius limit. Only public highways, paved roads and gravel
 * roads (kinds 1–3); tracks/driveways and rail trails never supply a start.
 * The centreline, rather than the person's lot, supplies both point and heading.
 */
export const START_MARGIN = 2;
/** Parameter interval of a segment inside a box, including segments with both ends outside. */
function clipSegment(ax: number, az: number, dx: number, dz: number, box: readonly number[]): [number, number] | null {
  if (!box.every(Number.isFinite) || box[0] > box[2] || box[1] > box[3]) return null;
  let enter = 0, exit = 1;
  for (const [origin, delta, low, high] of [[ax, dx, box[0], box[2]], [az, dz, box[1], box[3]]]) {
    if (delta === 0) { if (origin < low || origin > high) return null; }
    else { const a = (low - origin) / delta, b = (high - origin) / delta; enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  }
  return enter <= exit ? [enter, exit] : null;
}
export const MAX_START_CANDIDATES = 8;
/** Bounded nearest-first choices, including nearby points on the same segment.
 * All samples remain on a public centreline, outside buildings and inside bounds. */
export function roadStarts(point: MapPoint, village: readonly [number, number], roads: readonly PublicRoad[], buildings: readonly (readonly number[])[] = [], bounds?: readonly number[] | null, limit = MAX_START_CANDIDATES): RoadStart[] {
  const px = point.e - village[0], pz = village[1] - point.n;
  const starts: RoadStart[] = [];
  const retain = (candidate: RoadStart) => {
    if (starts.some(p => sameStartPose(p, candidate))) return;
    const index = starts.findIndex(p => p.distance > candidate.distance);
    if (index < 0) starts.push(candidate); else starts.splice(index, 0, candidate);
    if (starts.length > limit) starts.pop();
  };
  for (const road of roads) {
    if (![1, 2, 3].includes(road.kind)) continue;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i];
      const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
      if (!Number.isFinite(length2) || length2 === 0) continue;
      const playable: [number, number] | null = bounds
        ? clipSegment(ax, az, dx, dz, [bounds[0] + START_MARGIN, bounds[1] + START_MARGIN, bounds[2] - START_MARGIN, bounds[3] - START_MARGIN]) : [0, 1];
      if (!playable) continue;
      const t = Math.max(playable[0], Math.min(playable[1], ((px - ax) * dx + (pz - az) * dz) / length2));
      const x = ax + t * dx, z = az + t * dz, distance = Math.hypot(x - px, z - pz);
      if (!Number.isFinite(distance) || starts.length === limit && distance > starts[starts.length - 1].distance) continue;
      let spans: [number, number][] = [playable];
      // Usually the nearest centreline point is already clear. If a survey line
      // crosses a building envelope, subtract its occupied interval and choose
      // the nearest remaining point on the same public road (not a nearby lot).
      if (buildings.some(([w, s, e, n]) => x >= w && x <= e && z >= s && z <= n)) {
        for (const [w, s, e, n] of buildings) {
          const occupied = clipSegment(ax, az, dx, dz, [w, s, e, n]);
          if (!occupied) continue;
          const [enter, exit] = occupied;
          const margin = .01 / Math.sqrt(length2);
          spans = spans.flatMap(([lo, hi]): [number, number][] => {
            if (exit + margin < lo || enter - margin > hi) return [[lo, hi]];
            const parts: [number, number][] = [];
            if (lo < enter - margin) parts.push([lo, enter - margin]);
            if (hi > exit + margin) parts.push([exit + margin, hi]);
            return parts;
          });
        }
      }
      for (const [lo, hi] of spans) {
        const nearest = Math.max(lo, Math.min(hi, t)), length = Math.sqrt(length2);
        for (const sample of [nearest, lo, hi, nearest - 12 / length, nearest + 12 / length, nearest - 24 / length, nearest + 24 / length]) {
          const safe = Math.max(lo, Math.min(hi, sample));
          const x = ax + safe * dx, z = az + safe * dz, distance = Math.hypot(x - px, z - pz);
          if (buildings.every(([w, s, e, n]) => x < w || x > e || z < s || z > n)) retain({ x, z, heading: Math.atan2(dx, -dz), distance });
        }
      }
    }
  }
  return starts;
}
export function snapToRoad(point: MapPoint, village: readonly [number, number], roads: readonly PublicRoad[], buildings: readonly (readonly number[])[] = [], bounds?: readonly number[] | null): RoadStart | null {
  return roadStarts(point, village, roads, buildings, bounds, 1)[0] ?? null;
}

const USUAL = ' Starting at the usual place.';
export const OUTSIDE = "You are outside the game's land." + USUAL;
type LocationResult = { point: MapPoint } | { message: string };
export function requestPosition(geo: Pick<Geolocation, 'getCurrentPosition'> | undefined): Promise<LocationResult> {
  if (!geo) return Promise.resolve({ message: 'This browser has no location service.' + USUAL });
  return new Promise(resolve => {
    try {
      geo.getCurrentPosition(position => {
        const { latitude, longitude, accuracy } = position.coords;
        if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || accuracy > 2000) {
          resolve({ message: 'Your location is too uncertain.' + USUAL }); return;
        }
        resolve({ point: latLonToUtm20(latitude, longitude) });
      }, error => resolve({ message: (error.code === 1 ? 'Location permission was refused.' : error.code === 3 ? 'Location took too long.' : 'Your location is unavailable.') + USUAL }),
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true });
    } catch { resolve({ message: 'Your location is unavailable.' + USUAL }); }
  });
}

export const START_HERE_KEY = 'mmm.start-here';
type TabStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface PendingStart extends MapPoint { multiplayer: MultiplayerChoice }
/** Delete before parsing or validating, including corrupt, stale or wrong-area data. */
export function takePoint(store: TabStore | undefined, area: string, now = Date.now()): PendingStart | null {
  try {
    const text = store?.getItem(START_HERE_KEY);
    store?.removeItem(START_HERE_KEY);
    if (!text) return null;
    const value = JSON.parse(text);
    if (!value || value.area !== area || !Number.isFinite(value.e) || !Number.isFinite(value.n)
      || !Number.isFinite(value.time) || now < value.time || now - value.time > 300000) return null;
    const choice = value.multiplayer;
    if (!choice || typeof choice.on !== 'boolean' || !(choice.room === null || typeof choice.room === 'string' && /^[a-z]{4}$/.test(choice.room))) return null;
    const point = { e: value.e, n: value.n, multiplayer: { on: choice.on, room: choice.room } };
    return pickArea(point, area) === area ? point : null;
  } catch { return null; }
}

/** The area and chosen room may reach navigation; the point stays tab-local and is consumed once. */
export function carryPoint(store: TabStore | undefined, point: MapPoint, area: string, now = Date.now(), multiplayer: MultiplayerChoice = { on: false, room: null }): boolean {
  try { if (!store) return false; store.setItem(START_HERE_KEY, JSON.stringify({ e: point.e, n: point.n, area, time: now, multiplayer })); return true; }
  catch { return false; }
}

function applyMultiplayerChoice(query: URLSearchParams, multiplayer: MultiplayerChoice): void {
  query.delete('room'); query.delete('mp');
  if (!multiplayer.on) query.set('mp', '0');
  else if (multiplayer.room) query.set('room', multiplayer.room);
}
export function startHereAddress(site: Site, area: string, url: URL, multiplayer: MultiplayerChoice = { on: false, room: null }): string {
  const query = new URLSearchParams(url.search);
  // Placement/demo/test addresses must not win over this explicit start on arrival.
  for (const key of ['at', 'road', 'dir', 'demo', 'shot', 'cam', 'bare']) query.delete(key);
  applyMultiplayerChoice(query, multiplayer);
  query.set('mode', 'explore'); query.set('title', '1');
  return areaAddress(site, area, url.pathname, query);
}

const CSS = `
#startHere{min-width:0;margin-top:10px;overflow-wrap:anywhere;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:10px;text-align:left}
#startHere>:not(#titleStartHere,#startHereHint){flex-basis:100%}
#startHere button{box-sizing:border-box;width:auto;flex:none;text-align:left;min-height:44px;border:0;border-radius:0;background:transparent;color:inherit;font:700 14px system-ui,sans-serif;padding:7px 0;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
#startHere button:focus-visible{outline:3px solid white;outline-offset:2px}
#startHere button:disabled{opacity:.6;cursor:wait}
#startHere small{display:block;flex:1 1 220px;margin-top:0;font:13px/1.4 system-ui,sans-serif;color:var(--ink-dim,#b9c3cc)}
#startHereStatus{position:fixed;z-index:30;top:max(12px,env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);box-sizing:border-box;width:max-content;max-width:calc(100% - 24px);margin:0;padding:8px 12px;border-radius:6px;background:#0c141c;color:#eef2f6;font:13px/1.4 system-ui,sans-serif;pointer-events:none}
#startHereStatus:empty{display:none}
/* Phones. At 390x844 the card reached 847px once the two-line DRONE row came (#219): spacing is tight upright, and in both
   orientations the card scrolls inside itself rather than run off the screen when it still grows. Buttons keep 44px. */
@media(max-width:649px){
 /* Clear the top tile row (62 px plus the phone top gap: 6 px in a tab, 16 px from the home screen). */
 #title.justDrive:has(#startHere){padding:calc(62px + var(--phone-top-gap,6px) + env(safe-area-inset-top,0px)) 10px max(10px,env(safe-area-inset-bottom,0px));align-items:safe center}
 #title.justDrive #titleCard:has(>#startHere){padding:14px 16px 12px;max-width:100%;max-height:calc(100dvh - 62px - var(--phone-top-gap,6px) - env(safe-area-inset-top,0px) - max(10px,env(safe-area-inset-bottom,0px)));height:auto;overflow-y:auto;overscroll-behavior:contain}
 /* No empty foot under the card: a stuck Start rises 26 px instead, so it still clears the More below band. */
 body:has(#phoneTop) #title.justDrive #titleCard:has(>#startHere){padding-bottom:12px!important}
 body:has(#phoneTop) #title.justDrive:has(#startHere) #titleStart{bottom:32px}
 #title.justDrive:has(#startHere) h1{font-size:30px}
 #title.justDrive:has(#startHere) .tag{margin-bottom:6px}
 #title.justDrive:has(#startHere) p:not(.tag){font-size:13px;line-height:1.4;margin-top:5px}
 #title.justDrive:has(#startHere) dl{font-size:12px;line-height:1.35;gap:2px 10px;margin-top:8px}
 #title.justDrive:has(#startHere) dt{font-size:11px}
 #title.justDrive:has(#startHere) #vehicleChoice{margin-top:8px!important;margin-bottom:6px!important}
 #title.justDrive:has(#startHere) .mpControl{margin-top:6px;padding-top:6px}
 #title.justDrive:has(#startHere) .mpControl small{font-size:11px;line-height:1.3;margin:4px 0}
 #title.justDrive:has(#startHere) #startHere{margin-top:6px}
 #title.justDrive:has(#startHere) #titleStart{min-height:44px;margin-top:8px}
 #title.justDrive:has(#startHere) #titleCredits{padding:4px 0}
 /* The 1884 link shares the Start where I am row; the hint follows. Tab order matches what you see. */
 #title.justDrive:has(#startHere) #titleEra{order:1;flex:0 1 auto}
 #title.justDrive:has(#startHere) #startHereHint{order:2;flex-basis:100%}
 #title.justDrive:has(#startHere) #titleOtherGame{order:3;margin-top:4px}
}
`;

interface StartHereOptions {
  mode: string; era: string; area: string; site: Site;
  village: readonly [number, number]; roads: readonly PublicRoad[]; buildings: readonly (readonly number[])[];
  bounds: readonly number[] | null;
  multiplayer?: { readonly choice: MultiplayerChoice; readonly storedChoice: MultiplayerChoice | null; restoreChoice(choice: MultiplayerChoice): void } | null;
  place: (start: RoadStart) => boolean;
}
/** Main's only integration call. No location read until a tap, no point in a URL,
 * request, persistent storage or console. Only the snapped car enters multiplayer.
 */
export function startHere(options: StartHereOptions): void {
  let store: TabStore | undefined;
  try { store = sessionStorage; } catch { /* blocked storage still allows a same-area start */ }
  const pending = takePoint(store, options.area);
  const start = document.querySelector<HTMLButtonElement>('#titleStart');
  if (options.mode !== 'explore' || options.era !== 'today' || new URLSearchParams(location.search).get('era') === '1884' || !start) return;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
  const group = Object.assign(document.createElement('div'), { id: 'startHere' });
  const button = Object.assign(document.createElement('button'), { id: 'titleStartHere', type: 'button', textContent: 'Start where I am' });
  const hint = Object.assign(document.createElement('small'), { id: 'startHereHint', textContent: 'Use your location to start on a nearby public road. Other players see your car if you drive with others.' });
  button.setAttribute('aria-describedby', hint.id);
  group.append(button, hint); start.after(group);
  const eraDoor = document.getElementById('titleEra');
  if (eraDoor) { hint.after(eraDoor); const other = document.getElementById('titleOtherGame'); if (other) eraDoor.after(other); }
  const status = Object.assign(document.createElement('p'), { id: 'startHereStatus' });
  status.setAttribute('role', 'status'); document.body.appendChild(status);
  let generation = 0, messageTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (message: string) => {
    status.textContent = message; clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { status.textContent = ''; }, 10000);
  };
  // Normal start remains usable while permission is open. A late answer cannot move a moving car.
  start.addEventListener('click', () => { generation++; button.disabled = false; if (status.textContent === 'Finding your location…') status.textContent = ''; });
  const resetRequest = () => { generation++; button.disabled = false; clearTimeout(messageTimer); status.textContent = ''; };
  addEventListener('pagehide', () => { generation++; });
  addEventListener('pageshow', event => { if (event.persisted) resetRequest(); });
  const begin = (point: MapPoint) => {
    const candidates = roadStarts(point, options.village, options.roads, options.buildings, options.bounds);
    const snapped = candidates.find(candidate => options.place(candidate) === true);
    if (snapped) { if (snapped.distance > 500) say('The road start is over 500 m away. Starting there.'); else status.textContent = ''; }
    else say((candidates.length ? 'Could not find a road start that fits.' : 'No public road was found.') + USUAL);
    start.click();
  };
  button.addEventListener('click', () => {
    if (button.disabled) return;
    const token = ++generation;
    button.disabled = true;
    say('Finding your location…');
    void requestPosition(navigator.geolocation).then(result => {
      if (token !== generation) return;
      if ('message' in result) { say(result.message); start.click(); return; }
      const area = pickArea(result.point, options.area);
      if (!area) { say(OUTSIDE); start.click(); return; }
      if (area === options.area) { begin(result.point); return; }
      const multiplayer = options.multiplayer?.choice ?? { on: false, room: null };
      if (!carryPoint(store, result.point, area, Date.now(), multiplayer)) { say('This tab cannot carry your location to another area.' + USUAL); start.click(); return; }
      generation++;
      location.assign(startHereAddress(options.site, area, new URL(location.href), multiplayer));
    });
  });
  // Let main finish constructing the game and multiplayer mount its title controls first.
  if (pending) {
    const token = generation;
    queueMicrotask(() => {
      if (token !== generation) return;
      if (options.multiplayer) {
        options.multiplayer.restoreChoice(options.multiplayer.storedChoice ?? pending.multiplayer);
        // Remove stale invitation/override parameters too, so a later reload keeps this choice.
        // Only multiplayer settings enter the URL; the point is never passed to history.
        const url = new URL(location.href);
        applyMultiplayerChoice(url.searchParams, options.multiplayer.choice);
        if (url.href !== location.href) history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      }
      begin(pending);
    });
  }
}
