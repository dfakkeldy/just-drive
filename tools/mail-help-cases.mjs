// Bundled by mail-help-check.mjs; no browser, DOM, land data or GPU required.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Mail } from '../web/src/mail.ts';
import { Props } from '../web/src/props.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { planMail, advanceMail } from '../web/src/mail-flight.ts';
const legacy = process.env.MAIL_LEGACY === '1';
const terrain = { heightAt: () => 0, surfaceAt: () => ({ level: 8, roadDist: 20, halfWidth: 3 }) };
const box = { x: 4, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false };
const props = new Props({ crs:'EPSG:2961', mailboxes: [box], communityBoxes: [], poles: [] }, [0,0], terrain);
const mail = new Mail(terrain, props, [], [0,0], true);
const eye = new THREE.Object3D();
const v = { x:0,z:0,y:0,heading:0,vx:0,vz:0,speed:0,car:{ driverEye:eye },spec:CAR_SPEC };
let condition = 'ready';
mail.service = { condition: () => condition, deliver: () => true, ground() {} };
function pose(z, speed, heading = 0) {
  v.z=z; v.heading=heading; v.vx=Math.sin(heading)*speed; v.vz=-Math.cos(heading)*speed; v.speed=speed;
  eye.position.set(v.x + Math.cos(heading)*.43 + Math.sin(heading)*.08, 1.36,
    z + Math.sin(heading)*.43 - Math.cos(heading)*.08); eye.updateMatrixWorld();
}
function reset(help, offset=4, kind=0) {
  mail.reset(); mail.throwHelp=help; mail.thrown=kind;
  props.mail[0].x=offset; props.mail[0].z=0; props.mail[0].served=false; props.mail[0].motion.down=false;
  props.downCount=0; condition='ready'; v.x=0;
}
function finish(z,speed,dt=1/60) {
  for(let k=0;k<360 && mail.delivered===0 && mail.lawn+mail.ditch===0;k++) {
    z-=speed*dt; pose(z,speed); mail.update(dt,v,false);
  }
  return mail.delivered>0;
}
// Frozen 2ae94cc trace: raw IEEE-754 bytes, all piece fields and rotation, all 13 throws.
const hash=createHash('sha256');
for(let kind=0;kind<13;kind++) {
  reset(false,100,kind); condition='none'; pose(12,kind*1.7,.137*kind);
  for(let k=0;k<100;k++) {
    mail.update(k%3===0 ? 1/120 : 1/60,v,k===0);
    const p=mail.pieces[0];
    const values=new Float64Array([p.x,p.y,p.z,p.vx,p.vy,p.vz,p.age,p.spin,p.originX,p.originZ,
      p.rotation.x,p.rotation.y,p.rotation.z,p.resting.x,p.resting.y,p.resting.z,p.resting.w,
      mail.thrown,mail.delivered,mail.lawn,mail.ditch]);
    hash.update(Buffer.from(values.buffer)); hash.update(p.state);
  }
}
const golden=hash.digest('hex');
if(legacy){console.log('PASS legacy raw throw digest '+golden);process.exit(0);}

assert.equal(golden, '823220148e7a1eacd233c05e5c742ca3aa3d6839bdfc1e05d5b0a8f9f891a5ea', 'help-off launch and miss flight retain frozen main bytes');
// Stage 2 deliberately replaces radius/ground deliveries. Exercise the real opening instead.
const headingDegrees = h => h * 180 / Math.PI + 270;
function fixture(heading=0, slope=0, offset=4, kind=0, style=0) {
  const ground = { heightAt: x => slope*x, surfaceAt: terrain.surfaceAt };
  const rx=Math.cos(heading),rz=Math.sin(heading);
  const p=new Props({crs:'EPSG:2961',mailboxes:[{...box,x:rx*offset,y:-rz*offset,heading:headingDegrees(heading),style}],communityBoxes:[],poles:[]},[0,0],ground);
  const m=new Mail(ground,p,[],[0,0],true);m.thrown=kind;
  let state='ready';
  m.service={condition:()=>state,deliver:()=>true,ground(){}};
  const e=new THREE.Object3D();
  const car={x:0,z:0,heading,vx:0,vz:0,speed:0,car:{driverEye:e},spec:CAR_SPEC};
  function place(ahead,speed){
    car.x=-Math.sin(heading)*ahead;car.z=Math.cos(heading)*ahead;
    car.vx=Math.sin(heading)*speed;car.vz=-Math.cos(heading)*speed;car.speed=speed;
    e.position.set(car.x+rx*.43+Math.sin(heading)*.08,ground.heightAt(car.x,car.z)+1.36,car.z+rz*.43-Math.cos(heading)*.08);e.updateMatrixWorld();
  }
  return {p,m,car,place,setState:s=>state=s};
}
function findCue(f,speed) {
  for(let ahead=30;ahead>=0;ahead-=.1){f.place(ahead,speed);f.m.prepareThrow(f.car,MAIL_KIND(f.m));if(f.m.cue)return ahead;}
  return null;
}
const cycle=[0,1,0,2,1,0,2,0,3,1,2,0,1];
const MAIL_KIND=m=>cycle[m.thrown%cycle.length];
let laneCases=0;
// Every ordinary cycle entry must be reachable from the real lane-centre setbacks.
for(const offset of [2.5,2.9,3.1,3.4,4,5])for(const style of ([2.9,3.1,3.4].includes(offset)?[0,1,2,3,4,5]:[0]))for(const speed of [20/3.6,40/3.6,60/3.6])for(let sequence=0;sequence<cycle.length;sequence++){
  if(cycle[sequence]===3)continue;
  const f=fixture(0,0,offset,sequence,style),ahead=findCue(f,speed);
  assert.notEqual(ahead,null,'lane-centre opening is reachable '+JSON.stringify({offset,style,speed,sequence}));
  f.place(ahead,speed);f.m.update(1/120,f.car,true);
  for(let n=0;n<480&&f.m.pieces[0].state==='flying';n++)f.m.update(1/120,f.car,false);
  assert.equal(f.m.delivered,1,'real flight delivers at each lane-centre setback');laneCases++;
}
assert.equal(laneCases,756,'retain all ordinary kinds, real setbacks, six styles and three speeds');
const downFixture=fixture(0,0,2.9);
downFixture.p.knockMailbox(0,0,0,true);downFixture.p.mail[0].motion.angle=Math.PI*.49;downFixture.setState('preExisting');
const downAhead=findCue(downFixture,20/3.6);
assert.notEqual(downAhead,null,'a pre-existing down box has a ground-drop cue');
downFixture.place(downAhead,20/3.6);downFixture.m.update(1/120,downFixture.car,true);
for(let n=0;n<480&&downFixture.m.pieces[0].state==='flying';n++)downFixture.m.update(1/120,downFixture.car,false);
assert.equal(downFixture.m.delivered,1,'a physical ground drop serves the pre-existing down box');
assert.equal(downFixture.m.lawn+downFixture.m.ditch,0,'authorised ground drop is not a missed throw');
let cases=0,bends=0;
for(const speed of [20/3.6,40/3.6,60/3.6])for(const heading of [0,.4,Math.PI/2,2])for(const slope of [0,.1,-.1]) {
  const f=fixture(heading,slope),ahead=findCue(f,speed);
  if(ahead===null){assert.notEqual(slope,0,'flat ordinary moving throw has an opening cue '+JSON.stringify({speed,heading}));continue;}
  f.place(ahead,speed);
  const on=f.m.prepareThrow(f.car,0);f.m.throwHelp=false;const off=f.m.prepareThrow(f.car,0);
  if(on.vx!==off.vx||on.vz!==off.vz)bends++;
  for(const [x,z] of [[Math.cos(heading),Math.sin(heading)],[Math.sin(heading),-Math.cos(heading)]]){
    const a=off.vx*x+off.vz*z,b=on.vx*x+on.vz*z;
    assert.ok(Math.abs(b-a)<=Math.abs(a)*.35+1e-12,'bounded side/forward correction');
  }
  assert.ok(Math.abs(on.vy-off.vy)<=3+1e-12,'lift correction is bounded to 3 m/s');
  for(const state of ['none','stuffed','preExisting']){
    f.setState(state);f.m.throwHelp=true;
    assert.deepEqual(f.m.prepareThrow(f.car,0),off,state+' never attracts help');assert.equal(f.m.cue,false);
  }
  f.setState('ready');f.p.mail[0].motion.down=true;f.m.throwHelp=true;
  assert.deepEqual(f.m.prepareThrow(f.car,0),off,'fallen box never attracts help');
  let reference;
  for(const hz of [30,60,120,144]){
    const g=fixture(heading,slope);g.place(ahead,speed);g.m.update(1/hz,g.car,false);assert.equal(g.m.cue,true);
    g.m.update(1/hz,g.car,true);
    for(let frame=1;frame<hz*4&&g.m.pieces[0].state==='flying';frame++){g.place(ahead-frame*speed/hz,speed);g.m.update(1/hz,g.car,false);}
    assert.equal(g.m.delivered,1,'cue delivers through opening at '+hz+' Hz');
    const piece=g.m.pieces[0],actual=[piece.x,piece.y,piece.z,piece.vx,piece.vy,piece.vz,piece.age];
    if(reference)assert.deepEqual(actual,reference,'same fixed flight across frame rates');else reference=actual;
    cases++;
  }
}
assert.ok(bends>0,'help must actually adjust some opening throws');
assert.equal(cases,144,'all rotated/sloped combinations retain their opening cue at every frame rate');
// An elevated flyer needs more than a second even at the lowest assisted lift.
{
  const p=new Props({crs:'EPSG:2961',mailboxes:[{...box,x:1.84,heading:270}],communityBoxes:[],poles:[]},[0,0],terrain);
  const hit=(a,b,landed)=>p.mailHit(a.x,a.y,a.z,b.x,b.y,b.z,landed);
  const plan=planMail({x:0,y:6,z:0,vx:3,vy:2.5,vz:0},1,0,p.mailAim(0),terrain.heightAt,hit,()=>true,0);
  assert.equal(plan.hit,true,'elevated flyer must preview contact after one second');
  let flight=plan.flight,ticks=0,contact;
  do{contact=advanceMail(flight,1,1/60,terrain.heightAt,hit);flight=contact.flight;ticks++;}while(contact.hit<0&&!contact.landed&&ticks<120);
  assert.equal(contact.hit,0);assert.ok(ticks>63,'late-contact witness must be later than 1.05 s');
}
// First contact must agree between prediction and live flight at every frame rate.
for(const hz of [30,60,120,144])for(const first of ['ready','none','stuffed','down']){
  const f=fixture(0,0,4.8);f.place(0,0);
  const pair=new Props({crs:'EPSG:2961',mailboxes:[{...box,x:4.8,heading:270},{...box,x:4.8,heading:270}],communityBoxes:[],poles:[]},[0,0],terrain);
  if(first==='down')pair.knockMailbox(0,0,0);
  const m=new Mail(terrain,pair,[],[0,0],true);
  m.service={condition:i=>i===0?(first==='down'?'ready':first):'ready',deliver:()=>true,ground(){}};
  m.update(1/hz,f.car,false);
  const expected=first==='ready'||first==='down';
  assert.equal(m.cue,expected,'ordered preview '+first+' '+hz);
  m.update(1/hz,f.car,true);
  for(let n=0;n<hz*4&&m.pieces[0].state==='flying';n++)m.update(1/hz,f.car,false);
  assert.equal(m.delivered,expected?1:0,'ordered live flight '+first+' '+hz);
  if(!expected)assert.equal(m.pieces[0].rejected,true,'non-due/stuffed first opening rejects live mail');
}
// Coincident openings isolate stable contact order from aim precision. The first is not due.
{
  const f=fixture(),ahead=findCue(f,40/3.6);f.place(ahead,40/3.6);
  const start=f.m.prepareThrow(f.car,0);
  const pair=new Props({crs:'EPSG:2961',mailboxes:[{...box,heading:270},{...box,heading:270}],communityBoxes:[],poles:[]},[0,0],terrain);
  const plan=planMail(start,0,0,pair.mailAim(1),terrain.heightAt,
    (a,b,landed)=>pair.mailHit(a.x,a.y,a.z,b.x,b.y,b.z,landed),i=>i===1,1);
  assert.equal(plan.hit,false,'preview must not skip an earlier non-due opening');
}
console.log('PASS raw-launch digest, '+laneCases+' lane-centre flights, '+cases+' rotated/sloped opening cues at four frame rates, bounded help, due-only selection and ordered acceptance');
