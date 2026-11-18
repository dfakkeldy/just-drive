import assert from 'node:assert/strict';
import {Vector3} from '../web/node_modules/three/build/three.module.js';
import {RAIL_PROP_RADII} from '../web/src/props.ts';
import {Guardrails} from '../web/src/guardrails.ts';
assert.ok(RAIL_PROP_RADII.mailbox>=.8,'mailbox/frame physical envelope needs at least 0.8m radius');
const road={id:1,name:'props fixture',kind:3,halfWidth:3,bridge:false,pts:[[0,0],[100,0]]};
const heightAt=(x,z)=>20-Math.max(0,z-4)*.8,terrain={dataRevision:1,cartRoads:false,low:false,exag:1,seaLevel:0,heightAt,surfaceAt:(x,z)=>({ground:heightAt(x,z),level:8})};
const rails=new Guardrails({roads:[road],nearest:()=>null},terrain);
rails.setObstacles([{x:50,z:4.6}]);for(let i=0;i<30;i++)rails.update(new Vector3(50,0,0));
const spans=rails.chunks.flatMap(c=>c.spans);assert.ok(spans.length>20,'fixture retains rails on both sides');assert.ok(spans.every(s=>s.b.x<48||s.a.x>52),'mailbox/frame/pole opening through production adapter');
console.log('PASS mapped prop opens production rail; six-area segment clearance is checked by guardrail-survey');

// Both physical ends of an opening turn down, including a graded/uneven berm.
const graded={...terrain,heightAt:(x,z)=>heightAt(x,z)+x*.03,meshHeightAt:(x,z)=>heightAt(x,z)+x*.03+.2};
graded.surfaceAt=(x,z)=>({ground:graded.heightAt(x,z),level:8});
const opened=new Guardrails({roads:[road],nearest:()=>null},graded);opened.setObstacles([{x:50,z:4.6}]);
for(let i=0;i<100;i++){opened.update(new Vector3(50,0,0));if(!opened.audit.pending)break;}
let ends=0;
for(const c of opened.chunks)if(c.mesh)for(const s of c.spans)for(const p of [s.b.along===s.runEnd&&s.b.x<50?s.b:null,s.a.along===s.runStart&&s.a.x>50?s.a:null]){
 if(!p)continue;const pos=c.mesh.geometry.attributes.position,rail=c.mesh.geometry.attributes.rail;let bottom=Infinity;
 for(let i=0;i<pos.count;i++)if(rail.getZ(i)<.97&&Math.hypot(pos.getX(i)-p.x,pos.getZ(i)-p.z)<1e-4)bottom=Math.min(bottom,pos.getY(i));
 assert.ok(Math.abs(bottom-graded.meshHeightAt(p.x,p.z)-.02)<.002,'both mailbox opening terminals meet soil');ends++;
}
assert.equal(ends,2,'both sides of the mailbox opening checked');
