/** Static cell index, shared by the worker and the no-Worker fallback. No imports at runtime. */
export interface WalkCoverage {col:number;row:number;cols:number;rows:number;cells:number[][]}
export interface WalkHeightSpec {
  points:[number,number][];topCount:number;topOwners:number[][];coverage:WalkCoverage;
  jobs:{refs:number[];surfaces:{refs:number[];tops:number[];lifts:number[];probes:[number,number][]}[]}[];
  manifest:{origin:[number,number];village:[number,number];size:number};
}
export function createSidewalkHeights(spec:WalkHeightSpec) {
  const {points,jobs,coverage,manifest}=spec,step=manifest.size/512;
  const levels=new Uint8Array(coverage.cells.length),ground=new Float64Array(points.length);
  const top=new Float64Array(spec.topCount).fill(NaN),own=jobs.map(()=>new Map<number,number>());
  const cellsByJob:number[][]=jobs.map(()=>[]);
  coverage.cells.forEach((ids,cell)=>{for(const id of ids)cellsByJob[id].push(cell);});
  function levelAt(p:[number,number]):number {
    const col=Math.floor((p[0]+manifest.village[0]-manifest.origin[0])/step)-coverage.col;
    const row=Math.floor((p[1]-(manifest.village[1]-manifest.origin[1]))/step)-coverage.row;
    return col<0||row<0||col>=coverage.cols||row>=coverage.rows?-2:levels[col+row*coverage.cols]-2;
  }
  const rendered=(ref:number):[number,number]=>[Math.fround(points[ref][0]),Math.fround(points[ref][1])];
  function plane(p:[number,number],c:[number,number][],y:number[]):number {
    const weights=(a:[number,number],b:[number,number],d:[number,number])=>{
      const bx=b[0]-a[0],bz=b[1]-a[1],dx=d[0]-a[0],dz=d[1]-a[1],px=p[0]-a[0],pz=p[1]-a[1],det=bx*dz-bz*dx;
      const u=(px*dz-pz*dx)/det,v=(bx*pz-bz*px)/det;return [1-u-v,u,v];
    };
    const a=weights(c[0],c[1],c[2]);
    if(a.every(v=>v>=-1e-7))return a[0]*y[0]+a[1]*y[1]+a[2]*y[2];
    const b=weights(c[0],c[2],c[3]);return b[0]*y[0]+b[1]*y[2]+b[2]*y[3];
  }
  return {
    usesLevel(id:number,level:number):boolean {return cellsByJob[id].some(cell=>levels[cell]===1||levels[cell]===level+2);},
    /** The caller supplies current primary coverage, so stale callback order cannot choose a height. */
    select(changes:number[]):number[] {
      const affected=new Set<number>();
      for(let k=0;k<changes.length;k+=2){const cell=changes[k],value=changes[k+1]+2;
        if(levels[cell]===value)continue;levels[cell]=value;
        for(const id of coverage.cells[cell])affected.add(id);
      }
      return [...affected];
    },
    resolve(id:number,sample:(level:number,p:[number,number])=>number|null):number[]|null {
      const job=jobs[id],gs:number[]=[],ts:number[]=[],candidates=new Map<number,number>();
      // No active land (for example a sea quarter) uses the ordinary loaded-land
      // fallback. An as-yet unobserved coverage cell must still wait.
      const at=(p:[number,number])=>{const level=levelAt(p);return level===-2?null:sample(level===-1?8:level,p);};
      for(const ref of job.refs){const y=at(rendered(ref));if(y===null)return null;ground[ref]=y;gs.push(ref,y);}
      for(const surface of job.surfaces){
        const c=surface.refs.map(rendered),y=surface.refs.map((ref,i)=>ground[ref]+surface.lifts[i]);let lift=0;
        for(const p of surface.probes){const height=at(p);if(height===null)return null;lift=Math.max(lift,height+.015-plane(p,c,y));}
        for(let k=0;k<surface.tops.length;k++)candidates.set(surface.tops[k],y[k]+lift);
      }
      // Replace this owner's old contribution: a genuine coarsening must also lower shared tops.
      own[id]=candidates;
      for(const key of candidates.keys()){
        let value=-Infinity;for(const owner of spec.topOwners[key])value=Math.max(value,own[owner].get(key)??-Infinity);
        if(top[key]!==value){top[key]=value;ts.push(key,value);}
      }
      return [id,gs.length/2,ts.length/2,...gs,...ts];
    },
  };
}
