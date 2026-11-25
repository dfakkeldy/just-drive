// Verify static-asset short links (_redirects), built target page, CHURCH_START alignment,
// build_site.sh copy, Wrangler run_worker_first bypass, and service-worker redirect chain.
// Usage:
//   node tools/site-redirects-check.mjs <built-site-dir>   (verifies real built output)
//   node tools/site-redirects-check.mjs --source           (source-only check, no land data needed)
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../web/node_modules/esbuild/lib/main.js';
import { AREAS } from '../web/src/area.ts';
import { HISTORY_AREAS } from '../web/src/eras/history-areas.ts';
import { harness } from './pwa-harness.mjs';
import { justPage } from './site-pages.mjs';

process.on('uncaughtException', e => { console.error(e.name + ': ' + e.message); process.exit(1); });

const JUST_ORIGIN = 'https://justdrive.fakkeldy.ca';
const RDMC_PATHS = ['/rdmc', '/rdmc/'];
const EXPECTED_PATH = '/judique';
const MAIL_ORIGIN = 'https://mmm.fakkeldy.ca';
const BLACKSTONE_PATHS = ['/blackstone', '/blackstone/'];
const BLACKSTONE_URL = `${MAIL_ORIGIN}/?mode=mail&start=blackstone-road:0.43`;
const BLACKSTONE_NEAR = 30;   // metres: the start pose must sit this close to a point of the road

export function parseRedirectsFile(text) {
  const rules = [];
  const seen = new Set();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.replace(/\s+#.*$/, '').split(/\s+/);
    assert.ok(tokens.length === 2 || tokens.length === 3, `_redirects line ${index + 1}: expected 2 or 3 tokens`);
    const [from, to, code = '302'] = tokens;
    assert.ok(!seen.has(from), `_redirects line ${index + 1}: duplicate source ${from}`);
    seen.add(from);
    const status = Number(code);
    assert.ok([200, 301, 302, 303, 307, 308].includes(status), `_redirects line ${index + 1}: invalid status ${code}`);
    rules.push({ from, to, status, lineNumber: index + 1 });
  }
  return rules;
}

export function verifyRdmcRedirects(text, churchStart, readDrivePosition, isTestVisit, readSite) {
  const rules = parseRedirectsFile(text);
  const expectedE = churchStart.e;
  const expectedN = churchStart.n;
  const expectedHeadingDeg = Math.round(churchStart.heading * 180 / Math.PI);
  const exactHeadingDeg = churchStart.heading * 180 / Math.PI;
  assert.ok(Math.abs(expectedHeadingDeg - exactHeadingDeg) <= 0.5, 'rounded CHURCH_START heading within 0.5 deg');

  const expectedQuery = `?driveAt=${expectedE},${expectedN},${expectedHeadingDeg}`;
  const expectedUrl = `${JUST_ORIGIN}${EXPECTED_PATH}${expectedQuery}`;
  for (const sourcePath of RDMC_PATHS) {
    const rule = rules.find(r => r.from === sourcePath);
    assert.ok(rule, `missing redirect rule for ${sourcePath}`);
    assert.equal(rule.status, 302, `${sourcePath} must use a 302 redirect`);
    assert.equal(rule.to, expectedUrl, `${sourcePath} target must match CHURCH_START (${expectedUrl})`);
    const target = new URL(rule.to, JUST_ORIGIN);
    assert.equal(target.origin, JUST_ORIGIN);
    assert.equal(target.pathname, EXPECTED_PATH);
    const pose = readDrivePosition(target.searchParams);
    assert.deepEqual(pose, [expectedE, expectedN, expectedHeadingDeg], `${sourcePath} driveAt parses cleanly`);
    assert.equal(isTestVisit(target.searchParams), false, `${sourcePath} target keeps the normal title card`);
    assert.deepEqual(readSite('justdrive.fakkeldy.ca', target.pathname, target.searchParams), { brand: 'just', area: 'judique' });
  }
  return { expectedUrl, rules };
}

/** Metres from a point to the nearest part of a road line (segments, not only vertices). */
export function distanceToLine(px, pz, pts) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, pz - az - t * dz));
  }
  return best;
}

const lineLength = pts => pts.reduce((sum, p, i) => i ? sum + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

/** The game mode the link opens with, even when the browser saved Explore or Get Fired. */
export function assertMailMode(url, readMode, readSite) {
  const target = new URL(url);
  const site = readSite(target.hostname, target.pathname, target.searchParams);
  for (const saved of ['explore', 'fired', 'mail', null]) {
    assert.equal(readMode(target.searchParams, () => ({ getItem: () => saved }), site), 'mail', `the link opens the mail game (saved choice: ${saved})`);
  }
}

/** The pose pins the share: it is 0.43 of the longest Blackstone Road piece, and no other share gives it. */
export function assertSharePinned(pose, otherPose, roads) {
  const pieces = roads.filter(r => r.name === 'Blackstone Road' && r.kind >= 1 && r.kind <= 3 && !r.bridge && r.pts.length >= 2);
  const total = Math.max(...pieces.map(r => lineLength(r.pts)));
  assert.ok(Math.abs(pose.distance - total * (1 - 0.43)) < 1, `start pose is 0.43 of the road (${pose.distance.toFixed(1)} m left of ${total.toFixed(1)} m)`);
  assert.ok(Math.hypot(pose.x - otherPose.x, pose.z - otherPose.z) > 1, 'share 0.40 gives another place than share 0.43');
}

/**
 * The /blackstone short link: a 302 to the mail game with a mode key and a start key. roads are in local metres
 * (x east, z south of the village), bounds are the playable box, both as the game builds them.
 */
export function verifyBlackstoneRedirects(text, startKey, isTestVisit, readSite, roads, bounds, readMode) {
  const rules = parseRedirectsFile(text);
  for (const sourcePath of BLACKSTONE_PATHS) {
    const rule = rules.find(r => r.from === sourcePath);
    assert.ok(rule, `missing redirect rule for ${sourcePath}`);
    assert.equal(rule.status, 302, `${sourcePath} must use a 302 redirect`);
    assert.equal(rule.to, BLACKSTONE_URL, `${sourcePath} target must be ${BLACKSTONE_URL}`);
    const target = new URL(rule.to);
    assert.equal(target.origin, MAIL_ORIGIN);
    assert.equal(target.pathname, '/');
    assert.deepEqual(readSite('mmm.fakkeldy.ca', target.pathname, target.searchParams), { brand: 'mail', area: null }, `${sourcePath} opens the mail game`);
    assert.equal(isTestVisit(target.searchParams), false, `${sourcePath} target keeps the normal title card`);
    assertMailMode(rule.to, readMode, readSite);
    const pose = startKey(target.searchParams.get('start'), roads, bounds);
    assert.ok(pose, `${sourcePath} start key gives a pose inside the land`);
    const near = Math.min(...roads.filter(r => r.name === 'Blackstone Road').map(r => distanceToLine(pose.x, pose.z, r.pts)));
    assert.ok(near <= BLACKSTONE_NEAR, `${sourcePath} start pose lies within ${BLACKSTONE_NEAR} m of Blackstone Road (${near.toFixed(1)} m)`);
    const other = startKey('blackstone-road:0.40', roads, bounds);
    assert.ok(other, 'share 0.40 gives a pose');
    assertSharePinned(pose, other, roads);
  }
  return { expectedUrl: BLACKSTONE_URL, rules };
}

/** Does a run_worker_first pattern list send this path to the Worker ahead of static assets? */
export function runsWorkerFirst(patterns, path) {
  return patterns.some(pattern => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : path === pattern);
}

export function verifyBuiltSite(siteDir, expectedRedirectsText, churchStart, readDrivePosition, isTestVisit, readSite, read = readFileSync) {
  const redirectsPath = resolve(siteDir, '_redirects');
  const builtRedirects = read(redirectsPath, 'utf8');
  assert.equal(builtRedirects, expectedRedirectsText, 'built _redirects must equal deploy/_redirects');
  const parsed = verifyRdmcRedirects(builtRedirects, churchStart, readDrivePosition, isTestVisit, readSite);
  const judiquePagePath = resolve(siteDir, 'just/judique/index.html');
  const judiqueHtml = read(judiquePagePath, 'utf8');
  assert.match(judiqueHtml, /<title>Just Drive: Judique<\/title>/, 'built Judique target page has the Judique title');
  assert.match(judiqueHtml, /property="og:url" content="https:\/\/justdrive\.fakkeldy\.ca\/judique"/, 'built Judique target page has the Judique URL');
  const manifestPath = resolve(siteDir, 'areas/judique/manifest.json');
  const manifest = JSON.parse(read(manifestPath, 'utf8'));
  assert.equal(manifest.area?.id, 'judique', 'built site carries the Judique land manifest');
  assert.ok(Array.isArray(manifest.village) && manifest.village.length === 2, 'built Judique manifest has village origin');
  const [east, north] = manifest.village;
  const bounds = Array.isArray(manifest.mid) && manifest.mid.length === 4
    ? [manifest.mid[0] - east + 120, north - manifest.mid[3] + 120, manifest.mid[2] - east - 120, north - manifest.mid[1] - 120]
    : null;
  const target = new URL(parsed.expectedUrl);
  assert.ok(readDrivePosition(target.searchParams, manifest.village, bounds), 'built Judique manifest bounds accept the /rdmc driveAt pose');
  return { ...parsed, builtRedirects, judiqueHtml, manifest };
}

async function loadModules() {
  const { outputFiles } = await build({
    stdin: {
      contents: "export { CHURCH_START } from './church-site'; export { readDrivePosition } from './light-study'; export { isTestVisit } from './visit'; export { readSite } from './site'; export { startKey } from './start-key'; export { readMode } from './mode';",
      resolveDir: process.cwd() + '/web/src',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));
}

function buildSourceSw() {
  const connectionMeta = Object.fromEntries([...AREAS, null].map(area => [area?.id ?? 'unknown', { title: area ? `Just Drive: ${area.name}` : 'Just Drive', head: justPage('<html><head></head><body></body></html>', area).match(/<head>([\s\S]*?)<\/head>/)[1] }]));
  return `const JUST_AREAS = ${JSON.stringify(['sugar-camp-quarry', ...AREAS.map(area => area.id), ...Object.values(HISTORY_AREAS).map(a => a.address)])};\nconst JUST_ALIASES = ${JSON.stringify({ ...Object.fromEntries(Object.values(HISTORY_AREAS).map(a => [a.address, a.id])), 'sugar-camp-quarry': 'westbay' })};\nconst JUST_META = ${JSON.stringify(connectionMeta)};\n` + readFileSync('web/pwa/sw.js', 'utf8');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const sourceOnly = args.includes('--source');
  const siteDir = args.find(a => !a.startsWith('--'));
  if (!sourceOnly && !siteDir) {
    console.error('Usage: node tools/site-redirects-check.mjs <built-site-dir> | --source');
    process.exit(2);
  }

  const { CHURCH_START, readDrivePosition, isTestVisit, readSite, startKey, readMode } = await loadModules();
  const judique = AREAS.find(a => a.id === 'judique');
  assert.ok(judique?.church, 'Judique area is registered with the church enabled');

  const sourceRedirects = readFileSync('deploy/_redirects', 'utf8');
  const { expectedUrl, rules } = verifyRdmcRedirects(sourceRedirects, CHURCH_START, readDrivePosition, isTestVisit, readSite);

  // Roads for the /blackstone start key. Built mode reads the built site's terrain files the way the game does
  // (web/src/roads.ts: x = east - village[0], z = village[1] - north; main.ts: the box of fine data less 120 m).
  // Source mode has no land data, so a small synthetic road only proves the share parses.
  let roads, bounds;
  if (siteDir) {
    const terrain = JSON.parse(readFileSync(resolve(siteDir, 'terrain/manifest.json'), 'utf8'));
    const [east, north] = terrain.village, mid = terrain.mid;
    roads = JSON.parse(readFileSync(resolve(siteDir, 'terrain/roads.json'), 'utf8')).roads.map(r => ({ ...r, pts: r.pts.map(([e, n]) => [e - east, north - n]) }));
    bounds = [mid[0] - east + 120, north - mid[3] + 120, mid[2] - east - 120, north - mid[1] - 120];
  } else {
    roads = [{ name: 'Blackstone Road', kind: 3, bridge: false, pts: Array.from({ length: 301 }, (_, i) => [i * 10, 0]) }, { name: 'Main Road', kind: 2, bridge: false, pts: [[0, -100], [0, 100]] }];
    bounds = [-5000, -5000, 5000, 5000];
  }
  const blackstone = verifyBlackstoneRedirects(sourceRedirects, startKey, isTestVisit, readSite, roads, bounds, readMode);

  let builtJudiqueHtml = '<title>Just Drive: Judique</title>';
  let swSource;
  if (siteDir) {
    const built = verifyBuiltSite(siteDir, sourceRedirects, CHURCH_START, readDrivePosition, isTestVisit, readSite);
    builtJudiqueHtml = built.judiqueHtml;
    const builtSwPath = resolve(siteDir, 'sw.js');
    assert.ok(existsSync(builtSwPath), 'built site contains sw.js');
    swSource = readFileSync(builtSwPath, 'utf8');
  } else {
    swSource = buildSourceSw();
  }

  // tools/build_site.sh must copy deploy/_redirects into the built site root.
  const buildScript = readFileSync('tools/build_site.sh', 'utf8');
  assert.match(buildScript, /cp\s+"\$ROOT\/deploy\/_redirects"\s+"\$SITE\/_redirects"/, 'build_site.sh copies deploy/_redirects into $SITE/_redirects');

  // deploy/wrangler.jsonc must not route /rdmc or /rdmc/ to the Worker ahead of static assets.
  const wrangler = readFileSync('deploy/wrangler.jsonc', 'utf8');
  const runWorkerFirst = JSON.parse(wrangler.match(/"run_worker_first":\s*(\[[^\]]*\])/)[1]);
  for (const sourcePath of [...RDMC_PATHS, ...BLACKSTONE_PATHS]) {
    assert.equal(runsWorkerFirst(runWorkerFirst, sourcePath), false, `${sourcePath} must not match run_worker_first (${JSON.stringify(runWorkerFirst)})`);
  }
  for (const sourcePath of BLACKSTONE_PATHS) {
    assert.equal(runsWorkerFirst([...runWorkerFirst, '/blackstone*'], sourcePath), true, `negative control: a pattern for ${sourcePath} sends it to the Worker`);
    assert.equal(runsWorkerFirst([...runWorkerFirst, sourcePath], sourcePath), true, `negative control: an exact pattern for ${sourcePath} sends it to the Worker`);
  }

  // Returning visitors with an installed service worker: follow the actual 302 redirect chain
  // and verify the final navigation preserves the full driveAt query string.
  const justHarness = await harness(swSource, { origin: JUST_ORIGIN });
  justHarness.build('A');
  justHarness.routes.set('/version-just.json', justHarness.routes.get('/version.json').clone());
  await justHarness.api.latest();
  assert.ok(await justHarness.api.stored(), `${JUST_ORIGIN}: saved offline shell is active`);

  const mailHarness = await harness(swSource, { origin: 'https://mmm.fakkeldy.ca' });
  mailHarness.build('A');
  await mailHarness.api.latest();
  assert.ok(await mailHarness.api.stored(), 'https://mmm.fakkeldy.ca: saved offline shell is active');

  // Wrap fetch in justHarness context so we assert the exact URL (including query string) passed to network fetch.
  const fetchedUrls = [];
  const origFetch = justHarness.context.fetch;
  justHarness.context.fetch = async (input, opts) => {
    fetchedUrls.push(typeof input === 'string' ? input : input.url);
    return origFetch(input, opts);
  };
  justHarness.routes.set(EXPECTED_PATH, new Response(builtJudiqueHtml, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

  for (const [origin, h] of [[JUST_ORIGIN, justHarness], ['https://mmm.fakkeldy.ca', mailHarness]]) {
    for (const sourcePath of RDMC_PATHS) {
      // Offline too: sw.js must never hijack /rdmc or /rdmc/.
      h.network(false);
      let offlineIntercepted = false;
      h.listeners.fetch({
        request: { url: origin + sourcePath, method: 'GET', mode: 'navigate', headers: new Headers() },
        respondWith() { offlineIntercepted = true; },
        waitUntil() {},
      });
      assert.equal(offlineIntercepted, false, `${origin}${sourcePath} (offline) must bypass sw.js`);

      // Online chain: sw.js passes /rdmc to network -> static-asset 302 -> browser navigates to Location on justdrive.
      h.network(true);
      let onlineIntercepted = false;
      h.listeners.fetch({
        request: { url: origin + sourcePath, method: 'GET', mode: 'navigate', headers: new Headers() },
        respondWith() { onlineIntercepted = true; },
        waitUntil() {},
      });
      assert.equal(onlineIntercepted, false, `${origin}${sourcePath} (online) must bypass sw.js`);

      const matched = rules.find(r => r.from === sourcePath);
      const destination = new URL(matched.to, origin + sourcePath);
      const locationHeader = destination.origin === origin ? `${destination.pathname}${destination.search}` : destination.href;
      const followed = new URL(locationHeader, origin + sourcePath);
      assert.equal(followed.href, expectedUrl, `${origin}${sourcePath} followed Location resolves to ${expectedUrl}`);

      fetchedUrls.length = 0;
      justHarness.network(true);
      const targetNav = await justHarness.nav(`rdmc-${origin}-${sourcePath}`, (followed.pathname + followed.search).slice(1));
      assert.equal(targetNav.response.status, 200, `followed navigation from ${origin}${sourcePath} succeeds`);
      assert.match(targetNav.body, /<title>Just Drive: Judique<\/title>/);
      assert.deepEqual(fetchedUrls, [expectedUrl], `sw.js preserves full driveAt query on network fetch (${origin}${sourcePath})`);
    }
  }

  // /blackstone: sw.js must pass both paths to the network, online and offline, on both hosts.
  for (const [origin, h] of [[JUST_ORIGIN, justHarness], [MAIL_ORIGIN, mailHarness]]) {
    for (const sourcePath of BLACKSTONE_PATHS) {
      for (const online of [false, true]) {
        h.network(online);
        let intercepted = false;
        h.listeners.fetch({
          request: { url: origin + sourcePath, method: 'GET', mode: 'navigate', headers: new Headers() },
          respondWith() { intercepted = true; },
          waitUntil() {},
        });
        assert.equal(intercepted, false, `${origin}${sourcePath} (${online ? 'online' : 'offline'}) must bypass sw.js`);
      }
      const rule = blackstone.rules.find(r => r.from === sourcePath);
      assert.equal(new URL(rule.to, origin + sourcePath).href, BLACKSTONE_URL, `${origin}${sourcePath} Location resolves to ${BLACKSTONE_URL}`);
    }
  }
  justHarness.network(true);

  // Follow the Blackstone Location: the mail root page comes back with the full query kept.
  const followBlackstone = async (url, id) => {
    const q = new URL(url);
    mailHarness.network(true);
    const nav = await mailHarness.nav(id, q.search);
    assert.equal(nav.response.status, 200, 'followed navigation to the mail root succeeds');
    assert.match(nav.body, /mmm-page/, 'the mail root page comes back from the sw.js shell or network');
    assert.equal(mailHarness.live.get(id), MAIL_ORIGIN + '/' + q.search, 'the page address keeps the full query');
    assert.equal(new URL(mailHarness.live.get(id)).searchParams.get('start'), 'blackstone-road:0.43', 'the start key survives');
    assert.equal(new URL(mailHarness.live.get(id)).searchParams.get('mode'), 'mail', 'the mode key survives');
    return nav;
  };
  await followBlackstone(blackstone.expectedUrl, 'blackstone-follow');
  await assert.rejects(() => followBlackstone(`${MAIL_ORIGIN}/`, 'blackstone-dropped'), /start key survives|full query/, 'negative control: a Location that drops the query fails');

  // Offline navigation to the Judique destination must return the honest 503 connection page.
  justHarness.network(false);
  const offlineNav = await justHarness.nav('rdmc-offline', (new URL(expectedUrl).pathname + new URL(expectedUrl).search).slice(1));
  assert.equal(offlineNav.response.status, 503, 'offline navigation to Judique target shows honest 503 connection page');
  assert.match(offlineNav.body, /Just Drive: Judique/);

  // Self-check negative controls: missing line, wrong status, CHURCH_START drift, and missing built Judique page must fail.
  assert.throws(() => verifyRdmcRedirects(sourceRedirects.replace(/^\/rdmc .*$/m, ''), CHURCH_START, readDrivePosition, isTestVisit, readSite), /missing redirect rule for \/rdmc/);
  assert.throws(() => verifyRdmcRedirects(sourceRedirects.replace(/^\/rdmc\/ .*$/m, ''), CHURCH_START, readDrivePosition, isTestVisit, readSite), /missing redirect rule for \/rdmc\//);
  assert.throws(() => verifyRdmcRedirects(sourceRedirects.replace(' 302', ' 301'), CHURCH_START, readDrivePosition, isTestVisit, readSite), /must use a 302 redirect/);
  assert.throws(() => verifyRdmcRedirects(sourceRedirects, { ...CHURCH_START, e: CHURCH_START.e + 1 }, readDrivePosition, isTestVisit, readSite), /target must match CHURCH_START/);
  assert.throws(() => verifyRdmcRedirects(sourceRedirects, { ...CHURCH_START, heading: CHURCH_START.heading + 0.1 }, readDrivePosition, isTestVisit, readSite), /target must match CHURCH_START/);
  const blackstoneCheck = (text, bounds2 = bounds, roads2 = roads) => verifyBlackstoneRedirects(text, startKey, isTestVisit, readSite, roads2, bounds2, readMode);
  assert.throws(() => blackstoneCheck(sourceRedirects.replace(/^\/blackstone .*$/m, '')), /missing redirect rule for \/blackstone/);
  assert.throws(() => blackstoneCheck(sourceRedirects.replace(/^\/blackstone\/ .*$/m, '')), /missing redirect rule for \/blackstone\//);
  assert.throws(() => blackstoneCheck(sourceRedirects.replace(/^(\/blackstone .*) 302$/m, '$1 301')), /must use a 302 redirect/);
  assert.throws(() => blackstoneCheck(sourceRedirects.replaceAll('blackstone-road:0.43', 'blackstone-road:0.40')), /target must be/);
  assert.throws(() => blackstoneCheck(sourceRedirects.replaceAll('mode=mail&', '')), /target must be/);
  // The mode check alone: a link without mode=mail opens Explore for a visitor who saved it.
  assert.throws(() => assertMailMode(`${MAIL_ORIGIN}/?start=blackstone-road:0.43`, readMode, readSite), /opens the mail game/);
  assert.throws(() => assertMailMode(`${MAIL_ORIGIN}/?mode=explore&start=blackstone-road:0.43`, readMode, readSite), /opens the mail game/);
  // Malformed shares reach the parser itself. A tail that is no share belongs to the road's name (an unknown road
  // gives null) or is dropped (the normal start, 150 m before the end): never the place of share 0.43.
  const good = startKey('blackstone-road:0.43', roads, bounds);
  for (const bad of ['1.43', '0.43x', 'abc', '-0.1', '.', '0.4.3', '1e-1', '']) {
    const pose = startKey('blackstone-road:' + bad, roads, bounds);
    assert.ok(pose === null || Math.hypot(pose.x - good.x, pose.z - good.z) > 1, `share "${bad}" is not read as 0.43`);
  }
  assert.ok(startKey('blackstone-road:0.43', roads, bounds), 'share 0.43 is read by the start key');
  // The share is pinned: share 0.40 (a different place, even on a dense road) is not accepted as 0.43.
  const pose43 = startKey('blackstone-road:0.43', roads, bounds), pose40 = startKey('blackstone-road:0.40', roads, bounds);
  assertSharePinned(pose43, pose40, roads);
  assert.throws(() => assertSharePinned(pose40, pose43, roads), /is 0\.43 of the road/);
  assert.throws(() => assertSharePinned(pose43, pose43, roads), /another place/);
  // Distance is measured to the line segments, not only the vertices.
  assert.equal(distanceToLine(5, 3, [[0, 0], [10, 0]]), 3);
  assert.throws(() => blackstoneCheck(sourceRedirects, bounds, roads.map(r => ({ ...r, name: r.name === 'Blackstone Road' ? 'Other Road' : r.name }))), /gives a pose/);
  assert.throws(() => blackstoneCheck(sourceRedirects, [1e6, 1e6, 2e6, 2e6]), /gives a pose/);
  if (siteDir) {
    assert.throws(() => verifyBuiltSite(siteDir, sourceRedirects, CHURCH_START, readDrivePosition, isTestVisit, readSite, (p, enc) => {
      if (p.endsWith('just/judique/index.html')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return readFileSync(p, enc);
    }), /ENOENT/);
    assert.throws(() => verifyBuiltSite(siteDir, sourceRedirects, CHURCH_START, readDrivePosition, isTestVisit, readSite, (p, enc) => {
      if (p.endsWith('areas/judique/manifest.json')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return readFileSync(p, enc);
    }), /ENOENT/);
  }

  console.log(`PASS ${siteDir ? 'built site' : 'source'} /blackstone and /blackstone/ 302 -> ${BLACKSTONE_URL} (mail mode, pose pinned, sw.js followed); /rdmc and /rdmc/ 302 -> ${expectedUrl}; CHURCH_START aligned; ${siteDir ? 'built Judique page, manifest and sw.js' : 'build_site.sh copy'}; Worker bypass; sw.js redirect chain preserves driveAt; negative controls rejected`);
}
