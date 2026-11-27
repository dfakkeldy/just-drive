import type { Building } from './buildings';
import { isTerrainLawn } from './ruts';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';

/** Screenshot-only lawn drive. It finds a clear strip on the real sampled ground, never paints a fake lawn. */
export class LawnDemo {
  private ready = false;
  get driving(): boolean { return this.ready; }
  private readonly x: number;
  private readonly z: number;
  constructor(house: Building, village: [number, number], vehicle: Vehicle) {
    this.x = house.x - village[0]; this.z = village[1] - house.y;
    vehicle.place(this.x - 20, this.z, 0,vehicle.y);
  }
  prepare(terrain: Terrain, vehicle: Vehicle): boolean {
    if (this.ready || (terrain.surfaceAt(this.x, this.z)?.level ?? 0) < 8) return false;
    for (let radius = 14; radius <= 26; radius += 4) for (let angle = 0; angle < 16; angle++) {
      const a = angle * Math.PI / 8, cx = this.x + Math.cos(a) * radius, cz = this.z + Math.sin(a) * radius;
      const fx = -Math.sin(a), fz = Math.cos(a);
      let clear = true;
      for (let step = -12; step <= 20; step += 2) {
        const x = cx + fx * step, z = cz + fz * step, s = terrain.surfaceAt(x, z);
        if (!s || s.level < 8 || !isTerrainLawn(terrain, s, x, z, 1) || s.ground < 1) { clear = false; break; }
      }
      if (clear) {
        vehicle.place(cx - fx * 12, cz - fz * 12, Math.atan2(fx, -fz),vehicle.y); vehicle.speed = vehicle.steerAngle = 0; this.ready = true; return true;
      }
    }
    return false;
  }
}
