// R3 review regressions: production call sites/classes and the review's real-land cases.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import ts from '../web/node_modules/typescript/lib/typescript.js';
import {fixture,rig,dispose,areas,root} from './bridges-fixture.mjs';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {pathToFileURL} from 'node:url';
import './bridges-height-wire-check.mjs';
const read=p=>readFileSync(root+p,'utf8'),results=[];
function calls(source){const ast=ts.createSourceFile('animals.ts',source,ts.ScriptTarget.Latest,true),out=[];function walk(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='place'&&['v','vehicle'].includes(n.expression.expression.getText(ast)))out.push({text:n.getText(ast),short:n.expression.getText(ast)+'('+n.arguments.slice(0,3).map(n=>n.getText(ast)).join(', ')+')'});ts.forEachChild(n,walk);}walk(ast);return out;}
async function ownership(replacements={}){
 const f=await fixture('cansocauseway',1,replacements),M=f.roads.modern,r=M.spans.find(r=>r.road.id===54),p=M.at(r,r.length/2);await f.load([[p.x,p.z]]);f.roads.update(new THREE.Vector3(p.x,100,p.z));const deck=f.roads.deckHeight(p.x,p.z),land=f.terrain.heightAt(p.x,p.z);assert.ok(deck-land>5);
 const v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000),source=replacements['web/src/animals.ts']??read('web/src/animals.ts');
 for(const c of calls(source)){v.place(p.x,p.z,p.yaw,deck);const y=v.y,ctx={lastVehicle:{x:v.x,z:v.z}};
  Function('v','vehicle','s','rx','rz','fx','fz','shift','moveX','moveZ','t',c.text).call(ctx,v,v,{x:p.x,z:p.z,heading:p.yaw},1,0,0,1,.25,.25,.25,.5);
  assert.ok(Math.abs(v.y-y)<.04,'animal re-place keeps deck: '+c.text);
 }
 v.place(p.x,p.z,p.yaw,deck);v.stuck=true;v.update(1/120,{throttle:0,steer:0,handbrake:true});assert.ok(Math.abs(v.y-deck)<.04,'stuck re-place keeps deck');
 // A retry while land loads keeps the placement's own height, not a stale height from the old place (here: the deck).
 v.place(p.x,p.z,p.yaw,land);v.stuck=true;v.y=deck;assert.equal(v.retryHeight,land,'stale stuck height: a retry while land loads uses the placement reference');v.update(1/120,{throttle:0,steer:0,handbrake:true});assert.ok(Math.abs(v.y-land)<.2,'stale stuck height stays under the deck: '+(v.y-land));
 // A height-free placement (?at=, a visit or mailbox start, restart) stands on the deck its point lies on, but under an
 // overpass, where the nearest road is not one the span carries, it stays on land.
 v.placeAt(p.x,p.z,p.yaw);assert.ok(Math.abs(v.y-deck)<.04,'height-free placement on Canso54 takes its deck: '+(v.y-deck));
 {const bike=new f.BikeRide({root:new THREE.Group(),pose(){},driverEye:new THREE.Object3D()},f.terrain,f.roads,-1000);bike.restart(p.x,p.z,p.yaw);assert.ok(Math.abs(bike.y-deck)<.04,'bike restart takes its deck: '+(bike.y-deck));}
 {const nearest=f.roads.nearest;f.roads.nearest=(x,z,reach,...args)=>reach===8?{x:p.x,z:p.z,heading:p.yaw,road:{id:-999999,kind:1,bridge:false}}:nearest.call(f.roads,x,z,reach,...args);
  try{v.placeAt(p.x,p.z,p.yaw);assert.ok(Math.abs(v.y-land)<.2,'height-free placement under an overpass stays on land: '+(v.y-land));}finally{f.roads.nearest=nearest;}}
 // Cold load: the deck is not built yet when the placement is made (coarse land comes first). The car stands on land,
 // a retry while land loads asks again (and keeps asking), and so does the parked hold before the first pedal, so the
 // car rises onto the deck once it builds. The bike follows the same rule.
 {const deckHeight=f.roads.deckHeight;
  for(const [label,ride] of[['car',v],['bike',new f.BikeRide({root:new THREE.Group(),pose(){},driverEye:new THREE.Object3D()},f.terrain,f.roads,-1000)]]){
   f.roads.deckHeight=()=>null;
   try{ride.placeAt(p.x,p.z,p.yaw);assert.ok(Math.abs(ride.y-land)<.2,label+' cold placement stands on land first: '+(ride.y-land));
    ride.stuck=true;ride.ready=false;ride.retryPlace();ride.parkedPlace(ride.x,ride.z,ride.heading,ride.y);assert.ok(Math.abs(ride.y-land)<.2,label+' no deck yet: still on land');}
   finally{f.roads.deckHeight=deckHeight;}
   ride.stuck=true;ride.ready=false;assert.ok(Math.abs(ride.retryHeight-deck)<.04,label+' cold placement retry asks for the deck again: '+ride.retryHeight);ride.stuck=false;
   ride.parkedPlace(ride.x,ride.z,ride.heading,ride.y);assert.ok(Math.abs(ride.y-deck)<.04,label+' cold placement rises onto the built deck while parked: '+(ride.y-deck));
   ride.parkedPlace(ride.x,ride.z,ride.heading,ride.y);assert.ok(Math.abs(ride.y-deck)<.04,label+' parked on the deck stays there');
   // A flag left by an earlier land start must not lift a car that was moved since (a refused jump while parked).
   f.roads.deckHeight=()=>null;try{ride.placeAt(p.x+3,p.z,p.yaw);}finally{f.roads.deckHeight=deckHeight;}ride.x=p.x;ride.z=p.z;ride.y=land;
   ride.parkedPlace(p.x,p.z,p.yaw,land);assert.ok(Math.abs(ride.y-land)<.2,label+' a moved car never asks for a deck again: '+(ride.y-land));
  }}
 // A road bridge keeps the light road help (a wharf or slip ramp turns it off): a car 0.2 rad off the line steers back.
 {const road=f.roads.nearest(p.x,p.z,9,r=>r.kind<=3);assert.ok(road,'Canso54 deck has a public road for the help');const s=f.terrain.surfaceAt(p.x,p.z,deck);assert.ok(s.deck&&s.roadDeck,'bridge deck surface is a road deck');
  v.place(p.x,p.z,road.heading+.2,deck);v.vx=Math.sin(v.heading)*15;v.vz=-Math.cos(v.heading)*15;v.speed=15;v.update(1/120,{throttle:0,steer:0,handbrake:false});assert.ok(Math.abs(v.lightHelpYaw)>1e-4,'road help on a bridge deck: '+v.lightHelpYaw);}
 // Force each public-road fallback to select this real deck position. Recovered
 // source ways can remain unflagged; the placement caller must preserve ownership.
 const nearest=f.roads.nearest,bounds=v.bounds;
 for(const far of[false,true]){v.place(p.x,p.z,p.yaw,deck);v.trail.length=0;v.lastGood=null;v.bounds=[p.x-1000,p.z-1000,p.x+1000,p.z+1000];
  // Road 54 is carried by this span, and the hit lies on it: the respawn takes the deck. An uncarried road under the same
  // point (an overpass above a ground road), or road 54 where its carrying span is elsewhere (a source road runs for
  // kilometres), stands on land, never on the deck overhead. The car's own height never decides it (here it is low).
  const runs=f.roads.bridgeRuns.bind(f.roads),away=runs().map(run=>({...run,pts:run.pts.map(([x,z])=>[x+500,z])}));
  for(const [kind,id,elsewhere] of[['carried',54,false],['uncarried',-999999,false],['carried elsewhere',54,true]]){v.place(p.x,p.z,p.yaw,land);v.resetVisit();// main's #130 tries its safe points (here the land pose just placed) before the fallbacks: clear them too
   
   const hit={x:p.x,z:p.z,heading:p.yaw,road:{id,kind:1,bridge:false}};f.roads.nearest=(x,z,reach,...args)=>reach===900?(far?null:hit):reach===2000?hit:nearest.call(f.roads,x,z,reach,...args);
   if(elsewhere)f.roads.bridgeRuns=()=>away;
   try{v.respawn();if(kind==='carried')assert.ok(Math.abs(v.y-deck)<.04,'fallback respawn keeps owned deck '+(far?'bounds':'nearest'));else assert.ok(Math.abs(v.y-land)<.2,`fallback respawn under an overpass stays on land (${kind}) `+(far?'bounds':'nearest')+': '+(v.y-land));}finally{f.roads.nearest=nearest;delete f.roads.bridgeRuns;}
  }
  v.bounds=bounds;
 }
 const storage=new Map(),saved={location:globalThis.location,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage};
 globalThis.location={search:'?area=cansocauseway',hostname:'localhost',pathname:'/cansocauseway',reload(){}};globalThis.localStorage=globalThis.sessionStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 try{v.place(p.x,p.z,p.yaw,deck);f.vehicleChoice('car',v).choose('bike');const b=new f.BikeRide(f.createBike(),f.terrain,f.roads,-1000);assert.equal(f.restoreVehiclePose(b),true);assert.ok(Math.abs(b.y-deck)<.15,'switch keeps saved deck height');b.ready=false;b.update(1/120,{throttle:0,steer:0,handbrake:true});assert.ok(Math.abs(b.y-deck)<.15,'bike not-ready re-place keeps deck');}finally{Object.assign(globalThis,saved);}
 console.log('PASS D1 Canso54 actual animal calls, stuck retry, car/bike switch and bike retry; deck',deck,'land',land);dispose(f);
}
async function approaches(replacements={}){let n=0,worst=0;for(const area of areas){const f=await fixture(area,1.5,replacements),M=f.roads.modern;await f.load(M.spans.flatMap(r=>r.pts));for(const r of M.spans)f.roads.update(new THREE.Vector3(r.pts[0][0],20,r.pts[0][1]));const v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000),b=new f.BikeRide(f.createBike(),f.terrain,f.roads,-1000);
 for(const r of M.spans)for(const[a,z]of[[-r.startLength,-.5],[r.length+.5,r.length+r.endLength]])for(let s=a;s<=z;s++){const p=M.at(r,s),h=M.ownHeight(r,p.x,p.z);if(h===null)continue;for(const ride of[v,b]){ride.place(p.x,p.z,Math.atan2(Math.sin(p.yaw),-Math.cos(p.yaw)));worst=Math.max(worst,h-ride.y);assert.ok(ride.y>=h-.15,'unknown approach placement stands on road');}n++;}dispose(f);}
 console.log('PASS D1 approaches',n,'both rides; maximum below',worst);results.push({item:'D1',approachSamples:n,worst});}
const otherFiles=['web/src/fishing.ts','web/src/yard-job.ts','web/src/shift-demo.ts'];
function liveCalls(file,source=read(file)){
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),out=[];
 function walk(n){if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='place'&&['c','car','vehicle'].includes(n.expression.expression.getText(ast)))out.push({text:n.getText(ast),short:n.expression.getText(ast)+'('+n.arguments.slice(0,3).map(n=>n.getText(ast)).join(', ')+')',receiver:n.expression.expression.getText(ast),ref:n.arguments[3]?.getText(ast)});ts.forEachChild(n,walk);}walk(ast);return out;
}
async function otherLive(replacements={}){
 const f=await fixture('cansocauseway',1),M=f.roads.modern,r=M.spans.find(r=>r.road.id===54),p=M.at(r,r.length/2);await f.load([[p.x,p.z]]);f.roads.update(new THREE.Vector3(p.x,100,p.z));const deck=f.roads.deckHeight(p.x,p.z),v=new f.Vehicle(rig(THREE),f.terrain,f.roads,-1000);
 for(const file of otherFiles)for(const call of liveCalls(file,replacements[file]??read(file))){v.place(p.x,p.z,p.yaw,deck);Function('c','car','vehicle','p',`${call.receiver}.place(p.x,p.z,p.yaw${call.ref?','+call.ref:''})`)(v,v,v,p);assert.ok(Math.abs(v.y-deck)<.04,'other live re-place keeps deck: '+file);}
 dispose(f);console.log('PASS D1 fishing, yard and both demo call height arguments on real Canso54');
}
async function ghosts(replacements={}){const f=await fixture('mabou',1),M=f.roads.modern,r=M.spans.find(r=>r.road.id===28);await f.load(r.pts);f.roads.update(new THREE.Vector3(r.pts[0][0],10,r.pts[0][1]));const file='web/src/mp/ghosts.ts';
 const out=await build({stdin:{contents:`export {Ghosts} from './${file}';export * as wire from './web/src/mp/wire.ts';`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',plugins:[{name:'actual-ghost',setup(b){b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(root+'web/node_modules/three/build/three.module.js').href,external:true}));if(replacements[file])b.onLoad({filter:/mp\/ghosts.ts$/},()=>({contents:replacements[file],loader:'ts'}));}}]});
 const{canvasStub}=await import('./mp-models-build.mjs');canvasStub();globalThis.innerWidth??=1280;globalThis.innerHeight??=720;   // Ghosts.arrangeLabel places name tags in window pixels (#74)
 const{Ghosts,wire}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64')),lookups=[],g=new Ghosts({low:false,cap:2,ground:(x,z,y)=>{lookups.push(y);return f.terrain.heightAt(x,z,y);}}),cam=new THREE.PerspectiveCamera(48,1,.3,4000);
 for(const level of['deck','land'])for(let s=r.length*.25;s<=r.length*.75;s+=r.length*.125){const p=M.at(r,s),y=level==='deck'?f.roads.deckHeight(p.x,p.z):f.terrain.landHeightAt(p.x,p.z);cam.position.set(p.x,20,p.z+30);cam.lookAt(p.x,0,p.z);cam.updateMatrixWorld();const state={flags:0,steer:0,heading:p.yaw,t:1,x:p.x,z:p.z,vx:0,vz:0,air:0,y},body=wire.checkState(wire.encodeState(state,true),20000);assert.ok(body);const encoded=wire.encodeSnapshot([{id:level==='deck'?7:8,body}],true),decoded=wire.decodeSnapshot(encoded)[0].state;lookups.length=0;g.update(1/60,[{...decoded,id:level==='deck'?7:8,name:'Peer',hue:1,speed:15,alpha:1}],cam);assert.ok(Math.abs(lookups[0]-decoded.y)<.001,'ghost selection uses sender height on its first lookup');const slot=g.slots.find(q=>q.id===(level==='deck'?7:8));assert.ok(Math.abs(slot.y-y)<.15,'fresh ghost follows sender reported '+level+' height');}
 const p=M.at(r,r.length/2),deck=f.roads.deckHeight(p.x,p.z),land=f.terrain.landHeightAt(p.x,p.z),multi=new Ghosts({low:false,cap:2,ground:(x,z,y)=>f.terrain.heightAt(x,z,y)});
 try{
  cam.position.set(p.x,land-20,p.z+30);cam.lookAt(p.x,land,p.z);cam.updateMatrixWorld();
  const peer=(id,y)=>({id,y,x:p.x,z:p.z,heading:p.yaw,name:'Peer',hue:1,speed:15,alpha:1,flags:0,steer:0,air:0});
  multi.update(1/60,[peer(71,deck),peer(72,land)],cam);assert.equal(multi.drawn,2);
  const matrix=new THREE.Matrix4();for(const [rank,y]of[[0,land],[1,deck]]){multi.cars.getMatrixAt(rank,matrix);assert.ok(Math.abs(matrix.elements[13]-y)<.15,'ranked ghost keeps its own height through insertion');}
 }finally{multi.dispose();}
 assert.equal(wire.encodeState({flags:0,steer:0,heading:0,t:0,x:0,z:0,vx:0,vz:0,air:0}).byteLength,24,'legacy state stays24 bytes');g.dispose();dispose(f);console.log('PASS D2 negotiated wire round trip, ranked and fresh ghosts on/under deck');}
async function guardrails(replacements={}){
 const f=await fixture('cansocauseway',1.5,replacements),events=[];
 f.Roads.prototype.update.call({guardrails:{update:()=>events.push('rails')},modern:{update:()=>events.push('bridges')}},new THREE.Vector3());
 assert.deepEqual(events,['rails','bridges'],'guardrails update before modern early return');
 const M=f.roads.modern,r=M.spans.find(r=>r.road.id===54);await f.load(r.pts);f.roads.update(new THREE.Vector3(r.pts[0][0],100,r.pts[0][1]));
 const access=f.railAccess({bridgeArea:(...args)=>f.roads.bridgeArea(...args),nearest:()=>null},()=>0,undefined,false);
 for(const s of[-r.startLength/2,r.length/2,r.length+r.endLength/2]){const p=M.at(r,s);assert.equal(access(r.road,{...p,heading:p.yaw,along:s}),true,'guardrails skip deck and both approaches');}
 assert.equal(access(r.road,{x:20000,z:20000,heading:0,along:0}),false,'bridge exclusion does not remove unrelated rails');
 dispose(f);console.log('PASS merge: guardrail update order and real deck/approach exclusions');
}
await ownership();await approaches();await ghosts();await guardrails();await otherLive();
if(process.argv.includes('--mutations')){
 const file='web/src/animals.ts',source=read(file);for(const c of calls(source)){await assert.rejects(()=>ownership({[file]:source.replace(c.text,c.short)}),/animal re-place keeps deck/);console.log('KILLED D1 '+c.short);}
 for(const[file,from,to,why]of[
 ['web/src/vehicle.ts','const placed = this.place(this.x, this.z, this.heading, deck ?? this.retryHeight);\n    this.placeInfer = infer && deck === undefined;\n    return placed;\n  }\n  private deckReference','const placed = this.place(this.x, this.z, this.heading);\n    this.placeInfer = infer && deck === undefined;\n    return placed;\n  }\n  private deckReference','stuck re-place'],
 ['web/src/vehicle.ts','const placed = this.place(this.x, this.z, this.heading, deck ?? this.retryHeight);\n    this.placeInfer = infer && deck === undefined;\n    return placed;\n  }\n  private deckReference','const placed = this.place(this.x, this.z, this.heading,Number.isFinite(this.y)?this.y:undefined);\n    this.placeInfer = infer && deck === undefined;\n    return placed;\n  }\n  private deckReference','stale stuck height'],
 ['web/src/vehicle.ts','this.tryDryPlace(hit.x, hit.z, this.inward(hit.x, hit.z, hit.heading), this.fallbackReference(hit))','this.tryDryPlace(hit.x, hit.z, this.inward(hit.x, hit.z, hit.heading))','fallback respawn keeps owned deck'],
 ['web/src/vehicle.ts','this.tryDryPlace(near.x, near.z, this.inward(near.x, near.z, near.heading), this.fallbackReference(near))','this.tryDryPlace(near.x, near.z, this.inward(near.x, near.z, near.heading))','fallback respawn keeps owned deck'],
 ['web/src/vehicle.ts','if (!run.roads.has(hit.road.id)) continue;','','under an overpass stays on land'],
 ['web/src/vehicle.ts','<= DECK_REACH) return','<= Infinity) return','fallback respawn under an overpass stays on land \\(carried elsewhere'],
 ['web/src/vehicle.ts','return this.stuck ? (this.inferring','return false ? (this.inferring','stale stuck height'],
 ['web/src/vehicle.ts','const placed = this.place(x, z, heading, this.deckReference(x, z));','const placed = this.place(x, z, heading);','height-free placement on Canso54 takes its deck'],
 ['web/src/vehicle.ts','this.inferring(this.x, this.z) ? this.deckReference(this.x, this.z) ?? this.placeReference : this.placeReference','this.placeReference','car cold placement retry asks'],
 ['web/src/vehicle.ts','    this.placeInfer = infer && deck === undefined;\n    return placed;\n  }\n  private deckReference','    return placed;\n  }\n  private deckReference','car cold placement'],
 ['web/src/vehicle.ts','const infer = this.inferring(x, z), deck = infer ? this.deckReference(x, z) : undefined;','const infer = this.inferring(x, z), deck = undefined;','car cold placement rises onto the built deck'],
 ['web/src/bike-ride.ts','const infer = this.inferring(x, z), deck = infer ? placementDeckReference(this.roads, x, z) : undefined;','const infer = this.inferring(x, z), deck = undefined;','bike cold placement rises onto the built deck'],
 ['web/src/bike-ride.ts','this.#awaitingLoad = true; this.placeAt(x, z, heading); }','this.#awaitingLoad = true; this.place(x, z, heading); }','bike restart takes its deck'],
 ['web/src/vehicle.ts','Math.abs(x - this.inferX) < .5 && Math.abs(z - this.inferZ) < .5;','true;','car a moved car never asks'],
 ['web/src/bike-ride.ts','Math.abs(x - this.inferX) < .5 && Math.abs(z - this.inferZ) < .5;','true;','bike a moved car never asks'],
 ['web/src/vehicle.ts','return hit ? spanDeckReference(roads, hit) : undefined;','return roads.deckHeight(x, z) ?? undefined;','height-free placement under an overpass stays on land'],
 ['web/src/vehicle-choice.ts','y:vehicle.y, when:','when:','switch keeps saved'],
 ['web/src/vehicle-choice.ts','vehicle.place(p.x, p.z, p.heading,p.y)','vehicle.place(p.x, p.z, p.heading)','switch keeps saved'],
 ['web/src/bike-ride.ts','const placed = this.place(this.x, this.z, this.heading, deck ?? this.retryHeight);','const placed = this.place(this.x, this.z, this.heading);','bike not-ready'],
 ['web/src/vehicle.ts','const helpOff=siteDeck&&s.roadDeck!==true;','const helpOff=siteDeck;','road help on a bridge']]){const s=read(file);assert.equal(s.split(from).length,2);await assert.rejects(()=>ownership({[file]:s.replace(from,to)}),new RegExp(why));console.log('KILLED '+why);}
 const file2='web/src/mp/ghosts.ts',s=read(file2),from="const referenceY=this.references[rank];";assert.equal(s.split(from).length,2);await assert.rejects(()=>ghosts({[file2]:s.replace(from,'const referenceY=fresh?undefined:this.references[rank];')}),/fresh ghost follows sender/);console.log('KILLED D2 fresh height removed');
 const choose='if(peer.y!==undefined){';assert.equal(s.split(choose).length,2);await assert.rejects(()=>ghosts({[file2]:s.replace(choose,'if(false){')}),/ghost selection uses sender height/);console.log('KILLED D2 selection height removed');
 const shift='this.references[j]=this.references[j-1];';assert.equal(s.split(shift).length,2);await assert.rejects(()=>ghosts({[file2]:s.replace(shift,'')}),/ranked ghost/);console.log('KILLED D2 ranked height shift removed');
 const mf='web/src/modern-bridges.ts',ms=read(mf),gate='r.triangleDeck[k/9]===1&&';assert.equal(ms.split(gate).length,2);await assert.rejects(()=>approaches({[mf]:ms.replace(gate,'')}),/unknown approach placement stands on road/);console.log('KILLED D1 approaches incorrectly require an owned deck height');
 for(const[file,from,to,label]of[
 ['web/src/roads.ts','this.guardrails?.update(cam);','', 'guardrails update before'],
 ['web/src/guardrail-access.ts','if(roads.bridgeArea?.(p.x,p.z,RAIL.shoulder+.8))return true;','', 'guardrails skip deck']]){const s=read(file);assert.equal(s.split(from).length,2);await assert.rejects(()=>guardrails({[file]:s.replace(from,to)}),new RegExp(label));console.log('KILLED merge '+label);}
 for(const file of otherFiles)for(const call of liveCalls(file)){await assert.rejects(()=>otherLive({[file]:read(file).replace(call.text,call.short)}),/other live re-place keeps deck/);console.log('KILLED D1 '+file+' '+call.receiver);}
}
if(process.env.OUT)writeFileSync(process.env.OUT+'/r3-ownership.json',JSON.stringify(results,null,2)+'\n');
