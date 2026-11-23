import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GARAGE} from '../web/src/garage.ts';
import {Vehicle} from '../web/src/vehicle.ts';
import {Towing} from '../web/src/towing.ts';
import * as FleetModels from '../web/src/fleet-models.ts';
// Bundled main and current code have separate THREE class identities; count by the public tag.
function triangles(root){let count=0;root.traverseVisible(n=>{if(n.isMesh)count+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3*(n.isInstancedMesh?n.count:1)});return count;}
function calls(root){let n=0;root.traverseVisible(m=>{if(m.isMesh)n+=Array.isArray(m.material)?m.geometry.groups.length:1});return n;}
const rng=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
export async function fleetTransformOracle(terrain,roads,start){
 const stock=await import(process.env.FLEET_STOCK_ORACLE),oldDOM=globalThis.document,oldRandom=Math.random;
 globalThis.document={createElement(){const canvas={width:0,height:0};canvas.getContext=()=>new Proxy({createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});return canvas}};
 const report=[];
 try{
  for(const {id,trim,just=false,empty=false,low=false} of [{id:'car',trim:true},{id:'car',trim:false},...['truck','sxs','bike'].map(id=>({id,trim:false})),...['car','truck','sxs','bike'].map(id=>({id,trim:false,just:true})),... [false,true].map(low=>({id:'truck',trim:false,empty:true,low})),...['car','truck','sxs','bike'].map(id=>({id,trim:false,low:true}))]){
   stock.GARAGE.find(e=>e.id===id).build(trim,just);GARAGE.find(e=>e.id===id).build(trim,just);
   const current=GARAGE.find(e=>e.id===id);
   const build=(entries,Kind,Tow,original)=>{
    const e=entries.find(e=>e.id===id);const random=rng(338);Math.random=random;const params=new URLSearchParams('vehicle=truck&trailer=empty');if(empty&&!original)assert.equal(FleetModels.fleetEnabled?.(e,params,true)??true,false,'empty trailer takes no-fleet path');
    const rig=empty&&!original?FleetModels.fleetRig(e,false,low,params,just):e.build(trim,just);
    // Use the same tune on both sides of the fleet seam. The bike stores its speed table in its own solver.
    const v=current.ride?current.ride(rig,terrain,roads,-.2,current.spec):new Kind(rig,terrain,roads,-.2,current.spec);
    v.assist=0;v.place(start.x,start.z,start.heading);const tow=empty?new Tow(v,terrain,roads,false,false,{},true,low):null;const drawn=tow?new rig.root.constructor():rig.root;if(tow)drawn.add(rig.root,tow.trailer.root);drawn.updateMatrixWorld(true);const nodes=[];drawn.traverse(n=>nodes.push(n));const hash=createHash('sha256');for(const n of nodes)if(n.isMesh)for(const key of Object.keys(n.geometry.attributes).sort()){hash.update(key);const a=n.geometry.attributes[key].array;hash.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength))}return{v,rig,tow,drawn,triangles:triangles(drawn),drawCalls:calls(drawn),nodes,random,geometry:hash.digest('hex')}
   };
   const a=build(stock.GARAGE,stock.Vehicle,stock.Towing,true),b=build(GARAGE,Vehicle,Towing,false);assert.equal(a.triangles,b.triangles,id+' triangle count');assert.equal(a.drawCalls,b.drawCalls,id+' draw calls');assert.equal(a.nodes.length,b.nodes.length,id+' node count');assert.equal(a.geometry,b.geometry,id+' every drawn vertex/normal/skin attribute');
   for(let step=0;step<1200;step++){
    const input={throttle:step<800?1:step<1000?-1:0,steer:Math.sin(step*.014)*.22,handbrake:step>=1100,touch:step%240<120,pull:id==='bike'&&step>150&&step<260};
    for(const run of [a,b]){Math.random=run.random;terrain.withGroundContact(run.v,()=>run.v.update(1/120,input,run.tow?()=>run.tow.step():undefined));run.tow?.update();run.drawn.updateMatrixWorld(true)}
    for(const key of Object.keys(a.v)){const value=a.v[key];if(value===null||['number','boolean','string'].includes(typeof value))assert.ok(Object.is(value,b.v[key]),`${id} ${key} frame ${step}`)}
    if(empty){assert.deepEqual(a.v.towLoad,b.v.towLoad,'empty towing load');for(const key of Object.keys(a.tow))if(a.tow[key]===null||['number','boolean','string'].includes(typeof a.tow[key]))assert.ok(Object.is(a.tow[key],b.tow[key]),'empty tow '+key+' '+step);}
    assert.deepEqual(a.v.jump,b.v.jump,id+' jump record');assert.deepEqual(a.v.lastJump,b.v.lastJump,id+' completed jump record');
    for(let i=0;i<a.nodes.length;i++)for(const key of ['matrix','matrixWorld'])assert.deepEqual(a.nodes[i][key].elements,b.nodes[i][key].elements,`${id} ${key} node ${i} frame ${step}`);
   }
   // An actual transform fault must be seen by the same equality assertion.
   b.rig.root.position.y+=.1;b.rig.root.updateMatrixWorld(true);assert.throws(()=>assert.deepEqual(a.rig.root.matrixWorld.elements,b.rig.root.matrixWorld.elements));
   report.push({id,mailTrim:trim,cleanText:just,empty,low,triangles:a.triangles,drawCalls:a.drawCalls,steps:1200,nodes:a.nodes.length,geometry:a.geometry});
  }
 }finally{globalThis.document=oldDOM;Math.random=oldRandom}
 console.log('PASS NO-TRAILER STATE, GEOMETRY AND TRANSFORMS',JSON.stringify(report));return report;
}
