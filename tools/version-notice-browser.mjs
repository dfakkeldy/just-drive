// Real public main + real offline worker; publisher switches version files, chunks and HTML without touching source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { build as viteBuild } from '../web/node_modules/vite/dist/node/index.js';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

process.chdir(new URL('..', import.meta.url).pathname);
const out = resolve(process.argv[2]), root = out + '/site', port = process.env.CDP_PORT;
const versions = Object.fromEntries(['mail', 'just'].map(brand => [brand, JSON.parse(readFileSync(root + (brand === 'just' ? '/version-just.json' : '/version.json')))]));
const hash = body => createHash('sha256').update(body).digest('hex');
const bundles = {}, allFiles = new Map(), publishers = {};

// Build real public bundles (app.js + chunks/*) for each mutation fault.
process.chdir(new URL('../web', import.meta.url).pathname);
for (const name of ['no-reload-guard', 'reload-after-start', 'poll-hidden']) {
  let hits = 0;
  const result = await viteBuild({
    configFile: resolve('vite.artifact.config.ts'),
    root: process.cwd(),
    logLevel: 'error',
    define: { __PUBLIC_APP__: 'true', 'import.meta.env.VITE_MP': '"1"' },
    plugins: [{
      name: 'version-notice-fault',
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('/src/offline-version.ts')) return;
        const replacements = name === 'no-reload-guard'
          ? [["if (!validKey(target) || sessionStorage.getItem(ATTEMPT_PREFIX + target) === '1') return false;", "if (!validKey(target)) return false;"],
             ["try { return sessionStorage.getItem(ATTEMPT_PREFIX + target) === '1'; }", "try { return false; }"],
             ['const pending = savedTarget();', 'const pending = undefined as { from: string; target: string } | undefined;']]
          : name === 'reload-after-start'
            ? [['&& mayReload()', '&& true']]
            : [["document.visibilityState !== 'visible' || checking", 'checking'], ["document.visibilityState !== 'visible' || stopped", 'stopped']];
        for (const [from, to] of replacements) {
          assert.ok(code.includes(from), name + ' anchor: ' + from);
          code = code.replace(from, to);
        }
        hits++;
        return code;
      }
    }],
    build: { write: false }
  });
  assert.equal(hits, 1, name + ' transform hit');
  const files = new Map();
  for (const chunk of result.output) if (chunk.type === 'chunk') files.set(chunk.fileName, Buffer.from(chunk.code));
  assert.ok(files.has('app.js'), name + ' produced app.js');
  bundles[name] = files;
}
process.chdir(new URL('..', import.meta.url).pathname);

const fixedBundle = new Map([['app.js', readFileSync(root + '/app.js')]]);
if (existsSync(root + '/chunks')) {
  for (const name of readdirSync(root + '/chunks').filter(n => n.endsWith('.js')).sort()) {
    fixedBundle.set('chunks/' + name, readFileSync(root + '/chunks/' + name));
  }
}

function shell(v, index, bundleFiles, pageKey, builtAt) {
  const app = bundleFiles.get('app.js');
  const appURL = `/offline/app.${hash(app)}.js`;
  const oldApp = index.shell.find(f => f.url.startsWith('/offline/app.'));
  const preloads = [...new Set([...app.toString('utf8').matchAll(/(?:\bfrom|\bimport)\s*"\.\/chunks\/([\w-]+\.js)"/g)].map(m => m[1]))];
  let page = readFileSync(root + index.page, 'utf8')
    .replace(oldApp.url, appURL)
    .replace(/<link rel="modulepreload"[^>]*>\n?/g, '')
    .replace('</head>', preloads.map(name => `<link rel="modulepreload" href="/offline/chunks/${name}">\n`).join('') + '</head>')
    .replace(/(<meta name="mmm-page" content=")[^"]+/, `$1${pageKey}`)
    .replace(/(<meta name="mmm-built-at" content=")[^"]+/, `$1${builtAt}`);
  const pageURL = `/offline/page.${hash(page)}.html`;
  const chunkEntries = [];
  for (const [fileName, bytes] of bundleFiles) {
    if (!fileName.startsWith('chunks/')) continue;
    const url = `/offline/${fileName}`;
    allFiles.set(url, bytes);
    chunkEntries.push({ url, bytes: bytes.length, hash: hash(bytes) });
  }
  const baseShell = index.shell
    .filter(f => !f.url.startsWith('/offline/chunks/'))
    .map(f => f.url === index.page
      ? { url: pageURL, bytes: Buffer.byteLength(page), hash: hash(page) }
      : f.url === oldApp.url
        ? { url: appURL, bytes: app.length, hash: hash(app) }
        : f);
  const next = { ...index, builtAt, pageKey, page: pageURL, shell: [...baseShell, ...chunkEntries] };
  next.totalBytes = next.shell.reduce((sum, f) => sum + f.bytes, 0) + index.files.reduce((sum, f) => sum + f.bytes, 0);
  const encoded = JSON.stringify(next), revision = hash(encoded), indexURL = `/offline/files.${revision}.json`;
  const version = { ...v, builtAt, pageKey, revision, index: indexURL };
  allFiles.set(appURL, app);
  allFiles.set(pageURL, Buffer.from(page));
  allFiles.set(indexURL, Buffer.from(encoded));
  allFiles.set(`/offline/start.${pageKey}.json`, Buffer.from(JSON.stringify(version)));
  return { version, bundleFiles, app, appURL };
}

for (const variant of ['fixed', 'no-reload-guard']) {
  publishers[variant] = {};
  const baseFiles = variant === 'fixed' ? fixedBundle : bundles['no-reload-guard'];
  for (const [brand, v] of Object.entries(versions)) {
    const index = JSON.parse(readFileSync(root + v.index));
    const aKey = variant === 'fixed' ? v.pageKey : hash(variant + v.pageKey);
    const bFiles = new Map(baseFiles);
    bFiles.set('app.js', Buffer.concat([baseFiles.get('app.js'), Buffer.from('\n;globalThis.__publisherBuild="B";\n')]));
    publishers[variant][brand] = {
      A: shell(v, index, baseFiles, aKey, v.builtAt),
      B: shell(v, index, bFiles, hash('B' + aKey), v.builtAt + 1000)
    };
  }
}

const nextVersions = Object.fromEntries(['mail', 'just'].map(brand => [brand, publishers.fixed[brand].B.version]));
let published = 'A', fault = false, mutant = null, requests = [], navigations = 0, appFaults = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host), path = url.pathname;
  const version = path === '/version.json' || path === '/version-just.json';
  if (version) { requests.push({ path, headers: req.headers }); if (fault) { req.socket.destroy(); return; } }
  const just = url.hostname.split('.')[0] === 'justdrive' || url.searchParams.get('site') === 'just' || url.searchParams.has('just');
  const brand = just ? 'just' : 'mail';
  const variant = url.hostname.includes('no-reload-guard') ? 'no-reload-guard' : 'fixed';
  const selectedBrand = path === '/version-just.json' ? 'just' : path === '/version.json' ? 'mail' : brand;
  const release = publishers[variant][selectedBrand][published], v = release.version;
  res.setHeader('Cache-Control', 'no-store');
  if (version) { requests[requests.length - 1].host = url.hostname; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); return; }
  const nextApp = publishers[variant][brand].B.appURL;
  if (path === nextApp && (url.hostname.includes('app-slow') || url.hostname.includes('app-fail'))) {
    const kind = url.hostname.includes('app-slow') ? 'slow' : 'fail';
    appFaults.push({ host: url.hostname, kind, path });
    if (kind === 'fail') { res.writeHead(503); res.end('authored next-shell failure'); return; }
    await sleep(2200); if (res.destroyed) return;
  }
  if (allFiles.has(path)) {
    res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : 'application/json');
    res.end(allFiles.get(path));
    return;
  }
  const activeBundle = mutant ? bundles[mutant] : release.bundleFiles;
  if (path === '/app.js' || path.startsWith('/chunks/')) {
    const key = path.slice(1);
    const body = activeBundle.get(key);
    if (!body) { res.writeHead(404); res.end(); return; }
    if (path === '/app.js') {
      const etag = '"' + hash(body) + '"';
      res.setHeader('Cache-Control', 'no-cache'); res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    res.setHeader('Content-Type', 'text/javascript');
    res.end(body);
    return;
  }
  let file = resolve(root, '.' + path);
  const documentPath = path === '/' || !extname(path);
  if (documentPath) {
    navigations++;
    const seg = path.split('/').filter(Boolean)[0];
    const justFile = seg && existsSync(`${root}/just/${seg}/index.html`) ? `/just/${seg}/index.html` : '/just/mabou/index.html';
    file = root + (brand === 'just' ? justFile : '/index.html');
  }
  if (!file.startsWith(root + '/') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  let body = readFileSync(file);
  if (documentPath) {
    body = body.toString().replace(/\s+integrity="[^"]*"/g, '');
    if (mutant || variant !== 'fixed') body = body.replace(/<link rel="modulepreload"[^>]*>\n?/g, '');
    body = body
      .replace(/(<meta name="mmm-page" content=")[^"]+/, `$1${v.pageKey}`)
      .replace(/(<meta name="mmm-built-at" content=")[^"]+/, `$1${v.builtAt}`)
      .replace(/(<meta name="mmm-just-page" content=")[^"]+/, `$1${publishers[variant].just[published].version.pageKey}`);
  }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json' })[extname(file)] ?? 'application/octet-stream');
  res.end(body);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://localhost:${server.address().port}`;
writeFileSync(out + '/origin.txt', origin);
console.log('version publisher: ' + origin);
const opened = [], table = [];

async function tab() {
  const t = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  opened.push(t.id);
  let documents = 0;
  const c = await cdp(t.webSocketDebuggerUrl, { onEvent: event => { if (event.method === 'Page.frameNavigated' && !event.params.frame.parentId) documents++; } }), send = c.send;
  const read = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
  await send('Page.enable'); await send('Network.enable'); await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__swEvents=[];navigator.serviceWorker?.addEventListener('message',e=>window.__swEvents.push(e.data));window.__versionClock=0;const realNow=Date.now.bind(Date);Date.now=()=>realNow()+window.__versionClock;window.__advanceVersion=ms=>window.__versionClock+=ms;window.__versionPending=0;const nativeFetch=window.fetch.bind(window);window.fetch=(input,init)=>{const version=/\\/version(?:-just)?\\.json$/.test(new URL(String(input),location.href).pathname);if(version)window.__versionPending++;return nativeFetch(input,init).then(response=>{if(response.status>=400)window.__swEvents.push({http:response.status,url:String(input)});if(version){const json=response.json.bind(response);response.json=()=>json().finally(()=>setTimeout(()=>window.__versionPending--,0));}return response;},error=>{if(version)window.__versionPending--;throw error;});};localStorage.setItem('mmm.picture','fast');const nativeTimeout=window.setTimeout.bind(window);window.__versionTimers=new Map();window.setTimeout=(fn,ms,...args)=>{const id=nativeTimeout(fn,ms,...args);if(ms===600000)window.__versionTimers.set(id,fn);return id;};const nativeClear=window.clearTimeout.bind(window);window.clearTimeout=id=>{window.__versionTimers.delete(id);nativeClear(id);};window.__tickVersion=()=>{window.__advanceVersion(600000);for(const [id,fn] of [...window.__versionTimers]){clearTimeout(id);fn();}};window.__visibilityLog=[];document.addEventListener('visibilitychange',()=>window.__visibilityLog.push(document.hidden));window.__visible=null;Object.defineProperty(document,'visibilityState',{get:()=>window.__visible===null?(document.hidden?'hidden':'visible'):window.__visible?'visible':'hidden'});window.__visibility=visible=>{window.__visible=visible;document.dispatchEvent(new Event('visibilitychange'));};`
  });
  const until = async (expression, label = expression) => {
    for (let n = 0; n < 600; n++) { if (await read(expression)) return; await sleep(100); }
    console.error('TIMEOUT STATE', await read(`({url:location.href,hidden:document.hidden,visibility:document.visibilityState,titleHidden:document.getElementById('title')?.hidden,timers:window.__versionTimers?.size,pending:window.__versionPending,key:document.querySelector('meta[name="mmm-page"]')?.content,script:document.querySelector('script')?.getAttribute('src'),swEvents:window.__swEvents,notice:document.getElementById('offlineUpdate')?.textContent})`), { requests: requests.map(r => r.path), navigations, published, mutant });
    throw Error('timeout ' + label);
  };
  const load = async (path, base = origin) => {
    await send('Page.navigate', { url: base + path });
    await until(`!!document.getElementById('titleStart') && !!window.__tickVersion && window.__versionTimers.size===1 && window.__versionPending===0`, 'game title and version timer');
  };
  const reload = async () => {
    const before = documents;
    await send('Page.reload');
    for (let n = 0; n < 200 && documents === before; n++) await sleep(50);
    assert.ok(documents > before, 'reload navigated document');
    await until(`!!document.getElementById('titleStart') && !!window.__tickVersion && window.__versionTimers.size===1 && window.__versionPending===0`, 'reloaded game title and version timer');
  };
  const close = async () => { await cdpFetch(`http://127.0.0.1:${port}/json/close/${t.id}`); c.close(); opened.splice(opened.indexOf(t.id), 1); };
  return { send, read, until, load, reload, close, c, navigationCount: () => documents };
}

const path = '/?title=1&touch=1&radio=0&area=mabou&era=1884&at=home&unknown=keep%20me&dup=a&dup=b#same';
try {
  // Both brands (including an online-only Just Drive area with area chunks), full query + fragment preservation, initial title automatic reload.
  for (const [label, just, address] of [
    ['mail', false, path],
    ['just-mabou', true, ('/mabou' + path.slice(1) + '&site=just').replace('#same&site=just', '&site=just#same')],
    ['just-judique', true, '/judique?title=1&touch=1&radio=0&unknown=keep%20me&site=just#same']
  ]) {
    published = 'A'; mutant = null;
    const t = await tab();
    await t.load(address);
    console.log('CHECK title reload ' + label);
    const before = navigations;
    published = 'B';
    await t.read(`window.__tickVersion()`);
    await t.until(`document.querySelector('meta[name="mmm-page"]').content==='${nextVersions[just ? 'just' : 'mail'].pageKey}' && window.__publisherBuild==='B'`);
    assert.equal(await t.read('location.href'), origin + address);
    assert.equal(navigations, before + 1);
    assert.equal(await t.read(`!!document.getElementById('offlineUpdate')`), false);
    table.push({ case: 'title reload, same complete address', brand: label, result: 'PASS' });
    await t.close();
  }

  // In-drive and reopened-title guard, both requested phone layouts with all actual HUD/control rectangles.
  for (const just of [false, true]) for (const [width, height] of [[390, 844], [360, 640]]) {
    published = 'A';
    const t = await tab();
    await t.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
    await t.load(`/?title=1&touch=1&radio=0${just ? '&site=just' : ''}`);
    await t.read(`document.getElementById('titleStart').click()`);
    const before = navigations;
    published = 'B';
    await t.read('window.__tickVersion()');
    await t.until(`!!document.getElementById('offlineUpdate')`);
    assert.equal(navigations, before);
    assert.equal(await t.read(`document.getElementById('offlineReload')?.textContent`), 'Start again');
    const boxes = await t.read(`(()=>{const n=document.getElementById('offlineUpdate').getBoundingClientRect();const ids=['phoneLine','hud','shiftHud','stopHint','miniMap','relief','radio','photoTag','gear','pauseButton','bigMapButton','tcReset','tcView','tcHorn','tcSteer','tcBrake','tcGo','cameraButton','mailButton','placesButton','droneButton','savePictureButton','placeArrival'];return {notice:n.toJSON(),others:ids.flatMap(id=>{const e=document.getElementById(id);return e&&e.getClientRects().length&&!e.closest('[hidden]')&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'?[{id,...e.getBoundingClientRect().toJSON()}]:[]})};})()`);
    const a = boxes.notice;
    assert.ok(a.left >= 0 && a.top >= 0 && a.right <= width && a.bottom <= height, `notice outside viewport ${width}x${height}: ${JSON.stringify(a)}`);
    for (const b of boxes.others) {
      assert.ok(!(Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1), `notice overlaps ${b.id} at ${width}x${height}: notice=${JSON.stringify(a)} ${b.id}=${JSON.stringify(b)}`);
    }
    writeFileSync(`${out}/${just ? 'just' : 'mail'}-${width}x${height}.png`, Buffer.from((await t.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
    // Open the real controls/credits title again: a paused drive still must not reload.
    await t.read(`document.getElementById('settings').querySelectorAll('button').forEach(b=>{if(b.textContent==='Controls, credits and data')b.click();});window.__tickVersion()`);
    await sleep(100);
    assert.equal(navigations, before);
    await t.read(`document.getElementById('offlineReload').click()`);
    await t.until(`document.querySelector('meta[name="mmm-page"]').content==='${nextVersions[just ? 'just' : 'mail'].pageKey}' && window.__publisherBuild==='B'`);
    assert.equal(navigations, before + 1);
    table.push({ case: 'drive notice, no overlap, reopened title safe, button reload', brand: just ? 'just' : 'mail', width, height, result: 'PASS', boxes });
    await t.close();
  }

  // Timers use the real 600000ms delay; invoke their callback to avoid waiting ten minutes.
  published = 'A';
  const t = await tab();
  await t.load('/?title=1&touch=1&radio=0'); requests = [];
  const cover = await tab();
  await t.send('Page.bringToFront'); await t.until('window.__versionPending===0'); requests = [];
  // Rapid hide/return without advancing the clock is throttled by the 60-second visibility gap.
  await t.read('window.__visibilityLog=[]');
  await cover.send('Page.bringToFront'); await sleep(400);
  assert.equal(requests.length, 0, 'no version request while the native tab is hidden');
  // Edge can suspend debugger evaluation in a background tab. Inspect its native event log only after return.
  await t.send('Page.bringToFront'); await t.until('window.__versionTimers.size===1 && window.__versionPending===0');
  assert.ok(await t.read('window.__visibilityLog.includes(true)'), 'native hidden event observed');
  assert.equal(requests.length, 0, 'rapid tab return is throttled');
  // Even after advancing 10 minutes while hidden, a hidden tab makes no version request.
  await t.read('setTimeout(()=>{if(document.hidden)window.__tickVersion()},200)');
  await cover.send('Page.bringToFront'); await sleep(1300);
  assert.equal(requests.length, 0, 'no version request while hidden after 10 minutes');
  await cover.close();
  await t.send('Page.bringToFront'); await t.until('window.__versionTimers.size===1 && window.__versionPending===0');
  requests = [];
  await t.read('window.__advanceVersion(60001);window.__visibility(false);window.__visibility(true)');
  await t.until('window.__versionPending===0'); assert.equal(requests.length, 1);
  await t.read('for(let n=0;n<5;n++){window.__visibility(false);window.__visibility(true)}');
  await sleep(100); assert.equal(requests.length, 1, 'tab-switch burst makes no extra request');
  assert.match(requests[0].headers['cache-control'], /no-cache/);
  fault = true; const count = navigations; await t.read('window.__tickVersion()'); await sleep(200);
  assert.equal(navigations, count); assert.equal(await t.read(`!!document.getElementById('offlineUpdate')`), false); fault = false;
  table.push({ case: 'native hidden no polls; 60-second visibility throttle; network failure silent', result: 'PASS' });
  await t.close();

  for (const just of [false, true]) for (const state of ['settings', 'reopened-title']) {
    published = 'A';
    const t = await tab();
    await t.load(`/?title=1&touch=1&radio=0${just ? '&site=just' : ''}`);
    if (state === 'settings') {
      await t.read(`document.getElementById('gear').click()`);
      await t.until(`document.getElementById('settings').classList.contains('open')`);
    } else {
      await t.read(`document.getElementById('titleStart').click();document.getElementById('settings').querySelectorAll('button').forEach(b=>{if(b.textContent==='Controls, credits and data')b.click();})`);
      await t.until(`document.getElementById('title').hidden===false`);
    }
    const before = t.navigationCount(); published = 'B';
    await t.read('window.__tickVersion()');
    await t.until(`!!document.getElementById('offlineUpdate')`);
    assert.equal(t.navigationCount(), before, state + ' must not reload');
    assert.equal(await t.read('window.__versionTimers.size'), 0, 'notice stops polling');
    const checked = requests.length;
    await t.read('window.__tickVersion();window.__visibility(false);window.__visibility(true)');
    await sleep(100); assert.equal(requests.length, checked, 'notice stops future checks');
    table.push({ case: state + ' excludes automatic reload and stops polling', brand: just ? 'just' : 'mail', result: 'PASS' });
    await t.close();
  }

  // A real installed worker controls the page and sends its own update message. Repeated SW + poll => one notice.
  for (const brand of ['mail', 'just']) {
    const swOrigin = brand === 'just' ? origin.replace('localhost', 'justdrive.localhost') : origin;
    published = 'A';
    const sw = await tab();
    await sw.load('/?title=1&touch=1&radio=0', swOrigin);
    await sw.read(`navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready)`);
    await sw.until('!!navigator.serviceWorker.controller');
    await sw.reload();
    await sw.read(`document.getElementById('titleStart').click()`);
    const before = navigations; published = 'B';
    await sw.read(`window.__tickVersion();navigator.serviceWorker.controller.postMessage({type:'collect'})`);
    await sw.until(`!!document.getElementById('offlineUpdate')`);
    const worker = (await (await cdpFetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'service_worker' && t.url === swOrigin + '/sw.js');
    assert.ok(worker);
    const wc = await cdp(worker.webSocketDebuggerUrl);
    await wc.send('Runtime.evaluate', { expression: `self.clients.matchAll({type:'window'}).then(cs=>cs.forEach(c=>{c.postMessage({type:'update-ready'});c.postMessage({type:'version-unavailable'});}));`, awaitPromise: true });
    wc.close(); await sleep(100);
    assert.equal(await sw.read(`document.querySelectorAll('#offlineUpdate').length`), 1);
    assert.equal(navigations, before);
    const address = await sw.read('location.href');
    await sw.read(`document.getElementById('offlineReload').click()`);
    await sw.until(`document.querySelector('meta[name="mmm-page"]').content==='${nextVersions[brand].pageKey}' && window.__publisherBuild==='B'`);
    assert.equal(await sw.read('location.href'), address);
    table.push({ case: 'real offline worker plus poll gives exactly one notice and reloads to B', brand, result: 'PASS' });
    await sw.read(`navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister())))`);
    await sw.close();
  }

  let fallbackCase = 0;
  async function workerFallback(variant, brand, mode, manual = false) {
    published = 'A'; mutant = null;
    const host = `${brand === 'just' ? 'justdrive.' : ''}app-${mode}-${variant}-${++fallbackCase}.localhost`, base = origin.replace('localhost', host);
    const address = '/?title=1&touch=1&radio=0&loop=keep#address';
    const t = await tab();
    try {
      await t.load(address, base);
      await t.read(`navigator.serviceWorker.register('/sw.js').then(()=>navigator.serviceWorker.ready)`);
      await t.until('!!navigator.serviceWorker.controller');
      await t.reload();
      assert.ok(await t.read(`!!document.querySelector('script[src*="/offline/app."]')`), 'worker saved and delivered shell A');
      if (manual) await t.read(`document.getElementById('titleStart').click()`);
      const before = t.navigationCount(); published = 'B';
      await t.read('window.__tickVersion()');
      if (manual) { await t.until(`!!document.getElementById('offlineReload')`); await t.read(`document.getElementById('offlineReload').click()`); }
      const end = Date.now() + 45000; let fallback = false;
      while (Date.now() < end) {
        assert.ok(t.navigationCount() <= before + 1, 'at most one reload per target after worker fallback');
        if (t.navigationCount() === before + 1) {
          try { if (await t.read(`!!document.getElementById('offlineUpdate') && !!document.getElementById('titleStart')`)) { fallback = true; break; } }
          catch { /* A new document can replace the evaluation context. */ }
        }
        await sleep(100);
      }
      if (!fallback) {
        const diag = await t.read(`({href:location.href,page:document.querySelector('meta[name="mmm-page"]')?.content,builtAt:document.querySelector('meta[name="mmm-built-at"]')?.content,boot:document.getElementById('boot')?.textContent,title:!!document.getElementById('titleStart'),notice:document.getElementById('offlineUpdate')?.textContent,target:sessionStorage.getItem('mmm.update.target'),sw:!!navigator.serviceWorker.controller,build:globalThis.__publisherBuild})`).catch(e => String(e));
        console.error('FALLBACK TIMEOUT', { variant, brand, mode, manual, host, before, navCount: t.navigationCount(), appFaults: appFaults.filter(f => f.host === host), diag });
      }
      assert.ok(fallback, 'fallback A shows notice');
      if (mode === 'slow') {
        // The worker finishes saving B after the deadline and says so: one more press takes B, never by itself.
        await t.until(`document.getElementById('offlineReload')?.disabled===false`);
        assert.equal(t.navigationCount(), before + 1, 'worker ready does not reload by itself');
        assert.equal(await t.read(`document.querySelector('meta[name="mmm-page"]').content`), publishers[variant][brand].A.version.pageKey, 'worker returned saved A first');
        await t.read(`document.getElementById('offlineReload').click()`);
        const B = publishers[variant][brand].B.version.pageKey;
        await t.until(`document.querySelector('meta[name="mmm-page"]')?.content===${JSON.stringify(B)}&&!document.getElementById('boot')`);
        assert.equal(t.navigationCount(), before + 2);
        assert.equal(await t.read('location.href'), base + address);
        assert.equal(await t.read(`!!document.getElementById('offlineUpdate')`), false, 'B shows no notice');
        return { case: `worker slow B app, ${manual ? 'button' : 'title'} reload once, then one press after the worker saves B`, brand, variant, result: 'PASS', reloads: t.navigationCount() - before };
      }
      await sleep(3000);
      assert.ok(t.navigationCount() <= before + 1, 'at most one reload per target after worker fallback');
      assert.equal(await t.read(`document.querySelector('meta[name="mmm-page"]').content`), publishers[variant][brand].A.version.pageKey, 'worker returned saved A');
      assert.equal(await t.read(`document.getElementById('offlineReload').disabled`), true, 'no second button reload to same target');
      assert.equal(await t.read('location.href'), base + address);
      assert.ok(appFaults.some(f => f.host === host && f.kind === mode), 'real worker requested the authored slow/failing B app');
      const checked = requests.filter(r => r.host === host).length;
      await t.read(`window.__tickVersion();window.__visibility(false);window.__visibility(true);document.getElementById('offlineReload').click()`);
      await sleep(150);
      assert.equal(t.navigationCount(), before + 1);
      assert.equal(requests.filter(r => r.host === host).length, checked, 'fallback notice stops checks');
      assert.equal(await t.read('window.__versionTimers.size'), 0);
      return { case: `worker ${mode} B app, ${manual ? 'button' : 'title'} reload once then notice`, brand, variant, result: 'PASS', reloads: t.navigationCount() - before };
    } finally {
      await t.read(`navigator.serviceWorker.getRegistrations().then(rs=>Promise.all(rs.map(r=>r.unregister())))`).catch(() => {});
      await t.close();
    }
  }

  for (const brand of ['mail', 'just']) for (const mode of ['slow', 'fail']) table.push(await workerFallback('fixed', brand, mode));
  for (const brand of ['mail', 'just']) table.push(await workerFallback('fixed', brand, 'fail', true));
  // A slow worker now unlocks one more press when it has saved B, so only the failing worker shows a loop
  // deterministically. The retry guard has its own mutant in tools/version-notice-check.mjs.
  for (const [mode, manual] of [['fail', false], ['fail', true]]) {
    await assert.rejects(
      () => workerFallback('no-reload-guard', 'mail', mode, manual),
      error => error instanceof assert.AssertionError && (error.message.includes('at most one reload per target') || error.message.includes('no second button reload to same target'))
    );
    table.push({ case: `no-reload-guard rejected: ${mode} worker, ${manual ? 'button' : 'title'} reload loop`, result: 'PASS' });
  }

  for (const name of ['reload-after-start', 'poll-hidden']) {
    published = 'A'; mutant = name;
    const t = await tab(); await t.load('/?title=1&touch=1&radio=0');
    let caught = false;
    if (name === 'reload-after-start') {
      await t.read(`document.getElementById('titleStart').click()`);
      const before = navigations; published = 'B';
      await t.read('window.__tickVersion()'); await sleep(600);
      caught = navigations !== before;
    } else {
      requests = []; await t.read(`window.__visibility(false)`);
      const scheduled = await t.read('window.__versionTimers.size');
      await t.read(`window.__tickVersion()`); await sleep(200);
      caught = scheduled > 0 && requests.length > 0;
    }
    assert.ok(caught, 'mutant survived: ' + name);
    table.push({ case: name + ' mutant rejected', result: 'PASS' });
    await t.close();
  }

  writeFileSync(out + '/proof.json', JSON.stringify(table, null, 2));
  console.table(table.map(({ case: check, brand, width, height, result }) => ({ check, brand, width, height, result })));
} finally {
  for (const id of opened) await cdpFetch(`http://127.0.0.1:${port}/json/close/${id}`).catch(() => {});
  await new Promise(r => server.close(r));
}
