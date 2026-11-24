// Verify baked bridge decks: codec (including misaligned Node Buffers), loader guards, work-root symlink refusal,
// PHONE_EXAG immunity, moved-span and disabled-streams fallback, rejected-record non-repetition, bit-for-bit equality
// against the runtime final-land solver across all six areas (all 240 spans plus required Mabou widened road 28),
// and rejected source mutants. Pass --codec-only for land-free clean-clone CI; pass --mutations for mutant proofs.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {build} from '../web/node_modules/esbuild/lib/main.js';
import * as THREE from '../web/node_modules/three/build/three.module.js';
import {assertSafeOutput, assertWorkRoot} from './bridge-decks-bake.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const areas = ['mabou', 'judique', 'porthood', 'westbay', 'pointtupper', 'cansocauseway'];
const areaBase = area => area === 'mabou' ? 'terrain' : `areas/${area}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

let bundleNonce = 0;
async function bundle(replacements = {}, withGround = false) {
  const result = await build({
    stdin: {
      contents: `
        export const __nonce = ${++bundleNonce};
        ${withGround ? "export {makeGround, preload} from './tools/phone-ground.mjs';" : ''}
        export {Roads} from './web/src/roads.ts';
        export {ModernBridges} from './web/src/modern-bridges.ts';
        export {mabouRoadOverrides} from './web/src/november-bridges.ts';
        export {NovemberRoadDetails} from './web/src/november-road-details.ts';
        export {encodeBridgeDecks, decodeBridgeDecks, loadBridgeDecks, hashStreams, BAKED_BRIDGE_EXAG, BAKED_BRIDGE_SEA_LEVEL} from './web/src/bridge-decks.ts';
        export {BRIDGE_DECK_ASSETS} from './web/src/bridge-decks-assets.ts';
        export {initStore} from './web/src/store.ts';
        export {readWalkPlan, restoreSelectedWalk} from './web/src/sidewalks-cache.ts';
      `,
      resolveDir: root,
    },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{
      name: 'variants',
      setup(b) {
        b.onResolve({filter: /^three$/}, () => ({path: pathToFileURL(resolve(root, 'web/node_modules/three/build/three.module.js')).href, external: true}));
        b.onResolve({filter: /three\/build\/three\.module\.js$/}, () => ({path: pathToFileURL(resolve(root, 'web/node_modules/three/build/three.module.js')).href, external: true}));
        b.onLoad({filter: /\.(mjs|ts)$/}, a => {
          const rel = a.path.slice(root.length + 1);
          if (rel in replacements) return {contents: replacements[rel], loader: 'ts'};
          if (rel === 'tools/phone-ground.mjs') {
            return {
              contents: readFileSync(a.path, 'utf8')
                .replace("const base = '../data/baked/terrain';", `const base = ${JSON.stringify(resolve(root, 'data/baked/terrain'))};`)
                .replace('Number(process.env.PHONE_EXAG??1.5)', '1.5'),
              loader: 'js',
            };
          }
        });
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

function spanBits(r) {
  const cellKeys = [...r.cells.keys()].sort((a, b) => a - b);
  const cellList = [];
  for (const k of cellKeys) cellList.push(k, -1, ...r.cells.get(k), -2);
  return Buffer.concat([
    r.triangles,
    r.triangleDeck,
    r.geometry.getAttribute('position').array,
    r.geometry.getAttribute('normal').array,
    r.geometry.getAttribute('color').array,
    ...(r.geometry.getAttribute('approach') ? [r.geometry.getAttribute('approach').array] : []),
    r.approachRanges,
    r.corridor,
    r.skinBox,
    new Float64Array([r.y0, r.y1, r.outer0, r.outer1, r.width, r.startLength, r.endLength, r.level, +r.narrowRail, +r.smoothStart, +r.smoothEnd]),
    new Int32Array(cellList),
  ].map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength)));
}

function testWorkRootGuard() {
  const tmp = mkdtempSync(join(tmpdir(), 'mmm-bridge-guard-'));
  try {
    const work = join(tmp, 'work'), outside = join(tmp, 'outside'), altSource = join(tmp, 'alt-checkout');
    mkdirSync(join(work, 'data/baked/areas'), {recursive: true});
    mkdirSync(outside, {recursive: true});
    mkdirSync(join(altSource, 'data/baked'), {recursive: true});
    mkdirSync(join(altSource, 'web/src'), {recursive: true});
    assertWorkRoot(work, altSource);
    assertSafeOutput(work, join(work, 'data/baked/terrain/bridge-decks.bin'), altSource);
    // A symlinked subdirectory inside workRoot must be rejected before any write.
    symlinkSync(outside, join(work, 'data/baked/areas/pointtupper'));
    assert.throws(() => assertSafeOutput(work, join(work, 'data/baked/areas/pointtupper/bridge-decks.bin'), altSource), /symlink/);
    assert.throws(() => assertWorkRoot(root), /isolated/);
    // Passing an alternate --source-root as --work-root (or writing into its baked/web trees) must be refused.
    assert.throws(() => assertWorkRoot(altSource, altSource), /isolated/);
    assert.throws(() => assertWorkRoot(join(altSource, 'data/baked'), altSource), /protected|primary or selected/);
    assert.throws(() => assertSafeOutput(altSource, join(altSource, 'data/baked/terrain/bridge-decks.bin'), altSource), /protected/);
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
}

async function testCodecAndLoader(replacements = {}) {
  const mod = await bundle(replacements);
  const sampleStreamsHash = mod.hashStreams({segments: new Float32Array([0, 0, 10, 0, 1.5])});
  const sample = [{
    chainKey: '1,2',
    geomHash: 0x123456789abcdef0n,
    landHash: 0x0fedcba987654321n,
    requestWidth: 4.05,
    finalWidth: 3.6,
    narrowRail: true,
    level: 7,
    smoothStart: true,
    smoothEnd: false,
    ponyTruss: true,
    startLength: 16,
    endLength: 24,
    y0: 10.125,
    y1: 11.25,
    outer0: 9.5,
    outer1: 10.5,
    rows: 2,
    columns: 1,
    gridY: new Float32Array([1, 2, 3, 4, 5, 6]),
    emitLand: new Float64Array([9.1, Number.NaN, 10.2]),
  }];
  const encoded = mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, sampleStreamsHash, [624000, 5103000], sample);
  // Test both misaligned Uint8Array AND misaligned Node Buffer (whose .slice() preserves byteOffset!).
  const shiftedU8 = new Uint8Array(encoded.length + 3);
  shiftedU8.set(encoded, 3);
  const shiftedBuf = Buffer.alloc(encoded.length + 3);
  Buffer.from(encoded).copy(shiftedBuf, 3);
  for (const input of [shiftedU8.subarray(3), shiftedBuf.subarray(3)]) {
    const decoded = mod.decodeBridgeDecks(input, 'mabou');
    assert.equal(decoded.area, 'mabou');
    assert.equal(decoded.exag, 1.5);
    assert.equal(decoded.seaLevel, -0.2);
    assert.equal(decoded.hasStreams, true);
    assert.equal(decoded.streamsHash, sampleStreamsHash);
    assert.deepEqual(decoded.village, [624000, 5103000]);
    assert.equal(decoded.spans.length, 1);
    const s = decoded.find('1,2', 4.05, true, 0x123456789abcdef0n);
    assert.ok(s, 'find matches requestWidth and geomHash');
    assert.equal(s.landHash, 0x0fedcba987654321n);
    assert.equal(decoded.find('1,2', 3.6, true, 0x123456789abcdef0n), s, 'find matches finalWidth');
    assert.equal(decoded.find('1,2', 4.05, false, 0x123456789abcdef0n), null, 'find distinguishes ponyTruss');
    assert.equal(decoded.find('1,2', 4.05, true, 0x1n), null, 'find rejects different geomHash');
    assert.equal(decoded.find('1,2', 4.9, true, 0x123456789abcdef0n), null, 'find rejects unbaked width');
    assert.deepEqual([...s.gridY], [1, 2, 3, 4, 5, 6]);
    assert.equal(s.emitLand[0], 9.1);
    assert.ok(Number.isNaN(s.emitLand[1]));
    assert.equal(s.emitLand[2], 10.2);
  }
  assert.throws(() => mod.decodeBridgeDecks(encoded, 'judique'), /area mismatch/);
  const badMagic = encoded.slice(); badMagic[0] ^= 1;
  assert.throws(() => mod.decodeBridgeDecks(badMagic, 'mabou'), /magic/);
  assert.throws(() => mod.decodeBridgeDecks(encoded.subarray(0, encoded.length - 4), 'mabou'), /Truncated/);
  assert.throws(() => mod.decodeBridgeDecks(Buffer.concat([encoded, Buffer.alloc(4)]), 'mabou'), /Trailing/);

  // Loader guards: non-default exag/seaLevel makes zero requests; missing/short/hash/stalled faults warn once with exact cause.
  const origFetch = globalThis.fetch, origWarn = console.warn;
  const requests = [], warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    let mode = 'good';
    let aborted = false;
    const synthetic = mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, sampleStreamsHash, [624000, 5103000], sample);
    const fakeAssets = `export interface BridgeDeckAsset {readonly file:string;readonly bytes:number;readonly sha256:string}
export const BRIDGE_DECK_ASSETS:Readonly<Record<string,BridgeDeckAsset|undefined>> = {mabou:{file:'bridge-decks.bin',bytes:${synthetic.length},sha256:'${sha(synthetic)}'}};`;
    const loaderMod = await bundle({...replacements, 'web/src/bridge-decks-assets.ts': fakeAssets});
    globalThis.fetch = async (url, init) => {
      requests.push(String(url));
      if (mode === 'missing') return new Response('missing', {status: 404});
      if (mode === 'short') return new Response(synthetic.subarray(0, synthetic.length - 1));
      if (mode === 'hash') { const b = synthetic.slice(); b[b.length - 1] ^= 1; return new Response(b); }
      if (mode === 'stalled') {
        init?.signal?.addEventListener('abort', () => { aborted = true; });
        return {ok: true, status: 200, blob: () => new Promise(() => {})};
      }
      return new Response(synthetic);
    };
    assert.equal(await loaderMod.loadBridgeDecks('mabou', 'terrain', 1.0, -0.2), null, 'exag=1.0 skips baked file');
    assert.equal(await loaderMod.loadBridgeDecks('mabou', 'terrain', 2.0, -0.2), null, 'exag=2.0 skips baked file');
    assert.equal(await loaderMod.loadBridgeDecks('mabou', 'terrain', 1.5, 0), null, 'non-default seaLevel skips baked file');
    assert.equal(requests.length, 0, 'non-default scale makes zero fetches');

    const ok = await loaderMod.loadBridgeDecks('mabou', 'terrain', 1.5, -0.2);
    assert.ok(ok && ok.spans.length === 1, 'valid asset loads and verifies');
    assert.deepEqual(requests, ['terrain/bridge-decks.bin']);
    assert.equal(warnings.length, 0);

    const expectedMsg = {missing: /404/, short: /length mismatch/, hash: /hash mismatch/, stalled: /timed out/};
    for (const fault of ['missing', 'short', 'hash', 'stalled']) {
      mode = fault; aborted = false;
      const freshMod = await bundle({...replacements, 'web/src/bridge-decks-assets.ts': fakeAssets});
      requests.length = 0; warnings.length = 0;
      const t0 = performance.now();
      const got = await Promise.race([
        freshMod.loadBridgeDecks('mabou', 'terrain', 1.5, -0.2, 40),
        new Promise((_, reject) => setTimeout(() => reject(new Error('stalled load hung past guard')), 300)),
      ]);
      const elapsed = performance.now() - t0;
      assert.equal(got, null, `fault ${fault} returns null`);
      assert.equal(warnings.length, 1, `fault ${fault} warns once`);
      assert.match(warnings[0], expectedMsg[fault], `fault ${fault} reports exact cause`);
      if (fault === 'stalled') {
        assert.ok(elapsed < 280, `stalled load resolved in ${elapsed.toFixed(1)} ms`);
        assert.equal(aborted, true, 'stalled load aborts underlying fetch');
      }
      assert.equal(await freshMod.loadBridgeDecks('mabou', 'terrain', 1.5, -0.2, 40), null, `repeat fault ${fault} returns null`);
      assert.equal(warnings.length, 1, `repeat fault ${fault} does not spam warnings`);
    }
  } finally {
    globalThis.fetch = origFetch;
    console.warn = origWarn;
  }

  // Synthetic ModernBridges hydration, geomHash/landHash/streamsHash binding, rejected-record stability, and fallback.
  let level = 5, bump = 0, localBump = 0;
  const height = (x, z) => {
    const base = z > 0 || z < -40 ? 10 + bump + x * .005 : Math.max(0, 10 - Math.min(-z, 40 + z) * 2);
    // Localized 2 m hump on the approach away from bank/quarter-span stations (tests full-grid landHash coverage).
    const hump = localBump && Math.abs(z - 11) <= 1.5 && Math.abs(x - 1.5) <= 1.5 ? localBump : 0;
    return base + hump;
  };
  const streamsA = {segments: new Float32Array([0, -20, 15, -20, 1.5])};
  const streamsB = {segments: new Float32Array([0, -20, 15, -19.5, 1.5])};
  const makeTerrain = (streams = null, village = [0, 0], manifestExtra = {}) => ({
    cartRoads: false, dataRevision: 1, seaLevel: -0.2, streams,
    manifest: {village, area: {id: 'mabou', name: 'Mabou'}, ...manifestExtra},
    heightAt: height,
    meshContactSource: () => 1,
    surfaceAt: (x, z) => ({ground: height(x, z), level, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 1, bridge: true, washboard: false}),
  });
  const roadList = [{id: 1, name: 'Fixture bridge', kind: 1, halfWidth: 3.6, bridge: true, pts: [[0, 0], [0, 40]]}];
  level = 7; bump = 0; localBump = 0;
  const refTerrain = makeTerrain(streamsA, [0, 0]);
  const refRoads = new mod.Roads({roads: roadList}, [0, 0], refTerrain, null);
  const refM = refRoads.modern;
  const proto = Object.getPrototypeOf(refM);
  let capGrid = null, capLand = [];
  const origEmit = proto.emit, origLand = proto.land;
  refM.emit = function(r, grid) {
    capGrid = new Float32Array(grid); capLand = [];
    this.land = (x, z) => { const h = origLand.call(this, x, z); capLand.push(h === null ? Number.NaN : h); return h; };
    try { return origEmit.call(this, r, grid); } finally { this.land = origLand; }
  };
  const refSpan = refM.spans[0];
  refM.ensure(refSpan);
  const refLandHash = refM.spanLandHash(refSpan, refSpan.startLength, refSpan.endLength, refSpan.width, refSpan.narrowRail, refSpan.level);
  assert.ok(refLandHash !== null, 'synthetic reference landHash computed');
  const gridY = new Float32Array(capGrid.length / 3);
  for (let i = 0; i < gridY.length; i++) gridY[i] = capGrid[i * 3 + 1];
  const coreRows = Math.ceil(refSpan.length);
  const record = {
    chainKey: refSpan.chainKey,
    geomHash: refSpan.geomHash,
    landHash: refLandHash,
    requestWidth: refSpan.width,
    finalWidth: refSpan.width,
    narrowRail: refSpan.narrowRail,
    level: refSpan.level,
    smoothStart: refSpan.smoothStart,
    smoothEnd: refSpan.smoothEnd,
    ponyTruss: false,
    startLength: refSpan.startLength,
    endLength: refSpan.endLength,
    y0: refSpan.y0,
    y1: refSpan.y1,
    outer0: refSpan.outer0,
    outer1: refSpan.outer1,
    rows: coreRows + refSpan.startLength + refSpan.endLength,
    columns: Math.ceil(2 * refSpan.width / .75),
    gridY,
    emitLand: new Float64Array(capLand),
  };
  const syntheticBaked = mod.decodeBridgeDecks(mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, mod.hashStreams(streamsA), [0, 0], [record]), 'mabou');

  level = 5; bump = 2;
  const t1 = makeTerrain(streamsA, [0, 0]);
  const bakedRoads = new mod.Roads({roads: roadList}, [0, 0], t1, syntheticBaked);
  const bakedM = bakedRoads.modern;
  let solverCalls = 0;
  bakedM.build = function(...args) { solverCalls++; return proto.build.apply(this, args); };
  const cam = new THREE.Vector3(0, 20, -20);
  bakedRoads.update(cam);
  assert.equal(bakedM.audit.builds, 0, 'level 5 waits for level-6 bank tiles');
  // At coarse level 6 (noisy coarse elevation), hydrate baked deck immediately and keep baked bank elevations.
  level = 6; t1.dataRevision++;
  bakedRoads.update(cam);
  assert.equal(bakedM.audit.builds, 1, 'level 6 hydrates baked deck once');
  assert.equal(bakedM.audit.bakedBuilds, 1, 'hydrated via baked path');
  assert.equal(solverCalls, 0, 'runtime grade solver never ran');
  assert.ok(spanBits(bakedM.spans[0]).equals(spanBits(refSpan)), 'synthetic baked deck is bit-for-bit identical to runtime solver');
  t1.dataRevision++;
  const banks = [0, 0];
  assert.equal(bakedRoads.bridgeBankElevations(1, banks), 7, 'bridgeBankElevations keeps baked level 7');
  assert.equal(banks[0], refSpan.y0, 'bridgeBankElevations keeps baked y0 without re-sampling coarse terrain');
  assert.equal(banks[1], refSpan.y1, 'bridgeBankElevations keeps baked y1 without re-sampling coarse terrain');

  // When final level-7 tiles arrive with matching ground (bump = 0), verify and lock baked deck with ZERO rebuilds.
  bump = 0; level = 7; t1.dataRevision++;
  bakedRoads.update(cam);
  assert.equal(bakedM.audit.builds, 1, 'matching final terrain verifies baked span with no rebuild');
  assert.equal(bakedM.spans[0].bakedVerified, true, 'baked span locked after matching final terrain');
  assert.equal(solverCalls, 0, 'solver still never ran');
  let probeCalls = 0;
  const origSurfaceAt = t1.surfaceAt;
  t1.surfaceAt = (x, z) => { probeCalls++; return origSurfaceAt(x, z); };
  t1.dataRevision++;
  bakedRoads.update(cam);
  t1.surfaceAt = origSurfaceAt;
  assert.equal(bakedM.audit.builds, 1, 'verified baked span does not rebuild on dataRevision bump');
  assert.equal(probeCalls, 0, 'verified baked span skips land probes on later revision bumps');

  // Unbaked width widening via bridgeWalks falls back cleanly to runtime solver.
  bakedRoads.bridgeWalks.set(1, {side: 1, width: 2});
  bakedRoads.update(cam);
  assert.equal(bakedM.audit.builds, 2, 'unbaked walk width falls back to runtime build');
  assert.equal(solverCalls, 1, 'fallback invokes runtime solver');

  // Terrain rebake (+2 m land bump) BEFORE first build at final level must reject stale baked deck and solve at 12.04 m.
  level = 7; bump = 2;
  const raisedTerrain = makeTerrain(streamsA, [0, 0]);
  const raisedRoads = new mod.Roads({roads: roadList}, [0, 0], raisedTerrain, syntheticBaked);
  raisedRoads.update(cam);
  assert.equal(raisedRoads.modern.audit.bakedBuilds, 0, 'raised terrain before first build rejects stale baked deck');
  assert.equal(raisedRoads.modern.audit.builds, 1, 'raised terrain falls back to live solver');
  assert.ok(Math.abs(raisedRoads.modern.spans[0].y0 - 12.04) < 1e-6, 'raised terrain uses live 12.04 m bank height');

  // Terrain rebake (+2 m land bump) discovered when fine tiles arrive AFTER level-6 hydration must reject and rebuild at 12.04 m.
  level = 6; bump = 0;
  const lateTerrain = makeTerrain(streamsA, [0, 0]);
  const lateRoads = new mod.Roads({roads: roadList}, [0, 0], lateTerrain, syntheticBaked);
  lateRoads.update(cam);
  assert.equal(lateRoads.modern.audit.bakedBuilds, 1, 'coarse level 6 hydrates initially');
  level = 7; bump = 2; lateTerrain.dataRevision++;
  lateRoads.update(cam);
  assert.equal(lateRoads.modern.audit.builds, 2, 'late terrain mismatch rebuilds via live solver');
  assert.ok(Math.abs(lateRoads.modern.spans[0].y0 - 12.04) < 1e-6, 'late terrain mismatch updates bank to live 12.04 m');

  // Local 2 m terrain rise on the approach (between bank/toe stations) must reject stale baked deck and solve live.
  level = 7; bump = 0; localBump = 2;
  const humpTerrain = makeTerrain(streamsA, [0, 0]);
  const humpRoads = new mod.Roads({roads: roadList}, [0, 0], humpTerrain, syntheticBaked);
  humpRoads.update(cam);
  assert.equal(humpRoads.modern.audit.bakedBuilds, 0, 'local approach hump rejects stale baked deck');
  assert.equal(humpRoads.modern.audit.builds, 1, 'local approach hump falls back to live solver');
  localBump = 0;

  // Synthetic 2 m ridge inside a deck triangle between grid vertices (e.g. (1.1, -0.25)) must be caught by CHECKS landHash.
  const ridgeTerrain = {
    ...makeTerrain(streamsA, [0, 0]),
    heightAt: (x, z) => height(x, z) + (Math.abs(x - 1.1) < 0.25 && Math.abs(z + 0.25) < 0.25 ? 2 : 0),
    surfaceAt: (x, z) => ({ground: height(x, z) + (Math.abs(x - 1.1) < 0.25 && Math.abs(z + 0.25) < 0.25 ? 2 : 0), level: 7, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 1, bridge: true, washboard: false}),
  };
  const ridgeRoads = new mod.Roads({roads: roadList}, [0, 0], ridgeTerrain, syntheticBaked);
  ridgeRoads.update(cam);
  assert.equal(ridgeRoads.modern.audit.bakedBuilds, 0, 'interior triangle ridge rejects stale baked deck');
  assert.equal(ridgeRoads.modern.audit.builds, 1, 'interior triangle ridge solves live');

  // Odd-column (11-column) span: a localized 2 m spike at its own -3 m bank centreline (x=0, z=3) must reject stale bake.
  const bank3Terrain = {
    ...makeTerrain(streamsA, [0, 0]),
    heightAt: (x, z) => height(x, z) + (Math.abs(x) < 0.2 && Math.abs(z - 3) < 0.2 ? 2 : 0),
    surfaceAt: (x, z) => ({ground: height(x, z) + (Math.abs(x) < 0.2 && Math.abs(z - 3) < 0.2 ? 2 : 0), level: 7, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 1, bridge: true, washboard: false}),
  };
  const bank3Roads = new mod.Roads({roads: roadList}, [0, 0], bank3Terrain, syntheticBaked);
  bank3Roads.update(cam);
  assert.equal(bank3Roads.modern.audit.bakedBuilds, 0, 'odd-column -3 m bank spike rejects stale baked deck');
  assert.ok(Math.abs(bank3Roads.modern.spans[0].y0 - 12.04) < 1e-6, 'odd-column -3 m bank spike solves at 12.04 m');

  // Interior per-column toe-slope sample (5 cm bump at s=-startLength-1, column j=3) must reject stale baked deck.
  const toeColX = -(3.6) + 2 * 3.6 * 3 / 11;
  const toeSlopeTerrain = {
    ...makeTerrain(streamsA, [0, 0]),
    heightAt: (x, z) => height(x, z) + (Math.abs(x - toeColX) < 0.15 && Math.abs(z - (refSpan.startLength + 1)) < 0.15 ? 0.05 : 0),
    surfaceAt: (x, z) => ({ground: height(x, z) + (Math.abs(x - toeColX) < 0.15 && Math.abs(z - (refSpan.startLength + 1)) < 0.15 ? 0.05 : 0), level: 7, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 1, bridge: true, washboard: false}),
  };
  const toeSlopeRoads = new mod.Roads({roads: roadList}, [0, 0], toeSlopeTerrain, syntheticBaked);
  toeSlopeRoads.update(cam);
  assert.equal(toeSlopeRoads.modern.audit.bakedBuilds, 0, 'interior toe-slope column change rejects stale baked deck');

  // Washboard bridge staged level-6 -> level-7 arrival: when final roadAlongAxis arrives, approach attribute refreshes
  // bit-for-bit without running the grade solver.
  const washRoadsList = [{id: 3, name: 'Mines Rd', kind: 3, halfWidth: 3.6, washboard: true, bridge: true, pts: [[0, 0], [0, 40]]}];
  let washAxis = [0.2, -0.9797958971132712];
  const makeWashTerrain = lv => ({
    cartRoads: false, dataRevision: 1, seaLevel: -0.2, streams: streamsA,
    manifest: {village: [0, 0], area: {id: 'mabou', name: 'Mabou'}},
    heightAt: height,
    meshContactSource: () => lv,
    roadAlongAxis: () => washAxis,
    surfaceAt: (x, z) => ({ground: height(x, z), level: lv, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 3, bridge: true, washboard: true}),
  });
  const wRefTerrain = makeWashTerrain(7);
  const wRefRoads = new mod.Roads({roads: washRoadsList}, [0, 0], wRefTerrain, null);
  const wRefM = wRefRoads.modern;
  let wGrid = null, wLand = [];
  wRefM.emit = function(r, grid) {
    wGrid = new Float32Array(grid); wLand = [];
    this.land = (x, z) => { const h = origLand.call(this, x, z); wLand.push(h === null ? Number.NaN : h); return h; };
    try { return origEmit.call(this, r, grid); } finally { this.land = origLand; }
  };
  const wRefSpan = wRefM.spans[0];
  wRefM.ensure(wRefSpan);
  const wGridY = new Float32Array(wGrid.length / 3);
  for (let i = 0; i < wGridY.length; i++) wGridY[i] = wGrid[i * 3 + 1];
  const wBaked = mod.decodeBridgeDecks(mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, mod.hashStreams(streamsA), [0, 0], [{
    chainKey: wRefSpan.chainKey, geomHash: wRefSpan.geomHash,
    landHash: wRefM.spanLandHash(wRefSpan, wRefSpan.startLength, wRefSpan.endLength, wRefSpan.width, wRefSpan.narrowRail, wRefSpan.level),
    requestWidth: wRefSpan.width, finalWidth: wRefSpan.width, narrowRail: wRefSpan.narrowRail, level: wRefSpan.level,
    smoothStart: wRefSpan.smoothStart, smoothEnd: wRefSpan.smoothEnd, ponyTruss: false,
    startLength: wRefSpan.startLength, endLength: wRefSpan.endLength, y0: wRefSpan.y0, y1: wRefSpan.y1, outer0: wRefSpan.outer0, outer1: wRefSpan.outer1,
    rows: Math.ceil(wRefSpan.length) + wRefSpan.startLength + wRefSpan.endLength, columns: Math.ceil(2 * wRefSpan.width / .75),
    gridY: wGridY, emitLand: new Float64Array(wLand),
  }]), 'mabou');
  let wStageLevel = 6;
  washAxis = [0, -1];
  const wRunTerrain = {
    ...makeWashTerrain(6),
    meshContactSource: () => wStageLevel,
    surfaceAt: (x, z) => ({ground: height(x, z), level: wStageLevel, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 3, bridge: true, washboard: true}),
  };
  const wRunRoads = new mod.Roads({roads: washRoadsList}, [0, 0], wRunTerrain, wBaked);
  let wSolves = 0;
  wRunRoads.modern.build = function(...args) { wSolves++; return proto.build.apply(this, args); };
  wRunRoads.update(cam);
  assert.equal(wRunRoads.modern.audit.bakedBuilds, 1, 'washboard bridge hydrates at level 6');
  wStageLevel = 7; washAxis = [0.2, -0.9797958971132712]; wRunTerrain.dataRevision++;
  wRunRoads.update(cam);
  assert.equal(wSolves, 0, 'washboard road-axis refresh never runs grade solver');
  assert.equal(wRunRoads.modern.spans[0].bakedVerified, true, 'washboard bridge verified after road-axis refresh');
  assert.ok(spanBits(wRunRoads.modern.spans[0]).equals(spanBits(wRefSpan)), 'washboard approach attribute matches final-land reference bit-for-bit after staged arrival');

  // Adding a perpendicular bridge across the approach changes global isSpan and must invalidate geomHash.
  const perpRoadsList = [
    ...roadList,
    {id: 2, name: 'Cross bridge', kind: 1, halfWidth: 3.6, bridge: true, pts: [[-10, -10], [10, -10]]},
  ];
  const perpRoads = new mod.Roads({roads: perpRoadsList}, [0, 0], makeTerrain(streamsA, [0, 0]), syntheticBaked);
  perpRoads.update(cam);
  assert.equal(perpRoads.modern.audit.bakedBuilds, 0, 'perpendicular crossing bridge invalidates geomHash');

  // Mixed-level manifest (bank tile max level 7, approach tile max level 9): withholding level 9 must NOT reject or falsely verify.
  const mixedManifest = {origin: [0, 0], size: 256 * 256, levels: {'7': ['0_0', '0_-1'], '9': ['0_0']}};
  let hasLevel9 = true;
  const mixedHeight = (x, z) => (z > 0 || z < -40 ? 10 + (z >= 0 && hasLevel9 ? 0.5 : 0) : Math.max(0, 10 - Math.min(-z, 40 + z) * 2));
  const makeMixedTerrain = () => ({
    cartRoads: false, dataRevision: 1, seaLevel: -0.2, streams: streamsA,
    manifest: {village: [0, 0], area: {id: 'mabou', name: 'Mabou'}, ...mixedManifest},
    heightAt: mixedHeight,
    meshContactSource: () => (hasLevel9 ? 2 : 1),
    surfaceAt: (x, z) => ({ground: mixedHeight(x, z), level: z >= 0 && hasLevel9 ? 9 : 7, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 1, bridge: true, washboard: false}),
  });
  const mRefTerrain = makeMixedTerrain();
  const mRefRoads = new mod.Roads({roads: roadList}, [0, 0], mRefTerrain, null);
  const mRefM = mRefRoads.modern;
  let mGrid = null, mLand = [];
  mRefM.emit = function(r, grid) {
    mGrid = new Float32Array(grid); mLand = [];
    this.land = (x, z) => { const h = origLand.call(this, x, z); mLand.push(h === null ? Number.NaN : h); return h; };
    try { return origEmit.call(this, r, grid); } finally { this.land = origLand; }
  };
  const mSpan = mRefM.spans[0];
  mRefM.ensure(mSpan);
  assert.equal(mSpan.level, 7, 'mixed-level bank min level is 7 while z>=0 tile is level 9');
  const mLandHash = mRefM.spanLandHash(mSpan, mSpan.startLength, mSpan.endLength, mSpan.width, mSpan.narrowRail, mSpan.level);
  assert.ok(mLandHash !== null, 'mixed-level bake landHash computed');
  const mGridY = new Float32Array(mGrid.length / 3);
  for (let i = 0; i < mGridY.length; i++) mGridY[i] = mGrid[i * 3 + 1];
  const mBaked = mod.decodeBridgeDecks(mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, mod.hashStreams(streamsA), [0, 0], [{
    chainKey: mSpan.chainKey, geomHash: mSpan.geomHash, landHash: mLandHash,
    requestWidth: mSpan.width, finalWidth: mSpan.width, narrowRail: mSpan.narrowRail, level: mSpan.level,
    smoothStart: mSpan.smoothStart, smoothEnd: mSpan.smoothEnd, ponyTruss: false,
    startLength: mSpan.startLength, endLength: mSpan.endLength, y0: mSpan.y0, y1: mSpan.y1, outer0: mSpan.outer0, outer1: mSpan.outer1,
    rows: Math.ceil(mSpan.length) + mSpan.startLength + mSpan.endLength, columns: Math.ceil(2 * mSpan.width / .75),
    gridY: mGridY, emitLand: new Float64Array(mLand),
  }]), 'mabou');
  hasLevel9 = false;
  const mRunTerrain = makeMixedTerrain();
  const mRunRoads = new mod.Roads({roads: roadList}, [0, 0], mRunTerrain, mBaked);
  mRunRoads.update(cam);
  assert.equal(mRunRoads.modern.audit.bakedBuilds, 1, 'withheld level-9 tile still hydrates valid bake');
  assert.equal(mRunRoads.modern.spans[0].bakedVerified, false, 'withheld level-9 tile stays pending verification');
  // Distant followed span (5 km away, touch=false) must NOT call surfaceAt on unchanged tile revisions.
  mRunRoads.modern.spans[0].followed = true;
  let farTouches = 0;
  const origMixedSurface = mRunTerrain.surfaceAt;
  mRunTerrain.surfaceAt = (x, z) => { farTouches++; return origMixedSurface(x, z); };
  for (let i = 0; i < 3; i++) { mRunTerrain.dataRevision++; mRunRoads.update(new THREE.Vector3(5000, 20, 0)); }
  mRunTerrain.surfaceAt = origMixedSurface;
  assert.equal(farTouches, 0, 'distant followed span makes zero touching surfaceAt calls while tile sources are unchanged');
  hasLevel9 = true; mRunTerrain.dataRevision++;
  mRunRoads.update(cam);
  assert.equal(mRunRoads.modern.audit.builds, 1, 'arriving level-9 tile verifies without rebuild');
  assert.equal(mRunRoads.modern.spans[0].bakedVerified, true, 'arriving level-9 tile locks bakedVerified');

  // Parallel crossing removal and late grade-separation must restore pre-hydration width and narrowRail.
  level = 7; bump = 0; localBump = 0;
  const parRoads = [
    {id: 10, name: 'Highway 104', kind: 1, halfWidth: 3.6, bridge: true, pts: [[0, 0], [0, 40]]},
    {id: 11, name: 'Railroad', kind: 5, halfWidth: 2.6, bridge: true, pts: [[4, 0], [4, 40]]},
  ];
  const parRefTerrain = makeTerrain(streamsA, [0, 0]);
  const parRef = new mod.Roads({roads: parRoads}, [0, 0], parRefTerrain, null);
  const parM = parRef.modern;
  const parInit = new Map(parM.spans.map(s => [s, s.width]));
  const parRecords = new Map();
  parM.emit = function(r, grid) {
    capGrid = new Float32Array(grid); capLand = [];
    this.land = (x, z) => { const h = origLand.call(this, x, z); capLand.push(h === null ? Number.NaN : h); return h; };
    try { return origEmit.call(this, r, grid); } finally { this.land = origLand; }
  };
  for (let pass = 0; pass < 3; pass++) {
    for (const s of parM.spans) {
      capGrid = null; capLand = [];
      parM.ensure(s);
      if (capGrid) {
        const gy = new Float32Array(capGrid.length / 3);
        for (let i = 0; i < gy.length; i++) gy[i] = capGrid[i * 3 + 1];
        parRecords.set(s, {
          chainKey: s.chainKey, geomHash: s.geomHash,
          landHash: parM.spanLandHash(s, s.startLength, s.endLength, s.width, s.narrowRail, s.level),
          requestWidth: parInit.get(s), finalWidth: s.width, narrowRail: s.narrowRail, level: s.level,
          smoothStart: s.smoothStart, smoothEnd: s.smoothEnd, ponyTruss: false,
          startLength: s.startLength, endLength: s.endLength, y0: s.y0, y1: s.y1, outer0: s.outer0, outer1: s.outer1,
          rows: Math.ceil(s.length) + s.startLength + s.endLength, columns: Math.ceil(2 * s.width / .75),
          gridY: gy, emitLand: new Float64Array(capLand),
        });
      }
    }
  }
  const railBakedWidth = parM.spans.find(s => s.road.id === 11).width;
  assert.equal(railBakedWidth, 1.25, 'parallel rail span narrows to 1.25 m when highway is present');
  const parBaked = mod.decodeBridgeDecks(mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, mod.hashStreams(streamsA), [0, 0], [...parRecords.values()]), 'mabou');
  // Now remove the parallel highway span: even at level 6, the lone rail span must NOT hydrate the stale 1.25 m narrowed deck.
  level = 6;
  const loneRailTerrain = makeTerrain(streamsA, [0, 0]);
  const loneRail = new mod.Roads({roads: [parRoads[1]]}, [0, 0], loneRailTerrain, parBaked);
  loneRail.update(cam);
  assert.equal(loneRail.modern.audit.bakedBuilds, 0, 'removed parallel highway rejects narrowed rail bake via geomHash');
  assert.equal(loneRail.modern.spans[0].width, 2.6 + 0.45, 'lone rail span keeps full 3.05 m half-width');

  // Hydrate parallel rail at level 6 (width narrows to 1.25, narrowRail=true), then reveal grade-separated highway bank at level 7.
  // Late rejection MUST restore pre-hydration width (3.05 m) and narrowRail (false) before running the live solver.
  let sepLevel = 6, sepShift = 0;
  const sepTerrain = {
    ...makeTerrain(streamsA, [0, 0]),
    heightAt: (x, z) => height(x, z) + (x < 2 ? sepShift : 0),
    surfaceAt: (x, z) => ({ground: height(x, z) + (x < 2 ? sepShift : 0), level: sepLevel, canopy: 0, roadDist: 0, halfWidth: 3.6, kind: 1, bridge: true, washboard: false}),
  };
  const sepRoads = new mod.Roads({roads: parRoads}, [0, 0], sepTerrain, parBaked);
  sepRoads.update(cam);
  const sepRail = sepRoads.modern.spans.find(s => s.road.id === 11);
  assert.equal(sepRail.width, 1.25, 'level-6 parallel rail hydrates narrowed 1.25 m initially');
  assert.equal(sepRail.narrowRail, true, 'level-6 parallel rail sets narrowRail=true initially');
  sepLevel = 7; sepShift = 2; sepTerrain.dataRevision++;
  sepRoads.update(cam);
  assert.equal(sepRail.baked, null, 'grade-separated parallel highway rejects narrowed rail bake via landHash');
  assert.equal(sepRail.width, 2.6 + 0.45, 'late parallel rejection restores full 3.05 m half-width');
  assert.equal(sepRail.narrowRail, false, 'late parallel rejection restores narrowRail=false');
  level = 7;

  // Stream content edit (same hasStreams=true, moved brook segment) must reject stale baked deck via streamsHash.
  level = 7; bump = 0;
  const editStreamTerrain = makeTerrain(streamsB, [0, 0]);
  const editStreamRoads = new mod.Roads({roads: roadList}, [0, 0], editStreamTerrain, syntheticBaked);
  editStreamRoads.update(cam);
  assert.equal(editStreamRoads.modern.audit.bakedBuilds, 0, 'edited streams reject stale baked deck via streamsHash');
  assert.equal(editStreamRoads.modern.audit.builds, 1, 'edited streams fall back to runtime solver');

  // Moved span (same id/width/length, shifted X) must reject baked entry via geomHash and solve at new bank height.
  level = 7; bump = 0;
  const movedTerrain = makeTerrain(streamsA, [0, 0]);
  const movedRoad = [{id: 1, name: 'Fixture bridge', kind: 1, halfWidth: 3.6, bridge: true, pts: [[100, 0], [100, 40]]}];
  const movedRoads = new mod.Roads({roads: movedRoad}, [0, 0], movedTerrain, syntheticBaked);
  movedRoads.update(new THREE.Vector3(100, 20, -20));
  assert.equal(movedRoads.modern.audit.bakedBuilds, 0, 'moved span rejects stale baked deck via geomHash');
  assert.equal(movedRoads.modern.audit.builds, 1, 'moved span falls back to runtime solver');
  assert.ok(Math.abs(movedRoads.modern.spans[0].y0 - (10 + 100 * .005 + .04)) < 1e-6, 'moved span uses live 10.54 m bank height');

  // Disabled streams (?brooks=0) must reject a stream-baked deck and solve in browser.
  const noStreamTerrain = makeTerrain(null, [0, 0]);
  const noStreamRoads = new mod.Roads({roads: roadList}, [0, 0], noStreamTerrain, syntheticBaked);
  noStreamRoads.update(cam);
  assert.equal(noStreamRoads.modern.audit.bakedBuilds, 0, 'disabled streams reject stream-baked deck');
  assert.equal(noStreamRoads.modern.audit.builds, 1, 'disabled streams fall back to runtime solver');

  // A rejected baked record (shortened emitLand) must NOT force repeated solves on later revision bumps with constant terrain.
  const shortBaked = mod.decodeBridgeDecks(mod.encodeBridgeDecks('mabou', 1.5, -0.2, true, mod.hashStreams(streamsA), [0, 0], [{...record, emitLand: new Float64Array(capLand.slice(0, 1))}]), 'mabou');
  const tBad = makeTerrain(streamsA, [0, 0]);
  const badRoads = new mod.Roads({roads: roadList}, [0, 0], tBad, shortBaked);
  badRoads.update(cam);
  assert.equal(badRoads.modern.audit.bakedBuilds, 0, 'short emitLand rejected');
  assert.equal(badRoads.modern.audit.builds, 1, 'short emitLand falls back once');
  for (let i = 0; i < 4; i++) { tBad.dataRevision++; badRoads.update(cam); }
  assert.equal(badRoads.modern.audit.builds, 1, 'rejected baked record does not force rebuilds on later revision bumps');

  return {syntheticSpans: 1};
}

async function testAllAreasRealLand(replacements = {}) {
  // Confirm PHONE_EXAG cannot affect baked verification either.
  const prevExag = process.env.PHONE_EXAG;
  process.env.PHONE_EXAG = '2';
  let mod;
  try { mod = await bundle(replacements, true); } finally {
    if (prevExag === undefined) delete process.env.PHONE_EXAG; else process.env.PHONE_EXAG = prevExag;
  }
  const workAt = process.argv.indexOf('--work-root');
  const dataRoot = workAt >= 0 ? resolve(process.argv[workAt + 1]) : root;
  const summary = [];
  for (const area of areas) {
    const asset = mod.BRIDGE_DECK_ASSETS[area];
    assert.ok(asset, `${area}: BRIDGE_DECK_ASSETS entry exists`);
    const binPath = resolve(dataRoot, 'data/baked', areaBase(area), asset.file);
    assert.ok(existsSync(binPath), `${area}: ${binPath} exists`);
    const rawBytes = readFileSync(binPath);
    assert.equal(rawBytes.length, asset.bytes, `${area}: installed byte length matches descriptor`);
    assert.equal(sha(rawBytes), asset.sha256, `${area}: installed SHA-256 matches descriptor`);
    const baked = mod.decodeBridgeDecks(rawBytes, area);
    assert.equal(baked.exag, mod.BAKED_BRIDGE_EXAG);
    assert.equal(baked.seaLevel, mod.BAKED_BRIDGE_SEA_LEVEL);

    const base = resolve(root, 'data/baked', areaBase(area));
    const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
    const roadData = JSON.parse(readFileSync(resolve(base, 'roads.json'), 'utf8'));
    const november = ['mabou', 'porthood', 'judique'].includes(area)
      ? new mod.NovemberRoadDetails(roadData.roads, area, manifest.village) : null;
    const roadLines = mod.mabouRoadOverrides(roadData.roads, true, area);
    const fullRoadData = {...roadData, roads: november?.added.length ? [...roadLines, ...november.added] : roadLines};

    const maxLevel = Math.max(8, ...Object.keys(manifest.levels ?? {}).map(Number));
    const {terrain: tRef} = mod.makeGround(base);
    assert.equal(tRef.exag, mod.BAKED_BRIDGE_EXAG, `${area}: reference terrain pinned to exag 1.5`);
    const refRoads = new mod.Roads(fullRoadData, manifest.village, tRef, null);
    const Mref = refRoads.modern;
    await mod.preload(tRef, Mref.spans.flatMap(r => r.pts), 120, maxLevel);
    for (const r of Mref.spans) Mref.ensure(r);
    for (let pass = 0; pass < 4; pass++) {
      const pending = Mref.spans.filter(r => r.forceBuild || r.revision === -1);
      if (!pending.length) break;
      for (const r of pending) Mref.ensure(r);
    }

    const {terrain: tBaked} = mod.makeGround(base);
    const bakedRoads = new mod.Roads(fullRoadData, manifest.village, tBaked, baked);
    const Mbaked = bakedRoads.modern;
    let solverCalls = 0;
    const proto = Object.getPrototypeOf(Mbaked);
    Mbaked.build = function(...args) { solverCalls++; return proto.build.apply(this, args); };
    await mod.preload(tBaked, Mbaked.spans.flatMap(r => r.pts), 120, maxLevel);
    const t0 = performance.now();
    for (const r of Mbaked.spans) Mbaked.ensure(r);
    const hydrateMs = performance.now() - t0;

    assert.equal(solverCalls, 0, `${area}: zero runtime solver calls`);
    assert.equal(Mbaked.audit.bakedBuilds, Mbaked.spans.length, `${area}: all ${Mbaked.spans.length} spans hydrated from baked file`);
    assert.equal(Mbaked.audit.builds, Mbaked.spans.length, `${area}: exactly one build per span`);
    const baseRefBits = Mref.spans.map(spanBits);
    for (let i = 0; i < Mbaked.spans.length; i++) {
      assert.equal(Mbaked.spans[i].bakedVerified, true, `${area} span ${Mbaked.spans[i].road.id}: final-level landHash verified`);
      assert.ok(spanBits(Mbaked.spans[i]).equals(baseRefBits[i]), `${area} span ${Mbaked.spans[i].road.id}: baked matches runtime final land bit-for-bit`);
    }

    tBaked.dataRevision++;
    for (const r of Mbaked.spans) Mbaked.ensure(r);
    assert.equal(Mbaked.audit.builds, Mbaked.spans.length, `${area}: no rebuilds after dataRevision bump`);

    // Require Mabou sidewalk-widened road 28 to be present, strictly widened, and hydrated bit-for-bit with zero solver calls.
    let widenedChecked = 0;
    const walkFile = resolve(base, 'sidewalks-desktop.json');
    if (area === 'mabou') assert.ok(existsSync(walkFile), 'mabou: sidewalks-desktop.json is required to verify widened road 28');
    if (existsSync(walkFile)) {
      const raw = JSON.parse(readFileSync(walkFile, 'utf8'));
      const areaData = JSON.parse(gunzipSync(Buffer.from(raw.payload, 'base64')));
      const plan = mod.readWalkPlan(areaData, false);
      const compiled = areaData.compiled?.[0];
      for (const id of compiled?.bridgeJobs ?? []) {
        const p = plan.pieces[id];
        if (!p) continue;
        refRoads.bridgeWalks.set(p.a.road.id, {side: 1, width: p.run.width + p.run.buffer});
        bakedRoads.bridgeWalks.set(p.a.road.id, {side: 1, width: p.run.width + p.run.buffer});
      }
      if (area === 'mabou') assert.ok(bakedRoads.bridgeWalks.has(28), 'mabou: road 28 must be in bridgeWalks');
      if (refRoads.bridgeWalks.size) {
        const beforeWidths = new Map(Mbaked.spans.map(s => [s, s.width]));
        const beforeBakedBuilds = Mbaked.audit.bakedBuilds;
        Mref.update(new THREE.Vector3(0, 20, 0));
        Mbaked.update(new THREE.Vector3(0, 20, 0));
        for (const [id] of refRoads.bridgeWalks) {
          const rA = Mref.spans.find(s => s.members.has(id));
          const rB = Mbaked.spans.find(s => s.members.has(id));
          assert.ok(rA && rB, `${area}: walked bridge ${id} exists`);
          Mref.ensure(rA); Mbaked.ensure(rB);
          assert.equal(solverCalls, 0, `${area}: walked bridge ${id} hydrates without solver`);
          assert.ok(spanBits(rB).equals(spanBits(rA)), `${area}: walked bridge ${id} matches bit-for-bit`);
          if (rB.width > beforeWidths.get(rB)) {
            assert.equal(rB.bakedVerified, true, `${area}: widened bridge ${id} landHash verified`);
            widenedChecked++;
          } else if (area === 'mabou' && id === 28) {
            assert.fail(`mabou road 28 width did not increase: ${beforeWidths.get(rB)} -> ${rB.width}`);
          }
        }
        if (widenedChecked > 0) {
          assert.equal(Mbaked.audit.bakedBuilds, beforeBakedBuilds + widenedChecked, `${area}: widened spans hydrated via baked path`);
        }
      }
    }
    if (area === 'mabou') assert.ok(widenedChecked > 0, 'mabou: widened Highway 19 bridge road 28 must be checked');

    // Verify withholding level-8 tiles on real land (e.g. Mabou 46/96, West Bay -100077) does not falsely reject valid bakes.
    if (area === 'mabou' || area === 'westbay') {
      const {terrain: tStaged} = mod.makeGround(base);
      const stagedRoads = new mod.Roads(fullRoadData, manifest.village, tStaged, baked);
      const Mstaged = stagedRoads.modern;
      let stagedSolves = 0;
      Mstaged.build = function(...args) { stagedSolves++; return proto.build.apply(this, args); };
      await mod.preload(tStaged, Mstaged.spans.flatMap(r => r.pts), 120, 7);
      for (const r of Mstaged.spans) Mstaged.ensure(r);
      assert.equal(stagedSolves, 0, `${area}: level-7 arrival never falsely rejects baked decks`);
      assert.equal(Mstaged.audit.bakedBuilds, Mstaged.spans.length, `${area}: all spans hydrate at level 7`);
      await mod.preload(tStaged, Mstaged.spans.flatMap(r => r.pts), 120, maxLevel);
      tStaged.dataRevision++;
      for (const r of Mstaged.spans) Mstaged.ensure(r);
      assert.equal(stagedSolves, 0, `${area}: level-8 arrival after level-7 never solves`);
      for (let i = 0; i < Mstaged.spans.length; i++) {
        assert.equal(Mstaged.spans[i].bakedVerified, true, `${area} span ${Mstaged.spans[i].road.id}: verified after staged level-8 arrival`);
        assert.ok(spanBits(Mstaged.spans[i]).equals(baseRefBits[i]), `${area} span ${Mstaged.spans[i].road.id}: staged arrival matches final-land reference bit-for-bit (including approach)`);
      }
      for (const t of tStaged.tiles.values()) { t.mesh?.geometry.dispose(); t.mesh?.material.dispose(); }
      tStaged.tiles.clear(); tStaged.roadCuts.dispose();
    }

    summary.push({area, spans: Mbaked.spans.length, widenedChecked, bytes: rawBytes.length, hydrateMs: Number(hydrateMs.toFixed(1))});
    for (const t of [...tRef.tiles.values(), ...tBaked.tiles.values()]) { t.mesh?.geometry.dispose(); t.mesh?.material.dispose(); }
    tRef.tiles.clear(); tBaked.tiles.clear();
    tRef.roadCuts.dispose(); tBaked.roadCuts.dispose();
  }
  return summary;
}

const codecOnly = process.argv.includes('--codec-only');
testWorkRootGuard();
console.log('PASS work-root symlink guard');
console.log('PASS codec and loader', await testCodecAndLoader());
if (!codecOnly) {
  console.log('PASS all six areas bit-for-bit', await testAllAreasRealLand());
}

if (process.argv.includes('--mutations')) {
  const decksFile = 'web/src/bridge-decks.ts';
  const decksSrc = readFileSync(resolve(root, decksFile), 'utf8');
  const bridgesFile = 'web/src/modern-bridges.ts';
  const bridgesSrc = readFileSync(resolve(root, bridgesFile), 'utf8');
  for (const [name, file, src, from, to, error] of [
    ['exag guard removed', decksFile, decksSrc, 'if (exag !== BAKED_BRIDGE_EXAG || seaLevel !== BAKED_BRIDGE_SEA_LEVEL) return null;', '', /exag=1\.0 skips baked file|zero fetches/],
    ['hash check removed', decksFile, decksSrc, "if (hash !== asset.sha256) throw new Error('Bridge deck asset hash mismatch');", '', /fault hash returns null/],
    ['length check removed', decksFile, decksSrc, "if (blob.size !== asset.bytes) throw new Error('Bridge deck asset length mismatch');", '', /reports exact cause|length mismatch/],
    ['timeout guard removed', decksFile, decksSrc, 'return await Promise.race([load, timeout]);', 'timeout.catch(() => {}); return await load;', /stalled load hung/],
    ['misaligned Buffer slice bug restored', decksFile, decksSrc, 'Uint8Array.from(input)', 'input.slice()', /multiple of|RangeError/],
    ['streams guard removed', bridgesFile, bridgesSrc, 'if(!!this.terrain.streams!==decks.hasStreams||this.terrainStreamsHash()!==decks.streamsHash)return false;', '', /edited streams reject|disabled streams reject/],
    ['streamsHash check removed', bridgesFile, bridgesSrc, '||this.terrainStreamsHash()!==decks.streamsHash', '', /edited streams reject/],
    ['geomHash check removed', decksFile, decksSrc, 's.geomHash === geomHash && ', '', /moved span rejects|rejects different geomHash/],
    ['nearby spans omitted from geomHash', bridgesFile, bridgesSrc, 'const others=[...nearby].sort((a,b)=>a.chainKey<b.chainKey?-1:a.chainKey>b.chainKey?1:0);', 'const others:Span[]=[];', /perpendicular crossing bridge invalidates|removed parallel highway rejects/],
    ['parallel banks omitted from landHash', bridgesFile, bridgesSrc, 'const partners=[...r.parallel].sort((a,b)=>a.chainKey<b.chainKey?-1:a.chainKey>b.chainKey?1:0);\n      for(const q of partners){', 'const partners:Span[]=[];\n      for(const q of partners){', /grade-separated parallel highway rejects/],
    ['late parallel rejection keeps narrowed width', bridgesFile, bridgesSrc, 'r.width=r.bakedPrevWidth;r.narrowRail=r.bakedPrevNarrowRail;', '', /late parallel rejection restores/],
    ['interior CHECKS omitted from landHash', bridgesFile, bridgesSrc, 'const memoRow=4*columns+1,memoX=new Float64Array(5*memoRow),memoZ=new Float64Array(memoX.length),memoState=new Uint8Array(memoX.length);\n      for(let i=i0;i<i1;i++)for(let j=0;j<columns;j++){', 'const memoRow=4*columns+1,memoX=new Float64Array(5*memoRow),memoZ=new Float64Array(memoX.length),memoState=new Uint8Array(memoX.length);\n      for(let i=i0;i<i0;i++)for(let j=0;j<columns;j++){', /interior triangle ridge rejects/],
    ['centreline bank probes omitted from landHash', bridgesFile, bridgesSrc, 'for(let s=-startLength-1;s<=0;s++){const p=this.at(r,s);if(!sample(p.x,p.z))return null;}', '', /odd-column -3 m bank spike rejects/],
    ['per-column toe-slope probes omitted from landHash', bridgesFile, bridgesSrc, 'for(let j=0;j<=columns;j++){const u=-width+2*width*j/columns;if(!sample(p.x+p.nx*u,p.z+p.nz*u))return null;}', 'for(const side of[-1,0,1])if(!sample(p.x+p.nx*side*width,p.z+p.nz*side*width))return null;', /interior toe-slope column change rejects/],
    ['washboard road axis refresh omitted', bridgesFile, bridgesSrc, 'if(this.washAxisHash(r)===r.bakedWashHash){r.bakedVerified=true;return;}', 'r.bakedVerified=true;return;', /washboard approach attribute matches/],
    ['distant followed span touches tiles', bridgesFile, bridgesSrc, 'if(!touch&&!this.probesChanged(r,false))return;', '', /zero touching surfaceAt calls/],
    ['probeTargetLevel capped at 8', bridgesFile, bridgesSrc, 'const top=Math.max(this.manifestMaxLevel,fallbackLevel);', 'const top=Math.max(8,fallbackLevel);', /withheld level-9 tile/],
    ['first-build landHash check removed', bridgesFile, bridgesSrc, 'if(liveHash!==null&&liveHash!==entry.landHash){this.rejectedBaked.add(entry);r.baked=null;r.bakedVerified=false;return false;}', '', /raised terrain before first build rejects/],
    ['late landHash check removed', bridgesFile, bridgesSrc, 'if(liveHash===r.baked.landHash){\n        if(this.washAxisHash(r)===r.bakedWashHash){r.bakedVerified=true;return;}\n        if(this.tryHydrateBaked(r,touch))return;\n      }', 'r.bakedVerified=true;return;', /late terrain mismatch rebuilds/],
    ['rejectedBaked tracking removed', bridgesFile, bridgesSrc, 'if(!entry||this.rejectedBaked.has(entry)){', 'if(!entry){', /does not force rebuilds/],
    ['verified baked fast-path removed', bridgesFile, bridgesSrc, 'if(r.baked&&r.bakedVerified&&!r.forceBuild&&r.baked.finalWidth===r.width)return;', '', /skips land probes/],
    ['bridgeBankElevations ignores baked flag', bridgesFile, bridgesSrc, 'if(built&&(r.baked||r.level>=8||r.revision===rev)){', 'if(built&&(r.level>=8||r.revision===rev)){', /bridgeBankElevations keeps baked (level|y0)/],
    ['gridY read corrupted', bridgesFile, bridgesSrc, 'grid[k+1]=entry.gridY[v];', 'grid[k+1]=entry.gridY[v]+0.01;', /bit-for-bit/],
  ]) {
    assert.equal(src.split(from).length, 2, `one mutation anchor: ${name}`);
    await assert.rejects(() => testCodecAndLoader({[file]: src.replace(from, to)}), error, `${name} must fail`);
    console.log('KILLED', name);
  }
}
