// Real mapped underpasses, production rides/towing, and production camera/park blocks.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {readFileSync} from 'node:fs';
import {fixture,rig,dispose,root,line} from './bridges-fixture.mjs';
import {cameraFixture} from './bridges-camera-fixture.mjs';
const cases=JSON.parse(readFileSync(root+'tools/fixtures/bridge-underpasses.json')).filter(c=>!process.env.BRIDGE_CASE||c.name.includes(process.env.BRIDGE_CASE));
const trailerOnly=process.argv.includes('--trailer');
function station(f,c){
 const original=f.roads.nearest(c.x,c.z,30,r=>r.id===c.road);assert.ok(original,'mapped underpass road');const path=line(original.road),span=f.roads.modern.spans.find(r=>r.road.id===c.span);assert.ok(span,'mapped overhead span');
 let along=0;for(let j=0;j<original.seg;j++)along+=Math.hypot(original.road.pts[j+1][0]-original.road.pts[j][0],original.road.pts[j+1][1]-original.road.pts[j][1]);along+=Math.hypot(original.x-original.road.pts[original.seg][0],original.z-original.road.pts[original.seg][1]);
 let distance=Infinity,best=along;for(let d=Math.max(0,along-45);d<=Math.min(path.len,along+45);d+=.1){const p=path.at(d);for(let i=1;i<span.pts.length;i++){const a=span.pts[i-1],b=span.pts[i],dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/n)),gap=Math.hypot(p.x-a[0]-dx*t,p.z-a[1]-dz*t);if(gap<distance){distance=gap;best=d;}}}
 assert.ok(distance<span.width,'the two mapped corridors really intersect');const p=path.at(best),hit=f.roads.nearest(p.x,p.z,2,r=>r.id===c.road);return{hit,path,along:best};
}
function ride(f,kind){return kind==='bike'?new f.BikeRide(f.createBike(),f.terrain,f.roads,-1000):kind==='trailer'?new f.Vehicle(f.createTruck(),f.terrain,f.roads,-1000,f.TRUCK_SPEC):new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);}
async function prepare(c,replacements={}){const f=await fixture(c.area,1,replacements),s=station(f,c),pts=[];for(let d=-110;d<=110;d+=10){const p=s.path.at(s.along+d);pts.push([p.x,p.z]);}await f.load(pts);f.roads.update(new THREE.Vector3(c.x,10,c.z));for(const t of f.terrain.tiles.values()){t.mesh.visible=true;t.mesh.updateMatrixWorld(true);}const upper=f.roads.modern.spans.find(r=>r.road.id===c.span);assert.ok(upper,'mapped overhead span retained');await f.load(upper.pts);f.roads.update(new THREE.Vector3(c.x,10,c.z));const ground=f.roads.modern.query(s.hit.x,s.hit.z,false,false,undefined,false,1,false)??f.terrain.landHeightAt(s.hit.x,s.hit.z),deck=f.roads.deckHeight(s.hit.x,s.hit.z);assert.ok(deck!==null&&deck-ground>2,`${c.name}: a real overhead deck must be present`);
 let painted=0;for(let d=-25;d<=25;d+=.5){const p=s.path.at(s.along+d);for(const side of[-2,-1,0,1,2]){const x=p.x+Math.cos(p.heading)*side,z=p.z+Math.sin(p.heading)*side,t=f.terrain.find(x,z);if(!t?.road||!t.mesh)continue;const k=(Math.round((z-t.z0)/t.size*256)*257+Math.round((x-t.x0)/t.size*256))*4,cpu=t.road[k+2]&15,gpu=t.mesh.material.uniforms.tRoad.value.image.data[k+2]&15;if(cpu){painted++;assert.ok(gpu>0,c.name+': lower-road paint lost');}}}assert.ok(painted>400,c.name+': real lower-road texels checked');return{f,...s,ground,deck};}
async function drive(c,kind,speed,dir,replacements={}){
 const {f,hit,path,along}=await prepare(c,replacements),p=path.at(along-dir*70),heading=p.heading+(dir<0?Math.PI:0),v=ride(f,kind);v.assist=0;let startY=f.terrain.heightAt(p.x,p.z);for(const span of f.roads.modern.spans)if(span.members.has(c.road)||span.road.sourceRoad===c.road){const y=f.roads.modern.ownHeight(span,p.x,p.z);if(y!==null)startY=y;}v.place(p.x,p.z,heading,startY);
 const cum=[0];for(let i=1;i<hit.road.pts.length;i++)cum.push(cum.at(-1)+Math.hypot(hit.road.pts[i][0]-hit.road.pts[i-1][0],hit.road.pts[i][1]-hit.road.pts[i-1][1]));
 const tow=kind==='trailer'?new f.Towing(v,f.terrain,f.roads,true):null;if(tow)assert.ok(tow.attached,'trailer attaches before crossing');
 v.vx=Math.sin(heading)*speed;v.vz=-Math.cos(heading)*speed;v.speed=speed;
 let closest=Infinity,worst=0,overhead=0;const random=Math.random;Math.random=()=>.5;
 try{for(let i=0;i<Math.ceil(160/speed*120);i++){
  const g=f.roads.nearest(v.x,v.z,30,r=>r.id===c.road),target=g?path.at(cum[g.seg]+(cum[g.seg+1]-cum[g.seg])*g.t+dir*(speed<10?4:8)):null,h=target?Math.atan2(target.x-v.x,v.z-target.z):v.heading,err=Math.atan2(Math.sin(h-v.heading),Math.cos(h-v.heading));
  f.terrain.withGroundContact(v,()=>v.update(1/120,{throttle:Math.max(-1,Math.min(1,(speed-v.speed)*.3)),steer:Math.max(-.5,Math.min(.5,err*2)),handbrake:false},tow?()=>tow.step():undefined));
  const body=tow??v,d=Math.hypot(body.x-hit.x,body.z-hit.z);closest=Math.min(closest,d);
  if(d<12){const land=f.roads.modern.query(body.x,body.z,false,false,undefined,false,1,false)??f.terrain.landHeightAt(body.x,body.z),deck=f.roads.deckHeight(body.x,body.z);if(deck!==null&&deck-land>1)overhead++;worst=Math.max(worst,body.y-land);}
 }}finally{Math.random=random;}
 assert.ok(closest<4,`${kind} reaches ${c.name}: ${closest}; speed=${speed} dir=${dir} pos=${v.x},${v.z} actualSpeed=${v.speed} crashes=${v.crashes} crashTime=${v.crashTime} sunk=${v.sunk}`);assert.ok(overhead>0,`${kind} actually passes below a deck`);assert.ok(worst<(tow?.5:.2),`${kind} under-deck lift ${worst}m: ${c.name}`);
 console.log(`PASS ${kind}/${c.name} ${speed}m/s dir${dir}: max over road ${worst.toFixed(4)}m`);dispose(f);
}
async function readers(c,replacements={}){
 const {f,hit,ground,deck}=await prepare(c,replacements),cam=await cameraFixture(replacements['web/src/main.ts']),v=ride(f,'car');
 assert.equal(f.terrain.heightAt(hit.x,hit.z),ground,'unreferenced height returns LAND');assert.equal(f.terrain.surfaceAt(hit.x,hit.z).ground,ground,'unreferenced surface returns LAND');
 f.terrain.withGroundContact({y:deck+20},()=>assert.equal(f.terrain.heightAt(hit.x,hit.z),ground,'ambient contact scope cannot lift an unreferenced reader'));
 assert.ok(Math.abs(f.terrain.heightAt(hit.x,hit.z,deck)-deck)<.001,'a thing already at deck height receives the deck');
 for(const kind of['car','bike']){
  const b=ride(f,kind);b.place(hit.x,hit.z,hit.heading);assert.ok(Math.abs(b.y-ground)<.2,`${kind} default placement uses land`);
  b.place(b.x,b.z,b.heading,b.y);assert.ok(Math.abs(b.y-ground)<.2,`${kind} re-place stays below deck`);
  b[kind==='bike'?'roadTrail':'trail']=[{x:hit.x,z:hit.z,heading:hit.heading,y:ground}];b.respawn();assert.ok(Math.abs(b.y-ground)<.2,`${kind} respawn stays below deck`);
  b.place(hit.x,hit.z,hit.heading,deck);assert.ok(Math.abs(b.y-deck)<.2,`${kind} explicit owned deck placement stays on its wheel support: ${b.y-deck}`);const ownedY=b.y;
  b[kind==='bike'?'roadTrail':'trail']=[{x:hit.x,z:hit.z,heading:hit.heading,y:ownedY}];b.respawn();assert.ok(Math.abs(b.y-ownedY)<.01,`${kind} safe pose preserves the owned deck`);
 }
 // Place the chase target so the camera's ground sample is exactly at the crossing.
 v.place(hit.x+Math.sin(hit.heading)*v.spec.chase.back,hit.z-Math.cos(hit.heading)*v.spec.chase.back,hit.heading,ground);const chase=cam.makeChase(v,f.terrain,f.roads);chase.chase(1);assert.ok(chase.camera.position.y<v.y+v.spec.chase.height+.5,'production chase camera is not lifted by an overhead deck');
 const bike=ride(f,'bike');bike.place(hit.x,hit.z,hit.heading,ground);bike.car.root.updateMatrixWorld(true);const camera=new THREE.PerspectiveCamera(),bc=new f.BikeCamera(bike,f.terrain);bc.update(camera,1,'seat',true);assert.ok(camera.position.y<deck-.5,'production bike seat stays below deck');bc.update(camera,1,'chase',true);assert.ok(camera.position.y<bike.y+bike.spec.chase.height+.5,'production bike chase uses rider height');
 for(const y of[ground,deck])for(const waiting of[false,true]){v.place(hit.x,hit.z,hit.heading,y);cam.hold(v,f.terrain,waiting,waiting?0:1);assert.ok(Math.abs(v.y-y)<.01,'production animal/waiting re-place preserves its height');}
 // Water beneath a real canal deck remains water for a body below that deck. The on-deck
 // surface gate controls this production behaviour even where road-field kinds are the same.
 if(c.area==='cansocauseway'&&c.span===-100094){
  const span=f.roads.modern.spans.find(r=>r.road.id===35);await f.load(span.pts);f.roads.update(new THREE.Vector3(span.pts[0][0],10,span.pts[0][1]));let wet=null;
  for(let s=1;s<span.length-1&&!wet;s++){const p=f.roads.modern.at(span,s),land=f.terrain.heightAt(p.x,p.z),deck=f.roads.deckHeight(p.x,p.z);if(land<f.terrain.seaLevel-.25&&deck!==null&&deck-land>1)wet={...p,land};}
  assert.ok(wet,'real water under canal deck witness');// Main's #130 refuses a placement in water: the deck overhead must not make that water dry ground. The body is then
  // set in the water directly (as if it drove there) to test the step's own water gate.
  const swimmer=new f.Vehicle(rig(THREE),f.terrain,f.roads,f.terrain.seaLevel);assert.equal(swimmer.place(wet.x,wet.z,0,wet.land),false,'a deck overhead does not make the water under it a dry placement (car)');
  Object.assign(swimmer,{x:wet.x,z:wet.z,y:wet.land,heading:0});swimmer.update(1/120,{throttle:0,steer:0,handbrake:true});assert.ok(swimmer.sunk>0,'car on-deck surface gate must not suppress water below a deck');
  const subBike=new f.BikeRide(f.createBike(),f.terrain,f.roads,f.terrain.seaLevel);assert.equal(subBike.place(wet.x,wet.z,0,wet.land),false,'a deck overhead does not make the water under it a dry placement (bike)');
  Object.assign(subBike,{x:wet.x,z:wet.z,y:wet.land,heading:0});subBike.ready=subBike.capture();assert.ok(subBike.ready,'the bike in the water has wheel support');subBike.update(1/120,{throttle:0,steer:0,handbrake:true});assert.ok(subBike.sunk>0,'source bridge bit is not physical bike support');
 }
 console.log('PASS readers/placement/cameras: '+c.name);dispose(f);
}
if(trailerOnly){for(const c of cases.filter(c=>c.trailer))for(const dir of[1,-1])await drive(c,'trailer',12,dir);}
else for(const c of cases){for(const kind of['car','bike'])for(const speed of[20,6])for(const dir of[1,-1])await drive(c,kind,speed,dir);await readers(c);}
if(process.argv.includes('--mutations')){
 const mutants=trailerOnly?[['web/src/towing.ts','deckCounts(deck,this.groundPoint.y,this.terrain.cartRoads) ? Math.max(g,deck) : g','deck !== null ? Math.max(g,deck) : g','trailer','trailer gate']]:[
 ['web/src/vehicle.ts','this.reach(deck,referenceY) ? Math.max(deck, g) : g','deck !== null ? Math.max(deck, g) : g','car','car wheel gate'],
 ['web/src/bike-ride.ts','deckCounts(deck,referenceY,this.terrain.cartRoads) ? Math.max(g,deck) : g','deck !== null ? Math.max(g,deck) : g','bike','bike gate'],
 ['web/src/vehicle.ts','siteDeck || this.reach(this.roads.deckHeight(this.x, this.z),this.y)','siteDeck || this.roads.deckHeight(this.x, this.z)!==null','surface','car on-deck gate']];
 for(const[file,anchor,replacement,kind,name]of mutants){const source=readFileSync(root+file,'utf8');assert.equal(source.split(anchor).length,2,name+' anchor');const rep={[file]:source.replace(anchor,replacement)};await assert.rejects(()=>kind==='surface'?readers(cases[0],rep):drive(cases[0],kind,kind==='trailer'?12:20,1,rep),kind==='surface'?/car on-deck surface gate/:/under-deck lift/,name+' removal must fail');console.log('KILLED '+name+' removed');}
 if(!trailerOnly){
  const file='web/src/modern-bridges.ts',s=readFileSync(root+file,'utf8'),anchor='if(contact&&r.triangleDeck[k/9]===1&&!deckWithinReach(y,referenceY))continue;';assert.equal(s.split(anchor).length,2);await assert.rejects(()=>drive(cases[0],'car',20,1,{[file]:s.replace(anchor,'')}),/under-deck lift/,'terrain contact gate removal');console.log('KILLED terrain contact gate removed');
  const terrain='web/src/terrain.ts',t=readFileSync(root+terrain,'utf8'),rep=t;
  const wrong=s.replace('this.contactHeightAt(x,z,referenceY)','this.deckHeightAt(x,z)');assert.notEqual(wrong,s);await assert.rejects(()=>readers(cases[0],{[terrain]:rep,[file]:wrong}),/unreferenced height returns LAND/,'unreferenced query must not take a deck');console.log('KILLED unreferenced query takes deck');
  const paint='deckMask:(x,z,kind)=>this.maskPaint(x,z,kind)';assert.equal(s.split(paint).length,2);await assert.rejects(()=>prepare(cases[0],{[file]:s.replace(paint,'deckMask:(x,z,kind)=>this.isSpan(x,z,kind)')}),/lower-road paint lost/);console.log('KILLED lower-road paint masking');
 }
}
