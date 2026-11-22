import { CHURCH_FEATURES, CHURCH_GEOM, CHURCH_SCALE, type ChurchSite } from './church-site';

/**
 * The inside of the River Denys Mountain church, in metres.
 *
 * Frame: the exterior model's own axes, scaled by CHURCH_SCALE. +x points to the tower (the door end), -x to the
 * altar; walking up the aisle, +z is on the left. y = 0 is the floor, which is the sill of the tower door.
 *
 * `shell` is computed from church-site.ts, so the room and the building outside always agree. `fit` holds what only
 * the inside shows; those numbers are read off reference stills by eye. The outside scan made the room about 0.8 times
 * the old size, so the horizontal `fit` numbers and the gallery height were scaled to it (21 Nov 2026); a scan of the
 * inside can correct them. Nothing else in the interior holds a dimension of the room.
 */
const S = CHURCH_SCALE;
/** Wall thickness in model units: the same T as web/src/church.ts (tools/church-interior-check.mjs compares them). */
export const CHURCH_WALL = 0.25;
const { nave: n, tower: t, vestry: v } = CHURCH_GEOM;
// The tower door is the first door in CHURCH_FEATURES (church-site.ts keeps it first).
const entry = CHURCH_FEATURES.openings.find(o => o.kind === 'door')!;
const metres = (units: number): number => units * S;
const height = (y: number): number => (y - entry.y0) * S;

export interface RoomWindow { side: -1 | 1; x: number; sill: number; spring: number; width: number }

export const CHURCH_ROOM = {
  shell: {
    nave: {
      x0: metres(n.x0 + CHURCH_WALL), x1: metres(n.x1 - CHURCH_WALL),
      z0: metres(-n.zn + CHURCH_WALL), z1: metres(n.zs - CHURCH_WALL),
      eave: height(n.eave), ridge: height(n.ridge), ridgeZ: metres((n.zs - n.zn) / 2),
    },
    /** Round-headed side windows: `spring` is where the half-round head starts. */
    windows: CHURCH_FEATURES.openings.filter(o => o.kind === 'arch' && (o.face === 'nave_n' || o.face === 'nave_s'))
      .map((o): RoomWindow => ({ side: o.face === 'nave_s' ? 1 : -1, x: metres(o.u), sill: height(o.y0), spring: height(o.y1), width: metres(o.w) })),
    porch: {
      x1: metres(t.x1 - CHURCH_WALL), z0: metres(-t.zn + CHURCH_WALL), z1: metres(t.zs - CHURCH_WALL),
      door: { z: metres(entry.u), width: metres(entry.w), height: height(entry.y1) },
    },
    /** The vestry shares the nave's end wall; its door passes through that wall's thickness. */
    vestry: {
      x0: metres(v.x0 + CHURCH_WALL), x1: metres(n.x0),
      z0: metres(v.z0 + CHURCH_WALL), z1: metres(v.z1 - CHURCH_WALL), ceiling: height(v.eave),
      /** Where the sash window and the outside door stand on the left (+z) wall: the same places as outside. */
      window: metres(CHURCH_FEATURES.openings.find(o => o.face === 'vestry_s' && o.kind === 'rect')!.u),
      door: metres(CHURCH_FEATURES.openings.find(o => o.face === 'vestry_s' && o.kind === 'door')!.u),
    },
  },
  fit: {
    eye: 1.6,
    /** The boarded ceiling follows the roof, `drop` below it, up to a flat panel `flatHalf` each side of the ridge. */
    ceiling: { flatHalf: 1.5, drop: 0.22 },
    aisle: 1.1,
    pews: { rows: 6, pitch: 0.8, rear: 3.2, back: 0.95, seat: 0.43, depth: 0.42 },
    /** `floor` is the walking surface. `sideEnd` is how far the side galleries stop short of the altar wall. */
    gallery: { floor: 2.5, thick: 0.2, rear: 2.4, side: 1.75, sideEnd: 3.7, front: 0.95, post: 0.22 },
    /** Against the door wall, on the right as you come in. It starts `gap` from the side wall (room to step on) and rises toward the middle, where there is headroom. */
    stair: { side: -1 as const, gap: 0.7, run: 2.4, width: 0.85, steps: 12 },
    tieRod: { fromAltar: 4.2, aboveRail: 0.25 },
    platform: { depth: 2.1, width: 3.4, rise: 0.18 },
    altar: { width: 2.7, height: 1.0, depth: 0.55, table: { width: 1.9, height: 1.04, depth: 0.8 }, spires: [1.75, 2.75, 3.75, 2.75, 1.75], spacing: 0.5 },
    vestryDoor: { z: 2.1, width: 0.9, height: 2.0 },
    cupboard: { height: 2.15, depth: 0.6 },
  },
} as const;

export type ChurchRoom = typeof CHURCH_ROOM;

/** Height of the boarded ceiling at a distance from the wall-to-wall centre line. */
export function ceilingAt(room: ChurchRoom, z: number): number {
  const { nave } = room.shell, { flatHalf, drop } = room.fit.ceiling;
  const off = Math.abs(z - nave.ridgeZ), half = (z < nave.ridgeZ ? nave.ridgeZ - nave.z0 : nave.z1 - nave.ridgeZ);
  const pitch = (nave.ridge - nave.eave) / half;
  return nave.eave - drop + (half - Math.max(off, flatHalf)) * pitch;
}

export interface RailPoint { x: number; y: number; z: number }
export interface RailStop { id: 'door' | 'altar' | 'vestry' | 'gallery' | 'out'; at: number; look: RailPoint; text: string }
export interface Rail { points: RailPoint[]; lengths: number[]; total: number; stops: RailStop[] }

/** The visitor's path at floor level (eye height is added by the camera): door, aisle, altar, vestry, gallery, door. */
export function churchRail(room: ChurchRoom = CHURCH_ROOM): Rail {
  const { nave, vestry } = room.shell, f = room.fit, c = nave.ridgeZ;
  const side = f.stair.side, wallZ = side < 0 ? nave.z0 : nave.z1, stairX = nave.x1 - f.stair.width / 2;
  const door = { x: nave.x1 - 0.7, y: 0, z: c };
  const altar = { x: nave.x0 + f.platform.depth + 2.7, y: 0, z: c };
  const ahead = { x: nave.x0 + f.platform.depth + 0.78, y: 0, z: c };
  const turn = { x: nave.x0 + f.platform.depth + 0.78, y: 0, z: f.vestryDoor.z };
  const sill = { x: nave.x0, y: 0, z: f.vestryDoor.z };
  const inVestry = { x: vestry.x1 - 0.85, y: 0, z: (f.vestryDoor.z + (vestry.z0 + vestry.z1) / 2) / 2 };
  const back = { x: nave.x1 - 1.9, y: 0, z: c };
  // The stair is reached from the strip between it and the side wall. On it, the path follows the tread nosings.
  const tread = f.stair.run / f.stair.steps, riser = f.gallery.floor / f.stair.steps;
  const round = { x: nave.x1 - 1.6, y: 0, z: wallZ - side * f.stair.gap / 2 };
  const foot = { x: stairX, y: 0, z: wallZ - side * f.stair.gap / 2 };
  const first = { x: stairX, y: riser, z: wallZ - side * f.stair.gap };
  const last = { x: stairX, y: f.gallery.floor, z: wallZ - side * (f.stair.gap + f.stair.run - tread) };
  const head = { x: stairX, y: f.gallery.floor, z: wallZ - side * (f.stair.gap + f.stair.run) };
  const landing = { x: stairX, y: f.gallery.floor, z: wallZ - side * (f.stair.gap + f.stair.run + 0.55) };
  const rail = { x: nave.x1 - f.gallery.rear + 0.75, y: f.gallery.floor, z: c };
  const points: RailPoint[] = [door, altar, ahead, turn, sill, inVestry, sill, turn, ahead, altar, back, round, foot, first, last, head, landing, rail,
    landing, head, last, first, foot, round, back, door];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z));
  const total = lengths[lengths.length - 1];
  const stops: RailStop[] = [
    { id: 'door', at: 0, look: { x: nave.x0, y: 2.1, z: c },
      text: 'One room. Box pews stand on each side of the aisle, and the altar is at the far end.\nThe paint is worn and uneven on every board.' },
    { id: 'altar', at: lengths[points.indexOf(altar)], look: { x: nave.x0, y: 2.0, z: c },
      text: 'A white altar with three pointed arches outlined in gold. Behind it stand five thin stepped spires; the middle one is the tallest.\nA red chair, a small red stand and a white pedestal stand near it.' },
    { id: 'vestry', at: lengths[points.indexOf(inVestry)], look: { x: vestry.x0, y: 0.8, z: (vestry.z0 + vestry.z1) / 2 - 0.75 },
      text: 'The vestry. Bare worn planks, a sash window, a folding chair, and a white chest of drawers with peeling paint.\nA framed map leans on the wall, drawn by hand: houses and roads in pencil.' },
    { id: 'gallery', at: lengths[points.indexOf(rail)], look: { x: nave.x0 + 1, y: 0.9, z: c },
      text: 'The gallery runs along both sides and the back, on square posts. An iron tie rod crosses the nave at the height of the rail.\nAbove it, a flat white ceiling lies between two sloped green sides.' },
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
