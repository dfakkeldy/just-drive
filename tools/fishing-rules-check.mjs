import assert from 'node:assert/strict';
import { FishingJudge, DECKHAND_RULES as R } from '../web/src/fishing-rules.ts';
import { paintSiteSurface } from '../web/src/terrain.ts';
import { sampleDeparture, departureDuration } from '../web/src/fishing-course.ts';
import { FishingSite, WHARF } from '../web/src/fishing-site.ts';
const base = {distance: 2,speed: 0,sideways: 0,y: 3,deck: 3,airborne: false,eligible: true,placement: 0,x: 0,z: 0};
const wait = (j, patch={}, steps=240) => { let offers=0; for(let i=0;i<steps;i++)offers+=Number(j.step(1/120,{...base,...patch}));return offers; };
let j=new FishingJudge();assert.equal(wait(j,{},180),0,'R1: a full continuous 1.5 s after first observation');assert.equal(wait(j,{},1),1);assert.equal(wait(j),0,'R2: once per shift, including decline');j.reset();assert.equal(wait(j),1,'R2: new shift resets');
for(const patch of [{eligible:false},{airborne:true},{deck:null},{y:3.181},{distance:R.radius+.01},{speed:.3},{speed:-.3},{sideways:.3}])assert.equal(wait(new FishingJudge(),patch),0,'R3-6 exclusions/ground/distance/speed '+JSON.stringify(patch));
j=new FishingJudge();wait(j,{},120);j.step(1/120,{...base,placement:1});assert.equal(wait(j,{placement:1},179),0,'R7 placement breaks dwell');assert.equal(wait(j,{placement:1},1),1);
j=new FishingJudge();wait(j,{},120);j.step(1/120,{...base,x:90});assert.equal(wait(j,{},179),0,'R7 discontinuity breaks dwell');assert.equal(wait(j,{},2),1);
j=new FishingJudge();wait(j,{},120);j.cancel();assert.equal(wait(j,{},180),0,'R8 cancel does not carry dwell');assert.equal(wait(j,{},1),1);
j=new FishingJudge();for(let i=0;i<240;i++)assert.equal(j.step(0,base),false);assert.equal(j.step(2,base),false,'R8 suspended time cannot count');
const s=new FishingSite([624271,5103301]);const p=s.world(7,40);
assert.equal(s.deckHeight(p.x,p.z),null,'R9 no invisible deck before model');s.top=s.level;s.toe=s.entrance(-2);
assert.equal(s.deckHeight(p.x,p.z),s.level);assert.equal(s.deckHeight(p.x+20,p.z),null);
assert.equal(s.height(p.x,p.z,-.7),-.7,'R9 surveyed water stays water');assert.equal(s.height(s.x+100,s.z+100,5),5,'R9 outside ground unchanged');
assert.equal(s.surface(s.x+20,s.z+4).kind,11,'R16 terrain-painted gravel');assert.equal(s.visualGravel,true,'R16 mapped tracks preserved');
assert.equal(s.deckHeight(s.x,s.z-2),null,'R18 entrance is drawn land, not an invisible deck');assert.equal(s.deckHeight(s.x+7,s.z+WHARF.start),s.level,'R9 joined approach');
for(const hill of [1,1.5,2,2.5]){
 const site=new FishingSite([0,0],hill,-.2);assert.ok(site.level+.2<=2.8+1e-9,'R14 cap at every hill');
 assert.ok(Math.abs(site.level-(-.2+Math.min(2.8,2.05*hill)))<1e-9);
 assert.ok(Math.abs(site.entrance(10)-site.level)<1e-8,'R14 join at cap');
 assert.ok(Math.abs(site.entrance(10)-site.entrance(9.999))<.000001,'R14 tangent at cap');
 assert.ok(Math.abs(site.entrance(-18)-(-.2+3.475*hill))<1e-8,'R14 surveyed bedding');
 assert.ok(site.height(site.x+7,site.z+40,5)<5,'R14 tall fill cannot project through cap');
}
for(const kind of [0,1,2,3,4,5,20,36]){
 const field=new Uint8ClampedArray([138,30,kind,0]);
 paintSiteSurface(field,0,{dist:6.5,half:10,kind:11},128,.1,.05);
 assert.deepEqual([...field.slice(0,3)],[138,30,kind],'R16 RGB driving data unchanged '+kind);assert.equal(field[3],255);
}
for(const [dist,alpha] of [[12,0],[10,128],[8,255]]){
 const field=new Uint8ClampedArray(4);paintSiteSurface(field,0,{dist,half:10,kind:11},128,.1,.05);assert.equal(field[3],alpha,'R16 soft edge coverage');
}
const legacy=new Uint8ClampedArray([128,30,4,0]);paintSiteSurface(legacy,0,{dist:0,half:10,kind:8},128,.1,.05);assert.equal(legacy[2],8,'R16 unchanged existing yard behavior');
const c={e:0,n:0,de:0,dn:0,speed:0,distance:0};let oldE=618679.1,oldN=5104749,oldYaw=0,maxTurn=0;
for(let t=0;t<=departureDuration();t+=.1){
 sampleDeparture(t,c);assert.ok(Math.hypot(c.e-oldE,c.n-oldN)<=.701,'R15 bounded cruise motion');
 assert.ok(c.speed>=0&&c.speed<=7,'R15 gentle acceleration');
 const yaw=Math.atan2(c.de,-c.dn);if(t>0)maxTurn=Math.max(maxTurn,Math.abs(Math.atan2(Math.sin(yaw-oldYaw),Math.cos(yaw-oldYaw)))/.1);
 oldE=c.e;oldN=c.n;oldYaw=yaw;
 if(c.e<618100 && c.e>617950)assert.ok(c.n>5104910&&c.n<5104975,'R15 mouth corridor');
}
assert.ok(c.e<617000 && c.n>5105400,'R15 reaches gulf');assert.ok(maxTurn<.4,'R15 smooth turn');
console.log('PASS fishing R1-16: stop/shift/exclusions, capped graded entrance at four hills, unchanged mapped tracks, smooth mouth-to-gulf course.');
