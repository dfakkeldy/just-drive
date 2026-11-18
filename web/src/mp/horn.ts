// A short two-tone horn. The audio context is made only by a page gesture, and belongs to this connection.
import { FLAG, type PeerView } from './wire';

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export class Horns {
  count = 0; // accepted nearby horn calls; inspected by the dev check, not proof that a person heard sound
  private ctx: AudioContext | null = null;
  private unlocked = false;
  private readonly peers = new Map<number, { on: boolean; last: number }>();
  private readonly unlock = () => {
    this.unlocked = true;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx && Ctx) this.ctx = new Ctx();
      void this.ctx?.resume().catch(() => {});
    } catch { /* audio unavailable */ }
  };
  constructor() {
    // The start button can precede the dynamic import. Browser activation remembers that gesture.
    if (navigator.userActivation?.hasBeenActive) this.unlock();
    // A phone counts a touch as a gesture when the finger lifts, so the lift is listened for too (as the radio does).
    for (const type of GESTURES) addEventListener(type, this.unlock, { capture: true });
  }
  update(views: readonly PeerView[], x: number, z: number, now: number): void {
    for (const v of views) {
      let seen = this.peers.get(v.id);
      if (!seen) { seen = { on: false, last: -Infinity }; this.peers.set(v.id, seen); }
      const on = !!(v.flags & FLAG.horn), distance = Math.hypot(v.x - x, v.z - z);
      if (on && !seen.on && now - seen.last >= 600 && distance < 150 && this.unlocked) {
        seen.last = now; this.play(distance);
      }
      seen.on = on;
    }
    for (const id of this.peers.keys()) if (!views.some(v => v.id === id)) this.peers.delete(id);
  }
  private play(distance: number): void {
    this.count++;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const at = ctx.currentTime, gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(.065 * (1 - distance / 150), at + .025);
      gain.gain.setValueAtTime(.045 * (1 - distance / 150), at + .24);
      gain.gain.linearRampToValueAtTime(0, at + .35); gain.connect(ctx.destination);
      let left = 2;
      for (const hz of [392, 494]) {
        const tone = ctx.createOscillator(); tone.type = 'triangle'; tone.frequency.value = hz; tone.connect(gain);
        tone.onended = () => { tone.disconnect(); if (--left === 0) gain.disconnect(); };
        tone.start(at); tone.stop(at + .36);
      }
    } catch { /* a device can lose audio at any time */ }
  }
  dispose(): void {
    for (const type of GESTURES) removeEventListener(type, this.unlock, { capture: true });
    this.peers.clear(); void this.ctx?.close().catch(() => {}); this.ctx = null;
  }
}
