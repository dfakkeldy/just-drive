// Phone LOW cold start on a throttled network, against a production site build (tools/build_site.sh).
// Usage: CDP_PORT=… node tools/phone-cold-start.mjs OUT BASE
// Start an owned hardware browser and the built-site server first (tools/phone-cold-start.sh does both).
// Each run: cold cache and storage, 844x390 phone, touch, q=low, 1.5 Mbit/s and 150 ms, explicit Highway 19 start.
// It records every request until the page says ready, takes the start picture, then holds the real throttle key
// (the player's first pedal) and drives a scripted line for DRIVE_SECONDS, with pictures and bytes along the way.
// Jobs: forward (Highway 19 ahead) and turn (a U-turn after TURN_AFTER seconds, to look at the land behind the start).
// Exit 1 when a run shows a page error, a failed request or no ready signal.
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { cdp, cdpFetch, sleep } from './cdp.mjs';

const [out, base] = process.argv.slice(2);
if (!base) throw Error('usage: node tools/phone-cold-start.mjs OUT BASE');
mkdirSync(out, { recursive: true });
const port = process.env.CDP_PORT ?? '9877';
const driveSeconds = Number(process.env.DRIVE_SECONDS ?? 60);
const turnAfter = Number(process.env.TURN_AFTER ?? 8);
const jobs = (process.env.COLD_JOBS ?? 'forward turn').split(/\s+/).filter(Boolean);
const shotsAt = (process.env.SHOT_SECONDS ?? '15 30 45 60').split(/\s+/).map(Number);
const throttle = process.env.COLD_NETWORK !== 'local';
// Highway 19, 51 m from the manifest village point (the 13 Nov tile-pack measurement used the same place).
const start = '624303.3,5103261.34';
const heading = Math.atan2(3.1, 2.53) * 180 / Math.PI;   // along road 26, as the 13 Nov drive legs
// The fleet keeps several Vehicle objects (car, truck, side by side): the driven one is the one at the start.
const startWorld = [624303.3 - 624271, 5103301 - 5103261.34];
const roadData = JSON.parse(readFileSync(new URL('../data/baked/terrain/roads.json', import.meta.url), 'utf8'));
const results = [];
let failed = false;

// Pure pursuit through the production fixed-step input hook. The physics, land and streaming stay the game's own.
function installDriver(points, turnAfterSteps) {
  const v = window.__coldVehicle;
  if (v.beforeStep) throw Error('vehicle input hook already owned');
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  let path = points, cum = [], segment = 1, steps = 0;
  const measure = () => { cum = [0]; for (let i = 1; i < path.length; i++) cum.push(cum.at(-1) + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])); };
  measure();
  function nearest(all = false) {
    let best = { distance: Infinity };
    for (let i = all ? 1 : Math.max(1, segment - 35); i < (all ? path.length : Math.min(path.length, segment + 100)); i++) {
      const a = path[i - 1], b = path[i], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = clamp(((v.x - a[0]) * dx + (v.z - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const x = a[0] + t * dx, z = a[1] + t * dz, distance = Math.hypot(v.x - x, v.z - z);
      if (distance < best.distance) best = { distance, s: cum[i - 1] + t * (cum[i] - cum[i - 1]), i };
    }
    segment = best.i; return best;
  }
  nearest(true);
  window.__coldDrive = { turned: false, deviation: 0 };
  v.beforeStep = () => {
    if (turnAfterSteps > 0 && ++steps === turnAfterSteps) { path = path.slice().reverse(); measure(); nearest(true); window.__coldDrive.turned = true; }
    const hit = nearest(), s = Math.min(cum.at(-1), hit.s + Math.max(6, Math.abs(v.speed) * 1.2));
    let i = hit.i; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = path[i - 1], b = path[i], t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const h = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
    const x = a[0] + t * (b[0] - a[0]) + Math.cos(h) * 1.1, z = a[1] + t * (b[1] - a[1]) + Math.sin(h) * 1.1;
    const want = Math.atan2(x - v.x, -(z - v.z)), err = Math.atan2(Math.sin(want - v.heading), Math.cos(want - v.heading));
    const spec = v.spec, lock = Math.min(spec.maxSteer, Math.atan(spec.wheelbase * spec.gripLock * spec.cornering * 9.81 / Math.max(v.speed * v.speed, 4)));
    const ask = Math.atan2(2 * spec.wheelbase * Math.sin(err), Math.max(1, Math.hypot(x - v.x, z - v.z))) / lock;
    window.__coldDrive.deviation = hit.distance;
    // A U-turn needs a slower car: the hook asks for 6 m/s while the error is large.
    const cruise = Math.abs(err) > 0.6 ? 6 : 12;
    return { throttle: clamp((cruise - v.speed) * .5, -1, 1), steer: clamp(ask, -1, 1), handbrake: false, touch: true };
  };
}

async function run(job) {
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const requests = new Map(), failures = [], marks = [];
  let connection, paused = null;
  const name = `${job}-${throttle ? 'slow' : 'local'}`;
  try {
    connection = await cdp(tab.webSocketDebuggerUrl, { onEvent(m) {
      const p = m.params;
      if (m.method === 'Debugger.paused') paused = p;
      if (m.method === 'Network.requestWillBeSent') requests.set(p.requestId, { url: p.request.url, started: p.timestamp });
      else if (m.method === 'Network.responseReceived') {
        const r = requests.get(p.requestId);
        if (r) Object.assign(r, { status: p.response.status, cached: p.response.fromDiskCache || p.response.fromServiceWorker });
      } else if (m.method === 'Network.loadingFinished') {
        const r = requests.get(p.requestId); if (r) Object.assign(r, { ended: p.timestamp, wireBytes: p.encodedDataLength });
      } else if (m.method === 'Network.loadingFailed') {
        failures.push(p); const r = requests.get(p.requestId); if (r) r.failure = p.errorText;
      }
    } });
    const { send } = connection;
    const read = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.error || r.result?.exceptionDetails) throw Error(JSON.stringify(r.error ?? r.result.exceptionDetails));
      return r.result.result.value;
    };
    const http = () => [...requests.values()].filter(r => r.url.startsWith('http'));
    const tally = label => {
      const all = http(), done = all.filter(r => r.ended);
      const mark = { label, at: Date.now(), requests: all.length, completed: done.length, wireBytes: done.reduce((n, r) => n + (r.wireBytes ?? 0), 0) };
      marks.push(mark); return mark;
    };
    const shoot = async label => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/${name}-${label}.png`, Buffer.from(shot.result.data, 'base64'));
    };
    // Find the production Vehicle once through the debugger (no dev build or global), then let go of the debugger.
    const attachVehicle = async () => {
      await send('Debugger.enable');
      try {
        await send('Debugger.pause');
        for (let i = 0; !paused && i < 100; i++) await sleep(20);
        if (!paused) throw Error('no telemetry pause');
        for (const frame of paused.callFrames) for (const scope of frame.scopeChain) {
          if (scope.type !== 'module') continue;
          const properties = (await send('Runtime.getProperties', { objectId: scope.object.objectId, ownProperties: true })).result.result;
          const names = properties.filter(p => p.value?.type === 'object' && p.value.objectId && /^[\w$]+$/.test(p.name)).map(p => p.name);
          const result = await send('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId,
            expression: `(()=>{const values=[${names.join(',')}];const v=values.filter(v=>v&&typeof v.update==='function'&&v.car&&typeof v.heading==='number'&&typeof v.speed==='number'&&typeof v.x==='number');if(!v.length)return false;v.sort((a,b)=>Math.hypot(a.x-${startWorld[0]},a.z-${startWorld[1]})-Math.hypot(b.x-${startWorld[0]},b.z-${startWorld[1]}));window.__coldVehicle=v[0];return true;})()`, returnByValue: true });
          if (result.result?.result?.value) return;
        }
        throw Error('production vehicle binding not found');
      } finally {
        if (paused) await send('Debugger.resume');
        await send('Debugger.disable'); paused = null;
      }
    };
    await send('Page.enable'); await send('Network.enable');
    await send('Network.clearBrowserCache');
    await send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'all' });
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    if (throttle) await send('Network.emulateNetworkConditions', { offline: false, latency: 150,
      downloadThroughput: 1_500_000 / 8, uploadThroughput: 1_500_000 / 8, connectionType: 'cellular3g' });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      localStorage.clear(); window.__cold={ready:null,boot:null};
      new MutationObserver(()=>{
        if(document.documentElement?.dataset.mmmReady==='true' && __cold.ready===null) __cold.ready=performance.now();
        if(__cold.boot===null && document.body && !document.getElementById('boot')) __cold.boot=performance.now();
      }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-mmm-ready']});` });
    const query = new URLSearchParams({ touch: '1', q: 'low', res: '1', radio: '0', mode: 'explore', at: `${start},${heading}` });
    const url = `${base}/?${query}`;
    const navigated = Date.now();
    await send('Page.navigate', { url });
    const deadline = Date.now() + 12 * 60_000;
    let state;
    while (true) {
      if (Date.now() > deadline) throw Error('no ready signal within 12 minutes');
      connection.assertHealthy();
      state = await read(`({ready:window.__cold?.ready??null,boot:window.__cold?.boot??null,error:document.getElementById('gameError')?.hidden===false})`);
      if (state.error) throw Error('production gameError visible');
      if (state.ready != null) break;
      await sleep(100);
    }
    const ready = tally('ready');
    await shoot('start');
    // The first drive: the real throttle key, so the game's own "waiting to drive" ends as for a player.
    await attachVehicle();
    const points = [25, 28, 26].flatMap(id => roadData.roads.find(r => r.id === id).pts).map(([e, n]) => [e - 624271, 5103301 - n]);
    await read(`(${installDriver.toString()})(${JSON.stringify(points)}, ${job === 'turn' ? Math.round(turnAfter * 60) : 0})`);
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    const driveStart = Date.now();
    const pending = [...shotsAt];
    while (Date.now() - driveStart < driveSeconds * 1000) {
      connection.assertHealthy();
      const s = await read(`({error:document.getElementById('gameError')?.hidden===false})`);
      if (s.error) throw Error('production gameError visible while driving');
      const elapsed = (Date.now() - driveStart) / 1000;
      if (pending.length && elapsed >= pending[0]) { const at = pending.shift(); tally(`drive-${at}s`); await shoot(`drive-${at}s`); }
      await sleep(250);
    }
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 });
    const end = tally(`drive-end`);
    const final = await read(`({ready:__cold.ready,boot:__cold.boot,signal:document.documentElement.dataset.mmmReady,drive:window.__coldDrive,
      pose:{x:__coldVehicle.x,z:__coldVehicle.z,speed:__coldVehicle.speed},devGlobal:!!window.mmm})`);
    const all = http();
    const row = { name, job, throttle, url, readyMs: final.ready, bootMs: final.boot,
      beforeDrive: { requests: ready.requests, completed: ready.completed, wireBytes: ready.wireBytes },
      afterDrive: { seconds: driveSeconds, requests: end.requests, completed: end.completed, wireBytes: end.wireBytes },
      marks: marks.map(m => ({ ...m, at: (m.at - navigated) / 1000 })), final, failures, requestsRaw: all };
    writeFileSync(`${out}/${name}.json`, JSON.stringify(row, null, 2));
    results.push(row);
    const mb = n => +(n / 1e6).toFixed(2);
    console.log('COLD', JSON.stringify({ name, readyS: +(final.ready / 1000).toFixed(1), bootS: +(final.boot / 1000).toFixed(1),
      requestsBeforeDrive: ready.requests, mbBeforeDrive: mb(ready.wireBytes), requestsAfter: end.requests, mbAfter: mb(end.wireBytes),
      failures: failures.length, devGlobal: final.devGlobal }));
    if (failures.length) { failed = true; console.error(`${name}: ${failures.length} failed requests`); }
    if (final.devGlobal) { failed = true; console.error(`${name}: a dev global is present; this is not the production build`); }
  } catch (error) {
    failed = true;
    writeFileSync(`${out}/${name}-error.json`, JSON.stringify({ name, error: String(error.stack ?? error), requestsRaw: [...requests.values()], failures }, null, 2));
    console.error(`${name}: ${error.stack ?? error}`);
  } finally {
    await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
    connection?.close();
  }
}

for (const job of jobs) await run(job);
writeFileSync(`${out}/summary.json`, JSON.stringify(results.map(({ requestsRaw, ...r }) => r), null, 2));
process.exit(failed ? 1 : 0);
