// Today's run: the seed, the run it fixes, the bingo card and its lines, the result text and the streak.
// Bundled and run by tools/daily-rules-mutations.mjs (cwd web/), never on its own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DAILY_LIMIT, LINE_BONUS, CARD_BONUS, DAILY_ADDRESS, DAILY_KEY, DAILY_STARTS, SCENE_START, DAILY_VEHICLES, DAILY_MOODS, POOL, LINES, CARD_SIZE,
  atlanticDate, dayBefore, shortDate, dailySeed, dailyPlan, dailyArea, supplyFor, drawCard, linesDone, bingoBonus, BingoCard, packFilled, unpackFilled,
  betterDaily, headline, resultText, clockText, readDaily, nextRecord, saveDaily, poolIsSafe, FILLED_SQUARE, EMPTY_SQUARE,
} from '../web/src/daily-rules.ts';
import { POINTS, PENALTIES, LADDER, ScoreBook, stepFor, COMBO_WINDOW } from '../web/src/score-rules.ts';
import { painterDay } from '../web/src/painter-rules.ts';
import { fishDay } from '../web/src/road-scene-rules.ts';
import { startKey } from '../web/src/start-key.ts';
import { GARAGE } from '../web/src/garage.ts';
import { MOODS } from '../web/src/weather.ts';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; };
const ALL = { boxes: true, lawns: true, relief: true, painter: true, fish: true };
const ev = (kind, extra = {}) => ({ kind, place: 'route', speed: 8, time: 1, ...extra });
const days = n => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i, 16)).toISOString().slice(0, 10));

ok('the same day and area give the same run and card; another day or area gives another', () => {
  const a = dailyPlan('2026-11-17', 'mabou'), b = dailyPlan('2026-11-17', 'mabou');
  assert.deepEqual(a, b);
  assert.deepEqual(drawCard(a.seed, supplyFor(a, ALL)), drawCard(b.seed, supplyFor(b, ALL)));
  assert.equal(dailySeed('2026-11-17', 'mabou'), a.seed);
  assert.notEqual(dailySeed('2026-11-18', 'mabou'), a.seed);
  assert.notEqual(dailySeed('2026-11-17', 'judique'), a.seed);
  const month = days(60).map(d => dailyPlan(d, 'mabou'));
  assert.equal(new Set(month.map(p => p.seed)).size, 60, 'sixty days, sixty seeds');
  const cards = month.map(p => JSON.stringify(drawCard(p.seed, supplyFor(p, ALL))));
  assert.ok(new Set(cards).size >= 55, `cards differ from day to day: ${new Set(cards).size} of 60`);
  assert.notDeepEqual(drawCard(month[0].seed, supplyFor(month[0], ALL)), drawCard(month[1].seed, supplyFor(month[1], ALL)), 'tomorrow is a new card');
  for (const key of ['start', 'vehicle', 'mood', 'scene', 'day']) assert.ok(new Set(month.map(p => p[key])).size >= 2, `${key} changes over sixty days`);
});

ok('the plan: a five-minute limit, a mail-play vehicle, a weather mood, a shift day that agrees with its scene', () => {
  assert.ok(DAILY_LIMIT >= 240 && DAILY_LIMIT <= 360, 'about five real minutes');
  const vehicles = new Set(DAILY_VEHICLES.map(([v]) => v)), moods = new Set(DAILY_MOODS.map(([m]) => m));
  assert.ok(Math.abs(DAILY_VEHICLES.reduce((s, [, w]) => s + w, 0) - 1) < 1e-9 && Math.abs(DAILY_MOODS.reduce((s, [, w]) => s + w, 0) - 1) < 1e-9);
  for (const v of vehicles) assert.ok(GARAGE.some(g => g.id === v), v);
  assert.ok(!vehicles.has('horse'), 'the horse is the 1884 ride');
  for (const m of moods) assert.ok(MOODS.some(([id]) => id === m), m);
  const scenes = { painter: 0, fish: 0, none: 0 };
  for (const d of days(400)) {
    const p = dailyPlan(d, 'mabou');
    assert.equal(p.limit, DAILY_LIMIT); assert.ok(vehicles.has(p.vehicle)); assert.ok(moods.has(p.mood));
    assert.ok(Number.isSafeInteger(p.day) && p.day > 1);
    assert.equal(painterDay(p.day), p.scene === 'painter', `${d} day ${p.day} painter`);
    assert.equal(fishDay(p.day), p.scene === 'fish', `${d} day ${p.day} fish`);
    if (p.scene === 'none') assert.ok(DAILY_STARTS.mabou.includes(p.start), p.start);
    else assert.match(p.start, new RegExp(`^${SCENE_START}:0\\.(5[5-9]|6[0-2])$`));
    scenes[p.scene]++;
  }
  assert.ok(scenes.painter > 40 && scenes.fish > 40 && scenes.none > 160, JSON.stringify(scenes));
  assert.equal(dailyArea('mabou'), true); assert.equal(dailyArea('judique'), false, 'no route, no daily run');
  assert.equal(dailyPlan('2026-11-17', 'judique').scene, 'none');
});

ok('every start is a real public road on the Mabou land; a scene day starts about a kilometre short of the scene', () => {
  const manifest = JSON.parse(readFileSync('../data/baked/terrain/manifest.json', 'utf8')), v = manifest.village;
  const roads = JSON.parse(readFileSync('../data/baked/terrain/roads.json', 'utf8')).roads.map(r => ({ ...r, pts: r.pts.map(([e, n]) => [e - v[0], v[1] - n]) }));
  const boxes = JSON.parse(readFileSync('../data/baked/terrain/props.json', 'utf8')).mailboxes.map(b => ({ x: b.x - v[0], z: v[1] - b.y }));
  for (const start of DAILY_STARTS.mabou) {
    const pose = startKey(start, roads);
    assert.ok(pose, start);
    assert.ok(boxes.filter(b => Math.hypot(b.x - pose.x, b.z - pose.z) < 500).length >= 8, `${start}: mailboxes near`);
    assert.ok(Math.hypot(pose.x, pose.z) > 500, `${start}: away from the church ground at the village point`);
  }
  // The fish truck and the painter stand by this point on Mabou Mines Road (road-scene.ts).
  const scene = { x: 618982.72 - v[0], z: v[1] - 5109266.90 };
  for (let share = .55; share <= .625; share += .01) {
    const pose = startKey(`${SCENE_START}:${share.toFixed(2)}`, roads), d = Math.hypot(pose.x - scene.x, pose.z - scene.z);
    assert.ok(d > 600 && d < 1400, `${share}: ${d} m from the scene`);
    // Facing it: a few metres on, the car is nearer.
    const ahead = Math.hypot(pose.x + 20 * Math.sin(pose.heading) - scene.x, pose.z - 20 * Math.cos(pose.heading) - scene.z);
    assert.ok(ahead < d, `${share}: faces the scene`);
  }
});

ok('the card: nine kinds the area can supply today, each paid by the rules, never a penalty or an animal', () => {
  assert.equal(poolIsSafe(), true);
  for (const s of POOL) {
    assert.ok(POINTS[s.kind] > 0, s.kind); assert.ok(!(s.kind in PENALTIES), s.kind);
    assert.ok(s.counts.length >= 1 && s.counts.every(n => Number.isSafeInteger(n) && n >= 1));
    for (const n of s.counts) { const l = s.label(n); assert.ok(l.length > 3 && l.length <= 24, l); assert.doesNotMatch(l, /bus|church|cemetery|animal|cow|dog|horse|person/i, l); }
  }
  for (const banned of ['schoolBus', 'sceneAnimal', 'missing', 'stuffed', 'late']) assert.ok(!POOL.some(s => s.kind === banned), `${banned} never on a card`);
  for (const d of days(200)) {
    const p = dailyPlan(d, 'mabou');
    for (const supply of [supplyFor(p, ALL), supplyFor(p, { ...ALL, painter: false, fish: false })]) {
      const card = drawCard(p.seed, supply);
      assert.equal(card.length, CARD_SIZE);
      assert.equal(new Set(card.map(s => s.kind)).size, CARD_SIZE, 'nine different kinds');
      for (const s of card) {
        const spec = POOL.find(x => x.kind === s.kind);
        assert.ok(supply[spec.needs], `${d}: ${s.kind} needs ${spec.needs}`);
        assert.ok(spec.counts.includes(s.need)); assert.equal(s.label, spec.label(s.need));
      }
      const scene = card.filter(s => ['sceneDust', 'sceneHorn', 'sceneHit'].includes(s.kind)).map(s => s.kind).sort();
      if (supply.painter) assert.deepEqual(scene, ['sceneDust'], `${d}: the painter square on the painter's day`);
      else if (supply.fish) assert.deepEqual(scene, ['sceneHit', 'sceneHorn'], `${d}: the fish truck squares on its day`);
      else assert.deepEqual(scene, [], `${d}: no scene square without the scene`);
    }
  }
  // A painter day with the painter off (no road scene built): no painter square.
  const painterDayPlan = days(400).map(d => dailyPlan(d, 'mabou')).find(p => p.scene === 'painter');
  assert.equal(supplyFor(painterDayPlan, { ...ALL, painter: false }).painter, false);
  assert.equal(supplyFor({ ...painterDayPlan, scene: 'none' }, ALL).painter, false, 'the painter square only on the painter day');
  assert.ok(!drawCard(painterDayPlan.seed, supplyFor(painterDayPlan, { ...ALL, painter: false })).some(s => s.kind === 'sceneDust'));
  // The scene square lands anywhere on the grid, not always first.
  const spots = new Set(days(400).map(d => dailyPlan(d, 'mabou')).filter(p => p.scene === 'painter').map(p => drawCard(p.seed, supplyFor(p, ALL)).findIndex(s => s.kind === 'sceneDust')));
  assert.ok(spots.size >= 5, `painter square spots: ${[...spots]}`);
});

ok('bingo lines: eight lines, a bonus for each new line and a large one for the full card', () => {
  assert.equal(LINES.length, 8);
  assert.equal(linesDone(Array(9).fill(true)), 8); assert.equal(linesDone(Array(9).fill(false)), 0);
  assert.equal(linesDone([true, true, true, false, false, false, false, false, false]), 1);
  assert.equal(linesDone([true, false, false, false, true, false, false, false, true]), 1, 'a diagonal');
  assert.equal(linesDone([false, false, true, false, true, false, true, false, false]), 1, 'the other diagonal');
  assert.equal(linesDone([true, false, false, true, false, false, true, false, false]), 1, 'a column');
  assert.equal(linesDone([true, true, false, true, false, false, false, false, false]), 0);
  assert.ok(CARD_BONUS >= 4 * LINE_BONUS, 'a full card is a large bonus');
  assert.equal(bingoBonus(2, false), 2 * LINE_BONUS); assert.equal(bingoBonus(0, true), CARD_BONUS);
  const squares = 'abcdefghi'.split('').map((k, i) => ({ kind: ['box:rock', 'box:lean', 'box:dent', 'box:down', 'lawnMail', 'ditchMail', 'lawnDamage', 'rut', 'relief'][i], need: i === 0 ? 3 : 1, label: k }));
  const card = new BingoCard(squares);
  // Two of three rocks: no square yet.
  assert.deepEqual(card.hear(ev('box:rock')).filled, []); card.hear(ev('box:rock'));
  assert.equal(card.counts[0], 2); assert.equal(card.done, 0);
  // Nothing at a protected place, nothing with an animal or a person, no penalty: the card never asks for those.
  for (const place of ['cemetery', 'church', 'busStop']) assert.deepEqual(card.hear(ev('box:rock', { place })).filled, [], place);
  for (const subject of ['animal', 'person']) assert.deepEqual(card.hear(ev('box:rock', { subject })).filled, [], subject);
  assert.deepEqual(card.hear(ev('schoolBus')).filled, []);
  assert.equal(card.counts[0], 2);
  let r = card.hear(ev('box:rock')); assert.deepEqual(r, { filled: [0], bonus: 0, lines: 0, full: false });
  assert.equal(card.hear(ev('box:rock')).filled.length, 0, 'a full square takes no more');
  assert.equal(card.counts[0], 3, 'and counts no more');
  card.hear(ev('box:lean'));
  r = card.hear(ev('box:dent')); assert.deepEqual(r, { filled: [2], bonus: LINE_BONUS, lines: 1, full: false }, 'the top row');
  assert.equal(card.hear(ev('box:dent')).bonus, 0, 'a line pays once');
  card.hear(ev('box:down')); card.hear(ev('lawnMail'));
  // Square 5 completes the middle row; square 8 then completes the right column and the main diagonal at once.
  r = card.hear(ev('ditchMail')); assert.equal(r.lines, 1);
  card.hear(ev('lawnDamage')); card.hear(ev('rut'));
  r = card.hear(ev('relief'));
  assert.equal(card.full, true); assert.equal(card.lines, 8);
  assert.ok(r.lines >= 2 && r.full, JSON.stringify(r)); assert.equal(r.bonus, r.lines * LINE_BONUS + CARD_BONUS);
  assert.deepEqual(unpackFilled(packFilled(card.filled)), card.filled); assert.equal(packFilled(card.filled), 511);
  assert.deepEqual(unpackFilled(0b101000001), [true, false, false, false, false, false, true, false, true]);
});

ok('a bingo bonus is flat points that climb the ladder, outside the combo', () => {
  const b = new ScoreBook();
  b.add(ev('box:down', { time: 1 }));
  const chain = b.chain, total = b.total;
  assert.equal(b.award('bingo:line', 0), 0); assert.equal(b.total, total);
  const up = b.award('bingo:line', LINE_BONUS);
  assert.equal(b.total, total + LINE_BONUS, 'no combo, novelty or ladder factor'); assert.equal(b.chain, chain, 'the combo is untouched');
  assert.equal(b.kinds.get('bingo:line').points, LINE_BONUS);
  assert.equal(up, stepFor(b.total) > stepFor(total) ? stepFor(b.total) : 0);
  const c = new ScoreBook(); assert.equal(c.award('bingo:card', LADDER[2].at), 3, 'a big enough bonus reaches the rung'); assert.equal(c.step, 3);
  c.add(ev('schoolBus', { time: 2 })); assert.equal(c.step, 3, 'the ladder never steps down');
  const before = c.total; c.award('bingo:line', LINE_BONUS); assert.equal(c.total, before + LINE_BONUS, 'flat on a higher rung too: no ladder factor');
  void COMBO_WINDOW;
});

ok('the Atlantic date turns over at midnight in Mabou, in winter and in summer', () => {
  assert.equal(atlanticDate(new Date('2026-11-18T03:30:00Z')), '2026-11-17', '23:30 AST');
  assert.equal(atlanticDate(new Date('2026-11-18T04:30:00Z')), '2026-11-18', '00:30 AST');
  assert.equal(atlanticDate(new Date('2026-07-01T02:30:00Z')), '2026-06-30', '23:30 ADT');
  assert.equal(atlanticDate(new Date('2026-07-01T03:30:00Z')), '2026-07-01', '00:30 ADT');
  assert.equal(atlanticDate(new Date('2026-11-18T03:30:00Z'), () => { throw Error('no tz'); }), '2026-11-17', 'AST without time-zone data');
  assert.equal(atlanticDate(new Date('2026-11-18T05:30:00Z'), () => 'garbage'), '2026-11-18');
  assert.equal(dayBefore('2026-03-01'), '2026-02-28'); assert.equal(dayBefore('2026-01-01'), '2025-12-31');
  assert.equal(shortDate('2026-11-17'), '17 Nov'); assert.equal(shortDate('2026-01-05'), '5 Jan');
});

ok('the result text: the same result as the picture, plain squares and the link, no personal detail', () => {
  const fired = { step: LADDER.length, total: 12340, firedAt: 222.4, filled: 0b011101111 };
  assert.equal(clockText(222.4), '3:42'); assert.equal(clockText(59.9), '0:59'); assert.equal(clockText(300), '5:00');
  assert.equal(headline(fired), 'Fired in 3:42');
  assert.equal(resultText(fired, '2026-11-17', 'Mabou'),
    `Mabou Mail Madness, 17 Nov, Mabou: Fired in 3:42, bingo 7 of 9\n🟧🟧🟧\n🟧⬜🟧\n🟧🟧⬜\n${DAILY_ADDRESS}`);
  assert.equal(FILLED_SQUARE, '🟧'); assert.equal(EMPTY_SQUARE, '⬜');
  const warned = { step: 3, total: 4210, firedAt: null, filled: 0 };
  assert.equal(headline(warned), 'Written warning, 4,210 points');
  assert.equal(resultText(warned, '2026-11-18', 'Mabou').split('\n')[0], 'Mabou Mail Madness, 18 Nov, Mabou: Written warning, 4,210 points, bingo 0 of 9');
  assert.equal(headline({ step: 0, total: 0, firedAt: null, filled: 0 }), 'Clean record, 0 points');
  // A handle only when the player set one.
  assert.equal(resultText(fired, '2026-11-17', 'Mabou', '  ').split('\n')[0], 'Mabou Mail Madness, 17 Nov, Mabou: Fired in 3:42, bingo 7 of 9');
  assert.match(resultText(fired, '2026-11-17', 'Mabou', 'roadhog').split('\n')[0], / \(roadhog\)$/);
  assert.equal(DAILY_ADDRESS, 'https://mmm.fakkeldy.ca/?daily=1');
  const text = resultText(fired, '2026-11-17', 'Mabou');
  assert.equal(text.split('\n').length, 5);
  assert.doesNotMatch(text, /@|localhost|Canada Post|Postes/);
});

ok('the first finished try of the day stands; later ones are practice; the streak and the best keep their own key', () => {
  const store = new Map([['mmm.shift.v1', 'career'], ['mmm.fired.best.v1', 'best']]);
  const storage = () => ({ getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) });
  const weak = { step: 2, total: 900, firedAt: null, filled: 3 }, strong = { step: 7, total: 11000, firedAt: 250, filled: 7 };
  assert.equal(readDaily('mabou', storage), null);
  let r = saveDaily('mabou', '2026-11-17', weak, storage);
  assert.equal(r.practice, false); assert.deepEqual(r.record, { date: '2026-11-17', first: weak, tries: 1, streak: 1, best: { ...weak, date: '2026-11-17' } });
  r = saveDaily('mabou', '2026-11-17', strong, storage);
  assert.equal(r.practice, true, 'a later try the same day is practice');
  assert.deepEqual(r.record.first, weak, 'the first finished try stands'); assert.equal(r.record.tries, 2);
  assert.deepEqual(r.record.best, { ...weak, date: '2026-11-17' }, 'practice does not set the best');
  r = saveDaily('mabou', '2026-11-18', strong, storage);
  assert.equal(r.practice, false); assert.equal(r.record.streak, 2); assert.deepEqual(r.record.best, { ...strong, date: '2026-11-18' });
  r = saveDaily('mabou', '2026-11-19', weak, storage);
  assert.equal(r.record.streak, 3); assert.deepEqual(r.record.best.date, '2026-11-18', 'a weaker day keeps the best');
  r = saveDaily('mabou', '2026-11-21', weak, storage);
  assert.equal(r.record.streak, 1, 'a missed day starts the streak again');
  assert.equal(store.get('mmm.shift.v1'), 'career'); assert.equal(store.get('mmm.fired.best.v1'), 'best');
  assert.deepEqual([...store.keys()].sort(), [DAILY_KEY, 'mmm.fired.best.v1', 'mmm.shift.v1'].sort());
  assert.equal(DAILY_KEY, 'mmm.daily.v1');
  assert.deepEqual(readDaily('mabou', storage), r.record);
  // Another area has its own record in the same key.
  saveDaily('porthood', '2026-11-21', strong, storage);
  assert.deepEqual(readDaily('mabou', storage), r.record);
  // Blocked storage: the page still knows its own first try.
  const blocked = () => ({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } });
  const first = saveDaily('mabou', '2026-11-22', weak, blocked);
  assert.equal(first.practice, false);
  const again = saveDaily('mabou', '2026-11-22', strong, blocked, first.record);
  assert.equal(again.practice, true); assert.deepEqual(again.record.first, weak);
  // A bad value is not ours.
  store.set(DAILY_KEY, JSON.stringify({ mabou: { date: 'x', first: weak, tries: 1, streak: 1, best: { ...weak, date: 'x' } } }));
  assert.equal(readDaily('mabou', storage), null);
  store.set(DAILY_KEY, '[1,2]'); assert.equal(readDaily('mabou', storage), null);
  assert.deepEqual(nextRecord(null, '2026-11-17', weak).record.streak, 1);
});

ok('the better daily result: higher rung, then faster to Fired, then more squares, then more points', () => {
  const a = { step: 7, total: 10000, firedAt: 200, filled: 1 };
  assert.equal(betterDaily(a, null), true);
  assert.equal(betterDaily({ ...a, step: 6, firedAt: null }, a), false);
  assert.equal(betterDaily({ ...a, firedAt: 190 }, a), true); assert.equal(betterDaily({ ...a, firedAt: 210, filled: 511 }, a), false);
  assert.equal(betterDaily({ ...a, filled: 3 }, a), true);
  assert.equal(betterDaily({ ...a, total: 10001 }, a), true); assert.equal(betterDaily({ ...a }, a), false);
});

console.log(`PASS daily rules: ${passed} groups (seed, plan, starts on the land, card supply and safety, lines and bonus, award, Atlantic date, result text, record, ordering)`);

await import('./daily-shift-check.mjs');
