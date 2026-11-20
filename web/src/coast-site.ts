import type {Mesh,BufferGeometry,ShaderMaterial} from 'three';
/** Coast zones inferred from the public build sheet and the read-only LiDAR survey (EPSG:2961).
 * These are modelling boundaries, not mapped geological contacts. No height or driving sample changes.
 */
export const COAST_BOX = [618230, 5108340, 619080, 5110540] as const;
export const COVE_SHORE: readonly (readonly [number, number])[] = [
  [618300,5108400], [618308,5108500], [618328,5108600], [618310,5108700],
  [618278,5108800], [618268,5108850], [618282,5108900], [618460,5108950],
  [618554,5109000], [618624,5109050], [618672,5109100], [618714,5109150],
  [618756,5109200], [618784,5109250], [618810,5109300], [618834,5109350],
  [618862,5109400], [618880,5109450], [618896,5109500], [618910,5109600],
  [618918,5109700], [618924,5109800], [618910,5109900], [618888,5110000], [618870,5110040],
];
export const POINT_SHORE: readonly (readonly [number, number])[] = [
  [618602,5110500], [618554,5110430], [618534,5110400], [618522,5110300],
  [618532,5110260], [618575,5110240], [618650,5110240], [618700,5110225],
  [618730,5110190], [618760,5110185], [618810,5110200],
];
/** Several small surface hollows, at different LiDAR heights. No excavated/enterable tunnel. */
export const RECESSES = [
  { e:618573, h:6.46, n:5110254, width:1.8, rise:.85 },
  { e:618602, h:13.12, n:5110264, width:2.2, rise:1.0 },
  { e:618632, h:5.49, n:5110256, width:1.5, rise:.75 },
  { e:618660, h:11.44, n:5110258, width:2.4, rise:.85 },
  { e:618704, h:5.05, n:5110244, width:1.7, rise:.8 },
] as const;

/** One source for shader anchors and contact probes; x/y are east/south from the coast origin. */
export function coastRecessUniforms() {
  return {
    coastRecessAnchor: { value: new Float32Array(RECESSES.flatMap(p=>[p.e-618000,5109000-p.n,p.h,p.width])) },
    coastRecessRise: { value: new Float32Array(RECESSES.map(p=>p.rise)) },
  };
}

export const smooth = (a:number,b:number,x:number):number => {
  const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);
};
export function lineDistance(e:number,n:number,points:readonly (readonly [number,number])[]):number {
  let best=Infinity;
  for(let i=1;i<points.length;i++){
    const [a,b]=points[i-1],[c,d]=points[i],x=c-a,y=d-b;
    const t=Math.max(0,Math.min(1,((e-a)*x+(n-b)*y)/(x*x+y*y)));
    const de=e-a-t*x,dn=n-b-t*y;best=Math.min(best,de*de+dn*dn);
  }
  return Math.sqrt(best);
}
/** Four independent weights interpolate across drawn triangles: gypsum, beds, broken slope, beach. */
export function coastWeights(e:number,n:number,h:number,slope:number,knownDistance?:number):[number,number,number,number] {
  if(e<COAST_BOX[0]||e>COAST_BOX[2]||n<COAST_BOX[1]||n>COAST_BOX[3])return [0,0,0,0];
  const point=n>5110120;
  const distance=knownDistance ?? lineDistance(e,n,point?POINT_SHORE:COVE_SHORE);
  const shore=1-smooth(point?38:58,point?65:95,distance);
  const low=smooth(.7,2.3,h),top=1-smooth(point?32:48,point?42:65,h);
  const face=shore*low*top*smooth(.42,.82,slope);
  const white=point
    ? smooth(618710,618740,e)*(1-smooth(618800,618840,e))*(1-smooth(5110220,5110250,n))
    : smooth(5108950,5109030,n)*(1-smooth(5109280,5109350,n));
  const beds=point?1:1-smooth(5108880,5109070,n);
  const beach=shore*(1-smooth(point?1.8:2.7,point?3:4.7,h))*(1-smooth(.30,.65,slope));
  return [face*white,face*(1-white)*beds,face*(1-white)*(1-beds),beach];
}

/** Shared mineral-surface contract. Other places reuse the coast's gypsum program and block material. */
export interface RockSite {
  /** Optional render-only preparation before a new land mesh is published. */
  prepareMesh?(mesh:Mesh<BufferGeometry,ShaderMaterial>):void;
  readonly village:readonly [number,number];
  readonly box:[number,number,number,number];
  readonly quarry?:boolean;
  waterLevel?(x:number,z:number):number|null;
  contains(x:number,z:number):boolean;
  intersects(x:number,z:number,size:number):boolean;
  weights(x:number,z:number,h:number,slope:number,curvature?:number):[number,number,number,number];
  /** Authored quarry treatments that take priority over a gypsum floor. */
  quarryFloorAllowsMineral?(x:number,z:number,h:number):boolean;
  treeAllowed(x:number,z:number,h:number,slope:number):boolean;
}
export class CoastSite implements RockSite {
  readonly box:[number,number,number,number];
  private lastX=Infinity;private lastZ=Infinity;private lastDistance=Infinity;
  private distance(x:number,z:number):number {
    if(x!==this.lastX||z!==this.lastZ){
      const e=x+this.village[0],n=this.village[1]-z;
      this.lastDistance=lineDistance(e,n,n>5110120?POINT_SHORE:COVE_SHORE);this.lastX=x;this.lastZ=z;
    }
    return this.lastDistance;
  }
  constructor(readonly village:readonly [number,number]) {
    this.box=[COAST_BOX[0]-village[0],village[1]-COAST_BOX[3],COAST_BOX[2]-village[0],village[1]-COAST_BOX[1]];
  }
  contains(x:number,z:number):boolean {return x>=this.box[0]&&x<=this.box[2]&&z>=this.box[1]&&z<=this.box[3];}
  intersects(x:number,z:number,size:number):boolean {return x+size>=this.box[0]&&x<=this.box[2]&&z+size>=this.box[1]&&z<=this.box[3];}
  weights(x:number,z:number,h:number,slope:number):[number,number,number,number] {
    return this.contains(x,z)?coastWeights(x+this.village[0],this.village[1]-z,h,slope,this.distance(x,z)):[0,0,0,0];
  }
  /** Water returns, beach below high water, and unstable bare faces cannot carry trees or bushes. */
  treeAllowed(x:number,z:number,h:number,slope:number):boolean {
    if(!this.contains(x,z))return true;
    const d=this.distance(x,z);
    return h>.75 && (d>100 || (slope<.65 && this.weights(x,z,h,slope)[3]<.15));
  }
}
