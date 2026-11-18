import type { RideInput } from './ride';
/** PULL joins the existing pad and pedals. Hidden/paused controls release every held pull.
 * PULL's position and size are written inline by the phone planner (phone-controls-layout.ts) wherever it is shown. */
export type BikeControls = ((input: RideInput) => RideInput) & { reset(): void };
export function bikeControls(): BikeControls {
  document.body.classList.add('bikeMode');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
    body.bikeMode.tcOn #phoneDrive{grid-template-columns:minmax(56px,1fr) auto auto auto;gap:6px}
    body.bikeMode.tcOn #tcGo,body.bikeMode.tcOn #tcBrake{width:56px}
    #tcPull{display:none}
    #bikeJump{display:none;font:10px/1.3 ui-monospace,monospace;color:#c1ead0;max-width:100%;overflow-wrap:anywhere}
    body.bikeMode.tcOn #bikeJump{display:block}
    #bikeJump[hidden]{display:none!important}
    body.bikeMode.tcOn #tcPull{display:grid;min-height:56px;pointer-events:auto;letter-spacing:0}
  ` }));
  const keys = new Set<string>(); let held = false;
  const drive = document.getElementById('phoneDrive');
  const button = document.createElement('button'); button.id = 'tcPull'; button.type = 'button'; button.className = 'tc tcPedal'; button.textContent = 'PULL'; button.setAttribute('aria-label', 'Pull back for a wheelie');
  if (drive) {
    drive.insertBefore(button, document.getElementById('tcBrake'));
    const status = document.createElement('output'); status.id = 'bikeJump'; status.hidden = true; status.setAttribute('role', 'status');
    document.getElementById('phoneStatus')?.appendChild(status);
  }
  const clear = () => { held = false; keys.clear(); button.classList.remove('held'); };
  addEventListener('keydown', ev => { if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') { if (ev.repeat && !keys.has(ev.code)) return; keys.add(ev.code); ev.preventDefault(); } });
  addEventListener('keyup', ev => keys.delete(ev.code)); addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  button.addEventListener('pointerdown', ev => { button.setPointerCapture(ev.pointerId); held = true; button.classList.add('held'); ev.preventDefault(); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => { held = false; button.classList.remove('held'); });
  if (drive) new MutationObserver(() => { if (!document.body.classList.contains('tcOn')) clear(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Paused title/places dialogs own keyboard input. Release pull when either opens.
  new MutationObserver(() => { if (document.querySelector('#title:not([hidden]),#placesPanel:not([hidden]),#bigMap:not([hidden])')) clear(); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  return Object.assign((input: RideInput) => ({ ...input, pull: held || keys.size > 0 }), { reset: clear });
}

/** A short, light horn. A real key/tap supplies the audio gesture; no sound starts at boot. */
export function bikeHorn(): void {
  try {
    const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = 'triangle'; oscillator.frequency.value = 620;
    gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .15);
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .16);
    oscillator.onended = () => { void context.close().catch(() => {}); };
    void context.resume().catch(() => {});
  } catch { /* audio can be unavailable; animals still hear the horn */ }
}
