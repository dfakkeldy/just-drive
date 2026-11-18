import type { Mail } from './mail';
import type { DriveSession } from './explore';
import type { Vehicle } from './vehicle';
import { toggle } from './settings';
import { setHud, speedReadout } from './hud-text';
import { clock, CLOCK_FACTOR } from './shift-rules';

/** Settings work for every input; the compact dashboard exists only on touch mail runs. */
export class PhoneMailHud {
  private readonly button = document.getElementById('mailButton');
  private line: HTMLElement | null = null;
  private elapsed = 0;
  private lastElapsed = 0;
  private day = -1;
  private dismissed = false;
  constructor(private readonly mail: Mail, private readonly phone: boolean, bare: boolean) {
    try { mail.throwHelp = localStorage.getItem('mmm.throwHelp') !== '0'; } catch { /* default on */ }
    if (!bare) toggle('throwHelp', 'Throw help', mail.throwHelp, on => { mail.throwHelp = on; });
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
      #mailButton.throwNow{box-shadow:0 0 0 5px #ffdf70,0 0 22px #ffdf7099;border-color:#fff4b7}
    ` }));
    if (!phone) return;
    document.body.classList.add('mailPhone');
    for (const id of ['cameraButton', 'gear']) document.getElementById(id)?.addEventListener('click', () => {
      this.dismissed = true; document.body.classList.add('introDone');
    });
  }
  update(shift: DriveSession, v: Vehicle, driving: boolean): void {
    this.button?.classList.toggle('throwNow', driving && this.mail.throwHelp && this.mail.cue);
    if (!this.phone) return;
    if (!this.line) {
      const status = document.getElementById('phoneStatus');
      if (!status) return;
      this.line = Object.assign(document.createElement('div'), { id: 'phoneLine' });
      status.appendChild(this.line);
    }
    if (this.day !== shift.career.day || shift.elapsed < this.lastElapsed) {
      this.day = shift.career.day; this.elapsed = 0; this.dismissed = false;
    }
    this.elapsed += Math.max(0, shift.elapsed - this.lastElapsed) / CLOCK_FACTOR;
    this.lastElapsed = shift.elapsed;
    document.body.classList.toggle('introDone', this.dismissed || this.elapsed >= 20);
    const text = `${speedReadout(v.speed, driving ? v.activeTouchSpeedLimit : 0)} · D${shift.career.day} ${shift.done}/${shift.stops} · ${clock(shift.elapsed)} · ${v.roadName ?? 'off road'}`;
    setHud(this.line, text);
    this.line.title = `${shift.run.short} · Day ${shift.career.day} · ${shift.done}/${shift.stops} stops`;
  }
}
