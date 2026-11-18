import type { Site } from './terrain';
import type { RockSite } from './coast-site';
import { smooth } from './coast-site';
import {TALUS_TOES} from './quarry-talus';
import { QUARRY_LAKES } from './quarry-lakes';

export const QUARRY_BOX = [630200,5062000,633200,5066500] as const;
export {PARK_NOTICE} from './quarry-trip';
export const PARK_HUT = {e:632000,n:5061934};
export const GATE = { e:631996.45,n:5061904.73,heading:-.467 };
/** A level unloading area in true metres; Hill height changes its elevation, not its slope. */
export const APRON = { e:631920,n:5062068,halfE:24,halfN:34 };
export const LOOKOFFS = [{e:631708,n:5064500,name:'West Wall Lookoff'}, {e:632208,n:5064505,name:'East Top Lookoff'}] as const;
export const COURSE_PADS = [{e:632300,n:5064500,halfE:80,halfN:105},{e:631700,n:5063100,halfE:70,halfN:65}] as const;
export type Point = readonly [number,number];
export function inside(e:number,n:number,p:readonly Point[]):boolean {
  let yes=false;
  for(let i=0,j=p.length-1;i<p.length;j=i++){
    const [a,b]=p[j],[c,d]=p[i];
    if((b>n)!==(d>n)&&e<(c-a)*(n-b)/(d-b)+a)yes=!yes;
  }
  return yes;
}
export function edgeDistance(e:number,n:number,p:readonly Point[]):number {
  let best=Infinity;
  for(let i=0,j=p.length-1;i<p.length;j=i++){
    const [a,b]=p[j],[c,d]=p[i],dx=c-a,dn=d-b;
    const t=Math.max(0,Math.min(1,((e-a)*dx+(n-b)*dn)/(dx*dx+dn*dn||1)));
    best=Math.min(best,(e-a-dx*t)**2+(n-b-dn*t)**2);
  }
  return Math.sqrt(best);
}
const TALUS_CELLS=new Map<string,(readonly [number,number])[]>();
for(const p of TALUS_TOES){const key=Math.floor(p[0]/24)+','+Math.floor(p[1]/24),list=TALUS_CELLS.get(key)??[];list.push(p);TALUS_CELLS.set(key,list);}
function talusPaint(e:number,n:number,h:number):number{
  if(e<631550||e>632160||n<5063870||n>5065030)return 0;
  let best=Infinity;const cx=Math.floor(e/24),cy=Math.floor(n/24);
  for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const p of TALUS_CELLS.get(x+','+y)??[])best=Math.min(best,Math.hypot(e-p[0]-3,n-p[1]));
  // The low bench below the main wall is a bare rubble apron; taller reclaimed ground stays grassed.
  const floor=(1-smooth(.70,1.05,Math.hypot((e-631775)/82,(n-5064450)/170)))*smooth(26,28,h)*(1-smooth(33,37,h));
  return Math.max(1-smooth(3,11,best),floor);
}
const LAKES=QUARRY_LAKES.map(l=>({...l,box:[Math.min(...l.points.map(p=>p[0])),Math.min(...l.points.map(p=>p[1])),Math.max(...l.points.map(p=>p[0])),Math.max(...l.points.map(p=>p[1]))]}));
export function lakeAt(e:number,n:number):typeof LAKES[number]|undefined {
  for(const l of LAKES)if(e>=l.box[0]&&e<=l.box[2]&&n>=l.box[1]&&n<=l.box[3]&&inside(e,n,l.points))return l;
  return undefined;
}
export const onCoursePad=(e:number,n:number,margin=0):boolean=>COURSE_PADS.some(p=>Math.abs(e-p.e)<p.halfE+margin&&Math.abs(n-p.n)<p.halfN+margin);
export const onApron=(e:number,n:number,margin=0):boolean=>Math.abs(e-APRON.e)<APRON.halfE+margin&&Math.abs(n-APRON.n)<APRON.halfN+margin;
// Engineered entry lane: a bounded 7% true-metre profile, with a level unloading pad.
// Terrain applies Hill height afterwards. The survey field outside this corridor stays untouched.
const ENTRY_GRADE: readonly (readonly [number,number,number])[] = [
  [632460.605,5062022.287,25.9761],
  [632450.639,5062004.947,26.5579],
  [632440.654,5061987.618,27.2119],
  [632430.409,5061970.441,27.9348],
  [632419.776,5061953.504,28.5839],
  [632408.158,5061937.227,29.2002],
  [632395.716,5061921.576,29.8109],
  [632382.280,5061906.763,30.4957],
  [632368.333,5061892.430,31.1914],
  [632354.077,5061878.403,31.8035],
  [632339.812,5061864.385,32.3056],
  [632325.549,5061850.364,32.8128],
  [632311.275,5061836.355,33.4345],
  [632296.635,5061822.734,34.2592],
  [632281.457,5061809.710,35.1753],
  [632266.240,5061796.730,35.9884],
  [632250.972,5061783.813,36.5670],
  [632235.243,5061771.463,36.8084],
  [632219.275,5061759.419,36.7926],
  [632203.302,5061747.384,36.6647],
  [632187.250,5061735.454,36.5798],
  [632171.009,5061723.782,36.5510],
  [632154.735,5061712.156,36.6606],
  [632138.459,5061700.534,36.9677],
  [632122.185,5061688.909,37.3017],
  [632106.947,5061680.522,38.0620],
  [632098.583,5061698.689,39.4620],
  [632090.221,5061716.857,40.8620],
  [632081.857,5061735.024,42.2620],
  [632073.444,5061753.169,43.6620],
  [632064.561,5061771.086,45.0620],
  [632055.438,5061788.884,46.4620],
  [632046.310,5061806.680,47.8620],
  [632037.182,5061824.475,49.2620],
  [632028.060,5061842.274,50.6620],
  [632018.972,5061860.090,52.0620],
  [632009.956,5061877.942,53.4620],
  [632000.948,5061895.799,54.8519],
  [631991.946,5061913.658,56.0781],
  [631982.944,5061931.518,57.1919],
  [631973.935,5061949.374,58.1563],
  [631964.927,5061967.231,59.2000],
  [631955.919,5061985.087,60.6000],
  [631946.913,5062002.944,62.0000],
  [631937.907,5062020.802,63.0500],
  [631928.899,5062038.658,63.0500],
  [631919.890,5062056.515,63.0500],
  [631915.299,5062065.630,63.0500],
];
const PAD_LEVEL = 63.05, ENTRY_RADIUS = 48, ENTRY_BIN = 64;
const entryTangents = ENTRY_GRADE.map((p,i) => {
  const a=ENTRY_GRADE[Math.max(0,i-1)],b=ENTRY_GRADE[Math.min(ENTRY_GRADE.length-1,i+1)];
  const de=b[0]-a[0],dn=b[1]-a[1],scale=(b[2]-a[2])/(de*de+dn*dn||1);
  return [de*scale,dn*scale] as const;
});
const entryCells = new Map<string,{segments:number[];points:number[]}>();
for(let i=1;i<ENTRY_GRADE.length;i++){
  const a=ENTRY_GRADE[i-1],b=ENTRY_GRADE[i];
  for(let e=Math.floor((Math.min(a[0],b[0])-ENTRY_RADIUS)/ENTRY_BIN);e<=Math.floor((Math.max(a[0],b[0])+ENTRY_RADIUS)/ENTRY_BIN);e++)
    for(let n=Math.floor((Math.min(a[1],b[1])-ENTRY_RADIUS)/ENTRY_BIN);n<=Math.floor((Math.max(a[1],b[1])+ENTRY_RADIUS)/ENTRY_BIN);n++){
      const key=e+','+n,cell=entryCells.get(key)??{segments:[],points:[]};cell.segments.push(i);entryCells.set(key,cell);
    }
}
for(const cell of entryCells.values())cell.points=[...new Set(cell.segments.flatMap(i=>[i-1,i]))];
const entryBox = [Math.min(APRON.e-56,...ENTRY_GRADE.map(p=>p[0]-28)),Math.min(APRON.n-66,...ENTRY_GRADE.map(p=>p[1]-28)),
  Math.max(APRON.e+56,...ENTRY_GRADE.map(p=>p[0]+28)),Math.max(APRON.n+66,...ENTRY_GRADE.map(p=>p[1]+28))];
function entryHeight(e:number,n:number,surveyed:number):number {
  if(e<entryBox[0]||n<entryBox[1]||e>entryBox[2]||n>entryBox[3])return surveyed;
  // The extra twelve metres hold the full swept unloading/parking footprints, not just the truck centre.
  const padDistance=Math.hypot(Math.max(0,Math.abs(e-APRON.e)-APRON.halfE-12),Math.max(0,Math.abs(n-APRON.n)-APRON.halfN-12));
  if(padDistance===0)return PAD_LEVEL;
  let height=surveyed;
  const cell=entryCells.get(Math.floor(e/ENTRY_BIN)+','+Math.floor(n/ENTRY_BIN));
  if(cell){
    let distance2=Infinity;
    for(const i of cell.segments){const a=ENTRY_GRADE[i-1],b=ENTRY_GRADE[i],de=b[0]-a[0],dn=b[1]-a[1],t=Math.max(0,Math.min(1,((e-a[0])*de+(n-a[1])*dn)/(de*de+dn*dn||1)));distance2=Math.min(distance2,(e-a[0]-de*t)**2+(n-a[1]-dn*t)**2);}
    if(distance2<28*28){
      let total=0,level=0;
      for(const i of cell.points){const p=ENTRY_GRADE[i],de=e-p[0],dn=n-p[1],r2=(de*de+dn*dn)/(ENTRY_RADIUS*ENTRY_RADIUS);if(r2>=1)continue;const w=(1-r2)**4,g=entryTangents[i];total+=w;level+=w*(p[2]+g[0]*de+g[1]*dn);}
      if(total)height+=(level/total-height)*(1-smooth(8,28,Math.sqrt(distance2)));
    }
  }
  return height+(PAD_LEVEL-height)*(1-smooth(0,20,padDistance));
}

/** Mineral paint on measured land, with engineering confined to the entry and unloading area. */
export class QuarrySite implements Site,RockSite {
  readonly quarry=true;
  readonly visualGravel=true;
  readonly clear:number[][]=[];
  readonly box:[number,number,number,number];
  constructor(readonly village:readonly [number,number]){
    // The access gate and its apron are south of the workings' mineral boundary.
    this.box=[630200-village[0],village[1]-5066500,633200-village[0],village[1]-5061600];
    // A narrow entrance opening only, authorised for the portal's approach silhouette.
    for(let d=-125;d<=65;d+=5){const e=GATE.e+Math.sin(GATE.heading)*d,n=GATE.n+Math.cos(GATE.heading)*d,r=d> -65?12:8;
      this.clear.push([e-village[0]-r,village[1]-n-r,e-village[0]+r,village[1]-n+r]);}
  }
  contains(x:number,z:number):boolean{return x>=this.box[0]&&x<=this.box[2]&&z>=this.box[1]&&z<=this.box[3];}
  intersects(x:number,z:number,size:number):boolean{return x+size>=this.box[0]&&x<=this.box[2]&&z+size>=this.box[1]&&z<=this.box[3];}
  height(x:number,z:number,surveyed:number):number{return entryHeight(x+this.village[0],this.village[1]-z,surveyed);}
  surface(x:number,z:number,ground?:number):{dist:number;half:number;kind:number;coverage:number}|null{
    if(!this.contains(x,z))return null;
    const e=x+this.village[0],n=this.village[1]-z;
    let depth=-Infinity;
    for(const p of COURSE_PADS){
      const dx=(e-p.e)/p.halfE,dn=(n-p.n)/p.halfN;
      const rag=.045*Math.sin((e-p.e)*.071)+.035*Math.sin((n-p.n)*.093+(e-p.e)*.017);
      const shape=(1-Math.hypot(dx,dn)+rag)*Math.min(p.halfE,p.halfN);
      const level=ground!==undefined&&p===COURSE_PADS[0]?Math.min((ground-68)*5,(80-ground)*5):Infinity;
      depth=Math.max(depth,Math.min(shape,level));
    }
    for(const p of LOOKOFFS)depth=Math.max(depth,Math.min(7-Math.abs(e-p.e),9-Math.abs(n-p.n)));
    depth=Math.max(depth,Math.min(APRON.halfE-Math.abs(e-APRON.e),APRON.halfN-Math.abs(n-APRON.n)));
    return depth> -14?{dist:Math.max(6.5,10-depth),half:10,kind:8,coverage:smooth(-12,14,depth)}:null;
  }
  waterLevel(x:number,z:number):number|null{
    if(!this.contains(x,z))return null;
    return lakeAt(x+this.village[0],this.village[1]-z)?.level??null;
  }
  weights(x:number,z:number,h:number,slope:number,curvature=0):[number,number,number,number]{
    const e=x+this.village[0],n=this.village[1]-z;
    if(e<QUARRY_BOX[0]||e>QUARRY_BOX[2]||n<QUARRY_BOX[1]||n>QUARRY_BOX[3])return [0,0,0,0];
    // Fade the modelling boundary; steep risers retain gypsum while reclaimed slopes keep their grass.
    const boundary=smooth(0,70,Math.min(e-630200,633200-e,n-5062000,5066500-n));
    const face=smooth(.32,.63,slope)*boundary;
    const spoil=(1-smooth(.20,.45,slope))*smooth(65,83,h)*(1-smooth(100,130,h))*.38*boundary;
    let shore=talusPaint(e,n,h)*.92,shoreLevel=0;
    for(const l of LAKES)if(e>l.box[0]-18&&e<l.box[2]+18&&n>l.box[1]-18&&n<l.box[3]+18){
      shoreLevel=l.level;
      shore=Math.max(shore,(1-smooth(4,18,edgeDistance(e,n,l.points)))*(1-smooth(l.level+1,l.level+5,h)));
    }
    const lake=lakeAt(e,n);
    const wet=lake&&h<=lake.level+.6;
    const foot=smooth(.025,.20,curvature)*smooth(.16,.45,slope)*boundary;
    const shelf=smooth(.015,.12,Math.abs(curvature))*(1-smooth(.30,.55,slope))*smooth(.10,.22,slope)*boundary;
    return [Math.max(face,spoil),wet?1:-foot,shoreLevel/100,Math.max(shore,shelf*.65)];
  }
  treeAllowed(x:number,z:number,h:number,slope:number):boolean{
    if(!this.contains(x,z))return true;
    const level=this.waterLevel(x,z);
    if(level!==null&&h<=level+.6)return false;
    return !(slope>Math.tan(40*Math.PI/180)&&this.weights(x,z,h,slope)[0]>.7);
  }
}
