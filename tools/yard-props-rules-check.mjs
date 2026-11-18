// Pure rules for breakable yard and field props (web/src/yard-props-rules.ts), on an invented test land: no land data,
// models or browser. Placement (the same every run, every clearance kept, nothing at a protected place), garbage day,
// fields, break grades, contacts, pieces that always come to rest, and a rolling bale. Bundled by rule-mutants.mjs.
import assert from 'node:assert/strict';
import {
  KINDS, SIZE, SECTION, BREAK_SPEED, SLOW,
  PIECE_LIFE, BALE_LIFE, GARBAGE_WEEKDAY, placeYard, garbageDay, recyclingDay, laundryDay, outToday, isField, breaks, scoreKind,
  touches, launch, stepPiece, rollBale, boxDistance, segmentDistance, along, across, BALE_STRIKE, DAMAGE_COMPLAINT,
} from '../web/src/yard-props-rules.ts';

// A test land: a straight paved road along x (z = 0, 3.2 m half width), a farm track across it at x = 1500, houses on
// both sides 34-60 m back with mailboxes at the road edge, barns well back, a church ground, and one hand-built site.
const ROAD_HALF = 3.2, TRACK_HALF = 2;
// The clearances the game promises, in metres, written here and not read from the module under test.
const YARD_SETBACK = 5, SHOULDER = 1.8, DRIVEWAY_CLEAR = 3.5, MAILBOX_CLEAR = 3, BUILDING_CLEAR = 1.5, FIELD_SETBACK = 10, BALE_WALL = 6;
const buildings = [], mailboxes = [];
for (let i = 0; i < 70; i++) {
  const side = i % 2 ? 1 : -1, x = i * 45, back = 34 + (i * 7) % 27;
  buildings.push({ id: 100 + i, x, z: side * back, kind: 'house', axis: Math.PI / 2 + (i % 3 - 1) * .2, length: 11 + i % 4, width: 8 });
  if (i % 5 !== 3) mailboxes.push({ x: x + (i % 4) * 2 - 3, z: side * (ROAD_HALF + .8) });
  if (i % 4 === 0) buildings.push({ id: 400 + i, x: x + 12, z: side * (back + 22), kind: 'shed', axis: 0, length: 5, width: 4 });
  if (i % 3 === 0) buildings.push({ id: 700 + i, x: x + 20, z: side * (back + 110), kind: 'barn', axis: .3, length: 30, width: 14 });
}
const nearRoad = (x, z, reach, track) => {
  const hits = [{ dist: Math.abs(z), x: Math.max(-50, Math.min(3200, x)), z: 0, heading: Math.PI / 2, halfWidth: ROAD_HALF }];
  if (track) hits.push({ dist: Math.abs(x - 1500), x: 1500, z, heading: 0, halfWidth: TRACK_HALF });
  const h = hits.filter(h => h.dist <= reach).sort((a, b) => a.dist - b.dist)[0];
  return h ?? null;
};
const church = { x: 900, z: 60, radius: 70 };
const place = (x, z) => Math.hypot(x - church.x, z - church.z) <= church.radius ? 'church' : x > 2000 && x < 2100 && z > 0 ? 'cemetery' : 'route';
const excluded = [[2400, -200, 2600, 200]];
const roads = { publicRoad: (x, z, r) => nearRoad(x, z, r, false), anyRoad: (x, z, r) => nearRoad(x, z, r, true) };
// Community boxes in some yards, 1.5 m from where an ornament, woodpile or clothesline would otherwise stand: only the
// mailbox clearance keeps those spots empty.
const first = placeYard({ buildings, mailboxes, place, excluded, ...roads });
const yards = first.filter(p => ['whirligig', 'buoys', 'traps', 'well', 'woodpile', 'clothesline'].includes(p.kind)).slice(0, 8);
const community = yards.map(p => ({ x: p.x + 1.5, z: p.z }));
const input = { buildings, mailboxes: [...mailboxes, ...community], place, excluded, ...roads };
const props = placeYard(input);
assert.ok(yards.every(y => !props.some(p => p.kind === y.kind && Math.hypot(p.x - y.x, p.z - y.z) < .01)), 'a box in the yard moves the prop away');

// The same land gives the same yards, for every player, in any order of the building list.
assert.deepEqual(placeYard(input), props, 'deterministic');
assert.deepEqual(placeYard({ ...input, buildings: [...buildings].reverse() }), props, 'independent of the building order');
const count = Object.fromEntries(KINDS.map(k => [k, props.filter(p => p.kind === k).length]));
for (const k of KINDS) assert.ok(count[k] > 0, `test land places at least one ${k}: ${JSON.stringify(count)}`);
assert.ok(props.every((p, i) => p.id === i), 'ids are list positions');

// Every clearance, at every corner of every footprint.
const corners = p => { const [ax, az] = along(p.yaw), [bx, bz] = across(p.yaw), { half, halfWidth } = SIZE[p.kind];
  return [-1, 0, 1].flatMap(s => [-1, 1].map(t => [p.x + ax * half * s + bx * halfWidth * t, p.z + az * half * s + bz * halfWidth * t])); };
const lanes = buildings.filter(b => b.kind === 'house').map(b => {
  const road = input.publicRoad(b.x, b.z, 90);
  let mouth = [road.x, road.z], best = 45 * 45;
  for (const m of mailboxes) { const d = (m.x - road.x) ** 2 + (m.z - road.z) ** 2; if (d < best) { best = d; mouth = [m.x, m.z]; } }
  return [b.x, b.z, ...mouth];
});
for (const p of props) {
  const { half, halfWidth } = SIZE[p.kind], bin = p.kind === 'garbageBin' || p.kind === 'recyclingBin';
  const setback = bin ? SHOULDER : p.kind === 'bale' ? FIELD_SETBACK : YARD_SETBACK;
  for (const [x, z] of corners(p)) {
    assert.equal(place(x, z), 'route', `${p.kind} ${p.id} reaches a protected place`);
    const r = input.anyRoad(x, z, 40);
    assert.ok(!r || r.dist - r.halfWidth >= setback - 1e-9, `${p.kind} ${p.id} is ${r && (r.dist - r.halfWidth).toFixed(2)} m from a road edge`);
  }
  for (const [x0, z0, x1, z1] of excluded) assert.ok(p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1, 'not in a hand-built site');
  for (const m of input.mailboxes) assert.ok(boxDistance(m.x, m.z, p.x, p.z, p.yaw, half, halfWidth) >= MAILBOX_CLEAR, `${p.kind} ${p.id} by a mailbox`);
  const [ux, uz] = along(p.yaw);
  for (const [ax, az, bx, bz] of lanes) for (const s of [-1, -.5, 0, .5, 1])
    assert.ok(segmentDistance(p.x + ux * half * s, p.z + uz * half * s, ax, az, bx, bz) >= DRIVEWAY_CLEAR + halfWidth, `${p.kind} ${p.id} in a driveway`);
  for (const b of buildings) for (const [x, z] of corners(p))
    assert.ok(boxDistance(x, z, b.x, b.z, b.axis, b.length / 2, b.width / 2) >= (p.kind === 'bale' ? BALE_WALL : BUILDING_CLEAR), `${p.kind} ${p.id} against building ${b.id}`);
  if (bin) {
    // At the road, beyond the shoulder: near enough to be at the road.
    const r = input.publicRoad(p.x, p.z, 40);
    assert.ok(r && r.dist - r.halfWidth - halfWidth <= SHOULDER + 1, `${p.kind} ${p.id} at the road`);
    assert.equal(p.daily, true);
  }
  if (p.kind === 'bale') assert.equal(p.field, true, 'a bale waits for open field');
}
for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
  const a = props[i], b = props[j];
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= Math.hypot(SIZE[a.kind].half, SIZE[a.kind].halfWidth) + Math.hypot(SIZE[b.kind].half, SIZE[b.kind].halfWidth) + .4 - 1e-9, `props ${i} and ${j} overlap`);
}
// Fences: runs of sections along the road, each section its own length, the end post on the last.
for (const kind of ['railFence', 'picketFence']) {
  const runs = new Map();
  for (const p of props.filter(p => p.kind === kind)) runs.set(p.owner, [...runs.get(p.owner) ?? [], p]);
  for (const run of runs.values()) {
    assert.ok(run.every(p => Math.abs(Math.sin(p.yaw - Math.PI / 2)) < 1e-9), 'a fence runs along the road');
    assert.ok(run.some(p => p.end), 'a run ends with an end post');
    const xs = run.map(p => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) assert.ok(Math.abs(xs[i] - xs[i - 1] - SECTION[kind]) < 1e-6 || xs[i] - xs[i - 1] > SECTION[kind], 'sections end to end');
  }
}
// Protected places and the hand-built site hold nothing, though houses stand round them.
assert.ok(buildings.some(b => Math.hypot(b.x - church.x, b.z - church.z) < church.radius + 40));
assert.ok(props.every(p => Math.hypot(p.x - church.x, p.z - church.z) > church.radius));

// Garbage day: one seeded weekday a week; recycling every other one; bins out only then; laundry about one in three.
const days = Array.from({ length: 70 }, (_, i) => i + 1);
assert.equal(days.filter(garbageDay).length, 10, 'once a week');
assert.ok(days.filter(garbageDay).every(d => (d - 1) % 7 === GARBAGE_WEEKDAY));
assert.equal(days.filter(recyclingDay).length, 5, 'every other week');
assert.ok(days.filter(recyclingDay).every(garbageDay));
const bin = props.find(p => p.kind === 'garbageBin'), blue = props.find(p => p.kind === 'recyclingBin'), fence = props.find(p => p.kind === 'railFence');
for (const d of days) {
  assert.equal(outToday(bin, d), garbageDay(d)); assert.equal(outToday(blue, d), recyclingDay(d)); assert.equal(outToday(fence, d), true);
}
const lines = days.flatMap(d => [100, 101, 102, 103].map(o => laundryDay(d, o)));
assert.ok(lines.filter(Boolean).length > lines.length * .25 && lines.filter(Boolean).length < lines.length * .45, 'washing out on about a third of days');
assert.deepEqual(days.map(d => laundryDay(d, 7)), days.map(d => laundryDay(d, 7)));

// Open field for a bale.
const open = { canopy: 0, roadDist: 40, halfWidth: 3, brook: 99, slope: .05 };
assert.equal(isField(open), true);
for (const [change, why] of [[{ canopy: 3 }, 'trees'], [{ water: true }, 'water'], [{ mineral: true }, 'mineral ground'],
  [{ brook: 5 }, 'a brook'], [{ roadDist: 3 + FIELD_SETBACK - .1 }, 'the road'], [{ slope: .35 }, 'steep']]) assert.equal(isField({ ...open, ...change }), false, why);

// Break grades: below the threshold a solid touch, at it a break. The car keeps most of its speed.
for (const k of KINDS) {
  assert.ok(BREAK_SPEED[k] > .5 && BREAK_SPEED[k] <= 3, `${k}: a small speed breaks it`);
  assert.equal(breaks(k, BREAK_SPEED[k] - .01), false); assert.equal(breaks(k, BREAK_SPEED[k]), true);
  assert.equal(breaks(k, NaN), false); assert.equal(breaks(k, 30), true);
  assert.ok(SLOW[k] >= .85 && SLOW[k] < 1, `${k}: slows a little`);
  assert.match(scoreKind(k), /^prop:(fence|clothesline|ornament|woodpile|bale|bin)$/);
}
assert.ok(SLOW.bale < SLOW.whirligig && SLOW.well < SLOW.picketFence, 'heavier props slow the car more');
assert.equal(BALE_STRIKE, 'prop:baleStrike'); assert.equal(DAMAGE_COMPLAINT, 'propertyDamage');
assert.deepEqual(new Set(KINDS.map(scoreKind)), new Set(['prop:fence', 'prop:clothesline', 'prop:ornament', 'prop:woodpile', 'prop:bale', 'prop:bin']));

// Contacts: the car's circles against a footprint.
const car = { x: 0, z: 0, heading: 0, radius: 1, circles: [-1.4, 0, 1.4] };
const post = { x: 0, z: -3.4, yaw: Math.PI / 2 };   // a fence section across the car's path, 3.4 m ahead
assert.equal(touches(car, post, 'railFence'), false, '1 m short of it');
assert.equal(touches({ ...car, z: -.9 }, post, 'railFence'), true, 'nose on it');
assert.equal(touches({ ...car, x: 2.6, z: -2 }, post, 'railFence'), false, 'past its end');

// Pieces: whatever the hit, every piece comes to rest on the ground within PIECE_LIFE and stays there.
const piece = () => ({ x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, floor: .05, rolling: false, resting: false, age: 0 });
for (const k of KINDS.filter(k => k !== 'bale')) for (const speed of [BREAK_SPEED[k], 6, 14, 40]) for (let i = 0; i < 4; i++) {
  const p = piece(); launch(p, k, i, 4, speed, 1, -.3, 77);
  assert.ok(Math.hypot(p.vx, p.vz) > 0 && p.vy > 0, `${k}: flies off`);
  assert.ok(p.vx > 0, 'along the hit');
  let t = 0;
  while (!p.resting && t < PIECE_LIFE + 1) { stepPiece(p, 1 / 60, 0); t += 1 / 60; }
  assert.equal(p.resting, true, `${k} at ${speed} m/s rests`); assert.ok(t <= PIECE_LIFE + 1e-6);
  assert.ok(Math.abs(p.y - p.floor) < 1e-9, 'on the ground');
  const at = JSON.stringify(p); stepPiece(p, 1 / 60, 0); assert.equal(JSON.stringify(p), at, 'and stays there');
  assert.ok(Math.hypot(p.x, p.z) < speed * PIECE_LIFE, 'not flung across the map');
}
{ const p = piece(); assert.equal(stepPiece(p, 0, 0), false, 'a paused step moves nothing'); assert.equal(p.y, 1); }
{
  // Knocked over a drop (a bank or the shore far below): still at rest on that ground by PIECE_LIFE, never falling all shift.
  const p = piece(); launch(p, 'woodpile', 0, 1, 10, 1, 0, 3);
  let t = 0; while (!p.resting && t < PIECE_LIFE + 1) { stepPiece(p, 1 / 60, -400); t += 1 / 60; }
  assert.equal(p.resting, true); assert.ok(t <= PIECE_LIFE + 1 / 60 + 1e-6); assert.equal(p.y, -400 + p.floor);
}
// A bale: rolls along the push with no lift, stops on level ground, keeps rolling down a steep one, and comes back
// down when pushed up a slope.
const bale = () => ({ ...piece(), y: .75, floor: .75 });
{
  const p = bale(); launch(p, 'bale', 0, 1, 8, 0, -1, 5);
  assert.equal(p.rolling, true); assert.equal(p.vy, 0); assert.ok(p.vz < 0 && Math.abs(p.vx) < 1e-9);
  let t = 0; while (!p.resting && t < BALE_LIFE + 1) { rollBale(p, 1 / 60, 0, 0, 0); t += 1 / 60; }
  assert.equal(p.resting, true); assert.ok(t < 8, `stops on level ground (${t.toFixed(1)} s)`);
  assert.ok(p.z < -10 && p.z > -40, `rolls a fair way (${(-p.z).toFixed(1)} m)`); assert.equal(p.y, .75);
  assert.ok(Math.abs(p.rz) > 10, 'turns about its axle as it rolls');
}
{
  // Ground rising 0.25 m per metre toward +x: a bale nudged sideways rolls away down toward -x and does not stop.
  const p = bale(); launch(p, 'bale', 0, 1, 2, 0, 1, 5);
  for (let t = 0; t < 6; t += 1 / 60) rollBale(p, 1 / 60, 0, .25, 0);
  assert.equal(p.resting, false, 'still rolling downhill'); assert.ok(p.vx < -3 && p.x < -10, 'downhill');
  for (let t = 0; t < BALE_LIFE; t += 1 / 60) rollBale(p, 1 / 60, 0, .25, 0);
  assert.equal(p.resting, true, 'every bale rests by BALE_LIFE');
}
{
  // Pushed up a 20 % slope it slows, stops and rolls back down; on a 12 % slope rolling drag holds it where it stops.
  const p = bale(); launch(p, 'bale', 0, 1, 8, 1, 0, 5);
  let most = 0; for (let t = 0; t < BALE_LIFE && !p.resting; t += 1 / 60) { rollBale(p, 1 / 60, 0, .2, 0); most = Math.max(most, p.x); }
  assert.ok(most > 3 && p.x < most - 1, `back down the slope (${most.toFixed(1)} -> ${p.x.toFixed(1)})`);
  const q = bale(); launch(q, 'bale', 0, 1, 8, 1, 0, 5);
  for (let t = 0; t < BALE_LIFE && !q.resting; t += 1 / 60) rollBale(q, 1 / 60, 0, .12, 0);
  assert.equal(q.resting, true); assert.ok(q.x > 3, 'held on a gentle slope');
}
console.log(`PASS yard-props rules: ${props.length} props on the test land (${KINDS.map(k => `${k} ${count[k]}`).join(', ')}); ` +
  'deterministic, every road, shoulder, driveway, mailbox and building clearance, nothing at a church, cemetery or hand-built site, ' +
  'fence runs, garbage and recycling days, laundry, open field, break grades, contacts, pieces at rest, a rolling bale');
