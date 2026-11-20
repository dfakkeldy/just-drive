import type { Vehicle } from './vehicle';
import { CAR_SPEC } from './vehicle-spec';
import type { ContactBody, Pushable } from './parked';
type Body = Pushable & ContactBody & { car: { root: { position: { x: number; z: number } } } };
export interface WorldContacts {
  readonly revision?: number;
  allows(body: ContactBody): boolean;
  resolve(body: Body): void;
  bindVehicle?(vehicle: Vehicle): void;
}
export type ContactSite = { resolve(body: Body): void; allows?(body: ContactBody): boolean; revision?(): number };
/** Register a site's pure contact resolver once; physics and all fleet preflights share the registry. */
export class AreaContacts implements WorldContacts {
  private epoch = 0;
  private readonly guards = new WeakMap<Vehicle, Vehicle['placementGuard']>();
  private readonly placementHeights = new WeakMap<Vehicle, (pose: {x:number;z:number;heading:number}) => number|null>();
  get revision(): number {
    for (const row of this.sites) { const next = row.site.revision?.(); if (!Object.is(next, row.revision)) { row.revision = next; this.epoch++; } }
    return this.epoch;
  }
  invalidate(): void { this.epoch++; }
  private readonly probe: Body = { x: 0, z: 0, y: 0, heading: 0, spec: CAR_SPEC, vx: 0, vz: 0, speed: 0, car: { root: { position: { x: 0, z: 0 } } } };
  private readonly sites: { site: ContactSite; revision: number | undefined }[] = [];
  add(site: ContactSite): void {
    if (this.sites.some(row => row.site === site)) return;
    this.sites.push({ site, revision: site.revision?.() }); this.invalidate();
  }
  /** One idempotent placement seam uses the exact provider list used by driving and sweeps. */
  bindVehicle(vehicle: Vehicle, placementHeight?: (pose: {x:number;z:number;heading:number}) => number|null): void {
    if(placementHeight)this.placementHeights.set(vehicle,placementHeight);
    if (this.guards.has(vehicle) && this.guards.get(vehicle) === vehicle.placementGuard) return;
    const previous = vehicle.placementGuard;
    const allows = (pose: { x: number; z: number; heading: number }) => {
      const read=this.placementHeights.get(vehicle),y=read?read(pose):vehicle.y??0;
      return y!==null&&this.allows({ ...pose, y, spec: vehicle.spec });
    };
    const guard: NonNullable<Vehicle['placementGuard']> = pose => allows(pose) && (!previous || previous(pose)) && allows(pose);
    vehicle.placementGuard = guard; this.guards.set(vehicle, guard);
  }
  resolve(body: Body): void { for (const { site } of this.sites) site.resolve(body); }
  allows(body: ContactBody): boolean {
    for (const { site } of this.sites) {
      if (site.allows) { if (!site.allows(body)) return false; }
      else {
        const probe = this.probe; probe.x = body.x; probe.z = body.z; probe.y = body.y; probe.heading = body.heading; probe.spec = body.spec; probe.vx = probe.vz = probe.speed = 0; probe.car.root.position.x = body.x; probe.car.root.position.z = body.z;
        site.resolve(probe);
        if (Math.hypot(probe.x - body.x, probe.z - body.z) > 1e-7) return false;
      }
    }
    return true;
  }
}
