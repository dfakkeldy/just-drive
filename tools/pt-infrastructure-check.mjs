import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import { PointInfrastructure, INFRASTRUCTURE_COLORS, infrastructureParts, infrastructureRoadClear, infrastructureGround, infrastructureCapClear } from '../web/src/pt-infrastructure.ts';
import {PT_FEATURES,PT_BOUNDS} from '../web/src/pt-infrastructure-source.ts';
import {railLand} from './guardrail-land.mjs';
const land=railLand('areas/pointtupper'),byId=new Map(PT_FEATURES.map(f=>[f.id,f]));
const kit=new PointInfrastructure(PT_FEATURES,land.village,1,0,land.roads);
const [west,south,east,north]=PT_BOUNDS;
function inside(e,n){assert.ok(e>=west&&e<=east&&n>=south&&n<=north,'outside area');}
function distance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1];if(dx*dx+dy*dy===0)return Math.hypot(p[0]-a[0],p[1]-a[1]);const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
const segments=land.roads.roads.flatMap(r=>r.pts.slice(1).map((b,i)=>[r.pts[i],b,r.halfWidth]));
const roadReceipts=new Map();
const turn=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
function independentClear(p){
 const key=JSON.stringify(p);if(roadReceipts.has(key))return roadReceipts.get(key);
 const a=[p.a[0]-land.village[0],land.village[1]-p.a[1]],b=[p.b[0]-land.village[0],land.village[1]-p.b[1]];
 const clear=Math.min(p.a[2]-p.baseA,p.b[2]-p.baseB)-p.height/2>=4||segments.every(([c,d,h])=>{
  const r=h+p.width/2+.6;
  if(Math.min(c[0],d[0])-r>Math.max(a[0],b[0])||Math.max(c[0],d[0])+r<Math.min(a[0],b[0])||Math.min(c[1],d[1])-r>Math.max(a[1],b[1])||Math.max(c[1],d[1])+r<Math.min(a[1],b[1]))return true;
  if(turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0)return false;
  return Math.min(distance(a,c,d),distance(b,c,d),distance(c,a,b),distance(d,a,b))>r;
 });roadReceipts.set(key,clear);return clear;
}
const pointGates=new Set(PT_FEATURES.filter(f=>f.kind==='gate'&&f.points.length===1).map(f=>f.id));
const blockedGates=new Set(infrastructureParts(PT_FEATURES).filter(p=>pointGates.has(p.id)&&!independentClear(p)).map(p=>p.id));
const expected=infrastructureParts(PT_FEATURES).filter(p=>independentClear(p)&&!blockedGates.has(p.id));
const expectedIds=new Set(expected.map(p=>p.id));
// Build source-pair span coverage from the format contract, independently of the production planner.
function checkSourceSpans(parts){
 const expectedSpans=[];
 for(const f of PT_FEATURES){
  if(f.existing||f.kind==='culvert'||f.points.length===1)continue;
  const role=f.kind==='dam'?'concrete':f.kind==='conveyor'?'gallery':f.kind==='pipeline'?'pipe':f.kind==='pier'?'deck':'steel';
  const h=f.height??2;
  const specs=f.kind==='dam'?[[f.closed?.25:.8,f.closed?.7:1.2,.2]]:f.kind==='conveyor'?[[2.4,1.6,5.8]]:f.kind==='pipeline'?[[.6,.6,1.5]]:f.kind==='pier'?[[2,.35,1]]:[[.06,.06,h],[.05,.05,h*.45]];
  for(let i=1;i<f.points.length;i++)for(const [width,height,lift] of specs){
   const a=f.points[i-1],b=f.points[i],p={id:f.id,role,a:[a[0],a[1],a[2]+lift],b:[b[0],b[1],b[2]+lift],width,height,baseA:a[2],baseB:b[2]};
   if(independentClear(p))expectedSpans.push(JSON.stringify(p));
  }
 }
 const actual=parts.filter(p=>{const f=byId.get(p.id);return f&&f.kind!=='culvert'&&f.points.length>1&&(p.a[0]!==p.b[0]||p.a[1]!==p.b[1]);}).map(p=>JSON.stringify(p));
 assert.deepEqual(actual.sort(),expectedSpans.sort(),'all consecutive source spans');
}
checkSourceSpans(kit.parts);

function check(parts){
 const used=new Set();
 for(const p of parts){
  const f=byId.get(p.id);assert.ok(f,'unknown source');assert.ok(!f.existing,'duplicate baked culvert');used.add(f.id);
  for(const q of [p.a,p.b]){
   inside(q[0],q[1]);
   const distances=f.outline.length===1?[Math.hypot(q[0]-f.outline[0][0],q[1]-f.outline[0][1])]:f.outline.slice(1).map((b,i)=>distance(q,f.outline[i],b));
   assert.ok(Math.min(...distances)<(f.outline.length===1?2.01:.03),'off source geometry '+p.id+' '+JSON.stringify(q)+' '+Math.min(...distances));
   // Every generated endpoint derives from a sampled source base, with one documented schematic lift.
   const bases=f.points.filter(b=>Math.hypot(q[0]-b[0],q[1]-b[1])<=2.01);
   assert.ok(bases.length,'missing baked base');
   assert.ok((f.kind==='gate'&&f.gateGround?f.gateGround:bases.map(b=>b[2])).some(y=>Math.abs(y-(q===p.a?p.baseA:p.baseB))<.01),'wrong base');
  }
  const vertical=p.a[0]===p.b[0]&&p.a[1]===p.b[1];
  if(vertical){
   const h=f.kind==='conveyor'?5:f.kind==='pipeline'?1.2:f.kind==='pier'?1:f.kind==='gate'&&f.points.length===1?1.4:f.height??2;
   assert.ok(Math.abs(p.a[2]-p.baseA)<.001&&Math.abs(p.b[2]-p.baseB-h)<.001,'post lift');
   assert.equal(p.height,p.width,'post cross section');
  }else{
   const lift=f.kind==='conveyor'?5.8:f.kind==='pipeline'?1.5:f.kind==='culvert'?.1:f.kind==='dam'?.2:f.kind==='pier'?1:f.kind==='gate'&&f.points.length===1?1.1:null;
   if(lift!==null)assert.ok(Math.abs(p.a[2]-p.baseA-lift)<.001&&Math.abs(p.b[2]-p.baseB-lift)<.001,'role lift');
   else assert.ok([f.height??2,(f.height??2)*.45].some(h=>Math.abs(p.a[2]-p.baseA-h)<.001),'fence rail lift');
   const height=f.kind==='conveyor'?1.6:f.kind==='pipeline'?.6:f.kind==='culvert'?1:f.kind==='dam'?f.closed?.7:1.2:f.kind==='pier'?.35:null;
   if(height!==null)assert.equal(p.height,height,'role size');
  }
  assert.ok(independentClear(p),'road clearance');
 }
 assert.equal(used.size,expectedIds.size,'missing source structure');
 assert.equal(parts.length,expected.length,'missing or duplicate part');
 assert.deepEqual(parts.map(p=>JSON.stringify(p)).sort(),expected.map(p=>JSON.stringify(p)).sort(),'complete independently filtered coverage');
}
assert.equal(byId.size,223);
// Normal construction is 60-260 ms (the higher on a loaded shared host); the slow pre-grid build took 11 s.
assert.ok(kit.group.userData.buildMs<2000,'scene construction exceeds 2 s on the check host');
for(const f of PT_FEATURES){
 for(const p of f.points){inside(p[0],p[1]);const y=land.ground(p[0]-land.village[0],land.village[1]-p[1],true);assert.ok(y!==null&&Math.abs(y-p[2])<.06,'baked ground mismatch '+f.id);}
}
check(kit.parts);
assert.deepEqual(kit.group.children.map(m=>m.name),['boxes','pipe','dam caps'],'three batches, one draw each');
assert.deepEqual(Object.fromEntries([...new Set(PT_FEATURES.map(f=>f.kind))].map(k=>[k,PT_FEATURES.filter(f=>f.kind===k&&expectedIds.has(f.id)).length])),{conveyor:44,fence:19,gate:2,dam:10,culvert:51,pier:6,pipeline:2},'pinned placed kinds');
// Inspect the actual matrices and complete box/ring envelopes, not only planner output.
let instances=0,triangles=0;
function checkMatrices(drawn,stretch,sea){
for(const mesh of drawn.group.children){
 if(!mesh.isInstancedMesh){
  assert.equal(mesh.name,'dam caps');const pos=mesh.geometry.attributes.position;
  const samples=PT_FEATURES.filter(f=>f.kind==='dam'&&f.closed).flatMap(f=>f.points);
  for(let i=0;i<pos.count;i++){
   const e=pos.getX(i)+land.village[0],n=land.village[1]-pos.getZ(i);inside(e,n);
   assert.ok(samples.some(p=>Math.hypot(e-p[0],n-p[1])<.002&&Math.abs(pos.getY(i)-((p[2]>sea?sea+(p[2]-sea)*stretch:p[2])+.25))<.002),'cap source vertex');
  }
  for(let i=0;i<pos.count;i+=3){
   const tri=[0,1,2].map(j=>[pos.getX(i+j),pos.getZ(i+j)]);
   const inTriangle=q=>{const a=turn(tri[0],tri[1],q),b=turn(tri[1],tri[2],q),c=turn(tri[2],tri[0],q);return (a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0);};
   const minX=Math.min(...tri.map(p=>p[0])),maxX=Math.max(...tri.map(p=>p[0])),minZ=Math.min(...tri.map(p=>p[1])),maxZ=Math.max(...tri.map(p=>p[1]));
   for(const [a,b,h] of segments){
    if(Math.max(a[0],b[0])+h<minX||Math.min(a[0],b[0])-h>maxX||Math.max(a[1],b[1])+h<minZ||Math.min(a[1],b[1])-h>maxZ)continue;
    const len=Math.hypot(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(len*2));
    for(let k=0;k<=steps;k++)for(let side=-h;side<=h;side+=.5){const t=k/steps,q=[a[0]+(b[0]-a[0])*t-(b[1]-a[1])*side/len,a[1]+(b[1]-a[1])*t+(b[0]-a[0])*side/len];assert.ok(!inTriangle(q),'cap covers road area');}
   }
  }
  continue;
 }

 assert.ok(mesh.name==='boxes'||mesh.name==='pipe','instance batch name');
 const parts=kit.parts.filter(p=>(p.role==='pipe')===(mesh.name==='pipe'));assert.equal(mesh.count,parts.length);
 if(mesh.name==='boxes'){const c=new THREE.Color();parts.forEach((p,i)=>{mesh.getColorAt(i,c);assert.equal(c.getHex(),INFRASTRUCTURE_COLORS[p.role],'role colour '+p.role);});}
 const matrix=new THREE.Matrix4(),position=new THREE.Vector3();
 for(let i=0;i<mesh.count;i++){
  mesh.getMatrixAt(i,matrix);const p=parts[i];position.setFromMatrixPosition(matrix);
  assert.ok(Math.abs(position.x-(p.a[0]+p.b[0])/2+land.village[0])<.002);
  assert.ok(Math.abs(position.z-land.village[1]+(p.a[1]+p.b[1])/2)<.002);
  assert.ok(Math.abs(position.y-((p.baseA>sea?sea+(p.baseA-sea)*stretch:p.baseA)+p.a[2]-p.baseA+(p.baseB>sea?sea+(p.baseB-sea)*stretch:p.baseB)+p.b[2]-p.baseB)/2)<.002);
  for(const [end,base,z] of [[p.a,p.baseA,-.5],[p.b,p.baseB,.5]]){
   const q=new THREE.Vector3(0,0,z).applyMatrix4(matrix);
   assert.ok(Math.hypot(q.x+land.village[0]-end[0],land.village[1]-q.z-end[1])<.003,'instance direction');
   assert.ok(Math.abs(q.y-((base>sea?sea+(base-sea)*stretch:base)+end[2]-base))<.003,'instance endpoint height');
  }
  const direction=new THREE.Vector3(p.b[0]-p.a[0],(p.baseB>sea?sea+(p.baseB-sea)*stretch:p.baseB)+p.b[2]-p.baseB-((p.baseA>sea?sea+(p.baseA-sea)*stretch:p.baseA)+p.a[2]-p.baseA),p.a[1]-p.b[1]).normalize();
  if(Math.abs(direction.y)<.999999){const vertical=new THREE.Vector3(0,1,0).addScaledVector(direction,-direction.y).normalize(),actual=new THREE.Vector3(0,1,0).transformDirection(matrix);assert.ok(actual.dot(vertical)>.99999,'upright cross section');}
  const feature=byId.get(p.id);
  if(p.role==='gallery'||p.role==='pipe'&&feature.kind==='pipeline')for(const t of [.25,.5,.75]){
   const e=p.a[0]+(p.b[0]-p.a[0])*t,n=p.a[1]+(p.b[1]-p.a[1])*t,raw=land.ground(e-land.village[0],land.village[1]-n,true);
   const y=new THREE.Vector3(0,0,t-.5).applyMatrix4(matrix).y,ground=raw>sea?sea+(raw-sea)*stretch:raw;
   assert.ok(y-p.height/2-ground>=(p.role==='gallery'?4:.3),'midspan ground clearance '+p.id);
  }
  const scale=new THREE.Vector3(),quat=new THREE.Quaternion();matrix.decompose(new THREE.Vector3(),quat,scale);assert.ok(Math.abs(scale.x-p.width)<.001&&Math.abs(scale.y-p.height)<.001,'true metre cross section');
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){const v=new THREE.Vector3(x,y,z).applyMatrix4(matrix);inside(v.x+land.village[0],land.village[1]-v.z);}
 }
 if(stretch===1){instances+=mesh.count;triangles+=mesh.count*mesh.geometry.index.count/3;}
}
}
for(const stretch of [1,1.5,3])checkMatrices(new PointInfrastructure(PT_FEATURES,land.village,stretch,-.2,land.roads),stretch,-.2);
if(process.argv.includes('--mutations')){
 const bad=new PointInfrastructure(PT_FEATURES,land.village,3,-.2,land.roads),mesh=bad.group.children.find(m=>m.isInstancedMesh),matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);matrix.elements[13]+=1;mesh.setMatrixAt(0,matrix);assert.throws(()=>checkMatrices(bad,3,-.2),undefined,'stretched lift survived');console.log('killed stretched matrix');
 const rolled=new PointInfrastructure(PT_FEATURES,land.village,3,-.2,land.roads),gallery=rolled.group.children.find(m=>m.name==='boxes'),g=kit.parts.filter(p=>p.role!=='pipe').findIndex(p=>p.role==='gallery');gallery.getMatrixAt(g,matrix);matrix.multiply(new THREE.Matrix4().makeRotationZ(Math.PI));gallery.setMatrixAt(g,matrix);assert.throws(()=>checkMatrices(rolled,3,-.2),undefined,'rolled gallery survived');console.log('killed rolled matrix');
 const recoloured=new PointInfrastructure(PT_FEATURES,land.village,3,-.2,land.roads),boxes=recoloured.group.children.find(m=>m.name==='boxes');boxes.setColorAt(0,new THREE.Color(0xff00ff));assert.throws(()=>checkMatrices(recoloured,3,-.2),undefined,'wrong role colour survived');console.log('killed role colour');
 const capped=new PointInfrastructure(PT_FEATURES,land.village,3,-.2,land.roads),cap=capped.group.children.find(m=>m.name==='dam caps');
 const f=PT_FEATURES.find(f=>f.id==='row-jg3i.vde3_dgux'),points=f.points.slice(0,-1),contour=points.map(p=>new THREE.Vector2(p[0]-land.village[0],land.village[1]-p[1]));
 const tri=THREE.ShapeUtils.triangulateShape(contour,[]).find(t=>!infrastructureCapClear(land.roads,land.village,t.map(i=>points[i])));
 cap.geometry.setAttribute('position',new THREE.Float32BufferAttribute(tri.flatMap(i=>{const p=points[i];return [p[0]-land.village[0],(p[2]>-.2?-.2+(p[2]+.2)*3:p[2])+.25,land.village[1]-p[1]];}),3));assert.throws(()=>checkMatrices(capped,3,-.2),undefined,'road cap survived');console.log('killed road cap');
 assert.throws(()=>checkSourceSpans(kit.parts.filter((p,i)=>p.role!=='gallery'||i%2===0)),undefined,'alternate spans survived');console.log('killed alternate spans');

 const mutations={
  invented:p=>{p[0].id='invented';},
  displaced:p=>{p[0].a[0]+=40;},
  outside:p=>{p[0].b[0]=east+10;},
  height:p=>{p[0].a[2]+=100;},
  noLift:p=>{const x=p.find(p=>p.role==='gallery');x.a[2]=x.baseA;},
  size:p=>{p.find(p=>p.role==='gallery').height*=1.5;},
  road:p=>{const blocked=infrastructureParts(PT_FEATURES).find(x=>!infrastructureRoadClear(land.roads,land.village,x));if(!blocked)throw new Error('road mutant has no road-covering part');p.push(structuredClone(blocked));},
  missing:p=>{const id=p[0].id;return p.filter(x=>x.id!==id);},
  duplicate:p=>{p.push(structuredClone(p[0]));},
  bakedDuplicate:p=>{p[0].id=PT_FEATURES.find(f=>f.existing).id;},
  lonePost:p=>{const id=[...blockedGates][0];if(!id)throw new Error('lone-post mutant has no partly blocked point gate');p.push(...structuredClone(infrastructureParts(PT_FEATURES).filter(x=>x.id===id&&independentClear(x))));},
 };
 for(const [name,mutate] of Object.entries(mutations)){const parts=structuredClone(kit.parts),mutated=mutate(parts)??parts;assert.throws(()=>check(mutated),undefined,name+' survived');console.log('killed',name);}
}
console.log(JSON.stringify({buildMs:kit.group.userData.buildMs,placedByKind:Object.fromEntries([...new Set(PT_FEATURES.map(f=>f.kind))].map(k=>[k,PT_FEATURES.filter(f=>f.kind===k&&kit.parts.some(p=>p.id===f.id)).length])),sources:byId.size,placedSources:new Set(kit.parts.map(p=>p.id)).size,instances,batches:kit.group.children.length,instanceTriangles:triangles,capTriangles:kit.group.children.find(m=>m.name==='dam caps').geometry.attributes.position.count/3}));
