import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname} from 'node:path';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {planRails,RAIL,roadLength} from '../web/src/guardrail-rules.ts';
import {railAccess} from '../web/src/guardrail-access.ts';
import {railwayRoad} from '../web/src/railway-road.ts';
import {railLand} from './guardrail-land.mjs';
import {Roads} from '../web/src/roads.ts';
import {AREAS} from '../web/src/area.ts';
const road={id:1,name:null,kind:3,halfWidth:3,bridge:false,pts:[[0,0],[100,0]]},cliff=(x,z)=>20-Math.max(0,z-4)*.8;
for(const tag of [{railway:'rail'},{tags:{railway:'light_rail'}},{name:'Railroad'}])assert.equal(planRails({...road,...tag},cliff,()=>false).length,0,'railway class/tag never builds rails');
for(const tag of [{name:'Railway Road'},{name:'Active Rail Road'},{name:'Railroad',railway:'no'},{railway:false}])assert.ok(planRails({...road,...tag},cliff,()=>false).length>0,'ordinary road remains eligible');
const tagged=new Roads({roads:[{...road,railway:'rail'}]},[0,0],{cartRoads:false});assert.equal(tagged.roads[0].railway,'rail','bake tag survives world conversion');assert.equal(tagged.guardrails.chunks.length,0,'railway creates no runtime rail chunks');
assert.equal(RAIL.junction,18,'bridge approach exclusion unchanged');
console.log('PASS railway tags and legacy bake class; ordinary road names retained');
// Compare against the same whole-road rule with only the railway omission disabled.
// Seam and junction repairs are tested separately; this isolates the railway filter.
const source=readFileSync('web/src/guardrail-rules.ts','utf8').replace(' || railwayRoad(road)','');
const {outputFiles}=await build({stdin:{contents:source,loader:'ts',resolveDir:process.cwd()+'/web/src'},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const before=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const crossing={...road,id:2,name:'Railroad',pts:[[50,-20],[50,20]]};
const withRailway=new Roads({roads:[road,crossing]},[0,0],{cartRoads:false});
assert.equal(railAccess(withRailway,cliff,undefined,false)(withRailway.roads[0],{x:50,z:4.2,heading:Math.PI/2,along:50}),false,'railway crossing never counts as road junction');
const rows=[];
for(const area of AREAS){
 const l=railLand(area.base);let count=0,metres=0,removed=0,removedMetres=0;const removedRoads=[];
 for(const r of l.roads.roads){let oldCount=0,oldMetres=0;
  for(let start=0;start<roadLength(r);start+=RAIL.chunk){
   const end=Math.min(start+RAIL.chunk,roadLength(r)),after=planRails(r,l.ground,l.access,start,end,l.context);count+=after.length;metres+=after.reduce((n,s)=>n+Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z),0);
   const old=before.planRails(r,l.ground,l.access,start,end,l.context);
   if(railwayRoad(r)){assert.equal(after.length,0,`${area.id} railway ${r.id}`);oldCount+=old.length;oldMetres+=old.reduce((n,s)=>n+Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z),0);}
   else assert.deepEqual(after,old,`${area.id} ordinary road ${r.id}: continuous spans and bridge gaps unchanged`);
  }
  if(oldCount){removed+=oldCount;removedMetres+=oldMetres;removedRoads.push({id:r.id,name:r.name,spans:oldCount,metres:oldMetres});}
 }
 rows.push({area:area.id,oldSpans:count+removed,oldMetres:metres+removedMetres,removedSpans:removed,removedMetres,newSpans:count,newMetres:metres,removedRoads});console.log('PASS railroad inventory',JSON.stringify(rows.at(-1)));
}
assert.ok(rows.some(r=>r.removedSpans>0),'real catalog has the reviewed railway defect');
const out=process.env.RAILWAY_REPORT??'data/work/threads/guardrails-r2/railway-inventory.json';mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(rows,null,2));
if(process.argv.includes('--mutations')){const r=spawnSync(process.execPath,['tools/guardrail-fix-mutations.mjs','--r2'],{stdio:'inherit'});assert.equal(r.status,0);}
