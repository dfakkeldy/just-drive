import type * as THREE from 'three';
import type { HudState } from './hud-text';
import type { Input } from './vehicle';
import type { GarageEntry } from './garage';
import {HorseRampHint} from './horse-ramp-hint';
import type {Yard} from './yard';
import { HorseSound } from './horse-sound';
import { DEFAULT_ENGINE_VOLUME } from './engine-sound';
import type { HorseRig } from './horse';
import { BikeRide } from './bike-ride';
import { BikeCamera } from './bike-camera';
import { bikeControls, bikeHorn, type BikeControls } from './bike-controls';
import { vehicleChoice, vehicleButtons, restoreVehiclePose, bikeHelp, horseHelp, horseMailHelp } from './vehicle-choice';
import { exploreHelp } from './explore';
import { padHelp } from './controls';
import type { Ride } from './ride';
import type { Terrain } from './terrain';

/** UI, input and camera hooks for the solver selected by the garage. No second vehicle registry. */
export function rideFeatures(vehicle: Ride, entry: GarageEntry, terrain: Terrain, explore: boolean, radio = true, just = false) {
  let bike = vehicle instanceof BikeRide ? vehicle : null;
  let kind = entry.id;
  const horse = kind === 'horse';
  const sound = horse ? new HorseSound() : null;
  let playing = false;
  if (horse) (vehicle.car as HorseRig).onFootfall = () => { if (playing) sound?.footfall(vehicle.surfaceName); };
  let camera = bike ? new BikeCamera(bike, terrain) : null;
  const airLine = (): string => {
    const j = bike?.lastJump;
    if (j && j.airTime > 1) {
      const flips = j.pitchRotations ? ` · ${Math.abs(j.pitchRotations)} ${j.pitchRotations > 0 ? 'backflip' : 'frontflip'}${Math.abs(j.pitchRotations) > 1 ? 's' : ''}` : '';
      return `\nAir ${j.airTime.toFixed(1)} s · ${j.distance.toFixed(0)} m${flips} · ${j.clean ? 'clean' : 'tumble'}`;
    }
    return '';
  };
  const choice = { get kind() { return kind; }, choose(next: string) { vehicleChoice(kind, vehicle).choose(next); } };
  let bikeInput: BikeControls | null = null;
  let controls: (input: Input) => Input = input => input;
  const features = {
    get kind() { return kind; }, choice,
    select(next: Ride, selected: GarageEntry): void {
      bikeInput?.reset();
      vehicle = next; kind = selected.id; bike = next instanceof BikeRide ? next : null;
      camera = bike ? new BikeCamera(bike, terrain) : null;
      if (bike) bikeInput ??= bikeControls();
      controls = bike ? bikeInput! : input => input;
      document.body.classList.toggle('bikeMode', !!bike);
      for (const button of document.querySelectorAll<HTMLButtonElement>('#vehicleChoice [data-vehicle], #settingsVehicleChoice [data-vehicle]')) {
        const on = button.dataset.vehicle === kind; button.setAttribute('aria-pressed', String(on));
        button.style.background = on ? '#31463a' : 'transparent'; button.style.borderColor = on ? '#a7d9bc' : '#6b7780';
      }
      const help = document.getElementById('drivingHelp'); if (help) help.hidden = !!bike;
      const jump = document.getElementById('bikeJump'); if (jump) jump.hidden = true;
    },
    resetInput(): void { bikeInput?.reset(); },
    checkpointCamera(): () => void { const previous = camera; return () => { camera = previous; }; },
    setRadio(available: boolean): void { radio = available; },

    /** The "Hoof sound" volume, 0 to 1. Motors take theirs in engine-sound.ts. */
    setHoofVolume(v: number): void { if (sound) sound.volume = v / DEFAULT_ENGINE_VOLUME; },
    honk(): void { if (horse) sound?.whinny(); else if (bike) bikeHorn(); },
    configure(restore = true): void {
      if (horse) {
        const horn = document.getElementById('tcHorn'), brake = document.getElementById('tcBrake');
        if (horn) { horn.textContent = 'WHINNY'; horn.setAttribute('aria-label', 'Whinny'); }
        if (brake) brake.innerHTML = 'WHOA<br>BACK';
        document.getElementById('tcReset')?.setAttribute('aria-label', 'Put the horse back on the road');
      }
      if (bike) controls = bikeInput = bikeControls();
      if (!explore) return;
      const panel = document.getElementById('settings');
      if (panel) { const heading = document.createElement('p'); heading.textContent = 'Ride'; panel.append(heading, vehicleButtons(choice, 'settingsVehicleChoice')); }
      if (restore) restoreVehiclePose(vehicle);
    },
    input(input: Input): Input { return controls(input); },
    chase(cameraObject: THREE.PerspectiveCamera, dt: number, view: 'chase' | 'seat', reset: boolean): boolean {
      if (!camera) return false; camera.update(cameraObject, dt, view, reset); return true;
    },
    get help(): string {
      let line = horse ? (explore ? horseHelp : horseMailHelp) : kind === 'bike' ? bikeHelp : exploreHelp;
      if (just && !radio) line = line.replace(' · T: radio', '');
      if (just) line = line.replace(/\bShift\b/g, '⇧');
      return line + airLine();
    },
    /** The same help for a controller (controls.ts padHelp), with the bike's last jump. */
    get padHelp(): string { return padHelp(kind, !explore, radio && !horse) + airLine(); },
    get jumpLine(): string {
      const j = bike?.lastJump;
      const text = !j || j.airTime <= 1 ? '' : `Air ${j.airTime.toFixed(1)} s · ${j.distance.toFixed(0)} m${j.pitchRotations ? ` · ${Math.abs(j.pitchRotations)} ${j.pitchRotations > 0 ? 'backflip' : 'frontflip'}${Math.abs(j.pitchRotations) > 1 ? 's' : ''}` : ''} · ${j.clean ? 'clean' : 'tumble'}`;
      const status = document.getElementById('bikeJump');
      if (status) { status.hidden = !text; if (status.textContent !== text) status.textContent = text; return ''; }
      return text ? ' · ' + text : '';
    },
    get drivingHelp(): boolean { return !bike; },
  };
  // These hooks and their argument work exist only for a mount.
  const hooks: {hud?: (state: HudState) => void; update?: (dt: number, active: boolean) => void; pause?: (paused: boolean) => void; yardJob?: (yard: Yard) => HorseRampHint} = {};
  if (horse) {
    hooks.hud = state => { state.help = explore ? horseHelp : horseMailHelp; if (!explore) state.driveHelp = horseMailHelp; state.showRuts = false; };
    hooks.update = (dt, active) => { playing = active; sound!.update(dt, active); };
    hooks.pause = paused => { if (paused) { playing = false; sound!.update(0, false); } };
    hooks.yardJob = yard => new HorseRampHint(yard, vehicle);
    Object.assign(features, hooks);
  }
  return features as typeof features & typeof hooks;
}
