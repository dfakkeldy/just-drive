import * as THREE from 'three';
import type { Roads } from './roads';
import type { Terrain } from './terrain';
import { SIGNAL_JUNCTIONS, signalLamp, signalStopDistance, type SignalStop } from './traffic-signal-rules';

const LAMP_NAMES = ['red', 'amber', 'green'] as const;
const LAMP_COLOURS = [0xff3020, 0xffb820, 0x28ff70] as const;
const LAMP_OFF = 0x080a08;

/** Heads within this distance of the camera take their ground height. */
export const GROUND_RANGE = 800;
/** Beyond this distance from every head the group is hidden (lamps 0.29 m across are sub-pixel there). */
export const DRAW_RANGE = 1000;
/** Fourteen heads, five instanced draws total; no lights, shadows, textures or per-frame mesh creation. */
export class TrafficSignals {
  readonly group = new THREE.Group();
  readonly stops: SignalStop[] = [];
  private seconds = 0;
  private heads: { stop: SignalStop; x: number; z: number; heading: number; y: number | null }[] = [];
  private poles: THREE.InstancedMesh;
  private housings: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh[];
  private pose = new THREE.Object3D();
  private color = new THREE.Color();
  /** The lamp each head showed last; compared in place each frame, so the frame allocates nothing. */
  private lastLamp: string[] = [];
  private groundTick = 0;
  constructor(area: string, village: readonly [number, number], roads: Roads, private terrain: Terrain, historical: boolean) {
    this.group.name = 'Evidence placed traffic signals';
    if (!historical) for (const junction of SIGNAL_JUNCTIONS) {
      if (junction.area !== area) continue;
      const cx = junction.east - village[0], cz = village[1] - junction.north;
      for (const approach of junction.approaches) {
        const dx = Math.sin(approach.heading), dz = Math.cos(approach.heading);
        const hit = roads.nearest(cx + dx * 18, cz + dz * 18, 12, r => r.name === approach.road);
        if (!hit) continue; // Never invent a pole when its mapped road is absent.
        const stop: SignalStop = { x: hit.x + dx * 6, z: hit.z + dz * 6, dx, dz,
          halfWidth: hit.road.halfWidth, phase: approach.phase, junction };
        this.stops.push(stop);
        const shoulder = hit.road.halfWidth + 1.2;
        this.heads.push({ stop, x: hit.x + dz * shoulder, z: hit.z - dx * shoulder, heading: approach.heading, y: null });
      }
    }
    const count = this.heads.length;
    this.poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.075, 0.11, 4.7, 6), new THREE.MeshLambertMaterial({ color: 0x858b89 }), count);
    this.housings = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 1.15, 0.24), new THREE.MeshLambertMaterial({ color: 0x242622 }), count);
    // Basic materials remain visible at night. Instance colours switch only on phase changes.
    this.lamps = [0xff3020, 0xffb820, 0x28ff70].map(() => new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.145, 10), new THREE.MeshBasicMaterial({ toneMapped: false }), count));
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const mesh of [this.poles, this.housings, ...this.lamps]) {
      mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
      for (let i = 0; i < count; i++) mesh.setMatrixAt(i, hidden);
      this.group.add(mesh);
    }
    this.group.visible = count > 0;
  }
  /** The signals for one area and era, or null when no sourced approach matches a baked road there. */
  static forArea(area: string, village: readonly [number, number], roads: Roads, terrain: Terrain, historical: boolean): TrafficSignals | null {
    const signals = new TrafficSignals(area, village, roads, terrain, historical);
    return signals.stops.length ? signals : null;
  }
  /** Wire ambient traffic to this method. Uses the same clock and phases as the visible heads. */
  stopDistance(x: number, z: number, forwardX: number, forwardZ: number): number {
    return signalStopDistance(this.stops, this.seconds, x, z, forwardX, forwardZ);
  }
  update(dt: number, focus: THREE.Vector3, realDt = dt): void {
    if (!this.heads.length) return;
    this.seconds += Math.max(0, dt);
    // At most 14 existing terrain queries twice a second, only near the player; the draw cull shares the tick.
    this.groundTick -= Math.max(0, realDt);
    if (this.groundTick <= 0) {
      this.groundTick = 0.5;
      let changed = false, nearest = Infinity;
      this.heads.forEach((h, i) => {
        const distance = Math.hypot(h.x - focus.x, h.z - focus.z);
        nearest = Math.min(nearest, distance);
        if (distance > GROUND_RANGE) return;
        const y = this.terrain.heightAt(h.x, h.z);
        if (y === null || y === h.y) return;
        h.y = y; changed = true;
        this.pose.rotation.set(0, 0, 0); this.pose.position.set(h.x, y + 2.35, h.z); this.pose.updateMatrix();
        this.poles.setMatrixAt(i, this.pose.matrix);
        this.pose.rotation.y = h.heading; this.pose.position.y = y + 4.15; this.pose.updateMatrix();
        this.housings.setMatrixAt(i, this.pose.matrix);
        this.lamps.forEach((mesh, lamp) => {
          this.pose.position.set(h.x + h.stop.dx * 0.126, y + 4.49 - lamp * 0.34, h.z + h.stop.dz * 0.126);
          this.pose.updateMatrix(); mesh.setMatrixAt(i, this.pose.matrix);
        });
      });
      if (changed) for (const mesh of [this.poles, this.housings, ...this.lamps]) mesh.instanceMatrix.needsUpdate = true;
      // The meshes are not frustum culled, so far from every junction the group itself goes: no draws.
      this.group.visible = nearest <= DRAW_RANGE;
    }
    let lit = false;
    for (let i = 0; i < this.heads.length; i++) {
      const h = this.heads[i];
      const active = signalLamp(this.seconds, h.stop.junction.offset, h.stop.phase);
      if (this.lastLamp[i] === active) continue;
      this.lastLamp[i] = active; lit = true;
      for (let lamp = 0; lamp < this.lamps.length; lamp++) {
        this.color.setHex(LAMP_NAMES[lamp] === active ? LAMP_COLOURS[lamp] : LAMP_OFF);
        this.lamps[lamp].setColorAt(i, this.color);
      }
    }
    if (!lit) return;
    for (const mesh of this.lamps) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
