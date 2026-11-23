#!/usr/bin/env node
// RUN=sxs-browser.mjs VIEWS='sxs|vehicle=sxs' tools/yard-shots.sh 1600 1000
// Production game, drawn land/rays at four Hill heights, ramp flight/landing, solids, R, camera and actual GO input.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {tyreContacts,contactIsSeated} from './sxs-contact.mjs';
import { open,sleep } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin;
const cameraQuery='cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1';
const p=await open(`${origin}/?vehicle=sxs&${cameraQuery}&exag=1&hud=0&scene=0`),reports=[];
const failures=[];
const check=(ok,label,detail)=>{if(!ok)failures.push({label,detail});console.log(ok?'PASS':'FAIL',label,...(ok?[]:[JSON.stringify(detail,(key,value)=>key==='samples'?undefined:value)]));};
async function setup(){await p.read(`window.tyreContacts=${tyreContacts.toString()}`);await p.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js');
 const {SLIP_RAMP:r}=await import('/src/yard-site.ts');
 const {vehicle:v,yard,terrain,camera,renderer,trees,water}=mmm,site=yard.site,scene=yard.group.parent;
 window.nativeRAF=requestAnimationFrame;window.requestAnimationFrame=()=>0;
 window.tt={THREE,v,yard,site,terrain,camera,scene,r,renderer,originalLoad:yard.jumpLoad};
 tt.step=(throttle=0,steer=0,handbrake=false)=>{mmm.driveVehicle(1/120,{throttle,steer,handbrake});yard.update(1/120,v,camera.position);};
 tt.place=(u,w,du=-1,dv=0)=>{const p=site.world(u,w);v.place(p.x,p.z,site.heading(du,dv));v.assist=0;v.steerAngle=0;v.damageActive=false;};
 tt.view=async(p,target)=>{
   camera.position.copy(p);camera.lookAt(target);camera.updateMatrixWorld();
   // A camera jump must settle land, vegetation and the water mirror before a picture is captured.
   // At least 100 updates, then until the land is quiet: since #72 one update builds only a time budget of tiles,
   // so a fixed count measured coarse land on a loaded machine. One pending=0 reading is not enough: between levels the
   // next children are asked for only on the next update, and a failed tile waits for its retry without being pending.
   // So wait for 3 quiet updates in a row (the game's own pattern) with no failed tile. One evaluate has a 180 s CDP limit
   // and may call this twice, so each call also stops after 80 s: a stuck queue ends with this message, not a CDP timeout.
   const until=performance.now()+80000;
   let i=0,quiet=0;for(;i<1000&&performance.now()<until&&(i<100||quiet<3);i++){terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard.update(0,v,camera.position);water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);quiet=terrain.pending===0&&terrain.failed===0?quiet+1:0;await new Promise(r=>setTimeout(r,20));}
   // Success needs both the minimum count and a quiet run. Hitting the time budget or the cap is a test setup timeout:
   // slow but healthy land can reach it, so the message says which limit stopped the wait, not that the game is wrong.
   if(i<100||quiet<3)throw Error('test setup timeout: land not settled ('+(i>=1000?'update cap 1000':'80 s budget')+') after '+i+' updates, '+Math.round(performance.now()-until+80000)+' ms (pending '+terrain.pending+', failed '+terrain.failed+')');
 };
 // Each sampled tread vertex is paired with a vertical ray at its own horizontal position.
 tt.contacts=()=>tyreContacts(THREE,v.car,[terrain.group,yard.group]);
 // Drive up from the run-up and stop on the deck. (A teleport onto the ramp is not a way the game places anything:
 // it leaves a long body with its front axle under the deck, which an earlier version of this check then excused.)
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
 tt.loadedRamp=()=>{
   yard.jumpLoad=tt.originalLoad;tt.place(r.u+47,r.v);let launch=null,landing=null,maxYaw=0,impact=0;
   const hit=v.onSolidImpact;v.onSolidImpact=s=>{impact=Math.max(impact,s);hit.call(v,s);};
   try{for(let i=0;i<120*9;i++){tt.step(1);const a=r.u-site.local(v.x,v.z).u;maxYaw=Math.max(maxYaw,Math.abs(Math.atan2(Math.sin(v.heading-site.heading(-1,0)),Math.cos(v.heading-site.heading(-1,0)))));if(v.airborne&&a>r.lead+r.length-2&&!launch)launch={a,speed:v.speed};if(launch&&!v.airborne&&a>r.lead+r.length+v.spec.halfLength){landing={a,speed:v.speed};break;}}}finally{v.onSolidImpact=hit;}
   return{launch,landing,distance:launch&&landing?landing.a-launch.a:0,maxYaw,impact};
 };
 tt.slope=async(cross)=>{
   // Selected from the baked Mines hillside for a smooth, genuinely steep patch at the lowest Hill height.
   const x=-3939.4016253802442,z=-3370.2300838721544,h=terrain.heightAt(x,z)??80;
   await tt.view(new THREE.Vector3(x+8,h+8,z+8),new THREE.Vector3(x,h+1,z));const fine=terrain.heightAt(x,z)??h;await tt.view(new THREE.Vector3(x+8,fine+8,z+8),new THREE.Vector3(x,fine+1,z));
   const gx=(terrain.heightAt(x+1,z)-terrain.heightAt(x-1,z))/2,gz=(terrain.heightAt(x,z+1)-terrain.heightAt(x,z-1))/2,grade=Math.hypot(gx,gz),heading=Math.atan2(gx,-gz)+(cross?Math.PI/2:0);
   v.place(x,z,heading);v.assist=0;v.steerAngle=0;
   const fx=Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=Math.sin(heading);
   v.pitch=Math.atan(gx*fx+gz*fz);v.roll=Math.atan(gx*rx+gz*rz);v.captureGround();
   if(!cross){v.vx=fx*2;v.vz=fz*2;v.speed=2;for(let i=0;i<30;i++)tt.step(1);}else tt.step(0,0,true);
   return{grade,degrees:Math.atan(grade)*180/Math.PI,distance:Math.hypot(v.x-x,v.z-z),contacts:tt.contacts()};
 };
 tt.block=()=>{tt.place(0,-28,0,1);let impact=0;const hit=v.onSolidImpact.bind(v);v.onSolidImpact=s=>{impact=Math.max(impact,s);hit(s);};for(let i=0;i<120*6;i++)tt.step(1);return {impact,local:site.local(v.x,v.z),speed:v.speed};};
})()`);await sleep(100);}
try{
 await p.navigate(`${origin}/sxs.html?view=front`);
 const model=await p.read(`(()=>{const {car,renderer,scene,camera}=sxsPreview;const hidden=scene.children.filter(n=>n!==car.root&&!n.isLight);hidden.forEach(n=>n.visible=false);car.root.traverse(n=>n.frustumCulled=false);renderer.render(scene,camera);return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};})()`);
 check(model.calls<=30&&model.triangles<=40000,'actual renderer budget',model);
 const modelBad=await p.read(`(()=>{const {car,renderer,scene,camera}=sxsPreview;for(let i=0;i<40;i++)car.root.add(car.body.children.find(n=>n.isMesh).clone());renderer.render(scene,camera);return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};})()`);
 check(!(modelBad.calls<=30&&modelBad.triangles<=40000),'mutation rejected: actual renderer budget',modelBad);
 await p.navigate(`${origin}/?vehicle=sxs&${cameraQuery}&exag=1&hud=0&scene=0`);
 for(const exag of [1,1.5,2,2.5]){
  if(exag!==1)await p.navigate(`${origin}/?vehicle=sxs&${cameraQuery}&exag=${exag}&hud=0&scene=0`);
  await setup();
  const ready=await p.read(`({spec:mmm.vehicle.spec.wheelbase,travel:typeof mmm.vehicle.car.setTravel,built:!!mmm.yard.triangles})`);
  check(ready.spec===2.6&&ready.travel==='function'&&ready.built,'sxs loads with garage parameter',ready);
  const missingTravel=await p.read("(()=>{const c=mmm.vehicle.car,f=c.setTravel;c.setTravel=undefined;const valid=typeof c.setTravel==='function';c.setTravel=f;return valid;})()");check(!missingTravel,'mutation rejected: travel absent',missingTravel);
  const road=await p.read(`(async()=>{const {site,v,terrain,THREE}=tt,p=site.world(41,-100),hit=v.roads.nearest(p.x,p.z,200,r=>r.kind===1);if(!hit)throw Error('paved road missing');const eye=new THREE.Vector3(hit.x+8,(terrain.heightAt(hit.x,hit.z)??0)+6,hit.z+9);await tt.view(eye,new THREE.Vector3(hit.x,(terrain.heightAt(hit.x,hit.z)??0)+1,hit.z));v.place(hit.x,hit.z,hit.heading);return tt.park();})()`);
  check(road.every(c=>contactIsSeated(c)),`Hill ${exag}: all four tyres on drawn road`,road);
  const gravel=await p.read(`(async()=>{const {v,terrain,THREE}=tt,pts=v.roads.roads.find(r=>r.id===80).pts;let distance=110,hit;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(distance<=d){hit={x:a[0]+(b[0]-a[0])*distance/d,z:a[1]+(b[1]-a[1])*distance/d,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};break;}distance-=d;}if(!hit)throw Error('gravel section missing');const h=terrain.heightAt(hit.x,hit.z)??0;await tt.view(new THREE.Vector3(hit.x+6,h+6,hit.z+6),new THREE.Vector3(hit.x,h+.8,hit.z));const fine=terrain.heightAt(hit.x,hit.z)??h;await tt.view(new THREE.Vector3(hit.x+6,fine+6,hit.z+6),new THREE.Vector3(hit.x,fine+.8,hit.z));v.place(hit.x,hit.z,hit.heading);return tt.park();})()`);
  check(gravel.every(c=>contactIsSeated(c)),`Hill ${exag}: all four tyres on drawn gravel`,gravel);
  const cross=await p.read('tt.slope(true)'),climb=await p.read('tt.slope(false)');
  for(const [name,result]of [['cross slope',cross],['steep climb',climb]])check(result.grade>.36&&result.contacts.every(c=>contactIsSeated(c))&& (name!=='steep climb'||result.distance>.1),`Hill ${exag}: tread vertices on drawn ${name}`,result);
  const ramp=await p.read(`(async()=>{const {r,site,THREE}=tt,p=site.world(r.u-8,r.v),h=site.rampBase??0;await tt.view(new THREE.Vector3(p.x+9,h+7,p.z+9),new THREE.Vector3(p.x,h+1,p.z));return tt.stopOnRamp();})()`);
  check(ramp.along>5&&ramp.along<13&&Math.abs(ramp.speed)<.05&&ramp.lift>.5&&ramp.contacts.every(c=>contactIsSeated(c,true)),`Hill ${exag}: drives up, stops, and all four tyres stand on the drawn ramp deck`,ramp);
  // A deliberately displaced root must be rejected by exactly the same drawn-contact predicate.
  const mutant=await p.read(`(()=>{const c=tt.v.car.root;c.position.y+=.5;const gaps=tt.contacts();c.position.y-=.5;c.updateMatrixWorld(true);return gaps;})()`);
  check(!mutant.every(c=>contactIsSeated(c,true)),'mutation rejected: floating tyres on drawn ground',mutant);
  const partial=await p.read(`(()=>{const {THREE,v,yard}=tt,old=yard.group.visible,patches=new THREE.Group();v.car.root.updateMatrixWorld(true);yard.group.visible=false;for(const w of Object.values(v.car.wheels)){const q=w.getWorldPosition(new THREE.Vector3()),tile=new THREE.Mesh(new THREE.PlaneGeometry(.15,.15),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));tile.rotation.x=-Math.PI/2;tile.position.set(q.x,q.y-.405-.12,q.z);patches.add(tile);}patches.updateMatrixWorld(true);try{return tyreContacts(THREE,v.car,[new THREE.Group(),patches]);}finally{yard.group.visible=old;}})()`);
  check(partial.some(c=>!c.ray)&&!partial.every(c=>contactIsSeated(c,true)),'mutation rejected: partial ramp rays cannot pass',partial);
  const noRamp=await p.read(`(()=>{const g=tt.yard.group;g.visible=false;const gaps=tt.contacts();g.visible=true;return gaps;})()`);
  check(!noRamp.every(c=>contactIsSeated(c,true)),'mutation rejected: the ramp is not drawn under the tyres',noRamp);
  const sunkTyre=await p.read(`(()=>{const w=tt.v.car.wheels.rl;w.position.y-=.12;const gaps=tt.contacts();w.position.y+=.12;w.updateMatrixWorld(true);return gaps;})()`);
  check(!sunkTyre.every(c=>contactIsSeated(c,true)),'mutation rejected: a tyre moved inside its hub',sunkTyre);
  const sunkMesh=await p.read(`(()=>{const w=tt.v.car.wheels.fl,m=w.children.find(n=>n.isMesh&&/rubber/i.test(n.material.name));const down=new tt.THREE.Vector3(0,-.12,0).applyQuaternion(w.getWorldQuaternion(new tt.THREE.Quaternion()).invert());m.position.add(down);try{return tt.contacts();}finally{m.position.sub(down);}})()`);
  check(!sunkMesh.every(c=>contactIsSeated(c,true)),'mutation rejected: tyre mesh moved inside its hub',sunkMesh);
  const underside=await p.read(`(()=>{const {v,terrain,r,site}=tt;tt.place(r.u-8,r.v);const decks=v.groundContacts.map(p=>site.deckHeight(p.x,p.z));if(decks.some(y=>y===null))throw Error('underside witness needs a real deck at every wheel');v.y=Math.min(...decks)-.30;v.pitch=v.roll=0;terrain.withGroundContact(v,()=>v.captureGround());return v.groundContacts.map(p=>({height:p.height,land:terrain.landHeightAt(p.x,p.z)}));})()`);
  check(underside.every(p=>p.height===p.land),`Hill ${exag}: deck above body by 25 cm is ignored`,underside);
  // Contacts now pass their own height explicitly; removing an ambient scope cannot bypass that gate.
  const unsafe=await p.read(`(()=>{const {v,terrain}=tt;const guard=terrain.heightAt;terrain.heightAt=(x,z)=>guard.call(terrain,x,z,v.y+10);try{terrain.withGroundContact(v,()=>v.captureGround());return v.groundContacts.map(p=>({height:p.height,land:terrain.landHeightAt(p.x,p.z)}));}finally{terrain.heightAt=guard;}})()`);
  check(!unsafe.every(p=>p.height===p.land),'mutation rejected: incorrect underside reference height',unsafe);
  const drive=await p.read('tt.ramp()');check(drive.deck>0&&drive.maxRampLift>1.5&&drive.launchAlong>12&&drive.air>0&&drive.landed&&drive.maxRampLift<2.15&&drive.launchVy<6&&drive.maxRoll<.35,`Hill ${exag}: climbs, leaves and lands after slip ramp`,drive);
  const bad=await p.read(`(()=>{const old=tt.site.deckHeight;tt.site.deckHeight=()=>null;try{return tt.ramp();}finally{tt.site.deckHeight=old;}})()`);
  check(!(bad.deck>0&&bad.maxRampLift>1.5&&bad.launchAlong>12&&bad.air>0&&bad.landed&&bad.maxRampLift<2.15&&bad.launchVy<6&&bad.maxRoll<.35),'mutation rejected: missing ramp deck',bad);
  const loaded=await p.read('tt.loadedRamp()');
  check(loaded.distance>15&&loaded.landing&&loaded.maxYaw<.05&&loaded.impact<1,`Hill ${exag}: full run-up clears the intact load and lands straight`,loaded);
  const weak=await p.read(`(()=>{const spec=tt.v.spec;tt.v.spec={...spec,engineAcceleration:2};try{return tt.loadedRamp();}finally{tt.v.spec=spec;}})()`);
  check(!(weak.distance>15&&weak.landing&&weak.maxYaw<.05&&weak.impact<1),'mutation rejected: insufficient loaded-ramp launch',weak);
  reports.push({exag,road,gravel,cross,climb,ramp,drive,loaded});

 }
 const collision=await p.read('tt.block()');check(collision.impact>1&&collision.local.v<-.5&&Math.abs(collision.speed)<2,'yard solid stops the sxs',collision);
 const missed=await p.read(`(()=>{const old=tt.yard.resolveSolids;tt.yard.resolveSolids=()=>{};try{return tt.block();}finally{tt.yard.resolveSolids=old;}})()`);check(!(missed.impact>1&&missed.local.v<-.5&&Math.abs(missed.speed)<2),'mutation rejected: yard collision disabled',missed);
 // R is a real keyboard event through main.ts, including the placement guard.
 const before=await p.read('({x:tt.v.x,z:tt.v.z})');
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r',windowsVirtualKeyCode:82});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r',windowsVirtualKeyCode:82});
 const reset=await p.read('({x:tt.v.x,z:tt.v.z,speed:tt.v.speed,vx:tt.v.vx,vz:tt.v.vz})');check(Math.hypot(reset.x-before.x,reset.z-before.z)>3&&reset.vx===0&&reset.vz===0,'R resets the sxs',reset);
 // Bypass only the method for one key event, then restore it; this proves the reset assertion observes input.
 await p.read('tt.originalRespawn=tt.v.respawn;tt.v.respawn=()=>{};');
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r',windowsVirtualKeyCode:82});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r',windowsVirtualKeyCode:82});
 const noReset=await p.read('({x:tt.v.x,z:tt.v.z})');await p.read('tt.v.respawn=tt.originalRespawn;');check(Math.hypot(noReset.x-reset.x,noReset.z-reset.z)===0,'mutation rejected: R method disabled',noReset);
 // Use the live game loop for the real chase camera and phone pedal events.
 await p.navigate(`${origin}/?vehicle=sxs&road=Highway%2019&f=.77&exag=1.5&hud=1&scene=0`);
 const camera=await p.read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js');const {vehicle:v,camera}=mmm;v.car.root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(v.car.root),points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera).toArray());return points;})()`);
 check(camera.every(p=>Math.abs(p[0])<.98&&Math.abs(p[1])<.98&&p[2]>-1&&p[2]<1),'chase camera sees the whole sxs',camera);
 const clipped=await p.read(`(async()=>{const THREE=await import('/node_modules/three/build/three.module.js'),{vehicle:v,camera}=mmm,old=camera.fov;try{camera.fov=5;camera.updateProjectionMatrix();const box=new THREE.Box3().setFromObject(v.car.root),points=[];for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera).toArray());return points;}finally{camera.fov=old;camera.updateProjectionMatrix();}})()`);check(!clipped.every(p=>Math.abs(p[0])<.98&&Math.abs(p[1])<.98&&p[2]>-1&&p[2]<1),'mutation rejected: camera clips sxs',clipped);
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});for(let i=0;i<40;i++){await sleep(500);if(await p.read('mmm.vehicle.speed>5'))break;}await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 await p.navigate(`${origin}/?vehicle=sxs&road=Highway%2019&f=.77&exag=1.5&view=seat&hud=0&scene=0`);await p.shot(`${out}/sxs-seat.png`);
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await p.navigate(`${origin}/?vehicle=sxs&road=Highway%2019&f=.77&exag=1.5&touch=1&hud=1&scene=0`);
 const phoneBefore=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z})');
 const pedal=await p.read(`(()=>{const b=document.getElementById('tcGo').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2,visible:b.width>0&&b.height>0};})()`);check(pedal.visible,'phone GO pedal is visible',pedal);
 const hiddenPedal=await p.read(`(()=>{const b=document.getElementById('tcGo'),old=b.style.display;b.style.display='none';const r=b.getBoundingClientRect();b.style.display=old;return r.width>0&&r.height>0;})()`);check(!hiddenPedal,'mutation rejected: phone pedal hidden',hiddenPedal);
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pedal.x,y:pedal.y,id:1}]});for(let i=0;i<40;i++){await sleep(500);if(await p.read(`Math.hypot(mmm.vehicle.x-(${phoneBefore.x}),mmm.vehicle.z-(${phoneBefore.z}))>4&&mmm.vehicle.speed>2`))break;}
 const phone=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed})');await p.shot(`${out}/sxs-phone.png`);await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});check(Math.hypot(phone.x-phoneBefore.x,phone.z-phoneBefore.z)>2&&phone.speed>1,'actual touch GO drives sxs',phone);
 const stalledStart=await p.read('ttPhoneUpdate=mmm.vehicle.update;mmm.vehicle.update=()=>{};({x:mmm.vehicle.x,z:mmm.vehicle.z})');
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pedal.x,y:pedal.y,id:2}]});await sleep(1000);
 const stalled=await p.read('({x:mmm.vehicle.x,z:mmm.vehicle.z,speed:mmm.vehicle.speed})');await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.read('mmm.vehicle.update=ttPhoneUpdate;');check(!(Math.hypot(stalled.x-stalledStart.x,stalled.z-stalledStart.z)>2&&stalled.speed>1),'mutation rejected: phone cannot drive',stalled);
 writeFileSync(`${out}/sxs-browser.json`,JSON.stringify({model,reports,collision,reset,camera,phone,failures},null,2)+'\n');
 assert.deepEqual(failures,[],'sxs browser acceptance');
 console.log('PASS sxs browser and contact/ramp/collision/reset mutations.');
}finally{await p.close();}
