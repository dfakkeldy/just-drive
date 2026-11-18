/**
 * Port Hawkesbury, modelled by hand from the public-safe dash cam brief (the project brief). Words, numbers and map
 * positions only: no picture pixels, and no names, sign words, numbers, logos or brand colours. Every sign is blank.
 *
 * Five groups (the Reeves St hardware store and its lot, the Reeves St plaza lot and gas bar, the east plaza north and
 * south of Paint St, the corner garage) each build once, when the camera is near and the finest land under them is in
 * memory. Built groups that stand together (the Reeves St side with the garage, the east plaza) share one mesh per
 * surface pattern, one for the lot paint and one for the parked vehicles (baked: they never move), so a second group in
 * view costs no extra draw. LOW leaves out the small parts (carts, shrubs, pot lights, rooftop units, the accessible
 * symbols' figures), parks a third as many vehicles and draws the patterns as their mean tone (no textures).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Building } from './buildings';
import { ParkedVehicles, bakeParked, parkedMatrix, parkedSolid, pushOut, type Parked, type Pushable, type Solid } from './parked';
import type { Terrain } from './terrain';
import { Face, Kit as SiteKit, canvas, grey } from './site-kit';
import {
  CANOPY_POSTS, CART_BAY_POSTS, GARAGE_APRON, GAS_COLUMNS, GAS_ISLANDS, GAS_TREES, PH_GROUPS, PH_ITEMS, PH_LOTS, PH_PADS, PH_PLACES, PH_SIGNS, PLACE_VEHICLES,
  STALL_D, layoutLot, lotBox, lotSolids, lotToMap, parkedPose, pavedKeys, pavedTest, toMap,
  type GroupName, type LotLayout, type LotSpec, type MapRoad, type P2, type PhPlace, type PortHawkesburySite, type Sign,
} from './port-hawkesbury-site';

type Tex = 'panel' | 'glass' | 'seam' | 'decal';
type Kit = SiteKit<Tex>;

// Paint, from the brief (overcast frames read darker than the paint; these are the paint). Neutral signs only.
const C = {
  storeWall: 0xd6d8d6, base: 0x3b3e40, white: 0xf1f1ee, emblem: 0xe2e4e5, frame: 0x9da3a7, glass: 0x1c2427, shade: 0x2e3532,
  roof: 0xb9bcbc, unit: 0x9fa4a6, door: 0xeceeec, doorLine: 0xb8bcbc, notice: 0xf4f4f0, cart: 0xa9adb0, cartDark: 0x5a5f63,
  concrete: 0xb9b6ad, curb: 0xc4c1b8, grass: 0x5f7a3f, asphalt: 0x3a3c3e, apron: 0xa8a69e,
  yellow: 0xd8b52a, paintWhite: 0xe6e6e0, blue: 0x2a5db0,
  pole: 0x8c9094, head: 0x3d3f41, pier: 0xa9a69e, rail: 0xa9adb0, shelterRoof: 0x6b7378, banner: 0x4a5056, arch: 0xdfe3e6,
  dealerWall: 0xe9eaea, fascia: 0x33363a, slab: 0x2b2d30, kiosk: 0xe8e4da, pump: 0xdfe1e1, screen: 0x222628, hydrant: 0xb0221c,
  garageWall: 0x4a4846, garageRoof: 0xc42a2a, cream: 0xe6dcbc, woodPole: 0x6f5a44, lamp: 0x7c807c, trunk: 0x5a4636, leaf: 0x4f6e3a, shrub: 0x3f5f34,
};

// ---- patterns: grey-scale, so the vertex colour gives the hue. One repeat is one metre unless set. ----------------
function textures(): Record<Exclude<Tex, 'decal'>, THREE.Texture> {
  // Ribbed metal wall panels: a rib every 0.3 m, with a light edge and a shadow.
  const panel = canvas(96, 8, g => {
    g.fillStyle = grey(0.95); g.fillRect(0, 0, 96, 8);
    for (const x of [0, 32, 64]) { g.fillStyle = grey(1); g.fillRect(x, 0, 4, 8); g.fillStyle = grey(0.78); g.fillRect(x + 4, 0, 3, 8); }
  });
  panel.repeat.set(1 / 0.9, 1);
  // Storefront glass: dark panes in light mullions, 1.5 m wide and 1.2 m high.
  const glass = canvas(150, 120, g => {
    const grad = g.createLinearGradient(0, 0, 0, 120);
    grad.addColorStop(0, grey(0.75)); grad.addColorStop(1, grey(0.45));
    g.fillStyle = grad; g.fillRect(0, 0, 150, 120);
    g.fillStyle = grey(1); g.fillRect(0, 0, 6, 120); g.fillRect(0, 0, 150, 5);
  });
  glass.repeat.set(1 / 1.5, 1 / 1.2);
  // Standing-seam roof: a raised seam every half metre.
  const seam = canvas(128, 16, g => {
    g.fillStyle = grey(0.93); g.fillRect(0, 0, 128, 16);
    for (const x of [0, 64]) { g.fillStyle = grey(1); g.fillRect(x, 0, 3, 16); g.fillStyle = grey(0.7); g.fillRect(x + 3, 0, 3, 16); }
  });
  return { panel, glass, seam };
}

/**
 * LOW draws each pattern as its mean tone: the patterned walls, glass and roofs are a few boxes each, the ribs and
 * mullions are a pixel or less on a phone, and three textures, their meshes and their draws are a phone's whole margin.
 * The mean is taken in linear light, as the GPU's smallest mip level would average it.
 */
let tones: Record<'panel' | 'glass' | 'seam', number> | null = null;
function patternTones(): Record<'panel' | 'glass' | 'seam', number> {
  if (tones) return tones;
  const tex = textures(), mean = (t: THREE.Texture) => {
    const c = t.image as HTMLCanvasElement, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const c3 = new THREE.Color();
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += c3.setRGB(d[i] / 255, d[i] / 255, d[i] / 255, THREE.SRGBColorSpace).r;
    return sum / (d.length / 4);
  };
  tones = { panel: mean(tex.panel), glass: mean(tex.glass), seam: mean(tex.seam) };
  for (const t of Object.values(tex)) t.dispose();
  return tones;
}

let shared: Map<Tex | null, THREE.MeshLambertMaterial> | null = null;
/** One material per surface pattern (LOW: no patterns), and the decal material for the ground paint. */
function materials(low: boolean): Map<Tex | null, THREE.MeshLambertMaterial> {
  if (shared) return shared;
  const tex = low ? null : textures(), mats = new Map<Tex | null, THREE.MeshLambertMaterial>();
  for (const key of (low ? [null] : [null, 'panel', 'glass', 'seam']) as (Tex | null)[]) {
    const map = key && key !== 'decal' && tex ? tex[key] : null;
    mats.set(key, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map }));
  }
  // Lot paint and forecourt pads lie on the ground: drawn a little toward the camera so they never flicker in it.
  mats.set('decal', new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  return shared = mats;
}

// ---- ground decals: lot paint and pads, draped on the land in world coordinates ------------------------------------
class Decals {
  private pos: number[] = [];
  private col: number[] = [];
  /** `step`: the longest piece of a draped stripe (LOW drapes in longer pieces). */
  constructor(private site: PortHawkesburySite, private groundAt: (x: number, z: number) => number, private step = 1.5) {}
  /** A convex quad of map points, cut into cells of at most `step` metres and lifted `lift` above the land. */
  quad(q: P2[], color: number, lift: number, step = 1.5): void {
    const c = new THREE.Color(color), w = q.map(([e, n]) => this.site.world(e, n));
    const nu = Math.max(1, Math.ceil(Math.max(Math.hypot(w[1].x - w[0].x, w[1].z - w[0].z), Math.hypot(w[2].x - w[3].x, w[2].z - w[3].z)) / step));
    const nv = Math.max(1, Math.ceil(Math.max(Math.hypot(w[3].x - w[0].x, w[3].z - w[0].z), Math.hypot(w[2].x - w[1].x, w[2].z - w[1].z)) / step));
    const P = (a: number, b: number) => {
      const x = (1 - a) * (1 - b) * w[0].x + a * (1 - b) * w[1].x + a * b * w[2].x + (1 - a) * b * w[3].x;
      const z = (1 - a) * (1 - b) * w[0].z + a * (1 - b) * w[1].z + a * b * w[2].z + (1 - a) * b * w[3].z;
      return [x, this.groundAt(x, z) + lift, z];
    };
    const grid: number[][][] = [];
    for (let i = 0; i <= nu; i++) { grid.push([]); for (let k = 0; k <= nv; k++) grid[i].push(P(i / nu, k / nv)); }
    for (let i = 0; i < nu; i++) for (let k = 0; k < nv; k++) {
      const a = grid[i][k], b = grid[i + 1][k], d = grid[i + 1][k + 1], e = grid[i][k + 1];
      // Wound so the face looks up whichever way the quad was given.
      const up = (b[0] - a[0]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[0] - a[0]) < 0;
      for (const p of up ? [a, b, d, a, d, e] : [a, d, b, a, e, d]) { this.pos.push(p[0], p[1], p[2]); this.col.push(c.r, c.g, c.b); }
    }
  }
  /** A painted stripe from a to b (map points), `width` wide. */
  line(a: P2, b: P2, width: number, color: number, lift = 0.05): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) return;
    const nx = -(b[1] - a[1]) / len * width / 2, ny = (b[0] - a[0]) / len * width / 2;
    this.quad([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], color, lift, this.step);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(this.pos.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

// ---- reusable pieces -------------------------------------------------------------------------------------------------
/** An overhead door: white, with horizontal panel lines and (optionally) a row of windows. */
function overheadDoor(k: Kit, f: Face, u: number, w: number, h: number, windows: boolean): void {
  k.onWall(f, u, h / 2, w + 0.24, h + 0.12, 0, 0.06, C.frame);
  k.onWall(f, u, h / 2, w, h, 0.06, 0.04, C.door);
  if (!k.low) for (let y = h / 4; y < h - 0.1; y += h / 4) k.onWall(f, u, y, w - 0.1, 0.04, 0.1, 0.01, C.doorLine);
  if (windows) for (let i = 0; i < 4; i++) k.onWall(f, u - w / 2 + w * (i + 0.5) / 4, h * 0.7, w / 4 - 0.18, 0.36, 0.1, 0.01, C.glass);
}
function manDoor(k: Kit, f: Face, u: number, window: boolean, color = C.door): void {
  k.onWall(f, u, 1.07, 1.1, 2.2, 0, 0.05, C.frame);
  k.onWall(f, u, 1.05, 0.92, 2.1, 0.05, 0.03, color);
  if (window) k.onWall(f, u, 1.55, 0.4, 0.5, 0.08, 0.01, C.glass);
}
function windowBox(k: Kit, f: Face, u: number, y0: number, w: number, h: number, mullions = 1): void {
  k.onWall(f, u, y0 + h / 2, w + 0.16, h + 0.16, 0, 0.05, C.white);
  k.onWall(f, u, y0 + h / 2, w, h, 0.05, 0.02, C.glass);
  for (let i = 1; i <= mullions; i++) k.onWall(f, u - w / 2 + w * i / (mullions + 1), y0 + h / 2, 0.06, h, 0.07, 0.01, C.white);
}
function wallUnit(k: Kit, f: Face, u: number, y: number): void {
  k.onWall(f, u, y, 0.75, 0.45, 0, 0.38, C.unit);
  if (!k.low) k.add(new THREE.CircleGeometry(0.15, 10), 0x3a3d3f, null, f.at(u - 0.12, y, 0.39));
}
/** A blank sign: a light panel in a slim frame. */
function blankSign(k: Kit, f: Face, u: number, y: number, w: number, h: number, d = 0, panel = C.white, frame = C.frame): void {
  k.onWall(f, u, y, w + 0.12, h + 0.12, d, 0.12, frame);
  k.onWall(f, u, y, w, h, d + 0.12, 0.03, panel);
}
/** A wooden pole with a cobra-head lamp. */
function woodLamp(k: Kit, e: number, n: number, az: number, h = 9): void {
  k.point(e, n, az);
  k.cylinder(0.15, 0.12, h, 0, 0, 0, C.woodPole, 8);
  k.box(1.8, 0.08, 0.08, 0.9, h - 0.7, 0, C.lamp);
  k.box(0.65, 0.18, 0.32, 1.95, h - 0.78, 0, C.lamp);
}
function youngTree(k: Kit, x: number, z: number, h: number): void {
  if (k.low) return;
  const g = k.ground(x, z);
  k.cylinder(0.07, 0.05, h * 0.55, x, g, z, C.trunk, 6);
  const crown = new THREE.IcosahedronGeometry(h * 0.22, 0); crown.scale(1, 1.3, 1);
  k.add(crown, C.leaf, null, k.matrix(x, g + h * 0.7, z));
}
function shrub(k: Kit, x: number, z: number, r: number): void {
  if (k.low) return;
  const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, 0.7, 1);
  k.add(g, C.shrub, null, k.matrix(x, k.ground(x, z) + r * 0.45, z));
}
/** A raised curbed bed: concrete curb, grass on top, level at `top` over the frame's base. */
function bed(k: Kit, x0: number, x1: number, z0: number, z1: number, top = 0.15): void {
  k.grounded(x0, x1, z0, z1, top, C.curb);
  k.span(x0 + 0.15, x1 - 0.15, top, top + 0.02, z0 + 0.15, z1 - 0.15, C.grass);
}

// ---- the hardware and auto store (game 36) --------------------------------------------------------------------------
function hardware(k: Kit): void {
  const p = PH_PLACES.hardware;
  k.at(p, 0.15);
  const W = 19.1, H = 6.26, front = new Face('z+', W), east = new Face('x-', -43.3);
  // Masses (lidar profile, west to east): the garden yard 33.3..43.3, the main box, the raised entrance block, the
  // lower east wing.
  k.grounded(-31.3, 33.3, -W, W, H, C.storeWall, 'panel');
  k.span(-31.2, 33.2, H, H + 0.04, -W + 0.1, W - 0.1, C.roof);
  for (const [x0, x1, z0, z1] of [[-31.3, 33.3, W - 0.25, W], [-31.3, 33.3, -W, -W + 0.25], [-31.3, -31.05, -W, W], [33.05, 33.3, -W, W]]) k.span(x0, x1, H, H + 0.45, z0, z1, C.storeWall);
  k.grounded(-43.3, -31.3, -W, W, 3.8, C.storeWall, 'panel');
  k.span(-43.2, -31.3, 3.8, 3.84, -W + 0.1, W - 0.1, C.roof);
  // A thin dark base along the front and both ends.
  for (const [f, u, w] of [[front, -4.15, 54.3], [front, -37.3, 12], [east, 0, 38.2]] as [Face, number, number][]) k.onWall(f, u, 0.25, w, 0.5, 0, 0.03, C.base);
  // Rooftop units.
  if (!k.low) for (const [x, z] of [[-20, -6], [-6, -9], [8, -4], [24, -10], [-24, 8]]) k.span(x - 1.3, x + 1.3, H, H + 1.3, z - 0.9, z + 0.9, C.unit);
  // The garden yard at the west end: posts, rails and a dark shade-cloth roof at 3.8 m, plant tables inside.
  k.grounded(33.3, 43.3, -W, W, 0.12, C.concrete);
  for (let x = 33.3; x <= 43.31; x += 2.5) for (const z of [-W, W]) k.box(0.12, 3.8, 0.12, x, 1.9, z, C.frame);
  for (let z = -W; z <= W + 0.01; z += 3.82) k.box(0.12, 3.8, 0.12, 43.3, 1.9, z, C.frame);
  for (const y of [0.15, 1.2, 2.3]) {
    for (const z of [-W, W]) k.box(10, 0.06, 0.06, 38.3, y, z, C.frame);
    k.box(0.06, 0.06, 2 * W, 43.3, y, 0, C.frame);
  }
  if (!k.low) for (const f of [new Face('z+', W), new Face('z-', -W)]) for (let u = -4.5; u <= 4.5; u += 3) k.onWall(f, f.normal === 'z+' ? 38.3 + u : -38.3 - u, 1.2, 2.4, 2.1, -0.02, 0.01, 0x7d8386);
  k.span(33.3, 43.4, 3.8, 3.9, -W, W, C.shade);
  if (!k.low) for (let z = -15; z <= 15; z += 6) { k.span(35, 41.5, 0.12, 0.85, z - 0.6, z + 0.6, 0x6b5a45); k.span(35.2, 41.3, 0.85, 1.1, z - 0.5, z + 0.5, C.shrub); }
  // The long, low, dark garden-centre canopy along the west part of the front, with the blank sign box at its west end.
  k.span(23, 43.3, 3.9, 4.15, W, 26.1, C.shade);
  k.span(23, 43.3, 3.75, 3.9, 25.9, 26.1, C.shade);
  for (const x of CANOPY_POSTS) k.box(0.18, 3.9, 0.18, x, 1.95, 25.75, C.frame);
  k.span(37.5, 43.0, 4.15, 5.45, 24.4, 25.8, C.frame);
  k.span(37.6, 42.9, 4.25, 5.35, 25.8, 25.84, C.white);
  // The raised entrance block: square and white, about 2 m above the parapet, with a large blank emblem panel.
  const EZ = 20.2, entrance = new Face('z+', EZ);
  k.grounded(3.4, 19.8, 8, EZ, 8.2, C.white, 'panel');
  k.span(3.5, 19.7, 8.2, 8.24, 8.1, EZ - 0.1, C.roof);
  k.onWall(entrance, 11.6, 6.45, 6.0, 2.7, 0, 0.1, C.frame);
  k.onWall(entrance, 11.6, 6.45, 5.7, 2.4, 0.1, 0.04, C.emblem);
  // A wide glazed entrance in a grid of storefront glass, a shallow canopy and paired automatic doors.
  k.span(5.6, 17.6, 0.15, 4.4, EZ, EZ + 0.04, C.white, 'glass');
  k.span(5.4, 17.8, 4.4, 4.6, EZ, EZ + 0.08, C.frame);
  for (const u of [8.6, 14.6]) {
    k.onWall(entrance, u, 1.25, 2.6, 2.5, 0.04, 0.06, C.frame);
    k.onWall(entrance, u - 0.62, 1.2, 1.18, 2.3, 0.1, 0.02, C.glass);
    k.onWall(entrance, u + 0.62, 1.2, 1.18, 2.3, 0.1, 0.02, C.glass);
  }
  k.span(5.2, 18.0, 3.6, 3.85, EZ, EZ + 2.4, C.white);
  // Cart bays both sides of the entrance: a roofed bay against the wall, nested carts.
  for (const [x0, x1] of [[0.2, 3.4], [19.8, 22.9]]) {
    k.span(x0, x1, 2.6, 2.75, W, W + 2.2, C.frame);
    for (const x of CART_BAY_POSTS.filter(x => x > x0 && x < x1)) k.box(0.1, 2.6, 0.1, x, 1.3, W + 2.1, C.frame);
    if (!k.low) for (const x of [x0 + 0.9, x1 - 0.9]) { k.span(x - 0.3, x + 0.3, 0.2, 1.05, W + 0.2, W + 2.0, C.cart); k.span(x - 0.32, x + 0.32, 1.0, 1.08, W + 1.9, W + 2.05, C.cartDark); }
  }
  // A plain wall east of the entrance with a few small notice panels.
  for (const x of [-4, -7.5, -11]) k.onWall(front, x, 1.7, 0.9, 1.25, 0, 0.03, C.notice);
  // Auto service near the east end: three white overhead doors under a long blank sign band. Then the lower east wing.
  for (const x of [-21.5, -25.8, -30.1]) overheadDoor(k, front, x, 3.6, 3.6, true);
  blankSign(k, front, -25.6, 4.75, 11, 0.9);
  manDoor(k, front, -35, true);
  windowBox(k, front, -39.3, 1.0, 2.0, 1.2);
  manDoor(k, east, 8, false);
  // The front walk: a curbed concrete sidewalk the length of the store.
  k.grounded(-43.3, 33.3, W, W + 1.6, 0.02, C.concrete);
  k.grounded(33.3, 43.3, W, 26.1, 0.02, C.concrete);
}

/** The hardware store's pylon: a white box sign on two posts, a reader board under it. */
function pylonBox(k: Kit, sign: Sign): void {
  k.point(sign.at[0], sign.at[1], sign.az);
  const g = Math.min(k.ground(-2, 0), k.ground(2, 0));
  k.span(-2.4, 2.4, g - 0.3, g + 0.5, -0.6, 0.6, C.concrete);
  for (const x of [-1.5, 1.5]) k.span(x - 0.2, x + 0.2, g, g + 5.6, -0.2, 0.2, C.frame);
  k.span(-2.2, 2.2, g + 5.5, g + 8.0, -0.35, 0.35, C.white);
  k.span(-2.25, 2.25, g + 7.95, g + 8.1, -0.38, 0.38, C.frame);
  k.span(-1.9, 1.9, g + 4.0, g + 5.2, -0.15, 0.15, C.frame);
  k.span(-1.8, 1.8, g + 4.1, g + 5.1, -0.17, 0.17, C.slab);
}

// ---- lot furniture -------------------------------------------------------------------------------------------------
/** A tall slim steel lot pole: one arm with one shoebox head, or two back to back, or a cluster of three or four. */
function lotPole(k: Kit, e: number, n: number, az: number, h: number, heads: number, curved: boolean): void {
  k.point(e, n, az);
  const g = k.ground(0, 0);
  k.cylinder(0.32, 0.32, 0.9, 0, g - 0.3, 0, C.pier, 8);
  k.cylinder(0.13, 0.08, h - 0.6, 0, g + 0.6, 0, C.pole, 8);
  for (let i = 0; i < heads; i++) {
    const a = heads === 1 ? 0 : (i / heads) * Math.PI * 2, y = g + h - 0.35;
    if (curved) {
      k.box(0.08, 0.08, 1.0, 0, y + 0.25, 0.45, C.pole, { rx: -0.6 });
      k.box(0.08, 0.08, 0.9, 0, y + 0.5, 1.25, C.pole, { rx: 0.35 });
      k.box(0.5, 0.18, 0.9, 0, y + 0.28, 1.8, C.head);
    } else {
      const len = heads === 1 ? 1.4 : 0.9, cx = Math.sin(a) * len / 2, cz = Math.cos(a) * len / 2;
      k.box(0.08, 0.08, len, cx, y, cz, C.pole, { ry: a });
      k.box(0.55, 0.2, 0.85, Math.sin(a) * (len + 0.35), y - 0.02, Math.cos(a) * (len + 0.35), C.head, { ry: a });
    }
  }
}

/** A curbed island over a stall (or two back to back). */
function island(k: Kit, lot: LotSpec, w0: number, w1: number, u0: number, u1: number): void {
  const [e, n] = lotToMap(lot, (w0 + w1) / 2, (u0 + u1) / 2);
  k.point(e, n, lot.az);
  bed(k, -(w1 - w0) / 2 + 0.1, (w1 - w0) / 2 - 0.1, -(u1 - u0) / 2 + 0.1, (u1 - u0) / 2 - 0.1);
}

/** A teardrop island: a round head toward the lot, a long tail toward the entrance, curbed, grass on top. */
function teardrop(k: Kit, lot: LotSpec, w: number, u: number, len: number): void {
  const [e, n] = lotToMap(lot, w, u);
  k.point(e, n, lot.az);
  const r = 1.6, s = new THREE.Shape();
  s.moveTo(len / 2, 0); s.lineTo(-len / 2 + r, r); s.absarc(-len / 2 + r, 0, r, Math.PI / 2, Math.PI * 1.5, false); s.closePath();
  const g = Math.min(k.ground(-len / 2, 0), k.ground(len / 2, 0), k.ground(0, r), k.ground(0, -r));
  const curb = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false, curveSegments: k.low ? 4 : 8 });
  curb.rotateX(-Math.PI / 2);
  k.add(curb, C.curb, null, k.matrix(0, g - 0.45, 0));
  const top = new THREE.ShapeGeometry(s, k.low ? 4 : 8); top.rotateX(-Math.PI / 2); top.scale(0.9, 1, 0.82);
  k.add(top, C.grass, null, k.matrix(0, g + 0.16, 0));
}

/** A cart corral in a stall: rails on three sides; a shelter adds a gable roof and blank banner sides; the arched kind a
 *  barrel canopy. */
function corral(k: Kit, lot: LotSpec, c: { w0: number; w1: number; u0: number; u1: number }, kind: 'corral' | 'shelter' | 'arched'): void {
  const [e, n] = lotToMap(lot, (c.w0 + c.w1) / 2, (c.u0 + c.u1) / 2);
  k.point(e, n, lot.az);
  const L = STALL_D / 2 - 0.5, Wd = 0.75, g = k.ground(0, 0);
  for (const z of [-Wd, Wd]) { k.box(2 * L, 0.06, 0.06, 0, g + 0.95, z, C.rail); k.box(2 * L, 0.06, 0.06, 0, g + 0.45, z, C.rail); }
  k.box(0.06, 0.06, 2 * Wd, -L, g + 0.95, 0, C.rail);
  if (kind === 'arched') for (const [x, z] of [[-L, -1.2], [-L, 1.2], [L, -1.2], [L, 1.2]]) k.box(0.08, 1.3, 0.08, x, g + 0.65, z, C.rail);
  else for (const [x, z] of [[-L, -Wd], [-L, Wd], [L, -Wd], [L, Wd]]) k.box(0.08, kind === 'corral' ? 1.0 : 2.5, 0.08, x, g + (kind === 'corral' ? 0.5 : 1.25), z, C.rail);
  if (kind === 'shelter') {
    k.roof({ a0: -L, a1: L, w: Wd + 0.2, eave: g + 2.5, rise: 0.5, alongX: true, color: C.shelterRoof, tex: null, over: 0.15 });
    for (const z of [-Wd, Wd]) k.box(2 * L - 0.3, 0.8, 0.03, 0, g + 1.95, z, C.banner);
  }
  if (kind === 'arched') {
    // A barrel canopy overhead: the half cylinder's feet on the four legs at z = +-1.2, its crown 2.5 m up.
    const arch = new THREE.CylinderGeometry(1.2, 1.2, 2 * L, k.low ? 6 : 12, 1, true, 0, Math.PI);
    arch.rotateZ(Math.PI / 2);
    k.add(arch, C.arch, null, k.matrix(0, g + 1.3, 0));
  }
  if (!k.low) for (let x = -L + 0.6; x < L - 0.5; x += 1.4) { k.span(x - 0.45, x + 0.45, g + 0.2, g + 1.0, -0.3, 0.3, C.cart); }
}

/** A lot: paint and pads as decals; islands, teardrops, poles, curbs and corrals in the kit; parked vehicles. */
function lot(k: Kit, d: Decals, spec: LotSpec, layout: LotLayout, site: PortHawkesburySite, parked: Parked[]): void {
  const paint = spec.paint === 'yellow' ? C.yellow : C.paintWhite, M = (w: number, u: number) => lotToMap(spec, w, u);
  for (const [w0, u0, w1, u1] of layout.lines) d.line(M(w0, u0), M(w1, u1), 0.12, paint);
  for (const [w0, u0, w1, u1] of layout.hatch) d.line(M(w0, u0), M(w1, u1), 0.12, paint);
  for (const c of layout.cells) {
    if (c.kind === 'island') island(k, spec, c.w0, c.w1, c.u0, c.u1);
    else if (c.kind === 'corral' || c.kind === 'shelter' || c.kind === 'arched') corral(k, spec, c, c.kind);
    else if (c.kind === 'accessible') {
      // The blue symbol: a blue square with a white wheel and seat (LOW: the square only).
      const wm = c.w0 + STALL_D * 0.55, um = (c.u0 + c.u1) / 2, s = 0.65;
      d.quad([M(wm - s, um - s), M(wm + s, um - s), M(wm + s, um + s), M(wm - s, um + s)], C.blue, 0.055, 2);
      if (!k.low) {
        for (let i = 0; i < 8; i++) {
          const a0 = i / 8 * Math.PI * 2, a1 = (i + 1) / 8 * Math.PI * 2, r = 0.32;
          d.line(M(wm - 0.12 + Math.cos(a0) * r, um + Math.sin(a0) * r), M(wm - 0.12 + Math.cos(a1) * r, um + Math.sin(a1) * r), 0.07, C.paintWhite, 0.06);
        }
        d.line(M(wm + 0.15, um), M(wm + 0.5, um), 0.1, C.paintWhite, 0.06);
        d.line(M(wm + 0.15, um), M(wm + 0.15, um + 0.3), 0.1, C.paintWhite, 0.06);
      }
    }
    if (c.parked) {
      const pose = parkedPose(spec, c), p = site.world(...M(pose.w, pose.u));
      parked.push({ x: p.x, z: p.z, heading: pose.az * Math.PI / 180, type: c.parked.type, colour: c.parked.colour });
    }
  }
  for (const [w, u, len] of layout.teardrops) teardrop(k, spec, w, u, len);
  for (const [w, u] of layout.poles) { const [e, n] = M(w, u); lotPole(k, e, n, spec.az, spec.pole.h, spec.pole.heads, !!spec.pole.curved); }
  for (const [a, b] of layout.curbs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), az = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
    k.point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, az);
    k.grounded(-len / 2, len / 2, -0.08, 0.08, 0.15, C.curb);
  }
}

// ---- dealers and gas bars ------------------------------------------------------------------------------------------
function dealerA(k: Kit): void {
  const p = PH_PLACES.dealerA;
  k.at(p, 0.15);
  // The showroom (game 103): double-height glass to Paint St and to the west, white panels, a charcoal fascia.
  const [x0, x1, z0, z1] = [-29, -9.7, -14.6, 16.8], H = 5.8;
  k.grounded(x0, x1, z0, z1, H, C.dealerWall, 'panel');
  k.span(x0 + 1, x1 - 1, 0.15, H - 1.2, z1, z1 + 0.05, C.white, 'glass');
  k.span(x0 - 0.05, x0, 0.15, H - 1.2, 0, z1 - 1, C.white, 'glass');
  k.span(x0 - 0.15, x1 + 0.15, H - 1.2, H + 0.1, z0 - 0.15, z1 + 0.15, C.fascia);
  k.span(x0, x1, H + 0.1, H + 0.14, z0, z1, C.roof);
  manDoor(k, new Face('z+', z1 + 0.05), -19.4, false, C.glass);
  // The link and the long white service wing behind, with its service bay doors toward the lot.
  k.grounded(-9.7, 5.3, -14.2, -6.9, 4.6, C.dealerWall, 'panel');
  k.grounded(5.3, 31.7, -14.1, -1.4, 4.8, C.dealerWall, 'panel');
  for (const [a, b, c, d, h] of [[-9.7, 5.3, -14.2, -6.9, 4.6], [5.3, 31.7, -14.1, -1.4, 4.8]]) {
    k.span(a, b, h, h + 0.04, c, d, C.roof);
    k.span(a, b, h - 0.5, h + 0.05, d, d + 0.05, C.fascia);
  }
  const wing = new Face('z+', -1.4);
  for (const x of [9.5, 14.5, 19.5, 24.5]) overheadDoor(k, wing, x, 3.6, 3.7, true);
  manDoor(k, wing, 29.3, true);
  windowBox(k, new Face('z+', -6.9), -2.2, 1.0, 6, 1.4, 3);
  if (!k.low) for (const [x, z] of [[-22, -6], [-15, 6], [18, -8]]) k.span(x - 1, x + 1, H + 0.1, H + 1.1, z - 0.8, z + 0.8, C.unit);
  // The tall white pylon (blank), in a curbed bed with shrubs at the lot corner.
  const sign = PH_SIGNS.dealerAPylon;
  k.point(sign.at[0], sign.at[1], sign.az);
  const g = k.ground(0, 0);
  bed(k, -2.2, 2.2, -1.6, 1.6, g + 0.15);
  k.span(-0.8, 0.8, g, g + 10, -0.45, 0.45, C.white);
  k.span(-0.7, 0.7, g + 6.6, g + 9.4, -0.47, 0.47, C.emblem);
  for (const [x, z] of [[-1.5, -0.9], [1.5, 0.9], [1.4, -1.0]]) shrub(k, x, z, 0.5);
}

function dealerB(k: Kit): void {
  const p = PH_PLACES.dealerB;
  k.at(p, 0.15);
  const H = 5.2, X = -19.5;
  k.grounded(X, 23, -18.5, 18.5, H, C.dealerWall, 'panel');
  k.span(X + 0.1, 22.9, H, H + 0.04, -18.4, 18.4, C.roof);
  // The glazed showroom to Paint St (west) under a charcoal fascia that wraps the corners.
  k.span(X - 0.05, X, 0.15, H - 1.1, -17.5, 8, C.white, 'glass');
  k.span(X - 0.2, X + 8, H - 1.1, H + 0.15, -18.65, 18.65, C.fascia);
  manDoor(k, new Face('x-', X - 0.05), -5, false, C.glass);
  // Service doors on the south side.
  const south = new Face('z+', 18.5);
  for (const x of [2, 7, 12, 17]) overheadDoor(k, south, x, 3.6, 3.6, true);
  // The dark slab pylon, about 9 m, blank.
  const sign = PH_SIGNS.dealerBPylon;
  k.point(sign.at[0], sign.at[1], sign.az);
  const g = k.ground(0, 0);
  k.span(-1.2, 1.2, g - 0.3, g + 9, -0.3, 0.3, C.slab);
  k.span(-0.95, 0.95, g + 6.3, g + 8.4, -0.32, 0.32, C.fascia);
}

/** A gas bar: a flat canopy on four square columns over two pump islands, a neutral fascia; a small flat-roofed kiosk. */
function gasBar(k: Kit, p: PhPlace, kiosk: [number, number, number, number], trees: P2[] = []): void {
  k.at(p, 0.1);
  const top = 5.3;
  k.span(-9, 9, top - 0.75, top, 0.5, 11.5, C.white);
  k.span(-8.9, 8.9, top - 0.78, top - 0.75, 0.6, 11.4, 0xd5d7d8);
  k.span(-9.05, 9.05, top - 0.55, top - 0.15, 0.45, 11.55, C.emblem);
  for (const [x, z] of GAS_COLUMNS) k.box(0.45, top - 0.75, 0.45, x, (top - 0.75) / 2, z, C.white);
  for (const x of GAS_ISLANDS) {
    k.grounded(x - 0.6, x + 0.6, 3, 9, 0.2, C.concrete);
    for (const z of [4.8, 7.2]) {
      k.span(x - 0.3, x + 0.3, 0.2, 1.9, z - 0.45, z + 0.45, C.pump);
      k.span(x - 0.32, x + 0.32, 1.2, 1.6, z - 0.3, z + 0.3, C.screen);
    }
  }
  if (!k.low) for (const x of [-6.8, -2.3, 2.3, 6.8]) k.span(x - 0.5, x + 0.5, top - 0.8, top - 0.78, 1.5, 10.5, 0xf6f6ee);
  const [x0, x1, z0, z1] = kiosk, front = new Face('z+', z1);
  k.grounded(x0, x1, z0, z1, 4.0, C.kiosk, 'panel');
  k.span(x0 - 0.1, x1 + 0.1, 3.4, 4.3, z0 - 0.1, z1 + 0.1, C.emblem);
  k.span(x0, x1, 4.3, 4.34, z0, z1, C.roof);
  const mid = (x0 + x1) / 2;
  k.span(mid - 3.8, mid + 3.8, 0.4, 2.9, z1, z1 + 0.04, C.white, 'glass');
  manDoor(k, front, mid + 4.6, false, C.glass);
  k.grounded(x0 - 0.5, x1 + 0.5, z1, z1 + 1.6, 0.15, C.concrete);
  wallUnit(k, new Face('x+', x1), 0.5 - (z0 + z1) / 2, 0.6);   // on an x+ wall, u runs along -z
  for (const [x, z] of trees) { bed(k, x - 1.4, x + 1.4, z - 1.4, z + 1.4); youngTree(k, x, z, 4); }
}

// ---- the corner garage (game 1133), brief section 1 ----------------------------------------------------------------
function garage(k: Kit): void {
  const p = PH_PLACES.garage;
  k.at(p, 0.15);
  const L = 9.7, W = 6.1, eave = 4.5, rise = 2.5;
  const west = new Face('z-', -W), south = new Face('x-', -L), north = new Face('x+', L), east = new Face('z+', W);
  // Dark charcoal-brown vertical siding; a front-gable roof of red standing-seam metal (about 22 degrees).
  k.grounded(-L, L, -W, W, eave, C.garageWall, 'panel');
  k.gable(south, 0, W, eave, rise, C.cream, 'panel');
  k.gable(north, 0, W, eave, rise, C.garageWall, 'panel');
  k.roof({ a0: -L, a1: L, w: W, eave, rise, over: 0.35, endOver: 0.3, alongX: true, color: C.garageRoof, tex: 'seam', fascia: C.garageRoof, rake: true });
  k.box(2 * L + 0.6, 0.12, 0.3, 0, eave + rise + 0.04, 0, 0xa82424);
  // The south gable: cream, a pair of small windows near the top.
  for (const u of [-0.75, 0.75]) windowBox(k, south, u, eave + 0.55, 0.55, 0.6, 0);
  // West side (to Sydney Rd), north to south: the tall overhead door, two sectional bay doors with window rows, a man
  // door with a small window, the office window, a blank white sign panel, a wall air conditioner.
  overheadDoor(k, west, -7.3, 3.6, 4.0, false);
  overheadDoor(k, west, -3.1, 3.0, 3.2, true);
  overheadDoor(k, west, 0.6, 3.0, 3.2, true);
  manDoor(k, west, 3.2, true);
  windowBox(k, west, 5.3, 1.0, 1.8, 1.2, 1);
  blankSign(k, west, 5.6, 3.5, 3.0, 0.8, 0, C.white, C.white);
  wallUnit(k, west, 8.2, 1.7);
  // South end (to Granville St): an overhead door at the east side under a small red pent roof, a man door with a window,
  // a wall air conditioner and a white double window at the lower west.
  overheadDoor(k, south, 3.0, 3.0, 3.1, false);
  k.add(new THREE.BoxGeometry(3.7, 0.1, 1.0), C.garageRoof, null, south.at(3.0, 3.5, 0.45).multiply(new THREE.Matrix4().makeRotationX(0.3)));
  manDoor(k, south, -0.4, true);
  wallUnit(k, south, 0.9, 2.5);
  windowBox(k, south, -3.8, 0.9, 1.6, 1.1, 1);
  manDoor(k, east, -2, false, C.garageWall);
  // Small round pot lights under the west eave.
  if (!k.low) for (let x = -8; x <= 8; x += 4) k.cylinder(0.09, 0.09, 0.05, x, eave - 0.3, -W - 0.22, 0xfaf7e8, 8);
  // Wooden utility poles with cobra heads, arms toward Sydney Rd: the lot's south-west corner, and across the road.
  PH_ITEMS.garageLamps.forEach(([e, n], i) => woodLamp(k, e, n, PH_ITEMS.garageLampArms[i]));
}

// ---- building a group ------------------------------------------------------------------------------------------------
export interface Built {
  /** The models' geometry, one per surface pattern (the runner merges it into its cluster's meshes, then disposes it). */
  models: Map<Tex | null, THREE.BufferGeometry>;
  /**
   * The lot paint and pads, and on LOW the parked vehicles baked in place (desktop instances `cars` on `ground`, as
   * ~600 baked vehicles would hold ~15 MB): kept, as the cluster shows them only while near.
   */
  decal: THREE.BufferGeometry | null;
  vehicles: THREE.BufferGeometry | null;
  cars: Parked[];
  /** The heights under the cars, frozen when the group built (desktop seats its instances on them). */
  ground: (x: number, z: number) => number;
  parkedSolids: Solid[];
  /** Surface patterns plus the paint (what used to be this group's own meshes), and their triangles. */
  meshes: number;
  triangles: number;
  layouts: Partial<Record<string, LotLayout>>;
  solids: Solid[];
}

const tris = (g: THREE.BufferGeometry | null | undefined) => g ? g.attributes.position.count / 3 : 0;
/** One new geometry from several (the inputs are left as they are), with its bounds for culling. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  if (!g) throw new Error('Port Hawkesbury: geometry could not be merged');
  g.computeBoundingSphere();
  return g;
}

/** Build one group: the models into one geometry per surface pattern, the paint and pads into one decal geometry. */
export function buildGroup(name: GroupName, site: PortHawkesburySite, groundAt: (x: number, z: number) => number, low: boolean,
  roads: MapRoad[], buildings: Building[], paved: (p: P2) => boolean, laid: Partial<Record<string, LotLayout>> = {}): Built {
  const kit: Kit = new SiteKit(low, site.village, groundAt), decals = new Decals(site, groundAt, low ? 3 : 1.5), parked: Parked[] = [];
  const layouts: Partial<Record<string, LotLayout>> = {}, solids: Solid[] = [];
  for (const ref of PH_GROUPS[name].lots) {
    const spec = PH_LOTS[ref] as LotSpec, layout = laid[ref] ?? layoutLot(spec, site.clearance(spec, roads, buildings, paved));
    layouts[ref] = layout;
    solids.push(...lotSolids(spec, layout, (e, n) => site.world(e, n)));
    lot(kit, decals, spec, layout, site, parked);
  }
  // The garage apron, until the land paves P1 (a quad whose middle is paved already is left out).
  if (name === 'garage') for (const q of GARAGE_APRON) {
    const mid: P2 = [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
    if (!paved(mid)) decals.quad(q, C.asphalt, 0.03, low ? 3 : 1.5);
  }
  for (const [place, x, z, az, type, colour] of PLACE_VEHICLES) {
    if (!(PH_GROUPS[name].places as string[]).includes(place)) continue;
    const p = PH_PLACES[place], w = site.world(...toMap(p, x, z));
    parked.push({ x: w.x, z: w.z, heading: (p.az + az) * Math.PI / 180, type, colour });
  }
  for (const [place, x0, x1, z0, z1, kind] of PH_PADS) {
    if (!(PH_GROUPS[name].places as string[]).includes(place)) continue;
    const q = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => toMap(PH_PLACES[place], x, z));
    decals.quad(q, kind === 'asphalt' ? C.asphalt : C.apron, kind === 'asphalt' ? 0.03 : 0.04, low ? 3 : 1.5);
  }
  for (const place of PH_GROUPS[name].places) {
    if (place === 'hardware') { hardware(kit); pylonBox(kit, PH_SIGNS.hardwarePylon); hydrant(kit, PH_ITEMS.hardwareHydrant); }
    if (place === 'gasBar') { gasBar(kit, PH_PLACES.gasBar, [4, 16, -11, -3.5], GAS_TREES.gasBar); multiPylon(kit, PH_SIGNS.plazaPylon); }
    if (place === 'eastGas') gasBar(kit, PH_PLACES.eastGas, [-6, 6, -20, -12], GAS_TREES.eastGas);
    if (place === 'dealerA') dealerA(kit);
    if (place === 'dealerB') { dealerB(kit); bigBoxPylon(kit, PH_SIGNS.bigBoxPylon); }
    if (place === 'garage') garage(kit);
  }
  if (low) {
    // LOW: each pattern becomes its mean tone, multiplied into the vertex colour; the parts join the plain ones.
    const tone = patternTones(), plain = kit.parts.get(null) ?? [];
    for (const [tex, parts] of [...kit.parts]) {
      if (!tex || tex === 'decal') continue;
      for (const g of parts) {
        const col = g.attributes.color, t = tone[tex];
        for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * t, col.getY(i) * t, col.getZ(i) * t);
        g.deleteAttribute('uv');
        plain.push(g);
      }
      kit.parts.delete(tex);
    }
    kit.parts.set(null, plain);
  }
  const models = new Map<Tex | null, THREE.BufferGeometry>();
  for (const [tex, parts] of kit.parts) {
    if (!parts.length) continue;
    const geometry = mergeGeometries(parts);
    if (!geometry) throw new Error(`ph-${name}: geometry could not be merged`);
    for (const p of parts) p.dispose();
    models.set(tex, geometry);
  }
  const decal = decals.geometry();
  // LOW parks one vehicle in three (a phone draws every one of their triangles).
  const cars = low ? parked.filter((_, i) => i % 3 === 0) : parked;
  const vehicles = low ? bakeParked(cars, groundAt) : null;
  // Desktop seats its instanced vehicles again whenever the near set changes: on the heights read now, while the finest
  // land is under the group, not on whatever land is in memory then.
  const heights = new Map<string, number>(), ground = (x: number, z: number) => {
    const key = `${x},${z}`;
    let y = heights.get(key);
    if (y === undefined) heights.set(key, y = groundAt(x, z));
    return y;
  };
  if (!low) { const o = new THREE.Object3D(); for (const car of cars) parkedMatrix(car, ground, o); }
  const triangles = [...models.values()].reduce((n, g) => n + tris(g), 0) + tris(decal);
  return { models, decal, vehicles, cars, ground, parkedSolids: cars.map(parkedSolid), meshes: models.size + (decal ? 1 : 0), triangles, layouts, solids };
}

function hydrant(k: Kit, [e, n]: P2): void {
  k.point(e, n, 0);
  const g = k.ground(0, 0);
  k.cylinder(0.14, 0.12, 0.75, 0, g, 0, C.hydrant, 10);
  k.add(new THREE.SphereGeometry(0.14, 8, 6), C.hydrant, null, k.matrix(0, g + 0.78, 0));
  k.box(0.42, 0.1, 0.1, 0, g + 0.5, 0, C.hydrant);
}
/** The plaza's multi-tenant pylon: a frame of blank panels on a base. */
function multiPylon(k: Kit, sign: Sign): void {
  k.point(sign.at[0], sign.at[1], sign.az);
  const g = Math.min(k.ground(-1.6, 0), k.ground(1.6, 0));
  k.span(-1.8, 1.8, g - 0.3, g + 0.8, -0.5, 0.5, C.concrete);
  k.span(-1.5, 1.5, g + 0.8, g + 8.2, -0.3, 0.3, C.frame);
  for (let i = 0; i < 4; i++) k.span(-1.35, 1.35, g + 1.4 + i * 1.6, g + 2.7 + i * 1.6, -0.33, 0.33, i === 3 ? C.white : C.emblem);
}
/** The big-box store's tall pylon at the lot entrance (the store stands in the land). */
function bigBoxPylon(k: Kit, sign: Sign): void {
  k.point(sign.at[0], sign.at[1], sign.az);
  const g = Math.min(k.ground(-2, 0), k.ground(2, 0));
  for (const x of [-1.6, 1.6]) k.span(x - 0.3, x + 0.3, g - 0.3, g + 9, -0.3, 0.3, C.frame);
  k.span(-2.2, 2.2, g + 9, g + 12.5, -0.4, 0.4, C.white);
  k.span(-2.25, 2.25, g + 12.45, g + 12.6, -0.42, 0.42, C.frame);
}

// ---- the runner ------------------------------------------------------------------------------------------------------
/**
 * Groups that stand together share their meshes: the Reeves St side with the corner garage (within 600 m of each
 * other) and the east plaza north and south of Paint St. A cluster's meshes stay small enough to be culled as a whole.
 */
export const PH_CLUSTER: Record<GroupName, 'west' | 'east'> = { reeves: 'west', plaza: 'west', garage: 'west', eastNorth: 'east', eastSouth: 'east' };
type ClusterName = (typeof PH_CLUSTER)[GroupName];
interface Cluster { models: Map<Tex | null, THREE.Mesh>; decal: THREE.Mesh; vehicles: THREE.Mesh; parked: ParkedVehicles | null; near: string }

/** Each group builds once, when the camera comes within reach and the finest land under it is in memory. */
export class PortHawkesbury {
  readonly group = new THREE.Group();
  triangles = 0;
  readonly built = new Map<GroupName, Built>();
  private pending: { name: GroupName; x: number; z: number; probes: { x: number; z: number }[]; box: number[]; laid: Partial<Record<string, LotLayout>> }[];
  private nextProbe = 0;
  private nextLook = 0;
  private loading: Promise<void> | null = null;
  private pavedTiles = new Map<string, Uint8Array | null>();
  private failures = new Map<string, number>();
  private keepers: THREE.Mesh[] = [];
  constructor(readonly site: PortHawkesburySite, private terrain: Terrain, private low: boolean, private roads: MapRoad[], private buildings: Building[]) {
    this.group.name = 'port-hawkesbury';
    this.solids.push(...site.solids);
    this.pending = (Object.keys(PH_GROUPS) as GroupName[]).map(name => {
      const pts = groupPoints(name), xs = pts.map(p => p[0]), ns = pts.map(p => p[1]);
      const c = site.world((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ns) + Math.max(...ns)) / 2);
      return { name, ...c, probes: pts.map(([e, n]) => site.world(e, n)), box: [Math.min(...xs), Math.min(...ns), Math.max(...xs), Math.max(...ns)], laid: {} };
    });
    // The materials exist from the start, with one empty mesh each in the picture, so their shaders build with the
    // scene and not mid-drive (as judique-village.ts). A keeper goes once a built mesh uses its material.
    for (const [tex, material] of materials(low)) {
      const g = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ...(tex && tex !== 'decal' ? [['uv', 2]] : [])] as [string, number][]) g.setAttribute(name, new THREE.Float32BufferAttribute([], size));
      const keeper = new THREE.Mesh(g, material);
      keeper.name = `ph-keeper-${tex ?? 'paint'}`; keeper.frustumCulled = false;
      this.group.add(keeper); this.keepers.push(keeper);
    }
  }
  get done(): boolean { return this.pending.length === 0; }
  /** Groups built so far, by name. */
  get names(): GroupName[] { return [...this.built.keys()]; }
  update(view: { x: number; z: number }, now: number): void {
    if (now < this.nextLook) return;
    this.nextLook = now + 400;
    // The paint and the parked vehicles of a far group are left out (the models stay, like every building).
    for (const name of this.clusters.keys()) this.showNear(name, view);
    if (!this.pending.length || this.loading || now < this.nextProbe) return;
    const reach = this.low ? 380 : 520;
    for (const item of [...this.pending]) {
      if (Math.hypot(view.x - item.x, view.z - item.z) > reach + 150) continue;
      if (item.probes.some(p => this.terrain.levelAt(p.x, p.z) < 8)) continue;
      const fallback = this.terrain.constructionHeightAt(item.x, item.z);
      if (fallback === null) continue;
      const keys = pavedKeys(item.box as [number, number, number, number]).filter(key => !this.pavedTiles.has(key));
      if (keys.length && this.terrain.paved) {
        const paved = this.terrain.paved;
        // A tile that fails three times counts as unpaved, so a lost tile never holds the build back for ever.
        // Failures back off (2, 4, 8 s) before the next try.
        let backoff = 0;
        this.loading = Promise.all(keys.map(key => paved.treeMask(key).then(t => { this.pavedTiles.set(key, t); }, () => {
          const n = (this.failures.get(key) ?? 0) + 1; this.failures.set(key, n); if (n >= 3) this.pavedTiles.set(key, null);
          if (n < 3) backoff = Math.max(backoff, 1000 * 2 ** n);
        })))
          .then(() => { this.loading = null; this.nextProbe = backoff ? performance.now() + backoff : 0; });
        return;
      }
      // Without the paved layer (paved=0) no lot is painted: lines on grass would be wrong.
      const pavedAt = this.terrain.paved ? pavedTest(this.pavedTiles) : () => false;
      // One lot is laid out per update, then the geometry is built in a later one: no frame does all of it.
      const lot = (PH_GROUPS[item.name].lots as string[]).find(ref => !item.laid[ref]);
      if (lot) {
        const spec = PH_LOTS[lot as keyof typeof PH_LOTS] as LotSpec;
        item.laid[lot] = layoutLot(spec, this.site.clearance(spec, this.roads, this.buildings, pavedAt));
        this.nextProbe = now + 50;
        return;
      }
      const built = buildGroup(item.name, this.site, (x, z) => this.terrain.constructionHeightAt(x, z) ?? fallback, this.low, this.roads, this.buildings, pavedAt, item.laid);
      this.triangles += built.triangles;
      this.built.set(item.name, built);
      const [e0, n0, e1, n1] = item.box, a = this.site.world(e0, n1), b = this.site.world(e1, n0);
      this.boxes.set(item.name, [a.x, a.z, b.x, b.z]);
      this.solids.push(...built.solids, ...built.parkedSolids);
      this.pending.splice(this.pending.indexOf(item), 1);
      // The models join their cluster's mesh per pattern; the paint and vehicles are shown with the cluster's near groups.
      const cluster = this.cluster(PH_CLUSTER[item.name]), used = new Set<THREE.Material>();
      for (const [tex, geometry] of built.models) {
        const mesh = cluster.models.get(tex)!, old = mesh.geometry;
        mesh.geometry = old.attributes.position?.count ? merged([old, geometry]) : merged([geometry]);
        old.dispose(); geometry.dispose();
        mesh.visible = true; used.add(mesh.material as THREE.Material);
      }
      built.models.clear();
      cluster.near = '?';
      this.showNear(PH_CLUSTER[item.name], view);
      if (cluster.decal.visible) used.add(cluster.decal.material as THREE.Material);
      // A keeper goes once a built mesh uses its material (its shader is then in every picture of the place).
      for (const keeper of this.keepers.filter(k => used.has(k.material as THREE.Material))) {
        this.keepers.splice(this.keepers.indexOf(keeper), 1); this.group.remove(keeper); keeper.geometry.dispose();
      }
      if (!this.pending.length) for (const keeper of this.keepers.splice(0)) { this.group.remove(keeper); keeper.geometry.dispose(); }
      return;   // one group per update, so no frame builds two
    }
  }
  private boxes = new Map<GroupName, number[]>();
  private clusters = new Map<ClusterName, Cluster>();
  /** Desktop's instanced vehicles share one material for good, so a new near set never builds its shader again. */
  private carMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  /** A cluster's meshes, made empty and hidden the first time one of its groups builds. */
  private cluster(name: ClusterName): Cluster {
    let c = this.clusters.get(name);
    if (c) return c;
    const mats = materials(this.low), mesh = (part: string, material: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), material);
      m.name = `ph-${name}-${part}`; m.visible = false;
      this.group.add(m);
      return m;
    };
    const models = new Map<Tex | null, THREE.Mesh>();
    for (const [tex, material] of mats) if (tex !== 'decal') {
      const m = mesh(tex ?? 'paint', material); m.castShadow = m.receiveShadow = true; models.set(tex, m);
    }
    const decal = mesh('decal', mats.get('decal')!); decal.receiveShadow = true;
    // LOW's baked vehicles are plain vertex-coloured triangles, like the models' paint.
    const vehicles = mesh('vehicles', mats.get(null)!);
    this.clusters.set(name, c = { models, decal, vehicles, parked: null, near: '' });
    return c;
  }
  /** Show the paint and parked vehicles of the cluster's groups within reach of the view; rebuilt only when that set changes. */
  private showNear(name: ClusterName, view: { x: number; z: number }): void {
    // A near group stays near until 50 m past the reach, so a car waiting on the line does not rebuild them over and over.
    const c = this.clusters.get(name)!, reach = this.low ? 350 : 600, was = new Set(c.near.split(' '));
    const near = [...this.built.keys()].filter(g => PH_CLUSTER[g] === name).filter(g => {
      const item = this.boxes.get(g)!;
      return Math.max(item[0] - view.x, view.x - item[2], item[1] - view.z, view.z - item[3]) < reach + (was.has(g) ? 50 : 0);
    });
    const key = near.join(' ');
    if (key === c.near) return;
    c.near = key;
    for (const [mesh, part] of [[c.decal, 'decal'], [c.vehicles, 'vehicles']] as const) {
      const parts = near.map(g => this.built.get(g)![part]).filter((g): g is THREE.BufferGeometry => !!g);
      mesh.geometry.dispose();
      mesh.geometry = parts.length ? merged(parts) : new THREE.BufferGeometry();
      mesh.visible = parts.length > 0;
    }
    if (this.low) return;
    // Desktop: one instanced mesh per vehicle type for the cluster's near groups.
    if (c.parked) {
      this.group.remove(c.parked.group);
      c.parked.group.traverse(o => { if (o instanceof THREE.InstancedMesh) { o.geometry.dispose(); o.dispose(); } });
    }
    c.parked = null;
    const cars = near.flatMap(g => this.built.get(g)!.cars), ground = new Map<Parked, (x: number, z: number) => number>();
    for (const g of near) for (const car of this.built.get(g)!.cars) ground.set(car, this.built.get(g)!.ground);
    if (!cars.length) return;
    // Each vehicle stands on its own group's ground, as read when the group built.
    const parked = new ParkedVehicles(cars, (x, z, car) => ground.get(car)!(x, z), this.carMaterial);
    parked.group.name = `ph-${name}-instanced`;
    parked.seat();
    this.group.add(parked.group);
    c.parked = parked;
  }
  /** The site's fixed solids, and each built group's poles, corrals and parked vehicles (the towed trailer reads this list too). */
  readonly solids: Solid[] = [];
  resolveSolids(car: Pushable): void {
    if (Math.hypot(car.x - this.site.centre.x, car.z - this.site.centre.z) < this.site.reach) pushOut(car, this.solids);
  }
}

/** Map points under a group: its places, lots and items (the build waits for the finest land under all of them). */
export function groupPoints(name: GroupName): P2[] {
  const g = PH_GROUPS[name], pts: P2[] = [...g.items];
  for (const place of g.places) {
    const p = PH_PLACES[place] as PhPlace;
    pts.push([p.e, p.n]);
    for (const r of p.rects) pts.push(toMap(p, r[0], r[2]), toMap(p, r[1], r[3]), toMap(p, r[0], r[3]), toMap(p, r[1], r[2]));
  }
  for (const [place, x0, x1, z0, z1] of PH_PADS) if ((g.places as string[]).includes(place)) pts.push(toMap(PH_PLACES[place], x0, z0), toMap(PH_PLACES[place], x1, z1));
  for (const ref of g.lots) { const b = lotBox(PH_LOTS[ref] as LotSpec); pts.push([b[0], b[1]], [b[2], b[3]], [b[0], b[3]], [b[2], b[1]]); }
  return pts;
}
