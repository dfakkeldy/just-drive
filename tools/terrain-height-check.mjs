// Read-only: scan every listed ground PNG in all six areas. Old manifests may omit min/max.
// node tools/terrain-height-check.mjs [--self-test]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { deflateSync } from 'node:zlib';
import { png } from './quarry-height-read.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const areas = ['mabou', 'judique', 'porthood', 'cansocauseway', 'pointtupper', 'westbay'];
const source = readFileSync(resolve(root, 'web/src/terrain.ts'), 'utf8');
const declaration = source.match(/const BAKED_HEIGHT_MAX[^=]*=\s*({[^}]*})/);
assert.ok(declaration, 'terrain.ts must expose its legacy BAKED_HEIGHT_MAX table to this check');
const table = runInNewContext(`(${declaration[1]})`, {}, { timeout: 1000 });

function scan(manifest, readTile) {
  let min = Infinity, max = -Infinity, tiles = 0;
  const { scale, offset } = manifest.height;
  assert.ok(Number.isFinite(scale) && scale > 0 && Number.isFinite(offset), 'valid ground encoding');
  for (const [level, names] of Object.entries(manifest.levels)) {
    assert.match(level, /^\d+$/, 'ground level');
    for (const name of names) {
      assert.match(name, /^\d+_\d+$/, 'ground tile name');
      const { pixels, width, height } = png(readTile(`${level}/${name}.png`));
      assert.equal(width, manifest.tile + 1, 'ground tile width');
      assert.equal(height, manifest.tile + 1, 'ground tile height');
      for (let k = 0; k < pixels.length; k += 4) {
        const h = (pixels[k] * 256 + pixels[k + 1]) * scale + offset;
        min = Math.min(min, h); max = Math.max(max, h);
      }
      tiles++;
    }
  }
  assert.ok(tiles > 0, 'manifest lists ground tiles');
  return { min, max, tiles };
}

function verify(id, manifest, measured, maxima = table) {
  const h = manifest.height, epsilon = 1e-9; // identical centimetres may differ by a floating-point rounding bit
  assert.ok(Number.isFinite(maxima[id]), `${id}: missing finite table maximum`);
  assert.ok(maxima[id] + epsilon >= measured.max, `${id}: table ${maxima[id]} below PNG maximum ${measured.max}`);
  for (const field of ['min', 'max']) {
    if (Object.hasOwn(h, field)) assert.ok(Number.isFinite(h[field]), `${id}: height.${field} must be finite`);
  }
  if (Object.hasOwn(h, 'max')) {
    assert.ok(h.max + epsilon >= measured.max, `${id}: height.max ${h.max} below PNG maximum ${measured.max}`);
    assert.ok(maxima[id] + epsilon >= h.max, `${id}: table below manifest maximum ${h.max}`);
  }
  if (Object.hasOwn(h, 'min')) {
    assert.ok(h.min <= measured.min + epsilon, `${id}: height.min ${h.min} above PNG minimum ${measured.min}`);
  }
  if (Object.hasOwn(h, 'min') && Object.hasOwn(h, 'max')) assert.ok(h.min <= h.max, `${id}: inverted range`);
}

// Valid tiny RGB PNGs: include encoded endpoints, a high edge sample and canopy that is not ground.
function fixturePNG(values) {
  const crc = (data) => {
    let c = 0xffffffff;
    for (const b of data) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0); }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
    b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(14);
  for (let i = 0; i < 4; i++) { const k = Math.floor(i / 2) * 7 + 1 + i % 2 * 3; raw[k] = values[i] >> 8; raw[k + 1] = values[i] & 255; raw[k + 2] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function selfTest() {
  const manifest = { tile: 1, height: { scale: .01, offset: -100 }, levels: { 0: ['0_0'], 8: ['1_2'] } };
  const files = { '0/0_0.png': fixturePNG([9600, 10000, 10001, 53001]), '8/1_2.png': fixturePNG([0, 10000, 20000, 65535]), '8/9_9.png': fixturePNG([65535, 65535, 65535, 65535]) };
  const reads = [];
  const measured = scan(manifest, p => { reads.push(p); return files[p]; });
  assert.deepEqual(reads, ['0/0_0.png', '8/1_2.png'], 'scan every listed level, ignore unlisted tiles');
  assert.deepEqual(measured, { min: -100, max: 555.35, tiles: 2 });
  const maxima = { test: 556 };
  verify('test', manifest, measured, maxima); // legacy manifest
  const withHeight = h => ({ ...manifest, height: { ...manifest.height, ...h } });
  verify('test', withHeight({ min: -100, max: 555.35 }), measured, maxima);
  verify('test', withHeight({ min: -101, max: 556 }), measured, maxima);
  assert.throws(() => verify('test', manifest, measured, { test: 555 }), /table.*below PNG/);
  assert.throws(() => verify('test', withHeight({ max: 555 }), measured, maxima), /height.max.*below PNG/);
  assert.throws(() => verify('test', withHeight({ min: -99 }), measured, maxima), /height.min.*above PNG/);
  assert.throws(() => verify('test', withHeight({ max: 557 }), measured, maxima), /table below manifest/);
  assert.throws(() => verify('test', withHeight({ max: null }), measured, maxima), /must be finite/);
  assert.throws(() => scan({ ...manifest, levels: {} }, () => null), /lists ground tiles/);
  const coarse = scan({ ...manifest, levels: { 0: ['0_0'] } }, p => files[p]);
  assert.equal(coarse.max, 430.01, 'coarse tile and shared edge can own the maximum');
  console.log('PASS terrain-height fixtures: legacy/new bounds, all levels, edges, clipping endpoints, stale table/max/min rejection');
}

selfTest();
if (!process.argv.includes('--self-test')) {
  for (const id of areas) {
    const base = resolve(root, 'data/baked', id === 'mabou' ? 'terrain' : `areas/${id}`);
    const manifest = JSON.parse(readFileSync(resolve(base, 'manifest.json'), 'utf8'));
    assert.equal(manifest.area?.id ?? 'mabou', id, 'manifest area matches its folder');
    const measured = scan(manifest, path => readFileSync(resolve(base, path)));
    verify(id, manifest, measured);
    console.log(`PASS ${id}: ${measured.tiles} PNGs, encoded ground ${measured.min}..${measured.max} m; table ${table[id]}; manifest ${manifest.height.min ?? 'legacy'}..${manifest.height.max ?? 'legacy'}`);
  }
}
