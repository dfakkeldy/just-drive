import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fixture,areas,dispose,root} from './bridges-fixture.mjs';
import {classifyGap} from './lib/inferred-bridges.mjs';
const candidates=JSON.parse(readFileSync(root+'tools/fixtures/bridge-inferred-candidates.json'));
const crossings=JSON.parse(readFileSync(root+'web/src/bridge-crossings.json'));
const helper=readFileSync(new URL('./lib/inferred-bridges.mjs',import.meta.url),'utf8'),mutants=[];
if(process.argv.includes('--mutations'))for(const [name,match,replacement]of[['pit face gate','grade<=1&&underRoad===null','true&&underRoad===null'],['mapped road gate','grade<=1&&underRoad===null','grade<=1&&true']]){const fn=(await import('data:text/javascript;base64,'+Buffer.from(helper.replace(match,replacement)).toString('base64'))).classifyGap;mutants.push({name,fn,survivors:[]});}
const expected=['mabou/60','mabou/502','mabou/574','mabou/963','porthood/355','westbay/932','westbay/1141','westbay/1618'].sort(),rows=[];
for(const area of areas){const f=await fixture(area,1);if(area==='westbay')f.terrain.sites.push(new f.QuarrySite(f.manifest.village));for(const c of candidates.filter(c=>c.area===area)){
 const pts=c.pts.map(([e,n])=>[e-f.manifest.village[0],f.manifest.village[1]-n]);await f.load(pts);
 rows.push({area,road:c.road,...classifyGap({...c,pts},f.roads.roads,(x,z)=>f.terrain.landHeightAt(x,z))});
 for(const m of mutants)if(m.fn({...c,pts},f.roads.roads,(x,z)=>f.terrain.landHeightAt(x,z)).accept)m.survivors.push(area+'/'+c.road);
 }dispose(f);}
console.log(JSON.stringify(rows,null,2));
const survivors=rows.filter(r=>r.accept).map(r=>r.area+'/'+r.road).sort();assert.deepEqual(survivors,expected,'the reviewed eight survivors are pinned');
if(process.argv.includes('--apply')){const keep=new Set(survivors);writeFileSync(root+'web/src/bridge-crossings.json',JSON.stringify(crossings.filter(c=>!c.inferred||keep.has(c.area+'/'+c.road)),null,2)+'\n');}
else assert.deepEqual(crossings.filter(c=>c.inferred).map(c=>c.area+'/'+c.road).sort(),expected,'runtime inventory contains only accepted gaps');
if(process.env.OUT)writeFileSync(process.env.OUT+'/inferred-decisions.json',JSON.stringify(rows,null,2)+'\n');
console.log('PASS inferred gaps: eight survivors, mapped underpasses and pit faces rejected');

for(const m of mutants){assert.notDeepEqual(m.survivors.sort(),expected,m.name+' removal must fail the eight survivors pin');console.log('KILLED '+m.name+' removed');}
