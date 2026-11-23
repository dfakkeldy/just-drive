import * as THREE from 'three';
import { railwayRoad } from './railway-road';
import { cowRest, cowRailGap, COW_REST, type CowBody, type CowGround, type CowRest } from './cow-rest';
import type { Roads, Road } from './roads';
import type { Terrain } from './terrain';
import type { AnimalPassage } from './road-animal-rules';
import { surveyedRailDamage, damageShape, DENT } from './guardrail-damage';
import { railAccess } from './guardrail-access';
import { planRailSteps, railPoint, roadLength, nearCoast, railPosts, railMetres, RAIL, type RailSpan } from './guardrail-rules';
import { LOOK, RailMesher, railMaterial } from './guardrail-look';
import { forEachPonyTrussSteelClip, PONY_TRUSS, ponyTrussSpan, type PonyTrussSpan } from './november-bridges';
import { pushOut, type Pushable, type Solid } from './parked';
import { CAR_SPEC } from './vehicle-spec';

interface Chunk { road: Road; start: number; end: number; x: number; z: number; revision: number; mesh: THREE.Mesh | null; spans: RailSpan[]; solids: Solid[]; shape?: string; low?: boolean }
const CHUNK = RAIL.chunk;
const NO_CHUNKS: readonly Chunk[] = [];
// Signed 15-bit cells fit V8 small integers (each cell spans 121.6 metres).
const cellKey = (x: number, z: number): number => (x + 16384) * 32768 + z + 16384;
export const RAIL_PLANS_PER_UPDATE = 1;
export const RAIL_SAMPLES_PER_UPDATE = 48;
export const RAIL_GROUND_QUERIES_PER_UPDATE = 512;
// Binomial weights: the height filter along a run, LOOK.smooth samples either side.
const WEIGHTS = (() => { let row = [1]; for (let n = 0; n < LOOK.smooth * 2; n++) row = [1, ...row.slice(1).map((v, i) => v + row[i]), 1]; return row; })();
/** Shares existing terrain requests. No photo textures, independent fetches, or per-post draw calls. */
export class Guardrails {
  readonly group = new THREE.Group();
  private readonly chunks: Chunk[] = [];
  private readonly bridgeSpans: PonyTrussSpan[] = [];
  private readonly bridgeDeckRev: number[] = [];
  private readonly bridgeCachedLevel: number[] = [];
  private readonly bridgeCachedY0: number[] = [];
  private readonly bridgeCachedY1: number[] = [];
  private readonly bridgeEndsScratch: [number, number] = [0, 0];
  private bridgeContactVersion = 0;
  private readonly bridgeClearPoses = new WeakMap<object, { x: number; z: number; heading: number }>();
  private activeBridgeCar: Pushable | null = null;
  private activeBridgeSpan: PonyTrussSpan | null = null;
  private activeBridgeDt = 0;
  private checkPoseX = 0;
  private checkPoseZ = 0;
  private checkPoseSinH = 0;
  private checkPoseCosH = 1;
  private checkPoseSpec: Pushable['spec'] = undefined;
  private checkPoseOverlaps = false;
  private readonly trimmedBridgeSolids: [Solid, Solid] = [
    { x: 0, z: 0, half: 0, halfWidth: 0, heading: 0 },
    { x: 0, z: 0, half: 0, halfWidth: 0, heading: 0 },
  ];
  private readonly pushBridgeMember = (sLeft: number, sRight: number, inner: number, outer: number): void => {
    this.pushTrimmedSpan(this.activeBridgeCar!, this.activeBridgeSpan!, sLeft, sRight, inner, outer, this.activeBridgeDt);
  };
  private readonly testBridgeMemberOverlap = (sLeft: number, sRight: number, inner: number, outer: number): void => {
    if (this.checkPoseOverlaps) return;
    const b = this.activeBridgeSpan!;
    const env = (this.checkPoseSpec ?? CAR_SPEC).envelope, r = Math.max(0, env.radius - 1e-6), r2 = r * r;
    for (let i = 0; i < env.circles.length; i++) {
      const off = env.circles[i], side = env.circleSides?.[i];
      const cx = this.checkPoseX + this.checkPoseSinH * off + (side ? this.checkPoseCosH * side : 0) - b.ax;
      const cz = this.checkPoseZ - this.checkPoseCosH * off + (side ? this.checkPoseSinH * side : 0) - b.az;
      const s = cx * b.ux + cz * b.uz;
      const across = Math.abs(-cx * b.uz + cz * b.ux);
      const ds = s < sLeft ? sLeft - s : s > sRight ? s - sRight : 0;
      const da = across < inner ? inner - across : across > outer ? across - outer : 0;
      if (ds * ds + da * da < r2) { this.checkPoseOverlaps = true; return; }
    }
  };
  private readonly cells = new Map<number, Chunk[]>();
  private readonly materials: (THREE.MeshLambertMaterial | undefined)[] = [];
  readonly audit = { planned: 0, pending: 0, samples: 0, queries: 0 };
  private work: { chunk: Chunk; revision: number; steps: Generator<void, RailSpan[], void> } | null = null;
  private lastLow = false;
  private lastX = Infinity; private lastZ = Infinity; private revision = -1;
  private cowFailureRevision = -1;
  private cowFailures = new WeakMap<Road, Set<string>>();
  constructor(private readonly roads: Roads, private readonly terrain: Terrain) {
    this.group.name = 'Rule placed steel guardrails';
    this.planning = this.makePlanning();
    this.access = railAccess(this.roads, this.planning.ground, this.terrain.manifest?.village, true);
    if (terrain.cartRoads) return;
    for (const road of roads.roads) {
      if (road.bridge) { if (road.ponyTruss) { const span = ponyTrussSpan(road); if (span) { this.bridgeSpans.push(span); this.bridgeDeckRev.push(-1); this.bridgeCachedLevel.push(0); this.bridgeCachedY0.push(0); this.bridgeCachedY1.push(0); } } continue; }
      if (road.kind > 3 || railwayRoad(road)) continue;
      const len = roadLength(road);
      for (let index = 0; index * CHUNK < len; index++) {
        const start = index * CHUNK;
        const end = Math.min(len, start + CHUNK), p = railPoint(road, (start + end) / 2);
        const chunk: Chunk = { road, start, end, x: p.x, z: p.z, revision: -1, mesh: null, spans: [], solids: [] };
        this.chunks.push(chunk);
        const key = cellKey(Math.floor(p.x / CHUNK), Math.floor(p.z / CHUNK));
        const list = this.cells.get(key) ?? []; list.push(chunk); this.cells.set(key, list);
      }
    }
  }
  private readonly planning: ReturnType<Guardrails['makePlanning']>;
  private access: ReturnType<typeof railAccess>;
  setObstacles(points: readonly { x: number; z: number; radius?: number }[]): void {
    this.cowFailures = new WeakMap();
    this.work = null;
    this.access = railAccess(this.roads, this.planning.ground, this.terrain.manifest?.village, true, points);
    for (const c of this.chunks) c.revision = -1;
    this.audit.pending = this.chunks.length;
  }
  update(camera: THREE.Vector3): void {
    const rev = this.terrain.dataRevision;
    this.audit.planned = this.audit.samples = this.audit.queries = 0;
    if (!this.audit.pending && rev === this.revision && this.lastLow === this.terrain.low && Math.hypot(camera.x - this.lastX, camera.z - this.lastZ) < 20) return;
    if (this.lastLow !== this.terrain.low) for (const c of this.chunks) c.revision = -1;
    if (this.lastLow !== this.terrain.low) this.work = null;
    this.lastLow = this.terrain.low; this.revision = rev; this.lastX = camera.x; this.lastZ = camera.z;
    const draw = this.terrain.low ? 180 : 650;
    if (this.planning.revision !== rev) { this.planning.clear(); this.planning.revision = rev; }
    const { ground, context, profile, turnDown, damage } = this.planning;
    const low = this.terrain.low;
    this.audit.pending = 0;
    if (this.work && Math.hypot(camera.x - this.work.chunk.x, camera.z - this.work.chunk.z) >= draw + CHUNK / 2) this.work = null;
    // Finish the active batch. Then serve the oldest near chunk, closest first, so moving cameras cannot starve new land.
    let target = this.work?.chunk ?? null, oldest = Infinity, nearest = Infinity;
    if (!target) for (const c of this.chunks) {
      const distance = Math.hypot(camera.x - c.x, camera.z - c.z);
      if (distance >= draw + CHUNK / 2 || c.revision === rev) continue;
      if (c.revision < oldest || c.revision === oldest && distance < nearest) { target = c; oldest = c.revision; nearest = distance; }
    }
    for (const c of this.chunks) {
      const near = Math.hypot(camera.x - c.x, camera.z - c.z) < draw + CHUNK / 2;
      if (c.mesh) c.mesh.visible = near;
      if (!near || c.revision === rev) continue;
      if (this.audit.planned >= RAIL_PLANS_PER_UPDATE || c !== target) { this.audit.pending++; continue; }
      const work = this.work ??= { chunk: c, revision: rev, steps: planRailSteps(c.road, ground, this.access, c.start, c.end, context) };
      let spans: RailSpan[] | null = null;
      while (this.audit.samples < RAIL_SAMPLES_PER_UPDATE && this.audit.queries < RAIL_GROUND_QUERIES_PER_UPDATE) {
        const next = work.steps.next(); this.audit.samples++;
        if (next.done) { spans = next.value; this.work = null; break; }
      }
      if (!spans) { this.audit.pending++; continue; }
      this.audit.planned++;
      c.revision = work.revision;
      if (c.revision !== rev) this.audit.pending++;
      const shapeKey = spans.map(s => {
        const i = Math.round(s.a.along / RAIL.pitch), dx = s.b.x - s.a.x, dz = s.b.z - s.a.z, len = Math.hypot(dx, dz);
        const ux = dx / len, uz = dz / len, ox = -uz * s.side, oz = ux * s.side, back = low ? 0 : LOOK.block;
        let support = '';
        for (const t of railPosts(s)) {
          const along = s.a.along + (s.b.along - s.a.along) * t;
          const metal = !!s.road.guardrailRuns?.some(r => r.posts === 'metal' && r.side === s.side && along >= r.start && along <= r.end);
          const postBack = metal ? .05 : LOOK.post / 2;
          support += this.postSoil(s.a.x + dx * t + ox * (back + postBack),
            s.a.z + dz * t + oz * (back + postBack), ux, uz, ox, oz, metal) + ',';
        }
        return [s.a.along, s.side, s.runStart, s.runEnd, profile(s.road, s.side, i), profile(s.road, s.side, i + 1),
          turnDown(s.road, s.side, s.runStart), turnDown(s.road, s.side, s.runEnd), this.terrain.heightAt(s.a.x, s.a.z), support].join(',');
      }).join(';');
      // Rebuild only if placement, ground profile or detail changes; camera movement cannot churn GPU buffers.
      if (c.shape === shapeKey && c.low === low) continue;
      c.shape = shapeKey; c.low = low;
      c.spans = spans; c.solids.length = 0;
      if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
      if (!spans.length) continue;
      const m = new RailMesher(low);
      for (const s of spans) {
        const a = s.a, b = s.b, i = Math.round(a.along / RAIL.pitch);
        const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len, ox = -uz * s.side, oz = ux * s.side;
        const ya = profile(s.road, s.side, i) ?? this.terrain.heightAt(a.x, a.z)!, yb = profile(s.road, s.side, i + 1) ?? this.terrain.heightAt(b.x, b.z)!;
        const [ua, ub] = railMetres(s);
        // Only the spans that the one dent reaches are cut finer and bent.
        const dent = damage?.road === s.road && a.along < damage.tear + DENT.reach && b.along > damage.tear - DENT.reach ? damage : null;
        const along = (t: number) => a.along + (b.along - a.along) * t;
        const first = a.along - s.runStart < RAIL.postPitch, last = s.runEnd - b.along < RAIL.postPitch;
        const startFall = first ? turnDown(s.road, s.side, s.runStart) : 0, endFall = last ? turnDown(s.road, s.side, s.runEnd) : 0;
        const drop = (t: number) => startFall * Math.max(0, 1 - (along(t) - s.runStart) / RAIL.postPitch)
          + endFall * Math.max(0, 1 - (s.runEnd - along(t)) / RAIL.postPitch);
        const shape = (t: number) => damageShape(along(t), dent);
        m.beam({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ya, yb, ua, ub, side: s.side, pieces: dent ? low ? 2 : 4 : 1, shape, drop, capStart: a.along === s.runStart, capEnd: b.along === s.runEnd });
        for (const t of railPosts(s)) {
          // Posts stand behind the beam, square to it. A post in the dent leans back with the beam it holds.
          const d = shape(t), top = ya + (yb - ya) * t + LOOK.top - drop(t) - d.sag, back = low ? 0 : LOOK.block;
          const metal = !!s.road.guardrailRuns?.some(r => r.posts === 'metal' && r.side === s.side && along(t) >= r.start && along(t) <= r.end);
          const lx = a.x + dx * t, lz = a.z + dz * t, postBack = metal ? .05 : LOOK.post / 2;
          const px = lx + ox * (back + postBack), pz = lz + oz * (back + postBack);
          // The dent leans the top, not the foot. All four foot corners enter drawn soil.
          const soil = Math.min(top - .3, this.postSoil(px, pz, ux, uz, ox, oz, metal));
          m.post(px, pz, ux, uz, ox, oz, Math.min(soil - .08, Math.max(soil - LOOK.bury, top - LOOK.maxPostLeg)), top + LOOK.postProud + d.lip, d.bend, metal);
          if (!low) {
            const mid = top - LOOK.depth / 2;
            m.block(lx + ox * (d.bend + LOOK.block / 2), lz + oz * (d.bend + LOOK.block / 2), ux, uz, ox, oz, mid - LOOK.blockTall / 2, mid + LOOK.blockTall / 2);
          }
        }
        c.solids.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, heading: Math.atan2(dx, -dz), half: len / 2 + .03, halfWidth: .15 });
      }
      if (!this.group.parent) this.roads.group?.add(this.group);
      const material = this.materials[Number(low)] ??= railMaterial(low);
      c.mesh = new THREE.Mesh(m.geometry(), material); c.mesh.name = 'W-beam and timber posts'; this.group.add(c.mesh);
    }
  }
  /** Shared by the rebuild key and mesher: a changed bank must move existing feet too. */
  private postSoil(px: number, pz: number, ux: number, uz: number, ox: number, oz: number, metal = false): number {
    let soil = Infinity;
    for (let u = -1; u <= 1; u += 2) for (let v = -1; v <= 1; v += 2) {
      const ha = metal ? .035 : LOOK.post / 2, ho = metal ? .05 : LOOK.post / 2;
      const x = px + ux * u * ha + ox * v * ho, z = pz + uz * u * ha + oz * v * ho;
      const h = this.terrain.meshHeightAt?.(x, z, true) ?? this.terrain.heightAt(x, z);
      if (h !== null) soil = Math.min(soil, h);
    }
    return soil;
  }
  /** Keep closures, access index and caches across every yielded planning frame. */
  private makePlanning() {
    const surface = (x: number, z: number) => { this.audit.queries++; return this.terrain.surfaceAt(x, z); };
    const height = (x: number, z: number) => { this.audit.queries++; return this.terrain.heightAt(x, z); };
    const ground = (x: number, z: number, broad = false): number | null => {
      const s = surface(x, z);
      if (!s || s.level < (broad ? 6 : 8)) return null;
      return s.ground > this.terrain.seaLevel ? this.terrain.seaLevel + (s.ground - this.terrain.seaLevel) / this.terrain.exag : s.ground;
    };
    const damage = surveyedRailDamage(this.roads, this.terrain.manifest?.village);
    const coastCache = new Map<string, boolean>();
    const context = { canopy: (x: number, z: number) => surface(x, z)?.canopy ?? 0,
      coast: (road: Road, s: number, side: number) => {
        const key = `${road.id},${Math.round(s / 30)},${side}`;
        let value = coastCache.get(key); if (value === undefined) { value = nearCoast(road, s, side, (x,z) => {
          const h=height(x,z);return h===null?null:h>this.terrain.seaLevel?this.terrain.seaLevel+(h-this.terrain.seaLevel)/this.terrain.exag:h;
        }); coastCache.set(key, value); } return value;
      } };
    // The beam keeps one height above the ROAD EDGE, low-passed along the run. The ground under each post is far
    // rougher (a bank, a berm, a washout), and a beam that follows it waves like a ribbon. Drawn heights, finest land
    // only: every chunk that shares a sample reads the same number, so runs meet at chunk seams.
    const drawn = (x: number, z: number): number | null => { const s = surface(x, z); return s && s.level >= 8 ? s.ground : null; };
    const edges = new Map<string, number | null>();
    const edge = (road: Road, side: number, i: number): number | null => {
      if (i < 0 || i * RAIL.pitch > roadLength(road)) return null;
      const key = `${road.id},${side},${i}`;
      let h = edges.get(key);
      if (h === undefined) {
        const e = railPoint(road, i * RAIL.pitch, side * road.halfWidth), p = railPoint(road, i * RAIL.pitch, side * (road.halfWidth + RAIL.shoulder));
        const road0 = drawn(e.x, e.z), post = drawn(p.x, p.z);
        h = road0 === null ? post : post === null ? road0 : Math.max(road0, post - LOOK.berm);
        edges.set(key, h);
      }
      return h;
    };
    const profile = (road: Road, side: number, i: number): number | null => {
      let sum = 0, weight = 0;
      for (let k = -LOOK.smooth; k <= LOOK.smooth; k++) { const h = edge(road, side, i + k); if (h !== null) { sum += h * WEIGHTS[k + LOOK.smooth]; weight += WEIGHTS[k + LOOK.smooth]; } }
      return weight ? sum / weight : null;
    };
    // Meet the actual soil, including a rising bank or a notch. Fixed fall clamps bury or float the terminal.
    const terminalFalls = new Map<string, number>();
    const turnDown = (road: Road, side: number, along: number): number => {
      const key = `${road.id},${side},${along}`, cached = terminalFalls.get(key);
      if (cached !== undefined) return cached;
      const i = Math.round(along / RAIL.pitch), p = railPoint(road, along, side * (road.halfWidth + RAIL.shoulder));
      const top = profile(road, side, i), soil = this.terrain.meshHeightAt?.(p.x, p.z, true) ?? this.terrain.heightAt(p.x, p.z);
      const fall = top === null || soil === null ? .4 : top + LOOK.top - LOOK.depth / 2 - soil - LOOK.endClear;
      terminalFalls.set(key, fall); return fall;
    };
    return { ground, context, profile, turnDown, damage, revision: -1,
      clear: () => { coastCache.clear(); edges.clear(); terminalFalls.clear(); } };
  }
  /** Use real plans, including empty uphill plans. Wait for the local plan before choosing a home. */
  cowRest(road: Road, along: number, side: number, ground: CowGround): CowRest | null {
    const local = this.chunks.filter(c => c.road === road && c.end >= along - COW_REST.localReach && c.start <= along + COW_REST.localReach);
    if (!local.length || local.some(c => c.revision !== this.terrain.dataRevision)) return null;
    if (this.cowFailureRevision !== this.terrain.dataRevision) {
      this.cowFailureRevision = this.terrain.dataRevision; this.cowFailures = new WeakMap();
    }
    const key = `${along},${side}`;
    if (this.cowFailures.get(road)?.has(key)) return null;
    let pending = false;
    const home = cowRest(road, along, side, ground, body => {
      if (this.cowRoadClearance(body, road) < COW_REST.roadGap - 1e-6) return false;
      const gap = this.cowClearance(body); pending ||= gap === -Infinity;
      return gap >= COW_REST.clearance - 1e-6;
    }, (x, z) => this.terrain.heightAt(x, z));
    // Unknown rail plans can finish without a terrain revision; retry those instead of caching them.
    if (!home && !pending) {
      let failures = this.cowFailures.get(road);
      if (!failures) this.cowFailures.set(road, failures = new Set());
      failures.add(key);
    }
    return home;
  }
  private cowRoadClearance(body: CowBody, ownRoad: Road): number {
    let minimum = Infinity;
    this.roads.forEachNearbySegment(body.x, body.z, Math.hypot(body.halfWidth, body.halfLength) + COW_REST.roadGap, (road, segment) => {
      const a = road.pts[segment], b = road.pts[segment + 1];
      minimum = Math.min(minimum, cowRailGap(body, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }) + COW_REST.railHalf - road.halfWidth);
    }, ownRoad); // cowRest already measured the entire own road once for this candidate.
    return minimum;
  }
  cowClearance(body: CowBody): number {
    const x = Math.floor(body.x / CHUNK), z = Math.floor(body.z / CHUNK);
    let minimum = Infinity;
    for (let j = z - 1; j <= z + 1; j++) for (let i = x - 1; i <= x + 1; i++) for (const c of this.cells.get(cellKey(i, j)) ?? NO_CHUNKS) {
      if (c.revision === this.terrain.dataRevision) {
        for (const span of c.spans) minimum = Math.min(minimum, cowRailGap(body, span.a, span.b));
        continue;
      }
      // An unplanned close corridor is unknown, never proof that a rail is absent.
      for (let side = -1; side <= 1; side += 2) {
        const offset = side * (c.road.halfWidth + RAIL.shoulder);
        for (let station = Math.round(c.start / RAIL.pitch); station < Math.floor((c.end + 1e-7) / RAIL.pitch); station++) {
          const a = railPoint(c.road, station * RAIL.pitch, offset), b = railPoint(c.road, (station + 1) * RAIL.pitch, offset);
          if (cowRailGap(body, a, b) < COW_REST.clearance) return -Infinity;
        }
      }
    }
    return minimum;
  }
  /** Distinguish unfinished plans from actual rails, so accepted animals survive unrelated tile arrivals.
   * Uses the same retained spans as drawing and collision, including terminals. */
  animalPassage(x: number, z: number, radius: number): AnimalPassage {
    let pending = false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      for (const c of this.cells.get(cellKey(i, j)) ?? NO_CHUNKS) {
        if (Math.hypot(x-c.x,z-c.z) > CHUNK / 2 + c.road.halfWidth + RAIL.shoulder + radius + 2) continue;
        if (c.revision !== this.terrain.dataRevision) pending = true;
        for (const s of c.spans) {
          const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,len=dx*dx+dz*dz;
          const t=len ? Math.max(0,Math.min(1,((x-s.a.x)*dx+(z-s.a.z)*dz)/len)) : 0;
          if (Math.hypot(x-s.a.x-dx*t,z-s.a.z-dz*t) < radius + .35) return 'blocked';
        }
      }
    }
    return pending ? 'pending' : 'clear';
  }
  private pushTrimmedSpan(car: Pushable, b: PonyTrussSpan, sLeft: number, sRight: number, inner: number, outer: number, dt: number): void {
    const midS = (sLeft + sRight) * 0.5, half = (sRight - sLeft) * 0.5;
    const mx = b.ax + b.ux * midS, mz = b.az + b.uz * midS;
    const centre = (inner + outer) * 0.5;
    const halfWidth = (outer - inner) * 0.5;
    const left = this.trimmedBridgeSolids[0], right = this.trimmedBridgeSolids[1];
    left.x = mx + b.uz * centre; left.z = mz - b.ux * centre; left.half = half; left.halfWidth = halfWidth; left.heading = b.heading;
    right.x = mx - b.uz * centre; right.z = mz + b.ux * centre; right.half = half; right.halfWidth = halfWidth; right.heading = b.heading;
    pushOut(car, this.trimmedBridgeSolids, true, dt);
  }
  /** Read-only bank elevation cache per bridge; stays in sync with built decks and bank changes at most once per dataRevision. */
  private readBridgeEnds(index: number, rev: number): boolean {
    const id = this.bridgeSpans[index].roadId;
    const builtLevel = this.roads.bridgeDeckLevel(id);
    const curLevel = this.bridgeCachedLevel[index];
    if (builtLevel >= 8 && curLevel >= 8) return true;
    if (this.bridgeDeckRev[index] !== rev || (builtLevel >= 6 && builtLevel !== curLevel)) {
      this.bridgeDeckRev[index] = rev;
      const lvl = this.roads.bridgeBankElevations(id, this.bridgeEndsScratch);
      const y0 = lvl >= 6 ? this.bridgeEndsScratch[0] : 0;
      const y1 = lvl >= 6 ? this.bridgeEndsScratch[1] : 0;
      if (lvl !== curLevel || (lvl >= 6 && (Math.abs(y0 - this.bridgeCachedY0[index]) > 1e-9 || Math.abs(y1 - this.bridgeCachedY1[index]) > 1e-9))) {
        this.bridgeCachedLevel[index] = lvl;
        this.bridgeCachedY0[index] = y0;
        this.bridgeCachedY1[index] = y1;
        this.bridgeContactVersion++;
      }
    }
    return this.bridgeCachedLevel[index] >= 6;
  }
  /** Revision token for pony-truss bridge deck contact state; read-only and advances only when bank elevations actually upgrade. */
  get bridgeRevision(): number {
    const rev = this.terrain.dataRevision ?? 0;
    for (let i = 0; i < this.bridgeSpans.length; i++) this.readBridgeEnds(i, rev);
    return this.bridgeContactVersion;
  }
  private runBridgePass(car: Pushable, b: PonyTrussSpan, y0: number | null, y1: number | null, carHeight: number, dt: number): void {
    if (y0 !== null && y1 !== null && car.y !== undefined) {
      this.activeBridgeCar = car;
      this.activeBridgeSpan = b;
      this.activeBridgeDt = dt;
      forEachPonyTrussSteelClip(b, y0, y1, car.y, carHeight, this.pushBridgeMember);
      this.activeBridgeCar = null;
      this.activeBridgeSpan = null;
      return;
    }
    pushOut(car, b.solids, true, dt);
  }
  /** Exact, read-only per-circle clearance check against every clipped steel member on both sides (immune to opposing-push cancellation). */
  private bridgePoseClear(x: number, z: number, y: number | undefined, heading: number, spec: Pushable['spec'], b: PonyTrussSpan, y0: number | null, y1: number | null): boolean {
    this.activeBridgeSpan = b;
    this.checkPoseX = x;
    this.checkPoseZ = z;
    this.checkPoseSinH = Math.sin(heading);
    this.checkPoseCosH = Math.cos(heading);
    this.checkPoseSpec = spec;
    this.checkPoseOverlaps = false;
    if (y0 !== null && y1 !== null && y !== undefined) {
      forEachPonyTrussSteelClip(b, y0, y1, y, spec?.height ?? 1.8, this.testBridgeMemberOverlap);
    } else {
      this.testBridgeMemberOverlap(0, b.span, PONY_TRUSS.railInner, PONY_TRUSS.outerHalf);
    }
    this.activeBridgeSpan = null;
    return !this.checkPoseOverlaps;
  }
  /** Pure, side-effect-free check that a body clears every pony-truss bridge steel member without building or mutating scene meshes. */
  allowsBridge(body: { x: number; z: number; y?: number; heading: number; spec?: Pushable['spec'] }): boolean {
    if (!this.bridgeSpans.length) return true;
    const reach = (body.spec?.envelope.reach ?? 3.5) + (body.spec?.envelope.radius ?? 1.4);
    const rev = this.terrain.dataRevision ?? 0;
    for (let i = 0; i < this.bridgeSpans.length; i++) {
      const b = this.bridgeSpans[i];
      const dx = body.x - b.ax, dz = body.z - b.az;
      const along = dx * b.ux + dz * b.uz;
      if (along < -reach || along > b.span + reach) continue;
      const across = -dx * b.uz + dz * b.ux;
      if (Math.abs(across) > PONY_TRUSS.outerHalf + reach) continue;
      let y0: number | null = null, y1: number | null = null;
      if (body.y !== undefined) {
        if (!this.readBridgeEnds(i, rev)) continue;
        y0 = this.bridgeCachedY0[i];
        y1 = this.bridgeCachedY1[i];
      }
      if (!this.bridgePoseClear(body.x, body.z, body.y, body.heading, body.spec, b, y0, y1)) return false;
    }
    return true;
  }
  /** Check horizontal bounds and separate per-member steel vertical overlap before pushing against pony-truss rails. */
  private pushBridge(car: Pushable, dt: number): boolean {
    const reach = (car.spec?.envelope.reach ?? 3.5) + (car.spec?.envelope.radius ?? 1.4);
    const carHeight = car.spec?.height ?? 1.8;
    const rev = this.terrain.dataRevision ?? 0;
    let touched = false;
    for (let i = 0; i < this.bridgeSpans.length; i++) {
      const b = this.bridgeSpans[i];
      const dx = car.x - b.ax, dz = car.z - b.az;
      const along = dx * b.ux + dz * b.uz;
      if (along < -reach || along > b.span + reach) continue;
      const across = -dx * b.uz + dz * b.ux;
      if (Math.abs(across) > PONY_TRUSS.outerHalf + reach) continue;
      let y0: number | null = null, y1: number | null = null;
      if (car.y !== undefined) {
        if (!this.readBridgeEnds(i, rev)) continue;
        y0 = this.bridgeCachedY0[i];
        y1 = this.bridgeCachedY1[i];
      }
      touched = true;
      for (let pass = 0; pass < 16; pass++) {
        this.runBridgePass(car, b, y0, y1, carHeight, pass === 0 ? dt : 0);
        if (this.bridgePoseClear(car.x, car.z, car.y, car.heading, car.spec, b, y0, y1)) break;
      }
    }
    return touched;
  }
  /** Guarantee final clearance after yaw clamping: if opposing rails still wedge the body, restore its last clear pose or exit cleanly. */
  private settleBridgeClearance(car: Pushable, allowTurn: boolean): void {
    const reach = (car.spec?.envelope.reach ?? 3.5) + (car.spec?.envelope.radius ?? 1.4);
    const carHeight = car.spec?.height ?? 1.8;
    for (let i = 0; i < this.bridgeSpans.length; i++) {
      const b = this.bridgeSpans[i];
      const dx = car.x - b.ax, dz = car.z - b.az;
      const along = dx * b.ux + dz * b.uz;
      if (along < -reach || along > b.span + reach) continue;
      const across = -dx * b.uz + dz * b.ux;
      if (Math.abs(across) > PONY_TRUSS.outerHalf + reach) continue;
      let y0: number | null = null, y1: number | null = null;
      if (car.y !== undefined) {
        if (this.bridgeCachedLevel[i] < 6) continue;
        y0 = this.bridgeCachedY0[i];
        y1 = this.bridgeCachedY1[i];
      }
      // Verify true per-circle clearance after clampRailYaw; relax translation up to 16 passes if needed.
      let clear = this.bridgePoseClear(car.x, car.z, car.y, car.heading, car.spec, b, y0, y1);
      for (let pass = 0; pass < 16 && !clear; pass++) {
        this.runBridgePass(car, b, y0, y1, carHeight, 0);
        clear = this.bridgePoseClear(car.x, car.z, car.y, car.heading, car.spec, b, y0, y1);
      }
      if (!clear) {
        // Opposing rails stalled translation (body angled wider than the one-lane corridor or straddling a rail).
        const prev = this.bridgeClearPoses.get(car);
        const sameHeading = !prev || Math.abs(Math.atan2(Math.sin(prev.heading - car.heading), Math.cos(prev.heading - car.heading))) < 1e-7;
        if (prev && (allowTurn || sameHeading) && Math.hypot(prev.x - car.x, prev.z - car.z) < 2.0 &&
            this.bridgePoseClear(prev.x, prev.z, car.y, prev.heading, car.spec, b, y0, y1)) {
          car.x = prev.x; car.z = prev.z; car.heading = prev.heading;
          const alongV = car.vx * b.ux + car.vz * b.uz;
          car.vx = b.ux * alongV * 0.85; car.vz = b.uz * alongV * 0.85;
          clear = true;
        } else {
          if (allowTurn) {
            // Align heading toward the nearest bridge axis until both rails clear.
            let target = b.heading;
            if (Math.cos(target - car.heading) < 0) target += Math.PI;
            const baseHeading = car.heading;
            const delta = Math.atan2(Math.sin(target - baseHeading), Math.cos(target - baseHeading));
            for (let k = 1; k <= 12 && !clear; k++) {
              car.heading = baseHeading + delta * (k / 12);
              for (let pass = 0; pass < 8 && !clear; pass++) {
                this.runBridgePass(car, b, y0, y1, carHeight, 0);
                clear = this.bridgePoseClear(car.x, car.z, car.y, car.heading, car.spec, b, y0, y1);
              }
            }
          }
          // Move to the nearest provably clear exit at the current heading (roadway centre, outside near rail, or clear of near portal).
          if (!clear) {
            const env = (car.spec ?? CAR_SPEC).envelope;
            const sinH = Math.sin(car.heading), cosH = Math.cos(car.heading);
            let latMax = 0, lonMax = 0;
            for (let c = 0; c < env.circles.length; c++) {
              const off = env.circles[c], side = env.circleSides?.[c] ?? 0;
              const rx = sinH * off + cosH * side, rz = -cosH * off + sinH * side;
              lonMax = Math.max(lonMax, Math.abs(rx * b.ux + rz * b.uz));
              latMax = Math.max(latMax, Math.abs(-rx * b.uz + rz * b.ux));
            }
            const latHalf = latMax + env.radius, lonHalf = lonMax + env.radius;
            const curS = (car.x - b.ax) * b.ux + (car.z - b.az) * b.uz;
            const curAcross = -(car.x - b.ax) * b.uz + (car.z - b.az) * b.ux;
            const sideSign = curAcross < 0 ? -1 : 1;
            const exitS = curS < b.span * 0.5 ? -(lonHalf + 0.01) : b.span + lonHalf + 0.01;
            const outAcross = sideSign * (PONY_TRUSS.outerHalf + latHalf + 0.01);
            let bestDist = Infinity, bestX = car.x, bestZ = car.z;
            for (let opt = 0; opt < 3; opt++) {
              const sCand = opt === 2 ? exitS : curS;
              const aCand = opt === 0 ? 0 : opt === 1 ? outAcross : curAcross;
              const cx = b.ax + b.ux * sCand - b.uz * aCand;
              const cz = b.az + b.uz * sCand + b.ux * aCand;
              const d = Math.hypot(cx - car.x, cz - car.z);
              if (d < bestDist && this.bridgePoseClear(cx, cz, car.y, car.heading, car.spec, b, y0, y1)) {
                bestDist = d; bestX = cx; bestZ = cz;
              }
            }
            if (bestDist < Infinity) { car.x = bestX; car.z = bestZ; clear = true; }
          }
        }
        car.speed = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
      }
      if (clear) {
        let saved = this.bridgeClearPoses.get(car);
        if (!saved) { saved = { x: car.x, z: car.z, heading: car.heading }; this.bridgeClearPoses.set(car, saved); }
        else { saved.x = car.x; saved.z = car.z; saved.heading = car.heading; }
      }
    }
  }
  private clampRailYaw(car: Pushable, heading: number, dt: number): void {
    const yaw = Math.atan2(Math.sin(car.heading - heading), Math.cos(car.heading - heading));
    const limitedYaw = Math.max(-Math.PI / 6 * dt, Math.min(Math.PI / 6 * dt, yaw));
    car.heading = heading + limitedYaw;
    // pushOut already projects speed; an aggregate seam clamp changes that frame again.
    if (yaw !== limitedYaw) car.speed = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
  }
  /** Push a body out of only the pony-truss bridge rails (used by soloContacts for solo trailers). */
  blockBridge(car: Pushable, dt = 1 / 120): void {
    if (!this.bridgeSpans.length) return;
    const heading = car.heading;
    const touched = this.pushBridge(car, dt);
    this.clampRailYaw(car, heading, dt);
    if (touched) this.settleBridgeClearance(car, dt > 0);
  }
  /** Physics stays active outside LOW's drawing radius. The existing three-circle body envelope prevents step-through. */
  block(car: Pushable, dt = 1 / 120): void {
    const heading = car.heading;
    const x = Math.floor(car.x / CHUNK), z = Math.floor(car.z / CHUNK);
    for (let j = z - 1; j <= z + 1; j++) for (let i = x - 1; i <= x + 1; i++)
      for (const c of this.cells.get(cellKey(i, j)) ?? NO_CHUNKS) pushOut(car, c.solids, false, dt);
    const touched = this.bridgeSpans.length ? this.pushBridge(car, dt) : false;
    this.clampRailYaw(car, heading, dt);
    if (touched) this.settleBridgeClearance(car, dt > 0);
  }
}
