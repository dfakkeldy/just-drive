/**
 * A player's start link: ?start=mabou-harbour-road puts the car near the end of a named road. It is a player key
 * (web/src/visit.ts): the title card, the credits and the radio's wait for the first tap all stay.
 *
 *   start=<road>            about 150 m before the end of the road, pointed at the end
 *   start=<road>:<share>    that share (0 to 1) of the way from the road's near end to its far end
 *
 * <road> is the road's name today, in small letters with hyphens: "Mabou Harbour Road" is mabou-harbour-road.
 * Capital letters, spaces, plus signs and underscores are read the same way, so a link typed by hand still works.
 *
 * The road is its longest public piece: highway, paved or gravel; never a bridge, a track or a rail trail.
 * "The end of the road" is the end that joins no other public road (a driveway or a track there does not count).
 * When that does not decide (a through road, or a road alone) it is the end farther from the village. So the place
 * does not depend on the direction in which the line was surveyed.
 *
 * An unknown road, a share that is not a number from 0 to 1, or a place outside the land gives null: the caller
 * keeps the normal start. Only the first place of a visit changes; a new day of the mail game starts as usual.
 */
export interface StartRoad { name: string | null; kind: number; bridge?: boolean; pts: readonly (readonly [number, number])[] }
/** Metres from the village (x east, z south), the heading the game uses, and the metres left to the end of the road. */
export interface StartPose { x: number; z: number; heading: number; distance: number }

export const START_BACK = 150;   // metres before the end of the road: near enough to see what stands there
export const START_JOIN = 15;    // an end this close to another public road is joined to it
export const START_EDGE = 12;    // the place must be this far inside the land's bounds
export const START_LONGEST = 200;   // characters: no road name comes near this, and a longer value is not read at all

const isPublic = (road: StartRoad) => road.kind >= 1 && road.kind <= 3;
const lengthOf = (pts: StartRoad['pts']) => pts.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

/** "Beaton Road", "beaton+road" and "BEATON_ROAD" all become beaton-road. Accents and apostrophes fall away. */
export function roadSlug(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function nearSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, length2 = dx * dx + dz * dz;
  const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

/**
 * Does another public road pass this end? A bridge is one too, and that is a choice: a road that ends at a bridge
 * goes on across it, so that end is not the end of the road.
 */
function joined(end: readonly [number, number], piece: StartRoad, roads: readonly StartRoad[]): boolean {
  for (const road of roads) {
    if (road === piece || !isPublic(road)) continue;
    for (let i = 1; i < road.pts.length; i++) {
      if (nearSegment(end[0], end[1], road.pts[i - 1][0], road.pts[i - 1][1], road.pts[i][0], road.pts[i][1]) <= START_JOIN) return true;
    }
  }
  return false;
}

/** A share is digits with at most one point, and a digit at its end: 0.88, .5, 1. No sign and no exponent. */
function shareOf(text: string): number | null {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 46 && (c < 48 || c > 57)) return null;
  }
  const share = !text || text.endsWith('.') ? NaN : Number(text);   // two points give NaN too
  return Number.isNaN(share) ? null : share;
}

export function startKey(value: string | null | undefined, roads: readonly StartRoad[], bounds?: readonly number[] | null): StartPose | null {
  // The value comes from the address bar, so anyone can write it. A long one is refused before any reading.
  if (!value || value.length > START_LONGEST) return null;
  // The share stands after the last colon. A tail that is no share belongs to the name.
  const text = value.trim(), cut = text.lastIndexOf(':');
  const share = cut < 0 ? null : shareOf(text.slice(cut + 1));
  const slug = roadSlug(share === null ? text : text.slice(0, cut));
  if (!slug || (share !== null && !(share >= 0 && share <= 1))) return null;
  let piece: StartRoad | null = null, total = 0;
  for (const road of roads) {
    if (!road.name || !isPublic(road) || road.bridge || road.pts.length < 2 || roadSlug(road.name) !== slug) continue;
    const length = lengthOf(road.pts);
    if (length > total) { piece = road; total = length; }
  }
  if (!piece) return null;
  const first = piece.pts[0], last = piece.pts[piece.pts.length - 1];
  const firstJoined = joined(first, piece, roads), lastJoined = joined(last, piece, roads);
  const endIsLast = firstJoined !== lastJoined ? firstJoined : Math.hypot(last[0], last[1]) >= Math.hypot(first[0], first[1]);
  const line = endIsLast ? piece.pts : [...piece.pts].reverse();   // from the near end to the end of the road
  const along = share === null ? total - Math.min(START_BACK, total / 2) : share * total;
  let walked = 0, pose: StartPose | null = null;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1], [bx, bz] = line[i], step = Math.hypot(bx - ax, bz - az);
    if (!step) continue;
    const t = Math.max(0, Math.min(1, (along - walked) / step));
    pose = { x: ax + t * (bx - ax), z: az + t * (bz - az), heading: Math.atan2(bx - ax, -(bz - az)), distance: total - along };
    if (walked + step >= along) break;
    walked += step;
  }
  if (!pose) return null;
  if (bounds && !(pose.x > bounds[0] + START_EDGE && pose.z > bounds[1] + START_EDGE && pose.x < bounds[2] - START_EDGE && pose.z < bounds[3] - START_EDGE)) return null;
  return pose;
}
