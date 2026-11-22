const MESSAGE = 'A new version of the game is ready. Start again to get it.';
const PENDING_TARGET = 'mmm.update.target', ATTEMPT_PREFIX = 'mmm.update.tried.', RETRY_PREFIX = 'mmm.update.retried.';
const validKey = (key: unknown): key is string => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key);
let updateTarget: string | undefined;
// The offline worker says it has saved this build, so the next start can serve it in time.
let workerReady: string | undefined;
let stopVersionWatch = () => {};
let versionURL = '/version.json';

function savedTarget(): { from: string; target: string } | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_TARGET) ?? 'null') as { from?: string; target?: string } | null;
    return value && validKey(value.from) && validKey(value.target) ? { from: value.from, target: value.target } : undefined;
  }
  catch { return undefined; }
}

function alreadyTried(target: string): boolean {
  try { return sessionStorage.getItem(ATTEMPT_PREFIX + target) === '1'; }
  catch { return true; } // Without durable tab memory, automatic reload cannot be made safe.
}

/** Both automatic refresh and the button must pass this guard before any navigation. */
function reloadToBuild(target: string): boolean {
  try {
    if (!validKey(target) || sessionStorage.getItem(ATTEMPT_PREFIX + target) === '1') return false;
    const from = document.querySelector<HTMLMetaElement>('meta[name="mmm-page"]')?.content ?? '';
    sessionStorage.setItem(PENDING_TARGET, JSON.stringify({ from, target }));
    sessionStorage.setItem(ATTEMPT_PREFIX + target, '1');
    location.reload();
    return true;
  } catch { return false; }
}

/** One more press, never automatic: a slow worker that finished saving the build after the first reload. */
function canRetry(target: string): boolean {
  try { return workerReady === target && sessionStorage.getItem(RETRY_PREFIX + target) !== '1'; }
  catch { return false; }
}

function retryToBuild(target: string): boolean {
  try {
    if (!validKey(target) || !canRetry(target)) return false;
    const from = document.querySelector<HTMLMetaElement>('meta[name="mmm-page"]')?.content ?? '';
    sessionStorage.setItem(PENDING_TARGET, JSON.stringify({ from, target }));
    sessionStorage.setItem(RETRY_PREFIX + target, '1');
    location.reload();
    return true;
  } catch { return false; }
}

/** The live build's key, or nothing when the version file cannot be read (offline, a portal, an old browser). */
async function liveTarget(): Promise<string | undefined> {
  try {
    const endpoint = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href.includes('manifest-just') ? '/version-just.json' : versionURL;
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return undefined;
    const version = await response.json() as { schema?: number; pageKey?: string };
    return version.schema === 1 && validKey(version.pageKey) ? version.pageKey : undefined;
  } catch { return undefined; }
}

/** Without a target, the button still starts again once per page in this tab, as it did before targets. */
function plainReload(): boolean {
  try {
    const key = ATTEMPT_PREFIX + 'untargeted:' + (document.querySelector<HTMLMetaElement>('meta[name="mmm-page"]')?.content ?? '');
    if (sessionStorage.getItem(key) === '1') return false;
    sessionStorage.setItem(key, '1');
    location.reload();
    return true;
  } catch { return false; }
}

function markReloadUnavailable(button: HTMLButtonElement, text: HTMLElement | null): void {
  if (text) text.textContent = 'This tab could not finish the update. You can keep playing or use your browser’s reload control.';
  button.disabled = true; button.textContent = 'Use browser reload to update';
}

function markReloadReady(button: HTMLButtonElement, text: HTMLElement | null): void {
  if (text) text.textContent = MESSAGE;
  button.disabled = false; button.textContent = 'Start again';
}

/** True when the button can no longer navigate to the target. */
const reloadSpent = (target: string | undefined): boolean => !!target && alreadyTried(target) && !canRetry(target);

/** A failed/slow worker navigation must never turn the old saved title into a reload loop. */
export function showGameUpdate(target?: string, fromWorker = false): void {
  if (validKey(target)) { updateTarget = target; if (fromWorker) workerReady = target; }
  stopVersionWatch();
  if (document.getElementById('offlineUpdate')) {
    const button = document.getElementById('offlineReload') as HTMLButtonElement | null;
    if (button && updateTarget && alreadyTried(updateTarget)) {
      if (reloadSpent(updateTarget)) markReloadUnavailable(button, document.getElementById('offlineUpdateText'));
      else markReloadReady(button, document.getElementById('offlineUpdateText'));
    }
    return;
  }
  document.getElementById('boot')?.remove();
  const notice = document.createElement('aside');
  notice.id = 'offlineUpdate'; notice.setAttribute('role', 'status');
  const style = document.createElement('style');
  style.textContent = `
#offlineUpdate{position:fixed;z-index:100;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));top:calc(68px + env(safe-area-inset-top));max-width:620px;margin:0 auto;padding:12px;background:#0b1620;color:#eef2f6;border:1px solid #d0632e;border-radius:8px;font:14px/1.4 system-ui;display:flex;gap:12px;align-items:center;flex-wrap:wrap;box-sizing:border-box}
/* The left quarter holds readouts; the top rows hold status, stop hint and place arrival; the right edge holds Drone and Save picture; the lower edge holds driving controls. */
body.tcOn #offlineUpdate{left:calc(25% + 4px);right:calc(70px + var(--test-safe-right,env(safe-area-inset-right,0px)));top:calc(132px + var(--phone-top-gap,6px) + var(--test-safe-top,env(safe-area-inset-top,0px)));font-size:13px;margin:0}
@media(orientation:landscape){body.tcOn #offlineUpdate{top:calc(68px + var(--phone-top-gap,6px) + var(--test-safe-top,env(safe-area-inset-top,0px)))}}
`;
  notice.appendChild(style);
  const text = Object.assign(document.createElement('span'), { id: 'offlineUpdateText', textContent: MESSAGE });
  const button = Object.assign(document.createElement('button'), { type:'button', textContent:'Start again', id:'offlineReload' });
  button.style.cssText = 'min-width:100px;max-width:100%;min-height:44px;padding:8px 12px;background:#d0632e;color:white;border:0;border-radius:6px;font:inherit;cursor:pointer';
  const unavailable = () => markReloadUnavailable(button, text);
  if (reloadSpent(updateTarget)) unavailable();
  button.addEventListener('click', async () => {
    button.disabled = true;
    // Worker messages can precede the page's version check and do not carry a target key.
    const target = updateTarget ?? await liveTarget();
    if (target) updateTarget = target;
    if (target ? !reloadToBuild(target) && !retryToBuild(target) : !plainReload()) unavailable();
  });
  notice.append(text, button); document.body.appendChild(notice);
}

/** Every data request carries the identity delivered in this HTML, even before first setup replies. */
export function bindOfflineVersion(area='mabou'): string {
  if (area!=='mabou' || !isSecureContext || !('serviceWorker' in navigator)) return '';
  const pageKey = document.querySelector<HTMLMetaElement>('meta[name="mmm-page"]')?.content ?? '';
  navigator.serviceWorker.addEventListener('message', event => {
    const type = event.data?.type, target = event.data?.pageKey;
    // This page already runs the build the worker saved: nothing to start again for.
    if (type === 'update-ready' && validKey(target) && target === pageKey) return;
    if (type === 'version-unavailable' || type === 'update-ready') showGameUpdate(target, type === 'update-ready');
  });
  if (!pageKey) return '';
  const network = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!navigator.serviceWorker.controller) return network(input, init);
    if (url.pathname === '/mp' || url.pathname.startsWith('/mp/')) return network(input, init);
    if (url.origin === location.origin && /^\/(terrain|audio|models|areas)\//.test(url.pathname)) {
      url.searchParams.set('mmm-page', pageKey);
      const request = input instanceof Request ? new Request(url, input) : url;
      const response = await network(request, init);
      if (response.status === 409 && response.headers.get('X-MMM-Update') === '1') {
        showGameUpdate(); throw Object.assign(new Error(MESSAGE), { name:'GameUpdateRequired' });
      }
      return response;
    }
    return network(input, init);
  };
  addEventListener('pagehide', () => navigator.serviceWorker.controller?.postMessage({type:'collect'}));
  return pageKey;
}

/** Page identity is in the HTML, including saved shells and every brand/area page. */
export function watchGameVersion(just: boolean, mayReload: () => boolean): void {
  versionURL = just ? '/version-just.json' : '/version.json';
  const pageKey = document.querySelector<HTMLMetaElement>('meta[name="mmm-page"]')?.content;
  const builtAt = Number(document.querySelector<HTMLMetaElement>('meta[name="mmm-built-at"]')?.content);
  if (!validKey(pageKey) || !Number.isSafeInteger(builtAt) || builtAt <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined, checking = false, reloading = false, stopped = false;
  let lastChecked = -Infinity;
  const stop = () => {
    stopped = true; clearTimeout(timer);
    document.removeEventListener('visibilitychange', visibilityChanged);
  };
  stopVersionWatch = stop;
  const pending = savedTarget();
  if (pending?.from === pageKey && pending.target !== pageKey) { showGameUpdate(pending.target); return; }
  if (pending) { try { sessionStorage.removeItem(PENDING_TARGET); } catch { /* Keep the per-target guard. */ } }
  if (document.getElementById('offlineUpdate')) { stop(); return; }
  const check = async () => {
    if (document.visibilityState !== 'visible' || checking || reloading || stopped) return;
    if (Date.now() - lastChecked < 60000) return;
    checking = true; lastChecked = Date.now();
    try {
      const response = await fetch(versionURL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return;
      const next = await response.json() as { schema?: number; pageKey?: string; builtAt?: number };
      if (stopped || next.schema !== 1 || !validKey(next.pageKey) ||
          !Number.isSafeInteger(next.builtAt) || next.builtAt! <= builtAt || next.pageKey === pageKey) return;
      // Recheck after the request: Start or a visibility change can happen in flight.
      if (document.visibilityState === 'visible' && mayReload() && reloadToBuild(next.pageKey)) { reloading = true; stop(); }
      else showGameUpdate(next.pageKey);
    } catch { /* A failed check must not interrupt a drive or show a warning. */ }
    finally { checking = false; }
  };
  function schedule() {
    clearTimeout(timer);
    if (document.visibilityState !== 'visible' || stopped) return;
    timer = setTimeout(() => { void check(); schedule(); }, 10 * 60 * 1000);
  }
  function visibilityChanged() {
    if (document.visibilityState === 'visible') void check();
    schedule();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  void check(); schedule();
}
