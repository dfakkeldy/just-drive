import * as THREE from 'three';
import { ArchCulvert } from './culvert';
import type { Road } from './roads';
import type { Streams } from './streams';

export interface Crossing { x: number; z: number; heading: number; scale: number; length: number; road: number; cover: { x: number; z: number }[] }
interface IndexedRoad {
  r: Road;
  x0: number; z0: number; x1: number; z1: number;
  // Chunks of 16 segments: [x0, z0, x1, z1, startSeg, endSeg]
  chunks: Float64Array;
}

function indexRoad(r: Road): IndexedRoad {
  const pts = r.pts, segs = Math.max(0, pts.length - 1);
  const CHUNK = 16, nChunks = Math.ceil(segs / CHUNK);
  const chunks = new Float64Array(nChunks * 6);
  let rx0 = Infinity, rz0 = Infinity, rx1 = -Infinity, rz1 = -Infinity;
  for (let c = 0; c < nChunks; c++) {
    const k0 = c * CHUNK + 1, k1 = Math.min(pts.length - 1, (c + 1) * CHUNK);
    let cx0 = pts[k0 - 1][0], cz0 = pts[k0 - 1][1], cx1 = cx0, cz1 = cz0;
    for (let k = k0; k <= k1; k++) {
      const px = pts[k][0], pz = pts[k][1];
      if (px < cx0) cx0 = px; if (px > cx1) cx1 = px;
      if (pz < cz0) cz0 = pz; if (pz > cz1) cz1 = pz;
    }
    const o = c * 6;
    chunks[o] = cx0; chunks[o + 1] = cz0; chunks[o + 2] = cx1; chunks[o + 3] = cz1;
    chunks[o + 4] = k0; chunks[o + 5] = k1;
    if (cx0 < rx0) rx0 = cx0; if (cx1 > rx1) rx1 = cx1;
    if (cz0 < rz0) rz0 = cz0; if (cz1 > rz1) rz1 = cz1;
  }
  return { r, x0: rx0, z0: rz0, x1: rx1, z1: rz1, chunks };
}

function withinIndexedRoad(x: number, z: number, ir: IndexedRoad, limit: number): boolean {
  const eps = limit + 1e-6, epsSq = eps * eps;
  if (x < ir.x0 - eps || x > ir.x1 + eps || z < ir.z0 - eps || z > ir.z1 + eps) return false;
  const pts = ir.r.pts, chunks = ir.chunks;
  for (let o = 0; o < chunks.length; o += 6) {
    if (x < chunks[o] - eps || x > chunks[o + 2] + eps || z < chunks[o + 1] - eps || z > chunks[o + 3] + eps) continue;
    const k0 = chunks[o + 4], k1 = chunks[o + 5];
    for (let k = k0; k <= k1; k++) {
      const a = pts[k - 1], b = pts[k];
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      if (x < (ax < bx ? ax : bx) - eps || x > (ax > bx ? ax : bx) + eps
        || z < (az < bz ? az : bz) - eps || z > (az > bz ? az : bz) + eps) continue;
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const ex = x - (ax + t * dx), ez = z - (az + t * dz);
      if (ex * ex + ez * ez <= epsSq && Math.hypot(ex, ez) <= limit) return true;
    }
  }
  return false;
}

/** The bake removes open-water segments beneath roads. Its mouth pairs restore those stream runs.
 * Use the shipped pairs, not open-water intersections, which mostly find unpiped farm tracks. */
export function streamCrossings(streams: Streams, roads: readonly Road[]): Crossing[] {
  const bridges = roads.filter(r => r.bridge), byId = new Map(roads.map(r => [r.id, r]));
  const indexed = new Map<Road, IndexedRoad>();
  for (const r of roads) if (r.pts.length > 1) indexed.set(r, indexRoad(r));
  // Bounding boxes of every non-bridge road, so each run tests only the roads near it.
  const boxes: Array<{ ir: IndexedRoad; x0: number; z0: number; x1: number; z1: number }> = [];
  for (const r of roads) {
    if (r.bridge || r.pts.length <= 1) continue;
    const ir = indexed.get(r)!, pad = r.halfWidth + .5;
    boxes.push({ ir, x0: ir.x0 - pad, z0: ir.z0 - pad, x1: ir.x1 + pad, z1: ir.z1 + pad });
  }
  const result: Crossing[] = [];
  for (const pipe of streams.pipes) {
    const road = byId.get(pipe.road);
    if (!road || road.bridge) continue;
    const dx = pipe.endX - pipe.x, dz = pipe.endZ - pipe.z;
    const x = (pipe.x + pipe.endX) / 2, z = (pipe.z + pipe.endZ) / 2;
    const length = Math.hypot(dx, dz), scale = Math.min(1, pipe.dia / 4.1);
    const bridgeMargin = Math.hypot(length / 2 + .3, 6.1 * scale) + 3;
    if (bridges.some(b => { const ir = indexed.get(b); return ir ? withinIndexedRoad(x, z, ir, b.halfWidth + bridgeMargin) : distanceToRoad(x, z, b) <= b.halfWidth + bridgeMargin; })) continue;
    // A later road-bed bake moved one shipped pair away from its road. It is no longer a crossing.
    const ownIndexed = indexed.get(road);
    const steps = Math.ceil(length), ownLimit = road.halfWidth + .5;
    let own = false;
    for (let d = 0; d <= steps && !own; d++) {
      const t = Math.min(1, d / length);
      const px = pipe.x + dx * t, pz = pipe.z + dz * t;
      own = ownIndexed ? withinIndexedRoad(px, pz, ownIndexed, ownLimit) : distanceToRoad(px, pz, road) <= ownLimit;
    }
    if (!own) continue;
    // Fill and crown samples under every road the arch passes beneath, not only the road it was mapped to: a long
    // run can also pass under a highway beside it. Samples either side of the axis catch a road that crosses the
    // arch at an angle and falls away across its width.
    const side = .5 * 4.822 * scale, nx = -dz / length, nz = dx / length;
    const pxMin = Math.min(pipe.x, pipe.endX) - side, pxMax = Math.max(pipe.x, pipe.endX) + side;
    const pzMin = Math.min(pipe.z, pipe.endZ) - side, pzMax = Math.max(pipe.z, pipe.endZ) + side;
    const near: IndexedRoad[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (pxMax >= b.x0 && pxMin <= b.x1 && pzMax >= b.z0 && pzMin <= b.z1) near.push(b.ir);
    }
    const cover: { x: number; z: number }[] = [];
    const offsets = [0, -side, side];
    for (let d = 0; d <= steps; d++) {
      const t = Math.min(1, d / length), bx = pipe.x + dx * t, bz = pipe.z + dz * t;
      for (let oi = 0; oi < 3; oi++) {
        const o = offsets[oi], px = bx + nx * o, pz = bz + nz * o;
        for (let ni = 0; ni < near.length; ni++) {
          const ir = near[ni];
          if (withinIndexedRoad(px, pz, ir, ir.r.halfWidth + .5)) { cover.push({ x: px, z: pz }); break; }
        }
      }
    }
    result.push({ x, z, heading: Math.atan2(dx, -dz), scale, length, road: road.id, cover });
  }
  return result;
}

function nearestRoadPoint(x: number, z: number, road: Road): { x: number; z: number } {
  let best = Infinity, point = { x, z };
  for (let k = 1; k < road.pts.length; k++) {
    const [ax, az] = road.pts[k - 1], dx = road.pts[k][0] - ax, dz = road.pts[k][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const px = ax + t * dx, pz = az + t * dz, distance = Math.hypot(x - px, z - pz);
    if (distance < best) { best = distance; point = { x: px, z: pz }; }
  }
  return point;
}
function distanceToRoad(x: number, z: number, road: Road): number {
  const p = nearestRoadPoint(x, z, road);
  return Math.hypot(p.x - x, p.z - z);
}

/** Scenery only. Wheels keep the surveyed land contact, including washboard and potholes. */
export class StreamCulverts {
  readonly group = new THREE.Group();
  readonly crossings: Crossing[];
  private live = new Map<Crossing, ArchCulvert>();
  private graded = new Map<Crossing, number>();
  /** `revision` changes whenever land tiles arrive or leave (terrain.dataRevision). Without it, every frame regrades. */
  constructor(streams: Streams, roads: readonly Road[], private ground: (x: number, z: number) => number | null, private low: boolean,
    private revision?: () => number) {
    this.crossings = streamCrossings(streams, roads);
    this.group.name = 'stream-culverts';
  }
  update(camera: THREE.Vector3): void {
    for (const [c, model] of this.live) if (Math.hypot(c.x - camera.x, c.z - camera.z) > 450) {
      this.group.remove(model.group);
      model.group.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); const m = o.material; if (Array.isArray(m)) m.forEach(v => v.dispose()); else m.dispose(); } });
      this.live.delete(c); this.graded.delete(c);
    }
    // Build at most one arch a frame, the nearest one first, so a far crossing never takes a slot from the one ahead.
    if (this.live.size < 16) {
      let next: Crossing | null = null, best = 350;
      for (const c of this.crossings) {
        const d = Math.hypot(c.x - camera.x, c.z - camera.z);
        if (d <= best && !this.live.has(c)) { best = d; next = c; }
      }
      if (next) {
        const model = new ArchCulvert(next.x, next.z, next.heading, Math.ceil(next.length / ArchCulvert.UNIT), this.ground, this.low, true);
        model.group.rotation.order = 'YXZ';   // yaw to the stream, then pitch along it
        model.group.scale.set(next.scale, next.scale, 1);
        this.live.set(next, model); this.group.add(model.group);
      }
    }
    const revision = this.revision?.();
    for (const [c, model] of this.live) {
      // Re-read the land only after tiles arrive or leave: it is the same land otherwise.
      if (revision !== undefined && this.graded.get(c) === revision) continue;
      if (revision !== undefined) this.graded.set(c, revision);
      // Lay the run to grade, as a culvert is laid. The low mouth sits 5 cm under its bed, deeper only where the road
      // fill is thin; the run climbs toward the upstream bed as far as 0.55 m of fill under every road sample allows.
      const fx = Math.sin(c.heading), fz = -Math.cos(c.heading), half = c.length / 2;
      const a = this.ground(c.x - fx * half, c.z - fz * half), b = this.ground(c.x + fx * half, c.z + fz * half);
      let ready = a !== null && b !== null, minCover = Infinity;
      const road: { d: number; h: number }[] = [];
      for (const { x, z } of c.cover) {
        const h = this.ground(x, z);
        if (h === null || !ready) { ready = false; break; }
        const s = (x - c.x) * fx + (z - c.z) * fz;   // -half at the A mouth, +half at the B mouth
        road.push({ d: a! <= b! ? s + half : half - s, h });   // d: distance from the low mouth
        minCover = Math.min(minCover, h);
      }
      model.group.visible = ready && Number.isFinite(minCover);
      if (model.group.visible) {
        const low = Math.min(a!, b!), high = Math.max(a!, b!), lowInvert = Math.min(low - .05, minCover - .55);
        let slope = (high - .05 - lowInvert) / c.length, room = Infinity;
        for (const { d, h } of road) if (d > 0) slope = Math.min(slope, (h - .55 - lowInvert) / d);
        slope = Math.max(0, slope);
        for (const { d, h } of road) room = Math.min(room, h - lowInvert - slope * d);
        const ia = a! <= b! ? lowInvert : lowInvert + slope * c.length, ib = a! <= b! ? lowInvert + slope * c.length : lowInvert;
        const pitch = Math.atan2(ib - ia, c.length);
        model.group.position.y = (ia + ib) / 2;
        model.group.rotation.x = pitch;
        // On a pitched run the crown stands 1/cos(pitch) higher above the invert line than its local height.
        model.group.scale.set(c.scale, Math.min(c.scale, (room - .15) * Math.cos(pitch) / 4.35), c.length / Math.cos(pitch) / model.length);
      }
    }
  }
}
