import * as THREE from 'three';
import { clearBoxes, type Building, type BuildingStyle } from './buildings';
import { pushOut, type Solid } from './parked';
import { frameToMap } from './site-kit';
import { Mesher, type RGB } from './yard-kit';

type Model = Pick<Building, 'id' | 'x' | 'y' | 'ground' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge'>;
const paint = (colour: number): RGB => {
  const c = new THREE.Color(colour);
  return [c.r, c.g, c.b];
};
const greyCedar = paint(0x8d9391), barnBoard = paint(0x817c70), sage = paint(0xa0aa9d);
const cream = paint(0xd4c9ac), blueGrey = paint(0x536370), roof = paint(0x343d44);
const trim = paint(0xd8d6ca), glass = paint(0x344b54), timber = paint(0x98724e), stone = paint(0x555654);
const red = paint(0xbc3431), white = paint(0xede9df);

const VILLAGE_HOUSE: Model = { id: 900013, x: 623154.68, y: 5103926.95, ground: 5.85, axisDeg: 165, length: 16, width: 12, eave: 5.8, ridge: 9.4 };
const VILLAGE_BARN: Model = { id: 900014, x: 623184, y: 5103926, ground: 5.28, axisDeg: 165, length: 11, width: 7, eave: 3.1, ridge: 5.1 };
// The provincial building point and the high roof return agree at the bend.
const NORTH_HOUSE: Model = { id: 900015, x: 619446.3, y: 5110729.3, ground: 8.87, axisDeg: 59, length: 12, width: 8, eave: 5.1, ridge: 7.6 };
// These two separate compact LiDAR roofs are in the field west of the road.
const VALLEY_HOUSE: Model = { id: 900016, x: 619147, y: 5110338, ground: 19.29, axisDeg: 117, length: 15, width: 9, eave: 3.5, ridge: 7.1 };
const VALLEY_SHED: Model = { id: 900017, x: 619148, y: 5110319, ground: 19.04, axisDeg: 26, length: 7, width: 5, eave: 2.3, ridge: 3.4 };
// The provincial point and a low, level roof just south of it place the shop.
const DUNMORE: Model = { id: 900018, x: 614477, y: 5096378, ground: 25.72, axisDeg: 63, length: 10, width: 7, eave: 3.1, ridge: 4.5 };
const HILLSIDE = new Set([900007, 900008, 900009]);
export const isHillsideBuilding = (b: Building): boolean => HILLSIDE.has(b.id);
export const novemberFootprints = { mabou: [VILLAGE_HOUSE, VILLAGE_BARN, NORTH_HOUSE, VALLEY_HOUSE, VALLEY_SHED], porthood: [DUNMORE] };

const plainHouse: BuildingStyle = {
  wall: '#f4f1e9', roof: '#535354', trim: '#fcfaf5', door: '#dfddd5', roofMaterial: 'shingle',
  entrance: 'none', front: { end: false, side: 1 }, chimney: false, dormer: false, shutters: false,
  satelliteDish: false, skirting: false, silo: false,
};

function surveyedBox(model: Model, kind: Building['kind'], roof: Building['roof']): Building {
  const frame = { e: model.x, n: model.y, az: model.axisDeg };
  const footprint = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
    frameToMap(frame, u * model.length / 2, v * model.width / 2));
  return { ...model, kind, roof, footprint, confidence: 0.9 };
}

/** Keep the measured Port Hood envelopes. Match by position because each area and rebake has its own IDs. */
export function littleMabouBuildingArt(list: Building[]): { buildings: Building[]; styles: Record<string, BuildingStyle> } {
  const at = (e: number, n: number, radius = 4) => list.find(b => !b.shape && Math.hypot(b.x - e, b.y - n) < radius);
  const house = at(615817.26, 5102552.32);
  const mobile = at(616081.34, 5102382.38);
  const buildings = list.map(b => b === house || b === mobile ? { ...b, kind: 'house' as const } : b);
  const styles: Record<string, BuildingStyle> = {};
  if (house) {
    styles[house.buildingId ?? house.id] = plainHouse;
    // A separate compact, peaked LiDAR roof sits west of the house.
    const shed = at(615779, 5102552) ?? surveyedBox({ id: 900419, x: 615779, y: 5102552, ground: 41.9,
      axisDeg: 90, length: 6.2, width: 5.3, eave: 2.35, ridge: 4.1 }, 'shed', 'gable');
    if (!list.includes(shed)) buildings.push(shed);
    styles[shed.buildingId ?? shed.id] = { ...plainHouse, wall: '#a13832', boardAndBatten: true };
  }
  if (mobile) {
    const id = mobile.buildingId ?? mobile.id;
    styles[id] = { ...plainHouse, roofShape: 'flat', skirting: true };
    // The lower roof return projects from the east side near the end of the mobile home.
    const [x, y] = frameToMap({ e: mobile.x, n: mobile.y, az: mobile.axisDeg }, 3.7, -3.82);
    const wing = at(x, y, 2);
    if (!wing) {
      const extension = surveyedBox({ id: 900420, x, y, ground: 32.18, axisDeg: mobile.axisDeg,
        length: 4.25, width: 1.65, eave: 2.02, ridge: 2.21 }, 'shed', 'flat');
      buildings.push({ ...extension, buildingId: id });
    }
  }
  return { buildings, styles };
}

const plainShed = {
  entrance: 'none', chimney: false, dormer: false, shutters: false, satelliteDish: false, skirting: false, silo: false,
} as const;
// Baxters Cove harbour, 21 Nov 2026 dash cam. The long gear shed has ochre board walls, a rust-red metal roof,
// a white eave trim and board doors along its lot side.
const gearShed: BuildingStyle = {
  ...plainShed, wall: '#ae8e51', roof: '#9a5a40', trim: '#e3dfd2', door: '#a3854c',
  roofMaterial: 'metal', boardAndBatten: true, front: { end: false, side: 1 }, barnDoors: 5,
};
const whiteShed: BuildingStyle = { ...plainShed, wall: '#e9e7df', roof: '#3b3d40', trim: '#f4f2ec', door: '#d8d5cb', roofMaterial: 'shingle' };
// Grey board ends with faded red doors, red long sides, a dark shingle gambrel roof.
const gambrelShed: BuildingStyle = {
  ...plainShed, wall: '#a13832', roof: '#3a3d42', trim: '#c9c3b6', door: '#c27d76', roofMaterial: 'shingle',
  roofShape: 'gambrel', boardAndBatten: true, bareEnd: { side: -1, wall: '#a7a69c' }, front: { end: true, side: -1 },
};
// At the Highway 19 end: a weathered grey-brown outbuilding and a two-storey cream house with a dark brown roof.
const greyBrownShed: BuildingStyle = { ...plainShed, wall: '#8a7b68', roof: '#45413c', trim: '#a89c8a', door: '#6f6455', roofMaterial: 'shingle' };
const creamHouse: BuildingStyle = {
  ...plainShed, wall: '#d9d0b6', roof: '#4a3a30', trim: '#f2efe6', door: '#e6e2d8', roofMaterial: 'shingle',
  front: { end: false, side: -1 },
};
// The 1 m surface model shows a compact roof about 3.5 m high on the grass east of the harbour road.
const GAMBREL_SHED: Model = { id: 900421, x: 616282, y: 5079339, ground: 2.56, axisDeg: 35, length: 4.8, width: 3.6, eave: 2.1, ridge: 3.6 };

/** Baxters Cove Road (Judique pack). Match by place, because each area and rebake has its own IDs. Drawing only:
 *  the property list keeps the survey kinds, so a shed drawn as a barn gets no field bales. */
export function baxtersCoveBuildingArt(list: Building[]): { buildings: Building[]; styles: Record<string, BuildingStyle> } {
  const at = (e: number, n: number, ok: (b: Building) => boolean) =>
    list.find(b => !b.shape && b.buildingId === undefined && Math.hypot(b.x - e, b.y - n) < 4 && ok(b));
  const long = at(616254.85, 5079386.99, b => b.length > 50);
  const white = at(616233.9, 5079329.5, b => b.length < 20);
  const outbuilding = at(617039, 5079229.5, b => b.length < 15);
  const house = at(617083, 5079233.8, b => b.kind === 'house');
  const styles: Record<string, BuildingStyle> = {};
  const buildings = list.map(b => {
    if (b === long) return { ...b, kind: 'barn' as const };
    // Two full storeys and a lower roof: the survey eave sits at one storey under the measured ridge.
    if (b === house) return { ...b, eave: Math.max(b.eave, 5.3) };
    return b;
  });
  if (long) styles[long.id] = gearShed;
  if (white) styles[white.id] = whiteShed;
  if (outbuilding) styles[outbuilding.id] = greyBrownShed;
  if (house) styles[house.id] = creamHouse;
  if (long && !at(GAMBREL_SHED.x, GAMBREL_SHED.y, () => true)) {
    buildings.push(surveyedBox(GAMBREL_SHED, 'shed', 'gable'));
    styles[GAMBREL_SHED.id] = gambrelShed;
  }
  return { buildings, styles };
}

function wallPanel(m: Mesher, end: boolean, at: number, u0: number, u1: number, y0: number, y1: number, colour: RGB) {
  const corners = [[u0,y0], [u1,y0], [u1,y1], [u0,y1]].map(([u, y]) => end ? [at, y, u] : [u, y, at]);
  m.quad((end ? at > 0 : at < 0) ? corners.reverse() : corners, colour);
}

function opening(m: Mesher, end: boolean, at: number, u: number, y: number, w: number, h: number, frame = trim, fill = glass) {
  const panel = (width: number, height: number, colour: RGB, gap: number) =>
    wallPanel(m, end, at + Math.sign(at) * gap, u - width / 2, u + width / 2, y - height / 2, y + height / 2, colour);
  panel(w, h, frame, 0.043);
  panel(w - .14, h - .14, fill, 0.061);
}

function roofShape(m: Mesher, x: number, z: number, eave: number, ridge: number, wall: RGB, mono = false) {
  const left = -x - .26, right = x + .26, near = z + .26, far = -near;
  if (mono) {
    m.quad([[left, eave, far], [right, eave, far], [right, ridge, near], [left, ridge, near]], roof);
    wallPanel(m, false, z, -x, x, eave, ridge, wall);
    for (const side of [-x, x]) m.tri(side,eave,-z, side,eave,z, side,ridge,z, wall);
    return;
  }
  m.quad([[left,eave,far],[right,eave,far],[right,ridge,0],[left,ridge,0]], roof);
  m.quad([[left,ridge,0],[right,ridge,0],[right,eave,near],[left,eave,near]], roof);
  for (const side of [-x, x]) m.tri(side,eave,-z, side,eave,z, side,ridge,0, wall);
}

function shell(m: Mesher, b: Model, wall: RGB, upper = wall, mono = false, foot = -3) {
  const x = b.length / 2, z = b.width / 2, base = upper === wall ? 0.22 : 2.6;
  m.box(0, (foot + base) / 2, 0, b.length, base - foot, b.width, upper === wall ? stone : wall);
  m.box(0, (base + b.eave) / 2, 0, b.length, b.eave - base, b.width, upper);
  roofShape(m, x, z, b.eave, b.ridge, upper, mono);
}

function siding(m: Mesher, b: Model, colour: RGB, vertical: boolean, low: boolean, start = .55) {
  if (low) return;
  for (const end of [false, true]) {
    const span = (end ? b.width : b.length) / 2, depth = (end ? b.length : b.width) / 2;
    for (const side of [-1, 1]) {
      const at = side * (depth + .022), dark = colour.map(c => c * .77) as RGB;
      if (vertical) {
        for (let u = -span + .18; u < span - .1; u += .28) wallPanel(m, end, at, u, u + .025, .27, b.eave, dark);
      } else {
        for (let y = start; y < b.eave - .1; y += .24) wallPanel(m, end, at, -span, span, y, y + .018, dark);
      }
    }
  }
}

function houseWindows(m: Mesher, b: Model, floors: number) {
  const x = b.length / 2, z = b.width / 2;
  for (const side of [-1, 1]) for (let floor = 0; floor < floors; floor++) {
    for (const u of [-x * .64, 0, x * .64]) {
      if (side === 1 && u === 0 && floor === 0) continue;
      opening(m, false, side * z, u, 1.65 + floor * 2.5, 1.12, 1.3);
    }
    for (const u of [-z * .52, z * .52]) opening(m, true, side * x, u, 1.65 + floor * 2.5, 1.05, 1.25);
  }
  opening(m, false, z, 0, 1.33, 1.03, 2.15, trim, timber);
}

function deck(m: Mesher, width: number, depth: number, reach: number, y: number, rail = true, foot = -2) {
  const edge = depth + reach;
  m.box(0, y - .12, depth + reach / 2, width, .24, reach, timber);
  const posts = [-width / 2 + .13, 0, width / 2 - .13];
  for (const x of posts) m.box(x, (y + foot) / 2, edge - .13, .19, y - foot, .19, timber);
  if (!rail) return;
  for (const x of posts) m.box(x, y + .44, edge - .13, .12, .9, .12, trim);
  for (const x of [posts[0], posts[2]]) m.box(x, y + .86, depth + reach / 2, .085, .085, reach, trim);
  m.box(0, y + .86, edge - .13, width, .085, .085, trim);
  m.box(0, y + .35, edge - .13, width, .045, .04, trim);
}

function villageHouse(m: Mesher, b: Model, low: boolean) {
  shell(m, b, greyCedar);
  siding(m, b, greyCedar, false, low);
  houseWindows(m, b, 2);
  const L = b.length / 2, W = b.width / 2;
  // Covered porch on the shore side, returned along the end.
  deck(m, b.length, W, 2.2, .4, false);
  m.box(-L-1.1, .28, 1.1, 2.2, .24, b.width+2.2, timber);
  for (const x of [-L-2.04, -L*.55, 0, L*.55, L-.12]) m.box(x,1.46,W+2.04,.14,2.14,.14,trim);
  for (const z of [-W+.17, 0, W*.48]) m.box(-L-2.04,1.46,z,.14,2.14,.14,trim);
  m.quad([[-L-2.3,2.47,W+2.3],[L+.16,2.47,W+2.3],[L+.16,3.08,W],[-L,3.08,W]],roof);
  m.quad([[-L-2.3,2.47,-W-.16],[-L-2.3,2.47,W+2.3],[-L,3.08,W],[-L,3.08,-W-.16]],roof);
  m.box(0,.12,W+2.48,2.6,.24,.62,stone);
  // Two dormers face the shore.
  for (const x of [-3.5, 3.5]) {
    const z = W * .59, y = b.ridge - 1.92;
    m.box(x,y+.55,z-.62,1.9,1.55,1.25,greyCedar);
    opening(m,false,z,x,y+.54,1.15,.92);
    m.quad([[x-1.05,y+1.38,z+.16],[x,y+1.98,z+.16],[x,y+1.98,z-1.5],[x-1.05,y+1.38,z-1.5]],roof);
    m.quad([[x,y+1.98,z+.16],[x+1.05,y+1.38,z+.16],[x+1.05,y+1.38,z-1.5],[x,y+1.98,z-1.5]],roof);
    m.tri(x-1.05,y+1.32,z, x+1.05,y+1.32,z, x,y+1.96,z, greyCedar);
  }
}

function hillsideHouse(m: Mesher, b: Model, low: boolean, exag: number) {
  const foot = -2.55 * exag - .15;
  shell(m,b,sage,sage,false,foot);
  siding(m,b,sage,false,low);
  const x=b.length/2, z=b.width/2;
  // Light timber and large windows mark the gable from the harbour road.
  for (const u of [-2.55, 0, 2.55]) {
    opening(m,true,x,u,2.62,1.85,3.5,trim);
    opening(m,false,z,u*1.58,2.28,2,2.55,trim);
  }
  opening(m,true,x,0,b.eave+.86,1.52,1.56,trim);
  deck(m,b.length-.7,z,2.65,.77,true,foot);
  // Full-width stairs and a post-and-beam porch on the uphill long wall.
  const w=2.6, front=-z-2.18;
  opening(m,false,-z,0,1.66,1.16,2.12,trim,timber);
  for (const u of [-4.35,4.35]) opening(m,false,-z,u,2.31,1.36,2.22);
  for (const u of [-2.6,2.6]) opening(m,true,-x,u,2.25,1.38,2.05);
  const bottom = -.18 * exag;
  m.box(0,(.53+bottom)/2,-z-1.05,w*2,.53-bottom,2.14,timber);
  for (let i = 0; i < 3; i++) {
    const top = .15 * (i + 1);
    m.box(0,(top+bottom)/2,front-.66+i*.29,w*2,top-bottom,.36,stone);
  }
  for (const u of [-w+.2,w-.2]) m.box(u,1.92,front,.22,2.87,.22,timber);
  m.box(0,3.25,front,w*2,.2,.18,timber);
  for (const side of [-1,1]) {
    m.quad([[side*w,3.22,front-.2],[0,4.63,front-.2],[0,4.63,-z],[side*w,3.22,-z]],roof);
    m.tri(side*w,3.25,front, 0,4.57,front, 0,4.28,front,timber);
  }
  m.box(0,3.75,front,.17,1.15,.16,timber);
  for (const sign of [-1,1]) {
    const inset = sign * (w - .89), edge = sign * (w - .23);
    m.quad([[edge,2.34,front+.1],[edge,2.59,front+.1],[inset,3.22,front+.1],[inset-.19*sign,3.22,front+.1]],timber);
  }
}

function hillsideGarage(m: Mesher, b: Model, low: boolean) {
  shell(m,b,sage,sage,true);
  siding(m,b,sage,false,low);
  const z=b.width/2;
  for (const x of [-1.96,1.96]) {
    opening(m,false,z,x,1.35,2.85,2.42,white,white);
    for (const p of [-.88,-.29,.29,.88]) opening(m,false,z+.05,x+p,2.16,.48,.32,white);
    for (const p of [-.65,.65]) wallPanel(m,false,z+.05,x+p-.62,x+p+.62,.46,1.48,cream);
    wallPanel(m,false,z+.13,x-.022,x+.022,.22,2.52,stone);
    m.cyl(x,2.86,z+.36,.09,.27,red,'z',8);
    m.cyl(x,2.69,z+.4,.2,.14,red,'y',10,.08);
  }
}

function hillsideShed(m: Mesher, b: Model, low: boolean) {
  shell(m,b,sage,sage,true);
  siding(m,b,sage,false,low);
  const z=b.width/2;
  opening(m,false,z,0,1.02,2.48,1.83,trim,red);
  wallPanel(m,false,z+.09,-.025,.025,.17,1.91,stone);
  for (const x of [-.68,0,.68]) opening(m,false,z,x,2.27,.55,.34,trim);
}

type Footprint = { e: number; n: number; az: number; length: number; width: number };

// The Judique Flyer Trail where it crosses Baxters Cove Road: a mown lot south of the road and west of the trail,
// a post-and-rail fence, a kiosk under a teal metal roof, and an open picnic shelter. The kiosk and shelter stand on
// the two compact roofs in the 1 m surface model; ground heights are the bare-earth model's (EPSG:2961, metres).
const teal = paint(0x2f8c8a), fascia = paint(0x7d5638), post = paint(0x9a958a), notice = paint(0x3f8798);
const KIOSK = { e: 616453, n: 5079126.5, ground: 3.35 };
const SHELTER = { e: 616450, n: 5079117.5, ground: 3.34 };
// The mown lot, kept clear of trees: [east0, north0, east1, north1].
const TRAILHEAD_BOX = [616426, 5079113, 616456, 5079160] as const;
type Post = readonly [east: number, north: number, ground: number];
// Along the trail side, then west along the lot's south edge, with a gap to the shelter.
export const TRAILHEAD_FENCE: readonly (readonly Post[])[] = [
  [[616441, 5079157, 2.7], [616452.5, 5079131, 3.36], [616448.4, 5079130.8, 3.2]],
  [[616445.6, 5079130.7, 3.1], [616428, 5079130.5, 2.92]],
];

function trailhead(m: Mesher, place: (e: number, n: number, y: number, az?: number) => void,
  solid: (b: Footprint) => void, exag: number, sea: number, low: boolean) {
  const lift = (g: number) => sea + (g - sea) * exag;
  // Local x runs east, local -z faces the lot to the north.
  place(KIOSK.e, KIOSK.n, lift(KIOSK.ground), 90);
  for (const x of [-1.05, 1.05]) m.box(x, .85, 0, .16, 3.3, .16, post);
  m.box(0, 1.55, 0, 2.3, 1.3, .1, timber);
  m.box(0, 1.62, -.06, 2.1, 1.05, .02, notice);
  if (!low) for (const x of [-.6, .15, .75]) m.box(x, 1.62, -.075, .5, .8, .01, x > .5 ? paint(0xd9cf55) : cream);
  m.box(0, .55, -.06, 2.1, .5, .02, white);
  m.box(0, 2.38, 0, 2.6, .12, .9, fascia);
  m.quad([[-1.45, 2.44, -.62], [1.45, 2.44, -.62], [1.45, 2.78, 0], [-1.45, 2.78, 0]], teal);
  m.quad([[-1.45, 2.78, 0], [1.45, 2.78, 0], [1.45, 2.44, .62], [-1.45, 2.44, .62]], teal);
  solid({ e: KIOSK.e, n: KIOSK.n, az: 90, length: 2.3, width: .3 });
  // The shelter: four posts, a hipped teal roof and a picnic table.
  place(SHELTER.e, SHELTER.n, lift(SHELTER.ground), 90);
  for (const [x, z] of [[-1.5, -1.25], [1.5, -1.25], [-1.5, 1.25], [1.5, 1.25]]) {
    m.box(x, .7, z, .16, 3, .16, post);
    const [e, n] = frameToMap({ e: SHELTER.e, n: SHELTER.n, az: 90 }, x, z);
    solid({ e, n, az: 90, length: .16, width: .16 });
  }
  m.box(0, 2.25, 0, 3.4, .14, 2.9, fascia);
  const [L, W, eave, top] = [1.95, 1.7, 2.32, 3.15];
  m.quad([[-L, eave, -W], [L, eave, -W], [.6, top, 0], [-.6, top, 0]], teal);
  m.quad([[-.6, top, 0], [.6, top, 0], [L, eave, W], [-L, eave, W]], teal);
  m.tri(-L, eave, -W, -.6, top, 0, -L, eave, W, teal);
  m.tri(L, eave, W, .6, top, 0, L, eave, -W, teal);
  m.box(0, .76, 0, 1.9, .07, .78, timber);
  for (const z of [-.66, .66]) m.box(0, .46, z, 1.9, .06, .28, timber);
  for (const x of [-.7, .7]) m.box(x, .38, 0, .1, .76, 1.5, timber);
  // Grey split rails between round posts, about 2.4 m apart.
  for (const run of TRAILHEAD_FENCE) for (let i = 1; i < run.length; i++) {
    const [ae, an, ag] = run[i - 1], [be, bn, bg] = run[i];
    const len = Math.hypot(be - ae, bn - an), az = Math.atan2(be - ae, bn - an) * 180 / Math.PI;
    const posts = Math.max(1, Math.round(len / 2.4));
    // A run's corner post is drawn once.
    for (let j = i > 1 ? 1 : 0; j <= posts; j++) {
      const t = j / posts, e = ae + (be - ae) * t, n = an + (bn - an) * t;
      place(e, n, lift(ag + (bg - ag) * t), az);
      m.cyl(0, .35, 0, .09, 1.6, post, 'y', low ? 5 : 8);
      solid({ e, n, az, length: .18, width: .18 });
    }
    place((ae + be) / 2, (an + bn) / 2, lift((ag + bg) / 2), az);
    for (const y of [.5, .95]) m.box(0, y, 0, len, .1, .1, post);
    solid({ e: (ae + be) / 2, n: (an + bn) / 2, az, length: len, width: .12 });
  }
}

function riverPark(m: Mesher, place: (e: number, n: number, y: number, az?: number) => void,
  solid: (b: Footprint) => void, exag: number, sea: number) {
  const y = sea + (1.4-sea)*exag;
  place(624138.7,5103130,y);
  const ring = Array.from({ length: 8 }, (_, i) => [2.95*Math.cos(i*Math.PI/4),2.95*Math.sin(i*Math.PI/4)]);
  m.cyl(0,.16,0,2.96,.44,greyCedar,'y',8);
  solid({ e:624138.7, n:5103130, az:90, length:4.15, width:4.15 });
  m.cyl(0,3.12,0,3.2,1.22,roof,'y',8,.04);
  for (const [x,z] of ring) {
    m.box(.94*x,1.41,.94*z,.16,2.4,.16,greyCedar);
    solid({ e:624138.7+.94*x, n:5103130-.94*z, az:90, length:.16, width:.16 });
  }
  for (let i=1;i<ring.length;i++) {
    const [x,z]=ring[i], [a,b]=ring[(i+1)%ring.length];
    m.quad([[.94*x,.99,.94*z],[.94*a,.99,.94*b],[.94*a,1.11,.94*b],[.94*x,1.11,.94*z]],greyCedar);
  }
  for (const [e,n,height] of [[624144,5103133,1.32],[624141,5103125,1.39],[624148,5103129,1.47]]) {
    place(e,n,sea+(height-sea)*exag,22);
    solid({ e, n, az:22, length:1.9, width:1.55 });
    m.box(0,.76,0,1.9,.11,.77,timber);
    for (const x of [-.67,.67]) {
      m.box(x,.36,0,.11,.7,.71,timber);
      m.box(x,.41,0,.10,.10,1.48,timber);
    }
    for (const z of [-.63,.63]) m.box(0,.49,z,1.9,.09,.29,timber);
  }
  place(624127.7,5103133.4,sea,13);
  m.box(0,.16,0,6.3,.34,2.25,greyCedar);
  m.box(0,.37,0,6.4,.1,2.3,timber);
  for (const x of [-2.8,2.8]) for (const z of [-.87,.87]) m.box(x,.47,z,.14,.27,.14,stone);
  // Walkway descends from the shore to the floating platform.
  const high=Math.max(.7,sea+(1.02-sea)*exag-sea);
  m.quad([[.65,.43,.8],[-.65,.43,.8],[-.65,high,7.25],[.65,high,7.25]],greyCedar);
  for (const x of [-.65,.65]) m.quad([[x,.43,.8],[x,high,7.25],[x,high+.14,7.25],[x,.57,.8]],timber);
}

export class NovemberBuildings {
  readonly drawing = new Mesher();
  readonly clear: number[][] = [];
  readonly solids: Solid[] = [];

  resolveSolids(body: Parameters<typeof pushOut>[0]): void { pushOut(body, this.solids, true); }

  constructor(area: string, mapped: readonly Building[], village: [number, number], exag: number, sea: number, low: boolean) {
    const m = this.drawing;
    const place = (m: Mesher, e: number, n: number, y: number, az = 90) =>
      m.at(e-village[0],y,village[1]-n,Math.PI/2-THREE.MathUtils.degToRad(az));
    const solid = ({ e, n, az, length, width }: Footprint) => this.solids.push({
      x:e-village[0], z:village[1]-n, half:length/2, halfWidth:width/2, heading:THREE.MathUtils.degToRad(az),
    });
    const build = (b: Model, draw: (m: Mesher, b: Model, low: boolean) => void) => {
      place(m,b.x,b.y,sea+(b.ground-sea)*exag,b.axisDeg);
      draw(m,b,low);
      const frame = { e:b.x,n:b.y,az:b.axisDeg };
      const footprint = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => frameToMap(frame,x*b.length/2,z*b.width/2));
      solid({ ...frame, length:b.length, width:b.width });
      this.clear.push(...clearBoxes({ ...b, footprint, roof:'gable', kind:'house',confidence:.4 },village,2.5));
    };
    if (area === 'porthood') {
      build(DUNMORE, (m, b, low) => {
        shell(m,b,greyCedar); siding(m,b,greyCedar,true,low);
        const front = b.length / 2;
        opening(m,true,front,0,1.33,3.35,2.46,trim,stone);
        for (let y=.36;y<2.45;y+=.27) wallPanel(m,true,front+.094,-1.6,1.6,y,y+.028,greyCedar);
      });
      return;
    }
    if (area === 'judique') {
      trailhead(m, (e, n, y, az) => place(m, e, n, y, az), solid, exag, sea, low);
      this.clear.push([TRAILHEAD_BOX[0] - village[0], village[1] - TRAILHEAD_BOX[3],
        TRAILHEAD_BOX[2] - village[0], village[1] - TRAILHEAD_BOX[1]]);
      return;
    }
    if (area !== 'mabou') return;
    build(VILLAGE_HOUSE, villageHouse);
    build(VILLAGE_BARN, (m, b, low) => {
      shell(m,b,barnBoard); siding(m,b,barnBoard,true,low);
      opening(m,true,-b.length/2,0,1.31,3.1,2.5,barnBoard,stone);
      opening(m,false,-b.width/2,0,1.42,2.75,2.35,barnBoard,stone);
    });
    build(NORTH_HOUSE, (m, b, low) => {
      shell(m,b,greyCedar); siding(m,b,greyCedar,false,low); houseWindows(m,b,2);
    });
    build(VALLEY_HOUSE, (m, b, low) => {
      shell(m,b,cream,blueGrey); siding(m,b,blueGrey,false,low,2.68); houseWindows(m,b,1);
      opening(m,true,b.length/2,0,4.65,1.25,1.55);
      opening(m,true,-b.length/2,0,4.65,1.25,1.55);
      deck(m,b.length*.8,b.width/2,2.3,.64);
    });
    build(VALLEY_SHED, (m, b, low) => {
      shell(m,b,stone); siding(m,b,stone,true,low);
      opening(m,true,b.length/2,0,1.03,1.25,1.85,timber);
    });
    const builders = new Map([[900008,hillsideGarage],[900009,hillsideShed]]);
    for (const b of mapped) {
      const draw = builders.get(b.id);
      if (b.id === 900007) {
        // The porch stands on the uphill bench, about 0.8 m above the footprint centre.
        build({ ...b, ground:b.ground+.78 }, (m, b, low) => hillsideHouse(m,b,low,exag));
      } else if (draw) build(b,draw);
    }
    riverPark(m,(e,n,y,az) => place(m,e,n,y,az),solid,exag,sea);
    this.clear.push([624135.6-village[0],village[1]-5103134.5,624142-village[0],village[1]-5103126.7]);
  }
}
