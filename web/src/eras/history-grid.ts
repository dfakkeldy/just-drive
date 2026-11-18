import type { Solid } from '../parked';
/** A fixed grid. Both the dedup set and the query output are reused by fixed-step contacts. */
export class HistoryGrid<T> {
  private cells=new Map<number,T[]>();
  private output:T[]=[];
  private seen=new Set<T>();
  private x0=Infinity;private x1=Infinity;private z0=Infinity;private z1=Infinity;
  private minX=Infinity;private maxX=-Infinity;private minZ=Infinity;private maxZ=-Infinity;
  constructor(private size=32){}
  add(value:T,x0:number,z0:number,x1:number,z1:number):void {
    for(let z=Math.floor(z0/this.size);z<=Math.floor(z1/this.size);z++)for(let x=Math.floor(x0/this.size);x<=Math.floor(x1/this.size);x++){
      this.minX=Math.min(this.minX,x);this.maxX=Math.max(this.maxX,x);this.minZ=Math.min(this.minZ,z);this.maxZ=Math.max(this.maxZ,z);
      const key=(x+16384)*32768+z+16384,a=this.cells.get(key);if(a)a.push(value);else this.cells.set(key,[value]);
    }
    this.x0=Infinity;
  }
  query(x:number,z:number,radius:number):readonly T[]{
    const x0=Math.floor((x-radius)/this.size),x1=Math.floor((x+radius)/this.size),z0=Math.floor((z-radius)/this.size),z1=Math.floor((z+radius)/this.size);
    if(x0===this.x0&&x1===this.x1&&z0===this.z0&&z1===this.z1)return this.output;
    this.x0=x0;this.x1=x1;this.z0=z0;this.z1=z1;this.output.length=0;this.seen.clear();
    for(let cz=z0;cz<=z1;cz++)for(let cx=x0;cx<=x1;cx++){
      const a=this.cells.get((cx+16384)*32768+cz+16384);if(!a)continue;
      for(let i=0;i<a.length;i++)if(!this.seen.has(a[i])){this.seen.add(a[i]);this.output.push(a[i]);}
    }
    return this.output;
  }
  queryBox(x0:number,z0:number,x1:number,z1:number):readonly T[]{
    this.x0=Infinity;this.output.length=0;this.seen.clear();
    const ax=Math.max(this.minX,Math.floor(x0/this.size)),bx=Math.min(this.maxX,Math.floor(x1/this.size)),az=Math.max(this.minZ,Math.floor(z0/this.size)),bz=Math.min(this.maxZ,Math.floor(z1/this.size));
    for(let z=az;z<=bz;z++)for(let x=ax;x<=bx;x++){
      const a=this.cells.get((x+16384)*32768+z+16384);if(!a)continue;
      for(let i=0;i<a.length;i++)if(!this.seen.has(a[i])){this.seen.add(a[i]);this.output.push(a[i]);}
    }
    return this.output;
  }

}
export const solidRadius=(s:Solid)=>Math.hypot(s.half,s.halfWidth);
