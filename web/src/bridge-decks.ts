import {BRIDGE_DECK_ASSETS} from './bridge-decks-assets';

/** The vertical exaggeration and sea level baked into bridge-decks.bin. Other settings solve in the browser. */
export const BAKED_BRIDGE_EXAG = 1.5;
export const BAKED_BRIDGE_SEA_LEVEL = -0.2;
/** Maximum time to wait for the optional baked bridge deck file before falling back to the runtime solver. */
export const BRIDGE_DECK_LOAD_TIMEOUT_MS = 3000;
const MAGIC = 0x44424d4d; // 'MMBD' little-endian
const VERSION = 1;
const HEADER_FLAG_STREAMS = 1;
const FLAG_NARROW_RAIL = 1;
const FLAG_SMOOTH_START = 2;
const FLAG_SMOOTH_END = 4;
const FLAG_PONY_TRUSS = 8;

export interface BakedBridgeSpan {
  readonly chainKey: string;
  readonly geomHash: bigint;
  readonly landHash: bigint;
  readonly requestWidth: number;
  readonly finalWidth: number;
  readonly narrowRail: boolean;
  readonly level: number;
  readonly smoothStart: boolean;
  readonly smoothEnd: boolean;
  readonly ponyTruss: boolean;
  readonly startLength: number;
  readonly endLength: number;
  readonly y0: number;
  readonly y1: number;
  readonly outer0: number;
  readonly outer1: number;
  readonly rows: number;
  readonly columns: number;
  readonly gridY: Float32Array;
  readonly emitLand: Float64Array;
}

export interface BakedBridgeDecks {
  readonly area: string;
  readonly exag: number;
  readonly seaLevel: number;
  readonly hasStreams: boolean;
  readonly streamsHash: bigint;
  readonly village: readonly [number, number];
  readonly spans: readonly BakedBridgeSpan[];
  find(chainKey: string, width: number, ponyTruss: boolean, geomHash: bigint): BakedBridgeSpan | null;
}

const align = (n: number, step: number) => (n + step - 1) & ~(step - 1);

/** Deterministic 64-bit FNV-1a hash over IEEE-754 Float64 numbers, used to bind a baked span to its exact geometry and land. */
export class GeomHasher {
  private h = 0xcbf29ce484222325n;
  private readonly buf = new ArrayBuffer(8);
  private readonly f64 = new Float64Array(this.buf);
  private readonly u8 = new Uint8Array(this.buf);
  num(v: number): void {
    // Normalize -0 to +0 so equivalent coordinates hash identically.
    this.f64[0] = v === 0 ? 0 : v;
    let h = this.h;
    for (let i = 0; i < 8; i++) h = BigInt.asUintN(64, (h ^ BigInt(this.u8[i])) * 0x100000001b3n);
    this.h = h;
  }
  done(): bigint { return this.h; }
}

/** Fast 64-bit fingerprint over loaded stream segments so a changed streams.json never reuses stale baked decks. */
export function hashStreams(streams: { readonly segments?: Float32Array } | null | undefined): bigint {
  if (!streams) return 0n;
  const seg = streams.segments;
  if (!seg) return 1n;
  const u32 = new Uint32Array(seg.buffer, seg.byteOffset, seg.length);
  let h1 = 0x811c9dc5 ^ seg.length, h2 = 0x9e3779b9 ^ seg.length;
  for (let i = 0; i < u32.length; i++) {
    const w = u32[i] === 0x80000000 ? 0 : u32[i];
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ ((w >>> 16) | (w << 16)), 0x85ebca6b);
  }
  const out = (BigInt(h1 >>> 0) << 32n) | BigInt(h2 >>> 0);
  return out < 2n ? out + 2n : out;
}

export function encodeBridgeDecks(
  area: string,
  exag: number,
  seaLevel: number,
  hasStreams: boolean,
  streamsHash: bigint,
  village: readonly [number, number],
  spans: readonly BakedBridgeSpan[],
): Uint8Array {
  if (!area.length) throw new RangeError('Empty bridge deck area');
  if (![exag, seaLevel, village[0], village[1]].every(Number.isFinite)) throw new RangeError('Non-finite bridge deck header');
  const utf8 = new TextEncoder();
  const areaBytes = utf8.encode(area);
  const sorted = [...spans].sort((a, b) =>
    a.chainKey < b.chainKey ? -1 : a.chainKey > b.chainKey ? 1 :
    a.requestWidth - b.requestWidth || (+a.ponyTruss - +b.ponyTruss) ||
    (a.geomHash < b.geomHash ? -1 : a.geomHash > b.geomHash ? 1 : 0));
  const keys = sorted.map(s => utf8.encode(s.chainKey));
  // Header: magic(4) + version(4) + exag(8) + seaLevel(8) + villageX(8) + villageZ(8) + streamsHash(8) + headerFlags(4) + areaLen(2) + areaBytes -> align(4) + count(4)
  let total = align(4 + 4 + 8 + 8 + 8 + 8 + 8 + 4 + 2 + areaBytes.length, 4) + 4;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.gridY.length !== (s.rows + 1) * (s.columns + 1)) throw new RangeError(`Bridge gridY size mismatch for ${s.chainKey}`);
    total = align(total, 8);
    total = align(total + 2 + keys[i].length, 8);
    total += 2 * 8 + 6 * 8 + 4 * 2 + 4 + 4 + 4; // geomHash(u64), landHash(u64), 6 f64, 4 u16, 4 bytes flags/level/pad, 2 u32 counts
    total += s.gridY.length * 4;
    total = align(total, 8);
    total += s.emitLand.length * 8;
  }
  const buf = new ArrayBuffer(total), out = new Uint8Array(buf), view = new DataView(buf);
  let at = 0;
  view.setUint32(at, MAGIC, true); at += 4;
  view.setUint32(at, VERSION, true); at += 4;
  view.setFloat64(at, exag, true); at += 8;
  view.setFloat64(at, seaLevel, true); at += 8;
  view.setFloat64(at, village[0], true); at += 8;
  view.setFloat64(at, village[1], true); at += 8;
  view.setBigUint64(at, BigInt.asUintN(64, streamsHash), true); at += 8;
  view.setUint32(at, hasStreams ? HEADER_FLAG_STREAMS : 0, true); at += 4;
  view.setUint16(at, areaBytes.length, true); at += 2;
  out.set(areaBytes, at); at = align(at + areaBytes.length, 4);
  view.setUint32(at, sorted.length, true); at += 4;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i], key = keys[i];
    at = align(at, 8);
    view.setUint16(at, key.length, true); at += 2;
    out.set(key, at); at = align(at + key.length, 8);
    view.setBigUint64(at, BigInt.asUintN(64, s.geomHash), true); at += 8;
    view.setBigUint64(at, BigInt.asUintN(64, s.landHash), true); at += 8;
    view.setFloat64(at, s.requestWidth, true); at += 8;
    view.setFloat64(at, s.finalWidth, true); at += 8;
    view.setFloat64(at, s.y0, true); at += 8;
    view.setFloat64(at, s.y1, true); at += 8;
    view.setFloat64(at, s.outer0, true); at += 8;
    view.setFloat64(at, s.outer1, true); at += 8;
    view.setUint16(at, s.startLength, true); at += 2;
    view.setUint16(at, s.endLength, true); at += 2;
    view.setUint16(at, s.rows, true); at += 2;
    view.setUint16(at, s.columns, true); at += 2;
    out[at++] = s.level;
    out[at++] = (s.narrowRail ? FLAG_NARROW_RAIL : 0) | (s.smoothStart ? FLAG_SMOOTH_START : 0) | (s.smoothEnd ? FLAG_SMOOTH_END : 0) | (s.ponyTruss ? FLAG_PONY_TRUSS : 0);
    view.setUint16(at, 0, true); at += 2;
    view.setUint32(at, s.gridY.length, true); at += 4;
    view.setUint32(at, s.emitLand.length, true); at += 4;
    for (let k = 0; k < s.gridY.length; k++) { view.setFloat32(at, s.gridY[k], true); at += 4; }
    at = align(at, 8);
    for (let k = 0; k < s.emitLand.length; k++) { view.setFloat64(at, s.emitLand[k], true); at += 8; }
  }
  if (at !== total) throw new Error(`Bridge deck encode length mismatch: ${at} !== ${total}`);
  return out;
}

export function decodeBridgeDecks(input: Uint8Array, expectedArea?: string): BakedBridgeDecks {
  // Own an 8-byte-aligned buffer; Uint8Array.from copies even Node Buffers whose .slice() would keep byteOffset.
  const aligned = input.byteOffset % 8 === 0 ? input : Uint8Array.from(input);
  const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);
  const len = aligned.byteLength, utf8 = new TextDecoder();
  const need = (n: number, at: number) => { if (at < 0 || at + n > len) throw new Error('Truncated bridge deck payload'); };
  let at = 0;
  need(54, at);
  if (view.getUint32(at, true) !== MAGIC) throw new Error('Invalid bridge deck magic'); at += 4;
  if (view.getUint32(at, true) !== VERSION) throw new Error('Unsupported bridge deck version'); at += 4;
  const exag = view.getFloat64(at, true); at += 8;
  const seaLevel = view.getFloat64(at, true); at += 8;
  const villageX = view.getFloat64(at, true); at += 8;
  const villageZ = view.getFloat64(at, true); at += 8;
  const streamsHash = view.getBigUint64(at, true); at += 8;
  const headerFlags = view.getUint32(at, true); at += 4;
  if (![exag, seaLevel, villageX, villageZ].every(Number.isFinite)) throw new Error('Invalid bridge deck header');
  const hasStreams = (headerFlags & HEADER_FLAG_STREAMS) !== 0;
  const areaLen = view.getUint16(at, true); at += 2;
  if (areaLen === 0) throw new Error('Empty bridge deck area');
  need(areaLen, at);
  const area = utf8.decode(aligned.subarray(at, at + areaLen));
  if (expectedArea !== undefined && area !== expectedArea) throw new Error(`Bridge deck area mismatch: ${area} !== ${expectedArea}`);
  at = align(at + areaLen, 4);
  need(4, at);
  const count = view.getUint32(at, true); at += 4;
  const spans: BakedBridgeSpan[] = [];
  const byKey = new Map<string, BakedBridgeSpan[]>();
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  for (let i = 0; i < count; i++) {
    at = align(at, 8);
    need(2, at);
    const keyLen = view.getUint16(at, true); at += 2;
    if (keyLen === 0) throw new Error('Empty bridge deck span key');
    need(keyLen, at);
    const chainKey = utf8.decode(aligned.subarray(at, at + keyLen));
    at = align(at + keyLen, 8);
    need(2 * 8 + 6 * 8 + 4 * 2 + 12, at);
    const geomHash = view.getBigUint64(at, true); at += 8;
    const landHash = view.getBigUint64(at, true); at += 8;
    const requestWidth = view.getFloat64(at, true); at += 8;
    const finalWidth = view.getFloat64(at, true); at += 8;
    const y0 = view.getFloat64(at, true); at += 8;
    const y1 = view.getFloat64(at, true); at += 8;
    const outer0 = view.getFloat64(at, true); at += 8;
    const outer1 = view.getFloat64(at, true); at += 8;
    const startLength = view.getUint16(at, true); at += 2;
    const endLength = view.getUint16(at, true); at += 2;
    const rows = view.getUint16(at, true); at += 2;
    const columns = view.getUint16(at, true); at += 2;
    const level = aligned[at++];
    const flags = aligned[at++];
    at += 2; // reserved
    const gridYCount = view.getUint32(at, true); at += 4;
    const emitLandCount = view.getUint32(at, true); at += 4;
    if (![requestWidth, finalWidth, y0, y1, outer0, outer1].every(Number.isFinite) ||
      requestWidth <= 0 || finalWidth <= 0 || rows === 0 || columns === 0 ||
      startLength < 16 || startLength > 96 || endLength < 16 || endLength > 96 ||
      level < 6 || gridYCount !== (rows + 1) * (columns + 1)) {
      throw new Error(`Invalid bridge deck record ${chainKey}`);
    }
    need(gridYCount * 4, at);
    let gridY: Float32Array;
    if (littleEndian) {
      gridY = new Float32Array(aligned.buffer, aligned.byteOffset + at, gridYCount);
    } else {
      gridY = new Float32Array(gridYCount);
      for (let k = 0; k < gridYCount; k++) gridY[k] = view.getFloat32(at + k * 4, true);
    }
    for (let k = 0; k < gridYCount; k++) {
      if (!Number.isFinite(gridY[k])) throw new Error(`Non-finite bridge gridY in ${chainKey}`);
    }
    at = align(at + gridYCount * 4, 8);
    need(emitLandCount * 8, at);
    let emitLand: Float64Array;
    if (littleEndian) {
      emitLand = new Float64Array(aligned.buffer, aligned.byteOffset + at, emitLandCount);
    } else {
      emitLand = new Float64Array(emitLandCount);
      for (let k = 0; k < emitLandCount; k++) emitLand[k] = view.getFloat64(at + k * 8, true);
    }
    for (let k = 0; k < emitLandCount; k++) {
      if (!Number.isFinite(emitLand[k]) && !Number.isNaN(emitLand[k])) throw new Error(`Infinite bridge emitLand in ${chainKey}`);
    }
    at += emitLandCount * 8;
    const span: BakedBridgeSpan = {
      chainKey,
      geomHash,
      landHash,
      requestWidth,
      finalWidth,
      narrowRail: (flags & FLAG_NARROW_RAIL) !== 0,
      level,
      smoothStart: (flags & FLAG_SMOOTH_START) !== 0,
      smoothEnd: (flags & FLAG_SMOOTH_END) !== 0,
      ponyTruss: (flags & FLAG_PONY_TRUSS) !== 0,
      startLength,
      endLength,
      y0,
      y1,
      outer0,
      outer1,
      rows,
      columns,
      gridY,
      emitLand,
    };
    spans.push(span);
    let list = byKey.get(chainKey);
    if (!list) byKey.set(chainKey, list = []);
    list.push(span);
  }
  if (at !== len) throw new Error(`Trailing bytes in bridge deck payload: ${len - at}`);
  const village: readonly [number, number] = [villageX, villageZ];
  return {
    area,
    exag,
    seaLevel,
    hasStreams,
    streamsHash,
    village,
    spans,
    find(chainKey: string, width: number, ponyTruss: boolean, geomHash: bigint): BakedBridgeSpan | null {
      const list = byKey.get(chainKey);
      if (!list) return null;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.ponyTruss === ponyTruss && s.geomHash === geomHash && (s.requestWidth === width || s.finalWidth === width)) return s;
      }
      return null;
    },
  };
}

const unavailable = new Set<string>();

/** Start in parallel with the manifest. Only fetches at the default exag (1.5) and sea level (-0.2), with a bounded wait. */
export async function loadBridgeDecks(
  area: string,
  base: string,
  exag: number,
  seaLevel: number,
  timeoutMs = BRIDGE_DECK_LOAD_TIMEOUT_MS,
): Promise<BakedBridgeDecks | null> {
  if (exag !== BAKED_BRIDGE_EXAG || seaLevel !== BAKED_BRIDGE_SEA_LEVEL) return null;
  if (!Object.hasOwn(BRIDGE_DECK_ASSETS, area)) return null;
  const asset = BRIDGE_DECK_ASSETS[area]!;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (asset.file !== 'bridge-decks.bin') throw new Error('Bridge deck asset filename mismatch');
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error(`Bridge deck asset timed out after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    const load = (async () => {
      const url = `${base}/${asset.file}`;
      const res = controller ? await fetch(url, { signal: controller.signal }) : await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      const blob = await res.blob();
      if (blob.size !== asset.bytes) throw new Error('Bridge deck asset length mismatch');
      const bytes = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== asset.sha256) throw new Error('Bridge deck asset hash mismatch');
      const decoded = decodeBridgeDecks(new Uint8Array(bytes), area);
      if (decoded.exag !== exag || decoded.seaLevel !== seaLevel) throw new Error('Bridge deck scale mismatch');
      return decoded;
    })();
    load.catch(() => {});
    return await Promise.race([load, timeout]);
  } catch (error) {
    const key = area + '/' + asset.file;
    if (!unavailable.has(key)) {
      unavailable.add(key);
      console.warn('Baked bridge decks unavailable; solving in browser', area, error);
    }
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
