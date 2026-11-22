import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
const [out,churchUrl,dropUrl]=process.argv.slice(2),evidence=resolve(out,'evidence/power-network');mkdirSync(evidence,{recursive:true});
// The served pack decides. Before main's power bake it has no serviceDrops (legacy pack, merged span wires only).
// After it (or on a rehearsal overlay): the church has no power (Dan, 21 Nov 2026), so no pole or wire stands near
// it, while a real house drop on River Denys Road by Highway 19 renders, and the River Denys Mountain run stays.
const CHURCH=[630835.5,5080641.6];
const measure=`(async()=>{
 const data=await(await fetch('/areas/judique/props.json')).json();
 const after=Array.isArray(data.serviceDrops);
 const props=mmm.props;let cells=0,lines=0,dropLines=0,dropWires=0,nearChurch=0;
 for(const c of props.cells.values())if(c.group){
  // The cell's wire draw: LineSegments, or with the finish pass's one-sample canvas (FINISH.oneSample) a ribbon Mesh.
  const batch=c.group.children.filter(o=>o.isLineSegments||o===c.line);if(batch.length>1)throw Error('multiple wire draws in a cell');
  cells++;lines+=batch.length;dropWires+=c.wires.filter(w=>w.drop).length;
  if(batch.length===1)dropLines+=c.wires.filter(w=>w.drop&&w.vertices.length===60).length;
 }
 for(const p of data.poles)if(Math.hypot(p.x-${CHURCH[0]},p.y-${CHURCH[1]})<500)nearChurch++;
 const roads=await(await fetch('/areas/judique/roads.json')).json();
 const riverRoad=roads.roads.find(r=>r.kind===4&&r.name==='River Denys Mountain Road');
 if(!riverRoad)throw Error('River Denys Mountain Road (kind 4) missing');
 const track=new Set(roads.roads.filter(r=>r.kind===4&&r.name==='River Denys Road').map(r=>r.id));
 return {state:after?'after':'before',drops:after?data.serviceDrops.length:0,churchDrop:after&&data.serviceDrops.some(d=>d.building===-1),
  riverPoles:data.poles.filter(p=>p.road===riverRoad.id).length,trackPoles:data.poles.filter(p=>track.has(p.road)).length,
  nearChurch,cells,lines,dropWires,dropLines,churchTriangles:mmm.church?.triangles??0,gpuError:mmm.renderer.getContext().getError(),low:mmm.terrain.low};
})()`;
async function view(url,ready,name){
 const page=await open(url);
 try{
  for(let i=0;i<120&&!await page.read(ready);i++)await sleep(500);
  // Wires build once both poles stand on fine land (level >= 6); a pack with drops waits for a wire draw here.
  const wired=`!mmm.props.data.serviceDrops.length||[...mmm.props.cells.values()].some(c=>c.group&&c.group.children.some(o=>o.isLineSegments||o===c.line))`;
  if(name==='drop')for(let i=0;i<120&&!await page.read(wired);i++)await sleep(500);
  else await sleep(3000);
  const result=await page.read(measure);
  assert.deepEqual(page.errors,[]);
  await page.shot(resolve(evidence,`judique-${name}-${result.state}.png`));
  return result;
 }finally{await page.close();}
}
const church=await view(churchUrl,'mmm.church?.triangles>0','church');
const drop=dropUrl?await view(dropUrl,'globalThis.mmm?.props?.cells?.size>0','drop'):null;
const result={church,drop};
writeFileSync(resolve(evidence,'power-runtime.json'),JSON.stringify(result,null,2));
console.log('power-network measured '+JSON.stringify(result));
assert.ok(church.churchTriangles>0);
for(const r of [church,drop].filter(Boolean)){assert.ok(r.lines<=r.cells,'at most one wire draw per loaded cell');assert.equal(r.gpuError,0);}
if(church.state==='after'){
 assert.ok(drop,'an installed power pack needs the drop view too');
 assert.equal(church.churchDrop,false,'the church has no service drop');
 assert.equal(church.trackPoles,0,'River Denys Road kind-4 piece has no poles');
 assert.equal(church.nearChurch,0,'no pole stands within 500 m of the church');
 assert.equal(church.dropWires,0,'no drop is wired in the cells loaded round the church');
 assert.ok(church.riverPoles>30,'the River Denys Mountain run stays');
 assert.ok(drop.lines>0&&drop.dropLines>0,'a real house drop has rendered vertices');
}else{
 assert.equal(church.dropWires,0,'a legacy pack has no service drops');
 assert.equal(church.riverPoles,0,'a legacy pack has no named kind-4 pole run');
}
console.log(`PASS Judique power (${church.state} the step-29 power bake): merged wire draws per cell`+(church.state==='after'?', no line at the church, a rendered house drop and the River Denys Mountain run':', legacy pack without drops'),JSON.stringify(result));
