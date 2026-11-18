import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
/** County marks have 345 finite coordinate pairs; 67 inset marks deliberately have null coordinates. */
export function privateDensityAudit(file,sites,origin,log=console.log){
 if(!existsSync(file)){log('SKIP private mark separation: optional data/work/history-1884/density/mabou-1884-dwellings.json is absent');return {skipped:true};}
 return auditMarkRecords(JSON.parse(readFileSync(file,'utf8')),sites,origin,log);
}
export function auditMarkRecords(data,sites,origin,log=console.log){
 assert(data&&Array.isArray(data.marks),'private mark file must contain a marks array');assert.equal(data.marks.length,412,'private mark inventory must contain 412 records');
 const marks=[];let inset=0;
 for(const m of data.marks){assert(m&&typeof m==='object','invalid private mark record');if(Number.isFinite(m.e)&&Number.isFinite(m.n))marks.push(m);else{assert.equal(m.e,null,'invalid county coordinate');assert.equal(m.n,null,'invalid county coordinate');assert.equal(m.source_panel,'village-inset','only unlocated inset marks may have null coordinates');inset++;}}
 assert.equal(marks.length,345,'private mark audit requires exactly 345 valid county positions');assert.equal(inset,67,'private mark audit requires 67 unlocated inset records');
 let closest=Infinity,centres=0;
 for(const s of sites){const points=[[s.x,s.z]];if(s.barn){const c=Math.cos(s.yaw),a=Math.sin(s.yaw);points.push([s.x+s.barn.x*c+s.barn.z*a,s.z-s.barn.x*a+s.barn.z*c]);}
  for(const [x,z]of points){centres++;for(const m of marks)closest=Math.min(closest,Math.hypot(origin[0]+x-m.e,origin[1]-z-m.n));}
 }
 assert(centres>0,'no house or barn centres were checked');assert(Number.isFinite(closest)&&closest>=25,'house/barn centres must be at least 25 m from map marks; minimum '+closest.toFixed(2)+' m');
 log(`PASS private separation: ${marks.length} valid county marks, ${inset} unlocated inset records, ${centres} house/barn centres; minimum ${closest.toFixed(2)} m; no mark positions retained`);
 return {marks:marks.length,inset,centres,closest};
}
