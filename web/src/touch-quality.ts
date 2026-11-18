import { canSaveDetail, DETAIL_DEATHS, DETAIL_TRYING, DETAIL_UNFINISHED, readDetail, readQuality, saveDetail, writeQuality, writeVerified } from './detail';
import { qualityStore } from './quality-store';
import { initialQuality, qualityStart, qualityTransition, type QualityEvent, type QualityState, type Recovery } from './touch-quality-policy';

const NOTICE = 'mmm.detail.recovered';
const RECOVERY_PARAM = 'detailRecovery';
const LINE = 'Full detail was too much for this device. Phone detail is back on.';
const UNFINISHED = 'Full detail did not finish loading three times. Phone detail is back on.';
const reason = (value: string | null): Recovery => value === 'unfinished' ? value : value === 'device' || value === '1' ? 'device' : null;
const readNotice = (): Recovery => reason(qualityStore().read(NOTICE) ?? null);
type Values = { mark?: string | null; unfinished?: string | null; deaths?: string | null; detail?: string | null };
const values = (s: QualityState): Values => ({ mark: s.mark, unfinished: s.unfinished ? String(s.unfinished) : null, deaths: s.deaths ? String(s.deaths) : null });

/** Install lifecycle listeners before any awaited assets or renderer creation. `clock` is injectable in Node checks. */
export function startTouchQuality(touch: boolean, forced: string | null, clock = () => performance.now()) {
  const store = qualityStore(clock);
  const url = new URL(location.href);
  const addressNotice = touch && forced === 'low' ? reason(url.searchParams.get(RECOVERY_PARAM)) : null;
  let writable = !touch || canSaveDetail();
  const start = qualityStart(touch, forced, readDetail(), writable, readQuality());
  let state = addressNotice ? { ...initialQuality(), reason: addressNotice } : start.state;
  let monitor = start.guarded, tracking = start.guarded || start.action === 'fallback' || !!addressNotice;
  let low = start.low, wantLow = start.action === 'fallback' || !!addressNotice;
  let displayed = false;
  let notice = addressNotice ?? (start.action === 'fallback' ? state.reason : null);
  const wanted = (): Values => ({ ...values(state), ...(wantLow ? { detail: 'low' } : {}) });
  const flush = () => wantLow ? saveDetail('low') : writeQuality(state);
  const recoveryAddress = (persistent: boolean, noticeSaved: boolean) => {
    const next = new URL(location.href);
    if (!persistent || !noticeSaved) {
      next.searchParams.set('q', 'low');
      next.searchParams.set(RECOVERY_PARAM, state.reason ?? 'device');
    }
    return next.href;
  };
  const recover = (reload: boolean) => {
    wantLow = true; monitor = false;
    const persistent = flush();
    const noticeSaved = addressNotice && store.read(NOTICE) === 'shown:' + state.reason || writeVerified(NOTICE, state.reason ?? 'device');
    // A failed downgrade must never reload with saved high/left-ok, even if writes work on the next page.
    if (reload || (!persistent && forced !== 'low')) location.replace(recoveryAddress(persistent, noticeSaved));
  };
  if (wantLow) recover(false);
  else if (monitor) {
    // Confirm try before writing counters or starting heavy work. Failure leaves this visit in phone detail.
    if (!writeVerified(DETAIL_TRYING, 'try')) {
      writable = false; low = true; monitor = tracking = false;
      writeVerified(DETAIL_TRYING, null); // A refused visit must never leave evidence of a visible Full-detail death.
    }
    else flush();
  }
  const event = (event: QualityEvent) => {
    if (!tracking) return;
    if (monitor) {
      const next = qualityTransition(state, event); state = next.state;
      if (next.action === 'fallback') { notice = state.reason; recover(true); return; }
    }
    // Each lifecycle signal is a fresh chance, including duplicate leave signals after a failed write.
    flush();
  };
  if (tracking) {
    addEventListener('pagehide', () => event({ type: 'leave' }));
    document.addEventListener('visibilitychange', () => event({ type: document.hidden ? 'hide' : 'show' }));
    document.addEventListener('freeze', () => event({ type: 'leave' }));
    addEventListener('pageshow', () => event({ type: document.hidden ? 'hide' : 'show' }));
    if (document.hidden) event({ type: 'hide' });
  }
  return {
    low, writable,
    chosen() { state = qualityTransition(state, { type: 'reset' }).state; monitor = tracking = false; },
    get state() { return !start.guarded || low ? null : state.reason ? 'fallback' : state.mark === 'ok' || state.mark === 'left-ok' ? 'healthy' : 'trying'; },
    get session() { return { ...state }; },
    get persistence() { const snapshot = store.snapshot; return { wanted: wanted(), confirmed: { mark: store.value(DETAIL_TRYING), unfinished: store.value(DETAIL_UNFINISHED), deaths: store.value(DETAIL_DEATHS), detail: store.value('mmm.detail') }, pending: snapshot.pending, retryAt: snapshot.retryAt, intents: snapshot }; },
    frame(dt: number, settled: boolean, visible = !document.hidden) {
      if (monitor) {
        const next = qualityTransition(state, { type: 'frame', dt, settled, visible }); state = next.state;
        if (next.action === 'fallback') { notice = state.reason; recover(true); return; }
        if (next.action === 'write') flush();
      }
      store.frame(visible);
    },
    watch(canvas: HTMLCanvasElement) { if (monitor) canvas.addEventListener('webglcontextlost', () => event({ type: 'lost' })); },
    notice(panel: HTMLElement | null) {
      if (displayed || forced && !addressNotice) return;
      notice ??= readNotice();
      if (!touch || !low || !panel || !notice) return;
      if (store.read(NOTICE) === 'shown:' + notice) {
        if (addressNotice) { const clean = new URL(location.href); clean.searchParams.delete(RECOVERY_PARAM); history.replaceState(null, '', clean.href); }
        return;
      }
      if (!writeVerified(NOTICE, 'shown:' + notice)) return;
      if (addressNotice) { const clean = new URL(location.href); clean.searchParams.delete(RECOVERY_PARAM); history.replaceState(null, '', clean.href); }
      displayed = true;
      const line = Object.assign(document.createElement('p'), { id: 'detailRecovery', textContent: notice === 'unfinished' ? UNFINISHED : LINE });
      line.setAttribute('role', 'status'); panel.prepend(line); panel.classList.add('open');
    },
  };
}
