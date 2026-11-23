// Close-out regressions for the rejected draft: complete bodies, bank refusal and LOD channels.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {StuntPark} from '../web/src/stunt-kit.ts';
import {allStuntPieces} from '../web/src/stunts/index.ts';
import {AreaContacts} from '../web/src/world-contacts.ts';
import {CAR_SPEC} from '../web/src/vehicle-spec.ts';
import {TRUCK_SPEC,createTruck} from '../web/src/truck.ts';
import {SXS_SPEC} from '../web/src/sxs.ts';
import {BIKE_SPEC} from '../web/src/bike.ts';
import {TRAILER_SPEC} from '../web/src/trailer.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {Towing} from '../web/src/towing.ts';
import {tableTop} from '../web/src/stunts/tabletop.ts';
import {tyreContacts} from './tyre-contacts.mjs';

const ground={sites:[],clear:[],exag:1,addTreeClear(){},surveyHeightsAt:async points=>points.map(()=>0),
  meshHeightAt:()=>0,drawnLevelAt:()=>8,surfaceAt:()=>({level:8}),heightAt:()=>0,
  protectedRoadAt:()=>false,siteGroundChangedAt:()=>true};
const actor={x:0,z:0,y:0,heading:Math.PI/2,pitch:0,roll:0,airborne:false,vx:0,vz:0,speed:0,
  spec:CAR_SPEC,car:{root:new THREE.Group()}};
let solids=0,placements=0,lodSamples=0;
for(const low of [false,true])for(const piece of allStuntPieces()){
  const park=new StuntPark({...ground,sites:[]},[{piece,x:0,z:0,heading:Math.PI/2}],low);
  await park.prepare();park.update(0,actor,new THREE.Vector3(0,10,0));
  const placed=park.pieces[0];assert.ok(placed.ready,piece.id+' ready');
  const registry=new AreaContacts();registry.add(park.contactProvider());
  for(const solid of placed.solids){
    // Isolate each volume from neighbouring decks and solids, as in the original review.
    const saved=placed.solids.splice(0),decks=placed.decks.splice(0);placed.solids.push(solid);
    for(const spec of [CAR_SPEC,TRUCK_SPEC,SXS_SPEC,BIKE_SPEC]){
      const body={x:solid.x,z:solid.z,y:Math.min(solid.top-.006,solid.bottom+.01),heading:solid.heading,spec};
      assert.equal(registry.allows(body),false,`${piece.id} rejects an embedded ${spec.halfLength} m body`);
      placements++;
      assert.equal(registry.allows({...body,y:solid.top+.1}),true,'body wholly above volume stays clear');
    }
    placed.solids.splice(0,placed.solids.length,...saved);placed.decks.push(...decks);solids++;
  }
  for(let level=0;level<8;level++)for(const [u,v] of [[0,0],[-18,22.2],[piece.footprint[2]+3,0]]){
    const point=placed.world(u,v),pixels=new Uint8Array([17,27,37,47]);
    assert.equal(park.height(point.x,point.z,123,level),123,'coarse height unchanged');
    assert.equal(park.surface(point.x,point.z,123,level),null,'coarse metadata unchanged');
    assert.equal(park.clearCanopy(point.x,point.z,level),false,'coarse vegetation unchanged');
    park.visualStyle(point.x,point.z,pixels,0,level);assert.deepEqual([...pixels],[17,27,37,47]);
    lodSamples++;
  }
}
const bank={...allStuntPieces()[0],bank:{}};
assert.throws(()=>new StuntPark({...ground,sites:[]},[{piece:bank,x:0,z:0,heading:0}]),/not supported/);
const polarDeck={...allStuntPieces()[0]};polarDeck.decks=[{...polarDeck.decks[0],polar:{inner:10,outer:20}}];
assert.throws(()=>new StuntPark({...ground,sites:[]},[{piece:polarDeck,x:0,z:0,heading:0}]),/not supported/,'a polar (banked) deck is refused too');
// Trailer footprint is deliberately wider/longer than the tow vehicle at the rejected pose.
const piece={id:'tank-fixture',board:['TEST'],footprint:[-10,-10,10,10],decks:[],
  solids:[{u:0,v:0,half:1.5,halfWidth:1.5,bottom:0,top:2.6}]};
const park=new StuntPark({...ground,sites:[]},[{piece,x:0,z:0,heading:0}]);
park.update(0,actor,new THREE.Vector3(0,10,0));
const registry=new AreaContacts();registry.add(park.contactProvider());
// A real Towing footprint is passed through this same registry. No model/controller is required by the seam.
const trailer={x:0,z:0,y:0,heading:0,spec:{...CAR_SPEC,halfLength:TRAILER_SPEC.halfLength,halfWidth:TRAILER_SPEC.halfWidth,envelope:TRAILER_SPEC.envelope,height:2.5},vx:0,vz:0,speed:0,
  car:{root:{position:{x:0,z:0}}}};
assert.equal(registry.allows(trailer),false,'embedded trailer rejected');
const remoteHeightVehicle={spec:CAR_SPEC,y:100,placementGuard:null};
registry.bindVehicle(remoteHeightVehicle,()=>0);
assert.equal(remoteHeightVehicle.placementGuard({x:0,z:0,heading:0}),false,'placement uses destination support, not the old vehicle height');
const revision=registry.revision;registry.resolve(trailer);
assert.ok(Math.hypot(trailer.x,trailer.z)>.01,'trailer motion uses the same solids');
assert.equal(registry.revision,revision,'a query does not change the solid revision');
const towingGround={...ground,sites:[],heightAt:()=>0,landHeightAt:()=>0,
  surfaceAt:()=>({level:8,kind:8,halfWidth:100,roadDist:0,ground:0,canopy:0,bridge:false,washboard:false,brook:99}),
  withGroundContact:(_body,read)=>read(),withContactHeight:(_body,read)=>read()};
const roads={nearest:()=>null,deckHeight:()=>null};
const pickup=new Vehicle(createTruck(),towingGround,roads,-.2,TRUCK_SPEC);pickup.place(0,-10,0);
const coupled=new Towing(pickup,towingGround,roads,true,false,{contacts:registry},false);
assert.equal(coupled.allowsPose({x:0,z:-10,heading:0}),false,'production towing refuses a clear pickup with an embedded trailer');
const unguarded=new Towing(pickup,towingGround,roads,true,false,{},false);
assert.equal(unguarded.allowsPose({x:0,z:-10,heading:0}),true,'removing the shared provider exposes the rejected pair');
const contacts=[];
for(const low of [false,true])for(const oldRise of [false,true]){
  let park,reference=null;
  const terrain={...ground,sites:[],landHeightAt:()=>0,
    withGroundContact(body,read){const old=reference;reference=body;try{return read();}finally{reference=old;}},
    withContactHeight(body,read){return reference?this.withGroundContact(body,read):read();},
    heightAt(x,z){return Math.max(0,park?.deckHeight(x,z,null,reference?reference.y+.25:Infinity)??0);},
    surfaceAt(x,z){return{level:8,kind:9,halfWidth:100,roadDist:0,ground:this.heightAt(x,z),canopy:0,bridge:false,washboard:false,brook:99};}};
  const piece=tableTop();
  if(oldRise)piece.decks=piece.decks.map(d=>({...d,height:(u,v)=>d.height(u,v)*3}));
  park=new StuntPark(terrain,[{piece,x:0,z:0,heading:Math.PI/2}],low);
  park.update(0,actor,new THREE.Vector3(0,10,0));
  assert.ok(park.deckHeight(12,0)!==null&&park.groundHeight(12,0)!==null,'visible filled tabletop supports contact');
  park.pieces[0].group.visible=false;assert.equal(park.deckHeight(12,0),null,'hidden deck is not drivable');assert.equal(park.groundHeight(12,0),null,'hidden filled cap is not ground');park.pieces[0].group.visible=true;
  const rig=createTruck(false,low),v=new Vehicle(rig,terrain,{nearest:()=>null,deckHeight:()=>null},-.2,TRUCK_SPEC);
  v.assist=0;v.place(-7,0,Math.PI/2);
  const step=(throttle,handbrake=false)=>terrain.withGroundContact(v,()=>v.update(1/120,{throttle,steer:0,handbrake},()=>park.step(1/120,v,false)));
  let steps=0;for(;steps<120*60&&v.x<17;steps++)step(Math.max(-1,Math.min(1,(2.2-v.speed)*2)));
  assert.ok(v.x>=17&&steps<120*60,'truck actually reaches the descent');
  for(let i=0;i<600;i++)step(v.speed>.02?-1:0,true);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(300,300).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));floor.updateMatrixWorld(true);park.group.updateMatrixWorld(true);rig.root.updateMatrixWorld(true);
  const wheels=[...Object.entries(rig.wheels),...rig.extraWheels.map((wheel,i)=>['dual-'+i,wheel])].map(([name,wheel])=>({name,wheel,radius:TRUCK_SPEC.wheelRadius}));
  const rows=tyreContacts(THREE,wheels,[floor,park.group]);assert.ok(rows.every(r=>r.ray),'all six tyres have complete drawn-mesh rays');
  const penetration=Math.max(...rows.map(r=>r.penetration)),float=Math.max(...rows.map(r=>r.float));
  if(oldRise)assert.ok(penetration>.04,'original steep profile reproduces the rejected contact');
  else assert.ok(penetration<=.04&&float<=.04,JSON.stringify({low,penetration,float}));
  const transforms=wheels.map(w=>[...w.wheel.position.toArray(),...w.wheel.quaternion.toArray()]);
  park.update(0,v,new THREE.Vector3(0,10,0));assert.deepEqual(wheels.map(w=>[...w.wheel.position.toArray(),...w.wheel.quaternion.toArray()]),transforms,'park never adjusts wheel transforms');
  contacts.push({low,oldRise,penetration,float});
}
function feedback(collide){
  const piece={id:'feedback-fixture',board:['PRACTICE'],footprint:[0,-3,40,3],solids:[],
    decks:[{box:[0,-3,40,3],surface:'concrete',height:()=>1,supports:false}],
    route:{takeoff:10,halfWidth:3,landing:[16,32]}};
  const park=new StuntPark({...ground,sites:[]},[{piece,x:0,z:0,heading:Math.PI/2}]);
  const ride={...actor,car:{root:new THREE.Group()}};park.update(0,ride,new THREE.Vector3(0,10,0));
  for(let i=0;i<240;i++){
    ride.x=6+i*.1;ride.y=i>=35&&i<130?3:1;ride.airborne=i>=35&&i<130;ride.vx=ride.speed=12;
    if(collide&&i===60)park.contacts++;
    park.step(1/120,ride,true);
  }
  return{line:park.lastLine,events:park.events};
}
assert.match(feedback(false).line,/CLEAN/,'clean production judge produces visible verdict');
const failed=feedback(true);assert.match(failed.line,/FAILED.*contact/,'collision cancels scoring and produces visible failure');
assert.equal(failed.events.length,0,'a failed collision is not awarded a jump');
for(const low of [false,true]){
  let tile={level:8,height:0},drawn=8;
  const terrain={...ground,sites:[],surfaceAt:()=>tile?{level:tile.level}:null,
    heightAt:()=>tile?.height??null,meshHeightAt:()=>tile?.height??null,drawnLevelAt:()=>drawn};
  const piece={id:'culled-seat',board:['PRACTICE'],footprint:[0,0,4,4],solids:[],
    decks:[{box:[0,0,4,4],surface:'concrete',height:()=>1,grounded:true,supports:false}]};
  const park=new StuntPark(terrain,[{piece,x:0,z:0,heading:Math.PI/2}],low),ride={...actor,x:2,z:2};
  park.update(0,ride,new THREE.Vector3(2,10,2));const placed=park.pieces[0];assert.ok(placed.ready);
  park.lastLine='culled-seat: CLEAN';
  const update=()=>park.update(0,ride,new THREE.Vector3(2,10,2));
  const shown=()=>{assert.equal(placed.group.visible,true,'built fine seat remains shown');assert.equal(park.hudLine,park.lastLine,'ready seat has no loading flash');assert.equal(park.deckHeight(2,2),1);};
  const hidden=()=>{assert.equal(placed.group.visible,false,'coarse or evicted contact tile hides the seat');assert.equal(park.deckHeight(2,2),null);assert.equal(park.groundHeight(2,2),null);assert.match(park.hudLine,/loading/);};
  drawn=null;update();shown();drawn=8;update();shown();
  drawn=null;update();tile={level:7,height:0};update();hidden();drawn=7;update();hidden();
  drawn=8;update();hidden(); // Drawn fine geometry cannot keep an evicted or coarse contact state alive.
  drawn=7;
  tile={level:8,height:0};update();hidden(); // Cached fine data cannot override an actually drawn coarse tile.
  drawn=8;update();shown();drawn=null;update();shown();tile=null;update();hidden();
  tile={level:7,height:0};drawn=7;update();hidden();tile={level:8,height:0};drawn=8;update();shown();
  drawn=null;const unbuilt=new StuntPark({...terrain,sites:[]},[{piece,x:0,z:0,heading:Math.PI/2}],low);
  unbuilt.update(0,ride,new THREE.Vector3(2,10,2));assert.equal(unbuilt.pieces[0].ready,false,'unbuilt seats still require drawn LOD8');
}
// A re-place onto a ramp deck (respawn passes the trail crumb's height) is judged at that height, not at the land under
// the deck: with the land height the lip solid of a slip kicker refused a crumb on its own deck.
{const references=[];const guard=new StuntPark({...ground,sites:[],heightAt:(_x,_z,reference)=>{references.push(reference);return 0;}},[{piece:allStuntPieces()[0],x:0,z:0,heading:Math.PI/2}],false);
 guard.placementAllowed({x:0,z:0,heading:0,y:1.71},CAR_SPEC);guard.placementAllowed({x:0,z:0,heading:0},CAR_SPEC);
 assert.deepEqual(references,[1.71,undefined],'the park placement guard reads the ground at the pose reference height');}
console.log('PASS stunt close-out',{solids,placements,lodSamples,contacts});
