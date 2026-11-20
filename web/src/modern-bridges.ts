import {deckWithinReach} from './bridge-contact';
import * as THREE from 'three';
import type {Road,RoadHit} from './roads';
import type {Terrain} from './terrain';
import type {CellMask} from './road-cuts';
import {BRIDGE_CROSSINGS} from './bridge-crossings';
import {prepareTimberPlans, timberPlan} from './eras/timber-bridge';
import {Mesher, type RGB} from './yard-kit';

const APPROACH = 16, MAX_APPROACH = 96, CELL = 64, TRI_CELL = 2;
const EMPTY: readonly number[] = [];
// Signed Cantor pairing avoids row-wrap aliases, including raw-UTM fixtures. Wheel queries allocate no strings.
const key = (x:number,z:number,size:number) => {const cx=Math.floor(x/size),cz=Math.floor(z/size),a=cx>=0?2*cx:-2*cx-1,b=cz>=0?2*cz:-2*cz-1;return(a+b)*(a+b+1)/2+b;};
/** The segment of a polyline that holds distance s: the first i whose end cum[i+1] is not below s, else the last
 *  segment (at most `last`). It is a binary search for the old scan `while(i<last&&s>cum[i+1])i++`. cum never
 *  decreases, so `s>cum[i+1]` holds on a prefix; a NaN s fails every test and gives segment 0, as the scan did. */
const segmentAt = (cum:readonly number[],last:number,s:number):number => {let lo=0,hi=last;while(lo<hi){const mid=(lo+hi)>>1;if(s>cum[mid+1])lo=mid+1;else hi=mid;}return lo;};
/** Spans whose deck line comes this close to the camera build each frame (main drew a deck within 1500 m of pts[0]). */
const DRAW = 1500;
/** True when (x,z) is within `reach` of the polyline. pts[0] comes first with main's own distance formula. */
const nearLine = (pts:readonly (readonly [number,number])[],x:number,z:number,reach:number):boolean => {
  if(Math.hypot(pts[0][0]-x,pts[0][1]-z)<reach)return true;
  for(let j=1;j<pts.length;j++){const a=pts[j-1],b=pts[j],dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz,t=n>0?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/n)):0;
    if(Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<reach)return true;}
  return false;
};
interface BridgeRoad extends Road {inferred?:boolean;sources?:readonly string[];road?:number;sourceRoad?:number}
interface Approach {road:Road;cum:number[];distance:number;direction:number;offsetX:number;offsetZ:number}
interface Span {
  road:BridgeRoad;kinds:readonly number[]; pts:[number,number][]; cum:number[]; length:number; width:number; timber:boolean;
  x0:number;z0:number;x1:number;z1:number; y0:number;y1:number;outer0:number;outer1:number;level:number;revision:number;serial:number;
  skinBox:Float64Array;corridor:Float64Array;probes:Float64Array; triangles:Float32Array|null;triangleDeck:Uint8Array; cells:Map<number,number[]>; geometry:THREE.BufferGeometry|null;approachRanges:Int32Array;members:ReadonlySet<number>;parallel:Span[];narrowRail:boolean;forceBuild:boolean;startLength:number;endLength:number;smoothStart:boolean;smoothEnd:boolean;extendStart:boolean;extendEnd:boolean;
  /** Half width of each carried road, for a sidewalk reserved on the deck (Roads.bridgeWalks). */
  halves:readonly (readonly [number,number])[];
  start?:Approach;end?:Approach;
}

/** One abutment plane per connected span; the rendered triangles are also the wheel surface. */
export class ModernBridges {
  private readonly spans:Span[]=[];
  private readonly cells=new Map<number,number[]>();
  // The existing span lists in row order, so a padded hull query can skip the empty cells outside the map. `spans` holds
  // each span's listed cell rectangle (x0, z0, x1, z1 per span index), for the grid form of the same query.
  private clearanceGrid?: {x:number;z:number;w:number;h:number;members:(readonly number[]|undefined)[];spans:Int32Array};
  private readonly material=new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  private mesh:THREE.Mesh|null=null;
  /** Road ids whose spans are left out of the drawn mesh (the canal swing span while a vessel passes). */
  private readonly hidden=new Set<number>();
  private readonly driving={kind:9,halfWidth:6,washboard:false,road:true,roadKind:1};
  private sampling=false;
  /** Cumulative lengths of each road an approach follows, made once per road. */
  private readonly roadCum=new Map<Road,number[]>();
  private dirty=false;
  readonly audit={builds:0,merges:0,heightTrianglesMax:0};
  private runList:{pts:readonly (readonly [number,number])[];roads:ReadonlySet<number>;halfWidth:number}[]|null=null;
  /** Each span's centre line and the road ids it carries (its members and source road), for traffic that follows a road. */
  get runs():readonly {pts:readonly (readonly [number,number])[];roads:ReadonlySet<number>;halfWidth:number}[] {
    return this.runList??=this.spans.map(r=>({pts:r.pts,roads:new Set(r.road.sourceRoad===undefined?r.members:[...r.members,r.road.sourceRoad]),halfWidth:r.width}));
  }

  constructor(roads:readonly Road[],private terrain:Terrain,private group:THREE.Group,bakedSpans?:readonly BridgeRoad[],private nearest?:(x:number,z:number,reach:number,filter:(r:Road)=>boolean)=>RoadHit|null,private walks?:ReadonlyMap<number,{side:number;width:number}>){
    const all:BridgeRoad[]=[...roads],m=terrain.manifest;
    if(m&&bakedSpans)for(const r of bakedSpans)all.push({...r,sourceRoad:r.road,pts:r.pts.map(([e,n]):[number,number]=>[e-m.village[0],m.village[1]-n])});
    const bakedSources=new Set(bakedSpans?.flatMap(r=>r.sources??[])??[]);
    if(m){
      // Bridge roads by kind for the cover test. A crossing added below joins its list, so it covers later crossings.
      const decks=new Map<number,BridgeRoad[]>(),deck=(r:BridgeRoad)=>{let list=decks.get(r.kind);if(!list)decks.set(r.kind,list=[]);list.push(r);};
      for(const r of all)if(r.bridge)deck(r);
      for(let i=0;i<BRIDGE_CROSSINGS.length;i++){
        const c=BRIDGE_CROSSINGS[i];if(c.area!==(m.area?.id??'mabou'))continue;
        if(c.sources.every(source=>bakedSources.has(source)))continue;
        const pts=c.pts.map(([e,n]):[number,number]=>[e-m.village[0],m.village[1]-n]),same=decks.get(c.kind);
        // A future corrected bake wins. Do not lay a duplicate deck over an already flagged span.
        let covered=0;
        if(same)for(const p of pts)if(same.some(r=>{for(let j=1;j<r.pts.length;j++){
          const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
          if(Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)<2)return true;
        }return false;}))covered++;
        if(covered>=pts.length*.8)continue;
        const crossing:BridgeRoad={id:-100000-i,name:c.name,kind:c.kind,halfWidth:c.halfWidth,bridge:true,pts,inferred:c.inferred,sourceRoad:c.road};
        all.push(crossing);deck(crossing);
      }
    }
    // Survey records change from track to rail-trail at some internal joins. They still share one deck.
    const connectivity=all.map(r=>({...r,kind:r.name==='Railroad'?6:r.kind<=3?1:4}));
    // Plans join only bridge roads, in array order, so the bridge records alone give the same plans. The plans are
    // keyed by array identity: both calls take this one array. timberPlan reads only the road's id.
    const spanRoads=connectivity.filter(r=>r.bridge);
    prepareTimberPlans(spanRoads);const seen=new Set<string>();
    // Indices into `all` by road id, so a span collects its carried roads in `all` order without a full scan.
    const byId=new Map<number,number[]>();for(let i=0;i<all.length;i++){let list=byId.get(all[i].id);if(!list)byId.set(all[i].id,list=[]);list.push(i);}
    for(const road of all){
      if(!road.bridge)continue;const plan=timberPlan(road,spanRoads);if(seen.has(plan.chainKey))continue;seen.add(plan.chainKey);
      const pts=plan.path,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
      const length=cum[cum.length-1];if(length<.01)continue;
      const members=new Set(plan.chainKey.split(',').map(Number));
      const found:number[]=[];for(const id of members){const list=byId.get(id);if(list)found.push(...list);}
      const carried=found.sort((a,b)=>a-b).map(i=>all[i]);
      const width=Math.max(...carried.map(r=>r.halfWidth))+.45;
      const timber=road.kind>=4||road.name==='Railroad'||carried.some(r=>r.inferred);
      const r:Span={road,members,halves:carried.map(r=>[r.id,r.halfWidth] as const),parallel:[],narrowRail:false,forceBuild:false,startLength:16,endLength:16,smoothStart:false,smoothEnd:false,extendStart:false,extendEnd:false,kinds:[...new Set(carried.map(r=>r.kind))],pts,cum,length,width,timber,x0:Infinity,z0:Infinity,x1:-Infinity,z1:-Infinity,y0:0,y1:0,outer0:0,outer1:0,level:-1,revision:-1,serial:0,skinBox:new Float64Array([Infinity,Infinity,-Infinity,-Infinity]),corridor:new Float64Array(),probes:new Float64Array(),triangles:null,triangleDeck:new Uint8Array(),cells:new Map(),geometry:null,approachRanges:new Int32Array()};
      r.start=this.approach(r,false);r.end=this.approach(r,true);
      const corridor:number[]=[];for(let s=-APPROACH;s<length+APPROACH;s+=4){const a=this.at(r,s),b=this.at(r,Math.min(s+4,length+APPROACH));corridor.push(a.x,a.z,b.x,b.z);}r.corridor=new Float64Array(corridor);
      const probes:number[]=[];
      for(let s=-MAX_APPROACH;s<length+MAX_APPROACH+8;s+=8){const p=this.at(r,Math.min(s,length+MAX_APPROACH));for(const u of[-width,0,width]){
        const x=p.x+p.nx*u,z=p.z+p.nz*u;probes.push(x,z,NaN);r.x0=Math.min(r.x0,x);r.z0=Math.min(r.z0,z);r.x1=Math.max(r.x1,x);r.z1=Math.max(r.z1,z);
      }}
      r.probes=new Float64Array(probes);const index=this.spans.push(r)-1;
      for(const p of pts){r.x0=Math.min(r.x0,p[0]-width);r.z0=Math.min(r.z0,p[1]-width);r.x1=Math.max(r.x1,p[0]+width);r.z1=Math.max(r.z1,p[1]+width);}
      r.x0-=6;r.z0-=6;r.x1+=6;r.z1+=6;
      for(const x of[r.x0,r.x1])for(const z of[r.z0,r.z1])if(!Number.isSafeInteger(key(x,z,TRI_CELL)))throw new RangeError('Bridge grid exceeds exact numeric cell range');
      for(let z=Math.floor(r.z0/CELL);z<=Math.floor(r.z1/CELL);z++)for(let x=Math.floor(r.x0/CELL);x<=Math.floor(r.x1/CELL);x++){
        const k=key(x*CELL,z*CELL,CELL);let list=this.cells.get(k);if(!list)this.cells.set(k,list=[]);list.push(index);
      }
    }
    // A single railway and a roadway can share a canal crossing. Their schematic road widths
    // must not form overlapping driving surfaces. Grade-separated crossings remain full width.
    for(let i=0;i<this.spans.length;i++)for(let j=i+1;j<this.spans.length;j++){
      const a=this.spans[i],b=this.spans[j];if((a.road.name==='Railroad')===(b.road.name==='Railroad'))continue;
      const rail=a.road.name==='Railroad'?a:b,other=rail===a?b:a;let parallel=0,total=0;
      for(let d=0;d<=rail.length;d+=8){total++;const p=this.at(rail,d);
        for(let k=1;k<other.pts.length;k++){const q=other.pts[k-1],v=other.pts[k],dx=v[0]-q[0],dz=v[1]-q[1],n=Math.hypot(dx,dz)||1,t=((p.x-q[0])*dx+(p.z-q[1])*dz)/(n*n);
          if(t<0||t>1||Math.abs(dx*p.nz-dz*p.nx)/n<.95)continue;
          if(Math.hypot(p.x-q[0]-dx*t,p.z-q[1]-dz*t)<rail.width+other.width+.5){parallel++;break;}
        }
      }if(parallel>=3&&parallel>=total*.5){a.parallel.push(b);b.parallel.push(a);}
    }
    if(this.spans.length){
      const mask=this.mask();
      terrain.sites?.push({mask,box:[Math.min(...this.spans.map(r=>r.x0)),Math.min(...this.spans.map(r=>r.z0)),Math.max(...this.spans.map(r=>r.x1)),Math.max(...this.spans.map(r=>r.z1))],
        sitingBoxes:this.spans.map(r=>[r.x0,r.z0,r.x1,r.z1] as const),
        roadField:false,samplesTerrain:false,height:(_x,_z,h)=>h,surface:()=>null,deckDriving:this.driving,deckMask:(x,z,kind)=>this.maskPaint(x,z,kind),deckClear:(x,z,pad)=>this.clearCorridor(x,z,pad),deckClearGrid:(xs,zs,pad)=>this.clearGrid(xs,zs,pad),roadBedHeight:(x,z)=>this.roadBedHeight(x,z),roadCutHeight:(x,z)=>this.query(x,z,true,false,undefined,false,0,false),roadCutRevision:(x0,z0,x1,z1)=>this.cutRevision(x0,z0,x1,z1),roadCutTriangles:(x0,z0,x1,z1)=>this.cutTriangles(x0,z0,x1,z1),deckContactHeight:(x,z,referenceY)=>this.contactHeightAt(x,z,referenceY)});
    }
  }

  overlaps(x:number,z:number,pad=0):boolean{return this.clearCorridor(x,z,pad);}
  private maskPaint(x:number,z:number,kind:number):boolean {
    if(!this.isSpan(x,z,kind))return false;
    const list=this.cells.get(key(x,z,CELL));
    if(list)for(const index of list){const r=this.spans[index];
      const lower=this.nearest?.(x,z,12,road=>!road.bridge&&!r.members.has(road.id)&&r.road.sourceRoad!==road.id);
      if(!lower||lower.dist>lower.road.halfWidth+1.9)continue;
      for(let j=1;j<r.pts.length;j++){const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz)||1;
        if(Math.abs(dx*Math.cos(lower.heading)+dz*Math.sin(lower.heading))/len>.2)return false;
      }
    }
    return true;
  }

  /** The 64 m cells of the span grid: outside them query() and isSpan() are null or false, and so are the deck and
   *  contact callbacks the site builds on them. (overlaps() and the deckClear and deckClearGrid callbacks also scan
   *  neighbouring cells within their pad, so they can be true just outside; nothing gates them on the mask.) */
  private mask():CellMask {
    let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
    for(const r of this.spans){x0=Math.min(x0,Math.floor(r.x0/CELL));z0=Math.min(z0,Math.floor(r.z0/CELL));x1=Math.max(x1,Math.floor(r.x1/CELL));z1=Math.max(z1,Math.floor(r.z1/CELL));}
    const w=x1-x0+1,h=z1-z0+1,bits=new Uint8Array(w*h),members=new Array<readonly number[]|undefined>(w*h),spans=new Int32Array(this.spans.length*4);
    for(let s=0;s<this.spans.length;s++){const r=this.spans[s];spans.set([Math.floor(r.x0/CELL),Math.floor(r.z0/CELL),Math.floor(r.x1/CELL),Math.floor(r.z1/CELL)],s*4);}
    for(const r of this.spans)for(let z=Math.floor(r.z0/CELL);z<=Math.floor(r.z1/CELL);z++)for(let x=Math.floor(r.x0/CELL);x<=Math.floor(r.x1/CELL);x++){
      const i=(z-z0)*w+x-x0;
      if(bits[i]===1)continue;
      bits[i]=1;
      members[i]=this.cells.get(key(x*CELL,z*CELL,CELL));
    }
    this.clearanceGrid={x:x0,z:z0,w,h,members,spans};
    return {x0:x0*CELL,z0:z0*CELL,size:CELL,w,h,bits};
  }
  /** Footprint only: safe while terrain tiles are being decoded, before deck heights exist. */
  private isSpan(x:number,z:number,kind:number):boolean {
    const list=this.cells.get(key(x,z,CELL));if(!list)return false;
    for(const index of list){const r=this.spans[index];if(kind>=0&&!r.kinds.includes(kind))continue;for(let j=1;j<r.pts.length;j++){
      const a=r.pts[j-1],b=r.pts[j],dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz||1,t=((x-a[0])*dx+(z-a[1])*dz)/n;
      if(t>=-1e-7&&t<=1.0000001&&Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)<=r.width+.0001)return true;
    }}return false;
  }

  /** Only the averaged tree hull is cleared. Bare-earth heights and the water below stay untouched. */
  private clearCorridor(x:number,z:number,pad:number):boolean {
    const grid=this.clearanceGrid;
    if(!grid)return false;
    const x0=Math.max(0,Math.floor((x-pad)/CELL)-grid.x),x1=Math.min(grid.w-1,Math.floor((x+pad)/CELL)-grid.x);
    const z0=Math.max(0,Math.floor((z-pad)/CELL)-grid.z),z1=Math.min(grid.h-1,Math.floor((z+pad)/CELL)-grid.z);
    if(x0>x1||z0>z1)return false;
    for(let cz=z0;cz<=z1;cz++)for(let cx=x0;cx<=x1;cx++){
      const list=grid.members[cz*grid.w+cx];if(!list)continue;
      for(const index of list){const r=this.spans[index];
        const c=r.corridor,reach=Math.max(r.width,r.road.halfWidth+.45)+pad;
        for(let i=0;i<c.length;i+=4){
          const ax=c[i],az=c[i+1],dx=c[i+2]-ax,dz=c[i+3]-az,px=x-ax,pz=z-az;
          // Reject points outside the expanded segment box before projecting onto the segment.
          if(px-Math.max(0,dx)>reach||Math.min(0,dx)-px>reach||pz-Math.max(0,dz)>reach||Math.min(0,dz)-pz>reach)continue;
          const n=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,(px*dx+pz*dz)/n));
          if(Math.hypot(px-dx*t,pz-dz*t)<=reach)return true;
        }
      }
    }return false;
  }
  /** clearCorridor at every point of a grid (Site.deckClearGrid: xs and zs ascending), or null when it is false at all of
   *  them. clearCorridor reads a span only from the cells listed for it, so a point can match a span only when its padded
   *  cell range meets the span's cell rectangle. Each corridor piece visits only the points inside its reach box, and
   *  each point keeps clearCorridor's own tests, on the live corridor and width. */
  private clearGrid(xs:Float64Array,zs:Float64Array,pad:number):Uint8Array|null {
    const grid=this.clearanceGrid,nx=xs.length,nz=zs.length;
    if(!grid||!nx||!nz)return null;
    // Each point's padded cell range, as clearCorridor computes it (before its clamp to the map, which holds every span).
    const lx=new Float64Array(nx),hx=new Float64Array(nx),lz=new Float64Array(nz),hz=new Float64Array(nz);
    for(let a=0;a<nx;a++){lx[a]=Math.floor((xs[a]-pad)/CELL);hx[a]=Math.floor((xs[a]+pad)/CELL);}
    for(let b=0;b<nz;b++){lz[b]=Math.floor((zs[b]-pad)/CELL);hz[b]=Math.floor((zs[b]+pad)/CELL);}
    // First index whose coordinate is at least v. The slack keeps every point the box test could accept.
    const first=(v:Float64Array,at:number)=>{let lo=0,hi=v.length;while(lo<hi){const m=(lo+hi)>>1;if(v[m]<at)lo=m+1;else hi=m;}return lo;};
    const slack=1e-3;let out:Uint8Array|null=null;
    for(let s=0;s<this.spans.length;s++){
      const cx0=grid.spans[s*4],cz0=grid.spans[s*4+1],cx1=grid.spans[s*4+2],cz1=grid.spans[s*4+3];
      if(lx[0]>cx1||hx[nx-1]<cx0||lz[0]>cz1||hz[nz-1]<cz0)continue;
      const r=this.spans[s],c=r.corridor,reach=Math.max(r.width,r.road.halfWidth+.45)+pad;
      for(let i=0;i<c.length;i+=4){
        const ax=c[i],az=c[i+1],dx=c[i+2]-ax,dz=c[i+3]-az;
        const a0=first(xs,ax+Math.min(0,dx)-reach-slack),a1=first(xs,ax+Math.max(0,dx)+reach+slack)-1;
        const b0=first(zs,az+Math.min(0,dz)-reach-slack),b1=first(zs,az+Math.max(0,dz)+reach+slack)-1;
        for(let b=b0;b<=b1;b++){
          if(lz[b]>cz1||hz[b]<cz0)continue;
          const pz=zs[b]-az;
          for(let a=a0;a<=a1;a++){
            if(out?.[b*nx+a]||lx[a]>cx1||hx[a]<cx0)continue;
            const px=xs[a]-ax;
            if(px-Math.max(0,dx)>reach||Math.min(0,dx)-px>reach||pz-Math.max(0,dz)>reach||Math.min(0,dz)-pz>reach)continue;
            const n=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,(px*dx+pz*dz)/n));
            if(Math.hypot(px-dx*t,pz-dz*t)<=reach)(out??=new Uint8Array(nx*nz))[b*nx+a]=1;
          }
        }
      }
    }
    return out;
  }

  private approach(r:Span,end:boolean):Approach|undefined {
    if(!this.nearest)return;
    const p=r.pts[end?r.pts.length-1:0],q=r.pts[end?r.pts.length-2:1],dx=p[0]-q[0],dz=p[1]-q[1];
    const eligible=(road:Road)=>!road.bridge&&(road.name==='Railroad')===(r.road.name==='Railroad')&&(road.kind<=3)===(r.road.kind<=3);
    const hit=(r.road.sourceRoad===undefined?null:this.nearest(p[0],p[1],2,road=>eligible(road)&&road.id===r.road.sourceRoad))??(r.road.name?this.nearest(p[0],p[1],2,road=>eligible(road)&&road.name===r.road.name):null)??this.nearest(p[0],p[1],2,eligible);
    if(!hit)return;
    const a=hit.road.pts[hit.seg],b=hit.road.pts[hit.seg+1],sx=b[0]-a[0],sz=b[1]-a[1],dot=dx*sx+dz*sz;
    if(Math.abs(dot)<Math.hypot(dx,dz)*Math.hypot(sx,sz)*.35)return;
    // Spans that meet the same road share one length table (in Mabou, 98 approaches follow 54 roads).
    let cum=this.roadCum.get(hit.road);
    if(!cum){cum=[0];for(let i=1;i<hit.road.pts.length;i++)cum.push(cum[i-1]+Math.hypot(hit.road.pts[i][0]-hit.road.pts[i-1][0],hit.road.pts[i][1]-hit.road.pts[i-1][1]));this.roadCum.set(hit.road,cum);}
    return{road:hit.road,cum,distance:cum[hit.seg]+(cum[hit.seg+1]-cum[hit.seg])*hit.t,direction:Math.sign(dot),offsetX:p[0]-hit.x,offsetZ:p[1]-hit.z};
  }

  private at(r:Span,s:number):{x:number;z:number;nx:number;nz:number;yaw:number}{
    const approach=s<0?r.start:s>r.length?r.end:undefined;
    if(approach){
      const d=s<0?-s:s-r.length,along=approach.distance+approach.direction*d,p=approach.road.pts,cum=approach.cum;
      const i=segmentAt(cum,p.length-2,along);
      const a=p[i],b=p[i+1],n=cum[i+1]-cum[i]||1,t=(along-cum[i])/n,sign=approach.direction*(s<0?-1:1),dx=(b[0]-a[0])/n*sign,dz=(b[1]-a[1])/n*sign;
      const u=Math.min(1,d/(s<0?r.startLength:r.endLength)),blend=1-u*u*(3-2*u);
      const edge=s<0?0:r.pts.length-2,ca=r.pts[edge],cb=r.pts[edge+1],cn=Math.hypot(cb[0]-ca[0],cb[1]-ca[1])||1,turn=Math.min(1,d/4);
      const tx=(cb[0]-ca[0])/cn*(1-turn)+dx*turn,tz=(cb[1]-ca[1])/cn*(1-turn)+dz*turn,tn=Math.hypot(tx,tz)||1;
      return{x:a[0]+(b[0]-a[0])*t+approach.offsetX*blend,z:a[1]+(b[1]-a[1])*t+approach.offsetZ*blend,nx:-tz/tn,nz:tx/tn,yaw:Math.atan2(tx,tz)};
    }
    const i=segmentAt(r.cum,r.pts.length-2,s);
    const a=r.pts[i],b=r.pts[i+1],n=r.cum[i+1]-r.cum[i]||1,t=(s-r.cum[i])/n,dx=(b[0]-a[0])/n,dz=(b[1]-a[1])/n;
    return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,nx:-dz,nz:dx,yaw:Math.atan2(dx,dz)};
  }
  private land(x:number,z:number):number|null {
    // withDeck calls back here. During construction this one site is excluded, and contact scopes are cleared.
    return this.terrain.constructionHeightAt?this.terrain.constructionHeightAt(x,z):this.terrain.heightAt(x,z);
  }
  private curveData(r:Span,end:boolean,length:number,side=0):number[] {
    const bank=this.at(r,end?r.length:0),toe=this.at(r,end?r.length+length:-length),width=this.widthAt(r,end?r.length+length:-length);
    const a=this.land(toe.x+toe.nx*side*width,toe.z+toe.nz*side*width)??this.terrain.seaLevel;
    const b=Math.max(end?r.y1:r.y0,(this.land(bank.x+bank.nx*side*r.width,bank.z+bank.nz*side*r.width)??-Infinity)+.05);
    const before=this.at(r,end?r.length+length-1:-length-1),after=this.at(r,end?r.length+length+1:-length+1);
    const slope=((this.land(after.x+after.nx*side*width,after.z+after.nz*side*width)??a)-(this.land(before.x+before.nx*side*width,before.z+before.nz*side*width)??a))/2;
    const m=Math.max(-.079,Math.min(.079,slope)),n=0,y0=end?b:a,y1=end?a:b,m0=end?n:m,m1=end?m:n;
    const transition=Math.min(12,length/3),middle=(y1-y0-transition*(m0+m1)/2)/(length-transition);
    return [y0,y1,m0,m1,transition,middle,length];
  }
  private curveValue(c:readonly number[],t:number):number {
    const [y0,,m0,m1,run,m,length]=c,d=t*length;
    const integral=(u:number)=>u*u*u-.5*u*u*u*u;
    if(d<run){const u=d/run;return y0+m0*d+(m-m0)*run*integral(u);}
    const first=y0+run*(m0+m)/2;
    if(d<=length-run)return first+m*(d-run);
    const e=d-(length-run),u=e/run;return first+m*(length-2*run)+m*e+(m1-m)*run*integral(u);
  }
  private curve(r:Span,end:boolean,length:number,t:number,side=0):number {
    return this.curveValue(this.curveData(r,end,length,side),t);
  }
  private toeLength(r:Span,end:boolean,minimum=16):number {
    const columns=Math.ceil(2*r.width/.75),smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;let best=minimum,bestGrade=Infinity;
    if(end)r.smoothEnd=false;else r.smoothStart=false;
    for(let length=minimum;length<=MAX_APPROACH;length++){
      const p=this.at(r,end?r.length+length:-length),width=this.widthAt(r,end?r.length+length:-length);let grade=0,previous:number|null=null;
      for(let j=0;j<=columns;j++){const u=-width+2*width*j/columns,h=this.land(p.x+p.nx*u,p.z+p.nz*u);if(h===null){grade=Infinity;break;}if(Math.abs(u)<=width-.25){if(previous!==null)grade=Math.max(grade,Math.abs(h-previous)/(2*width/columns));previous=h;}else previous=null;}
      if(grade<bestGrade){bestGrade=grade;best=length;}
      if(grade>=.243)continue;
      if(smooth){const c=this.curveData(r,end,length),value=(t:number)=>this.curveValue(c,t),lo=Math.min(value(0),value(1)),hi=Math.max(value(0),value(1));let valid=Math.max(Math.abs(c[2]),Math.abs(c[3]),Math.abs(c[5]))<=.0795&&1.5*Math.max(Math.abs(c[5]-c[2]),Math.abs(c[3]-c[5]))/c[4]<=.011;
        for(let k=0;k<=20;k++){const h=value(k/20);if(h<lo-.02||h>hi+.02)valid=false;}
        if(!valid)continue;if(end)r.smoothEnd=true;else r.smoothStart=true;
      }return length;
    }return best;
  }
  private prepareCorridor(r:Span):void {
    const path:number[]=[];
    for(let s=-r.startLength;s<r.length+r.endLength;s+=4){const a=this.at(r,s),b=this.at(r,Math.min(s+4,r.length+r.endLength));path.push(a.x,a.z,b.x,b.z);}
    r.corridor=new Float64Array(path);
  }
  private widthAt(r:Span,s:number):number {
    if(r.narrowRail)return 1.25;
    const half=s<0?(r.start?.road.halfWidth??r.road.halfWidth):(r.end?.road.halfWidth??r.road.halfWidth),blend=Math.min(1,Math.max(0,s<0?-s:s-r.length)/4);
    return r.width+(half-r.width)*blend;
  }
  private top(r:Span,along:number,x:number,z:number):number {
    if(r.triangles){const h=this.ownHeight(r,x,z);if(h!==null)return h;}
    if(along>=0&&along<=r.length){const t=along/r.length,smooth=r.road.kind<=3&&r.length>=20&&Math.abs(r.y1-r.y0)/r.length<.06;return r.y0+(r.y1-r.y0)*(smooth?t*t*(3-2*t):t);}
    if(along<0?r.smoothStart:r.smoothEnd){const end=along>r.length,length=end?r.endLength:r.startLength,p=this.at(r,along),width=this.widthAt(r,along),side=((x-p.x)*p.nx+(z-p.z)*p.nz)/width;return this.curve(r,end,length,end?(along-r.length)/length:(along+length)/length,side);}
    const d=along<0?-along:along-r.length,t=Math.max(0,Math.min(1,1-d/(along<0?r.startLength:r.endLength))),blend=t*t*(3-2*t),land=this.land(x,z)??this.terrain.seaLevel,bank=along<0?r.y0:r.y1;
    return land+(Math.max(land,bank)-land)*blend;
  }

  private ensure(r:Span):void {
    const revision=this.terrain.dataRevision??0;if(r.revision===revision)return;r.revision=revision;
    let changed=r.forceBuild||!r.geometry,known=true;
    for(let i=0;i<r.probes.length;i+=3){const source=this.terrain.meshContactSource?.(r.probes[i],r.probes[i+1],true)??revision;
      if(source!==r.probes[i+2])changed=true;r.probes[i+2]=source;if(source<0)known=false;
    }
    if(!changed||!known)return;
    this.sampling=true;
    try{
      const a=this.at(r,-3),b=this.at(r,r.length+3),s0=this.terrain.surfaceAt(a.x,a.z),s1=this.terrain.surfaceAt(b.x,b.z);
      if(!s0||!s1||Math.min(s0.level,s1.level)<6)return;
      // The road bed supplies abutment height. A higher hillside beside the curb is not the road bed.
      // Coarse draw triangles can span a ravine. They are not bank elevations.
      // In particular, do not extrapolate the uphill road across the bank edge.
      const bank=(s:number)=>{const p=this.at(r,s);return this.land(p.x,p.z)??this.terrain.seaLevel;};
      r.y0=Math.max(bank(0),bank(-3),bank(-6),bank(-8))+.04;r.y1=Math.max(bank(r.length),bank(r.length+3),bank(r.length+6),bank(r.length+8))+.04;
      for(const q of r.parallel){
        const bank=(s:number)=>{const p=this.at(q,s);return this.land(p.x,p.z)??-Infinity;},a=Math.max(bank(0),bank(-3),bank(-6),bank(-8))+.04,b=Math.max(bank(q.length),bank(q.length+3),bank(q.length+6),bank(q.length+8))+.04;
        if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs((a+b)/2-(r.y0+r.y1)/2)>.75)continue;
        for(const t of[r,q]){const rail=t.road.name==='Railroad',width=rail?1.25:t.road.halfWidth;
          if(t.width>width){t.width=width;t.narrowRail=rail;t.forceBuild=true;t.revision=-1;}
        }
      }
      // A few DTM spans retain a small road hump. Clear it with one level lift, not a local ramp.
      // The ends remain within the 45 cm slab thickness of the surveyed bank.
      let clearance=0;for(let s=.5;s<r.length;s+=.5){const p=this.at(r,s);clearance=Math.max(clearance,(this.land(p.x,p.z)??-Infinity)+.03-(r.y0+(r.y1-r.y0)*s/r.length));}
      clearance=Math.min(.4,clearance);r.y0+=clearance;r.y1+=clearance;
      r.outer0=bank(-APPROACH);r.outer1=bank(r.length+APPROACH);
      r.level=Math.min(s0.level,s1.level);
      r.forceBuild=false;r.startLength=this.toeLength(r,false);r.endLength=this.toeLength(r,true);r.triangles=null;let geometry=this.build(r);
      for(let attempt=0;attempt<12&&(r.extendStart||r.extendEnd);attempt++){
        if(r.extendStart&&r.startLength<MAX_APPROACH)r.startLength=this.toeLength(r,false,Math.min(MAX_APPROACH,r.startLength+8));
        if(r.extendEnd&&r.endLength<MAX_APPROACH)r.endLength=this.toeLength(r,true,Math.min(MAX_APPROACH,r.endLength+8));
        if(r.startLength===MAX_APPROACH&&r.endLength===MAX_APPROACH&&!r.extendStart&&!r.extendEnd)break;
        geometry.dispose();r.triangles=null;geometry=this.build(r);
      }
      this.prepareCorridor(r);r.geometry?.dispose();r.geometry=geometry;r.serial=++this.audit.builds;this.dirty=true;
    }finally{this.sampling=false;}
  }

  /** No temporary vectors, hits, arrays or keys are created on a cached wheel query. */
  deckHeightAt(x:number,z:number,minimum=false,metadata=false):number|null {return this.query(x,z,minimum,metadata);}
  private contactHeightAt(x:number,z:number,referenceY?:number):number|null {return this.query(x,z,false,true,referenceY,true,0,referenceY!==undefined);}
  private query(x:number,z:number,minimum:boolean,metadata:boolean,referenceY?:number,contact=false,partFilter=0,build=true):number|null {
    if(this.sampling||this.terrain.cartRoads)return null;const list=this.cells.get(key(x,z,CELL));if(!list)return null;
    let best:number|null=null,tested=0;
    for(let i=0;i<list.length;i++){
      const r=this.spans[list[i]];if(build)this.ensure(r);const t=r.triangles;if(!t)continue;
      const indices=r.cells.get(key(x,z,TRI_CELL))??EMPTY;
      for(let j=0;j<indices.length;j++){
        const k=indices[j];if(partFilter===1&&r.triangleDeck[k/9]===1||partFilter===2&&r.triangleDeck[k/9]!==1)continue;tested++;const ax=t[k],az=t[k+2],bx=t[k+3]-ax,bz=t[k+5]-az,cx=t[k+6]-ax,cz=t[k+8]-az;
        const det=bx*cz-bz*cx;if(Math.abs(det)<1e-10)continue;
        const dx=x-ax,dz=z-az,u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;
        if(u< -1e-7||v< -1e-7||u+v>1.0000001)continue;
        const y=t[k+1]+u*(t[k+4]-t[k+1])+v*(t[k+7]-t[k+1]);if(contact&&r.triangleDeck[k/9]===1&&!deckWithinReach(y,referenceY))continue;if(best===null||(minimum?y<best:y>best)){best=y;
          if(!metadata)continue;
          this.applyDriving(r,r.triangleDeck[k/9]);
        }
      }
    }
    this.audit.heightTrianglesMax=Math.max(this.audit.heightTrianglesMax,tested);return best;
  }
  private roadBedHeight(x:number,z:number):number|null {
    // Earthworks belong to approaches, never to the water/land under a structural span.
    // The source footprint also covers millimetre seams in the Float32 contact grid.
    if(this.isSpan(x,z,-1)||this.query(x,z,true,false,undefined,false,2,false)!==null)return null;
    const h=this.query(x,z,true,false,undefined,false,1,false);return h===null?null:h-.03;
  }
  private applyDriving(r:Span,part:number):void {
    const deck=part===1,road=(part===0?r.start?.road:part===2?r.end?.road:r.road)??r.road;
    const wash=!!(r.road.washboard||road.washboard);
    this.driving.kind=wash?road.kind:deck?(r.timber?5:9):road.kind;
    this.driving.halfWidth=deck?r.width:r.narrowRail?1.25:road.halfWidth;this.driving.washboard=wash;this.driving.roadKind=road.kind;
  }
  private ownHeight(r:Span,x:number,z:number):number|null {
    const a=r.triangles;if(!a)return null;const indices=r.cells.get(key(x,z,TRI_CELL))??EMPTY;
    for(let j=0;j<indices.length;j++){const k=indices[j],ax=a[k],az=a[k+2],bx=a[k+3]-ax,bz=a[k+5]-az,cx=a[k+6]-ax,cz=a[k+8]-az,det=bx*cz-bz*cx;if(Math.abs(det)<1e-10)continue;
      const dx=x-ax,dz=z-az,u=(dx*cz-dz*cx)/det,v=(bx*dz-bz*dx)/det;if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)return a[k+1]+u*(a[k+4]-a[k+1])+v*(a[k+7]-a[k+1]);
    }return null;
  }
  private cutRevision(x0:number,z0:number,x1:number,z1:number):number {
    let value=0;for(const r of this.spans)if(r.geometry&&r.skinBox[0]<=x1&&r.skinBox[2]>=x0&&r.skinBox[1]<=z1&&r.skinBox[3]>=z0)value+=r.serial;return value;
  }
  private cutTriangles(x0:number,z0:number,x1:number,z1:number):readonly Float32Array[] {
    return this.spans.filter(r=>r.triangles&&r.skinBox[0]<=x1&&r.skinBox[2]>=x0&&r.skinBox[1]<=z1&&r.skinBox[3]>=z0).map(r=>r.triangles!);
  }
  /** Hide or show the deck of the spans that carry road `id`: its surface, underside, rails and supports. The
   *  approaches stay drawn, since the road cuts under them stay. Drawing only: contact, cuts and paint stay. A no-op
   *  when unchanged, so a caller may set it every frame; a change re-merges the mesh at once. */
  setHidden(id:number,hide:boolean):void {
    if(this.hidden.has(id)===hide)return;
    if(hide)this.hidden.add(id);else this.hidden.delete(id);
    if(this.mesh)this.merge();else this.dirty=true;
  }
  private drawn(r:Span):boolean {
    for(const id of this.hidden)if(r.road.id===id||r.members.has(id)||r.road.sourceRoad===id)return false;
    return true;
  }
  update(cam:THREE.Vector3):void {
    if(this.walks&&this.walks.size!==this.walkCount)this.reserveWalks();
    // The box is a cheap prefilter. Only a deck line within DRAW builds here; a query (contact, deck height or
    // placement) still builds any span on demand.
    for(let i=0;i<this.spans.length;i++){const r=this.spans[i];if(cam.x>r.x0-DRAW&&cam.x<r.x1+DRAW&&cam.z>r.z0-DRAW&&cam.z<r.z1+DRAW&&nearLine(r.pts,cam.x,cam.z,DRAW))this.ensure(r);}
    if(this.dirty)this.merge();
  }
  private walkCount=0;
  /** A sidewalk on a bridge (main's sidewalk layer) needs the deck to reach past it, as the old deck's widened parapet
   *  did: half width + walk + 0.3 m. Both sides widen, and a deck never narrows again, so a sidewalk layer that gives
   *  up later leaves a wide deck. Spans narrowed beside a railway keep their narrow width. */
  private reserveWalks():void {
    this.walkCount=this.walks!.size;
    for(const r of this.spans){if(r.parallel.length)continue;let need=r.width;
      for(const [id,half]of r.halves){const walk=this.walks!.get(id);if(walk)need=Math.max(need,half+walk.width+.3);}
      if(need>r.width){r.width=need;r.forceBuild=true;r.revision=-1;this.runList=null;}
    }
  }
  private merge():void {
    this.dirty=false;
    // A hidden span keeps only its approach vertices (approachRanges: start, end pairs).
    let count=0;for(const r of this.spans){if(!r.geometry)continue;if(this.drawn(r))count+=r.geometry.getAttribute('position').count;else for(let i=0;i<r.approachRanges.length;i+=2)count+=r.approachRanges[i+1]-r.approachRanges[i];}
    const geometry=new THREE.BufferGeometry();
    for(const name of['position','normal','color']as const){const data=new Float32Array(count*3);let at=0;for(const r of this.spans){const a=r.geometry?.getAttribute(name);if(!a)continue;
      if(this.drawn(r)){data.set(a.array,at);at+=a.array.length;}
      else for(let i=0;i<r.approachRanges.length;i+=2){const part=(a.array as Float32Array).subarray(r.approachRanges[i]*3,r.approachRanges[i+1]*3);data.set(part,at);at+=part.length;}
    }geometry.setAttribute(name,new THREE.BufferAttribute(data,3));}
    geometry.computeBoundingSphere();
    if(!this.mesh){this.mesh=new THREE.Mesh(geometry,this.material);this.mesh.name='Modern bridge decks';this.mesh.receiveShadow=true;this.group.add(this.mesh);}
    else{this.mesh.geometry.dispose();this.mesh.geometry=geometry;}this.audit.merges++;this.terrain.updateRoadCuts?.();
  }
  private build(r:Span,relaxCurve=false):THREE.BufferGeometry {
    const m=new Mesher(),top: number[]=[],deckFlags:number[]=[],coreRows=Math.ceil(r.length),rows=coreRows+r.startLength+r.endLength,columns=Math.ceil(2*r.width/.75),grid=new Float32Array((rows+1)*(columns+1)*3);
    const curves0=r.smoothStart?Array.from({length:columns+1},(_,j)=>this.curveData(r,false,r.startLength,-1+2*j/columns)):null,curves1=r.smoothEnd?Array.from({length:columns+1},(_,j)=>this.curveData(r,true,r.endLength,-1+2*j/columns)):null;
    const along=(i:number)=>i<=r.startLength?i-r.startLength:i<=r.startLength+coreRows?r.length*(i-r.startLength)/coreRows:r.length+i-r.startLength-coreRows;
    for(let i=0;i<=rows;i++){const s=along(i),p=this.at(r,s);
      for(let j=0;j<=columns;j++){const width=this.widthAt(r,s),u=-width+2*width*j/columns,x=p.x+p.nx*u,z=p.z+p.nz*u,k=(i*(columns+1)+j)*3;grid[k]=x;const c=s<0?curves0?.[j]:s>r.length?curves1?.[j]:null,t=s<0?(s+r.startLength)/r.startLength:(s-r.length)/r.endLength,h=c?this.curveValue(c,t):this.top(r,s,x,z);grid[k+1]=(s>=0&&s<=r.length||this.isSpan(x,z,-1))?Math.max(h,(this.land(x,z)??-Infinity)+.05):h;grid[k+2]=z;}
    }
    const floor=new Float64Array((rows+1)*(columns+1));floor.fill(-Infinity);
    const fixed=new Uint8Array(floor.length);
    for(let i=0;i<=rows;i++)for(let j=0;j<=columns;j++){const n=i*(columns+1)+j,s=along(i);if(s>=0&&s<=r.length||this.isSpan(grid[n*3],grid[n*3+2],-1))floor[n]=grid[n*3+1];if(!relaxCurve&&(s<0?r.smoothStart:s>r.length?r.smoothEnd:false)&&Math.abs(j-columns/2)<=.51)fixed[n]=1;if(i===0||i===rows){const width=this.widthAt(r,s),u=-width+2*width*j/columns;if(Math.abs(u)<=width-.25)fixed[n]=1;}}
    const checks:[number,number,number][]=[[1/3,1/3,1/3]];for(let a=0;a<=4;a++)for(let b=0;b<=4-a;b++)checks.push([a/4,b/4,(4-a-b)/4]);
    const slope=(a:number,b:number,c:number)=>{const dx=grid[b]-grid[a],dz=grid[b+2]-grid[a+2],ex=grid[c]-grid[a],ez=grid[c+2]-grid[a+2],det=dx*ez-dz*ex;if(Math.abs(det)<1e-8)return 0;const dy=grid[b+1]-grid[a+1],ey=grid[c+1]-grid[a+1];return Math.hypot((dy*ez-ey*dz)/det,(dx*ey-ex*dy)/det);};
    let badStart=false,badEnd=false;
    for(let pass=0;pass<600;pass++){
      let moved=false,lifted=false,steep=false;badStart=badEnd=false;
      for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
        const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;
        for(const tri of[[a,c,b],[b,c,d]]){
          if(pass===0)for(const w of checks){
            let x=0,y=0,z=0;for(let k=0;k<3;k++){x+=grid[tri[k]]*w[k];y+=grid[tri[k]+1]*w[k];z+=grid[tri[k]+2]*w[k];}
            if(!this.isSpan(x,z,-1))continue;const lift=(this.land(x,z)??-Infinity)+.05-y;if(lift>0){lifted=true;for(const k of tri){grid[k+1]+=lift;floor[k/3]=Math.max(floor[k/3],grid[k+1]);}}
          }
          const grade=slope(...tri as[number,number,number]);if(grade<=.246)continue;
          steep=true;
          const [u,v,w]=tri,dx=grid[v]-grid[u],dz=grid[v+2]-grid[u+2],ex=grid[w]-grid[u],ez=grid[w+2]-grid[u+2],det=dx*ez-dz*ex;
          if(Math.abs(det)<1e-8)continue;
          const cx=[(dz-ez)/det,ez/det,-dz/det],cz=[(ex-dx)/det,-ex/det,dx/det],free=tri.map((k,i)=>fixed[k/3]?-1:i).filter(i=>i>=0);
          let gx=0,gz=0,xx=0,xz=0,zz=0;for(let n=0;n<3;n++){gx+=cx[n]*grid[tri[n]+1];gz+=cz[n]*grid[tri[n]+1];}for(const n of free){xx+=cx[n]*cx[n];xz+=cx[n]*cz[n];zz+=cz[n]*cz[n];}
          const determinant=free.length===1?0:Math.max(0,xx*zz-xz*xz);
          const norm=(lambda:number)=>{const d=1+lambda*(xx+zz)+lambda*lambda*determinant;return Math.hypot(((1+lambda*zz)*gx-lambda*xz*gz)/d,((1+lambda*xx)*gz-lambda*xz*gx)/d);};
          let lo=0,hi=1/Math.max(xx,zz,1e-12);for(let n=0;n<32&&norm(hi)>.245;n++)hi*=2;
          if(norm(hi)>.246){if(i===0)badStart=true;else if(i===rows-1)badEnd=true;continue;}
          for(let n=0;n<26;n++){const mid=(lo+hi)/2;if(norm(mid)>.245)lo=mid;else hi=mid;}
          const d=1+hi*(xx+zz)+hi*hi*determinant,px=((1+hi*zz)*gx-hi*xz*gz)/d,pz=((1+hi*xx)*gz-hi*xz*gx)/d;
          for(const n of free){const k=tri[n],before=grid[k+1];grid[k+1]=Math.max(floor[k/3],before-hi*(cx[n]*px+cz[n]*pz));if(grid[k+1]!==before)moved=true;}
        }
      }
      // A fixed floor can keep a triangle steep even when Float32 heights stop moving.
      // The first pass can still have changed a shared floor after visiting its neighbour.
      if(!moved&&!(lifted&&steep))break;
    }
    // A toe with a steep crossfall needs a longer approach to find a sound road section.
    let invalid=false;
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;if(Math.max(slope(a,c,b),slope(b,c,d))>.249){invalid=true;if(i<r.startLength)badStart=true;else if(i>=r.startLength+coreRows)badEnd=true;else badStart=badEnd=true;}}
    // A hillside floor can conflict with the fixed gentle centre curve. Keep the
    // curve as the initial shape, then let the full-width grade constraint win.
    if(!relaxCurve&&(r.smoothStart||r.smoothEnd)&&invalid)return this.build(r,true);
    r.extendStart=badStart&&r.startLength<MAX_APPROACH;r.extendEnd=badEnd&&r.endLength<MAX_APPROACH;
    // Vertex ranges of the approaches (surface, stripes and fill), which stay drawn when the span's deck is hidden.
    const approachRanges:number[]=[];
    const approach=(emit:()=>void)=>{const from=m.pos.length/3;emit();const to=m.pos.length/3;if(to===from)return;
      if(approachRanges.length&&approachRanges[approachRanges.length-1]===from)approachRanges[approachRanges.length-1]=to;else approachRanges.push(from,to);};
    const triangle=(a:number,b:number,c:number,color:RGB,part:number)=>{
      deckFlags.push(part);
      if((grid[b+2]-grid[a+2])*(grid[c]-grid[a])-(grid[b]-grid[a])*(grid[c+2]-grid[a+2])<0){const swap=b;b=c;c=swap;}
      top.push(...grid.subarray(a,a+3),...grid.subarray(b,b+3),...grid.subarray(c,c+3));
      const draw=()=>m.tri(grid[a],grid[a+1],grid[a+2],grid[b],grid[b+1],grid[b+2],grid[c],grid[c+1],grid[c+2],color);
      if(part===1)draw();else approach(draw);
    };
    for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){
      const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;
      const s=(along(i)+along(i+1))/2,part=s<0?0:s>r.length?2:1,deck=part===1;
      const kind=(s<0?r.start?.road.kind:r.end?.road.kind)??r.road.kind;
      const color:RGB=deck?(r.timber?[.31+(i%3)*.012,.225+(i%3)*.008,.14]:[.205,.215,.21]):kind<=2?[.16,.16,.17]:kind===3?[.25,.225,.19]:kind===5?[.34,.32,.28]:[.17,.13,.09];
      triangle(a,c,b,color,part);triangle(b,c,d,color,part);
    }
    r.triangleDeck=new Uint8Array(deckFlags);r.triangles=new Float32Array(top);r.cells.clear();r.skinBox.set([Infinity,Infinity,-Infinity,-Infinity]);
    for(let i=0;i<top.length;i+=9){
      r.skinBox[0]=Math.min(r.skinBox[0],top[i],top[i+3],top[i+6]);r.skinBox[1]=Math.min(r.skinBox[1],top[i+2],top[i+5],top[i+8]);r.skinBox[2]=Math.max(r.skinBox[2],top[i],top[i+3],top[i+6]);r.skinBox[3]=Math.max(r.skinBox[3],top[i+2],top[i+5],top[i+8]);
      const x0=Math.floor(Math.min(top[i],top[i+3],top[i+6])/TRI_CELL),x1=Math.floor(Math.max(top[i],top[i+3],top[i+6])/TRI_CELL);
      const z0=Math.floor(Math.min(top[i+2],top[i+5],top[i+8])/TRI_CELL),z1=Math.floor(Math.max(top[i+2],top[i+5],top[i+8])/TRI_CELL);
      for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const k=key(x*TRI_CELL,z*TRI_CELL,TRI_CELL);let list=r.cells.get(k);if(!list)r.cells.set(k,list=[]);list.push(i);}
    }
    approach(()=>{for(let i=0;i<rows;i++){
      const s0=along(i),s1=along(i+1);
      if(s0>=0&&s1<=r.length)continue;
      const road=(s0<0?r.start?.road:r.end?.road)??r.road;if(road.kind!==1)continue;
      const a=this.at(r,s0),b=this.at(r,s1),ya=this.top(r,s0,a.x,a.z)+.008,yb=this.top(r,s1,b.x,b.z)+.008;
      const stripe=(u:number,width:number,color:RGB)=>m.quad([[a.x+a.nx*(u-width/2),ya,a.z+a.nz*(u-width/2)],[b.x+b.nx*(u-width/2),yb,b.z+b.nz*(u-width/2)],[b.x+b.nx*(u+width/2),yb,b.z+b.nz*(u+width/2)],[a.x+a.nx*(u+width/2),ya,a.z+a.nz*(u+width/2)]],color);
      for(const side of[-1,1]){stripe(side*.115,.12,[.55,.4,.04]);stripe(side*(road.halfWidth-.27),.12,[.55,.55,.52]);}
    }});
    // Approach fill closes the road edge down to the original soil; it is not a deck-coloured slab.
    approach(()=>{for(let i=0;i<rows;i++){
      const s=(along(i)+along(i+1))/2;if(s>=0&&s<=r.length)continue;
      for(const side of[0,columns]){const a=(i*(columns+1)+side)*3,b=a+(columns+1)*3;
        const ay=Math.min(grid[a+1]-.08,(this.land(grid[a],grid[a+2])??grid[a+1])-.3),by=Math.min(grid[b+1]-.08,(this.land(grid[b],grid[b+2])??grid[b+1])-.3);
        m.quad([[grid[a],grid[a+1],grid[a+2]],[grid[b],grid[b+1],grid[b+2]],[grid[b],by,grid[b+2]],[grid[a],ay,grid[a+2]]],[.18,.13,.08]);
      }
    }});
    const concrete:RGB=[.36,.38,.36],steel:RGB=[.38,.42,.42],wood:RGB=[.27,.19,.115],rail:RGB=r.timber?[.39,.29,.18]:steel;
    // The underside follows the same triangles. A coarse box must never stick through the driving top.
    const fascia=r.timber?wood:concrete;
    const bottom=(a:number,b:number,c:number)=>{
      if((grid[b+2]-grid[a+2])*(grid[c]-grid[a])-(grid[b]-grid[a])*(grid[c+2]-grid[a+2])>0){const swap=b;b=c;c=swap;}
      m.tri(grid[a],grid[a+1]-.45,grid[a+2],grid[b],grid[b+1]-.45,grid[b+2],grid[c],grid[c+1]-.45,grid[c+2],fascia);
    };
    for(let i=0;i<rows;i++){
      const s=(along(i)+along(i+1))/2;if(s<0||s>r.length)continue;
      for(let j=0;j<columns;j++){
        const a=(i*(columns+1)+j)*3,b=a+3,c=a+(columns+1)*3,d=c+3;
        bottom(a,b,c);bottom(b,d,c);
        if(j===0||j===columns-1){const u=j===0?a:d,v=j===0?c:b;m.quad([[grid[u],grid[u+1],grid[u+2]],[grid[v],grid[v+1],grid[v+2]],[grid[v],grid[v+1]-.45,grid[v+2]],[grid[u],grid[u+1]-.45,grid[u+2]]],fascia);}
      }
    }
    for(let s=0;s<r.length;s+=3){const run=Math.min(3,r.length-s),p=this.at(r,s+run/2),a=this.at(r,s),b=this.at(r,s+run),y=this.top(r,s+run/2,p.x,p.z),grade=(this.top(r,s+run,b.x,b.z)-this.top(r,s,a.x,a.z))/run,pitch=-Math.atan(grade),stretch=Math.hypot(1,grade);m.at(p.x,y,p.z,p.yaw,pitch);
      for(const side of[-1,1]){
        const edge=this.top(r,s+run/2,p.x+p.nx*side*r.width,p.z+p.nz*side*r.width)-y;
        m.box(side*(r.width-.12),edge+.11,0,.25,.22,run*stretch+.03,r.timber?wood:concrete);
        m.box(side*(r.width+.08),edge+.82,0,.12,.16,run*stretch+.03,rail);
        m.box(side*(r.width+.08),edge+.43,0,.09,.11,run*stretch+.03,rail);
        if((this.land(p.x,p.z)??-Infinity)<y-.8)m.box(side*r.width*.72,-.8,0,.28,.5,run*stretch+.03,r.timber?wood:steel);
        m.at(p.x,y,p.z,p.yaw);m.box(side*(r.width+.08),edge+.45,0,.14,.9,.14,rail);m.at(p.x,y,p.z,p.yaw,pitch);
      }
      if(!r.timber&&(r.start?.road.kind??r.road.kind)===1&&r.road.halfWidth>=2.8)for(const side of[-1,1])m.box(side*.115,.005,0,.12,.008,run*stretch+.01,[.55,.4,.04]);
    }
    const support=(s:number,abutment:boolean)=>{const p=this.at(r,s),y=this.top(r,s,p.x,p.z),ground=this.land(p.x,p.z)??this.terrain.seaLevel-4,bottom=Math.min(y-.9,ground-.25),h=y-.45-bottom;
      m.at(p.x,bottom,p.z,p.yaw);
      if(r.timber){for(const side of[-1,1])m.box(side*r.width*.72,h/2,0,.28,h,.32,wood);m.box(0,h-.12,0,2*r.width,.26,.38,wood);}
      else m.box(0,h/2,0,abutment?2*(r.width+.2):2*r.width*.7,h,abutment?1.1:.75,concrete);
    };
    support(0,true);support(r.length,true);
    if(r.timber)for(let s=8;s<r.length-4;s+=8)support(s,false);
    else if(r.length>35){support(r.length*.12,false);support(r.length*.88,false);}
    r.approachRanges=new Int32Array(approachRanges);
    return m.geometry();
  }
}
