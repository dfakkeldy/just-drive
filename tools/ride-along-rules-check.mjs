// The Boss's ride-along days in mail play (web/src/ride-along-rules.ts): the day seed, the gates, the post, the crawl,
// sight, the seen offences, the pull-over, the verdict and the words; and the complaint rule that a seen complaint takes
// no photo. Bundled and run by tools/ride-along-rules-mutations.mjs (cwd web/), never on its own.
import assert from 'node:assert/strict';
import * as R from '../web/src/ride-along-rules.ts';
import { dismissed } from '../web/src/complaints.ts';
import { dayType, verdict } from '../web/src/shift-rules.ts';
import { roadTop, sightRange, SIGHT_NEAR } from '../web/src/boss-rules.ts';

let passed = 0;
const ok = (name, fn) => { try { fn(); passed++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const q = s => new URLSearchParams(s);
// Heading 0 is north (-z), clockwise: a Boss at the origin facing north sees (0, -50) straight ahead.
const boss = (x = 0, z = 0, heading = 0) => ({ x, z, heading, speed: 0 });
const player = (x, z, speed = 0) => ({ x, z, heading: 0, speed });
const input = (p, seen = true, onRoad = true, b = boss()) => ({ boss: b, player: p, seen, onRoad });
const off = (kind, at = 0) => ({ kind, label: R.seenLabel(kind), at });

ok('gates: mail play only, today only, never Just Drive; ?boss=0 and ?rideAlong=0 off; single player only', () => {
  assert.equal(R.rideAlongEnabled(true, true, false, q('')), true);
  assert.equal(R.rideAlongEnabled(false, true, false, q('')), false, 'Get Fired (and Today\'s run, which is Get Fired) and Just Drive play');
  assert.equal(R.rideAlongEnabled(true, false, false, q('')), false, 'no ride-along in another era');
  assert.equal(R.rideAlongEnabled(true, true, true, q('')), false, 'never on the Just Drive site');
  assert.equal(R.rideAlongEnabled(true, true, false, q('boss=0')), false);
  assert.equal(R.rideAlongEnabled(true, true, false, q('rideAlong=0')), false);
  assert.equal(R.rideAlongLive(false), true); assert.equal(R.rideAlongLive(true), false, 'never in multiplayer');
});

ok('day seed: about one day in four, the same days for everybody, never day 1', () => {
  const first = []; for (let d = 1; d <= 40; d++) if (R.rideAlongDay(d)) first.push(d);
  assert.deepEqual(first, [3, 16, 17, 21, 24, 31, 34], 'the seeded days are pinned: a player on day 3 anywhere has the Boss along');
  assert.equal(R.rideAlongDay(1), false, 'the first shift on the route is never a ride-along');
  for (const bad of [0, -3, 2.5, NaN, Infinity]) assert.equal(R.rideAlongDay(bad), false, `no day ${bad}`);
  let n = 0; const types = new Set();
  for (let d = 2; d < 2002; d++) if (R.rideAlongDay(d)) { n++; types.add(dayType(d)); }
  assert.ok(n / 2000 > .22 && n / 2000 < .3, `share ${n / 2000}`);
  assert.equal(types.size, 3, 'on flyer, light and ordinary days alike: its own seed');
  for (let d = 1; d < 200; d++) assert.equal(R.rideAlongDay(d), R.rideAlongDay(d), 'pure');
  assert.equal(R.rideAlongToday(5, q('')), R.rideAlongDay(5));
  assert.equal(R.rideAlongToday(1, q('rideAlong=1')), true, '?rideAlong=1 for checks and pictures');
  assert.equal(R.rideAlongToday(3, q('rideAlong=0')), true, 'the gate (rideAlongEnabled) is what ?rideAlong=0 turns off');
});

ok('post: a seeded order of the day\'s stops, parked or crawling, either way along the road', () => {
  const stops = [4, 9, 12, 30, 31, 57];
  const a = R.postPlan(16, stops), b = R.postPlan(16, [...stops].reverse());
  assert.deepEqual(a, b, 'the same day picks the same post whatever order the stops come in');
  assert.deepEqual([...a.order].sort((x, y) => x - y), stops, 'only the day\'s stops, each once');
  const firsts = new Set(), kinds = new Set();
  for (let d = 2; d < 120; d++) { const p = R.postPlan(d, stops); firsts.add(p.order[0]); kinds.add(`${p.crawl}/${p.reverse}`); }
  assert.ok(firsts.size >= 5, 'a different part of the route on different days');
  assert.equal(kinds.size, 4, 'parked and crawling, both ways');
});

ok('crawl: slowly out, a wait, a turn across the road, back, a wait, a turn', () => {
  const L = 180, e = 1.5, leg = L / R.CRAWL_SPEED, half = leg + R.CRAWL_WAIT + R.CRAWL_TURN, close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} vs ${b}`);
  let p = R.crawlPose(0, L, e); close(p.along, 0, 'starts at the post'); close(p.side, e, 'on its right edge'); close(p.turn, 0, 'facing along');
  p = R.crawlPose(10, L, e); close(p.along, 10 * R.CRAWL_SPEED, 'at its crawl'); assert.ok(R.CRAWL_SPEED * 3.6 <= 20, 'slow: under 20 km/h');
  p = R.crawlPose(leg + 3, L, e); close(p.along, L, 'waits at the far end'); close(p.side, e, 'still on its edge');
  p = R.crawlPose(leg + R.CRAWL_WAIT + R.CRAWL_TURN / 2, L, e); close(p.along, L, 'turns where it waited'); close(p.side, 0, 'mid-road half way round'); close(p.turn, Math.PI / 2, 'across the road');
  p = R.crawlPose(half + 4, L, e); close(p.along, L - 4 * R.CRAWL_SPEED, 'back'); close(p.side, -e, 'on the other edge (its own right)'); close(p.turn, Math.PI, 'facing back');
  p = R.crawlPose(half + leg + 1, L, e); close(p.along, 0, 'waits at the post');
  p = R.crawlPose(2 * half + 7, L, e); const q0 = R.crawlPose(7, L, e); close(p.along, q0.along, 'again'); close(p.side, q0.side, 'again');
  for (let t = 0; t < 2 * half; t += .5) { const a = R.crawlPose(t, L, e), b = R.crawlPose(t + .5, L, e);
    assert.ok(a.along >= -1e-9 && a.along <= L + 1e-9 && Math.abs(a.side) <= e + 1e-9, 'inside its stretch');
    assert.ok(Math.abs(b.along - a.along) <= R.CRAWL_SPEED * .5 + 1e-9, 'never faster than its crawl'); }
});

ok('sight: 90 m through the windscreen, all round when near, not through a wall', () => {
  assert.equal(sightRange(R.WATCH_STEP), 90);
  assert.equal(R.watchSees(boss(), { x: 0, z: -88 }), true, 'ahead');
  assert.equal(R.watchSees(boss(), { x: 0, z: -92 }), false, 'too far');
  assert.equal(R.watchSees(boss(), { x: 0, z: 40 }), false, 'behind');
  assert.equal(R.watchSees(boss(), { x: 0, z: SIGHT_NEAR - 1 }), true, 'right beside');
  assert.equal(R.watchSees(boss(), { x: 0, z: -40 }, () => true), false, 'a house between');
});

ok('seen complaints: the avoidable ones done on the road; not the end-of-day sweep, a flag, indoors or an old fall', () => {
  for (const k of ['lawnDamage', 'propertyDamage', 'boxDown', 'lawnMail', 'ditchMail', 'relief', 'sceneHit', 'sceneHorn', 'sceneDust', 'sceneAnimal']) assert.equal(R.seeable(k), true, k);
  for (const k of ['late', 'flag', 'missing', 'stuffed', 'indoors', 'speeding', 'rut']) assert.equal(R.seeable(k), false, k);
  assert.equal(R.seeable('boxDown', true), false, 'a box that was down before the shift is nobody\'s offence');
  // Every kind it can see is one the verdict counts (avoidable).
  for (const k of R.SEEABLE) assert.equal(verdict([{ kind: k }]), k === 'lawnDamage' ? 'suspension' : 'warning', k);
});

ok('a seen complaint takes no photo; an unseen one still does', () => {
  const photo = { at: 10, caption: '', facts: [{ id: 'a', kind: 'animal', x: 0, z: 0, radius: 2, road: 7, blocking: true }] };
  const lawn = { kind: 'lawnDamage', customer: '', target: 1, at: 20, x: 5, z: 5, road: 7, line: '' };
  assert.equal(dismissed(lawn, [photo]), true, 'the existing photo rule');
  assert.equal(dismissed({ ...lawn, seen: true }, [photo]), false, 'seen by the Boss: no photo explains it');
  const stuffed = { kind: 'stuffed', customer: '', target: 3, at: 20, x: 0, z: 0, road: -1, line: '' };
  const flyers = { at: 1, caption: '', facts: [{ id: 's', kind: 'stuffed', x: 0, z: 0, radius: 1, target: 3 }] };
  assert.equal(dismissed(stuffed, [flyers]), true); assert.equal(dismissed({ ...stuffed, seen: true }, [flyers]), false);
});

ok('speeding past the Boss: well over the road\'s limit, near and in its sight, once a pass', () => {
  for (const kind of [1, 2, 3, 5, 13]) {
    const limit = roadTop(kind);
    assert.equal(R.speeding(limit + R.WELL_OVER - .1, kind), false, `just under, kind ${kind}`);
    assert.equal(R.speeding(limit + R.WELL_OVER + .1, kind), true, `well over, kind ${kind}`);
    assert.equal(R.speeding(-(limit + R.WELL_OVER + .1), kind), true, 'either way');
  }
  assert.equal(R.speeding(105 / 3.6, 2), false, '15 km/h over a 90 is not well over'); assert.equal(R.speeding(116 / 3.6, 2), true, '26 over is');
  assert.equal(R.speedLabel(115 / 3.6, 2), 'Speeding past the Boss: 115 km/h where the limit is 90');
  const w = new R.Watch(); w.reset(true);
  const fast = roadTop(3) + R.WELL_OVER + 2;
  assert.equal(w.passing(input(player(0, -60, fast)), 3), false, 'beyond PASS_RANGE');
  assert.equal(w.passing(input(player(0, -30, fast), false), 3), false, 'out of its sight');
  assert.equal(w.passing(input(player(0, -30, fast), true, false), 3), false, 'its car off the road');
  assert.equal(w.passing(input(player(0, -30, fast)), null), false, 'off any road');
  assert.equal(w.passing(input(player(0, -30, roadTop(3))), 3), false, 'at the limit');
  assert.equal(w.passing(input(player(0, -30, fast)), 3), true, 'a pass');
  assert.equal(w.passing(input(player(0, -20, fast)), 3), false, 'the same pass once');
  assert.equal(w.passing(input(player(0, 140, fast), false), 3), false);
  assert.equal(w.passing(input(player(0, -30, fast)), 3), false, 'not yet re-armed under REARM');
  w.passing(input(player(0, 200, 0), false), 3);
  assert.equal(w.passing(input(player(0, -30, fast)), 3), true, 'away and back: a new pass');
  const f = new R.Watch(); f.reset(true); f.saw(off('ditchMail'));
  assert.equal(f.passing(input(player(0, -30, fast)), 3), false, 'not while it follows (it is behind you)');
});

ok('the watch: on file at once, follows and flashes, pulled over by stopping near it, or it gives up', () => {
  const w = new R.Watch();
  w.reset(false); assert.equal(w.state, 'off'); assert.equal(w.saw(off('lawnMail')), false, 'other days: nobody is watching'); assert.equal(w.seen.length, 0);
  w.reset(true); assert.equal(w.state, 'post'); assert.equal(w.signal, false);
  assert.equal(w.tick(1, input(player(0, -5, 0))), null, 'waiting: nothing happens');
  assert.equal(w.saw(off('lawnMail', 100)), true); assert.equal(w.state, 'following'); assert.equal(w.signal, true, 'it flashes at once');
  assert.deepEqual(w.seen.map(o => o.kind), ['lawnMail'], 'on file at once');
  assert.equal(w.saw(off('ditchMail', 120)), true, 'more while it follows'); assert.equal(w.pending.length, 2);
  // Driving near it: not pulled over. Then stopped with it near, 1.5 s: pulled over.
  for (let t = 0; t < 3; t += .1) assert.equal(w.tick(.1, input(player(0, -15, 6))), null, 'driving on near it');
  let e = null; for (let i = 0; i < 14; i++) assert.equal(w.tick(.1, input(player(0, -15, 0))), null, 'not before STOP_HOLD');
  e = w.tick(.15, input(player(0, -15, 0))); assert.equal(e, 'pulledOver'); assert.equal(w.pulledOver, 1); assert.equal(w.state, 'away'); assert.equal(w.signal, false);
  assert.deepEqual(w.release().map(o => o.kind), ['lawnMail', 'ditchMail'], 'the write-up names both');
  assert.equal(w.pending.length, 0); assert.equal(w.seen.length, 2, 'the record stays');
  assert.equal(w.saw(off('sceneHorn')), false, 'driving off: it sees nothing'); assert.equal(w.tick(1, input(player(0, -5, 0))), null);
  w.back(); assert.equal(w.state, 'post', 'back at its post');
  // Stopped where it cannot reach: not yet; once it comes near, at once (the player has long stood still).
  w.saw(off('relief', 1000));
  for (let t = 0; t < 3; t += .1) assert.equal(w.tick(.1, input(player(0, -60, 0))), null, 'stopped beyond STUCK_NEAR');
  assert.equal(w.tick(.1, input(player(0, -18, 0))), 'pulledOver', 'it arrives'); w.release(); w.back();
  // Crawling beside it: at once. Stuck slow near it: 4 s.
  w.saw(off('relief', 2000)); assert.equal(w.tick(.1, input(player(0, -6, 1))), 'pulledOver', 'slow beside'); w.release(); w.back();
  w.saw(off('relief', 3000)); e = null; let t = 0;
  for (; t < 6 && !e; t += .1) e = w.tick(.1, input(player(0, -15, 2), true));
  assert.equal(e, 'pulledOver'); assert.ok(t > 3.9 && t < 4.2, `stuck ${t} s`); w.release(); w.back();
  // Driving on: not pulled over, and out of its sight LOSE seconds it gives up.
  w.saw(off('sceneDust', 4000)); e = null; t = 0;
  for (; t < 40 && !e; t += .1) e = w.tick(.1, input(player(0, -80, 20), t < 5));
  assert.equal(e, 'gaveUp'); assert.ok(Math.abs(t - 5 - R.LOSE) < .25, `gave up after ${t - 5} s unseen`); assert.equal(w.gaveUp, 1);
  assert.equal(w.pending.length, 0); assert.equal(w.seen.length, 6, 'still on file'); assert.equal(w.state, 'away');
  w.back(); w.saw(off('sceneDust', 4500)); assert.equal(w.tick(.1, input(player(0, -80, 20), true, false)), 'gaveUp', 'its car left the road');
  // Seen, then never reachable (stopped far up a lane, still in sight): it gives up after FOLLOW_MAX, it does not flash for ever.
  w.back(); w.saw(off('sceneHorn', 5000)); e = null; t = 0;
  for (; t < 200 && !e; t += .5) e = w.tick(.5, input(player(0, -60, 0)));
  assert.equal(e, 'gaveUp'); assert.ok(Math.abs(t - R.FOLLOW_MAX) <= .5, `gave up after ${t} s following`);
  w.reset(true); assert.equal(w.seen.length + w.pulledOver + w.gaveUp, 0, 'a new day starts clean');
  // One act, seen once: one knock that downs both boxes of a shared frame.
  assert.equal(w.saw(off('boxDown', 100)), true); assert.equal(w.saw(off('boxDown', 100 + R.ONE_ACT)), true, 'seen (no photo for either)');
  assert.equal(w.seen.length, 1, 'but one offence on file');
  assert.equal(w.saw(off('boxDown', 200 + R.ONE_ACT)), true); assert.equal(w.seen.length, 2, 'a later knock is another act');
  assert.equal(w.saw(off('lawnMail', 201 + R.ONE_ACT)), true); assert.equal(w.seen.length, 3, 'another kind at once is another offence');
  assert.equal(R.ONE_ACT, 40, 'two seconds of play');
});

ok('the write-up costs shift time and never ends the shift', () => {
  const day = 8 * 3600;
  assert.equal(R.clockJump(0, day), 20 * 60);
  assert.equal(R.clockJump(day - 600, day), 600 - R.CLOCK_ROOM, 'near 18:00 it stops short');
  assert.equal(R.clockJump(day - 30, day), 0); assert.ok(R.clockJump(day - 30, day) + day - 30 < day);
  const card = R.writeUpCard(1, [off('lawnMail'), { kind: 'speeding', label: R.speedLabel(30, 3), at: 0 }], 20 * 60);
  assert.equal(card.title, 'Written up');
  assert.deepEqual(card.lines, [R.WINDOW[0], 'Seen by the Boss: Mail on a lawn; Speeding past the Boss: 108 km/h where the limit is 75.', 'That took 20 minutes. The shift goes on.']);
  assert.equal(R.writeUpCard(2, [off('schoolBus')], 0).lines[2], 'The shift goes on.');
  assert.equal(R.writeUpCard(2, [off('schoolBus')], 0).lines[1], 'Seen by the Boss: Passed a flashing school bus.');
  assert.equal(new Set([1, 2, 3, 4].map(n => R.writeUpCard(n, [], 60).lines[0])).size, 4, 'a different line each time');
});

ok('verdict: one seen is at least a warning; two, or seen lawn damage, a suspension; unseen as before', () => {
  for (const base of ['clear', 'warning', 'suspension']) assert.equal(R.seenVerdict(base, []), base, 'nothing seen: the existing verdict');
  assert.equal(R.seenVerdict('clear', [off('ditchMail')]), 'warning');
  assert.equal(R.seenVerdict('clear', [off('schoolBus')]), 'warning', 'a school bus pass is no complaint, but it is seen');
  assert.equal(R.seenVerdict('warning', [off('ditchMail')]), 'warning');
  assert.equal(R.seenVerdict('suspension', [off('ditchMail')]), 'suspension', 'never softer than the existing verdict');
  assert.equal(R.seenVerdict('clear', [off('ditchMail'), { kind: 'speeding', label: '', at: 0 }]), 'suspension', 'two');
  assert.equal(R.seenVerdict('clear', [off('lawnDamage')]), 'suspension', 'seen lawn damage');
  assert.equal(R.seenVerdict('warning', [off('lawnMail'), off('lawnMail')]), 'suspension');
});

ok('words: the start card, the clean day, the end card; dry, no police', () => {
  assert.equal(R.START_LINE, 'The Boss is out on the route today.');
  assert.equal(R.CLEAN_LINE, 'The Boss had nothing to say. That is the best he does.');
  assert.deepEqual(R.seenReport([], 0), [R.CLEAN_LINE]);
  assert.deepEqual(R.seenReport([off('lawnMail'), off('schoolBus')], 0), ['Seen by the Boss: Mail on a lawn; Passed a flashing school bus.']);
  assert.deepEqual(R.seenReport([off('lawnMail')], 1), ['Seen by the Boss: Mail on a lawn.', 'You did not stop for the Boss. It went in the file anyway.']);
  for (const line of [...R.WINDOW, R.START_LINE, R.CLEAN_LINE, R.FLASH_LINE]) assert.doesNotMatch(line, /police|officer|ticket|siren|arrest|stupid|idiot/i, line);
});

console.log(`ride-along rules: ${passed} groups PASS`);
