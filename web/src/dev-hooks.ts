import * as THREE from 'three';
import { autopilot, type Input, type Vehicle } from './vehicle';
import type { Road, Roads } from './roads';
import type { Props } from './props';
import type { LawnDemo } from './shift-demo';
import type { Relief } from './relief';
import type { Shift } from './shift';
import type { Subject } from './evidence';

type DemoRelief = Pick<Relief, 'breaks' | 'busy' | 'request'>;
type DemoShift = Pick<Shift, 'evidence' | 'takePhoto' | 'end'>;
const demoRoad = (r: Road) => r.kind <= 3;

/** Screenshot/test links are public features, including in the production bundle.
 * Read their switches once; keep calls at their original points in frame(). */
export class DevHooks {
  readonly demo: number;
  readonly throwMail: boolean;
  readonly breakEnabled: boolean;
  readonly inputEnabled: boolean;
  readonly afterEnabled: boolean;
  private readonly knock: boolean;
  private readonly lawn: boolean;
  private readonly stuffed: boolean;
  private readonly photo: boolean;
  private readonly report: boolean;
  private demoPhoto = false;
  private readonly stopped: Input = { throttle: 0, steer: 0, handbrake: true };
  private photoVehicle: Vehicle | null = null;
  private photoCamera: THREE.Camera | null = null;
  private photoShift: DemoShift | null = null;
  private subjectFound = false;
  // Map.forEach reuses this startup callback, with no per-frame iterator or closure.
  // The first eligible subject owns the attempt, even when takePhoto returns false.
  private readonly visitSubject = (s: Subject): void => {
    if (this.subjectFound) return;
    const vehicle = this.photoVehicle!;
    if (s.active && Math.hypot(s.x - vehicle.x, s.z - vehicle.z) <= 43) {
      this.subjectFound = true;
      if (this.photoShift!.takePhoto(vehicle, this.photoCamera!)) this.demoPhoto = true;
    }
  };

  constructor(params: URLSearchParams) {
    const demo = params.get('demo');
    this.demo = demo !== null ? parseFloat(demo) || 8 : 0;
    this.throwMail = params.get('throw') === '1';
    this.knock = params.get('knock') === '1';
    this.breakEnabled = params.get('break') === '1';
    this.photo = params.get('photo') === '1';
    this.report = params.get('report') === '1';
    this.lawn = params.has('lawn');
    this.stuffed = params.has('stuffed');
    this.inputEnabled = !!this.demo || this.lawn;
    this.afterEnabled = this.photo || this.report;
  }

  reset(): void { this.demoPhoto = false; }

  demoInput(drove: number, vehicle: Vehicle, roads: Roads, props: Props | null,
    lawnDemo: LawnDemo | null, mailMode: boolean, driveInput: () => Input): Input {
    this.stopped.throttle = Math.abs(vehicle.speed) > 0.15 ? -Math.sign(vehicle.speed) : 0;
    this.stopped.steer = 0; this.stopped.handbrake = true;
    const input = this.demo && drove < this.demo ? autopilot(vehicle, roads, this.throwMail ? 8 : 16)
      : this.demo ? this.stopped : driveInput();
    if (this.demo && drove < this.demo && this.knock) {
      const road = roads.nearest(vehicle.x, vehicle.z, 40, demoRoad);
      if (road) {
        let heading = road.heading;
        if (Math.cos(heading - vehicle.heading) < 0) heading += Math.PI;
        const rx = Math.cos(heading), rz = Math.sin(heading);
        let shoulder = road.road.halfWidth + .7, nearest = 55;
        // Follow the right shoulder, then line up on an upright post ahead.
        if (props) for (let i = 0; i < props.mail.length; i++) {
          const box = props.mail[i];
          if (box.motion.down) continue;
          const dx = box.x - vehicle.x, dz = box.z - vehicle.z;
          const ahead = dx * Math.sin(heading) - dz * Math.cos(heading);
          const across = (box.x - road.x) * rx + (box.z - road.z) * rz;
          if (ahead > -2 && ahead < nearest && across > 0 && across < road.road.halfWidth + 4) { nearest = ahead; shoulder = across; }
        }
        const side = (vehicle.x - road.x) * rx + (vehicle.z - road.z) * rz - shoulder;
        const err = Math.atan2(Math.sin(heading - vehicle.heading), Math.cos(heading - vehicle.heading));
        input.steer = THREE.MathUtils.clamp(err * 1.8 - side * .3, -1, 1);
      }
    }
    if (mailMode && this.lawn && this.demo && drove < this.demo) { input.throttle = 1; input.steer = 0; input.handbrake = false; }
    if (lawnDemo && !lawnDemo.driving) { input.throttle = 0; input.handbrake = true; }
    if (this.stuffed && this.demo) { input.throttle = 0; input.handbrake = true; }
    return input;
  }

  beforeRelief(drove: number, relief: DemoRelief): void {
    if (relief.breaks === 0 && (!this.demo || drove >= this.demo)) relief.request();
  }

  afterFrame(drove: number, loaded: boolean, mode: 'drive' | 'fly', vehicle: Vehicle,
    camera: THREE.Camera, shift: DemoShift, relief: DemoRelief): void {
    if (this.photo && this.demo && !this.demoPhoto && loaded && mode === 'drive') {
      // Only press the shutter once something is in range and inside the camera or front cone.
      this.photoVehicle = vehicle; this.photoCamera = camera; this.photoShift = shift;
      this.subjectFound = false;
      shift.evidence.subjects.forEach(this.visitSubject);
    }
    if (this.report && loaded && (!this.demo || drove >= this.demo) && Math.abs(vehicle.speed) < .15
      && !relief.busy && (!this.breakEnabled || relief.breaks > 0)) shift.end();
  }
}
