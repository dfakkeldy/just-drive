// Pure repair rules plus actual Vehicle, collision and Shift integration. No browser.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Damage, steeringPull, windGain } from '../web/src/damage-rules.ts';
import { freshCareer, nextCareer, readCareer, saveCareer } from '../web/src/shift-rules.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { pushOut } from '../web/src/parked.ts';
const drive = (d, seconds, speed, surface='washboard', depth=0) => { for(let i=0;i<Math.round(seconds*120);i++) d.drive(1/120,speed,surface,depth); };
const careful=new Damage();drive(careful,60,8);drive(careful,60,12,'grass');careful.hit('landing',4.4);careful.hit('impact',4.9);drive(careful,1,3,'grass',1);
assert.equal(careful.total,0,'careful day costs nothing');
const careless=new Damage();drive(careless,6,10);careless.hit('impact',6);assert.equal(careless.total,70);
assert.deepEqual(careless.items.map(i=>i.id),['shock','bumper']);
const wild=new Damage();drive(wild,24,18);wild.hit('impact',12);drive(wild,2.1,0,'pavement');wild.hit('impact',15);
assert.equal(wild.total,293);assert.equal(wild.items.length,4);assert.ok(wild.items.every(i=>i.level===2));
for(let i=0;i<20;i++){drive(wild,24,18);wild.hit('landing',20);wild.hit('impact',20);}assert.equal(wild.total,293,'each item can worsen only once');
const ditch=new Damage();drive(ditch,1,5,'grass',.7);assert.equal(ditch.total,55);drive(ditch,10,5,'grass',.7);assert.equal(ditch.total,55);
drive(ditch,1,5,'grass');drive(ditch,1,5,'grass',.7);assert.equal(ditch.total,85);
const interrupted=new Damage();drive(interrupted,5,9);drive(interrupted,1,8);drive(interrupted,5,9);assert.equal(interrupted.total,0,'slowing resets fast exposure');
const hopping=new Damage();for(let i=0;i<12*120;i++)hopping.drive(1/120,15,'washboard',0,i%2===0);assert.equal(hopping.total,48,'short airborne gaps preserve exposure but do not add it');
const flight=new Damage();for(let i=0;i<100;i++)flight.drive(.1,30,'grass',2,true);assert.equal(flight.total,0);
const land=new Damage();land.hit('landing',5);land.hit('landing',6);assert.equal(land.total,48);drive(land,2.1,0,'pavement');land.hit('landing',5);assert.equal(land.total,96);
assert.equal(nextCareer(freshCareer(),'clear',careless.total).pay,275);
const suspended=nextCareer(freshCareer(),'suspension',wild.total);assert.equal(suspended.day,3);assert.equal(suspended.pay,52,'worked day pays net; skipped day adds zero');
assert.equal(nextCareer(suspended,'clear').pay,397);
let stored=JSON.stringify({day:2,pay:345,warnings:0,double:false,suspended:false});
globalThis.localStorage={getItem:()=>stored,setItem:(_key,value)=>stored=value};assert.deepEqual(readCareer(),{...freshCareer(),day:2,pay:345});
saveCareer(nextCareer(freshCareer(),'clear',70));assert.equal(readCareer().pay,275,'repair deduction survives storage');
const seeded=new Damage();seeded.seed('window,alignment,bumper,bumper,bumper,unknown,__proto__');assert.equal(seeded.total,137);assert.equal(seeded.items.length,3);
assert.equal(windGain(false,25),1);assert.equal(windGain(true,0),1);assert.ok(windGain(true,10)>windGain(true,25));
assert.equal(steeringPull(true,18,false),0);assert.equal(steeringPull(false,18,true),0);assert.equal(steeringPull(true,0,true),0);assert.equal(steeringPull(true,50,true),-.004);
// The real fixed-step physics supplies hard landings, rough exposure and deep ditch samples.
const node=()=>new THREE.Object3D();
const makeVehicle=(surface={},height=()=>0)=>{
 const car={root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
 const terrain={withContactHeight:(body,read)=>read(),heightAt:height,surfaceAt:()=>({ground:0,canopy:0,roadDist:0,halfWidth:3,kind:2,level:8,washboard:false,...surface})};
 const roads={nearest:()=>({x:0,z:0,heading:0,dist:0,road:{kind:2,halfWidth:3,name:'Road'}}),deckHeight:()=>null};
 const v=new Vehicle(car,terrain,roads,-100);v.damage=new Damage();v.damageActive=true;v.assist=0;v.place(0,0,0);return v;
};
const landing=makeVehicle();landing.y=2;landing.vy=-6;landing.airborne=true;for(let i=0;i<120;i++)landing.update(1/120,{throttle:0,steer:0,handbrake:false});assert.equal(landing.damage.items[0].id,'shock');
const slow=makeVehicle({kind:3,washboard:true});for(let i=0;i<30*120;i++){slow.vz=-5;slow.update(1/120,{throttle:0,steer:0,handbrake:false});}assert.equal(slow.damage.total,0,'slow washboard physics stays free');
const rough=makeVehicle({kind:3,washboard:true});for(let i=0;i<8*120;i++){rough.vz=-13;rough.update(1/120,{throttle:1,steer:0,handbrake:false});}assert.ok(rough.damage.total>0);
const deep=makeVehicle({roadDist:5},(x)=>x===0?1:0);deep.place(5,0,0);for(let i=0;i<70;i++){deep.vz=-5;deep.update(1/120,{throttle:0,steer:0,handbrake:false});}assert.ok(deep.damage.pulls);
for(const desktop of [true,false]){const v=makeVehicle();v.damage.seed('alignment');v.desktopPull=desktop;v.vz=-18;v.update(.05,{throttle:0,steer:0,handbrake:false});assert.equal(v.steerAngle<0,desktop);}
const parked=makeVehicle();parked.x=1;parked.vx=-8;pushOut(parked,[{x:0,z:0,heading:0,half:4,halfWidth:1}]);assert.equal(parked.damage.items[0].id,'bumper');
const immune=makeVehicle({kind:3,washboard:true});immune.damageActive=false;immune.y=2;immune.vy=-8;immune.airborne=true;for(let i=0;i<120;i++)immune.update(1/120,{throttle:0,steer:0,handbrake:false});assert.equal(immune.damage.total,0);
// A gravel driveway (kind 4 with the gravel bit, terrain.surfaceAt's `gravel`) drives as gravel; a plain track stays dirt.
for(const [surface,name] of [[{kind:4,halfWidth:1.5,gravel:true},'gravel'],[{kind:4,halfWidth:1.5},'dirt track'],[{kind:3},'gravel']]){const v=makeVehicle(surface);v.update(1/120,{throttle:0,steer:0,handbrake:false});assert.equal(v.surfaceName,name,JSON.stringify(surface));}
seeded.reset();assert.equal(seeded.total,0);assert.equal(seeded.windowStuck,false);assert.equal(seeded.hintTime,0);
console.log('PASS: careful $0, careless $70, wild $293, capped repairs, rough/slow/airborne/ditch/cooldown, pay and suspension, legacy saves, fixtures, wind, actual fixed-step landings/rough/ditch/pull and solid hits.');
