// The Sugar Camp stunt layout on real West Bay land: a rigid copy of the tested works-yard layout,
// every piece and fitting seated on the finest land at each Hill height and both qualities,
// clear of the pit lakes, park tracks and park fixtures. Run from web/: node ../tools/run-node-check.mjs ../tools/sugar-camp-stunts-check.mjs
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {makeGround,preload} from './phone-ground.mjs';
import {YardSite} from '../web/src/yard-site.ts';
import {QuarrySite,QUARRY_BOX,LOOKOFFS,GATE,lakeAt} from '../web/src/quarry-site.ts';
import {PARK_BOARDS} from '../web/src/quarry.ts';
import {testParkLayout,testParkDressing} from '../web/src/stunt-test-park.ts';
import {sugarCampFrame,createSugarCampStunts,sugarCampStuntPlaces,sugarCampClearing,SUGAR_CAMP_STUNTS} from '../web/src/sugar-camp-stunts.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';

const WEST_BAY='../data/baked/areas/westbay';
const rel=(a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,c=Math.cos(-a.heading),s=Math.sin(-a.heading);return [dx*c-dz*s,dx*s+dz*c,b.heading-a.heading];};
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
/** Pieces whose visual footprint, plus 5 m, touches a pit lake. One scan for the real layout and the mutant. */
const wetPieces=(placements,village)=>placements.filter(p=>{const piece=p.piece,b=piece.visualFootprint??piece.footprint,s=Math.sin(p.heading),c=Math.cos(p.heading);
  for(let u=b[0]-5;u<=b[2]+5;u+=3)for(let v=b[1]-5;v<=b[3]+5;v+=3){const x=p.x+u*s+v*c,z=p.z-u*c+v*s;if(lakeAt(x+village[0],village[1]-z))return true;}return false;}).map(p=>p.piece.id);

// 1. Rigid copy: every piece and fitting keeps its position and heading relative to the easy start arch.
{
  const yard=new YardSite([0,0],'invented'),camp=sugarCampFrame([0,0]);
  const a=[...testParkLayout(yard),...testParkDressing(yard)],b=[...testParkLayout(camp),...testParkDressing(camp,'SUGAR CAMP')];
  assert.equal(a.length,b.length);
  const ia=a.findIndex(p=>p.piece.id==='start-arch'),ib=b.findIndex(p=>p.piece.id==='start-arch');
  for(let i=0;i<a.length;i++){
    assert.equal(a[i].piece.id,b[i].piece.id);
    const ra=rel(a[ia],a[i]),rb=rel(b[ib],b[i]);
    assert.ok(Math.abs(ra[0]-rb[0])<1e-6&&Math.abs(ra[1]-rb[1])<1e-6&&Math.abs(wrap(ra[2]-rb[2]))<1e-9,`${a[i].piece.id} keeps its tested spacing`);
  }
  // The frame is a pure rotation: no mirror image, no scale.
  const o=camp.world(0,0),u=camp.world(1,0),v=camp.world(0,1);
  assert.ok(Math.abs(Math.hypot(u.x-o.x,u.z-o.z)-1)<1e-12&&Math.abs(Math.hypot(v.x-o.x,v.z-o.z)-1)<1e-12);
  const yo=yard.world(0,0),yu=yard.world(1,0),yv=yard.world(0,1),cross=(p,q,r)=>(q.x-p.x)*(r.z-p.z)-(q.z-p.z)*(r.x-p.x);
  assert.equal(Math.sign(cross(o,u,v)),Math.sign(cross(yo,yu,yv)),'same handedness as the works yard');
  console.log('RIGID',a.length,'placements');
}

// 2. Real land, each Hill height and quality.
const hills=(process.env.SUGAR_STUNT_HILLS??'1,1.5,2,2.5').split(',').map(Number);
for(const low of [false,true])for(const exag of hills){
  process.env.PHONE_EXAG=String(exag);
  const {terrain,roads}=makeGround(WEST_BAY),village=terrain.manifest.village;terrain.low=low;
  const site=new QuarrySite(village);
  // Production order: both Sites exist before any tile is built (prepare reads the survey PNGs, not tiles).
  const before=terrain.sites.length,park=await createSugarCampStunts(terrain,village,low);
  assert.equal(terrain.sites.length,before+1,'the park registers one Site');
  terrain.sites.push(site);   // main.ts order: stunt park first, then the quarry
  const points=park.pieces.flatMap(p=>{const b=p.placement.piece.footprint;return [[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]],[0,0]].map(([u,v])=>Object.values(p.world(u,v)));});
  await preload(terrain,points,65);
  for(const tile of terrain.tiles.values())if(tile.mesh){tile.mesh.visible=true;tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);}
  terrain.group.updateMatrixWorld(true);
  const rig=()=>{const root=new THREE.Group(),body=new THREE.Group();root.add(body);const g=()=>new THREE.Group();return {root,body,wheels:{fl:g(),fr:g(),rl:g(),rr:g()},steer:{fl:g(),fr:g()}};};
  const car=new Vehicle(rig(),terrain,roads,-.2,CAR_SPEC),p0=park.pieces[0].world(0,0);car.place(p0.x,p0.z,park.pieces[0].placement.heading);
  park.update(0,car,new THREE.Vector3(p0.x,(car.y??0)+10,p0.z));
  let graded=0,sampled=0;
  for(const p of park.pieces){const b=p.placement.piece.gradingFootprint??p.placement.piece.footprint;for(const [u,v] of [[(b[0]+b[2])/2,(b[1]+b[3])/2],[b[0],0],[b[2],0],[(b[0]+b[2])/2,b[1]],[(b[0]+b[2])/2,b[3]]]){const w=p.world(u,v);sampled++;if(terrain.siteGroundChangedAt(park,w.x,w.z))graded++;}}
  assert.ok(graded>=sampled*.9,`built tiles carry the park grading (${graded} of ${sampled} sampled points)`);
  assert.ok(park.pieces.every(p=>p.ready),'all pieces seat on finest baked land');
  assert.ok(park.dressing.every(p=>p.ready),'all fittings seat');
  assert.ok(park.triangles+(park.pieces.length+2)*4<=(low?30000:90000),'same whole-park triangle budget as the works-yard park');

  // Inside the park, clear of lakes, tracks and park fixtures.
  const e0=park.box[0]+village[0],e1=park.box[2]+village[0],n0=village[1]-park.box[3],n1=village[1]-park.box[1];
  assert.ok(e0>QUARRY_BOX[0]&&e1<QUARRY_BOX[2]&&n0>QUARRY_BOX[1]&&n1<QUARRY_BOX[3],'park box inside the quarry box');
  for(const f of [...LOOKOFFS,...PARK_BOARDS,GATE])assert.ok(f.e<e0-20||f.e>e1+20||f.n<n0-20||f.n>n1+20,`park clear of fixture at ${f.e},${f.n}`);
  let worst=0,minRoad=Infinity;
  for(const p of park.pieces){
    const piece=p.placement.piece,g=piece.gradingFootprint??piece.footprint,vis=piece.visualFootprint??piece.footprint;let lo=Infinity,hi=-Infinity;
    for(let u=g[0]-(piece.runup??10);u<=g[2];u+=2)for(let v=g[1];v<=g[3];v+=2){const w=p.world(u,v),h=await terrain.surveyHeightAt(w.x,w.z);lo=Math.min(lo,h);hi=Math.max(hi,h);}   // surveyed land, before any grading
    worst=Math.max(worst,hi-lo);
    for(let u=vis[0]-5;u<=vis[2]+5;u+=3)for(let v=vis[1]-5;v<=vis[3]+5;v+=3){const w=p.world(u,v);
      const near=roads.nearest(w.x,w.z,40);if(near)minRoad=Math.min(minRoad,near.dist-near.road.halfWidth);}
  }
  assert.deepEqual(wetPieces(park.pieces.map(p=>p.placement),village),[],'every piece clear of the pit lakes');
  assert.ok(worst<3,`grading per piece stays under 3 m (got ${worst.toFixed(2)} m)`);
  assert.ok(minRoad>3,`park tracks stay 3 m clear of every piece (got ${minRoad.toFixed(1)} m)`);

  // The clearing holds every piece, fitting and run-up, and stays inside the quarry.
  const clearing=sugarCampClearing(village);
  assert.ok(terrain.clear.some(b=>b.every((v,i)=>v===clearing[i])),'the park clearing is registered');
  for(const p of [...park.pieces,...park.dressing])for(const k of [0,1,2,3]){const b=p.box;const x=b[k&1?2:0],z=b[k&2?3:1];assert.ok(x>=clearing[0]&&x<=clearing[2]&&z>=clearing[1]&&z<=clearing[3],'piece inside the clearing');}
  assert.ok(clearing[0]+village[0]>QUARRY_BOX[0]&&clearing[2]+village[0]<QUARRY_BOX[2],'clearing inside the quarry');
  // Places: both starts on their run-ups, in West Bay, facing along the line.
  const places=sugarCampStuntPlaces(park,village);
  assert.deepEqual(places.map(p=>p.id),['sugar-camp-stunts-easy','sugar-camp-stunts-hard']);
  for(const p of places){assert.equal(p.area,'westbay');const x=p.e-village[0],z=village[1]-p.n;assert.ok(park.contains(x,z),'start inside the park');assert.ok(park.clearCanopy(x,z),'start on a cleared run-up');}
  console.log('LAND',exag,low?'LOW':'desktop','triangles',park.triangles,'worst grading',worst.toFixed(2),'m, nearest track',Number.isFinite(minRoad)?minRoad.toFixed(1)+' m':'beyond 40 m');
}

// 3. The land checks bite: the same layout 330 m west lands in the long pit lake.
{
  const {terrain}=makeGround(WEST_BAY),village=terrain.manifest.village,frame=sugarCampFrame(village);
  const shifted={world:(u,v)=>{const w=frame.world(u,v);return {x:w.x-330,z:w.z};},heading:frame.heading};
  assert.ok(wetPieces(testParkLayout(shifted),village).length>0,'mutant: a layout moved into the pit lake is caught by the same scan');
  console.log('MUTANT caught; frame centre',SUGAR_CAMP_STUNTS.e,SUGAR_CAMP_STUNTS.n);
}
// 4. A failed survey read leaves West Bay playable: no park, no Site left behind.
{
  const {terrain}=makeGround(WEST_BAY),village=terrain.manifest.village,before=terrain.sites.length;
  terrain.surveyHeightAt=async()=>{throw Error('503 for a pad survey tile');};
  const warn=console.warn;console.warn=()=>{};
  const park=await createSugarCampStunts(terrain,village,false);console.warn=warn;
  assert.equal(park,null,'failed survey: no park');assert.equal(terrain.sites.length,before,'failed survey: its Site is removed');
  console.log('SURVEY FAILURE handled');
}
console.log('PASS sugar-camp-stunts');
