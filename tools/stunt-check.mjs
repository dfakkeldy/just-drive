// Production StuntPark, Terrain and Vehicle on baked land. All motion advances at 120 Hz.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {makeGround,preload} from './phone-ground.mjs';
import {YardSite} from '../web/src/yard-site.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {TRUCK_SPEC,createTruck} from '../web/src/truck.ts';
import {createCar} from '../web/src/car.ts';
import {canvasStub} from './mp-models-build.mjs';
import {createTestPark,testParkLayout,testParkDressing} from '../web/src/stunt-test-park.ts';
import {StuntPark,PlacedStunt} from '../web/src/stunt-kit.ts';
import {gapPair} from '../web/src/stunt-pieces.ts';
import {TrickJudge} from '../web/src/stunt-rules.ts';
import {STUNT_GUIDANCE} from '../web/src/stunt-guidance.ts';
const implementationDigest=createHash('sha256').update(['stunt-kit','stunt-pieces','stunt-rules','stunt-test-park','stunt-guidance','stunt-visuals','stunt-dressing','stunt-ground-style','stunt-solids','terrain','vehicle','main',...readdirSync('src/stunts').filter(n=>n.endsWith('.ts')).sort().map(n=>'stunts/'+n.slice(0,-3))].map(n=>readFileSync(`src/${n}.ts`,'utf8')).join('\n')).digest('hex');
const dt=1/120,results=[],mutations=[];
const reject=(name,fn)=>{assert.throws(fn,undefined,name);mutations.push(name);};
function rig(){const root=new THREE.Group(),body=new THREE.Group();root.add(body);const wheels={fl:new THREE.Group(),fr:new THREE.Group(),rl:new THREE.Group(),rr:new THREE.Group()};return {root,body,wheels,steer:{fl:new THREE.Group(),fr:new THREE.Group()},driverEye:new THREE.Group(),brakeLights:[]};}
const makeVehicle=(terrain,roads,spec)=>{const v=new Vehicle(rig(),terrain,roads,-.2,spec);v.assist=0;return v;};
const buildings=JSON.parse(readFileSync('../data/baked/terrain/buildings.json')).buildings;
let measuredPark;
for(const low of [false,true])for(const exag of (process.env.STUNT_HILLS??'1,1.5,2,2.5').split(',').map(Number)){
 process.env.PHONE_EXAG=String(exag);const {terrain,roads}=makeGround(),yard=new YardSite(terrain.manifest.village,'invented');terrain.low=low;terrain.sites.push(yard);
 const before=terrain.sites.length;assert.equal(await createTestPark(new URLSearchParams(),terrain,yard,false),null);assert.equal(terrain.sites.length,before,'no parameter: no Site');
 assert.equal(await createTestPark(new URLSearchParams('park=other'),terrain,yard,false),null);
 const park=await createTestPark(new URLSearchParams('park=test'),terrain,yard,low,buildings);assert.equal(terrain.sites.length,before+1);
 const points=park.pieces.flatMap(p=>{const b=p.placement.piece.footprint;return [[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]],[0,0]].map(([u,v])=>Object.values(p.world(u,v)));});
 await preload(terrain,points,65);
 for(const tile of terrain.tiles.values())if(tile.mesh){tile.mesh.visible=true;tile.mesh.material.uniforms.hideQuad.value.set(0,0,0,0);}
 terrain.group.updateMatrixWorld(true);
 console.log('LOADED',exag,low?'LOW':'desktop');
 const v=makeVehicle(terrain,roads,CAR_SPEC),p0=park.pieces[0].world(0,0);v.place(p0.x,p0.z,park.pieces[0].placement.heading);park.update(0,v,new THREE.Vector3(p0.x,v.y+10,p0.z));
 console.log('BUDGET',low,exag,park.triangles);assert.ok(park.pieces.every(p=>p.ready),'all pieces seat on finest baked land');assert.ok(park.dressing.every(p=>p.ready),'dressing is seated before reporting budgets');assert.ok(park.triangles+(park.pieces.length+2)*4<=(low?30000:90000),'whole park triangle budget includes sign faces');
 let edgeError=0,toeError=0,rayError=0,jointError=0,steps=0,minHouse=Infinity,minRoad=Infinity;
 park.group.updateMatrixWorld(true);
 for(const p of park.pieces){
  for(const d of p.decks){const b=d.source.box;
   for(const u of [b[0],...d.source.breaks??[],b[2]])for(const vv of [b[1],0,b[3]]){const h=d.height(u,vv);if(h!==null){assert.ok(Number.isFinite(h));const wu=Math.max(b[0]+1e-5,Math.min(b[2]-1e-5,u)),wv=Math.max(b[1]+1e-5,Math.min(b[3]-1e-5,vv)),w=p.world(wu,wv),ray=new THREE.Raycaster(new THREE.Vector3(w.x,h+.02,w.z),new THREE.Vector3(0,-1,0),0,.1),hit=ray.intersectObject(d.source.draw===false?terrain.group:p.group,true).find(x=>!x.object.name.includes('board'));assert.ok(hit,`deck edge is drawn ${p.placement.piece.id} ${u},${vv} h=${h}`);rayError=Math.max(rayError,Math.abs(hit.point.y-h));}}
   if(!p.placement.piece.id.startsWith('berm'))for(let u=b[0];u<=b[2]-.05;u+=.1){const a=d.height(u,0),h=d.height(Math.min(u+.1,b[2]),0);if(a!==null&&h!==null)edgeError=Math.max(edgeError,Math.abs(a-h));steps++;}
   for(const joint of d.source.breaks??[]){if(joint<=b[0]||joint>=b[2])continue;const a=d.height(joint-1e-5,0),c=d.height(joint+1e-5,0);if(a!==null&&c!==null)jointError=Math.max(jointError,Math.abs(c-a));}
   for(const u of [b[0],b[2]])if(d.source.height(u,0)===0){const h=d.height(u,0),w=p.world(u,0);toeError=Math.max(toeError,Math.abs(h-terrain.meshHeightAt(w.x,w.z)));}
   assert.equal(d.height(b[0]-.001,b[1]),null,'exact outside edge');
   const heightReader=d.height;d.height=()=>1;reject('deck edge guard removed',()=>assert.equal(d.height(b[0]-.001,b[1]),null));d.height=heightReader;
  }
  for(let i=1;i<p.decks.length;i++){const a=p.decks[i-1],b=p.decks[i];if(a.source.box[2]===b.source.box[0]&&!p.placement.piece.id.startsWith('drop-')){const y=a.height(a.source.box[2],0),z=b.height(b.source.box[0],0);if(y!==null&&z!==null)jointError=Math.max(jointError,Math.abs(y-z));}}
  const b=p.placement.piece.footprint;
  for(let u=b[0];u<=b[2];u+=4)for(let vv=b[1];vv<=b[3];vv+=4){const w=p.world(u,vv),near=roads.nearest(w.x,w.z,200);if(near)minRoad=Math.min(minRoad,near.dist-near.road.halfWidth);
   for(const h of buildings){const dist=Math.hypot(h.x-terrain.manifest.village[0]-w.x,terrain.manifest.village[1]-h.y-w.z)-(h.length+h.width)/2;minHouse=Math.min(minHouse,dist);}
  }
 }
 console.log('EDGES',exag,{edgeError,toeError,rayError,minHouse,minRoad});
 assert.ok(minHouse>=60,'every retained layout stays outside the 60m property buffer');
 assert.ok(minRoad>=15,'retained structures clear mapped road edges by at least 15m');
 assert.ok(rayError<.03,`drawn triangle edge error ${rayError}`);assert.ok(toeError<.03,`toes meet drawn land ${toeError}`);
 // Graded approaches can have a slope, but a 10 cm interval must not contain a wheel-catching step.
 assert.ok(jointError<.03,`no wheel-catching joint ${jointError}`);
 const original=park.pieces[0].decks[0].ys[0];park.pieces[0].decks[0].ys[0]+=.1;
 reject('toe is raised by 10 cm',()=>assert.ok(Math.abs(park.pieces[0].decks[0].ys[0]-original)<.03));park.pieces[0].decks[0].ys[0]=original;
 // Both levels at the SAME crossing point, with the upper road filtered before selecting a floor.
 const tunnel=park.pieces.find(p=>p.placement.piece.id==='tunnel'),w=tunnel.world(0,0),floor=tunnel.decks[0].height(0,0),roof=tunnel.decks[1].height(0,0);
 assert.ok(roof-floor>4.8);assert.equal(park.deckHeight(w.x,w.z,null,floor+.25),floor);assert.equal(park.deckHeight(w.x,w.z,null,roof+.25),roof);
 reject('overhead deck selected underneath',()=>assert.equal(park.deckHeight(w.x,w.z,null,Infinity),floor));
 const table=park.pieces.find(p=>p.placement.piece.id==='tabletop'),capPoint=table.world(12,0),cap=table.decks[1].height(12,0),groundReader=park.groundHeight;
 const capCheck=()=>terrain.withGroundContact({y:cap-3},()=>assert.ok(Math.abs(terrain.heightAt(capPoint.x,capPoint.z)-cap)<1e-6,'filled cap is real ground'));
 capCheck();park.groundHeight=()=>null;reject('filled cap ground removed',capCheck);park.groundHeight=groundReader;
 console.log('SOLIDS',exag);
 // These are isolated-volume probes. The traversal cases own deck-level exemptions and neighbouring pieces.
 const allPieces=[...park.pieces],furniture=park.dressing.splice(0);
 for(const p of allPieces){const decks=p.decks.splice(0),solids=[...p.solids];park.pieces.splice(0,park.pieces.length,p);
  for(const spec of [CAR_SPEC,TRUCK_SPEC]){const car=makeVehicle(terrain,roads,spec);
   for(const s of solids){p.solids.splice(0,p.solids.length,s);for(const [a,b]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const ax=Math.sin(s.heading),az=-Math.cos(s.heading),r=spec.envelope.radius;
    car.x=s.x+ax*a*(s.half+r-.05)-az*b*(s.halfWidth+r-.05);car.z=s.z+az*a*(s.half+r-.05)+ax*b*(s.halfWidth+r-.05);car.y=Math.min(s.bottom+.01,s.top-.006);car.heading=s.heading;
    car.vx=-(car.x-s.x);car.vz=-(car.z-s.z);const x=car.x,z=car.z;park.step(dt,car,false);assert.ok(Math.hypot(car.x-x,car.z-z)>.001,`isolated solid stops ${spec.halfWidth*2} m spec from each side ${p.placement.piece.id} ${JSON.stringify({solid:s,side:[a,b]})}`);
   }}
  }
  p.decks.push(...decks);p.solids.splice(0,p.solids.length,...solids);
 }
 park.pieces.splice(0,park.pieces.length,...allPieces);park.dressing.push(...furniture);
 const far=makeVehicle(terrain,roads,CAR_SPEC);far.x=park.box[2]+1000;far.z=park.box[3]+1000;const queries=park.pieces.reduce((a,p)=>a+p.queries,0),farCam=new THREE.Vector3(far.x,200,far.z);
 for(let i=0;i<120;i++){park.step(dt,far);park.update(dt,far,farCam);}assert.equal(park.pieces.reduce((a,p)=>a+p.queries,0),queries,'far vehicle: no piece work');
 const farStep=park.step;park.step=(...args)=>{park.pieces[0].queries++;return farStep.apply(park,args);};reject('far-boundary guard bypassed',()=>{const before=park.pieces[0].queries;park.step(dt,far);assert.equal(park.pieces[0].queries,before);});park.step=farStep;
 results.push({low,exag,steps,edgeError,toeError,rayError,jointError,minHouse,minRoad,triangles:park.triangles,drawCalls:park.drawCalls,pieces:park.pieces.map(p=>({id:p.placement.piece.id,triangles:p.triangles,deckHash:createHash('sha256').update(Buffer.concat(p.decks.map(d=>Buffer.from(d.ys.buffer)))).digest('hex')})),dressing:park.dressing.map(p=>({id:p.placement.piece.id,triangles:p.triangles,ready:p.ready}))});
 if(!measuredPark||exag===1.5&&!low)measuredPark={terrain,roads,park,yard};
 console.log('GEOMETRY',JSON.stringify(results.at(-1)));
}
if(process.env.STUNT_GEOMETRY_ONLY){writeFileSync(process.env.STUNT_REPORT_PATH??'../data/work/west-bay/stunts/stunt-geometry-v2.json',JSON.stringify({geometry:results,deckDigests:measuredPark.park.pieces.map(p=>({id:p.placement.piece.id,hash:createHash('sha256').update(Buffer.concat(p.decks.map(d=>Buffer.from(d.ys.buffer)))).digest('hex')}))},null,2));process.exit(0);}
// A report must observe actual takeoff, obstacle crossing and a settled landing. Reuse the SAME input object.
const route={id:'fixture',takeoff:10,halfWidth:3,landing:[16,30],obstacle:{near:12,far:14,top:1}},sample={u:6,v:0,y:1,deck:1,airborne:false,speed:12,sideways:0,pitch:0,roll:0,yaw:0,contacts:0,placement:0,eligible:true};
function trick(change=()=>{}){const j=new TrickJudge(route,1,.8);let report=null;for(let i=0;i<240;i++){Object.assign(sample,{u:6+i*.1,v:0,speed:12,sideways:0,yaw:0,y:1,deck:1,airborne:false,contacts:0,placement:0,eligible:true});if(i>=35&&i<130){sample.airborne=true;sample.y=2+Math.sin((i-35)/95*Math.PI)*2;}change(sample,i);report=j.step(dt,sample)??report;}return report;}
const event=trick();assert.ok(event?.obstacleCleared&&Object.values(event.landing).every(Boolean));
for(const [name,change]of [['teleport',(s,i)=>{if(i>60)s.placement=1;}],['collision',(s,i)=>{if(i>60)s.contacts=1;}],['bypass',s=>s.v=8]])assert.equal(trick(change),null,name);
assert.equal(trick(s=>{if(s.airborne)s.y=.5;}).obstacleCleared,false,'low flight is reported as not cleared');
assert.equal(trick(s=>{s.yaw=Math.PI/2;}).landing.straight,false,'crosswise landing');
reject('wrong clearance passes',()=>assert.equal(trick(s=>{if(s.airborne)s.y=.5;}).obstacleCleared,true));
assert.throws(()=>gapPair(15));assert.throws(()=>gapPair(NaN));
const {terrain,roads,park}=measuredPark;
function realRig(spec){const doc=globalThis.document,height=globalThis.innerHeight;try{canvasStub();return spec===CAR_SPEC?createCar(false,true):createTruck(false);}finally{if(doc===undefined)delete globalThis.document;else globalThis.document=doc;if(height===undefined)delete globalThis.innerHeight;else globalThis.innerHeight=height;}}
const vehicles=new Map([CAR_SPEC,TRUCK_SPEC].map(s=>{const v=process.env.STUNT_GUIDANCE_ONLY?new Vehicle(realRig(s),terrain,roads,-.2,s):makeVehicle(terrain,roads,s);v.assist=0;return[s,v];}));
function run(p,spec,kph,offset=0,stopAt=null,brakeAfterLanding=false,handoffKph=null){
 const v=vehicles.get(spec);v.pitch=v.roll=v.steerAngle=0;
 const r=p.placement.piece.route??{landing:[0,0]},start=p.world(-7,offset);
 v.place(start.x,start.z,p.placement.heading);v.vx=Math.sin(v.heading)*kph/3.6;v.vz=-Math.cos(v.heading)*kph/3.6;v.speed=kph/3.6;park.reset();
 const contacts=park.contacts,rigBox=new THREE.Box3();let reached=false,peak=0,air=0,first=null,last=null,seenAir=false,landed=false,minRigClearance=Infinity;
 for(let i=0;i<120*(process.env.STUNT_GUIDANCE_ONLY?45:25);i++){
  const stopping=brakeAfterLanding&&landed;
  const afterThrottle=handoffKph===null?(v.speed>.05?-1:0):Math.max(-1,Math.min(1,(handoffKph/3.6-v.speed)*2));
  const input={throttle:stopping?afterThrottle:Math.max(-1,Math.min(1,(kph/3.6-v.speed)*2)),steer:0,handbrake:stopping&&handoffKph===null&&Math.abs(v.speed)<=.05};
  terrain.withGroundContact(v,()=>v.update(dt,input,()=>park.step(dt,v,true,0)));
  const u=p.u(v.x,v.z);
  if(v.airborne&&u>0){seenAir=true;air+=dt;first??=u;last=u;peak=Math.max(peak,v.y-p.seat(u,0));}
  if(process.env.STUNT_GUIDANCE_ONLY&&r.obstacle&&v.airborne){const reach=spec.envelope.reach;if(u+reach>=r.obstacle.near&&u-reach<=r.obstacle.far){v.car.root.updateMatrixWorld(true);rigBox.setFromObject(v.car.root);const top=p.judge?.route.obstacle?.top;assert.ok(Number.isFinite(rigBox.min.y)&&Number.isFinite(top),'real rig and actual obstacle have finite bounds');minRigClearance=Math.min(minRigClearance,rigBox.min.y-top);}}
  if(seenAir&&!v.airborne)landed=true;
  if(brakeAfterLanding){
   const event=park.events.find(e=>e.piece===p.placement.piece.id);
   const paced=handoffKph===null?Math.abs(v.speed)<.05:Math.abs(v.speed-handoffKph/3.6)<=.1;
   if(event&&landed&&!v.airborne&&paced){
    const yaw=v.heading-p.placement.heading,sin=Math.sin(yaw),cos=Math.cos(yaw),env=spec.envelope;
    let along=0,across=0;for(let j=0;j<env.circles.length;j++){along=Math.max(along,Math.abs(env.circles[j]*cos-(env.circleSides?.[j]??0)*sin)+env.radius);across=Math.max(across,Math.abs(env.circles[j]*sin+(env.circleSides?.[j]??0)*cos)+env.radius);}
    reached=u-along>=r.landing[0]&&u+along<=r.landing[1]+(r.runout??0)&&Math.abs(p.v(v.x,v.z))+across<=r.halfWidth;break;
   }
  }else if(u>(stopAt??r.landing[1]+5)){reached=true;break;}
 }
 const e=park.events.find(e=>e.piece===p.placement.piece.id);
 return{kph,reached,minRigClearance:Number.isFinite(minRigClearance)?minRigClearance:null,airTime:e?.airTime??air,distance:e?.distance??(first!==null?last-first:0),peak,report:e??null,hit:park.contacts-contacts,end:{u:p.u(v.x,v.z),v:p.v(v.x,v.z),x:v.x,z:v.z,speed:v.speed,airborne:v.airborne},nearSolids:reached?[]:[...park.pieces,...park.dressing].flatMap(owner=>owner.solids.filter(s=>Math.hypot(s.x-v.x,s.z-v.z)<Math.hypot(s.half,s.halfWidth)+spec.envelope.reach+1&&s.top>=v.y-.25&&s.bottom<=v.y+spec.height).map(s=>({owner:owner.placement.piece.id,x:s.x,z:s.z,half:s.half,halfWidth:s.halfWidth,bottom:s.bottom,top:s.top})))};
}
if(process.env.STUNT_GUIDANCE_ONLY){
 const rows=[];
 for(const p of park.pieces.filter(p=>(p.placement.piece.route||p.placement.piece.practiceKph)&&(!process.env.STUNT_SPEED_PIECE||p.placement.piece.id===process.env.STUNT_SPEED_PIECE))){
  const id=p.placement.piece.id,g=STUNT_GUIDANCE[id];assert.ok(g,'every route has a visible speed guide');
  for(const [name,spec]of [['car',CAR_SPEC],['truck',TRUCK_SPEC]]){
   const band=g[name];assert.ok(band,'named vehicle guide');
   for(let speed=band[0];speed<=band[1];speed++)for(const offset of [-.3,0,.3]){
    const roll=!!p.placement.piece.practiceKph,r=run(p,spec,speed,offset,roll?p.placement.piece.footprint[2]+spec.halfLength+1:null,!roll,g.handoff?.[name]??null);
    const clean=roll?r.airTime===0:!!r.report&&r.report.obstacleCleared&&Object.values(r.report.landing).every(Boolean)&&(r.report.heightAboveObstacle===null||r.report.heightAboveObstacle>=.1&&Number.isFinite(r.minRigClearance)&&r.minRigClearance>=.1);
    assert.ok(r.reached&&!r.end.airborne&&r.hit===0&&clean,JSON.stringify({id,name,speed,offset,r}));
    rows.push({id,name,speed,offset,clearance:r.report?.heightAboveObstacle??null,rigClearance:r.minRigClearance,handoffKph:g.handoff?.[name]??null,endSpeed:r.end.speed*3.6});
   }
  }
 }
 assert.ok(rows.length,'the selected route was exercised');
 writeFileSync(process.env.STUNT_REPORT_PATH,JSON.stringify({implementationDigest,rows},null,2)+'\n');console.log('PASS guidance',rows.length);process.exit(0);
}
const speedTable=[];
for(const p of park.pieces.filter(p=>p.placement.piece.route)){
 const row={piece:p.placement.piece.id};for(const [name,spec]of [['car',CAR_SPEC],['truck',TRUCK_SPEC]]){
  const runs=[];for(let k=15;k<=180;k+=5)runs.push(run(p,spec,k));const good=runs.filter(r=>r.report?.obstacleCleared&&Object.values(r.report.landing).every(Boolean));
  const groups=[];for(const r of good){const last=groups.at(-1);if(last&&r.kph-last.at(-1).kph===5)last.push(r);else groups.push([r]);}
  const primary=groups.reduce((best,g)=>g.length>best.length?g:best,[]),window=primary.length?[primary[0].kph,primary.at(-1).kph]:null;
  const middle=window?run(p,spec,(window[0]+window[1])/2):null;
  row[name]={window,windows:groups.map(g=>[g[0].kph,g.at(-1).kph]),middle,cleanSpeeds:good.map(r=>r.kph),runs};
 }speedTable.push(row);console.log('SPEED',JSON.stringify({piece:row.piece,car:row.car.window,truck:row.truck.window}));
}
const table=park.pieces.find(p=>p.placement.piece.id==='tabletop');
assert.equal(table.placement.piece.practiceKph,8,'tabletop is explicitly a rolling practice feature');
assert.equal(table.placement.piece.route,undefined,'no unsupported tabletop jump claim');
for(const spec of [CAR_SPEC,TRUCK_SPEC]){const v=vehicles.get(spec),start=table.world(-7,0);v.pitch=v.roll=0;v.place(start.x,start.z,table.placement.heading);const before=park.contacts;let air=false;for(let i=0;i<120*40&&table.u(v.x,v.z)<30;i++){terrain.withGroundContact(v,()=>v.update(dt,{throttle:Math.max(-1,Math.min(1,(8/3.6-v.speed)*2)),steer:0,handbrake:false},()=>park.step(dt,v,false)));air||=v.airborne;}assert.ok(table.u(v.x,v.z)>=30&&!air&&park.contacts===before,'filled tabletop drives slowly end to end');}
// Exercise road protection through the real PNG loader, then remove it as a negative control.
const hwy=roads.nearest(park.pieces[0].placement.x,park.pieces[0].placement.z,1500,r=>r.kind===1);
assert.ok(hwy,'mapped road probe exists');
async function roadProbe(mode){const {terrain:t}=makeGround();if(mode!==null)t.sites.push({box:[hwy.x-20,hwy.z-20,hwy.x+20,hwy.z+20],preserveRoads:mode,height:(_x,_z,h)=>h+20,surface:()=>({dist:0,half:10,kind:8})});await preload(t,[[hwy.x,hwy.z]],0);return t.heightAt(hwy.x,hwy.z);}
const roadOriginal=await roadProbe(null),roadProtected=await roadProbe(true),roadMutant=await roadProbe(false);
assert.ok(Math.abs(roadOriginal-roadProtected)<1e-6,'mapped road height is untouched');
reject('road protection removed',()=>assert.ok(Math.abs(roadOriginal-roadMutant)<1e-6));
const excluded=park.exclusions,spot=park.pieces[0].world(0,0);
park.exclusions=[{x:spot.x,z:spot.z,radius:60}];assert.equal(park.height(spot.x,spot.z,123),123,'house buffer leaves original land');
park.exclusions=[];reject('house buffer removed',()=>assert.equal(park.height(spot.x,spot.z,123),123));park.exclusions=excluded;
const tank=park.pieces.find(p=>p.placement.piece.id==='tanks').solids[0],probe=vehicles.get(TRUCK_SPEC),resolver=park.step;
const solidProbe=()=>{probe.x=tank.x;probe.z=tank.z;probe.y=tank.bottom+.01;probe.pitch=probe.roll=0;const x=probe.x,z=probe.z;park.step(dt,probe,false);assert.ok(Math.hypot(probe.x-x,probe.z-z)>.01);};
solidProbe();park.step=()=>{};reject('solid resolver removed',solidProbe);park.step=resolver;
// A wide face must stop a vehicle at every heading, not only at the layout's diagonal heading.
const testPiece={id:'collision-fixture',board:['BLACK R.:','CONCRETE'],footprint:[-5,-5,5,5],decks:[],solids:[{u:0,v:0,half:.1,halfWidth:3,bottom:0,top:2.3}]},origin=park.pieces[0].world(2,0),fixturePark=new StuntPark(terrain,[{piece:testPiece,...origin,heading:0}],true),fixture=fixturePark.pieces[0],actor=makeVehicle(terrain,roads,CAR_SPEC);
actor.x=origin.x;actor.z=origin.z;fixturePark.update(0,actor,new THREE.Vector3(origin.x,200,origin.z));const wall=fixture.solids[0];
for(const spec of [CAR_SPEC,TRUCK_SPEC])for(const heading of [0,Math.PI/4,Math.PI/2,Math.PI*.75])for(const [a,b]of [[1,0],[-1,0],[0,1],[0,-1]]){
 const c=vehicles.get(spec);wall.heading=heading;wall.ax=Math.sin(heading);wall.az=-Math.cos(heading);const extent=Math.max(...spec.envelope.circles.map(Math.abs))+spec.envelope.radius;
 c.heading=heading;c.x=wall.x+wall.ax*a*(wall.half+extent-.02)-wall.az*b*(wall.halfWidth+spec.envelope.radius-.02);c.z=wall.z+wall.az*a*(wall.half+extent-.02)+wall.ax*b*(wall.halfWidth+spec.envelope.radius-.02);c.y=wall.bottom+.01;c.pitch=c.roll=0;const x=c.x,z=c.z;fixturePark.step(dt,c,false);assert.ok(Math.hypot(c.x-x,c.z-z)>.001,'wide face at arbitrary heading');
}
wall.heading=0;wall.ax=0;wall.az=-1;
const sideSpec={...CAR_SPEC,envelope:{...CAR_SPEC.envelope,circles:[0],circleSides:[-.9],radius:.2}},sideRide=makeVehicle(terrain,roads,sideSpec);
const sideProbe=()=>{sideRide.heading=0;sideRide.x=wall.x+4.08;sideRide.z=wall.z;sideRide.y=wall.bottom+.01;sideRide.pitch=sideRide.roll=0;const x=sideRide.x;fixturePark.step(dt,sideRide,false);assert.ok(sideRide.x-x>.001,'outboard circle reaches the face');};
sideProbe();sideSpec.envelope.circleSides=[0];reject('side-offset circles omitted',sideProbe);sideSpec.envelope.circleSides=[-.9];
const flipSpec={...CAR_SPEC,track:0,halfLength:1.3,halfWidth:.55,height:2.1,envelope:{...CAR_SPEC.envelope,circles:[-.75,0,.75],radius:.55}},flip=makeVehicle(terrain,roads,flipSpec);
const flipProbe=()=>{flip.heading=0;flip.x=wall.x;flip.z=wall.z-.2;flip.y=wall.bottom+2;flip.pitch=Math.PI/2;flip.roll=0;const x=flip.x,z=flip.z;fixturePark.step(dt,flip,false);assert.ok(Number.isFinite(flip.x)&&Number.isFinite(flip.z)&&Math.hypot(flip.x-x,flip.z-z)>.01,'flipping ride has a finite collision span');};
flipProbe();flipSpec.track=CAR_SPEC.track;reject('upright plane used during a flip',flipProbe);flipSpec.track=0;
terrain.sites.splice(terrain.sites.indexOf(fixturePark),1);
const lowPark=new StuntPark(terrain,testParkLayout(measuredPark.yard),true,[],testParkDressing(measuredPark.yard)),p0=lowPark.pieces[0].world(0,0),dummy=makeVehicle(terrain,roads,CAR_SPEC);dummy.x=p0.x;dummy.z=p0.z;lowPark.update(0,dummy,new THREE.Vector3(p0.x,200,p0.z));
terrain.sites.splice(terrain.sites.indexOf(lowPark),1);
const physics=park.pieces.map(p=>({id:p.placement.piece.id,deckHash:createHash('sha256').update(Buffer.concat(p.decks.map(d=>Buffer.from(d.ys.buffer)))).digest('hex'),solids:p.solids}));
const report={physics,implementationDigest,sampling:{exag:1.5,speedStepKph:5,maxKph:180,presetRunupMetres:7},layout:park.pieces.map(p=>({id:p.placement.piece.id,x:p.placement.x,z:p.placement.z,heading:p.placement.heading,footprint:p.placement.piece.footprint})),geometry:results,mutations,trick:event,speedTable,desktop:{triangles:park.triangles,drawCalls:park.drawCalls},low:{triangles:lowPark.triangles,drawCalls:lowPark.drawCalls}};
writeFileSync(process.env.STUNT_REPORT_PATH??'../data/work/west-bay/stunts/stunt-check.json',JSON.stringify(report,null,2)+'\n');console.log('PASS stunts node checks',JSON.stringify(report.desktop),JSON.stringify(report.low));
