// Today's board: what the server takes and refuses (board-rules.ts), the game's real Shift, FiredRun and DailyRun
// scoring runs that the server scores again to the same points, and the board block on the end card (board.ts) with a
// stand-in server built from the same rules. Bundled and run by tools/board-rules-mutations.mjs (cwd web/), never alone.
import assert from 'node:assert/strict';
import {
  BOARD_KEEP, BOARD_DAYS, BURST, GRACE_MS, MAX_EVENTS, MAX_RUN, POSTS_PER_BOARD, SENT_KINDS, SLACK, DEVICE, BOARD_PATH, REFUSALS, POST_RATE, READ_RATE,
  BoardBook, Meters, addressKey, ceiling, expiresAt, judgePost, newDevice, postDay, rankText, readBoard, readableDay, replay, rowOrder, sendsEvent, boardPath,
} from '../web/src/board-rules.ts';
import { DAILY_LIMIT, CARD_SIZE, LINES, atlanticDate, bingoBonus, dailyPlan, dayBefore, drawCard, supplyFor, packFilled, resultText, DAILY_KEY } from '../web/src/daily-rules.ts';
import { LADDER, PENALTIES, POINTS, ScoreBook } from '../web/src/score-rules.ts';
import { BingoCard } from '../web/src/daily-rules.ts';
import { readHandle } from '../web/src/mp/social.ts';
import { Shift } from '../web/src/shift.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { FiredRun } from '../web/src/fired.ts';
import { DailyRun } from '../web/src/daily.ts';
import { BOARD_KEY, VEHICLE_NAMES, boardDevice, deviceSecret, savedEntry, rowResultText } from '../web/src/board.ts';
import { CLOCK_FACTOR } from '../web/src/shift-rules.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { GARAGE } from '../web/src/garage.ts';

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; };
// A seeded random, so a failure is the same failure next time.
const rng = seed => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const ALL = { boxes: true, lawns: true, relief: true, painter: true, fish: true };
const DATE = '2026-11-17', NOW = Date.parse('2026-11-17T16:00:00Z');   // noon in Mabou
const device = n => newDevice(Uint8Array.from({ length: 16 }, (_, i) => i < 2 ? n >> 8 * i & 255 : (n * 131 + i * 17) & 255));
/** A valid post for (date, area): the events, scored by the rules, claimed honestly. */
function makePost(events, { date = DATE, area = 'mabou', supply = ALL, played = DAILY_LIMIT, handle = 'Frost Heave', dev = device(1), claim } = {}) {
  const plan = dailyPlan(date, area), squares = drawCard(plan.seed, supplyFor(plan, supply)), r = replay(squares, events);
  return { v: 1, area, date, seed: plan.seed, supply, events, played,
    claim: claim ?? { points: r.total, step: r.step, time: r.firedAt ?? played, squares: r.filled }, handle, device: dev };
}
const KINDS = Object.keys(POINTS);
/** A busy honest run: a fact every so often, now and then a burst, up to the time limit. */
function honest(random, count = 200, until = DAILY_LIMIT - 1) {
  const out = []; let t = 1 + random() * 3;
  while (out.length < count && t < until) {
    const kind = random() < .03 ? 'schoolBus' : KINDS[Math.floor(random() * KINDS.length)];
    out.push([kind, Math.round(t * 1000) / 1000]);
    t += random() < .2 ? .05 : random() * 3;
  }
  return out;
}
const judge = (post, now = NOW, area = post.area, date = post.date) => judgePost(JSON.parse(JSON.stringify(post)), area, date, now, rng(9));

await ok('an honest run is taken, scored again by the rules, and its row holds only the seven fields and the device id', () => {
  const events = honest(rng(1)), post = makePost(events), v = judge(post);
  assert.equal(v.ok, true, JSON.stringify(v));
  const plan = dailyPlan(DATE, 'mabou'), squares = drawCard(plan.seed, supplyFor(plan, ALL));
  // The rules by hand: Get Fired scores each fact, then the card hears it and pays lines and the card.
  const book = new ScoreBook(), card = new BingoCard(squares);
  for (const [kind, time] of events) {
    const e = { kind, place: 'route', speed: 0, time }; book.add(e);
    const h = card.hear(e); if (h.lines) book.award('bingo:line', h.lines * 600); if (h.full) book.award('bingo:card', 3000);
  }
  assert.equal(v.row.points, Math.round(book.total)); assert.equal(v.row.step, book.step); assert.equal(v.row.squares, packFilled(card.filled));
  assert.deepEqual(Object.keys(v.row).sort(), ['device', 'handle', 'points', 'squares', 'step', 'time', 'vehicle'], 'a row holds nothing else');
  assert.equal(v.row.vehicle, plan.vehicle, 'the vehicle is the day’s own');
  assert.equal(judge({ ...post, vehicle: 'horse' }).row.vehicle, plan.vehicle, 'never the post’s');
  assert.equal(v.row.handle, 'Frost Heave'); assert.equal(v.row.device, post.device);
  assert.equal(v.row.time, v.result.firedAt ?? DAILY_LIMIT);
});

await ok('the server stores its own score: a lower claim is taken at the rules’ points; a higher one, or a faster Fired, is refused', () => {
  const events = honest(rng(2)), post = makePost(events), r = judge(post).result;
  const low = judge({ ...post, claim: { ...post.claim, points: 1, step: 0, squares: 0 } });
  assert.equal(low.ok, true); assert.equal(low.row.points, r.total, 'the computed points, not the claim');
  for (const claim of [{ points: r.total + 1 }, { step: r.step + 1 }, { squares: post.claim.squares | (~r.filled & 511) }])
    assert.deepEqual(judge({ ...post, claim: { ...post.claim, ...claim } }), { ok: false, error: 'above' }, JSON.stringify(claim));
  // A fired run: claiming an earlier Fired is above the rules too.
  const many = []; for (let i = 0; i < 400; i++) many.push([KINDS[i % KINDS.length], 2 + i * .7]);
  const firedPost = makePost(many), f = judge(firedPost);
  assert.equal(f.ok, true); assert.equal(f.row.step, LADDER.length, 'this run is fired'); assert.ok(f.result.firedAt > 0);
  assert.equal(f.row.time, f.result.firedAt, 'a fired row keeps its Fired time');
  assert.deepEqual(judge({ ...firedPost, claim: { ...firedPost.claim, time: f.result.firedAt - 1 } }), { ok: false, error: 'above' });
});

await ok('the ceiling: the score rules’ most for a run of that length, which no run reaches, and which grows with the time', () => {
  assert.ok(ceiling(0) < ceiling(1) && ceiling(1) <= ceiling(5) && ceiling(5) <= ceiling(60) && ceiling(60) <= ceiling(DAILY_LIMIT), 'grows with the run, then holds (each kind pays less the more it is done)');
  assert.equal(MAX_RUN, ceiling(DAILY_LIMIT));
  assert.ok(ceiling(0) < ceiling(1) && ceiling(1) < MAX_RUN && MAX_RUN < 120000 && MAX_RUN > LADDER.at(-1).at, `${ceiling(1)} ${MAX_RUN}`);
  assert.ok(ceiling(0) >= bingoBonus(LINES.length, true));
  // Greedy runs that try hardest: every kind in a burst at the top rung, repeated as fast as the burst rule allows.
  for (let s = 0; s < 40; s++) {
    const random = rng(100 + s), events = []; let t = 0;
    while (events.length < MAX_EVENTS && t < DAILY_LIMIT) { events.push([KINDS[Math.floor(random() * KINDS.length)], t]); if (events.length % BURST === 0) t += 1.001; }
    const plan = dailyPlan(DATE, 'mabou'), r = replay(drawCard(plan.seed, supplyFor(plan, ALL)), events);
    assert.ok(r.total <= ceiling(Math.min(DAILY_LIMIT, t)), `${r.total} within ${ceiling(t)}`);
  }
  // A run that ended at once cannot claim a day's points.
  const quick = makePost([['box:rock', .2], ['box:lean', .3]], { played: .5 });
  assert.deepEqual(judge({ ...quick, claim: { ...quick.claim, points: ceiling(.5) + 1 } }), { ok: false, error: 'above' });
});

await ok('another day or area is refused; a run that ended just after midnight still posts to its own day', () => {
  const post = makePost(honest(rng(3)));
  assert.equal(judge(post).ok, true);
  const tomorrow = dayBefore('2026-11-19');
  assert.deepEqual(judge(makePost(honest(rng(3)), { date: tomorrow })), { ok: false, error: 'day' }, 'tomorrow');
  assert.deepEqual(judge(makePost(honest(rng(3)), { date: '2026-11-16' })), { ok: false, error: 'day' }, 'yesterday at noon');
  assert.deepEqual(judge(makePost(honest(rng(3)), { date: '2026-11-15' })), { ok: false, error: 'day' }, 'two days ago');
  // Midnight in Mabou on 18 Nov is 04:00 UTC. Ten minutes after it, 17 Nov still posts; twenty minutes after, no more.
  const midnight = Date.parse('2026-11-18T04:00:00Z');
  assert.equal(atlanticDate(new Date(midnight + 60e3)), '2026-11-18');
  assert.equal(judge(post, midnight + 10 * 60e3).ok, true, 'within the grace');
  assert.deepEqual(judge(post, midnight + GRACE_MS + 5 * 60e3), { ok: false, error: 'day' }, 'after the grace');
  assert.ok(postDay(DATE, NOW) && !postDay('2026-11-18', NOW) && !postDay('17-11-2026', NOW));
  // Area: one with no route has no board; the post must name the address's own area and day.
  assert.deepEqual(judgePost(JSON.parse(JSON.stringify({ ...post, area: 'judique', seed: dailyPlan(DATE, 'judique').seed })), 'judique', DATE, NOW), { ok: false, error: 'area' });
  assert.deepEqual(judge(post, NOW, 'judique'), { ok: false, error: 'shape' }, 'the body says another area than the address');
  for (const area of ['constructor', 'tostring', 'valueof', 'hasownproperty'])   // names every object has: no board either
    assert.deepEqual(judgePost(JSON.parse(JSON.stringify({ ...post, area })), area, DATE, NOW), { ok: false, error: 'area' }, area);
  assert.deepEqual(judge(post, NOW, 'mabou', '2026-11-16'), { ok: false, error: 'shape' }, 'the body says another day than the address');
  // The seed is the server's own: a run from another day's card is refused even when it claims today.
  assert.deepEqual(judge({ ...post, seed: dailyPlan('2026-11-16', 'mabou').seed }), { ok: false, error: 'seed' });
  assert.deepEqual(judge({ ...post, seed: post.seed ^ 1 }), { ok: false, error: 'seed' });
});

await ok('the card comes from the server’s seed and the supply; a supply that cannot make nine squares is refused', () => {
  const none = { boxes: true, lawns: false, relief: true, painter: false, fish: false };
  assert.deepEqual(judge(makePost([['box:rock', 2]], { supply: none })), { ok: false, error: 'card' });
  // A scene square only on its day: claiming the painter on a plain day changes nothing (supplyFor), so the card is the plain one.
  let plain = '2026-11-01'; while (dailyPlan(plain, 'mabou').scene !== 'none') plain = dayBefore(plain);
  const p = dailyPlan(plain, 'mabou');
  assert.deepEqual(drawCard(p.seed, supplyFor(p, ALL)), drawCard(p.seed, supplyFor(p, { ...ALL, painter: false, fish: false })));
});

await ok('the event list: only kinds that score, in order, inside the run, no more than the burst a second, no more than the most', () => {
  const base = honest(rng(4));
  const bad = {
    'an unknown kind': [...base.slice(0, 5), ['moose', 30], ...base.slice(5)].sort((a, b) => a[1] - b[1]),
    'an animal kind': [['sceneAnimal', 3], ...base],
    'out of order': [...base.slice(0, 3), [base[2][0], base[0][1] - .5], ...base.slice(3)],
    'before the run': [['box:rock', -1], ...base],
    'after the run ended': [...base, ['box:rock', DAILY_LIMIT + SLACK + .5]],
    'a burst': [...base.filter(e => e[1] < 10), ...Array.from({ length: BURST + 1 }, (_, i) => ['rut', 10 + i * .9 / BURST]), ...base.filter(e => e[1] > 12)],
  };
  for (const [name, events] of Object.entries(bad)) assert.deepEqual(judge({ ...makePost(base), events }), { ok: false, error: 'events' }, name);
  // Exactly the burst inside one second is a real busy moment, and is taken.
  const busy = [...Array.from({ length: BURST }, (_, i) => ['rut', 10 + i * .9 / BURST])];
  assert.equal(judge(makePost(busy)).ok, true);
  assert.deepEqual(judge({ ...makePost(base), played: 20 }), { ok: false, error: 'events' }, 'facts after a run that ended at 20 s');
  assert.deepEqual(judge(makePost(base, { played: DAILY_LIMIT + 5 })), { ok: false, error: 'events' }, 'a run longer than the limit');
  const flood = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ['rut', i * .1]);
  assert.deepEqual(judge({ ...makePost([]), events: flood }), { ok: false, error: 'events' }, 'more facts than any run');
  assert.deepEqual(new Set(SENT_KINDS), new Set([...Object.keys(POINTS), ...Object.keys(PENALTIES)]));
  // On the device: what cannot score stays there.
  assert.equal(sendsEvent({ kind: 'box:rock', place: 'route', speed: 4, time: 1 }), true);
  assert.equal(sendsEvent({ kind: 'schoolBus', place: 'route', speed: 4, time: 1 }), true, 'a penalty changes the score');
  for (const e of [{ place: 'cemetery' }, { place: 'church' }, { place: 'busStop' }, { subject: 'animal' }, { subject: 'person' }, { kind: 'sceneAnimal' }])
    assert.equal(sendsEvent({ kind: 'box:rock', place: 'route', speed: 4, time: 1, ...e }), false, JSON.stringify(e));
});

await ok('the shape: a device id made on the device, a handle through the word filter or an invented call sign, nothing malformed', () => {
  const post = makePost(honest(rng(5)));
  for (const [name, change] of Object.entries({ 'no device': { device: '' }, 'a short device': { device: 'abc' }, 'an email for a device': { device: 'me@example.com' },
    'version 2': { v: 2 }, 'a string seed': { seed: String(post.seed) }, 'no supply': { supply: null }, 'a half supply': { supply: { boxes: true } },
    'events not a list': { events: {} }, 'an event with a place': { events: [['box:rock', 1, 'route']] }, 'a long handle': { handle: 'x'.repeat(40) },
    'a text claim': { claim: { ...post.claim, points: '9' } }, 'no claim': { claim: undefined } }))
    assert.deepEqual(judge({ ...post, ...change }), { ok: false, error: 'shape' }, name);
  assert.deepEqual(judgePost('not json', 'mabou', DATE, NOW), { ok: false, error: 'shape' });
  assert.deepEqual(judgePost([], 'mabou', DATE, NOW), { ok: false, error: 'shape' });
  for (const handle of ['Sh1t Kicker', 'FUCK', 'x', '<b>bold</b>', 'Assholes 2', '']) {
    const v = judge({ ...post, handle });
    assert.equal(v.ok, true); assert.notEqual(v.row.handle, handle); assert.ok(readHandle(v.row.handle), `${handle} → ${v.row.handle}`);
  }
  assert.equal(judge({ ...post, handle: 'Wobbly 42' }).row.handle, 'Wobbly 42');
  const ids = new Set(Array.from({ length: 200 }, (_, i) => newDevice(Uint8Array.from({ length: 16 }, (_, j) => j < 2 ? i >> 8 * j & 255 : (i * 31 + j * 7) & 255))));
  for (const id of ids) assert.match(id, DEVICE);
  assert.equal(ids.size, 200);
  assert.equal(newDevice(new Uint8Array(16)).length, 22);
});

await ok('the board: one post per device id, the top 100 kept in the game’s own order, a cap on posts a day, no device id in what anyone reads', () => {
  const random = rng(6), seen = new Map(), book = new BoardBook([], 0), rows = [];
  for (let i = 0; i < 160; i++) {
    const step = Math.floor(random() * (LADDER.length + 1)), row = { id: book.posts + 1, handle: `Sleepy Cat ${i}`, points: Math.round(random() * 20000),
      step, time: step >= LADDER.length ? Math.round(random() * 3000) / 10 : 300, squares: Math.floor(random() * 512), vehicle: 'car', device: device(1000 + i) };
    const placed = book.add(row, seen.get(row.device) ?? null); seen.set(row.device, row.id); rows.push(row);
    assert.ok(!('error' in placed));
    if (placed.rank !== null) assert.equal(book.rows[placed.rank - 1], row, 'its rank is its place');
    assert.ok(book.rows.length <= BOARD_KEEP);
  }
  assert.equal(book.rows.length, BOARD_KEEP); assert.equal(book.posts, 160);
  const order = [...rows].sort(rowOrder);
  assert.deepEqual(book.rows.map(r => r.id), order.slice(0, BOARD_KEEP).map(r => r.id), 'the best hundred, best first');
  // The game's own order: a higher rung; between two Fired, the faster; then more squares; then more points; then the earlier post.
  const r = (step, time, squares, points, id) => ({ id, handle: 'a', points, step, time, squares, vehicle: 'car', device: device(id) });
  const F = LADDER.length;
  assert.ok(rowOrder(r(5, 300, 0, 5000, 1), r(4, 300, 511, 9000, 2)) < 0, 'higher rung');
  assert.ok(rowOrder(r(F, 100, 0, 10000, 1), r(F, 200, 511, 20000, 2)) < 0, 'faster Fired');
  assert.ok(rowOrder(r(3, 300, 0b111, 3000, 1), r(3, 300, 0b11, 4000, 2)) < 0, 'more squares');
  assert.ok(rowOrder(r(3, 300, 0b11, 4000, 1), r(3, 300, 0b11, 3000, 2)) < 0, 'more points');
  assert.ok(rowOrder(r(3, 300, 0b11, 4000, 2), r(3, 300, 0b11, 4000, 1)) > 0, 'the earlier post on a tie');
  // A second post from the same device, also after its row fell off the top.
  const dropped = rows.find(x => !book.rows.includes(x));
  assert.deepEqual(book.add({ ...dropped, id: book.posts + 1 }, dropped.id), { error: 'posted', gone: true }, 'its row fell off: the board cannot tell');
  // The same result again from the same device (its answer was lost on the way): its place, unchanged, and nothing new.
  const kept = book.rows[3], before = book.rows.map(x => x.id);
  assert.deepEqual(book.add({ ...kept, id: book.posts + 1, handle: 'Another Name' }, kept.id), { id: kept.id, rank: 4, dropped: [], again: true });
  for (const [k, change] of [['points', 1], ['step', 1], ['time', .1], ['squares', 1]])
    assert.deepEqual(book.add({ ...kept, id: book.posts + 1, [k]: kept[k] + change }, kept.id), { error: 'posted' }, `another result from that device: ${k}`);
  assert.deepEqual(book.add({ ...kept, id: book.posts + 1, device: device(9999) }, kept.id), { error: 'posted' }, 'the seen id belongs to another device');
  assert.deepEqual(book.rows.map(x => x.id), before);
  assert.equal(book.posts, 160, 'a refused post is not counted, nor one answered again');
  const worst = r(0, 1, 0, 0, book.posts + 1), placed = book.add(worst, null);
  assert.equal(placed.rank, null, 'a row outside the top hundred has no rank'); assert.ok(!book.rows.includes(worst));
  assert.deepEqual(placed.dropped, [worst]);
  const full = new BoardBook([], POSTS_PER_BOARD);
  assert.deepEqual(full.add(r(1, 1, 1, 1, POSTS_PER_BOARD + 1), null), { error: 'full' });
  const view = book.view('mabou', DATE), text = JSON.stringify(view);
  assert.equal(view.rows.length, BOARD_KEEP); assert.equal(view.posts, 161);
  for (const row of view.rows) assert.deepEqual(Object.keys(row).sort(), ['handle', 'id', 'points', 'squares', 'step', 'time', 'vehicle']);
  for (const x of rows) assert.ok(!text.includes(x.device), 'no device id is ever read back');
  assert.deepEqual(readBoard(JSON.parse(text)), view, 'the game reads the board as sent');
  for (const broken of [null, { ...view, v: 2 }, { ...view, rows: [{ ...view.rows[0], step: 9 }] }, { ...view, rows: 'x' }, { ...view, rows: Array(101).fill(view.rows[0]) }])
    assert.equal(readBoard(broken), null);
  // A board loaded back from storage is ordered again (rows come back in any order).
  assert.deepEqual(new BoardBook([...book.rows].reverse(), book.posts).rows, book.rows);
});

await ok('a board is deleted after 60 days; it can be read from its day until then, never a day still to come', () => {
  const at = expiresAt(DATE), day = 86400e3;
  assert.ok(at - Date.parse(`${DATE}T04:00:00Z`) === (BOARD_DAYS + 1) * day);
  assert.ok(at > Date.parse('2027-01-16T12:00:00Z') && at < Date.parse('2027-01-18T12:00:00Z'), new Date(at).toISOString());
  assert.equal(readableDay(DATE, NOW), true); assert.equal(readableDay('2026-11-16', NOW), true, 'yesterday');
  assert.equal(readableDay('2026-09-20', NOW), true, 'fifty-eight days ago');
  assert.equal(readableDay('2026-09-10', NOW), false, 'sixty-eight days ago: deleted');
  assert.equal(readableDay('2026-11-18', NOW), false, 'tomorrow');
  assert.equal(readableDay('2026-13-45', NOW), false); assert.equal(readableDay('x', NOW), false);
  assert.equal(readableDay(DATE, at + 1), false, 'not after its alarm');
});

await ok('the rate limit: a burst from one address, then a slow trickle; other addresses unaffected; memory stays bounded', () => {
  const m = new Meters(POST_RATE.burst, POST_RATE.everyMs);
  for (let i = 0; i < POST_RATE.burst; i++) assert.equal(m.allow('a', 1000), true);
  assert.equal(m.allow('a', 1000), false, 'a burst from one address');
  assert.equal(m.allow('b', 1000), true, 'another address');
  assert.equal(m.allow('a', 1000 + POST_RATE.everyMs / 2), false);
  assert.equal(m.allow('a', 1000 + POST_RATE.everyMs + 1), true, 'one more after the wait');
  assert.ok(POST_RATE.burst <= 6 && POST_RATE.everyMs >= 10e3, 'a post a day per player; a script gets little');
  assert.ok(READ_RATE.burst >= 10 && READ_RATE.burst <= 40);
  const small = new Meters(2, 1000, 50);
  for (let i = 0; i < 500; i++) small.allow(`addr${i}`, i);
  assert.ok(small.size <= 50, `bounded: ${small.size}`);
  // The key: an IPv4 address as it is; an IPv6 address by its /64 (one home holds the whole /64).
  assert.equal(addressKey('203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:DB8:1:2:ffff:ffff:ffff:ffff'));
  assert.equal(addressKey('2001:db8:1:2::'), addressKey('2001:db8:1:2:0:0:0:9'));
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.equal(addressKey('2001:db8::1'), addressKey('2001:db8:0:0:5::'));
  assert.notEqual(addressKey('::1'), addressKey('2001:db8::1'));
  assert.equal(addressKey('local'), 'local');
  assert.equal(addressKey('::ffff:203.0.113.7'), '203.0.113.7', 'an IPv4 address written as IPv6 is that IPv4 address');
  assert.notEqual(addressKey('::ffff:203.0.113.7'), addressKey('::ffff:203.0.113.8'));
});

await ok('paths and words', () => {
  assert.equal(boardPath('mabou', DATE), '/board/v1/mabou/2026-11-17');
  assert.deepEqual([...BOARD_PATH.exec('/board/v1/mabou/2026-11-17')].slice(1), ['1', 'mabou', '2026-11-17']);
  assert.equal(BOARD_PATH.exec('/board/v1/mabou/2026-11-17/x'), null);
  assert.equal(rankText(3, 41), '#3 of 41 on the board');
  assert.equal(rankText(null, 1234), 'outside the board’s top 100 (1,234 posted)');
  assert.equal(resultText({ step: 2, total: 900, firedAt: null, filled: 3 }, DATE, 'Mabou', '', rankText(3, 41)).split('\n')[0],
    'Mabou Mail Madness, 17 Nov, Mabou: Verbal warning, 900 points, bingo 2 of 9, #3 of 41 on the board');
  assert.equal(resultText({ step: 2, total: 900, firedAt: null, filled: 3 }, DATE, 'Mabou').split('\n')[0], 'Mabou Mail Madness, 17 Nov, Mabou: Verbal warning, 900 points, bingo 2 of 9');
  for (const id of Object.keys(VEHICLE_NAMES)) assert.equal(VEHICLE_NAMES[id], GARAGE.find(g => g.id === id)?.name, id);
  assert.equal(rowResultText({ step: LADDER.length, points: 12000, time: 222.4 }), 'Fired in 3:42');
  assert.equal(rowResultText({ step: 3, points: 2100, time: 300 }), 'Written warning · 2,100 pts');
  for (const r of Object.values(REFUSALS)) { assert.ok(r.status >= 400 && r.status < 600); assert.doesNotMatch(r.text, /idiot|stupid|cheat|loser/i, 'dry, never cruel'); }
  assert.equal(REFUSALS.posted.status, 409); assert.equal(REFUSALS.rate.status, 429);
});

// ---- The game: the real Shift, FiredRun and DailyRun, in node with a small DOM stand-in (as tools/daily-shift-check.mjs).
const canvasContext = new Proxy({ measureText: text => ({ width: text.length * 11 }) }, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
const drawn = [];
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); }
  hidden = false; disabled = false; textContent = ''; id = ''; value = ''; className = ''; width = 160; height = 90; children = []; listeners = new Map(); attributes = {}; classes = new Set();
  style = { width: '', props: {}, getPropertyValue(k) { return this.props[k] ?? ''; }, setProperty(k, v) { this.props[k] = v; } };
  get classList() { const c = this.classes; return { add: x => c.add(x), remove: x => c.delete(x), toggle: (x, on) => (on ?? !c.has(x)) ? c.add(x) : c.delete(x), contains: x => c.has(x) }; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  after() {} focus() {} blur() {}
  getContext() { if (this.tagName === 'CANVAS') { const texts = []; drawn.push(texts); return new Proxy(canvasContext, { get: (t, k) => k === 'fillText' ? s => texts.push(s) : t[k] }); } return { drawImage() {} }; }
  toDataURL() { return `data:image/png;base64,${drawn.length}`; }
  toBlob(done) { done(null); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  find(id) { for (const c of this.children) { if (!(c instanceof Element)) continue; if (c.id === id) return c; const f = c.find(id); if (f) return f; } return null; }
  all(test, out = []) { for (const c of this.children) { if (!(c instanceof Element)) continue; if (test(c)) out.push(c); c.all(test, out); } return out; }
  click() { return this.listeners.get('click')?.(); }
  get text() { return [this.textContent, ...this.children.map(c => typeof c === 'string' ? c : c.text)].join(' '); }
}
const elements = new Map();
globalThis.document = {
  head: new Element('head'), body: new Element('body'),
  getElementById(id) { if (!elements.has(id)) elements.set(id, Object.assign(new Element(), { id })); return elements.get(id); },
  createElement(tag) { return new Element(tag); },
  execCommand() { return false; },
};
const store = new Map();
const memory = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
Object.defineProperty(globalThis, 'localStorage', { get() { return memory; }, configurable: true });
// The mail game's own address: the board is there (the bundle is built as the published script, VITE_MP=1).
globalThis.location = { hostname: 'mmm.fakkeldy.ca', search: '?daily=1' };
let online = true;
Object.defineProperty(globalThis.navigator, 'onLine', { get: () => online, configurable: true });

// A stand-in board server built from the rules: the door's judge, the board's book and its device list.
const server = { mode: 'up', calls: [], books: new Map(), seen: new Map(), now: NOW };   // mode: up, down, busy, lost (taken, no answer)
globalThis.fetch = async (url, init = {}) => {
  server.calls.push({ url, method: init.method ?? 'GET', body: init.body });
  if (server.mode === 'down') throw new TypeError('fetch failed');
  if (server.mode === 'busy') return new Response('Bad gateway', { status: 502 });
  if (server.mode === 'odd') return new Response(JSON.stringify({ error: 'constructor' }), { status: 400 });   // no refusal the game knows
  const m = BOARD_PATH.exec(new URL(url, 'https://mmm.fakkeldy.ca').pathname), key = `${m[2]}/${m[3]}`;
  const book = server.books.get(key) ?? new BoardBook([], 0), seen = server.seen.get(key) ?? new Map();
  server.books.set(key, book); server.seen.set(key, seen);
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
  if ((init.method ?? 'GET') === 'GET') return json(book.view(m[2], m[3]));
  const v = judgePost(JSON.parse(init.body), m[2], m[3], server.now);
  if (!v.ok) return json({ error: v.error, text: REFUSALS[v.error].text }, REFUSALS[v.error].status);
  const row = { ...v.row, id: book.posts + 1 }, placed = book.add(row, seen.get(row.device) ?? null);
  if ('error' in placed) return json({ error: placed.error, text: REFUSALS[placed.error].text, ...placed.gone ? { gone: true } : {} }, REFUSALS[placed.error].status);
  if (!placed.again) seen.set(row.device, row.id);
  if (server.mode === 'lost') throw new TypeError('the answer was lost');
  return json({ id: placed.id, rank: placed.rank, posts: book.posts, board: book.view(m[2], m[3]) });
};

const terrain = { heightAt() { return 0; }, surfaceAt() { return { ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }; } };
const roads = new Roads({ roads: [{ id: 7, name: 'Birch Street', kind: 2, halfWidth: 3, bridge: false, pts: [[0, 0], [1000, 0]] }] }, [0, 0], terrain);
const props = new Props({ crs: 'EPSG:2961', mailboxes: Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 10, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false })),
  communityBoxes: [{ x: 400, y: 0, heading: 0, modules: 2 }], poles: [] }, [0, 0], terrain);
const mailStub = () => ({ delivered: 0, lawn: 0, ditch: 0, reset() { this.delivered = this.lawn = this.ditch = 0; } });
const house = [{ id: 99, x: 150, y: -40, kind: 'house' }];
const vehicleAt = (x, z) => ({ x, z, vx: 0, vz: 0, heading: Math.PI / 2, airborne: false, speed: 0, spec: CAR_SPEC });
/** One fresh device at the start of Today's run on `date`. */
function game(date = DATE) {
  const plan = dailyPlan(date, 'mabou'), supply = supplyFor(plan, ALL), squares = drawCard(plan.seed, supply), offers = [];
  const endings = { offer(tag, title, lines, choices, body) { offers.push({ tag, title, lines, choices, body }); }, close() {} };
  const shift = new Shift(props, mailStub(), roads, terrain, house, [0, 0], true, new URLSearchParams('run=1'), () => {}, true, true, plan.day);
  let daily = null;
  const fired = new FiredRun(shift, endings, false, () => {}, { limit: plan.limit, onEnd: end => daily.finish(end) });
  daily = new DailyRun(plan, squares, 'Mabou', shift, fired, endings, () => {}, supply);
  return { plan, shift, fired, daily, offers, tick: (dt = .016) => shift.update(dt, vehicleAt(0, 0)) };
}
/** Plays a random run: facts at rising times, some at protected places or about animals, until Fired or the limit. */
function play(g, random, pace = 1) {
  let t = .5 + random() * 2;
  while (!g.shift.ended && t < g.plan.limit - .2) {
    g.shift.elapsed = t * CLOCK_FACTOR;
    const roll = random(), kind = roll < .03 ? 'schoolBus' : KINDS[Math.floor(random() * KINDS.length)];
    if (roll > .95) g.shift.score.report({ kind, place: 'route', speed: 5, time: t, subject: random() < .5 ? 'animal' : 'person' });
    else if (roll > .9) { g.shift.placeAt = () => ['cemetery', 'church', 'busStop'][Math.floor(random() * 3)]; g.shift.reportScore(kind, 0, 0, 5); g.shift.placeAt = () => 'route'; }
    else if (roll > .87) g.shift.score.report({ kind: 'sceneAnimal', place: 'route', speed: 5, time: t });
    else g.shift.reportScore(kind, 0, 0, 5);
    if (random() < .3) g.tick(.016);
    t += random() < .25 / pace ? .03 + random() * .05 : random() * pace * (random() < .5 ? 1.5 : 6);
  }
  if (!g.shift.ended) { g.shift.elapsed = (g.plan.limit - .05) * CLOCK_FACTOR; g.tick(.016); g.tick(.25); }
  assert.equal(g.shift.ended, true);
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 2)); };
const clearDevice = () => { store.delete(DAILY_KEY); store.delete(BOARD_KEY); store.delete('mmm.fired.best.v1'); };

await ok('the game and the server agree: two hundred random runs, scored live by the game and again from the sent facts', async () => {
  const dates = ['2026-11-17', '2026-11-11', '2026-11-03', '2026-10-28', '2026-10-21'];
  let fired = 0, protectedFacts = 0;
  for (let i = 0; i < 200; i++) {
    clearDevice();
    const date = dates[i % dates.length], g = game(date), random = rng(500 + i);
    // Now and then a try abandoned before its end (start over): the first finished try is the next one, alone.
    if (i % 5 === 0) { for (let k = 0; k < 6; k++) { g.shift.elapsed = (1 + k) * CLOCK_FACTOR; g.shift.reportScore(KINDS[k], 0, 0, 5); } g.shift.retry(); g.tick(); }
    play(g, random, [1, 4, 12][i % 3]);
    const entry = savedEntry('mabou', date);
    assert.ok(entry, 'the first try is kept until it is posted');
    const book = g.fired.book, result = JSON.parse(store.get(DAILY_KEY)).mabou.first;
    assert.deepEqual(entry.post.claim, { points: result.total, step: result.step, time: result.firedAt ?? Math.round(entry.post.played * 10) / 10, squares: result.filled });
    const v = judgePost(JSON.parse(JSON.stringify({ ...entry.post, handle: 'Fog Bank', device: device(i) })), 'mabou', date, Date.parse(`${date}T16:00:00Z`));
    assert.equal(v.ok, true, `run ${i}: ${JSON.stringify(v)}`);
    assert.deepEqual({ points: v.row.points, step: v.row.step, squares: v.row.squares, firedAt: v.result.firedAt },
      { points: Math.round(book.total), step: book.step, squares: packFilled(g.daily.card.filled), firedAt: result.firedAt }, `run ${i}: the server's score is the game's`);
    assert.ok(entry.post.events.length <= MAX_EVENTS && entry.post.events.every(([k]) => SENT_KINDS.includes(k)));
    protectedFacts += g.shift.score.reported - entry.post.events.length;
    if (book.fired) fired++;
    assert.equal(g.daily.board?.root.find('boardPost')?.textContent, 'Post my result');
  }
  assert.ok(fired >= 10 && fired <= 190, `both fired and not-fired runs: ${fired}`);
  assert.ok(protectedFacts > 200, 'facts that cannot score stayed on the device');
});

await ok('the end card: "Post my result" waits for the tap; away or offline it says to try later; posted, the board marks the row and the share card gains the rank', async () => {
  clearDevice(); server.calls.length = 0; server.books.clear(); server.seen.clear(); server.now = NOW;
  // Twelve others posted today already, and some yesterday.
  for (let i = 0; i < 12; i++) {
    const p = makePost(honest(rng(700 + i), 30 + i * 12), { dev: device(700 + i), handle: `Cold Coffee ${i + 2}` });
    await fetch(`https://mmm.fakkeldy.ca${boardPath('mabou', DATE)}`, { method: 'POST', body: JSON.stringify(p) });
  }
  server.now = Date.parse('2026-11-16T16:00:00Z');
  for (let i = 0; i < 3; i++) await fetch(`https://mmm.fakkeldy.ca${boardPath('mabou', '2026-11-16')}`, { method: 'POST', body: JSON.stringify(makePost(honest(rng(800 + i)), { date: '2026-11-16', dev: device(800 + i) })) });
  server.now = NOW; server.calls.length = 0;
  const g = game(); play(g, rng(42));
  const card = g.offers.at(-1), board = card.body.find('dailyBoard'), post = card.body.find('boardPost');
  assert.ok(board && post && card.body.find('dailyShare') === null && card.body.id === 'dailyShare', 'the board block sits in the share card');
  assert.equal(post.textContent, 'Post my result'); assert.equal(post.hidden, false); assert.equal(card.body.find('boardName').hidden, false);
  assert.equal(server.calls.length, 0, 'never automatic: nothing is sent before the tap');
  const textBefore = g.daily.text;
  // Away: the server does not answer.
  server.mode = 'down'; post.click(); await settle();
  assert.equal(server.calls.length, 1, 'the tap sends'); await g.daily.board.send();
  assert.equal(post.textContent, 'Try later'); assert.equal(post.hidden, false); assert.match(card.body.find('boardStatus').textContent, /away just now.*Try later/);
  assert.equal(g.daily.text, textBefore, 'the share line is as before');
  server.mode = 'busy'; await g.daily.board.send(); assert.equal(post.textContent, 'Try later');
  server.mode = 'odd'; await g.daily.board.send(); assert.equal(post.textContent, 'Try later'); assert.equal(savedEntry('mabou', DATE).refused, undefined, 'an answer it does not know is not final');
  // Offline: nothing is sent at all.
  server.mode = 'up'; online = false; const before = server.calls.length;
  await g.daily.board.send();
  assert.equal(server.calls.length, before, 'offline sends nothing'); assert.equal(post.textContent, 'Try later');
  online = true;
  // A rude name is refused on the device and nothing is sent.
  card.body.find('boardName').value = 'B1tch Please'; await g.daily.board.send();
  assert.equal(server.calls.length, before); assert.match(card.body.find('boardStatus').textContent, /will not go on the board/);
  card.body.find('boardName').value = 'Washboard 7';
  await g.daily.board.send();
  const sent = JSON.parse(server.calls.at(-1).body);
  assert.deepEqual(Object.keys(sent).sort(), ['area', 'claim', 'date', 'device', 'events', 'handle', 'played', 'seed', 'supply', 'v'], 'the post carries nothing else');
  assert.equal(sent.handle, 'Washboard 7'); assert.match(sent.device, DEVICE);
  const saved = JSON.parse(store.get(BOARD_KEY)), entry = saved.runs.mabou;
  assert.match(saved.secret, DEVICE); assert.ok(!JSON.stringify(server.calls).includes(saved.secret), 'the device secret is never sent');
  assert.equal(sent.device, await boardDevice(saved.secret, 'mabou', DATE), 'the board’s id comes from the secret kept on the device');
  assert.notEqual(sent.device, await boardDevice(saved.secret, 'mabou', '2026-11-16'), 'another day, an id that cannot be matched');
  assert.notEqual(sent.device, await boardDevice(saved.secret, 'judique', DATE), 'another area, another id');
  assert.equal(server.calls.filter(c => c.method === 'POST').every(c => JSON.parse(c.body).device === sent.device), true, 'every try sends the same id');
  assert.equal(saved.name, 'Washboard 7');
  assert.ok(entry.posted && entry.posted.posts === 13, JSON.stringify(entry.posted));
  const view = card.body.find('boardView'), rows = card.body.find('boardRows');
  assert.equal(view.hidden, false, 'the board shows after posting');
  const lis = rows.children, you = lis.filter(li => li.className === 'you');
  assert.equal(lis.length, 13); assert.equal(you.length, 1, 'the player’s row is marked');
  assert.equal(lis.indexOf(you[0]) + 1, entry.posted.rank); assert.equal(you[0].children[1].textContent, 'Washboard 7');
  assert.equal(post.hidden, true, 'no second post');
  const rank = rankText(entry.posted.rank, 13);
  assert.match(card.body.find('boardStatus').textContent, new RegExp(`^Posted: ${rank.replace(/[#()]/g, '\\$&')}\\.$`));
  assert.equal(g.daily.text.split('\n')[0], resultText(JSON.parse(store.get(DAILY_KEY)).mabou.first, DATE, 'Mabou', '', rank).split('\n')[0], 'the share line gains the rank');
  assert.ok(drawn.at(-1).includes(rank), 'the share picture is drawn again with the rank');
  // The tabs: an area each, today and yesterday.
  const groups = card.body.find('boardTabs').children, tabs = groups.map(g => [g.attributes.role, g.attributes['aria-label'], ...g.children.map(b => [b.id, b.textContent, b.attributes['aria-pressed']])]);
  assert.deepEqual(tabs, [['group', 'Area', ['boardArea-mabou', 'Mabou', 'true']], ['group', 'Day', ['boardToday', 'Today · 17 Nov', 'true'], ['boardYesterday', 'Yesterday · 16 Nov', 'false']]]);
  card.body.find('boardYesterday').click(); await settle();
  assert.equal(server.calls.at(-1).url, boardPath('mabou', '2026-11-16'));
  assert.equal(rows.children.length, 3); assert.equal(rows.children.filter(li => li.className === 'you').length, 0, 'not the player’s day');
  card.body.find('boardToday').click(); await settle();
  assert.equal(rows.children.filter(li => li.className === 'you').length, 1);
  // A practice try: its card says the first run is posted, with the rank, and offers no second post.
  card.choices[0].action(); g.tick(); play(g, rng(43));
  const practice = g.offers.at(-1);
  assert.equal(practice.title, 'Practice');
  assert.equal(practice.body.find('boardPost').hidden, true); assert.match(practice.body.find('boardStatus').textContent, /^Posted: #/);
  assert.match(g.daily.text.split('\n')[0], /on the board$/, 'the share line keeps the rank');
  // Same device, cleared posted mark, the same run: an earlier try went out, so the board answers with its place again.
  const again = JSON.parse(store.get(BOARD_KEY)), rankBefore = again.runs.mabou.posted.rank; again.runs.mabou.posted = null; store.set(BOARD_KEY, JSON.stringify(again));
  card.choices[0].action(); g.tick(); play(g, rng(44));
  const second = g.offers.at(-1);
  assert.equal(second.body.find('boardPost').textContent, 'Post my first run');
  const postsBefore = server.books.get(`mabou/${DATE}`).posts;
  await g.daily.board.send();
  assert.equal(JSON.parse(store.get(BOARD_KEY)).runs.mabou.posted.rank, rankBefore, 'the same place');
  assert.equal(server.books.get(`mabou/${DATE}`).posts, postsBefore, 'not a second row');
  // Same device, another result for the day (a forged second first run): refused.
  const other = JSON.parse(store.get(BOARD_KEY)); other.runs.mabou.posted = null; delete other.runs.mabou.tried;
  other.runs.mabou.post.events = other.runs.mabou.post.events.slice(0, -1);
  const r2 = replay(drawCard(other.runs.mabou.post.seed, supplyFor(g.plan, ALL)), other.runs.mabou.post.events);
  other.runs.mabou.post.claim = { ...other.runs.mabou.post.claim, points: r2.total, step: r2.step, squares: r2.filled, time: r2.firedAt ?? other.runs.mabou.post.played };
  store.set(BOARD_KEY, JSON.stringify(other));
  card.choices[0].action(); g.tick(); play(g, rng(45));
  const third = g.offers.at(-1);
  await g.daily.board.send();
  assert.equal(third.body.find('boardStatus').textContent, REFUSALS.posted.text); assert.equal(third.body.find('boardPost').hidden, true);
});

await ok('a lost answer: the post reached the board and its answer did not; the next tap finds it, kept or dropped, and never posts twice', async () => {
  clearDevice(); server.calls.length = 0; server.books.clear(); server.seen.clear(); server.now = NOW;
  const g = game(); play(g, rng(60));
  const card = g.offers.at(-1), post = card.body.find('boardPost');
  server.mode = 'lost'; await g.daily.board.send();
  assert.equal(post.textContent, 'Try later'); assert.equal(server.books.get(`mabou/${DATE}`).posts, 1, 'it was taken');
  assert.equal(JSON.parse(store.get(BOARD_KEY)).runs.mabou.tried, true);
  server.mode = 'up'; await g.daily.board.send();
  const posted = JSON.parse(store.get(BOARD_KEY)).runs.mabou.posted;
  assert.deepEqual(posted, { id: 1, rank: 1, posts: 1 }, 'its place, from the board');
  assert.equal(post.hidden, true); assert.match(card.body.find('boardStatus').textContent, /^Posted: #1 of 1/);
  // Lost again, and meanwhile the row fell below the top: the board knows the device, so the run is posted, with no place.
  clearDevice(); server.books.clear(); server.seen.clear();
  const h = game(); play(h, rng(61));
  const hcard = h.offers.at(-1);
  server.mode = 'lost'; await h.daily.board.send(); server.mode = 'up';
  const book = server.books.get(`mabou/${DATE}`); book.rows.length = 0;   // as if a hundred better runs came in
  await h.daily.board.send();
  assert.deepEqual(JSON.parse(store.get(BOARD_KEY)).runs.mabou.posted, { id: 0, rank: null, posts: 1 });
  assert.equal(hcard.body.find('boardPost').hidden, true); assert.match(hcard.body.find('boardStatus').textContent, /^Posted: outside the board’s top 100 \(1 posted\)/);
  assert.equal(book.posts, 1, 'posted once');
  // Lost, and this device's kept row is another result (another tab's first run): refused, never "posted".
  clearDevice(); server.books.clear(); server.seen.clear();
  const j = game(); play(j, rng(64));
  server.mode = 'lost'; await j.daily.board.send(); server.mode = 'up';
  const changed = JSON.parse(store.get(BOARD_KEY)); changed.runs.mabou.post.events = changed.runs.mabou.post.events.slice(0, -1);
  const r3 = replay(drawCard(changed.runs.mabou.post.seed, supplyFor(j.plan, ALL)), changed.runs.mabou.post.events);
  changed.runs.mabou.post.claim = { ...changed.runs.mabou.post.claim, points: r3.total, step: r3.step, squares: r3.filled, time: r3.firedAt ?? changed.runs.mabou.post.played };
  store.set(BOARD_KEY, JSON.stringify(changed));
  j.offers.at(-1).choices[0].action(); j.tick(); play(j, rng(65));
  await j.daily.board.send();
  assert.equal(j.offers.at(-1).body.find('boardStatus').textContent, REFUSALS.posted.text);
  assert.equal(JSON.parse(store.get(BOARD_KEY)).runs.mabou.posted ?? null, null, 'not marked posted');
  // Lost just before midnight, tried again after the grace: the board can no longer say, and the card says so.
  clearDevice(); server.books.clear(); server.seen.clear();
  const m = game(); play(m, rng(66));
  server.mode = 'lost'; await m.daily.board.send(); server.mode = 'up';
  server.now = Date.parse('2026-11-18T12:00:00Z'); await m.daily.board.send(); server.now = NOW;
  const closed = m.offers.at(-1).body;
  assert.match(closed.find('boardStatus').textContent, /day has closed\. An earlier try may have reached the board/);
  assert.equal(closed.find('boardPost').hidden, true); assert.equal(closed.find('boardView').hidden, false, 'the board for that day, to look for the name');
  assert.equal(server.calls.at(-1).url, boardPath('mabou', DATE));
  // No hashing on this page (not served over HTTPS): nothing is sent, and the button says to try later.
  clearDevice(); server.books.clear(); server.seen.clear(); server.calls.length = 0;
  const q = game(); play(q, rng(67));
  Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
  try { await q.daily.board.send(); } finally { delete globalThis.crypto.subtle; }
  assert.equal(server.calls.length, 0); assert.equal(q.offers.at(-1).body.find('boardPost').textContent, 'Try later');
  await q.daily.board.send(); assert.match(q.offers.at(-1).body.find('boardStatus').textContent, /^Posted: #1 of 1/);
  // Without an earlier try that went out, the same refusal is final (a second first run).
  clearDevice(); server.books.clear(); server.seen.clear();
  const k = game(); play(k, rng(62));
  const dev = await boardDevice(deviceSecret(), 'mabou', DATE);
  await fetch(`https://mmm.fakkeldy.ca${boardPath('mabou', DATE)}`, { method: 'POST', body: JSON.stringify(makePost(honest(rng(63), 20), { dev })) });
  await k.daily.board.send();
  assert.equal(k.offers.at(-1).body.find('boardStatus').textContent, REFUSALS.posted.text);
  assert.equal(JSON.parse(store.get(BOARD_KEY)).runs.mabou.posted ?? null, null);
});

await ok('a run with more offences than the board checks stays on the device, and says so', async () => {
  clearDevice(); server.calls.length = 0; server.books.clear(); server.seen.clear(); server.now = NOW;
  const g = game();
  for (let i = 0; i <= MAX_EVENTS; i++) { g.shift.elapsed = (.5 + i * .1) * CLOCK_FACTOR; g.shift.reportScore('rut', 0, 0, 5); }
  if (!g.shift.ended) { g.shift.elapsed = (g.plan.limit - .05) * CLOCK_FACTOR; g.tick(.016); g.tick(.25); }
  assert.equal(g.shift.ended, true);
  const entry = savedEntry('mabou', DATE), card = g.offers.at(-1);
  assert.equal(entry.post.events.length, MAX_EVENTS, 'the log stops at the cap');
  assert.match(entry.refused, /more offences than the board checks \(over 2,000\)/);
  assert.equal(card.body.find('boardPost').hidden, true); assert.match(card.body.find('boardStatus').textContent, /more offences than the board checks/);
  await g.daily.board.send(); assert.equal(server.calls.length, 0, 'nothing is sent');
  // One under the cap: postable.
  clearDevice();
  const h = game();
  for (let i = 0; i < MAX_EVENTS; i++) { h.shift.elapsed = (.5 + i * .1) * CLOCK_FACTOR; h.shift.reportScore('rut', 0, 0, 5); }
  if (!h.shift.ended) { h.shift.elapsed = (h.plan.limit - .05) * CLOCK_FACTOR; h.tick(.016); h.tick(.25); }
  assert.equal(savedEntry('mabou', DATE).refused, undefined); assert.equal(savedEntry('mabou', DATE).post.events.length, MAX_EVENTS);
});

await ok('a browser that saves nothing: the run can still be posted from its card, once; a player who clears saved data starts clean', async () => {
  clearDevice(); server.calls.length = 0; server.books.clear(); server.seen.clear(); server.now = NOW;
  const blockedStore = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} };
  Object.defineProperty(globalThis, 'localStorage', { get() { return blockedStore; }, configurable: true });
  try {
    const g = game(); play(g, rng(70));
    const card = g.offers.at(-1);
    assert.ok(savedEntry('mabou', DATE), 'the page holds the run');
    server.mode = 'down'; await g.daily.board.send(); server.mode = 'up';
    await g.daily.board.send();
    assert.equal(card.body.find('boardPost').hidden, true); assert.match(card.body.find('boardStatus').textContent, /^Posted: #1 of 1/);
    const posts = server.calls.filter(c => c.method === 'POST').map(c => JSON.parse(c.body).device);
    assert.equal(new Set(posts).size, 1, 'one id for the page');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { get() { return memory; }, configurable: true });
  }
  // Saving works again, and the player has cleared the saved data: the page's run is not brought back.
  clearDevice(); deviceSecret();
  assert.equal(savedEntry('mabou', DATE), null, 'no run comes back once the browser saves again');
});

await ok('a refused post is final and says why; a practice run never replaces the first', async () => {
  clearDevice(); server.now = Date.parse('2026-11-20T16:00:00Z');   // the server is three days on: today's run is another day
  const g = game(); play(g, rng(50));
  const card = g.offers.at(-1);
  await g.daily.board.send();
  assert.equal(card.body.find('boardStatus').textContent, REFUSALS.day.text); assert.equal(card.body.find('boardPost').hidden, true);
  server.now = NOW;
  clearDevice();
  const h = game(); play(h, rng(51));
  const first = savedEntry('mabou', DATE).post;
  h.offers.at(-1).choices[0].action(); h.tick(); play(h, rng(52));
  assert.deepEqual(savedEntry('mabou', DATE).post, first, 'the first finished try is the one kept for the board');
  // Without a board server (another host), the end card is as before.
  globalThis.location = { hostname: 'example.org', search: '' }; clearDevice();
  const k = game(); play(k, rng(53));
  assert.equal(k.offers.at(-1).body.find('dailyBoard'), null); assert.equal(store.has(BOARD_KEY), false);
  globalThis.location = { hostname: 'mmm.fakkeldy.ca', search: '?daily=1' };
});

console.log(`PASS board rules: ${passed} groups (accept and rescore, own score, ceiling, day and area, card, events, shape and handle, top 100 and one per device, 60 days, rate limit, words, game and server agree, end card post and board, refusals)`);
