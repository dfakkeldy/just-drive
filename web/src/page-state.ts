import { isTestVisit } from './visit';

// The hidden signal works in every build; existing dev/tool title waits can migrate gradually.
export function pageState(params: URLSearchParams, dev: boolean, name?: string) {
  let legacyTitle = !name && (dev || isTestVisit(params));
  const error = document.createElement('div');
  error.id = 'gameError'; error.hidden = true;
  error.textContent = 'The game stopped. Reload the page to try again.';
  error.setAttribute('role', 'alert');
  Object.assign(error.style, { position: 'fixed', zIndex: '10000', bottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
    left: '12px', right: '12px', margin: 'auto', width: 'fit-content', padding: '10px 14px',
    background: '#0c141c', color: '#eef2f6', border: '1px solid #6b7780', font: '14px/1.4 system-ui',
    visibility: 'visible' });   // an ending hides every other child of the page; this line must still show
  document.body.append(error);
  let stopped = false, running = false;
  const signal = (value: boolean) => {
    document.documentElement.dataset.mmmReady = String(value);
    if (legacyTitle) document.title = value ? 'settled' : 'loading';
  };
  /** Called by the frame loop on every frame: from the first call on, the game counts as running. */
  const ready = (value: boolean) => { running = true; signal(value); };
  const fail = (why: unknown) => {
    if (stopped) return;
    stopped = true;
    signal(false);
    const boot = document.getElementById('boot');
    // While the loading screen is still up, say it there and nowhere else: one message, not two.
    if (boot) boot.textContent = `${name ?? 'Mabou Mail Madness'} could not start: ${why instanceof Error ? why.message : String(why)}. Reload to try again.`;
    else error.hidden = false;
    console.error(why);
  };
  // Until the frame loop has run once, any uncaught error is a failed start. After that, a stray error
  // (a refused audio resume, a lost pointer capture, another script on the page) must not stop a running
  // game: only the frame loop's own catch does that.
  const starting = (why: unknown) => { if (!running) fail(why); };
  addEventListener('error', ev => starting(ev.error ?? ev.message));
  addEventListener('unhandledrejection', ev => starting(ev.reason));
  signal(false);
  return { ready, fail, setTitle(value:string, legacyTools=false) { name=value; legacyTitle=legacyTools&&isTestVisit(params); document.title=legacyTitle?'loading':value; }, get stopped() { return stopped; } };
}
