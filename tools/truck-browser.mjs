#!/usr/bin/env node
// RUN=truck-browser.mjs VIEWS='truck|vehicle=truck' tools/yard-shots.sh 1600 1000
// Production game, drawn land/rays at four Hill heights, ramp flight/landing, solids, R, camera and actual GO input.
import assert from 'node:assert/strict';
import { tyreContacts, realCrossSlope } from './tyre-contacts.mjs';
import { writeFileSync } from 'node:fs';
import { open,sleep } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const cameraQuery='cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1';
const p=await open(`${origin}/?vehicle=truck&${cameraQuery}&exag=1&hud=0&scene=0`),reports=[];
const failures=[];
const check=(ok,label,detail)=>{if(!ok)failures.push({label,detail});console.log(ok?'PASS':'FAIL',label,...(ok?[]:[JSON.stringify(detail)]));};
async function setup(){await p.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {SLIP_RAMP:r}=await import('/src/yard-site.ts');
 const stock=(await import('/src/truck.ts')).createTruck();
 const {vehicle:v,yard,terrain,camera,renderer,trees,water}=mmm,site=yard.site,scene=yard.group.parent;
 window.nativeRAF=requestAnimationFrame;window.requestAnimationFrame=()=>0;
 window.tt={THREE,v,yard,site,terrain,camera,scene,r,renderer};
 tt.step=(throttle=0,steer=0,handbrake=false)=>{mmm.driveVehicle(1/120,{throttle,steer,handbrake});yard.update(1/120,v,camera.position);};
 tt.place=(u,w,du=-1,dv=0)=>{const p=site.world(u,w);v.place(p.x,p.z,site.heading(du,dv));v.assist=0;v.steerAngle=0;v.damageActive=false;};
 tt.view=async(p,target)=>{
   camera.position.copy(p);camera.lookAt(target);camera.updateMatrixWorld();
   // A camera jump must settle land, vegetation and the water mirror before a picture is captured.
   for(let i=0;i<100;i++){terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard.update(0,v,camera.position);water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));}
 };
 // Tyre against what is DRAWN under it: the lowest point of the tyre's own geometry, and the highest visible
 // triangle of the land or of the yard (the ramp deck is a yard mesh) within reach below it. Nothing here asks the
 // height functions that the physics used, so a ramp that is drawn elsewhere, or a tyre moved in its hub, shows.
 // Exact vertices (setFromObject precise): the loose box of a wheel that has turned is too big.
 tt.shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
 tt.probeTyres=${tyreContacts.toString()};
 tt.crossSlope=${realCrossSlope.toString()};
 // Parent decision: preserve the untowed pickup's stock drawing, including its legacy off-road contact error.
 tt.stockWheels=()=>{const c=v.car;stock.root.position.copy(c.root.position);stock.root.rotation.copy(c.root.rotation);stock.steer.fl.rotation.y=c.steer.fl.rotation.y;stock.steer.fr.rotation.y=c.steer.fr.rotation.y;
 const a=[c.wheels.fl,c.wheels.fr,c.wheels.rl,c.wheels.rr,...c.extraWheels],b=[stock.wheels.fl,stock.wheels.fr,stock.wheels.rl,stock.wheels.rr,...stock.extraWheels];
 for(let i=0;i<a.length;i++)b[i].rotation.x=a[i].rotation.x;stock.root.updateMatrixWorld(true);c.root.updateMatrixWorld(true);let largest=0;
 for(let i=0;i<a.length;i++)for(let j=0;j<16;j++)largest=Math.max(largest,Math.abs(a[i].matrixWorld.elements[j]-b[i].matrixWorld.elements[j]));return largest;};
 tt.contacts=()=>tt.probeTyres(THREE,[...Object.entries(v.car.wheels).map(([name,wheel])=>({name,wheel,radius:v.spec.wheelRadius})),...(v.car.extraWheels??[]).map((wheel,i)=>({name:'dual'+i,wheel,radius:v.spec.wheelRadius}))],[terrain.group,yard.group]);
 tt.stopOnRamp=()=>{yard.jumpLoad=[];tt.place(r.u+14,r.v);let along=-99,steps=0;
   for(;steps<120*20&&along<7.5;steps++){tt.step(v.speed<3?1:0);along=r.u-site.local(v.x,v.z).u;}
   for(let i=0;i<120*4&&Math.abs(v.speed)>.02;i++)tt.step(v.speed>0?-1:0,0,true);
   for(let i=0;i<60;i++)tt.step(0,0,true);
   return {along:r.u-site.local(v.x,v.z).u,speed:v.speed,lift:v.y-(site.rampBase??0),contacts:tt.contacts()};};
 tt.park=()=>{for(let i=0;i<240;i++)tt.step();return tt.contacts();};
 tt.ramp=()=>{yard.jumpLoad=[];tt.place(r.u+22,r.v);let maxVy=0,maxRoll=0,deck=0,air=0,landed=false,seenAir=false,maxRampLift=0,launchAlong=null,launchVy=0;
   for(let i=0;i<120*11;i++){tt.step(i<120*6?1:0);const local=site.local(v.x,v.z),along=r.u-local.u;maxVy=Math.max(maxVy,Math.abs(v.vy));maxRoll=Math.max(maxRoll,Math.abs(v.roll));if(site.deckHeight(v.x,v.z)!==null&&v.y>(site.rampBase??0)+.4)deck++;if(along>0&&along<r.lead+r.length)maxRampLift=Math.max(maxRampLift,v.y-(site.rampBase??0));if(v.airborne){air++;if(along>12&&along<r.lead+r.length+v.spec.halfLength+8)launchVy=Math.max(launchVy,v.vy);if(along>12&&!seenAir){launchAlong=along;seenAir=true;}}else if(seenAir&&along>r.lead+r.length+v.spec.halfLength)landed=true;}
   return {maxVy,maxRoll,deck,air,landed,maxRampLift,launchAlong,launchVy,local:site.local(v.x,v.z),speed:v.speed,y:v.y};
 };
 tt.block=()=>{tt.place(0,-28,0,1);let impact=0;const hit=v.onSolidImpact.bind(v);v.onSolidImpact=s=>{impact=Math.max(impact,s);hit(s);};for(let i=0;i<120*6;i++)tt.step(1);return {impact,local:site.local(v.x,v.z),speed:v.speed};};
})()`);await sleep(100);}
try{
 for(const exag of (process.env.TRUCK_HILL_HEIGHTS??'1,1.5,2,2.5').split(',').map(Number)){
  if(exag!==1)await p.navigate(`${origin}/?vehicle=truck&${cameraQuery}&exag=${exag}&hud=0&scene=0`);
  await setup();
  const ready=await p.read(`({spec:mmm.vehicle.spec.wheelbase,extras:mmm.vehicle.car.extraWheels?.length,built:!!mmm.yard.triangles})`);
  check(ready.spec===4.45&&ready.extras===2&&ready.built,'truck loads with garage parameter',ready);
  const missingDuals=await p.read('(()=>{const c=mmm.vehicle.car,w=c.extraWheels;c.extraWheels=[];const n=c.extraWheels.length;c.extraWheels=w;return n;})()');check(missingDuals!==2,'mutation rejected: dual tyres absent',missingDuals);
  const road=await p.read(`(async()=>{const {site,v,terrain,THREE}=tt,p=site.world(41,-100),hit=v.roads.nearest(p.x,p.z,200,r=>r.kind===1);if(!hit)throw Error('paved road missing');const eye=new THREE.Vector3(hit.x+8,(terrain.heightAt(hit.x,hit.z)??0)+6,hit.z+9);await tt.view(eye,new THREE.Vector3(hit.x,(terrain.heightAt(hit.x,hit.z)??0)+1,hit.z));v.place(hit.x,hit.z,hit.heading);return tt.park();})()`);
  check(road.every(c=>c.ray&&c.penetration<.04&&c.float<.04),`Hill ${exag}: all six tyres on drawn road`,road);
  const cross=await p.read('tt.crossSlope(tt)');cross.stockWheelMatrixDelta=await p.read('tt.stockWheels()');check(cross.contacts.every(c=>c.ray)&&Math.abs(cross.roll)>.12&&cross.stockWheelMatrixDelta===0,`Hill ${exag}: exact stock wheels on cross slope (raw contacts reported)`,cross);
  const ramp=await p.read(`(async()=>{const {r,site,v,THREE}=tt,p=site.world(r.u-8,r.v);await tt.view(new THREE.Vector3(p.x+9,v.y+7,p.z+9),new THREE.Vector3(p.x,v.y+1,p.z));return tt.stopOnRamp();})()`);
  check(ramp.along>5&&ramp.along<13&&Math.abs(ramp.speed)<.05&&ramp.lift>.5&&ramp.contacts.every(c=>c.inYard&&Math.abs(c.gap)<.04),`Hill ${exag}: drives up, stops, and all six tyres stand on the drawn ramp deck`,ramp);
  // A deliberately displaced root must be rejected by exactly the same drawn-contact predicate.
  const mutant=await p.read(`(()=>{const c=tt.v.car.root;c.position.y+=.5;const gaps=tt.contacts();c.position.y-=.5;c.updateMatrixWorld(true);return gaps;})()`);
  check(!mutant.every(c=>c.inYard&&Math.abs(c.gap)<.04),'mutation rejected: floating tyres',mutant);
  const noRamp=await p.read(`(()=>{const g=tt.yard.group;g.visible=false;const gaps=tt.contacts();g.visible=true;return gaps;})()`);
  check(!noRamp.every(c=>c.inYard&&Math.abs(c.gap)<.04),'mutation rejected: the ramp is not drawn under the tyres',noRamp);
  const sunkTyre=await p.read(`(()=>{const w=tt.v.car.wheels.rl;w.position.y-=.12;const gaps=tt.contacts();w.position.y+=.12;w.updateMatrixWorld(true);return gaps;})()`);
  check(!sunkTyre.every(c=>c.inYard&&Math.abs(c.gap)<.04),'mutation rejected: a tyre moved inside its hub',sunkTyre);
  const underside=await p.read(`(()=>{const {v,terrain,r,site}=tt;tt.place(r.u-8,r.v);const decks=v.groundContacts.map(p=>site.deckHeight(p.x,p.z));if(decks.some(y=>y===null))throw Error('underside witness needs a real deck at every wheel');v.y=Math.min(...decks)-.30;v.pitch=v.roll=0;terrain.withGroundContact(v,()=>v.captureGround());return v.groundContacts.map(p=>({height:p.height,land:terrain.landHeightAt(p.x,p.z)}));})()`);
  check(underside.every(p=>p.height===p.land),`Hill ${exag}: deck above body by 25 cm is ignored`,underside);
  // Contacts now pass their own height explicitly; removing an ambient scope cannot bypass that gate.
  const unsafe=await p.read(`(()=>{const {v,terrain}=tt;const guard=terrain.heightAt;terrain.heightAt=(x,z)=>guard.call(terrain,x,z,v.y+10);try{terrain.withGroundContact(v,()=>v.captureGround());return v.groundContacts.map(p=>({height:p.height,land:terrain.landHeightAt(p.x,p.z)}));}finally{terrain.heightAt=guard;}})()`);
  check(!unsafe.every(p=>p.height===p.land),'mutation rejected: incorrect underside reference height',unsafe);
  const drive=await p.read('tt.ramp()');check(drive.deck>0&&drive.maxRampLift>1.5&&drive.launchAlong>12&&drive.air>0&&drive.landed&&drive.maxRampLift<2.15&&drive.launchVy<6&&drive.maxRoll<.35,`Hill ${exag}: climbs, leaves and lands after slip ramp`,drive);
  const bad=await p.read(`(()=>{const spec=tt.v.spec;tt.v.spec={...spec,contactPlane:0};try{return tt.ramp();}finally{tt.v.spec=spec;}})()`);
  check(!(bad.deck>0&&bad.maxRampLift>1.5&&bad.launchAlong>12&&bad.air>0&&bad.landed&&bad.maxRampLift<2.15&&bad.launchVy<6&&bad.maxRoll<.35),'mutation rejected: old centre-height deck contacts',bad);
  reports.push({exag,road,cross,ramp,drive});
  if(exag===1.5){
   await p.read(`(async()=>{const {site,r,v,THREE}=tt;tt.stopOnRamp();const eye=site.world(r.u-2,r.v-11);await tt.view(new THREE.Vector3(eye.x,v.y+3.6,eye.z),new THREE.Vector3(v.x,v.y+.9,v.z));})()`);await p.shot(`${out}/truck-yard-ramp.png`);
  }
 }
 const collision=await p.read('tt.block()');check(collision.impact>1&&collision.local.v<-.5&&Math.abs(collision.speed)<2,'yard solid stops the truck',collision);
 const missed=await p.read(`(()=>{const old=tt.yard.resolveSolids;tt.yard.resolveSolids=()=>{};try{return tt.block();}finally{tt.yard.resolveSolids=old;}})()`);check(!(missed.impact>1&&missed.local.v<-.5&&Math.abs(missed.speed)<2),'mutation rejected: yard collision disabled',missed);
 // R is a real keyboard event through main.ts, including the placement guard.
 const before=await p.read('({x:tt.v.x,z:tt.v.z})');
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r',windowsVirtualKeyCode:82});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r',windowsVirtualKeyCode:82});
 const reset=await p.read('({x:tt.v.x,z:tt.v.z,speed:tt.v.speed,vx:tt.v.vx,vz:tt.v.vz})');check(Math.hypot(reset.x-before.x,reset.z-before.z)>3&&reset.vx===0&&reset.vz===0,'R resets the truck',reset);
 // Bypass only the method for one key event, then restore it; this proves the reset assertion observes input.
 await p.read('tt.originalRespawn=tt.v.respawn;tt.v.respawn=()=>{};');
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r',windowsVirtualKeyCode:82});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r',windowsVirtualKeyCode:82});
 const noReset=await p.read('({x:tt.v.x,z:tt.v.z})');await p.read('tt.v.respawn=tt.originalRespawn;');check(Math.hypot(noReset.x-reset.x,noReset.z-reset.z)===0,'mutation rejected: R method disabled',noReset);
 // Use the live game loop for the real chase camera and phone pedal events.
 await p.navigate(`${origin}/?vehicle=truck&road=Highway%2019&f=.77&exag=1.5&hud=1&scene=0`);
 const camera=await p.read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');const {vehicle:v,camera}=mmm;v.car.root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(v.car.root),points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera).toArray());return points;})()`);
 check(camera.every(p=>Math.abs(p[0])<.98&&Math.abs(p[1])<.98&&p[2]>-1&&p[2]<1),'chase camera sees the whole truck',camera);
 const clipped=await p.read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js'),{vehicle:v,camera}=mmm,old=camera.fov;try{camera.fov=5;camera.updateProjectionMatrix();const box=new THREE.Box3().setFromObject(v.car.root),points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera).toArray());return points;}finally{camera.fov=old;camera.updateProjectionMatrix();}})()`);check(!clipped.every(p=>Math.abs(p[0])<.98&&Math.abs(p[1])<.98&&p[2]>-1&&p[2]<1),'mutation rejected: camera clips truck',clipped);
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});for(let i=0;i<40;i++){await sleep(500);if(await p.read('mmm.vehicle.speed>5'))break;}await p.shot(`${out}/truck-highway19.png`);await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 await p.navigate(`${origin}/?vehicle=truck&road=Highway%2019&f=.77&exag=1.5&view=seat&hud=0&scene=0`);await p.shot(`${out}/truck-seat.png`);
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await p.navigate(`${origin}/?vehicle=truck&road=Highway%2019&f=.77&exag=1.5&touch=1&hud=1&scene=0`);
 const phoneBefore=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');
 const pedal=await p.read(`(()=>{const b=document.getElementById('tcGo').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,visible:b.width>0&&b.height>0};})()`);check(pedal.visible,'phone GO pedal is visible',pedal);
 const hiddenPedal=await p.read(`(()=>{const b=document.getElementById('tcGo'),old=b.style.display;b.style.display='none';const r=b.getBoundingClientRect();b.style.display=old;return r.width>0&&r.height>0;})()`);check(!hiddenPedal,'mutation rejected: phone pedal hidden',hiddenPedal);
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pedal.x,y:pedal.y,id:1}]});for(let i=0;i<40;i++){await sleep(500);if(await p.read(`Math.hypot(mmm.vehicle.x-(${phoneBefore.x}),mmm.vehicle.z-(${phoneBefore.z}))>4&&mmm.vehicle.speed>2`))break;}
 const phone=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed})');await p.shot(`${out}/truck-phone.png`);await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});check(Math.hypot(phone.x-phoneBefore.x,phone.z-phoneBefore.z)>2&&phone.speed>1,'actual touch GO drives truck',phone);
 const stalledStart=await p.read('ttPhoneUpdate=mmm.vehicle.update;mmm.vehicle.update=()=>{};({x:mmm.vehicle.x,z:mmm.vehicle.z})');
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pedal.x,y:pedal.y,id:2}]});await sleep(1000);
 const stalled=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed})');await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.read('mmm.vehicle.update=ttPhoneUpdate;');check(!(Math.hypot(stalled.x-stalledStart.x,stalled.z-stalledStart.z)>2&&stalled.speed>1),'mutation rejected: phone cannot drive',stalled);
 writeFileSync(`${out}/truck-browser.json`,JSON.stringify({reports,collision,reset,camera,phone,failures},null,2)+'\n');
 assert.deepEqual(failures,[],'truck browser acceptance');
 console.log('PASS truck browser and contact/ramp/collision/reset mutations.');
}finally{await p.close();}
