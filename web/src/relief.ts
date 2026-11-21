// Eight hours on the road and no toilet on the route. A gauge fills through the shift. Stopping out of sight is
// free; stopping in view of a house is a call to the office that no photo answers. The rail trail in the woods is
// the best spot there is. Built in script, so the test page and the published page cannot drift apart.

import type { Terrain } from './terrain';

export interface ReliefOutcome { seen: boolean; forced: boolean; trail: boolean; house: number; x: number; z: number }

const CSS = `
#relief{position:fixed;z-index:3;left:max(10px,env(safe-area-inset-left,0px));top:calc(390px + env(safe-area-inset-top,0px));
  display:flex;align-items:center;gap:8px;min-height:26px;padding:0 8px;border:1px solid rgba(238,242,246,.22);border-radius:6px;
  background:var(--panel,rgba(8,14,20,.72));color:var(--ink,#eef2f6);font:700 10.5px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;
  user-select:none;-webkit-user-select:none;cursor:default}
#relief[hidden],#reliefCard[hidden]{display:none}
#relief i{display:block;width:64px;height:7px;border-radius:4px;background:rgba(238,242,246,.16);overflow:hidden}
#relief b{display:block;height:100%;width:0;background:#9fc7dc;border-radius:4px}
#relief.soon b{background:#e9b65c}
#relief.now b{background:#ff5a4a}
#relief.now{animation:reliefPulse .9s ease-in-out infinite}
#relief.ready{cursor:pointer;border-color:#e9b65c;min-height:44px}
#relief.ready span::after{content:' · STEP OUT · B';color:#e9b65c}
body.tcOn #relief.ready span{font-size:0}
body.tcOn #relief.ready span::after{content:'STEP OUT';font-size:10.5px}
@keyframes reliefPulse{50%{border-color:#ff5a4a}}
@media(prefers-reduced-motion:reduce){#relief.now{animation:none;border-color:#ff5a4a}}
#reliefCard{position:fixed;z-index:6;left:50%;top:22%;transform:translateX(-50%);max-width:min(440px,calc(100% - 32px));box-sizing:border-box;
  padding:12px 16px;border-radius:6px;border:1px solid #8e8063;background:rgba(13,19,20,.92);color:#eee6d6;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;text-align:center;pointer-events:none}
#reliefCard strong{display:block;color:#efbb68;letter-spacing:.08em;font-size:12px}
body.indoorOn :is(#relief,#reliefCard){display:none!important}
`;

const START = 0.3;                 // the morning coffee
const FILL = 1 / (3.2 * 3600);     // per second on the game clock: about seven minutes of play from the start to full
const ASK = 0.45;                  // from here a stopped car offers the break
const SOON = 0.75;
const GRACE = 40 * 60;             // game seconds at full before the body decides (two minutes of play)
const TAKES = 5;                   // seconds of play, with the clock running
const SEEN_OPEN = 110;             // metres: a house this close has a view
const SEEN_WOODS = 45;             // the same, with trees around the car

const QUIET = ['Nobody saw. Probably.', 'Nobody for a long way. The clock kept running.', 'A crow watched. Crows do not phone the office.'];
const TRAIL = ['The rail trail: the best spot on the route.', 'Trees on both sides, no houses, no traffic. This is what the trail is for.'];
const CAUGHT = ['A curtain moved.', 'Somebody was at the window.', 'A screen door closed, slowly.'];

export class Relief {
  level = START;
  breaks = 0;
  private full = 0;               // game seconds spent at the top of the gauge
  private busyFor = 0;
  private cardFor = 0;
  private forced = false;
  private ready = false;
  private layout = 1;
  private readonly chip = document.createElement('div');
  private readonly bar = document.createElement('b');
  private readonly card = document.createElement('div');
  private readonly cardHead = document.createElement('strong');
  private readonly cardText = document.createElement('div');

  /** `houses` are world positions (x east, z south). `report` receives each break once it is over. */
  constructor(private readonly houses: readonly { x: number; z: number }[], private readonly terrain: Terrain,
    private readonly report: (o: ReliefOutcome) => void, private readonly bare = false) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.chip.id = 'relief';
    this.chip.setAttribute('role', 'button');
    this.chip.setAttribute('aria-label', 'Bladder. When the car is stopped, press to step out.');
    const track = document.createElement('i');
    track.appendChild(this.bar);
    this.chip.append(Object.assign(document.createElement('span'), { textContent: 'BLADDER' }), track);
    this.chip.addEventListener('click', () => { this.wanted = true; });
    this.card.id = 'reliefCard';
    this.card.setAttribute('role', 'status');
    this.card.append(this.cardHead, this.cardText);
    this.card.hidden = this.chip.hidden = true;
    document.body.append(this.chip, this.card);
  }

  private wanted = false;
  /** The B key, or a tap on the gauge. It does nothing unless the car is stopped and the gauge has reached the mark. */
  request(): void { this.wanted = true; }
  /** True while the carrier is out of the car: hold the car still. */
  get busy(): boolean { return this.busyFor > 0; }

  reset(): void {
    this.level = START; this.full = this.busyFor = this.cardFor = this.breaks = 0; this.forced = this.ready = this.wanted = false;
    this.card.hidden = true; this.chip.className = '';
  }

  private say(head: string, text: string, seconds: number): void {
    this.cardHead.textContent = head; this.cardText.textContent = text; this.card.hidden = this.bare; this.cardFor = seconds;
  }

  /** Trees around the car hide it: canopy at four points a few metres out. */
  private inWoods(x: number, z: number): boolean {
    // Eight points on a 10 m ring. A trail or a road through the woods is open along its own line, so half is enough.
    let covered = 0;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      if ((this.terrain.surfaceAt(x + 10 * Math.sin(a), z + 10 * Math.cos(a))?.canopy ?? 0) > 4) covered++;
    }
    return covered >= 4;
  }

  private finish(v: { x: number; z: number;y?:number }): void {
    let house = -1, best = Infinity;
    for (let i = 0; i < this.houses.length; i++) {
      const d = (this.houses[i].x - v.x) ** 2 + (this.houses[i].z - v.z) ** 2;
      if (d < best) { best = d; house = i; }
    }
    const here = this.terrain.surfaceAt(v.x, v.z,v.y);
    const trail = !!here && here.kind === 5 && here.roadDist <= here.halfWidth + 3;
    const woods = this.inWoods(v.x, v.z);
    const seen = Math.sqrt(best) < (woods ? SEEN_WOODS : SEEN_OPEN);
    const pick = (lines: readonly string[]) => lines[this.breaks % lines.length];
    this.say(seen ? 'SEEN' : 'ALL CLEAR', seen ? `${pick(CAUGHT)} Expect a call. No photo answers this one.`
      : trail && woods ? pick(TRAIL) : pick(QUIET), 6);
    this.breaks++;
    this.level = 0; this.full = 0;
    this.report({ seen, forced: this.forced, trail, house, x: v.x, z: v.z });
    this.forced = false;
  }

  /** `dt` is play time and `clockDt` is time on the game clock, both in seconds. `enabled` is false in menus, fly mode and interiors. */
  update(dt: number, clockDt: number, v: { x: number; z: number; speed: number;y?:number }, enabled: boolean): void {
    this.chip.hidden = this.bare || !enabled;
    if (this.cardFor > 0 && !this.busy) { this.cardFor -= dt; if (this.cardFor <= 0) this.card.hidden = true; }
    if (!enabled) { this.wanted = false; return; }
    if (this.busy) {
      this.busyFor -= dt;
      if (this.busyFor <= 0) { this.busyFor = 0; this.finish(v); }
      this.wanted = false;
    } else {
      this.level = Math.min(1, this.level + clockDt * FILL);
      if (this.level >= 1) this.full += clockDt;
      const stopped = Math.abs(v.speed) < 0.8;
      this.ready = stopped && this.level >= ASK;
      if (this.full > GRACE) {
        // No more waiting. The car has to stop where it is, wherever that is.
        this.forced = true; this.busyFor = TAKES + 2;
        this.say('IT CANNOT WAIT', 'The carrier stops the car, here, now.', TAKES + 2);
      } else if (this.wanted && this.ready) {
        this.busyFor = TAKES;
        this.say('ONE MOMENT', 'The carrier steps behind the car. The clock keeps running.', TAKES);
      }
      this.wanted = false;
    }
    this.bar.style.width = `${Math.round(this.level * 100)}%`;
    this.chip.className = `${this.level >= 1 ? 'now' : this.level >= SOON ? 'soon' : ''}${this.ready && !this.busy ? ' ready' : ''}`;
    // The phone grid owns placement. The desktop gauge still follows the map.
    if (!document.body.classList.contains('tcOn') && --this.layout <= 0) {
      this.layout = 15;
      const map = document.getElementById('miniMap');
      const box = map && !map.hidden ? map.getBoundingClientRect() : null;
      if (box && box.height) {
        this.chip.style.top = `${Math.round(box.bottom + 6)}px`;
        this.chip.style.left = `${Math.round(box.left)}px`;
      }
    }
  }
}
