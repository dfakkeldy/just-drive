import type { Road } from './roads';
import type { Site } from './terrain';

/** Invented driveway, not a surveyed property or a mail customer. EPSG:2961 metres. */
export const YARD_DOG = { east: 625186.89, north: 5096638.05, road: 'Southwest Ridge Road' } as const;
type Point = { x: number; z: number };
type Box = readonly [number, number, number, number];
type Placement = {
  roads: readonly Road[]; village: readonly [number, number];
  mail: readonly Point[]; houses: readonly Point[]; excluded: readonly Box[];
};

export class YardDogSite implements Site {
  readonly roadField='painted';
  readonly box: [number, number, number, number];
  readonly clear: number[][];
  readonly edge: number;
  /** A 4 m gravel entrance is a fraction of a sample on level 4 and coarser (16 m or more), where it would only cost a road texture. Tiles with a baked road field start at 8 m. */
  readonly maxTexel = 8;
  private constructor(readonly x: number, readonly z: number, readonly heading: number, readonly road: Road) {
    this.edge = road.halfWidth + 2.4;
    const corners = [-21,21].flatMap(u=>[0,18].map(v=>this.world(u,v)));
    this.box = [Math.min(...corners.map(p=>p.x)),Math.min(...corners.map(p=>p.z)),Math.max(...corners.map(p=>p.x)),Math.max(...corners.map(p=>p.z))];
    this.clear = [this.box];
  }
  static create(input: Placement): YardDogSite | null {
    if(!input.houses.length||!input.mail.length)return null;
    const x=YARD_DOG.east-input.village[0],z=input.village[1]-YARD_DOG.north;
    let best: { x:number;z:number;heading:number;road:Road;distance:number } | null = null;
    for(const r of input.roads) {
      if(r.name!==YARD_DOG.road||r.kind<1||r.kind>3||r.bridge)continue;
      for(let i=1;i<r.pts.length;i++) {
        const [ax,az]=r.pts[i-1],[bx,bz]=r.pts[i],dx=bx-ax,dz=bz-az;
        const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));
        const px=ax+t*dx,pz=az+t*dz,distance=Math.hypot(px-x,pz-z);
        if(!best||distance<best.distance)best={x:px,z:pz,heading:Math.atan2(dx,-dz),road:r,distance};
      }
    }
    if(!best||best.distance>8)return null;
    const site=new YardDogSite(best.x,best.z,best.heading,best.road),b=site.box;
    // Distance to the entire yard box, not only the dog's home. All houses are protected.
    const gap=(p:Point)=>Math.hypot(Math.max(b[0]-p.x,0,p.x-b[2]),Math.max(b[1]-p.z,0,p.z-b[3]));
    if(input.mail.some(p=>gap(p)<300)||input.houses.some(p=>gap(p)<300))return null;
    if(input.excluded.some(a=>b[0]<=a[2]&&b[2]>=a[0]&&b[1]<=a[3]&&b[3]>=a[1]))return null;
    // Filter once, then sample only segments that can touch the yard. No network-wide loop per pose.
    const segments=[];
    for(const r of input.roads) for(let i=1;i<r.pts.length;i++) {
      const [ax,az]=r.pts[i-1],[bx,bz]=r.pts[i],margin=r.halfWidth+1.4;
      if(Math.max(ax,bx)+margin<b[0]||Math.min(ax,bx)-margin>b[2]||Math.max(az,bz)+margin<b[1]||Math.min(az,bz)-margin>b[3])continue;
      const dx=bx-ax,dz=bz-az;
      segments.push({ax,az,dx,dz,lengthSquared:dx*dx+dz*dz,halfWidth:r.halfWidth});
    }
    // Include the end posts at along +/-20, beyond the dog's +/-18 limit.
    for(let u=-20;u<=20;u+=.5) for(let v=site.edge;v<=14;v+=.5) {
      const p=site.world(u,v);
      for(const r of segments) {
        const t=Math.max(0,Math.min(1,((p.x-r.ax)*r.dx+(p.z-r.az)*r.dz)/(r.lengthSquared||1)));
        if(Math.hypot(p.x-r.ax-t*r.dx,p.z-r.az-t*r.dz)<r.halfWidth+1.4)return null;
      }
    }
    return site;
  }
  world(along:number,across:number):Point {
    return {x:this.x+Math.sin(this.heading)*along+Math.cos(this.heading)*across,z:this.z-Math.cos(this.heading)*along+Math.sin(this.heading)*across};
  }
  local(p:Point):{along:number;across:number} {
    const dx=p.x-this.x,dz=p.z-this.z;
    return {along:dx*Math.sin(this.heading)-dz*Math.cos(this.heading),across:dx*Math.cos(this.heading)+dz*Math.sin(this.heading)};
  }
  height(_x:number,_z:number,surveyed:number):number {return surveyed;}
  surface(x:number,z:number):ReturnType<Site['surface']> {
    const p=this.local({x,z});
    if(p.across<this.edge-1.8||p.across>16||Math.abs(p.along)>20)return null;
    // A short gravel entrance and mown verge; the public road is untouched.
    return Math.abs(p.along)<2 ? {dist:Math.abs(p.along),half:2,kind:8} : {dist:0,half:1,kind:12};
  }
}
