// The Party Line's call-ins in Node (web/src/party-line-rules.ts and the glue in party-line.ts, on a fake radio): which
// call plays, when, never twice in a run, the nickname for what the player does most, the pauses of the station, the
// list the build writes, and the words of tools/radio-talk/scripts.md as the build sees them.
// tools/party-line-mutations.mjs runs it, plain and mutated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as R from '../web/src/party-line-rules.ts';
import { PartyLine } from '../web/src/party-line.ts';
import { RadioPlayer } from '../web/src/radio-player.ts';
import { POINTS, ScoreBook } from '../web/src/score-rules.ts';

const at = (kind, place = 'route', subject) => ({ kind, place, speed: 5, time: 0, ...(subject ? { subject } : {}) });
const call = (file, about, caller = 'flora', name = false, seconds = 7) => ({ file, seconds, about, caller, name });
const nick = (file, kind, caller = 'theresa', name = file) => ({ file, seconds: 1.4, kind, caller, name });
const list = (calls, nicknames = [], gaps = {}) => ({ dial: '94.9', calls, nicknames, gaps });

// What each score-stream kind is about. Small knocks, hits, animals, the break and the school bus bring no call.
assert.deepEqual({ ...R.ABOUT }, { boxDown: 'box', 'box:dent': 'box', 'box:down': 'box', lawnDamage: 'lawn', rut: 'lawn', lawnMail: 'mail',
  ditchMail: 'mail', sceneHorn: 'horn', sceneDust: 'dust', missing: 'missing', late: 'late', flag: 'flag' });
for (const kind of ['box:rock', 'box:lean', 'sceneHit', 'sceneAnimal', 'relief', 'schoolBus', 'stuffed', 'indoors']) assert.equal(R.ABOUT[kind], undefined, kind);
assert.deepEqual([...R.ABOUTS], ['box', 'lawn', 'mail', 'horn', 'dust', 'missing', 'late', 'flag', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7']);
assert.deepEqual({ ...R.NICK }, { box: 'box', lawn: 'lawn', mail: 'mail', horn: 'painter', dust: 'painter', missing: 'general', late: 'general', flag: 'general' });
// The build's validator (tools/radio_catalogue.py) holds the same words.
const py = JSON.parse(execFileSync('python3', ['-c', 'import sys,json;sys.path.insert(0,"tools");import radio_catalogue as c;print(json.dumps([c.ABOUTS,c.NICK_KINDS]))'], { encoding: 'utf8' }));
assert.deepEqual(py, [[...R.ABOUTS], [...R.NICK_KINDS]], 'radio_catalogue.py and party-line-rules.ts agree');
assert.deepEqual([R.WITHIN, R.STEP_WITHIN, R.APART, R.STEP_APART, R.LEAD, R.LONGEST], [6, 12, 20, 4, 0.12, 15]);
console.log('PASS what brings a call: twelve kinds, seven steps; no hit, animal, break, school bus or small knock; the build agrees');

// Reading audio/calls.json: anything unusable is left out, and with no call there are no call-ins.
assert.equal(R.readCalls(null), null); assert.equal(R.readCalls({ dial: '94.9', calls: [] }), null); assert.equal(R.readCalls({ calls: [call('a.mp3', 'box')] }), null);
const read = R.readCalls({ dial: '94.9', calls: [call('a.mp3', 'box'), call('b.mp3', 'hedge'), call('../c.mp3', 'box'), call('d.mp3', 'box', 'Flora'),
  call('e.mp3', 'box', 'flora', 'yes'), call('f.mp3', 'box', 'flora', false, 0), call('g.mp3', 'box', 'flora', false, 16), call('h.mp3', 'lawn', 'theresa', true),
  call('i.mp3', 'lawn', 'angus', true), call('j.ogg', 'box'), null, 'x'],
nicknames: [nick('n1.mp3', 'lawn'), nick('n2.mp3', 'hedge'), nick('n3.mp3', 'box', 'theresa', ''), nick('n4.mp3', 'box', 'theresa', 'x'.repeat(41)), nick('n5.mp3', 'box', 'theresa', '  Box Basher ')],
gaps: { 'a.mp3': [[5, 6], [1, 2], [3, 3], [-1, 2], [NaN, 4], 'x'], 'bad name': [[1, 2]], 'b.mp3': 'x', 'c.mp3': [] } });
assert.deepEqual(read.calls.map(c => c.file), ['a.mp3', 'h.mp3'], 'bad files, abouts, callers, flags, lengths and a name call with no nicknames are left out');
assert.deepEqual(read.nicknames.map(n => [n.file, n.name]), [['n1.mp3', 'n1.mp3'], ['n5.mp3', 'Box Basher']]);
assert.deepEqual(read.gaps, { 'a.mp3': [[1, 2], [5, 6]] }, 'pauses are kept in order, the bad ones left out');
console.log('PASS calls.json is read strictly: bad entries left out, pauses sorted, no call means no call-ins');

// The pauses: a call starts inside one, with LEAD seconds of it left, never outside.
const g = [[1, 2], [5, 6]];
for (const [t, want] of [[0.99, false], [1, true], [1.5, true], [2 - R.LEAD, true], [2 - R.LEAD + 0.01, false], [3, false], [5.2, true], [6.5, false], [NaN, false]]) assert.equal(R.inGap(t, g), want, `inGap ${t}`);
assert.equal(R.inGap(1.5, undefined), false); assert.equal(R.inGap(1.5, []), false);
console.log('PASS pauses: inside with time to spare only');

const yes = () => true;
// An offence: a call about it, at the next pause, on the calls' dial, once its file has arrived.
{
  const b = new R.CallBoard(list([call('box1', 'box'), call('box2', 'box'), call('lawn1', 'lawn')]), () => 0);
  assert.equal(b.hear(at('box:rock'), 0, 0), null, 'a rocked box brings no call');
  assert.equal(b.hear(at('boxDown', 'cemetery'), 0, 0), null, 'nothing at a cemetery');
  assert.equal(b.hear(at('boxDown', 'church'), 0, 0), null); assert.equal(b.hear(at('boxDown', 'busStop'), 0, 0), null);
  assert.equal(b.hear(at('boxDown', 'route', 'animal'), 0, 0), null, 'nothing with an animal'); assert.equal(b.hear(at('boxDown', 'route', 'person'), 0, 0), null);
  assert.equal(b.hear(at('schoolBus'), 0, 0), null, 'the school bus is never a joke'); assert.equal(b.hear(at('sceneHit'), 0, 0), null);
  assert.equal(b.topKind(), 'general', 'none of those counted');
  const p = b.hear(at('boxDown'), 0, 10);
  assert.equal(p?.call.file, 'box1'); assert.equal(p?.about, 'box'); assert.equal(p?.step, 0); assert.equal(p?.nickname, null); assert.equal(b.pending, p);
  assert.equal(b.ready(11, false, true, yes), null, 'not tuned to the calls');
  assert.equal(b.ready(11, true, false, yes), null, 'not in a pause');
  assert.equal(b.ready(11, true, true, () => false), null, 'not fetched yet');
  assert.equal(b.pending, p, 'it still waits');
  assert.equal(b.ready(12, true, true, yes), p, 'tuned, in a pause, fetched: it plays');
  assert.equal(b.onAir, p); assert.equal(b.pending, null); assert.deepEqual(b.played, [p]);
  assert.notEqual(b.waiting(13), null, 'on air counts as waiting (the end card keeps the radio up)');
  b.done(19); assert.equal(b.onAir, null); assert.equal(b.waiting(19), null);
  // Never the same call twice in a run.
  const q = b.hear(at('boxDown'), 0, 50); assert.equal(q?.call.file, 'box2');
  assert.equal(b.ready(51, true, true, yes), q); b.done(58);
  assert.equal(b.hear(at('box:down'), 0, 90), null, 'every box call is used');
  b.reset(); assert.equal(b.hear(at('boxDown'), 0, 100)?.call.file, 'box1', 'a new run may use them again');
}
console.log('PASS an offence: a call about it at the next pause, tuned and fetched, never twice in a run');

// Late is never: the call starts within WITHIN seconds of the offence, or it is dropped.
{
  const b = new R.CallBoard(list([call('box1', 'box'), call('box2', 'box')]));
  b.hear(at('boxDown'), 0, 0);
  assert.equal(b.ready(R.WITHIN, true, false, yes), null); assert.notEqual(b.pending, null, 'still in time');
  assert.equal(b.ready(R.WITHIN + 0.01, true, true, yes), null, 'too late'); assert.equal(b.pending, null, 'and dropped');
  assert.equal(b.played.length, 0, 'a dropped call is not used');
  const one = new R.CallBoard(list([call('only', 'box')]));
  one.hear(at('boxDown'), 0, 0); assert.equal(one.ready(R.WITHIN + 1, true, true, yes), null);
  assert.equal(one.hear(at('boxDown'), 0, 20)?.call.file, 'only', 'a dropped call may still play later in the run');
  // The same thing again while its call waits: the same call, later; no new pick to fetch.
  const p = b.hear(at('boxDown'), 0, 10);
  assert.equal(b.hear(at('box:down'), 0, 14), null); assert.equal(b.pending?.call, p?.call); assert.equal(b.pending?.at, 14);
  assert.notEqual(b.ready(14 + R.WITHIN, true, true, yes), null, 'its time runs from the latest');
}
console.log('PASS within six seconds of the offence or never; a repeat keeps the waiting call and its file');

// One at a time, and the station stays a station: APART seconds after a call before the next offence call.
{
  const b = new R.CallBoard(list([call('box1', 'box'), call('lawn1', 'lawn'), call('lawn2', 'lawn'), call('s1', 'step1', 'effie'), call('s2', 'step2', 'effie')]));
  b.hear(at('boxDown'), 0, 0); assert.ok(b.ready(0, true, true, yes));
  b.hear(at('rut'), 0, 3); assert.equal(b.ready(3, true, true, yes), null, 'not over a call on air');
  b.done(4);
  assert.equal(b.ready(5, true, true, yes), null, 'too soon after the last call');
  b.hear(at('rut'), 0, 4 + R.APART - 1); assert.equal(b.ready(4 + R.APART - 0.01, true, true, yes), null);
  assert.notEqual(b.ready(4 + R.APART, true, true, yes), null, 'APART seconds after');
  b.done(30);
  // A ladder step may follow sooner.
  b.hear(at('lawnDamage'), 1, 31); assert.equal(b.pending?.about, 'step1');
  assert.equal(b.ready(30 + R.STEP_APART - 0.01, true, true, yes), null); assert.equal(b.ready(30 + R.STEP_APART, true, true, yes)?.call.file, 's1');
}
console.log('PASS one call at a time; twenty seconds between offence calls, four before a ladder step');

// A ladder step outranks an offence, waits longer, and a newer offence takes an older offence's place.
{
  const b = new R.CallBoard(list([call('box1', 'box'), call('lawn1', 'lawn'), call('mail1', 'mail'), call('s3', 'step3', 'sandy'), call('s7', 'step7', 'bernadette')]));
  assert.equal(b.hear(at('rut'), 0, 0)?.about, 'lawn');
  assert.equal(b.hear(at('boxDown'), 0, 1)?.about, 'box', 'the newer offence'); assert.equal(b.pending?.about, 'box', 'it takes the older one\'s place');
  const s = b.hear(at('lawnMail'), 3, 2); assert.equal(s?.about, 'step3'); assert.equal(s?.step, 3);
  assert.equal(b.hear(at('rut'), 0, 3), null, 'an offence never takes a step\'s place'); assert.equal(b.pending, s);
  assert.equal(b.ready(2 + R.STEP_WITHIN, true, false, yes), null); assert.equal(b.pending, s, 'a step waits up to STEP_WITHIN');
  assert.equal(b.ready(2 + R.STEP_WITHIN + 0.01, true, true, yes), null); assert.equal(b.pending, null);
  b.hear(at('boxDown'), 0, 20); assert.equal(b.hear(at('boxDown'), 7, 21)?.call.file, 's7', 'Fired');
  b.pending = null;
  assert.equal(b.hear(at('boxDown'), 6, 22)?.about, 'box', 'a step with no call left falls back to the offence');
  assert.equal(b.hear(at('box:rock'), 8, 23), null, 'no step past Fired');
}
console.log('PASS a ladder step outranks an offence and waits up to twelve seconds; a newer offence replaces an older one');

// The nickname: by the caller of the call, for what the player has done most (a tie goes to the latest).
{
  const names = [nick('t-lawn-1', 'lawn', 'theresa', 'the Lawnmower'), nick('t-lawn-2', 'lawn', 'theresa', 'the Rototiller'), nick('t-box', 'box', 'theresa', 'Box Basher'),
    nick('t-gen', 'general', 'theresa', 'you-know-who'), nick('a-box', 'box', 'angus', 'the Mailbox Menace'), nick('a-paint', 'painter', 'angus', 'the Horn Section')];
  const calls = [call('tn1', 'box', 'theresa', true), call('tn2', 'box', 'theresa', true), call('tn3', 'box', 'theresa', true), call('tn4', 'box', 'theresa', true),
    call('an1', 'dust', 'angus', true), call('an2', 'missing', 'angus', true), call('mn1', 'mail', 'morag', true)];
  const b = new R.CallBoard(list(calls, names), () => 0);
  for (let i = 0; i < 3; i++) b.hear(at('rut'), 0, i);
  assert.equal(b.topKind(), 'lawn');
  let p = b.hear(at('boxDown'), 0, 10);
  assert.equal(p?.call.file, 'tn1'); assert.equal(p.nickname?.name, 'the Lawnmower', 'lawn is still the most (3 to 1)');
  b.ready(10, true, true, yes); b.done(17);
  p = b.hear(at('boxDown'), 0, 40); assert.equal(p.nickname?.name, 'the Rototiller', 'a fresh one next');
  b.ready(40, true, true, yes); b.done(47);
  b.hear(at('boxDown'), 0, 70); assert.equal(b.topKind(), 'box', '3 to 3: a tie goes to the latest');
  b.pending = null; b.hear(at('rut'), 0, 71); assert.equal(b.topKind(), 'lawn', '3 to 4');
  b.hear(at('rut'), 0, 72); b.hear(at('rut'), 0, 73); b.pending = null;
  p = b.hear(at('box:dent'), 0, 74); assert.equal(b.topKind(), 'lawn', '4 to 6');
  assert.equal(p.nickname?.name, 'the Lawnmower', 'every lawn name said: the first again ("Again!")');
  b.pending = null;
  // A kind the caller has no name for: a general one; a caller with neither: the call is not chosen.
  const c = new R.CallBoard(list(calls, names));
  c.hear(at('ditchMail'), 0, 0); assert.equal(c.pending, null, 'Morag has no nickname: her name call is never chosen');
  c.pending = null; c.hear(at('sceneDust'), 0, 1); assert.equal(c.pending?.nickname?.name, 'the Horn Section');
  assert.equal(c.topKind(), 'painter', '1 mail, 1 painter: the tie goes to the latest');
  c.pending = null; c.hear(at('flag'), 0, 2); c.hear(at('flag'), 0, 3); c.pending = null;
  assert.equal(c.topKind(), 'general', '2 general beat 1 painter');
  c.hear(at('missing'), 0, 5);
  assert.equal(c.pending, null, 'Angus has no general name: his name call about a skipped stop is not chosen');
  assert.equal(c.nicknameFor('angus', 'general'), null); assert.equal(c.nicknameFor('theresa', 'mail')?.name, 'you-know-who', 'no mail name: a general one');
  assert.equal(c.nicknameFor('nobody'), null);
}
console.log('PASS nicknames: the caller\'s own, for the kind done most (ties to the latest), fresh first, then the first again; general when none fits');

// The random choice is inside the open calls, even at the edge.
for (const r of [0, 0.5, 0.999999, 1, -1]) {
  let got;
  assert.doesNotThrow(() => { got = new R.CallBoard(list([call('a', 'box'), call('b', 'box'), call('c', 'box')]), () => r).hear(at('boxDown'), 0, 0)?.call.file; }, `random ${r}`);
  assert.ok(['a', 'b', 'c'].includes(got), `random ${r}`);
}
assert.equal(new R.CallBoard(list([call('a', 'box'), call('b', 'box')]), () => 0.99).hear(at('boxDown'), 0, 0)?.call.file, 'b');
console.log('PASS the choice is always one of the open calls');

// A real run: the score book's ladder steps bring the step calls in order.
{
  const steps = Array.from({ length: R.STEPS }, (_, i) => call(`s${i + 1}`, `step${i + 1}`, 'effie'));
  const b = new R.CallBoard(list([...steps, call('box1', 'box')])), book = new ScoreBook();
  const heard = [], reached = [];
  for (let t = 0; t < 400 && !book.fired; t += 1) {
    const kinds = Object.keys(POINTS), kind = kinds[t % kinds.length], e = { ...at(kind), time: t };
    const r = book.add(e), p = b.hear(e, r.stepUp, t * 30);
    if (r.stepUp) { reached.push(r.stepUp); heard.push(p?.call.file); assert.ok(b.ready(t * 30, true, true, yes)); b.done(t * 30 + 8); }
  }
  assert.ok(book.fired); assert.equal(reached.at(-1), 7);
  assert.deepEqual(heard, reached.map(n => `s${n}`), 'a call for each step reached, in order');
}
console.log('PASS a real score book: a call for each of the seven steps, in order');

// What the screen shows: the handle (through the word filter) or the invented call sign; never spoken.
assert.equal(R.callSign('Road Hog 7', 'Muddy Tire'), 'Road Hog 7');
for (const bad of ['sh1t head', 'ab', 'x'.repeat(15), 'a<b>c', null, 42, undefined]) assert.equal(R.callSign(bad, 'Muddy Tire'), 'Muddy Tire', String(bad));
assert.equal(R.radioLine('Muddy Tire'), 'Caller about: Muddy Tire');
assert.equal(R.endLine(0, '94.9 THE PARTY LINE', 'Muddy Tire', null), null);
assert.equal(R.endLine(1, '94.9 THE PARTY LINE', 'Muddy Tire', null), '94.9 THE PARTY LINE took a call about Muddy Tire.');
assert.equal(R.endLine(3, '94.9 THE PARTY LINE', 'Muddy Tire', 'the Lawnmower'), '94.9 THE PARTY LINE took 3 calls about Muddy Tire. Callers know you as “the Lawnmower”.');
{
  const b = new R.CallBoard(list([call('box1', 'box', 'theresa', true), call('lawn1', 'lawn')], [nick('n', 'box', 'theresa', 'Box Basher')]));
  assert.equal(b.lastName(), null); b.hear(at('boxDown'), 0, 0); assert.equal(b.lastName(), null, 'a waiting call has said no name');
  assert.equal(b.played.length, 0, 'a waiting call has not played'); b.ready(1, true, true, yes);
  assert.equal(b.played.length, 1); assert.equal(b.lastName(), 'Box Basher');
}
console.log('PASS the screen: handle through the word filter or the call sign; "Caller about"; the end card line');

// The words as the build lists them (tools/radio-talk/calls_talk.py): every call and nickname is readable here.
{
  const words = JSON.parse(execFileSync('python3', ['-c', `import sys,json;sys.path.insert(0,"tools/radio-talk");import calls_talk as c;a,b=c.pieces();
print(json.dumps({"dial":"94.9","calls":[{"file":x["source"]+".mp3","seconds":8,"about":x["about"],"caller":x["caller"],"name":x["name"]} for x in a],
"nicknames":[{"file":x["source"]+".mp3","seconds":1.5,"kind":x["kind"],"caller":x["caller"],"name":x["name"]} for x in b]}))`], { encoding: 'utf8' }));
  const got = R.readCalls(words);
  assert.equal(got.calls.length, 40); assert.equal(got.nicknames.length, 24);
  assert.deepEqual([...new Set(got.calls.map(c => c.about))].sort(), [...R.ABOUTS].sort(), 'a call for every kind and every step');
  for (const kind of R.NICK_KINDS) for (const caller of ['theresa', 'angus']) assert.equal(new R.CallBoard(got).nicknameFor(caller, kind)?.kind, kind, `${caller} ${kind}`);
  // Every call of a whole run is reachable: each about, over and over, plays all its calls once.
  const b = new R.CallBoard(got);
  let t = 0;
  for (const about of R.ABOUTS) {
    const kind = Object.keys(R.ABOUT).find(k => R.ABOUT[k] === about);
    for (let i = 0; i < 6; i++) {
      t += 30;
      const step = about.startsWith('step') ? +about.slice(4) : 0;
      if (b.hear(at(kind ?? 'box:rock'), step, t)) { assert.ok(b.ready(t, true, true, yes)); b.done(t + 8); }
    }
  }
  assert.equal(b.played.length, 40, 'all forty calls in one long run, none twice');
  assert.equal(new Set(b.played.map(p => p.call.file)).size, 40);
}
console.log('PASS the forty calls and twenty-four nicknames of scripts.md are readable, and all forty can play in one run');

// The glue (party-line.ts) on a fake radio: fetch, the pause, the end of a piece, the line, the end card.
{
  const fetched = [];
  globalThis.fetch = async (url) => { fetched.push(url); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
  let now = 100;
  const radio = { onEnd: null, pos: null, tunedDial: '94.9', calls: [],
    stationNamed: (d) => d === '94.9' ? '94.9 THE PARTY LINE' : null, position() { return this.pos; },
    callIn(c) { this.calls.push(c); return true; } };
  const calls = R.readCalls({ dial: '94.9', calls: [call('box1.mp3', 'box', 'theresa', true), call('lawn1.mp3', 'lawn'), call('s1.mp3', 'step1', 'effie')],
    nicknames: [nick('n.mp3', 'box', 'theresa', 'Box Basher')], gaps: { 'piece.mp3': [[10, 11]] } });
  const line = new PartyLine(radio, calls, '/audio', 'Muddy Tire', () => now);
  assert.equal(typeof radio.onEnd, 'function', 'it asks at the end of each piece');
  line.hear(at('boxDown'), 0); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(fetched, ['/audio/box1.mp3', '/audio/n.mp3'], 'the call and its nickname are fetched at once');
  assert.equal(line.wantsAir, true);
  radio.pos = { dial: '94.9', file: 'piece.mp3', at: 9 }; line.update(); assert.equal(radio.calls.length, 0, 'not in a pause yet');
  radio.pos = { dial: '99.1', file: 'piece.mp3', at: 10.5 }; line.update(); assert.equal(radio.calls.length, 0, 'not on 94.9');
  radio.pos = { dial: '94.9', file: 'other.mp3', at: 10.5 }; line.update(); assert.equal(radio.calls.length, 0, 'a piece with no pause there');
  radio.pos = { dial: '94.9', file: 'piece.mp3', at: 10.5 }; now = 102; line.update();
  assert.equal(radio.calls.length, 1, 'in the pause: the call'); assert.equal(radio.calls[0]?.urls.length, 2); assert.equal(radio.calls[0]?.line, 'Caller about: Muddy Tire');
  assert.ok(radio.calls[0]?.urls.every(u => u.startsWith('blob:')), 'from memory');
  now = 110; radio.calls[0]?.done(); assert.equal(line.board.onAir, null);
  assert.equal(line.endLine(), '94.9 THE PARTY LINE took a call about Muddy Tire. Callers know you as “Box Basher”.');
  // Off the calls' dial: a new pick is not fetched, and a waiting call is not counted on the end card.
  radio.tunedDial = '99.1'; now = 130; line.hear(at('rut'), 0); await new Promise(r => setTimeout(r, 0));
  assert.equal(fetched.length, 2, 'nothing fetched off the dial'); assert.equal(line.board.pending?.about, 'lawn');
  assert.equal(line.endLine(), '94.9 THE PARTY LINE took a call about Muddy Tire. Callers know you as “Box Basher”.');
  assert.equal(line.wantsAir, false, 'off the dial a waiting call will not play: the end card does not wait for it');
  // Tuned in while it waits: its file is fetched then, once, and the end card waits for it.
  radio.tunedDial = '94.9'; radio.pos = { dial: '94.9', file: 'piece.mp3', at: 3 }; line.update(); line.update();
  assert.deepEqual(fetched.slice(2), ['/audio/lawn1.mp3'], 'fetched on tuning in, once'); assert.equal(line.wantsAir, true);
  assert.equal(line.endLine(), '94.9 THE PARTY LINE took a call about Muddy Tire. Callers know you as “Box Basher”.', 'a call still to come is not claimed');
  line.board.pending = null;
  // The end of a piece is a pause too: the radio asks onEnd, and only on the calls' dial.
  now = 140; line.hear(at('lawnDamage'), 1); await new Promise(r => setTimeout(r, 0));
  radio.tunedDial = '99.1'; assert.equal(radio.onEnd(), null, 'the end of a piece on another station');
  radio.tunedDial = '94.9'; const end = radio.onEnd(); assert.equal(end?.urls.length, 1, 'the step call at the end of the piece');
  end?.done(); line.reset(); assert.equal(line.endLine(), null, 'a new run starts with no call');
  // A call the radio refuses (held, off) is over at once.
  now = 200; line.hear(at('rut'), 0); await new Promise(r => setTimeout(r, 0));
  radio.callIn = () => false; radio.pos = { dial: '94.9', file: 'piece.mp3', at: 10.2 }; line.update();
  assert.equal(line.board.onAir, null, 'refused: not left on air');
}
{
  // A file that fails is asked for once, not every frame.
  const fetched = [];
  globalThis.fetch = async (url) => { fetched.push(url); return { ok: false, status: 404 }; };
  const radio = { onEnd: null, tunedDial: '94.9', stationNamed: () => null, position: () => ({ dial: '94.9', file: 'piece.mp3', at: 3 }), callIn: () => true };
  const line = new PartyLine(radio, R.readCalls({ dial: '94.9', calls: [call('lawn1.mp3', 'lawn')], gaps: {} }), '/audio', 'Muddy Tire', () => 1);
  line.hear(at('rut'), 0);
  for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 0)); line.update(); }
  assert.deepEqual(fetched, ['/audio/lawn1.mp3'], 'one try');
}
{
  // A file let go while it was on its way is not kept: its address in memory is given back.
  const revoked = [], made = [], waits = new Map();
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = (b) => { const u = create(b); made.push(u); return u; };
  URL.revokeObjectURL = (u) => { revoked.push(u); revoke(u); };
  globalThis.fetch = (url) => new Promise(r => waits.set(url, () => r({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  const names = Array.from({ length: 10 }, (_, i) => `c${i}.mp3`);
  const radio = { onEnd: null, tunedDial: '94.9', stationNamed: () => null, position: () => null, callIn: () => true };
  const line = new PartyLine(radio, R.readCalls({ dial: '94.9', calls: names.map(n => call(n, 'lawn')), gaps: {} }), '/audio', 'Muddy Tire', () => 1);
  line.hear(at('rut'), 0); const waiting = line.board.pending.call.file, rest = names.filter(n => n !== waiting);
  for (const n of rest) line.fetch(n);
  for (const done of waits.values()) done();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert.equal(line.ready.size, 8, 'eight kept'); assert.ok(line.ready.has(waiting), 'the waiting call is kept, though it is the oldest');
  assert.ok(!line.ready.has(rest[0]) && !line.ready.has(rest[1]), 'the oldest others let go');
  assert.equal(made.length, 10); assert.deepEqual(revoked.sort(), made.filter(u => ![...line.ready.values()].includes(u)).sort(), 'what is not kept is given back');
  URL.createObjectURL = create; URL.revokeObjectURL = revoke;
}
console.log('PASS the glue: fetch at once or on tuning in, start in a pause on 94.9 only, the end of a piece, the radio line, the end card, a refusal, one try, files let go');

// The radio's player (radio-player.ts) with a stand-in <audio>: a call plays into the piece, and the piece goes on.
{
  globalThis.Audio = class { constructor() { this.heard = {}; this.paused = true; this.src = ''; this.currentTime = 0; this.duration = NaN; this.readyState = 4; }
    addEventListener(type, run) { (this.heard[type] ??= []).push(run); } emit(type) { for (const run of this.heard[type] ?? []) run(); }
    play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
  globalThis.document = { hidden: false };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
  // Like the car's readout, the words read the station's present piece.
  class Player extends RadioPlayer {
    words = [];
    label() { this.words.push(this.station < 0 ? '' : this.stations[this.station].tracks[this.track].title); }
    call(urls, done, ended = false) { return this.interject(urls, done, ended); }
  }
  const piece = (n) => ({ file: `p${n}.mp3`, title: `p${n}`, seconds: 100 });
  const stations = [{ dial: '94.9', name: 'TALK', tracks: [piece(0), piece(1), piece(2)] }, { dial: '96.1', name: 'ONE', tracks: [{ file: 'one.mp3', title: 'one', seconds: 100 }] }];
  const radio = new Player(stations, '/audio', '94.9', 'test.radio');
  let clock = { track: 2, at: 50 };
  radio.live = () => clock;
  const join = async () => { await settle(); radio.audio.currentTime = 0; radio.audio.emit('loadedmetadata'); await settle(); };
  radio.start(); radio.audio.duration = 100; await join();
  assert.equal(radio.track, 2); assert.equal(radio.audio.currentTime, 50, 'joined at the clock');
  const piece2 = radio.audio.src;
  let done = 0;
  // A call of two files in the middle of the piece: each plays, then the piece goes on from the same second.
  assert.equal(radio.call(['blob:call', 'blob:nick'], () => done++), true);
  assert.equal(radio.audio.src, 'blob:call'); assert.equal(radio.heard(), null, 'the piece is not heard while a call plays');
  radio.audio.emit('ended'); assert.equal(radio.audio.src, 'blob:nick'); assert.equal(done, 0);
  radio.audio.emit('ended'); assert.equal(done, 1, 'over once');
  assert.equal(radio.audio.src, piece2); await join(); assert.equal(radio.audio.currentTime, 50, 'the piece goes on from the same second');
  // The clock moved on meanwhile; the piece ends: the next piece starts from the top, not part way in.
  clock = { track: 0, at: 9 };
  radio.audio.emit('ended'); await join();
  assert.equal(radio.track, 0); assert.equal(radio.audio.currentTime, 0, 'after a call the station goes on in order, from the top');
  // A call at the end of a piece: the next piece after it, from the top.
  clock = { track: 2, at: 9 };
  assert.equal(radio.call(['blob:end'], () => done++, true), true); radio.audio.emit('ended'); await join();
  assert.equal(done, 2); assert.equal(radio.track, 1); assert.equal(radio.audio.currentTime, 0, 'the next piece after a call at the end');
  // The dial moves during a call (on a piece the next station does not have): the call is over, nothing throws.
  radio.audio.emit('ended'); await join(); radio.audio.emit('ended'); await join();
  assert.equal(radio.track, 0); radio.audio.emit('ended'); await join(); assert.equal(radio.track, 1);
  // As the car's radio does (radio.ts startCall), the end of a call puts the station's words back.
  assert.equal(radio.call(['blob:x'], () => { done++; radio.label(); }), true);
  assert.doesNotThrow(() => radio.turnTo(1), 'the words are put back while the old station is on the dial');
  assert.equal(done, 3, 'the dial moves: the call is over'); assert.equal(radio.station, 1);
  // Back on the dial: the station is joined at its clock again.
  clock = { track: 1, at: 40 }; radio.turnTo(0); await join();
  assert.equal(radio.track, 1); assert.equal(radio.audio.currentTime, 40, 'back on the dial, at the clock');
  clock = { track: 0, at: 12 }; radio.audio.emit('ended'); await join();
  assert.equal(radio.track, 0); assert.equal(radio.audio.currentTime, 12, 'joined again: at the end of a piece the clock decides');
  // A hold during a call: over, and the piece waits.
  assert.equal(radio.call(['blob:y'], () => done++), true); radio.setHeld(true); assert.equal(done, 4, 'held: the call is over');
  radio.setHeld(false); await join(); radio.setHeld(true);
  assert.equal(radio.call(['blob:z'], () => done++), false, 'no call while held');
  // A call file that will not play: the piece goes on.
  radio.setHeld(false); await join(); const pieceNow = radio.audio.src;
  assert.equal(radio.call(['blob:bad'], () => done++), true); radio.audio.emit('error');
  assert.equal(done, 5); assert.equal(radio.audio.src, pieceNow, 'a bad call file: the piece goes on');
}
console.log('PASS the player: a call plays into the piece, which goes on from the same second; after a call the pieces go on in order; the dial, a hold or a bad file end it');
console.log('PASS party line rules');
