import * as THREE from 'three';
import type { Device } from './gamepad-rules';
import { DragRun, DRAG_DISTANCE, paceDistance, PACE_ET, PACE_REACTION, recordDragBest } from './drag-rules';
export { airportDragPlace, DRAG_START_KEY } from './drag-strip';
import { DRAG_LANE, DRAG_HALF_LANE, DragStrip } from './drag-strip';
import { parkedMatrix, vehicleShape } from './parked';
import { Mesher } from './yard-kit';
import type { Terrain } from './terrain';
import type { Vehicle } from './vehicle';
// The public and offline builds ship this area as a JavaScript chunk.
const CSS = `
#airportDrag {
  position: fixed;
  z-index: 5;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: calc(100vw - 28px);
  box-sizing: border-box;
  padding: 10px 14px;
  border: 1px solid var(--ink-dim);
  border-radius: 8px;
  background: var(--panel-solid);
  color: var(--ink);
  font: 12px/1.4 var(--mono);
  font-variant-numeric: tabular-nums;
  text-align: center;
  pointer-events: none;
}
#airportDrag h2 { margin: 0 0 6px; font: bold 15px var(--mono); }
#airportDrag h2 span { margin-left: 7px; color: var(--ink-dim); font-size: 12px; font-weight: normal; }
#airportDrag .dragTree { display: flex; justify-content: center; gap: 8px; margin: 8px 0; }
#airportDrag .dragTree i { width: 13px; height: 13px; border-radius: 50%; background: #495059; border: 1px solid #78818a; }
#airportDrag .dragTree[data-phase="staged"] i:first-child { background: #f6f3ce; }
#airportDrag .dragTree[data-phase="amber-1"] i:nth-child(2),
#airportDrag .dragTree[data-phase="amber-2"] i:nth-child(3),
#airportDrag .dragTree[data-phase="amber-3"] i:nth-child(4) { background: #ffc254; }
#airportDrag .dragTree[data-phase="green"] i:nth-child(5),
#airportDrag .dragTree[data-phase="running"] i:nth-child(5),
#airportDrag .dragTree[data-phase="finished"] i:nth-child(5) { background: #66e28e; }
#airportDrag .dragTree[data-phase="red"] i:last-child { background: #ff5855; }
#airportDrag .dragResult { white-space: pre; margin: 7px 0; text-align: left; }
#airportDrag .dragBest { color: var(--ink-dim); }
#airportDrag .dragBest:not(:empty) { margin-top: 5px; }
#airportDrag button {
  pointer-events: auto;
  min-height: 44px;
  margin-top: 6px;
  padding: 0 12px;
  cursor: pointer;
  background: var(--panel);
  color: var(--ink);
  border: 1px solid var(--ink-dim);
  border-radius: 5px;
  font: bold 12px var(--mono);
}
#airportDrag button:disabled { opacity: .55; cursor: default; }
body.tcOn #airportDrag { top: calc(62px + env(safe-area-inset-top, 0px)); }
@media (max-height: 460px) {
  body.tcOn #airportDrag { top: calc(62px + env(safe-area-inset-top, 0px)); padding: 6px 10px; }
}
`;

const COPY = {
  staged: 'Staged · wait for green',
  'amber-1': 'Amber 1 of 3',
  'amber-2': 'Amber 2 of 3',
  'amber-3': 'Amber 3 of 3',
  green: 'Green · go!',
  running: 'Race in progress',
  red: 'Red light · jump start',
  aborted: 'Run cancelled · left the staging area or lane',
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
    this.stage.onclick = () => this.begin();
    this.back.onclick = () => { this.reset(); goToStart(this.strip.start); };
    this.leave.onclick = () => this.reset();
    for (const event of ['pointerdown', 'pointerup', 'pointermove']) this.panel.addEventListener(event, ev => ev.stopPropagation());
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    document.body.append(this.panel);
  }

  reset(): void {
    this.run = null;
    this.paceTime = 0;
    this.panel.hidden = true;
    this.rival.visible = false;
  }

  begin(): boolean {
    if (!this.available || this.run?.active || !this.vehicle || !this.canStage(this.vehicle)) return false;
    this.paceTime = 0;
    this.run = new DragRun(this.nose(this.vehicle));
    return true;
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
    return along >= -28 && along <= DRAG_DISTANCE + 140 && Math.abs(this.strip.across(vehicle.x, vehicle.z)) <= 21;
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
    // The fixed-step callback only runs when the vehicle moves through the physics loop.
    if (!this.run || this.run.fault) return;
    this.paceTime += dt;
    if (!this.run.active) return;
    this.run.step(dt, this.nose(vehicle), this.inLane(vehicle));
    const elapsed = this.run.result?.elapsed;
    if (elapsed !== undefined && (this.best === null || elapsed < this.best)) this.best = recordDragBest(this.storage, this.kind, elapsed);
  }

  draw(vehicle: Vehicle, device: Device): void {
    if (this.run && !this.run.active && (!this.strip.onRunway(vehicle.x, vehicle.z) || (this.run.result && this.nose(vehicle) < 0))) this.reset();
    const run = this.run;
    this.panel.hidden = !this.available || (!run && !this.nearStart(vehicle));
    this.rival.visible = false;
    if (this.panel.hidden) return;
    const phase = run?.phase ?? 'idle';
    const ready = !run?.active && this.canStage(vehicle);
    const terminal = !!run && !run.active;
    this.tree.dataset.phase = phase;
    const shortcut = device === 'gamepad' ? ' · Y / Triangle' : device === 'keyboard' ? ' · Enter' : '';
    if (phase === 'idle') write(this.status, ready ? 'Ready to stage' + shortcut : 'Stop just behind the line in the left lane');
    else if (phase !== 'finished') write(this.status, COPY[phase]);
    this.stage.hidden = phase !== 'idle' && !ready;
    this.stage.disabled = !ready;
    write(this.stage, terminal ? 'Stage again' + shortcut : 'Stage');
    this.back.hidden = !terminal || ready;
    this.leave.hidden = !terminal;
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
