import type {Roads} from '../roads';
import {farmBarn,type PeriodSite} from './history-sites';
import {signSize} from './history-art';
import {footprintRoadClear,footprintsOverlap,type Footprint} from './history-footprints';
import {qMetres,qAngle,metricDistance} from './history-precision';
export interface BoardPlan {id:string;x:number;z:number;yaw:number;width:number;height:number;roadX:number;roadZ:number}
/** Panel depth is .08 m; .18 m encloses both posts too. A 1 m horizontal margin reserves the assembly. */
export const boardFootprint=(b:BoardPlan):Footprint=>({id:'board-'+b.id,x:b.x,z:b.z,yaw:b.yaw,width:b.width,length:.18});
export function planHistoryBoards(sites:readonly PeriodSite[],roads:Roads,cover:(x:number,z:number)=>number):BoardPlan[]{
 const plans:BoardPlan[]=[];
 for(const s of sites){
  if(!s.word)continue;const size=signSize(s.word),road=roads.nearest(s.x,s.z,250,r=>r.kind>=1&&r.kind<=4&&!r.bridge),candidates:BoardPlan[]=[];
  if(road){
   const dx=s.x-road.x,dz=s.z-road.z,d=Math.hypot(dx,dz)||1,nx=dx/d,nz=dz/d,fx=Math.sin(road.heading),fz=-Math.cos(road.heading);
   for(const along of [0,-12,12,-24,24,-48,48,-80,80])for(const back of [0,1,2,3,4,5,6,7,8,12,16,24]){
    const anchor=roads.nearest(qMetres(road.x+fx*along),qMetres(road.z+fz*along),80,r=>r.kind>=1&&r.kind<=4&&!r.bridge)??road;
    const offset=anchor.road.halfWidth+size.width/2+1.2+back,x=qMetres(anchor.x+nx*offset),z=qMetres(anchor.z+nz*offset);
    let roadX=qMetres(anchor.x-Math.sin(anchor.heading)*35),roadZ=qMetres(anchor.z+Math.cos(anchor.heading)*35);
    const approach=roads.nearest(roadX,roadZ,80,r=>r.kind>=1&&r.kind<=4&&!r.bridge);if(approach){roadX=qMetres(approach.x);roadZ=qMetres(approach.z);}
    candidates.push({id:s.id,x,z,yaw:qAngle(Math.atan2(roadX-x,roadZ-z)),...size,roadX,roadZ});
   }
  }else for(const extra of [2,4,8,12,20]){const x=qMetres(s.x+Math.sin(s.yaw)*(s.length/2+extra)),z=qMetres(s.z+Math.cos(s.yaw)*(s.length/2+extra));candidates.push({id:s.id,x,z,yaw:s.yaw,...size,roadX:x+Math.sin(s.yaw)*35,roadZ:z+Math.cos(s.yaw)*35});}
  const chosen=candidates.find(b=>{
   const f=boardFootprint(b),c=Math.cos(b.yaw),a=Math.sin(b.yaw);
   if(!footprintRoadClear(f,roads.roads,1)||sites.some(s=>footprintsOverlap(f,s,1)||(s.barn&&footprintsOverlap(f,farmBarn(s)!,1)))||plans.some(p=>footprintsOverlap(f,boardFootprint(p),1)))return false;
   for(const u of [-b.width/2,0,b.width/2])for(const v of [-.09,.09]){const cls=cover(qMetres(b.x+u*c+v*a),qMetres(b.z-u*a+v*c));if(cls===0||cls===4)return false;}
   return metricDistance(b.x-b.roadX,b.z-b.roadZ)<80;
  });
  if(!chosen)throw Error('No clear board assembly for '+s.id);plans.push(chosen);
 }
 return plans;
}
