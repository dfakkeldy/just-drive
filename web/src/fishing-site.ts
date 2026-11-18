import type { Site } from './terrain';

/** Wharf 403's existing western breakwater, EPSG:2961. u east, v south, metres.
 * The bake already has both fingers and the sheltered basin; only the entrance/fill is graded at runtime.
 * A narrow concrete cap extends the western finger's inner timber face over its rough edge.
 */
export const WHARF = { e: 618663, n: 5104796, top: 1.85, left: 2, right: 12, start: 10, end: 64 } as const;
export const BOARD = { u: 11.1, v: 46 } as const;
export const BERTH = { u: 16.1, v: 47 } as const;
export const MAX_DECK_ABOVE_WATER = 2.8;
// Finest-grid bedding at u=-4, v=-18 is 3.275 m. The road falls about 0.0975 m per southward metre.
export const ENTRY = { start:-18, end:10, bedding:3.275, fall:.0975 } as const;
export const PARK = { u: 7, v: 43 } as const;

const SERVICE_GRAVEL=[[-3,-3],[4,-5],[14,-2],[30,-1],[47,3],[43,8],[29,10],[19,8],[8,9],[1,5]] as const;

export class FishingSite implements Site {
  readonly x: number; readonly z: number;
  readonly box: [number, number, number, number];
  readonly clear: number[][];
  /** Activated only after the matching mesh and guards exist. Heights are frozen, in game metres. */
  top: number | null = null;
  toe: number | null = null;
  readonly visualGravel = true;
  readonly deckDriving = { kind:9, halfWidth:(WHARF.right-WHARF.left)/2 };
  readonly level:number;
  constructor(village: [number, number], private exag=1.5, private sea=-.2) {
    this.level=sea+Math.min(MAX_DECK_ABOVE_WATER,(WHARF.top-sea)*exag);
    this.x = WHARF.e - village[0]; this.z = village[1] - WHARF.n;
    this.box = [this.x - 44, this.z - 50, this.x + 85, this.z + 104];
    // The local contact mesh must be bare land, including its eight-metre transition margin.
    // Keep averaged canopy out of the grade and the edge where wheel queries return to ordinary land.
    this.clear = [[this.x - 44, this.z - 50, this.x + 50, this.z + 100], [this.x + 13, this.z - 1, this.x + 50, this.z + 10]];
  }
  world(u: number, v: number): { x: number; z: number } { return { x: this.x + u, z: this.z + v }; }
  /** A tangent-matched run down the last 28 m; the cap stays at most 2.8 m above water. */
  entrance(v:number):number {
    const t=Math.max(0,Math.min(1,(v-ENTRY.start)/(ENTRY.end-ENTRY.start))),t2=t*t,t3=t2*t;
    const toe=this.sea+(ENTRY.bedding-this.sea)*this.exag;
    return (2*t3-3*t2+1)*toe+(t3-2*t2+t)*(-ENTRY.fall*this.exag*(ENTRY.end-ENTRY.start))+(-2*t3+3*t2)*this.level;
  }
  private smooth(a:number,b:number,x:number):number { const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t); }
  /** Only this changed ground uses the currently drawn triangles for wheel contact, including loading LODs. */
  contactMesh(x:number,z:number):number {
    const u=x-this.x,v=z-this.z;
    return this.smooth(-36,-28,u)*(1-this.smooth(34,42,u))*this.smooth(-42,-34,v)*(1-this.smooth(84,92,v));
  }
  height(x:number,z:number,surveyed:number):number {
    const u=x-this.x,v=z-this.z,world=surveyed>this.sea?this.sea+(surveyed-this.sea)*this.exag:surveyed;
    // An eight-metre shoulder and a sixteen-metre taper replace the abrupt narrowing at v=10.
    const left=-20+10*this.smooth(8,24,v);
    const side=this.smooth(0,8,Math.min(u-left,26-u)),end=this.smooth(0,8,Math.min(v+26,74-v));
    const weight=side*end;if(weight<=0)return surveyed;
    const entry=v<ENTRY.start?this.entrance(ENTRY.start)-(v-ENTRY.start)*ENTRY.fall*this.exag:this.entrance(v);
    // Support the cap's front at the actual four-metre mesh vertices without a separate entrance plane.
    const support=this.smooth(-8,0,u)*(1-this.smooth(12,13,u))*(1-this.smooth(12,24,v));
    const cap=this.level-.06,under=Math.min(world,cap)+Math.max(0,cap-world)*support;
    const blend=this.smooth(8,12,v),target=blend<=0?entry:blend>=1?under:entry+(under-entry)*blend;
    if(target===world)return surveyed;
    const raw=target>this.sea?this.sea+(target-this.sea)/this.exag:target;
    return surveyed+(raw-surveyed)*weight;
  }
  surface(x:number,z:number):{dist:number;half:number;kind:number}|null {
    const u=x-this.x,v=z-this.z;
    // A worn, irregular gravel service area, painted into the terrain. No separate floating sheet.
    const pts=SERVICE_GRAVEL;
    let inside=false,best=Infinity;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const [ax,az]=pts[j],[bx,bz]=pts[i],dx=bx-ax,dz=bz-az;
      if((az>v)!==(bz>v)&&u<(bx-ax)*(v-az)/(bz-az)+ax)inside=!inside;
      const t=Math.max(0,Math.min(1,((u-ax)*dx+(v-az)*dz)/(dx*dx+dz*dz)));
      best=Math.min(best,Math.hypot(u-ax-dx*t,v-az-dz*t));
    }
    const depth=(inside?best:-best)+.35*Math.sin(u*.83)+.22*Math.sin(v*1.2);
    return depth> -2?{dist:Math.max(6.5,10-depth),half:10,kind:11}:null;
  }
  deckHeight(x: number, z: number): number | null {
    if (this.top === null || this.toe === null) return null;
    const u = x - this.x, v = z - this.z;
    return u >= WHARF.left && u <= WHARF.right && v >= WHARF.start && v <= WHARF.end ? this.top : null;
  }
}
