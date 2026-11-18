// Phone controls that can be seen: a steering pad under the left thumb, GO and BRAKE pedals under the right,
// and three small buttons. The first phone controls were invisible halves of the screen, and the owner
// could not tell what did what (10 Nov 2026).

import { createPhoneLayout } from './phone-layout';
import { thumbSteer } from './driving-help';

export interface TouchActions { reset(): void; view(): void; horn(): void }
export interface TouchControls {
  /** Read by the driving input every frame. `handbrake`: GO and BRAKE held together, since `chordAt` (performance.now() ms);
   * drift-rules.ts phoneHandbrake decides when that chord is the handbrake. */
  state: { steer: number; throttle: number; handbrake: boolean; chordAt: number };
  show(visible: boolean): void;
  release(): void;
}

const CSS = `
.tc{z-index:5;user-select:none;-webkit-user-select:none;touch-action:none;-webkit-tap-highlight-color:transparent;
  font:700 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;color:var(--ink,#eef2f6)}
.tc[hidden]{display:none}
#tcTrack{border-radius:42px;background:var(--panel,rgba(8,14,20,.72));border:2px solid rgba(238,242,246,.28)}
#tcTrack::before,#tcTrack::after{content:"";position:absolute;top:50%;width:0;height:0;border:9px solid transparent;transform:translateY(-50%);opacity:.55}
#tcTrack::before{left:16px;border-right-color:currentColor;border-left-width:0}
#tcTrack::after{right:16px;border-left-color:currentColor;border-right-width:0}
#tcKnob{position:absolute;left:50%;top:50%;border-radius:50%;background:rgba(238,242,246,.9);box-shadow:0 2px 8px rgba(0,0,0,.45);
  display:grid;place-items:center;color:#22302a;font-size:10px}
#tcSteer.held #tcKnob{background:var(--maple,#d0632e);color:#fff}
.tcPedal{display:grid;place-items:center;border-radius:14px;border:2px solid rgba(238,242,246,.3);background:var(--panel,rgba(8,14,20,.72));text-align:center;line-height:1.25}
.tcPedal.held{background:var(--maple,#d0632e);border-color:#fff}
.tcSmall{border-radius:10px;border:1px solid rgba(238,242,246,.3);background:var(--panel,rgba(8,14,20,.72));font-size:10.5px;padding:0;color:inherit}
.tcSmall:active{background:var(--maple,#d0632e)}
`;

export function createTouchControls(actions: TouchActions): TouchControls {
  const state = { steer: 0, throttle: 0, handbrake: false, chordAt: 0 };
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, id: string, cls: string, html = ''): HTMLElementTagNameMap[K] => {
    const el = document.createElement(tag);
    el.id = id; el.className = cls; el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };
  const steer = make('div', 'tcSteer', 'tc', '<div id="tcTrack"><div id="tcKnob">STEER</div></div>');
  const knob = steer.querySelector<HTMLElement>('#tcKnob')!, track = steer.querySelector<HTMLElement>('#tcTrack')!;
  const brake = make('div', 'tcBrake', 'tc tcPedal', 'BRAKE<br>REVERSE');
  const go = make('div', 'tcGo', 'tc tcPedal', 'GO');
  const reset = make('button', 'tcReset', 'tc tcSmall', 'RESET');
  const view = make('button', 'tcView', 'tc tcSmall', 'VIEW');
  const horn = make('button', 'tcHorn', 'tc tcSmall', 'HORN');
  reset.setAttribute('aria-label', 'Put the car back on the road');
  view.setAttribute('aria-label', 'Change the camera view');
  const all = [steer, brake, go, reset, view, horn];
  // END SHIFT moves into the settings panel: among the phone controls it overlapped something at most screen sizes.
  const end = document.getElementById('endShift'), panel = document.getElementById('settings');
  if (end && panel) {
    end.classList.add('inPanel');
    panel.insertBefore(end, panel.firstChild);
    end.addEventListener('click', () => panel.classList.remove('open'));
  }
  createPhoneLayout();
  document.body.classList.add('tcOn');

  // Steering: slide the thumb sideways from where it lands. Small moves give small angles; the far end is full lock.
  let steerId = -1, startX = 0;
  const range = () => Math.max(60, track.clientWidth * 0.36);
  const setSteer = (dx: number) => {
    const x = Math.max(-1, Math.min(1, dx / range()));
    state.steer = thumbSteer(dx, range());
    knob.style.transform = `translateX(${x * Math.max(0, track.clientWidth / 2 - 28)}px)`;
  };
  steer.addEventListener('pointerdown', (ev) => {
    if (steerId !== -1) return;
    steerId = ev.pointerId; startX = ev.clientX;
    steer.setPointerCapture(ev.pointerId); steer.classList.add('held');
    setSteer(0);
    ev.preventDefault();
  });
  steer.addEventListener('pointermove', (ev) => { if (ev.pointerId === steerId) setSteer(ev.clientX - startX); });
  const steerEnd = (ev: PointerEvent) => {
    if (ev.pointerId !== steerId) return;
    steerId = -1; steer.classList.remove('held'); setSteer(0);
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) steer.addEventListener(type, steerEnd);

  // Pedals: hold to use. Brake wins when both are down; both held a moment at speed are the handbrake instead (main.ts,
  // drift-rules.ts phoneHandbrake): with a turn the tail swings out; let BRAKE go, keep GO and counter-steer to hold the slide.
  const held = { go: new Set<number>(), brake: new Set<number>() };
  const pedals = () => {
    const both = held.brake.size > 0 && held.go.size > 0;
    if (both && !state.handbrake) state.chordAt = performance.now();
    state.throttle = held.brake.size ? -1 : held.go.size ? 1 : 0; state.handbrake = both;
  };
  const pedal = (el: HTMLElement, key: 'go' | 'brake') => {
    el.addEventListener('pointerdown', (ev) => { el.setPointerCapture(ev.pointerId); held[key].add(ev.pointerId); el.classList.add('held'); pedals(); ev.preventDefault(); });
    const up = (ev: PointerEvent) => { held[key].delete(ev.pointerId); el.classList.toggle('held', held[key].size > 0); pedals(); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(type, up);
  };
  pedal(go, 'go');
  pedal(brake, 'brake');

  reset.addEventListener('click', () => actions.reset());
  view.addEventListener('click', () => actions.view());
  horn.addEventListener('click', () => actions.horn());
  // Nothing may stay held when no finger can be holding it. A browser that drops a release event (seen as a
  // stuck pedal) is healed by the next lift: with no touch left on the screen, every pedal and the pad let go.
  const releaseAll = () => { held.go.clear(); held.brake.clear(); go.classList.remove('held'); brake.classList.remove('held'); pedals(); steerId = -1; steer.classList.remove('held'); setSteer(0); };
  addEventListener('blur', releaseAll);
  addEventListener('pagehide', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  for (const type of ['touchend', 'touchcancel'] as const) addEventListener(type, (ev) => { if (ev.touches.length === 0) releaseAll(); }, { passive: true });

  let shown = true;
  return {
    state, release: releaseAll,
    show(visible: boolean) {
      if (visible === shown) return;
      shown = visible;
      for (const el of all) el.hidden = !visible;
      document.body.classList.toggle('tcOn', visible);
      document.getElementById('phoneHud')!.style.display = visible ? '' : 'contents';
      if (!visible) releaseAll();
    },
  };
}
