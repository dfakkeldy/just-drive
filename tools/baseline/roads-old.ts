import * as THREE from 'three';
import type { Terrain } from './terrain';

export interface Road {
  id: number;
  name: string | null;
  kind: number;          // 1 highway, 2 paved, 3 gravel, 4 track, 5 rail trail
  halfWidth: number;
  bridge: boolean;
  pts: [number, number][];   // world x, z (converted on load)
}

export interface RoadHit { road: Road; dist: number; x: number; z: number; heading: number; seg: number; t: number }

const CELL = 64;
const bridgeRoad = (road: Road) => road.bridge;

interface Deck { road: Road; y0: number; y1: number; len: number; cum: number[]; mesh: THREE.Mesh; level: number }

/** The road network: name lookup, a place to put the car back, and bridge decks (the LiDAR ground has no bridges). */
export class Roads {
  readonly group = new THREE.Group();
  readonly roads: Road[] = [];
  private cells = new Map<string, [number, number][]>();   // cell -> [road index, segment index]
  private decks = new Map<number, Deck>();
  private deckMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3c, side: THREE.DoubleSide });
  // Bridges on tracks and on the rail trail are timber, not asphalt.
  private timberMat = new THREE.MeshLambertMaterial({ color: 0xb8a482, side: THREE.DoubleSide });

  constructor(data: { roads: { id: number; name: string | null; kind: number; halfWidth: number; bridge: boolean; pts: [number, number][] }[] },
    village: [number, number], private terrain: Terrain) {
    for (const r of data.roads) {
      const road: Road = { ...r, pts: r.pts.map(([e, n]) => [e - village[0], village[1] - n]) };
      const ri = this.roads.push(road) - 1;
      for (let s = 0; s < road.pts.length - 1; s++) {
        const [ax, az] = road.pts[s], [bx, bz] = road.pts[s + 1];
        const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
        const z0 = Math.floor(Math.min(az, bz) / CELL), z1 = Math.floor(Math.max(az, bz) / CELL);
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const key = `${cx},${cz}`;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, list = []);
          list.push([ri, s]);
        }
      }
    }
  }

  /** Nearest road within `reach` metres, optionally only roads that pass `filter`. */
  nearest(x: number, z: number, reach = 60, filter?: (r: Road) => boolean): RoadHit | null {
    let best: RoadHit | null = null;
    const span = Math.ceil(reach / CELL);
    const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
    for (let cz = cz0 - span; cz <= cz0 + span; cz++) for (let cx = cx0 - span; cx <= cx0 + span; cx++) {
      for (const [ri, s] of this.cells.get(`${cx},${cz}`) ?? []) {
        const road = this.roads[ri];
        if (filter && !filter(road)) continue;
        const [ax, az] = road.pts[s], [bx, bz] = road.pts[s + 1];
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
        const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d <= reach && (!best || d < best.dist)) best = { road, dist: d, x: px, z: pz, heading: Math.atan2(dx, -dz), seg: s, t };
      }
    }
    return best;
  }

  /** Height of a bridge deck under a point, or null when the point is not on a bridge. */
  deckHeight(x: number, z: number): number | null {
    const hit = this.nearest(x, z, 12, bridgeRoad);
    if (!hit || hit.dist > hit.road.halfWidth + 1.2) return null;
    const deck = this.deck(hit.road);
    if (!deck) return null;
    const [ax, az] = hit.road.pts[hit.seg], [bx, bz] = hit.road.pts[hit.seg + 1];
    const s = deck.cum[hit.seg] + Math.hypot(bx - ax, bz - az) * hit.t;
    return deck.y0 + (deck.y1 - deck.y0) * (s / deck.len);
  }

  /** Build decks for bridges near the camera, once the fine terrain at both ends has loaded. */
  update(cam: THREE.Vector3) {
    for (const r of this.roads) {
      if (!r.bridge || (this.decks.get(r.id)?.level ?? 0) >= 8) continue;
      const [x, z] = r.pts[0];
      if (Math.hypot(x - cam.x, z - cam.z) < 1500) this.deck(r);
    }
  }

  private deck(road: Road): Deck | null {
    const have = this.decks.get(road.id);
    if (have && have.level >= 8) return have;
    const p = road.pts, n = p.length;
    // The banks: a few metres past each end of the bridge, along its line.
    const end = (a: [number, number], b: [number, number]) => {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      return this.terrain.surfaceAt(a[0] + ((a[0] - b[0]) / d) * 3, a[1] + ((a[1] - b[1]) / d) * 3);
    };
    const s0 = end(p[0], p[1]), s1 = end(p[n - 1], p[n - 2]);
    // Level 6 (4 m) is the finest ground some bridges ever get; finer data, when it comes, rebuilds the deck.
    if (!s0 || !s1 || s0.level < 6 || s1.level < 6) return have ?? null;
    const level = Math.min(s0.level, s1.level);
    if (have) {
      if (level <= have.level) return have;
      this.group.remove(have.mesh);
      have.mesh.geometry.dispose();
    }
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const len = cum[n - 1] || 1, y0 = s0.ground + 0.05, y1 = s1.ground + 0.05;
    const w = road.halfWidth + 0.9, pos: number[] = [], idx: number[] = [];
    // Cross-section: deck top, thick sides, and a low rail on each edge.
    const profile: [number, number][] = [[-w, -0.9], [-w, 0.75], [-w + 0.18, 0.75], [-w + 0.18, 0], [w - 0.18, 0], [w - 0.18, 0.75], [w, 0.75], [w, -0.9]];
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(i - 1, 0)], b = p[Math.min(i + 1, n - 1)];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / d, nz = (b[0] - a[0]) / d;
      const y = y0 + (y1 - y0) * (cum[i] / len);
      for (const [u, v] of profile) pos.push(p[i][0] + nx * u, y + v, p[i][1] + nz * u);
      if (i < n - 1) for (let k = 0; k < profile.length - 1; k++) {
        const q = i * profile.length + k;
        idx.push(q, q + 1, q + profile.length, q + 1, q + profile.length + 1, q + profile.length);
      }
    }
    const shared = new THREE.BufferGeometry();
    shared.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    shared.setIndex(idx);
    // Flat faces: with shared corners the thin rails took the average of up and sideways, and went dark.
    const geo = shared.toNonIndexed();
    shared.dispose();
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, road.kind >= 4 ? this.timberMat : this.deckMat);
    this.group.add(mesh);
    const deck: Deck = { road, y0, y1, len, cum, mesh, level };
    this.decks.set(road.id, deck);
    return deck;
  }
}
