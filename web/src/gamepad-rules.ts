// Controller rules: the standard layout, the stick dead zone and curve, which device was used last, which pad is
// the player's, the menu moves and when to rumble. Pure: no DOM, no navigator, so tools/gamepad-check.mjs runs it in Node.

/** Button indexes of the browser's "standard" layout (A, B, X, Y as on an Xbox pad; Cross, Circle, Square, Triangle). */
export const BUTTON = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
} as const;

/** A worn stick rests up to about a tenth off centre: inside this the car goes straight. */
export const STICK_DEAD = 0.15;
/** Past the dead zone the angle grows as x^1.6: small moves give small angles, the far end is full lock. */
export const STICK_POWER = 1.6;
/** A trigger at rest can read a few hundredths. */
export const TRIGGER_DEAD = 0.06;
/** A digital button counts from half travel (an analog face button reads 0 to 1). */
export const PRESS = 0.5;
/** A controller takes over from the keyboard or the screen only on a real move: a button, or a stick or trigger past this. */
export const WAKE = 0.4;

export interface PadButton { readonly pressed: boolean; readonly value: number }
/** What the rules read from a Gamepad: the browser's object fits this shape, and so does a test's fake. */
export interface PadSnapshot {
  readonly index: number;
  readonly mapping: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly PadButton[];
}
export interface PadDrive { steer: number; throttle: number; handbrake: boolean; pull: boolean }

const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Stick position (-1 to 1) to steering (-1 to 1): a dead zone in the middle, then a gentle curve to full lock. */
export function stickCurve(raw: number): number {
  const v = clamp(finite(raw), -1, 1), x = (Math.abs(v) - STICK_DEAD) / (1 - STICK_DEAD);
  return x <= 0 ? 0 : Math.sign(v) * Math.pow(x, STICK_POWER);
}

/** Trigger travel (0 to 1) to pedal (0 to 1), straight after a small dead zone. */
export function triggerCurve(raw: number): number {
  const x = (clamp(finite(raw), 0, 1) - TRIGGER_DEAD) / (1 - TRIGGER_DEAD);
  return x <= 0 ? 0 : x;
}

/**
 * The game reads only pads that report the standard layout, or that have the standard layout's 16 buttons and two sticks
 * (many drivers that do not say "standard" still follow its order). Anything else is left alone.
 */
export function usable(pad: PadSnapshot | null | undefined): pad is PadSnapshot {
  return !!pad && pad.connected && (pad.mapping === 'standard' || (pad.buttons.length >= 16 && pad.axes.length >= 4));
}

export function buttonValue(pad: PadSnapshot, i: number): number {
  const b = pad.buttons[i];
  return b ? Math.max(b.pressed ? 1 : 0, clamp(finite(b.value), 0, 1)) : 0;
}
export function buttonDown(pad: PadSnapshot, i: number): boolean { return buttonValue(pad, i) >= PRESS; }
/**
 * A trigger's travel. Browsers mark a trigger `pressed` from a small travel on, so `pressed` must not round it up to a
 * full pedal: the value counts. Only a trigger that reports no value at all (a digital one) reads 1 while pressed.
 */
export function triggerValue(pad: PadSnapshot, i: number): number {
  const b = pad.buttons[i], v = b ? clamp(finite(b.value), 0, 1) : 0;
  return v > 0 ? v : b?.pressed ? 1 : 0;
}

/** The analog values the keyboard and the touch pad also feed: steer, throttle (go minus brake) and the handbrake. */
export function readDrive(pad: PadSnapshot): PadDrive {
  return {
    steer: stickCurve(pad.axes[0] ?? 0),
    throttle: clamp(triggerCurve(triggerValue(pad, BUTTON.RT)) - triggerCurve(triggerValue(pad, BUTTON.LT)), -1, 1),
    handbrake: buttonDown(pad, BUTTON.A),
    // The dirt bike's PULL (wheelie). No ride has a look to the side, so the bumpers carry PULL; other rides ignore it.
    pull: buttonDown(pad, BUTTON.LB) || buttonDown(pad, BUTTON.RB),
  };
}

/**
 * A real move on the pad, as against a resting or slightly drifting one. On a pad that does not say "standard" only
 * the left stick counts among the axes: such a driver may report a trigger as an axis that rests at -1.
 */
export function padActive(pad: PadSnapshot): boolean {
  for (let i = 0; i < pad.buttons.length; i++) if (buttonValue(pad, i) >= (i === BUTTON.LT || i === BUTTON.RT ? WAKE : PRESS)) return true;
  for (let i = 0, n = Math.min(pad.mapping === 'standard' ? 4 : 2, pad.axes.length); i < n; i++) if (Math.abs(finite(pad.axes[i])) >= WAKE) return true;
  return false;
}

/**
 * The player's pad among those connected: a pad that is being used wins; otherwise the current one stays while it is
 * still there. A pad that is only connected (lying on the table) is never picked.
 */
export function pickPad(pads: readonly (PadSnapshot | null | undefined)[], current: number | null): number | null {
  let kept: number | null = null, other: number | null = null;
  for (const pad of pads) {
    if (!usable(pad)) continue;
    if (pad.index === current) { if (padActive(pad)) return current; kept = current; }
    else if (other === null && padActive(pad)) other = pad.index;
  }
  return other ?? kept;
}

/** Buttons that went down since the last poll. */
export function pressedEdges(before: readonly boolean[], now: readonly boolean[]): number[] {
  const edges: number[] = [];
  for (let i = 0; i < now.length; i++) if (now[i] && !before[i]) edges.push(i);
  return edges;
}

export type Device = 'keyboard' | 'touch' | 'gamepad';
export type DeviceEvent = { kind: 'key' } | { kind: 'pointer'; pointerType: string } | { kind: 'pad' };
/** The last device used wins. A mouse counts with the keyboard; a finger or a pen with the touch screen. */
export function nextDevice(current: Device, event: DeviceEvent): Device {
  if (event.kind === 'key') return 'keyboard';
  if (event.kind === 'pad') return 'gamepad';
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return 'touch';
  if (event.pointerType === 'mouse') return 'keyboard';
  return current;
}
/** The device a page starts with, and falls back to when the last controller is unplugged. */
export function homeDevice(touchDevice: boolean): Device { return touchDevice ? 'touch' : 'keyboard'; }
export function deviceAfterUnplug(current: Device, padsLeft: number, touchDevice: boolean): Device {
  return current === 'gamepad' && padsLeft === 0 ? homeDevice(touchDevice) : current;
}

/** Driving buttons. Each acts once per press. */
export type PadAction = 'horn' | 'mail' | 'view' | 'pause' | 'reset' | 'radio' | 'photo' | 'relief' | 'places';
export const DRIVE_ACTIONS: ReadonlyMap<number, PadAction> = new Map([
  [BUTTON.X, 'horn'], [BUTTON.Y, 'mail'], [BUTTON.B, 'view'], [BUTTON.START, 'pause'], [BUTTON.BACK, 'reset'],
  [BUTTON.UP, 'radio'], [BUTTON.DOWN, 'photo'], [BUTTON.LEFT, 'relief'], [BUTTON.RIGHT, 'places'],
]);
/** Menu buttons (the title card, the pause screen, Settings, the places list, an ending). */
export type MenuMove = 'previous' | 'next' | 'choose' | 'back' | 'start';
export const MENU_MOVES: ReadonlyMap<number, MenuMove> = new Map([
  [BUTTON.UP, 'previous'], [BUTTON.LEFT, 'previous'], [BUTTON.DOWN, 'next'], [BUTTON.RIGHT, 'next'],
  [BUTTON.A, 'choose'], [BUTTON.B, 'back'], [BUTTON.START, 'start'],
]);
/** The d-pad repeats when held, as a key does: after this delay, then at this interval (seconds). */
export const REPEAT_DELAY = 0.45, REPEAT_EVERY = 0.15;
/** True when a d-pad direction held from `before` to `now` seconds passes a repeat. */
export function repeatDue(before: number, now: number): boolean {
  const count = (t: number) => (t < REPEAT_DELAY ? -1 : Math.floor((t - REPEAT_DELAY) / REPEAT_EVERY));
  return count(now) > count(before);
}
/** The next control in a menu of `count` controls, wrapping at both ends. No focus yet: the first (or last, going back). */
export function focusStep(index: number, count: number, move: 'previous' | 'next'): number {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return move === 'next' ? 0 : count - 1;
  return (index + (move === 'next' ? 1 : count - 1)) % count;
}

/**
 * A button held down when a menu closes (A on Resume, say), or while the game was not driving, must not drive on: it
 * counts again only after it is let go. `menuOpen` is true for any poll that does not drive. Returns the latched set.
 */
export function latch(latched: ReadonlySet<number>, down: readonly boolean[], menuOpen: boolean): Set<number> {
  const next = new Set<number>();
  for (let i = 0; i < down.length; i++) if (down[i] && (menuOpen || latched.has(i))) next.add(i);
  return next;
}
/** The drive values with latched buttons and triggers left out. */
export function unlatched(drive: PadDrive, latched: ReadonlySet<number>): PadDrive {
  const go = latched.has(BUTTON.RT), stop = latched.has(BUTTON.LT);
  if (!latched.size) return drive;
  return {
    steer: drive.steer,
    throttle: go && stop ? 0 : go ? Math.min(0, drive.throttle) : stop ? Math.max(0, drive.throttle) : drive.throttle,
    handbrake: drive.handbrake && !latched.has(BUTTON.A),
    pull: drive.pull && !(latched.has(BUTTON.LB) || latched.has(BUTTON.RB)),
  };
}

export interface Rumble { duration: number; strong: number; weak: number }
/** Falls slower than this (m/s) are ordinary bumps and jumps that land well. */
export const HARD_LANDING = 6;
/** A speed loss of more than this (m/s) within one frame is a hit: no brake stops that fast. */
export const HIT_DROP = 3;
/** One frame cannot lose more than this (m/s per second) by braking, sliding or a soft verge. */
export const HIT_DECEL = 40;
/** Effects closer together than this (ms) are one effect. */
export const RUMBLE_GAP = 180;

export function landingRumble(fallSpeed: number): Rumble | null {
  const fall = finite(fallSpeed);
  if (fall < HARD_LANDING) return null;
  const k = clamp((fall - HARD_LANDING) / 10, 0.2, 1);
  return { duration: Math.round(120 + 180 * k), strong: k, weak: clamp(0.3 + 0.5 * k, 0, 1) };
}
/** A move much further than the speed allows: back on the road, a place jump, a fleet switch. Never a hit or a landing. */
export function placed(speedBefore: number, dt: number, moved: number): boolean {
  return finite(moved) > Math.abs(finite(speedBefore)) * finite(dt) * 3 + 1;
}
/**
 * A sudden speed loss between two frames. `moved` is how far the vehicle went; a jump much further than its speed
 * allows is a placement (back on the road, a place jump, another member of the fleet), never a hit.
 */
export function hitRumble(speedBefore: number, speedAfter: number, dt: number, moved: number): Rumble | null {
  const before = Math.abs(finite(speedBefore)), after = Math.abs(finite(speedAfter)), step = finite(dt);
  if (step <= 0 || step > 0.25) return null;
  if (placed(before, step, moved)) return null;
  const drop = before - after;
  if (drop < HIT_DROP || drop / step < HIT_DECEL) return null;
  const k = clamp(drop / 15, 0.3, 1);
  return { duration: Math.round(140 + 160 * k), strong: k, weak: clamp(0.4 + 0.4 * k, 0, 1) };
}
export function rumbleDue(now: number, last: number): boolean { return !(now - last < RUMBLE_GAP); }
/** While no controller event has come (a press during loading is missed), look for a pad this often (ms). */
export const PROBE_EVERY = 1000;
export function probeDue(now: number, last: number): boolean { return !(now - last < PROBE_EVERY); }
/** The Settings switch, stored as '0' or '1': on unless the player turned it off. */
export function rumbleOn(stored: string | null): boolean { return stored !== '0'; }
