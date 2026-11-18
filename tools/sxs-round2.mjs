import {posedEnvelopeCoverage} from './sxs-envelope.mjs';
import assert from 'node:assert/strict';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {Vehicle} from '../web/src/vehicle.ts';
import {createSxs,SXS_SPEC} from '../web/src/sxs.ts';
import {touchesPlayer} from '../web/src/road-scene-rules.ts';
import {pushOut} from '../web/src/parked.ts';
import {tyreContacts,contactIsSeated} from './sxs-contact.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import ts from '../web/node_modules/typescript/lib/typescript.js';
const results=[],check=(name,ok,data)=>{results.push({name,ok,data});console.log(ok?'PASS':'FAIL',name,JSON.stringify(data));};
const rig=createSxs(),p=new THREE.Vector3(),post={x:0,z:0,half:.1,halfWidth:.1,heading:0},solids=[post],actor={x:0,z:0,heading:0,vx:0,vz:0,speed:0,spec:SXS_SPEC};
const coverage=posedEnvelopeCoverage(rig,SXS_SPEC),{cuts,misses,unresolved,examples}=coverage;
check('posed_vertex_posts_touch_and_push',misses===0&&unresolved===0,{cuts,misses,unresolved,examples});
check('vertex_margin_covers_rotated_posts',coverage.maxVertexOutsideEnvelope<.03,{maxVertexOutsideEnvelope:coverage.maxVertexOutsideEnvelope});
// The reference points reproduce the reviewer's two uncovered tyre corners directly.
for(const [x,z]of [[-1.0320,-1.4792],[-.8930,-1.6381]]){post.x=x;post.z=z;actor.x=actor.z=0;const hit=touchesPlayer(post,actor,0,SXS_SPEC);pushOut(actor,solids);check('review_corner_'+x,hit&&Math.hypot(actor.x,actor.z)>0,{hit,push:Math.hypot(actor.x,actor.z)});actor.x=actor.z=0;}
rig.steer.fl.rotation.y=rig.steer.fr.rotation.y=0;rig.setTravel(0,0,0,0);rig.root.updateMatrixWorld(true);
// Find the true mesh section at x=0, rather than using outboard tyre extrema as the centreline tail.
let front=Infinity,rear=-Infinity;
rig.root.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position,ix=n.geometry.index,v=[new THREE.Vector3(),new THREE.Vector3(),new THREE.Vector3()];for(let i=0;i<(ix?.count??a.count);i+=3){for(let j=0;j<3;j++)v[j].fromBufferAttribute(a,ix?ix.getX(i+j):i+j).applyMatrix4(n.matrixWorld);for(let j=0;j<3;j++){const x=v[j],y=v[(j+1)%3];if(x.x===0){front=Math.min(front,x.z);rear=Math.max(rear,x.z);}if(x.x*y.x<0){const z=x.z+(y.z-x.z)*(-x.x)/(y.x-x.x);front=Math.min(front,z);rear=Math.max(rear,z);}}}});
const e=SXS_SPEC.envelope,F=Math.max(...e.circles)+e.radius,B=-Math.min(...e.circles)+e.radius;
check('centreline_end_standoff',F+front<=.15+1e-6&&B-rear<=.15+1e-6,{frontMesh:-front,rearMesh:rear,frontReach:F,rearReach:B,noseOverreach:F+front,tailOverreach:B-rear});
const yard=new THREE.Group(),land=new THREE.Group();for(const w of Object.values(rig.wheels)){const q=w.getWorldPosition(new THREE.Vector3());const tile=new THREE.Mesh(new THREE.PlaneGeometry(.15,.15),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));tile.rotation.x=-Math.PI/2;tile.position.set(q.x,0,q.z);yard.add(tile);}yard.updateMatrixWorld(true);rig.root.position.y=-.12;
const partial=tyreContacts(THREE,rig,[land,yard]);check('ramp_rejects_partial_ray_miss',partial.every(c=>!c.ray)&&!partial.every(c=>contactIsSeated(c,true)),partial.map(c=>({ray:c.ray,inYard:c.inYard,deepest:c.deepest,float:c.largestFloat,accepted:contactIsSeated(c,true)})));
const roads={roads:[],nearest:()=>null,deckHeight:()=>null};let hCalls=0,sCalls=0;
const terrain={heightAt:()=>{hCalls++;return 0;},surfaceAt:()=>{sCalls++;return{kind:9,deck:true,ground:0,roadDist:0,halfWidth:10000,canopy:0,level:8};},withContactHeight:(_p,f)=>f()};
function stub(travel){const root=new THREE.Group(),body=new THREE.Group();root.add(body);const r={root,body,wheels:Object.fromEntries(['fl','fr','rl','rr'].map(k=>[k,new THREE.Group()])),steer:{fl:new THREE.Group(),fr:new THREE.Group()},driverEye:new THREE.Object3D(),brakeLights:[]};if(travel)r.setTravel=()=>{};return r;}
function calls(travel){const v=new Vehicle(stub(travel),terrain,roads,-1000,SXS_SPEC);v.place(0,0,0);hCalls=sCalls=0;v.sync(1/30);return{heightAt:hCalls,surfaceAt:sCalls};}
const without=calls(false),withTravel=calls(true);check('sync_no_extra_terrain_queries',withTravel.heightAt===without.heightAt&&withTravel.surfaceAt===without.surfaceAt,{without,withTravel});
const syncCar=new Vehicle(createSxs(),terrain,roads,-1000,SXS_SPEC);syncCar.place(0,0,0);globalThis.__sxsSyncAllocations=0;hCalls=sCalls=0;for(let i=0;i<10000;i++)syncCar.sync(1/30);check('ten_thousand_syncs_no_module_allocations',globalThis.__sxsSyncAllocations===0,{allocations:globalThis.__sxsSyncAllocations,syncs:10000,heightAt:hCalls,surfaceAt:sCalls});
// The instrumentation counts new expressions, arrays and closures in the complete module-owned hot path.
const hot=new Set(['sync','wheelTravel','cacheTravelPlane','setTravel','updateTravelNormals']);let allocations=0;
for(const file of ['web/src/vehicle.ts','web/src/sxs.ts']){const text=process.env.SXS_ROUND2_BASELINE?execFileSync('git',['show',`${process.env.SXS_ROUND2_BASELINE}:${file}`],{encoding:'utf8'}):readFileSync('../'+file,'utf8'),src=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);const walk=n=>{if((ts.isMethodDeclaration(n)||ts.isFunctionDeclaration(n))&&n.name&&hot.has(n.name.getText(src))){const visit=x=>{if(ts.isNewExpression(x)||ts.isArrayLiteralExpression(x)||ts.isObjectLiteralExpression(x)||ts.isArrowFunction(x)||ts.isFunctionExpression(x)||ts.isFunctionDeclaration(x))allocations++;ts.forEachChild(x,visit);};if(n.body)visit(n.body);}else ts.forEachChild(n,walk);};walk(src);}
check('hot_path_has_no_arrays_or_closures',allocations===0,{allocationSites:allocations});
// Report only: place retains the old attitude. Count production steps until the real tyre mesh settles.
const plane=(x,z)=>-Math.tan(Math.PI/6)*z,ground={heightAt:plane,surfaceAt:(x,z)=>({kind:9,deck:true,ground:plane(x,z),roadDist:0,halfWidth:10000,canopy:0,level:8}),withContactHeight:(_p,f)=>f()},placed=createSxs(),v=new Vehicle(placed,ground,roads,-1000,SXS_SPEC);v.assist=0;v.place(0,0,0);
function gaps(){placed.root.updateMatrixWorld(true);return Object.values(placed.wheels).map(w=>{let g=Infinity;w.traverse(n=>{if(!n.isMesh||!/rubber/i.test(n.material.name))return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(n.matrixWorld);g=Math.min(g,p.y-plane(p.x,p.z));}});return g;});}
const initial=gaps();let at40=null,at6=null;for(let i=1;i<=240;i++){v.update(1/120,{throttle:0,steer:0,handbrake:false});const error=Math.max(...gaps().map(Math.abs));if(at40===null&&error<.04)at40=i;if(at6===null&&error<.006){at6=i;break;}}console.log('HILL_PLACE_SETTLING',JSON.stringify({initial,stepsWithin40mm:at40,stepsWithin6mm:at6,secondsWithin40mm:at40/120,secondsWithin6mm:at6/120}));
if(!process.argv.includes('--explore'))assert.deepEqual(results.filter(x=>!x.ok).map(x=>x.name),[],'round 2 review');
