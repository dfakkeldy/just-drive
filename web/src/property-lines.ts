import { clientBounds } from './element-visibility';
import type { MapBounds, MiniMap } from './minimap';
import { toggle } from './settings';
import { PropertyGate, propertyViewBox, propertyWorldRect, PROPERTY_ATTRIBUTION, PROPERTY_DISCLAIMER,
  PROPERTY_REQUEST_NOTE,  PROPERTY_LICENSE_URL, PROPERTY_UNAVAILABLE, type PropertyStorage } from './property-lines-rules';
import { PropertyImages } from './property-lines-loader';

export interface PropertyGroundTarget {
  show(image: HTMLImageElement, rect: readonly [number, number, number, number], car: { x: number; z: number }): void;
  blank(): void;
  hide(): void;
}
interface PropertyControl {
  update?: (x: number, z: number, visible: boolean) => void;
  setGround(target: PropertyGroundTarget): void;
}

const CSS = `
#propertyCredit{position:fixed;z-index:7;box-sizing:border-box;left:max(8px,var(--test-safe-left,env(safe-area-inset-left,0px)));right:max(8px,var(--test-safe-right,env(safe-area-inset-right,0px)));
  bottom:max(8px,var(--test-safe-bottom,env(safe-area-inset-bottom,0px)));max-width:640px;margin:0 auto;padding:6px 8px;font:10px/1.35 system-ui,sans-serif;letter-spacing:0;color:#e0ece8;background:#0b1620;border:1px solid #8ca49e}
#propertyCredit a{white-space:nowrap}body.tcOn.propertyLinesOn #phoneHud{padding-bottom:calc(8px + var(--safe-bottom,0px) + var(--map-credit-space,0px))}
/* The credit line sits above the licence, centred in its column, and ends before the place card at the right (334 px). */
body.propertyLinesOn #credit{left:max(8px,env(safe-area-inset-left,0px));right:max(8px,env(safe-area-inset-right,0px));
  max-width:max(240px,min(640px,calc(100vw - 692px)));margin:0 auto;text-align:center;bottom:calc(6px + var(--map-credit-space,0px) + env(safe-area-inset-bottom,0px))}
@media(max-width:907px){body.propertyLinesOn #credit{max-width:calc(100vw - 360px);margin:0;text-align:left}}
#propertyCredit a,#propertyDialog a{color:#bceaff}
#propertyDialog{color:#eef2f6;background:#13232c;border:1px solid #8ca49e;border-radius:8px;padding:22px;
  width:min(560px,calc(100vw - 56px));max-height:80dvh;overflow:auto;font:15px/1.5 system-ui,sans-serif}
#propertyDialog::backdrop{background:#000b}#propertyDialog h2{margin-top:0}
#propertyDisclaimer{white-space:pre-line}#propertyDialog button{margin:14px 12px 0 0;min-height:44px;padding:8px 18px;font:inherit}
#propertyNotice{position:fixed;z-index:10;bottom:calc(16px + env(safe-area-inset-bottom,0px));left:12px;right:12px;
  margin:auto;width:fit-content;max-width:calc(100vw - 48px);padding:10px 14px;background:#13232c;color:#eef2f6;border-radius:6px;font:14px system-ui,sans-serif}
`;

/** A picture may only draw when its whole credit and licence link can be seen. */
export function fullyVisible(element: HTMLElement): boolean {
  const r = element.getBoundingClientRect(), viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  if (element.hidden || r.width <= 0 || r.height <= 0 || r.left < left || r.top < top
    || r.right > left + (viewport?.width ?? innerWidth) || r.bottom > top + (viewport?.height ?? innerHeight)
    || element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (parent.hidden || style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0') return false;
    if (parent === element) continue;
    const box = clientBounds(parent);
    if (/hidden|clip|auto|scroll/.test(style.overflowX) && (r.left < box.left || r.right > box.right)) return false;
    if (/hidden|clip|auto|scroll/.test(style.overflowY) && (r.top < box.top || r.bottom > box.bottom)) return false;
  }
  for (const [x, y] of [[r.left + 1, r.top + 1], [r.right - 1, r.top + 1], [r.left + 1, r.bottom - 1], [r.right - 1, r.bottom - 1]]) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) return false;
  }
  return true;
}

/** Both brands use the same minimap. Era gating happens before building a control or touching the service. */
export function propertyLines(map: MiniMap | null, origin: readonly [number, number], modern: boolean): PropertyControl | undefined {
  if (!map || !modern) return;
  let storage: PropertyStorage | undefined;
  try { storage = localStorage; } catch { /* Memory only. */ }
  const gate = new PropertyGate(modern, storage);
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const credit = Object.assign(document.createElement('div'), { id: 'propertyCredit', hidden: true });
  const licence = () => Object.assign(document.createElement('a'), { href: PROPERTY_LICENSE_URL, textContent: 'Licence', target: '_blank', rel: 'noopener noreferrer' });
  const creditLink = licence(); credit.append(PROPERTY_ATTRIBUTION, ' ', creditLink);
  document.body.append(credit);
  const dialog = Object.assign(document.createElement('dialog'), { id: 'propertyDialog' });
  dialog.setAttribute('aria-labelledby', 'propertyDialogTitle');
  const heading = Object.assign(document.createElement('h2'), { id: 'propertyDialogTitle', textContent: 'Property lines' });
  const disclaimer = Object.assign(document.createElement('div'), { id: 'propertyDisclaimer', textContent: PROPERTY_DISCLAIMER });
  const note = Object.assign(document.createElement('p'), { id: 'propertyRequestNote', textContent: PROPERTY_REQUEST_NOTE });
  const agree = Object.assign(document.createElement('button'), { id: 'propertyAgree', textContent: 'I agree' });
  const cancel = Object.assign(document.createElement('button'), { id: 'propertyCancel', textContent: 'Cancel' });
  dialog.append(heading, note, disclaimer, licence(), document.createElement('br'), agree, cancel);
  document.body.append(dialog);
  const images = new PropertyImages<HTMLImageElement>(gate, {
    fetch: (url, options) => fetch(url, options), createURL: blob => URL.createObjectURL(blob), revokeURL: url => URL.revokeObjectURL(url),
    decode: async url => { const image = new Image(); image.src = url; await image.decode(); return image; },
    online: () => navigator.onLine, failure: () => fail(),
  });
  const planner = images.planner;
  let ground: PropertyGroundTarget | undefined;
  let mode: 'map' | 'ground' = 'map';
  const modeLabel = document.createElement('label'); modeLabel.textContent = 'Show property lines ';
  const modes = Object.assign(document.createElement('select'), { id: 'propertyMode' });
  const onMap = Object.assign(document.createElement('option'), { value: 'map', textContent: 'on the map' });
  const onGround = Object.assign(document.createElement('option'), { value: 'ground', textContent: 'on the ground (HIGH detail)', disabled: true });
  modes.append(onMap, onGround); modeLabel.append(modes);
  const control: PropertyControl = { setGround(target) { ground = target; onGround.disabled = false; } };
  let lastGroundAt = -Infinity;
  let groundVisible = false;
  const updateGround = (x: number, z: number, visible: boolean) => {
    const now = performance.now();
    if (!visible || document.hidden) {
      if (groundVisible) { ground?.blank(); images.cancel(); groundVisible = false; }
      return;
    }
    groundVisible = true;
    if (now - lastGroundAt < 120) return;
    lastGroundAt = now;
    if (!guard()) return;
    const view = propertyViewBox({ x0: x - 180, z0: z - 180, x1: x + 180, z1: z + 180 }, origin);
    const request = planner.plan(view, now, -1);
    if (request) void images.load(request);
    const picture = planner.picture(view, -1);
    if (picture) ground?.show(picture.image.image, propertyWorldRect(picture.box, origin), { x, z });
    else ground?.blank();
  };
  const layout = () => {
    const space = gate.enabled ? credit.getBoundingClientRect().height + 8 : 0;
    document.documentElement.style.setProperty('--map-credit-space', `${space}px`); map.reserveCredit(space);
  };
  const status = Object.assign(document.createElement('small'), { id: 'propertyStatus', textContent: PROPERTY_UNAVAILABLE, hidden: true });
  const sync = () => {
    if (box) box.checked = gate.enabled; credit.hidden = !gate.enabled; status.hidden = !gate.failed;
    document.body.classList.toggle('propertyLinesOn', gate.enabled); layout(); map.underlay = gate.enabled && mode === 'map' ? underlay : null;
    control.update = gate.enabled && mode === 'ground' ? updateGround : undefined;
    if (!control.update) ground?.hide();
    clipping.disconnect();
    if (gate.enabled) for (const element of [credit, creditLink, document.body, document.documentElement])
      clipping.observe(element, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
  };
  const box = toggle('propertyLines', 'Property lines', false, on => {
    gate.choose(on, performance.now()); sync();
    if (!gate.enabled) { images.clear(); }
    if (gate.pending) dialog.showModal();
  });
  if (box) box.id = 'propertyLines';
  // Main can put the map in Settings. Keep new controls after its readouts so an off map never moves.
  if (box?.parentElement?.parentElement) box.parentElement.parentElement.appendChild(box.parentElement);
  box?.parentElement?.after(modeLabel, status);
  modes.addEventListener('change', () => {
    mode = modes.value === 'ground' && ground ? 'ground' : 'map'; modes.value = mode;
    images.clear(); ground?.hide(); lastGroundAt = -Infinity; sync();
  });
  const close = () => { dialog.close(); sync(); box?.focus(); };
  agree.addEventListener('click', () => { gate.agree(); close(); });
  cancel.addEventListener('click', () => { gate.choose(false); close(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); gate.choose(false); close(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const fail = () => {
    const notice = gate.fail(performance.now()); images.clear(); sync();
    if (notice) {
      const message = Object.assign(document.createElement('div'), { id: 'propertyNotice', textContent: PROPERTY_UNAVAILABLE });
      message.setAttribute('role', 'status'); document.body.append(message);
      setTimeout(() => message.remove(), 8000);
    }
  };
  let blocked = false;
  const guard = () => {
    if (!fullyVisible(credit) || !fullyVisible(creditLink)) {
      if (!blocked) { images.cancel(); map.invalidate(); ground?.hide(); } blocked = true; return false;
    }
    blocked = false; return true;
  };
  const underlay = {
    draw(g: CanvasRenderingContext2D, b: MapBounds) {
      if (!guard()) return;
      const view = propertyViewBox(b, origin);
      const request = planner.plan(view, performance.now(), b.range);
      if (request) void images.load(request);
      const picture = planner.picture(view, b.range);
      if (picture) {
        g.drawImage(picture.image.image, ...propertyWorldRect(picture.box, origin));
      }
    },
    idle() { images.cancel(); },
  };
  const clipping = new MutationObserver(() => { if (gate.enabled) guard(); });
  const creditSize = new ResizeObserver(() => { if (gate.enabled) { layout(); guard(); } });
  for (const element of [credit, creditLink, document.body, document.documentElement]) creditSize.observe(element);
  addEventListener('resize', () => { if (gate.enabled) { layout(); guard(); } });
  addEventListener('pagehide', () => { images.clear(); ground?.hide(); });
  sync();
  return control;
}
