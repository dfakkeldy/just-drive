import { CHURCH_FEATURES, CHURCH_GEOM, CHURCH_SCALE, type ChurchSite } from './church-site';

/**
 * The inside of the River Denys Mountain church, in metres, measured from the owner's phone scan of the inside
 * (21 Nov 2026) and checked against his walk-through video.
 *
 * Frame: the exterior model's own axes, scaled by CHURCH_SCALE. +x points to the tower (the door end), -x to the
 * altar; walking up the aisle, +z is on the left. y = 0 is the floor, which is the sill of the tower door.
 *
 * `shell` is computed from church-site.ts less the measured wall thickness, so the room follows the building outside.
 * `fit` holds what only the inside shows, each number measured from an inner wall or from the floor. A few are
 * adjusted from the scan so the walk keeps its headroom; their comments say so.
 */
const S = CHURCH_SCALE;
/** Measured wall thickness: the scanned inner walls against the outside scan. The long walls are thicker than the ends. */
export const CHURCH_WALLS = { side: 0.17, end: 0.1, tower: 0.12, vestry: 0.15 } as const;
const W = CHURCH_WALLS;
const { nave: n, tower: t, vestry: v } = CHURCH_GEOM;
// The tower door is the first door in CHURCH_FEATURES (church-site.ts keeps it first).
const entry = CHURCH_FEATURES.openings.find(o => o.kind === 'door')!;
const metres = (units: number): number => units * S;
const height = (y: number): number => (y - entry.y0) * S;
const opening = (face: string, kind: string) => CHURCH_FEATURES.openings.find(o => o.face === face && o.kind === kind)!;

export interface RoomWindow { side: -1 | 1; x: number; sill: number; spring: number; width: number }
/** A square window in an end wall: `z` is its middle, `sill` and `top` its heights. */
export interface EndWindow { z: number; sill: number; top: number; width: number }

export const CHURCH_ROOM = {
  shell: {
    nave: {
      x0: metres(n.x0 + W.end), x1: metres(n.x1 - W.end),
      z0: metres(-n.zn + W.side), z1: metres(n.zs - W.side), ridgeZ: metres((n.zs - n.zn) / 2),
    },
    /** Round-headed side windows: `spring` is where the half-round head starts. The galleries pass in front of most. */
    windows: CHURCH_FEATURES.openings.filter(o => o.kind === 'arch' && (o.face === 'nave_n' || o.face === 'nave_s'))
      .map((o): RoomWindow => ({
        side: o.face === 'nave_s' ? 1 : -1, x: metres(o.u),
        sill: height(o.y0), spring: height(o.y1), width: metres(o.w),
      })),
    /** The two small windows high in the west gable, above the rear gallery. */
    gable: CHURCH_FEATURES.openings.filter(o => o.kind === 'rect' && o.face === 'west')
      .map((o): EndWindow => ({ z: metres(o.u), sill: height(o.y0), top: height(o.y1), width: metres(o.w) })),
    porch: {
      x1: metres(t.x1 - W.tower), z0: metres(-t.zn + W.tower), z1: metres(t.zs - W.tower),
      /** Measured from the inside scan (2.59 m); 2.62 m clears the 2.595 m round-headed porch window arch. */
      ceiling: 2.62,
      door: { z: metres(entry.u), width: metres(entry.w), height: height(entry.y1) },
      /** The side door to the ramp (-z wall) and the small round-headed window (+z wall). */
      side: { x: metres(opening('tower_n', 'door').u), width: metres(opening('tower_n', 'door').w), height: height(opening('tower_n', 'door').y1) },
      window: { x: metres(opening('tower_s', 'arch').u), width: metres(opening('tower_s', 'arch').w), sill: height(opening('tower_s', 'arch').y0), spring: height(opening('tower_s', 'arch').y1) },
    },
    /** The vestry: its far wall is measured inside (3.5 m from the shared wall); its sides sit inside the outside walls. */
    vestry: {
      x0: metres(n.x0 - W.end - 3.5), x1: metres(n.x0 - W.end),
      z0: metres(v.z0 + W.vestry), z1: metres(v.z1 - W.vestry),
      /** Where the outside door and the two sash windows are: the same places as outside. */
      door: metres(opening('vestry_s', 'door').u),
      window: metres(opening('vestry_s', 'rect').u),
      windowN: metres(opening('vestry_n', 'rect').u),
      /** Sill and head of both sash windows, and the head of the outside door. */
      sill: height(opening('vestry_s', 'rect').y0), head: height(opening('vestry_s', 'rect').y1), doorHead: height(opening('vestry_s', 'door').y1),
      /** Measured inside: 2.1 m, on the same floor level as the nave. */
      ceiling: 2.1,
    },
  },
  fit: {
    eye: 1.6,
    /** Under the sloped ceiling the visitor stoops: the eye stays this far below it. */
    stoop: 0.55,
    /** A flat panel `flatHalf` each side of the middle, at `flat`; sloped sides down to `wall` where they meet the walls. */
    ceiling: { wall: 4.0, flat: 5.5, flatHalf: 1.85 },
    /** The aisle between the pew ends. */
    aisle: 1.6,
    /** Twelve rows on the -z side. On the +z side the stair takes the first row; the second row runs on under the
     * upper flight. `rear` is from the door wall to the first pew back; pews face the altar. */
    pews: { rows: 12, pitch: 0.7, rear: 0.59, back: 0.88, seat: 0.47, depth: 0.42 },
    /** Heights above the floor. `rear` is the back gallery's depth from the door wall, `side` the side galleries'
     * depth from the long walls, `sideEnd` where they stop, from the altar wall. `front` is the parapet. */
    gallery: { floor: 2.85, under: 2.55, rear: 2.77, side: 2.15, sideEnd: 4.13, front: 0.87, post: 0.22 },
    /**
     * An L-shaped stair in the +z corner by the door. The lower flight climbs along the door wall toward +z to a
     * landing in the corner; the upper flight climbs along the +z wall toward the altar onto the back gallery.
     * `foot` is where the first riser stands, from the middle of the door wall. `well` is where the opening in the
     * gallery floor starts over the lower flight: the scan puts it about 0.8 m further on, where a visitor must duck.
     * `inner` is the landing's inner edge from the +z wall (the scan: 1.05 m; widened 0.15 m for the walk).
     */
    stair: { width: 1.0, foot: 0.55, steps: 9, landing: 1.7, inner: 1.2, upper: 6, tread: 0.18, well: 0.95 },
    /** The iron tie rod across the nave over the back gallery's front: through the two posts that rise to the ceiling, out to the slopes. */
    tieRod: { height: 5.15 },
    /** The chancel floor runs the full width; the altar platform on it is narrower. Depths from the altar wall. */
    chancel: { depth: 2.43, rise: 0.15 },
    platform: { depth: 2.03, width: 2.9, rise: 0.28 },
    /** The long altar stands on the platform with two gradines, a Gothic tabernacle and five scalloped spires behind it;
     * the arched table stands on the chancel floor right in front of the platform step. All sizes measured from the inside scan. */
    altar: {
      width: 2.40, height: 1.08, depth: 0.48, back: 0.62,
      gradines: [
        { rise: 0.12, depth: 0.65, inset: 0.05 },
        { rise: 0.18, depth: 0.46, inset: 0.10 },
      ],
      tabernacle: { width: 0.44, depth: 0.41, height: 0.65, pinnacle: 0.23 },
      table: { width: 1.07, height: 1.08, depth: 0.40, fromWall: 2.03 },
      spires: [1.45, 2.10, 2.75, 2.10, 1.45],
      spireWidths: [0.34, 0.42, 0.48, 0.42, 0.34],
      spacing: 0.49,
    },
    /** The scan reads about 2.0 m from the nave floor; 2.1 m keeps headroom from the chancel step. */
    vestryDoor: { z: 2.0, width: 0.8, height: 2.1 },
    /** Built-in confessional in the +z chancel corner, on the chancel step beside the vestry door.
     * Measured from the inside scan and video: 1.90 m along the +z wall from the altar wall, 1.23 m deep from the +z wall,
     * 2.28 m high above the chancel step (2.43 m above the floor), topped by a white cross. Two white four-panel doors face -z
     * (toward the altar and vestry doorway), both hinged at the centre mullion and opening outward. */
    confessional: { length: 1.90, depth: 1.23, height: 2.28, doors: 2, doorWidth: 0.76, doorHeight: 2.02, crossHeight: 0.36 },
    /** Eleven hanging Stations of the Cross at their scan-measured places (side wall dx from inner altar wall; west wall z offset). */
    stations: {
      width: 0.52, height: 0.42, bottom: 1.98,
      sidePos: [[4.02, 0], [6.55, 1], [7.50, 2], [9.55, 3]] as readonly (readonly [number, number])[],
      west: [[1.08, 4], [-2.25, 5]] as readonly (readonly [number, number])[],
      sideNeg: [[10.60, 6], [9.50, 7], [7.45, 8], [6.50, 9], [3.92, 10]] as readonly (readonly [number, number])[],
    },
  },
} as const;

export type ChurchRoom = typeof CHURCH_ROOM;

/** Height of the boarded ceiling at a distance across the nave. */
export function ceilingAt(room: ChurchRoom, z: number): number {
  const { nave } = room.shell, { wall, flat, flatHalf } = room.fit.ceiling;
  const off = Math.abs(z - nave.ridgeZ), half = z < nave.ridgeZ ? nave.ridgeZ - nave.z0 : nave.z1 - nave.ridgeZ;
  if (off <= flatHalf) return flat;
  return flat - (flat - wall) * Math.min(1, (off - flatHalf) / (half - flatHalf));
}

/** Eye height above the path at a point: standing, or stooped under the nave's sloped ceiling. Only the nave ceiling counts. */
export function eyeAt(room: ChurchRoom, p: { y: number; z: number }): number {
  return Math.min(room.fit.eye, ceilingAt(room, p.z) - p.y - room.fit.stoop);
}

/** The stair in room coordinates: the lower flight along the door wall, the landing, and the upper flight. */
export function churchStair(room: ChurchRoom = CHURCH_ROOM) {
  const { nave } = room.shell, s = room.fit.stair, g = room.fit.gallery;
  const riser = s.landing / s.steps, upperRiser = (g.floor - s.landing) / s.upper;
  const landingZ = nave.z1 - s.inner, tread = (landingZ - (nave.ridgeZ + s.foot)) / (s.steps - 1);
  const outer = nave.x1, inner = nave.x1 - s.width;
  return {
    riser, upperRiser, tread,
    /** z of the first riser; z where the landing starts. */
    foot: nave.ridgeZ + s.foot, landingZ,
    /** x of the lower flight's sides; x where the upper flight reaches the gallery. */
    outer, inner, top: inner - (s.upper - 1) * s.tread,
  };
}

export interface RailPoint { x: number; y: number; z: number }
export interface RailStop { id: 'door' | 'altar' | 'vestry' | 'gallery' | 'out'; at: number; look: RailPoint; text: string }
export interface Rail { points: RailPoint[]; lengths: number[]; total: number; stops: RailStop[] }

/** The visitor's path at floor level (eye height is added by the camera): door, aisle, altar, vestry, gallery, door. */
export function churchRail(room: ChurchRoom = CHURCH_ROOM): Rail {
  const { nave, vestry } = room.shell, f = room.fit, c = nave.ridgeZ, st = churchStair(room), up = f.chancel.rise;
  const door = { x: nave.x1 - 0.7, y: 0, z: c };
  const altar = { x: nave.x0 + f.chancel.depth + 0.62, y: 0, z: c };
  // Walk left past the arched table on the nave floor, then one step up onto the chancel toward the vestry door.
  const side = { x: nave.x0 + f.chancel.depth + 0.45, y: 0, z: 1.25 };
  const step = { x: nave.x0 + f.chancel.depth + 0.02, y: up, z: 1.25 };
  const ahead = { x: nave.x0 + f.chancel.depth - 0.18, y: up, z: 1.25 };
  const turn = { x: ahead.x, y: up, z: f.vestryDoor.z };
  const sill = { x: nave.x0 + 0.02, y: up, z: f.vestryDoor.z };
  const below = { x: vestry.x1 - 0.1, y: 0, z: f.vestryDoor.z };
  const inVestry = { x: vestry.x1 - 0.85, y: 0, z: (f.vestryDoor.z + (vestry.z0 + vestry.z1) / 2) / 2 };
  const back = { x: nave.x1 - 0.8, y: 0, z: c };
  // Up the stair: along the tread nosings of the lower flight, across the landing, and up the upper flight.
  const mid = (st.outer + st.inner) / 2, upperZ = st.landingZ + 0.33;
  const foot = { x: mid, y: 0, z: st.foot - 0.25 };
  const first = { x: mid, y: st.riser, z: st.foot };
  const last = { x: mid, y: f.stair.landing, z: st.landingZ };
  const landing = { x: mid, y: f.stair.landing, z: upperZ };
  const upFirst = { x: st.inner, y: f.stair.landing + st.upperRiser, z: upperZ };
  const head = { x: st.top, y: f.gallery.floor, z: upperZ };
  const walkX = nave.x1 - f.gallery.rear + 0.45;
  const turnRail = { x: walkX, y: f.gallery.floor, z: upperZ };
  const rail = { x: walkX, y: f.gallery.floor, z: c };
  const points: RailPoint[] = [door, altar, side, step, ahead, turn, sill, below, inVestry, below, sill, turn, ahead, step, side, altar, back, foot, first, last, landing,
    upFirst, head, turnRail, rail, turnRail, head, upFirst, landing, last, first, foot, back, door];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z));
  const total = lengths[lengths.length - 1];
  const stops: RailStop[] = [
    { id: 'door', at: 0, look: { x: nave.x0, y: 2.1, z: c },
      text: 'One room. Pale blue pews stand in two blocks, one on each side of a wide aisle, and the altar is at the far end.\nThe gallery runs above you on three sides, on square posts.' },
    { id: 'altar', at: lengths[points.indexOf(altar)], look: { x: nave.x0, y: 2.0, z: c },
      text: 'A white altar with three pointed arches outlined in gold. Behind it stand five scalloped spires topped with gold crosses, a statue, and framed devotional prints.\nA wooden armchair, a white lectern and a small red table with statues stand to the right; the confessional stands in the left corner.' },
    { id: 'vestry', at: lengths[points.indexOf(inVestry)], look: { x: vestry.x0, y: 0.8, z: (vestry.z0 + vestry.z1) / 2 - 0.75 },
      text: 'The vestry. Bare worn planks, two sash windows, a folding chair, and a white chest of drawers with peeling paint.\nA framed map leans on the wall, drawn by hand: houses and roads in pencil.' },
    { id: 'gallery', at: lengths[points.indexOf(rail)], look: { x: nave.x0 + 1, y: 0.9, z: c },
      text: 'The gallery runs along both sides and the back, on square posts. An iron tie rod crosses the nave under the ceiling.\nAbove it, a flat white ceiling lies between two sloped green sides.' },
    { id: 'out', at: total, look: { x: nave.x1 + 2, y: 1.5, z: c }, text: '' },
  ];
  return { points, lengths, total, stops };
}

/** Floor-level point of the rail at a distance along it. */
export function railPoint(rail: Rail, distance: number): RailPoint {
  const d = Math.min(rail.total, Math.max(0, distance));
  let i = 1;
  while (i < rail.lengths.length - 1 && rail.lengths[i] < d) i++;
  const a = rail.points[i - 1], b = rail.points[i], span = rail.lengths[i] - rail.lengths[i - 1];
  const k = span > 0 ? (d - rail.lengths[i - 1]) / span : 0;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

/** Where a car stops to go in: the foot of the tower steps, in game metres. */
export function churchDoorPosition(site: Pick<ChurchSite, 'world'>): { x: number; z: number } {
  const steps = CHURCH_FEATURES.steps;
  return site.world(t.x1 + steps.run, steps.u);
}
export const CHURCH_DOOR_RADIUS = 12;
