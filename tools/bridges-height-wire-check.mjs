// Exercise the real sender, negotiated wire and server, including old v1 peers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import {canvasStub} from './mp-models-build.mjs';
import {root} from './bridges-fixture.mjs';
export async function heightWire(replacements={}) {
 const output=await build({stdin:{contents:`export {Multiplayer} from './web/src/mp/index';export * from './web/src/mp/wire';export * from './server/src/room';`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',define:{'import.meta.env.DEV':'false'},plugins:[{name:'height-wire',setup(b){b.onResolve({filter:/^three$/},()=>({path:pathToFileURL(root+'web/node_modules/three/build/three.module.js').href,external:true}));b.onLoad({filter:/\.ts$/},a=>{const file=a.path.slice(root.length);if(file in replacements)return {contents:replacements[file],loader:'ts'};});}}]});
 const m=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text+'\n//# sourceURL=bridge-height-wire.bundle.js').toString('base64'));
 const THREE=await import('../web/node_modules/three/build/three.module.js');canvasStub();
 const keys=['WebSocket','location','addEventListener','removeEventListener','document','window'],saved=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));let socket,mp;
 globalThis.addEventListener=globalThis.removeEventListener=()=>{};
 // main's Multiplayer listens for page visibility and runs a heartbeat timer (as in mp-rides-check.mjs).
 for(const[key,value]of Object.entries({document:{...globalThis.document,hidden:false,addEventListener(){},removeEventListener(){}},window:globalThis}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 globalThis.WebSocket=class {constructor(url){this.url=url;this.readyState=1;this.sent=[];socket=this;}send(data){this.sent.push(data);}close(){this.readyState=3;}};
 globalThis.location={protocol:'http:',host:'local'};
 try {
  for(const heights of[false,true]) {
   const vehicle={x:0,y:16,z:0,heading:0,vx:0,vz:0,speed:0,steerAngle:0,airborne:false};
   mp=new m.Multiplayer({scene:new THREE.Scene(),vehicle,ground:()=>13,heightScale:1.5,seaLevel:1,low:true,bare:true,touch:false,params:new URLSearchParams(),area:'mabou'},'height');
   const camera=new THREE.PerspectiveCamera();mp.update(0,camera,false);
   const asked=new URL(socket.url);assert.equal(asked.searchParams.get('heights'),'1','new client requests height snapshots');
   assert.ok(asked.searchParams.get('browser')&&asked.searchParams.get('session'),'the browser identity survives beside the height request');
   const seat=m.takeSeat([]),hello=JSON.parse(m.hello(seat,'mabou/height',[]));if(!heights)delete hello.heights;
   socket.onmessage({data:JSON.stringify(hello)});
   for(const[y,airborne,want]of[[16,false,11],[16,true,9],[-2,false,-2]]){
    vehicle.y=y;vehicle.airborne=airborne;mp.net.lastSend=-Infinity;mp.update(0,camera,false);
    const packet=socket.sent.filter(x=>x instanceof ArrayBuffer).at(-1);assert.ok(packet,'sender reports binary state');
    assert.equal(packet.byteLength,heights?28:24,'height is sent only after capability negotiation');
    const accepted=m.judge(seat,new m.Meter(),packet,0,10000);assert.ok(accepted.body,'real room accepts sender height');seat.last=accepted.body;
    const state=m.decodeSnapshot(m.lastKnown([seat],heights))[0].state;
    if(heights)assert.ok(Math.abs(state.y-want)<1e-5,'sender reports unscaled support height, separately from air');else assert.equal(state.y,undefined,'old recipient keeps the legacy layout');
    assert.equal(m.decodeSnapshot(m.lastKnown([seat],false))[0].state.y,undefined,'extended sender remains readable by an old recipient');
   }
   mp.dispose();mp=undefined;
  }
 } finally {mp?.dispose();for(const k of keys)if(saved[k])Object.defineProperty(globalThis,k,saved[k]);else delete globalThis[k];}
 console.log('PASS D2 actual Multiplayer sender, capability negotiation, scale/air/sea support and real room mixed-version relay');
}
await heightWire();
if(process.argv.includes('--mutations'))for(const[file,from,to,label]of[
 ['web/src/mp/index.ts','s.y=support>sea?sea+(support-sea)/(this.host.heightScale??1):support;','s.y=0;','sender reports unscaled'],
 ['web/src/mp/net.ts','this.heightSupported&&Number.isFinite(state.y)','false','height is sent only'],
 ['web/src/mp/net.ts','this.heightSupported&&Number.isFinite(state.y)','Number.isFinite(state.y)','height is sent only']]){
 const source=readFileSync(root+file,'utf8');assert.equal(source.split(from).length,2,'unique height-wire mutation');await assert.rejects(()=>heightWire({[file]:source.replace(from,to)}),new RegExp(label));console.log('KILLED D2 '+label+' '+to);
}
