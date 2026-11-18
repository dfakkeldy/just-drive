import type { Building } from './buildings';
import type { Solid } from './parked';
import { strips } from './site-solids';
import { seeded } from './site-kit';

/**
 * Port Hawkesbury from the public-safe dash cam brief (the project brief): the hardware and auto store front, the car
 * dealers, the two gas bars, the corner garage, and the furniture of the big lots (stall lines, fire lanes, accessible
 * stalls, light poles, row-end islands, teardrops, curbs, cart corrals). Positions are EPSG:2961 from the brief, the
 * game's own footprints and the NSTDB lot polygons; nothing is read from pictures. Every sign is blank: no names, sign
 * words, numbers or brand colours.
 *
 * A place has a local frame: +x runs along compass azimuth `az`, +z along az + 90 degrees, +y is up.
 */
export type P2 = [number, number];
export function toMap(p: { e: number; n: number; az: number }, x: number, z: number): P2 {
  const a = p.az * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  return [p.e + x * s + z * c, p.n + x * c - z * s];
}
export interface PhPlace {
  e: number; n: number; az: number;
  /** Baked boxes these models replace, by their stored site (the largest wing of a split building). */
  replaces: P2[];
  /** Local footprint rectangles [x0, x1, z0, z1]: collision, tree clearing, and no stall is painted on them. */
  rects: [number, number, number, number][];
  /** Further local rectangles kept free of lot paint (a canopy's sales floor, cart bays), not solid. */
  unpainted?: [number, number, number, number][];
}

export const PH_PLACES = {
  // Game 36, 86.6 x 38.2 m. x runs west-north-west along the long side; the front (+z) faces 25 degrees, to Reeves St.
  hardware: { e: 628241.01, n: 5052612.96, az: 295, replaces: [[628241.01, 5052612.96]],
    rects: [[-43.3, 43.3, -19.1, 19.1], [3.4, 19.8, 19.1, 20.7]], unpainted: [[23, 43.3, 19.1, 26.1], [0.2, 3.4, 19.1, 21.4], [19.8, 22.9, 19.1, 21.4]] },
  // The plaza gas bar in the notch of the plaza lot, replacing game 398 (a house guessed from the map). +z faces Reeves St.
  gasBar: { e: 628482, n: 5052627, az: 115, replaces: [[628494.0, 5052628.32]], rects: [[4, 16, -11, -3.5]] },
  // Game 103 with its wings 3073 and 3074: the showroom at the west end, the service wing behind. +z faces Paint St.
  dealerA: { e: 629993.67, n: 5052957.48, az: 109, replaces: [[629993.67, 5052957.48]],
    rects: [[-29, -9.7, -14.6, 16.8], [-9.7, 5.3, -14.2, -6.9], [5.3, 31.7, -14.1, -1.4]] },
  // Game 1991 (an OSM guess, 46 x 37 m): the second dealer; its showroom (-x) faces Paint St to the west. Its west face
  // stands at x = -19.5, clear of the lidar building 2383 at its north-west corner (kept).
  dealerB: { e: 630095.25, n: 5052850.71, az: 98, replaces: [[630095.25, 5052850.71]], rects: [[-19.5, 23, -18.5, 18.5]] },
  // The east gas station on the unpaved lot P12: canopy facing south-south-west, kiosk behind it.
  eastGas: { e: 630027, n: 5053046, az: 110, replaces: [], rects: [[-6, 6, -20, -12]] },
  // Game 1133, the corner garage: x runs north-north-east along Sydney Rd, -z (west) faces the road, -x faces Granville St.
  garage: { e: 628217.94, n: 5052158.02, az: 27, replaces: [[628217.94, 5052158.02]], rects: [[-9.7, 9.7, -6.1, 6.1]] },
} satisfies Record<string, PhPlace>;
export type PlaceName = keyof typeof PH_PLACES;

export function toLocal(p: { e: number; n: number; az: number }, e: number, n: number): P2 {
  const a = p.az * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), de = e - p.e, dn = n - p.n;
  return [de * s + dn * c, de * c - dn * s];
}

/** Blank pylons: map point, the azimuth of their drawn frame's +x (it runs across the face; the face looks along az ± 90), the
 *  half sizes of their solid body along x and z of that frame. The drawing and the solid both read this table. */
export interface Sign { at: P2; az: number; half: number; halfWidth: number }
export const PH_SIGNS = {
  /** The hardware store's pylon (a white box on two posts with a reader board) at the lot's west entrance. */
  hardwarePylon: { at: [628190, 5052667], az: 25, half: 2.4, halfWidth: 0.6 },
  /** The plaza's multi-tenant pylon. */
  plazaPylon: { at: [628455, 5052655], az: 24, half: 1.8, halfWidth: 0.5 },
  /** The tall white pylon of the first dealer (in its planted bed) and the dark slab pylon of the second. */
  dealerAPylon: { at: [629944, 5052967], az: 109, half: 0.8, halfWidth: 0.45 },
  dealerBPylon: { at: toMap({ e: 630095.25, n: 5052850.71, az: 98 }, -38.5, 12), az: 98, half: 1.25, halfWidth: 0.32 },
  /** The big-box store's pylon at the lot entrance from Highway 4 (the store is in the land). The brief's point
   *  (629800, 5052725) is 1.4 m from the store's west block (3222) in the land with big_buildings, so it stands 17 m
   *  south-west of it, clear of the block. */
  bigBoxPylon: { at: [629792, 5052710], az: 60, half: 2.3, halfWidth: 0.45 },
} satisfies Record<string, Sign>;
/** Small things on their own map points. */
export const PH_ITEMS = {
  hardwareHydrant: [628281.4, 5052675.8] as P2,
  /** Wooden utility poles with cobra heads at the garage corner (the lot's south-west corner, and across Sydney Rd), and
   *  the azimuth of each arm (toward Sydney Rd). */
  garageLamps: [[628186, 5052146], [628196.5, 5052186]] as P2[],
  garageLampArms: [322, 114],
};
/** Radius (m) kept free of stall paint round each item. */
const ITEM_CLEAR = 3;

// ---- lots ----------------------------------------------------------------------------------------------------------
/**
 * A big lot. `rings`: the NSTDB polygon with the lidar and game outlines cut out (outer ring first, then holes).
 * Stalls (2.7 x 5.5 m) stand in double rows with 7 m aisles; their lines run along `az`, the direction away from the
 * store front at `anchor`. Lot positions in (w, u): w along az, u along az + 90 degrees, metres from the anchor.
 */
export interface LotSpec {
  rings: P2[][]; az: number; anchor: P2;
  /** w of the first stall band (after the fire lane along the store front). */
  start: number;
  paint: 'yellow' | 'white';
  pole: { h: number; heads: 1 | 2 | 3 | 4; curved?: boolean };
  /** Minimum spacing between light poles (m). */
  spacing: number;
  fireLane: boolean;
  /** Accessible stalls start nearest this lot point (w, u). */
  accessible?: P2;
  /** Cart corrals (open rails) and cart shelters (roofed), at the stall nearest each lot point. */
  corrals?: P2[]; shelters?: P2[];
  /** The arched canopy corral (plaza). */
  arched?: P2[];
  /** Raised curbed teardrop islands at the entrances: lot point (w, u) and length along w. */
  teardrops?: [number, number, number][];
  /** Parked vehicles: full near `near` (lot point), thinning with distance. `display`: a dealer's full rows. */
  occupancy: { near: P2; peak: number; reach: number; display?: boolean };
  seed: number;
}

const RINGS: Record<string, P2[][]> = {
  P2: [[[629839.0, 5052958.0], [629906.0, 5052934.0], [629909.0, 5052945.0], [629918.0, 5052942.0], [629923.0, 5052940.0], [629921.0, 5052929.0], [629946.0, 5052920.0], [629948.0, 5052926.0], [629955.0, 5052926.0], [629956.0, 5052922.0], [629972.0, 5052916.0], [629974.0, 5052920.0], [629979.0, 5052917.0], [630049.0, 5052890.0], [630069.0, 5052877.0], [630071.0, 5052871.0], [630075.0, 5052872.0], [630075.0, 5052863.0], [630069.0, 5052861.0], [630067.0, 5052837.0], [630069.0, 5052826.0], [630011.0, 5052752.0], [630009.0, 5052755.0], [630000.0, 5052747.0], [629992.0, 5052749.0], [629986.0, 5052752.0], [629906.0, 5052733.0], [629890.0, 5052740.0], [629824.0, 5052737.0], [629778.0, 5052747.0], [629777.0, 5052750.0], [629763.0, 5052754.0], [629774.0, 5052809.0], [629781.0, 5052814.0], [629777.0, 5052819.0], [629777.0, 5052833.0], [629786.0, 5052860.0], [629804.0, 5052888.0], [629815.0, 5052906.0]],
    [[629825.2, 5052763.1], [629810.6, 5052776.9], [629806.7, 5052789.5], [629803.6, 5052792.2], [629798.9, 5052794.5], [629796.2, 5052799.5], [629799.4, 5052806.4], [629809.9, 5052809.0], [629814.2, 5052813.9], [629856.3, 5052835.8], [629871.1, 5052840.9], [629880.1, 5052845.1], [629887.6, 5052847.6], [629895.2, 5052855.3], [629917.5, 5052867.5], [629935.6, 5052874.5], [629953.6, 5052883.4], [629960.6, 5052883.7], [629964.6, 5052887.3], [629975.4, 5052892.3], [629980.6, 5052890.5], [629982.2, 5052884.7], [629986.7, 5052881.6], [629986.4, 5052877.1], [629991.3, 5052877.4], [629994.4, 5052876.7], [629996.6, 5052871.3], [630004.4, 5052868.5], [630020.5, 5052836.5], [630023.1, 5052826.8], [630028.3, 5052818.0], [630025.3, 5052817.4], [630023.5, 5052810.4], [630012.3, 5052808.3], [629983.4, 5052793.7], [629961.4, 5052786.4], [629928.4, 5052765.0], [629912.6, 5052761.5], [629901.4, 5052755.5], [629888.0, 5052753.3], [629878.0, 5052753.3], [629871.8, 5052749.4], [629853.0, 5052754.0], [629834.5, 5052756.3], [629832.5, 5052760.1], [629828.0, 5052759.8]]],
  P3: [[[629918.0, 5053046.0], [629901.0, 5053052.0], [629902.0, 5053055.0], [629852.0, 5053074.0], [629844.0, 5053075.0], [629841.0, 5053063.0], [629818.0, 5053072.0], [629815.0, 5053062.0], [629818.0, 5053052.0], [629838.0, 5052985.0], [629842.0, 5052979.0], [629931.0, 5052949.0], [629936.0, 5052949.0], [629958.0, 5052994.0], [629959.0, 5052999.0], [629946.0, 5053016.0], [629949.0, 5053024.0], [629949.0, 5053034.0], [629930.0, 5053041.0], [629927.0, 5053038.0], [629920.0, 5053038.0], [629918.0, 5053041.0], [629918.0, 5053046.0]]],
  P4: [[[630032.0, 5053035.0], [630082.7, 5053014.6], [630082.9, 5053012.5], [630098.0, 5053006.7], [630098.0, 5053006.0], [630132.6, 5052993.4], [630133.0, 5052992.0], [630127.0, 5052987.0], [630101.0, 5052958.0], [630074.0, 5052925.0], [630061.0, 5052920.0], [630051.0, 5052928.0], [630034.0, 5052911.0], [630028.0, 5052898.0], [630015.0, 5052890.0], [630010.0, 5052893.0], [629937.0, 5052919.0], [629948.0, 5052939.0], [629961.0, 5052961.0], [629972.0, 5052994.0], [629978.0, 5053004.0], [629986.0, 5053013.0]],
    [[629959.9, 5052951.5], [629969.9, 5052983.5], [629989.6, 5052976.7], [630028.4, 5052963.5], [630024.3, 5052948.4], [630017.3, 5052931.4]]],
  P5: [[[628516.0, 5052638.0], [628480.0, 5052650.0], [628468.0, 5052647.0], [628450.0, 5052603.0], [628407.0, 5052623.0], [628398.0, 5052608.0], [628387.0, 5052612.0], [628372.0, 5052647.0], [628351.0, 5052633.0], [628338.0, 5052628.0], [628333.0, 5052636.0], [628325.0, 5052639.0], [628309.0, 5052673.0], [628326.0, 5052679.0], [628329.0, 5052676.0], [628332.0, 5052676.0], [628334.0, 5052672.0], [628341.0, 5052674.0], [628352.0, 5052678.0], [628351.0, 5052681.0], [628364.0, 5052687.0], [628371.0, 5052721.0], [628364.0, 5052745.0], [628358.0, 5052749.0], [628347.0, 5052767.0], [628342.0, 5052770.0], [628341.0, 5052775.0], [628350.0, 5052782.0], [628363.0, 5052784.0], [628370.0, 5052779.0], [628387.0, 5052789.0], [628418.0, 5052770.0], [628418.0, 5052768.0], [628450.0, 5052754.0], [628454.0, 5052756.0], [628483.0, 5052744.0], [628487.0, 5052740.0], [628492.0, 5052740.0], [628538.0, 5052719.0], [628554.0, 5052684.0], [628548.0, 5052681.0]],
    [[628463.2, 5052715.0], [628348.4, 5052767.1], [628379.3, 5052835.7], [628494.0, 5052783.2], [628463.2, 5052715.0]]],
  P6: [[[628271.0, 5052673.0], [628277.0, 5052685.0], [628289.0, 5052680.0], [628282.0, 5052668.0], [628337.0, 5052642.0], [628334.0, 5052635.0], [628338.0, 5052633.0], [628325.0, 5052604.0], [628321.0, 5052604.0], [628294.0, 5052542.0], [628268.0, 5052553.0], [628290.0, 5052605.0], [628287.0, 5052610.0], [628288.0, 5052612.0], [628210.0, 5052649.0], [628204.0, 5052646.0], [628200.0, 5052648.0], [628200.0, 5052652.0], [628214.0, 5052680.0], [628225.0, 5052679.0], [628257.0, 5052665.0]]],
};

const YELLOW = 'yellow', WHITE = 'white';
export const PH_LOTS = {
  // The big-box lot: rows perpendicular to the store front (lines along 150-330 degrees), clusters of heads.
  P2: { rings: RINGS.P2, az: 330, anchor: [629889.5, 5052847], start: 8.5, paint: YELLOW, pole: { h: 11.5, heads: 3 }, spacing: 32, fireLane: true,
    accessible: [9, -6], corrals: [[30, -40], [30, 30], [66, -10]], occupancy: { near: [10, 0], peak: 0.55, reach: 70 }, seed: 2 },
  // The east-plaza grocery lot: double yellow lines along 20-200 degrees, one head on a 10 m pole about 25 m apart.
  P3: { rings: RINGS.P3, az: 200, anchor: [629889, 5053064], start: 8.5, paint: YELLOW, pole: { h: 10, heads: 1 }, spacing: 25, fireLane: true,
    accessible: [9, -3], shelters: [[28, -20], [28, 18]], occupancy: { near: [10, 0], peak: 0.7, reach: 55 }, seed: 3 },
  // The first dealer's display lot: rows nose-in to Paint St, white lines, every space taken.
  P4: { rings: RINGS.P4, az: 21, anchor: [629987.2, 5052938.6], start: -24, paint: WHITE, pole: { h: 9, heads: 2 }, spacing: 28, fireLane: false,
    occupancy: { near: [0, 0], peak: 0.92, reach: 400, display: true }, seed: 4 },
  // The Reeves St plaza lot: yellow, along 24-204 degrees, 12 m poles with two flat heads.
  P5: { rings: RINGS.P5, az: 204, anchor: [628405.5, 5052741], start: 8.5, paint: YELLOW, pole: { h: 12, heads: 2 }, spacing: 30, fireLane: true,
    accessible: [9, 4], arched: [[40, -10]], occupancy: { near: [10, 0], peak: 0.6, reach: 60 }, seed: 5 },
  // The hardware store lot: perpendicular stalls along 25-205 degrees, 12 m poles with one curved arm, teardrops.
  P6: { rings: RINGS.P6, az: 25, anchor: [628249.08, 5052630.27], start: 8.5, paint: YELLOW, pole: { h: 12, heads: 1, curved: true }, spacing: 30, fireLane: true,
    accessible: [9, -11.6], corrals: [[30, -2]], teardrops: [[44, 7.6, 8], [22, -50, 7]], occupancy: { near: [10, -11.6], peak: 0.6, reach: 55 }, seed: 6 },
} satisfies Record<string, LotSpec>;
export type LotName = keyof typeof PH_LOTS;

/** Asphalt and concrete pads drawn over grass where a forecourt has no lot polygon: [place, x0, x1, z0, z1, kind]. */
export const PH_PADS: [PlaceName, number, number, number, number, 'asphalt' | 'concrete'][] = [
  ['gasBar', -15, 20, -14, 15, 'asphalt'], ['gasBar', -9, 9, 0.5, 11.5, 'concrete'],
  ['eastGas', -20, 20, -24, 14, 'asphalt'], ['eastGas', -9, 9, -4.5, 6.5, 'concrete'],
  ['dealerB', -37.5, -19.5, -7, 18.5, 'asphalt'], ['dealerB', -19.5, 23, 18.5, 26, 'asphalt'],
];
/** The corner garage's apron (the brief's P1, from the road offsets; its Sydney Rd edge pulled in 0.6 m off the
 *  carriageway), as convex map quads hugging the garage model.
 *  The land builder paves P1; until the paved layer has it, this asphalt is drawn (a quad over paved ground is left out). */
const G = (x: number, z: number) => toMap(PH_PLACES.garage, x, z);
export const GARAGE_APRON: P2[][] = [
  [[628194.5, 5052162.7], [628205.5, 5052181.7], G(9.7, -6.1), G(-9.7, -6.1)],
  [[628180.5, 5052149.7], [628194.5, 5052162.7], G(-9.7, -6.1), [628208, 5052133]],
  [[628208, 5052133], G(-9.7, -6.1), G(-9.7, 6.1), G(-9.7, 6.1)],
  [[628205.5, 5052181.7], [628229, 5052168], G(9.7, 6.1), G(9.7, -6.1)],
];
/** Vehicles that belong to a place, not a lot: [place, x, z, azimuth offset from the place's, type, colour]. */
export const PLACE_VEHICLES: [PlaceName, number, number, number, 0 | 1 | 2, number][] = [
  // The garage: nose-in to the west wall by the office, and a row along the Sydney Rd edge.
  ['garage', -5.3, -9.4, 90, 2, 0x1b1c1e], ['garage', -8.2, -9.2, 90, 0, 0xb4b7b9],
  // (Not north of the garage: the land's P1 leaves that strip as grass, as the brief allows.)
  ['garage', -4.5, -15.5, 0, 1, 0x7a1f1c], ['garage', 1.5, -15.8, 0, 2, 0xd9d9d4],
  // The second dealer's display rows on its forecourt, nose to Paint St.
  ...[-34, -27.5].flatMap(x => [-5.5, -2.4, 0.7, 3.8, 6.9, 10, 13.1, 16.2].map((z, i) =>
    ['dealerB', x, z, 180, ((i + (x > -30 ? 1 : 0)) % 3) as 0 | 1 | 2, [0xd9d9d4, 0x1b1c1e, 0xb4b7b9, 0x7a1f1c, 0x24364f][(i + (x > -30 ? 2 : 0)) % 5]] as [PlaceName, number, number, number, 0 | 1 | 2, number])),
];

/** What builds together: each group is one build and one mesh per surface pattern. */
export const PH_GROUPS = {
  reeves: { places: ['hardware'], lots: ['P6'], items: [PH_SIGNS.hardwarePylon.at, PH_ITEMS.hardwareHydrant] },
  plaza: { places: ['gasBar'], lots: ['P5'], items: [PH_SIGNS.plazaPylon.at] },
  eastNorth: { places: ['dealerA', 'eastGas'], lots: ['P3', 'P4'], items: [PH_SIGNS.dealerAPylon.at] },
  eastSouth: { places: ['dealerB'], lots: ['P2'], items: [PH_SIGNS.dealerBPylon.at, PH_SIGNS.bigBoxPylon.at] },
  garage: { places: ['garage'], lots: [], items: [...PH_ITEMS.garageLamps, ...GARAGE_APRON.flat()] },
} satisfies Record<string, { places: PlaceName[]; lots: LotName[]; items: P2[] }>;
export type GroupName = keyof typeof PH_GROUPS;

// ---- plane geometry ------------------------------------------------------------------------------------------------
export function inRing(p: P2, ring: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function inLot(p: P2, rings: P2[][]): boolean { return inRing(p, rings[0]) && !rings.slice(1).some(h => inRing(p, h)); }
export function segDist(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** A building's outline in map metres (its own footprint, or the box from its centre, axis and size). */
export function outline(b: Building): P2[] {
  if (b.footprint && b.footprint.length >= 3) return b.footprint as P2[];
  const a = b.axisDeg * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a), l = b.length / 2, w = b.width / 2;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([s, t]) => [b.x + ux * l * s + uy * w * t, b.y + uy * l * s - ux * w * t] as P2);
}

/** The paved layer's class tiles (2 m cells, 256 m tiles, named i_j from the origin), as the game and the bake read them. */
export const PAVED_ORIGIN: P2 = [591500, 5103332];
export const PAVED_TILE = 256, PAVED_RES = 2, PAVED_SIDE = 128;
export function pavedKeys(box: [number, number, number, number]): string[] {
  const keys: string[] = [];
  for (let i = Math.floor((box[0] - PAVED_ORIGIN[0]) / PAVED_TILE); i <= Math.floor((box[2] - PAVED_ORIGIN[0]) / PAVED_TILE); i++)
    for (let j = Math.floor((PAVED_ORIGIN[1] - box[3]) / PAVED_TILE); j <= Math.floor((PAVED_ORIGIN[1] - box[1]) / PAVED_TILE); j++) keys.push(`${i}_${j}`);
  return keys;
}
/** A paved test over loaded tiles (a missing tile is unpaved). */
export function pavedTest(tiles: Map<string, Uint8Array | null>): (p: P2) => boolean {
  return ([e, n]) => {
    const fi = (e - PAVED_ORIGIN[0]) / PAVED_TILE, fj = (PAVED_ORIGIN[1] - n) / PAVED_TILE, i = Math.floor(fi), j = Math.floor(fj);
    const t = tiles.get(`${i}_${j}`);
    if (!t) return false;
    const c = Math.floor((fi - i) * PAVED_SIDE), r = Math.floor((fj - j) * PAVED_SIDE);
    return t[r * PAVED_SIDE + c] === 1;
  };
}

/** Map roads in a lot's neighbourhood: segments with the half width of their carriageway. */
export interface MapRoad { pts: P2[]; halfWidth: number }
/** Roads and outlines bucketed in 16 m cells, so the thousands of paint tests of a big lot each look at a few. */
const CELL = 16, REACH = 2;
export class Clearance {
  private segs = new Map<string, [P2, P2, number][]>();
  private shapes = new Map<string, { ring: P2[]; box: [number, number, number, number] }[]>();
  constructor(box: [number, number, number, number], roads: MapRoad[], buildings: Building[], private circles: [number, number, number][] = [], readonly paved: (p: P2) => boolean = () => true) {
    const [e0, n0, e1, n1] = box, pad = CELL * REACH;
    for (const r of roads) for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      if (Math.max(a[0], b[0]) < e0 - pad || Math.min(a[0], b[0]) > e1 + pad || Math.max(a[1], b[1]) < n0 - pad || Math.min(a[1], b[1]) > n1 + pad) continue;
      this.put(this.segs, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], 0, [a, b, r.halfWidth]);
    }
    for (const b of buildings) {
      const ring = outline(b), xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
      const bb: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      if (bb[2] < e0 - 5 || bb[0] > e1 + 5 || bb[3] < n0 - 5 || bb[1] > n1 + 5) continue;
      this.put(this.shapes, bb, 2, { ring, box: bb });
    }
  }
  private put<T>(grid: Map<string, T[]>, [e0, n0, e1, n1]: number[], grow: number, item: T): void {
    for (let i = Math.floor((e0 - grow) / CELL); i <= Math.floor((e1 + grow) / CELL); i++) for (let j = Math.floor((n0 - grow) / CELL); j <= Math.floor((n1 + grow) / CELL); j++) {
      const k = `${i}_${j}`, list = grid.get(k); if (list) { if (!list.includes(item)) list.push(item); } else grid.set(k, [item]);
    }
  }
  addShape(ring: P2[]): void {
    const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]), bb: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    this.put(this.shapes, bb, 2, { ring, box: bb });
  }
  /** Metres from a point to the nearest carriageway edge (negative on it), looked for within 32 m (farther: 32). */
  roadGap(p: P2): number {
    let best = CELL * REACH;
    const i0 = Math.floor(p[0] / CELL), j0 = Math.floor(p[1] / CELL);
    for (let i = i0 - REACH; i <= i0 + REACH; i++) for (let j = j0 - REACH; j <= j0 + REACH; j++)
      for (const [a, b, hw] of this.segs.get(`${i}_${j}`) ?? []) best = Math.min(best, segDist(p, a, b) - hw);
    return best;
  }
  /** Inside a building outline or a model, or within `margin` (at most 2 m) of one. */
  built(p: P2, margin: number): boolean {
    for (const s of this.shapes.get(`${Math.floor(p[0] / CELL)}_${Math.floor(p[1] / CELL)}`) ?? []) {
      if (p[0] < s.box[0] - margin || p[0] > s.box[2] + margin || p[1] < s.box[1] - margin || p[1] > s.box[3] + margin) continue;
      if (inRing(p, s.ring)) return true;
      for (let i = 0; i < s.ring.length; i++) if (segDist(p, s.ring[i], s.ring[(i + 1) % s.ring.length]) < margin) return true;
    }
    return false;
  }
  item(p: P2): boolean { return this.circles.some(([e, n, r]) => Math.hypot(p[0] - e, p[1] - n) < r); }
  /** Free to paint: not on a road (with `road` metres of margin), not on or within `margin` of a building. */
  free(p: P2, road = 1, margin = 1): boolean { return this.roadGap(p) > road && !this.built(p, margin) && !this.item(p); }
}

export type CellKind = 'stall' | 'island' | 'accessible' | 'aisle' | 'corral' | 'shelter' | 'arched';
export interface Cell { band: number; j: number; w0: number; w1: number; u0: number; u1: number; kind: CellKind; parked?: { type: 0 | 1 | 2; colour: number; nose: number } }
/** Body length by type (parked.ts PARKED_SIZE). */
const LENGTH = [4.5, 4.7, 5.7];
/** A parked vehicle's centre in its stall (lot w, u) and azimuth: pulled toward the row's back line, but never so far
 *  that it passes the line (a pickup is longer than the stall, so it stands centred and a little out). */
export function parkedPose(lot: LotSpec, c: Cell): { w: number; u: number; az: number } {
  const p = c.parked!, shift = Math.min(0.25, (STALL_D - LENGTH[p.type]) / 2 - 0.05);
  const back = c.band % 2 === 0 ? 1 : -1;   // the row's shared back line: band A's far edge, band B's near edge
  return { w: (c.w0 + c.w1) / 2 + back * shift, u: (c.u0 + c.u1) / 2, az: lot.az + (p.nose > 0 ? 0 : 180) };
}
/** Solids of a lot's own furniture: every light pole and every corral or shelter (islands and curbs are mountable). */
export function lotSolids(lot: LotSpec, layout: LotLayout, world: (e: number, n: number) => { x: number; z: number }): Solid[] {
  const out: Solid[] = [], h = lot.az * Math.PI / 180;
  for (const [w, u] of layout.poles) out.push({ ...world(...lotToMap(lot, w, u)), half: 0.35, halfWidth: 0.35, heading: h });
  for (const c of layout.cells) if (c.kind === 'corral' || c.kind === 'shelter' || c.kind === 'arched')
    out.push({ ...world(...lotToMap(lot, (c.w0 + c.w1) / 2, (c.u0 + c.u1) / 2)), half: STALL_D / 2 - 0.35, halfWidth: c.kind === 'arched' ? 1.3 : 0.85, heading: h });
  return out.flatMap(strips);
}
export interface LotLayout {
  cells: Cell[];
  /** Stall lines and hatching, as lot-local segments [w0, u0, w1, u1]. */
  lines: [number, number, number, number][];
  hatch: [number, number, number, number][];
  /** Light poles (lot points). */
  poles: [number, number][];
  /** Curb pieces along the lot's outer edge (map points). */
  curbs: [P2, P2][];
  teardrops: [number, number, number][];
}

export const STALL_W = 2.7, STALL_D = 5.5, AISLE = 7, PERIOD = 2 * STALL_D + AISLE;
const FIRE_LANE: [number, number] = [1.6, 6.4];
/** Hatching: 45-degree strokes across the rectangle w0..w1 by u0..u1, `step` apart along u, clipped to it. */
export function diagonals(w0: number, w1: number, u0: number, u1: number, step: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let c = u0 - (w1 - w0) + step / 2; c < u1; c += step) {   // the stroke is u = c + (w - w0)
    const a = Math.max(w0, w0 + u0 - c), b = Math.min(w1, w0 + u1 - c);
    if (b - a > 0.05) out.push([a, c + a - w0, b, c + b - w0]);
  }
  return out;
}

export function lotToMap(lot: LotSpec, w: number, u: number): P2 { return toMap({ e: lot.anchor[0], n: lot.anchor[1], az: lot.az }, w, u); }
export function lotBox(lot: LotSpec): [number, number, number, number] {
  const xs = lot.rings[0].map(p => p[0]), ys = lot.rings[0].map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Body colours of a lot: mostly white, silver, grey and black, some blue and red (as parked.ts). */
const COLOURS = [0xd9d9d4, 0xd9d9d4, 0xb4b7b9, 0xb4b7b9, 0x6f7376, 0x6f7376, 0x1b1c1e, 0x1b1c1e, 0x24364f, 0x7a1f1c, 0x4f5b4a, 0x8a8271, 0x2f3a45];

/**
 * Lay out one lot: double rows of stalls inside the lot polygon, off every road, building and model; islands at row
 * ends and every twelfth stall; light poles on the islands; accessible stalls, corrals and parked vehicles; curbs
 * along the outer edge where it meets grass (not where a road or a building meets it).
 */
export function layoutLot(lot: LotSpec, clear: Clearance): LotLayout {
  const ring = lot.rings[0], local = ring.map(([e, n]) => toLocal({ e: lot.anchor[0], n: lot.anchor[1], az: lot.az }, e, n));
  const wMin = Math.min(...local.map(p => p[0])), wMax = Math.max(...local.map(p => p[0]));
  const uMin = Math.min(...local.map(p => p[1])), uMax = Math.max(...local.map(p => p[1]));
  const at = (w: number, u: number) => lotToMap(lot, w, u);
  // The fire lane runs along a store front, 1.6 to 6.4 m out from it. The front is found in each column: the nearest
  // building face within 8 m either side of the anchor line (a land block can stand a few metres off the lidar line).
  const fronts = new Map<number, number | null>();
  const front = (j: number): number | null => {
    if (!lot.fireLane) return null;
    if (!fronts.has(j)) {
      const u = (j + 0.5) * STALL_W;
      let f: number | null = null;
      for (let w = 8; w >= -8; w -= 0.25) if (clear.built(at(w, u), 0)) { f = w + 0.25; break; }
      fronts.set(j, f);
    }
    return fronts.get(j)!;
  };
  const ok = (w0: number, w1: number, u0: number, u1: number) => {
    const inset = 0.3, pts = [[w0 + inset, u0 + inset], [w1 - inset, u0 + inset], [w1 - inset, u1 - inset], [w0 + inset, u1 - inset], [(w0 + w1) / 2, (u0 + u1) / 2]];
    return pts.every(([w, u]) => { const p = at(w, u); return inLot(p, lot.rings) && clear.paved(p) && clear.free(p, 1.2, 0.8); });
  };
  // Bands: two stall bands then an aisle, repeating from `start` both ways.
  const bands: [number, number][] = [];
  const k0 = Math.floor((wMin - lot.start) / PERIOD) - 1, k1 = Math.ceil((wMax - lot.start) / PERIOD) + 1;
  for (let k = k0; k <= k1; k++) {
    const w = lot.start + k * PERIOD;
    if (w + 2 * STALL_D < wMin || w > wMax) continue;
    bands.push([w, w + STALL_D], [w + STALL_D, w + 2 * STALL_D]);
  }
  const cells: Cell[] = [];
  const j0 = Math.floor(uMin / STALL_W) - 1, j1 = Math.ceil(uMax / STALL_W) + 1;
  bands.forEach(([w0, w1], band) => {
    for (let j = j0; j <= j1; j++) {
      const u0 = j * STALL_W, u1 = u0 + STALL_W;
      const f = front(j);
      if (f !== null && w0 < f + FIRE_LANE[1] + 0.5 && w1 > f + FIRE_LANE[0] - 0.5) continue;   // never a stall on the fire lane
      if (ok(w0, w1, u0, u1)) cells.push({ band, j, w0, w1, u0, u1, kind: 'stall' });
    }
  });
  // Teardrops first: no stall, island or line is painted under one (its box with 0.3 m to spare).
  const teardrops = (lot.teardrops ?? []).filter(([w, u, l]) => [[w - l / 2, u], [w + l / 2, u], [w, u - 1.6], [w, u + 1.6]].every(([a, b]) => { const p = at(a, b); return inLot(p, lot.rings) && clear.paved(p) && clear.free(p, 1.5, 1); }));
  cells.splice(0, cells.length, ...cells.filter(c => !teardrops.some(([w, u, l]) => c.w1 > w - l / 2 - 0.3 && c.w0 < w + l / 2 + 0.3 && c.u1 > u - 1.9 && c.u0 < u + 1.9)));
  // Runs of stalls in each band: the end stalls of a run of five or more are islands, and every twelfth stall
  // (by its column, so the two bands of a double row agree) when the run goes on three stalls beyond it.
  const byBand = new Map<number, Map<number, Cell>>();
  for (const c of cells) { const m = byBand.get(c.band) ?? new Map(); m.set(c.j, c); byBand.set(c.band, m); }
  for (const m of byBand.values()) {
    const js = [...m.keys()].sort((a, b) => a - b);
    let s = 0;
    while (s < js.length) {
      let e = s; while (e + 1 < js.length && js[e + 1] === js[e] + 1) e++;
      // A run of one or two stalls left in a corner reads as stray paint: it is not painted.
      if (e - s + 1 < 3 && !lot.occupancy.display) for (let i = s; i <= e; i++) m.get(js[i])!.kind = 'none' as CellKind;
      if (e - s + 1 >= 5) {
        m.get(js[s])!.kind = 'island'; m.get(js[e])!.kind = 'island';
        for (let i = s + 3; i <= e - 3; i++) if (((js[i] % 12) + 12) % 12 === 6) m.get(js[i])!.kind = 'island';
      }
      s = e + 1;
    }
  }
  for (const m of byBand.values()) for (const [j, c] of [...m]) if ((c.kind as string) === 'none') m.delete(j);
  cells.splice(0, cells.length, ...cells.filter(c => (c.kind as string) !== 'none'));
  // Light poles in the middle of the islands (clear of a long pickup across the row), at least `spacing` apart.
  const poles: [number, number][] = [];
  const candidates = cells.filter(c => c.kind === 'island').map(c => [(c.w0 + c.w1) / 2, (c.u0 + c.u1) / 2] as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const p of candidates) if (!poles.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < lot.spacing)) poles.push(p);
  // Accessible stalls: six free stalls in one band nearest the entrance, as stall, loading aisle, stall, stall, aisle, stall.
  if (lot.accessible) {
    const [aw, au] = lot.accessible;
    let best: Cell[] | null = null, bestD = Infinity;
    for (const m of byBand.values()) for (const c of m.values()) {
      const run = Array.from({ length: 6 }, (_, i) => m.get(c.j + i));
      if (run.some(x => !x || x.kind !== 'stall')) continue;
      const d = Math.hypot((c.w0 + c.w1) / 2 - aw, c.u0 + 3 * STALL_W - au);
      if (d < bestD) { bestD = d; best = run as Cell[]; }
    }
    if (best) best.forEach((c, i) => { c.kind = i === 1 || i === 4 ? 'aisle' : 'accessible'; });
  }
  const nearest = (p: P2, kind: CellKind) => {
    let best: Cell | null = null, d = Infinity;
    for (const c of cells) if (c.kind === 'stall') { const x = Math.hypot((c.w0 + c.w1) / 2 - p[0], (c.u0 + c.u1) / 2 - p[1]); if (x < d) { d = x; best = c; } }
    if (best) best.kind = kind;
  };
  for (const p of lot.corrals ?? []) nearest(p, 'corral');
  for (const p of lot.shelters ?? []) nearest(p, 'shelter');
  for (const p of lot.arched ?? []) nearest(p, 'arched');
  // Parked vehicles: nose into the stall, toward the row's back line.
  const rnd = seeded(lot.seed * 9973 + 17), o = lot.occupancy;
  for (const c of cells) {
    if (c.kind !== 'stall' && c.kind !== 'accessible') continue;
    const d = Math.hypot((c.w0 + c.w1) / 2 - o.near[0], (c.u0 + c.u1) / 2 - o.near[1]);
    const p = o.display ? o.peak : o.peak * Math.exp(-d / o.reach) + 0.04;
    const r = rnd(), t = rnd(), col = rnd();
    if (r >= (c.kind === 'accessible' ? p * 0.5 : p)) continue;
    c.parked = { type: (t < (o.display ? 0.4 : 0.3) ? 2 : t < 0.65 ? 1 : 0) as 0 | 1 | 2, colour: COLOURS[Math.floor(col * COLOURS.length)],
      // A dealer's display rows all face the street (the anchor side); elsewhere vehicles nose into the row.
      nose: o.display ? -1 : c.band % 2 === 0 ? 1 : -1 };
  }
  // Lines: the two long sides of every painted cell (shared sides once).
  const lines: [number, number, number, number][] = [];
  const painted = (c: Cell | undefined) => !!c && c.kind !== 'island';
  for (const m of byBand.values()) {
    const js = [...m.keys()].sort((a, b) => a - b);
    for (const j of js) {
      const c = m.get(j)!;
      if (painted(c) || painted(m.get(j - 1))) lines.push([c.w0, c.u0, c.w1, c.u0]);
      if (painted(c) && !m.has(j + 1)) lines.push([c.w0, c.u1, c.w1, c.u1]);
    }
  }
  // Hatching: the loading aisles beside accessible stalls, and the fire lane where a building stands behind it.
  const hatch: [number, number, number, number][] = [];
  for (const c of cells) if (c.kind === 'aisle') hatch.push([c.w0, c.u0, c.w0, c.u1], [c.w1, c.u0, c.w1, c.u1], ...diagonals(c.w0, c.w1, c.u0, c.u1, 0.9));
  if (lot.fireLane) {
    const step = 1.4;
    for (let j = Math.floor(uMin / STALL_W); j <= Math.ceil(uMax / STALL_W); j++) {
      const u0 = j * STALL_W, u1 = u0 + STALL_W, f = front(j);
      if (f === null) continue;
      const f0 = f + FIRE_LANE[0], f1 = f + FIRE_LANE[1];
      const inside = [[f0 + 0.2, u0 + 0.1], [f1 - 0.2, u0 + 0.1], [f0 + 0.2, u1 - 0.1], [f1 - 0.2, u1 - 0.1]].every(([w, u]) => { const p = at(w, u); return inLot(p, lot.rings) && clear.paved(p) && clear.free(p, 1.2, 0.3); });
      if (!inside) continue;
      hatch.push([f0, u0, f0, u1], [f1, u0, f1, u1], ...diagonals(f0, f1, u0, u1, step));
    }
  }
  // Curbs along the outer edge, where grass lies outside: every 2 m, not across a road or against a building.
  const curbs: [P2, P2][] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len, n = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < n; k++) {
      const p0: P2 = [a[0] + dx * len * k / n, a[1] + dy * len * k / n], p1: P2 = [a[0] + dx * len * (k + 1) / n, a[1] + dy * len * (k + 1) / n];
      const m: P2 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], side = inRing([m[0] - dy * 0.6, m[1] + dx * 0.6], ring) ? 1 : -1;
      const outside: P2 = [m[0] + dy * 2 * side, m[1] - dx * 2 * side];
      const inside: P2 = [m[0] - dy * 1.2 * side, m[1] + dx * 1.2 * side];
      if (clear.roadGap(m) < 2.5 || clear.roadGap(outside) < 1 || clear.built(outside, 0.5) || clear.built(m, 0.5) || !clear.paved(inside) || clear.paved(outside)) continue;
      curbs.push([p0, p1]);
    }
  }
  return { cells, lines, hatch, poles, curbs, teardrops };
}

// ---- the site ------------------------------------------------------------------------------------------------------
export class PortHawkesburySite {
  readonly clear: number[][] = [];
  readonly solids: Solid[] = [];
  readonly centre: { x: number; z: number };
  readonly reach = 1400;
  constructor(readonly village: readonly [number, number]) {
    this.centre = this.world(629150, 5052600);
    for (const p of Object.values(PH_PLACES) as PhPlace[]) for (const r of p.rects) {
      this.solids.push(this.rect(p, ...r));
      this.clear.push(this.box(p, r, 2));
    }
    for (const [name, x0, x1, z0, z1] of PH_PADS) this.clear.push(this.box(PH_PLACES[name], [x0, x1, z0, z1], 1));
    // The garage apron: 3 m cells whose middle lies on it (no grass or tree grows through the asphalt or the vehicles).
    for (const q of GARAGE_APRON) {
      const es = q.map(p => p[0]), ns = q.map(p => p[1]);
      for (let e = Math.floor(Math.min(...es)); e < Math.max(...es); e += 3) for (let n = Math.floor(Math.min(...ns)); n < Math.max(...ns); n += 3) {
        if (!inRing([e + 1.5, n + 1.5], q) && ![[e, n], [e + 3, n], [e, n + 3], [e + 3, n + 3]].some(c => inRing(c as P2, q))) continue;
        const a = this.world(e, n + 3), b = this.world(e + 3, n); this.clear.push([a.x, a.z, b.x, b.z]);
      }
    }
    const at = (p: P2, half: number, halfWidth = half, heading = 0): Solid => ({ ...this.world(p[0], p[1]), half, halfWidth, heading });
    for (const sign of Object.values(PH_SIGNS) as Sign[]) this.solids.push(at(sign.at, sign.half, sign.halfWidth, sign.az * Math.PI / 180));
    this.solids.push(at(PH_ITEMS.hardwareHydrant, 0.2), ...PH_ITEMS.garageLamps.map(p => at(p, 0.25)));
    // The hardware store's cart-bay posts, and the gas bars' curbed tree beds.
    for (const x of CART_BAY_POSTS) this.solids.push(this.rect(PH_PLACES.hardware, x - 0.1, x + 0.1, 21.1, 21.3));
    for (const [name, beds] of Object.entries(GAS_TREES) as [PlaceName, P2[]][]) for (const [x, z] of beds) this.solids.push(this.rect(PH_PLACES[name], x - 1.4, x + 1.4, z - 1.4, z + 1.4));
    // Canopy columns and pump islands at the two gas bars, and the hardware store's garden-centre canopy posts.
    for (const name of ['gasBar', 'eastGas'] as const) {
      const p = PH_PLACES[name];
      for (const [x, z] of GAS_COLUMNS) this.solids.push(this.rect(p, x - 0.3, x + 0.3, z - 0.3, z + 0.3));
      for (const x of GAS_ISLANDS) this.solids.push(this.rect(p, x - 0.6, x + 0.6, 3, 9));
    }
    for (const x of CANOPY_POSTS) this.solids.push(this.rect(PH_PLACES.hardware, x - 0.15, x + 0.15, 25.6, 25.9));
    this.solids.splice(0, this.solids.length, ...this.solids.flatMap(strips));
  }
  world(e: number, n: number): { x: number; z: number } { return { x: e - this.village[0], z: this.village[1] - n }; }
  private box(p: PhPlace, r: number[], pad: number): number[] {
    const corners = [[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([x, z]) => this.world(...toMap(p, x, z)));
    const xs = corners.map(c => c.x), zs = corners.map(c => c.z);
    return [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad];
  }
  rect(p: PhPlace, x0: number, x1: number, z0: number, z1: number): Solid {
    const [e, n] = toMap(p, (x0 + x1) / 2, (z0 + z1) / 2);
    return { ...this.world(e, n), half: (x1 - x0) / 2, halfWidth: (z1 - z0) / 2, heading: p.az * Math.PI / 180 };
  }
  /** Leave out the baked boxes the models replace, by position; a split building goes with all its wings. */
  buildings(list: Building[]): Building[] {
    const spots = (Object.values(PH_PLACES) as PhPlace[]).flatMap(p => p.replaces);
    const onSpot = (b: Building) => { const c = b.site ?? b; return spots.some(([e, n]) => (c.x - e) ** 2 + (c.y - n) ** 2 <= 6 ** 2); };
    const groups = new Set(list.filter(onSpot).map(b => b.buildingId ?? b.id));
    return list.filter(b => !onSpot(b) && !groups.has(b.buildingId ?? b.id));
  }
  /** Everything a lot's paint must keep off: roads, every mapped building (also the replaced ones), the models, items. */
  clearance(lot: LotSpec, roads: MapRoad[], buildings: Building[], paved?: (p: P2) => boolean): Clearance {
    const items: [number, number, number][] = [...(Object.values(PH_SIGNS) as Sign[]).map(s => s.at), PH_ITEMS.hardwareHydrant].map(([e, n]) => [e, n, ITEM_CLEAR]);
    const c = new Clearance(lotBox(lot), roads, buildings, items, paved);
    for (const p of Object.values(PH_PLACES) as PhPlace[]) for (const r of [...p.rects, ...(p.unpainted ?? [])]) c.addShape([[r[0], r[2]], [r[1], r[2]], [r[1], r[3]], [r[0], r[3]]].map(([x, z]) => toMap(p, x, z)));
    for (const [name, x0, x1, z0, z1] of PH_PADS) c.addShape([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => toMap(PH_PLACES[name], x, z)));
    return c;
  }
}

/** The hardware store's cart-bay posts (local x, at z = 21.2). */
export const CART_BAY_POSTS = [0.3, 3.3, 19.9, 22.8];
/** The gas bars' curbed beds with young trees (local x, z). */
export const GAS_TREES: Partial<Record<PlaceName, P2[]>> = { gasBar: [[-12.5, 12.5], [17, 12.5]], eastGas: [[-16, -18], [16, -18]] };
/** Service drops whose building the models replace: the replacement end (place, local x, z) and attachment height. */
const DROP_ENDS: Record<number, [PlaceName, number, number, number]> = { 36: ['hardware', -32.7, -19.1, 3.2], 398: ['gasBar', 16, -7.25, 3.6] };
/** Re-aim the service drops of replaced buildings at the models (a wire must not end in the air). */
export function aimDrops<T extends { building: number; x: number; y: number; height: number; ground: number | null; groundX: number; groundY: number }>(drops: T[]): T[] {
  return drops.map(d => {
    const end = DROP_ENDS[d.building]; if (!end) return d;
    const [x, y] = toMap(PH_PLACES[end[0]], end[1], end[2]);
    return { ...d, x, y, height: end[3], ground: null, groundX: x, groundY: y };
  });
}
/** Gas bar canopy columns (local x, z) on the two pump islands (local x, from z = 3 to 9); the canopy spans x -9..9, z 0.5..11.5. */
export const GAS_COLUMNS: P2[] = [[-4.5, 3.6], [4.5, 3.6], [-4.5, 8.4], [4.5, 8.4]];
export const GAS_ISLANDS = [-4.5, 4.5];
/** The hardware store's garden-centre canopy posts (local x along the front, at z = 25.75). */
export const CANOPY_POSTS = [23.15, 28.15, 33.15, 38.15, 43.15];
