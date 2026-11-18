import type { Building } from './buildings';
import type { Solid } from './parked';

/**
 * The heart of Judique on Highway 19, built by hand from the public-safe dash cam brief (the project brief):
 * the stone church, the music centre, the community centre and its lot, the mansard house, the store with its
 * mailbox bank, and the service garage. Positions are EPSG:2961 (lidar and baked footprints); nothing is read from
 * pictures. No names, sign words or numbers are drawn.
 *
 * A place has a local frame: +x runs along compass azimuth `az`, +z along az + 90 degrees, +y is up.
 */
export interface VillagePlace {
  e: number; n: number; az: number;
  /** The baked box that this model replaces: its stored site (the largest wing of a split building). */
  replaces: [number, number] | null;
  /** Local footprint rectangles [x0, x1, z0, z1]: collision, and the tree layer is cleared under them. */
  rects: [number, number, number, number][];
}

export const VILLAGE_PLACES = {
  // Nave E 617113.5-617137.5, N 5081678-5081692; the axis of the baked outline is 95 degrees, the front faces west.
  church: { e: 617125.8, n: 5081684.6, az: 275, replaces: [617126.6, 5081683.9],
    rects: [[-12, 12, -6.75, 6.75], [12, 16.6, -2.9, 2.9], [-16, -12, -7, 7], [16.6, 32.6, -2.9, 4.8]] },
  // Baked outline 65: long side to the north-east (towards the highway), turret at the south-east corner.
  music: { e: 617075.0, n: 5081537.0, az: 315, replaces: [617075.0, 5081537.0],
    rects: [[-16, 16, -10.4, 10.4], [-17.2, -9.6, 3.8, 11.2], [-3.5, 3.5, 10.4, 12.0]] },
  // Baked outline 4 (split into 4, 1115, 1116): hall north-south, a cross wing at the south end facing east.
  hall: { e: 617029.3, n: 5081588.6, az: 355, replaces: [617029.3, 5081588.6],
    rects: [[-17, 17, -8.1, 8.1], [-14.6, -2.6, -13.3, 14.7], [-11.2, -6.0, 14.7, 17.4]] },
  // Lidar body E 617136-617152, N 5081636-5081648: main block facing west, a short ell east. The mapped driveway
  // loop (tracks 853/860) runs round it, so the house is fitted inside the loop.
  mansard: { e: 617140.8, n: 5081642.2, az: 180, replaces: [617145.3, 5081641.7],
    rects: [[-5.5, 5.5, -4.8, 4.8], [-3, 3, -8.4, -4.8], [-1.4, 1.4, 4.8, 7.0]] },
  // Baked outline 10 (with 1118, 1119): gable end to the highway (east).
  store: { e: 617107.2, n: 5081472.6, az: 79, replaces: [617107.2, 5081472.6],
    rects: [[-11.2, 11.2, -4.4, 4.4], [-11.2, -4.5, 4.4, 9.4], [-11.2, -6.5, -8.2, -4.4], [-1.7, 5.05, -6.35, -4.4]] },
  // Baked outline 42: bay doors face the highway (west).
  garage: { e: 617181.4, n: 5081286.0, az: 266, replaces: [617181.4, 5081286.0],
    rects: [[-9.65, 9.65, -6.7, 6.7]] },
} satisfies Record<string, VillagePlace>;
export type PlaceName = keyof typeof VILLAGE_PLACES;

/** Small things on their own map points (their own frames are set in the model). */
export const VILLAGE_ITEMS = {
  monument: [617108.0, 5081645.0],
  churchSign: [617099.5, 5081703.5],
  gazebo: [617167.0, 5081554.0],
  welcomeSign: [617109.0, 5081600.5],
  musicSign: [617104.5, 5081540.0],
  mailboxes: [617095.0, 5081493.0],
  hydrant: [617094.6, 5081601.0],
  lotLamp: [617070.0, 5081598.0],
  shelters: [[617050.5, 5081623.5], [617057.5, 5081624.0]],
  noticeBoard: [617044.8, 5081617.5],
  /** The post-and-rail fence on the lot's north edge, west to east. */
  lotFence: [[617042.5, 5081629.5], [617064.0, 5081628.8], [617086.5, 5081627.8]],
  propaneTanks: [617166.0, 5081272.5],
  garageSign: [617158.5, 5081299.5],
  garageLamps: [[617163.5, 5081276.5], [617164.5, 5081296.0]],
  evPosts: [[617082.0, 5081512.4], [617086.5, 5081512.0]],
} as const;
/** The store's community mailbox bank: cabinets in one row, 0.88 m apart (the owner counted ten, 17 Nov). */
export const MAILBOX_CABINETS = 10;


/** The red sandstone retaining wall along the road edge in front of the church, south to north (map points): two
 *  runs, with the stair gap between them opposite the tower door. Both ends curve in towards the church. */
export const CHURCH_WALL: [number, number][][] = [
  [[617099.4, 5081661.0], [617096.4, 5081664.0], [617095.6, 5081670.0], [617095.3, 5081676.0], [617095.2, 5081682.0], [617095.2, 5081685.6]],
  [[617095.2, 5081689.0], [617095.3, 5081694.0], [617095.6, 5081699.5], [617097.8, 5081702.6]],
];

export function toMap(p: VillagePlace, x: number, z: number): [number, number] {
  const a = p.az * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  return [p.e + x * s + z * c, p.n + x * c - z * s];
}

/** Which small things are built with which place (their land must be fine before the place builds). */
const ITEMS_OF: Record<string, (readonly number[])[]> = {
  church: [...[[617095.2, 5081687.3]], VILLAGE_ITEMS.monument, VILLAGE_ITEMS.churchSign],
  music: [VILLAGE_ITEMS.musicSign, ...VILLAGE_ITEMS.evPosts],
  hall: [...VILLAGE_ITEMS.lotFence, ...VILLAGE_ITEMS.shelters, VILLAGE_ITEMS.noticeBoard, VILLAGE_ITEMS.lotLamp, VILLAGE_ITEMS.hydrant],
  mansard: [VILLAGE_ITEMS.gazebo, VILLAGE_ITEMS.welcomeSign],
  store: [VILLAGE_ITEMS.mailboxes],
  garage: [VILLAGE_ITEMS.garageSign, VILLAGE_ITEMS.propaneTanks, ...VILLAGE_ITEMS.garageLamps],
};
/** Map points under each place and its small things, for the build gate. */
export function placePoints(name: PlaceName): (readonly number[])[] {
  const p = VILLAGE_PLACES[name] as VillagePlace;
  return [[p.e, p.n], ...p.rects.flatMap(r => [toMap(p, r[0], r[2]), toMap(p, r[1], r[3]), toMap(p, r[0], r[3]), toMap(p, r[1], r[2])]),
    ...ITEMS_OF[name], ...(name === 'church' ? CHURCH_WALL.flat() : [])];
}

export { CORNER_SLACK, strips } from './site-solids';
import { strips } from './site-solids';

export class JudiqueVillageSite {
  readonly clear: number[][] = [];
  readonly solids: Solid[] = [];
  /** World centre and reach of everything here, for the build trigger and contact tests. */
  readonly centre: { x: number; z: number };
  readonly reach = 380;
  constructor(readonly village: readonly [number, number]) {
    this.centre = { x: 617110 - village[0], z: village[1] - 5081560 };
    for (const p of Object.values(VILLAGE_PLACES) as VillagePlace[]) for (const r of p.rects) {
      this.solids.push(this.rect(p, ...r));
      const corners = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([x, z]) => this.world(...toMap(p, x, z)));
      const xs = corners.map(c => c.x), zs = corners.map(c => c.z);
      this.clear.push([Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2]);
    }
    for (const run of CHURCH_WALL) for (let i = 1; i < run.length; i++) this.solids.push(this.segment(run[i - 1], run[i], 0.3));
    const fence = VILLAGE_ITEMS.lotFence;
    for (let i = 1; i < fence.length; i++) this.solids.push(this.segment(fence[i - 1], fence[i], 0.1));
    const at = (e: number, n: number, half: number, halfWidth = half, heading = 0): Solid => ({ ...this.world(e, n), half, halfWidth, heading });
    const items = VILLAGE_ITEMS;
    this.solids.push(at(items.monument[0], items.monument[1], 0.7), at(items.gazebo[0], items.gazebo[1], 2.4),
      at(items.mailboxes[0], items.mailboxes[1], MAILBOX_CABINETS * 0.44 + 0.21, 0.6, 350 * Math.PI / 180), at(items.musicSign[0], items.musicSign[1], 1.9, 0.75, 345 * Math.PI / 180),
      at(items.propaneTanks[0], items.propaneTanks[1], 2.2, 2.8), at(items.noticeBoard[0], items.noticeBoard[1], 0.9, 0.3, Math.PI / 2),
      ...items.shelters.map(([e, n]) => at(e, n, 1.6, 1.3)),
      // Poles, posts and signs: thin, but a car should not pass through them.
      ...[items.lotLamp, items.garageSign, ...items.garageLamps, ...items.evPosts].map(([e, n]) => at(e, n, 0.3)),
      at(items.welcomeSign[0], items.welcomeSign[1], 1.35, 0.25, 80 * Math.PI / 180), at(items.churchSign[0], items.churchSign[1], 1.2, 0.25, 5 * Math.PI / 180));
    // The mailbox bank's pad clears trees (and the invented driveway) like a building does, with a metre to stand in.
    const bank = at(items.mailboxes[0], items.mailboxes[1], MAILBOX_CABINETS * 0.44 + 0.21, 0.6, 350 * Math.PI / 180);
    const bankReach = Math.abs(bank.half * Math.cos(bank.heading)) + Math.abs(bank.halfWidth * Math.sin(bank.heading)) + 1;
    const bankDepth = Math.abs(bank.half * Math.sin(bank.heading)) + Math.abs(bank.halfWidth * Math.cos(bank.heading)) + 1;
    this.clear.push([bank.x - bankDepth, bank.z - bankReach, bank.x + bankDepth, bank.z + bankReach]);
    this.solids.splice(0, this.solids.length, ...this.solids.flatMap(strips));
  }
  world(e: number, n: number): { x: number; z: number } { return { x: e - this.village[0], z: this.village[1] - n }; }
  private rect(p: VillagePlace, x0: number, x1: number, z0: number, z1: number): Solid {
    const [e, n] = toMap(p, (x0 + x1) / 2, (z0 + z1) / 2);
    return { ...this.world(e, n), half: (x1 - x0) / 2, halfWidth: (z1 - z0) / 2, heading: p.az * Math.PI / 180 };
  }
  private segment(a: readonly number[], b: readonly number[], halfWidth: number): Solid {
    return { ...this.world((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), half: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, halfWidth,
      heading: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  }
  /**
   * Leave out the baked boxes that the models replace, by position (bake IDs can change). A split building is a
   * group: only its largest wing carries the original site, so one wing on the spot takes the whole group with it.
   */
  buildings(list: Building[]): Building[] {
    const spots = (Object.values(VILLAGE_PLACES) as VillagePlace[]).flatMap(p => p.replaces ? [p.replaces] : []);
    const onSpot = (b: Building) => { const c = b.site ?? b; return spots.some(([e, n]) => (c.x - e) ** 2 + (c.y - n) ** 2 <= 6 ** 2); };
    const groups = new Set(list.filter(onSpot).map(b => b.buildingId ?? b.id));
    return list.filter(b => !onSpot(b) && !groups.has(b.buildingId ?? b.id));
  }
}
