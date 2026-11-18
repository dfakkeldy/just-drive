import { readBaseline } from './baseline-source.mjs';
// Deploy-order proof. Frozen production clients and room judge; no network except local Wrangler.
import assert from 'node:assert/strict';
import { build } from '../web/node_modules/esbuild/lib/main.js';
const root=new URL('../',import.meta.url).pathname;
const source=file=>readBaseline('mp-race',file);
async function moduleFor(entry,frozen=[]){
  const pinned=new Map(frozen.map(file=>[root+file,source(file)]));
  const result=await build({stdin:{contents:`export * from './${entry}';`,resolveDir:root},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent',plugins:[{name:'frozen-main',setup(b){b.onLoad({filter:/\.ts$/},args=>pinned.has(args.path)?{contents:pinned.get(args.path),loader:'ts'}:undefined);}}]});
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const {Net:NewNet}=await moduleFor('web/src/mp/net.ts');
const {Net:OldNet}=await moduleFor('web/src/mp/net.ts',['web/src/mp/net.ts','web/src/mp/wire.ts']);
const old=await moduleFor('server/src/room.ts',['server/src/room.ts','web/src/mp/wire.ts']);
const car={x:0,z:0,heading:0,vx:2,vz:0,air:0,flags:0,steer:0},car0={...car,x:20,vx:0};
// New page / old Worker: run the real new Net against the frozen old room judge and hello.
{
  let at=0,sock;const meter=new old.Meter(),seat=old.takeSeat([]),texts=[],closes=[];
  const net=new NewNet({urls:['ws://old'],now:()=>at,socket:()=>sock={readyState:1,binaryType:'',onopen:null,onclose:null,onerror:null,onmessage:null,close(){},send(data){
    if(data==='ping'){sock.onmessage({data:'pong'});return;}
    if(typeof data==='string')texts.push(data);
    const v=old.judge(seat,meter,data,at,40000);if(v.close)closes.push(v.close);
  }}});
  net.report(car,at);sock.onmessage({data:old.hello(seat,'mabou/old',[])});
  for(at=0;at<20000;at+=100){net.raceCommand('start');net.report({...car,x:at/1000},at);}
  assert.equal(net.race,null);assert.equal(net.status,'on');assert.equal(texts.filter(t=>t.includes('race')).length,0);
  assert.equal(meter.strikes,0);assert.deepEqual(closes,[]);assert.ok(net.sent>=90);
  // Five more minutes parked and visible, with the page's 20 s heartbeat timer and a few tab switches.
  for(;at<320000;at+=100){if(at%20000===0)net.heartbeat();if(at%45000===0){net.setVisible(false);net.setVisible(true);}net.report(car0,at);}
  assert.equal(net.status,'on');assert.equal(texts.filter(t=>t==='heartbeat').length,0,'old room never hears heartbeat');
  assert.equal(meter.strikes,0);assert.deepEqual(closes,[]);net.stop();
  console.log('PASS deploy-order new-page/old-Worker: frozen judge; 20s reports and 5 min parked heartbeats/tab switches, no race or heartbeat texts, strikes or disconnects');
}
// Old page / new Worker: actual frozen Net and a new Net exchange reports through the running local Worker.
{
  const server=process.env.MP_SERVER;assert.match(server,/^ws:\/\/(127\.0\.0\.1|localhost):\d+$/);
  const room='compat'+Math.random().toString(36).slice(2,7),url=`${server}/mp/v1/mabou/${room}`;
  const socket=url=>new WebSocket(url,{headers:{Origin:'http://localhost:5261'}});
  const oldNet=new OldNet({urls:[url],socket}),newNet=new NewNet({urls:[url],socket});
  const timer=setInterval(()=>{const t=performance.now();oldNet.report(car,t);newNet.report({...car,x:10},t);},30);
  try{
    // Waits as long as a busy machine needs; the deadline only stops a fault from hanging the check.
    for(const end=performance.now()+30000;performance.now()<end;){if(oldNet.me&&newNet.me&&oldNet.heard>3&&newNet.heard>3&&newNet.race?.host===newNet.me.id)break;await new Promise(r=>setTimeout(r,40));}
    assert.equal(oldNet.status,'on');assert.equal(newNet.status,'on');assert.ok(oldNet.heard>3&&newNet.heard>3);
    assert.equal(oldNet.count,1);assert.equal(newNet.count,1);assert.equal(newNet.race.host,newNet.me.id,'legacy page cannot hold race controls');
    assert.ok(oldNet.views(performance.now()).length);assert.ok(newNet.views(performance.now()).length);
    console.log('PASS deploy-order old-page/new-Worker: frozen Net; bidirectional local socket positions, new client hosts');
  }finally{clearInterval(timer);oldNet.stop();newNet.stop();}
}
