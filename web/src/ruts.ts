import * as THREE from 'three';
import { buildingSites, type Building } from './buildings';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';
interface House { id: number; x: number; z: number }
/** One bounded draw call. House queries use a fixed 64 m grid. */
export class Ruts {
  readonly mesh: THREE.InstancedMesh;
  count = 0;
  get lawns(): number { return this.damaged.size; }
  private cursor = 0;
  private readonly damaged = new Set<number>();
  private readonly dummy = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly cells = new Map<number, House[]>();
  private oldX = NaN; private oldZ = NaN;
  private distance = 0; private property = -1; private began = 0; private spacing = 0;
  constructor(private readonly terrain: Terrain, buildings: Building[], village: [number, number], low: boolean,
    private readonly damage: (id: number, x: number, z: number, at: number) => void) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(.24, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x32291c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), low ? 320 : 960);
    this.mesh.name = 'Two tyre ruts per lawn crossing'; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // One property for each building, also when it is drawn from wings: a lawn has one owner and one complaint.
    for (const b of buildingSites(buildings)) if (b.kind === 'house') {
      const p = { id: b.id, x: b.x - village[0], z: village[1] - b.y }, key = Math.floor(p.x / 64) * 65536 + Math.floor(p.z / 64);
      const cell = this.cells.get(key); if (cell) cell.push(p); else this.cells.set(key, [p]);
    }
    this.reset();
  }
  reset(): void {
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, this.zero);
    this.mesh.instanceMatrix.needsUpdate = true; this.oldX = this.oldZ = NaN;
    this.damaged.clear();
    this.property = -1; this.distance = this.spacing = this.cursor = this.count = 0;
  }
  update(v: Vehicle, at: number): void {
    if (v.spec?.locomotion === 'horse') return;
    const travel = Math.hypot(v.x - this.oldX, v.z - this.oldZ);
    this.oldX = v.x; this.oldZ = v.z;
    const s = this.terrain.surfaceAt(v.x, v.z,v.y);
    let house: House | undefined, best = 35 * 35;
    if (s && s.level >= 6 && !v.airborne && s.canopy < 1.6 && s.roadDist > s.halfWidth + .6 &&
      Math.hypot(v.vx, v.vz) > 1.4 && travel < 5) {
      const cx = Math.floor(v.x / 64), cz = Math.floor(v.z / 64);
      for (let z = cz - 1; z <= cz + 1; z++) for (let x = cx - 1; x <= cx + 1; x++) {
        const cell = this.cells.get(x * 65536 + z); if (!cell) continue;
        for (const h of cell) { const d = (h.x - v.x) ** 2 + (h.z - v.z) ** 2; if (d < best) { best = d; house = h; } }
      }
    }
    if (!house) { this.property = -1; this.distance = this.spacing = 0; return; }
    if (house.id !== this.property) { this.property = house.id; this.distance = 0; this.began = at; }
    this.distance += travel; this.spacing += travel;
    if (this.distance > 3 && !this.damaged.has(house.id)) {
      this.damaged.add(house.id); this.damage(house.id, v.x, v.z, this.began);
    }
    if (this.spacing < .65) return;
    const length = Math.min(2, this.spacing + .15); this.spacing = 0;
    const rx = Math.cos(v.heading), rz = Math.sin(v.heading);
    for (let side = -1; side <= 1; side += 2) {
      const x = v.x + rx * .785 * side, z = v.z + rz * .785 * side;
      const y = this.terrain.heightAt(x, z,v.y); if (y === null) continue;
      const fx = Math.sin(v.heading) * length / 2, fz = -Math.cos(v.heading) * length / 2;
      const front = this.terrain.heightAt(x + fx, z + fz,v.y) ?? y, back = this.terrain.heightAt(x - fx, z - fz,v.y) ?? y;
      const left = this.terrain.heightAt(x - rx * .12, z - rz * .12,v.y) ?? y;
      const right = this.terrain.heightAt(x + rx * .12, z + rz * .12,v.y) ?? y;
      this.dummy.position.set(x, y + .045, z);
      this.dummy.rotation.set(Math.atan2(front - back, length), -v.heading, Math.atan2(right - left, .24), 'YXZ');
      this.dummy.scale.set(1, 1, length); this.dummy.updateMatrix();
      this.mesh.setMatrixAt(this.cursor, this.dummy.matrix); this.cursor = (this.cursor + 1) % this.mesh.count; this.count++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
