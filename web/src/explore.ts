import * as THREE from 'three';
import { Damage } from './damage-rules';
import { Evidence } from './evidence';
import type { Shift } from './shift';
import type { Mail } from './mail';
import type { Props } from './props';
import type { Interiors } from './interiors';
import type { Relief } from './relief';
import type { Endings } from './ending';
import type { YardJob } from './yard-job';
import type { RoadNetwork } from './places';
import { villageStart } from './places';

const noop = () => {};
/** Mabou starts on its main road. An area without that road starts where the engine puts every such area. */
const mainRoadStart = (roads: RoadNetwork, origin: readonly [number, number]) => { try { return villageStart(roads, origin); } catch { return null; } };
/** Only the loop's session surface. No career storage, daily draw, report, paper or clock. */
export type DriveSession = Pick<Shift, 'damage' | 'evidence' | 'group' | 'elapsed' | 'ended' | 'done' | 'stops' | 'phone' |
  'run' | 'remaining' | 'today' | 'career' | 'update' | 'updateIndoors' | 'takePhoto' | 'end' |
  'endsAtSix' | 'startOver' | 'interiorResult' | 'seenAtRoadside'> & {
    complaints: Pick<Shift['complaints'], 'all'>; ruts: Pick<Shift['ruts'], 'count' | 'lawns'>;
  };
class NoDamage extends Damage {
  override hit(): void {}
  override drive(): void {}
  override seed(): void {}
}
export class FreeDrive implements DriveSession {
  readonly damage = new NoDamage();
  readonly evidence = new Evidence();
  readonly group = new THREE.Group();
  readonly elapsed = 0;
  readonly ended = false;
  readonly endsAtSix = false;
  readonly done = 0;
  readonly stops = 0;
  phone = false;
  readonly remaining = [];
  readonly today = { pieces: [], stuffed: [], down: [], flags: [] };
  readonly career = { day: 0, pay: 0, warnings: 0, double: false, suspended: false, carryover: [] };
  readonly complaints = { all: [] };
  readonly ruts = { count: 0, lawns: 0 };
  readonly run;
  constructor(roads: RoadNetwork, origin: readonly [number, number]) {
    this.run = { name: '', short: '', rural: [], sites: [], stops: [], start: mainRoadStart(roads, origin) };
  }
  update: DriveSession['update'] = noop;
  updateIndoors: DriveSession['updateIndoors'] = () => false;
  takePhoto: DriveSession['takePhoto'] = () => false;
  end = noop;
  startOver = noop;
  interiorResult: DriveSession['interiorResult'] = noop;
  seenAtRoadside: DriveSession['seenAtRoadside'] = noop;
}

/** Roadside posts remain physical scenery. This is Mail's existing contact call, without its paper or scoring. */
export class SceneryContact {
  readonly group = new THREE.Group();
  readonly tally = '';
  readonly delivered = 0;
  readonly lawn = 0;
  readonly ditch = 0;
  private oldX = NaN;
  private oldZ = NaN;
  constructor(private props: Props | null) {}
  update: Mail['update'] = (_dt, vehicle) => {
    const factor = this.props?.hitCar(vehicle.x, vehicle.z, vehicle.heading, vehicle.vx, vehicle.vz,
      Number.isFinite(this.oldX) ? this.oldX : vehicle.x, Number.isFinite(this.oldZ) ? this.oldZ : vehicle.z, vehicle.spec) ?? 1;
    this.oldX = vehicle.x; this.oldZ = vehicle.z;
    return factor;
  };
  reset(): void { this.oldX = this.oldZ = NaN; }
}

export type DriveInteriors = Pick<Interiors, 'busy' | 'doors' | 'reset' | 'register' | 'enter' | 'leave' | 'closeForDay' | 'update' | 'render'>;
export const quietInteriors = (): DriveInteriors => ({ busy: false, doors: new Map(), reset: noop, register: noop, enter: noop, leave: noop, closeForDay: noop, update: noop, render: noop });
export const quietRelief = (): Pick<Relief, 'busy' | 'level' | 'breaks' | 'reset' | 'request' | 'update'> => ({ busy: false, level: 0, breaks: 0, reset: noop, request: noop, update: noop });
export const quietEndings = (): Pick<Endings, 'busy' | 'update'> => ({ busy: false, update: noop });
export const quietYardJob = (): { step: YardJob['step']; reset: YardJob['reset']; judge: Pick<YardJob['judge'], 'cancel'> } => ({ step: noop, reset: noop, judge: { cancel: noop } });

export const exploreHelp = '\nWASD/arrows: drive · space: brake · H: horn · T: radio\nR: road · V: seat · F: drone · L: places · O: save picture';
export const exploreKey = (code: string): boolean => ['KeyM', 'KeyE', 'KeyC', 'KeyB', 'KeyG', 'Enter'].includes(code);
export function prepareExplore(): void {
  document.body.classList.add('exploreMode');
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: `
    body.exploreMode :is(#shiftHud,#stopHint,#cameraButton,#endShift,#mailButton,#mailScore,#shiftReport,#photoTag,#photoFlash,#startOver){display:none!important}
    #savePictureButton{position:fixed;z-index:6;top:calc(72px + env(safe-area-inset-top,0px));right:calc(8px + env(safe-area-inset-right,0px));
      flex:none;width:56px;height:56px;border-radius:10px;border:1px solid var(--ink-dim);background:var(--panel-solid);
      color:var(--ink);font:700 11px/1.2 var(--mono);padding:0;pointer-events:auto}
    body.tcOn #savePictureButton{right:auto}
    /* Place Save picture beside the flight stick on short landscape screens, clear of its caption. */
    @media(orientation:landscape) and (min-width:421px) and (max-height:319px){
      body.droneOn #savePictureButton{right:calc(22px + var(--drone-stick-size) + env(safe-area-inset-right,0px))}
    }
    #savePictureButton:active{background:var(--maple)}
    #savePictureButton[hidden],body:not(.tcOn,.droneOn) #savePictureButton{display:none}
    #savePictureStatus{position:fixed;z-index:7;left:50%;top:calc(72px + env(safe-area-inset-top,0px));transform:translateX(-50%);
      padding:8px 12px;border-radius:6px;background:var(--panel-solid);color:var(--ink);font:13px var(--mono);pointer-events:none}
    body.droneOn.droneSticks #savePictureStatus{top:auto;bottom:calc(78px + var(--safe-bottom,env(safe-area-inset-bottom,0px)));
      padding:6px 8px;font-size:10px;white-space:nowrap}
    @media (max-width:420px){
      body.droneOn.droneSticks #savePictureStatus{left:auto;right:calc(8px + env(safe-area-inset-right,0px));transform:none;
        bottom:calc(102px + var(--drone-stick-size) + var(--safe-bottom,env(safe-area-inset-bottom,0px)))}
    }
    @media(orientation:landscape) and (min-width:421px) and (max-height:319px){
      body.droneOn.droneSticks #savePictureStatus{left:auto;right:calc(22px + var(--drone-stick-size) + env(safe-area-inset-right,0px));
        top:calc(134px + env(safe-area-inset-top,0px));bottom:auto;transform:none;box-sizing:border-box;max-width:56px;padding:4px;font-size:9px;white-space:normal;overflow-wrap:break-word;text-align:center}
    }
    @media(orientation:landscape) and (max-width:420px) and (max-height:319px){
      body.droneOn.droneSticks #savePictureStatus{left:calc(50% + (env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px)) / 2);right:auto;top:auto;bottom:calc(14px + var(--safe-bottom,env(safe-area-inset-bottom,0px)));
        transform:translateX(-50%);box-sizing:border-box;max-width:max(0px,min(84px,calc(100vw - 44px - 2 * var(--drone-stick-size) - env(safe-area-inset-left,0px) - env(safe-area-inset-right,0px))));padding:4px;font-size:9px;white-space:normal;overflow-wrap:break-word;text-align:center}
    }
    #savePictureStatus:empty{display:none}
  ` }));
}

export function watchPictureStatus(status: HTMLElement): void {
  const probe = Object.assign(document.createElement('span'), { ariaHidden: 'true' });
  probe.style.cssText = 'position:fixed;inset:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);pointer-events:none;visibility:hidden';
  document.body.append(probe);
  const props = ['left', 'right', 'top', 'bottom', 'transform', 'maxWidth', 'whiteSpace', 'fontSize', 'lineHeight', 'padding', 'boxSizing', 'textAlign'] as const;
  const reset = () => { for (const p of props) status.style[p] = ''; };
  const box = (sel: string): DOMRect | null => {
    const e = document.querySelector<HTMLElement>(sel);
    if (!e || e.hidden || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const place = () => {
    reset();
    if (!status.textContent || !document.body.classList.contains('droneOn') || !document.body.classList.contains('droneSticks')) return;
    const safe = probe.getBoundingClientRect();
    const blockers: [number, number, number, number][] = [];
    for (const sel of ['#hud', '#miniMap', '#gear', '#pauseButton', '#savePictureButton', '#droneReturn']) {
      const r = box(sel); if (r) blockers.push([r.left - 1, r.top - 1, r.right + 1, r.bottom + 1]);
    }
    for (const sel of ['#droneLeft', '#droneLeft span', '#droneRight', '#droneRight span']) {
      const r = box(sel); if (r) blockers.push([r.left - 8, r.top - 8, r.right + 8, r.bottom + 8]);
    }
    const fits = (): boolean => {
      const r = status.getBoundingClientRect();
      if (r.width < 36 || r.height <= 0 || r.left < safe.left - 0.5 || r.right > safe.right + 0.5 || r.top < safe.top - 0.5 || r.bottom > safe.bottom + 0.5) return false;
      return blockers.every(([l, t, ri, b]) => r.right <= l || r.left >= ri || r.bottom <= t || r.top >= b);
    };
    if (fits()) return;
    const leftStick = box('#droneLeft'), rightStick = box('#droneRight'), ret = box('#droneReturn');
    const saveBtn = box('#savePictureButton'), pauseBtn = box('#pauseButton'), mapRect = box('#miniMap'), hudRect = box('#hud');
    const compact = { boxSizing: 'border-box', padding: '4px', fontSize: '9px', whiteSpace: 'normal', textAlign: 'center' };
    const tight = { ...compact, padding: '2px 4px', lineHeight: '10px' };
    const tries: Partial<CSSStyleDeclaration>[] = [];
    if (leftStick && rightStick && rightStick.left - leftStick.right - 16 >= 48) {
      tries.push({ ...compact, left: `${(leftStick.right + rightStick.left) / 2}px`, right: 'auto', top: 'auto', bottom: `${innerHeight - safe.bottom + 14}px`, transform: 'translateX(-50%)', maxWidth: `${Math.min(84, rightStick.left - leftStick.right - 16)}px` });
    }
    if (ret) {
      tries.push({ ...compact, left: `${(safe.left + safe.right) / 2}px`, right: 'auto', top: 'auto', bottom: `${innerHeight - ret.top + 8}px`, transform: 'translateX(-50%)', maxWidth: `${Math.min(180, safe.right - safe.left - 16)}px` });
      tries.push({ ...compact, left: 'auto', right: `${innerWidth - safe.right + 8}px`, top: 'auto', bottom: `${innerHeight - ret.top + 8}px`, transform: 'none', maxWidth: `${Math.min(180, safe.right - safe.left - 16)}px` });
    }
    if (saveBtn) {
      const mw = Math.min(84, Math.max(48, ret && ret.right < saveBtn.right ? saveBtn.right - ret.right - 8 : 56));
      tries.push({ ...compact, left: 'auto', right: `${innerWidth - saveBtn.right}px`, top: `${saveBtn.bottom + 6}px`, bottom: 'auto', transform: 'none', maxWidth: `${mw}px` });
      const tightW = Math.min(56, Math.max(46, mapRect && mapRect.right < saveBtn.right ? saveBtn.right - mapRect.right - 8 : 56));
      tries.push({ ...tight, left: 'auto', right: `${innerWidth - saveBtn.right}px`, top: `${saveBtn.bottom + 4}px`, bottom: 'auto', transform: 'none', maxWidth: `${tightW}px` });
    }
    if (mapRect && hudRect && mapRect.left - safe.left - 8 >= 46) {
      tries.push({ ...tight, left: `${safe.left + 4}px`, right: 'auto', top: `${hudRect.bottom + 4}px`, bottom: 'auto', transform: 'none', maxWidth: `${Math.min(84, mapRect.left - safe.left - 8)}px` });
    }
    if (pauseBtn) {
      tries.push({ ...compact, left: 'auto', right: `${innerWidth - pauseBtn.right}px`, top: `${pauseBtn.bottom + 6}px`, bottom: 'auto', transform: 'none', maxWidth: `${Math.min(140, pauseBtn.right - safe.left - 8)}px` });
    }
    for (const style of tries) { reset(); Object.assign(status.style, style); if (fits()) return; }
    reset();
  };
  let watchedMap: HTMLElement | null = null;
  const mapMut = typeof MutationObserver === 'function' ? new MutationObserver(place) : null;
  const mapResize = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
  const attachMap = () => {
    const map = document.getElementById('miniMap');
    if (map === watchedMap) return;
    mapMut?.disconnect(); mapResize?.disconnect(); watchedMap = map;
    if (map) { mapMut?.observe(map, { attributes: true, attributeFilter: ['class', 'style'] }); mapResize?.observe(map); }
  };
  attachMap();
  if (typeof MutationObserver === 'function') {
    new MutationObserver(place).observe(status, { childList: true, characterData: true, subtree: true });
    new MutationObserver(() => { attachMap(); place(); }).observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
  }
  addEventListener('resize', place);
}
