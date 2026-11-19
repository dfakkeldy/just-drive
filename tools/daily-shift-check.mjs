// Today's run on the real Shift, Props, FiredRun and DailyRun, in node with a small DOM stand-in.
// Imported by daily-rules-check.mjs; bundled by tools/daily-rules-mutations.mjs.
import assert from 'node:assert/strict';
import { Shift } from '../web/src/shift.ts';
import { Props } from '../web/src/props.ts';
import { Roads } from '../web/src/roads.ts';
import { FiredRun } from '../web/src/fired.ts';
import { DailyRun } from '../web/src/daily.ts';
import { CLOCK_FACTOR } from '../web/src/shift-rules.ts';
import { LADDER, BEST_KEY } from '../web/src/score-rules.ts';
import { dailyPlan, DAILY_KEY, LINE_BONUS, CARD_BONUS, resultText, unpackFilled } from '../web/src/daily-rules.ts';

const canvasContext = new Proxy({ measureText: text => ({ width: text.length * 11 }) }, { get: (t, k) => k in t ? t[k] : () => {}, set: () => true });
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); }
  hidden = false; textContent = ''; id = ''; scrollTop = 0; width = 160; height = 90; children = []; listeners = new Map(); attributes = {}; classes = new Set();
  style = { width: '', props: {}, getPropertyValue(k) { return this.props[k] ?? ''; }, setProperty(k, v) { this.props[k] = v; } };
  get classList() { const c = this.classes; return { add: x => c.add(x), remove: x => c.delete(x), toggle: (x, on) => (on ?? !c.has(x)) ? c.add(x) : c.delete(x), contains: x => c.has(x) }; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  after() {} focus() {} blur() {}
  getContext() { return this.tagName === 'CANVAS' ? canvasContext : { drawImage() {} }; }
  toDataURL() { return 'data:image/png;base64,AAAA'; }
  toBlob(done) { done(null); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = nodes; }
  find(id) { for (const c of this.children) { if (!(c instanceof Element)) continue; if (c.id === id) return c; const f = c.find(id); if (f) return f; } return null; }
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
let copied = null;
Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async text => { copied = text; } }, configurable: true });
const store = new Map([['mmm.shift.v1', JSON.stringify({ day: 4, pay: 690, warnings: 1, double: false, suspended: false, carryover: [] })]]);
const memory = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
Object.defineProperty(globalThis, 'localStorage', { get() { return memory; }, configurable: true });
const career = store.get('mmm.shift.v1');

const terrain = { heightAt() { return 0; }, surfaceAt() { return { ground: 0, canopy: 0, roadDist: 10, halfWidth: 3, kind: 2, level: 7 }; } };
const roads = new Roads({ roads: [{ id: 7, name: 'Birch Street', kind: 2, halfWidth: 3, bridge: false, pts: [[0, 0], [1000, 0]] }] }, [0, 0], terrain);
const props = new Props({ crs: 'EPSG:2961', mailboxes: Array.from({ length: 20 }, (_, i) => ({ x: 100 + i * 10, y: 0, heading: 0, style: 0, tilt: 0, group: null, parcelBox: false })),
  communityBoxes: [{ x: 400, y: 0, heading: 0, modules: 2 }], poles: [] }, [0, 0], terrain);
const mailStub = () => ({ delivered: 0, lawn: 0, ditch: 0, reset() { this.delivered = this.lawn = this.ditch = 0; } });
const house = [{ id: 99, x: 150, y: -40, kind: 'house' }];
const vehicleAt = (x, z) => ({ x, z, vx: 0, vz: 0, heading: Math.PI / 2, airborne: false, speed: 0, spec: CAR_SPEC });
import { CAR_SPEC } from '../web/src/vehicle-spec.ts';

const plan = dailyPlan('2026-11-17', 'mabou');
// Mail play ignores a fixed day: only a Get Fired shift takes it.
assert.equal(new Shift(props, mailStub(), roads, terrain, house, [0, 0], true, new URLSearchParams('run=1'), () => {}, true, false, plan.day).career.day, 4);
const offers = [];
let agains = 0;
const endings = { offer(tag, title, lines, choices, body) { offers.push({ tag, title, lines, choices, body }); }, close() {} };
const shift = new Shift(props, mailStub(), roads, terrain, house, [0, 0], true, new URLSearchParams('run=1'), () => {}, true, true, plan.day);
assert.equal(shift.career.day, plan.day, 'Today’s run fixes the shift day');
let daily = null;
const fired = new FiredRun(shift, endings, true, () => { agains++; }, { limit: plan.limit, onEnd: end => daily.finish(end) });
// Nine kinds that reportScore can send straight from here; the top row is relief, sceneDust, sceneHorn.
const squares = ['relief', 'sceneDust', 'sceneHorn', 'sceneHit', 'lawnMail', 'ditchMail', 'indoors', 'flag', 'lawnDamage'].map(kind => ({ kind, need: 1, label: kind }));
daily = new DailyRun(plan, squares, 'Mabou', shift, fired, endings, () => { agains++; });
const tick = (dt = .25) => shift.update(dt, vehicleAt(0, 0));
const grid = fired.hud.find('bingoGrid'), mini = fired.line.find('bingoMini');
assert.ok(grid && grid.children.length === 9, 'the card sits in the score panel');
assert.ok(mini && mini.children.length === 9 && fired.line.children[0] === mini, 'and, small, at the front of the phone line');

// Nothing counts at a protected place.
shift.placeAt = () => 'church'; shift.reportScore('relief', 0, 0, 3); tick();
assert.equal(daily.card.done, 0); assert.equal(fired.book.total, 0);
shift.placeAt = () => 'route';
shift.reportScore('relief', 0, 0, 3); shift.reportScore('sceneDust', 0, 0, 3); tick();
assert.equal(daily.card.done, 2); assert.ok(grid.children[0].classes.has('on') && mini.children[1].classes.has('on'));
const beforeLine = fired.book.total;
shift.reportScore('sceneHorn', 0, 0, 3); tick();
assert.equal(daily.card.lines, 1);
assert.equal(fired.book.kinds.get('bingo:line')?.points, LINE_BONUS, 'a line pays its bonus into the run');
assert.ok(fired.book.total >= beforeLine + LINE_BONUS);
const note = document.body.children.find(c => c.id === 'firedNote');
assert.equal(note.hidden, false); assert.match(note.text, /Bingo|Coaching chat|Verbal warning|Written warning/);
assert.match(fired.hud.text, /\d:\d\d left/, 'the panel shows the time left');
assert.match(fired.line.text, /^ ?\s*\d:\d\d · /, 'and so does the phone line');

// The limit ends the run by itself, from the frame.
shift.elapsed = (plan.limit - .1) * CLOCK_FACTOR; tick(.016);
assert.equal(shift.ended, false);
tick(.25);
assert.equal(shift.ended, true, 'five minutes of play end the run'); assert.equal(offers.length, 1);
let card = offers[0];
assert.equal(card.tag, 'Today’s run · 17 Nov'); assert.equal(card.title, ['Clean record', ...LADDER.map(r => r.name)][fired.book.step]);
assert.doesNotMatch(card.lines[0], /^Practice/); assert.match(card.lines[0], /Bingo 3 of 9, 1 line\.$/);
assert.match(card.lines[2], /this is today’s card/); assert.match(card.lines[3], /^Streak: 1 day\. Best: /);
assert.equal(card.choices[0].label, 'Try again (practice)');
assert.ok(card.body?.find('dailyCopy'), 'the share card with its Copy button');
assert.equal(card.body.find('dailyShareButton'), null, 'no Share button without navigator.share');
const record = JSON.parse(store.get(DAILY_KEY)).mabou;
assert.equal(record.date, '2026-11-17'); assert.equal(record.tries, 1);
assert.deepEqual(unpackFilled(record.first.filled).slice(0, 4), [true, true, true, false]);
assert.equal(record.first.total, Math.round(fired.book.total));
assert.equal(daily.text, resultText(record.first, '2026-11-17', 'Mabou'));
assert.equal(store.has(BEST_KEY), false, 'Today’s run never writes the Get Fired best');
assert.equal(store.get('mmm.shift.v1'), career, 'nor the shift career');
await card.body.find('dailyCopy').click(); await new Promise(r => setTimeout(r, 0));
assert.equal(copied, daily.text, 'Copy puts the share line on the clipboard');

// Practice: a fresh card and book; the first try stands on the card and in the text.
card.choices[0].action(); tick(.016);
assert.equal(agains, 1); assert.equal(shift.ended, false); assert.equal(daily.card.done, 0); assert.equal(fired.book.total, 0);
assert.equal(shift.career.day, plan.day, 'the same day again');
assert.ok(!grid.children[0].classes.has('on'), 'the HUD card is clear again');
for (const s of squares.slice(0, 8)) shift.reportScore(s.kind, 0, 0, 3);
tick(.016);
assert.equal(daily.card.done, 8); assert.equal(fired.book.kinds.has('bingo:card'), false);
// The last square fills the card; its bonus takes the run over the top: Fired, at the play time it happened.
fired.book.total = LADDER.at(-2).at; fired.book.step = LADDER.length - 1;
const lines = fired.book.kinds.get('bingo:line')?.points;
shift.elapsed = 100 * CLOCK_FACTOR; shift.reportScore(squares[8].kind, 0, 0, 5);
assert.equal(daily.card.full, true);
assert.equal(fired.book.kinds.get('bingo:card')?.points, CARD_BONUS, 'the full card pays its large bonus');
assert.equal(fired.book.kinds.get('bingo:line')?.points, 8 * LINE_BONUS, 'eight lines in all'); assert.ok(lines < 8 * LINE_BONUS);
assert.equal(fired.book.fired, true); assert.equal(fired.firedAt, 100); assert.equal(shift.ended, false, 'no end inside the listener');
tick(.016);
assert.equal(offers.length, 2); card = offers[1];
assert.equal(card.title, 'Practice'); assert.match(card.lines[0], /^Practice: Fired in 1:40\. Bingo 9 of 9, 8 lines and the full card\.$/);
assert.match(card.lines[2], /^Today’s card keeps your first finished run: /);
const again = JSON.parse(store.get(DAILY_KEY)).mabou;
assert.equal(again.tries, 2); assert.deepEqual(again.first, record.first, 'the first finished try stands');
assert.equal(daily.text, resultText(record.first, '2026-11-17', 'Mabou'), 'the share line is still the first try');
assert.equal(store.has(BEST_KEY), false);
console.log('daily shift: real Shift, FiredRun and DailyRun; fixed day, card in the HUD, line and card bonus, protected places, five-minute end, share card, Copy, practice keeps the first try.');
