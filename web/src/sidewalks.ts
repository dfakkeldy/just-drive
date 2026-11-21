import { sidewalkHeightWorker, createSidewalkHeights } from './sidewalks-worker';
import * as THREE from 'three';
import type { Terrain } from './terrain';
import type { Roads } from './roads';
import { readWalkPlan, type CachedArea, type CompiledWalk, type WalkCoverage } from './sidewalks-cache';
import { WALK_BUDGET, type Point, type WalkPlan } from './sidewalk-layout';

interface Range { bucket:number; start:number; count:number; refs:number[]; tops:number[]; offsets:number[]; blendTops?:number[]; blends?:number[][] }
interface SurfaceJob { refs:number[]; tops:number[]; lifts:number[]; probes:Point[]; probeBytes?:string }
interface Job { surfaces:SurfaceJob[]; ranges:Range[]; refs:number[]; centre:Point; bridge:boolean }
interface HeightCache { ground:Float64Array; top:Float64Array; ready:Uint8Array }
interface Mask { x:number; y:number; w:number; h:number; data:Uint8Array }
const emptyPlan=():WalkPlan=>({poleMoves:[],pieces:[],furniture:[],crossings:[],skipped:[],lengths:{}});
const triangleWeights=(p:Point,a:Point,b:Point,c:Point):number[]=>{
  const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],px=p[0]-a[0],py=p[1]-a[1],den=bx*cy-by*cx;
  const v=(px*cy-py*cx)/den,w=(bx*py-by*px)/den;return [1-v-w,v,w];
};
/** Vertices of the overlay of a slab's two triangles and every terrain grid, plus a 3 by 3 sweep.
 * The finest (2 m) grid contains the coarser 4/16 m boundaries. A difference of two planes
 * reaches its maximum at an overlay vertex, so the resulting lift covers the whole slab. */
export function slabProbes(c:Point[],origin:Point,step=2):Point[] {
  const points:Point[]=[...c],edges=[[0,1],[1,2],[2,3],[3,0],[0,2]];
  const inside=(p:Point)=>[triangleWeights(p,c[0],c[1],c[2]),triangleWeights(p,c[0],c[2],c[3])].some(w=>w.every(v=>v>=-1e-7));
  for(let u=0;u<=2;u++)for(let v=0;v<=2;v++) {
    const a:Point=[c[0][0]+(c[1][0]-c[0][0])*u/2,c[0][1]+(c[1][1]-c[0][1])*u/2];
    const b:Point=[c[3][0]+(c[2][0]-c[3][0])*u/2,c[3][1]+(c[2][1]-c[3][1])*u/2];points.push([a[0]+(b[0]-a[0])*v/2,a[1]+(b[1]-a[1])*v/2]);
  }
  const x0=Math.min(...c.map(p=>p[0])),x1=Math.max(...c.map(p=>p[0])),z0=Math.min(...c.map(p=>p[1])),z1=Math.max(...c.map(p=>p[1]));
  for(let x=origin[0]+Math.ceil((x0-origin[0])/step)*step;x<=x1+1e-7;x+=step)for(let z=origin[1]+Math.ceil((z0-origin[1])/step)*step;z<=z1+1e-7;z+=step)if(inside([x,z]))points.push([x,z]);
  for(const [ai,bi] of edges) {
    const a=c[ai],b=c[bi];
    for(let axis=0;axis<3;axis++) {
      const va=axis===2?a[0]+a[1]:a[axis],vb=axis===2?b[0]+b[1]:b[axis],base=axis===2?origin[0]+origin[1]:origin[axis];
      if(Math.abs(vb-va)<1e-9)continue;
      for(let line=base+Math.ceil((Math.min(va,vb)-base)/step)*step;line<=Math.max(va,vb)+1e-7;line+=step) {
        const t=(line-va)/(vb-va);if(t>=-1e-8&&t<=1+1e-8)points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
      }
    }
  }
  return points;
}
export function planeHeight(p:Point,c:Point[],y:ArrayLike<number>):number {
  const ax=c[0][0],az=c[0][1],px=p[0]-ax,pz=p[1]-az;
  let bx=c[1][0]-ax,bz=c[1][1]-az,cx=c[2][0]-ax,cz=c[2][1]-az,den=bx*cz-bz*cx;
  let v=(px*cz-pz*cx)/den,w=(bx*pz-bz*px)/den;
  if(v>=-1e-7&&w>=-1e-7&&1-v-w>=-1e-7)return (1-v-w)*y[0]+v*y[1]+w*y[2];
  bx=c[2][0]-ax;bz=c[2][1]-az;cx=c[3][0]-ax;cz=c[3][1]-az;den=bx*cz-bz*cx;
  v=(px*cz-pz*cx)/den;w=(bx*pz-bz*px)/den;return (1-v-w)*y[0]+v*y[2]+w*y[3];
}
/** Clip each original slab triangle to 24 mm bands at 1.5 m intervals.
 * Weights retain the exact parent plane, including its diagonal; no new land samples. */
export function slabJointTriangles(a:number,b:number,up=true):number[][] {
  const result:number[][]=[],along=(w:number[])=>w[1]+w[2];
  const clip=(poly:number[][],edge:number,sign:number):number[][]=>{
    const out:number[][]=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],x=along(p),y=along(q),inside=(x-edge)*sign>=0,next=(y-edge)*sign>=0;
      if(inside)out.push(p);
      if(inside!==next){const t=(edge-x)/(y-x);out.push(p.map((v,j)=>v+(q[j]-v)*t));}
    }return out;
  };
  if(b-a<1e-9)return result;
  for(let k=Math.ceil((a-.012)/1.5);k<=Math.floor((b+.012)/1.5);k++){
    const lo=Math.max(0,(k*1.5-.012-a)/(b-a)),hi=Math.min(1,(k*1.5+.012-a)/(b-a));if(hi<=lo)continue;
    for(const ids of (up?[[0,1,2],[0,2,3]]:[[0,2,1],[0,3,2]])){
      const poly=clip(clip(ids.map(id=>[0,1,2,3].map(i=>i===id?1:0)),lo,1),hi,-1);
      for(let i=1;i+1<poly.length;i++){
        const tri=[poly[0],poly[i],poly[i+1]],xy=tri.map(w=>[along(w),w[2]+w[3]]);
        if(Math.abs((xy[1][0]-xy[0][0])*(xy[2][1]-xy[0][1])-(xy[1][1]-xy[0][1])*(xy[2][0]-xy[0][0]))>1e-12)result.push(...tri);
      }
    }
  }return result;
}
export class Sidewalks {
  readonly group=new THREE.Group();
  readonly plan:WalkPlan;
  readonly audit={draws:0,triangles:0,low:false,driving:'visual only',startupMs:0,planMs:0,geometryMs:0,maskMs:0,frameMax:0,updateMax:0,heightReads:0,heightJobs:0,maskBuilds:0,disabled:false};
  private threaded=false;private worker:Worker|null=null;private workerURL='';private workerPending=0;
  private incoming:{level:number;data:Float64Array;count:number;active?:boolean}[]=[];private incomingAt=0;
  private selections:{level:number;left:number;near:number;size:number;part:number;ids:number[];furniture:number[];at:number;cellAt:number;col:number;row:number;cols:number;rows:number}[]=[];private selectionAt=0;
  private materials:THREE.MeshLambertMaterial[]=[];
  private jobs:Job[]=[];private points:Point[]=[];private bridgeRefs:boolean[]=[];private topCount=0;
  private bridgeJobs:number[]=[];
  /** Roads.bridgeRevision when the bridge pieces were last queued: they stand on the modern deck mesh. */
  private deckRevision=-1;
  /** Each bridge's walk, for Roads.bridgeWalks. main.ts hands them over only once it accepts the layer. */
  readonly bridgeReservations=new Map<number,{side:number;width:number}>();
  /** Called once if the height worker fails after main.ts accepted the layer, so the town can take back what it gave up. */
  onDisabled?:()=>void;
  private topOwners:number[][]=[];private caches:HeightCache[]=[];private wanted:Uint8Array;
  private coverage:WalkCoverage|null=null;private coverageLevels=new Uint8Array(0);
  private activeCache:HeightCache|null=null;private activeHeights:ReturnType<typeof createSidewalkHeights>|null=null;
  private activeTasks:number[]=[];private activeAt=0;private activeFlags=new Uint8Array(0);
  private tasks:number[]=[];private taskAt=0;private queued:Uint8Array;
  private dirty=new Uint32Array(1);private dirtyAt=0;private dirtyWrite=0;private dirtyFlags:Uint8Array;
  private buffers:{positions:number[];uv:number[];colors:number[]}[]=[{positions:[],uv:[],colors:[]},{positions:[],uv:[],colors:[]}];
  private meshes:THREE.Mesh[]=[];private maskEntries:(Mask|undefined)[]=[];private maskE=0;private maskN=0;private maskCols=0;private maskRows=0;
  private terrainMasks=new Map<string,Uint8Array>();private warned=false;private workOutsideUpdate=0;
  private cornersScratch:Point[]=[[0,0],[0,0],[0,0],[0,0]];
  private yScratch=new Float64Array(4);
  private changedMin=[Infinity,Infinity];private changedMax=[0,0];
  private origin:Point;private gridStep:number;
  get pending():number{return this.audit.disabled?0:this.tasks.length-this.taskAt+this.dirtyWrite-this.dirtyAt+this.workerPending+(this.incoming.length-this.incomingAt)+(this.selections.length-this.selectionAt)+this.activeTasks.length-this.activeAt;}
  constructor(private data:CachedArea|null,private village:Point,private terrain:Terrain,private network:Roads,low=false,modern=true,compiling=false) {
    const start=performance.now();this.audit.low=low;this.group.name='sidewalks';
    this.plan=data&&modern?readWalkPlan(data,low):emptyPlan();
    this.audit.planMs=performance.now()-start;
    this.origin=[(terrain.manifest?.origin[0]??village[0])-village[0],village[1]-(terrain.manifest?.origin[1]??village[1])];
    this.gridStep=(terrain.manifest?.size??65536)/256/128;
    this.wanted=new Uint8Array(this.plan.pieces.length+this.plan.furniture.length);
    this.dirty=new Uint32Array(this.wanted.length+1);this.queued=new Uint8Array(this.wanted.length*3);this.dirtyFlags=new Uint8Array(this.wanted.length);
    this.materials=['concrete','asphalt'].map(kind=>new THREE.MeshLambertMaterial({color:kind==='concrete'?0xbcbab3:0x414244,side:THREE.DoubleSide,vertexColors:true}));
    const compiled=data?.compiled?.[low?1:0];this.threaded=!!compiled&&modern&&!compiling&&typeof Worker!=='undefined';
    if(compiled&&modern&&!compiling) {
      this.restore(compiled);this.audit.geometryMs=performance.now()-start-this.audit.planMs;
      const maskStart=performance.now();this.decodeMasks(data!);this.audit.maskMs=performance.now()-maskStart;
      // Opened last, so nothing after it can throw and leak a worker; a synchronous refusal falls back to the main thread.
      if(this.threaded&&!this.audit.disabled){if(this.openWorker())this.startWorker();else{this.threaded=false;this.mainThreadHeights(compiled);}}
      this.audit.startupMs=performance.now()-start;return;
    }
    const refs=new Map<string,number>(),tops=new Map<string,number>();
    const ref=(p:Point,bridge=false)=>{const x=p[0]-village[0],z=village[1]-p[1],key=`${x.toFixed(4)},${z.toFixed(4)},${bridge}`;let id=refs.get(key);if(id===undefined){id=this.points.length;refs.set(key,id);this.points.push([x,z]);this.bridgeRefs.push(bridge);}return id;};
    const top=(p:Point,tag:string,owner:number)=>{const key=`${tag},${p[0].toFixed(4)},${p[1].toFixed(4)}`;let id=tops.get(key);if(id===undefined){id=this.topCount++;tops.set(key,id);this.topOwners[id]=[];}this.topOwners[id].push(owner);return id;};
    const surface=(points:Point[],lifts:number[],tag:string,owner:number,bridge:boolean):SurfaceJob=>({refs:points.map(p=>ref(p,bridge)),tops:points.map(p=>top(p,tag,owner)),lifts,probes:[]});
    const quad=(job:Job,s:SurfaceJob,bucket:number,uv:number[],color:number[],bottom?:number[])=>{
      const c=s.refs.map(i=>this.points[i]),up=(c[1][0]-c[0][0])*(c[3][1]-c[0][1])-(c[1][1]-c[0][1])*(c[3][0]-c[0][0])<0;
      const order=bottom?[0,1,2,0,2,3]:(up?[0,1,2,0,2,3]:[0,2,1,0,3,2]),b=this.buffers[bucket],start=b.positions.length/3,r:Range={bucket,start,count:6,refs:[],tops:[],offsets:[]};
      for(const i of order){const p=c[i];b.positions.push(p[0],0,p[1]);b.uv.push(uv[i],bottom?0:bucket===0&&tagGrass(s)?-1:1);b.colors.push(...color);r.refs.push(s.refs[i]);r.tops.push(bottom?bottom[i]:s.tops[i]);r.offsets.push(0);}job.ranges.push(r);
    };
    // A marker only during construction; no strings or geometry tests in a vegetation query.
    const grassSurfaces=new Set<SurfaceJob>();const tagGrass=(s:SurfaceJob)=>grassSurfaces.has(s);
    this.plan.pieces.forEach((p,id)=>{
      const bridge=p.a.road.bridge,c=[p.a.inner,p.b.inner,p.b.outer,p.a.outer],s=surface(c,[p.a.lift,p.b.lift,p.b.lift,p.a.lift].map(l=>l+(p.run.curb==='raised'?0:.02)),`${p.run.id}-slab`,id,bridge);
      const job:Job={surfaces:[s],ranges:[],refs:[],centre:[(p.a.centre[0]+p.b.centre[0])/2-village[0],village[1]-(p.a.centre[1]+p.b.centre[1])/2],bridge};
      quad(job,s,p.material==='concrete'?0:1,[p.a.along,p.b.along,p.b.along,p.a.along],[1,1,1]);
      if(!low&&p.material==='concrete'){
        const corners=s.refs.map(i=>this.points[i]),up=(corners[1][0]-corners[0][0])*(corners[3][1]-corners[0][1])-(corners[1][1]-corners[0][1])*(corners[3][0]-corners[0][0])<0;
        const blends=slabJointTriangles(p.a.along,p.b.along,up),visible:number[][]=[];
        for(let i=0;i<blends.length;i+=3){
          const tri=blends.slice(i,i+3),q=tri.map(w=>[Math.fround(corners.reduce((v,p,i)=>v+p[0]*w[i],0)),Math.fround(corners.reduce((v,p,i)=>v+p[1]*w[i],0))]);
          // At far world coordinates, sub-millimetre clipped tips can collapse in Float32.
          const area=(q[1][1]-q[0][1])*(q[2][0]-q[0][0])-(q[1][0]-q[0][0])*(q[2][1]-q[0][1]);
          if(area>1e-9)visible.push(...tri);
        }
        if(visible.length){
          const b=this.buffers[0],r:Range={bucket:0,start:b.positions.length/3,count:visible.length,refs:[],tops:[],offsets:[],blendTops:s.tops,blends:visible};
          for(const w of visible){const x=c.reduce((v,q,i)=>v+q[0]*w[i],0),n=c.reduce((v,q,i)=>v+q[1]*w[i],0),id=ref([x,n],bridge),point=this.points[id];
            b.positions.push(point[0],0,point[1]);b.uv.push(p.a.along+(p.b.along-p.a.along)*(w[1]+w[2]),1);b.colors.push(.72,.72,.72);r.refs.push(id);r.tops.push(-1);r.offsets.push(.001);
          }job.ranges.push(r);
        }
      }
      if(p.run.curb!=='none') {
        const curb:SurfaceJob={refs:[s.refs[0],s.refs[1],s.refs[1],s.refs[0]],tops:[-1,-1,s.tops[1],s.tops[0]],lifts:[0,0,0,0],probes:[]};
        quad(job,curb,p.material==='concrete'?0:1,[0,0,0,0],[1,1,1],curb.tops);
      }
      if(p.buffer) {
        const edge=(q:typeof p.a):Point=>[q.centre[0]+q.normal[0]*(q.road.halfWidth+.025),q.centre[1]+q.normal[1]*(q.road.halfWidth+.025)];
        const g=surface([edge(p.a),edge(p.b),p.b.inner,p.a.inner],[.02,.02,.02,.02],`${p.run.id}-grass`,id,false);job.surfaces.push(g);grassSurfaces.add(g);
        const color=new THREE.Color(0x879361);color.r/=this.materials[0].color.r;color.g/=this.materials[0].color.g;color.b/=this.materials[0].color.b;
        quad(job,g,0,[0,0,0,0],[color.r,color.g,color.b]);
      }
      job.refs=[...new Set(job.surfaces.flatMap(s=>s.refs))];this.jobs.push(job);
      if(bridge){this.bridgeJobs.push(id);const road=p.a.road,other=network.roads?.find(r=>r.id===road.id);if(other){const a=other.pts[0],b=other.pts.at(-1)!,nx=-(b[1]-a[1]),nz=b[0]-a[0];this.bridgeReservations.set(road.id,{side:p.a.normal[0]*nx-p.a.normal[1]*nz>0?1:-1,width:p.run.width+p.run.buffer});}}
    });
    this.plan.furniture.forEach((f,index)=>{
      const id=this.plan.pieces.length+index,ground=ref(f.point),job:Job={surfaces:[],ranges:[],refs:[ground],centre:this.points[ground],bridge:false};
      const box=(u:number,v:number,h:number,w:number,d:number,height:number,color:number)=>{
        const g=new THREE.BoxGeometry(w,height,d).toNonIndexed(),pos=g.attributes.position,b=this.buffers[0],start=b.positions.length/3,c=new THREE.Color(color),range:Range={bucket:0,start,count:pos.count,refs:[],tops:[],offsets:[]};
        for(let i=0;i<pos.count;i++){const x=pos.getX(i)+u,z=pos.getZ(i)+v;b.positions.push(job.centre[0]+f.normal[1]*x+f.normal[0]*z,0,job.centre[1]+f.normal[0]*x-f.normal[1]*z);b.uv.push(0,0);b.colors.push(c.r,c.g,c.b);range.refs.push(ground);range.tops.push(-1);range.offsets.push(pos.getY(i)+h);}job.ranges.push(range);g.dispose();
      };
      if(f.kind==='lamp'){box(0,0,.12,.24,.24,.24,0x263e50);box(0,0,1.85,.075,.075,3.5,0x29485b);box(0,0,3.62,.29,.29,.38,0xdecba0);box(0,0,3.87,.38,.38,.1,0x263e50);}
      else {box(0,0,.48,1.65,.46,.09,0x7e6545);box(0,.2,.75,1.65,.07,.4,0x7e6545);box(-.58,0,.23,.075,.38,.46,0x263e50);box(.58,0,.23,.075,.38,.46,0x263e50);}
      this.jobs.push(job);void id;
    });
    this.caches=Array.from({length:3},()=>({ground:new Float64Array(this.points.length).fill(NaN),top:new Float64Array(this.topCount).fill(NaN),ready:new Uint8Array(this.jobs.length)}));
    this.audit.triangles=this.buffers.reduce((n,b)=>n+b.positions.length/9,0);this.audit.draws=this.buffers.filter(b=>b.positions.length).length;
    if(this.checkBudget())this.buffers.forEach((b,i)=>{
      if(!b.positions.length)return;const geo=new THREE.BufferGeometry(),count=b.positions.length/3;
      geo.setAttribute('position',new THREE.Float32BufferAttribute(b.positions,3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('normal',new THREE.Float32BufferAttribute(new Float32Array(b.positions.length),3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));geo.setAttribute('color',new THREE.Float32BufferAttribute(b.colors,3));geo.setIndex(new THREE.BufferAttribute(new Uint32Array(count),1).setUsage(THREE.DynamicDrawUsage));
      const xs=b.positions.filter((_,j)=>j%3===0),zs=b.positions.filter((_,j)=>j%3===2),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;
      geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(cx,150,cz),Math.hypot(Math.max(...xs)-cx,Math.max(...zs)-cz,500));
      const mesh=new THREE.Mesh(geo,this.materials[i]);mesh.name=i?'sidewalk-asphalt':'sidewalk-concrete';mesh.receiveShadow=true;this.meshes[i]=mesh;this.group.add(mesh);
    });
    this.audit.geometryMs=performance.now()-start-this.audit.planMs;
    const maskStart=performance.now();if(data&&modern)this.decodeMasks(data);this.audit.maskMs=performance.now()-maskStart;
    this.buffers=[];this.audit.startupMs=performance.now()-start;
  }
  private bytes(text:string):Uint8Array {
    const native=(Uint8Array as unknown as {fromBase64?:(s:string)=>Uint8Array}).fromBase64;
    if(native)return native(text);const s=atob(text),out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out;
  }
  /** Heights on the main thread: decoded slab probes and the active-coverage resolver (no Worker, or a refused one). */
  private mainThreadHeights(template:CompiledWalk):void {
    for(const job of template.jobs)for(const surface of job.surfaces)if(surface.probeBytes&&!surface.probes.length){const flat=new Float64Array(this.bytes(surface.probeBytes).buffer);for(let i=0;i<flat.length;i+=2)surface.probes.push([flat[i],flat[i+1]]);}
    if(template.coverage)this.activeHeights=createSidewalkHeights({points:this.points,jobs:this.jobs,topOwners:this.topOwners,topCount:this.topCount,coverage:template.coverage,manifest:this.terrain.manifest});
  }
  private restore(template:CompiledWalk):void {
    this.points=template.points;this.bridgeRefs=template.bridgeRefs;this.topOwners=template.topOwners;this.topCount=template.topCount;this.bridgeJobs=template.bridgeJobs;this.jobs=template.jobs;
    this.caches=Array.from({length:3},()=>({ground:new Float64Array(this.points.length).fill(NaN),top:new Float64Array(this.topCount).fill(NaN),ready:new Uint8Array(this.jobs.length)}));
    if(template.coverage){
      this.coverage=template.coverage;this.coverageLevels=new Uint8Array(template.coverage.cells.length);this.activeFlags=new Uint8Array(this.jobs.length);
      this.activeCache={ground:new Float64Array(this.points.length).fill(NaN),top:new Float64Array(this.topCount).fill(NaN),ready:new Uint8Array(this.jobs.length)};
    }
    if(!this.threaded)this.mainThreadHeights(template);
    this.audit.triangles=template.geometries.reduce((n,g)=>n+(g?(g.positions.length/4*3-(g.positions.endsWith('==')?2:g.positions.endsWith('=')?1:0))/36:0),0);this.audit.draws=template.geometries.filter(Boolean).length;
    if(!this.checkBudget())return;
    template.geometries.forEach((g,i)=>{if(!g)return;const geo=new THREE.BufferGeometry(),positions=new Float32Array(this.bytes(g.positions).buffer),uv=new Float32Array(this.bytes(g.uv).buffer),colors=new Float32Array(this.bytes(g.colors).buffer);
      geo.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(positions.length),3).setUsage(THREE.DynamicDrawUsage));geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.setIndex(new THREE.BufferAttribute(new Uint32Array(positions.length/3),1).setUsage(THREE.DynamicDrawUsage));
      geo.boundingSphere=new THREE.Sphere(new THREE.Vector3(...g.sphere.slice(0,3)),g.sphere[3]);const mesh=new THREE.Mesh(geo,this.materials[i]);mesh.name=i?'sidewalk-asphalt':'sidewalk-concrete';mesh.receiveShadow=true;this.meshes[i]=mesh;this.group.add(mesh);
    });
    // Reserve the bridge parapet, exactly as in the offline compiler. Roads reads it when it first makes a deck.
    for(const id of this.bridgeJobs){const p=this.plan.pieces[id],road=this.network.roads?.find(r=>r.id===p.a.road.id);if(!road)continue;const a=road.pts[0],b=road.pts.at(-1)!;this.bridgeReservations.set(road.id,{side:p.a.normal[0]*(-(b[1]-a[1]))-p.a.normal[1]*(b[0]-a[0])>0?1:-1,width:p.run.width+p.run.buffer});}
  }
  private checkBudget():boolean {
    if(this.audit.draws<=WALK_BUDGET.draws&&this.audit.triangles<=(this.audit.low?WALK_BUDGET.low:WALK_BUDGET.desktop))return true;
    if(!this.warned){console.warn('Sidewalk geometry budget exceeded; skipping sidewalks');this.warned=true;}
    this.audit.disabled=true;this.group.visible=false;return false;
  }
  private decodeMasks(data:CachedArea):void {
    const es=data.tiles.map(t=>t[0]),ns=data.tiles.map(t=>t[1]);this.maskE=Math.min(...es);this.maskN=Math.min(...ns);this.maskCols=Math.max(...es)-this.maskE+1;this.maskRows=Math.max(...ns)-this.maskN+1;
    this.maskEntries=new Array(this.maskCols*this.maskRows);
    for(const [e,n,x,y,w,h,runs] of data.tiles){const bytes=typeof runs==='string'?this.bytes(runs):new Uint8Array(w*h).fill(255);if(typeof runs!=='string')for(let i=0;i<runs.length;i+=3)bytes.fill(runs[i+2],runs[i],runs[i]+runs[i+1]);this.maskEntries[e-this.maskE+(n-this.maskN)*this.maskCols]={x:e*256+x,y:n*256+y,w,h,data:bytes};}
    // Build these before the first game frame: a tile callback must never trigger
    // a 66 KB allocation/collection while land is being drawn.
    for(const [key,record]of Object.entries(data.terrain)){
      if(!record.pixels.length&&!record.members.some(([ids,fs])=>ids.length||fs.length))continue; // Height-only metadata is not a vegetation mask.
      const mask=new Uint8Array(257*257);
      for(let p=0;p<record.pixels.length;p+=3)mask.fill(record.pixels[p+2],record.pixels[p],record.pixels[p]+record.pixels[p+1]);
      this.terrainMasks.set(key,mask);this.audit.maskBuilds++;
    }
  }
  vegetationAt(x:number,z:number,margin=0):boolean {
    if(this.audit.disabled)return false;
    const e=x+this.village[0],n=this.village[1]-z,col=Math.floor(e/256)-this.maskE,row=Math.floor(n/256)-this.maskN;
    if(col<0||row<0||col>=this.maskCols||row>=this.maskRows)return false;
    const mask=this.maskEntries[col+row*this.maskCols];if(!mask)return false;
    const a=Math.floor(e-mask.x),b=Math.floor(n-mask.y);return a>=0&&b>=0&&a<mask.w&&b<mask.h&&mask.data[a+b*mask.w]<=margin;
  }
  terrainMask(level:number,i:number,j:number):Uint8Array|null {
    if(this.audit.disabled)return null;
    return this.terrainMasks.get(`${level}/${i}_${j}`)??null;
  }
  clearCanopy(level:number,i:number,j:number,canopy:Float32Array,px:Uint8ClampedArray):Float32Array|null {
    const runs=this.audit.disabled?null:this.data?.terrain[`${level}/${i}_${j}`]?.pixels;if(!runs?.length)return null;const start=performance.now(),physical=canopy.slice();
    for(let k=0;k<runs.length;k+=3){const first=runs[k],end=first+runs[k+1];canopy.fill(0,first,end);for(let p=first;p<end;p++)px[p*4+2]=0;}
    this.workOutsideUpdate+=performance.now()-start;return physical;
  }
  private queue(id:number,level:number):void {const key=id*3+level-6;if(!this.queued[key]&&!this.caches[level-6].ready[id]){this.queued[key]=1;this.tasks.push(key);}}
  private mark(id:number):void {if(!this.dirtyFlags[id]){this.dirtyFlags[id]=1;this.dirty[this.dirtyWrite++%this.dirty.length]=id;}}
  tileReady(level:number,i:number,j:number):void {
    if(level<0||level>8||this.audit.disabled)return;const start=performance.now(),record=this.data?.terrain[`${level}/${i}_${j}`],members=(record?.heightMembers??record?.members)?.[this.audit.low?1:0];
    if(this.worker){
      if(members){const tile=this.terrain.walkTileData(level,i,j);if(tile){this.workerPending++;this.worker.postMessage({type:'tile',tile,members,pieceCount:this.plan.pieces.length},[tile.positions.buffer as ArrayBuffer]);}}
      this.workOutsideUpdate+=performance.now()-start;return;
    }
    if(members){for(const id of [...members[0],...members[1].map(f=>this.plan.pieces.length+f)]){if(level>=6)this.queue(id,level);this.queueActive(id,level);}}
    this.workOutsideUpdate+=performance.now()-start;
  }
  tileSelected(level:number,i:number,j:number,part=0):void {
    if(level<6)return;this.addSelection(level,i,j,part,false);
  }
  coverageSelected(level:number,i:number,j:number,part=0):void {this.addSelection(level,i,j,part,true);}
  private addSelection(level:number,i:number,j:number,part:number,heightOnly:boolean):void {
    if(level<0||level>8||this.audit.disabled)return;const start=performance.now(),record=this.data?.terrain[`${level}/${i}_${j}`];if(!record)return;
    const members=heightOnly?[[],[]]:record.members[this.audit.low?1:0],c=heightOnly?this.coverage:null,span=2**(9-level),col=c?Math.max(0,i*span-c.col):0,row=c?Math.max(0,j*span-c.row):0;
    const cols=c?Math.max(0,Math.min(c.cols,(i+1)*span-c.col)-col):0,rows=c?Math.max(0,Math.min(c.rows,(j+1)*span-c.row)-row):0;
    const m=this.terrain.manifest,size=m.size/2**level,left=m.origin[0]+i*size-this.village[0],near=this.village[1]-m.origin[1]+j*size;
    this.selections.push({level,left,near,size,part,ids:members[0],furniture:members[1],at:0,cellAt:0,col,row,cols,rows});this.workOutsideUpdate+=performance.now()-start;
  }
  private selectSome():void {
    const s=this.selections[this.selectionAt];if(!s)return;
    if(this.coverage&&s.cellAt<s.cols*s.rows){
      const c=this.coverage,step=this.terrain.manifest.size/512,changes:number[]=[];
      for(let count=0;count<16&&s.cellAt<s.cols*s.rows;count++,s.cellAt++){
        const col=s.col+s.cellAt%s.cols,row=s.row+Math.floor(s.cellAt/s.cols),cell=col+row*c.cols;if(!c.cells[cell].length)continue;
        const x=this.terrain.manifest.origin[0]+(c.col+col+.5)*step-this.village[0],z=this.village[1]-this.terrain.manifest.origin[1]+(c.row+row+.5)*step;
        const level=this.terrain.walkSelectedLevelAt?(this.terrain.walkSelectedLevelAt(x,z)??-1):s.level;
        if(this.coverageLevels[cell]!==level+2){this.coverageLevels[cell]=level+2;changes.push(cell,level);}
      }
      if(changes.length){if(this.worker){this.workerPending++;this.worker.postMessage({type:'coverage',cells:changes});}else for(const id of this.activeHeights?.select(changes)??[])this.queueActive(id);}
      if(s.cellAt<s.cols*s.rows)return;
    }
    for(let count=0;count<16&&s.at<s.ids.length+s.furniture.length;count++,s.at++){
      const id=s.at<s.ids.length?s.ids[s.at]:this.plan.pieces.length+s.furniture[s.at-s.ids.length],p=this.jobs[id].centre,q=(p[0]>=s.left+s.size/2?1:0)+(p[1]>=s.near+s.size/2?2:0);
      if(!s.part||(s.part&(1<<q))){this.wanted[id]=s.level;this.mark(id);}
    }
    if(s.at===s.ids.length+s.furniture.length)this.selectionAt++;
  }
  /** A page whose policy refuses blob workers keeps the layer: heights then run on the main thread, as without Worker. */
  private openWorker():boolean {
    try {
      this.workerURL=URL.createObjectURL(new Blob([`(${sidewalkHeightWorker.toString()})(${createSidewalkHeights.toString()})`],{type:'text/javascript'}));
      this.worker=new Worker(this.workerURL);return true;
    } catch {
      if(this.workerURL)URL.revokeObjectURL(this.workerURL);this.workerURL='';this.worker=null;return false;
    }
  }
  private startWorker():void {
    if(!this.worker)return;this.workerPending=1;
    this.worker.onmessage=({data})=>{
      if(data.type==='ready'){this.workerPending--;URL.revokeObjectURL(this.workerURL);this.workerURL='';}
      else if(data.type==='done'){this.workerPending--;this.audit.heightReads=data.reads;this.audit.heightJobs=data.completed;}
      else if(data.type==='heights'||data.type==='active')this.incoming.push({...data,active:data.type==='active'});
    };
    this.worker.onerror=()=>{if(!this.warned){console.warn('Sidewalk height worker failed; skipping sidewalks');this.warned=true;}this.audit.disabled=true;this.group.visible=false;this.workerPending=0;this.worker?.terminate();const hook=this.onDisabled;this.onDisabled=undefined;hook?.();};
    this.worker.postMessage({type:'init',points:this.points,topCount:this.topCount,topOwners:this.topOwners,coverage:this.coverage,manifest:{origin:this.terrain.manifest.origin,village:this.terrain.manifest.village,size:this.terrain.manifest.size,levels:this.terrain.manifest.levels},jobs:this.jobs.map(j=>({refs:j.refs,surfaces:j.surfaces,bridge:j.bridge}))});
  }
  private receiveHeights():void {
    const packet=this.incoming[this.incomingAt++],a=packet.data,cache=packet.active?this.activeCache!:this.caches[packet.level-6];let at=0;
    for(let n=0;n<packet.count;n++){const id=a[at++],grounds=a[at++],tops=a[at++];for(let i=0;i<grounds;i++){const r=a[at++];cache.ground[r]=a[at++];}for(let i=0;i<tops;i++){const t=a[at++];cache.top[t]=a[at++];for(const owner of this.topOwners[t])this.mark(owner);}cache.ready[id]=1;this.mark(id);}
  }
  private queueActive(id:number,level?:number):void {if(this.activeHeights&&(level===undefined||this.activeHeights.usesLevel(id,level))&&!this.activeFlags[id]){this.activeFlags[id]=1;this.activeTasks.push(id);}}
  private resolveActive():void {
    const id=this.activeTasks[this.activeAt++];this.activeFlags[id]=0;
    const result=this.activeHeights?.resolve(id,(level,p)=>{this.audit.heightReads++;return this.jobs[id].bridge?this.network.deckHeight(p[0],p[1]):this.terrain.walkHeightAt(level,p[0],p[1]);});
    if(result)this.incoming.push({active:true,level:8,data:new Float64Array(result),count:1});
  }
  private sample(level:number,ref:number):number|null {const p=this.points[ref];this.audit.heightReads++;return this.bridgeRefs[ref]?this.network.deckHeight(p[0],p[1]):this.terrain.walkHeightAt(level,p[0],p[1]);}
  private heights(id:number,level:number):void {
    const job=this.jobs[id],cache=this.caches[level-6];
    for(const ref of job.refs){const y=this.sample(level,ref);if(y===null)return;cache.ground[ref]=y;}
    for(const surface of job.surfaces) {
      const c=this.cornersScratch,y=this.yScratch;for(let i=0;i<4;i++){c[i]=this.points[surface.refs[i]];y[i]=cache.ground[surface.refs[i]]+surface.lifts[i];}
      if(!surface.probes.length)surface.probes=slabProbes(c,this.origin,this.gridStep);
      let lift=0;
      for(const p of surface.probes) {const h=job.bridge?this.network.deckHeight(p[0],p[1]):this.terrain.walkHeightAt(level,p[0],p[1]);this.audit.heightReads++;if(h===null)return;lift=Math.max(lift,h+.015-planeHeight(p,c,y));}
      for(let i=0;i<surface.tops.length;i++){const t=surface.tops[i],value=y[i]+lift;if(!Number.isFinite(cache.top[t])||cache.top[t]<value){cache.top[t]=value;for(const owner of this.topOwners[t])this.mark(owner);}}
    }
    cache.ready[id]=1;this.audit.heightJobs++;this.mark(id);
  }
  private apply(id:number):void {
    let level=this.wanted[id]||8;while(level>=6&&!this.caches[level-6].ready[id])level--;
    if(level<6&&(!this.activeCache?.ready[id]||this.wanted[id]<6))return;
    const cache=this.activeCache?.ready[id]?this.activeCache:this.caches[level-6],job=this.jobs[id];
    for(const r of job.ranges){const mesh=this.meshes[r.bucket];if(!mesh)continue;const geo=mesh.geometry,pos=geo.attributes.position as THREE.BufferAttribute,norm=geo.attributes.normal as THREE.BufferAttribute,indices=geo.index!;
      for(let i=0;i<r.count;i++){
        const w=r.blends?.[i],tops=r.blendTops;
        const y=(w&&tops?w[0]*cache.top[tops[0]]+w[1]*cache.top[tops[1]]+w[2]*cache.top[tops[2]]+w[3]*cache.top[tops[3]]:(r.tops[i]>=0?cache.top[r.tops[i]]:cache.ground[r.refs[i]]))+r.offsets[i];
        pos.setY(r.start+i,y);indices.setX(r.start+i,r.start+i);
      }
      for(let i=r.start;i<r.start+r.count;i+=3){const ax=pos.getX(i+1)-pos.getX(i),ay=pos.getY(i+1)-pos.getY(i),az=pos.getZ(i+1)-pos.getZ(i),bx=pos.getX(i+2)-pos.getX(i),by=pos.getY(i+2)-pos.getY(i),bz=pos.getZ(i+2)-pos.getZ(i),nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,len=Math.hypot(nx,ny,nz)||1;for(let k=0;k<3;k++)norm.setXYZ(i+k,nx/len,ny/len,nz/len);}
      this.changedMin[r.bucket]=Math.min(this.changedMin[r.bucket],r.start);this.changedMax[r.bucket]=Math.max(this.changedMax[r.bucket],r.start+r.count);
    }
  }
  update():void {
    const start=performance.now();if(!this.checkBudget())return;
    // Bridge pieces read the modern deck (Roads.deckHeight) on this thread. A deck builds or rebuilds when its banks'
    // land arrives, so each new build queues them again at every level and in the active cache (resolve() replaces
    // a piece's old contribution); until their deck exists they stay unready. No slab corner is shared with a street
    // piece (sidewalks-check), so a worker packet never overwrites a deck height.
    const deckRevision=this.network.bridgeRevision??0;
    if(deckRevision!==this.deckRevision){this.deckRevision=deckRevision;
      for(const id of this.bridgeJobs){for(let l=6;l<=8;l++){const cache=this.caches[l-6];cache.ready[id]=0;for(const s of this.jobs[id].surfaces)for(const top of s.tops)cache.top[top]=NaN;this.queue(id,l);}this.queueActive(id);}
    }
    const end=start+.35;
    while(performance.now()<end&&(this.taskAt<this.tasks.length||this.dirtyAt<this.dirtyWrite||this.selectionAt<this.selections.length||this.incomingAt<this.incoming.length||this.activeAt<this.activeTasks.length)) {
      if(this.selectionAt<this.selections.length)this.selectSome();
      if(this.incomingAt<this.incoming.length)this.receiveHeights();
      if(this.taskAt<this.tasks.length){const key=this.tasks[this.taskAt++],id=Math.floor(key/3),level=key%3+6;this.queued[key]=0;this.heights(id,level);}
      if(this.activeAt<this.activeTasks.length)this.resolveActive();
      if(this.dirtyAt<this.dirtyWrite){const id=this.dirty[this.dirtyAt++%this.dirty.length];this.dirtyFlags[id]=0;this.apply(id);}
    }
    if(this.taskAt===this.tasks.length){this.tasks.length=0;this.taskAt=0;}if(this.dirtyAt===this.dirtyWrite){this.dirtyAt=this.dirtyWrite=0;}
    if(this.activeAt===this.activeTasks.length){this.activeTasks.length=0;this.activeAt=0;}
    if(this.selectionAt===this.selections.length){this.selections.length=0;this.selectionAt=0;}if(this.incomingAt===this.incoming.length){this.incoming.length=0;this.incomingAt=0;}
    for(let b=0;b<2;b++)if(this.changedMin[b]<Infinity){const g=this.meshes[b].geometry,first=this.changedMin[b],count=this.changedMax[b]-first;for(const name of ['position','normal']){const a=g.attributes[name] as THREE.BufferAttribute;a.addUpdateRange(first*3,count*3);a.needsUpdate=true;}g.index!.addUpdateRange(first,count);g.index!.needsUpdate=true;this.changedMin[b]=Infinity;this.changedMax[b]=0;}
    const elapsed=performance.now()-start;this.audit.updateMax=Math.max(this.audit.updateMax,elapsed);this.audit.frameMax=Math.max(this.audit.frameMax,elapsed+this.workOutsideUpdate);this.workOutsideUpdate=0;
  }
  dispose():void {this.worker?.terminate();if(this.workerURL)URL.revokeObjectURL(this.workerURL);for(const m of this.meshes)if(m)m.geometry.dispose();this.materials.forEach(m=>m.dispose());this.group.clear();}
}
