import assert from 'node:assert/strict';
import {countDelta,checkCountDelta,sidewalkDepthProgramKey,checkUnchangedCounts,countMetrics,checkProvenCountDelta} from './sidewalks-counts-policy.mjs';
const delta=countDelta({calls:100,triangles:1000,geometries:20,textures:10,programs:5,readyTiles:10,requests:20},{calls:102,triangles:5812,geometries:22,textures:10,programs:5,readyTiles:10,requests:21});checkCountDelta(delta,true,{sidewalks:2});
for(const [key,value]of [['programs',1],['textures',1],['geometries',3],['calls',3],['triangles',4817]])assert.throws(()=>checkCountDelta({...delta,[key]:value},true,{sidewalks:2}));
assert.throws(()=>checkCountDelta(delta,true,{}),/explained/);checkCountDelta({...delta,calls:4,triangles:12000},false,{sidewalks:2,'sidewalks (shadow)':2});
assert.throws(()=>checkCountDelta({...delta,triangles:12001},false,{sidewalks:2}));console.log('PASS same-host render deltas and program, texture, geometry, unexplained draw and LOW/desktop triangle mutants');

const widenedLow={...delta,triangles:4816+960};
checkCountDelta(widenedLow,true,{sidewalks:2},{bridgeDeckTriangles:960});
assert.throws(()=>checkCountDelta({...widenedLow,triangles:4817+960},true,{sidewalks:2},{bridgeDeckTriangles:960}),/per-view triangle/);
assert.throws(()=>checkCountDelta(widenedLow,true,{sidewalks:2},{bridgeDeckTriangles:1920}),/widened deck/);
assert.throws(()=>checkCountDelta(widenedLow,true,{sidewalks:2},{bridgeDeckTriangles:961}),/widened deck/);
checkCountDelta({...delta,triangles:12000+1920},false,{sidewalks:2},{bridgeDeckTriangles:1920});

const context={view:'highway19-far-land',mode:'desktop-mail',addedPrograms:[sidewalkDepthProgramKey],removedPrograms:[]};
checkCountDelta({...delta,programs:1},false,{sidewalks:2},context);
for(const mutant of [{...context,view:'village-start'},{...context,mode:'desktop-explore-truck'},{...context,addedPrograms:['other-depth-key']},{...context,addedPrograms:[sidewalkDepthProgramKey,'extra-key']},{...context,removedPrograms:['hidden-change']}])assert.throws(()=>checkCountDelta({...delta,programs:1},false,{sidewalks:2},mutant));
assert.throws(()=>checkCountDelta({...delta,programs:2},false,{sidewalks:2},context));
console.log('PASS exact named depth-program exception; other view/mode/key, extra key, hidden removal and +2 mutants FAIL');
assert.throws(()=>checkCountDelta({...delta,programs:1},true,{sidewalks:2},context));
assert.throws(()=>checkCountDelta({...delta,readyTiles:1},true,{sidewalks:2}));
for(const requests of [0,2])assert.throws(()=>checkCountDelta({...delta,requests},true,{sidewalks:2}));
for(const context of [{area:'westbay'},{era:true}]){checkCountDelta({...delta,requests:0},true,{sidewalks:2},context);assert.throws(()=>checkCountDelta(delta,true,{sidewalks:2},context));}
console.log('PASS companion request count and missing/duplicate/non-surveyed/1884 mutants');

const zero=Object.fromEntries(countMetrics.map(k=>[k,0]));checkUnchangedCounts(zero,['depth'],['depth']);
for(const metric of countMetrics)assert.throws(()=>checkUnchangedCounts({...zero,[metric]:1},['depth'],['depth']));
assert.throws(()=>checkUnchangedCounts(zero,['depth'],['new-key']));console.log('PASS exact e701 count-parity gate and all seven count/program-key mutants');

checkProvenCountDelta(delta,delta);assert.throws(()=>checkProvenCountDelta(delta,undefined));
for(const metric of countMetrics)assert.throws(()=>checkProvenCountDelta({...delta,[metric]:delta[metric]+1},delta));console.log('PASS proven per-row/all-seven delta gate and changed-delta mutants');
