// Diagnostic allocation measurement, with a small per-call ceiling to reject boxed grid keys.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {setFlagsFromString} from 'node:v8';
import {runInNewContext} from 'node:vm';
import {Vector3} from '../web/node_modules/three/build/three.module.js';
import {Guardrails} from '../web/src/guardrails.ts';
// Reserve enough nursery space that this small sample does not hide allocations
// behind an intervening minor collection. Compile synchronously so the warm-up
// finishes before sampling, even when other checks compete with V8's compiler.
if(!process.env.RAIL_ALLOC_CHILD){
 const r=spawnSync(process.execPath,['--expose-gc','--no-concurrent-recompilation','--min-semi-space-size=32','--max-semi-space-size=32',process.argv[1]],{stdio:'inherit',env:{...process.env,RAIL_ALLOC_CHILD:'1'}});
 process.exit(r.status??1);
}
setFlagsFromString('--expose_gc');const collect=runInNewContext('gc');
const road={id:1,name:'allocation fixture',kind:3,halfWidth:3,bridge:false,pts:[[-700,0],[700,0]]};
const h=(x,z)=>100-Math.max(0,z-4)*.8,surface={ground:100,level:8};
const terrain={dataRevision:1,cartRoads:false,low:false,exag:1,seaLevel:0,surfaceAt:()=>surface,heightAt:h};
const gate=process.env.RAIL_ALLOC_MEASURE_ONLY!=='1';
const g=new Guardrails({roads:[road],nearest:()=>null},terrain),cam=new Vector3(0,0,0);
if(gate)assert.ok([...g.cells.keys()].every(k=>Number.isInteger(k)&&k>=0&&k<2**30),'keys fit signed 31-bit small integer range');
const planning=g.planning,access=g.access;
for(let i=0;i<200;i++){g.update(cam);assert.equal(g.planning,planning);assert.equal(g.access,access);}
const car={x:0,z:-200,heading:Math.PI/2,vx:0,vz:0,speed:0};
const call=i=>{car.x=i%100-50;g.block(car,1/120);};
function allocation(fn,count=30000){
 for(let i=0;i<100000;i++)fn(i);
 const bytes=[];
 for(let pass=0;pass<5;pass++){
  collect();const before=process.memoryUsage().heapUsed;
  for(let i=0;i<count;i++)fn(i);
  bytes.push(Math.max(0,process.memoryUsage().heapUsed-before)/count);
 }
 return bytes.sort((a,b)=>a-b);
}
const bytes=allocation(call);
if(gate)assert.ok(bytes[2]<16,`block hot path allocation median ${bytes[2]} bytes/call; boxed keys regress by >64`);
// Camera movement schedules update setup even with no eligible rail road. This
// isolates setup allocations from the intentional span/mesh building allocations.
const idle=new Guardrails({roads:[{...road,kind:4}],nearest:()=>null},terrain),position=new Vector3();
const updates=allocation(i=>{position.x=i*21;idle.update(position);},5000);
if(gate)assert.ok(updates[2]<96,`retained planning setup median ${updates[2]} bytes/call; rebuilt closures/maps regress`);
console.log('PASS small-integer grid and retained context; measured bytes/call',JSON.stringify({collision:bytes,planningSetup:updates}));
