import { raceCheck } from './mp-race-check.mjs';
// Multiplayer check: simulated games against the local room server (tools/check-mp.sh starts it).
// It proves what each player sees of the others, on a clean connection and on a bad one, and that the room
// refuses what a real game would not send. Judge it by its exit code.
import assert from 'node:assert/strict';
import { addressTurnsOn, multiplayerHost, multiplayerSwitch, roomCode, newRoomCode, roomInvitation, startsWithoutButton, consentAfterSwitch } from '../web/src/mp/switch.ts';
import { callSignHeight } from '../web/src/mp/ghosts.ts';
import { Horns } from '../web/src/mp/horn.ts';
import { Net } from '../web/src/mp/net.ts';
import { CHAT_COOLDOWN } from '../web/src/mp/social.ts';
import { CLOSE, FLAG, ROOM_CAP, SEND_HZ, encodeSnapshot, encodeState } from '../web/src/mp/wire.ts';
import { Meter, judge, takeSeat } from '../server/src/room.ts';

// Consent: a published address can never switch multiplayer on, and nothing connects without a button unless the
// player said yes on an earlier visit. A development build may, for tests.
assert.equal(addressTurnsOn(false, '1'), false, 'a published ?mp=1 does nothing');
assert.equal(addressTurnsOn(true, '1'), true);
assert.equal(startsWithoutButton(false, false, false, false), false, 'published, no saved yes, no title card: no connection');
assert.equal(startsWithoutButton(false, true, false, false), true, 'published, a saved yes: connects');
assert.equal(startsWithoutButton(false, true, true, false), false, 'an invitation always needs the button');
assert.equal(startsWithoutButton(true, false, false, true), false, 'a title card on screen always needs the button');
assert.equal(startsWithoutButton(true, false, false, false), true);
assert.equal(consentAfterSwitch(false, true, false), true, 'the switch turned on while driving is a yes');
assert.equal(consentAfterSwitch(false, true, true), false, 'on the title card the start button comes first');
assert.equal(consentAfterSwitch(true, true, true), false, 'also on a title card opened again mid-shift: an earlier yes does not carry over');
assert.equal(consentAfterSwitch(true, false, false), true, 'turning it off takes no yes away (nothing connects while it is off)');
for (const host of ['mmm.fakkeldy.ca', 'localhost', '127.0.0.1']) assert.equal(multiplayerHost(host), true);
for (const host of ['example.com', 'mmm.fakkeldy.ca.example.com', 'preview.fakkeldy.ca', '::1', '']) assert.equal(multiplayerHost(host), false);
// A forbidden host remains inert even with both URL overrides and no browser DOM or storage.
{
  const prior = Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{hostname:'private-preview.example'}});
  try {
    const control = multiplayerSwitch({params:new URLSearchParams('mp=1&room=abcd')});
    control.update(.1,{},true);control.horn();const marks=[{x:1,z:1}];control.marks(marks);
    assert.equal(control.current,null);assert.deepEqual(marks,[]);
  } finally {if(prior)Object.defineProperty(globalThis,'location',prior);else delete globalThis.location;}
}
assert.equal(roomCode('AbCd'), 'abcd');
assert.equal(roomInvitation('https://mmm.fakkeldy.ca', '/drive', 'abcd', 'judique'), 'https://mmm.fakkeldy.ca/drive?room=abcd&area=judique');
for (const text of ['abc1', 'abcde', 'abc', ' abcd', 'éabc']) assert.equal(roomCode(text), null);
for (let i = 0; i < 100; i++) assert.match(newRoomCode(), /^[abcdefghjkmnpqrstuvwxyz]{4}$/);
for (const viewport of [280,390,844]) for (const distance of [5,30,60]) {
  const depth=distance, projection=2, h=callSignHeight(depth,projection,viewport,true,distance);
  assert.ok(h*projection/depth*viewport/2*32/64 >= 16-1e-9, `phone call sign is readable at ${distance} m in ${viewport} CSS px`);
}
console.log('PASS host gate, strict four-letter codes, random code alphabet and phone label size through 60 m');
// Horn edge/rate/privacy checks need no audio device. A gesture unlocks the synthesis call;
// an absent AudioContext must remain harmless, and dispose must remove both gesture listeners.
{
  const prior = Object.fromEntries(['window','addEventListener','removeEventListener'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)]));
  const events = new Map();
  Object.assign(globalThis, { window:{}, addEventListener:(key,fn)=>events.set(key,fn), removeEventListener:(key,fn)=>{if(events.get(key)===fn) events.delete(key);} });
  try {
    const h = new Horns(), v = {id:2,x:40,z:0,flags:FLAG.horn};
    h.update([v],0,0,0); assert.equal(h.count,0);
    events.get('keydown')();
    v.flags=0;h.update([v],0,0,50);v.flags=FLAG.horn;h.update([v],0,0,100);assert.equal(h.count,1);
    h.update([v],0,0,800);assert.equal(h.count,1);
    v.flags=0;h.update([v],0,0,900);v.flags=FLAG.horn;h.update([v],0,0,1000);assert.equal(h.count,2);
    v.flags=0;h.update([v],0,0,1100);v.flags=FLAG.horn;h.update([v],0,0,1200);assert.equal(h.count,2);
    v.flags=0;h.update([v],0,0,1800);v.flags=FLAG.horn;v.x=400;h.update([v],0,0,2000);assert.equal(h.count,2);
    h.dispose();assert.equal(events.size,0);
  } finally {
    for(const [key,descriptor] of Object.entries(prior)) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
  console.log('PASS horn gesture gate, rising edge, per-car cooldown, distance and disposal with no audio device');
}

const SERVER = process.env.MP_SERVER ?? 'ws://127.0.0.1:5262';
const ORIGIN = process.env.MP_ORIGIN ?? 'http://localhost:5261';
const now = () => performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (room) => `${SERVER}/mp/v1/mabou/${room}`;
const raw = (room, origin = ORIGIN) => new WebSocket(url(room), origin ? { headers: { Origin: origin } } : undefined);
/**
 * Waits for what the next step needs, however long a busy machine takes to get there. The deadline only stops a
 * fault from hanging the check: no bound on the game is measured with it.
 */
const until = async (ready, what, ms = 30000) => {
  const end = now() + ms;
  while (!ready()) {
    if (now() > end) throw new assert.AssertionError({ message: `waited ${(ms / 1000).toFixed(0)} s for ${what}` });
    await sleep(20);
  }
};
if (process.argv.includes('--race-only')) { await raceCheck(raw); process.exit(0); }
// --motion-only: the rules, the door and three players on a clean connection (tools/check-mp.sh --mutations).
const motionOnly = process.argv.includes('--motion-only');
const results = [];
let echoes = 0;
/**
 * One round trip through the room on a socket (a race-sync). The room handles one socket's messages in order, so
 * all sent on it before have been handled, and all the room sent to this socket before has arrived. The reply
 * carries the room's own clock, in ms.
 */
const barrier = async (c) => {
  const echo = ++echoes; let reply;
  c.ws.send(JSON.stringify({ t: 'race-sync', echo }));
  await until(() => (reply = c.events.find((e) => e?.t === 'race-sync' && e.echo === echo)), 'the room to answer a race-sync');
  return reply.now;
};
/** Waits until the room's clock reads `at` or later. */
const roomAt = async (c, at) => { for (let t = await barrier(c); t < at; t = await barrier(c)) await sleep(Math.min(500, at - t)); };
// Join validation happens in the real Worker, independently of the browser form.
if (!motionOnly) {
  const room = 'social' + Math.random().toString(36).slice(2,6), sockets=[];
  const connect = async handle => {
    const ws=new WebSocket(url(room)+'?handle='+encodeURIComponent(handle), {headers:{Origin:ORIGIN}}), events=[];
    sockets.push(ws); ws.onmessage=e=>{if(typeof e.data==='string') {try{events.push(JSON.parse(e.data));}catch{}}};
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    await until(()=>events.some(e=>e.t==='hello'), `the hello for ${handle}`);
    return {ws,events,hello:events.find(e=>e.t==='hello')};
  };
  const chats = c => c.events.filter(e=>e.t==='chat');
  try {
    const a=await connect('Dusty Tire'), b=await connect('sh1t');
    assert.equal(a.hello.name,'Dusty Tire'); assert.notEqual(b.hello.name,'sh1t');
    for(const bad of ['ab','123456789012345','<svg>','n1gg3r']) { const c=await connect(bad); assert.notEqual(c.hello.name,bad); }
    assert.equal(b.hello.peers.find(p=>p.id===a.hello.id).name,'Dusty Tire');
    // Extra fields, an unknown phrase and free text are refused. Then two valid phrases at once: the first passes and
    // the second falls inside the room's cooldown. Race-syncs before and after bracket both by the room's clock; in the
    // rare try that the room itself took longer than the cooldown, the second may rightly pass, so the pair is sent again.
    let got = [], span = Infinity, last = 0, tries = 0;
    a.ws.send(JSON.stringify({t:'chat',phrase:0,id:b.hello.id})); // extra fields refused
    a.ws.send(JSON.stringify({t:'chat',phrase:8}));
    a.ws.send(JSON.stringify({t:'chat',text:'arbitrary text'}));
    while (span >= CHAT_COOLDOWN) {
      assert.ok(tries++ < 3, `the room took ${span} ms for two messages, three times running`);
      if (last) await roomAt(a, last + CHAT_COOLDOWN);
      const seen = chats(b).length, from = await barrier(a);
      a.ws.send(JSON.stringify({t:'chat',phrase:0})); a.ws.send(JSON.stringify({t:'chat',phrase:1}));
      last = await barrier(a); await barrier(b); span = last - from; got = chats(b).slice(seen);
    }
    assert.deepEqual(got.map(e=>[e.id,e.phrase]),[[a.hello.id,0]],'only the valid phrase reaches the other player: refused text, and the phrase inside the cooldown, do not');
    assert.ok(chats(a).length && chats(a).every(e=>e.id===a.hello.id),'sender gets authoritative echo');
    assert.deepEqual(chats(a).map(e=>e.phrase),chats(b).map(e=>e.phrase),'and it is exactly what the other player got');
    b.ws.send(JSON.stringify({t:'chat',phrase:2}));
    await until(()=>chats(a).some(e=>e.id===b.hello.id&&e.phrase===2),'the phrase of a player with no cooldown of their own');
    await roomAt(a, last + CHAT_COOLDOWN);   // the room's clock: the cooldown is over
    a.ws.send(JSON.stringify({t:'chat',phrase:7}));
    await until(()=>chats(b).some(e=>e.phrase===7),'the phrase after the cooldown');
    console.log('PASS real Worker handle fallback, phrase-only relay, sender identity and independent cooldown');
  } finally { for(const ws of sockets) ws.close(); }
}

/** Waits until a game is in a room. */
const untilOn = (bot) => until(() => bot.net.status === 'on', `${bot.name} to join a room`);
const pass = (name, detail = '') => { results.push(name); console.log(`PASS ${name}${detail ? `: ${detail}` : ''}`); };

// A real room retains validated ride metadata beside parked state, without changing v1 frames.
if (!motionOnly) {
  const address = 'rides' + Math.random().toString(36).slice(2,7), sockets = [];
  const connect = async () => {
    const ws = raw(address), events = []; sockets.push(ws); ws.binaryType = 'arraybuffer';
    ws.onmessage = e => events.push(typeof e.data === 'string' ? JSON.parse(e.data) : e.data);
    await new Promise((resolve,reject) => {ws.onopen=resolve;ws.onerror=reject;});
    await until(()=>events.some(e=>e.t==='hello'),'real server hello');
    assert.equal(events.find(e=>e.t==='hello').rides,true,'real server advertises ride metadata');return {ws,events};
  };
  try {
    const a = await connect(), id = a.events.find(e=>e.t==='hello').id;
    a.ws.send(JSON.stringify({t:'ride',ride:{kind:'truck',trailer:true}}));await barrier(a);
    const b = await connect();
    assert.deepEqual(b.events.find(e=>e.t==='hello').peers.find(p=>p.id===id).ride,{kind:'truck',trailer:true});
    a.ws.send(JSON.stringify({t:'ride',ride:{kind:'truck',trailer:false}}));
    await until(()=>b.events.some(e=>e.t==='ride'),'the ride change');
    assert.deepEqual(b.events.findLast(e=>e.t==='ride').ride,{kind:'truck',trailer:false});
    const count=b.events.filter(e=>e.t==='ride').length;
    // The state after the unknown ride is the marker: anything relayed for the ride would reach b before it.
    a.ws.send(JSON.stringify({t:'ride',ride:{kind:'unknown',trailer:true}}));
    a.ws.send(encodeState({flags:8,steer:0,heading:0,t:1,x:0,z:0,vx:0,vz:0,air:0}));
    await until(()=>b.events.some(e=>e instanceof ArrayBuffer),'the state after the unknown ride');
    assert.equal(b.events.filter(e=>e.t==='ride').length,count,'unknown ride never reaches a peer');
    // b behaves like an old game: no ride announcement, ordinary v1 state.
    b.ws.send(encodeState({flags:8,steer:0,heading:0,t:1,x:0,z:0,vx:0,vz:0,air:0}));
    await until(()=>a.events.some(e=>e instanceof ArrayBuffer),'legacy state still relayed');
    const c=await connect(), peers=c.events.find(e=>e.t==='hello').peers;
    assert.deepEqual(peers.find(p=>p.id===id).ride,{kind:'truck',trailer:false},'invalid change preserves last valid metadata');
    assert.ok(peers.some(p=>p.id!==id&&!p.ride),'old peer has no ride');
    pass('real room ride metadata','hello, attach/drop change, unknown rejection and mixed old/new v1 state');
  } finally {for(const ws of sockets)ws.close();}
}

// ---- stalls of this machine, measured ------------------------------------------------------------------------
// The check runs on shared machines. While this process or the room's runtime waits for a processor, messages
// arrive late and frames are missed: the cars look late for reasons that are not the game's. Both are measured here,
// apart from the room's own code:
//  - this process: a 10 ms timer that fires more than STALL_MS late;
//  - the room's runtime: every player's socket says "ping" each 50 ms. The runtime answers "pong" itself
//    (setWebSocketAutoResponse), without the room's code, so a room that holds back its relays does not delay it.
//    An answer later than STALL_MS marks a stall.
//  - the room's own code: every player's socket also sends a race-sync each 500 ms, which the room's code answers at
//    once (webSocketMessage) without touching any relay. On a shared runner the room's code can wait for a processor
//    longer than the runtime that answers pings (seen in CI: a car 1.2 s without a report, the pings late only well
//    before). A room that holds back its relays still answers these at once, so it is not excused. Two a second, with
//    five reports, stay within the room's eight messages a second.
// A frame with a stall in the second before it is judged by the bad-connection rules, and may be late by that stall
// as well. (Measured under injected stalls, frames over the clean limits came at most 80 ms after a stall ended.)
// On the simulated bad connection a stalled message still has the link's own delay ahead of it, both ways, so there
// the lag may include the stalls of a window longer by twice the link's longest delay. (That pass judges the shape
// by the bad-connection limits anyway.)
// Messages that a stall bunches up also make the game show the others further in the past for a while (net.ts
// raises its delay at once and lowers it by 50 ms a second): that rise over the delay before the stall is allowed
// too, for the lag only, and only as far as the stalls can explain it (see excuse()). Each measurement needs 300
// frames per pair with neither, and a tenth of all its frames, so a game or a room that keeps stalling cannot hide
// behind this. A room whose own code hogs the runtime delays the
// pings as well and is excused like a busy machine while it lasts; only a constant one is caught.
const STALL_MS = 100, PROBE_MS = 50, CODE_PROBE_MS = 500;
let codeEchoes = 0;   // negative race-sync echoes: the game's own (a clock reading) never matches one
const AFTER_STALL_MS = 1000;   // a frame this soon after a stall counts as after it
let lagAfterStall = AFTER_STALL_MS;   // the stalls of this long before a frame may add to its lag
// The rise of the game's delay is evidence of a stall only where the delay otherwise stays at its least: on the clean
// connection, for cars that have been driving. On the bad link, or for a car that has just driven off after a long
// silence, the delay moves for reasons of its own, and there it is not allowed for.
let riseAllowed = false;
const stalls = [], slow = [], probes = new Set();
let ticked = now();   // when the 10 ms timer last ran: a stall of this process is known once it has run after it
{
  // Shorter delays of this timer are kept too: within() counts them, for limits of a few hundred ms.
  let last = now();
  setInterval(() => { const t = ticked = now(); if (t - last > STALL_MS) stalls.push([last, t, 'process']); else if (t - last > 20) slow.push([last, t]); last = t; }, 10).unref();
}
/** How long the machine stalled within [from, to]: the union of the measured stalls that touch it. */
const stalled = (from, to) => {
  const touch = stalls.filter(([a, b]) => a < to && b > from).sort((p, q) => p[0] - q[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of touch) { if (b > end) { total += b - Math.max(a, end); end = b; } }
  return total;
};
const stallBefore = (t) => stalled(t - AFTER_STALL_MS, t);
/** The start of the last stall before t, or -Infinity. */
const lastStall = (t) => stalls.reduce((m, [a]) => (a < t && a > m ? a : m), -Infinity);
/**
 * Waits for an event the game must bring about within `ms`, and checks that it did, allowing for the stalls of this
 * machine while it waited.
 */
const within = async (ms, ready, what, t0 = now()) => {
  await until(ready, what); const t1 = now(); await settle(t1);
  const stall = stalled(t0, t1) + slow.reduce((sum, [a, b]) => (a >= t0 && b <= t1 ? sum + b - a - 10 : sum), 0);
  assert.ok(t1 - t0 <= ms + stall, `${what} took ${(t1 - t0).toFixed(0)} ms (the limit is ${ms} ms plus ${stall.toFixed(0)} ms of stalls and timer delays)`);
};
/** The last frame of a time-ordered log at or before t. */
const atOrBefore = (log, t) => { let lo = 0, hi = log.length - 1, found; while (lo <= hi) { const mid = (lo + hi) >> 1; if (log[mid].t <= t) { found = log[mid]; lo = mid + 1; } else hi = mid - 1; } return found; };
/**
 * What a frame `s` from an observer's log of one car may be excused: the stall in the second before it, and the
 * rise of the game's delay for that car above its value before the last stall. The rise is allowed only as far as
 * the stalls explain it. A stall delays messages by no more than its length, so the jitter estimate cannot rise by
 * more, and the delay (DELAY_MIN plus twice the jitter) by no more than twice the stalls of the last 20 s; once they
 * are over, the game lowers its delay by 50 ms a second, and so does the allowance.
 */
const excuse = (log, s) => {
  const stall = stallBefore(s.t), start = lastStall(s.t);
  const late = Math.max(stall, stalled(s.t - lagAfterStall, s.t));
  if (start === -Infinity) return { stall, late, allow: 0, since: Infinity };
  const end = Math.min(s.t, stalls.reduce((m, [a, b]) => (a < s.t && b > m ? b : m), -Infinity));
  const cap = Math.max(0, 2 * stalled(s.t - 20000, s.t) - 50 * (s.t - end) / 1000);
  const rise = s.delay - (atOrBefore(log, start)?.delay ?? s.delay);
  const allow = riseAllowed && rise > 50 ? Math.min(rise, cap) : 0;
  if (allow && !allowed.has(s)) { allowed.add(s); allowedFrames++; }
  return { stall, late, allow, since: s.t - start };
};
const clean = (log, s) => { const e = excuse(log, s); return !e.stall && !e.allow; };
/**
 * Waits until `o` has drawn `d` in `n` frames since `since`, `free` of them with nothing excused, counted once every
 * stall before them is known. Returns the end of that time.
 */
const measure = async (o, d, since, n, free, what, ms = 60000) => {
  const t0 = now(); let end = 0;
  const enough = (to) => {
    const log = o.seen.get(d.net.me.id) ?? [], seen = o.drawn(d, since).filter((s) => s.t <= to);
    return seen.length >= n && seen.filter((s) => clean(log, s)).length >= free;
  };
  for (;;) {
    await until(() => enough(end = now()), what, Math.max(1, ms - (now() - t0)));
    await settle(end);
    if (enough(end)) return end;
  }
};
let judgedLate = 0, allowedFrames = 0;
const allowed = new WeakSet();
// The last line, also when the check fails: what it measured of this machine (tools/check-mp.sh --mutations reads it).
process.on('exit', (code) => {
  // Separate stalls, each counted once. A probe in flight while this process stalls is answered late too: the room's
  // runtime is counted only where no stall of this process explains it, and its code only where neither does.
  const explains = { process: [], room: ['process'], code: ['process', 'room'] };
  const count = (kind) => {
    const own = stalls.filter(([a, b, k]) => k === kind && !stalls.some(([c, d, j]) => explains[kind].includes(j) && c < b && d > a))
      .sort((p, q) => p[0] - q[0]);
    let n = 0, end = -Infinity;
    for (const [a, b] of own) { if (a > end) n++; end = Math.max(end, b); }
    return n;
  };
  console.log(`\nmultiplayer check: ${code ? 'FAILED' : `${results.length} parts passed`}${motionOnly ? ' (motion only)' : ''}; stalls measured: ${count('process')} of this process, ${count('room')} of the room's runtime alone, ${count('code')} of the room's code alone; ${judgedLate} judged frames came after a stall; ${allowedFrames} frames had a delay allowance`);
});
/** Waits until every probe sent before `at` is answered, so no stall before `at` is still unknown. */
const settle = (at) => until(() => ticked > at && [...probes].every((p) => !p.length || p[0].at > at), 'the room to answer its pings');

/**
 * A connection with trouble in it. Messages keep their order, as on a real connection: a late one holds back all
 * that follow it. `stall` is the chance that a message waits for a resend. The trouble is drawn from seeded
 * generators, one for each way of each connection (MP_SEED and the order of the connections), so the n-th message
 * on a lane always meets the same trouble and a failing run can be repeated.
 */
const SEED = Number(process.env.MP_SEED ?? 1194) >>> 0;
let lanesMade = 0;
const generator = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
function link({ delay = 0, jitter = 0, stall = 0, stallMs = 0 } = {}) {
  return (address) => {
    const ws = new WebSocket(address, { headers: { Origin: ORIGIN } });
    ws.binaryType = 'arraybuffer';
    // One queue each way. A timer only ever releases the head of its queue, so two messages due in the same
    // millisecond cannot change places.
    const lane = () => ({ at: 0, queue: [], random: generator(SEED + 0x9E3779B9 * ++lanesMade) });
    const lanes = { in: lane(), out: lane() };
    const drain = (lane) => {
      while (lane.queue.length && lane.queue[0].at <= now()) lane.queue.shift().fn();
      if (lane.queue.length) setTimeout(drain, Math.max(1, lane.queue[0].at - now()), lane);
    };
    const later = (name, fn) => {
      const lane = lanes[name];
      const r = lane.random, wait = delay + r() * jitter, extra = r() < stall ? r() * stallMs : 0;
      lane.at = Math.max(lane.at, now() + wait + extra);
      lane.queue.push({ at: lane.at, fn });
      if (lane.queue.length === 1) setTimeout(drain, Math.max(0, lane.at - now()), lane);
    };
    // Pings, in the order the runtime answers them. The game's own (every 25 s) pass on to it; the probes do not.
    const pings = [], syncs = []; let probe = 0, codeProbe = 0;
    const ping = (game) => { ws.send('ping'); pings.push({ at: now(), game }); };
    const shim = {
      binaryType: 'arraybuffer', onopen: null, onmessage: null, onclose: null, onerror: null,
      get readyState() { return ws.readyState; },
      send: (data) => later('out', () => { if (ws.readyState === 1) { if (data === 'ping') ping(true); else ws.send(data); } }),
      close: () => ws.close(),
      cut: () => ws.close(),   // the far end vanishes
    };
    ws.onopen = (ev) => {
      probes.add(pings); probes.add(syncs);
      probe = setInterval(() => { if (ws.readyState === 1) ping(false); }, PROBE_MS);
      codeProbe = setInterval(() => {
        if (ws.readyState !== 1) return;
        const echo = -++codeEchoes; syncs.push({ at: now(), echo }); ws.send(JSON.stringify({ t: 'race-sync', echo }));
      }, CODE_PROBE_MS);
      shim.onopen?.(ev);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong' && pings.length) {
        const p = pings.shift(), t = now();
        if (t - p.at > STALL_MS) stalls.push([p.at, t, 'room']);
        if (!p.game) return;
      }
      if (typeof ev.data === 'string' && ev.data.startsWith('{"t":"race-sync"')) {
        const echo = JSON.parse(ev.data).echo, i = syncs.findIndex((s) => s.echo === echo);
        if (i >= 0) {
          const s = syncs[i], t = now(); syncs.splice(0, i + 1);
          if (t - s.at > STALL_MS) stalls.push([s.at, t, 'code']);
          return;
        }
      }
      later('in', () => shim.onmessage?.({ data: ev.data }));
    };
    ws.onclose = (ev) => { clearInterval(probe); clearInterval(codeProbe); probes.delete(pings); probes.delete(syncs); later('in', () => shim.onclose?.({ code: ev.code })); };
    ws.onerror = (ev) => shim.onerror?.(ev);
    link.last = shim;
    return shim;
  };
}

// ---- paths a bot can drive: where the car is at a moment of its own game time, in ms -----------------------------
const circle = (cx, cz, r, speed, phase = 0) => (t) => {
  const a = phase + (speed / r) * t / 1000;
  return { x: cx + r * Math.sin(a), z: cz - r * Math.cos(a), heading: a + Math.PI / 2, vx: speed * Math.cos(a), vz: speed * Math.sin(a) };
};
const straight = (x0, z0, heading, speed) => (t) => ({
  x: x0 + Math.sin(heading) * speed * t / 1000, z: z0 - Math.cos(heading) * speed * t / 1000, heading,
  vx: Math.sin(heading) * speed, vz: -Math.cos(heading) * speed,
});
const parked = (x, z, heading = 1) => () => ({ x, z, heading, vx: 0, vz: 0 });

class Bot {
  constructor(name, path, room, trouble) {
    this.name = name; this.seen = new Map(); this.on = [];
    this.net = new Net({ urls: [].concat(room).map(url), socket: link(trouble) });
    // The game's own clock: one frame moves the car by at most 0.1 s, however long the frame took (as web/src/main.ts
    // does). Driven by the wall clock, a bot that the machine stalls for half a second would jump 15 m, and its game
    // would rightly send that as a reset.
    this.clock = 0; this.last = now(); this.times = [this.last]; this.clocks = [0];
    this.legs = [{ from: -Infinity, at: 0, path }];
    this.resume();
  }
  /** From the next frame on, the car drives `path`, from its start. */
  drive(path) { this.legs.push({ from: this.clock, at: this.clock, path }); }
  /** From the next frame on, the car drives the same path changed by `change`. */
  shift(change) { const leg = this.legs.at(-1); this.legs.push({ from: this.clock, at: leg.at, path: (t) => change(leg.path(t)) }); }
  /** The game time at a moment of this process's clock, as this game's frames advanced it. */
  clockAt(at) {
    const ts = this.times; let lo = 0, hi = ts.length - 1;
    if (at <= ts[0]) return this.clocks[0];
    if (at >= ts[hi]) return this.clocks[hi];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] <= at) lo = mid; else hi = mid; }
    return this.clocks[lo] + (this.clocks[hi] - this.clocks[lo]) * (at - ts[lo]) / (ts[hi] - ts[lo]);
  }
  state(clock, leg = this.legs.findLast((l) => l.from < clock) ?? this.legs[0]) { return leg.path(clock - leg.at); }
  /** Where this car truly was at a moment of this process's clock. */
  truth(at) { return this.state(this.clockAt(at)); }
  frame() {
    const t = now();
    this.clock += Math.min(t - this.last, 100); this.last = t; this.times.push(t); this.clocks.push(this.clock);
    if (this.net.status === 'on') this.on.push(t);
    this.net.report({ ...this.state(this.clock), steer: 0, air: 0, flags: 0 }, t);
    for (const v of this.net.views(t)) {
      let log = this.seen.get(v.id);
      if (!log) this.seen.set(v.id, log = []);
      const peer = this.net['peers'].get(v.id);
      log.push({ t, x: v.x, z: v.z, heading: v.heading, alpha: v.alpha, name: v.name, delay: peer?.delay ?? 0, heard: peer?.heard ?? t });
    }
  }
  drawn(other, since) {
    assert.ok(other.net.me, `${other.name} is in the room (${other.net.status})`);
    return (this.seen.get(other.net.me.id) ?? []).filter((s) => s.t >= since);
  }
  /** A tab in the background: no frames and no heartbeat, the socket stays open. */
  pause() { clearInterval(this.timer); clearInterval(this.beat); }
  // As the game does (web/src/mp/index.ts): a heartbeat every 20 s while visible keeps a parked car's seat, which the
  // room otherwise expires after 60 s without a report.
  resume() { this.timer = setInterval(() => this.frame(), 16); this.beat = setInterval(() => this.net.heartbeat(), 20000); }
  stop() { this.pause(); this.net.stop(); }
}

/** For each frame `observer` drew of `driver`: how far from the path the driver's game drove, how far in the past, how fast it stepped. */
function follow(observer, driver, since, to = Infinity) {
  const all = observer.seen.get(driver.net.me.id) ?? [], log = all.filter((s) => s.t >= since && s.t <= to);
  return log.map((s, i) => {
    let err = Infinity, lag = 0;
    for (let l = 0; l <= 4000; l += 10) {
      const p = driver.truth(s.t - l), e = Math.hypot(p.x - s.x, p.z - s.z);
      if (e < err) { err = e; lag = l; }
    }
    const p = log[i - 1], step = p ? Math.hypot(s.x - p.x, s.z - p.z) / Math.max(1, s.t - p.t) * 1000 : 0;
    return { t: s.t, err, lag, step, ...excuse(all, s) };
  });
}
const BAD = { p95: 1.2, max: 5, lag: 1900, step: 2.2 };
/**
 * Judges the frames from follow(). Frames with no stall in the second before them meet `limit`. A frame after a
 * stall meets the bad-connection limits, and its lag may also include the stall. `share`: the least share of frames
 * that must be free of stalls.
 */
function judgeFrames(frames, limit, top, what, { share = 0.1, slack = 8 } = {}) {
  const free = frames.filter((f) => !f.stall && !f.allow).length;
  assert.ok(frames.length && free >= share * frames.length,
    `${what}: ${free} of ${frames.length} frames free of stalls of this machine and their after-effects`);
  const clean = frames.filter((f) => !f.stall), late = frames.filter((f) => f.stall);
  const errs = clean.map((f) => f.err).sort((a, b) => a - b), p95 = errs[Math.floor(errs.length * 0.95)] ?? 0;
  const top1 = (list, key) => list.reduce((a, f) => (f[key] > a[key] ? f : a), { [key]: 0, stall: 0, allow: 0, late: 0 });
  // A game that a stall stops reports its speed but has hardly moved; the curve the others draw between such reports
  // can bulge, but never by more than the car's true travel during the stall.
  const lateMax = (f) => Math.max(limit.max, BAD.max, top * f.late / 1000);
  const worst = top1(clean, 'err'), lateErr = late.find((f) => f.err > lateMax(f)) ?? top1(late, 'err');
  assert.ok(p95 <= limit.p95 && worst.err <= limit.max && lateErr.err <= lateMax(lateErr),
    `${what}: off the true path by ${p95.toFixed(2)} m (95%), ${worst.err.toFixed(2)} m (worst), ${lateErr.err.toFixed(2)} m after ${lateErr.late?.toFixed(0) ?? 0} ms of stall`);
  judgedLate += late.length;
  const near = (f) => (f.since < Infinity ? `; the last stall began ${f.since.toFixed(0)} ms before` : '; no stall before it');
  const lagOver = frames.find((f) => f.lag > limit.lag + f.late + f.allow);
  assert.ok(!lagOver, `${what}: ${lagOver?.lag} ms in the past (limit ${limit.lag} ms, plus ${lagOver?.late.toFixed(0)} ms of stall just before and ${lagOver?.allow.toFixed(0)} ms of delay the game added after a stall${lagOver ? near(lagOver) : ''})`);
  const stepOver = frames.find((f) => f.step > top * (f.stall ? Math.max(limit.step, BAD.step) : limit.step) + slack);
  assert.ok(!stepOver, `${what}: steps at ${stepOver?.step.toFixed(1)} m/s (true ${top})${stepOver ? near(stepOver) : ''}`);
  const lags = frames.map((f) => f.lag).sort((a, b) => a - b);
  return { n: frames.length, late: late.length, p95, max: worst.err, lag: lags[lags.length >> 1], lagMax: lags.at(-1), jump: top1(frames, 'step').step };
}
/** How many reports a moving game sends in its frames: one at most each 1/SEND_HZ s, at the first frame it may. */
const reports = (frames) => { let n = 0, last = -Infinity; for (const t of frames) if (t - last >= 1000 / SEND_HZ) { n++; last = t; } return n; };
// ---- 1. the rules, with no network ---------------------------------------------------------------------
{
  const good = { flags: 0, steer: 0, heading: 1, t: 10, x: 100, z: -50, vx: 3, vz: 4, air: 0 };
  const seat = { id: 7, name: 'x', hue: 0, last: null }, B = 40000;
  const j = (msg, meter = new Meter(), at = 0) => judge(seat, meter, msg, at, B);
  assert.ok('relay' in j(encodeState(good)));
  assert.ok('drop' in j(encodeState(good).slice(0, 23)), 'a short message');
  assert.ok('drop' in j(new ArrayBuffer(25)), 'a long message');
  assert.ok('drop' in j('hello'), 'text');
  assert.ok('drop' in j(encodeState({ ...good, x: 40001 })), 'off the map');
  assert.ok('drop' in j(encodeState({ ...good, vx: 90, vz: 90 })), 'too fast');
  assert.ok('drop' in j(encodeState({ ...good, air: 250 })), 'too high');
  { const b = encodeState(good); new DataView(b).setUint8(1, 2); assert.ok('drop' in j(b), 'another version'); }
  { const b = encodeState(good); new DataView(b).setUint8(2, 128); assert.ok('drop' in j(b), 'an unknown flag'); }
  { const m = new Meter(); assert.ok('relay' in j(encodeState({ ...good, t: 50 }), m)); assert.ok('drop' in j(encodeState({ ...good, t: 49 }), m, 500), 'an older stamp'); }
  { // A flood: the first dozen pass, the rest drop, and then the door.
    const m = new Meter(); let relayed = 0, closed = 0;
    for (let i = 0; i < 200; i++) { const v = j(encodeState({ ...good, t: i }), m, i); if ('relay' in v) relayed++; else if (v.close === CLOSE.rate) closed++; }
    assert.ok(relayed <= 14 && closed > 0, `flood relayed ${relayed}`);
  }
  { // A real game, five a second for a minute, is never dropped.
    const m = new Meter(); let dropped = 0;
    for (let i = 0; i < 300; i++) if ('drop' in j(encodeState({ ...good, t: i * 200 }), m, i * 200 + (i % 7) * 20)) dropped++;
    assert.equal(dropped, 0);
  }
  { // A room that slept makes a new meter from the seat's last report: an older stamp is still refused.
    const m = new Meter(1000);
    assert.ok('drop' in j(encodeState({ ...good, t: 999 }), m), 'a replay after a sleep');
    assert.ok('relay' in j(encodeState({ ...good, t: 1001 }), m, 300));
  }
  { // A join that hangs, with no answer and no error, is given up and tried again.
    let made = 0;
    const stuck = () => { made++; return { binaryType: '', readyState: 0, send() {}, close() {}, onopen: null, onmessage: null, onclose: null, onerror: null }; };
    const net = new Net({ urls: ['ws://nowhere/'], socket: stuck, now: () => 0 });
    const car = { flags: 0, steer: 0, heading: 0, x: 0, z: 0, vx: 0, vz: 0, air: 0 };
    for (let t = 0; t <= 60000; t += 100) net.report(car, t);
    assert.ok(made >= 3 && net.status === 'retry', `a hanging join was retried (${made} tries, ${net.status})`);
  }
  { // A game with a room, played by hand: a fake socket and a clock this check turns.
    let clock = 0;
    const sock = { binaryType: '', readyState: 1, sent: 0, send() { this.sent++; }, close() {}, onopen: null, onmessage: null, onclose: null, onerror: null };
    const net = new Net({ urls: ['ws://fake/'], socket: () => sock, now: () => clock });
    const car = { flags: 0, steer: 0, heading: 0, x: 0, z: 0, vx: 0, vz: 0, air: 0 };
    net.report(car, clock);
    sock.onmessage({ data: JSON.stringify({ t: 'hello', v: 1, id: 1, name: 'A 2', hue: 0, room: 'r', cap: 24, peers: [{ id: 9, name: 'B 3', hue: 1 }] }) });
    const from = (state) => { clock = state.at; sock.onmessage({ data: encodeSnapshot([{ id: 9, body: new Uint8Array(encodeState(state).slice(2)) }]) }); };
    const still = { flags: FLAG.parked, steer: 0, heading: 0, x: 0, z: 0, vx: 0, vz: 0, air: 0 };
    // The other car stands, resets 20 m on, and reports once more. This game draws no frame while that happens.
    from({ ...still, t: 0, at: 1000 });
    clock = 2000; assert.ok(Math.abs(net.views(clock)[0].x) < 1e-6, 'the car stands at its first place');
    from({ ...still, t: 1200, x: 20, flags: FLAG.parked | FLAG.teleport, at: 2200 });
    from({ ...still, t: 1400, x: 20.4, at: 2400 });
    clock = 3200;
    assert.ok(Math.abs(net.views(clock)[0].x - 20.4) < 1e-6, `a reset that no frame saw is still one step (drawn at ${net.views(clock)[0].x.toFixed(2)})`);
    // This game's own car, held in mid-air by a pause: one report, then silence, so the room can sleep.
    const before = sock.sent;
    for (let t = 3200; t < 9200; t += 16) net.report({ ...car, x: 5, air: 1.2 }, t, true);
    assert.ok(sock.sent - before <= 2, `a held car in the air sent ${sock.sent - before} reports in 6 s`);
    // Released, it reports again.
    for (let t = 9200; t < 10200; t += 16) net.report({ ...car, x: 5, air: 1.2 }, t, false);
    assert.ok(sock.sent - before >= 5, 'and it reports again when the game goes on');
  }
  const seats = [];
  for (let i = 0; i < ROOM_CAP; i++) seats.push(takeSeat(seats));
  assert.equal(new Set(seats.map((s) => s.id)).size, ROOM_CAP);
  assert.equal(new Set(seats.map((s) => s.name)).size, ROOM_CAP);
  assert.equal(takeSeat(seats), null);
  assert.ok(seats.every((s) => /^[A-Z][A-Za-z ]+ \d+$/.test(s.name)));
  pass('room rules', 'sizes, version, flags, map edge, speed, clock order, flood, seats and call signs');
}

// ---- 2. the door ---------------------------------------------------------------------------------------
{
  const outcome = (ws) => new Promise((r) => { ws.onopen = () => { ws.close(); r('open'); }; ws.onerror = () => r('refused'); });
  assert.equal(await outcome(raw('door')), 'open');
  assert.equal(await outcome(raw('door', 'https://example.com')), 'refused', 'another site');
  assert.equal(await outcome(raw('door', null)), 'refused', 'no origin');
  assert.equal(await outcome(new WebSocket(`${SERVER}/mp/v2/mabou/door`, { headers: { Origin: ORIGIN } })), 'refused', 'another version');
  assert.equal(await outcome(new WebSocket(`${SERVER}/mp/v1/Bad_Area/door`, { headers: { Origin: ORIGIN } })), 'refused', 'a bad area name');
  assert.equal(await outcome(new WebSocket(`${SERVER}/mp/v1/judique/door`, { headers: { Origin: ORIGIN } })), 'open', 'another area has its own rooms');
  assert.equal(await outcome(new WebSocket(`${SERVER}/mp/v1/mabou/Not_A_Room!`, { headers: { Origin: ORIGIN } })), 'refused', 'a bad room name');
  pass('the door', 'our page gets in; another site, no origin, another version, a bad area name and a bad room name do not');
}


// ---- 3. three players on a clean connection, then on a bad one -------------------------------------------
for (const [label, trouble, limit] of [
  ['clean connection', {}, { p95: 0.25, max: 0.8, lag: 700, step: 1.6 }],
  ['bad connection (150 to 350 ms each way, 4% of messages wait up to 0.8 s more)', { delay: 150, jitter: 200, stall: 0.04, stallMs: 800 }, BAD],
].slice(0, motionOnly ? 1 : 2)) {
  lagAfterStall = AFTER_STALL_MS + 2 * ((trouble.delay ?? 0) + (trouble.jitter ?? 0) + (trouble.stallMs ?? 0));
  riseAllowed = !trouble.delay;
  const room = `t${Math.floor(Math.random() * 1e9).toString(36)}`;
  const bots = [
    new Bot('circle', circle(0, 0, 60, 15), room, trouble),
    new Bot('highway', straight(-900, 300, 1.1, 30), room, trouble),
    new Bot('parked', parked(40, 40), room, trouble),
  ];
  const pairs = bots.flatMap((o) => bots.filter((d) => d !== o).map((d) => [o, d]));
  await until(() => bots.every((b) => b.net.status === 'on' && b.net.count === 2), `all three in the room, each knowing two others (${label})`);
  // Each game first learns the others' clocks and how rough their connection is: 3.5 s of the game's own time.
  await sleep(3500);
  // Then at least 300 frames free of stalls of this machine for each pair (5 s on a quiet machine).
  const since = now(), ends = new Map(), start = now();
  for (const [o, d] of pairs) ends.set(o.name + d.name, await measure(o, d, since, 300, 300, `300 frames free of stalls (${label})`, Math.max(1, 60000 - (now() - start))));
  const end = Math.max(...ends.values());
  const lines = [];
  for (const [o, d] of pairs) {
    assert.equal(o.seen.get(d.net.me.id).at(-1).name, d.net.me.name, 'the call sign the room gave');
    // No snapping: on a clean connection no car is drawn faster than about half again its true speed. After a stall
    // on a bad one it catches up, at no more than about twice its speed.
    const top = d.name === 'highway' ? 30 : d.name === 'circle' ? 15 : 0;
    const f = judgeFrames(follow(o, d, since, ends.get(o.name + d.name)), limit, top, `${o.name} sees ${d.name} (${label})`);
    // The game fades a car only when it has heard nothing from it for 1.5 s (STALE_MS in net.ts). On the clean
    // connection that never happens without a stall of this machine; on the bad one two long waits in a row can
    // keep a car silent that long, and then it rightly starts to fade.
    const faded = o.drawn(d, since).filter((s) => s.t <= end && s.alpha !== 1 && (s.t - s.heard <= 1500 || (!trouble.delay && !stallBefore(s.t))));
    assert.ok(!faded.length, `${d.name} never fades for ${o.name} while it is heard (${faded.length} frames faded, the first ${faded[0] ? (faded[0].t - faded[0].heard).toFixed(0) : 0} ms after the last report)`);
    lines.push(`${o.name} sees ${d.name}: ${f.p95.toFixed(2)} m (95%), ${f.max.toFixed(2)} m worst, ${f.lag} ms behind (worst ${f.lagMax}), fastest step ${f.jump.toFixed(1)} m/s${f.late ? `, ${f.late} of ${f.n} frames after a stall` : ''}`);
  }
  // What it costs: a moving car sends five a second, at the first frame it may; a parked car one message and then nothing.
  const secs = (now() - bots[0].times[0]) / 1000, due = reports(bots[0].on);
  assert.ok(bots[0].net.sent <= secs * SEND_HZ + 2 && Math.abs(bots[0].net.sent - due) <= 1, `a moving car sent ${bots[0].net.sent} in ${secs.toFixed(1)} s, in frames that allowed ${due}`);
  assert.ok(bots[2].net.sent <= 2, `the parked car sent ${bots[2].net.sent}`);
  pass(`three players, ${label}`, `\n  ${lines.join('\n  ')}\n  moving car ${(bots[0].net.sent / secs).toFixed(1)} messages a second, parked car ${bots[2].net.sent} in all`);

  if (label === 'clean connection') {
    // A newcomer sees the parked car at once, though it has been silent for seconds. The parked car sends nothing
    // more, so the only way to see it is the room's word at the join.
    const late = new Bot('late', parked(-40, 10), room, trouble);
    await within(1200, () => late.seen.get(bots[2].net.me.id)?.length, 'the newcomer drawing the parked car');
    const view = late.seen.get(bots[2].net.me.id).at(-1);
    assert.ok(view && Math.hypot(view.x - 40, view.z - 40) < 0.02 && view.alpha === 1, 'the newcomer sees the parked car in its place');
    // The parked car drives off: the others see it start where it stood, with no dash across the gap.
    const off = now();
    bots[2].drive(straight(40, 40, 0.3, 12));
    {
      riseAllowed = false;
      const to = await measure(bots[0], bots[2], off + 100, 140, 60, 'frames of the drive-off');
      const f = judgeFrames(follow(bots[0], bots[2], off + 100, to), { ...limit, p95: 1.0, max: 1.0, lag: Infinity }, 12, 'drive-off from parked', { share: 0, slack: 3 });
      assert.ok(f.n >= 140, `drive-off drawn in ${f.n} frames`);
    }
    // A reset (R) puts a car 300 m away in one frame: the others see it there, and never crossing the ground between.
    const reset = bots[1], road = reset.legs.at(-1);
    reset.shift((p) => ({ ...p, x: p.x + 300 }));
    const before = now();
    // Every drawn place is on the road the car was on, or on that road moved 300 m: never on the ground between.
    // (Measured against the true path at any moment of the last two seconds, so a late frame does not matter. After a
    // stall the game may also carry the last report on for up to 0.5 s, AHEAD_MS in net.ts, past where the car's own
    // stalled clock had got to.)
    const near = (s, shift) => {
      let best = Infinity;
      const from = reset.clockAt(s.t - 2000), to = reset.clockAt(s.t) + (stallBefore(s.t) ? 500 : 0);
      for (let c = to; c >= from; c -= 10) { const p = reset.state(c, road); best = Math.min(best, Math.hypot(p.x + shift - s.x, p.z - s.z)); }
      return best;
    };
    await within(1500, () => { const seen = bots[0].drawn(reset, before); return seen.length > 20 && near(seen.at(-1), 300) < 1; }, 'the reset car arriving at its new place');
    {
      await settle(now());
      const between = bots[0].drawn(reset, before).filter((s) => near(s, 0) > 3 && near(s, 300) > 3);
      assert.equal(between.length, 0, `a reset is one step, not a slide (${between.length} frames on the ground between)`);
    }
    // A short hop (a reset 20 m back along the road) is also one step: nobody sees the car slide over the ground.
    {
      const hopper = bots[2], from = hopper.state(hopper.clock);
      hopper.drive(() => ({ ...from, x: from.x + 20, vx: 0, vz: 0 }));
      const t0 = now();
      await within(1500, () => Math.abs((bots[0].drawn(hopper, t0).at(-1)?.x ?? from.x) - from.x - 20) < 0.05, 'the hop arriving');
      // The car was driving east of north, so before the hop it is drawn at or behind `from`; after it, 20 m on. After
      // a stall the game may carry the last report on for up to 0.5 s (AHEAD_MS in net.ts) before the hop arrives.
      const between = bots[0].drawn(hopper, t0).filter((s) => s.x > from.x + 0.6 + (stallBefore(s.t) ? 0.5 * Math.abs(from.vx) : 0) && s.x < from.x + 19.4);
      assert.equal(between.length, 0, `a 20 m reset is one step (${between.length} frames in between)`);
    }
    // A tab in the background draws no frames for a while. When it returns, it shows the present, not old news.
    {
      const sleeper = bots[0], mover = bots[1];
      sleeper.pause();
      await sleep(3000);   // how long the tab is away
      const back = now();
      sleeper.resume();
      riseAllowed = true;
      const to = await measure(sleeper, mover, back + 60, 40, 20, 'frames after the tab came back');
      judgeFrames(follow(sleeper, mover, back + 60, to), { p95: 1.0, max: 1.0, lag: 600, step: Infinity }, 30, 'back from the background', { share: 0 });
      // The others see the returned car solid again before the next part.
      await until(() => [bots[1], bots[2]].every((o) => { const s = o.seen.get(sleeper.net.me.id)?.at(-1); return s && s.t > back && s.alpha === 1; }), 'the others to see the returned car');
    }
    // A connection that dies: the room tells the others, who drop the car at once; it comes back by itself under a new call sign.
    const victim = bots[1], oldId = victim.net.me.id, cut = now();
    link.last = null; victim.net['ws'].cut();
    await within(600, () => !bots[0].net['peers'].has(oldId), 'the others dropping the lost car');
    assert.ok(!bots[0].net.views(now()).some((v) => v.id === oldId), 'the others no longer draw the lost car');
    await within(4100, () => victim.net.status === 'on' && victim.net.count === 3 && bots[0].net.count === 3 && bots[0].net['peers'].has(victim.net.me.id) && bots[0].drawn(victim, cut).length > 30,
      'the lost game coming back to the room, knowing the three others, known and drawn by them', cut);
    late.stop();
    pass('newcomer, drive-off, reset and a lost connection');
  }
  for (const b of bots) b.stop();
  await sleep(300);
}
lagAfterStall = AFTER_STALL_MS; riseAllowed = false;

// ---- 4. a silent moving car fades ------------------------------------------------------------------------
// Judged in the watcher's own frames against the moment it last heard the car: the game's clock, not this machine's.
if (!motionOnly) {
  const room = `f${Math.floor(Math.random() * 1e9).toString(36)}`;
  const a = new Bot('watcher', parked(0, 0), room), b = new Bot('sleeper', circle(0, 0, 30, 10), room);
  await until(() => b.net.me && a.drawn(b, 0).length > 30, 'the watcher to draw the other car');
  const id = b.net.me.id;
  b.pause();   // the tab went to the background: no more frames, the socket stays open
  const peer = a.net['peers'].get(id);
  await until(() => a.times.at(-1) > peer.heard + 3200, 'the watcher to draw for three seconds after the last report');
  const log = a.seen.get(id), heard = peer.heard;
  const solid = log.filter((s) => s.t > heard && s.t <= heard + 1000);
  assert.ok(solid.length && solid.every((s) => s.alpha === 1), `still solid for one second of silence (${solid.length} frames)`);
  assert.ok(!log.some((s) => s.t > heard + 3000) && !a.net.views(now()).some((v) => v.id === id), 'gone from the picture after three seconds of silence');
  // The game carries the last report on for at most 0.5 s of its own timeline (AHEAD_MS), which runs its delay behind
  // the clock; 0.2 s more lets the drawn car settle. From then on it holds its place.
  const held = log.find((s) => s.t - s.delay - heard >= 700), last = log.at(-1);
  assert.ok(held, 'frames drawn after the game stopped guessing');
  assert.ok(Math.hypot(last.x - held.x, last.z - held.z) < 0.5, `and it did not drive on by itself (${Math.hypot(last.x - held.x, last.z - held.z).toFixed(2)} m after ${(held.t - heard).toFixed(0)} ms of silence)`);
  a.stop(); b.stop();
  pass('a moving car that falls silent', 'holds its place, fades, is not drawn');
}

// ---- 5. a full room, and the next one --------------------------------------------------------------------
if (!motionOnly) {
  const room = `c${Math.floor(Math.random() * 1e9).toString(36)}`;
  const fill = [];
  for (let i = 0; i < ROOM_CAP; i++) fill.push(raw(room));
  await until(() => fill.every((ws) => ws.readyState === 1), `the room to take its full number (${ROOM_CAP})`);
  await sleep(300);
  const extra = raw(room);
  const code = await new Promise((r) => { extra.onclose = (ev) => r(ev.code); });
  assert.equal(code, CLOSE.full, 'one more is told the room is full');
  const bot = new Bot('overflow', parked(1, 1), [room, `${room}b`]);
  await untilOn(bot);
  assert.equal(bot.net.room, `mabou/${room}b`, 'a game sent away from a full room joins the next');
  bot.stop();
  for (const ws of fill) ws.close();
  pass('a full room', `${ROOM_CAP} players, the next goes to the second room`);
}

// ---- a player who leaves is gone for the next one ----------------------------------------------------------
if (!motionOnly) {
  const room = `g${Math.floor(Math.random() * 1e9).toString(36)}`;
  const stays = new Bot('stays', parked(0, 0), room);
  await untilOn(stays);
  for (let round = 0; round < 6; round++) {
    // A page that goes away: sometimes with a polite close, sometimes it just stops (a reload, a closed tab).
    const goes = new Bot('goes', parked(10 + round, 5), room);
    await untilOn(goes); await sleep(400);
    assert.equal(goes.net.status, 'on');
    if (round % 2) { goes.pause(); goes.net['ws'].cut(); } else goes.stop();
    await sleep(round < 2 ? 0 : 150);
    const next = new Bot('next', parked(-10, 5), room);
    await untilOn(next);
    await within(700, () => next.net.count === 1 && next.net.views(now()).length === 1, `round ${round}: the newcomer knowing and drawing only the car that stayed, not one that left`);
    next.stop(); goes.pause();
    await within(300, () => stays.net.count === 0, `round ${round}: the one who stayed being alone again`);
  }
  assert.equal(stays.net.count, 0, 'the one who stayed is alone again');
  stays.stop();
  pass('a player who leaves', 'is not shown to the next player, with a polite close or without one');
}

// ---- 6. a hostile client -----------------------------------------------------------------------------------
if (!motionOnly) {
  const room = `h${Math.floor(Math.random() * 1e9).toString(36)}`;
  const victim = new Bot('victim', parked(0, 0), room);
  await untilOn(victim); await sleep(400);
  const bad = raw(room);
  bad.binaryType = 'arraybuffer';
  await new Promise((r) => { bad.onopen = r; });
  const state = { flags: 0, steer: 0, heading: 0, t: 1, x: 10, z: 10, vx: 0, vz: 0, air: 0 };
  bad.send(encodeState({ ...state, x: 9e6 }));            // off the map
  bad.send(encodeState({ ...state, vx: 300 }));           // too fast (the wire holds 327 m/s)
  bad.send(new ArrayBuffer(4000));                        // junk
  bad.send('{"t":"join","id":99,"name":"A Rude Name","hue":0}');   // a faked event
  bad.send(encodeState(state));                           // the marker: one good report, handled after all the rest
  await until(() => victim.net.heard >= 1 && victim.net.count === 1, 'the good report after the bad ones');
  assert.equal(victim.net.heard, 1, 'none of the bad ones reaches another player');
  assert.ok(victim.net.views(now()).every((v) => v.name !== 'A Rude Name'));
  let t = 2;
  const closed = new Promise((r) => { bad.onclose = (ev) => r(ev.code); });
  const floodStart = now();
  const flood = setInterval(() => { for (let i = 0; i < 50 && bad.readyState === 1; i++) bad.send(encodeState({ ...state, t: t++ })); }, 10);
  const code = await Promise.race([closed, sleep(30000).then(() => 'still open')]);
  clearInterval(flood);
  assert.ok(code === CLOSE.rate || code === CLOSE.bad, `a flood is shown the door (${code})`);
  // The room lets through a dozen at once and then eight a second, however many are sent. The room's time for the
  // flood lies inside this process's time from the first message to the close.
  const allowed = 14 + 8 * (now() - floodStart) / 1000;
  // The room tells the victim the car left after all it relayed from it: count once that word has arrived.
  await within(300, () => victim.net.count === 0, 'the flooding car going');
  const flooded = victim.net.heard - 1;
  assert.ok(flooded <= allowed, `a flood of ${t} messages reached the other player as ${flooded} (the limit allows ${allowed.toFixed(0)})`);
  victim.stop();
  pass('a hostile client', `bad places, speeds, junk and faked events are dropped; a flood of ${t} messages was cut to ${flooded} and closed`);
}

if (!motionOnly) await raceCheck(raw);

// A ping in flight while this process stalls is answered late too: count only the room's stalls that are not that.
process.exit(0);
