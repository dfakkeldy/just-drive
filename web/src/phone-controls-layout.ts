/** One planner owns control rectangles in both orientations, including safe areas and short toolbars. */
export interface ControlRect { left: number; top: number; width: number; height: number }
export interface PhoneControlView { width: number; height: number; left: number; right: number; bottom: number; top?: number; hintHeight?: number; statusHeight?: number; mail: boolean; pull: boolean }
const IDS = ['tcSteer', 'tcBrake', 'tcGo', 'tcPull', 'tcReset', 'tcView', 'tcHorn', 'cameraButton', 'mailButton', 'droneButton'] as const;
export function portraitControls(v: PhoneControlView): Record<string, ControlRect> {
  const result: Record<string, ControlRect> = {}, gap = 6, left = v.left + 8, right = v.width - v.right - 8;
  const bottom = v.height - v.bottom - 8, action = v.mail ? 72 : 56;
  const available = .28 * v.height - v.bottom - 8 - gap - action;
  const edges = available < 56 || right - left < (v.mail ? 328 : 180);
  const pedal = edges ? 56 : Math.min(100, available), pedalWidth = v.pull ? 56 : 76, pedalGap = v.pull ? 6 : 8;
  const put = (id: string, x: number, y: number, w: number, h: number) => { result[id] = { left: x, top: y, width: w, height: h }; };
  put('tcGo', right - pedalWidth, bottom - pedal, pedalWidth, pedal);
  put('tcBrake', right - 2 * pedalWidth - pedalGap, bottom - Math.min(84, pedal), pedalWidth, Math.min(84, pedal));
  let pedalsLeft = result.tcBrake.left;
  if (v.pull) { pedalsLeft -= pedalWidth + pedalGap; put('tcPull', pedalsLeft, bottom - Math.min(84, pedal), pedalWidth, Math.min(84, pedal)); }
  put('tcSteer', left, bottom - Math.min(84, pedal), Math.min(280, pedalsLeft - pedalGap - left), Math.min(84, pedal));
  let rowBottom = bottom - pedal - gap;
  if (edges && v.mail && .25 * v.width - v.right - 8 < 64) {
    // Fold-width portrait screens need the action row below the band; utilities fit the left edge.
    put('mailButton', right - 64, rowBottom - 64, 64, 64);
    put('cameraButton', right - 134, rowBottom - 64, 64, 64);
    for (const id of ['tcHorn', 'tcView', 'tcReset']) { put(id, left, rowBottom - 56, 56, 56); rowBottom -= 62; }
  } else if (edges) {
    // A very short safe-area viewport cannot fit two full rows. Keep a right-edge stack outside the band.
    if (v.mail) {
      put('mailButton', right - 64, rowBottom - 64, 64, 64); rowBottom -= 70;
      put('cameraButton', right - 64, rowBottom - 64, 64, 64); rowBottom -= 70;
    }
    for (const id of ['tcHorn', 'tcView', 'tcReset']) { put(id, right - 56, rowBottom - 56, 56, 56); rowBottom -= 62; }
  } else {
    if (v.mail) { put('mailButton', right - 72, rowBottom - 72, 72, 72); put('cameraButton', right - 142, rowBottom - 64, 64, 64); }
    for (const [i, id] of ['tcReset', 'tcView', 'tcHorn'].entries()) put(id, left + i * 62, rowBottom - 56, 56, 56);
  }
  return result;
}

export function phoneReadoutsInSettings(v: PhoneControlView): boolean {
  const landscape = v.width > v.height;
  const stripWidth = Math.min(190, .22 * v.width, .25 * v.width - 12 - v.left);
  if (stripWidth < (landscape ? 118 : 56)) return true;
  const hint = landscape ? Math.max(14, v.hintHeight ?? 14) : v.hintHeight ?? 36;
  const start = (v.top ?? 6) + Math.max(56, v.statusHeight ?? 56) + 6 + hint + 6;
  // Worst case: open map, all active chips, and a full photo note. Never rely on clipping a control.
  const height = landscape ? 174 : v.mail ? v.height <= 700 ? 289 : 315 : 206;
  const left = v.left + 8, end = left + stripWidth;
  const stops = Object.entries(phoneControls(v)).filter(([id, r]) =>
    !(landscape && ['tcReset', 'tcView', 'tcHorn'].includes(id)) && r.left < end && r.left + r.width > left).map(([, r]) => r.top);
  return start + height + 6 > Math.min(...stops);
}

export function landscapeControls(v: PhoneControlView): Record<string, ControlRect> {
  const result: Record<string, ControlRect> = {}, left = v.left + 8, right = v.width - v.right - 8;
  const top = v.top ?? Math.min(6, Math.max(0, .22 * v.height - 56));
  const strip = .22 * v.height - v.bottom, sideDrive = strip < 56;
  const bottomGap = Math.min(8, Math.max(0, strip - 56)), bottom = v.height - v.bottom - bottomGap;
  const pedal = sideDrive ? 56 : Math.min(72, strip - bottomGap), gap = v.pull ? 6 : 8;
  const rightSpace = right - .75 * v.width, leftSpace = .25 * v.width - left - 4;
  const width = sideDrive ? Math.min(v.pull ? 56 : 76, rightSpace) : v.pull ? 56 : 76;
  const put = (id: string, x: number, y: number, w: number, h: number) => { result[id] = { left: x, top: y, width: w, height: h }; };
  put('tcGo', right - width, bottom - pedal, width, pedal);
  if (sideDrive) {
    put('tcSteer', left, bottom - 56, Math.max(56, leftSpace), 56);
    put('tcBrake', left, bottom - 118, Math.min(76, leftSpace), 56);
    if (v.pull) put('tcPull', left, bottom - 180, 56, 56);
  } else {
    put('tcBrake', right - 2 * width - gap, bottom - pedal, width, pedal);
    let driveLeft = result.tcBrake.left;
    if (v.pull) { driveLeft -= width + gap; put('tcPull', driveLeft, bottom - pedal, width, pedal); }
    put('tcSteer', left, bottom - pedal, Math.min(.22 * v.width, driveLeft - gap - left), pedal);
  }
  if (v.mail) {
    const stacked = sideDrive || rightSpace < 142;
    const mailSize = Math.min(72, Math.max(64, rightSpace)), rowBottom = bottom - pedal - 6;
    if (stacked) {
      const size = sideDrive ? 64 : mailSize;
      // Leave a clear top row even at the 265 px landscape floor.
      const actionGap = sideDrive ? Math.max(0, Math.min(6, (bottom - top - 56 - 184 - 1) / 2)) : 6;
      const mailBottom = sideDrive ? bottom - pedal - actionGap : rowBottom;
      put('mailButton', right - size, mailBottom - size, size, size);
      put('cameraButton', right - 64, mailBottom - size - actionGap - 64, 64, 64);
    } else {
      put('mailButton', right - 72, rowBottom - 72, 72, 72);
      put('cameraButton', right - 142, rowBottom - 64, 64, 64);
    }
  }
  for (const [i, id] of ['tcReset', 'tcView', 'tcHorn'].entries()) put(id, right - 180 + i * 62, top, 56, 56);
  return result;
}

export function phoneControls(v: PhoneControlView): Record<string, ControlRect> {
  const landscape = v.width > v.height, result = landscape ? landscapeControls(v) : portraitControls(v), gap = 6;
  // The top row is the status line's. The camera drone sits just under the row's right end, over the road, wherever
  // that spot is clear of every other control. Only where a short screen's right-edge stack reaches it does DRONE stay
  // in the top row (its place in the page's flow) beside the gear.
  const right = v.width - v.right - 8, top = landscape ? result.tcReset.top : v.top ?? 6;
  const drone = { left: right - 56, top: top + 62, width: 56, height: 56 }, e = 0.01;   // e: rounding (5.6 + 56 vs 67.6 - 6)
  if (Object.values(result).every(r => r.left >= drone.left + drone.width + gap - e || r.left + r.width <= drone.left - gap + e
    || r.top >= drone.top + drone.height + gap - e || r.top + r.height <= drone.top - gap + e)) result.droneButton = drone;
  return result;
}

export function movePhoneReadouts(menu: boolean, readouts: HTMLElement, home: HTMLElement, panel: HTMLElement): void {
  const parent = menu ? panel : home;
  panel.hidden = !menu;
  if (readouts.parentElement !== parent) parent.appendChild(readouts);
}

/** The Node check runs this same writer and inspects the applied inline rectangles. */
export function placePhoneControls(layout: Record<string, ControlRect> | null, find: (id: string) => HTMLElement | null): void {
  for (const id of IDS) {
    const element = find(id); if (!element) continue;
    const box = layout?.[id];
    if (box) Object.assign(element.style, { position: 'absolute', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    else for (const name of ['position', 'left', 'top', 'width', 'height']) element.style.removeProperty(name);
  }
}

export function installPhoneControls(root: HTMLElement): void {
  let key = '', modeKey = '';
  const readouts = document.getElementById('phoneReadouts'), home = readouts?.parentElement ?? null;
  const settings = document.getElementById('settings'), hintHome = document.getElementById('phoneHint');
  const panel = settings ? document.createElement('section') : null;
  if (panel && settings) {
    panel.id = 'phoneReadoutsPanel'; panel.hidden = true;
    const heading = document.createElement('p'); heading.textContent = 'Map and radio'; panel.appendChild(heading);
    const before = document.getElementById('startOver');
    settings.insertBefore(panel, before?.parentElement === settings ? before : null);
  }
  const layout = () => {
    const on = document.body.classList.contains('tcOn');
    const pull = !!document.getElementById('tcPull'), mail = !document.body.classList.contains('exploreMode');
    const style = getComputedStyle(root);
    const view = { width: innerWidth, height: innerHeight, left: Math.max(0, (parseFloat(style.paddingLeft) || 8) - 8),
      right: Math.max(0, (parseFloat(style.paddingRight) || 8) - 8), bottom: Math.max(0, (parseFloat(style.paddingBottom) || 8) - 8), top: parseFloat(style.paddingTop) || 0, hintHeight: hintHome?.getBoundingClientRect().height ?? 0, statusHeight: document.getElementById('phoneTop')?.getBoundingClientRect().height ?? 56, mail, pull };
    const next = JSON.stringify([on, view]); if (next === key) return; key = next;
    const menu = on && !!panel && !!readouts && !!home && phoneReadoutsInSettings(view);
    if (readouts && home && panel) movePhoneReadouts(menu, readouts, home, panel);
    document.body.classList.toggle('phoneReadoutsMenu', menu);
    const hint = document.getElementById('stopHint');
    const hintParent = menu && view.width > view.height ? panel : hintHome;
    if (hint && hintParent && hint.parentElement !== hintParent) hintParent.appendChild(hint);
    placePhoneControls(on ? phoneControls(view) : null, id => document.getElementById(id));
  };
  // Body mode changes include pause/resume and the bike controls arriving after the grid.
  const modes = new MutationObserver(() => {
    const next = [document.body.classList.contains('tcOn'), document.body.classList.contains('homeScreen'),
      document.body.classList.contains('exploreMode'), !!document.getElementById('tcPull')].join(':');
    if (next !== modeKey) { modeKey = next; layout(); }
  });
  modes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const drive = document.getElementById('phoneDrive');
  if (drive) modes.observe(drive, { childList: true });
  new MutationObserver(layout).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  const resize = new ResizeObserver(layout);
  resize.observe(root); const top = document.getElementById('phoneTop'); if (top) resize.observe(top); if (hintHome) resize.observe(hintHome);
  addEventListener('resize', layout); window.visualViewport?.addEventListener('resize', layout);
  layout();
}
