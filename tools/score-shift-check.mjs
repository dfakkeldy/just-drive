// The real Shift, Props, Complaints, Ruts and FiredRun on the score stream, in node with a small DOM stand-in.
// Imported by score-rules-check.mjs; bundled by tools/score-rules-mutations.mjs.
import assert from 'node:assert/strict';
import { Shift } from '../web/src/shift.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { FiredRun } from '../web/src/fired.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { LADDER, BEST_KEY, PENALTIES } from '../web/src/score-rules.ts';
import { YardProps } from '../web/src/yard-props.ts';
import { scoreKind, SLOW, garbageDay } from '../web/src/yard-props-rules.ts';

class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); }
  hidden = false; textContent = ''; id = ''; scrollTop = 0; width = 160; height = 90; children = []; listeners = new Map(); attributes = {};
  style = { width: '', props: {}, getPropertyValue(k) { return this.props[k] ?? ''; }, setProperty(k, v) { this.props[k] = v; } };
  classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  after() {} focus() {} getContext() { return { drawImage() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelectorAll(tag) {
    const out = [], walk = n => { for (const c of n.children ?? []) if (c instanceof Element) { if (c.tagName === tag.toUpperCase()) out.push(c); walk(c); } };
    walk(this); return out;
  }
  click() { this.listeners.get('click')?.(); }
  get text() { return [this.textContent, ...this.children.map(c => typeof c === 'string' ? c : c.text)].join(' '); }
}
const elements = new Map();
globalThis.document = {
  head: new Element('head'), body: new Element('body'),
  getElementById(id) { if (!elements.has(id)) elements.set(id, Object.assign(new Element(), { id })); return elements.get(id); },
  createElement(tag) { return new Element(tag); },
};
const store = new Map([['mmm.shift.v1', JSON.stringify({ day: 4, pay: 690, warnings: 1, double: false, suspended: false, carryover: [] })]]);
const memory = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
Object.defineProperty(globalThis, 'localStorage', { get() { return memory; }, configurable: true });
const career = store.get('mmm.shift.v1');

const terrain = { heightAt() { return 0; }, surfaceAt() { return { ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }; } };
const roads = new Roads({ roads: [{ id: 7, name: 'Birch Street', kind: 2, halfWidth: 3, bridge: false, pts: [[0, 0], [1000, 0]] }] }, [0, 0], terrain);
const boxes = () => new Props({ crs: 'EPSG:2961', mailboxes: Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 10, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false })),
  communityBoxes: [{ x: 400, y: 0, heading: 0, modules: 2 }], poles: [] }, [0, 0], terrain);
const mailStub = () => ({ delivered: 0, lawn: 0, ditch: 0, reset() { this.delivered = this.lawn = this.ditch = 0; } });
const house = [{ id: 99, x: 150, y: -40, kind: 'house' }];
const hit = (props, i, kmh) => { const p = props.mail[i], v = kmh / 3.6; return props.hitCar(p.x, p.z, Math.PI / 2, v, 0, p.x - v / 120, p.z, CAR_SPEC); };
const vehicleAt = (x, z, vx = 0) => ({ x, z, vx, vz: 0, heading: Math.PI / 2, airborne: false, speed: vx, spec: CAR_SPEC });

// Normal mail play: the stream records, nothing shows it and nothing changes.
{
  const props = boxes(), shift = new Shift(props, mailStub(), roads, terrain, house, [0, 0], true, new URLSearchParams('run=1'), () => {});
  assert.equal(shift.fired, false); assert.equal(shift.career.day, 4);
  const up = props.mail.findIndex(p => !p.motion.down);
  hit(props, up, 30);
  assert.deepEqual(shift.score.recent.map(e => e.kind).sort(), ['box:down', 'boxDown']);
  shift.update(.1, vehicleAt(0, 0));
  assert.doesNotMatch(document.getElementById('shiftHud').textContent, /FIRED|pts/);
  for (let i = 0; i < 8; i++) shift.remaining[i] = 1;   // eight stops still due
  shift.end();
  assert.ok(shift.complaints.all.some(c => c.kind === 'missing'), 'mail play still files skipped stops at the end of the day');
  assert.equal(document.getElementById('shiftReport').hidden, false, 'mail play keeps its daily report');
  assert.notEqual(store.get('mmm.shift.v1'), career, 'mail play saves its career as before');
  assert.equal(store.has(BEST_KEY), false, 'mail play never writes a Get Fired best run');
  store.set('mmm.shift.v1', career); document.getElementById('shiftReport').hidden = true;
}

// Get Fired on the real Shift.
const props = boxes(), offers = [];
let agains = 0, restarts = 0;
const endings = { offer(tag, title, lines, choices) { offers.push({ tag, title, lines, choices }); }, close() {} };
const mail = mailStub();
const shift = new Shift(props, mail, roads, terrain, house, [0, 0], true, new URLSearchParams('run=1'), () => { restarts++; }, true, true);
assert.equal(shift.fired, true); assert.equal(shift.career.day, 4, 'the same route as the saved shift');
const fired = new FiredRun(shift, endings, true, () => { agains++; });
assert.ok(document.getElementById('phoneStatus').children.some(c => c.id === 'firedLine'), 'the phone line joins the phone status');
const churchBox = props.mail.findIndex((p, i) => i > 0 && !p.motion.down);
shift.placeAt = (x, z) => Math.hypot(x - props.mail[churchBox].x, z - props.mail[churchBox].z) < 5 ? 'church' : 'route';
// Shift.update drives FiredRun through Shift.onUpdate: main's frame has no Get Fired call of its own.
const tick = (dt = .25, v = vehicleAt(0, 0)) => shift.update(dt, v);

hit(props, churchBox, 30); tick();
assert.equal(fired.book.total, 0, 'a box on a church ground scores nothing');
assert.ok(shift.score.recent.every(e => e.place === 'church'));
const box = props.mail.findIndex((p, i) => i !== churchBox && !p.motion.down);
hit(props, box, 1); hit(props, box, 1); tick(1);
assert.equal(shift.score.recent.filter(e => e.kind === 'box:rock').length, 1, 'one rock per fresh touch, not per frame of contact');
hit(props, box, 4); tick();
assert.deepEqual(shift.score.recent.slice(-2).map(e => e.kind), ['box:rock', 'box:lean'], 'a slow touch rocks; a firmer one leans');
const lean = fired.book.total; assert.ok(lean > 0);
const leaned = shift.score.reported; hit(props, box, 4); tick();
assert.equal(shift.score.reported, leaned, 'the same grade on a box held in contact reports nothing new');
hit(props, box, 12); tick(); assert.equal(shift.score.recent.at(-1).kind, 'box:dent');
hit(props, box, 30); tick();
assert.deepEqual(shift.score.recent.slice(-2).map(e => e.kind).sort(), ['box:down', 'boxDown']);
assert.ok(shift.score.recent.slice(-2).every(e => e.place === 'route' && e.time > 0));
assert.ok(shift.score.recent.find(e => e.kind === 'box:down').speed > 8, 'a grade carries the impact speed');

// Thrown mail: the place is where it landed as well as the customer's box. A box down before the shift scores nothing.
{
  const landing = { x: props.mail[10].x, z: 40 }, was = shift.placeAt;
  shift.placeAt = (x, z) => Math.hypot(x - landing.x, z - landing.z) < 10 ? 'cemetery' : 'route';
  const n = shift.score.reported; mail.service.ground(landing.x, landing.z, true);
  assert.equal(shift.score.reported, n + 1); assert.deepEqual([shift.score.recent.at(-1).kind, shift.score.recent.at(-1).place], ['lawnMail', 'cemetery']);
  mail.service.ground(props.mail[12].x, 20, false);
  assert.deepEqual([shift.score.recent.at(-1).kind, shift.score.recent.at(-1).place], ['ditchMail', 'route']);
  shift.placeAt = was;
  const before = shift.score.reported;
  shift.complaints.add({ kind: 'boxDown', target: 3, at: shift.elapsed, x: 0, z: 0, road: -1, preExisting: true, customer: '', line: '' });
  assert.equal(shift.score.reported, before, 'a box that was down before the shift is not an offence');
}
// Lawn ruts across the house's lawn: a lawn complaint, then ruts.
const before = shift.score.reported;
for (let i = 0; i < 40; i++) tick(.05, vehicleAt(140 + i * .5, 40, 6));
const kinds = shift.score.recent.slice(before - shift.score.reported).map(e => e.kind);
assert.ok(kinds.includes('lawnDamage') && kinds.filter(k => k === 'rut').length >= 3, kinds.join());
assert.equal(fired.ended, false);
assert.match(document.getElementById('shiftHud').textContent, /GET FIRED/);
const line = document.getElementById('phoneStatus').children.find(c => c.id === 'firedLine');
assert.match(line.textContent, /^[\d,]+ pts( ×[\d.]+)? · [A-Za-z -]+ \d\/7( · [+−][\d,]+ .+)?$/, line.textContent);
assert.match(line.style.getPropertyValue('--fill'), /^\d+%$/, 'the phone line is the ladder bar');

// Step up: the steward grieves it and you keep the job.
const note = document.body.children.find(c => c.id === 'firedNote'), was = fired.book.step;
for (const kind of ['relief', 'sceneDust', 'sceneHit', 'indoors', 'sceneHorn']) {
  shift.reportScore(kind, 0, 0, 5); tick(.5);
  if (fired.book.step > was) break;
}
assert.ok(fired.book.step > was, `step ${fired.book.step}, ${fired.book.total} points`);
assert.equal(note.hidden, false); assert.match(note.text, new RegExp(`^ ${LADDER[fired.book.step - 1].name} .*You still work here\\.$`));
for (let i = 0; i < 30; i++) tick(1); assert.equal(note.hidden, true, 'the note fades');

// The school bus stays a penalty.
const total = fired.book.total; shift.reportScore('schoolBus', 0, 0, 5); tick();
assert.equal(fired.book.total, total + PENALTIES.schoolBus);

// Climb to Fired: the run ends from the frame, never inside the event.
// Just under Fired, then one real fact over the line: the run ends from the next shift step, never inside the event.
fired.book.total = LADDER.at(-1).at - 1; fired.book.step = LADDER.length - 1;
shift.reportScore('sceneHorn', 0, 0, 5); assert.equal(fired.book.fired, true);
assert.equal(shift.ended, false, 'no end inside the listener');
tick(.016);
assert.equal(shift.ended, true); assert.equal(offers.length, 1);
const card = offers[0];
assert.equal(card.tag, 'Get Fired'); assert.equal(card.title, 'Fired');
assert.match(card.lines[0], /points · \d+ h \d\d min left\./);
assert.match(card.lines[1], /Hand in the keys/);
assert.equal(card.lines.filter(l => /^\d\. /.test(l)).length, 3, 'top three offences');
assert.match(card.lines.at(-2), /^Best combo: \d+ kinds of offence/);
assert.equal(card.lines.at(-1), 'Your first run on file.');
assert.equal(document.getElementById('shiftReport').hidden, true, 'no daily report, no verdict, no pay');
assert.equal(store.get('mmm.shift.v1'), career, 'Get Fired never touches the saved shift');
assert.ok(store.has(BEST_KEY), 'the run is saved as best'); const best = JSON.parse(store.get(BEST_KEY)); assert.equal(best.step, LADDER.length); assert.ok(best.timeLeft > 0);
assert.equal(best.total, fired.book.total);

// Try again: the same day, a fresh book.
card.choices[0].action(); tick(.016);
// A run with no offence at all still ends with a card, and the next run still scores (the stream counts runs).
// Ending at once, with every stop still due, files no end-of-day calls into the run: quitting earns no step.
for (let i = 0; i < 8; i++) shift.remaining[i] = 1;   // eight stops still due: the mail verdict would file two skipped stops
const quit = shift.score.reported, calls = shift.complaints.all.length;
document.getElementById('endShift').click();
assert.equal(shift.score.reported, quit, 'the end-of-day sweep never scores in Get Fired'); assert.equal(shift.complaints.all.length, calls);
assert.equal(offers.length, 2); assert.equal(offers[1].title, 'Clean record'); assert.match(offers[1].lines[1], /Not one call on file/);
assert.ok(offers[1].lines.includes('No combo: never two kinds of offence at once.'), offers[1].lines.join('|'));
offers[1].choices[0].action(); tick(.016);
assert.equal(agains, 2); assert.equal(restarts, 2); assert.equal(shift.ended, false); assert.ok(shift.elapsed < 1, 'the clock starts again at 10:00');
assert.equal(fired.book.total, 0); assert.equal(fired.ended, false); assert.equal(shift.career.day, 4);
// A second run that ends at 18:00 does not replace the best run.
shift.reportScore('lawnMail', 0, 0, 3); tick();
assert.equal(fired.book.kinds.get('lawnMail').count, 1, 'the new run hears the stream');
for (let i = 0; i < 8; i++) tick(.25);   // the last touch's contact runs out
hit(props, box, 4); tick(); assert.equal(shift.score.recent.at(-1).kind, 'box:lean', 'a new day stands the box up and it can lean again');
shift.elapsed = 8 * 3600 - 1; tick();
assert.equal(offers.length, 3); assert.match(offers[2].lines[0], /the clock reached 18:00/);
assert.match(offers[2].lines.at(-1), /^Your best run: Fired · [\d,]+ points · \d+ h \d\d min left\.$/);
assert.equal(JSON.parse(store.get(BEST_KEY)).total, best.total);
shift.startOver(); assert.equal(store.get('mmm.shift.v1'), career, 'start over in Get Fired leaves the career alone');
assert.equal(shift.career.day, 4, 'and keeps the day and its route'); assert.equal(shift.ended, false);
// One kind of offence only is no combo, whatever its points.
tick(.016); shift.reportScore('relief', 0, 0, 3); tick(); document.getElementById('endShift').click();
assert.equal(offers.length, 4); assert.ok(offers[3].lines.includes('No combo: never two kinds of offence at once.'), offers[3].lines.join('|'));
// Breakable yard and field props: the real YardProps, hooked to the Shift as main.ts hooks it, hit by a car stand-in.
{
  const field = { ground: 0, canopy: 0, roadDist: 60, halfWidth: 3, kind: 2, level: 7, brook: 99 };
  const flat = { heightAt() { return 0; }, surfaceAt() { return field; } };
  const camera = { getWorldPosition: v => v.set(500, 3, 80) };
  // Invented test props round x 500, z 80: two fence sections, a bale with its neighbour 3.4 m on, a bin, a second
  // owner's woodpile. Owners are building ids.
  const list = [
    { id: 0, kind: 'railFence', x: 500, z: 80, yaw: Math.PI / 2, owner: 7, look: .2 },
    { id: 1, kind: 'railFence', x: 503, z: 80, yaw: Math.PI / 2, owner: 7, look: .2, end: true },
    { id: 2, kind: 'bale', x: 520, z: 100, yaw: 0, owner: 8, look: .5, field: true },
    { id: 3, kind: 'bale', x: 523.4, z: 100, yaw: 0, owner: 8, look: .6, field: true },
    { id: 4, kind: 'garbageBin', x: 540, z: 80, yaw: Math.PI / 2, owner: 7, look: .1, daily: true },
    { id: 5, kind: 'woodpile', x: 560, z: 80, yaw: 0, owner: 9, look: .3 },
  ];
  const day = [1, 2, 3, 4, 5, 6, 7].find(garbageDay), store0 = store.get('mmm.shift.v1');
  const make = firedMode => {
    store.set('mmm.shift.v1', JSON.stringify({ day, pay: 0, warnings: 0, double: false, suspended: false, carryover: [] }));
    const sh = new Shift(boxes(), mailStub(), roads, flat, house, [0, 0], true, new URLSearchParams('run=1'), () => {}, true, firedMode);
    const yard = new YardProps(list, flat, true);
    sh.yard = yard; yard.reset(sh.career.day);
    yard.onBreak = (p, _speed, byBale) => sh.propBroken(scoreKind(p.kind), p.owner, p.x, p.z, byBale);
    yard.update(camera, .1);
    return { sh, yard };
  };
  // The car 4 m short of a prop, driving at it.
  const drive = (yard, sh, id, speed, dx = 0, dz = -1) => {
    const p = list[id], v = { x: p.x - dx * 4, z: p.z - dz * 4, y: 0, heading: Math.atan2(dx, -dz), vx: dx * speed, vz: dz * speed, speed, spec: CAR_SPEC, airborne: false };
    for (let i = 0; i < 240 && !yard.live[id].broken; i++) { v.x += v.vx / 120; v.z += v.vz / 120; yard.step(1 / 120, v, true); sh.update(1 / 120, v); }
    return v;
  };
  // Mail play: a hard hit breaks it, slows the car a little, reports the fact and one call for the property.
  {
    const { sh, yard } = make(false);
    assert.deepEqual(yard.active.map(l => l.p.id), [0, 1, 2, 3, 4, 5], 'all drawn on garbage day');
    const v = drive(yard, sh, 0, 8);
    assert.equal(yard.live[0].broken, true); assert.ok(yard.live[0].pieces.length >= 3, 'in pieces');
    assert.ok(Math.abs(Math.hypot(v.vx, v.vz) - 8 * SLOW.railFence) < 1e-9, 'the car slows a little');
    assert.deepEqual(sh.score.recent.slice(-2).map(e => e.kind), ['prop:fence', 'propertyDamage']);
    assert.equal(sh.complaints.all.filter(c => c.kind === 'propertyDamage').length, 1);
    // The neighbouring section of the same yard: a second fact, but the owner has already called today.
    drive(yard, sh, 1, 8); assert.equal(yard.live[1].broken, true);
    assert.equal(sh.score.recent.at(-1).kind, 'prop:fence'); assert.equal(sh.complaints.all.filter(c => c.kind === 'propertyDamage').length, 1);
    // A slow touch on the woodpile: solid, not broken, nothing reported.
    const n = sh.score.reported, slow = drive(yard, sh, 5, 1);
    assert.equal(yard.live[5].broken, false); assert.equal(sh.score.reported, n); assert.ok(Math.hypot(slow.vx, slow.vz) < .5, 'stopped by it');
    // Pieces come to rest on the ground; they stay broken for the shift.
    for (let i = 0; i < 60 * 8; i++) yard.update(camera, 1 / 60);
    assert.ok(yard.live[0].pieces.every(p => p.resting && Math.abs(p.y - p.floor) < 1e-9), 'pieces at rest on the ground');
    assert.equal(yard.live[0].broken, true);
    // A second property: the day's verdict is a suspension, and the report counts the yards.
    drive(yard, sh, 5, 8); assert.equal(yard.live[5].broken, true);
    sh.end();
    assert.equal(document.getElementById('reportVerdict').textContent, 'One-day suspension. Without pay.');
    assert.ok(document.getElementById('reportStats').children.some(c => c.textContent === 'Yards damaged'), 'the report names the damage');
    assert.ok(document.getElementById('reportCalls').children.some(row => row.text.includes('No defence accepted')));
    document.getElementById('shiftReport').hidden = true;
    // A new day stands it all up; bins go out only on garbage day.
    sh.retry(); assert.equal(yard.broken, 0); assert.ok(yard.live.every(l => !l.broken && !l.pieces));
    yard.reset(day + 1); yard.update(camera, .5);
    assert.ok(!yard.active.some(l => l.p.kind === 'garbageBin'), 'no bins the day after');
  }
  // Get Fired: points, and a rolling bale that breaks its neighbour is a combo.
  {
    const { sh, yard } = make(true);
    const run = new FiredRun(sh, { offer() {}, close() {} }, false, () => {});
    drive(yard, sh, 2, 9, 1, 0);
    for (let i = 0; i < 60 * 3 && !yard.live[3].broken; i++) yard.update(camera, 1 / 60);
    assert.equal(yard.live[3].broken, true, 'the rolling bale broke its neighbour');
    const kinds = sh.score.recent.map(e => e.kind);
    assert.ok(kinds.includes('prop:bale') && kinds.includes('prop:baleStrike'), kinds.join());
    assert.ok(run.book.total > 0 && run.book.bestChain.kinds >= 2, 'a combo in Get Fired');
    sh.retry(); assert.ok(yard.live.every(l => !l.broken), 'try again stands them up');
  }
  store.set('mmm.shift.v1', store0);
}
console.log('score shift: real Shift, Props, Ruts, YardProps and FiredRun; mail play unchanged; ladder, school bus, Fired, 18:00, retry, storage, yard breaks.');
