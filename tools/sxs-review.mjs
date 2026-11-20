// Analytic fixtures isolate conservation and coordinate errors; performance targets remain on real game land.
import {createHash} from 'node:crypto';
import {Vehicle as PreviousVehicle} from 'sxs-previous-vehicle';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {TRUCK_SPEC} from '../web/src/truck.ts';
import {posedEnvelopeCoverage} from './sxs-envelope.mjs';
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {createSxs,SXS_SPEC} from '../web/src/sxs.ts';
import {tyreContacts} from './sxs-contact.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const dt=1/120,results=[],check=(name,ok,data)=>{results.push({name,ok,data});console.log(ok?'PASS':'FAIL',name,JSON.stringify(data,(key,value)=>key==='samples'?undefined:value));};
const roads={roads:[],nearest:()=>null,deckHeight:()=>null};
function ground(pitch=0,roll=0){const h=(x,z)=>Math.tan(roll)*x-Math.tan(pitch)*z;return{heightAt:h,surfaceAt:(x,z)=>({kind:9,deck:true,ground:h(x,z),roadDist:0,halfWidth:10000,canopy:0,level:8}),withContactHeight:(_p,f)=>f()};}
function tiny(){const root=new THREE.Group(),body=new THREE.Group();root.add(body);return{root,body,wheels:Object.fromEntries(['fl','fr','rl','rr'].map(k=>[k,new THREE.Group()])),steer:{fl:new THREE.Group(),fr:new THREE.Group()},driverEye:new THREE.Object3D(),brakeLights:[]};}
function car(spec=SXS_SPEC,rig=tiny(),terrain=ground()){const v=new Vehicle(rig,terrain,roads,-10000,spec);v.assist=0;v.place(0,0,0);return v;}
function speed(v,n){v.vx=Math.sin(v.heading)*n;v.vz=-Math.cos(v.heading)*n;v.speed=n;}
function run(v,seconds,input,visit=()=>{}){for(let i=0;i<seconds/dt;i++){v.update(dt,typeof input==='function'?input(i):input);visit(v,i);}}
const go={throttle:1,steer:0,handbrake:false},turn={...go,steer:1};
const straight=car();run(straight,120,go);const top=Math.hypot(straight.vx,straight.vz);
// Level synthetic surfaces isolate the speed targets from grade and steering on the real-highway row.
const levelTop=(spec,kind)=>{
 const terrain=ground(),sample=terrain.surfaceAt;
 terrain.surfaceAt=(x,z)=>({...sample(x,z),kind,deck:false});
 const v=car(spec,tiny(),terrain);run(v,120,go);return v.speed*3.6;
};
const gravelTop=levelTop(SXS_SPEC,3),trackTop=levelTop(SXS_SPEC,4);
const looseTopOK=(gravel,track)=>Math.abs(gravel-155)<=2&&Math.abs(track-155)<=2;
check('sxs_firm_loose_ground_155_kph',looseTopOK(gravelTop,trackTop),{gravelTop,trackTop});
const oldSxs={...SXS_SPEC,enginePower:175,aeroDrag:.003};
check('sxs_speed_pin_rejects_previous_tune',!looseTopOK(levelTop(oldSxs,3),levelTop(oldSxs,4)),{});
const pavedTruck=levelTop(TRUCK_SPEC,9);
check('pickup_level_pavement_160_to_170_kph',pavedTruck>=160&&pavedTruck<=170,{pavedTruck});
const powered=car();let peak=0;run(powered,60,turn,v=>peak=Math.max(peak,Math.hypot(v.vx,v.vz)));
check('energy_powered_full_lock',peak<=top+.02,{peak,straightTop:top,forward:powered.speed});
const coast=car();run(coast,10,turn);let previous=Math.hypot(coast.vx,coast.vz),increase=0,start=previous;run(coast,15,{...turn,throttle:0},v=>{const s=Math.hypot(v.vx,v.vz);increase=Math.max(increase,s-previous);previous=s;});
check('energy_coasting_turn',increase<1e-9,{start,end:previous,maxStepIncrease:increase});
let seed=0x535853;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const drift=car({...SXS_SPEC,engineAcceleration:0,enginePower:0,aeroDrag:0,hardSteerDrag:0});speed(drift,35);drift.vx=-25;let error=0,prior=(drift.vx**2+drift.vz**2)/2,ask=0;run(drift,60,i=>{if(i%60===0)ask=.9+random()*.1;return{throttle:0,steer:ask,handbrake:false};},v=>{const n=(v.vx*v.vx+v.vz*v.vz)/2;error=Math.max(error,n-prior);prior=n;});
check('energy_random_steering_60s',error<1e-9,{maxStepEnergyIncrease:error,finalSpeed:Math.sqrt(2*prior)});
function dense(rig,h){rig.root.updateMatrixWorld(true);return Object.entries(rig.wheels).map(([name,w])=>{let gap=Infinity;w.traverse(n=>{if(!n.isMesh||n.material.name!=='Graphite rubber and upholstery')return;const p=n.geometry.attributes.position,v=new THREE.Vector3();for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(n.matrixWorld);gap=Math.min(gap,v.y-h(v.x,v.z));}});return{name,gap};});}
for(const [pitch,roll]of [[Math.PI/6,0],[0,Math.PI/6]]){
 const rig=createSxs(),terrain=ground(pitch,roll),v=car(SXS_SPEC,rig,terrain);v.pitch=pitch;v.roll=roll;v.captureGround();v.update(dt,{throttle:0,steer:0,handbrake:false});const contacts=dense(rig,terrain.heightAt);
 check(pitch?'travel_30deg_climb':'travel_30deg_cross_slope',contacts.every(c=>Math.abs(c.gap)<.006),contacts);
}
{
 const terrain=ground(.11),plane=terrain.heightAt;terrain.heightAt=(x,z)=>1+plane(x,z);terrain.meshHeightAt=()=>0;terrain.surfaceAt=(x,z)=>({kind:9,ground:terrain.heightAt(x,z),roadDist:0,halfWidth:10000,canopy:0,level:8});terrain.sites=[{deckHeight:terrain.heightAt}];
 const rig=createSxs(),v=car(SXS_SPEC,rig,terrain);v.pitch=.11;v.captureGround();v.update(dt,{throttle:0,steer:0,handbrake:false});const contacts=dense(rig,terrain.heightAt);
 check('travel_separate_deck_above_land',contacts.every(c=>Math.abs(c.gap)<.006),contacts);
}
const rig=createSxs(),theta=20*Math.PI/180,terrain=ground(theta),v=car(SXS_SPEC,rig,terrain);v.pitch=theta;v.sync(0);
// A wheel rotated into the plane stands correctly without relying on the Vehicle travel calculation.
const trueGaps=dense(rig,terrain.heightAt),lift=-Math.min(...trueGaps.map(c=>c.gap));rig.root.position.y+=lift;
const geometry=new THREE.PlaneGeometry(40,40);geometry.rotateX(-Math.PI/2);geometry.rotateX(theta);const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})),land=new THREE.Group();land.add(mesh);land.updateMatrixWorld(true);
const sensed=tyreContacts(THREE,rig,[land]),truth=dense(rig,terrain.heightAt),sensorError=Math.max(...sensed.map((c,i)=>Math.abs((c.deepest??c.gap)-truth[i].gap)));
check('contact_same_horizontal_vertex',sensorError<.002,{sensorError,sensed,truth});
for(const [name,dy]of [['sunk',-.08],['floating',.08]]){rig.root.position.y+=dy;const a=tyreContacts(THREE,rig,[land]);rig.root.position.y-=dy;check(`contact_reject_${name}`,a.every(c=>Math.abs((c.deepest??c.gap)-dy)<.006),a);}
rig.root.position.y-=.05;const masked=tyreContacts(THREE,rig,[land]);rig.root.position.y+=.05;
const falselySeated=masked.every(c=>c.ray&&(c.deepest??c.gap)>-.04&&(c.largestFloat??Math.max(0,c.gap))<.04);
check('contact_4cm_gate_rejects_5cm_sink',!falselySeated,{reported:masked.map(c=>c.deepest??c.gap),falselySeated});
const tyre=rig.wheels.fl.children.find(n=>n.isMesh&&/rubber/i.test(n.material.name));tyre.position.y-=.08;const moved=tyreContacts(THREE,rig,[land]),actual=dense(rig,terrain.heightAt);tyre.position.y+=.08;
check('contact_tracks_tyre_mesh_motion',Math.abs((moved[0].deepest??moved[0].gap)-actual[0].gap)<.002,{measured:moved[0].deepest??moved[0].gap,actual:actual[0].gap});
// The main-line controller is the durable oracle. Baseline mode also proves 38bf76d matches that same oracle.
function oracleTrace(Type,spec){const terrain=ground(),v=new Type(tiny(),terrain,roads,-10000,spec);v.assist=0;v.place(0,0,0);let seed=0x434152;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};const hash=createHash('sha256');
 for(let i=0;i<3600;i++){v.update(dt,{throttle:i%1200<900?1:-1,steer:Math.sin(i*.007),handbrake:i%600>550});hash.update(JSON.stringify([v.x,v.z,v.y,v.heading,v.vx,v.vz,v.vy,v.speed,v.pitch,v.roll,v.car.body.rotation.toArray(),v.car.body.position.y]));}return hash.digest('hex');}
// The trace pulls the handbrake with the wheel turned, which now starts a drift (drift-rules.ts, tools/drift-rules-check.mjs):
// with the drift off the controller stays bit-identical to the oracle.
for(const [name,spec]of [['car',CAR_SPEC],['truck',TRUCK_SPEC]]){const previous=oracleTrace(PreviousVehicle,spec),current=oracleTrace(Vehicle,{...spec,drift:undefined});check(`${name}_bit_identical_legacy`,current===previous,{previous,current});}
check('oracle_rejects_changed_power',oracleTrace(Vehicle,{...CAR_SPEC,enginePower:0})!==oracleTrace(PreviousVehicle,CAR_SPEC),{});
const model=createSxs();model.root.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model.root,true),e=SXS_SPEC.envelope,ends=[Math.max(...e.circles)+e.radius+box.min.z,e.radius-Math.min(...e.circles)-box.max.z];
check('envelope_nose_tail_overreach',ends.every(n=>n<=.15+1e-6),{nose:ends[0],tail:ends[1]});
const posed=posedEnvelopeCoverage(createSxs(),SXS_SPEC);check('envelope_posed_vertex_posts',posed.misses===0&&posed.unresolved===0,posed);
const source=process.env.SXS_REVIEW_BASELINE?execFileSync('git',['show',`${process.env.SXS_REVIEW_BASELINE}:web/src/sxs.ts`],{encoding:'utf8'}):readFileSync('../web/src/sxs.ts','utf8');
const trailing=source.split('\n').flatMap((line,i)=>/[\t ]+$/.test(line)?[i+1]:[]);check('source_no_trailing_whitespace',trailing.length===0,{lines:trailing});
if(!process.argv.includes('--explore'))assert.deepEqual(results.filter(r=>!r.ok).map(r=>r.name),[],'SXS review regressions');
