import assert from 'node:assert/strict';
import { FISH, FishRules, SceneRoad, touchesPlayer, fishDay } from '../web/src/road-scene-rules.ts';
import { fishArt } from '../web/src/road-scene-art.ts';
import { roads, village, terrain, propsData } from './shift-fixture.mjs';
import { Props } from '../web/src/props.ts';
import { Route } from '../web/src/route.ts';
const r = new FishRules();
const tick=(n,d=20,car=true,truck=true)=>{for(let i=0;i<n*120;i++){r.step(1/120,d,car,truck);assert.ok(r.speed>=0&&r.speed<=6+1e-8,'truck speed cap');}};
const reset=()=>r.reset(8);
const honk=()=>{r.honk(20);tick(1);};
const route=new Route(roads,new Props(propsData,village,terrain));
for(let day=1;day<=48;day++) {
 const mines=route.forDay(day).stops.some(s=>s.hit.road.name==='Mabou Mines Road');
 assert.equal(fishDay(day),day%3===2,'every third day, regardless of the run');
 if(day===2)assert.equal(mines,false,'first encounter day is not a Mines run');
 if(day===8)assert.equal(mines,true,'first Mines run has the scene');
 assert.equal(fishDay(day,'0'),false);assert.equal(fishDay(day,'fish'),true);
}
reset();tick(10,86);assert.equal(r.seen,false);assert.equal(r.truckAlong,FISH.bottom);assert.equal(r.reportLine,'');
tick(1,85);assert.equal(r.seen,true);assert.ok(r.truckAlong>FISH.bottom);assert.equal(r.reportLine,'Mabou Mines Road: a fish truck, a parked car and a cow. Nobody knows how it ended.');
const at=r.truckAlong;tick(20,181);assert.equal(r.truckAlong,at,'leave freezes');tick(2,20);assert.ok(r.truckAlong>at,'return resumes');
reset();tick(70);assert.equal(r.waiting,true);assert.ok(-FISH.carHalf-(r.truckAlong+FISH.truckHalf)>=FISH.gap-1e-8,'truck stop gap');assert.equal(r.horned,true);assert.equal(r.speed,0);
const stopped=r.truckAlong;tick(15);assert.equal(r.truckAlong,stopped,'wait forever without intervention');
assert.equal(r.honk(46),false);assert.equal(r.honks,0);honk();assert.equal(r.honks,1);
r.honk(20);r.honk(20);assert.equal(r.honks,2,'cooldown prevents key spam');tick(1);assert.equal(r.carSide,0,'two honks leave car blocking');honk();assert.equal(r.honks,3);
tick(10,20,false);assert.equal(r.carSide,0,'car must wait for player');tick(10);assert.equal(r.cleared,true);tick(40);assert.equal(r.arrived,true);assert.equal(r.truckAlong,FISH.top);assert.match(r.reportLine,/you cleared the road/);
reset();tick(2);const movingAt=r.truckAlong;tick(.05,20,true,false);assert.equal(r.truckAlong,movingAt,'moving truck brakes for player');
reset();tick(3,20,true,false);assert.equal(r.truckAlong,FISH.bottom,'truck must wait for player');assert.equal(r.speed,0);tick(1);assert.ok(r.truckAlong>FISH.bottom);
reset();tick(1);let calls=0;for(let i=0;i<20;i++){if(r.honk(20))calls++;tick(1);}assert.equal(calls,1,'one excessive-horn call');
reset();assert.equal(r.honks,0);assert.equal(r.seen,false);assert.equal(r.carSide,0);assert.equal(r.horned,false);assert.equal(r.truckAlong,FISH.bottom);
const path=new SceneRoad([[0,0],[0,-100],[100,-100]],100,1), p={x:0,z:0,heading:0};path.at(10,4,p);assert.deepEqual(p,{x:10,z:-96,heading:Math.PI/2});
const s={x:0,z:0,heading:.5,half:4.2,halfWidth:1.2};assert.equal(touchesPlayer(s,{x:0,z:0,heading:2}),true);assert.equal(touchesPlayer(s,{x:10,z:10,heading:0}),false);
const art=fishArt();let draws=0,tris=0;art.group.traverse(o=>{if(o.isMesh){draws++;tris+=o.geometry.attributes.position.count/3;assert.equal(o.castShadow,false);}});console.log('art parts',art.group.children.map(o=>[o.type,o.isMesh?o.geometry.attributes.position.count/3:o.children.map(c=>c.geometry.attributes.position.count/3)]));assert.ok(draws<=5&&tris<=4500,JSON.stringify({draws,tris}));
for(const [object,half,width]of[[art.car,FISH.carHalf,FISH.carWidth],[art.truck.children[0],FISH.truckHalf,FISH.truckWidth]]){object.geometry.computeBoundingBox();const b=object.geometry.boundingBox;assert.ok(Math.max(Math.abs(b.min.z),Math.abs(b.max.z))<=half+.001,'solid covers length');assert.ok(Math.max(Math.abs(b.min.x),Math.abs(b.max.x))<=width+.001,'solid covers mirrors');}
console.log('PASS scene mesh budget', {draws,tris});
console.log('PASS: every-third-day schedule/overrides, trigger, leave/return, stop gap, horn count/cooldown/range, car and truck player gates, outcomes/report, one complaint, reset, polyline and footprint.');
