// Parcel tag and room games: the pure rules (web/src/mp/tag-rules.ts), the room's game phases (server/src/game.ts), the
// game frame (web/src/mp/game-wire.ts) and the host's field (web/src/mp/game-field.ts). Bundled and run by
// tools/tag-rules-mutations.mjs (cwd web/), which also runs it against each mutant; never on its own.
import assert from 'node:assert/strict';
import { TAG, TagRound, playRadius, fairPoint, roadPoints, isQuiet } from '../web/src/mp/tag-rules.ts';
import { GAMES, GAME_WIRE, PHASE, CONTROL_MAX, FIELD, decodeGame, encodeGame, readField, readGameControl } from '../web/src/mp/game-wire.ts';
import { gameField } from '../web/src/mp/game-field.ts';
import { RoomGame } from '../server/src/game.ts';
import { encodeState, FLAG, ROOM_CAP, TYPE } from '../web/src/mp/wire.ts';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; };
const R = (x, z, vx = 0, vz = 0, o = {}) => ({ x, z, vx, vz, parked: false, teleport: false, ...o });
// A cross of real-looking roads: east-west along z = 0 and north-south along x = 0, 300 m each way. A cemetery touches
// the east-west road near x = 200 (its ground reaches 10 m past the edge of the road).
const FIELD0 = { roads: [[-300, 0, 300, 0], [0, -300, 0, 300]], quiet: [{ x: 200, z: 30, r: 40 }] };
const field = () => JSON.parse(JSON.stringify(FIELD0));
const two = () => TagRound.start(field(), [{ id: 1, x: -100, z: 0 }, { id: 2, x: 100, z: 0 }], 1);
/** A round in play, with driver 1 holding the parcel since 300 ms and moving east at 10 m/s from x = -1. */
function held() {
  const g = two(); g.begin(0);
  g.report(1, R(-8, 0, 10, 0), 100); g.report(1, R(-1, 0, 10, 0), 300);
  assert.equal(g.s.holder, 1, 'the first car over the parcel holds it');
  return g;
}
/** The holder creeps at hx (not parked); the challenger closes from 10 m ahead at 15 m/s and passes through it. */
function ram(g, holder, challenger, t, hx = 0) {
  g.report(holder, R(hx, 0, .6, 0), t); g.report(challenger, R(hx + 10, 0, -15, 0), t);
  g.report(holder, R(hx + .12, 0, .6, 0), t + 200); g.report(challenger, R(hx - 1, 0, -15, 0), t + 200);
}

ok('a round starts at a fair road point between the players, in an area sized to them', () => {
  const g = two();
  assert.deepEqual(g.s.centre, { x: 0, z: 0 }, 'halfway along the road between two players');
  assert.equal(g.s.radius, playRadius(2));
  assert.ok(playRadius(2) >= 200 && playRadius(2) <= 240, `two players: about 220 m, got ${playRadius(2)}`);
  assert.ok(playRadius(24) >= 380 && playRadius(24) <= 420, `a full room: about 400 m, got ${playRadius(24)}`);
  assert.ok(playRadius(8) > playRadius(2) && playRadius(24) > playRadius(8), 'more players, a bigger area');
  assert.deepEqual(g.s.players.map(p => p.id), [1, 2]);
  assert.deepEqual(fairPoint([{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 90, z: 0 }], [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 60, z: 0 }]), { x: 50, z: 0 }, 'shortest worst drive');
  // Off-centre players: not the road point nearest the host, the one fair to both.
  const h = TagRound.start(field(), [{ id: 1, x: -40, z: 0 }, { id: 2, x: 0, z: 160 }], 1);
  assert.ok(Math.hypot(h.s.centre.x + 40, h.s.centre.z) > 30 && Math.abs(Math.hypot(h.s.centre.x + 40, h.s.centre.z) - Math.hypot(h.s.centre.x, h.s.centre.z - 160)) < 30, JSON.stringify(h.s.centre));
  // The parcel never starts at a quiet place.
  const q = TagRound.start(field(), [{ id: 1, x: 180, z: 0 }, { id: 2, x: 220, z: 0 }], 1);
  assert.ok(!isQuiet(FIELD0.quiet, q.s.centre), 'not at the cemetery: ' + JSON.stringify(q.s.centre));
  assert.equal(TagRound.start(field(), [{ id: 1, x: 0, z: 0 }], 1), null, 'one player is not a game');
  assert.equal(TagRound.start(field(), [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 2000 }], 1), null, 'nobody else within 500 m');
  assert.equal(TagRound.start(field(), [{ id: 2, x: 0, z: 0 }, { id: 3, x: 5, z: 0 }], 1), null, 'the host must have a place');
  assert.equal(TagRound.start({ roads: [[-300, 0, 300, 0]], quiet: [{ x: 0, z: 0, r: 400 }] }, [{ id: 1, x: 0, z: 0 }, { id: 2, x: 5, z: 0 }], 1), null, 'no open road');
  // The whole area lies inside the roads the host's page sent, however far the others stand.
  assert.equal(TAG.fieldReachM, FIELD.reach - 20, 'the rules and the field builder agree');
  const wide = { roads: [[-600, 0, 600, 0]], quiet: [] }, spread = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, x: i ? 480 : 0, z: 0 }));
  const big = TagRound.start(wide, spread, 1);
  assert.ok(Math.hypot(big.s.centre.x, big.s.centre.z) + big.s.radius <= TAG.fieldReachM, `area inside the field: centre ${JSON.stringify(big.s.centre)}, radius ${big.s.radius}`);
  const far = TagRound.start(field(), [{ id: 1, x: 0, z: 0 }, { id: 2, x: 10, z: 0 }, { id: 3, x: 0, z: 2000 }], 1);
  assert.deepEqual(far.s.players.map(p => p.id), [1, 2], 'a player far off is not on the table at the start');
});

ok('pickup: the first car to drive over the loose parcel holds it', () => {
  const g = two(); g.begin(0);
  assert.equal(g.report(1, R(-30, 0, 10, 0), 100), false);
  g.report(1, R(-28, 0, 10, 0), 300);
  assert.equal(g.s.holder, 0, '28 m short: nothing');
  g.report(2, R(6, 3, 0, 0), 300); g.report(2, R(6, 3, 0, 0), 500);
  assert.equal(g.s.holder, 0, 'parked 6.7 m off: nothing');
  g.report(1, R(-5, 0, 10, 0), 2900); assert.equal(g.s.holder, 0, 'a 23 m hop in 2.6 s is a drive, still 5 m short');
  assert.equal(g.report(1, R(3, 0, 10, 0), 3400), true, 'driving over it changes the game');
  assert.equal(g.s.holder, 1);
  assert.equal(g.s.immuneUntil, 0, 'a pickup gives no shield: only a steal does');
  // Fast cars report five times a second: a pass at 30 m/s between two reports still picks it up.
  const f = two(); f.begin(0); f.report(2, R(-3, 3, 30, 0), 100); f.report(2, R(3, 3, 30, 0), 300);
  assert.equal(f.s.holder, 2, 'picked up between reports');
  const n = two(); n.begin(0); n.report(1, R(-4.9, 0, 30, 0), 100);
  assert.equal(n.s.holder, 0, 'a first report has no previous place to drive from');
});

ok('scoring: a point for each second held while playing', () => {
  const g = held();
  for (let t = 500, x = 1; t <= 3300; t += 200, x += 2) g.report(1, R(x, 0, 10, 0), t);
  assert.deepEqual(g.table(), [{ id: 1, score: 3 }, { id: 2, score: 0 }]);
  g.tick(3999); assert.equal(g.table()[0].score, 3, '3.699 s');
  g.report(1, R(30, 0, 10, 0), 4300); assert.equal(g.table()[0].score, 4);
  assert.equal(g.table()[1].score, 0, 'only the holder scores');
});

ok('steal: within about 3 m with closing speed', () => {
  const g = held();
  g.report(1, R(50, 0, 10, 0), 1000); g.report(2, R(70, 0, -10, 0), 1000);
  g.report(1, R(52, 0, 10, 0), 1200); g.report(2, R(60, 0, -10, 0), 1200);
  assert.equal(g.s.holder, 1, '8 m apart: no steal');
  g.report(1, R(54, 0, 10, 0), 1400); g.report(2, R(52, 0, -10, 0), 1400);
  assert.equal(g.s.holder, 2, 'they met: stolen');
  assert.equal(g.s.immuneUntil, 1400 + TAG.immuneMs);
  // Side by side at the same speed, 2 m apart: close, but nobody is closing in.
  const s = held();
  s.report(2, R(10, 2, 10, 0), 1000); s.report(1, R(10, 0, 10, 0), 1000);
  s.report(2, R(12, 2, 10, 0), 1200); s.report(1, R(12, 0, 10, 0), 1200);
  s.report(2, R(14, 2, 10, 0), 1400);
  assert.equal(s.s.holder, 1, 'no closing speed, no steal');
  // A pass 4 m off is not a steal either.
  const w = held();
  w.report(1, R(0, 0, .6, 0), 1000); w.report(2, R(10, 4.2, -15, 0), 1000);
  w.report(1, R(.12, 0, .6, 0), 1200); w.report(2, R(-1, 4.2, -15, 0), 1200);
  assert.equal(w.s.holder, 1, '4.2 m off: no steal');
  const y = held(); ram(y, 1, 2, 1000); assert.equal(y.s.holder, 2, 'a head-on ram steals');
});

ok('immunity: a new holder cannot be robbed for 3 seconds', () => {
  const g = held(); ram(g, 1, 2, 1000);
  assert.equal(g.s.holder, 2); const stolen = 1200;
  ram(g, 2, 1, 2000); assert.equal(g.s.holder, 2, '1 s later: still shielded');
  ram(g, 2, 1, stolen + TAG.immuneMs - 400); assert.equal(g.s.holder, 2, 'just under 3 s: still shielded');
  ram(g, 2, 1, stolen + TAG.immuneMs); assert.equal(g.s.holder, 1, 'after 3 s it can be taken back');
  assert.equal(g.s.immuneUntil, stolen + TAG.immuneMs + 200 + TAG.immuneMs);
});

ok('drop: parked for 10 s, where the holder is, scoring nothing meanwhile', () => {
  const g = held();
  g.report(1, R(5, 0, 10, 0), 900);
  g.report(1, R(6, 0, 0, 0, { parked: true }), 1300);
  const before = g.table()[0].score;
  g.tick(1300 + TAG.idleMs - 1); assert.equal(g.s.holder, 1, 'not yet');
  assert.equal(g.table()[0].score, before, 'a parked holder scores nothing');
  assert.equal(g.tick(1300 + TAG.idleMs), true); assert.equal(g.s.holder, 0, 'dropped');
  assert.deepEqual(g.s.parcel, { x: 6, z: 0 }, 'where it was parked');
  // Creeping along at 0.3 m/s, still reporting, counts as parked: it drops after 10 s of it.
  const k = held();
  for (let t = 1000; t <= 1000 + TAG.idleMs + 400; t += 200) { k.report(1, R(1 + .3 * (t - 1000) / 1000, 0, .3, 0), t); if (t === 1000 + TAG.idleMs - 200) assert.equal(k.s.holder, 1, 'creeping, not yet'); }
  assert.equal(k.s.holder, 0, 'creeping for 10 s drops it');
  k.report(1, R(4.4, 0, .3, 0), 1000 + TAG.idleMs + 2900); assert.equal(k.s.holder, 0, 'the dropper cannot pick it straight back up');
  k.report(1, R(4.5, 0, .3, 0), 1000 + TAG.idleMs + 3100); assert.equal(k.s.holder, 1, 'after 3 s it may');
  // Crawling at walking pace counts as parked too; driving again in time keeps it.
  const c = held(); c.report(1, R(1, 0, .2, 0), 1000); c.report(1, R(1.5, 0, 5, 0), 1000 + TAG.idleMs - 100);
  c.tick(1000 + TAG.idleMs + 5000); assert.equal(c.s.holder, 1, 'moving again in time keeps it');
});

ok('drop: off the roads, out of the area or unheard for 10 s; never left off the road or out of the area', () => {
  const g = held();
  g.report(1, R(20, 20, 7, 7), 700); g.report(1, R(40, 40, 7, 7), 2700);
  g.report(1, R(50, 50, 7, 7), 4700); g.report(1, R(60, 60, 7, 7), 6700);
  g.tick(2700 + TAG.idleMs - 1); assert.equal(g.s.holder, 1);
  g.tick(2700 + TAG.idleMs + 5000); assert.equal(g.s.holder, 0, 'off the road 10 s: dropped');
  assert.ok(Math.abs(g.s.parcel.x) <= 1 || Math.abs(g.s.parcel.z) <= 1, 'it lies on a road: ' + JSON.stringify(g.s.parcel));
  assert.ok(g.table()[0].score <= 3, 'off-road seconds did not score');
  const o = held(); const r = o.s.radius;
  for (let t = 500, x = 1; x < r + 30; t += 200, x += 6) o.report(1, R(x, 0, 30, 0), t);
  o.tick(60000); assert.equal(o.s.holder, 0, 'out of the area: dropped');
  assert.ok(Math.hypot(o.s.parcel.x, o.s.parcel.z) <= r && !isQuiet(FIELD0.quiet, o.s.parcel), 'back inside, not at the cemetery: ' + JSON.stringify(o.s.parcel));
  const s = held(); s.report(1, R(1, 0, 10, 0), 500);
  s.tick(500 + TAG.idleMs - 1); assert.equal(s.s.holder, 1, 'unheard but not 10 s');
  s.tick(500 + TAG.idleMs); assert.equal(s.s.holder, 0, 'unheard for 10 s: dropped where last heard');
  assert.ok(s.table()[0].score <= 1, 'unheard time did not score: ' + s.table()[0].score);
});

ok('quiet places: nothing scores or is stolen at a church ground, a cemetery or the bus stop', () => {
  const g = held();
  for (let t = 500, x = 1; x <= 190; t += 200, x += 3) g.report(1, R(x, 0, 15, 0), t);
  const score = g.table()[0].score, at = 500 + 200 * Math.ceil(189 / 3);
  g.report(1, R(192, 0, 15, 0), at + 200);
  for (let t = at + 400; t < at + 4000; t += 200) g.report(1, R(195, 0, 15, 0), t);
  g.tick(at + 3000); assert.equal(g.table()[0].score, score, 'no points at the cemetery');
  ram(g, 1, 2, at + 3000, 195);
  assert.equal(g.s.holder, 1, 'nothing is stolen there either');
  g.tick(at + 200 + TAG.idleMs); assert.equal(g.s.holder, 0, 'it is dropped after 10 s');
  assert.ok(!isQuiet(FIELD0.quiet, g.s.parcel), 'and lies outside the quiet place: ' + JSON.stringify(g.s.parcel));
  // A holder at the edge of the cemetery ground is not robbed from just outside it.
  const e = held();
  for (let t = 500, x = 1; x <= 172; t += 200, x += 3) e.report(1, R(x, 0, 15, 0), t);
  e.report(1, R(174, 0, .6, 0), 12100); e.report(2, R(164, 0, 15, 0), 12100);
  e.report(1, R(174.12, 0, .6, 0), 12300); e.report(2, R(171.2, 0, 15, 0), 12300);
  assert.ok(isQuiet(FIELD0.quiet, { x: 174, z: 0 }) && !isQuiet(FIELD0.quiet, { x: 171.2, z: 0 }));
  assert.equal(e.s.holder, 1, 'a holder inside a quiet place is not robbed');
  const p = two(); p.s.parcel = { x: 200, z: 0 }; p.begin(0);
  p.report(2, R(195, 0, 10, 0), 100); p.report(2, R(205, 0, 10, 0), 300);
  assert.equal(p.s.holder, 0, 'a parcel at a quiet place is not picked up there');
});

ok('jumps: a reset or a teleport drops the parcel and never steals', () => {
  const g = held(); g.report(1, R(1, 0, 10, 0), 500);
  assert.equal(g.report(1, R(1, 0, 0, 0, { teleport: true }), 700), true); assert.equal(g.s.holder, 0, 'a reset drops it');
  assert.deepEqual(g.s.parcel, { x: 1, z: 0 }, 'where the car was before');
  const h = held(); h.report(1, R(1, 0, 10, 0), 500); h.report(1, R(0, 150, 10, 0), 700);
  assert.equal(h.s.holder, 0, 'an unflagged 150 m hop is a jump too'); assert.deepEqual(h.s.parcel, { x: 1, z: 0 });
  const d = held(); d.report(1, R(20, 0, 40, 0), 800); assert.equal(d.s.holder, 1, '21 m in 0.5 s at 40 m/s is a drive');
  const s = held(); s.report(1, R(0, 0, .6, 0), 1000); s.report(2, R(100, 0, -15, 0), 1000);
  s.report(1, R(.12, 0, .6, 0), 1200); s.report(2, R(-1, 0, -15, 0), 1200);
  assert.equal(s.s.holder, 1, 'a jump onto the holder steals nothing');
  const t = held(); t.report(2, R(10, 0, -15, 0), 1000); t.report(1, R(0, 0, .6, 0), 1000);
  t.report(1, R(.12, 0, .6, 0), 1200); t.report(2, R(-1, 0, -15, 0, { teleport: true }), 1200);
  assert.equal(t.s.holder, 1, 'a flagged reset next to the holder steals nothing');
});

ok('players: late joiners inside the area join the table; leaving drops the parcel', () => {
  const g = held();
  assert.equal(g.report(3, R(0, 1000, 0, 0), 500), false, 'far off: not on the table');
  assert.equal(g.report(3, R(0, 100, 0, 0), 600), true, 'drove in: on the table');
  assert.deepEqual(g.table().map(r => r.id), [1, 2, 3]);
  g.report(1, R(1, 0, 10, 0), 500);
  assert.equal(g.leave(1, 700), true); assert.equal(g.s.holder, 0); assert.deepEqual(g.s.parcel, { x: 1, z: 0 });
  assert.equal(g.table().length, 3, 'scores stay on the table after leaving');
  const full = TagRound.start(field(), Array.from({ length: 24 }, (_, i) => ({ id: i + 1, x: i, z: 0 })), 1);
  assert.equal(full.s.players.length, 24); assert.equal(full.s.radius, playRadius(24));
  full.begin(0); assert.equal(full.report(25, R(0, 5, 0, 0), 100), false, 'a 25th never joins');
});

ok('a round through the room: host, countdown, play, end, table, back to free driving', () => {
  const body = (x, z, flags = 0, t = 1, vx = 0) => new Uint8Array(encodeState({ x, z, t, flags, heading: 0, steer: 0, vx, vz: 0, air: 0 }), 2);
  const seats = [{ id: 1, last: body(-100, 0) }, { id: 2, last: body(100, 0) }];
  const start = { t: 'game-control', action: 'start', game: 'tag', field: field() };
  const g = new RoomGame(); g.join(1); g.join(2);
  assert.equal(g.state.host, 1);
  assert.equal(g.command(2, start, seats, 1000, 0), false, 'a guest cannot start');
  assert.equal(g.command(1, { ...start, field: { roads: [[0.5, 0, 9, 0]], quiet: [] } }, seats, 1000, 0), false, 'a bad field is refused');
  assert.equal(g.command(1, start, seats, 1000, 0, true), false, 'not while a race is on');
  assert.equal(g.command(1, { ...start, extra: 'text' }, seats, 1000, 0), false, 'no extra text');
  assert.equal(g.command(1, start, seats, 1000, 0), true);
  assert.equal(g.state.phase, PHASE.countdown); assert.equal(g.state.until, TAG.countdownMs); assert.ok(g.busy());
  assert.equal(g.command(1, start, seats, 1000, 10), false, 'one game at a time');
  // Countdown: nobody can grab it early.
  g.position(1, body(-1, 0, 0, 2, 10), 4000); g.position(1, body(1, 0, 0, 3, 10), 4200);
  assert.equal(new DataView(g.frame(4200), 13 + 8).getUint16(0, true), 0, 'nobody holds it in the countdown');
  assert.equal(g.tick(TAG.countdownMs), true); assert.equal(g.state.phase, PHASE.play);
  g.position(1, body(-2, 0, 0, 4, 10), 5100); g.position(1, body(2, 0, 0, 5, 10), 5300);
  const f = decodeGame(g.frame(5300));
  assert.equal(f.tag.holder, 1); assert.equal(f.phase, PHASE.play); assert.equal(f.left, TAG.roundMs - 300);
  for (let t = 5500, x = 4; t <= 10300; t += 200, x += 2) g.position(1, body(x, 0, 0, t, 10), t);
  assert.equal(decodeGame(g.frame(10300)).table.find(r => r.id === 1).score, 5);
  // A late joiner hears the same state.
  const late = decodeGame(g.frame(10300)); assert.deepEqual(late, decodeGame(g.frame(10300)));
  // Through a sleep: the room keeps the round as plain data.
  const back = new RoomGame(JSON.parse(JSON.stringify(g.state)));
  assert.deepEqual(decodeGame(back.frame(10300)), decodeGame(g.frame(10300)), 'restored after a sleep');
  const end = TAG.countdownMs + TAG.roundMs;
  g.tick(end - 1); assert.equal(g.state.phase, PHASE.play);
  assert.equal(g.tick(end), true); assert.equal(g.state.phase, PHASE.over);
  const final = decodeGame(g.frame(end));
  assert.equal(final.phase, PHASE.over); assert.ok(final.table.find(r => r.id === 1).score >= 5);
  assert.equal(g.position(1, body(100, 0, 0, 999999, 10), end + 100), false, 'nothing counts after the end');
  const again = new RoomGame(JSON.parse(JSON.stringify(g.state))); again.join(1);
  assert.equal(again.command(1, start, seats, 1000, end + 200), true, 'a rematch may start from the table');
  g.tick(end + TAG.overMs); assert.equal(g.state.phase, PHASE.free, 'back to free driving');
  assert.deepEqual(decodeGame(g.frame(end + TAG.overMs)), { kind: 0, phase: 0, host: 1, serial: 1, left: 0, table: [], tag: null });
  assert.equal(g.deadline(), 0);
  // Stop, and the host leaving.
  assert.equal(g.command(1, start, seats, 1000, 400000), true); assert.equal(g.command(2, { t: 'game-control', action: 'stop' }, seats, 1000, 400100), false);
  assert.equal(g.leave(1, [2], 400200), true); assert.equal(g.state.host, 2, 'the host passes on'); assert.equal(g.state.phase, PHASE.countdown, 'the game goes on');
  assert.equal(g.command(2, { t: 'game-control', action: 'stop' }, seats, 1000, 400300), true); assert.equal(g.state.phase, PHASE.free);
  assert.equal(new RoomGame({ host: 1, serial: 3, game: 'tag', phase: PHASE.play, until: 9, round: null }).state.phase, PHASE.free, 'a broken saved round is dropped');
  // Shortened rounds exist only when the room is built so (local checks).
  const short = new RoomGame(undefined, 20000); short.join(1); short.command(1, start, seats, 1000, 0); short.tick(TAG.countdownMs);
  assert.equal(short.state.until, TAG.countdownMs + 20000);
});

ok('the wire: a small versioned frame; anything else is ignored', () => {
  assert.equal(TYPE.game, 3); assert.equal(GAME_WIRE, 1);
  const g = TagRound.start(field(), Array.from({ length: ROOM_CAP }, (_, i) => ({ id: 1000 + i, x: i, z: 0 })), 1000);
  const buf = encodeGame({ kind: TAG.kind, phase: PHASE.play, host: 1000, serial: 7, left: 1234, table: g.table() }, g.payload(0));
  assert.equal(buf.byteLength, 13 + 4 * ROOM_CAP + GAMES.tag.payload, 'a full room fits in ' + buf.byteLength + ' bytes');
  assert.ok(buf.byteLength <= 140);
  const d = decodeGame(buf);
  assert.equal(d.table.length, ROOM_CAP); assert.equal(d.left, 1234); assert.equal(d.serial, 7);
  assert.deepEqual(d.tag.centre, g.s.centre); assert.equal(d.tag.radius, g.s.radius);
  const bytes = new Uint8Array(buf);
  for (const [i, v] of [[1, 2], [0, 2], [3, 9], [2, 7]]) { const c = bytes.slice(); c[i] = v; assert.equal(decodeGame(c.buffer), null, `byte ${i} = ${v}`); }
  assert.equal(decodeGame(buf.slice(0, buf.byteLength - 1)), null, 'short');
  const free = new Uint8Array(encodeGame({ kind: 0, phase: PHASE.free, host: 1, serial: 0, left: 0, table: [] }, null));
  assert.equal(free.byteLength, 13); const bad = free.slice(); bad[3] = PHASE.play; assert.equal(decodeGame(bad.buffer), null, 'no kind, no play');
  assert.equal(readGameControl({ t: 'game-control', action: 'start', game: 'hide', field: {} }), null, 'only known games');
  assert.equal(readGameControl({ t: 'game-control', action: 'start', game: 'constructor', field: {} }), null);
  assert.equal(readGameControl({ t: 'game-control', action: 'stop', note: 'x' }), null);
});

ok('the field: real roads near the host, bounded, checked like a race route', () => {
  const near = { x: 0, z: 0 };
  assert.ok(readField(field(), 1000, near));
  for (const bad of [
    { roads: [[0, 0, 1.5, 0]], quiet: [] }, { roads: [[0, 0, 2000, 0]], quiet: [] }, { roads: [[0, 0, 700, 0]], quiet: [] },
    { roads: [[0, 0]], quiet: [] }, { roads: [], quiet: [] }, { roads: [[0, 0, 5, 0]], quiet: [{ x: 0, z: 0, r: 900 }] },
    { roads: [[0, 0, 5, 0]], quiet: [{ x: 0, z: 0, r: 1.5 }] }, { roads: [[0, 0, 5, 'x']], quiet: [] },
    { roads: [Array.from({ length: (FIELD.vertices + 1) * 2 }, (_, i) => i % 2 ? 0 : i % 400)], quiet: [] },
  ]) assert.equal(readField(bad, 1000, near), null, JSON.stringify(bad).slice(0, 80));
  assert.equal(readField(field(), 250, near), null, 'outside the room bounds');
  // A built field from many roads stays inside one control text and is accepted by the room.
  const roads = [];
  for (let i = 0; i < 160; i++) roads.push({ id: i, name: 'R', kind: 2, halfWidth: 3, bridge: false, pts: Array.from({ length: 80 }, (_, j) => [-800 + j * 20, -790 + i * 10 + Math.sin(j) * 3]) });
  roads.push({ id: 999, name: null, kind: 2, railway: true, halfWidth: 1, bridge: false, pts: [[3, 7], [13, 7], [23, 7]] });
  const built = gameField(roads, [{ x: 30, z: 30, radius: 25.5 }, { x: 5000, z: 0, radius: 40 }], near);
  const text = JSON.stringify({ t: 'game-control', action: 'start', game: 'tag', field: built });
  assert.ok(text.length <= CONTROL_MAX, `control text ${text.length} chars`);
  assert.ok(readField(built, 60000, near), 'accepted');
  assert.deepEqual(built.quiet, [{ x: 30, z: 30, r: 26 }], 'nearby quiet places only, rounded up');
  assert.ok(!built.roads.some(l => l.join() === '3,7,23,7'), 'no railway');
  assert.ok(gameField(roads.slice(-1).map(r => ({ ...r, railway: undefined })), [], near).roads.some(l => l.join() === '3,7,23,7'), 'the same line as a road is kept');
  assert.ok(roadPoints(built).length > 50);
  // Far from the area's origin every number is long: with 32 quiet places it must still fit one control text.
  const corner = { x: -45000, z: -45000 }, shift = r => ({ ...r, pts: r.pts.map(([x, z]) => [x - 45000, z - 45000]) });
  // Winding roads: every bend is real, so simplifying cannot shorten them.
  const winding = Array.from({ length: 60 }, (_, i) => ({ id: i, name: 'W', kind: 3, halfWidth: 2, bridge: false, pts: Array.from({ length: 13 }, (_, j) => [-300 + (i % 6) * 100 + j * 7, -300 + Math.floor(i / 6) * 60 + (j % 2) * 30]) }));
  const busy = gameField(winding.map(shift), Array.from({ length: 40 }, (_, i) => ({ x: -45000 + i * 9, z: -45000 - i * 7, radius: 399.5 })), corner);
  const long = JSON.stringify({ t: 'game-control', action: 'start', game: 'tag', field: busy });
  assert.equal(busy.quiet.length, FIELD.quiet);
  assert.ok(long.length <= CONTROL_MAX, `far from the origin: ${long.length} chars`);
  assert.ok(readField(busy, 60000, corner), 'accepted far from the origin');
  // The longest field the room accepts, at the edge of the bounds, fits one control text.
  const edge = { x: -59999, z: -59999 }, per = Math.floor(FIELD.vertices / FIELD.lines);
  const worst = { roads: Array.from({ length: FIELD.lines }, () => Array.from({ length: per * 2 }, () => -59999)), quiet: Array.from({ length: FIELD.quiet }, () => ({ x: -59999, z: -59999, r: FIELD.quietR })) };
  worst.roads[0].push(...Array.from({ length: (FIELD.vertices - per * FIELD.lines) * 2 }, () => -59999));
  assert.ok(readField(worst, 60000, edge), 'the largest field is accepted');
  const most = JSON.stringify({ t: 'game-control', action: 'start', game: 'tag', field: worst }).length;
  assert.ok(most <= CONTROL_MAX, `the largest field: ${most} chars`);
  // Many short, straight roads: a coarser tolerance keeps them all rather than dropping the far ones.
  assert.equal(gameField(roads, [], near).roads.length, FIELD.lines, 'as many roads as a field may carry');
});

console.log(`PASS tag rules: ${passed} groups (fair start, pickup, scoring, steal, immunity, drops, quiet places, jumps, joiners, room phases, wire, field)`);
