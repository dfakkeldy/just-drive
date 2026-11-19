// Get Fired and the score stream. Bundled and run by tools/score-rules-mutations.mjs (cwd web/), never on its own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ScoreStream, KEEP } from '../web/src/score-events.ts';
import { POINTS, PENALTIES, LADDER, COMBO_WINDOW, COMBO_FRESH, ScoreBook, stepFor, stepName, comboFactor, novelty, topOffences, progress,
  better, readBest, saveBest, BEST_KEY, placeAt, churchZones, timeLeftText, offenceLabel, scores } from '../web/src/score-rules.ts';
import { readMode } from '../web/src/mode.ts';
import { Complaints } from '../web/src/complaints.ts';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; };
const ev = (kind, time, extra = {}) => ({ kind, place: 'route', speed: 8, time, ...extra });
const COMPLAINTS = ['lawnDamage', 'boxDown', 'lawnMail', 'ditchMail', 'missing', 'stuffed', 'flag', 'late', 'indoors', 'relief', 'sceneHit', 'sceneHorn', 'sceneDust'];
const UNSCORED = ['sceneAnimal'];
const GRADES = ['box:rock', 'box:lean', 'box:dent', 'box:down'];

ok('every complaint kind but an animal scare, mailbox grade, lawn ruts, a drift and losing the Boss score; nothing else does yet', () => {
  // A drift (drift-rules.ts) is a newer kind; tools/drift-rules-check.mjs holds its size and bonus.
  for (const kind of [...COMPLAINTS, ...GRADES, 'rut', 'drift', 'lostBoss']) assert.ok(POINTS[kind] > 0, kind);
  assert.equal(Object.keys(POINTS).length, COMPLAINTS.length + GRADES.length + 3, 'complaints, grades, ruts, drift and lostBoss');
  // Frightening an animal is a complaint but, like a hit (NEVER), it never scores.
  for (const kind of UNSCORED) { assert.equal(POINTS[kind], undefined, kind); assert.equal(new ScoreBook().add(ev(kind, 1)).points, 0, kind); }
  // The complaint file names exactly these fourteen kinds.
  const declared = readFileSync('src/complaints.ts', 'utf8').match(/export type ComplaintKind = ([^;]+);/)[1].match(/'(\w+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(declared.sort(), [...COMPLAINTS, ...UNSCORED].sort());
  for (const kind of [...COMPLAINTS, ...UNSCORED, ...GRADES, 'rut', 'schoolBus', 'lostBoss']) assert.notEqual(offenceLabel(kind), kind, `label for ${kind}`);
});

ok('the ladder: seven named steps, each needs more points and a wider gap than the last', () => {
  assert.deepEqual(LADDER.map(r => r.name), ['Coaching chat', 'Verbal warning', 'Written warning', 'One-day suspension', 'Three-day suspension', 'Hearing', 'Fired']);
  for (let i = 1; i < LADDER.length; i++) {
    assert.ok(LADDER[i].at > LADDER[i - 1].at);
    assert.ok(LADDER[i].at - LADDER[i - 1].at > LADDER[i - 1].at - (i > 1 ? LADDER[i - 2].at : 0), `gap ${i}`);
  }
  for (const r of LADDER.slice(0, -1)) assert.match(r.steward, /You still work here\.$/);
  assert.doesNotMatch(LADDER.at(-1).steward, /still work here/);
  // Generic words only: no real union or postal service name.
  for (const r of LADDER) assert.doesNotMatch(r.steward, /Canada Post|CUPW|Postes|USPS|Royal Mail|Teamsters|Unifor|PSAC/i);
  assert.equal(stepFor(0), 0); assert.equal(stepName(0), 'Clean record');
  assert.equal(stepFor(LADDER[0].at - 1), 0); assert.equal(stepFor(LADDER[0].at), 1); assert.equal(stepName(1), 'Coaching chat');
  assert.equal(stepFor(LADDER.at(-1).at), LADDER.length); assert.equal(stepName(LADDER.length), 'Fired'); assert.equal(stepFor(1e9), LADDER.length);
  assert.deepEqual(progress(0, 0), { next: 'Coaching chat', need: LADDER[0].at, fraction: 0 });
  const mid = (LADDER[0].at + LADDER[1].at) / 2;
  assert.deepEqual(progress(mid, 1), { next: 'Verbal warning', need: LADDER[1].at - mid, fraction: .5 });
  assert.equal(progress(1e9, LADDER.length).fraction, 1);
});

ok('a new kind of offence is worth more than the tenth knocked box', () => {
  // A knock reports two facts, the grade and the customer's call. Every kind's first beats both together.
  const tenthKnock = (POINTS['box:down'] + POINTS.boxDown) * novelty(9);
  for (const kind of Object.keys(POINTS)) if (kind !== 'box:down' && kind !== 'boxDown') assert.ok(POINTS[kind] * novelty(0) > tenthKnock, `${kind} ${POINTS[kind] * novelty(0)} vs ${tenthKnock}`);
  const b = new ScoreBook(); let t = 0;
  for (let i = 0; i < 9; i++) b.add(ev('box:down', t += 10));
  const tenth = b.add(ev('box:down', t += 10)), step = b.step;
  const fresh = b.add(ev('lawnMail', t += 10));
  assert.equal(b.step, step, 'same ladder step');
  assert.ok(fresh.points > tenth.points, `${fresh.points} > ${tenth.points}`);
  assert.ok(fresh.firstOfKind && !tenth.firstOfKind);
  assert.ok(novelty(0) > novelty(1) && novelty(1) > novelty(5) && novelty(50) > 0);
});

ok('a creative run beats simple repetition', () => {
  // Forty facts each. Repetition: twenty knocked boxes and their calls, eight seconds apart.
  const rep = new ScoreBook(); let t = 0;
  for (let i = 0; i < 20; i++) { t += 8; rep.add(ev('box:down', t)); rep.add(ev('boxDown', t)); }
  const groups = [['lawnMail', 'box:rock'], ['box:lean', 'ditchMail'], ['rut', 'lawnDamage', 'box:dent'], ['box:down', 'boxDown', 'lawnMail'],
    ['sceneHorn'], ['sceneHit', 'sceneHorn'], ['relief'], ['indoors'], ['sceneDust'], ['rut', 'lawnDamage', 'box:down', 'boxDown'], ['flag'],
    ['ditchMail', 'box:lean'], ['stuffed', 'missing', 'late'], ['box:rock', 'rut', 'lawnMail'], ['ditchMail', 'box:dent'], ['box:lean', 'lawnMail', 'rut', 'box:rock'], ['flag', 'lawnDamage', 'rut', 'box:dent', 'ditchMail']];
  const creative = new ScoreBook(); t = 0; let n = 0;
  for (const g of groups) { t += 20; for (const k of g) if (n < 40) { t += 1.5; creative.add(ev(k, t)); n++; } }
  assert.equal(n, 40);
  assert.ok(creative.total > 1.5 * rep.total, `${creative.total} vs ${rep.total}`);
  assert.ok(creative.step > rep.step, `${stepName(creative.step)} vs ${stepName(rep.step)}`);
  // And a hundred boxes in a row never reach the Hearing.
  const many = new ScoreBook(); t = 0;
  for (let i = 0; i < 100; i++) { t += 8; many.add(ev('box:down', t)); many.add(ev('boxDown', t)); }
  assert.ok(many.step < LADDER.findIndex(r => r.name === 'Hearing') + 1, stepName(many.step));
});

ok('combo: each new kind within the window grows it and keeps it open; repeats share it but never keep it open', () => {
  const b = new ScoreBook();
  assert.equal(b.add(ev('lawnMail', 10)).combo, 1);
  const t = 10 + COMBO_WINDOW - .01;
  assert.equal(b.add(ev('ditchMail', t)).combo, comboFactor(2));
  assert.equal(b.add(ev('ditchMail', t + 3)).combo, comboFactor(2), 'a repeat shares the combo but does not grow it');
  assert.equal(b.chain, 2);
  assert.ok(Math.abs(b.comboLeft(t + 3) - (COMBO_WINDOW - 3)) < 1e-9, 'the repeat did not reopen the window');
  assert.equal(b.add(ev('box:rock', t + 3.5)).combo, comboFactor(3), 'a new kind grows it');
  assert.equal(b.comboAt(t + 4.5), comboFactor(3)); assert.ok(Math.abs(b.comboLeft(t + 4.5) - (COMBO_WINDOW - 1)) < 1e-9);
  assert.equal(b.comboAt(t + 3.5 + COMBO_WINDOW + .01), 1);
  assert.equal(b.add(ev('box:rock', t + 3.5 + COMBO_WINDOW - .5)).combo, comboFactor(3));
  assert.equal(b.add(ev('box:lean', t + 3.5 + COMBO_WINDOW + .01)).combo, 1, 'a repeat inside the window did not keep it open');
  assert.ok(b.bestChain.kinds === 3 && b.bestChain.points > 0);
  assert.ok(comboFactor(100) <= 3 && comboFactor(2) > 1);
  // Stale kinds (used COMBO_FRESH times already) never build a combo, however close together.
  const stale = new ScoreBook(); let s = 0;
  for (let i = 0; i < COMBO_FRESH; i++) { stale.add(ev('lawnMail', s += 10)); stale.add(ev('ditchMail', s += 10)); }
  stale.add(ev('lawnMail', s += 10)); assert.equal(stale.add(ev('ditchMail', s + 1)).combo, 1);
  assert.equal(stale.add(ev('flag', s + 2)).combo, 1, 'a fresh kind after stale ones starts its own combo');
});

ok('a whole day of ruts on one lawn stays near nothing', () => {
  // A rut fact about every 3 m: six a second at 18 m/s, for the whole 1440 s day, at the Hearing's multiplier.
  const b = new ScoreBook(); b.step = 6; b.add(ev('lawnDamage', 0));
  const start = b.total;
  for (let i = 1; i <= 6 * 1440; i++) b.add(ev('rut', i / 6));
  assert.ok(b.total - start < 200, `ruts all day: ${b.total - start}`);
});

ok('repeats cannot farm a big combo: knocks and ruts every few seconds after a long chain stay below Fired', () => {
  const b = new ScoreBook(); let t = 0;
  for (const k of ['lawnMail', 'ditchMail', 'box:rock', 'box:lean', 'box:dent', 'flag', 'relief', 'indoors', 'sceneDust']) b.add(ev(k, t += 1));
  const chained = b.total; let afterTen = 0;
  for (let i = 0; i < 60; i++) { b.add(ev('box:down', t += 1.5)); b.add(ev('boxDown', t)); b.add(ev('rut', t += 1.5)); if (i === 9) afterTen = b.total; }
  assert.ok(b.total - afterTen < chained / 2, `fifty stale knocks add ${b.total - afterTen}; nine kinds made ${chained}`);
  assert.ok(!b.fired, `${stepName(b.step)} at ${b.total}`);
  const alone = new ScoreBook(); t = 0;
  for (let i = 0; i < 60; i++) { alone.add(ev('box:down', t += 1.5)); alone.add(ev('boxDown', t)); alone.add(ev('rut', t += 1.5)); }
  assert.ok(alone.step <= 3, `sixty knocks with ruts alone: ${stepName(alone.step)}`);
});

ok('each step raises the multiplier', () => {
  const b = new ScoreBook(); b.total = LADDER[2].at - 1; b.step = 2;
  const before = b.multiplier, r = b.add(ev('sceneDust', 100));
  assert.equal(r.stepUp, 3); assert.equal(b.step, 3); assert.ok(b.multiplier > before);
  const a = new ScoreBook(), c = new ScoreBook(); c.step = 4;
  assert.ok(c.add(ev('rut', 1)).points > a.add(ev('rut', 1)).points);
  const f = new ScoreBook(); f.total = LADDER.at(-1).at - 1; f.step = LADDER.length - 1; assert.equal(f.fired, false);
  f.add(ev('relief', 5)); assert.equal(f.fired, true); assert.equal(stepName(f.step), 'Fired');
});

ok('real places: nothing scores at a cemetery, a church ground or the school bus stop; animals and people never score', () => {
  for (const place of ['cemetery', 'church', 'busStop']) {
    const b = new ScoreBook(); b.add(ev('lawnMail', 1));
    const r = b.add(ev('box:down', 2, { place }));
    assert.equal(r.points, 0, place); assert.equal(b.chain, 1, `${place} does not feed the combo`);
    assert.equal(b.kinds.has('box:down'), false, `${place} leaves no offence on file`);
    assert.equal(scores(ev('sceneHit', 1, { place })), false);
  }
  for (const subject of ['animal', 'person']) assert.equal(new ScoreBook().add(ev('sceneHit', 1, { subject })).points, 0, subject);
  assert.ok(new ScoreBook().add(ev('sceneHit', 1, { subject: 'car' })).points > 0);
});

ok('the school bus stays a penalty: negative, anywhere, at any step, and it ends the combo', () => {
  assert.ok(PENALTIES.schoolBus < 0);
  for (const place of ['route', 'busStop']) for (const step of [0, 3, 6]) {
    const b = new ScoreBook(); b.step = step; b.add(ev('lawnMail', 1)); b.add(ev('ditchMail', 2));
    const total = b.total, r = b.add(ev('schoolBus', 3, { place }));
    assert.equal(r.points, PENALTIES.schoolBus); assert.equal(b.total, total + PENALTIES.schoolBus);
    assert.equal(b.chain, 0); assert.equal(b.step, step, 'the ladder never steps down');
    assert.equal(b.add(ev('box:rock', 4)).combo, 1);
  }
  const b = new ScoreBook(); b.add(ev('schoolBus', 1)); assert.ok(b.total < 0);
  assert.deepEqual(topOffences(b), [], 'a penalty is never a top offence');
});

ok('the stream stays open: an unknown kind is recorded and scores nothing', () => {
  const s = new ScoreStream(), heard = [], b = new ScoreBook();
  const stop = s.listen(e => heard.push(b.add(e)));
  s.report(ev('airtime', 1)); s.report(ev('lawnMail', 2));   // airtime: not a kind yet (a drift now is: drift-rules.ts)
  assert.equal(heard.length, 2, 'every listener hears every fact'); assert.equal(heard[0].points, 0); assert.ok(heard[1].points > 0); assert.equal(s.reported, 2);
  stop(); s.report(ev('flag', 3)); assert.equal(heard.length, 2, 'unsubscribed');
  for (let i = 0; i < KEEP + 10; i++) s.report(ev('rut', i));
  assert.equal(s.recent.length, KEEP); assert.equal(s.recent.at(-1).time, KEEP + 9);
  const again = []; s.listen(e => again.push(e)); s.clear(); assert.equal(s.reported, 0); assert.equal(s.recent.length, 0);
  s.report(ev('rut', 1)); assert.equal(again.length, 1, 'clear keeps listeners');
});

ok('top three offences by points', () => {
  const b = new ScoreBook(); let t = 0;
  for (const k of ['lawnMail', 'lawnMail', 'lawnMail', 'relief', 'box:rock', 'sceneHit']) b.add(ev(k, t += 10));
  const top = topOffences(b);
  assert.equal(top.length, 3); assert.deepEqual(top.map(o => o.kind), ['sceneHit', 'relief', 'lawnMail']);
  assert.equal(top[2].count, 3); assert.ok(top[0].points >= top[1].points && top[1].points >= top[2].points);
});

ok('best run: its own key, a better run replaces it, blocked or bad storage is harmless', () => {
  assert.equal(BEST_KEY, 'mmm.fired.best.v1');
  const map = new Map(), store = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
  map.set('mmm.shift.v1', 'career');
  const a = { step: 3, total: 3000, timeLeft: 100, chain: 50 };
  assert.equal(readBest(() => store), null); assert.equal(saveBest(a, () => store), a);
  assert.deepEqual(readBest(() => store), a);
  const worse = { ...a, total: 2900 }; assert.deepEqual(saveBest(worse, () => store), a);
  const later = { ...a, timeLeft: 50 }; assert.equal(better(later, a), false); assert.equal(better({ ...a, timeLeft: 200 }, a), true);
  const higher = { step: 4, total: 2800, timeLeft: 0, chain: 0 }; assert.equal(saveBest(higher, () => store), higher);
  assert.deepEqual([...map.keys()].sort(), ['mmm.fired.best.v1', 'mmm.shift.v1']); assert.equal(map.get('mmm.shift.v1'), 'career');
  for (const bad of ['{', '{"step":99,"total":1,"timeLeft":1,"chain":1}', '{"step":1,"total":"x","timeLeft":1,"chain":1}', '[]']) {
    map.set(BEST_KEY, bad); assert.equal(readBest(() => store), null, bad);
  }
  assert.equal(readBest(() => { throw Error('blocked'); }), null);
  assert.equal(saveBest(a, () => { throw Error('blocked'); }), a);
  // Blocked storage: the best run this page already holds still beats a weaker run, and a better run still wins.
  assert.equal(saveBest(worse, () => { throw Error('blocked'); }, a), a); assert.equal(saveBest(higher, () => { throw Error('blocked'); }, a), higher);
  assert.equal(timeLeftText(0), 'no time left'); assert.equal(timeLeftText(3 * 3600 + 5 * 60 + 9), '3 h 05 min left');
});

ok('places: cemetery polygons first, then church grounds and the bus stop', () => {
  const zones = [{ place: 'church', x: 0, z: 0, radius: 50 }, { place: 'busStop', x: 200, z: 0, radius: 40 }];
  assert.equal(placeAt(49.9, 0, zones), 'church'); assert.equal(placeAt(50.1, 0, zones), 'route');
  assert.equal(placeAt(200, 39.9, zones), 'busStop'); assert.equal(placeAt(200, 40.1, zones), 'route');
  assert.equal(placeAt(0, 0, zones, () => true), 'cemetery'); assert.equal(placeAt(500, 0, zones, () => false), 'route');
  // The real Mabou church, from the baked landmarks.
  const manifest = JSON.parse(readFileSync('../data/baked/terrain/manifest.json')), village = manifest.village;
  const landmarks = JSON.parse(readFileSync('../data/baked/terrain/landmarks.json'));
  const church = churchZones(landmarks, village);
  assert.equal(church.length, landmarks.filter(l => /church/i.test(l.name)).length); assert.ok(church.length >= 1);
  for (const lm of landmarks.filter(l => /church/i.test(l.name))) for (const [e, n] of lm.footprint) {
    assert.equal(placeAt(e - village[0], village[1] - n, church), 'church', 'every corner of the church is inside its ground');
  }
  assert.ok(church.every(z => z.radius > 40 && z.radius < 120));
});

ok('mode: ?mode=fired and a saved fired choice; Just Drive never offers it', () => {
  assert.equal(readMode(new URLSearchParams('mode=fired'), () => { throw Error('storage accessed'); }), 'fired');
  assert.equal(readMode(new URLSearchParams(), () => ({ getItem: () => 'fired' })), 'fired');
  assert.equal(readMode(new URLSearchParams('mode=fired'), undefined, { brand: 'just' }), 'explore');
  assert.equal(readMode(new URLSearchParams(), () => ({ getItem: () => 'fired' }), { brand: 'just' }), 'explore');
  assert.equal(readMode(new URLSearchParams('mode=fire'), () => ({ getItem: () => null })), 'mail');
  const title = readFileSync('src/title.ts', 'utf8');
  // Get fired is pressed in Get Fired, and not in Today's run (which is a Get Fired run with its own button).
  assert.match(title, /<button id="modeFired" aria-pressed="\$\{fired && !daily\}">Get fired<\/button>/);
  assert.match(title, /\['modeFired', 'fired'\]/);
  // The mode chooser sits only on the mail card: never in Just Drive, an area card or 1884.
  assert.match(title, /const mailCard = !\(historical \|\| just \|\| areaName\);/);
  assert.match(title, /\$\{mailCard \? `<div id="modeChoice"/);
});

ok('complaints report once each to a listener', () => {
  const heard = [], c = new Complaints(x => heard.push(x.kind));
  const base = { customer: 'x', target: 1, at: 0, x: 0, z: 0, road: -1, line: '' };
  c.add({ ...base, kind: 'lawnDamage' }); c.add({ ...base, kind: 'lawnDamage' }); c.add({ ...base, kind: 'boxDown' });
  assert.deepEqual(heard, ['lawnDamage', 'boxDown']);
  assert.doesNotThrow(() => new Complaints().add({ ...base, kind: 'flag' }));
});

console.log(`score rules: ${passed} groups passed`);
await import('./score-shift-check.mjs');
