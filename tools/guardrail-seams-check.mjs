// Span coordinates AND run ends must agree, on every road of every baked area.
import assert from 'node:assert/strict';
import {railLand} from './guardrail-land.mjs';
import {planRails,roadLength,RAIL} from '../web/src/guardrail-rules.ts';
import {readFileSync} from 'node:fs';
import {PorchSite} from '../web/src/porch-site.ts';
import {AREAS} from '../web/src/area.ts';
let count=0;
for(const area of AREAS){
 const l=railLand(area.base);let total=0;const all=[];
 for(const road of l.roads.roads){
  const length=roadLength(road),whole=planRails(road,l.ground,l.access,0,length,l.context),chunked=[];
  for(let start=0;start<length;start+=RAIL.chunk)chunked.push(...planRails(road,l.ground,l.access,start,Math.min(start+RAIL.chunk,length),l.context));
  const sorted=a=>a.toSorted((a,b)=>a.side-b.side||a.a.along-b.a.along);
  assert.deepEqual(sorted(chunked),sorted(whole),`${area.id} road ${road.id}: exact spans and terminals match whole road`);
  if(area.id==='westbay'&&road.id===133)assert.ok(whole.some(s=>s.side===1&&s.a.along>17003&&s.b.along<17024),'reviewed seam is filled');
  total+=whole.length;all.push(...whole);
 }
 if(area.id==='mabou'){
  const data=JSON.parse(readFileSync('data/baked/terrain/buildings.json')),building=PorchSite.find(data.buildings);assert.ok(building,'current porch survey found');
  const site=new PorchSite(building,l.village),[x0,z0,x1,z1]=site.box;
  let nearest=Infinity;
  for(const s of all){
   // The entire site AABB contains the new fence/porch props, dog and lawn.
   const sx0=Math.min(s.a.x,s.b.x),sx1=Math.max(s.a.x,s.b.x),sz0=Math.min(s.a.z,s.b.z),sz1=Math.max(s.a.z,s.b.z);
   nearest=Math.min(nearest,Math.hypot(Math.max(x0-sx1,sx0-x1,0),Math.max(z0-sz1,sz0-z1,0)));
  }
  assert.ok(nearest>.3,'no rail enters new porch site or its props');console.log('PASS porch site-to-nearest-rail AABB clearance m',nearest);
 }
 count+=total;console.log('PASS whole/chunk identical',area.id,total);
}
console.log('PASS all six areas',count,'spans including terminal metadata');
