// Fixed 1/120 s production Vehicle on the baked Mabou land; no invented flat height field.
import assert from 'node:assert/strict';
import { Vehicle } from '../web/src/vehicle.ts';
import { TRUCK_SPEC,createTruck } from '../web/src/truck.ts';
import { GARAGE, readVehicle } from '../web/src/garage.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { ArchCulvert } from '../web/src/culvert.ts';
import { YardSite } from '../web/src/yard-site.ts';
import { pushOut } from '../web/src/parked.ts';
import { Props } from '../web/src/props.ts';
import { RoadScene } from '../web/src/road-scene.ts';
import { touchesPlayer } from '../web/src/road-scene-rules.ts';
import { makeGround,preload } from './phone-ground.mjs';
const {terrain,roads}=makeGround(),dt=1/120,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const line=pts=>{const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return{pts,cum,length:cum.at(-1)};};
function at(p,s){let i=1;s=Math.max(0,Math.min(s,p.length));while(i<p.cum.length-1&&p.cum[i]<s)i++;const a=p.pts[i-1],b=p.pts[i],t=(s-p.cum[i-1])/(p.cum[i]-p.cum[i-1]||1);return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};}
const hwy=line(roads.roads.find(r=>r.id===25).pts),mines=line(roads.roads.find(r=>r.id===55).pts);
const samples=(p,a,b)=>{const pts=[];for(let s=a;s<=b;s+=20){const q=at(p,s);pts.push([q.x,q.z]);}return pts;};
const yard=new YardSite(terrain.manifest.village,'invented');terrain.sites.push(yard);
await preload(terrain,samples(hwy,0,hwy.length),150);await preload(terrain,samples(mines,1800,3100),120);await preload(terrain,[Object.values(yard.world(230,80))],180);
function v(spec=TRUCK_SPEC){const car=new Vehicle(createTruck(),terrain,roads,-.2,spec);car.assist=0;return car;}
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
function acceleration(spec){const car=v(spec);car.place(flat.a.x,flat.a.z,flat.a.heading);let s=flat.s,time=0;for(;time<15&&car.speed<100/3.6;time+=dt)s+=drive(car,hwy,s,Infinity);return time;}
function braking(spec){const results=[];for(const direction of [1,-1]){const car=v(spec),p=at(hwy,flat.s+(direction<0?100:0));car.place(p.x,p.z,p.heading+(direction<0?Math.PI:0));setSpeed(car,100/3.6);let distance=0;for(let i=0;i<120*15&&car.speed>.05;i++){const x=car.x,z=car.z;step(car,{...coast,throttle:-1});distance+=Math.hypot(car.x-x,car.z-z);}results.push(distance);}return {runs:results,mean:(results[0]+results[1])/2};}
function turning(spec){const car=v(spec),p=yard.world(230,80);car.place(p.x,p.z,0);car.steerAngle=spec.maxSteer;setSpeed(car,1.5);const before=car.heading;
 let dist=0;for(let i=0;i<120*45&&car.heading-before<Math.PI*2;i++){const x=car.x,z=car.z;step(car,{...coast,throttle:Math.max(-1,Math.min(1,(1.5-car.speed)*2)),steer:1});dist+=Math.hypot(car.x-x,car.z-z);}
 // Radius of the outside front tyre's outer sidewall, measured from the integrated centre path.
 const radius=dist/(car.heading-before);return {diameter:2*(Math.hypot(radius+spec.track/2,spec.wheelbase/2)+.148),yaw:car.heading-before, speed:car.speed, surface:car.surfaceName, pitch:car.pitch, position:[car.x,car.z],start:p};}
function topSpeed(spec){const car=v(spec);const p=at(hwy,flat.s);car.place(p.x,p.z,p.heading);let s=200,peak=0,levelPeak=0,off=0;const start=at(hwy,s);car.place(start.x,start.z,start.heading);for(let i=0;i<120*180&&s<hwy.length-20;i++){
 s+=drive(car,hwy,s,Infinity);const q=at(hwy,s),r=at(hwy,s+10),grade=Math.abs(terrain.heightAt(r.x,r.z)-terrain.heightAt(q.x,q.z))/10;
 peak=Math.max(peak,car.speed*3.6);if(grade<.01)levelPeak=Math.max(levelPeak,car.speed*3.6);off=Math.max(off,Math.hypot(car.x-q.x,car.z-q.z));}return {peak,levelPeak,off};}
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
function washboard(spec,start=1800){const car=v(spec);const p=at(mines,start);car.place(p.x,p.z,p.heading);Math.random=random(0x54525543);setSpeed(car,40/3.6);let s=start,maxError=0,maxSide=0,seconds=0,shake=0,count=0,nearForty=0,minSpeed=Infinity,maxSpeed=0;
 for(let i=0;i<120*30;i++){const q=at(mines,s),r=at(mines,s+Math.max(7,car.speed*.6)),dx=r.x-car.x,dz=r.z-car.z,skip=Math.max(.28,Math.min(1,1-(Math.abs(car.speed)-5)/15)),lock=Math.min(spec.maxSteer,Math.atan(spec.wheelbase*spec.gripLock*.6*skip*9.81/Math.max(car.speed*car.speed,4))),angle=Math.atan2(2*spec.wheelbase*Math.sin(wrap(Math.atan2(dx,-dz)-car.heading)),Math.max(1,Math.hypot(dx,dz))),steer=Math.max(-1,Math.min(1,angle/lock));step(car,{...coast,steer,throttle:Math.max(-1,Math.min(1,0.6+(40/3.6-car.speed)*1.5))});s+=Math.max(0,car.speed)*dt;maxError=Math.max(maxError,Math.abs(wrap(car.heading-q.heading)));maxSide=Math.max(maxSide,Math.hypot(car.x-q.x,car.z-q.z));if(car.surfaceName==='washboard'){if(car.speed*3.6>=39.5&&car.speed*3.6<=42)nearForty+=dt;if(i>240){minSpeed=Math.min(minSpeed,car.speed*3.6);maxSpeed=Math.max(maxSpeed,car.speed*3.6);}seconds+=dt;shake+=Math.abs(car.car.body.rotation.z);count++;}}
 return {maxError,maxSide,seconds,nearForty,minSpeed,maxSpeed,meanShake:shake/Math.max(1,count)};}
const measured={acceleration:acceleration(TRUCK_SPEC),braking:braking(TRUCK_SPEC),turning:turning(TRUCK_SPEC),top:topSpeed(TRUCK_SPEC),wash:washboard(TRUCK_SPEC),carWash:washboard(CAR_SPEC)};
console.log('MEASURED',JSON.stringify(measured));
if(process.argv.includes('--explore'))process.exit(0);
assert.ok(flat.maxGrade<.012,'real pavement section is level within 1.2 percent');
const heightReader=terrain.heightAt;try{terrain.heightAt=(x,z)=>heightReader(x,z)*10;assert.ok(sectionGrade(flat.s)>=.012,'mutation rejected: steep pavement section');}finally{terrain.heightAt=heightReader;}
assert.ok(measured.acceleration>=7&&measured.acceleration<=8.5,'0–100 km/h in 7–8.5 s');
assert.ok(measured.top.levelPeak>=165&&measured.top.peak<=180,'top speed on real highway 165–180 km/h');
assert.ok(measured.turning.yaw>6&&measured.turning.diameter>=15&&measured.turning.diameter<=17,'kerb turning diameter 15–17 m');
assert.ok(measured.braking.runs.every(d=>d>=45&&d<=60),'100–0 km/h in 45–60 m in both directions');
assert.ok(measured.wash.seconds>20&&measured.wash.nearForty>5&&measured.wash.maxSpeed>=40&&measured.wash.maxError<.3&&measured.wash.maxSide<.5,'40 km/h washboard: no swing, spin or off-road excursion');
assert.ok(measured.wash.meanShake<measured.carWash.meanShake,'calmer body on the same seeded gravel drive');
// All original tunable numbers are checked independently of CAR_SPEC and of Vehicle's implementation.
const original={wheelbase:2.62,track:1.57,wheelRadius:.35,contactPlane:0,halfLength:2.3,halfWidth:.95,height:1.955,envelope:{circles:[-1.35,0,1.35],radius:.95,reach:3.4,sweepHalfWidth:.96,sweepHalfLength:2.31,overhead:1.3,grassHalfWidth:1.35,grassHalfLength:2.8,nose:3.2},engineAcceleration:4.8,enginePower:95,tractionShare:.62,reverseSpeed:9,reverseAcceleration:2.6,brake:9.5,handbrake:5.5,aeroDrag:.001,cornering:1.7,maxSteer:.6,steerBaseRate:.5,steerSpeedRate:2.2,steerSpeedScale:7,steerReturnRate:3.2,gripLock:1.15,landingForward:.92,landingSideways:.6,pitchGain:.006,pitchLimit:.035,rollGain:.007,rollLimit:.06,leanRate:6,shakePitch:.02,shakeRoll:.03,shakeHeight:.04,washboardYaw:.02,washboardSideways:.5,hardSteerDrag:3.2,chase:{back:7.4,height:2.9,lookAhead:3.5,lookHeight:1.25,speedBack:.06,maxSpeedBack:2.5}};
assert.deepEqual(CAR_SPEC,original,'CAR_SPEC exactly equals original constants');
assert.equal(readVehicle(new URLSearchParams()).id,'car','default garage entry is car');
assert.equal(readVehicle(new URLSearchParams('vehicle=unknown')).id,'car','unknown garage id falls back to car');
assert.equal(readVehicle(new URLSearchParams('vehicle=truck')).spec,TRUCK_SPEC,'truck garage entry carries its spec');
const defaultEntry=GARAGE[0];try{GARAGE[0]=GARAGE[1];assert.notEqual(readVehicle(new URLSearchParams()).id,'car','mutation rejected: wrong default vehicle');assert.notEqual(readVehicle(new URLSearchParams('vehicle=unknown')).id,'car','mutation rejected: wrong fallback vehicle');}finally{GARAGE[0]=defaultEntry;}
const truckIndex=GARAGE.findIndex(e=>e.id==='truck'),[entry]=GARAGE.splice(truckIndex,1);try{assert.notEqual(readVehicle(new URLSearchParams('vehicle=truck')).spec,TRUCK_SPEC);console.log('MUTATION rejected missing garage entry');}finally{GARAGE.splice(truckIndex,0,entry);}
// Real production faults, exercised through the same runs; no tracked source file is changed.
const reject=(name,run,test)=>{assert.ok(!test(run()),`mutation rejected: ${name}`);console.log('MUTATION rejected',name);};
reject('acceleration cap',()=>acceleration({...TRUCK_SPEC,engineAcceleration:2}),n=>n>=7&&n<=8.5);
reject('power',()=>topSpeed({...TRUCK_SPEC,enginePower:20}),n=>n.levelPeak>=165&&n.peak<=180);
reject('steering lock',()=>turning({...TRUCK_SPEC,maxSteer:.4}),n=>n.diameter>=15&&n.diameter<=17);
reject('brakes',()=>braking({...TRUCK_SPEC,brake:3}),n=>n.runs.every(d=>d>=45&&d<=60));
reject('washboard yaw',()=>washboard({...TRUCK_SPEC,washboardYaw:4}),n=>n.seconds>5&&n.maxError<.3&&n.maxSide<4);
reject('body shake',()=>washboard({...TRUCK_SPEC,shakeRoll:.3}),n=>n.meanShake<measured.carWash.meanShake);
assert.throws(()=>assert.deepEqual({...CAR_SPEC,enginePower:0},original));console.log('MUTATION rejected car constants');
// Wide/long footprint regression: obstacle beyond the car's envelope must stop a truck before its body enters.
for(const [x,z]of [[1.75,0],[0,-3.8]]){const car=v(),p=yard.world(230,80);car.place(p.x,p.z,0);setSpeed(car,2);const solid={x:car.x+x,z:car.z+z,half:.6,halfWidth:.6,heading:0};const before=[car.x,car.z];assert.ok(touchesPlayer(solid,car,0,car.spec));assert.equal(touchesPlayer(solid,car,0,CAR_SPEC),false,'mutation rejected: small collision envelope');pushOut(car,[solid]);assert.ok(Math.hypot(car.x-before[0],car.z-before[1])>.01,'truck spec drives collision envelope');const spec=car.spec;try{car.spec=CAR_SPEC;car.place(before[0],before[1],0);pushOut(car,[solid]);assert.ok(Math.hypot(car.x-before[0],car.z-before[1])<=.01,'mutation rejected: solid resolver uses car footprint');}finally{car.spec=spec;}}
// The car keeps the exact collision literals it had before there was a spec (2.3 + .01 is not 2.31 in floating point).
{const props=new Props({crs:'EPSG:2961',mailboxes:[{x:0,y:2.31,heading:0,style:0,tilt:0,group:null,parcelBox:false}],communityBoxes:[],poles:[]},[0,0],terrain);
 props.hitCar(0,0,0,0,-3,0,0,CAR_SPEC);assert.equal(props.mail[0].motion.damage,2,'car reaches a post exactly 2.31 m ahead, as before the spec');
 const edge={x:0,z:-(1.35+.95+.5)+1e-9,half:.5,halfWidth:.5,heading:0};assert.ok(touchesPlayer(edge,{x:0,z:0,heading:0}),'car front circle is at 1.35 m with radius 0.95 m');
 const car={x:0,z:0,heading:0,vx:0,vz:0,speed:0};pushOut(car,[{x:.6,z:-1.35,half:.5,halfWidth:.5,heading:0}]);assert.equal(car.x,-(.95-(.6-.5)),'car push-out distance uses the old literals');}
// The truck circles leave no gap along the body: a thin post 1 m out touches anywhere along either side. (The last 0.5 m at each end is a rounded corner, as on the car.)
for(let along=-2.9;along<=2.9;along+=.05)for(const side of [-1,1]){const post={x:side,z:-along,half:.1,halfWidth:.1,heading:0};
 assert.ok(touchesPlayer(post,{x:0,z:0,heading:0},0,TRUCK_SPEC),`truck envelope covers its side at ${along.toFixed(2)} m`);
 const t={x:0,z:0,heading:0,vx:0,vz:0,speed:0,spec:TRUCK_SPEC};pushOut(t,[post]);assert.ok(Math.hypot(t.x,t.z)>0,`solid at ${along.toFixed(2)} m pushes the truck`);}
// Round 2 of review: a 20 cm post that enters the dual fender beside the rear axle (truck heading 0, so behind is +z).
for(let z=1.45;z<=2.2;z+=.0125){const post={x:1.3,z,half:.1,halfWidth:.1,heading:0};for(const side of [-1,1]){const q={...post,x:side*1.3};
 assert.ok(touchesPlayer(q,{x:0,z:0,heading:0},0,TRUCK_SPEC),`fender post at ${z.toFixed(3)} m touches`);
 const t={x:0,z:0,heading:0,vx:0,vz:0,speed:0,spec:TRUCK_SPEC};pushOut(t,[q]);assert.ok(Math.hypot(t.x,t.z)>0,`fender post at ${z.toFixed(3)} m pushes the truck`);}}
{const seven={...TRUCK_SPEC,envelope:{...TRUCK_SPEC.envelope,circles:[-2.18,-1.453,-0.727,0,0.727,1.453,2.18]}};assert.equal(touchesPlayer({x:1.3,z:1.8165,half:.1,halfWidth:.1,heading:0},{x:0,z:0,heading:0},0,seven),false,'mutation rejected: seven circles leave the fender gap');}
{const three={...TRUCK_SPEC,envelope:{...TRUCK_SPEC.envelope,circles:[-2.18,0,2.18]}};assert.equal(touchesPlayer({x:1,z:-1.09,half:.1,halfWidth:.1,heading:0},{x:0,z:0,heading:0},0,three),false,'mutation rejected: three circles leave a gap');}
assert.ok(TRUCK_SPEC.envelope.nose>=TRUCK_SPEC.halfLength+.8&&CAR_SPEC.envelope.nose===3.2,'the map-edge barricade stands clear of each nose');
// Mailbox sweep uses the same active dimensions, including a post only the long/wide body reaches.
for(const [x,z] of [[1.16,0],[0,-3.1]]){
 const props=new Props({crs:'EPSG:2961',mailboxes:[{x,y:-z,heading:0,style:0,tilt:0,group:null,parcelBox:false}],communityBoxes:[],poles:[]},[0,0],terrain);
 props.hitCar(0,0,0,0,-3,0,0,CAR_SPEC);assert.equal(props.mail[0].motion.damage,0,'car misses truck-only mailbox');
 props.hitCar(0,0,0,0,-3,0,0,TRUCK_SPEC);assert.equal(props.mail[0].motion.damage,2,'truck body hits the post');
 props.resetShift();props.hitCar(0,0,0,0,-3,0,0,CAR_SPEC);assert.equal(props.mail[0].motion.damage,0,'mutation rejected: mailbox uses car footprint');
}
globalThis.addEventListener=()=>{};
const shift={career:{day:8},roadside:[],ended:false,complaints:{add(){}},elapsed:0};
const scene=new RoadScene(roads,terrain,shift,new URLSearchParams('scene=fish'));
await preload(terrain,[[scene.centre.x,scene.centre.z]],180);
let unsafePlacement=false;
for(const along of [-30,-8.49,0,30])for(const turn of [0,Math.PI/4,Math.PI/2,Math.PI]){
 scene.rules.truckAlong=along;scene.place();const car=v();car.placementGuard=p=>scene.allowPlacement(p,car.spec);
 const pose={x:0,z:0,heading:0};scene.road.at(along,0,pose);car.place(pose.x,pose.z,pose.heading+turn);
 assert.ok([scene.visitorCar,scene.truck].every(s=>!touchesPlayer(s,car,.349,car.spec)),'truck placement guard clears the full body');
 car.placementGuard=p=>scene.allowPlacement(p,CAR_SPEC);car.place(pose.x,pose.z,pose.heading+turn);unsafePlacement||=[scene.visitorCar,scene.truck].some(s=>touchesPlayer(s,car,.349,car.spec));
}
assert.ok(unsafePlacement,'mutation rejected: placement uses car footprint');
const archPlace=yard.world(230,80),arch=new ArchCulvert(archPlace.x,archPlace.z,0,3,(x,z)=>terrain.heightAt(x,z));
assert.ok(arch.seat(),'arch culvert seats on real yard ground');
const archGround=arch.ground;try{arch.ground=()=>null;assert.equal(arch.seat(),false,'mutation rejected: arch ground missing');}finally{arch.ground=archGround;}
const through=v();through.place(archPlace.x,archPlace.z+9,0);setSpeed(through,3);let archHit=0;
for(let i=0;i<120*8;i++){step(through,{...coast,throttle:Math.max(-1,Math.min(1,(3-through.speed)*2))});archHit=Math.max(archHit,pushOut(through,arch.solids));}
assert.ok(archHit===0&&through.z<archPlace.z-9,'truck drives through the placed arch without a wall contact');
arch.solids.push({x:archPlace.x,z:archPlace.z,heading:0,half:.5,halfWidth:5});
try{through.place(archPlace.x,archPlace.z+9,0);setSpeed(through,3);let hit=0;for(let i=0;i<120*8;i++){step(through,{...coast,throttle:Math.max(-1,Math.min(1,(3-through.speed)*2))});hit=Math.max(hit,pushOut(through,arch.solids));}assert.ok(!(hit===0&&through.z<archPlace.z-9),'mutation rejected: blocked arch passage');}finally{arch.solids.pop();}
through.place(archPlace.x+3.6,archPlace.z,0);const side=through.x;pushOut(through,arch.solids);assert.ok(through.x<side-.05,'arch walls stop the dual rear body');
const walls=arch.solids;try{arch.solids=[];through.place(archPlace.x+3.6,archPlace.z,0);const before=through.x;pushOut(through,arch.solids);assert.ok(!(through.x<before-.05),'mutation rejected: arch walls missing');}finally{arch.solids=walls;}
const spinning=v(),pose=yard.world(230,80);spinning.place(pose.x,pose.z,.4);setSpeed(spinning,2);step(spinning);
assert.ok(spinning.car.extraWheels.every(w=>w.rotation.x===spinning.car.wheels.rl.rotation.x)&&spinning.car.wheels.rl.rotation.x!==0,'both inner dual tyres spin with the rear axle');
spinning.car.extraWheels[0].rotation.x=0;assert.ok(!spinning.car.extraWheels.every(w=>w.rotation.x===spinning.car.wheels.rl.rotation.x),'mutation rejected: inner dual does not spin');spinning.car.extraWheels[0].rotation.x=spinning.car.wheels.rl.rotation.x;
const contacts=()=>spinning.groundContacts.every((p,i)=>{const dx=p.x-spinning.x,dz=p.z-spinning.z,a=dx*Math.sin(spinning.heading)-dz*Math.cos(spinning.heading),b=dx*Math.cos(spinning.heading)+dz*Math.sin(spinning.heading);return Math.abs(a-(i<2?1:-1)*4.45/2)<1e-9&&Math.abs(b-(i%2?1:-1)*(i<2?1.74:2.08)/2)<1e-9;});
spinning.captureGround();assert.ok(contacts(),'all four contacts use truck wheelbase and front/rear track');
const originalSpec=spinning.spec;try{spinning.spec={...originalSpec,wheelbase:2.62};spinning.captureGround();assert.ok(!contacts(),'mutation rejected: car axle spacing');}finally{spinning.spec=originalSpec;}
console.log('PASS truck fixed-step real-land physics, original car constants, full-body placement/mailbox contacts, dual spin/contacts and production mutations.');
