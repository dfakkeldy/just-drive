import { fishDay, type Pose, SceneRoad } from './road-scene-rules';

/** hint: metres. The downhill approach is about 6% at the default hill height (1.5). The car, the Heavy pickup
 *  and the side-by-side (the fastest) at washboard top speed there can see the hint, take a second to read it
 *  and still brake under `speed` before `range`: painter-check proves that with the real Vehicle, and
 *  painter-browser measures the grade on the real land. A higher hill-height setting gives less room. */
export const PAINTER = Object.freeze({ along: 38, side: -7.5, radius: 1.9, draw: 250, speed: 8, range: 13, hint: 220 });
/** Same voice and HUD line as the fish scene's SCENE_TEXT; the instruction comes first, because a landscape
 *  phone shows the hint on one clipped line. */
export const PAINTER_TEXT = Object.freeze({
  approach: 'SLOW DOWN past the painter. Road dust sticks to wet paint.',
  dusty: 'Too late. The dust has settled on the wet paint.',
});
/** A separate deterministic third-day slot. Forced fish/absence also excludes the painter.
 *  In 1884 the area has no road scene at all (areaInEra), so the era test is only a guard. */
export function painterDay(day: number, forced: string | null = null, era: string | null = null): boolean {
  return era !== '1884' && forced !== '0' && !fishDay(day, forced) && day % 3 === 1;
}
/** Negative side is the uphill pasture here; the sea-side cow and rails are on positive side. */
export function painterPose(road: SceneRoad, out: Pose): void {
  road.at(PAINTER.along, PAINTER.side, out);
  // Look downhill and seaward, diagonally across the lane: open water is nearest that way (about 200 m),
  // and the road sits in the view, which is the joke of the dust complaint.
  out.heading += 3 * Math.PI / 4;
}
export function painterDust(speed: number, distance: number, roadDistance: number, halfWidth: number, kind: number): boolean {
  return Math.abs(speed) > PAINTER.speed && distance < PAINTER.range && roadDistance <= halfWidth && kind === 3;
}
/** The roadside hint: shown while the player closes on the painter (closing speed in m/s) or drives beside them,
 *  so no complaint (which needs speed inside the dust range) can count before it. A parked player gets nothing:
 *  the mailbox 15 m from the painter keeps its own stop line. */
export function painterHint(distance: number, closing: number, speed: number, dusty: boolean): string {
  if (Math.abs(speed) <= 1) return '';
  if (dusty) return distance < 2 * PAINTER.range ? PAINTER_TEXT.dusty : '';
  return distance < PAINTER.range || distance < PAINTER.hint && closing > 1 ? PAINTER_TEXT.approach : '';
}
