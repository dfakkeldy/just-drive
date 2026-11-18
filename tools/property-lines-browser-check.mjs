// Browser picture proof. Province URLs are intercepted BEFORE navigation; any real attempt is a failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cdp, cdpFetch, sleep } from './cdp.mjs';
const [runnerOut, first] = process.argv.slice(2), base = new URL(first).origin;
const out = process.env.PROPERTY_EVIDENCE_DIR ?? runnerOut;
mkdirSync(out, { recursive: true });
const port = process.env.CDP_PORT;
const mainRef = execFileSync('git', ['rev-parse', 'origin/main'], {encoding:'utf8'}).trim();
const mainMap = transformSync(execFileSync('git', ['show', mainRef+':web/src/minimap.ts'], {encoding:'utf8'}), {loader:'ts',format:'esm',target:'es2022'}).code + `
MiniMap.prototype.reserveCredit = () => {};
globalThis.__propertyBaselineModule = true;
`;
const layoutSource = readFileSync(new URL('./layout-check.mjs', import.meta.url),'utf8');
const layoutSizes = layoutSource.split("process.env.SIZES ?? '")[1].split("'")[0].split(' ').filter(Boolean).map(s => {
  const [w,h]=s.split('-')[0].split('x').map(Number); assert.ok(w>0 && h>0,'layout size '+s); return [w,h,s.endsWith('-plain')];
});
const init = `(() => {
  localStorage.setItem('mmm.map', 'open');
  window.__propertyStubRequests = []; window.__propertyNetwork = []; window.__mapLog = [];
  window.__propertyStubFail = false;
  window.__propertyClockOffset = 0;
  const now = performance.now.bind(performance);
  Object.defineProperty(performance, 'now', { value: () => now() + window.__propertyClockOffset });
  const c = document.createElement('canvas'); c.width = c.height = 640;
  const g = c.getContext('2d'); g.strokeStyle = '#7dffc9'; g.lineWidth = 1.5;
  // A synthetic boundary grid. It contains no Province information.
  for (let x = 20; x < 640; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 65, 640); g.stroke(); }
  for (let y = 20; y < 640; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(640, y + 35); g.stroke(); }
  const picture = new Promise(resolve => c.toBlob(resolve, 'image/png'));
  const original = window.fetch;
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.hostname.endsWith('novascotia.ca')) {
      if (!url.pathname.endsWith('/MapServer/export')) throw Error('Forbidden Province endpoint: ' + url);
      window.__propertyStubRequests.push({ url: url.href, cache: options?.cache });
      return window.__propertyStubFail ? new Response('', {status: 503}) : new Response(await picture, {headers: {'Content-Type': 'image/png'}});
    }
    return original(input, options);
  };
  for (const method of ['clearRect', 'drawImage', 'stroke', 'fillText']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (this.canvas.id === 'miniMapCanvas') {
        if (method === 'clearRect') window.__mapLog = [];
        window.__mapLog.push(method);
      }
      return original.apply(this, args);
    };
  }
})();`;
async function open(url, size, baseline = false) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const forbidden = [];
  let connection;
  connection = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000, onEvent: event => {
    if (event.method === 'Fetch.requestPaused' && baseline && new URL(event.params.request.url).pathname === '/src/minimap.ts') {
      connection.send('Fetch.fulfillRequest', {requestId:event.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(mainMap).toString('base64')}).catch(() => {}); return;
    }
    if (event.method === 'Fetch.requestPaused') {
      forbidden.push(event.params.request.url);
      connection.send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
    if (event.method === 'Network.requestWillBeSent' && new URL(event.params.request.url).hostname.endsWith('novascotia.ca')) forbidden.push(event.params.request.url);
  } });
  const { send } = connection;
  const read = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
  const load = async url => {
    await send('Page.navigate', { url });
    // Just Drive preserves its brand title; the same page-ready signal serves both hosts.
    for (let n = 0; n < 240; n++) {
      if (await read(`document.documentElement?.dataset.mmmReady === 'true' && location.href === ${JSON.stringify(url)}`)) {
        await read(`document.title = 'settled'`); return;
      }
      await sleep(500);
    }
    assert.fail('page did not settle: ' + url);
  };
  await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  if (size) await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true });
  await send('Fetch.enable', { patterns: ['*://*.novascotia.ca/*', '*://novascotia.ca/*', ...(baseline ? ['*://*/src/minimap.ts*'] : [])].map(urlPattern => ({ urlPattern, requestStage: 'Request' })) });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  await load(url);
  assert.equal(await read('!!globalThis.__propertyBaselineModule'),baseline,'main baseline and merged module remain distinct');
  return { read, load, send,
    shot: async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(resolve(out, name + '.png'), Buffer.from(r.result.data, 'base64')); },
    close: async () => { try { assert.deepEqual(forbidden, [], 'ZERO Province network requests: stub must contain all service work'); }
      finally { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); connection.close(); } },
  };
}
async function wait(p, expression, label) {
  for (let n = 0; n < 100; n++) { if (await p.read(expression)) return; await sleep(150); }
  assert.fail(label);
}
async function on(p) {
  await p.read(`document.getElementById('settings').classList.add('open'); document.getElementById('propertyLines').click()`);
}
// Since the single pause gate (#187), an open Settings panel pauses every frame, so close it before waiting on map work.
async function close(p) {
  await p.read(`document.getElementById('settings').classList.remove('open')`);
}
// Count the synthetic line colour in the real map backing store, rather than trusting drawImage calls.
const linePixels = `(() => {
  const c = document.getElementById('miniMapCanvas'), g = c.getContext('2d');
  const pixels = g.getImageData(0, 0, c.width, c.height).data;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 1] > 180 && pixels[i + 1] > pixels[i] * 1.5 && pixels[i + 2] > 130 && pixels[i + 3] > 80) count++;
  return count;
})()`;
if (process.env.PROPERTY_GROUND_ONLY === '1' || process.env.PROPERTY_FOCUSED_ALL === '1') {
  for (const low of [false, true]) {
    const p = await open(`${base}/?hud=1&q=${low ? 'low' : 'high'}&shadows=0`);
    try {
      assert.equal(await p.read(`!!document.getElementById('propertyMode')`), true, 'second viewing mode exists');
      assert.equal(await p.read(`document.querySelector('#propertyMode option[value="ground"]').disabled`), low, 'ground is disabled on LOW');
      if (low) continue;
      await p.read(`localStorage.removeItem('mmm:province-license:v1')`);
      await p.load(`${base}/?hud=1&q=high&shadows=0`);
      await p.read(`document.getElementById('propertyMode').value='ground'; document.getElementById('propertyMode').dispatchEvent(new Event('change'))`);
      assert.equal(await p.read('__propertyStubRequests.length'), 0, 'ground choice alone sends nothing');
      await on(p);
      assert.equal(await p.read('__propertyStubRequests.length'), 0, 'ground waits for agreement');
      await p.read(`document.getElementById('propertyAgree').click(); document.getElementById('settings').classList.remove('open'); document.getElementById('miniMapHead').click()`);
      const active = `(() => { let n=0; mmm.terrain.group.traverse(o=>{if(o.material?.uniforms?.propertyGroundOn?.value === 1)n++}); return n; })()`;
      await wait(p, `(${active}) > 0`, 'ground texture reaches terrain materials with folded map');
      assert.equal(await p.read(`mmm.renderer.getContext().getError()`), 0, 'ground shader has no GL error');
      assert.equal(await p.read(`mmm.renderer.info.programs.every(p => p.diagnostics?.runnable !== false) && document.getElementById('gameError').hidden`), true, 'ground programs compile and game keeps running');
      await p.shot('property-ground-on');
      const first = await p.read('__propertyStubRequests[0].url');
      await p.read(`mmm.vehicle.x += 1000; __propertyClockOffset += 6000`);
      await wait(p, '__propertyStubRequests.length > 1', 'moving car refreshes ground picture independently of folded map');
      assert.notEqual(await p.read('__propertyStubRequests.at(-1).url'), first, 'moving ground request changes extent');
      await on(p);
      assert.equal(await p.read(active), 0, 'off removes terrain overlay');
      assert.equal(await p.read(`document.getElementById('propertyCredit').hidden`), true);
      console.log('PASS ground: consent, terrain shader, folded map independence, car refresh, off disposal, LOW gate');
    } finally { await p.close(); }
  }
}
if (process.env.PROPERTY_VISIBILITY_ONLY === '1' || process.env.PROPERTY_FOCUSED_ALL === '1') {
  const p = await open(`${base}/?hud=1&q=low&shadows=0`);
  try {
    await on(p);
    if (await p.read(`document.getElementById('propertyDialog').open`)) await p.read(`document.getElementById('propertyAgree').click()`);
    await p.read(`(async () => { document.getElementById('settings').classList.remove('open'); window.__propertyFullyVisible = (await import('/src/property-lines.ts')).fullyVisible; })()`);
    for (const font of ['system-ui', 'Arial', 'serif', 'monospace', 'Times New Roman']) for (const zoom of [0.8, 1, 1.1, 1.25, 1.5, 2]) {
      await p.read(`document.getElementById('propertyCredit').style.fontFamily = ${JSON.stringify(font)}; document.body.style.zoom = '${zoom}'`);
      await sleep(150);
      const proof = await p.read(`(() => {
        const credit = document.getElementById('propertyCredit'), link = credit.querySelector('a');
        return {credit:__propertyFullyVisible(credit),link:__propertyFullyVisible(link),
          rect:link.getBoundingClientRect().toJSON(), ancestors:[credit,document.body,document.documentElement].map(e=>({id:e.id,tag:e.tagName,rect:e.getBoundingClientRect().toJSON(),cw:e.clientWidth,ch:e.clientHeight,ow:e.offsetWidth,oh:e.offsetHeight,sw:e.scrollWidth,sh:e.scrollHeight,overflow:getComputedStyle(e).overflow})), hits:[...link.getClientRects()].map(r=>[document.elementFromPoint(r.left+1,r.top+1)?.outerHTML, document.elementFromPoint(r.right-1,r.bottom-1)?.outerHTML])};
      })()`);
      if (!proof.credit || !proof.link) console.log('VISIBILITY ' + JSON.stringify(proof));
      assert.ok(proof.credit && proof.link, `readable unobscured credit stays eligible: ${font}/${zoom}`);
      await wait(p, `(${linePixels}) > 20`, `scaled map has line pixels: ${font}/${zoom}`);
      console.log(`PASS visibility and line pixels: ${font}/${zoom}`);
    }
  } finally { await p.close(); }
}
if (process.env.PROPERTY_AREAS_ONLY === '1' || process.env.PROPERTY_FOCUSED_ALL === '1') {
  for (const area of ['mabou', 'judique', 'porthood', 'pointtupper', 'westbay', 'cansocauseway']) {
    const manifest = JSON.parse(readFileSync(new URL(`../data/baked/${area === 'mabou' ? 'terrain' : 'areas/' + area}/manifest.json`, import.meta.url), 'utf8'));
    const p = await open(`${base}/?area=${area}&hud=1&q=low&shadows=0`);
    try {
      await on(p);
      if (await p.read(`document.getElementById('propertyDialog').open`)) await p.read(`document.getElementById('propertyAgree').click()`);
      await p.read(`document.getElementById('settings').classList.remove('open')`);
      await wait(p, `__mapLog.includes('drawImage')`, area + ': small map receives picture');
      await wait(p, `(${linePixels}) > 20`, area + ': non-empty line pixels on small map');
      const pose = await p.read(`({x:mmm.vehicle.x,z:mmm.vehicle.z})`);
      const request = new URL((await p.read('__propertyStubRequests'))[0].url);
      const [w,s,e,n] = request.searchParams.get('bbox').split(',').map(Number);
      const east = manifest.village[0] + pose.x, north = manifest.village[1] - pose.z;
      assert.ok(w < east && east < e && s < north && north < n, area + ': request covers car using this area origin');
      assert.equal(request.searchParams.get('bboxSR'), '2961');
      assert.equal(request.searchParams.get('imageSR'), '2961');
      await p.shot('property-' + area + '-small-pixels');
      await p.read(`document.getElementById('miniMapLarge').click()`);
      await wait(p, `__mapLog.includes('drawImage')`, area + ': enlarged map receives picture');
      await wait(p, `(${linePixels}) > 20`, area + ': non-empty line pixels on enlarged map');
      console.log('PASS ' + area + ': small/enlarged line pixels, area origin and EPSG:2961 request');
    } finally { await p.close(); }
  }
}
if (!['PROPERTY_GROUND_ONLY', 'PROPERTY_VISIBILITY_ONLY', 'PROPERTY_AREAS_ONLY', 'PROPERTY_FOCUSED_ALL'].some(key => process.env[key] === '1')) {
for (const brand of ['mail', 'just']) {
  const origin = new URL(base); if (brand === 'just') origin.hostname = 'localhost';
  const url = `${origin.origin}/${brand === 'just' ? 'mabou' : ''}?${brand === 'just' ? 'site=just&' : ''}hud=1&q=low&shadows=0`;
  const p = await open(url);
  try {
    await p.read(`localStorage.removeItem('mmm:province-license:v1')`); await p.load(url);
    assert.equal(await p.read(`document.getElementById('propertyLines').checked`), false);
    assert.equal(await p.read(`__propertyStubRequests.length`), 0, 'off makes no request');
    await on(p);
    assert.equal(await p.read(`document.getElementById('propertyDialog').open`), true);
    assert.equal(await p.read(`__propertyStubRequests.length`), 0, 'pending consent makes no request');
    assert.equal(await p.read(`(() => { const note = document.getElementById('propertyRequestNote'), agree = document.getElementById('propertyAgree'); return !!note && /which part of the map you are looking at/.test(note.textContent) && !!(note.compareDocumentPosition(agree) & Node.DOCUMENT_POSITION_FOLLOWING) && note.getBoundingClientRect().height > 0; })()`), true, 'the dialog says what a request reveals, before I agree');
    await p.shot('property-' + brand + '-disclaimer');
    await p.read(`document.getElementById('propertyCancel').click()`);
    assert.equal(await p.read(`document.getElementById('propertyLines').checked`), false, 'Cancel leaves off');
    assert.equal(await p.read(`__propertyStubRequests.length`), 0);
    await on(p); await p.read(`document.getElementById('propertyAgree').click(); document.getElementById('settings').classList.remove('open')`);
    await wait(p, `__mapLog.includes('drawImage')`, 'ordinary small map draws the property image after agreement');
    await p.shot('property-' + brand + '-small-on');
    await p.read(`document.getElementById('miniMapLarge').click()`);
    await wait(p, `__mapLog.includes('drawImage')`, 'enlarged map draws the property image');
    const log = await p.read(`__mapLog`);
    assert.ok(log.indexOf('drawImage') < log.indexOf('stroke'), 'picture below roads');
    assert.ok(log.indexOf('drawImage') < log.indexOf('fillText'), 'picture below labels');
    assert.equal(await p.read(`getComputedStyle(document.getElementById('propertyCredit')).display !== 'none' && !document.getElementById('propertyCredit').hidden`), true, 'credit visible');
    assert.equal(await p.read(`document.querySelector('#propertyCredit a').href.includes('NSPRD')`), true);
    assert.equal(await p.read(`__propertyStubRequests.every(r => r.cache === 'no-store')`), true);
    assert.equal(await p.read(`mmm.gameMode`), brand === 'mail' ? 'mail' : 'explore');
    await p.shot('property-' + brand + '-stub-on');
    await p.read(`document.getElementById('miniMapHead').click()`);
    assert.equal(await p.read(`getComputedStyle(document.getElementById('propertyCredit')).display !== 'none'`), true, 'active credit stays visible when map folds');
    const foldedCount = await p.read(`__propertyStubRequests.length`);
    await sleep(600); assert.equal(await p.read(`__propertyStubRequests.length`), foldedCount, 'folded map makes no request');
    await p.read(`document.getElementById('miniMapHead').click()`);
    // Range cycles include the wide map, with labels still suppressed.
    await p.read(`document.getElementById('miniMapCanvas').click(); document.getElementById('miniMapCanvas').click()`);
    await sleep(6500);
    const requests = await p.read(`__propertyStubRequests`);
    assert.ok(requests.length <= 3, 'polite settled viewport requests');
    for (const request of requests) {
      const layers = JSON.parse(new URL(request.url).searchParams.get('dynamicLayers'));
      assert.deepEqual(layers.map(l => l.source.mapLayerId), [0]); assert.equal(layers[0].drawingInfo.showLabels, false);
    }
    await on(p); await p.read(`document.getElementById('settings').classList.remove('open')`);
    await wait(p, `!__mapLog.includes('drawImage')`, 'off removes picture');
    assert.equal(await p.read(`document.getElementById('propertyCredit').hidden`), true);
    const count = await p.read(`__propertyStubRequests.length`); await sleep(700); assert.equal(await p.read(`__propertyStubRequests.length`), count);
    await p.shot('property-' + brand + '-stub-off');
    await p.load(url); await on(p);
    assert.equal(await p.read(`document.getElementById('propertyDialog').open`), false, 'saved consent skips dialog');
    await close(p);
    await wait(p, `__mapLog.includes('drawImage')`, 'remembered image');
    // Fail, reject early retries, then advance the test clock without a minute of GPU work.
    await p.load(url); await p.read(`__propertyStubFail = true`); await on(p); await close(p);
    await wait(p, `!!document.getElementById('propertyNotice')`, 'quiet failure notice');
    assert.equal(await p.read(`document.getElementById('propertyNotice').textContent`), 'Property lines are not available right now');
    assert.equal(await p.read(`document.getElementById('propertyLines').checked`), false);
    await p.read(`document.getElementById('propertyLines').click(); document.getElementById('propertyLines').click(); mmm.vehicle.x += 200`);
    await sleep(600); assert.equal(await p.read(`__propertyStubRequests.length`), 1, 'failure latches without storm');
    assert.equal(await p.read(`!document.getElementById('propertyStatus').hidden && document.getElementById('propertyStatus').textContent`), 'Property lines are not available right now', 'early attempts show the same status');
    assert.equal(await p.read(`__mapLog.includes('drawImage')`), false);
    assert.equal(await p.read(`__mapLog.includes('stroke') && document.getElementById('gameError').hidden`), true, 'roads keep drawing without a game error');
    await p.read(`__propertyStubFail = false; __propertyClockOffset += 60001`);
    await sleep(600); assert.equal(await p.read(`__propertyStubRequests.length`), 1, 'cooldown expiry alone never retries');
    await on(p); await close(p);
    await wait(p, `__mapLog.includes('drawImage')`, 'manual retry restores image without reload');
    assert.equal(await p.read(`__propertyStubRequests.length`), 2, 'exactly one explicit retry');
    assert.equal(await p.read(`document.getElementById('propertyStatus').hidden`), true, 'retry clears unavailable status');
    await p.read(`document.getElementById('miniMapHead').click()`); // Keep frame activity without changing range.
    await sleep(600); assert.equal(await p.read(`__propertyStubRequests.length`), 2, 'retry does not become a storm');
    console.log(`PASS ${brand}: consent, coverage/range reuse, credit, off removes, failure status, no automatic retry, one manual retry after 60 s without reload`);
  } finally { await p.close(); }
}

// Independent geometry proof: every credit/link rectangle must fit the viewport and each clipping ancestor.
const creditRects = `(() => {
  const faults = [], boxes = [];
  for (const e of [document.getElementById('propertyCredit'), document.querySelector('#propertyCredit a')]) {
    const b = e.getBoundingClientRect(); boxes.push({tag:e.tagName,x:b.x,y:b.y,width:b.width,height:b.height});
    if (e.hidden || b.width <= 0 || b.height <= 0 || b.left < 0 || b.top < 0 || b.right > innerWidth || b.bottom > innerHeight) faults.push('viewport: '+e.tagName);
    if (e.scrollHeight > e.clientHeight+1 || e.scrollWidth > e.clientWidth+1) faults.push('content: '+e.tagName);
    for (let p = e.parentElement; p; p = p.parentElement) {
      const r = p.getBoundingClientRect(), s = getComputedStyle(p);
      if (s.display==='none' || s.visibility!=='visible') faults.push('hidden: '+p.id);
      if (/hidden|clip|scroll|auto/.test(s.overflowX) && (b.left < r.left+p.clientLeft || b.right > r.left+p.clientLeft+p.clientWidth)) faults.push('clip-x: '+p.id);
      if (/hidden|clip|scroll|auto/.test(s.overflowY) && (b.top < r.top+p.clientTop || b.bottom > r.top+p.clientTop+p.clientHeight)) faults.push('clip-y: '+p.id);
    }
  }
  return {faults,boxes};
})()`;
const ordinaryPhone = `(() => {
  const map=document.getElementById('miniMap'), r=map.getBoundingClientRect();
  return {box:[r.x,r.y,r.width,r.height],inline:map.style.width,folded:map.classList.contains('folded'),menu:document.body.classList.contains('phoneReadoutsMenu')};
})()`;
const parity = {};
for (const brand of ['mail','just']) {
  const origin=new URL(base); if (brand==='just') origin.hostname='localhost';
  const url=`${origin.origin}/${brand==='just'?'mabou':''}?${brand==='just'?'site=just&':''}touch=1&hud=1&q=low&shadows=0`;
  for (const baseline of [true,false]) {
    const p=await open(url,[320,568],baseline);
    try {
      for (const [w,h,plain] of layoutSizes) for (const safe of plain ? [false] : [false,true]) {
        await p.send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:true});
        const insets=!safe?{top:0,bottom:0,left:0,right:0}:h>=w?{top:47,bottom:34,left:0,right:0}:{top:0,bottom:21,left:47,right:47};
        await p.read(`for(const [side,n] of Object.entries(${JSON.stringify(insets)}))document.documentElement.style.setProperty('--test-safe-'+side,n+'px')`);
        await sleep(120);
        for (const folded of [false,true]) {
          await p.read(`(()=>{const m=document.getElementById('miniMap');if(m.classList.contains('folded')!==${folded})document.getElementById('miniMapHead').click();const panel=document.getElementById('settings');panel.classList.toggle('open',document.body.classList.contains('phoneReadoutsMenu'));panel.scrollTop=0;})()`);
          await sleep(100);
          const value=await p.read(ordinaryPhone), key=`${brand}/${w}x${h}/${safe}/${folded}`;
          assert.equal(value.inline,'','off map has no inline width');
          if(baseline)parity[key]=value;else assert.deepEqual(value,parity[key],'exact main map geometry: '+key);
          assert.equal(await p.read('__propertyStubRequests.length'),0,'parity never enables property service');
        }
      }
    } finally {await p.close();}
  }
}
writeFileSync(resolve(out,'property-off-main-parity.json'),JSON.stringify({mainRef,sizes:layoutSizes.length,observations:parity},null,2));
console.log(`PASS exact off-map position/size against ${mainRef}: ${layoutSizes.length} layout sizes, both brands, open/folded and safe-area variants`);
for (const brand of ['mail', 'just']) for (const [w,h,safe] of [[320,460,false],[568,280,false],[568,280,true]]) {
  const origin = new URL(base); if (brand === 'just') origin.hostname='localhost';
  const p = await open(`${origin.origin}/${brand==='just'?'mabou':''}?${brand==='just'?'site=just&':''}touch=1&hud=1&q=low&shadows=0`, [w,h]);
  const name=`property-phone-${brand}-${w}x${h}${safe?'-safe':''}`;
  try {
    await p.read(`localStorage.removeItem('mmm:province-license:v1')`);
    if (safe) await p.read(`for (const [s,n] of Object.entries({left:47,right:47,top:0,bottom:21})) document.documentElement.style.setProperty('--test-safe-'+s,n+'px')`);
    await sleep(250);
    await p.read(`document.getElementById('settings').classList.toggle('open',document.body.classList.contains('phoneReadoutsMenu'))`);
    for (let n=0;n<2;n++) {
      const b=await p.read(ordinaryPhone);
      assert.equal(b.inline,'','untouched ordinary/folded map has no inline width');
      assert.equal(b.folded,!!n,'phone fold state');
      console.log('PHONE BASELINE '+name+' '+JSON.stringify(b));
      await p.read(`document.getElementById('miniMapHead').click()`); await sleep(200);
    }
    assert.equal(await p.read(`__propertyStubRequests.length`),0,'untouched phone feature never requests');
    await on(p);
    if (await p.read(`document.getElementById('propertyDialog').open`)) await p.read(`document.getElementById('propertyAgree').click()`);
    await p.read(`document.getElementById('miniMapEnlargeSetting').click()`); await close(p);
    await wait(p,`__mapLog.includes('drawImage')`,'phone enlarged image drawn');
    const credit=await p.read(creditRects); assert.deepEqual(credit.faults,[],name+': full credit/link visible');
    const enlarged=await p.read(`document.getElementById('miniMapCanvas').getBoundingClientRect().width`);
    assert.ok(enlarged>96,name+': phone map really enlarges');
    assert.equal(await p.read(`document.getElementById('miniMap').parentElement===document.body`),true,'enlarged map escapes clipped readouts');
    await p.shot(name+'-on');
    console.log('PHONE CREDIT '+name+' '+JSON.stringify(credit.boxes));
    const before=await p.read(`__propertyStubRequests.length`);
    await p.read(`document.getElementById('propertyCredit').style.cssText='max-height:4px;overflow:hidden'`);
    await wait(p,`!__mapLog.includes('drawImage') && __mapLog.includes('stroke')`,'clipped credit suppresses layer');
    assert.ok((await p.read(creditRects)).faults.length>0,'clip fixture actually clips');
    assert.equal(await p.read(`__propertyStubRequests.length`),before,'clipped credit makes no request');
    await p.read(`document.getElementById('propertyCredit').style.cssText=''`);
    await wait(p,`__mapLog.includes('drawImage')`,'full credit restores picture');
    assert.deepEqual((await p.read(creditRects)).faults,[]);
    await p.read(`document.getElementById('miniMapEnlargeSetting').click(); document.getElementById('miniMapLarge').click()`);
    assert.equal(await p.read(`document.getElementById('miniMap').parentElement.id`),'phoneReadouts','repeated enlargement still restores original parent');
    if (await p.read(`document.body.classList.contains('phoneReadoutsMenu')`)) {
      await wait(p,`!__mapLog.includes('drawImage')`,'closed Settings map cannot draw property images');
      const hiddenCount=await p.read('__propertyStubRequests.length');
      await p.read(`__propertyClockOffset += 6000; mmm.miniMap.update(1,50000,0,0,[],[]); __propertyClockOffset += 400; mmm.miniMap.update(1,50000,0,0,[],[])`);
      assert.equal(await p.read('__propertyStubRequests.length'),hiddenCount,'CSS-hidden map cannot start requests');
    }
    await on(p); await p.read(`document.getElementById('settings').classList.remove('open')`); await sleep(200);
    const restored=await p.read(ordinaryPhone);
    assert.equal(restored.inline,'');
    assert.equal(restored.folded,false,'ordinary open map restored after enlargement');
    console.log('PASS '+name+': main sizing while untouched, full visible credit/link, genuine enlargement, clipped-credit draw suppression');
  } finally {await p.close();}
}
for (const area of ['mabou', 'judique']) {
  const p = await open(`${base}/?era=1884&area=${area}&hud=1&q=low`);
  try { assert.equal(await p.read(`document.getElementById('propertyLines') === null`), true); assert.equal(await p.read(`__propertyStubRequests.length`), 0); console.log(`PASS 1884 ${area}: switch absent and zero requests, including unsupported-era fallback`); }
  finally { await p.close(); }
}
console.log('PASS Province network guard: zero novascotia.ca requests; all images are synthetic local PNGs');

}
