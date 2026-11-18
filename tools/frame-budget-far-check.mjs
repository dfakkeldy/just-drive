#!/usr/bin/env node
// The far views budget deltas (tools/baseline/frame-budget-far.json) and how the budget check applies them.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FAR_DELTAS,validDeltas,effective,stored,farLand} from './frame-budget-far.mjs';
import {metrics,allKeys,coverage} from './frame-budget-policy.mjs';
validDeltas();
const pins=JSON.parse(readFileSync(new URL('./baseline/frame-budget.json',import.meta.url),'utf8'));
const traffic=JSON.parse(readFileSync(new URL('./baseline/frame-budget-traffic.json',import.meta.url),'utf8'));
for(const b of [pins,traffic]){
 assert.equal(coverage(b,allKeys(),false,()=>{}),false);
 assert.deepEqual(effective(b,'before'),b,'before land: ceilings are the pins');
 const after=effective(b,'after');
 for(const k of allKeys())for(const m of metrics)assert.equal(after[k][m],b[k][m]+FAR_DELTAS.rows[k][m]);
 assert.deepEqual(stored(after,'after'),b,'after land: --update/--raise store the pin, not the far cost');
}
const sources=['frame-budget-check.mjs','frame-budget-mutations.mjs'].map(f=>readFileSync(new URL('./'+f,import.meta.url),'utf8'));
assert.match(sources[0],/baseline=effective\(baseline,land\)/,'the check compares against this land\'s ceilings');
assert.match(sources[0],/serialize\(stored\(next,land\)\)/,'updates store pins without the far cost');
assert.match(sources[0],/v\.update=\(\)=>\{\};.*for\(const r of v\.records\)r\.mesh\.visible=true;/,'after land: far cost is the worst case, not a probe phase');
assert.match(sources[0],/mmm\.farVisibility&&mmm\.farLand&&mmm\.tall&&mmm\.farTurbines/,'after land: wait for every far part');
const reject=(label,deltas)=>{assert.throws(()=>validDeltas(deltas),undefined,label);console.log('KILLED',label);};
if(process.argv.includes('--mutations')){
 const key=allKeys()[0],copy=()=>structuredClone(FAR_DELTAS);
 reject('negative delta',(d=>{d.rows[key].calls=-1;return d;})(copy()));
 reject('missing row',(d=>{delete d.rows[key];return d;})(copy()));
 reject('missing metric',(d=>{delete d.rows[key].textures;return d;})(copy()));
 reject('fractional delta',(d=>{d.rows[key].triangles+=.5;return d;})(copy()));
}
console.log(`PASS far budget deltas: ${allKeys().length} rows; this land is ${farLand()}; pins and traffic pins round-trip on after land`);
