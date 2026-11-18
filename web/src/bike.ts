import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR_SPEC, deepFreeze, type Rig, type VehicleSpec } from './vehicle-spec';

type P = [number, number, number];
const V = (p: P) => new THREE.Vector3(...p);
const UP = new THREE.Vector3(0, 1, 0);
/** Shared body/envelope/camera metadata; BikeRide owns the two-wheel solver. */
export const BIKE_SPEC: VehicleSpec = deepFreeze({
  ...CAR_SPEC, wheelbase: 1.48, track: 0, rearTrack: 0, wheelRadius: .356, contactPlane: 1,
  halfLength: 1.3, halfWidth: .55, height: 2.1, mass: 225,
  envelope: { circles: [-.75, -.375, 0, .375, .75], radius: .55, reach: 1.85, sweepHalfWidth: .56, sweepHalfLength: 1.31,
    overhead: 2.1, grassHalfWidth: .3, grassHalfLength: 1.45, nose: 2.2 },
  engineAcceleration: 6.4, reverseSpeed: 5, reverseAcceleration: 3, brake: 10, handbrake: 5,
  cornering: 1.35, maxSteer: .65,
  chase: { back: 5.1, height: 2.15, lookAhead: 2, lookHeight: 1.1, speedBack: .045, maxSpeedBack: 1.5 },
});
const BIKE_AXLE_HEIGHT = BIKE_SPEC.wheelRadius;
const TEAL = 0x568b87, DARK = 0x252b2d, TYRE = 0x171c1c, METAL = 0xafb8b4, CREAM = 0xe8e1c9;

/** Shader text for the head lamp's lens: its vertices carry `lampGlow` 1, and the night sets `lampLight` (black by day).
 * Both batches take the same text, so the bike and its rider still share one program. */
const LAMP_VERTEX = ['#include <common>', '#include <common>\nattribute float lampGlow;\nvarying float vLampGlow;',
  '#include <begin_vertex>', '#include <begin_vertex>\nvLampGlow = lampGlow;'] as const;
const LAMP_FRAGMENT = ['#include <common>', '#include <common>\nuniform vec3 lampLight;\nvarying float vLampGlow;',
  '#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += lampLight * vLampGlow;'] as const;
/** Each anchor must be there once: a three.js upgrade that moves one fails here, not as a dark lens or a lost bike. */
function patchLamp(source: string, [a, lineA, b, lineB]: readonly [string, string, string, string]): string {
  for (const anchor of [a, b]) if (source.split(anchor).length !== 2) throw new Error(`bike head lamp: shader anchor ${anchor} is gone`);
  return source.replace(a, lineA).replace(b, lineB);
}

/** Rigid skinning batches all materials into vertex colours: one draw for the bike, one for its rider. */
class Parts {
  constructor(private low = false) {}
  /** The lens's light (night.ts sets it on the ridden bike); shared by the batch's material. */
  readonly lampLight = new THREE.Color(0, 0, 0);
  readonly bones: THREE.Bone[] = [];
  private geometry: THREE.BufferGeometry[] = [];
  bone(name: string): THREE.Bone { const b = new THREE.Bone(); b.name = name; this.bones.push(b); return b; }
  add(b: THREE.Bone, source: THREE.BufferGeometry, colour: number, at: P = [0, 0, 0], scale: P = [1, 1, 1], rotation: P = [0, 0, 0], glow = 0): void {
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    const matrix = new THREE.Matrix4().compose(V(at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), V(scale));
    g.applyMatrix4(matrix); g.deleteAttribute('uv');
    const n = g.getAttribute('position').count, colours = new Float32Array(n * 3), indices = new Uint16Array(n * 4), weights = new Float32Array(n * 4);
    g.setAttribute('lampGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    const c = new THREE.Color(colour), index = this.bones.indexOf(b);
    for (let i = 0; i < n; i++) { colours.set([c.r, c.g, c.b], i * 3); indices[i * 4] = index; weights[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(indices, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4));
    this.geometry.push(g);
  }
  box(b: THREE.Bone, colour: number, size: P, at: P, rotation: P = [0, 0, 0]): void { this.add(b, new THREE.BoxGeometry(...size), colour, at, [1, 1, 1], rotation); }
  oval(b: THREE.Bone, colour: number, at: P, scale: P): void { this.add(b, new THREE.SphereGeometry(1, this.low ? 8 : 12, this.low ? 5 : 8), colour, at, scale); }
  rod(b: THREE.Bone, colour: number, a: P, z: P, r: number, segments = 8): void {
    const v = V(a), end = V(z), d = end.clone().sub(v), q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
    const g = new THREE.CylinderGeometry(r, r, d.length(), segments).applyQuaternion(q).translate(...v.add(end).multiplyScalar(.5).toArray());
    this.add(b, g, colour);
  }
  finish(name: string): THREE.SkinnedMesh {
    const geometry = mergeGeometries(this.geometry);
    if (!geometry) throw new Error('Bike parts must share attributes');
    for (const g of this.geometry) g.dispose(); this.geometry = [];
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .64, metalness: .18 }), lampLight = { value: this.lampLight };
    material.onBeforeCompile = shader => {
      shader.uniforms.lampLight = lampLight;
      shader.vertexShader = patchLamp(shader.vertexShader, LAMP_VERTEX);
      shader.fragmentShader = patchLamp(shader.fragmentShader, LAMP_FRAGMENT);
    };
    material.customProgramCacheKey = () => 'batched part lamp';
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.add(...this.bones); mesh.bind(new THREE.Skeleton(this.bones));
    return mesh;
  }
}

export interface BikePose {
  steer: number; spin: number; front: number; rear: number; stand: number; foot: number; dive: number;
  crash: number; ground: number; pitch: number; roll: number;
}
/** Rig names four corners: each left/right pair aliases one axle. Only BikeRide animates them. */
export interface Bike extends Rig {
  bikeMesh: THREE.SkinnedMesh;
  riderMesh: THREE.SkinnedMesh;
  triangles: number;
  drawCalls: number;
  pose(pose: BikePose): void;
}

/** An unbranded trail machine. All lengths are metres; forward is -Z, axle spacing 1.48 m. */
export function createBike(_mailTrim = true, low = false, display = false): Bike {
  const root = new THREE.Group(), body = new THREE.Group(); root.name = 'Dirt bike and rider'; root.rotation.order = 'YXZ'; root.add(body);
  const p = new Parts(low), frame = p.bone('Frame, tank, saddle and exhaust');
  const fork = p.bone('Turning upper fork and bars'), sliders = p.bone('Telescoping fork sliders');
  const swing = p.bone('Rear swingarm'), front = p.bone('Front knobby wheel'), rear = p.bone('Rear knobby wheel'), shock = p.bone('Rear shock');
  // Raised, narrow guards curve over the tyres. No badges and blank number plates.
  const guard = (b: THREE.Bone, z: number, length: number, y: number) => {
    const curve = new THREE.CatmullRomCurve3([V([0, y - .055, z - length / 2]), V([0, y + .025, z]), V([0, y - .055, z + length / 2])]);
    const shape = new THREE.Shape(); shape.moveTo(-.115, -.015); shape.lineTo(.115, -.015); shape.lineTo(.12, .015); shape.lineTo(-.12, .015); shape.closePath();
    p.add(b, new THREE.ExtrudeGeometry(shape, { steps: 12, bevelEnabled: false, extrudePath: curve }), TEAL);
  };
  guard(frame, .75, .69, .58); guard(fork, -.75, .82, .61); // full .24 m fork stroke stays below the guard
  p.oval(frame, TEAL, [0, .54, -.19], [.19, .19, .33]);
  p.oval(frame, TEAL, [0, .44, -.37], [.20, .16, .19]);
  p.oval(frame, DARK, [0, .63, .25], [.15, .065, .42]);
  for (const s of [-1, 1]) {
    p.rod(frame, DARK, [s * .10, .49, -.46], [s * .13, -.04, -.08], .027);
    p.rod(frame, DARK, [s * .13, -.04, -.08], [s * .12, .09, .35], .026);
    p.rod(frame, DARK, [s * .12, .09, .35], [s * .10, .49, -.46], .026);
    p.rod(frame, DARK, [s * .12, .09, .35], [s * .12, .54, .67], .020);
    p.box(frame, CREAM, [.035, .23, .33], [s * .165, .42, .43], [0, 0, s * -.12]);
    p.rod(frame, METAL, [s * .10, .03, .12], [s * .27, .03, .12], .026);
    p.box(frame, DARK, [.14, .035, .08], [s * .24, .025, .12]);
    for (let n = 0; n < 5; n++) p.box(frame, METAL, [.27, .015, .22], [0, .12 + n * .035, -.12]);
    p.rod(fork, METAL, [s * .10, .73, -.48], [s * .10, .08, -.69], .027);
    p.rod(sliders, DARK, [s * .10, .27, -.63], [s * .10, -.02, -.74], .039);
    p.rod(swing, METAL, [s * .11, .06, .19], [s * .12, 0, .74], .026);
  }
  p.oval(frame, METAL, [0, .015, .05], [.15, .14, .18]);
  p.rod(frame, 0x666e69, [.13, .23, -.17], [.23, .18, -.44], .032);
  p.rod(frame, 0x666e69, [.23, .18, -.44], [.22, .39, .12], .032);
  p.rod(frame, METAL, [.22, .39, .12], [.22, .49, .70], .061);
  p.rod(frame, DARK, [.22, .49, .70], [.22, .50, .76], .033);
  // A visible chain on the opposite side; two runs and toothed sprockets.
  for (const y of [-.075, .075]) p.rod(swing, 0x5e6256, [-.145, .025, .19], [-.145, y, .74], .012, 6);
  p.add(rear, new THREE.TorusGeometry(.105, .012, 4, 20), METAL, [-.15, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; p.box(rear, METAL, [.025, .025, .025], [-.15, Math.cos(a) * .108, Math.sin(a) * .108]); }
  p.rod(shock, METAL, [0, .43, .33], [0, .10, .43], .023);
  p.add(shock, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 65 }, (_, i) => {
    const a = i * Math.PI / 4; return V([.045 * Math.cos(a), .12 + i / 64 * .28, .42 - i / 64 * .08 + .045 * Math.sin(a)]);
  })), 64, .008, 4, false), 0xd0bf7c);
  // The enduro mask: a blank number plate on the fork with one small round head lamp, a dark bezel and a short visor.
  const PLATE_TILT = -.15, plate = V([0, .71, -.54]), tilt = new THREE.Euler(PLATE_TILT, 0, 0);
  /** A point on the plate's face, `up` along it from its centre and `out` in front of it. */
  const onPlate = (up: number, out: number): P => V([0, up, -.0275 - out]).applyEuler(tilt).add(plate).toArray();
  p.box(fork, CREAM, [.23, .25, .055], plate.toArray(), [PLATE_TILT, 0, 0]);
  p.add(fork, new THREE.CylinderGeometry(.064, .066, .03, low ? 12 : 20), 0x2b3231, onPlate(.035, .012), [1, 1, 1], [Math.PI / 2 + PLATE_TILT, 0, 0]);
  p.add(fork, new THREE.TorusGeometry(.058, .006, 4, low ? 12 : 20), METAL, onPlate(.035, .027), [1, 1, 1], [PLATE_TILT, 0, 0]);
  p.add(fork, new THREE.SphereGeometry(1, low ? 12 : 16, low ? 6 : 8), 0xe6ece6, onPlate(.035, .026), [.054, .054, .02], [PLATE_TILT, 0, 0], 1);
  p.box(fork, DARK, [.15, .014, .05], onPlate(.105, .022), [PLATE_TILT - .35, 0, 0]);
  p.rod(fork, DARK, [-.37, .83, -.43], [-.16, .77, -.49], .018);
  p.rod(fork, DARK, [-.16, .77, -.49], [.16, .77, -.49], .018);
  p.rod(fork, DARK, [.16, .77, -.49], [.37, .83, -.43], .018);
  for (const s of [-1, 1]) {
    p.rod(fork, TYRE, [s * .28, .81, -.45], [s * .39, .84, -.43], .027);
    p.rod(fork, METAL, [s * .32, .82, -.48], [s * .40, .82, -.48], .008);
  }
  for (const b of [front, rear]) {
    // Keep the controller tyre's shoulder footprint on the light display's ramp path.
    const tyre = new THREE.TorusGeometry(.288, .062, low ? 6 : 8, low ? 24 : 32);
    p.add(b, tyre, TYRE, [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
    p.add(b, new THREE.TorusGeometry(.235, .012, display ? 4 : 6, display ? 16 : 32), METAL, [0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
    p.rod(b, METAL, [-.11, 0, 0], [.11, 0, 0], .04);
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12;
      if (!display) p.rod(b, METAL, [i % 2 ? .04 : -.04, 0, 0], [0, Math.cos(a) * .23, Math.sin(a) * .23], .004, 4);
      for (const s of [-1, 0, 1]) p.box(b, TYRE, [.044, .026, .045], [s * .045, Math.cos(a) * .343, Math.sin(a) * .343], [a, s * .17, 0]);
    }
    p.add(b, new THREE.CylinderGeometry(.116, .116, .008, 20), 0x7d8a86, [.065, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2]);
  }
  const bikeMesh = p.finish('Batched trail bike'); body.add(bikeMesh);
  // The beam starts ahead of the front guard's tip (z -1.16) so its inverse square never burns the guard white; on the
  // fork, it turns with the bars (and the root carries the lean). Aimed by night.ts along this part's -z.
  const beam = new THREE.Object3D(); beam.name = 'Head lamp beam'; beam.position.set(0, .70, -1.22); fork.add(beam);
  const r = new Parts(low), torso = r.bone('Rider torso and helmet');
  r.oval(torso, 0x8f6344, [0, .30, -.035], [.215, .29, .14]);
  r.oval(torso, 0x9c7454, [0, .44, -.06], [.22, .15, .15]);
  r.oval(torso, DARK, [0, .02, .015], [.17, .12, .15]);
  r.oval(torso, CREAM, [0, .72, -.12], [.155, .19, .17]);
  r.oval(torso, TEAL, [0, .76, -.12], [.158, .15, .173]);
  r.box(torso, DARK, [.25, .085, .055], [0, .73, -.271]);
  r.box(torso, 0x8ea9a3, [.205, .052, .012], [0, .73, -.303]);
  r.oval(torso, CREAM, [0, .62, -.23], [.115, .055, .11]);
  r.box(torso, CREAM, [.26, .022, .22], [0, .86, -.235], [-.1, 0, 0]);
  r.box(torso, 0x343e3d, [.07, .42, .02], [0, .31, -.175]);
  const limb = (name: string, colour: number, radius: number) => {
    const b = r.bone(name); r.add(b, new THREE.CylinderGeometry(radius, radius * .85, 1, 8), colour); return b;
  };
  const legs = [-1, 1].map(s => ({ s, thigh: limb('Trouser thigh', 0x3f4c51, .085), shin: limb('Trouser shin', 0x354047, .065), boot: r.bone('Boot on peg') }));
  for (const { boot } of legs) { r.box(boot, DARK, [.13, .13, .27], [0, .035, -.07]); r.box(boot, 0xa5aaa2, [.08, .19, .08], [0, .16, .015]); r.box(boot, TYRE, [.14, .03, .28], [0, -.04, -.07]); }
  const arms = [-1, 1].map(s => ({ s, upper: limb('Jacket upper arm', 0x8f6344, .065), lower: limb('Jacket forearm', 0x9f7958, .055), hand: r.bone('Glove at grip') }));
  for (const { hand } of arms) r.oval(hand, TYRE, [0, 0, 0], [.045, .043, .062]);
  const riderMesh = r.finish('Batched helmeted rider'); body.add(riderMesh);
  const eye = new THREE.Object3D(); eye.name = 'Rider eye'; body.add(eye);
  const delta = new THREE.Vector3(), mid = new THREE.Vector3();
  const segment = (bone: THREE.Bone, a: THREE.Vector3, b: THREE.Vector3) => {
    delta.copy(b).sub(a); bone.position.copy(mid.copy(a).add(b).multiplyScalar(.5)); bone.quaternion.setFromUnitVectors(UP, delta.clone().normalize()); bone.scale.set(1, delta.length(), 1);
  };
  const steeringHead = V([0, 0, -.48]);
  const rotateSteer = (v: THREE.Vector3, steer: number) => v.sub(steeringHead).applyAxisAngle(UP, -steer).add(steeringHead);
  const tumblePoint = new THREE.Vector3();
  const keepAboveLand = (mesh: THREE.Object3D, lo: P, hi: P) => {
    let low = Infinity;
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]])
      low = Math.min(low, tumblePoint.set(x, y, z).applyEuler(mesh.rotation).y);
    mesh.position.y = Math.max(mesh.position.y, -BIKE_AXLE_HEIGHT - low);
  };
  const pose = (s: BikePose) => {
    fork.rotation.y = sliders.rotation.y = -s.steer;
    fork.position.copy(steeringHead).sub(steeringHead.clone().applyAxisAngle(UP, -s.steer));
    sliders.position.copy(fork.position); sliders.position.y = s.front; front.position.copy(rotateSteer(V([0, s.front, -.74]), s.steer));
    front.rotation.set(-s.spin, -s.steer, 0, 'YXZ');
    rear.position.set(0, s.rear, .74); rear.rotation.x = -s.spin;
    swing.rotation.x = Math.atan2(-s.rear, .55);
    const c = Math.cos(swing.rotation.x), n = Math.sin(swing.rotation.x);
    swing.position.set(0, .06 - (c * .06 - n * .19), .19 - (n * .06 + c * .19));
    shock.scale.y = 1 - s.rear * .9; shock.position.y = .43 * (1 - shock.scale.y);
    const hips = V([0, .72 + s.stand * .17 - s.dive * .05, .22 - s.stand * .1]);
    torso.position.copy(hips); torso.rotation.x = -.16 - s.stand * .18;
    for (const leg of legs) {
      const foot = V([leg.s * .24, .08, .12]);
      if (leg.s === -1) foot.set(-.32 - s.foot * .14, .08 - s.foot * .39, .12);
      const hip = hips.clone().add(V([leg.s * .13, 0, 0]));
      const knee = V([leg.s * (.23 + s.stand * .02), .40 + s.stand * .08, -.12]);
      segment(leg.thigh, hip, knee); segment(leg.shin, knee, foot.clone().add(V([0, .14, .03]))); leg.boot.position.copy(foot);
    }
    for (const arm of arms) {
      const shoulder = hips.clone().add(V([arm.s * .19, .40, -.10]));
      const hand = rotateSteer(V([arm.s * .34, .825, -.44]), s.steer);
      const elbow = shoulder.clone().lerp(hand, .48).add(V([arm.s * .09, -.11, .05]));
      segment(arm.upper, shoulder, elbow); segment(arm.lower, elbow, hand); arm.hand.position.copy(hand);
    }
    eye.position.copy(V([0, .73, -.34]).applyEuler(torso.rotation)).add(hips);
    // Both skinned batches have independent parents during a short, harmless tumble.
    if (s.crash > 0) {
      bikeMesh.rotation.set(s.crash * 3, 0, -s.crash * 2.3); bikeMesh.position.set(0, .14 + Math.sin(Math.min(1, s.crash) * Math.PI) * .5, 0);
      riderMesh.position.set(Math.sin(s.crash * 2) * .9, .4 + Math.abs(Math.sin(s.crash * 3)) * .5, -Math.sin(s.crash) * 1.1);
      riderMesh.rotation.set(-s.crash * 4, s.crash, s.crash * 2);
      keepAboveLand(bikeMesh, [-.43, -.36, -1.2], [.43, .9, 1.15]);
      keepAboveLand(riderMesh, [-.55, -.36, -.7], [.55, 1.9, .5]);
    } else { bikeMesh.position.set(0, 0, 0); riderMesh.position.set(0, 0, 0); bikeMesh.rotation.set(0, 0, 0); riderMesh.rotation.set(0, 0, 0); }
  };
  const wheelObjects = { fl: front, fr: front, rl: rear, rr: rear };
  const triangles = (bikeMesh.geometry.getAttribute('position').count + riderMesh.geometry.getAttribute('position').count) / 3;
  const bike: Bike = { root, body, bikeMesh, riderMesh, wheels: wheelObjects, steer: { fl: fork, fr: fork }, driverEye: eye,
    brakeLights: [], headlamp: { beam, lens: p.lampLight }, triangles, drawCalls: 2, pose, setRiderVisible(visible) { riderMesh.visible = visible; } };
  pose({ steer: 0, spin: 0, front: 0, rear: 0, stand: 0, foot: 1, dive: 0, crash: 0, ground: 0, pitch: 0, roll: 0 });
  return bike;
}
