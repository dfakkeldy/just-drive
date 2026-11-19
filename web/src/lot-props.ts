import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NearInstances, PARKED_COLOURS, parkedMatrix, parkedShape, pushOut, type NearKind, type ParkedType, type Placed, type Pushable, type Solid } from './parked';
import type { Terrain } from './terrain';
import type { VehicleSpec } from './vehicle-spec';
import { dogBlob } from './yard-dog';
import { Mesher } from './yard-kit';
import { dogAway, lotPropSolid, LOT_PROP_KINDS, overlapping, type Footprint, type LotProp, type LotPropKind } from './lot-props-rules';

/**
 * The lot props at houses (placed by lot-props-rules.ts): parked cars, SUVs and pickups, utility trailers,
 * motorhomes and ride-on mowers, drawn with the parked vehicles' shapes (parked.ts), and black-and-white farm dogs
 * lying or sitting, built like the yard dog (yard-dog.ts). One instanced mesh per kind, filled each frame with the ones
 * near the camera and in view. Every vehicle, trailer and mower is solid. A dog is never solid and never scores: it
 * slips away from a car that comes right up to it, and is back when the car has gone.
 */
const TYPE: Partial<Record<LotPropKind, ParkedType>> = { car: 0, suv: 1, pickup: 2, trailer: 3, motorhome: 4, mower: 5 };
/** Paint by kind, picked by the prop's tone. Trailers galvanised or black; motorhomes white or cream; mowers plain red,
 *  charcoal or white (no maker's colour scheme). Dogs keep their own coat. */
const PAINT: Record<LotPropKind, readonly number[]> = {
  car: PARKED_COLOURS, suv: PARKED_COLOURS, pickup: PARKED_COLOURS,
  trailer: [0x8d9194, 0x8d9194, 0x26272a, 0x4c4f4c], motorhome: [0xebe9e2, 0xe2dccd, 0xf2f1ec], mower: [0x962a22, 0x3a3e42, 0xd9d7d0],
  'dog-lying': [0xffffff], 'dog-sitting': [0xffffff],
};
/** Metres a kind is drawn within: on a computer, and on a phone (LOW). Past these it is a few pixels at most. */
export const LOT_PROP_RANGE: Readonly<Record<LotPropKind, readonly [number, number]>> = Object.freeze({
  car: [420, 220], suv: [420, 220], pickup: [420, 220], trailer: [280, 150], motorhome: [520, 260], mower: [200, 110],
  'dog-lying': [140, 80], 'dog-sitting': [140, 80],
});
/** Height in metres of each kind, for the view test. */
const HEIGHT: Readonly<Record<LotPropKind, number>> = { car: 1.5, suv: 1.75, pickup: 1.95, trailer: 0.9, motorhome: 3.2, mower: 1.25, 'dog-lying': 0.55, 'dog-sitting': 0.85 };
/** The ground detail a prop waits for before it is stood on it (the porch house waits for the same). */
const MIN_LEVEL = 7;

const BLACK = 0x1c1b1a, WHITE = 0xe9e5db, NOSE = 0x0d0d0d;
type Part = [colour: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw?: number];
/** A black-and-white farm dog, nose toward +x, lying with its head up and its front legs out before it. */
const LYING: Part[] = [
  [BLACK, -0.02, 0.2, 0, 0.4, 0.16, 0.19], [WHITE, 0.28, 0.23, 0, 0.16, 0.16, 0.16], [BLACK, -0.26, 0.19, 0.05, 0.2, 0.14, 0.17],
  [WHITE, 0.5, 0.055, 0.09, 0.17, 0.045, 0.045], [WHITE, 0.5, 0.055, -0.09, 0.17, 0.045, 0.045],
  [BLACK, -0.14, 0.08, 0.18, 0.18, 0.06, 0.06], [WHITE, 0.03, 0.05, 0.2, 0.07, 0.04, 0.05],
  [BLACK, 0.47, 0.38, 0, 0.12, 0.11, 0.105], [WHITE, 0.6, 0.345, 0, 0.09, 0.055, 0.062], [NOSE, 0.68, 0.36, 0, 0.026, 0.022, 0.026],
  [WHITE, 0.53, 0.45, 0, 0.08, 0.03, 0.025], [BLACK, 0.43, 0.48, 0.07, 0.04, 0.065, 0.03], [BLACK, 0.43, 0.48, -0.07, 0.04, 0.065, 0.03],
  [BLACK, -0.55, 0.06, 0.1, 0.2, 0.045, 0.05, 0.45], [WHITE, -0.7, 0.05, 0.19, 0.055, 0.035, 0.04],
];
/** The same dog sitting up, its front legs straight and its tail on the ground behind. */
const SITTING: Part[] = [
  [BLACK, -0.12, 0.17, 0, 0.2, 0.17, 0.19], [BLACK, 0, 0.37, 0, 0.16, 0.24, 0.17], [WHITE, 0.1, 0.4, 0, 0.1, 0.18, 0.13],
  [WHITE, 0.13, 0.15, 0.07, 0.04, 0.15, 0.04], [WHITE, 0.13, 0.15, -0.07, 0.04, 0.15, 0.04],
  [WHITE, 0.17, 0.025, 0.07, 0.05, 0.025, 0.04], [WHITE, 0.17, 0.025, -0.07, 0.05, 0.025, 0.04],
  [BLACK, 0, 0.045, 0.15, 0.12, 0.045, 0.05], [BLACK, 0, 0.045, -0.15, 0.12, 0.045, 0.05], [WHITE, 0.09, 0.03, 0.15, 0.05, 0.03, 0.04], [WHITE, 0.09, 0.03, -0.15, 0.05, 0.03, 0.04],
  [BLACK, 0.12, 0.66, 0, 0.11, 0.1, 0.1], [WHITE, 0.23, 0.63, 0, 0.08, 0.05, 0.06], [NOSE, 0.305, 0.645, 0, 0.024, 0.02, 0.024],
  [WHITE, 0.17, 0.72, 0, 0.07, 0.03, 0.025], [BLACK, 0.08, 0.76, 0.07, 0.035, 0.06, 0.03], [BLACK, 0.08, 0.76, -0.07, 0.035, 0.06, 0.03],
  [BLACK, -0.32, 0.035, 0.08, 0.17, 0.035, 0.045, 0.5], [WHITE, -0.46, 0.03, 0.15, 0.05, 0.03, 0.04],
];
/** One dog as a single geometry. `detail` 1 is the yard dog's own facets; 0 is a quarter of them, for a phone. */
export function farmDog(pose: 'dog-lying' | 'dog-sitting', detail: number): THREE.BufferGeometry {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const parts = (pose === 'dog-lying' ? LYING : SITTING).map(([colour, x, y, z, sx, sy, sz, yaw = 0]) =>
    dogBlob(colour, detail).applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(sx, sy, sz))));
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

interface Item extends Placed { prop: LotProp; solid: Solid | null; away: boolean }
const SOLID_CELL = 32;
const cellKey = (i: number, j: number) => (i + 0x8000) * 0x10000 + (j + 0x8000);

export class LotProps {
  readonly group = new THREE.Group();
  readonly items: Item[];
  private near: NearInstances<Item>;
  private cells = new Map<number, Solid[]>();
  private dogs: Item[];
  private material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  /** `sea`: the game's sea level; a prop never stands below it, in a brook, on a road the land knows, or on a steep bank. */
  constructor(list: readonly LotProp[], private terrain: Terrain, readonly low: boolean, private sea: number) {
    this.items = list.map((prop) => {
      const paint = PAINT[prop.kind], solid = lotPropSolid(prop.kind)
        ? { x: prop.x, z: prop.z, half: prop.half, halfWidth: prop.halfWidth, heading: prop.heading } : null;
      return { x: prop.x, z: prop.z, heading: prop.heading, colour: paint[Math.min(paint.length - 1, Math.floor(prop.tone * paint.length))], prop, solid, away: false };
    });
    for (const item of this.items) if (item.solid) {
      const key = this.key(item.x, item.z), l = this.cells.get(key);
      if (l) l.push(item.solid); else this.cells.set(key, [item.solid]);
    }
    this.dogs = this.items.filter((i) => !i.solid);
    const kinds: NearKind<Item>[] = [];
    for (const kind of LOT_PROP_KINDS) {
      const items = this.items.filter((i) => i.prop.kind === kind);
      if (!items.length) continue;
      const type = TYPE[kind];
      let geometry: THREE.BufferGeometry;
      if (type !== undefined) { const m = new Mesher(); parkedShape(m, type); geometry = m.geometry(); }
      else geometry = farmDog(kind as 'dog-lying' | 'dog-sitting', low ? 0 : 1);
      const [length, width] = [items[0].prop.half * 2, items[0].prop.halfWidth * 2];
      kinds.push({ name: kind, geometry, items, range: LOT_PROP_RANGE[kind][low ? 1 : 0], radius: Math.hypot(length, width, HEIGHT[kind]) / 2 + 0.5, lift: HEIGHT[kind] / 2,
        level: (p) => this.terrain.levelAt(p.x, p.z), pose: (p, o) => this.pose(p, o),
        ...(type === undefined ? { shown: (p: Item) => !p.away } : {}) });
    }
    this.near = new NearInstances(kinds, this.material);
    this.group.add(this.near.group);
  }

  /** One number per 32 m cell (no string made in the contact steps, which run 120 times a second). */
  private key(x: number, z: number): number { return cellKey(Math.floor(x / SOLID_CELL), Math.floor(z / SOLID_CELL)); }

  /** Stand one prop on the ground. Null when it can never stand there: it is dropped, and so is its solid. */
  private pose(item: Item, o: THREE.Object3D): boolean | null {
    if (this.terrain.levelAt(item.x, item.z) < MIN_LEVEL) return false;
    const ground = (x: number, z: number) => this.terrain.heightAt(x, z);
    if (!parkedMatrix(item, ground, o)) return false;
    const s = this.terrain.surfaceAt(item.x, item.z);
    if (s && s.level >= 8) {
      const fx = Math.sin(item.heading) * item.prop.half, fz = -Math.cos(item.heading) * item.prop.half;
      const nose = ground(item.x + fx, item.z + fz), tail = ground(item.x - fx, item.z - fz);
      const steep = nose !== null && tail !== null && Math.abs(nose - tail) > Math.max(0.6, item.prop.half * 0.45);
      if (o.position.y < this.sea + 0.4 || s.brook < 1.5 || s.roadDist < s.halfWidth + 0.8 || steep) { this.drop(item); return null; }
    }
    return true;
  }

  private drop(item: Item): void {
    if (!item.solid) return;
    const l = this.cells.get(this.key(item.x, item.z)), i = l?.indexOf(item.solid) ?? -1;
    if (l && i >= 0) l.splice(i, 1);
    item.solid = null;
  }

  /** Leave out every prop that stands on another system's footprint (the breakable yard props of mail play, which are
   *  not in every mode): it is dropped with its solid. Returns how many were left out. */
  clearOf(others: readonly Footprint[]): number {
    const gone = overlapping(this.items.map((i) => i.prop), others);
    for (const k of gone) { const item = this.items[k]; this.drop(item); this.near.remove(item); }
    return gone.length;
  }

  /** Every frame, after the camera: fill the meshes, and let a dog slip away from a car right beside it. */
  update(camera: THREE.Camera, car: { x: number; z: number; spec?: VehicleSpec }): void {
    const reach = car.spec?.envelope.reach ?? 3.4;
    for (const dog of this.dogs) {
      const d = Math.hypot(dog.x - car.x, dog.z - car.z);
      if (d < 60 || dog.away) dog.away = dogAway(dog.away, d - reach);
    }
    this.near.update(camera);
  }

  /** Keep a car out of every vehicle, trailer and mower near it. */
  resolveSolids(car: Pushable): void {
    const i0 = Math.floor(car.x / SOLID_CELL), j0 = Math.floor(car.z / SOLID_CELL);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const l = this.cells.get(cellKey(i, j));
      if (l?.length) pushOut(car, l);
    }
  }

  /** How many props were dropped: a contact revision (a dropped prop's solid is gone). */
  get dropped(): number { return this.near.dropped.size; }
  /** Solids still standing (a dropped prop has none). */
  get solids(): Solid[] { return [...this.cells.values()].flat(); }
  /** Props drawn this frame, by kind, and how many were dropped. */
  get counts(): { drawn: Record<string, number>; dropped: number; total: number } {
    const drawn: Record<string, number> = {}, c = this.near.counts;
    this.near.meshes.forEach((m, i) => { drawn[m.name || String(i)] = c[i]; });
    return { drawn, dropped: this.near.dropped.size, total: this.items.length };
  }

  dispose(): void { this.near.dispose(); this.material.dispose(); }
}
