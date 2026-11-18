// Bundle and run with esbuild, as for shift-check.mjs. Uses the real controller and prop reset hooks.
import assert from 'node:assert/strict';
import { Shift } from '../web/src/shift.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { MAIL_CYCLE } from '../web/src/mail-flight.ts';
import { Mail } from '../web/src/mail.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { Ruts } from '../web/src/ruts.ts';
import { propsData, roads as bakedRoads, village, terrain as bakedTerrain } from './shift-fixture.mjs';
import { Evidence } from '../web/src/evidence.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
class Element {
  hidden = false; textContent = ''; scrollTop = 0; width = 160; height = 90; children = []; listeners = new Map();
  classList = { add() {}, remove() {} };
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  after() {}
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  focus() {} getContext() { return { drawImage() {} }; }
  click() { this.listeners.get('click')?.(); }
}
const elements = new Map();
globalThis.document = { getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }, createElement() { return new Element(); } };
Object.defineProperty(globalThis, 'localStorage', { get() { throw Error('Storage unavailable'); } });
const terrain = { heightAt() { return 0; }, surfaceAt() { return { ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }; } };
const roads = new Roads({ roads: [{ id: 7, name: 'Birch Street', kind: 2, halfWidth: 3, bridge: false, pts: [[0, 0], [1000, 0]] }] }, [0,0], terrain);
const props = new Props({ crs: 'EPSG:2961', mailboxes: Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 10, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false })), communityBoxes: [{x:400,y:0,heading:0,modules:2}], poles: [] }, [0,0], terrain);
const mail = { delivered: 0, lawn: 0, ditch: 0, reset() { this.delivered = this.lawn = this.ditch = 0; }, get down() { return props.downCount; } };
let restarts = 0;
const shift = new Shift(props, mail, roads, terrain, [], [0,0], true, new URLSearchParams('day=1&run=8'), () => { restarts++; });
assert.equal(shift.career.day,1); assert.ok(props.downCount>=1 && props.downCount<=2);
const firstDraw = JSON.stringify(shift.today);
shift.roadside.push({hint: 'A roadside scene', reportLine: () => 'Mabou Mines Road: a fish truck, a parked car and a cow. Nobody knows how it ended.'});
const controllerCamera = new THREE.PerspectiveCamera(58,1,.1,100); controllerCamera.updateProjectionMatrix();
assert.doesNotThrow(()=>shift.takePhoto({x:0,z:0,heading:0},controllerCamera));
assert.equal(shift.evidence.photos.length,1);
const stuffed = shift.today.stuffed.findIndex(Boolean), box = props.mail[stuffed];
assert.equal(mail.service.condition(stuffed), 'stuffed');
const vehicle = { x: box.x, z: box.z, vx: 0, vz: 0, heading: 0, airborne: false };
shift.update(2, vehicle); assert.equal(shift.elapsed,40); assert.equal(shift.today.stuffed[stuffed],true);
vehicle.vx = 1; shift.update(.1, vehicle); vehicle.vx = 0;
shift.update(3.9, vehicle); assert.equal(shift.today.stuffed[stuffed],true,'moving resets cleaning');
shift.update(.11, vehicle); assert.equal(shift.today.stuffed[stuffed],false); assert.equal(mail.service.condition(stuffed),'ready');
const stop = shift.remaining.findIndex((n,i) => n>0 && !props.mail[i]?.motion.down && !shift.today.stuffed[i]);
assert.ok(stop >= 0);
const due = shift.remaining[stop];
for (let n=0;n<due;n++) { const complete = mail.service.deliver(stop); assert.equal(complete,n===due-1); mail.delivered++; }
assert.equal(shift.done,1); mail.service.deliver(stop); assert.equal(shift.done,1,'repeat throws do not count extra stops');
shift.end(); assert.equal(shift.ended,true); const frozen = shift.elapsed; shift.update(10, vehicle); assert.equal(shift.elapsed,frozen);
assert.equal(shift.roadsideReport.textContent, 'Mabou Mines Road: a fish truck, a parked car and a cow. Nobody knows how it ended.');
assert.ok(shift.complaints.all.some((c)=>c.kind==='late')); assert.equal(document.getElementById('shiftReport').hidden,false);
document.getElementById('nextDay').click(); assert.equal(shift.career.day,3); assert.equal(shift.career.double,true); assert.equal(shift.career.pay,345); assert.equal(shift.elapsed,0); assert.equal(mail.delivered,0); assert.equal(shift.done,0); assert.equal(restarts,1);
shift.elapsed = 8*3600-1; shift.update(.1,vehicle); assert.equal(shift.ended,true,'18:00 auto-end');
document.getElementById('startOver').click(); assert.equal(shift.career.day,1); assert.equal(shift.career.pay,0); assert.equal(JSON.stringify(shift.today), firstDraw); assert.equal(restarts,2);
const upright = props.mail.findIndex((p)=>!p.motion.down);
props.knockMailbox(upright,4,0); props.knockMailbox(upright,4,0);
assert.equal(shift.complaints.all.filter((c)=>c.kind==='boxDown' && c.target===upright).length,1);
const damages=[];
const ruts=new Ruts(terrain,[{id:99,x:0,y:0,kind:'house'}],[0,0],true,(...args)=>damages.push(args));
const crossing={x:0,z:10,vx:2,vz:0,heading:Math.PI/2,airborne:false};
for(let i=0;i<12;i++){crossing.x=i;ruts.update(crossing,i+1);}
assert.equal(damages.length,1); assert.ok(damages[0][3]<8,'damage time starts with the crossing'); assert.ok(ruts.count>2); assert.equal(ruts.mesh.count,320);
ruts.reset(); assert.equal(ruts.count,0); assert.equal(ruts.lawns,0);
// A subject can leave or change after the shutter. The stored photo remains unchanged.
const evidence = new Evidence(), camera = new THREE.PerspectiveCamera(58,1,.1,100);
camera.position.set(0,2,0); camera.lookAt(0,1,-20); camera.updateProjectionMatrix();
const s = evidence.register({ id:'future-obstacle', kind:'obstacle', x:0,z:-20,y:1,radius:2,active:true,blocking:true,road:7,label:'Road blocked' });
assert.equal(evidence.register({id:'simple',kind:'vehicle',x:200,z:200,radius:2}).active,true);
const photo=evidence.take(10,0,0,0,camera); assert.equal(photo.facts.length,1); s.x=300; s.blocking=false; assert.equal(photo.facts[0].x,0); assert.equal(photo.facts[0].blocking,true);
// Exercise the physical mail hook too: rejection bounces, lands, and attributes ground mail.
const realMail = new Mail(terrain, props, [], [0,0], true);
let groundTarget = -1;
realMail.service = { condition: () => 'stuffed', deliver: () => { throw Error('stuffed box must reject'); }, ground: (x,z) => { groundTarget=props.nearestMailbox(x,z,100)?.index ?? -1; } };
const parcel = { x:box.x,z:box.z,vx:4,vz:2,vy:-1,kind:0,rejected:false };
assert.equal(realMail.receive(parcel,stuffed),false); assert.equal(parcel.rejected,true); assert.ok(parcel.vx<0); assert.ok(parcel.vy>0);
realMail.miss(parcel); assert.equal(realMail.ditch,1); assert.equal(groundTarget,stuffed);
realMail.reset(); assert.equal(realMail.ditch,0);
console.log('PASS: real Shift/Props hooks, piece completion, four-second cleaning/reset, clock, report pause, next day, double mail/pay, day-one reset, denied storage, extensible photo snapshots.');

// Reproduce the instant-end failure using the actual road network and controller.
const makeShift=(query)=>{
  const p=new Props(propsData,village,bakedTerrain), m=new Mail(bakedTerrain,p,[],village,true);
  return {p,m,s:new Shift(p,m,bakedRoads,bakedTerrain,[],village,true,new URLSearchParams(query),()=>{})};
};
const instant=makeShift('day=1');instant.s.end();
assert.equal(instant.s.complaints.all.filter(c=>c.kind==='missing').length,3);
assert.equal(instant.s.complaints.all.length,3,'unvisited maintenance and off-run traps do not call');
assert.match(document.getElementById('reportMissed').textContent,/Stops missed: 35 · carried over to tomorrow/);
const carry=instant.s.remaining.slice();document.getElementById('nextDay').click();
assert.equal(instant.s.career.day,3);assert.equal(instant.s.career.double,true);
assert.deepEqual(instant.s.career.carryover,carry);
assert.ok(instant.s.run.rural.every(i=>instant.s.route.runs[2].rural.includes(i)));
// Exercise the real throw, landing and Shift service for every pre-existing down stop.
function physicalDownDrop(p,m,s,index){
  const target=p.mail[index],h=(target.heading-270)*Math.PI/180,eye=new THREE.Object3D();
  const v={x:0,z:0,vx:Math.sin(h)*20/3.6,vz:-Math.cos(h)*20/3.6,heading:h,speed:20/3.6,car:{driverEye:eye},spec:CAR_SPEC};
  const pose=ahead=>{v.x=target.x-Math.cos(h)*2.9-Math.sin(h)*ahead;v.z=target.z-Math.sin(h)*2.9+Math.cos(h)*ahead;
    eye.position.set(v.x+Math.cos(h)*.43+Math.sin(h)*.08,1.36,v.z+Math.sin(h)*.43-Math.cos(h)*.08);eye.updateMatrixWorld();};
  const before=s.remaining[index],misses=m.lawn+m.ditch;
  let found=false;
  for(let ahead=30;ahead>=0;ahead-=.1){pose(ahead);m.prepareThrow(v,MAIL_CYCLE[m.thrown%MAIL_CYCLE.length]);if(m.cue&&m.cueIndex===index){found=true;break;}}
  assert.ok(found,'real pre-existing stop has a physical drop pose on day '+s.career.day+' target '+index);
  const piece=m.cursor;m.update(1/120,v,true);
  for(let frame=0;frame<480&&m.pieces[piece].state==='flying';frame++)m.update(1/120,v,false);
  assert.equal(s.remaining[index],before-1,'physical ground drop reduces real Shift.remaining');
  assert.equal(m.lawn+m.ditch,misses,'authorised drop does not count as a miss');
}
// Clean all runs over three cycles, including flyer/light days and doubled days.
for(let day=1;day<=24;day++){
  const {p,m,s}=makeShift(`day=${day}${day%3===0?'&double=1':''}`);
  for(let i=0;i<s.today.pieces.length;i++)if(!s.route.members.has(i))assert.equal(m.service.condition(i),'none');
  for(const i of s.run.rural.filter(i=>s.today.stuffed[i])){
    const box=p.mail[i];s.update(4.01,{x:box.x,z:box.z,vx:0,vz:0,heading:0,airborne:false});
    assert.equal(s.today.stuffed[i],false);
  }
  for(const i of s.run.rural.filter(i=>s.today.down[i])){
    const box=p.mail[i],v={x:box.x,z:box.z+3,vx:0,vz:0,heading:0,airborne:false};s.update(.7,v);
    const cam=new THREE.PerspectiveCamera(58,1,.1,100);cam.position.set(v.x,2,v.z);cam.lookAt(box.x,.25,box.z);cam.updateProjectionMatrix();
    assert.equal(s.takePhoto(v,cam),true);assert.ok(s.evidence.photos.at(-1).facts.some(f=>f.kind==='preExisting' && f.target===i));
  }
  for(const stop of s.run.stops){
    const i=stop.index,box=i<p.mail.length?p.mail[i]:p.sites[i-p.mail.length];
    s.update(.01,{x:box.x,z:box.z+2,vx:0,vz:0,heading:0,airborne:false});
    if(i<p.mail.length && s.today.down[i]){
      assert.equal(p.mailHit(box.x,1,box.z,box.x,0,box.z,true,undefined,()=> 'ground'),i,'pre-existing post accepts the service-authorised ground drop');
      while(s.remaining[i]>0)physicalDownDrop(p,m,s,i);
    }
    while(s.remaining[i]>0){
      const piece={x:box.x,z:box.z,vx:0,vz:0,vy:0,kind:0,rejected:false,originX:box.x-20,originZ:box.z};
      assert.equal(m.receive(piece,i),true,`day ${day} target ${i} must accept physical mail`);
    }
  }
  assert.equal(s.done,s.stops);s.end();
  assert.equal(document.getElementById('reportVerdict').textContent,'No action taken.',`clean day ${day}`);
  assert.equal(s.complaints.all.some(c=>c.kind==='late'),s.run.rural.includes(s.route.late));
  if(s.run.rural.includes(s.route.late))assert.ok(document.getElementById('reportCalls').children.some(row=>row.children.some(el=>el.textContent==='UPHELD · No defence accepted.')));
}
// A pass within 60m, not an unseen property across the map, triggers maintenance calls.
const passed=makeShift('day=1');
const stuffedTarget=passed.s.today.stuffed.findIndex(Boolean), stuffedBox=passed.p.mail[stuffedTarget];
passed.s.update(.01,{x:stuffedBox.x+59,z:stuffedBox.z,vx:1,vz:0,heading:0,airborne:false});passed.s.end();
assert.ok(passed.s.complaints.all.some(c=>c.kind==='stuffed'&&c.target===stuffedTarget));
const outside=makeShift('day=1');const boxOutside=outside.p.mail[outside.s.today.stuffed.findIndex(Boolean)];
outside.s.update(.01,{x:boxOutside.x+61,z:boxOutside.z,vx:1,vz:0,heading:0,airborne:false});outside.s.end();
assert.equal(outside.s.complaints.all.some(c=>c.kind==='stuffed'&&c.target===outside.s.today.stuffed.findIndex(Boolean)),false);
const overflow=makeShift('day=1&run=8');
for(let i=0;i<12;i++)overflow.m.service.ground(overflow.p.mail[i].x,overflow.p.mail[i].z,false);
overflow.s.end();assert.equal(overflow.s.complaints.all.filter(c=>c.kind==='ditchMail').length,5);
assert.equal(document.getElementById('reportCalls').children.at(-1).textContent,'and 7 more like it');
console.log('PASS: instant day-one end has three calls; 24 clean physical-delivery days get No action taken; pre-existing photos, late calls, persisted carryover, doubled active runs, pass radius, ground overflow report.');

// Low mode never promises a steering pull. Damage still reaches its repair bill.
const lowDamage=makeShift('day=1&damage=alignment');lowDamage.s.update(0,{x:0,z:0,vx:0,vz:0,heading:0,airborne:false});
assert.equal(lowDamage.s.damage.total,55);assert.doesNotMatch(document.getElementById('stopHint').textContent,/pulls left/);
assert.match(document.getElementById('stopHint').textContent,/garage/);
lowDamage.s.update(5.1,{x:0,z:0,vx:0,vz:0,heading:0,airborne:false});assert.equal(lowDamage.s.damage.hintTime,0);
assert.doesNotMatch(document.getElementById('stopHint').textContent,/garage/);
console.log('PASS: low-mode damage hint describes the repair, expires in five seconds, and keeps its bill.');
