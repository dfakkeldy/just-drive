// Candidate search only: production ground, Vehicle and Towing, at rest on each run-up.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {makeGround,preload} from './phone-ground.mjs';
import {YardSite} from '../web/src/yard-site.ts';
import {createTestPark,testParkStarts} from '../web/src/stunt-test-park.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {TRUCK_SPEC,createTruck} from '../web/src/truck.ts';
import {Towing} from '../web/src/towing.ts';
import {AreaContacts} from '../web/src/world-contacts.ts';
const rows=[],acceptance=process.env.STUNT_START_ACCEPTANCE==='1',grid=process.env.STUNT_START_GRID==='1';
const settled=r=>assert.ok(r.maxLastHalf<15&&Math.abs(r.truckPitch)<15&&Math.abs(r.truckRoll)<15&&Math.abs(r.trailerRoll)<15&&Math.abs(r.speed)<.15&&r.shift<.25,JSON.stringify(r));
for(const hill of (process.env.STUNT_START_HILLS??'1,1.5,2,2.5').split(',').map(Number))for(const low of [false,true]){
 process.env.PHONE_EXAG=String(hill);const {terrain,roads}=makeGround();terrain.low=low;
 const yard=new YardSite(terrain.manifest.village,'invented');terrain.sites.push(yard);
 const park=await createTestPark(terrain,yard,low,[]);
 const arches=park.dressing.filter(d=>d.placement.piece.id==='start-arch');
 await preload(terrain,arches.flatMap(d=>[-60,0,30].map(u=>Object.values(d.world(u,0)))),65);
 for(const tile of terrain.tiles.values())if(tile.mesh){tile.mesh.visible=true;tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);}
 const v=new Vehicle(createTruck(false,low),terrain,roads,-.2,TRUCK_SPEC);v.assist=0;
 const registry=new AreaContacts();registry.add(park.contactProvider());
 const t=new Towing(v,terrain,roads,true,false,{contacts:registry},false,low);
 for(const [index,d]of arches.entries())for(const lead of acceptance?[testParkStarts(park)[index].lead,5]:grid?[40,42,44,46]:[5,10,15,20,25,30,35,40,45,50,55,60])for(const lateral of acceptance?[lead===testParkStarts(park)[index].lead?testParkStarts(park)[index].lateral:0]:grid?[-2,-1,0,1,2]:[0]){
  if(grid&&index===0)continue;
  t.detach();v.pitch=v.roll=0;const a=d.world(-lead,lateral);const heading=acceptance&&lead===testParkStarts(park)[index].lead?testParkStarts(park)[index].heading:d.placement.heading;v.place(a.x,a.z,heading);park.update(0,v,new THREE.Vector3(a.x,v.y+10,a.z));t.attach();
  if(!t.attached){assert.ok(!acceptance||lead!==testParkStarts(park)[index].lead,'real kit start must attach');rows.push({hill,low,index,lead,refused:t.reason});continue;}
  const initial=t.pitch;let maxLastHalf=0;
  for(let tick=0;tick<120;tick++){terrain.withGroundContact(v,()=>v.update(1/120,{throttle:0,steer:0,handbrake:true},()=>{registry.resolve(v);t.step();}));t.update();if(tick>=60)maxLastHalf=Math.max(maxLastHalf,Math.abs(t.pitch));}
  const r={hill,low,index,lead,lateral,initialPitch:initial*180/Math.PI,pitch:t.pitch*180/Math.PI,maxLastHalf:maxLastHalf*180/Math.PI,truckPitch:v.pitch*180/Math.PI,truckRoll:v.roll*180/Math.PI,trailerRoll:t.roll*180/Math.PI,speed:v.speed,shift:Math.hypot(v.x-a.x,v.z-a.z)};rows.push(r);console.log('CANDIDATE',JSON.stringify(r));
  if(acceptance&&lead===testParkStarts(park)[index].lead)settled(r);
  if(acceptance&&hill===2.5&&lead===5)assert.throws(()=>settled(r),undefined,'old five-metre start must fail the settling contract');
 }
 terrain.tiles.clear();terrain.group.clear();
}
if(acceptance)assert.equal(rows.filter(r=>r.lead!==5).length,16,'every real kit start was measured');
writeFileSync(process.env.STUNT_START_REPORT??'../data/work/stunt-start-survey.json',JSON.stringify({candidateOnly:!acceptance,rows},null,2)+'\n');
