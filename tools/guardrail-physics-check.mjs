// Real 120Hz Vehicle and BikeRide, through their production collision hooks.
import assert from 'node:assert/strict';
import {Object3D,Vector3} from '../web/node_modules/three/build/three.module.js';
import {Vehicle} from '../web/src/vehicle.ts';
import {BikeRide} from '../web/src/bike-ride.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {BIKE_SPEC} from '../web/src/bike.ts';
import {pushOut} from '../web/src/parked.ts';
import {RAIL} from '../web/src/guardrail-rules.ts';
import {Guardrails} from '../web/src/guardrails.ts';
const node=()=>new Object3D(),rig=()=>({root:node(),body:node(),pose(){},steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}});
const road={id:1,name:'graze fixture',kind:2,halfWidth:3,bridge:false,pts:[[0,0],[400,0]]};
const cliff=(x,z)=>100-Math.max(0,z-4)*.8;
const land={dataRevision:1,cartRoads:false,low:false,exag:1,seaLevel:0,surfaceAt:(x,z)=>({ground:cliff(x,z),level:8}),heightAt:cliff};
const rails=new Guardrails({roads:[road],nearest:()=>null},land),cam=new Vector3(100,100,0);
for(let i=0;i<1000;i++){rails.update(cam);if(!rails.audit.pending)break;}
const surface={ground:100,canopy:0,kind:2,washboard:false,roadDist:0,halfWidth:3,level:8};
const terrain={heightAt:()=>100,withContactHeight:(_,read)=>read(),surfaceAt:()=>surface,meshContactAt:(_x,_z,out)=>{out.height=100;out.source=8;out.drawn=true;return true;}};
const roads={roads:[],nearest:()=>null,deckHeight:()=>null,guardrails:rails};
const input={throttle:1,steer:0,handbrake:false};
export function measure(assertions=true){
 const rows=[];
 for(const kind of ['car','bike']) for(const initial of [6,12,25]) for(const deg of [3,6,12,45,90]){
  const spec=kind==='car'?CAR_SPEC:BIKE_SPEC,v=kind==='car'?new Vehicle(rig(),terrain,roads,0,spec):new BikeRide(rig(),terrain,roads,0,spec);
  const h=Math.PI/2+deg*Math.PI/180;
  // Start just short of contact, with the leading circle aimed into the rail. Hit occurs on the first few steps.
  const far=Math.max(...spec.envelope.circles.map(Math.abs));
  v.assist=0;v.place(100,4.2-.15-spec.envelope.radius-far*Math.sin(deg*Math.PI/180)-.03,h);
  v.speed=initial;v.vx=initial*Math.sin(h);v.vz=-initial*Math.cos(h);
  let maxZ=-Infinity,maxYaw=0,oldHeading=v.heading;
  for(let i=0;i<120;i++){v.update(1/120,input);maxZ=Math.max(maxZ,v.z);maxYaw=Math.max(maxYaw,Math.abs(Math.atan2(Math.sin(v.heading-oldHeading),Math.cos(v.heading-oldHeading))));oldHeading=v.heading;}
  const row={kind,initial,deg,maxYaw,tangent:v.vx,speed:Math.hypot(v.vx,v.vz),maxZ};rows.push(row);
  if(assertions){
   // 90% of the incoming tangent allows rolling/drag and a small scrape. Pure projection retains cos(angle).
   if(deg<45&&initial===25)assert.ok(v.vx>initial*Math.cos(deg*Math.PI/180)*.9,`${kind} ${deg}deg retains >90% tangent: ${v.vx}`);
   else if(deg===90)assert.ok(row.speed<2,`${kind} head-on stops despite throttle: ${row.speed}`);
   assert.ok(maxZ<4.2,`${kind} ${deg}deg cannot tunnel through rail`);
  }
 }
 if(assertions){
  for(const deg of [12,45]){
   const carRows=rows.filter(r=>r.kind==='car'&&r.deg===deg);
   for(let i=1;i<carRows.length;i++)assert.ok(carRows[i].speed>=carRows[i-1].speed,`car ${deg}: lower incoming speed cannot retain more speed`);
  }
  assert.ok(rows.every(r=>r.maxYaw<=Math.PI/6/120+1e-10),'contact yaw <=30 degrees/second, including chunk seams');
  // Both physical chunks touch this body. Each chunk would guide it by0.25deg;
  // the final aggregate clamp must keep the whole 120Hz step at0.25deg.
  const seam=new Vehicle(rig(),terrain,roads,0,CAR_SPEC),sh=Math.PI/2+.2;
  seam.place(RAIL.chunk,4.2-.15-CAR_SPEC.envelope.radius+Math.max(...CAR_SPEC.envelope.circles)*Math.sin(.2)+.01,sh);
  seam.vx=25*Math.sin(sh);seam.vz=-25*Math.cos(sh);seam.speed=25;
  assert.ok(rails.chunks.filter(c=>c.solids.length&&Math.abs(c.start-RAIL.chunk)<RAIL.chunk+.01).length>=2,'two live chunks at seam');
  rails.block(seam,1/120);
  const seamYaw=Math.abs(Math.atan2(Math.sin(seam.heading-sh),Math.cos(seam.heading-sh)));
  assert.ok(seamYaw<=Math.PI/6/120+1e-10,`aggregate chunk seam yaw <=0.25deg: ${seamYaw*180/Math.PI}`);
  assert.ok(Math.abs(seam.speed-(seam.vx*Math.sin(seam.heading)-seam.vz*Math.cos(seam.heading)))<1e-12,'speed uses the final seam-clamped heading');
  console.error('PASS real Vehicle seam yaw',JSON.stringify({degrees:seamYaw*180/Math.PI,speed:seam.speed}));
  // Repeated contact at a fixed shallow heading forces friction to act over a full second.
  const body={x:0,z:.85,heading:Math.PI/2+.1,vx:25,vz:.02,speed:25,spec:CAR_SPEC};
  for(let i=0;i<120;i++){body.z=2-.15-CAR_SPEC.envelope.radius+.02;body.heading=Math.PI/2+.1;body.vz=.02;pushOut(body,[{x:0,z:2,heading:Math.PI/2,half:100,halfWidth:.15}],false,1/120);assert.ok(Math.abs(body.heading-Math.PI/2-.1)<=Math.PI/6/120+1e-10,'individual contact response also rate-limits yaw');}
  assert.ok(body.vx>24.4&&body.vx<24.8,`continuous scrape loses about 2% per second: ${body.vx}`);
  // The actual washboard forces and suspension remain active during rail contact.
  surface.kind=3;surface.washboard=true;
  const rough=new Vehicle(rig(),terrain,roads,0,CAR_SPEC),rh=Math.PI/2+Math.PI/15;
  rough.assist=0;rough.place(100,2.8,rh);rough.speed=25;rough.vx=25*Math.sin(rh);rough.vz=-25*Math.cos(rh);
  let shaking=0,contacts=0;
  const roughRoads={...roads,guardrails:{block(v,dt){const shake=v.shake,y=v.y,vy=v.vy,steer=v.steerAngle;rails.block(v,dt);assert.equal(v.shake,shake);assert.equal(v.y,y);assert.equal(v.vy,vy);assert.equal(v.steerAngle,steer);contacts++;}}};
  rough.roads=roughRoads;
  for(let i=0;i<120;i++){rough.update(1/120,input);shaking=Math.max(shaking,rough.shake);}
  assert.ok(shaking>.2&&contacts===120,'rail contact cannot suppress real washboard shake or suspension');
  console.error('PASS real washboard retained',JSON.stringify({maxShake:shaking,railCalls:contacts}));
  // Presence alone must never change road roughness. Use identical random
  // streams and shared steering to keep both cars clear of the rail.
  const rng=()=>{let s=0x6e697473;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/2**32;};};
  const pair=[roads,{...roads,guardrails:null}].map(r=>{const v=new Vehicle(rig(),terrain,r,0,CAR_SPEC);v.assist=0;v.random=rng();v.place(100,0,Math.PI/2);v.speed=25;v.vx=25;v.vz=0;return v;});
  let washYaw=0,washShake=0;
  for(let i=0;i<720;i++){
   const {heading,z,vz}=pair[0];
   const steer=Math.max(-1,Math.min(1,4*(Math.PI/2-heading)-.6*z-.4*vz));
   for(const v of pair)v.update(1/120,{...input,steer});
   const sample=v=>[v.x,v.z,v.vx,v.vz,v.heading,v.shake,v.car.body.rotation.x,v.car.body.rotation.z,v.car.body.position.y];
   assert.deepEqual(sample(pair[0]),sample(pair[1]),`railed/unrailed washboard yaw, sideways force and shake equal at step${i}`);
   washYaw=Math.max(washYaw,Math.abs(pair[0].heading-Math.PI/2));washShake=Math.max(washShake,pair[0].shake);
  }
  assert.ok(washYaw>.001&&washShake>.2,'paired road is measurably rough');
  console.error('PASS720-step washboard equality',JSON.stringify({maxYaw: washYaw,maxShake:washShake}));
  surface.kind=2;surface.washboard=false;
  // A tumble bypasses the normal branch: keep the actual crash branch contained too.
  for(const deg of [30,45]){
   const v=new BikeRide(rig(),terrain,roads,0,BIKE_SPEC),h=Math.PI/2+deg*Math.PI/180;
   const far=Math.max(...BIKE_SPEC.envelope.circles.map(Math.abs));
   v.place(100,4.2-.15-BIKE_SPEC.envelope.radius-far*Math.sin(deg*Math.PI/180)-.03,h);
   v.speed=25;v.vx=25*Math.sin(h);v.vz=-25*Math.cos(h);v.crashTime=.01;
   let maximum=-Infinity;
   for(let i=0;i<120;i++){v.update(1/120,input);maximum=Math.max(maximum,v.z);}
   assert.ok(maximum<4.2,`crashed bike ${deg}deg stays inside rail: ${maximum}`);
   console.error('PASS crash containment',JSON.stringify({deg,initial:25,maxCentreZ:maximum,railZ:4.2}));
  }
 }
 if(assertions){
  // The chunk midpoint lives in the neighbouring cell; only a 3x3 query can find it.
  const neighbour=new Guardrails({roads:[{...road,pts:[[70,0],[170,0]]}],nearest:()=>null},land);for(let i=0;i<30;i++)neighbour.update(cam);
  const v={x:130,z:4,heading:Math.PI/2,vx:0,vz:25,speed:25,spec:CAR_SPEC};neighbour.block(v);assert.equal(v.vz,0,'neighbouring grid cell collision');
 }
 console.log(JSON.stringify(rows));return rows;
}
measure(process.env.RAIL_MEASURE_ONLY!=='1');
