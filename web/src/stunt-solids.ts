import type {Pushable,Solid} from './parked';
import type {VehicleSpec} from './vehicle-spec';
export interface LocalSolid {u:number;v:number;half:number;halfWidth:number;bottom:number;top:number;yaw?:number;underDeck?:boolean;groundRadius?:number}
export interface HeightSolid extends Solid {bottom:number;top:number;underDeck:boolean;ax:number;az:number}
export interface StuntBody extends Pushable {y:number;pitch:number;roll:number;spec:VehicleSpec}
export function placeStuntSolid(s:LocalSolid,p:{x:number;z:number;heading:number},base=0):HeightSolid {
 const sin=Math.sin(p.heading),cos=Math.cos(p.heading),heading=p.heading+(s.yaw??0);
 return{x:p.x+s.u*sin+s.v*cos,z:p.z-s.u*cos+s.v*sin,half:s.half,halfWidth:s.halfWidth,heading,bottom:base+s.bottom,top:base+s.top,underDeck:s.underDeck===true,ax:Math.sin(heading),az:-Math.cos(heading)};
}
/** Pieces and rigid dressing use the same body-height gate and spec envelope. */
export function resolveHeightSolid(ride:StuntBody,s:HeightSolid):boolean {
 const dx=s.x-ride.x,dz=s.z-ride.z,along=Math.max(-ride.spec.halfLength,Math.min(ride.spec.halfLength,dx*Math.sin(ride.heading)-dz*Math.cos(ride.heading))),across=Math.max(-ride.spec.halfWidth,Math.min(ride.spec.halfWidth,dx*Math.cos(ride.heading)+dz*Math.sin(ride.heading)));
 const plane=ride.y+Math.tan(ride.pitch)*along+Math.tan(ride.roll)*across;
 if(ride.spec.track===0){const sp=Math.sin(ride.pitch),cp=Math.cos(ride.pitch),sr=Math.sin(ride.roll),cr=Math.cos(ride.roll),reach=Math.abs(sp)*ride.spec.halfLength+Math.abs(cp*sr)*ride.spec.halfWidth,up=cp*cr*ride.spec.height;if(ride.y-reach+Math.min(0,up)>s.top||ride.y+reach+Math.max(0,up)<s.bottom)return false;}
 else if(plane>=s.top-.005||plane+ride.spec.height<s.bottom)return false;
 const x=ride.x,z=ride.z;resolveHorizontal(ride,s);return x!==ride.x||z!==ride.z;
}
/** The yard's circle/box resolution, with lateral circles and a rotation-safe broad phase. */
function resolveHorizontal(ride:StuntBody,s:HeightSolid):void {
  const env=ride.spec.envelope as VehicleSpec['envelope']&{circleSides?:readonly number[]},reach=Math.hypot(s.half,s.halfWidth)+env.reach;
  if(Math.abs(s.x-ride.x)>reach||Math.abs(s.z-ride.z)>reach)return;
  const fx=Math.sin(ride.heading),fz=-Math.cos(ride.heading),rx=-fz,rz=fx;let hardest=0;
  for(let i=0;i<env.circles.length;i++){
    const off=env.circles[i],side=env.circleSides?.[i]??0,cx=ride.x+fx*off+rx*side-s.x,cz=ride.z+fz*off+rz*side-s.z,a=cx*s.ax+cz*s.az,b=cx*-s.az+cz*s.ax;
    const qa=Math.max(-s.half,Math.min(s.half,a)),qb=Math.max(-s.halfWidth,Math.min(s.halfWidth,b));let na=a-qa,nb=b-qb,gap=Math.hypot(na,nb);
    if(gap>=env.radius)continue;
    if(gap<1e-4){const da=s.half-Math.abs(a),db=s.halfWidth-Math.abs(b);if(da<db){na=Math.sign(a)||1;nb=0;gap=-da;}else{na=0;nb=Math.sign(b)||1;gap=-db;}}
    else{na/=gap;nb/=gap;}
    const nx=na*s.ax+nb*-s.az,nz=na*s.az+nb*s.ax,push=env.radius-gap;ride.x+=nx*push;ride.z+=nz*push;
    const into=ride.vx*nx+ride.vz*nz;if(into<0){hardest=Math.max(hardest,-into);ride.vx-=nx*into;ride.vz-=nz*into;ride.vx*=.97;ride.vz*=.97;}
  }
  if(hardest>0){ride.speed=ride.vx*fx+ride.vz*fz;ride.onSolidImpact?.(hardest);}
}

/** One terrain site for any number of reusable placed pieces. No geometry or query work outside its bounds. */