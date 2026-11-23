import { Guardrails } from './guardrails';
import {HistoryContacts} from './eras/history-contacts';
import * as THREE from 'three';
import type { Terrain } from './terrain';
import { eraRoadHalf } from './era';
import { timberBridge, periodBridgePlane, prepareTimberPlans, timberPlan, timberGroundPoints } from './eras/timber-bridge';
import { buildPonyTrussBridge, inPonyTrussBounds, ponyTrussBankState, ponyTrussDeckHeight, type PonyTrussAprons } from './november-bridges';

export interface Road {
  id: number;
  name: string | null;
  railway?: string | boolean;
  tags?: { railway?: string | boolean };
  kind: number;          // 1 highway, 2 paved, 3 gravel, 4 track, 5 rail trail
  guardrailRuns?: { start: number; end: number; side: number; posts: 'metal' }[];
  ponyTruss?: boolean;
  halfWidth: number;
  bridge: boolean;
  pts: [number, number][];   // world x, z (converted on load)
}

export interface RoadHit { road: Road; dist: number; x: number; z: number; heading: number; seg: number; t: number }

const CELL = 64;
const bridgeRoad = (road: Road) => road.bridge && !road.ponyTruss;

interface Deck { road: Road; y0: number; y1: number; len: number; cum: number[]; mesh: THREE.Mesh; level: number; revision?: number; bankSig?: number; drawnSig?: number; aprons?: PonyTrussAprons }

/** The road network: name lookup, a place to put the car back, and bridge decks (the LiDAR ground has no bridges). */
const NO_SEGMENTS: [number, number][] = [];   // one shared empty bucket: a query over empty cells makes no arrays
export class Roads {
  readonly group = new THREE.Group();
  readonly roads: Road[] = [];
  /** Modern bridge walks reserve space inside the parapet, before any deck is built. */
  readonly bridgeWalks = new Map<number, { side:number; width:number }>();
  private rails: Guardrails | null = null;
  get guardrails(): Guardrails | null {
    if (this.terrain.cartRoads || !this.roads.length) return null;
    if (!this.rails) { this.rails = new Guardrails(this, this.terrain); }
    return this.rails;
  }
  private cells = new Map<number, [number, number][]>();   // cell -> [road index, segment index]
  private bridgeCells = new Map<number, [number, number][]>();
  private minCX = Infinity; private minCZ = Infinity;
  private maxCX = -Infinity; private maxCZ = -Infinity;
  private columns = 0;
  private maxHalfWidth = 0;
  private decks = new Map<number, Deck>();
  private ponyTrussRoads: Road[] = [];
  private deckMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3c, side: THREE.DoubleSide });
  // Bridges on tracks and on the rail trail are timber, not asphalt.
  private timberMat = new THREE.MeshLambertMaterial({ color: 0xb8a482, side: THREE.DoubleSide });

  readonly audit={heightCandidatesMax:0,connectivityBuilds:0};
  // Per-span contacts and stamps belong to the shared bridge grid, not a second spatial index.
  private bridgeRecords=new Map<number,{road:Road;cum:number[];len:number;revision:number;dirty:boolean;notify:()=>void;startExtra:number;endExtra:number;apronStart:boolean;apronEnd:boolean;seen:Float64Array}>();
  private bridgeContacts:HistoryContacts|null=null;private bridgeDirty=true;
  private updateRevision=-1;private updateX=Infinity;private updateZ=Infinity;
  private periodMat: THREE.MeshLambertMaterial | null = null;

  // Explicit, caller-independent loaded terrain sampler: never reads camera-selected drawn tiles so camera LOD never shifts wheel support.
  private readonly readTerrainHeight = (x: number, z: number): number | null => {
    const mesh = this.terrain.meshHeightAt?.(x, z, false) ?? null;
    const surf = this.terrain.surfaceAt(x, z)?.ground ?? null;
    if (mesh !== null && surf !== null) return Math.max(mesh, surf);
    return mesh ?? surf ?? this.terrain.heightAt(x, z);
  };
  private readonly readDrawnHeight = (x: number, z: number): number | null =>
    this.terrain.meshHeightAt?.(x, z, true) ?? this.readTerrainHeight(x, z);
  private readonly readSurfaceLevel = (x: number, z: number): number => this.terrain.surfaceAt(x, z)?.level ?? 0;
  private readonly readDrawnLevel = (x: number, z: number): number =>
    typeof this.terrain.drawnLevelAt === 'function' ? (this.terrain.drawnLevelAt(x, z) ?? 0) : (this.terrain.surfaceAt(x, z)?.level ?? 0);

  private eraBridgeHit:RoadHit|null=null;private bridgeQuery=0;

  constructor(data: { roads: Road[] },
    village: [number, number], private terrain: Terrain) {
    for (const r of data.roads) {
      if (terrain.cartRoads && r.kind === 5) continue;
      const road: Road = { ...r, halfWidth: terrain.cartRoads ? eraRoadHalf(r.kind, r.halfWidth) : r.halfWidth, pts: r.pts.map(([e, n]) => [e - village[0], village[1] - n]) };
      this.roads.push(road);
      if (road.ponyTruss) this.ponyTrussRoads.push(road);
      this.maxHalfWidth = Math.max(this.maxHalfWidth, road.halfWidth);
      for (const [x, z] of road.pts) {
        const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
        this.minCX = Math.min(this.minCX, cx); this.maxCX = Math.max(this.maxCX, cx);
        this.minCZ = Math.min(this.minCZ, cz); this.maxCZ = Math.max(this.maxCZ, cz);
      }
    }
    if (this.minCX !== Infinity) {
      this.columns = this.maxCX - this.minCX + 1;
      if (![this.minCX, this.maxCX, this.minCZ, this.maxCZ,
        this.columns * (this.maxCZ - this.minCZ + 1)].every(Number.isSafeInteger)) {
        throw new RangeError('Road grid exceeds exact numeric cell range');
      }
    }
    for (let ri = 0; ri < this.roads.length; ri++) {
      const road = this.roads[ri];
      for (let s = 0; s < road.pts.length - 1; s++) {
        const [ax, az] = road.pts[s], [bx, bz] = road.pts[s + 1];
        const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
        const z0 = Math.floor(Math.min(az, bz) / CELL), z1 = Math.floor(Math.max(az, bz) / CELL);
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
          const key = this.cellKey(cx, cz);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, list = []);
          const segment: [number, number] = [ri, s];
          list.push(segment);
          if (road.bridge) {
            let bridges = this.bridgeCells.get(key);
            if (!bridges) this.bridgeCells.set(key, bridges = []);
            bridges.push(segment);
          }
        }
      }
    }
    if(terrain.cartRoads){
      prepareTimberPlans(this.roads);this.audit.connectivityBuilds=1;this.bridgeContacts=new HistoryContacts(terrain);
      for(const road of this.roads)if(road.bridge){
        const plan=timberPlan(road,this.roads),startExtra=plan.before<.001?3:0,endExtra=plan.total-plan.before-plan.own<.001?3:0;
        const cum=[0];for(let i=1;i<road.pts.length;i++)cum.push(cum[i-1]+Math.hypot(road.pts[i][0]-road.pts[i-1][0],road.pts[i][1]-road.pts[i-1][1]));
        const record={road,cum,len:cum[cum.length-1]||1,revision:-1,dirty:true,notify:()=>{},startExtra,endExtra,apronStart:false,apronEnd:false,seen:new Float64Array(road.pts.length-1)};record.notify=()=>{record.dirty=true;this.bridgeDirty=true;};this.bridgeRecords.set(road.id,record);
        for(const p of timberGroundPoints(road,cum,record.len,startExtra,endExtra))this.bridgeContacts.watch(p.x,p.z,record.notify,p.land);
      }
      const first=this.roads[0];if(first)this.eraBridgeHit={road:first,dist:0,x:0,z:0,heading:0,seg:0,t:0};
    }
  }

  // key = (cx - minCX) + columns * (cz - minCZ), in [0, columns * rows - 1].
  // The constructor checks columns * rows <= MAX_SAFE_INTEGER: each row has disjoint exact keys.
  // Bounds exclude outside cells before arithmetic (-1 is never stored), including negative/UTM cells.
  private cellKey(cx: number, cz: number): number {
    if (cx < this.minCX || cx > this.maxCX || cz < this.minCZ || cz > this.maxCZ) return -1;
    return (cx - this.minCX) + this.columns * (cz - this.minCZ);
  }

  /** Nearest road within `reach` metres, optionally only roads that pass `filter`. */
  nearest(x: number, z: number, reach = 60, filter?: (r: Road) => boolean): RoadHit | null {
    return this.query(this.cells, x, z, reach, filter);
  }

  /** Cold placement query: visit every nearby segment once, including tracks, trails and driveways.
   * Reach is measured from road edges, so wide roads in adjacent cells are included. */
  forEachNearbySegment(x: number, z: number, reach: number, visit: (road: Road, segment: number) => void, exclude?: Road): void {
    const radius = reach + this.maxHalfWidth, seen = new Set<number>();
    for (let cz = Math.floor((z - radius) / CELL); cz <= Math.floor((z + radius) / CELL); cz++)
      for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++)
        for (const [ri, segment] of this.cells.get(this.cellKey(cx, cz)) ?? NO_SEGMENTS) {
          const road = this.roads[ri], key = segment * this.roads.length + ri;
          if (road === exclude || seen.has(key)) continue;
          seen.add(key); visit(road, segment);
        }
  }

  private query(cells: Map<number, [number, number][]>, x: number, z: number, reach: number, filter?: (r: Road) => boolean): RoadHit | null {
    let best: RoadHit | null = null;
    const era=this.terrain.cartRoads&&cells===this.bridgeCells;
    let candidates=0,bestSquared=144,bestRI=Infinity;
    if(era)this.bridgeQuery++;
    const span = Math.ceil(reach / CELL);
    const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
    for (let cz = cz0 - span; cz <= cz0 + span; cz++) for (let cx = cx0 - span; cx <= cx0 + span; cx++) {
      for (const [ri, s] of cells.get(this.cellKey(cx, cz)) ?? NO_SEGMENTS) {
        const road = this.roads[ri];
        if (filter && !filter(road)) continue;
        // A segment may occupy several neighbouring cells; sample it once in an era query.
        const record=era?this.bridgeRecords.get(road.id):undefined;
        if(record){if(record.seen[s]===this.bridgeQuery)continue;record.seen[s]=this.bridgeQuery;candidates++;}
        const [ax, az] = road.pts[s], [bx, bz] = road.pts[s + 1];
        const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
        let t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
        if(record){
          const len=record.cum[s+1]-record.cum[s],raw=((x-ax)*dx+(z-az)*dz)/(len*len||1);
          if(s===0&&record.apronStart&&raw<0||s===road.pts.length-2&&record.apronEnd&&raw>1)continue;
          if(raw< -record.startExtra/len&&s===0&&record.startExtra>0||raw>1+record.endExtra/len&&s===road.pts.length-2&&record.endExtra>0)continue;
          t=Math.max(s===0?-record.startExtra/len:0,Math.min(s===road.pts.length-2?1+record.endExtra/len:1,raw));
        }
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if(era){
          // Reuse one hit and retain the era source-order tie, including extended timber approaches.
          const ex=x-ax-dx*t,ez=z-az-dz*t,squared=ex*ex+ez*ez;
          if(!(squared<144&&squared<=(road.halfWidth+1.2)**2)||best&&(squared>bestSquared||squared===bestSquared&&(ri>bestRI||ri===bestRI&&s>=best.seg)))continue;
          bestSquared=squared;bestRI=ri;best=this.eraBridgeHit!;
          best.road=road;best.dist=Math.sqrt(squared);best.x=px;best.z=pz;best.heading=Math.atan2(dx,-dz);best.seg=s;best.t=t;
        }else if (d <= reach && (!best || d < best.dist)) best = { road, dist: d, x: px, z: pz, heading: Math.atan2(dx, -dz), seg: s, t };
      }
    }
    if(era)this.audit.heightCandidatesMax=Math.max(this.audit.heightCandidatesMax,candidates);
    return best;
  }

  /** A constructed abutment supplies its own exact contact; omit the old three-metre extrapolation there. */
  trimTimberApproaches(id:number,start:boolean,end:boolean):void{const r=this.bridgeRecords.get(id);if(!r)return;if(start){r.startExtra=0;r.apronStart=true;}if(end){r.endExtra=0;r.apronEnd=true;}r.dirty=true;this.bridgeDirty=true;}

  /** Height of a bridge deck under a point, or null when the point is not on a bridge. */
  deckHeight(x: number, z: number): number | null {
    // Reject off-deck pony-truss queries before any RoadHit allocation or terrain lookup.
    if (!this.terrain.cartRoads && this.ponyTrussRoads.length) {
      for (let i = 0; i < this.ponyTrussRoads.length; i++) {
        const road = this.ponyTrussRoads[i];
        if (!inPonyTrussBounds(road, x, z)) continue;
        const deck = this.deck(road);
        return deck && deck.aprons ? ponyTrussDeckHeight(road, deck.y0, deck.y1, x, z, deck.aprons) : null;
      }
    }
    // Empty bridge buckets skip all ordinary road segments and deck work.
    const hit = this.query(this.bridgeCells, x, z, 12, bridgeRoad);
    if (!hit) return null;
    if (!this.terrain.cartRoads && hit.dist > hit.road.halfWidth + 1.2) return null;
    const deck = this.deck(hit.road);
    if (!deck) return null;
    const [ax, az] = hit.road.pts[hit.seg], [bx, bz] = hit.road.pts[hit.seg + 1];
    const s = deck.cum[hit.seg] + (this.terrain.cartRoads?deck.cum[hit.seg+1]-deck.cum[hit.seg]:Math.hypot(bx - ax, bz - az)) * hit.t;
    const plane=this.terrain.cartRoads?deck.y0+(deck.y1-deck.y0)*s/deck.len:deck.y0 + (deck.y1 - deck.y0) * (s / deck.len);
    if(!this.terrain.cartRoads||s>=0&&s<=deck.len)return plane;
    const land=this.terrain.heightAt(x,z);if(land===null)return null;
    const u=Math.max(0,Math.min(1,(s<0?s+3:deck.len+3-s)/3)),blend=u*u*(3-2*u);
    return Math.max(land,land+(plane-land)*blend);
  }

  /** Temporary canal clearance; the swing geometry awaits drawings. */
  showCanalDeck(id: number, visible: boolean) {
    const deck = this.decks.get(id);
    if (deck) deck.mesh.visible = visible;
  }

  /** Build decks for bridges near the camera, once the fine terrain at both ends has loaded. */
  update(cam: THREE.Vector3) {
    this.guardrails?.update(cam);
    if(this.terrain.cartRoads){
      this.terrain.bridgeApproaches?.update(cam);
      this.bridgeContacts!.update();
      const rev=this.terrain.dataRevision??0,x=Math.floor(cam.x/64),z=Math.floor(cam.z/64);
      if(rev===this.updateRevision&&x===this.updateX&&z===this.updateZ&&!this.bridgeDirty)return;
      this.updateRevision=rev;this.updateX=x;this.updateZ=z;this.bridgeDirty=false;
      for(const r of this.bridgeRecords.values())if(Math.hypot(r.road.pts[0][0]-cam.x,r.road.pts[0][1]-cam.z)<1500)this.deck(r.road);
      return;
    }
    for (const r of this.roads) {
      if (!r.bridge) continue;
      const have = this.decks.get(r.id);
      if (!r.ponyTruss && (have?.level ?? 0) >= 8) continue;
      const [x, z] = r.pts[0];
      if (Math.hypot(x - cam.x, z - cam.z) < 1500) this.deck(r, !!r.ponyTruss);
    }
  }

  private deck(road: Road, checkDrawn = false): Deck | null {
    if(this.terrain.cartRoads)return this.eraDeck(road);
    const have = this.decks.get(road.id), rev = this.terrain.dataRevision;
    // Wheel queries (checkDrawn=false) stay on the O(1) cache whenever terrain data revision is unchanged.
    if (have && !checkDrawn && (have.level >= 8 || (rev !== undefined && have.revision === rev))) return have;
    let drawn: { minLevel: number; sig: number } | null = null;
    if (have && checkDrawn && road.ponyTruss) {
      drawn = ponyTrussBankState(road, this.readDrawnLevel);
      if ((drawn.minLevel === 0 || drawn.sig === have.drawnSig) && (have.level >= 8 || (rev !== undefined && have.revision === rev))) return have;
    }
    const p = road.pts, n = p.length;
    // The banks: a few metres past each end of the bridge, along its line.
    const end = (a: [number, number], b: [number, number]) => {
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      return this.terrain.surfaceAt(a[0] + ((a[0] - b[0]) / d) * 3, a[1] + ((a[1] - b[1]) / d) * 3);
    };
    const s0 = end(p[0], p[1]), s1 = end(p[n - 1], p[n - 2]);
    // Level 6 (4 m) is the finest ground some bridges ever get; finer data, when it comes, rebuilds the deck.
    if (!s0 || !s1 || s0.level < 6 || s1.level < 6) return have ?? null;
    const bank = road.ponyTruss ? ponyTrussBankState(road, this.readSurfaceLevel) : null;
    if (road.ponyTruss && !drawn) drawn = ponyTrussBankState(road, this.readDrawnLevel);
    const level = bank ? Math.min(s0.level, s1.level, bank.minLevel) : Math.min(s0.level, s1.level);
    const drawnChanged = !!bank && drawn!.minLevel > 0 && drawn!.sig !== have?.drawnSig;
    const bankChanged = bank ? (bank.sig !== have?.bankSig || level > (have?.level ?? 0)) : level > (have?.level ?? 0);
    if (have) {
      if (!bankChanged && !drawnChanged) { have.revision = rev; return have; }
      this.group.remove(have.mesh);
      have.mesh.geometry.dispose();
    }
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
    const len = cum[n - 1] || 1;
    let y0 = s0.ground + 0.05, y1 = s1.ground + 0.05;
    let mesh: THREE.Mesh;
    let aprons: PonyTrussAprons | undefined;
    if (road.ponyTruss) {
      // Reuse wheel-support apron grids on camera-only LOD switches so camera movement never alters wheel height or repeats support queries.
      const reuseSupport = have && !bankChanged && have.aprons ? { aprons: have.aprons, y0: have.y0, y1: have.y1 } : undefined;
      const drawnLags = drawn!.minLevel > 0 && drawn!.sig !== bank!.sig && typeof this.terrain.meshHeightAt === 'function';
      const built = buildPonyTrussBridge(p, y0, y1, len, this.readTerrainHeight, drawnLags ? this.readDrawnHeight : this.readTerrainHeight, reuseSupport);
      y0 = built.y0; y1 = built.y1;
      aprons = built.aprons;
      this.periodMat ??= new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(built.geometry, this.periodMat);
      mesh.name = 'pony-truss-' + road.id;
      mesh.castShadow = mesh.receiveShadow = true;
    } else {
      const w = road.halfWidth + 0.9, pos: number[] = [], idx: number[] = [];
      // Cross-section: deck top, thick sides, and a low rail on each edge.
      const walk=this.bridgeWalks.get(road.id), left=walk && walk.side<0?Math.max(w,road.halfWidth+walk.width+.3):w, right=walk && walk.side>0?Math.max(w,road.halfWidth+walk.width+.3):w;
      const profile: [number, number][] = [[-left, -0.9], [-left, 0.75], [-left + 0.18, 0.75], [-left + 0.18, 0], [right - 0.18, 0], [right - 0.18, 0.75], [right, 0.75], [right, -0.9]];
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
      mesh = new THREE.Mesh(geo, road.kind >= 4 ? this.timberMat : this.deckMat);
    }
    this.group.add(mesh);
    const deck: Deck = { road, y0, y1, len, cum, mesh, level, revision: rev, bankSig: bank?.sig, drawnSig: drawn?.minLevel ? drawn.sig : have?.drawnSig, aprons };
    this.decks.set(road.id, deck);
    return deck;
  }
  private eraDeck(road:Road):Deck|null {
    this.bridgeContacts!.update();
    const r=this.bridgeRecords.get(road.id)!,have=this.decks.get(road.id),revision=this.terrain.dataRevision??0;
    if(r.revision===revision&&!r.dirty)return have??null;const changedGround=r.dirty;r.revision=revision;r.dirty=false;
    const plane=periodBridgePlane(road,this.roads,this.terrain);if(!plane)return have??null;
    if(have&&!changedGround&&(plane.level<have.level||plane.level===have.level&&Math.abs(plane.y0-have.y0)+Math.abs(plane.y1-have.y1)<.0001))return have;
    if(have){this.group.remove(have.mesh);have.mesh.geometry.dispose();}
    const plan=timberPlan(road,this.roads);
    const geo=timberBridge(road,this.terrain,r.cum,r.len,plane.y0,plane.y1,(along,x,z)=>{
      const top=plane.y0+(plane.y1-plane.y0)*along/r.len;if(along>=0&&along<=r.len)return top;
      const land=this.bridgeContacts!.read(x,z,true)??top,u=Math.max(0,Math.min(1,(along<0?along+3:r.len+3-along)/3));return Math.max(land,land+(top-land)*u*u*(3-2*u));
    },plan.before<.001&&!this.terrain.bridgeApproaches?.hasApron(road,'start')?3:0,plan.total-plan.before-plan.own<.001&&!this.terrain.bridgeApproaches?.hasApron(road,'end')?3:0,(x,z)=>this.bridgeContacts!.read(x,z));
    this.periodMat??=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(geo,this.periodMat);mesh.name='timber-bridge-'+road.id;this.group.add(mesh);
    const deck={road,y0:plane.y0,y1:plane.y1,len:r.len,cum:r.cum,mesh,level:plane.level};this.decks.set(road.id,deck);return deck;
  }
}
