// Run the actual Durable Object methods with a fake clock and socket/storage boundary.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { build } = require('esbuild');
const bundle = await build({ entryPoints: [new URL('../server/src/index.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{name:'workers-boundary',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'workers',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }'}));}}] });
const { Room } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let now = 100000, alarmAt;
Date.now = () => now;
class Socket {
  readyState=1; attachment=null; sent=[];
  serializeAttachment(a){this.attachment=structuredClone(a);} deserializeAttachment(){return structuredClone(this.attachment);}
  send(m){this.sent.push(m);} close(code){this.readyState=3;this.code=code;}
}
globalThis.WebSocketPair=class {constructor(){this[0]=new Socket();this[1]=new Socket();}};
globalThis.WebSocketRequestResponsePair=class {};
globalThis.Response=class {constructor(_,options){Object.assign(this,options);}};
const sockets=[];
const ctx={getWebSockets:()=>sockets,acceptWebSocket:s=>sockets.push(s),waitUntil:()=>{},blockConcurrencyWhile:fn=>fn(),setWebSocketAutoResponse:()=>{},storage:{get:async()=>undefined,put:async()=>{},delete:async()=>{},setAlarm:async t=>{alarmAt=t;},deleteAlarm:async()=>{alarmAt=undefined;}}};
const room=new Room(ctx,{});
await Promise.resolve();
const join=async browser=>{await room.fetch(new Request(`http://localhost/mp/v1/mabou/test?browser=${browser}&session=tab-session-00001`,{headers:{'x-room':'mabou/test','x-bounds':'60000'}}));return sockets.at(-1);};
const live=()=>sockets.filter(s=>s.readyState===1&&s.attachment);
const a=await join('browser-aaaaaaaa'), observer=await join('browser-bbbbbbbb');
const replacement=await join('browser-aaaaaaaa');
assert.equal(a.code,4005);assert.equal(live().length,2);assert.equal(a.attachment,null);
room.webSocketClose(a);assert.equal(live().length,2,'late close cannot remove replacement');
assert.equal(JSON.parse(replacement.sent.find(s=>typeof s==='string'&&JSON.parse(s).t==='hello')).peers.length,1);
now+=59999;await room.alarm();assert.equal(live().length,2);assert.equal(alarmAt,100000+60000);
room.webSocketMessage(observer,'heartbeat');
now++;await room.alarm();assert.equal(replacement.code,4006);assert.equal(live().length,1);
assert.ok(observer.sent.some(s=>typeof s==='string'&&s.startsWith('{')&&JSON.parse(s).t==='leave'));
assert.equal(alarmAt,159999+60000);
now=219999;await room.alarm();assert.equal(live().length,0);assert.equal(alarmAt,undefined);
// Transport ping, malformed text and ride/race events do not renew the application lease.
const stale=await join('browser-cccccccc');now+=20000;room.webSocketMessage(stale,'ping');now+=40000;await room.alarm();assert.equal(stale.code,4006);
console.log('PASS actual Room: replace browser, late close, 60 s boundary, heartbeat renewal, leave broadcast, alarm rearm/clear, ping cannot renew');
const netBundle=await build({entryPoints:[new URL('../web/src/mp/net.ts',import.meta.url).pathname],bundle:true,write:false,platform:'node',format:'esm'});
const {Net}=await import(`data:text/javascript;base64,${Buffer.from(netBundle.outputFiles[0].text).toString('base64')}`);
const made=[];
const net=new Net({urls:['ws://localhost/mp/v1/mabou/test'],identity:{browserId:'browser-test-0001',sessionKey:'session-test-0001'},now:()=>now,socket:url=>{const s=new Socket();s.url=url;made.push(s);return s;}});
const state={flags:0,steer:0,heading:0,x:0,z:0,vx:0,vz:0,air:0};
const hello=(s,heartbeat=true)=>s.onmessage({data:JSON.stringify({t:'hello',v:1,cap:24,id:1,name:'Driver',hue:0,room:'mabou/test',peers:[],...(heartbeat?{heartbeat:true}:{})})});
net.report(state,now);hello(made[0],false);
assert.equal(new URL(made[0].url).searchParams.get('browser'),'browser-test-0001');
net.heartbeat();assert.ok(!made[0].sent.includes('heartbeat'),'a room without hello.heartbeat never hears it');
hello(made[0]);net.heartbeat();assert.equal(made[0].sent.at(-1),'heartbeat');
// A short switch away keeps the same socket (and seat) and renews the lease on return.
net.setVisible(false);let sent=made[0].sent.length;now+=5000;net.report(state,now);assert.equal(made[0].sent.length,sent);
net.setVisible(true);assert.equal(made[0].sent.at(-1),'heartbeat');net.report(state,now);assert.equal(made.length,1);
// Hidden past the lease: silent, no reconnect while hidden even after the room's close; visible rejoins at once.
net.setVisible(false);sent=made[0].sent.length;net.heartbeat();now+=60000;made[0].onclose({code:4006});now+=10000;net.report(state,now);
assert.equal(made[0].sent.length,sent);assert.equal(made.length,1);
net.setVisible(true);net.report(state,now);assert.equal(made.length,2);hello(made[1]);
made[1].onclose({code:4005});net.setVisible(false);net.setVisible(true);now+=70000;net.report(state,now);assert.equal(made.length,2);assert.equal(net.status,'off');
console.log('PASS actual Net: identity on join, heartbeat only when advertised, short hide keeps seat, hidden silence, expired seat rejoins on visible, replacement stops reconnect');

// A browser replacement must work even at room capacity, before assigning a new seat.
for(let i=0;i<24;i++)await join('capacity-browser-'+String(i).padStart(2,'0'));
assert.equal(live().length,24);
const fullReplacement=await join('capacity-browser-00');assert.equal(live().length,24);assert.ok(fullReplacement.attachment);
// Attachments and the alarm survive a fresh in-memory Room instance.
now+=60000;const awakened=new Room(ctx,{});await Promise.resolve();await awakened.alarm();assert.equal(live().length,0);
console.log('PASS replacement in full room and alarm eviction after hibernation');
