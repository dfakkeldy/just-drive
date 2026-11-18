// Real level-6 map samples: a short timber approach must survive terrain mesh decimation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Terrain} from '../web/src/terrain.ts';
import {Roads} from '../web/src/roads.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {createHorse,HORSE_SPEC} from '../web/src/horse.ts';
import {HistoryBridgeApproaches} from '../web/src/eras/history-approaches.ts';
import {historyGround} from '../web/src/eras/history-ground.ts';
import {makeGround,preload,bakedRoads,manifest} from './phone-ground.mjs';
function digest(terrain){const hash=createHash('sha256');for(const [key,t]of [...terrain.tiles].sort(([a],[b])=>a.localeCompare(b))){hash.update(key);for(const a of [t.mesh.geometry.attributes.position.array,t.mesh.geometry.index.array])hash.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));}return hash.digest('hex');}
async function cross(refine,hill=1.5,direction=1){
 process.env.PHONE_EXAG=String(hill);
 const {terrain}=makeGround();terrain.cartRoads=true;terrain.surfaceAt=Terrain.prototype.surfaceAt.bind(terrain);
 const roads=new Roads(bakedRoads,manifest.village,terrain),r=roads.roads.find(r=>r.id===97),points=direction===1?r.pts:[...r.pts].reverse(),a=points[0],b=points.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1]);
 const ground=await historyGround(manifest,'../data/baked/terrain',roads.roads.filter(r=>r.bridge).flatMap(r=>r.pts.map(([x,z])=>[x+manifest.village[0],manifest.village[1]-z])));
 const approaches=new HistoryBridgeApproaches(roads,terrain,ground,refine);approaches.install(terrain);
 await preload(terrain,r.pts,120,6);for(const t of terrain.tiles.values()){t.mesh.visible=true;t.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);t.mesh.updateMatrixWorld();}
 roads.update(new THREE.Vector3(a[0],60,a[1]));
 const v=new Vehicle(createHorse(),terrain,roads,-.2,HORSE_SPEC);v.assist=0;v.restart(a[0],a[1],Math.atan2(b[0]-a[0],a[1]-b[1]));let progress=0,max=0,core=0,where=null;
 for(let step=0;step<3000&&progress<length+5;step++){
  progress=((v.x-a[0])*(b[0]-a[0])+(v.z-a[1])*(b[1]-a[1]))/length;
  const goal=Math.min(length+7,progress+6),gx=a[0]+(b[0]-a[0])*goal/length,gz=a[1]+(b[1]-a[1])*goal/length,h=Math.atan2(gx-v.x,v.z-gz),e=Math.atan2(Math.sin(h-v.heading),Math.cos(h-v.heading));
  terrain.withGroundContact(v,()=>v.update(1/120,{throttle:Math.abs(v.speed)<4?1:Math.abs(v.speed)>5?-.1:0,steer:Math.max(-1,Math.min(1,e*2)),handbrake:false}));
  const deck=roads.deckHeight(v.x,v.z);if(deck!==null){if(Math.abs(v.y-deck)>max){max=Math.abs(v.y-deck);where={progress,x:v.x,z:v.z,y:v.y,deck,contacts:v.groundContacts.map(p=>({...p,deck:roads.deckHeight(p.x,p.z),aprons:approaches.aprons.map(a=>a.site.deckHeight(p.x,p.z)),surface:terrain.surfaceAt(p.x,p.z)?.deck})),aprons:approaches.aprons.map(a=>a.site.deckHeight(v.x,v.z))};}if(progress>2&&progress<length-2)core=Math.max(core,Math.abs(v.y-deck));}
 }
 assert(progress>=length+5,'cross the approach, not just the span');
 const probes=[[6134.696960788925,4713.157761601574],[6134.239635114712,4712.910267707294]].map(([x,z])=>({raw:terrain.heightAt(x,z),mesh:terrain.meshHeightAt(x,z,true)}));
 const grids=[...new Set([...terrain.tiles.values()].map(t=>Math.round(Math.sqrt(t.mesh.geometry.attributes.position.count))-3))];
 const land={tiles:terrain.tiles.size,vertices:[...terrain.tiles.values()].reduce((n,t)=>n+t.mesh.geometry.attributes.position.count,0),triangles:[...terrain.tiles.values()].reduce((n,t)=>n+t.mesh.geometry.index.count/3,0),bytes:[...terrain.tiles.values()].reduce((n,t)=>n+Object.values(t.mesh.geometry.attributes).reduce((a,b)=>a+b.array.byteLength,0)+t.mesh.geometry.index.array.byteLength,0)};
 const timber={aprons:approaches.aprons.length,triangles:approaches.aprons.reduce((n,a)=>n+a.audit.triangles,0),bytes:approaches.aprons.reduce((n,a)=>n+a.audit.bytes,0)};
 const landHash=digest(terrain);
 for(const t of terrain.tiles.values()){t.mesh.geometry.dispose();t.mesh.material.dispose();}terrain.tiles.clear();
 return{max,core,where,grids,probes,land,timber,landHash};
}
const before=await cross(false),after=await cross(true);console.log('COARSE_GEOMETRY_MEASUREMENTS',JSON.stringify({before,after}));
assert(before.max>1,'negative control reproduces the original coarse-bank support fault');
assert.deepEqual(before.grids,[64],'negative control retains the original coarse geometry');
assert(before.probes.every(p=>Number.isFinite(p.mesh))&&after.probes.every(p=>Number.isFinite(p.mesh)),'both controls sample real visible triangles');
assert.deepEqual(after.grids,before.grids,'land resolution is unchanged');assert.deepEqual(after.land,before.land,'land tiles triangles and bytes are unchanged');assert.equal(after.landHash,before.landHash,'era land positions and triangles are byte-identical with timber enabled');assert(after.timber.triangles>0&&after.timber.triangles<5000,'bounded timber-side approach geometry');
assert(after.max<1,'whole level-6 crossing, including end approaches, stays on its support');
assert(after.core<.05,'actual timber span contact remains within five centimetres');
console.log('PASS real level-6 bridge/approach geometry',JSON.stringify({before,after}));
for(const hill of [1,1.5,2.5])for(const direction of [1,-1]){const report=await cross(true,hill,direction);console.log('MEASURE',hill,direction,JSON.stringify(report));assert(report.max<1&&report.core<.05,'coarse approach at hill '+hill+' direction '+direction);console.log('PASS coarse hill/direction',hill,direction,JSON.stringify(report));}
process.env.PHONE_EXAG='1.5';
// With no opt-in site, normal land keeps the original 64-segment geometry.
const {terrain:today}=makeGround();
// Raw road coordinates differ from Roads' local frame; use the observed bridge point.
await preload(today,[[6134,4713]],0,6);const tile=[...today.tiles.values()][0];assert.equal(Math.round(Math.sqrt(tile.mesh.geometry.attributes.position.count))-3,64);
// Recorded with Terrain from origin/main 883363c and the same 6/37_36 baked tile.
// Recorded again on the road-shaped ground land (the tile's road field changed): Terrain from 883363c and
// today's Terrain both give this digest there, and both gave 2c5b91a0… on the land before it.
// Change only for an intentional default-geometry or baked-data change.
assert.equal(digest(today),'49e8fd6cebde37d07d145a874fe69ac5b7cdd621df60c8f4fa43c576361327d3','today geometry is byte-identical to main 883363c');
console.log('PASS today level-6 geometry byte-identical to main 883363c');
