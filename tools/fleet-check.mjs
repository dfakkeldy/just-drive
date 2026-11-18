import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Fleet} from '../web/src/fleet.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {createTruck,TRUCK_SPEC} from '../web/src/truck.ts';
import {Towing} from '../web/src/towing.ts';
import {rigCost} from '../web/src/trailer.ts';
import {YardSite} from '../web/src/yard-site.ts';
import {bodyGap} from '../web/src/parked.ts';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {approachControl} from './fleet-approach.mjs';
import {makeGround,preload} from './phone-ground.mjs';
const {terrain,roads}=makeGround(),site=new YardSite(terrain.manifest.village,'invented');terrain.sites.push(site);
const p=site.world(240,90);await preload(terrain,[[p.x,p.z],[0,0]],240);
function create(low=false){const truck=new Vehicle(createTruck(false,low),terrain,roads,-.2,TRUCK_SPEC);truck.assist=0;const tow=new Towing(truck,terrain,roads,true,false,{},true,low);const scene=new THREE.Scene();scene.add(truck.car.root,tow.trailer.root);truck.place(p.x,p.z,site.heading(1,0));let current=truck;const f=new Fleet(truck,tow,terrain,roads,scene,low,m=>current=m.vehicle);f.verifyTransitions=true;return{f,truck,tow,current:()=>current};}
function clean(fixture){for(const m of fixture.f.members){m.light.root.traverse(n=>{if(n.isMesh){n.geometry.dispose()}});m.rig.setTravel=undefined;m.rig.pose=undefined;m.rig.root.traverse(n=>{if(n.isMesh){for(const key of Object.keys(n.geometry.attributes))n.geometry.deleteAttribute(key);n.geometry.setIndex(null);n.geometry.dispose()}})}fixture.f.scene.clear();globalThis.gc?.()}
function allClear(f){
 const bodies=f.members.filter(m=>m.id!=='truck');
 const body=m=>{if(m.state==='STRAPPED'){const p=m.rig.root.getWorldPosition(new THREE.Vector3());return{x:p.x,z:p.z,y:p.y,heading:f.tow.heading,spec:m.entry.spec}}return m.vehicle};
 for(let i=0;i<bodies.length;i++){
  const a=bodies[i],p=body(a);assert.ok(bodyGap(p,f.truck)>=-1e-5,`${a.id}/truck overlap at ${f.stage}`);
  if(a.state==='PARKED'||a.state==='DRIVEN')assert.ok(bodyGap(p,f.trailerPose())>=-1e-5,`${a.id}/trailer overlap at ${f.stage}`);
  if(f.tow.world.scene?.rules.enabled)for(const s of f.tow.world.scene.placementSolids)assert.equal(touchesPlayer(s,p,-1e-6,p.spec),false,`${a.id}/world overlap at ${f.stage}`);
  for(let j=i+1;j<bodies.length;j++)assert.ok(bodyGap(p,body(bodies[j]))>=-1e-5,`${a.id}/${bodies[j].id} overlap at ${f.stage}`);
 }
 assert.equal(f.members.filter(m=>m.state==='DRIVEN').length,1,'exactly one driven member');
}
function step(f,input={throttle:0,steer:0,handbrake:true}){terrain.withGroundContact(f.driven.vehicle,()=>f.drive(1/120,input,()=>f.resolve()));allClear(f);}
function finish(f){for(let i=0;i<3600&&f.busy;i++)step(f);assert.equal(f.busy,false,'sequence completes');allClear(f);}
function use(f,kind,id){f.refresh(1);const index=f.actions.findIndex(a=>a.kind===kind&&a.id===id);assert.ok(index>=0,JSON.stringify({kind,id,actions:f.actions,states:f.members.map(m=>[m.id,m.state]),message:f.message}));f.actionIndex=index;assert.equal(f.activate(),true,`${kind} ${id}: ${f.message}`);}
// Test arrangement only; actions and physical controls below use the guarded production paths.
function fixturePlace(f,v,x,z,heading){(f.nativePlace?.get(v)??v.place.bind(v))(x,z,heading);}
function rideBack(f){const v=f.driven.vehicle,start={x:v.x,z:v.z},state={};for(let i=0;i<120;i++)step(f,{throttle:-1,steer:0,handbrake:false});assert.ok(Math.hypot(v.x-start.x,v.z-start.z)>.2,'real reverse input rides clear');let last;for(let i=0;i<4800;i++){last=approachControl(v,f.tow,THREE,state,f.driven.id==='bike');if(last.arrived){f.refresh(1);return}step(f,last)}assert.fail('Physical return failed '+JSON.stringify({id:f.driven.id,last,pose:[v.x,v.z,v.speed]}))}
const a=create();console.log('SITE',p,a.f.members.map(m=>[m.id,m.state]),a.tow.x,a.tow.z);a.f.refresh(1);console.log('PROMPTS',a.f.actions);
assert.equal(a.truck.towLoad.mass,2415,'real cargo masses');
use(a.f,'unload','bike');finish(a.f);console.log('BIKE OUT',a.f.members.map(m=>[m.id,m.state,m.vehicle.x,m.vehicle.z]));
assert.equal(a.truck.towLoad.mass,2190);use(a.f,'unload','sxs');finish(a.f);assert.equal(a.truck.towLoad.mass,1400);console.log('BOTH OUT',a.f.members.map(m=>[m.id,m.state,m.vehicle.x,m.vehicle.z]));
for(const low of [false,true]){const {f,tow}=create(low);f.draw(new THREE.Vector3(f.truck.x,f.truck.y+5,f.truck.z+18));const cost=rigCost(f.scene);console.log('LOADED COST',low?'LOW':'desktop',cost,rigCost(tow.trailer.root));if(low){assert.ok(cost.triangles<=50000,'LOW loaded triangle cap');assert.ok(cost.drawCalls<=45,'LOW loaded draw cap')}allClear(f);}
for (const id of ['sxs','bike']) {
 use(a.f,'drive',id);finish(a.f);assert.equal(a.current(),a.f.members.find(m=>m.id===id).vehicle);
 rideBack(a.f);
 use(a.f,'load',id);finish(a.f);console.log('LOADED',id,a.f.members.map(m=>[m.id,m.state]),a.f.message);
 assert.equal(a.f.members.find(m=>m.id===id).state,'STRAPPED');
}
console.log('PASS initial fleet cycle');clean(a);
const b=create();use(b.f,'unload','bike');finish(b.f);use(b.f,'unload','sxs');finish(b.f);
for(const id of ['bike','sxs']){use(b.f,'drive',id);finish(b.f);rideBack(b.f);use(b.f,'load',id);finish(b.f);console.log('REVERSE ORDER',id,b.f.message,b.f.members.map(m=>[m.id,m.state]));assert.equal(b.truck.towLoad.mass,id==='bike'?1625:2415,'bike-only and fully loaded masses');assert.equal(b.f.members.find(m=>m.id===id).state,'STRAPPED');}
clean(b);
const {fleetTransformOracle}=await import('./fleet-transform-oracle.mjs');await fleetTransformOracle(terrain,roads,{...p,heading:site.heading(1,0)});
// Sleeping vehicles neither step nor ask for support while the land stays unchanged.
const sleepFixture=create();use(sleepFixture.f,'unload','bike');finish(sleepFixture.f);use(sleepFixture.f,'unload','sxs');finish(sleepFixture.f);use(sleepFixture.f,'drive','bike');finish(sleepFixture.f);
sleepFixture.f.refresh(1);sleepFixture.f.refresh(1);const sleepingCamera=new THREE.Vector3(sleepFixture.truck.x,sleepFixture.truck.y+5,sleepFixture.truck.z+15);sleepFixture.f.draw(sleepingCamera);
const height=terrain.heightAt,surface=terrain.surfaceAt;let queries=0,parkSteps=0;
terrain.heightAt=(...args)=>(queries++,height(...args));terrain.surfaceAt=(...args)=>(queries++,surface(...args));
const parked=sleepFixture.f.members.filter(m=>m.state==='PARKED'),updates=parked.map(m=>m.vehicle.update);
try{for(const m of parked)m.vehicle.update=()=>{parkSteps++};for(let i=0;i<120;i++){sleepFixture.f.refresh(.2);sleepFixture.f.draw(sleepingCamera);}assert.equal(queries,0,'sleeping fleet does no terrain reads');assert.equal(parkSteps,0,'parked controllers never step');
 // Faults exercise both resource assertions, then restore production paths.
 terrain.heightAt(p.x,p.z);assert.throws(()=>assert.equal(queries,0));queries=0;
 parked[0].vehicle.update(1/120,{});assert.throws(()=>assert.equal(parkSteps,0));
}finally{terrain.heightAt=height;terrain.surfaceAt=surface;parked.forEach((m,i)=>m.vehicle.update=updates[i])}
console.log('PASS parked zero-read/zero-step budget and both faults');
// A real truck and its trailer are immovable contacts for the selected rig, including coarse frame deltas.
const hit=sleepFixture.f;use(hit,'drive','truck');finish(hit);use(hit,'drive','sxs');finish(hit);
const driven=hit.driven.vehicle,stationary=hit.members[0].vehicle,oldPose=[stationary.x,stationary.z,stationary.heading];
fixturePlace(hit,driven,stationary.x+14,stationary.z,-Math.PI/2);driven.vx=-18;driven.vz=0;driven.speed=18;hit.cacheSafe();
for(let i=0;i<60;i++){terrain.withGroundContact(driven,()=>hit.drive(.1,{throttle:1,steer:0,handbrake:false},()=>hit.resolve()));assert.ok(bodyGap(driven,stationary)>=-1e-5,'parked truck is solid at 10 Hz');allClear(hit)}
assert.deepEqual([stationary.x,stationary.z,stationary.heading],oldPose,'contact cannot displace the parked truck');
const priorResolve=hit.resolve,priorClear=hit.clear;try{hit.resolve=()=>{};hit.clear=()=>true;fixturePlace(hit,driven,stationary.x+7,stationary.z,-Math.PI/2);driven.vx=-18;driven.vz=0;driven.speed=18;let overlapped=false;for(let i=0;i<70;i++){terrain.withGroundContact(driven,()=>hit.drive(1/120,{throttle:1,steer:0,handbrake:false},()=>hit.resolve()));overlapped ||= bodyGap(driven,stationary)<-.1}assert.ok(overlapped,'fault: disabling contacts lets the driven rig enter the parked truck')}finally{hit.resolve=priorResolve;hit.clear=priorClear}
console.log('PASS immovable envelope contacts and disabled-resolver fault');clean(sleepFixture);
// A load cannot start while skewed, a metre outside the zone, moving, or while the truck moves.
const loadCase=create();use(loadCase.f,'unload','bike');finish(loadCase.f);use(loadCase.f,'drive','bike');finish(loadCase.f);
const zone=new THREE.Vector3(0,0,6.8).applyMatrix4(loadCase.tow.trailer.root.matrixWorld),bike=loadCase.current();
for(const [label,offset,angle,speed] of [['skewed',0,.6,0],['wide',1.2,0,0],['moving',0,0,1]]){
 const rx=Math.cos(loadCase.tow.heading),rz=Math.sin(loadCase.tow.heading);fixturePlace(loadCase.f,bike,zone.x+rx*offset,zone.z+rz*offset,loadCase.tow.heading+angle);bike.speed=speed;bike.vx=Math.sin(bike.heading)*speed;bike.vz=-Math.cos(bike.heading)*speed;loadCase.f.refresh(1);assert.ok(!loadCase.f.actions.some(a=>a.kind==='load'),label+' refuses LOAD');
}
fixturePlace(loadCase.f,bike,zone.x,zone.z,loadCase.tow.heading);loadCase.f.refresh(1);assert.ok(loadCase.f.actions.some(a=>a.kind==='load'),'valid alignment offers LOAD');
// Preflight and a live intrusion must leave the previous valid states intact.
loadCase.f.actionIndex=loadCase.f.actions.findIndex(a=>a.kind==='load');const snapshot=loadCase.f.members.map(m=>({id:m.id,state:m.state,x:m.vehicle.x,z:m.vehicle.z}));
const world=loadCase.tow.world,oldScene=world.scene;const block=new THREE.Vector3(0,0,5.1).applyMatrix4(loadCase.tow.trailer.root.matrixWorld);
world.scene={rules:{enabled:true},placementSolids:[{x:block.x,z:block.z,heading:loadCase.tow.heading,half:.05,halfWidth:2}]};
assert.equal(loadCase.f.activate(),false,'wall refuses before any animation');assert.match(loadCase.f.message,/block/);assert.deepEqual(loadCase.f.members.map(m=>({id:m.id,state:m.state,x:m.vehicle.x,z:m.vehicle.z})),snapshot,'preflight restores model and controller poses');
world.scene=oldScene;loadCase.f.refresh(1);loadCase.f.actionIndex=loadCase.f.actions.findIndex(a=>a.kind==='load');assert.equal(loadCase.f.activate(),true);for(let i=0;i<170;i++)step(loadCase.f);
world.scene={rules:{enabled:true},placementSolids:[{x:block.x,z:block.z,heading:loadCase.tow.heading,half:.05,halfWidth:2}]};
for(let i=0;i<900&&loadCase.f.busy;i++)step(loadCase.f);
assert.match(loadCase.f.message,/returned safely/);assert.deepEqual(loadCase.f.members.map(m=>({id:m.id,state:m.state,x:m.vehicle.x,z:m.vehicle.z})),snapshot,'live intrusion abort restores previous valid state');world.scene=oldScene;
console.log('PASS load eligibility, preflight and live rollback');clean(loadCase);
// R changes only the selected vehicle; start over recovers lost cargo.
const reset=create();use(reset.f,'unload','bike');finish(reset.f);use(reset.f,'drive','bike');finish(reset.f);const truckPose=[reset.truck.x,reset.truck.z,reset.tow.x,reset.tow.z];
reset.f.respawn();assert.deepEqual([reset.truck.x,reset.truck.z,reset.tow.x,reset.tow.z],truckPose);assert.ok(bodyGap(reset.current(),reset.truck)>=0,'R cannot put bike in parked pickup');
reset.current().y=-2;reset.current().atEdge=true;reset.f.restart(p.x,p.z,site.heading(1,0));assert.match(reset.f.message,/Recovered to trailer: Dirt bike/);assert.equal(reset.f.driven.id,'truck');assert.ok(reset.f.members.filter(m=>m.id!=='truck').every(m=>m.state==='STRAPPED'));assert.equal(reset.truck.towLoad.mass,2415);
console.log('PASS driven-only R and start-over recovery');clean(reset);
// Repeat the trip on a baked gravel road, selecting a safe place from the real road samples.
const gravel=roads.roads.find(r=>r.id===55),centre=Math.floor(gravel.pts.length*.5),gravelPoints=gravel.pts.slice(Math.max(0,centre-12),centre+13);
await preload(terrain,gravelPoints,160);const gcase=create();let chosen=null;
for(let i=1;i<gravelPoints.length&&!chosen;i++)for(const reverse of [0,Math.PI]){const [x,z]=gravelPoints[i],a=gravelPoints[i-1],heading=Math.atan2(x-a[0],a[1]-z)+reverse;gcase.f.restart(x,z,heading);gcase.f.refresh(1);const action=gcase.f.actions.find(a=>a.kind==='unload');if(action&&!action.reason){chosen={x,z,heading};break}}
assert.ok(chosen,'safe unloading place exists on the real gravel road');use(gcase.f,'unload','bike');finish(gcase.f);use(gcase.f,'unload','sxs');finish(gcase.f);
for(const id of ['bike','sxs']){use(gcase.f,'drive',id);finish(gcase.f);rideBack(gcase.f);use(gcase.f,'load',id);finish(gcase.f);assert.equal(gcase.f.members.find(m=>m.id===id).state,'STRAPPED')}
console.log('PASS gravel-road trip',JSON.stringify(chosen));clean(gcase);
// Real hill, wall and shoreline refusals; no terrain is flattened for these checks.
const hill=site.world(240,250);await preload(terrain,[[hill.x,hill.z]],180);const refusal=create();let slope=null;
for(let x=hill.x-70;x<=hill.x+70&&!slope;x+=14)for(let z=hill.z-70;z<=hill.z+70&&!slope;z+=14){for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]){refusal.f.restart(x,z,heading);refusal.f.refresh(1);const a=refusal.f.actions.find(a=>a.kind==='unload');if(a?.reason==='Too steep to unload here'){slope={x,z,heading};break}}}
assert.ok(slope,'real hill refuses with Too steep to unload here');console.log('PASS hill refusal',JSON.stringify(slope));
const shore={x:618657.9-terrain.manifest.village[0],z:terrain.manifest.village[1]-5104815.8};await preload(terrain,[[shore.x,shore.z]],260);let water=null;
for(let dx=-100;dx<=100&&!water;dx+=10)for(let dz=-100;dz<=100&&!water;dz+=10)for(const heading of [0,Math.PI/2,Math.PI,Math.PI*1.5]){const x=shore.x+dx,z=shore.z+dz;if(terrain.heightAt(x,z)<.1)continue;refusal.f.restart(x,z,heading);refusal.f.refresh(1);const a=refusal.f.actions.find(a=>a.kind==='unload');if(a?.reason==='Water behind the trailer'){water={x:refusal.truck.x,z:refusal.truck.z,heading:refusal.truck.heading};break}}
assert.ok(water,'real shoreline refuses water behind the trailer');console.log('PASS shoreline refusal',JSON.stringify(water));
console.log('PASS fleet fixed-step suite');

for(const id of ['sxs','bike']){const fxt=create();use(fxt.f,'unload','bike');finish(fxt.f);use(fxt.f,'unload','sxs');finish(fxt.f);use(fxt.f,'drive',id);finish(fxt.f);let arrived=false,last;const approachState={};
 for(let i=0;i<2400;i++){last=approachControl(fxt.current(),fxt.tow,THREE,approachState,fxt.f.driven.id==='bike');step(fxt.f,last);if(last.arrived){arrived=true;break}}
 console.log('APPROACH',id,arrived,last,fxt.f.message);assert.ok(arrived,id+' physically approaches loading zone');clean(fxt);}
// Live production fault probes for each remaining invariant family. Every mutation is restored immediately.
const fault=create();
function rejects(label,assertion,mutate,restore){assertion();try{mutate();assert.throws(assertion,undefined,label+' mutation must fail')}finally{restore()}assertion();console.log('MUTATION rejected',label)}
rejects('mass follows actual cargo',()=>assert.equal(fault.truck.towLoad.mass,2415),()=>{fault.f.members[1].state='PARKED';fault.f.mass()},()=>{fault.f.members[1].state='STRAPPED';fault.f.mass()});
rejects('one driven vehicle',()=>allClear(fault.f),()=>fault.f.members[1].state='DRIVEN',()=>fault.f.members[1].state='STRAPPED');
const cargoRoot=fault.f.members[1].rig.root;rejects('every-step cargo separation',()=>allClear(fault.f),()=>cargoRoot.position.z=3.65,()=>cargoRoot.position.z=0);
const rider=fault.f.members[1].rig.root.getObjectByName('Removable driver');rejects('strapped driver hidden',()=>assert.equal(rider.visible,false),()=>rider.visible=true,()=>rider.visible=false);
const wheel=fault.f.members[1].rig.wheels.fl;rejects('strapped tyres do not spin',()=>assert.equal(Math.abs(wheel.rotation.x),0),()=>wheel.rotation.x=.25,()=>wheel.rotation.x=0);
const low=create(true);low.f.draw(new THREE.Vector3(low.truck.x,low.truck.y+5,low.truck.z+18));const cost=rigCost(low.f.scene),desktop=rigCost(fault.tow.trailer.root),extra=low.f.members[1].light.root.clone(true);
rejects('LOW triangle budget',()=>assert.ok(rigCost(low.f.scene).triangles<50000),()=>{for(let i=0;i<20;i++)low.tow.trailer.root.add(extra.clone(true))},()=>{for(const n of [...low.tow.trailer.root.children])if(n.name===extra.name)n.removeFromParent()});clean(low);
const originalAdvance=fault.f.advanceStep;try{fault.f.advanceStep=function(){if(this.plan){this.plan=null;this.take(this.members[0])}};use(fault.f,'unload','bike');finish(fault.f);assert.throws(()=>assert.equal(fault.f.members[2].state,'PARKED'))}finally{fault.f.advanceStep=originalAdvance}
use(fault.f,'unload','bike');finish(fault.f);console.log('MUTATION rejected script that skips the cargo path');
const select=fault.f.select;fault.f.select=()=>{};try{use(fault.f,'drive','bike');finish(fault.f);assert.throws(()=>assert.ok(fault.current()===fault.f.driven.vehicle))}finally{fault.f.select=select;fault.f.select(fault.f.driven)}console.log('MUTATION rejected stale driven binding');
const strap=fault.f.strapRaw;try{fault.f.strapRaw=()=>{};assert.throws(()=>{fault.f.restart(p.x,p.z,site.heading(1,0));assert.ok(fault.f.members.filter(m=>m.id!=='truck').every(m=>m.state==='STRAPPED'))})}finally{fault.f.strapRaw=strap;fault.f.restart(p.x,p.z,site.heading(1,0))}console.log('MUTATION rejected start-over that forgets cargo');
refusal.f.restart(slope.x,slope.z,slope.heading);refusal.f.refresh(1);const siteCheck=refusal.f.site;rejects('real slope refusal',()=>assert.equal(refusal.f.actions[0].reason,'Too steep to unload here'),()=>{refusal.f.site=()=>'';refusal.f.refresh(1)},()=>{refusal.f.site=siteCheck;refusal.f.rampDirty=true;refusal.f.refresh(1)});
refusal.f.restart(water.x,water.z,water.heading);refusal.f.refresh(1);const sea=refusal.f.seaLevel;rejects('real water refusal',()=>assert.equal(refusal.f.actions[0].reason,'Water behind the trailer'),()=>{refusal.f.seaLevel=-100;refusal.f.rampDirty=true;refusal.f.refresh(1)},()=>{refusal.f.seaLevel=sea;refusal.f.rampDirty=true;refusal.f.refresh(1)});
console.log('PASS fleet mutations restored',JSON.stringify({desktop,low:cost}));
// The same digital steering/throttle asks used by the real-browser key driver.
for(const id of ['sxs','bike']){const x=create(),f=x.f;use(f,'unload','bike');finish(f);use(f,'unload','sxs');finish(f);use(f,'drive',id);finish(f);for(let i=0;i<120;i++)step(f,{throttle:-1,steer:0,handbrake:false});for(let i=0;i<180;i++)step(f,{throttle:0,steer:0,handbrake:true});let throttleDuty=0,steerDuty=0,arrived=false,last;const state={};
 for(let i=0;i<3600;i++){const v=f.driven.vehicle,a=last=approachControl(v,f.tow,THREE,state,f.driven.id==='bike');if(a.arrived){arrived=true;break}throttleDuty+=Math.abs(a.throttle);const throttle=throttleDuty>=1?Math.sign(a.throttle):0;if(throttle)throttleDuty--;let steer;if(f.driven.id==='bike'){steerDuty+=Math.abs(a.steer);steer=steerDuty>=1?Math.sign(a.steer):0;if(steer)steerDuty--}else{const target=a.steer*v.spec.maxSteer;steer=target>.02&&v.steerAngle<target?1:target<-.02&&v.steerAngle>target?-1:0}terrain.withGroundContact(v,()=>f.drive(1/60,{throttle,steer,handbrake:a.handbrake},()=>{f.resolve();allClear(f)}));f.refresh(1/60)}
 assert.ok(arrived,id+' digital return '+JSON.stringify(last));use(f,'load',id);finish(f);console.log('PASS digital full trip',id);clean(x);}
const sleepGround=create();use(sleepGround.f,'unload','bike');finish(sleepGround.f);use(sleepGround.f,'unload','sxs');finish(sleepGround.f);use(sleepGround.f,'drive','bike');finish(sleepGround.f);const sleeping=sleepGround.f.members.find(m=>m.id==='sxs'),before={x:sleeping.vehicle.x,z:sleeping.vehicle.z,y:sleeping.vehicle.y,heading:sleeping.vehicle.heading},ground=sleepGround.f.ground;
try{sleepGround.f.ground=(x,z)=>{const y=ground(x,z);return y===null?null:y+.2};terrain.fleetGroundChanged(before.x-3,before.z-3,6);sleepGround.f.refresh(1);assert.ok(Math.abs(sleeping.vehicle.y-before.y-.2)<.001,'changed support wakes parked rig');assert.deepEqual([sleeping.vehicle.x,sleeping.vehicle.z,sleeping.vehicle.heading],[before.x,before.z,before.heading],'settling preserves parked plan position');
}finally{sleepGround.f.ground=ground;terrain.fleetGroundChanged(before.x-3,before.z-3,6);sleepGround.f.refresh(1)}clean(sleepGround);console.log('PASS parked support-change wake/settle');
const groundAbort=create();use(groundAbort.f,'unload','bike');for(let i=0;i<150;i++)step(groundAbort.f);const groundCopies=[...terrain.tiles.values()].filter(t=>t.ground).map(t=>[t.ground,t.ground.slice()]),meshCopies=[];
terrain.group.traverse(n=>{if(n.isMesh)meshCopies.push([n.geometry.attributes.position,n.geometry.attributes.position.array.slice()])});
try{for(const[a]of groundCopies)for(let i=0;i<a.length;i++)a[i]+=.2;for(const[a]of meshCopies){for(let i=0;i<a.count;i++)a.setY(i,a.getY(i)+.2);a.needsUpdate=true}terrain.fleetGroundChanged(groundAbort.tow.x-15,groundAbort.tow.z-15,30);groundAbort.f.refresh(0);assert.equal(groundAbort.f.busy,false,'refined land aborts script before another draw');assert.match(groundAbort.f.message,/Ground changed/);assert.equal(groundAbort.f.members[2].state,'STRAPPED');
}finally{for(const[a,copy]of groundCopies)a.set(copy);for(const[a,copy]of meshCopies){a.array.set(copy);a.needsUpdate=true}terrain.fleetGroundChanged(groundAbort.tow.x-15,groundAbort.tow.z-15,30);groundAbort.f.refresh(1)}clean(groundAbort);console.log('PASS ground-change rollback');
const locked=create();use(locked.f,'unload','bike');const held=[locked.truck.x,locked.truck.z,locked.truck.heading];for(let i=0;i<20;i++){terrain.withGroundContact(locked.truck,()=>locked.f.drive(.1,{throttle:1,steer:1,handbrake:false},()=>locked.f.resolve()));assert.deepEqual([locked.truck.x,locked.truck.z,locked.truck.heading],held,'truck input ignored with vehicle on ramp');allClear(locked.f)}finish(locked.f);let foldTime=0;while(locked.f.gates>0&&foldTime<2){terrain.withGroundContact(locked.truck,()=>locked.f.drive(.1,{throttle:1,steer:0,handbrake:false},()=>locked.f.resolve()));foldTime+=.1;assert.deepEqual([locked.truck.x,locked.truck.z,locked.truck.heading],held,'gates clear before driving away')}assert.ok(foldTime>=.9&&locked.f.gates===0,'automatic fold completes before truck moves');clean(locked);console.log('PASS coarse-frame script lock and gate folding');

const emptyTruck=new Vehicle(createTruck(),terrain,roads,-.2,TRUCK_SPEC),emptyTow=new Towing(emptyTruck,terrain,roads,false),emptyScene=new THREE.Scene();emptyScene.add(emptyTruck.car.root,emptyTow.trailer.root);emptyTruck.place(p.x,p.z,site.heading(1,0));const emptyFleet=new Fleet(emptyTruck,emptyTow,terrain,roads,emptyScene,false,()=>{});emptyFleet.refresh(1);assert.equal(emptyFleet.members.length,1,'empty trailer creates no cargo controllers');assert.equal(emptyTow.trailer.cargo,null);assert.equal(emptyTruck.towLoad.mass,1400);assert.equal(emptyFleet.actions.length,0);clean({f:emptyFleet});console.log('PASS empty explore trailer');
