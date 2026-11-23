// A controller through the browser's Gamepad API. It feeds the same steer, throttle and handbrake values the keyboard
// and the touch pad feed (main.ts adds them up), presses the same actions, and works the menus with the d-pad and A.
// Nothing runs until the browser reports a controller: a page without one polls nothing.

import {
  BUTTON, DRIVE_ACTIONS, buttonDown, placed, probeDue, MENU_MOVES, deviceAfterUnplug, focusStep, hitRumble, homeDevice, landingRumble, latch, nextDevice,
  padActive, pickPad, pressedEdges, readDrive, repeatDue, rumbleDue, rumbleOn, unlatched, usable,
  type Device, type PadAction, type PadSnapshot, type Rumble,
} from './gamepad-rules';
import { toggle } from './settings';

export interface PadActions extends Record<PadAction, () => void> {
  /** B in a menu: close the replay, the places list or the map; resume from the pause screen or Settings. */
  back(): void;
}
export interface Felt { readonly x: number; readonly y: number; readonly z: number; readonly speed: number; readonly vy: number; readonly airborne: boolean }
export interface GamepadControls {
  /** Read by driveInput every frame, beside the keys and the touch pad. Zero while a menu is open. */
  readonly state: { steer: number; throttle: number; handbrake: boolean; pull: boolean };
  readonly device: Device;
  /** Once per animation frame, paused frames too (Start must unpause). */
  poll(now: number): void;
  /** After the vehicle moved: rumble on a hard landing or a hit. `vehicle` changes identity when the fleet switches. */
  feel(vehicle: Felt, dt: number, playing: boolean, now: number): void;
  onDevice(listener: (device: Device) => void): void;
}

/** The open menus, topmost first. The first one shown owns the d-pad. A modal dialog (the property-lines notice) sits above all. */
const MENUS = ['dialog[open]', '#replayPanel', '#endingFrame', '#title', '#placesPanel', '#bigMap', '#pauseScreen', '#settings.open', '#shiftReport'];
const FOCUSABLE = 'button, a[href], input:not([type=hidden]), select, summary, [tabindex]:not([tabindex="-1"])';
const shown = (el: Element) => !(el as HTMLElement).hidden && el.getClientRects().length > 0;

/** `driving` is false in the fly camera, behind a modal and whenever the game is not live: then only Start acts. */
export function createGamepad(actions: PadActions, touchDevice: boolean, driving: () => boolean): GamepadControls {
  const state = { steer: 0, throttle: 0, handbrake: false, pull: false };
  let device: Device = homeDevice(touchDevice);
  const listeners: Array<(device: Device) => void> = [];
  const use = (next: Device) => { if (next !== device) { device = next; for (const l of listeners) l(device); } };
  let seen = false, active: number | null = null, before: boolean[] = [], latched = new Set<number>();
  let menuWasOpen = false, rumbleSwitch: HTMLInputElement | null = null;
  let rumble = (() => { try { return rumbleOn(localStorage.getItem('mmm.rumble')); } catch { return true; } })();
  const held = new Map<number, number>();   // d-pad direction -> seconds held, for the repeat
  let lastNow = 0, lastProbe = -Infinity, lastRumble = -Infinity, lastFelt: Felt | null = null, lastX = 0, lastY = 0, lastZ = 0, lastSpeed = 0, lastVy = 0, fall = 0, wasAir = false;

  const pads = (): readonly (PadSnapshot | null)[] => { try { return navigator.getGamepads?.() ?? []; } catch { return []; } };
  const release = () => { state.steer = state.throttle = 0; state.handbrake = state.pull = false; };
  let used = false;
  /** The first real use of a usable pad: the focus style and the Settings switch appear. Until then nothing on the page changes. */
  const firstUse = () => {
    if (used) return;
    used = true;
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.padFocus{outline:3px solid #fff!important;outline-offset:2px}' }));
    rumbleSwitch = toggle('rumble', 'Controller rumble', rumble, on => { rumble = on; });
    if (rumbleSwitch) rumbleSwitch.id = 'padRumble';
  };
  addEventListener('gamepadconnected', () => { seen = true; });
  addEventListener('gamepaddisconnected', () => {
    const left = pads().filter(usable).length;
    if (active !== null && !pads().some(p => usable(p) && p.index === active)) { active = null; before = []; latched.clear(); held.clear(); release(); }
    use(deviceAfterUnplug(device, left, touchDevice));
  });
  // The last device used wins. Capture: the title card stops its keys from bubbling.
  addEventListener('keydown', () => use(nextDevice(device, { kind: 'key' })), { capture: true });
  addEventListener('pointerdown', ev => use(nextDevice(device, { kind: 'pointer', pointerType: ev.pointerType })), { capture: true });
  const stop = () => { release(); held.clear(); latched = new Set(before.map((d, i) => d ? i : -1).filter(i => i >= 0)); };
  addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

  const openMenu = (): HTMLElement | null => {
    for (const selector of MENUS) { const el = document.querySelector<HTMLElement>(selector); if (el && shown(el)) return el; }
    return null;
  };
  let marked: HTMLElement | null = null;
  const mark = (el: HTMLElement | null) => { marked?.classList.remove('padFocus'); marked = el; el?.classList.add('padFocus'); };
  const move = (menu: HTMLElement, step: 'previous' | 'next') => {
    const list = [...menu.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => shown(el) && !(el as HTMLButtonElement).disabled && !el.closest('[hidden]'));
    const next = list[focusStep(list.indexOf(document.activeElement as HTMLElement), list.length, step)];
    if (next) { next.focus(); mark(next); }
  };
  const menuPress = (menu: HTMLElement, button: number) => {
    const what = MENU_MOVES.get(button);
    if (what === 'previous' || what === 'next') move(menu, what);
    else if (what === 'choose') {
      const focused = document.activeElement instanceof HTMLElement && menu.contains(document.activeElement) ? document.activeElement : null;
      if (focused) focused.click(); else move(menu, 'next');
    } else if (what === 'back' || (what === 'start' && menu instanceof HTMLDialogElement)) {
      // A modal dialog closes as Esc closes it: its own cancel handler runs first.
      if (menu instanceof HTMLDialogElement) { if (menu.dispatchEvent(new Event('cancel', { cancelable: true }))) menu.close(); }
      else actions.back();
    } else if (what === 'start') {
      // On the title card Start starts, as the big button does; the replay it closes, as P does; elsewhere it pauses or resumes.
      if (menu.id === 'title') menu.querySelector<HTMLElement>('#titleStart')?.click(); else if (menu.id === 'replayPanel') actions.back(); else actions.pause();
    }
  };

  return {
    state,
    get device() { return device; },
    onDevice(listener) { listeners.push(listener); },
    poll(now) {
      // The browser sends gamepadconnected once, on the first press: a press while the game was still loading went
      // unheard. So until a pad is seen, look for one about once a second (one cheap call; no pad, nothing else runs).
      if (!seen) { if (!probeDue(now, lastProbe)) return; lastProbe = now; if (!pads().some(usable)) return; seen = true; }
      const dt = Math.max(0, Math.min(0.1, (now - lastNow) / 1000)); lastNow = now;
      const list = pads(), index = pickPad(list, active);
      const pad = index === null ? null : list.find(p => usable(p) && p.index === index) ?? null;
      if (!pad) { release(); before = []; return; }
      // A newly picked pad starts from nothing held, so the press that woke it (A on the title card) counts.
      if (index !== active) { active = index; before = []; }
      if (padActive(pad)) { firstUse(); use(nextDevice(device, { kind: 'pad' })); }
      const down = pad.buttons.map((_, i) => buttonDown(pad, i));
      const menu = openMenu(), drive = !menu && driving();
      if (menu) {
        release();
        for (const button of pressedEdges(before, down)) { if (button >= BUTTON.UP && button <= BUTTON.RIGHT) held.set(button, 0); menuPress(menu, button); }
        // A held d-pad repeats, as a held arrow key does: only a direction pressed in this menu, not one held into it.
        for (const button of [BUTTON.UP, BUTTON.DOWN, BUTTON.LEFT, BUTTON.RIGHT]) {
          if (!down[button]) { held.delete(button); continue; }
          const t = held.get(button);
          if (t === undefined) continue;
          held.set(button, t + dt);
          if (repeatDue(t, t + dt)) menuPress(menu, button);
        }
      } else {
        held.clear();
        const hud = document.querySelector<HTMLElement>('#interiorHud');
        const hudHasLink = !!hud && shown(hud) && !!hud.querySelector('a[href]');
        if (menuWasOpen || (!hudHasLink && marked)) mark(null);
        else if (marked && (!hud?.contains(marked) || !shown(marked))) mark(null);
        for (const button of pressedEdges(before, down)) {
          if (drive && hud && hudHasLink && !latched.has(button)) {
            const what = MENU_MOVES.get(button);
            if (what === 'previous' || what === 'next') { move(hud, what); continue; }
            if (what === 'choose' && marked && hud.contains(marked)) { marked.click(); continue; }
          }
          const action = DRIVE_ACTIONS.get(button);
          if (action && !latched.has(button) && (drive || action === 'pause')) actions[action]();
        }
        const values = unlatched(readDrive(pad), latched);
        // An idle pad (a worn stick resting past the dead zone) adds nothing while the keys or the screen are in use.
        if (drive && device === 'gamepad') Object.assign(state, values); else release();
      }
      // Held through a menu or any stretch of not driving (the drone, a fleet switch): counts again only once let go.
      latched = latch(latched, down, !drive);
      menuWasOpen = !!menu;
      before = down;
    },
    feel(vehicle, dt, playing, now) {
      if (!seen || active === null) { lastFelt = null; return; }
      const same = lastFelt === vehicle;
      // A placement (back on the road mid-fall, say) also clears the air: it lands nothing and hits nothing.
      // Height counts: back on the road from a fall straight above it moves the car down, not along.
      if (same && placed(Math.hypot(lastSpeed, lastVy), dt, Math.hypot(vehicle.x - lastX, vehicle.y - lastY, vehicle.z - lastZ))) { fall = 0; wasAir = false; }
      else if (playing && same && dt > 0) {
        if (vehicle.airborne) fall = Math.max(fall, -vehicle.vy);
        const effect = (wasAir && !vehicle.airborne ? landingRumble(fall) : null)
          ?? hitRumble(lastSpeed, vehicle.speed, dt, Math.hypot(vehicle.x - lastX, vehicle.z - lastZ));
        if (effect && rumble && device === 'gamepad' && rumbleDue(now, lastRumble)) { lastRumble = now; play(effect); }
      }
      if (!vehicle.airborne) fall = 0;
      wasAir = vehicle.airborne; lastFelt = vehicle; lastX = vehicle.x; lastY = vehicle.y; lastZ = vehicle.z; lastSpeed = vehicle.speed; lastVy = vehicle.vy;
      if (!playing) wasAir = false;
    },
  };

  function play(effect: Rumble): void {
    const pad = active === null ? null : pads().find(p => p?.index === active) as (PadSnapshot & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | null;
    try {
      void pad?.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: effect.duration, strongMagnitude: effect.strong, weakMagnitude: effect.weak })?.catch?.(() => {});
    } catch { /* a browser without rumble: nothing to feel */ }
  }
}
