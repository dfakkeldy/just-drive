import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {railLand} from './guardrail-land.mjs';
import {planRails,railStation,RAIL,nearCoast} from '../web/src/guardrail-rules.ts';
import {railAccess} from '../web/src/guardrail-access.ts';
const l=railLand(),v=l.village;
// Owner's 13 Nov corrected dash-cam observations; CAR coordinates, not a placement list.
export const TRUTH={
 runs:{A1:[[618999,5109888],[619011,5109690]],A2:[[619012,5109676],[618987,5109233]],B:[[618990,5109215],[619001,5109155]],C:[[619005,5109142],[619095,5109063]]},
 gaps:[[[619011,5109690],[619012,5109676]],[[618987,5109233],[618990,5109215]],[[619001,5109155],[619005,5109142]]],
};
const project=([e,n])=>{const h=l.roads.nearest(e-v[0],v[1]-n,50,r=>r.name==='Mabou Mines Road');assert.ok(h);return {road:h.road,s:railStation(h.road,h.seg,h.t)};};
const intervals=Object.fromEntries(Object.entries(TRUTH.runs).map(([key,p])=>{const a=project(p[0]),b=project(p[1]);assert.equal(a.road,b.road);return[key,{road:a.road,lo:Math.min(a.s,b.s),hi:Math.max(a.s,b.s)}];}));
const coastCache=new Map();const context={canopy:(x,z)=>l.sample(x,z,true)?.canopy??0,coast:(r,s,side)=>{const k=`${r.id}/${Math.round(s/30)}/${side}`;if(!coastCache.has(k))coastCache.set(k,nearCoast(r,s,side,l.ground));return coastCache.get(k);}};
// Production roads can have irregular point spacing; use the actual polyline length for chunk bounds.
import {roadLength} from '../web/src/guardrail-rules.ts';
const exact=surveyed=>{const access=railAccess(l.roads,l.ground,v,surveyed,l.obstacles);return l.roads.roads.filter(r=>r.name==='Mabou Mines Road').flatMap(r=>{const out=[];for(let i=0;i*RAIL.chunk<roadLength(r);i++){const start=i*RAIL.chunk;out.push(...planRails(r,l.ground,access,start,Math.min(start+RAIL.chunk,roadLength(r)),context));}return out;});};
const natural=exact(false),spans=exact(true),key=s=>`${s.road.id}:${s.side}:${s.a.along.toFixed(6)}`;
const base=new Set(natural.map(key));assert.ok(spans.every(s=>base.has(key(s))),'surveyed openings can only remove rail');
const overlap=(s,r)=>s.road===r.road?Math.max(0,Math.min(r.hi,s.b.along)-Math.max(r.lo,s.a.along)):0;
// New road-shaped bed: mapped track 827 now has a 1.517m shoulder ramp (old land 2.594m).
// Its hard access break drops the short A1 stub: 184.3/200.854m = 91.758%; keep this explicit raw-coverage pin.
// C loses 15.2m at the mailbox 14m from the gravel entrance: the remaining stub is below the minimum run length.
const coverage={};for(const[name,r]of Object.entries(intervals)){const m=spans.reduce((n,s)=>n+overlap(s,r),0);const pieces=spans.filter(s=>overlap(s,r)>0).sort((a,b)=>a.a.along-b.a.along);for(let i=1;i<pieces.length;i++)assert.ok(pieces[i].a.along-pieces[i-1].b.along<1e-6||l.obstacles.some(p=>Math.hypot(p.x-pieces[i].a.x,p.z-pieces[i].a.z)<12),`${name} only mapped props create extra openings`);coverage[name]={target:r.hi-r.lo,covered:m,percent:m/(r.hi-r.lo)*100};}
const gaps=TRUTH.gaps.map(p=>{const a=project(p[0]),b=project(p[1]),r={road:a.road,lo:Math.min(a.s,b.s),hi:Math.max(a.s,b.s)};return {...r,natural:natural.reduce((n,s)=>n+overlap(s,r),0),after:spans.reduce((n,s)=>n+overlap(s,r),0)};});
for(const gap of gaps){assert.ok(gap.after<.001,'surveyed opening stays clear');assert.ok(spans.some(s=>s.road===gap.road&&s.a.along>gap.hi&&s.a.along<gap.hi+35),'rail on north side of opening');assert.ok(spans.some(s=>s.road===gap.road&&s.b.along<gap.lo&&s.b.along>gap.lo-35),'rail on south side of opening');}
let outside=0,inland=0,north=0,south=0,east=0;
for(const s of spans){outside+=RAIL.pitch-Object.values(intervals).reduce((n,r)=>n+overlap(s,r),0);if(s.side!==-1)inland+=RAIL.pitch;const r=intervals.A1;if(s.road===r.road){north+=Math.max(0,s.b.along-Math.max(s.a.along,r.hi));south+=Math.max(0,Math.min(s.b.along,intervals.C.lo)-s.a.along);}if(s.a.x+v[0]>619095||s.b.x+v[0]>619095)east+=RAIL.pitch;}
console.log('MEASURE',JSON.stringify({coverage,gaps:gaps.map(g=>({natural:g.natural,after:g.after,lo:g.lo,hi:g.hi})),outside,inland,north,south,east}));
assert.equal(inland,0,'no inland rail');assert.ok(north<.001,'no rail north of corrected A1');assert.ok(south<.001,'no cliff rail south/east of C');assert.equal(east,0,'no rail toward withdrawn eastern woods/log piles');assert.ok(outside<.01,'no cliff false positives outside supplied runs');
for(const [name,min] of Object.entries({A1:91.5,A2:97,B:88,C:86}))assert.ok(coverage[name].percent>=min,`${name} coverage ${coverage[name].percent}`);
const report={coverage,gaps:gaps.map(g=>({lo:g.lo,hi:g.hi,naturalRailMetres:g.natural,finalRailMetres:g.after,neededSurvey:g.natural>.01})),outside:Math.max(0,outside),inland,north,south,east,metres:spans.reduce((n,s)=>n+Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z),0),runs:spans.length};
mkdirSync('data/work/threads/guardrails',{recursive:true});writeFileSync('data/work/threads/guardrails/ground-truth.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('PASS corrected A1/A2/B/C, three openings with rail on both sides, sea side, no north/south/east false rail; exclusions only cut');
