import * as THREE from 'three';
import { ArchCulvert } from './culvert';
import type { Road } from './roads';
import type { Streams } from './streams';

export interface Crossing { x: number; z: number; heading: number; scale: number; length: number; road: number; cover: { x: number; z: number }[] }
/** A deck centre line. Modern bridge spans (#156) also cover crossings whose map roads carry no bridge flag. */
export interface BridgeLine { readonly pts: readonly (readonly [number, number])[]; readonly halfWidth: number }
/** The bake removes open-water segments beneath roads. Its mouth pairs restore those stream runs.
 * Use the shipped pairs, not open-water intersections, which mostly find unpiped farm tracks. */
export function streamCrossings(streams: Streams, roads: readonly Road[], spans: readonly BridgeLine[] = []): Crossing[] {
  const bridges: readonly BridgeLine[] = [...roads.filter(r => r.bridge), ...spans], byId = new Map(roads.map(r => [r.id, r]));
  // Bounding boxes of every non-bridge road, so each run tests only the roads near it.
  const boxes = roads.filter(r => !r.bridge && r.pts.length > 1).map(r => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of r.pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    const pad = r.halfWidth + .5;
    return { r, x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
  });
  const result: Crossing[] = [];
  for (const pipe of streams.pipes) {
    const road = byId.get(pipe.road);
    if (!road || road.bridge) continue;
    const dx = pipe.endX - pipe.x, dz = pipe.endZ - pipe.z;
    const x = (pipe.x + pipe.endX) / 2, z = (pipe.z + pipe.endZ) / 2;
    const length = Math.hypot(dx, dz), scale = Math.min(1, pipe.dia / 4.1);
    if (bridges.some(b => distanceToRoad(x, z, b) <= b.halfWidth + Math.hypot(length / 2 + .3, 6.1 * scale) + 3)) continue;
    // A later road-bed bake moved one shipped pair away from its road. It is no longer a crossing.
    let own = false;
    for (let d = 0; d <= Math.ceil(length) && !own; d++) {
      const t = Math.min(1, d / length);
      own = distanceToRoad(pipe.x + dx * t, pipe.z + dz * t, road) <= road.halfWidth + .5;
    }
    if (!own) continue;
    // Fill and crown samples under every road the arch passes beneath, not only the road it was mapped to: a long
    // run can also pass under a highway beside it. Samples either side of the axis catch a road that crosses the
    // arch at an angle and falls away across its width.
    const side = .5 * 4.822 * scale, nx = -dz / length, nz = dx / length;
    const near = boxes.filter(b => Math.max(pipe.x, pipe.endX) + side >= b.x0 && Math.min(pipe.x, pipe.endX) - side <= b.x1
      && Math.max(pipe.z, pipe.endZ) + side >= b.z0 && Math.min(pipe.z, pipe.endZ) - side <= b.z1).map(b => b.r);
    const cover: { x: number; z: number }[] = [];
    for (let d = 0; d <= Math.ceil(length); d++) {
      const t = Math.min(1, d / length);
      for (const o of [0, -side, side]) {
        const px = pipe.x + dx * t + nx * o, pz = pipe.z + dz * t + nz * o;
        if (near.some(r => distanceToRoad(px, pz, r) <= r.halfWidth + .5)) cover.push({ x: px, z: pz });
      }
    }
    result.push({ x, z, heading: Math.atan2(dx, -dz), scale, length, road: road.id, cover });
  }
  return result;
}

function nearestRoadPoint(x: number, z: number, road: Pick<BridgeLine, 'pts'>): { x: number; z: number } {
  let best = Infinity, point = { x, z };
  for (let k = 1; k < road.pts.length; k++) {
    const [ax, az] = road.pts[k - 1], dx = road.pts[k][0] - ax, dz = road.pts[k][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const px = ax + t * dx, pz = az + t * dz, distance = Math.hypot(x - px, z - pz);
    if (distance < best) { best = distance; point = { x: px, z: pz }; }
  }
  return point;
}
function distanceToRoad(x: number, z: number, road: Pick<BridgeLine, 'pts'>): number {
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
    private revision?: () => number, spans: readonly BridgeLine[] = []) {
    this.crossings = streamCrossings(streams, roads, spans);
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
