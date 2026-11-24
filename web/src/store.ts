// Reads baked terrain files. On a host that limits the number of files, the tiles are packed into
// larger files (tools/pack_terrain.py); the game then cuts each tile out of its pack.
// Without packs.json (the dev server), every tile is fetched as its own file.

interface PackIndex { packs: number; files: Record<string, [number, number, number]> }

let index: PackIndex | null = null;
const loaded = new Map<number, Promise<ArrayBuffer>>();
const KEEP = 14;   // packs kept in memory; a tile is decoded once, so old packs can go

export async function initStore(base: string) {
  try {
    const res = await fetch(`${base}/packs.json`);
    const data = res.ok ? await res.json() : null;
    index = data && typeof data.packs === 'number' ? data : null;
  } catch {
    index = null;   // the dev server answers with its HTML page here
  }
}

/** A pack is a PNG used as a byte container: RGB pixels, the first four bytes give the payload length. */
async function unpack(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const n = px.length / 4, bytes = new Uint8Array(n * 3);
  for (let i = 0, o = 0; i < px.length; i += 4) { bytes[o++] = px[i]; bytes[o++] = px[i + 1]; bytes[o++] = px[i + 2]; }
  const len = new DataView(bytes.buffer).getUint32(0, true);
  if (len + 4 > bytes.length) throw new Error(`bad pack ${url}`);
  return bytes.buffer.slice(4, 4 + len);
}

function pack(base: string, i: number): Promise<ArrayBuffer> {
  let p = loaded.get(i);
  if (p) { loaded.delete(i); loaded.set(i, p); return p; }   // move to the newest end
  p = unpack(`${base}/p/${i}.png`);
  p.catch(() => { if (loaded.get(i) === p) loaded.delete(i); });   // only this request: a newer one for the same pack stays
  loaded.set(i, p);
  while (loaded.size > KEEP) loaded.delete(loaded.keys().next().value!);
  return p;
}

/** The bytes of one baked file. Direct companions bypass the tile index; tile reads stay strict. */
export async function readFile(base: string, path: string, direct = false, signal?: AbortSignal): Promise<Blob> {
  const entry = direct ? undefined : index?.files[path];
  if (entry) {
    const [n, at, size] = entry;
    if (!Number.isInteger(at) || at < 0 || !Number.isInteger(size) || size < 0) throw new Error(`bad offset or length in the pack index: ${path}`);
    const request = pack(base, n), buf = await request;
    // An index newer than a cached pack names bytes the pack does not have: drop that pack, so a retry reads it again.
    if (at + size > buf.byteLength) { if (loaded.get(n) === request) loaded.delete(n); throw new Error(`pack too short, file out of bounds: ${path}`); }
    return new Blob([new Uint8Array(buf, at, size)]);
  }
  if (index && !direct) throw new Error(`not in any pack: ${path}`);
  const res = signal ? await fetch(`${base}/${path}`, { signal }) : await fetch(`${base}/${path}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.blob();
}
