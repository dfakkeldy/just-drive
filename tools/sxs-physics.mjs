// Fixed 1/120 s production Vehicle on the baked Mabou land; no invented flat height field.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { SXS_SPEC } from '../web/src/sxs.ts';
import { pushOut } from '../web/src/parked.ts';
import { touchesPlayer } from '../web/src/road-scene-rules.ts';
import { Props } from '../web/src/props.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { TRUCK_SPEC } from '../web/src/truck.ts';
import { GARAGE, readVehicle } from '../web/src/garage.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';

import { SLIP_RAMP, YardSite } from '../web/src/yard-site.ts';

import { makeGround,preload } from './phone-ground.mjs';
const {terrain,roads}=makeGround(),dt=1/120,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const line=pts=>{const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return{pts,cum,length:cum.at(-1)};};
function at(p,s){let i=1;s=Math.max(0,Math.min(s,p.length));while(i<p.cum.length-1&&p.cum[i]<s)i++;const a=p.pts[i-1],b=p.pts[i],t=(s-p.cum[i-1])/(p.cum[i]-p.cum[i-1]||1);return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};}
const hwy=line(roads.roads.find(r=>r.id===25).pts),mines=line(roads.roads.find(r=>r.id===55).pts);
const samples=(p,a,b)=>{const pts=[];for(let s=a;s<=b;s+=20){const q=at(p,s);pts.push([q.x,q.z]);}return pts;};
const yard=new YardSite(terrain.manifest.village,'invented');terrain.sites.push(yard);
await preload(terrain,samples(hwy,0,hwy.length),150);await preload(terrain,samples(mines,1800,3100),120);await preload(terrain,[Object.values(yard.world(230,80))],180);
function v(spec=SXS_SPEC){const root=new THREE.Group(),body=new THREE.Group();root.add(body);const wheels=Object.fromEntries(['fl','fr','rl','rr'].map(k=>[k,new THREE.Group()]));const rig={root,body,wheels,steer:{fl:new THREE.Group(),fr:new THREE.Group()},driverEye:new THREE.Object3D(),brakeLights:[]};if(spec===SXS_SPEC||spec.wheelRadius===.405)rig.setTravel=(...t)=>{rig.travel=t;rig.maxTravel=Math.max(rig.maxTravel??0,...t);rig.minTravel=Math.min(rig.minTravel??0,...t);};const car=new Vehicle(rig,terrain,roads,-.2,spec);car.assist=0;return car;}
const coast={throttle:0,steer:0,handbrake:false};
function setSpeed(car,speed){car.vx=Math.sin(car.heading)*speed;car.vz=-Math.cos(car.heading)*speed;car.speed=speed;}
function step(car,input=coast){terrain.withGroundContact(car,()=>car.update(dt,input));}
// Pure pursuit follows real highway geometry. It does not alter height, surface, grip or speed.
function drive(car,path,s,speed){const p=at(path,s),look=at(path,s+Math.max(5,car.speed*.6)),dx=look.x-car.x,dz=look.z-car.z;
 const max=Math.min(car.spec.maxSteer,Math.atan(car.spec.wheelbase*car.spec.gripLock*car.spec.cornering*9.81/Math.max(car.speed*car.speed,4)));
 const angle=Math.atan2(2*car.spec.wheelbase*Math.sin(wrap(Math.atan2(dx,-dz)-car.heading)),Math.max(1,Math.hypot(dx,dz)));
 step(car,{throttle:speed===Infinity?1:Math.max(-1,Math.min(1,(speed-car.speed)*2)),steer:Math.max(-1,Math.min(1,angle/max)),handbrake:false});
 return Math.max(0,(car.vx*Math.sin(p.heading)-car.vz*Math.cos(p.heading))*dt);}
// Select a genuinely near-level 160 m paved section from real samples, rather than flattening a road for the test.
const sectionGrade=s=>{let max=0;for(let t=0;t<160;t+=10){const p=at(hwy,s+t),q=at(hwy,s+t+10);max=Math.max(max,Math.abs(terrain.heightAt(q.x,q.z)-terrain.heightAt(p.x,p.z))/10);}return max;};
let flat=null;
for(let s=200;s<hwy.length-400;s+=20){const a=at(hwy,s),b=at(hwy,s+160),ha=terrain.heightAt(a.x,a.z),hb=terrain.heightAt(b.x,b.z);const grade=Math.abs(hb-ha)/160;
 const maxGrade=sectionGrade(s);
 const score=grade+maxGrade;
 if(!flat||score<flat.score)flat={s,grade,maxGrade,score,a,b};}
console.log('LEVEL SECTION',JSON.stringify({...flat,highwayLength:hwy.length}));
function acceleration(spec,target=100){const car=v(spec);car.place(flat.a.x,flat.a.z,flat.a.heading);let s=flat.s,time=0;for(;time<15&&car.speed<target/3.6;time+=dt)s+=drive(car,hwy,s,Infinity);return time;}
function turning(spec){const car=v(spec),p=yard.world(230,80);car.place(p.x,p.z,0);car.steerAngle=spec.maxSteer;setSpeed(car,1.5);const before=car.heading;
 let dist=0;for(let i=0;i<120*45&&car.heading-before<Math.PI*2;i++){const x=car.x,z=car.z;step(car,{...coast,throttle:Math.max(-1,Math.min(1,(1.5-car.speed)*2)),steer:1});dist+=Math.hypot(car.x-x,car.z-z);}
 // Radius of the outside front tyre's outer sidewall, measured from the integrated centre path.
 const radius=dist/(car.heading-before);return {diameter:2*(Math.hypot(radius+spec.track/2,spec.wheelbase/2)+.179),yaw:car.heading-before, speed:car.speed, surface:car.surfaceName, pitch:car.pitch, position:[car.x,car.z],start:p};}
function topSpeed(spec){const car=v(spec);const p=at(hwy,flat.s);car.place(p.x,p.z,p.heading);let s=200,peak=0,levelPeak=0,off=0;const start=at(hwy,s);car.place(start.x,start.z,start.heading);for(let i=0;i<120*180&&s<hwy.length-20;i++){
 s+=drive(car,hwy,s,Infinity);const q=at(hwy,s),r=at(hwy,s+10),grade=Math.abs(terrain.heightAt(r.x,r.z)-terrain.heightAt(q.x,q.z))/10;
 peak=Math.max(peak,car.speed*3.6);if(grade<.01)levelPeak=Math.max(levelPeak,car.speed*3.6);off=Math.max(off,Math.hypot(car.x-q.x,car.z-q.z));}return {peak,levelPeak,off};}
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function washboard(spec,target=40,start=2400){const car=v(spec);const p=at(mines,start);car.place(p.x,p.z,p.heading);Math.random=random(0x54525543);setSpeed(car,target/3.6);let s=start,maxError=0,maxSide=0,maxRoadDistance=0,seconds=0,shake=0,heave=0,count=0,nearTarget=0,minSpeed=Infinity,maxSpeed=0;
 for(let i=0;i<120*30;i++){const q=at(mines,s),r=at(mines,s+Math.max(7,car.speed*.6)),dx=r.x-car.x,dz=r.z-car.z,skip=Math.max(.28,Math.min(1,1-(Math.abs(car.speed)-5)/15)),lock=Math.min(spec.maxSteer,Math.atan(spec.wheelbase*spec.gripLock*.6*skip*9.81/Math.max(car.speed*car.speed,4))),angle=Math.atan2(2*spec.wheelbase*Math.sin(wrap(Math.atan2(dx,-dz)-car.heading)),Math.max(1,Math.hypot(dx,dz))),steer=Math.max(-1,Math.min(1,angle/lock));step(car,{...coast,steer,throttle:Math.max(-1,Math.min(1,0.6+(target/3.6-car.speed)*1.5))});s+=Math.max(0,car.speed)*dt;maxRoadDistance=Math.max(maxRoadDistance,roads.nearest(car.x,car.z,30)?.dist??30);maxError=Math.max(maxError,Math.abs(wrap(car.heading-q.heading)));maxSide=Math.max(maxSide,Math.hypot(car.x-q.x,car.z-q.z));if(car.surfaceName==='washboard'){if(car.speed*3.6>=target-.5&&car.speed*3.6<=target+2)nearTarget+=dt;if(i>240){minSpeed=Math.min(minSpeed,car.speed*3.6);maxSpeed=Math.max(maxSpeed,car.speed*3.6);}seconds+=dt;shake+=Math.abs(car.car.body.rotation.z);heave+=Math.abs(car.car.body.position.y);count++;}}
 return {maxError,maxSide,maxRoadDistance,seconds,nearTarget,minSpeed,maxSpeed,meanShake:shake/Math.max(1,count),meanHeave:heave/Math.max(1,count)};}

const point=yard.world(SLIP_RAMP.u,SLIP_RAMP.v);yard.rampBase=terrain.heightAt(point.x,point.z);
// Gravel and track runs use real tagged road centrelines. Nothing changes their sampled surface.
async function looseSection(kind){
 const choices=roads.roads.filter(r=>r.kind===kind&&!r.bridge).map(r=>({r,path:line(r.pts)})).filter(c=>c.path.length>300).sort((a,b)=>b.path.length-a.path.length);
 for(const c of choices){await preload(terrain,samples(c.path,0,c.path.length),120);for(let start=30;start<c.path.length-240;start+=40){const p=at(c.path,start),q=at(c.path,start+180),surface=terrain.surfaceAt(p.x,p.z);if(!surface.washboard&&Math.abs(terrain.heightAt(p.x,p.z)-terrain.heightAt(q.x,q.z))<2)return {...c,start};}}
 throw Error('No usable loose section '+kind);
}
const gravelSection=await looseSection(3),trackSection=await looseSection(4);
function looseAcceleration(spec,section){const car=v(spec),p=at(section.path,section.start);car.place(p.x,p.z,p.heading);let s=section.start,time=0,names=new Set();for(;time<25&&car.speed<80/3.6;time+=dt){s+=drive(car,section.path,s,Infinity);names.add(car.surfaceName);}return {seconds:time,surfaces:[...names],speed:car.speed*3.6};}
function jump(spec){const car=v(spec),r=SLIP_RAMP,p=yard.world(r.u+47,r.v);car.place(p.x,p.z,yard.heading(-1,0));let launch=null,land=null,maxCompression=0,maxYaw=0,maxVy=0,lastSpeed=0;for(let i=0;i<120*9;i++){step(car,{...coast,throttle:1});const a=r.u-yard.local(car.x,car.z).u;maxVy=Math.max(maxVy,Math.abs(car.vy));maxYaw=Math.max(maxYaw,Math.abs(wrap(car.heading-yard.heading(-1,0))));if(a>r.lead+r.length-2&&car.airborne&&!launch)launch={a,speed:car.speed,y:car.y,time:i*dt};if(launch&&!car.airborne&&!land&&a>r.lead+r.length+spec.halfLength)land={a,speed:car.speed,before:lastSpeed,time:i*dt};maxCompression=Math.max(maxCompression,car.landingCompression);lastSpeed=car.speed;if(land&&i*dt>land.time+.3)break;}
return {launch,land,distance:land&&launch?land.a-launch.a:0,retained:land?land.speed/land.before:0,maxCompression,maxYaw,maxVy,maxTravel:car.car.maxTravel??0,minTravel:car.car.minTravel??0};}
function slide(spec){const car=v(spec),p=at(gravelSection.path,gravelSection.start);car.place(p.x,p.z,p.heading);setSpeed(car,15);let yaw=0,maxSlip=0,minSpeed=Infinity,maxRoadDistance=0,s=gravelSection.start;const surfaces=new Set();for(let i=0;i<120*4;i++){
 if(i<96){step(car,{...coast,throttle:1,steer:i<45?.85:-.18,handbrake:i<30});s+=car.speed*dt;}else s+=drive(car,gravelSection.path,s,Infinity);
 yaw=Math.max(yaw,Math.abs(wrap(car.heading-p.heading)));maxSlip=Math.max(maxSlip,Math.abs(car.vx*Math.cos(car.heading)+car.vz*Math.sin(car.heading)));minSpeed=Math.min(minSpeed,car.speed);maxRoadDistance=Math.max(maxRoadDistance,roads.nearest(car.x,car.z,30)?.dist??30);surfaces.add(car.surfaceName);
 }return {yaw,maxSlip,recoveredSlip:Math.abs(car.vx*Math.cos(car.heading)+car.vz*Math.sin(car.heading)),speed:car.speed*3.6,minSpeed:minSpeed*3.6,surfaces:[...surfaces],maxRoadDistance};}
const measured={paved80:Object.fromEntries([['car',CAR_SPEC],['truck',TRUCK_SPEC],['sxs',SXS_SPEC]].map(([id,s])=>[id,acceleration(s,80)])),acceleration:acceleration(SXS_SPEC),top:topSpeed(SXS_SPEC),turning:turning(SXS_SPEC),
 gravel:Object.fromEntries([['car',CAR_SPEC],['truck',TRUCK_SPEC],['sxs',SXS_SPEC]].map(([id,s])=>[id,looseAcceleration(s,gravelSection)])),
 track:Object.fromEntries([['car',CAR_SPEC],['sxs',SXS_SPEC]].map(([id,s])=>[id,looseAcceleration(s,trackSection)])),
 wash40:washboard(SXS_SPEC,40),carWash40:washboard(CAR_SPEC,40),wash60:washboard(SXS_SPEC,60),carWash60:washboard(CAR_SPEC,60),
 jump:jump(SXS_SPEC),carJump:jump(CAR_SPEC),slide:slide(SXS_SPEC),sections:{gravel:{id:gravelSection.r.id,start:gravelSection.start},track:{id:trackSection.r.id,start:trackSection.start}}};
console.log('SXS MEASURED',JSON.stringify(measured));
if(process.argv.includes('--explore'))process.exit(0);
const checks={
 level:()=>sectionGrade(flat.s)<.012,
 acceleration:()=>measured.acceleration>=4.5&&measured.acceleration<=5.5,
 top:()=>measured.top.levelPeak>=135&&measured.top.peak<=145&&measured.top.off<2,
 turning:()=>measured.turning.yaw>6&&measured.turning.diameter>=10&&measured.turning.diameter<=11.5,
 gravel:()=>measured.gravel.sxs.surfaces.join()==='gravel'&&measured.gravel.sxs.seconds<Math.min(measured.gravel.car.seconds,measured.gravel.truck.seconds)*.8&&measured.gravel.sxs.seconds/measured.paved80.sxs<measured.gravel.car.seconds/measured.paved80.car*.95,
 track:()=>measured.track.sxs.surfaces.join()==='dirt track'&&measured.track.sxs.seconds<measured.track.car.seconds*.7,
 wash40:()=>measured.wash40.seconds>29&&measured.wash40.nearTarget>25&&measured.wash40.maxRoadDistance+SXS_SPEC.halfWidth<2.6&&measured.wash40.meanShake<measured.carWash40.meanShake*.6&&measured.wash40.meanHeave<measured.carWash40.meanHeave*.4,
 wash60:()=>measured.wash60.seconds>29&&measured.wash60.nearTarget>15&&measured.wash60.minSpeed>57&&measured.wash60.maxRoadDistance+SXS_SPEC.halfWidth<2.6&&measured.wash60.meanShake<measured.carWash60.meanShake*.7&&measured.wash60.meanHeave<measured.carWash60.meanHeave*.4,
 jump:()=>measured.jump.distance>measured.carJump.distance*1.2&&measured.jump.land&&measured.jump.maxYaw<.05,
 landing:()=>measured.jump.retained>measured.carJump.retained+.04&&measured.jump.maxCompression>.08&&measured.jump.maxTravel>.10&&measured.jump.minTravel<-.15,
 slide:()=>measured.slide.surfaces.join()==='gravel'&&measured.slide.maxSlip>.5&&measured.slide.yaw<.6&&measured.slide.recoveredSlip<.1&&measured.slide.speed>60&&measured.slide.maxRoadDistance<2.4,
 garage:()=>readVehicle(new URLSearchParams('vehicle=sxs')).spec===SXS_SPEC&&readVehicle(new URLSearchParams()).id==='car'&&readVehicle(new URLSearchParams('vehicle=truck')).spec===TRUCK_SPEC,
};
for(const [name,test]of Object.entries(checks))assert.ok(test(),name);
const reject=(name,run,predicate)=>{const result=run();assert.ok(!predicate(result),`mutation rejected ${name}: ${JSON.stringify(result)}`);console.log('MUTATION rejected',name);};
const inRange=n=>n>=4.5&&n<=5.5;
reject('engine acceleration',()=>acceleration({...SXS_SPEC,engineAcceleration:2}),inRange);
reject('top power',()=>topSpeed({...SXS_SPEC,enginePower:30}),n=>n.levelPeak>=135&&n.peak<=145);
reject('steering lock',()=>turning({...SXS_SPEC,maxSteer:.4}),n=>n.diameter>=10&&n.diameter<=11.5);
reject('gravel traction',()=>looseAcceleration({...SXS_SPEC,tractionShare:.2},gravelSection),n=>n.surfaces.join()==='gravel'&&n.seconds<Math.min(measured.gravel.car.seconds,measured.gravel.truck.seconds)*.8);
reject('track traction',()=>looseAcceleration({...SXS_SPEC,tractionShare:.2},trackSection),n=>n.surfaces.join()==='dirt track'&&n.seconds<measured.track.car.seconds*.7);
for(const target of [40,60]) {
 const car=target===40?measured.carWash40:measured.carWash60;
 reject(`washboard ${target} body`,()=>washboard({...SXS_SPEC,shakeRoll:.3},target),n=>n.meanShake<car.meanShake*(target===40?.6:.7));
 reject(`washboard ${target} heave`,()=>washboard({...SXS_SPEC,shakeHeight:.4},target),n=>n.meanHeave<car.meanHeave*.4);
 reject(`washboard ${target} wandering`,()=>washboard({...SXS_SPEC,washboardYaw:4},target),n=>n.seconds>29&&n.maxRoadDistance+SXS_SPEC.halfWidth<2.6);
 reject(`washboard ${target} speed retention`,()=>washboard({...SXS_SPEC,tractionShare:.2},target),n=>n.nearTarget>(target===40?25:15));
}
reject('ramp launch power',()=>jump({...SXS_SPEC,engineAcceleration:2}),n=>n.distance>measured.carJump.distance*1.2);
reject('landing scrub',()=>jump({...SXS_SPEC,landingForward:.6}),n=>n.retained>measured.carJump.retained+.04);
reject('lateral momentum',()=>slide({...SXS_SPEC,lateralInertia:0}),n=>n.maxSlip>.5&&n.yaw<.6&&n.recoveredSlip<.1);
const sample=yard.world(230,80),motion=v();motion.place(sample.x,sample.z,0);motion.vy=-6;motion.y+=.4;motion.airborne=true;for(let i=0;i<60;i++)step(motion);assert.ok(motion.car.maxTravel>.05,'production controller calls travel on landing');
const broken=v();broken.car.setTravel=()=>{};broken.place(sample.x,sample.z,0);broken.vy=-6;broken.y+=.4;broken.airborne=true;for(let i=0;i<60;i++)step(broken);assert.ok(!(broken.car.maxTravel>.05),'mutation rejected: travel adapter disabled');
const idx=GARAGE.findIndex(e=>e.id==='sxs'),entry=GARAGE.splice(idx,1)[0];try{assert.equal(checks.garage(),false,'mutation rejected: missing garage entry');}finally{GARAGE.splice(idx,0,entry);}
const height=terrain.heightAt;try{terrain.heightAt=(x,z)=>height(x,z)*10;assert.equal(checks.level(),false,'mutation rejected: non-level pavement');}finally{terrain.heightAt=height;}
console.log('PASS fixed-step side by side on real land, every target and production mutations');

// Full posed geometry/post coverage is checked by sxs-check.mjs and check-sxs-round2.sh.
const gapped={...SXS_SPEC,envelope:{...SXS_SPEC.envelope,circles:[-1.3,1.3]}};
const post={x:1,z:0,half:.03,halfWidth:.03,heading:0};
assert.equal(touchesPlayer(post,{x:0,z:0,heading:0},0,gapped),false,'mutation rejected: collision circles leave a gap');
const missing={x:0,z:0,heading:0,vx:0,vz:0,speed:0,spec:gapped};pushOut(missing,[post]);assert.equal(Math.hypot(missing.x,missing.z),0,'mutation rejected: resolver leaves the same gap');
for(const x of [-1.12,1.12]){
 const props=new Props({crs:'EPSG:2961',mailboxes:[{x,y:0,heading:0,style:0,tilt:0,group:null,parcelBox:false}],communityBoxes:[],poles:[]},[0,0],terrain);
 props.hitCar(0,0,0,0,-3,0,0,SXS_SPEC);assert.equal(props.mail[0].motion.damage,2,'sweep covers the steered tyre');
 props.resetShift();props.hitCar(0,0,0,0,-3,0,0,{...SXS_SPEC,envelope:{...SXS_SPEC.envelope,sweepHalfWidth:.8}});assert.equal(props.mail[0].motion.damage,0,'mutation rejected: narrow post sweep');
}
assert.ok(SXS_SPEC.envelope.nose>=SXS_SPEC.halfLength+.8,'barricade clears the nose');
const tight={...SXS_SPEC.envelope,nose:1};assert.equal(tight.nose>=SXS_SPEC.halfLength+.8,false,'mutation rejected: barricade clips the nose');
console.log('PASS continuous side/post coverage, steered-tyre sweep and barricade clearance with mutations');
