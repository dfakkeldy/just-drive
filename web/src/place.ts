import type * as THREE from 'three';
import type { Pushable } from './parked';

/**
 * A place built by hand over a surveyed site: the church, Judique village, Port Hawkesbury, Mabou main street, the home
 * and the porch house. main.ts keeps them in one list: it adds each to the scene, updates it before the camera, exposes
 * it for the dev tools and waits for it before a picture, the same way for all. Each site still clears its own land.
 */
export interface HandBuiltPlace {
  readonly group: THREE.Object3D;
  resolveSolids(car: Pushable): void;
  /** Once a frame. `view` is the camera position, `now` the frame clock in ms, `car` the driven vehicle, `dt` the step. */
  update(view: THREE.Vector3, now: number, car: { x: number; y: number; z: number }, dt: number): void;
  /** True while a near part is still to be built: a picture waits for it. */
  readonly waiting?: boolean;
}
