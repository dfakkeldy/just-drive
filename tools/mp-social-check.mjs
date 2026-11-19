import assert from 'node:assert/strict';
import { readHandle, inventedName, readChat, PHRASES, GAME_PHRASES } from '../web/src/mp/social.ts';
import { judge, Meter, takeSeat } from '../server/src/room.ts';
import { parseServerText } from '../web/src/mp/wire.ts';
import { Net } from '../web/src/mp/net.ts';
import { hello } from '../server/src/room.ts';
for (const value of ['abc','A-B 123','12345678901234']) assert.equal(readHandle(value),value);
for (const value of [null,123,'ab','123456789012345','---','   ','<svg>','café','fUck','f4gg0t','sh1t','s h-i t','b1tch','n1gg3r']) assert.equal(readHandle(value),null,String(value));
for(let i=0;i<200;i++) assert.ok(readHandle(inventedName()));
for(let i=0;i<11;i++) assert.equal(readChat(JSON.stringify({t:'chat',phrase:i})),i);
for(const m of [{t:'chat',phrase:-1},{t:'chat',phrase:11},{t:'chat',phrase:1.2},{t:'chat',phrase:'1'},{t:'chat',phrase:1,text:'hello'},{t:'chat',text:'Nice!'}]) assert.equal(readChat(JSON.stringify(m)),null);
const seat=takeSeat([]), meter=new Meter();
assert.ok('chat' in judge(seat,meter,'{"t":"chat","phrase":0}',1000,100));
assert.ok('drop' in judge(seat,meter,'{"t":"chat","phrase":1}',2999,100));
assert.ok('chat' in judge(seat,new Meter(),' {"t":"chat","phrase":1}',3000,100),'hibernation retains cooldown in seat');
assert.ok('drop' in judge(seat,new Meter(),' {"t":"chat","phrase":2}',3001,100));
const other=takeSeat([seat]); assert.ok('chat' in judge(other,new Meter(),'{"t":"chat","phrase":2}',3001,100));
assert.equal(parseServerText('{"t":"chat","id":1,"phrase":11}'),null);
assert.equal(parseServerText('{"t":"chat","id":1,"phrase":10}').phrase,10);
assert.equal(PHRASES.length,11);assert.equal(GAME_PHRASES,8);
// The game phrases go only to a room that said hello.games: an older room would take them for a strike.
for (const games of [false,true]) {
  let at=0; const sent=[];
  const socket={binaryType:'',readyState:1,onopen:null,onmessage:null,onclose:null,onerror:null,close(){},send(m){sent.push(m);}};
  const n=new Net({urls:['ws://fake/mp/v1/mabou/world'],now:()=>at,socket:()=>socket});
  n.report({x:0,z:0,heading:0,vx:0,vz:0,air:0,flags:8,steer:0},at);
  const h=JSON.parse(hello({id:1,name:'Dusty Tire',hue:0,last:null},'world',[])); if(!games) delete h.games;
  socket.onmessage({data:JSON.stringify(h)});
  assert.equal(n.canChat,true);assert.equal(n.gamesSupported,games);
  n.chat(9);
  assert.equal(sent.filter(m=>typeof m==='string'&&m.includes('"chat"')).length,games?1:0,'game phrases only to a games room');
  assert.equal(sent.filter(m=>m==='{"t":"game-sync"}').length,games?1:0,'game-sync only to a games room');
  n.stop();
}
// A newer game in an older room (no hello.chat) sends no chat text: the old room would count it as a strike.
for (const capable of [false,true]) {
  let at=0, opened=''; const sent=[];
  const socket={binaryType:'',readyState:1,onopen:null,onmessage:null,onclose:null,onerror:null,close(){},send(m){sent.push(m);}};
  const n=new Net({urls:['ws://fake/mp/v1/mabou/world'],handle:'Dusty Tire',now:()=>at,socket:u=>{opened=u;return socket;}});
  n.report({x:0,z:0,heading:0,vx:0,vz:0,air:0,flags:8,steer:0},at);
  assert.equal(opened,'ws://fake/mp/v1/mabou/world?handle=Dusty%20Tire');
  const h=JSON.parse(hello({id:1,name:'Dusty Tire',hue:0,last:null},'world',[])); if(!capable) delete h.chat;
  socket.onmessage({data:JSON.stringify(h)});
  assert.equal(n.canChat,capable);
  n.chat(0); at=500; n.chat(1);
  assert.equal(sent.filter(m=>typeof m==='string'&&m.includes('"chat"')).length,capable?1:0,'legacy gate and client cooldown');
  at=2500; n.chat(2);
  assert.equal(sent.filter(m=>typeof m==='string'&&m.includes('"chat"')).length,capable?2:0);
  n.stop();
}
console.log('PASS handles, leetspeak, phrase-only validation, per-player 2 s cooldown across meter resets, no chat sent to an older room, game phrases only to a games room');
