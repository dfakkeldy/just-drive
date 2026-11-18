// The real Shift, Props, Complaints, Ruts and FiredRun on the score stream, in node with a small DOM stand-in.
// Imported by score-rules-check.mjs; bundled by tools/score-rules-mutations.mjs.
import assert from 'node:assert/strict';
import { Shift } from '../web/src/shift.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { FiredRun } from '../web/src/fired.ts';
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';
import { LADDER, BEST_KEY, PENALTIES } from '../web/src/score-rules.ts';

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
console.log('score shift: real Shift, Props, Ruts and FiredRun; mail play unchanged; ladder, school bus, Fired, 18:00, retry, storage.');
