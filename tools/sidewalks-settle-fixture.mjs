import assert from 'node:assert/strict';
import {measureOwnReady,ownReadyExpression,assertMeasuredLayer,POSES,DEFAULT_AREAS,SIDEWALK_AREAS,STARTUP_BUDGET_MS,budgetFor,evaluateBudget,assertWithinBudget,parseSelection,parseRuns} from './sidewalks-settle.mjs';
let time=0,read=0;const commands=[];
const c={async send(method,args){commands.push(method);if(method==='Page.navigate')return {result:{loaderId:'new'}};assert.equal(method,'Runtime.evaluate');assert.equal(args.expression,ownReadyExpression);return {result:{result:{value:++read===2}}};}};
const result=await measureOwnReady(c,'http://example.invalid',{now:()=>time,pause:async ms=>{time+=ms;},loader:()=> 'new'});assert.equal(result.ms,500);assert.equal(result.polls,2);assert.deepEqual(commands,['Page.navigate','Runtime.evaluate','Runtime.evaluate']);
time=0;await assert.rejects(()=>measureOwnReady(c,'http://example.invalid',{now:()=>time,pause:async ms=>{time+=ms;},loader:()=> 'previous',timeoutMs:1000}),/own ready timeout/);
assert.equal(commands.filter(m=>m==='Runtime.evaluate').length,2,'never read an old document as newly ready');
assert.ok(!commands.some(m=>m.startsWith('Fetch.')||m==='Page.addScriptToEvaluateOnNewDocument'));
assertMeasuredLayer(null,false);assertMeasuredLayer({disabled:false,draws:1,triangles:12},true);
for(const layer of [null,{disabled:true,draws:1,triangles:12},{disabled:false,draws:0,triangles:0}])assert.throws(()=>assertMeasuredLayer(layer,true),/working sidewalk/);
for(const area of DEFAULT_AREAS){
 assert.ok(POSES[area],`pose for ${area}`);
 for(const quality of ['low','high']){
  const ceiling=budgetFor(area,quality);
  assert.ok(ceiling>=1000&&ceiling<=15000,`sane ceiling for ${area} ${quality}: ${ceiling}`);
  const pass=assertWithinBudget(area,quality,[ceiling-200,ceiling-100,ceiling]);
  assert.equal(pass.pass,true);assert.equal(pass.ceilingMs,ceiling);
  assert.throws(()=>assertWithinBudget(area,quality,[ceiling-100,ceiling+1,ceiling+200]),/exceeds budget/);
  assert.equal(evaluateBudget(area,quality,[ceiling+10]).pass,false);
 }
}
assert.throws(()=>budgetFor('unknown','low'),/no start-up budget/);
assert.throws(()=>budgetFor('mabou','ultra'),/no start-up budget/);
assert.deepEqual(parseSelection(undefined,DEFAULT_AREAS,'area'),DEFAULT_AREAS);
assert.deepEqual(parseSelection('mabou, porthood',DEFAULT_AREAS,'area'),['mabou','porthood']);
for(const empty of [',',', ,','   '])assert.throws(()=>parseSelection(empty,DEFAULT_AREAS,'area'),/empty area selection/);
assert.equal(parseRuns(undefined),5);assert.equal(parseRuns('3'),3);
for(const bad of ['0','-1','1.5','abc'])assert.throws(()=>parseRuns(bad),/invalid STARTUP_BUDGET_RUNS/);
assert.equal(SIDEWALK_AREAS.has('mabou')&&SIDEWALK_AREAS.has('porthood')&&SIDEWALK_AREAS.has('pointtupper'),true);
assert.equal(SIDEWALK_AREAS.has('westbay'),false);
assert.ok(Object.keys(STARTUP_BUDGET_MS).length===DEFAULT_AREAS.length);
// The ceilings, written here a second time so that raising one has to change this check too (and say what the player gets).
assert.deepEqual(JSON.parse(JSON.stringify(STARTUP_BUDGET_MS)),{mabou:{low:3300,high:7000},porthood:{low:2200,high:4700},pointtupper:{low:3000,high:6400},cansocauseway:{low:2300,high:5000},judique:{low:2350,high:5300},westbay:{low:3500,high:7000}},'the start-up ceilings change only with this pin');
assert.deepEqual([...SIDEWALK_AREAS].sort(),['mabou','pointtupper','porthood'],'the areas whose page must show the sidewalk layer');
console.log('PASS probe-free readiness poll, fixed cadence, new-document guard, no injection/interception and plain start-up budget');
