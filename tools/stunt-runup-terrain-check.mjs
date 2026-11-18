// Full production Terrain loading: run-up clearing may change cover, never ground or drawn vertices.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeGround,preload} from './phone-ground.mjs';
import {YardSite} from '../web/src/yard-site.ts';
import {StuntPark} from '../web/src/stunt-kit.ts';
import {testParkLayout,testParkDressing,testParkRunups} from '../web/src/stunt-test-park.ts';
const buildings=JSON.parse(readFileSync('../data/baked/terrain/buildings.json')).buildings;
async function load(low,lanes,mutant=false){
 process.env.PHONE_EXAG='2.5';const {terrain}=makeGround();terrain.low=low;const yard=new YardSite(terrain.manifest.village,'invented');terrain.sites.push(yard);
 const dressing=testParkDressing(yard),runups=testParkRunups(dressing),exclusions=buildings.map(b=>({x:b.x-terrain.manifest.village[0],z:terrain.manifest.village[1]-b.y,radius:60+Math.hypot(b.length,b.width)/2}));
 const park=new StuntPark(terrain,testParkLayout(yard),low,exclusions,dressing,lanes?runups:[]);await park.prepare();
 if(mutant){const height=park.height.bind(park);park.height=(x,z,raw,level)=>height(x,z,raw,level)+(level===8&&park.runupAt(x,z) ? 0.1 : 0);}
 const points=runups.flatMap(p=>[p.from,p.to,(p.from+p.to)/2].flatMap(u=>[-p.halfWidth,0,p.halfWidth].map(v=>[p.x+u*Math.sin(p.heading)+v*Math.cos(p.heading),p.z-u*Math.cos(p.heading)+v*Math.sin(p.heading)])));
 await preload(terrain,points,30);return{terrain,points};
}
let tiles=0,vertices=0;
for(const low of[false,true]){
 const a=await load(low,false),b=await load(low,true),keys=[...a.terrain.tiles.keys()].sort();assert.deepEqual([...b.terrain.tiles.keys()].sort(),keys);
 for(const key of keys){const x=a.terrain.tiles.get(key),y=b.terrain.tiles.get(key);assert.ok(x.ready&&y.ready&&x.mesh&&y.mesh);
  const p=x.mesh.geometry.attributes.position.array,q=y.mesh.geometry.attributes.position.array;
  assert.deepEqual(Buffer.from(p.buffer,p.byteOffset,p.byteLength),Buffer.from(q.buffer,q.byteOffset,q.byteLength),'cleared-lane vertices are exactly unchanged: '+key);tiles++;vertices+=p.length/3;
 }
 for(const[x,z]of a.points){assert.equal(a.terrain.heightAt(x,z),b.terrain.heightAt(x,z),'contact ground remains identical');}
 if(low){const m=await load(low,true,true);let max=0;for(const key of keys){const p=a.terrain.tiles.get(key).mesh.geometry.attributes.position.array,q=m.terrain.tiles.get(key).mesh.geometry.attributes.position.array;for(let i=1;i<p.length;i+=3)max=Math.max(max,Math.abs(p[i]-q[i]));}
  assert.ok(max>.09,'a10cm run-up grading mutant must change the real drawn vertices');m.terrain.tiles.clear();m.terrain.group.clear();
 }
 a.terrain.tiles.clear();a.terrain.group.clear();b.terrain.tiles.clear();b.terrain.group.clear();
}
console.log('PASS real baked run-up ground/vertex parity and10cm grading negative control',{tiles,vertices});
