import type { Roads } from './roads';
import type { Terrain } from './terrain';
import { nearestPlacement, placePosition, type Place } from './places';
import type { PlacesActions } from './places-ui';
import { hikeFacts, typing, TRAIL_CAUTION, TRAIL_COLOUR, type Hike, type MapBox, type Point } from './hikes';

const ROAD_COLOURS = ['', '#e9b65c', '#e8e8e2', '#b9a98c', '#7d7667', '#9fb48a'];
const ROAD_WIDTHS = [0, 3, 2, 1.6, .8, 1.2];
const CSS = `
#bigMapButton{position:fixed;cursor:pointer}
body.droneOn.droneSticks #bigMapButton{position:fixed;top:calc(76px + env(safe-area-inset-top,0px));right:calc(104px + env(safe-area-inset-right,0px));width:70px;height:56px;box-sizing:border-box;z-index:6;pointer-events:auto;margin:0;padding:0 8px;border:1px solid rgba(238,242,246,.3);border-radius:10px;background:var(--panel);color:var(--ink);font:700 12px var(--mono)}
body.tcOn #bigMapButton{position:static;min-width:56px;min-height:56px;flex:none;pointer-events:auto;margin:0}
#bigMap{position:fixed;inset:0;z-index:23;display:grid;grid-template-rows:auto minmax(0,1fr) auto;background:#17323c;color:#f2f1e4;font:14px/1.4 system-ui,sans-serif;box-sizing:border-box;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}
#bigMap[hidden],#bigMapButton[hidden],#mapCard[hidden],#mapIndex[hidden]{display:none}
#bigMap header{display:flex;gap:6px;align-items:center;padding:8px 12px;background:#10242b;border-bottom:1px solid #668085}
#bigMap h2{margin:0 auto 0 0;font:600 20px/1.15 "Iowan Old Style",Palatino,Georgia,serif}#bigMap button{min-height:44px;min-width:44px;cursor:pointer;background:#24414a;border:1px solid #779398;border-radius:6px;color:inherit;padding:8px 12px;font:inherit}
#bigMap button:focus-visible{outline:3px solid #fff;outline-offset:2px}
#mapStage{position:relative;min-height:0;overflow:hidden}#bigMapCanvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}#bigMapCanvas:active{cursor:grabbing}
#mapIndex,#mapCard{position:absolute;right:12px;top:12px;box-sizing:border-box;width:min(330px,calc(100% - 24px));max-height:calc(100% - 24px);overflow:auto;background:#10242bf5;border:1px solid #93aaa0;border-radius:9px;padding:16px;box-shadow:0 6px 24px #07151b66;overscroll-behavior:contain}
#mapIndex h3,#mapCard h3{margin:0 0 10px;font-size:20px}#mapIndex button{display:block;width:100%;text-align:left;margin:6px 0}#mapIndex button[data-hike]{border-left:4px solid ${TRAIL_COLOUR}}
#mapCard p{margin:10px 0}#mapCard .mapFacts{color:#d5e5b9}#mapCard .mapCaution{font-size:12px;color:#c9d6d3}#mapCard button{margin-right:6px}#mapStatus{font-size:13px;color:#ffdcaf}
#mapLegend{display:flex;gap:6px 20px;flex-wrap:wrap;align-items:center;padding:8px 16px;background:#10242b;border-top:1px solid #668085;font-size:12px}#mapLegend p{margin:0;flex-basis:100%;color:#b9ccc8}.mapSample{display:inline-block;width:22px;border-top:3px solid;vertical-align:middle;margin-right:5px}.mapTrail{border-top:3px dashed ${TRAIL_COLOUR}}
@media(max-width:600px){#bigMap header{padding:6px;gap:4px}#bigMap h2{display:none}#bigMap header button{padding:8px;flex:1;font-size:12px;min-height:48px}#mapLegend{font-size:10px;padding:6px 10px;gap:4px 12px}#mapCard,#mapIndex{padding:12px}#mapCard h3{font-size:18px}}
@media(max-height:450px){#bigMap header{padding:4px 10px}#bigMap h2{font-size:16px}#mapLegend{font-size:10px;padding:4px 10px;gap:3px 12px}#mapLegend p{flex-basis:auto;flex:1;min-width:220px}#mapCard{font-size:12px;padding:12px}#mapCard p{margin:6px 0}}
`;
interface Traveller { x: number; z: number; heading: number }
type Rect = { x: number; y: number; w: number; h: number };
/** North-up chart. Static roads/shore/brooks are cached in a Retina layer with half a viewport of pan margin.
 * Only input, resize, a new position or the initial cover read invalidates the view; idle frames draw nothing. */
export class BigMap {
  private readonly root = document.createElement('section');
  private readonly button = document.createElement('button');
  private readonly canvas = document.createElement('canvas');
  private readonly g = this.canvas.getContext('2d')!;
  private readonly layer = document.createElement('canvas');
  private readonly shore = document.createElement('canvas');
  private readonly paths: Path2D[] = [];
  private readonly brook = new Path2D();
  private readonly stage: HTMLElement;
  private readonly card: HTMLElement;
  private readonly index: HTMLElement;
  private restore: HTMLElement | null = null;
  private inert: { node: HTMLElement; was: boolean }[] = [];
  private center: Point;
  private scale = 1;
  private fitScale = 1;
  private w = 0; private h = 0; private dpr = 1;
  private cached: { center: Point; scale: number } | null = null;
  private coverReady = false;
  private queued = false;
  private traveller: Traveller = { x: 0, z: 0, heading: 0 };
  private pointers = new Map<number, Point>();
  private down: Point | null = null;
  private moved = false;
  private readonly heldKeys = new Set<string>();
  private readonly suppressed = new Set<string>();
  private labels: Rect[] = [];
  private hitMarks: { place: Place; x: number; y: number; rect?: Rect }[] = [];
  readonly lines;
  constructor(private terrain: Terrain, private roads: Roads, readonly places: readonly Place[], readonly hikes: readonly Hike[], readonly box: MapBox, private actions: PlacesActions) {
    this.center = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    this.lines = hikes.flatMap(h => h.line ?? []);
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.button.id = 'bigMapButton'; this.button.textContent = 'MAP'; this.button.type = 'button'; this.button.setAttribute('aria-haspopup', 'dialog');
    // A keyboard press (detail 0) returns focus here on close; a click or tap leaves no control focused, so Space stays the brake.
    this.button.addEventListener('click', ev => this.open(ev.detail === 0 ? this.button : null));
    this.root.id = 'bigMap'; this.root.hidden = true; this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-labelledby', 'bigMapHeading');
    this.root.innerHTML = `<header><h2 id="bigMapHeading">Explore the land</h2><button id="mapWhole">Whole area</button><button id="mapPlacesToggle" aria-expanded="false">Places</button><button id="mapZoomIn" aria-label="Zoom in">+</button><button id="mapZoomOut" aria-label="Zoom out">−</button><button id="mapClose">Close · Esc</button></header><div id="mapStage"><aside id="mapIndex" aria-label="Places and hikes" hidden></aside><article id="mapCard" aria-live="polite" hidden></article></div><footer id="mapLegend"><span><i class="mapSample" style="color:#e9b65c"></i>Highway</span><span><i class="mapSample" style="color:#e8e8e2"></i>Paved</span><span><i class="mapSample" style="color:#b9a98c"></i>Gravel</span><span><i class="mapSample" style="color:#7d7667"></i>Track</span><span><i class="mapSample" style="color:#9fb48a"></i>Rail trail</span><span><i class="mapSample mapTrail"></i>Hikes</span><span>● Places · ▲ You are here</span><p>${TRAIL_CAUTION}</p></footer>`;
    this.stage = this.root.querySelector('#mapStage')!; this.card = this.root.querySelector('#mapCard')!; this.index = this.root.querySelector('#mapIndex')!;
    this.canvas.id = 'bigMapCanvas'; this.canvas.setAttribute('aria-label', 'North-up map. Drag to pan, wheel or pinch to zoom. Use Places to choose a place or hike with the keyboard.');
    this.stage.prepend(this.canvas); document.body.append(this.button, this.root);
    this.index.append(Object.assign(document.createElement('h3'), { textContent: 'Places' }));
    if (!places.length) this.index.append(Object.assign(document.createElement('p'), { textContent: 'No places or hikes are listed for this area yet.' }));
    for (const place of places) {
      const b = document.createElement('button'); b.textContent = place.name; b.dataset.mapPlace = place.id; b.addEventListener('click', () => this.showCard(place)); this.index.append(b);
    }
    if (hikes.length) this.index.append(Object.assign(document.createElement('h3'), { textContent: 'Hikes' }));
    for (const hike of hikes) {
      const place = places.find(p => p.id === hike.trailhead); if (!place) continue;
      const b = document.createElement('button'); b.textContent = hike.name; b.dataset.hike = hike.id; b.addEventListener('click', () => this.showCard(place, hike)); this.index.append(b);
    }
    this.root.querySelector('#mapClose')!.addEventListener('click', () => this.close());
    this.root.querySelector('#mapWhole')!.addEventListener('click', () => this.fit());
    this.root.querySelector('#mapZoomIn')!.addEventListener('click', () => this.zoom(1.5));
    this.root.querySelector('#mapZoomOut')!.addEventListener('click', () => this.zoom(1 / 1.5));
    this.root.querySelector('#mapPlacesToggle')!.addEventListener('click', () => { this.card.hidden = true; this.toggleIndex(this.index.hidden); });
    for (let kind = 1; kind <= 5; kind++) {
      const path = this.paths[kind] = new Path2D();
      for (const road of roads.roads) if (road.kind === kind || kind === 4 && road.kind > 5) this.trace(path, road.pts.map(([x, z]) => [x + terrain.manifest.village[0], terrain.manifest.village[1] - z]));
    }
    const streams = terrain.streams?.segments;
    if (streams) for (let i = 0; i < streams.length; i += 5) {
      this.brook.moveTo(streams[i] + terrain.manifest.village[0], -streams[i + 1] + terrain.manifest.village[1]);
      this.brook.lineTo(streams[i + 2] + terrain.manifest.village[0], -streams[i + 3] + terrain.manifest.village[1]);
    }
    this.input(); this.attachPhone();
    addEventListener('resize', () => { if (this.busy) this.fit(); });
    // The existing class texture is already loaded by Terrain. Read it only when the map is first opened.
    addEventListener('keyup', ev => { this.heldKeys.delete(ev.code); this.suppressed.delete(ev.code); }, true);
    addEventListener('blur', () => { this.heldKeys.clear(); this.suppressed.clear(); });
    addEventListener('keydown', ev => {
      this.heldKeys.add(ev.code);
      if (!this.busy && this.suppressed.has(ev.code)) { ev.preventDefault(); ev.stopPropagation(); return; }
      if (this.busy) {
        ev.stopPropagation();
        if (ev.code === 'Escape') { ev.preventDefault(); this.close(); }
        else if (ev.code === 'Tab') {
          ev.preventDefault(); const buttons = this.buttons(), at = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(at + (ev.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
        } else if (ev.code === 'Enter' || ev.code === 'Space') {
          ev.preventDefault(); if (!ev.repeat && document.activeElement instanceof HTMLButtonElement && this.root.contains(document.activeElement)) document.activeElement.click();
        }
      } else if (ev.code === 'KeyM' && !ev.repeat && !typing(ev) && actions.canOpen()) { ev.preventDefault(); ev.stopPropagation(); this.open(); }
    }, true);
    document.addEventListener('focusin', ev => { if (this.busy && ev.target instanceof Node && !this.root.contains(ev.target)) this.buttons()[0]?.focus(); });
    for (const event of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) this.root.addEventListener(event, ev => ev.stopPropagation());
  }
  get busy(): boolean { return !this.root.hidden; }
  private buttons(): HTMLButtonElement[] { return [...this.root.querySelectorAll('button')].filter(b => b.getClientRects().length > 0); }
  /** False when Places is on the screen: a phone then opens the map from the Places card, so the phone's top row
   *  keeps the controls it has without the map (a 320 px phone has no room for another 56 px button). */
  phoneTop = true;
  private attachPhone(): void {
    // The constructor runs before main.ts can clear phoneTop, so move the button back out of the row as well.
    if (!this.phoneTop) { if (this.button.parentElement !== document.body) document.body.append(this.button); return; }
    const top = document.getElementById('phoneTop');
    if (top && this.button.parentElement !== top) top.insertBefore(this.button, document.getElementById('gear'));
  }
  update(traveller: Traveller, enabled: boolean): void {
    this.attachPhone(); this.button.hidden = !enabled && !this.busy || !this.phoneTop && document.body.classList.contains('tcOn');
    if (this.traveller.x !== traveller.x || this.traveller.z !== traveller.z || this.traveller.heading !== traveller.heading) { this.traveller = { x: traveller.x, z: traveller.z, heading: traveller.heading }; if (this.busy) this.redraw(); }
  }
  /** opener: the control to refocus on close; null for a pointer open (nothing to refocus); omitted for M (the focus it had). */
  open(opener?: HTMLElement | null): void {
    if (this.busy || !this.actions.canOpen()) return;
    this.restore = opener !== undefined ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.actions.pause(true); this.root.hidden = false; this.card.hidden = true; this.toggleIndex(false);
    this.inert = [...document.body.children].filter((n): n is HTMLElement => n instanceof HTMLElement && n !== this.root && n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE').map(node => ({ node, was: node.inert }));
    for (const item of this.inert) item.node.inert = true;
    this.fit(); this.buttons()[0]?.focus();
    if (!this.coverReady) void this.loadShore();
  }
  close(): void {
    if (!this.busy) return;
    this.suppressed.clear(); for (const code of this.heldKeys) this.suppressed.add(code);
    this.root.hidden = true; this.pointers.clear(); this.canvas.style.cursor = '';
    for (const item of this.inert) item.node.inert = item.was;
    this.inert = []; this.actions.pause(false); this.restore?.focus();
    // Nothing to return to: never leave focus on a hidden map button, nor on MAP after a click (Space would reopen it).
    const active = document.activeElement;
    if (active instanceof HTMLElement && (this.root.contains(active) || !this.restore && active === this.button)) active.blur();
  }
  private async loadShore(): Promise<void> {
    this.coverReady = true;
    try {
      // Blue channel 4 is mapped water. Render classes, never the cover RGB as a photograph.
      const texture = this.terrain.uniforms.tCover.value as { image?: HTMLImageElement };
      if (!texture.image?.complete) await this.terrain.readCover();
      const image = texture.image;
      if (!image) throw new Error('No land-cover image');
      this.shore.width = Math.min(1400, image.width); this.shore.height = Math.min(1400, image.height);
      const g = this.shore.getContext('2d', { willReadFrequently: true })!;
      g.imageSmoothingEnabled = false; g.drawImage(image, 0, 0, this.shore.width, this.shore.height);
      const pixels = g.getImageData(0, 0, this.shore.width, this.shore.height);
      for (let k = 0; k < pixels.data.length; k += 4) {
        const cls = pixels.data[k + 2], rgb = cls === 4 ? [62, 107, 124] : cls === 1 ? [91, 119, 89] : cls === 2 ? [124, 143, 106] : [157, 165, 126];
        pixels.data[k] = rgb[0]; pixels.data[k + 1] = rgb[1]; pixels.data[k + 2] = rgb[2]; pixels.data[k + 3] = 255;
      }
      g.putImageData(pixels, 0, 0); this.cached = null; this.redraw();
    } catch { this.coverReady = false; this.canvas.setAttribute('aria-description', 'Land cover is unavailable; roads and places are still shown.'); }
  }
  private fit(): void {
    const r = this.stage.getBoundingClientRect(); this.w = r.width; this.h = r.height; this.dpr = Math.min(devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
    this.fitScale = Math.min((this.w - 48) / (this.box[2] - this.box[0]), (this.h - 48) / (this.box[3] - this.box[1]));
    this.view((this.box[0] + this.box[2]) / 2, (this.box[1] + this.box[3]) / 2, 1);
  }
  /** Also used by the picture/check tools. Coordinates are EPSG:2961; zoom 1 fits the whole box. */
  view(e: number, n: number, zoom: number): void { this.center = [e, n]; this.scale = this.fitScale * Math.max(1, Math.min(40, zoom)); this.cached = null; this.redraw(); }
  private screen(p: Point): Point { return [this.w / 2 + (p[0] - this.center[0]) * this.scale, this.h / 2 - (p[1] - this.center[1]) * this.scale]; }
  private zoom(factor: number, x = this.w / 2, y = this.h / 2): void {
    const before = this.scale; this.scale = Math.max(this.fitScale, Math.min(this.fitScale * 40, before * factor));
    this.center = [this.center[0] + (x - this.w / 2) * (1 / before - 1 / this.scale), this.center[1] - (y - this.h / 2) * (1 / before - 1 / this.scale)];
    this.constrain(); this.cached = null; this.redraw();
  }
  private constrain(): void { this.center = [Math.max(this.box[0], Math.min(this.box[2], this.center[0])), Math.max(this.box[1], Math.min(this.box[3], this.center[1]))]; }
  private pick(p: Point): Place | undefined {
    const dist = (r: { x: number; y: number; w: number; h: number }) => Math.hypot(r.x + r.w / 2 - p[0], r.y + r.h / 2 - p[1]);
    const inside = (r: { x: number; y: number; w: number; h: number }, xPad: number, yPad: number) =>
      p[0] >= r.x - xPad && p[0] <= r.x + r.w + xPad && p[1] >= r.y - yPad && p[1] <= r.y + r.h + yPad;
    const tags = this.hitMarks.filter(({ rect: r }) => {
      if (!r) return false;
      return inside(r, 4, Math.max(4, (44 - r.h) / 2));
    });
    const exact = tags.filter(({ rect: r }) => inside(r!, 0, 0)).sort((a, b) => dist(a.rect!) - dist(b.rect!));
    if (exact[0]) return exact[0].place;
    const hit = this.hitMarks.map(m => ({ ...m, d: Math.hypot(m.x - p[0], m.y - p[1]) })).sort((a, b) => a.d - b.d)[0];
    if (hit?.d < 8) return hit.place;
    const padded = tags.sort((a, b) => dist(a.rect!) - dist(b.rect!));
    if (padded[0]) return padded[0].place;
    if (hit?.d < 24) return hit.place;
    return undefined;
  }
  private input(): void {
    const local = (ev: PointerEvent): Point => { const r = this.canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
    this.canvas.addEventListener('wheel', ev => { ev.preventDefault(); const r = this.canvas.getBoundingClientRect(); this.zoom(Math.exp(-Math.max(-120, Math.min(120, ev.deltaY)) * .004), ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    this.canvas.addEventListener('pointerdown', ev => { ev.preventDefault(); this.canvas.style.cursor = ''; this.canvas.setPointerCapture(ev.pointerId); this.pointers.set(ev.pointerId, local(ev)); this.down = local(ev); this.moved = this.pointers.size > 1; });
    this.canvas.addEventListener('pointermove', ev => {
      if (this.pointers.size === 0 && ev.pointerType !== 'touch') this.canvas.style.cursor = this.pick(local(ev)) ? 'pointer' : '';
      const old = this.pointers.get(ev.pointerId); if (!old) return;
      const p = local(ev), other = [...this.pointers.entries()].find(([id]) => id !== ev.pointerId)?.[1];
      if (other) {
        const prev = Math.hypot(old[0] - other[0], old[1] - other[1]), next = Math.hypot(p[0] - other[0], p[1] - other[1]);
        if (prev > 4) this.zoom(next / prev, (p[0] + other[0]) / 2, (p[1] + other[1]) / 2);
        this.moved = true;
      } else {
        this.center = [this.center[0] - (p[0] - old[0]) / this.scale, this.center[1] + (p[1] - old[1]) / this.scale];
        if (this.down && Math.hypot(p[0] - this.down[0], p[1] - this.down[1]) > 6) this.moved = true;
        this.constrain(); this.redraw();
      }
      this.pointers.set(ev.pointerId, p);
    });
    this.canvas.addEventListener('pointerup', ev => {
      if (!this.pointers.has(ev.pointerId)) return;
      const p = local(ev); this.pointers.delete(ev.pointerId);
      if (!this.moved) { const place = this.pick(p); if (place) this.showCard(place); }
    });
    for (const event of ['pointercancel', 'lostpointercapture']) this.canvas.addEventListener(event, ev => { this.pointers.delete((ev as PointerEvent).pointerId); this.moved = true; });
  }
  private toggleIndex(show: boolean): void { this.index.hidden = !show; this.root.querySelector('#mapPlacesToggle')!.setAttribute('aria-expanded', String(show)); }
  showCard(place: Place, chosen?: Hike): void {
    this.toggleIndex(false); this.card.hidden = false; this.card.replaceChildren();
    this.card.dataset.place = place.id;
    const hikes = chosen ? [chosen] : this.hikes.filter(h => h.trailhead === place.id);
    this.card.append(Object.assign(document.createElement('h3'), { textContent: chosen?.name ?? place.name }), Object.assign(document.createElement('p'), { textContent: place.note }));
    for (const hike of hikes) {
      const facts = Object.assign(document.createElement('p'), { textContent: hikeFacts(hike), className: 'mapFacts' }); facts.dataset.hike = hike.id;
      this.card.append(facts, Object.assign(document.createElement('p'), { textContent: TRAIL_CAUTION, className: 'mapCaution' }));
    }
    const go = document.createElement('button'); go.id = 'mapGo'; go.textContent = 'Go here';
    go.addEventListener('click', () => {
      // A place with its own start spot (as Places uses it) starts there, not on the nearest road.
      const origin = this.terrain.manifest.village;
      const hit = place.start ? { ...placePosition(place.start, origin), heading: place.start.heading } : nearestPlacement(this.roads, place, origin);
      if (!hit) { this.card.querySelector('#mapStatus')!.textContent = 'No road point is available here.'; return; }
      this.actions.jump(hit.x, hit.z, hit.heading); this.close();
    });
    const back = document.createElement('button'); back.textContent = 'Back to map'; back.addEventListener('click', () => { this.card.hidden = true; this.buttons()[0]?.focus(); });
    this.card.append(go, back, Object.assign(document.createElement('p'), { id: 'mapStatus', role: 'status' })); go.focus();
  }
  private trace(path: Path2D | CanvasRenderingContext2D, pts: readonly Point[]): void { if (!pts.length) return; path.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) path.lineTo(p[0], p[1]); }
  private redraw(): void {
    if (!this.busy || this.queued) return; this.queued = true;
    requestAnimationFrame(() => { this.queued = false; if (this.busy) this.draw(); });
  }
  private staticLayer(): void {
    const old = this.cached;
    if (old && old.scale === this.scale && Math.abs(old.center[0] - this.center[0]) * this.scale < this.w / 2 && Math.abs(old.center[1] - this.center[1]) * this.scale < this.h / 2) return;
    // Twice the view each way at screen resolution, but at most 12 M pixels (iOS Safari draws nothing past 16.7 M).
    const k = Math.min(this.dpr, Math.sqrt(12e6 / (4 * this.w * this.h)));
    this.layer.width = Math.ceil(this.w * 2 * k); this.layer.height = Math.ceil(this.h * 2 * k);
    this.cached = { center: [...this.center], scale: this.scale };
    const g = this.layer.getContext('2d')!, s = this.scale, [e, n] = this.center;
    g.setTransform(k, 0, 0, k, 0, 0); g.fillStyle = '#244957'; g.fillRect(0, 0, this.w * 2, this.h * 2);
    g.translate(this.w, this.h); g.scale(s, -s); g.translate(-e, -n);
    g.beginPath(); g.rect(this.box[0], this.box[1], this.box[2] - this.box[0], this.box[3] - this.box[1]); g.clip();
    g.fillStyle = '#9da57e'; g.fillRect(this.box[0], this.box[1], this.box[2] - this.box[0], this.box[3] - this.box[1]);
    if (this.shore.width > 0) {
      const c = this.terrain.manifest.cover;
      g.save(); g.translate(c.xmin, c.ymax); g.scale(1, -1); g.imageSmoothingEnabled = true; g.drawImage(this.shore, 0, 0, c.xmax - c.xmin, c.ymax - c.ymin); g.restore();
    }
    g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#71aabe'; g.lineWidth = .8 / s; g.stroke(this.brook);
    for (let kind = 5; kind >= 1; kind--) { g.strokeStyle = ROAD_COLOURS[kind]; g.lineWidth = ROAD_WIDTHS[kind] / s; g.stroke(this.paths[kind]); }
    g.strokeStyle = TRAIL_COLOUR; g.lineWidth = 3 / s; g.setLineDash([7 / s, 5 / s]);
    for (const line of this.lines) { g.beginPath(); this.trace(g, line.pts); g.stroke(); }
    g.setLineDash([]);
  }
  private label(text: string, x: number, y: number, colour: string, angle = 0, place = false, anchor?: Point, halo = false): Rect | null {
    const g = this.g; g.font = place ? '600 12px system-ui,sans-serif' : halo ? 'italic 11px system-ui,sans-serif' : '11px system-ui,sans-serif';
    const width = g.measureText(text).width + 10, h = 19;
    const w = Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * h, height = Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * h;
    const rect = { x: x - w / 2, y: y - height / 2, w, h: height };
    if (rect.x < 8 || rect.y < 35 || rect.x + w > this.w - 8 || rect.y + height > this.h - 36 || this.labels.some(r => rect.x < r.x + r.w + 3 && rect.x + w + 3 > r.x && rect.y < r.y + r.h + 3 && rect.y + height + 3 > r.y)) return null;
    this.labels.push(rect);
    if (anchor) {
      g.save(); g.strokeStyle = '#dbe5cb99'; g.lineWidth = 1; g.beginPath(); g.moveTo(anchor[0], anchor[1]);
      g.lineTo(Math.max(rect.x, Math.min(rect.x + rect.w, anchor[0])), Math.max(rect.y, Math.min(rect.y + rect.h, anchor[1]))); g.stroke(); g.restore();
    }
    g.save(); g.translate(x, y); g.rotate(angle); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (halo) { g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = '#10242b'; g.strokeText(text, 0, 0); }
    else { g.fillStyle = '#10242be8'; g.fillRect(-width / 2, -h / 2, width, h); }
    g.fillStyle = colour; g.fillText(text, 0, 0); g.restore(); return rect;
  }
  private lineLabel(name: string, pts: readonly Point[], colour: string): boolean {
    const segments = pts.slice(1).map((p, i) => { const a = this.screen(pts[i]), b = this.screen(p); return { a, b, length: Math.hypot(b[0] - a[0], b[1] - a[1]) }; }).sort((a, b) => b.length - a.length);
    for (const { a, b } of segments) {
      let angle = Math.atan2(b[1] - a[1], b[0] - a[0]); if (angle > Math.PI / 2) angle -= Math.PI; if (angle < -Math.PI / 2) angle += Math.PI;
      if (this.label(name, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 9, colour, angle, false, undefined, true)) return true;
    }
    return false;
  }
  private draw(): void {
    this.staticLayer(); const g = this.g, cache = this.cached!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this.layer, 0, 0, this.layer.width, this.layer.height, -this.w / 2 + (cache.center[0] - this.center[0]) * this.scale, -this.h / 2 - (cache.center[1] - this.center[1]) * this.scale, this.w * 2, this.h * 2);
    this.labels = []; this.hitMarks = [];
    const nw = this.screen([this.box[0], this.box[3]]), se = this.screen([this.box[2], this.box[1]]);
    g.save(); g.strokeStyle = '#c3d3c399'; g.lineWidth = 1; g.setLineDash([6, 5]); g.strokeRect(nw[0], nw[1], se[0] - nw[0], se[1] - nw[1]); g.restore();
    if (nw[1] > 45 && nw[1] < this.h - 45) this.label(this.hikes.some(h => h.kind === 'highlands') ? 'Map ends here · trails continue north' : 'Beyond this map', this.w / 2, nw[1] - 20, '#d8e6d8');
    const origin = this.terrain.manifest.village;
    const [x, y] = this.screen([this.traveller.x + origin[0], origin[1] - this.traveller.z]);
    for (const place of this.places) {
      const [x, y] = this.screen([place.e, place.n]); if (x < 0 || x > this.w || y < 0 || y > this.h) continue;
      this.hitMarks.push({ place, x, y });
      g.fillStyle = this.hikes.some(h => h.trailhead === place.id) ? '#f3d2df' : '#f7f4cf'; g.strokeStyle = '#17323c'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    this.labels.push({ x: x - 11, y: y - 14, w: 22, h: 26 });
    this.label('You are here', x, y + 28, '#fff');
    // Draw every dot before labels, so a later dot never covers an earlier place name.
    for (const mark of this.hitMarks) {
      const { place, x, y } = mark;
      let labelled = false;
      for (const dy of [-18, 18, -38, 38, -58, 58, -78, 78, -98, 98]) if ((mark.rect = this.label(place.name, x, y + dy, '#fff7d6', 0, true, [x, y]) ?? undefined)) { labelled = true; break; }
      if (!labelled) for (const dx of [-100, 100]) if ((mark.rect = this.label(place.name, x + dx, y, '#fff7d6', 0, true, [x, y]) ?? undefined)) break;
    }
    const names = new Set<string>();
    for (const line of [...this.lines].sort((a, b) => b.pts.length - a.pts.length)) if (line.name && !names.has(line.name) && this.lineLabel(line.name, line.pts, '#ffd4e3')) names.add(line.name);
    for (const road of [...this.roads.roads].filter(r => r.kind <= 2 && r.name).sort((a, b) => b.pts.length - a.pts.length)) {
      if (names.has(road.name!)) continue;
      if (this.lineLabel(road.name!, road.pts.map(([x, z]): Point => [x + origin[0], origin[1] - z]), '#e8edda')) names.add(road.name!);
    }
    g.save(); g.translate(x, y); g.rotate(this.traveller.heading); g.fillStyle = '#fff'; g.strokeStyle = '#163b4c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.fillStyle = '#10242be8'; g.fillRect(8, 8, 35, 26); g.fillRect(8, this.h - 32, 160, 26);
    g.fillStyle = '#fff'; g.font = '700 13px system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('↑ N', 14, 21);
    const target = 100 / this.scale, unit = 10 ** Math.floor(Math.log10(target)), metres = [1, 2, 5].map(n => n * unit).filter(n => n <= target).at(-1) ?? unit;
    const length = metres * this.scale; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(16, this.h - 22); g.lineTo(16, this.h - 14); g.lineTo(16 + length, this.h - 14); g.lineTo(16 + length, this.h - 22); g.stroke();
    g.font = '12px system-ui,sans-serif'; g.fillText(`${metres / 1000} km`, 22 + length, this.h - 18);
  }
}
