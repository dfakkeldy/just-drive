// Yard prop placement rules (web/src/yard-props-rules.ts): seeded and stable, lot-only, clear of roads, drives,
// driveway mouths, buildings and hand-built sites; the shares of houses; the dog is never solid and slips away.
// Pure: a made-up street first, then, when the baked land is here, every Mabou house. Distances are measured here on
// points along each prop's outline, not with the module's own geometry.
// node tools/rule-mutants.mjs yard-props [--base]
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANIMAL } from '../web/src/road-animal-rules.ts';
import { chooseYardProps, dogAway, DOG_BACK, yardPropSolid, yardWants, YARD_PROPS, YARD_PROP_KINDS, YARD_PROP_SIZE } from '../web/src/yard-props-rules.ts';

// ---- Shares, from the seeded hash of the id alone. ----
const N = 30000, tally = { vehicle: 0, other: 0, dog: 0 };
for (let id = 1; id <= N; id++) {
  const { kinds } = yardWants(id * 7919 + 13);
  const v = kinds.filter(k => ['car', 'suv', 'pickup'].includes(k)).length, o = kinds.filter(k => ['trailer', 'motorhome', 'mower'].includes(k)).length, d = kinds.filter(k => k.startsWith('dog')).length;
  assert.ok(v <= 1 && o <= 1 && d <= 1, 'at most one vehicle, one rarer thing and one dog at a house');
  tally.vehicle += v; tally.other += o; tally.dog += d;
  assert.deepEqual(yardWants(id * 7919 + 13).kinds, kinds, 'the same id always wants the same things');
}
const share = k => tally[k] / N;
assert.ok(Math.abs(share('vehicle') - 1 / 3) < 0.015, `about one house in three has a vehicle: ${share('vehicle').toFixed(3)}`);
assert.ok(Math.abs(share('other') - 1 / 15) < 0.008, `about one in fifteen a trailer, motorhome or mower: ${share('other').toFixed(3)}`);
assert.ok(share('dog') < share('other') && share('dog') > 0.02, `dogs are rarer: ${share('dog').toFixed(3)}`);
assert.notDeepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(id => yardWants(id, 1).kinds.join()), [1, 2, 3, 4, 5, 6, 7, 8].map(id => yardWants(id, 2).kinds.join()), 'the seed matters');

// ---- Solid, dog. ----
for (const k of YARD_PROP_KINDS) assert.equal(yardPropSolid(k), !k.startsWith('dog'), `${k}: only a dog is never solid`);
assert.equal(dogAway(false, ANIMAL.shy - 0.05), true, 'a dog slips away from a car right beside it');
assert.equal(dogAway(false, ANIMAL.shy + 0.05), false, 'and lies on while it passes');
assert.equal(dogAway(true, DOG_BACK - 0.1), true, 'it stays away while the car is near');
assert.equal(dogAway(true, DOG_BACK + 0.1), false, 'and is back when it has gone');

// ---- Independent geometry: points along a prop's outline. ----
const outline = p => {
  const ax = Math.sin(p.heading), az = -Math.cos(p.heading), pts = [];
  for (const [a0, b0, a1, b1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) for (let t = 0; t <= 1.0001; t += 0.04) {
    const a = (a0 + (a1 - a0) * t) * p.half, b = (b0 + (b1 - b0) * t) * p.halfWidth;
    pts.push([p.x + ax * a - az * b, p.z + az * a + ax * b]);
  }
  return pts;
};
const inside = (p, x, z) => { const ax = Math.sin(p.heading), az = -Math.cos(p.heading), dx = x - p.x, dz = z - p.z; return Math.abs(dx * ax + dz * az) <= p.half && Math.abs(-dx * az + dz * ax) <= p.halfWidth; };
const seg = (x, z, [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - ax - t * dx, z - az - t * dz); };
const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const toPoly = (x, z, poly) => { if (inPoly(x, z, poly)) return 0; let d = Infinity; for (let i = 0; i < poly.length; i++) d = Math.min(d, seg(x, z, poly[i], poly[(i + 1) % poly.length])); return d; };
const toRoad = (x, z, r) => { let d = Infinity; for (let i = 1; i < r.pts.length; i++) d = Math.min(d, seg(x, z, r.pts[i - 1], r.pts[i])); return d; };
const box = (cx, cz, heading, l, w) => { const ax = Math.sin(heading), az = -Math.cos(heading); return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [cx + ax * a * l / 2 - az * b * w / 2, cz + az * a * l / 2 + ax * b * w / 2]); };

/** Every prop: on its own house's lot, clear of everything it must be clear of. Returns the props checked. */
function audit(input, props, label) {
  const byId = new Map(input.houses.map(h => [h.id, h])), publics = input.roads.filter(r => r.kind >= 1 && r.kind <= 3), drives = input.roads.filter(r => !(r.kind >= 1 && r.kind <= 3));
  // Public road segments in 64 m cells, so a drive's points look only at the roads near them.
  const cells = new Map();
  for (const r of publics) for (let i = 1; i < r.pts.length; i++) {
    const [a, b] = [r.pts[i - 1], r.pts[i]], s = { a, b, halfWidth: r.halfWidth };
    for (let cx = Math.floor((Math.min(a[0], b[0]) - 10) / 64); cx <= Math.floor((Math.max(a[0], b[0]) + 10) / 64); cx++)
      for (let cz = Math.floor((Math.min(a[1], b[1]) - 10) / 64); cz <= Math.floor((Math.max(a[1], b[1]) + 10) / 64); cz++) { const k = `${cx},${cz}`; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(s); }
  }
  const mouths = drives.flatMap(r => r.pts.filter(([x, z]) => (cells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) ?? []).some(s => seg(x, z, s.a, s.b) < s.halfWidth + 6)));
  const segments = input.roads.flatMap(r => r.pts.slice(1).map((b, i) => ({ a: r.pts[i], b, kind: r.kind, halfWidth: r.halfWidth })));
  const near = (p, list, reach) => list.filter(b => b.footprint.some(([x, z]) => Math.hypot(x - p.x, z - p.z) < reach));
  for (const p of props) {
    const h = byId.get(p.house), where = `${label}: ${p.kind} at house ${p.house} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
    assert.ok(h, `${where}: at a house`);
    assert.deepEqual([p.half * 2, p.halfWidth * 2], [...YARD_PROP_SIZE[p.kind]], `${where}: its own size`);
    assert.ok(yardWants(h.id, input.seed).kinds.includes(p.kind), `${where}: chosen from the house id alone`);
    assert.ok(!input.excluded.some(e => h.x >= e[0] && h.x <= e[2] && h.z >= e[1] && h.z <= e[3]), `${where}: not at a hand-built site`);
    const segs = segments.filter(r => Math.min(r.a[0], r.b[0]) < p.x + 60 && Math.max(r.a[0], r.b[0]) > p.x - 60 && Math.min(r.a[1], r.b[1]) < p.z + 60 && Math.max(r.a[1], r.b[1]) > p.z - 60);
    const pts = [...outline(p), [p.x, p.z]], others = near(p, input.buildings.filter(b => b.id !== h.id), 80), wings = near(p, input.buildings.filter(b => b.id === h.id), 80);
    for (const [x, z] of pts) {
      for (const r of segs) {
        const d = seg(x, z, r.a, r.b), clear = r.halfWidth + (r.kind >= 1 && r.kind <= 3 ? YARD_PROPS.public : YARD_PROPS.drive) - 0.01;
        assert.ok(d >= clear, `${where}: ${d.toFixed(2)} m from a kind ${r.kind} road's centre (needs ${clear.toFixed(2)})`);
      }
      for (const [mx, mz] of mouths) assert.ok(Math.hypot(x - mx, z - mz) >= YARD_PROPS.mouth - 0.01, `${where}: ${Math.hypot(x - mx, z - mz).toFixed(2)} m from a driveway mouth`);
      for (const b of [{ footprint: h.footprint }, ...wings, ...others]) assert.ok(toPoly(x, z, b.footprint) >= YARD_PROPS.wall - 0.01, `${where}: ${toPoly(x, z, b.footprint).toFixed(2)} m from a building`);
      for (const e of input.excluded) assert.ok(!(x >= e[0] && x <= e[2] && z >= e[1] && z <= e[3]), `${where}: inside a hand-built site`);
    }
    // The lot: corners and centre nearer this house than any other building, and within reach of its walls.
    for (const [x, z] of [...box(p.x, p.z, p.heading, p.half * 2, p.halfWidth * 2), [p.x, p.z]]) {
      const mine = toPoly(x, z, h.footprint);
      assert.ok(mine <= YARD_PROPS.reach + 0.01, `${where}: ${mine.toFixed(1)} m from its house`);
      for (const b of others) assert.ok(toPoly(x, z, b.footprint) > mine, `${where}: nearer a neighbour's building than its own house (off its lot)`);
    }
    // Mouths are points: none inside a prop either.
    for (const [mx, mz] of mouths) assert.ok(!inside(p, mx, mz), `${where}: on a driveway mouth`);
  }
  for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
    const a = props[i], b = props[j];
    if (Math.hypot(a.x - b.x, a.z - b.z) > 12) continue;
    const ob = outline(b);
    for (const [x, z] of outline(a)) assert.ok(!inside(b, x, z) && Math.min(...ob.map(([u, v]) => Math.hypot(u - x, v - z))) >= YARD_PROPS.apart - 0.05, `${label}: two props within ${YARD_PROPS.apart} m`);
  }
  const perHouse = new Map();
  for (const p of props) { const k = p.kind.startsWith('dog') ? 'dog' : ['car', 'suv', 'pickup'].includes(p.kind) ? 'vehicle' : 'other'; const key = `${p.house}:${k}`; assert.ok(!perHouse.has(key), `${label}: two of a sort at house ${p.house}`); perHouse.set(key, 1); }
  return props.length;
}

// ---- A made-up street: houses 16 m apart on both sides of a paved road, set back 16 to 30 m, every third with a drive
// from the road's edge beside it, a shed behind every fourth, and three houses inside a hand-built site. ----
const houses = [], buildings = [], roads = [{ kind: 2, halfWidth: 3.5, pts: [[-700, 0], [0, 0.4], [700, 0]] }];
let id = 4100;
for (let i = 0; i < 80; i++) for (const side of [-1, 1]) {
  const x = -640 + i * 16, z = side * [16, 22, 30][i % 3], axis = Math.PI / 2 + (i % 5 - 2) * 0.03, l = 10, w = 8;
  const fp = box(x, z, axis, l, w), house = { id: id += 37, x, z, axis, length: l, width: w, footprint: fp };
  houses.push(house); buildings.push({ id: house.id, footprint: fp });
  if (i % 3 === 0) roads.push({ kind: 4, halfWidth: 1.5, pts: [[x + 7.2, side * 3.5], [x + 7.2, side * 34]] });
  if (i % 4 === 1) buildings.push({ id: id + 1, footprint: box(x - 2, z + side * 9, axis, 4, 3) });
}
const street = { houses, buildings, roads, excluded: [[-640 + 10 * 16 - 4, -40, -640 + 12 * 16 + 4, 40]], seed: YARD_PROPS.seed };
const placed = chooseYardProps(street);
assert.deepEqual(chooseYardProps(street), placed, 'the same street gives the same props');
assert.deepEqual(chooseYardProps({ ...street, houses: [...houses].reverse(), buildings: [...buildings].reverse() }), placed, 'the order of the lists does not matter');
assert.notDeepEqual(chooseYardProps({ ...street, seed: YARD_PROPS.seed + 1 }), placed, 'another seed, another street');
assert.ok(audit(street, placed, 'street') >= 40, `the street has props: ${placed.length}`);
assert.ok(placed.some(p => ['car', 'suv', 'pickup'].includes(p.kind)) && placed.some(p => p.kind.startsWith('dog')), 'vehicles and a dog on the street');
// Beside a drive where the house has one: a vehicle parallel to it.
const besideDrive = placed.filter(p => ['car', 'suv', 'pickup'].includes(p.kind) && roads.some(r => r.kind === 4 && Math.abs(r.pts[0][0] - p.x) < 5));
assert.ok(besideDrive.length >= 3, `vehicles beside their drives: ${besideDrive.length}`);
console.log(`PASS yard-props rules: shares vehicle ${share('vehicle').toFixed(3)}, other ${share('other').toFixed(3)}, dog ${share('dog').toFixed(3)}; street ${placed.length} props, ${besideDrive.length} beside drives`);

// ---- Every Mabou house, when the baked land is here. ----
const land = ['data/baked/terrain', '../data/baked/terrain'].map(p => resolve(process.cwd(), p)).find(p => existsSync(`${p}/manifest.json`));
if (land) {
  const m = JSON.parse(readFileSync(`${land}/manifest.json`, 'utf8')), [VE, VN] = m.village, w = ([e, n]) => [e - VE, VN - n];
  const list = JSON.parse(readFileSync(`${land}/${m.buildings.file}`, 'utf8')).buildings, roadList = JSON.parse(readFileSync(`${land}/${m.roads.file}`, 'utf8')).roads;
  const sites = list.filter(b => b.buildingId === undefined || b.buildingId === b.id).map(b => b.site ?? b);
  const input = {
    houses: sites.filter(b => b.kind === 'house').map(b => ({ id: b.buildingId ?? b.id, x: b.x - VE, z: VN - b.y, axis: b.axisDeg * Math.PI / 180, length: b.length, width: b.width, footprint: b.footprint.map(w) })),
    buildings: list.map(b => ({ id: b.buildingId ?? b.id, footprint: b.footprint.map(w) })),
    roads: roadList.map(r => ({ kind: r.kind, halfWidth: r.halfWidth, pts: r.pts.map(w) })), excluded: [], seed: YARD_PROPS.seed,
  };
  const props = chooseYardProps(input), n = input.houses.length;
  const count = f => new Set(props.filter(f).map(p => p.house)).size;
  const vehicles = count(p => ['car', 'suv', 'pickup'].includes(p.kind)), others = count(p => ['trailer', 'motorhome', 'mower'].includes(p.kind)), dogs = count(p => p.kind.startsWith('dog'));
  audit(input, props, 'Mabou');
  assert.ok(vehicles / n > 0.25 && vehicles / n < 0.4, `Mabou: about one house in three with a vehicle (${vehicles} of ${n})`);
  assert.ok(others / n > 0.04 && others / n < 0.09, `Mabou: about one in fifteen with a trailer, motorhome or mower (${others} of ${n})`);
  assert.ok(dogs < others && dogs > 0, `Mabou: dogs rarer (${dogs})`);
  console.log(`PASS yard-props Mabou: ${n} houses, ${vehicles} with a vehicle, ${others} with a trailer, motorhome or mower, ${dogs} with a dog; every prop audited`);
} else console.log('SKIP yard-props Mabou land: data/baked/terrain is not here');
