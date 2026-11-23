import type { Roads } from './roads';
import type { Device } from './gamepad-rules';
import {
  MOUNTAIN_HINT_TEXT,
  MountainApproach,
  MountainHintState,
  mountainSwitchLabel,
} from './mountain-hint-rules';

export {
  DEFAULT_SXS_ID,
  MOUNTAIN_HINT_TEXT,
  checkSwapRoom,
  defaultSideBySideId,
  isMountainHintEligibleRide,
  isSideBySideId,
  safeSwapRide,
} from './mountain-hint-rules';

export type MountainSwitchOutcome = boolean | { ok: boolean; pending?: boolean; reason?: string };

const CSS = `
#mountainRideHint{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:6;
  width:min(440px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px;
  background:var(--panel-solid);border:1px solid #a7d9bc;border-left:3px solid #a7d9bc;border-radius:8px;
  color:var(--ink);font:13px/1.45 var(--text);box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:auto}
#mountainRideHint[hidden]{display:none!important}
#mountainRideHint .mountainHintText{margin:0 0 10px;color:var(--ink);font-weight:600}
#mountainRideHint .mountainHintNote{margin:0 0 8px;color:#ffd9bd;font:12px/1.35 var(--mono)}
#mountainRideHint .mountainHintNote[hidden]{display:none}
#mountainRideHint .mountainHintActions{display:flex;gap:8px;align-items:center}
#mountainRideHint button{min-height:44px;border-radius:6px;font:700 12px/1.2 var(--mono);cursor:pointer;
  touch-action:manipulation;pointer-events:auto;box-sizing:border-box}
#mountainRideHint .mountainHintSwitch{flex:1;min-width:0;padding:8px 10px;border:1px solid #a7d9bc;background:#20362e;color:#eef2f6}
#mountainRideHint .mountainHintDismiss{flex:none;padding:8px 10px;border:1px solid var(--line);background:transparent;color:var(--ink-dim)}
#mountainRideHint button:focus-visible{outline:3px solid #fff;outline-offset:2px}
body:has(#settings.open) #mountainRideHint,body:has(#pauseScreen:not([hidden])) #mountainRideHint,
body:has(#bigMap:not([hidden])) #mountainRideHint,body:has(#placesPanel:not([hidden])) #mountainRideHint,
body.indoorOn #mountainRideHint,body.replaying #mountainRideHint{display:none!important}
body:not(.tcOn):has(#fleetPrompt:not([hidden])) #mountainRideHint{bottom:108px}
body.tcOn #mountainRideHint{position:static;transform:none;width:100%;max-width:100%;margin:0;padding:8px 10px;font-size:12px;line-height:1.35}
body.tcOn #phoneHint:has(#mountainRideHint:not([hidden])){display:flex;flex-direction:column;align-items:stretch;gap:6px}
body.tcOn #mountainRideHint .mountainHintText{margin:0 0 6px}
body.tcOn #mountainRideHint .mountainHintNote{margin:0 0 6px;font-size:11px}
body.tcOn #mountainRideHint button{min-height:44px;padding:6px 8px;font-size:11px}
body.tcOn #phoneHint:has(#mountainRideHint:not([hidden])) #placeArrival{display:none}
/* Keep the right-edge 56 px column (+ 8 px gap) clear for Drone and Save picture in both orientations. */
body.tcOn.compactPhone #phoneHud #phoneHint:has(#mountainRideHint:not([hidden])){overflow:visible;width:min(360px,calc(100% - 64px))}
@media(orientation:landscape){
  body.tcOn #phoneHint:has(#mountainRideHint:not([hidden])){display:flex;flex-direction:column;align-items:stretch;gap:6px}
  body.tcOn #mountainRideHint{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:6px 8px}
  body.tcOn #mountainRideHint .mountainHintText{margin:0;flex:1 1 160px;min-width:0}
  body.tcOn #mountainRideHint .mountainHintNote{margin:0;flex:1 0 100%}
  body.tcOn #mountainRideHint .mountainHintActions{flex:1 1 100%;min-width:0;max-width:100%}
  body.tcOn #mountainRideHint .mountainHintSwitch{flex:1 1 0;min-width:0;overflow-wrap:anywhere}
  /* Center lane between the planner's left controls (#tcSteer/#tcBrake) and right controls (#tcGo/#savePictureButton). */
  body.tcOn.compactPhone #phoneHud #phoneHint:has(#mountainRideHint:not([hidden])){margin-left:var(--phone-lane-left,84px);width:min(520px,calc(100% - var(--phone-lane-left,84px) - var(--phone-lane-right,84px)))}
  body.tcOn.compactPhone:has(#mountainRideHint:not([hidden])) #phoneHud{grid-template-rows:56px auto minmax(0,1fr) 72px var(--mail-pedal-height)}
}
@media(orientation:landscape) and (max-height:319px){
  body.tcOn.compactPhone:has(#mountainRideHint:not([hidden])) #phoneHud{grid-template-rows:56px auto minmax(0,1fr) 64px 60px}
}
`;

export interface MountainHintVehicle {
  x: number;
  z: number;
  heading: number;
  speed: number;
  airborne: boolean;
  sunk: number;
}

/**
 * One-time hint at the foot of River Denys Mountain Road (and the rough mountain climb on River Denys Road)
 * offering a one-tap / one-key / one-button switch to the side-by-side.
 */
export class MountainHint {
  readonly approach: MountainApproach;
  readonly state = new MountainHintState();
  readonly panel = document.createElement('aside');
  private readonly note = document.createElement('p');
  private readonly switchButton = document.createElement('button');
  private readonly dismissButton = document.createElement('button');
  private lastLabel = '';
  private canAccept = false;
  private pending = false;
  private pendingGen = 0;

  constructor(
    roads: Pick<Roads, 'roads' | 'nearest'>,
    village: readonly [number, number],
    private readonly onSwitch: (onSettled?: (ok: boolean, reason?: string) => void) => MountainSwitchOutcome,
  ) {
    this.approach = new MountainApproach(roads, village);
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.panel.id = 'mountainRideHint';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'status');
    this.panel.setAttribute('aria-live', 'polite');

    const text = document.createElement('p');
    text.className = 'mountainHintText';
    text.textContent = MOUNTAIN_HINT_TEXT;

    this.note.className = 'mountainHintNote';
    this.note.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'mountainHintActions';

    this.switchButton.id = 'mountainSwitchButton';
    this.switchButton.className = 'mountainHintSwitch';
    this.switchButton.type = 'button';
    this.switchButton.textContent = mountainSwitchLabel('touch');
    this.switchButton.addEventListener('click', () => {
      this.accept();
      this.switchButton.blur();
    });

    this.dismissButton.id = 'mountainDismissButton';
    this.dismissButton.className = 'mountainHintDismiss';
    this.dismissButton.type = 'button';
    this.dismissButton.textContent = 'Not now';
    this.dismissButton.setAttribute('aria-label', 'Keep current ride');
    this.dismissButton.addEventListener('click', () => {
      this.clearActive();
      this.dismissButton.blur();
    });

    actions.append(this.switchButton, this.dismissButton);
    this.panel.append(text, this.note, actions);
    for (const name of ['pointerdown', 'pointerup', 'pointermove', 'dblclick']) {
      this.panel.addEventListener(name, ev => {
        ev.stopPropagation();
        if (name === 'dblclick') ev.preventDefault();
      });
    }
    this.attach();
  }

  private attach(): void {
    const host = document.getElementById('phoneHint') ?? document.body;
    if (this.panel.parentElement !== host) host.appendChild(this.panel);
  }

  get visible(): boolean { return this.state.visible && !this.panel.hidden; }

  /** Hide any active hint (e.g. on a place jump or manual dismiss) while keeping once-per-visit state. */
  clearActive(): void {
    this.pending = false;
    this.pendingGen++;
    this.state.dismiss();
    this.note.hidden = true;
    this.note.textContent = '';
    this.panel.hidden = true;
  }

  private finishPending(gen: number, ok: boolean, reason?: string): void {
    if (gen !== this.pendingGen) return;
    this.pending = false;
    if (ok) {
      this.state.completeSwitch();
      this.note.hidden = true;
      this.note.textContent = '';
      this.panel.hidden = true;
      return;
    }
    if (reason) {
      this.state.visible = true;
      this.state.remaining = Math.max(this.state.remaining, 4);
      this.note.textContent = reason;
      this.note.hidden = false;
      this.panel.hidden = false;
      return;
    }
    this.clearActive();
  }

  /** One-tap / one-key / one-button switch. Never throws; shows inline feedback if the switch cannot run yet. */
  accept(): boolean {
    if (!this.state.visible || !this.canAccept || this.pending) return false;
    const gen = ++this.pendingGen;
    let outcome: MountainSwitchOutcome;
    try {
      outcome = this.onSwitch((ok, reason) => this.finishPending(gen, ok, reason));
    } catch {
      outcome = { ok: false, reason: 'Could not switch right now' };
    }
    const ok = typeof outcome === 'boolean' ? outcome : outcome.ok;
    const pending = typeof outcome === 'object' && !!outcome.pending;
    if (ok && pending) {
      this.pending = true;
      this.note.hidden = true;
      this.note.textContent = '';
      this.panel.hidden = true;
      return true;
    }
    if (ok) {
      this.pending = false;
      this.state.completeSwitch();
      this.note.hidden = true;
      this.note.textContent = '';
      this.panel.hidden = true;
      return true;
    }
    const reason = typeof outcome === 'object' && outcome.reason ? outcome.reason : 'Could not switch right now';
    this.note.textContent = reason;
    this.note.hidden = false;
    this.state.remaining = Math.max(this.state.remaining, 4);
    return false;
  }

  update(dt: number, vehicle: MountainHintVehicle, rideKind: string, active: boolean, device: Device): void {
    this.attach();
    this.canAccept = active;
    const outsideChurch = this.approach.outsideChurchClearance(vehicle);
    const onApproach = active && !this.state.shown && !this.state.visible
      ? this.approach.isDrivingTowardChurch(vehicle)
      : false;
    const visible = this.state.update(dt, {
      active,
      rideKind,
      onApproach,
      airborne: vehicle.airborne,
      sunk: vehicle.sunk > 0,
      outsideChurch,
    });
    const show = visible && active && !this.pending;
    if (!visible) {
      this.note.hidden = true;
      this.note.textContent = '';
    }
    if (this.panel.hidden !== !show) this.panel.hidden = !show;
    if (!show) return;
    const label = mountainSwitchLabel(device);
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.switchButton.textContent = label;
    }
  }
}
