import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {CoastSite,COAST_BOX,lineDistance,COVE_SHORE,POINT_SHORE} from '../web/src/coast-site.ts';
const dir=pathToFileURL(resolve(process.env.MMM_COAST_OUT??'data/work/coast/build')+'/');
const rows=JSON.parse(readFileSync(new URL('tree-survey.json',dir),'utf8')),site=new CoastSite([624271,5103301]);
const counts={checked:rows.length,retained:0,removed:0,sea:0,highWater:0,beach:0,cliff:0},rejected=[];
for(const p of rows){
 const x=p.e-624271,z=5103301-p.n,near=lineDistance(p.e,p.n,p.n>5110120?POINT_SHORE:COVE_SHORE)<=100;
 const ok=site.treeAllowed(x,z,p.h,p.slope);
 if(!ok){counts.removed++;rejected.push(p);if(p.h<=-.18)counts.sea++;else if(p.h<=.75)counts.highWater++;else if(p.slope>=.65)counts.cliff++;else counts.beach++;}
 else{counts.retained++;if(near){assert.ok(p.h>.75,'retained above high water');assert.ok(p.slope<.65,'retained off unstable face');assert.ok(site.weights(x,z,p.h,p.slope)[3]<.15,'retained off beach');}}
}
assert.ok(counts.checked>4000&&counts.removed>0);writeFileSync(new URL('tree-results.json',dir),JSON.stringify({box:COAST_BOX,counts,rejected},null,2));console.log('PASS full coast tree/bush survey',JSON.stringify(counts));
