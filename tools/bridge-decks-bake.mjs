// Bake final-land modern bridge deck geometry for all six areas at the default scale (exag 1.5, seaLevel -0.2).
// Writes only into an explicit isolated --work-root via atomic replacement; never writes through symlinks or into live data/baked or web/src.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, realpathSync, existsSync, lstatSync, renameSync, unlinkSync} from 'node:fs';
import {resolve, dirname, basename, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {build} from '../web/node_modules/esbuild/lib/main.js';

export const areas = ['mabou', 'judique', 'porthood', 'westbay', 'pointtupper', 'cansocauseway'];
export const areaBase = area => area === 'mabou' ? 'terrain' : `areas/${area}`;
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function protectedRoots(sourceRoot = root) {
  const real = p => {
    const tail = [];
    while (!existsSync(p)) { tail.unshift(basename(p)); p = dirname(p); }
    return resolve(realpathSync(p), ...tail);
  };
  const gitPrimary = dir => {
    try {
      return dirname(resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim()));
    } catch { return null; }
  };
  const roots = [root, resolve(sourceRoot)];
  for (const dir of [...roots]) {
    const p = existsSync(dir) ? gitPrimary(dir) : null;
    if (p) roots.push(p);
  }
  const list = [];
  for (const dir of roots) {
    const baked = real(resolve(dir, 'data/baked'));
    list.push(baked, resolve(dirname(baked), 'site'), resolve(dir, 'data/site'), resolve(dir, 'web'));
  }
  return {
    real,
    repoReals: [...new Set(roots.map(real))],
    list: [...new Set(list.map(real))],
  };
}

const inside = (p, base) => p === base || p.startsWith(base + '/');

export function assertWorkRoot(workRoot, sourceRoot = root) {
  const {real, repoReals, list} = protectedRoots(sourceRoot);
  const absRoot = resolve(workRoot);
  if (existsSync(absRoot)) assert.ok(!lstatSync(absRoot).isSymbolicLink(), 'work root must not be a symlink');
  const target = real(absRoot);
  for (const repoReal of repoReals) {
    assert.notEqual(target, repoReal, 'bridge-decks bake needs an isolated --work-root');
  }
  for (const output of [target, real(resolve(absRoot, 'data/baked')), real(resolve(absRoot, 'web/src'))]) {
    for (const protectedPath of list) {
      assert.ok(!inside(output, protectedPath), 'work root must not write primary or selected baked/site/source destinations');
    }
  }
}

/** Verify no path component inside workRoot is a symlink and the resolved target lies inside workRoot and outside all protected roots. */
export function assertSafeOutput(workRoot, dest, sourceRoot = root) {
  const {real, list} = protectedRoots(sourceRoot);
  const absRoot = resolve(workRoot), absDest = resolve(dest);
  const rel = relative(absRoot, absDest);
  assert.ok(rel && !rel.startsWith('..') && rel !== '.', `output ${absDest} escapes work root ${absRoot}`);
  let cur = absRoot;
  if (existsSync(cur)) assert.ok(!lstatSync(cur).isSymbolicLink(), `work root must not be a symlink: ${cur}`);
  for (const part of rel.split(sep)) {
    cur = resolve(cur, part);
    if (existsSync(cur)) assert.ok(!lstatSync(cur).isSymbolicLink(), `refusing to write through symlink: ${cur}`);
  }
  const realRoot = real(absRoot), realDest = real(absDest);
  assert.ok(inside(realDest, realRoot), `resolved output ${realDest} escapes work root ${realRoot}`);
  for (const protectedPath of list) {
    assert.ok(!inside(realDest, protectedPath), `resolved output ${realDest} enters protected path ${protectedPath}`);
  }
}

function writeAtomic(workRoot, dest, body, sourceRoot = root) {
  assertSafeOutput(workRoot, dest, sourceRoot);
  mkdirSync(dirname(dest), {recursive: true});
  assertSafeOutput(workRoot, dest, sourceRoot);
  const tmp = resolve(dirname(dest), `.${basename(dest)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`);
  assertSafeOutput(workRoot, tmp, sourceRoot);
  try {
    writeFileSync(tmp, body);
    renameSync(tmp, dest);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    throw err;
  }
}

async function loadRuntime(sourceRoot) {
  const result = await build({
    stdin: {
      contents: `
        export {makeGround, preload} from './tools/phone-ground.mjs';
        export {Roads} from './web/src/roads.ts';
        export {mabouRoadOverrides} from './web/src/november-bridges.ts';
        export {NovemberRoadDetails} from './web/src/november-road-details.ts';
        export {encodeBridgeDecks, decodeBridgeDecks, hashStreams, BAKED_BRIDGE_EXAG, BAKED_BRIDGE_SEA_LEVEL} from './web/src/bridge-decks.ts';
        export {readWalkPlan, restoreSelectedWalk} from './web/src/sidewalks-cache.ts';
      `,
      resolveDir: sourceRoot,
    },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{
      name: 'three-ext',
      setup(b) {
        b.onResolve({filter: /^three$/}, () => ({path: pathToFileURL(resolve(sourceRoot, 'web/node_modules/three/build/three.module.js')).href, external: true}));
        b.onResolve({filter: /three\/build\/three\.module\.js$/}, () => ({path: pathToFileURL(resolve(sourceRoot, 'web/node_modules/three/build/three.module.js')).href, external: true}));
        b.onLoad({filter: /\/tools\/phone-ground\.mjs$/}, a => {
          const src = readFileSync(a.path, 'utf8');
          const exagAnchor = 'Number(process.env.PHONE_EXAG??1.5)';
          assert.equal(src.split(exagAnchor).length, 2, 'phone-ground.mjs exag anchor');
          return {
            contents: src
              .replace("const base = '../data/baked/terrain';", `const base = ${JSON.stringify(resolve(sourceRoot, 'data/baked/terrain'))};`)
              .replace(exagAnchor, '1.5'),
            loader: 'js',
          };
        });
      },
    }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

function sidewalkBridgeReservations(mod, base) {
  const walkSets = [];
  for (const quality of ['desktop', 'low']) {
    const file = resolve(base, `sidewalks-${quality}.json`);
    if (!existsSync(file)) continue;
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    const unpacked = JSON.parse(gunzipSync(Buffer.from(raw.payload, 'base64')));
    const areaData = quality === 'low' ? mod.restoreSelectedWalk(unpacked) : unpacked;
    const low = quality === 'low';
    const plan = mod.readWalkPlan(areaData, low);
    const compiled = areaData.compiled?.[low ? 1 : 0];
    if (!compiled?.bridgeJobs?.length) continue;
    const walks = new Map();
    for (const id of compiled.bridgeJobs) {
      const p = plan.pieces[id];
      if (!p) continue;
      walks.set(p.a.road.id, {side: 1, width: p.run.width + p.run.buffer});
    }
    if (walks.size) walkSets.push(walks);
  }
  return walkSets;
}

export async function bakeArea(mod, sourceRoot, area) {
  const base = resolve(sourceRoot, 'data/baked', areaBase(area));
  const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
  const roadData = JSON.parse(readFileSync(resolve(base, 'roads.json'), 'utf8'));
  const november = ['mabou', 'porthood', 'judique'].includes(area)
    ? new mod.NovemberRoadDetails(roadData.roads, area, manifest.village) : null;
  const roadLines = mod.mabouRoadOverrides(roadData.roads, true, area);
  const fullRoadData = {...roadData, roads: november?.added.length ? [...roadLines, ...november.added] : roadLines};

  const {terrain} = mod.makeGround(base);
  assert.equal(terrain.exag, mod.BAKED_BRIDGE_EXAG, `${area}: terrain exag must be ${mod.BAKED_BRIDGE_EXAG}, got ${terrain.exag}`);
  assert.equal(terrain.seaLevel, mod.BAKED_BRIDGE_SEA_LEVEL, `${area}: terrain seaLevel must be ${mod.BAKED_BRIDGE_SEA_LEVEL}, got ${terrain.seaLevel}`);
  const hasStreams = !!terrain.streams;
  const streamsHash = mod.hashStreams(terrain.streams);
  const roads = new mod.Roads(fullRoadData, manifest.village, terrain, null);
  const M = roads.modern;
  assert.ok(M, `${area}: ModernBridges created`);
  const maxLevel = Math.max(8, ...Object.keys(manifest.levels ?? {}).map(Number));
  await mod.preload(terrain, M.spans.flatMap(r => r.pts), 120, maxLevel);

  const proto = Object.getPrototypeOf(M);
  const origEmit = proto.emit;
  const origLand = proto.land;
  let capturedGrid = null;
  let capturedLand = null;
  M.emit = function(r, grid) {
    capturedGrid = new Float32Array(grid);
    capturedLand = [];
    const self = this;
    this.land = function(x, z) {
      const h = origLand.call(self, x, z);
      capturedLand.push(h === null ? Number.NaN : h);
      return h;
    };
    try {
      return origEmit.call(this, r, grid);
    } finally {
      this.land = origLand;
    }
  };

  // Record each span's initial width before parallel narrowing.
  const initWidths = new Map(M.spans.map(r => [r, r.width]));
  const latestBySpan = new Map();
  const runEnsure = r => {
    capturedGrid = null; capturedLand = null;
    M.ensure(r);
    if (capturedGrid) {
      const landHash = M.spanLandHash(r, r.startLength, r.endLength, r.width, r.narrowRail, r.smoothStart, r.smoothEnd, r.y0, r.y1, r.level);
      assert.ok(landHash !== null, `${area} span ${r.road.id}: final-level land hash probes must all be loaded`);
      const count = capturedGrid.length / 3;
      const gridY = new Float32Array(count);
      for (let i = 0; i < count; i++) gridY[i] = capturedGrid[i * 3 + 1];
      const coreRows = Math.ceil(r.length);
      latestBySpan.set(r, {
        chainKey: r.chainKey,
        geomHash: r.geomHash,
        landHash,
        requestWidth: initWidths.get(r),
        finalWidth: r.width,
        narrowRail: r.narrowRail,
        level: r.level,
        smoothStart: r.smoothStart,
        smoothEnd: r.smoothEnd,
        ponyTruss: !!r.road.ponyTruss,
        startLength: r.startLength,
        endLength: r.endLength,
        y0: r.y0,
        y1: r.y1,
        outer0: r.outer0,
        outer1: r.outer1,
        rows: coreRows + r.startLength + r.endLength,
        columns: Math.ceil(2 * r.width / .75),
        gridY,
        emitLand: new Float64Array(capturedLand),
      });
    }
  };

  // Pass 1 builds every span; pass 2 settles any partner span narrowed by r.parallel.
  for (const r of M.spans) runEnsure(r);
  for (let pass = 0; pass < 4; pass++) {
    const pending = M.spans.filter(r => r.forceBuild || r.revision === -1);
    if (!pending.length) break;
    for (const r of pending) runEnsure(r);
  }
  assert.equal(latestBySpan.size, M.spans.length, `${area}: every span solved on final land`);

  const entries = [...latestBySpan.values()];
  const seenKey = new Set(entries.map(e => `${e.chainKey}|${e.requestWidth}|${e.ponyTruss}|${e.geomHash}`));

  // Bake sidewalk-widened variants (e.g. Mabou Highway 19 bridge road 28).
  for (const walks of sidewalkBridgeReservations(mod, base)) {
    for (const r of M.spans) {
      if (r.parallel.length) continue;
      let need = initWidths.get(r);
      for (const [id, half] of r.halves) {
        const w = walks.get(id);
        if (w) need = Math.max(need, half + w.width + .3);
      }
      if (need <= r.width) continue;
      const k = `${r.chainKey}|${need}|${!!r.road.ponyTruss}|${r.geomHash}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      initWidths.set(r, need);
      r.width = need; r.forceBuild = true; r.revision = -1;
      runEnsure(r);
      entries.push(latestBySpan.get(r));
    }
  }

  for (const t of terrain.tiles.values()) { t.mesh?.geometry.dispose(); t.mesh?.material.dispose(); }
  terrain.tiles.clear();
  for (const r of M.spans) r.geometry?.dispose();
  terrain.roadCuts.dispose();

  const bytes = mod.encodeBridgeDecks(area, terrain.exag, terrain.seaLevel, hasStreams, streamsHash, manifest.village, entries);
  const decoded = mod.decodeBridgeDecks(bytes, area);
  assert.equal(decoded.spans.length, entries.length, `${area}: decoded span count`);
  assert.equal(decoded.hasStreams, hasStreams, `${area}: decoded stream flag`);
  assert.equal(decoded.streamsHash, streamsHash, `${area}: decoded stream hash`);
  return {area, bytes: Buffer.from(bytes), spanCount: entries.length, baseSpanCount: M.spans.length};
}

export async function bakeAll(sourceRoot, workRoot) {
  assertWorkRoot(workRoot, sourceRoot);
  const mod = await loadRuntime(sourceRoot);
  const files = [], assets = {};
  for (const area of areas) {
    const result = await bakeArea(mod, sourceRoot, area);
    const file = 'bridge-decks.bin';
    const relPath = `data/baked/${areaBase(area)}/${file}`;
    const dest = resolve(workRoot, relPath);
    writeAtomic(workRoot, dest, result.bytes, sourceRoot);
    const descriptor = {file, bytes: result.bytes.length, sha256: sha(result.bytes)};
    assets[area] = descriptor;
    files.push({area, path: relPath, spans: result.spanCount, baseSpans: result.baseSpanCount, ...descriptor});
  }
  const ts = '// Generated by tools/bridge-decks-bake.mjs. Payload updates require a reviewed source change.\n' +
    'export interface BridgeDeckAsset {readonly file:string;readonly bytes:number;readonly sha256:string}\n' +
    'export const BRIDGE_DECK_ASSETS:Readonly<Record<string,BridgeDeckAsset|undefined>> = ' + JSON.stringify(assets, null, 2) + ';\n';
  writeAtomic(workRoot, resolve(workRoot, 'web/src/bridge-decks-assets.ts'), ts, sourceRoot);
  return {files, assets};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srcAt = process.argv.indexOf('--source-root');
  const sourceRoot = srcAt >= 0 ? resolve(process.argv[srcAt + 1]) : root;
  const guardAt = process.argv.indexOf('--assert-work-root');
  if (guardAt >= 0) {
    assert.ok(process.argv[guardAt + 1], 'guard needs a work root');
    const wr = resolve(process.argv[guardAt + 1]);
    assertWorkRoot(wr, sourceRoot);
    for (const area of areas) assertSafeOutput(wr, resolve(wr, 'data/baked', areaBase(area), 'bridge-decks.bin'), sourceRoot);
    assertSafeOutput(wr, resolve(wr, 'web/src/bridge-decks-assets.ts'), sourceRoot);
    assertSafeOutput(wr, resolve(wr, 'bridge-decks-manifest.json'), sourceRoot);
    console.log('PASS isolated work root; no output written');
    process.exit(0);
  }
  const at = process.argv.indexOf('--work-root');
  assert.ok(at >= 0 && process.argv[at + 1], 'explicit --work-root is required; no live baked/site writes');
  const workRoot = resolve(process.argv[at + 1]);
  const {files} = await bakeAll(sourceRoot, workRoot);
  writeAtomic(workRoot, resolve(workRoot, 'bridge-decks-manifest.json'), JSON.stringify({sourceRoot, exag: 1.5, seaLevel: -0.2, files}, null, 2) + '\n', sourceRoot);
  console.log(JSON.stringify({workRoot, files}, null, 2));
}
