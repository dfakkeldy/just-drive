import {createSidewalkHeights} from './sidewalks-heights';
export {createSidewalkHeights} from './sidewalks-heights';
/** Both functions are serialized into one Blob; no extra asset is downloaded. */
export function sidewalkHeightWorker(makeActive:typeof createSidewalkHeights):void {
  type P=[number,number];
  type Surface={refs:number[];tops:number[];lifts:number[];probes:P[];probeBytes?:string};
  type Job={refs:number[];surfaces:Surface[];bridge:boolean};
  type Tile={level:number;i:number;j:number;size:number;x0:number;z0:number;positions:Float32Array};
  type Init={type:'init';points:P[];jobs:Job[];topCount:number;topOwners:number[][];coverage?:import('./sidewalks-heights').WalkCoverage;manifest:{origin:P;village:P;size:number;levels:Record<string,string[]>};};
  type TileMessage={type:'tile';tile:Tile;members:[number[],number[]];pieceCount:number};
  type CoverageMessage={type:'coverage';cells:number[]};
  const scope=self as unknown as {onmessage:(event:MessageEvent<Init|TileMessage|CoverageMessage>)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
  let points:P[]=[],jobs:Job[]=[],topCount=0,manifest:Init['manifest'],exists=new Set<string>(),reads=0,completed=0;
  const tiles=new Map<string,Tile>(),last:(Tile|undefined)[]=[];
  let caches:{ground:Float64Array;top:Float64Array;ready:Uint8Array}[]=[];
  let active:ReturnType<typeof createSidewalkHeights>|null=null;
  function weights(p:P,a:P,b:P,c:P):number[]{const bx=b[0]-a[0],bz=b[1]-a[1],cx=c[0]-a[0],cz=c[1]-a[1],px=p[0]-a[0],pz=p[1]-a[1],den=bx*cz-bz*cx,v=(px*cz-pz*cx)/den,w=(bx*pz-bz*px)/den;return [1-v-w,v,w];}
  function plane(p:P,c:P[],y:number[]):number {const w=weights(p,c[0],c[1],c[2]);if(w.every(v=>v>=-1e-7))return w[0]*y[0]+w[1]*y[1]+w[2]*y[2];const q=weights(p,c[0],c[2],c[3]);return q[0]*y[0]+q[1]*y[2]+q[2]*y[3];}
  function triangle(t:Tile,x:number,z:number):number {const seg=t.level>=7?128:64,n=seg+3,fa=(x-t.x0)*seg/t.size,fb=(z-t.z0)*seg/t.size,a=Math.min(Math.floor(fa),seg-1),b=Math.min(Math.floor(fb),seg-1),u=fa-a,v=fb-b,i=(b+1)*n+a+1,p=t.positions,h00=p[i*3+1],h10=p[(i+1)*3+1],h01=p[(i+n)*3+1],h11=p[(i+n+1)*3+1];return u+v<=1?h00+(h10-h00)*u+(h01-h00)*v:h11+(h01-h11)*(1-u)+(h10-h11)*(1-v);}
  function atLevel(level:number,x:number,z:number,floor=6):number|null {
    reads++;const cached=last[level];if(cached&&x>=cached.x0&&x<cached.x0+cached.size&&z>=cached.z0&&z<cached.z0+cached.size)return triangle(cached,x,z);
    const e=x+manifest.village[0]-manifest.origin[0],south=z-(manifest.village[1]-manifest.origin[1]);
    for(let l=level;l>=floor;l--){const size=manifest.size/2**l,key=`${l}/${Math.floor(e/size)}_${Math.floor(south/size)}`,t=tiles.get(key);if(t){if(l===level)last[level]=t;return triangle(t,x,z);}if(exists.has(key))return null;}return null;
  }
  function calculate(id:number,level:number):number[]|null {
    const job=jobs[id],cache=caches[level-6];if(cache.ready[id])return null;const gs:number[]=[],ts:number[]=[],candidates:number[]=[];
    // Bridge pieces stand on the modern deck mesh, which only the page has: the page computes them (Sidewalks.update).
    const sample=(p:P)=>job.bridge?null:atLevel(level,p[0],p[1]);
    for(const ref of job.refs){const y=sample(points[ref]);if(y===null)return null;cache.ground[ref]=y;gs.push(ref,y);}
    for(const surface of job.surfaces){const c=surface.refs.map(r=>points[r]),y=surface.refs.map((r,i)=>cache.ground[r]+surface.lifts[i]);let lift=0;
      for(const p of surface.probes){const height=sample(p);if(height===null)return null;lift=Math.max(lift,height+.015-plane(p,c,y));}
      for(let i=0;i<surface.tops.length;i++)candidates.push(surface.tops[i],y[i]+lift);
    }
    for(let i=0;i<candidates.length;i+=2){const t=candidates[i],value=candidates[i+1];if(!Number.isFinite(cache.top[t])||cache.top[t]<value){cache.top[t]=value;ts.push(t,value);}}
    cache.ready[id]=1;completed++;return [id,gs.length/2,ts.length/2,...gs,...ts];
  }
  function resolveActive(ids:number[],arrivedLevel?:number):void {
    let batch:number[]=[],count=0;
    const flush=()=>{if(!count)return;const data=new Float64Array(batch);scope.postMessage({type:'active',level:8,data,count},[data.buffer]);batch=[];count=0;};
    for(const id of ids){if(arrivedLevel!==undefined&&!active?.usesLevel(id,arrivedLevel))continue;const job=jobs[id],result=active?.resolve(id,(level,p)=>job.bridge?null:atLevel(level,p[0],p[1],0));if(result){completed++;batch.push(...result);if(++count===8)flush();}}
    flush();
  }
  scope.onmessage=({data})=>{
    if(data.type==='init'){
      points=data.points;jobs=data.jobs;topCount=data.topCount;manifest=data.manifest;
      exists=new Set(Object.entries(manifest.levels).flatMap(([level,names])=>names.map(n=>`${level}/${n}`)));
      for(const job of jobs)for(const s of job.surfaces)if(s.probeBytes&&!s.probes.length){const native=(Uint8Array as unknown as {fromBase64?:(s:string)=>Uint8Array}).fromBase64,bytes=native?native(s.probeBytes):Uint8Array.from(atob(s.probeBytes),c=>c.charCodeAt(0)),flat=new Float64Array(bytes.buffer);for(let i=0;i<flat.length;i+=2)s.probes.push([flat[i],flat[i+1]]);}
      active=data.coverage?makeActive({...data,coverage:data.coverage}):null;
      caches=Array.from({length:3},()=>({ground:new Float64Array(points.length).fill(NaN),top:new Float64Array(topCount).fill(NaN),ready:new Uint8Array(jobs.length)}));scope.postMessage({type:'ready'});return;
    }
    if(data.type==='coverage'){resolveActive(active?.select(data.cells)??[]);scope.postMessage({type:'done',reads,completed});return;}
    const tile=data.tile,key=`${tile.level}/${tile.i}_${tile.j}`;tiles.set(key,tile);last[tile.level]=undefined;
    const work:number[]=[...data.members[0],...data.members[1].map(i=>data.pieceCount+i)];let batch:number[]=[];let count=0;
    const flush=()=>{if(!count)return;const packed=new Float64Array(batch);scope.postMessage({type:'heights',level:tile.level,data:packed,count},[packed.buffer]);batch=[];count=0;};
    if(tile.level>=6)for(const id of work){const result=calculate(id,tile.level);if(result){batch.push(...result);if(++count===8)flush();}}flush();
    resolveActive(work,tile.level);
    scope.postMessage({type:'done',reads,completed});
  };
}
