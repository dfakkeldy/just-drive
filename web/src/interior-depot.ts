/**
 * Port Hood Mail Depot interiors:
 *  - DepotLoadingInterior: short, skippable, phone-friendly shift-start loading bay with the Boss watching.
 *  - DepotInterrogationInterior: cramped supervisor's office after a suspension or bad Boss verdict.
 *  - BossLooksInterior: side-by-side comparison room for the three invented Boss character options.
 * Shadow-free, low draw counts, responsive desktop and phone overlay controls.
 */
import * as THREE from 'three';
import type { Door, InteriorGame, InteriorResult } from './interiors';
import { buildBossCharacter, type BossFigure } from './boss-character';
import {
  BOSS_LOOKS,
  DEFAULT_BOSS_LOOK,
  InterrogationSession,
  LoadingRun,
  SWEET_SPOT,
  type BossLookId,
  type InterrogationComplaint,
  type InterrogationReason,
} from './depot-rules';
import type { DepotSite } from './depot-site';
import { DEPOT_DOOR_RADIUS } from './depot-site';
import type { Input } from './vehicle';

const PANEL_CSS = `
#depotPanel{position:fixed;z-index:8;left:50%;bottom:max(14px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);
  width:min(560px,calc(100% - 24px));box-sizing:border-box;padding:14px 16px;border-radius:10px;
  background:rgba(12,20,26,.94);border:1px solid #8a7c63;border-top:3px solid #d0632e;color:#eef2f6;
  font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 12px 44px #0009}
#depotPanel.office{border-top-color:#ffa526}
#depotPanel .depotTag{font:700 11px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#efbb68;margin:0 0 6px}
#depotPanel .depotSpeech{margin:0 0 10px;color:#eef2f6;font-size:15px}
#depotPanel .depotQuote{margin:0 0 12px;padding:10px 12px;border-left:3px solid #ffa526;background:rgba(255,255,255,.06);border-radius:4px}
#depotPanel .depotQuote strong{display:block;font-size:12px;color:#efbb68;margin-bottom:3px}
#depotPanel .depotQuote p{margin:0;font-style:italic;color:#f5f0e2}
#depotPanel .depotMeter{position:relative;height:18px;border-radius:9px;background:#1e2a33;border:1px solid #596973;margin:8px 0 12px;overflow:hidden}
#depotPanel .depotSweet{position:absolute;top:0;bottom:0;left:${((1 - SWEET_SPOT) / 2 * 100).toFixed(1)}%;width:${(SWEET_SPOT * 100).toFixed(1)}%;background:rgba(116,184,132,.38);border-left:1px solid #74b884;border-right:1px solid #74b884}
#depotPanel .depotPin{position:absolute;top:2px;bottom:2px;width:10px;margin-left:-5px;border-radius:5px;background:#ffd36e;box-shadow:0 0 8px #ffd36e;left:50%}
#depotPanel .depotActions{display:grid;gap:8px}
#depotPanel .depotRow{display:flex;gap:8px;flex-wrap:wrap}
#depotPanel button{min-height:48px;padding:10px 14px;border-radius:7px;border:1px solid #7f8d96;background:#23323d;color:#fff;
  font:700 14px/1.3 system-ui,sans-serif;cursor:pointer;text-align:left;touch-action:manipulation;box-sizing:border-box}
#depotPanel button.primary{background:#b85225;border-color:#e59d6d;text-align:center;flex:1}
#depotPanel button.primary:active{background:#d46a37}
#depotPanel button.secondary{background:#1b262e;border-color:#687782;color:#d6dfe6;text-align:center}
#depotPanel button:focus-visible{outline:3px solid #fff;outline-offset:2px}
body.depotIndoor #tcTrack,body.depotIndoor #tcBrake,body.depotIndoor #tcGo,body.depotIndoor #tcSteer{display:none!important}
@media(max-width:600px){
  #depotPanel{padding:11px 12px;font-size:13px;width:calc(100% - 16px);bottom:max(10px,env(safe-area-inset-bottom,0px))}
  #depotPanel .depotSpeech{font-size:13.5px;margin-bottom:8px}
  #depotPanel button{min-height:44px;font-size:13px;padding:8px 11px}
}
@media(max-height:450px){
  #depotPanel{padding:8px 12px;max-height:56dvh;overflow-y:auto}
  #depotPanel .depotSpeech{margin-bottom:6px;font-size:13px}
  #depotPanel .depotQuote{padding:6px 10px;margin-bottom:8px}
  #depotPanel button{min-height:40px;padding:6px 10px;font-size:12.5px}
}
`;

let styleInjected = false;
function ensurePanelStyle(): void {
  if (styleInjected || typeof document === 'undefined') return;
  styleInjected = true;
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: PANEL_CSS }));
}

function boxMesh(
  geo: THREE.BufferGeometry[],
  mat: THREE.Material[],
  w: number, h: number, d: number,
  color: number,
  x: number, y: number, z: number,
  map?: THREE.Texture,
): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshLambertMaterial({ color, ...(map ? { map } : {}) });
  geo.push(g); mat.push(m);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = false;
  return mesh;
}

function makeCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture | undefined {
  if (typeof document === 'undefined') return undefined;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return undefined;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stopPanelPointer(el: HTMLElement): void {
  for (const ev of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) {
    el.addEventListener(ev, e => e.stopPropagation());
  }
}

function modalOverlayOpen(): boolean {
  if (typeof document === 'undefined' || !document.getElementById) return false;
  const pause = document.getElementById('pauseScreen');
  if (pause && !pause.hidden) return true;
  if (document.getElementById('settings')?.classList.contains('open')) return true;
  const title = document.getElementById('title');
  if (title && !title.hidden && !title.classList.contains('gone')) return true;
  return false;
}

function focusedOnControl(ev: KeyboardEvent): boolean {
  const t = ev.target;
  return typeof HTMLElement !== 'undefined' && t instanceof HTMLElement && t.closest('button, input, select, textarea, a[href]') !== null;
}

function keyHint(label: string, touch: boolean): string {
  return touch ? label : `${label} · Space`;
}

/** Build a simplified, shadow-free rear half of the silver mail car with an articulated hatchback lid. */
function buildBayMailCar(geo: THREE.BufferGeometry[], mat: THREE.Material[]): { root: THREE.Group; hatch: THREE.Group } {
  const root = new THREE.Group();
  const silver = 0x8d959b, dark = 0x24292e, glass = 0x3b4e57, amber = 0xdba028, tail = 0xa82e2a, inside = 0x32383d;
  // Lower rear body + wheel arches + bumper
  root.add(boxMesh(geo, mat, 1.78, 0.56, 2.35, silver, 0, 0.58, 0));
  root.add(boxMesh(geo, mat, 1.84, 0.16, 0.22, dark, 0, 0.34, 1.18));
  // Open boot floor & inner walls
  root.add(boxMesh(geo, mat, 1.46, 0.08, 1.15, inside, 0, 0.64, 0.54));
  root.add(boxMesh(geo, mat, 0.16, 0.52, 1.2, silver, -0.81, 0.88, 0.54));
  root.add(boxMesh(geo, mat, 0.16, 0.52, 1.2, silver, 0.81, 0.88, 0.54));
  // Forward cabin roof & pillars
  root.add(boxMesh(geo, mat, 1.56, 0.62, 1.18, silver, 0, 1.15, -0.58));
  root.add(boxMesh(geo, mat, 1.46, 0.44, 0.06, glass, 0, 1.14, 0.02));
  // Amber roof beacon + sign bar (generic, invented)
  root.add(boxMesh(geo, mat, 0.88, 0.16, 0.26, 0x153e36, 0, 1.54, -0.42));
  root.add(boxMesh(geo, mat, 0.16, 0.12, 0.16, amber, 0.56, 1.52, -0.42));
  // Tail lamps & rear wheels
  for (const s of [-1, 1]) {
    root.add(boxMesh(geo, mat, 0.24, 0.14, 0.06, tail, s * 0.72, 0.74, 1.18));
    root.add(boxMesh(geo, mat, 0.22, 0.56, 0.56, dark, s * 0.86, 0.28, 0.55));
    root.add(boxMesh(geo, mat, 0.22, 0.56, 0.56, dark, s * 0.86, 0.28, -0.82));
  }
  // Articulated rear hatchback pivoting at the rear roofline
  const hatch = new THREE.Group();
  hatch.position.set(0, 1.44, 0.02);
  hatch.add(boxMesh(geo, mat, 1.54, 0.09, 1.14, silver, 0, 0.02, 0.56));
  hatch.add(boxMesh(geo, mat, 1.28, 0.05, 0.56, glass, 0, 0.06, 0.48));
  root.add(hatch);
  return { root, hatch };
}

export interface DepotLoadingOptions {
  day: number;
  double?: boolean;
  stops?: number;
  look?: BossLookId;
  touch?: boolean;
  /** When visited from the Port Hood door, offer a button to step into the Boss's office too. */
  onOpenOffice?: () => void;
}

/**
 * Port Hood Mail Depot loading bay interior.
 * Player tosses the day's mail bundles into the open rear hatch of the mail car while the Boss watches.
 */
export class DepotLoadingInterior implements InteriorGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(56, 1, 0.1, 40);
  readonly run: LoadingRun;
  result: InteriorResult | null = null;
  private readonly geo: THREE.BufferGeometry[] = [];
  private readonly mat: THREE.Material[] = [];
  private readonly tex: THREE.Texture[] = [];
  private readonly boss: BossFigure;
  private readonly car: { root: THREE.Group; hatch: THREE.Group };
  private readonly activeBundle: THREE.Mesh;
  private readonly activeMat: THREE.MeshLambertMaterial;
  private readonly stacked = new THREE.Group();
  private stackedCount = 0;
  private readonly size = new THREE.Vector2();
  private readonly panel: HTMLDivElement | null = null;
  private readonly speechEl: HTMLParagraphElement | null = null;
  private readonly tagEl: HTMLParagraphElement | null = null;
  private readonly pinEl: HTMLDivElement | null = null;
  private readonly tossBtn: HTMLButtonElement | null = null;
  private readonly onKeyDown: (ev: KeyboardEvent) => void;
  private readonly touch: boolean;
  private lookAngle = 0;
  private paintedKey = '';

  constructor(options: DepotLoadingOptions) {
    this.touch = !!options.touch;
    this.run = new LoadingRun(options.day, !!options.double, options.stops ?? 0);
    this.scene.background = new THREE.Color(0x1e2529);
    this.scene.add(new THREE.HemisphereLight(0xf3f1e6, 0x625e54, 2.0));
    const key = new THREE.DirectionalLight(0xfff1d6, 0.9);
    key.position.set(2.5, 5.5, 4);
    key.castShadow = false;
    this.scene.add(key);

    // Concrete floor with painted yellow loading bay stripes
    const floorTex = makeCanvas(256, 256, g => {
      g.fillStyle = '#6d716f';
      g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#5c605e';
      for (let i = 0; i < 256; i += 64) { g.fillRect(i, 0, 2, 256); g.fillRect(0, i, 256, 2); }
      g.fillStyle = '#d3a334';
      g.fillRect(14, 0, 10, 256);
      g.fillRect(232, 0, 10, 256);
    });
    if (floorTex) this.tex.push(floorTex);
    this.scene.add(boxMesh(this.geo, this.mat, 10, 0.1, 9, 0xffffff, 0, -0.05, 0, floorTex));

    // Depot bay walls & ceiling with fluorescent strips
    const signTex = makeCanvas(512, 112, g => {
      g.fillStyle = '#2b3c45'; g.fillRect(0, 0, 512, 112);
      g.fillStyle = '#8b242e'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 102, 512, 10);
      g.fillStyle = '#fff9ec'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 34px system-ui, sans-serif'; g.fillText('PORT HOOD MAIL DEPOT', 256, 44);
      g.fillStyle = '#f0cc75'; g.font = '700 18px ui-monospace, monospace';
      g.fillText('BAY 1 · LOAD CAREFULLY · CLOCK RUNS AT 10:00', 256, 80);
    });
    if (signTex) this.tex.push(signTex);

    this.scene.add(
      boxMesh(this.geo, this.mat, 10, 4.2, 0.2, 0x8e9591, 0, 2.1, -3.6), // back wall
      boxMesh(this.geo, this.mat, 0.2, 4.2, 9, 0x838b87, -4.6, 2.1, 0),  // left wall
      boxMesh(this.geo, this.mat, 0.2, 4.2, 9, 0x838b87, 4.6, 2.1, 0),   // right wall
      boxMesh(this.geo, this.mat, 10, 0.2, 9, 0x5c6265, 0, 4.2, 0),      // ceiling
      // Roll-up bay door on back wall cracked slightly with October daylight at top
      boxMesh(this.geo, this.mat, 3.8, 2.8, 0.12, 0xb8beb8, 1.1, 1.4, -3.45),
      boxMesh(this.geo, this.mat, 3.9, 0.14, 0.14, 0x7c1d26, 1.1, 2.86, -3.44),
      boxMesh(this.geo, this.mat, 3.8, 0.78, 0.08, 0xffffff, 1.1, 3.38, -3.46, signTex),
      // Fluorescent light tubes
      boxMesh(this.geo, this.mat, 2.6, 0.08, 0.22, 0xfff8e4, -1.6, 4.04, -0.6),
      boxMesh(this.geo, this.mat, 2.6, 0.08, 0.22, 0xfff8e4, 1.6, 4.04, -0.6),
    );

    // Sorting table & mail racks on the left (-x)
    this.scene.add(
      boxMesh(this.geo, this.mat, 1.35, 0.08, 2.6, 0x997852, -2.15, 0.88, -0.4),
      boxMesh(this.geo, this.mat, 0.09, 0.88, 0.09, 0x3b4246, -2.75, 0.44, -1.6),
      boxMesh(this.geo, this.mat, 0.09, 0.88, 0.09, 0x3b4246, -1.55, 0.44, -1.6),
      boxMesh(this.geo, this.mat, 0.09, 0.88, 0.09, 0x3b4246, -2.75, 0.44, 0.8),
      boxMesh(this.geo, this.mat, 0.09, 0.88, 0.09, 0x3b4246, -1.55, 0.44, 0.8),
      // Background pigeonhole sorting rack
      boxMesh(this.geo, this.mat, 2.3, 1.95, 0.45, 0x6f5a44, -2.4, 0.98, -3.22),
      boxMesh(this.geo, this.mat, 2.1, 1.4, 0.08, 0xdfd8c2, -2.4, 1.15, -2.98),
    );

    // Player's mail car backed into bay on the right (+x), open rear hatch facing the bench & camera
    this.car = buildBayMailCar(this.geo, this.mat);
    this.car.root.position.set(1.25, 0, -0.55);
    this.car.root.rotation.y = -0.35;
    this.car.hatch.rotation.x = -1.12;
    this.car.root.add(this.stacked);
    this.scene.add(this.car.root);

    // The Boss standing behind the sorting bench watching with clipboard
    this.boss = buildBossCharacter(options.look ?? DEFAULT_BOSS_LOOK, 'standing');
    this.boss.root.position.set(-1.35, 0, -1.85);
    this.boss.root.rotation.y = 0.42;
    this.scene.add(this.boss.root);

    // Active bundle waiting on the bench / flying into the open hatch
    this.activeMat = new THREE.MeshLambertMaterial({ color: this.run.bundles[0]?.colour ?? 0xe9e2cf });
    const bg = new THREE.BoxGeometry(0.46, 0.28, 0.36);
    this.geo.push(bg); this.mat.push(this.activeMat);
    this.activeBundle = new THREE.Mesh(bg, this.activeMat);
    this.activeBundle.position.set(-1.75, 1.06, -0.2);
    this.scene.add(this.activeBundle);

    this.camera.position.set(-0.25, 2.05, 3.35);
    this.camera.lookAt(0.05, 1.1, -0.95);

    this.onKeyDown = (ev: KeyboardEvent) => {
      if (ev.repeat || modalOverlayOpen()) return;
      if (ev.code === 'Escape') { ev.preventDefault(); this.leave(); return; }
      if ((ev.code === 'Space' || ev.code === 'Enter') && focusedOnControl(ev)) return;
      if (ev.code === 'Space' || ev.code === 'KeyM' || ev.code === 'KeyE' || ev.code === 'Enter') {
        ev.preventDefault();
        this.run.toss();
      }
    };

    if (typeof document !== 'undefined' && document.body?.appendChild) {
      ensurePanelStyle();
      document.body.classList?.add('depotIndoor');
      const panel = document.createElement('div');
      panel.id = 'depotPanel';
      stopPanelPointer(panel);
      const tag = Object.assign(document.createElement('p'), { className: 'depotTag' });
      const speech = Object.assign(document.createElement('p'), { className: 'depotSpeech' });
      const meter = Object.assign(document.createElement('div'), { className: 'depotMeter' });
      const sweet = Object.assign(document.createElement('div'), { className: 'depotSweet' });
      const pin = Object.assign(document.createElement('div'), { className: 'depotPin' });
      meter.append(sweet, pin);
      const row = Object.assign(document.createElement('div'), { className: 'depotRow' });
      const toss = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', id: 'depotToss' });
      toss.addEventListener('click', () => { this.run.toss(); this.paintUI(); });
      row.append(toss);
      if (options.onOpenOffice) {
        const office = Object.assign(document.createElement('button'), { type: 'button', className: 'secondary', id: 'depotGoOffice', textContent: 'Boss’s office' });
        office.addEventListener('click', () => options.onOpenOffice?.());
        row.append(office);
      }
      panel.append(tag, speech, meter, row);
      document.body.appendChild(panel);
      this.panel = panel;
      this.tagEl = tag;
      this.speechEl = speech;
      this.pinEl = pin;
      this.tossBtn = toss;
      addEventListener('keydown', this.onKeyDown);
      this.paintUI();
    }
  }

  get readout(): string {
    const r = this.run;
    return `DAY ${r.day} LOAD · ${r.count}/${r.total} BUNDLES · ${r.neatCount} NEAT`;
  }

  update(dt: number, input: Input): void {
    const step = Math.max(0, dt);
    this.run.update(step);
    this.lookAngle = THREE.MathUtils.clamp(this.lookAngle + (input.steer * 0.45 - this.lookAngle) * Math.min(1, step * 5), -0.45, 0.45);

    // Sync landed bundles inside the car's boot
    while (this.stackedCount < this.run.loaded.length) {
      const item = this.run.loaded[this.stackedCount];
      const col = this.stackedCount % 3 - 1;
      const tier = Math.floor(this.stackedCount / 3);
      const bx = item.grade === 'neat' ? col * 0.42 : item.lane * 0.56;
      const by = 0.8 + tier * 0.27;
      const bz = 0.36 + (this.stackedCount % 2) * 0.34;
      const piece = boxMesh(this.geo, this.mat, 0.42, 0.25, 0.34, item.bundle.colour, bx, by, bz);
      if (item.grade === 'crammed') piece.rotation.set(0.18, item.lane * 0.5, item.lane * 0.22);
      this.stacked.add(piece);
      this.stackedCount++;
    }

    // Active bundle position: bench or parabolic arc into the car hatch
    if (this.run.flight) {
      const f = this.run.flight;
      this.activeBundle.visible = true;
      this.activeMat.color.setHex(f.bundle.colour);
      const t = Math.min(1, f.t);
      const x = THREE.MathUtils.lerp(-1.75, 1.12 + f.lane * 0.32, t);
      const y = THREE.MathUtils.lerp(1.06, 0.96, t) + Math.sin(t * Math.PI) * 1.15;
      const z = THREE.MathUtils.lerp(-0.2, -0.05, t);
      this.activeBundle.position.set(x, y, z);
      this.activeBundle.rotation.set(t * 2.4, t * 1.6, 0);
    } else if (this.run.current) {
      this.activeBundle.visible = true;
      this.activeMat.color.setHex(this.run.current.colour);
      this.activeBundle.position.set(-1.75, 1.06, -0.2);
      this.activeBundle.rotation.set(0, 0.12, 0);
    } else {
      this.activeBundle.visible = false;
    }

    // Car suspension dip & hatch swing
    this.car.root.position.y = -this.run.bounce * 0.07;
    this.car.hatch.rotation.x = THREE.MathUtils.lerp(-1.12, 0, this.run.hatchClose);

    // Subtle Boss animation: watching the boot & tapping pen against clipboard
    const t = this.run.elapsed;
    this.boss.head.rotation.y = Math.sin(t * 1.1) * 0.14 + (this.run.flight ? 0.25 : 0);
    this.boss.head.rotation.x = Math.sin(t * 2.3) * 0.04;
    this.boss.rightArm.rotation.x = -0.18 + Math.sin(t * 5.2) * 0.08;

    const portrait = this.camera.aspect > 0 && this.camera.aspect < 0.8;
    this.camera.position.set(-0.25 + this.lookAngle * 0.5, portrait ? 2.15 : 2.05, portrait ? 4.25 : 3.35);
    this.camera.lookAt(0.05 + this.lookAngle * 0.6, portrait ? 0.95 : 1.1, -0.95);

    this.paintUI();
    if (this.run.phase === 'done' && !this.result) {
      this.result = {
        delivered: false,
        note: this.run.skipped ? 'Loading bay skipped.' : `Loaded ${this.run.count} bundles (${this.run.neatCount} neat).`,
      };
    }
  }

  private paintUI(): void {
    if (!this.tagEl || !this.speechEl || !this.pinEl || !this.tossBtn) return;
    const r = this.run;
    this.pinEl.style.left = `${((r.needle + 1) * 50).toFixed(1)}%`;
    const next = r.current;
    const key = `${r.phase}:${r.count}:${next?.index ?? -1}:${r.bossLine}`;
    if (key === this.paintedKey) return;
    this.paintedKey = key;
    this.tagEl.textContent = next
      ? `PORT HOOD LOADING BAY · ${r.count}/${r.total} LOADED · NEXT: ${next.label.toUpperCase()}`
      : `PORT HOOD LOADING BAY · ${r.count}/${r.total} LOADED`;
    this.speechEl.textContent = `The Boss: “${r.bossLine}”`;
    this.tossBtn.disabled = r.phase !== 'loading';
    this.tossBtn.textContent = r.phase === 'loading'
      ? (next ? keyHint(`LOAD ${next.label.toUpperCase()}`, this.touch) : 'FINISHING…')
      : 'HATCH SHUT · ROLLING OUT';
  }

  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const size = renderer.getSize(this.size);
    const aspect = size.x / Math.max(1, size.y);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = aspect < 0.8 ? 72 : 56;
      this.camera.updateProjectionMatrix();
    }
    const exp = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.0;
    try { if (draw) draw(this.scene, this.camera); else renderer.render(this.scene, this.camera); }
    finally { renderer.toneMappingExposure = exp; }
  }

  leave(): void {
    this.run.skip();
    if (!this.result) this.result = { delivered: false, note: 'Loading bay skipped.' };
  }

  dispose(): void {
    if (typeof removeEventListener === 'function') removeEventListener('keydown', this.onKeyDown);
    if (typeof document !== 'undefined') document.body?.classList?.remove('depotIndoor');
    this.panel?.remove();
    this.boss.dispose();
    for (const g of this.geo) g.dispose();
    for (const m of this.mat) m.dispose();
    for (const t of this.tex) t.dispose();
    this.scene.clear();
  }
}

export interface DepotInterrogationOptions {
  reason: InterrogationReason;
  day: number;
  complaints?: readonly InterrogationComplaint[];
  look?: BossLookId;
  touch?: boolean;
}

/**
 * The Boss's back-office interrogation room at the Port Hood Mail Depot.
 * The Boss reads out the real complaint lines; player answers change nothing serious.
 */
export class DepotInterrogationInterior implements InteriorGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 30);
  readonly session: InterrogationSession;
  result: InteriorResult | null = null;
  private readonly geo: THREE.BufferGeometry[] = [];
  private readonly mat: THREE.Material[] = [];
  private readonly tex: THREE.Texture[] = [];
  private readonly boss: BossFigure;
  private readonly size = new THREE.Vector2();
  private readonly panel: HTMLDivElement | null = null;
  private readonly tagEl: HTMLParagraphElement | null = null;
  private readonly speechEl: HTMLParagraphElement | null = null;
  private readonly quoteBox: HTMLDivElement | null = null;
  private readonly quoteWho: HTMLElement | null = null;
  private readonly quoteText: HTMLParagraphElement | null = null;
  private readonly actionsEl: HTMLDivElement | null = null;
  private readonly onKeyDown: (ev: KeyboardEvent) => void;
  private readonly touch: boolean;
  private elapsed = 0;
  private lookAngle = 0;
  private paintedKey = '';

  constructor(options: DepotInterrogationOptions) {
    this.touch = !!options.touch;
    this.session = new InterrogationSession(options.reason, options.day, options.complaints ?? []);
    this.scene.background = new THREE.Color(0x252c2e);
    this.scene.add(new THREE.HemisphereLight(0xedf2ea, 0x6c6558, 2.05));
    const lamp = new THREE.PointLight(0xffe7bd, 14, 11, 1.3);
    lamp.position.set(0, 2.35, 0.15);
    lamp.castShadow = false;
    this.scene.add(lamp);
    const fill = new THREE.DirectionalLight(0xfff1d8, 0.55);
    fill.position.set(0.6, 2.2, 2.4);
    fill.castShadow = false;
    this.scene.add(fill);

    // Worn linoleum floor
    const tileTex = makeCanvas(256, 256, g => {
      g.fillStyle = '#5c605c'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#4f5450';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2 === 0) g.fillRect(x * 64, y * 64, 64, 64);
    });
    if (tileTex) this.tex.push(tileTex);

    // Wall corkboard with pinned notes & scribbled route map
    const boardTex = makeCanvas(256, 160, g => {
      g.fillStyle = '#8e6b48'; g.fillRect(0, 0, 256, 160);
      g.strokeStyle = '#543c26'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 152);
      g.fillStyle = '#f2ede0'; g.fillRect(20, 22, 82, 56);
      g.fillStyle = '#e7d58b'; g.fillRect(116, 24, 54, 48);
      g.fillStyle = '#f2ede0'; g.fillRect(180, 20, 56, 68);
      g.fillStyle = '#e7d58b'; g.fillRect(36, 92, 68, 44);
      g.strokeStyle = '#6c7275'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(120, 128); g.quadraticCurveTo(165, 92, 224, 134); g.stroke();
      for (const [px, py] of [[60, 26], [142, 28], [208, 25], [70, 96]]) {
        g.fillStyle = '#b8352f'; g.beginPath(); g.arc(px, py, 4, 0, Math.PI * 2); g.fill();
      }
    });
    if (boardTex) this.tex.push(boardTex);

    // Wall clock stuck near 18:00
    const clockTex = makeCanvas(128, 128, g => {
      g.fillStyle = '#24292d'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f0ece1'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#24292d'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 24); g.moveTo(64, 64); g.lineTo(64, 96); g.stroke();
    });
    if (clockTex) this.tex.push(clockTex);

    // Room shell (4.6 m wide × 4.4 m deep × 2.9 m tall)
    this.scene.add(
      boxMesh(this.geo, this.mat, 4.8, 0.1, 4.6, 0xffffff, 0, -0.05, 0, tileTex),
      boxMesh(this.geo, this.mat, 4.8, 3.0, 0.15, 0x8d9b8f, 0, 1.5, -2.1),   // back wall
      boxMesh(this.geo, this.mat, 4.8, 0.95, 0.17, 0x5c6860, 0, 0.48, -2.08), // wainscot
      boxMesh(this.geo, this.mat, 0.15, 3.0, 4.6, 0x829085, -2.3, 1.5, 0),   // left wall
      boxMesh(this.geo, this.mat, 0.15, 3.0, 4.6, 0x829085, 2.3, 1.5, 0),    // right wall
      boxMesh(this.geo, this.mat, 4.8, 0.15, 4.6, 0xbabfb8, 0, 2.95, 0),     // ceiling
      // Frosted office window on left wall
      boxMesh(this.geo, this.mat, 0.08, 1.25, 1.4, 0xd8e2de, -2.21, 1.72, -0.55),
      // Hanging shade lamp over desk
      boxMesh(this.geo, this.mat, 0.04, 0.52, 0.04, 0x262b2e, 0, 2.68, -0.35),
      boxMesh(this.geo, this.mat, 0.42, 0.16, 0.42, 0x3b4840, 0, 2.38, -0.35),
      boxMesh(this.geo, this.mat, 0.24, 0.05, 0.24, 0xfff0c4, 0, 2.29, -0.35),
      // Corkboard & wall clock on back wall
      boxMesh(this.geo, this.mat, 1.35, 0.85, 0.06, 0xffffff, -1.05, 1.82, -1.99, boardTex),
      boxMesh(this.geo, this.mat, 0.42, 0.42, 0.06, 0xffffff, 1.05, 2.08, -1.99, clockTex),
      // Overflowing metal filing cabinet on right back corner
      boxMesh(this.geo, this.mat, 0.56, 1.42, 0.62, 0x5e696d, 1.65, 0.71, -1.62),
      boxMesh(this.geo, this.mat, 0.46, 0.04, 0.12, 0x353c3f, 1.65, 1.15, -1.29),
      boxMesh(this.geo, this.mat, 0.46, 0.04, 0.12, 0x353c3f, 1.65, 0.75, -1.29),
      boxMesh(this.geo, this.mat, 0.46, 0.04, 0.12, 0x353c3f, 1.65, 0.35, -1.29),
      // Thick stack of complaint folders on top of cabinet
      boxMesh(this.geo, this.mat, 0.34, 0.18, 0.26, 0xd8c38d, 1.62, 1.51, -1.6),
    );

    // Desk between Boss and player
    this.scene.add(
      boxMesh(this.geo, this.mat, 1.72, 0.08, 0.88, 0x6f5137, 0, 0.76, -0.32),
      boxMesh(this.geo, this.mat, 0.44, 0.72, 0.76, 0x59422e, -0.62, 0.36, -0.32),
      boxMesh(this.geo, this.mat, 0.44, 0.72, 0.76, 0x59422e, 0.62, 0.36, -0.32),
      // Thick manila complaint file open on desk + coffee mug
      boxMesh(this.geo, this.mat, 0.42, 0.06, 0.3, 0xd9c28a, 0.02, 0.83, -0.22),
      boxMesh(this.geo, this.mat, 0.36, 0.02, 0.25, 0xf3efe4, 0.02, 0.87, -0.22),
      boxMesh(this.geo, this.mat, 0.1, 0.12, 0.1, 0xd6d2c7, -0.52, 0.86, -0.18),
      // Office chair back behind the Boss
      boxMesh(this.geo, this.mat, 0.56, 0.62, 0.08, 0x2f353b, 0, 0.82, -1.16),
    );

    // The Boss seated behind the desk facing +Z toward the player
    this.boss = buildBossCharacter(options.look ?? DEFAULT_BOSS_LOOK, 'seated');
    this.boss.root.position.set(0, 0, -0.96);
    this.scene.add(this.boss.root);

    this.camera.position.set(0, 1.44, 1.48);
    this.camera.lookAt(0, 1.14, -0.82);

    this.onKeyDown = (ev: KeyboardEvent) => {
      if (ev.repeat || modalOverlayOpen()) return;
      if (ev.code === 'Escape') { ev.preventDefault(); this.leave(); return; }
      if ((ev.code === 'Space' || ev.code === 'Enter') && focusedOnControl(ev)) return;
      if (this.session.phase === 'complaint') {
        if (ev.key === '1' || ev.key === '2' || ev.key === '3') {
          ev.preventDefault();
          this.session.choose(Number(ev.key) - 1);
          this.paintUI();
        }
      } else if (ev.code === 'Space' || ev.code === 'Enter') {
        ev.preventDefault();
        this.session.advance();
        this.paintUI();
      }
    };

    if (typeof document !== 'undefined' && document.body?.appendChild) {
      ensurePanelStyle();
      document.body.classList?.add('depotIndoor');
      const panel = document.createElement('div');
      panel.id = 'depotPanel';
      panel.className = 'office';
      stopPanelPointer(panel);
      const tag = Object.assign(document.createElement('p'), { className: 'depotTag' });
      const speech = Object.assign(document.createElement('p'), { className: 'depotSpeech' });
      const quoteBox = Object.assign(document.createElement('div'), { className: 'depotQuote', hidden: true });
      const quoteWho = document.createElement('strong');
      const quoteText = document.createElement('p');
      quoteBox.append(quoteWho, quoteText);
      const actions = Object.assign(document.createElement('div'), { className: 'depotActions' });
      panel.append(tag, speech, quoteBox, actions);
      document.body.appendChild(panel);
      this.panel = panel;
      this.tagEl = tag;
      this.speechEl = speech;
      this.quoteBox = quoteBox;
      this.quoteWho = quoteWho;
      this.quoteText = quoteText;
      this.actionsEl = actions;
      addEventListener('keydown', this.onKeyDown);
      this.paintUI();
    }
  }

  get readout(): string {
    const s = this.session;
    const step = s.phase === 'intro' ? 'OPENING THE FILE'
      : s.phase === 'closing' ? 'VERDICT ON FILE'
        : `COMPLAINT ${s.index + 1} OF ${s.items.length}`;
    return `THE BOSS’S OFFICE · PORT HOOD DEPOT · ${step}`;
  }

  update(dt: number, input: Input): void {
    const step = Math.max(0, dt);
    this.elapsed += step;
    this.lookAngle = THREE.MathUtils.clamp(this.lookAngle + (input.steer * 0.35 - this.lookAngle) * Math.min(1, step * 5), -0.35, 0.35);

    // Subtle desk animation: Boss leans forward while reading complaints and taps pen on the file
    const reading = this.session.phase === 'complaint';
    const targetZ = reading ? -0.88 : -0.96;
    this.boss.root.position.z += (targetZ - this.boss.root.position.z) * Math.min(1, step * 6);
    this.boss.head.rotation.x = reading ? 0.14 + Math.sin(this.elapsed * 2.2) * 0.04 : Math.sin(this.elapsed * 1.4) * 0.04;
    this.boss.head.rotation.y = Math.sin(this.elapsed * 0.8) * 0.08;
    this.boss.rightArm.rotation.x = this.session.phase === 'response'
      ? -0.22 + Math.sin(this.elapsed * 9) * 0.14
      : -0.06 + Math.sin(this.elapsed * 2.5) * 0.04;

    const portrait = this.camera.aspect > 0 && this.camera.aspect < 0.8;
    this.camera.position.set(this.lookAngle * 0.35, portrait ? 1.56 : 1.52, portrait ? 2.05 : 1.76);
    this.camera.lookAt(this.lookAngle * 0.45, portrait ? 0.96 : 1.0, -0.82);

    this.paintUI();
    if (this.session.phase === 'done' && !this.result) {
      this.result = { delivered: false, note: this.session.skipped ? 'Left the Boss’s office.' : 'Hearing concluded.' };
    }
  }

  private paintUI(): void {
    if (!this.tagEl || !this.speechEl || !this.quoteBox || !this.quoteWho || !this.quoteText || !this.actionsEl) return;
    const s = this.session;
    const key = `${s.phase}:${s.index}:${s.answers}`;
    if (key === this.paintedKey) return;
    this.paintedKey = key;

    this.tagEl.textContent = s.phase === 'intro' ? 'THE BOSS’S OFFICE · PORT HOOD DEPOT'
      : s.phase === 'closing' ? 'VERDICT · UNCHANGED'
        : `THE BOSS’S OFFICE · CALL ${s.index + 1} OF ${s.items.length}`;
    this.speechEl.textContent = `The Boss: “${s.bossSpeech}”`;
    this.quoteBox.hidden = !s.quoteLine;
    if (s.quoteLine) {
      this.quoteWho.textContent = s.quoteCustomer + (s.quoteSeen ? ' · SEEN BY THE BOSS' : '');
      this.quoteText.textContent = `“${s.quoteLine}”`;
    }

    this.actionsEl.replaceChildren();
    if (s.phase === 'complaint') {
      s.choices.forEach((choice, i) => {
        const btn = Object.assign(document.createElement('button'), {
          type: 'button',
          textContent: `${i + 1}. “${choice.label}”`,
        });
        btn.addEventListener('click', () => { s.choose(i); this.paintUI(); });
        this.actionsEl!.appendChild(btn);
      });
    } else if (s.phase !== 'done') {
      const btn = Object.assign(document.createElement('button'), {
        type: 'button',
        className: 'primary',
        id: 'depotNext',
        textContent: s.phase === 'intro' ? keyHint('Hear the complaints', this.touch)
          : s.phase === 'response' ? keyHint(s.index + 1 < s.items.length ? 'Next complaint' : 'Hear the verdict', this.touch)
            : keyHint('Leave office', this.touch),
      });
      btn.addEventListener('click', () => { s.advance(); this.paintUI(); });
      this.actionsEl.appendChild(btn);
    }
  }

  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const size = renderer.getSize(this.size);
    const aspect = size.x / Math.max(1, size.y);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = aspect < 0.8 ? 64 : 50;
      this.camera.updateProjectionMatrix();
    }
    const exp = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.0;
    try { if (draw) draw(this.scene, this.camera); else renderer.render(this.scene, this.camera); }
    finally { renderer.toneMappingExposure = exp; }
  }

  leave(): void {
    this.session.skip();
    if (!this.result) this.result = { delivered: false, note: 'Left the Boss’s office.' };
  }

  dispose(): void {
    if (typeof removeEventListener === 'function') removeEventListener('keydown', this.onKeyDown);
    if (typeof document !== 'undefined') document.body?.classList?.remove('depotIndoor');
    this.panel?.remove();
    this.boss.dispose();
    for (const g of this.geo) g.dispose();
    for (const m of this.mat) m.dispose();
    for (const t of this.tex) t.dispose();
    this.scene.clear();
  }
}

/**
 * Side-by-side comparison room showing all three invented Boss character options (for design review & PR pictures).
 * Reached via ?interior=boss-looks.
 */
export class BossLooksInterior implements InteriorGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 25);
  result: InteriorResult | null = null;
  private readonly geo: THREE.BufferGeometry[] = [];
  private readonly mat: THREE.Material[] = [];
  private readonly tex: THREE.Texture[] = [];
  private readonly figures: BossFigure[] = [];
  private readonly size = new THREE.Vector2();
  private elapsed = 0;

  constructor() {
    this.scene.background = new THREE.Color(0x22292d);
    this.scene.add(new THREE.HemisphereLight(0xf6f3ea, 0x5c574d, 2.0));
    const key = new THREE.DirectionalLight(0xfff1d8, 0.95);
    key.position.set(2, 4, 5);
    key.castShadow = false;
    this.scene.add(key);

    this.scene.add(
      boxMesh(this.geo, this.mat, 6.4, 0.1, 3.6, 0x5d625f, 0, -0.05, 0),
      boxMesh(this.geo, this.mat, 6.4, 3.2, 0.12, 0x7e8a82, 0, 1.6, -1.2),
    );
    const xs = [-1.45, 0, 1.45];
    BOSS_LOOKS.forEach((spec, i) => {
      const fig = buildBossCharacter(spec.id, 'standing');
      fig.root.position.set(xs[i], 0, 0);
      fig.root.rotation.y = (i - 1) * -0.18;
      this.scene.add(fig.root);
      this.figures.push(fig);
      const label = makeCanvas(256, 72, g => {
        g.fillStyle = '#1b242a'; g.fillRect(0, 0, 256, 72);
        g.fillStyle = spec.id === DEFAULT_BOSS_LOOK ? '#d0632e' : '#6c7a82'; g.fillRect(0, 0, 256, 8);
        g.fillStyle = '#f2ead6'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'bold 24px system-ui, sans-serif'; g.fillText(`OPTION ${['A', 'B', 'C'][i]}`, 128, 30);
        g.fillStyle = '#cfd7dc'; g.font = '15px ui-monospace, monospace';
        g.fillText(spec.id.toUpperCase(), 128, 56);
      });
      if (label) this.tex.push(label);
      this.scene.add(boxMesh(this.geo, this.mat, 1.08, 0.28, 0.04, 0xffffff, xs[i], 2.02, -1.1, label));
    });
    this.camera.position.set(0, 1.48, 4.85);
    this.camera.lookAt(0, 1.32, -0.1);
  }

  get readout(): string {
    return 'THE BOSS · THREE INVENTED CHARACTER OPTIONS\nA: Oxblood windbreaker & cap (chosen) · B: Charcoal overcoat & flat cap · C: Olive vest & rolled sleeves';
  }

  update(dt: number, _input: Input): void {
    this.elapsed += dt;
    for (const f of this.figures) f.head.rotation.y = Math.sin(this.elapsed * 0.9) * 0.14;
  }

  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    const size = renderer.getSize(this.size);
    const aspect = size.x / Math.max(1, size.y);
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = aspect < 0.8 ? 60 : 42;
      this.camera.updateProjectionMatrix();
    }
    const exp = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.0;
    try { if (draw) draw(this.scene, this.camera); else renderer.render(this.scene, this.camera); }
    finally { renderer.toneMappingExposure = exp; }
  }

  leave(): void { this.result = { delivered: false, note: 'Comparison closed.' }; }
  dispose(): void {
    for (const f of this.figures) f.dispose();
    for (const g of this.geo) g.dispose();
    for (const m of this.mat) m.dispose();
    for (const t of this.tex) t.dispose();
    this.scene.clear();
  }
}

/** The physical door at the Port Hood Mail Depot building. */
export function depotDoor(site: Pick<DepotSite, 'doorPosition'>, look: BossLookId, onOpenOffice?: () => void, touch = false): Door {
  return {
    id: 'depot',
    name: 'Port Hood Mail Depot',
    position: site.doorPosition,
    radius: DEPOT_DOOR_RADIUS,
    prompt: 'Sorting bay and the Boss’s office. Step inside.',
    leave: touch ? 'STEP OUT' : 'STEP OUT · Esc',
    repeat: true,
    create: day => new DepotLoadingInterior({ day: Math.max(1, day), look, touch, onOpenOffice }),
  };
}
