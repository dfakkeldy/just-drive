// Today's board on the real Worker (wrangler dev, this machine only): post and read, every refusal over HTTP, one post
// per device, the top 100 kept in SQLite (read back after a restart), the off switch and the 60-day alarm.
// Bundled and run by tools/check-board.sh, which starts and stops the servers. BOARD_SERVER: http://127.0.0.1:<port>.
// PHASE: main (a fresh board), restart (the same storage, after a restart), off (BOARD:off), expiry (a short alarm).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { BOARD_KEEP, REFUSALS, boardPath, newDevice, replay, readBoard, MAX_BODY } from '../web/src/board-rules.ts';
import { DAILY_LIMIT as DAILY_LIMIT_SECONDS, atlanticDate, dailyPlan, dayBefore, drawCard, supplyFor } from '../web/src/daily-rules.ts';

const server = process.env.BOARD_SERVER, phase = process.env.PHASE ?? 'main';
const ORIGIN = 'http://127.0.0.1:5173';
const ALL = { boxes: true, lawns: true, relief: true, painter: true, fish: true };
// The run's day: today in Mabou, as the server reckons it.
const date = atlanticDate(new Date()), plan = dailyPlan(date, 'mabou'), squares = drawCard(plan.seed, supplyFor(plan, ALL));
const KINDS = ['box:rock', 'box:lean', 'box:dent', 'box:down', 'lawnMail', 'ditchMail', 'lawnDamage', 'rut', 'boxDown', 'flag', 'late', 'relief'];
let addresses = 0;
/** A post from a new address (the Worker reads CF-Connecting-IP; locally a test may set it). */
async function post(body, { origin = ORIGIN, address = `10.1.${addresses >> 8 & 255}.${addresses++ & 255}`, raw, day = date, area = 'mabou' } = {}) {
  const r = await fetch(`${server}${boardPath(area, day)}`, { method: 'POST', body: raw ?? JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': address, ...(origin ? { Origin: origin } : {}) } });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* plain text answers: 403, 404, 405 */ }
  return { status: r.status, json, text, headers: r.headers };
}
async function read(day = date, address = `10.2.0.${addresses++ & 255}`) {
  const r = await fetch(`${server}${boardPath('mabou', day)}`, { headers: { 'CF-Connecting-IP': address } });
  const text = await r.text();
  return { status: r.status, text, board: r.ok ? readBoard(JSON.parse(text)) : null };
}
/** n facts, one each `gap` seconds, scored honestly. */
function run(n, gap = 2, handle = 'Frost Heave', device = newDevice(randomBytes(16))) {
  const events = Array.from({ length: n }, (_, i) => [KINDS[i % KINDS.length], 1 + i * gap]), r = replay(squares, events);
  return { v: 1, area: 'mabou', date, seed: plan.seed, supply: ALL, events, played: DAILY_LIMIT_SECONDS,
    claim: { points: r.total, step: r.step, time: r.firedAt ?? DAILY_LIMIT_SECONDS, squares: r.filled }, handle, device };
}
const refused = (res, error) => {
  assert.equal(res.status, REFUSALS[error].status, `${error}: ${res.status} ${res.text}`);
  assert.equal(res.json?.error, error); assert.equal(res.json?.text, REFUSALS[error].text);
};

if (phase === 'main') {
  const empty = await read();
  assert.equal(empty.status, 200); assert.deepEqual(empty.board, { v: 1, area: 'mabou', date, posts: 0, rows: [] }, 'a board nobody posted to is empty');
  // Posted: the server's own score, its rank, the board; no device id comes back, ever.
  const mine = run(40, 3, 'Washboard 7'), first = await post(mine);
  assert.equal(first.status, 200, first.text);
  const expected = replay(squares, mine.events);
  assert.deepEqual({ id: first.json.id, rank: first.json.rank, posts: first.json.posts }, { id: 1, rank: 1, posts: 1 });
  assert.deepEqual(first.json.board.rows, [{ id: 1, handle: 'Washboard 7', points: expected.total, step: expected.step, time: expected.firedAt ?? DAILY_LIMIT_SECONDS,
    squares: expected.filled, vehicle: plan.vehicle }], 'the row: handle, points, step, time, squares, vehicle (and its id)');
  assert.ok(!first.text.includes(mine.device), 'the device id is never sent back');
  assert.equal(first.headers.get('access-control-allow-origin'), ORIGIN, 'a local test page on another port may read the answer');
  const again = await read();
  assert.deepEqual(again.board.rows, first.json.board.rows); assert.ok(!again.text.includes(mine.device));
  // A lower claim is stored at the rules' points; a higher one is refused.
  const low = run(20, 4, 'Cold Coffee'); low.claim = { points: 1, step: 0, time: 1, squares: 0 };
  const lowed = await post(low);
  assert.equal(lowed.status, 200); assert.equal(lowed.json.board.rows.find(r => r.id === lowed.json.id).points, replay(squares, low.events).total);
  // A drift carries its size, and the Worker pays it as the game does.
  const drifty = run(6, 3, 'Side Slip'); drifty.events.splice(2, 0, ['drift', 6.5, 42.5, 31.25, 14.1, 0, 1]);
  const dr = replay(squares, drifty.events); drifty.claim = { points: dr.total, step: dr.step, time: dr.firedAt ?? DAILY_LIMIT_SECONDS, squares: dr.filled };
  const drifted = await post(drifty);
  assert.equal(drifted.status, 200, drifted.text); assert.equal(drifted.json.board.rows.find(r => r.id === drifted.json.id).points, dr.total);
  assert.ok(dr.total > replay(squares, drifty.events.map(([k, t]) => [k, t])).total, 'the size is paid');
  const high = run(20, 4); high.claim.points += 1;
  refused(await post(high), 'above');
  // One post per device.
  refused(await post({ ...run(10), device: mine.device }), 'posted');
  // The same result again from the same device (its answer was lost on the way): its place again, not a second row.
  const lost = await post(mine);
  assert.equal(lost.status, 200, lost.text); assert.deepEqual({ id: lost.json.id, rank: lost.json.rank, posts: lost.json.posts }, { id: 1, rank: 1, posts: 3 });
  // Another day, another area, another seed; the events; the shape; a rude handle.
  refused(await post({ ...run(10), date: dayBefore(dayBefore(date)) }, { day: dayBefore(dayBefore(date)) }), 'day');
  const tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);
  refused(await post({ ...run(10), date: tomorrow }, { day: tomorrow }), 'day');
  refused(await post({ ...run(10), area: 'judique' }, { area: 'judique' }), 'area');
  refused(await post({ ...run(10), seed: plan.seed ^ 1 }), 'seed');
  refused(await post({ ...run(10), events: [['box:rock', 5], ['box:rock', 2]] }), 'events');
  refused(await post({ ...run(10), events: [['moose', 5]] }), 'events');
  refused(await post({ ...run(10), device: 'not-a-device' }), 'shape');
  refused(await post(null, { raw: '{"v":1,' }), 'shape');
  refused(await post(null, { raw: JSON.stringify({ ...run(10), events: Array.from({ length: 5000 }, (_, i) => ['rut', i * .05]) }).padEnd(MAX_BODY + 10) }), 'big');
  const rude = await post(run(10, 5, 'Sh1t Head'));
  assert.equal(rude.status, 200); assert.notEqual(rude.json.board.rows.find(r => r.id === rude.json.id).handle, 'Sh1t Head', 'the word filter, then an invented call sign');
  // Only the game's own page posts; a preflight from it is answered, from elsewhere refused.
  assert.equal((await post(run(10), { origin: 'https://example.org' })).status, 403);
  assert.equal((await post(run(10), { origin: null })).status, 403);
  const pre = await fetch(`${server}${boardPath('mabou', date)}`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204); assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await fetch(`${server}${boardPath('mabou', date)}`, { method: 'OPTIONS', headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await fetch(`${server}${boardPath('mabou', date)}`, { method: 'PUT', headers: { Origin: ORIGIN } })).status, 405);
  assert.equal((await fetch(`${server}/board/v2/mabou/${date}`)).status, 400, 'another version');
  assert.equal((await read(tomorrow)).status, 404, 'no board for a day to come');
  assert.equal((await read('2020-01-01')).status, 404, 'nor for one long deleted');
  assert.equal((await read(dayBefore(date))).status, 200, 'yesterday reads');
  // Bursts from one address: four posts, then refused, whatever they were.
  const burst = [];
  for (let i = 0; i < 6; i++) burst.push((await post(run(10), { address: '10.9.9.9' })).status);
  assert.deepEqual(burst, [200, 200, 200, 200, 429, 429], `posts from one address: ${burst}`);
  refused(await post(run(10), { address: '10.9.9.9' }), 'rate');
  const reads = [];
  for (let i = 0; i < 24; i++) reads.push((await read(date, '10.9.9.8')).status);
  assert.ok(reads.slice(0, 20).every(s => s === 200) && reads.slice(20).every(s => s === 429), `reads from one address: ${reads}`);
  // Fill the board past its top: 110 more players, each a different address and device; the last ten made one offence each.
  let lastDevice = '', ranks = [];
  for (let i = 0; i < 110; i++) {
    const p = i < 100 ? run(12 + (i * 37) % 80, 1 + (i % 5) * .5, `Muddy Culvert ${i % 98 + 2}`) : run(1, 1, `Late Flyer ${i - 98}`);
    const r = await post(p); assert.equal(r.status, 200, r.text);
    ranks.push(r.json.rank); lastDevice = p.device;
  }
  const full = await read();
  assert.equal(full.board.rows.length, BOARD_KEEP, 'the top hundred');
  assert.equal(full.board.posts, 4 + 4 + 110, 'every taken post counted');
  assert.ok(ranks.some(r => r === null), 'a row that falls outside the top hundred has no rank');
  for (let i = 1; i < full.board.rows.length; i++) {
    const a = full.board.rows[i - 1], b = full.board.rows[i];
    assert.ok(a.step > b.step || a.step === b.step && (a.step === 7 ? a.time <= b.time : true), `ordered: ${JSON.stringify([a, b])}`);
  }
  console.log(`PASS board on the Worker: post and read, the server's score, every refusal (day, area, seed, events, above, shape, big, posted, rate), a lost answer answered again, origin and preflight, ${BOARD_KEEP} of ${full.board.posts} kept`);
  // For the next phase: what the board looked like, to compare after a restart.
  console.log(`STATE ${JSON.stringify({ rows: full.board.rows, posts: full.board.posts, dropped: ranks.findIndex(r => r === null), device: lastDevice, mine, low })}`);
} else if (phase === 'restart') {
  const before = JSON.parse(process.env.STATE);
  const after = await read();
  assert.deepEqual(after.board.rows, before.rows, 'the same hundred rows come back from SQLite: the dropped rows were deleted, not only hidden');
  assert.equal(after.board.posts, before.posts);
  refused(await post({ ...run(10), device: before.device }), 'posted');
  // A lost answer, from SQLite: a kept row is answered with its place; a row that fell off says it is gone.
  for (const p of [before.mine, before.low]) {
    const at = before.rows.findIndex(r => r.handle === p.handle && r.id <= 2), again = await post(p);
    if (at >= 0) { assert.equal(again.status, 200, again.text); assert.deepEqual({ rank: again.json.rank, posts: again.json.posts }, { rank: at + 1, posts: before.posts }); }
    else { refused(again, 'posted'); assert.equal(again.json.gone, true); }
  }
  const kept = await post(before.mine), keptAt = before.rows.findIndex(r => r.id === 1);
  assert.ok(keptAt >= 0 ? kept.status === 200 : kept.json?.gone === true, 'the first post, answered again or gone');
  assert.equal((await read()).board.posts, before.posts, 'no new row');
  const branches = [before.mine, before.low].map(p => before.rows.some(r => r.handle === p.handle && r.id <= 2) ? 'answered again' : 'gone').join(' and ');
  console.log(`PASS board after a restart: the same ${after.board.rows.length} rows and ${after.board.posts} posts from storage; a device posts once, also after a restart; lost answers ${branches}`);
} else if (phase === 'off') {
  refused(await post(run(10)), 'off');
  const r = await fetch(`${server}${boardPath('mabou', date)}`); assert.equal(r.status, 503);
  console.log('PASS board off: posts and reads say to try later');
} else if (phase === 'expiry') {
  const r = await post(run(10));
  assert.equal(r.status, 200, r.text);
  assert.equal((await read()).board.rows.length, 1);
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { await new Promise(done => setTimeout(done, 250)); gone = (await read()).board.posts === 0; }
  assert.ok(gone, 'the board deleted itself at its alarm');
  assert.deepEqual((await read()).board.rows, []);
  console.log('PASS board expiry: the alarm deletes the whole board (rows, device ids, count)');
}
