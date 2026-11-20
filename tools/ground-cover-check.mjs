import assert from 'node:assert/strict';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync} from 'node:fs';
import {GroundCover,clearsGroundTrees,growsGroundGrass} from '../web/src/ground-cover.ts';
import {Terrain} from '../web/src/terrain.ts';
import {Trees} from '../web/src/trees.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {BikeRide} from '../web/src/bike-ride.ts';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {createRequire} from 'node:module';
const ts=createRequire(new URL('../web/package.json',import.meta.url))('typescript');

function file(width,height,runs){
  const b=new ArrayBuffer(16+runs.length*8),d=new DataView(b);
  d.setUint32(0,0x31304347,true);d.setUint32(4,width,true);d.setUint32(8,height,true);d.setUint32(12,runs.length,true);
  runs.forEach(([start,length,cls],i)=>{d.setUint32(16+i*8,start,true);d.setUint16(20+i*8,length,true);d.setUint8(22+i*8,cls);});return b;
}
function cases(api){
  const c=new api.GroundCover(file(5,4,[[1,2,6],[10,3,8],[18,2,6]]),5,4);
  const expected=[[0,6,6,0,0],[0,0,0,0,0],[8,8,8,0,0],[0,0,0,6,6]];
  for(let r=0;r<4;r++)for(let col=0;col<5;col++)assert.equal(c.at((col+.5)/5,(r+.5)/4),expected[r][col]);
  for(const [u,v]of [[-1,.5],[1,.5],[.5,-1],[.5,1],[NaN,.5],[.5,Infinity]])assert.equal(c.at(u,v),0);
  assert.equal(new api.GroundCover(file(3,2,[]),3,2).at(.2,.2),0);
  for(const runs of [[[4,2,6]],[[1,0,6]],[[1,1,9]],[[1,2,6],[2,1,8]],[[20,1,6]]])
    assert.throws(()=>new api.GroundCover(file(5,4,runs),5,4));
  assert.throws(()=>new api.GroundCover(new ArrayBuffer(5),1,1));
  assert.throws(()=>new api.GroundCover(file(5,4,[]),4,5));
  for(const cls of [0,1,2,3,4,5,7,9,10,11,12,13])assert.equal(api.clearsGroundTrees(cls),false,'keep trees class '+cls);
  assert.equal(api.clearsGroundTrees(6),true);assert.equal(api.clearsGroundTrees(8),true);
  for(const cls of [4,6,7,10,12])assert.equal(api.growsGroundGrass(cls),false);
  for(const cls of [0,1,2,3,5,8,9,11,13])assert.equal(api.growsGroundGrass(cls),true);
}
cases({GroundCover,clearsGroundTrees,growsGroundGrass});
// Exercise the real production Surface reader: mineral adds handling only, never road geometry or height.
const t=Object.create(Terrain.prototype),tile={x0:0,z0:0,size:256,level:8,ground:new Float32Array(257*257).fill(12),canopy:new Float32Array(257*257),road:null,brook:null};
t.find=()=>tile;t.withDeck=(_x,_z,h)=>h;t.waterLevelAt=()=>null;t.groundClassAt=()=>6;t.cartRoads=false;
const s=t.surfaceAt(50,50);assert.equal(s.mineral,true);assert.equal(s.ground,12);assert.equal(s.kind,0);assert.equal(s.roadDist,99);
t.groundClassAt=()=>8;assert.equal(t.surfaceAt(50,50).mineral,undefined);
t.groundClassAt=()=>6;t.cartRoads=true;assert.equal(t.surfaceAt(50,50).mineral,undefined);
t.cartRoads=false;t.waterLevelAt=()=>12;assert.equal(t.surfaceAt(50,50).mineral,undefined);
console.log('PASS ground CPU parser, every fixture cell, tree/grass policy and real Terrain.surfaceAt');

function planting(TreeClass){
 const buffer=new ArrayBuffer(8),d=new DataView(buffer);d.setUint16(0,32768,true);d.setUint16(2,32768,true);d.setUint8(4,50);d.setUint8(5,10);d.setUint8(7,42);
 let cls=0;
 const terrain={low:true,manifest:{origin:[0,0],village:[0,0]},clear:[],surfaceAt:()=>({level:8}),heightAt:()=>10,groundClassAt:()=>cls};
 const trees=new TreeClass(['0_0'],'',terrain,false);
 for(cls of [1,5,6,7,8,9,11,13]){
  trees.plant('0_0',d);
  const tile=trees.tiles.get('0_0'),count=tile.meshes.reduce((n,m)=>n+m.count,0);
  assert.equal(count,cls===6||cls===8?0:1,'production tree planting class '+cls);
  for(const mesh of tile.meshes){trees.group.remove(mesh);mesh.dispose();}
 }
}
planting(Trees);console.log('PASS production Trees.plant keeps wooded wetland and rejects only class 6/8');
function bootOrder(source){
 const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true),statements=[...tree.statements];
 const awaited=s=>ts.isExpressionStatement(s)&&ts.isAwaitExpression(s.expression)&&s.getText(tree).includes('terrain.readGroundCover()');
 // Modern land only: the 1884 era keeps today's cover handling (review finding 2).
 const ready=statements.findIndex(s=>ts.isIfStatement(s)&&s.expression.getText(tree)==='ERA.modern'&&!s.elseStatement&&awaited(s.thenStatement));
 const planting=statements.findIndex(s=>s.getText(tree).includes('new Trees('));
 assert(ready>=0&&planting>ready,'approved class bytes must be awaited before trees or terrain frames');
}
const mainSource=readFileSync('web/src/main.ts','utf8');bootOrder(mainSource);
function driving(VehicleClass){
 const net={roads:[],nearest:()=>null,deckHeight:()=>null};
 const sample=(mineral,kind=0)=>{
  const node=()=>new THREE.Object3D(),model={root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};
  const terrain={heightAt:()=>100,withContactHeight:(_body,read)=>read(),surfaceAt:()=>({ground:100,canopy:0,kind,mineral,washboard:false,roadDist:kind?0:99,halfWidth:3,level:8})};
  const vehicle=new VehicleClass(model,terrain,net,0);vehicle.place(0,0,0);
  for(let i=0;i<12;i++)vehicle.update(1/120,{throttle:.5,steer:0,handbrake:false});
  return vehicle.surfaceName;
 };
 assert.equal(sample(true),'gravel','confirmed mineral reuses production gravel feel');
 assert.notEqual(sample(false),'gravel','ordinary off-road keeps its previous handling');
 assert.equal(sample(true,1),sample(false,1),'mapped road wins over mineral handling');
}
driving(Vehicle);console.log('PASS production Vehicle gravel selection and mapped-road priority');

function bikeDriving(BikeClass){
 const sample=(surface,deck=null)=>{
  const rig={root:new THREE.Group(),pose(){}};
  const terrain={heightAt:()=>100,withContactHeight:(_body,read)=>read(),surfaceAt:()=>({
   ground:100,canopy:0,kind:0,washboard:false,roadDist:99,halfWidth:3,level:8,...surface,
  })};
  const bike=new BikeClass(rig,terrain,{nearest:()=>null,deckHeight:()=>deck},0);
  assert.ok(bike.place(0,0,0));
  for(let i=0;i<12;i++)bike.update(1/120,{throttle:.5,steer:0,handbrake:false});
  return {surface:bike.surfaceName,speed:bike.speed};
 };
 const gravel=sample({kind:3,roadDist:0});
 assert.equal(gravel.surface,'gravel');
 assert.deepEqual(sample({mineral:true}),gravel,'confirmed mineral uses the bike gravel response');
 assert.deepEqual(sample({mineral:true,kind:1,canopy:5}),gravel,'confirmed mineral wins off the road and under stale canopy');
 assert.equal(sample({}).surface,'grass');
 assert.equal(sample({canopy:5}).surface,'brush');
 assert.equal(sample({mineral:true,kind:1,roadDist:0}).surface,'pavement');
 assert.equal(sample({mineral:true,deck:true}).surface,'concrete');
 assert.equal(sample({mineral:true},100).surface,'pavement');
}
bikeDriving(BikeRide);console.log('PASS production BikeRide mineral, grass, brush, road and deck handling');

if(process.argv.includes('--mutations')){
 assert.throws(()=>bootOrder(mainSource.replace('await terrain.readGroundCover()','terrain.readGroundCover()')));console.log('KILLED unawaited ground initialization');
 assert.throws(()=>bootOrder(mainSource.replace('if (ERA.modern) await terrain.readGroundCover()','await terrain.readGroundCover()')));console.log('KILLED ground classes in the 1884 era');
 const source=readFileSync('web/src/ground-cover.ts','utf8');
 const edits=[
  ['class domain','(cls!==6&&cls!==8)','false'],
  ['row boundary','Math.floor((start+length-1)/width)!==r','false'],
  ['overlap','start<end','false'],
  ['north/south flip','row=Math.floor(v*this.height)','row=Math.floor((1-v)*this.height)'],
  ['keep wooded wetland','cls===6||cls===8','cls===6||cls===8||cls===9'],
  ['mineral clearing','cls===6||cls===8','cls===8'],
  ['mineral grass','cls!==4&&cls!==6','cls!==4'],
 ];
 for(const [name,from,to] of edits){
  assert.ok(source.includes(from),name+' anchor');
  const r=await build({stdin:{contents:source.replace(from,to),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
  const api=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
  assert.throws(()=>cases(api),undefined,'SURVIVED '+name);console.log('KILLED ground CPU',name);
 }
 const treeSource=readFileSync('web/src/trees.ts','utf8');
 const anchor='if(this.terrain.groundClassAt(x,z)===6||this.terrain.groundClassAt(x,z)===8)continue;';
 for(const [name,to]of [['tree clearing omitted',''],['wooded wetland cleared',anchor.replace(')continue;','||this.terrain.groundClassAt(x,z)===9)continue;')]]){
  assert.ok(treeSource.includes(anchor));
  const r=await build({entryPoints:['web/src/trees.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'tree-mutant',setup(b){b.onLoad({filter:/\/trees\.ts$/},()=>({contents:treeSource.replace(anchor,to),loader:'ts',resolveDir:process.cwd()+'/web/src'}));}}]});
  const api=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
  assert.throws(()=>planting(api.Trees));console.log('KILLED production tree',name);
 }
 const vehicleSource=readFileSync('web/src/vehicle.ts','utf8'),from=': s.mineral ? SURFACES.gravel :';
 assert.ok(vehicleSource.includes(from));
 const r=await build({entryPoints:['web/src/vehicle.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'mineral-feel-mutant',setup(b){b.onLoad({filter:/\/vehicle\.ts$/},()=>({contents:vehicleSource.replace(from,': s.mineral ? SURFACES.grass :'),loader:'ts',resolveDir:process.cwd()+'/web/src'}));}}]});
 const api=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
 assert.throws(()=>driving(api.Vehicle));console.log('KILLED mineral gravel feel removed');
 const bikeSource=readFileSync('web/src/bike-ride.ts','utf8'),mineral='return s.mineral ? SURFACES.gravel :';
 assert.ok(bikeSource.includes(mineral),'bike mineral anchor');
 const bikeBundle=await build({entryPoints:['web/src/bike-ride.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'bike-mineral-mutant',setup(b){b.onLoad({filter:/\/bike-ride\.ts$/},()=>({contents:bikeSource.replace(mineral,'return'),loader:'ts',resolveDir:process.cwd()+'/web/src'}));}}]});
 const bikeApi=await import('data:text/javascript;base64,'+Buffer.from(bikeBundle.outputFiles[0].text).toString('base64'));
 assert.throws(()=>bikeDriving(bikeApi.BikeRide),{message:/confirmed mineral uses the bike gravel response/});
 console.log('KILLED bike mineral gravel feel removed');
}
