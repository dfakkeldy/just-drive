/**
 * The heart of Judique, modelled by hand from the public-safe dash cam brief (the project brief). Words, numbers and
 * map positions only: no picture pixels, and no names, sign words, civic numbers or badges. Every sign is blank.
 *
 * Each place is built once, when the camera is near and the finest land is in memory, and is merged into one mesh per
 * surface pattern (plain paint, coursed stone, lap siding, shingles, standing-seam metal). LOW detail leaves out the
 * small parts (tracery, louvres, quoins, rails, furniture) and keeps the masses, colours and openings.
 */
import * as THREE from 'three';
import { addFlag, type Flag } from './flags';
import type { Terrain } from './terrain';
import { pushOut, type Pushable } from './parked';
import { CHURCH_WALL, MAILBOX_CABINETS, VILLAGE_ITEMS, VILLAGE_PLACES, placePoints, type JudiqueVillageSite, type PlaceName, type VillagePlace } from './judique-village-site';
import { Kit as SiteKit, Face, canvas, grey, mergeKit, seeded, v } from './site-kit';

type Tex = 'stone' | 'siding' | 'shingle' | 'seam' | null;
type V3 = THREE.Vector3;
type Kit = SiteKit<Exclude<Tex, null>>;

// Paint, from the brief (overcast frames read darker than the paint; these are the paint).
const C = {
  stone: 0xb7a07c, dressed: 0xcbbb9b, plinth: 0x8f8d88, sage: 0x84a79b, sageDark: 0x6f9085, slate: 0x3a4048,
  white: 0xf1f0ea, cream: 0xe9dfc2, glass: 0x1d2427, louvre: 0x7b7f84, brick: 0x8a4b3a, iron: 0x1b1c1d,
  redStone: 0x9a5843, concrete: 0xaaa69d, marble: 0xd8d5cc, flowers: 0x9a2a24, soil: 0x3d3027, evergreen: 0x2f4a32,
  musicWall: 0x8a9a7c, lightShingle: 0xa9abaa, cone: 0x45494d, maroon: 0x5e1f24, led: 0xd98a2b, timber: 0x7a5a3c,
  hallWall: 0xa59e8f, hallRoof: 0x55595c, shelterRoof: 0x3f6b48, rail: 0x8a7a62,
  mansardWall: 0xeceae2, mansardRoof: 0x4b5651, door: 0x4a3a2c,
  storeWall: 0xcbbd98, storeRoof: 0x9b6a52, binRed: 0xa02a24, lime: 0x8cc43a,
  navy: 0x23314a, garageDoor: 0xe6e6e1, roofGrey: 0x6c6e70, signRed: 0xb3262a, signBlue: 0x23458f,
  welcome: 0x1f4e8c, cabinet: 0x8d8f8c, cabinetTop: 0xa5282a, hydrant: 0xb0221c, pole: 0x6f5a44, lamp: 0x7c807c,
  wood: 0xa07a50, gazeboRoof: 0x6e3426, tank: 0xe8e8e4,
};

function textures(): Record<Exclude<Tex, null>, THREE.Texture> {
  // Rock-faced coursed sandstone, two metres a repeat: courses of mixed height, blocks of mixed length, thin joints,
  // a mottled face, some warmer (rust) and darker (weathered) blocks and faint streaks running down.
  const stone = canvas(512, 512, g => {
    const rnd = seeded(11), px = 256;   // pixels a metre
    g.fillStyle = grey(0.7); g.fillRect(0, 0, 512, 512);
    let y = 0;
    while (y < 512) {
      const h = Math.min(512 - y, Math.round((0.24 + rnd() * 0.16) * px));
      let x = -Math.floor(rnd() * 200);
      while (x < 512) {
        const w = Math.round((0.38 + rnd() * 0.7) * px), l = 0.84 + rnd() * 0.16, tint = rnd();
        const [r, gg, b] = tint < 0.18 ? [1, 0.9, 0.78] : tint < 0.3 ? [0.86, 0.85, 0.84] : [1, 0.98, 0.95];
        for (const dx of [0, 512, -512]) {
          const x0 = x + dx + 2, y0 = y + 2, ww = w - 4, hh = h - 4;
          g.fillStyle = `rgb(${255 * l * r},${255 * l * gg},${255 * l * b})`; g.fillRect(x0, y0, ww, hh);
          g.fillStyle = grey(1, 0.08); g.fillRect(x0, y0, ww, 3);
          g.fillStyle = grey(0, 0.08); g.fillRect(x0, y0 + hh - 4, ww, 4);
          for (let k = 0; k < ww * hh / 120; k++) { g.fillStyle = grey(rnd() < 0.5 ? 0 : 1, 0.05 + rnd() * 0.05); g.fillRect(x0 + rnd() * (ww - 6), y0 + rnd() * (hh - 5), 3 + rnd() * 6, 2 + rnd() * 4); }
        }
        x += w;
      }
      y += h;
    }
    for (let k = 0; k < 9; k++) {
      const x = rnd() * 512, w = 4 + rnd() * 10, y0 = rnd() * 300, grad = g.createLinearGradient(0, y0, 0, y0 + 220);
      grad.addColorStop(0, 'rgba(45,32,22,0.12)'); grad.addColorStop(1, 'rgba(45,32,22,0)');
      g.fillStyle = grad; g.fillRect(x, y0, w, 220);
    }
  });
  stone.repeat.set(0.5, 0.5);
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
  // Standing-seam metal: a raised seam every half metre (the seams run down the slope).
  const seam = canvas(128, 16, g => {
    g.fillStyle = grey(0.93); g.fillRect(0, 0, 128, 16);
    for (const x of [0, 64]) { g.fillStyle = grey(1); g.fillRect(x, 0, 3, 16); g.fillStyle = grey(0.7); g.fillRect(x + 3, 0, 3, 16); }
  });
  return { stone, siding, shingle, seam };
}

// ---- shapes --------------------------------------------------------------------------------------------------------
/** A pointed (lancet) arch: sides up to `spring`, two curves meeting at `apex`. */
function lancetShape(w: number, y0: number, spring: number, apex: number, cx = 0): THREE.Shape {
  const r = w / 2, s = new THREE.Shape(), k = spring + (apex - spring) * 0.62;
  s.moveTo(cx - r, y0); s.lineTo(cx + r, y0); s.lineTo(cx + r, spring);
  s.quadraticCurveTo(cx + r, k, cx, apex); s.quadraticCurveTo(cx - r, k, cx - r, spring); s.closePath();
  return s;
}
/** A moon gate: a circle of radius r about height cy, cut flat at the ground (y = 0). */
function moonShape(r: number, cy: number, cx = 0): THREE.Shape {
  const x0 = Math.sqrt(Math.max(0.01, r * r - cy * cy)), a0 = Math.atan2(-cy, x0), a1 = Math.atan2(-cy, -x0) + Math.PI * 2;
  const s = new THREE.Shape(); s.moveTo(cx + x0, 0); s.absarc(cx, cy, r, a0, a1, false); s.closePath();
  return s;
}
function moonRing(r0: number, r1: number, cy: number, cx = 0): THREE.Shape {
  const outer = moonShape(r1, cy, cx), inner = moonShape(r0, cy, cx);
  outer.holes.push(new THREE.Path(inner.getPoints(24).reverse()));
  return outer;
}

// ---- reusable pieces ----------------------------------------------------------------------------------------------
/** A two-light lancet with Y tracery and a small circle in the head, in a dressed stone surround (church nave). */
function lancetWindow(k: Kit, f: Face, u: number, w: number, y0: number, spring: number, apex: number, surround: number, lights = 2): void {
  k.shape(lancetShape(w + 0.42, y0 - 0.14, spring, apex + 0.3, u), f, 0.02, surround, 12);
  k.shape(lancetShape(w + 0.14, y0 - 0.04, spring, apex + 0.1, u), f, 0.04, C.white, 12);
  k.shape(lancetShape(w, y0, spring, apex, u), f, 0.06, C.glass, 12);
  k.onWall(f, u, y0 - 0.12, w + 0.5, 0.12, 0, 0.16, surround);   // sill
  if (k.low || lights < 2) return;
  const t = 0.07, ym = spring + 0.1;
  k.onWall(f, u, (y0 + ym) / 2, t, ym - y0, 0.06, 0.04, C.white);
  const head = apex - spring, ry = spring + head * 0.45;
  for (const s of [-1, 1]) {
    const dx = w * 0.24 * s, len = Math.hypot(dx, ry - ym + 0.1);
    k.onWall(f, u + dx / 2, (ym + ry + 0.1) / 2, t, len, 0.06, 0.04, C.white, -Math.atan2(dx, ry - ym + 0.1));
  }
  const ring = new THREE.RingGeometry(w * 0.13, w * 0.13 + 0.06, 14);
  k.add(ring, C.white, null, f.at(u, ry + w * 0.2, 0.1));
}
/** A rectangular sash window with a white frame and glazing bars (cols x rows panes). */
function sashWindow(k: Kit, f: Face, u: number, y0: number, w: number, h: number, cols = 2, rows = 2, trim = C.white): void {
  k.onWall(f, u, y0 + h / 2, w + 0.2, h + 0.2, 0, 0.05, trim);
  k.onWall(f, u, y0 + h / 2, w, h, 0.05, 0.02, C.glass);
  k.onWall(f, u, y0 - 0.1, w + 0.3, 0.08, 0, 0.12, trim);
  if (k.low) { k.onWall(f, u, y0 + h / 2, w, 0.06, 0.07, 0.02, trim); return; }
  for (let i = 1; i < cols; i++) k.onWall(f, u - w / 2 + w * i / cols, y0 + h / 2, 0.045, h, 0.07, 0.02, trim);
  for (let j = 1; j < rows; j++) k.onWall(f, u, y0 + h * j / rows, w, j === rows / 2 ? 0.07 : 0.045, 0.07, 0.02, trim);
}
function heatPump(k: Kit, f: Face, u: number): void {
  k.onWall(f, u, 0.55, 0.95, 0.7, 0.15, 0.36, 0xd9d9d4);
  if (!k.low) k.add(new THREE.CircleGeometry(0.24, 12), 0x3a3d3f, null, f.at(u - 0.12, 0.55, 0.52));
}
/** Black metal handrail from a to b (local points, rail height already added), with posts every ~2 m. */
function rail(k: Kit, a: V3, b: V3, color = C.iron, post = 0.9): void {
  const d = b.clone().sub(a), len = d.length();
  k.add(new THREE.BoxGeometry(len, 0.05, 0.05), color, null, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5),
    new THREE.Quaternion().setFromUnitVectors(v(1, 0, 0), d.clone().normalize()), v(1, 1, 1)));
  if (k.low || post <= 0) return;
  const n = Math.max(1, Math.round(len / 2));
  for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); k.box(0.05, post, 0.05, p.x, p.y - post / 2, p.z, color); }
}
/** A wooden pole with a cobra-head lamp. */
function lamp(k: Kit, e: number, n: number, az: number, h = 8.5): void {
  k.point(e, n, az);
  k.cylinder(0.14, 0.11, h, 0, 0, 0, C.pole, 8);
  k.box(1.8, 0.08, 0.08, 0.9, h - 0.6, 0, C.lamp);
  k.box(0.6, 0.16, 0.3, 1.9, h - 0.68, 0, C.lamp);
}
function flagpole(k: Kit, x: number, z: number, h: number, flags: readonly Flag[]): void {
  k.cylinder(0.07, 0.04, h, x, 0, z, C.white, 8);
  k.add(new THREE.SphereGeometry(0.08, 8, 6), C.white, null, k.matrix(x, h + 0.05, z));
  flags.forEach((flag, i) => addFlag(k, flag, x, h - 0.9 - i * 1.3, z + 0.05, 0.85));
}
function shrub(k: Kit, x: number, z: number, r: number, color: number): void {
  if (k.low) return;
  const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, 0.7, 1);
  k.add(g, color, null, k.matrix(x, k.ground(x, z) + r * 0.45, z));
}
function conifer(k: Kit, x: number, z: number, h: number): void {
  const g = k.ground(x, z);
  k.add(new THREE.ConeGeometry(h * 0.28, h, 7), C.evergreen, null, k.matrix(x, g + h / 2 + 0.15, z));
}

// ---- the stone church ---------------------------------------------------------------------------------------------
function church(k: Kit): void {
  k.at(VILLAGE_PLACES.church, 0.3);
  const L = 12, W = 6.75, eave = 6, ridge = 13, TX = 16.6, TW = 2.9;
  const north = new Face('z+', W), south = new Face('z-', -W), west = new Face('x+', L), east = new Face('x-', -L);
  // Plinth and walls.
  k.grounded(-L - 0.1, L + 0.1, -W - 0.1, W + 0.1, 0.5, C.plinth);
  k.grounded(L, TX + 0.1, -TW - 0.1, TW + 0.1, 0.5, C.plinth);
  k.grounded(-16.1, -L, -7.1, 7.1, 0.5, C.plinth);
  k.span(-L, L, 0.5, eave, -W, W, C.stone, 'stone');
  k.gable(west, 0, W, eave, ridge - eave, C.stone, 'stone');
  k.gable(east, 0, W, eave, ridge - eave, C.stone, 'stone');
  // Steep sage standing-seam roof; the west end stops behind the coped parapet, the east end overhangs a little.
  k.roof({ a0: -L, a1: L, w: W, eave, rise: ridge - eave, over: 0.35, endOver: 0.0, alongX: true, color: C.sage, tex: 'seam', fascia: C.white });
  k.box(2 * L + 0.2, 0.18, 0.34, 0, ridge + 0.05, 0, C.sageDark);
  for (const s of [-1, 1]) {   // west coping along both rakes, kneelers at the eaves
    const ang = Math.atan2(ridge - eave, W), len = Math.hypot(W, ridge - eave) + 0.3;
    k.box(0.62, 0.32, len, L + 0.06, (eave + ridge) / 2 + 0.24, s * W / 2, C.dressed, { rx: s * ang });
    k.box(0.7, 0.5, 0.75, L + 0.06, eave + 0.1, s * (W + 0.05), C.dressed);
  }
  k.box(0.5, 0.5, 0.5, L + 0.06, ridge + 0.35, 0, C.dressed);
  // Brick chimney on the ridge near the east gable.
  k.span(-9.9, -9.0, ridge - 1.2, ridge + 1.6, -0.45, 0.45, C.brick);
  k.span(-10.0, -8.9, ridge + 1.6, ridge + 1.75, -0.55, 0.55, 0x5a3a30);
  // Pilaster buttresses between the six bays, both long sides; dressed quoins at the corners.
  const bays = [-8.75, -5.25, -1.75, 1.75, 5.25, 8.75];
  for (const f of [north, south]) {
    for (const x of [-10.5, -7, -3.5, 0, 3.5, 7, 10.5]) {
      const u = f === north ? x : -x;
      k.onWall(f, u, 2.95, 0.7, 4.9, 0, 0.26, C.stone);
      k.onWall(f, u, 5.47, 0.8, 0.16, 0, 0.32, C.dressed);
    }
    for (const x of bays) lancetWindow(k, f, f === north ? x : -x, 1.5, 2.1, 4.5, 5.45, C.dressed);
  }
  if (!k.low) for (const [f, us] of [[north, [-L, L]], [south, [-L, L]]] as const) for (const u of us) for (let y = 0.6, i = 0; y < eave - 0.3; y += 0.62, i++) {
    const long = i % 2 ? 0.9 : 0.5, side = u > 0 ? -1 : 1;
    k.onWall(f, u + side * long / 2, y + 0.29, long, 0.56, 0, 0.04, C.dressed);
  }
  // Stepped angle buttresses at the two west corners.
  for (const s of [-1, 1]) {
    k.grounded(L, L + 1.1, s > 0 ? W - 0.9 : -W, s > 0 ? W : -W + 0.9, 0.0, C.stone);
    k.span(L, L + 1.1, 0, 3.0, s > 0 ? W - 0.9 : -W, s > 0 ? W : -W + 0.9, C.stone, 'stone');
    k.span(L, L + 0.6, 3.0, 5.2, s > 0 ? W - 0.9 : -W, s > 0 ? W : -W + 0.9, C.stone, 'stone');
    k.span(L - 0.9, L, 0, 3.0, s > 0 ? W : -W - 1.1, s > 0 ? W + 1.1 : -W, C.stone, 'stone');
    k.span(L - 0.9, L, 3.0, 5.2, s > 0 ? W : -W - 0.6, s > 0 ? W + 0.6 : -W, C.stone, 'stone');
    if (!k.low) {
      k.span(L, L + 1.18, 2.95, 3.12, s > 0 ? W - 0.95 : -W - 0.05, s > 0 ? W + 0.05 : -W + 0.95, C.dressed);
      k.span(L, L + 0.68, 5.15, 5.32, s > 0 ? W - 0.95 : -W - 0.05, s > 0 ? W + 0.05 : -W + 0.95, C.dressed);
    }
    // The west front: one two-light lancet each side of the tower.
    lancetWindow(k, west, -s * 4.6, 1.35, 2.1, 4.5, 5.4, C.dressed);
  }
  // The tower: three stages, thickened corners, string courses, a belfry and a cornice.
  const T0 = L, top = 15.9, tw = new Face('x+', TX), tn = new Face('z+', TW), ts = new Face('z-', -TW), te = new Face('x-', T0);
  k.span(T0, TX, 0.5, top, -TW, TW, C.stone, 'stone');
  for (const [x, z] of [[TX, TW], [TX, -TW], [T0 + 0.35, TW], [T0 + 0.35, -TW]]) k.box(1.0, top - 0.5, 1.0, x - 0.25 * Math.sign(x - T0 - 2), (top + 0.5) / 2, z - 0.25 * Math.sign(z), C.stone, { tex: 'stone' });
  for (const y of [6.2, 11.4]) k.span(T0 - 0.05, TX + 0.35, y - 0.12, y + 0.12, -TW - 0.35, TW + 0.35, C.dressed);
  k.span(T0 - 0.25, TX + 0.55, top, top + 0.4, -TW - 0.55, TW + 0.55, C.dressed);
  k.span(T0 - 0.1, TX + 0.4, top + 0.4, top + 0.55, -TW - 0.4, TW + 0.4, C.dressed);
  for (const f of [tw, tn, ts, te]) {
    for (const s of [-1, 1]) {
      const u = (f === tw || f === te ? 0 : (f === tn ? 1 : -1) * (T0 + TX) / 2) + s * 0.62;
      k.shape(lancetShape(0.98, 11.9, 14.2, 14.95, u), f, 0.08, C.white, 10);
      k.shape(lancetShape(0.78, 12.0, 14.2, 14.8, u), f, 0.1, C.louvre, 10);
      if (!k.low) for (let y = 12.25; y < 14.4; y += 0.3) k.onWall(f, u, y, 0.78, 0.05, 0.1, 0.06, 0x5d6166, -0.0);
    }
  }
  const mid = (T0 + TX) / 2;
  for (const f of [tn, ts]) {   // shaft: one narrow lancet at nave-window height, a slit high up
    const u = f === tn ? mid : -mid;
    lancetWindow(k, f, u, 0.62, 2.7, 4.6, 5.2, C.dressed, 1);
    k.shape(lancetShape(0.3, 8.8, 10.0, 10.3, u), f, 0.04, C.glass, 6);
  }
  k.shape(lancetShape(0.5, 7.4, 8.9, 9.3, 0), tw, 0.04, C.glass, 6);
  // Main door: cream double doors under a traceried pointed fanlight, in a deep moulded surround with a gabled hood.
  for (const [w, apex, d, col] of [[3.1, 4.75, 0.02, C.dressed], [2.75, 4.5, 0.08, 0xbfae8c], [2.4, 4.3, 0.14, C.dressed]] as const) {
    k.shape(lancetShape(w, 0, 2.85, apex), tw, d, col, 14);
  }
  k.shape(lancetShape(2.0, 0, 2.85, 4.1), tw, 0.17, C.glass, 14);
  k.onWall(tw, 0, 1.38, 1.96, 2.76, 0.18, 0.05, C.cream);
  if (!k.low) {
    k.onWall(tw, 0, 1.38, 0.05, 2.76, 0.23, 0.02, 0x9b9277);
    for (const s of [-1, 1]) for (const y of [0.7, 2.0]) k.onWall(tw, s * 0.5, y, 0.7, 0.8, 0.23, 0.02, 0xdcd1b2);
    k.onWall(tw, 0, 2.86, 2.0, 0.09, 0.2, 0.03, C.white);
    k.onWall(tw, 0, 3.25, 0.06, 0.8, 0.2, 0.03, C.white);
    k.add(new THREE.RingGeometry(0.2, 0.26, 14), C.white, null, tw.at(0, 3.72, 0.21));
  }
  const hood = new THREE.Shape([new THREE.Vector2(-1.9, 0), new THREE.Vector2(1.9, 0), new THREE.Vector2(0, 1.2)]);
  k.add(new THREE.ExtrudeGeometry(hood, { depth: 0.55, bevelEnabled: false }), C.dressed, null, tw.at(0, 4.85, -0.05));
  k.span(TX, TX + 0.55, 4.7, 4.88, -2.05, 2.05, C.dressed);
  // Plain cream side door at the foot of the tower's south face.
  k.onWall(ts, -(T0 + 1.3), 1.12, 1.0, 2.2, 0.02, 0.05, C.cream);
  k.onWall(ts, -(T0 + 1.3), 1.12, 1.24, 2.4, 0.0, 0.03, C.dressed);
  // Spire: a steep square pyramid with a bell-cast foot, dark slate, and a cross.
  const R = 2.55, prof = [[R * 1.16, 0], [R * 0.93, 0.55], [R * 0.8, 1.0], [0.05, 4.5], [0, 4.52]].map(([x, y]) => new THREE.Vector2(x, y));
  const spire = new THREE.LatheGeometry(prof, 4, Math.PI / 4); spire.scale(1, 1, 1.18);
  k.add(spire, C.slate, null, k.matrix(mid, top + 0.55, 0));
  const tip = top + 0.55 + 4.5;
  k.box(0.1, 1.15, 0.1, mid, tip + 0.5, 0, C.iron);
  k.box(0.1, 0.1, 0.6, mid, tip + 0.75, 0, C.iron);
  // East annex: low, full nave width, same roof colour; two small lancets on its south face.
  k.span(-16, -L, 0.5, 3.4, -7, 7, C.stone, 'stone');
  k.roof({ a0: -7, a1: 7, c: -14, w: 2, eave: 3.4, rise: 1.6, over: 0.3, hip0: true, hip1: true, alongX: false, color: C.sage, tex: 'seam', fascia: C.white });
  const annexS = new Face('z-', -7);
  for (const x of [-15, -13.2]) lancetWindow(k, annexS, -x, 0.55, 1.3, 2.3, 2.7, C.dressed, 1);
  k.cylinder(0.06, 0.06, eave - 0.3, L - 0.25, 0.3, -W - 0.15, 0x7d8a86, 6);
}

/** Retaining wall, stair, handrails, ramp, planters, monument and lawn sign in front of the church. */
function churchGrounds(k: Kit, site: JudiqueVillageSite): void {
  // The red sandstone wall: two runs either side of the stair, each piece level-topped and set into the bank.
  for (const run of CHURCH_WALL) {
    const pts = run.map(([e, n]) => site.world(e, n));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z), head = Math.atan2(b.x - a.x, -(b.z - a.z));
      const e = (a.x + b.x) / 2 + site.village[0], n = site.village[1] - (a.z + b.z) / 2;
      k.point(e, n, head * 180 / Math.PI);
      const front = Math.min(k.ground(0, -0.9), k.ground(-len / 2, -0.9), k.ground(len / 2, -0.9));
      const back = Math.max(k.ground(0, 1.0), k.ground(-len / 2, 1.0), k.ground(len / 2, 1.0));
      const top = Math.max(front + 0.9, back + 0.2);
      k.grounded(-len / 2 - 0.02, len / 2 + 0.02, -0.3, 0.3, top, C.redStone, 'stone');
      k.span(-len / 2 - 0.05, len / 2 + 0.05, top, top + 0.12, -0.36, 0.36, 0xa86a52);
    }
  }
  // The stair, in the church frame: 8 steps, a landing, 5 steps to the door platform.
  k.at(VILLAGE_PLACES.church, 0.3);
  const xFoot = 31.0, xPlat = 18.6, sw = 1.25, foot = k.ground(xFoot + 0.6, 0);
  // Thirteen equal rises from the foot of the stair to the door platform, whatever the bank's height.
  const rise = Math.max(0.02, -foot / 13), run = 0.32, landing = foot + 8 * rise, rise2 = rise;
  for (let i = 0; i < 8; i++) k.grounded(xFoot - (i + 1) * run, xFoot - i * run + (i === 0 ? 0.3 : 0), -sw, sw, foot + (i + 1) * rise, C.concrete);
  const xL0 = xFoot - 8 * run, xL1 = xPlat + 5 * run;
  k.grounded(xL1, xL0, -sw, sw, landing, C.concrete);
  for (let i = 0; i < 5; i++) k.grounded(xPlat + (4 - i) * run, xPlat + (5 - i) * run, -sw, sw, landing + (i + 1) * rise2, C.concrete);
  k.grounded(16.6, xPlat, -2.4, 4.8, 0, C.concrete);
  for (const z of [-sw, 0, sw]) {
    rail(k, v(xFoot, foot + 0.9, z), v(xL0, landing + 0.9, z));
    rail(k, v(xL1, landing + 0.9, z), v(xPlat, 0.9, z));
    if (z !== 0) rail(k, v(xL0, landing + 0.9, z), v(xL1, landing + 0.9, z));
  }
  // The ramp along the north side of the front.
  const xr = 27.5, low = Math.min(-0.05, k.ground(xr + 0.4, 4.1)), steps = k.low ? 3 : 6;
  for (let i = 0; i < steps; i++) {
    const x0 = xPlat + (xr - xPlat) * i / steps, x1 = xPlat + (xr - xPlat) * (i + 1) / steps;
    const y0 = low * i / steps, y1 = low * (i + 1) / steps, len = Math.hypot(x1 - x0, y1 - y0);
    k.box(len, 0.2, 1.4, (x0 + x1) / 2, (y0 + y1) / 2 - 0.1, 4.1, C.concrete, { rz: Math.atan2(y1 - y0, x1 - x0) });
    k.grounded(x0, x1, 3.4, 4.8, Math.min(y0, y1) - 0.18, C.concrete);
  }
  for (const z of [3.35, 4.85]) rail(k, v(xPlat, 0.9, z), v(xr, low + 0.9, z));
  // Round planters at the stair foot.
  for (const s of [-1, 1]) {
    const x = xFoot + 0.9, z = s * 2.3, g = k.ground(x, z);
    k.cylinder(0.6, 0.6, 0.6, x, g - 0.05, z, C.dressed, 14);
    k.cylinder(0.52, 0.52, 0.04, x, g + 0.55, z, C.soil, 14);
    shrub(k, x, z, 0.45, C.evergreen);
  }
  // The monument: a figure on a tall stone pedestal in a red flower bed.
  const [me, mn] = VILLAGE_ITEMS.monument;
  k.point(me, mn, 275);
  const mg = Math.max(k.ground(0, 0), k.ground(0.8, 0.8), k.ground(-0.8, -0.8));
  k.add(new THREE.CircleGeometry(1.9, k.low ? 10 : 20).rotateX(-Math.PI / 2), C.flowers, null, k.matrix(0, mg + 0.06, 0));
  if (!k.low) k.add(new THREE.RingGeometry(1.9, 2.05, 20).rotateX(-Math.PI / 2), C.dressed, null, k.matrix(0, mg + 0.07, 0));
  k.grounded(-0.9, 0.9, -0.9, 0.9, mg + 0.35, C.dressed);
  k.span(-0.6, 0.6, mg + 0.35, mg + 2.6, -0.6, 0.6, 0xc4beaf);
  k.span(-0.72, 0.72, mg + 2.6, mg + 2.85, -0.72, 0.72, C.dressed);
  const f = mg + 2.85;
  k.cylinder(0.34, 0.2, 1.35, 0, f, 0, C.marble, 10);
  k.add(new THREE.SphereGeometry(0.15, 10, 8), C.marble, null, k.matrix(0, f + 1.52, 0));
  if (!k.low) for (const s of [-1, 1]) k.box(0.1, 0.62, 0.12, 0.05, f + 1.0, s * 0.27, C.marble, { rx: s * 0.25 });
  // The lawn sign north-west of the church (blank), and a small black box on a post.
  const [se, sn] = VILLAGE_ITEMS.churchSign;
  k.point(se, sn, 5);
  const sg = k.ground(0, 0);
  for (const x of [-1.05, 1.05]) k.box(0.12, 1.9, 0.12, x, sg + 0.95, 0, C.white);
  k.box(2.2, 1.15, 0.1, 0, sg + 1.3, 0, C.white);
  if (!k.low) { k.box(2.0, 0.95, 0.02, 0, sg + 1.3, 0.06, 0xe7e6e0); k.box(0.06, 1.1, 0.06, 2.4, k.ground(2.4, 0) + 0.55, 0, C.iron); k.box(0.35, 0.3, 0.25, 2.4, k.ground(2.4, 0) + 1.2, 0, C.iron); }
}

// ---- the music centre ---------------------------------------------------------------------------------------------
function musicCentre(k: Kit): void {
  k.at(VILLAGE_PLACES.music, 0.35);
  const eave = 3.3, wall = C.musicWall, sid: Tex = 'siding';
  k.grounded(-16, 16, -10.4, 10.4, 0.0, C.plinth);
  k.span(-13.5, 16, 0, eave, -10.4, 7.6, wall, sid);
  k.span(-3.5, 16, 0, eave, 7.6, 10.4, wall, sid);
  k.span(-16, -13.5, 0, eave, -10.4, -6, wall, sid);
  k.span(-16, -13.5, 0, eave, 1, 7.6, wall, sid);
  for (const [x, z] of [[16, 10.4], [16, -10.4], [-16, -10.4], [-3.5, 10.4]]) k.box(0.18, eave, 0.18, x, eave / 2, z, C.white);
  k.roof({ a0: -16, a1: 16, w: 10.4, eave, rise: 5.6, over: 0.5, hip0: true, hip1: true, alongX: true, color: C.lightShingle, tex: 'shingle', fascia: C.white });
  // The front cross gable with its moon gate entrance and a painted round emblem (no words).
  k.span(-3.5, 3.5, 0, eave, 10.4, 11.6, wall, sid);
  const fg = new Face('z+', 11.6);
  k.gable(fg, 0, 3.5, eave, 3.7, wall, sid);
  k.roof({ a0: 4, a1: 11.6, w: 3.5, eave, rise: 3.7, over: 0.4, alongX: false, color: C.lightShingle, tex: 'shingle', fascia: C.white, rake: true });
  k.onWall(fg, 0, eave - 0.12, 7.1, 0.25, 0, 0.06, C.white);
  k.shape(moonRing(1.32, 1.6, 1.25), fg, 0.03, C.white, 24);
  k.shape(moonShape(1.32, 1.25), fg, 0.02, 0x2d322f, 24);
  k.onWall(fg, 0, 1.12, 1.6, 2.24, 0.025, 0.04, C.white);
  k.onWall(fg, 0, 1.12, 1.4, 2.04, 0.05, 0.02, C.glass);
  if (!k.low) k.onWall(fg, 0, 1.12, 0.05, 2.04, 0.07, 0.02, C.white);
  k.add(new THREE.CircleGeometry(0.62, k.low ? 12 : 24), C.maroon, null, fg.at(0, 5.0, 0.03));
  k.add(new THREE.CircleGeometry(0.46, k.low ? 12 : 24), 0xe4cf8e, null, fg.at(0, 5.0, 0.04));
  // The recessed porch between the turret and the cross gable: square white columns, glazed doors with sidelights.
  k.grounded(-9.7, -3.5, 7.6, 10.4, 0.05, 0xb9b6ad);
  for (const x of [-9.1, -6.4, -3.9]) k.box(0.26, eave, 0.26, x, eave / 2, 10.1, C.white);
  k.span(-9.8, -3.5, eave - 0.3, eave, 9.95, 10.4, C.white);
  const porch = new Face('z+', 7.6);
  k.onWall(porch, -6.6, 1.2, 2.6, 2.4, 0, 0.05, C.white);
  for (const [u, w] of [[-6.6, 1.5], [-7.65, 0.38], [-5.55, 0.38]] as const) k.onWall(porch, u, 1.2, w, 2.2, 0.05, 0.02, C.glass);
  // The round turret with its witch-hat cone, a white fascia band and three multi-pane casements.
  const tx = -13.2, tz = 7.4, tr = 3.5;
  k.cylinder(tr + 0.05, tr + 0.05, 0.35, tx, -0.35, tz, C.plinth, 24);
  k.cylinder(tr, tr, 4.4, tx, 0, tz, wall, 24, { tex: sid });
  k.cylinder(tr + 0.08, tr + 0.08, 0.4, tx, 4.2, tz, C.white, 24);
  const cone = new THREE.ConeGeometry(tr + 0.45, 6.5, k.low ? 12 : 24, 1, true);
  const cuv = cone.attributes.uv; for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i) * Math.PI * 2 * (tr + 0.45), cuv.getY(i) * 7.3);
  k.add(cone, C.cone, 'seam', k.matrix(tx, 4.6 + 3.25, tz));
  k.box(0.08, 0.6, 0.08, tx, 11.3, tz, C.cone);
  for (const deg of [90, 135, 180]) {
    const t = deg * Math.PI / 180, dx = Math.cos(t), dz = Math.sin(t);
    const m = k.matrix(tx + dx * (tr + 0.02), 0, tz + dz * (tr + 0.02), { ry: Math.atan2(dx, dz) });
    for (const [w, h, d, col] of [[1.2, 1.7, 0, C.white], [1.0, 1.5, 0.05, C.glass]] as const) k.add(new THREE.BoxGeometry(w, h, 0.04), col, null, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 1.85, d)));
    if (!k.low) for (const [w, h, y] of [[0.05, 1.5, 1.85], [1.0, 0.05, 1.6], [1.0, 0.05, 2.1]]) k.add(new THREE.BoxGeometry(w, h, 0.04), C.white, null, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, y, 0.09)));
  }
  // The north part of the front: two six-over-six windows and a heat pump.
  const front = new Face('z+', 10.4);
  for (const x of [7.4, 12.6]) sashWindow(k, front, x, 0.9, 1.0, 1.6, 3, 4);
  heatPump(k, front, 10.0);
  // A small triangular vent gable on the front slope.
  const vy = eave + (10.4 - 7.6) * 5.6 / 10.4;
  const vent = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.9, 0), new THREE.Vector2(0.9, 0), new THREE.Vector2(0, 0.9)]), { depth: 1.6, bevelEnabled: false });
  k.add(vent, C.lightShingle, null, k.matrix(9.5, vy - 0.15, 6.0));
  k.add(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.8, 0), new THREE.Vector2(0.8, 0), new THREE.Vector2(0, 0.8)])), C.white, null, k.matrix(9.5, vy - 0.12, 7.62));
  // The south side: a second recessed porch with white posts and a second moon gate, a window and a heat pump.
  k.grounded(-16, -13.5, -6, 1, 0.05, 0xb9b6ad);
  for (const z of [-5.6, -2.5, 0.6]) k.box(0.22, eave, 0.22, -15.75, eave / 2, z, C.white);
  const sp = new Face('x-', -13.5);
  k.shape(moonRing(1.1, 1.35, 1.05, -2.5), sp, 0.03, C.white, 20);
  k.shape(moonShape(1.1, 1.05, -2.5), sp, 0.02, 0x2d322f, 20);
  k.onWall(sp, -2.5, 1.0, 1.0, 2.0, 0.04, 0.03, C.cream);
  const side = new Face('x-', -16);
  sashWindow(k, side, -8.2, 0.9, 1.0, 1.5, 3, 4);
  heatPump(k, side, 2.4);
  // West and north faces were not seen: plain windows so they are not blank.
  const back = new Face('z-', -10.4);
  for (const u of [-11, -5, 1, 7, 12]) sashWindow(k, back, u, 0.9, 1.0, 1.5, 2, 2);
  sashWindow(k, new Face('x+', 16), 0, 0.9, 1.0, 1.5, 2, 2);
  // The front yard: a patio with picnic tables, a flagpole with two flags, shrubs and small conifers, bollards.
  k.grounded(-10, -2.5, 10.6, 15.4, Math.max(k.ground(-6, 13), k.ground(-10, 15)) + 0.04, 0xa19d94);
  if (!k.low) for (const [x, z] of [[-8.6, 12.3], [-5.6, 12.3], [-8.6, 14.4], [-5.6, 14.4]]) {
    const y = Math.max(k.ground(-6, 13), k.ground(-10, 15)) + 0.04;
    k.box(1.8, 0.06, 0.75, x, y + 0.75, z, C.timber);
    for (const s of [-1, 1]) { k.box(1.8, 0.05, 0.26, x, y + 0.45, z + s * 0.62, C.timber); k.box(0.08, 0.72, 1.4, x + s * 0.7, y + 0.36, z, 0x6b4e33); }
  }
  k.at(VILLAGE_PLACES.music, 0);
  flagpole(k, 4.5, 16.5, 8.0, ['canada', 'nova-scotia']);
  k.at(VILLAGE_PLACES.music, 0.35);
  for (const [x, z] of [[-11, 15.8], [-1.6, 15.8], [6, 12.2], [14, 12.0]]) shrub(k, x, z, 0.55, 0x6e2a26);
  for (const [x, z] of [[-12.4, 12.6], [2.2, 13.0]]) conifer(k, x, z, 2.2);
  if (!k.low) for (const x of [-2, 0.5, 3, 5.5]) k.box(0.18, 0.8, 0.18, x, k.ground(x, 17.5) + 0.4, 17.5, 0x3a3c3e);
  // The tall freestanding sign near the road: white posts, a scroll-cut maroon top board, a lit panel (blank).
  const [se, sn] = VILLAGE_ITEMS.musicSign;
  k.point(se, sn, 345);
  const g = Math.max(k.ground(-1.6, 0), k.ground(1.6, 0), k.ground(0, 0));
  k.grounded(-1.9, 1.9, -0.75, 0.75, g + 0.45, C.timber);
  k.span(-1.75, 1.75, g + 0.45, g + 0.5, -0.6, 0.6, C.soil);
  for (const x of [-1.3, 1.3]) k.box(0.2, 3.0, 0.2, x, g + 1.95, 0, C.white);
  const scroll = new THREE.Shape();
  scroll.moveTo(-1.45, 0); scroll.lineTo(1.45, 0); scroll.lineTo(1.45, 0.45); scroll.quadraticCurveTo(1.2, 0.5, 1.0, 0.75);
  scroll.quadraticCurveTo(0, 1.0, -1.0, 0.75); scroll.quadraticCurveTo(-1.2, 0.5, -1.45, 0.45); scroll.closePath();
  const board = new THREE.ExtrudeGeometry(scroll, { depth: 0.12, bevelEnabled: false, curveSegments: k.low ? 3 : 8 });
  k.add(board, C.maroon, null, k.matrix(0, g + 2.45, -0.06));
  k.box(2.4, 1.0, 0.16, 0, g + 1.75, 0, 0x16181a);
  k.box(2.2, 0.82, 0.02, 0, g + 1.75, 0.09, C.led);
  k.box(2.2, 0.82, 0.02, 0, g + 1.75, -0.09, C.led);
  if (!k.low) for (const x of [-0.9, 0.9]) shrub(k, x, 1.1, 0.35, 0x6e2a26);
  // Two yellow charging posts by the parking on the side road.
  for (const [e, n] of VILLAGE_ITEMS.evPosts) {
    k.point(e, n, 270);
    k.box(0.35, 1.5, 0.3, 0, k.ground(0, 0) + 0.75, 0, 0xe0c12a);
  }
}

// ---- the community centre and its lot -----------------------------------------------------------------------------
function communityCentre(k: Kit): void {
  k.at(VILLAGE_PLACES.hall, 0.3);
  const wall = C.hallWall, roofC = C.hallRoof, sid: Tex = 'siding', he = 3.4, we = 3.6, wx0 = -14.6, wx1 = -2.6, wc = (wx0 + wx1) / 2;
  k.grounded(-17, 17, -8.05, 8.05, 0, C.plinth);
  k.grounded(wx0, wx1, -13.3, 14.7, 0, C.plinth);
  k.span(-17, 17, 0, he, -8.05, 8.05, wall, sid);
  k.roof({ a0: -17, a1: 17, w: 8.05, eave: he, rise: 4.6, over: 0.45, hip1: true, alongX: true, color: roofC, tex: 'shingle', fascia: C.white, rake: true });
  k.gable(new Face('x-', -17), 0, 8.05, he, 4.6, wall, sid);
  // The cross wing at the south end: a tall front gable facing the lot.
  k.span(wx0, wx1, 0, we, -13.3, 14.7, wall, sid);
  k.roof({ a0: -13.3, a1: 14.7, c: wc, w: 6, eave: we, rise: 4.9, over: 0.45, alongX: false, color: roofC, tex: 'shingle', fascia: C.white, rake: true });
  const fg = new Face('z+', 14.7), bg = new Face('z-', -13.3);
  k.gable(fg, wc, 6, we, 4.9, wall, sid);
  k.gable(bg, -wc, 6, we, 4.9, wall, sid);
  for (const [x, z] of [[wx0, 14.7], [wx1, 14.7], [wx0, -13.3], [wx1, -13.3], [17, 8.05], [17, -8.05], [-17, 8.05], [-17, -8.05]]) k.box(0.16, he, 0.16, x, he / 2, z, C.white);
  // A stepped group of three tall windows in the apex, the centre one tallest.
  for (const [du, h] of [[-1.15, 1.7], [0, 2.35], [1.15, 1.7]]) sashWindow(k, fg, wc + du, 4.15, 0.85, h, 1, 3);
  // The gabled entrance porch on two white columns; its gable board is blank.
  const px0 = wc - 2.1, px1 = wc + 2.1;
  k.grounded(px0, px1, 14.7, 17.4, 0.05, 0xb3afa6);
  for (const x of [px0 + 0.3, px1 - 0.3]) k.box(0.28, 2.85, 0.28, x, 1.47, 17.1, C.white);
  k.roof({ a0: 14.7, a1: 17.3, c: wc, w: 2.1, eave: 2.9, rise: 1.5, over: 0.25, alongX: false, color: roofC, tex: 'shingle', fascia: C.white, rake: true });
  const pg = new Face('z+', 17.55);
  k.gable(pg, wc, 2.35, 2.9, 1.5, C.white);
  k.onWall(pg, wc, 3.35, 1.7, 0.42, 0.02, 0.04, 0x2f3b4a);
  k.onWall(fg, wc, 1.15, 1.9, 2.3, 0, 0.05, C.white);
  k.onWall(fg, wc, 1.15, 1.7, 2.15, 0.05, 0.02, C.glass);
  if (!k.low) k.onWall(fg, wc, 1.15, 0.05, 2.15, 0.07, 0.02, C.white);
  for (const du of [-4.3, 4.3]) sashWindow(k, fg, wc + du, 0.95, 1.0, 1.45, 2, 2);
  // The north wing along the lot: four white six-pane windows and heat pumps.
  const ef = new Face('z+', 8.05);
  for (const x of [1.4, 5.4, 9.4, 13.4]) sashWindow(k, ef, x, 1.1, 1.0, 1.25, 3, 2);
  for (const x of [3.4, 11.4]) heatPump(k, ef, x);
  const wf = new Face('z-', -8.05);
  for (const x of [1.4, 5.4, 9.4, 13.4]) sashWindow(k, wf, -x, 1.1, 1.0, 1.25, 3, 2);
  for (const u of [5.7, 11.5]) sashWindow(k, bg, u, 0.95, 1.0, 1.4, 2, 2);
  sashWindow(k, new Face('x+', 17), 0, 1.1, 1.0, 1.25, 3, 2);

  // The lot's north edge: a post-and-rail fence, two small open shelters with green metal roofs, a notice board.
  const fence = VILLAGE_ITEMS.lotFence;
  for (let i = 1; i < fence.length; i++) {
    const [ae, an] = fence[i - 1], [be, bn] = fence[i], len = Math.hypot(be - ae, bn - an), az = Math.atan2(be - ae, bn - an) * 180 / Math.PI;
    k.point((ae + be) / 2, (an + bn) / 2, az);
    const posts = Math.round(len / (k.low ? 4.8 : 2.4));
    for (let j = 0; j <= posts; j++) { const x = -len / 2 + len * j / posts; k.box(0.13, 1.25, 0.13, x, k.ground(x, 0) + 0.5, 0, C.rail); }
    for (let j = 0; j < posts; j++) {
      const x0 = -len / 2 + len * j / posts, x1 = -len / 2 + len * (j + 1) / posts;
      for (const h of k.low ? [0.85] : [0.45, 0.95]) rail(k, v(x0, k.ground(x0, 0) + h, 0.06), v(x1, k.ground(x1, 0) + h, 0.06), C.rail, 0);
    }
  }
  for (const [e, n] of VILLAGE_ITEMS.shelters) {
    k.point(e, n, 355);
    const g = Math.max(k.ground(-1.5, -1.2), k.ground(1.5, 1.2), k.ground(0, 0));
    k.grounded(-1.5, 1.5, -1.2, 1.2, g + 0.12, 0x8d8a84);
    for (const [x, z] of [[-1.35, -1.05], [1.35, -1.05], [-1.35, 1.05], [1.35, 1.05]]) k.box(0.14, 2.25, 0.14, x, g + 1.24, z, C.wood);
    k.roof({ a0: -1.5, a1: 1.5, w: 1.2, eave: g + 2.36, rise: 0.7, over: 0.3, alongX: true, color: C.shelterRoof, tex: 'seam' });
    if (!k.low) { k.box(2.4, 0.06, 0.5, 0, g + 0.55, -0.6, C.timber); k.box(2.4, 0.06, 0.5, 0, g + 0.75, 0.3, C.timber); }
  }
  const [ne, nn] = VILLAGE_ITEMS.noticeBoard;
  k.point(ne, nn, 85);
  const ng = k.ground(0, 0);
  for (const x of [-0.85, 0.85]) k.box(0.12, 2.2, 0.12, x, ng + 1.1, 0, C.wood);
  k.box(1.6, 1.0, 0.08, 0, ng + 1.4, 0, 0x6b4e33);
  k.box(1.45, 0.86, 0.02, 0, ng + 1.4, 0.05, 0xd8d2c0);
  k.roof({ a0: -1.0, a1: 1.0, w: 0.3, eave: ng + 2.05, rise: 0.3, over: 0.1, alongX: true, color: C.shelterRoof, tex: 'seam' });
  // One tall lamp inside the lot, and a red hydrant at the highway edge.
  lamp(k, VILLAGE_ITEMS.lotLamp[0], VILLAGE_ITEMS.lotLamp[1], 80, 9.5);
  const [he2, hn] = VILLAGE_ITEMS.hydrant;
  k.point(he2, hn, 0);
  const hg = k.ground(0, 0);
  k.cylinder(0.16, 0.15, 0.62, 0, hg, 0, C.hydrant, 10);
  k.add(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), C.hydrant, null, k.matrix(0, hg + 0.62, 0));
  if (!k.low) k.box(0.5, 0.1, 0.1, 0, hg + 0.45, 0, C.hydrant);
}

// ---- the white mansard house --------------------------------------------------------------------------------------
function mansardHouse(k: Kit): void {
  k.at(VILLAGE_PLACES.mansard, 0.45);
  // HX along the front (north-south), HZ deep; the driveway loop runs round the house and its ell.
  const wall = C.mansardWall, roofC = C.mansardRoof, eave = 5.0, curb = 7.4, inset = 0.85, sid: Tex = 'siding', HX = 5.5, HZ = 4.8;
  k.grounded(-HX, HX, -HZ, HZ, 0, C.plinth);
  k.span(-HX, HX, 0, eave, -HZ, HZ, wall, sid);
  k.span(-HX - 0.2, HX + 0.2, eave - 0.2, eave + 0.15, -HZ - 0.2, HZ + 0.2, C.white);
  // The Second Empire roof: a steep lower slope up to the curb, a shallow hip above it.
  const X = HX + 0.2, Z = HZ + 0.2, x1 = X - inset, z1 = Z - inset;
  const lo = (x: number, z: number) => v(x, eave + 0.15, z), hi = (x: number, z: number) => v(x, curb, z);
  k.facet([lo(-X, Z), lo(X, Z), hi(x1, z1), hi(-x1, z1)], roofC, 'shingle', v(1, 0, 0));
  k.facet([lo(X, -Z), lo(-X, -Z), hi(-x1, -z1), hi(x1, -z1)], roofC, 'shingle', v(-1, 0, 0));
  k.facet([lo(X, Z), lo(X, -Z), hi(x1, -z1), hi(x1, z1)], roofC, 'shingle', v(0, 0, -1));
  k.facet([lo(-X, -Z), lo(-X, Z), hi(-x1, z1), hi(-x1, -z1)], roofC, 'shingle', v(0, 0, 1));
  k.roof({ a0: -x1, a1: x1, w: z1, eave: curb, rise: 0.6, over: 0.12, hip0: true, hip1: true, alongX: true, color: 0x434c48, tex: 'shingle' });
  k.span(-x1 - 0.12, x1 + 0.12, curb - 0.08, curb + 0.06, -z1 - 0.12, z1 + 0.12, C.white);
  for (const x of [-3.2, 3.2]) { k.span(x - 0.35, x + 0.35, curb - 0.2, curb + 1.5, -1.6, -0.8, C.brick); k.span(x - 0.45, x + 0.45, curb + 1.5, curb + 1.62, -1.7, -0.7, 0x5a3a30); }
  // Three pedimented dormers on the front slope.
  for (const x of [-3.1, 0, 3.1]) {
    k.span(x - 0.6, x + 0.6, eave + 0.3, eave + 1.75, HZ - 1.1, HZ + 0.15, C.white);
    k.box(0.62, 0.95, 0.02, x, eave + 1.05, HZ + 0.17, C.glass);
    if (!k.low) k.box(0.62, 0.05, 0.03, x, eave + 1.05, HZ + 0.19, C.white);
    const ped = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.8, 0), new THREE.Vector2(0.8, 0), new THREE.Vector2(0, 0.6)]), { depth: 1.45, bevelEnabled: false });
    k.add(ped, C.white, null, k.matrix(x, eave + 1.75, HZ - 1.2));
    if (!k.low) for (const s of [-1, 1]) k.box(0.92, 0.05, 1.5, x + s * 0.4, eave + 2.07, HZ - 0.47, roofC, { rz: -s * 0.64 });
  }
  // Windows on two storeys; a centred front door under a small porch.
  const front = new Face('z+', HZ), sideN = new Face('x-', -HX), sideS = new Face('x+', HX), rear = new Face('z-', -HZ);
  for (const u of [-3.4, 3.4]) sashWindow(k, front, u, 0.9, 0.85, 1.7, 2, 2);
  for (const u of [-3.4, 0, 3.4]) sashWindow(k, front, u, 3.05, 0.85, 1.5, 2, 2);
  for (const f of [sideN, sideS]) for (const u of [-2.2, 2.2]) { sashWindow(k, f, u, 0.9, 0.85, 1.7, 2, 2); sashWindow(k, f, u, 3.05, 0.85, 1.5, 2, 2); }
  sashWindow(k, rear, 3.6, 3.05, 0.85, 1.5, 2, 2);
  k.onWall(front, 0, 1.15, 1.3, 2.5, 0, 0.05, C.white);
  k.onWall(front, 0, 1.1, 1.0, 2.2, 0.05, 0.03, C.door);
  k.grounded(-1.4, 1.4, HZ, HZ + 2.2, 0.0, 0xd9d6cc);
  for (let i = 1; i <= 2; i++) k.grounded(-1.0, 1.0, HZ + 2.2 + (i - 1) * 0.3, HZ + 2.2 + i * 0.3, -0.18 * i, 0xb9b5aa);
  for (const x of [-1.25, 1.25]) k.box(0.16, 2.75, 0.16, x, 1.37, HZ + 2.0, C.white);
  k.roof({ a0: -1.45, a1: 1.45, c: HZ + 1.1, w: 1.15, eave: 2.75, rise: 0.45, over: 0.15, hip0: true, hip1: true, alongX: true, color: roofC, tex: 'shingle', fascia: C.white });
  // The rear ell, one and a half storeys under a gable, set inside the driveway's east bend.
  const e0 = -HZ - 3.6;
  k.grounded(-3, 3, e0, -HZ, 0, C.plinth);
  k.span(-3, 3, 0, 4.0, e0, -HZ, wall, sid);
  k.roof({ a0: e0, a1: -HZ, c: 0, w: 3, eave: 4.0, rise: 2.3, over: 0.3, alongX: false, color: roofC, tex: 'shingle', fascia: C.white, rake: true });
  const eg = new Face('z-', e0);
  k.gable(eg, 0, 3, 4.0, 2.3, wall, sid);
  sashWindow(k, eg, 0, 1.0, 0.85, 1.4, 2, 2);
  sashWindow(k, new Face('x-', -3), -6.6, 1.0, 0.85, 1.4, 2, 2);
}

// ---- the store, with the community mailbox bank --------------------------------------------------------------------
function store(k: Kit): void {
  k.at(VILLAGE_PLACES.store, 0.25);
  const wall = C.storeWall, sid: Tex = 'siding', eave = 3.7, rise = 3.4, roofC = C.storeRoof;
  k.grounded(-11.2, 11.2, -4.4, 4.4, 0, C.plinth);
  k.span(-11.2, 11.2, 0, eave, -4.4, 4.4, wall, sid);
  k.roof({ a0: -11.2, a1: 11.2, w: 4.4, eave, rise, over: 0.35, alongX: true, color: roofC, tex: 'shingle', fascia: C.white, rake: true });
  const front = new Face('x+', 11.2), back = new Face('x-', -11.2), north = new Face('z-', -4.4), south = new Face('z+', 4.4);
  k.gable(front, 0, 4.4, eave, rise, wall, sid);
  k.gable(back, 0, 4.4, eave, rise, wall, sid);
  // White corner boards, and a brick chimney on the ridge.
  for (const [x, z] of [[11.2, -4.4], [11.2, 4.4], [-11.2, -4.4], [-11.2, 4.4]]) k.span(x - 0.09, x + 0.09, 0, eave, z - 0.09, z + 0.09, C.white);
  k.span(1.2, 1.8, eave + rise - 0.5, eave + rise + 0.9, -0.3, 0.3, C.brick);
  k.span(1.14, 1.86, eave + rise + 0.9, eave + rise + 1.0, -0.36, 0.36, 0x6f6c66);
  // The front is the gable end to the highway (u runs north): one white door on a concrete step with a shuttered
  // window each side, a blank sign board leaning out above them, a lamp, and a small vent in the peak.
  k.grounded(11.2, 12.1, -0.3, 1.5, -0.05, C.concrete);
  k.onWall(front, -0.6, 1.07, 1.15, 2.2, 0, 0.05, C.white);
  k.onWall(front, -0.6, 1.02, 0.95, 2.05, 0.05, 0.03, 0xe4e2da);
  if (!k.low) { k.onWall(front, -0.6, 1.5, 0.55, 0.75, 0.08, 0.02, C.glass); k.onWall(front, -0.28, 1.0, 0.06, 0.14, 0.08, 0.04, 0x55585a); }
  for (const [u, w] of [[2.3, 1.15], [-3.0, 0.95]]) {
    sashWindow(k, front, u, 1.15, w, 1.0, 2, 2);
    for (const s of [-1, 1]) k.onWall(front, u + s * (w / 2 + 0.3), 1.65, 0.34, 1.12, 0, 0.04, C.white);
  }
  k.add(new THREE.BoxGeometry(3.1, 0.92, 0.08), 0x4a4d50, null, front.at(0.3, 3.5, 0.13).multiply(new THREE.Matrix4().makeRotationX(0.2)));
  k.add(new THREE.BoxGeometry(2.96, 0.78, 0.04), C.white, null, front.at(0.3, 3.5, 0.19).multiply(new THREE.Matrix4().makeRotationX(0.2)));
  if (!k.low) for (const u of [-0.9, 1.5]) k.onWall(front, u, 3.88, 0.06, 0.06, 0, 0.17, 0x4a4d50);
  k.onWall(front, 1.0, 2.55, 0.16, 0.2, 0, 0.16, 0x2c2e30);
  k.onWall(front, 0, eave + rise - 1.15, 0.5, 0.6, 0, 0.04, C.white);
  if (!k.low) for (let j = 0; j < 4; j++) k.onWall(front, 0, eave + rise - 1.36 + j * 0.14, 0.4, 0.05, 0.04, 0.02, C.louvre);
  // Blank boards near the front corner on both long walls: a tall yellow board on each, a long blue banner on the
  // north wall, and two small white boards. No words or marks.
  k.onWall(north, -9.3, 2.45, 1.05, 1.7, 0.02, 0.06, 0xe2b92e);
  k.onWall(north, -6.9, 2.75, 3.3, 1.15, 0.02, 0.03, 0x3f83c4);
  k.onWall(north, -6.9, 3.2, 3.3, 0.2, 0.05, 0.01, 0xf1f0ea);
  k.onWall(north, -10.5, 2.0, 0.75, 0.6, 0.02, 0.04, 0xf1f0ea);
  k.onWall(north, -10.3, 1.0, 0.5, 0.75, 0.02, 0.02, 0x3f83c4);
  k.onWall(south, 9.4, 2.45, 1.05, 1.7, 0.02, 0.06, 0xe2b92e);
  k.onWall(south, 10.5, 3.05, 0.7, 0.5, 0.02, 0.04, 0xf1f0ea);
  k.onWall(south, 9.4, 1.0, 0.5, 0.75, 0.02, 0.02, 0x4b3a78);
  sashWindow(k, south, 7.9, 2.15, 0.8, 0.75, 2, 1);
  k.onWall(south, 5.9, 1.45, 1.7, 1.35, 0, 0.05, C.white);
  k.onWall(south, 5.9, 1.45, 1.5, 1.15, 0.05, 0.01, 0xcfd9d6);
  heatPump(k, south, 3.9);
  if (!k.low) k.onWall(south, 3.9, 1.3, 1.2, 0.06, 0, 0.5, 0x8d8f8c);
  sashWindow(k, south, -1.0, 1.0, 1.0, 1.3, 2, 2);
  // The north wall, from the front corner back: a weathered ice panel, a red clothing bin and two lime-green dumpsters.
  k.onWall(north, -6.2, 1.35, 1.5, 1.6, 0, 0.05, 0xe9e8e2);
  k.onWall(north, -6.2, 1.35, 1.3, 1.4, 0.05, 0.01, 0xc3cfdb);
  const gn = k.ground(4.4, -5.2);
  k.span(3.8, 5.0, gn, gn + 1.8, -5.9, -4.7, C.binRed);
  if (!k.low) k.span(3.75, 5.05, gn + 1.8, gn + 1.95, -5.95, -4.65, 0x8a2420);
  for (const x of [1.7, -0.7]) { const g = k.ground(x, -5.6); k.span(x - 0.95, x + 0.95, g + 0.12, g + 1.25, -6.3, -4.9, C.lime); k.span(x - 1.0, x + 1.0, g + 1.25, g + 1.35, -6.35, -4.85, 0x4a4f52); }
  // Back additions (the baked wings). South: one storey under a shed roof. North: a taller wing under its own grey
  // gable, ridge north-south. Its roof runs on into the main slope, so the end is closed.
  // The south walls stop at the low edge of the shed roof (2.43 m); a wedge of wall closes each side under the slope.
  k.span(-11.2, -4.5, 0, 2.43, 4.4, 9.4, wall, sid);
  const wingEast = new Face('x+', -4.5);
  k.facet([back.point(4.4, 2.43), back.point(9.4, 2.43), back.point(4.4, 3.0)], wall, sid, back.uAxis());
  k.facet([wingEast.point(-9.4, 2.43), wingEast.point(-4.4, 2.43), wingEast.point(-4.4, 3.0)], wall, sid, wingEast.uAxis());
  k.facet([v(-11.4, 3.0, 4.4), v(-4.3, 3.0, 4.4), v(-4.3, 2.4, 9.7), v(-11.4, 2.4, 9.7)], roofC, 'shingle', v(1, 0, 0));
  k.span(-11.2, -6.5, 0, 3.3, -8.2, -4.4, wall, sid);
  k.roof({ a0: -8.2, a1: -3.1, c: -8.85, w: 2.35, eave: 3.3, rise: 1.5, over: 0.3, alongX: false, color: C.lightShingle, tex: 'shingle', fascia: C.white, rake: true });
  k.gable(new Face('z-', -8.2), 8.85, 2.35, 3.3, 1.5, wall, sid);
  if (!k.low) k.onWall(new Face('x+', -6.5), 6.3, 2.6, 0.16, 0.2, 0, 0.16, 0x2c2e30);
  k.grounded(-11.2, -4.5, 4.4, 9.4, 0, C.plinth);
  k.grounded(-11.2, -6.5, -8.2, -4.4, 0, C.plinth);

  // The community mailbox bank: ten grey cabinets with red top panels in one row on a concrete pad, doors to the
  // highway. No marks.
  const [me, mn] = VILLAGE_ITEMS.mailboxes;
  k.point(me, mn, 350);
  const half = (MAILBOX_CABINETS / 2) * 0.88 + 0.21;   // the pad's half length along the row
  const g = Math.max(k.ground(-half + 0.25, 0), k.ground(half - 0.25, 0), k.ground(0, 0.5));
  k.grounded(-half, half, -0.6, 0.6, g + 0.12, 0x9a978e);
  for (let j = 0; j < MAILBOX_CABINETS; j++) {
    const x = (j - (MAILBOX_CABINETS - 1) / 2) * 0.88;
    k.box(0.8, 1.7, 0.5, x, g + 0.12 + 0.85, 0, C.cabinet);
    k.box(0.82, 0.28, 0.52, x, g + 0.12 + 1.56, 0, C.cabinetTop);
    k.box(0.84, 0.05, 0.55, x, g + 0.12 + 1.73, 0, 0x5b5b55);
    if (!k.low) for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) k.box(0.23, 0.2, 0.02, x + (col - 1) * 0.25, g + 0.12 + 0.62 + row * 0.215, 0.26, 0x9e9c94);
  }
}

// ---- the service garage -------------------------------------------------------------------------------------------
function garage(k: Kit): void {
  k.at(VILLAGE_PLACES.garage, 0.15);
  const H = 4.6;
  k.grounded(-9.65, 9.65, -6.7, 6.7, 0, C.plinth);
  k.span(-9.65, 9.65, 0, H, -6.7, 6.7, C.navy);
  k.span(-9.75, 9.75, H - 0.75, H - 0.25, -6.8, 6.8, C.white);
  k.span(-9.75, 9.75, H, H + 0.14, -6.8, 6.8, C.roofGrey);
  const front = new Face('x+', 9.65);
  for (const u of [-3.6, 0.6]) {
    k.onWall(front, u, 1.75, 3.6, 3.5, 0, 0.06, C.garageDoor);
    if (!k.low) for (let y = 0.6; y < 3.5; y += 0.58) k.onWall(front, u, y, 3.5, 0.03, 0.06, 0.02, 0xb8b8b2);
    k.onWall(front, u, 2.65, 3.2, 0.42, 0.065, 0.02, C.glass);
  }
  k.onWall(front, 4.4, 1.05, 0.95, 2.1, 0.0, 0.05, C.glass);
  k.onWall(front, 5.8, 1.6, 1.3, 1.1, 0.0, 0.05, C.glass);
  sashWindow(k, new Face('z+', 6.7), 5.5, 1.2, 1.2, 1.0, 2, 1);
  // The tall pole sign in red, white and blue bands (blank), two lamp posts, white propane tanks.
  const [se, sn] = VILLAGE_ITEMS.garageSign;
  k.point(se, sn, 356);
  const g = k.ground(0, 0);
  k.cylinder(0.14, 0.14, 7.0, 0, g, 0, 0x8b8f92, 10);
  k.box(2.7, 1.9, 0.26, 0, g + 5.95, 0, 0x3a3d40);
  k.box(2.5, 1.7, 0.3, 0, g + 5.95, 0, C.white);
  k.box(2.5, 0.42, 0.32, 0, g + 6.55, 0, C.signRed);
  k.box(2.5, 0.16, 0.32, 0, g + 5.3, 0, C.signBlue);
  for (const [e, n] of VILLAGE_ITEMS.garageLamps) lamp(k, e, n, 86, 8.0);
  const [te, tn] = VILLAGE_ITEMS.propaneTanks;
  k.point(te, tn, 0);
  for (const x of [-1.4, 1.4]) {
    const tg = k.ground(x, 0);
    k.cylinder(0.6, 0.6, 2.8, x, tg + 0.75 - 1.4, 0, C.tank, 14, { rx: Math.PI / 2 });
    for (const z of [-0.9, 0.9]) k.box(0.9, 0.5, 0.2, x, tg + 0.25, z, 0x8b8f92);
  }
}

// ---- small items --------------------------------------------------------------------------------------------------
function smallItems(k: Kit): void {
  // The open octagonal gazebo on the east lawn: natural wood posts, a red-brown roof, a flagpole beside it.
  const [ge, gn] = VILLAGE_ITEMS.gazebo;
  k.point(ge, gn, 0);
  const g = Math.max(k.ground(-2, 0), k.ground(2, 0), k.ground(0, 2), k.ground(0, -2)) + 0.25;
  const deck = new THREE.CylinderGeometry(2.4, 2.4, 1, 8);
  k.add(deck, 0x8c6c48, null, k.matrix(0, g - 0.5, 0, { ry: Math.PI / 8 }));
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) * Math.PI / 4, x = Math.cos(t) * 2.2, z = Math.sin(t) * 2.2;
    k.box(0.16, 2.5, 0.16, x, g + 1.25, z, C.wood);
    if (!k.low && i !== 6) {
      const t2 = (i + 1.5) * Math.PI / 4;
      rail(k, v(x, g + 0.9, z), v(Math.cos(t2) * 2.2, g + 0.9, Math.sin(t2) * 2.2), C.wood, 0);
    }
  }
  k.add(new THREE.ConeGeometry(3.0, 1.7, 8, 1, true), C.gazeboRoof, null, k.matrix(0, g + 2.5 + 0.85, 0, { ry: Math.PI / 8 }));
  k.box(0.12, 0.6, 0.12, 0, g + 4.4, 0, C.gazeboRoof);
  k.point(ge + 3.8, gn + 1.5, 0);
  flagpole(k, 0, 0, 7.0, ['canada']);
  // The blue welcome sign on two posts (blank), seen from both ways.
  const [we, wn] = VILLAGE_ITEMS.welcomeSign;
  k.point(we, wn, 80);
  const wg = Math.min(k.ground(-1.2, 0), k.ground(1.2, 0));
  for (const x of [-1.15, 1.15]) k.box(0.12, 2.3, 0.12, x, wg + 1.15, 0, 0x8b8f92);
  k.box(2.7, 1.35, 0.06, 0, wg + 1.55, 0, C.white);
  k.box(2.5, 1.15, 0.08, 0, wg + 1.55, 0, C.welcome);
}

// ---- merge and run ------------------------------------------------------------------------------------------------
const BUILDERS: Record<PlaceName, (k: Kit, site: JudiqueVillageSite) => void> = {
  church: (k, site) => { church(k); churchGrounds(k, site); },
  music: k => musicCentre(k),
  hall: k => communityCentre(k),
  mansard: k => { mansardHouse(k); smallItems(k); },
  store: k => store(k),
  garage: k => garage(k),
};

let shared: { tex: Record<Exclude<Tex, null>, THREE.Texture>; mats: Map<Tex, THREE.MeshLambertMaterial> } | null = null;
function materials() {
  if (shared) return shared;
  const tex = textures(), mats = new Map<Tex, THREE.MeshLambertMaterial>();
  for (const key of [null, 'stone', 'siding', 'shingle', 'seam'] as Tex[]) {
    mats.set(key, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: key ? tex[key] : null }));
  }
  return shared = { tex, mats };
}

/** Build one place into a group: one mesh per surface pattern. */
export function buildPlace(name: PlaceName, site: JudiqueVillageSite, groundAt: (x: number, z: number) => number, low: boolean): THREE.Group {
  const kit: Kit = new SiteKit(low, site.village, groundAt);
  BUILDERS[name](kit, site);
  const { mats } = materials();
  return mergeKit(kit, `judique-${name}`, tex => mats.get(tex)!);
}

/** Each place builds once, when the camera comes within reach and the finest land under it is in memory. */
export class JudiqueVillage {
  readonly group = new THREE.Group();
  triangles = 0;
  private pending: { name: PlaceName; x: number; z: number; probes: { x: number; z: number }[] }[];
  private nextProbe = 0;
  constructor(readonly site: JudiqueVillageSite, private terrain: Terrain, private low: boolean) {
    this.group.name = 'judique-village';
    this.pending = (Object.keys(VILLAGE_PLACES) as PlaceName[]).map(name => {
      const p = VILLAGE_PLACES[name] as VillagePlace, c = site.world(p.e, p.n);
      return { name, x: c.x, z: c.z, probes: placePoints(name).map(([e, n]) => site.world(e, n)) };
    });
    // The materials and their patterns exist from the start, and one empty mesh each is in every picture, so three.js
    // builds their shaders (and uploads the patterns) with the scene, not mid-drive at the first place (as cemeteries.ts).
    // An empty mesh still makes an empty draw call, so the keepers go once every place is built.
    for (const [tex, material] of materials().mats) {
      const g = new THREE.BufferGeometry();
      for (const [name, size] of [['position', 3], ['normal', 3], ['color', 3], ...(tex ? [['uv', 2]] : [])] as [string, number][]) g.setAttribute(name, new THREE.Float32BufferAttribute([], size));
      const keeper = new THREE.Mesh(g, material);
      keeper.name = `judique-keeper-${tex ?? 'paint'}`; keeper.frustumCulled = false; keeper.castShadow = keeper.receiveShadow = true;
      this.group.add(keeper); this.keepers.push(keeper);
    }
  }
  private keepers: THREE.Mesh[] = [];
  get done(): boolean { return this.pending.length === 0; }
  update(view: { x: number; z: number }, now: number): void {
    if (!this.pending.length || now < this.nextProbe) return;
    this.nextProbe = now + 400;
    const reach = this.low ? 320 : 450;
    for (const item of [...this.pending]) {
      if (Math.hypot(view.x - item.x, view.z - item.z) > reach) continue;
      if (item.probes.some(p => (this.terrain.surfaceAt(p.x, p.z)?.level ?? 0) < 8)) continue;
      const fallback = this.terrain.constructionHeightAt(item.x, item.z);
      if (fallback === null) continue;
      const group = buildPlace(item.name, this.site, (x, z) => this.terrain.constructionHeightAt(x, z) ?? fallback, this.low);
      group.traverse(o => { if (o instanceof THREE.Mesh) this.triangles += o.geometry.attributes.position.count / 3; });
      this.group.add(group);
      this.pending.splice(this.pending.indexOf(item), 1);
      if (!this.pending.length) for (const keeper of this.keepers.splice(0)) { this.group.remove(keeper); keeper.geometry.dispose(); }
      return;   // one place per update, so no frame builds two
    }
  }
  resolveSolids(car: Pushable): void {
    if (Math.hypot(car.x - this.site.centre.x, car.z - this.site.centre.z) < this.site.reach) pushOut(car, this.site.solids);
  }
}
