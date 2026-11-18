import type { Building } from './buildings';
import type { Solid } from './parked';
import { frameToMap, type Frame } from './site-kit';
import { strips } from './site-solids';

/**
 * Mabou's main street on Highway 19, built by hand from the public-safe dash cam brief (the project brief): the grocery,
 * the post office building and its memorial lawn, the hall across from it, the gas station, the museum, the plaza with
 * its map board, the café, the pub, the dark red shop, the bank branch, and the street furniture (black lamp posts,
 * the north sidewalk, string lights over the road at the junction). Positions are EPSG:2961 (baked footprints and
 * road centre lines); nothing is read from pictures. No names, sign words, numbers, logos or postal marks are drawn.
 *
 * A place has a local frame: +x runs along compass azimuth `az`, +z along az + 90 degrees, +y is up. For every
 * building the front is the +z side.
 */
export type Cluster = 'west' | 'east';
export interface MainPlace extends Frame {
  /** The baked site that this model replaces in the drawing (the record's `site` when it has one). */
  replaces: [number, number] | null;
  /** Local footprint rectangles [x0, x1, z0, z1]: collision, and the tree layer is cleared under them. */
  rects: [number, number, number, number][];
  /** Local rectangles that are open ground (no collision) where the tree layer is cleared too. */
  open?: [number, number, number, number][];
  /** The places of one cluster are merged into one mesh per surface pattern once all of them are built. */
  cluster: Cluster;
}

export const MAIN_PLACES = {
  // Baked 51 with its wings 1722 (west) and 1723 (north part of the east wall); the long side faces the road (160°).
  grocery: { e: 624878.87, n: 5103596.94, az: 70, replaces: [624878.67, 5103595.55], cluster: 'east',
    rects: [[-15.67, 15.67, -9.955, 9.955], [-24.24, -15.67, -9.96, 2.89], [15.67, 22.04, -9.96, 2.89], [-8.4, -2.0, 9.955, 12.9]] },
  // Baked 150: brick, flat roof; the short side with the glazed vestibule faces the road (153°), the ramp runs along the east wall.
  postOffice: { e: 624450.16, n: 5103392.66, az: 63, replaces: [624450.16, 5103392.66], cluster: 'west', open: [[7.5, 18.5, 5.5, 19.5]],
    rects: [[-5.2, 5.2, -6.94, 6.94], [5.2, 6.75, -5.0, 6.94], [-1.35, 1.35, 6.94, 8.35]] },
  // Baked 3 (south side; the front faces 324°), on the land builder's measured blocks: the main block 12.5 × 20 m (its
  // road wall 2.5 m nearer the road than the map outline), the east wing (-x) and the rear wing across the back.
  hall: { e: 624457.41, n: 5103331.6, az: 234, replaces: [624457.41, 5103331.6], cluster: 'west',
    rects: [[-7.27, 5.23, -4.09, 15.91], [-11.77, -7.27, -2.09, 10.41], [-11.3, -7.7, 10.41, 12.0], [-11.27, 9.23, -13.38, -2.08]] },
  // Baked 169: one storey, the ridge along the road; the pump islands stand in front (see GAS_ISLANDS).
  gas: { e: 624797.1, n: 5103548.86, az: 75, replaces: [624797.1, 5103548.86], cluster: 'east',
    rects: [[-8.1, 8.1, -7.7, 7.7]] },
  // Baked 140: 2.5 storeys, gable end to the road, steps at the front door.
  museum: { e: 624348.5, n: 5103315.0, az: 59, replaces: [624348.5, 5103315.0], cluster: 'west',
    rects: [[-4.36, 4.36, -7.93, 7.93], [-1.0, 1.4, 7.93, 9.2]] },
  // Baked 71: one storey, its porch deck at the east end (+x).
  cafe: { e: 624288.81, n: 5103268.17, az: 50, replaces: [624288.81, 5103268.17], cluster: 'west',
    rects: [[-8.27, 8.27, -9.07, 8.6]] },
  // Lidar box 973 (axis-aligned 10 × 9 m): 1.5 storeys, gable end to the road at the sidewalk.
  pub: { e: 624403.5, n: 5103344.0, az: 56.5, replaces: [624403.5, 5103344.0], cluster: 'west',
    rects: [[-4.2, 4.2, -6.6, 3.7]] },
  // Baked 130: one storey, a low gable end to the road.
  redShop: { e: 624433.71, n: 5103377.14, az: 60, replaces: [624433.71, 5103377.14], cluster: 'west',
    rects: [[-4.73, 4.73, -7.46, 7.46]] },
  // Baked 198: the front faces the shared lot (218°); a gabled entrance porch in the middle.
  bank: { e: 624929.72, n: 5103605.14, az: 128, replaces: [624929.72, 5103605.14], cluster: 'east',
    rects: [[-12.87, 12.87, -7.59, 7.59], [-2.1, 2.1, 7.59, 10.1]] },
  // The plaza between the café and the junction (no building): pale pavers at the sidewalk, the map board behind.
  plaza: { e: 624312.0, n: 5103285.0, az: 56, replaces: null, cluster: 'west', rects: [], open: [[-7.2, 6.2, 1.2, 8.2]] },
} satisfies Record<string, MainPlace>;
export type PlaceName = keyof typeof MAIN_PLACES;
const P = MAIN_PLACES as Record<PlaceName, MainPlace>;

export const toMap = (p: Frame, x: number, z: number): [number, number] => frameToMap(p, x, z);
const local = (name: PlaceName, x: number, z: number): [number, number] => toMap(P[name], x, z);

/** The two pump islands (local x centres in the gas frame, z = 11.25, 4.2 × 1.3 m): one opposite the window, one
 *  opposite the bay door. */
export const GAS_ISLANDS = [-4.2, 3.8];
export const GAS_ISLAND_Z = 11.25;

/** Small things on map points (each item's frame is set in the model; the azimuth here is the way it faces). */
export const MAIN_ITEMS = {
  // The memorial lawn, east of the post office building (post office frame).
  memorial: local('postOffice', 12.0, 8.5),
  memorialFlag: local('postOffice', 16.5, 10.0),
  memorialPanel: local('postOffice', 9.0, 14.0),
  memorialPath: [local('postOffice', 12.0, 10.6), local('postOffice', 12.0, 19.2)],
  // The gas station: the price pylon at the west edge of the apron, the lamp posts at the islands' ends.
  gasPylon: local('gas', -10.4, 14.6),
  gasLamps: [local('gas', -7.1, GAS_ISLAND_Z), local('gas', 6.7, GAS_ISLAND_Z)],
  // The grocery: the ice chest on the front wall, the red drop bin at the foot of the east wing.
  iceChest: local('grocery', 6.0, 10.45),
  dropBin: local('grocery', 22.65, 1.6),
  // The bank branch's tall sign on two posts on the lawn by the road (faces the road, 162°).
  bankSign: [624936.4, 5103584.3] as [number, number],
  // The plaza (plaza frame): the map board with the fiddle scroll, the church directory sign, the flag, two benches.
  mapBoard: local('plaza', -0.6, 2.4),
  churchSign: local('plaza', -6.2, 4.0),
  plazaFlag: local('plaza', 5.2, 3.0),
  benches: [local('plaza', -3.4, 5.6), local('plaza', 5.2, 5.0)],
  plazaLamp: local('plaza', -4.9, 7.0),
  // The pub's side yard (pub frame): the food trailer and the picnic tables.
  foodTrailer: local('pub', 9.0, -6.6),
  picnic: [local('pub', 7.0, -0.5), local('pub', 11.0, -1.0)],
};

/**
 * Black ornamental lamp posts along the north sidewalk (map points, heading of the road there) from the bridge to the
 * small shop east of the post office, and one by the waterfront path on the south side. Picked from stations every
 * 40 m on the baked Highway 19 centre line, 5.9 m out (6.4 m south), clear of side roads, footprints and poles.
 */
export const STREET_LAMPS: [number, number, number][] = [
  [624126.33, 5103088.41, 42.3], [624153.24, 5103118.01, 42.3], [624180.14, 5103147.61, 42.3],
  [624207.3, 5103177.18, 43.7], [624141.79, 5103087.86, 222.4], [624271.06, 5103239.66, 46.5],
  [624335.45, 5103293.13, 54.5], [624373.53, 5103319.24, 56.2], [624443.15, 5103364.61, 57.3],
  [624476.72, 5103386.39, 57.4], [624510.65, 5103407.77, 58.4], [624546.32, 5103426.93, 63.3],
];

/** The string lights: festoons across Highway 19 near the junction, each from a north post to a south post. */
export const FESTOONS: [[number, number], [number, number]][] = [
  [[624346.76, 5103301.45], [624353.78, 5103291.47]],
  [[624366.77, 5103314.96], [624373.55, 5103304.82]],
];

/** The north sidewalk: from the bridge's east end to just west of the gas station, along the Highway 19 centre line. */
export const SIDEWALK = { from: [624120.0, 5103072.0] as [number, number], to: [624770.0, 5103518.0] as [number, number],
  inner: 3.75, outer: 5.35, top: 0.12 };

/** The street furniture builds in two halves, split at this easting (each half waits for its own land). */
export const STREET_SPLIT = 624420;
export type StreetHalf = 'streetWest' | 'streetEast';
/** Map points under one half of the street furniture, for the build gate (the sidewalk is probed every 25 m by the
 *  builder, which has the road). */
export function streetPoints(half: StreetHalf): (readonly number[])[] {
  const west = half === 'streetWest', mine = (e: number) => west ? e < STREET_SPLIT : e >= STREET_SPLIT;
  return [...STREET_LAMPS.filter(([e]) => mine(e)), ...FESTOONS.flat().filter(([e]) => mine(e))];
}

/** Where the service drop of each replaced place ends on its model: local x, z on a wall, and the height. */
const DROP_ENDS: Partial<Record<PlaceName, [number, number, number]>> = {
  grocery: [-14.8, 9.955, 3.2], cafe: [8.27, -3.0, 2.9], museum: [4.36, 6.4, 5.2], gas: [7.6, 7.7, 3.4], bank: [-5.0, -7.59, 2.9],
  pub: [4.2, 1.8, 4.1], hall: [-11.27, -10.0, 3.5], postOffice: [5.2, -1.0, 2.9], redShop: [4.73, -5.0, 2.9],
};
/** The place whose model stands on a map point (within 1 m of one of its rectangles), if it replaces a baked box. */
export function placeAt(e: number, n: number): PlaceName | null {
  for (const name of Object.keys(P) as PlaceName[]) {
    const p = P[name]; if (!p.replaces) continue;
    const a = p.az * Math.PI / 180, dx = e - p.e, dn = n - p.n, x = dx * Math.sin(a) + dn * Math.cos(a), z = dx * Math.cos(a) - dn * Math.sin(a);
    if (p.rects.some(r => x >= r[0] - 1 && x <= r[1] + 1 && z >= r[2] - 1 && z <= r[3] + 1)) return name;
  }
  return null;
}
/** Re-aim the service drops of the replaced buildings at the models (a wire must not end in the air). The building is
 *  found by the drop's ground point (the baked record's centre), not by its bake id, which can change. */
export function aimDrops<T extends { building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }>(drops: T[]): T[] {
  return drops.map(d => {
    const place = placeAt(d.groundX, d.groundY), end = place && DROP_ENDS[place]; if (!place || !end) return d;
    const [x, y] = local(place, end[0], end[1]);
    return { ...d, x, y, height: end[2], ground: null, groundX: x, groundY: y };
  });
}

/** Which small things are built with which place (their land must be fine before the place builds). */
const ITEMS_OF: Record<PlaceName, (readonly number[])[]> = {
  grocery: [MAIN_ITEMS.iceChest, MAIN_ITEMS.dropBin],
  postOffice: [MAIN_ITEMS.memorial, MAIN_ITEMS.memorialFlag, MAIN_ITEMS.memorialPanel, ...MAIN_ITEMS.memorialPath],
  hall: [],
  gas: [MAIN_ITEMS.gasPylon, ...MAIN_ITEMS.gasLamps],
  museum: [],
  cafe: [],
  pub: [MAIN_ITEMS.foodTrailer, ...MAIN_ITEMS.picnic],
  redShop: [],
  bank: [MAIN_ITEMS.bankSign],
  plaza: [MAIN_ITEMS.mapBoard, MAIN_ITEMS.churchSign, MAIN_ITEMS.plazaFlag, ...MAIN_ITEMS.benches, MAIN_ITEMS.plazaLamp],
};
/** Map points under each place and its small things, for the build gate. */
export function placePoints(name: PlaceName): (readonly number[])[] {
  const p = P[name];
  return [[p.e, p.n], ...p.rects.flatMap(r => [toMap(p, r[0], r[2]), toMap(p, r[1], r[3]), toMap(p, r[0], r[3]), toMap(p, r[1], r[2])]),
    ...ITEMS_OF[name]];
}

export class MabouMainSite {
  readonly clear: number[][] = [];
  readonly solids: Solid[] = [];
  /** World centre and reach of everything here, for the contact tests. */
  readonly centre: { x: number; z: number };
  readonly reach = 560;
  constructor(readonly village: readonly [number, number]) {
    this.centre = { x: 624530 - village[0], z: village[1] - 5103340 };
    for (const p of Object.values(P)) for (const [i, r] of [...p.rects, ...p.open ?? []].entries()) {
      if (i < p.rects.length) this.solids.push(this.rect(p, ...r));
      const corners = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([x, z]) => this.world(...toMap(p, x, z)));
      const xs = corners.map(c => c.x), zs = corners.map(c => c.z);
      this.clear.push([Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2]);
    }
    const items = MAIN_ITEMS, gas = P.gas;
    const at = (q: readonly number[], half: number, halfWidth = half, az = 0): Solid => ({ ...this.world(q[0], q[1]), half, halfWidth, heading: az * Math.PI / 180 });
    // The pump islands (raised curbs with the dispensers), along the gas frame's x.
    for (const x of GAS_ISLANDS) this.solids.push(at(toMap(gas, x, GAS_ISLAND_Z), 2.1, 0.65, gas.az));
    this.solids.push(
      at(items.memorial, 1.9, 0.6, P.postOffice.az), at(items.iceChest, 1.0, 0.45, P.grocery.az), at(items.dropBin, 0.6, 0.55, P.grocery.az),
      at(local('plaza', -0.3, 2.4), 2.6, 0.32, P.plaza.az), at(items.foodTrailer, 1.6, 1.05, P.pub.az),
      ...items.picnic.map(q => at(q, 0.9, 0.8, P.pub.az)), ...items.benches.map(q => at(q, 0.8, 0.3, P.plaza.az)),
      at(items.bankSign, 1.4, 0.2, 72),
      // Posts and poles: thin, but a car should not pass through them.
      at(items.gasPylon, 0.95, 0.3, gas.az + 90),
      ...[items.memorialFlag, ...items.gasLamps, items.churchSign, items.plazaFlag, items.plazaLamp].map(q => at(q, 0.3)),
      at(items.memorialPanel, 0.7, 0.2, P.postOffice.az),
      ...STREET_LAMPS.map(([e, n]) => at([e, n], 0.22)),
      ...FESTOONS.flat().map(q => at(q, 0.2)));
    this.solids.splice(0, this.solids.length, ...this.solids.flatMap(strips));
  }
  world(e: number, n: number): { x: number; z: number } { return { x: e - this.village[0], z: this.village[1] - n }; }
  private rect(p: MainPlace, x0: number, x1: number, z0: number, z1: number): Solid {
    const [e, n] = toMap(p, (x0 + x1) / 2, (z0 + z1) / 2);
    return { ...this.world(e, n), half: (x1 - x0) / 2, halfWidth: (z1 - z0) / 2, heading: p.az * Math.PI / 180 };
  }
  /**
   * The baked boxes that the models replace, by position (bake ids can change). A split building is a group: only
   * its largest wing carries the original site, so one wing on the spot takes the whole group with it. Only the
   * drawing leaves them out: they stay properties (mail customers, the route), as the porch house does.
   */
  replaced(list: Building[]): Set<number> {
    const spots = Object.values(P).flatMap(p => p.replaces ? [p.replaces] : []);
    const onSpot = (b: Building) => { const c = b.site ?? b; return spots.some(([e, n]) => (c.x - e) ** 2 + (c.y - n) ** 2 <= 6 ** 2); };
    return new Set(list.filter(onSpot).map(b => b.buildingId ?? b.id));
  }
  drawn(list: Building[]): Building[] {
    const groups = this.replaced(list);
    return list.filter(b => !groups.has(b.buildingId ?? b.id));
  }
}
