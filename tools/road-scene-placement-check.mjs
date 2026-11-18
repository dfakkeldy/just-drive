import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Vehicle } from '../web/src/vehicle.ts';
import { RoadScene } from '../web/src/road-scene.ts';
import { touchesPlayer, SceneRoad } from '../web/src/road-scene-rules.ts';
import { roads, village } from './shift-fixture.mjs';
globalThis.addEventListener=()=>{};
const terrain={manifest:{village},heightAt:()=>0,withContactHeight:(_v,read)=>read(),surfaceAt:()=>({ground:0,canopy:0,roadDist:0,halfWidth:3,kind:2,level:8,washboard:false})};
const shift={career:{day:8},run:{stops:[]},roadside:[],ended:false,complaints:{add(){}},elapsed:0};
const scene=new RoadScene(roads,terrain,shift,new URLSearchParams()),node=()=>new THREE.Object3D();
const vehicle=new Vehicle({root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}},terrain,roads,-100);
vehicle.placementGuard=p=>scene.allowPlacement(p,vehicle.spec);vehicle.assist=0;
const pose={x:0,z:0,heading:0};let cases=0;
const clear=()=>[scene.visitorCar,scene.truck].every(s=>!touchesPlayer(s,vehicle,.349));
for(const along of [-110,-75,-30,-8.49,4,30,65])for(const carSide of [0,-2.4,-4.8]){
 scene.rules.truckAlong=along;scene.rules.carSide=carSide;scene.place();
 for(const target of [0,along,-3.26])for(const turn of [0,Math.PI/4,Math.PI/2,Math.PI]){
  scene.road.at(target,0,pose);vehicle.restart(pose.x,pose.z,pose.heading+turn);assert.ok(clear(),'place/restart margin');
  const x=vehicle.x,z=vehicle.z;
  for(let i=0;i<12;i++)vehicle.update(1/120,{throttle:0,steer:0,handbrake:true},()=>scene.step(1/120,vehicle,false));
  assert.ok(Math.hypot(vehicle.x-x,vehicle.z-z)<.01,'no post-placement throw');cases++;
 }
}
scene.reset();scene.rules.truckAlong=-8.49;scene.place();scene.road.at(-3.26,2.7,pose);vehicle.restart(pose.x,pose.z,pose.heading);vehicle.respawn();assert.ok(clear(),'no-trail respawn safe');
scene.road.at(0,0,pose);vehicle.trail=[{...pose}];vehicle.respawn();assert.ok(clear(),'saved-trail respawn safe');
// Culled and not-yet-loaded models still reserve their actual current positions.
scene.solids.length=0;scene.road.at(0,0,pose);vehicle.place(pose.x,pose.z,pose.heading);assert.ok(clear(),'cold placement safe');
const landed=scene.road.alongAt(vehicle.x,vehicle.z);assert.ok(landed>0,'nearest exit at the stopped gap is uphill');
scene.road=new SceneRoad([[scene.centre.x,scene.centre.z-200],[scene.centre.x,scene.centre.z+200]],200,1);scene.reset();scene.road.at(0,0,pose);vehicle.place(pose.x,pose.z,pose.heading);assert.ok(scene.road.alongAt(vehicle.x,vehicle.z)>0,'uphill wins an equal-distance tie');
scene.rules.enabled=false;scene.road.at(0,0,pose);vehicle.place(pose.x,pose.z,pose.heading);assert.equal(vehicle.x,pose.x,'no-scene placements unchanged');
console.log('PASS',cases,'moving/stopped/cleared poses and headings, real place/restart/respawn, cold solids, margins and no throw.');
