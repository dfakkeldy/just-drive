/**
 * The Boss's car in Get Fired: the mail car itself (Blender or code car, whichever the game built), in another body
 * colour, with THE BOSS where the mail car says MABOU MAIL on the roof box, and on both doors. No siren and no police
 * lights: its signals are the amber flash of the roof box and the horn.
 *
 * Everything here changes one car that was just built, after the fact: its materials are its own (both builders give
 * each car fresh materials); the Blender car's painted geometry is shared between copies, so the Boss car repaints
 * its own copy of those meshes only.
 */
import * as THREE from 'three';
import type { Car } from './car';

/** The words, as on the mail car's sign. Invented and generic. */
export const BOSS_WORDS = 'THE BOSS';
/** Body colours tried for the Boss: car.html?boss=oxblood|bottle|mustard (add &night=1, &flash=1) puts it beside the
 * mail car. Oxblood won: far from the mail car's silver by day, and still red beside it at night, where bottle green
 * goes black and mustard turns as pale as the silver under warm light. No police car here wears it. */
export const BOSS_PAINTS: Readonly<Record<string, number>> = Object.freeze({ oxblood: 0x7c1d26, bottle: 0x1d4a35, mustard: 0xc8962a });
export const BOSS_PAINT = BOSS_PAINTS.oxblood;
/** The amber of the flash. The beacon already is amber; the roof box joins it while it flashes. */
const AMBER = 0xffa526;

/** The Blender car's body is one material with vertex colours: these (linear) are its paint, shaded a little. Trim,
 * chrome, rubber and lamps are other colours and stay. */
const isPaint = (r: number, g: number, b: number): boolean => {
  const l = (r + g + b) / 3;
  return l > .44 && l < .58 && Math.max(r, g, b) - Math.min(r, g, b) < .035;
};
const SILVER = .522;

export interface BossCar {
  /** Flash the roof box amber (and the beacon) at this time, or put it back. True while it is lit. */
  flash(on: boolean, time: number): boolean;
  readonly roof: THREE.MeshStandardMaterial;
  /** Meshes this module made or copied (the door words, repainted bodies): the caller frees them with the car. */
  readonly own: THREE.BufferGeometry[];
}

/** Turn a freshly built mail car into the Boss's car. */
export function makeBossCar(car: Car, paint = BOSS_PAINT): BossCar {
  const own: THREE.BufferGeometry[] = [];
  const target = new THREE.Color(paint);   // linear, as vertex colours are
  car.root.updateMatrixWorld(true);
  car.root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (Array.isArray(m) || m.name !== 'Body paint') return;
    if (!m.vertexColors) { m.color.copy(target); return; }
    // Its own copy of the geometry, so the mail car (the player's) keeps its silver.
    const g = mesh.geometry.clone(), c = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!c) return;
    for (let i = 0; i < c.count; i++) {
      const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
      if (!isPaint(r, gg, b)) continue;
      const shade = (r + gg + b) / 3 / SILVER;
      c.setXYZ(i, target.r * shade, target.g * shade, target.b * shade);
    }
    c.needsUpdate = true; mesh.geometry = g; own.push(g);
  });
  const roof = roofWords(car, own);
  const doors = doorWords(car);
  if (doors) own.push(doors.geometry);
  const beacon = car.beacon?.material as THREE.MeshStandardMaterial | undefined;
  const glow = { colour: roof.emissive.clone(), intensity: roof.emissiveIntensity, beacon: beacon?.emissiveIntensity ?? 0 };
  const amber = new THREE.Color(AMBER);
  let lit: boolean | null = null;
  return {
    roof, own,
    flash(on: boolean, time: number): boolean {
      // Two quick pulses a second, like a roof light on a utility truck; steady again when it stops.
      const bright = on && (time * 2.4) % 1 < .5;
      if (bright === lit) return bright;
      lit = bright;
      roof.emissive.copy(bright ? amber : glow.colour); roof.emissiveIntensity = bright ? 1.6 : glow.intensity;
      if (beacon) beacon.emissiveIntensity = bright ? 3 : glow.beacon;
      return bright;
    },
  };
}

/** The roof box gets its own material (on the code car the sign shares one with the plates and lamps) and a picture
 * that says THE BOSS. Both pictures are 1024 by 512; their sign sits in different places. */
function roofWords(car: Car, own: THREE.BufferGeometry[]): THREE.MeshStandardMaterial {
  const sign = car.signLight;
  if (!sign) throw new Error('The Boss car needs the mail car roof box');
  const shared = sign.material as THREE.MeshStandardMaterial, roof = shared.clone();
  roof.name = 'Boss roof box';
  sign.material = roof;
  // The code car's two sign faces are decals on the shared material, above the roof line, batched into one mesh with
  // the plates and lamps: those triangles move to a mesh of their own with the roof box material.
  const users: THREE.Mesh[] = [];
  car.root.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh !== sign && mesh.material === shared) users.push(mesh); });
  for (const mesh of users) own.push(...splitAbove(mesh, car.root, roof));
  const map = shared.map;
  const image = map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!map || !image?.width) return roof;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return roof;
  ctx.drawImage(image, 0, 0);
  const sx = image.width / 1024, sy = image.height / 512;
  ctx.save(); ctx.scale(sx, sy);
  if (map.flipY) {
    // The code car (car.ts): band #153e36 at 28,26; the words at 577,165, 96 px.
    ctx.fillStyle = '#153e36'; ctx.fillRect(196, 52, 778, 156);
    ctx.fillStyle = '#fff5d6'; ctx.font = 'bold 104px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(BOSS_WORDS, 585, 168, 740);
  } else {
    // The Blender car (tools/blender/car_art.py): the worded sign at 0,0, 512 by 128; its band is blue.
    ctx.fillStyle = '#153d75'; ctx.fillRect(108, 23, 381, 82);
    ctx.fillStyle = '#fff5d6'; ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(BOSS_WORDS, 300, 66, 360);
  }
  ctx.restore();
  const picture = new THREE.CanvasTexture(canvas);
  picture.colorSpace = map.colorSpace; picture.flipY = map.flipY; picture.anisotropy = map.anisotropy;
  picture.wrapS = map.wrapS; picture.wrapT = map.wrapT; picture.offset.copy(map.offset); picture.repeat.copy(map.repeat);
  picture.magFilter = map.magFilter; picture.minFilter = map.minFilter;
  roof.map = picture;
  if (roof.emissiveMap) roof.emissiveMap = picture;
  // The whole atlas, redrawn: on LOW every other part that uses it (plates, lamps) can share this material.
  roof.userData.atlas = image;
  return roof;
}

/** Give the triangles of `mesh` above the roof line (1.6 m on the car) the material `top`: all of the mesh, or a part
 * split off into a sibling mesh. The mesh gets its own geometry when it is split, so other cars keep theirs. */
const ROOF_LINE = 1.6;
function splitAbove(mesh: THREE.Mesh, root: THREE.Object3D, top: THREE.Material): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone(), p = g.getAttribute('position');
  const v = new THREE.Vector3(), up: number[] = [], down: number[] = [];
  for (let t = 0; t < p.count / 3; t++) {
    let y = 0;
    for (let k = 0; k < 3; k++) y += v.fromBufferAttribute(p, t * 3 + k).applyMatrix4(toRoot).y / 3;
    (y > ROOF_LINE ? up : down).push(t);
  }
  if (!up.length) { g.dispose(); return []; }
  if (!down.length) { g.dispose(); mesh.material = top; return []; }
  const pick = (tris: number[]): THREE.BufferGeometry => {
    const out = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(g.attributes)) {
      const src = a as THREE.BufferAttribute, n = src.itemSize, data = new Float32Array(tris.length * 3 * n);
      tris.forEach((t, i) => { for (let k = 0; k < 3 * n; k++) data[i * 3 * n + k] = src.array[t * 3 * n + k]; });
      out.setAttribute(name, new THREE.BufferAttribute(data, n, src.normalized));
    }
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  };
  const words = new THREE.Mesh(pick(up), top);
  words.name = `${mesh.name || 'part'} (roof box words)`; words.castShadow = mesh.castShadow; words.receiveShadow = mesh.receiveShadow;
  words.position.copy(mesh.position); words.quaternion.copy(mesh.quaternion); words.scale.copy(mesh.scale);
  mesh.parent?.add(words);
  mesh.geometry = pick(down); g.dispose();
  return [words.geometry, mesh.geometry];
}

/** THE BOSS along both front doors: a thin strip laid on the body found by rays, so it fits either car's shape. */
const DOOR = { z0: -.62, z1: .58, y0: .60, y1: .80, columns: 8, rows: 2, lift: .009 };
let doorPicture: THREE.CanvasTexture | null = null;
function doorWords(car: Car): THREE.Mesh | null {
  const solids: THREE.Mesh[] = [];
  car.root.traverse(o => {
    const mesh = o as THREE.Mesh, m = mesh.material as THREE.Material;
    if (mesh.isMesh && !Array.isArray(m) && !m.transparent && mesh.visible) solids.push(mesh);
  });
  const ray = new THREE.Raycaster(), from = new THREE.Vector3(), dir = new THREE.Vector3(), normal = new THREE.Vector3();
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  const inverse = new THREE.Matrix4().copy(car.body.matrixWorld).invert();
  for (const side of [1, -1]) {
    const start = positions.length / 3, cols = DOOR.columns + 1, rows = DOOR.rows + 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = r / DOOR.rows, u = c / DOOR.columns;
      // Read from beside the car, left to right: tail to nose on its right side (+x), nose to tail on its left.
      const z = side > 0 ? DOOR.z1 - (DOOR.z1 - DOOR.z0) * u : DOOR.z0 + (DOOR.z1 - DOOR.z0) * u;
      from.set(side * 3, DOOR.y0 + (DOOR.y1 - DOOR.y0) * t, z).applyMatrix4(car.root.matrixWorld);
      dir.set(-side, 0, 0).transformDirection(car.root.matrixWorld);
      ray.set(from, dir); ray.far = 3;
      const hit = ray.intersectObjects(solids, false)[0];
      if (!hit || !hit.face) { positions.length = start * 3; uvs.length = start * 2; break; }
      normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (normal.x * side < .2) normal.set(side, 0, 0).transformDirection(car.root.matrixWorld);
      const p = hit.point.clone().addScaledVector(normal, DOOR.lift).applyMatrix4(inverse);
      positions.push(p.x, p.y, p.z); uvs.push(u, t);
    }
    if (positions.length / 3 - start !== cols * rows) { positions.length = start * 3; uvs.length = start * 2; continue; }
    for (let r = 0; r < DOOR.rows; r++) for (let c = 0; c < DOOR.columns; c++) {
      const a = start + r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      if (side > 0) index.push(a, b, e, a, e, d); else index.push(a, e, b, a, d, e);
    }
  }
  if (!index.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index); geometry.computeVertexNormals();
  doorPicture ??= wordsPicture();
  const material = new THREE.MeshStandardMaterial({ map: doorPicture, alphaTest: .5, roughness: .5, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.name = 'Boss door words';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'THE BOSS door words'; mesh.castShadow = false;
  car.body.add(mesh);
  return mesh;
}
function wordsPicture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 74px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 10; ctx.strokeStyle = '#1b1a17'; ctx.strokeText(BOSS_WORDS, 256, 52, 480);
  ctx.fillStyle = '#f6eed2'; ctx.fillText(BOSS_WORDS, 256, 52, 480);
  const picture = new THREE.CanvasTexture(canvas);
  picture.colorSpace = THREE.SRGBColorSpace; picture.anisotropy = 4;
  return picture;
}

/**
 * LOW (phones): the same car in a handful of draws. Every mesh is baked into its place on the body and merged with
 * the others of its material; every plain material (paint, trim, glass, wheels) becomes one vertex-coloured mesh.
 * The mud film is left off. The roof box keeps its material, so the flash still works, and every other part painted
 * from the same atlas (plates, lamps) joins it; the door words keep theirs. The beacon and brake lamps become plain
 * paint: on a phone the roof box alone flashes. Three draws in all.
 * The wheels stop turning (their meshes are in the body); at a phone's size and distance nobody sees it.
 */
export function mergeForLow(car: Car): void {
  car.root.updateMatrixWorld(true);
  const toBody = new THREE.Matrix4().copy(car.body.matrixWorld).invert();
  const groups = new Map<THREE.Material | 'plain', THREE.Mesh[]>();
  const roof = car.signLight?.material as THREE.MeshStandardMaterial | undefined, atlas = roof?.userData.atlas as unknown;
  const meshes: THREE.Mesh[] = [];
  car.root.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && mesh.visible && !Array.isArray(mesh.material)) meshes.push(mesh); });
  for (const mesh of meshes) {
    const m = mesh.material as THREE.MeshStandardMaterial;
    // The mud film: a see-through picture over the paint (named on the Blender car, unnamed on the code car).
    if (m.name === 'Mud overlay' || (m.transparent && m.map && !m.depthWrite)) { mesh.removeFromParent(); continue; }
    const key = roof && (m === roof || (atlas && m.map?.image === atlas)) ? roof : m.map ? m : 'plain';
    const list = groups.get(key);
    if (list) list.push(mesh); else groups.set(key, [mesh]);
  }
  const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .2, side: THREE.DoubleSide });
  plain.name = 'Boss LOW body';
  const matrix = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3(), v = new THREE.Vector3(), colour = new THREE.Color();
  let sign: THREE.Mesh | null = null;
  for (const [key, list] of groups) {
    const positions: number[] = [], normals: number[] = [], colours: number[] = [], uvs: number[] = [], index: number[] = [];
    const textured = key !== 'plain' && !!(key as THREE.MeshStandardMaterial).map;
    for (const mesh of list) {
      const g = mesh.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color'), uv = g.getAttribute('uv');
      const m = mesh.material as THREE.MeshStandardMaterial, base = positions.length / 3;
      matrix.multiplyMatrices(toBody, mesh.matrixWorld); normalMatrix.getNormalMatrix(matrix);
      // Glass that is see-through on the full car is a dark, solid pane here.
      const glass = m.transparent ? .35 : 1;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(matrix); positions.push(v.x, v.y, v.z);
        if (n) { v.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize(); normals.push(v.x, v.y, v.z); } else normals.push(0, 1, 0);
        if (key === 'plain') {
          colour.copy(m.color);
          if (m.vertexColors && c) colour.multiply(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)));
          colours.push(colour.r * glass, colour.g * glass, colour.b * glass);
        } else if (c) colours.push(c.getX(i), c.getY(i), c.getZ(i));
        if (textured) uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) index.push(base + g.index.getX(i));
      else for (let i = 0; i < p.count; i++) index.push(base + i);
      mesh.removeFromParent();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    if (colours.length === positions.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    if (textured) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    const material = key === 'plain' ? plain : key;
    const merged = new THREE.Mesh(geometry, material);
    merged.name = `Boss LOW ${material.name || 'part'}`; merged.castShadow = false;
    car.body.add(merged);
    if (material === roof) sign = merged;
  }
  if (sign) car.signLight = sign;
  car.brakeLights = [];
}
