import * as THREE from 'three';
import type { Terrain, Manifest } from './terrain';
import type { Place } from './places';
import { pushOut, type Pushable, type Solid } from './parked';
import { HEDGE_THICK, cemeteryPlaces, distance, drawnSolids, edgeKind, fenceSegments, inside, stoneLayout, type Cemetery, type CemeteryFile, type Point } from './cemetery-rules';

/** Anonymous decorative shapes. These are not surveyed graves or burial records. */
export function stoneGeometry(kind: number, low: boolean): THREE.BufferGeometry {
  if (kind === 2) return new THREE.BoxGeometry(0.7, 0.32, 0.42).translate(0, 0.16, 0);
  if (kind === 0 || low) return new THREE.BoxGeometry(0.62, 0.85, 0.18).translate(0, 0.425, 0);
  const shape = new THREE.Shape();
  shape.moveTo(-0.31, 0); shape.lineTo(0.31, 0); shape.lineTo(0.31, 0.62);
  shape.absarc(0, 0.62, 0.31, 0, Math.PI, false); shape.lineTo(-0.31, 0);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -0.09);
}
interface Fitted {
  mesh: THREE.InstancedMesh; samples: { a: Point; b?: Point; turn?: number }[]; signature: string;
  /** A wall piece's height and thickness (a hedge is lower and thicker than the wall). */
  height?: number; thick?: number;
}
interface Site {
  cemetery: Cemetery; group: THREE.Group; center: Point; radius: number; fitted: Fitted[]; solids: Solid[];
}
/** Shear the unit box: its end faces stay vertical at the baked endpoints on every slope. */
export function wallMatrix(a: Point, b: Point, ya: number, yb: number, origin: Point, target = new THREE.Matrix4(), height = 1, thick = 0.3): THREE.Matrix4 {
  const dx = b[0] - a[0], dz = a[1] - b[1], len = distance(a, b);
  return target.set(dx, 0, -dz / len * thick, (a[0] + b[0]) / 2 - origin[0],
    yb - ya, height, 0, (ya + yb) / 2 + 0.45 * height,
    dz, 0, dx / len * thick, origin[1] - (a[1] + b[1]) / 2,
    0, 0, 0, 1);
}
export class Cemeteries {
  readonly group = new THREE.Group();
  readonly places: Place[];
  private sites: Site[];
  private next = 0;
  private levels: { level: number; size: number; have: Set<string> }[];
  private dummy = new THREE.Object3D();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  /** In every picture, with no instance to draw: it keeps the shader built (see the constructor). */
  keeper: THREE.InstancedMesh | null = null;

  static async load(manifest: Manifest, getJson: (path: string) => Promise<unknown>, terrain: Terrain, low: boolean, area: string): Promise<Cemeteries | null> {
    const entry = (manifest as Manifest & { cemeteries?: { file: string; count: number } }).cemeteries;
    if (!entry) return null;
    try {
      const data = await getJson(entry.file) as CemeteryFile;
      if (data.crs !== 'EPSG:2961' || data.area !== area || data.cemeteries.length !== entry.count || data.cemeteries.some(c => !Array.isArray(c.wall) || !Array.isArray(c.stoneArea) || !Array.isArray(c.openings))) throw new Error('Invalid cemetery pack');
      return new Cemeteries(data.cemeteries, manifest.village, terrain, low, area as Place['area']);
    } catch (error) {
      console.warn('cemeteries unavailable', error);
      return null;
    }
  }

  constructor(readonly list: Cemetery[], private origin: Point, private terrain: Terrain, private low: boolean, area: Place['area']) {
    this.group.name = 'cemeteries';
    this.levels = Object.entries(terrain.manifest.levels).map(([level, keys]) => ({ level: Number(level), size: terrain.manifest.size / 2 ** Number(level), have: new Set(keys) })).sort((a, b) => b.level - a.level);
    this.places = cemeteryPlaces(list, area);
    const kinds = low ? [0, 2] : [0, 1, 2];
    const wall = new THREE.BoxGeometry(1, 1, 1), shapes = kinds.map(k => stoneGeometry(k, low));
    this.sites = list.map(c => {
      const group = new THREE.Group(); group.visible = false; this.group.add(group);
      const xs = c.ring.map(p => p[0]), ys = c.ring.map(p => p[1]);
      const center: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      const radius = Math.max(...c.ring.map(p => distance(p, center)));
      const fitted: Fitted[] = [], segments = fenceSegments(c, low ? 6 : 3);
      const add = (geometry: THREE.BufferGeometry, samples: Fitted['samples'], color: (i: number) => THREE.Color, height?: number, thick?: number) => {
        if (!samples.length) return;
        const mesh = new THREE.InstancedMesh(geometry, this.material, samples.length);
        // Instance bounds are refreshed after ground fitting, so off-screen sites cost no draw calls.
        samples.forEach((_, i) => { mesh.setMatrixAt(i, this.zero); mesh.setColorAt(i, color(i)); });
        group.add(mesh); fitted.push({ mesh, samples, signature: '', height, thick });
      };
      // A road-side edge can be open (no wall drawn) or a low clipped hedge (ROAD_EDGES).
      add(wall, segments.filter(([a, b]) => edgeKind(area, a, b) === 'wall').map(([a, b]) => ({ a, b })), () => new THREE.Color(0x73776f));
      add(wall, segments.filter(([a, b]) => edgeKind(area, a, b) === 'hedge').map(([a, b]) => ({ a, b })), i => new THREE.Color(0x3d5a34).multiplyScalar(0.92 + 0.16 * ((i * 7) % 5) / 4), 0.85, HEDGE_THICK);
      const stones = stoneLayout(c, low);
      for (let k = 0; k < shapes.length; k++) {
        const mine = stones.filter(s => (low && s.kind === 1 ? 0 : s.kind) === kinds[k]);
        add(shapes[k], mine.map(s => ({ a: s.point, turn: s.turn })), i => new THREE.Color().setRGB(0.32 + mine[i].shade * 0.12, 0.33 + mine[i].shade * 0.12, 0.32 + mine[i].shade * 0.13));
      }
      return { cemetery: c, group, center, radius, fitted, solids: drawnSolids(c, origin, area) };
    });
    // The sites start hidden, so three.js would build their shader at first sight, in the middle of a drive.
    // This mesh is in every picture with no instance to draw. three.js prepares the material of each mesh in its
    // draw list before it looks at the instance count, so the shader for the present lights and shadows is built
    // with the scene, and three.js builds it again by its own rules (shadow switch, other lamps, restored context).
    // It makes no draw call. It needs the instance colours: without them three.js builds a different shader.
    if (!list.length) return;
    const keeper = new THREE.InstancedMesh(wall, this.material, 1);
    keeper.setMatrixAt(0, this.zero); keeper.setColorAt(0, new THREE.Color(0xffffff));
    keeper.count = 0; keeper.frustumCulled = false;
    this.group.add(keeper); this.keeper = keeper;
  }
  /** Reuse the grass and props boundary hooks; trees do not read this predicate. Map coordinates. */
  /** Within `margin` metres of a burial ground's bounding circle (map coordinates): instant-replay marks there stay quiet. */
  readonly near = (east: number, north: number, margin: number): boolean => this.sites.some(s => Math.hypot(east - s.center[0], north - s.center[1]) <= s.radius * Math.SQRT2 + margin);
  readonly excludes = (east: number, north: number): boolean => this.sites.some(s => Math.abs(east - s.center[0]) <= s.radius && Math.abs(north - s.center[1]) <= s.radius && inside([east, north], s.cemetery.ring));

  private ground(p: Point): number | null {
    const x = p[0] - this.origin[0], z = this.origin[1] - p[1], s = this.terrain.surfaceAt(x, z);
    // Use mid land while fine tiles stream in, then refit. Requiring level 8 would leave gaps
    // in an oblique view where the terrain correctly selects coarser tiles.
    const m = this.terrain.manifest;
    const finest = this.levels.find(l => l.have.has(`${Math.floor((p[0] - m.origin[0]) / l.size)}_${Math.floor((m.origin[1] - p[1]) / l.size)}`));
    return s && finest && s.level >= Math.min(finest.level, 6) ? (this.terrain.meshHeightAt(x, z, true) ?? s.ground) : null;
  }
  update(camera: { x: number; z: number }, car?: { x: number; z: number }): void {
    const now = performance.now();
    if (now < this.next) return;
    this.next = now + 350;
    for (const site of this.sites) {
      const x = site.center[0] - this.origin[0], z = this.origin[1] - site.center[1];
      const far = Math.min(Math.hypot(camera.x - x, camera.z - z), car ? Math.hypot(car.x - x, car.z - z) : Infinity);
      site.group.visible = far < (this.low ? 600 : 1100) + site.radius;
      if (!site.group.visible) continue;
      for (const f of site.fitted) {
        const heights = f.samples.map(s => [this.ground(s.a), s.b ? this.ground(s.b) : null]);
        const signature = JSON.stringify(heights);
        if (signature === f.signature) continue;
        f.signature = signature;
        f.samples.forEach((s, i) => {
          const [ya, yb] = heights[i];
          if (ya === null || (s.b && yb === null)) { f.mesh.setMatrixAt(i, this.zero); return; }
          if (s.b) {
            f.mesh.setMatrixAt(i, wallMatrix(s.a, s.b, ya, yb!, this.origin, undefined, f.height, f.thick));
            return;
          } else {
            this.dummy.position.set(s.a[0] - this.origin[0], ya - 0.04, this.origin[1] - s.a[1]);
            this.dummy.rotation.set(0, s.turn ?? 0, 0); this.dummy.scale.set(1, 1, 1);
          }
          this.dummy.updateMatrix(); f.mesh.setMatrixAt(i, this.dummy.matrix);
        });
        f.mesh.instanceMatrix.needsUpdate = true;
        f.mesh.visible = heights.some(([a, b], i) => a !== null && (!f.samples[i].b || b !== null));
        if (f.mesh.visible) f.mesh.computeBoundingSphere();
      }
    }
  }
  resolveSolids(car: Pushable): void {
    for (const s of this.sites) {
      const x = s.center[0] - this.origin[0], z = this.origin[1] - s.center[1];
      if (Math.hypot(car.x - x, car.z - z) < s.radius + 12) pushOut(car, s.solids);
    }
  }
}
