#!/usr/bin/env node
// Small-map place names (the project brief): each name beside its own point or left out, no two names touching,
// never over the car arrow or the N mark, a few names on the small map, the place the car is in first.
// --mutations also runs broken copies of web/src/map-labels.ts; each must be caught.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';

const SOURCE = readFileSync(new URL('../web/src/map-labels.ts', import.meta.url), 'utf8');
const load = async source => import('data:text/javascript;base64,' +
  Buffer.from(transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code).toString('base64'));

// 10 px bold text is close to 5.6 px a letter; the check needs widths, not a font.
const measure = text => text.length * 5.6;
const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
// A synthetic collection of names crowded round the village at 3.2 km on the 176 px map (car at 88,110).
const village = [
  ['Mabou village', 88, 104, 0, 120, true], ['Mabou River bridge', 97, 92, 1, 260], ['Mabou Rivers Trail', 76, 96, 1, 300],
  ['Rail-trail bridge east of the village', 112, 112, 2, 1100], ['Mabou Provincial Park', 128, 62, 1, 2300],
  ['Mabou Harbour Road view', 50, 56, 2, 1500], ['Northeast Mabou river crossing', 64, 48, 1, 2400],
  ['West Mabou rail-trail access', 52, 128, 3, 1800], ['Glendyer rail-trail bridge', 150, 80, 2, 2800],
  ['Cemetery, Highway 19 (north)', 80, 70, 3, 1500], ['Cemetery, Highway 19 (south)', 96, 140, 3, 1200],
  ['Cemetery, Mabou Harbour Road', 40, 60, 3, 2700],
].map(([label, px, py, rank, distance, here]) => ({ label, px, py, rank, distance, here: !!here }));
const keep = (size, nx = size / 2, ny = 11) => [{ x0: size / 2 - 8, y0: size * .625 - 10, x1: size / 2 + 8, y1: size * .625 + 8 },
  { x0: nx - 8, y0: ny - 8, x1: nx + 8, y1: ny + 8 }];

async function suite(m) {
  const fails = [];
  const ok = (name, fn) => { try { fn(); console.log('PASS ' + name); } catch (e) { fails.push(name); console.log('FAIL ' + name + ': ' + e.message); } };
  const layout = (size, extra = {}) => ({ size, cap: m.labelCap(size, 3200), measure, keep: keep(size), ...extra });
  const small = m.placeLabels(village, layout(176));
  const rank = new Map(village.map(c => [c.label, c.rank]));
  ok('small map at 3.2 km shows a few names: two to five when crowded, four when there is room', () => {
    assert.equal(m.labelCap(176, 3200), 4); assert.ok(small.length >= 2 && small.length <= 5, `${small.length} names`);
    const spread = [[30, 30], [140, 30], [30, 150], [140, 150], [88, 40], [40, 90]]
      .map(([px, py], i) => ({ label: 'Place ' + i, px, py, rank: 1, distance: 500 * (i + 1) }));
    assert.equal(m.placeLabels(spread, layout(176)).length, 4);
  });
  ok('circular maps keep every label corner inside the rim', () => {
    const candidates=Array.from({length:25},(_,i)=>({label:'P'+i,px:18+(i%5)*34,py:18+Math.floor(i/5)*34,rank:1,distance:i}));
    const circle={cx:88,cy:88,r:65}, shown=m.placeLabels(candidates,layout(176,{cap:25,keep:[],circle}));
    assert.ok(shown.length>0,'some labels fit');
    for(const b of shown) for(const x of [b.x0,b.x1]) for(const y of [b.y0,b.y1]) assert.ok(Math.hypot(x-circle.cx,y-circle.cy)<=circle.r,'label crosses the ring');
    assert.ok(m.placeLabels(candidates,layout(176,{cap:25,keep:[]})).length>shown.length,'the circle removes edge labels');
  });
  ok('no two names overlap', () => {
    for (const size of [124, 176, 600]) {
      const shown = m.placeLabels(village, layout(size));
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++)
        assert.ok(!overlap(shown[i], shown[j]), `${shown[i].label} / ${shown[j].label} at ${size}`);
    }
  });
  ok('every name stays beside its own point', () => {
    for (const l of small) {
      const dx = Math.max(l.x0 - l.px, 0, l.px - l.x1), dy = Math.max(l.y0 - l.py, 0, l.py - l.y1);
      assert.ok(Math.hypot(dx, dy) <= 16, `${l.label} is ${Math.hypot(dx, dy).toFixed(1)} px from its point`);
    }
  });
  ok('names stay inside the map', () => {
    for (const l of small) assert.ok(l.x0 >= 4 && l.y0 >= 4 && l.x1 <= 172 && l.y1 <= 172, l.label);
  });
  ok('no name covers the car arrow or the N mark', () => {
    for (const size of [124, 176]) for (const [nx, ny] of [[size / 2, 11], [size - 11, size / 2], [20, 30]]) {
      const k = keep(size, nx, ny), shown = m.placeLabels(village, { ...layout(size), keep: k });
      for (const l of shown) for (const b of k) assert.ok(!overlap(l, b), `${l.label} at ${size} covers ${JSON.stringify(b)}`);
    }
  });
  ok('the place the car is in comes first, then the order of rank', () => {
    assert.equal(small[0].label, 'Mabou village');
    const order = m.labelOrder(village);
    assert.equal(order[0].label, 'Mabou village');
    for (let i = 2; i < order.length; i++) assert.ok(order[i - 1].rank <= order[i].rank, 'rank order');
    for (let i = 2; i < small.length; i++) assert.ok(rank.get(small[i - 1].label) <= rank.get(small[i].label), 'a smaller place tried before a bigger one');
    const crowd = m.placeLabels([...village, ...village.slice(1).map((c, i) => ({ ...c, label: c.label + ' ' + i, rank: 3 }))], layout(176));
    assert.ok(crowd.filter(l => !/ \d+$/.test(l.label)).length >= small.length - 1, 'rank-3 copies pushed out bigger places');
  });
  ok('with no place round the car, the nearest comes first', () => {
    const order = m.labelOrder(village.map(c => ({ ...c, here: false })));
    assert.equal(order[0].label, 'Mabou village');
    const far = m.labelOrder([{ label: 'A', px: 0, py: 0, rank: 0, distance: 900 }, { label: 'B', px: 0, py: 0, rank: 3, distance: 100 }]);
    assert.equal(far[0].label, 'B');
  });
  ok('the place the car is in goes first even when another point is nearer; the best-ranked of several', () => {
    const order = m.labelOrder([{ label: 'Near dot', px: 0, py: 0, rank: 1, distance: 50 },
      { label: 'Wide place', px: 0, py: 0, rank: 2, distance: 300, here: true }, { label: 'Village', px: 0, py: 0, rank: 0, distance: 400, here: true }]);
    assert.deepEqual(order.map(c => c.label), ['Village', 'Near dot', 'Wide place']);
    const one = m.labelOrder([{ label: 'Near dot', px: 0, py: 0, rank: 1, distance: 50 }, { label: 'Wide place', px: 0, py: 0, rank: 2, distance: 300, here: true }]);
    assert.equal(one[0].label, 'Wide place');
  });
  ok('no name covers a named point or the dot of a place as important as its own', () => {
    for (const size of [124, 176, 600]) {
      const shown = m.placeLabels(village, layout(size)), named = new Set(shown.map(l => l.label));
      for (const l of shown) for (const c of village) if (c.label !== l.label && (named.has(c.label) || c.rank <= rank.get(l.label)))
        assert.ok(!(c.px > l.x0 && c.px < l.x1 && c.py > l.y0 && c.py < l.y1), `${l.label} covers ${c.label} at ${size}`);
    }
    const pair = (rank2) => m.placeLabels([{ label: 'First', px: 40, py: 60, rank: 1, distance: 1, here: true }, { label: 'Dot', px: 60, py: 60, rank: rank2, distance: 9 }], layout(176, { cap: 1 }));
    assert.notEqual(pair(1)[0].slot, 0, 'First was written east, over an equal dot beside it');
    assert.equal(pair(3)[0].slot, 0, 'a lesser dot pushed the name away');
    const named = m.placeLabels([{ label: 'Here', px: 60, py: 60, rank: 3, distance: 1, here: true }, { label: 'Bigger', px: 75, py: 72, rank: 1, distance: 9 }],
      layout(176, { previous: new Map([['Here', 6], ['Bigger', 4]]) }));
    assert.deepEqual(named.map(l => l.slot === 4), [false, false], 'Bigger was written north-west, over the named point of Here');
  });
  ok('names that do not fit are left out, never moved away or cut', () => {
    const stack = Array.from({ length: 12 }, (_, i) => ({ label: 'Place ' + i, px: 88, py: 40, rank: 1, distance: 1000 + i }));
    const shown = m.placeLabels(stack, layout(176, { cap: 12 }));
    assert.ok(shown.length < 12 && shown.length > 0, `${shown.length} of 12 at one point`);
    const long = m.placeLabels([{ label: 'X'.repeat(40), px: 60, py: 60, rank: 0, distance: 1, here: true }], layout(124));
    assert.equal(long.length, 0, 'a name wider than the map is shown');
  });
  ok('a long name above or below its point slides to stay on the map, still over its point', () => {
    const near = [{ label: 'Cemetery, Main Street (south)', px: 30, py: 60, rank: 3, distance: 400, here: true }];
    const [l] = m.placeLabels(near, layout(176));
    assert.ok(l, 'a long name near the edge is left out');
    assert.ok(l.x0 >= 4 && l.x1 <= 172 && l.x0 <= 30 && l.x1 >= 30, JSON.stringify(l));
  });
  ok('the enlarged map shows more names', () => {
    assert.ok(m.labelCap(600, 3200) > m.labelCap(176, 3200)); assert.ok(m.labelCap(124, 3200) >= 3);
    const big = village.map(c => ({ ...c, px: (c.px - 88) * 600 / 176 + 300, py: (c.py - 110) * 600 / 176 + 375 }));
    assert.ok(m.placeLabels(big, layout(600)).length > small.length);
  });
  ok('a name keeps its spot from the last drawing when it still fits', () => {
    const again = m.placeLabels(village, layout(176, { previous: new Map(small.map(l => [l.label, l.slot])) }));
    assert.deepEqual(again.map(l => [l.label, l.slot]), small.map(l => [l.label, l.slot]));
    const one = [{ label: 'Lone place', px: 88, py: 50, rank: 1, distance: 900 }];
    assert.equal(m.placeLabels(one, layout(176))[0].slot, 0);
    assert.equal(m.placeLabels(one, layout(176, { previous: new Map([['Lone place', 3]]) }))[0].slot, 3);
  });
  return fails;
}

const base = await suite(await load(SOURCE));
if (base.length) { console.log(`FAIL map-labels: ${base.length} cases`); process.exit(1); }
if (process.argv.includes('--mutations')) {
  const MUTANTS = [
    ['circle ignored', 'const circle = layout.circle;', 'const circle = undefined;'],
    ['overlap test ignored', 'taken.some(b => overlaps(box, b, PAD)) || ', ''],
    ['no cap', 'if (placed.length >= cap) break;', ''],
    ['car and N mark not kept clear', 'taken: LabelBox[] = [...keep]', 'taken: LabelBox[] = []'],
    ['the map edge ignored', 'if (box.x0 < EDGE || box.y0 < EDGE || box.x1 > size - EDGE || box.y1 > size - EDGE) continue;', ''],
    ['rank ignored', 'c.rank * 1e7 + ', ''],
    ['the place the car is in not first', 'c === first ? -Infinity : ', ''],
    ['only the first spot tried', 'for (let n = 0; n < SLOTS; n++)', 'for (let n = 0; n < 1; n++)'],
    ['here ignored', 'for (const c of candidates) if (c.here && (', 'for (const c of candidates) if ((c.here || true) && ('],
    ['the nearer of several places first', 'c.rank < first.rank || c.rank === first.rank && c.distance < first.distance', 'c.distance < first.distance'],
    ['other dots ignored', ' || dots.some(d => d.rank <= c.rank && d.label !== c.label && overlaps(box, d, 0))', ''],
    ['every dot blocks', 'd.rank <= c.rank && d.label', 'd.label'],
    ['named points not kept clear', 'taken.push(box, anchor)', 'taken.push(box)'],
    ['no sliding', 'if (slot % 8 >= 6) x0 =', 'if (false) x0 ='],
    ['last spot ignored', 'n === 0 ? last : n <= last ? n - 1 : n', 'n'],
    ['names pushed far from their points', 'const gap = slot < 8 ? GAP : 3 * GAP;', 'const gap = slot < 8 ? GAP : 8 * GAP;'],
    ['old stacking: a crowded name moves away', 'let [x0, y0] = spot(slot, c.px, c.py, w, h);', 'let [x0, y0] = spot(slot, c.px, c.py - 14 * placed.length, w, h);'],
    ['a fixed cap of twelve', 'return Math.max(3, Math.min(12, Math.round(size * size / 8000) + (reach < 1500 ? 1 : 0)));', 'return 12;'],
  ];
  let missed = 0;
  for (const [name, from, to] of MUTANTS) {
    assert.ok(SOURCE.includes(from), 'mutant text not found: ' + name);
    console.log(`-- mutant: ${name}`);
    const fails = await suite(await load(SOURCE.replace(from, to)));
    if (fails.length) console.log(`MUTANT CAUGHT ${name}: ${fails.join(', ')}`); else { missed++; console.log(`MUTANT MISSED ${name}`); }
  }
  if (missed) { console.log(`FAIL map-labels mutations: ${missed} missed`); process.exit(1); }
  console.log(`PASS map-labels mutations: ${MUTANTS.length} caught`);
}
console.log('PASS map-labels');
