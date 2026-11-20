import assert from 'node:assert/strict';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {readFileSync} from 'node:fs';
import {GroundCover,clearsGroundTrees,growsGroundGrass} from '../web/src/ground-cover.ts';
import {Terrain} from '../web/src/terrain.ts';
import {Grass} from '../web/src/grass.ts';
import {Trees} from '../web/src/trees.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {BikeRide} from '../web/src/bike-ride.ts';
import {QuarrySite} from '../web/src/quarry-site.ts';
import {quarryGypsumFill,QUARRY_GRAVEL_FILL} from '../web/src/coast-site.ts';
import {TERRAIN_FRAG} from '../web/src/shaders.ts';
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

function quarryPainting(TerrainClass,QuarryClass=QuarrySite){
 const terrain=Object.create(TerrainClass.prototype),site=new QuarryClass([631600,5063500]);
 const normal=new Uint8Array(257*257*4),uniforms={tNormal:{value:{image:{data:normal}}},hull:{value:1}};
 const mesh=new THREE.Mesh(undefined,new THREE.ShaderMaterial({uniforms})),side=131;
 const paint=new THREE.Float32BufferAttribute(new Float32Array(side*side*4),4);
 mesh.geometry.setAttribute('coast',paint);
 const tile={x0:0,z0:0,size:256,level:8,mesh,ground:new Float32Array(257*257).fill(45),canopy:new Float32Array(257*257),road:null};
 Object.assign(terrain,{coast:site,find:()=>tile,withDeck:(_x,_z,h)=>h,waterLevelAt:()=>null,groundClassAt:()=>0,seaLevel:-.2,exag:1,
  manifest:{roads:{encoding:{distance:.1,halfWidth:.05,signed:true,zero:128}}}});
 const opposite=27*side+27;
 paint.setX(opposite,.7);
 const read=(x=51.5,z=51.5)=>terrain.surfaceAt(x,z);
 assert.equal(read(50.25,50.25).mineral,undefined,'only the painted triangle contributes');
 assert.equal(read().mineral,true,'authored gypsum supplies off-road mineral');
 paint.setX(opposite,.4);assert.equal(read().mineral,undefined,'faded paint below the visible threshold keeps its old handling');
 paint.setX(opposite,0);paint.setW(opposite,.7);
 assert.equal(read().mineral,true,'gypsum shelf paint also supplies off-road mineral');
 for(let i=2;i<normal.length;i+=4)normal[i]=16;
 assert.equal(read().mineral,undefined,'rendered canopy fades the gypsum fill');
 uniforms.hull.value=0;assert.equal(read().mineral,true,'single trees use the ground shader without its canopy hull');
 tile.canopy.fill(1.5);assert.equal(read().mineral,true,'canopy below the brush threshold keeps gypsum handling');
 tile.canopy.fill(1.7);assert.equal(read().mineral,undefined,'canopy above the brush threshold keeps brush handling');
 tile.canopy.fill(5);assert.equal(read().mineral,undefined,'real tree canopy keeps its old handling');
 assert.equal(read().canopy,5,'paint alone leaves measured canopy alone');
 tile.canopy.fill(0);normal.fill(0);uniforms.hull.value=1;
 terrain.waterLevelAt=()=>46;assert.equal(read().mineral,undefined,'water takes priority');terrain.waterLevelAt=()=>null;
 terrain.withDeck=(_x,_z,h,s)=>{s.deck=true;return h;};assert.equal(read().mineral,undefined,'deck takes priority');terrain.withDeck=(_x,_z,h)=>h;
 tile.road=new Uint8ClampedArray(257*257*4);
 for(let i=0;i<tile.road.length;i+=4)tile.road.set([128,40,4,0],i);
 assert.equal(read().mineral,undefined,'mapped track takes priority');
 for(let i=0;i<tile.road.length;i+=4)tile.road.set([128,40,8,0],i);
 assert.equal(read().mineral,undefined,'authored pad and run-up field takes priority');
 for(let i=0;i<tile.road.length;i+=4)tile.road.set([255,40,8,0],i);
 assert.equal(read().mineral,true,'off-road kind-8 paint halo can be gypsum');
 tile.road=null;
 terrain.groundClassAt=()=>6;paint.setW(opposite,0);
 assert.equal(read().mineral,undefined,'source class cannot override invisible quarry paint');
 paint.setW(opposite,.7);terrain.groundClassAt=()=>0;
 terrain.cartRoads=true;assert.equal(read().mineral,undefined,'historical terrain keeps its own handling');terrain.cartRoads=false;
 const relocate=(east,north,h)=>{
  tile.x0=east-site.village[0]-51.5;tile.z0=site.village[1]-north-51.5;tile.ground.fill(h);
  return read(tile.x0+51.5,tile.z0+51.5);
 };
 tile.road=new Uint8ClampedArray(257*257*4);
 for(let i=0;i<tile.road.length;i+=4)tile.road.set([255,200,8,0],i);
 assert.equal(relocate(632236.5,5064409.5,76).mineral,true,'upper pad halo outside the drawn style supplies mineral');
 const style=new Uint8Array(257*257*4);uniforms.tSiteStyle={value:{image:{data:style}}};
 style[(52*257+52)*4+3]=1;
 assert.equal(relocate(632234.5,5064414.5,76).mineral,undefined,'off-road painted pad keeps its surface');
 style.fill(0);
 for(let i=0;i<tile.road.length;i+=4)tile.road.set([128,200,8,0],i);
 for(const [e,n,label] of [[632309,5064470,'drawn pad'],[632269,5064428,'run-up']]){
  const sample=relocate(e,n,74);
  assert.equal(sample.kind,8,label+' keeps its road kind');
  assert.equal(sample.mineral,undefined,label+' keeps its authored surface');
 }
 terrain.withDeck=(_x,_z,h,s)=>{s.deck=true;s.kind=9;return h+1;};
 const deck=relocate(632269,5064442,74);
 assert.equal(deck.ground,75,'the deck keeps its contact height');
 assert.equal(deck.kind,9,'the deck keeps its surface kind');
 assert.equal(deck.mineral,undefined,'the deck takes priority over gypsum');
 terrain.withDeck=(_x,_z,h)=>h;tile.road=null;
 assert.equal(relocate(631775,5064450,30).mineral,undefined,'talus takes priority over contact paint');
 assert.equal(relocate(631876,5064632,40).mineral,undefined,'mapped lake footprint takes priority over contact paint');
 assert.equal(relocate(631650,5061900,45).mineral,undefined,'approach outside the quarry paint box keeps its surface');
 terrain.groundClassAt=()=>6;
 assert.equal(relocate(631650,5061550,45).mineral,true,'published class 6 still works outside the authored quarry');
 terrain.groundClassAt=()=>0;relocate(631651.5,5063448.5,45);
 terrain.coast={contains:()=>true};assert.equal(read().mineral,undefined,'coastal paint is not quarry floor');
 mesh.geometry.dispose();mesh.material.dispose();
 assert.equal(site.quarryFloorAllowsMineral(175,-950,30),false,'existing talus toe');
}
quarryPainting(Terrain);console.log('PASS quarry paint triangles feed contact while preserving terrain and authored surfaces');
assert.match(TERRAIN_FRAG,/mineralFill=smoothstep\(\.05,\.60,max\(vCoast\.x,vCoast\.w\)\)\*\(1\.0-tree\)/);
assert.match(TERRAIN_FRAG,/float tree = smoothstep\(1\.8, 3\.5, canopy\) \* hull/);
assert.ok(TERRAIN_FRAG.includes(`ring *= 1.0 - step(${QUARRY_GRAVEL_FILL}, mineralFill);`),'grass root shading uses the visible gypsum cutoff');
assert.match(TERRAIN_FRAG,/if \(siteStyle\.a <= 0\.001\)\s*#endif\s*if \(canopy <= 1\.6\) ring/,'painted park keeps its grass root shade');
assert.equal(quarryGypsumFill(.6,1.8,1),1);
assert.equal(quarryGypsumFill(.6,3.5,1),0);
assert.equal(QUARRY_GRAVEL_FILL,.25);

function quarryGrass(GrassClass){
 const grass=Object.create(GrassClass.prototype);
 let mineral=false,checkRootPrecision=false;
 const surface={level:8,ground:30,canopy:0,brook:99,kind:0,roadDist:99,halfWidth:0};
 Object.assign(grass,{group:new THREE.Group(),geometry:new THREE.BufferGeometry(),clock:{value:0},material:new THREE.ShaderMaterial(),terrain:{
  clear:[],seaLevel:0,coverAt:()=>5,heightAt:()=>30,meshHeightAt:()=>30,
  surfaceAt:(x,z)=>({...surface,mineral:mineral||(checkRootPrecision&&x===Math.fround(x)&&z===Math.fround(z))}),
 }});
 grass.blades();
 const before=grass.patch(0,0);grass.populate(before,Infinity);
 assert(before.count>0,'legacy open cover grows actual grass tufts');
 mineral=true;
 const after=grass.patch(0,0);grass.populate(after,Infinity);
 assert.equal(after.count,0,'gypsum contact suppresses old-cover tufts');
 mineral=false;checkRootPrecision=true;
 grass.terrain.coast={quarry:true,contains:()=>true,weights:()=>[0,0,0,0]};
 const edge=grass.patch(-10720,48);grass.populate(edge,Infinity);
 assert.equal(edge.count,0,'paint is checked where the GPU stores the grass root');
 before.mesh.geometry.dispose();grass.geometry.dispose();grass.material.dispose();
}
quarryGrass(Grass);console.log('PASS production grass leaves painted mineral bare');

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
 for(const [name,filename,exportName,anchor,check,expected,replacement=''] of [
  ['quarry paint contact','terrain','Terrain','quarry ? this.quarryMineral(t,x,z,out,lerp) : ',quarryPainting,/authored gypsum supplies off-road mineral/],
  ['quarry actual canopy protection','terrain','Terrain',' || surface.canopy>1.6',quarryPainting,/canopy above the brush threshold keeps brush handling/],
  ['quarry authored protections','terrain','Terrain','return site.quarryFloorAllowsMineral(x,z,h);',quarryPainting,/talus takes priority over contact paint/,'return true;'],
  ['quarry pad rectangle restored','quarry-site','QuarrySite','&&!lakeAt(e,n)',Site=>quarryPainting(Terrain,Site),/upper pad halo outside the drawn style supplies mineral/,'&&!onCoursePad(e,n)&&!lakeAt(e,n)'],
  ['class 6 outside the quarry','terrain','Terrain','&&this.coast.contains(x,z)',quarryPainting,/published class 6 still works outside the authored quarry/],
  ['grass mineral exclusion','grass','Grass','surface.mineral || ',quarryGrass,/gypsum contact suppresses old-cover tufts/],
  ['quarry grass root precision','grass','Grass','if (quarry?.contains(x,z)) { x = Math.fround(x); z = Math.fround(z); }',quarryGrass,/paint is checked where the GPU stores the grass root/],
 ]){
  const source=readFileSync(`web/src/${filename}.ts`,'utf8');
  assert(source.includes(anchor),`${filename} mineral mutation anchor`);
  const bundle=await build({entryPoints:[`web/src/${filename}.ts`],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{
   name:'quarry-mineral-mutant',setup(b){b.onLoad({filter:new RegExp(`/${filename}\\.ts$`)},()=>({contents:source.replace(anchor,replacement),loader:'ts',resolveDir:process.cwd()+'/web/src'}));},
  }]});
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  assert.throws(()=>check(mutant[exportName]),{message:expected});
  console.log('KILLED '+name);
 }
}
