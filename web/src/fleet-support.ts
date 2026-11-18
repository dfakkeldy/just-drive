import * as THREE from 'three';
import type { Bike } from './bike';
import { movement as fleetMove } from './fleet-motion';
import type { Rig, VehicleSpec } from './vehicle-spec';

export type Ground = (x: number, z: number) => number | null;
export interface FleetPose {
  x: number; z: number; y: number; heading: number; pitch: number; roll: number;
  travel: number[];
  spin?: number;
  samples?: { x: number; z: number; height: number }[];
}
const neutral = { steer: 0, spin: 0, front: 0, rear: 0, stand: 0, foot: 0, dive: 0, crash: 0, ground: 0, pitch: 0, roll: 0 };
export const isBikeRig = (rig: Rig): rig is Bike => 'bikeMesh' in rig;

/** Prepared once from the real tread geometry. No vertex scans or ground reads in the parked drawing path. */
export class FleetSupport {
  private readonly wheels: THREE.Object3D[];
  private readonly treads: THREE.Vector3[][] = [];
  private readonly point = new THREE.Vector3();
  constructor(readonly rig: Rig, readonly spec: VehicleSpec) {
    const wheels = this.wheels = [...new Set([...Object.values(rig.wheels), ...(rig.extraWheels ?? [])])];
    rig.root.updateMatrixWorld(true);
    if (isBikeRig(rig)) rig.bikeMesh.skeleton.update();
    for (const wheel of wheels) {
      const vertices: THREE.Vector3[] = [], inverse = wheel.matrixWorld.clone().invert(), seen = new Set<string>();
      const read = (mesh: THREE.Mesh, onlyBone = -1) => {
        const p = mesh.geometry.attributes.position, skin = mesh.geometry.attributes.skinIndex;
        for (let i = 0; i < p.count; i++) {
          if (onlyBone >= 0 && skin.getX(i) !== onlyBone) continue;
          mesh.getVertexPosition(i, this.point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
          if (Math.abs(Math.hypot(this.point.y, this.point.z) - spec.wheelRadius) > .012) continue;
          const key = this.point.toArray().map(n => n.toFixed(5)).join(',');
          if (!seen.has(key)) { seen.add(key); vertices.push(this.point.clone()); }
        }
      };
      if (isBikeRig(rig)) read(rig.bikeMesh, rig.bikeMesh.skeleton.bones.indexOf(wheel as THREE.Bone));
      else wheel.traverse(n => { if (n instanceof THREE.Mesh) read(n); });
      if (!vertices.length) throw new Error('Cargo tread geometry is missing');
      this.treads.push(vertices);
    }
  }

  draw(p: FleetPose): void {
    const rig = this.rig, bike = isBikeRig(rig);
    rig.root.position.set(p.x, p.y + (bike ? this.spec.wheelRadius : 0), p.z);
    rig.root.rotation.set(p.pitch, -p.heading, p.roll, 'YXZ');
    rig.body.position.set(0, 0, 0); rig.body.rotation.set(0, 0, 0);
    if (bike) rig.pose({ ...neutral, spin: p.spin ?? 0, front: p.travel[0], rear: p.travel[2] });
    else {
      rig.steer.fl.rotation.y = rig.steer.fr.rotation.y = 0;
      for (let i = 0; i < this.wheels.length; i++) {
        this.wheels[i].rotation.x = -(p.spin ?? 0);
        if (!rig.setTravel) this.wheels[i].parent!.position.y = p.travel[i] ?? 0;
      }
      rig.setTravel?.(p.travel[0], p.travel[1], p.travel[2], p.travel[3]);
    }
    rig.root.updateMatrixWorld(true);
    if (bike) rig.bikeMesh.skeleton.update();
  }

  /** Fit every tread to support. Called for a script plan or a land-change event, never for a sleeping rig. */
  fit(x: number, z: number, heading: number, ground: Ground, spin = 0, rollHint?: number, inspect?: () => void): FleetPose | null {
    const undoModel = this.rig.checkpointPose?.();
    return fleetMove({ roots: [this.rig.root], query: () => { try { this.rig.root.removeFromParent(); const pose = this.fitTrial(x, z, heading, ground, spin, rollHint); if (pose) inspect?.(); return pose; } finally { undoModel?.(); } } });
  }
  private fitTrial(x: number, z: number, heading: number, ground: Ground, spin: number, rollHint?: number): FleetPose | null {
    const fx = Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = Math.sin(heading);
    const half = this.spec.wheelbase / 2, trackWidth = Math.max(this.spec.track, .2), track = this.wheels.length === 2 && rollHint !== undefined ? 0 : trackWidth / 2;
    const heights = [ground(x + fx * half - rx * track, z + fz * half - rz * track),
      ground(x + fx * half + rx * track, z + fz * half + rz * track),
      ground(x - fx * half - rx * track, z - fz * half - rz * track),
      ground(x - fx * half + rx * track, z - fz * half + rz * track)];
    if (heights.some(h => h === null)) return null;
    const [fl, fr, rl, rr] = heights as number[];
    const pitch = Math.atan2((fl + fr - rl - rr) / 2, this.spec.wheelbase);
    const roll = rollHint ?? Math.atan2((fr + rr - fl - rl) / 2, trackWidth);
    const p: FleetPose = { x, z, heading, y: (fl + fr + rl + rr) / 4, pitch, roll, travel: [0, 0, 0, 0], spin };
    p.samples = heights.map((height, i) => {
      const along = i < 2 ? half : -half, side = i % 2 ? track : -track;
      return { x: x + fx * along + rx * side, z: z + fz * along + rz * side, height: height! };
    });
    const wheels = this.wheels, up = new THREE.Vector3();
    while (p.travel.length < wheels.length) p.travel.push(0);
    this.draw(p);
    for (let pass = 0; pass < 6; pass++) {
      up.set(0, 1, 0).transformDirection(this.rig.root.matrixWorld);
      const lifts: number[] = [], centre = new THREE.Vector3();
      for (let i = 0; i < wheels.length; i++) {
        let lift = -Infinity; wheels[i].getWorldPosition(centre);
        for (const tread of this.treads[i]) {
          this.point.copy(tread).applyMatrix4(wheels[i].matrixWorld);
          if (this.point.y > centre.y - this.spec.wheelRadius * .65) continue;
          const h = ground(this.point.x, this.point.z); if (h === null) return null;
          lift = Math.max(lift, (h - this.point.y) / up.y);
        }
        lifts.push(lift);
      }
      // Move the sprung body with the axle planes before using the small suspension range.
      const front = wheels.length === 2 ? lifts[0] : (lifts[0] + lifts[1]) / 2;
      const rear = wheels.length === 2 ? lifts[1] : (lifts[2] + lifts[3]) / 2;
      if (pass < 5) {
        p.y += (front + rear) / 2 * up.y;
        p.pitch += Math.atan2(front - rear, this.spec.wheelbase) * .8;
        if (wheels.length > 2) p.roll += Math.atan2((lifts[1] + lifts[3] - lifts[0] - lifts[2]) / 2, this.spec.track) * .8;
      } else for (let i = 0; i < wheels.length; i++) {
        const index = wheels.length === 2 ? i * 2 : i; p.travel[index] += lifts[i];
        if (wheels.length === 2) p.travel[index + 1] = p.travel[index];
      }
      this.draw(p);
    }
    return p;
  }
  /** Endpoint check against current drawn support, including each shoulder of a carried ramp tyre. */
  isSupported(ground: Ground, tolerance = .04): boolean {
    this.rig.root.updateMatrixWorld(true);
    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i], centre = wheel.getWorldPosition(new THREE.Vector3()), gaps = [Infinity, Infinity];
      for (const tread of this.treads[i]) {
        this.point.copy(tread).applyMatrix4(wheel.matrixWorld); if (this.point.y > centre.y + .001) continue;
        const height = ground(this.point.x, this.point.z); if (height === null) return false;
        const gap = this.point.y - height; if (gap < -tolerance) return false;
        const side = tread.x < 0 ? 0 : 1; gaps[side] = Math.min(gaps[side], gap);
      }
      if (gaps.some(gap => !Number.isFinite(gap) || gap > tolerance)) return false;
    }
    return true;
  }
  wake(): void {
    if (!this.rig.setTravel && !isBikeRig(this.rig)) for (const wheel of this.wheels) wheel.parent!.position.y = 0;
  }
}
