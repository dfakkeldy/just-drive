import assert from 'node:assert/strict';
import {measureOwnReady,ownReadyExpression,assertMeasuredLayer,settleVerdict,SETTLE_ALLOWANCE_MS,SIDEWALK_AREAS,layerRequired} from './sidewalks-settle.mjs';
let time=0,read=0;const commands=[];
const c={async send(method,args){commands.push(method);if(method==='Page.navigate')return {result:{loaderId:'new'}};assert.equal(method,'Runtime.evaluate');assert.equal(args.expression,ownReadyExpression);return {result:{result:{value:++read===2}}};}};
const result=await measureOwnReady(c,'http://example.invalid',{now:()=>time,pause:async ms=>{time+=ms;},loader:()=> 'new'});assert.equal(result.ms,500);assert.equal(result.polls,2);assert.deepEqual(commands,['Page.navigate','Runtime.evaluate','Runtime.evaluate']);
time=0;await assert.rejects(()=>measureOwnReady(c,'http://example.invalid',{now:()=>time,pause:async ms=>{time+=ms;},loader:()=> 'previous',timeoutMs:1000}),/own ready timeout/);
assert.equal(commands.filter(m=>m==='Runtime.evaluate').length,2,'never read an old document as newly ready');
assert.ok(!commands.some(m=>m.startsWith('Fetch.')||m==='Page.addScriptToEvaluateOnNewDocument'));
assertMeasuredLayer(null,false);assertMeasuredLayer({disabled:false,draws:1,triangles:12},true);
for(const layer of [null,{disabled:true,draws:1,triangles:12},{disabled:false,draws:0,triangles:0}])assert.throws(()=>assertMeasuredLayer(layer,true),/working sidewalk/);
// The capped Point Tupper allowance: it passes up to its cap, never past it, and no other area gets one.
const noise={min:-300,median:0,max:100},cap=SETTLE_ALLOWANCE_MS.pointtupper;
assert.equal(settleVerdict({median:50},noise,'pointtupper',true),'within-noise');
assert.equal(settleVerdict({median:cap.low},noise,'pointtupper',true),'within-allowance');
assert.equal(settleVerdict({median:cap.low+1},noise,'pointtupper',true),'outside-noise');
assert.equal(settleVerdict({median:cap.high+1},noise,'pointtupper',false),'outside-noise');
for(const area of['mabou','porthood','cansocauseway'])assert.equal(settleVerdict({median:101},noise,area,true),'outside-noise',area+' has no allowance');
assert.equal(settleVerdict({median:cap.high},noise,'pointtupper',false),'within-allowance');
// The caps are measured costs, written here a second time so that widening one has to change this check too.
assert.deepEqual(SETTLE_ALLOWANCE_MS,{pointtupper:{low:630,high:770}},'the Point Tupper caps never widen, and no other area has one');
assert.deepEqual([...SIDEWALK_AREAS].sort(),['mabou','pointtupper','porthood'],'the areas whose page must show the sidewalk layer');
for(const area of['mabou','porthood','pointtupper'])assert.ok(layerRequired('fixed',area)&&layerRequired('warm-fixed',area),area+' current loads need the layer');
assert.ok(!layerRequired('fixed','cansocauseway')&&!layerRequired('base-fixed','mabou')&&!layerRequired('noise-a','mabou'),'main loads and Canso need no layer');
console.log('PASS probe-free readiness poll, fixed cadence, new-document guard and no injection/interception');
