// The white dog at the house on D.R.'s Lane (web/src/drlane-dog-rules.ts): every spot and every straight walk between two
// neighbouring spots lies on the drive or the lawn and keeps clear of the house, the deck, the shed, the garden bed, the
// woodpile and the tree trunks; it walks the whole line and back; it slips away from a car right beside it, stays away
// until the car is DOG_BACK metres off, and comes back on the spot farthest from the car. Pure: no baked land needed.
// node tools/run-node-check.mjs tools/drlane-dog-check.mjs
import assert from 'node:assert/strict';
import { DOG_SPOTS, DOG_WALK, DrLaneDogRules } from '../web/src/drlane-dog-rules.ts';
import { DECK, MAIN, PINES, SHED, TALL, WOODPILE } from '../web/src/drlane-house.ts';
import { BED, DrLaneSite } from '../web/src/drlane-site.ts';
import { depth } from '../web/src/home-site.ts';
import { ANIMAL } from '../web/src/road-animal-rules.ts';
import { DOG_BACK } from '../web/src/lot-props-rules.ts';

const DOG = 0.5;   // half the dog's length, and a little room
// The site's own surfaces, on a stand-in record of the same size and axis at the map's origin.
const site = new DrLaneSite({ id: 273, x: 0, y: 0, ground: 0, axisDeg: 145, length: 24.05, width: 11.83, kind: 'house', footprint: [], eave: 0, ridge: 0, roof: 'gable' }, [0, 0]);
const boxes = [
  ['house', MAIN.u0, MAIN.u1, -MAIN.half, MAIN.half], ['taller part', TALL.u0, TALL.u1, TALL.v0, TALL.v1],
  ['deck', DECK.u0, DECK.u1, DECK.v0, DECK.v1], ['shed', SHED.u0, SHED.u1, SHED.v0, SHED.v1],
  ['woodpile', WOODPILE[0] - WOODPILE[2] / 2, WOODPILE[0] + WOODPILE[2] / 2, WOODPILE[1] - WOODPILE[3] / 2, WOODPILE[1] + WOODPILE[3] / 2],
];
const boxGap = (u, v, [, u0, u1, v0, v1]) => Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1));
function clear(u, v, where) {
  for (const b of boxes) assert.ok(boxGap(u, v, b) >= DOG, `${where}: ${boxGap(u, v, b).toFixed(2)} m from the ${b[0]}`);
  for (const [tu, tv] of PINES) assert.ok(Math.hypot(u - tu, v - tv) >= DOG + 0.4, `${where}: in a pine's trunk`);
  assert.ok(depth(BED, u, v) < -0.3, `${where}: in the garden bed`);
  const w = site.world(u, v), s = site.surface(w.x, w.z);
  assert.ok(s && (s.kind === 8 || s.kind === 12) && s.dist <= s.half, `${where}: not on the drive or the lawn`);
}
DOG_SPOTS.forEach(([u, v], i) => clear(u, v, `spot ${i}`));
for (let i = 1; i < DOG_SPOTS.length; i++) {
  const [au, av] = DOG_SPOTS[i - 1], [bu, bv] = DOG_SPOTS[i], n = Math.ceil(Math.hypot(bu - au, bv - av) / 0.1);
  for (let k = 0; k <= n; k++) clear(au + ((bu - au) * k) / n, av + ((bv - av) * k) / n, `walk ${i - 1}-${i}`);
}
console.log(`PASS ${DOG_SPOTS.length} spots and their walks keep clear and stay on the drive and the lawn`);

// With no car about it walks the whole line and back, never faster than a walk, always on a walk between neighbours.
{
  const seed = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const dog = new DrLaneDogRules(seed(5)), seen = new Set(), dt = 0.05;
  let u = dog.u, v = dog.v, turns = 0, last = 1;
  for (let t = 0; t < 600; t += dt) {
    dog.update(dt, null, 3.4);
    const step = Math.hypot(dog.u - u, dog.v - v);
    assert.ok(step <= DOG_WALK * dt + 1e-9, 'no faster than a walk');
    u = dog.u; v = dog.v;
    const at = DOG_SPOTS.findIndex(([su, sv]) => su === u && sv === v);
    if (at >= 0) { seen.add(at); if (at === 0 || at === DOG_SPOTS.length - 1) { if (at !== last) turns++; last = at; } }
    const onWalk = DOG_SPOTS.some(([au, av], i) => {
      if (i === 0) return false;
      const [bu, bv] = DOG_SPOTS[i - 1], du = bu - au, dv = bv - av, k = Math.max(0, Math.min(1, ((u - au) * du + (v - av) * dv) / (du * du + dv * dv)));
      return Math.hypot(u - au - du * k, v - av - dv * k) < 1e-6;
    });
    assert.ok(onWalk, `on a walk between neighbouring spots at ${t.toFixed(2)} s`);
  }
  assert.equal(seen.size, DOG_SPOTS.length, 'it visits every spot');
  assert.ok(turns >= 2, 'it turns at both ends of the line');
  const again = new DrLaneDogRules(seed(5));
  for (let t = 0; t < 600; t += dt) again.update(dt, null, 3.4);
  assert.deepEqual([again.u, again.v], [dog.u, dog.v], 'the same seed walks the same way');
  console.log('PASS it walks the whole line and back at a walk, the same way every time');
}

// A car right beside it: away, and back only past DOG_BACK, on the spot farthest from the car, at rest.
{
  const dog = new DrLaneDogRules(() => 0.5), reach = 3.4, [u0, v0] = DOG_SPOTS[0];
  const car = (gap) => ({ u: u0, v: v0 + reach + gap });
  dog.update(0.1, car(ANIMAL.shy + 0.05), reach);
  assert.equal(dog.away, false, 'it stays while the car passes');
  dog.update(0.1, car(ANIMAL.shy - 0.05), reach);
  assert.equal(dog.away, true, 'it slips away from a car right beside it');
  const where = [dog.u, dog.v];
  for (let i = 0; i < 100; i++) dog.update(0.1, car(DOG_BACK - 0.5), reach);
  assert.equal(dog.away, true, 'it stays away while the car is near');
  assert.deepEqual([dog.u, dog.v], where, 'it does not move while it is away');
  dog.update(0.1, car(DOG_BACK + 0.5), reach);
  assert.equal(dog.away, false, 'it is back when the car is off');
  const c = car(DOG_BACK + 0.5), far = Math.max(...DOG_SPOTS.map(([u, v]) => Math.hypot(u - c.u, v - c.v)));
  assert.equal(Math.hypot(dog.u - c.u, dog.v - c.v), far, 'it is back on the spot farthest from the car');
  assert.equal(dog.moving, false, 'and at rest there');
  console.log('PASS it slips away from a car right beside it and comes back far from it');
}
