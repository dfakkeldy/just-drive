import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {inside,boundaryDistance,gateLane,stoneLayout,fenceSegments,fenceSolids,cemeteryPlaces,distance,nearestPoint,inRegions} from '../web/src/cemetery-rules.ts';
import {Cemeteries,stoneGeometry} from '../web/src/cemeteries.ts';
import {MEASURED_SHAPES,MEASURED_STONES,TONES} from '../web/src/cemetery-graves.ts';
import {Props} from '../web/src/props.ts';
import {pushOut} from '../web/src/parked.ts';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const areas=['mabou','judique','porthood','pointtupper','westbay','cansocauseway'];
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d){
 const on=(a,b,p)=>Math.abs(cross(a,b,p))<1e-7&&p[0]>=Math.min(a[0],b[0])-1e-7&&p[0]<=Math.max(a[0],b[0])+1e-7&&p[1]>=Math.min(a[1],b[1])-1e-7&&p[1]<=Math.max(a[1],b[1])+1e-7;
 return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function segDistance(a,b,c,d){return intersects(a,b,c,d)?0:Math.min(distance(a,nearestPoint(a,c,d)),distance(b,nearestPoint(b,c,d)),distance(c,nearestPoint(c,a,b)),distance(d,nearestPoint(d,a,b)));}
function ringCheck(c,mid){
 const r=c.ring;assert.ok(r.length>=4);assert.deepEqual(r[0],r.at(-1),'closed ring');
 assert.equal(new Set(r.slice(0,-1).map(JSON.stringify)).size,r.length-1,'distinct ring points');
 for(const p of r){assert.ok(p.length===2&&p.every(Number.isFinite));assert.ok(p[0]>=mid[0]&&p[0]<=mid[2]&&p[1]>=mid[1]&&p[1]<=mid[3],'ring inside mid');assert.ok(p.every(n=>Math.abs(n*100-Math.round(n*100))<1e-6));}
 for(let i=0;i<r.length-1;i++)for(let j=i+2;j<r.length-1;j++){if(i===0&&j===r.length-2)continue;assert.ok(!intersects(r[i],r[i+1],r[j],r[j+1]),'simple ring');}
 assert.ok(Number.isFinite(c.gate.heading)&&boundaryDistance(c.gate.point,r)<1e-6,'gate on mapped ring');
}
const body=(p,h=0,radius=1)=>({x:p[0],z:-p[1],heading:h,vx:Math.sin(h),vz:-Math.cos(h),speed:1,spec:{envelope:{radius,circles:[0],reach:radius}}});
function pushed(p,solids,h=0,radius=1){const car=body(p,h,radius);pushOut(car,solids);return Math.hypot(car.x-p[0],car.z+p[1]);}
function* walk(a,b,step=.5){const n=Math.max(1,Math.ceil(distance(a,b)/step));for(let k=0;k<=n;k++)yield[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n];}
function nearSegments(c,roads){
 const xs=c.ring.map(p=>p[0]),ys=c.ring.map(p=>p[1]),box=[Math.min(...xs)-30,Math.min(...ys)-30,Math.max(...xs)+30,Math.max(...ys)+30];
 return roads.filter(r=>r.kind>=1&&r.kind<=5).flatMap(r=>r.pts.slice(1).flatMap((b,i)=>{const a=r.pts[i];return Math.max(a[0],b[0])>=box[0]&&Math.min(a[0],b[0])<=box[2]&&Math.max(a[1],b[1])>=box[1]&&Math.min(a[1],b[1])<=box[3]?[{a,b,half:r.halfWidth,id:r.id,kind:r.kind}]:[];}));
}
function wallCheck(c,near){
 const segments=fenceSegments(c),solids=fenceSolids(c,[0,0]);
 if(c.suppressed){assert.deepEqual(c.wall,[]);assert.deepEqual(stoneLayout(c),[]);}
 for(const line of c.wall){assert.ok(line.length>=2);assert.notDeepEqual(line[0],line.at(-1),'wall polylines are open');}
 for(const[a,b]of segments){
  for(const p of walk(a,b)){assert.ok(inside(p,c.ring)||boundaryDistance(p,c.ring)<=.2,'wall stays inside mapped ring');assert.ok(pushed(p,solids)>.1,'walking wall is pushed');}
  for(const r of near){const d=segDistance(a,b,r.a,r.b);assert.ok(d>=r.half+1.15-1e-5,'entire solid clears every road/track by halfWidth + 1');if(r.kind!==4)assert.ok(d>=r.half+1.5-.02,'baked wall clears public road or trail');}
 }
 // Prove complete coverage of the adjusted footprint, with only baked openings omitted.
 for(const region of c.interior)for(const line of [region.outer,...region.holes])for(let i=1;i<line.length;i++)for(const p of walk(line[i-1],line[i])){
  if(c.openings.some(o=>boundaryDistance(p,o.path)<.2))continue;
  assert.ok(pushed(p,solids)>.1,'adjusted boundary has no unbaked opening');
 }
 for(const o of c.openings){
  const clear=distance(o.path[0],o.path.at(-1))-.3;
  assert.ok(clear>=3.5-1e-6,'physical opening chord minus wall thickness is at least 3.5 m');
  assert.ok(Math.abs(o.width-clear)<.011,'reported opening width is physical clearance');
  assert.ok(o.lane?.length>=2,'baked through-opening lane');
  const track=o.track===undefined?null:near.find(r=>r.id===o.track&&r.kind===4);
  if(o.track!==undefined)assert.ok(track,'opening names a real track');
  const radius=track?Math.max(1,track.half+.5):1;
  for(let i=1;i<o.lane.length;i++)for(const p of walk(o.lane[i-1],o.lane[i],.15)){
   assert.ok(pushed(p,solids,o.heading)<1e-6,'2 m body passes completely through opening');
   assert.ok(pushed(p,solids,o.heading,radius)<1e-6,'track-width-plus-one body follows actual centreline');
   if(track)assert.ok(Math.min(...near.filter(r=>r.id===o.track).map(r=>distance(p,nearestPoint(p,r.a,r.b))))<.02,'track lane follows its own centreline');
  }
 }
 // Move a 2 m wide body along every nearby road and track segment, not just mapped vertices.
 for(const r of near)for(const p of walk(r.a,r.b))assert.ok(pushed(p,solids,Math.atan2(r.b[0]-r.a[0],r.b[1]-r.a[1]))<1e-6,'road/track centreline body is never pushed');
}
function stonesCheck(c,stones,cap,near=[]){
 assert.ok(stones.length<=cap);
 const walls=fenceSegments(c);
 for(const s of stones){
  assert.ok(inRegions(s.point,c.stoneArea),'stone centre in baked safe ground');assert.ok(!gateLane(s.point,c),'stone out of baked gate lane');
  for(const u of[-.36,.36])for(const v of[-.23,.23]){
   const p=[s.point[0]+u*Math.cos(s.turn)-v*Math.sin(s.turn),s.point[1]+u*Math.sin(s.turn)+v*Math.cos(s.turn)];
   assert.ok(inRegions(p,c.interior),'whole stone inside adjusted footprint');assert.ok(!gateLane(p,c),'whole stone outside gate lane');
   assert.ok(walls.every(([a,b])=>distance(p,nearestPoint(p,a,b))>=2),'whole stone 2 m inside wall');
   for(const r of near)assert.ok(distance(p,nearestPoint(p,r.a,r.b))>=r.half+1,'whole stone clears roads/tracks');
  }
 }
}
// A measured table shows real markers where they stand, so the decorative spacing rules do not apply.
// Each marker must stand inside the mapped ring, clear of the drawn wall and of roads, with a real size, shape and tone.
// Markers in the baked gate lane or within 2 m of the baked wall are reported, not failed.
function measuredCheck(c,stones,near,area){
 const rows=MEASURED_STONES[c.id],walls=fenceSegments(c);assert.equal(stones.length,rows.length,'every measured row is shown');
 if(c.id==='cemetery-e26f6ceae9b8'){
  assert.equal(stones.length,67,'church cemetery keeps all 67 surveyed blank markers');
  assert.equal(stones.filter(s=>s.kind===8).length,4,'church cemetery has four cast-iron crosses');
  assert.equal(stones.filter(s=>s.kind===6).length,3,'church cemetery has three stone Celtic cross monuments');
 }
 let lane=0,close=0;
 stones.forEach((s,i)=>{
  // The drawn face looks toward the table's bearing (or its back does): rotate the shape's -z the way the renderer does.
  const o=new THREE.Object3D();o.rotation.y=s.turn;o.updateMatrix();const d=new THREE.Vector3(0,0,-1).applyMatrix4(new THREE.Matrix4().extractRotation(o.matrix));
  const bearing=(Math.atan2(d.x,-d.z)*180/Math.PI+360)%360,off=Math.abs(((bearing-rows[i][7])%180+270)%180-90);
  assert.ok(off<1e-6,`measured marker ${i} faces ${bearing.toFixed(1)}, not ${rows[i][7]}`);
 });
 for(const s of stones){
  assert.ok(inside(s.point,c.ring),'measured marker inside the mapped ring');
  assert.ok(s.size.every(n=>n>0.1&&n<3),'measured size in metres');assert.ok(MEASURED_SHAPES.includes(s.kind),'measured shape');assert.ok(TONES[s.tone],'measured tone');
  const co=Math.cos(s.turn),si=Math.sin(s.turn),corners=[-.5,.5].flatMap(u=>[-.5,.5].map(v=>[s.point[0]+u*s.size[0]*co-v*s.size[2]*si,s.point[1]+u*s.size[0]*si+v*s.size[2]*co]));
  for(const p of corners){
   assert.ok(inRegions(p,c.interior),'whole measured marker inside the mapped ground');
   assert.ok(walls.every(([a,b])=>distance(p,nearestPoint(p,a,b))>=.15+1e-6),'whole measured marker clear of the drawn wall');
   for(const r of near)assert.ok(distance(p,nearestPoint(p,r.a,r.b))>=r.half+1,'whole measured marker clears roads/tracks');
  }
  if(gateLane(s.point,c))lane++;else if(walls.some(([a,b])=>distance(s.point,nearestPoint(s.point,a,b))<2))close++;
 }
 console.log(`MEASURED ${area}/${c.id}: ${stones.length} markers; ${lane} in the baked gate lane, ${close} more within 2 m of the baked wall (reported, not failed)`);
}
function mailboxCheck(cs,props,area){for(const p of[...props.mailboxes,...props.communityBoxes])for(const c of cs)assert.ok(!inside([p.x,p.y],c.ring),`${area}: baked mailbox (${p.x},${p.y}) inside ${c.id}; report, do not move`);}
function stoneSourceCheck(source){assert.ok(!/CanvasTexture|fillText/.test(source),'no text or canvas');const builder=source.slice(source.indexOf('export function stoneGeometry'),source.indexOf('interface Fitted'));assert.ok(!/(['"`])[^'"`]*\d[^'"`]*\1/.test(builder),'no digit strings in stone builder');}
let count=0,stoneCount=0,roadSamples=0;const suppressed=[];
for(const area of (process.env.MMM_CEMETERY_FIXTURES_ONLY==='1'?[]:areas)){
 const dir=area==='mabou'?'data/baked/terrain':`data/baked/areas/${area}`,m=read(dir+'/manifest.json'),data=read(dir+'/cemeteries.json'),roads=read(dir+'/roads.json').roads;
 assert.equal(data.crs,'EPSG:2961');assert.equal(data.area,area);assert.equal(data.roadsSha256,createHash('sha256').update(readFileSync(dir+'/roads.json')).digest('hex'),'re-bake cemeteries after roads.json changes');
 assert.deepEqual(m.cemeteries,{file:'cemeteries.json',count:data.cemeteries.length}); // The isolated direct-bake fixture proves the write boundary; later bakes own other manifest keys.
 const ids=new Set();
 for(const c of data.cemeteries){
  assert.ok(!ids.has(c.id));ids.add(c.id);ringCheck(c,m.mid);
  const signed=c.ring.slice(1).reduce((s,b,i)=>s+c.ring[i][0]*b[1]-b[0]*c.ring[i][1],0);assert.ok(signed>0&&Math.abs(signed/2-c.area)<.02,'consistent winding and area');
  if(c.gate.track!==undefined){const t=roads.find(r=>r.id===c.gate.track);assert.ok(t&&t.kind===4&&boundaryDistance(c.gate.point,t.pts)<1e-5,'main gate uses real track crossing');}
  const near=nearSegments(c,roads);wallCheck(c,near);
  const high=stoneLayout(c),low=stoneLayout(c,true);if(MEASURED_STONES[c.id]){measuredCheck(c,high,near,area);assert.deepEqual(low,high,'measured markers are the same in both detail levels');}else{stonesCheck(c,high,220,near);stonesCheck(c,low,55,near);}assert.deepEqual(high,stoneLayout(c));assert.deepEqual(low,stoneLayout(c,true));
  if(c.suppressed){assert.ok(c.groundArea<150||c.interior.length===0);suppressed.push(`${area}/${c.id}`);}
  if(c.road){const r=roads.find(r=>r.id===c.road.id);assert.ok(r&&r.kind>=1&&r.kind<=3&&r.name===c.road.name);assert.ok(boundaryDistance(c.road.point,r.pts)<.02);assert.ok(Math.abs(boundaryDistance(c.road.point,c.ring)-c.road.distance)<.02);}
  count++;stoneCount+=high.length;roadSamples+=near.reduce((n,r)=>n+Math.ceil(distance(r.a,r.b)/.5)+1,0);
 }
 mailboxCheck(data.cemeteries,read(dir+'/props.json'),area);
 const places=cemeteryPlaces(data.cemeteries,area);for(const p of places){const c=data.cemeteries.find(c=>c.id===p.id);assert.ok(p.name.startsWith(`Cemetery, ${c.road.name}`));const suffix=p.name.slice(`Cemetery, ${c.road.name}`.length);assert.ok(!suffix||/^ \((north|northeast|east|southeast|south|southwest|west|northwest)\)$/.test(suffix));assert.equal(p.kind,'site');assert.equal(p.note,`A cemetery near ${c.road.name}.`);assert.deepEqual(p.sources,[`terrain/cemeteries.json#${c.id}`]);}assert.equal(new Set(places.map(p=>p.name)).size,places.length);
 console.log(`PASS cemeteries ${area}: ${data.cemeteries.length} mapped polygons; road-aware walls, safe stones, no baked mailbox inside`);
}
const source=readFileSync('web/src/cemeteries.ts','utf8');stoneSourceCheck(source);const main=readFileSync('web/src/main.ts','utf8');assert.match(main,/const cemeteries = ERA\.modern \? await Cemeteries\.load/);assert.match(main,/\['cemeteries', cemeteries && \{ resolve: body => cemeteries\.resolveSolids\(body\) \}\]/);assert.match(main,/for \(const \[, row\] of \[\.\.\.siteContacts\.filter\(\(\[name\]\) => name !== 'tall'\)/);assert.match(main,/cemeteries\?\.update\(camera.position, vehicle\)/);assert.ok(/\.Grass\(terrain, params.get\('grass'\), cemeteries\?\.excludes\)/.test(main)||(/\.Grass\(terrain, params.get\('grass'\), grassExcludes\)/.test(main)&&/const grassExcludes = stockpiles \? [^\n]*\|\| !!cemeteries\?\.excludes\(east, north\) : cemeteries\?\.excludes;/.test(main)),'the grass leaves the graveyards out (alone, or together with the Point Tupper stockpiles)');assert.match(main,/terrain, cemeteries\?\.excludes(?:, sidewalks && !sidewalks\.audit\.disabled \? sidewalkData\?\.plans\[LOW\?1:0\]\.poleMoves : undefined(?:, splitRoadLines\(roadData\))?)?\)/);
// The solo branch must still resolve the car against the rows above (the old pin matched only that call).
assert.match(main,/if \(fleet \|\| quarry\) fleetContacts\.resolve\(vehicle\);\n\s*else soloContacts\.resolve\(vehicle\);/,'solo driving resolves the car against the site rows');
const ring=[[0,0],[40,0],[40,40],[0,40],[0,0]];
const square={id:'fixture',ring,wall:[[[21.91,0],[40,0],[40,40],[0,40],[0,0],[18.09,0]]],interior:[{outer:ring,holes:[]}],stoneArea:[{outer:[[3,3],[37,3],[37,37],[3,37],[3,3]],holes:[]}],groundArea:1600,area:1600,road:null,gate:{point:[20,0],heading:Math.PI},openings:[{point:[20,0],heading:Math.PI,width:3.52,boundaryLength:3.82,laneHalfWidth:2.6,kind:'gate',path:[[18.09,0],[21.91,0]],lane:[[20,-1.3],[20,1.3]],bodyRadius:1}]};
ringCheck(square,[-1,-1,41,41]);wallCheck(square,[]);stonesCheck(square,stoneLayout(square),220);
let ground=10,level=5;const terrain={surfaceAt:()=>({ground,level}),meshHeightAt:()=>ground+.25,manifest:{origin:[-100,100],size:65536,levels:{8:['0_0'],6:['0_0']}}};
const scenery=new Cemeteries([square],[0,0],terrain,false,'mabou');scenery.update({x:20,z:-20});const mesh=scenery.group.children[0].children[0];assert.ok(mesh.isInstancedMesh);assert.ok(mesh.instanceMatrix.array.every(n=>n===0||n===1));level=6;scenery.next=0;scenery.update({x:20,z:-20});assert.ok(Math.abs(mesh.instanceMatrix.array[13]-10.7)<1e-5);ground=15;level=8;scenery.next=0;scenery.update({x:20,z:-20});assert.ok(mesh.instanceMatrix.array.some(n=>n>15));
const coarse=new Cemeteries([square],[0,0],{...terrain,manifest:{...terrain.manifest,levels:{6:['0_0']}}},true,'mabou');level=6;coarse.update({x:20,z:-20});assert.ok(coarse.group.children[0].children[0].instanceMatrix.array.some(n=>n>15));assert.equal(coarse.group.children[0].children.length,3);
const props=new Props({crs:'EPSG:2961',mailboxes:[],communityBoxes:[],poles:[{x:20,y:20,heading:0,road:1,n:0,transformer:false,light:false}]},[0,0],terrain,scenery.excludes);assert.equal(props.poles.length,0);
assert.ok(stoneGeometry(1,true).attributes.position.count<stoneGeometry(1,false).attributes.position.count);
for(const k of MEASURED_SHAPES){const hi=stoneGeometry(k,false),lo=stoneGeometry(k,true);assert.ok(lo.attributes.position.count<=hi.attributes.position.count,'low stone is no heavier');hi.computeBoundingBox();const b=hi.boundingBox;assert.ok(Math.abs(b.min.y)<1e-6&&Math.abs(b.max.y-1)<1e-6&&Math.abs(b.max.x-.5)<1e-6&&Math.abs(b.max.z-.5)<1e-6,'measured shape is a unit shape');}
{
 const cross=new THREE.Mesh(stoneGeometry(6,false),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
 const ray=new THREE.Raycaster();
 for(const sx of [-1,1])for(const sy of [-1,1]){
  ray.set(new THREE.Vector3(sx*.17,.812+sy*.067,1),new THREE.Vector3(0,0,-1));
  assert.ok(ray.intersectObject(cross).length>0,`Celtic cross ring present in quadrant (${sx},${sy})`);
 }
}
assert.equal(Object.keys(MEASURED_STONES).length>0,true);
if(process.argv.includes('--mutations')){
 const bad=(name,fn)=>{assert.throws(fn,undefined,name+' must fail');console.log(`PASS cemeteries negative: ${name} rejected`);};
 bad('open ring',()=>ringCheck({...square,ring:ring.slice(0,-1)},[-1,-1,41,41]));
 bad('crossed ring',()=>ringCheck({...square,ring:[[0,0],[40,40],[0,40],[40,0],[0,0]]},[-1,-1,41,41]));
 bad('wall outside mapped ring',()=>wallCheck({...square,wall:[[[-3,0],[-3,40]]]},[]));
 bad('solid inside road clearance',()=>wallCheck(square,[{a:[0,.5],b:[40,.5],half:1.5,kind:2}]));
 bad('blocked road centreline',()=>{assert.ok(pushed([10,0],fenceSolids(square,[0,0]))<1e-6,'road body never pushed');});
 bad('missing wall without baked opening',()=>wallCheck({...square,wall:[[[21.91,0],[40,0],[40,40]],[[0,40],[0,0],[18.09,0]]]},[]));
 bad('solid across baked track opening',()=>wallCheck({...square,wall:[...square.wall,[[18.09,0],[21.91,0]]],openings:[{...square.openings[0],kind:'track'}]},[]));
 bad('track crossing without baked opening',()=>wallCheck({...square,openings:[]},[{a:[20,-10],b:[20,10],half:.2,kind:4}]));
 bad('stone in road corridor',()=>stonesCheck(square,[{point:[10,10],turn:0,kind:0,shade:0}],220,[{a:[0,10],b:[40,10],half:1.5}]));
 bad('stone beside wall',()=>stonesCheck(square,[{point:[1,20],turn:0,kind:0,shade:0}],220));
 bad('stone corner in gate lane',()=>stonesCheck(square,[{point:[22.8,3],turn:0,kind:0,shade:0}],220));
 bad('mailbox inside',()=>mailboxCheck([square],{mailboxes:[{x:20,y:20}],communityBoxes:[]},'fixture'));
 bad('suppressed sliver with wall',()=>wallCheck({...square,suppressed:'small-or-sliver'},[]));
 bad('stone text',()=>stoneSourceCheck(source+'\nnew CanvasTexture();'));
}
console.log(`PASS cemeteries: ${count} polygons, ${stoneCount} plain stones; ${roadSamples} road/track body samples never pushed`);
console.log(`SUPPRESSED ${suppressed.length}: ${suppressed.join(', ')||'none'}`);

// Corner geometries are produced by the real direct bake in its isolated filesystem root.
const bakedFixture=read(process.env.MMM_CEMETERY_FIXTURE);
for(const c of bakedFixture.good.cemeteries)wallCheck(c,nearSegments(c,bakedFixture.good.roads));
console.log('PASS opening fixtures: 90-degree and sharp corners; physical width and complete through-lane drives');

async function optionalLoadContract(Type){
 let calls=0;const warnings=[],saved=console.warn;console.warn=(...args)=>warnings.push(args);
 try{
  const absent=await Type.load({village:[0,0]},async()=>{calls++;throw Error('unexpected fetch');},terrain,false,'mabou');
  assert.equal(absent,null);assert.equal(calls,0);assert.equal(warnings.length,0,'absent key needs no warning');
  const missing=await Type.load({village:[0,0],cemeteries:{file:'cemeteries.json',count:1}},async()=>{calls++;throw Error('fixture 404');},terrain,false,'mabou');
  assert.equal(missing,null,'missing file must leave the game running without cemeteries');assert.equal(calls,1);assert.equal(warnings.length,1,'one warning for a failed file');
 }finally{console.warn=saved;}
}
await optionalLoadContract(Cemeteries);
console.log('PASS optional cemetery loading: no key means no fetch; missing file means no scenery and one warning');

function slopedWallContract(Type){
 const site={...square,stoneArea:[],wall:[[[-5,0],[0,0]],[[3.52,0],[8.52,0]]]};
 for(const low of [false,true]){
  const slope={...terrain,surfaceAt:(x)=>({level:8,ground:x*.5}),meshHeightAt:x=>x*.5};
  const field=new Type([site],[0,0],slope,low,'mabou');field.update({x:0,z:0});
  const fitted=field.sites[0].fitted[0],matrix=new THREE.Matrix4(),vertex=new THREE.Vector3();
  let left=-Infinity,right=Infinity;
  fitted.samples.forEach((sample,i)=>{
   fitted.mesh.getMatrixAt(i,matrix);
   const axis=[sample.b[0]-sample.a[0],sample.a[1]-sample.b[1]],len=Math.hypot(...axis);
   const solid=fenceSolids({...site,wall:[[sample.a,sample.b]]},[0,0]);
   const lo=Math.min(...solid.map(s=>s.x-s.half)),hi=Math.max(...solid.map(s=>s.x+s.half));
   const positions=fitted.mesh.geometry.attributes.position;
   for(let k=0;k<positions.count;k++){
    vertex.fromBufferAttribute(positions,k).applyMatrix4(matrix);
    assert.ok(vertex.x>=lo-1e-6&&vertex.x<=hi+1e-6,'drawn vertical end faces match collision bounds on slope');
    const along=(vertex.x-sample.a[0])*axis[0]/len+(vertex.z+sample.a[1])*axis[1]/len;
    assert.ok(along>=-1e-6&&along<=len+1e-6,'geometry cannot extend past baked endpoints');
    if(sample.a[0]<0)left=Math.max(left,vertex.x);else right=Math.min(right,vertex.x);
   }
  });
  assert.ok(Math.abs((right-left)-3.52)<1e-5,'drawn sloped opening equals the collision opening in both detail levels');
 }
}
slopedWallContract(Cemeteries);
console.log('PASS sloped opening: transformed wall vertices stay within collision ends; drawn gap remains 3.52 m in high and low detail');

async function variant(name,change){
 const file=resolve(process.env.MMM_CEMETERY_CHECK_DIR,name+'.mjs'),input=change(source);
 assert.notEqual(input,source,'production mutation must change source');
 const result=spawnSync(resolve('web/node_modules/.bin/esbuild'),['--bundle','--loader=ts','--platform=node','--format=esm','--log-level=warning','--outfile='+file],{cwd:resolve('web/src'),input,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return import(pathToFileURL(file));
}
if(process.argv.includes('--mutations')){
 assert.throws(()=>{for(const c of bakedFixture.boundaryLength.cemeteries)wallCheck(c,nearSegments(c,bakedFixture.boundaryLength.roads));},undefined,'boundary-arclength mutant must fail physical clearance');
 console.log('PASS bake mutation: boundary-arclength width rejected by corner passage test');
 const tilted=await variant('tilted-wall',s=>{
  const start=s.indexOf('export function wallMatrix'),end=s.indexOf('\nexport class Cemeteries',start);assert.ok(start>=0&&end>start);
  return s.slice(0,start)+`export function wallMatrix(a,b,ya,yb,origin,target=new THREE.Matrix4()) {const d=new THREE.Object3D(),len=distance(a,b),dy=yb-ya;d.position.set((a[0]+b[0])/2-origin[0],(ya+yb)/2+.45,origin[1]-(a[1]+b[1])/2);d.rotation.set(0,Math.atan2(b[1]-a[1],b[0]-a[0]),Math.atan2(dy,len),'YXZ');d.scale.set(Math.hypot(len,dy)+.012,1,.3);d.updateMatrix();return target.copy(d.matrix);}\n`+s.slice(end);
 });
 assert.throws(()=>slopedWallContract(tilted.Cemeteries),undefined,'tilted-box mutant must fail endpoint bounds');console.log('PASS renderer mutation: tilted wall rejected by transformed geometry bounds');
 const unguarded=await variant('unguarded-load',s=>{
  const from="    } catch (error) {\n      console.warn('cemeteries unavailable', error);\n      return null;\n    }";assert.ok(s.includes(from));
  return s.replace('    try {\n      const data = await getJson(entry.file)','    {\n      const data = await getJson(entry.file)').replace(from,'    }');
 });
 await assert.rejects(()=>optionalLoadContract(unguarded.Cemeteries));console.log('PASS loader mutation: startup rejection on missing file rejected');
}
