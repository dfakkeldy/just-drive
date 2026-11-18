// Not converted: animals-shots.sh (inline), area-browser.mjs, bike-browser-check.mjs, coast-browser.mjs, explore-check.mjs, frame-budget-check.mjs, mp-ghosts-check.mjs, page-state-browser.mjs, pwa-area-browser.mjs, pwa-browser-check.mjs, pwa-migration-browser.mjs, pwa-opt-in-browser.mjs, touch-quality-browser.mjs, tree-culling-check.mjs.
// Shared CDP transport: bounded connect/HTTP/requests; crashes, disconnects and page exceptions fail the check.
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { writeFileSync } from 'node:fs';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const DEADLINE = 60000;
export async function cdpFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(DEADLINE) });
  if (!response.ok) throw Error(`CDP HTTP ${response.status}: ${url}`);
  // Read the body within the same abort deadline, not after returning the Response.
  const body = await response.text();
  return { json: async () => JSON.parse(body), text: async () => body };
}
export async function cdp(wsUrl, { deadline = DEADLINE, onEvent = () => {} } = {}) {
  const checkName = basename(process.argv[1] && process.argv[1] !== '-' ? process.argv[1] : process.env.MMM_CHECK_NAME ?? 'browser-check');
  const ws = new WebSocket(wsUrl), pending = new Map(), logs = [], errors = [];
  let id = 0, failure = null, opening;
  const release = error => {
    failure ??= error;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(failure); }
    pending.clear();
  };
  const ready = new Promise((resolve, reject) => {
    opening = setTimeout(() => { release(Error('CDP connection timeout')); reject(failure); ws.close(); }, deadline);
    ws.onopen = () => { clearTimeout(opening); resolve(); };
    ws.onerror = () => { clearTimeout(opening); release(Error('CDP socket error')); reject(failure); };
    ws.onclose = () => { clearTimeout(opening); release(Error('CDP socket closed')); reject(failure); };
  });
  ws.onmessage = ({ data }) => {
    let message;
    try { message = JSON.parse(data); } catch { release(Error('Invalid CDP response')); return; }
    if (message.method === 'Runtime.consoleAPICalled') logs.push(message.params.args.map(a => a.value ?? a.description).join(' '));
    if (message.method === 'Runtime.exceptionThrown') {
      const detail = message.params.exceptionDetails;
      const error = detail.exception?.description ?? detail.text;
      errors.push(error); logs.push('EXCEPTION ' + error);
      console.error(`${checkName}: page error: ${error}`);
      release(Error(`${checkName}: page exception: ${error}`));
      // Also fail checks that finish between requests (or ignore their error list).
      process.exitCode = 1;
    }
    if (message.method === 'Inspector.targetCrashed' || message.method === 'Target.targetCrashed') {
      console.error(`${checkName}: the page crashed`);
      errors.push('the page crashed'); release(Error('CDP target crashed')); process.exitCode = 1;
    }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timer);
      if (message.result?.exceptionDetails) {
        const reason = `${checkName}: ${request.method} threw: ${JSON.stringify(message.result.exceptionDetails)}\nexpression: ${request.expression ?? '(not an evaluate request)'}`;
        console.error(reason); process.exitCode = 1;
        request.reject(Error(reason));
      } else request.resolve(message);
    }
    onEvent(message);
  };
  await ready;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const next = ++id;
    const timer = setTimeout(() => { release(Error(`CDP timeout: ${method}`)); ws.close(); }, deadline);
    pending.set(next, { resolve, reject, timer, method, expression: params.expression });
    try { ws.send(JSON.stringify({ id: next, method, params })); }
    catch (error) { release(error); }
  });
  // Inspector.targetCrashed can leave the socket open. Subscribe on every page transport.
  await send('Inspector.enable'); await send('Runtime.enable');
  return { send, logs, errors, ws, assertHealthy: () => { if (failure) throw failure; }, close: () => ws.close() };
}
// Keep truck-cdp's public API. Its higher-level settling and screenshot helpers stay here.
export async function open(url) {
  const port = process.env.CDP_PORT ?? '9471';
  const tab = await (await cdpFetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  let c;
  const close = async () => {
    try { await cdpFetch(`http://127.0.0.1:${port}/json/close/${tab.id}`); }
    finally { c?.close(); }
  };
  try {
    c = await cdp(tab.webSocketDebuggerUrl, { deadline: 180000 });
    const { send, errors } = c;
    const read = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!response.error, JSON.stringify(response.error));
      return response.result.result.value;
    };
    await send('Runtime.enable'); await send('Page.enable');
    const navigate = async next => {
      const ready = await waitForSettled(read, next);
      assert.ok(ready, 'page settled: ' + errors.join(' | ')); c.assertHealthy();
    };
    const load = async next => { await send('Page.navigate', { url: next }); await navigate(next); };
    const shot = async file => { const m = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(m.result.data, 'base64')); };
    await load(url);
    return { send, read, navigate: load, close, shot, errors };
  } catch (error) { await close().catch(() => {}); throw error; }
}

// Match the previous truck helper: 240 polls PLUS the time needed for their answers.
// Under load a slow answer must not consume the poll budget as wall time.
export async function waitForSettled(read, next, { polls = 240, delay = 500 } = {}) {
  for (let n = 0; n < polls; n++) {
    await sleep(delay);
    if (await read(`document.title === "settled" && document.readyState === "complete" && location.href === ${JSON.stringify(next)}`)) return true;
  }
  return false;
}

// A caller's explicit pass must not erase a late page exception's failure status.
export function exitCheck(status = 0) {
  process.exit(process.exitCode || status);
}
