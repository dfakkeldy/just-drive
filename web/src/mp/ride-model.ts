import * as THREE from 'three';
import models from './ride-models.json';
import type { Ride } from './wire';

export const RIDE_MODELS = ['car', 'truck', 'trailer', 'sxs', 'bike'] as const;
export function rideIndex(ride?: Ride): number {
  return ride ? RIDE_MODELS.indexOf(ride.kind === 'truck' && ride.trailer ? 'trailer' : ride.kind) : -1;
}

/** The same axle dimensions as the production rig, captured alongside its reduced shape. */
export function rideAxles(ride?: Ride): { wheelbase: number; track: number } | undefined {
  const index = rideIndex(ride);
  return index < 0 ? undefined : models.models[RIDE_MODELS[index]];
}

/** One fixed-size instanced mesh; a one-hot morph picks a production-rig snapshot per peer. */
export function rideGeometry(legacy: THREE.BufferGeometry): THREE.BufferGeometry {
  // Split existing faces to the common count. Preserve colour, paint and lamp attributes.
  const original = legacy.index ? legacy.toNonIndexed() : legacy;
  const attributes = Object.entries(original.attributes);
  const values = attributes.map(([,a]) => Array.from(a.array));
  let faces = original.getAttribute('position').count / 3;
  for (let i = 0; faces < models.triangles; i++, faces++) {
    const face = i % (original.getAttribute('position').count / 3);
    for (let j = 0; j < attributes.length; j++) {
      const size = attributes[j][1].itemSize, a = values[j], at = face * 3 * size;
      const first = a.slice(at, at + size), second = a.slice(at + size, at + size*2), third = a.slice(at + size*2, at + size*3);
      for (let k = 0; k < size; k++) a[at+size+k] = (first[k]+second[k])/2;
      a.push(...a.slice(at+size, at+size*2), ...second, ...third);
    }
  }
  const g = new THREE.BufferGeometry();
  attributes.forEach(([name,a],i) => g.setAttribute(name,new THREE.Float32BufferAttribute(values[i],a.itemSize)));
  for (const name of ['position','normal','color']) g.morphAttributes[name] = [];
  for (const kind of RIDE_MODELS) {
    const m = models.models[kind], target = new THREE.BufferGeometry();
    target.setAttribute('position', new THREE.Float32BufferAttribute(m.position,3)); target.computeVertexNormals();
    g.morphAttributes.position.push(target.getAttribute('position') as THREE.BufferAttribute);
    g.morphAttributes.normal.push(target.getAttribute('normal') as THREE.BufferAttribute);
    g.morphAttributes.color.push(new THREE.Float32BufferAttribute(m.color,3));
  }
  g.computeBoundingSphere();
  legacy.dispose(); if (original !== legacy) original.dispose();
  return g;
}
