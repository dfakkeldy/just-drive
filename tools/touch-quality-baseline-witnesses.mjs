// Keep the exact reviewer faults reproducible against the frozen source.
import assert from 'node:assert/strict';
import { modules } from './touch-quality-module.mjs';
import { scenarios,run,violations } from './touch-quality-sweep.mjs';
const api=await modules(true);
for(const name of ['unfinished-clean-leave-1','recovery-then-return']){
 const scenario=scenarios.find(s=>s.name===name),base=run(api,scenario);
 const op=name.startsWith('unfinished')?base.store.ops.find((op,i,all)=>op.type==='get'&&op.key==='mmm.detail.trying'&&all[i-1]?.type==='set'&&all[i-1]?.value==='try'):base.store.ops.find(op=>op.type==='remove'&&op.key==='mmm.detail.recovered');
 for(const kind of op.type==='get'?['throw','stale']:['throw','noop']){
  const bad=run(api,scenario,{index:op.index,kind}),errors=violations(bad,base);
  assert.ok(errors.some(e=>e.startsWith(name.startsWith('unfinished')?'iii ':'iv ')));
  const ordinal=base.store.ops.slice(0,op.index).filter(call=>call.type===op.type).length;
  console.log('FAILS ON frozen touch-quality baseline',JSON.stringify({scenario:name,operation:op,kind,ordinalWithinOperationType:ordinal,errors,notices:[...bad.notices.values()]}));
 }
}
