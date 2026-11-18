import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-rail-truth-`);
const cases=[
 ['A1/A2 opening','surveyed-road-openings.ts','east: 619011, north: 5109683, width: 16','east: 619011, north: 5109683, width: 0'],
 ['field gate','surveyed-road-openings.ts','east: 618988, north: 5109228, width: 26','east: 618988, north: 5109228, width: 0'],
 ['gravel entrance','surveyed-road-openings.ts','east: 619002, north: 5109150, width: 16','east: 619002, north: 5109150, width: 0'],
 ['north termination','guardrail-rules.ts','junction: 18','junction: 4'],
 ['wooded end','guardrail-rules.ts','woodedCanopy: 4','woodedCanopy: 99'],
];
try{for(const[name,file,from,to]of cases){const path=resolve(root,'web/src',file),source=readFileSync(path,'utf8');assert.equal(source.split(from).length,2,name+' anchor');await build({entryPoints:[resolve(root,'tools/guardrail-ground-truth-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(file.replaceAll('.','\\.')+'$')},()=>({contents:source.replace(from,to),loader:'ts',resolveDir:dirname(path)}));}}]});const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{cwd:root,encoding:'utf8'});assert.notEqual(r.status,0,name+' must fail');assert.match(r.stderr,/AssertionError/,name+' assertion, not setup');console.log('REJECTED',name);}}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS five real-land ground-truth mutations');
