import type * as THREE from 'three';
import type { Pushable } from './parked';

/**
 * A place built by hand over a surveyed site: the church, Judique village, Port Hawkesbury, Mabou main street, the home,
 * the porch house and Maryville. main.ts keeps them in one list: it adds each to the scene, updates it before the camera,
 * exposes it for the dev tools and waits for it before a picture, the same way for all. Each site still clears its own land.
 */
export interface HandBuiltPlace {
  readonly group: THREE.Object3D;
  resolveSolids(car: Pushable): void;
  /** Once a frame. `view` is the camera position, `now` the frame clock in ms, `car` the driven vehicle, `dt` the step. */
  update(view: THREE.Vector3, now: number, car: { x: number; y: number; z: number }, dt: number): void;
  /** True while a near part is still to be built: a picture waits for it. */
  readonly waiting?: boolean;
}

/**
 * One row of main.ts's places list. `site` is the place's site, or null while the place is off (its gate said no).
 * `build` makes the place once the land and the roads are ready; it returns a promise only when the place's code
 * loads by import(). `slot` wraps a built thing that does not fit HandBuiltPlace as it is (the home and the porch).
 * The dev tools always see the built thing itself.
 */
export interface PlaceRow<S, B extends object> {
  readonly site: S | null;
  build(site: S): B | Promise<B>;
  slot?(built: B): HandBuiltPlace;
}
export function placeRow<S, B extends HandBuiltPlace>(site: S | null, build: (site: S) => B | Promise<B>): PlaceRow<S, B>;
export function placeRow<S, B extends object>(site: S | null, build: (site: S) => B | Promise<B>, slot: (built: B) => HandBuiltPlace): PlaceRow<S, B>;
export function placeRow<S, B extends object>(site: S | null, build: (site: S) => B | Promise<B>, slot?: (built: B) => HandBuiltPlace): PlaceRow<S, B> {
  return slot ? { site, build, slot } : { site, build };
}

type Rows = Record<string, PlaceRow<unknown, object>>;
/** Each row's built thing, or null while its place is off. */
export type BuiltPlaces<R extends Rows> = { [K in keyof R]: R[K] extends PlaceRow<unknown, infer B> ? B | null : never };
/** The frame's slot for a place: what it updates and what the dev tools see. A slot is there while its place is off. */
export interface PlaceSlot { place: HandBuiltPlace | null; dev: object | null }

/** The rows' sites, by name, in the rows' order. */
export function sitesOf<R extends Rows>(rows: R): { [K in keyof R]: R[K]['site'] } {
  return Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row.site])) as { [K in keyof R]: R[K]['site'] };
}

/** One slot for each row, in the rows' order, from what the boot built. */
export function placeSlots<R extends Rows>(rows: R, built: BuiltPlaces<R>): { [K in keyof R]: PlaceSlot } {
  return Object.fromEntries(Object.entries(rows).map(([name, row]) => {
    const made = (built as Record<string, object | null>)[name];
    return [name, { dev: made, place: made && (row.slot ? row.slot(made) : made as HandBuiltPlace) }];
  })) as { [K in keyof R]: PlaceSlot };
}
