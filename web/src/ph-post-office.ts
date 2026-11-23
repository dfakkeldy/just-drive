/**
 * Port Hawkesbury Post Office on Pitt Street (replacing baked building 149 and its wings 3081 and 3082).
 * Modelled by eye from public aerial imagery, public street-level photography and the provincial 1 m LiDAR DSM/DTM.
 * Generic "POST OFFICE" sign only: no Canada Post logo and no civic number.
 *
 * Builds lazily once the camera comes within 360 m and the finest land under the site is in memory, so distant
 * start views (such as pointtupper-start, 476 m away) pay zero draws, triangles or textures until the player drives
 * near Pitt Street.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addFlag } from './flags';
import { pushOut, type Pushable, type Solid } from './parked';
import { PH_POST_OFFICE, poToMap, postOfficeClear, postOfficeSolids } from './port-hawkesbury-mail';
import { Face, Kit as SiteKit, canvas, grey } from './site-kit';
import type { Terrain } from './terrain';

type Tex = 'brick' | 'glass';
type Kit = SiteKit<Tex>;

const C = {
  brick: 0xbf6348,
  brickTrim: 0x9c4c36,
  buffBrick: 0xd6cdbe,
  fasciaLight: 0xd2cdc3,
  fasciaBand: 0x9e9a92,
  fasciaDark: 0x5c5b58,
  roof: 0x4b4e50,
  frame: 0xe6e5df,
  darkFrame: 0x3b3835,
  glass: 0x26353e,
  spandrel: 0xcfd1ce,
  concrete: 0xbcb8af,
  asphalt: 0x565759,
  canopy: 0x423f3c,
  soffit: 0xd9d6ce,
  rail: 0x45494c,
  pole: 0xd0d3d6,
  postBoxRed: 0xb82924,
  postBoxBase: 0x484b4e,
  door: 0xe8e7e2,
  doorLine: 0xb5b8b8,
  louverLight: 0xd8d3c8,
  louverDark: 0x7b7870,
};

function makeTextures(): Record<Tex, THREE.CanvasTexture> {
  const brick = canvas(128, 64, g => {
    g.fillStyle = grey(0.86); g.fillRect(0, 0, 128, 64);
    for (let row = 0; row < 8; row++) {
      const y = row * 8, off = (row % 2) * 16;
      g.fillStyle = grey(0.74); g.fillRect(0, y, 128, 1);
      for (let x = -16; x < 128; x += 32) {
        const shade = 0.88 + (((row * 7 + x * 3) & 7) - 3) * 0.025;
        g.fillStyle = grey(shade); g.fillRect(x + off + 1, y + 1, 30, 7);
      }
    }
  });
  brick.repeat.set(1 / 1.4, 1 / 0.7);
  const glass = canvas(128, 128, g => {
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, grey(0.72)); grad.addColorStop(1, grey(0.42));
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    g.fillStyle = grey(0.96); g.fillRect(0, 0, 5, 128); g.fillRect(0, 0, 128, 5);
  });
  glass.repeat.set(1 / 1.4, 1 / 1.4);
  return { brick, glass };
}

function makeSignTexture(): THREE.CanvasTexture {
  return canvas(256, 96, g => {
    g.fillStyle = '#243a52';
    g.fillRect(0, 0, 256, 96);
    g.strokeStyle = '#ece9df';
    g.lineWidth = 6;
    g.strokeRect(5, 5, 246, 86);
    g.fillStyle = '#f4f2eb';
    g.font = 'bold 31px system-ui, -apple-system, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(PH_POST_OFFICE.signText, 128, 50);
  }, false);
}

class ApronDecals {
  private pos: number[] = [];
  private col: number[] = [];
  constructor(private village: readonly [number, number], private groundAt: (x: number, z: number) => number, private step = 2) {}
  rect(x0: number, x1: number, z0: number, z1: number, color: number, lift: number): void {
    const c = new THREE.Color(color);
    const nu = Math.max(1, Math.ceil((x1 - x0) / this.step)), nv = Math.max(1, Math.ceil((z1 - z0) / this.step));
    const grid: number[][][] = [];
    for (let i = 0; i <= nu; i++) {
      grid.push([]);
      for (let k = 0; k <= nv; k++) {
        const lx = x0 + ((x1 - x0) * i) / nu, lz = z0 + ((z1 - z0) * k) / nv;
        const [e, n] = poToMap(lx, lz), wx = e - this.village[0], wz = this.village[1] - n;
        grid[i].push([wx, this.groundAt(wx, wz) + lift, wz]);
      }
    }
    for (let i = 0; i < nu; i++) for (let k = 0; k < nv; k++) {
      const a = grid[i][k], b = grid[i + 1][k], d = grid[i + 1][k + 1], e = grid[i][k + 1];
      const up = (b[0] - a[0]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[0] - a[0]) < 0;
      for (const p of up ? [a, b, d, a, d, e] : [a, d, b, a, e, d]) { this.pos.push(p[0], p[1], p[2]); this.col.push(c.r, c.g, c.b); }
    }
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(this.pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function framedWindow(k: Kit, f: Face, u: number, y0: number, w: number, h: number, mullions = 1): void {
  k.onWall(f, u, y0 + h / 2, w + 0.16, h + 0.16, 0, 0.06, C.frame);
  k.onWall(f, u, y0 + h / 2, w, h, 0.06, 0.03, C.glass);
  for (let i = 1; i <= mullions; i++) {
    k.onWall(f, u - w / 2 + (w * i) / (mullions + 1), y0 + h / 2, 0.06, h, 0.09, 0.015, C.frame);
  }
}

function buildPostOfficeModel(k: Kit, decals: ApronDecals, village: readonly [number, number]): { signMatrix: THREE.Matrix4 } {
  const f = PH_POST_OFFICE.frame;
  k.at(f, 0.15);
  const brickTex: Tex | null = k.low ? null : 'brick';
  const glassTex: Tex | null = k.low ? null : 'glass';

  // ---- 1. Main two-storey front brick block (x: -10.98..10.97, z: -8.43..8.43, level roof at 6.5 m) ----
  const [mx0, mx1, mz0, mz1] = PH_POST_OFFICE.rects[0];
  const H = 6.5;
  k.grounded(mx0, mx1, mz0, mz1, H - 0.9, C.brick, brickTex);
  k.span(mx0 + 0.12, mx1 - 0.12, H - 0.05, H, mz0 + 0.12, mz1 - 0.12, C.roof);
  // Signature multi-band stepped warm-grey fascia / cornice around the flat roof (3 horizontal ribs).
  k.span(mx0 - 0.08, mx1 + 0.08, H - 0.95, H + 0.12, mz0 - 0.08, mz1 + 0.08, C.fasciaLight);
  for (const bandY of [H - 0.72, H - 0.42, H - 0.12]) {
    k.span(mx0 - 0.12, mx1 + 0.12, bandY, bandY + 0.08, mz0 - 0.12, mz1 + 0.12, C.fasciaBand);
  }
  k.span(mx0 - 0.14, mx1 + 0.14, H + 0.08, H + 0.18, mz0 - 0.14, mz1 + 0.14, C.fasciaDark);

  const front = new Face('z+', mz1);
  const swWall = new Face('x-', mx0);
  const neWall = new Face('x+', mx1);
  const back = new Face('z-', mz0);

  // SW front two-storey glazed lobby curtain wall (x: -10.4..-2.4, y: 0.1..5.45) with white mullions and lobby door.
  k.span(-10.45, -2.35, 0.1, 5.5, mz1 - 0.02, mz1 + 0.06, C.glass, glassTex);
  for (const u of [-10.45, -8.85, -7.25, -5.65, -4.05, -2.35]) {
    k.onWall(front, u, 2.8, 0.12, 5.4, 0.04, 0.06, C.frame);
  }
  for (const y of [0.14, 2.35, 2.85, 5.45]) {
    k.onWall(front, -6.4, y, 8.2, 0.12, 0.04, 0.06, C.frame);
  }
  k.onWall(front, -6.4, 2.6, 8.0, 0.44, 0.03, 0.04, C.spandrel);
  // Glazed lobby entrance door on the left side of the curtain wall + concrete landing and dark pipe handrails.
  k.onWall(front, -9.65, 1.18, 1.35, 2.25, 0.06, 0.05, C.frame);
  k.onWall(front, -9.65, 1.18, 1.15, 2.08, 0.09, 0.02, C.glass);
  k.grounded(-10.8, -2.2, mz1, mz1 + 2.0, 0.08, C.concrete);
  for (const x of [-10.6, -2.4]) k.box(0.06, 0.9, 0.06, x, 0.52, mz1 + 1.85, C.rail);
  k.box(8.3, 0.05, 0.05, -6.5, 0.95, mz1 + 1.85, C.rail);

  // SE front brick facade between the glazed lobby and the NE postal entrance (windows, grey concrete panel, lawn curb).
  for (const u of [-1.2, 1.6]) {
    k.onWall(front, u, 3.05, 1.15, 4.7, 0, 0.06, C.frame);
    k.onWall(front, u, 3.05, 0.96, 4.5, 0.05, 0.02, C.glass);
    k.onWall(front, u, 2.65, 1.0, 0.45, 0.06, 0.02, C.spandrel);
  }
  k.onWall(front, 5.5, 1.0, 4.4, 1.35, 0, 0.08, C.fasciaBand);
  for (const u of [4.2, 6.8, 9.2]) framedWindow(k, front, u, 2.35, 1.3, 1.35, 1);
  // Low concrete retaining curb along the front grass strip.
  k.grounded(-2.2, 10.2, mz1 + 1.6, mz1 + 2.0, 0.25, C.concrete);

  // SW side wall facing the paved parking lot: 4 vertical 2-storey window bays + narrow front-corner stairwell slot.
  // On Face('x-', mx0), u runs along +z from mz0 (-8.43) to mz1 (+8.43).
  k.onWall(swWall, 7.25, 2.95, 0.85, 4.85, 0, 0.06, C.frame);
  k.onWall(swWall, 7.25, 2.95, 0.68, 4.68, 0.05, 0.02, C.glass);
  for (const u of [-5.4, -2.0, 1.4, 4.8]) {
    k.onWall(swWall, u, 2.85, 1.75, 4.75, 0, 0.05, C.spandrel);
    framedWindow(k, swWall, u, 0.75, 1.55, 1.55, 1);
    framedWindow(k, swWall, u, 3.25, 1.55, 1.65, 1);
  }

  // NE side wall (visible coming downhill on Pitt St): red brick with narrow vertical windows and light sills.
  // On Face('x+', mx1), u runs along -z (so z = -u).
  for (const z of [-6.0, -3.2, -0.4, 2.2]) {
    framedWindow(k, neWall, -z, 1.55, 1.0, 2.45, 0);
  }

  // ---- 2. NE front customer entrance vestibule (pale buff brick, louvered parapet, canopy, sign, red letter box) ----
  const [vx0, vx1, vz0, vz1] = PH_POST_OFFICE.rects[1];
  const vH = 5.1;
  k.grounded(vx0 - 0.4, vx1, vz0, vz1, vH - 0.9, C.buffBrick, brickTex);
  k.span(vx0 - 0.4, vx1, vH - 0.9, vH, vz0, vz1, C.louverLight);
  for (let y = vH - 0.82; y < vH - 0.05; y += 0.22) {
    k.span(vx0 - 0.44, vx1 + 0.04, y, y + 0.07, vz0 - 0.04, vz1 + 0.04, C.louverDark);
  }
  k.span(vx0 - 0.35, vx1 - 0.05, vH, vH + 0.08, vz0 + 0.05, vz1 - 0.05, C.roof);

  // Projecting flat entrance canopy over customer door and letter box.
  const canY = 2.85;
  k.span(vx0 - 0.7, vx1 + 0.2, canY, canY + 0.24, vz1 - 0.05, vz1 + 1.35, C.canopy);
  k.span(vx0 - 0.65, vx1 + 0.15, canY - 0.03, canY, vz1, vz1 + 1.3, C.soffit);

  // Customer glass entrance door and adjacent glazed sidelight.
  const vFront = new Face('z+', vz1);
  k.onWall(vFront, 11.45, 1.25, 1.45, 2.35, 0, 0.06, C.darkFrame);
  k.onWall(vFront, 11.45, 1.25, 1.2, 2.15, 0.06, 0.02, C.glass);
  k.onWall(vFront, 10.45, 1.3, 0.85, 2.25, 0, 0.05, C.frame);
  k.onWall(vFront, 10.45, 1.3, 0.7, 2.05, 0.05, 0.02, C.glass);
  // Small high window on the NE corner of the vestibule.
  framedWindow(k, new Face('x+', vx1), -6.4, 2.0, 1.35, 1.5, 1);

  // Generic "POST OFFICE" signboard mounted clearly on the pale brick front wall above the entrance canopy.
  const signU = 12.15, signY = 3.55, signW = 2.45, signH = 0.72;
  k.onWall(vFront, signU, signY, signW + 0.1, signH + 0.1, 0, 0.06, C.darkFrame);
  // Compute world matrix for the textured "POST OFFICE" face just proud of its frame.
  const baseX = f.e - village[0], baseZ = village[1] - f.n;
  const frameMat = new THREE.Matrix4().compose(
    new THREE.Vector3(baseX, k.base, baseZ),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - (f.az * Math.PI) / 180),
    new THREE.Vector3(1, 1, 1),
  );
  const signMatrix = frameMat.clone().multiply(vFront.at(signU, signY, 0.07));

  // Red street letter box standing beside the entrance door (generic shape, no Canada Post logo).
  const [lx, lz] = PH_POST_OFFICE.letterBox;
  const lg = k.ground(lx, lz);
  k.span(lx - 0.24, lx + 0.24, lg - 0.05, lg + 0.42, lz - 0.24, lz + 0.24, C.postBoxBase);
  k.span(lx - 0.26, lx + 0.26, lg + 0.42, lg + 1.24, lz - 0.26, lz + 0.26, C.postBoxRed);
  k.span(lx - 0.28, lx + 0.28, lg + 1.24, lg + 1.34, lz - 0.28, lz + 0.3, C.postBoxRed);
  k.span(lx - 0.16, lx + 0.16, lg + 1.0, lg + 1.08, lz + 0.26, lz + 0.31, C.darkFrame);

  // Flagpole with Canadian flag out front of the SW glazed lobby (matching public street view).
  const [fx, fz] = PH_POST_OFFICE.flagpole;
  const fg = k.ground(fx, fz);
  k.cylinder(0.24, 0.22, 0.55, fx, fg - 0.1, fz, C.concrete, 8);
  k.cylinder(0.065, 0.04, 7.6, fx, fg + 0.45, fz, C.pole, 8);
  k.add(new THREE.SphereGeometry(0.08, 8, 6), C.pole, null, k.matrix(fx, fg + 8.1, fz));
  addFlag(k, 'canada', fx, fg + 7.25, fz + 0.07, 0.9);

  // ---- 3. Rear L-shaped sorting & loading wings (replacing wings 3081 and 3082) ----
  const [rx0, rx1, rz0, rz1] = PH_POST_OFFICE.rects[2];
  const rH = 6.1;
  k.grounded(rx0, rx1, rz0, rz1, rH - 0.45, C.brick, brickTex);
  k.span(rx0 - 0.06, rx1 + 0.06, rH - 0.45, rH + 0.08, rz0 - 0.06, rz1 + 0.06, C.fasciaDark);
  k.span(rx0 + 0.1, rx1 - 0.1, rH, rH + 0.04, rz0 + 0.1, rz1 - 0.1, C.roof);

  // Rear loading bay on the SW side of wing 3081 (facing the paved yard where mail vans load).
  const dockWall = new Face('x-', rx0);
  // Overhead sectional loading door + concrete dock platform + metal canopy.
  k.onWall(dockWall, -13.6, 2.35, 3.4, 3.1, 0, 0.06, C.frame);
  k.onWall(dockWall, -13.6, 2.35, 3.2, 2.95, 0.06, 0.03, C.door);
  if (!k.low) for (let y = 1.5; y < 3.6; y += 0.72) k.onWall(dockWall, -13.6, y, 3.1, 0.04, 0.09, 0.01, C.doorLine);
  k.grounded(rx0 - 1.8, rx0, -16.2, -10.6, 0.85, C.concrete);
  k.span(rx0 - 2.2, rx0, 4.05, 4.28, -16.4, -10.4, C.canopy);
  // Staff door and high sorting-room windows on the rear wing.
  k.onWall(dockWall, -18.5, 1.1, 1.1, 2.2, 0, 0.05, C.darkFrame);
  k.onWall(dockWall, -18.5, 1.1, 0.92, 2.08, 0.05, 0.02, C.door);
  for (const z of [-21.5, -23.5]) framedWindow(k, dockWall, z, 2.7, 1.3, 1.0, 1);
  // Back wall of main block facing the loading yard.
  for (const u of [2.0, 6.0, 9.0]) framedWindow(k, back, u, 2.6, 1.4, 1.1, 1);

  // Rear-NE wing (3082).
  const [ex0, ex1, ez0, ez1] = PH_POST_OFFICE.rects[3];
  const eH = 5.6;
  k.grounded(ex0, ex1, ez0, ez1, eH - 0.4, C.brick, brickTex);
  k.span(ex0 - 0.06, ex1 + 0.06, eH - 0.4, eH + 0.06, ez0 - 0.06, ez1 + 0.06, C.fasciaDark);
  k.span(ex0 + 0.08, ex1 - 0.08, eH, eH + 0.04, ez0 + 0.08, ez1 - 0.08, C.roof);
  for (const z of [-13.5, -10.5]) framedWindow(k, new Face('x+', ex1), -z, 2.2, 1.1, 1.2, 0);

  // ---- 4. Customer entrance walkway & SW paved parking / loading apron ----
  const [walk, drive, yard] = PH_POST_OFFICE.pads;
  decals.rect(walk[0], walk[1], walk[2], walk[3], C.concrete, 0.05);
  decals.rect(drive[0], drive[1], drive[2], drive[3], C.asphalt, 0.07);
  decals.rect(yard[0], yard[1], yard[2], yard[3], C.asphalt, 0.07);

  return { signMatrix };
}

export class PortHawkesburyPostOffice {
  readonly group = new THREE.Group();
  readonly solids: Solid[];
  readonly clear: [number, number, number, number][];
  readonly centre: { x: number; z: number };
  built = false;
  triangles = 0;
  private nextCheck = 0;
  private readonly probes: { x: number; z: number }[];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly village: readonly [number, number], private readonly terrain: Terrain, private readonly low: boolean) {
    this.group.name = 'port-hawkesbury-post-office';
    this.solids = postOfficeSolids(village);
    this.clear = postOfficeClear(village);
    const f = PH_POST_OFFICE.frame;
    this.centre = { x: f.e - village[0], z: village[1] - f.n };
    this.probes = [
      this.centre,
      ...PH_POST_OFFICE.rects.flatMap(([x0, x1, z0, z1]) => [[x0, z0], [x1, z1]].map(([x, z]) => {
        const [e, n] = poToMap(x, z); return { x: e - village[0], z: village[1] - n };
      })),
    ];
  }

  resolveSolids(car: Pushable): void {
    if (Math.hypot(car.x - this.centre.x, car.z - this.centre.z) < 60) pushOut(car, this.solids);
  }

  update(view: { x: number; z: number }, now: number): void {
    if (this.built || now < this.nextCheck) return;
    this.nextCheck = now + 200;
    // Lazy proximity threshold (360 m): distant pointtupper-start (476 m away) pays zero GPU cost.
    if (Math.hypot(view.x - this.centre.x, view.z - this.centre.z) > 360) return;
    if (this.probes.some(p => this.terrain.levelAt(p.x, p.z) < 8)) return;
    const fallback = this.terrain.constructionHeightAt(this.centre.x, this.centre.z);
    if (fallback === null) return;
    const groundAt = (x: number, z: number) => this.terrain.constructionHeightAt(x, z) ?? fallback;
    const kit: Kit = new SiteKit(this.low, this.village, groundAt);
    const decals = new ApronDecals(this.village, groundAt, this.low ? 3 : 2);
    const { signMatrix } = buildPostOfficeModel(kit, decals, this.village);

    const textures = this.low ? null : makeTextures();
    if (textures) this.disposables.push(textures.brick, textures.glass);
    for (const [tex, parts] of kit.parts) {
      if (!parts.length) continue;
      const geometry = mergeGeometries(parts);
      if (!geometry) throw new Error('ph-post-office: geometry could not be merged');
      for (const p of parts) p.dispose();
      geometry.computeBoundingSphere();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: tex && textures ? textures[tex] : null });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = `ph-post-office-${tex ?? 'paint'}`;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(geometry, mat);
      this.triangles += geometry.attributes.position.count / 3;
    }

    const decalGeo = decals.geometry();
    if (decalGeo) {
      decalGeo.computeBoundingSphere();
      const decalMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      const decalMesh = new THREE.Mesh(decalGeo, decalMat);
      decalMesh.name = 'ph-post-office-apron';
      decalMesh.receiveShadow = true;
      this.group.add(decalMesh);
      this.disposables.push(decalGeo, decalMat);
      this.triangles += decalGeo.attributes.position.count / 3;
    }

    // Generic "POST OFFICE" signboard (no Canada Post logo).
    const signTex = makeSignTexture();
    const signGeo = new THREE.PlaneGeometry(2.45, 0.72);
    signGeo.applyMatrix4(signMatrix);
    signGeo.computeBoundingSphere();
    const signMat = new THREE.MeshLambertMaterial({ map: signTex });
    const signMesh = new THREE.Mesh(signGeo, signMat);
    signMesh.name = 'ph-post-office-sign';
    this.group.add(signMesh);
    this.disposables.push(signTex, signGeo, signMat);
    this.triangles += 2;

    this.built = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
