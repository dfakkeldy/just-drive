import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { ephemeris, halifaxTime, localDate, localTime, localZone, validStudyDate, validTime, type SunEvent } from './light-study';
import { directionFromAngles, sunAngles } from './sun';
import { apparentUpperLimb, HILL_RANGE, hillElevation, hillSunEvents, sampleHillLine, sunArc, trueEyeHeight, type GroundRay, type HillLine } from './sun-seeker-rules';
import './sun-seeker.css';

const RADIUS = 180;
const SELECTED = '#ffd477';
const HILLS = '#f3f5f6';
const INK = '#25313f';
const SEASONS = [
  { date: '12-21', name: 'Winter solstice', color: '#a2dbff', labelAt: .38 },
  { date: '03-20', name: 'Equinox', color: '#aaf4d1', labelAt: .50 },
  { date: '06-21', name: 'Summer solstice', color: '#ffb5ce', labelAt: .53 },
];
/** Other places along a path for its name, tried in turn when the first is off screen or covered. */
const NAME_SPOTS = [0, -.12, .12, -.24, .24, -.36, .36];
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
  eye: THREE.Vector3;
  lat: number;
  lon: number;
  groundAtEye: number;
  seaLevel: number;
  exag: number;
  ground(range: number): Promise<GroundRay>;
  /** The public area name for the saved picture. */
  place?: string;
  close(): void;
  savePicture?: (view: SunSeeker, when: Date) => Promise<boolean>;
}

/** A label can sit at one of several points. It keeps its last point while that still fits, so it does not jump. */
interface Label { element: HTMLElement; positions: THREE.Vector3[]; width: number; spot: number }

/** A still view over the game canvas. The existing pause gate owns the simulation. */
export class SunSeeker {
  readonly root = document.createElement('dialog');
  private readonly overlay = new THREE.Scene();
  private readonly paths = new THREE.Group();
  private readonly seasons = new THREE.Group();
  private readonly activePath = new THREE.Group();
  private readonly horizon = new THREE.Group();
  private readonly marker = new THREE.Group();
  private readonly disc = new THREE.Mesh(new THREE.CircleGeometry(1.32, 32),
    new THREE.MeshBasicMaterial({ color: SELECTED, depthTest: false, depthWrite: false, toneMapped: false }));
  private readonly rim = new THREE.Mesh(new THREE.RingGeometry(1.27, 1.65, 32),
    new THREE.MeshBasicMaterial({ color: SELECTED, depthTest: false, depthWrite: false, toneMapped: false }));
  private readonly outline = new THREE.Mesh(new THREE.CircleGeometry(2.02, 32),
    new THREE.MeshBasicMaterial({ color: INK, depthTest: false, depthWrite: false, toneMapped: false, transparent: true, opacity: .92 }));
  private readonly labels: HTMLElement;
  private readonly date: HTMLInputElement;
  private readonly time: HTMLInputElement;
  private readonly slider: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly readings: HTMLElement;
  private readonly bearing: HTMLElement;
  private readonly timesPanel: HTMLDetailsElement;
  private readonly oldCamera: { position: THREE.Vector3; rotation: THREE.Euler; fov: number };
  private readonly seasonLabels: Label[] = [];
  private readonly activeLabels: Label[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly today: string;
  private readonly creditObserver: ResizeObserver | null = null;
  private hills: HillLine | null = null;
  private groundStatus = 'Loading hill line';
  private clockNote = '';
  private validClock = true;
  private selected: SunViewLight;
  private pathDate = '';
  private year = '';
  private yaw = -Math.PI;
  private pitch = .38;
  private dirty = true;
  private compact: boolean | undefined;

  constructor(private readonly options: SunSeekerOptions) {
    const { camera, eye, lat, lon } = options;
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
          <label><span>Halifax time · 24-hour</span><input aria-label="Sun time" type="text" maxlength="5" placeholder="HH:mm" autocomplete="off" required></label>
        </div>
        <input aria-label="Adjust sun time" type="range" min="0" max="1439" step="1">
        <div class="sunActions">
          <button type="button" class="sunFace">Face sun</button>
          <button type="button" class="sunSave">Save picture</button>
          <small>Drag<span class="sunArrowHint"> or use arrows</span></small>
        </div>
        <small class="sunSaveStatus" aria-live="polite"></small>
        <p role="status"></p>
      </section>
      <details class="sunPanel sunReadings" aria-label="Sun events and hill line">
        <summary class="sunSummary"></summary>
        <ul class="sunLegend">
          ${SEASONS.map(({ name, color }) => `<li style="--path:${color}"><i></i>${name}</li>`).join('')}
          <li style="--path:${SELECTED}"><i></i><span class="sunDayName"></span></li>
          <li style="--path:${HILLS}"><i></i>Hill line</li>
        </ul>
        <table aria-label="Halifax sun times">
          <thead><tr><th scope="col">Halifax</th><th scope="col">Flat horizon</th><th scope="col">Over hills</th></tr></thead>
          <tbody></tbody>
        </table>
        <p class="sunNoon"></p>
        <small>Bare ground within 6 km (no trees or buildings). Times use real heights.</small>
      </details>`;
    this.labels = this.root.querySelector('.sunLabels')!;
    this.date = this.root.querySelector('[type=date]')!;
    this.time = this.root.querySelector('[aria-label="Sun time"]')!;
    this.slider = this.root.querySelector('[type=range]')!;
    this.status = this.root.querySelector('.sunClock p')!;
    this.readings = this.root.querySelector('tbody')!;
    this.bearing = this.root.querySelector('.sunBearing')!;
    this.timesPanel = this.root.querySelector('.sunReadings')!;

    this.date.value = today;
    this.time.value = localTime(now);
    this.syncSlider();
    this.updateDay();
    this.updateMarker();

    camera.position.copy(eye);
    this.paths.position.copy(eye);
    this.outline.renderOrder = 32;
    for (const part of [this.disc, this.rim]) {
      part.material.transparent = true;
      part.renderOrder = 33;
    }
    this.marker.add(this.outline, this.disc, this.rim);
    this.paths.add(this.seasons, this.activePath, this.horizon, this.marker);
    this.overlay.add(this.paths);
    this.lookSize();
    this.bindControls();
    document.body.append(this.root);
    this.root.showModal();
    this.syncCreditSpace();
    const credit = document.getElementById('credit');
    if (credit && typeof ResizeObserver !== 'undefined') {
      this.creditObserver = new ResizeObserver(() => {
        this.syncCreditSpace();
        this.invalidate();
      });
      this.creditObserver.observe(credit);
    }
    void options.ground(HILL_RANGE).then(rays => {
      if (!this.root.open) return;
      const { eye, groundAtEye, seaLevel, exag } = options;
      const eyeHeight = trueEyeHeight(eye.y, groundAtEye, exag, seaLevel);
      this.hills = sampleHillLine({ x: eye.x, y: eyeHeight, z: eye.z }, seaLevel, rays);
      this.groundStatus = '';
      this.buildHorizon(sampleHillLine(eye, seaLevel, rays, exag));
      this.updateDay();
      this.updateMarker();
      this.invalidate();
    }, error => {
      if (!this.root.open) return;
      this.groundStatus = 'Hill line unavailable';
      this.updateMarker();
      console.warn('Sun Seeker ground survey failed.', error);
    });
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
    const save = this.root.querySelector<HTMLButtonElement>('.sunSave')!;
    const saveStatus = this.root.querySelector('.sunSaveStatus')!;
    save.hidden = !savePicture;
    if (savePicture) save.addEventListener('click', async () => {
      save.disabled = true;
      saveStatus.textContent = '';
      try {
        if (await savePicture(this, this.selected.when)) saveStatus.textContent = 'Picture saved';
      } catch {
        saveStatus.textContent = 'Could not save picture';
      } finally {
        save.disabled = false;
        this.invalidate();
      }
    });

    const change = () => {
      this.validClock = validStudyDate(this.date.value) && validTime(this.time.value);
      if (this.validClock) {
        const { when, adjustment } = halifaxTime(this.date.value, this.time.value);
        const { lat, lon } = this.options;
        this.selected = { when, sun: sunAngles(when, lat, lon), lat, lon };
        this.clockNote = adjustment === 'gap' ? 'Clock moved forward' : adjustment === 'fold' ? 'First occurrence' : '';
        this.syncSlider();
        if (this.date.value !== this.pathDate) this.updateDay();
        this.invalidate();
      }
      this.updateMarker();
    };
    this.date.addEventListener('change', change);
    this.time.addEventListener('input', change);
    this.time.addEventListener('change', change);
    this.slider.addEventListener('input', () => {
      const minutes = +this.slider.value;
      this.time.value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      change();
    });
    this.timesPanel.addEventListener('toggle', () => this.invalidate());

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
    const clearPointer = (event: PointerEvent) => { if (pointer?.id === event.pointerId) pointer = null; };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) look.addEventListener(event, clearPointer);
  }

  private syncSlider(): void {
    const [hours, minutes] = this.time.value.split(':').map(Number);
    this.slider.value = String(hours * 60 + minutes);
    this.slider.setAttribute('aria-valuetext', this.time.value);
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
    this.options.camera.fov = this.options.camera.aspect < .85 ? 110 : 76;
    this.options.camera.updateProjectionMatrix();
    const compact = matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)').matches;
    if (this.timesPanel.classList.toggle('compact', compact) !== this.compact) {
      this.compact = compact;
      this.timesPanel.open = !compact;
    }
    this.syncCreditSpace();
    this.aim();
  }

  /** Keep the times panel above the live map credit chip on every width and orientation. */
  private syncCreditSpace(): void {
    const creditBox = document.getElementById('credit')?.getBoundingClientRect();
    const rootBottom = this.root.getBoundingClientRect().bottom || innerHeight;
    if (creditBox && creditBox.height > 0 && rootBottom > 0) {
      this.root.style.setProperty('--sun-credit-space', `${Math.max(12, Math.ceil(rootBottom - creditBox.top + 8))}px`);
    } else {
      this.root.style.removeProperty('--sun-credit-space');
    }
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

  /** Coalesce pointer moves, input changes and resize events into one paint. */
  takeDraw(): SunViewLight | null {
    if (!this.dirty) return null;
    this.dirty = false;
    return this.selected;
  }

  /** Draw after the game's finish pass so glare cannot wash out the paths. */
  drawOverlay(renderer: THREE.WebGLRenderer): void {
    const { camera } = this.options;
    this.marker.quaternion.copy(camera.quaternion);
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    try { renderer.render(this.overlay, camera); }
    finally { renderer.autoClear = clear; }
    this.projectLabels();
  }

  /** Add the on-screen labels and readings to the PNG without the interactive controls. */
  drawPictureOverlay(context: CanvasRenderingContext2D, width: number, height: number): void {
    const rect = this.root.getBoundingClientRect();
    const path = (x: number, y: number, w: number, h: number, radius: number) => {
      context.beginPath();
      context.roundRect(x, y, w, h, radius);
    };
    const plaque = (element: HTMLElement) => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      path(box.x, box.y, box.width, box.height, parseFloat(style.borderTopLeftRadius));
      context.fillStyle = style.backgroundColor;
      context.fill();
      if (parseFloat(style.borderTopWidth)) {
        context.strokeStyle = style.borderTopColor;
        context.stroke();
      }
    };
    // Layout the words where the browser put them, including wrapped text and selected hour labels.
    const range = document.createRange();
    const paintText = (element: HTMLElement) => {
      const words = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = words.nextNode(); node; node = words.nextNode()) {
        const style = getComputedStyle(node.parentElement!);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        context.fillStyle = style.color;
        for (const match of node.textContent!.matchAll(/\S+/g)) {
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const box = range.getBoundingClientRect();
          if (box.width) context.fillText(match[0], box.left, box.top + box.height / 2);
        }
      }
    };

    const overlaps = (a: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>, b: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>) =>
      a.right >= b.left && a.left <= b.right && a.bottom >= b.top && a.top <= b.bottom;

    context.save();
    try {
      context.scale(width / rect.width, height / rect.height);
      context.translate(-rect.left, -rect.top);
      context.textBaseline = 'middle';

      // Say where, when and which way the picture looks. Two lines when one would not fit a phone; shrink on narrow screens.
      const when = this.selected.when, place = this.options.place;
      const first = `Sun Seeker${place ? ` · ${place}` : ''}`;
      const second = `${localDate(when)} · ${localTime(when)} ${localZone(when)} · facing ${this.bearing.textContent!.replace(/\s+/, ' ')}`;
      const clock = this.root.querySelector('.sunClock')!.getBoundingClientRect();
      const readings = this.timesPanel.getBoundingClientRect();
      const leftMargin = Math.max(0, clock.left - rect.left);
      const rightMargin = Math.max(leftMargin, rect.right - readings.right);
      const room = Math.max(120, rect.width - leftMargin - rightMargin);
      let captionSize = 13;
      context.font = `600 ${captionSize}px system-ui, sans-serif`;
      const lines = context.measureText(`${first} · ${second}`).width + 20 <= room ? [`${first} · ${second}`] : [first, second];
      let widest = Math.max(...lines.map(line => context.measureText(line).width));
      if (widest + 20 > room) {
        captionSize = Math.max(9.5, Math.floor(captionSize * (room - 20) / widest * 2) / 2);
        context.font = `600 ${captionSize}px system-ui, sans-serif`;
        widest = Math.max(...lines.map(line => context.measureText(line).width));
      }
      const lineStep = Math.ceil(captionSize * 1.38);
      const captionW = Math.min(room, widest + 20);
      const captionH = 10 + lineStep * lines.length;
      const captionBox = { left: clock.left, top: clock.top, right: clock.left + captionW, bottom: clock.top + captionH };

      for (const { element } of [...this.activeLabels, ...this.seasonLabels]) {
        if (element.hidden || overlaps(element.getBoundingClientRect(), captionBox)) continue;
        plaque(element);
        paintText(element);
      }
      plaque(this.timesPanel);
      if (this.timesPanel.open) {
        for (const swatch of this.timesPanel.querySelectorAll('i')) {
          const box = swatch.getBoundingClientRect();
          context.fillStyle = getComputedStyle(swatch).backgroundColor;
          context.fillRect(box.left, box.top, box.width, box.height);
        }
        paintText(this.timesPanel);
      } else paintText(this.timesPanel.querySelector('summary')!);

      context.font = `600 ${captionSize}px system-ui, sans-serif`;
      path(clock.left, clock.top, captionW, captionH, 6);
      context.fillStyle = '#101a24ed';
      context.fill();
      context.fillStyle = '#f9f6ee';
      lines.forEach((line, i) => context.fillText(line, clock.left + 10, clock.top + 5 + lineStep * (i + 0.5), captionW - 20));
    } finally {
      context.restore();
    }
  }

  private projectLabels(): void {
    const { camera } = this.options, width = this.root.clientWidth, height = this.root.clientHeight;
    const taken: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>[] = [...this.root.querySelectorAll('.sunPanel, .sunBearing')].map(el => el.getBoundingClientRect());
    const credit = document.getElementById('credit')?.getBoundingClientRect();
    if (credit && credit.width > 0 && credit.height > 0) taken.push(credit);
    const place = (position: THREE.Vector3, labelWidth: number) => {
      const p = this.scratch.copy(position).applyMatrix4(camera.matrixWorldInverse);
      if (p.z >= 0) return null;
      p.applyMatrix4(camera.projectionMatrix);
      const x = (p.x + 1) * width / 2, y = (1 - p.y) * height / 2;
      const box = { left: x - labelWidth / 2, right: x + labelWidth / 2, top: y - 10, bottom: y + 10 };
      const fits = box.left > 4 && box.right < width - 4 && box.top > 4 && box.bottom < height - 4
        && !taken.some(r => box.right >= r.left && box.left <= r.right && box.bottom >= r.top && box.top <= r.bottom);
      return fits ? { x, y, box } : null;
    };
    for (const label of [...this.activeLabels, ...this.seasonLabels]) {
      const { element, positions } = label;
      let found = place(positions[label.spot], label.width);
      for (let i = 0; !found && i < positions.length; i++) {
        if (i === label.spot) continue;
        found = place(positions[i], label.width);
        if (found) label.spot = i;
      }
      element.hidden = !found;
      if (!found) { label.spot = 0; continue; }
      element.style.left = `${found.x}px`;
      element.style.top = `${found.y}px`;
      taken.push(found.box);
    }
  }

  private label(labels: Label[], text: string, color: string, spots: readonly { az: number; el: number }[], hour = false): void {
    const element = document.createElement('span');
    element.className = hour ? 'sunLabel hour' : 'sunLabel';
    element.textContent = text;
    element.style.setProperty('--path', color);
    const positions = spots.map(({ az, el }) => anglesAt(az, el).add(this.options.eye));
    this.labels.append(element);
    labels.push({ element, positions, width: text.length * 6.6 + 14, spot: 0 });
  }

  /** Name a path just above it, first at its usual point, then nearer each end, then below it. */
  private nameSpots(arc: readonly SunEvent[], at: number): { az: number; el: number }[] {
    const points = NAME_SPOTS.map(offset => arc[Math.round(THREE.MathUtils.clamp(at + offset, .04, .96) * (arc.length - 1))]);
    return [1.6, -1.8].flatMap(lift => points.map(({ az, el }) => ({ az, el: el + lift })));
  }

  private line(group: THREE.Group, points: number[], color: string, width: number, order: number): void {
    const geometry = new LineGeometry().setPositions(points);
    for (const [stroke, size] of [[INK, width + 2.1], [color, width]] as const) {
      const material = new LineMaterial({ color: stroke, linewidth: size, depthTest: false, depthWrite: false, toneMapped: false, transparent: true });
      const line = new Line2(geometry, material);
      line.renderOrder = order + (stroke === color ? .1 : 0);
      group.add(line);
    }
  }

  private buildHorizon(line: HillLine): void {
    this.clear(this.horizon);
    const band: number[] = [], outline: number[] = [];
    for (let i = 0; i < line.length; i++) {
      const j = (i + 1) % line.length, a = line[i], b = line[j];
      if (a === null || b === null) continue;
      for (const [points, half] of [[band, .15], [outline, .28]] as const) {
        const topA = anglesAt(i, a + half), topB = anglesAt(j, b + half), lowA = anglesAt(i, a - half), lowB = anglesAt(j, b - half);
        for (const p of [topA, topB, lowA, topB, lowB, lowA]) points.push(p.x, p.y, p.z);
      }
    }
    for (const [points, color, order] of [[outline, INK, 26], [band, HILLS, 27]] as const) {
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide,
        depthTest: false, depthWrite: false, transparent: true, opacity: .78, toneMapped: false }));
      mesh.renderOrder = order;
      this.horizon.add(mesh);
    }
  }

  private updateDay(): void {
    const { lat, lon } = this.options, date = validStudyDate(this.date.value) && this.validClock ? this.date.value : this.pathDate;
    this.pathDate = date;
    const year = date.slice(0, 4);
    if (year !== this.year) {
      this.year = year;
      this.clear(this.seasons, this.seasonLabels);
      for (const { date: season, color, name, labelAt } of SEASONS) {
        const arc = sunArc(`${year}-${season}`, lat, lon);
        this.line(this.seasons, arc.flatMap(p => anglesAt(p.az, p.el).toArray()), color, 2, 28);
        this.label(this.seasonLabels, name, color, this.nameSpots(arc, labelAt));
      }
    }
    this.clear(this.activePath, this.activeLabels);
    const day = ephemeris(date, lat, lon), hills = this.hills ? hillSunEvents(date, lat, lon, this.hills) : {};
    const arc = sunArc(date, lat, lon, hills.sunrise?.when, hills.sunset?.when);
    this.line(this.activePath, arc.flatMap(p => anglesAt(p.az, p.el).toArray()), SELECTED, 3.2, 29);
    const name = date === this.today ? 'Today' : 'Selected day';
    this.root.querySelector('.sunDayName')!.textContent = name;

    const ticks: number[] = [];
    for (let hour = 0; hour < 24; hour++) {
      const time = `${String(hour).padStart(2, '0')}:00`, { when, adjustment } = halifaxTime(date, time);
      if (adjustment === 'gap' || when < arc[0].when || when > arc.at(-1)!.when) continue;
      const { az, el } = sunAngles(when, lat, lon);
      ticks.push(...anglesAt(az, el - .56).toArray(), ...anglesAt(az, el + .56).toArray());
      this.label(this.activeLabels, time, SELECTED, [{ az, el: el - 1.8 }], true);
    }
    this.label(this.activeLabels, name, SELECTED, this.nameSpots(arc, .6));
    if (ticks.length) {
      const marks = new LineSegments2(new LineSegmentsGeometry().setPositions(ticks),
        new LineMaterial({ color: SELECTED, linewidth: 2, depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
      marks.renderOrder = 30;
      this.activePath.add(marks);
    }
    this.readings.innerHTML = `
      <tr><th scope="row">Sunrise</th><td>${eventTime(day.sunrise)}</td><td>${eventTime(hills.sunrise)}</td></tr>
      <tr><th scope="row">Sunset</th><td>${eventTime(day.sunset)}</td><td>${eventTime(hills.sunset)}</td></tr>`;
    this.root.querySelector('.sunNoon')!.textContent = `Solar noon ${eventTime(day.highest)} · ${day.highest.el.toFixed(1)}°`;
    const summary = this.root.querySelector('.sunSummary')!;
    summary.textContent = `Rise ${eventTime(hills.sunrise)} · Noon ${eventTime(day.highest)} · Set ${eventTime(hills.sunset)}`;
    summary.setAttribute('aria-label', `Sunrise over hills ${eventTime(hills.sunrise)}, solar noon ${eventTime(day.highest)}, sunset over hills ${eventTime(hills.sunset)}`);
  }

  private updateMarker(): void {
    const { sun, when } = this.selected;
    this.marker.position.copy(anglesAt(sun.az, sun.el));
    const hill = this.hills && hillElevation(this.hills, sun.az);
    const hidden = hill !== null && apparentUpperLimb(sun.el) < hill;
    this.disc.visible = !hidden;
    this.rim.visible = hidden;
    this.status.textContent = this.validClock
      ? [`${localTime(when)} ${localZone(when)} · ${Math.round(sun.az)}° az · ${sun.el.toFixed(1)}° high`,
        hidden ? 'Below hill line' : '', this.clockNote, this.groundStatus].filter(Boolean).join(' · ')
      : 'Choose a date from 1880–2200 and a time from 00:00 to 23:59.';
  }

  private clear(group: THREE.Group, labels: Label[] = []): void {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const object of [...group.children] as (THREE.Mesh<THREE.BufferGeometry, THREE.Material>)[]) {
      geometries.add(object.geometry);
      object.material.dispose();
      object.removeFromParent();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const { element } of labels) element.remove();
    labels.length = 0;
  }

  dispose(): void {
    this.creditObserver?.disconnect();
    this.paths.removeFromParent();
    this.clear(this.seasons, this.seasonLabels);
    this.clear(this.activePath, this.activeLabels);
    this.clear(this.horizon);
    this.clear(this.marker);
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
