/**
 * Port Hood Mail Depot exterior building (invented, no real postal names or marks).
 * Built lazily in Port Hood via Kit + mergeKit (<= 4 merged meshes, matching maryville-store.ts).
 */
import * as THREE from 'three';
import { pushOut, type Pushable } from './parked';
import type { HandBuiltPlace } from './place';
import { canvas, Face, grey, Kit, mergeKit, seeded, v } from './site-kit';
import type { Terrain } from './terrain';
export { DepotSite } from './depot-site';
import { DEPOT_BOLLARDS, DEPOT_DOCK, DEPOT_FRAME, DEPOT_HALL, DEPOT_OFFICE, type DepotSite } from './depot-site';

type Tex = 'siding' | 'roof' | 'sign';

const WALL = 0x9aa09a;       // weathered industrial steel-sage
const OFFICE_WALL = 0xb5b3a6; // pale putty board siding on office wing
const ROOF = 0x3b4248;       // charcoal standing-seam roof
const OXBLOOD = 0x7c1d26;    // fascia & trim echoing the Boss car (boss-car.ts)
const CONCRETE = 0x7f8280;
const BAY_DOOR = 0xcfd2cc;
const GLASS = 0x455a61;
const TRIM = 0xe6e2d5;
const BOLLARD = 0xdba028;
const DARK = 0x2a2f33;
const TOTE = 0x496678;

const EAVE = 4.4;
const RISE = 1.9;
const OFFICE_EAVE = 3.2;
const OFFICE_RISE = 0.9;
const DOCK_H = 0.72;

function materials(just: boolean): Map<Tex | null, THREE.Material> {
  const siding = canvas(64, 128, g => {
    g.fillStyle = grey(0.92);
    g.fillRect(0, 0, 64, 128);
    for (let x = 0; x < 64; x += 16) {
      g.fillStyle = grey(0.68);
      g.fillRect(x, 0, 3, 128);
      g.fillStyle = grey(0.99);
      g.fillRect(x + 3, 0, 2, 128);
    }
  });
  const roof = canvas(64, 128, g => {
    g.fillStyle = grey(0.9);
    g.fillRect(0, 0, 64, 128);
    for (let x = 0; x < 64; x += 32) {
      g.fillStyle = grey(0.55);
      g.fillRect(x, 0, 2, 128);
      g.fillStyle = grey(0.98);
      g.fillRect(x + 2, 0, 2, 128);
    }
  });
  // Completely invented fascia sign: no real postal service names, no maple leaf, no postal horn or crown.
  const sign = canvas(1024, 160, g => {
    const r = seeded(73);
    g.fillStyle = '#2d3e47';
    g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#8b242e';
    g.fillRect(0, 0, 1024, 14);
    g.fillRect(0, 146, 1024, 14);
    g.strokeStyle = '#efe5ce';
    g.lineWidth = 3;
    g.strokeRect(14, 22, 996, 116);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(255,255,255,${0.02 + r() * 0.03})`;
      g.fillRect(r() * 1024, 22 + r() * 116, 16 + r() * 60, 2);
    }
    g.fillStyle = '#fff9ec';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 62px system-ui, -apple-system, sans-serif';
    g.fillText(just ? 'PORT HOOD DEPOT' : 'PORT HOOD MAIL DEPOT', 512, 66, 940);
    g.fillStyle = '#f0cc75';
    g.font = '700 28px ui-monospace, Menlo, monospace';
    g.fillText(just ? 'SERVICE BAY  ·  GARAGE' : 'SORTING BAY  ·  DISPATCH  ·  SUPERVISOR', 512, 118, 920);
  }, false);
  const lambert = (map: THREE.Texture | null = null, emissive = 0x000000) =>
    new THREE.MeshLambertMaterial({ vertexColors: true, map, emissive, emissiveMap: emissive ? map : null, side: THREE.DoubleSide });
  return new Map([
    [null, lambert()],
    ['siding', lambert(siding)],
    ['roof', lambert(roof)],
    ['sign', lambert(sign, 0x4a453c)],
  ]);
}

function windowBox(k: Kit<Tex>, face: Face, u: number, y: number, w: number, h: number): void {
  k.onWall(face, u, y, w + 0.16, h + 0.16, 0.02, 0.08, OXBLOOD);
  k.onWall(face, u, y, w, h, 0.10, 0.025, TRIM);
  k.onWall(face, u, y, w - 0.12, h - 0.12, 0.125, 0.014, GLASS);
  k.onWall(face, u, y, w - 0.12, 0.04, 0.14, 0.012, TRIM);
  k.onWall(face, u, y, 0.04, h - 0.12, 0.14, 0.012, TRIM);
}

function buildDepot(k: Kit<Tex>): void {
  k.at(DEPOT_FRAME, 0);
  const [back, front, north, south] = DEPOT_HALL;
  const f = new Face('x+', front);
  const b = new Face('x-', back);
  const n = new Face('z-', north);
  const s = new Face('z+', south);

  // Concrete foundation skirt + corrugated hall shell
  k.grounded(back, front, north, south, 0.42, CONCRETE);
  k.span(back, front, 0.42, EAVE, north, south, WALL, 'siding');
  k.roof({
    a0: north, a1: south, c: (back + front) / 2, w: (front - back) / 2,
    eave: EAVE, rise: RISE, over: 0.45, endOver: 0.35,
    alongX: false, color: ROOF, tex: 'roof', fascia: OXBLOOD, rake: true,
  });
  k.gable(n, (back + front) / 2, (front - back) / 2, EAVE, RISE, WALL, 'siding');
  k.gable(s, -(back + front) / 2, (front - back) / 2, EAVE, RISE, WALL, 'siding');
  for (const x of [back, front]) for (const z of [north, south]) {
    k.box(0.18, EAVE - 0.42, 0.18, x, (EAVE + 0.42) / 2, z, OXBLOOD);
  }

  // Painted fascia sign above the loading bay facing Highway 19 (bottom at y=3.20, clear above canopy at y=3.16)
  const signPlane = new THREE.PlaneGeometry(8.8, 1.08);
  k.add(signPlane, 0xffffff, 'sign', f.at(0.6, 3.79, 0.11));
  k.onWall(f, 0.6, 3.79, 8.98, 1.18, 0.02, 0.08, OXBLOOD);

  // Loading dock + covered bay canopy + roll-up bay door
  const [dx0, dx1, dz0, dz1] = DEPOT_DOCK;
  k.grounded(dx0, dx1, dz0, dz1, DOCK_H, CONCRETE);
  // Dark rubber dock bumpers on front edge
  for (const z of [dz0 + 0.65, (dz0 + dz1) / 2, dz1 - 0.65]) {
    k.box(0.16, 0.32, 0.48, dx1 + 0.07, DOCK_H - 0.18, z, DARK);
  }
  // Roll-up steel bay door (centred on dock at u = -(dz0+dz1)/2 = 1.7)
  const bayU = -(dz0 + dz1) / 2;
  k.onWall(f, bayU, DOCK_H + 1.18, 4.2, 2.38, 0.02, 0.09, OXBLOOD);
  k.onWall(f, bayU, DOCK_H + 1.16, 3.9, 2.26, 0.11, 0.05, BAY_DOOR);
  for (let row = 0; row < 5; row++) {
    k.onWall(f, bayU, DOCK_H + 0.32 + row * 0.42, 3.86, 0.03, 0.165, 0.015, 0x898d8a);
  }
  // Small glazed vision lites across upper bay panel
  for (const du of [-1.25, -0.42, 0.42, 1.25]) {
    k.onWall(f, bayU + du, DOCK_H + 1.88, 0.56, 0.28, 0.165, 0.015, GLASS);
  }
  // Sloped canopy roof over the loading dock, held by steel posts
  const cy0 = 3.16, cy1 = 2.86;
  k.facet([v(dx0, cy0, dz0 - 0.2), v(dx0, cy0, dz1 + 0.2), v(dx1 + 0.35, cy1, dz1 + 0.2), v(dx1 + 0.35, cy1, dz0 - 0.2)],
    ROOF, 'roof', v(0, 0, 1));
  k.box(0.14, 0.18, dz1 - dz0 + 0.44, dx1 + 0.35, cy1 - 0.06, (dz0 + dz1) / 2, OXBLOOD);
  for (const z of [dz0 + 0.18, dz1 - 0.18]) {
    k.span(dx1 - 0.14, dx1 + 0.04, DOCK_H, cy1 - 0.04, z - 0.09, z + 0.09, OXBLOOD);
  }
  // Mail totes waiting on the loading dock
  k.box(0.68, 0.38, 0.48, dx0 + 0.65, DOCK_H + 0.19, dz0 + 0.85, TOTE);
  k.box(0.68, 0.38, 0.48, dx0 + 0.65, DOCK_H + 0.57, dz0 + 0.88, 0x9b7249);
  k.box(0.68, 0.38, 0.48, dx0 + 0.72, DOCK_H + 0.19, dz0 + 1.48, TOTE);

  // Personnel / Boss office entrance beside the loading dock (front wall at z = 4.6 -> u = -4.6)
  const doorU = -4.6;
  k.onWall(f, doorU, 1.56, 1.26, 2.26, 0.02, 0.09, OXBLOOD);
  k.onWall(f, doorU, 1.54, 1.04, 2.12, 0.11, 0.05, TRIM);
  k.onWall(f, doorU, 2.02, 0.7, 0.76, 0.16, 0.018, GLASS);
  k.onWall(f, doorU + 0.38, 1.48, 0.06, 0.14, 0.16, 0.05, DARK);
  // Concrete landing + steps up to the entrance door
  k.grounded(front, front + 1.25, 3.6, 5.6, 0.44, CONCRETE);
  k.grounded(front + 1.25, front + 1.78, 3.8, 5.4, 0.22, CONCRETE);
  // Warm sconce lamp above the door
  k.onWall(f, doorU, 2.86, 0.28, 0.2, 0.05, 0.16, DARK);
  k.onWall(f, doorU, 2.82, 0.2, 0.12, 0.12, 0.1, 0xffe4a0);

  // Side windows on hall
  for (const u of [-2.2, 2.2]) windowBox(k, n, u, 2.35, 1.4, 1.1);
  for (const u of [-4.8, 0, 4.8]) windowBox(k, b, u, 2.35, 1.5, 1.1);

  // Supervisor's office wing (z+)
  const [ob, ofr, on, os] = DEPOT_OFFICE;
  const ofFront = new Face('x+', ofr);
  const ofSouth = new Face('z+', os);
  k.grounded(ob, ofr, on, os, 0.42, CONCRETE);
  k.span(ob, ofr, 0.42, OFFICE_EAVE, on, os, OFFICE_WALL, 'siding');
  k.roof({
    a0: ob, a1: ofr, c: (on + os) / 2, w: (os - on) / 2,
    eave: OFFICE_EAVE, rise: OFFICE_RISE, over: 0.32, endOver: 0.26,
    alongX: true, color: ROOF, tex: 'roof', fascia: OXBLOOD, rake: true,
  });
  k.gable(ofFront, -(on + os) / 2, (os - on) / 2, OFFICE_EAVE, OFFICE_RISE, OFFICE_WALL, 'siding');
  k.gable(new Face('x-', ob), (on + os) / 2, (os - on) / 2, OFFICE_EAVE, OFFICE_RISE, OFFICE_WALL, 'siding');
  windowBox(k, ofFront, -10.1, 1.75, 1.65, 1.15);
  windowBox(k, ofSouth, 0.2, 1.75, 1.55, 1.15);

  // Yellow safety bollards protecting the dock corners
  for (const [bx, bz] of DEPOT_BOLLARDS) {
    const gy = k.ground(bx, bz);
    k.cylinder(0.11, 0.11, 1.15, bx, gy - 0.1, bz, BOLLARD, 10);
    k.cylinder(0.115, 0.115, 0.12, bx, gy + 0.85, bz, DARK, 10);
  }
}

export class PortHoodDepot implements HandBuiltPlace {
  readonly group = new THREE.Group();
  private built = false;
  waiting = false;

  constructor(readonly site: DepotSite, private terrain: Terrain, private low: boolean, private just = false) {
    this.group.name = 'port-hood-depot';
  }

  update(view: THREE.Vector3): void {
    this.waiting = !this.built && Math.hypot(view.x - this.site.centre.x, view.z - this.site.centre.z) < 350;
    if (!this.waiting) return;
    if (this.site.probes.some(([x, z]) => this.terrain.levelAt(x, z) < (this.terrain.hasFinest(x, z) ? 8 : 7))) return;
    const g = this.terrain.meshHeightAt(this.site.centre.x, this.site.centre.z);
    if (g === null) return;
    const kit = new Kit<Tex>(this.low, this.site.village, (x, z) => this.terrain.meshHeightAt(x, z) ?? g);
    buildDepot(kit);
    const mats = materials(this.just);
    this.group.add(mergeKit(kit, 'port-hood-depot', tex => mats.get(tex)!));
    this.built = true;
    this.waiting = false;
  }

  resolveSolids(car: Pushable): void {
    if (Math.hypot(car.x - this.site.centre.x, car.z - this.site.centre.z) < 42) pushOut(car, this.site.solids);
  }
}
