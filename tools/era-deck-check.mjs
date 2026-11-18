import{readFileSync}from'node:fs';
import {horseDeckCases} from './horse-deck-cases.mjs';
import {assertLooseBridge} from './era-observations.mjs';
import{Terrain}from'../web/src/terrain.ts';
import{historyGround}from'../web/src/eras/history-ground.ts';import{HistoryBridgeApproaches}from'../web/src/eras/history-approaches.ts';
import assert from 'node:assert/strict';import*as THREE from'../web/node_modules/three/build/three.module.js';
import{makeGround,preload,bakedRoads,manifest}from'./phone-ground.mjs';import{Roads}from'../web/src/roads.ts';import{Vehicle}from'../web/src/vehicle.ts';import{CAR_SPEC}from'../web/src/vehicle-spec.ts';import{TRUCK_SPEC}from'../web/src/truck.ts';import{SXS_SPEC}from'../web/src/sxs.ts';import{BikeRide}from'../web/src/bike-ride.ts';import{BIKE_SPEC}from'../web/src/bike.ts';
const node=()=>new THREE.Group(),rig=()=>({root:node(),body:node(),driverEye:node(),brakeLights:[],steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}});
assert.throws(()=>assertLooseBridge('grass'),/loose surface/);
// ERA_AREA=judique sweeps that area's decks with the same cases; Mabou is the default.
const deckBase=process.env.ERA_AREA&&process.env.ERA_AREA!=='mabou'?'../data/baked/areas/'+process.env.ERA_AREA:null;
const deckManifest=deckBase?JSON.parse(readFileSync(deckBase+'/manifest.json','utf8')):manifest,deckRoads=deckBase?JSON.parse(readFileSync(deckBase+'/roads.json','utf8')):bakedRoads;
let resets=0,crossings=0,maxResetUp=0,maxGap=0,maxBridgeCandidates=0,edgeRespawns=0,placements=0;
for(const hill of [1,1.5,2.5]){
 process.env.PHONE_EXAG=String(hill);const{terrain}=deckBase?makeGround(deckBase):makeGround();terrain.cartRoads=true;terrain.surfaceAt=Terrain.prototype.surfaceAt.bind(terrain);const roads=new Roads(deckRoads,deckManifest.village,terrain);const ground=await historyGround(deckManifest,deckBase??'../data/baked/terrain',roads.roads.filter(r=>r.bridge).flatMap(r=>r.pts.map(([x,z])=>[x+deckManifest.village[0],deckManifest.village[1]-z])));new HistoryBridgeApproaches(roads,terrain,ground).install(terrain);
 const car=new Vehicle(rig(),terrain,roads,-.2,CAR_SPEC);car.assist=0;
 const extra=[new Vehicle(rig(),terrain,roads,-.2,TRUCK_SPEC),new Vehicle(rig(),terrain,roads,-.2,SXS_SPEC),new BikeRide({root:node(),driverEye:node(),pose(){}},terrain,roads,-.2,BIKE_SPEC)];
 for(const road of roads.roads.filter(r=>r.bridge&&(!process.env.ERA_DECK_ID||r.id===Number(process.env.ERA_DECK_ID)))){
  const pts=road.pts,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));const len=cum.at(-1);
  const path=[...pts],used=new Set([road.id]);let before=0;
  for(const edge of ['start','end']){let distance=0;for(let k=0;k<12&&distance<16;k++){
    const endpoint=edge==='start'?path[0]:path.at(-1),next=roads.roads.filter(r=>!used.has(r.id)&&r.kind<=4&&[r.pts[0],r.pts.at(-1)].some(p=>Math.hypot(p[0]-endpoint[0],p[1]-endpoint[1])<.3)).sort((a,b)=>(a.name===road.name?-1:1)-(b.name===road.name?-1:1))[0];if(!next)break;used.add(next.id);
    let points=next.pts;const first=Math.hypot(points[0][0]-endpoint[0],points[0][1]-endpoint[1])<.3;
    if(edge==='start'&&first||edge==='end'&&!first)points=[...points].reverse();
    const take=[];if(edge==='start'){for(let i=points.length-2;i>=0&&distance<16;i--){distance+=Math.hypot(points[i+1][0]-points[i][0],points[i+1][1]-points[i][1]);take.unshift(points[i]);}path.unshift(...take);}
    else{for(let i=1;i<points.length&&distance<16;i++){distance+=Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]);take.push(points[i]);}path.push(...take);}
   }if(edge==='start')before=distance;
  }
  const pathCum=[0];for(let i=1;i<path.length;i++)pathCum.push(pathCum[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
  const at=(s,side=0)=>{let i=0;s+=before;while(i<path.length-2&&pathCum[i+1]<s)i++;const a=path[i],b=path[i+1],d=pathCum[i+1]-pathCum[i],t=(s-pathCum[i])/d,h=Math.atan2(b[0]-a[0],a[1]-b[1]);return{x:a[0]+(b[0]-a[0])*t+Math.cos(h)*side,z:a[1]+(b[1]-a[1])*t+Math.sin(h)*side,h};};
  const start=at(-12),end=at(len+12);await preload(terrain,[...path,[start.x,start.z],[end.x,end.z]],120);roads.update(new THREE.Vector3(pts[0][0],20,pts[0][1]));
  for(const v of [car,...([28,34].includes(road.id)?extra:[])])for(const s of [-3,0,.5,len-.5,len,len+3])for(const side of [0,road.halfWidth+.8]){
   const p=at(s,side);v.restart(p.x,p.z,p.h);terrain.withGroundContact(v,()=>v.update(1/120,{throttle:0,steer:0,handbrake:true}));resets++;maxResetUp=Math.max(maxResetUp,v.vy);
   assert(v.vy<.65,`reset ${road.id} hill ${hill} ${v.spec.wheelbase} s${s} side${side}: vy ${v.vy}`);
  }
  // Public place() is also the ?road= entry path. Respawn uses a real trail point
  // beside the abutment, including the map-edge inward-heading path. No height override.
  for(const s of [-3,len+3]){
   const p=at(s);car.place(p.x,p.z,p.h);terrain.withGroundContact(car,()=>car.update(1/120,{throttle:0,steer:0,handbrake:true}));assert(Math.abs(car.vy)<.65);placements++;
   car.bounds=[p.x-40,p.z-40,p.x+700,p.z+700];car.trail=[{x:p.x,z:p.z,heading:p.h}];car.x=p.x-45;car.z=p.z-45;car.respawn();terrain.withGroundContact(car,()=>car.update(1/120,{throttle:0,steer:0,handbrake:true}));assert(Math.abs(car.vy)<.65);edgeRespawns++;car.bounds=null;
  }
  // A normal 29 km/h approach uses production placement and untouched contact/body heights. Reset-at-rest cases above are separate.
  for(const direction of [1,-1]){
   const p=at(direction===1?-(before?8:3):len+8);car.restart(p.x,p.z,p.h+(direction<0?Math.PI:0));car.vx=Math.sin(car.heading)*8;car.vz=-Math.cos(car.heading)*8;car.speed=8;let progress=direction===1?-(before?8:3):len+8,completed=false,gap=0;
   for(let step=0;step<120*(len+50);step++){
    let best=Infinity;
    for(let i=1;i<path.length;i++){
     const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],d=pathCum[i]-pathCum[i-1],t=Math.max(i===1?-12/d:0,Math.min(i===path.length-1?1+12/d:1,((car.x-a[0])*dx+(car.z-a[1])*dz)/(d*d))),x=a[0]+t*dx,z=a[1]+t*dz,dist=Math.hypot(x-car.x,z-car.z);
     if(dist<best){best=dist;progress=pathCum[i-1]+t*d-before;}
    }
    const goal=at(progress+direction*5),heading=Math.atan2(goal.x-car.x,car.z-goal.z),err=Math.atan2(Math.sin(heading-car.heading),Math.cos(heading-car.heading));
    terrain.withGroundContact(car,()=>car.update(1/120,{throttle:Math.abs(car.speed)<8?1:Math.abs(car.speed)>9?-.15:0,steer:Math.max(-1,Math.min(1,err*2)),handbrake:false}));
    if(process.env.ERA_DECK_TRACE&&direction===-1&&step%20===0)console.log('STEP',JSON.stringify({step,progress,x:car.x,z:car.z,y:car.y,vy:car.vy,land:terrain.heightAt(car.x,car.z),deck:roads.deckHeight(car.x,car.z),speed:car.speed}));const deck=roads.deckHeight(car.x,car.z);if(deck!==null&&progress>2&&progress<len-2){if(process.env.ERA_DECK_TRACE&&car.y-deck>gap+.01)console.log('TRACE',JSON.stringify({direction,step,progress,x:car.x,z:car.z,y:car.y,deck,land:terrain.heightAt(car.x,car.z),vy:car.vy,air:car.airborne}));gap=Math.max(gap,car.y-deck);assertLooseBridge(car.surfaceName);}
    if(direction===1&&progress>=len+3||direction===-1&&progress<=-3){completed=true;break;}
   }
   maxGap=Math.max(maxGap,gap);assert(completed,`approach crossing ${road.id} hill ${hill} direction ${direction}: ${JSON.stringify({progress,x:car.x,z:car.z,speed:car.speed,heading:car.heading,surface:car.surfaceName,ground:terrain.heightAt(car.x,car.z)})}`);assert(gap<1.2,`approach flight ${road.id} hill ${hill}: ${gap}`);crossings++;
  }
  await horseDeckCases({terrain,roads,road,hill,at,path,pathCum,before,len});
  maxBridgeCandidates=Math.max(maxBridgeCandidates,roads.audit?.heightCandidatesMax??0);
  for(const t of terrain.tiles.values()){if(t.mesh){terrain.group.remove(t.mesh);t.mesh.geometry.dispose();t.mesh.material.dispose();}if(t.mask){t.mask.geometry=null;t.mask.material.dispose();}}
  terrain.tiles.clear();terrain.dataRevision++;terrain.contactRevision++;
  console.log('PASS actual bridge',road.id,'hill',hill);
 }
}
console.log('PASS ERA_DECKS',JSON.stringify({area:process.env.ERA_AREA??'mabou',resets,crossings,maxResetUp,maxGap,maxBridgeCandidates,edgeRespawns,placements}));
