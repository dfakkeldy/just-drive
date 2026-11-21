import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { ephemeris, halifaxTime, localDate, localTime, localZone, validStudyDate, validTime, type SunEvent } from './light-study';
import { directionFromAngles, sunAngles } from './sun';
import { hillElevation, hillSunEvents, sampleHillLine, sunArc, type HillLine } from './sun-seeker-rules';
import './sun-seeker.css';

const RADIUS = 180;
const SELECTED = '#ffd477';
const HILLS = '#f3f5f6';
const SEASONS = [
  { date: '12-21', name: 'Winter solstice', color: '#a2dbff', labelAt: .38 },
  { date: '03-20', name: 'Spring equinox', color: '#aaf4d1', labelAt: .50 },
  { date: '06-21', name: 'Summer solstice', color: '#ffb5ce', labelAt: .53 },
];
const anglesAt = (az: number, el: number) => directionFromAngles(az, el).multiplyScalar(RADIUS);
const eventTime = (event?: SunEvent) => event ? localTime(new Date(Math.round(+event.when / 60_000) * 60_000)) : '—';

export interface SunViewLight {
  sun: { az: number; el: number };
  when: Date;
  lat: number;
  lon: number;
}

interface SunSeekerOptions {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  eye: THREE.Vector3;
  lat: number;
  lon: number;
  height(x: number, z: number): number | null;
  close(): void;
  savePicture?: () => void;
}

interface Label { element: HTMLElement; position: THREE.Vector3; width: number }

/** A still view over the game canvas. The existing pause gate owns the simulation. */
export class SunSeeker {
  readonly root = document.createElement('dialog');
  private readonly paths = new THREE.Group();
  private readonly seasons = new THREE.Group();
  private readonly activePath = new THREE.Group();
  private readonly horizon = new THREE.Group();
  private readonly marker = new THREE.Mesh(new THREE.SphereGeometry(2, 16, 10),
    new THREE.MeshBasicMaterial({ color: SELECTED, depthTest: false, depthWrite: false, toneMapped: false }));
  private readonly labels: HTMLElement;
  private readonly date: HTMLInputElement;
  private readonly time: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly readings: HTMLElement;
  private readonly bearing: HTMLElement;
  private readonly oldCamera: { position: THREE.Vector3; rotation: THREE.Euler; fov: number };
  private readonly seasonLabels: Label[] = [];
  private readonly activeLabels: Label[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly today: string;
  private hills: HillLine;
  private selected: SunViewLight;
  private pathDate = '';
  private year = '';
  private yaw = -Math.PI;
  private pitch = .44;
  private dirty = true;

  constructor(private readonly options: SunSeekerOptions) {
    const { camera, eye, scene, lat, lon } = options;
    const now = new Date(), today = localDate(now);
    this.today = today;
    this.selected = { when: now, sun: sunAngles(now, lat, lon), lat, lon };
    this.oldCamera = { position: camera.position.clone(), rotation: camera.rotation.clone(), fov: camera.fov };
    this.root.id = 'sunSeeker';
    this.root.setAttribute('aria-labelledby', 'sunTitle');
    this.root.innerHTML = `
      <div class="sunLook" tabindex="0" role="group" aria-label="Sky view. Drag or use the arrow keys to look around."></div>
      <div class="sunLabels" aria-hidden="true"></div>
      <section class="sunPanel sunClock">
        <div class="sunHead"><h2 id="sunTitle">Sun Seeker</h2><span class="sunBearing" aria-hidden="true"></span><button type="button" autofocus>Back to pause</button></div>
        <div class="sunFields">
          <label><span>Date</span><input aria-label="Sun date" type="date" min="1880-01-01" max="2200-12-31" required></label>
          <label><span>Halifax time</span><input aria-label="Sun time" type="time" lang="en-GB" step="60" required></label>
        </div>
        <div class="sunActions">
          <button type="button" class="sunFace">Face sun</button>
          <button type="button" class="sunSave">Save picture</button>
          <small>Drag or use arrows</small>
        </div>
        <p role="status"></p>
      </section>
      <section class="sunPanel sunReadings" aria-label="Sun events and hill line">
        <ul class="sunLegend">
          ${SEASONS.map(({ name, color }) => `<li style="--path:${color}"><i></i>${name}</li>`).join('')}
          <li style="--path:${SELECTED}"><i></i><span class="sunDayName"></span></li>
          <li style="--path:${HILLS}"><i></i>Hill line</li>
        </ul>
        <table aria-label="Halifax sun times">
          <thead><tr><th scope="col">Halifax</th><th scope="col">Flat horizon</th><th scope="col">Over hills</th></tr></thead>
          <tbody></tbody>
        </table>
        <small>Bare ground within 6 km at the current hill scale. Far land has no trees.</small>
      </section>`;
    this.labels = this.root.querySelector('.sunLabels')!;
    this.date = this.root.querySelector('[type=date]')!;
    this.time = this.root.querySelector('[type=time]')!;
    this.status = this.root.querySelector('[role=status]')!;
    this.readings = this.root.querySelector('tbody')!;
    this.bearing = this.root.querySelector('.sunBearing')!;

    this.date.value = today;
    this.time.value = localTime(now);
    this.hills = sampleHillLine(eye, options.height);
    this.buildHorizon();
    this.updateDay();
    this.updateMarker();

    camera.position.copy(eye);
    this.paths.position.copy(eye);
    this.marker.renderOrder = 32;
    this.paths.add(this.seasons, this.activePath, this.horizon, this.marker);
    scene.add(this.paths);
    this.lookSize();
    this.bindControls();
    document.body.append(this.root);
    this.root.showModal();
  }

  private bindControls(): void {
    const { close, savePicture } = this.options;
    this.root.querySelector('button')!.addEventListener('click', close);
    this.root.addEventListener('click', event => event.stopPropagation());
    this.root.addEventListener('cancel', event => { event.preventDefault(); close(); });
    this.root.querySelector('.sunFace')!.addEventListener('click', () => {
      this.yaw = THREE.MathUtils.degToRad(-this.selected.sun.az);
      this.pitch = THREE.MathUtils.degToRad(this.selected.sun.el);
      this.aim();
    });
    // Save-picture integration: call the shared frame exporter with this view's draw callback.
    const save = this.root.querySelector<HTMLButtonElement>('.sunSave')!;
    save.disabled = !savePicture;
    save.title = savePicture ? '' : 'Picture saving is pending';
    save.addEventListener('click', () => this.savePicture());

    const change = () => {
      if (!validStudyDate(this.date.value) || !validTime(this.time.value)) {
        this.status.textContent = 'Choose a date from 1880–2200 and a valid time.';
        return;
      }
      const { when, adjustment } = halifaxTime(this.date.value, this.time.value);
      const { lat, lon } = this.options;
      this.selected = { when, sun: sunAngles(when, lat, lon), lat, lon };
      if (this.date.value !== this.pathDate) this.updateDay();
      this.updateMarker(adjustment === 'gap' ? ' · Clock moved forward' : adjustment === 'fold' ? ' · First occurrence' : '');
      this.invalidate();
    };
    this.date.addEventListener('change', change);
    this.time.addEventListener('change', change);

    const look = this.root.querySelector<HTMLElement>('.sunLook')!;
    let pointer: { id: number; x: number; y: number } | null = null;
    look.addEventListener('pointerdown', event => {
      if (pointer || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      look.setPointerCapture(event.pointerId);
    });
    look.addEventListener('pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      const scale = THREE.MathUtils.degToRad(this.options.camera.fov) / this.root.clientHeight;
      this.yaw += (event.clientX - pointer.x) * scale;
      this.pitch += (event.clientY - pointer.y) * scale;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      this.aim();
    });
    look.addEventListener('lostpointercapture', () => { pointer = null; });
  }

  private savePicture(): void {
    this.options.savePicture?.();
  }

  key(event: KeyboardEvent): void {
    if (event.code === 'Escape') {
      event.preventDefault();
      if (!event.repeat) this.options.close();
      return;
    }
    if (event.target instanceof HTMLInputElement || !event.code.startsWith('Arrow')) return;
    const step = Math.PI / 40;
    if (event.code === 'ArrowLeft') this.yaw += step;
    if (event.code === 'ArrowRight') this.yaw -= step;
    if (event.code === 'ArrowUp') this.pitch += step;
    if (event.code === 'ArrowDown') this.pitch -= step;
    event.preventDefault();
    this.aim();
  }

  lookSize(): void {
    this.options.camera.fov = this.options.camera.aspect < .85 ? 76 : 62;
    this.options.camera.updateProjectionMatrix();
    this.aim();
  }

  private aim(): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.53, 1.53);
    this.options.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const az = THREE.MathUtils.euclideanModulo(Math.round(THREE.MathUtils.radToDeg(-this.yaw)), 360);
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    this.bearing.textContent = `${directions[Math.round(az / 45) % 8]}  ${String(az).padStart(3, '0')}°`;
    this.invalidate();
  }

  invalidate(): void { this.dirty = true; }

  refreshGround(): void {
    this.hills = sampleHillLine(this.options.eye, this.options.height);
    this.buildHorizon();
    this.updateDay();
    this.updateMarker();
    this.invalidate();
  }

  /** Coalesce pointer moves, input changes and resize events into one paint. */
  takeDraw(): SunViewLight | null {
    if (!this.dirty) return null;
    this.dirty = false;
    return this.selected;
  }

  projectLabels(): void {
    const { camera } = this.options, width = this.root.clientWidth, height = this.root.clientHeight;
    const taken: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>[] = [...this.root.querySelectorAll('.sunPanel, .sunBearing')].map(el => el.getBoundingClientRect());
    for (const { element, position, width: labelWidth } of [...this.seasonLabels, ...this.activeLabels]) {
      const p = this.scratch.copy(position).applyMatrix4(camera.matrixWorldInverse);
      if (p.z >= 0) { element.hidden = true; continue; }
      p.applyMatrix4(camera.projectionMatrix);
      const x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
      const box = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - 8, bottom: y + 8 };
      const fits = box.left > 4 && box.right < width - 4 && box.top > 4 && box.bottom < height - 4
        && !taken.some(r => box.right >= r.left && box.left <= r.right && box.bottom >= r.top && box.top <= r.bottom);
      element.hidden = !fits;
      if (!fits) continue;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      taken.push(box);
    }
  }

  private label(labels: Label[], text: string, color: string, az: number, el: number, hour = false): void {
    const element = document.createElement('span');
    element.className = hour ? 'sunLabel hour' : 'sunLabel';
    element.textContent = text;
    element.style.setProperty('--path', color);
    const position = anglesAt(az, el).add(this.options.eye);
    this.labels.append(element);
    labels.push({ element, position, width: text.length * 6.6 + 14 });
  }

  private line(group: THREE.Group, points: number[], color: string, width: number, order: number): void {
    const geometry = new LineGeometry().setPositions(points);
    const material = new LineMaterial({ color, linewidth: width, depthTest: false, depthWrite: false, toneMapped: false, transparent: true });
    const line = new Line2(geometry, material);
    line.renderOrder = order;
    group.add(line);
  }

  private buildHorizon(): void {
    this.clear(this.horizon);
    const band: number[] = [];
    for (let i = 0; i < this.hills.length; i++) {
      const j = (i + 1) % this.hills.length, a = this.hills[i], b = this.hills[j];
      if (a === null || b === null) continue;
      const topA = anglesAt(i, a + .24), topB = anglesAt(j, b + .24), lowA = anglesAt(i, a - .24), lowB = anglesAt(j, b - .24);
      for (const p of [topA, topB, lowA, topB, lowB, lowA]) band.push(p.x, p.y, p.z);
    }
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(band, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: HILLS, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false, transparent: true, opacity: .72, toneMapped: false }));
    mesh.renderOrder = 27;
    this.horizon.add(mesh);
  }

  private updateDay(): void {
    const { lat, lon } = this.options, date = this.date.value;
    this.pathDate = date;
    const year = date.slice(0, 4);
    if (year !== this.year) {
      this.year = year;
      this.clear(this.seasons, this.seasonLabels);
      for (const { date: season, color, name, labelAt } of SEASONS) {
        const arc = sunArc(`${year}-${season}`, lat, lon);
        this.line(this.seasons, arc.flatMap(p => anglesAt(p.az, p.el).toArray()), color, 2, 28);
        const { az, el } = arc[Math.floor(labelAt * (arc.length - 1))];
        this.label(this.seasonLabels, name, color, az, el + 1.6);
      }
    }
    this.clear(this.activePath, this.activeLabels);
    const day = ephemeris(date, lat, lon), hills = hillSunEvents(date, lat, lon, this.hills);
    const arc = sunArc(date, lat, lon, hills.sunrise?.when, hills.sunset?.when);
    this.line(this.activePath, arc.flatMap(p => anglesAt(p.az, p.el).toArray()), SELECTED, 3.2, 29);
    const name = date === this.today ? 'Today' : 'Selected day';
    this.root.querySelector('.sunDayName')!.textContent = name;
    const label = arc[Math.floor(.60 * (arc.length - 1))];
    this.label(this.activeLabels, name, SELECTED, label.az, label.el + 1.6);

    const ticks: number[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const time = `${String(hour).padStart(2, '0')}:00`, { when, adjustment } = halifaxTime(date, time);
      if (adjustment === 'gap' || when < arc[0].when || when > arc.at(-1)!.when) continue;
      const { az, el } = sunAngles(when, lat, lon);
      ticks.push(...anglesAt(az, el - .56).toArray(), ...anglesAt(az, el + .56).toArray());
      this.label(this.activeLabels, time, SELECTED, az, el - 1.8, true);
    }
    if (ticks.length) {
      const marks = new LineSegments2(new LineSegmentsGeometry().setPositions(ticks),
        new LineMaterial({ color: SELECTED, linewidth: 2, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
      marks.renderOrder = 30;
      this.activePath.add(marks);
    }
    this.readings.innerHTML = `
      <tr><th scope="row">Sunrise</th><td>${eventTime(day.sunrise)}</td><td>${eventTime(hills.sunrise)}</td></tr>
      <tr><th scope="row">Solar noon</th><td colspan="2">${eventTime(day.highest)} · ${day.highest.el.toFixed(1)}°</td></tr>
      <tr><th scope="row">Sunset</th><td>${eventTime(day.sunset)}</td><td>${eventTime(hills.sunset)}</td></tr>`;
  }

  private updateMarker(note = ''): void {
    const { sun, when } = this.selected;
    this.marker.position.copy(anglesAt(sun.az, sun.el));
    const hill = hillElevation(this.hills, sun.az);
    const hidden = hill !== null && sun.el < hill;
    this.marker.material.wireframe = hidden;
    this.status.textContent = `${localTime(when)} ${localZone(when)} · ${Math.round(sun.az)}° az · ${sun.el.toFixed(1)}° high${hidden ? ' · Below hill line' : ''}${note}`;
  }

  private clear(group: THREE.Group, labels: Label[] = []): void {
    for (const object of [...group.children] as (THREE.Mesh<THREE.BufferGeometry, THREE.Material>)[]) {
      object.geometry.dispose();
      object.material.dispose();
      object.removeFromParent();
    }
    for (const { element } of labels) element.remove();
    labels.length = 0;
  }

  dispose(): void {
    this.paths.removeFromParent();
    this.clear(this.seasons, this.seasonLabels);
    this.clear(this.activePath, this.activeLabels);
    this.clear(this.horizon);
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.root.close();
    this.root.remove();
    const { camera } = this.options;
    camera.position.copy(this.oldCamera.position);
    camera.rotation.copy(this.oldCamera.rotation);
    camera.fov = this.oldCamera.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
}
