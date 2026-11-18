import * as THREE from 'three';
import { MineArt } from './mine-art';
import type { Roads } from './roads';
import type { Terrain } from './terrain';
export interface MineRoadPoint { x: number; z: number; heading: number; halfWidth: number }
/** Clip the named route to a 60 m margin, then take its farthest surviving end from the village. */
export function mineRoadEnd(roads: Pick<Roads, 'roads'>, bounds: [number, number, number, number] | null): MineRoadPoint | null {
  if (!bounds) return null;
  const [x0, z0, x1, z1] = bounds;
  let best: MineRoadPoint | null = null, farthest = -1;
  for (const road of roads.roads) {
    if (road.name !== 'Mabou Mines Road' || road.bridge) continue;
    for (let i = 1; i < road.pts.length; i++) {
      const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i]; const dx = bx - ax, dz = bz - az;
      let lo = 0, hi = 1;
      for (const [a, d, min, max] of [[ax, dx, x0 + 60, x1 - 60], [az, dz, z0 + 60, z1 - 60]]) {
        if (Math.abs(d) < 1e-9) { if (a < min || a > max) hi = -1; }
        else { const t0 = (min - a) / d, t1 = (max - a) / d; lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1)); }
      }
      if (lo > hi) continue;
      for (const t of [lo, hi]) {
        const x = ax + t * dx, z = az + t * dz, distance = x * x + z * z;
        if (distance > farthest) { farthest = distance; best = { x, z, heading: Math.atan2(dx, -dz), halfWidth: road.halfWidth }; }
      }
    }
  }
  return best;
}
/** Fictional mail stop. Mabou Mines is named for coal mines that worked there long ago. */
export class MineSite {
  readonly group = new THREE.Group();
  readonly roadPoint: MineRoadPoint | null;
  readonly portal = new THREE.Vector3();
  private art = new MineArt();
  private node: THREE.Group | null = null;
  private level = -1;
  constructor(roads: Roads, private readonly terrain: Terrain, bounds: [number, number, number, number] | null,
    private readonly village: [number, number], private readonly just = false) {
    this.roadPoint = mineRoadEnd(roads, bounds);
    if (this.roadPoint) {
      const p = this.roadPoint, offset = p.halfWidth + 18;
      // Reserve both possible uphill footprints before any terrain or single-tree tile is built.
      for (const side of [-1, 1]) {
        const x = p.x + Math.cos(p.heading) * offset * side, z = p.z + Math.sin(p.heading) * offset * side;
        terrain.clear.push([x - 14, z - 14, x + 14, z + 14]);
      }
      console.info('Mine road trigger (EPSG:2961)', JSON.stringify({ east: p.x + village[0], north: village[1] - p.z, heading: p.heading * 180 / Math.PI, radius: 14 }));
    }
  }
  update(camera: THREE.Vector3): void {
    const p = this.roadPoint;
    if (!p || Math.hypot(camera.x - p.x, camera.z - p.z) > 1400) return;
    const nx = Math.cos(p.heading), nz = Math.sin(p.heading), offset = p.halfWidth + 18;
    const a = this.terrain.surfaceAt(p.x + nx * offset, p.z + nz * offset), b = this.terrain.surfaceAt(p.x - nx * offset, p.z - nz * offset);
    if (!a || !b || Math.min(a.level, b.level) < 6) return;
    const level = Math.min(a.level, b.level); if (level <= this.level) return;
    this.level = level;
    const side = a.ground >= b.ground ? 1 : -1;
    this.portal.set(p.x + nx * offset * side, side > 0 ? a.ground : b.ground, p.z + nz * offset * side);
    if (this.node) { this.group.remove(this.node); this.art.dispose(); this.art = new MineArt(); }
    const angle = Math.atan2(-nx * side, -nz * side);
    this.node = this.build(angle); this.group.add(this.node);
    this.node.position.copy(this.portal); this.node.rotation.y = angle;
    console.info('Mine portal (EPSG:2961)', JSON.stringify({ east: this.portal.x + this.village[0], north: this.village[1] - this.portal.z, height: this.portal.y, metresFromRoadEdge: 18, uphillSide: side, terrainLevel: level }));
  }
  private build(angle: number): THREE.Group {
    const root = new THREE.Group(), a = this.art;
    const ground = (x: number, z: number): number => {
      const wx = this.portal.x + x * Math.cos(angle) + z * Math.sin(angle);
      const wz = this.portal.z - x * Math.sin(angle) + z * Math.cos(angle);
      return (this.terrain.surfaceAt(wx, wz)?.ground ?? this.portal.y) - this.portal.y;
    };
    root.name = 'Mabou Mines fictional colliery mail stop';
    // A short rock cut masks the existing slope behind the adit.
    for (const side of [-1, 1]) a.shape(root, a.rock, 0x57574c, side * 3.3, 1.9, -1.3, 2.2, 3, 3.4);
    a.shape(root, a.rock, 0x53584c, 0, 4.7, -2, 5.6, 2, 3);
    a.box(root, 0x060c0d, 0, 2, -.8, 4.6, 4.1, 1.4);
    for (const x of [-2.5, 2.5]) {
      a.box(root, 0x726148, x, 2.2, 0, .55, 4.4, .65);
      const brace = a.box(root, 0x8a7455, x * .8, 3.7, .3, .25, 1.5, .25); brace.rotation.z = -Math.sign(x) * .55;
    }
    a.box(root, 0x8b7653, 0, 4.4, 0, 5.6, .65, .75);
    for (let z = -.5; z < 14; z += 1.15) a.box(root, 0x5d5141, 0, ground(0, z) + .12, z, 1.9, .18, .3);
    for (let z = -1; z < 14; z += 1) for (const x of [-.57, .57]) {
      const y0 = ground(0, z) + .25, y1 = ground(0, z + 1) + .25;
      const rail = a.box(root, 0x747b73, x, (y0 + y1) / 2, z + .5, .09, .14, Math.hypot(1, y1 - y0));
      rail.rotation.x = Math.atan2(y0 - y1, 1);
    }
    const cart = a.cart(root); cart.root.position.set(0, ground(0, 6) + .3, 6);
    cart.root.rotation.x = Math.atan2(ground(0, 5.5) - ground(0, 6.5), 1); cart.parcel.visible = false;
    // Low tipple, deliberately closed. Nobody has closed the mailbox.
    const shed = new THREE.Group(); shed.position.set(8, 0, -1); shed.rotation.y = -.15; root.add(shed);
    for (const x of [-2, 2]) for (const z of [-1.6, 1.6]) a.box(shed, 0x655c4a, x, 1.6, z, .25, 3.2, .25);
    for (let i = 0; i < 10; i++) a.box(shed, i % 2 ? 0x7d7764 : 0x6d6c5e, -2 + i * .43, 2, -1.6, .38, 1.8, .15);
    const roof = a.box(shed, 0x666f67, 0, 3.3, 0, 5.2, .22, 4.3); roof.rotation.z = -.09;
    a.box(shed, 0x514a3c, 0, 1.1, 0, 3, .35, 2.5);
    for (let i = 0; i < 9; i++) a.shape(root, a.rock, 0x202b2d, -6 + Math.sin(i * 7) * 1.8, .4 + (i % 3) * .18, 2 + Math.cos(i * 3) * 1.4, 1.7, 1 + (i % 2) * .4, 1.5);
    const signGround = ground(-5.2, 7.7);
    const sign = a.board(root, ['MABOU MINES', 'COLLIERY · CLOSED', this.just ? 'KEEP CLEAR' : 'MAIL STILL COMES'], -5.2, signGround + 2.6, 7.7, 5.2, 2.4); sign.rotation.z = -.09;
    const post = a.box(root, 0x746449, -5.2, signGround + 1.5, 7.6, .18, 3, .18); post.rotation.z = -.09;
    a.box(root, 0x766b53, 3.6, .85, 1, .2, 1.7, .2);
    a.box(root, 0x70817a, 3.6, 1.65, 1, 1.05, .65, .7);
    a.board(root, [this.just ? 'CLOSED' : 'NIGHT SHIFT'], 3.6, 1.7, 1.36, 1, .42);
    a.box(root, 0xbd633d, 4.17, 1.8, 1, .08, .6, .12);
    return root;
  }
}
