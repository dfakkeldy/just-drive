import { startTrip } from './quarry-trip';
import { ARRIVAL_RADIUS, arrivalAt, mapRank, nearestPlacement, placePosition, type Place, type RoadNetwork } from './places';
import type { MapMark } from './minimap';
import { hikeFacts, TRAIL_CAUTION, type Hike } from './hikes';

interface Traveller { x: number; z: number }
export interface PlacesActions {
  canOpen(): boolean;
  pause(paused: boolean): void;
  jump(x: number, z: number, heading: number): void;
}
const CSS = `
#placesButton{position:fixed;cursor:pointer}
body.droneOn.droneSticks #placesButton{position:fixed;top:calc(76px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));width:86px;height:56px;box-sizing:border-box;z-index:6;pointer-events:auto;margin:0;padding:0 8px;border:1px solid rgba(238,242,246,.3);border-radius:10px;background:var(--panel);color:var(--ink);font:700 12px var(--mono)}
#placeArrival{position:fixed;right:24px;bottom:32px;z-index:4;width:min(310px,calc(100% - 32px));box-sizing:border-box;padding:12px 16px;background:var(--panel);border:0;border-left:3px solid #a7d9bc;border-radius:0;font:13px/1.45 var(--text);pointer-events:none}
body:has(#settings.open) #placeArrival,body:has(#pauseScreen:not([hidden])) #placeArrival,body:has(#bigMap:not([hidden])) #placeArrival{display:none}
#placesList .youAreHere{font:700 12px var(--text);color:#c1ead0}
#placeArrival strong{display:block;color:#c1ead0;margin-bottom:4px}#placeArrival p{margin:0;color:var(--ink-dim)}
#placesPanel{position:fixed;inset:0;z-index:21;display:grid;place-items:center;padding:16px;box-sizing:border-box;background:#071016ad;color:var(--ink);font:15px/1.5 var(--text);touch-action:pan-y}
#placesCard{box-sizing:border-box;width:min(100%,560px);max-height:100%;overflow:hidden;display:flex;flex-direction:column;border:1px solid #89afa2;border-radius:10px;background:var(--panel-solid);padding:22px}
#placesHeader{flex:none}#placesBody{overflow:auto;min-height:0;overscroll-behavior:contain}
#placesCard h2{margin:0;font:600 28px/1.15 "Iowan Old Style",Palatino,Georgia,serif}#placesCard p{color:var(--ink-dim);margin:6px 0 16px}#placesList{display:grid;gap:10px;list-style:none;margin:0;padding:0}#placesList button{width:100%}
#placesCard button{cursor:pointer;font:inherit;color:inherit;min-height:56px;border:1px solid #71897e;border-radius:6px;background:#20362e;padding:12px;text-align:left}
#placesList button strong,#placesList button span{display:block}#placesList button span{color:var(--ink-dim);font-size:13px;margin-top:4px}
#placesCard #placesMap{background:transparent;border-color:var(--ink-dim)}
#placesMap{width:100%;margin:0 0 12px;text-align:center!important}
#placesCard #placesClose{flex:none;margin-top:14px;width:100%;text-align:center!important;background:transparent!important;border-color:var(--ink-dim)}
#placesCard button:focus-visible,#placesButton:focus-visible{outline:3px solid #fff;outline-offset:2px}
#placesList button:focus-visible{outline-offset:-3px}
#placesPanel[hidden],#placeArrival[hidden],#placesButton[hidden]{display:none}
body.tcOn #placesButton{position:static;min-height:56px;flex:none;pointer-events:auto;margin:0}
body.tcOn #placeArrival{position:static;width:100%;max-width:360px;margin:0;font-size:11px;padding:6px 8px;pointer-events:none}
body.tcOn #phoneHint:has(#placeArrival){min-height:0}
@media(max-height:440px){#placesCard{padding:12px 16px}#placesCard h2{font-size:22px}#placesCard p{margin:4px 0 10px}#placesList{gap:6px}}
`;

/** Owns only explore UI. The engine supplies pause and placement; no vehicle or area is assumed here. */
export class PlacesUI {
  readonly marks: MapMark[];
  readonly places: Place[];
  private readonly button = document.createElement('button');
  private readonly arrival = document.createElement('aside');
  private readonly panel = document.createElement('div');
  private readonly head = document.createElement('strong');
  private readonly note = document.createElement('p');
  private previous: Place | undefined;
  private restore: HTMLElement | null = null;
  private inert: { node: HTMLElement; was: boolean }[] = [];
  constructor(places: readonly Place[], private origin: readonly [number, number], readonly roads: RoadNetwork, private actions: PlacesActions, readonly hikes: readonly Hike[] = []) {
    this.places=[];this.marks=[];
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.button.id = 'placesButton'; this.button.textContent = 'PLACES'; this.button.type = 'button';
    this.button.setAttribute('aria-controls', 'placesPanel'); this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-haspopup', 'dialog');
    // A keyboard press (detail 0) returns focus here on close; a click or tap leaves no control focused, so Space stays the brake.
    this.button.addEventListener('click', ev => this.open(ev.detail === 0 ? this.button : null));
    this.arrival.id = 'placeArrival'; this.arrival.hidden = true; this.arrival.setAttribute('role', 'status'); this.arrival.append(this.head, this.note);
    this.panel.id = 'placesPanel'; this.panel.hidden = true; this.panel.setAttribute('role', 'dialog'); this.panel.setAttribute('aria-modal', 'true'); this.panel.setAttribute('aria-labelledby', 'placesHeading');
    this.panel.setAttribute('aria-describedby', 'placesDescription');
    this.panel.innerHTML = `<section id="placesCard"><header id="placesHeader"><h2 id="placesHeading">Places</h2></header><div id="placesBody"><p id="placesDescription">Choose a place to start there, at rest${places.some(place => place.start) ? '' : ' on the nearest road'}.</p><ul id="placesList" role="list"></ul><p id="placesError" role="status" hidden></p></div><button id="placesClose">Back to driving · Esc</button></section>`;
    this.addPlaces(places);this.button.hidden=!places.length;
    if (hikes.length) {
      const section = document.createElement('div'); section.id = 'hikesList';
      section.style.cssText = 'display:grid;gap:10px;margin-top:18px';
      section.appendChild(Object.assign(document.createElement('h3'), { textContent: 'Hikes', style: 'margin:0' }));
      for (const hike of hikes) {
        const place = places.find(p => p.id === hike.trailhead); if (!place) continue;
        const button = document.createElement('button'); button.type = 'button'; button.dataset.hike = hike.id;
        for (const [tag, text] of [['strong', hike.name], ['span', hikeFacts(hike)], ['small', TRAIL_CAUTION]] as const) {
          const el = document.createElement(tag); el.textContent = text; el.style.cssText = 'display:block;margin:4px 0'; button.appendChild(el);
        }
        button.addEventListener('click', () => this.panel.querySelector<HTMLButtonElement>(`[data-place="${place.id}"]`)?.click());
        section.appendChild(button);
      }
      this.panel.querySelector('#placesList')!.after(section);
    }
    this.panel.querySelector<HTMLElement>('#placesClose')!.addEventListener('click', ev => this.close(ev.detail === 0));
    document.body.append(this.button, this.arrival, this.panel);
    for (const event of ['pointerdown', 'pointerup', 'pointermove', 'click', 'wheel']) this.panel.addEventListener(event, ev => ev.stopPropagation());
    addEventListener('keydown', ev => {
      if (this.busy) {
        ev.stopPropagation();
        if (ev.code === 'Enter' || ev.code === 'Space') {
          ev.preventDefault();
          if (!ev.repeat && document.activeElement instanceof HTMLButtonElement && this.panel.contains(document.activeElement)) document.activeElement.click();
        }
        if (ev.code === 'Escape') { ev.preventDefault(); this.close(); }
        if (ev.code === 'Tab') {
          ev.preventDefault();
          const buttons = [...this.panel.querySelectorAll('button')], index = buttons.findIndex(button => button === document.activeElement);
          buttons[(index + (ev.shiftKey ? buttons.length - 1 : 1)) % buttons.length]?.focus();
        }
      } else if (ev.code === 'KeyL' && !ev.repeat && actions.canOpen() && !(ev.target instanceof HTMLElement && ev.target.closest('input,select,textarea,[contenteditable]'))) { ev.preventDefault(); ev.stopPropagation(); this.open(); }
    }, true);
    document.addEventListener('focusin', ev => { if (this.busy && ev.target instanceof Node && !this.panel.contains(ev.target)) this.panel.querySelector('button')?.focus(); });
    this.attachPhone();
  }
  /** Places can arrive after boot (sourced turbines load with the far views); each id is added once. */
  addPlaces(places:readonly Place[]):void {
    for (const place of places) {
      if(this.places.some(p=>p.id===place.id))continue;
      this.places.push(place);if(!place.trip)this.marks.push({...placePosition(place,this.origin),label:place.name,rank:mapRank(place),radius:place.radius??ARRIVAL_RADIUS});
      const button = document.createElement('button'); button.type = 'button'; button.dataset.place = place.id;
      button.append(Object.assign(document.createElement('strong'), { textContent: place.name }), Object.assign(document.createElement('span'), { textContent: place.note }));
      button.addEventListener('click', () => {
        if(place.trip){startTrip(place.trip);return;}
        const hit = place.start ? {...placePosition(place.start, this.origin),heading:place.start.heading} : nearestPlacement(this.roads, place, this.origin);
        if (!hit) { const error = this.panel.querySelector<HTMLElement>('#placesError')!; error.hidden = false; error.textContent = 'No road point is available here.'; return; }
        this.jumpTo(hit.x, hit.z, hit.heading);
      });
      const item = document.createElement('li'); item.appendChild(button);
      this.panel.querySelector('#placesList')!.appendChild(item);
    }
  }
  get busy(): boolean { return !this.panel.hidden; }
  /** A button at the top of the card that leaves Places for the big map (the phone's way in to the map). */
  mapButton(open: () => void): void {
    const button = Object.assign(document.createElement('button'), { id: 'placesMap', type: 'button', textContent: 'Map of the whole area' });
    button.addEventListener('click', () => { this.close(false); open(); });
    this.panel.querySelector('#placesList')!.before(button);
  }
  jumpTo(x: number, z: number, heading: number): void {
    this.actions.jump(x, z, heading); this.close(false);
  }
  private attachPhone(): void {
    const top = document.getElementById('phoneTop'), hint = document.getElementById(
      document.body.classList.contains('phoneReadoutsMenu') && innerWidth > innerHeight ? 'phoneReadoutsPanel' : 'phoneHint');
    if (top && this.button.parentElement !== top) top.insertBefore(this.button, document.getElementById('gear'));
    if (hint && this.arrival.parentElement !== hint) hint.appendChild(this.arrival);
  }
  /** opener: the control to refocus on close; null for a pointer open (nothing to refocus); omitted for L (the focus it had). */
  open(opener?: HTMLElement | null): void {
    if (this.busy || !this.actions.canOpen() || !this.places.length) return;
    this.restore = opener !== undefined ? opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.actions.pause(true); this.button.setAttribute('aria-expanded', 'true'); this.panel.hidden = false; this.arrival.hidden = true;
    this.inert = [...document.body.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node !== this.panel && node.tagName !== 'SCRIPT' && node.tagName !== 'STYLE').map(node => ({ node, was: node.inert }));
    for (const item of this.inert) item.node.inert = true;
    // The first place, not the map button above the list: Tab and Enter pick places as before.
    (this.panel.querySelector<HTMLElement>('#placesList button') ?? this.panel.querySelector<HTMLElement>('button'))?.focus();
  }
  close(restoreFocus = true): void {
    this.panel.hidden = true; this.button.setAttribute('aria-expanded', 'false');
    for (const item of this.inert) item.node.inert = item.was;
    this.inert = []; this.actions.pause(false);
    if (restoreFocus) this.restore?.focus();
    // Nothing to return to (a pointer open, or L with no focus): never leave focus on a hidden panel button.
    const active = document.activeElement;
    if (active instanceof HTMLElement && (!restoreFocus || this.panel.contains(active))) active.blur();
  }
  update(traveller: Traveller, enabled: boolean): void {
    this.attachPhone(); this.button.hidden = (!enabled || !this.places.length) && !this.busy;
    const place = enabled && !this.busy ? arrivalAt(this.places, this.origin, traveller.x, traveller.z) : undefined;
    this.arrival.hidden = !place;
    if (place && place !== this.previous) {
      this.head.textContent = place.name; this.note.textContent = place.note;
      for (const hike of this.hikes.filter(h => h.trailhead === place.id)) this.note.append(document.createElement('br'), document.createTextNode(hikeFacts(hike)));
    }
    // the list keeps the marks from the last arrival while it shows
    if (this.busy) return;
    if (place !== this.previous) for (const button of this.panel.querySelectorAll<HTMLButtonElement>('[data-place]')) {
      const here = button.dataset.place === place?.id;
      if (here) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
      button.querySelector('.youAreHere')?.remove();
      if (here) button.append(Object.assign(document.createElement('small'), { className: 'youAreHere', textContent: 'You are here' }));
    }
    this.previous = place;
  }
}
