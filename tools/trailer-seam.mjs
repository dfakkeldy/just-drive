// Integration with lateral collision circles. Synthetic long offsets expose broad-phase omissions;
// real side-by-side offsets exercise yard contact, actor veto, placement and the coupled solver.
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {fixture} from './trailer-regressions.mjs';
import {SXS_SPEC,createSxs} from '../web/src/sxs.ts';
import {TRUCK_SPEC} from '../web/src/truck.ts';
import {pushOut} from '../web/src/parked.ts';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {Yard} from '../web/src/yard.ts';
export function runSeamRegressions(){
 const spec={...SXS_SPEC,hitch:TRUCK_SPEC.hitch},f=fixture({spec}),rig=createSxs();
 assert.equal(f.v.wheelSupport,undefined);assert.equal(typeof rig.setTravel,'function');
 const t=f.make({},false),pose={x:0,z:0,heading:0},wall={x:1.15,z:-1.3,heading:0,half:.06,halfWidth:.04};
 const centreline={...spec,envelope:{...spec.envelope,circleSides:undefined}};
 assert.ok(touchesPlayer(wall,pose,0,spec));assert.ok(!touchesPlayer(wall,pose,0,centreline));
 const scene={rules:{enabled:true},placementSolids:[wall]};t.world.scene=scene;
 assert.equal(t.validPair(pose),false,'placement must see side-offset tyre contact');
 t.place();assert.equal(t.pairClear(),false,'coupled validity must see side-offset tyre contact');
 const wide={...spec,envelope:{...spec.envelope,circles:[0],circleSides:[20],radius:.25}},p={...pose,spec:wide,vx:1,vz:0,speed:1},tiny={x:20.1,z:0,heading:0,half:.01,halfWidth:.01};
 pushOut(p,[tiny],true);assert.notEqual(p.x,0,'coupled broad phase must include lateral reach');
 const site={origin:{x:0,z:0},yaw:0,mode:'invented',box:[-100,-100,100,100],rampBase:null,world:(u,v)=>({x:u,z:v}),local:(x,z)=>({u:x,v:z}),localDir:(x,z)=>({u:x,v:z}),worldDir:(u,v)=>({x:u,z:v}),inProperty:()=>1};
 const yard=new Yard(site,f.terrain,true);yard.built=true;
 const piece={spec:{stage:0,mass:1,kind:'pipe',size:[.08,.08,.08]},mesh:new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial()),slot:0,p:new THREE.Vector3(1.4,0,-1.3),yaw:0,vel:new THREE.Vector3(),spin:0,tip:0,moving:false,cool:1,halfLen:.04,rad:.04};yard.pieces=[piece];
 assert.ok(yard.allowsBody(pose,spec));const restore=yard.captureTowMotion([{...pose,spec}]);piece.p.x=1.12;
 assert.equal(yard.allowsBody(pose,spec),false,'loose piece placement must use lateral circles');
 assert.equal(yard.allowsBody(pose,centreline),true,'fixture must isolate lateral circle');
 restore();assert.equal(piece.p.x,1.4,'entering loose piece must be vetoed at lateral circle');
 t.world={yard};piece.p.x=1.12;assert.equal(t.validPair(pose),false);assert.equal(t.pairClear(),false);
 f.v.bounds=[-1.1,-100,1.1,100];t.world={};assert.equal(t.validPair(pose),false,'map placement includes exposed lateral tyres');assert.equal(t.pairClear(),false,'map contact includes exposed lateral tyres');
 console.log('PASS SEAM lateral circles: broad phase, placement, pair clearance, loose actor rollback, road actor question and map edge; separate wheel mechanisms');
}
