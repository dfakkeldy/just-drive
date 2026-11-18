import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(`${tmpdir()}/mmm-rail-mutations-`);
const cases=[
 ['flat false positive','guardrail-rules.ts',"const seed = h - h50 >= RAIL.seedDrop || h - h120 >= RAIL.broadDrop;\n        const on = h - h20 >= RAIL.nearDrop && (seed || h - h80 >= RAIL.extendDrop) && (context.coast?.(road, s, side) ?? true);",'const seed = true; const on = true;'],
 ['cliff omitted','guardrail-rules.ts','const seed = h - h50 >= RAIL.seedDrop || h - h120 >= RAIL.broadDrop;','const seed = false;'],
 ['bridge guard','guardrail-rules.ts','road.bridge || road.kind > 3','false || road.kind > 3'],
 ['driveway guard','guardrail-rules.ts','if (access(road, p))','if (false)'],
 ['short run guard','guardrail-rules.ts','minimum: 15.2','minimum: 2'],
 ['join guard','guardrail-rules.ts','join: 11.4','join: 0'],
 ['hard gap guard','guardrail-rules.ts','s === true','s !== false'],
 ['collision guard','guardrails.ts','pushOut(car, c.solids, false, dt)','void car'],
 ['LOW distance guard','guardrails.ts','this.terrain.low ? 180 : 650','650'],
 ['underwater height guard','guardrails.ts',': s.ground;',': s.ground / this.terrain.exag;'],
 ['survey height guard','guardrails.ts','(s.ground - this.terrain.seaLevel) / this.terrain.exag : s.ground;','(s.ground - this.terrain.seaLevel) / 1 : s.ground;'],
 ['post spacing','guardrail-rules.ts','postPitch: 3.8','postPitch: 1.9'],
 // The look: each of these is one way the rail went wrong before, or could again.
 ['beam follows the ground at each post','guardrails.ts','Math.max(road0, post - LOOK.berm)','post'],
 ['no height filter along the run','guardrail-look.ts','smooth: 5,','smooth: 0,'],
 ['rail height','guardrail-look.ts','top: 0.71,','top: 0.92,'],
 ['W turned away from the road','guardrail-look.ts','const out = d.bend - (o * c - v * sn);','const out = d.bend + (o * c - v * sn);'],
 ['whole stretch dented','guardrail-damage.ts','reach: 4.6','reach: 40'],
 ['LOW drawn at full detail','guardrail-look.ts','const W = this.low ? W_LOW : W_FULL','const W = W_FULL'],
];
try{for(const [name,file,from,to]of cases){const path=resolve(root,'web/src',file),source=readFileSync(path,'utf8');assert.equal(source.split(from).length,2,name+' anchor');
 await build({entryPoints:[resolve(root,'tools/guardrail-check.mjs')],bundle:true,platform:'node',format:'esm',outfile:`${dir}/check.mjs`,logLevel:'silent',plugins:[{name:'mutate',setup(b){b.onLoad({filter:new RegExp(file.replace('.','\\.')+'$')},()=>({contents:source.replace(from,to),loader:'ts',resolveDir:dirname(path)}));}}]});
 const r=spawnSync(process.execPath,[`${dir}/check.mjs`],{encoding:'utf8'});assert.notEqual(r.status,0,name+' must fail');assert.match(r.stderr,/AssertionError/,name+' assertion failure');console.log('REJECTED',name);
}}finally{rmSync(dir,{recursive:true,force:true});}
console.log('PASS',cases.length,'guardrail mutations');
