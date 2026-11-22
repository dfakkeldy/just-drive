// Execute the real module with tab storage shared across simulated worker fallback boots.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from '../web/node_modules/esbuild/lib/main.js';

const source = readFileSync('web/src/offline-version.ts', 'utf8');
const next = { schema: 1, pageKey: 'b'.repeat(64), builtAt: 200 };

function harness(code = source, storage = new Map(), own = { pageKey: 'a'.repeat(64), builtAt: 100 }) {
  const timers = new Map(), events = new Map(), elements = new Map(), requests = [];
  let reloads = 0, id = 0, allow = true, clock = 0, blocked = false;
  let response = () => Promise.resolve(new Response(JSON.stringify(next)));
  const element = () => ({
    style: {}, disabled: false, children: [], setAttribute() {},
    append(...nodes) { this.children.push(...nodes); for (const n of nodes) if (n.id) elements.set(n.id, n); },
    appendChild(n) { this.append(n); },
    addEventListener(name, fn) { this[name] = fn; },
    async press() { if (!this.disabled) await this.click?.(); }
  });
  const document = {
    visibilityState: 'visible',
    querySelector: s => s.includes('manifest') ? null : { content: s.includes('mmm-page') ? own.pageKey : String(own.builtAt) },
    getElementById: id => elements.get(id),
    createElement: element,
    body: { appendChild: n => elements.set(n.id, n) },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name, fn) => { if (events.get(name) === fn) events.delete(name); }
  };
  const sessionStorage = {
    getItem: key => { if (blocked) throw Error('storage blocked'); return storage.get(key) ?? null; },
    setItem: (key, value) => { if (blocked) throw Error('storage blocked'); storage.set(key, value); },
    removeItem: key => storage.delete(key)
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, document, sessionStorage, Date: { now: () => clock },
    location: {
      reload: () => {
        if (code === source && storage.get('mmm.update.tried.untargeted:' + own.pageKey) !== '1') {
          assert.equal(storage.get('mmm.update.tried.' + next.pageKey), '1', 'mark before reload');
          assert.equal(JSON.parse(storage.get('mmm.update.target')).target, next.pageKey, 'target before reload');
        }
        reloads++;
      }
    },
    AbortSignal,
    setTimeout: (fn, ms) => { assert.equal(ms, 600000); timers.set(++id, fn); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, init) => { requests.push({ url, init }); return response(); }
  });
  vm.runInContext(transformSync(code, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, context);
  return {
    document, timers, requests, elements, storage, module: module.exports,
    start: just => module.exports.watchGameVersion(just, () => allow),
    allow: value => { allow = value; },
    blockStorage: () => { blocked = true; },
    advance: ms => { clock += ms; },
    respond: fn => { response = fn; },
    reloads: () => reloads,
    visibility: value => { document.visibilityState = value; events.get('visibilitychange')?.(); },
    tick: () => { const entries = [...timers]; timers.clear(); for (const [, fn] of entries) fn(); }
  };
}

const flush = () => new Promise(r => setImmediate(r));

async function fallbackRegression(code = source) {
  const storage = new Map(), first = harness(code, storage);
  first.start(false); await flush(); assert.equal(first.reloads(), 1);
  const fallback = harness(code, storage);
  fallback.start(false); await flush();
  assert.equal(fallback.reloads(), 0, 'saved A must not reload B twice');
  assert.equal(fallback.elements.get('offlineReload')?.disabled, true);
  await fallback.elements.get('offlineReload').press();
  assert.equal(fallback.reloads(), 0);
  assert.equal(fallback.requests.length, 0);
  assert.equal(fallback.timers.size, 0);
  const third = harness(code, storage);
  third.start(false); await flush(); assert.equal(third.reloads(), 0);
  const arrived = harness(code, storage, { pageKey: next.pageKey, builtAt: 200 });
  arrived.start(false); await flush();
  assert.equal(arrived.elements.size, 0);
  assert.equal(storage.has('mmm.update.target'), false);
  assert.equal(storage.get('mmm.update.tried.' + next.pageKey), '1');
}

const noReloadGuard = source
  .replace("if (!validKey(target) || sessionStorage.getItem(ATTEMPT_PREFIX + target) === '1') return false;", "if (!validKey(target)) return false;")
  .replace("try { return sessionStorage.getItem(ATTEMPT_PREFIX + target) === '1'; }", "try { return false; }")
  .replace('const pending = savedTarget();', 'const pending = undefined as { from: string; target: string } | undefined;');
assert.notEqual(noReloadGuard, source, 'no-reload-guard mutant applies');
await fallbackRegression();
await assert.rejects(() => fallbackRegression(noReloadGuard), assert.AssertionError);
console.log('PASS no-reload-guard mutant rejected: worker fallback boots repeat a target reload');

// A slow worker serves saved A, then finishes saving B and says update-ready for B: one more press, never automatic.
async function workerRetry(code = source) {
  const storage = new Map(), first = harness(code, storage);
  first.start(false); await flush(); assert.equal(first.reloads(), 1);
  const fallback = harness(code, storage);
  fallback.start(false); await flush();
  assert.equal(fallback.elements.get('offlineReload').disabled, true, 'fallback locks first');
  fallback.module.showGameUpdate(next.pageKey, true);
  assert.equal(fallback.reloads(), 0, 'worker ready never reloads by itself');
  assert.equal(fallback.elements.get('offlineReload').disabled, false, 'worker ready unlocks one press');
  await fallback.elements.get('offlineReload').press(); assert.equal(fallback.reloads(), 1);
  assert.equal(storage.get('mmm.update.retried.' + next.pageKey), '1', 'mark retry before reload');
  const again = harness(code, storage);
  again.start(false); await flush();
  again.module.showGameUpdate(next.pageKey, true);
  assert.equal(again.elements.get('offlineReload').disabled, true, 'second fallback stays locked');
  await again.elements.get('offlineReload').press(); assert.equal(again.reloads(), 0);
  const page = harness(code, storage);
  page.start(false); await flush();
  page.module.showGameUpdate(next.pageKey, false);
  assert.equal(page.elements.get('offlineReload').disabled, true, 'a page check alone cannot unlock');
}
const noRetryGuard = source.replace("workerReady === target && sessionStorage.getItem(RETRY_PREFIX + target) !== '1'", 'workerReady === target');
assert.notEqual(noRetryGuard, source, 'no-retry-guard mutant applies');
await workerRetry();
await assert.rejects(() => workerRetry(noRetryGuard), assert.AssertionError);
console.log('PASS worker-ready retry: one press after a slow worker saves the build; no-retry-guard mutant rejected');

async function activeSafety(code = source) {
  const h = harness(code); h.allow(false); h.start(false); await flush();
  assert.equal(h.reloads(), 0, 'active drive cannot reload');
  assert.equal(h.elements.size >= 1, true);
  assert.equal(h.elements.get('offlineReload').textContent, 'Start again');
}
async function hiddenSafety(code = source) {
  const h = harness(code); h.respond(() => Promise.resolve(new Response(JSON.stringify({ ...next, builtAt: 100 }))));
  h.start(false); await flush(); h.requests.length = 0; h.advance(600000);
  h.document.visibilityState = 'hidden'; h.tick(); await flush();
  assert.equal(h.requests.length, 0, 'queued timer cannot poll hidden page');
}
async function hiddenSchedule(code = source) {
  const h = harness(code); h.respond(() => Promise.resolve(new Response(JSON.stringify({ ...next, builtAt: 100 }))));
  h.start(false); await flush(); h.visibility('hidden');
  assert.equal(h.timers.size, 0, 'hidden page must have no scheduled poll');
}
await activeSafety(); await hiddenSafety(); await hiddenSchedule();

for (const just of [false, true]) {
  const h = harness(); let finish; h.respond(() => new Promise(r => { finish = r; }));
  h.start(just);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, just ? '/version-just.json' : '/version.json');
  assert.equal(h.requests[0].init.cache, 'no-store');
  h.allow(false); finish(new Response(JSON.stringify(next))); await flush();
  assert.equal(h.reloads(), 0, 'Start while response pending');
  assert.ok(h.elements.get('offlineUpdate'));
  assert.equal(h.timers.size, 0, 'notice stops timer');
  h.advance(600000); h.visibility('hidden'); h.visibility('visible'); h.tick(); await flush();
  assert.equal(h.requests.length, 1, 'notice stops visibility checks');
  await h.elements.get('offlineReload').press(); assert.equal(h.reloads(), 1, 'manual button stores target and reloads');
  await h.elements.get('offlineReload').press(); assert.equal(h.reloads(), 1, 'manual button cannot repeat target');
}

const throttled = harness();
throttled.respond(() => Promise.resolve(new Response(JSON.stringify({ ...next, builtAt: 100 }))));
throttled.start(false); await flush();
for (let n = 0; n < 5; n++) { throttled.visibility('hidden'); throttled.visibility('visible'); }
await flush(); assert.equal(throttled.requests.length, 1);
throttled.advance(59999); throttled.visibility('visible'); await flush(); assert.equal(throttled.requests.length, 1);
throttled.advance(1); throttled.visibility('visible'); await flush(); assert.equal(throttled.requests.length, 2, '60-second boundary permits one check');

const worker = harness();
worker.respond(() => Promise.resolve(new Response(JSON.stringify({ ...next, builtAt: 100 }))));
worker.start(false); await flush();
worker.module.showGameUpdate(); assert.equal(worker.timers.size, 0, 'worker notice stops timer');
worker.respond(() => Promise.resolve(new Response(JSON.stringify(next))));
await worker.elements.get('offlineReload').press(); assert.equal(worker.reloads(), 1, 'worker-only notice resolves target before reload');

{
  // Worker-only notice while offline: clicking Start again reloads once per current pageKey and does not loop.
  const storage = new Map(), own = { pageKey: 'a'.repeat(64), builtAt: 100 };
  let reloads = 0;
  const elements = new Map();
  const element = () => ({ style: {}, disabled: false, children: [], setAttribute() {}, append(...n) { for (const c of n) if (c.id) elements.set(c.id, c); }, appendChild(c) { this.append(c); }, addEventListener(n, fn) { this[n] = fn; }, async press() { if (!this.disabled) await this.click?.(); } });
  const module = { exports: {} };
  vm.runInContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code, vm.createContext({
    module, exports: module.exports,
    navigator: { onLine: false },
    document: { visibilityState: 'visible', querySelector: s => s.includes('manifest') ? null : { content: s.includes('mmm-page') ? own.pageKey : String(own.builtAt) }, getElementById: id => elements.get(id), createElement: element, body: { appendChild: n => elements.set(n.id, n) }, addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    location: { reload: () => { reloads++; } },
    AbortSignal, setTimeout, clearTimeout,
    fetch: () => Promise.reject(Error('offline'))
  }));
  module.exports.showGameUpdate();
  await elements.get('offlineReload').press();
  assert.equal(reloads, 1, 'offline worker-only notice reloads once');
  assert.equal(storage.get('mmm.update.tried.untargeted:' + own.pageKey), '1');
  // Second click in same tab/fallback locks instead of looping.
  elements.get('offlineReload').disabled = false;
  await elements.get('offlineReload').press();
  assert.equal(reloads, 1, 'offline worker-only notice refuses second reload');
  assert.equal(elements.get('offlineReload').disabled, true);
}

{
  // Online but the version file fails (a portal, a server error): the worker notice still starts again once.
  const storage = new Map(), failed = () => Promise.resolve(new Response('portal', { status: 503 }));
  const first = harness(source, storage); first.respond(failed);
  first.module.showGameUpdate(); await first.elements.get('offlineReload').press();
  assert.equal(first.reloads(), 1, 'untargeted notice reloads once when the version file fails');
  const again = harness(source, storage); again.respond(failed);
  again.module.showGameUpdate(); await again.elements.get('offlineReload').press();
  assert.equal(again.reloads(), 0, 'untargeted reload does not repeat on the same page');
  assert.equal(again.elements.get('offlineReload').disabled, true);
}

const late = harness();
late.storage.set('mmm.update.tried.' + next.pageKey, '1');
late.module.showGameUpdate(); assert.equal(late.elements.get('offlineReload').disabled, false);
late.module.showGameUpdate(next.pageKey); assert.equal(late.elements.get('offlineReload').disabled, true, 'late target locks existing worker notice');

const blocked = harness();
blocked.blockStorage(); blocked.start(false); await flush();
assert.equal(blocked.reloads(), 0); assert.ok(blocked.elements.get('offlineUpdate'));
assert.equal(blocked.elements.get('offlineReload').disabled, true, 'blocked storage cannot start an unsafe reload');

for (const data of [{ ...next, builtAt: 99 }, { ...next, pageKey: 'a'.repeat(64) }, null, { ...next, builtAt: '200' }, { ...next, pageKey: 'bad' }]) {
  const h = harness(); h.respond(() => Promise.resolve(new Response(JSON.stringify(data))));
  h.start(false); await flush(); assert.equal(h.reloads(), 0); assert.equal(h.elements.size, 0);
}
const error = harness(); error.respond(() => Promise.reject(Error('offline')));
error.start(false); await flush(); assert.equal(error.elements.size, 0); assert.equal(error.reloads(), 0);

function settingsProbe(main) {
  const match = main.match(/watchGameVersion\(SITE\.brand === 'just', (.+)\);/);
  assert.ok(match);
  let open = false, legal = true, typing = false;
  const doc = {
    getElementById: id => id === 'title' ? { hidden: false } : id === 'settings' ? { classList: { contains: () => open } } : id === 'titleLegal' ? { hidden: legal } : null,
    get activeElement() { return { matches: () => typing }; }
  };
  const may = vm.runInNewContext(match[1], { hasStarted: false, document: doc });
  assert.equal(may(), true);
  open = true;
  assert.equal(may(), false, 'open settings excludes automatic refresh');
  open = false; legal = false;
  assert.equal(may(), false, 'open credits exclude automatic refresh');
  legal = true; typing = true;
  assert.equal(may(), false, 'a focused field excludes automatic refresh');
}
const mainSource = readFileSync('web/src/main.ts', 'utf8');
settingsProbe(mainSource);
const noSettingsGuard = mainSource.replace(" && !document.getElementById('settings')?.classList.contains('open')", '');
assert.notEqual(noSettingsGuard, mainSource, 'no-settings-guard mutant applies');
assert.throws(() => settingsProbe(noSettingsGuard), assert.AssertionError);
console.log('PASS actual main predicate protects open settings; no-settings-guard mutant rejected');

for (const [name, from, to, probe] of [
  ['reload-after-start', '&& mayReload()', '&& true', activeSafety],
  ['poll-hidden-check', "document.visibilityState !== 'visible' || checking", 'checking', hiddenSafety],
  ['poll-hidden-schedule', "document.visibilityState !== 'visible' || stopped", 'stopped', hiddenSchedule]
]) {
  assert.ok(source.includes(from), name + ' anchor');
  await assert.rejects(() => probe(source.replace(from, to)), assert.AssertionError);
  console.log('PASS rejected ' + name + ' mutant');
}
console.log('PASS reload target/session guards, storage failure, button guard, 60-second visibility gap, stop-on-notice, hidden guards, settings, brands, no-store, 10-minute timer, pending Start and quiet errors');
