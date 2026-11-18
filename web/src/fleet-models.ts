import * as THREE from 'three';
import { createTruck } from './truck';
import { createSxs } from './sxs';
import { createBike } from './bike';
import type { GarageEntry } from './garage';
import type { Rig } from './vehicle-spec';

export function fleetEnabled(entry: Pick<GarageEntry, 'id'>, params: URLSearchParams, explore: boolean, modern = true): boolean {
  return modern && explore && entry.id === 'truck' && params.get('trailer') === '1';
}

/** The normal LOW pickup is opt-in to this fleet; ordinary garage builds retain their original drawing. */
export function fleetRig(entry: GarageEntry, mail: boolean, low: boolean, params: URLSearchParams, just = false, modern = true): Rig {
  return low && fleetEnabled(entry, params, !mail, modern)
    ? createTruck(false, true) : entry.build(mail, just);
}

/** Bake the real light builder into one colour batch for the body and one per wheel. The parked copies are built
 * once and never driven, without a rider; the Point Tupper AI keeps the rider (drivableDisplay). */
function displayBatch(source: Rig, rider = false): Rig {
  source.setRiderVisible?.(rider); source.root.updateMatrixWorld(true);
  const root = new THREE.Group(), body = new THREE.Group(); root.name = source.root.name + ' parked display'; root.rotation.order = 'YXZ'; root.add(body);
  const wheels = [...new Set([...Object.values(source.wheels), ...(source.extraWheels ?? [])])];
  const targets = wheels.map(() => { const pivot = new THREE.Group(), wheel = new THREE.Group(); root.add(pivot); pivot.add(wheel); return wheel; });
  const inverses = [source.root.matrixWorld.clone().invert(), ...wheels.map(w => w.matrixWorld.clone().invert())];
  const batches = inverses.map(() => ({ position: [] as number[], normal: [] as number[], color: [] as number[] }));
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), matrix = new THREE.Matrix4(), normals = new THREE.Matrix3();
  source.root.traverseVisible(node => {
    if (!(node instanceof THREE.Mesh)) return;
    let group = 0;
    for (let i = 0; i < wheels.length; i++) for (let n: THREE.Object3D | null = node; n; n = n.parent) if (n === wheels[i]) { group = i + 1; break; }
    const geometry = node.geometry, position = geometry.attributes.position, colour = geometry.attributes.color, n = geometry.attributes.normal;
    const material = (Array.isArray(node.material) ? node.material[0] : node.material) as THREE.MeshStandardMaterial;
    const tint = material.color ?? new THREE.Color(0xffffff), batch = batches[group];
    matrix.multiplyMatrices(inverses[group], node.matrixWorld); normals.getNormalMatrix(matrix);
    const count = geometry.index?.count ?? position.count;
    for (let i = 0; i < count; i++) {
      const at = geometry.index?.getX(i) ?? i;
      point.fromBufferAttribute(position, at).applyMatrix4(matrix); normal.fromBufferAttribute(n, at).applyNormalMatrix(normals);
      batch.position.push(point.x, point.y, point.z); batch.normal.push(normal.x, normal.y, normal.z);
      batch.color.push(tint.r * (colour?.getX(at) ?? 1), tint.g * (colour?.getY(at) ?? 1), tint.b * (colour?.getZ(at) ?? 1));
    }
  });
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .12 }); material.name = 'Parked display colours';
  batches.forEach((batch, i) => {
    const geometry = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'color'] as const) geometry.setAttribute(key, new THREE.Float32BufferAttribute(batch[key], 3));
    const mesh = new THREE.Mesh(geometry, material); mesh.castShadow = mesh.receiveShadow = true; (i ? targets[i - 1] : body).add(mesh);
    if (i) { matrix.multiplyMatrices(inverses[0], wheels[i - 1].matrixWorld); matrix.decompose(targets[i - 1].position, targets[i - 1].quaternion, targets[i - 1].scale); }
  });
  const eye = new THREE.Object3D(); source.driverEye.getWorldPosition(eye.position).applyMatrix4(inverses[0]); body.add(eye);
  const at = (wheel: THREE.Object3D) => targets[wheels.indexOf(wheel)];
  const result: Rig = { root, body, wheels: { fl: at(source.wheels.fl), fr: at(source.wheels.fr), rl: at(source.wheels.rl), rr: at(source.wheels.rr) },
    extraWheels: source.extraWheels?.map(at), steer: { fl: at(source.wheels.fl).parent!, fr: at(source.wheels.fr).parent! }, driverEye: eye, brakeLights: [] };
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  source.root.traverse(n => { if (n instanceof THREE.Mesh) { geometries.add(n.geometry); for (const m of Array.isArray(n.material) ? n.material : [n.material]) materials.add(m); } });
  for (const g of geometries) g.dispose(); for (const m of materials) m.dispose();
  return result;
}

export function fleetDisplay(id: 'truck' | 'sxs' | 'bike'): Rig {
  if (id === 'bike') { const rig = createBike(false, true, true); rig.setRiderVisible?.(false); rig.bikeMesh.frustumCulled = true; return rig; }
  return displayBatch(id === 'truck' ? createTruck(false, true) : createSxs(false, { low: true, removableRider: true, display: true }));
}

/** The kinds with a parked display model: the only ones drivableDisplay builds, and the Point Tupper AI's LOW pool. */
export const DISPLAY_KINDS = ['truck', 'sxs', 'bike'] as const;
export type DisplayKind = (typeof DISPLAY_KINDS)[number];
export const isDisplayKind = (id: string): id is DisplayKind => (DISPLAY_KINDS as readonly string[]).includes(id);
/** The Point Tupper AI's LOW rig: the parked display model with its rider, which a Vehicle can drive. The parked
 * batches hang every wheel from a pivot at the body origin (Fleet copies whole wheel transforms into them and never
 * steers), so a steering angle there would swing the front wheels round the body: here the front pivots move to their
 * wheels, the same world pose, and steer about the wheel. Pickup 7 draws, side by side 5, dirt bike 2 (bike and rider). */
export function drivableDisplay(id: DisplayKind): Rig {
  if (!isDisplayKind(id)) throw new Error(`No display model for ${id}`);
  if (id === 'bike') return createBike(false, true, true);
  const rig = displayBatch(id === 'truck' ? createTruck(false, true) : createSxs(false, { low: true, removableRider: true, display: true }), true);
  for (const wheel of [rig.wheels.fl, rig.wheels.fr]) { const pivot = wheel.parent!; pivot.position.add(wheel.position); wheel.position.set(0, 0, 0); }
  return rig;
}
