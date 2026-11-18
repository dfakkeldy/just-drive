#!/usr/bin/env node
// Node only: real packer fixtures, esbuild/VM bundles and mutants; no game source is rewritten.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { build } from '../web/node_modules/esbuild/lib/main.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(join(root, 'web/src/store.ts'), 'utf8');
for (const arg of process.argv.slice(2)) assert.ok(['--mutations'].includes(arg), `unknown option: ${arg}`);
const KEEP = 14; // Observed contract: insertion-ordered Map, promoted on every hit (including in-flight hits).
const base = './terrain';
const deadline = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('store operation did not settle within 2 seconds')), 2000);
  })]); } finally { clearTimeout(timer); }
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const crc = bytes => {
  let n = 0xffffffff;
  for (const b of bytes) { n ^= b; for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); }
  return (n ^ 0xffffffff) >>> 0;
};
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(kind, data) {
  const body = Buffer.concat([Buffer.from(kind), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length); body.copy(out, 4); out.writeUInt32BE(crc(body), out.length - 4); return out;
}
// The Node image adapter decodes the packer's actual RGB8, filter-0 PNGs. It never looks up source files.
// Browser image decoding, colour management and canvas implementation are outside this Node check.
function decodePNG(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), signature, 'PNG signature');
  let offset = 8, width, height, ended = false; const compressed = [];
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, 'short PNG chunk');
    const len = bytes.readUInt32BE(offset), stop = offset + 12 + len;
    assert.ok(stop <= bytes.length, 'short PNG body');
    const type = bytes.toString('ascii', offset + 4, offset + 8), data = bytes.subarray(offset + 8, stop - 4);
    assert.equal(crc(bytes.subarray(offset + 4, stop - 4)), bytes.readUInt32BE(stop - 4), 'PNG CRC');
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 2, 0, 0, 0], 'packer RGB8 format');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') { ended = true; break; }
    offset = stop;
  }
  assert.ok(ended && width && height, 'complete PNG');
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * 3;
  assert.equal(raw.length, height * (stride + 1));
  const rgb = Buffer.alloc(height * stride);
  for (let row = 0; row < height; row++) {
    assert.equal(raw[row * (stride + 1)], 0, 'packer uses filter 0');
    raw.copy(rgb, row * stride, row * (stride + 1) + 1, (row + 1) * (stride + 1));
  }
  return { width, height, rgb };
}
function encodePNG({ width, height, rgb }) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const stride = width * 3, raw = Buffer.alloc(height * (stride + 1));
  for (let r = 0; r < height; r++) rgb.copy(raw, r * (stride + 1) + 1, r * stride, (r + 1) * stride);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function fixtures() {
  const scratch = mkdtempSync(join(tmpdir(), 'store-check-'));
  try {
    const input = join(scratch, 'input'), output = join(scratch, 'output'), files = new Map();
    const add = (path, bytes) => { mkdirSync(join(input, path.split('/')[0]), { recursive: true });
      files.set(path, Buffer.from(bytes)); writeFileSync(join(input, path), bytes); };
    // All 256 byte values; header crosses RGB pixels; payload crosses rows; unequal adjacent lengths.
    add('5/0_0.png', Buffer.from(Array.from({ length: 3301 }, (_, i) => i % 256)));
    add('5/0_0.t.bin', Buffer.from(Array.from({ length: 47 }, (_, i) => 255 - i)));
    add('5/0_1.txt', Buffer.from('synthetic terrain: café, 岩\n'));
    add('5/0_2.bin', Buffer.alloc(0));
    for (let i = 0; i < KEEP + 2; i++) {
      add(`6/${i}_0.png`, Buffer.alloc(17 + i, i + 1));
      add(`6/${i}_0.t.bin`, Buffer.alloc(39 + i * 2, 240 - i));
    }
    // Execute the repository packer unchanged except its two folder constants, in Python memory.
    execFileSync('python3', ['-c', `import pathlib, sys
path, src, out = sys.argv[1:]
text = pathlib.Path(path).read_text()
for key, value in [('SRC', src), ('OUT', out)]:
    lines = text.splitlines()
    hits = [i for i, line in enumerate(lines) if line.startswith(key + ' = ')]
    assert len(hits) == 1
    lines[hits[0]] = key + ' = pathlib.Path(' + repr(value) + ')'
    text = '\\n'.join(lines)
exec(compile(text, path, 'exec'), {'__file__': path, '__name__': '__main__'})
`, join(root, 'tools/pack_terrain.py'), input, output], { stdio: 'pipe' });
    const index = JSON.parse(readFileSync(join(output, 'packs.json'))), packs = new Map();
    assert.equal(index.packs, KEEP + 3);
    for (let i = 0; i < index.packs; i++) packs.set(i, readFileSync(join(output, 'p', `${i}.png`)));
    // Independent layout oracle: LE length header, index offsets, every byte, empty file and padded tail.
    for (const [path, expected] of files) {
      const [id, start, length] = index.files[path], { rgb } = decodePNG(packs.get(id));
      const payloadLength = rgb.readUInt32LE(0);
      assert.equal(length, expected.length); assert.ok(start + length <= payloadLength);
      assert.deepEqual(rgb.subarray(4 + start, 4 + start + length), expected);
    }
    return { files, index, packs };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const fixture = fixtures();
async function bundle(text) {
  // A read-only test probe counts promises/buffers retained by the real cache, not fetch history or GC guesses.
  const result = await build({ stdin: { contents: text + '\nexport const inspect = () => Array.from(loaded.entries());', loader: 'ts',
    resolveDir: join(root, 'web/src') }, bundle: true, write: false, platform: 'node', format: 'iife', globalName: 'Store', logLevel: 'silent' });
  return result.outputFiles[0].text;
}
const originalBundle = await bundle(source);
function rig(code, { index = fixture.index, baseURL = base, indexReply, response } = {}) {
  const calls = [], events = { bitmaps: 0, closed: 0 };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === `${baseURL}/packs.json`) return indexReply ? indexReply() : Response.json(index);
    const match = url.match(/\/p\/(\d+)\.png$/), id = match ? Number(match[1]) : null;
    return response ? response({ url, id, count: calls.filter(c => c.url === url).length }) : new Response(fixture.packs.get(id), { headers: { 'Content-Type': 'image/png' } });
  };
  const context = { Blob, fetch, createImageBitmap: async (blob, options) => {
    assert.deepEqual({ ...options }, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const decoded = decodePNG(Buffer.from(await blob.arrayBuffer())); events.bitmaps++;
    return { ...decoded, close() { events.closed++; } };
  }, OffscreenCanvas: class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext(kind, options) {
      assert.equal(kind, '2d'); assert.equal(options.willReadFrequently, true);
      let bmp;
      return { drawImage(image, x, y) { assert.equal(x, 0); assert.equal(y, 0); bmp = image; },
        getImageData: (x, y, width, height) => {
          assert.equal(width, this.width); assert.equal(height, this.height);
          assert.equal(x, 0); assert.equal(y, 0);
          assert.equal(bmp.width, width); assert.equal(bmp.height, height);
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < width * height; i++) { data.set(bmp.rgb.subarray(i * 3, i * 3 + 3), i * 4); data[i * 4 + 3] = 255; }
          return { data };
        } };
    }
  } };
  runInNewContext(code, context);
  const store = context.Store;
  return { ...store, calls, events, init: () => deadline(store.initStore(baseURL)),
    read: path => deadline(store.readFile(baseURL, path)), count: id => calls.filter(c => c.url === `${baseURL}/p/${id}.png`).length,
    keys: () => Array.from(store.inspect(), ([id]) => id),
    retained: async () => {
      const buffers = await Promise.all(Array.from(store.inspect(), ([, promise]) => promise));
      for (const buffer of buffers) assert.equal(Object.prototype.toString.call(buffer), '[object ArrayBuffer]');
      assert.equal(new Set(buffers).size, buffers.length, 'one distinct retained buffer per pack');
      return buffers.length;
    } };
}
const bytes = async blob => Buffer.from(await blob.arrayBuffer());
const equalFile = async (r, path) => assert.deepEqual(await bytes(await r.read(path)), fixture.files.get(path), `every byte: ${path}`);
const paths = Array.from(fixture.files.keys());
const grouped = Array.from({ length: fixture.index.packs }, (_, id) => paths.filter(p => fixture.index.files[p][0] === id));
const shared = grouped.find(g => g.includes('5/0_0.png')), sharedID = fixture.index.files[shared[0]][0];
const outcomes = await verify(originalBundle, true);
async function verify(code, report = false) {
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, result: 'PASS' }); if (report) console.log(`PASS ${name}`); }
    catch (error) {
      results.push({ name, result: 'FAIL', error });
      if (report) console.log(`FAIL ${name}: ${error.message.split('\n')[0]}`);
    }
  };
  await test('shared request: 24 readers, one delayed fetch, all bytes, independent Blobs', async () => {
    const gate = deferred(), r = rig(code, { response: async ({ id }) => { await gate.promise; return new Response(fixture.packs.get(id)); } });
    await r.init();
    const pending = Array.from({ length: 24 }, (_, i) => equalFile(r, shared[i % shared.length]));
    const fetched = r.count(sharedID), retained = r.keys().length; gate.resolve(); await Promise.all(pending);
    assert.equal(fetched, 1); assert.equal(retained, 1);
    assert.equal(r.events.bitmaps, 1); assert.equal(r.events.closed, 1);
    const first = new Uint8Array(await (await r.read(shared[0])).arrayBuffer()); first.fill(0);
    await equalFile(r, shared[0]); assert.equal(r.count(sharedID), 1);
  });
  await test('cache: LRU hit promotion, 17 packs, exact eviction and at most 14 retained buffers', async () => {
    const r = rig(code); await r.init();
    for (let i = 0; i < KEEP; i++) { await equalFile(r, grouped[i][0]); assert.equal(await r.retained(), i + 1); }
    await equalFile(r, grouped[0][0]);
    await equalFile(r, grouped[KEEP][0]);
    assert.deepEqual(r.keys(), [...Array.from({ length: KEEP - 2 }, (_, i) => i + 2), 0, KEEP]);
    assert.equal(await r.retained(), KEEP);
    await equalFile(r, grouped[0][0]); assert.equal(r.count(0), 1);
    await equalFile(r, grouped[1][0]); assert.equal(r.count(1), 2); assert.ok(!r.keys().includes(2));
    for (let i = 0; i < grouped.length; i++) { await equalFile(r, grouped[i][0]); assert.ok(await r.retained() <= KEEP); }
    assert.equal(await r.retained(), KEEP);
  });
  const failures = [
    ['network rejection', () => { throw new Error('synthetic network failure'); }, /synthetic network failure/],
    ['HTTP 404', () => new Response('missing', { status: 404 }), /404 .*\/p\//],
    ['HTTP 500', () => new Response('failed', { status: 500 }), /500 .*\/p\//],
    ['short PNG body', () => new Response(fixture.packs.get(sharedID).subarray(0, 30)), /short PNG/],
    ['wrong content type and non-image body', () => new Response('<html>fallback</html>', { headers: { 'Content-Type': 'text/html' } }), /PNG signature/],
    ['invalid container length', () => {
      const image = decodePNG(fixture.packs.get(sharedID)); image.rgb.writeUInt32LE(image.rgb.length, 0);
      return new Response(encodePNG(image));
    }, /bad pack/],
    ['fetch abort rejection (no signal API)', () => { throw new DOMException('synthetic abort', 'AbortError'); }, /synthetic abort/],
  ];
  for (const [name, reply, message] of failures) await test(`${name}: each waiter rejects once, then retry succeeds`, async () => {
    const gate = deferred(); let broken = true;
    const r = rig(code, { response: async ({ id }) => { await gate.promise; return broken ? reply() : new Response(fixture.packs.get(id)); } });
    await r.init(); const settledCounts = Array(8).fill(0);
    const pending = settledCounts.map((_, i) => r.read(shared[i % 3]).then(value => { settledCounts[i]++; return value; }, error => { settledCounts[i]++; throw error; }));
    const settled = Promise.allSettled(pending), fetched = r.count(sharedID); gate.resolve();
    const results = await settled; assert.equal(fetched, 1);
    for (const result of results) { assert.equal(result.status, 'rejected'); assert.match(result.reason.message, message); }
    assert.deepEqual(settledCounts, Array(8).fill(1)); assert.equal(r.keys().length, 0);
    broken = false; await equalFile(r, shared[0]); assert.equal(r.count(sharedID), 2);
  });
  await test('short indexed payload must discard the pack and fetch again', async () => {
    const path = '5/0_1.txt', [id, offset, length] = fixture.index.files[path]; let broken = true;
    const r = rig(code, { response: () => {
      if (!broken) return new Response(fixture.packs.get(id));
      const image = decodePNG(fixture.packs.get(id)); image.rgb.writeUInt32LE(offset + length - 1, 0);
      image.rgb.fill(0, 4 + offset + length - 1);
      return new Response(encodePNG(image));
    } });
    await r.init();
    const waiters = await Promise.allSettled(Array.from({ length: 8 }, () => r.read(path)));
    for (const waiter of waiters) {
      assert.equal(waiter.status, 'rejected'); assert.match(waiter.reason.message, /length|bounds|offset|range/i);
    }
    assert.equal(r.count(id), 1);
    broken = false; const retry = await Promise.allSettled([r.read(path)]);
    assert.equal(r.count(id), 2, 'short indexed payload remains cached instead of retrying');
    assert.equal(retry[0].status, 'fulfilled'); assert.deepEqual(await bytes(retry[0].value), fixture.files.get(path));
  });
  for (const [name, offset, length] of [['outside pack', 1e7], ['negative offset', -1], ['fractional offset', 1.5], ['negative fractional offset', -0.5],
    ['fractional length', undefined, 1.5], ['negative length', undefined, -1]]) {
    await test(`index: ${name} rejects without returning another file`, async () => {
      const index = structuredClone(fixture.index), path = shared[1];
      if (offset !== undefined) index.files[path][1] = offset;
      if (length !== undefined) index.files[path][2] = length;
      const r = rig(code, { index }); await r.init();
      const result = await Promise.allSettled([r.read(path)]);
      if (result[0].status === 'fulfilled') {
        // Prove the fault is wrong-file data, rather than accepting a successful but unexplained read.
        const actual = await bytes(result[0].value);
        assert.notDeepEqual(actual, fixture.files.get(path), 'invalid offset returned the requested bytes');
        const { rgb } = decodePNG(fixture.packs.get(sharedID));
        if (offset !== undefined) assert.deepEqual(actual, rgb.subarray(4 + Math.trunc(offset), 4 + Math.trunc(offset) + index.files[path][2]));
      }
      assert.equal(result[0].status, 'rejected', 'invalid fractional offset returns bytes from another file');
      assert.match(result[0].reason.message, /length|bounds|offset|range/i);
    });
  }
  await test('index: zero length returns an empty Blob; missing name gives a clear error', async () => {
    const r = rig(code); await r.init(); await equalFile(r, '5/0_2.bin');
    await assert.rejects(r.read('missing.bin'), /not in any pack: missing.bin/);
    assert.equal(r.calls.length, 2, 'missing entry does not fetch a plain file');
  });
  for (const [name, reply] of [['404', () => new Response('', { status: 404 })], ['500', () => new Response('', { status: 500 })],
    ['HTML', () => new Response('<html>dev fallback</html>')], ['network failure', () => { throw new Error('offline'); }],
    ['invalid index', () => Response.json({ files: {} })]]) await test(`plain fallback after packs.json ${name}; binary/text and HTTP errors`, async () => {
    const r = rig(code, { indexReply: reply, response: ({ url }) => url.endsWith('missing.bin') ? new Response('', { status: 404 }) : new Response(fixture.files.get(url.slice(base.length + 1))) });
    await r.init(); await equalFile(r, '5/0_0.t.bin');
    assert.equal(await (await r.read('5/0_1.txt')).text(), fixture.files.get('5/0_1.txt').toString());
    await assert.rejects(r.read('missing.bin'), /404 missing.bin/); assert.equal(r.keys().length, 0);
  });
  await test('relative page base and query/hash file names are joined literally', async () => {
    const baseURL = './areas/synthetic/terrain', path = '5/0_1.txt?v=7#tile', expected = fixture.files.get('5/0_1.txt');
    const r = rig(code, { baseURL, indexReply: () => new Response('', { status: 404 }), response: () => new Response(expected) });
    await r.init(); assert.deepEqual(await bytes(await r.read(path)), expected);
    assert.deepEqual(r.calls.map(c => c.url), [`${baseURL}/packs.json`, `${baseURL}/${path}`]);
    assert.ok(r.calls.every(c => c.options === undefined), 'store adds no signal or request options');
    const index = structuredClone(fixture.index); index.files[path] = index.files['5/0_1.txt'];
    const packed = rig(code, { index, baseURL }); await packed.init();
    assert.deepEqual(await bytes(await packed.read(path)), expected);
    await assert.rejects(packed.read('5/0_1.txt?v=other'), /not in any pack/);
    assert.equal(packed.calls[1].url, `${baseURL}/p/${sharedID}.png`);
  });
  await test('packed text/binary Blobs and PNG bytes with an incorrect MIME label', async () => {
    const r = rig(code, { response: ({ id }) => new Response(fixture.packs.get(id), { headers: { 'Content-Type': 'text/plain' } }) });
    await r.init(); await equalFile(r, '5/0_0.t.bin');
    const blob = await r.read('5/0_1.txt'); assert.equal(blob.type, '');
    assert.equal(await blob.text(), fixture.files.get('5/0_1.txt').toString());
  });
  return results;
}
if (process.argv.includes('--mutations')) {
  const mutations = [
    ['shared-request map removed', 'let p = loaded.get(i);', 'let p: Promise<ArrayBuffer> | undefined;'],
    ['cache limit ignored', 'while (loaded.size > KEEP)', 'while (false && loaded.size > KEEP)'],
    ['failed fetch cached', 'p.catch(() => { if (loaded.get(i) === p) loaded.delete(i); });', 'p.catch(() => {});'],
    ['offset off by one', 'new Uint8Array(buf, at, size)', 'new Uint8Array(buf, at + 1, size)'],
    ['length taken from next entry', 'new Uint8Array(buf, at, size)', 'new Uint8Array(buf, at, Object.values(index!.files).find(e => e[0] === n && e[1] > at)?.[2] ?? 0)'],
    ['fractional or negative offset accepted', '!Number.isInteger(at) || at < 0 || ', ''],
    ['fractional or negative length accepted', ' || !Number.isInteger(size) || size < 0', ''],
    ['short pack kept in the cache', '{ if (loaded.get(n) === request) loaded.delete(n); throw', '{ throw'],
  ];
  for (const [name, from, to] of mutations) {
    assert.equal(source.split(from).length, 2, `${name}: one mutation site`);
    const results = await verify(await bundle(source.replace(from, to)));
    const killed = results.find(r => r.result === 'FAIL' && r.error instanceof assert.AssertionError);
    assert.ok(killed, `${name}: mutant must fail a passing contract assertion`);
    console.log(`MUTANT REJECTED ${name}: ${killed.name}`);
  }
}
const failed = outcomes.filter(r => r.result === 'FAIL');
console.log(`${outcomes.length - failed.length} PASS; ${failed.length} FAIL; Node PNG adapter, no browser`);
if (failed.length) process.exitCode = 1;
