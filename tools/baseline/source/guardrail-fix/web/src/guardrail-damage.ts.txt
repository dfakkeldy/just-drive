import type { Road, Roads } from './roads';
import { railStation } from './guardrail-rules';
export interface RailDamage { road: Road; start: number; end: number; tear: number }
/** How far one cross-section of the beam is knocked out of true. All zero on a straight rail. */
export interface DentShape {
  bend: number;    // metres pushed back, away from the road
  sag: number;     // metres the beam hangs lower
  roll: number;    // radians the face leans back with its post
  crush: number;   // 0 to 1: the crowns pressed flat where the bumper met them
  lip: number;     // metres the top edge is folded (negative: down)
}
/** One hit: a section pushed back over a few metres. Metres, radians. */
export const DENT = { reach: 4.6, bend: .34, pocket: .08, sag: .13, roll: .42, crush: .8 } as const;
/** Surveyed cosmetic damage only. This never affects placement or collision. */
export function surveyedRailDamage(roads: Roads, village?: readonly [number, number]): RailDamage | null {
  if (!village) return null;
  const hit = (e: number, n: number) => roads.nearest(e - village[0], village[1] - n, 30, r => r.kind <= 3 && !r.bridge);
  const a = hit(618976, 5109275), b = hit(618988, 5109240), t = hit(618982, 5109250);
  if (!a || !b || !t || a.road !== b.road || a.road !== t.road) return null;
  const s = railStation(a.road, a.seg, a.t), e = railStation(b.road, b.seg, b.t);
  return { road: a.road, start: Math.min(s,e), end: Math.max(s,e), tear: railStation(t.road,t.seg,t.t) };
}
/** The whole surveyed stretch is not wavy: it has ONE dent, at the surveyed tear point. A car slid into the rail
 *  there: the beam is pushed back to a kink (steel folds, it does not curve), hangs a little, leans with its
 *  post, and its top edge is folded where the bumper met it. Everywhere else, and on every other rail, the
 *  shape is zero. */
export function damageShape(along: number, damage: RailDamage | null): DentShape {
  const s = damage ? along - damage.tear : Infinity;
  if (!damage || along < damage.start || along > damage.end || Math.abs(s) >= DENT.reach) return { bend: 0, sag: 0, roll: 0, crush: 0, lip: 0 };
  const bell = (reach: number) => { const u = s / reach; return Math.abs(u) < 1 ? (1 - u * u) ** 2 : 0; };
  const tent = (reach: number) => Math.max(0, 1 - Math.abs(s) / reach) ** 1.2;
  const fold = bell(1.4);
  return { bend: DENT.bend * tent(DENT.reach) + DENT.pocket * bell(1.1), sag: DENT.sag * bell(3.4), roll: DENT.roll * tent(3.2),
    crush: DENT.crush * fold, lip: -.045 * fold - .025 * bell(3.2) * (.5 + .5 * Math.sin(s * 3.1 + .8)) };
}
