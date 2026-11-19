// Imported by mp-check: a short round of parcel tag between real local WebSockets and the room server (wrangler dev,
// started by tools/check-mp.sh with GAME_ROUND_S set so the round lasts seconds, not minutes).
import assert from 'node:assert/strict';
import { encodeState, FLAG, TYPE } from '../web/src/mp/wire.ts';
import { decodeGame, PHASE } from '../web/src/mp/game-wire.ts';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIELD = { roads: [[-300, 0, 300, 0], [0, -300, 0, 300]], quiet: [] };
export async function tagCheck(raw) {
  const room = 'tag' + Math.random().toString(36).slice(2, 8), clients = [];
  const until = async (f, what, ms = 60000) => {
    const end = performance.now() + ms;
    while (!f()) { if (performance.now() > end) throw new assert.AssertionError({ message: `tag: waited for ${what}; ` + JSON.stringify(clients.map(c => ({ who: c.who, id: c.id, frame: c.frame })) ) }); await sleep(30); }
  };
  const connect = async (who, games = true) => {
    const ws = raw(room), c = { who, ws, id: 0, frame: null, frames: 0, bytes: 0, binaries: [], hello: null, t: 0 }; clients.push(c);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = e => {
      if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.t === 'hello') { c.id = m.id; c.hello = m; if (games && m.games) ws.send('{"t":"game-sync"}'); } return; }
      const type = new Uint8Array(e.data)[0]; c.binaries.push(type);
      if (type === TYPE.game) { const f = decodeGame(e.data); assert.ok(f, 'a well-formed game frame'); c.frame = f; c.frames++; c.bytes = Math.max(c.bytes, e.data.byteLength); }
    };
    await until(() => c.id && (!games || c.frame), `${who} to join`);
    return c;
  };
  const send = (c, x, z, vx = 0, vz = 0, flags = 0) => c.ws.send(encodeState({ x, z, t: ++c.t * 200, flags: flags | (vx || vz ? 0 : FLAG.parked), heading: 0, steer: 0, vx, vz, air: 0 }));
  const start = c => c.ws.send(JSON.stringify({ t: 'game-control', action: 'start', game: 'tag', field: FIELD }));
  try {
    const old = await connect('an old game (no game-sync)', false);
    const a = await connect('host'), b = await connect('guest');
    assert.equal(a.hello.games, true, 'the room says it runs games');
    await until(() => a.frame.host === a.id && b.frame.host === a.id, 'both to see the host');
    assert.equal(a.frame.phase, PHASE.free);
    // A repeated game-sync is answered to its sender only: no broadcast, no storage write for everyone.
    const heard = a.frames, asked = b.frames;
    for (let i = 0; i < 5; i++) { b.ws.send('{"t":"game-sync"}'); await sleep(150); }
    await until(() => b.frames >= asked + 5, 'the repeats to be answered');
    assert.equal(a.frames, heard, 'nobody else hears a repeated game-sync');
    send(a, -100, 0); send(b, 100, 0); await sleep(400);
    start(b); await sleep(400); assert.equal(b.frame.phase, PHASE.free, 'a guest cannot start a game');
    a.ws.send(JSON.stringify({ t: 'game-control', action: 'start', game: 'tag', field: { roads: [[0, 0, 70000, 0]], quiet: [] } }));
    await sleep(400); assert.equal(a.frame.phase, PHASE.free, 'a field outside the bounds is refused');
    start(a);
    await until(() => a.frame.phase === PHASE.countdown && b.frame.phase === PHASE.countdown, 'the countdown');
    assert.equal(a.frame.serial, b.frame.serial); assert.deepEqual(a.frame.tag.centre, { x: 0, z: 0 }, 'a fair start between them');
    const late = await connect('late joiner');
    assert.notEqual(late.frame.phase, PHASE.free, 'a late joiner gets the state');
    await until(() => a.frame.phase === PHASE.play && b.frame.phase === PHASE.play, 'play to start (the room wakes itself)', 15000);
    // The host drives over the parcel.
    for (const x of [-12, -8, -4, 0, 4, 8]) { send(a, x, 0, 20, 0); await sleep(200); }
    await until(() => a.frame.tag.holder === a.id && b.frame.tag.holder === a.id, 'the host to hold the parcel');
    for (let x = 10; x < 40; x += 2) { send(a, x, 0, 10, 0); await sleep(200); }
    await until(() => (b.frame.table.find(r => r.id === a.id)?.score ?? 0) >= 2, 'the holder to score');
    // The guest closes in head-on and steals it.
    send(a, 40, 0, .6, 0); send(b, 50, 0, -15, 0); await sleep(200);
    send(a, 40.1, 0, .6, 0); send(b, 39, 0, -15, 0);
    await until(() => a.frame.tag.holder === b.id, 'the guest to steal it');
    assert.ok(b.frame.tag.immune > 0 && b.frame.tag.immune <= 3000, 'a fresh holder is shielded');
    // A reset drops it where the car was: the same refusal of jumps as the race.
    await sleep(300); send(b, 37, 0, -10, 0); await sleep(200);
    send(b, 0, 250, 0, 0, FLAG.teleport);
    await until(() => a.frame.tag.holder === 0, 'a reset to drop the parcel');
    assert.ok(Math.abs(a.frame.tag.parcel.x - 37) < .5 && Math.abs(a.frame.tag.parcel.z) < .5, 'dropped where the car was: ' + JSON.stringify(a.frame.tag.parcel));
    await until(() => a.frame.phase === PHASE.over && b.frame.phase === PHASE.over && late.frame.phase === PHASE.over, 'the round to end', 45000);
    assert.deepEqual(a.frame.table, b.frame.table, 'everyone sees the same final table');
    assert.deepEqual(a.frame.table, late.frame.table);
    const score = id => a.frame.table.find(r => r.id === id)?.score ?? 0;
    assert.ok(score(a.id) >= 2 && score(b.id) >= 0, JSON.stringify(a.frame.table));
    assert.deepEqual(a.frame.table.map(r => r.id).sort(), [a.id, b.id].sort(), 'the late joiner far off never joined the table');
    await until(() => a.frame.phase === PHASE.free && b.frame.phase === PHASE.free, 'free driving again', 45000);
    assert.ok(!old.binaries.includes(TYPE.game), 'an old game never hears a game frame');
    assert.ok(old.binaries.includes(TYPE.snapshot), 'it still sees the cars');
    assert.ok(a.bytes <= 13 + 4 * 3 + 22, `small frames: ${a.bytes} bytes`);
    console.log(`PASS tag: two local clients play a round (host start, guest refused, bounds refused, countdown, late joiner, pickup, scoring, steal, immunity, reset drop, shared final table, free driving after); ${a.frames} frames of at most ${a.bytes} bytes; an old game hears none`);
  } finally { for (const c of clients) c.ws.close(); }
}
