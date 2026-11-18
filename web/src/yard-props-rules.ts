/**
 * Pure rules for breakable yard and field props: where they stand, when a hit breaks one, how its pieces move and
 * rest, and which score fact a break is. No DOM, no three.js; yard-props.ts draws and drives them.
 *
 * The positions are invented. The rules read only the land the game already has (building shapes, roads, mailboxes
 * and, for bales, open ground in the terrain) and a fixed seed, so every player sees the same yards on the same day.
 * Nothing here is surveyed: no real fence, clothesline, ornament, woodpile, bale or bin is mapped.
 */
import { draw } from './shift-rules';

export type YardKind = 'railFence' | 'picketFence' | 'clothesline' | 'whirligig' | 'buoys' | 'traps' | 'well' | 'woodpile' |
  'bale' | 'garbageBin' | 'recyclingBin';
export const KINDS: readonly YardKind[] = Object.freeze(['railFence', 'picketFence', 'clothesline', 'whirligig', 'buoys', 'traps',
  'well', 'woodpile', 'bale', 'garbageBin', 'recyclingBin']);

/** One fixed seed for the layout: the same yards for every player, every day. Only bins and laundry follow the day. */
export const LAYOUT_SEED = 1246;

// Clearances in metres. A prop's own half size is added to each.
/** From the edge of any mapped road or track to a yard prop. */
export const YARD_SETBACK = 5;
/** The road shoulder: bins at the road stand beyond it, never on it. */
export const SHOULDER = 1.8;
/** From the line of a driveway (house to road) to any prop: the lane and a margin each side. */
export const DRIVEWAY_CLEAR = 3.5;
/** From any mailbox or community box. */
export const MAILBOX_CLEAR = 3;
/** From the wall of any building. */
export const BUILDING_CLEAR = 1.5;
/** A bale stands this far from any road edge, in its field. */
export const FIELD_SETBACK = 10;

/** Half sizes for contact and spacing, metres: along the prop's length, and across it. Height for jumps over it. */
export const SIZE: Readonly<Record<YardKind, { half: number; halfWidth: number; height: number }>> = Object.freeze({
  railFence: { half: 1.5, halfWidth: .12, height: 1.1 },
  picketFence: { half: 1.2, halfWidth: .1, height: 1.0 },
  clothesline: { half: 3.05, halfWidth: .35, height: 2.1 },
  whirligig: { half: .3, halfWidth: .3, height: 1.6 },
  buoys: { half: .65, halfWidth: .25, height: 1.3 },
  traps: { half: 1.0, halfWidth: .35, height: .95 },
  well: { half: .85, halfWidth: .85, height: 1.9 },
  woodpile: { half: 1.25, halfWidth: .3, height: 1.0 },
  bale: { half: .6, halfWidth: .75, height: 1.5 },
  garbageBin: { half: .3, halfWidth: .37, height: 1.05 },
  recyclingBin: { half: .3, halfWidth: .37, height: 1.05 },
});
/** Fence sections are short so a hit breaks the part it touched, not the whole run. */
export const SECTION: Readonly<Record<'railFence' | 'picketFence', number>> = Object.freeze({ railFence: 3, picketFence: 2.4 });

export interface YardBuilding {
  id: number; x: number; z: number; kind: 'house' | 'barn' | 'shed' | 'large';
  /** Compass bearing of the long axis, radians (the game's heading: along = (sin, -cos)). */
  axis: number; length: number; width: number;
}
export interface RoadPoint { dist: number; x: number; z: number; heading: number; halfWidth: number }
export interface PlaceInput {
  buildings: readonly YardBuilding[];
  mailboxes: readonly { x: number; z: number }[];
  /** Nearest public road (highway, paved or gravel) within `reach`. */
  publicRoad(x: number, z: number, reach: number): RoadPoint | null;
  /** Nearest road of any kind, tracks and rail trails too, within `reach`. */
  anyRoad(x: number, z: number, reach: number): RoadPoint | null;
  /** 'route', or a protected place: a cemetery, a church ground, the school bus stop. Nothing is placed there. */
  place(x: number, z: number): string;
  /** Hand-built sites keep their own ground: boxes [x0, z0, x1, z1]. */
  excluded: readonly (readonly [number, number, number, number])[];
}
export interface YardProp {
  /** Index in the placement list: stable for one land. */
  id: number; kind: YardKind; x: number; z: number;
  /** The game's heading of the prop's length: along = (sin yaw, -cos yaw). */
  yaw: number;
  /** The building whose property it is (a house, or a barn for bales). */
  owner: number;
  /** A seeded number 0..1 for colours and small variations. */
  look: number;
  /** Bales only stand where the terrain shows open field (isField); the runtime checks once the fine ground is in. */
  field?: boolean;
  /** Bins stand out only on garbage day. */
  daily?: boolean;
  /** The last section of a fence run carries the end post. */
  end?: boolean;
}

export const along = (yaw: number): [number, number] => [Math.sin(yaw), -Math.cos(yaw)];
export const across = (yaw: number): [number, number] => [Math.cos(yaw), Math.sin(yaw)];

/** Distance from a point to a segment. */
export function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
/** Distance from a point to an oriented box (0 inside). */
export function boxDistance(x: number, z: number, cx: number, cz: number, yaw: number, half: number, halfWidth: number): number {
  const [ax, az] = along(yaw), [bx, bz] = across(yaw), dx = x - cx, dz = z - cz;
  const a = Math.abs(dx * ax + dz * az) - half, b = Math.abs(dx * bx + dz * bz) - halfWidth;
  return Math.hypot(Math.max(0, a), Math.max(0, b));
}
/** The radius of a circle round a prop's footprint. */
export const reach = (kind: YardKind): number => Math.hypot(SIZE[kind].half, SIZE[kind].halfWidth);

/** Weekly garbage day on a seeded weekday; recycling goes out every other garbage day. Shift days count from 1. */
export const GARBAGE_WEEKDAY = Math.floor(draw(LAYOUT_SEED, 0, 41) * 7);
export const garbageDay = (day: number): boolean => ((day - 1) % 7 + 7) % 7 === GARBAGE_WEEKDAY;
export const recyclingDay = (day: number): boolean => garbageDay(day) && Math.floor((day - 1) / 7) % 2 === 0;
/** Whether a house's line has washing on it today: about one in three, seeded per house and day. */
export const laundryDay = (day: number, owner: number): boolean => draw(day, owner, 43) < .35;
/** Out today: bins only on garbage day; every other prop every day. */
export function outToday(p: YardProp, day: number): boolean {
  if (p.kind === 'garbageBin') return garbageDay(day);
  if (p.kind === 'recyclingBin') return recyclingDay(day);
  return true;
}

/** Open field for a bale: no trees or roofs, dry, no mineral ground, well off the road and any brook, not steep. */
export interface FieldSample { canopy: number; roadDist: number; halfWidth: number; water?: boolean; mineral?: boolean; brook: number; slope: number }
export function isField(s: FieldSample): boolean {
  return s.canopy < .4 && !s.water && !s.mineral && s.brook > 8 && s.roadDist - s.halfWidth > FIELD_SETBACK && s.slope < .3;
}

/**
 * Every yard and field prop for one land. Houses get, by seeded chance, a front fence run (rail or picket, with a gap
 * for the driveway), a clothesline behind, one lawn ornament in front, a woodpile at the side, and bins at the road
 * by the driveway; barns get a few round bales out in their field. Each candidate must keep every clearance above.
 * A driveway is not mapped: it is taken as the line from the house to its mailbox (or to the nearest road point).
 */
export function placeYard(input: PlaceInput): YardProp[] {
  const out: YardProp[] = [];
  const cell = 32;
  const near = <T>(g: Map<number, T[]>, x: number, z: number, r: number, fn: (v: T) => boolean): boolean => {
    for (let cx = Math.floor((x - r) / cell); cx <= Math.floor((x + r) / cell); cx++)
      for (let cz = Math.floor((z - r) / cell); cz <= Math.floor((z + r) / cell); cz++)
        for (const v of g.get(cx * 131072 + cz) ?? []) if (fn(v)) return true;
    return false;
  };
  const index = <T>(g: Map<number, T[]>, x0: number, z0: number, x1: number, z1: number, v: T) => {
    for (let cx = Math.floor(x0 / cell); cx <= Math.floor(x1 / cell); cx++)
      for (let cz = Math.floor(z0 / cell); cz <= Math.floor(z1 / cell); cz++) {
        const k = cx * 131072 + cz, list = g.get(k); if (list) list.push(v); else g.set(k, [v]);
      }
  };
  const buildings = new Map<number, YardBuilding[]>();
  for (const b of input.buildings) {
    const r = Math.hypot(b.length, b.width) / 2;
    index(buildings, b.x - r, b.z - r, b.x + r, b.z + r, b);
  }
  const boxes = new Map<number, { x: number; z: number }[]>();
  for (const m of input.mailboxes) index(boxes, m.x, m.z, m.x, m.z, m);
  const lanes = new Map<number, [number, number, number, number][]>();
  // Driveways first, for every house, so one yard never blocks a neighbour's lane.
  const fronts = new Map<number, { road: RoadPoint; mouth: [number, number]; depth: number }>();
  for (const b of input.buildings) {
    if (b.kind !== 'house') continue;
    const road = input.publicRoad(b.x, b.z, 90);
    if (!road) continue;
    let mouth: [number, number] = [road.x, road.z], best = 45 * 45;
    for (const m of input.mailboxes) {
      const d = (m.x - road.x) ** 2 + (m.z - road.z) ** 2;
      if (d < best) { best = d; mouth = [m.x, m.z]; }
    }
    const lane: [number, number, number, number] = [b.x, b.z, mouth[0], mouth[1]];
    index(lanes, Math.min(b.x, mouth[0]), Math.min(b.z, mouth[1]), Math.max(b.x, mouth[0]), Math.max(b.z, mouth[1]), lane);
    fronts.set(b.id, { road, mouth, depth: Math.max(b.length, b.width) / 2 });
  }
  const placed = new Map<number, YardProp[]>();
  const clear = (kind: YardKind, x: number, z: number, yaw: number): boolean => {
    const { half, halfWidth } = SIZE[kind], r = reach(kind);
    for (const [x0, z0, x1, z1] of input.excluded) if (x >= x0 - r && x <= x1 + r && z >= z0 - r && z <= z1 + r) return false;
    const setback = kind === 'garbageBin' || kind === 'recyclingBin' ? SHOULDER : kind === 'bale' ? FIELD_SETBACK : YARD_SETBACK;
    // The corners of the footprint too, so a long fence section cannot reach into a road or a protected place.
    for (const s of [-1, 0, 1]) for (const t of [-1, 1]) {
      const [ax, az] = along(yaw), [bx, bz] = across(yaw), px = x + ax * half * s + bx * halfWidth * t, pz = z + az * half * s + bz * halfWidth * t;
      const edge = input.anyRoad(px, pz, 40);
      if (edge && edge.dist - edge.halfWidth < setback || input.place(px, pz) !== 'route') return false;
    }
    if (near(boxes, x, z, MAILBOX_CLEAR + r, m => boxDistance(m.x, m.z, x, z, yaw, half, halfWidth) < MAILBOX_CLEAR)) return false;
    if (near(lanes, x, z, DRIVEWAY_CLEAR + r, ([ax, az, bx, bz]) => {
      // The lane against the footprint's centre line, so a long section is judged along its length.
      const [ux, uz] = along(yaw);
      for (const s of [-1, -.5, 0, .5, 1]) if (segmentDistance(x + ux * half * s, z + uz * half * s, ax, az, bx, bz) < DRIVEWAY_CLEAR + halfWidth) return true;
      return false;
    })) return false;
    const wall = kind === 'bale' ? 6 : BUILDING_CLEAR;
    if (near(buildings, x, z, wall + r + 30, b => {
      const [ux, uz] = along(yaw);
      for (const s of [-1, 0, 1]) for (const t of [-1, 0, 1]) {
        const [vx, vz] = across(yaw);
        const px = x + ux * half * s + vx * halfWidth * t, pz = z + uz * half * s + vz * halfWidth * t;
        if (boxDistance(px, pz, b.x, b.z, b.axis, b.length / 2, b.width / 2) < wall) return true;
      }
      return false;
    })) return false;
    if (near(placed, x, z, r + 4, p => Math.hypot(p.x - x, p.z - z) < r + reach(p.kind) + .4)) return false;
    return true;
  };
  const add = (kind: YardKind, x: number, z: number, yaw: number, owner: number, extra: Partial<YardProp> = {}): YardProp | null => {
    if (!clear(kind, x, z, yaw)) return null;
    const p: YardProp = { id: out.length, kind, x, z, yaw, owner, look: draw(LAYOUT_SEED, out.length, 7), ...extra };
    out.push(p); index(placed, x, z, x, z, p);
    return p;
  };
  const sorted = [...input.buildings].sort((a, b) => a.id - b.id);
  for (const b of sorted) {
    if (b.kind !== 'house') continue;
    const f = fronts.get(b.id);
    if (!f) continue;
    const roll = (salt: number) => draw(LAYOUT_SEED, b.id, salt);
    // Toward the road from the house, and along the road.
    const tx = f.road.x - b.x, tz = f.road.z - b.z, tl = Math.hypot(tx, tz) || 1, fx = tx / tl, fz = tz / tl;
    const [rx, rz] = along(f.road.heading);
    const front = f.road.dist - f.road.halfWidth - f.depth;   // lawn between the house and the road edge
    // A fence run along the road, 6.5 m in from its edge, on one side of the lane or both.
    if (roll(1) < .35 && front > YARD_SETBACK + 4) {
      const kind: YardKind = roll(2) < .6 ? 'railFence' : 'picketFence', step = SECTION[kind];
      const lineX = f.road.x - fx * (f.road.halfWidth + 6.5), lineZ = f.road.z - fz * (f.road.halfWidth + 6.5);
      // Where the lane crosses the fence line, measured along the road.
      const laneAt = (f.mouth[0] - lineX) * rx + (f.mouth[1] - lineZ) * rz;
      const sides = roll(3) < .5 ? [-1, 1] : [roll(4) < .5 ? -1 : 1];
      for (const side of sides) {
        const count = 3 + Math.floor(roll(6 + side) * 5);
        let last: YardProp | null = null;
        for (let i = 0; i < count; i++) {
          const s = laneAt + side * (DRIVEWAY_CLEAR + .4 + step / 2 + i * step);
          const p = add(kind, lineX + rx * s, lineZ + rz * s, f.road.heading, b.id);
          if (!p) break;
          last = p;
        }
        if (last) last.end = true;
      }
    }
    // A clothesline behind the house, across the line to the road.
    if (roll(10) < .3) {
      const d = f.depth + 5 + roll(11) * 3, x = b.x - fx * d, z = b.z - fz * d;
      add('clothesline', x, z, f.road.heading + (roll(12) - .5) * .4, b.id);
    }
    // One lawn ornament in the front yard.
    if (roll(20) < .55) {
      const kinds: YardKind[] = ['whirligig', 'buoys', 'traps', 'well'];
      const kind = kinds[Math.floor(roll(21) * kinds.length)];
      // Two tries: a spot in the front lawn, then one beside the house.
      for (let n = 0; n < 2; n++) {
        const d = n ? (roll(22) - .5) * 4 : f.depth + 3 + roll(22) * Math.max(0, Math.min(6, front - YARD_SETBACK - 3));
        const s = n ? (roll(23) < .5 ? -1 : 1) * (f.depth + 4) : (roll(23) - .5) * 12;
        if (add(kind, b.x + fx * d + rx * s, b.z + fz * d + rz * s, f.road.heading + (roll(24) - .5) * .6, b.id)) break;
      }
    }
    // A woodpile at one side of the house.
    if (roll(30) < .35) {
      const side = roll(31) < .5 ? -1 : 1, d = f.depth + 2.5, t = (roll(32) - .5) * 4;
      add('woodpile', b.x + rx * side * d + fx * t, b.z + rz * side * d + fz * t, Math.atan2(fx, -fz), b.id);
    }
    // Bins at the road on garbage day, beside the lane's mouth, beyond the shoulder.
    if (roll(40) < .75) {
      const out0 = f.road.halfWidth + SHOULDER + SIZE.garbageBin.halfWidth + .25;
      // The mouth on the road's centre line, then out to the bin line on the house's side.
      const ma = (f.mouth[0] - f.road.x) * rx + (f.mouth[1] - f.road.z) * rz;
      const cx = f.road.x + rx * ma - fx * out0, cz = f.road.z + rz * ma - fz * out0;
      for (const side of roll(41) < .5 ? [-1, 1] : [1, -1]) {
        const g = add('garbageBin', cx + rx * side * 4.2, cz + rz * side * 4.2, f.road.heading, b.id, { daily: true });
        if (!g) continue;
        add('recyclingBin', cx + rx * side * 5.6, cz + rz * side * 5.6, f.road.heading, b.id, { daily: true });
        break;
      }
    }
  }
  // Round bales out in a barn's field, away from the road: a loose row of three to six.
  for (const b of sorted) {
    if (b.kind !== 'barn') continue;
    const roll = (salt: number) => draw(LAYOUT_SEED, b.id, 60 + salt);
    if (roll(0) >= .6) continue;
    const road = input.publicRoad(b.x, b.z, 150);
    const away = road ? Math.atan2(b.x - road.x, -(b.z - road.z)) : roll(1) * Math.PI * 2;
    const dir = away + (roll(2) - .5) * 1.6, d = Math.max(b.length, b.width) / 2 + 25 + roll(3) * 30;
    const [ax, az] = along(dir), cx = b.x + ax * d, cz = b.z + az * d;
    const row = dir + Math.PI / 2 + (roll(4) - .5) * .8, [ux, uz] = along(row), n = 3 + Math.floor(roll(5) * 4);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 3.4 + (roll(10 + i) - .5) * .8;
      add('bale', cx + ux * t, cz + uz * t, row + Math.PI / 2 + (roll(20 + i) - .5) * .5, b.id, { field: true });
    }
  }
  return out;
}

/** Break thresholds, m/s: a touch below one is a solid stop; at or above it the prop comes apart. */
export const BREAK_SPEED: Readonly<Record<YardKind, number>> = Object.freeze({
  railFence: 2.5, picketFence: 2, clothesline: 1.5, whirligig: 1.2, buoys: 1.5, traps: 2, well: 3, woodpile: 2.5,
  bale: 1.5, garbageBin: 1, recyclingBin: 1,
});
export const breaks = (kind: YardKind, speed: number): boolean => Number.isFinite(speed) && speed >= BREAK_SPEED[kind];
/** What a break leaves of the car's speed: a little less, as with a knocked mailbox (0.91). */
export const SLOW: Readonly<Record<YardKind, number>> = Object.freeze({
  railFence: .94, picketFence: .95, clothesline: .98, whirligig: .99, buoys: .98, traps: .95, well: .88, woodpile: .92,
  bale: .86, garbageBin: .97, recyclingBin: .98,
});

/** The score stream fact for a break. A rolling bale that breaks something adds BALE_STRIKE beside it: a combo. */
export function scoreKind(kind: YardKind): string {
  switch (kind) {
    case 'railFence': case 'picketFence': return 'prop:fence';
    case 'whirligig': case 'buoys': case 'traps': case 'well': return 'prop:ornament';
    case 'garbageBin': case 'recyclingBin': return 'prop:bin';
    default: return `prop:${kind}`;
  }
}
export const BALE_STRIKE = 'prop:baleStrike';
/** The daily call for property damage: one per property per day, as complaints.ts keys it. */
export const DAMAGE_COMPLAINT = 'propertyDamage';

/** The car as circles along its length (its envelope), against a prop's footprint. */
export interface CarShape { x: number; z: number; heading: number; radius: number; circles: readonly number[]; sides?: readonly number[] }
export function touches(car: CarShape, p: { x: number; z: number; yaw: number }, kind: YardKind, margin = 0): boolean {
  const { half, halfWidth } = SIZE[kind];
  for (let i = 0; i < car.circles.length; i++) {
    const off = car.circles[i], side = car.sides?.[i] ?? 0;
    const cx = car.x + Math.sin(car.heading) * off + Math.cos(car.heading) * side, cz = car.z - Math.cos(car.heading) * off + Math.sin(car.heading) * side;
    if (boxDistance(cx, cz, p.x, p.z, p.yaw, half, halfWidth) < car.radius + margin) return true;
  }
  return false;
}

/** One loose piece, in world metres: where it is, how it moves, and its turn about its own axes. */
export interface Piece {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number; wx: number; wy: number; wz: number;
  /** Lowest point below the piece's centre, so it rests on the ground and not in it. */
  floor: number;
  rolling: boolean; resting: boolean; age: number;
}
/** Every piece rests by then, whatever the ground: nothing moves all shift. A bale may roll for longer. */
export const PIECE_LIFE = 6, BALE_LIFE = 20;
export const GRAVITY = 9.81;
/** A bale rolls on its round side: this much of gravity's pull down the slope stays as speed, less rolling drag. */
export const BALE_GRIP = .55, BALE_DRAG = .9;

/**
 * Set a piece flying from a hit. `n` pieces share the push; `i` picks a seeded spread. The direction is the car's
 * travel; a bale only rolls (no lift), heavy logs scatter low and light things go up.
 */
export function launch(p: Piece, kind: YardKind, i: number, n: number, speed: number, dx: number, dz: number, seed: number): void {
  const s = Math.min(speed, 25), l = Math.hypot(dx, dz) || 1, fx = dx / l, fz = dz / l;
  const r = (salt: number) => draw(seed, i, salt) - .5;
  p.resting = false; p.age = 0;
  if (kind === 'bale') {
    p.rolling = true;
    p.vx = fx * s * .75; p.vz = fz * s * .75; p.vy = 0; p.wx = p.wy = p.wz = 0;
    return;
  }
  const lift = kind === 'woodpile' ? .6 : kind === 'well' || kind === 'traps' ? 1.2 : 2.2;
  const share = .45 + .35 * (n > 1 ? i / (n - 1) : 1) + r(1) * .2;
  p.rolling = false;
  p.vx = fx * s * share + -fz * s * r(2) * .5;
  p.vz = fz * s * share + fx * s * r(2) * .5;
  p.vy = lift * (1 + r(3)) + s * .08;
  p.wx = r(4) * 8; p.wy = r(5) * 6; p.wz = r(6) * 8;
}
/**
 * One step of a loose piece over the ground (scripted: gravity, a dull bounce, ground friction). `ground` is the
 * height under it. Returns true when it moved.
 */
export function stepPiece(p: Piece, dt: number, ground: number): boolean {
  if (p.resting || dt <= 0) return false;
  p.age += dt;
  p.vy -= GRAVITY * dt;
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
  const floor = ground + p.floor;
  if (p.y <= floor) {
    p.y = floor;
    if (p.vy < -1.5) p.vy = -p.vy * .25; else p.vy = 0;
    const keep = Math.exp(-6 * dt);
    p.vx *= keep; p.vz *= keep; p.wx *= keep; p.wy *= keep; p.wz *= keep;
    if (Math.hypot(p.vx, p.vy, p.vz) < .25) settle(p);
  }
  if (p.age >= PIECE_LIFE) { p.y = floor; settle(p); }
  return true;
}
/**
 * One step of a rolling bale: it keeps its push, gains speed down the slope (`gx`, `gz` is the ground's rise per metre,
 * so the bale accelerates against it) and slows by rolling drag. It rests once slow on gentle ground.
 */
export function rollBale(p: Piece, dt: number, ground: number, gx: number, gz: number): boolean {
  if (p.resting || dt <= 0) return false;
  p.age += dt;
  p.vx += (-gx * GRAVITY * BALE_GRIP) * dt; p.vz += (-gz * GRAVITY * BALE_GRIP) * dt;
  const v = Math.hypot(p.vx, p.vz), drag = Math.min(v, BALE_DRAG * dt);
  if (v > 0) { p.vx -= p.vx / v * drag; p.vz -= p.vz / v * drag; }
  p.x += p.vx * dt; p.z += p.vz * dt; p.y = ground + p.floor;
  // It turns about its axle as far as it rolls; the axle swings to lie across its travel.
  const speed = Math.hypot(p.vx, p.vz);
  p.rz -= speed / Math.max(.1, p.floor) * dt;
  if (speed > .05) p.ry = Math.atan2(p.vx, -p.vz);
  const steep = Math.hypot(gx, gz) * GRAVITY * BALE_GRIP > BALE_DRAG;
  if (speed < .15 && !steep || p.age >= BALE_LIFE) settle(p);
  return true;
}
function settle(p: Piece): void { p.resting = true; p.vx = p.vy = p.vz = p.wx = p.wy = p.wz = 0; }
