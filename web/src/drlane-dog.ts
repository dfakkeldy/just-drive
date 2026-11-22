import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DrLaneDogRules } from './drlane-dog-rules';
import { seeded } from './yard-kit';
import { dogBlob } from './yard-dog';

/**
 * The white dog at the house on D.R.'s Lane: a medium dog with a curly coat, of the doodle or poodle kind, that rests and
 * walks about the drive and the lawn (drlane-dog-rules.ts). It is made like the yard dog (yard-dog.ts): rounded parts of
 * flat facets, with small curls on the coat. No downloaded model, image or recording, and no name. Never solid.
 * Local forward is -z; its origin is on the ground.
 */
const COAT = 0xefebe2, SHADOW = 0xd9d3c6, DARK = 0x1d1b1a, TONGUE = 0xc77977;
/** The parts below are drawn for a dog a little larger than this one: about 55 cm at the shoulder after the scale. */
const SIZE = 0.82;
type Pivot = 'body' | 'head' | 'tail' | 'leg0' | 'leg1' | 'leg2' | 'leg3';

export class DrLaneDog {
  readonly group = new THREE.Group();
  readonly rules: DrLaneDogRules;
  private head = new THREE.Group(); private tail = new THREE.Group(); private legs: THREE.Group[] = [];
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private time = 0;
  triangles = 0;

  constructor(low: boolean) {
    this.rules = new DrLaneDogRules(seeded(5));
    this.build(low ? 0 : 1, low ? 10 : 34);
    this.group.scale.setScalar(SIZE);
  }

  private build(detail: number, curls: number): void {
    const rnd = seeded(11), parts = new Map<Pivot, THREE.BufferGeometry[]>();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const add = (at: Pivot, colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, tilt = 0, d = detail) => {
      const g = dogBlob(colour, d).applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(tilt, 0, 0)), new THREE.Vector3(sx, sy, sz)));
      parts.set(at, [...(parts.get(at) ?? []), g]);
    };
    // A rounded, fluffy body a little higher at the shoulder, and a deep chest.
    add('body', COAT, 0, 0.56, 0.04, 0.2, 0.22, 0.4);
    add('body', COAT, 0, 0.58, -0.24, 0.18, 0.2, 0.18);
    add('body', SHADOW, 0, 0.42, 0.0, 0.15, 0.1, 0.3);
    // Curls all over the coat: small knots that stand out from the outline.
    for (let i = 0; i < curls; i++) {
      const a = rnd() * Math.PI * 2, z = -0.36 + rnd() * 0.72, r = 0.035 + rnd() * 0.025;
      add('body', rnd() < 0.3 ? SHADOW : COAT, Math.cos(a) * 0.17, 0.56 + Math.sin(a) * 0.18, z, r, r, r, 0, 0);
    }
    // Four legs, thick with coat, each from its own hip or shoulder.
    for (let i = 0; i < 4; i++) {
      const leg: Pivot = `leg${i}` as Pivot;
      add(leg, COAT, 0, -0.2, 0, 0.075, 0.24, 0.08);
      add(leg, SHADOW, 0, -0.44, -0.02, 0.07, 0.04, 0.09);
    }
    // The head: a round curly top, a long muzzle, soft ears that hang, dark eyes and a black nose.
    add('head', COAT, 0, 0, 0, 0.15, 0.15, 0.15);
    add('head', COAT, 0, 0.1, 0.02, 0.12, 0.08, 0.12);
    add('head', COAT, 0, -0.05, -0.16, 0.08, 0.075, 0.13);
    add('head', DARK, 0, -0.03, -0.29, 0.032, 0.026, 0.024);
    add('head', TONGUE, 0, -0.1, -0.2, 0.03, 0.012, 0.04);
    for (const s of [-1, 1]) {
      add('head', SHADOW, s * 0.14, -0.08, 0.02, 0.06, 0.15, 0.08, 0.1);
      add('head', DARK, s * 0.06, 0.03, -0.13, 0.02, 0.02, 0.015);
    }
    // The tail: a plume that curls up over the back.
    add('tail', COAT, 0, 0.1, 0.05, 0.06, 0.12, 0.06, -0.5);
    add('tail', COAT, 0, 0.21, 0.02, 0.07, 0.07, 0.07);

    const pivot = (name: Pivot): THREE.Group => {
      const g = name === 'body' ? new THREE.Group() : name === 'head' ? this.head : name === 'tail' ? this.tail : new THREE.Group();
      const geos = parts.get(name)!, merged = mergeGeometries(geos);
      for (const p of geos) p.dispose();
      if (merged) { g.add(new THREE.Mesh(merged, this.material)); this.triangles += merged.attributes.position.count / 3; }
      return g;
    };
    const body = pivot('body');
    this.group.add(body);
    body.add(pivot('head')); this.head.position.set(0, 0.86, -0.34);
    body.add(pivot('tail')); this.tail.position.set(0, 0.66, 0.4);
    for (let i = 0; i < 4; i++) {
      const leg = pivot(`leg${i}` as Pivot);
      leg.position.set((i % 2 ? 1 : -1) * 0.12, 0.47, i < 2 ? -0.26 : 0.3);
      body.add(leg); this.legs.push(leg);
    }
  }

  /** Stand the dog where its rules put it, in the house's frame, on `ground`; walk the legs and wag the tail. */
  pose(dt: number, ground: number): void {
    const r = this.rules;
    this.time += dt;
    this.group.visible = !r.away;
    this.group.position.set(r.u, ground, r.v);
    this.group.rotation.y = Math.atan2(-r.fu, -r.fv);
    for (let i = 0; i < this.legs.length; i++) this.legs[i].rotation.x = r.moving ? Math.sin(this.time * 9 + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.5 : 0;
    this.tail.rotation.y = Math.sin(this.time * (r.moving ? 7 : 3)) * 0.3;
    this.head.rotation.x = r.moving ? 0.1 : -0.05;
  }

  dispose(): void { this.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); this.material.dispose(); }
}
