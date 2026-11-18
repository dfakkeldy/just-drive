import * as THREE from 'three';
import { loadHighlandBull } from './highland-model';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Evidence, Subject } from './evidence';
import { buildingSites, type Building } from './buildings';
import type { Road, RoadHit, Roads } from './roads';
import { readFile } from './store';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';

// Approved position 1.5 m beyond the rail, opposite the surveyed car stop; one location.
export const HIGHLAND_BULL_POSITION = { east: 618978.71064, north: 5109258.94483 } as const;
export const HIGHLAND_BULL_ENABLED = true;

type Kind = 'cat' | 'pom' | 'retriever' | 'bernese' | 'roofcat' | 'guardian' | 'cow' | 'bull' | 'farm';
type Stock = 'cow' | 'highland' | 'horse' | 'sheep' | 'lamb';
type Point = { x: number; z: number };
type Place = Point & { name: string; road: string | null };
type State = 'home' | 'rise' | 'yield' | 'shoulder' | 'approach' | 'visit' | 'chase' | 'return' | 'guard' | 'watch';
export interface Rig {
  torso: THREE.Mesh; shoulder: number; root: THREE.Group; body: THREE.Group; head: THREE.Group; tail: THREE.Group;
  hoofSoles?: readonly THREE.Vector3[]; legRestY?: readonly number[];
  neck: THREE.Group | null; legs: THREE.Group[]; ears: THREE.Group[]; eyes: THREE.Mesh[]; jaw: THREE.Mesh | null;
}
interface Grazier { kind: Stock; rig: Rig; home: Point; phase: number; }
interface Resident {
  decor: THREE.Group | null; herd: Grazier[]; fieldReady: boolean; buildAfter: number; lastActiveAt: number; side: number; direction: number;
  kind: Kind; place: Place; home: Point; spot: RoadHit; along: number; roof: number;
  rig: Rig | null; state: State; timer: number; away: number; met: boolean;
  honks: number; travel: number; pause: number; moving: boolean; sit: number; down: number;
  homeHeading?: number;
}
const clamp = THREE.MathUtils.clamp;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const angle = (a: Point, b: Point) => Math.atan2(b.x - a.x, -(b.z - a.z));
const length = (r: Road) => r.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0);
function roadPoint(road: Road, along: number): RoadHit {
  let left = clamp(along, 0, length(road));
  for (let i = 0; i < road.pts.length - 1; i++) {
    const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (left <= len || i === road.pts.length - 2) {
      const t = len ? left / len : 0;
      return { road, x: ax + (bx - ax) * t, z: az + (bz - az) * t, heading: Math.atan2(bx - ax, -(bz - az)), seg: i, t, dist: 0 };
    }
    left -= len;
  }
  throw new Error('An animal needs a road with two points');
}
function alongRoad(p: RoadHit): number {
  let n = 0;
  for (let i = 0; i < p.seg; i++) n += Math.hypot(p.road.pts[i + 1][0] - p.road.pts[i][0], p.road.pts[i + 1][1] - p.road.pts[i][1]);
  return n + Math.hypot(p.x - p.road.pts[p.seg][0], p.z - p.road.pts[p.seg][1]);
}

const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
// One colour per face, with fixed variations. All meshes share one Lambert material.
function painted(geometry: THREE.BufferGeometry, colour: number): THREE.Mesh {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new THREE.Color(colour), colours: number[] = [];
  for (let i = 0; i < g.getAttribute('position').count; i++) {
    const shade = 0.92 + (Math.floor(i / 3) % 5) * 0.025;
    colours.push(c.r * shade, c.g * shade, c.b * shade);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  return new THREE.Mesh(g, material);
}
function ellipsoid(parent: THREE.Group, colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, detail = false): THREE.Mesh {
  const m = painted(new THREE.IcosahedronGeometry(1, detail ? 1 : 0), colour);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m;
}
function box(parent: THREE.Group, colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
  const m = painted(new THREE.BoxGeometry(sx, sy, sz), colour); m.position.set(x, y, z); parent.add(m); return m;
}
function tuft(parent: THREE.Group, colour: number, x: number, y: number, z: number, width: number, height: number): THREE.Mesh {
  const m = painted(new THREE.ConeGeometry(width, height, 3), colour);
  m.position.set(x, y, z); m.rotation.z = Math.PI; parent.add(m); return m;
}

// Merge rigid parts once. Animation pivots and the few mutable meshes remain separate.
function compact(rig: Rig): Rig {
  const keep = new Set<THREE.Object3D>([rig.torso, ...rig.eyes]); if (rig.jaw) keep.add(rig.jaw);
  for (const parent of [rig.body, rig.head, rig.tail, ...rig.legs, ...rig.ears, ...(rig.neck ? [rig.neck] : [])]) {
    const meshes = parent.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.visible && !keep.has(o));
    if (meshes.length < 2) continue;
    const pieces = meshes.map(m => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
    const geometry = mergeGeometries(pieces);
    for (const g of pieces) g.dispose();
    if (!geometry) throw new Error('Animal parts must share vertex attributes');
    for (const mesh of meshes) { parent.remove(mesh); mesh.geometry.dispose(); }
    parent.add(new THREE.Mesh(geometry, material));
  }
  return rig;
}

/** Local forward is -Z. Dimensions are metres, including the fur. No textures or skeletons. */
function model(kind: Kind): Rig {
  const cat = kind === 'cat' || kind === 'roofcat', pom = kind === 'pom', golden = kind === 'retriever';
  const guardian = kind === 'guardian', bernese = kind === 'bernese';
  const h = cat ? 0.25 : pom ? 0.2 : golden ? 0.58 : guardian ? 0.75 : 0.65;
  const size = cat ? 0.46 : pom ? 0.32 : golden ? 0.92 : guardian ? 1.16 : 1.05;
  const coat = cat ? 0x89867f : pom ? 0xb76527 : golden ? 0xb77936 : guardian ? 0xe8e2ce : 0x202322;
  const cream = cat ? 0xe2e1d8 : pom ? 0xe3bb7b : golden ? 0xd8ba84 : 0xf3eee0;
  const dark = 0x252324, brown = 0xa15a2b;
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group(), tail = new THREE.Group();
  root.rotation.order = 'YXZ'; root.add(body); body.add(head, tail);
  const legs: THREE.Group[] = [], ears: THREE.Group[] = [], eyes: THREE.Mesh[] = [];
  let jaw: THREE.Mesh | null = null;
  const torso = ellipsoid(body, coat, 0, h * 0.79, 0.03, h * 0.43, h * (guardian || bernese ? .28 : .36), size * 0.48, true);
  ellipsoid(body, cream, 0, h * 0.82, -size * 0.27, h * 0.39, h * 0.43, size * 0.19);
  if (pom) {
    ellipsoid(body, coat, 0, h * .95, -size * .18, h * .66, h * .54, size * .34, true);
    ellipsoid(body, cream, -.045, h * 1.24, size * .34, .06, .055, .09);
    ellipsoid(body, cream, -.07, h * 1.36, size * .2, .05, .045, .07);
  }
  if (guardian) {
    ellipsoid(body, cream, 0, h * .98, -size * .27, h * .49, h * .51, size * .28);
    ellipsoid(body, dark, 0, h * 1.15, -size * .36, h * .30, .055, .13);
  }
  for (const rear of [false, true]) for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * h * 0.27, h * 0.65, (rear ? 0.31 : -0.3) * size); body.add(leg);
    ellipsoid(leg, bernese ? brown : coat, 0, -h * 0.24, 0, h * 0.115, h * 0.3, h * 0.13);
    ellipsoid(leg, cat || kind === 'bernese' ? cream : coat, 0, -h * 0.56, -0.025, h * 0.15, h * 0.09, h * 0.2);
    legs.push(leg);
  }
  head.position.set(0, h * 1.13, -size * 0.36);
  const hw = h * (cat ? 0.36 : pom ? 0.54 : guardian ? .31 : .29);
  ellipsoid(head, coat, 0, 0, 0, hw, hw * 0.93, hw * 0.87, true);
  if (cat) {
    // Wide white cheeks and a white blaze make the low, dark lids read as a glare.
    ellipsoid(head, cream, 0, -hw * 0.38, -hw * 0.65, hw * 0.83, hw * 0.46, hw * 0.4);
    box(head, cream, 0, hw * 0.05, -hw * 0.8, hw * 0.3, hw * 1.0, 0.012);
    for (const s of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(s * hw * 0.7, hw * 0.65, 0); head.add(ear);
      const e = tuft(ear, coat, 0, hw * 0.32, 0, hw * 0.42, hw * 0.75); e.rotation.z = s * -0.18;
      const inner = tuft(ear, 0x987b79, 0, hw * 0.32, -0.012, hw * 0.23, hw * 0.46); inner.rotation.z = s * -0.18;
      ears.push(ear);
      const eye = box(head, 0xc7c780, s * hw * 0.44, hw * 0.06, -hw * 0.86, hw * 0.44, hw * 0.15, 0.015); eyes.push(eye);
      box(head, dark, s * hw * 0.44, hw * 0.06, -hw * 0.96, hw * 0.065, hw * 0.14, 0.006);
      const brow = box(head, 0x393838, s * hw * 0.43, hw * 0.21, -hw * 0.89, hw * 0.61, hw * 0.13, 0.015); brow.rotation.z = s * 0.18;
      // Whiskers are tiny solid wedges, not screen-sized lines.
      for (let i = 0; i < 2; i++) {
        const w = box(head, 0xaaa89e, s * hw * 0.96, -hw * (0.24 + i * 0.17), -hw * 0.88, hw * 0.65, 0.003, 0.003); w.rotation.z = s * (i ? -0.1 : 0.14);
      }
    }
    ellipsoid(head, 0x564748, 0, -hw * 0.24, -hw, 0.016, 0.01, 0.01);
    for (let i = 0; i < 18; i++) {
      const t = i * 2.39996;
      tuft(body, i % 3 ? 0x68665f : coat, Math.cos(t) * h * 0.37, h * (0.65 + (i % 3) * 0.11), Math.sin(t) * size * 0.37, 0.025, 0.10 + (i % 4) * 0.014);
    }
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) tuft(head, cream, s * hw * (0.62 + i * 0.12), -hw * 0.55, 0, 0.025, 0.08);
    for (let i = 0; i < 7; i++) tuft(body, cream, (i % 3 - 1) * 0.025, h * .82, -size * .39, .018, .065 + i % 2 * .025);
    for (let i = 0; i < 5; i++) {
      const stripe = ellipsoid(body, 0x514f49, 0, h * 1.05, size * (.3 - i * .12), h * .36, .018, .018);
      stripe.rotation.z = (i % 2 ? 1 : -1) * .12;
    }
  } else {
    ellipsoid(head, golden ? cream : pom ? 0xe0c48e : cream, 0, -hw * 0.24, -hw * 0.8, hw * 0.65, hw * 0.44, hw * (pom ? 0.6 : 1.0));
    ellipsoid(head, dark, 0, -hw * 0.16, -hw * (pom ? 1.3 : 1.7), hw * 0.28, hw * 0.2, hw * 0.18);
    if (kind === 'bernese') {
      for (const s of [-1, 1]) {
        ellipsoid(head, dark, s * hw * 0.55, hw * 0.1, -hw * 0.52, hw * 0.5, hw * 0.66, hw * 0.43);
        ellipsoid(head, brown, s * hw * 0.5, hw * 0.31, -hw * 0.82, hw * 0.22, hw * 0.13, hw * 0.12);
        ellipsoid(head, brown, s * hw * .77, -hw * .24, -hw * .51, hw * .37, hw * .44, hw * .29);
      }
      box(head, cream, 0, hw * 0.1, -hw * 0.88, hw * 0.35, hw * 1.2, 0.02);
    }
    for (const s of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(s * hw * 0.9, hw * 0.3, 0); head.add(ear);
      if (pom) { const e = tuft(ear, coat, 0, hw * 0.48, 0, hw * 0.45, hw); e.rotation.z = s * -0.12; }
      else ellipsoid(ear, golden ? 0x9a602d : guardian ? 0xd7d0ba : dark, 0, -hw * 0.7, 0.02, hw * 0.43, hw * (guardian ? .65 : 1.1), hw * 0.4);
      ears.push(ear);
      eyes.push(ellipsoid(head, 0x181b19, s * hw * 0.48, hw * 0.16, -hw * 0.85, hw * 0.13, hw * 0.15, hw * 0.09));
      if (golden) ellipsoid(head, cream, s * hw * 0.5, hw * 0.37, -hw * 0.71, hw * 0.33, hw * 0.15, hw * 0.12);
    }
    if (kind === 'bernese') jaw = box(head, dark, 0, -hw * .53, -hw * 1.02, hw * .8, hw * .15, hw * .9);
    if (pom || kind === 'bernese') box(head, 0xd98688, 0, -hw * 0.64, -hw * 1.01, hw * 0.3, hw * 0.35, hw * 0.1);
    const n = pom ? 13 : 8;
    for (let i = 0; i < n; i++) {
      const t = i * 2.39996;
      tuft(body, i % 3 ? coat : cream, Math.cos(t) * h * 0.38, h * 0.84, -size * 0.23 + Math.sin(t) * h * 0.21, h * 0.12, h * (pom ? 0.58 : 0.32));
    }
  }
  tail.position.set(0, h * 0.87, size * 0.45);
  const tailMesh = ellipsoid(tail, pom ? cream : coat, 0, pom ? h * 0.45 : 0, size * 0.2, h * (pom ? 0.29 : 0.16), h * (pom ? 0.26 : 0.16), size * 0.27);
  tailMesh.rotation.x = pom ? -1 : cat ? 0.4 : -0.2;
  if (bernese) { tailMesh.scale.x *= 1.7; tailMesh.scale.y *= 1.7; ellipsoid(tail, cream, 0, .04, size * .39, .07, .07, .12); }
  if (guardian) {
    tailMesh.visible = false;
    for (let i = 0; i < 4; i++) { const t = i * .65; ellipsoid(tail, cream, 0, .12 + Math.sin(t) * .23, .10 + Math.cos(t) * .16, .11, .12, .15); }
  }
  root.name = kind;
  return compact({ torso, shoulder: h, root, body, head, tail, neck: null, legs, ears, eyes, jaw });
}

/** Grazers use the same part rig, with species-specific proportions. Cloned sheep share geometry. */
function stockModel(kind: Stock, black = false, bull = false): Rig {
  const sheep = kind === 'sheep' || kind === 'lamb', horse = kind === 'horse', highland = kind === 'highland';
  const h = kind === 'lamb' ? .4 : sheep ? .7 : horse ? 1.55 : highland ? bull ? 1.35 : 1.2 : 1.4;
  const len = sheep ? h * 1.45 : horse ? 2.05 : 2.3;
  const coat = sheep ? black ? 0x302e2b : 0xe9e4d1 : horse ? 0x955d3a : highland ? bull ? 0x93451f : 0xa65a2b : 0xe3d1ae;
  const dark = horse ? 0x24211f : sheep && !black ? 0xb6ad96 : 0x4e4438;
  const root = new THREE.Group(), body = new THREE.Group(), head = new THREE.Group(), tail = new THREE.Group();
  root.rotation.order = 'YXZ'; root.add(body); body.add(tail);
  const neck = horse ? new THREE.Group() : null;
  if (neck) { neck.position.set(0, h * .8, -len * .30); body.add(neck); neck.add(head); } else body.add(head);
  const torso = ellipsoid(body, coat, 0, h * .76, 0, h * (sheep ? .34 : bull ? .37 : .30), h * .29, len * .48, !sheep);
  const legs: THREE.Group[] = [], ears: THREE.Group[] = [], eyes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Group(); leg.position.set((i % 2 ? 1 : -1) * h * .21, h * .63, (i < 2 ? -1 : 1) * len * .32); body.add(leg);
    if (sheep) box(leg, dark, 0, -h * .315, 0, h * .09, h * .63, h * .10);
    else {
      box(leg, coat, 0, -h * .29, 0, h * .11, h * .60, h * .13);
      box(leg, dark, 0, -h * .60, -.015, h * .13, h * .07, h * .18);
    }
    legs.push(leg);
  }
  // Horse neck rises out of the shoulder. Cattle have a shorter, broad neck.
  if (!sheep) {
    const muscle = ellipsoid(neck ?? body, coat, 0, h * (horse ? .25 : .81), -len * (horse ? .04 : .34), h * .20, h * (horse ? .43 : .25), h * .23);
    muscle.rotation.x = horse ? -.38 : -.15;
  }
  head.position.set(0, h * (horse ? .56 : sheep ? .92 : 1.02), -len * (horse ? .18 : .48));
  ellipsoid(head, coat, 0, -.06 * h, -.08 * h, h * .20, h * .24, h * .21, !sheep);
  ellipsoid(head, horse ? coat : sheep ? dark : 0xb4a58a, 0, -h * .22, -h * .24, h * .18, h * .14, h * .18);
  const jaw = sheep ? null : ellipsoid(head, coat, 0, -h * .28, -h * .19, h * .15, h * .07, h * .16);
  for (const side of [-1, 1]) {
    const ear = new THREE.Group(); head.add(ear); ear.position.set(side * h * .21, h * .12, 0);
    const e = ellipsoid(ear, coat, side * h * .08, horse ? h * .12 : 0, 0, h * (horse ? .055 : .14), h * (horse ? .18 : .065), h * .07);
    e.rotation.z = -side * .3; ears.push(ear);
    eyes.push(sheep ? box(head, 0x242621, side * h * .175, h * .01, -h * .16, h * .035, h * .035, h * .025) : ellipsoid(head, 0x242621, side * h * .175, h * .01, -h * .16, h * .026, h * .031, h * .025));
    if (bull) {
      // Connected taper: broad outward sweep, then an upward tip. All parts turn with the head.
      const points = [[.18, .12, 0], [.40, .12, -.015], [.64, .18, .01], [.82, .34, .04], [.88, .56, .03]];
      for (let j = 1; j < points.length; j++) {
        const a = new THREE.Vector3(side * points[j - 1][0], points[j - 1][1], points[j - 1][2]).multiplyScalar(h);
        const b = new THREE.Vector3(side * points[j][0], points[j][1], points[j][2]).multiplyScalar(h);
        const delta = b.clone().sub(a), horn = painted(new THREE.CylinderGeometry(j === 4 ? .003 : .058 - j * .012, .07 - j * .012, delta.length() + .012, 7), j === 4 ? 0x766b53 : 0xd7ccac);
        horn.position.copy(a).add(b).multiplyScalar(.5); horn.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); head.add(horn);
      }
    } else if (!horse && !sheep) {
      // Two tapered segments give the Highland horns a long outward sweep and raised tips.
      for (let j = 0; j < 2; j++) {
        const horn = painted(new THREE.ConeGeometry(h * (j ? .022 : .04), h * (highland ? j ? .28 : .47 : j ? .10 : .12), 5), 0xdcd4bb);
        horn.position.set(side * h * (highland ? j ? .59 : .38 : j ? .25 : .20), h * (highland ? j ? .26 : .18 : j ? .19 : .15), 0);
        horn.rotation.z = -side * (j ? .55 : 1.3); head.add(horn);
      }
    }
  }
  if (!horse && !sheep) {
    if (!bull) ellipsoid(body, 0xc5a694, 0, h * .43, len * .19, h * .15, h * .12, h * .19);
    for (const side of [-1, 1]) ellipsoid(head, 0x645c4c, side * h * .105, -h * .20, -h * .395, h * .024, h * .016, h * .012);
  }
  if (horse) {
    for (let i = 0; i < 7; i++) box(neck ?? body, dark, 0, h * (.53 - i * .065), i * .022, .09, .19, .12);
    box(head, 0xd8ccaf, 0, -h * .10, -h * .27, .065, .28, .025);
  }
  if (sheep) for (let i = 0; i < (kind === 'lamb' ? 1 : 3); i++) {
    ellipsoid(body, coat, (i % 2 ? -1 : 1) * h * .12, h * .78, (i - 1) * len * .23, h * .29, h * .30, len * .23);
  }
  if (highland) {
    for (let i = 0; i < (bull ? 40 : 14); i++) {
      const t = i * 2.39996; tuft(body, bull && i % 4 === 0 ? 0xb25c2d : coat, Math.cos(t) * h * (bull ? .34 : .27), h * (bull ? .61 + (i % 3) * .07 : .66), Math.sin(t) * len * .42, bull ? .09 : .07, bull ? .44 : .36);
    }
    for (let i = 0; i < 5; i++) tuft(head, 0xb46b35, (i - 2) * .07, .06, -.15, .07, .28);
  }
  tail.position.set(0, h * .87, len * .44);
  const t = ellipsoid(tail, horse ? dark : coat, 0, -h * .22, .10, h * .055, h * (sheep ? .12 : .31), h * .06);
  t.rotation.x = -.28;
  if (!horse && !sheep) ellipsoid(tail, dark, 0, -h * .5, .19, .06, .12, .06);
  root.name = kind;
  return compact({ root, body, head, tail, neck, torso, shoulder: h, legs, ears, eyes, jaw });
}

/** Replace only this factory for a GLB. Head/tail/leg pivots and metre-scale shoulder
 * are the behaviour contract. Supply four leg-local hoofSoles and legRestY values;
 * shoulder is world metres, root forward is -Z. Tracking/honking/support stay in Animals. */
export function createHighlandBull(_low = false): Rig {
  const rig = stockModel('highland', false, true);
  rig.hoofSoles = rig.legs.map(() => new THREE.Vector3(0, -rig.shoulder * .635, 0));
  rig.legRestY = rig.legs.map(leg => leg.position.y);
  rig.root.scale.set(.8,.8,.85); rig.shoulder *= .8; // measured size only; look remains replaceable
  return rig;
}

/** The road cow uses the ordinary stock rig, including its behaviour pivots. */
export function createRoadCow(): Rig { return stockModel('cow'); }

/** A static pose of the same cattle used by the roaming herd, for small merged roadside scenes. */
export function stockGeometry(kind: 'cow' | 'highland', grazing = false): THREE.BufferGeometry {
  const rig = stockModel(kind);
  if (grazing) { rig.head.position.y *= .55; rig.head.rotation.x = -.6; }
  rig.root.updateMatrixWorld(true);
  const pieces: THREE.BufferGeometry[] = [];
  rig.root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    geometry.deleteAttribute('uv'); pieces.push(geometry);
    node.geometry.dispose();
  });
  const result = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  if (!result) throw new Error('Static cattle parts must share vertex attributes');
  return result;
}

function cloneStock(source: Rig): Rig {
  const root = source.root.clone(true);
  const part = (object: THREE.Object3D): THREE.Object3D => {
    const route: number[] = []; let node = object;
    while (node.parent && node !== source.root) { route.push(node.parent.children.indexOf(node)); node = node.parent; }
    let copy: THREE.Object3D = root; for (let i = route.length - 1; i >= 0; i--) copy = copy.children[route[i]];
    return copy;
  };
  const group = (g: THREE.Group): THREE.Group => { const copy = part(g); if (!(copy instanceof THREE.Group)) throw new Error('Invalid animal group'); return copy; };
  const mesh = (m: THREE.Mesh): THREE.Mesh => { const copy = part(m); if (!(copy instanceof THREE.Mesh)) throw new Error('Invalid animal mesh'); return copy; };
  return { root, shoulder: source.shoulder, body: group(source.body), head: group(source.head), tail: group(source.tail), torso: mesh(source.torso),
    neck: source.neck ? group(source.neck) : null, legs: source.legs.map(group), ears: source.ears.map(group), eyes: source.eyes.map(mesh), jaw: source.jaw ? mesh(source.jaw) : null };
}

function pantherSign(): THREE.Group {
  const group = new THREE.Group();
  box(group, 0x68645a, 0, 1.18, 0, .10, 2.6, .10);
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 640;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#f4c630'; c.fillRect(0, 0, 1024, 640);
  c.strokeStyle = '#171c17'; c.lineWidth = 16; c.strokeRect(14, 14, 996, 612);
  c.fillStyle = '#111a15';
  // A long, low feline with a small round head, pointed ears, bent paws and a curled tail.
  c.beginPath(); c.moveTo(293, 273); c.bezierCurveTo(344, 184, 425, 198, 500, 220); c.bezierCurveTo(599, 204, 676, 174, 728, 231); c.lineTo(718, 282); c.bezierCurveTo(617, 317, 439, 292, 349, 306); c.closePath(); c.fill();
  c.beginPath(); c.ellipse(390, 258, 67, 67, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(292, 267, 56, 47, -.2, 0, Math.PI * 2); c.fill(); c.fillRect(224, 268, 53, 28);
  for (const x of [269, 311]) { c.beginPath(); c.ellipse(x, 226, 17, 18, 0, 0, Math.PI * 2); c.fill(); }
  c.beginPath(); c.moveTo(352, 276); c.lineTo(300, 336); c.lineTo(231, 344); c.lineTo(230, 359); c.lineTo(327, 359); c.lineTo(407, 285); c.fill();
  c.beginPath(); c.moveTo(270, 297); c.lineTo(220, 338); c.lineTo(156, 342); c.lineTo(155, 361); c.lineTo(253, 361); c.lineTo(340, 299); c.fill();
  c.beginPath(); c.moveTo(600, 285); c.lineTo(676, 315); c.lineTo(629, 343); c.lineTo(711, 356); c.lineTo(727, 339); c.lineTo(685, 331); c.lineTo(753, 292); c.lineTo(685, 251); c.fill();
  c.strokeStyle = '#111a15'; c.lineWidth = 27; c.lineCap = 'round'; c.beginPath(); c.moveTo(713, 229); c.bezierCurveTo(900, 222, 928, 60, 826, 110); c.stroke();
  c.fillStyle = '#f4c630'; c.beginPath(); c.ellipse(269, 259, 7, 4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#111a15'; c.textAlign = 'center'; c.font = '900 92px sans-serif'; c.fillText('BEWARE OF DOG', 512, 524);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map });
  for (const side of [-1, 1]) { const face = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.56), mat); face.position.set(0, 2.4, side * .065); face.rotation.y = side < 0 ? Math.PI : 0; group.add(face); }
  return group;
}

/** Invented residents. The data supplies geography, never names or ownership. */
export class Animals {
  readonly group = new THREE.Group();
  readonly places: Place[] = [];
  /** Selection uses baked samples so its result does not depend on the first camera position. */
  readonly ready: Promise<void>;
  private residents: Resident[] = [];
  private photoSubjects: Subject[] = [];

  registerEvidence(evidence: Evidence): void {
    this.photoSubjects = this.residents.map((a, i) => evidence.register({
      id: `animal:${i}`, kind: 'animal', x: a.home.x, z: a.home.z, radius: a.kind === 'cow' || a.kind === 'farm' ? 1.5 : 1, road: a.spot.road.id,
      label: a.kind === 'cat' ? 'Cat · Glenora Falls Road' : a.kind === 'roofcat' ? 'Cat on a roof' : a.kind === 'cow' ? 'Cow · Mabou Mines Road' : a.kind === 'bull' ? `Highland bull · ${a.spot.road.name ?? 'model review'}` : a.kind === 'guardian' ? 'Guardian dog · Mull River Road' : a.kind === 'farm' ? 'Horse and sheep · Smithville Road' : 'Dog beside the road',
      active: false, blocking: false,
    }));
  }
  private time = 0;
  private flash = 0;
  private readonly horn: THREE.Sprite;
  private readonly demo = new URLSearchParams(location.search).has('demo');
  private readonly requested = (() => { const key = new URLSearchParams(location.search).get('animal'); return key === 'spaniel' ? 'bernese' : key; })();
  private readonly hoof = new THREE.Vector3();
  private readonly target: Point = { x: 0, z: 0 };
  private readonly previous: Point = { x: 0, z: 0 };
  private readonly lastVehicle: Point = { x: 0, z: 0 };
  private haveLastVehicle = false;
  private readonly braking = { brake: 0 };
  private readonly catDown = new URLSearchParams(location.search).get('cat') === 'down';
  // An explicit map placement takes precedence over the animal's usual test approach.
  private spawnReady = new URLSearchParams(location.search).has('at');
  private testResident: Resident | null = null;
  private testStart: RoadHit | null = null;

  constructor(private readonly roads: Roads, private readonly terrain: Terrain, buildings: Building[] | null, village: [number, number]) {
    this.group.name = 'The animals win';
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff6c3'; ctx.fillRect(0, 0, 256, 80); ctx.fillStyle = '#342923'; ctx.font = 'bold 54px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('HONK', 128, 59);
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
    this.horn = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false }));
    this.horn.scale.set(2.4, 0.75, 1); this.horn.visible = false; this.group.add(this.horn);
    this.ready = this.select(buildings ?? [], village);
  }

  private add(kind: Kind, spot: RoadHit, home: Point, roof = 0) {
    const place = { name: kind, road: spot.road.name, x: home.x, z: home.z };
    this.places.push(place);
    this.residents.push({ decor: null, herd: [], fieldReady: false, buildAfter: 0, lastActiveAt: 0, side: 1, direction: 1, kind, place, home: { x: home.x, z: home.z }, spot, along: alongRoad(spot), roof, down: 0, rig: null, state: 'home', timer: 0, away: 0, met: false, honks: 0, travel: 0, pause: 0, moving: false, sit: kind === 'pom' || kind === 'roofcat' || kind === 'retriever' ? 1 : 0 });
  }

  private async select(buildings: Building[], village: [number, number]) {
    const roofBuildings = buildings.filter((b) => b.buildingId === undefined || b.buildingId === b.id);
    buildings = buildingSites(buildings);
    const glenora = this.roads.roads.filter((r) => r.name?.toLowerCase() === 'glenora falls road' && r.kind <= 3 && !r.bridge).sort((a, b) => length(b) - length(a))[0];
    if (glenora && length(glenora) > 600) {
      const spot = await this.catSpot(glenora);
      this.add('cat', spot, spot);
      // Screenshot shortcut; normal encounters still require two honks.
      if (this.catDown) {
        const a = this.residents[this.residents.length - 1]; a.honks = 2; a.sit = 1; a.down = 1;
      }
    }
    const used: Point[] = [];
    const homes = buildings.filter((b) => b.kind === 'house' && Math.hypot(b.x - village[0], b.y - village[1]) > 900)
      .map((b) => {
        const p = { x: b.x - village[0], z: village[1] - b.y };
        // nearRoad is present in the baked data but absent in older Building schemas.
        const id = 'nearRoad' in b && typeof b.nearRoad === 'number' ? b.nearRoad : null;
        const hit = this.roads.nearest(p.x, p.z, 70, (r) => r.kind <= 3 && !r.bridge && (id === null || r.id === id));
        return { b, p, hit };
      }).filter((s): s is typeof s & { hit: RoadHit } => s.hit !== null)
      .sort((a, b) => a.hit.dist - b.hit.dist || a.b.id - b.b.id);
    const pom = homes.filter((s) => s.hit.road.kind === 3 && !('washboard' in s.hit.road && s.hit.road.washboard)
      && s.hit.road.name?.toLowerCase() !== 'glenora falls road' && s.hit.road.name !== 'Mabou Harbour Road'
      && alongRoad(s.hit) > 100 && length(s.hit.road) - alongRoad(s.hit) > 100)
      .sort((a, b) => {
        const rank = (r: Road) => ['Rankinville Road', 'Smithville Road', 'MacDonald Glen Road'].indexOf(r.name ?? '');
        return (rank(a.hit.road) < 0 ? 99 : rank(a.hit.road)) - (rank(b.hit.road) < 0 ? 99 : rank(b.hit.road))
          || a.hit.dist - b.hit.dist || a.b.id - b.b.id;
      })[0];
    if (pom) { this.add('pom', pom.hit, pom.hit); used.push(pom.p); }
    for (const kind of ['retriever', 'bernese'] as const) {
      const site = homes.find((s) => s.hit.dist > s.hit.road.halfWidth + 7 && s.hit.dist < 24 && used.every((p) => distance(p, s.p) > 350) && alongRoad(s.hit) > 100 && length(s.hit.road) - alongRoad(s.hit) > 100);
      if (!site) continue;
      // A yard point between the road and the front of the building, outside its footprint.
      const d = site.hit.dist, yard = Math.min(d - Math.max(site.b.length, site.b.width) * 0.55 - 1, site.hit.road.halfWidth + 5);
      const home = { x: site.hit.x + (site.p.x - site.hit.x) / d * Math.max(site.hit.road.halfWidth + 2, yard), z: site.hit.z + (site.p.z - site.hit.z) / d * Math.max(site.hit.road.halfWidth + 2, yard) };
      this.add(kind, site.hit, home); used.push(site.p);
    }
    const roofs = roofBuildings.filter((b) => (b.kind === 'shed' || b.kind === 'house') && b.roof === 'gable' && b.ridge < 6 && b.length < 18)
      .map((b) => { const p = { x: b.x - village[0], z: village[1] - b.y }; return { b, p, hit: this.roads.nearest(p.x, p.z, 24, (r) => r.kind <= 3 && !r.bridge) }; })
      .filter((s): s is typeof s & { hit: RoadHit } => s.hit !== null && s.hit.dist > 6 && used.every((p) => distance(p, s.p) > 200))
      .sort((a, b) => a.b.ridge - b.b.ridge || a.b.id - b.b.id);
    const roof = roofs[0];
    if (roof) this.add('roofcat', roof.hit, roof.p, roof.b.ridge);
    // Choose a gravel-road yard from baked geography, independent of the camera or terrain cache.
    const guardian = homes.filter(s => s.hit.road.name === 'Mull River Road' && s.hit.road.kind === 3
      && s.hit.dist > s.hit.road.halfWidth + 6 && s.hit.dist < 60
      && alongRoad(s.hit) >= 300 && length(s.hit.road) - alongRoad(s.hit) >= 300)
      .sort((a, b) => a.b.id - b.b.id)[0];
    if (guardian) {
      const reach = guardian.hit.road.halfWidth + 7, d = guardian.hit.dist;
      this.add('guardian', guardian.hit, { x: guardian.hit.x + (guardian.p.x - guardian.hit.x) / d * reach,
        z: guardian.hit.z + (guardian.p.z - guardian.hit.z) / d * reach });
    }
    const cow = this.roads.nearest(619093 - village[0], village[1] - 5109326, 250, r => r.name === 'Mabou Mines Road');
    if (cow) this.add('cow', cow, { x: cow.x + Math.cos(cow.heading) * (cow.road.halfWidth + 1.2), z: cow.z + Math.sin(cow.heading) * (cow.road.halfWidth + 1.2) });
    const bullPreview = import.meta.env.DEV && new URLSearchParams(location.search).get('bullPreview') === '1';
    if (HIGHLAND_BULL_ENABLED || bullPreview) {
      const position = HIGHLAND_BULL_POSITION;
      const cow = this.roads.nearest(position.east - village[0], village[1] - position.north, 250, r => r.kind <= 3 && !r.bridge);
      if (cow) { const home={x:position.east-village[0],z:village[1]-position.north};this.add('bull',cow,home);this.residents[this.residents.length-1].side=Math.sign((home.x-cow.x)*Math.cos(cow.heading)+(home.z-cow.z)*Math.sin(cow.heading))||1; }
    }
    const farm = this.roads.nearest(627256 - village[0], village[1] - 5104125, 250, r => r.name === 'Smithville Road');
    if (farm) {
      const barn = buildings.filter(b => b.kind === 'barn' && Math.hypot(b.x - 627256, b.y - 5104125) < 180)
        .sort((a, b) => Math.hypot(a.x - 627256, a.y - 5104125) - Math.hypot(b.x - 627256, b.y - 5104125))[0];
      const side = barn ? Math.sign((barn.x - village[0] - farm.x) * Math.cos(farm.heading) + (village[1] - barn.y - farm.z) * Math.sin(farm.heading)) || 1 : 1;
      this.add('farm', farm, { x: farm.x + Math.cos(farm.heading) * 22 * side, z: farm.z + Math.sin(farm.heading) * 22 * side });
      this.residents[this.residents.length - 1].side = side;
    }
    this.testResident = this.residents.find(a => a.kind === this.requested) ?? null;
    if (this.testResident) {
      const a = this.testResident, before = roadPoint(a.spot.road, Math.max(0, a.along - 60));
      const after = roadPoint(a.spot.road, Math.min(length(a.spot.road), a.along + 60)); after.heading += Math.PI;
      const bend = (p: RoadHit) => Math.abs(Math.atan2(Math.sin(angle(p, a.spot) - p.heading), Math.cos(angle(p, a.spot) - p.heading)));
      this.testStart = bend(after) < bend(before) ? after : before;
    }
    console.info('[animals] test keys: cat, pom, retriever, bernese (alias spaniel), roofcat, guardian, cow, farm');
    for (const a of this.residents) console.info(`[animals] ${a.kind}: ${a.spot.road.name ?? 'unnamed road'}, ${a.along.toFixed(0)} m along road piece ${a.spot.road.id}; world ${a.home.x.toFixed(1)}, ${a.home.z.toFixed(1)}`);
  }

  private async catSpot(road: Road): Promise<RoadHit> {
    // Read only the small set of metre-resolution tiles along this road, sequentially.
    // The live terrain is camera-lazy; using its current cache alone would move the cat between visits.
    const m = this.terrain.manifest, size = m.size / 256;
    const cache = new Map<string, Uint8ClampedArray>();
    const ground = async (x: number, z: number): Promise<number | null> => {
      const east = x + m.village[0] - m.origin[0], south = z - (m.village[1] - m.origin[1]);
      const i = Math.floor(east / size), j = Math.floor(south / size), key = `${i}_${j}`;
      if (!m.levels['8']?.includes(key)) return null;
      let px = cache.get(key);
      if (!px) {
        const bmp = await createImageBitmap(await readFile(this.terrain.base, `8/${key}.png`), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const cv = new OffscreenCanvas(257, 257), ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0); bmp.close(); px = ctx.getImageData(0, 0, 257, 257).data; cache.set(key, px);
      }
      const u = (east / size - i) * 256, v = (south / size - j) * 256, a = Math.min(255, Math.floor(u)), b = Math.min(255, Math.floor(v));
      const h = (xx: number, zz: number) => { const k = (zz * 257 + xx) * 4; return (px[k] * 256 + px[k + 1]) * m.height.scale + m.height.offset; };
      return THREE.MathUtils.lerp(THREE.MathUtils.lerp(h(a, b), h(a + 1, b), u - a), THREE.MathUtils.lerp(h(a, b + 1), h(a + 1, b + 1), u - a), v - b);
    };
    let best = roadPoint(road, length(road) / 2), score = -Infinity;
    for (let s = 312; s <= length(road) - 312; s += 12) {
      const p = roadPoint(road, s), rx = Math.cos(p.heading), rz = Math.sin(p.heading), reach = road.halfWidth + 7;
      const l = await ground(p.x - rx * reach, p.z - rz * reach), r = await ground(p.x + rx * reach, p.z + rz * reach), c = await ground(p.x, p.z);
      if (l === null || r === null || c === null) continue;
      // Prefer a cross slope with a high bank and a lower ditch, rather than a hill on both sides.
      const slope = Math.abs(l - r) / (reach * 2) + (Math.min(l, r) < c - 0.8 ? 0.15 : 0);
      if (slope > score) { score = slope; best = p; }
    }
    return best;
  }

  get waitingForTerrain(): boolean { return this.testResident !== null && !this.spawnReady; }

  honk(vehicle: Vehicle): void {
    this.flash = 0.65;
    for (const a of this.residents) {
      if (distance(a.rig?.root.position ?? a.home, vehicle) > 45) continue;
      if (a.kind === 'cat' && (a.state === 'home' || a.state === 'rise')) {
        a.honks = a.sit > 0 || a.down > 0 ? Math.max(2, a.honks + 1) : 1;
        a.state = 'home'; a.timer = 0; a.sit = 1;
      }
      if (a.kind === 'pom') a.timer = 0;
      if (a.kind === 'bernese' && a.state === 'visit') a.timer += 0.3;
    }
  }

  update(dt: number, vehicle: Vehicle, camera: THREE.Camera): void {
    this.time += dt; this.flash = Math.max(0, this.flash - dt);
    this.horn.visible = this.flash > 0;
    this.horn.position.set(vehicle.x, vehicle.y + 2.7, vehicle.z);
    const requested = this.testResident, s = this.testStart;
    if (requested && s && !this.spawnReady) {
      vehicle.place(s.x, s.z, s.heading); vehicle.speed = 0;
      this.spawnReady = this.terrain.pending === 0 && (this.terrain.surfaceAt(s.x, s.z)?.level ?? 0) >= 7
        && (this.terrain.surfaceAt(requested.home.x, requested.home.z)?.level ?? 0) >= 7;
    }
    for (const a of this.residents) {
      if (!a.rig) {
        if (distance(a.home, vehicle) > 600) continue;
        if ((a.kind === 'cow' || a.kind === 'farm') && !a.fieldReady) {
          if (this.time < a.buildAfter) continue;
          a.buildAfter = this.time + .5;
          if (!this.buildPasture(a)) continue;
          a.fieldReady = true;
        }
        const h = this.terrain.heightAt(a.home.x, a.home.z);
        if (h === null || (this.terrain.surfaceAt(a.home.x, a.home.z)?.level ?? 0) < 6) continue;
        a.rig = a.kind === 'bull' ? createHighlandBull(this.terrain.low) : a.kind === 'cow' ? createRoadCow() : a.kind === 'farm' ? stockModel('horse') : model(a.kind); a.rig.root.position.set(a.home.x, h + a.roof, a.home.z);
        a.rig.root.rotation.y = -angle(a.home, vehicle); this.group.add(a.rig.root);
        if (a.kind === 'bull') {
          const fallback = a.rig;
          void loadHighlandBull({ low: this.terrain.low, legs: true }).then(loaded => {
            if (a.rig !== fallback || fallback.root.parent !== this.group) {
              loaded.root.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
              return;
            }
            loaded.root.position.copy(fallback.root.position);
            loaded.root.quaternion.copy(fallback.root.quaternion);
            loaded.root.visible = fallback.root.visible;
            loaded.head.rotation.y = fallback.head.rotation.y;
            loaded.tail.rotation.z = fallback.tail.rotation.z;
            loaded.root.updateMatrixWorld(true);
            const rig: Rig = { ...loaded, hoofSoles: loaded.hooves.map((hoof, i) => loaded.legs[i].worldToLocal(loaded.root.localToWorld(hoof.clone()))), legRestY: loaded.legs.map(leg => leg.position.y) };
            this.group.remove(fallback.root);
            fallback.root.traverse(node => { if (node instanceof THREE.Mesh) node.geometry.dispose(); });
            this.group.add(rig.root); a.rig = rig;
          }).catch(error => { console.warn('The Blender Highland bull did not load. The built-in bull is used instead.', error); });
        }
        if (a.kind === 'guardian') { a.decor = this.scenery(a); this.group.add(a.decor); }
      }
      const rig = a.rig, p = rig.root.position, d = distance(p, vehicle);
      rig.root.visible = distance(p, camera.position) < 650;
      if (a.decor) a.decor.visible = distance(a.home, vehicle) < 650;
      for (const g of a.herd) g.rig.root.visible = distance(g.home, vehicle) < 650;
      if (distance(p, vehicle) > 300 && distance(a.home, vehicle) > 300) continue;
      const elapsed = this.time - a.lastActiveAt; a.lastActiveAt = this.time;
      // Resume the walk home after a culled interval, so the next pass starts in the yard.
      if (elapsed > 1 && (a.kind === 'guardian' || a.kind === 'cow') && a.state !== 'home') {
        const homeDistance = distance(p, a.home), seconds = Math.max(0, elapsed - (a.kind === 'guardian' && (a.state === 'watch' || a.state === 'chase') ? 8 : 0));
        const step = Math.min(homeDistance, seconds * (a.kind === 'guardian' ? 1.5 : .6));
        if (homeDistance > .001) { p.x += (a.home.x - p.x) / homeDistance * step; p.z += (a.home.z - p.z) / homeDistance * step; }
        a.state = step >= homeDistance - .12 ? 'home' : 'return'; a.timer = 0;
        if (a.kind === 'cow') a.met = false;
      }
      a.moving = false;
      const stopped = Math.hypot(vehicle.vx, vehicle.vz) < 0.08;
      if (a.kind === 'cat' || a.kind === 'pom') this.roadResident(a, dt, vehicle, stopped, d);
      else if (a.kind === 'roofcat') { if (stopped && d < 30) a.timer += dt; else a.timer = 0; }
      else if (a.kind === 'guardian') this.guardian(a, dt, vehicle, d);
      else if (a.kind === 'bull') this.bull(a);
      else if (a.kind === 'cow') this.cow(a, dt, vehicle, stopped, d);
      else if (a.kind !== 'farm') this.dog(a, dt, vehicle, stopped, d);
      if (a.kind === 'cow' || a.kind === 'farm') this.pasture(dt, a, vehicle, stopped);
      const ground = this.animalGround(p.x, p.z, a.kind === 'bull');
      if (ground !== null) p.y = ground + a.roof;
      if (!a.roof && a.kind !== 'farm') this.groundRig(rig, !a.moving, a.kind === 'bull');
      if (a.kind === 'cow' || a.kind === 'bull') {
        const target = -angle(p, vehicle) - rig.root.rotation.y;
        rig.head.rotation.y += (clamp(Math.atan2(Math.sin(target), Math.cos(target)), -1.2, 1.2) - rig.head.rotation.y) * Math.min(1, dt * 2);
        if (rig.jaw) rig.jaw.rotation.z = Math.sin(this.time * 2.4) * .045;
        rig.tail.rotation.z = Math.sin(this.time) * .12;
        for (let i = 0; i < 4; i++) rig.legs[i].rotation.x = a.moving ? Math.sin(this.time * 3 + (i % 3 ? Math.PI : 0)) * .18 : 0;
      } else if (a.kind !== 'farm') this.animate(a, dt, vehicle, d);
    }
    for (let i = 0; i < this.residents.length; i++) {
      const a = this.residents[i], s = this.photoSubjects[i], p = a.rig?.root.position;
      if (!s) continue;
      s.active = !!p && distance(p, vehicle) <= 300;
      if (!s.active) { s.blocking = false; continue; }
      if (p) {
        s.x = p.x; s.z = p.z; s.y = p.y + (a.rig?.shoulder ?? .3) * .8;
        const surface = this.terrain.surfaceAt(p.x, p.z);
        s.blocking = a.kind !== 'roofcat' && a.kind !== 'farm' && a.kind !== 'bull' && !!surface && surface.roadDist <= surface.halfWidth + .5;
      }
    }
    this.protect(vehicle);
    this.lastVehicle.x = vehicle.x; this.lastVehicle.z = vehicle.z; this.haveLastVehicle = true;
  }

  /** Fixed candidate order; only grass-sized, dry, off-road patches can hold a grazer. */
  private openField(x: number, z: number, radius: number): boolean {
    for (let i = 0; i < 9; i++) {
      const t = i * Math.PI / 4, reach = i === 8 ? 0 : radius;
      const px = x + Math.cos(t) * reach, pz = z + Math.sin(t) * reach;
      const s = this.terrain.surfaceAt(px, pz);
      if (!s || s.level < 7 || s.canopy >= 1.5 || s.ground <= this.terrain.seaLevel + .5 || s.roadDist <= s.halfWidth + 4) return false;
    }
    return true;
  }

  private buildPasture(a: Resident): boolean {
    const cow = a.kind === 'cow', rx = Math.cos(a.spot.heading), rz = Math.sin(a.spot.heading);
    const fx = Math.sin(a.spot.heading), fz = -Math.cos(a.spot.heading);
    const baseX = a.spot.x, baseZ = a.spot.z;
    if (cow) {
      const w = a.spot.road.halfWidth + 8;
      const l = this.terrain.surfaceAt(baseX - rx * w, baseZ - rz * w), r = this.terrain.surfaceAt(baseX + rx * w, baseZ + rz * w);
      if (!l || !r || Math.min(l.level, r.level) < 7) return false;
      a.side = l.ground < r.ground ? -1 : 1;
      const home = this.roads.guardrails?.cowRest(a.spot.road, a.along, a.side, (x, z) => {
        const surface = this.terrain.surfaceAt(x, z), height = this.terrain.heightAt(x, z);
        return surface && surface.level >= 8 && height !== null && height > this.terrain.seaLevel + .5 ? height : null;
      });
      if (!home) return false;
      a.home.x = a.place.x = home.x; a.home.z = a.place.z = home.z; a.homeHeading = home.heading;
    }
    const fieldSide = cow ? -a.side : a.side;
    let x = 0, z = 0, found = false;
    // Stay between the road and the farm: nearest open patch on the building side wins.
    for (let reach = 18; reach <= (cow ? 60 : 100) && !found; reach += 8) {
      for (let offset = 0; offset <= 48 && !found; offset += 8) for (const sign of offset ? [-1, 1] : [1]) {
        const px = baseX + rx * reach * fieldSide + fx * offset * sign, pz = baseZ + rz * reach * fieldSide + fz * offset * sign;
        if (this.openField(px, pz, cow ? 11 : 14)) { x = px; z = pz; found = true; break; }
      }
    }
    if (!found) return false;
    const templates = cow ? null : { sheep: stockModel('sheep'), black: stockModel('sheep', true), lamb: stockModel('lamb') };
    if (!cow) { a.home.x = a.place.x = x; a.home.z = a.place.z = z; }
    const count = cow ? 4 : 9;
    for (let i = 0; i < count; i++) {
      const kind: Stock = cow ? i < 2 ? 'highland' : 'cow' : i >= 6 ? 'lamb' : 'sheep';
      const rig = templates ? cloneStock(kind === 'lamb' ? templates.lamb : i === 2 || i === 4 ? templates.black : templates.sheep) : stockModel(kind);
      // Lamb slots pair with the first three ewes; their movement stays within two metres.
      const ewe = i >= 6 && !cow ? i - 6 : i;
      const theta = ewe * 2.39996, reach = cow ? 5 + i : 5 + ewe % 3 * 1.5;
      const hx = x + Math.cos(theta) * reach + (kind === 'lamb' ? 1.1 : 0), hz = z + Math.sin(theta) * reach + (kind === 'lamb' ? .8 : 0);
      rig.root.position.set(hx, this.terrain.heightAt(hx, hz) ?? 0, hz); rig.root.rotation.y = theta;
      a.herd.push({ kind, rig, home: { x: hx, z: hz }, phase: ewe * 1.7 }); this.group.add(rig.root);
    }
    console.info(`[animals] ${a.kind} field: world ${x.toFixed(1)}, ${z.toFixed(1)}; ${a.herd.length} grazers`);
    return true;
  }

  private scenery(a: Resident): THREE.Group {
    const group = new THREE.Group(), rx = Math.cos(a.spot.heading), rz = Math.sin(a.spot.heading);
    if (a.kind === 'guardian') {
      const sign = pantherSign();
      const side = Math.sign((a.home.x - a.spot.x) * rx + (a.home.z - a.spot.z) * rz) || 1;
      sign.position.set(a.spot.x + rx * (a.spot.road.halfWidth + 1.7) * side,
        this.terrain.heightAt(a.spot.x + rx * (a.spot.road.halfWidth + 1.7) * side, a.spot.z + rz * (a.spot.road.halfWidth + 1.7) * side) ?? 0,
        a.spot.z + rz * (a.spot.road.halfWidth + 1.7) * side);
      sign.rotation.y = -a.spot.heading + side * .15; group.add(sign);
      console.info(`[animals] panther sign: world ${sign.position.x.toFixed(1)}, ${sign.position.z.toFixed(1)}`);
    }
    return group;
  }

  private animalGround(x: number, z: number, drawn: boolean): number | null {
    return (drawn ? this.terrain.meshHeightAt(x, z, true) : null) ?? this.terrain.heightAt(x, z);
  }

  private groundRig(rig: Rig, standing: boolean, drawn = false): void {
    const p = rig.root.position, heading = -rig.root.rotation.y;
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
    const reach = rig.shoulder > 1 ? .72 : rig.shoulder * .5, width = rig.shoulder * .25;
    const front = this.animalGround(p.x + fx * reach, p.z + fz * reach, drawn) ?? p.y;
    const back = this.animalGround(p.x - fx * reach, p.z - fz * reach, drawn) ?? p.y;
    const right = this.animalGround(p.x + rx * width, p.z + rz * width, drawn) ?? p.y;
    const left = this.animalGround(p.x - rx * width, p.z - rz * width, drawn) ?? p.y;
    rig.root.rotation.x = clamp(Math.atan2(front - back, reach * 2), -.55, .55);
    rig.root.rotation.z = clamp(Math.atan2(right - left, width * 2), -.55, .55);
    const sheep = rig.root.name === 'sheep' || rig.root.name === 'lamb';
    if (rig.shoulder > 1 || sheep) {
      for (let i=0;i<rig.legs.length;i++) { const leg=rig.legs[i];leg.position.y=rig.legRestY?.[i]??rig.shoulder*.63;if(standing)leg.rotation.x=0; }
      if (standing) {
        rig.root.updateMatrixWorld(true);
        const e=rig.root.matrixWorld.elements;
        const up=e[5]/(e[4]*e[4]+e[5]*e[5]+e[6]*e[6]);
        for (let index=0;index<rig.legs.length;index++) { const leg=rig.legs[index];
          for (let i = 0; i < 2; i++) {
            const sole=rig.hoofSoles?.[index];if(sole)this.hoof.copy(sole);else this.hoof.set(0,-rig.shoulder*(sheep ? .63 : .635),0);leg.localToWorld(this.hoof);
            const ground = this.animalGround(this.hoof.x, this.hoof.z, drawn);
            if (ground !== null) leg.position.y += clamp((ground + .002 - this.hoof.y) * up, -.2, .2);
          }
        }
      }
    }
  }

  private pasture(dt: number, a: Resident, v: Vehicle, stopped: boolean) {
    for (const grazer of a.herd) this.graze(dt, grazer.rig, grazer.home, grazer.phase, v, stopped);
    if (a.kind === 'farm' && a.rig) this.graze(dt, a.rig, a.home, 9, v, stopped);
  }

  private graze(dt: number, rig: Rig, home: Point, phase: number, v: Vehicle, stopped: boolean) {
    const p = rig.root.position, cycle = (this.time + phase * 7) % 24;
    const moving = cycle < 4;
    if (moving) {
      // A closed two-metre grazing loop cannot carry an animal out of its checked patch.
      const t = (this.time + phase * 7) / 24 * Math.PI * 2;
      const x = home.x + Math.sin(t) * 1.5, z = home.z + Math.cos(t) * 1.5;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz), step = Math.min(d, dt * .35);
      if (d > .01) { p.x += dx / d * step; p.z += dz / d * step; rig.root.rotation.y = -Math.atan2(dx, -dz); }
    }
    p.y = this.terrain.heightAt(p.x, p.z) ?? p.y;
    this.groundRig(rig, !moving);
    const look = stopped && distance(p, v) < 55;
    const target = -angle(p, v) - rig.root.rotation.y;
    const want = look ? clamp(Math.atan2(Math.sin(target), Math.cos(target)), -.85, .85) : Math.sin(this.time * .23 + phase) * .12;
    rig.head.rotation.y += (want - rig.head.rotation.y) * Math.min(1, dt * 2);
    if (rig.neck) {
      rig.neck.rotation.x += ((look ? 0 : -2.2 + Math.sin(this.time * .4 + phase) * .035) - rig.neck.rotation.x) * Math.min(1, dt * 2);
      rig.head.rotation.x += ((look ? 0 : .05) - rig.head.rotation.x) * Math.min(1, dt * 2);
    } else {
      rig.head.rotation.x += ((look ? 0 : -.55 + Math.sin(this.time * .4 + phase) * .04) - rig.head.rotation.x) * Math.min(1, dt * 2);
      rig.head.position.y = rig.shoulder * (look ? .92 : .5);
    }
    rig.tail.rotation.z = Math.sin(this.time * .8 + phase) * .12;
    for (let i = 0; i < 4; i++) rig.legs[i].rotation.x = moving ? Math.sin(this.time * 4 + (i % 3 ? Math.PI : 0)) * .12 : 0;
    if (rig.jaw) rig.jaw.rotation.z = Math.sin(this.time * 2 + phase) * .035;
  }

  private guardian(a: Resident, dt: number, v: Vehicle, d: number) {
    const p = a.rig!.root.position, speed = Math.hypot(v.vx, v.vz);
    if ((a.state === 'rise' || a.state === 'approach' || a.state === 'guard' || a.state === 'yield') && distance(a.spot, v) > 100) { a.state = 'return'; a.timer = 0; }
    if (a.state === 'home') {
      a.down = 1;
      if (distance(a.spot, v) < 70) { a.state = 'rise'; a.timer = 0; a.down = 0; a.direction = Math.cos(v.heading - a.spot.heading) >= 0 ? 1 : -1; }
    } else if (a.state === 'rise') {
      a.timer += dt; if (a.timer >= 1.5) { a.state = 'approach'; a.timer = 0; }
    } else if (a.state === 'approach') {
      if (this.walk(a, a.spot, 1.8, dt)) { a.state = 'guard'; a.timer = 0; }
    } else if (a.state === 'guard') {
      a.rig!.root.rotation.y = -a.spot.heading + Math.PI / 2;
      if (speed < .5 && d < 16) a.timer += dt;
      if (a.timer > 4) { a.state = 'yield'; a.timer = 0; }
    } else if (a.state === 'yield') {
      this.target.x = a.spot.x + Math.cos(a.spot.heading) * (a.spot.road.halfWidth + .9) * a.direction;
      this.target.z = a.spot.z + Math.sin(a.spot.heading) * (a.spot.road.halfWidth + .9) * a.direction;
      if (this.walk(a, this.target, 1.3, dt)) { a.state = 'shoulder'; a.timer = 0; }
    } else if (a.state === 'shoulder') {
      this.face(a, v, dt, 2);
      if (speed > 1.2 && d < 40) { a.state = 'chase'; a.travel = a.timer = 0; }
      else if (distance(a.spot, v) > 90) a.state = 'return';
    } else if (a.state === 'chase') {
      const oldX = p.x, oldZ = p.z;
      const rx = Math.cos(v.heading), rz = Math.sin(v.heading), fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
      const forward = (p.x - v.x) * fx + (p.z - v.z) * fz, side = (p.x - v.x) * rx + (p.z - v.z) * rz;
      // If the car turns around, first cross beyond its bumper, never through its body.
      const end = forward < 0 ? -6 : 6;
      this.target.x = v.x + rx * (side < 1.8 && Math.abs(forward) < 5.8 ? side : 1.95) + fx * (side < 1.8 ? end : -.25);
      this.target.z = v.z + rz * (side < 1.8 && Math.abs(forward) < 5.8 ? side : 1.95) + fz * (side < 1.8 ? end : -.25);
      this.walk(a, this.target, Math.min(45 / 3.6, Math.max(0, 250 - a.travel) / Math.max(dt, .001)), dt); a.travel += Math.hypot(p.x - oldX, p.z - oldZ); a.timer += dt;
      if (a.travel >= 250 || a.timer >= 38 || d > 70) { a.state = 'watch'; a.timer = 0; }
    } else if (a.state === 'watch') {
      // Stop on the nearest part of the road and watch the departing car.
      this.project(a.spot.road, p, this.target); this.walk(a, this.target, 1.2, dt); this.face(a, v, dt, 1.5);
      if (d > 100) a.state = 'return';
    } else if (a.state === 'return' && this.walk(a, a.home, 1.5, dt)) { a.state = 'home'; a.down = 1; }
  }

  private bull(a: Resident) {
    // Honking does not move him onto the road. Head tracking runs in the shared cattle animation.
    a.state = 'home';
    a.rig!.root.position.x = a.home.x; a.rig!.root.position.z = a.home.z;
    a.rig!.root.rotation.y = -a.spot.heading + a.side * Math.PI / 2;
  }

  private cow(a: Resident, dt: number, v: Vehicle, stopped: boolean, d: number) {
    if (a.state === 'home') {
      a.rig!.root.rotation.y = -(a.homeHeading ?? a.spot.heading);
      if (distance(a.spot, v) > 30) a.met = false;
      if (!a.met && stopped && d < 12) a.timer += dt; else a.timer = 0;
      if (a.timer > 3) { a.state = 'approach'; a.timer = 0; a.met = true; }
    } else if (a.state === 'approach') {
      if (this.walk(a, a.spot, .55, dt)) { a.state = 'guard'; a.timer = 0; }
    } else if (a.state === 'guard') {
      a.timer += dt; a.rig!.root.rotation.y = -a.spot.heading + Math.PI / 2;
      if (distance(a.spot, v) >= 30 || a.timer >= 40) a.state = 'return';
    } else if (a.state === 'return' && this.walk(a, a.home, .6, dt)) { a.state = 'home'; a.timer = 0; }
  }

  private project(road: Road, p: Point, out: Point): void {
    let best = Infinity;
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1], dx = bx - ax, dz = bz - az;
      const t = clamp(((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const x = ax + dx * t, z = az + dz * t, d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < best) { best = d; out.x = x; out.z = z; }
    }
  }

  private shoulder(a: Resident): Point {
    const r = Math.cos(a.spot.heading), z = Math.sin(a.spot.heading), w = a.spot.road.halfWidth + 1.5;
    const left = this.terrain.surfaceAt(a.home.x - r * w, a.home.z - z * w);
    const right = this.terrain.surfaceAt(a.home.x + r * w, a.home.z + z * w);
    const sign = left && right && left.ground < right.ground ? -1 : 1;
    this.target.x = a.home.x + r * w * sign; this.target.z = a.home.z + z * w * sign; return this.target;
  }

  private roadResident(a: Resident, dt: number, v: Vehicle, stopped: boolean, d: number) {
    const p = a.rig!.root.position, cat = a.kind === 'cat';
    if (d < 30) a.met = true;
    if (a.state === 'home') {
      if (stopped && d < 12) a.timer += dt; else a.timer = 0;
      if (cat && this.catDown) a.timer = 0;
      if (a.timer >= (cat ? 20 : 6) || cat && a.met && distance(a.home, v) > 60) {
        a.state = cat && a.honks >= 2 ? 'rise' : 'yield'; a.travel = 0; a.timer = 0;
      }
    } else if (a.state === 'rise') {
      // Two seconds to rise, then a long front-leg stretch before leaving.
      a.timer += dt; a.sit = 0;
      if (a.timer >= 4.5) { a.state = 'yield'; a.timer = 0; a.honks = 0; }
    } else if (a.state === 'yield') {
      a.sit = 0;
      if (cat && a.travel > 1.5 && a.pause < 2) { a.pause += dt; this.face(a, v, dt, 1); }
      else {
        const oldX = p.x, oldZ = p.z;
        if (this.walk(a, this.shoulder(a), cat ? 0.35 : 1.4, dt)) a.state = 'shoulder';
        a.travel += Math.hypot(p.x - oldX, p.z - oldZ);
      }
    } else if (a.state === 'shoulder') {
      a.sit = cat ? 0 : 1;
      if (distance(a.home, v) > 60) a.away += dt; else a.away = 0;
      if (a.away > (cat ? 3 : 30)) { a.state = 'return'; a.sit = 0; }
    } else if (a.state === 'return' && this.walk(a, a.home, cat ? 0.4 : 1.2, dt)) {
      a.state = 'home'; a.met = false; a.away = a.timer = a.pause = a.honks = 0; a.sit = cat ? 0 : 1;
    }
    if (!a.moving && a.state !== 'yield' && !(cat && (a.honks >= 2 || a.state === 'rise'))) this.face(a, v, dt, cat ? 0.7 / (1 + a.honks * 0.5) : 1.6);
  }

  private dog(a: Resident, dt: number, v: Vehicle, stopped: boolean, d: number) {
    const bernese = a.kind === 'bernese', p = a.rig!.root.position;
    const rx = Math.cos(v.heading), rz = Math.sin(v.heading), fx = Math.sin(v.heading), fz = -Math.cos(v.heading);
    if (a.state === 'home') {
      a.sit = 1; this.face(a, v, dt, .8);
      if (stopped && d < (bernese ? 20 : 25)) { a.state = 'approach'; a.travel = 0; }
    } else if (a.state === 'approach' || a.state === 'visit') {
      a.sit = 0;
      if (d > 45 || distance(a.home, v) > 95) { a.state = 'return'; a.timer = 0; }
      else if (!stopped) { a.state = 'chase'; a.travel = a.timer = 0; }
      else {
        const side = (p.x - v.x) * rx + (p.z - v.z) * rz, forward = (p.x - v.x) * fx + (p.z - v.z) * fz;
        const detour = side < 1.5, end = (forward < 0 ? -1 : 1) * Math.max(5.8, Math.abs(forward));
        const r = detour ? Math.abs(forward) < 5.6 ? side : 1.8 : 1.55;
        const f = detour ? Math.abs(forward) < 5.6 ? end : forward : 0;
        this.target.x = v.x + rx * r + fx * f; this.target.z = v.z + rz * r + fz * f;
        if (this.walk(a, this.target, bernese ? 3.8 : .7, dt) && !detour) { a.state = 'visit'; a.timer += dt; this.face(a, v, dt, 3); }
      }
    } else if (a.state === 'chase') {
      a.sit = 0;
      this.project(a.spot.road, v, this.target);
      this.target.x += rx * (a.spot.road.halfWidth + .8); this.target.z += rz * (a.spot.road.halfWidth + .8);
      const oldX = p.x, oldZ = p.z;
      this.walk(a, this.target, bernese ? 30 / 3.6 : 1.3, dt);
      a.travel += Math.hypot(p.x - oldX, p.z - oldZ); a.timer += dt;
      if (a.travel >= (bernese ? 80 : 6) || distance(a.home, p) > (bernese ? 85 : 18) || d > (bernese ? 45 : 14) || a.timer > (bernese ? 18 : 7)) { a.state = 'return'; a.timer = 0; }
    } else if (a.state === 'return' && this.walk(a, a.home, bernese ? 2 : .65, dt)) { a.state = 'home'; a.timer = 0; }
  }

  private face(a: Resident, target: Point, dt: number, rate: number) {
    const root = a.rig!.root, want = -angle(root.position, target);
    const err = Math.atan2(Math.sin(want - root.rotation.y), Math.cos(want - root.rotation.y));
    root.rotation.y += clamp(err, -rate * dt, rate * dt);
  }

  private walk(a: Resident, target: Point, speed: number, dt: number): boolean {
    const p = a.rig!.root.position, d = distance(p, target);
    if (d < 0.12) return true;
    const step = Math.min(d, speed * dt), x = p.x + (target.x - p.x) / d * step, z = p.z + (target.z - p.z) / d * step;
    if (this.terrain.heightAt(x, z) === null) return false;
    p.x = x; p.z = z; a.moving = true; this.face(a, target, dt, 4); return d <= step + 0.12;
  }

  private animate(a: Resident, dt: number, v: Vehicle, d: number) {
    const rig = a.rig!, cat = a.kind === 'cat' || a.kind === 'roofcat';
    const target = -angle(rig.root.position, v) - rig.root.rotation.y;
    const turn = a.kind === 'roofcat' && a.timer === 0 ? 0 : clamp(Math.atan2(Math.sin(target), Math.cos(target)), -0.7, 0.7);
    rig.head.rotation.y += (turn - rig.head.rotation.y) * Math.min(1, dt * (cat ? 1 / (1 + a.honks) : 4));
    const lying = a.kind === 'cat' && a.honks >= 2;
    const guardianDown = a.kind === 'guardian' && a.state === 'home';
    const downTarget = guardianDown ? 1 : lying ? a.state === 'rise' ? Math.max(0, 1 - a.timer / 2) : 1 : 0;
    a.down += (downTarget - a.down) * Math.min(1, dt * 4);
    const down = a.down;
    const stretch = a.state === 'rise' ? Math.sin(clamp((a.timer - 2) / 2.5, 0, 1) * Math.PI) : 0;
    if (lying) {
      const want = -a.spot.heading + Math.PI / 2;
      rig.root.rotation.y += Math.atan2(Math.sin(want - rig.root.rotation.y), Math.cos(want - rig.root.rotation.y)) * Math.min(1, dt * 2);
    }
    const sitting = a.sit * (1 - down);
    rig.torso.position.y = rig.shoulder * (0.79 - sitting * 0.22);
    rig.torso.rotation.x = sitting * -0.32;
    const jump = a.kind === 'bernese' && a.state === 'visit' ? Math.max(0, Math.sin(a.timer * 6)) : 0;
    rig.body.position.y += (jump * 0.55 - down * (a.kind === 'guardian' ? .23 : .045) - rig.body.position.y) * Math.min(1, dt * 12);
    rig.body.rotation.x = jump * 0.85 + stretch * .18;
    rig.body.scale.set(1, 1 - down * .35, 1 + down * .8 + stretch * .18);
    rig.head.position.y = rig.shoulder * 1.13 - down * (a.honks >= 3 ? .10 : -.06);
    rig.head.rotation.x = down * (a.honks >= 3 ? -.2 : -.12) - jump * .7;
    if (lying) rig.head.rotation.y = clamp(Math.atan2(Math.sin(target), Math.cos(target)), -1.55, 1.55);
    for (const leg of rig.legs) leg.rotation.z = down * 1.35;
    rig.tail.rotation.x = down * -.4;
    if (rig.jaw) rig.jaw.position.y = -rig.shoulder * .26 * .53 - (a.state === 'visit' ? Math.abs(Math.sin(a.timer * 12)) * .035 : 0);
    for (let i = 0; i < rig.legs.length; i++) rig.legs[i].rotation.x = a.moving ? Math.sin(this.time * (cat ? 6 : a.kind === 'guardian' && a.state === 'chase' ? 18 : 10) + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.48 : i >= 2 ? sitting * -0.9 : jump * 0.65;
    rig.tail.rotation.y = Math.sin(this.time * (cat ? 1.1 / (1 + a.honks * 0.2) : d < 25 ? 9 : 2)) * (cat ? 0.26 : 0.65);
    for (let i = 0; i < rig.ears.length; i++) rig.ears[i].rotation.x = Math.sin(this.time * 3 + i) * (a.moving ? 0.13 : 0.025);
    if (cat) for (const eye of rig.eyes) { eye.scale.y = lying ? a.honks >= 3 ? .02 : .45 : Math.max(0.25, 1 - a.honks * 0.17); eye.visible = !(lying && a.honks >= 3); }
  }

  /** Braking distance includes reaction time, the bonnet, and a 2.5 m animal clearance. */
  influence(v: Vehicle): { brake: number } {
    this.braking.brake = 0;
    if (this.waitingForTerrain) { this.braking.brake = 1; return this.braking; }
    const speed = Math.hypot(v.vx, v.vz), direction = v.speed < -0.05 ? -1 : 1;
    const fx = Math.sin(v.heading) * direction, fz = -Math.cos(v.heading) * direction;
    let brake = 0;
    for (const a of this.residents) {
      if (!a.rig || distance(a.rig.root.position, v) > 300) continue;
      // Animal test demos also stop at the yard or roof, so the welcome can be seen.
      const visiting = this.demo && this.requested === a.kind && (a.kind === 'retriever' || a.kind === 'bernese' || a.kind === 'roofcat' || a.kind === 'farm' || a.kind === 'cow' && a.state === 'home');
      if (a.roof > 0 && !visiting) continue;
      const p = visiting ? a.spot : a.rig.root.position, dx = p.x - v.x, dz = p.z - v.z;
      let ahead = dx * fx + dz * fz;
      const side = Math.abs(dx * -fz + dz * fx);
      this.project(a.spot.road, v, this.previous);
      const onApproach = distance(v, this.previous) < a.spot.road.halfWidth + .3
        && (visiting || (a.kind === 'cat' || a.kind === 'pom') && a.state === 'home') && distance(v, a.spot) < 45;
      if (ahead < 0 || side > 1.9 + (a.kind === 'cow' ? .8 : 0) && !onApproach) continue;
      if (onApproach) ahead = Math.min(ahead, distance(v, a.spot));
      const room = ahead - (a.kind === 'farm' ? 48 : a.kind === 'cat' ? 10 : a.kind === 'cow' ? 6.5 : 5.2); // Leave the low cat visible beyond the bonnet.
      const stopping = speed * speed / 7 + speed * 0.35;
      if (room < stopping + 0.2) brake = Math.max(brake, clamp((stopping + 0.2 - room) / 2 + 0.2, 0, 1));
    }
    this.braking.brake = brake; return this.braking;
  }

  /** Last line of protection for slides, reverse, steep hills and animals beside the door. */
  resetVehicleHistory(): void { this.haveLastVehicle = false; }

  /** True when an animal stands within r metres of (x, z): an instant-replay mark there is quiet (never shown off). */
  near(x: number, z: number, r: number): boolean {
    for (const a of this.residents) {
      if (a.rig && Math.hypot(a.rig.root.position.x - x, a.rig.root.position.z - z) <= r) return true;
      for (const g of a.herd) if (Math.hypot(g.rig.root.position.x - x, g.rig.root.position.z - z) <= r) return true;
    }
    return false;
  }

  private protect(v: Vehicle) {
    for (const a of this.residents) {
      if (a.roof || !a.rig) continue;
      this.protectPoint(v, a.rig.root.position, a.kind === 'cow' || a.kind === 'bull' || a.kind === 'farm' ? 1.2 : a.kind === 'guardian' ? .55 : a.kind === 'bernese' || a.kind === 'retriever' ? .4 : .25);
      for (const g of a.herd) this.protectPoint(v, g.rig.root.position, g.kind === 'cow' || g.kind === 'highland' ? 1.2 : .5);
    }
  }

  private protectPoint(v: Vehicle, p: Point, radius: number) {
    if (distance(v, p) > 35) return;
    const fx = Math.sin(v.heading), fz = -Math.cos(v.heading), rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    const width = 1.05 + radius, end = 4.6 + radius;
    // Sweep the expanded car rectangle over its last step, including reverse and sideways slides.
    if (this.haveLastVehicle && distance(v, this.lastVehicle) < 20) {
      const ox = p.x - this.lastVehicle.x, oz = p.z - this.lastVehicle.z;
      const startF = ox * fx + oz * fz, startR = ox * rx + oz * rz;
      const moveX = v.x - this.lastVehicle.x, moveZ = v.z - this.lastVehicle.z;
      const df = moveX * fx + moveZ * fz, dr = moveX * rx + moveZ * rz;
      let enter = 0, leave = 1;
      if (Math.abs(df) > .00001) { const t1 = (startF - end) / df, t2 = (startF + end) / df; enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2)); }
      else if (Math.abs(startF) >= end) leave = -1;
      if (Math.abs(dr) > .00001) { const t1 = (startR - width) / dr, t2 = (startR + width) / dr; enter = Math.max(enter, Math.min(t1, t2)); leave = Math.min(leave, Math.max(t1, t2)); }
      else if (Math.abs(startR) >= width) leave = -1;
      if (enter <= leave && leave >= 0 && enter <= 1 && (Math.abs(startF) >= end || Math.abs(startR) >= width)) {
        const t = Math.max(0, enter - .001); v.place(this.lastVehicle.x + moveX * t, this.lastVehicle.z + moveZ * t, v.heading); v.speed = 0;
      }
    }
    const dx = p.x - v.x, dz = p.z - v.z, f = dx * fx + dz * fz, r = dx * rx + dz * rz;
    if (Math.abs(r) < width && Math.abs(f) < end) {
      // Prefer the nearest free edge. Door visitors remain beside the car.
      if (width - Math.abs(r) < end - Math.abs(f) && Math.abs(r) > .15) {
        const shift = (width - Math.abs(r)) * (r < 0 ? -1 : 1); v.place(v.x - rx * shift, v.z - rz * shift, v.heading);
      } else { const shift = (end - Math.abs(f)) * (f < 0 ? -1 : 1); v.place(v.x - fx * shift, v.z - fz * shift, v.heading); }
      v.speed = 0;
    }
  }
}
