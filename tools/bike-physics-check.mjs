import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { BikeRide, BIKE_STEP } from '../web/src/bike-ride.ts';
import { BIKE_SPEC, createBike } from '../web/src/bike.ts';
import { GARAGE, readVehicle } from '../web/src/garage.ts';
import { SceneryContact } from '../web/src/explore.ts';
import { pushOut } from '../web/src/parked.ts';
const only = process.env.BIKE_CASE;
const results = [];
function test(name, fn) { if(only && only!==name)return; fn(); results.push(name); console.log('PASS '+name); }
const idle = {throttle:0,steer:0,handbrake:false};
const go = {...idle,throttle:1};
function world({kind=1, height=()=>0, canopy=0, washboard=false, gravel=false}={}) {
 const terrain={heightAt:height, surfaceAt:(x,z)=>({ground:height(x,z),canopy,kind,roadDist:kind?0:99,halfWidth:kind?8:0,bridge:false,washboard,brook:99,level:8,...(gravel?{gravel}:{})}),withContactHeight:(_b,read)=>read()};
 const road={id:1,kind,bridge:false,name:'Test road',halfWidth:8,pts:[[-10000,0],[10000,0]]};
 const roads={deckHeight:()=>null,nearest:(x,z,d,pred)=>!pred||pred(road)?{x,z:0,heading:Math.PI/2,dist:Math.abs(z),road,seg:0,t:.5}:null};
 const car={root:new THREE.Group(),pose(){},driverEye:new THREE.Object3D()};
 const v=new BikeRide(car,terrain,roads,-.2);v.place(0,0,Math.PI/2);return {v,terrain,roads};
}
function run(v,seconds,input=go,fps=60,step) { for(let i=0;i<Math.round(seconds*fps);i++)v.update(1/fps,typeof input==='function'?input(v,i/fps):input,step);return v; }
const ramp=x=>x<0?0:x<=20?x*.25:0;
function launch(speed=20){ const {v}=world({height:ramp});v.place(-4,0,Math.PI/2);v.vx=v.speed=speed;let take;
 for(let i=0;i<2000;i++){v.update(BIKE_STEP,idle);if(v.airborne){take={x:v.x,y:v.y,vx:v.vx,vy:v.vy};break;}}assert.ok(take,'ramp must launch');return {v,take}; }
test('a gravel driveway rides as gravel, a plain track as dirt',()=>{
 for(const [opts,name] of [[{kind:4,gravel:true},'gravel'],[{kind:4},'dirt track'],[{kind:3},'gravel']]){const {v}=world(opts);run(v,.1,go);assert.equal(v.surfaceName,name,JSON.stringify(opts));}
});
test('garage choice precedence and mail defaults',()=>{
 const store=v=>()=>({getItem:()=>v});
 assert.equal(readVehicle(new URLSearchParams(),false,store('bike')).id,'car');
 assert.equal(readVehicle(new URLSearchParams('vehicle=bike'),false,store('car')).id,'bike');
 assert.equal(readVehicle(new URLSearchParams('vehicle=truck'),false,store('bike')).id,'truck');
 assert.equal(readVehicle(new URLSearchParams('vehicle=bike'),true,store('car')).id,'bike');
 assert.equal(readVehicle(new URLSearchParams('vehicle=bad'),true,store('bike')).id,'bike');
 assert.equal(readVehicle(new URLSearchParams(),true,()=>{throw Error('blocked')}).id,'car');
});
test('garage pairs bike rig and its independent solver',()=>{
 const entry=GARAGE.find(e=>e.id==='bike'),{terrain,roads}=world(),model=entry.build(false),solver=entry.ride?.(model,terrain,roads,-.2,entry.spec);
 assert.ok(solver instanceof BikeRide);assert.equal(solver.spec,BIKE_SPEC);assert.equal(solver.car,model);
 assert.equal(model.wheels.fl,model.wheels.fr);assert.equal(model.wheels.rl,model.wheels.rr);assert.notEqual(model.wheels.fl,model.wheels.rl);
 assert.equal(model.steer.fl,model.steer.fr);assert.equal(model.beacon,undefined);assert.equal(model.driverWindow,undefined);
 assert.ok(!GARAGE.find(e=>e.id==='car').ride&&!GARAGE.find(e=>e.id==='truck').ride);
});
test('explore contacts use the selected collision spec',()=>{
 const {v}=world(),calls=[],contact=new SceneryContact({hitCar(...args){calls.push(args);return 1}});
 contact.update(BIKE_STEP,v,false);assert.equal(calls[0][7],v.spec);assert.equal(calls[0][7].envelope.radius,.55);
});
for(const [name,kind,top,t80]of [['pavement',1,115,5.1],['gravel',3,104,6.0],['grass',0,88,8.5]])test(name+' speed and acceleration',()=>{
 const {v}=world({kind});let zero80=null;for(let i=0;i<120*70;i++){v.update(BIKE_STEP,go);if(zero80===null&&v.speed>=80/3.6)zero80=(i+1)/120;}
 console.log(JSON.stringify({surface:name,top:v.speed*3.6,zero80}));assert.ok(Math.abs(v.speed*3.6-top)<2,`${name} top ${v.speed*3.6}`);assert.ok(zero80>3&&zero80<t80,`${name} 0-80 ${zero80}`);
});
test('lean has correct sign and steady magnitude',()=>{
 const {v}=world();const speed=60/3.6;v.vx=v.speed=speed;
 const steer=speed*speed/(40*9.81*1.35),throttle=.18/(6.4*(1-(speed/(115/3.6))**2));
 run(v,5,{...go,throttle,steer});
 const expected=-Math.atan(speed*speed/(40*9.81));
 assert.ok(v.roll<0&&Math.abs(v.roll-expected)<.005,`roll ${v.roll}`);assert.ok(Math.abs(v.speed-speed)<.05);assert.ok(v.heading>Math.PI/2);console.log('Lean at 60 km/h and 40 m radius',v.roll*180/Math.PI);
});
test('upright and stationary at rest',()=>{const {v}=world();run(v,5,{...idle,steer:1});assert.equal(v.roll,0);assert.equal(v.speed,0);assert.equal(v.wheelie,0);assert.equal(v.crashes,0);});
test('two wheel contacts follow a real slope',()=>{const {v}=world({height:x=>x*.15});v.place(0,0,Math.PI/2);assert.ok(Math.abs(v.pitch-Math.atan(.15))<1e-6);assert.ok(v.y>=-.001);});
test('wheelie comes up balances and loops out',()=>{
 const {v}=world();run(v,1.8,{...go,pull:true});assert.ok(v.wheelie>.2&&v.wheelie<1.1,`wheelie ${v.wheelie}`);
 const before=v.wheelie;run(v,.6,{...go,throttle:.42,pull:true});assert.ok(v.wheelie>.2&&v.wheelie<1.2&&Math.abs(v.wheelie-before)<.25);
 run(v,3,{...go,pull:true});assert.ok(v.crashes>0);console.log('Wheelie',before,v.crashes);
});
test('front brake dives and rear brake slides',()=>{
 const {v}=world();v.vx=v.speed=20;run(v,.3,{...idle,throttle:-1});assert.ok(v.frontTravel>.06);assert.ok(v.speed<19);
 const a=world().v;a.vx=a.speed=20;run(a,.4,{...idle,handbrake:true,steer:1});const side=a.vx*Math.cos(a.heading)+a.vz*Math.sin(a.heading);assert.ok(Math.abs(side)>.4);
});
test('same physics at 20 30 60 and 120 fps',()=>{
 for(const scenario of ['washboard','ramp','loop-out']){
  const states=[20,30,60,120].map(fps=>{
   const {v}=world(scenario==='washboard'?{kind:3,washboard:true}:scenario==='ramp'?{height:ramp}:{});
   if(scenario==='ramp'){v.place(-4,0,Math.PI/2);v.vx=v.speed=20;}
   run(v,12,(_v,t)=>scenario==='washboard'?({...go,steer:t<3?.2:t<6?-.3:0}):scenario==='loop-out'?({...go,pull:true}):idle,fps);
   return [v.x,v.z,v.y,v.speed,v.heading,v.roll,v.pitch,v.crashes,v.lastJump?.airTime??0];
  });
  for(const s of states)for(let i=0;i<s.length;i++)assert.ok(Math.abs(s[i]-states[0][i])<1e-7,scenario+JSON.stringify(states));
 }
});
test('ballistic ramp range and clean landing',()=>{
 const {v,take}=launch();for(let i=0;i<2000&&!v.lastJump;i++)v.update(BIKE_STEP,idle);
 const time=(take.vy+Math.sqrt(take.vy**2+2*9.81*take.y))/9.81, range=take.vx*time;
 console.log('Ballistic',JSON.stringify({take,range,actual:v.lastJump}));assert.ok(v.lastJump?.clean);assert.ok(v.lastJump.airTime>1);assert.ok(Math.abs(v.lastJump.distance-range)<2);assert.ok(v.lastJump.peakHeight>4);
});
test('one full backflip is counted',()=>{
 for(const sign of [1,-1]){
  const {v}=world();v.y=50;v.vx=v.speed=15;v.vy=0;v.airborne=true;
  // Normal air controls complete one turn, then opposite torque settles the bike for landing.
  let reached=false;for(let i=0;i<2000&&!v.lastJump;i++){
   const t=Math.max(-1,Math.min(1,(v.pitchRate*3-(sign*(Math.PI*2+.15)-v.pitch)*8)/7.2));v.update(BIKE_STEP,{...idle,throttle:t});if(Math.abs(v.pitch)>Math.PI*2-.1)reached=true;
  }
  console.log(sign>0?'Backflip':'Frontflip',v.lastJump);assert.ok(reached);assert.equal(v.lastJump?.pitchRotations,sign);assert.ok(v.lastJump?.clean);
 }
});
test('bad landing crashes and resets safe upright at rest',()=>{
 const {v}=world();v.place(3,0,.4);v.y=8;v.pitch=Math.PI;v.airborne=true;v.vy=-2;run(v,3,idle);
 assert.ok(v.crashes===1);assert.equal(v.lastJump?.clean,false);assert.equal(v.airborne,false);assert.equal(v.crashTime,0);assert.equal(v.speed,0);assert.ok(Math.abs(v.pitch)<.01&&Math.abs(v.roll)<.01);assert.ok(Math.hypot(v.x-3,v.z)<.01);assert.ok(v.y>=0);
});
test('a whip never outlives the flight, on a rising landing too',()=>{const {v}=world({height:x=>x<0?0:x*.3});v.place(-6,0,Math.PI/2);v.y=1.2;v.airborne=true;v.vx=25;v.vy=-.5;v.whip=.4;v.jump.airTime=.2;let landed=false;for(let i=0;i<600&&!landed;i++){v.update(BIKE_STEP,idle);landed=!v.airborne;}assert.ok(landed);assert.equal(v.crashTime,0);assert.equal(v.whip,0);});
test('both landing paths report the landing, clean or crashed',()=>{const drop=(slope,vx,pitch)=>{const log=[],{v}=world({height:x=>x<0?0:x*slope});v.damage={hit:(k,s)=>log.push([k,s]),drive(){}};v.damageActive=true;v.place(-6,0,Math.PI/2);v.y=1.2;v.airborne=true;v.vx=vx;v.vy=-.5;v.pitch=pitch;v.jump.airTime=.2;for(let i=0;i<600&&v.airborne;i++)v.update(BIKE_STEP,idle);return {log,v};};for(const [slope,vx] of [[0,5],[.3,25]])for(const pitch of [0,Math.PI]){const {log,v}=drop(slope,vx,pitch),hits=log.filter(e=>e[0]==='landing');assert.equal(hits.length,1,`slope ${slope} pitch ${pitch}`);assert.ok(hits[0][1]>0);assert.equal(v.crashTime>0,pitch!==0);}});
test('damage time runs on through a tumble',()=>{let time=0;const {v}=world();v.damage={hit(){},drive:dt=>{time+=dt;}};v.damageActive=true;run(v,1,go);time=0;v.onSolidImpact(20);assert.ok(v.crashTime>0);run(v,1,idle);assert.ok(v.crashTime>0,'still down');assert.ok(Math.abs(time-1)<.02,'time '+time);});
test('a whip on the ground fades out',()=>{const {v}=world();run(v,1,go);v.whip=.4;run(v,1,go);assert.equal(v.airborne,false);assert.ok(Math.abs(v.whip)<.01,'whip '+v.whip);});
test('active damage sees bike impacts, landings and driving time; inactive damage sees nothing',()=>{const log=[],damage={hit:(k,s)=>log.push([k,s]),drive:(dt,speed,name,depth,air)=>log.push(['drive',dt,name,depth,air])};const {v}=world();v.damage=damage;run(v,.5,go);v.onSolidImpact(20);assert.equal(log.length,0);v.place(0,0,Math.PI/2);v.damageActive=true;run(v,.5,go);const drives=log.filter(e=>e[0]==='drive');assert.ok(drives.length>=50);assert.ok(Math.abs(drives.reduce((t,e)=>t+e[1],0)-.5)<.02);assert.equal(drives[0][2],v.surfaceName);v.onSolidImpact(20);assert.deepEqual(log[log.length-1],['impact',20]);const l=launch(20).v;l.damage=damage;l.damageActive=true;const n=log.length;run(l,4,idle);assert.ok(log.slice(n).some(e=>e[0]==='landing'&&e[1]>0));});
test('whip returns after air control is released',()=>{const {v}=world();v.y=50;v.airborne=true;run(v,.6,{...idle,steer:1});assert.ok(v.roll<-.6&&v.whip<-.3);run(v,1,idle);assert.ok(Math.abs(v.roll)<.01&&Math.abs(v.whip)<.01);});
test('map edge is a wall',()=>{const {v}=world();v.bounds=[-10,-10,10,10];run(v,8,go);assert.ok(v.x<=10&&v.x>=-10&&v.z<=10&&v.z>=-10);assert.ok(v.atEdge);assert.equal(v.speed,0);});
test('yard solids cannot be crossed and cause a tumble',()=>{const {v}=world();v.vx=v.speed=25;const solids=[{x:8,z:0,half:6,halfWidth:1,heading:Math.PI/2}];run(v,.4,idle,60,()=>pushOut(v,solids));assert.ok(v.x>.6&&v.x<=.701,'bike envelope stops before the same rectangle, whose long axis is X');assert.ok(v.crashes>0);});
test('water slows then respawns',()=>{const {v}=world({height:x=>x<5?0:-2});v.vx=v.speed=12;let reset=false,slow=false;const original=v.respawn.bind(v);v.respawn=()=>{reset=true;original()};for(let i=0;i<120*5&&!reset;i++){v.update(BIKE_STEP,idle);if(v.sunk>.3&&v.speed<8)slow=true;}assert.ok(slow&&reset);assert.ok(v.x<5);assert.ok(v.y>=0);assert.equal(v.speed,0);});
test('air above water stays ballistic until contact',()=>{
 const {v}=world({height:x=>x<5?0:-3});v.y=12;v.vx=v.speed=15;v.airborne=true;run(v,.6,idle);
 assert.equal(v.sunk,0);assert.ok(Math.abs(v.vx-15)<1e-8);assert.ok(Math.abs(v.y-(12-.5*9.81*.6*.6))<1e-7);
});
test('new ground data rebases without launching',()=>{let lift=0;const {v}=world({height:()=>lift});v.vx=v.speed=10;run(v,.2,go);lift=4;run(v,.1,go);assert.ok(!v.airborne);assert.ok(v.y>=4);assert.ok(Math.abs(v.vy)<.001);});
test('bounded finite state never falls through land',()=>{
 const height=(x,z)=>2+Math.sin(x*.05)*.8+Math.cos(z*.04)*.5;const {v}=world({kind:3,height});
 run(v,60,(_v,t)=>({...go,steer:Math.sin(t*.7)*.7,throttle:Math.sin(t*.4)>.8?-1:1,pull:t%9<1}),60,()=>{
  for(const key of ['x','z','y','vx','vz','vy','speed','pitch','roll','wheelie'])assert.ok(Number.isFinite(v[key]),key);
  assert.ok(Math.hypot(v.vx,v.vz)<=34.00001);assert.ok(v.y>=height(v.x,v.z)-.001,`below ground ${v.y-height(v.x,v.z)}`);
 });
 v.update(NaN,go);v.update(.1,{throttle:NaN,steer:Infinity,handbrake:false});assert.ok(Number.isFinite(v.y)&&Number.isFinite(v.x));
 const invalid=world().v;invalid.update(.1,{throttle:NaN,steer:NaN,handbrake:false});invalid.update(.1,{throttle:Infinity,steer:Infinity,handbrake:false});assert.ok(Number.isFinite(invalid.heading)&&Number.isFinite(invalid.speed));assert.equal(invalid.speed,0);
 const finite=world().v;finite.update(NaN,go);run(finite,1,go);assert.ok(finite.speed>1);
 const fast=world().v;fast.airborne=true;fast.y=100;fast.vx=100;fast.update(.1,idle);assert.ok(Math.hypot(fast.vx,fast.vz)<=34.00001);
});
test('procedural model stays within geometry and draw budget',()=>{
 const b=createBike();console.log('Bike model',b.triangles,'triangles',b.drawCalls,'draw calls');assert.ok(b.triangles<=15000);assert.equal(b.drawCalls,2);assert.ok(b.triangles>3000);
 const meshes=[];b.root.traverse(o=>{if(o.isMesh)meshes.push(o)});assert.equal(meshes.length,2);assert.ok(meshes.every(m=>m.castShadow&&m.isSkinnedMesh));
 b.pose({steer:.3,spin:1,front:.2,rear:.12,stand:1,foot:0,dive:.1,crash:0,ground:0,pitch:0,roll:0});b.root.updateMatrixWorld(true);
 assert.ok(b.driverEye.position.y>1.4);
 const torso=b.riderMesh.skeleton.bones.find(x=>x.name==='Rider torso and helmet'),goggles=new THREE.Vector3(0,.73,-.303).applyQuaternion(torso.quaternion).add(torso.position),forward=new THREE.Vector3(0,0,-1).applyQuaternion(torso.quaternion);
 assert.ok(b.driverEye.position.clone().sub(goggles).dot(forward)>.02&&b.driverEye.position.distanceTo(goggles)<.08,'eye stays just ahead of the goggles');assert.ok(b.bikeMesh.skeleton.bones.find(x=>x.name==='Telescoping fork sliders').position.y>.1);
});
test('tyres sit on land through lean suspension and wheelies',()=>{
 const {terrain,roads}=world(),b=createBike(),v=new BikeRide(b,terrain,roads,-.2);v.place(0,0,0);
 for(const pose of [{roll:0,wheelie:0,frontTravel:0,rearTravel:0},{roll:-.6,wheelie:0,frontTravel:.15,rearTravel:.05},{roll:0,wheelie:.65,frontTravel:0,rearTravel:0}]){
  Object.assign(v,pose,{pitch:pose.wheelie});v.update(0,idle);b.root.updateMatrixWorld(true);b.bikeMesh.skeleton.update();
  const g=b.bikeMesh.geometry,index=g.getAttribute('skinIndex'),point=new THREE.Vector3();
  const rear=b.bikeMesh.skeleton.bones.indexOf(b.wheels.rl),front=b.bikeMesh.skeleton.bones.indexOf(b.wheels.fl);let lowRear=Infinity,lowFront=Infinity;
  for(let i=0;i<index.count;i++)if(index.getX(i)===rear||index.getX(i)===front){b.bikeMesh.getVertexPosition(i,point);point.applyMatrix4(b.bikeMesh.matrixWorld);if(index.getX(i)===rear)lowRear=Math.min(lowRear,point.y);else lowFront=Math.min(lowFront,point.y);}
  console.log('Tyre bottoms',pose,lowFront,lowRear);assert.ok(lowRear>-.015&&lowRear<.08);assert.ok(lowFront>-.015);if(!pose.wheelie)assert.ok(lowFront<.08);
 }
});
test('front tyre clears the guard at full fork travel',()=>{
 const b=createBike(),teal=new THREE.Color(0x568b87);b.pose({steer:0,spin:0,front:.24,rear:.20,stand:1,foot:0,dive:.24,crash:0,ground:0,pitch:0,roll:0});b.root.updateMatrixWorld(true);b.bikeMesh.skeleton.update();
 const mesh=b.bikeMesh,g=mesh.geometry,skin=g.getAttribute('skinIndex'),colour=g.getAttribute('color'),front=mesh.skeleton.bones.indexOf(b.wheels.fl),fork=mesh.skeleton.bones.indexOf(b.steer.fl),point=new THREE.Vector3();let tyre=-Infinity,guard=Infinity;
 for(let i=0;i<skin.count;i++){if(skin.getX(i)!==front&&skin.getX(i)!==fork)continue;mesh.getVertexPosition(i,point);if(Math.abs(point.z+.74)>.03)continue;if(skin.getX(i)===front)tyre=Math.max(tyre,point.y);else if(Math.abs(colour.getX(i)-teal.r)+Math.abs(colour.getY(i)-teal.g)+Math.abs(colour.getZ(i)-teal.b)<1e-5)guard=Math.min(guard,point.y);}
 console.log('Fork guard clearance',JSON.stringify({tyre,guard,gap:guard-tyre}));assert.ok(Number.isFinite(guard)&&Number.isFinite(tyre)&&guard-tyre>=.015);
});
test('crash model separates and stays above ground',()=>{
 const b=createBike();b.root.position.y=.356;
 for(const t of [.1,.4,.8,1.2,1.5]){
  b.pose({steer:0,spin:0,front:0,rear:0,stand:0,foot:0,dive:0,crash:t,ground:0,pitch:0,roll:0});b.root.updateMatrixWorld(true);
  assert.ok(b.riderMesh.position.distanceTo(b.bikeMesh.position)>(t<.2?.15:.25));
  for(const mesh of [b.bikeMesh,b.riderMesh]){mesh.skeleton.update();let min=Infinity;const point=new THREE.Vector3();for(let i=0;i<mesh.geometry.getAttribute('position').count;i++){mesh.getVertexPosition(i,point);point.applyMatrix4(mesh.matrixWorld);assert.ok(Number.isFinite(point.y));min=Math.min(min,point.y);}assert.ok(min>-.015,`crash model below ground ${t}: ${min}`);}
 }
});
test('car, side by side and truck keep the shared Vehicle path: only the bike has its own ride',()=>{assert.deepEqual(GARAGE.filter(e=>e.ride).map(e=>e.id),['bike']);});
console.log(`${results.length} bike physics groups passed.`);
