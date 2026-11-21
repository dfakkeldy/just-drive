import { clientBounds } from './element-visibility';
// A small map in the corner: the roads around the car, today's stops, and which way is north.
// It turns with the car (the way ahead is up). Tap the header to fold it away; tap the map to change the range.
// Built in script, so the test page and the published page cannot drift apart.

import type { Roads } from './roads';
import { TRAIL_COLOUR } from './hikes';
export interface MapLine { pts: readonly (readonly [number, number])[] }
import { LABEL_HEIGHT, labelCap, placeLabels, type LabelBox, type LabelCandidate, type PlacedLabel } from './map-labels';

export interface MapStop { x: number; z: number; due: boolean }
/** `rank` orders the names (0 first, 2 when unset); `radius` is the place's arrival radius in metres. */
export interface MapMark { x: number; z: number; label: string; rank?: number; radius?: number; colour?: string }
export interface MapBounds { x0: number; z0: number; x1: number; z1: number; range: number }
export interface MapUnderlay { draw(g: CanvasRenderingContext2D, bounds: MapBounds): void; idle(): void }

const CSS = `
#miniMap{position:fixed;z-index:3;left:max(10px,env(safe-area-inset-left,0px));top:calc(182px + env(safe-area-inset-top,0px));
  background:var(--panel,rgba(8,14,20,.72));border:1px solid rgba(238,242,246,.22);border-radius:6px;overflow:hidden;
  font:700 10.5px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;color:var(--ink,#eef2f6);user-select:none;-webkit-user-select:none}
#miniMapHead{display:flex;justify-content:space-between;gap:10px;align-items:center;width:100%;min-height:26px;padding:0 8px;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
#miniMapHead:focus-visible{outline:2px solid var(--maple,#d0632e);outline-offset:-2px}
.miniMapBar{display:flex}#miniMapLarge{border:0;background:none;color:inherit;cursor:pointer;padding:4px 8px;font-size:15px}
body.tcOn #miniMapLarge{min-width:56px;min-height:56px}
body.tcOn #miniMap:not(.enlarged) #miniMapLarge{display:none}
body.tcOn #miniMap.enlarged,#miniMap.enlarged{position:fixed;z-index:7;left:50%;top:max(8px,var(--test-safe-top,env(safe-area-inset-top,0px)));transform:translateX(-50%);max-width:calc(100vw - 16px)}
body.tcOn #miniMap.enlarged #miniMapCanvas{max-height:none}
#miniMap.folded #miniMapLarge{display:none}
#miniMapCanvas{display:block;touch-action:none;cursor:pointer}
#miniMap.folded #miniMapCanvas{display:none}
#miniMap.folded #miniMapHead::after{content:'▸'}
#miniMap.folded #miniMapHead span{display:none}   /* a folded map is its name only: its width never changes */
#miniMap[hidden]{display:none}
body.indoorOn #miniMap{display:none}
/* Mirror #hud's 10px top plus the safe inset in web/index.html; leave a 10px gap. */
body.droneOn.droneSticks #miniMap:not(.enlarged){top:calc(20px + env(safe-area-inset-top,0px) + var(--droneHudH,154px));pointer-events:auto}
@media(orientation:landscape) and (max-height:450px){body.droneOn.droneSticks #miniMap:not(.enlarged){top:calc(10px + env(safe-area-inset-top,0px));left:calc(max(10px, var(--test-safe-left, env(safe-area-inset-left, 0px))) + var(--droneCol) + 8px)}}
`;

const RANGES = [450, 1200, 3200];                 // metres from the car to the edge of the map
const COLOUR = ['', '#e9b65c', '#e8e8e2', '#b9a98c', '#7d7667', '#9fb48a'];   // by road kind: highway, paved, gravel, track, trail
const WIDTH = [0, 3, 2, 1.6, 0.8, 1.2];

export class MiniMap {
  private root = document.createElement('div');
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private label = document.createElement('span');
  private boxes: { x0: number; z0: number; x1: number; z1: number }[] = [];
  private range = 0;
  private size = 0;
  private since = 1;
  private folded: boolean;
  private large = false;
  private flight = false;
  private flightHome: Comment | null = null;
  private flightFolded = false;
  private home: Comment | null = null;
  private creditSpace = 0;
  private idle = false;
  /** Get Fired: the Boss's car while it has seen the player (boss.ts), else null. An amber diamond, or an arrow on
   * the rim when it is off the map. */
  boss: { readonly x: number; readonly z: number } | null = null;
  /** Where the last drawing put the Boss, for checks: 'spot', 'arrow' or ''. */
  bossDrawn = '';
  /** The names the last drawing wrote and the boxes they kept clear (car arrow, N), in on-screen pixels (for checks). */
  labels: readonly PlacedLabel[] = [];
  labelKeep: readonly LabelBox[] = [];
  /** The canvas's size on screen (a phone shows it smaller than it is laid out, letterboxed); 0 until measured. */
  private shown = 0;
  private labelSlots = new Map<string, number>();
  private layer: MapUnderlay | null = null;
  get underlay(): MapUnderlay | null { return this.layer; }
  set underlay(layer: MapUnderlay | null) {
    if (this.layer === layer) return;
    this.layer?.idle(); this.layer = layer; this.idle = false;
    this.invalidate();
  }
  private route:readonly {x:number;z:number}[]=[];
  private destination:{x:number;z:number}|null=null;
  setRoute(points:readonly {x:number;z:number}[],destination:{x:number;z:number}):void {this.route=points;this.destination=destination;this.since=1;}

  /** One cart-road look for a history era; set once after construction. */
  cartMap = false;
  constructor(private roads: Roads, private labelled = false, readonly hikeLines: readonly MapLine[] = []) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.root.id = 'miniMap';
    const head = document.createElement('button');
    head.id = 'miniMapHead';
    head.setAttribute('aria-label', 'Show or hide the map');
    head.append('MAP', this.label);
    this.canvas.id = 'miniMapCanvas';
    const bar = Object.assign(document.createElement('div'), { className: 'miniMapBar' });
    const large = Object.assign(document.createElement('button'), { id: 'miniMapLarge', textContent: '⛶', title: 'Enlarge map' });
    large.setAttribute('aria-label', 'Enlarge map'); large.setAttribute('aria-pressed', 'false');
    large.addEventListener('click', () => {
      this.setLarge(!this.large);
    });
    bar.append(head, large);
    this.root.append(bar, this.canvas);
    document.body.appendChild(this.root);
    const panel = document.getElementById('settings');
    if (panel) {
      const expand = Object.assign(document.createElement('button'), { id: 'miniMapEnlargeSetting', textContent: 'Enlarge map' });
      expand.addEventListener('click', () => {
        this.folded = false; head.setAttribute('aria-expanded', 'true'); this.root.classList.remove('folded'); this.setLarge(true); panel.classList.remove('open');
      });
      panel.appendChild(expand);
    }
    // A bounding box per road, so a redraw skips roads that are far away.
    for (const r of roads.roads) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [x, z] of r.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      this.boxes.push({ x0, z0, x1, z1 });
    }
    const saved = (() => { try { return localStorage.getItem('mmm.map'); } catch { return null; } })();
    // Open by default, except on a short screen (a phone held sideways), where the room is needed for the road.
    // Folded at first on a screen too short for the open map and the controls under it (a small phone, or any phone sideways).
    this.folded = saved ? saved === 'folded' : innerHeight < 570;
    this.root.classList.toggle('folded', this.folded);
    this.root.querySelector('#miniMapHead')!.setAttribute('aria-expanded', String(!this.folded));
    head.addEventListener('click', () => {
      if (this.large) this.setLarge(false);
      this.folded = !this.folded;
      if (this.flight) this.flightFolded = this.folded;
      this.root.classList.toggle('folded', this.folded);
      this.root.querySelector('#miniMapHead')!.setAttribute('aria-expanded', String(!this.folded));
      try { localStorage.setItem('mmm.map', this.folded ? 'folded' : 'open'); } catch { /* the choice lasts for this visit */ }
      this.since = 1;
    });
    this.canvas.addEventListener('click', () => { this.range = (this.range + 1) % RANGES.length; this.since = 1; });
    this.fit();
    addEventListener('resize', () => this.fit());
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => {
      this.shown = Math.min(this.canvas.clientWidth, this.canvas.clientHeight); this.since = 1;
    }).observe(this.canvas);
  }

  /** Flight uses the same map outside the hidden phone driving HUD. */
  setFlight(on: boolean): void {
    if (this.flight === on) return;
    if (this.large) this.setLarge(false);
    this.flight = on;
    if (on) {
      this.flightFolded = this.folded; this.folded = false;
      this.flightHome = document.createComment('flight map home'); this.root.before(this.flightHome); document.body.append(this.root);
    } else {
      this.folded = this.flightFolded; this.flightHome?.replaceWith(this.root); this.flightHome = null;
    }
    this.root.classList.toggle('folded', this.folded);
    this.root.querySelector('#miniMapHead')!.setAttribute('aria-expanded', String(!this.folded)); this.fit();
  }

  reserveCredit(pixels: number): void { this.creditSpace = pixels; if (this.large) this.fit(); }
  invalidate(): void {
    this.ctx.save(); this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.ctx.restore(); this.since = 1;
  }

  private setLarge(on: boolean): void {
    if (this.large === on) return;
    this.large = on; this.root.classList.toggle('enlarged', on);
    const button = this.root.querySelector<HTMLButtonElement>('#miniMapLarge')!;
    button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', on ? 'Shrink map' : 'Enlarge map');
    if (on) {
      this.home = document.createComment('map position'); this.root.before(this.home); document.body.append(this.root);
    } else { this.home?.replaceWith(this.root); this.home = null; }
    this.fit();
  }

  private fit() {
    const sticks = this.flight && document.body.classList.contains('droneSticks');
    let flightSize = 156;
    if (sticks) {
      for (const id of ['bigMapButton', 'pauseButton']) {
        const e = document.getElementById(id), r = e && !e.hidden ? e.getBoundingClientRect() : null;
        if (r?.width) flightSize = Math.min(flightSize, r.left - 10 - 8 - 2);
      }
      document.body.style.setProperty('--droneCol', `${flightSize + 2}px`);
    }
    const small = sticks ? flightSize : Math.min(innerWidth, innerHeight) < 520 ? 124 : 176;
    const phone = document.body.classList.contains('tcOn');
    const safe = (side: string) => parseFloat(getComputedStyle(document.getElementById('phoneHud') ?? document.body).getPropertyValue(`--safe-${side}`)) || 0;
    const css = this.large ? Math.max(1, Math.min(600, innerWidth - 24 - safe('left') - safe('right'),
      innerHeight - (phone ? 56 : 28) - 24 - safe('top') - safe('bottom') - this.creditSpace)) : small;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.size = css; this.shown = 0;   // measured again after layout; until then the laid-out size
    if (this.large) this.root.style.width = `${css}px`; else this.root.style.removeProperty('width');
    this.canvas.style.width = this.canvas.style.height = `${css}px`;
    this.canvas.width = this.canvas.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.since = 1;
  }

  /** The next update draws even inside the usual eighth of a second, e.g. when the cars on it change. */
  redrawNext(): void { this.since = 1; }

  show(visible: boolean) { this.root.hidden = !visible; if (!visible && !this.idle) { this.underlay?.idle(); this.idle = true; } }

  private painted(): boolean {
    if (!this.canvas.getClientRects().length) return false;
    const r = this.canvas.getBoundingClientRect();
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
    for (let p = this.canvas.parentElement; p; p = p.parentElement) {
      const style = getComputedStyle(p), b = clientBounds(p);
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) { left = Math.max(left, b.left); right = Math.min(right, b.right); }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
    }
    return right > left && bottom > top;
  }

  /** Call every frame; it redraws about eight times a second. `heading` is the car's (0 = north, clockwise). */
  update(dt: number, x: number, z: number, heading: number, stops: readonly MapStop[], marks: readonly MapMark[], cars?: readonly { x: number; z: number }[], parked: { x: number; z: number } | null = null) {
    this.since += dt;
    if (this.folded || this.root.hidden || document.hidden || document.body.classList.contains('indoorOn')) {
      if (!this.idle) { this.underlay?.idle(); this.idle = true; } return;
    }
    if (this.since < 0.12) return;
    this.since = 0;
    const layerVisible = this.underlay !== null && this.painted();
    if (this.underlay && !layerVisible) { if (!this.idle) this.underlay.idle(); this.idle = true; }
    else this.idle = false;
    const g = this.ctx, s = this.size, half = s / 2, reach = RANGES[this.range], k = half / reach;
    this.label.textContent = reach >= 1000 ? `${(reach / 1000).toFixed(1)} km` : `${reach} m`;
    g.clearRect(0, 0, s, s);
    g.save();
    g.beginPath(); g.rect(0, 0, s, s); g.clip();
    // The car sits a little below the middle, so more of the road ahead shows. World +x is east, +z is south.
    g.translate(half, half * 1.25);
    g.rotate(-heading);
    g.scale(k, k);
    g.translate(-x, -z);
    // The rotated screen's bounding box, not the whole baked land. Draw pictures under every road and label.
    if (this.underlay && layerVisible) {
    const sin = Math.sin(heading), cos = Math.cos(heading);
    const corners = [[0, 0], [s, 0], [s, s], [0, s]].map(([px, py]) => {
      const dx = (px - half) / k, dz = (py - half * 1.25) / k;
      return [x + cos * dx - sin * dz, z + sin * dx + cos * dz];
    });
    this.underlay?.draw(g, { x0: Math.min(...corners.map(p => p[0])), z0: Math.min(...corners.map(p => p[1])),
      x1: Math.max(...corners.map(p => p[0])), z1: Math.max(...corners.map(p => p[1])), range: reach });
    }
    const pad = reach * 1.9;
    g.lineJoin = g.lineCap = 'round';
    for (let pass = 5; pass >= 1; pass--) {
      g.strokeStyle = this.cartMap && pass<=3 ? '#b7a17a' : COLOUR[pass] ?? COLOUR[4];
      g.lineWidth = (this.cartMap && pass<=3 ? 1.6 : WIDTH[pass] ?? 1) / k;
      g.beginPath();
      for (let i = 0; i < this.roads.roads.length; i++) {
        const r = this.roads.roads[i];
        if ((r.kind > 5 ? 4 : r.kind) !== pass) continue;
        if (pass === 4 && reach > 1500) continue;                       // tracks only clutter the wide view
        const b = this.boxes[i];
        if (b.x1 < x - pad || b.x0 > x + pad || b.z1 < z - pad || b.z0 > z + pad) continue;
        g.moveTo(r.pts[0][0], r.pts[0][1]);
        for (let p = 1; p < r.pts.length; p++) g.lineTo(r.pts[p][0], r.pts[p][1]);
      }
      g.stroke();
    }
    if (this.hikeLines.length) {
      g.strokeStyle = TRAIL_COLOUR; g.lineWidth = 2 / k; g.setLineDash([5 / k, 4 / k]);
      for (const line of this.hikeLines) {
        if (!line.pts.length) continue;
        g.beginPath(); g.moveTo(line.pts[0][0], line.pts[0][1]);
        for (const p of line.pts.slice(1)) g.lineTo(p[0], p[1]);
        g.stroke();
      }
      g.setLineDash([]);
    }
    if(this.route.length){g.strokeStyle='#70e4cc';g.lineWidth=3/k;g.beginPath();for(let i=0;i<this.route.length;i++){const p=this.route[i];if(i)g.lineTo(p.x,p.z);else g.moveTo(p.x,p.z);}g.stroke();}
    if(this.destination){const d=this.destination;g.fillStyle='#ffe295';g.fillRect(d.x-5/k,d.z-5/k,10/k,10/k);}
    // Today's stops: bright while mail is still due there, dim once done.
    const dot = (reach > 1500 ? 2.2 : 3.2) / k;
    for (const st of stops) {
      if (Math.abs(st.x - x) > pad || Math.abs(st.z - z) > pad) continue;
      g.fillStyle = st.due ? '#ff8a3d' : 'rgba(150,170,150,.55)';
      g.beginPath(); g.arc(st.x, st.z, st.due ? dot : dot * 0.7, 0, 6.283); g.fill();
    }
    for (const m of marks) {
      if (Math.abs(m.x - x) > pad || Math.abs(m.z - z) > pad) continue;
      // A coloured mark (the room game's parcel) is drawn larger, so it reads at a glance.
      const r = m.colour ? dot * 1.8 : dot;
      g.fillStyle = m.colour ?? '#7fd4ff';
      g.fillRect(m.x - r, m.z - r, r * 2, r * 2);
    }
    if (cars?.length) {
      g.fillStyle = '#e18bff';
      for (const car of cars) {
        if (Math.abs(car.x - x) > pad || Math.abs(car.z - z) > pad) continue;
        g.beginPath(); g.arc(car.x, car.z, 2.5 / k, 0, 6.283); g.fill();
      }
    }
    if (parked) {
      g.fillStyle = '#ffca64'; g.strokeStyle = '#10181f'; g.lineWidth = 1.5 / k;
      g.beginPath(); g.arc(parked.x, parked.z, 4 / k, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
    // The compass turns with north. Its letters stay upright.
    const R = half - 7;
    const shown = this.shown || s, tiny = shown < 100 && shown < s;
    const compass = ['N', 'E', 'S', 'W'].map((letter, i) => ({ letter,
      x: half + Math.sin(i * Math.PI / 2 - heading) * R,
      y: half - Math.cos(i * Math.PI / 2 - heading) * R })).filter(({letter}) => !tiny || letter === 'N');
    const cy = half * 1.25;
    if (this.labelled) {
      // Placed and drawn in on-screen pixels: a phone shows this canvas smaller than it is laid out, and names
      // must stay 10 px tall there too.
      const shown = this.shown || s, f = shown / s;
      g.save(); g.scale(1 / f, 1 / f);
      g.font = '700 10px system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      const candidates: LabelCandidate[] = [], cos = Math.cos(heading), sin = Math.sin(heading);
      for (const mark of marks) {
        const dx = mark.x - x, dz = mark.z - z;
        const px = half + (cos * dx + sin * dz) * k, py = cy + (-sin * dx + cos * dz) * k;
        if (px < 0 || px > s || py < 0 || py > s) continue;
        const distance = Math.hypot(dx, dz);
        candidates.push({ label: mark.label, px: px * f, py: py * f, rank: mark.rank ?? 2, distance, here: mark.radius !== undefined && distance <= mark.radius });
      }
      this.labelKeep = [{ x0: (half - 8) * f, y0: (cy - 10) * f, x1: (half + 8) * f, y1: (cy + 8) * f },
        ...compass.map(({letter, x, y}) => { const pad = letter === 'N' ? 22 : 10; return { x0: x * f - pad, y0: y * f - pad, x1: x * f + pad, y1: y * f + pad }; })];
      this.labels = placeLabels(candidates, { size: shown, cap: labelCap(shown, reach), measure: text => g.measureText(text).width,
        circle: {cx: half*f, cy: half*f, r: R*f - 6}, keep: this.labelKeep, previous: this.labelSlots });
      this.labelSlots = new Map(this.labels.map(l => [l.label, l.slot]));
      // A dark rim round the letters, not a filled box, so the roads under a name still show.
      g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = 'rgba(11,22,32,.9)'; g.fillStyle = '#bceaff';
      for (const l of this.labels) g.strokeText(l.label, l.x0, l.y0 + (LABEL_HEIGHT - 10) / 2);
      for (const l of this.labels) g.fillText(l.label, l.x0, l.y0 + (LABEL_HEIGHT - 10) / 2);
      g.restore();
    }
    // The car, always pointing up.
    g.fillStyle = '#ffffff'; g.strokeStyle = '#10181f'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(half, half * 1.25 - 8); g.lineTo(half + 5.5, half * 1.25 + 6); g.lineTo(half - 5.5, half * 1.25 + 6); g.closePath();
    g.fill(); g.stroke();
    // The rim and its ticks turn with north. Letters stay upright.
    g.save(); g.translate(half, half); g.rotate(-heading);
    g.strokeStyle = '#b9c3cc'; g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 16; i++) {
      g.rotate(Math.PI / 8); g.beginPath(); g.moveTo(0, -R); g.lineTo(0, -R + 3); g.stroke();
    }
    g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const {letter, x: px, y: py} of compass) {
      g.fillStyle = 'rgba(11,22,32,.9)';
      if (letter === 'N') { g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); }
      g.font = `700 ${letter === 'N' ? 11 : 10}px ui-monospace,Menlo,monospace`;
      g.lineWidth = 3; g.strokeStyle = 'rgba(11,22,32,.9)';
      if (letter !== 'N') g.strokeText(letter, px, py);
      g.fillStyle = letter === 'N' ? '#ff5a4a' : '#8a99a6'; g.fillText(letter, px, py);
    }
    // The Boss last, over the car's own arrow: close behind, it would hide under it.
    this.bossDrawn = '';
    if (this.boss) {
      const dx = this.boss.x - x, dz = this.boss.z - z, cos = Math.cos(heading), sin = Math.sin(heading), cy = half * 1.25;
      let px = half + (cos * dx + sin * dz) * k, py = cy + (-sin * dx + cos * dz) * k;
      const edge = 9, off = px < edge || px > s - edge || py < edge || py > s - edge;
      if (off) {
        // Clamp along the line from the car, then point the arrow along it.
        const ux = px - half, uy = py - cy, t = Math.min(ux ? ((ux > 0 ? s - edge : edge) - half) / ux : Infinity, uy ? ((uy > 0 ? s - edge : edge) - cy) / uy : Infinity);
        px = half + ux * t; py = cy + uy * t;
      }
      g.save(); g.translate(px, py); g.fillStyle = '#ffa526'; g.strokeStyle = '#10181f'; g.lineWidth = 1.5; g.beginPath();
      if (off) { g.rotate(Math.atan2(py - cy, px - half)); g.moveTo(8, 0); g.lineTo(-5, 6); g.lineTo(-5, -6); }
      else { g.moveTo(0, -6); g.lineTo(6, 0); g.lineTo(0, 6); g.lineTo(-6, 0); }
      g.closePath(); g.fill(); g.stroke(); g.restore();
      this.bossDrawn = off ? 'arrow' : 'spot';
    }
  }
}
