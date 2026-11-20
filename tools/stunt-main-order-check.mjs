// Exercise the actual main frame with a terrain revision witness, not a copied task order.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {current,spy} from './world-update-fixture.mjs';
function check(source){
  let revision=0,seen=-1;
  const result=spy(source,false,true,false,(c,trace)=>{
    const update=c.terrain.update;c.terrain.update=(...args)=>{update(...args);revision++;};
    c.stuntPark={update:()=>{seen=revision;trace('stuntPark')();}};
  });
  assert.ok(revision>0,'actual frame selected terrain');
  assert.equal(seen,revision,'park visibility observes this frame terrain revision');
  assert.ok(result.calls.indexOf('stuntPark')>result.calls.lastIndexOf('terrain'),'park updates after terrain selection');
}
const source=process.env.STUNT_ORDER_BASE?execFileSync('git',['show',process.env.STUNT_ORDER_BASE+':web/src/main.ts'],{encoding:'utf8'}):current();
check(source);
if(!process.env.STUNT_ORDER_BASE){
  const from="name: 'stuntPark', segment: 'landscape'";
  assert.equal(source.split(from).length,2,'unique park ordering mutant anchor');
  assert.throws(()=>check(source.replace(from,"name: 'stuntPark', segment: 'before-camera'")),/park visibility observes this frame terrain revision|park updates after terrain selection/,'early park update must fail');
}
console.log('PASS actual main-frame park ordering and early-update mutant');
