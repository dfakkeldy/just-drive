import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { chooseDriver, driverEnabled, driverLive } from '../web/src/point-tupper-driver.ts';
import { GARAGE } from '../web/src/garage.ts';
import { AreaContacts } from '../web/src/world-contacts.ts';
assert.equal(driverEnabled('pointtupper',true,new URLSearchParams(),false),true);
for(const [area,modern,query,dev] of [['mabou',true,'',false],['pointtupper',false,'',false],['pointtupper',true,'',true],['pointtupper',true,'demo=4',false],['pointtupper',true,'aiDriver=0',false]])
 assert.equal(driverEnabled(area,modern,new URLSearchParams(query),dev),false);
assert.equal(driverEnabled('pointtupper',true,new URLSearchParams('aiDriverCheck=1'),true),true);
// LOW builds the AI too (from the display models): the gate no longer reads the quality.
assert.equal(driverEnabled('pointtupper',true,new URLSearchParams(),false),true,'production (desktop or LOW) builds the AI');
assert.equal(driverEnabled('pointtupper',true,new URLSearchParams('aiDriverCheck=1'),true),true,'a check page builds it');
for(const player of ['car','truck','sxs','bike']) {
 const selected=new Set();
 for(const random of [0,.26,.51,.99]) {
 const e=chooseDriver(player,()=>random);
 assert.notEqual(e.id,player);assert.notEqual(e.id,'horse');selected.add(e.id);
 }
 assert.equal(selected.size,3);
}
// LOW picks only kinds with a display model: an allow-list, so a new garage vehicle never reaches drivableDisplay.
{
 const { DISPLAY_KINDS, drivableDisplay } = await import('../web/src/fleet-models.ts');
 GARAGE.push({id:'tractor',name:'Invented test vehicle',spec:GARAGE[0].spec,build:()=>{throw Error('not built');}});
 try {
  for(const player of ['car','truck','sxs','bike']) for(let i=0;i<40;i++) {
   const e=chooseDriver(player,()=>i/40,true); assert.ok(DISPLAY_KINDS.includes(e.id),`LOW pick ${e.id} has a display model`);
  }
  assert.ok([...Array(40).keys()].some(i=>chooseDriver('car',()=>i/40,false).id==='tractor'),'desktop still picks any motor vehicle');
  assert.throws(()=>drivableDisplay('tractor'),/No display model for tractor/);
 } finally { GARAGE.pop(); }
}
// LOW leaves the car out: no display model.
for(const player of ['car','truck','sxs','bike']) {
 const selected=new Set();
 for(let i=0;i<20;i++){const e=chooseDriver(player,()=>i/20,true);assert.notEqual(e.id,'car','LOW never picks the car');assert.notEqual(e.id,player);selected.add(e.id);}
 assert.equal(selected.size,player==='car'?3:2,`LOW pool for a ${player} player`);
}
console.log('PASS enable gates and all non-player motor vehicle selection');
// Contact regression: a horizontal push up a bank cannot leave the player's root under ground.
const { PointTupperDriver } = await import('../web/src/point-tupper-driver.ts');
const spec=GARAGE[0].spec;
const ai={x:0,z:0,y:1,heading:0,spec};
const player={x:.1,z:0,y:1,heading:0,spec,vx:0,vz:0,speed:0};
const actor={active:true,vehicle:ai,terrain:{heightAt:()=>5},roads:{deckHeight:()=>null}};
PointTupperDriver.prototype.resolve.call(actor,player);
assert.ok(player.y>=5,'player remains above ground after horizontal contact');
assert.ok(Math.hypot(player.x,player.z)>.1,'uses real envelope resolution');
actor.terrain.heightAt=()=>null;player.x=.1;player.z=0;player.y=1;
PointTupperDriver.prototype.resolve.call(actor,player);
assert.equal(player.x,.1);assert.equal(player.z,0,'unloaded contact destination rolls back');
console.log('PASS production envelope contacts: bank floor and unloaded-destination rollback');
// A right-hand side road may be nearest without being the road followed.
const mainRoad={kind:2,halfWidth:5,pts:[[0,-50],[0,100]]};
const sideRoad={kind:2,halfWidth:5,pts:[[-100,-50],[100,-50]]};
let inputSeen, searches=0;
const moving={x:1.6,z:-30,y:0,heading:0,spec,speed:5,vx:0,vz:-5,
 update:(_dt,input)=>{inputSeen=input;moving.z-=.1;},place:()=>{throw Error('junction must not roll back');}};
const junctionActor={active:true,vehicle:moving,parked:0,contact:{y:0},obstacles:()=>[],traffic:[],signals:null,
 eligible:r=>r.kind<=3&&r.halfWidth>=spec.halfWidth+1.8,
 contacts:{resolve:()=>{}},terrain:{withGroundContact:(context,run)=>{assert.equal(context.x,undefined,'AI cannot retarget player terrain');run();}},
 roads:{nearest:(x,z,range,filter)=>{
 searches++;
 if(range===8){assert.equal(filter(mainRoad),false);assert.equal(filter({...sideRoad,halfWidth:1}),false);return {road:sideRoad};}
 if(searches>=4)return {road:sideRoad,x:moving.x,z:moving.z,dist:0,heading:Math.PI/2};
 return {road:mainRoad,x:0,z:moving.z,dist:1.6,heading:0};
 }}};
PointTupperDriver.prototype.step.call(junctionActor,1/120,{...ai,x:500,z:500});
assert.equal(inputSeen.handbrake,false,'segment-connected T junction is not a dead end');
assert.ok(moving.z< -30,'perpendicular nearest segment does not freeze driver');
console.log('PASS T-junction segment connectivity, width filter, perpendicular lane guard, player terrain ownership');

player.x=500;player.z=500;player.y=1;actor.terrain.heightAt=()=>20;
PointTupperDriver.prototype.resolve.call(actor,player);
assert.equal(player.y,1,'distant AI cannot alter player ground or bridge support');
// Bridges (#156): a push reads the ground at the body's own height. A deck overhead (an overpass) never lifts it; a
// deck within reach does.
{
const refs=[];
const deckActor={active:true,vehicle:{...ai,y:5},terrain:{heightAt:(_x,_z,ref)=>{refs.push(ref);return 5;}},roads:{deckHeight:()=>20}};
player.x=.1;player.z=0;player.y=5;
PointTupperDriver.prototype.resolve.call(deckActor,player);
assert.equal(player.y,5,'a push under an overpass leaves the player on the lower road');
assert.deepEqual(refs,[5],'the ground is read at the body height');
deckActor.roads.deckHeight=()=>5.3;player.x=.1;player.z=0;player.y=5;
PointTupperDriver.prototype.resolve.call(deckActor,player);
assert.equal(player.y,5.3,'a deck within reach still carries the pushed player');
console.log('PASS pushed bodies keep their own deck: no lift onto an overpass');
}
const camera=new THREE.PerspectiveCamera(60,1,.1,2000);
camera.position.set(0,3,0);camera.lookAt(0,2,-200);camera.updateMatrixWorld();
let placements=0;
const spawnVehicle={...ai,place(x,z,heading){placements++;Object.assign(this,{x,z,heading});return true;}};
const spawner={active:false,parked:0,cursor:0,vehicle:spawnVehicle,entry:{id:'truck'},group:{visible:false},roads:{deckHeight:()=>null},
 frustum:new THREE.Frustum(),matrix:new THREE.Matrix4(),sphere:new THREE.Sphere(new THREE.Vector3(),12),
 paths:[{cumulative:[0,1000],at:(_along,_side,out)=>Object.assign(out,{x:0,z:-200,heading:0})}],
 terrain:{heightAt:()=>0},contacts:{allows:()=>true},obstacles:()=>[],traffic:[],onRoad:[],hide:PointTupperDriver.prototype.hide};
PointTupperDriver.prototype.update.call(spawner,camera,{...ai,x:0,z:200},true,'car');
assert.equal(placements,0,'in-view spawn is refused');
camera.lookAt(0,2,200);camera.updateMatrixWorld();
// A hidden start at a deck (or under one) is refused: a place with no reference stands on land.
spawner.roads.deckHeight=()=>3;
PointTupperDriver.prototype.update.call(spawner,camera,{...ai,x:0,z:200},true,'car');
assert.equal(placements,0,'no start at a bridge deck');assert.equal(spawner.active,false);assert.equal(spawner.cursor,2,'the next try moves along');
spawner.roads.deckHeight=()=>null;
PointTupperDriver.prototype.update.call(spawner,camera,{...ai,x:0,z:200},true,'car');
assert.equal(spawner.active,true,'hidden start can appear');assert.deepEqual(spawner.onRoad,[spawnVehicle],'the traffic sees the AI once it is on the road');
camera.lookAt(0,2,-200);camera.updateMatrixWorld();
PointTupperDriver.prototype.update.call(spawner,camera,{...ai,x:1000,z:200},true,'car');
assert.equal(spawner.active,true,'far driver remains while visible');
camera.lookAt(0,2,200);camera.updateMatrixWorld();
PointTupperDriver.prototype.update.call(spawner,camera,{...ai,x:1000,z:200},true,'car');
assert.equal(spawner.active,false,'far hidden driver leaves');assert.equal(spawner.onRoad.length,0,'the traffic stops seeing it');
{
const near={...spawner,active:false,cursor:0,onRoad:[],vehicle:{...ai,place(x,z,heading){Object.assign(this,{x,z,heading});return true;}},group:{visible:false},
 traffic:[{active:true,side:1.65,solid:{x:0,z:-180,heading:0}}]};
camera.lookAt(0,2,200);camera.updateMatrixWorld();
PointTupperDriver.prototype.update.call(near,camera,{...ai,x:0,z:200},true,'car');
assert.equal(near.active,false,'no hidden start within 35 m of a traffic car');
near.traffic[0].active=false;PointTupperDriver.prototype.update.call(near,camera,{...ai,x:0,z:200},true,'car');
assert.equal(near.active,true,'the same start once the traffic car is gone');
}
console.log('PASS real camera frustum hidden spawn and far hidden despawn');

// Fleet switching: the hide rule follows the kind the player drives NOW, not the boot vehicle.
{
const built=[];
const make=entry=>{
 const geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),root=new THREE.Group(),record={id:entry.id,geometry:false,material:false};
 geometry.addEventListener('dispose',()=>record.geometry=true);material.addEventListener('dispose',()=>record.material=true);
 root.add(new THREE.Mesh(geometry,material));built.push(record);
 const vehicle={x:0,z:0,y:0,heading:0,speed:0,vx:0,vz:0,spec:entry.spec,place(x,z,heading){Object.assign(this,{x,z,heading});return true;}};
 return {rig:{root},vehicle};
};
// The narrow road admits the side by side (half width .915 + 1.8) but not the pickup (1.22 + 1.8).
const narrow={kind:2,halfWidth:2.9,pts:[[400,-300],[400,300]]};
const roads={roads:[{kind:2,halfWidth:6,pts:[[0,-1500],[0,1500]]},narrow],deckHeight:()=>null};
const d=new PointTupperDriver(roads,{heightAt:()=>0},{allows:()=>true},'truck',0,()=>.5,make);assert.equal(d.low,false);
assert.equal(d.entry.id,'sxs','boot pick with a pickup player');assert.equal(d.builds,1);
assert.equal(d.paths.length,4,'side by side samples both roads, both ways');assert.equal(d.eligible(narrow),true);
const cam=new THREE.PerspectiveCamera(60,1,.1,2000);cam.position.set(0,3,0);
const look=z=>{cam.lookAt(0,2,z);cam.updateMatrixWorld();};
const player={...ai,spec:GARAGE.find(e=>e.id==='sxs').spec,x:0,z:-800};
d.vehicle.place(0,-200,0);d.active=d.group.visible=true;
look(-200);d.update(cam,player,true,'sxs');
assert.equal(d.active,true,'same kind as the player stays while in view');assert.equal(d.builds,1,'no rebuild while seen');
look(200);d.update(cam,player,true,'sxs');
assert.equal(d.active,false,'same kind leaves once out of view');assert.equal(d.group.visible,false);
for(let i=0;i<60&&!d.active;i++)d.update(cam,player,true,'sxs');
assert.equal(d.active,true,'a hidden respawn follows');
assert.notEqual(d.entry.id,'sxs','respawn is a kind the player is not driving');assert.notEqual(d.entry.id,'horse');
assert.equal(d.builds,2,'exactly one rebuild, at the hidden swap');
assert.deepEqual(built.map(b=>b.id),['sxs',d.entry.id]);
assert.ok(built[0].geometry&&built[0].material,'old rig GPU buffers are freed');assert.equal(d.group.children.length,1,'one AI rig in the scene');
assert.equal(d.entry.id,'truck');assert.equal(d.paths.length,2,'paths rebuilt for the pickup: the narrow road drops out');
assert.equal(d.eligible(narrow),false,'live width filter follows the new rig');
for(let i=0;i<10;i++)d.update(cam,player,true,'bike');
assert.equal(d.builds,2,'a different player kind never rebuilds');
// Live era: the enable rule reads the era each frame; a runtime swap to 1884 hides the AI at once, even in view.
let era={modern:true};const live=()=>driverLive(era.modern,false);
assert.equal(driverLive(true,false),true);assert.equal(driverLive(false,false),false);assert.equal(driverLive(true,true),false);
d.vehicle.place(0,-200,0);d.active=d.group.visible=true;look(-200);
d.update(cam,player,live(),'bike');assert.equal(d.active,true);
era={modern:false};d.update(cam,player,live(),'bike');
assert.equal(d.active,false,'1884 hides the AI in view');assert.equal(d.group.visible,false);
for(let i=0;i<20;i++)d.update(cam,player,live(),'bike');
assert.equal(d.active,false,'no spawn in 1884');
era={modern:true};look(200);for(let i=0;i<60&&!d.active;i++)d.update(cam,player,live(),'bike');
assert.equal(d.active,true,'back in today it returns from a hidden start');
console.log('PASS fleet switch: same kind stays in view, leaves hidden, one rebuild to another kind, old rig freed; live era gate');
}

// Ambient traffic and the junction signals: the AI keeps its distance behind a traffic car in its own line and stops
// at a red or amber it can still stop for. The stop comes from the real signal rule, so the forward vector is checked.
{
const { trafficGap, signalGap } = await import('../web/src/point-tupper-driver.ts');
const { signalStopDistance } = await import('../web/src/traffic-signal-rules.ts');
const car=(x,z,active=true,heading=0,side=1.65)=>({active,side,solid:{x,z,heading}});
const bumper=25-spec.halfLength-2.25;
// The AI at (1.6, 0) heading 0 drives toward -z.
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(1.6,-25)]),bumper,'traffic car ahead in the own line, bumper to bumper');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(-1.6,-25,true,Math.PI)]),Infinity,'oncoming car in the other lane is not in the way');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(-1.6,-25,true,0)]),Infinity,'a car going the same way in the other lane is not in the way');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(-.2,-25,true,Math.PI,.2)]),bumper,'an oncoming car pulled out to pass is in the way');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(1.6,25)]),Infinity,'a car behind is not in the way');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(-.6,-25,true,Math.PI,1.65)]),Infinity,'an oncoming car keeping its own lane is not in the way, even 2.2 m across (a narrow road, the AI near the centre line)');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(-8.4,-25,true,Math.PI,.2)]),Infinity,'an oncoming car pulled out on a road 10 m to the side is not in the way');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(1.6,-25,true,Math.PI-1e-3,.2)]),bumper,'pulled out, a hair off 180 degrees');
// A car crossing at a junction (about 90 degrees either way) straight ahead.
for(const heading of [Math.PI/2-.3,Math.PI/2,Math.PI/2+.3,-Math.PI/2-.3,-Math.PI/2,-Math.PI/2+.3]) for(const d of [6,10,18]) {
 assert.ok(Math.abs(trafficGap(0,0,0,spec.halfWidth,spec.halfLength,[car(1,-d,true,heading)])-(d-spec.halfLength-.9))<1e-9,`a car crossing ${d} m ahead (heading ${heading.toFixed(2)}) is in the way`);
 assert.equal(trafficGap(0,0,0,spec.halfWidth,spec.halfLength,[car(9,-d,true,heading)]),Infinity,`a car crossing ${d} m ahead but 9 m to the side is not`);
}
assert.equal(trafficGap(0,0,0,spec.halfWidth,spec.halfLength,[car(0,-30,true,Math.PI/2)]),Infinity,'a car crossing 30 m ahead: not yet');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(1.6,-25,false)]),Infinity,'a pooled car is not on the road');
assert.equal(trafficGap(1.6,0,0,spec.halfWidth,spec.halfLength,[car(1.6,-60)]),Infinity,'beyond 40 m is not in the way');
assert.ok(Math.abs(trafficGap(0,0,Math.PI/2,spec.halfWidth,spec.halfLength,[car(25,0,true,Math.PI/2)])-bumper)<1e-9,'heading east: ahead is +x');
// Right-hand bends (centre of the turn to the east): the AI's lane has radius R, the other lane R + 3.25.
for(const kind of GARAGE.filter(e=>e.id!=='horse')) for(const R of [60,100,200,300]) {
 const k=kind.spec,on=(radius,theta,heading,side)=>car(R-radius*Math.cos(theta),-radius*Math.sin(theta),true,heading,side);
 for(let arc=8;arc<=40;arc+=4) {
  const theta=arc/R;
  assert.equal(trafficGap(0,0,0,k.halfWidth,k.halfLength,[on(R+3.25,theta,theta+Math.PI,1.65)]),Infinity,`${kind.id} R ${R}: an oncoming car ${arc} m round the bend in the other lane is not in the way`);
  const ahead=trafficGap(0,0,0,k.halfWidth,k.halfLength,[on(R,theta,theta,1.65)]);
  if(R*Math.sin(theta)<40) assert.ok(ahead<Infinity,`${kind.id} R ${R}: a car ${arc} m round the bend in the own lane is in the way`);
 }
}
// One stop line 20 m north of the AI, for traffic coming from the south (outward vector +z). Phase 0 is red at 30 s.
const stops=[{x:1.6,z:-20,dx:0,dz:1,halfWidth:5,phase:0,junction:{offset:0}}];
const hook=seconds=>({stopDistance:(x,z,fx,fz)=>signalStopDistance(stops,seconds,x,z,fx,fz)});
assert.equal(signalGap(hook(30),1.6,0,0,8),20,'red ahead, stoppable at 8 m/s');
assert.equal(signalGap(hook(25),1.6,0,0,8),20,'amber also stops');
assert.equal(signalGap(hook(5),1.6,0,0,8),Infinity,'green: carry on');
assert.equal(signalGap(hook(30),1.6,0,Math.PI,8),Infinity,'driving away from the line');
assert.equal(signalGap(hook(30),1.6,-25,0,8),Infinity,'already across the line');
assert.equal(signalGap(hook(30),1.6,-18,0,8),Infinity,'too close to stop at 8 m/s: clears the junction');
assert.equal(signalGap(null,1.6,0,0,8),Infinity,'no signals');
stops[0].z=0;assert.equal(signalGap(hook(30),1.6,0,0,0),0,'stopped on the line at a red: stays');stops[0].z=-20;
// In a step: a traffic car or a near red line brakes the AI; the same car in the other lane does not.
const straightRoad={kind:2,halfWidth:5,pts:[[1.6,100],[1.6,-500]]};
const stepWith=(traffic,signals,player={...ai,x:500,z:500},tune)=>{
 let seen;const v={x:1.6,z:0,y:0,heading:0,spec,speed:6,vx:0,vz:-6,update:(_dt,input)=>{seen=input;},place(x,z,heading){Object.assign(this,{x,z,heading});return true;}};
 const actor={active:true,vehicle:v,parked:0,contact:{y:0},obstacles:()=>[],traffic,signals,eligible:()=>true,tune,
  contacts:{resolve:()=>{},allows:()=>true},terrain:{withGroundContact:(_c,run)=>run()},
  roads:{nearest:(x,z)=>({road:straightRoad,x:1.6,z,dist:Math.abs(x-1.6),heading:0})}};
 PointTupperDriver.prototype.step.call(actor,1/120,player);return seen;
};
// The player (and any body) stops the AI only when in its way: ahead in its line or crossing, or about to touch.
const at=(x,z,heading=0)=>({...ai,x,z,heading,speed:0,vx:0,vz:0});
for(const [label,player,brake] of [
 ['player 10 m ahead in the lane',at(1.6,-10),true],
 ['player 20 m ahead coming head-on in the AI lane',at(1.6,-20,Math.PI),true],
 ['player crossing 12 m ahead',at(1.6,-12,Math.PI/2),true],
 ['player 8 m behind, stopped (a queue at the lights)',at(1.6,8),false],
 ['player alongside in the other lane (overtaking)',at(-1.6,-2),false],
 ['player 10 m ahead coming the other way in the other lane',at(-1.6,-10,Math.PI),false],
 ['player stopped on the verge 6 m to the side',at(7.6,-5),false],
 ['player 25 m behind',at(1.6,25),false],
]) assert.equal(stepWith([],null,player).handbrake,brake,label);
assert.equal(stepWith([],null,at(1.6,2*spec.halfLength+.5)).handbrake,true,'player half a metre behind (about to touch): brake');
assert.equal(stepWith([],null).handbrake,false,'open road: no brake');
assert.equal(stepWith([car(1.6,-18)],null).handbrake,true,'traffic car 13.5 m ahead: brake');
assert.equal(stepWith([car(-1.6,-18,true,Math.PI)],null).handbrake,false,'oncoming traffic car in the other lane: no brake');
stops[0].z=-4;
assert.equal(stepWith([],hook(30)).handbrake,true,'red line 4 m ahead: brake');
assert.equal(stepWith([],hook(5)).handbrake,false,'green line 4 m ahead: no brake');
// Bridges (#156): every re-place in a step passes the body's height, so a deck the AI drives on still carries it.
// 'stray': the nearest road runs across the AI's heading and it is off the road, so it rolls back to the old pose.
for(const allows of [true,false,'stray']) {
 const refs=[];
 const v={x:1.6,z:0,y:12.5,heading:0,spec,speed:6,vx:0,vz:-6,update:()=>{v.y=12.6;},place(x,z,heading,ref){refs.push(ref);Object.assign(this,{x,z,heading});return true;}};
 const actor={active:true,vehicle:v,parked:0,contact:{y:0},obstacles:()=>[],traffic:[],signals:null,eligible:()=>true,
  contacts:{resolve:()=>{},allows:()=>allows!==false},terrain:{withGroundContact:(_c,run)=>run()},
  roads:{nearest:(x,z)=>allows==='stray'?{road:straightRoad,x:1.6,z,dist:9,heading:Math.PI/2}:{road:straightRoad,x:1.6,z,dist:Math.abs(x-1.6),heading:0}}};
 PointTupperDriver.prototype.step.call(actor,1/120,{...ai,x:500,z:500});
 assert.deepEqual(refs,[allows===true?12.6:12.5],allows===true?'lane keeping re-places at the body height':`a rollback (${allows}) re-places at the old pose height`);
}
// A tuned driver (the Boss) keeps a closer gap to bodies, but still stops short of a red line, not in the junction.
{
 const { followSpeed } = await import('../web/src/boss-rules.ts');
 const boss={kind:'car',speed:(gap,ahead)=>followSpeed(gap,ahead,20),stopGap:3};
 assert.equal(stepWith([],hook(30),undefined,boss).handbrake,true,'tuned: red line 4 m ahead: brake');
 assert.equal(stepWith([],hook(5),undefined,boss).handbrake,false,'tuned: green line 4 m ahead: no brake');
 stops[0].z=-8;
 const near=stepWith([],hook(30),undefined,boss);
 assert.ok(near.handbrake||near.throttle<=0,'tuned: red line 8 m ahead: no more throttle');
 stops[0].z=-4;
}
console.log('PASS ambient traffic gap in the own line only; red and amber stop lines from the real signal rule; re-places keep the deck');
}

// LOW rigs: the parked display models with their riders, drivable. Front wheels steer about their own centre.
{
const { drivableDisplay, fleetDisplay, DISPLAY_KINDS } = await import('../web/src/fleet-models.ts');
const { Vehicle } = await import('../web/src/vehicle.ts');
const { legacyVehicle } = await import('../web/src/ride.ts');
const count=root=>{let draws=0;root.updateMatrixWorld(true);root.traverseVisible(o=>{if(o.isMesh)draws+=Array.isArray(o.material)?Math.max(1,o.geometry.groups.length):1;});return draws;};
const world=o=>{o.updateWorldMatrix(true,false);return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);};
const flat={heightAt:()=>0,meshHeightAt:()=>0,surfaceAt:()=>({ground:0,level:8,canopy:0,kind:2,washboard:false,roadDist:0,halfWidth:4}),withGroundContact:(_,f)=>f(),withContactHeight:(_,f)=>f(),low:true,exag:1,seaLevel:-5};
const noRoads={roads:[],nearest:()=>null,deckHeight:()=>null};
const draws={};
for(const id of DISPLAY_KINDS) {
 const rig=drivableDisplay(id), parked=fleetDisplay(id), entry=GARAGE.find(e=>e.id===id);
 draws[id]=count(rig.root);
 if(id!=='bike') {
  // Same pose as the parked copy, and the steering pivot now sits on the wheel.
  for(const w of ['fl','fr','rl','rr']) assert.ok(world(rig.wheels[w]).distanceTo(world(parked.wheels[w]))<1e-6,`${id} ${w}: same wheel place as the parked model`);
  for(const w of ['fl','fr']) { const before=world(rig.wheels[w]); rig.steer[w].rotation.y=.5; assert.ok(world(rig.wheels[w]).distanceTo(before)<1e-6,`${id} ${w}: steering turns the wheel about itself`); rig.steer[w].rotation.y=0; }
  // The display batches drop the rider for the parked copies; the AI's keeps it, in the body batch.
  let tri=0,ptri=0; rig.body.traverse(o=>{if(o.isMesh)tri+=(o.geometry.attributes.position.count)/3;}); parked.body.traverse(o=>{if(o.isMesh)ptri+=(o.geometry.attributes.position.count)/3;});
  if(id==='sxs') assert.ok(tri>ptri,'side by side: the rider is in the AI body batch');
 } else assert.equal(rig.bikeMesh && rig.root.getObjectsByProperty('isSkinnedMesh',true).filter(m=>m.visible).length,2,'dirt bike: bike and rider');
 const v=entry.ride?legacyVehicle(entry.ride(rig,flat,noRoads,-5,entry.spec)):new Vehicle(rig,flat,noRoads,-5,entry.spec);
 assert.ok(v.place(0,0,0),`${id}: placed`);
 const start={x:v.x,z:v.z};
 for(let i=0;i<240;i++) v.update(1/60,{throttle:1,steer:i>120?.4:0,handbrake:false},()=>{});
 const moved=Math.hypot(v.x-start.x,v.z-start.z);
 assert.ok(moved>5,`${id}: the LOW rig drives (${moved.toFixed(1)} m)`);
 assert.ok(Math.abs(v.heading)>.05,`${id}: the LOW rig steers (heading ${v.heading.toFixed(3)})`);
 for(let i=0;i<240;i++) v.update(1/60,{throttle:0,steer:0,handbrake:true},()=>{});
 assert.ok(Math.abs(v.speed)<.5,`${id}: the LOW rig stops (${v.speed.toFixed(2)} m/s)`);
}
assert.deepEqual(draws,{truck:7,sxs:5,bike:2},'LOW AI draws per kind');
assert.throws(()=>drivableDisplay('car'),/No display model for car/,'only the display kinds are drivable on LOW');
// A LOW driver builds display rigs and never the car.
const lowDriver=new PointTupperDriver({roads:[{kind:2,halfWidth:6,pts:[[0,-1500],[0,1500]]}]},{heightAt:()=>0},{allows:()=>true},'truck',0,()=>.5,undefined,true);
assert.equal(lowDriver.low,true);assert.notEqual(lowDriver.entry.id,'car');lowDriver.group.visible=true;assert.equal(count(lowDriver.group),draws[lowDriver.entry.id],'LOW driver mounts the display rig');
console.log('PASS LOW AI: display models with riders drive, steer and stop; pivots on the wheels; truck 7, side by side 5, bike 2 draws; no car');
}
