// Production fixed-step towing on baked land. Faults change live production state, then restore it.
import assert from 'node:assert/strict';
import {runRound3} from './trailer-round3.mjs';
if(process.env.TRAILER_ROUND3_ONLY==='1'){runRound3();process.exit(0);}
import {runSeamRegressions} from './trailer-seam.mjs';
if(!process.env.TRAILER_BASELINE)runSeamRegressions();
import {transformOracle} from './trailer-transform-oracle.mjs';
import { runRound2 } from './trailer-round2.mjs';
runRound2();
if(process.env.TRAILER_ROUND2_ONLY==='1')process.exit(0);
import { runTrailerRegressions } from './trailer-regressions.mjs';
runTrailerRegressions();
if(process.env.TRAILER_REGRESSIONS_ONLY==='1')process.exit(0);
import { Vehicle, autopilot } from '../web/src/vehicle.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { TRUCK_SPEC, createTruck } from '../web/src/truck.ts';
import { Towing } from '../web/src/towing.ts';
import { TRAILER_SPEC, createTrailer, rigCost } from '../web/src/trailer.ts';
import { YardSite } from '../web/src/yard-site.ts';
import { makeGround, preload } from './phone-ground.mjs';
const {terrain,roads}=makeGround(),dt=1/120,wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const line=pts=>{const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum.at(-1)+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));return{pts,cum,length:cum.at(-1)};};
function at(p,s){let i=1;s=Math.max(0,Math.min(s,p.length));while(i<p.cum.length-1&&p.cum[i]<s)i++;const a=p.pts[i-1],b=p.pts[i],t=(s-p.cum[i-1])/(p.cum[i]-p.cum[i-1]||1);return{x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,heading:Math.atan2(b[0]-a[0],a[1]-b[1])};}
const hwy=line(roads.roads.find(r=>r.id===25).pts),mines=line(roads.roads.find(r=>r.id===55).pts);
const samples=(p,a,b)=>{const pts=[];for(let s=a;s<=b;s+=20){const q=at(p,s);pts.push([q.x,q.z]);}return pts;};
const yard=new YardSite(terrain.manifest.village,'invented');terrain.sites.push(yard);
await preload(terrain,samples(hwy,0,hwy.length),150);await preload(terrain,samples(mines,1800,3100),120);await preload(terrain,[Object.values(yard.world(230,80))],180);
await preload(terrain,[[0,0]],60);
// Production rigs are also checked by transformOracle and browser rays.
function v(spec=TRUCK_SPEC){const car=new Vehicle(createTruck(),terrain,roads,-.2,spec);car.assist=0;car.tow=new Towing(car,terrain,roads,true);return car;}
const coast={throttle:0,steer:0,handbrake:false};
function setSpeed(car,speed){car.vx=Math.sin(car.heading)*speed;car.vz=-Math.cos(car.heading)*speed;car.speed=speed;}
function step(car,input=coast){terrain.withGroundContact(car,()=>car.update(dt,input,()=>car.tow?.step()));}
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
function acceleration(spec){const car=v(spec);car.place(flat.a.x,flat.a.z,flat.a.heading);let s=flat.s,time=0;for(;time<30&&car.speed<100/3.6;time+=dt)s+=drive(car,hwy,s,Infinity);return time;}
function braking(spec){const results=[];for(const direction of [1,-1]){const car=v(spec),p=at(hwy,flat.s+(direction<0?100:0));car.place(p.x,p.z,p.heading+(direction<0?Math.PI:0));setSpeed(car,100/3.6);let distance=0;for(let i=0;i<120*15&&car.speed>.05;i++){const x=car.x,z=car.z;step(car,{...coast,throttle:-1});distance+=Math.hypot(car.x-x,car.z-z);}results.push(distance);}return {runs:results,mean:(results[0]+results[1])/2};}
function topSpeed(spec){const car=v(spec);const p=at(hwy,flat.s);car.place(p.x,p.z,p.heading);let s=200,peak=0,levelPeak=0,off=0;const start=at(hwy,s);car.place(start.x,start.z,start.heading);for(let i=0;i<120*180&&s<hwy.length-20;i++){
 s+=drive(car,hwy,s,Infinity);const q=at(hwy,s),r=at(hwy,s+10),grade=Math.abs(terrain.heightAt(r.x,r.z)-terrain.heightAt(q.x,q.z))/10;
 peak=Math.max(peak,car.speed*3.6);if(grade<.01)levelPeak=Math.max(levelPeak,car.speed*3.6);off=Math.max(off,Math.hypot(car.x-q.x,car.z-q.z));}return {peak,levelPeak,off};}
const random=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};

if(process.env.TRAILER_TRANSFORMS_ONLY==='1'){await transformOracle(terrain,roads,flat.a);process.exit(0);}
const measured={acceleration:acceleration(TRUCK_SPEC),braking:braking(TRUCK_SPEC),top:topSpeed(TRUCK_SPEC)};
console.log('MEASURED',JSON.stringify(measured));
if(process.argv.includes('--explore'))process.exit(0);
const loadedAccelerationOK = n => n>=6&&n<=7.5;
assert.ok(loadedAccelerationOK(measured.acceleration),'loaded 0–100: 6–7.5 s');
assert.ok(measured.braking.runs.every(d=>d>=60&&d<=80),'loaded 100–0: 60–80 m');
assert.ok(measured.top.levelPeak>=140&&measured.top.peak<=160,'loaded top speed: 140–160 km/h');
const model=createTrailer(true);assert.ok(model.triangles<=47000&&model.drawCalls<=38&&model.chassisCost.triangles<=14000&&model.chassisCost.drawCalls===8,'real cargo and unchanged chassis budgets');console.log('MODEL',model.triangles,model.drawCalls);
function covered(root,envelope){root.updateMatrixWorld(true);let worst=0;root.traverse(n=>{if(!n.isMesh)return;const pos=n.geometry.attributes.position;for(let i=0;i<pos.count;i++){const p={x:pos.getX(i),y:pos.getY(i),z:pos.getZ(i)};const e=n.matrixWorld.elements,x=e[0]*p.x+e[4]*p.y+e[8]*p.z+e[12],z=e[2]*p.x+e[6]*p.y+e[10]*p.z+e[14],a=-(z-TRAILER_SPEC.bodyOffset);worst=Math.max(worst,Math.min(...envelope.circles.map(c=>Math.hypot(x,a-c)))-envelope.radius);}});return worst;}
assert.ok(covered(model.root,TRAILER_SPEC.envelope)<1e-6,'collision circles cover every drawn trailer/cargo vertex');
const shortEnvelope={...TRAILER_SPEC.envelope,circles:[-2.75,0,2.75]};assert.ok(covered(model.root,shortEnvelope)>.05,'mutation rejected: three-circle trailer leaves drawn corners uncovered');


function reverse(help,sloppy,turn){
 const car=v(),tow=car.tow; tow.help=help;
 const origin=yard.world(240,90),heading=yard.heading(1,0),fx=Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=Math.sin(heading);
 // Place the axle at the chosen start. The bay is a 4 m wide corridor, measured about its centre line.
 car.place(origin.x+fx*9,origin.z+fz*9,heading);car.steerAngle=0;
 const start={x:tow.x,z:tow.z},rng=random(42),R=14,arc=R*Math.PI/2,length=turn?5+arc+10:30;
 let progress=0,maxError=0,peakAngle=0,steps=0,noise=0;
 for(;steps<120*120&&progress<length;steps++){
   const a=turn?Math.max(0,Math.min(Math.PI/2,(progress-5)/R)):0;
   const dx=turn?(progress<5?0:progress<5+arc?-R*(1-Math.cos(a)):-R-(progress-5-arc)):0;
   const dz=turn?(progress<5?progress:progress<5+arc?5+R*Math.sin(a):5+R):progress;
   const targetX=start.x+rx*dx-fx*dz,targetZ=start.z+rz*dx-fz*dz;
   const error=(tow.x-targetX)*(rx*Math.cos(a)-fx*Math.sin(a))+(tow.z-targetZ)*(rz*Math.cos(a)-fz*Math.sin(a));
   maxError=Math.max(maxError,Math.abs(error));peakAngle=Math.max(peakAngle,Math.abs(tow.angle));
   const headingError=wrap(heading+a-tow.heading);
   const curvature=turn&&progress>=5&&progress<5+arc?1/R:0;
   const desiredRate=1.5*(curvature+headingError*.6+error*.08);
   if(steps%18===0)noise=(rng()-.5)*.26;
   let steer;
   if(help){steer=-(curvature+headingError*.6+error*.08)/.075; if(sloppy)steer+=noise+.025*Math.sin(steps*.021);}
   else{
     const desiredAngle=Math.asin(Math.max(-.65,Math.min(.65,-desiredRate*TRAILER_SPEC.drawbar/1.5)));
     const yaw=desiredRate-wrap(tow.angle-desiredAngle)*1.0;
     steer=Math.atan(yaw*car.spec.wheelbase/-1.5)/car.spec.maxSteer;
     if(sloppy)steer+=noise+.06;
   }
   const before={x:tow.x,z:tow.z};
   step(car,{throttle:Math.max(-1,Math.min(1,(-1.5-car.speed)*2)),steer:Math.max(-1,Math.min(1,steer)),handbrake:false,touch:help});
   progress+=Math.max(0,-(tow.x-before.x)*Math.sin(heading+a)-(tow.z-before.z)*-Math.cos(heading+a));
 }
 const dx=(tow.x-start.x)*rx+(tow.z-start.z)*rz,dz=-(tow.x-start.x)*fx-(tow.z-start.z)*fz;
 const error=turn?Math.abs(dz-(5+R)):Math.abs(dx);
 return{help,sloppy,turn,progress,error,maxError,peakAngle,steps,headingError:wrap(tow.heading-heading-(turn?Math.PI/2:0)),clunks:tow.clunks};
}
const reversing=[];for(const help of [true,false])for(const sloppy of [false,true])for(const turn of [false,true]){const r=reverse(help,sloppy,turn);reversing.push(r);console.log('REVERSE',JSON.stringify(r));}
if(process.argv.includes('--reverse'))process.exit(0);
for(const r of reversing)if(r.help||!r.sloppy){assert.ok(r.progress>=(r.turn?36.9:29.9)&&r.error<=.6&&r.maxError<.7,'reverse straight/90-degree bay: centre line within .6 m');assert.equal(r.clunks,0,'help/perfect driver avoids jackknife');}
// The detached constructor must not change one bit of the truck's production path or consume randomness.
function path(detached,Kind=Vehicle,route=hwy,start=flat.s,count=1800){const old=Math.random;Math.random=random(775);try{const car=new Kind(createTruck(),terrain,roads,-.2,TRUCK_SPEC);car.assist=0;const p=at(route,start);car.place(p.x,p.z,p.heading);if(detached)new Towing(car,terrain,roads,true,false,{},false);const states=[];for(let i=0;i<count;i++){terrain.withGroundContact(car,()=>car.update(dt,{throttle:i<1200?1:-1,steer:Math.sin(i*.01)*.1,handbrake:false}));states.push([car.x,car.z,car.heading,car.vx,car.vz,car.vy,car.y,car.speed]);}return states;}finally{Math.random=old;}}
const plain=path(false),detached=path(true);assert.deepEqual(detached,plain,'detached construction: truck path bit identity');
if(process.env.TRAILER_TRUCK_ORACLE){
 const{Vehicle:Stock,autopilot:stockAutopilot}=await import(process.env.TRAILER_TRUCK_ORACLE);
 assert.deepEqual(path(false,Stock),plain,'standalone truck physics remains bit-identical to landed seam 450f4c3');
 const demoCar=(Kind,driver,spec=CAR_SPEC)=>{const old=Math.random;Math.random=random(411);try{const car=new Kind(createTruck(),terrain,roads,-.2,spec),p=at(hwy,flat.s);car.place(p.x,p.z,p.heading);const states=[];for(let i=0;i<1800;i++){terrain.withGroundContact(car,()=>car.update(dt,driver(car,roads,16)));states.push([car.x,car.z,car.y,car.vx,car.vz,car.vy,car.heading,car.speed]);}return states;}finally{Math.random=old;}};
 assert.deepEqual(demoCar(Vehicle,autopilot),demoCar(Stock,stockAutopilot),'car autopilot path remains bit-identical to landed seam 450f4c3');
 assert.deepEqual(demoCar(Vehicle,autopilot,TRUCK_SPEC),demoCar(Stock,stockAutopilot,TRUCK_SPEC),'untowed truck autopilot path remains bit-identical to landed seam 450f4c3');
 let washStart=1800;for(;washStart<3100;washStart+=10){const p=at(mines,washStart);if(terrain.surfaceAt(p.x,p.z)?.washboard)break;}assert.ok(washStart<3100,'washboard oracle section exists');
 const roughPlain=path(false,Vehicle,mines,washStart,600);
 assert.deepEqual(path(true,Vehicle,mines,washStart,600),roughPlain,'inactive towing preserves the seeded washboard path bit-for-bit');
 assert.deepEqual(path(false,Stock,mines,washStart,600),roughPlain,'untowed washboard physics remains bit-identical to landed seam 450f4c3');

 await transformOracle(terrain,roads,flat.a);
 console.log('PASS immutable landed-seam truck and car demo path oracles, 1800 steps each.');
}

const mutation=(name,action,predicate)=>{const value=action();assert.equal(predicate(value),false,'mutation must fail: '+name);console.log('MUTATION rejected',name);};
mutation('loaded acceleration',()=>acceleration({...TRUCK_SPEC,engineAcceleration:1.5}),loadedAccelerationOK);
mutation('loaded braking',()=>braking({...TRUCK_SPEC,brake:2}),n=>n.runs.every(d=>d>=60&&d<=80));
mutation('loaded top speed',()=>topSpeed({...TRUCK_SPEC,enginePower:20}),n=>n.levelPeak>=140&&n.peak<=160);
mutation('detached path changed',()=>{const copy=structuredClone(detached);copy[10][0]+=.001;return copy;},n=>JSON.stringify(n)===JSON.stringify(plain));
mutation('model budget',()=>{const n=createTrailer();n.drawCalls+=10;return n;},n=>n.triangles<=47000&&n.drawCalls<=38);
function swayRun(kph=120,saw=false){const car=v(),p=at(hwy,flat.s);car.place(p.x,p.z,p.heading);setSpeed(car,kph/3.6);const peaks=[];let sign=0,peak=0,maxAngle=0;for(let i=0;i<120*6;i++){step(car,{...coast,steer:saw?Math.sin(i*dt*5)*.7:i<36?.8:0});const t=car.tow;const next=Math.sign(t.sway);peak=Math.max(peak,Math.abs(t.sway));maxAngle=Math.max(maxAngle,Math.abs(t.angle));if(sign&&next!==sign){peaks.push(peak);peak=0;}sign=next;}return{kph,peaks,maxAngle,angle:car.tow.angle,sway:car.tow.sway};}
const sway=swayRun(120), topSway=swayRun(measured.top.levelPeak);
for(const run of [sway,topSway]){
 console.log('SWAY',JSON.stringify(run));
 assert.ok(run.maxAngle<.5&&run.peaks.length>=5&&run.peaks[0]>.0005&&run.peaks.at(-1)<run.peaks[0]*.05,'sharp high-speed steer: bounded sway dies in 2–3 cycles');
}
const steady=[];for(const [path,speed,s]of [[hwy,80/3.6,flat.s],[mines,55/3.6,2000]]){const car=v(),p=at(path,s);car.place(p.x,p.z,p.heading);let progress=s,maxAngle=0;for(let i=0;i<120*12;i++){progress+=drive(car,path,progress,speed);maxAngle=Math.max(maxAngle,Math.abs(car.tow.angle));}steady.push({speed:speed*3.6,maxAngle});assert.ok(maxAngle<.5,'steady paved/gravel tracking');}console.log('STEADY',JSON.stringify(steady));
mutation('sway decay absent',()=>({...sway,peaks:sway.peaks.map(()=>sway.peaks[0])}),n=>n.peaks.at(-1)<n.peaks[0]*.05);
// Full-lock reverse reaches hard articulation contact, and cannot continue driving into the tongue.
const jack=v(),jp=yard.world(240,90);jack.place(jp.x,jp.z,yard.heading(1,0));for(let i=0;i<120*20&&!jack.tow.clunks;i++)step(jack,{...coast,throttle:-1,steer:1});
console.log('JACKKNIFE',JSON.stringify({clunks:jack.tow.clunks,angle:jack.tow.angle,speed:jack.speed}));
const jackOK=n=>n.clunks>0&&Math.abs(n.angle)<=TRAILER_SPEC.jackknife+1e-9&&n.speed===0;
assert.ok(jackOK({clunks:jack.tow.clunks,angle:jack.tow.angle,speed:jack.speed}),'jackknife contacts stop reversing truck');
const held={x:jack.x,z:jack.z,clunks:jack.tow.clunks};for(let i=0;i<120;i++)step(jack,{...coast,throttle:-1,steer:1});assert.ok(Math.hypot(jack.x-held.x,jack.z-held.z)<.001&&jack.tow.clunks===held.clunks,'holding reverse against jackknife neither creeps nor repeats clunks');
mutation('jackknife limit missing',()=>({clunks:0,angle:2,speed:-5}),jackOK);
// Real land/deck ramp run, plus random inputs, braking turns, paused-tab dt, placements, direct teleports and map wall.
const fuzz=v(),rng=random(998),bounds=[jp.x-65,jp.z-65,jp.x+65,jp.z+65];fuzz.bounds=bounds;fuzz.place(jp.x,jp.z,yard.heading(1,0));
let maxAngle=0,maxVy=0;const native=Math.random;Math.random=random(101);
try{for(let i=0;i<12000;i++){
 if(i%900===0){fuzz.place(jp.x,jp.z,rng()*Math.PI*2);setSpeed(fuzz,(rng()-.25)*45);fuzz.vy=rng()*15;fuzz.y+=rng()*2;}
 if(i%1300===0)fuzz.x+=20;
 terrain.withGroundContact(fuzz,()=>fuzz.update(i%499===0?3600:i%37===0?.1:dt,{throttle:rng()*2-1,steer:rng()*2-1,handbrake:rng()<.1},()=>fuzz.tow.step()));
 const t=fuzz.tow,values=[fuzz.x,fuzz.z,fuzz.y,fuzz.vx,fuzz.vz,fuzz.vy,t.x,t.z,t.y,t.heading,t.pitch,t.roll,t.vy,t.sway,t.swayRate];assert.ok(values.every(Number.isFinite),'fuzz finite numbers');maxAngle=Math.max(maxAngle,Math.abs(t.angle));maxVy=Math.max(maxVy,Math.abs(t.vy));assert.ok(Math.abs(t.angle)<=TRAILER_SPEC.jackknife+1e-8,'fuzz bounded articulation');
}}finally{Math.random=native;}
console.log('FUZZ',JSON.stringify({steps:12000,maxAngle,maxVy}));mutation('finite invariant',()=>[1,NaN],n=>n.every(Number.isFinite));
const placing=v();placing.bounds=[jp.x-100,jp.z-100,jp.x+100,jp.z+100];for(const method of ['place','restart','respawn']){if(method==='respawn'){placing.respawn();}else placing[method](jp.x,jp.z,.7);assert.ok(Math.abs(placing.tow.angle)<1e-9&&Math.hypot(placing.tow.x-placing.x,placing.tow.z-placing.z)>8.8,'all placements straighten full pair');}
mutation('placement listener missing',()=>{const old=placing.onPlaced;placing.onPlaced=null;placing.place(jp.x+10,jp.z,2);const a=placing.tow.angle;placing.onPlaced=old;placing.tow.place();return a;},n=>Math.abs(n)<1e-9);
// Mutate production help controller in a script that has repeatable thumb bias, then restore.
const helpControl=Towing.prototype.control;try{Towing.prototype.control=function(dt,input){if(this.help){this.input=input;return{...input,steer:input.steer+.3};}return helpControl.call(this,dt,input);};mutation('reverse help disabled',()=>reverse(true,true,false),n=>n.error<=.6&&n.progress>29.9);}finally{Towing.prototype.control=helpControl;}
console.log('PASS trailer targets, reverse help/off, detached identity, steady tracking, sway, jackknife, fuzz and placement.');
// Scene placement guard checks the full trailer even before actor draw-distance activation.
const {RoadScene}=await import('../web/src/road-scene.ts'),{touchesPlayer}=await import('../web/src/road-scene-rules.ts');
globalThis.addEventListener=()=>{};
const scene=new RoadScene(roads,terrain,{career:{day:8},roadside:[],ended:false,complaints:{add(){}},elapsed:0},new URLSearchParams('scene=fish'));
await preload(terrain,[[scene.centre.x,scene.centre.z]],180);
const sceneCar=new Vehicle(createTruck(),terrain,roads,-.2,TRUCK_SPEC);sceneCar.placementGuard=pose=>scene.allowPlacement(pose,sceneCar.spec);
const sceneTow=new Towing(sceneCar,terrain,roads,true,false,{scene});let relocated=0;
for(const along of [-30,-8,0,30])for(const direction of [0,Math.PI]){
 scene.rules.truckAlong=along;scene.place();const pose={x:0,z:0,heading:0};scene.road.at(along+9,0,pose);pose.heading+=direction;
 sceneCar.place(pose.x,pose.z,pose.heading);relocated+=Math.hypot(sceneCar.x-pose.x,sceneCar.z-pose.z)>.1?1:0;
 const t=sceneTow,body={x:t.x-Math.sin(t.heading)*TRAILER_SPEC.bodyOffset,z:t.z+Math.cos(t.heading)*TRAILER_SPEC.bodyOffset,heading:t.heading};
 assert.ok(scene.placementSolids.every(s=>!touchesPlayer(s,sceneCar,.349,sceneCar.spec)&&!touchesPlayer(s,body,.349,t.footprint)),'road-scene placement clears both full bodies');assert.ok(Math.abs(t.angle)<1e-9,'scene guard leaves trailer straight');
}
assert.ok(relocated>0,'blocked pair moved forward without shortening');
const contact=v(),cp=yard.world(240,90);contact.place(cp.x,cp.z,.4);setSpeed(contact,-5);
const rearX=contact.tow.x-Math.sin(.4)*4.2,rearZ=contact.tow.z+Math.cos(.4)*4.2;
const obstacles=[{x:rearX,z:rearZ,heading:.4,half:.08,halfWidth:5}];
const {pushOut}=await import('../web/src/parked.ts');contact.tow.world.yard={resolveTowBody:p=>pushOut(p,obstacles),resolveSolids(){}};
for(let i=0;i<20&&!contact.tow.impacts;i++)terrain.withGroundContact(contact,()=>contact.update(.1,{...coast,throttle:-1},()=>contact.tow.step()));
console.log('THIN',JSON.stringify({impacts:contact.tow.impacts,speed:contact.speed,x:contact.tow.x,z:contact.tow.z,rearX,rearZ}));
assert.ok(contact.tow.impacts>0&&Math.abs(contact.speed)<.1,'thin solid stops a reversing trailer through hitch at low render rate');
const hitCount=contact.tow.impacts;contact.tow.world.yard=null;contact.place(cp.x,cp.z,.4);setSpeed(contact,-5);
for(let i=0;i<10;i++)terrain.withGroundContact(contact,()=>contact.update(.1,{...coast,throttle:-1},()=>contact.tow.step()));
assert.ok(!(contact.tow.impacts>hitCount&&contact.speed===0),'mutation rejected: thin solid resolver removed');
// A requested road pose survives missing tiles, then both bodies seat when the land arrives.
const waiting=v(),wanted=at(hwy,flat.s),readHeight=terrain.heightAt;try{terrain.heightAt=()=>null;waiting.place(wanted.x,wanted.z,wanted.heading);assert.equal(waiting.x,wanted.x,'unloaded road placement preserves requested position');}finally{terrain.heightAt=readHeight;}
step(waiting);assert.ok(Math.abs(waiting.tow.angle)<1e-9&&Number.isFinite(waiting.tow.y),'waiting pair seats straight after terrain loads');
console.log('PASS real road-scene pair placements and thin trailer-only solid impact.');
// Fault injection in production objects/methods. Each original is restored before the next case.
const originalStep=Towing.prototype.step;
try{
 Towing.prototype.step=function(dt){originalStep.call(this,dt);this.faultClock=(this.faultClock??0)+(dt??1/120);this.sway=.04*Math.sin(this.faultClock*5);};
 const badSway=swayRun();assert.ok(!(badSway.peaks.length>=5&&badSway.peaks.at(-1)<badSway.peaks[0]*.05),'mutation rejected: production oscillator never damps');
}finally{Towing.prototype.step=originalStep;}
const originalLimit=TRAILER_SPEC.jackknife;
try{
 TRAILER_SPEC.jackknife=2.5;const bad=v();bad.place(jp.x,jp.z,yard.heading(1,0));for(let i=0;i<120*20&&!bad.tow.clunks;i++)step(bad,{...coast,throttle:-1,steer:1});
 assert.ok(!(bad.tow.clunks>0&&Math.abs(bad.tow.angle)<=originalLimit+1e-9&&bad.speed===0),'mutation rejected: production jackknife contact removed');
}finally{TRAILER_SPEC.jackknife=originalLimit;}
try{
 Towing.prototype.step=function(dt){originalStep.call(this,dt);this.heading=NaN;};const bad=v();bad.place(jp.x,jp.z,.4);step(bad,{...coast,throttle:1});
 assert.throws(()=>assert.ok([bad.x,bad.y,bad.tow.heading,bad.tow.y,bad.tow.vy].every(Number.isFinite)),'mutation rejected: production non-finite state');
}finally{Towing.prototype.step=originalStep;}
const extra=model.root.children.find(n=>n.isMesh).clone();model.root.add(extra);try{const actual=rigCost(model.root);assert.ok(actual.drawCalls>38,'mutation rejected: actual extra draw call');}finally{model.root.remove(extra);}
console.log('PASS production decay/contact/finite/model fault injections restored.');

const sawing=swayRun(120,true);console.log('SAWING',JSON.stringify(sawing));assert.ok(sawing.peaks.at(-1)>sway.peaks.at(-1)*5,'continued steering sustains sway while steady hands let it die');
let washPoint=null;for(let s=1800;s<3100;s+=10){const q=at(mines,s);if(terrain.surfaceAt(q.x,q.z)?.washboard){washPoint=q;break;}}
assert.ok(washPoint,'real washboard fuzz location exists');
const rough=v(),roughRandom=random(345);rough.bounds=[washPoint.x-60,washPoint.z-60,washPoint.x+60,washPoint.z+60];let roughAngle=0;const oldRandom=Math.random;Math.random=random(346);
try{for(let i=0;i<1800;i++){if(i%300===0){rough.place(washPoint.x,washPoint.z,washPoint.heading);setSpeed(rough,55/3.6);}step(rough,{throttle:roughRandom()*2-1,steer:roughRandom()*2-1,handbrake:roughRandom()<.1});roughAngle=Math.max(roughAngle,Math.abs(rough.tow.angle));assert.ok([rough.x,rough.y,rough.vx,rough.tow.heading,rough.tow.vy].every(Number.isFinite)&&Math.abs(rough.tow.angle)<=TRAILER_SPEC.jackknife+1e-8,'random washboard inputs stay finite and bounded');}}finally{Math.random=oldRandom;}
console.log('WASHBOARD FUZZ',JSON.stringify({steps:1800,maxAngle:roughAngle}));

// Production demo driver: the loaded rig's tyres must fit the right lane on a wide paved section.
const demo=v(),demoStart=at(hwy,flat.s),lane=1.8;demo.place(demoStart.x+Math.cos(demoStart.heading)*lane,demoStart.z+Math.sin(demoStart.heading)*lane,demoStart.heading);
let demoDistance=0,demoMin=Infinity,demoMax=-Infinity;
for(let i=0;i<120*60&&demoDistance<400;i++){
 const before={x:demo.x,z:demo.z};step(demo,autopilot(demo,roads,80/3.6));demoDistance+=Math.hypot(demo.x-before.x,demo.z-before.z);
 if(i%12===0){const bodies=[{x:demo.x,z:demo.z,heading:demo.heading,offsets:[-demo.spec.wheelbase/2,demo.spec.wheelbase/2],track:demo.spec.rearTrack/2+.148},{x:demo.tow.x,z:demo.tow.z,heading:demo.tow.heading,offsets:[-.56,.56],track:1.255}];
 for(const b of bodies)for(const along of b.offsets){const x=b.x+Math.sin(b.heading)*along,z=b.z-Math.cos(b.heading)*along,hit=roads.nearest(x,z,20,r=>r.id===25);if(!hit)continue;let h=hit.heading;if(Math.cos(h-demo.heading)<0)h+=Math.PI;const side=(x-hit.x)*Math.cos(h)+(z-hit.z)*Math.sin(h);demoMin=Math.min(demoMin,side-b.track);demoMax=Math.max(demoMax,side+b.track);}}
}
console.log('DEMO LANE',JSON.stringify({distance:demoDistance,min:demoMin,max:demoMax,width:3.6}));
assert.ok(demoDistance>=400&&demoMin>=0&&demoMax<=3.6,'production loaded demo keeps tyres inside the right lane');
