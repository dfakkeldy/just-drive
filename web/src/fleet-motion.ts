import * as THREE from 'three';
import { CAR_SPEC, type VehicleSpec } from './vehicle-spec';
import { type ContactBody } from './parked';
import type { WorldContacts } from './world-contacts';
import { checkpoint } from './fleet-checkpoint';

export interface SweepPose extends ContactBody { pitch?: number; roll?: number; quaternion?: THREE.Quaternion }
export interface BodySweep {
  from: SweepPose; to: SweepPose;
  clear(pose: SweepPose, progress: number): boolean;
  geometry?(pose: SweepPose): boolean;
}
export interface GateSweep {
  root: THREE.Object3D; from: number; to: number;
  parentFrom?: THREE.Matrix4; parentTo?: THREE.Matrix4;
}
interface Move {
  bodies?: BodySweep[]; gates?: GateSweep[];
  contacts?: WorldContacts; obstacles?: readonly ContactBody[];
  commit(): void;
}
interface Proposal { propose(): Move; rollback(): void }
interface Query<T> { query(): T; roots: THREE.Object3D[]; objects?: object[] }
const turn = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));

export function boxTouchesBody(box: THREE.Box3, body: ContactBody): boolean {
  if (box.max.y < body.y || box.min.y > body.y + body.spec.height) return false;
  const e = body.spec.envelope;
  for (let i = 0; i < e.circles.length; i++) {
    const side = e.circleSides?.[i] ?? 0, x = body.x + Math.sin(body.heading) * e.circles[i] + Math.cos(body.heading) * side;
    const z = body.z - Math.cos(body.heading) * e.circles[i] + Math.sin(body.heading) * side;
    if (Math.hypot(Math.max(box.min.x - x, 0, x - box.max.x), Math.max(box.min.z - z, 0, z - box.max.z)) < e.radius) return true;
  }
  return false;
}

/** The only fleet pose-commit boundary. Queries are synchronous, private trials, always rolled back.
 * Committed moves first check the whole translation/rotation sweep, then publish the endpoint once.
 * A gate uses its real meshes, panel thickness and height; bodies use their vehicle envelopes and
 * the caller's real-deck intersection predicate. No mutation or callback escapes a rejected move. */
export function movement<T>(move: Query<T>): T;
export function movement(move: Move | Proposal): string;
export function movement<T>(move: Move | Proposal | Query<T>): T | string {
  if ('propose' in move) {
    try { const reason = movement(move.propose()); if (reason) move.rollback(); return reason; } catch (error) { move.rollback(); throw error; }
  }
  if ('query' in move) {
    const undo = checkpoint(move.objects ?? [], move.roots);
    try { return move.query(); } finally { undo(); }
  }
  for (const body of move.bodies ?? []) {
    const a = body.from, b = body.to, radius = Math.max(a.spec.envelope.reach, a.spec.height);
    const distance = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)
      + radius * (a.quaternion && b.quaternion ? a.quaternion.angleTo(b.quaternion) : Math.abs(turn(b.heading - a.heading)) + Math.abs((b.pitch ?? 0) - (a.pitch ?? 0)) + Math.abs((b.roll ?? 0) - (a.roll ?? 0)));
    const steps = Math.ceil(distance / .02);
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 1;
      const p: SweepPose = { x: THREE.MathUtils.lerp(a.x, b.x, t), y: THREE.MathUtils.lerp(a.y, b.y, t), z: THREE.MathUtils.lerp(a.z, b.z, t),
        heading: a.heading + turn(b.heading - a.heading) * t, pitch: THREE.MathUtils.lerp(a.pitch ?? 0, b.pitch ?? 0, t), roll: THREE.MathUtils.lerp(a.roll ?? 0, b.roll ?? 0, t), spec: b.spec };
      if (a.quaternion && b.quaternion) p.quaternion = a.quaternion.clone().slerp(b.quaternion, t);
      if (!body.clear(p, t)) return 'A solid blocks the vehicle movement';
      if (body.geometry && !body.geometry(p)) return 'The vehicle catches on the trailer';
    }
  }
  if (!move.gates?.length) { move.commit(); return ''; }
  const spec = { ...CAR_SPEC, halfLength: .11, halfWidth: .11, height: 0,
    envelope: { ...CAR_SPEC.envelope, circles: [0], radius: .11, reach: .11, sweepHalfLength: .11, sweepHalfWidth: .11 } };
  const probe: ContactBody = { x: 0, y: 0, z: 0, heading: 0, spec: spec as VehicleSpec };
  const box = new THREE.Box3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (const gate of move.gates ?? []) {
    if (Object.is(gate.from, gate.to) && (!gate.parentTo || gate.parentFrom?.equals(gate.parentTo))) continue;
    const root = gate.root, oldPosition = root.position.clone(), oldRotation = root.rotation.clone(), oldScale = root.scale.clone();
    const parent = root.parent!, inverse = parent.matrixWorld.clone().invert();
    const from = gate.parentFrom ?? parent.matrixWorld, to = gate.parentTo ?? from;
    const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
    from.decompose(pa, qa, sa); to.decompose(pb, qb, sb);
    const span = Math.abs(gate.to - gate.from) * 2 + pa.distanceTo(pb) + qa.angleTo(qb) * 4;
    const steps = Math.max(1, Math.ceil(span / .015)), matrix = new THREE.Matrix4(), local = new THREE.Matrix4(), gateRotation = new THREE.Quaternion();
    try {
      for (let n = 0; n <= steps; n++) {
        const t = n / steps; position.lerpVectors(pa, pb, t); rotation.slerpQuaternions(qa, qb, t); scale.lerpVectors(sa, sb, t);
        matrix.compose(position, rotation, scale); gateRotation.setFromEuler(new THREE.Euler(THREE.MathUtils.lerp(gate.from, gate.to, t), 0, 0));
        local.compose(oldPosition, gateRotation, oldScale); matrix.multiply(local); local.multiplyMatrices(inverse, matrix); local.decompose(root.position, root.quaternion, root.scale);
        root.updateWorldMatrix(true, true); box.setFromObject(root).expandByScalar(.025);
        for (const body of move.obstacles ?? []) if (boxTouchesBody(box, body)) return `Move the ${(body as ContactBody & { label?: string }).label ?? 'vehicle'} clear of the ramp`;
        if (move.contacts) {
          const nx = Math.max(1, Math.ceil((box.max.x - box.min.x) / .15)), nz = Math.max(1, Math.ceil((box.max.z - box.min.z) / .15));
          probe.y = box.min.y; spec.height = spec.envelope.overhead = box.max.y - box.min.y;
          for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
            probe.x = THREE.MathUtils.lerp(box.min.x, box.max.x, ix / nx); probe.z = THREE.MathUtils.lerp(box.min.z, box.max.z, iz / nz);
            if (!move.contacts.allows(probe)) return 'A solid blocks the ramp movement';
          }
        }
      }
    } finally { root.position.copy(oldPosition); root.rotation.copy(oldRotation); root.scale.copy(oldScale); root.updateWorldMatrix(true, true); }
  }
  move.commit(); return '';
}

export type TeleportKind = 'road-reset' | 'start-over' | 'place-jump' | 'new-visit';
export interface TeleportPose { body: ContactBody; valid(): string }
/** Explicit recovery starts a new placement, not a physical sweep. Validate the entire assembly first. */
export function teleport(change: { kind: TeleportKind; targets: TeleportPose[]; commit(): void }): string {
  if (!['road-reset', 'start-over', 'place-jump', 'new-visit'].includes(change.kind)) throw new Error('Invalid fleet teleport caller');
  for (const target of change.targets) { const reason = target.valid(); if (reason) return reason; }
  change.commit(); return '';
}
