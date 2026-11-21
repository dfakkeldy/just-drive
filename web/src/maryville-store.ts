import * as THREE from 'three';
import { pushOut, type Pushable } from './parked';
import type { HandBuiltPlace } from './place';
import { canvas, Face, grey, Kit, mergeKit, seeded, v } from './site-kit';
import type { Terrain } from './terrain';
export { MaryvilleStoreSite } from './maryville-store-site';
import { MAIN, PORCH, POSTS, POST_HALF, SHOP, TRACTORS, WING, type MaryvilleStoreSite, type Tractor } from './maryville-store-site';

type Tex = 'boards' | 'metal' | 'sign';
const GREY = 0x98958c, RED = 0x713833, METAL = 0x65302f, WOOD = 0xd9bf94;
const SASH = 0xc7a254, GLASS = 0x455759, IVORY = 0xe2dfd2;
const EAVE = 3.8, RISE = 2.0, SKIRT = 0.48;

function materials(): Map<Tex | null, THREE.Material> {
  const boards = canvas(128, 128, g => {
    const random = seeded(31);
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = grey(0.82 + random() * 0.15);
      g.fillRect(0, y, 128, 16);
      g.fillStyle = grey(1, 0.27);
      g.fillRect(0, y + 1, 128, 1);
      g.fillStyle = grey(0.32, 0.42);
      g.fillRect(0, y + 15, 128, 1);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = grey(random(), 0.18);
        g.fillRect(random() * 128, y + 2 + random() * 12, 4 + random() * 27, 1);
      }
    }
  });
  const metal = canvas(64, 128, g => {
    g.fillStyle = grey(0.93);
    g.fillRect(0, 0, 64, 128);
    for (let x = 0; x < 64; x += 32) {
      g.fillStyle = grey(0.60);
      g.fillRect(x, 0, 2, 128);
      g.fillStyle = grey(0.99);
      g.fillRect(x + 2, 0, 2, 128);
    }
  });
  const sign = canvas(1024, 96, g => {
    g.fillStyle = '#613835';
    g.fillRect(0, 0, 1024, 96);
    g.strokeStyle = '#aa7b58';
    g.lineWidth = 2;
    g.strokeRect(9, 8, 1006, 80);
    g.fillStyle = '#eadcc0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 65px Georgia, serif';
    g.fillText('LONG FURROW TRACTORS', 512, 51, 970);
  }, false);
  const lambert = (map: THREE.Texture | null = null) => new THREE.MeshLambertMaterial({ vertexColors: true, map, side: THREE.DoubleSide });
  return new Map([[null, lambert()], ['boards', lambert(boards)], ['metal', lambert(metal)], ['sign', lambert(sign)]]);
}

/** Six panes in a deep timber casing. The upper panes catch more sky. */
function windowFrame(k: Kit<Tex>, face: Face, u: number, y: number, w: number, h: number, sash = SASH): void {
  k.onWall(face, u, y, w + 0.21, h + 0.21, 0.025, 0.095, RED);
  k.onWall(face, u, y, w, h, 0.12, 0.035, sash);
  for (let col = -1; col <= 1; col++) for (const row of [-1, 1]) {
    k.onWall(face, u + col * w * 0.30, y + row * h * 0.22, w * 0.30 - 0.038, h * 0.44 - 0.036,
      0.155, 0.012, row > 0 ? 0x748486 : GLASS);
  }
  k.onWall(face, u, y - h / 2 - 0.07, w + 0.30, 0.095, 0.10, 0.115, RED);
}

function door(k: Kit<Tex>, face: Face, u: number, y: number): void {
  k.onWall(face, u, y + 1.09, 1.24, 2.20, 0.027, 0.09, RED);
  k.onWall(face, u, y + 1.06, 1.01, 2.08, 0.117, 0.045, IVORY);
  k.onWall(face, u, y + 1.58, 0.75, 0.66, 0.162, 0.018, GLASS);
  k.onWall(face, u, y + 1.73, 0.75, 0.36, 0.180, 0.005, 0x667b80);
  k.onWall(face, u, y + 0.51, 0.74, 0.65, 0.162, 0.025, 0xbdbab0);
  k.onWall(face, u, y + 0.51, 0.59, 0.50, 0.187, 0.006, IVORY);
  k.onWall(face, u + 0.39, y + 1.02, 0.06, 0.065, 0.162, 0.045, 0x56524a);
}

function buildShop(k: Kit<Tex>): void {
  k.at(SHOP, 0);
  const [back, front, north, south] = MAIN;
  const f = new Face('x+', front), b = new Face('x-', back);
  const s = new Face('z+', south), n = new Face('z-', north);
  const facade = new Face('x+', front + 0.05);

  k.grounded(back, front, north, south, SKIRT, WOOD, 'boards');
  k.span(back, front, SKIRT, EAVE, north, south, GREY, 'boards');
  k.gable(b, 0, south, EAVE, RISE, GREY, 'boards');
  k.roof({ a0: back, a1: front - 0.04, w: south, eave: EAVE, rise: RISE, endOver: 0,
    alongX: true, color: METAL, tex: 'metal', fascia: RED, rake: true });
  for (const x of [back, front]) for (const z of [north, south]) {
    k.box(0.20, EAVE - SKIRT, 0.20, x, (EAVE + SKIRT) / 2, z, RED);
  }

  // Three stepped widths cover the gable end. The small central peak is a separate board panel.
  const step = (w: number, bottom: number, top: number) => {
    k.span(front - 0.24, front + 0.05, bottom, top, -w, w, GREY, 'boards');
    k.box(0.39, 0.13, 2 * w + 0.07, front - 0.095, top, 0, RED);
  };
  step(south, EAVE - 0.02, 4.65);
  step(4.76, 4.65, 5.48);
  step(3.32, 5.48, 6.29);
  k.gable(facade, 0, 3.32, 6.30, 1.14, GREY, 'boards');
  const rake = Math.atan2(1.14, 3.32), rakeLength = Math.hypot(3.32, 1.14);
  for (const side of [-1, 1]) {
    k.onWall(facade, side * 1.66, 6.87, rakeLength + 0.14, 0.16, 0.01, 0.12, RED, -side * rake);
    windowFrame(k, facade, side * 0.73, 5.84, 0.79, 0.69, 0x9d8d73);
  }

  k.onWall(f, 0, 3.04, 11.98, 0.20, 0.031, 0.075, RED);
  // A shallow fascia set into the stepped front. Use the whole sign canvas once.
  const sign = new THREE.PlaneGeometry(8.6, 0.78);
  k.add(sign, 0xffffff, 'sign', facade.at(0, 3.92, 0.114));
  k.onWall(facade, 0, 3.92, 8.72, 0.87, 0.024, 0.080, RED);

  for (const u of [-4.37, -2.14, 2.14, 4.37]) windowFrame(k, f, u, 1.86, 1.62, 1.62);
  door(k, f, 0, SKIRT);
  k.grounded(front, front + 0.62, -0.82, 0.82, SKIRT - 0.03, WOOD);
  k.grounded(front + 0.62, front + 1.06, -0.87, 0.87, SKIRT - 0.24, 0x97918a);
  for (const x of [-6.8, 0.3, 7.2]) windowFrame(k, n, -x, 1.95, 0.74, 1.12, IVORY);
  for (const x of [-8.9, 10.1]) windowFrame(k, s, x, 1.93, 0.74, 1.03, IVORY);

  const [wb, wf, wn, ws] = WING;
  const wingFront = new Face('x+', wf), wingSouth = new Face('z+', ws);
  k.grounded(wb, wf, wn, ws, SKIRT - 0.14, WOOD, 'boards');
  k.span(wb, wf, SKIRT - 0.14, 2.72, wn, ws, GREY, 'boards');
  for (const x of [wb, wf]) k.box(0.15, 2.40, 0.15, x, 1.53, ws, RED);
  const wingCentre = (wn + ws) / 2, wingHalf = (ws - wn) / 2;
  k.roof({ a0: wb, a1: wf, c: wingCentre, w: wingHalf, eave: 2.72, rise: 1.0, over: 0.27, endOver: 0.16,
    alongX: true, color: METAL, tex: 'metal', fascia: RED, rake: true });
  k.gable(wingFront, -wingCentre, wingHalf, 2.72, 1, GREY, 'boards');
  k.gable(new Face('x-', wb), wingCentre, wingHalf, 2.72, 1, GREY, 'boards');
  for (const x of [-3.75, 3.60]) windowFrame(k, wingSouth, x, 1.61, 0.83, 1.05, IVORY);
  door(k, wingFront, -10.30, 0.35);
  windowFrame(k, wingFront, -7.65, 1.62, 0.85, 0.90, IVORY);

  const [px0, px1, pz0, pz1] = PORCH;
  const pzNear = pz0 - 0.11, pzFar = pz1 + 0.24, outer = px1 + 0.18;
  k.grounded(px0, px1, pz0, pz1, 0.34, WOOD, 'boards');
  k.grounded(px1, px1 + 0.48, pz0, pz1, 0.16, 0x998472);
  k.facet([v(px0, 2.70, pzNear), v(px0, 2.70, pzFar), v(outer, 2.32, pzFar), v(outer, 2.32, pzNear)],
    METAL, 'metal', v(0, 0, 1));
  k.box(0.14, 0.18, pzFar - pzNear, outer, 2.24, (pzNear + pzFar) / 2, RED);
  for (const z of POSTS) k.span(px1 - 0.15 - POST_HALF, px1 - 0.15 + POST_HALF,
    0.34, 2.29, z - POST_HALF, z + POST_HALF, 0xa4937d);
}

function buildTractor(k: Kit<Tex>, t: Tractor): void {
  k.at(t, 0);
  const s = t.scale, paint = t.color, dark = 0x303536, rubber = 0x242525, rim = 0xbeb6a4;
  const y0 = (k.ground(-1.16 * s, 0) + k.ground(1.25 * s, 0)) / 2;
  const part = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, rz = 0) =>
    k.box(w * s, h * s, d * s, x * s, y0 + y * s, z * s, color, { rz });
  part(0.05, 0.71, 0, 3.45, 0.32, 0.61, dark);
  part(0.70, 1.24, 0, 1.77, 0.66, 0.81, paint);
  part(0.73, 1.61, 0, 1.71, 0.11, 0.86, paint);
  part(1.61, 1.23, 0, 0.11, 0.62, 0.75, dark);
  for (const y of [1.03, 1.17, 1.31, 1.45]) part(1.67, y, 0, 0.025, 0.028, 0.66, 0x626864);
  for (const z of [-0.29, 0.29]) part(1.69, 1.48, z, 0.035, 0.13, 0.17, 0xd7caa7);
  part(1.90, 0.74, 0, 0.38, 0.28, 0.76, 0x3b4040);
  part(-0.92, 1.08, 0, 1.41, 0.13, 1.35, dark);
  part(-0.95, 0.87, 0.77, 0.42, 0.10, 0.22, 0x7c817b);
  part(-1.93, 0.68, 0, 0.32, 0.12, 0.31, dark);
  k.cylinder(0.067 * s, 0.067 * s, 0.77 * s, 0.92 * s, y0 + 1.60 * s, -0.33 * s, dark, 8);
  part(0.97, 2.39, -0.33, 0.20, 0.05, 0.16, dark);

  if (t.cab) {
    part(-0.86, 1.50, 0, 1.21, 0.71, 1.15, paint);
    part(-0.86, 2.09, 0, 1.14, 0.88, 1.08, 0x576f76);
    part(-0.86, 2.37, 0, 1.145, 0.24, 1.085, 0x819397);
    part(-0.86, 2.59, 0, 1.35, 0.17, 1.25, paint);
    for (const x of [-1.43, -0.29]) for (const z of [-0.54, 0.54]) part(x, 2.09, z, 0.075, 0.93, 0.075, dark);
  } else {
    part(-1.06, 1.34, 0, 0.47, 0.13, 0.53, dark);
    part(-1.27, 1.55, 0, 0.10, 0.40, 0.49, dark, -0.13);
    part(-0.38, 1.55, 0, 0.11, 0.49, 0.11, dark, -0.36);
    k.cylinder(0.18 * s, 0.18 * s, 0.04 * s, -0.42 * s, y0 + 1.77 * s, 0, dark, 12, { rz: -0.35 });
    for (const z of [-0.51, 0.51]) part(-1.51, 1.78, z, 0.10, 1.41, 0.10, dark);
    part(-1.51, 2.49, 0, 0.10, 0.10, 1.12, dark);
  }

  const wheel = (x: number, z: number, radius: number, width: number, side: number): void => {
    const r = radius * s, a = x * s, b = z * s * side, h = width * s;
    const y = k.ground(a, b) + r - 0.045 * s;
    const axle = { rx: Math.PI / 2 };
    k.cylinder(r, r, h, a, y - h / 2, b, rubber, 16, axle);
    k.cylinder(r * 0.57, r * 0.57, h + 0.04 * s, a, y - (h + 0.04 * s) / 2, b, rim, 12, axle);
    k.cylinder(r * 0.24, r * 0.24, 0.08 * s, a, y - 0.04 * s, b + (h / 2 + 0.045 * s) * side, dark, 8, axle);
    if (!k.low) for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      k.box(r * 0.23, 0.055 * s, h * 0.92, a + Math.sin(angle) * r * 0.987, y - Math.cos(angle) * r * 0.987,
        b, 0x30302f, { ry: side * 0.23, rz: angle });
    }
  };
  for (const side of [-1, 1]) {
    wheel(-1.16, 0.93, 0.81, 0.49, side);
    wheel(1.25, 0.71, 0.52, 0.33, side);
    part(-1.16, 1.62, side * 0.80, 1.38, 0.10, 0.61, paint);
    part(-1.79, 1.51, side * 0.80, 0.11, 0.19, 0.61, paint);
  }
}

/** One small place. Build once when its ground is loaded, and share the contacts with every vehicle. */
export class MaryvilleStore implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private built = false;
  waiting = false;

  constructor(readonly site: MaryvilleStoreSite, private terrain: Terrain, private low: boolean) {
    this.group.name = 'maryville-store';
  }

  update(view: THREE.Vector3): void {
    this.waiting = !this.built && Math.hypot(view.x - this.site.centre.x, view.z - this.site.centre.z) < 300;
    if (!this.waiting) return;
    if (this.site.probes.some(([x, z]) => this.terrain.levelAt(x, z) < (this.terrain.hasFinest(x, z) ? 8 : 7))) return;
    const g = this.terrain.meshHeightAt(this.site.centre.x, this.site.centre.z);
    if (g === null) return;
    const kit = new Kit<Tex>(this.low, this.site.village, (x, z) => this.terrain.meshHeightAt(x, z) ?? g);
    buildShop(kit);
    for (const tractor of TRACTORS) buildTractor(kit, tractor);
    const mats = materials();
    this.group.add(mergeKit(kit, 'long-furrow', tex => mats.get(tex)!));
    this.built = true;
    this.waiting = false;
  }

  resolveSolids(car: Pushable): void {
    if (Math.hypot(car.x - this.site.centre.x, car.z - this.site.centre.z) < 52) pushOut(car, this.site.solids);
  }
}
