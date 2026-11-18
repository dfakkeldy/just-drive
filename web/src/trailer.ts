import * as THREE from 'three';
import { createSxs } from './sxs';
import { createBike } from './bike';
import type { Rig } from './vehicle-spec';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Dimensions are metres. The origin is the axle-group centre at ground level; forward is -Z. */
export const TRAILER_SPEC = {
  drawbar: 5.6, track: 2.28, wheelRadius: .34, axleSpacing: 1.12,
  halfLength: 4.45, halfWidth: 1.275, bodyOffset: -1.3, deckHeight: .62,
  // Collision origin is 1.3 m ahead of the axle group, halfway along the complete 8.6 m rig.
  // 0.5 m circle spacing covers the deck corners and low fenders between neighbours, as well as the tongue.
  envelope: { circles: [-3.75, -3.25, -2.75, -2.25, -1.75, -1.25, -.75, -.25, .25, .75, 1.25, 1.75, 2.25, 2.75, 3.25, 3.75], radius: 1.38, reach: 5,
    sweepHalfWidth: 1.285, sweepHalfLength: 4.46, overhead: 2.5, grassHalfWidth: 1.5, grassHalfLength: 4.6, nose: 5.3 },
  mass: 1400, loadedMass: 2300, couplerHeight: .43, jackknife: 78 * Math.PI / 180,
  // Arcade load calibration: tow gearing offsets part of the acceleration loss.
  // Brake authority and extra drag still derive from the full trailer and pickup masses.
  brakeShare: .25, dragShare: .25, driveMassShare: .7,
};
export interface CargoMount { root: THREE.Group; position: THREE.Vector3; heading: number }
export interface Trailer {
  root: THREE.Group; wheels: THREE.Group[]; ramps: THREE.Group[]; deckHeight: number;
  mounts: { sxs: CargoMount; bike: CargoMount }; tailLamps: THREE.Mesh[];
  /** Complete initial visible drawing. rigCost(root) measures its current loaded/empty state. */
  triangles: number; drawCalls: number;
  chassisCost: { triangles: number; drawCalls: number };
  cargo: { sxs: Rig; bike: ReturnType<typeof createBike> } | null;
}
type P = [number, number, number];
const black = 0x20272b, steel = 0x7d888e, rubber = 0x15191c, wood = 0x8d8065;
const shared = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .18 });
/** Colour batches preserve the independent wheel, ramp and cargo parents with one draw per parent. */
function builder(parent: THREE.Object3D, material: THREE.Material) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, color: number) => {
    const geo = g.index ? g.toNonIndexed() : g; if (geo !== g) g.dispose();
    geo.deleteAttribute('uv'); const c = new THREE.Color(color), a = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(geo);
  };
  const box = (p: P, size: P, color: number) => { const g = new THREE.BoxGeometry(...size); g.translate(...p); add(g, color); };
  const bar = (a: P, b: P, radius: number, color: number) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), d = to.clone().sub(from);
    const g = new THREE.CylinderGeometry(radius, radius, d.length(), 6); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(...from.add(to).multiplyScalar(.5).toArray() as P); add(g, color);
  };
  const tyre = (p: P, radius: number, width: number) => {
    const g = new THREE.CylinderGeometry(radius, radius, width, 24); g.rotateZ(Math.PI / 2); g.translate(...p); add(g, rubber);
    for (const sign of [-1, 1]) { const hub = new THREE.CylinderGeometry(radius * .54, radius * .54, .012, 12); hub.rotateZ(Math.PI / 2); hub.translate(p[0] + sign * (width / 2 + .007), p[1], p[2]); add(hub, steel); }
  };
  const finish = () => { const g = mergeGeometries(parts); parts.forEach(p => p.dispose()); const m = new THREE.Mesh(g, material); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  return { add, box, bar, tyre, finish };
}

/** Real removable rigs. Their controllers are made only by the explore fleet. */
export function trailerCargo(mounts: Trailer['mounts'], low = false): { sxs: Rig; bike: ReturnType<typeof createBike> } {
  const sxs = createSxs(false, { low, removableRider: true }), bike = createBike(false, low);
  sxs.setRiderVisible?.(false); bike.setRiderVisible?.(false);
  bike.pose({ steer: 0, spin: 0, front: 0, rear: 0, stand: 0, foot: 0, dive: 0, crash: 0, ground: 0, pitch: 0, roll: 0 });
  bike.root.position.y = .356;
  for (const [id, rig] of [['sxs', sxs], ['bike', bike]] as const) {
    mounts[id].root.add(rig.root);
    const straps = new THREE.Group(); straps.name = 'Cargo straps'; mounts[id].root.add(straps);
    const b = builder(straps, shared()), width = id === 'sxs' ? .60 : .21, height = id === 'sxs' ? .62 : .82;
    for (const end of [-1, 1]) for (const side of [-1, 1])
      b.bar([side * .98, .025, end * (id === 'sxs' ? 1.25 : .85)], [side * width, height, end * (id === 'sxs' ? .65 : .42)], .018, 0xe7a342);
    b.finish();
  }
  return { sxs, bike };
}
/** Visible triangles and material draws, excluding hidden riders. Shadows are a separate render pass. */
export function rigCost(root: THREE.Object3D): { triangles: number; drawCalls: number } {
  let triangles = 0, drawCalls = 0;
  root.traverseVisible(n => { if (n instanceof THREE.Mesh) {
    triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3;
    drawCalls += Array.isArray(n.material) ? n.geometry.groups.length : 1;
  } });
  return { triangles, drawCalls };
}

export function createTrailer(loaded = true, low = false): Trailer {
  const root = new THREE.Group(); root.name = 'Tandem flat trailer'; root.rotation.order = 'YXZ';
  const mat = shared(), m = builder(root, mat), wheels: THREE.Group[] = [], ramps: THREE.Group[] = [];
  for (const x of [-.94, .94]) m.box([x, .48, -.5], [.14, .22, 7.0], black);
  for (let z = -4; z <= 3; z += .7) m.box([0, .48, z], [2.1, .14, .08], black);
  for (let i = 0; i < 12; i++) m.box([-.958 + i * .174, .585, -.5], [.167, .07, 6.98], i % 3 ? wood : 0xa09275);
  for (const x of [-1, 1]) {
    m.bar([0, .43, -5.6], [x, .48, -3.3], .075, black);
    m.box([x, .79, -3.96], [.045, .35, .06], black);
    for (let z = -3.7; z < 3; z += .95) {
      m.box([x * 1.06, .51, z], [.08, .17, .12], steel);
      const ring = new THREE.TorusGeometry(.045, .009, 5, 10); ring.rotateX(Math.PI / 2); ring.translate(x * .98, .635, z); m.add(ring, steel);
    }
    // Low fenders have a flat tread top and sloping ends, all in the frame batch.
    m.box([x * 1.15, .76, 0], [.25, .045, 2.05], black);
    for (const z of [-1.17, 1.17]) m.bar([x * 1.15, .48, z], [x * 1.15, .76, z * .84], .12, black);
    for (const z of [-3.8, -1.6, 1.7, 2.85]) m.box([x * 1.08, .53, z], [.025, .06, .11], 0xffa52c);
    // Safety chain links arc below the tongue rather than a rigid diagonal rod.
    for (let i = 0; i < 9; i++) {
      const t = i / 8, g = new THREE.TorusGeometry(.038, .008, 4, 8); if (i % 2) g.rotateY(Math.PI / 2);
      g.translate(x * (.10 + .20 * t), .40 - .14 * Math.sin(t * Math.PI), -5.5 + t * .8); m.add(g, steel);
    }
  }
  m.bar([-1, .97, -3.96], [1, .97, -3.96], .026, black);
  m.box([0, .47, -5.48], [.19, .14, .33], steel); m.box([0, .58, -5.42], [.06, .05, .21], steel);
  m.box([.28, .52, -4.85], [.08, .50, .08], steel); m.box([.28, .27, -4.85], [.24, .035, .18], black);
  m.bar([.28, .79, -4.85], [.48, .79, -4.85], .015, steel);
  m.box([0, .69, -4.25], [.98, .38, .47], black); m.box([0, .895, -4.25], [1.02, .035, .49], steel);
  m.box([0, .80, -4.497], [.11, .055, .016], steel);
  for (const z of [-.56, .56]) {
    m.bar([-1.14, .34, z], [1.14, .34, z], .045, black);
    for (const x of [-.8, .8]) for (let i = 0; i < 3; i++) m.box([x, .26 + i * .025, z], [.07, .018, .95 - i * .14], steel);
    for (const x of [-1.14, 1.14]) {
      const pivot = new THREE.Group(); pivot.position.set(x, .34, z); pivot.name = 'Trailer wheel spin X'; root.add(pivot);
      const w = builder(pivot, mat); w.tyre([0, 0, 0], .34, .23); w.finish(); wheels.push(pivot);
    }
  }
  for (const x of [-.53, .53]) {
    const pivot = new THREE.Group(); pivot.name = loaded ? 'Ramp gate hinge X, lower toward the rear' : 'Ramp gate hinge X, lower with negative rotation'; pivot.position.set(x, .62, 3.0); root.add(pivot);
    const r = builder(pivot, mat);
    for (const a of [-.49, .49]) r.box([a, .64, 0], [.06, 1.28, .10], black);
    for (const y of [.02, 1.25]) r.box([0, y, 0], [1.02, .06, .10], black);
    // Clipped diagonal flat webs leave real diamond holes, with thickness and a second depth plane.
    for (const slope of [-.9, .9]) for (let intercept = -.45; intercept < 1.8; intercept += .14) {
      const points: [number, number][] = [];
      for (const x of [-.45, .45]) { const y = slope * x + intercept; if (y >= .08 && y <= 1.21) points.push([x, y]); }
      for (const y of [.08, 1.21]) { const x = (y - intercept) / slope; if (x > -.45 && x < .45) points.push([x, y]); }
      if (points.length !== 2) continue;
      const [a, b] = points, dx = b[0] - a[0], dy = b[1] - a[1];
      const g = new THREE.BoxGeometry(Math.hypot(dx, dy), .012, .024); g.rotateZ(Math.atan2(dy, dx));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, slope * .009); r.add(g, steel);
    }
    // Stiffeners sit behind the rolling face; a raised rib would leave a tyre shoulder unsupported.
    for (const a of [-.23, .23]) r.box([a, .64, loaded ? .009 : -.035], [.035, 1.16, .06], black);
    // Flat wheel tracks bridge the mesh webs, so both tread shoulders have a continuous rolling face.
    if (loaded) { r.box([Math.sign(x) * .215, .64, -.058], [.40, 1.22, .014], steel);
      r.box([-Math.sign(x) * .465, .64, -.058], [.09, 1.22, .014], steel); }
    r.box([.42, 1.17, .065], [.06, .13, .04], steel);
    r.finish(); ramps.push(pivot);
    m.bar([x, .59, 2.97], [x, .59, 3.08], .04, steel);
  }
  m.box([0, .44, 3.05], [2.2, .24, .12], black); m.box([0, .46, 3.119], [.36, .15, .015], 0xc1c7c8);
  // Rear wheel chock is separate from removable cargo.
  for (const x of [-.11, .11]) m.box([x, .71, loaded ? .91 : 1.08], [.035, .18, .43], black);
  m.finish();
  const red = new THREE.MeshStandardMaterial({ color: 0x9d1721, emissive: 0xf92724, emissiveIntensity: .3, roughness: .3 });
  const lamps = builder(root, red); for (const x of [-.88, .88]) lamps.box([x, .46, 3.125], [.25, .105, .018], 0xffffff);
  const tailLamps = [lamps.finish()];
  const mount = (name: string, z: number): CargoMount => { const g = new THREE.Group(); g.name = name; g.position.set(0, .62, z); root.add(g); return { root: g, position: g.position, heading: 0 }; };
  const mounts = { sxs: mount('Front cargo mount', -2.0), bike: mount('Rear cargo mount', loaded ? 1.65 : 1.85) };
  let triangles = 0, drawCalls = 0;
  root.traverse(n => { if (n instanceof THREE.Mesh) { triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3; drawCalls++; } });
  const cargo = loaded ? trailerCargo(mounts, low) : null;
  const chassisCost = { triangles, drawCalls }, cost = rigCost(root);
  return { root, wheels, ramps, deckHeight: .62, mounts, tailLamps, ...cost, chassisCost, cargo };
}
