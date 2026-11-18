#!/usr/bin/env node
// One browser lease; all native proofs run serially in that browser.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const [out,base]=process.argv.slice(2),tools=import.meta.dirname;
const runs=[
 ['water join','far-views-join.mjs',{}],
 ['original near pixels','far-views-near.mjs',{FAR_NEAR_QUALITIES:'desktop,LOW',FAR_NEAR_AREAS:'mabou,judique,porthood,pointtupper,westbay,cansocauseway'}],
 ['depth-tested target visibility','far-views-visible.mjs',{}],
 ['before/after game views','far-views-browser.mjs',{FAR_LOW:'0'}],
 ['1280 shore comparisons','far-views-browser.mjs',{FAR_LOW:'0',FAR_WIDTH:'1280',FAR_HEIGHT:'720',FAR_VIEWS:'marble-se,shore-mabou,shore-cape'}],
 ['LOW horizon','far-views-browser.mjs',{FAR_LOW:'1',FAR_WIDTH:'1280',FAR_HEIGHT:'720',FAR_VIEWS:'mabou-nw,high-mabou,high-sea,very-high-sea',FAR_MODES:'after'}],
];
for(const [label,file,extra]of runs){
 if(process.env.FAR_FINAL_ONLY&&!process.env.FAR_FINAL_ONLY.split(',').includes(file))continue;
 console.log('VERIFY',label);const result=spawnSync(process.execPath,[resolve(tools,file),out,base],{env:{...process.env,...extra},stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
}
