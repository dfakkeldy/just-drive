import * as THREE from 'three';
import type { Terrain } from './terrain';
import type { Hike } from './hikes';

/** One visual mesh, with no physics/road registration. Only loaded land gets a worn path.
 * Edge vertices sample the actual land triangles, so the 1 m ribbon follows every hill-height setting. */
export class Footpaths {
  readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0x967956, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  private next = 0;
  private readonly strips: [number, number, number, number][] = [];
  constructor(hikes: readonly Hike[], private terrain: Terrain) {
    this.mesh.name = 'Mapped highlands footpaths'; this.mesh.visible = false;
    this.mesh.userData.shadowSet = true; this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    const [e, n] = terrain.manifest.village;
    for (const hike of hikes.filter(h => h.kind === 'highlands')) for (const line of hike.line ?? []) {
      for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1], b = line.pts[i], dx = b[0] - a[0], dz = a[1] - b[1], length = Math.hypot(dx, dz);
        const steps = Math.max(1, Math.ceil(length));
        for (let j = 0; j < steps; j++) {
          const t = j / steps, u = (j + 1) / steps;
          this.strips.push([a[0] - e + dx * t, n - a[1] + dz * t, a[0] - e + dx * u, n - a[1] + dz * u]);
        }
      }
    }
  }
  update(dt: number, camera: THREE.Vector3): void {
    this.next -= dt; if (this.next > 0) return; this.next = .5;
    const ground = (x: number, z: number): number | null => {
      return (this.terrain.surfaceAt(x, z)?.level ?? 0) >= 6 ? this.terrain.meshHeightAt(x, z) : null;
    };
    const pos: number[] = [];
    for (const [ax, az, bx, bz] of this.strips) {
      if (Math.hypot(ax - camera.x, az - camera.z) > 1300) continue;
      const length = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / length * .5, nz = (bx - ax) / length * .5;
      const corners = [[ax + nx, az + nz], [ax - nx, az - nz], [bx + nx, bz + nz], [bx - nx, bz - nz]];
      const heights = corners.map(([x, z]) => ground(x, z)); if (heights.some(y => y === null)) continue;
      for (const i of [0, 2, 1, 1, 2, 3]) pos.push(corners[i][0], heights[i]! + .025, corners[i][1]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals(); geo.computeBoundingSphere();
    this.mesh.geometry.dispose(); this.mesh.geometry = geo; this.mesh.visible = pos.length > 0;
  }
}
