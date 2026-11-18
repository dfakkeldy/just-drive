// Real controller and collision regressions. Run with check-shift.sh; no browser.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { Damage } from '../web/src/damage-rules.ts';
import { Vehicle } from '../web/src/vehicle.ts';
import { Yard } from '../web/src/yard.ts';
import { ParkedVehicles, pushOut } from '../web/src/parked.ts';
const STEP=1/120, input={throttle:0,steer:0,handbrake:false};
const make=(height=()=>0)=>{
 const node=()=>new THREE.Object3D();
 const car={root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
 const terrain={withContactHeight:(body,read)=>read(),heightAt:height,surfaceAt:(x,z)=>({ground:height(x,z),canopy:0,roadDist:3,halfWidth:3,kind:2,level:8,washboard:false})};
 const roads={nearest:()=>({x:0,z:0,heading:0,dist:0,road:{kind:2,halfWidth:3,name:'Road'}}),deckHeight:()=>null};
 const v=new Vehicle(car,terrain,roads,-100);v.damage=new Damage();v.damageActive=true;v.assist=0;v.place(0,0,0);return {v,terrain};
};
let failures=0;
const check=(name,fn)=>{try{fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}};
for(const speed of [0,10])for(const delta of [.1,-.1,1.5,-1.5])check(`ground correction speed=${speed} height=${delta}`,()=>{
 let level=0;const {v}=make(()=>level);
 for(let i=0;i<10;i++){v.vz=-speed;v.update(STEP,input);}
 level=delta;let maxGap=0,maxVy=0,air=false;
 for(let i=0;i<5*120;i++){v.vz=-speed;v.update(STEP,input);maxGap=Math.max(maxGap,Math.abs(v.y-level));maxVy=Math.max(maxVy,Math.abs(v.vy));air||=v.airborne;}
 console.log(JSON.stringify({speed,delta,maxGap,maxVy,air,bill:v.damage.total}));
 assert.ok(maxGap<.001,'car follows corrected ground without flight');assert.ok(maxVy<.001,'correction adds no vertical speed');assert.equal(air,false);assert.equal(v.damage.total,0);
});
const site={origin:{x:0,z:0},yaw:0,world:(u,v)=>({x:u,z:v}),local:(x,z)=>({u:x,v:z}),localDir:(x,z)=>({u:x,v:z}),worldDir:(u,v)=>({x:u,z:v})};
for(const [kind,mass,bill]of [['wreck',9,77],['box',6,77],['cone',.1,0]])check(`yard ${kind} mass=${mass}`,()=>{
 const {v,terrain}=make();const yard=new Yard(site,terrain,true);
 yard.pieces=[{spec:{kind,mass,stage:0,stack:0,tips:false},p:new THREE.Vector3(0,0,-2),yaw:0,vel:new THREE.Vector3(),spin:0,tip:0,moving:false,cool:0,halfLen:kind==='cone'?.2:2.2,rad:kind==='cone'?.2:.9}];
 v.vz=-15;v.speed=15;yard.strike(v);
 console.log(JSON.stringify({kind,speed:v.speed,bill:v.damage.total}));assert.ok(v.speed<15,'collision slows the real car');assert.equal(v.damage.total,bill,'closing speed before slowing determines the bill');
});
check('parked vehicle retains its original closing speed',()=>{
 const {v}=make();const parked=new ParkedVehicles([{x:0,z:-2,heading:Math.PI/2,type:0,colour:0xaaaaaa}],()=>0);
 v.vz=-15;v.speed=15;pushOut(v,parked.solids);assert.equal(v.damage.total,77);assert.ok(v.speed<15);
});
check('inactive damage cannot pull the steering',()=>{
 const {v}=make();v.damage.seed('alignment');v.desktopPull=true;v.damageActive=false;v.vz=-18;v.update(.05,input);assert.equal(v.steerAngle,0);
});
for(const [name,height,width,speed,expected]of [['hard',1.5,10,18,48],['gentle',.25,10,10,0]])check(`real ${name} crest jump`,()=>{
 const {v}=make((_x,z)=>(-z<10?0:-z<20?height*(-z-10)/width:0));let flight=0,landings=[];v.vz=-speed;
 const hit=v.damage.hit.bind(v.damage);v.damage.hit=(cause,s)=>{if(cause==='landing')landings.push(s);hit(cause,s);};
 for(let i=0;i<6*120;i++){v.update(STEP,input);if(v.airborne)flight+=STEP;}
 console.log(JSON.stringify({name,flight,landings,bill:v.damage.total}));assert.ok(flight>.05,'car leaves the ground over the crest');assert.equal(v.damage.total,expected);assert.equal(v.airborne,false,'jump ends on the ground');assert.equal(v.y,0);
});
if(failures)throw Error(`${failures} damage timing case(s) failed`);
