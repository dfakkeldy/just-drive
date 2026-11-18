import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { RoadScene } from '../web/src/road-scene.ts';
import { FISH_COWS, HOOF_SET_IN } from '../web/src/road-scene-rules.ts';
import { roads, village } from './shift-fixture.mjs';
globalThis.addEventListener=()=>{};
assert.equal(FISH_COWS[0].grazing,false,'sea cow stands');assert.ok(FISH_COWS[0].side>0,'cow stands seaward');
const terrain={manifest:{village},heightAt:(x,z)=>60+.2*(x+5288.28)+.05*(z+5965.9)};
const shift={career:{day:8},run:{stops:[]},roadside:[],ended:false,complaints:{add(){}},elapsed:0};
const s=new RoadScene(roads,terrain,shift,new URLSearchParams()),c=new THREE.PerspectiveCamera();c.position.set(s.centre.x,90,s.centre.z);s.update(c);
for(const foot of s.seaFeet)assert.ok(Math.abs(foot.height-HOOF_SET_IN-foot.placedY)<1e-8,'four hoof contact planes fit known sloping ground, set in by HOOF_SET_IN');
// Check rendered hoof soles, independently of the plane's reported support values.
for(const foot of s.seaFeet){let y=0,count=0;const p=s.art.cows.geometry.attributes.position;for(let i=0;i<s.art.cowOffsets[1];i++)if(Math.abs(s.seaBaseY[i]+.007)<1e-5&&Math.hypot(p.getX(i)+s.centre.x-foot.x,p.getZ(i)+s.centre.z-foot.z)<.19){y+=p.getY(i);count++;}assert.ok(count>=6,'rendered hoof sole exists');assert.ok(Math.abs(y/count-(foot.height-HOOF_SET_IN))<1e-4,'actual rendered hoof lies on ground');}
const path=[],p={x:0,z:0,heading:0};for(let u=-150;u<=125;u+=.5){s.road.at(u,2.7,p);path.push({x:p.x,z:p.z});}
let minimum=Infinity;const positions=s.art.cows.geometry.attributes.position;
for(let v=0;v<s.art.cowOffsets[1];v++){
 const x=positions.getX(v)+s.centre.x,z=positions.getZ(v)+s.centre.z;
 for(let i=0;i<path.length-1;i++){
  const a=path[i],b=path[i+1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
  minimum=Math.min(minimum,Math.hypot(x-a.x-t*dx,z-a.z-t*dz)-1.25);
 }
}
assert.ok(minimum>=.8,'whole cow clears swept passage by >= 0.8 m');assert.ok(Math.sin(FISH_COWS[0].turn)>.8,'head points over the water');
const cow=s.pasture[0],eye=s.art.visitor.position,dx=cow.x-eye.x,dz=cow.z-eye.z;
assert.ok((dx*-Math.sin(s.art.visitor.rotation.y)+dz*-Math.cos(s.art.visitor.rotation.y))/Math.hypot(dx,dz)>.999,'visitor lens points at her');
console.log('PASS standing sea cow, four sloped-ground hoof contacts, seaward head, lens and conservative swept clearance',minimum);
