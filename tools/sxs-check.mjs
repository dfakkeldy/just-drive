// Node model checks; bundled by check-sxs.sh. The browser check also measures the actual rendered calls.
import assert from 'node:assert/strict';
import { createSxs, SXS_SPEC } from '../web/src/sxs.ts';
import { inspectTruck } from './truck-geometry.mjs';
import {posedEnvelopeCoverage} from './sxs-envelope.mjs';
import { touchesPlayer } from '../web/src/road-scene-rules.ts';
import { inspectSolids } from './sxs-solids.mjs';
export function inspectSxs(c) {
  const s=inspectTruck(c),w=Object.values(c.wheels);
  const under=n=>{while(n&&n!==c.root)n=n.parent;return n===c.root;};
  let leds=false;c.root.traverse(n=>{if(n.isMesh&&n.material.name==='Ice LED'&&n.material.emissiveIntensity>0)leds=true;});
  s.lamps=leds&&c.brakeLights.length===1&&c.brakeLights.every(n=>under(n)&&n.visible&&n.material.emissiveIntensity>0);
  s.contracts=new Set(w).size===4&&c.steer.fl===c.wheels.fl.parent&&c.steer.fr===c.wheels.fr.parent&&c.steer.fl!==c.steer.fr&&c.brakeLights.length===1;
  return s;
}
const checks={
 budget:s=>s.triangles<=40000&&s.calls<=30&&s.materials<=8,
 sound:s=>s.finite&&s.normals&&!s.flat&&!s.reversed&&!s.twisted,
 size:s=>s.dimensions[0]>=1.8&&s.dimensions[0]<=1.86&&s.dimensions[2]>=3.35&&s.dimensions[2]<=3.5&&s.dimensions[1]>=1.73&&s.dimensions[1]<=1.79&&Math.abs(s.bounds.min[1])<.015,
 pivots:s=>s.contracts&&s.pivots.every((p,i)=>!p.underBody&&Math.abs(p.spin[1]-.405)<1e-8&&p.axle[2]===(i<2?-1.3:1.3)&&p.axle[0]===(i%2?.745:-.745)),
 lamps:s=>s.lamps,
 eye:s=>s.eye[0]===-.29&&s.eye[1]===1.24&&s.eye[2]===.002,
};
const c=createSxs(),stats=inspectSxs(c); console.log('SXS MODEL',JSON.stringify(stats));
const solids=inspectSolids(c);console.log('SXS SOLIDS',JSON.stringify(solids));assert.ok(solids.closed>100&&solids.inward===0,'every closed component faces out of its solid');
for(const [label,test]of Object.entries(checks))assert.ok(test(stats),label);
const mutants={budget:c=>{for(let i=0;i<40;i++)c.body.add(c.body.children.find(n=>n.isMesh).clone());},sound:c=>{c.body.children.find(n=>n.isMesh).geometry.attributes.position.setX(0,NaN);},size:c=>{c.root.scale.z=2;},pivots:c=>{c.wheels.fl.position.y=.2;},eye:c=>{c.driverEye.position.x=.29;},lamps:c=>{c.brakeLights[0].removeFromParent();}};
for(const [label,mutation]of Object.entries(mutants)){const m=createSxs();mutation(m);assert.ok(!checks[label](inspectSxs(m)),`mutation ${label}`);console.log('MUTATION rejected model',label);}
for(const fault of ['winding','normal']) {const m=createSxs(),g=m.body.children.find(n=>n.isMesh).geometry;if(fault==='winding')g.scale(-1,1,1);else g.attributes.normal.setXYZ(0,0,-10,0);assert.ok(!checks.sound(inspectSxs(m)),fault);console.log('MUTATION rejected',fault);}
// Actual posed geometry, including every tyre/body corner below 1.2 m; no longitudinal cut-off or fixed grid.
const coverage=posedEnvelopeCoverage(c,SXS_SPEC);console.log('SXS ENVELOPE',JSON.stringify(coverage));assert.ok(coverage.misses===0&&coverage.unresolved===0,'all posed vertex-cutting posts touch and push');
assert.ok(coverage.maxVertexOutsideEnvelope<.03,'posts cutting a vertex by more than 3 cm touch at any rotation');
const end=Math.max(...SXS_SPEC.envelope.circles)+SXS_SPEC.envelope.radius;
assert.ok(end+stats.bounds.min[2]<=.15,'front overreach at most 15 cm');
assert.ok(SXS_SPEC.envelope.radius-Math.min(...SXS_SPEC.envelope.circles)-1.61<=.15,'centreline tail overreach at most 15 cm');
const holedSpec={...SXS_SPEC,envelope:{...SXS_SPEC.envelope,circles:[-1.3,1.3],circleSides:undefined,radius:.5}};assert.equal(touchesPlayer({x:0,z:0,half:.1,halfWidth:.1,heading:0},{x:0,z:0,heading:0},0,holedSpec),false,'mutation rejected: holes in collision envelope');
const inside=createSxs(),skin=inside.body.children.find(n=>n.isMesh&&n.material.name==='Obsidian enamel').geometry;skin.scale(-1,1,1);skin.computeVertexNormals();assert.ok(inspectSolids(inside).inward>0,'mutation rejected: recomputed normals hide inside-out solids');
// Suspension movement must alter wheels, arms and shock geometry, without moving a steering axle sideways.
const arm=c.root.children.find(n=>n.name==='Double A arms and coil-over').children[0].geometry;
const before=Array.from(arm.attributes.position.array);c.setTravel(.2,-.1,.1,-.2);
assert.equal(c.wheels.fl.parent.position.y,.2);assert.equal(c.wheels.fr.parent.position.y,-.1);assert.notDeepEqual(Array.from(arm.attributes.position.array),before);
c.setTravel(0,0,0,0);assert.deepEqual(Array.from(arm.attributes.position.array),before,'travel restores neutral mesh');
const disabled=createSxs();disabled.setTravel=()=>{};disabled.setTravel(.2,0,0,0);assert.notEqual(disabled.wheels.fl.parent.position.y,.2,'mutation rejected: disconnected suspension');
console.log('PASS side by side geometry, pivots, lamps, eye, suspension and mutations');
