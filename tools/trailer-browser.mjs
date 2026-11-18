#!/usr/bin/env node
// WEB_PORT=5273 CDP_PORT=9473 RUN=trailer-browser.mjs VIEWS='trailer|vehicle=truck&trailer=1' tools/yard-shots.sh 1400 950
// Captures go only to the caller's OUT directory. No renderer timing measurements.
import assert from 'node:assert/strict';
import { contactRegression, assertContactRegression } from './trailer-review-browser.mjs';
import { tyreContacts, realCrossSlope } from './tyre-contacts.mjs';
import { writeFileSync } from 'node:fs';
import { open,sleep } from './truck-cdp.mjs';
const [out,first]=process.argv.slice(2),origin=new URL(first).origin,reports=[],failures=[];
const cameraQuery='cam=620525.19624,5099315.85697,3.2,-34.25384,-5,55&camground=1';
const p=await open(`${origin}/?vehicle=truck&trailer=1&${cameraQuery}&exag=1&hud=0&scene=0`);
const check=(ok,label,data)=>{console.log(ok?'PASS':'FAIL',label,ok?'':JSON.stringify(data));if(!ok)failures.push({label,data});};
async function setup(){await p.read(`(async()=>{
 const THREE=await import('/node_modules/three/build/three.module.js'),{SLIP_RAMP:r}=await import('/src/yard-site.ts');
 const {autopilot}=await import('/src/vehicle.ts');
 const {vehicle:v,towing:t,yard,terrain,camera,renderer,trees,water}=mmm,site=yard.site,scene=yard.group.parent;
 window.requestAnimationFrame=fn=>{window.nextFrame=fn;return 0;};
 window.tt={THREE,v,t,yard,site,terrain,camera,scene,r,renderer};
 tt.step=(throttle=0,steer=0,touch=false)=>{mmm.driveVehicle(1/120,{throttle,steer,handbrake:false,touch});};
 tt.place=(u,w,du=1,dv=0)=>{const q=site.world(u,w);v.place(q.x,q.z,site.heading(du,dv));v.assist=0;v.steerAngle=0;v.damageActive=false;};
 tt.park=()=>{for(let i=0;i<240;i++)tt.step();t.update();return tt.contacts();};
 tt.view=async(eye,target)=>{camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld();for(let i=0;i<90;i++){terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard.update(0,v,camera.position);water?.update(camera);try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));}};
 tt.shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
 tt.probeTyres=${tyreContacts.toString()};
 tt.crossSlope=${realCrossSlope.toString()};
 tt.contacts=()=>tt.probeTyres(THREE,tt.t.trailer.wheels.map((wheel,i)=>({name:String(i),wheel,radius:.34})),[terrain.group,yard.group]);
 tt.stopOnRamp=()=>{yard.jumpLoad=[];tt.place(r.u+18,r.v,-1,0);let along=-99,steps=0;
   for(;steps<120*35&&along<5;steps++){tt.step(v.speed<2?1:0);along=r.u-site.local(t.x,t.z).u;}
   for(let i=0;i<120*4&&Math.abs(v.speed)>.02;i++)mmm.driveVehicle(1/120,{throttle:v.speed>0?-1:0,steer:0,handbrake:true});
   for(let i=0;i<60;i++)mmm.driveVehicle(1/120,{throttle:0,steer:0,handbrake:true});t.update();
   return{along:r.u-site.local(t.x,t.z).u,speed:v.speed,lift:t.y-(site.rampBase??0),contacts:tt.contacts()};};
 tt.chaseView=async(cruise=0,reverse=false)=>{
   window.nextFrame?.(performance.now());
   for(let i=0;i<110;i++){
     if(reverse)tt.step(-.25,0,true);else if(cruise>0)mmm.driveVehicle(1/120,autopilot(v,mmm.roads,cruise));else tt.step();
     mmm.chase(1/60);camera.updateMatrixWorld();terrain.update(camera);trees?.update(terrain.drawnFine,camera.position);yard.update(0,v,camera.position);water?.update(camera);
     try{renderer.render(scene,camera);}finally{water?.settle();}water?.afterRender(camera);await new Promise(r=>setTimeout(r,20));
   }
 };
 tt.framing=()=>{camera.updateMatrixWorld();const point=new THREE.Vector3();const bounds=root=>{root.updateMatrixWorld(true);let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;root.traverse(n=>{if(!n.isMesh||!tt.shown(n))return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){point.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld).project(camera);const x=(point.x+1)*innerWidth/2,y=(1-point.y)*innerHeight/2;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}});return{x0,x1,y0,y1};};const truck=bounds(v.car.root),trailer=bounds(t.trailer.root),x0=Math.min(truck.x0,trailer.x0),x1=Math.max(truck.x1,trailer.x1),y0=Math.min(truck.y0,trailer.y0),y1=Math.max(truck.y1,trailer.y1);
 const road=terrain.meshHeightAt(camera.position.x,camera.position.z),horizon=point.set(camera.position.x+Math.sin(v.heading)*100000,v.y,camera.position.z-Math.cos(v.heading)*100000).project(camera);
 const occluders=[];for(const id of ['hud','shiftHud','stopHint','cameraButton','mailButton','mailScore','radio','bladder','miniMap','tcSteer','tcGo','tcBrake','tcReset','tcView','tcHorn','gear']){const e=document.getElementById(id);if(!e||e.hidden||getComputedStyle(e).display==='none'||getComputedStyle(e).visibility==='hidden')continue;const r=e.getBoundingClientRect();if(r.width&&r.height&&r.left<trailer.x1&&r.right>trailer.x0&&r.top<trailer.y1&&r.bottom>trailer.y0)occluders.push({id,x:r.x,y:r.y,width:r.width,height:r.height});}
 return{width:innerWidth,height:innerHeight,truck,trailer,fill:(x1-x0)/innerWidth,inside:x0>=8&&x1<=innerWidth-8&&y0>=8&&y1<=innerHeight-8,aboveRoad:road===null?null:camera.position.y-road,horizon:(1-horizon.y)/2,occluders,pose:camera.position.toArray(),speed:v.speed*3.6};};
 tt.lane=()=>{const records=[];const wheels=[...Object.entries(v.car.wheels).map(([name,w])=>({name,w})),...(v.car.extraWheels??[]).map((w,i)=>({name:'dual'+i,w})),...t.trailer.wheels.map((w,i)=>({name:'trailer'+i,w}))];const p=new THREE.Vector3();for(const{name,w}of wheels){w.updateWorldMatrix(true,true);const c=w.getWorldPosition(new THREE.Vector3()),hit=mmm.roads.nearest(c.x,c.z,20,r=>r.kind===1);if(!hit)throw Error('wheel off Highway 19');let heading=hit.heading;if(Math.cos(heading-v.heading)<0)heading+=Math.PI;let min=Infinity,max=-Infinity;w.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld);const side=(p.x-hit.x)*Math.cos(heading)+(p.z-hit.z)*Math.sin(heading);min=Math.min(min,side);max=Math.max(max,side);}});records.push({name,min,max,width:hit.road.halfWidth});}return records;};
 tt.demoDrive=(distance,speed)=>{const hit=mmm.roads.nearest(v.x,v.z,200,r=>r.kind===1);let heading=hit.heading;if(Math.cos(heading-v.heading)<0)heading+=Math.PI;const side=hit.road.halfWidth/2;v.place(hit.x+Math.cos(heading)*side,hit.z+Math.sin(heading)*side,heading);v.assist=0;let travel=0,maxAngle=0;for(let i=0;i<120*90&&travel<distance;i++){const x=v.x,z=v.z;mmm.driveVehicle(1/120,autopilot(v,mmm.roads,speed));travel+=Math.hypot(v.x-x,v.z-z);maxAngle=Math.max(maxAngle,Math.abs(t.angle));}return{distance:travel,maxAngle,speed:v.speed};};
 tt.picture=async(side=1,back=1,height=7)=>{const fx=Math.sin(t.heading),fz=-Math.cos(t.heading),rx=Math.cos(t.heading),rz=Math.sin(t.heading);await tt.view(new THREE.Vector3(t.x+rx*side-fx*back,t.y+height,t.z+rz*side-fz*back),new THREE.Vector3(t.x,t.y+1,t.z));};
})()`);await sleep(100);}
const contactOK=a=>a.every(c=>c.ray&&c.penetration<.04&&c.float<.04);
try{
 const treadReview=await contactRegression(p);assertContactRegression(treadReview);
 for(const exag of (process.env.TRAILER_HILL_HEIGHTS??'1,1.5,2,2.5').split(',').map(Number)){
  if(exag!==1)await p.navigate(`${origin}/?vehicle=truck&trailer=1&${cameraQuery}&exag=${exag}&hud=0&scene=0`);
  await setup();
  const model=await p.read('({triangles:tt.t.trailer.triangles,drawCalls:tt.t.trailer.drawCalls,chassis:tt.t.trailer.chassisCost,help:tt.t.help})');
  check(model.triangles<=47000&&model.drawCalls<=38&&model.chassis.triangles<=14000&&model.chassis.drawCalls===8&&!model.help,'real cargo/chassis budgets and keyboard help default',model);
  const parked=await p.read(`(async()=>{tt.place(240,90);await tt.picture(15,12,10);return tt.park();})()`);
  check(contactOK(parked),
   'Hill '+exag+': four parked tyres on independently drawn land',parked);
  const cross=await p.read('tt.crossSlope(tt)');
  check(contactOK(cross.contacts)&&Math.abs(cross.roll)>.12,'Hill '+exag+': tread shoulders on drawn cross slope',cross);
  const ramp=await p.read(`(async()=>{const {site,r,v,t,THREE}=tt;const q=site.world(r.u-8,r.v);await tt.view(new THREE.Vector3(q.x+12,v.y+7,q.z+12),new THREE.Vector3(q.x,v.y+1,q.z));return tt.stopOnRamp();})()`);
  check(ramp.along>4&&ramp.along<12&&Math.abs(ramp.speed)<.05&&ramp.lift>.3&&contactOK(ramp.contacts)&&ramp.contacts.every(c=>c.inYard),'Hill '+exag+': drives up and stops with four tyres on drawn ramp',ramp);
  const hiddenRamp=await p.read(`(()=>{const g=tt.yard.group;g.visible=false;const contacts=tt.contacts();g.visible=true;return contacts;})()`);check(!hiddenRamp.every(c=>c.inYard&&Math.abs(c.gap)<.04),'mutation rejected: ramp missing from drawing',hiddenRamp);
  const movedTyre=await p.read(`(()=>{const w=tt.t.trailer.wheels[0];w.position.y-=.12;const contacts=tt.contacts();w.position.y+=.12;return contacts;})()`);check(!contactOK(movedTyre),'mutation rejected: tyre vertices displaced',movedTyre);
  const mutant=await p.read(`(()=>{const r=tt.t.trailer.root;r.position.y+=.5;const c=tt.contacts();r.position.y-=.5;return c;})()`);
  check(!contactOK(mutant),'mutation rejected: trailer floats above drawn land',mutant);
  reports.push({exag,model,parked,cross,ramp});
  if(exag===1.5){await p.read('tt.picture(12,6,5)');await p.shot(`${out}/rig-yard-ramp.png`);}
 }
 const flight=await p.read(`(()=>{const {v,t,yard,r}=tt;yard.jumpLoad=[];tt.place(r.u+24,r.v,-1,0);let air=0,landed=false,maxCoupler=0,maxVy=0,finite=true;for(let i=0;i<120*12;i++){tt.step(i<120*8?1:0);if(t.airborne)air++;else if(air>0)landed=true;t.trailer.root.updateMatrixWorld(true);const q=t.trailer.root.localToWorld(new tt.THREE.Vector3(0,.43,-5.6)),h=t.hitch();maxCoupler=Math.max(maxCoupler,Math.hypot(q.x-h.x,q.y-h.y,q.z-h.z));maxVy=Math.max(maxVy,Math.abs(t.vy));finite&&=[v.x,v.y,t.x,t.y,t.vy].every(Number.isFinite);}return{air,landed,maxCoupler,maxVy,finite};})()`);
 check(flight.air>0&&flight.landed&&flight.maxCoupler<.03&&flight.maxVy<30&&flight.finite,'trailer leaves ramp, stays coupled and lands ballistically',flight);
 // Node check covers the same phone bay trajectory; this exercises the actual production touch flag and setting.
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
 await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await p.navigate(`${origin}/?vehicle=truck&trailer=1&touch=1&road=Highway%2019&f=.77&exag=1.5&hud=1&scene=0`);
 const pedal=await p.read(`(()=>{const r=document.getElementById('tcBrake').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0,help:mmm.towing.help};})()`);
 check(pedal.visible&&pedal.help,'touch defaults Trailer help On with reverse pedal visible',pedal);
 await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:pedal.x,y:pedal.y,id:1}]});await sleep(2500);
 const liveReverse=await p.read('({speed:mmm.vehicle.speed,time:mmm.towing.reverseTime})');
 await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});check(liveReverse.speed<-.2&&liveReverse.time>.5,'actual phone reverse pedal drives the coupled rig',liveReverse);
 await setup();
 const phone=await p.read(`(async()=>{
 const {v,t,site,THREE}=tt;tt.place(249,90);await tt.picture(15,12,10);tt.park();t.help=true;
 const start={x:t.x,z:t.z},h=t.heading,fx=Math.sin(h),fz=-Math.cos(h),rx=Math.cos(h),rz=Math.sin(h);let progress=0,noise=0,error=0,seed=42;
 const R=14,arc=R*Math.PI/2,length=5+arc+10;
 for(let i=0;i<14400&&progress<length;i++){
 const a=Math.max(0,Math.min(Math.PI/2,(progress-5)/R)),dx=progress<5?0:progress<5+arc?-R*(1-Math.cos(a)):-R-(progress-5-arc),dz=progress<5?progress:progress<5+arc?5+R*Math.sin(a):5+R;
 const tx=start.x+rx*dx-fx*dz,tz=start.z+rz*dx-fz*dz;
 const cross=(t.x-tx)*(rx*Math.cos(a)-fx*Math.sin(a))+(t.z-tz)*(rz*Math.cos(a)-fz*Math.sin(a));
 const err=Math.atan2(Math.sin(h+a-t.heading),Math.cos(h+a-t.heading)),curvature=progress>=5&&progress<5+arc?1/R:0;
 if(i%18===0){seed=(Math.imul(seed,1664525)+1013904223)>>>0;noise=(seed/4294967296-.5)*.26;}
 const steer=Math.max(-1,Math.min(1,-(curvature+err*.6+cross*.08)/.075+noise+.025*Math.sin(i*.021)));
 const old={x:t.x,z:t.z};tt.step(Math.max(-1,Math.min(1,(-1.5-v.speed)*2)),steer,true);
 progress+=Math.max(0,-(t.x-old.x)*Math.sin(h+a)+(t.z-old.z)*Math.cos(h+a));error=Math.abs(cross);
 }
 // Mark a four-metre-wide bay using simple test-only geometry, on the same visible ground.
 const mark=(lateral,along)=>new THREE.Vector3(start.x+rx*lateral-fx*along,0,start.z+rz*lateral-fz*along);
 const paint=new THREE.MeshBasicMaterial({color:0xf4dda0});for(const along of [5+R-2,5+R+2]){const a=mark(-R-12,along),b=mark(-R+2,along),g=new THREE.BoxGeometry(14,.035,.06),m=new THREE.Mesh(g,paint);m.position.copy(a.add(b).multiplyScalar(.5));m.position.y=tt.terrain.heightAt(m.position.x,m.position.z)+.025;m.rotation.y=-h;tt.scene.add(m);}
 await tt.chaseView(0,true);return{progress,error,framing:tt.framing(),angle:t.angle,help:t.help,touch:document.getElementById('tcBrake').getBoundingClientRect().width>0};
})()`);
 check(phone.progress>36.9&&phone.error<.6&&phone.help&&phone.touch,'phone help reverses through 90 degrees into four-metre bay',phone);
 check(phone.framing.fill>.35&&phone.framing.fill<.47&&phone.framing.inside&&phone.framing.occluders.length===0,'phone reverse view fills 40 percent without HUD covering trailer',phone.framing);
 await p.shot(`${out}/rig-reverse-help.png`);
 const helpToggle=await p.read(`(()=>{const off=document.querySelector('[data-trailer-help="off"]'),on=document.querySelector('[data-trailer-help="on"]');off.click();const disabled=!tt.t.help;on.click();return disabled&&tt.t.help;})()`);check(helpToggle,'help setting has working On and Off values',helpToggle);
 await p.send('Emulation.clearDeviceMetricsOverride');await p.send('Emulation.setTouchEmulationEnabled',{enabled:false});
 await p.navigate(`${origin}/?vehicle=truck&trailer=1&${cameraQuery}&exag=1.5&hud=0&scene=0`);await setup();
 await p.read('(async()=>{tt.place(240,90);tt.park();tt.v.car.root.visible=false;tt.t.trailer.mounts.sxs.root.visible=false;tt.t.trailer.mounts.bike.root.visible=false;await tt.picture(8,-8,5);})()');await p.shot(`${out}/trailer-alone-34.png`);
 await p.read('tt.picture(1,7,2.8)');await p.shot(`${out}/trailer-rear.png`);
 await p.read('(async()=>{tt.v.car.root.visible=true;tt.t.trailer.mounts.sxs.root.visible=true;tt.t.trailer.mounts.bike.root.visible=true;await tt.picture(20,-2,4.6);})()');await p.shot(`${out}/rig-side.png`);
 await p.read('(async()=>{for(let i=0;i<120*7;i++)tt.step(Math.max(-1,Math.min(1,(2-tt.v.speed)*2)),.8);await tt.picture(10,7,22);})()');await p.shot(`${out}/rig-turning.png`);
 const jack=await p.read('(async()=>{tt.place(240,90);tt.t.help=false;for(let i=0;i<120*16&&tt.t.clunks===0;i++)tt.step(-1,1);await tt.picture(12,8,15);return {clunks:tt.t.clunks,angle:tt.t.angle,speed:tt.v.speed};})()');
 check(jack.clunks>0&&Math.abs(jack.angle)<=78*Math.PI/180+1e-6&&jack.speed===0,'jackknife contact stops reversing pickup',jack);await p.shot(`${out}/rig-jackknife.png`);
 const collision=await p.read(`(()=>{tt.place(0,-28,0,-1);tt.t.help=false;let impact=0;const t=tt.t;for(let i=0;i<120*10;i++){tt.step(-1,0);impact=Math.max(impact,t.impacts);}return{impact,speed:tt.v.speed,local:tt.site.local(t.x,t.z)};})()`);
 check(collision.impact>0,'trailer contacts yard solid through hitch',collision);
 const before=await p.read('({x:tt.v.x,z:tt.v.z})');
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyR',key:'r',windowsVirtualKeyCode:82});await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyR',key:'r',windowsVirtualKeyCode:82});
 const reset=await p.read('({x:tt.v.x,z:tt.v.z,angle:tt.t.angle,speed:tt.v.speed,distance:Math.hypot(tt.t.x-tt.v.x,tt.t.z-tt.v.z)})');
 check(Math.hypot(reset.x-before.x,reset.z-before.z)>3&&Math.abs(reset.angle)<1e-10&&reset.distance>8.8&&reset.speed===0,'R places full-length pair straight on valid ground',reset);
 const lights=await p.read(`(()=>{const t=tt.t;t.input={throttle:-1,steer:0,handbrake:true};t.update();const all=[...t.trailer.tailLamps,...tt.v.car.brakeLights],bright=all.every(m=>m.material.emissiveIntensity===2.5);t.input={throttle:0,steer:0,handbrake:false};t.update();return{bright,dim:all.every(m=>m.material.emissiveIntensity===.3)};})()`);
 check(lights.bright&&lights.dim,'trailer and pickup tail lamps follow brakes together',lights);
 const noLights=await p.read(`(()=>{const t=tt.t,old=t.update;t.update=()=>{};t.input={throttle:0,steer:0,handbrake:true};t.update();const bright=t.trailer.tailLamps.every(m=>m.material.emissiveIntensity===2.5);t.update=old;t.input={throttle:0,steer:0,handbrake:false};return bright;})()`);check(!noLights,'mutation rejected: brake light sync disabled',noLights);
 // A production highway drive on real road geometry, using only a scripted steering/pedal driver.
 await p.navigate(`${origin}/?vehicle=truck&trailer=1&road=Highway%2019&f=.77&exag=1.5&hud=0&scene=0`);await setup();
 await p.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 const highway=await p.read(`(async()=>{const drive=tt.demoDrive(400,80/3.6);await tt.chaseView(80/3.6);return{...drive,framing:tt.framing(),lane:tt.lane()};})()`);
 check(highway.distance>=400&&highway.maxAngle<.6,'400 m Highway 19 drive tracks cleanly',highway);
 check(highway.lane.every(w=>w.min>=0&&w.max<=w.width),'truck duals and all trailer tyres inside right-hand lane',highway.lane);
 check(highway.framing.fill>.28&&highway.framing.fill<.39&&highway.framing.inside&&highway.framing.aboveRoad>=4.5&&highway.framing.aboveRoad<=5.5&&highway.framing.horizon>.2&&highway.framing.horizon<.36,'low towing chase fills about one third with horizon in upper third',highway.framing);
 await p.shot(`${out}/rig-highway19.png`);await p.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w',windowsVirtualKeyCode:87});
 await p.read(`(async()=>{const road=mmm.roads.roads.find(r=>r.id===55),i=Math.floor(road.pts.length*.55),a=road.pts[i],b=road.pts[i+1],heading=Math.atan2(b[0]-a[0],a[1]-b[1]);tt.v.place(a[0]+Math.cos(heading)*1.3,a[1]+Math.sin(heading)*1.3,heading);await tt.chaseView();tt.v.place(a[0]+Math.cos(heading)*1.3,a[1]+Math.sin(heading)*1.3,heading);tt.park();await tt.chaseView();})()`);await p.shot(`${out}/rig-gravel.png`);
 await p.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});await p.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
 await p.navigate(`${origin}/?vehicle=truck&trailer=1&touch=1&road=Highway%2019&f=.77&exag=1.5&hud=1&scene=0`);await setup();
 const go=await p.read(`(()=>{const r=document.getElementById('tcGo').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);await p.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:go.x,y:go.y,id:3}]});
 const phoneChase=await p.read(`(async()=>{const drive=tt.demoDrive(150,60/3.6);await tt.chaseView(60/3.6);return{...drive,framing:tt.framing(),lane:tt.lane()};})()`);
 check(phoneChase.framing.inside&&phoneChase.framing.fill>.24&&phoneChase.framing.occluders.length===0&&phoneChase.framing.speed>55&&phoneChase.framing.speed<65,'phone chase shows whole rig near 60 km/h without HUD covering trailer',phoneChase);
 await p.shot(`${out}/rig-chase-phone.png`);const refused=await p.read(`(()=>{const {v,t}=tt,bounds=v.bounds;t.detach();v.bounds=[v.x-4,v.z-4,v.x+4,v.z+4];t.attach();window.nextFrame?.(performance.now());const result={attached:t.attached,reason:t.reason,hud:document.getElementById('hud').textContent};v.bounds=bounds;t.attach();return result;})()`);check(!refused.attached&&refused.reason&&refused.hud.includes(refused.reason),'R6_refused_attachment_has_HUD_reason',refused);await p.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.send('Emulation.clearDeviceMetricsOverride');await p.send('Emulation.setTouchEmulationEnabled',{enabled:false});
 // Let the live main loop position its chase camera; all eight corners of each body must fit.
 await p.navigate(`${origin}/?vehicle=truck&trailer=1&road=Highway%2019&f=.77&exag=1.5&hud=0&scene=0`);
 await setup();await p.read('tt.chaseView()');
 const camera=await p.read('tt.framing()');check(camera.inside,'chase camera sees all actual truck and trailer vertices',camera);
 const clipped=await p.read(`(()=>{const c=mmm.camera,old=c.fov;c.fov=4;c.updateProjectionMatrix();const point=mmm.towing.trailer.root.position.clone().project(c).toArray();c.fov=old;c.updateProjectionMatrix();return point;})()`);check(Math.abs(clipped[0])>.98||Math.abs(clipped[1])>.98,'mutation rejected: clipped chase view',clipped);
 await p.navigate(`${origin}/?vehicle=truck&trailer=empty&road=Highway%2019&f=.77&exag=1.5&hud=0&scene=0`);
 const empty=await p.read('({mass:mmm.vehicle.towLoad.mass,cargo:mmm.towing.trailer.mounts.sxs.root.children.length+mmm.towing.trailer.mounts.bike.root.children.length,drawCalls:mmm.towing.trailer.drawCalls})');
 check(empty.mass===1400&&empty.cargo===0&&empty.drawCalls===8,'empty parameter selects empty mass and bare mounts',empty);
 await p.navigate(`${origin}/?vehicle=car&trailer=1&road=Highway%2019&f=.77&exag=1.5&hud=0&scene=0`);
 const carOnly=await p.read('mmm.towing===undefined&&mmm.vehicle.towLoad===null');check(carOnly,'trailer parameter leaves the mail car detached',carOnly);
 writeFileSync(`${out}/trailer-browser.json`,JSON.stringify({reports,treadReview,flight,phone,jack,collision,reset,highway,phoneChase,camera,failures},null,2)+'\n');
 assert.deepEqual(failures,[],'trailer browser acceptance');
}finally{await p.close();}
