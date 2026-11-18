import { AIRPORT } from './airport-source';
import type { Site } from './terrain';
export function runwayFrame(runway: typeof AIRPORT.runway) {
  const [a,b]=runway.ends, de=b[0]-a[0],dn=b[1]-a[1],length=Math.hypot(de,dn);
  return {length,ux:de/length,un:dn/length,heading:Math.atan2(de,dn)*180/Math.PI};
}
function inside(e:number,n:number,points:number[][]):boolean {
  let yes=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a[1]>n)!==(b[1]>n)&&e<(b[0]-a[0])*(n-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }
  return yes;
}
/** Paint on the baked ground. No deck and no height adjustment. Kind 13 has no potholes. */
// A constant interior field avoids the narrow road-distance encoding clipping a 46 m runway.
const PAVED=Object.freeze({dist:0,half:2,kind:13});
export class AirportSite implements Site {
  readonly box:[number,number,number,number];
  readonly airportMarkings=true;
  readonly frame;
  // Tiles are built on the main thread: reject most samples by bounding box before the exact tests.
  private readonly apronBox:[number,number,number,number];
  private readonly segments:{a:number[];x:number;y:number;len2:number;r2:number;box:[number,number,number,number]}[]=[];
  constructor(readonly village:[number,number],readonly data=AIRPORT){
    this.frame=runwayFrame(data.runway);
    this.box=[626280-village[0],village[1]-5057440,627920-village[0],village[1]-5057120];
    const es=data.apron.points.map(p=>p[0]),ns=data.apron.points.map(p=>p[1]);
    this.apronBox=[Math.min(...es),Math.min(...ns),Math.max(...es),Math.max(...ns)];
    for(const t of data.taxiways)for(let i=1;i<t.points.length;i++){
      const a=t.points[i-1],b=t.points[i],r=t.width/2;
      this.segments.push({a,x:b[0]-a[0],y:b[1]-a[1],len2:(b[0]-a[0])**2+(b[1]-a[1])**2,r2:r*r,
        box:[Math.min(a[0],b[0])-r,Math.min(a[1],b[1])-r,Math.max(a[0],b[0])+r,Math.max(a[1],b[1])+r]});
    }
  }
  height(_x:number,_z:number,surveyed:number):number{return surveyed;}
  surface(x:number,z:number){
    const e=x+this.village[0],n=this.village[1]-z,[a]=this.data.runway.ends,f=this.frame;
    const u=(e-a[0])*f.ux+(n-a[1])*f.un,v=-(e-a[0])*f.un+(n-a[1])*f.ux;
    if(u>=0&&u<=f.length&&Math.abs(v)<=this.data.runway.width/2)return PAVED;
    const b=this.apronBox;
    if(e>=b[0]&&e<=b[2]&&n>=b[1]&&n<=b[3]&&inside(e,n,this.data.apron.points))return PAVED;
    for(const s of this.segments){
      if(e<s.box[0]||e>s.box[2]||n<s.box[1]||n>s.box[3])continue;
      const t=Math.max(0,Math.min(1,((e-s.a[0])*s.x+(n-s.a[1])*s.y)/s.len2)),dx=e-s.a[0]-t*s.x,dy=n-s.a[1]-t*s.y;
      if(dx*dx+dy*dy<=s.r2)return PAVED;
    }
    return null;
  }
}
