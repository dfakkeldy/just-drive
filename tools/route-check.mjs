// Count and verify real baked route membership. No renderer or browser is needed.
import assert from 'node:assert/strict';
import { Roads } from '../web/src/roads.ts';
import { Props } from '../web/src/props.ts';
import { Route, ROUTE_ROADS } from '../web/src/route.ts';
import { makeDay, missedCustomers } from '../web/src/shift-rules.ts';
import { village, terrain, roads, propsData } from './shift-fixture.mjs';
const props = new Props(propsData, village, terrain), route = new Route(roads, props);
assert.deepEqual(route.runs.map((r) => [r.rural.length, r.sites.length]), [[56,0],[36,0],[40,0],[51,1],[27,1],[48,2],[57,1],[50,1]]);
assert.equal(route.rural.length, 365); assert.equal(route.members.size,371);
assert.equal(props.mail.length - route.rural.length,104);
assert.equal(route.forDay(1), route.forDay(9)); assert.equal(route.forDay(3),route.runs[2]);
assert.equal(route.forDay(1,4),route.runs[3]); assert.ok(route.runs[7].rural.includes(route.late));
const moved = [];
for (const [i,p] of [...props.mail,...props.sites].entries()) {
  const nearest=roads.nearest(p.x,p.z,256,r=>r.kind>=1&&r.kind<=3);
  assert.ok(nearest,'every target has a nearby public road');
  const stop = route.members.get(i);
  if (ROUTE_ROADS.includes(nearest.road.name)) assert.equal(stop?.hit.road.id, nearest.road.id);
  else if (stop) moved.push([i, nearest.road.name, stop.hit.road.name]);
}
assert.deepEqual(moved, [[165, 'Weaver Lane', 'Highway 252'], [166, 'Weaver Lane', 'Highway 252']]);
for (const run of route.runs) {
  assert.ok(run.start); const first=run.stops[0];
  const stop=[...props.mail,...props.sites][first.index];
  const startRoad=roads.nearest(run.start.x,run.start.z,2,r=>r.kind>=1&&r.kind<=3);
  assert.ok(startRoad,'run starts on a public road');
  const ahead=(stop.x-run.start.x)*Math.sin(run.start.heading)-(stop.z-run.start.z)*Math.cos(run.start.heading);
  assert.ok(ahead>=-1,`${run.name}: first box is ahead`);
  assert.ok(ahead<=36,`${run.name}: start is about 30m before first box`);
  for (let i=1;i<run.stops.length;i++) assert.ok(run.stops[i].section>=run.stops[i-1].section);
}
// Geometry, not baked IDs or a diagonal through the village, splits Highway 19.
const h19=route.runs.flatMap(r=>r.stops).filter(s=>s.hit.road.name==='Highway 19');
assert.equal(h19.filter(s=>s.section===0).length,56); assert.equal(h19.filter(s=>s.section===17).length,42);
let fixedFlags;
for(let day=1;day<=64;day++){
  const run=route.forDay(day), active=new Set([...run.rural,...run.sites]);
  const d=makeDay(day,props.mail.length+props.sites.length,{...run,allRural:route.rural,downCandidates:route.downCandidates});
  for(let i=0;i<d.pieces.length;i++)if(!active.has(i))assert.deepEqual([d.pieces[i],d.stuffed[i],d.down[i],d.flags[i]],[0,false,false,false]);
  const due=run.rural.filter(i=>d.pieces[i]>0);
  assert.equal(d.stuffed.filter(Boolean).length,Math.max(1,Math.round(due.length/12)));
  assert.ok(d.down.filter(Boolean).length>=1 && d.down.filter(Boolean).length<=2);
  for(const i of run.rural)if(d.stuffed[i])assert.ok(d.pieces[i]>0 && !d.down[i]);
  const allFlags=route.runs.flatMap(r=>makeDay(day,d.pieces.length,{...r,allRural:route.rural,downCandidates:route.downCandidates}).flags.flatMap((v,i)=>v?[i]:[])).sort((a,b)=>a-b);
  if(fixedFlags)assert.deepEqual(allFlags,fixedFlags);else fixedFlags=allFlags;
  assert.equal(allFlags.length,5);
  assert.ok(missedCustomers(day,d.pieces).length<=3);
}
// A junction can move a rural box to its route road. Parallel roads, boxes farther
// along the side road, and sites retain their nearest public road.
const fixtureRoads = new Roads({roads:[
  {id:1,name:'Highway 252',kind:1,halfWidth:3,bridge:false,pts:[[0,0],[100,0]]},
  {id:2,name:'Hunters Road',kind:3,halfWidth:3,bridge:false,pts:[[0,10],[100,10]]},
  {id:3,name:'Private',kind:4,halfWidth:1,bridge:false,pts:[[0,4],[100,4]]},
  {id:4,name:'Side Lane',kind:2,halfWidth:1.5,bridge:false,pts:[[50,0],[50,10]]},
  {id:5,name:'Other Lane',kind:2,halfWidth:1.5,bridge:false,pts:[[80,10],[80,0]]},
  {id:6,name:'Parallel Lane',kind:2,halfWidth:1.5,bridge:false,pts:[[10,5],[18,5]]},
]},[0,0],terrain);
const fake=(x,z)=>({x,z,motion:{}});
const synthetic = new Route(fixtureRoads, {
  // fake(14,-3.2) is nearer the Parallel Lane (1.8 m) than the highway (3.2 m) and within reach of the lane end;
  // only the junction test keeps it off the run, so removing or loosening that test fails here.
  mail: [fake(30,-4), fake(30,-9), fake(54,-4.3), fake(84,-4.3), fake(54,-5), fake(50.5,-4), fake(10,-5), fake(14,-3.2)],
  sites: [fake(30,-4), fake(54,-4.3)],
});
assert.deepEqual([...synthetic.members.keys()], [0, 2, 3, 8]);
assert.ok(synthetic.runs[3].stops.every((stop) => stop.hit.road.id === 1));
console.log('PASS: baked counts, lane-mouth ownership, sites, Highway 19 split, eight ordered runs, road starts, run cycle/override, 64 daily draws, fixed flag customers.');
for (const [i, from, to] of moved) console.log(`Moved box ${i}: ${from} -> ${to}.`);
for(const [i,r]of route.runs.entries())console.log(`Run ${i+1}: ${r.name}: ${r.rural.length} boxes, ${r.sites.length} sites.`);
