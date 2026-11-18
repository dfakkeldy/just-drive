// "Low detail" on a desktop: the phone's simpler picture (no shadows, grass, near trees, mirror water or logarithmic
// depth buffer), for a computer that is slow even at the "Fast" Picture setting. That happens when pixels are not what
// makes it slow: an old graphics chip, or a browser that draws in software because hardware acceleration is off.
// The choice is kept between visits. It needs a new start, because the renderer is made for one mode or the other.
// The settings panel also says what the browser draws with, so that a slow computer can be understood.

import { qualityStore } from './quality-store';
import { initialQuality, qualityTransition, type SavedDetail, type SessionMark, type QualityState } from './touch-quality-policy';

const KEY = 'mmm.detail';
export const DETAIL_TRYING = 'mmm.detail.trying';

/** One shared choice: low means phone detail; high opts touch into full detail. Unset keeps each device's default. */
export function readDetail(): SavedDetail {
  const value = qualityStore().read(KEY); return value === 'low' || value === 'high' ? value : null;
}

export const DETAIL_UNFINISHED = 'mmm.detail.unfinished';
export const DETAIL_DEATHS = 'mmm.detail.deaths';
export const SAVE_BLOCKED = 'This browser does not let the game save this choice.';

export function canSaveDetail(): boolean {
  return qualityStore().probe('mmm.detail.probe');
}
export function readQuality(): QualityState {
  try {
    const raw = qualityStore().read(DETAIL_TRYING);
    const mark: SessionMark = raw === 'try' || raw === 'ok' || raw === 'left-try' || raw === 'left-ok' ? raw : null;
    const count = (key: string) => { const n = Number(qualityStore().read(key)); return Number.isSafeInteger(n) && n >= 0 ? n : 0; };
    return initialQuality(mark, count(DETAIL_UNFINISHED), count(DETAIL_DEATHS));
  } catch { return initialQuality(); }
}
/** A successful call means the requested value was read back, even when a setter silently drops it. */
export function writeVerified(key: string, value: string | null, dependencies: string[] = []): boolean {
  return qualityStore().intend(key, value, dependencies);
}
export function writeQuality(s: QualityState): boolean {
  // Clean-leave evidence gets every chance even when a counter/read fails. Healthy evidence waits for its counters.
  if (s.mark?.startsWith('left-')) {
    const mark = writeVerified(DETAIL_TRYING, s.mark);
    const unfinished = writeVerified(DETAIL_UNFINISHED, s.unfinished ? String(s.unfinished) : null);
    const deaths = writeVerified(DETAIL_DEATHS, s.deaths ? String(s.deaths) : null);
    return mark && unfinished && deaths;
  }
  const unfinished = writeVerified(DETAIL_UNFINISHED, s.unfinished ? String(s.unfinished) : null);
  const deaths = writeVerified(DETAIL_DEATHS, s.deaths ? String(s.deaths) : null);
  const counters = unfinished && deaths;
  if (!counters) {
    // A visible session must not retain an older clean-leave signature while health is unconfirmed.
    if (s.mark === 'try' || s.mark === 'ok') writeVerified(DETAIL_TRYING, 'try');
  }
  const mark = writeVerified(DETAIL_TRYING, s.mark, [DETAIL_UNFINISHED, DETAIL_DEATHS]);
  return counters && mark;
}

export function saveDetail(value: SavedDetail): boolean {
  const selected = writeVerified(KEY, value);
  const reset = writeQuality(qualityTransition(readQuality(), { type: 'reset' }).state);
  const notice = value !== 'high' || writeVerified('mmm.detail.recovered', null);
  return selected && reset && notice;
}

/** True when the player has chosen low detail on this computer. */
export function savedLowDetail(): boolean {
  return readDetail() === 'low';
}

/** What the browser draws with, as it names it, and whether that is software and not a graphics chip. */
export function graphicsDevice(gl: WebGLRenderingContext | WebGL2RenderingContext): { name: string; software: boolean } {
  let name = '';
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    name = String((info && gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  } catch { /* a browser that will not say */ }
  return { name: name.trim(), software: isSoftware(name) };
}

/** Names that browsers give to drawing without a graphics chip. */
export const isSoftware = (name: string): boolean => /swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(name);

export interface DetailControl {
  /** After a first-visit measurement that ended slow: open the panel and point at the switch. */
  nudge(framesASecond: number): void;
}

/**
 * Adds one mirrored detail switch (Full detail on touch, Low detail on desktop) to the settings panel, before `before`.
 * `low`: the mode this page runs in. `go`: loads the page again (in a test, something else).
 */
export function detailSetting(gl: WebGLRenderingContext | WebGL2RenderingContext, panel: HTMLElement | null, before: HTMLElement | null,
  low: boolean, go: (search: string) => void = (search) => { location.search = search; }, touch = false, writable = !touch || canSaveDetail(), chosen?: () => void): DetailControl {
  if (!panel) return { nudge() {} };
  const group = Object.assign(document.createElement('div'), { id: 'detail' });
  group.style.cssText = 'margin-top:12px';
  const label = document.createElement('label');
  label.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0' + (touch ? ';min-height:56px' : '');
  const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: touch ? !low : low });
  box.style.width = 'auto';
  box.disabled = touch && !writable;
  label.append(box, touch ? 'Full detail' : 'Low detail');
  const note = Object.assign(document.createElement('small'), { textContent: touch ? 'Sharper land, shadows and reflections; needs a fast phone or tablet. The page loads again.' : 'For a slow computer: a simpler picture. The page loads again.' });
  if (box.disabled) note.textContent = SAVE_BLOCKED;
  note.style.cssText = 'display:block;margin-top:4px';
  const device = graphicsDevice(gl);
  const graphics = Object.assign(document.createElement('small'), { id: 'graphics' });
  graphics.style.cssText = 'display:block;margin-top:8px;overflow-wrap:anywhere';
  graphics.textContent = `Graphics: ${device.name || 'not told by the browser'}`;
  group.append(label, note);
  if (!touch) group.append(graphics);
  if (!touch && device.software) {
    const warn = Object.assign(document.createElement('small'), { id: 'graphicsSoftware',
      textContent: 'This is software drawing: the browser is not using the graphics chip, so the game is slow. Turn on hardware acceleration in the browser’s settings.' });
    warn.style.cssText = 'display:block;margin-top:4px;color:#f2b980;opacity:1';
    group.append(warn);
  }
  box.addEventListener('change', () => {
    const nextLow = touch ? !box.checked : box.checked;
    const nextSaved = nextLow ? 'low' : touch ? 'high' : null;
    if (box.disabled) return;
    let saved = false;
    if (touch) {
      saved = saveDetail(nextSaved);
      if (!saved) { box.checked = !low; box.disabled = true; note.textContent = SAVE_BLOCKED; return; }
    } else {
      // Preserve main's desktop path, including attempting the write when reads are blocked.
      writeVerified(KEY, nextLow ? 'low' : null);
      const actual = qualityStore().read(KEY);
      saved = actual !== undefined && (actual === 'low') === nextLow;
      if (saved) writeQuality(qualityTransition(readQuality(), { type: 'reset' }).state);
    }
    chosen?.();
    // A typed override wins until the player explicitly makes a saved choice here.
    const query = new URLSearchParams(location.search);
    query.delete('q');
    query.delete('detailRecovery');
    if (!saved) query.set('q', nextLow ? 'low' : 'high'); // Desktop's existing storage-independent switch.
    go(query.toString());
  });
  panel.insertBefore(group, before);
  return {
    nudge(framesASecond) {
      if (low || touch) return;
      const slow = Object.assign(document.createElement('small'), { id: 'detailNudge',
        textContent: `This computer draws about ${Math.round(framesASecond)} frames a second. Low detail may help.` });
      slow.style.cssText = 'display:block;margin-bottom:6px;color:#f2b980;opacity:1';
      document.getElementById('detailNudge')?.remove();
      group.prepend(slow);
      group.style.outline = '2px solid #f2b980';
      group.style.outlineOffset = '6px';
      panel.classList.add('open');
    },
  };
}
