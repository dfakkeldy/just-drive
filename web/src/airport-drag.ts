import * as THREE from 'three';
import { DragRun, DRAG_DISTANCE, paceDistance, PACE_ET, PACE_REACTION, recordDragBest } from './drag-rules';
export { airportDragPlace, DRAG_START_KEY } from './drag-strip';
import { DRAG_LANE, DRAG_HALF_LANE, DragStrip } from './drag-strip';
import { parkedMatrix, vehicleShape } from './parked';
import { Mesher } from './yard-kit';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';
import './airport-drag.css';

const COPY = {
  staged: 'Staged · wait for green',
  'amber-1': 'Amber 1 of 3',
  'amber-2': 'Amber 2 of 3',
  'amber-3': 'Amber 3 of 3',
  green: 'Green · go!',
  running: 'Race in progress',
  red: 'Red light · jump start',
  aborted: 'Run cancelled · left the lane',
} as const;
const time = (seconds: number) => seconds.toFixed(3) + ' s';
const write = (element: HTMLElement, value: string) => { if (element.textContent !== value) element.textContent = value; };

export class AirportDrag {
  readonly strip: DragStrip;
  readonly rival: THREE.Mesh;
  private readonly panel = document.createElement('section');
  private readonly status: HTMLElement;
  private readonly tree: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly result: HTMLElement;
  private readonly bestLine: HTMLElement;
  private readonly stage: HTMLButtonElement;
  private readonly back: HTMLButtonElement;
  private readonly leave: HTMLButtonElement;
  private readonly storage: Storage | undefined;
  private run: DragRun | null = null;
  private best: number | null = null;
  private paceTime = 0;
  private kind = '';
  private vehicle: Vehicle | null = null;
  private placement = -1;
  private dismissed = false;
  private available = false;

  constructor(private terrain: Terrain, goToStart: (pose: DragStrip['start']) => void) {
    this.strip = new DragStrip(terrain.manifest.village);
    const mesh = new Mesher();
    vehicleShape(mesh, 0, null, new THREE.Color(0xe4a025).toArray() as [number, number, number]);
    this.rival = new THREE.Mesh(mesh.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.rival.name = 'Drag pace car';
    this.rival.visible = false;
    try { this.storage = localStorage; } catch { /* blocked storage */ }

    this.panel.id = 'airportDrag';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', 'Airport drag race');
    this.panel.innerHTML = `
      <h2>Airport drag <span>¼ mile</span></h2>
      <div class="dragTree" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="dragStatus" role="status"></div>
      <div class="dragProgress"></div>
      <div class="dragResult" hidden></div>
      <div class="dragBest"></div>
      <div class="dragActions">
        <button type="button" class="dragStage">Stage</button>
        <button type="button" class="dragBack" hidden>Back to start</button>
        <button type="button" class="dragLeave" aria-label="Close drag results" hidden>Close</button>
      </div>`;
    this.status = this.panel.querySelector('.dragStatus')!;
    this.tree = this.panel.querySelector('.dragTree')!;
    this.progress = this.panel.querySelector('.dragProgress')!;
    this.result = this.panel.querySelector('.dragResult')!;
    this.bestLine = this.panel.querySelector('.dragBest')!;
    this.stage = this.panel.querySelector('.dragStage')!;
    this.back = this.panel.querySelector('.dragBack')!;
    this.leave = this.panel.querySelector('.dragLeave')!;
    this.stage.onclick = () => {
      if (this.available && !this.run && this.vehicle && this.canStage(this.vehicle)) this.run = new DragRun(this.nose(this.vehicle));
    };
    this.back.onclick = () => { this.reset(); goToStart(this.strip.start); };
    this.leave.onclick = () => { this.reset(); this.dismissed = true; };
    for (const event of ['pointerdown', 'pointerup', 'pointermove']) this.panel.addEventListener(event, ev => ev.stopPropagation());
    document.body.append(this.panel);
  }

  reset(): void {
    this.run = null;
    this.paceTime = 0;
    this.dismissed = false;
    this.panel.hidden = true;
    this.rival.visible = false;
  }

  private nose(vehicle: Vehicle): number {
    const length = vehicle.spec.envelope.sweepHalfLength;
    return this.strip.along(vehicle.x + Math.sin(vehicle.heading) * length, vehicle.z - Math.cos(vehicle.heading) * length);
  }

  private inLane(vehicle: Vehicle): boolean {
    return Math.abs(this.strip.across(vehicle.x, vehicle.z) + DRAG_LANE) <= DRAG_HALF_LANE;
  }

  onStrip(vehicle: Vehicle): boolean {
    const along = this.strip.along(vehicle.x, vehicle.z);
    return along >= -28 && along <= DRAG_DISTANCE + 110 && Math.abs(this.strip.across(vehicle.x, vehicle.z)) <= 21;
  }

  private nearStart(vehicle: Vehicle): boolean {
    const along = this.strip.along(vehicle.x, vehicle.z);
    return along >= -28 && along <= 12 && Math.abs(this.strip.across(vehicle.x, vehicle.z)) <= 21;
  }

  private canStage(vehicle: Vehicle): boolean {
    const nose = this.nose(vehicle);
    return nose >= -3 && nose <= -0.25 && this.inLane(vehicle)
      && Math.cos(vehicle.heading - this.strip.start.heading) > 0.97
      && !vehicle.airborne && Math.hypot(vehicle.vx, vehicle.vz) < 0.2
      && this.terrain.surfaceAt(vehicle.x, vehicle.z)?.kind === 13;
  }

  sync(vehicle: Vehicle, kind: string, placement: number, driving: boolean, available: boolean): void {
    if (!driving || vehicle !== this.vehicle || placement !== this.placement || kind !== this.kind) this.reset();
    this.vehicle = vehicle;
    this.placement = placement;
    if (kind !== this.kind) {
      this.kind = kind;
      this.best = recordDragBest(this.storage, kind);
    }
    this.available = available;
  }

  step(dt: number, vehicle: Vehicle): void {
    if (!this.available || !this.run || this.run.fault) return;
    this.paceTime += dt;
    if (!this.run.active) return;
    this.run.step(dt, this.nose(vehicle), this.inLane(vehicle));
    const elapsed = this.run.result?.elapsed;
    if (elapsed !== undefined && (this.best === null || elapsed < this.best)) this.best = recordDragBest(this.storage, this.kind, elapsed);
  }

  draw(vehicle: Vehicle): void {
    const run = this.run;
    const near = this.nearStart(vehicle);
    if (!near) this.dismissed = false;
    this.panel.hidden = !this.available || (!run && (!near || this.dismissed));
    this.rival.visible = false;
    if (this.panel.hidden) return;
    const phase = run?.phase ?? 'idle';
    const staged = phase === 'idle' && this.canStage(vehicle);
    this.tree.dataset.phase = phase;
    if (phase === 'idle') write(this.status, staged ? 'Ready to stage' : 'Stop just behind the line in the left lane');
    else if (phase !== 'finished') write(this.status, COPY[phase]);
    this.stage.hidden = phase !== 'idle';
    this.stage.disabled = !staged;
    this.back.hidden = this.leave.hidden = !run || run.active;
    this.progress.hidden = phase !== 'running' && phase !== 'green';
    this.result.hidden = !run?.result;
    write(this.bestLine, this.best === null ? '' : 'Vehicle best · ' + time(this.best));
    if (!run) return;

    const pace = paceDistance(this.paceTime);
    if (!this.progress.hidden) {
      const playerLeft = Math.max(0, Math.ceil(DRAG_DISTANCE - this.nose(vehicle)));
      write(this.progress, `You ${playerLeft} m left · Pace car ${Math.max(0, Math.ceil(DRAG_DISTANCE - pace))} m left`);
    }
    if (run.result) {
      const { reaction, elapsed, trapKmh } = run.result;
      const gap = reaction + elapsed - PACE_REACTION - PACE_ET;
      write(this.status, Math.abs(gap) < 0.0005 ? 'Dead heat' : gap < 0 ? 'You win' : 'Pace car wins');
      write(this.result, `Reaction     ${time(reaction)}\nElapsed      ${time(elapsed)}\nTrap speed   ${trapKmh.toFixed(1)} km/h`);
    }
    if (!run.fault) {
      const car = this.strip.point(pace - 2.3, DRAG_LANE);
      this.rival.visible = parkedMatrix(car, (x, z) => this.terrain.meshHeightAt(x, z, true), this.rival);
    }
  }
}
