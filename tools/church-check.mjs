// Bundle with esbuild (as in check-area.sh), then run from the repository root.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {ChurchSite, CHURCH_GEOM, CHURCH_FEATURES, CHURCH_SCALE, CHURCH_ORIGIN, CHURCH_START, CHURCH_LANE, CHURCH_GROUNDS} from '../web/src/church-site.ts';
import {buildChurchModel, Church} from '../web/src/church.ts';
import {churchPlaces, nearestPlacement} from '../web/src/places.ts';
import {Roads} from '../web/src/roads.ts';
import {pushOut} from '../web/src/parked.ts';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {fixture} from './trailer-regressions.mjs';
const read = file => JSON.parse(readFileSync(file));
// The private record of the scan measurements (church-scan-20261121, not in git). The code must match it number for number.
const original = read('data/work/church-scan-20261121/church-site.json');
// Static site imports must remain plain data; trigonometry belongs to instances.
const siteData=readFileSync('web/src/church-site.ts','utf8').split('export class ChurchSite')[0];
assert.ok(!/Math\.(sin|cos|atan2)\s*\(/.test(siteData),'no trigonometry at site import');
assert.deepEqual(CHURCH_GEOM, original.geom);
assert.deepEqual(CHURCH_FEATURES, original.features);assert.deepEqual(CHURCH_ORIGIN, original.origin);
const manifest=read('data/baked/areas/judique/manifest.json'), site=new ChurchSite(manifest.village);
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} vs ${b}`);
for(const [x,z] of [[0,0],[-29.1,7],[2.4,0],[0,1]]) {
 const p=site.world(x,z), local=site.local(p.x,p.z);close(local.x,x,'inverse x');close(local.z,z,'inverse z');
 const rotated=new THREE.Vector3(x,0,z).multiplyScalar(CHURCH_SCALE).applyAxisAngle(new THREE.Vector3(0,1,0),site.yaw);
 close(rotated.x,p.x-site.origin.x,'model/world x');close(rotated.z,p.z-site.origin.z,'model/world z');
}
const heading=(x,z)=>{const p=site.world(x,z);return (Math.atan2(p.x-site.origin.x,site.origin.z-p.z)*180/Math.PI+360)%360;};
close(heading(1,0),297.65,'tower axis WNW'); close(heading(0,1),27.65,'vestry offset NNE');close(heading(-1,0),117.65,'vestry end ESE');
assert.equal(new THREE.Matrix4().makeRotationY(site.yaw).determinant(),1);
const baked=read('data/baked/areas/judique/buildings.json').buildings;
const replaced=baked.filter(b=>Math.hypot(b.x-630844.2,b.y-5080637.2)<=8);
assert.equal(replaced.length,1);assert.equal(site.buildings(baked).length,baked.length-1);
const renumbered=baked.map(b=>({...b,id:b.id+10000}));
assert.deepEqual(site.buildings(renumbered).map(b=>[b.x,b.y]),site.buildings(baked).map(b=>[b.x,b.y]));
const centre={x:630844.2,y:5080637.2},kept={id:9,x:630844.2+8.01,y:5080637.2};
assert.deepEqual(site.buildings([{id:91,...centre},{id:92,buildingId:91,x:centre.x+12,y:centre.y},kept]),[kept]);
assert.equal(site.buildings([{id:7,x:centre.x+8,y:centre.y}]).length,0,'8 m inclusive boundary');
close(CHURCH_START.heading,Math.atan2(3.97,.43),'stored road heading');
const roads=new Roads(read('data/baked/areas/judique/roads.json'),manifest.village,{}),place=churchPlaces()[0];
const hit=nearestPlacement(roads,place,manifest.village);assert.equal(hit.road.name,'River Denys Road');assert.equal(hit.road.kind,4);assert.ok(hit.dist<1e-7);
const [a,b]=[hit.road.pts[hit.seg],hit.road.pts[hit.seg+1]],fx=Math.sin(hit.heading),fz=-Math.cos(hit.heading);
assert.ok(fx*(b[0]-a[0])+fz*(b[1]-a[1])>0,'spawn faces church approach');
const road=roads.roads.find(r=>r.id===99);let distance=0;for(let i=940;i<=959;i++)distance+=Math.hypot(road.pts[i][0]-road.pts[i-1][0],road.pts[i][1]-road.pts[i-1][1]);
assert.ok(distance>78&&distance<82,`${distance} m before church approach`);
for(const solid of site.solids.slice(0,3)) for(const heading of [0,.8,1.6,3.2,4.8]) {
 const car={x:solid.x,z:solid.z,heading,vx:0,vz:0,speed:0};pushOut(car,site.solids);
 assert.ok(Math.hypot(car.x-solid.x,car.z-solid.z)>.3,'church blocks car');
}
// Reverse tail-first into the nave using the real towing and vehicle classes.
// Both bodies must be clear after every step; placement must test the trailer too.
{
 const f=fixture(),solid=site.solids[0],heading=solid.heading+Math.PI/2;
 const fx=Math.sin(heading),fz=-Math.cos(heading);
 f.v.place(solid.x+fx*(solid.halfWidth+16),solid.z+fz*(solid.halfWidth+16),heading);
 const tow=f.make({solids:site.solids});assert.ok(tow.attached);
 let impacts=0;f.v.onSolidImpact=()=>impacts++;
 const clear=()=>{for(const body of tow.bodies())for(const s of site.solids)assert.ok(!touchesPlayer(s,body,-1e-6,body.spec),'coupled body intersects church');};
 let nearest=Infinity;
 for(let i=0;i<1200;i++){f.step(tow,-.3);clear();nearest=Math.min(nearest,Math.hypot(tow.probe.x-solid.x,tow.probe.z-solid.z));}
 assert.ok(impacts>0,'reversing trailer makes first church contact');
 assert.ok(Math.hypot(f.v.x-solid.x,f.v.z-solid.z)>nearest+4,'truck stays outside behind the contacting trailer');
 const pose={x:solid.x+fx*10,z:solid.z+fz*10,heading};
 assert.ok(site.solids.every(s=>!touchesPlayer(s,{...f.v,...pose},0,f.v.spec)),'placement fixture truck is clear');
 assert.equal(tow.validPair(pose),false,'reject placement with clear truck and trailer in nave');
 const moved={...pose};assert.ok(tow.allowPlacement(moved));assert.ok(Math.hypot(moved.x-pose.x,moved.z-pose.z)>.1);assert.ok(tow.validPair(moved));
 // A static scene change after a valid pose must also pass the final full-pair guard.
 f.v.place(moved.x,moved.z,moved.heading);clear();
 const temporary={x:tow.probe.x,z:tow.probe.z,half:1,halfWidth:1,heading};
 site.solids.push(temporary);tow.collide(1/120);clear();site.solids.pop();
 console.log(`PASS church towing: trailer-first reverse, ${impacts} impact notifications, trailer-only placement refusal, relocation and final static-change guard`);
}
assert.equal(site.height(0,0,206.4),206.4);
const gravel=site.world(14.58,11.55),outside=site.world(-20,18);assert.equal(site.surface(gravel.x,gravel.z).kind,11);assert.equal(site.surface(outside.x,outside.z),null);
// The mown lane to the cemetery drives as grass along its whole length, and trees keep off it.
for(let i=1;i<CHURCH_LANE.pts.length;i++)for(let k=0;k<=4;k++){const [a,b]=[CHURCH_LANE.pts[i-1],CHURCH_LANE.pts[i]],x=a[0]+(b[0]-a[0])*k/4,z=a[1]+(b[1]-a[1])*k/4,w=site.world(x,z);assert.equal(site.surface(w.x,w.z)?.kind,12,'mown lane is lawn');assert.ok(site.clearCanopy(w.x,w.z),'no trees on the lane');}
// The monument, the wayside cross and the big boulder block the car.
for(const [x,z] of [[CHURCH_GROUNDS.monument.x,CHURCH_GROUNDS.monument.z],[CHURCH_GROUNDS.wayside.x,CHURCH_GROUNDS.wayside.z],[-40.43,-34.7]]){const w=site.world(x,z),car={x:w.x,z:w.z,heading:0,vx:0,vz:0,speed:0};pushOut(car,site.solids);assert.ok(Math.hypot(car.x-w.x,car.z-w.z)>.3,'yard solid blocks car');}
// Canvas drawing is procedural. A minimal canvas lets this CPU test inspect all merged geometry.
globalThis.document={createElement(){return {width:0,height:0,getContext(){return {fillRect(){},strokeRect(){}};}};}};
const group=buildChurchModel();assert.equal(group.children.length,3);
let triangles=0;for(const mesh of group.children){const g=mesh.geometry;triangles+=g.attributes.position.count/3;assert.equal(g.index,null);assert.equal(g.attributes.color.count,g.attributes.position.count);assert.equal(mesh.material.type,'MeshLambertMaterial');assert.equal(mesh.material.transparent,false);assert.ok(mesh.castShadow&&mesh.receiveShadow);for(const attr of Object.values(g.attributes))assert.ok([...attr.array].every(Number.isFinite));}
// No terrain reads when far away, at most two readiness attempts per second when near.
let reads=0,level=7;const terrain={surfaceAt(){reads++;return {level};},heightAt(){reads++;return 206.4;}};
const church=new Church(site,terrain),near=site.origin,far={x:near.x+1000,z:near.z};
for(let i=0;i<1200;i++)church.update(far,i*1000/60);
assert.equal(reads,0,'far unbuilt church never queries terrain');
for(let i=0;i<120;i++)church.update(near,i*1000/60);
assert.equal(reads,4,'near unavailable church polls twice per second');
assert.equal(church.group.children.length,0);level=8;
church.update(near,2000);assert.equal(church.group.children.length,1);assert.equal(church.triangles,triangles);close(church.group.position.y,206.4,'terrain base');
const afterBuild=reads;for(let i=0;i<100;i++)church.update(near,3000+i*16);assert.equal(reads,afterBuild,'no terrain/geometry work after build');
// Top-down rays on flat land: each new part stands at its measured height, and the ramp falls away from the tower door.
{
 church.group.updateMatrixWorld(true);
 const top=(x,z)=>{const p=site.world(x,z),hit=new THREE.Raycaster(new THREE.Vector3(p.x,church.group.position.y+30,p.z),new THREE.Vector3(0,-1,0)).intersectObject(church.group,true)[0];assert.ok(hit,`model ${x},${z} has something to hit`);return (hit.point.y-church.group.position.y)/CHURCH_SCALE;};
 const {nave:n,tower:t,cupola:c}=CHURCH_GEOM,{ramp:rp,landing:ld}=CHURCH_FEATURES,{monument:m,wayside:w}=CHURCH_GROUNDS;
 const near=(a,b,eps,what)=>assert.ok(Math.abs(a-b)<=eps,`${what}: ${a.toFixed(3)} vs ${b}`);
 const rampAt=k=>top(rp.u,-t.zn-rp.run*k);
 near(rampAt(.1),rp.rise-(rp.rise-.03)*.1,.01,'ramp top by the tower door');near(rampAt(.9),rp.rise-(rp.rise-.03)*.9,.01,'ramp foot');
 near(top(ld.u,CHURCH_GEOM.vestry.z1+ld.depth/2),ld.rise,.01,'vestry landing');
 near(top(m.x+.02,m.z+.02),m.h,.06,'monument top');near(top(w.x,w.z),w.h,.01,'wayside cross top');
 near(top(c.x,c.z),c.cross,.01,'cupola cross tip');near(top(t.x1-.05,-t.zn+.05),c.base,.01,'tower cap');
 near(top((n.x0+n.x1)/2,(n.zs-n.zn)/2),n.ridge+.19,.01,'ridge cap');
 console.log('PASS church parts: ramp falls from the tower door; landing, monument, wayside cross, cupola cross, tower cap and ridge at their measured heights');
}
// Build through Church.update on sloping terrain, so the local/world and exaggeration conversion is exercised.
for(const exag of [1,1.5,3]){
 const heightAt=(x,z)=>{const p=site.local(x,z);return 206.4*exag+(-.1*p.x+.025*p.z)*exag;};
 const slope=new Church(site,{surfaceAt(){return {level:8};},heightAt});slope.update(near,0);slope.group.updateMatrixWorld(true);
 const cast=(x,y,z,dx,dz)=>{
  const p=site.world(x,z),dir=new THREE.Vector3(dx,0,dz).applyAxisAngle(new THREE.Vector3(0,1,0),site.yaw);
  return new THREE.Raycaster(new THREE.Vector3(p.x,slope.group.position.y+y*CHURCH_SCALE,p.z),dir,0,2*CHURCH_SCALE).intersectObject(slope.group,true)[0];
 };
 const ground=(x,z)=>{const p=site.world(x,z);return (heightAt(p.x,p.z)-slope.group.position.y)/CHURCH_SCALE;};
 const t=CHURCH_GEOM.tower,st=CHURCH_FEATURES.steps;
 let contacts=0;
 for(const x of [t.x1+.15,t.x1+st.run/2,t.x1+st.run-.05])for(const side of [-1,1]){
  const edge=st.u+side*st.width/2,y=ground(x,edge)+.04;
  const hit=cast(x,y,edge+side*.4,0,-side);assert.ok(hit&&hit.distance<.41*CHURCH_SCALE,`step side reaches sloping ground at exag ${exag}`);contacts++;
 }
 for(const z of [st.u-.5,st.u,st.u+.5]){
  const x=t.x1+st.run,y=ground(x,z)+.04;
  const hit=cast(x+.4,y,z,-1,0);assert.ok(hit&&hit.distance<.41*CHURCH_SCALE,`bottom riser reaches ground at exag ${exag}`);contacts++;
 }
 // The tower's back corner is the exact seam with the gable plane, where a ray grazes the wall edge; sample 0.1 m inside it.
 const tx0=CHURCH_GEOM.nave.x1;
 for(const side of [-1,1])for(const x of [tx0+.1,(tx0+t.x1)/2,t.x1]){
  const z=side<0?-t.zn:t.zs,y=ground(x,z)+.04;
  const hit=cast(x,y,z+side*.4,0,-side);assert.ok(hit&&hit.distance<.41*CHURCH_SCALE,`tower skirt reaches ground at exag ${exag}`);contacts++;
 }
 for(const z of [-.76,.92]){
  const x=t.x1,y=ground(x,z)+.04,hit=cast(x+.4,y,z,-1,0);
  assert.ok(hit&&hit.distance<.41*CHURCH_SCALE,`tower front skirt reaches ground at exag ${exag}`);contacts++;
 }
 // Every tread stays at its measured height.
 for(let i=0;i<st.count;i++){
  const x=t.x1+st.run*(st.count-i-.5)/st.count,p=site.world(x,0);
  const hit=new THREE.Raycaster(new THREE.Vector3(p.x,slope.group.position.y+2,p.z),new THREE.Vector3(0,-1,0)).intersectObject(slope.group,true)[0];
  assert.ok(hit);close((hit.point.y-slope.group.position.y)/CHURCH_SCALE,st.rise*(i+1)/st.count,'tread height');
 }
 console.log(`PASS entrance exag=${exag}: ${contacts} ground-contact rays plus ${st.count} tread heights`);
}
close((CHURCH_GEOM.tower.x1-CHURCH_GEOM.vestry.x0)*CHURCH_SCALE,17.95,'building length (scan)');
console.log(`PASS church: source constants, handedness, map origin ${CHURCH_ORIGIN}, position-based replacement, renumbered and split inputs, ${distance.toFixed(2)} m road spawn, collision, gravel, gated polling and one build; ${group.children.length} draws, ${triangles} triangles`);
