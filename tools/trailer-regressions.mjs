// Focused production-class regressions for review round one. Analytic fixtures isolate contact invariants;
// the main acceptance file still measures every driving target on baked land.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Vehicle } from '../web/src/vehicle.ts';
import { Towing } from '../web/src/towing.ts';
import { createTruck, TRUCK_SPEC } from '../web/src/truck.ts';
import { TRAILER_SPEC as S } from '../web/src/trailer.ts';
import { Roads } from '../web/src/roads.ts';
import { pushOut } from '../web/src/parked.ts';
import { RoadScene } from '../web/src/road-scene.ts';
import { SceneRoad, FISH, touchesPlayer } from '../web/src/road-scene-rules.ts';
export function fixture({slope=0,end=false,spec=TRUCK_SPEC,realRoads=false}={}){
 let context=null;
 const state={lift:0,missing:false},terrain={manifest:{village:[0,0]},withGroundContact(body,read){const old=context;context=body;try{return read();}finally{context=old;}},withContactHeight(body,read){return context?this.withGroundContact(body,read):read();},heightAt(x,z){return state.missing&&z>3?null:(slope?20:0)+x*slope+state.lift;},surfaceAt(x,z){return{ground:(slope?20:0)+x*slope+state.lift,kind:9,halfWidth:20,roadDist:0,canopy:0,level:8,washboard:false};}};
 const road={id:1,pts:[[0,108],[0,106]],kind:1,halfWidth:3.6,bridge:false,name:null};
 const roads=realRoads?new Roads({roads:[]},[0,0],terrain):{roads:[],deckHeight(){return null;},nearest(x,z){return end?{x:0,z:Math.max(106,Math.min(108,z)),heading:0,seg:0,t:Math.max(0,Math.min(1,(108-z)/2)),dist:Math.abs(x),road}:null;}};
 const v=new Vehicle(createTruck(),terrain,roads,-.2,spec);v.assist=0;v.place(0,0,0);
 const make=(world={},attach=true)=>new Towing(v,terrain,roads,true,false,world,attach);
 const step=(tow,throttle=0)=>terrain.withGroundContact(v,()=>v.update(1/120,{throttle,steer:0,handbrake:false},()=>tow.step()));
 const gap=tow=>{tow.update();const p=tow.trailer.root.localToWorld(new THREE.Vector3(0,S.couplerHeight,-S.drawbar));const h=new THREE.Vector3(0,v.spec.hitch.height,v.spec.hitch.back).applyEuler(new THREE.Euler(v.pitch,-v.heading,v.roll,'YXZ')).add(new THREE.Vector3(v.x,v.y,v.z));return p.distanceTo(h);};
 return{v,terrain,roads,state,make,step,gap};
}
export function runTrailerRegressions(){
 const results=[];const test=(name,run)=>{try{const data=run();results.push({name,pass:true,data});console.log('PASS REGRESSION',name,JSON.stringify(data));}catch(error){results.push({name,pass:false,error:error.message});console.log('FAIL REGRESSION',name,error.message);}};
 test('R0_detached_construction_does_not_consume_driving_rng',()=>{const f=fixture(),original=Math.random;let draws=0;try{Math.random=()=>{draws++;return .25;};f.make({},false);assert.equal(draws,0,'inactive construction consumed driving randomness');return{draws};}finally{Math.random=original;}});
 test('R1_refinement_rebases_without_launch',()=>{const f=fixture(),t=f.make();for(let i=0;i<20;i++)f.step(t);const before=t.y;f.state.lift=.1;let maxVy=0,maxLift=0,maxGap=0;for(let i=0;i<180;i++){f.step(t);maxVy=Math.max(maxVy,Math.abs(t.vy));maxLift=Math.max(maxLift,t.y-before);maxGap=Math.max(maxGap,f.gap(t));}const data={maxVy,maxLift,maxGap,truckVy:f.v.vy};assert.ok(maxVy<.001&&maxLift<.101&&maxGap<1e-6,JSON.stringify(data));return data;});
 test('R1_refinement_after_unknown_support_does_not_launch',()=>{const f=fixture(),t=f.make();f.step(t);f.state.missing=true;for(let i=0;i<10;i++)f.step(t);f.state.lift=.1;f.state.missing=false;let maxVy=0;for(let i=0;i<120;i++){f.step(t);maxVy=Math.max(maxVy,Math.abs(t.vy));}assert.ok(maxVy<.001,JSON.stringify({maxVy}));return{maxVy};});
 test('R2_unknown_support_keeps_coupler',()=>{const f=fixture(),t=f.make();f.step(t);f.state.missing=true;let maxGap=0;for(let i=0;i<60;i++){f.v.y+=8/120;f.v.vy=8;t.step();maxGap=Math.max(maxGap,f.gap(t));}assert.ok(maxGap<1e-6,JSON.stringify({maxGap}));return{maxGap};});
 test('R2_taut_drawbar_projects_vertical_velocity',()=>{const f=fixture(),t=f.make();f.step(t);f.v.y=20;f.v.vy=0;let maxVy=0,maxGap=0;for(let i=0;i<300;i++){t.step();maxVy=Math.max(maxVy,Math.abs(t.vy));maxGap=Math.max(maxGap,f.gap(t));}assert.ok(maxVy<.001&&maxGap<1e-6,JSON.stringify({maxVy,maxGap}));return{maxVy,maxGap};});
 test('R4_inclined_tyre_geometry_has_ground_support',()=>{const f=fixture({slope:1}),t=f.make();for(let i=0;i<240;i++)f.step(t);t.update();let min=Infinity;for(const w of t.trailer.wheels){w.updateMatrixWorld(true);w.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);min=Math.min(min,v.y-20-v.x);}});}assert.ok(min>=-.002&&min<.01,JSON.stringify({minGap:min,roll:t.roll,position:[t.x,t.y,t.z],centres:t.trailer.wheels.map(w=>w.getWorldPosition(new THREE.Vector3()).toArray())}));return{minGap:min};});
 test('R6_attach_honours_rejection_and_turns_at_road_end',()=>{const f=fixture({end:true});f.v.bounds=[-100,-100,100,110];f.v.place(0,106,0);const t=f.make();const data={attached:t.attached,z:t.z,heading:f.v.heading};assert.ok(t.attached&&t.z<110&&Math.cos(f.v.heading)<-.99,JSON.stringify(data));t.detach();f.v.bounds=[-4,-4,4,4];f.v.placementGuard=null;f.v.place(0,0,0);const refused=f.make();assert.ok(!refused.attached&&f.v.towLoad===null&&typeof refused.reason==='string'&&refused.reason.length>0,'no feasible pair must remain detached with a HUD reason');return{...data,refused:!refused.attached,reason:refused.reason};});
 test('R6_changed_guard_cannot_leave_partial_attachment',()=>{const f=fixture();let calls=0;const guard=()=>++calls===1;f.v.placementGuard=guard;const t=f.make();assert.ok(!t.attached&&f.v.towLoad===null&&f.v.placementGuard===guard&&!!t.reason,'a second placement refusal restores the original hooks and load');return{attached:t.attached,reason:t.reason};});
 assert.ok(results.every(r=>r.pass),JSON.stringify(results.filter(r=>!r.pass)));return results;
}
