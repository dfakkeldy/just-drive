import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {open,sleep} from './cdp.mjs';
const [out,url]=process.argv.slice(2),evidence=resolve(out,'evidence/power-network');mkdirSync(evidence,{recursive:true});
// The served pack decides: before main's power bake it has no serviceDrops (legacy pack, merged span wires only);
// after it (or on a rehearsal overlay) the church drop and the River Denys run must render.
const page=await open(url);
try{
 for(let i=0;i<120&&!await page.read('mmm.church?.triangles>0');i++)await sleep(500);
 // Wires build once both poles stand on fine land (level >= 6); let the loaded cells settle first.
 // Before the bake no pole stands near the church, so only a pack with drops waits for a wire draw.
 const wired=`!mmm.props.data.serviceDrops.length||[...mmm.props.cells.values()].some(c=>c.group&&c.group.children.some(o=>o.isLineSegments))`;
 for(let i=0;i<120&&!await page.read(wired);i++)await sleep(500);
 const result=await page.read(`(async()=>{
 const data=await(await fetch('/areas/judique/props.json')).json();
 const after=Array.isArray(data.serviceDrops);
 const drop=after?data.serviceDrops.find(d=>d.building===-1):null;if(after&&!drop)throw Error('church drop missing');
 const props=mmm.props;let cells=0,lines=0,churchLine=false,dropWires=0;
 for(const c of props.cells.values())if(c.group){
  // The cell's wire draw: LineSegments, or with the finish pass's one-sample canvas (FINISH.oneSample) a ribbon Mesh.
  const batch=c.group.children.filter(o=>o.isLineSegments||o===c.line);if(batch.length>1)throw Error('multiple wire draws in a cell');
  cells++;lines+=batch.length;dropWires+=c.wires.filter(w=>w.drop).length;
  if(c.wires.some(w=>w.drop?.building===-1))churchLine=batch.length===1&&c.wires.some(w=>w.drop?.building===-1&&w.vertices.length===60);
 }
 const pole=drop&&data.poles.find(p=>p.road===drop.road&&p.n===drop.n);
 const span=pole?Math.hypot(pole.x-drop.x,pole.y-drop.y):null;
 const roads=await(await fetch('/areas/judique/roads.json')).json();
 const riverRoad=roads.roads.find(r=>r.kind===4&&r.name==='River Denys Mountain Road');
 if(!riverRoad)throw Error('River Denys Mountain Road (kind 4) missing');
 const river=data.poles.filter(p=>p.road===riverRoad.id);
 return {state:after?'after':'before',drop,span,riverPoles:river.length,cells,lines,dropWires,churchLine,churchTriangles:mmm.church.triangles,gpuError:mmm.renderer.getContext().getError(),low:mmm.terrain.low};
 })()`);
 writeFileSync(resolve(evidence,'power-runtime.json'),JSON.stringify(result,null,2));
 console.log('power-network measured '+JSON.stringify(result));
 assert.ok(result.churchTriangles>0);
 assert.ok(result.lines<=result.cells,'at most one wire draw per loaded cell');
 assert.equal(result.gpuError,0);
 if(result.state==='after'){
  assert.ok(result.lines>0,'span wires and drops drawn near the church');
  assert.ok(result.churchLine,'the actual church service drop has rendered vertices');
  assert.ok(result.span<=45&&result.riverPoles>30);
 }else{
  assert.equal(result.dropWires,0,'a legacy pack has no service drops');
  assert.equal(result.riverPoles,0,'a legacy pack has no named kind-4 pole run');
 }
 assert.deepEqual(page.errors,[]);
 await page.shot(resolve(evidence,`judique-church-${result.state}.png`));
 console.log(`PASS Judique power (${result.state} the step-29 power bake): merged wire draws per cell`+(result.state==='after'?', rendered church drop and River Denys pole run':', legacy pack without drops'),JSON.stringify(result));
}finally{await page.close();}
