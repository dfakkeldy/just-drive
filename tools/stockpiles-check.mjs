// Stockpile pack and geometry rules on the CPU: schema, solid log stacks, seating on the drawn land, culling,
// tree exclusions and the HIGH and LOW budgets. MMM_STOCKPILE_FILE names the pack (check-stockpiles.sh passes the
// committed one, tools/stockpiles-delta/stockpiles.json).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Stockpiles, parseStockpiles, pileHeight, denseMound, moundRim, stackShape, straighten, stubLayout, pileNoise, OUTLINE_SHIFT, STUB_REACH, FOLD_SHARE } from '../web/src/stockpiles.ts';
const path = process.env.MMM_STOCKPILE_FILE ?? 'tools/stockpiles-delta/stockpiles.json';
const data = parseStockpiles(JSON.parse(readFileSync(path, 'utf8')), 'pointtupper');
assert.deepEqual(data.piles.map(p => p.kind).sort(), ['coal', 'logs']);
const coalPile = data.piles.find(p => p.kind === 'coal'), logPile = data.piles.find(p => p.kind === 'logs');
for (const q of ['high', 'low']) for (const p of data.piles) for (const m of p[q]) {
  assert.ok(m.indices.length / 3 < 10000);
  assert.ok(m.indices.length / 3 >= 2, 'no speck parts: the bake drops a part smaller than a pile');
  for (let i = 0; i < m.indices.length; i += 3) {
    const [a, b, c] = m.indices.slice(i, i + 3).map(k => m.vertices[k]);
    assert.ok(Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 0, 'no degenerate face');
  }
}
const origin = [628000, 5050000], terrain = { seaLevel: 0, exag: 1.5 };
// Faces that a moved outline folded over or flattened: in `plan` they turn the other way than in the pack, or keep
// less than FOLD_SHARE of their baked area.
const folded = (m, plan) => { const turn = (at, a, b, c) => (at[b][0] - at[a][0]) * (at[c][1] - at[a][1]) - (at[b][1] - at[a][1]) * (at[c][0] - at[a][0]); let n = 0; for (let i = 0; i < m.indices.length; i += 3) { const [a, b, c] = m.indices.slice(i, i + 3), baked = turn(m.vertices, a, b, c); if (turn(plan, a, b, c) * baked < FOLD_SHARE * baked * baked - 1e-9) n++; } return n; };
assert.equal(pileHeight([0, 0, 10, 14], terrain), 19, 'exaggerate ground, retain real surface height');
assert.equal(pileHeight([0, 0, -2, -1], terrain), -1, 'below-sea height stays unexaggerated');
assert.equal(pileNoise(629000.5, 5049000.25, 3), pileNoise(629000.5, 5049000.25, 3), 'noise repeats');
assert.ok([0, 1, 2, 3].every(salt => { const n = pileNoise(628614, 5050767, salt); return n >= 0 && n < 1; }), 'noise is 0..1');

// A stack is a closed block: every outline edge gets a wall, the outline moves a bounded distance, heights only rise.
for (const low of [false, true]) for (const mound of logPile[low ? 'low' : 'high']) {
  const shape = stackShape(mound, low), rim = moundRim(mound);
  assert.deepEqual(shape, stackShape(mound, low), 'deterministic stack and stub logs');
  assert.equal(folded(mound, shape.points.map(p => [p.east, p.north])), 0, 'the straightened stack outline folds no face over');
  assert.equal(shape.walls.length, rim.length, 'one wall for each outline edge');
  assert.ok(rim.length >= 3 && rim.every(e => Math.abs(Math.hypot(...e.out) - 1) < 1e-9), 'outline edges have unit outward directions');
  shape.points.forEach((p, i) => {
    const v = mound.vertices[i];
    assert.ok(Math.hypot(p.east - v[0], p.north - v[1]) <= OUTLINE_SHIFT + 1e-9, 'outline stays within OUTLINE_SHIFT of the baked faces');
    assert.ok(p.height >= v[3] - v[2] - 1e-9 && p.height <= 12, 'stack heights are the measured ones, lifted only at the outline');
  });
  const inner = new Set(shape.points.keys()); for (const e of rim) { inner.delete(e.a); inner.delete(e.b); }
  for (const i of inner) assert.deepEqual([shape.points[i].east, shape.points[i].north, shape.points[i].height], [mound.vertices[i][0], mound.vertices[i][1], mound.vertices[i][3] - mound.vertices[i][2]], 'inside vertices are the pack vertices');
  for (const stub of shape.stubs) assert.ok(stub.reach > 0 && stub.reach <= STUB_REACH && stub.t > 0 && stub.t < 1 && stub.rise > 0 && stub.rise <= 1 && stub.girth > 0.8 && stub.girth < 1.3, 'bounded stub log');
  // Outward means away from the stack: a point just outside an outline edge is in no baked face of this mound.
  const inFace = (e, n) => { for (let i = 0; i < mound.indices.length; i += 3) { const t = mound.indices.slice(i, i + 3).map(k => mound.vertices[k]), s = t.map((a, k) => { const b = t[(k + 1) % 3]; return (b[0] - a[0]) * (n - a[1]) - (b[1] - a[1]) * (e - a[0]); }); if (s.every(v => v >= 0) || s.every(v => v <= 0)) return true; } return false; };
  for (const e of rim) { const a = mound.vertices[e.a], b = mound.vertices[e.b], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; assert.ok(!inFace(mid[0] + e.out[0] * 0.5, mid[1] + e.out[1] * 0.5) && inFace(mid[0] - e.out[0] * 0.5, mid[1] - e.out[1] * 0.5), 'outward direction leaves the stack'); }
}

// The coal outline is straightened by the same rule: bounded, and only on the outline.
assert.equal(folded({ vertices: [[0, 0], [4, 0], [0, 4]], indices: [0, 1, 2] }, [[0, 0], [4, 0], [0, -1]]), 1, 'the fold test sees a folded face');
assert.equal(folded({ vertices: [[0, 0], [4, 0], [0, 4]], indices: [0, 1, 2] }, [[0, 0], [4, 0], [2, 0]]), 1, 'the fold test sees a face flattened to a line');
for (const low of [false, true]) for (const mound of coalPile[low ? 'low' : 'high']) {
  const plan = straighten(mound), outline = new Set(moundRim(mound).flatMap(e => [e.a, e.b]));
  let moved = 0;
  plan.forEach((p, i) => { const d = Math.hypot(p[0] - mound.vertices[i][0], p[1] - mound.vertices[i][1]); assert.ok(d <= OUTLINE_SHIFT + 1e-9 && (outline.has(i) || d === 0), 'coal outline shift bounded, inside untouched'); if (d > 0.2) moved++; });
  assert.ok(moved > 4, 'the stepped coal outline is straightened');
  assert.equal(folded(mound, plan), 0, 'the straightened coal outline folds no face over');
  // No cracks: in the dense skin every edge inside the pile is shared by two faces, as in the pack.
  const dense = denseMound(mound, plan), split = low ? 16 : 4;
  assert.equal(dense.indices.length, mound.indices.length * split, 'every baked face splits alike');
  assert.equal(moundRim(dense).length, moundRim(mound).length * Math.sqrt(split), 'the dense outline is the baked outline, split; no open edge inside');
}

const count = s => { let calls = 0, triangles = 0, instances = 0, textures = 0; s.group.traverse(m => { if (!m.isMesh) return; calls++; triangles += m.geometry.index.count / 3 * (m.isInstancedMesh ? m.count : 1); if (m.isInstancedMesh) instances += m.count; if (m.material.map) textures++; }); return { calls, triangles, instances, textures }; };
const near = (s, site) => ({ x: site.center[0] - origin[0], z: origin[1] - site.center[1] });
const pass = (s, camera) => { s.next = 0; s.update(camera); };
const totals = [];
for (const low of [false, true]) {
  const s = new Stockpiles(data, origin, terrain, low), cost = count(s);
  assert.ok(cost.calls <= 3 && cost.textures === 0, 'one skin per site and one stub batch, no textures');
  assert.ok(cost.instances > 0 && cost.instances <= (low ? 384 : 1536), 'bounded stub logs');
  assert.ok(cost.triangles < (low ? 10000 : 50000), 'bounded triangle cost');
  assert.ok(s.sites.every(site => !site.group.visible), 'piles start hidden');
  // The first pass shows every pile once, unculled, so the shaders are built with the scene; the next one culls.
  pass(s, { x: 1e6, z: 1e6 });
  assert.ok(s.sites.every(site => site.group.visible && site.group.children.every(m => !m.frustumCulled)), 'first pass draws every pile once');
  pass(s, { x: 1e6, z: 1e6 });
  assert.ok(s.sites.every(site => !site.group.visible && site.group.children.every(m => m.frustumCulled)), 'far piles hidden and culled as usual after the first pass');
  for (const site of s.sites) { pass(s, near(s, site)); assert.ok(site.group.visible, 'near pile shown'); assert.ok(site.radius > 20 && site.radius < 400, 'culling radius covers the pile only'); }
  const mound = coalPile.high[0], tri = mound.indices.slice(0, 3).map(i => mound.vertices[i]);
  assert.ok(s.excludes(tri.reduce((n, v) => n + v[0] / 3, 0), tri.reduce((n, v) => n + v[1] / 3, 0)), 'false tree returns excluded inside measured faces');
  assert.equal(s.excludes(0, 0), false, 'no whole-yard/global tree exclusion');
  assert.equal(s.excludes(coalPile.center[0] + 400, coalPile.center[1]), false, 'no exclusion beside the pile');
  const stacks = logPile[low ? 'low' : 'high'].map(m => stackShape(m, low));
  assert.deepEqual(stubLayout(stacks, low), stubLayout(stacks, low), 'deterministic instancing');
  totals.push({ low, ...cost });
}
assert.ok(totals[1].triangles < totals[0].triangles / 3, 'LOW is materially cheaper');
for (const mutate of [d => d.area = 'mabou', d => d.piles[0].high[0].indices[0] = -1, d => d.piles[0].high[0].vertices[0][2] = NaN, d => d.piles.push(d.piles[0])]) {
  const bad = structuredClone(data); mutate(bad); assert.throws(() => parseStockpiles(bad, 'pointtupper'));
}
assert.equal(await Stockpiles.load({}, () => { throw Error('must not fetch'); }, terrain, false, 'pointtupper'), null, 'old packs need no stockpile file');
console.log('PASS stockpile schema, solid stacks, instancing, culling, tree exclusions and budgets', JSON.stringify(totals));

// Review regression: this LOW-only log face contains an actual false tree return.
for (const low of [false, true]) assert.ok(new Stockpiles(data, origin, terrain, low).excludes(628652, 5050731), 'both qualities suppress LOW-only 4.4 m false tree');

// The drawn land can differ from the bake's heights (exaggeration, a coarser tile). Every part must sit on the
// land that is drawn: no floating sheet, no edge in the air, no log under the ground.
const peak = coalPile.high[0].vertices[0], px = peak[0] - origin[0], pz = origin[1] - peak[1];
let shift = 0;
const ground = (x, z) => 100 + shift + Math.max(0, 8 - Math.abs(x - px) - Math.abs(z - pz));
for (const low of [false, true]) {
  shift = 0;
  const fitted = new Stockpiles(data, origin, { ...terrain, surfaceAt: (x, z) => ({ level: 8, ground: ground(x, z) }), meshHeightAt: ground }, low);
  pass(fitted, { x: 1e6, z: 1e6 });
  const seat = () => { for (const site of fitted.sites) pass(fitted, near(fitted, site)); };
  const verify = (label, s = fitted) => {
    for (const [site, pile] of s.sites.map(site => [site, data.piles.find(p => p.id === site.id)])) {
      const skin = site.group.children.find(m => m.isMesh && !m.isInstancedMesh), p = skin.geometry.getAttribute('position'), ids = skin.geometry.index.array;
      const lift = i => p.getY(i) - ground(p.getX(i), p.getZ(i));
      if (pile.kind === 'coal') {
        let foot = 0, body = 0;
        for (let i = 0; i < p.count; i++) { const y = lift(i); if (Math.abs(y + 0.35) < 1e-3) foot++; else { assert.ok(y >= 0.14 - 1e-3 && y <= 0.5 + 1e-3, `${label}: coal skin lies 0.14 to 0.5 m above the drawn land (${y})`); body++; } }
        assert.ok(foot > 20 && body > foot, `${label}: the coal outline goes under the land, the rest lies on it`);
        // Faces on the bake's own 2 m grid match the fixture land's folds: their inside must clear it too. Faces
        // that touch the straightened outline are off that grid; they end under the land by design.
        const grid = k => Math.abs((p.getX(k) + origin[0]) / 2 - Math.round((p.getX(k) + origin[0]) / 2)) < 1e-6 && Math.abs((origin[1] - p.getZ(k)) / 2 - Math.round((origin[1] - p.getZ(k)) / 2)) < 1e-6;
        let inner = 0;
        for (let i = 0; i < ids.length; i += 3) { const t = [ids[i], ids[i + 1], ids[i + 2]]; if (t.some(k => lift(k) < 0 || !grid(k))) continue; inner++; const c = k => t.reduce((n, v) => n + p[k](v) / 3, 0); assert.ok(c('getY') >= ground(c('getX'), c('getZ')) + 0.1, `${label}: coal face interior above the drawn land`); }
        assert.ok(inner > ids.length / 3 * 0.3, `${label}: many coal faces are on the bake's grid and were checked (${inner} of ${ids.length / 3})`);
      } else {
        let tops = 0, feet = 0;
        for (let i = 0; i < p.count; i++) { const y = lift(i); if (Math.abs(y + 0.3) < 1e-3) feet++; else { assert.ok(y >= 1.2 - 1e-3 && y <= 12, `${label}: a stack top stands its measured height above the drawn land (${y})`); tops++; } }
        assert.ok(feet > 20 && feet % 2 === 0 && tops > feet, `${label}: every wall goes down into the drawn land`);
        // The shadow bias moves a wall's shadow lookup along its normal: the normal must point out of the stack. A
        // point just outside a wall is in no top face of the site, a point just inside is in one.
        const normal = skin.geometry.getAttribute('normal'), inTop = (x, z) => { for (let i = 0; i < ids.length; i += 3) { const t = [ids[i], ids[i + 1], ids[i + 2]]; if (t.some(k => lift(k) < 0)) continue; const sides = t.map((a, k) => { const b = t[(k + 1) % 3]; return (p.getX(b) - p.getX(a)) * (z - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (x - p.getX(a)); }); if (sides.every(v => v >= 0) || sides.every(v => v <= 0)) return true; } return false; };
        let walls = 0;
        for (let i = 0; i + 3 < p.count; i++) {
          if (lift(i) < 0 || lift(i + 1) < 0 || lift(i + 2) > 0 || lift(i + 3) > 0 || Math.hypot(p.getX(i) - p.getX(i + 1), p.getZ(i) - p.getZ(i + 1)) < 1) continue;   // the four corners of one wall
          const x = (p.getX(i) + p.getX(i + 1)) / 2, z = (p.getZ(i) + p.getZ(i + 1)) / 2, nx = normal.getX(i + 2), nz = normal.getZ(i + 2), flat = Math.hypot(nx, nz);
          assert.ok(flat > 0.9, `${label}: a wall normal is level`);
          if (!inTop(x - nx / flat * 0.2, z - nz / flat * 0.2)) continue;   // a wall between two stacks that touch
          assert.ok(!inTop(x + nx / flat * 0.2, z + nz / flat * 0.2), `${label}: a wall normal points out of the stack`); walls++; i += 3;
        }
        assert.ok(walls > feet / 4, `${label}: most walls were tested for an outward normal (${walls} of ${feet / 2})`);
        const batch = site.group.children.find(m => m.isInstancedMesh), a = batch.instanceMatrix.array;
        for (let i = 0; i < batch.count; i++) { const o = i * 16; assert.ok(a[o + 13] >= ground(a[o + 12], a[o + 14]) + 0.16, `${label}: a stub log lies on or above the drawn land`); assert.ok(a[o + 13] <= ground(a[o + 12], a[o + 14]) + 12, `${label}: a stub log is not above its stack`); }
      }
    }
  };
  seat(); verify('first seat');
  const refits = fitted.sites.map(site => site.refits);
  assert.ok(refits.every(n => n === 1), 'one full seat when the land arrives');
  seat(); seat();
  assert.deepEqual(fitted.sites.map(site => site.refits), refits, 'unchanged land costs no second full seat (probe points only)');
  shift = 3; seat(); verify('land changed');
  assert.ok(fitted.sites.every((site, i) => site.refits === refits[i] + 1), 'changed land seats the pile again');

  // The land draws only the tiles in view, in 16 m stripes here, and its own sample is 0.4 m off the drawn mesh.
  // A pile seated on the mesh keeps that seat while the mesh is out of the picture, and is not read again when
  // the same mesh comes back: turning the camera costs nothing and moves nothing.
  shift = 0;
  let inView = () => true;
  const striped = (x, z) => inView(x) ? ground(x, z) : null;
  const turned = new Stockpiles(data, origin, { ...terrain, surfaceAt: (x, z) => ({ level: 8, ground: ground(x, z) + 0.4 }), meshHeightAt: striped }, low);
  const turn = () => { for (const site of turned.sites) pass(turned, near(turned, site)); };
  const places = () => turned.sites.map(site => site.group.children.map(m => Array.from(m.isInstancedMesh ? m.instanceMatrix.array : m.geometry.getAttribute('position').array)));
  pass(turned, { x: 1e6, z: 1e6 }); turn(); verify('seated in view', turned);
  const seated = places(), once = turned.sites.map(site => site.refits);
  inView = x => Math.floor(x / 16) % 2 === 0; turn(); turn();
  assert.deepEqual(turned.sites.map(site => site.refits), once, 'land that leaves the picture does not seat the pile again');
  for (const site of turned.sites) site.fit(true);
  assert.deepEqual(places(), seated, 'a pile seated on the drawn mesh keeps its place while the mesh is out of the picture');
  const forced = turned.sites.map(site => site.refits);
  inView = () => true; turn();
  assert.deepEqual(turned.sites.map(site => site.refits), forced, 'the same land coming back does not seat the pile again');
  // The other way round: a pile first met out of view stands on the land's samples, then on the mesh once drawn.
  inView = () => false;
  const late = new Stockpiles(data, origin, { ...terrain, surfaceAt: (x, z) => ({ level: 8, ground: ground(x, z) + 0.4 }), meshHeightAt: striped }, low);
  pass(late, { x: 1e6, z: 1e6 });
  for (const site of late.sites) { pass(late, near(late, site)); assert.ok(site.group.visible && site.refits === 1, 'a pile out of view is seated on the land samples and shown'); }
  inView = () => true;
  for (const site of late.sites) { pass(late, near(late, site)); assert.equal(site.refits, 2, 'the drawn mesh seats it once more'); }
  verify('mesh drawn after a seat on samples', late);
  // A tile with no probe point on it: the coal skin's second vertex alone is in view. The pass reads a few more
  // points in turn each time, so that vertex goes from the land's sample (0.4 m high) to the drawn mesh.
  const lone = new Stockpiles(data, origin, { ...terrain, surfaceAt: (x, z) => ({ level: 8, ground: ground(x, z) + 0.4 }), meshHeightAt: (x, z) => inView(x, z) ? ground(x, z) : null }, low);
  inView = () => false; pass(lone, { x: 1e6, z: 1e6 });
  const coalSite = lone.sites.find(site => site.id === coalPile.id), coalSkin = coalSite.group.children[0].geometry.getAttribute('position');
  pass(lone, near(lone, coalSite));
  const x1 = coalSkin.getX(1), z1 = coalSkin.getZ(1), before = [coalSkin.getY(0), coalSkin.getY(1)];
  inView = (x, z) => Math.hypot(x - x1, z - z1) < 0.5;
  for (let i = 0; i < coalSkin.count / 32 + 2; i++) pass(lone, near(lone, coalSite));
  assert.ok(Math.abs(coalSkin.getY(1) - (before[1] - 0.4)) < 1e-4 && coalSkin.getY(0) === before[0] && coalSite.refits === 2, `a point with no probe near it is seated on the drawn mesh within some passes (${coalSkin.getY(1) - before[1]}, ${coalSite.refits})`);
  // Land that turns coarse under a seated pile (a jump away and back while the fine tiles are gone) hides it.
  let level = 8;
  const jumped = new Stockpiles(data, origin, { ...terrain, surfaceAt: (x, z) => ({ level, ground: ground(x, z) }), meshHeightAt: ground }, low);
  pass(jumped, { x: 1e6, z: 1e6 });
  for (const site of jumped.sites) { pass(jumped, near(jumped, site)); assert.ok(site.group.visible, 'seated and shown'); }
  level = 4;
  for (const site of jumped.sites) { pass(jumped, near(jumped, site)); assert.ok(!site.group.visible, 'a seated pile is hidden while the land under it is coarser than level 6'); }
  level = 8;
  for (const site of jumped.sites) { pass(jumped, near(jumped, site)); assert.ok(site.group.visible, 'and shown again on fine land'); }
}
console.log('PASS seating: coal skin, stack tops, wall feet and stub logs follow the drawn land; unchanged land and a turn of the view are not re-read');

// Land that is drawn under only part of a pile must not hide the whole pile.
const partial = new Stockpiles(data, origin, { ...terrain, surfaceAt: () => ({ level: 8, ground: 100 }), meshHeightAt: (x) => x > px ? null : 100 }, true);
pass(partial, { x: 1e6, z: 1e6 });
for (const site of partial.sites) { pass(partial, near(partial, site)); assert.ok(site.group.visible, 'offscreen terrain does not hide the whole pile'); }
// Land not loaded finely enough yet: the pile waits (hidden) and is not seated on a guess.
const waiting = new Stockpiles(data, origin, { ...terrain, surfaceAt: () => ({ level: 4, ground: 100 }), meshHeightAt: () => 100 }, false);
pass(waiting, { x: 1e6, z: 1e6 });
for (const site of waiting.sites) { pass(waiting, near(waiting, site)); assert.ok(!site.group.visible, 'a pile waits for land of level 6 or finer'); }
console.log('PASS partial and coarse land');
