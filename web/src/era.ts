import type { Area } from './area';
import { HISTORY_AREA_IDS, historyArea } from './eras/history-areas';

/** An era is independent of mode, vehicle and land. Extend this table to support another era or area. */
export interface Era {
  readonly id: 'today' | '1884';
  readonly title: string | null;
  /** Set on the per-area copy from eraInArea; absent on the raw table entries. */
  readonly area?: string;
  readonly areas: readonly string[];
  readonly modern: boolean;
  readonly cartRoads: boolean;
  readonly timberBridges: boolean;
  readonly radio: boolean;
  readonly explore: boolean;
}
export const TODAY: Era = Object.freeze({ id: 'today', title: null, areas: [], modern: true,
  cartRoads: false, timberBridges: false, radio: true, explore: false });
// The raw 1884 entry keeps Mabou's title; eraInArea gives the per-area copy the game uses.
export const ERAS: readonly Era[] = Object.freeze([TODAY, Object.freeze({ id: '1884', title: 'Mabou, 1884', areas: HISTORY_AREA_IDS,
  modern: false, cartRoads: true, timberBridges: true, radio: true, explore: true })]);
const perArea = new Map<string, Era>();
/** The era as one area plays it: the same rules, with that area's title. Today and unknown areas are returned unchanged. */
export function eraInArea(era: Era, area: string): Era {
  const words = era.modern ? null : historyArea(area);
  if (!words || !era.areas.includes(area)) return era;
  const key = era.id + '/' + area;
  let value = perArea.get(key);
  if (!value) { value = Object.freeze({ ...era, title: words.title, area: words.id }); perArea.set(key, value); }
  return value;
}
// readEra runs once for the page and again for each ride-picker check (garage.ts, vehicle-choice.ts):
// one console warning per distinct message, not one per call.
const warned = new Set<string>();
function warnOnce(message: string): void { if (!warned.has(message)) { warned.add(message); console.warn(message); } }
export function readEra(params: URLSearchParams, area?: string, addressEra?: '1884'): Era {
  const value = addressEra ?? params.get('era');
  if (value === null || value === 'today') return TODAY;
  const era = ERAS.find(e => e.id === value);
  if (!era) { warnOnce(`Unknown era "${value}"; loading today.`); return TODAY; }
  area ??= params.get('area') ?? 'mabou';
  if (!era.areas.includes(area)) { warnOnce(`Era ${value} is not available in ${area}; loading today.`); return TODAY; }
  return eraInArea(era, area);
}
/** Preserve the land, sun, coast and start rules; omit modern constructed scenery. */
export function areaInEra(area: Area, era: Era): Area {
  return era.modern ? area : { ...area, mail: false, worksYard: false, colliery: false, animals: false,
    roadScene: false, fishing: false, landmarks: false, home:false, church: false, quarry: false };
}
export const CART_HALF_WIDTH = 2.1;
export const eraRoadKind = (kind: number): number => kind === 5 ? 0 : kind >= 1 && kind <= 3 ? 3 : kind;
export const eraRoadHalf = (kind: number, half: number): number => kind >= 1 && kind <= 3 ? Math.min(half, CART_HALF_WIDTH) : half;
/** Mutate only the tile's private decoded field. Shared baked data is never changed. */
export function eraRoadField(field: Uint8ClampedArray, widthScale: number): void {
  for (let k = 0; k < field.length; k += 4) {
    const raw = field[k + 2], kind = raw & 15;
    if (kind === 5) { field[k] = field[k + 1] = field[k + 2] = field[k + 3] = 0; }
    else if (kind >= 1 && kind <= 3) {
      field[k + 1] = Math.min(field[k + 1], Math.round(CART_HALF_WIDTH / widthScale));
      field[k + 2] = (raw & ~15) | 3;
    }
  }
}
