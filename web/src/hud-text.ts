/** Plain HUD inputs; main reuses one record and keeps DOM/ride hooks outside the formatter. */
export interface HudState {
  driveHelp?: string;
  mode: 'drive' | 'fly'; mailMode: boolean; touchDevice: boolean; fps: number;
  speed: number; activeTouchSpeedLimit: number; roadName: string; surfaceName: string; airborne: boolean; help: string; jumpLine: string;
  e: number; n: number; height: number; exag: number; sunAz: number; sunEl: number;
  drawn: number; pending: number; flySpeed: number; views: number;
  done: number; stops: number; delivered: number; lawn: number; ditch: number;
  trailerReason: string | undefined; atEdge: boolean; route: boolean; showRuts: boolean; ruts: number; lawns: number;
  fleetLine?: string;
  stuntLine?:string;
  /** The drone's readout while it flies (empty for the free camera of the fixed views). */
  drone?: string;
  /** Optional help line for standalone drone mode (defaults to the car-launched drone line). */
  droneHelp?: string;
  /** A controller's help line (controls.ts padHelp), while a controller is the device used last. Desktop only. */
  padHelp?: string;
}

/** Put the cap beside speed, before the phone line's optional, ellipsized details. */
export function speedReadout(speed: number, activeTouchSpeedLimit = 0): string {
  const marker = activeTouchSpeedLimit > 0 ? ` ▸ LIMIT ${(activeTouchSpeedLimit * 3.6).toFixed(0)}` : '';
  return `${Math.abs(speed * 3.6).toFixed(0)} km/h${marker}`;
}

export function hudLine(s: HudState): string {
  let text: string;
  if (s.mode === 'drive') {
    text = `${speedReadout(s.speed, s.touchDevice && s.mailMode ? s.activeTouchSpeedLimit : 0)}   ${s.roadName}   ${s.surfaceName}${s.airborne ? '   AIR' : ''}` +
      (s.touchDevice ? `   ${s.fps.toFixed(0)} fps${s.jumpLine}`
        : s.padHelp ? `   ${s.fps.toFixed(0)} fps` + s.padHelp : s.driveHelp ?? (!s.mailMode ? `   ${s.fps.toFixed(0)} fps` + s.help : `\nWASD/arrows: drive · space: brake · M/E: mail · C: photo · Esc/P: pause · Enter: end shift\nH: horn · R: road · V: seat · F: drone · ${s.fps.toFixed(0)} fps`));
  } else if (s.drone) {
    text = s.touchDevice ? s.drone : `${s.drone}   ${s.fps.toFixed(0)} fps\n` +
      (s.droneHelp || 'WASD: fly · ←/→ or Q/E: turn · ↑/↓: camera · space: up · shift/C: down · wheel: top speed · R: fly back · F: land');
  } else {
    text = `E ${s.e.toFixed(0)}  N ${s.n.toFixed(0)}  h ${s.height.toFixed(1)} m   hills x${s.exag}\n` +
      `sun az ${s.sunAz.toFixed(0)} el ${s.sunEl.toFixed(0)}  tiles ${s.drawn}  load ${s.pending}  ${s.fps.toFixed(0)} fps\n` +
      `drag: look · WASD: fly · ${s.mailMode ? 'Q/E' : 'Q/space'}: down/up · wheel: speed ${s.flySpeed.toFixed(0)} m/s${s.views ? ` · 1-${s.views}: views` : ''} · F: drive`;
  }
  if (s.mailMode && s.mode === 'drive' && !s.touchDevice) text += `\n${s.done}/${s.stops} stops · ${s.delivered} pieces delivered · ${s.lawn + s.ditch} on ground`;
  if (s.trailerReason && s.mode === 'drive') text += `\nTrailer: ${s.trailerReason}`;
  if (s.fleetLine && s.mode === 'drive') text = s.touchDevice
    ? `${Math.abs(s.speed * 3.6).toFixed(0)} km/h · ${s.fleetLine}` : `${text}\n${s.fleetLine}`;
  if(s.stuntLine&&s.mode==='drive')text+=`\n${s.stuntLine}`;
  if (s.atEdge && s.mode === 'drive') text += !s.mailMode ? '\nThe map ends here.' : s.route ? '\nEnd of your route. Somebody else delivers past here.' : '\nEnd of this map.';
  if (s.mailMode && s.showRuts) text += `\nTyre strips: ${s.ruts} · Lawns damaged: ${s.lawns}`;
  return text;
}

// All #hud writers, including the separate preview entry points, share this per-element cache.
const lastText = new WeakMap<{ textContent: string | null }, string>();
export function setHud(hud: { textContent: string | null }, text: string): void {
  if (lastText.get(hud) === text) return;
  hud.textContent = text;
  lastText.set(hud, text);
}
