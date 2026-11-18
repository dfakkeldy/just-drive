// Adapter checks without a browser: laziness, partial ground, collider visibility and unknown tiles.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { RoadScene } from '../web/src/road-scene.ts';
import { FISH_COWS, HOOF_SET_IN, touchesPlayer } from '../web/src/road-scene-rules.ts';
import { Route } from '../web/src/route.ts';
import { Props } from '../web/src/props.ts';
import { roads, village, propsData, terrain as routeTerrain } from './shift-fixture.mjs';
globalThis.addEventListener=()=>{};
const terrain={manifest:{village},heightAt:()=>0};
const shift={career:{day:8},run:{stops:[{hit:{road:{name:'Mabou Mines Road'}}}]},roadside:[],ended:false,complaints:{add(){}},elapsed:0};
const s=new RoadScene(roads,terrain,shift,new URLSearchParams());
assert.equal(s.group.children.length,0,'models are lazy');
const c=new THREE.PerspectiveCamera();c.position.set(s.centre.x,20,s.centre.z);
const v={x:s.centre.x+20,z:s.centre.z,heading:0,vx:0,vz:0,speed:0};
const p={x:0,z:0,heading:0};s.road.at(2,0,p);
terrain.heightAt=(x,z)=>Math.hypot(x-p.x,z-p.z)<.001?null:0;
s.step(1/120,v);s.update(c);assert.equal(s.solids.length,2);assert.equal(s.group.visible,true,'a missing pitch sample cannot hide solid vehicles');
terrain.heightAt=()=>null;s.step(1/120,v);s.update(c);assert.equal(s.group.visible,false);assert.equal(s.solids.length,0,'unknown ground has no colliders');
terrain.heightAt=()=>0;s.step(1/120,v);s.update(c);assert.equal(s.solids.length,2);assert.equal(s.group.visible,true);
v.x+=1000;s.step(1/120,v);c.position.x+=1000;s.update(c);assert.equal(s.group.visible,false);assert.equal(s.solids.length,0,'no distant solids');
console.log('PASS lazy art, partially loaded pitch, collider visibility, unknown ground and distant culling.');

// Both modal types use this adapter pause. Nothing may move, consume a honk or continue a horn.
v.x=s.centre.x+20;c.position.x=s.centre.x;s.step(1/120,v);s.update(c);
let silenced=0;s.hornGain={disconnect(){silenced++;}};
s.setPaused(true);const before=JSON.stringify(s.rules),beforeArt=s.art.car.position.toArray();
s.step(2,v);s.honk(v);s.update(c);
assert.equal(JSON.stringify(s.rules),before,'modal freezes story and horn count');assert.deepEqual(s.art.car.position.toArray(),beforeArt,'modal freezes art');assert.equal(silenced,1,'modal silences active horn');assert.equal(s.hornGain,null);
s.setPaused(false);s.step(1/120,v);assert.notEqual(JSON.stringify(s.rules),before,'closing modal resumes');
// Every stop in the Mines run has a clear approach while the pair is stopped. Combined with the
// real driven detour in both directions, the scene removes no route connection or stop access.
const route=new Route(roads,new Props(propsData,village,routeTerrain)),run=route.forDay(8);
for(let i=0;i<70*120;i++)s.step(1/120,v);
assert.equal(s.rules.waiting,true);assert.equal(run.stops.length,51);
for(const stop of run.stops)for(const solid of s.solids)assert.equal(touchesPlayer(solid,stop.hit),false,'route approach '+stop.index);
assert.equal(s.pasture.length,3);assert.equal(FISH_COWS.filter(c=>c.kind==='highland').length,1);
for(let i=0;i<s.pasture.length;i++){const p=s.pasture[i],hit=roads.nearest(p.x,p.z,40);assert.ok(hit.dist>hit.road.halfWidth+2.5,'cattle stay off the road');}
const sea=s.pasture[0],eye=s.art.visitor.position,dx=sea.x-eye.x,dz=sea.z-eye.z,d=Math.hypot(dx,dz);assert.ok((dx*-Math.sin(s.art.visitor.rotation.y)+dz*-Math.cos(s.art.visitor.rotation.y))/d>.99,'lens follows the sea cow');
assert.equal(FISH_COWS[0].grazing,false);assert.ok(FISH_COWS[0].side>0,'one cream cow seaward');
assert.deepEqual(FISH_COWS.slice(1),[{along:-4,side:-21,turn:1.5,kind:'highland',grazing:false},{along:2,side:-18,turn:-1,kind:'cow',grazing:true}],'other cattle unchanged');
for(const foot of s.seaFeet)assert.ok(Math.abs(foot.placedY-(foot.height-HOOF_SET_IN))<.001,'flat-ground hoof contact, set in by HOOF_SET_IN');
console.log('PASS modal pause/silence/resume, all 51 Mines run approaches and three cattle off the road.');

let resetDisconnects=0;s.hornGain={disconnect(){resetDisconnects++;}};s.reset();assert.equal(resetDisconnects,1,'reset cuts active horn');assert.equal(s.hornGain,null,'reset clears gain');
