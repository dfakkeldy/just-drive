import { readBaseline } from './baseline-source.mjs';
// Node-only wire, room, net, actual Ghosts instances and triangle/draw-storage contracts.
import assert from 'node:assert/strict';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { canvasStub, fingerprint, modelDefine, modelFiles, CAR_GHOST_SIZE } from './mp-models-build.mjs';
import { ghostContracts, ghostGeometryStats } from './mp-ghosts-contracts.mjs';
import { sampleGameRide, rideWasReported, rideHasSettled } from './mp-rides-probe.mjs';
const root = new URL('../',import.meta.url).pathname;
const mutant = process.env.MP_RIDE_MUTANT;
const mutations = {
  'camera-as-local': ['web/src/mp/index.ts', 'this.ghosts.update(dt, this.peers, camera, v, ride);', 'this.ghosts.update(dt, this.peers, camera, { x: camera.position.x, z: camera.position.z, heading: v.heading }, ride);'],
  'capability-bypass': ['web/src/mp/net.ts', 'this.rideSupported && this.ride', 'this.ride'],
  'no-ride-throttle': ['web/src/mp/net.ts', 'now - this.lastRideSend >= RIDE_SEND_MS', 'true'],
  'server-unknown': ['server/src/room.ts', 'const ride = parseRideChange(message);', 'const ride = JSON.parse(message).ride;'],
  'ignore-ride': ['web/src/mp/ghosts.ts', 'const model = rideIndex(peer.ride);', 'const model = -1;'],
  'lose-trailer': ['web/src/mp/net.ts', 'peer.view.ride = m.ride', 'peer.view.ride = m.ride && { ...m.ride, trailer: false }'],
  'no-overlap-fade': ['web/src/mp/ghosts.ts', 'slot.opacity = easeOpacity(fresh ? 1 : slot.opacity, target, dt);', 'slot.opacity = 1;'],
};
const bundle = await build({stdin:{contents:`export * as THREE from 'three';export * from './web/src/mp/wire';export * from './web/src/mp/nearby';export {Net} from './web/src/mp/net';export {Multiplayer} from './web/src/mp/index';export {sourceModel as productionModel, prepareCar} from './tools/mp-model-source';export {Ghosts} from './web/src/mp/ghosts';export {rideIndex,rideAxles} from './web/src/mp/ride-model';export * from './server/src/room';`,resolveDir:root},nodePaths:[root+'web/node_modules'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',define:{...modelDefine,'import.meta.env.DEV':'true'},plugins:mutant?[{name:'mutate',setup(b){const [file,from,to]=mutations[mutant]??[];assert.ok(file,'known mutant');b.onLoad({filter:/\.(ts|mjs)$/},args=>{if(args.path!==root+file)return;const src=readFileSync(args.path,'utf8');assert.equal(src.split(from).length,2,'unique mutation anchor');return {contents:src.replace(from,()=>to),loader:'ts'};});}}]:[]});
const m = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
canvasStub();globalThis.innerWidth = 1280;modelFiles();await m.prepareCar();   // the mail car is a model file: load it before its ghost is measured
const {THREE,Net,Ghosts,readRide,parseServerText,judge,Meter,takeSeat,hello,encodeState,encodeSnapshot,checkState,rideIndex,nearbyOpacity,footprintsOverlap,easeOpacity} = m;
const car={kind:'car',trailer:false},truck={kind:'truck',trailer:true};
for(const kind of ['car','truck','sxs','sxs-utility','sxs-crew','sxs-cabin','bike']) assert.deepEqual(readRide({kind,trailer:false,secret:'discard'}),{kind,trailer:false});
for(const value of [null,{},'bike',{kind:'boat',trailer:false},{kind:'horse',trailer:false},{kind:'car',trailer:'yes'},{kind:'bike'}])assert.equal(readRide(value),undefined);
assert.deepEqual(readRide({kind:'bike',trailer:true}),{kind:'bike',trailer:false});
const join=ride=>JSON.stringify({t:'join',id:2,name:'Driver 2',hue:2,...(ride?{ride}:{})});
assert.equal(parseServerText(join()).ride,undefined,'old client without ride stays generic');
assert.equal(parseServerText(join({kind:'bad',trailer:false})).ride,undefined,'unknown received kind stays generic');
assert.equal(parseServerText(join({kind:'horse',trailer:false})).ride,undefined,'horse received from a future client stays generic');
assert.equal(rideIndex({kind:'horse',trailer:false}),-1,'a direct horse model also falls back to the car ghost');
assert.deepEqual(parseServerText(join(truck)).ride,truck);
assert.deepEqual(parseServerText(JSON.stringify({t:'ride',id:2,ride:truck})),{t:'ride',id:2,ride:truck});
assert.equal(parseServerText('{"t":"ride","id":"2","ride":{}}'),null);
assert.equal(parseServerText('x'.repeat(8193)),null);
const seat=takeSeat([]),change=ride=>JSON.stringify({t:'ride',id:999,name:'untrusted',ride});
const accepted=judge(seat,new Meter(),change(truck),0,10000);
assert.deepEqual(accepted.ride,truck);assert.deepEqual(JSON.parse(accepted.relay),{t:'ride',id:seat.id,ride:truck},'server binds changes to its own identity');
assert.ok(judge(seat,new Meter(),change({kind:'injected',trailer:true}),0,10000).drop,'server rejects unknown kind');
for(const msg of ['x'.repeat(129),'{"t":"join"}',change({kind:'car',trailer:1})])assert.ok(judge(seat,new Meter(),msg,0,10000).drop);
const rate=new Meter();let verdict;for(let i=0;i<70;i++)verdict=judge(seat,rate,change(car),0,10000);assert.ok(verdict.close,'ride flood shares room rate meter');
seat.ride=truck;assert.deepEqual(parseServerText(hello(takeSeat([seat]),'mabou/test',[seat])).peers[0].ride,truck,'hello carries parked peer ride');
const local={flags:8,steer:0,heading:0,x:0,z:0,vx:0,vz:0,air:0};
assert.equal(encodeState({...local,t:0}).byteLength,24,'state stays 24 bytes at version 1');assert.ok(checkState(encodeState({...local,t:0}),10000));
// Freeze the old reader from the first v1 commit: both directions still parse on the same protocol.
const oldSource=readBaseline('mp-rides-wire','web/src/mp/wire.ts');
const oldBundle=await build({stdin:{contents:oldSource,loader:'ts'},write:false,format:'esm',platform:'node'});
const old=await import(`data:text/javascript;base64,${Buffer.from(oldBundle.outputFiles[0].text).toString('base64')}`);
assert.ok(old.parseServerText(join(truck)));assert.equal(old.parseServerText(accepted.relay),null);
assert.ok(old.decodeSnapshot(encodeSnapshot([{id:2,body:new Uint8Array(encodeState({...local,t:1}),2)}])).length===1);
// The pre-capability server is pinned to origin/main at this review's base. Load both its
// actual judge and wire from Git, so future main updates cannot erase the legacy case.
const legacySources=new Map(['server/src/room.ts','web/src/mp/wire.ts'].map(file=>[root+file,readBaseline('mp-rides-server',file)]));
const legacyBundle=await build({stdin:{contents:`export * from './server/src/room';`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',plugins:[{name:'origin-main-judge',setup(b){b.onLoad({filter:/\.ts$/},args=>legacySources.has(args.path)?{contents:legacySources.get(args.path),loader:'ts'}:undefined);}}]});
const legacyRoom=await import(`data:text/javascript;base64,${Buffer.from(legacyBundle.outputFiles[0].text).toString('base64')}`);
assert.equal(JSON.parse(legacyRoom.hello(legacyRoom.takeSeat([]),'mabou/old',[])).rides,undefined,'origin/main server has no ride capability');
assert.equal(JSON.parse(hello(takeSeat([]),'mabou/new',[])).rides,true,'new server explicitly advertises rides');
for(const bad of [undefined,false,1,'true',{},[]]){
  const message={...JSON.parse(legacyRoom.hello(legacyRoom.takeSeat([]),'mabou/old',[])),rides:bad};
  assert.equal(parseServerText(JSON.stringify(message)).rides,false,'only literal true advertises rides');
}
function judgedClient(api){
  let at=0,ws;const meter=new api.Meter(),seat=api.takeSeat([]),received=[],closed=[],games=[];
  const client=new Net({urls:['ws://judged'],now:()=>at,socket:()=>ws={readyState:1,binaryType:'',onopen:null,onclose:null,onerror:null,onmessage:null,close(){this.readyState=3;},send(data){
    if(data==='ping'){this.onmessage?.({data:'pong'});return;} // Worker auto-response, before judge.
    // Room-game texts are taken by the Room before judge, on the same meter (server/src/index.ts).
    if(typeof data==="string"&&data==='{"t":"game-sync"}'){games.push(at);meter.allow(at);return;}
    received.push({at,data});const verdict=api.judge(seat,meter,data,at,10000);
    if(verdict.close){closed.push(verdict.close);this.readyState=3;this.onclose?.({code:verdict.close});}
    if('ride' in verdict)seat.ride=verdict.ride;else if('body' in verdict)seat.last=verdict.body;
  }}});
  const state={...local,vx:2};client.setRide({kind:'truck',trailer:false});client.report(state,at);
  ws.onmessage({data:api.hello(seat,'mabou/compat',[])});client.report(state,at);
  return {client,meter,received,closed,games,tick(time,trailer,kind='truck'){at=time;client.setRide({kind,trailer});client.report(state,at);}};
}
{
  const old=judgedClient(legacyRoom);
  // Twenty seconds of driving and fast trailer toggles exceeded 40 old-server strikes before the fix.
  for(let i=1;i<=2000;i++)old.tick(i*10,i%3===0);
  assert.deepEqual(old.closed,[],'origin/main old judge never disconnects the new client');
  assert.equal(old.meter.strikes,0,'old server receives no unsupported ride announcements');
  assert.equal(old.received.filter(e=>typeof e.data==='string').length,0,'old server gets binary state only');
  assert.ok(old.received.length>=100,'ordinary state traffic continues at five Hz');old.client.stop();
  console.log('PASS new client against the frozen old judge: 2000 toggles, zero ride texts/strikes/disconnects');
}
{
  // A server advertising rides:true WITHOUT sxsVariants (the previous live server) accepts only car/truck/sxs/bike.
  const preVariantKinds = new Set(['car', 'truck', 'sxs', 'bike']);
  const preVariantApi = {
    Meter, takeSeat,
    hello: (s, room, others) => JSON.stringify({ t: 'hello', v: 1, id: s.id, name: s.name, hue: s.hue, ride: s.ride, room, cap: 24, rides: true, chat: true, heartbeat: true, games: true, peers: others }),
    judge: (s, meter, data, at, bounds) => {
      if (typeof data === 'string') {
        let parsed; try { parsed = JSON.parse(data); } catch { parsed = null; }
        if (parsed?.t === 'ride' && !preVariantKinds.has(parsed.ride?.kind)) {
          meter.strikes++;
          return { drop: true, close: meter.strikes >= 4 ? 4003 : 0 };
        }
      }
      return judge(s, meter, data, at, bounds);
    },
  };
  let at = 0, ws; const meter = new Meter(), seat = takeSeat([]), received = [], closed = [];
  const client = new Net({ urls: ['ws://pre-variants'], now: () => at, socket: () => ws = {
    readyState: 1, binaryType: '', onopen: null, onclose: null, onerror: null, onmessage: null,
    close() { this.readyState = 3; },
    send(data) {
      if (data === 'ping') { this.onmessage?.({ data: 'pong' }); return; }
      if (data === '{"t":"game-sync"}') { meter.allow(at); return; }
      received.push(data);
      const v = preVariantApi.judge(seat, meter, data, at, 10000);
      if (v.close) { closed.push(v.close); this.readyState = 3; this.onclose?.({ code: v.close }); }
      if ('ride' in v) seat.ride = v.ride;
    },
  } });
  client.setRide({ kind: 'sxs-utility', trailer: false }); client.report({ ...local, vx: 2 }, at);
  ws.onmessage({ data: preVariantApi.hello(seat, 'mabou/prev', []) }); client.report({ ...local, vx: 2 }, at);
  for (const [i, kind] of ['sxs-crew', 'sxs-cabin', 'sxs-utility'].entries()) {
    at = (i + 1) * 1500; client.setRide({ kind, trailer: false }); client.report({ ...local, vx: 2 }, at);
  }
  const sentRides = received.filter(d => typeof d === 'string').map(d => JSON.parse(d).ride);
  assert.deepEqual(closed, [], 'rides-only server never disconnects new SxS variants');
  assert.equal(meter.strikes, 0, 'rides-only server records zero strikes for new SxS variants');
  assert.deepEqual(sentRides, [{ kind: 'sxs', trailer: false }], 'new SxS variants announce as legacy sxs to a rides-only server');
  client.stop();
}
{
  const current=judgedClient({Meter,takeSeat,hello,judge});
  for(let i=1;i<=2000;i++)current.tick(i*10,i%3===0);
  current.tick(22000,true);
  const events=current.received.filter(e=>typeof e.data==='string').map(e=>({at:e.at,ride:JSON.parse(e.data).ride}));
  assert.deepEqual(current.closed,[],'new server never disconnects rapid toggles plus moving state');
  assert.equal(current.meter.strikes,0,'coalesced ride changes plus five-Hz states stay inside the real meter');
  assert.equal(current.games.length,1,'one game-sync per connection');
  // Current server with sxsVariants:true accepts every new side-by-side kind directly.
  assert.equal(JSON.parse(hello(takeSeat([]),'mabou/new',[])).sxsVariants,true,'new server advertises sxsVariants');
  for(const [i,kind] of ['sxs-utility','sxs-crew','sxs-cabin'].entries()){
    current.tick(24000+i*1500,false,kind);
  }
  const sxsEvents=current.received.filter(e=>typeof e.data==='string').map(e=>JSON.parse(e.data).ride.kind).slice(-3);
  assert.deepEqual(sxsEvents,['sxs-utility','sxs-crew','sxs-cabin'],'sxsVariants server receives exact new side-by-side kinds');
  assert.equal(current.meter.strikes,0,'zero strikes announcing new side-by-side variants to updated server');
  assert.ok(events.length>10&&events.length<=23,'ride changes are bounded and continue after a burst');
  for(let i=1;i<events.length;i++)assert.ok(events[i].at-events[i-1].at>=1000,'ride sends have at least one-second spacing');
  assert.deepEqual(events.at(-1).ride,{kind:'truck',trailer:true},'coalescing sends the final trailer state');
  current.tick(24000,false);const before=current.received.length;current.tick(24010,true);current.tick(24020,false);current.tick(25000,false);
  assert.equal(current.received.slice(before).filter(e=>typeof e.data==='string').length,0,'a burst back to the last sent ride needs no redundant event');
  current.client.stop();console.log('PASS real new-server meter: 2000 toggles, bounded/coalesced changes, final state retained and zero strikes');
}
// A room that runs games is asked once for their state: not a ride text (server/src/index.ts).
const GAME_SYNC='{"t":"game-sync"}';
let socket,clock=0;
const net=new Net({urls:['ws://local'],now:()=>clock,socket:()=>socket={readyState:1,binaryType:'',send(data){this.sent.push(data)},sent:[],close(){},onopen:null,onclose:null,onerror:null,onmessage:null}});
net.setRide(car);net.report(local,clock);
socket.onmessage({data:hello(takeSeat([]),'mabou/test',[])});net.report(local,clock);
assert.deepEqual(JSON.parse(socket.sent.find(d=>typeof d==='string'&&d!==GAME_SYNC)).ride,car);
for(let i=0;i<100;i++)net.report(local,clock+=200);
assert.equal(socket.sent.filter(d=>typeof d==='string'&&d.startsWith('{')&&d!==GAME_SYNC).length,1,'ride never enters per-frame traffic');
net.setRide(truck);net.report(local,clock+=1000);assert.deepEqual(JSON.parse(socket.sent.at(-1)).ride,truck,'trailer attached change');
net.setRide({kind:'truck',trailer:false});net.report(local,clock+=1000);assert.deepEqual(JSON.parse(socket.sent.at(-1)).ride,{kind:'truck',trailer:false},'trailer detach change');
socket.onmessage({data:join(car)});socket.onmessage({data:JSON.stringify({t:'ride',id:2,ride:truck})});
socket.onmessage({data:encodeSnapshot([{id:2,body:new Uint8Array(encodeState({...local,t:1}),2)}])});
assert.deepEqual(net.views(clock)[0].ride,truck,'change preserves trailer in peer view');
socket.onclose({code:1006});net.report(local,clock+=1);net.report(local,clock+=40000);socket.onmessage({data:hello(takeSeat([]),'mabou/test',[])});net.report(local,clock+=1);assert.equal(socket.sent.filter(d=>typeof d==='string'&&d.startsWith('{')&&d!==GAME_SYNC).length,1,'reconnect announces again');
// A retry into an older server must not retain the previous server's capability.
socket.onclose({code:1006});net.report(local,clock+=1);net.report(local,clock+=40000);
socket.onmessage({data:legacyRoom.hello(legacyRoom.takeSeat([]),'mabou/old',[])});net.report(local,clock+=1);
for(let i=0;i<16;i++){net.setRide({kind:'truck',trailer:i%2===0});net.report(local,clock+=1000);}
assert.equal(socket.sent.filter(d=>typeof d==='string'&&d.startsWith('{')&&d!==GAME_SYNC).length,0,'reconnect to old server clears ride support');net.stop();
assert.equal(nearbyOpacity(10),1);assert.equal(nearbyOpacity(3),.35);assert.equal(nearbyOpacity(0),.35);assert.equal(nearbyOpacity(10,true),.35);assert.equal(nearbyOpacity(5),.675);
assert.equal(easeOpacity(.35,1,0),.35);assert.ok(easeOpacity(1,.35,1/60)<1);
assert.ok(footprintsOverlap({x:0,z:0,heading:0},{x:0,z:-10,heading:0},truck),'trailer overlap beyond centre fade radius');
assert.ok(!footprintsOverlap({x:0,z:0,heading:0},{x:10,z:0,heading:0},car));
const baked=JSON.parse(readFileSync(root+'web/src/mp/ride-models.json','utf8'));
assert.equal(baked.source,fingerprint(),'snapshots match production builders and reducer; regenerate explicitly if shapes change');
const camera=new THREE.PerspectiveCamera(55,1,.1,500);camera.position.set(0,12,30);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
const peer=(id,ride)=>({id,name:'Driver '+id,hue:id%8,ride,x:(id%4)*3,z:-Math.floor(id/4)*4,heading:0,speed:8,steer:.3,air:0,flags:0,alpha:1});
const rides=[undefined,{kind:'horse',trailer:false},car,{kind:'bike',trailer:false},truck,{kind:'sxs',trailer:false},{kind:'sxs-utility',trailer:false},{kind:'sxs-crew',trailer:false},{kind:'sxs-cabin',trailer:false},{kind:'truck',trailer:false}];
for(const low of [false,true])for(const n of [1,4,low?6:16,24]){
  const cap=n===24?24:undefined,g=new Ghosts({low,cap,ground:()=>0}),peers=Array.from({length:n},(_,i)=>peer(i+1,rides[i%rides.length]));g.update(1/60,peers,camera);
  const [body,labels]=g.group.children,drawn=Math.min(n,cap??(low?6:16));
  assert.equal(g.drawn,drawn);assert.equal(body.count,drawn);assert.ok(body.geometry.attributes.position.count/3<=700);
  assert.equal(g.group.children.filter(o=>o.count>0).length,2,'shared body and label draws for mixed vehicles');
  assert.ok((body.geometry.attributes.position.count/3*drawn+labels.count*2)<=drawn*702);
  assert.equal(body.geometry.morphAttributes.position.length,8);
  const morph=new THREE.Mesh(body.geometry);for(let i=0;i<drawn;i++){body.getMorphAt(i,morph);assert.deepEqual(morph.morphTargetInfluences,Array.from({length:8},(_,j)=>j===rideIndex(peers[i].ride)?1:0),'GPU selects announced ride');}
  console.log(`${low?'phone':'desktop'} n=${n} cap=${cap??(low?6:16)} drawn=${drawn} calls=2 triangles=${drawn*696+labels.count*2}`);
  const positions=body.geometry.morphAttributes.position;
  for(let k=0;k<positions.length;k++){
    const attr=positions[k],bounds=new THREE.Box3().setFromBufferAttribute(attr),size=bounds.getSize(new THREE.Vector3());
    assert.ok(size.y>1 && size.x>.3 && size.z>1.8,'each model has real vehicle volume');
    assert.ok(Math.abs(bounds.min.y)<1e-5,'tyres meet the ground, including the bike axle datum');
    if(k===2)assert.ok(size.z>14,'attached trailer extends behind truck');
    if(k===4)assert.ok(size.y>1.6&&size.x<1.5,'bike includes rider and narrow silhouette');
  }
  g.dispose();assert.equal(g.group.children.length,0);
}
// A curved surface distinguishes the true wheelbase/track from the old car-only probe.
for(const ride of rides){
  const g=new Ghosts({low:false,cap:1,ground:(x,z)=>.02*z*z+.05*x*x}),p=peer(1,ride);p.x=p.z=0;p.heading=0;p.steer=0;
  g.update(1/60,[p],camera);const matrix=new THREE.Matrix4();g.group.children[0].getMatrixAt(0,matrix);
  const axles=m.rideAxles(ride)??{wheelbase:2.62,track:1.57};
  assert.ok(Math.abs(matrix.elements[13]-(.02*axles.wheelbase**2+.05*axles.track**2)/4)<1e-6,'each ride samples its own production axles');g.dispose();
}
// A bike has zero track. A round-off residual must never become atan2(epsilon, 0) = 90 degrees.
{
  const g=new Ghosts({low:false,cap:1,ground:(_x,z)=>z<0?.1:.2}),p=peer(1,{kind:'bike',trailer:false});p.x=p.z=0;p.steer=0;
  g.update(1/60,[p],camera);const matrix=new THREE.Matrix4();g.group.children[0].getMatrixAt(0,matrix);
  assert.ok(Math.abs(matrix.elements[1])<1e-6,'zero-track bike stays upright on unequal axle heights');g.dispose();
}
const g=new Ghosts({low:false,ground:()=>0}),p=peer(2,car);p.x=10;p.z=0;const localPose={x:0,z:0,heading:0};
for(const [distance,expected] of [[10,1],[3,.35],[0,.35],[10,1]]){
  p.x=distance;for(let i=0;i<120;i++)g.update(1/60,[p],camera,localPose,car);
  const [body,labels]=g.group.children;
  assert.ok(Math.abs(body.geometry.attributes.fade.getX(0)-expected)<1e-5,`fade at ${distance} m`);
  assert.equal(labels.geometry.attributes.fade.getX(0),1,'nearby name stays readable');
  assert.ok(!body.material.transparent&&body.material.depthWrite,'screen-door opacity retains two opaque draws');
}
p.ride={kind:'bike',trailer:false};p.steer=.4;p.x=0;g.update(1/60,[p],camera);const transform=new THREE.Matrix4();g.group.children[0].getMatrixAt(0,transform);assert.ok(Math.abs(transform.elements[1])>.05,'bike leans');g.dispose();
// Exercise the actual game glue, using the same host.vehicle reference and shared browser witness.
// Visibility changes reset main's last-frame clock. Twelve 100 ms focus switches can advance
// the opacity integrator by much less than 1.2 seconds: a fixed poll count is not convergence.
{
  const keys=['performance','WebSocket','location','navigator','addEventListener','removeEventListener','document','window'];
  const prior=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let now=0,ws;
  class Socket {readyState=1;binaryType='';onopen=null;onclose=null;onerror=null;onmessage=null;sent=[];constructor(){ws=this;}send(data){this.sent.push(data);}close(){this.readyState=3;}}
  for(const [key,value] of Object.entries({performance:{now:()=>now},WebSocket:Socket,location:{protocol:'http:',host:'localhost'},navigator:{userActivation:{hasBeenActive:false}},addEventListener(){},removeEventListener(){},document:{...globalThis.document,hidden:false,addEventListener(){},removeEventListener(){}},window:globalThis}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  let mp;
  try{
    const local={x:0,y:0,z:0,heading:0,vx:0,vz:0,speed:0,steerAngle:0,airborne:false};
    const camera=new THREE.PerspectiveCamera(55,1,.1,500);camera.position.set(0,3,0);camera.lookAt(0,0,0);
    mp=new m.Multiplayer({scene:new THREE.Scene(),vehicle:local,ride:()=>car,ground:()=>0,low:false,bare:true,touch:false,params:new URLSearchParams('mpserver=ws://local'),area:'mabou'},null);
    mp.update(1/60,camera,true);
    ws.onmessage({data:hello({id:1,name:'Driver 1',hue:1,last:null},'mabou/witness',[{id:2,name:'Driver 2',hue:2,ride:car,last:null}])});
    mp.update(1/60,camera,true);
    const waitingPeer=sampleGameRide({mp:{current:mp},camera});
    assert.ok(rideWasReported(waitingPeer,car),'source progress does not require the hidden partner to have rendered or reported');
    assert.equal(rideHasSettled(waitingPeer,{distance:0,ride:car,fade:.35}),false,'no peer frame cannot satisfy receiver convergence');
    ws.onmessage({data:encodeSnapshot([{id:2,body:new Uint8Array(encodeState({...local,flags:8,steer:0,t:0,air:0}),2)}])});
    const frame=(dt,wall=dt*1000)=>{now+=wall;mp.update(dt,camera,true);return sampleGameRide({mp:{current:mp},camera});};
    let sample;for(let i=0;i<120;i++)sample=frame(1/60);
    assert.ok(rideHasSettled(sample,{distance:0,ride:car,fade:.35}),'game host overlap settles to 35 percent');
    local.x=-10;for(let i=0;i<12;i++)sample=frame(.0075,100);
    assert.equal(sample.distance,10,'witness reads the actual host vehicle and peer');assert.equal(sample.cameraDistance,0,'camera is over the peer, not the local vehicle');
    assert.ok(rideWasReported(sample,car),'the actual Net report moved to the requested place');
    assert.ok(sample.fade>.7&&sample.fade<.8,'tab-switch timing reproduces a partially restored far ghost');
    assert.equal(rideHasSettled(sample,{distance:10,ride:car,fade:1}),false,'twelve wall-clock polls do not prove opacity convergence');
    console.log('VISIBILITY_REPRO',JSON.stringify({wallSeconds:1.2,integratedSeconds:.09,distance:sample.distance,cameraDistance:sample.cameraDistance,fade:sample.fade}));
    for(let i=0;i<120;i++)sample=frame(1/60);
    assert.ok(rideHasSettled(sample,{distance:10,ride:car,fade:1}),'actual Multiplayer.update fully restores a ghost ten metres from the vehicle');
    camera.position.set(-10,3,0);for(let i=0;i<30;i++)sample=frame(1/60);
    assert.ok(rideHasSettled(sample,{distance:10,ride:car,fade:1}),'camera motion does not affect vehicle proximity fade');
    local.x=-3;for(let i=0;i<120;i++)sample=frame(1/60);
    assert.ok(rideHasSettled(sample,{distance:3,ride:car,fade:.35}),'same game glue fades at three metres');
  }finally{mp?.dispose();for(const key of keys){if(prior[key])Object.defineProperty(globalThis,key,prior[key]);else delete globalThis[key];}}
}
// Execute every remaining legacy browser contract in Node too; all use the real Ghosts class.
console.log('GHOST_CONTRACTS',ghostContracts(THREE,Ghosts,m.FLAG).join('; '));
{
  const ghost=new Ghosts({low:false,ground:()=>0}),geometry=ghost.group.children[0].geometry,stats=ghostGeometryStats(THREE,geometry);
  geometry.computeBoundingBox();const aggregate=geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
  assert.ok(aggregate[2]>15,'the old aggregate morph bounding box includes the trailer');
  assert.ok(stats.base.size[2]>4.3&&stats.base.size[2]<4.7&&stats.base.size[1]>1.6&&stats.base.size[1]<1.8,'legacy proportions still meet the old limits when measured alone');
  for(const shape of [stats.base,...stats.models]){assert.equal(shape.flat,0,'every selected model face has area');assert.equal(shape.backwards,0,'normals match winding');assert.ok(Math.abs(shape.min[1])<1e-5,'all models use a tyre-contact datum');}
  assert.ok(Math.abs(stats.models[0].size[2]-CAR_GHOST_SIZE.length)<.002&&Math.abs(stats.models[0].size[1]-CAR_GHOST_SIZE.height)<.002,'production car target (the mail car\'s model file, off duty) is at unit scale');
  const root=m.productionModel('car');root.updateMatrixWorld(true);const sourceBox=new THREE.Box3();
  root.traverseVisible(obj=>{if(obj.isMesh)sourceBox.union(new THREE.Box3().setFromBufferAttribute(obj.geometry.attributes.position).applyMatrix4(obj.matrixWorld));});
  console.log('GEOMETRY_SIZES',JSON.stringify({legacy:stats.base.size,carTarget:stats.models[0].size,productionVisible:sourceBox.getSize(new THREE.Vector3()).toArray(),aggregate}));
  root.traverse(obj=>{if(obj.isMesh)obj.geometry.dispose();});ghost.dispose();
}
console.log('PASS rides, legacy compatibility, server validation/rate limit, changes/reconnect, models, draw counts, bike lean and overlap fade');
if(process.argv.includes('--mutations'))for(const name of Object.keys(mutations)){
  const r=spawnSync(process.execPath,[new URL(import.meta.url).pathname],{env:{...process.env,MP_RIDE_MUTANT:name},encoding:'utf8'});
  assert.equal(r.status,1,`${name} must fail with exit 1: ${r.stdout}\n${r.stderr.slice(-1000)}`);console.log(`KILLED ${name}: exit ${r.status}`);
}
