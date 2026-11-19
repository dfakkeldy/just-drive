import type { Place } from './places';
import type { Building } from './buildings';
import type { Terrain } from './terrain';
import { StuntPark } from './stunt-kit';
import { type StuntFrame, testParkLayout, testParkDressing, testParkRunups, testParkStarts } from './stunt-test-park';

/**
 * The tested stunt layout, moved whole onto the East Top bench of the invented Sugar Camp park (West Bay).
 * One rigid frame keeps every spacing, run-up and arch lead that the works-yard tests measured.
 * Layout v runs due north; u runs due west. The frame's centre is layout (619,197).
 * The bench was chosen by a ground-fit search: no lake or track under any piece, at most 2.5 m of grading per piece.
 */
export const SUGAR_CAMP_STUNTS = { e: 632340, n: 5064420, u: 619, v: 197 } as const;
const AXIS = -Math.PI / 2, SIN = Math.sin(AXIS), COS = Math.cos(AXIS);

export function sugarCampFrame(village: readonly [number, number]): StuntFrame {
  const ox = SUGAR_CAMP_STUNTS.e - village[0], oz = village[1] - SUGAR_CAMP_STUNTS.n;
  return {
    world: (u: number, v: number) => { u -= SUGAR_CAMP_STUNTS.u; v -= SUGAR_CAMP_STUNTS.v; return { x: ox + u * SIN + v * COS, z: oz - u * COS + v * SIN }; },
    heading: (du: number, dv: number) => Math.atan2(du * SIN + dv * COS, du * COS - dv * SIN),
  };
}

/** Builds the park in normal modern West Bay play while the quarry park itself is shown. */
export async function createSugarCampStunts(terrain: Terrain, village: readonly [number, number], low: boolean, buildings: readonly Building[] = []): Promise<StuntPark | null> {
  const frame = sugarCampFrame(village);
  const exclusions = buildings.map(b => ({ x: b.x - village[0], z: village[1] - b.y, radius: 60 + Math.hypot(b.length, b.width) / 2 }));
  const dressing = testParkDressing(frame, 'SUGAR CAMP');
  const park = new StuntPark(terrain, testParkLayout(frame), low, exclusions, dressing, testParkRunups(dressing));
  // A failed survey read leaves the area playable without the park, rather than stopping West Bay from starting.
  try { await park.prepare(); } catch (error) {
    const i = terrain.sites.indexOf(park); if (i >= 0) terrain.sites.splice(i, 1);
    console.warn('Sugar Camp stunt park unavailable', error); return null;
  }
  terrain.addTreeClear(sugarCampClearing(village));
  return park;
}

/** The park operator's clearing: the whole layout and its run-ups, so lines and landings are open ground, as on the works-yard field. */
export function sugarCampClearing(village: readonly [number, number]): [number, number, number, number] {
  const frame = sugarCampFrame(village), c = [frame.world(540, -55), frame.world(700, -55), frame.world(540, 425), frame.world(700, 425)];
  return [Math.min(...c.map(p => p.x)), Math.min(...c.map(p => p.z)), Math.max(...c.map(p => p.x)), Math.max(...c.map(p => p.z))];
}

export function sugarCampStuntPlaces(park: StuntPark, village: readonly [number, number]): Place[] {
  return testParkStarts(park).map(s => {
    const e = village[0] + s.x, n = village[1] - s.z, easy = s.id === 'stunt-easy';
    return {
      id: easy ? 'sugar-camp-stunts-easy' : 'sugar-camp-stunts-hard', name: easy ? 'Stunt park: easy line' : 'Stunt park: hard line',
      area: 'westbay', kind: 'site', e, n, radius: 20, sources: ['src/sugar-camp-stunts.ts'],
      note: easy ? 'Ramps, a tabletop, a tunnel and whoops on the East Top. The park is made up. Start at rest on the easy run-up.'
        : 'Gaps, drops, tanks and a footbridge on the East Top. The park is made up. Start at rest on the hard run-up.',
      start: { e, n, heading: s.heading },
    };
  });
}
