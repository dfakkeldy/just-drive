// Browser picture and HUD check for Industrial Park Road (Point Tupper road 107) at both spots:
// 1. Overpass over Railroad 216 (formerly a 3 m wooden bridge, now a 7.2 m concrete/asphalt highway overpass)
// 2. Grade rail crossing with Railroad 200
// Run only through tools/yard-shots.sh:
// OUT=<dir> HUD=1 RUN=industrial-park-road-browser.mjs VIEWS="pt|area=pointtupper&mode=explore&radio=0&exag=1.5" tools/yard-shots.sh 1280 720
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { cdp, cdpFetch, sleep, waitForSettled, exitCheck } from './cdp.mjs';

const [runnerOut, ...urls] = process.argv.slice(2), port = process.env.CDP_PORT;
const out = process.env.MMM_CHECK_OUT ? join(process.env.MMM_CHECK_OUT, 'evidence', 'industrial-park-road-browser') : runnerOut;
mkdirSync(out, { recursive: true });

const SPOTS = [
  {
    id: 'overpass-road',
    e: 628408, n: 5051575, heading: 14,
    expectRoad: 'Industrial Park Road',
    expectSurface: 'pavement',
    expectYellow: true,
    checkOverpass: true,
  },
  {
    id: 'overpass-rail',
    e: 628458, n: 5051637, heading: 258,
    expectRoad: 'Railroad',
    expectSurface: 'gravel',
    expectYellow: false,
  },
  {
    id: 'crossing-road',
    e: 629116, n: 5049450, heading: 340,
    expectRoad: 'Industrial Park Road',
    expectSurface: 'pavement',
    expectYellow: true,
  },
  {
    id: 'crossing-rail',
    e: 629097, n: 5049463, heading: 192,
    expectRoad: 'Railroad',
    expectSurface: 'gravel',
    expectYellow: false,
  },
];

const OFF_ROAD_PROBES = [
  { id: 'overpass-brush', e: 628416.5, n: 5051574, heading: 14 },
  { id: 'crossing-brush', e: 629108, n: 5049447, heading: 340 },
];

async function openPage(url) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
  const read = async expression => {
    const r = await c.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result.result.value;
  };
  const close = async () => { try { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); } finally { c.close(); } };
  try {
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'try{localStorage.clear()}catch{}' });
    await c.send('Page.navigate', { url });
    assert.ok(await waitForSettled(read, url, { polls: 360 }), `page settled: ${url} ${c.errors.join(' | ')}`);
    c.assertHealthy();
  } catch (error) { await close(); throw error; }
  const shot = async name => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const bytes = Buffer.from(r.result.data, 'base64');
    writeFileSync(join(out, `${name}.png`), bytes);
    return bytes;
  };
  return { read, close, shot, assertHealthy: c.assertHealthy };
}

async function placeAndSettle(page, e, n, heading) {
  await page.read(`(()=>{
    const [ve, vn] = mmm.terrain.manifest.village;
    mmm.vehicle.place(${e} - ve, vn - ${n}, (${heading}) * Math.PI / 180);
  })()`);
  for (let i = 0; i < 120; i++) {
    const pending = await page.read('mmm.terrain.pending');
    if (pending === 0 && i >= 6) break;
    await sleep(150);
  }
  await sleep(600);
}

// Decode an 8-bit RGB/RGBA PNG buffer and count warm golden-yellow double-yellow centre-line pixels
// on the paved road in the lower-centre strip ahead of the car.
function countYellowInPng(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG header');
  let off = 8, width = 0, height = 0, bpp = 4;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      bpp = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = new Uint8Array(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowIn + x];
      const a = x >= bpp ? pixels[rowOut + x - bpp] : 0;
      const b = y > 0 ? pixels[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[rowOut - stride + x - bpp] : 0;
      pixels[rowOut + x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 255;
    }
  }
  const x0 = Math.floor(width * 0.35), x1 = Math.floor(width * 0.65);
  const y0 = Math.floor(height * 0.42), y1 = Math.floor(height * 0.98);
  let yellow = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * stride;
    for (let x = x0; x < x1; x++) {
      const i = row + x * bpp;
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      // Double-yellow paint (linear 0.55, 0.40, 0.04) renders as warm golden-yellow with low blue.
      if (r > 110 && g > 80 && b < 85 && r - b > 55 && g - b > 30 && r >= g) yellow++;
    }
  }
  return yellow;
}

const baseUrl = urls[0];
assert.ok(baseUrl, 'pass a Point Tupper URL via VIEWS');
const report = { spots: [], offRoad: [] };

const page = await openPage(baseUrl);
try {
  // Check road 107 metadata and overpass -100084 bridge metadata in the loaded world.
  const meta = await page.read(`(()=>{
    const r107 = mmm.roads.roads.find(r => r.id === 107);
    const span = mmm.roads.modern?.spans?.find(s => s.road.id === -100084);
    return {
      r107: r107 ? { id: r107.id, name: r107.name, kind: r107.kind, halfWidth: r107.halfWidth, pavement: r107.pavement ?? null } : null,
      overpass: span ? { id: span.road.id, kind: span.road.kind, halfWidth: span.road.halfWidth, width: span.width, timber: span.timber } : null,
    };
  })()`);
  assert.ok(meta.r107, 'road 107 loaded');
  assert.equal(meta.r107.name, 'Industrial Park Road');
  assert.equal(meta.r107.kind, 2, 'road 107 is paved (kind 2)');
  assert.equal(meta.r107.halfWidth, 3.6, 'road 107 halfWidth is 3.6 m (7.2 m travel width)');
  assert.equal(meta.r107.pavement, 'double-yellow', 'road 107 carries double-yellow paint flag');
  assert.ok(meta.overpass, 'overpass span -100084 loaded');
  assert.equal(meta.overpass.kind, 2, 'overpass -100084 is paved (kind 2)');
  assert.equal(meta.overpass.halfWidth, 3.6, 'overpass -100084 matches 3.6 m halfWidth');
  assert.equal(meta.overpass.timber, false, 'overpass -100084 is concrete/asphalt, not timber');
  report.meta = meta;

  for (const spot of SPOTS) {
    await placeAndSettle(page, spot.e, spot.n, spot.heading);
    const state = await page.read(`(()=>{
      const hud = document.getElementById('hud')?.textContent ?? '';
      const t = mmm.terrain.find(mmm.vehicle.x, mmm.vehicle.z);
      return {
        roadName: mmm.vehicle.roadName,
        surfaceName: mmm.vehicle.surfaceName,
        hudFirstLine: hud.split('\\n')[0] ?? '',
        roadPavementDefine: t?.mesh?.material?.defines?.ROAD_PAVEMENT ?? 0,
      };
    })()`);
    assert.equal(state.roadName, spot.expectRoad, `${spot.id}: roadName`);
    assert.equal(state.surfaceName, spot.expectSurface, `${spot.id}: surfaceName`);
    assert.ok(state.hudFirstLine.includes(spot.expectRoad), `${spot.id}: HUD line names ${spot.expectRoad} (${state.hudFirstLine})`);
    assert.ok(!state.hudFirstLine.includes('rail trail'), `${spot.id}: HUD never labels active railway as rail trail (${state.hudFirstLine})`);
    const png = await page.shot(spot.id);
    let yellowPixels = 0;
    if (spot.expectYellow) {
      assert.equal(state.roadPavementDefine, 1, `${spot.id}: terrain tile enables ROAD_PAVEMENT`);
      yellowPixels = countYellowInPng(png);
      assert.ok(yellowPixels >= 40, `${spot.id}: double-yellow centre paint visible on road (${yellowPixels} yellow pixels)`);
    }
    report.spots.push({ ...spot, ...state, yellowPixels });
    console.log(`PASS ${spot.id}: ${state.hudFirstLine} (ROAD_PAVEMENT=${state.roadPavementDefine}, yellowPx=${yellowPixels})`);
  }

  for (const probe of OFF_ROAD_PROBES) {
    await placeAndSettle(page, probe.e, probe.n, probe.heading);
    const state = await page.read(`({
      roadName: mmm.vehicle.roadName,
      surfaceName: mmm.vehicle.surfaceName,
      hudFirstLine: (document.getElementById('hud')?.textContent ?? '').split('\\n')[0] ?? '',
    })`);
    assert.equal(state.roadName, null, `${probe.id}: off-road brush clears vehicle.roadName`);
    assert.ok(state.hudFirstLine.includes('off the map'), `${probe.id}: HUD reads off the map (${state.hudFirstLine})`);
    assert.ok(!state.hudFirstLine.includes('Industrial Park Road'), `${probe.id}: HUD does not name Industrial Park Road in brush (${state.hudFirstLine})`);
    report.offRoad.push({ ...probe, ...state });
    console.log(`PASS ${probe.id}: ${state.hudFirstLine}`);
  }

  page.assertHealthy();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('PASS industrial-park-road-browser: both spots, overpass, yellow paint, Railroad label, and off-road HUD verified');
} finally {
  await page.close();
}
exitCheck();
