// Imported by mp-check: actual two local WebSockets, plus deterministic lifecycle edge cases.
import assert from 'node:assert/strict';
import { Net } from '../web/src/mp/net.ts';
import { Race } from '../server/src/race.ts';
import { encodeState, FLAG } from '../web/src/mp/wire.ts';
import { readRace, readRoute } from '../web/src/mp/race-wire.ts';
import { raceRoutes } from '../web/src/mp/race-routes.ts';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pose=(x,z=0,t=1,flags=0)=>encodeState({x,z,t,flags,heading:0,steer:0,vx:0,vz:0,air:0});
const body=(x,z=0,flags=0)=>new Uint8Array(pose(x,z,1,flags),2);
const route={roadId:77,gates:[{x:0,z:0},{x:50,z:0},{x:100,z:0}]};
export async function raceCheck(raw){
  // An idle new room gets one clock sample, then no waking race messages. Legacy servers get none.
  for(const capable of [false,true]){
    let at=0;const sent=[];const socket={binaryType:'',readyState:1,onopen:null,onmessage:null,onclose:null,onerror:null,close(){},send(m){sent.push(m);}};
    const n=new Net({urls:['ws://fake'],now:()=>at,socket:()=>socket});const local={x:0,z:0,heading:0,vx:0,vz:0,air:0,flags:8,steer:0};
    n.report(local,at);socket.onmessage({data:JSON.stringify({t:'hello',v:1,id:1,name:'Driver 2',hue:0,room:'test',cap:24,peers:[]})});
    if(capable)socket.onmessage({data:new Race().message(10000)});
    for(at=0;at<20000;at+=100)n.report(local,at,true);
    assert.equal(sent.filter(m=>typeof m==='string'&&m.includes('race-sync')).length,capable?1:0,'idle and legacy sync bounds');n.teleport();n.report(local,at,true);assert.ok(new DataView(sent.filter(m=>m instanceof ArrayBuffer).at(-1)).getUint8(2)&FLAG.teleport,'explicit zero-distance reset');n.stop();
  }

  assert.equal(readRoute({...route,roadId:'Private text'},1000),null,'no arbitrary road-name text');
  assert.equal(readRoute({...route,gates:[{x:NaN,z:0},...route.gates]},1000),null);
  assert.equal(readRoute({...route,gates:[{x:0,z:0},{x:200,z:0},{x:400,z:0}]},1000),null);
  const r=new Race();r.join(1);r.join(2);
  const seats=[{id:1,last:body(0)},{id:2,last:body(0)}];
  assert.equal(r.command(2,{action:'select',route},seats,1000,0),false,'guest cannot select');
  assert.ok(r.command(1,{action:'select',route},seats,1000,0));
  assert.ok(r.command(1,{action:'start'},seats,1000,100));
  assert.equal(r.state.startAt,5100);assert.equal(r.state.racers.length,2);
  assert.equal(r.position(1,body(0),5000),false,'no countdown progress');
  r.position(2,body(15),5000);assert.equal(r.state.racers[1].out,true,'false start');
  r.position(1,body(100),5200);assert.equal(r.state.racers[0].next,1,'cannot skip gates');
  for(const [i,p] of route.gates.entries())r.position(1,body(p.x),5300+i*1000);
  assert.equal(r.state.racers[0].time,2200);
  const restored=new Race(JSON.parse(JSON.stringify(r.state)));assert.deepEqual(restored.state,r.state,'sleep restoration');
  assert.deepEqual(readRace(restored.message(10000)).state,r.state);
  restored.leave(1,[2]);assert.equal(restored.state.host,2);assert.equal(restored.state.route,null,'host exit clears race');
  for(const flags of [FLAG.teleport,0]){
    const r=new Race();r.join(1);r.command(1,{action:'select',route},seats,1000,0);r.command(1,{action:'start'},seats,1000,0);
    r.position(1,body(0,0,flags),flags?6000:606000);assert.ok(r.state.racers[0].out,'reset/timeout out');
  }
  const roads=[{id:77,name:'Real Road',kind:2,pts:[[0,0],[50,0],[50,50],[100,50],[150,50]]}];
  const choices=raceRoutes(roads,{x:0,z:0});assert.ok(choices.length);assert.deepEqual(choices[0].gates.slice(0,3),[{x:0,z:0},{x:50,z:0},{x:50,z:50}],'road bend retained');
  const long={id:78,name:'Long Road',kind:2,pts:[[-2000,0],[0,0],[0,2000]]};
  const before=JSON.stringify(long),middle=raceRoutes([long],{x:0,z:500});
  assert.equal(middle.length,2,'both directions from the middle of a long road');
  assert.ok(middle.every(r=>r.gates[0].x===0&&r.gates[0].z===500),'start at the nearest point on the road, not its distant ends');
  assert.equal(JSON.stringify(long),before,'course creation does not change source geometry');
  assert.ok(raceRoutes([{...long,pts:[[0,0],[150,0]]}],{x:75,z:0}).length,'short roads retain a full course when both halves are too short');
  assert.deepEqual(raceRoutes([{...long,railway:true}],{x:0,z:500}),[],'railways never become road courses');
  const room='race'+Math.random().toString(36).slice(2,8),clients=[];
  // Waits for the condition, however long a busy machine takes; the deadline only stops a fault from hanging the check.
  // On a timeout it names what it waited for, each socket by its part (the legacy one is an old game that reads no race
  // messages, so its log stays empty), and how far the room's clock reads from this machine's.
  let skew=NaN;const skewText=()=>Number.isFinite(skew)?`${Math.round(skew)} ms`:'not measured yet';
  const until=async(f,what)=>{const end=performance.now()+30000;while(!f()){if(performance.now()>end)throw Error(`race socket timeout waiting for ${what}; room clock minus this machine's: ${skewText()}; `+JSON.stringify(clients.map(c=>({who:c.who,id:c.id,state:c.state,last:c.events.slice(-3)}))));await sleep(40);}};
  // A round trip through the room on c's socket: what c sent before is handled, and what the room sent c before has
  // arrived (the room handles one socket's messages in order). The reply carries the room's clock.
  let echoes=0;const barrier=async c=>{const echo=-++echoes,sent=Date.now();let reply;c.ws.send(JSON.stringify({t:'race-sync',echo}));await until(()=>reply=c.events.find(m=>m.t==='race-sync'&&m.echo===echo),`${c.who} to get a race-sync answer`);skew=reply.now-(sent+Date.now())/2;return reply.now;};
  const roomAt=async(c,at)=>{for(let t=await barrier(c);t<at;t=await barrier(c))await sleep(Math.min(500,at-t));};
  const connect=async who=>{
    const ws=raw(room),c={who,ws,events:[],t:0};clients.push(c);ws.binaryType='arraybuffer';
    ws.onmessage=e=>{if(typeof e.data==='string'){const m=JSON.parse(e.data);c.events.push(m);if(m.t==='hello')c.id=m.id;if(m.t==='race')c.state=m.state;}};
    await until(()=>c.id&&c.state,`${who} to get hello and race state`);ws.send(JSON.stringify({t:'race-sync',echo:performance.now()}));await until(()=>c.state.host,`${who} to see a host`);return c;
  };
  const cmd=(c,action,route)=>c.ws.send(JSON.stringify({t:'race-control',action,route}));
  const send=(c,x)=>c.ws.send(pose(x,0,++c.t));
  try{
    const legacy=raw(room);clients.push({who:'legacy (an old game; reads no race messages)',ws:legacy,events:[]});await new Promise((resolve,reject)=>{legacy.onopen=resolve;legacy.onerror=reject;});
    const a=await connect('host'),b=await connect('guest');assert.equal(a.state.host,a.id);assert.equal(b.state.host,a.id);
    // A change of the race reaches every racer before the room's reply to its next race-sync on that socket.
    cmd(b,'select',route);await barrier(b);await barrier(a);assert.equal(a.state.route,null);assert.equal(b.state.route,null);
    cmd(a,'select',route);await until(()=>a.state.route&&b.state.route,'both racers to see the course');send(a,0);send(b,0);await barrier(a);await barrier(b);
    cmd(a,'start');await until(()=>a.state.startAt&&b.state.startAt,'both racers to see the start time');assert.equal(a.state.startAt,b.state.startAt);assert.equal(b.state.racers.length,2);
    const c=await connect('late spectator');assert.equal(c.state.racers.length,2,'late join spectator');
    await roomAt(a,a.state.startAt+100);   // the countdown is over by the room's clock, not this machine's
    for(const gate of route.gates){send(a,gate.x);send(b,gate.x);await sleep(250);}
    // Nobody may be put out here: a racer out means a gate report reached the room during its countdown (or its socket left).
    await until(()=>{const out=[...a.state.racers,...b.state.racers].find(p=>p.out);assert.ok(!out,`racer ${out?.id} was put out (room clock minus this machine's: ${skewText()})`);return a.state.racers.every(p=>p.time!==null)&&b.state.racers.every(p=>p.time!==null);},'both racers to finish');
    assert.deepEqual(a.state.racers,b.state.racers,'all clients see identical finish times');
    assert.ok(a.state.racers.every(p=>p.time>0));
    a.ws.close();await until(()=>[b.id,c.id].includes(b.state.host),'the host to pass on');assert.equal(b.state.route,null);
  }finally{for(const c of clients)c.ws.close();}
  console.log('PASS race: host authority, real-road bends, countdown, ordered gates, false start, reset, timeout, sleep, late join, two local clients and shared results');
}
