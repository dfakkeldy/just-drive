/**
 * Mabou's main street, modelled by hand from the public-safe dash cam brief (the project brief). Words, numbers and map
 * positions only: no picture pixels, and no names, sign words, civic numbers, logos, postal marks or fuel brands.
 * Every sign and fascia is blank.
 *
 * Each place (and each half of the street furniture) is built once, when the camera is near and the finest land under
 * it is in memory. Once every unit of a cluster (west: the junction to the post office; east: the gas station, the
 * grocery and the bank) is built, the cluster is merged into one mesh per surface pattern, so the whole street costs at
 * most twelve draw calls (and their shadows). LOW detail leaves out the small parts (glazing bars, rails, wreaths,
 * bulbs) and draws benches, the trailer and tables simply (they are solid); it keeps the masses, colours and openings
 * and only the siding and shingle patterns.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addFlag } from './flags';
import type { Terrain } from './terrain';
import type { Road } from './roads';
import { pushOut, type Pushable } from './parked';
import type { HandBuiltPlace } from './place';
import { Kit as SiteKit, Face, canvas, grey, seeded, v } from './site-kit';
import {
  FESTOONS, GAS_ISLANDS, GAS_ISLAND_Z, MAIN_ITEMS, MAIN_PLACES, SIDEWALK, STREET_LAMPS, STREET_SPLIT, placePoints, streetPoints,
  type Cluster, type MabouMainSite, type MainPlace, type PlaceName, type StreetHalf,
} from './mabou-main-site';

type Tex = 'siding' | 'shingle' | 'seam' | 'brick' | 'stone';
type Kit = SiteKit<Tex>;
type V3 = THREE.Vector3;
const TEXES: (Tex | null)[] = [null, 'siding', 'shingle', 'seam', 'brick', 'stone'];
/** Phones (LOW) keep only the lap siding and shingle patterns; brick, stone and ribbed metal are drawn as plain paint
 *  in their colours, which saves three textures and up to three draw calls per cluster. */
const LOW_TEXES: (Tex | null)[] = [null, 'siding', 'shingle'];

// Paint, from the brief (the overcast frames read darker than the paint; these are the paint).
const C = {
  white: 0xf1f0ea, glass: 0x4d5f69, concrete: 0xaaa69d, plinth: 0x8f8d88, iron: 0x1b1c1d, steel: 0x8b8f92,
  olive: 0x7a8644, maroon: 0x8a3b36, charcoal: 0x3f4245, mustard: 0xd6ad3a, porchGreen: 0x6e7a3e, planter: 0x4a3a2c,
  shrub: 0x3f5f36, binRed: 0xa52a24, iceWhite: 0xeeeeea,
  brick: 0xb3533a, brickDark: 0x8e3f2c, roofFlat: 0x55585a, granite: 0x8a8c8e, wreath: 0x2f4a32, poppy: 0xa3201e,
  panel: 0x2e3438,
  shutter: 0x2f4a36, hallRoof: 0x4a4d50, chimney: 0x8a4b3a,
  metal: 0x4a4744, metalRoof: 0x463f3a, stone: 0x8d8a84, fasciaBlue: 0x1f4f9a, dispenser: 0xe9eaea, blueBin: 0x2456a4,
  lampWhite: 0xe4e4e0, lampHead: 0x6d7175, priceRow: 0x2a2d30,
  museum: 0x8c98a0, black: 0x18191a, muralSea: 0x6f93a8, muralLand: 0x7f9a62, flagBlue: 0x2b5fae,
  turquoise: 0x1f9fae, purple: 0x5b2a6e, deck: 0x8c6c48,
  pubRed: 0xc0262d, oval: 0xe2b52b, trailerBlack: 0x222222, timber: 0x9a774f,
  oxblood: 0x5e1f1f, fasciaDark: 0x2c2c2c,
  greige: 0xa8a397, bankRoof: 0x6a6c6e, cream: 0xe6dcc0, tanStone: 0xb59f7f, signBlue: 0x1d2f5e,
  pavers: 0xd8d2c4, boardBlue: 0x4b4fa0, scroll: 0xc9466a, bench: 0x7a5a3c,
  sidewalk: 0xb5b2aa, bulb: 0xfff2c0, wire: 0x202020, wood: 0x6f5a44,
};

// ---- surface patterns: grey-scale, so the vertex colour gives the hue. One repeat is one metre. ----------------------
function textures(): Record<Tex, THREE.Texture> {
  // Lap siding: five boards a metre, each with a shadow line under its lap.
  const siding = canvas(16, 160, g => {
    for (let b = 0; b < 5; b++) {
      const y0 = b * 32, grad = g.createLinearGradient(0, y0, 0, y0 + 32);
      grad.addColorStop(0, grey(0.97)); grad.addColorStop(1, grey(0.86));
      g.fillStyle = grad; g.fillRect(0, y0, 16, 32);
      g.fillStyle = grey(0.66); g.fillRect(0, y0 + 30, 16, 2);
    }
  });
  // Asphalt shingles: five courses a metre, staggered tab joints.
  const shingle = canvas(128, 128, g => {
    const rnd = seeded(5);
    g.fillStyle = grey(0.95); g.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 5; r++) {
      const y0 = r * 25.6;
      for (let x = -(r % 2) * 21; x < 128; x += 42) { g.fillStyle = grey(0.86 + rnd() * 0.14); g.fillRect(x + 1, y0, 40, 24); }
      g.fillStyle = grey(0.62); g.fillRect(0, y0 + 23, 128, 2.6);
    }
  });
  // Ribbed metal (standing-seam roofs and the gas station's siding): a raised rib every half metre.
  const seam = canvas(128, 16, g => {
    g.fillStyle = grey(0.9); g.fillRect(0, 0, 128, 16);
    for (const x of [0, 64]) { g.fillStyle = grey(1); g.fillRect(x, 0, 4, 16); g.fillStyle = grey(0.66); g.fillRect(x + 4, 0, 4, 16); }
  });
  // Running-bond brick: 0.2 × 0.067 m bricks (with joints), a little mottled.
  const brick = canvas(256, 256, g => {
    const rnd = seeded(9);
    g.fillStyle = grey(0.72); g.fillRect(0, 0, 256, 256);
    const bw = 51.2, bh = 17.07;
    for (let r = 0; r < 15; r++) for (let c = -1; c < 6; c++) {
      const x = c * bw + (r % 2) * bw / 2, l = 0.86 + rnd() * 0.14;
      g.fillStyle = grey(l); g.fillRect(x + 2, r * bh + 2, bw - 4, bh - 3);
    }
  });
  // Stacked-stone veneer: long thin ledgestones in courses, mixed lengths and shades.
  const stone = canvas(256, 256, g => {
    const rnd = seeded(13);
    g.fillStyle = grey(0.45); g.fillRect(0, 0, 256, 256);
    let y = 0;
    while (y < 256) {
      const h = 10 + Math.round(rnd() * 16);
      let x = -Math.round(rnd() * 60);
      while (x < 256) {
        const w = 30 + Math.round(rnd() * 70), l = 0.7 + rnd() * 0.3;
        for (const dx of [0, 256]) { g.fillStyle = grey(l); g.fillRect(x + dx + 1, y + 1, w - 2, h - 2); }
        x += w;
      }
      y += h;
    }
  });
  stone.repeat.set(0.5, 0.5);
  return { siding, shingle, seam, brick, stone };
}

// ---- reusable pieces ----------------------------------------------------------------------------------------------
/** A window: a frame, glass, a sill; glazing bars (cols x rows) only on desktop. */
function window_(k: Kit, f: Face, u: number, y0: number, w: number, h: number, cols = 2, rows = 2, trim = C.white): void {
  k.onWall(f, u, y0 + h / 2, w + 0.2, h + 0.2, 0, 0.05, trim);
  k.onWall(f, u, y0 + h / 2, w, h, 0.05, 0.02, C.glass);
  k.onWall(f, u, y0 - 0.1, w + 0.3, 0.08, 0, 0.12, trim);
  if (k.low) return;
  for (let i = 1; i < cols; i++) k.onWall(f, u - w / 2 + w * i / cols, y0 + h / 2, 0.045, h, 0.07, 0.02, trim);
  for (let j = 1; j < rows; j++) k.onWall(f, u, y0 + h * j / rows, w, 0.045, 0.07, 0.02, trim);
}
/** A door: a frame and a leaf (glass when `glass`). */
function door(k: Kit, f: Face, u: number, y0: number, w: number, h: number, leaf: number, trim = C.white): void {
  k.onWall(f, u, y0 + h / 2 + 0.05, w + 0.2, h + 0.1, 0, 0.05, trim);
  k.onWall(f, u, y0 + h / 2, w, h, 0.05, 0.03, leaf);
}
/** Dark green louvred shutters each side of a window. */
function shutters(k: Kit, f: Face, u: number, y0: number, w: number, h: number): void {
  for (const s of [-1, 1]) {
    k.onWall(f, u + s * (w / 2 + 0.38), y0 + h / 2, 0.5, h + 0.1, 0, 0.05, C.shutter);
    if (!k.low) for (let y = y0 + 0.15; y < y0 + h; y += 0.22) k.onWall(f, u + s * (w / 2 + 0.38), y, 0.42, 0.03, 0.05, 0.02, 0x253b2b);
  }
}
/** Corner boards: a thin trim board up each vertical corner of a box from y0 to y1. */
function corners(k: Kit, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: number, t = 0.14): void {
  for (const [x, z, sx, sz] of [[x0, z0, -1, -1], [x1, z0, 1, -1], [x1, z1, 1, 1], [x0, z1, -1, 1]]) {
    k.span(x - (sx < 0 ? 0.03 : t - 0.03) , x + (sx > 0 ? 0.03 : t - 0.03), y0, y1, z - (sz < 0 ? 0.03 : t - 0.03), z + (sz > 0 ? 0.03 : t - 0.03), color);
  }
}
function heatPump(k: Kit, f: Face, u: number, y = 0.55): void {
  k.onWall(f, u, y, 0.95, 0.7, 0.15, 0.36, 0xd9d9d4);
  if (!k.low) k.add(new THREE.CircleGeometry(0.24, 12), 0x3a3d3f, null, f.at(u - 0.12, y, 0.52));
}
/** A metal pipe rail from a to b (local points at rail height), with posts every ~2 m on desktop. */
function rail(k: Kit, a: V3, b: V3, color = C.iron, post = 0.9): void {
  const d = b.clone().sub(a), len = d.length();
  k.add(new THREE.BoxGeometry(len, 0.05, 0.05), color, null, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(v(1, 0, 0), d.clone().normalize()), v(1, 1, 1)));
  if (k.low || post <= 0) return;
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); k.box(0.05, post, 0.05, p.x, p.y - post / 2, p.z, color); }
}
function flagpole(k: Kit, x: number, z: number, h: number): void {
  const g = k.ground(x, z);
  k.cylinder(0.07, 0.04, h, x, g, z, C.white, 8);
  k.add(new THREE.SphereGeometry(0.08, 8, 6), C.white, null, k.matrix(x, g + h + 0.05, z));
  addFlag(k, 'canada', x, g + h - 0.75, z + 0.075, 0.9);
}
function shrub(k: Kit, x: number, z: number, r: number, y?: number): void {
  if (k.low) return;
  const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, 0.7, 1);
  k.add(g, C.shrub, null, k.matrix(x, (y ?? k.ground(x, z)) + r * 0.45, z));
}
/** A slab that follows the ground: thin pieces of `step` metres, each grounded, `top` above the ground at its centre. */
function groundSlab(k: Kit, x0: number, x1: number, z0: number, z1: number, top: number, color: number, step = 2): void {
  const nz = Math.max(1, Math.round((z1 - z0) / step));
  for (let i = 0; i < nz; i++) {
    const a = z0 + (z1 - z0) * i / nz, b = z0 + (z1 - z0) * (i + 1) / nz;
    k.grounded(x0, x1, a, b, k.ground((x0 + x1) / 2, (a + b) / 2) + top, color);
  }
}
/** A gabled roof whose ridge runs along z, over x0..x1 (shorthand for k.roof). */
function roofZ(k: Kit, x0: number, x1: number, z0: number, z1: number, eave: number, rise: number, color: number, tex: Tex | null, fascia?: number, over = 0.35): void {
  k.roof({ a0: z0, a1: z1, c: (x0 + x1) / 2, w: (x1 - x0) / 2, eave, rise, over, alongX: false, color, tex, fascia, rake: fascia !== undefined });
}
function roofX(k: Kit, x0: number, x1: number, z0: number, z1: number, eave: number, rise: number, color: number, tex: Tex | null, fascia?: number, over = 0.35, hip = false): void {
  k.roof({ a0: x0, a1: x1, c: (z0 + z1) / 2, w: (z1 - z0) / 2, eave, rise, over, alongX: true, color, tex, fascia, rake: fascia !== undefined, hip0: hip, hip1: hip });
}

// ---- 1. the grocery -----------------------------------------------------------------------------------------------
function grocery(k: Kit): void {
  k.at(MAIN_PLACES.grocery, 0.2);
  const L = 15.67, W = 9.955, eave = 3.45, rise = 3.01, wall = C.olive;
  const front = new Face('z+', W), east = new Face('x+', L);
  k.grounded(-L, L, -W, W, 0, C.concrete);
  k.span(-L, L, 0, eave, -W, W, wall, 'siding');
  for (const s of [-1, 1]) k.gable(new Face(s > 0 ? 'x+' : 'x-', s * L), 0, W, eave, rise, wall, 'siding');
  roofX(k, -L, L, -W, W, eave, rise, C.charcoal, 'shingle', C.maroon, 0.45);
  corners(k, -L, L, -W, W, 0, eave, C.maroon);
  // The two lower gabled wings (baked 1722 west, 1723 on the north part of the east wall), ridges across the main one.
  for (const [x0, x1] of [[-24.24, -L], [L, 22.04]]) {
    k.grounded(x0, x1, -9.96, 2.89, 0, C.concrete);
    k.span(x0, x1, 0, 2.9, -9.96, 2.89, wall, 'siding');
    k.gable(new Face('z+', 2.89), (x0 + x1) / 2, (x1 - x0) / 2, 2.9, 1.7, wall, 'siding');
    k.gable(new Face('z-', -9.96), -(x0 + x1) / 2, (x1 - x0) / 2, 2.9, 1.7, wall, 'siding');
    roofZ(k, x0, x1, -9.96, 2.89, 2.9, 1.7, C.charcoal, 'shingle', C.maroon, 0.35);
    corners(k, x0, x1, -9.96, 2.89, 0, 2.9, C.maroon);
  }
  heatPump(k, new Face('x+', 22.04), 1.5, 1.9);
  // The entrance: a tall front cross gable a third of the way from the west end, mustard yellow above the eave, rising
  // above the main ridge; a lower green-gabled porch on two red-brown posts in front of it, on a raised concrete platform.
  const ex = -5.2, ew = 3.5, er = 4.15;
  roofZ(k, ex - ew, ex + ew, -1.2, W, eave, er, C.charcoal, 'shingle', C.maroon, 0.4);
  k.gable(front, ex, ew, eave, er, C.mustard, 'siding');
  k.gable(new Face('z-', -1.2), -ex, ew, eave, er, wall, 'siding');
  k.onWall(front, ex, 1.65, 6.6, 3.3, 0, 0.04, C.mustard);
  k.onWall(front, ex, 1.15, 2.3, 2.3, 0.04, 0.04, C.glass);
  if (!k.low) k.onWall(front, ex, 1.15, 0.06, 2.3, 0.08, 0.02, C.white);
  for (const s of [-1, 1]) window_(k, front, ex + s * 2.25, 0.9, 1.5, 1.7, 2, 1);
  k.grounded(-8.4, -2.0, W, 12.9, 0.02, C.concrete);
  k.grounded(-6.6, -3.8, 12.9, 13.3, -0.12, C.concrete);
  for (const x of [-7.1, -3.3]) k.span(x - 0.12, x + 0.12, 0.02, 2.75, 12.15, 12.4, C.maroon);
  roofZ(k, -7.4, -3.0, W, 12.6, 2.75, 1.1, C.charcoal, 'shingle', C.maroon, 0.3);
  k.gable(new Face('z+', 12.6 + 0.3), ex, 2.5, 2.75 - 0.3 * 1.1 / 2.2, 1.1 + 0.3 * 1.1 / 2.2, C.porchGreen);
  for (const x of [-7.9, -2.5]) { k.span(x - 0.35, x + 0.35, 0.02, 0.6, 12.1, 12.8, C.planter); shrub(k, x, 12.45, 0.4, 0.6); }
  // The east part of the front: the white two-door ice chest, one small window near the east end.
  k.grounded(5.0, 7.0, W, W + 0.9, 0, C.concrete);
  k.span(5.0, 7.0, 0.05, 1.95, W + 0.02, W + 0.88, C.iceWhite);
  if (!k.low) for (const x of [5.5, 6.5]) k.span(x - 0.42, x + 0.42, 0.25, 1.75, W + 0.88, W + 0.9, 0xd4d7d8);
  window_(k, front, 13.6, 1.2, 0.9, 0.9, 1, 1);
  // The east end wall: one small window high near the south corner, a heat-pump head high up north of the mailbox bank.
  // Nothing deeper than 3 cm below 2.2 m on its open south part (z 2.89 to 9.955): the bank stands flush there.
  window_(k, east, -8.6, 2.35, 0.6, 0.5, 1, 1);
  heatPump(k, east, -3.45, 2.6);
  // The red drop bin at the foot of the east wing.
  const g = k.ground(22.65, 1.6);
  k.span(22.06, 23.24, g, g + 1.8, 1.1, 2.1, C.binRed);
  if (!k.low) k.span(23.24, 23.26, g + 1.2, g + 1.45, 1.3, 1.9, 0x5a1612);
}

// ---- 2. the post office building and the memorial lawn ----------------------------------------------------------
function postOffice(k: Kit): void {
  k.at(MAIN_PLACES.postOffice, 0.45);
  const X = 5.2, Zb = -6.94, Zf = 5.2, top = 3.0;
  const east = new Face('x+', X), west = new Face('x-', -X);
  k.grounded(-X, X, Zb, 6.94, 0.15, C.plinth);
  k.span(-X, X, 0.15, top, Zb, Zf, C.brick, 'brick');
  k.span(-X - 0.02, X + 0.02, 0.15, 0.75, Zb - 0.02, Zf + 0.02, C.brickDark, 'brick');
  k.span(-X + 0.1, X - 0.1, top, top + 0.2, Zb + 0.1, Zf - 0.1, C.roofFlat);
  // The white metal fascia band all round.
  for (const [x0, x1, z0, z1] of [[-X - 0.06, X + 0.06, Zb - 0.06, Zb], [-X - 0.06, X + 0.06, Zf, Zf + 0.06], [-X - 0.06, -X, Zb, Zf], [X, X + 0.06, Zb, Zf]]) k.span(x0, x1, top - 0.15, top + 0.3, z0, z1, C.white);
  // The glazed entrance vestibule across most of the front, white-framed, with a blank white fascia board.
  const vx = 3.9, vt = 2.7;
  k.span(-vx, vx, vt, vt + 0.15, Zf, 6.94, C.white);
  k.span(-vx - 0.02, vx + 0.02, vt - 0.05, vt + 0.42, 6.94, 6.98, C.white);
  for (const [x0, x1, z0, z1] of [[-vx, vx, 6.9, 6.94], [-vx, -vx + 0.04, Zf, 6.94], [vx - 0.04, vx, Zf, 6.94]]) k.span(x0, x1, 0.15, vt, z0, z1, C.glass);
  const vf = new Face('z+', 6.94);
  for (const u of [-vx, -2.6, -1.3, 1.3, 2.6, vx]) k.onWall(vf, u, 0.15 + (vt - 0.15) / 2, 0.08, vt - 0.15, 0, 0.04, C.white);
  for (const s of [-1, 1]) k.span(s > 0 ? vx - 0.08 : -vx, s > 0 ? vx : -vx + 0.08, 0.15, vt, Zf, 6.94, C.white);
  k.onWall(vf, 0, 0.2, 2 * vx, 0.08, 0, 0.04, C.white);
  door(k, vf, 0, 0.15, 1.1, 2.2, C.glass);
  if (!k.low) k.onWall(vf, 0, 1.3, 0.05, 2.1, 0.05, 0.02, C.white);
  // Concrete steps to the door with black pipe railings.
  for (const [z0, z1, t] of [[6.94, 7.4, 0.15], [7.4, 7.88, 0.0], [7.88, 8.35, -0.15]] as const) k.grounded(-1.35, 1.35, z0, z1, t, C.concrete);
  for (const s of [-1, 1]) rail(k, v(s * 1.28, 1.05, 7.0), v(s * 1.28, 0.75, 8.3));
  // The east wall: a small window, a long high ribbon window of three lights, the side door; a ramp with black railings
  // runs along it from the front to the side door.
  window_(k, east, -2.6, 1.3, 0.8, 0.9, 1, 1);
  window_(k, east, 2.4, 1.85, 3.0, 0.65, 3, 1);
  door(k, east, 4.2, 0.15, 0.95, 2.1, 0x7b6a55);
  const rampLen = 6.94 - -2.5, foot = Math.min(0.1, k.ground(5.97, 6.9)), ang = Math.atan2(0.15 - foot, rampLen);
  k.grounded(X, 6.75, -5.0, -2.5, 0.15, C.concrete);
  k.box(1.55, 0.2, rampLen + 0.05, 5.975, (0.15 + foot) / 2 - 0.1, (6.94 + -2.5) / 2, C.concrete, { rx: ang });
  k.grounded(X + 0.05, 6.7, -2.5, 6.94, foot - 0.12, C.concrete);
  rail(k, v(6.7, 1.05, -5.0), v(6.7, 1.05, -2.5));
  rail(k, v(6.7, 1.05, -2.5), v(6.7, foot + 0.9, 6.9));
  // The west side: a meter box, a small deck landing with a white post at the side door.
  k.onWall(west, 2.0, 1.3, 0.4, 0.55, 0, 0.18, 0x9a9b98);
  k.grounded(-6.4, -X, -4.6, -2.6, 0.1, C.deck);
  if (!k.low) k.box(0.12, 1.0, 0.12, -6.3, 0.6, -2.7, C.white);
  door(k, west, -3.6, 0.15, 0.95, 2.1, 0x7b6a55);
  window_(k, new Face('z-', Zb), 0, 1.6, 1.6, 0.8, 2, 1);

  // The memorial lawn: a grey granite memorial (a tall central stone with lower wings, wreaths at its foot), a flagpole,
  // a small slanted panel on two posts, a concrete path from the sidewalk.
  const po = MAIN_PLACES.postOffice;
  const [me, mn] = MAIN_ITEMS.memorial;
  k.point(me, mn, po.az);
  const g = Math.max(k.ground(-1.8, 0), k.ground(1.8, 0), k.ground(0, 0.6), k.ground(0, -0.6));
  k.grounded(-1.9, 1.9, -0.6, 0.6, g + 0.3, C.granite);
  k.span(-0.55, 0.55, g + 0.3, g + 3.0, -0.25, 0.25, C.granite);
  k.span(-0.62, 0.62, g + 3.0, g + 3.15, -0.3, 0.3, 0x9a9c9e);
  for (const s of [-1, 1]) k.span(s * 0.55, s * 1.6, g + 0.3, g + 1.55, -0.2, 0.2, C.granite);
  if (!k.low) for (const x of [-0.9, 0, 0.9]) {
    k.add(new THREE.TorusGeometry(0.2, 0.06, 6, 14), C.wreath, null, k.matrix(x, g + 0.5, 0.68, { rx: -0.35 }));
    k.add(new THREE.TorusGeometry(0.2, 0.03, 4, 10, Math.PI / 3), C.poppy, null, k.matrix(x, g + 0.5, 0.74, { rx: -0.35, rz: -Math.PI / 6 }));
  }
  const [fe, fn] = MAIN_ITEMS.memorialFlag;
  k.point(fe, fn, po.az);
  flagpole(k, 0, 0, 8.5);
  const [pe, pn] = MAIN_ITEMS.memorialPanel;
  k.point(pe, pn, po.az);
  const pg = k.ground(0, 0);
  for (const s of [-1, 1]) k.box(0.08, 0.95, 0.08, s * 0.55, pg + 0.47, 0, C.iron);
  k.box(1.4, 0.9, 0.06, 0, pg + 1.05, 0.05, C.panel, { rx: -0.6 });
  const [[ae, an], [be, bn]] = MAIN_ITEMS.memorialPath;
  const len = Math.hypot(be - ae, bn - an);
  k.point((ae + be) / 2, (an + bn) / 2, po.az);
  groundSlab(k, -0.75, 0.75, -len / 2, len / 2, 0.04, C.concrete);
}

// ---- 3. the hall across from the post office building ----------------------------------------------------------
function hall(k: Kit): void {
  // The measured blocks (LAND, the project brief): the main block 12.5 × 20 m with its road wall 2.5 m nearer the road
  // than the map outline, a narrow east wing, and a lower rear wing across the whole back with its ridge along the road.
  k.at(MAIN_PLACES.hall, 0.4);
  const x0 = -7.27, x1 = 5.23, z0 = -4.09, z1 = 15.91, uc = (x0 + x1) / 2, w = (x1 - x0) / 2, eave = 4.0, rise = 3.4;
  const front = new Face('z+', z1), westF = new Face('x+', x1);
  k.grounded(x0, x1, z0, z1, 0, C.plinth);
  k.span(x0, x1, 0, eave, z0, z1, C.white, 'siding');
  k.gable(front, uc, w, eave, rise, C.white, 'siding');
  roofZ(k, x0, x1, z0 - 0.3, z1, eave, rise, C.hallRoof, 'shingle', C.white, 0.35);
  corners(k, x0, x1, z0, z1, 0, eave, C.white);
  k.span(uc - 0.5, uc + 0.5, eave + rise - 1.2, eave + rise + 1.0, -1.6, -0.6, C.chimney);
  // The road end: a centred door with a fanlight under a pedimented dark green hood; a shuttered window each side; a
  // small window with a louvred vent in the attic; a blank white panel by the door.
  door(k, front, uc, 0, 1.3, 2.3, 0xe9e6dc);
  k.grounded(uc - 1.1, uc + 1.1, z1, z1 + 0.7, -0.2, C.concrete);
  if (!k.low) for (const s of [-1, 1]) k.onWall(front, uc + s * 0.33, 1.15, 0.5, 1.9, 0.08, 0.02, 0xd9d5c8);
  k.shape(new THREE.Shape().absarc(uc, 2.45, 0.66, 0, Math.PI, false), front, 0.02, C.white, 12);
  k.shape(new THREE.Shape().absarc(uc, 2.45, 0.56, 0, Math.PI, false), front, 0.04, C.glass, 12);
  const hood = new THREE.Shape([new THREE.Vector2(uc - 1.25, 0), new THREE.Vector2(uc + 1.25, 0), new THREE.Vector2(uc, 0.65)]);
  k.add(new THREE.ExtrudeGeometry(hood, { depth: 0.6, bevelEnabled: false }), C.shutter, null, front.at(0, 3.2, -0.02));
  k.onWall(front, uc, 3.15, 2.6, 0.12, 0, 0.62, C.shutter);
  for (const s of [-1, 1]) { const u = uc + s * 3.4; window_(k, front, u, 1.1, 1.0, 1.6, 2, 2); shutters(k, front, u, 1.1, 1.0, 1.6); }
  window_(k, front, uc, 4.75, 0.8, 0.8, 1, 1);
  if (!k.low) for (let y = 4.85; y < 5.5; y += 0.14) k.onWall(front, uc, y, 0.75, 0.04, 0.08, 0.04, 0x9b9e9f);
  k.onWall(front, uc + 1.65, 1.5, 0.75, 0.55, 0, 0.04, 0xf8f8f4);
  // The west side: three shuttered windows, a white side door near the rear, a heat pump, a white tank at the corner.
  for (const z of [12.6, 7.6, 2.6]) { window_(k, westF, -z, 1.1, 1.0, 1.6, 2, 2); shutters(k, westF, -z, 1.1, 1.0, 1.6); }
  door(k, westF, 1.0, 0, 1.0, 2.2, 0xf4f3ee);
  heatPump(k, westF, -0.4);
  // The lower east wing, with a small porch at its road end.
  const wx0 = -11.77, wx1 = x0, wz0 = -2.09, wz1 = 10.41, ww = (wx1 - wx0) / 2;
  k.grounded(wx0, wx1, wz0, wz1, 0, C.plinth);
  k.span(wx0, wx1 + 0.02, 0, 2.8, wz0, wz1, C.white, 'siding');
  k.gable(new Face('z+', wz1), (wx0 + wx1) / 2, ww, 2.8, 1.1, C.white, 'siding');
  roofZ(k, wx0, wx1, wz0, wz1, 2.8, 1.1, C.hallRoof, 'shingle', C.white, 0.3);
  const wf = new Face('z+', wz1);
  door(k, wf, -9.5, 0, 0.95, 2.1, 0xf4f3ee);
  window_(k, new Face('x-', wx0), 4.0, 1.1, 1.0, 1.3, 2, 2); shutters(k, new Face('x-', wx0), 4.0, 1.1, 1.0, 1.3);
  k.grounded(-11.3, -7.7, wz1, 12.0, 0.25, C.deck);
  for (const x of [-11.15, -7.85]) k.span(x - 0.07, x + 0.07, 0.25, 2.4, 11.75, 11.9, C.white);
  k.facet([v(-11.5, 2.4, 12.1), v(-7.5, 2.4, 12.1), v(-7.5, 2.75, wz1), v(-11.5, 2.75, wz1)], C.hallRoof, 'shingle');
  // The rear wing across the whole back, its ridge along the road (a cross gable at the back of the main block).
  const rx0 = -11.27, rx1 = 9.23, rz0 = -13.38, rz1 = -2.08;
  k.grounded(rx0, rx1, rz0, rz1, 0, C.plinth);
  k.span(rx0, rx1, 0, 3.9, rz0, rz1, C.white, 'siding');
  for (const s of [-1, 1]) k.gable(new Face(s > 0 ? 'x+' : 'x-', s > 0 ? rx1 : rx0), -s * (rz0 + rz1) / 2, (rz1 - rz0) / 2, 3.9, 2.7, C.white, 'siding');
  roofX(k, rx0, rx1, rz0, rz1, 3.9, 2.7, C.hallRoof, 'shingle', C.white, 0.3);
  for (const x of [-8.5, 7.0]) window_(k, new Face('z+', rz1), x, 1.1, 1.0, 1.3, 2, 2);
  for (const x of [-6, -1, 4]) window_(k, new Face('z-', rz0), -x, 1.1, 1.0, 1.3, 2, 2);
  door(k, new Face('x+', rx1), 7.7, 0, 1.0, 2.2, 0xf4f3ee);
  if (!k.low) { const g = k.ground(rx1 + 0.9, -11.6); k.cylinder(0.55, 0.55, 1.6, rx1 + 0.9, g + 0.6 - 0.8, -11.6, 0xeeeeea, 12, { rx: Math.PI / 2 }); }
}

// ---- 4. the gas station: no canopy -------------------------------------------------------------------------------
function gas(k: Kit): void {
  const p = MAIN_PLACES.gas;
  k.at(p, 0.15);
  const X = 8.1, Z = 7.7, eave = 3.65, rise = 2.75;
  const front = new Face('z+', Z), westF = new Face('x-', -X);
  k.grounded(-X, X, -Z, Z, 0, C.concrete);
  k.span(-X, X, 0, eave, -Z, Z, C.metal, 'seam');
  for (const s of [-1, 1]) k.gable(new Face(s > 0 ? 'x+' : 'x-', s * X), 0, Z, eave, rise, C.metal, 'seam');
  roofX(k, -X, X, -Z, Z, eave, rise, C.metalRoof, 'seam', C.metal, 0.3);
  // Grey stacked-stone veneer: the lower front, and the west corner up to the fascia.
  k.span(-X - 0.06, X + 0.06, 0, 1.0, Z, Z + 0.06, C.stone, 'stone');
  k.span(-X - 0.06, -5.6, 0, eave - 0.6, Z, Z + 0.06, C.stone, 'stone');
  k.span(-X - 0.06, -X, 0, eave - 0.6, -Z, Z, C.stone, 'stone');
  // The deep blue fascia band across the whole front at the eave, a little proud of the wall (not a canopy). No words.
  k.span(-X - 0.2, X + 0.2, eave - 0.75, eave + 0.12, Z, Z + 0.32, C.fasciaBlue);
  // West to east: a white-framed window with a small lit panel behind it, a glass door with a side light, the wide
  // glazed overhead bay door.
  window_(k, front, -3.9, 1.05, 2.0, 1.4, 2, 1);
  k.onWall(front, -3.4, 1.9, 0.5, 0.3, 0.03, 0.02, 0xf2d79a);
  door(k, front, -1.3, 0, 1.0, 2.2, C.glass);
  k.onWall(front, -0.45, 1.1, 0.45, 2.2, 0, 0.05, C.white); k.onWall(front, -0.45, 1.1, 0.33, 2.05, 0.05, 0.02, C.glass);
  const bu = 4.6, bw = 4.4, bh = 2.85;
  k.onWall(front, bu, bh / 2 + 0.05, bw + 0.25, bh + 0.1, 0, 0.06, C.white);
  k.onWall(front, bu, bh / 2, bw, bh, 0.06, 0.02, C.glass);
  if (!k.low) {
    for (let i = 1; i < 4; i++) k.onWall(front, bu - bw / 2 + bw * i / 4, bh / 2, 0.06, bh, 0.08, 0.02, C.white);
    for (let j = 1; j < 5; j++) k.onWall(front, bu, bh * j / 5, bw, 0.07, 0.08, 0.02, C.white);
  }
  window_(k, westF, 2.0, 1.2, 1.0, 1.0, 1, 1);
  // The pump islands: a raised concrete curb, one plain white-and-blue dispenser, a steel post, short steel bollards.
  for (const x of GAS_ISLANDS) {
    const g = k.ground(x, GAS_ISLAND_Z) + 0.18;
    k.grounded(x - 2.1, x + 2.1, GAS_ISLAND_Z - 0.65, GAS_ISLAND_Z + 0.65, g, C.concrete);
    k.span(x - 0.45, x + 0.45, g, g + 1.9, GAS_ISLAND_Z - 0.3, GAS_ISLAND_Z + 0.3, C.dispenser);
    k.span(x - 0.47, x + 0.47, g + 1.45, g + 1.9, GAS_ISLAND_Z - 0.32, GAS_ISLAND_Z + 0.32, C.fasciaBlue);
    k.span(x - 0.47, x + 0.47, g, g + 0.2, GAS_ISLAND_Z - 0.32, GAS_ISLAND_Z + 0.32, C.fasciaBlue);
    if (!k.low) {
      for (const s of [-1, 1]) k.span(x - 0.36, x + 0.36, g + 0.55, g + 1.2, GAS_ISLAND_Z + s * 0.3, GAS_ISLAND_Z + s * 0.32, 0x30363a);
      k.cylinder(0.05, 0.05, 2.6, x + 0.9, g, GAS_ISLAND_Z, C.steel, 8);
      for (const s of [-1, 1]) k.cylinder(0.1, 0.1, 0.9, x + s * 1.85, g, GAS_ISLAND_Z, C.steel, 8);
      k.span(x - 1.5, x - 1.0, g, g + 0.9, GAS_ISLAND_Z - 0.25, GAS_ISLAND_Z + 0.25, C.blueBin);
    }
  }
  // Two tall white lamp posts at the islands, each with two shoebox heads.
  for (const [le, ln] of MAIN_ITEMS.gasLamps) {
    k.point(le, ln, p.az);
    const g = k.ground(0, 0);
    k.cylinder(0.12, 0.09, 7.5, 0, g, 0, C.lampWhite, 10);
    k.box(2.2, 0.1, 0.1, 0, g + 7.3, 0, C.lampWhite);
    for (const s of [-1, 1]) k.box(0.65, 0.18, 0.4, s * 1.15, g + 7.2, 0, C.lampHead);
  }
  // The price pylon at the west edge of the apron: a blue panel with a blank white area and two dark price rows (no
  // digits, no logo), on a grey base; its two faces look both ways along the road.
  k.point(...MAIN_ITEMS.gasPylon, p.az);
  const g = k.ground(0, 0);
  k.grounded(-0.25, 0.25, -0.9, 0.9, g + 0.6, C.plinth);
  k.span(-0.12, 0.12, g + 0.6, g + 3.0, -0.25, 0.25, C.steel);
  k.span(-0.2, 0.2, g + 3.0, g + 6.0, -1.0, 1.0, C.fasciaBlue);
  for (const s of [-1, 1]) {
    k.span(s * 0.2, s * 0.22, g + 4.8, g + 5.75, -0.75, 0.75, C.white);
    k.span(s * 0.2, s * 0.22, g + 3.95, g + 4.45, -0.85, 0.85, C.priceRow);
    k.span(s * 0.2, s * 0.22, g + 3.2, g + 3.7, -0.85, 0.85, C.priceRow);
  }
}

// ---- 5a. the museum ------------------------------------------------------------------------------------------------
function museum(k: Kit): void {
  k.at(MAIN_PLACES.museum, 0.6);
  const X = 4.36, Z = 7.93, eave = 5.51, rise = 3.97;
  const front = new Face('z+', Z), westF = new Face('x-', -X), eastF = new Face('x+', X);
  k.grounded(-X, X, -Z, Z, 0, C.plinth);
  k.span(-X, X, 0, eave, -Z, Z, C.museum, 'siding');
  k.gable(front, 0, X, eave, rise, C.museum, 'siding');
  k.gable(new Face('z-', -Z), 0, X, eave, rise, C.museum, 'siding');
  roofZ(k, -X, X, -Z, Z, eave, rise, 0x4f5458, 'shingle', C.white, 0.35);
  corners(k, -X, X, -Z, Z, 0, eave, C.white);
  // The road end: large shop-front display windows on the ground floor with a black fascia board over them (blank),
  // the front door between, two upper windows and an attic window.
  for (const u of [-2.55, 2.75]) window_(k, front, u, 0.55, 2.3, 2.0, 3, 1);
  door(k, front, 0.2, 0, 1.0, 2.3, 0x2a2b2c);
  k.onWall(front, 0, 2.9, 8.1, 0.55, 0, 0.08, C.black);
  for (const u of [-1.8, 1.8]) window_(k, front, u, 3.6, 0.9, 1.35, 2, 2);
  window_(k, front, 0, 6.3, 0.8, 0.9, 1, 1);
  // Black steps and railings at the front door.
  for (const [z0, z1, t] of [[Z, 8.4, 0], [8.4, 8.8, -0.2], [8.8, 9.2, -0.4]] as const) k.grounded(-1.0, 1.4, z0, z1, t, 0x2a2b2c);
  for (const x of [-0.95, 1.35]) rail(k, v(x, 0.9, Z + 0.05), v(x, 0.5, 9.15));
  // The west wall carries a painted map mural: drawn here as plain shapes of sea and land, no map and no words.
  k.onWall(westF, 0.5, 2.7, 6.2, 3.2, 0, 0.03, C.white);
  k.onWall(westF, 0.5, 2.7, 6.0, 3.0, 0.03, 0.02, C.muralSea);
  if (!k.low) for (const [u, y, w, h] of [[-1.4, 2.3, 2.2, 1.6], [0.9, 3.2, 2.6, 1.2], [2.3, 1.9, 1.2, 0.9]]) k.onWall(westF, 0.5 + u, y, w, h, 0.05, 0.01, C.muralLand);
  // On the west (x-) face u runs along +z, on the east (x+) face along -z; the mural spans z -2.6 to 3.6.
  for (const z of [-5.5]) { window_(k, westF, z, 1.0, 0.9, 1.4, 2, 2); window_(k, westF, z, 3.6, 0.9, 1.3, 2, 2); }
  for (const z of [-5.5, -2, 2.5]) { window_(k, eastF, -z, 1.0, 0.9, 1.4, 2, 2); window_(k, eastF, -z, 3.6, 0.9, 1.3, 2, 2); }
  // A blue flag on a bracket at the front corner.
  k.box(1.1, 0.06, 0.06, -X - 0.55, 3.45, Z - 0.6, C.iron);
  k.box(0.95, 0.8, 0.02, -X - 0.62, 3.0, Z - 0.6, C.flagBlue);
}

// ---- 5b. the plaza and its map board ------------------------------------------------------------------------------
function plaza(k: Kit): void {
  const p = MAIN_PLACES.plaza;
  k.at(p, 0);
  // A paved half-circle of pale pavers at the sidewalk (centre on the sidewalk's back edge, opening to the north).
  // It follows the ground (a polar mesh 6 cm above it), in two-tone bands, with an edge skirt down into the ground.
  const cz = 8.1, rings = [0, 1.4, 2.0, 3.5, 4.1, 5.0], sectors = k.low ? 6 : 12;
  const ring = k.low ? [0, 5.0] : rings;
  const at = (rr: number, i: number) => { const t = Math.PI + Math.PI * i / sectors, x = Math.cos(t) * rr, z = cz + Math.sin(t) * rr; return v(x, k.ground(x, z) + 0.06, z); };
  for (let j = 0; j + 1 < ring.length; j++) {
    const pos: number[] = [];
    for (let i = 0; i < sectors; i++) {
      const a0 = at(ring[j], i), a1 = at(ring[j], i + 1), b0 = at(ring[j + 1], i), b1 = at(ring[j + 1], i + 1);
      for (const p of j === 0 ? [a0, b1, b0] : [a0, a1, b1, a0, b1, b0]) pos.push(p.x, p.y, p.z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    k.add(g, j % 2 ? 0xc9c2b2 : C.pavers);
  }
  const R = ring[ring.length - 1], skirt: number[] = [];
  const edge = [...Array.from({ length: sectors + 1 }, (_, i) => at(R, i))];
  for (let i = 0; i < sectors; i++) {
    const a = edge[i], b = edge[i + 1], a2 = v(a.x, a.y - 0.3, a.z), b2 = v(b.x, b.y - 0.3, b.z);
    for (const p of [a, b, b2, a, b2, a2]) skirt.push(p.x, p.y, p.z);
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3)); sg.computeVertexNormals();
  k.add(sg, C.pavers);
  // The map board: a wide panel with a curved top in purple-blue and white on two posts (no words, no map), framed at
  // its east end by a tall red-pink scroll like the head of a fiddle.
  const [be, bn] = MAIN_ITEMS.mapBoard;
  k.point(be, bn, p.az);
  const g = Math.min(k.ground(-2.2, 0), k.ground(2.2, 0));
  const board = (w: number, y0: number, h: number, arch: number) => {
    const s = new THREE.Shape(); s.moveTo(-w / 2, y0); s.lineTo(w / 2, y0); s.lineTo(w / 2, y0 + h);
    s.quadraticCurveTo(0, y0 + h + arch * 2, -w / 2, y0 + h); s.closePath(); return s;
  };
  const back = new Face('z-', -0.08), fore = new Face('z+', 0.08);
  for (const f of [fore, back]) {
    k.shape(board(4.4, g + 0.55, 2.0, 0.45), f, 0, C.white, 14);
    k.shape(board(4.1, g + 0.7, 1.8, 0.38), f, 0.01, C.boardBlue, 14);
  }
  k.span(-2.2, 2.2, g + 0.55, g + 2.55, -0.08, 0.08, C.white);
  for (const x of [-1.6, 1.0]) k.span(x - 0.08, x + 0.08, g - 0.2, g + 0.55, -0.08, 0.08, C.iron);
  // The scroll: a tall neck, the pegbox and a spiral of shrinking turns, in red-pink.
  const sx = 2.5;
  k.grounded(sx - 0.3, sx + 0.3, -0.3, 0.3, g + 0.2, C.plinth);
  k.span(sx - 0.17, sx + 0.17, g + 0.2, g + 3.1, -0.14, 0.14, C.scroll);
  k.span(sx - 0.22, sx + 0.22, g + 3.1, g + 3.7, -0.16, 0.16, C.scroll);
  const turns = k.low ? 2 : 4;
  for (let i = 0; i < turns; i++) {
    const rad = 0.42 * Math.pow(0.68, i), cy = g + 3.95 + (0.42 - rad) * 0.6, cx = sx + (i % 2 ? -1 : 1) * 0.05;
    k.add(new THREE.TorusGeometry(rad, 0.1 * Math.pow(0.8, i), 6, k.low ? 8 : 14, Math.PI * 1.5), C.scroll, null, k.matrix(cx, cy, 0, { rz: i * Math.PI / 2 }));
  }
  // The church directory sign: a tall pointed-arch board on two posts (blank), and the flag, two benches, a lamp post.
  const [ce, cn] = MAIN_ITEMS.churchSign;
  k.point(ce, cn, p.az);
  const cg = k.ground(0, 0), arch = new THREE.Shape();
  arch.moveTo(-0.55, cg + 0.6); arch.lineTo(0.55, cg + 0.6); arch.lineTo(0.55, cg + 2.2); arch.quadraticCurveTo(0.55, cg + 2.75, 0, cg + 3.0);
  arch.quadraticCurveTo(-0.55, cg + 2.75, -0.55, cg + 2.2); arch.closePath();
  for (const f of [new Face('z+', 0.05), new Face('z-', -0.05)]) k.shape(arch, f, 0, C.white, 10);
  k.span(-0.55, 0.55, cg + 0.6, cg + 2.2, -0.05, 0.05, C.white);
  for (const x of [-0.4, 0.4]) k.span(x - 0.05, x + 0.05, cg - 0.2, cg + 0.6, -0.05, 0.05, C.iron);
  k.point(...MAIN_ITEMS.plazaFlag, p.az);
  flagpole(k, 0, 0, 8.0);
  for (const [e, n] of MAIN_ITEMS.benches) {
    k.point(e, n, p.az);
    const bg = k.ground(0, 0);
    for (const x of [-0.7, 0.7]) k.span(x - 0.04, x + 0.04, bg, bg + 0.45, -0.25, 0.25, C.iron);
    k.span(-0.8, 0.8, bg + 0.42, bg + 0.47, -0.25, 0.25, C.bench);
    k.span(-0.8, 0.8, bg + 0.55, bg + 0.9, -0.28, -0.23, C.bench);
  }
  lampPost(k, ...MAIN_ITEMS.plazaLamp, p.az);
}

// ---- 5c. the café ------------------------------------------------------------------------------------------------
function cafe(k: Kit): void {
  k.at(MAIN_PLACES.cafe, 0.35);
  const X = 8.27, Zb = -9.07, Zf = 8.6, dx = 4.8, eave = 3.2, rise = 3.0;
  const front = new Face('z+', Zf);
  k.grounded(-X, X, Zb, 1.0, 0, C.plinth);
  k.grounded(-X, dx, 1.0, Zf, 0, C.plinth);
  k.span(-X, X, 0, eave, Zb, 1.0, C.turquoise, 'siding');
  k.span(-X, dx, 0, eave, 0.99, Zf, C.turquoise, 'siding');
  // The gables sit on the roof's centre line (the middle of the whole depth); u runs along -z on the east face.
  const zc = (Zb + Zf) / 2;
  for (const s of [-1, 1]) k.gable(new Face(s > 0 ? 'x+' : 'x-', s * X), -s * zc, (Zf - Zb) / 2, eave, rise, C.turquoise, 'siding');
  k.span(dx, X, eave - 0.3, eave, 0.99, Zf, C.turquoise, 'siding');
  roofX(k, -X, X, Zb, Zf, eave, rise, 0x45494d, 'shingle', C.white, 0.4);
  corners(k, -X, dx, Zb, Zf, 0, eave, C.white);
  // The front: two large multi-pane windows, a purple door, the long fascia board in purple and white (blank).
  for (const u of [-5.4, -1.6]) window_(k, front, u, 0.7, 2.6, 1.7, 4, 2);
  door(k, front, 1.6, 0, 1.0, 2.2, C.purple);
  k.onWall(front, -1.7, 2.75, 12.6, 0.62, 0, 0.06, C.purple);
  k.onWall(front, -1.7, 2.75, 12.2, 0.38, 0.06, 0.02, C.white);
  // The covered porch deck at the east end, with a white lattice rail along its east end.
  k.grounded(dx, X, 1.0, Zf, 0.0, C.deck);
  for (const z of [Zf - 0.15, 1.15]) k.span(X - 0.25, X - 0.05, 0, eave - 0.3, z - 0.1, z + 0.1, C.white);
  k.span(dx, dx + 0.2, 0, eave - 0.3, Zf - 0.25, Zf - 0.05, C.white);
  k.span(X - 0.12, X - 0.06, 0.1, 0.95, 1.2, Zf - 0.2, C.white);
  if (!k.low) for (let z = 1.5; z < Zf - 0.2; z += 0.35) k.span(X - 0.11, X - 0.07, 0.15, 0.9, z - 0.02, z + 0.02, C.white);
  window_(k, new Face('x+', dx), -4.5, 0.8, 1.6, 1.4, 2, 2);
  door(k, new Face('x+', dx), -2.2, 0, 0.9, 2.1, C.purple);
}

// ---- 6. the pub and the dark red shop -----------------------------------------------------------------------------
function pub(k: Kit): void {
  k.at(MAIN_PLACES.pub, 0.5);
  const X = 4.2, Zb = -6.6, Zf = 2.7, eave = 4.4, rise = 4.0;
  const front = new Face('z+', Zf), eastF = new Face('x+', X);
  k.grounded(-X, X, Zb, Zf, 0, C.plinth);
  k.span(-X, X, 0, eave, Zb, Zf, C.white, 'siding');
  k.gable(front, 0, X, eave, rise, C.white, 'siding');
  k.gable(new Face('z-', Zb), 0, X, eave, rise, C.white, 'siding');
  roofZ(k, -X, X, Zb, Zf, eave, rise, 0x3e4245, 'shingle', C.white, 0.35);
  corners(k, -X, X, Zb, Zf, 0, eave, C.pubRed);
  // Two skylights on the east slope.
  const ang = Math.atan2(rise, X);
  for (const z of [-4.2, -1.2]) k.box(0.9, 0.08, 1.1, X / 2, eave + rise / 2 + 0.06, z, 0x2a3236, { rz: -ang });
  // The road end: a glazed shop front with tall red-framed windows and a glazed door, a long red-and-white fascia
  // (blank), two windows in the gable; a front stoop with red handrails.
  for (const u of [-2.4, 2.4]) window_(k, front, u, 0.45, 1.8, 2.3, 2, 2, C.pubRed);
  door(k, front, 0, 0, 1.2, 2.4, C.glass, C.pubRed);
  k.onWall(front, 0, 3.15, 8.2, 0.62, 0, 0.06, C.pubRed);
  k.onWall(front, 0, 3.15, 7.9, 0.36, 0.06, 0.02, C.white);
  for (const u of [-1.3, 1.3]) window_(k, front, u, 4.7, 0.8, 1.15, 2, 2, C.pubRed);
  k.grounded(-X, X, Zf, 3.7, 0, C.concrete);
  k.grounded(-1.0, 1.0, 3.7, 4.2, -0.25, C.concrete);
  for (const s of [-1, 1]) rail(k, v(s * 1.05, 0.9, 3.65), v(s * 1.05, 0.65, 4.15), C.pubRed, 0.85);
  // The hanging oval sign (yellow with a red rim; blank) on a bracket at the front corner.
  // It hangs off a bracket out from the front wall over the stoop, its faces along the street.
  k.box(0.07, 0.07, 1.4, X - 0.4, 3.75, Zf + 0.7, C.iron);
  const oval = new THREE.Shape().absellipse(0, 0, 0.55, 0.4, 0, Math.PI * 2, false, 0);
  const inner = new THREE.Shape().absellipse(0, 0, 0.47, 0.32, 0, Math.PI * 2, false, 0);
  k.add(new THREE.ShapeGeometry(oval, k.low ? 8 : 16), C.pubRed, null, k.matrix(X - 0.4, 3.2, Zf + 1.0, { ry: Math.PI / 2 }));
  for (const d of [-0.01, 0.01]) k.add(new THREE.ShapeGeometry(inner, k.low ? 8 : 16), C.oval, null, k.matrix(X - 0.4 + d, 3.2, Zf + 1.0, { ry: Math.PI / 2 }));
  for (const z of [-5.0, -2.0]) window_(k, eastF, -z, 1.1, 0.9, 1.4, 2, 2, C.pubRed);
  heatPump(k, eastF, 3.6); heatPump(k, eastF, 5.6);
  for (const z of [-5.0, -2.0, 1.0]) window_(k, new Face('x-', -X), z, 1.1, 0.9, 1.4, 2, 2, C.pubRed);
  // The side yard to the east: a small black-and-red food trailer with a red roof, two picnic tables (simpler on LOW,
  // but drawn: their solids stay).
  const pp = MAIN_PLACES.pub;
  k.point(...MAIN_ITEMS.foodTrailer, pp.az);
  const tg = k.ground(0, 0) + 0.45;
  k.span(-1.5, 1.5, tg, tg + 1.1, -1.0, 1.0, C.trailerBlack);
  k.span(-1.5, 1.5, tg + 1.1, tg + 2.0, -1.0, 1.0, C.pubRed);
  k.grounded(-1.4, 1.4, -0.9, 0.9, tg - 0.05, C.black);
  if (!k.low) {
    k.span(-0.9, 0.9, tg + 1.15, tg + 1.8, 1.0, 1.03, 0x26292b);
    k.roof({ a0: -1.6, a1: 1.6, w: 1.1, eave: tg + 2.0, rise: 0.35, over: 0.1, alongX: true, color: C.pubRed, tex: null });
    for (const s of [-1, 1]) k.cylinder(0.3, 0.3, 0.2, s * 0.6, tg - 0.45, -1.05, C.black, 10, { rx: Math.PI / 2 });
  }
  for (const [e, n] of MAIN_ITEMS.picnic) {
    k.point(e, n, pp.az);
    const g = k.ground(0, 0);
    if (k.low) { k.span(-0.9, 0.9, g, g + 0.78, -0.8, 0.8, C.timber); continue; }
    k.span(-0.9, 0.9, g + 0.72, g + 0.78, -0.4, 0.4, C.timber);
    for (const s of [-1, 1]) k.span(-0.9, 0.9, g + 0.42, g + 0.47, s * 0.65 - 0.14, s * 0.65 + 0.14, C.timber);
    for (const x of [-0.7, 0.7]) k.span(x - 0.05, x + 0.05, g, g + 0.72, -0.7, 0.7, C.timber);
  }
}

function redShop(k: Kit): void {
  k.at(MAIN_PLACES.redShop, 0.3);
  const X = 4.73, Z = 7.46, eave = 3.13, rise = 1.25;
  const front = new Face('z+', Z), eastF = new Face('x+', X);
  k.grounded(-X, X, -Z, Z, 0, C.plinth);
  k.span(-X, X, 0, eave, -Z, Z, C.oxblood, 'siding');
  k.gable(front, 0, X, eave, rise, C.oxblood, 'siding');
  k.gable(new Face('z-', -Z), 0, X, eave, rise, C.oxblood, 'siding');
  roofZ(k, -X, X, -Z, Z, eave, rise, 0x3f4346, 'shingle', C.white, 0.4);
  corners(k, -X, X, -Z, Z, 0, eave, C.white);
  // The road end: a large picture window, a door, a dark fascia board (blank); a row of white-framed windows down the
  // east side, by the post office lane.
  window_(k, front, 1.4, 0.7, 3.0, 1.6, 3, 1);
  door(k, front, -2.7, 0, 1.0, 2.2, 0x3a2a24);
  k.onWall(front, 0, 2.62, 8.8, 0.5, 0, 0.06, C.fasciaDark);
  for (const z of [5.0, 2.3, -0.4, -3.1]) window_(k, eastF, -z, 1.0, 1.1, 1.3, 2, 2);
  k.grounded(-3.5, -1.9, Z, Z + 0.9, -0.15, C.concrete);
}

// ---- 7. the bank branch ------------------------------------------------------------------------------------------
function bank(k: Kit): void {
  k.at(MAIN_PLACES.bank, 0.3);
  const X = 12.87, Z = 7.59, eave = 3.06, rise = 3.6;
  const front = new Face('z+', Z);
  k.grounded(-X, X, -Z, Z, 0, C.plinth);
  k.span(-X, X, 0, eave, -Z, Z, C.greige, 'siding');
  roofX(k, -X, X, -Z, Z, eave, rise, C.bankRoof, 'shingle', C.white, 0.4, true);
  corners(k, -X, X, -Z, Z, 0, eave, C.white);
  // The tall front gable with cream shingle infill over the gabled entrance porch on two white columns; tan stacked
  // stone round the glazed door and its side lights. The sign panel in the gable is left blank.
  const gw = 3.1, gr = 4.0;
  roofZ(k, -gw, gw, 0, Z, eave, gr, C.bankRoof, 'shingle', C.white, 0.35);
  k.gable(front, 0, gw, eave, gr, C.cream, 'shingle');
  k.onWall(front, 0, eave + 1.2, 2.2, 0.7, 0.02, 0.04, 0xf2efe6);
  k.span(-1.8, 1.8, 0, 2.8, Z, Z + 0.06, C.tanStone, 'stone');
  door(k, front, 0, 0, 1.1, 2.3, C.glass);
  for (const s of [-1, 1]) { k.onWall(front, s * 1.0, 1.15, 0.45, 2.3, 0.06, 0.04, C.white); k.onWall(front, s * 1.0, 1.15, 0.33, 2.15, 0.1, 0.02, C.glass); }
  k.grounded(-2.1, 2.1, Z, 10.1, 0, C.concrete);
  for (const x of [-1.75, 1.75]) k.cylinder(0.14, 0.12, 2.9, x, 0, 9.75, C.white, 10);
  roofZ(k, -2.1, 2.1, Z, 10.1, 2.9, 1.3, C.bankRoof, 'shingle', C.white, 0.25);
  k.gable(new Face('z+', 10.1 + 0.25), 0, 2.1 + 0.25, 2.9 - 0.25 * 1.3 / 2.1, 1.3 + 0.25 * 1.3 / 2.1, C.cream, 'shingle');
  for (const u of [-9.2, -5.6, 5.6, 9.2]) window_(k, front, u, 0.95, 1.0, 1.35, 3, 2);
  for (const z of [-4, 0, 4]) { window_(k, new Face('x+', X), -z, 0.95, 1.0, 1.35, 3, 2); window_(k, new Face('x-', -X), z, 0.95, 1.0, 1.35, 3, 2); }
  // The tall freestanding dark blue sign on two posts on the lawn by the road (blank).
  k.point(...MAIN_ITEMS.bankSign, 72);
  const g = Math.min(k.ground(-1.3, 0), k.ground(1.3, 0));
  for (const x of [-1.25, 1.25]) k.span(x - 0.07, x + 0.07, g - 0.2, g + 2.9, -0.07, 0.07, C.steel);
  k.span(-1.45, 1.45, g + 1.3, g + 2.8, -0.08, 0.08, C.signBlue);
}

// ---- street furniture --------------------------------------------------------------------------------------------
/** A black ornamental lamp post with a single lantern on a scrolled bracket that leans out toward the road (+z). */
function lampPost(k: Kit, e: number, n: number, az: number): void {
  k.point(e, n, az);
  const g = k.ground(0, 0);
  k.cylinder(0.2, 0.17, 0.55, 0, g - 0.1, 0, C.iron, 8);
  k.cylinder(0.075, 0.06, 3.8, 0, g + 0.45, 0, C.iron, 8);
  k.cylinder(0.1, 0.1, 0.12, 0, g + 4.2, 0, C.iron, 8);
  k.box(0.05, 0.05, 0.75, 0, g + 4.15, 0.38, C.iron);
  if (!k.low) k.add(new THREE.TorusGeometry(0.18, 0.025, 4, 10, Math.PI * 1.5), C.iron, null, k.matrix(0, g + 3.95, 0.3, { ry: Math.PI / 2 }));
  k.cylinder(0.04, 0.04, 0.12, 0, g + 4.03, 0.72, C.iron, 6);
  k.cylinder(0.12, 0.17, 0.42, 0, g + 3.6, 0.72, C.bulb, 6);
  k.add(new THREE.ConeGeometry(0.22, 0.2, k.low ? 6 : 8), C.iron, null, k.matrix(0, g + 4.12, 0.72));
}

/** The highway's north edge line, from the road list: points every ~2 m with their left normal (map coordinates). */
function sidewalkLine(roads: MapRoad[], step = 2): { e: number; n: number; nx: number; ny: number }[] {
  const near = (r: MapRoad, q: readonly number[]) => r.pts.reduce((b, p, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); return d < b.d ? { d, i } : b; }, { d: Infinity, i: -1 });
  const road = roads.filter(r => r.name === 'Highway 19').map(r => ({ r, a: near(r, SIDEWALK.from), b: near(r, SIDEWALK.to) }))
    .filter(x => x.a.d < 3 && x.b.d < 8).sort((x, y) => x.a.d + x.b.d - y.a.d - y.b.d)[0];
  if (!road) return [];
  const pts = road.r.pts.slice(Math.min(road.a.i, road.b.i), Math.max(road.a.i, road.b.i) + 1);
  const out: { e: number; n: number; nx: number; ny: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ae, an] = pts[i], [be, bn] = pts[i + 1], len = Math.hypot(be - ae, bn - an);
    if (len < 1e-6) continue;
    const nx = -(bn - an) / len, ny = (be - ae) / len, steps = Math.max(1, Math.round(len / step));
    for (let s = 0; s < steps; s++) out.push({ e: ae + (be - ae) * s / steps, n: an + (bn - an) * s / steps, nx, ny });
  }
  return out;
}
/** The side-road pieces whose box comes within 12 m of the sidewalk (the area has ~1,000 roads): found once. */
const sideCache = new WeakMap<MapRoad[], { a: [number, number]; b: [number, number]; w: number }[]>();
function sideRoads(roads: MapRoad[]): { a: [number, number]; b: [number, number]; w: number }[] {
  const hit = sideCache.get(roads); if (hit) return hit;
  const e0 = Math.min(SIDEWALK.from[0], SIDEWALK.to[0]) - 12, e1 = Math.max(SIDEWALK.from[0], SIDEWALK.to[0]) + 12;
  const n0 = Math.min(SIDEWALK.from[1], SIDEWALK.to[1]) - 12, n1 = Math.max(SIDEWALK.from[1], SIDEWALK.to[1]) + 12;
  const side: { a: [number, number]; b: [number, number]; w: number }[] = [];
  for (const r of roads) if (r.name !== 'Highway 19') for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i];
    if (Math.max(a[0], b[0]) < e0 || Math.min(a[0], b[0]) > e1 || Math.max(a[1], b[1]) < n0 || Math.min(a[1], b[1]) > n1) continue;
    side.push({ a, b, w: r.halfWidth + 1.0 });
  }
  sideCache.set(roads, side);
  return side;
}
/** The concrete sidewalk on the north side of Highway 19: a ribbon with a curb face, broken at side roads. */
function sidewalk(k: Kit, half: StreetHalf, roads: MapRoad[]): void {
  const line = sidewalkLine(roads, k.low ? 5 : 2).filter(p => (half === 'streetWest') === (p.e < STREET_SPLIT));
  if (line.length < 2) return;
  const side = sideRoads(roads);
  const inMouth = (e: number, n: number) => side.some(({ a: q, b: p, w }) => {
    const dx = p[0] - q[0], dy = p[1] - q[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((e - q[0]) * dx + (n - q[1]) * dy) / l)) : 0;
    return Math.hypot(e - q[0] - t * dx, n - q[1] - t * dy) < w;
  });
  const [oe0, on0] = [line[0].e, line[0].n];
  k.point(oe0, on0, 90);
  const pos: number[] = [], loc = (e: number, n: number): [number, number] => [e - oe0, on0 - n];
  const quad = (a: V3, b: V3, c: V3, d: V3) => { for (const p of [a, b, c, a, c, d]) pos.push(p.x, p.y, p.z); };
  let prev: { i: V3; o: V3; g: V3 } | null = null;
  for (const p of line) {
    const ie = p.e + p.nx * SIDEWALK.inner, inn = p.n + p.ny * SIDEWALK.inner, oe = p.e + p.nx * SIDEWALK.outer, on = p.n + p.ny * SIDEWALK.outer;
    if (inMouth(ie, inn) || inMouth(oe, on)) { prev = null; continue; }
    const [ix, iz] = loc(ie, inn), [ox, oz] = loc(oe, on), gi = k.ground(ix, iz), go = k.ground(ox, oz), top = Math.max(gi, go) + SIDEWALK.top;
    const cur = { i: v(ix, top, iz), o: v(ox, top, oz), g: v(ix, gi - 0.05, iz) };
    if (prev) { quad(prev.i, cur.i, cur.o, prev.o); quad(prev.g, cur.g, cur.i, prev.i); }
    prev = cur;
  }
  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  k.add(geo, C.sidewalk);
}
/** A festoon of small bulbs across the road, between two dark posts. */
function festoon(k: Kit, a: readonly [number, number], b: readonly [number, number]): void {
  const az = Math.atan2(b[0] - a[0], b[1] - a[1]) * 180 / Math.PI;
  k.point(a[0], a[1], az);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ga = k.ground(0, 0), gb = k.ground(len, 0), h = 6.8;
  for (const [x, g] of [[0, ga], [len, gb]]) k.cylinder(0.11, 0.09, h + 0.3, x, g - 0.3, 0, C.wood, 8);
  if (k.low) return;
  const pts: V3[] = [], N = 24;
  for (let i = 0; i <= N; i++) { const t = i / N, y = ga + h + (gb - ga) * t - 0.9 * 4 * t * (1 - t); pts.push(v(len * t, y, 0)); }
  for (let i = 0; i < N; i++) rail(k, pts[i], pts[i + 1], C.wire, 0);
  for (let i = 1; i < N; i++) k.box(0.09, 0.12, 0.09, pts[i].x, pts[i].y - 0.1, 0, C.bulb);
}
function street(k: Kit, half: StreetHalf, roads: MapRoad[], ribbon = true): void {
  const mine = (e: number) => (half === 'streetWest') === (e < STREET_SPLIT);
  for (const [e, n, h] of STREET_LAMPS) if (mine(e)) lampPost(k, e, n, h);
  for (const [a, b] of FESTOONS) if (mine(a[0])) festoon(k, a, b);
  // The sidewalk layer's slab lies inside this ribbon's band (3.75-5.35 m); one sidewalk, not two.
  if (ribbon) sidewalk(k, half, roads);
}

// ---- build and merge -----------------------------------------------------------------------------------------------
/** A road in map coordinates (east, north). */
export interface MapRoad { name: string | null; halfWidth: number; pts: [number, number][] }
type Unit = PlaceName | StreetHalf;
const BUILDERS: Record<PlaceName, (k: Kit) => void> = { grocery, postOffice, hall, gas, museum, plaza, cafe, pub, redShop, bank };
const clusterOf = (u: Unit): Cluster => u === 'streetWest' ? 'west' : u === 'streetEast' ? 'east' : (MAIN_PLACES[u] as MainPlace).cluster;

let shared: Map<Tex | null, THREE.MeshLambertMaterial> | null = null;
function materials(): Map<Tex | null, THREE.MeshLambertMaterial> {
  if (shared) return shared;
  const tex = textures(), mats = new Map<Tex | null, THREE.MeshLambertMaterial>();
  for (const key of TEXES) mats.set(key, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: key ? tex[key] : null }));
  return shared = mats;
}
/** Build one unit: its geometry per surface pattern (not yet merged across units). */
export function buildUnit(unit: Unit, site: MabouMainSite, groundAt: (x: number, z: number) => number, low: boolean, roads: MapRoad[]): Map<Tex | null, THREE.BufferGeometry> {
  const kit = new SiteKit<Tex>(low, site.village, groundAt);
  if (unit === 'streetWest' || unit === 'streetEast') street(kit, unit, roads, !site.sidewalkLayer);
  else BUILDERS[unit](kit);
  if (low) for (const tex of TEXES) if (!LOW_TEXES.includes(tex) && kit.parts.has(tex)) {
    const plain = kit.parts.get(null) ?? [];
    for (const g of kit.parts.get(tex)!) { g.deleteAttribute('uv'); plain.push(g); }
    kit.parts.set(null, plain); kit.parts.delete(tex);
  }
  const out = new Map<Tex | null, THREE.BufferGeometry>();
  for (const [tex, parts] of kit.parts) {
    const g = mergeGeometries(parts);
    if (!g) throw new Error(`Mabou main ${unit}: geometry could not be merged`);
    for (const p of parts) p.dispose();
    out.set(tex, g);
  }
  return out;
}
function meshes(name: string, geos: Map<Tex | null, THREE.BufferGeometry>, shadows: boolean): THREE.Group {
  const group = new THREE.Group(); group.name = name;
  for (const [tex, geometry] of geos) {
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials().get(tex)!);
    mesh.name = `${name}-${tex ?? 'paint'}`;
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }
  return group;
}

/** A map point in a place's local frame (the inverse of frameToMap). */
function toLocal(p: MainPlace, e: number, n: number): [number, number] {
  const a = p.az * Math.PI / 180, s = Math.sin(a), c = Math.cos(a), de = e - p.e, dn = n - p.n;
  return [de * s + dn * c, de * c - dn * s];
}
/** A measured roof: its place's anchor in world metres, the sine and cosine of its azimuth, and its rectangle. */
interface Roof { x: number; z: number; sin: number; cos: number; rect: [number, number, number, number]; top: number }
/**
 * The roof of each footprint rectangle of a place, read from the geometry the renderer draws: every triangle is clipped
 * to the rectangle (a few centimetres in, so a wall standing on its edge does not count) and the highest point of what
 * is left is the roof there. A roof plane that overhangs a lower wing counts at its height over the wing, not its ridge.
 */
export function roofTops(place: MainPlace, geos: Map<Tex | null, THREE.BufferGeometry>, village: readonly [number, number]): Roof[] {
  const IN = 0.05, tops = place.rects.map(() => -Infinity);
  const tri: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const g of geos.values()) {
    const pos = g.attributes.position;   // the kit's geometry is not indexed: three vertices per triangle
    for (let i = 0; i + 2 < pos.count; i += 3) {
      for (let j = 0; j < 3; j++) {
        const [lx, lz] = toLocal(place, pos.getX(i + j) + village[0], village[1] - pos.getZ(i + j));
        tri[j][0] = lx; tri[j][1] = pos.getY(i + j); tri[j][2] = lz;
      }
      for (let k = 0; k < place.rects.length; k++) {
        const r = place.rects[k];
        const top = clippedTop(tri, r[0] + IN, r[1] - IN, r[2] + IN, r[3] - IN);
        if (top > tops[k]) tops[k] = top;
      }
    }
  }
  const a = place.az * Math.PI / 180, anchor = { x: place.e - village[0], z: village[1] - place.n, sin: Math.sin(a), cos: Math.cos(a) };
  return place.rects.flatMap((rect, k) => Number.isFinite(tops[k]) ? [{ ...anchor, rect, top: tops[k] }] : []);
}
/** The highest point of a triangle ([x, y, z] points) over the box x0..x1, z0..z1; -Infinity if it does not reach it. */
function clippedTop(tri: [number, number, number][], x0: number, x1: number, z0: number, z1: number): number {
  if (Math.max(tri[0][0], tri[1][0], tri[2][0]) <= x0 || Math.min(tri[0][0], tri[1][0], tri[2][0]) >= x1
    || Math.max(tri[0][2], tri[1][2], tri[2][2]) <= z0 || Math.min(tri[0][2], tri[1][2], tri[2][2]) >= z1) return -Infinity;
  let poly: number[][] = tri;
  // Sutherland-Hodgman against the four sides; height is linear over the triangle, so the clipped corners carry it.
  for (const [axis, edge, keepAbove] of [[0, x0, true], [0, x1, false], [2, z0, true], [2, z1, false]] as [number, number, boolean][]) {
    const inside = (p: number[]) => keepAbove ? p[axis] >= edge : p[axis] <= edge;
    const next: number[][] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], ia = inside(a), ib = inside(b);
      if (ia) next.push(a);
      if (ia !== ib) { const t = (edge - a[axis]) / (b[axis] - a[axis]); next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
    }
    if (!next.length) return -Infinity;
    poly = next;
  }
  let top = -Infinity;
  for (const p of poly) if (p[1] > top) top = p[1];
  return top;
}

/**
 * Each unit builds once, when the camera comes within reach and the finest land under it is in memory; one unit per
 * update, so no frame builds two. A cluster's units are merged once all are built.
 */
export class MabouMain implements HandBuiltPlace {
  readonly group = new THREE.Group();
  triangles = 0;
  /** True while a unit near the camera has its land and is about to be built: a picture should wait. */
  waiting = false;
  private pending: { unit: Unit; x: number; z: number; probes: { x: number; z: number }[] }[];
  private built = new Map<Cluster, { units: Map<Unit, Map<Tex | null, THREE.BufferGeometry>>; group: THREE.Group; merged: boolean }>();
  private nextProbe = 0;
  private centres = new Map<Unit, { x: number; z: number }>();
  private keepers: THREE.Mesh[] = [];
  private roads: MapRoad[];
  /** The roof over each footprint rectangle of every built place, measured from its drawn geometry (see roofTops). */
  private roofs: Roof[] = [];
  constructor(readonly site: MabouMainSite, private terrain: Terrain, private low: boolean, roads: Road[]) {
    this.group.name = 'mabou-main';
    const [VE, VN] = site.village;
    this.roads = roads.map(r => ({ name: r.name, halfWidth: r.halfWidth, pts: r.pts.map(([x, z]): [number, number] => [x + VE, VN - z]) }));
    sideRoads(this.roads);   // found once at load, not in the frame that builds the sidewalk
    const units: Unit[] = [...Object.keys(MAIN_PLACES) as PlaceName[], 'streetWest', 'streetEast'];
    this.pending = units.map(unit => {
      const pts = unit === 'streetWest' || unit === 'streetEast' ? [...streetPoints(unit), ...this.sidewalkProbes(unit)] : placePoints(unit);
      const probes = pts.map(([e, n]) => site.world(e, n));
      const x = probes.reduce((s, p) => s + p.x, 0) / probes.length, z = probes.reduce((s, p) => s + p.z, 0) / probes.length;
      this.centres.set(unit, { x, z });
      return { unit, x, z, probes };
    });
    for (const c of ['west', 'east'] as Cluster[]) {
      const group = new THREE.Group(); group.name = `mabou-main-${c}`;
      this.group.add(group); this.built.set(c, { units: new Map(), group, merged: false });
    }
    // The materials and their patterns exist from the start, and one empty mesh each is drawn once the camera is within
    // 900 m of the street (see update), so three.js builds their shaders and uploads the patterns before the first
    // place is built, not in the frame that builds it. Each keeper goes once a real mesh with its material is in the scene.
    for (const [tex, material] of materials()) {
      if (low && !LOW_TEXES.includes(tex)) continue;
      const g = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ...(tex ? [['uv', 2]] : [])] as [string, number][]) g.setAttribute(name, new THREE.Float32BufferAttribute([], size));
      const keeper = new THREE.Mesh(g, material);
      keeper.name = `mabou-main-keeper-${tex ?? 'paint'}`; keeper.frustumCulled = false; keeper.castShadow = keeper.receiveShadow = true;
      this.group.add(keeper); this.keepers.push(keeper);
    }
  }
  private sidewalkProbes(half: StreetHalf): [number, number][] {
    return sidewalkLine(this.roads).filter((p, i) => i % 12 === 0 && (half === 'streetWest') === (p.e < STREET_SPLIT))
      .map(p => [p.e + p.nx * SIDEWALK.outer, p.n + p.ny * SIDEWALK.outer]);
  }
  get done(): boolean { return this.pending.length === 0; }
  /** The finest land is ready under every probe (levelAt only reads; it keeps no far tile in use). */
  private ready(item: { probes: { x: number; z: number }[] }): boolean {
    return item.probes.every(p => this.terrain.levelAt(p.x, p.z) >= 8);
  }
  update(view: { x: number; z: number }, now: number): void {
    // Far away (more than 1.6 km from a cluster's units), a cluster is not drawn at all.
    for (const [c, b] of this.built) {
      const units = this.pendingOrBuilt(c);
      b.group.visible = units.some(u => Math.hypot(view.x - u.x, view.z - u.z) < 1600);
    }
    // The shader keepers are drawn only within 900 m of the street, so far views upload none of its patterns. The cost
    // moves to the 900 m crossing (six small canvases, at most two Lambert programs), well before the 450 m build reach.
    const near = [...this.centres.values()].some(u => Math.hypot(view.x - u.x, view.z - u.z) < 900);
    for (const keeper of this.keepers) keeper.visible = near;
    const reach = this.low ? 320 : 450;
    // Every frame: a unit in reach whose land is ready is about to be built, so a picture (or a count) must wait.
    this.waiting = this.pending.some(p => Math.hypot(view.x - p.x, view.z - p.z) <= reach && this.ready(p));
    if (!this.pending.length || (!this.waiting && now < this.nextProbe)) return;
    for (const item of [...this.pending]) {
      if (Math.hypot(view.x - item.x, view.z - item.z) > reach || !this.ready(item)) continue;
      const fallback = this.terrain.constructionHeightAt(item.x, item.z);
      if (fallback === null) continue;
      const geos = buildUnit(item.unit, this.site, (x, z) => this.terrain.constructionHeightAt(x, z) ?? fallback, this.low, this.roads);
      for (const g of geos.values()) this.triangles += g.attributes.position.count / 3;
      this.pending.splice(this.pending.indexOf(item), 1);
      if (item.unit !== 'streetWest' && item.unit !== 'streetEast') this.roofs.push(...roofTops(MAIN_PLACES[item.unit], geos, this.site.village));
      this.place(item.unit, geos);
      this.waiting = this.pending.some(p => Math.hypot(view.x - p.x, view.z - p.z) <= reach && this.ready(p));
      this.nextProbe = this.waiting ? 0 : now + 400;
      return;
    }
    this.nextProbe = now + 400;
  }
  private pendingOrBuilt(c: Cluster): { x: number; z: number }[] {
    return [...this.centres].filter(([u]) => clusterOf(u) === c).map(([, p]) => p);
  }
  /** Show a built unit; once every unit of its cluster is built, merge the cluster into one mesh per pattern. */
  private place(unit: Unit, geos: Map<Tex | null, THREE.BufferGeometry>): void {
    const c = clusterOf(unit), b = this.built.get(c)!;
    b.units.set(unit, geos);
    const shadows = true;
    const all = [...this.centres.keys()].filter(u => clusterOf(u) === c);
    if (all.every(u => b.units.has(u))) {
      for (const child of [...b.group.children]) b.group.remove(child);
      const merged = new Map<Tex | null, THREE.BufferGeometry>();
      for (const tex of TEXES) {
        const list = [...b.units.values()].flatMap(m => m.get(tex) ? [m.get(tex)!] : []);
        if (!list.length) continue;
        const g = mergeGeometries(list);
        if (!g) throw new Error(`Mabou main ${c}: cluster could not be merged`);
        merged.set(tex, g);
        for (const l of list) l.dispose();
      }
      b.units.clear(); b.merged = true;
      b.group.add(meshes(`mabou-main-${c}`, merged, shadows));
    } else {
      b.group.add(meshes(`mabou-main-${unit}`, geos, shadows));
    }
    // A keeper goes once a real mesh uses its material.
    const used = new Set<THREE.Material>();
    this.group.traverse(o => { if (o instanceof THREE.Mesh && !this.keepers.includes(o)) used.add(o.material as THREE.Material); });
    for (const keeper of [...this.keepers]) if (used.has(keeper.material as THREE.Material)) {
      this.group.remove(keeper); keeper.geometry.dispose(); this.keepers.splice(this.keepers.indexOf(keeper), 1);
    }
  }
  /**
   * The highest drawn roof at a world point (the drone's floor), -Infinity off every built place. A footprint counts a
   * metre larger all round, as the surveyed boxes do (drone.ts roofHeights). A place not yet built has no roof here, as
   * it has none in the picture.
   */
  roofAt(x: number, z: number): number {
    let top = -Infinity;
    for (const r of this.roofs) {
      if (r.top <= top) continue;
      // toLocal without its allocation (this runs every frame the drone flies): east is +x, north is -z.
      const de = x - r.x, dn = r.z - z, lx = de * r.sin + dn * r.cos, lz = de * r.cos - dn * r.sin;
      if (lx > r.rect[0] - 1 && lx < r.rect[1] + 1 && lz > r.rect[2] - 1 && lz < r.rect[3] + 1) top = r.top;
    }
    return top;
  }
  /** Built units of each cluster, and whether the cluster is merged (for the checks). */
  state(): Record<Cluster, { merged: boolean; units: number }> {
    const s = {} as Record<Cluster, { merged: boolean; units: number }>;
    for (const [c, b] of this.built) s[c] = { merged: b.merged, units: b.merged ? -1 : b.units.size };
    return s;
  }
  resolveSolids(car: Pushable): void {
    if (Math.hypot(car.x - this.site.centre.x, car.z - this.site.centre.z) < this.site.reach) pushOut(car, this.site.solids);
  }
}
