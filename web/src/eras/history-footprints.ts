import {qMetres,qUnit} from './history-precision';
/** Cold-path rectangle tests shared by board planning and the offline site tool. */
export interface Footprint {x:number;z:number;yaw:number;width:number;length:number;id?:string}
export function footprintsOverlap(a:Footprint,b:Footprint,margin=1):boolean {
 const ac=qUnit(Math.cos(a.yaw)),as=qUnit(Math.sin(a.yaw)),bc=qUnit(Math.cos(b.yaw)),bs=qUnit(Math.sin(b.yaw));
 for(const [x,z]of [[ac,-as],[as,ac],[bc,-bs],[bs,bc]]){
  const ar=Math.abs(x*ac-z*as)*(a.width/2+margin/2)+Math.abs(x*as+z*ac)*(a.length/2+margin/2);
  const br=Math.abs(x*bc-z*bs)*(b.width/2+margin/2)+Math.abs(x*bs+z*bc)*(b.length/2+margin/2);
  if(qMetres(Math.abs((a.x-b.x)*x+(a.z-b.z)*z))>qMetres(ar+br))return false;
 }return true;
}
export function footprintRoadClear(s:Footprint,roads:readonly {kind:number;halfWidth:number;pts:readonly (readonly number[])[]}[],margin=1):boolean {
 const c=qUnit(Math.cos(s.yaw)),a=qUnit(Math.sin(s.yaw)),w=s.width/2,l=s.length/2;
 const pointDistance=(x:number,z:number,ax:number,az:number,bx:number,bz:number)=>{const dx=bx-ax,dz=bz-az,n=dx*dx+dz*dz,t=n?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/n)):0;return (x-ax-dx*t)**2+(z-az-dz*t)**2;};
 for(const road of roads)if(road.kind>=1&&road.kind<=4)for(let i=1;i<road.pts.length;i++){
  const p=road.pts[i-1],q=road.pts[i],ax=(p[0]-s.x)*c-(p[1]-s.z)*a,az=(p[0]-s.x)*a+(p[1]-s.z)*c,bx=(q[0]-s.x)*c-(q[1]-s.z)*a,bz=(q[0]-s.x)*a+(q[1]-s.z)*c;
  let lo=0,hi=1;const clip=(v:number,d:number,h:number)=>{if(Math.abs(d)<1e-12)return Math.abs(v)<=h;let t0=(-h-v)/d,t1=(h-v)/d;if(t0>t1)[t0,t1]=[t1,t0];lo=Math.max(lo,t0);hi=Math.min(hi,t1);return lo<=hi;};
  if(clip(ax,bx-ax,w)&&clip(az,bz-az,l))return false;
  let distance=Math.min((Math.max(Math.abs(ax)-w,0))**2+(Math.max(Math.abs(az)-l,0))**2,(Math.max(Math.abs(bx)-w,0))**2+(Math.max(Math.abs(bz)-l,0))**2);
  for(const x of [-w,w])for(const z of [-l,l])distance=Math.min(distance,pointDistance(x,z,ax,az,bx,bz));
  if(qMetres(Math.sqrt(distance))<=qMetres(road.halfWidth+margin))return false;
 }return true;
}
