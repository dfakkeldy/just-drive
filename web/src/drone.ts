// The camera drone (F, or DRONE on a phone): it lifts off the vehicle's roof, the vehicle stays where it was, and the
// camera follows a little behind it. F again sets it back on the roof at once; R (or RETURN) flies it home first.
// The flying is in drone-rules.ts; this file is the model, the camera and the phone sticks.

import * as THREE from 'three';
import { DRONE, GIMBAL, droneReadout, stepDrone, stepGimbal, wheelSpeed, type DroneCommand, type DroneGround, type DroneState } from './drone-rules';
import type { Building } from './buildings';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Where the camera sits behind the drone, metres along the view and up. */
const BACK = 2.4, UP = 0.55;
/** The take-off climb: the drone rises this far over the roof before the sticks get it. */
const LIFT = 3;

function model(): { group: THREE.Group; rotors: THREE.Mesh[] } {
  // About 0.45 m across the rotors: a small, plain grey camera drone. No maker's name, no badge. The still parts are
  // merged by material (shell, dark parts, two lights); with the four spinning rotor discs that is eight small draws.
  const group = new THREE.Group();
  group.name = 'drone';
  const parts: Record<'shell' | 'dark' | 'green' | 'red', THREE.BufferGeometry[]> = { shell: [], dark: [], green: [], red: [] };
  const put = (kind: keyof typeof parts, g: THREE.BufferGeometry, x: number, y: number, z: number, turn = 0) => {
    if (turn) g.rotateY(turn);
    parts[kind].push(g.translate(x, y, z));
  };
  put('shell', new THREE.BoxGeometry(0.13, 0.06, 0.22), 0, 0, 0);
  put('dark', new THREE.BoxGeometry(0.1, 0.03, 0.15), 0, 0.045, 0);
  const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [sx, sz] of corners) {
    put('shell', new THREE.BoxGeometry(0.02, 0.018, 0.2), sx * 0.085, 0.01, sz * 0.085, Math.atan2(sx, sz));
    put('dark', new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10), sx * 0.155, 0.03, sz * 0.155);
  }
  // The camera under the nose, looking forward (-z), and landing legs so it can stand on a roof.
  put('dark', new THREE.SphereGeometry(0.026, 12, 8), 0, -0.045, -0.1);
  for (const sx of [-1, 1]) {
    put('dark', new THREE.BoxGeometry(0.012, 0.07, 0.012), sx * 0.05, -0.065, 0);
    put('dark', new THREE.BoxGeometry(0.012, 0.012, 0.16), sx * 0.05, -0.1, 0);
  }
  // Small lights: green at the front, red at the back, as model aircraft show which way they face.
  put('green', new THREE.SphereGeometry(0.008, 6, 4), 0, 0, -0.115);
  put('red', new THREE.SphereGeometry(0.008, 6, 4), 0, 0, 0.115);
  const materials = {
    shell: new THREE.MeshStandardMaterial({ color: 0x5c6267, roughness: 0.55, metalness: 0.15 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.7 }),
    green: new THREE.MeshBasicMaterial({ color: 0x3cff6a }), red: new THREE.MeshBasicMaterial({ color: 0xff3b30 }),
  };
  for (const kind of ['shell', 'dark', 'green', 'red'] as const) {
    const g = mergeGeometries(parts[kind]);
    if (!g) throw Error('drone model: ' + kind);
    const mesh = new THREE.Mesh(g, materials[kind]);
    mesh.castShadow = kind === 'shell' || kind === 'dark';
    group.add(mesh);
  }
  // The rotors spin, so each is its own small disc under one shared group (drawn as four, but tiny).
  const blade = new THREE.MeshBasicMaterial({ color: 0x14181a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.CircleGeometry(0.085, 18); disc.rotateX(-Math.PI / 2);
  const rotors = corners.map(([sx, sz]) => { const r = new THREE.Mesh(disc, blade); r.position.set(sx * 0.155, 0.05, sz * 0.155); group.add(r); return r; });
  group.scale.setScalar(1.4);   // a touch larger than life, so it reads from the camera behind it
  group.visible = false;
  return { group, rotors };
}

/** How far under the drone's centre its skids reach (model units times scale). */
export const DRONE_FOOT = 0.106 * 1.4;

interface Roof { x: number; z: number; ux: number; uz: number; half: number; halfWidth: number; round: boolean; top: number }
const NO_ROOFS: Roof[] = [];

/**
 * The roof heights of the drawn buildings, for the drone's floor (the terrain's tree layer is removed under them). Each
 * building counts as its own turned rectangle, a metre larger all round; a tank as its circle. -Infinity off any roof.
 */
export function roofHeights(list: Building[], village: [number, number], exag: number, sea: number): (x: number, z: number) => number {
  const CELL = 48, cells = new Map<number, Roof[]>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (const b of list) {
    const a = b.axisDeg * Math.PI / 180;
    const roof: Roof = { x: b.x - village[0], z: village[1] - b.y, ux: Math.sin(a), uz: -Math.cos(a), half: b.length / 2 + 1, halfWidth: b.width / 2 + 1,
      round: b.shape === 'tank', top: sea + (b.ground - sea) * exag + Math.max(b.ridge, b.eave) };
    const r = Math.hypot(roof.half, roof.halfWidth);
    if (!Number.isFinite(roof.x + roof.z + r + roof.top + roof.ux)) continue;
    for (let i = Math.floor((roof.x - r) / CELL); i <= Math.floor((roof.x + r) / CELL); i++) for (let j = Math.floor((roof.z - r) / CELL); j <= Math.floor((roof.z + r) / CELL); j++) {
      const cell = cells.get(key(i, j));
      if (cell) cell.push(roof); else cells.set(key(i, j), [roof]);
    }
  }
  return (x, z) => {
    let top = -Infinity;
    const cell = cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? NO_ROOFS;
    for (let k = 0; k < cell.length; k++) {
      const b = cell[k];
      if (b.top <= top) continue;
      const dx = x - b.x, dz = z - b.z;
      // Along the ridge (u) and across it (v = u turned a quarter).
      const inside = b.round ? Math.hypot(dx, dz) < b.half : Math.abs(dx * b.ux + dz * b.uz) < b.half && Math.abs(-dx * b.uz + dz * b.ux) < b.halfWidth;
      if (inside) top = b.top;
    }
    return top;
  };
}

export class Drone {
  readonly group: THREE.Group;
  private readonly rotors: THREE.Mesh[];
  readonly state: DroneState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0 };
  active = false;
  /** Flying home by itself (R or RETURN). */
  returning = false;
  maxSpeed: number = DRONE.speed;
  /** The camera's tilt under the drone (radians, negative looks down). */
  pitch = -0.25;
  private readonly tilt = { pitch: 0, rate: 0 };
  private readonly lifted: DroneCommand = { forward: 0, right: 0, up: 0, turn: 0 };
  private readonly pad = { x: 0, y: 0, z: 0 };
  private lift = 0;
  private spin = 0;
  height: number | null = null;
  distance = 0;

  constructor() {
    if (typeof document !== 'undefined') style();
    const m = model();
    this.group = m.group; this.rotors = m.rotors;
  }

  /** Lifts off a roof at (x, roof, z), facing the vehicle's way (`yaw` in the camera's convention). */
  launch(x: number, roof: number, z: number, yaw: number): void {
    document.body.classList.add('droneOn');
    Object.assign(this.state, { x, y: roof + DRONE_FOOT, z, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0 });
    this.active = true; this.returning = false; this.lift = roof + DRONE_FOOT + LIFT; this.pitch = -0.3; this.tilt.rate = 0;
    this.maxSpeed = DRONE.speed;
    this.group.visible = true;
  }

  /** Back on the roof: the drone is put away. */
  stow(): void { this.active = false; this.returning = false; this.group.visible = false; document.body.classList.remove('droneOn'); }

  /**
   * The gimbal for one frame: `tilt` from the held arrow keys (-1 down, 1 up), after `dragged`, the pitch a mouse or
   * finger drag has left. Returns the new pitch.
   */
  gimbal(dt: number, tilt: number, dragged: number): number {
    this.tilt.pitch = Math.min(GIMBAL.max, Math.max(GIMBAL.min, dragged));
    stepGimbal(this.tilt, tilt, dt);
    return this.pitch = this.tilt.pitch;
  }

  wheel(deltaY: number): void { this.maxSpeed = wheelSpeed(this.maxSpeed, deltaY); }

  /** Starts the flight home, or, if it is already on its way, lands it at once (returns true then). */
  callHome(): boolean {
    if (this.returning) return true;
    this.returning = true;
    return false;
  }

  /**
   * One frame. `roof` is the landing spot on the vehicle. Returns true when the return flight has set it down.
   * `look` turns the drone with the mouse or a finger (radians this frame).
   */
  update(dt: number, cmd: DroneCommand, under: DroneGround, roof: { x: number; y: number; z: number }, look: number): boolean {
    const s = this.state;
    if (this.returning) look = 0;
    s.yaw += look;
    const lifting = !this.returning && s.y < this.lift && cmd.up >= 0 && Math.hypot(cmd.forward, cmd.right) < 0.1;
    if (lifting) { Object.assign(this.lifted, cmd); this.lifted.up = Math.max(cmd.up, 0.6); cmd = this.lifted; }
    else this.lift = -Infinity;   // the first touch of a stick ends the automatic climb
    this.pad.x = roof.x; this.pad.y = roof.y + DRONE_FOOT; this.pad.z = roof.z;
    const left = stepDrone(s, cmd, dt, this.maxSpeed, under, roof, this.returning ? this.pad : undefined);
    this.height = under.ground === null ? null : s.y - DRONE_FOOT - under.ground;
    this.distance = Math.hypot(s.x - roof.x, s.z - roof.z);
    // The model: tilted into its motion as a real drone leans, rotors spinning.
    this.spin += dt * 70;
    for (let i = 0; i < this.rotors.length; i++) this.rotors[i].rotation.y = (i % 2 ? 1 : -1) * this.spin;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const ahead = -sin * s.vx - cos * s.vz, side = cos * s.vx - sin * s.vz;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.set(-ahead * 0.012, s.yaw, -side * 0.012, 'YXZ');
    return this.returning && left < 0.35;
  }

  /** Puts the camera a little behind and over the drone, looking along the gimbal. Keeps it over the ground. */
  placeCamera(camera: THREE.PerspectiveCamera, ground: number | null): void {
    const s = this.state, cp = Math.cos(this.pitch);
    const dx = -Math.sin(s.yaw) * cp, dy = Math.sin(this.pitch), dz = -Math.cos(s.yaw) * cp;
    camera.position.set(s.x - dx * BACK, s.y - dy * BACK + UP, s.z - dz * BACK);
    if (ground !== null) camera.position.y = Math.max(camera.position.y, ground + 0.6);
  }

  /** The HUD line; on a phone a shorter one in two lines, clear of Pause and the gear. */
  readout(phone = false): string {
    const speed = Math.hypot(this.state.vx, this.state.vz);
    if (!phone) return droneReadout(this.height, this.distance, speed, this.maxSpeed, this.returning);
    const height = this.height === null ? '–' : `${Math.max(0, this.height).toFixed(0)} m`;
    const state = this.returning ? ' · returning' : this.distance >= DRONE.range - 1 ? ' · at range limit' : '';
    return `DRONE height ${height}\ndistance ${this.distance.toFixed(0)} m${state}`;
  }
}

// ---- phone sticks ------------------------------------------------------------------------------
// Two thumbsticks as on a drone's remote ("mode 2"): left climbs and turns, right flies. Both spring back to the
// middle, so letting go hovers. RETURN flies home; a second tap lands at once.

const CSS = `
.droneStick{position:fixed;z-index:6;bottom:calc(14px + var(--safe-bottom,env(safe-area-inset-bottom,0px)));
  width:var(--stick);height:var(--stick);--stick:min(132px,34vw,42vh);border-radius:50%;box-sizing:border-box;
  background:var(--panel,rgba(8,14,20,.6));border:2px solid rgba(238,242,246,.3);touch-action:none;user-select:none;-webkit-user-select:none}
.droneStick[hidden],#droneReturn[hidden]{display:none}
#droneLeft{left:calc(14px + env(safe-area-inset-left,0px))}
#droneRight{right:calc(14px + env(safe-area-inset-right,0px))}
.droneStick b{position:absolute;left:50%;top:50%;width:46%;height:46%;margin:-23% 0 0 -23%;border-radius:50%;
  background:rgba(238,242,246,.9);box-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none}
.droneStick.held b{background:var(--maple,#d0632e)}
.droneStick span{position:absolute;inset:auto 0 calc(100% + 3px);text-align:center;font:700 10px ui-monospace,Menlo,Consolas,monospace;
  letter-spacing:.06em;color:var(--ink,#eef2f6);text-shadow:0 1px 2px #000;pointer-events:none}
#droneReturn{position:fixed;z-index:6;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));
  min-width:96px;height:56px;border-radius:10px;border:1px solid rgba(238,242,246,.4);background:var(--panel-solid,#0b1219);
  color:var(--ink,#eef2f6);font:700 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em}
#droneReturn:active{background:var(--maple,#d0632e)}
@media (max-width:420px){#droneReturn{bottom:calc(14px + min(132px,34vw,42vh) + 24px + env(safe-area-inset-bottom,0px))}}
#droneButton{flex:none;width:56px;height:56px;border-radius:10px;border:1px solid rgba(238,242,246,.3);background:var(--panel,rgba(8,14,20,.72));
  color:var(--ink,#eef2f6);font:700 10.5px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;padding:0;pointer-events:auto}
#droneButton:active{background:var(--maple,#d0632e)}
body:not(.tcOn) #droneButton{display:none}
/* While the drone flies there is no photo or stop to show; on a phone the sticks need the bottom corners. */
body.droneOn :is(#cameraButton,#stopHint){display:none!important}
body.droneOn.droneSticks :is(#mailScore,#credit){display:none!important}
#phoneTop #droneButton{margin-left:auto}#phoneTop #droneButton~#gear{margin-left:0}
/* Upright, the phone planner (phone-controls-layout.ts) places DRONE; the gear then keeps the row's right end. */
#phoneTop #droneButton[style*="absolute"]~#gear{margin-left:auto}
`;

export interface DroneSticks {
  /** Read every frame while the drone flies. */
  command: DroneCommand;
  show(visible: boolean): void;
  release(): void;
}

/** The phone sticks and RETURN. `home` is RETURN's action. */
let styled = false;
const style = () => { if (!styled) { styled = true; document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS })); } };

export function createDroneSticks(home: () => void): DroneSticks {
  style();
  document.body.classList.add('droneSticks');
  const command: DroneCommand = { forward: 0, right: 0, up: 0, turn: 0 };
  const stick = (id: string, label: string, set: (x: number, y: number) => void) => {
    const el = Object.assign(document.createElement('div'), { id, className: 'droneStick', hidden: true });
    el.innerHTML = `<span>${label}</span><b></b>`;
    el.setAttribute('aria-hidden', 'true');
    const knob = el.querySelector('b')!;
    let id_ = -1;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect(), reach = r.width * 0.36;
      let x = (ev.clientX - (r.left + r.width / 2)) / reach, y = (ev.clientY - (r.top + r.height / 2)) / reach;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      knob.style.transform = `translate(${x * reach}px,${y * reach}px)`;
      // A small dead zone, so a resting thumb does not drift.
      const dz = (v: number) => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
      set(dz(x), dz(-y));
    };
    const end = () => { id_ = -1; el.classList.remove('held'); knob.style.transform = ''; set(0, 0); };
    el.addEventListener('pointerdown', (ev) => {
      if (id_ !== -1) return;
      id_ = ev.pointerId; el.setPointerCapture(ev.pointerId); el.classList.add('held'); move(ev);
      ev.preventDefault(); ev.stopPropagation();
    });
    el.addEventListener('pointermove', (ev) => { if (ev.pointerId === id_) { move(ev); ev.stopPropagation(); } });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(type, (ev) => { if (ev.pointerId === id_) end(); });
    document.body.appendChild(el);
    return { el, end };
  };
  const left = stick('droneLeft', 'UP · TURN', (x, y) => { command.turn = -x; command.up = y; });
  const right = stick('droneRight', 'FLY', (x, y) => { command.right = x; command.forward = y; });
  const ret = Object.assign(document.createElement('button'), { id: 'droneReturn', textContent: 'RETURN', hidden: true });
  ret.setAttribute('aria-label', 'Fly the drone back to the vehicle. Tap again to land at once');
  ret.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  ret.addEventListener('click', () => home());
  document.body.appendChild(ret);
  const release = () => { left.end(); right.end(); };
  addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  let shown = false;
  return {
    command, release,
    show(visible: boolean) {
      if (visible === shown) return;
      shown = visible;
      left.el.hidden = right.el.hidden = ret.hidden = !visible;
      if (!visible) release();
    },
  };
}

/** The phone's DRONE button, beside Pause at the top. Shown only with the driving controls (body.tcOn). */
export function createDroneButton(launch: () => void): HTMLButtonElement {
  style();
  const button = Object.assign(document.createElement('button'), { id: 'droneButton', textContent: 'DRONE' });
  button.setAttribute('aria-label', 'Launch the camera drone. F on a keyboard');
  for (const type of ['pointerdown', 'pointerup', 'pointermove'] as const) button.addEventListener(type, (ev) => ev.stopPropagation());
  button.addEventListener('click', () => launch());
  return button;
}
