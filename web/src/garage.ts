import { createHorse, HORSE_SPEC } from './horse';
import { readEra } from './era';
import { readArea } from './area';
import { readSite } from './site';
import { createSxs, SXS_SPEC } from './sxs';
import { buildMailCar, preloadMailCar, readyMailCar } from './car-switch';
import { createTruck, TRUCK_SPEC } from './truck';
import { createBike, BIKE_SPEC, type Bike } from './bike';
import { BikeRide } from './bike-ride';
import type { Ride } from './ride';
import type { Terrain } from './terrain';
import type { Roads } from './roads';
import { CAR_SPEC, type Rig, type VehicleSpec } from './vehicle-spec';
import type { RideId } from './ride-kinds';

/** `mailTrim` false asks for the vehicle off duty (explore mode): a model with mail parts leaves them off. */
export interface GarageEntry {
  id: string; name: string; spec: VehicleSpec; build(mailTrim?: boolean, cleanText?: boolean): Rig;
  /** A vehicle whose model is a file: start its download (called as soon as the vehicle is known). */
  preload?(params: URLSearchParams, low: boolean): void;
  /** A model that is a file loads here: the game awaits this once, before the first `build`. It never rejects. */
  ready?(params: URLSearchParams, low: boolean): Promise<void>;
  /** Omitted by car/truck: their existing Vehicle path stays in main. Paired with this entry's own builder. */
  ride?(rig: Rig, terrain: Terrain, roads: Roads, seaLevel: number, spec: VehicleSpec): Ride;
}
// The garage order sets the default ride (the first) and the menu, so it differs from RIDE_KINDS on purpose.
const ENTRIES = [
  { id: 'car', name: 'Mail car', spec: CAR_SPEC, build: buildMailCar, preload: preloadMailCar, ready: readyMailCar },
  { id: 'sxs', name: 'Side by side', spec: SXS_SPEC, build: mailTrim => createSxs(mailTrim) },
  { id: 'truck', name: 'Heavy pickup', spec: TRUCK_SPEC, build: mailTrim => createTruck(mailTrim) },
  { id: 'horse', name: 'Horse', spec: HORSE_SPEC, build: createHorse },
  { id: 'bike', name: 'Dirt bike', spec: BIKE_SPEC, build: mailTrim => createBike(mailTrim),
    ride: (rig, terrain, roads, sea, spec) => new BikeRide(rig as Bike, terrain, roads, sea, spec) },
] satisfies readonly (GarageEntry & { id: RideId })[];
/** The compiler fails here when a ride kind has no garage entry. Every entry's id is already a ride kind. */
const everyRideKind: [Exclude<RideId, typeof ENTRIES[number]['id']>] extends [never] ? true : never = true;
void everyRideKind;
export const GARAGE: readonly GarageEntry[] = ENTRIES;
export const VEHICLE_KEY = 'mmm.vehicle';
/** Address bar wins in every mode. A saved garage id is read only for explore; ordinary mail keeps the car. */
export function readVehicle(params: URLSearchParams, explore = false, storage: () => Pick<Storage, 'getItem'> = () => localStorage): GarageEntry {
  // The horse is the 1884 ride only: its hoof contact needs the era's camera-free tile selection (terrain.ts),
  // so an address or saved choice of 'horse' outside 1884 gives the car, as it did before the horse existed.
  const period = periodRides(params), allowed = (entry?: GarageEntry) => entry && (entry.id !== 'horse' || period) ? entry : undefined;
  const query = allowed(GARAGE.find(entry => entry.id === params.get('vehicle'))); if (query) return query;
  if (explore) { try { const saved = storage().getItem(VEHICLE_KEY), entry = allowed(GARAGE.find(e => e.id === saved)); if (entry) return entry; } catch { /* private window */ } }
  return period ? GARAGE.find(e => e.id === 'horse')! : GARAGE[0];
}
/** True when this page plays the 1884 era. Same area resolution as the game (an unknown area falls back to Mabou). */
export function periodRides(params: URLSearchParams): boolean {
  const site = typeof location === 'undefined' ? null : readSite(location.hostname, location.pathname, params);
  const area = site?.brand === 'just' ? site.area ?? undefined : readArea(params).id;
  return readEra(params, area, site?.era).id === '1884';
}
