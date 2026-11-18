// Instant replay, the replay camera and saved clips (the project brief). The rules live in replay-rules.ts.
//
// The recorder only reads the ride and its drawn rig; it never writes to them while the game runs. The replay runs
// inside the paused frame: it poses the rig from the recording, moves the camera, and on close puts the rig, its lamps
// and the camera back exactly as they were, so the next live frame carries on from the real state.
// Version 1 limit: the replay moves the ride over the world as it is now (a mailbox that fell stays down; a trailer,
// which cannot follow, is hidden while the replay shows).
import * as THREE from 'three';
import type { Rig } from './vehicle-spec';
import {
  ReplayRecorder, poseAt, emptyFrame, emptyShot, replayCamera, slowMoment, playbackRate, startTime, clipRange,
  clipType, clipCaption, clipName, clipSize, clockText, rideCode, skipGap, CLIP, type ReplayMark,
} from './replay-rules';

/** What the recorder reads from the driven ride (a Vehicle, a BikeRide or a horse). */
export interface Ridden {
  x: number; y: number; z: number; vx: number; vz: number; vy: number;
  speed: number; steerAngle: number; airborne: boolean;
  /** A bike's seconds into a crash. */
  crashTime?: number;
}
export interface ReplayHost {
  canvas: HTMLCanvasElement;
  camera: THREE.PerspectiveCamera;
  ground(x: number, z: number): number | null;
  /** The least height the replay camera may take: the ground, raised through tree canopy. */
  floor(x: number, z: number): number | null;
  wheelRadius(): number;
  /** Drawn parts that cannot follow the recording (a towed trailer): hidden while the replay shows. */
  hide(): THREE.Object3D[];
  brand: 'mail' | 'just';
  phone: boolean;
  /** Called after the replay closed and put everything back. */
  closed(): void;
}

const CSS = `
body.replaying> :not(canvas):not(#replayPanel):not(style):not(script){visibility:hidden!important}
body.replaying #replayPanel{visibility:visible!important}
#replayPanel{position:fixed;left:0;right:0;bottom:0;z-index:10001;box-sizing:border-box;color:#eef2f6;font:15px/1.3 system-ui,-apple-system,sans-serif;
 padding:28px max(16px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));
 background:linear-gradient(transparent,rgba(8,14,20,.86) 34%);touch-action:none;user-select:none;-webkit-user-select:none}
#replayPanel[hidden]{display:none}
#replayPanel .replayTag{position:fixed;top:max(12px,env(safe-area-inset-top,0px));left:max(16px,env(safe-area-inset-left,0px));margin:0;
 font:700 12px ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:.15em;background:#0c141cd9;border:1px solid #69747c;border-radius:5px;padding:7px 10px}
#replayPanel .replayRow{display:flex;gap:10px;align-items:center;max-width:920px;margin:0 auto}
#replayPanel .replayRow+.replayRow{margin-top:10px}
#replayPanel .replayRow[hidden]{display:none}
#replayPanel button,#replayPanel a{box-sizing:border-box;min-height:48px;min-width:48px;padding:0 16px;border:1px solid #9ba6ae;border-radius:7px;
 background:#253440;color:#fff;font:600 15px system-ui,-apple-system,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
#replayPanel button[aria-pressed="true"]{background:#ad4d23;border-color:#e5a16c}
#replayPanel button:focus-visible,#replayPanel a:focus-visible,#replayScrub:focus-visible{outline:3px solid #fff;outline-offset:2px}
#replayPanel .replayButtons>*{flex:1 1 0}
#replayPlay{flex:none;width:84px}
#replayScrub{flex:1;min-width:0;height:48px;margin:0;accent-color:#d0632e;touch-action:pan-x}
#replayTime{flex:none;font:13px ui-monospace,"SF Mono",Menlo,monospace;min-width:4.6em;text-align:right}
#replayStatus{flex:1 1 100%;margin:0;color:#cbd2d8}
#endingReplay{display:block;width:100%;min-height:48px;margin-top:10px;border:1px solid #9ba6ae;border-radius:7px;background:none;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}
#reportReplay{width:100%;min-height:48px;margin-top:8px;background:none;color:inherit;border:1px solid #9ba6ae;border-radius:6px;font:600 15px system-ui,sans-serif;cursor:pointer}
@media(max-height:440px){#replayPanel{padding-top:16px}#replayPanel .replayRow+.replayRow{margin-top:6px}}
`;

interface Saved { object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; visible: boolean }
type Material = THREE.MeshStandardMaterial;
const intensity = (mesh: THREE.Mesh | undefined): number => {
  const m = mesh?.material as Material | undefined;
  return m && typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : -1;
};
const setIntensity = (mesh: THREE.Mesh | undefined, value: number): void => {
  const m = mesh?.material as Material | undefined;
  if (m && value >= 0 && typeof m.emissiveIntensity === 'number') m.emissiveIntensity = value;
};

/** True where this browser can record the picture: the button is hidden elsewhere and the replay still works. */
export function clipSupport(): { type: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return clipType(type => MediaRecorder.isTypeSupported(type));
}

export class Replay {
  readonly recorder = new ReplayRecorder();
  active = false;
  /** Replay time, in the recording's seconds. */
  t = 0;
  playing = false;
  slow = false;
  from = 0;
  to = 0;
  moment: ReplayMark | null = null;
  /** Read by the browser check: the camera rule in use for the last drawn replay frame. */
  shotKind: 'chase' | 'orbit' = 'chase';
  readonly panel = document.createElement('div');
  private readonly sample = emptyFrame();
  private readonly pose = emptyFrame();
  private readonly a = emptyFrame();
  private readonly b = emptyFrame();
  private readonly shot = emptyShot();
  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private snap = true;
  private lastNow: number | null = null;
  private spin = 0;
  private rig: Rig | null = null;
  private saved: Saved[] = [];
  private lamps: { brake: number[]; beacon: number } = { brake: [], beacon: -1 };
  private cameraSaved: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number } | null = null;
  private restorePose: (() => void) | null = null;
  private shownTime = -1;
  private scrubbing = false;
  private readonly play: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly time: HTMLSpanElement;
  private readonly slowButton: HTMLButtonElement;
  private readonly save: HTMLButtonElement;
  private readonly controls: HTMLElement[];
  private readonly clipRow: HTMLElement;
  private readonly status: HTMLParagraphElement;
  private readonly clipButtons: HTMLElement;
  readonly clipFormat = clipSupport();
  private clip: {
    recorder: MediaRecorder; stream: MediaStream; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
    chunks: Blob[]; start: number; end: number; cancelled: boolean; caption: string;
  } | null = null;
  private clipUrl: string | null = null;

  constructor(private readonly host: ReplayHost) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    const p = this.panel;
    p.id = 'replayPanel'; p.hidden = true;
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Replay');
    p.innerHTML = `<p class="replayTag" aria-hidden="true">REPLAY</p>
<div class="replayRow" data-replay="controls"><button id="replayPlay" type="button">Pause</button>
<input id="replayScrub" type="range" min="0" max="1" step="0.01" value="0" aria-label="Replay time. Left and right arrows">
<span id="replayTime" aria-live="off">0.0 s</span></div>
<div class="replayRow replayButtons" data-replay="controls"><button id="replaySlow" type="button" aria-pressed="false">Slow motion</button>
<button id="replaySave" type="button">Save clip</button><button id="replayClose" type="button">Close</button></div>
<div class="replayRow replayButtons" id="replayClip" hidden><p id="replayStatus" role="status"></p></div>
<div class="replayRow replayButtons" id="replayClipButtons" hidden></div>`;
    const q = <T extends HTMLElement>(id: string) => p.querySelector<T>('#' + id)!;
    this.play = q('replayPlay'); this.scrub = q<HTMLInputElement>('replayScrub'); this.time = q('replayTime');
    this.slowButton = q('replaySlow'); this.save = q('replaySave');
    this.controls = [...p.querySelectorAll<HTMLElement>('[data-replay="controls"]')];
    this.clipRow = q('replayClip'); this.status = q<HTMLParagraphElement>('replayStatus'); this.clipButtons = q('replayClipButtons');
    this.save.hidden = !this.clipFormat;
    this.play.addEventListener('click', () => this.toggle());
    this.slowButton.addEventListener('click', () => this.setSlow(!this.slow));
    this.save.addEventListener('click', () => this.startClip());
    q('replayClose').addEventListener('click', () => this.close());
    this.scrub.addEventListener('input', () => { this.playing = false; this.seek(this.from + Number(this.scrub.value)); this.syncButtons(); });
    // While a finger or the mouse holds the scrubber, the frame loop leaves its value alone.
    this.scrub.addEventListener('pointerdown', () => { this.scrubbing = true; });
    for (const end of ['pointerup', 'pointercancel', 'change', 'blur']) this.scrub.addEventListener(end, () => { this.scrubbing = false; });
    // The panel owns its pointer input: nothing reaches the pedals, the map or the picture underneath.
    for (const event of ['pointerdown', 'pointerup', 'pointermove', 'wheel']) p.addEventListener(event, ev => ev.stopPropagation());
    document.body.appendChild(p);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.clip) this.cancelClip('The clip stopped when the game was hidden.'); });
  }

  /** Every drawn frame in which the ride really moved under the clock. Reads only; allocates nothing. */
  record(ride: Ridden, rig: Rig, kind: string, seconds: number, dt: number, quiet: (x: number, z: number) => boolean): void {
    if (this.active) return;
    const f = this.sample, root = rig.root, body = rig.body;
    f.t = seconds; f.kind = rideCode(kind);
    f.x = root.position.x; f.y = root.position.y; f.z = root.position.z;
    f.pitch = root.rotation.x; f.yaw = root.rotation.y; f.roll = root.rotation.z;
    f.bodyPitch = body.rotation.x; f.bodyRoll = body.rotation.z; f.bodyLift = body.position.y;
    f.steer = ride.steerAngle; f.speed = ride.speed; f.vx = ride.vx; f.vz = ride.vz; f.airborne = ride.airborne; f.crash = ride.crashTime ?? 0;
    f.air = ride.airborne ? Math.max(0, ride.y - (this.host.ground(ride.x, ride.z) ?? ride.y)) : 0;
    f.brake = intensity(rig.brakeLights[0]); f.beacon = intensity(rig.beacon);
    this.recorder.observe(f, ride.vy, dt, ride, quiet);
  }

  /** The newest unbroken recording is long enough to watch. */
  get available(): boolean { return this.recorder.span() !== null; }

  open(rig: Rig): boolean {
    if (this.active) return true;
    const span = this.recorder.span();
    if (!span) return false;
    this.from = span.from; this.to = span.to;
    this.moment = slowMoment(this.recorder.marks, span.from, span.to);
    this.rig = rig;
    this.capture(rig);
    this.t = skipGap(this.recorder.buffer, startTime(this.from, this.to, this.moment));
    this.playing = true; this.slow = false; this.snap = true; this.lastNow = null; this.spin = 0; this.shownTime = -1;
    this.scrub.max = String(Math.max(0.01, this.to - this.from));
    this.active = true;
    this.showClip(null);
    this.panel.hidden = false; this.panel.inert = false;
    document.body.classList.add('replaying');
    this.syncButtons();
    this.play.focus({ preventScroll: true });
    return true;
  }

  close(): void {
    if (!this.active) return;
    if (this.clip) this.cancelClip(null);
    // A hidden focused control would still own the next Space (the brake): let it go, as the end cards do.
    if (document.activeElement instanceof HTMLElement && this.panel.contains(document.activeElement)) document.activeElement.blur();
    this.release();
    this.active = false; this.playing = false;
    this.panel.hidden = true;
    document.body.classList.remove('replaying');
    if (this.clipUrl) { const url = this.clipUrl; this.clipUrl = null; setTimeout(() => URL.revokeObjectURL(url), 60000); }
    this.host.closed();
  }

  /** One paused frame while the replay shows: advance, pose the rig, place the camera. The caller then draws. */
  frame(now: number): void {
    if (!this.active || !this.rig) return;
    const wall = this.lastNow === null ? 0 : Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    let dt = 0;
    if (this.playing) {
      dt = wall * playbackRate(this.t, this.moment, this.slow && !this.clip);
      this.t = skipGap(this.recorder.buffer, Math.min(this.to, this.t + dt));
      if (this.clip && this.t >= this.clip.end) this.finishClip();
      else if (this.t >= this.to) { this.playing = false; this.syncButtons(); }
    }
    const run = this.pose.segment;
    const p = poseAt(this.recorder.buffer, this.t, this.pose, this.a, this.b);
    if (p.segment !== run) this.snap = true;   // a cut between runs (a reset after a crash): the camera cuts too
    this.apply(this.rig, dt);
    const camera = this.host.camera;
    replayCamera(p, this.moment, THREE.MathUtils.degToRad(camera.fov), camera.aspect, this.floor, this.shot);
    this.shotKind = this.shot.kind;
    const k = this.snap ? 1 : 1 - Math.exp(-4 * dt);
    this.camPos.lerp(this.target(this.shot.x, this.shot.y, this.shot.z), k);
    this.camLook.lerp(this.target(this.shot.lookX, this.shot.lookY, this.shot.lookZ), k);
    this.snap = false;
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    camera.updateMatrixWorld();
    const shown = Math.round((this.t - this.from) * 20) / 20;
    if (shown !== this.shownTime) {
      this.shownTime = shown;
      if (!this.scrubbing) this.scrub.value = String(shown);
      this.time.textContent = clockText(this.t - this.from);
      if (this.clip) this.status.textContent = `Saving clip… ${Math.round(100 * Math.min(1, (this.t - this.clip.start) / Math.max(0.01, this.clip.end - this.clip.start)))}%`;
    }
  }

  /** After the frame is drawn: copy it, with the caption, into the clip being recorded. */
  afterRender(): void {
    const clip = this.clip;
    if (!clip) return;
    const { ctx, canvas } = clip, w = canvas.width, h = canvas.height;
    ctx.drawImage(this.host.canvas, 0, 0, w, h);
    const size = Math.max(12, Math.round(h * 0.034)), pad = Math.round(size * 0.9);
    ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = 'rgba(0,0,0,.75)'; ctx.shadowBlur = Math.round(size * 0.35);
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.fillText(clip.caption, pad, h - pad);
    ctx.shadowBlur = 0;
  }

  /** Keys while the replay shows. Returns true when the key belonged to the replay. */
  key(ev: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;   // browser shortcuts (reload, find, zoom) keep working
    const target = ev.target instanceof HTMLElement ? ev.target : null;
    const onControl = !!target && this.panel.contains(target) && !!target.closest('button, a');
    if (ev.code === 'Tab') return false;   // the browser moves the focus between the replay's controls
    if (onControl && (ev.code === 'Enter' || ev.code === 'Space')) return false;   // the focused control answers
    const arrow = ev.code === 'ArrowLeft' || ev.code === 'ArrowRight';
    const mine = arrow || ['Escape', 'KeyI', 'KeyP', 'Space', 'KeyK', 'KeyS'].includes(ev.code);
    if (!mine) return false;   // F5, F11 and the rest keep their browser meaning (the game still never sees them)
    ev.preventDefault();   // also on the focused scrubber: arrows step whole seconds, Space plays
    if (ev.repeat && !arrow) return true;
    if (this.clip) { if (ev.code === 'Escape') this.cancelClip('Clip cancelled.'); return true; }
    if (ev.code === 'Escape' || ev.code === 'KeyI' || ev.code === 'KeyP') this.close();
    else if (ev.code === 'Space' || ev.code === 'KeyK') this.toggle();
    else if (ev.code === 'KeyS') this.setSlow(!this.slow);
    else { this.playing = false; this.seek(this.t + (ev.code === 'ArrowLeft' ? -1 : 1) * (ev.shiftKey ? 5 : 1)); this.syncButtons(); }
    return true;
  }

  seek(t: number): void {
    this.t = Math.min(this.to, Math.max(this.from, t));
    this.snap = true; this.shownTime = -1;
  }

  toggle(): void {
    if (!this.active || this.clip) return;
    if (!this.playing && this.t >= this.to - 1e-3) this.seek(this.from);
    this.playing = !this.playing; this.lastNow = null;
    this.syncButtons();
  }

  setSlow(on: boolean): void { this.slow = on; this.syncButtons(); }

  private syncButtons(): void {
    this.play.textContent = this.playing ? 'Pause' : 'Play';
    this.play.setAttribute('aria-label', `${this.playing ? 'Pause' : 'Play'} replay. Space`);
    this.slowButton.setAttribute('aria-pressed', String(this.slow));
    this.slowButton.setAttribute('aria-label', 'Slow motion. S');
  }

  private readonly floor = (x: number, z: number): number | null => this.host.floor(x, z);
  private readonly groundAt = (x: number, z: number): number | null => this.host.ground(x, z);
  private target(x: number, y: number, z: number): THREE.Vector3 { return this.scratch.set(x, y, z); }
  private readonly scratch = new THREE.Vector3();

  private capture(rig: Rig): void {
    // Every node of the rig (body, wheels, the bike's and the horse's bones, the rider): all of it comes back on close.
    const keep = (object: THREE.Object3D): Saved => ({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible });
    this.saved = [];
    rig.root.traverse(object => { this.saved.push(keep(object)); });
    for (const object of this.host.hide()) if (!this.saved.some(s => s.object === object)) { this.saved.push(keep(object)); object.visible = false; }
    this.lamps = { brake: rig.brakeLights.map(m => intensity(m)), beacon: intensity(rig.beacon) };
    this.restorePose = rig.checkpointPose?.() ?? null;
    const c = this.host.camera;
    this.cameraSaved = { position: c.position.clone(), quaternion: c.quaternion.clone(), fov: c.fov };
    if (c.fov !== 50) { c.fov = 50; c.updateProjectionMatrix(); }
  }

  private release(): void {
    const rig = this.rig;
    rig?.resetPose?.();   // an animated rig (the horse) drops the gait state the replay left; its nodes come back below
    this.restorePose?.(); this.restorePose = null;
    for (const s of this.saved) { s.object.position.copy(s.position); s.object.quaternion.copy(s.quaternion); s.object.scale.copy(s.scale); s.object.visible = s.visible; }
    this.saved = [];
    if (rig) {
      rig.brakeLights.forEach((m, i) => setIntensity(m, this.lamps.brake[i] ?? -1));
      setIntensity(rig.beacon, this.lamps.beacon);
      rig.root.updateMatrixWorld(true);
    }
    const c = this.host.camera, s = this.cameraSaved;
    if (s) { c.position.copy(s.position); c.quaternion.copy(s.quaternion); c.fov = s.fov; c.updateProjectionMatrix(); c.updateMatrixWorld(); }
    this.cameraSaved = null; this.rig = null;
  }

  private apply(rig: Rig, dt: number): void {
    const p = this.pose;
    rig.root.position.set(p.x, p.y, p.z);
    rig.root.rotation.set(p.pitch, p.yaw, p.roll, 'YXZ');
    // An animated rig (the horse) moves its own body with its gait from the speed; the recorded body already holds
    // that gait, so it is applied only to rigs without one.
    if (!rig.animate) { rig.body.rotation.set(p.bodyPitch, 0, p.bodyRoll); rig.body.position.y = p.bodyLift; }
    this.spin += p.speed / Math.max(0.1, this.host.wheelRadius()) * dt;
    const bike = rig as Rig & { pose?: (pose: { steer: number; spin: number; front: number; rear: number; stand: number; foot: number; dive: number; crash: number; ground: number; pitch: number; roll: number }) => void };
    if (typeof bike.pose === 'function') {
      bike.pose({ steer: p.steer, spin: this.spin, front: 0, rear: 0, stand: 0, foot: !p.airborne && Math.abs(p.speed) < 1 ? 1 : 0, dive: 0, crash: p.crash, ground: p.y - p.air, pitch: p.pitch, roll: p.roll });
    } else {
      rig.steer.fl.rotation.y = rig.steer.fr.rotation.y = -p.steer;
      rig.wheels.fl.rotation.x = rig.wheels.fr.rotation.x = rig.wheels.rl.rotation.x = rig.wheels.rr.rotation.x = -this.spin;
      if (rig.extraWheels) for (const w of rig.extraWheels) w.rotation.x = -this.spin;
      if (rig.setTravel) { const t = p.airborne ? -0.18 : 0; rig.setTravel(t, t, t, t); }
    }
    rig.animate?.(dt, p.speed, this.groundAt);
    if (p.brake >= 0) for (const m of rig.brakeLights) setIntensity(m, p.brake);
    if (p.beacon >= 0) setIntensity(rig.beacon, p.beacon);
  }

  // ---- clips ----------------------------------------------------------------------------------------------------
  private startClip(): void {
    const format = this.clipFormat;
    if (!this.active || this.clip || !format) return;
    const range = clipRange(this.from, this.to, this.moment);
    const size = clipSize(this.host.canvas.width, this.host.canvas.height, this.host.phone);
    const canvas = Object.assign(document.createElement('canvas'), size);
    const ctx = canvas.getContext('2d');
    if (!ctx) { this.showClip('This browser cannot save a clip. The replay still works.'); return; }
    let stream: MediaStream, recorder: MediaRecorder;
    try {
      stream = canvas.captureStream(CLIP.fps);
      recorder = new MediaRecorder(stream, { mimeType: format.type, videoBitsPerSecond: this.host.phone ? 3_000_000 : 6_000_000 });
    } catch (error) {
      console.warn('replay clip', error);
      this.showClip('This browser cannot save a clip. The replay still works.');
      return;
    }
    const clip = { recorder, stream, canvas, ctx, chunks: [] as Blob[], start: range.start, end: range.end, cancelled: false, caption: clipCaption(this.host.brand) };
    this.clip = clip;
    recorder.ondataavailable = ev => { if (ev.data.size) clip.chunks.push(ev.data); };
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      if (clip.cancelled) return;
      const file = new File(clip.chunks, clipName(new Date(), format.ext, this.host.brand), { type: format.type.split(';')[0] });
      this.clipReady(file);
    };
    this.seek(range.start);
    this.playing = true; this.lastNow = null;
    // The next drawn frame is the first one copied (a WebGL picture can only be read in the frame that drew it).
    recorder.start(500);
    this.showClip('Saving clip… 0%');
    this.syncButtons();
  }

  private finishClip(): void {
    const clip = this.clip;
    if (!clip) return;
    this.playing = false;
    this.clip = null;
    if (clip.recorder.state !== 'inactive') clip.recorder.stop();
    this.showClip('Finishing the clip…');
    this.syncButtons();
  }

  private cancelClip(message: string | null): void {
    const clip = this.clip;
    if (!clip) return;
    clip.cancelled = true; this.clip = null; this.playing = false;
    if (clip.recorder.state !== 'inactive') clip.recorder.stop(); else for (const track of clip.stream.getTracks()) track.stop();
    this.showClip(message);
    this.syncButtons();
  }

  private clipReady(file: File): void {
    if (!this.active) return;
    if (this.clipUrl) URL.revokeObjectURL(this.clipUrl);
    this.clipUrl = URL.createObjectURL(file);
    this.lastClip = file;
    const download = Object.assign(document.createElement('a'), { href: this.clipUrl, download: file.name, textContent: 'Download clip', id: 'replayDownload' });
    const share = this.host.phone && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    if (share) {
      const button = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Share clip', id: 'replayShare' });
      // Sharing needs a fresh tap: the recording took longer than the browser keeps the tap that started it.
      button.addEventListener('click', () => { navigator.share({ files: [file] }).catch(error => { if ((error as Error)?.name !== 'AbortError') console.warn('replay share', error); }); });
      this.showClip('Your clip is ready.', [button, download]);
      button.focus();
    } else {
      this.showClip('Your clip is ready.', [download]);
      download.click();   // a desktop saves at once; the link stays for a second copy
    }
  }
  /** The newest saved clip, for the browser check. */
  lastClip: File | null = null;

  private showClip(message: string | null, extra: HTMLElement[] = []): void {
    const recording = !!this.clip, clipView = message !== null || recording;
    for (const row of this.controls) row.hidden = clipView;
    this.clipRow.hidden = !clipView;
    if (message !== null) this.status.textContent = message;
    this.clipButtons.replaceChildren(...extra);
    if (recording) {
      const cancel = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Cancel', id: 'replayCancel' });
      cancel.addEventListener('click', () => this.cancelClip('Clip cancelled.'));
      this.clipButtons.append(cancel);
    } else if (message !== null) {
      const back = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Back to replay', id: 'replayBack' });
      back.addEventListener('click', () => { this.showClip(null); this.play.focus(); });
      this.clipButtons.append(back);
    }
    this.clipButtons.hidden = !clipView;
  }
}
