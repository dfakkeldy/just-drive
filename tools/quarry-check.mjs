import { readBaseline } from './baseline-source.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {QuarrySite,QUARRY_BOX,GATE,APRON,COURSE_PADS,LOOKOFFS,onCoursePad,lakeAt,PARK_NOTICE} from '../web/src/quarry-site.ts';
import {Coast} from '../web/src/coast.ts';
import {Quarry,PARK_BOARDS} from '../web/src/quarry.ts';
import {Trees} from '../web/src/trees.ts';
import {BikeRide} from '../web/src/bike-ride.ts';
import {QuarryWater} from '../web/src/quarry-water.ts';
import {WaterReflections} from '../web/src/water.ts';
import {Terrain} from '../web/src/terrain.ts';
import {AREAS,readArea} from '../web/src/area.ts';
import {readMode} from '../web/src/mode.ts';
import {readVehicle} from '../web/src/garage.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {TRUCK_SPEC} from '../web/src/truck.ts';
import {pushOut} from '../web/src/parked.ts';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {tripParams,bootTripParams,startTrip,tripStorageKey,tripId} from '../web/src/quarry-trip.ts';
import {quarryRoute,routeProgress,poseAlong} from '../web/src/quarry-route.ts';
import {routeHeights} from '../web/src/quarry-route-ground.ts';
import {png} from './quarry-height-read.mjs';
import {quarryLoop} from './quarry-loop.mjs';
import {westBayPlaces} from '../web/src/places.ts';
const root=process.env.QUARRY_ROOT,manifest=JSON.parse(readFileSync(`${root}/data/baked/areas/westbay/manifest.json`)),village=manifest.village;
const roads=JSON.parse(readFileSync(`${root}/data/baked/areas/westbay/roads.json`)).roads.map(r=>({...r,pts:r.pts.map(([e,n])=>[e-village[0],village[1]-n])}));
const heights=await routeHeights(roads,manifest,async path=>{const p=png(readFileSync(`${root}/data/baked/areas/westbay/${path}`));return {data:p.pixels,width:p.width};});
const site=new QuarrySite(village),world=(e,n)=>({x:e-village[0],z:village[1]-n});
const rejected=(label,fn)=>{assert.throws(fn,undefined,'mutation must fail: '+label);console.log('REJECTED',label);};
// One record, 1 m inside a loaded fine tile: the neighbouring tile may still be coarse.
function treeArrival(late,quarry=true){
 const x=631748-village[0],z=village[1]-5064500,x0=x-1,z0=z-107,exag=1.5,sea=-.2;
 const mineral=quarry?site:Object.assign(Object.create(site),{quarry:false});
 const height=(a)=>sea+((late&&a<x0?37:37+(a-x)*.9)-sea)*exag;
 const t={low:true,clear:[],coast:mineral,exag,seaLevel:sea,manifest:{origin:[x0+village[0],village[1]-z0],village},groundClassAt:()=>0,surfaceAt:()=>({level:8}),heightAt:height,meshHeightAt:height};
 const trees=new Trees([], '',t,false),data=new DataView(new ArrayBuffer(8));data.setUint16(0,256,true);data.setUint16(2,107*256,true);data.setUint8(4,25);data.setUint8(5,10);data.setUint8(6,4);data.setUint8(7,1);trees.plant('0_0',data);
 return trees.coastAudit.get('0_0').rejected;
}
assert.deepEqual([treeArrival(true),treeArrival(false)],[1,1],'quarry tree filtering must not depend on neighbour arrival order');
assert.deepEqual([treeArrival(true,false),treeArrival(false,false)],[0,1],'legacy coast sampling retains its original arithmetic');
console.log('PASS quarry fine-tile edge filtering is deterministic; legacy coast sampling is unchanged');
// The fractured template has more bottom vertices than the old coast shape. Fit all of them.
let depression={x:1e9,z:1e9};const rockGround=(x,z)=>40-.6*Math.exp(-((x-depression.x)**2+(z-depression.z)**2)/.02),rockTerrain={exag:1,low:false,drawnRevision:1,uniforms:{},meshHeightAt:rockGround,fitCoastRecesses(){}};
const rockSite={quarry:true,box:[-100,-100,100,100],village:[0,0]},rockCandidates=[0,10,20,30,40].map(x=>({x,z:0,size:1.5,height:2.4,turn:.7,y:0,burial:0}));
const broken=new Coast(rockSite,rockTerrain,false,{candidates:rockCandidates,capacity:5,minHeight:0,maxHeight:100,bedding:.85});
const corner=broken.feet.find(p=>Math.abs(p[0])>.1);depression={x:40+1.5*(corner[0]*Math.cos(.7)+corner[1]*Math.sin(.7)),z:1.5*(-corner[0]*Math.sin(.7)+corner[1]*Math.cos(.7))};
const rockFeet=()=>{broken.update(new THREE.Vector3());assert.equal(broken.blocks.length,5);const p=broken.mesh.geometry.attributes.position,m=new THREE.Matrix4(),v=new THREE.Vector3();let high=-Infinity;for(let b=0;b<broken.mesh.count;b++){broken.mesh.getMatrixAt(b,m);for(let i=0;i<p.count;i++)if(p.getY(i)===0){v.fromBufferAttribute(p,i).applyMatrix4(m);high=Math.max(high,v.y-rockGround(v.x,v.z));}}assert.ok(high<.035,'all fractured bottom vertices sit in the independent uneven land: '+high);};
rockFeet();const allFeet=broken.feet;broken.feet=allFeet.filter(p=>Math.abs(p[0])<.01);broken.stamp=-1;rejected('fit fractured blocks with only the old two base points',rockFeet);broken.feet=allFeet;broken.stamp=-1;rockFeet();
const far={site,fixtures:{visible:true},rocks:{update(){}},water:{update(){}},boundWater:null,terrain:{get group(){throw Error('far-away fixture allocation');}}};
Quarry.prototype.update.call(far,new THREE.Vector3());assert.equal(far.fixtures.visible,false,'far-away quarry does not allocate/rebuild fixtures');
const mirror=Object.assign(Object.create(WaterReflections.prototype),{level:40.78,uniforms:{reflectionOn:{value:1}}});
const pools=Object.assign(Object.create(QuarryWater.prototype),{meshes:[40.78,23.38].map(y=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.ShaderMaterial({uniforms:{}}));mesh.position.y=y;return mesh;})});pools.bind(mirror);
const reflected=()=>pools.meshes.map(m=>m.material.uniforms.reflectionOn.value);
assert.deepEqual(reflected(),[0,0]);mirror.level=23.38;assert.deepEqual(reflected(),[0,0]);
pools.meshes[0].material.uniforms.reflectionOn.value=1;
rejected('pit lake reuses a wall mirror',()=>assert.deepEqual(reflected(),[0,0]));pools.bind(mirror);assert.deepEqual(reflected(),[0,0]);
// Real merged beam vertices must reach the posts on sloping ground, not shift with a rotated height offset.
const railProbe=Object.assign(Object.create(Quarry.prototype),{site,terrain:{meshHeightAt:(_x,z)=>20+z*.5},feet:[],portalBeamVertices:[],fixtures:new THREE.Group(),boards:[],signCells:[],plain:new THREE.MeshLambertMaterial(),signMaterial:new THREE.MeshLambertMaterial()});railProbe.build();
const railVertices=railProbe.fixtures.children[0].geometry.attributes.position;
for(const p of LOOKOFFS)for(let d=-8;d<=8;d+=2){const x=p.e+8-village[0],z=village[1]-p.n-d,y=20+z*.5+.65;let closest=Infinity;for(let i=0;i<railVertices.count;i++)closest=Math.min(closest,Math.hypot(railVertices.getX(i)-x,railVertices.getY(i)-y,railVertices.getZ(i)-z));assert.ok(closest<.12,'lower safety rail joins its post on a slope: '+closest);}
const outside=()=>{for(const[e,n]of[[630100,5064000],[633300,5064000],[631900,5061500],[631900,5066600]]){const p=world(e,n);assert.equal(site.surface(p.x,p.z),null);assert.equal(site.waterLevel(p.x,p.z),null);assert.deepEqual(site.weights(p.x,p.z,30,2),[0,0,0,0]);assert.equal(site.height(p.x,p.z,61.23),61.23);assert.equal(site.treeAllowed(p.x,p.z,30,2),true);}};
const face=world(631748,5064500);assert.ok(site.weights(face.x,face.z,37,1.1)[0]>.99,'steep quarry face is gypsum');assert.ok(site.weights(face.x,face.z,55,.1)[0]<.1,'gentle reclaimed slope stays grassy');
outside();const sw=site.weights.bind(site);site.weights=()=>[1,0,0,0];rejected('paint outside site box',outside);site.weights=sw;
for(let e=630200;e<=633200;e+=200)for(let n=5061600;n<=5066500;n+=200){const p=world(e,n);for(const h of[15.4,27,55,78])assert.equal(site.height(p.x,p.z,h),h,'no LiDAR resculpt');}
const feature=()=>assert.deepEqual(AREAS.filter(a=>a.quarry).map(a=>a.id),['westbay']);feature();const other=AREAS.find(a=>a.id==='mabou');rejected('quarry in another area',()=>assert.deepEqual([...AREAS.filter(a=>a.quarry).map(a=>a.id),other.id],['westbay']));
for(const[e,n,level]of[[631900,5064500,27],[630700,5063000,15.4]]){const p=world(e,n);assert.equal(site.waterLevel(p.x,p.z),level);assert.equal(site.treeAllowed(p.x,p.z,level,0),false);rejected('wrong lake level '+level,()=>assert.equal(site.waterLevel(p.x,p.z)+1,level));}
for(const p of COURSE_PADS){assert.ok(onCoursePad(p.e,p.n));assert.equal(site.surface(...Object.values(world(p.e,p.n))).kind,8);}
const padPaint=()=>{const p=world(COURSE_PADS[0].e,COURSE_PADS[0].n);assert.equal(site.surface(p.x,p.z,64),null,'packed gravel follows surveyed top elevation');const edge=site.surface(p.x+COURSE_PADS[0].halfE,p.z,72);assert.ok(edge.coverage>0&&edge.coverage<1,'packed gravel edge fades');assert.equal(site.surface(p.x+COURSE_PADS[0].halfE,p.z+COURSE_PADS[0].halfN,72),null,'course pad has no rectangular corner');};
padPaint();const savedSurface=site.surface;site.surface=()=>({dist:6.5,half:10,kind:8,coverage:1});rejected('paste a hard gravel rectangle regardless of land height',padPaint);site.surface=savedSurface;
const dummy={world,solid(e,n,length,width,heading=0){return{...world(e,n),half:length/2,halfWidth:width/2,heading}},boards:PARK_BOARDS};
const solids=Quarry.prototype.fixtureSolids.call(dummy);
assert.ok(solids.length>40);
for(const solid of solids){assert.ok(!onCoursePad(solid.x+village[0],village[1]-solid.z,2),'solid outside course pads');}
const collision=(spec,list=solids)=>{const s=solids[0],car={x:s.x,z:s.z,heading:0,vx:2,vz:0,speed:2,spec};const old={x:car.x,z:car.z};pushOut(car,list);assert.ok(Math.hypot(car.x-old.x,car.z-old.z)>.1,'solid stops vehicle half-length '+spec.halfLength);};
for(const [name,spec] of[['car',CAR_SPEC],['truck',TRUCK_SPEC]]){collision(spec);rejected('remove solids '+name,()=>collision(spec,[]));}
for(const s of solids){const pose={x:s.x,z:s.z,heading:0};assert.equal(Quarry.prototype.allowPlacement.call({terrain:{waterAt:()=>false,heightAt:()=>0},roads:{deckHeight:()=>null},solids},pose,TRUCK_SPEC),false,'placement rejects fixture');}
console.log('PASS all static fixtures reject full truck placements; both vehicle collision envelopes stop');
// Exercise actual Terrain.surfaceAt with a loaded constant tile, then actual Vehicle recovery, at four hill heights.
for(const hill of[1,1.5,2,2.5])for(const[e,n,level]of[[631900,5064500,27],[630700,5063000,15.4]]){
 const p=world(e,n),ground=-.2+(level+.2)*hill;
 const tile={x0:p.x-128,z0:p.z-128,size:256,ground:new Float32Array(257*257).fill(ground),canopy:new Float32Array(257*257),level:8};
 const terrain={sites:[site],exag:hill,seaLevel:-.2,find:()=>tile,withDeck:(_x,_z,g)=>g,groundContact:null,groundClassAt:()=>0,withContactHeight:(_body,read)=>read(),waterAt:Terrain.prototype.waterAt,waterLevelAt:Terrain.prototype.waterLevelAt,heightAt:()=>ground,surfaceAt:Terrain.prototype.surfaceAt};
 const surface=terrain.surfaceAt(p.x,p.z);assert.equal(surface.water,true,'Terrain carries inland water flag');assert.equal(terrain.waterAt(p.x,p.z,ground+5*hill),false,'dry island or deck is above the pool');assert.equal(site.treeAllowed(p.x,p.z,level+5,0),true,'retain a dry island tree');
 const makeRig=()=>{const node=()=>new THREE.Object3D();return{root:node(),body:node(),steer:{fl:node(),fr:node()},wheels:{fl:node(),fr:node(),rl:node(),rr:node()}};};
 const run=wet=>{const t={...terrain,surfaceAt:(x,z)=>({...terrain.surfaceAt(x,z),water:wet})},r={nearest:()=>null,deckHeight:()=>null},v=new Vehicle(makeRig(),t,r,-.2);let recovered=0;v.respawn=()=>{recovered++;v.sunk=0;};v.place(p.x,p.z,0);for(let i=0;i<200;i++)v.update(1/120,{throttle:0,steer:0,handbrake:true});return recovered;};
 const aerial=new Vehicle(makeRig(),terrain,{nearest:()=>null,deckHeight:()=>null},-.2);aerial.place(p.x,p.z,0);aerial.y=ground+20;for(let i=0;i<60;i++)aerial.update(1/120,{throttle:0,steer:0,handbrake:false});assert.equal(aerial.sunk,0,'airborne above inland pool stays dry');
 const bikeRun=wet=>{const t={...terrain,surfaceAt:(x,z)=>({...terrain.surfaceAt(x,z),water:wet})},v=new BikeRide({root:new THREE.Group(),pose(){},driverEye:new THREE.Object3D()},t,{nearest:()=>null,deckHeight:()=>null},-.2);let recovered=0;v.respawn=()=>{recovered++;v.sunk=0;};v.place(p.x,p.z,0);for(let i=0;i<200;i++)v.update(1/120,{throttle:0,steer:0,handbrake:false});return recovered;};assert.ok(bikeRun(true)>0,'bike inland recovery '+level);rejected('disable bike inland recovery '+level+' at '+hill,()=>assert.ok(bikeRun(false)>0));
 assert.ok(run(true)>0,'inland recovery '+level+' at '+hill);rejected('disable inland recovery '+level+' at '+hill,()=>assert.ok(run(false)>0));
}
console.log('PASS true lake levels and recovery through Terrain surface metadata at all four hill heights');
const loop=quarryLoop(roads);assert.ok(loop.length>1300&&loop.length<1320);assert.ok(Math.hypot(loop.points[0].x-loop.points.at(-1).x,loop.points[0].z-loop.points.at(-1).z)<.001);assert.equal(loop.gaps.length,0);rejected('remove bench-loop road',()=>quarryLoop(roads.filter(r=>r.id!==263)));
const route=quarryRoute(roads,village,heights),routeOK=r=>{assert.ok(Math.abs(r.length-19593.26479507788)<.1);assert.deepEqual(r.turns.map(t=>t.name),['Marble Mountain Road','Cenotaph Road','Long Stretch Road','park access road']);assert.equal(r.gaps.length,2);assert.ok(r.gaps.every(g=>g.metres<=.35));assert.ok(Math.abs(routeProgress(r,r.destination.x,r.destination.z)-r.length)<.001);};routeOK(route);
rejected('missing route',()=>quarryRoute(roads.filter(r=>r.name!=='Cenotaph Road'),village,heights));rejected('wrong route length',()=>routeOK({...route,length:1}));rejected('turn list lost',()=>routeOK({...route,turns:[]}));
const near=routeProgress(route,route.near.x,route.near.z),gate=world(GATE.e,GATE.n);assert.ok(Math.abs(routeProgress(route,gate.x,gate.z)-near-600)<2,'short preset is 600 m before gate');
assert.ok(Math.hypot(route.destination.x-(APRON.e-village[0]),route.destination.z-(village[1]-APRON.n))<15);
assert.ok(Math.hypot(route.start.x-(643820.71-village[0]),route.start.z-(village[1]-5067940.04))<65,'start at mapped lane north end');
for(const id of['quarry','quarry-gate']){
 const q=tripParams(new URLSearchParams('trip='+id+'&at=0,0&road=other'));
 const parse=()=>{assert.equal(readArea(q).id,'westbay');assert.equal(readMode(q,()=>({getItem:()=>null})),'explore');assert.equal(readVehicle(q,true,()=>({getItem:()=>null})).id,'truck');assert.equal(q.get('trailer'),'1');assert.ok(!q.has('at')&&!q.has('road'));};parse();q.set('vehicle','car');rejected('wrong rig preset '+id,parse);
}
for(const query of['','area=judique&mode=explore&vehicle=sxs','mode=mail&demo=8','trip=unknown&area=porthood']){const q=new URLSearchParams(query);assert.strictEqual(tripParams(q),q);assert.equal(tripParams(q).toString(),q.toString());assert.equal(tripId(q),null);}
const savedLocation=globalThis.location,savedHistory=globalThis.history,savedSession=globalThis.sessionStorage;
for(const [search,hostname,pathname,expected]of[['?trip=quarry','localhost','/','/'],['?trip=quarry-gate','justdrive.game.test','/mabou','/westbay'],['?mode=explore','localhost','/',null]]){
 let changed=null;globalThis.location={search,hostname,pathname,hash:''};globalThis.history={state:null,replaceState:(_state,_unused,url)=>changed=url};const q=bootTripParams();if(expected){assert.ok(changed.startsWith(expected+'?'));assert.equal(q.get('area'),'westbay');assert.equal(q.get('vehicle'),'truck');}else assert.equal(changed,null);
}
for(const id of['quarry','quarry-gate']){let removed=null;globalThis.location={search:'?site=just',hostname:'localhost',pathname:'/westbay',hash:'',href:''};globalThis.sessionStorage={removeItem:key=>removed=key};startTrip(id);assert.equal(removed,tripStorageKey(id),'explicit menu choice clears only its own journey');assert.ok(globalThis.location.href.startsWith('/westbay?'));assert.equal(new URLSearchParams(globalThis.location.href.split('?')[1]).get('site'),'just','local brand preview survives preset choice');}
globalThis.location=savedLocation;globalThis.history=savedHistory;globalThis.sessionStorage=savedSession;
const places=westBayPlaces();const farPlace=places.find(p=>p.id==='marble-shore');assert.ok(manifest.mid[2]-farPlace.e>80,'far-end place leaves room for a rig inside the map');assert.equal(places.length,8);assert.ok(places.some(p=>p.trip==='quarry'));assert.ok(places.some(p=>p.trip==='quarry-gate'));assert.ok(PARK_NOTICE.includes('made up')&&PARK_NOTICE.includes('private land'));
// Both existing COAST_SHORE programs are exactly unchanged, in addition to the checked-in non-coast pin.
const {program,preprocess,normalized,coastPrograms,withoutFarBend,reviewedMirrorCrown}=await import(`${root}/tools/coast-programs.mjs`),old=reviewedMirrorCrown(readBaseline('quarry-shader','web/src/shaders.ts',root)),current=reviewedMirrorCrown(readFileSync(`${root}/web/src/shaders.ts`,'utf8'));
// AIRPORT (Point Tupper airfield tiles) and GROUND_CLASSES variants are new; tools/baseline/programs.json pins them.
for(const {name,flags:baseFlags} of coastPrograms().filter(p=>!p.name.startsWith('CART_')&&!p.flags.includes('AIRPORT')&&!(p.name==='TERRAIN_FRAG'&&p.flags.includes('GROUND_CLASSES'))))for(const flags of [baseFlags,['COAST_SHORE',...baseFlags]])assert.equal(normalized(preprocess(program(withoutFarBend(current),name),flags)),normalized(preprocess(program(withoutFarBend(old),name),flags)),name+' unchanged non-quarry/Mabou '+flags);
const guardedRock=normalized(preprocess(program(current,'COAST_SURFACE'),['COAST_SHORE','QUARRY']));
const mineralGuard='if(p.x<quarryBox.x||p.x>quarryBox.z||p.y<quarryBox.y||p.y>quarryBox.w||p.y+coastOrigin.y>47000.0)return;';
const boundedShader=source=>assert.ok(source.indexOf(mineralGuard)>=0&&source.indexOf(mineralGuard)<source.indexOf('vec4w=vCoast*coastOn;'),'exact box guard precedes interpolated mineral masks and noise');boundedShader(guardedRock);rejected('leak interpolated coarse mineral paint outside the box',()=>boundedShader(guardedRock.replace(mineralGuard,'')));
const phoneRock=normalized(preprocess(program(current,'COAST_SURFACE'),['COAST_SHORE','QUARRY','LOW']));assert.ok(!/sampler|texture|vnoise|fwidth|dFdx|dFdy/.test(phoneRock),'LOW quarry rock adds no textures, noise or derivatives');
console.log('PASS Mabou coast programs exactly match 400f4b4 in desktop, LOW, mirror and shadow variants');
console.log(JSON.stringify({routeMetres:route.length,turns:route.turns,joins:route.joins.length,gaps:route.gaps.map(g=>({metres:g.metres,e:g.a.x+village[0],n:village[1]-g.a.z})),start:route.start,near:route.near},null,2));
console.log('PASS quarry rules, graph, two presets, no-trip identity, water recovery, solids and mutation controls');
