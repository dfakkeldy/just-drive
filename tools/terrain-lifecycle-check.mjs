import { readBaseline } from './baseline-source.mjs';
// Node only. Production Terrain/Trees, controlled time and I/O; no renderer, network or tile copies.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import * as THREE from '../web/node_modules/three/build/three.module.js';
const startedAt = Date.now();
const root = fileURLToPath(new URL('../', import.meta.url));
const terrainSource = readFileSync(`${root}web/src/terrain.ts`, 'utf8');
const treeSource = readFileSync(`${root}web/src/trees.ts`, 'utf8');
// Main 883363c36c63aad7fd821ae2624609aca6751cfe, before the build queue.
// Immutable receipts, not wall-clock costs: updates are [cold, east, independent west];
// reads are [400m laps, 1.2km laps, 3km drive]. --record can reproduce the arrivals/reads.
const BEFORE = {
  LOW: { updates: [49, 10, 28], reads: [23, 113, 179] },
  desktop: { updates: [63, 10, 35], reads: [20, 97, 165] },
};
const selectionEvent = 'if(t.contactFrame!==this.frame-1||t.contactPart!==part)this.contactTile(t);';
const selectionReset = 'if (this.cartRoads) { for (let i = 0; i < this.contactSelected.length; i++) this.contactSelected[i].contactFrame = this.frame - 1; this.contactSelected.length = 0; }';
const selectionGone = 'if(this.cartRoads)for(let i=0;i<this.contactPrevious.length;i++){const t=this.contactPrevious[i];if(t.contactFrame!==this.frame)this.contactTile(t);}';
const mutations = {
  'era-no-selection-event': ['terrain', selectionEvent, '', 'era-burst'],
  'era-no-revisit-reset': ['terrain', selectionReset, '', 'era-burst'],
  // Move the loop, retaining the reset, rather than deleting both mechanisms.
  'era-early-deselection': ['terrain', selectionGone, '', 'era-burst'],
  'queue-bound-ignored': ['terrain', /this.active \+ this.builds.length(?= [<>]=? MAX_LOADS)/g, 'this.active', 'cold-bound'],
  'car-rank-camera-only': ['terrain', 'const rank = under ? 0 :', 'const rank = (cam.z >= t.z0 && cam.z < t.z0 + t.size && cam.x >= t.x0 && cam.x < t.x0 + t.size) ? 0 :', 'car-order'],
  'interior-quiet-unconditional': ['main', 'quiet = loaded && terrain.pending === 0 ? quiet + 1 : 0;', 'quiet++;', 'interior-quiet'],
  'burst-never-ends': ['terrain', 'if (this.pending === 0) this.bursting = false;', '', 'burst'],
  'burst-no-jump': ['terrain', 'Math.hypot(cam.x - this.focusX, cam.y - this.focusY, cam.z - this.focusZ) > BURST_DISTANCE', 'false', 'burst-camera'],
  'burst-small-step': ['terrain', 'BURST_DISTANCE = 150', 'BURST_DISTANCE = 0.1', 'burst'],
  'burst-no-budget': ['terrain', 'performance.now() - started >= budgetMs', 'false', 'burst'],
  'new-column-unprotected': ['terrain', 'if (bestUnder) this.use(t);', '', 'builds'],
  'two-builds': ['terrain', 'built >= 1', 'built >= 2', 'builds'],
  'decoded-not-pending': ['terrain', '+ this.builds.length;', ';', 'builds'],
  'evict-queued': ['terrain', 'let excess = this.readyCount', 'for (const d of this.builds) this.tiles.delete(`${d.tile.level}/${d.tile.i}_${d.tile.j}`);\n    let excess = this.readyCount', 'builds'],
  'unwanted-count-leak': ['terrain', 'if (t.lastUsed === this.frame) this.use(t);', 'this.use(t);', 'builds'],
  'failed-zero': ['terrain', 'if (t.failed && t.wanted === this.frame) n++', 'if (false) n++', 'retry'],
  'cache-disabled': ['terrain', 'SPARE_CAP = 96', 'SPARE_CAP = 0', 'cache'],
  'evict-all-aged': ['terrain', 'if (excess <= 0) break;', '', 'cache'],
  'spare-cap-ignored': ['terrain', 'if (excess <= 0) break;', 'break;', 'cache'],
  'grace-zero': ['terrain', 'TILE_GRACE = 600', 'TILE_GRACE = 0', 'cache'],
  'level-guard-removed': ['terrain', 't.level > 2 &&', '', 'cache'],
  'mesh-left-in-group': ['terrain', 'this.group.remove(t.mesh!);', '', 'cache'],
  'mask-left-in-scene': ['terrain', 'this.maskScene.remove(t.mask);', '', 'cache'],
  'dispose-skipped': ['terrain', 'geo.dispose();', 'void geo;', 'cache'],
  'dispose-twice': ['terrain', 'geo.dispose();', 'geo.dispose(); geo.dispose();', 'cache'],
  'shared-noRoad-disposed': ['terrain', 'if (mat.uniforms.tRoad.value !== this.noRoad)', 'if (true)', 'cache'],
  'shared-noBrook-disposed': ['terrain', 'if (mat.uniforms.tBrook.value !== this.noBrook)', 'if (true)', 'cache'],
  'child-unprotected': ['terrain', 'this.use(c); kids.push(c);', 'kids.push(c);', 'cache'],
  'camera-unprotected': ['terrain', 'cam.x >= t.x0 && cam.x < t.x0 + t.size && cam.z >= t.z0 && cam.z < t.z0 + t.size ||', 'false ||', 'cache'],
  'body-unprotected': ['terrain', 'body && body.x >= t.x0 && body.x < t.x0 + t.size && body.z >= t.z0 && body.z < t.z0 + t.size', 'false', 'cache'],
  'lru-ignored': ['terrain', 'this.spare.sort((a, b) => a.lastUsed - b.lastUsed);', '', 'cache'],
  'query-unprotected': ['terrain', '{ this.use(t); return t; }', '{ return t; }', 'cache'],
  'scan-every-frame': ['terrain', 'EVICT_INTERVAL = 30', 'EVICT_INTERVAL = 1', 'cache'],
  // PR #150: a small site (the yard dog) skips tiles coarser than its maxTexel, so it allocates no road texture there.
  'site-texel-ignored': ['terrain', ' && (s.maxTexel === undefined || t.size / T <= s.maxTexel)', '', 'site-texel'],
  'trees-without-fine-wait': ['trees', 'if ((this.terrain.surfaceAt(x0 + TILE / 2, z0 + TILE / 2)?.level ?? -1) < 8) return;', '', 'tree-wait'],
};
const realBase = `${root}data/baked/terrain`;
const haveReal = existsSync(`${realBase}/8`) && readdirSync(`${realBase}/8`).some(n => /^\d+_\d+\.png$/.test(n));
const worker = process.argv.indexOf('--worker');
// Each worker runs under a heap cap, an RSS cap and a time limit. A failing strict assert on a big typed array or
// texture builds its diff outside the V8 heap (a 264k-element array passed 15 GB RSS in 30 s with a 1 GB heap cap),
// so the RSS watchdog is the real bound. A stopped worker is an ERROR that fails the run, mutant or not: a memory
// blow-up says nothing about whether a rule detects the fault, so a mutant is KILLED only by a failed assertion.
const WORKER_HEAP_MB = Number(process.env.LIFECYCLE_WORKER_HEAP_MB || 4096);
const WORKER_RSS_MB = Number(process.env.LIFECYCLE_WORKER_RSS_MB || 6144);
const WORKER_SECONDS = Number(process.env.LIFECYCLE_WORKER_SECONDS || 450);
function rssMb(pid) {
  try { return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024; } catch {}
  try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024 || 0; } catch { return 0; }
}
function runWorker(name, scenario) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [`--max-old-space-size=${WORKER_HEAP_MB}`, fileURLToPath(import.meta.url), '--worker', name, scenario], { cwd: root });
    const started = Date.now(), out = { stdout: '', stderr: '' };
    let runaway = null, peak = 0;
    for (const k of ['stdout', 'stderr']) { child[k].setEncoding('utf8'); child[k].on('data', d => { if (out[k].length < 2 ** 20) out[k] += d; else if (!out[k].endsWith('[truncated]\n')) out[k] += '\n[truncated]\n'; }); }
    let exited = false;
    const stop = why => { if (!runaway && !exited) { runaway = why; child.kill('SIGKILL'); } };
    const timer = setInterval(() => {
      const rss = rssMb(child.pid); peak = Math.max(peak, rss);
      if (rss > WORKER_RSS_MB) stop(`RSS ${rss.toFixed(0)} MB > ${WORKER_RSS_MB} MB`);
      else if (Date.now() - started > WORKER_SECONDS * 1000) stop(`over ${WORKER_SECONDS} s`);
    }, 100);
    // Stop polling at exit, before 'close': the pid may be reused once the child is gone.
    child.on('exit', () => { exited = true; clearInterval(timer); });
    child.on('error', e => { exited = true; clearInterval(timer); resolve({ stdout: '', stderr: String(e), status: null, signal: null, runaway: `spawn failed: ${e.message}`, peak, seconds: (Date.now() - started) / 1000 }); });
    child.on('close', (status, signal) => {
      clearInterval(timer);
      const heapOut = /heap out of memory|Reached heap limit/.test(out.stderr) ? `heap over ${WORKER_HEAP_MB} MB` : null;
      resolve({ ...out, status, signal, runaway: runaway ?? heapOut, peak, seconds: (Date.now() - started) / 1000 });
    });
  });
}
if (worker < 0) {
  const cases = process.argv.includes('--record') ? [['before', 'arrival'], ['before', 'laps']] : [['current', 'synthetic'], ['current', 'builds-20'], ['current', 'burst'], ['current', 'car-order']];
  // Assert current behavior against fixed receipts, rather than replay frozen revisions
  // against themselves. Historical workers remain available via --worker and --record.
  if (haveReal && !process.argv.includes('--record')) cases.push(['current', 'costs'], ['current', 'arrival'], ['current', 'era-burst'], ['current', 'jump-drive'], ['current', 'laps'], ['current', 'trees-low-5'], ['current', 'trees-low-700'], ['current', 'trees-desktop-5'], ['current', 'trees-desktop-700']);
  else if (!haveReal) console.log('SKIP real Mabou: data/ has no baked Mabou tiles');
  if (process.argv.includes('--mutations')) for (const [name, [, , , scenario]] of Object.entries(mutations)) cases.push([name, scenario]);
  for (const [name, scenario] of cases) {
    // Workers release their arrays on exit; bundles stay in memory, not a disk cache.
    const r = await runWorker(name, scenario);
    if (process.env.LIFECYCLE_WORKER_PEAK) console.log(`WORKER ${name}/${scenario} peak RSS ${r.peak.toFixed(0)} MB, ${r.seconds.toFixed(0)} s`);
    if (r.runaway) {
      process.stdout.write(`--- ${name}/${scenario} stdout (tail)\n${r.stdout.slice(-4096)}\n--- stderr (tail)\n${r.stderr.slice(-4096)}\n`);
      console.log(`ERROR ${name}/${scenario}: worker stopped (${r.runaway}); a mutant counts as KILLED only by a failed assertion`);
      process.exit(1);
    }
    assert.equal(r.signal, null, `${name}/${scenario} crashed: ${r.stderr}`);
    if (!mutations[name]) {
      process.stdout.write(r.stdout + r.stderr); assert.equal(r.status, 0, `${name}/${scenario}`);

    }
    else {
      assert.equal(r.status, 1, `${name} must fail assertions: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /AssertionError/, `${name} must fail a lifecycle assertion`);
      const eraFailure = {
        'era-no-selection-event': 'source changes covered',
        'era-no-revisit-reset': 'contactSelected has no duplicates after revisit',
        'era-early-deselection': 'final deselection emits the removed tile box',
      }[name];
      if (eraFailure) assert.ok(r.stderr.includes(`AssertionError [ERR_ASSERTION]: ${eraFailure}`), `${name} must fail its contact assertion`);
      console.log(`KILLED ${name} by ${scenario}: ${r.stderr.split('\n').find(l => l.includes('AssertionError'))}`);
    }
  }
  console.log('LIFECYCLE_SECONDS '+((Date.now()-startedAt)/1000).toFixed(2));
  process.exit(0);
}
const name = process.argv[worker + 1], scenario = process.argv[worker + 2];
let terrainText = terrainSource, treesText = treeSource, mainText = readFileSync(`${root}web/src/main.ts`, 'utf8');
// Pre-cache main oracle. The rejected first pass made 780 LOW / 640 desktop PNG reads on the 400 m laps.
if (name === 'first-pass') terrainText = readBaseline('terrain-first-pass','web/src/terrain.ts');
if (name === 'before') terrainText = readBaseline('terrain-before','web/src/terrain.ts');
if (name === 'main') terrainText = readBaseline('terrain-before-streaming','web/src/terrain.ts');
// Stress twenty simultaneous completions with a wider I/O window only in this in-memory test.
if (scenario === 'builds-20') terrainText = terrainText.replace('MAX_LOADS = 6', 'MAX_LOADS = 20');
if (mutations[name]) {
  const [file, from, to] = mutations[name], source = file === 'terrain' ? terrainText : file === 'main' ? mainText : treesText;
  if(from instanceof RegExp)assert.equal([...source.matchAll(from)].length,2,`both pump bounds mutated ${name}`);
  else assert.equal(source.split(from).length, 2, `unique mutation ${name}`);
  const changed=source.replace(from,to);
  if(file==='terrain')terrainText=changed;else if(file==='main')mainText=changed;else treesText=changed;
  if(name==='era-early-deselection') {
    const firstVisit='    this.visit(0, 0, 0, camera.position);';
    assert.equal(terrainText.split(firstVisit).length,2,'unique first visit for early loop');
    terrainText=terrainText.replace(firstVisit,`${firstVisit}\n    ${selectionGone}`);
  }
}
const bundle = await build({ stdin: { contents: "export {Terrain} from './web/src/terrain.ts'; export {Trees} from './web/src/trees.ts'; export {Streams} from './web/src/streams.ts'; export {potholeDensity} from './web/src/defects.ts';", resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent', plugins: [{ name: 'in-memory-source', setup(b) {
    b.onResolve({ filter: /^three$/ }, () => ({ path: pathToFileURL(`${root}web/node_modules/three/build/three.module.js`).href, external: true }));
    b.onLoad({ filter: /\/terrain\.ts$/ }, () => ({ contents: terrainText, loader: 'ts' }));
    b.onLoad({ filter: /\/trees\.ts$/ }, () => ({ contents: treesText, loader: 'ts' }));
  } }] });
const { Terrain, Trees, Streams, potholeDensity } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let now = 0, failedReads = new Set(), heldTrees = false, heldPaths = new Set(), reads = new Map(), releases = [], real = false;
Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
// Count height AND road PNG requests, as in the review; tree binaries are counted separately.
const terrainReads = () => [...reads].filter(([p]) => /\/\d+\/\d+_\d+(?:\.r)?\.png$/.test(p)).reduce((n, [, v]) => n + v, 0);
const treeReads = () => [...reads].filter(([p]) => p.endsWith('.t.bin')).reduce((n, [, v]) => n + v, 0);
globalThis.fetch = async path => {
  path = String(path); reads.set(path, (reads.get(path) ?? 0) + 1);
  if (failedReads.has(path)) throw Error('controlled read failure');
  if (heldPaths.has(path) || heldTrees && path.endsWith('.t.bin')) await new Promise(resolve => releases.push(resolve));
  if (real) return new Response(readFileSync(path));
  if (path.endsWith('.t.bin')) {
    const buf = new ArrayBuffer(8), v = new DataView(buf);
    v.setUint16(0, 30000, true); v.setUint16(2, 40000, true); v.setUint8(4, 50); v.setUint8(5, 10); v.setUint8(6, 1);
    return new Response(buf);
  }
  return { ok: true, blob: async () => ({ path }) };
};

// Same PNG decoding rules as the existing phone-ground Node adapter.
function png(bytes) {
  const chunks=[]; let w,h,channels;
  for(let o=8;o<bytes.length;){const n=bytes.readUInt32BE(o),type=bytes.toString('ascii',o+4,o+8),p=bytes.subarray(o+8,o+8+n);o+=12+n;
    if(type==='IHDR'){w=p.readUInt32BE(0);h=p.readUInt32BE(4);assert.equal(p[8],8);channels=p[9]===2?3:p[9]===6?4:0;assert.ok(channels);assert.equal(p[12],0);}
    if(type==='IDAT')chunks.push(p);
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=w*channels,decoded=new Uint8Array(stride*h),pixels=new Uint8ClampedArray(w*h*4);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++)for(let x=0;x<stride;x++){
    const k=y*stride+x,a=x>=channels?decoded[k-channels]:0,b=y?decoded[k-stride]:0,c=y&&x>=channels?decoded[k-stride-channels]:0,f=raw[y*(stride+1)];
    assert.ok(f<=4);decoded[k]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][f])&255;
  }
  for(let i=0;i<w*h;i++){pixels[i*4]=decoded[i*channels];pixels[i*4+1]=decoded[i*channels+1];pixels[i*4+2]=decoded[i*channels+2];pixels[i*4+3]=channels===4?decoded[i*channels+3]:255;}
  return {pixels,width:w,height:h,close(){}};
}
let roadFlag = 3;   // the synthetic road fields' kind and flag byte (gravelDriveway changes it)
globalThis.createImageBitmap = async blob => {
  if (real) return png(Buffer.from(await blob.arrayBuffer()));
  const { path } = blob, road = path.endsWith('.r.png');
  const pixels = new Uint8ClampedArray(new ArrayBuffer(257 * 257 * 4 + 16), 8, 257 * 257 * 4);
  for (let y = 0; y < 257; y++) for (let x = 0; x < 257; x++) {
    const k = (y * 257 + x) * 4;
    pixels[k] = road ? 12 : 0; pixels[k + 1] = road ? 30 : 10 + (x + y) % 9;
    pixels[k + 2] = road ? roadFlag : 10 + (x * 3 + y) % 40; pixels[k + 3] = 255;
  }
  return { pixels, close() {} };
};
globalThis.OffscreenCanvas = class { getContext() { let bitmap; return { drawImage(b) { bitmap = b; }, getImageData() { return { data: bitmap.pixels }; } }; } };
function manifest(depth = 5) {
  const levels = {};
  for (let l = 0; l <= depth; l++) {
    levels[l] = [];
    for (let j = 0; j < 2 ** l; j++) for (let i = 0; i < 2 ** l; i++) levels[l].push(`${i}_${j}`);
  }
  return { origin: [0, 0], village: [0, 0], size: 8192, tile: 256, levels,
    height: { scale: 1, offset: -20 }, canopy: { scale: .1 }, seaFloor: -100,
    cover: { file: 'cover.png', xmin: 0, ymin: -8192, xmax: 8192, ymax: 0, res: 1 },
    roads: { file: '', levels: { 5: levels[5]?.filter((_, k) => k % 2) ?? [] }, encoding: { distance: .1, halfWidth: .05 } } };
}
function ground(low = true, m = manifest()) { const t = new Terrain(m, 'synthetic', {}, 1, 0); t.low = low; return t; }
function camera(x = 128, z = 128, y = 10) {
  const c = new THREE.PerspectiveCamera(51, 1.5, .1, 60000); c.position.set(x, y, z); c.lookAt(x + 20, y - 1, z); c.updateMatrixWorld(); return c;
}
const load = (t, tile) => t.loadNow(tile.level, tile.i, tile.j);
const key = t => `${t.level}/${t.i}_${t.j}`;
const ready = t => [...t.tiles.values()].filter(tile => tile.ready);
function stats(t) {
  const all = ready(t), wanted = all.filter(q => q.countedFrame === t.frame).length;
  if (name === 'current' || mutations[name]) { assert.equal(t.readyCount, all.length, 'READY counter'); assert.equal(t.wantedCount, wanted, 'wanted counter'); assert.equal(t.pending, t.queue.length + [...t.tiles.values()].filter(q=>q.loading).length, 'pending recount'); assert.ok(t.active+t.builds.length <= (scenario==='builds-20'?20:6),'in-flight reads plus decoded tiles never exceed six'); }
  return { ready: all.length, wanted, spare: all.length - wanted };
}
function watch(t, tile, audits) {
  if (tile.road) {
    const data = tile.mesh.material.uniforms.tRoad.value.image.data;
    if (data.buffer === tile.road.buffer) {
      assert.equal(data.byteOffset, tile.road.byteOffset, 'road view offset');
      assert.equal(data.byteLength, tile.road.byteLength, 'road view length');
    } else {
      // Only a tile with a gravel driveway draws a copy, and only those texels differ: drawn as a gravel road (kind 3).
      assert.equal(data.length, tile.road.length, 'drawn road copy length');
      let drawn = 0;
      for (let k = 0; k < data.length; k++) if (data[k] !== tile.road[k]) {
        assert.ok(k % 4 === 2 && (tile.road[k] & 207) === 68 && data[k] === ((tile.road[k] & 48) | 3), 'only a gravel driveway texel is drawn differently, as a gravel road');
        drawn++;
      }
      assert.ok(drawn > 0, 'road CPU/texture share bytes unless the tile draws a gravel driveway');
    }
  }
  let audit = audits.get(tile);
  if (!audit) {
    audit = { tile, mesh: tile.mesh, mask: tile.mask, objects: new Map() }; audits.set(tile, audit);
    for (const shared of [t.noRoad, t.noBrook, t.uniforms.tCover.value]) if (!shared.watched) {
      shared.watched = true; shared.addEventListener('dispose', () => assert.fail('shared texture disposed'));
    }
  }
  const objects = [tile.mesh.geometry, tile.mesh.material, tile.mesh.material.uniforms.tNormal.value];
  for (const [field, fallback] of [['tRoad', t.noRoad], ['tBrook', t.noBrook]]) if (tile.mesh.material.uniforms[field].value !== fallback) objects.push(tile.mesh.material.uniforms[field].value);
  if (tile.mask) objects.push(tile.mask.material);
  if (tile.mirror) objects.push(tile.mirror.geometry, tile.mirror.material);
  for (const object of objects) if (!audit.objects.has(object)) {
    const record = { n: 0 }; audit.objects.set(object, record);
    object.addEventListener('dispose', () => {
      record.n++;
      assert.ok(t.frame - tile.lastUsed > 600, 'nothing used within grace may be disposed');
      assert.equal(tile.mesh.visible, false, 'drawn tile may not be evicted');
      assert.notEqual(tile.countedFrame, t.frame, 'queried/pinned tile may not be evicted');
      if (object.isBufferGeometry) {
        assert.equal(object.index, null, 'shared index detached'); assert.equal(object.getAttribute('uv'), undefined, 'shared uv detached');
        if (object !== audit.mesh.geometry) assert.equal(Object.keys(object.attributes).length, 0, 'mirror attributes detached');
      }
    });
  }
}
function auditEvicted(t, audits) {
  for (const [tile, a] of audits) if (!tile.ready) {
    assert.equal(t.group.children.includes(a.mesh), false, 'evicted mesh removed from terrain.group');
    if (a.mask) assert.equal(t.maskScene.children.includes(a.mask), false, 'evicted mask removed from maskScene');
    for (const r of a.objects.values()) assert.equal(r.n, 1, 'owned resource disposed exactly once');
    for (const f of ['mesh', 'mask', 'mirror', 'ground', 'canopy', 'road', 'brook']) assert.equal(tile[f], null, `released ${f}`);
  } else for (const r of a.objects.values()) assert.equal(r.n, 0, 'live resource retained');
}
async function tick(t, c, n = 1) { for (let i = 0; i < n; i++) { t.update(c); stats(t); await flush(); now += 16; } }
async function settle(t, c, extra = 0, updateTrees = null, startMode = false) {
  let quiet = 0, prev = -1;
  for (let i = 0; i < 1000; i++) {
    // Car-height camera tracks the production height samples as the quadtree refines.
    if (real) { c.position.y = (t.heightAt(c.position.x, c.position.z) ?? 0) + 2.2; c.lookAt(c.position.x + 20, c.position.y - 1, c.position.z); c.updateMatrixWorld(); }
    t.update(c, startMode); stats(t); updateTrees?.(); await flush(); now += 16;
    const n = ready(t).length;
    quiet = t.pending === 0 && prev === n ? quiet + 1 : 0; prev = n;
    if (quiet >= 4 + extra) return;
  }
  assert.fail('land did not settle');
}
async function retry() {
  failedReads = new Set(['synthetic/0/0_0.png']); const t = ground(), c = camera();
  const warn = console.warn; console.warn = () => {};
  try {
    await tick(t, c); assert.equal(t.pending, 0); assert.equal(t.failed, 1, 'back-off count');
    const main = readFileSync(`${root}web/src/main.ts`, 'utf8');
    const context = { loaded: true, terrain: t, sidewalks: null, grass: null, trees: null, mode: 'drive', demo: 0, drove: 0, pendingShot: null, camera: c, vehicle: { speed: 0 }, relief: { busy: false }, placesWaiting: () => false, quiet: 21 };
    const evaluate = expression => Function(...Object.keys(context), `return (${expression});`)(...Object.values(context));
    assert.equal(evaluate(main.match(/const waiting = ([\s\S]*?);/)[1]), false, 'network failure must not reset quiet');
    assert.equal(evaluate(main.match(/const qualityReady = ([^;]+);/)[1]), true, 'network failure must not blame the Full detail trial');
    const gates = [...main.matchAll(/page\.ready\(([^;]+)\);/g)]; assert.equal(gates.length, 2);
    for (const [, gate] of gates) assert.equal(evaluate(gate), false, 'tools must not report settled with wanted failures');
    const rootTile = t.tiles.get('0/0_0');
    for (let i = 0; i < 3; i++) { now = rootTile.retryAt - 1; await tick(t, c); assert.equal(t.failed, 1); now = rootTile.retryAt; await tick(t, c); assert.equal(t.failed, 1); }
    failedReads.clear(); heldPaths.add('synthetic/0/0_0.png'); now = rootTile.retryAt;
    t.update(c); assert.equal(t.failed, 0); assert.equal(t.pending, 1);
    for (const [, gate] of gates) assert.equal(evaluate(gate), false, 'retry just started: tools must not use the previous loaded state');
    heldPaths.clear(); for (const release of releases) release(); releases = []; await flush();
    assert.equal(t.failed, 0);
    assert.equal(t.pending, 1, 'decoded root stays pending');
    assert.equal(t.wantedCount, 0, 'decoded root is not ready');
    t.update(c); stats(t); await flush();
    failedReads = new Set(['1/0_0', '1/1_0', '1/0_1', '1/1_1'].map(k => `synthetic/${k}.png`));
    await tick(t, c); assert.equal(t.failed, 4); await tick(t, camera(-100000, -100000)); assert.equal(t.failed, 0, 'unwanted failures clear');
    await tick(t, c); assert.equal(t.failed, 4); failedReads.clear(); now += 30001; await tick(t, c); assert.equal(t.failed, 0);
    console.log('PASS retries: pending stays 0 in back-off; failed 1/4 -> unwanted 0 -> wanted 4 -> success 0; quality stays eligible, both tools gates wait');
  } finally { console.warn = warn; failedReads.clear(); }
}
async function cache(low) {
  const t = ground(low), cap = 96, audits = new Map();
  // Real quadtree split (1.6), 256 queried leaves: the wanted set is deliberately larger than both caps.
  for (let l = 0; l <= 4; l++) for (const n of t.manifest.levels[l]) { const [i, j] = n.split('_').map(Number); await load(t, t.tile(l, i, j)); }
  t.frame = 700; t.wantedCount = 0;
  for (const tile of ready(t)) if (tile.level === 4) t.heightAt(tile.x0 + 128, tile.z0 + 128);
  assert.ok(stats(t).wanted >= 256, 'several hundred wanted tiles');
  const wanted = ready(t).filter(q => q.countedFrame === t.frame);
  const originalCoarse = ready(t).filter(q => q.level <= 2);
  t.evict(); for (const q of originalCoarse) assert.ok(q.ready, 'level <=2 never evicted');
  for (const q of wanted) assert.ok(q.ready, 'no wanted tile evicted');
  // Fill cold, unqueried spares with mixed road/no-road tiles and desktop mask/mirror aliases.
  const cold = [];
  for (let i = 0; cold.length < cap + 20; i++) { if (i === 33) continue; const tile = t.tile(5, i % 32, Math.floor(i / 32)); await load(t, tile); cold.push(tile); }
  // Build mirror aliases through production code, then age all test spares consistently.
  if (!low) { t.frustum.intersectsBox = () => true; t.visit(0, 0, 0, new THREE.Vector3(128, 0, 128)); t.withReflection(camera(), new THREE.Vector3(128, 0, 128), () => {}); }
  t.frame = 800; t.wantedCount = 0;
  for (const q of ready(t)) { q.mesh.visible = false; q.lastUsed = 799; q.countedFrame = -1; watch(t, q, audits); }
  // Pin all high-level land via queries; keep level <=2 old to exercise its independent guard.
  for (const q of ready(t)) if (q.level === 4) t.heightAt(q.x0 + 256, q.z0 + 256);
  for (const q of cold) q.lastUsed = 799;
  const before = stats(t).ready;
  t.evict(); assert.equal(stats(t).ready, before, 'within grace nothing is evicted');
  t.frame = 1399; t.wantedCount = 0;
  t.evict(); assert.equal(stats(t).ready, before, 'exactly 600 updates is still within grace');
  t.frame = 1400; t.wantedCount = 0;
  const coarse = ready(t).filter(q => q.level <= 2);
  for (const q of coarse) { q.lastUsed = 0; q.countedFrame = -1; }
  for (const q of ready(t)) if (q.level === 4) t.heightAt(q.x0 + 256, q.z0 + 256);
  // Preserve specific camera/car/query/ready-child/fallback holders older than the rest.
  const car = cold[0], cameraTile = cold[1], queried = cold[2];
  const c = camera(cameraTile.x0 + 100, cameraTile.z0 + 100);
  t.withGroundContact({ x: car.x0 + 100, z: car.z0 + 100, y: 0 }, () => {});
  // Give the explicit query the oldest age so its mutation cannot hide behind LRU order.
  queried.lastUsed = -10; t.heightAt(queried.x0 + 100, queried.z0 + 100);
  t.use(car); t.use(cameraTile);
  // Use an existing parent/child with an absent sibling; production traversal must keep both.
  for (let i = 0; i < cold.length; i++) if (cold[i].countedFrame !== t.frame) cold[i].lastUsed = -100 - i;
  const parent = t.tile(4, 0, 0), child = t.tiles.get('5/0_1');
  t.frustum.intersectsBox = () => true;
  t.visit(4, 0, 0, new THREE.Vector3(128, 0, 128));
  assert.equal(parent.mesh.visible, true, 'fallback ancestor draws while a child is missing');
  t.tiles.entries = () => assert.fail('eviction must not allocate an entries array');
  const eligible = ready(t).filter(q => q.level > 2 && t.frame - q.lastUsed > 600 && !q.mesh.visible).sort((a,b) => a.lastUsed-b.lastUsed);
  const expected = eligible.slice(0, Math.max(0, stats(t).spare - cap));
  t.evict();
  for (const q of expected) assert.equal(q.ready, false, 'oldest eligible spare evicted first');
  for (const q of [car, cameraTile, queried, parent, child, ...coarse]) assert.ok(q.ready, 'pinned/query/coarse tiles retained');
  assert.ok(stats(t).spare <= cap, 'mature spares bounded with zero slack');
  auditEvicted(t, audits);
  assert.ok(cold.some(q => !q.ready), 'must exercise actual eviction');
  // A genuine update sequence tests cadence and short-return cache reuse with the production traversal.
  const cadence = ground(low); let scans = 0; const evict = cadence.evict.bind(cadence); cadence.evict = () => { scans++; evict(); };
  // Suppress network expansion only in this cadence probe; the loaded cache still uses production eviction.
  for (let i = 0; i < cap + 5; i++) { const q = cadence.tile(5, i % 32, Math.floor(i / 32)); await load(cadence, q); }
  cadence.request = () => {}; await tick(cadence, camera(-100000, -100000), 100);
  assert.ok(scans <= 4, 'eviction scans no more than once every 30 updates');
  const parked = cadence.tiles.get('5/0_0'), underCamera = cadence.tiles.get('5/1_0');
  cadence.withGroundContact({ x: parked.x0 + 100, z: parked.z0 + 100, y: 0 }, () => {});
  cadence.frame = 700;
  const agedBefore = stats(cadence).ready - 2; // The two camera/car columns become wanted in update.
  await tick(cadence, camera(underCamera.x0 + 100, underCamera.z0 + 100));
  assert.equal(stats(cadence).spare, Math.min(agedBefore, cap), 'retain exactly min(aged spares before, cap)');
  assert.ok(parked.ready, 'live car column pinned by update'); assert.ok(underCamera.ready, 'camera column pinned by update');
  const short = ground(low); short.split = .05; await settle(short, camera()); const firstReads = terrainReads();
  await tick(short, camera(6000, 6000), 5); const awayReads = terrainReads(); await settle(short, camera());
  assert.equal(terrainReads(), awayReads, 'short return within grace makes zero land reads'); assert.ok(awayReads >= firstReads);
  console.log(`PASS ${low ? 'LOW' : 'desktop'} synthetic: >=256 wanted; spare ${cap}; grace 600; scan <=1/30; mixed road/mask/mirror disposal; protected coarse/query/camera/car/ancestor; return reads=0`);
}
async function pathReload(low) {
  // Preserve the original 200+ tile serialization/reload test. The high-wanted-set case above and all real cases
  // use production split values; this secondary small-split fixture isolates reload identity and site paint.
  const t = ground(low), c = camera(), audits = new Map(), visits = low ? 210 : 310;
  t.split = .05;
  t.sites.push({ box: [0, 0, 256, 256], height: (x, z, surveyed) => surveyed + 3, surface: () => ({ dist: 0, half: 4, kind: 8 }) });
  let first, samples;
  for (let k = 0; k < visits; k++) {
    const row = Math.floor(k / 32), col = row % 2 ? 31 - k % 32 : k % 32;
    c.position.set(col * 256 + 128, 10, row * 256 + 128); c.lookAt(c.position.x + 20, 9, c.position.z); c.updateMatrixWorld();
    for (let j = 0; j < 24; j++) {
      if (!low) t.withReflection(c, c.position, () => {});
      for (const q of ready(t)) watch(t, q, audits);
      await tick(t, c);
    }
    assert.equal(t.find(c.position.x, c.position.z)?.level, 5, 'path reaches fine land');
    if (!k) { first = t.tiles.get('5/0_0'); samples = [t.heightAt(17,29), t.meshHeightAt(17,29), t.surfaceAt(17,29)]; }
  }
  await tick(t, c, 730);
  assert.ok(stats(t).spare <= (96), 'path mature spare cap, zero count slack after grace plus scan delay');
  assert.equal(first.ready, false, 'path really evicted its first tile'); auditEvicted(t, audits);
  const before = terrainReads(); await settle(t, camera());
  assert.ok(terrainReads() > before, 'return after eviction reads the tile again');
  assert.notEqual(t.tiles.get('5/0_0'), first, 'return creates a new tile record');
  assert.deepEqual([t.heightAt(17,29), t.meshHeightAt(17,29), t.surfaceAt(17,29)], samples, 'reload preserves heights and site paint');
  console.log(`PASS ${low ? 'LOW' : 'desktop'} ${visits}-leaf path: mature spares bounded, return rereads, height/surface/site samples identical`);
}
async function siteTexel() {
  // PR #150: the yard dog's 4 m entrance gave level-4 tile 4/8_9 (16 m samples, no baked road field) a whole 257 x 257
  // road texture. A site with maxTexel is painted only on tiles at least that fine; a site without one paints every tile.
  const t = ground(false), small = { box: [0, 0, 100, 100], maxTexel: 2, height: (x, z, surveyed) => surveyed, surface: () => ({ dist: 0, half: 4, kind: 8 }) };
  t.sites.push(small);
  const tile = async (l, i, j) => { const q = t.tile(l, i, j); await load(t, q); assert.ok(q.ready, `${key(q)} built`); return q; };
  for (const [l, texel] of [[0, 32], [2, 8], [3, 4]]) {
    const q = await tile(l, 0, 0);
    assert.equal(t.manifest.size / 2 ** l / 256, texel, 'synthetic texel');
    // Booleans only: a failing strict assert diffs its operands, and a 257 x 257 road field or a texture runs away.
    assert.ok(q.road === null, `${key(q)} (${texel} m) has no road field for a site with maxTexel 2`);
    assert.ok(q.mesh.material.uniforms.tRoad.value === t.noRoad, `${key(q)} (${texel} m) shares the empty road texture`);
  }
  for (const l of [4, 5]) {
    const q = await tile(l, 0, 0);
    assert.ok(!!q.road && q.mesh.material.uniforms.tRoad.value !== t.noRoad, `${key(q)} (${t.manifest.size / 2 ** l / 256} m) still paints the site`);
    assert.equal(t.surfaceAt(50, 50)?.kind, 8, 'the fine tile keeps the site paint');
  }
  const open = ground(false); open.sites.push({ ...small, maxTexel: undefined });
  const coarse = open.tile(3, 0, 0); await load(open, coarse);
  assert.ok(!!coarse.road && coarse.mesh.material.uniforms.tRoad.value !== open.noRoad, 'a site without maxTexel still paints coarse tiles');
  console.log('PASS site maxTexel: no road texture on 32/8/4 m tiles, painted on 2/1 m tiles; unlimited sites unchanged');
}
async function gravelDriveway() {
  // A gravel driveway is a track (kind 4) with flag bit 64: surfaceAt says gravel, and the tile draws it as a gravel
  // road (kind 3, bridge and washboard bits kept) without ROAD_PAVEMENT, so no new program. The same bit on a paved
  // lane (2) is its double yellow: never gravel, and it takes ROAD_PAVEMENT. A plain track is neither. In 1884 (cart
  // roads) the driveway is drawn and driven as the track it is. Wherever it is drawn, the wheels meet the drawn holes.
  for (const [flag, gravel, pavement, drawn, cart] of [[68, true, false, 3, false], [4, false, false, 4, false], [66, false, true, 66, false],
    [84, true, false, 19, false], [100, true, false, 35, false], [116, true, false, 51, false], [68, false, false, 68, true]]) {
    roadFlag = flag;
    const t = ground(false); t.cartRoads = cart; const q = t.tile(5, 1, 0); await load(t, q);
    assert.ok(q.ready && !!q.road, 'the synthetic road tile 5/1_0 is built');
    const s = t.surfaceAt(300, 29);
    assert.equal(s?.kind, flag & 15, `flag ${flag} keeps its kind`);
    assert.equal(s?.gravel === true, gravel, `flag ${flag} gravel`);
    assert.equal('gravel' in s, gravel, `flag ${flag}: no gravel key unless it is gravel`);
    assert.equal(q.mesh.material.defines.ROAD_PAVEMENT === 1, pavement, `flag ${flag} ROAD_PAVEMENT`);
    const data = q.mesh.material.uniforms.tRoad.value.image.data, k = [...q.road.keys()].find(i => i % 4 === 2 && q.road[i] === flag);
    assert.ok(k !== undefined && q.road[k] === flag, `flag ${flag}: surfaceAt's bytes keep the flag`);
    assert.equal(data[k], drawn, `flag ${flag}${cart ? ' (1884)' : ''} is drawn as ${drawn}`);
    assert.equal(data.buffer === q.road.buffer, drawn === flag, `flag ${flag}: a copy only when a gravel driveway is drawn`);
    assert.equal(potholeDensity(s.kind, s.washboard, s.gravel), potholeDensity(drawn & 15, (drawn & 32) !== 0), `flag ${flag}${cart ? ' (1884)' : ''}: the wheels meet the drawn potholes`);
  }
  roadFlag = 3;
  console.log('PASS gravel driveway: kind 4 with bit 64 reads gravel and is drawn as a gravel road, with its potholes, without ROAD_PAVEMENT (a track in 1884); a plain track and a double yellow lane do not read gravel');
}
async function treeWait() {
  const m = manifest(0); m.size = 65536; m.levels[8] = ['0_0']; m.trees = { level: 8, record: 8, tiles: ['0_0'], count: 1 };
  const t = ground(true, m); await load(t, t.tile(0, 0, 0)); const fine = t.tile(8, 0, 0); await load(t, fine);
  const trees = new Trees(['0_0'], 'synthetic', t, false); heldTrees = true;
  trees.update(new Set(['0_0'])); await flush();
  // Model fine-ground eviction during the file await; the real-data sequence below also executes the eviction.
  t.tiles.delete('8/0_0'); t.readyCount--; heldTrees = false; for (const release of releases) release(); releases = []; await flush();
  assert.ok(trees.tiles.get('0_0') === 'loading', 'late file must wait, never plant on coarse land');
  assert.ok(trees.decoded.has('0_0'), 'decoded file retained'); assert.equal(trees.pending, 0, 'unwanted decoded files do not block settling');
  const before = treeReads(); await load(t, t.tile(8, 0, 0)); trees.update(new Set(['0_0']));
  assert.notEqual(trees.tiles.get('0_0'), 'loading'); assert.equal(treeReads(), before, 'plant retained bytes without a second read');
  assert.equal(trees.decoded.size, 0); console.log('PASS deferred tree file waits for fine land and plants without rereading');
}
function realGround(low) {
  real = true; reads = new Map(); const m = JSON.parse(readFileSync(`${realBase}/manifest.json`));
  const t = new Terrain(m, realBase, {}, 1.5, -.2); t.low = low; if (low) t.split = 1.15;
  if (m.streams) t.streams = new Streams(JSON.parse(readFileSync(`${realBase}/${m.streams.file}`)), m.village);
  return t;
}
async function laps(low) {
  let t = realGround(low); const c = camera(0, 0), mode = low ? 'LOW' : 'desktop';
  await settle(t, c); const settledReady = ready(t).length, before = terrainReads();
  const paced = async x => {
    c.position.x = x; const start = t.frame; await settle(t, c);
    await tick(t, c, Math.max(0, 60 - (t.frame - start)));
  };
  // Both return lengths run at 20 m/s and 60 updates/s: the spare cache, not grace, must prevent rereads.
  const lap = async distance => {
    const before = terrainReads();
    for (let n = 0; n < 10; n++) for (const sign of [1, -1]) for (let step = 20; step <= distance; step += 20) {
      await paced(sign === 1 ? step : distance - step);
    }
    return terrainReads() - before;
  };
  const lapReads = await lap(400), lapReady = ready(t).length;
  // Independent cold village start, so the 1.2 km count includes its first corridor read too.
  t = realGround(low); c.position.x = 0; await settle(t, c);
  const longLapReads = await lap(1200);
  if (name === 'current') {
    assert.ok(lapReads <= 40, `real ${mode} 400m lap reads <=40: ${lapReads}`);
    assert.ok(longLapReads <= 140, `real ${mode} 1.2km lap reads <=140 (main about113): ${longLapReads}`);
  }
  const beforeDrive=terrainReads();
  // A 3 km drive at 20 m/s and 60 updates/s, using the same 20 m sample spacing.
  // Also report a stationary 730-update cooldown, so the grace and scan-delay allowance is explicit.
  for (let x = 20; x <= 3000; x += 20) {
    c.position.x = x; const start = t.frame; await settle(t, c);
    await tick(t, c, Math.max(0, 60 - (t.frame - start)));
  }
  const driveReady = ready(t).length;
  await tick(t, c, 730); const cooledReady = ready(t).length;
  const result = { version: name, mode, settledReady, lapReady, lapReads, longLapReads, driveReads:terrainReads()-beforeDrive, driveReady, cooledReady, updates: t.frame };
  if (name === 'current') {
    const s = stats(t); assert.ok(s.spare <= (96), `real ${mode} aged spare cap: ${s.spare}`); Object.assign(result, s, { lapReadCeiling: 40, longLapReadCeiling: 140, agedReadyCeiling: s.wanted + (96) });
  }
  if (name === 'current' || name === 'before') assert.deepEqual([lapReads,longLapReads,result.driveReads], BEFORE[mode].reads, 'main 883363c read counts');
  console.log('METRIC ' + JSON.stringify(result));
}
async function realTrees(frames, low) {
  const t = realGround(low), c = camera(0, 0); await settle(t, c);
  const originalKeys = new Set(t.drawnFine), trees = new Trees(t.manifest.trees.tiles, realBase, t);
  heldTrees = true; trees.update(originalKeys, c.position); await flush();
  const requested = treeReads(); assert.equal(requested,low?47:63,'same village tree-file reads as fe15cab');
  c.position.x = 6000; c.position.z = 0;
  await tick(t, c, frames);
  heldTrees = false; for (const release of releases) release(); releases = []; await flush();
  const deferred = trees.decoded.size;
  // Finish planting only when the original view's fine land is ready again.
  c.position.x = 0; await settle(t, c, 5, () => trees.update(t.drawnFine, c.position));
  let checked = 0, off = 0, maxError = 0;
  for (const tileKey of originalKeys) if (trees.has(tileKey)) {
    const tile = trees.tiles.get(tileKey); assert.ok(tile && tile !== 'loading', 'original tree tile planted on return');
    for (const batch of tile.batches) for (let k = 0; k < batch.matrices.length; k += 16) {
      const x = batch.matrices[k + 12], z = batch.matrices[k + 14], s = t.surfaceAt(x, z);
      assert.equal(s?.level, 8, 'tree oracle is fine ground');
      const error = Math.abs(batch.matrices[k + 13] + .25 - t.heightAt(x, z));
      checked++; if (error > .05) off++; maxError = Math.max(maxError, error);
    }
  }
  assert.ok(checked >= 20000, 'real root-height audit covers thousands of trees');
  assert.equal(off, 0, `delayed ${frames}-frame tree roots >0.05m from fine land (max ${maxError})`);
  // Returning may request new neighbouring keys; the original files must each be read exactly once.
  for (const k of originalKeys) if (trees.has(k)) assert.equal(reads.get(`${realBase}/8/${k}.t.bin`), 1, 'no second tree-file read');
  console.log(`PASS real Trees ${low ? 'LOW' : 'desktop'} ${frames}-frame 6km jump: ${requested} files delayed, ${deferred} decoded files deferred, ${checked} roots, ${off} off >0.05m, max ${maxError.toFixed(6)}m`);
}
if (scenario === 'synthetic' || scenario === 'builds' || scenario === 'builds-20') await builds(scenario === 'builds-20' ? 20 : 6);
if (scenario === 'synthetic' || scenario === 'retry') await retry();
if (scenario === 'synthetic' || scenario === 'cache') { await cache(true); await cache(false); }
if (scenario === 'synthetic') { await pathReload(true); await pathReload(false); }
if (scenario === 'synthetic' || scenario === 'site-texel') await siteTexel();
if (scenario === 'synthetic' || scenario === 'tree-wait') await treeWait();
if (scenario === 'synthetic' || scenario === 'gravel-driveway') await gravelDriveway();
if (scenario === 'synthetic' || scenario === 'interior-quiet') interiorQuiet();
if (scenario === 'laps') { await laps(true); await laps(false); }
if (scenario.startsWith('trees-')) await realTrees(Number(scenario.split('-')[2]), scenario.split('-')[1] === 'low');

// --record, fe15cabea67647443243d67eda1e97e41c85e6ef (before build queue):
// PNG reads LOW 400m/1.2km/3km = 23/113/179; desktop = 20/97/165.
// village LOW driving/start = 49/49 updates, 455 PNG reads; desktop = 63/63, 598 reads.
// First pass bc70470: LOW driving/start = 285/52, desktop = 369/66; same 455/598 reads.
// Burst loader: LOW driving/start = 50/50, desktop = 64/64; same 455/598 reads.
// Start-mode clock charges 2 ms per build; these are update counts, not hardware timings.
async function arrival() {
  for (const low of [true, false]) for (const startMode of [false, true]) {
    const t = realGround(low), c = camera(0, 0);
    // Deterministic build cost; no wall-clock timing in assertions. The outstanding window caps both budgets at six builds.
    if (t.build) { const build = t.build.bind(t); t.build = data => { build(data); now += 2; }; }
    const first = t.frame;
    await settle(t, c, 0, null, startMode);
    const updates = t.frame - first - 4; // Exclude four confirming updates after the last build/read and full expansion.
    if (name === 'current') {
      assert.equal(updates,BEFORE[low?'LOW':'desktop'].updates[0]+1,'village burst stays one update from main 883363c');
      assert.equal(terrainReads(),low?455:598,'village reads unchanged');
    }
    console.log('ARRIVAL '+JSON.stringify({mode:low?'LOW':'desktop',startMode,updates,reads:terrainReads(),...stats(t)}));
  }
}
if (scenario === 'arrival') await arrival();

async function builds(count) {
  // The tile maths must not change by accident. The pin was main 883363c (the 1884 era), then 9826d95 (PR #90, the
  // West Bay quarry paint). PR #85 (the stunt kit) adds LOD-gated site grading and a separately flagged colour
  // program on purpose; separate stunt-main-* rows compare ordinary meshes, road/canopy samples, normals and programs
  // with origin/main at every LOD/Hill/quality, and stunt-main-mutant breaks that path. The pin is now the SHA-256
  // of the reviewed maths text (branch commit 79475f31), so it survives a squash merge and a fresh clone.
  const MATHS_SHA256='cb3ff8b358b76342d7f029ccb3f4a201b86e63ee7a8dad9cf491e5efa76cb90e';
  // Approved class-mask additions are checked by the real-terrain ground-canopy
  // suite and its three mutants. Strip only those exact additions (every
  // occurrence: the ordinary and STUNT_PARK tile programs both carry the define)
  // before hashing; every other byte stays pinned.
  const groundParts=["      // Both tree representations use the same approved class cell. Heights remain measured.\n      if(this.groundCover){\n        const x=t.x0+(k%S)*mpp,z=t.z0+Math.floor(k/S)*mpp;\n        if(clearsGroundTrees(this.groundClassAt(x,z))){c=0;px[k*4+2]=0;}\n      }\n", "        // Averaging must not grow the neighbouring forest hull back over a cleared cell.\n        if(this.groundCover&&clearsGroundTrees(this.groundClassAt(t.x0+ga*mpp,t.z0+gb*mpp)))c=0;\n", "...(this.groundCover ? { GROUND_CLASSES: 1 } : {}), "];
  // Sidewalks deliberately clear vegetation only. The new sidewalk row checks that mask;
  // keep the existing arithmetic pin for every other operation, including the no-sidewalk path.
  const sidewalkClears = [
    '    const walkMask=this.sidewalks?.terrainMask?.(t.level,t.i,t.j);\n',
    '    const contactCanopy=this.sidewalks?.clearCanopy?.(t.level,t.i,t.j,canopy,px)??null;\n',
    ' if(contactCanopy)contactCanopy[b*S+a]=0;',
    '    t.contactCanopy=contactCanopy;\n',
    '        if(walkMask?.[k0])c=0;\n',
    '        if(contactCanopy&&contactCanopy[k]>0&&!coastal.treeAllowed(x,z,raw,slope))contactCanopy[k]=0;\n',
  ];
  const maths=source=>sidewalkClears.reduce((text,line)=>text.split(line).join(''),source.slice(source.indexOf('    const sites = this.sites.filter'),source.indexOf('    this.group.add(mesh);')+'    this.group.add(mesh);'.length));
  // PR #163 (reviewed) added two hook lines for the Point Tupper stockpiles: `canopyExcludes` is unset in every area
  // without a stockpile pack, so the maths do not change there. They are the only lines allowed beyond the pin, each
  // once at most, byte for byte and at its reviewed place (the line before it, the hook, the line after it); a
  // later PR can move the pin to a main commit that holds them.
  const HOOKS=[['','      if (this.canopyExcludes?.(t.x0 + (k % S) * mpp + this.manifest.village[0], this.manifest.village[1] - (t.z0 + Math.floor(k / S) * mpp))) { c = 0; px[k * 4 + 2] = 0; }\n','      canopy[k] = c;\n'],
    ['        if(coastal?.quarry && coastField && coastField[k0*4+1]>.5)c=0;\n','        if (this.canopyExcludes?.(t.x0 + ga * mpp + this.manifest.village[0], this.manifest.village[1] - (t.z0 + gb * mpp))) c=0;\n',''],
    // PR #27 (reviewed): the ROAD_PAVEMENT define on tiles whose road flags carry Mabou's double-yellow or worn bits
    // (64/128 on a paved lane; a gravel driveway's 64 on a track does not take it): a flag read and a colour define; no
    // ground, canopy or road maths change. Once each, ordinary program only.
    ['    let lo = Infinity, hi = -Infinity',', roadPavement = false',';\n'],
    ['      if (road && road[k * 4 + 2] > 0) {\n','        roadPavement ||= (road[k * 4 + 2] & 192) !== 0 && (road[k * 4 + 2] & 15) !== 4;\n','        // Nothing stands on a road'],
    // The gravel driveways' fix: the texture draws a gravel driveway as a gravel road (drawnRoadBytes); the CPU
    // samples keep their bytes. On such a tile the texture holds a copy, despite the pinned comment above the hook
    // ("CPU samples and the texture only read these same bytes"); watch() checks the only bytes that differ. No ground,
    // canopy or road maths change. Once, ordinary program only.
    ['      roadTex = new THREE.DataTexture(new Uint8Array(road.buffer, road.byteOffset, road.byteLength), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);\n','      if (!this.cartRoads) roadTex.image.data = drawnRoadBytes(roadTex.image.data as Uint8Array);\n','      roadTex.magFilter'],
    ['...(airportMarkings ? { AIRPORT: 1 } : {})',', ...(roadPavement && !this.cartRoads ? { ROAD_PAVEMENT: 1 } : {})',' },uniforms:tileUniforms}'],
    // PR #147 (reviewed): the AIRPORT shader define for tiles that overlap the airfield site; no maths change. With the
    // park's two tile programs (ordinary and STUNT_PARK) the define stands in each, so twice at most.
    ['    const gravelOverlay=sites.some(s=>s.visualGravel);\n','    const airportMarkings=sites.some(s=>s.airportMarkings);\n',''],
    ['...(gravelOverlay ? { SITE_GRAVEL: 1 } : {})',', ...(airportMarkings ? { AIRPORT: 1 } : {})',' },uniforms:tileUniforms}',2],
    // Sugar Camp keeps the space between the benches out of the site's tile work.
    ['t.size / T <= s.maxTexel)','\n      && (s.affectsTile?.(t.x0, t.z0, t.size, t.level) ?? true)',');\n'],
    // PR #150: a site with maxTexel is left out of coarser tiles; no maths change on tiles that keep it (site-texel). Coarser
    // tiles lose its sub-sample paint and the road-canopy fade under it.
    [' || s.box[3] < t.z0 || s.box[1] > t.z0 + t.size)',' && (s.maxTexel === undefined || t.size / T <= s.maxTexel)',');\n']];
  const withoutHooks=source=>HOOKS.reduce((text,[before,hook,after,most=1])=>{const parts=text.split(hook);assert.ok(parts.length-1<=most&&parts.every((part,i)=>(i===parts.length-1||part.endsWith(before))&&(i===0||part.startsWith(after))),'a stockpile, pavement, airport, site-tile or site-texel hook stands at most its allowed number of times in the tile maths, at its reviewed place');return parts.join('');},maths(source));
  if(!mutations[name])assert.equal(createHash('sha256').update(withoutHooks(groundParts.reduce((s,part)=>s.split(part).join(''),terrainText))).digest('hex'),MATHS_SHA256,'tile maths are byte-identical to the reviewed PR #85 text, but for the stockpile, pavement, airport, site-tile and site-texel hooks and the ground-class lines');
  const c = camera(128,128);
  const fixture = async (cost = 0) => {
    const t = ground(false), built = [], all = [];
    // Two camera-column tiles, two coarse distant tiles, then fine distant tiles.
    for (const [l,i,j] of [[5,0,0],[3,3,0],[4,0,0],[2,2,0],[5,5,0],[5,6,0],
      ...Array.from({length:14},(_,k)=>[5,k+7,1])].slice(0,count)) all.push(t.tile(l,i,j));
    // Finish the initial empty burst before testing later normal-driving arrivals.
    t.visit=()=>true; t.update(c); await flush(); stats(t);
    let wanted = all;
    t.visit = () => { for (const q of wanted) t.request(q, q.i); return true; };
    const build = t.build.bind(t);
    t.build = d => { assert.ok(t.pending>0,'tile stays pending through its build'); built.push(key(d.tile)); build(d); now += cost; };
    // All reads arrive in this same controlled clock tick; no update can build asynchronously.
    const at = now; t.update(c); await flush();
    assert.equal(now, at); assert.equal(t.builds.length, count, 'all same-tick completions wait for update');
    assert.equal(built.length, 0, 'no async builds'); assert.equal(t.pending, count, 'decoded bytes stay pending'); stats(t);
    return {t,built,all,setWanted:q=>{wanted=q;}};
  };
  const {t,built,all} = await fixture();
  // Deliberately choose a request/decode order different from the build priority.
  const expected = ['4/0_0','5/0_0','2/2_0','3/3_0',...all.slice(4).map(key)];
  for (let i=0;i<count;i++) {
    t.evict(); for (const q of all) assert.equal(t.tiles.get(key(q)),q,'queued tile must not be evicted');
    t.update(c); await flush(); stats(t);
    assert.equal(built.length,i+1,'exactly one build per driving update');
    assert.equal(t.pending,count-i-1,'pending lasts through final build');
    assert.deepEqual(built,expected.slice(0,i+1),'camera/car, coarse, distance order');
  }
  assert.equal(t.group.children.length,count); assert.equal(t.builds.length,0);
  // Public immediate path: every CPU sample, geometry attribute, index, texture, box and sea mask agrees.
  const immediate=ground(false);
  for(const q of all) {
    await immediate.loadNow(q.level,q.i,q.j); const other=immediate.tiles.get(key(q));
    for(const f of ['ground','canopy','road','brook','quadSea'])assert.deepEqual(other[f],q[f],`loadNow ${f}`);
    assert.deepEqual(other.box,q.box);
    for(const [n,a]of Object.entries(q.mesh.geometry.attributes))assert.deepEqual(other.mesh.geometry.attributes[n].array,a.array,`loadNow ${n}`);
    assert.deepEqual(other.mesh.geometry.index.array,q.mesh.geometry.index.array);
    for(const f of ['tNormal','tRoad','tBrook'])assert.deepEqual(other.mesh.material.uniforms[f].value.image,q.mesh.material.uniforms[f].value.image,`loadNow ${f}`);
  }
  for(const q of all) {
    for(const [dx,dz]of [[.25,.75],[.5,.5],[.99,.01]]) {
      const x=q.x0+q.size*dx,z=q.z0+q.size*dz;
      assert.deepEqual(immediate.surfaceAt(x,z),t.surfaceAt(x,z)); assert.equal(immediate.heightAt(x,z),t.heightAt(x,z));
    }
  }
  // A stale decoded tile is built as a spare, never counted as wanted or left loading.
  const stale=await fixture(); stale.setWanted([]); stale.t.frame=700;
  while(stale.t.pending) {
    stale.t.update(camera(-100000,-100000)); await flush(); stats(stale.t);
    const last=stale.t.tiles.get(stale.built.at(-1));
    assert.notEqual(last.countedFrame,stale.t.frame,'unwanted build does not leak wanted count');
  }
  for(const q of stale.all)assert.equal(q.loading,false);
  // Ready eviction while decoded tiles wait. Cold spares use the real disposer and counter updates.
  const cold=await fixture(); cold.setWanted([]);
  for(let i=0;i<100;i++)await cold.t.loadNow(5,i%32,Math.floor(i/32)+4);
  cold.t.frame=700; cold.t.wantedCount=0;
  const before=ready(cold.t).length; cold.t.evict(); stats(cold.t);
  assert.ok(ready(cold.t).length<before,'ready spares really evicted with waiting builds');
  for(const q of cold.all)assert.equal(cold.t.tiles.get(key(q)),q,'eviction retains queued records');
  while(cold.t.pending){cold.t.update(c);await flush();stats(cold.t);}
  // A delayed camera/car-column build must receive the same pin as ready columns before eviction.
  const pinned=await fixture(); pinned.setWanted([]);
  const body=pinned.all[4];
  pinned.t.withGroundContact({x:body.x0+body.size/2,z:body.z0+body.size/2,y:0},()=>{});
  for(let i=0;i<100;i++) {
    await pinned.t.loadNow(5,i%32,Math.floor(i/32)+4);
    pinned.t.tiles.get(`5/${i%32}_${Math.floor(i/32)+4}`).lastUsed=600;
  }
  pinned.t.frame=700; pinned.t.wantedCount=0;
  pinned.t.update(camera(-100000,-100000)); await flush(); stats(pinned.t);
  assert.ok(body.ready,'newly built car column retained during eviction');
  assert.equal(body.countedFrame,pinned.t.frame,'new car column is wanted before eviction');
  // The fake clock advances only inside build. Four 13 ms builds cross 48 ms; never start a fifth.
  const start=await fixture(13), at=now; start.t.update(c,true); await flush(); stats(start.t);
  assert.equal(start.t.buildMode,'paused');assert.equal(start.built.length,4,'paused mode crosses 48ms after four 13ms builds');assert.equal(now-at,52);
  while(start.t.pending){const n=start.built.length;start.t.update(c,true);await flush();stats(start.t);assert.ok(start.built.length-n<=4);}
  const slow=await fixture(49);slow.t.update(c,true);stats(slow.t);assert.equal(slow.built.length,1,'start budget allows at least one expensive build');
  // One failed read retries while other decoded builds are still waiting, then joins the same queue.
  const r=ground(), targets=all.map(q=>r.tile(q.level,q.i,q.j)), failed=targets[0];
  r.visit=()=>{for(const q of targets)r.request(q,q.i);return true;};
  const path=`synthetic/${key(failed)}.png`, warn=console.warn;console.warn=()=>{};
  try {
    failedReads.add(path);r.update(c);await flush();stats(r);assert.equal(r.failed,1);assert.equal(r.builds.length,count-1);
    now=failed.retryAt-1;r.update(c);await flush();stats(r);assert.equal(r.failed,1);
    failedReads.delete(path);now=failed.retryAt;r.update(c);await flush();stats(r);
    assert.equal(r.failed,0);assert.ok(r.builds.some(d=>d.tile===failed),'retry joins waiting builds');assert.ok(r.pending>0);
    while(r.pending){r.update(c);await flush();stats(r);}assert.ok(failed.ready);assert.equal(failed.tries,1);
  }finally{failedReads.clear();console.warn=warn;}
  console.log(`PASS ${count} simultaneous reads: one driving build, exact order/pending/recounts; retry queue, stale spares, eviction, 48ms paused budget, loadNow equality`);
}

function buildClock(t, cost=2) {
  if(t.build){const build=t.build.bind(t);t.build=d=>{build(d);now+=cost;};}
}
async function burstChecks(cameraOnly=false) {
  const c=camera(), t=ground(); let wanted=[];
  t.visit=()=>{for(const q of wanted)t.request(q,q.i);return true;};
  const built=[], original=t.build.bind(t);
  t.build=d=>{built.push(key(d.tile));original(d);now+=5;};
  const step=async()=>{t.update(c);stats(t);await flush();stats(t);};
  wanted=Array.from({length:6},(_,i)=>t.tile(5,i,0));
  await step();assert.equal(t.buildMode,'burst','first update is burst even without pause');assert.ok(t.burst);
  await step();assert.equal(built.length,5,'burst stops after crossing 24ms budget');
  assert.ok(t.pending>0);assert.ok(t.burst);
  c.position.x+=6000;await step();assert.equal(t.buildMode,'burst','second jump during active burst');
  assert.equal(t.pending,0);assert.equal(t.burst,false,'burst ends on first pending zero');
  wanted=[];await step();assert.equal(t.buildMode,'driving','normal mode resumes after burst');
  c.position.x+=6000;wanted=Array.from({length:6},(_,i)=>t.tile(5,i,1));
  await step();assert.equal(t.buildMode,'burst','6km camera jump begins burst');assert.ok(t.burst);
  if(cameraOnly)return;
  await step();assert.equal(t.pending,1);await step();assert.equal(t.pending,0);assert.equal(t.burst,false);
  // A new ordinary arrival after burst: half-metre steps must never use the burst budget.
  wanted=Array.from({length:6},(_,i)=>t.tile(5,i,2));c.position.x+=.5;
  await step();assert.equal(t.buildMode,'driving','ordinary half-metre step never bursts');
  const n=built.length;
  for(let i=1;i<=6;i++){c.position.x+=.5;await step();assert.equal(t.buildMode,'driving');assert.equal(built.length,n+i,'post-burst arrivals build one each');}
  c.position.x+=150;await step();assert.equal(t.buildMode,'driving','exactly 150m does not burst');
  c.position.x+=150.001;await step();assert.equal(t.buildMode,'burst','strictly more than 150m bursts');
  // Camera is fixed while a separately registered car column jumps.
  const car={x:0,z:0,y:0};t.withGroundContact(car,()=>{});await step();
  car.x+=6000;wanted=[t.tile(5,0,3),t.tile(5,1,3)];await step();assert.equal(t.buildMode,'burst','car-only jump begins burst');
  while(t.pending)await step();assert.equal(t.burst,false);
  // Both places are already built and remain within grace: jumping back performs no reads.
  wanted=[];const before=terrainReads();c.position.x=128;await step();
  assert.equal(t.buildMode,'burst');assert.equal(t.burst,false,'cached return ends burst in the same update');assert.equal(terrainReads(),before);
  const main=readFileSync(`${root}web/src/main.ts`,'utf8');
  const speed=Number(main.match(/flySpeed = (\d+)/)[1]),top=Number(main.match(/flySpeed \*.*?, 2, (\d+)\)/)[1]);
  const boost=Number(main.match(/keys.has\('ShiftRight'\) \? (\d+) : 1/)[1]),cap=Number(main.match(/realDt = Math.min\(clockDt, ([\d.]+)\)/)[1]);
  assert.equal(speed,40);assert.equal(top,4000);assert.equal(boost,5);assert.equal(cap,.1);
  // No displacement during a hidden pause; large resume dt is capped, with harmless positional bursts.
  const at=c.position.x;now+=3600000;await step();assert.equal(c.position.x,at);assert.equal(t.buildMode,'driving');
  c.position.x+=speed*Math.min(3600,cap);await step();assert.equal(t.buildMode,'driving','default flight after a long pause remains below threshold');
  for(const distance of [top*boost/60,top*cap,top*boost*cap]) {
    c.position.x+=distance;wanted=[t.tile(5,2,3)];await step();assert.equal(t.buildMode,'burst','fast/boosted/capped-step flight bursts');
    while(t.pending)await step();assert.equal(t.burst,false);
  }
  // Default flight and a 30m/s car each travel 3km at 60Hz, without a single burst update.
  wanted=[];
  for(const v of [30,speed])for(let x=0;x<3000;x+=v/60){c.position.x+=v/60;car.x+=v/60;await step();assert.equal(t.buildMode,'driving','ordinary 3km drive/default flight never bursts');assert.equal(t.burst,false);}
  console.log('PASS burst start/jumps/rejump/car-only/grace exit, resumed one-build arrivals, 24ms budget, 3km drive/default flight, boosted/capped/resume cases');
}
if(scenario==='burst'||scenario==='burst-camera')await burstChecks(scenario==='burst-camera');

// Controlled 2ms/build: fe15cab main / bc70470 first pass / burst loader, LOW then desktop.
// 6km jump: 28/35, 169/206, 29/36. Longest normal arrival: 5/6, 9/13, 9/13.
// Normal arrivals span first requested work through stable pending zero, excluding four confirmations.
async function jumpDrive() {
  for(const low of [true,false]) {
    const t=realGround(low),c=camera(6000,0);buildClock(t);
    await settle(t,c,0,null,true);
    const first=t.frame;c.position.x=0;await settle(t,c);
    const jump=t.frame-first-4;
    if(name==='current'){
      assert.ok(jump<=(low?35:45),'real 6km jump stays near start-mode latency');
      const readCount=terrainReads();
      c.position.x=6000;await settle(t,c);
      c.position.set(0,(t.heightAt(0,0)??0)+2.2,0);c.lookAt(20,c.position.y-1,0);c.updateMatrixWorld();
      t.update(c);stats(t);await flush();
      assert.equal(t.buildMode,'burst');assert.equal(t.pending,0,'real grace return has no pending work');assert.equal(t.burst,false);
      assert.equal(terrainReads(),readCount,'real grace round trip makes no land reads');
    }
    if(name==='current')assert.equal(t.burst,false,'real jump completed its burst');
    // Real 3km route, at exactly 30m/s, 60 updates per second. Report the longest arrival tail.
    let driveTail=0,arrivalAt=null,quiet=0,prevReady=t.readyCount;
    const car={x:0,z:0,y:0};t.withGroundContact(car,()=>{});
    for(let k=1;k<=6000;k++) {
      const x=k*.5;car.x=x;
      c.position.set(x,(t.heightAt(x,0)??0)+2.2,0);c.lookAt(x+20,c.position.y-1,0);c.updateMatrixWorld();
      t.update(c);stats(t);await flush();stats(t);now+=1000/60;
      if(name==='current'){assert.equal(t.buildMode,'driving','real 30m/s drive never bursts');assert.equal(t.burst,false);}
      if(t.pending||t.readyCount>prevReady){arrivalAt??=k;quiet=0;}
      else if(arrivalAt!==null&&++quiet===4){driveTail=Math.max(driveTail,k-4-arrivalAt+1);arrivalAt=null;}
      prevReady=t.readyCount;
    }
    const stop=t.frame;await settle(t,c);const tail=t.frame-stop-4;
    const expected=name==='before'?(low?[28,5]:[35,6]):name==='first-pass'?(low?[169,9]:[206,13]):[BEFORE[low?'LOW':'desktop'].updates[2]+1,low?9:13];
    assert.deepEqual([jump,driveTail],expected,'recorded jump and normal-arrival update counts');
    console.log('JUMP_DRIVE '+JSON.stringify({version:name,mode:low?'LOW':'desktop',jump,normalArrivalMax:driveTail,stopTail:Math.max(0,tail),...stats(t)}));
  }
}
if(scenario==='jump-drive')await jumpDrive();

function interiorQuiet() {
  const match=mainText.match(/terrain.update\(camera, true\);([\s\S]*?)page.ready\(([^;]+)\);/);
  assert.ok(match,'interior update keeps its own readiness gate');
  const advance=Function('quiet','loaded','terrain','sidewalks',`${match[1]};return {quiet,ready:(${match[2]})};`);
  let quiet=21;
  // Last sibling completes with pending=0; the next update discovers its finer children.
  for(const [before,after]of [[1,1],[1,0],[0,4],[4,0]]) {
    const result=advance(quiet,before===0,{pending:after,failed:0});quiet=result.quiet;
    assert.equal(result.ready,false,'interior readiness cannot blip between sibling groups');
  }
  for(let i=1;i<=21;i++){const result=advance(quiet,true,{pending:0,failed:0});quiet=result.quiet;assert.equal(result.ready,i>20);}
  assert.equal(advance(quiet,true,{pending:0,failed:1}).ready,false,'failed reads still block tools');
  assert.equal(advance(quiet,true,{pending:0,failed:0},{pending:1,update(){}}).ready,false,'a pending visual layer still blocks readiness');
  assert.equal(advance(quiet,true,{pending:0,failed:0},{pending:0,update(){}}).ready,true,'completed visual work permits readiness');
  console.log('PASS interior quiet resets while land loads and across sibling completion; failed back-off unchanged');
}
async function carOrder() {
  const t=ground(),c=camera(),car={x:5*256+128,z:128,y:0};
  t.withGroundContact(car,()=>{});let wanted=[];t.visit=()=>{for(const q of wanted)t.request(q,q.i);return true;};
  t.update(c);stats(t);await flush();
  wanted=Array.from({length:6},(_,i)=>t.tile(5,i+1,0));
  const order=[],build=t.build.bind(t);t.build=d=>{order.push(key(d.tile));build(d);};
  t.update(c);stats(t);await flush();stats(t);
  for(let i=0;i<6;i++){t.update(c);stats(t);await flush();stats(t);assert.equal(t.buildMode,'driving');}
  assert.deepEqual(order,['5/5_0','5/1_0','5/2_0','5/3_0','5/4_0','5/6_0'],'car column builds first with a free camera in a different column');
  assert.equal(t.pending,0);console.log('PASS free-camera order: separate car column first, then remaining request distance');
}
if(scenario==='car-order')await carOrder();

async function budgetCounts() {
  for(const cost of [0,2,8,13])for(const mode of ['driving','burst','paused']) {
    const t=ground(),c=camera();let wanted=[];
    t.visit=()=>{for(const q of wanted)t.request(q,q.i);return true;};
    t.update(c);stats(t);await flush(); // End an empty first-update burst.
    wanted=Array.from({length:20},(_,i)=>t.tile(5,i+1,0));
    let built=0;const build=t.build.bind(t);t.build=d=>{build(d);built++;now+=cost;};
    if(mode==='burst')c.position.x+=6000;
    t.update(c,mode==='paused');stats(t);await flush();stats(t);
    assert.equal(t.buildMode,mode);
    const budget=mode==='paused'?48:24,expected=mode==='driving'?1:cost===0?6:Math.min(6,Math.ceil(budget/cost));
    const before=now;t.update(c,mode==='paused');stats(t);await flush();stats(t);
    assert.equal(built,expected,`${mode} builds at ${cost}ms per tile`);
    assert.equal(now-before,cost*expected,'only the controlled build clock advances');
    assert.ok(built<=6,'zero/coarse clock cannot build more than six outstanding tiles');
    console.log('BUILDS '+JSON.stringify({mode,cost,builds:built}));
    while(t.pending){const n=built;t.update(c,mode==='paused');stats(t);await flush();stats(t);assert.ok(built-n<=expected,'each queued wave keeps its build cap');}
  }
}

// Main has no budget: advance its controlled clock after the asynchronous builds complete.
// Current builds advance that same clock inside the synchronous production build method.
function costTrace(t,cost) {
  const trace={built:0,max:0};
  if(t.build){const build=t.build.bind(t);t.build=d=>{build(d);trace.built++;now+=cost;};}
  return trace;
}
async function costSettle(t,c,mode,cost,trace) {
  let quiet=0,previous=-1;
  for(let i=0;i<1000;i++) {
    c.position.y=(t.heightAt(c.position.x,c.position.z)??0)+2.2;c.lookAt(c.position.x+20,c.position.y-1,c.position.z);c.updateMatrixWorld();
    const before=trace.built,readyBefore=t.readyCount;
    t.update(c,mode==='paused');stats(t);await flush();stats(t);
    const built=t.build?trace.built-before:t.readyCount-readyBefore;
    if(!t.build)now+=cost*built;
    trace.max=Math.max(trace.max,built);
    if(t.build) {
      const budget=t.buildMode==='paused'?48:24;
      const cap=t.buildMode==='driving'?1:cost===0?6:Math.min(6,Math.ceil(budget/cost));
      assert.ok(built<=cap,`real ${t.buildMode} ${cost}ms build cap`);
      if(mode==='driving')assert.equal(t.buildMode,'driving','real cold normal-arrival probe stays driving');
      else if(mode==='paused')assert.equal(t.buildMode,'paused');
    }
    now+=16;
    quiet=t.pending===0&&t.readyCount===previous?quiet+1:0;previous=t.readyCount;
    if(quiet>=4)return i+1-4;
  }
  assert.fail('real cost case did not settle');
}
// Updates [cold village, village -> 6km east, independent east -> village].
// Before: main 883363c36c63aad7fd821ae2624609aca6751cfe, before the build queue.
// Its asynchronous load path has no build budget; counts do not depend on the fake cost.
// Costs are controlled, not wall-clock timing.
const COST_GOLDENS={
  LOW:{main:BEFORE.LOW.updates,burst:{8:[97,20,57],13:[143,30,85]},paused:{8:[50,11,29],13:[73,16,43]}},
  desktop:{main:BEFORE.desktop.updates,burst:{8:[125,20,70],13:[185,29,104]},paused:{8:[64,11,36],13:[94,15,53]}}
};
async function costs() {
  if(name!=='before'&&scenario!=='cold-bound')await budgetCounts();
  // Real tiles at 8 and 13 ms per build. At 2 ms: `arrival` asserts the cold start (50 / 64) and `jump-drive` the
  // jump back (29 / 36) and the driving tails; the 2 ms jump east (11) is no longer run on real tiles.
  // Keep all four costs (including zero) in the synthetic budgetCounts above.
  for(const low of [true,false])for(const [mode,cost] of name==='before'?[['main',2]]:
    [['driving',2],...['burst','paused'].flatMap(mode=>[8,13].map(cost=>[mode,cost]))]) {
    const t=realGround(low),c=camera(0,0),trace=costTrace(t,cost);
    if(mode==='driving') {
      // Warm only the focus detector, with no terrain requests: exercise a genuinely cold normal-arrival queue.
      const visit=t.visit;t.visit=()=>true;t.update(c);stats(t);await flush();t.visit=visit;
    }
    const cold=await costSettle(t,c,mode,cost,trace),coldReads=terrainReads();
    assert.equal(coldReads,low?455:598,'same real cold-start reads at every build cost');
    let east=null,west=null;
    if(mode!=='driving') {
      c.position.x=6000;east=await costSettle(t,c,mode,cost,trace);
      // Independent east start: the westbound jump must load village land, not use its warm grace cache.
      const other=realGround(low),back=camera(6000,0),otherTrace=costTrace(other,cost);
      await costSettle(other,back,'paused',cost,otherTrace);
      back.position.x=0;west=await costSettle(other,back,mode,cost,otherTrace);
    }
    const golden=COST_GOLDENS[low?'LOW':'desktop'];
    if(mode==='driving')assert.equal(cold,low?285:369,'cold normal-arrival probe keeps one build per update');
    else assert.deepEqual([cold,east,west],mode==='main'?golden.main:golden[mode][cost],'controlled build-cost settlement receipt');
    console.log('COST '+JSON.stringify({version:name,mode,profile:low?'LOW':'desktop',cost,cold,east,west,maxBuilds:trace.max,coldReads}));
  }
}
if(scenario==='costs'||scenario==='cold-bound')await costs();

// One clean selection, independent of contactFrame/contactSelected and the production selector.
// Snapshot the ready set at the last root visit: driving builds happen AFTER that visit,
// whereas a burst's second visit sees those builds. No update is skipped in the oracle audit.
function contactOracle(t, position) {
  const available = new Map(ready(t).map(q => [key(q), q])), chosen = new Map();
  const walk = q => {
    if (!q) return;
    if (q.level < t.maxLevel && q.box.distanceToPoint(position) < q.size * t.split) {
      const children = []; let complete = true, part = 0;
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const id = `${q.level + 1}/${q.i * 2 + (quadrant & 1)}_${q.j * 2 + (quadrant >> 1)}`;
        if (t.exists.has(id)) { children.push(available.get(id)); if (!available.has(id)) complete = false; }
        else if (!q.quadSea[quadrant]) part |= 1 << quadrant;
      }
      if (complete && children.length) {
        for (const child of children) walk(child);
        if (part) chosen.set(q, part);
        return;
      }
    }
    chosen.set(q, 0);
  };
  walk(available.get('0/0_0'));
  const finest = [...chosen].sort(([a], [b]) => b.level - a.level);
  return { chosen, at(x, z) {
    for (const [q, part] of finest) {
      if (x < q.x0 || x >= q.x0 + q.size || z < q.z0 || z >= q.z0 + q.size) continue;
      const quadrant = (x >= q.x0 + q.size / 2 ? 1 : 0) | (z >= q.z0 + q.size / 2 ? 2 : 0);
      if (!part || part & (1 << quadrant)) return q;
    }
    return null;
  } };
}
async function eraBurst(low) {
  assert.ok(haveReal, 'era-burst requires the real Mabou tiles');
  const t = realGround(low), c = camera(0, 0); t.cartRoads = true; buildClock(t, 2);
  const points = [];
  for (const center of [0, 6000]) for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const x = center + (i - 9.5) * 31, z = (j - 9.5) * 31;
    points.push({ x, z, source: t.meshContactSource(x, z), land: t.meshContactSource(x, z, true), tile: null });
  }
  // Also cover distant LOD boundaries: the two tight grids alone miss selection-only
  // changes where cached fine ground replaces a coarse tile outside the camera stops.
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) {
    const x = -1500 + i * 473 + .13, z = -4000 + j * 421 + .29;
    points.push({ x, z, source: t.meshContactSource(x, z), land: t.meshContactSource(x, z, true), tile: null });
  }
  let version = t.contactRevision, roots = 0, oracle;
  const counts = { updates: 0, twoVisitUpdates: 0, sourceChanges: 0, uncovered: 0, oracleMismatches: 0, removals: 0 };
  const visit = t.visit.bind(t);
  t.visit = (level, i, j, position, mirror = false) => {
    if (level === 0 && !mirror) { roots++; oracle = contactOracle(t, position); }
    return visit(level, i, j, position, mirror);
  };
  const step = async () => {
    c.position.y = (t.heightAt(c.position.x, c.position.z) ?? 0) + 2.2;
    c.lookAt(c.position.x + 20, c.position.y - 1, c.position.z); c.updateMatrixWorld();
    const previous = new Set(t.contactSelected); roots = 0;
    t.update(c); counts.updates++; stats(t);
    assert.ok(roots === 1 || roots === 2, 'one or two primary root visits per update');
    if (roots === 2) counts.twoVisitUpdates++;
    const boxes = [];
    assert.equal(t.meshContactChanges(version, (...box) => boxes.push(box)), true, 'per-update reader never overflows');
    const covered = (x, z) => boxes.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
    for (const point of points) {
      const { x, z } = point, tile = oracle.at(x, z);
      if (t.selectedContactTile(x, z) !== tile) counts.oracleMismatches++;
      for (const [field, land] of [['source', false], ['land', true]]) {
        const source = t.meshContactSource(x, z, land);
        if (source !== point[field]) { counts.sourceChanges++; if (!covered(x, z)) counts.uncovered++; }
        point[field] = source;
      }
      // Retain the previous oracle tile as well as both public source modes.
      point.tile = tile;
    }
    version = t.contactRevision;
    assert.equal(counts.uncovered, 0, `source changes covered at update ${counts.updates}`);
    assert.equal(counts.oracleMismatches, 0, `finest-first contact oracle at update ${counts.updates}`);
    const selected = new Set(t.contactSelected);
    assert.equal(selected.size, t.contactSelected.length, 'contactSelected has no duplicates after revisit');
    const stamped = [...t.tiles.values()].filter(q => q.contactFrame === t.frame);
    assert.ok(selected.size === stamped.length && stamped.every(q => selected.has(q)), 'contactSelected exactly matches current contactFrame');
    for (const [q, part] of oracle.chosen) assert.equal(q.contactPart, part, 'selected quadrant mask equals oracle');
    // The disappearance loop promises each previous tile its own box, even if a new
    // child's build event happens to cover all sampled points in that tile.
    for (const q of previous) if (!selected.has(q)) {
      counts.removals++;
      assert.ok(boxes.some(([x0, z0, x1, z1]) => x0 === q.x0 && z0 === q.z0 && x1 === q.x0 + q.size && z1 === q.z0 + q.size), 'final deselection emits the removed tile box');
    }
    await flush(); now += 16;
    assert.equal(t.contactRevision, version, 'async reads only queue builds; contact changes wait for update');
  };
  const settleEra = async () => {
    let quiet = 0, previous = -1;
    for (let i = 0; i < 1000; i++) {
      await step();
      quiet = t.pending === 0 && previous === t.readyCount ? quiet + 1 : 0; previous = t.readyCount;
      if (quiet >= 6) return;
    }
    assert.fail('era land did not settle');
  };
  await settleEra(); c.position.x = 6000; await settleEra(); c.position.x = 0; await settleEra();
  c.position.set(3000, 10, -2500); await settleEra();
  c.position.x += 200; await settleEra();
  for (let i = 0; i < 600; i++) { c.position.x += .5; await step(); }
  await settleEra();
  // Cold land, then a 400m jump on every update of this burst, including its last.
  const [burstX, burstZ] = [[-3000, 1000], [1500, -1500], [4500, 500]].find(([x, z]) => t.hasFinest(x, z)) ?? [];
  assert.ok(Number.isFinite(burstX), 'cold moving-burst place has fine land');
  c.position.set(burstX, 10, burstZ); await step();
  assert.ok(t.burst && t.pending > 0, '400m jumps start during an active loading burst');
  let jumps = 0; const twoVisits = counts.twoVisitUpdates;
  do {
    c.position.x = burstX + (++jumps % 2) * 400; await step();
    assert.equal(t.buildMode, 'burst', 'each 400m jump stays in burst mode');
    assert.ok(jumps < 1000, 'moving burst eventually settles');
  } while (t.burst);
  assert.ok(jumps > 1 && counts.twoVisitUpdates > twoVisits, 'moving burst spans multiple updates and revisits');
  await settleEra();
  assert.ok(counts.twoVisitUpdates > 0, 'era test reaches the second root visit');
  assert.ok(counts.sourceChanges > 0 && counts.removals > 0, 'real refinement and deselection exercised');
  console.log(`ERA_BURST ${low ? 'LOW' : 'desktop'} ` + JSON.stringify(counts));
}
// Both detail profiles: they select different tiles for the same view.
if (scenario === 'era-burst') for (const low of [true, false]) await eraBurst(low);
