import * as THREE from 'three';
import {rasterCuts,type CutRaster} from './road-cut-raster';
/** Coarse cells where a site can answer at all. Hot land, mesh and surface queries test it inline and skip the site's
 *  calls elsewhere (a bridge site's box spans the whole area, so the box alone rejects nothing). */
export interface CellMask {x0:number;z0:number;size:number;w:number;h:number;bits:Uint8Array}
export function inMask(m:CellMask,x:number,z:number):boolean {
  const i=Math.floor((x-m.x0)/m.size),j=Math.floor((z-m.z0)/m.size);
  return i>=0&&j>=0&&i<m.w&&j<m.h&&m.bits[j*m.w+i]===1;
}
/** Returns true if any populated cell touches the inclusive world rectangle. */
export function maskTouches(m: CellMask, x0: number, z0: number, x1: number, z1: number): boolean {
  const left = Math.max(0, Math.floor((x0 - m.x0) / m.size));
  const right = Math.min(m.w - 1, Math.floor((x1 - m.x0) / m.size));
  const top = Math.max(0, Math.floor((z0 - m.z0) / m.size));
  const bottom = Math.min(m.h - 1, Math.floor((z1 - m.z0) / m.size));
  if (left > right || top > bottom) return false;
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      if (m.bits[row * m.w + col] === 1) return true;
    }
  }
  return false;
}

export interface RoadCutSource {
  /** Outside these cells every query below, and a site's deck contact, returns null. */
  mask?:CellMask;
  roadBedHeight?(x:number,z:number):number|null;
  roadCutHeight?(x:number,z:number):number|null;
  roadCutRevision?(x0:number,z0:number,x1:number,z1:number):number;
  roadCutTriangles?(x0:number,z0:number,x1:number,z1:number):readonly Float32Array[];
}
interface CutTile {x0:number;z0:number;size:number;roadCutRevision:number;mesh:THREE.Mesh|null}
const PAGE=64,LAYERS=64,FLOATS=PAGE*PAGE*4;
interface Atlas {texture:THREE.DataArrayTexture;data:Float32Array;used:Uint8Array}
interface Allocation {atlas:Atlas;first:number;pages:number}
interface Entry {tile:CutTile;revision:number;raster:CutRaster|null;allocation?:Allocation}
interface Job {entry:Entry;revision:number;steps:Generator<void,CutRaster|null>;result?:CutRaster|null;allocation?:Allocation;copied:number;id:number;workerSent?:boolean}
/** One shared atlas instead of a texture per tile. Loading work is bounded per frame. */
export class RoadCuts {
  private readonly entries=new Map<CutTile,Entry>();
  private readonly queue=new Map<CutTile,Entry>();
  private readonly atlases:Atlas[]=[];
  private job:Job|null=null;
  private worker:Worker|null=null;private workerStarted=false;private serial=0;private bufferRequested=false;
  private backing:Float32Array[]=[];

  readonly audit={steps:0,frames:0,maxFrameMs:0,maxStepMs:0,maxCandidates:0,atlases:0,bytes:0,workerJobs:0,maxWorkerMs:0,prepareMs:0,postMs:0,validateMs:0,allocateMs:0,copyMs:0,error:''};
  constructor(private readonly sources:readonly RoadCutSource[],_empty:THREE.Texture){}
  private startWorker():void {
    if(this.workerStarted)return;this.workerStarted=true;
    if(typeof Worker==='undefined')return;
    this.worker=new Worker(new URL('./road-cut-worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{if(data.buffer){this.backing.push(data.buffer);this.bufferRequested=false;return;}if(this.job&&this.job.id===data.id){this.job.result=data.raster;this.audit.maxWorkerMs=Math.max(this.audit.maxWorkerMs,data.ms);}};
    this.worker.onerror=e=>{this.audit.error=e.message;console.error('Bridge cut worker failed',e.message);};
  }
  get pending():number{return this.queue.size+(this.job?1:0);}
  // Only the sources that cut land or carry a road bed, refreshed when a source is added or removed (see Terrain sites).
  private seen=-1;private seenLast:RoadCutSource|undefined;private readonly beds:RoadCutSource[]=[];private readonly cuts:RoadCutSource[]=[];
  private refresh():void {
    const last=this.sources[this.sources.length-1];if(this.seen===this.sources.length&&this.seenLast===last)return;
    this.seen=this.sources.length;this.seenLast=last;this.beds.length=this.cuts.length=0;
    for(const s of this.sources){if(s.roadBedHeight)this.beds.push(s);if(s.roadCutHeight)this.cuts.push(s);}
  }
  land(x:number,z:number,height:number):number {this.refresh();for(const s of this.beds){if(s.mask&&!inMask(s.mask,x,z))continue;const h=s.roadBedHeight?.(x,z);if(h!==null&&h!==undefined)height=Math.min(height,h);}return height;}
  height(x:number,z:number):number|null {this.refresh();let best:number|null=null;for(const s of this.cuts){if(s.mask&&!inMask(s.mask,x,z))continue;const h=s.roadCutHeight?.(x,z);if(h!==null&&h!==undefined&&(best===null||h<best))best=h;}return best;}
  private revision(t:CutTile):number {let n=0;for(const s of this.sources)n+=s.roadCutRevision?.(t.x0,t.z0,t.x0+t.size,t.z0+t.size)??0;return n;}
  update(t:CutTile):void {
    if(!t.mesh)return;
    let e=this.entries.get(t);if(!e){e={tile:t,revision:-1,raster:null};this.entries.set(t,e);const u=(t.mesh.material as THREE.ShaderMaterial).uniforms;u.tRoadCut.value=this.atlases[0]?.texture??null;}
    if(t.size/256>4)return;
    const revision=this.revision(t);if(e.revision===revision&&t.roadCutRevision===revision)return;
    if(this.job?.entry===e&&this.job.revision===revision||this.queue.get(t)===e)return;
    if(!revision){if(e.allocation){this.free(e.allocation);e.allocation=undefined;}e.raster=null;(t.mesh.material as THREE.ShaderMaterial).uniforms.roadCuts.value=0;e.revision=0;t.roadCutRevision=0;return;}this.startWorker();if(e.allocation){this.free(e.allocation);e.allocation=undefined;}e.raster=null;(t.mesh.material as THREE.ShaderMaterial).uniforms.roadCuts.value=0;this.queue.set(t,e);
  }
  /** This is the only main-thread build/upload pump. No tile arrival performs a field build. */
  step(budgetMs=2):void {
    if(!this.job&&!this.queue.size)return;
    const start=performance.now();let uploads=0,prepared=0,posted=0,validated=0,allocated=0,copied=0;
    while(performance.now()-start<budgetMs){
      if(!this.job){const phase=performance.now(),next=this.queue.values().next();if(next.done)break;const entry=next.value,t=entry.tile;this.queue.delete(t);if(!t.mesh)continue;
        const triangles:Float32Array[]=[];for(const s of this.sources)triangles.push(...s.roadCutTriangles?.(t.x0,t.z0,t.x0+t.size,t.z0+t.size)??[]);
        this.job={entry,revision:this.revision(t),steps:rasterCuts(triangles,t.x0,t.z0,t.x0+t.size,t.z0+t.size),copied:0,id:++this.serial};
        prepared+=performance.now()-phase;
        if(this.worker){const phase=performance.now();this.job.workerSent=true;this.audit.workerJobs++;this.worker.postMessage({id:this.job.id,triangles,bounds:[t.x0,t.z0,t.x0+t.size,t.z0+t.size]});posted+=performance.now()-phase;}
      }
      const j=this.job,e=j.entry;
      const phase=performance.now(),stale=!e.tile.mesh||j.revision!==this.revision(e.tile);validated+=performance.now()-phase;
      if(stale){if(j.allocation)this.free(j.allocation);this.job=null;this.update(e.tile);continue;}
      if(j.result===undefined&&j.workerSent)break;
      if(j.result===undefined){const began=performance.now(),next=j.steps.next();this.audit.steps++;this.audit.maxStepMs=Math.max(this.audit.maxStepMs,performance.now()-began);if(!next.done)continue;j.result=next.value;
        if(!j.result){e.revision=j.revision;e.tile.roadCutRevision=j.revision;this.job=null;continue;}
      }
      if(!j.result){e.revision=j.revision;e.tile.roadCutRevision=j.revision;this.job=null;continue;}
      if(!j.allocation){const phase=performance.now();j.allocation=this.allocate(Math.ceil(j.result.data.length/FLOATS))??undefined;allocated+=performance.now()-phase;if(!j.allocation)break;this.audit.maxCandidates=Math.max(this.audit.maxCandidates,j.result.maxCandidates);}
      if(uploads>=1)break;
      const copying=performance.now(),a=j.allocation!,data=j.result!.data,from=j.copied*FLOATS,layer=a.first+j.copied;
      a.atlas.data.set(data.subarray(from,Math.min(from+FLOATS,data.length)),layer*FLOATS);a.atlas.texture.addLayerUpdate(layer);a.atlas.texture.needsUpdate=true;j.copied++;uploads++;
      if(j.copied===a.pages){if(e.allocation)this.free(e.allocation);e.allocation=a;e.raster=j.result!;e.revision=j.revision;e.tile.roadCutRevision=j.revision;
        const u=(e.tile.mesh!.material as THREE.ShaderMaterial).uniforms;u.tRoadCut.value=a.atlas.texture;u.roadCutRect.value.set(e.raster.x0,e.raster.z0,1,1);u.roadCutLayout.value.set(e.raster.width,e.raster.height,a.first,PAGE);u.roadCuts.value=1;this.job=null;
      }copied+=performance.now()-copying;
    }
    this.audit.prepareMs=Math.max(this.audit.prepareMs,prepared);this.audit.postMs=Math.max(this.audit.postMs,posted);this.audit.validateMs=Math.max(this.audit.validateMs,validated);this.audit.allocateMs=Math.max(this.audit.allocateMs,allocated);this.audit.copyMs=Math.max(this.audit.copyMs,copied);
    this.audit.frames++;this.audit.maxFrameMs=Math.max(this.audit.maxFrameMs,performance.now()-start);
  }
  private allocate(pages:number):Allocation|null {
    if(pages>LAYERS)throw Error('Road cut tile exceeds atlas page capacity');
    for(const atlas of this.atlases){let run=0;for(let i=0;i<LAYERS;i++){run=atlas.used[i]?0:run+1;if(run===pages){const first=i-pages+1;atlas.used.fill(1,first,first+pages);return{atlas,first,pages};}}}
    let data=this.backing.pop();if(!data&&this.worker){if(!this.bufferRequested){this.bufferRequested=true;this.worker.postMessage({buffer:true});}return null;}data??=new Float32Array(FLOATS*LAYERS);
    const texture=new THREE.DataArrayTexture(data,PAGE,PAGE,LAYERS);texture.type=THREE.FloatType;texture.format=THREE.RGBAFormat;
    const atlas={data,texture,used:new Uint8Array(LAYERS)};this.atlases.push(atlas);this.audit.atlases++;this.audit.bytes+=data.byteLength;
    // Null uses Three's shared empty binding until the first real atlas exists.
    // Do not allocate/dispose a live placeholder texture during the loading pump.
    if(this.atlases.length===1){for(const e of this.entries.values())if(e.tile.mesh)(e.tile.mesh.material as THREE.ShaderMaterial).uniforms.tRoadCut.value=texture;}
    atlas.used.fill(1,0,pages);return{atlas,first:0,pages};
  }
  private free(a:Allocation):void {a.atlas.used.fill(0,a.first,a.first+a.pages);}
  release(t:CutTile):void {const e=this.entries.get(t);if(e?.allocation)this.free(e.allocation);this.entries.delete(t);this.queue.delete(t);if(this.job&&this.job.entry===e){if(this.job.allocation)this.free(this.job.allocation);this.job=null;}}
  raster(t:CutTile):CutRaster|null{return this.entries.get(t)?.raster??null;}
  dispose():void {this.worker?.terminate();this.worker=null;this.backing.length=0;for(const a of this.atlases)a.texture.dispose();this.atlases.length=0;this.entries.clear();this.queue.clear();this.job=null;}
}
