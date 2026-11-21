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
    @media(orientation:landscape) and (max-height:319px){
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
    @media(orientation:landscape) and (max-height:319px){
      body.droneOn.droneSticks #savePictureStatus{left:auto;right:calc(22px + var(--drone-stick-size) + env(safe-area-inset-right,0px));
        top:calc(134px + env(safe-area-inset-top,0px));bottom:auto;transform:none;box-sizing:border-box;max-width:72px;white-space:normal;text-align:center}
    }
    #savePictureStatus:empty{display:none}
  ` }));
}
