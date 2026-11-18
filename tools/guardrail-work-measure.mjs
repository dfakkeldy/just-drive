// Paired deterministic work-count experiment; wall time is diagnostic, never a gate.
import {Vector3} from '../web/node_modules/three/build/three.module.js';
import {Guardrails} from '../web/src/guardrails.ts';
const road={id:1,name:'1km stream drive',kind:3,halfWidth:3,bridge:false,pts:[[-700,0],[1700,0]]};
let samples=0;
const heightAt=(x,z)=>100-Math.max(0,z-4)*.8;
const terrain={dataRevision:1,cartRoads:false,low:false,exag:1,seaLevel:0,heightAt,surfaceAt:(x,z)=>{samples++;return {ground:heightAt(x,z),level:8};}};
const rails=new Guardrails({roads:[road],nearest:()=>null},terrain),camera=new Vector3(0,0,0);
const rows=[];
for(let i=0;i<25;i++){
 camera.x=i*40;terrain.dataRevision++;
 for(let frame=0;frame<60;frame++){
  samples=0;const start=performance.now();rails.update(camera);
  rows.push({metres:camera.x,frame,stations:rails.audit?.samples,chunks:rails.audit?.planned??(frame===0?rails.chunks.filter(c=>c.revision===terrain.dataRevision).length:0),samples,milliseconds:performance.now()-start});
 }
}
console.log(JSON.stringify({updates:rows.length,maxChunks:Math.max(...rows.map(r=>r.chunks)),maxSamples:Math.max(...rows.map(r=>r.samples)),rows}));
