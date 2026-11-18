// Checks the brooks: the look-up of the nearest brook, the field a land tile gets, the cut in the ground, and the
// baked file itself (data/baked/terrain/streams.json) against the land it was traced on.
// Bundle with web/node_modules/.bin/esbuild, then run with Node (tools/check-streams.sh does both). No browser.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { BROOK_REACH, Streams, brookBlend, brookDistance, brookField } from '../web/src/streams.ts';

// One brook that runs north (toward -z in the world) and then east, 1 m wide, and one culvert.
const village = [1000, 2000];
const data = {
  streams: [{ id: 0, name: '', half: 0.5, pts: [[1000, 1900], [1000, 2000], [1100, 2000]] }],
  culverts: [{ stream: 0, road: 3, a: [1100, 2000], b: [1112, 2000], dia: 0.9, mapped: true }],
};
const s = new Streams(data, village);
assert.ok(Math.abs(s.km - 0.2) < 1e-6, 'two pieces of 100 m');
const at = { side: 0, dx: 0, dz: 0, half: 0, flow: 0 };
// World x = east - 1000, z = 2000 - north. The first piece runs from z = 100 to z = 0 at x = 0: it flows north.
assert.equal(s.at(3, 50, at), true, 'a point 3 m east of the first piece is within reach');
assert.ok(Math.abs(at.side - 3) < 1e-6, `right of the flow is positive: ${at.side}`);
assert.ok(Math.abs(at.dx + 3) < 1e-6 && Math.abs(at.dz) < 1e-6, `the vector points back to the line: ${at.dx}, ${at.dz}`);
assert.ok(Math.abs(at.flow) < 1e-6, `the first piece flows north: ${at.flow}`);
assert.equal(at.half, 0.5);
assert.equal(s.at(-4, 50, at), true);
assert.ok(Math.abs(at.side + 4) < 1e-6, `left of the flow is negative: ${at.side}`);
assert.equal(s.at(50, -2, at), true, 'the second piece');
assert.ok(Math.abs(at.flow - Math.PI / 2) < 1e-6, `the second piece flows east: ${at.flow}`);
assert.ok(Math.abs(at.side + 2) < 1e-6, `north of an eastward brook is its left: ${at.side}`);
assert.equal(s.at(0, 50 + 0, at) && Math.abs(at.side) < 1e-6, true, 'on the centre line');
assert.equal(s.at(BROOK_REACH + 0.5, 50, at), false, 'out of reach');
assert.equal(s.at(4000, 4000, at), false, 'far away');
assert.equal(s.near(-200, 20, -100, 80), false, 'a box with no brook');
assert.equal(s.near(-5, 20, 5, 80), true);

// The field of a 16 m tile with 17 samples (1 m apart), with the first piece down its middle (x = 8).
const field = brookField(s, -8, 40, 16, 17);
assert.ok(field, 'a tile on the brook has a field');
const px = (a, b) => field.subarray((b * 17 + a) * 4, (b * 17 + a) * 4 + 4);
assert.deepEqual([...px(8, 5)], [128, 128, 25, 0], 'on the centre line: no offset, half width 0.5 m in steps of 0.02 m, flowing north');
assert.equal(px(11, 5)[0], 98, '3 m east of the line, the line is 3 m to the west: 128 - 30');
assert.equal(px(5, 5)[0], 158, '3 m west of the line: 128 + 30');
assert.equal(px(11, 5)[1], 128, 'no offset along the brook');
assert.ok(Math.abs(brookDistance(field, 5 * 17 + 11) - 3) < 0.06, 'the distance comes back from the two bytes');
assert.equal(brookDistance(new Uint8Array(8), 1), 99, 'a sample with no brook is far away');
assert.equal(brookField(s, 500, 500, 16, 17), null, 'a tile away from every brook has no field');
// The offset must change sign between two samples that lie on opposite sides of the line: this is what lets the
// shader draw a brook that is narrower than one sample (the blend of the two offsets passes through zero).
const half = brookField(s, -8.5, 40, 16, 17);
assert.ok(half[(5 * 17 + 8) * 4] > 128 && half[(5 * 17 + 9) * 4] < 128, 'samples either side of the line point at each other');
// Beside the east-west piece the offset is along z.
const south = brookField(s, 40, -8, 16, 17);
assert.ok(south[(11 * 17 + 8) * 4 + 1] === 98 && south[(11 * 17 + 8) * 4] === 128, '3 m south of an east-west brook, the line is 3 m to the north (-z)');
assert.equal(south[(11 * 17 + 8) * 4 + 3], 64, 'east is a quarter of the way round the compass');

// Between two separate brooks the vectors point opposite ways; their plain blend would be zero half way, and paint
// water on dry ground. Two brooks 20 m apart, read from samples 4 m apart (a far tile): no water between them.
{
  const two = new Streams({ streams: [{ id: 0, name: '', half: 0.5, pts: [[1000, 1900], [1000, 2100]] }, { id: 1, name: '', half: 0.5, pts: [[1020, 1900], [1020, 2100]] }], culverts: [] }, village);
  const f4 = brookField(two, -32, -32, 64, 17);   // samples at x = -32, -28, ... 32: x = 8 and x = 12 straddle the middle
  const plain = (() => { const q8 = (8 * 17 + 10) * 4, q12 = (8 * 17 + 11) * 4; return Math.abs((f4[q8] * 0.1 - 12.8 + f4[q12] * 0.1 - 12.8) / 2); })();
  assert.ok(plain < 0.2, `the case is real: the plain blend half way is ${plain.toFixed(2)} m`);
  for (let x = 4; x <= 16; x += 0.5) {
    const d = brookBlend(f4, 17, 4, (x + 32) / 4, 8.3), truth = Math.min(x, 20 - x);
    assert.ok(d >= truth - 1.42 * 4 - 0.15, `no false water between two brooks: at x = ${x} the field says ${d.toFixed(2)} m, the truth is ${truth} m`);
    if (truth >= 6) assert.ok(d > 3.5, `dry ground stays dry at x = ${x}: ${d.toFixed(2)} m`);
  }
  assert.ok(brookBlend(f4, 17, 4, 32 / 4, 8.3) < 0.15 && brookBlend(f4, 17, 4, 52 / 4, 8.3) < 0.15, 'both brooks are still on their lines');
  // The same two brooks from samples that straddle the first one (x = -2 and x = 2): its line is still found, and
  // the water has its width: wet at 0.3 m from the line, dry at 1.5 m.
  const off = brookField(two, -30, -32, 64, 17);
  assert.ok(brookBlend(off, 17, 4, 30 / 4, 8.3) < 0.15, 'a brook between two samples is still on its line');
  assert.ok(brookBlend(off, 17, 4, 30.3 / 4, 8.3) < 0.5 && brookBlend(off, 17, 4, 31.5 / 4, 8.3) > 0.5, 'and it keeps its width');
}

// One straight brook: the vector to its line changes evenly from sample to sample, so the blend is exact but for the
// rounding of the stored vectors (0.071 m at most), whatever the angle of the brook to the samples. A floor that
// forgot the rounding pushed points just inside a narrow brook to just outside it: the first case is that one.
{
  const line = (nx, nz, c) => {   // the brook n . P = c through a 16 m tile of 1 m samples round the origin
    const ex = nz, ez = -nx, world = (x, z) => [x + village[0], village[1] - z];
    return new Streams({ streams: [{ id: 0, name: '', half: 0.22, pts: [world(nx * c - ex * 60, nz * c - ez * 60), world(nx * c + ex * 60, nz * c + ez * 60)] }], culverts: [] }, village);
  };
  const narrow = brookField(line(0.6, 0.8, 0.59), -8, -8, 16, 17);
  const inside = brookBlend(narrow, 17, 1, 8.24, 8.32);   // the point (0.24, 0.32): 0.19 m from the line
  assert.ok(inside < 0.22, `a point 0.19 m from the line of a brook of half width 0.22 m is in the water: the field says ${inside.toFixed(3)} m`);
  let seedL = 99, worstL = 0;
  const r = () => (seedL = (seedL * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let k = 0; k < 400; k++) {
    const angle = r() * Math.PI * 2, nx = Math.cos(angle), nz = Math.sin(angle), c = (r() - 0.5) * 6;
    const fieldL = brookField(line(nx, nz, c), -8, -8, 16, 17);
    for (let i = 0; i < 60; i++) {
      const x = (r() - 0.5) * 10, z = (r() - 0.5) * 10, truth = Math.abs(nx * x + nz * z - c);
      if (truth > 5) continue;
      const d = brookBlend(fieldL, 17, 1, x + 8, z + 8);
      worstL = Math.max(worstL, Math.abs(d - truth));
      assert.ok(Math.abs(d - truth) <= 0.0712, `a straight brook is read to within the rounding: ${d.toFixed(4)} m against ${truth.toFixed(4)} m`);
    }
  }
  assert.ok(worstL > 0.02, 'the straight-brook test met rounding at all');
}

// The cut: deepest on the centre line, never negative, gone before the reach of the field.
let last = Infinity;
for (let d = 0; d <= 6; d += 0.25) {
  const c = Streams.cut(d, 0.5);
  assert.ok(c >= 0 && c <= last + 1e-9, `the cut gets shallower away from the brook (${d} m: ${c})`);
  last = c;
}
assert.ok(Streams.cut(0, 0.5) > 0.2 && Streams.cut(0, 0.5) < 0.6, 'a small brook is cut a few decimetres');
assert.equal(Streams.cut(0.5 + 2.4, 0.5), 0, 'no cut beyond the bank');
assert.ok(Streams.cut(0, 4) < 0.7, 'a wide brook is not a canyon');

// Culvert mouths: one at each end, each pointing away from the other.
assert.equal(s.mouths.length, 2);
assert.ok(s.mouths[0].outX < 0 && s.mouths[1].outX > 0, 'the mouths point outward along the pipe');

// Broken input must not stop the game.
const odd = new Streams({ streams: [{ id: 1, name: '', half: 0, pts: [[0, 0], [1, 1]] }, { id: 2, name: '', half: 1, pts: [[5, 5]] }], culverts: [{ a: [0, 0], b: [0, 0], dia: 1 }] }, village);
assert.equal(odd.km, 0); assert.equal(odd.mouths.length, 0);
assert.doesNotThrow(() => new Streams({}, village));
assert.doesNotThrow(() => new Streams(null, village));
// Numbers that would send a loop to infinity, or round the planet, are left out; the good piece beside them stays.
const t0 = Date.now();
const wild = new Streams({
  streams: [{ id: 1, name: '', half: 0.5, pts: [[0, 1e309], [1, 0]] }, { id: 2, name: '', half: 0.5, pts: [[1000, 2000], [1e12, 2000]] },
    { id: 3, name: '', half: 0.5, pts: [[NaN, 2000], [1010, 2000]] }, { id: 4, name: '', half: 1e9, pts: [[1000, 2000], [1010, 2000]] },
    { id: 5, name: '', half: 0.5, pts: ['x', null, [1000, 2000], [1010, 2000]] }, null, 7],
  culverts: [{ a: [1e309, 0], b: [0, 0], dia: 1 }, { a: [1000, 2000], b: [1000, 9e9], dia: 1 }, null, { a: [1000, 2000], b: [1008, 2000], dia: 0.9 }],
}, village);
assert.ok(Math.abs(wild.km - 0.01) < 1e-9, `only the one sound piece is kept: ${wild.km} km`);
assert.equal(wild.mouths.length, 2, 'only the one sound culvert is kept');
assert.ok(Date.now() - t0 < 2000, 'bad numbers cost no time');
console.log('PASS: nearest brook and side, tile field, zero crossing, cut profile, culvert mouths, broken input.');

// The baked file, when this checkout has the land.
const root = `${process.env.MMM_ROOT ?? '.'}/data/baked/terrain`;
if (!existsSync(`${root}/streams.json`)) {
  console.log('NOTE: no data/baked/terrain/streams.json here; the baked file was not checked.');
} else {
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, 'utf8'));
  const baked = JSON.parse(readFileSync(`${root}/streams.json`, 'utf8'));
  assert.equal(manifest.streams?.file, 'streams.json', 'the manifest names the file');
  assert.equal(manifest.streams.count, baked.streams.length); assert.equal(manifest.streams.culverts, baked.culverts.length);
  const fine = new Set(manifest.levels['8']);
  const tile = (p) => `${Math.floor((p[0] - manifest.origin[0]) / 256)}_${Math.floor((manifest.origin[1] - p[1]) / 256)}`;
  let metres = 0, points = 0, off = 0;
  for (const st of baked.streams) {
    assert.ok(st.pts.length >= 2 && st.half >= 0.2 && st.half <= 2.01, `stream ${st.id}: at least two points and a sane width`);
    for (let k = 0; k < st.pts.length; k++) {
      points++;
      if (!fine.has(tile(st.pts[k]))) off++;
      if (k) { const d = Math.hypot(st.pts[k][0] - st.pts[k - 1][0], st.pts[k][1] - st.pts[k - 1][1]); metres += d; assert.ok(d < 400, `stream ${st.id}: no jump (${d.toFixed(0)} m)`); }
    }
  }
  // A point may sit on the shared edge sample of a tile that is not in the set; more than a handful means a fault.
  assert.ok(off <= points * 0.002, `brook points on the 1 m land: ${off} of ${points} are off it`);
  assert.ok(Math.abs(metres / 1000 - manifest.streams.km) < 0.6, `length ${(metres / 1000).toFixed(1)} km against the manifest's ${manifest.streams.km}`);
  for (const c of baked.culverts) {
    const len = Math.hypot(c.a[0] - c.b[0], c.a[1] - c.b[1]);
    assert.ok(len >= 3 && len <= 80, `culvert length ${len.toFixed(1)} m`);
    assert.ok([0.6, 0.9, 1.2, 1.8].includes(c.dia), 'a stock pipe size');
  }
  const real = new Streams(baked, manifest.village);
  assert.equal(real.mouths.length, baked.culverts.length * 2);
  // The fast way to build a tile's field must give what the plain look-up gives, sample for sample, on real brooks.
  // (A tie between two pieces at the very edge of the reach may differ by one step: both ways must agree within one.)
  let tiles = 0, compared = 0, edges = 0;
  for (const st of baked.streams.filter((_, k) => k % 40 === 0)) {
    const mid = st.pts[st.pts.length >> 1], wx = mid[0] - manifest.village[0], wz = manifest.village[1] - mid[1];
    const x0 = Math.floor(wx / 256) * 256, z0 = Math.floor(wz / 256) * 256;
    for (const [size, n] of [[256, 257], [512, 257], [1024, 257]]) {
      const fast = brookField(real, x0, z0, size, n);
      assert.ok(fast, 'a tile on a real brook has a field');
      const one = { side: 0, dx: 0, dz: 0, half: 0, flow: 0 }, step = size / (n - 1);
      for (let b = 0; b < n; b += 3) for (let a = 0; a < n; a += 3) {
        const q = (b * n + a) * 4, there = real.at(x0 + a * step, z0 + b * step, one);
        assert.equal(fast[q + 2] > 0, there, `a brook is near in both ways (${a}, ${b})`);
        if (!there) continue;
        compared++;
        assert.equal(fast[q], Math.round(128 + one.dx * 10), `offset in x agrees (${a}, ${b})`);
        assert.equal(fast[q + 1], Math.round(128 + one.dz * 10), `offset in z agrees (${a}, ${b})`);
        assert.equal(fast[q + 2], Math.min(255, Math.max(1, Math.round(one.half * 50))), 'half width agrees');
      }
      tiles++;
      // Two tiles side by side must hold the same bytes along the edge they share: the shader's blend on that edge
      // reads those samples only, so equal bytes mean no seam in the paint and none in the cut of the ground.
      for (const [ex, ez] of [[size, 0], [0, size]]) {
        const next = brookField(real, x0 + ex, z0 + ez, size, n);
        for (let k = 0; k < n; k++) {
          const mine = ex ? (k * n + n - 1) * 4 : ((n - 1) * n + k) * 4, theirs = ex ? (k * n) * 4 : k * 4;
          const there = next ? [...next.subarray(theirs, theirs + 4)] : [0, 0, 0, 0];
          assert.deepEqual([...fast.subarray(mine, mine + 4)], there, `the shared edge agrees (${size} m tile at ${x0}, ${z0}, ${ex ? 'east' : 'south'} edge, sample ${k})`);
          edges++;
        }
      }
    }
  }
  // The distance the shader blends from the field, against the true distance, at points between the samples.
  // Proven limits (see brookBlend): never under the truth by more than 1.42 samples + 0.15 m (so water is never drawn
  // further than that beyond its edge, and never between two separate brooks), never over it by more than
  // 0.71 samples + 0.1 m (so a brook is never lost by more than that).
  let seed = 12345, blended = 0;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const worst = { under: 0, over: 0 };
  for (const size of [256, 512]) {   // the two sample spacings the game makes a field for
    const n = 257, texel = size / 256, one = { side: 0, dx: 0, dz: 0, half: 0, flow: 0 };
    for (const st of baked.streams.filter((_, k) => k % 30 === 0)) {
      const mid = st.pts[st.pts.length >> 1], wx = mid[0] - manifest.village[0], wz = manifest.village[1] - mid[1];
      const x0 = Math.floor(wx / size) * size, z0 = Math.floor(wz / size) * size;
      const field = brookField(real, x0, z0, size, n), east = brookField(real, x0 + size, z0, size, n);
      if (!field) continue;
      for (let i = 0; i < 3000; i++) {
        const p = st.pts[Math.floor(rnd() * st.pts.length)];
        const x = p[0] - manifest.village[0] + (rnd() - 0.5) * 16, z = manifest.village[1] - p[1] + (rnd() - 0.5) * 16;
        const fa = (x - x0) / texel, fb = (z - z0) / texel;
        if (fa < 0 || fb < 0 || fa > 256 || fb > 256 || !real.at(x, z, one)) continue;
        const truth = Math.hypot(one.dx, one.dz), d = brookBlend(field, n, texel, fa, fb);
        if (d === 99) { assert.ok(truth > 6 - 0.71 * texel - 0.1, `"far" is only said far from a brook: ${truth.toFixed(2)} m`); continue; }
        blended++;
        worst.under = Math.max(worst.under, (truth - d) / texel); worst.over = Math.max(worst.over, (d - truth) / texel);
        assert.ok(d >= truth - 1.42 * texel - 0.15, `no false water (${size} m tile): the field says ${d.toFixed(2)} m, the truth is ${truth.toFixed(2)} m`);
        assert.ok(d <= truth + 0.71 * texel + 0.1, `no lost water (${size} m tile): the field says ${d.toFixed(2)} m, the truth is ${truth.toFixed(2)} m`);
      }
      // On the edge two tiles share, each must blend the same distance from its own field.
      if (east) for (let i = 0; i < 200; i++) {
        const fb = rnd() * 256;
        assert.equal(brookBlend(field, n, texel, 256, fb), brookBlend(east, n, texel, 0, fb), `the blend agrees on the shared edge (${size} m tile at ${x0}, ${z0})`);
        edges++;
      }
    }
  }
  // The place where the review found water on dry ground with a plain blend of the vectors: 6 m from the nearest
  // brook (half width 1.82 m). At every sample spacing, also the 4 m one the game no longer uses, it must stay dry.
  for (const size of [256, 512, 1024]) {
    const wx = 627330 - manifest.village[0], wz = manifest.village[1] - 5104354, x0 = Math.floor(wx / size) * size, z0 = Math.floor(wz / size) * size;
    const d = brookBlend(brookField(real, x0, z0, size, 257), 257, size / 256, (wx - x0) / (size / 256), (wz - z0) / (size / 256));
    assert.ok(d > 1.82 + 0.3, `dry ground at 627330, 5104354 stays dry with ${size / 256} m samples: ${d.toFixed(2)} m`);
  }
  assert.ok(blended > 50000, `enough points blended (${blended})`);
  assert.ok(tiles >= 20 && compared > 5000 && edges > 10000, `enough of the land compared (${tiles} tiles, ${compared} samples, ${edges} edge samples)`);
  console.log(`PASS: baked brooks: ${baked.streams.length} runs, ${(metres / 1000).toFixed(1)} km, ${baked.culverts.length} culverts, ${points} points; the fast field equals the plain look-up on ${tiles} tiles (${compared} samples); shared tile edges agree (${edges} samples); the blended distance stays within its limits at ${blended} points (at most ${worst.under.toFixed(2)} samples under the truth, ${worst.over.toFixed(2)} over).`);
}
