import { keyCaps } from './controls';
// The camera drone (F, or DRONE on a phone): it lifts off the vehicle's roof, the vehicle stays where it was, and the
// camera follows a little behind it. F again sets it back on the roof at once; R (or RETURN) flies it home first.
// The flying is in drone-rules.ts; this file is the model, the camera and the phone sticks.

import * as THREE from 'three';
import { DRONE, GIMBAL, droneReadout, stepDrone, stepGimbal, wheelSpeed, type DroneCommand, type DroneGround, type DroneState } from './drone-rules';
import type { Building } from './buildings';
import type { Terrain } from './terrain';
import type { Rig } from './vehicle-spec';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Where the camera sits behind the drone, metres along the view and up. */
const BACK = 2.4, UP = 0.55;
/** The take-off climb: the drone rises this far over the roof before the sticks get it. */
const LIFT = 3;
/** Hover height over the road when starting or resetting in standalone drone mode, metres. */
const HOVER = 4;

/** Active terrain bound by createTerrainReady(terrain) so Drone.update() can sample destination ground after moving. */
let activeTerrain: Pick<Terrain, 'surfaceAt' | 'seaLevel'> | null = null;

/**
 * Checks whether the finest tile that exists in `terrain.manifest` at (x, z) is loaded and (for level 8) currently
 * selected in `terrain.drawnFine`. Read-only: never marks tiles as used. Returns false off the map where no land tiles
 * exist, so the standalone drone stops before leaving loaded terrain into unmapped far land.
 */
export function createTerrainReady(terrain: Terrain): (x: number, z: number) => boolean {
  activeTerrain = typeof terrain.surfaceAt === 'function' ? terrain : null;
  const m = terrain.manifest, exists = new Set<string>();
  let maxLevel = 0;
  for (const [level, names] of Object.entries(m.levels)) {
    const l = +level;
    if (l > maxLevel) maxLevel = l;
    for (const n of names) exists.add(`${l}/${n}`);
  }
  return (x: number, z: number): boolean => {
    const e = x + m.village[0] - m.origin[0], s = z - (m.village[1] - m.origin[1]);
    for (let level = maxLevel; level >= 0; level--) {
      const size = m.size / 2 ** level;
      const i = Math.floor(e / size), j = Math.floor(s / size);
      const coord = `${i}_${j}`;
      if (!exists.has(`${level}/${coord}`)) continue;
      if (terrain.levelAt(x, z) < level) return false;
      return level === 8 ? terrain.drawnFine.has(coord) : true;
    }
    return false;
  };
}

/** Empty zero-mesh vehicle rig used when the drone is the standalone vehicle (no car model loaded or drawn). */
export function createDroneRig(): Rig {
  const root = new THREE.Group(), body = new THREE.Group(), driverEye = new THREE.Object3D();
  const fl = new THREE.Group(), fr = new THREE.Group(), rl = new THREE.Group(), rr = new THREE.Group();
  const sfl = new THREE.Group(), sfr = new THREE.Group();
  root.add(body);
  return { root, body, wheels: { fl, fr, rl, rr }, steer: { fl: sfl, fr: sfr }, driverEye, brakeLights: [] };
}

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
export function roofHeights(list: readonly Pick<Building, 'x' | 'y' | 'ground' | 'floorGround' | 'axisDeg' | 'length' | 'width' | 'eave' | 'ridge' | 'shape'>[], village: [number, number], exag: number, sea: number): (x: number, z: number) => number {
  const CELL = 48, cells = new Map<number, Roof[]>();
  const key = (i: number, j: number) => i >= -4096 && i < 4096 && j >= -4096 && j < 4096 ? (i + 4096) * 8192 + (j + 4096) : -1;
  for (const b of list) {
    const a = b.axisDeg * Math.PI / 180;
    const roof: Roof = { x: b.x - village[0], z: village[1] - b.y, ux: Math.sin(a), uz: -Math.cos(a), half: b.length / 2 + 1, halfWidth: b.width / 2 + 1,
      round: b.shape === 'tank', top: sea + ((b.floorGround ?? b.ground) - sea) * exag + Math.max(b.ridge, b.eave) };
    const r = Math.hypot(roof.half, roof.halfWidth);
    if (!Number.isFinite(roof.x + roof.z + r + roof.top + roof.ux)) continue;
    for (let i = Math.floor((roof.x - r) / CELL); i <= Math.floor((roof.x + r) / CELL); i++) for (let j = Math.floor((roof.z - r) / CELL); j <= Math.floor((roof.z + r) / CELL); j++) {
      const k = key(i, j);
      if (k < 0) continue;
      const cell = cells.get(k);
      if (cell) cell.push(roof); else cells.set(k, [roof]);
    }
  }
  return (x, z) => {
    let top = -Infinity;
    const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
    const cell = (k < 0 ? undefined : cells.get(k)) ?? NO_ROOFS;
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
  /** True when the drone is the standalone vehicle in Just Drive (no 2 km range limit, no car roof to land on). */
  free = false;
  /** True while standalone drone speed is held back waiting for land ahead to finish loading. */
  loading = false;
  /** Flying home by itself (R or RETURN). */
  returning = false;
  maxSpeed: number = DRONE.speed;
  /** The camera's tilt under the drone (radians, negative looks down). */
  pitch = -0.25;
  private readonly tilt = { pitch: 0, rate: 0 };
  private readonly lifted: DroneCommand = { forward: 0, right: 0, up: 0, turn: 0 };
  private readonly pad = { x: 0, y: 0, z: 0 };
  private readonly postUnder: DroneGround = { ground: null, floor: null };
  private readonly sampleLiveUnder = (x: number, z: number): DroneGround => {
    const t = activeTerrain;
    const s = t?.surfaceAt?.(x, z) ?? null;
    if (!s) { this.postUnder.ground = null; this.postUnder.floor = null; return this.postUnder; }
    const sea = typeof t?.seaLevel === 'number' ? t.seaLevel : -0.2;
    const g = Math.max(s.ground, sea);
    this.postUnder.ground = g;
    this.postUnder.floor = g + s.canopy + DRONE.clearance;
    return this.postUnder;
  };
  private lift = 0;
  private spin = 0;
  height: number | null = null;
  distance = 0;

  private hintTime = 0;
  private hintLayout = 0;
  private readonly help: HTMLElement | null = typeof document === 'undefined' ? null : createDroneHelp();
  get hintsHidden(): boolean { return this.hintTime >= 30; }
  private helpFree = false;
  /** Swaps the key panel between the car's drone and the standalone drone when the mode changes. */
  private fillHelp(): void {
    if (!this.help || this.helpFree === this.free) return;
    this.helpFree = this.free; fillDroneHelp(this.help, this.free);
  }
  constructor() {
    if (typeof document !== 'undefined') style();
    const m = model();
    this.group = m.group; this.rotors = m.rotors;
  }

  /** Lifts off a roof at (x, roof, z), or starts hovering above a road when `free` is true. */
  launch(x: number, roof: number, z: number, yaw: number, free = false): void {
    document.body.classList.add('droneOn');
    this.free = free; this.loading = false; this.fillHelp();
    this.hintTime = 0; this.hintLayout = 0; if (this.help) { this.help.hidden = false; this.help.style.opacity = '1'; this.dockHelp(); }
    const y = free ? roof + DRONE_FOOT + HOVER : roof + DRONE_FOOT;
    Object.assign(this.state, { x, y, z, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0 });
    this.active = true; this.returning = false; this.lift = free ? -Infinity : roof + DRONE_FOOT + LIFT;
    this.pitch = free ? -0.18 : -0.3; this.tilt.rate = 0;
    this.maxSpeed = DRONE.speed;
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, yaw, 0, 'YXZ');
    this.group.visible = true;
  }

  /** Moves an active standalone drone to hover over (x, ground, z) facing `yaw`, at rest. */
  place(x: number, ground: number, z: number, yaw: number): void {
    const y = ground + DRONE_FOOT + HOVER;
    Object.assign(this.state, { x, y, z, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0 });
    this.returning = false; this.loading = false; this.lift = -Infinity; this.tilt.rate = 0;
    this.group.position.set(x, y, z);
    this.group.rotation.set(0, yaw, 0, 'YXZ');
  }

  /** Back on the roof: the drone is put away. */
  stow(): void { this.active = false; this.free = false; this.loading = false; this.returning = false; this.group.visible = false; document.body.classList.remove('droneOn'); if (this.help) this.help.hidden = true; }

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
   * One frame. `roof` is the landing spot on the vehicle (null in standalone drone mode). Returns true when the return
   * flight has set it down. `look` turns the drone with the mouse or a finger (radians this frame). `speedCap` slows
   * standalone flight near land that is still loading.
   */
  update(dt: number, cmd: DroneCommand, under: DroneGround, roof: { x: number; y: number; z: number } | null, look: number, speedCap = this.maxSpeed, sampleUnder?: (x: number, z: number) => DroneGround): boolean {
    this.hintTime += dt;
    const opacity = this.hintTime >= 29.6 ? '0' : '1';
    if (this.help && this.help.style.opacity !== opacity) this.help.style.opacity = opacity;
    this.hintLayout -= dt;
    if (!this.hintsHidden && this.hintLayout <= 0) { this.dockHelp(); this.hintLayout = .25; }
    if (this.help && this.help.hidden !== this.hintsHidden) this.help.hidden = this.hintsHidden;
    const s = this.state;
    if (this.returning) look = 0;
    s.yaw += look;
    const lifting = !this.returning && s.y < this.lift && cmd.up >= 0 && Math.hypot(cmd.forward, cmd.right) < 0.1;
    if (lifting) { Object.assign(this.lifted, cmd); this.lifted.up = Math.max(cmd.up, 0.6); cmd = this.lifted; }
    else this.lift = -Infinity;   // the first touch of a stick ends the automatic climb
    const top = Math.min(this.maxSpeed, speedCap);
    this.loading = this.free && speedCap < this.maxSpeed - 0.1;
    const sampler = sampleUnder ?? (activeTerrain?.surfaceAt ? this.sampleLiveUnder : undefined);
    let left = Infinity;
    if (this.free || !roof) {
      stepDrone(s, cmd, dt, top, under, null, undefined, sampler);
      this.distance = 0;
    } else {
      this.pad.x = roof.x; this.pad.y = roof.y + DRONE_FOOT; this.pad.z = roof.z;
      left = stepDrone(s, cmd, dt, top, under, roof, this.returning ? this.pad : undefined, sampler);
      this.distance = Math.hypot(s.x - roof.x, s.z - roof.z);
    }
    const postGround = sampler ? sampler(s.x, s.z).ground : under.ground;
    const refGround = postGround ?? under.ground;
    this.height = refGround === null ? null : s.y - DRONE_FOOT - refGround;
    // The model: tilted into its motion as a real drone leans, rotors spinning.
    this.spin += dt * 70;
    for (let i = 0; i < this.rotors.length; i++) this.rotors[i].rotation.y = (i % 2 ? 1 : -1) * this.spin;
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const ahead = -sin * s.vx - cos * s.vz, side = cos * s.vx - sin * s.vz;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.set(-ahead * 0.012, s.yaw, -side * 0.012, 'YXZ');
    return !this.free && this.returning && left < 0.35;
  }

  private dockHelp(): void {
    if (!this.help || document.body.classList.contains('droneSticks')) return;
    const gear = document.getElementById('gear')?.getBoundingClientRect();
    const visible = (id: string) => {
      const e = document.getElementById(id), b = e && !e.hidden && !e.classList.contains('inPanel') ? e.getBoundingClientRect() : null;
      return b?.width && b.height ? b : null;
    };
    let topEdge = gear?.bottom ?? 54;
    for (const id of ['pauseButton','placesButton','bigMapButton','endShift']) {
      const b = visible(id);
      if (b) topEdge = Math.max(topEdge, b.bottom);
    }
    let bottom = topEdge, rightPx = gear?.width ? innerWidth - gear.right : 10;
    const photo = visible('photoTag');
    if (photo) {
      const helpHeight = this.help.getBoundingClientRect().height;
      const fired = visible('firedHud');
      const underPhoto = Math.max(topEdge, photo.bottom) + 10;
      if (fired && helpHeight > 0 && underPhoto + helpHeight > fired.top - 10) rightPx = Math.max(rightPx, innerWidth - photo.left + 10);
      else bottom = Math.max(bottom, photo.bottom);
    }
    const top = `${bottom + 10}px`, right = `${rightPx}px`;
    if (this.help.style.top !== top) this.help.style.top = top;
    if (this.help.style.right !== right) this.help.style.right = right;
  }

  /** Puts the camera a little behind and over the drone, looking along the gimbal. Keeps it over the ground. */
  placeCamera(camera: THREE.PerspectiveCamera, ground: number | null): void {
    const s = this.state, cp = Math.cos(this.pitch);
    const dx = -Math.sin(s.yaw) * cp, dy = Math.sin(this.pitch), dz = -Math.cos(s.yaw) * cp;
    camera.position.set(s.x - dx * BACK, s.y - dy * BACK + UP, s.z - dz * BACK);
    const camSurf = activeTerrain?.surfaceAt?.(camera.position.x, camera.position.z) ?? null;
    const camGround = camSurf ? Math.max(camSurf.ground, typeof activeTerrain?.seaLevel === 'number' ? activeTerrain.seaLevel : -0.2) : null;
    const floor = ground !== null && camGround !== null ? Math.max(ground, camGround) : (camGround ?? ground);
    if (floor !== null) camera.position.y = Math.max(camera.position.y, floor + 0.6);
  }

  /** The phone keeps each metric on a short line beside Pause. */
  readout(phone = false): string {
    const speed = Math.hypot(this.state.vx, this.state.vz);
    const line = droneReadout(this.height, this.free ? null : this.distance, speed, this.maxSpeed, this.returning, this.state.yaw, this.loading);
    if (!phone) return line;
    const parts = line.split(' · ');
    const distance = this.free ? '' : `${parts.splice(2, 1)[0]}\n`;
    const [name, height, motion, heading, state] = parts;
    return `${name} · ${height}\n${distance}${motion}\n${heading}${state ? ` · ${state}` : ''}`;
  }
}

// ---- phone sticks ------------------------------------------------------------------------------
// Two thumbsticks as on a drone's remote ("mode 2"): left climbs and turns, right flies. Both spring back to the
// middle, so letting go hovers. RETURN flies home; a second tap lands at once.

export const DRONE_HELP = [
  ['R', 'Fly back'], ['F', 'Land'],
  ['WASD', 'Move'], ['←/→ or Q/E', 'Turn'], ['↑/↓', 'Camera'],
  ['Space', 'Up'], ['Shift or C', 'Down'], ['Mouse wheel', 'Top speed'],
] as const;
export const DRONE_TOUCH_HELP = [['Left stick', 'Climb and turn'], ['Right stick', 'Fly'], ['RETURN TO CAR', 'Fly back. LAND NOW lands at once.']] as const;
/** The keys when the drone is the standalone vehicle in Just Drive: R puts it on the nearest road, and there is no car to land on. */
export const DRONE_FREE_HELP = [
  ['R', 'Nearest road'], ['L / M', 'Places / map'],
  ['WASD', 'Move'], ['←/→ or Q/E', 'Turn'], ['↑/↓', 'Camera'],
  ['Space', 'Up'], ['Shift or C', 'Down'], ['Mouse wheel', 'Top speed'],
] as const;
export const DRONE_FREE_TOUCH_HELP = [['Left stick', 'Climb and turn'], ['Right stick', 'Fly'], ['PLACES / ⚙', 'Places and the big map / settings (nearest road).']] as const;
function createDroneHelp(): HTMLElement {
  const help = Object.assign(document.createElement('aside'), { id: 'droneHints', hidden: true });
  help.append(Object.assign(document.createElement('h3'), { textContent: 'Drone keys' }), document.createElement('dl'));
  help.setAttribute('aria-label', 'Drone keys');
  fillDroneHelp(help, false);
  document.body.append(help); return help;
}
function fillDroneHelp(help: HTMLElement, free: boolean): void {
  const rows = help.querySelector('dl')!;
  rows.replaceChildren();
  for (const [key, action] of [...(free ? DRONE_FREE_HELP : DRONE_HELP), ...(document.body?.classList?.contains('exploreMode') ? [['O', 'Save picture'] as const] : [])]) {
    const term = document.createElement('dt'), text = document.createElement('dd');
    term.innerHTML = keyCaps(key);
    text.textContent = action; rows.append(term, text);
  }
}
const CSS = `
#droneHints{position:fixed;right:10px;top:64px;z-index:3;margin:0;padding:10px 12px;border-radius:8px;
  max-width:calc(100vw - 32px);background:var(--panel-solid,#0c141c);color:var(--ink,#eef2f6);font:13px/1.4 system-ui;transition:opacity .4s}
#droneHints h3{font:700 13px system-ui;margin:0 0 8px;color:var(--ink-dim)}
#droneHints dl{display:grid;grid-template-columns:auto auto;align-items:baseline;gap:5px 8px;margin:0}
#droneHints .keyJoin{color:var(--ink-dim)}
#droneHints dt{justify-self:end}
#droneHints dd{margin:0}#droneHints kbd{display:inline-block;background:#20303b;border:1px solid #71818e;border-bottom:2px solid #46566a;border-radius:4px;padding:2px 6px;font:700 12px var(--mono,monospace)}
#droneHints[hidden],body.droneSticks #droneHints{display:none}
body.droneOn #hud{max-width:calc(100vw - 270px);white-space:pre-wrap}
body.droneOn #hud .dh{display:block;font:700 24px/26px var(--mono);font-variant-numeric:tabular-nums}
body.droneOn #hud :is(.dk,.dq){font:12px/16px var(--mono);color:var(--ink-dim)}
body.droneOn #hud .dsep{display:none}
body.droneOn #hud .dst{font:12px/16px var(--mono);color:#f2b766}
body.droneOn.droneSticks #hud{left:max(10px,var(--drone-safe-left,0px));top:calc(10px + var(--drone-safe-top,0px));width:var(--droneCol);max-width:none;box-sizing:border-box;white-space:pre-wrap;font-size:12px;line-height:16px;padding:8px;overflow-wrap:anywhere}
body.droneOn #hud .dst{display:block}
body.droneOn.droneSticks #gear{right:calc(10px + var(--drone-safe-right,0px));top:calc(10px + var(--drone-safe-top,0px))}
body.droneOn.droneSticks #pauseButton{right:calc(76px + var(--drone-safe-right,0px));top:calc(10px + var(--drone-safe-top,0px));pointer-events:auto}
@media(orientation:landscape) and (max-height:319px){body.droneOn.droneSticks #hud{padding:4px 6px;font-size:10px;line-height:13px}body.droneOn.droneSticks #hud .dh{font-size:16px;line-height:18px}body.droneOn.droneSticks #hud :is(.dk,.dq,.dst){font-size:10px;line-height:13px}}
body.droneSticks{--drone-safe-top:var(--test-safe-top,env(safe-area-inset-top,0px));--drone-safe-right:var(--test-safe-right,env(safe-area-inset-right,0px));--drone-safe-bottom:var(--test-safe-bottom,env(safe-area-inset-bottom,0px));--drone-safe-left:var(--test-safe-left,env(safe-area-inset-left,0px));--drone-stick-size:min(132px,34vw,42vh)}
@media (min-width:421px){body.droneSticks{--drone-stick-size:max(56px,min(132px,34vw,42vh,calc((100vw - var(--drone-safe-left,0px) - var(--drone-safe-right,0px) - 172px) / 2)))}}
@media(orientation:landscape) and (max-width:420px) and (max-height:319px){body.droneSticks{--drone-stick-size:max(56px,min(132px,34vw,42vh,calc(100vh - 170px - var(--drone-safe-top,0px) - var(--drone-safe-bottom,0px))))}}
.droneStick{position:fixed;z-index:6;bottom:calc(14px + var(--drone-safe-bottom,0px));
  width:var(--drone-stick-size);height:var(--drone-stick-size);border-radius:50%;box-sizing:border-box;
  background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cpath fill='%23eef2f6' fill-opacity='.4' d='M50 10l-4 6h8zM50 90l-4-6h8zM10 50l6-4v8zM90 50l-6-4v8z'/%3E%3C/svg%3E") center/100% 100% no-repeat,var(--panel,rgba(8,14,20,.6));border:2px solid rgba(238,242,246,.3);touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.droneStick[hidden],#droneReturn[hidden]{display:none}
#droneLeft{left:calc(14px + var(--drone-safe-left,0px))}
#droneRight{right:calc(14px + var(--drone-safe-right,0px))}
.droneStick b{position:absolute;left:50%;top:50%;width:46%;height:46%;margin:-23% 0 0 -23%;border-radius:50%;
  background:rgba(238,242,246,.9);box-shadow:0 2px 8px rgba(0,0,0,.45);pointer-events:none}
.droneStick.held b{background:var(--maple,#d0632e)}
.droneStick span{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);width:max-content;white-space:nowrap;padding:0;border:0;background:none;text-align:center;font:700 12px/14px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.02em;color:var(--ink,#eef2f6);text-shadow:0 0 2px #0b1620,0 0 3px #0b1620,0 1px 3px rgba(0,0,0,.7);pointer-events:none}
@media(orientation:landscape) and (max-width:460px) and (max-height:290px){#droneLeft span{left:0;transform:none}}
#droneReturn{position:fixed;z-index:6;left:50%;transform:translateX(-50%);bottom:calc(14px + var(--drone-safe-bottom,0px));
  min-width:112px;height:56px;padding:0 8px;border-radius:10px;border:1px solid rgba(238,242,246,.4);background:var(--panel-solid,#0b1219);
  color:var(--ink,#eef2f6);font:700 12px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em}
#droneReturn:active{background:var(--maple,#d0632e)}
@media (min-width:421px){#droneReturn{left:calc(50% + (var(--drone-safe-left,0px) - var(--drone-safe-right,0px)) / 2)}}
@media (max-width:420px){#droneReturn{bottom:calc(14px + var(--drone-stick-size) + 24px + var(--drone-safe-bottom,0px))}}
#droneButton{flex:none;width:56px;height:56px;border-radius:10px;border:1px solid rgba(238,242,246,.3);background:var(--panel,rgba(8,14,20,.72));
  color:var(--ink,#eef2f6);font:700 10.5px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em;padding:0;pointer-events:auto}
#droneButton:active{background:var(--maple,#d0632e)}
body:not(.tcOn) #droneButton{display:none}
/* While the drone flies there is no photo or stop to show; on a phone the sticks need the bottom corners. */
body.droneOn :is(#cameraButton,#stopHint){display:none!important}
body.droneOn.droneSticks :is(#mailScore,#credit,#placeArrival){display:none!important}
#phoneTop #droneButton{margin-left:auto}#phoneTop #droneButton~#gear{margin-left:0}
/* Upright, the phone planner (phone-controls-layout.ts) places DRONE; the gear then keeps the row's right end. */
#phoneTop #droneButton[style*="absolute"]~#gear{margin-left:auto}
`;

export interface DroneSticks {
  /** Read every frame while the drone flies. */
  command: DroneCommand;
  show(visible: boolean, returning?: boolean): void;
  release(): void;
}

/** The phone sticks and RETURN (omitted in standalone drone mode, where Settings and Places reach roads). `home` is its action. */
let styled = false;
const style = () => { if (!styled) { styled = true; document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS })); } };

export function createDroneSticks(home: () => void, standalone = false): DroneSticks {
  style();
  document.body.classList.add('droneSticks');
  const hud = document.getElementById('hud');
  if (hud && typeof ResizeObserver === 'function') new ResizeObserver(() => {
    if (document.body.classList.contains('droneOn')) document.body.style.setProperty('--droneHudH', `${hud.offsetHeight}px`);
  }).observe(hud);
  const command: DroneCommand = { forward: 0, right: 0, up: 0, turn: 0 };
  const activeTouch = (list: TouchList | undefined, tid: number): Touch | null => {
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (list[i].identifier === tid) return list[i];
    return null;
  };
  const stick = (id: string, label: string, set: (x: number, y: number) => void) => {
    const el = Object.assign(document.createElement('div'), { id, className: 'droneStick', hidden: true });
    el.innerHTML = `<span>${label}</span><b></b>`;
    el.setAttribute('aria-hidden', 'true');
    const knob = el.querySelector('b')!;
    let pointerId = -1;
    let pointerTouch = false;
    let captured = false;
    let touchId = -1;
    const moveAt = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect(), reach = r.width * 0.36;
      if (!(reach > 0)) return;
      let x = (clientX - (r.left + r.width / 2)) / reach, y = (clientY - (r.top + r.height / 2)) / reach;
      const length = Math.hypot(x, y);
      if (length > 1) { x /= length; y /= length; }
      knob.style.transform = `translate(${x * reach}px,${y * reach}px)`;
      // A small dead zone, so a resting thumb does not drift.
      const dz = (v: number) => Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92;
      set(dz(x), dz(-y));
    };
    const end = () => {
      const oldId = pointerId;
      pointerId = -1;
      pointerTouch = false;
      captured = false;
      touchId = -1;
      if (oldId !== -1) {
        try { if (el.hasPointerCapture?.(oldId)) el.releasePointerCapture(oldId); } catch { /* capture already lost */ }
      }
      el.classList.remove('held');
      knob.style.transform = '';
      set(0, 0);
    };
    el.addEventListener('pointerdown', (ev) => {
      if (pointerId !== -1 || touchId !== -1) {
        if (ev.pointerId === pointerId || touchId !== -1 || (!captured && !pointerTouch) || (captured && (typeof el.hasPointerCapture !== 'function' || el.hasPointerCapture(pointerId)))) return;
        end();
      }
      pointerId = ev.pointerId;
      pointerTouch = ev.pointerType === 'touch';
      captured = false;
      try {
        if (typeof el.setPointerCapture === 'function') { el.setPointerCapture(ev.pointerId); captured = true; }
      } catch { /* fall back to window pointermove and touchmove */ }
      el.classList.add('held');
      moveAt(ev.clientX, ev.clientY);
      ev.preventDefault(); ev.stopPropagation();
    });
    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.pointerType === 'mouse' && ev.isTrusted && ev.buttons === 0) { end(); return; }
      moveAt(ev.clientX, ev.clientY);
      ev.stopPropagation();
    };
    el.addEventListener('pointermove', onPointerMove);
    addEventListener('pointermove', (ev) => { if (!captured && ev.pointerId === pointerId) onPointerMove(ev); }, { capture: true });
    const onPointerEnd = (ev: PointerEvent) => { if (ev.pointerId === pointerId) end(); };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(type, onPointerEnd);
    for (const type of ['pointerup', 'pointercancel'] as const) addEventListener(type, onPointerEnd, { capture: true });
    // On iOS Safari, pointerdown preventDefault does not stop touch callouts or stolen gestures, and a lost pointer
    // release can leave a stick held. Track touch events as well so touchcancel or a lifted finger always resets.
    el.addEventListener('touchstart', (ev) => {
      ev.preventDefault();
      if (pointerId !== -1 && !pointerTouch) return;
      if (touchId !== -1 && !activeTouch(ev.touches, touchId)) end();
      if (touchId === -1 && ev.changedTouches?.length) {
        const t = ev.changedTouches[0];
        touchId = t.identifier;
        if (pointerId === -1 || !captured) { el.classList.add('held'); moveAt(t.clientX, t.clientY); }
      }
    }, { passive: false });
    el.addEventListener('touchmove', (ev) => {
      ev.preventDefault();
      if (touchId === -1) return;
      const t = activeTouch(ev.touches, touchId);
      if (!t) { end(); return; }
      if (pointerId === -1 || !captured) moveAt(t.clientX, t.clientY);
    }, { passive: false });
    const onElementTouchEnd = (ev: TouchEvent) => {
      if (touchId !== -1) { if (!activeTouch(ev.touches, touchId)) end(); return; }
      if ((ev.targetTouches?.length ?? 0) === 0 && pointerId !== -1 && pointerTouch) end();
    };
    for (const type of ['touchend', 'touchcancel'] as const) el.addEventListener(type, onElementTouchEnd, { passive: true });
    const onWindowTouchEnd = (ev: TouchEvent) => {
      if (touchId !== -1) { if (!activeTouch(ev.touches, touchId)) end(); return; }
      if ((ev.touches?.length ?? 0) === 0 && pointerId !== -1 && pointerTouch) end();
    };
    for (const type of ['touchend', 'touchcancel'] as const) addEventListener(type, onWindowTouchEnd, { capture: true, passive: true });
    addEventListener('touchstart', (ev: TouchEvent) => {
      if (touchId !== -1 && !activeTouch(ev.touches, touchId)) end();
    }, { capture: true, passive: true });
    el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); end(); });
    document.body.appendChild(el);
    return { el, end };
  };
  const left = stick('droneLeft', '↕CLIMB · ↔TURN', (x, y) => { command.turn = x ? -x : 0; command.up = y; });
  const right = stick('droneRight', 'FLY', (x, y) => { command.right = x; command.forward = y; });
  const ret = standalone ? null : Object.assign(document.createElement('button'), { id: 'droneReturn', textContent: 'RETURN TO CAR', hidden: true });
  if (ret) {
    ret.setAttribute('aria-label', 'Fly the drone back to the vehicle. Tap again to land at once');
    ret.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    ret.addEventListener('click', () => home());
    document.body.appendChild(ret);
  }
  const release = () => { left.end(); right.end(); };
  addEventListener('blur', release);
  addEventListener('pagehide', release);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
  let shown = false;
  return {
    command, release,
    show(visible: boolean, returning = false) {
      if (ret) {
        const words = returning ? 'LAND NOW' : 'RETURN TO CAR';
        if (ret.textContent !== words) ret.textContent = words;
        const label = returning ? 'Land now' : 'Return to car';
        if (ret.getAttribute('aria-label') !== label) ret.setAttribute('aria-label', label);
      }
      if (visible === shown) return;
      shown = visible;
      left.el.hidden = right.el.hidden = !visible;
      if (ret) ret.hidden = !visible;
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

/** Preserve the formatter's exact text while giving height its own line. */
export function droneSpans(text: string): Node[] {
  const match = /^(DRONE · Height )(.*?)(\n| · )([\s\S]*?)(?:([ ]· )(returning|at range limit|at height limit|loading land))?$/.exec(text);
  if (!match) return [document.createTextNode(text)];
  const nodes: Node[] = [];
  const part = (tag: string, className: string, textContent: string) => nodes.push(Object.assign(document.createElement(tag), { className, textContent }));
  part('span', 'dk', match[1]); part('b', 'dh', match[2]); part('span', 'dsep', match[3]); part('span', 'dq', match[4]);
  if (match[6]) { part('span', 'dsep', match[5]); part('span', 'dst', match[6]); }
  return nodes;
}
