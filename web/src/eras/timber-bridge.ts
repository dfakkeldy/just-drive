import * as THREE from 'three';
import type { Road } from '../roads';
import type { Terrain } from '../terrain';
import { Mesher, type RGB } from '../yard-kit';

/** Timber art follows the era's shared contact plane at the retained span. */
export function timberBridge(road: Road, terrain: Terrain, cum: number[], len: number, y0: number, y1: number, approach?: (s:number,x:number,z:number)=>number, startExtra=3,endExtra=3,support?: (x:number,z:number)=>number|null): THREE.BufferGeometry {
  const m=new Mesher(),w=road.halfWidth+.9,wood:RGB=[.38,.27,.16],rail:RGB=[.53,.40,.25];
  const at=(s:number)=>{
    let i=0;while(i<cum.length-2&&cum[i+1]<s)i++;
    const a=road.pts[i],b=road.pts[i+1],d=Math.hypot(b[0]-a[0],b[1]-a[1])||1,t=(s-cum[i])/d;
    const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;return {x,z,y:approach?approach(s,x,z):y0+(y1-y0)*s/len,yaw:Math.atan2(b[0]-a[0],b[1]-a[1])};
  };
  const extra=approach?startExtra:0,tail=approach?endExtra:0,plank=len/Math.ceil(len/.55),grade=(y1-y0)/len,pitch=-Math.atan(grade),stretch=Math.hypot(1,grade);
  for(let s=-extra+plank/2;s<len+tail;s+=plank){const p=at(s),a=at(s-plank/2),b=at(s+plank/2),g=(b.y-a.y)/plank;m.at(p.x,p.y,p.z,p.yaw,-Math.atan(g));m.box(0,-.10,0,2*w,.20,plank*Math.hypot(1,g)-.018,[.43+(Math.floor(s/plank)%3)*.025,.32,.20],false);}
  for(let s=0;s<len;s+=3){
    const run=Math.min(3,len-s),p=at(s+run/2);m.at(p.x,p.y,p.z,p.yaw);
    for(const side of [-1,1]){
      m.box(side*(w-.15),.53,0,.18,1.06,.18,rail,false);
      m.at(p.x,p.y,p.z,p.yaw,pitch);
      m.box(side*(w-.15),.92,0,.16,.18,run*stretch+.15,rail,false);
      m.box(side*(w-.15),.43,0,.12,.13,run*stretch+.15,rail,false);
      m.box(side*(w*.65),-.35,0,.32,.5,run*stretch+.15,wood,false);
      m.at(p.x,p.y,p.z,p.yaw);
    }
  }
  for(let s=2;s<len;s+=7){
    const p=at(s),ground=(support?support(p.x,p.z):terrain.meshHeightAt(p.x,p.z,true)??terrain.heightAt(p.x,p.z))??terrain.seaLevel-4;
    const bottom=Math.min(p.y-.8,ground-.4),h=p.y-.25-bottom;
    m.at(p.x,bottom,p.z,p.yaw);
    for(const side of [-1,1])m.box(side*(w-.5),h/2,0,.38,h,.38,wood,false);
    m.box(0,h-.15,0,2*w,.35,.45,wood,false);
    m.box(0,.25,0,2*w,.35,.5,wood,false);
    const angle=Math.atan2(2*(w-.5),Math.max(.5,h-.5));
    for(const side of [-1,1]){m.at(p.x,bottom+h/2,p.z,p.yaw,0,side*angle);m.box(0,0,0,.18,Math.hypot(2*(w-.5),h-.5),.2,rail,false);}
  }
  return m.geometry();
}

/** Exact land inputs used by approach planks and trestle feet, registered once per retained span. */
export function timberGroundPoints(road:Road,cum:number[],len:number,startExtra:number,endExtra:number):{x:number;z:number;land:boolean}[]{
  const result:{x:number;z:number;land:boolean}[]=[],at=(s:number,land:boolean)=>{let i=0;while(i<cum.length-2&&cum[i+1]<s)i++;const a=road.pts[i],b=road.pts[i+1],n=cum[i+1]-cum[i],t=(s-cum[i])/n;result.push({x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,land});};
  const plank=len/Math.ceil(len/.55);
  for(let s=-startExtra+plank/2;s<len+endExtra;s+=plank)for(const d of [-plank/2,0,plank/2])if(s+d<0||s+d>len)at(s+d,true);
  for(let s=2;s<len;s+=7)at(s,false);
  return result;
}

/** Adjoining bridge records are one span. Sample the two OUTER banks, not the channel under an internal join.
 * In this map two track pieces share an endpoint; treating each join as a bank gives incompatible deck heights.
 * The x/z path stays at today's span. The era may grade its abutments to keep exaggerated banks drivable.
 */
interface Plane {y0:number;y1:number;level:number}
export interface Plan {path:[number,number][];chainKey:string;ax:number;az:number;bx:number;bz:number;before:number;own:number;total:number;samples:WeakMap<Terrain,{revision:number;approaches:Terrain['bridgeApproaches'];value:Plane|null}>}
const plans=new WeakMap<readonly Road[],Map<number,Plan>>();
export function prepareTimberPlans(roads:readonly Road[]):void {
  if(plans.has(roads))return;const map=new Map<number,Plan>();plans.set(roads,map);
  for(const road of roads)if(road.bridge)map.set(road.id,makePlan(road,roads));
}
function makePlan(road:Road,roads:readonly Road[]):Plan {
  const p=road.pts.map(v=>[...v] as [number,number]),used=new Set([road.id]);
  let before=0,after=0;
  const length=(pts:readonly [number,number][])=>pts.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-pts[i][0],b[1]-pts[i][1]),0);
  for(const end of ['start','end'] as const)for(let count=0;count<roads.length;count++){
    const at=end==='start'?p[0]:p[p.length-1];
    const next=roads.find(r=>r.bridge&&r.kind===road.kind&&!used.has(r.id)&&
      [r.pts[0],r.pts[r.pts.length-1]].some(q=>Math.hypot(q[0]-at[0],q[1]-at[1])<.25));
    if(!next)break;
    used.add(next.id);
    let pts=next.pts;
    const first=Math.hypot(pts[0][0]-at[0],pts[0][1]-at[1])<.25;
    if((end==='start'&&first)||(end==='end'&&!first))pts=[...pts].reverse();
    const n=length(pts);
    if(end==='start'){p.unshift(...pts.slice(0,-1));before+=n;}else{p.push(...pts.slice(1));after+=n;}
  }
  const bank=(a:[number,number],b:[number,number])=>{const d=Math.hypot(a[0]-b[0],a[1]-b[1])||1;return [a[0]+(a[0]-b[0])*3/d,a[1]+(a[1]-b[1])*3/d] as [number,number];};
  const a=bank(p[0],p[1]),b=bank(p[p.length-1],p[p.length-2]),own=length(road.pts);
  return {path:p,chainKey:[...used].sort((a,b)=>a-b).join(','),ax:a[0],az:a[1],bx:b[0],bz:b[1],before,own,total:before+own+after||1,samples:new WeakMap()};
}
export function timberPlan(road:Road,roads:readonly Road[]):Plan {prepareTimberPlans(roads);return plans.get(roads)!.get(road.id)!;}

/** Connectivity is built once. Only new land data or an installed approach set resamples the banks. */
export function periodBridgePlane(road:Road,roads:readonly Road[],terrain:Terrain):Plane|null {
  prepareTimberPlans(roads);const p=plans.get(roads)!.get(road.id)!;let cache=p.samples.get(terrain);
  const revision=terrain.dataRevision??0,approaches=terrain.bridgeApproaches??null;
  if(cache&&cache.revision===revision&&cache.approaches===approaches)return cache.value;
  if(!cache){cache={revision,approaches,value:null};p.samples.set(terrain,cache);}
  if(cache.approaches!==approaches)cache.value=null;
  cache.revision=revision;cache.approaches=approaches;
  if(approaches){
    // HistoryBridgeApproaches already read level-6 bank ground at boot, so the plane is ready before fine tiles load.
    const plane=approaches.planeFor(road);
    if(!plane){cache.value=null;return null;}
    const la=terrain.levelAt?terrain.levelAt(p.ax,p.az):(terrain.surfaceAt(p.ax,p.az)?.level??-1);
    const lb=terrain.levelAt?terrain.levelAt(p.bx,p.bz):(terrain.surfaceAt(p.bx,p.bz)?.level??-1);
    plane.level=la>=0&&lb>=0?Math.min(la,lb):0;
    cache.value=plane;
    return plane;
  }
  const a=terrain.surfaceAt(p.ax,p.az),b=terrain.surfaceAt(p.bx,p.bz);
  if(!a||!b||a.level<6||b.level<6){cache.value=null;return null;}
  const y0=a.ground+.05,y1=b.ground+.05;
  cache.value??={y0:0,y1:0,level:0};cache.value.y0=y0+(y1-y0)*p.before/p.total;cache.value.y1=y0+(y1-y0)*(p.before+p.own)/p.total;cache.value.level=Math.min(a.level,b.level);
  return cache.value;
}
