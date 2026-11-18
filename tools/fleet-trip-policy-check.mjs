import assert from 'node:assert/strict';
import {tripFailure,tripVerdict,unmeasuredStartupFailure} from './fleet-trip-verdict.mjs';
const record=(run,low,hill)=>({run,low,hill,end:{driver:'truck',attached:true,states:[{id:'truck',state:'DRIVEN'},{id:'sxs',state:'STRAPPED'},{id:'bike',state:'STRAPPED'}],contactStats:{failures:1,debtFailures:1,functionalFailures:0}}});
const all=['A','B'].flatMap(run=>[false,true].flatMap(low=>[1,1.5,2,2.5].map(h=>record(run,low,h))));
assert.equal(tripVerdict(all,'functional',true),0);assert.equal(tripVerdict(all,'contact-debt',true),1,'natural debt retains its actual failure');
const bad=structuredClone(all);bad[15].end.contactStats.functionalFailures=1;bad[15].end.contactStats.failures=2;assert.equal(tripVerdict(bad,'functional',true),1,'an exact-surface failure cannot be hidden by debt classification');
assert.throws(()=>tripVerdict(all.slice(1),'functional',true));
const failedJob=structuredClone(all);failedJob[15].jobExit=2;assert.equal(tripVerdict(failedJob,'functional',true),1,'a failed browser process cannot publish a passing functional verdict');
for(const[state,surface,debt]of[['DRIVEN','natural',true],['DRIVEN','exact',false],['PARKED','natural',false],['MOVING','natural',false],['STRAPPED','exact',false]]){globalThis.window={qf:{terrain:{manifest:{village:[0,0]}},contactMember:{state},contactStats:{}}};tripFailure('probe',{surface,point:[123,0,456],error:.06});assert.equal(window.qf.contactStats[debt?'debtFailures':'functionalFailures'],1);assert.equal(window.qf.contactStats.failures,1);}
console.log('PASS functional and debt verdicts remain separate; exact and non-driven failures stay functional');

const startup='browser-check: could not verify owned server/browser listeners';
assert.equal(unmeasuredStartupFailure(2,startup,false),true);
for(const [exit,log,measured]of[[1,startup,false],[2,startup,true],[2,'page assertion failed',false],[124,startup,false],[0,startup,false]])assert.equal(unmeasuredStartupFailure(exit,log,measured),false,'only an unmeasured listener startup can be retried');
console.log('PASS measured failures and timeouts cannot enter startup retry');
