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
      contents: "export { CHURCH_START } from './church-site'; export { readDrivePosition } from './light-study'; export { isTestVisit } from './visit'; export { readSite } from './site';",
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

  const { CHURCH_START, readDrivePosition, isTestVisit, readSite } = await loadModules();
  const judique = AREAS.find(a => a.id === 'judique');
  assert.ok(judique?.church, 'Judique area is registered with the church enabled');

  const sourceRedirects = readFileSync('deploy/_redirects', 'utf8');
  const { expectedUrl, rules } = verifyRdmcRedirects(sourceRedirects, CHURCH_START, readDrivePosition, isTestVisit, readSite);

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
  for (const sourcePath of RDMC_PATHS) {
    const matches = runWorkerFirst.some(pattern => pattern.endsWith('*') ? sourcePath.startsWith(pattern.slice(0, -1)) : sourcePath === pattern);
    assert.equal(matches, false, `${sourcePath} must not match run_worker_first (${JSON.stringify(runWorkerFirst)})`);
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

  console.log(`PASS ${siteDir ? 'built site' : 'source'} /rdmc and /rdmc/ 302 -> ${expectedUrl}; CHURCH_START aligned; ${siteDir ? 'built Judique page, manifest and sw.js' : 'build_site.sh copy'}; Worker bypass; sw.js redirect chain preserves driveAt; negative controls rejected`);
}
