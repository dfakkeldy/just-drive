// Era adaptation of the shared numeric road/bridge grid. No separate deck index.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Roads} from '../web/src/roads.ts';
const ground=(x,z)=>6+x*.02+z*.03;
const terrain={cartRoads:true,dataRevision:1,contactRevision:1,seaLevel:-.2,heightAt:ground,meshHeightAt:ground,surfaceAt:(x,z)=>({ground:ground(x,z),level:6})};
const road=(id,kind,pts,bridge=true)=>({id,name:null,kind,halfWidth:4,bridge,pts:pts.map(([x,z])=>[x,-z])});
const roads=new Roads({roads:[road(91,1,[[65,0],[125,0]]),road(2,1,[[125,0],[175,0]]),road(3,3,[[90,-30],[90,30]]),road(93,1,[[125,0],[125,0]]),road(4,5,[[0,70],[100,70]]),...Array.from({length:400},(_,i)=>road(i+10,2,[[1000+i*100,1000],[1010+i*100,1010]],false))]},[0,0],terrain);
assert([...roads.cells.keys()].every(k=>typeof k==='number'),'era uses main numeric grid');
assert.equal(typeof roads.eraDeckHeight,'undefined','one shared deck query path');
assert.equal(roads.roads.some(r=>r.kind===5),false,'rail trail is removed before indexing');
assert(roads.roads.find(r=>r.id===91).halfWidth<4,'cart widths remain narrow');
for(const [key,bucket] of roads.bridgeCells){assert.equal(typeof key,'number');for(const [ri]of bucket)assert(roads.roads[ri].bridge);}
let shared=0;const query=roads.query;
roads.query=function(cells,...args){assert.equal(cells,this.bridgeCells);shared++;return query.call(this,cells,...args);};
assert(Number.isFinite(roads.deckHeight(90,0)),'zero-length internal join cannot poison a deck');assert.equal(shared,1,'deckHeight uses the same bridge-grid query as today');roads.query=query;
assert.equal(roads.query(roads.bridgeCells,90,0,12).road.id,91,'crossing ties retain era source order');
assert.notEqual(roads.deckHeight(63,0),null,'outer timber approach crosses a cell boundary');
assert.equal(roads.deckHeight(61.999,0),null,'beyond the outer approach is land');
assert.notEqual(roads.deckHeight(125,0),null,'connected timber records share the inner join');
const keys=[];for(const grid of [roads.cells,roads.bridgeCells]){const get=grid.get.bind(grid);grid.get=k=>{keys.push(k);return get(k);};}
roads.update(new THREE.Vector3(65,10,0));globalThis.__eraHotAllocations=0;
for(let i=0;i<500;i++)roads.deckHeight(90,0);
assert(keys.every(k=>typeof k==='number'),'no era road/deck key strings');
assert.equal(globalThis.__eraHotAllocations,0,'settled shared deck query reuses its hit');
assert(roads.audit.heightCandidatesMax<=4,'duplicate buckets do not multiply era candidates');
assert.equal(roads.audit.connectivityBuilds,1,'connected spans stay cached');
console.log('PASS era shared bridge grid: cart widths, no rail, crossing tie, boundary approach, connected join, numeric keys, zero hot allocations',JSON.stringify(roads.audit));
