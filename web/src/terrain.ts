import type { Paved } from './paved';
import type { NightShading } from './night';
import type {HistoryBridgeApproaches} from './eras/history-approaches';
import { CART_TERRAIN_FRAG, CART_WATER_MASK_FRAG } from './eras/cart-shaders';
import * as THREE from 'three';
import {STUNT_TERRAIN_FRAG} from './stunt-ground-style';
import { eraRoadField } from './era';
import { MIRROR_TERRAIN_VERT, TERRAIN_FRAG, TERRAIN_VERT, WATER_MASK_FRAG } from './shaders';
import { readFile } from './store';
import { updateCoastView } from './coast-view';
import { coastRecessUniforms, RECESSES, type RockSite } from './coast-site';
import { BROOK_SAMPLE, brookBlend, brookDistance, brookField, Streams } from './streams';
import { GroundCover, type GroundMeta, clearsGroundTrees } from './ground-cover';

export interface Manifest {
  area?: { id: string; name: string };
  origin: [number, number];
  size: number;
  tile: number;
  height: { scale: number; offset: number; min?: number; max?: number }; // encoded ground bounds, metres; absent in older bakes
  canopy: { scale: number };
  seaFloor: number;
  /** The box with fine terrain and road data, EPSG:2961 [xmin, ymin, xmax, ymax]. */
  mid?: [number, number, number, number];
  village: [number, number];
  levels: Record<string, string[]>;
  cover: { file: string; xmin: number; ymin: number; xmax: number; ymax: number; res: number; ground?:GroundMeta; classes?:Record<string,string> };
  roads?: { file: string; levels: Record<string, string[]>; encoding: { distance: number; halfWidth: number; signed?: boolean; zero?: number } };
  trees?: { level: number; record: number; tiles: string[]; count: number };
  buildings?: { file: string; count: number };
  buildingStyles?: { file: string; count: number };
  stockpiles?: { file: string; count: number };
  props?: { file: string; mailboxes: number; poles: number };
  streams?: { file: string; count: number; culverts: number; km: number };
  /** Open NSTDB designated pavement class tiles (pipeline/32_bake_paved.py); absent until installed. */
  paved?: { file: string; tiles: number; source: string };
}

/** What is under a point: ground height (metres, with exaggeration), tree or roof height, and the nearest road. */
export interface Surface {
  ground: number;
  canopy: number;
  roadDist: number;     // metres to the nearest road centreline; 99 when no road is near
  halfWidth: number;    // half of that road's driving surface
  kind: number;         // 0 none, 1 highway, 2 paved, 3 gravel, 4 track, 5 rail trail
  bridge: boolean;
  washboard: boolean;   // a road shaken into ridges
  brook: number;        // metres from the edge of a brook's water: negative in the water; 99 when none is near
  /** True only when an accepted hand-built deck supplies the driving surface. */
  deck?: boolean;
  water?: boolean;     // mapped inland water; its LiDAR return is the surface, not a measured bed
  waterLimit?: number; // drawn water/return height plus contact tolerance; airborne bodies above it stay dry
  mineral?: boolean;  // confirmed class-6 cell; handling only, never a road, grading or invented collision
  level: number;        // detail level the answer came from
}

const T = 256;          // intervals per tile; a tile has 257 samples per side
const S = T + 1;
const MAX_LOADS = 6;
const BURST_DISTANCE = 150;
// Real builds measured ~8 ms median (p90 9–11 ms): allow six median builds behind the title or while paused.
const PAUSED_BUILD_BUDGET_MS = 48;
// At the measured ~8 ms median, allow three builds after a jump without stretching the coarse-land wait.
const BURST_BUILD_BUDGET_MS = 24;
// A real-paced 1.2 km return needs about 86 spare tiles.
// Measured wanted land + 96 spares stays below the former 500-record bound.
const SPARE_CAP = 96;
const TILE_GRACE = 600, EVICT_INTERVAL = 30;
// At most two background reads (land outside the view, beyond lazyRange) at once. They start only on slots the view
// left free; decoded background tiles still hold a slot until they are built (last, one or more per frame).
const BACKGROUND_LOADS = 2;
// Maximum encoded ground metres across every tile of the baked areas (tiles baked 11-14 Nov 2026, scanned 16 Nov; rounded up to a metre).
// These maps share their wide terrain. Unknown maps use the full manifest encoding range.
const BAKED_HEIGHT_MAX: Readonly<Record<string, number>> = {
  mabou: 431, judique: 431, porthood: 431, cansocauseway: 330, pointtupper: 330, westbay: 330,
};
const segFor = (level: number) => (level >= 7 ? 128 : 64);   // mesh intervals per tile

class Tile {
  contactId=0;contactFrame=-1;contactPart=-1;
  ready = false;
  failed = false;
  tries = 0;
  retryAt = 0;      // a failed tile is asked for again after this time (ms)
  loading = false;
  lastUsed = 0;
  countedFrame = -1;
  wanted = -1;     // last frame that requested this tile, including the mirror
  prio = 0;
  /** Read only for the background (see Terrain.lazyRange); cleared once the view wants it or it is built. */
  background = false;
  backgroundFrame = -1;
  mesh: THREE.Mesh | null = null;
  mirror: { geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial } | null = null;
  mask: THREE.Mesh | null = null;
  siteChanges: Map<Site,Uint8Array> | null = null;
  ground: Float32Array | null = null;
  canopy: Float32Array | null = null;
  road: Uint8ClampedArray | null = null;   // RGBA: distance, half width, kind, visual gravel coverage
  brook: Uint8Array | null = null;         // RGBA: vector to the centre line (x, z), half width, direction of flow (see streams.ts)
  quadSea = [false, false, false, false];
  box = new THREE.Box3();
  constructor(readonly level: number, readonly i: number, readonly j: number, readonly size: number,
    readonly x0: number, readonly z0: number) {}
}

interface DecodedTile { tile: Tile; px: Uint8ClampedArray; bakedRoad: Uint8ClampedArray | null }

interface Grid { index: THREE.BufferAttribute; uvs: THREE.BufferAttribute }

async function readPng(base: string, path: string): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(await readFile(base, path), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(S, S);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, S, S).data;
}

/**
 * A hand-built place that changes the ground under it: graded pads, and surfaces painted through the road field
 * (kind 8 yard gravel, 9 concrete, 10 packed sand), so the picture and the wheels agree. Add before the first tile loads.
 */
export interface Site {
  /** World box [x0, z0, x1, z1] outside which the site changes nothing. */
  box: [number, number, number, number];
  /** True ground height in metres, given the surveyed one. */
  height(x: number, z: number, surveyed: number, level?:number): number;
  /** The surface at a point: metres from an imaginary centre line, half width in metres, and kind. */
  surface(x: number, z: number,ground?:number,level?:number): { dist: number; half: number; kind: number;coverage?:number } | null;
  /** Kind 11 is visual gravel in the unused road alpha channel; RGB driving data stays untouched. */
  visualGravel?: boolean;
  /** Metres per sample of the coarsest tile this site is part of. A tile with no baked road field gets its own 257 x 257 texture
   *  only because a site overlaps it, so a site too small to show on coarse tiles names the limit and costs them nothing.
   *  Coarser tiles leave the site out of build() (height, clearCanopy, paint and the road-canopy fade under it; its `clear`
   *  boxes still apply), so only a site that keeps the surveyed height may set it. */
  maxTexel?: number;
  /** Use native one-metre samples only in these fine-tile cells. */
  /** Keep surveyed height and driving metadata on mapped roads, tracks and trails. */
  preserveRoads?: boolean;
  /** Tiles that overlap this site compile the AIRPORT runway-marking shader code; no other tile changes. */
  airportMarkings?: boolean;
  /** Local changed ground may use the visible mesh for physical wheel contact. */
  contactMesh?(x:number,z:number):number;
  /** Exact oriented clearing, avoiding oversized axis-aligned clearance boxes. */
  clearCanopy?(x:number,z:number,level?:number):boolean;
  /** Packed earth, loose gravel, native grass, and opacity; visual bytes only. */
  visualStyle?(x:number,z:number,target:Uint8Array,index:number,level?:number):void;
  visualStyleLevels?:readonly number[];
  /** Exact visible cap of a filled structure. There is no route beneath this ground. */
  groundHeight?(x:number,z:number):number|null;
  /** Driving metadata is applied only when this same deck passes the body-height gate. */
  deckDriving?: {kind:number;halfWidth:number} | ((x:number,z:number) => {kind:number;halfWidth:number});
  /** True water elevation for a mapped inland pool; null outside its polygon. */
  waterLevel?(x:number,z:number):number|null;
  /** Optional exact deck on top of the land. The callback samples land only, without any decks. */
  deckHeight?(x: number, z: number, ground: (x: number, z: number) => number | null, ceiling?: number): number | null;
}

/** Apply a runtime field sample. Kind 11 only paints; it cannot change a mapped road's driving samples. */
export function paintSiteSurface(road:Uint8ClampedArray,k:number,f:{dist:number;half:number;kind:number;coverage?:number},zero:number,dScale:number,wScale:number):void {
  if(f.coverage!==undefined)road[k+3]=Math.round(Math.max(0,Math.min(1,f.coverage))*255);
  if(f.kind===11){road[k+3]=Math.max(0,Math.min(255,Math.round((2+f.half-f.dist)*255/4)));return;}
  const flags=road[k+2];
  if(flags>0 && (flags&15)<=3 && Math.abs(road[k]-zero)*dScale<road[k+1]*wScale+1.2)return;
  road[k]=Math.min(255,zero+Math.round(f.dist/dScale));road[k+1]=Math.min(255,Math.round(f.half/wScale));road[k+2]=f.kind;
}

export class Terrain {
  readonly group = new THREE.Group();
  bridgeApproaches:HistoryBridgeApproaches|null=null;
  dataRevision = 0;
  contactRevision = 0;
  private eraSiteCount=-1;private eraDeckSites:Site[]=[];private eraContactSites:Site[]=[];
  private contactSerial=0;
  private contactEvents:Float64Array|null=null;
  private contactSelected:Tile[]=[];private contactPrevious:Tile[]=[];
  /** Primary LOD selection includes off-screen tiles; a turn cannot switch them to older cached detail. */
  private selectedContactTile(x:number,z:number):Tile|null {
    const m=this.manifest,e=x+m.village[0]-m.origin[0],s=z-(m.village[1]-m.origin[1]);
    for(let level=this.maxLevel;level>=0;level--){const size=m.size/2**level,t=this.tiles.get(`${level}/${Math.floor(e/size)}_${Math.floor(s/size)}`);if(!t?.ready||!t.mesh||t.contactFrame!==this.frame)continue;const q=(x>=t.x0+size/2?1:0)|(z>=t.z0+size/2?2:0);if(t.contactPart===0||(t.contactPart&(1<<q)))return t;}
    return null;
  }
  /** A tile's loaded geometry identifies the source. Entering/leaving the view does not. */
  meshContactSource(x:number,z:number,land=false):number {
    const t=(land?null:this.cartRoads&&this.selectedContactTile?this.selectedContactTile(x,z):this.drawnTile(x,z))??this.find(x,z);
    return t?.mesh?(t.contactId||t.level*100000000+t.i*10000+t.j):-1;
  }
  meshContactAt(x:number,z:number,out:{height:number;source:number;drawn:boolean}):boolean {
    const visible=this.cartRoads&&this.selectedContactTile?this.selectedContactTile(x,z):this.drawnTile(x,z),t=visible??this.find(x,z);if(!t?.mesh)return false;
    out.height=this.triangleHeight(t,x,z);out.source=t.contactId||t.level*100000000+t.i*10000+t.j;out.drawn=!!t.mesh.visible;return true;
  }
  private contactTile(t:Tile):void {
    this.contactRevision++;this.contactEvents??=new Float64Array(4096*5);
    const k=(this.contactRevision%4096)*5;this.contactEvents[k]=this.contactRevision;
    this.contactEvents[k+1]=t.x0;this.contactEvents[k+2]=t.z0;this.contactEvents[k+3]=t.x0+t.size;this.contactEvents[k+4]=t.z0+t.size;
  }
  /** Bounded change history. A reader that fell behind resamples its own cached points once. */
  meshContactChanges(version:number,visit:(x0:number,z0:number,x1:number,z1:number)=>void):boolean {
    if(version===this.contactRevision)return true;
    if(!this.contactEvents||version<0||this.contactRevision-version>=4096)return false;
    for(let v=version+1;v<=this.contactRevision;v++){const k=(v%4096)*5;visit(this.contactEvents[k+1],this.contactEvents[k+2],this.contactEvents[k+3],this.contactEvents[k+4]);}
    return true;
  }
  private noteSelection(t:Tile,part:number):void {
    if(!this.cartRoads)return;
    if(t.contactFrame!==this.frame-1||t.contactPart!==part)this.contactTile(t);
    t.contactFrame=this.frame;t.contactPart=part;this.contactSelected.push(t);
  }
  readonly sites: Site[] = [];
  private treeOnlyClear=new WeakSet<number[]>();
  addTreeClear(box:[number,number,number,number]):void {this.treeOnlyClear.add(box);this.clear.push(box);}
  private groundContact: { y: number } | null = null;
  private drawnContact = false;
  private body: { x: number; z: number } | null = null;

  /** Only this body's wheel queries reject decks above its present height. Other ground readers see the full deck. */
  withGroundContact<T>(body: { y: number; x?: number; z?: number }, read: () => T, drawn = false): T {
    // Keep the live car position even while a free camera pauses its physics queries.
    if (body.x !== undefined && body.z !== undefined) this.body = body as { x: number; z: number };
    const previous = this.groundContact, previousDrawn = this.drawnContact;
    this.groundContact = body; this.drawnContact = drawn;
    try { return read(); } finally { this.groundContact = previous; this.drawnContact = previousDrawn; }
  }
  /**
   * Reads the ground as the body in force would have read it at another height of its own (the height it had when it
   * last sampled its wheels). With no body in force this changes nothing.
   */
  withContactHeight<T>(body: { y: number }, read: () => T): T {
    return this.groundContact ? this.withGroundContact(body, read, this.drawnContact) : read();
  }
  readonly uniforms: Record<string, THREE.IUniform>;
  private tiles = new Map<string, Tile>();
  private exists = new Set<string>();
  private hasRoad = new Set<string>();
  private hasTrees = new Set<string>();
  /** Level 8 tiles drawn this frame; single trees are shown on exactly these. */
  readonly drawnFine = new Set<string>();
  private maxLevel = 0;
  private grids = new Map<number, Grid>();
  private mirrorIndices = new Map<number, THREE.BufferAttribute>();
  private readonly mirrorFocus = { value: new THREE.Vector2() };
  private readonly maskScene = new THREE.Scene();
  private noRoad: THREE.DataTexture;
  private coverReady: Promise<HTMLImageElement | null>;
  private coverPixels: ImageData | null = null;
  private coverRead: Promise<void> | null = null;
  private groundCover:GroundCover|null=null;
  private groundRead:Promise<void>|null=null;
  private noBrook: THREE.DataTexture;
  /** Brooks, when the land data has them. Set before the first tile loads. */
  streams: Streams | null = null;
  /** Local paint and vegetation rules; never changes measured ground or road data. */
  coast: RockSite | null = null;
  private active = 0;
  private queue: Tile[] = [];
  private builds: DecodedTile[] = [];
  private backgroundQueue: Tile[] = [];
  private backgroundLoading = new Set<Tile>();
  private readonly lazyBox = new THREE.Box3();
  private frame = 0;
  private focusX = NaN; private focusY = NaN; private focusZ = NaN;
  private bodyX = NaN; private bodyZ = NaN;
  private bursting = false;
  get burst() { return this.bursting; }
  /** The budget used by the last update, including the update that ended a burst. */
  private lastBuildMode: 'driving' | 'paused' | 'burst' = 'driving';
  get buildMode() { return this.lastBuildMode; }
  private readyCount = 0;
  private wantedCount = 0;
  private lastEvict = 0;
  private spare: Tile[] = [];
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  drawn = 0;
  /** A tile splits into finer tiles when the camera is nearer than split x its size. */
  split = 1.6;
  /** Phone mode: cheaper shading. Set before the first tile loads. */
  low = false;
  /**
   * Phones: a missing tile farther than this from the camera (metres) and outside the view is not waited for. The
   * parent keeps that quarter, and the tile is read in the background, behind every tile in view; it does not count as
   * pending. 0 (desktop) waits for every tile, as before. Everything in view is selected exactly as with 0.
   */
  lazyRange = 0;
  /** While true, background tiles are not read at all: main.ts holds them until the first pedal after a start or jump. */
  holdBackground = false;
  /** Period-only road field and shader. Set before any tile loads. */
  cartRoads = false;
  /** Optional Point Tupper class atlas, installed before any tile builds. */
  paved: Paved | null = null;
  propertyOverlay: { applyGround(material: THREE.ShaderMaterial): void } | null = null;
  /** Measured stockpile faces replace surface returns, in map coordinates. Set before tile loads. */
  canopyExcludes?: (east: number, north: number) => boolean;
  /** The light study's night: adds the lamps' light to every land tile made from here on (night.ts). */
  night: NightShading | null = null;
  /** Desktop only: the land's shader reads the sun's shadow map (the uniforms come in with `shared`). */
  shadows = false;

  /** exag stretches ground heights about sea level; trees and roofs keep their true height. */
  constructor(readonly manifest: Manifest, readonly base: string, shared: Record<string, THREE.IUniform>,
    readonly exag = 1, readonly seaLevel = 0,
    /** World-space boxes [x0, z0, x1, z1] where the canopy layer is removed, because a model stands there. */
    readonly clear: number[][] = []) {
    for (const [level, names] of Object.entries(manifest.levels)) {
      this.maxLevel = Math.max(this.maxLevel, +level);
      for (const n of names) this.exists.add(`${level}/${n}`);
    }
    for (const [level, names] of Object.entries(manifest.roads?.levels ?? {})) for (const n of names) this.hasRoad.add(`${level}/${n}`);
    for (const n of manifest.trees?.tiles ?? []) this.hasTrees.add(n);
    const c = manifest.cover;
    const [vx, vy] = manifest.village;
    let coverLoaded!: (image: HTMLImageElement | null) => void;
    this.coverReady = new Promise((resolve) => { coverLoaded = resolve; });
    const cover = new THREE.TextureLoader().load(`${base}/${c.file}`,
      (texture) => coverLoaded(texture.image as HTMLImageElement), undefined, () => coverLoaded(null));
    cover.magFilter = cover.minFilter = THREE.NearestFilter;
    cover.generateMipmaps = false;
    cover.flipY = false;
    cover.colorSpace = THREE.NoColorSpace;
    // Full tile size, because the shader reads the road field sample by sample. All zero means no road anywhere.
    this.noRoad = new THREE.DataTexture(new Uint8Array(S * S * 4), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.noRoad.needsUpdate = true;
    // A tile with no brook says so in a uniform and never reads this one sample.
    this.noBrook = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.noBrook.needsUpdate = true;
    this.uniforms = {
      airportFrame: { value: new THREE.Vector4() }, airportSize: { value: new THREE.Vector2() },
      ...shared,
      tCover: { value: cover },
      grassFocus: { value: new THREE.Vector3() },
      roadZero: { value: this.zero / 255 },
      // World x = east - village east; world z = village north - north. The cover image starts at its north-west corner.
      coverRect: { value: new THREE.Vector4(c.xmin - vx, vy - c.ymax, 1 / (c.xmax - c.xmin), 1 / (c.ymax - c.ymin)) },
    };
  }

  /** Tiny derived row runs on phones too. No full RGBA readback or extra GPU texture. */
  readGroundCover():Promise<void> {
    return this.groundRead??=(async()=>{
      const m=this.manifest.cover.ground;if(!m)return;
      if(m.version!==1)throw Error('Unsupported ground classes');
      // Root files are copied beside packs.json, not listed inside terrain packs.
      const response=await fetch(`${this.base}/${m.file}`);
      if(!response.ok)throw Error('Ground classes unavailable');
      this.groundCover=new GroundCover(await response.arrayBuffer(),m.width,m.height);
    })();
  }
  /** True once the class runs are read. Modern land only: main.ts skips the read in the 1884 era. */
  get groundClasses():boolean{return !!this.groundCover;}
  groundClassAt(x:number,z:number):number {
    if(!this.groundCover)return 0;
    const r=this.uniforms.coverRect.value as THREE.Vector4;
    return this.groundCover?.at((x-r.x)*r.z,(z-r.y)*r.w)??0;
  }

  /** Desktop plants read the existing cover image once. Phones never make this CPU copy. */
  readCover(): Promise<void> {
    return this.coverRead ??= this.coverReady.then(async (image) => {
      if (!image) throw new Error('land cover did not load');
      const pixels = new ImageData(image.width, image.height);
      const canvas = new OffscreenCanvas(image.width, 32);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      // Small strips keep the one-time readback from stopping the first drive frame.
      for (let row = 0; row < image.height; row += 32) {
        const rows = Math.min(32, image.height - row);
        ctx.drawImage(image, 0, row, image.width, rows, 0, 0, image.width, rows);
        pixels.data.set(ctx.getImageData(0, 0, image.width, rows).data, row * image.width * 4);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      this.coverPixels = pixels;
      canvas.width = canvas.height = 0;
    });
  }

  /** Same nearest-cell lookup as tCover, with unknown land outside its box. */
  coverAt(x: number, z: number): number {
    const pixels = this.coverPixels;
    if (!pixels) return 0;
    const r = this.uniforms.coverRect.value as THREE.Vector4;
    const u = (x - r.x) * r.z, v = (z - r.y) * r.w;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    return pixels.data[(Math.floor(v * pixels.height) * pixels.width + Math.floor(u * pixels.width)) * 4 + 2];
  }

  /** One grid per mesh density, with an extra ring that hangs down as a skirt to hide gaps between detail levels. */
  private grid(seg: number): Grid {
    let g = this.grids.get(seg);
    if (g) return g;
    const n = seg + 3;
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    const uv = new Float32Array(n * n * 2);
    let k = 0;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        uv[(b * n + a) * 2] = Math.min(Math.max(a - 1, 0), seg) / seg;
        uv[(b * n + a) * 2 + 1] = Math.min(Math.max(b - 1, 0), seg) / seg;
        if (a < n - 1 && b < n - 1) {
          const p = b * n + a;
          idx[k++] = p; idx[k++] = p + n; idx[k++] = p + 1;
          idx[k++] = p + 1; idx[k++] = p + n; idx[k++] = p + n + 1;
        }
      }
    }
    g = { index: new THREE.BufferAttribute(idx, 1), uvs: new THREE.BufferAttribute(uv, 2) };
    this.grids.set(seg, g);
    return g;
  }

  private tile(level: number, i: number, j: number): Tile | null {
    const key = `${level}/${i}_${j}`;
    if (!this.exists.has(key)) return null;
    let t = this.tiles.get(key);
    if (!t) {
      const size = this.manifest.size / 2 ** level;
      t = new Tile(level, i, j, size,
        this.manifest.origin[0] + i * size - this.manifest.village[0],
        this.manifest.village[1] - (this.manifest.origin[1] - j * size));
      // Until the data arrives, assume a generous height range for culling and distance.
      t.box.set(new THREE.Vector3(t.x0, -10, t.z0), new THREE.Vector3(t.x0 + size, 400 * this.exag, t.z0 + size));
      this.tiles.set(key, t);
    }
    return t;
  }

  private request(t: Tile, dist: number) {
    t.wanted = this.frame;
    this.use(t);
    t.prio = dist;
    // The view wants it now: a background read in flight or decoded counts as pending from here on.
    t.background = false;
    if (t.ready || t.loading) return;
    if (t.failed) { if (performance.now() < t.retryAt) return; t.failed = false; }
    if (!this.queue.includes(t)) this.queue.push(t);
  }

  /** A missing tile the view does not need: beyond lazyRange and outside the view, with its unknown height range. */
  private lazy(t: Tile, dist: number, mirror: boolean): boolean {
    if (!this.lazyRange || mirror || t.ready || dist <= this.lazyRange) return false;
    // An unread tile's default box is only a distance estimate. Bound all encoded land and canopy here,
    // including the skirt used by build(): coarse skirts reach much deeper than 200 m.
    const m = this.manifest;
    const rawMax = m.height.max ?? BAKED_HEIGHT_MAX[m.area?.id ?? 'mabou'] ?? 65535 * m.height.scale + m.height.offset;
    const high = rawMax > this.seaLevel ? this.seaLevel + (rawMax - this.seaLevel) * this.exag : rawMax;
    const rawMin = Math.min(m.height.min ?? m.height.offset, m.seaFloor);
    const low = rawMin > this.seaLevel ? this.seaLevel + (rawMin - this.seaLevel) * this.exag : rawMin;
    this.lazyBox.copy(t.box);
    this.lazyBox.max.y = high + 255 * m.canopy.scale;
    // A recorded minimum is the lowest PNG sample; build() can cut a little below it (the brook crease, up to
    // about 0.54 m), so keep 1 m more. Legacy manifests use the encoding offset, far below the land already.
    this.lazyBox.min.y = low - Math.max(t.size * 0.04, 6) - (m.height.min === undefined ? 0 : 1);
    return !this.frustum.intersectsBox(this.lazyBox);
  }

  private requestBackground(t: Tile, dist: number) {
    t.backgroundFrame = this.frame;
    if (this.holdBackground || t.loading) return;
    if (t.failed) { if (performance.now() < t.retryAt) return; t.failed = false; }
    t.prio = dist;
    if (!this.backgroundQueue.includes(t)) this.backgroundQueue.push(t);
  }

  private pump() {
    // Bound decoded bytes plus reads to six tiles; decoded tiles keep their slot until built.
    if (this.queue.length && this.active + this.builds.length < MAX_LOADS) {
      this.queue.sort((a, b) => a.prio - b.prio);
      while (this.queue.length && this.active + this.builds.length < MAX_LOADS) {
        const t = this.queue.shift()!;
        t.loading = true;
        this.active++;
        this.load(t).then(
          (decoded) => { this.active--; this.builds.push(decoded); },
          (e) => { this.active--; t.loading = false; this.fail(t, e); this.finishBurst(); });
      }
    }
    if (!this.backgroundQueue.length) return;
    // Drop what this frame's selection no longer asked for, what the view took over, and everything while held.
    let n = 0;
    for (const t of this.backgroundQueue) if (!this.holdBackground && t.backgroundFrame === this.frame && !t.ready && !t.loading && !this.queue.includes(t)) this.backgroundQueue[n++] = t;
    this.backgroundQueue.length = n;
    // The view went first above and took every free slot it could use, so these slots are ones it does not need.
    this.backgroundQueue.sort((a, b) => a.prio - b.prio);
    while (this.backgroundQueue.length && this.backgroundLoading.size < BACKGROUND_LOADS && this.active + this.builds.length < MAX_LOADS) {
      const t = this.backgroundQueue.shift()!;
      t.loading = true; t.background = true;
      this.active++; this.backgroundLoading.add(t);
      this.load(t).then(
        (decoded) => { this.active--; this.backgroundLoading.delete(t); this.builds.push(decoded); },
        (e) => { this.active--; this.backgroundLoading.delete(t); t.loading = false; t.background = false; this.fail(t, e); this.finishBurst(); });
    }
  }

  get pending() {
    let background = 0;
    if (this.lazyRange) {
      for (const t of this.backgroundLoading) if (t.background) background++;
      for (const d of this.builds) if (d.tile.background) background++;
    }
    return this.queue.length + this.active + this.builds.length - background + (this.paved?.pending ?? 0);
  }
  /** Wanted reads in retry back-off are not queued or active. Old, unwanted failures do not block settling. */
  get failed() { let n = 0; for (const t of this.tiles.values()) if (t.failed && t.wanted === this.frame) n++; return n; }

  /** Optional sleeping-fleet notification. It does not change the land or ordinary visits. */
  fleetGroundChanged: ((x: number, z: number, size: number) => void) | null = null;
  private readonly fleetMasks = new WeakMap<Tile, number>();
  /** Survey datum for a graded site, before any tiles are built. Does not include sites, decks or exaggeration. */
  async surveyHeightAt(x:number,z:number):Promise<number|null> {
    const m=this.manifest,e=x+m.village[0]-m.origin[0],s=z-(m.village[1]-m.origin[1]);
    for(let level=this.maxLevel;level>=0;level--){
      const size=m.size/2**level,i=Math.floor(e/size),j=Math.floor(s/size),key=`${level}/${i}_${j}`;
      if(!this.exists.has(key))continue;
      const px=await readPng(this.base,`${key}.png`),a=Math.min(T,Math.max(0,Math.round((e/size-i)*T))),b=Math.min(T,Math.max(0,Math.round((s/size-j)*T))),k=(b*S+a)*4;
      return (px[k]*256+px[k+1])*m.height.scale+m.height.offset;
    }
    return null;
  }

  private finishBurst() {
    if (this.pending === 0) this.bursting = false;
  }

  private fail(t: Tile, error: unknown) {
    t.failed = true;
    t.retryAt = performance.now() + Math.min(30000, 1000 * 2 ** t.tries++);
    console.warn('tile', t.level, t.i, t.j, error);
  }

  /** Node tools may build one idle tile immediately, using exactly the queued path's maths. */
  async loadNow(level: number, i: number, j: number): Promise<void> {
    const t = this.tile(level, i, j);
    if (!t || t.ready) return;
    if (t.loading || this.queue.includes(t)) throw new Error('tile is already pending');
    t.loading = true; this.active++;
    try { this.build(await this.load(t)); t.failed = false; }
    catch (e) { this.fail(t, e); throw e; }
    finally { t.loading = false; this.active--; }
  }

  private buildWaiting(cam: THREE.Vector3, budgetMs: number) {
    // Unwanted decoded tiles build last as spares; the queue scan allocates no arrays.
    const started = performance.now();
    let built = 0;
    while (this.builds.length) {
      let best = 0, bestRank = Infinity, bestUnder = false;
      for (let i = 0; i < this.builds.length; i++) {
        const t = this.builds[i].tile, body = this.body;
        const under = cam.z >= t.z0 && cam.z < t.z0 + t.size && cam.x >= t.x0 && cam.x < t.x0 + t.size ||
          body && body.z >= t.z0 && body.z < t.z0 + t.size && body.x >= t.x0 && body.x < t.x0 + t.size;
        // Camera/car columns first, current requests next; coarse before fine, then request distance.
        // Equal ranks keep decode arrival order. Scan in place: no per-update queue arrays.
        const rank = under ? 0 : t.wanted === this.frame ? 1 : 2;
        const previous = this.builds[best].tile;
        if (rank < bestRank || rank === bestRank && (t.level < previous.level || t.level === previous.level && t.prio < previous.prio)) {
          best = i; bestRank = rank; bestUnder = !!under;
        }
      }
      const decoded = this.builds[best], t = decoded.tile;
      try {
        this.build(decoded);
        // The pin pass ran before this tile was ready; protect a newly built camera/car column too.
        if (bestUnder) this.use(t);
      }
      catch (e) { this.fail(t, e); }
      finally {
        this.builds.copyWithin(best, best + 1); this.builds.pop();
        // No visit has used a background tile yet: without this, eviction later in this update could drop it at once.
        if (t.background) t.lastUsed = this.frame;
        t.loading = false; t.background = false;
      }
      built++;
      if (budgetMs === 0 ? built >= 1 : performance.now() - started >= budgetMs) break;
    }
    return built;
  }

  private async load(t: Tile) {
    const name = `${t.level}/${t.i}_${t.j}`;
    const withRoad = this.hasRoad.has(`${t.level}/${t.i}_${t.j}`);
    const [px, bakedRoad] = await Promise.all([readPng(this.base, `${name}.png`), withRoad ? readPng(this.base, `${name}.r.png`) : Promise.resolve(null)]);
    return { tile: t, px, bakedRoad };
  }

  private build({ tile: t, px, bakedRoad }: DecodedTile) {
    const sites = this.sites.filter((s) => !(s.box[2] < t.x0 || s.box[0] > t.x0 + t.size || s.box[3] < t.z0 || s.box[1] > t.z0 + t.size) && (s.maxTexel === undefined || t.size / T <= s.maxTexel));
    const gravelOverlay=sites.some(s=>s.visualGravel);
    const airportMarkings=sites.some(s=>s.airportMarkings);
    const road = bakedRoad ?? (sites.length ? new Uint8ClampedArray(S * S * 4) : null);
    // Brooks get a field only on the two finest levels (samples 1 m and 2 m apart). Further off a brook is a pixel
    // wide, and the field's guarantee against seams needs close samples (see BROOK_SAMPLE in streams.ts).
    const brook = this.streams && t.size / T <= BROOK_SAMPLE ? brookField(this.streams, t.x0, t.z0, t.size, S) : null;
    const { scale, offset } = this.manifest.height;
    const cs = this.manifest.canopy.scale;
    const dScale = this.manifest.roads?.encoding.distance ?? 0.1, wScale = this.manifest.roads?.encoding.halfWidth ?? 0.05;
    const zero = this.zero;
    if (this.cartRoads && road) eraRoadField(road, wScale);
    // Where single trees exist, the terrain shows bare ground and the trees stand on it.
    const hull = !(t.level === 8 && this.hasTrees.has(`${t.i}_${t.j}`));
    const mpp = t.size / T;
    const ground = new Float32Array(S * S);
    const canopy = new Float32Array(S * S);
    let lo = Infinity, hi = -Infinity;
    const tracked=sites.filter(site=>site.preserveRoads&&site.contactMesh);
    t.siteChanges=tracked.length?new Map(tracked.map(site=>[site,new Uint8Array(S*S)])):null;
    for (let k = 0; k < S * S; k++) {
      if(road && gravelOverlay)road[k*4+3]=0;
      let raw = (px[k * 4] * 256 + px[k * 4 + 1]) * scale + offset;
      for (const site of sites) {
        const x = t.x0 + (k % S) * mpp, z = t.z0 + Math.floor(k / S) * mpp;
        if (x < site.box[0] || x > site.box[2] || z < site.box[1] || z > site.box[3]) continue;
        if (site.preserveRoads && road) {
          const k4=k*4,kind=road[k4+2]&15;
          if(kind>0&&kind<=5&&Math.abs(road[k4]-zero)*dScale<road[k4+1]*wScale+2*t.size/segFor(t.level)+2)continue;
        }
        const beforeSite=raw;raw = site.height(x, z, raw,t.level);
        const afterHeight=raw>this.seaLevel?this.seaLevel+(raw-this.seaLevel)*this.exag:raw,beforeHeight=beforeSite>this.seaLevel?this.seaLevel+(beforeSite-this.seaLevel)*this.exag:beforeSite;if(Math.fround(afterHeight)!==Math.fround(beforeHeight))t.siteChanges?.get(site)?.fill(1,k,k+1);
        const f = site.surface(x, z,raw,t.level);
        if(f && road)paintSiteSurface(road,k*4,f,zero,dScale,wScale);
      }
      if (brook && brook[k * 4 + 2] > 0) {
        // A soft crease along the brook, so the painted water lies in a dip. Not under a road: there it runs in a pipe.
        const piped = road && road[k * 4 + 2] > 0 && Math.abs(road[k * 4] - zero) * dScale < road[k * 4 + 1] * wScale + 1.5;
        if (!piped) {const cut=Streams.cut(brookDistance(brook,k),brook[k*4+2]*.02);raw-=cut;}
      }
      const g = raw > this.seaLevel ? this.seaLevel + (raw - this.seaLevel) * this.exag : raw;
      ground[k] = g;
      let c = px[k * 4 + 2] * cs;
      // Both tree representations use the same approved class cell. Heights remain measured.
      if(this.groundCover){
        const x=t.x0+(k%S)*mpp,z=t.z0+Math.floor(k/S)*mpp;
        if(clearsGroundTrees(this.groundClassAt(x,z))){c=0;px[k*4+2]=0;}
      }
      if (road && road[k * 4 + 2] > 0) {
        // Nothing stands on a road: fade the tree layer out from the shoulder to the road edge.
        const d = Math.abs(road[k * 4] - zero) * dScale, hw = road[k * 4 + 1] * wScale;
        c *= THREE.MathUtils.smoothstep(d, hw + 0.8, hw + 4.5);
        px[k * 4 + 2] = Math.round(c / cs);
      }
      for(const site of sites)if(site.clearCanopy){const x=t.x0+(k%S)*mpp,z=t.z0+Math.floor(k/S)*mpp;const rk=road?(road[k*4+2]&15):0,protectedRoad=site.preserveRoads&&road&&rk>0&&rk<=5&&Math.abs(road[k*4]-zero)*dScale<road[k*4+1]*wScale+2*t.size/segFor(t.level)+2;if(!protectedRoad&&site.clearCanopy(x,z,t.level)){c=0;px[k*4+2]=0;}}
      if (this.canopyExcludes?.(t.x0 + (k % S) * mpp + this.manifest.village[0], this.manifest.village[1] - (t.z0 + Math.floor(k / S) * mpp))) { c = 0; px[k * 4 + 2] = 0; }
      canopy[k] = c;
      if (g < lo) lo = g;
      if (g + c > hi) hi = g + c;
    }
    for (const box of this.clear) {
      if(this.treeOnlyClear.has(box))continue;const [bx0,bz0,bx1,bz1]=box;
      if (bx1 < t.x0 || bx0 > t.x0 + t.size || bz1 < t.z0 || bz0 > t.z0 + t.size) continue;
      const a0 = Math.max(0, Math.floor((bx0 - t.x0) / mpp)), a1 = Math.min(T, Math.ceil((bx1 - t.x0) / mpp));
      const b0 = Math.max(0, Math.floor((bz0 - t.z0) / mpp)), b1 = Math.min(T, Math.ceil((bz1 - t.z0) / mpp));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { canopy[b * S + a] = 0; px[(b * S + a) * 4 + 2] = 0; }
    }
    const sea = this.manifest.seaFloor + 0.05;
    for (let q = 0; q < 4; q++) {
      const a0 = (q & 1) * (T / 2), b0 = (q >> 1) * (T / 2);
      let all = true;
      for (let b = b0; b <= b0 + T / 2 && all; b += 4) for (let a = a0; a <= a0 + T / 2; a += 4) if (ground[b * S + a] > sea) { all = false; break; }
      t.quadSea[q] = all;
    }

    const coastal = this.coast?.intersects(t.x0, t.z0, t.size) ? this.coast : null;
    const coastField = coastal ? new Float32Array(S * S * 4) : null;
    if (coastal && coastField) {
      const h = (a:number,b:number) => ground[Math.max(0,Math.min(T,b))*S+Math.max(0,Math.min(T,a))];
      for(let b=0;b<S;b++)for(let a=0;a<S;a++){
        const k=b*S+a,x=t.x0+a*mpp,z=t.z0+b*mpp;
        const raw=h(a,b)>this.seaLevel?this.seaLevel+(h(a,b)-this.seaLevel)/this.exag:h(a,b);
        const dx=(h(a+1,b)-h(a-1,b))/((Math.min(T,a+1)-Math.max(0,a-1))*mpp*this.exag);
        const dz=(h(a,b+1)-h(a,b-1))/((Math.min(T,b+1)-Math.max(0,b-1))*mpp*this.exag);
        const slope=Math.hypot(dx,dz);
        const curvature=coastal.quarry?(h(a+1,b)+h(a-1,b)+h(a,b+1)+h(a,b-1)-4*h(a,b))/(mpp*mpp*this.exag):0;
        coastField.set(coastal.weights(x,z,raw,slope,curvature),k*4);
        if(canopy[k]>0 && !coastal.treeAllowed(x,z,raw,slope)){canopy[k]=0;px[k*4+2]=0;}
      }
    }

    // Lighting detail comes from a normal map at full sample density.
    const nm = new Uint8Array(S * S * 4);
    const at = (arr: Float32Array, a: number, b: number) => arr[Math.min(Math.max(b, 0), T) * S + Math.min(Math.max(a, 0), T)];
    const surf = (a: number, b: number) => at(ground, a, b) + (hull ? 0.6 * at(canopy, a, b) : 0);
    for (let b = 0; b < S; b++) {
      for (let a = 0; a < S; a++) {
        const w = (Math.min(a + 1, T) - Math.max(a - 1, 0)) * mpp, h = (Math.min(b + 1, T) - Math.max(b - 1, 0)) * mpp;
        let nx = -(surf(a + 1, b) - surf(a - 1, b)) / w, nz = -(surf(a, b + 1) - surf(a, b - 1)) / h;
        const inv = 1 / Math.hypot(nx, 1, nz);
        nx *= inv; nz *= inv;
        const gs = Math.hypot((at(ground, a + 1, b) - at(ground, a - 1, b)) / w, (at(ground, a, b + 1) - at(ground, a, b - 1)) / h);
        const k = (b * S + a) * 4;
        nm[k] = Math.round((nx * 0.5 + 0.5) * 255);
        nm[k + 1] = Math.round((nz * 0.5 + 0.5) * 255);
        nm[k + 2] = px[k + 2];
        nm[k + 3] = Math.round(Math.min(gs, 1) * 255);
      }
    }
    const tex = new THREE.DataTexture(nm, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    let roadTex: THREE.DataTexture = this.noRoad;
    if (road) {
      // Site paint is finished; CPU samples and the texture only read these same bytes from here.
      roadTex = new THREE.DataTexture(new Uint8Array(road.buffer, road.byteOffset, road.byteLength), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
      roadTex.magFilter = roadTex.minFilter = THREE.NearestFilter;   // the shader blends the samples itself
      roadTex.needsUpdate = true;
    }
    let brookTex: THREE.DataTexture = this.noBrook;
    if (brook) {
      brookTex = new THREE.DataTexture(brook, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
      brookTex.magFilter = brookTex.minFilter = THREE.NearestFilter;   // the shader blends the samples itself
      brookTex.needsUpdate = true;
    }

    const seg = segFor(t.level), step = T / seg, n = seg + 3;
    const pos = new Float32Array(n * n * 3);
    const coastAttr = coastal ? new Float32Array(n * n * 4) : null;
    const gattr = new Float32Array(n * n), crowns = this.low ? null : new Float32Array(n * n);
    const drop = Math.max(t.size * 0.04, 6);
    const win = Math.max(2, Math.round(6 / Math.max(mpp, 1))), stride = Math.max(1, Math.round(win / 2));
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const ga = Math.min(Math.max(a - 1, 0), seg) * step, gb = Math.min(Math.max(b - 1, 0), seg) * step;
        const skirt = a === 0 || b === 0 || a === n - 1 || b === n - 1;
        // The mesh is coarser than the data, so trees and roofs are averaged into a soft canopy surface.
        // Single trees come in Stage 1C.
        let c = 0, cnt = 0;
        for (let v = -win; v <= win; v += stride) for (let u = -win; u <= win; u += stride) {
          const aa = ga + u, bb = gb + v;
          if (aa >= 0 && aa <= T && bb >= 0 && bb <= T) { c += canopy[bb * S + aa]; cnt++; }
        }
        c /= cnt;
        // Averaging must not grow the neighbouring forest hull back over a cleared cell.
        if(this.groundCover&&clearsGroundTrees(this.groundClassAt(t.x0+ga*mpp,t.z0+gb*mpp)))c=0;
        const k0 = gb * S + ga;
        if (road && road[k0 * 4 + 2] > 0) {
          // Keep the averaged canopy off the driving surface.
          const hw = road[k0 * 4 + 1] * wScale;
          c *= THREE.MathUtils.smoothstep(Math.abs(road[k0 * 4] - zero) * dScale, hw + 0.8, hw + 6);
        }
        if(coastal?.quarry && coastField && coastField[k0*4+1]>.5)c=0;
        if (this.canopyExcludes?.(t.x0 + ga * mpp + this.manifest.village[0], this.manifest.village[1] - (t.z0 + gb * mpp))) c=0;
        if (crowns) crowns[b * n + a] = hull ? 0 : c;
        if (!hull) c = 0;
        const g = ground[k0];
        const k = b * n + a;
        pos[k * 3] = t.x0 + ga * mpp;
        pos[k * 3 + 1] = g + c - (skirt ? drop : 0);
        pos[k * 3 + 2] = t.z0 + gb * mpp;
        gattr[k] = g;
        if(coastAttr && coastField)coastAttr.set(coastField.subarray(k0*4,k0*4+4),k*4);
      }
    }
    const grid = this.grid(seg);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('ground', new THREE.BufferAttribute(gattr, 1));
    if(coastAttr)geo.setAttribute('coast',new THREE.BufferAttribute(coastAttr,4));
    geo.setAttribute('uv', grid.uvs);
    if (crowns) geo.setAttribute('mirrorCrown', new THREE.BufferAttribute(crowns, 1));
    geo.setIndex(grid.index);
    const styled=this.cartRoads?[]:sites.filter(site=>site.visualStyle&&(!site.visualStyleLevels||site.visualStyleLevels.includes(t.level))),stylePixels=styled.length?new Uint8Array(S*S*4):null;
    if(stylePixels)for(let k=0;k<S*S;k++){
      const x=t.x0+(k%S)*mpp,z=t.z0+Math.floor(k/S)*mpp,rk=road?(road[k*4+2]&15):0;
      if(road&&rk>0&&rk<=5&&Math.abs(road[k*4]-zero)*dScale<road[k*4+1]*wScale+2)continue;
      for(const site of styled)if(x>=site.box[0]&&x<=site.box[2]&&z>=site.box[1]&&z<=site.box[3])site.visualStyle!(x,z,stylePixels,k*4,t.level);
    }
    let styleTex:THREE.DataTexture|null=null;
    if(stylePixels){styleTex=new THREE.DataTexture(stylePixels,S,S,THREE.RGBAFormat);styleTex.minFilter=styleTex.magFilter=THREE.LinearFilter;styleTex.needsUpdate=true;}
    const tileUniforms = { ...this.uniforms, ...(styleTex?{tSiteStyle:{value:styleTex}}:{}), ...(coastal ? {
        coastOrigin: { value: new THREE.Vector2(this.manifest.village[0]-618000,5109000-this.manifest.village[1]) },
        ...(coastal.quarry ? {quarryBox:{value:new THREE.Vector4(...coastal.box)}} : {}),
        coastExag: { value:this.exag }, coastOn: { value:1 }, ...(this.low ? {coastPixelScale:{value:0}} : {}), ...coastRecessUniforms(),
      } : {}), tNormal: { value: tex }, tRoad: { value: roadTex }, tBrook: { value: brookTex }, brook: { value: brook ? 1 : 0 }, texel: { value: mpp }, hull: { value: hull ? 1 : 0 }, hideQuad: { value: new THREE.Vector4() } };
    const mat=!styleTex?new THREE.ShaderMaterial({vertexShader: TERRAIN_VERT,fragmentShader: this.cartRoads ? CART_TERRAIN_FRAG : TERRAIN_FRAG,defines: { ...(this.groundCover ? { GROUND_CLASSES: 1 } : {}), ...(coastal ? { COAST_SHORE: 1, ...(coastal.quarry ? { QUARRY: 1 } : {}) } : {}), ...(this.low ? { LOW: 1 } : { ...(this.shadows ? { SHADOWS: 1 } : {}), ...(lo <= this.seaLevel + 2 ? { SEA_WATER: 1 } : {}) }), ...(gravelOverlay ? { SITE_GRAVEL: 1 } : {}), ...(airportMarkings ? { AIRPORT: 1 } : {}) },uniforms:tileUniforms}):new THREE.ShaderMaterial({vertexShader: TERRAIN_VERT,fragmentShader: STUNT_TERRAIN_FRAG,defines: {STUNT_PARK:1, ...(this.groundCover ? { GROUND_CLASSES: 1 } : {}), ...(coastal ? { COAST_SHORE: 1, ...(coastal.quarry ? { QUARRY: 1 } : {}) } : {}), ...(this.low ? { LOW: 1 } : { ...(this.shadows ? { SHADOWS: 1 } : {}), ...(lo <= this.seaLevel + 2 ? { SEA_WATER: 1 } : {}) }), ...(gravelOverlay ? { SITE_GRAVEL: 1 } : {}), ...(airportMarkings ? { AIRPORT: 1 } : {}) },uniforms:tileUniforms});
    const mesh = new THREE.Mesh(geo, mat);
    if(coastal && this.low)mesh.onBeforeRender=(renderer,_scene,camera,_geometry,material)=>updateCoastView(renderer,camera,material);
    coastal?.prepareMesh?.(mesh);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    t.box.set(new THREE.Vector3(t.x0, lo - drop, t.z0), new THREE.Vector3(t.x0 + t.size, hi, t.z0 + t.size));
    t.mesh = mesh;
    if (!this.low && lo <= this.seaLevel + 2) {
      // This mask uses the main mesh depth, including water painted just above the sea plane.
      t.mask = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: TERRAIN_VERT, fragmentShader: this.cartRoads ? CART_WATER_MASK_FRAG : WATER_MASK_FRAG,
        uniforms: mat.uniforms, colorWrite: false, depthWrite: false }));
      t.mask.frustumCulled = false; t.mask.matrixAutoUpdate = false;
      this.maskScene.add(t.mask);
    }
    t.ground = ground;
    t.canopy = canopy;
    t.road = road;
    t.brook = brook;
    if (!t.ready) this.readyCount++;
    t.ready = true;
    this.dataRevision++;if(this.cartRoads){t.contactId=++this.contactSerial;this.contactTile(t);}else this.contactRevision++;
    // The request touched an unready tile; count its completion in this frame's wanted set.
    if (t.lastUsed === this.frame) this.use(t);
    this.group.add(mesh);
    this.paved?.applyGround(mat);
    this.night?.applyGround(mat);
    this.propertyOverlay?.applyGround(mat);
    this.fleetGroundChanged?.(t.x0, t.z0, t.size);
  }

  /** The level of the finest tile in memory at a world position (-1: none). Lighter than surfaceAt, and unlike find it
   * does not mark the tile as used, so asking about a far place never keeps its tile in memory. */
  levelAt(x: number, z: number): number {
    const m = this.manifest;
    const e = x + m.village[0] - m.origin[0], s = z - (m.village[1] - m.origin[1]);
    for (let level = this.maxLevel; level >= 0; level--) {
      const size = m.size / 2 ** level, t = this.tiles.get(`${level}/${Math.floor(e / size)}_${Math.floor(s / size)}`);
      if (t?.ready && t.ground) return level;
    }
    return -1;
  }

  /** The finest tile in memory that holds a world position. */
  private find(x: number, z: number): Tile | null {
    const m = this.manifest;
    const e = x + m.village[0] - m.origin[0], s = z - (m.village[1] - m.origin[1]);
    for (let level = this.maxLevel; level >= 0; level--) {
      const size = m.size / 2 ** level;
      const t = this.tiles.get(`${level}/${Math.floor(e / size)}_${Math.floor(s / size)}`);
      if (t?.ready && t.ground) { this.use(t); return t; }
    }
    return null;
  }

  /** True where the finest land exists at a point, whether it is in memory or not. Outside it, nothing will ever load. */
  hasFinest(x: number, z: number): boolean {
    const m = this.manifest, size = m.size / 2 ** this.maxLevel;
    return this.exists.has(`${this.maxLevel}/${Math.floor((x + m.village[0] - m.origin[0]) / size)}_${Math.floor((z - (m.village[1] - m.origin[1])) / size)}`);
  }

  /** Ground height in metres at a world position, from the finest tile in memory. */
  heightAt(x: number, z: number): number | null {
    const ground = this.landHeightAt(x, z);
    if (ground === null) return null;
    return this.withDeck(x, z, ground);
  }

  /** Construction caches use the finest cached land, independent of a vehicle contact scope. */
  constructionHeightAt(x: number, z: number): number | null {
    const body=this.groundContact,drawn=this.drawnContact;
    this.groundContact=null;this.drawnContact=false;
    try { return this.heightAt(x,z); }
    finally { this.groundContact=body;this.drawnContact=drawn; }
  }

  private refreshEraSites():void {
    if(this.eraSiteCount===this.sites.length)return;this.eraSiteCount=this.sites.length;this.eraDeckSites.length=this.eraContactSites.length=0;
    for(let i=0;i<this.sites.length;i++){const s=this.sites[i];if(s.deckHeight)this.eraDeckSites.push(s);if(s.contactMesh)this.eraContactSites.push(s);}
  }
  private withDeck(x: number, z: number, ground: number, surface?:Surface): number {
    if(this.cartRoads)this.refreshEraSites();
    for (const site of (this.cartRoads?this.eraDeckSites:this.sites)) {
      if (x < site.box[0] || x > site.box[2] || z < site.box[1] || z > site.box[3]) continue;
      if(site.preserveRoads&&this.protectedRoadAt(x,z))continue;
      const cap=site.groundHeight?.(x,z);
      if(cap!=null&&cap>ground)ground=cap;
      const deck = site.deckHeight?.(x, z, this.landHeightAt, this.groundContact ? this.groundContact.y + 0.25 : Infinity);
      // A front wheel may be one axle-half up the slope. A body underneath a deck cannot step onto its top.
      if (deck != null && (!this.groundContact || deck <= this.groundContact.y + 0.25) && deck>=ground) {
        ground=deck;
        if (surface && site.deckDriving) {
          const driving=typeof site.deckDriving==='function'?site.deckDriving(x,z):site.deckDriving;
          surface.kind=driving.kind;surface.halfWidth=driving.halfWidth;surface.roadDist=0;
          surface.deck=true;surface.canopy=0;surface.washboard=false;surface.bridge=false;
        }
      }
    }
    return ground;
  }

  private landHeightAt = (x: number, z: number): number | null => {
    // An attached trailer samples the visible triangles at its four wheel contacts, once in the fixed step.
    if (this.drawnContact) { const drawn = this.drawnTile(x, z); if (drawn) return this.triangleHeight(drawn, x, z); }
    const t = this.find(x,z);
    if (!t) return null;
    const fa = ((x - t.x0) / t.size) * T, fb = ((z - t.z0) / t.size) * T;
    const a = Math.min(Math.floor(fa), T - 1), b = Math.min(Math.floor(fb), T - 1);
    const u = fa - a, v = fb - b, g = t.ground!;
    let ground=(g[b * S + a] * (1 - u) + g[b * S + a + 1] * u) * (1 - v) + (g[(b + 1) * S + a] * (1 - u) + g[(b + 1) * S + a + 1] * u) * v;
    if (this.groundContact && this.wantsDrawnContact(x,z)) {
      const drawn=this.drawnTile(x,z);if(drawn)ground+=(this.triangleHeight(drawn,x,z)-ground)*this.wantsDrawnContact(x,z);
    }
    return ground;
  };

  /** Short plants need the drawn triangle, not a finer height sample that may sit below it. */
  meshHeightAt(x: number, z: number, drawnOnly = false): number | null {
    let t = this.find(x, z);
    if(drawnOnly && this.cartRoads)t=this.drawnTile(x,z);
    else if(drawnOnly){
      t=null;
      for(const q of this.tiles.values())if(q.mesh?.visible && x>=q.x0 && x<q.x0+q.size && z>=q.z0 && z<q.z0+q.size && (!t || q.level>t.level)){
        const quarter=(x>=q.x0+q.size/2?1:0)+(z>=q.z0+q.size/2?2:0);
        if((q.mesh.material as THREE.ShaderMaterial).uniforms.hideQuad.value.getComponent(quarter)<.5)t=q;
      }
    }
    if (!t?.mesh) return null;
    this.use(t);
    const seg = segFor(t.level), n = seg + 3;
    const fa = (x - t.x0) * seg / t.size, fb = (z - t.z0) * seg / t.size;
    const a = Math.min(Math.floor(fa), seg - 1), b = Math.min(Math.floor(fb), seg - 1);
    const u = fa - a, v = fb - b, i = (b + 1) * n + a + 1;
    const p = t.mesh.geometry.getAttribute('position');
    const h00 = p.getY(i), h10 = p.getY(i + 1), h01 = p.getY(i + n), h11 = p.getY(i + n + 1);
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v
      : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
  /** Mapped driving data only; this never enters a ground or deck query. */
  protectedRoadAt(x:number,z:number):boolean {
    const t=this.find(x,z),r=t?.road;if(!t||!r)return false;
    const fa=(x-t.x0)*T/t.size,fb=(z-t.z0)*T/t.size,a=Math.min(Math.floor(fa),T-1),b=Math.min(Math.floor(fb),T-1),u=fa-a,v=fb-b,k=(Math.min(Math.round(fb),T)*S+Math.min(Math.round(fa),T))*4,k0=(b*S+a)*4;
    const kind=r[k+2]&15;if(kind<1||kind>5)return false;
    const whole=r[k0+2]>0&&r[k0+6]>0&&r[k0+S*4+2]>0&&r[k0+S*4+6]>0;
    const distance=whole?(r[k0]*(1-u)+r[k0+4]*u)*(1-v)+(r[k0+S*4]*(1-u)+r[k0+S*4+4]*u)*v:r[k];
    return Math.abs(distance-this.zero)*this.manifest.roads!.encoding.distance<r[k+1]*this.manifest.roads!.encoding.halfWidth+2;
  }
  /** A site changes contact only where a sampled height or a drawn triangle actually changed. */
  siteGroundChangedAt(site:Site,x:number,z:number):boolean {
    const t=this.find(x,z);if(!t)return false;
    const changed=t.siteChanges?.get(site),a=Math.min(T-1,Math.max(0,Math.floor((x-t.x0)*T/t.size))),b=Math.min(T-1,Math.max(0,Math.floor((z-t.z0)*T/t.size)));
    if(changed&&(changed[b*S+a]||changed[b*S+a+1]||changed[(b+1)*S+a]||changed[(b+1)*S+a+1]))return true;
    const drawn=this.drawnTile(x,z),flags=drawn?.siteChanges?.get(site);if(!drawn||!flags)return false;
    const seg=segFor(drawn.level),step=T/seg,fa=(x-drawn.x0)*seg/drawn.size,fb=(z-drawn.z0)*seg/drawn.size,i=Math.min(seg-1,Math.floor(fa)),j=Math.min(seg-1,Math.floor(fb)),u=fa-i,v=fb-j,k=j*step*S+i*step;
    return u+v<=1?!!(flags[k]||flags[k+step]||flags[k+step*S]):!!(flags[k+step]||flags[k+step*S]||flags[k+step*S+step]);
  }

  private wantsDrawnContact(x:number,z:number):number {
    if(this.cartRoads)this.refreshEraSites();
    for(const site of (this.cartRoads?this.eraContactSites:this.sites))if(x>=site.box[0]&&x<=site.box[2]&&z>=site.box[1]&&z<=site.box[3]&&!(site.preserveRoads&&this.protectedRoadAt(x,z))&&site.contactMesh?.(x,z))return site.contactMesh(x,z);
    return 0;
  }
  /** The visible triangle source, distinct from finer height data that may remain cached. */
  drawnLevelAt(x:number,z:number):number|null {return this.drawnTile(x,z)?.level??null;}
  private drawnTile(x:number,z:number):Tile|null {
    const m=this.manifest,e=x+m.village[0]-m.origin[0],s=z-(m.village[1]-m.origin[1]);
    for(let level=this.maxLevel;level>=0;level--){
      const size=m.size/2**level,t=this.tiles.get(`${level}/${Math.floor(e/size)}_${Math.floor(s/size)}`);
      if(!t?.ready||!t.mesh?.visible)continue;
      const q=(x>=t.x0+size/2?1:0)|(z>=t.z0+size/2?2:0),hide=(t.mesh.material as THREE.ShaderMaterial).uniforms.hideQuad?.value as THREE.Vector4|undefined;
      if(!hide||hide.getComponent(q)<.5){this.use(t);return t;}
    }
    return null;
  }
  private triangleHeight(t:Tile,x:number,z:number):number {
    const seg=segFor(t.level),n=seg+3,fa=(x-t.x0)*seg/t.size,fb=(z-t.z0)*seg/t.size;
    const a=Math.min(Math.floor(fa),seg-1),b=Math.min(Math.floor(fb),seg-1),u=fa-a,v=fb-b,i=(b+1)*n+a+1;
    const p=t.mesh!.geometry.getAttribute('position'),h00=p.getY(i),h10=p.getY(i+1),h01=p.getY(i+n),h11=p.getY(i+n+1);
    return u+v<=1?h00+(h10-h00)*u+(h01-h00)*v:h11+(h01-h11)*(1-u)+(h10-h11)*(1-v);
  }

  surfaceAt(x: number, z: number): Surface | null {
    const t = this.find(x, z);
    if (!t) return null;
    const fa = ((x - t.x0) / t.size) * T, fb = ((z - t.z0) / t.size) * T;
    const a = Math.min(Math.floor(fa), T - 1), b = Math.min(Math.floor(fb), T - 1);
    const u = fa - a, v = fb - b;
    const lerp = (arr: ArrayLike<number>, stride: number, off: number) =>
      (arr[(b * S + a) * stride + off] * (1 - u) + arr[(b * S + a + 1) * stride + off] * u) * (1 - v) +
      (arr[((b + 1) * S + a) * stride + off] * (1 - u) + arr[((b + 1) * S + a + 1) * stride + off] * u) * v;
    const out: Surface = { ground: lerp(t.ground!, 1, 0), canopy: lerp(t.canopy!, 1, 0), roadDist: 99, halfWidth: 0, kind: 0, bridge: false, washboard: false, brook: 99, level: t.level };
    if (t.brook) {
      const k = Math.min(Math.round(fb), T) * S + Math.min(Math.round(fa), T);
      if (t.brook[k * 4 + 2] > 0) out.brook = Math.min(99, brookBlend(t.brook, S, t.size / T, fa, fb) - t.brook[k * 4 + 2] * 0.02);
    }
    if (t.road) {
      const k = (Math.min(Math.round(fb), T) * S + Math.min(Math.round(fa), T)) * 4;
      const raw = t.road[k + 2];
      if (raw > 0) {
        const enc = this.manifest.roads!.encoding;
        // Blend the distance only between samples that all have a road; the "no road" value is not a distance.
        const r = t.road, k00 = (b * S + a) * 4;
        const whole = r[k00 + 2] > 0 && r[k00 + 6] > 0 && r[k00 + S * 4 + 2] > 0 && r[k00 + S * 4 + 6] > 0;
        out.roadDist = Math.abs((whole ? lerp(r, 4, 0) : r[k]) - this.zero) * enc.distance;
        out.halfWidth = t.road[k + 1] * enc.halfWidth;
        out.kind = raw & 15;
        out.bridge = (raw & 16) !== 0;
        out.washboard = (raw & 32) !== 0;
      }
    }
    // Mail and every other ground reader see the same exact deck as the wheels.
    if (this.groundContact && this.wantsDrawnContact(x,z)){const drawn=this.drawnTile(x,z);if(drawn)out.ground+=(this.triangleHeight(drawn,x,z)-out.ground)*this.wantsDrawnContact(x,z);}
    out.ground = this.withDeck(x, z, out.ground,out);
    const waterLevel=out.deck?null:this.waterLevelAt(x,z,out.ground);
    if (waterLevel!==null) {out.water=true;out.waterLimit=Math.max(waterLevel,out.ground)+.25;}
    if(!this.cartRoads&&!out.deck&&!out.water&&this.groundClassAt(x,z)===6)out.mineral=true;
    return out;
  }

  /** Mapped lake returns need no invented bathymetry to reject a wet placement. */
  waterAt(x:number,z:number,drawnGround?:number,supportingDeck=false):boolean {
    const level=this.waterLevelAt(x,z,drawnGround);
    // Survey noise applies to LiDAR water returns, not a known supporting deck above the actual water plane.
    return level!==null&&(!supportingDeck||drawnGround===undefined||drawnGround<=level+.01);
  }
  waterLevelAt(x:number,z:number,drawnGround?:number):number|null {
    for(const site of this.sites) if(x>=site.box[0]&&x<=site.box[2]&&z>=site.box[1]&&z<=site.box[3]){
      const raw=site.waterLevel?.(x,z);if(raw==null)continue;
      const level=this.seaLevel+(raw-this.seaLevel)*this.exag,ground=drawnGround??this.heightAt(x,z);
      // Inland LiDAR returns describe the water surface, within its survey noise. Dry islands and decks stand above it.
      if(ground===null||ground<=level+.6*this.exag)return level;
    }
    return null;
  }

  /** Surface-painted openings follow the actual selected triangles, including partly submerged cells. */
  fitCoastRecesses():void {
    if(!this.coast || this.coast.quarry)return;
    const sea=this.seaLevel;
    const heights=RECESSES.map(p=>{
      const y=this.meshHeightAt(p.e-this.coast!.village[0],this.coast!.village[1]-p.n,true);
      return y===null?p.h:sea+(y-sea)/this.exag;
    });
    for(const tile of this.tiles.values())for(const mat of [tile.mesh?.material,tile.mirror?.material]){
      const anchor=(mat as THREE.ShaderMaterial|undefined)?.uniforms?.coastRecessAnchor?.value as Float32Array|undefined;
      if(anchor)for(let i=0;i<heights.length;i++)anchor[i*4+2]=heights[i];
    }
  }

  /** The drawn tile quarters over one world box [x0, z0, x1, z1]. It changes when a load, an eviction or an LOD switch
   *  changes the drawn land there (not when a coarse tile changes a quarter elsewhere), and is '' when none is drawn. */
  drawnOver(x0:number,z0:number,x1:number,z1:number):string {
    let stamp='';
    for(const [key,t] of this.tiles){
      if(!t.mesh?.visible||t.x0>x1||t.x0+t.size<x0||t.z0>z1||t.z0+t.size<z0)continue;
      const h=(t.mesh.material as THREE.ShaderMaterial).uniforms.hideQuad.value as THREE.Vector4,mid=t.size/2;
      let shown=0;
      for(let q=0;q<4;q++){
        const qx=t.x0+(q&1)*mid,qz=t.z0+(q>>1)*mid;
        if(qx<=x1&&qx+mid>=x0&&qz<=z1&&qz+mid>=z0&&h.getComponent(q)<.5)shown|=1<<q;
      }
      if(shown)stamp+=key+':'+shown+'|';
    }
    return stamp;
  }
  /** The current visible tile identities; local props only refit when a load or LOD switch changes them. */
  get drawnRevision():string {return [...this.tiles.entries()].filter(([,t])=>t.mesh?.visible).map(([key])=>key).join('|');}

  private use(t: Tile) {
    t.lastUsed = this.frame;
    if (t.ready && t.countedFrame !== this.frame) { t.countedFrame = this.frame; this.wantedCount++; }
  }

  update(camera: THREE.PerspectiveCamera, startMode = false) {
    this.frame++;
    if(this.cartRoads){const previous=this.contactPrevious;this.contactPrevious=this.contactSelected;this.contactSelected=previous;this.contactSelected.length=0;}
    this.wantedCount = 0;
    this.drawn = 0;
    this.drawnFine.clear();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cam = camera.position, body = this.body;
    if (this.paved?.car) this.paved.update(this.paved.car.x, this.paved.car.z);
    // Driving builds one; paused/burst use 48/24 ms, at least one, capped by six outstanding tiles.
    // First update or >150 m camera/car movement starts burst; pending zero ends it after refinement.
    // Default flight stays driving; fast/boosted/capped-step flight and long-tab returns may burst harmlessly.
    if (this.frame === 1 || Math.hypot(cam.x - this.focusX, cam.y - this.focusY, cam.z - this.focusZ) > BURST_DISTANCE ||
      body && Math.hypot(body.x - this.bodyX, body.z - this.bodyZ) > BURST_DISTANCE) this.bursting = true;
    this.focusX = cam.x; this.focusY = cam.y; this.focusZ = cam.z;
    this.bodyX = body?.x ?? NaN; this.bodyZ = body?.z ?? NaN;
    this.lastBuildMode = startMode ? 'paused' : this.bursting ? 'burst' : 'driving';
    for (const t of this.tiles.values()) {
      if (t.mesh) t.mesh.visible = false;
      if (t.ready && (t.level <= 2 ||
        cam.x >= t.x0 && cam.x < t.x0 + t.size && cam.z >= t.z0 && cam.z < t.z0 + t.size ||
        body && body.x >= t.x0 && body.x < t.x0 + t.size && body.z >= t.z0 && body.z < t.z0 + t.size)) this.use(t);
    }
    this.visit(0, 0, 0, camera.position);
    const budgetMs = this.buildMode === 'paused' ? PAUSED_BUILD_BUDGET_MS : this.buildMode === 'burst' ? BURST_BUILD_BUDGET_MS : 0;
    const built = this.buildWaiting(cam, budgetMs);
    if (this.bursting && built) {
      // A completed sibling group can expose another level: request it before testing pending zero.
      this.drawn = 0; this.drawnFine.clear();
      for (const t of this.tiles.values()) if (t.mesh) t.mesh.visible = false;
      // 1884 era: this second visit replaces the first one's contact selection. A tile keeps the change event it already sent.
      if (this.cartRoads) { for (let i = 0; i < this.contactSelected.length; i++) this.contactSelected[i].contactFrame = this.frame - 1; this.contactSelected.length = 0; }
      this.visit(0, 0, 0, cam);
    }
    if(this.cartRoads)for(let i=0;i<this.contactPrevious.length;i++){const t=this.contactPrevious[i];if(t.contactFrame!==this.frame)this.contactTile(t);}
    if (this.fleetGroundChanged) for (const t of this.tiles.values()) {
      if (!t.mesh) continue;
      const hide = (t.mesh.material as THREE.ShaderMaterial).uniforms.hideQuad.value as THREE.Vector4;
      const mask = t.mesh.visible ? 16 + hide.x + hide.y * 2 + hide.z * 4 + hide.w * 8 : 0;
      if (this.fleetMasks.get(t) !== mask) {
        const previous = this.fleetMasks.get(t) ?? 0;
        const changed = (previous >= 16 ? ~previous & 15 : 0) ^ (mask >= 16 ? ~mask & 15 : 0);
        this.fleetMasks.set(t, mask);
        for (let q = 0; q < 4; q++) if (changed & 1 << q)
          this.fleetGroundChanged(t.x0 + (q & 1) * t.size / 2, t.z0 + (q >> 1) * t.size / 2, t.size / 2);
      }
    }
    this.pump();
    this.finishBurst();
    if (this.readyCount - this.wantedCount > SPARE_CAP && this.frame - this.lastEvict >= EVICT_INTERVAL) {
      this.lastEvict = this.frame;
      this.evict();
    }
  }

  private get zero() { return this.manifest.roads?.encoding.signed ? this.manifest.roads.encoding.zero ?? 128 : 0; }

  private visit(level: number, i: number, j: number, cam: THREE.Vector3, mirror = false): boolean {
    const t = this.tile(level, i, j);
    if (!t) return false;
    if (mirror && !this.frustum.intersectsBox(t.box)) return true;
    const dist = t.box.distanceToPoint(cam);
    if (!t.ready) { this.request(t, dist); return false; }
    this.use(t);
    const hide = (t.mesh!.material as THREE.ShaderMaterial).uniforms.hideQuad.value as THREE.Vector4;
    if (level < this.maxLevel && dist < t.size * this.split) {
      const kids: Tile[] = [];
      let ok = true, partial = 0, lazy = 0, waiting = 0;
      for (let q = 0; q < 4; q++) {
        const c = this.tile(level + 1, i * 2 + (q & 1), j * 2 + (q >> 1));
        if (c) {
          const cd = c.box.distanceToPoint(cam);
          // Out of view and far: this tile keeps that quarter (unseen) and the child is read in the background.
          if (this.lazy(c, cd, mirror)) { this.requestBackground(c, cd); lazy |= 1 << q; continue; }
          if (!c.ready && this.lazyRange && !mirror && cd > this.lazyRange) {
            // Far land that comes into view (a turn): this tile shows that quarter until the child arrives, and the
            // near children already read stay drawn. Without lazyRange the whole tile waits for all four, as before.
            this.request(c, cd); waiting |= 1 << q; continue;
          }
          this.use(c); kids.push(c); if (!c.ready) { this.request(c, cd); ok = false; }
        }
        else if (!t.quadSea[q]) partial |= 1 << q;   // finer data stops here: this tile keeps that quarter
      }
      if (ok && (kids.length || lazy)) {
        for (const c of kids) this.visit(c.level, c.i, c.j, cam, mirror);
        // Quarters without finer data, or still waiting for it, make this tile visible; a lazy quarter is out of view.
        const inView=(partial|waiting)&&this.frustum.intersectsBox(t.box);
        const keep = partial | lazy | waiting;
        if (keep&&(this.cartRoads||inView)) {
          hide.set(keep & 1 ? 0 : 1, keep & 2 ? 0 : 1, keep & 4 ? 0 : 1, keep & 8 ? 0 : 1);
          if(!mirror)this.noteSelection(t,keep);
          if(inView){t.mesh!.visible=true;this.drawn++;}
        }
        return true;
      }
    }
    hide.set(0, 0, 0, 0);
    if(!mirror)this.noteSelection(t,0);
    if (this.frustum.intersectsBox(t.box)) { t.mesh!.visible = true; this.drawn++; }
    if (!mirror && level === 8) this.drawnFine.add(`${i}_${j}`);   // also when off screen: its trees may still reach into view
    return true;
  }

  /** The colourless query uses only sea-capable tiles currently visible in the main picture. */
  waterMask(): THREE.Scene | null {
    let count = 0;
    for (const t of this.tiles.values()) if (t.mask) {
      t.mask.visible = !!t.mesh?.visible;
      if (t.mask.visible) count++;
    }
    this.maskScene.name = 'Water visibility';
    return count ? this.maskScene : null;
  }

  /** Mirror visibility has its own frustum. Restore the main visibility and quadrant masks even on failure. */
  withReflection(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, draw: () => void): void {
    const frustum = this.frustum.clone(), drawn = this.drawn;
    const saved: { tile: Tile; mesh: THREE.Mesh; visible: boolean; hide: THREE.Vector4; geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[] }[] = [];
    for (const t of this.tiles.values()) if (t.mesh) {
      const mesh = t.mesh, hide = (mesh.material as THREE.ShaderMaterial).uniforms.hideQuad.value as THREE.Vector4;
      saved.push({ tile: t, mesh, visible: mesh.visible, hide: hide.clone(), geometry: mesh.geometry, material: mesh.material });
      mesh.visible = false;
    }
    this.mirrorFocus.value.set(focus.x, focus.z);
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    try {
      this.visit(0, 0, 0, focus, true);
      for (const state of saved) if (state.mesh.visible) {
        const t = state.tile;
        if (!t.mirror) {
          // One coarser grid step, without moving the tile or changing its LOD boundaries.
          const seg = segFor(t.level), n = seg + 3;
          let index = this.mirrorIndices.get(seg);
          if (!index) {
            const axis = [0]; for (let i = 1; i <= seg + 1; i += 2) axis.push(i); axis.push(seg + 2);
            const ids: number[] = [];
            for (let y = 0; y < axis.length - 1; y++) for (let x = 0; x < axis.length - 1; x++) {
              const a = axis[y] * n + axis[x], b = axis[y + 1] * n + axis[x], c = axis[y] * n + axis[x + 1], d = axis[y + 1] * n + axis[x + 1];
              ids.push(a, b, c, c, b, d);
            }
            index = new THREE.BufferAttribute(new Uint32Array(ids), 1); this.mirrorIndices.set(seg, index);
          }
          const geometry = new THREE.BufferGeometry();
          for (const [name, attribute] of Object.entries(state.geometry.attributes)) geometry.setAttribute(name, attribute);
          geometry.setIndex(index);
          const original = state.material as THREE.ShaderMaterial;
          const MIRROR_COAST=original.defines.COAST_SHORE;
          const mirrorUniforms={ ...original.uniforms, sourceHull: original.uniforms.hull, mirrorFocus: this.mirrorFocus };
          const material=!original.defines.STUNT_PARK?new THREE.ShaderMaterial({vertexShader: MIRROR_TERRAIN_VERT,fragmentShader: this.cartRoads ? CART_TERRAIN_FRAG : TERRAIN_FRAG,defines: { MIRROR: 1, ...(original.defines.GROUND_CLASSES ? { GROUND_CLASSES: 1 } : {}), ...(MIRROR_COAST ? { COAST_SHORE: 1, ...(original.defines.QUARRY ? { QUARRY: 1 } : {}) } : {}), ...(original.defines.SITE_GRAVEL ? { SITE_GRAVEL: 1 } : {}), ...(original.defines.AIRPORT ? { AIRPORT: 1 } : {}) },uniforms:mirrorUniforms}):new THREE.ShaderMaterial({vertexShader: MIRROR_TERRAIN_VERT,fragmentShader: STUNT_TERRAIN_FRAG,defines: {STUNT_PARK:1, MIRROR: 1, ...(original.defines.GROUND_CLASSES ? { GROUND_CLASSES: 1 } : {}), ...(MIRROR_COAST ? { COAST_SHORE: 1, ...(original.defines.QUARRY ? { QUARRY: 1 } : {}) } : {}), ...(original.defines.SITE_GRAVEL ? { SITE_GRAVEL: 1 } : {}), ...(original.defines.AIRPORT ? { AIRPORT: 1 } : {}) },uniforms:mirrorUniforms});
          this.paved?.applyGround(material);
          this.night?.applyGround(material);
          t.mirror = { geometry, material };
        }
        this.propertyOverlay?.applyGround(t.mirror.material);
        state.mesh.geometry = t.mirror.geometry; state.mesh.material = t.mirror.material;
      }
      draw();
    } finally {
      for (const state of saved) {
        state.mesh.visible = state.visible; state.mesh.geometry = state.geometry; state.mesh.material = state.material;
        ((state.material as THREE.ShaderMaterial).uniforms.hideQuad.value as THREE.Vector4).copy(state.hide);
      }
      this.frustum.copy(frustum); this.drawn = drawn;
    }
  }

  private evict() {
    let excess = this.readyCount - this.wantedCount - SPARE_CAP;
    // Reuse only eligible candidates; ordinary frames allocate no eviction array.
    for (const t of this.tiles.values()) if (t.ready && t.level > 2 && this.frame - t.lastUsed > TILE_GRACE && !t.mesh!.visible) this.spare.push(t);
    this.spare.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const t of this.spare) {
      if (excess <= 0) break;
      this.group.remove(t.mesh!);
      if (t.mask) { this.maskScene.remove(t.mask); (t.mask.material as THREE.Material).dispose(); }
      if (t.mirror) {
        for (const name of Object.keys(t.mirror.geometry.attributes)) t.mirror.geometry.deleteAttribute(name);
        t.mirror.geometry.setIndex(null); t.mirror.geometry.dispose(); t.mirror.material.dispose();
      }
      // The index and uv buffers are shared by all tiles of a mesh density; free only what this tile owns.
      const geo = t.mesh!.geometry;
      geo.deleteAttribute('uv');
      geo.setIndex(null);
      geo.dispose();
      const mat = t.mesh!.material as THREE.ShaderMaterial;
      (mat.uniforms.tNormal.value as THREE.Texture).dispose();
      if (mat.uniforms.tRoad.value !== this.noRoad) (mat.uniforms.tRoad.value as THREE.Texture).dispose();
      if (mat.uniforms.tBrook.value !== this.noBrook) (mat.uniforms.tBrook.value as THREE.Texture).dispose();
      (mat.uniforms.tSiteStyle?.value as THREE.Texture|undefined)?.dispose();
      mat.dispose();
      this.tiles.delete(`${t.level}/${t.i}_${t.j}`);this.dataRevision++;if(this.cartRoads)this.contactTile(t);else this.contactRevision++;
      this.readyCount--;
      t.ready = false; t.mesh = null; t.mask = null; t.mirror = null;
      t.ground = t.canopy = null; t.road = null; t.brook = null;
      excess--;
    }
    this.spare.length = 0;
  }
}
