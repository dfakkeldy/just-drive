import * as THREE from 'three';
import type { Road } from './roads';
import type { Site, Terrain } from './terrain';

type Point = [number, number];
type Box = Site['box'];
const MOUTHS = [
  { name: 'Hunters Road', east: 618304.81, north: 5097018.04, length: 16, stop: 6.6 },
  { name: 'New Rocky Ridge Road', east: 616896.45, north: 5096721.4, length: 12, stop: 6.5 },
] as const;

// Surveyed lane mouth and the bench through the field, down to the gravel forecourt.
const VILLAGE_DRIVE: Point[] = [
  [623235.7, 5104161.56], [623235.0, 5104152], [623232.9, 5104137], [623229, 5104120],
  [623222, 5104103], [623213, 5104086], [623200, 5104064], [623190, 5104045],
  [623183, 5104025], [623179, 5104005], [623179, 5103986], [623177, 5103965],
  [623173, 5103952], [623169, 5103944], [623165, 5103940],
];

const boxOf = (points: readonly Point[], padding: number): Box => [
  Math.min(...points.map(p => p[0])) - padding, Math.min(...points.map(p => p[1])) - padding,
  Math.max(...points.map(p => p[0])) + padding, Math.max(...points.map(p => p[1])) + padding,
];
const inside = (x: number, z: number, [a, b, c, d]: Box) => x >= a && x <= c && z >= b && z <= d;

function segments(points: readonly Point[]) {
  return points.slice(1).map(([x, z], i) => {
    const [a, b] = points[i], dx = x - a, dz = z - b, length = Math.hypot(dx, dz);
    return { a, b, length, ux: dx / length, uz: dz / length };
  }).filter(s => s.length > 0);
}

function distance(points: ReturnType<typeof segments>, x: number, z: number): number {
  let min = Infinity;
  for (const { a, b, length, ux, uz } of points) {
    const dx = x - a, dz = z - b;
    const t = Math.max(0, Math.min(length, dx * ux + dz * uz));
    min = Math.min(min, Math.hypot(dx - ux * t, dz - uz * t));
  }
  return min;
}

type StopBar = { points: Point[]; box: Box; mesh?: THREE.Mesh; stamp?: string };

export class NovemberRoadDetails {
  readonly sites: Site[] = [];
  readonly bars: StopBar[] = [];
  readonly group = new THREE.Group();
  readonly added: Road[] = [];
  private readonly clearDrive: ((east: number, north: number) => boolean) | undefined;
  private readonly material = new THREE.MeshLambertMaterial({
    color: 0xceccc3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });

  constructor(data: readonly Road[], area: string, origin: readonly [number, number]) {
    this.group.name = 'Highway 19 stop lines';
    const world = ([e, n]: Point): Point => [e - origin[0], origin[1] - n];
    if (area === 'mabou') {
      const drive = VILLAGE_DRIVE.map(world);
      const line = segments(drive), end = drive[drive.length - 2];
      const box = boxOf(drive, 5);
      const width = (x: number, z: number) => Math.hypot(x - end[0], z - end[1]) < 8 ? 2.8 : 1.65;
      const clears = (x: number, z: number) => inside(x, z, box) && distance(line, x, z) <= width(x, z) + 0.7;
      this.clearDrive = (e, n) => clears(e - origin[0], origin[1] - n);
      this.sites.push({
        box, maxTexel: 2, height: (_x, _z, ground) => ground,
        surface(x, z) {
          const half = width(x, z), dist = distance(line, x, z);
          return dist <= half + 1.2 ? { dist, half, kind: 4, gravelDrive: true } : null;
        },
        clearCanopy: clears,
      });
      this.added.push({ id: 910000, name: null, kind: 4, bridge: false, halfWidth: 1.65, pts: VILLAGE_DRIVE });
    }
    for (const mouth of MOUTHS) {
      const road = data.find(r => r.name === mouth.name && r.kind === 3 && !r.bridge
        && Math.hypot(r.pts[0][0] - mouth.east, r.pts[0][1] - mouth.north) <= 1);
      if (!road) continue;
      const points = road.pts.slice(0, 7).map(world), line = segments(points);
      const box = boxOf(points, road.halfWidth + 3);
      const first = line[0], laneHalf = road.halfWidth;
      this.sites.push({
        box, maxTexel: 2, height: (_x, _z, ground) => ground,
        surface(x, z) {
          const along = (x - first.a) * first.ux + (z - first.b) * first.uz;
          const dist = distance(line, x, z);
          // Reclassify the apron on the existing field. Its distance, width and highway priority stay intact.
          return along >= -1 && along <= mouth.length && dist <= laneHalf + 1.2
            ? { dist, half: laneHalf, kind: 2, paveGravel: true } : null;
        },
      });
      let station = mouth.stop;
      const stop = line.find(s => { if (station <= s.length) return true; station -= s.length; return false; });
      if (!stop) continue;
      // Stop bar on the right-hand approach lane, facing Highway 19.
      const { a, b, ux, uz } = stop;
      const x = a + ux * station, z = b + uz * station;
      const corners: Point[] = [];
      for (let i = 0; i <= 10; i++) {
        const across = 0.12 + (laneHalf - 0.35) * i / 10;
        for (const forward of [-0.19, 0.19]) corners.push([x + forward * ux + across * uz, z + forward * uz - across * ux]);
      }
      this.bars.push({ points: corners, box: boxOf(corners, 0) });
    }
  }

  excludesTree = (east: number, north: number): boolean => this.clearDrive?.(east, north) ?? false;

  update(terrain: Terrain, camera: THREE.Vector3): void {
    for (const bar of this.bars) {
      const [x, z] = bar.points[0];
      if (Math.hypot(camera.x - x, camera.z - z) > 100) {
        if (bar.mesh) bar.mesh.visible = false;
        continue;
      }
      const stamp = terrain.drawnOver(...bar.box);
      if (!stamp) continue;
      if (bar.mesh) bar.mesh.visible = true;
      if (stamp === bar.stamp) continue;
      const ground = bar.points.map(([x, z]) => terrain.meshHeightAt(x, z, true));
      if (ground.some(y => y === null)) { if (bar.mesh) bar.mesh.visible = false; continue; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(bar.points.flatMap(([x, z], i) => [x, ground[i]! + 0.035, z]), 3));
      geo.setIndex(Array.from({ length: 10 }, (_, i) => [2*i, 2*i+2, 2*i+1, 2*i+1, 2*i+2, 2*i+3]).flat());
      geo.computeVertexNormals();
      if (bar.mesh) { bar.mesh.geometry.dispose(); bar.mesh.geometry = geo; }
      else { bar.mesh = new THREE.Mesh(geo, this.material); bar.mesh.receiveShadow = true; this.group.add(bar.mesh); }
      bar.stamp = stamp;
    }
  }
}
