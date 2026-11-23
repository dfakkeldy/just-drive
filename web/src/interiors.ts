import type * as THREE from 'three';
import type { Input } from './vehicle';
export interface InteriorResult { delivered: boolean; note: string; bonus?: number; score?: number }
/** An optional external link with plain instructions, shown only while its door or stop is active. */
export interface InteriorLink { readonly url: string; readonly label: string; readonly note: string }
export interface InteriorGame {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly result: InteriorResult | null;
  readonly readout: string;
  readonly link?: InteriorLink | null;
  update(dt: number, input: Input): void;
  /** `draw`, when given, takes the place of `renderer.render` (finish.ts `EdgeSamples`). */
  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void;
  leave(): void;
  dispose(): void;
}
export interface Door {
  id: string; name: string; position: { x: number; z: number }; radius: number; prompt: string;
  /** Words on the way-out button. The default is the mine's. */
  leave?: string;
  /** Phone control names for this room. Naming `go` shows the forward pedal, which the mine does not use. */
  controls?: { go?: string; brake: string; steer: string };
  /** A room that may be entered again in the same shift. */
  repeat?: boolean;
  /** A room entered after the shift has ended (e.g. the Boss's office from the shift report), when frame dt is 0. */
  afterShift?: boolean;
  /** Optional external link shown on the stopped door prompt and pause screen while parked here. */
  link?: InteriorLink;
  create(day: number): InteriorGame;
}
export type InteriorReceipt = { door: Pick<Door, 'id' | 'name' | 'position'>; result: InteriorResult };
type Passage = { kind: 'drive' } | { kind: 'entering' | 'inside' | 'leaving'; door: Door; game: InteriorGame; time: number };
const LEAVE = 'CLIMB OUT · Esc';
/** Speeds below this (km/h) count as parked for the church donation link. */
export const PARKED_KMH = 0.5;
const CSS = `
#doorPrompt,#interiorHud{position:fixed;z-index:7;color:#eee6d6;background:rgba(13,19,20,.92);border:1px solid #8e8063;font:14px/1.5 ui-monospace,monospace;padding:14px 18px;border-radius:6px;box-sizing:border-box}
#doorPrompt{bottom:32px;left:50%;transform:translateX(-50%);max-width:min(520px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow-y:auto;text-align:center}
#doorPrompt strong,#interiorHud strong{display:block;color:#efbb68;letter-spacing:.08em;font-size:12px}
#doorPrompt button,#interiorHud button{font:700 13px ui-monospace,monospace;color:#fff3d6;border:1px solid #b58b50;background:#684326;padding:12px 18px;border-radius:3px;min-height:44px;cursor:pointer}
#doorPrompt button{margin:8px 0 0}#doorPrompt button:disabled{opacity:.55;cursor:default}
#interiorHud{top:max(16px,env(safe-area-inset-top));left:16px;right:16px;max-width:680px;max-height:calc(100dvh - 110px);overflow-y:auto;white-space:pre-line;display:grid;grid-template-columns:1fr auto;column-gap:12px}
#interiorHud button{grid-column:2;grid-row:1;margin:0;background:#292e2c}#interiorHud>strong{grid-column:1;grid-row:1;align-self:center}#interiorReadout{grid-column:1/-1;margin-top:8px}
.interiorLink{grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid rgba(142,128,99,.45);font:12px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#eee6d6;text-align:left;white-space:normal}
.interiorLink[hidden]{display:none}
.interiorLink a{color:#f6cc84;font-weight:700;text-decoration:underline;text-underline-offset:3px;display:inline-block;padding:13px 2px;margin:-11px -2px}
.interiorLink a:focus-visible{outline:3px solid #fff;outline-offset:2px;border-radius:2px}
body.padMode #doorSupport::after{content:'Controller: Y to go in · Start for menu to open link.';display:block;margin-top:6px;color:#efbb68;font:11px/1.4 ui-monospace,monospace}
body.padMode #interiorSupport::after{content:'Controller: D-pad + A to open link · B to step out.';display:block;margin-top:6px;color:#efbb68;font:11px/1.4 ui-monospace,monospace}
#doorPrompt[hidden],#interiorHud[hidden]{display:none}
#interiorFade{position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:30}
body.indoorOn :is(#hud,#shiftHud,#stopHint,#mailScore,#mailButton,#cameraButton,#endShift,#photoTag,#photoFlash,#gear,#credit,#touch,#tcReset,#tcView,#tcHorn,#placesButton,#placeArrival,#droneButton){display:none!important}
body.indoorOn:not(.indoorGo) #tcGo{display:none!important}
body.indoorGo #tcGo{font-size:0}body.indoorGo #tcGo::after{content:var(--indoor-go,'GO');font-size:14px}
body.indoorOn #tcBrake{font-size:0}body.indoorOn #tcBrake::after{content:var(--indoor-brake,'BRAKE');font-size:14px}
body.indoorOn #tcKnob{font-size:0}body.indoorOn #tcKnob::after{content:var(--indoor-steer,'LEAN');font-size:10px}
@media(max-width:600px){#doorPrompt{top:190px;bottom:auto;width:calc(100% - 32px);max-height:calc(100dvh - 300px)}#interiorHud{font-size:12px;left:10px;right:10px;padding:12px}#interiorHud button{font-size:11px;padding:8px}body.indoorOn #tcTrack{width:70%;bottom:48px}body.indoorOn #tcBrake{right:16px;bottom:48px;width:90px;height:110px}body.indoorOn #tcSteer{width:68%}}
@media(max-height:500px){#doorPrompt:not([hidden]){top:calc(62px + var(--phone-top-gap,6px) + var(--test-safe-top,env(safe-area-inset-top,0px)));left:calc(88px + var(--test-safe-left,env(safe-area-inset-left,0px)));right:calc(70px + var(--test-safe-right,env(safe-area-inset-right,0px)));bottom:auto;transform:none;width:auto;max-width:440px;margin:0 auto;max-height:calc(100dvh - 146px - var(--phone-top-gap,6px) - var(--test-safe-top,env(safe-area-inset-top,0px)) - var(--test-safe-bottom,env(safe-area-inset-bottom,0px)));padding:6px 10px;font-size:11.5px;line-height:1.3;text-align:left;display:grid;grid-template-columns:1fr auto;column-gap:10px;align-items:center}#doorPrompt strong{grid-column:1;grid-row:1}#doorPrompt>div:not(.interiorLink){grid-column:1;grid-row:2}#doorPrompt button{grid-column:2;grid-row:1/3;margin:0;padding:8px 12px}#doorPrompt .interiorLink{grid-column:1/-1;grid-row:3;margin-top:6px;padding-top:6px;font-size:11px;line-height:1.3}}
`;
/** Renders or removes an optional external link without leaving dormant anchors in the DOM. */
export function renderInteriorLink(box: HTMLElement | null, link: InteriorLink | null, linkId: string): void {
  if (!box) return;
  if (typeof box.replaceChildren === 'function') box.replaceChildren();
  else { (box as unknown as { children: unknown[] }).children = []; box.textContent = ''; }
  box.hidden = !link;
  if (!link) return;
  const a = document.createElement('a');
  a.id = linkId;
  a.href = link.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = link.label;
  const note = document.createElement('span');
  note.textContent = link.note;
  box.append(a, note);
  // Keep box.textContent populated under minimal Node DOM mocks whose append() only pushes into children[].
  if (!box.textContent) box.textContent = `${link.label}${link.note}`;
}
/** Owns passage, once-per-shift visits and shared UI. Factories own their scenes and rules. */
export class Interiors {
  readonly doors = new Map<string, Door>();
  private readonly visited = new Set<string>();
  private passage: Passage = { kind: 'drive' };
  private nearby: Door | null = null;
  private parked = false;
  private returnFade = 0;
  private lastWall = 0;
  private shownPromptLink: InteriorLink | null = null;
  private shownHudLink: InteriorLink | null = null;
  private readonly prompt = document.createElement('div');
  private readonly hud = document.createElement('div');
  private readonly fade = document.createElement('div');
  private readonly enterButton = document.createElement('button');
  private readonly promptName = document.createElement('strong');
  private readonly promptText = document.createElement('div');
  private readonly promptLink = document.createElement('div');
  private readonly readout = document.createElement('div');
  private readonly hudLink = document.createElement('div');
  private readonly clockText = document.createElement('strong');
  private readonly leaveButton = document.createElement('button');
  constructor(private readonly day: () => number, private readonly clock: () => string,
    private readonly receive: (receipt: InteriorReceipt) => void, private readonly bare = false) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.prompt.id = 'doorPrompt'; this.hud.id = 'interiorHud'; this.fade.id = 'interiorFade'; this.readout.id = 'interiorReadout';
    this.promptLink.id = 'doorSupport'; this.promptLink.className = 'interiorLink'; this.promptLink.hidden = true;
    this.hudLink.id = 'interiorSupport'; this.hudLink.className = 'interiorLink'; this.hudLink.hidden = true;
    this.enterButton.textContent = 'GO IN · G';
    this.enterButton.addEventListener('click', () => this.enter());
    const leave = this.leaveButton; leave.textContent = LEAVE; leave.addEventListener('click', () => this.leave());
    this.prompt.append(this.promptName, this.promptText, this.enterButton, this.promptLink);
    this.hud.append(leave, this.clockText, this.readout, this.hudLink);
    this.prompt.hidden = this.hud.hidden = true;
    document.body.append(this.prompt, this.hud, this.fade);
  }
  private syncPromptLink(link: InteriorLink | null): void {
    if (link === this.shownPromptLink) return;
    this.shownPromptLink = link;
    renderInteriorLink(this.promptLink, link, 'doorSupportLink');
  }
  private syncHudLink(link: InteriorLink | null): void {
    if (link === this.shownHudLink) return;
    this.shownHudLink = link;
    renderInteriorLink(this.hudLink, link, 'interiorSupportLink');
  }
  register(door: Door): void {
    if (this.doors.has(door.id)) throw new Error(`Duplicate interior door: ${door.id}`);
    this.doors.set(door.id, door);
  }
  get busy(): boolean { return this.passage.kind !== 'drive'; }
  get canEnter(): boolean { return this.passage.kind === 'drive' && !!this.nearby && !this.visited.has(this.nearby.id); }
  get nearbyId(): string | null { return this.passage.kind === 'drive' ? (this.nearby?.id ?? null) : null; }
  get activeLink(): InteriorLink | null {
    if (this.bare) return null;
    return this.passage.kind === 'drive' ? (this.parked ? (this.nearby?.link ?? null) : null)
      : this.passage.kind === 'inside' ? (this.passage.game.link ?? null) : null;
  }
  get doorId(): string | null { return this.passage.kind === 'drive' ? null : this.passage.door.id; }
  get game(): InteriorGame | null { return this.passage.kind === 'drive' ? null : this.passage.game; }
  /** Refreshes the parked gate after vehicle motion in the same frame so links never lag behind acceleration. */
  syncSpeed(speed: number): void {
    if (this.passage.kind !== 'drive') return;
    this.parked = !!this.nearby && Math.abs(speed) * 3.6 < PARKED_KMH;
    this.syncPromptLink(this.prompt.hidden || !this.parked ? null : (this.nearby?.link ?? null));
  }
  reset(): void {
    this.game?.dispose(); this.passage = { kind: 'drive' }; this.visited.clear(); this.nearby = null; this.parked = false; this.lastWall = 0;
    this.hud.hidden = this.prompt.hidden = true; this.syncPromptLink(null); this.syncHudLink(null);
    this.returnFade = 0; this.fade.style.opacity = '0'; this.dress(null);
  }
  /** The shared indoor page state: hidden driving controls, and this room's names for the ones that stay. */
  private dress(door: Door | null): void {
    const body = document.body, names = door?.controls;
    if (door) body.classList.add('indoorOn'); else body.classList.remove('indoorOn');
    if (names?.go) body.classList.add('indoorGo'); else body.classList.remove('indoorGo');
    for (const [key, text] of [['go', names?.go], ['brake', names?.brake], ['steer', names?.steer]] as const) {
      if (text) body.style.setProperty(`--indoor-${key}`, JSON.stringify(text)); else body.style.removeProperty(`--indoor-${key}`);
    }
    this.leaveButton.textContent = door?.leave ?? LEAVE;
  }
  enter(id?: string): void {
    const door = id ? this.doors.get(id) : this.nearby;
    if (!door || this.busy || this.visited.has(door.id)) return;
    if (!door.repeat) this.visited.add(door.id);
    this.lastWall = 0;
    this.passage = { kind: 'entering', door, game: door.create(this.day()), time: 0 };
    this.prompt.hidden = true; this.syncPromptLink(null); this.syncHudLink(null); this.dress(door);
  }
  leave(): void {
    if (this.passage.kind === 'drive' || this.passage.kind === 'leaving') return;
    this.passage.game.leave(); this.syncHudLink(null); this.passage = { ...this.passage, kind: 'leaving', time: 0 };
  }
  /** Used at closing time so the unfinished parcel reaches the report before the report opens. */
  closeForDay(): void {
    if (this.passage.kind === 'drive') return;
    this.passage.game.leave(); this.finish();
  }
  private finish(): void {
    if (this.passage.kind === 'drive') return;
    const { door, game } = this.passage;
    const result = game.result ?? { delivered: false, note: 'Shift ended at the door.' };
    this.syncHudLink(null);
    game.dispose(); this.passage = { kind: 'drive' }; this.returnFade = .4; this.lastWall = 0;
    this.hud.hidden = true; this.dress(null);
    this.receive({ door, result });
  }
  update(dt: number, input: Input, player: { x: number; z: number; speed: number }, enabled: boolean): void {
    const p = this.passage;
    if (p.kind === 'drive') {
      this.returnFade = Math.max(0, this.returnFade - dt); this.fade.style.opacity = String(this.returnFade / .4);
      const kmh = Math.abs(player.speed) * 3.6;
      this.nearby = enabled && kmh < 3 ? [...this.doors.values()].find(d => d.radius > 0 && Math.hypot(d.position.x - player.x, d.position.z - player.z) <= d.radius) ?? null : null;
      this.parked = !!this.nearby && kmh < PARKED_KMH;
      this.prompt.hidden = !this.nearby || this.bare;
      if (this.nearby) {
        const done = this.visited.has(this.nearby.id);
        this.promptName.textContent = this.nearby.name;
        this.promptText.textContent = done ? 'Already visited today. The door has kept a record.' : this.nearby.prompt;
        this.enterButton.disabled = done;
      }
      this.syncPromptLink(this.prompt.hidden || !this.parked ? null : (this.nearby?.link ?? null));
      return;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const step = dt > 0 ? dt : p.door.afterShift && typeof document !== 'undefined' && !document.hidden && this.lastWall
      ? Math.min(0.05, Math.max(0, (now - this.lastWall) / 1000)) : 0;
    this.lastWall = now;
    p.time += step;
    if (p.kind === 'entering') {
      this.fade.style.opacity = String(Math.min(1, p.time / .4));
      if (p.time >= .4) this.passage = { ...p, kind: 'inside', time: 0 };
    } else if (p.kind === 'leaving') {
      this.fade.style.opacity = String(Math.min(1, p.time / .4));
      if (p.time >= .4) this.finish();
    } else {
      this.fade.style.opacity = String(Math.max(0, 1 - p.time / .4));
      p.game.update(step, input);
      this.hud.hidden = this.bare;
      // Day 0 is a drive with no shift: there is no day or clock to show.
      this.clockText.textContent = this.day() > 0 ? `${p.door.name.toUpperCase()} · DAY ${this.day()} · ${this.clock()}` : p.door.name.toUpperCase();
      this.readout.textContent = p.game.readout;
      if (p.game.result) { this.syncHudLink(null); this.passage = { ...p, kind: 'leaving', time: 0 }; }
      else this.syncHudLink(this.bare ? null : (p.game.link ?? null));
    }
  }
  render(renderer: THREE.WebGLRenderer, draw?: (scene: THREE.Scene, camera: THREE.Camera) => void): void {
    if (this.passage.kind === 'inside' || this.passage.kind === 'leaving') this.passage.game.render(renderer, draw);
  }
}
