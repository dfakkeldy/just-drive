import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('./sidewalks-runtime.mjs',import.meta.url),'utf8'),fn=source.match(/function checkFrameCosts\(\)\{[\s\S]*?\n\}\n/)?.[0];assert.ok(fn);
function run(change=()=>{},low=false){const loads=Array.from({length:4},(_,i)=>({area:'test',low,warmup:i===0,audit:{draws:2,triangles:900,startupMs:3,disabled:false},maxFrame:1,frameStats:{sidewalk:{p95:.4}}}));change(loads);const report={loads};runInNewContext(fn+'\ncheckFrameCosts();',{assert,report,selectedAreas:['test'],selectedQualities:[low],startupBaseline:{low:{test:{median:2.5,max:3}}},save(){},console:{log(){}}});return report;}
assert.equal(run().frameTargets[0].frameWorst,1);run(()=>{},true);
const cold=run(rows=>rows[0].maxFrame=4.1).frameTargets[0];assert.equal(cold.frameWorst,4.1);assert.equal(cold.frameMeasuredWorst,1,'accepted cold control separates warm-up context from the measured-load gate');
assert.throws(()=>run(rows=>rows[1].maxFrame=2.001));assert.throws(()=>run(rows=>rows[1].audit.draws=3));assert.throws(()=>run(rows=>rows[1].audit.disabled=true));assert.throws(()=>run(rows=>rows[1].audit.startupMs=21));assert.throws(()=>run(rows=>rows.forEach(r=>r.audit.startupMs=4.1),true));
console.log('PASS separate clocked frame/startup execution and frame, disabled-layer, draw, startup and LOW mutants');
