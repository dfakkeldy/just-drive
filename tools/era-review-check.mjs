// Review regressions. ERA_REVIEW_BASE compiles the named original implementation in memory.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Vehicle} from '../web/src/vehicle.ts';
import {Roads} from '../web/src/roads.ts';
import {Terrain} from '../web/src/terrain.ts';
import {HistoryScene} from '../web/src/eras/history-scene.ts';
import {historyLayout} from '../web/src/eras/history-layout.ts';
const root=process.env.MMM_ROOT??process.cwd(),ref=process.env.ERA_REVIEW_BASE;
const source=p=>ref?execFileSync('git',['show',`${ref}:${p}`],{cwd:root,encoding:'utf8'}):readFileSync(root+'/'+p,'utf8');
const which=process.env.ERA_REVIEW_CASE??'all',cases=[];
const test=(name,fn)=>cases.push([name,fn]);
const node=()=>new THREE.Group();
function rig(){return {root:node(),body:node(),driverEye:node(),brakeLights:[],steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};}
function canvas(){const c={width:0,height:0,getContext(){return new Proxy({measureText:t=>({width:t.length*100})},{get:(t,k)=>k in t?t[k]:(..._args)=>{},set:(t,k,v)=>(t[k]=v,true)});}};return c;}
globalThis.document={createElement:()=>canvas()};
function fixture(){
 const mode={drawn:false,calls:0},terrain={cartRoads:true,dataRevision:1,contactRevision:1,clear:[],low:false,manifest:{village:[624271,5103301]},coverAt:()=>2,
 meshHeightAt(x,z,drawn=false){mode.calls++;return drawn&&!mode.drawn?null:5+.04*x+.02*z+(mode.drawn?1.7+.04*x-.01*z:0);},
 meshContactAt(x,z,out){mode.calls++;out.height=5+.04*x+.02*z+(mode.drawn?1.7+.04*x-.01*z:0);out.source=mode.drawn?2:1;out.drawn=mode.drawn;return true;}};
 const roads=new Roads({roads:[]},terrain.manifest.village,terrain);
 const streams={streams:[{id:1,name:'',half:.8,pts:[[619730,5110955],[619780,5110955]]}],culverts:[]};
 // Keep the full population, but pin the forge's pose so changed data cannot align away the accessory-refit fault.
 const layout=historyLayout(terrain.manifest.village),forge=layout.trades.find(s=>s.kind==='forge');Object.assign(forge,{x:100,z:100,yaw:0});
 const scene=new HistoryScene(terrain,roads,streams,[],(x,z)=>5+.04*x+.02*z,layout);
 const model=scene.models.find(m=>m.site.kind==='forge'),camera=new THREE.Vector3(model.site.x,10,model.site.z+20);
 return {scene,model,camera,terrain,mode};
}
test('deck-reset',()=>{
 for(const hill of [1,1.5,2.5])for(const z of [-1,0,.5,29.5,30,31]){
 const terrain={cartRoads:true,heightAt:()=>-2,withContactHeight:(_b,f)=>f(),surfaceAt:()=>({ground:-2,canopy:0,roadDist:0,halfWidth:2.1,kind:3,bridge:true,washboard:false,brook:99,level:8})};
 const road={id:1,kind:1,bridge:true,halfWidth:2.1,pts:[[0,0],[0,30]]};
 const roads={roads:[road],nearest:()=>null,deckHeight:(x,z)=>Math.abs(x)<3.3&&z>=-3.3&&z<=33.3?hill*(.5+.1*Math.max(0,Math.min(30,z))):null};
 const v=new Vehicle(rig(),terrain,roads,-.2);v.restart(0,z,Math.PI);v.assist=0;
 v.update(1/120,{throttle:0,steer:0,handbrake:true});assert(Math.abs(v.vy)<.6,`unmodified restart hill ${hill} z ${z}: vy ${v.vy}`);
 }
});
test('offscreen-fit',()=>{
 const {scene,model,camera,terrain,mode}=fixture();scene.update(camera);mode.drawn=true;terrain.contactRevision++;scene.update(camera);
 const s=model.site,p=model.foundation.geometry.attributes.position;
 for(const x of [-s.width/2,s.width/2])for(const z of [-s.length/2,s.length/2]){
 let bottom=Infinity;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<.001&&Math.abs(p.getZ(i)-z)<.001)bottom=Math.min(bottom,p.getY(i)+model.node.position.y);
 const wx=s.x+x*Math.cos(s.yaw)+z*Math.sin(s.yaw),wz=s.z-x*Math.sin(s.yaw)+z*Math.cos(s.yaw),ground=terrain.meshHeightAt(wx,wz,true);
 assert(Math.abs(bottom-ground+.12)<.03,'offscreen-to-drawn footing gap '+(bottom-ground));
 }
 // A translated flat base alone cannot repair this: the arriving plane also changes its slope.
 const centreX=s.x+2.6*Math.cos(s.yaw)+(s.length/2+1)*Math.sin(s.yaw),centreZ=s.z-2.6*Math.sin(s.yaw)+(s.length/2+1)*Math.cos(s.yaw),expected=terrain.meshHeightAt(centreX,centreZ,true)+.95,art=model.art.geometry.attributes.position;
 let anvil=-Infinity;for(let i=0;i<art.count;i++)if(Math.abs(art.getX(i)-3.225)<.001&&Math.abs(art.getZ(i)-(s.length/2+1.2))<.001)anvil=Math.max(anvil,art.getY(i)+model.node.position.y);
 assert(Math.abs(anvil-expected)<.025,'arriving land refits the anvil accessory too');
});
test('steady-sites',()=>{
 const {scene,camera,terrain,mode}=fixture();mode.drawn=true;scene.update(camera);const calls=mode.calls;globalThis.__eraHotAllocations=0;
 for(let i=0;i<120;i++)scene.update(camera,1/60);
 assert.equal(mode.calls,calls,'settled camera must reuse contact samples');assert.equal(globalThis.__eraHotAllocations,0,'no hot array/object/arrow construction');
 const v={x:camera.x,z:camera.z,heading:0,vx:0,vz:0,speed:0};
 for(let i=0;i<120;i++)scene.resolve(v);
 assert.equal(globalThis.__eraHotAllocations,0,'collision steps reuse their arrays and objects too');assert(scene.audit.collisionCandidatesMax<=32,'bounded local collision set');assert(scene.audit.collisionTests<=120*32,'no all-world solid scan');console.log('COUNTERS sites',JSON.stringify({...scene.audit,hotAllocations:globalThis.__eraHotAllocations}));
});
test('steady-bridges',()=>{
 const terrain={cartRoads:true,dataRevision:1,contactRevision:1,seaLevel:-.2,meshHeightAt:()=>-2,heightAt:()=>-2,surfaceAt:(_x,z)=>({ground:.1*z,level:6})};
 const roads=new Roads({roads:[{id:1,name:null,kind:1,halfWidth:2.1,bridge:true,pts:[[0,0],[0,30]]},...Array.from({length:1000},(_,i)=>({id:i+2,name:null,kind:3,halfWidth:2,bridge:false,pts:[[1000+i*20,1000],[1010+i*20,1010]]}))]},[0,0],terrain);
 roads.update(new THREE.Vector3(0,10,10));roads.deckHeight(0,10);globalThis.__eraHotAllocations=0;
 for(let i=0;i<500;i++)roads.deckHeight(0,10);
 assert.equal(globalThis.__eraHotAllocations,0,'settled coarse bridge reads allocate nothing');assert(roads.audit.heightCandidatesMax<=8,'bounded bridge segment candidates');assert.equal(roads.audit.connectivityBuilds,1);console.log('COUNTERS bridges',JSON.stringify({...roads.audit,hotAllocations:globalThis.__eraHotAllocations}));
});
test('drawn-query',()=>{
 const t=Object.create(Terrain.prototype);t.manifest={size:65536,origin:[0,0],village:[0,0]};t.maxLevel=8;t.cartRoads=true;
 const g=new THREE.BufferGeometry(),p=new Float32Array(131*131*3);for(let i=0;i<p.length/3;i++)p[i*3+1]=3;g.setAttribute('position',new THREE.BufferAttribute(p,3));
 const mesh=new THREE.Mesh(g,new THREE.ShaderMaterial({uniforms:{hideQuad:{value:new THREE.Vector4()}}}));mesh.visible=true;
 const tile={level:8,size:256,x0:0,z0:0,ready:true,ground:new Float32Array(257*257),mesh};let visited=0;
 const map=new Map([['8/0_0',tile],...Array.from({length:1000},(_,i)=>['other-'+i,{...tile,x0:10000+i*256}])]);const values=map.values.bind(map);
 map.values=()=>{const it=values();return {[Symbol.iterator](){return this;},next(){visited++;return it.next();}};};t.tiles=map;
 for(let i=0;i<100;i++)assert.equal(t.meshHeightAt(10,10,true),3);
 assert.equal(visited,0,'drawn queries must use the level index, not scan the tile cache');
});
test('multiplayer-off',()=>{
 const s=source('web/src/main.ts');assert.match(s,/const MULTIPLAYER\s*=\s*[^;\n]*&&\s*ERA\.modern;\s*\nconst multiplayer\s*=\s*MULTIPLAYER\s*\?/,'construction is gated before mp code can create settings/title UI');
});
test('raw-shaders',async()=>{
 const now=source('web/src/shaders.ts'),main=execFileSync('git',['show','origin/main:web/src/shaders.ts'],{cwd:root,encoding:'utf8'});
 const {coastPrograms,program,preprocess,normalized,checkShaderBaseline}=await import(root+'/tools/coast-programs.mjs');
 checkShaderBaseline(now,{report:()=>{}});
 const original=text=>text.replace(/\/\* MODERN_ROAD_(?:CUT|PAINT)_BEGIN \*\/[\s\S]*?\/\* MODERN_ROAD_(?:CUT|PAINT)_END \*\//g,'').replaceAll(' * roadPaint','');
 for(const p of coastPrograms())if(!p.name.startsWith('CART_')&&!p.flags.includes('AIRPORT')&&!(p.name==='TERRAIN_FRAG'&&p.flags.includes('GROUND_CLASSES')))assert.equal(normalized(preprocess(original(program(now,p.name)),p.flags)),normalized(preprocess(original(program(main,p.name)),p.flags)),p.name+' unchanged outside quarry');assert(!now.includes('ERA_CART'),'no era identifiers in original programs');
});
test('map-look',()=>{
 const s=source('web/src/minimap.ts');assert.match(s,/cartRoads|cartMap/,'era map has a cart-road palette');
});
test('spy-order',()=>{const s=source('tools/era-initialization-check.mjs');assert(s.indexOf('Math.random=')<s.search(/\bimport[ (]/));});
test('wheel-observer',()=>{const s=source('tools/era-browser.mjs');assert(!/w\.rotation\.x\s*=/.test(s));});
test('surface-assertion',()=>{const s=source('tools/era-browser.mjs');assert(/surfaceKind|assertCartRoad/.test(s));});
test('wheel-progress',()=>{const {scene,camera,mode}=fixture();mode.drawn=true;const m=scene.models.find(m=>m.wheel);camera.set(m.site.x,10,m.site.z+20);scene.update(camera);const before=m.wheel.rotation.x;scene.update(camera,.5);assert(m.wheel.rotation.x-before>.01);});
test('test-blindspots',()=>{
 const init=source('tools/era-initialization-check.mjs');assert(init.indexOf('Math.random=')<init.search(/\bimport[ (]/),'spy starts before any import');
 const browser=source('tools/era-browser.mjs');assert(!/w\.rotation\.x\s*=/.test(browser),'wheel assertion does not set the angle');assert(/surfaceKind|\.kind,\s*3/.test(browser),'road check rejects grass too');assert(!/v\.y\s*=\s*v\.prevGround/.test(browser),'no reset workaround in browser');
});
for(const [name,fn]of cases)if(which==='all'||name===which){await fn();console.log('PASS review regression '+name);}
