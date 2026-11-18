import * as THREE from 'three';
import type { Solid } from './parked';
import { Mesher, type RGB } from './yard-kit';

/**
 * A precast concrete arch culvert, assembled from units, that a car can drive through from end to end.
 * It can stand anywhere on the map: give it a world position, the compass heading of its axis and a number of units.
 *
 *   const culvert = new ArchCulvert(x, z, heading, 8, (x, z) => terrain.heightAt(x, z));
 *   scene.add(culvert.group);
 *   // each frame until it returns true:  culvert.seat();
 *   // each frame, to keep the car out of the walls:  pushOut(vehicle, culvert.solids);
 *
 * Proportions: about 9.1 m clear between the legs, 4.1 m clear at the crown, units about 1.8 m long, on strip footings.
 */
export class ArchCulvert {
  readonly group = new THREE.Group();
  /** The two walls, for `pushOut` in parked.ts. The opening between them is free. */
  readonly solids: Solid[] = [];
  /** Length of the run in metres. */
  readonly length: number;
  static readonly UNIT = 1.825;
  static readonly CLEAR_SPAN = 9.144;
  /** Leg depth below the invert (model units) for a stream arch: its legs reach down a bank that falls away. */
  static readonly STREAM_DEEP = -6;

  constructor(readonly x: number, readonly z: number, readonly heading: number, readonly units: number,
    private ground: (x: number, z: number) => number | null, low = false, streamBed = false) {
    const PRECAST: RGB = [0.60, 0.58, 0.54], FOOTING: RGB = [0.50, 0.49, 0.45];
    const m = new Mesher(), n = low ? 6 : 9, outer = 4.822, inner = ArchCulvert.CLEAR_SPAN / 2, leg = 0.9, deep = streamBed ? ArchCulvert.STREAM_DEEP : -1.6;
    const out: number[][] = [[outer, deep], [outer, leg]], inn: number[][] = [];
    for (let i = 1; i < n; i++) { const t = (i / n) * Math.PI; out.push([outer * Math.cos(t), leg + 3.45 * Math.sin(t)]); inn.push([inner * Math.cos(Math.PI - t), leg + 3.2 * Math.sin(t)]); }
    const profile = [...out, [-outer, leg], [-outer, deep], [-inner, deep], [-inner, leg], ...inn, [inner, leg], [inner, deep]];
    this.length = units * ArchCulvert.UNIT;
    // Local z runs along the culvert; each unit is its own casting, a shade apart, with a joint between.
    for (let i = 0; i < units; i++) {
      const z0 = -this.length / 2 + i * ArchCulvert.UNIT;
      m.at(0, 0, 0);
      m.extrude(profile, z0 + 0.012, z0 + ArchCulvert.UNIT - 0.012, [PRECAST[0] * (0.93 + (i % 3) * 0.045), PRECAST[1] * (0.93 + (i % 3) * 0.045), PRECAST[2] * (0.93 + (i % 3) * 0.045)]);
    }
    // Strip footings, mostly buried. A stream arch has none: they ran past its mouths and stood proud of a low bank.
    if (!streamBed) for (const s of [-1, 1]) m.box(s * (outer - 0.1), -0.55, 0, 2.7, 1.5, this.length + 0.6, FOOTING);
    const mesh = new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.group.add(mesh);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = -heading;   // local -z points along the heading; the run is the same both ways
    this.group.visible = false;
    const rx = Math.cos(heading), rz = Math.sin(heading), mid = (outer + inner) / 2;
    for (const s of [-1, 1]) this.solids.push({ x: x + rx * s * mid, z: z + rz * s * mid, half: this.length / 2, halfWidth: (outer - inner) / 2 + 0.05, heading });
  }

  /** Stand it on the ground, at the height of its lowest end so both mouths meet the land. False while ground is missing. */
  seat(): boolean {
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), h = this.length / 2;
    const a = this.ground(this.x + fx * h, this.z + fz * h), b = this.ground(this.x - fx * h, this.z - fz * h), c = this.ground(this.x, this.z);
    if (a === null || b === null || c === null) return false;
    this.group.position.y = Math.min(a, b, c);
    this.group.visible = true;
    return true;
  }
}
