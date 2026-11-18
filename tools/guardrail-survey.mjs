// Exact production placement rule over original baked survey. No writes to baked data.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {railLand} from './guardrail-land.mjs';
import {AREAS} from '../web/src/area.ts';
import {LOOK} from '../web/src/guardrail-look.ts';
import {damageShape,surveyedRailDamage} from '../web/src/guardrail-damage.ts';
import {planRails,roadLength,railPosts,RAIL} from '../web/src/guardrail-rules.ts';
const areas=process.env.RAIL_AREA ? [process.env.RAIL_AREA] : AREAS.map(a=>a.base);
const report=[];
for(const area of areas){
 const land=railLand(area),{roads,ground,access,context}=land;
 const spans=[];
 for(const road of roads.roads){
  if(road.bridge||road.kind>3)continue;
  const len=roadLength(road);
  for(let i=0;i*RAIL.chunk<len;i++){const start=i*RAIL.chunk;spans.push(...planRails(road,ground,access,start,Math.min(start+RAIL.chunk,len),context));}
 }
 // Check the whole swept rail span, not only sampled vertices. Each parsed prop has a body radius; include the steel face and timber post widths.
 const damage=surveyedRailDamage(roads,land.village);
 let checked=0;
 for(const p of land.obstacles) {
  for(const s of spans) {
   if(Math.abs(s.a.x-p.x)>5&&Math.abs(s.b.x-p.x)>5)continue;
   const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,t=Math.max(0,Math.min(1,((p.x-s.a.x)*dx+(p.z-s.a.z)*dz)/(dx*dx+dz*dz)));
   const gap=Math.hypot(s.a.x+t*dx-p.x,s.a.z+t*dz-p.z);
   for(const t of railPosts(s)) {
    const length=Math.hypot(dx,dz),ox=-dz/length*s.side,oz=dx/length*s.side;
    const bend=damage?.road===s.road?damageShape(s.a.along+(s.b.along-s.a.along)*t,damage).bend:0;
    const x=s.a.x+t*dx+ox*(LOOK.block+LOOK.post/2),z=s.a.z+t*dz+oz*(LOOK.block+LOOK.post/2);
    const q=bend?Math.max(0,Math.min(1,((p.x-x)*ox+(p.z-z)*oz)/bend)):0;
    const postGap=Math.hypot(x+ox*bend*q-p.x,z+oz*bend*q-p.z);
    assert.ok(postGap>p.radius+LOOK.post*Math.SQRT2/2,`${area} prop intersects timber post: ${postGap}m`);
   }
   assert.ok(gap>p.radius+.15,`${area} roadside prop intersects rail at ${p.x},${p.z}: ${gap}m`);
  }
  checked++;
 }
 console.log('PASS prop clearance',area,checked);
 const samples=spans.filter((s,i)=>i%100===0).slice(0,12).map(s=>({road:s.road.name,id:s.road.id,along:s.a.along,side:s.side,x:s.a.x,z:s.a.z,heading:s.a.heading}));
 const row={area,metres:spans.reduce((n,s)=>n+Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z),0),spans:spans.length,reads:land.reads,samples};report.push(row);console.log(JSON.stringify(row));
}
for(const row of report)if(!(row.metres>0)||!Number.isFinite(row.metres))throw Error('no rail in '+row.area+': the rule or its land reader is broken');
const reportPath=process.env.RAIL_REPORT ?? 'data/work/threads/guardrails/survey.json';mkdirSync(dirname(reportPath),{recursive:true});
writeFileSync(reportPath,JSON.stringify(report,null,2));
