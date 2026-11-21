#!/usr/bin/env node
// The player's start link (?start=<road>) without a browser: web/src/start-key.ts on made-up roads and on the baked
// roads of every area, the link policy (a player key: the title card stays) and the wiring in web/src/main.ts, which
// is also run: the placement block itself, with the start link beside a shared place, a trip and a test key.
//   node tools/start-key-check.mjs               the checks
//   node tools/start-key-check.mjs --mutations   the checks, then broken copies of the sources that must each fail
// The check holds no map position and no number from the baked land: it asserts relations only.
// The address ?start=beaton-road is a shared link that must keep working: near the end of that road, pointed at the end.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { build, transform } from '../web/node_modules/esbuild/lib/main.js';

const FILES = { key: 'web/src/start-key.ts', visit: 'web/src/visit.ts', main: 'web/src/main.ts' };
const original = Object.fromEntries(Object.entries(FILES).map(([name, file]) => [name, readFileSync(file, 'utf8')]));
const load = async (source) => {
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};

// The game's own parts that the placement block calls, and the area list. They import other files, so they need a bundle.
const game = await (async () => {
  const contents = "export { readDrivePosition } from './light-study'; export { placeUrlPose } from './placement-pose'; export { AREAS } from './area';";
  const { outputFiles } = await build({ stdin: { contents, resolveDir: process.cwd() + '/web/src', loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
})();
// The placement block of main.ts as a function, as tools/light-study-check.mjs runs it: the real lines, with every
// name that they read handed in.
const PLACEMENT = ['params', 'mailMode', 'vehicle', 'manifest', 'roads', 'journey', 'placeFirstStop', 'readDrivePosition', 'placeUrlPose', 'startKey', 'placeAtStart'];
async function placement(main) {
  const begin = main.indexOf('const placeVisit ='), end = main.indexOf('scene.add(shift.group);');
  assert.ok(begin > 0 && end > begin, 'the placement block is found');
  const { code } = await transform(main.slice(begin, end), { loader: 'ts', define: { 'import.meta.env.DEV': 'false' } });
  return new Function(...PLACEMENT, 'const fleet = null, airportDrag = null;\n' + code);
}

const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));   // the angle between two headings
const lengthOf = (pts) => pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
const toSegment = (p, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
  return { off: Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz), t };
};
/** Where a point lies on a line: how far off it, how far along it, and the heading of the line there. */
function onLine(p, pts) {
  let best = null, walked = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!step) continue;
    const { off, t } = toSegment(p, a, b);
    if (!best || off < best.off - 1e-9) best = { off, along: walked + t * step, heading: Math.atan2(b[0] - a[0], -(b[1] - a[1])) };
    walked += step;
  }
  return best;
}
const reaches = (end, piece, roads, within) => roads.some((r) => r !== piece && r.kind >= 1 && r.kind <= 3
  && r.pts.slice(1).some((b, i) => toSegment(end, r.pts[i], b).off <= within));

// ---- made-up roads (metres from a village at 0, 0; x east, z south) ----
const road = (name, kind, pts, more = {}) => ({ name, kind, bridge: false, pts, ...more });
const row = (x0, x1, z, n) => Array.from({ length: n }, (_, i) => [x0 + (x1 - x0) * i / (n - 1), z]);
const WORLD = [
  // A gravel road that leaves a paved road (0.5 m from its line, far from its points) and ends in the hills.
  road('Main Road', 2, [[-500, 0], [500, 0]]),
  road('Old Mill Road', 3, [[100, -0.5], [100, -400], [100, -1000]]),
  // A lane whose dead end is NEARER the village than its junction. A track without a name leaves the dead end.
  road('Back Road', 2, [[2000, -500], [2000, 500]]),
  road('Shore Lane', 3, [[2000.5, 0], [1500, 0], [1000, 0]]),
  road(null, 4, [[1000, 0], [1000, 300]]),
  // A road between two highways, and a road that touches nothing.
  road('North Road', 1, [[-800, -200], [800, -200]]),
  road('Far Road', 1, [[-800, -900], [800, -900]]),
  road('Cross Road', 2, [[-300, -200], [-300, -900]]),
  road('Lone Road', 3, [[3000, 3000], [3000, 3400]]),
  road('Short Lane', 3, [[-50, 2000], [50, 2000]]),
  // One name on five lines: the long gravel piece is the road; the rest never are.
  road('Split Road', 3, [[-1000, 1000], [-1000, 1900]]),
  road('Split Road', 3, row(-2000, -1800, 1000, 41)),
  road('Split Road', 2, [[-4000, 1000], [-4000, 4000]], { bridge: true }),
  road('Split Road', 4, [[-5000, 1000], [-5000, 6000]]),
  road('Split Road', 5, [[-6000, 1000], [-6000, 7000]]),
  road('Track Only Road', 4, [[4000, 4000], [4000, 5000]]),
  road('No Length Road', 3, [[5000, 5000], [5000, 5000]]),
  road('One Point Road', 3, [[5100, 5000]]),
  road("O'Brien’s Lane", 3, [[6000, 0], [6400, 0]]),
  road('Chemin de l’Église', 3, [[7000, 0], [7400, 0]]),
];
const reversed = (list) => list.map((r) => ({ ...r, pts: [...r.pts].reverse() }));
const doubled = (list) => list.map((r) => ({ ...r, pts: r.pts.flatMap((p) => [p, p]) }));

// ---- the baked roads of every area in the game's area list, converted as web/src/roads.ts converts them ----
function areas() {
  const folders = game.AREAS.map((area) => [area.id, `data/baked/${area.base}`]);
  const edge = Number(original.main.match(/const EDGE = (\d+);/)[1]);
  return folders.filter(([, folder]) => existsSync(`${folder}/manifest.json`) && existsSync(`${folder}/roads.json`)).map(([id, folder]) => {
    const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, 'utf8')), [ve, vn] = manifest.village;
    const roads = JSON.parse(readFileSync(`${folder}/roads.json`, 'utf8')).roads.map((r) => ({ ...r, pts: r.pts.map(([e, n]) => [e - ve, vn - n]) }));
    const bounds = manifest.mid ? [manifest.mid[0] - ve + edge, vn - manifest.mid[3] + edge, manifest.mid[2] - ve - edge, vn - manifest.mid[1] - edge] : null;
    return { id, roads, bounds };
  });
}
const AREAS = areas();

function verify({ key, visit, main, place }) {
  const { startKey, roadSlug, START_BACK, START_JOIN, START_EDGE, START_LONGEST } = key;
  const at = (value, roads = WORLD, bounds) => startKey(value, roads, bounds);
  const same = (pose, x, z, heading, distance, what) => {
    assert.ok(pose, `${what}: a place`);
    assert.ok(Math.hypot(pose.x - x, pose.z - z) < 1e-6, `${what}: at ${x}, ${z} (got ${pose.x}, ${pose.z})`);
    assert.ok(turn(pose.heading, heading) < 1e-9, `${what}: heading ${heading} (got ${pose.heading})`);
    assert.ok(Math.abs(pose.distance - distance) < 1e-6, `${what}: ${distance} m before the end (got ${pose.distance})`);
  };
  assert.ok(START_BACK >= 100 && START_BACK <= 200, 'the car starts 100 to 200 m before the end: near enough to see what stands there');
  assert.ok(START_JOIN >= 5 && START_JOIN <= 30 && START_EDGE >= 10, 'the join distance and the room at the edge are sensible');

  // 1. The end of the road, whichever way the line was surveyed.
  for (const [how, list] of [['as surveyed', WORLD], ['surveyed the other way', reversed(WORLD)], ['with doubled points', doubled(WORLD)]]) {
    same(at('old-mill-road', list), 100, -1000 + START_BACK, 0, START_BACK, `a dead-end road, ${how}`);
    same(at('shore-lane', list), 1000 + START_BACK, 0, -Math.PI / 2, START_BACK, `a dead end nearer the village than its junction, ${how}`);
    same(at('cross-road', list), -300, -900 + START_BACK, 0, START_BACK, `a through road ends at its far end, ${how}`);
    same(at('lone-road', list), 3000, 3400 - START_BACK, Math.PI, START_BACK, `a road alone ends at its far end, ${how}`);
    same(at('split-road', list), -1000, 1900 - START_BACK, Math.PI, START_BACK, `the longest public piece is the road, ${how}`);
  }
  same(at('short-lane'), 0, 2000, Math.PI / 2, 50, 'a short road: half way');

  // 2. A share of the way, from the near end to the end of the road.
  const total = 999.5;
  for (const list of [WORLD, reversed(WORLD)]) {
    same(at('old-mill-road:0', list), 100, -0.5, 0, total, 'share 0 is the near end');
    same(at('old-mill-road:1', list), 100, -1000, 0, 0, 'share 1 is the end of the road');
    same(at('old-mill-road:0.5', list), 100, -0.5 - total / 2, 0, total / 2, 'share 0.5 is half way');
    same(at('old-mill-road:.25', list), 100, -0.5 - total / 4, 0, total * 0.75, 'share .25');
    same(at('shore-lane:0.5', list), 1500.25, 0, -Math.PI / 2, 500.25, 'a share on the lane');
  }

  // 3. The name, as a person types it by hand.
  const plain = at('old-mill-road');
  for (const typed of ['Old Mill Road', 'old mill road', 'OLD_MILL_ROAD', '  old-mill-road  ', 'old--mill--road', 'Old-Mill-Road', 'old-mill-road:']) {
    assert.deepEqual(at(typed), plain, `"${typed}" is the same road`);
  }
  for (const query of ['start=old-mill-road', 'start=old+mill+road', 'start=Old%20Mill%20Road', 'start=OLD_MILL_ROAD&utm_source=x']) {
    assert.deepEqual(at(new URLSearchParams(query).get('start')), plain, `?${query} is the same road`);
  }
  assert.deepEqual(at(new URLSearchParams('start=old-mill-road:0.5').get('start')), at('old-mill-road:0.5'), 'a share passes through the address bar');
  for (const [name, slug] of [["O'Brien’s Lane", 'obriens-lane'], ['Chemin de l’Église', 'chemin-de-leglise'], ['Highway 19', 'highway-19'], ['  Mabou  Harbour Road ', 'mabou-harbour-road']]) {
    assert.equal(roadSlug(name), slug, `"${name}" is typed as ${slug}`);
  }
  assert.ok(at('obriens-lane') && at('chemin-de-leglise'), 'apostrophes and accents fall away');

  // 4. No place: the caller keeps the normal start. Nothing throws.
  const none = ['no-such-road', '', '   ', null, undefined, ':0.5', ':', '::', 'old-mill-road:2', 'old-mill-road:1.01', 'old-mill-road:-0.5',
    'old-mill-road:abc', 'old-mill-road:0.5:0.5', 'old-mill-road:1e-1', 'old-mill-road:NaN', 'old-mill-road:1.', 'old-mill-road:0.5.5', 'old-mill-road:-0', 'old-mill-road: 0.5',
    'track-only-road', 'no-length-road', 'one-point-road',
    'constructor', '__proto__', 'toString', '%', '\u0000', 'x'.repeat(10000)];
  for (const value of none) assert.equal(at(value), null, `${JSON.stringify(String(value).slice(0, 30))} gives no place`);
  assert.equal(at('old-mill-road', []), null, 'no roads, no place');
  // Anyone can write the value in the address bar. A long one is refused before any reading, so it takes no time.
  const slow = 'old-mill-road:' + '1'.repeat(49985) + 'x';   // 50 000 characters: a colon, then digits that end in no share
  let took = Infinity;
  for (let tries = 0; tries < 5 && took >= 10; tries++) {
    const t0 = performance.now(), got = at(slow);
    took = Math.min(took, performance.now() - t0);
    assert.equal(got, null, 'a 50 000-character value gives no place');
    if (took > 1000) break;   // far over the limit: one try is enough
  }
  assert.ok(took < 10, `a 50 000-character value is refused in under 10 ms (it took ${took.toFixed(1)} ms)`);
  for (const long of ['1'.repeat(50000), ':'.repeat(50000), '-'.repeat(50000), 'a:'.repeat(25000), 'old-mill-road:' + '1'.repeat(50000)]) {
    assert.equal(at(long), null, `a long value (${long.slice(0, 16)}...) gives no place`);
  }
  const padded = (length) => 'old-mill-road' + ' '.repeat(length - 13);
  assert.ok(START_LONGEST >= 60 && START_LONGEST <= 200, 'the longest value that is read: room for any road name, and no more than 200 characters');
  assert.deepEqual(at(padded(START_LONGEST)), plain, `a value of ${START_LONGEST} characters is read`);
  assert.equal(at(padded(START_LONGEST + 1)), null, 'a value over the limit is not read, even when its road is known');

  // 5. The land's bounds: the place must be inside them, with room to spare.
  const z = plain.z;
  assert.deepEqual(at('old-mill-road', WORLD, [-9000, -9000, 9000, 9000]), plain, 'inside the bounds');
  assert.deepEqual(at('old-mill-road', WORLD, null), plain, 'no bounds');
  assert.equal(at('old-mill-road', WORLD, [-9000, z + 10, 9000, 9000]), null, 'outside the bounds');
  assert.equal(at('old-mill-road', WORLD, [-9000, z - START_EDGE + 1, 9000, 9000]), null, 'too near the edge');
  assert.ok(at('old-mill-road', WORLD, [-9000, z - START_EDGE - 1, 9000, 9000]), 'just far enough from the edge');
  assert.equal(at('old-mill-road', WORLD, [-9000, -9000, 100 + START_EDGE - 1, 9000]), null, 'too near the east edge');

  // 6. The baked roads: every named public road gives a place on its own longest piece, pointed along it.
  let places = 0, outside = 0;
  for (const { id, roads, bounds } of AREAS) {
    const named = new Map();
    for (const r of roads) if (r.name && r.kind >= 1 && r.kind <= 3 && !r.bridge && lengthOf(r.pts) > 0) {
      const slug = roadSlug(r.name);
      if (!named.has(slug) || lengthOf(r.pts) > lengthOf(named.get(slug).pts)) named.set(slug, r);
    }
    for (const [slug, piece] of named) {
      const pose = startKey(slug, roads), length = lengthOf(piece.pts), spot = onLine([pose.x, pose.z], piece.pts);
      assert.ok(pose && [pose.x, pose.z, pose.heading, pose.distance].every(Number.isFinite), `${id} ${slug}: a place`);
      assert.ok(spot.off < 1e-6, `${id} ${slug}: on its longest piece`);
      assert.ok(Math.abs(pose.distance - Math.min(START_BACK, length / 2)) < 1e-6, `${id} ${slug}: ${START_BACK} m before the end, or half way`);
      const toLast = Math.abs(length - spot.along - pose.distance) < 1e-3, toFirst = Math.abs(spot.along - pose.distance) < 1e-3;
      assert.ok(toLast || toFirst, `${id} ${slug}: the distance is measured along the road to one of its ends`);
      if (toLast !== toFirst) assert.ok(turn(pose.heading, spot.heading + (toLast ? 0 : Math.PI)) < 1e-6, `${id} ${slug}: pointed at that end`);
      assert.deepEqual(startKey(piece.name, roads), pose, `${id}: "${piece.name}" as written on the map`);
      assert.ok(piece.name.length * 2 <= START_LONGEST, `${id} ${slug}: the name is far under the longest value that is read`);
      const kept = startKey(slug, roads, bounds);
      assert.ok(kept === null || kept.x === pose.x, `${id} ${slug}: the bounds only refuse`);
      places++; if (bounds && !kept) outside++;
    }
    assert.equal(startKey('no-such-road-here', roads, bounds), null, `${id}: an unknown road`);
  }
  assert.ok(places > 20, 'the baked roads were read');

  // 7. A shared link that must keep working: Mabou's Beaton Road is a dead-end road, and the place is before its dead end.
  const mabou = AREAS.find((a) => a.id === 'mabou');
  const beaton = mabou.roads.filter((r) => r.name === 'Beaton Road' && r.kind <= 3 && !r.bridge).sort((a, b) => lengthOf(b.pts) - lengthOf(a.pts))[0];
  const pose = startKey('beaton-road', mabou.roads, mabou.bounds), last = beaton.pts.at(-1);
  const firstMeets = reaches(beaton.pts[0], beaton, mabou.roads, START_JOIN), lastMeets = reaches(last, beaton, mabou.roads, START_JOIN);
  assert.ok(firstMeets !== lastMeets, 'Beaton Road joins a public road at one end only');
  const deadEnd = firstMeets ? last : beaton.pts[0], spot = onLine([pose.x, pose.z], beaton.pts), length = lengthOf(beaton.pts);
  assert.ok(length > 2 * START_BACK, 'Beaton Road is long enough for the full distance');
  assert.ok(Math.abs((firstMeets ? length - spot.along : spot.along) - START_BACK) < 1e-3, `?start=beaton-road is ${START_BACK} m before the dead end, inside the land`);
  assert.ok(Math.hypot(pose.x - deadEnd[0], pose.z - deadEnd[1]) <= START_BACK + 1e-6, 'and no farther than that from it in a straight line');
  assert.ok(turn(pose.heading, spot.heading + (firstMeets ? 0 : Math.PI)) < 1e-6, 'pointed at the dead end');
  const part = startKey('beaton-road:0.88', mabou.roads, mabou.bounds);
  assert.ok(part && Math.abs(part.distance - 0.12 * length) < 1e-6, 'a share of Beaton Road is measured toward the dead end');

  // 8. The policy: a player's key. The title card stays.
  for (const query of ['start=beaton-road', 'start=', 'start=no-such-road', 'start=beaton-road:0.88&utm_source=x']) {
    assert.equal(visit.isTestVisit(new URLSearchParams(query)), false, `?${query} shows the title card`);
  }
  assert.equal(visit.isTestVisit(new URLSearchParams('start=beaton-road&road=x')), true, 'a test key beside it still skips the card');

  // 9. The keys together, by running the placement block of main.ts itself. The order is: a test key, the shared
  //    place of the light study (driveAt), a trip, the start link, the normal start.
  const village = [600000, 5100000], land = [-9000, -9000, 9000, 9000], shared = `driveAt=${village[0] + 500},${village[1] - 700},90`;
  const begins = (query, { trip = false, accepts = true, starts = true } = {}) => {
    const did = [], vehicle = { bounds: land, place: (x, z) => { did.push(`place ${Math.round(x)} ${Math.round(z)}`); return accepts; } };
    place(new URLSearchParams(query), false, vehicle, { village }, { roads: WORLD }, trip ? { place: () => did.push('trip') } : null, () => did.push('normal'),
      game.readDrivePosition, game.placeUrlPose, startKey, (car, pose) => { did.push(`start ${Math.round(pose.x)} ${Math.round(pose.z)}`); return starts && car === vehicle; });
    return did.join(', ');
  };
  const there = `start ${Math.round(plain.x)} ${Math.round(plain.z)}`;
  const together = (did, expected, what) => assert.equal(did, expected, `the keys together: ${what}`);
  together(begins('start=old-mill-road'), there, 'the start link alone gives its place');
  together(begins(`${shared}&start=old-mill-road`), 'place 500 700', 'a shared place goes before the start link');
  together(begins(`${shared}&start=old-mill-road`, { accepts: false }), `place 500 700, ${there}`, 'a refused shared place leaves the start link');
  together(begins('driveAt=1e20,1e20,0&start=old-mill-road'), there, 'an unsafe shared place is never tried, and the start link is used');
  together(begins('trip=quarry&start=old-mill-road', { trip: true }), 'trip', 'a trip goes before the start link');
  together(begins(`at=${village[0] + 500},${village[1] - 700}&start=old-mill-road`), 'place 500 700', 'the test key at goes before the start link');
  together(begins('start=old-mill-road', { starts: false }), `${there}, normal`, 'a refused start place gives the normal start');
  together(begins('start=no-such-road'), 'normal', 'an unknown road gives the normal start');

  // 10. The wiring as text: one read of the key, after the test keys and the trip, and the normal start when there is no place.
  const begin = main.indexOf('// The daily run supplies the start'), end = main.indexOf('scene.add(shift.group);');
  assert.ok(begin > 0 && end > begin, 'the placement block is found');
  const block = main.slice(begin, end), order = ["params.get('road')", "params.get('at')", 'journey.place(placeVisit);', "startKey(params.get('start'), roads.roads, vehicle.bounds)", 'placeAtStart(startPlacement, asked)', "placeFirstStop('new-visit');"].map((text) => block.lastIndexOf(text));
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), 'the start key comes last in the placement block, and falls back to the normal start');
  assert.ok(/if \(!asked \|\| \(!placeAtStart\(startPlacement, asked\) && !fleet\?\.visitQueued\)\) placeFirstStop\('new-visit'\);/.test(block), 'no place, or a refused place: the normal start');
  return { places, outside };
}

async function sources(changed = {}) {
  const text = { ...original, ...changed };
  return { key: await load(text.key), visit: await load(text.visit), main: text.main, place: await placement(text.main) };
}

const { places, outside } = verify(await sources());
const reads = readdirSync('web/src', { recursive: true }).filter((f) => String(f).endsWith('.ts'))
  .flatMap((f) => [...readFileSync(`web/src/${f}`, 'utf8').matchAll(/params\.(?:get|has)\('start'\)/g)].map(() => String(f)));
assert.deepEqual(reads, ['main.ts'], 'the key is read once, in main.ts');
console.log(`PASS start key: made-up roads, long values, ${places} named roads in the ${AREAS.length} areas of the area list (${outside} too near an edge, so the normal start), a shared link that must keep working, the link policy, the keys together and the wiring`);

if (process.argv.includes('--mutations')) {
  // These must fail where the block is run (part 9), not only where its text is read (part 10).
  const BEHAVIOUR = 'the keys together';
  // The share as a pattern, with no limit on the value: it takes about n x n steps on a colon and n digits that end in no share.
  const OLD_FROM = `  if (!value || value.length > START_LONGEST) return null;
  // The share stands after the last colon. A tail that is no share belongs to the name.
  const text = value.trim(), cut = text.lastIndexOf(':');
  const share = cut < 0 ? null : shareOf(text.slice(cut + 1));
  const slug = roadSlug(share === null ? text : text.slice(0, cut));
`;
  const OLD_TO = String.raw`  const asked = /^(.*?)(?::(\d*\.?\d+))?$/.exec((value ?? '').trim());
  const share = asked?.[2] === undefined ? null : Number(asked[2]);
  const slug = asked ? roadSlug(asked[1]) : '';
`;
  const mutants = [
    ['at the very end of the road', 'key', 'total - Math.min(START_BACK, total / 2)', 'total'],
    ['twice as far back', 'key', 'export const START_BACK = 150;', 'export const START_BACK = 450;'],
    ['turned around', 'key', 'heading: Math.atan2(bx - ax, -(bz - az)), distance', 'heading: Math.atan2(ax - bx, bz - az), distance'],
    ['heading east for north', 'key', 'heading: Math.atan2(bx - ax, -(bz - az)), distance', 'heading: Math.atan2(-(bz - az), bx - ax), distance'],
    ['the surveyed direction decides', 'key', 'const line = endIsLast ? piece.pts : [...piece.pts].reverse();', 'const line = piece.pts;'],
    ['the wrong end', 'key', 'const line = endIsLast ? piece.pts : [...piece.pts].reverse();', 'const line = endIsLast ? [...piece.pts].reverse() : piece.pts;'],
    ['joins are not looked at', 'key', 'firstJoined !== lastJoined ? firstJoined :', 'false ? firstJoined :'],
    ['a join only at a touch', 'key', '<= START_JOIN) return true;', '<= 0) return true;'],
    ['a join only at a point of the other road', 'key', 'const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length2)) : 0;', 'const t = 0;'],
    ['a track counts as a join', 'key', 'if (road === piece || !isPublic(road)) continue;', 'if (road === piece) continue;'],
    ['a track can be the road', 'key', 'if (!road.name || !isPublic(road) || road.bridge', 'if (!road.name || road.bridge'],
    ['a bridge can be the road', 'key', '|| road.bridge || road.pts.length < 2', '|| road.pts.length < 2'],
    ['the piece with the most points', 'key', 'const length = lengthOf(road.pts);', 'const length = road.pts.length;'],
    ['the first piece found', 'key', 'if (length > total) { piece = road; total = length; }', 'if (!piece) { piece = road; total = length; }'],
    ['capital letters matter', 'key', ".toLowerCase().replace(/['’]/g, '')", ".replace(/['’]/g, '')"],
    ['accents stay', 'key', ".replace(/\\p{M}/gu, '')", ''],
    ['apostrophes become hyphens', 'key', ".replace(/['’]/g, '')", ''],
    ['any share', 'key', '(share !== null && !(share >= 0 && share <= 1))', 'false'],
    ['a value of any length is read', 'key', ' || value.length > START_LONGEST', '', 'is not read'],
    ['the old pattern reads the share', 'key', OLD_FROM, OLD_TO, 'under 10 ms'],
    ['a share may end in a point', 'key', " || text.endsWith('.')", ''],
    ['a share may have a sign', 'key', 'if (c !== 46 && (c < 48 || c > 57)) return null;', 'if (c !== 46 && c !== 45 && (c < 48 || c > 57)) return null;'],
    ['the share is measured from the end', 'key', ': share * total;', ': (1 - share) * total;'],
    ['the bounds are not looked at', 'key', 'if (bounds && !(pose.x >', 'if (false && !(pose.x >'],
    ['no room at the edge', 'key', 'export const START_EDGE = 12;', 'export const START_EDGE = 0;'],
    ['the east edge is not looked at', 'key', '&& pose.x < bounds[2] - START_EDGE', ''],
    ['an unknown road gets the village', 'key', 'if (!piece) return null;', 'if (!piece) return { x: 0, z: 0, heading: 0, distance: 0 };'],
    ['a test key', 'visit', "  'animal',", "  'start', 'animal',"],
    ['the place is not used', 'main', "if (!asked || (!placeAtStart(startPlacement, asked) && !fleet?.visitQueued)) placeFirstStop('new-visit');", "placeFirstStop('new-visit');", BEHAVIOUR],
    ['a refused place leaves no start', 'main', "if (!asked || (!placeAtStart(startPlacement, asked) && !fleet?.visitQueued)) placeFirstStop('new-visit');", "if (asked) placeAtStart(startPlacement, asked); else placeFirstStop('new-visit');", BEHAVIOUR],
    ['the start link beats a trip', 'main', 'if (journey) journey.place(placeVisit);', "if (journey && !params.has('start')) journey.place(placeVisit);", BEHAVIOUR],
    ['the start link beats a shared place', 'main', 'const pose = at && at.length >= 2 ? at : driveAt;', "const pose = at && at.length >= 2 ? at : params.has('start') ? undefined : driveAt;", BEHAVIOUR],
  ];
  for (const [name, file, from, to, must] of mutants) {
    assert.equal(original[file].split(from).length, 2, `mutation "${name}": its line is found once in ${FILES[file]}`);
    const broken = await sources({ [file]: original[file].replace(from, () => to) });
    let why = null;
    try { verify(broken); } catch (error) { why = error.message.split('\n')[0]; }
    assert.ok(why, `mutation "${name}" must fail`);
    if (must) assert.ok(why.includes(must), `mutation "${name}" must fail at "${must}", and not only at a later line (it failed at: ${why})`);
    console.log(`  rejected: ${name}  (${why.slice(0, 110)})`);
  }
  console.log(`PASS ${mutants.length} broken copies of the start key rejected`);
}
