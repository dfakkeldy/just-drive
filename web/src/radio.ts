// The car radio: the readout in the car and its place among the game's panels. The songs are the author's own, or free
// to share (tools/radio_stations.json has each one's credit). The playing itself (the station clocks, the songs in
// memory, the join in the middle of a song) is the engine in radio-player.ts, which the Just Listen page shares.
// The songs are data (audio/radio.json and its files), not code: without them there is no radio and the game runs.
// Built in script, so the test page and the published page cannot drift apart.
// Reception by place lives here too, and only here: where the car is decides how much of its station comes in
// (radio-reception.ts has the rules). The Just Listen page stands on the engine alone and hears every station.
// Only the mail shift has reception. Just driving (the Just Drive site, or the mail game's "Just drive" mode) takes the map
// away (main.ts), so there every station comes in everywhere.

import { windGain } from './damage-rules';
import { placePhoneReadout } from './phone-layout';
import { RadioPlayer, fetchStations, type RadioStation } from './radio-player';
import { RECEPTION, bandOf, comesIn, flutter, mix, nextOnDial, signalAt, type Band, type ReceptionMap } from './radio-reception';

export { readRadio, readStart } from './radio-player';
export type { RadioStation, RadioTrack } from './radio-player';

/** How a page asks for its radio. The defaults are the mail game's; the drive-around game names its own list and its own storage. */
export interface RadioOptions {
  /** The list's file name in the audio folder. */
  list?: string;
  /** Where the player's station and volume are kept. */
  storageKey?: string;
}

/**
 * Fetches a station list and makes the radio. With no list, or a list with no usable station, there is no radio at all:
 * the answer is null and nothing is put on the page. One list never stands in for another.
 */
export async function loadRadio(base: string, options: RadioOptions = {}): Promise<Radio | null> {
  const got = await fetchStations(base, options.list);
  try {
    return got ? new Radio(got.stations, base, got.start, options.storageKey ?? 'mmm.radio') : null;
  } catch {
    return null;
  }
}

/** A call to the talk show, played into a pause of its station (party-line.ts). */
export interface CallIn {
  /** The files to play in turn, as addresses in memory: the call, and the nickname that ends it. */
  readonly urls: readonly string[];
  /** The readout's song line while it plays. */
  readonly line: string;
  /** Called once, when the call is over or cut off. */
  done(): void;
}

const STATIC_TRIM = 0.12;   // how loud full static is beside a song
const STATIC_SECONDS = 2;   // the length of the static that goes round and round
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

const CSS = `
#radio{position:fixed;z-index:3;left:max(10px,env(safe-area-inset-left,0px));top:calc(424px + env(safe-area-inset-top,0px));
  display:flex;align-items:center;gap:8px;min-height:26px;max-width:min(300px,calc(100% - 20px));padding:0 8px;border:1px solid rgba(238,242,246,.22);border-radius:6px;
  background:var(--panel,rgba(8,14,20,.72));color:var(--ink,#eef2f6);font:700 10.5px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;
  user-select:none;-webkit-user-select:none;cursor:pointer;touch-action:manipulation;white-space:nowrap;overflow:hidden}
#radio[hidden]{display:none}
#radio:focus-visible{outline:2px solid var(--maple,#d0632e);outline-offset:2px}
#radio b{font-weight:700;color:#e9b65c}
#radio.off b{color:var(--ink-dim,#b9c3cc)}
/* The station name keeps its width while the song title gives way; only a very narrow readout cuts the name short. */
#radio b{flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis}
#radio span{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:500;letter-spacing:.02em;color:var(--ink-dim,#b9c3cc)}
#radio.off span{display:none}
#radio:not(.live) span{opacity:.55}
#radio.lost b{color:var(--ink-dim,#b9c3cc)}
#radio.lost span{letter-spacing:.08em}
body.indoorOn #radio{display:none}
/* A call about the run: its line (the player's name) is shown whole, on a line of its own under the station. */
#radio.call{flex-wrap:wrap;row-gap:1px;padding:3px 8px}
#radio.call span{flex:1 0 100%;text-align:left;white-space:normal;overflow-wrap:anywhere;color:var(--ink,#eef2f6);opacity:1}
#radioVolume{display:block;margin-top:12px}
`;

export class Radio extends RadioPlayer {
  private readonly chip = document.createElement('button');
  private readonly dial = document.createElement('b');
  private readonly song = document.createElement('span');
  private indoors = false;
  private playing = false;
  /** Music is really coming out now, turned up: the driving sounds duck under it. */
  get audible(): boolean { return this.playing && this.level() > 0; }
  private wind = 1;
  setWind(stuck: boolean, speed: number): void {
    this.wind = windGain(stuck, speed); this.audio.volume = this.level();
  }
  private map: ReceptionMap | null = RECEPTION;
  private e = NaN;          // where the car is, in map metres; not known until the game says
  private n = NaN;
  private signal = 1;       // how much of the station comes in here, from 0 to 1
  private band: Band = 'clear';
  private music = 1;        // the share of the music that is left, and of the static that covers it
  private crackle = 0;
  private noiseLoop: { ctx: AudioContext; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private noiseLevel = 0;
  /** A phone lets Web Audio run only from inside a tap, and stops it for a phone call: a later tap or key starts the static again. */
  private readonly wake = (): void => {
    const ctx = this.noiseLoop?.ctx;
    if (ctx && !document.hidden && ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => { /* the next tap tries again */ });
  };
  private layout = 1;
  private expandedUntil = 0;
  /** The song line while a call plays ('' when none). */
  private callLine = '';
  /** Asked at the end of each piece, before the next: a call to play into that gap, or null (party-line.ts). */
  onEnd: (() => CallIn | null) | null = null;

  /** `storageKey`: where this radio keeps the player's station and volume. A second radio list (another game on the same site) takes its own. */
  constructor(stations: RadioStation[], base: string, start?: string, storageKey = 'mmm.radio') {
    super(stations, base, start, storageKey);
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    this.held = document.hidden;   // out of the car, or the page is hidden

    this.chip.id = 'radio';
    this.chip.title = 'Radio: next station (T)';
    this.chip.append(this.dial, this.song);
    this.chip.addEventListener('click', () => this.next());
    this.chip.hidden = true;
    placePhoneReadout(this.chip);
    this.label();

    // A phone sets its own volume; a mouse gets a slider in the settings panel.
    const panel = document.getElementById('settings');
    if (panel && !matchMedia('(pointer: coarse)').matches) {
      const wrap = Object.assign(document.createElement('label'), { id: 'radioVolume', textContent: 'Radio volume' });
      const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: String(this.volume) });
      slider.addEventListener('input', () => this.setVolume(slider.value));
      wrap.appendChild(slider);
      panel.insertBefore(wrap, document.getElementById('startOver'));
    }
    document.addEventListener('visibilitychange', () => this.hold());
    for (const type of GESTURES) document.addEventListener(type, this.wake, { capture: true, passive: true });
  }

  /** The dial and name of a station, by dial; null when the list has no such station. */
  stationNamed(dial: string): string | null {
    const s = this.stations.find((x) => x.dial === dial);
    return s ? `${s.dial} ${s.name}` : null;
  }

  /** The dial the radio is on, when that station comes in here; null when it is off or lost. */
  get tunedDial(): string | null { return this.station >= 0 && this.band !== 'lost' ? this.stations[this.station].dial : null; }

  /** The tuned station and where its piece is now, while it really sounds here (not off, lost, loading or in a call). */
  position(): { dial: string; file: string; at: number } | null {
    const heard = this.heard();
    return heard && this.band !== 'lost' ? { dial: this.stations[this.station].dial, ...heard } : null;
  }

  /** Plays a call now, into the pause the station is in. False when the radio cannot (off, held, not on its own piece). */
  callIn(call: CallIn): boolean { return this.startCall(call, false); }

  protected override atEnd(): boolean {
    const call = this.station >= 0 && this.band !== 'lost' ? this.onEnd?.() : null;
    if (!call) return false;
    if (this.startCall(call, true)) return true;
    call.done();
    return false;
  }

  private startCall(call: CallIn, ended: boolean): boolean {
    // The board hears first: whatever the words do, the call is over.
    const started = this.interject(call.urls, () => { this.callLine = ''; call.done(); this.label(); }, ended);
    if (started) { this.callLine = call.line; this.label(); }
    return started;
  }

  /** The wind through a stuck window takes some of the volume, and a weak signal takes some of the music. */
  protected override level(): number { return this.volume * this.wind * this.music; }

  /** The song title is dim until sound is really coming out: not while a song loads, and not where the station is lost. */
  protected override sounding(live: boolean): void { this.playing = live; this.chip.classList.toggle('live', live && this.band !== 'lost'); }

  /**
   * The T key, or a tap on the readout: the next station round the dial that comes in where the car is, and after a
   * full turn from the starting one, off. The dial never leaves a station by itself: one that fades stays, under static.
   */
  next(): void {
    this.turnTo(nextOnDial(this.stations.length, this.station, this.first,
      (i) => comesIn(signalAt(this.map, this.stations[i].dial, this.e, this.n))));
  }

  /** The dial's own burst of static is as loud from a weak station as from a clear one; then the new station is heard as it comes in here. */
  protected override turnTo(station: number): void {
    this.music = 1;
    super.turnTo(station);
    this.receive(true);
  }

  /** Where the car is, in map metres (east, north). The game says so every frame. */
  setPlace(e: number, n: number): void { this.e = e; this.n = n; this.receive(); }

  /** Another reception map, or none (every station comes in everywhere): just driving and ?reception=0 take none, and the checks give their own. */
  useReception(map: ReceptionMap | null): void { this.map = map; this.receive(true); }

  /** For the checks: what the car hears of its station now. `static` is the level of the static that sounds (0: none). */
  get reception(): { e: number; n: number; signal: number; band: Band; music: number; hiss: number; static: number; context: string } {
    return { e: this.e, n: this.n, signal: this.signal, band: this.band, music: this.music, hiss: this.crackle,
      static: this.noiseLoop ? this.noiseLevel : 0, context: this.noiseLoop?.ctx.state ?? 'none' };
  }

  /** `fresh`: the station was just tuned, so the readout's last word does not hold. */
  private receive(fresh = false): void {
    this.signal = this.station < 0 ? 1 : signalAt(this.map, this.stations[this.station].dial, this.e, this.n);
    const band = bandOf(this.signal, fresh ? undefined : this.band);
    const heard = mix(flutter(this.signal, this.e, this.n), band);
    this.music = heard.music; this.crackle = heard.hiss;
    if (band !== this.band) {
      this.band = band;
      // Out of range during a call: nobody hears the rest of it, so it ends (a muted call would still end as played).
      if (band === 'lost') this.endCall();
      this.label(); this.sounding(this.playing);
    }
    this.sound();
  }

  /**
   * Sets the levels of the music and of the static. A phone does not let a page set the music's volume (its own buttons
   * do that), so a lost station is also muted: on a phone the music is whole under the static, and then gone.
   */
  private sound(): void {
    this.audio.volume = this.level();
    this.audio.muted = this.music <= 0;
    const wanted = this.on && !this.held && this.station >= 0 && !document.hidden && this.volume > 0 && this.signal < 1;
    this.setStatic(wanted ? this.volume * this.wind * this.crackle * STATIC_TRIM : 0, wanted);
  }

  /**
   * The static of a weak station goes round for as long as it is wanted, and stops when it is not. `keep`: the station
   * is not whole here, so a level of zero only turns the static down. Near the limit the level comes and goes with the
   * flutter many times a second, and a new loop for each would be work for nothing.
   */
  private setStatic(level: number, keep: boolean): void {
    try {
      if (!keep) {
        const old = this.noiseLoop;
        if (!old) return;
        this.noiseLoop = null; this.noiseLevel = 0;
        old.gain.gain.setTargetAtTime(0, old.ctx.currentTime, 0.03);
        old.source.stop(old.ctx.currentTime + 0.25);
        return;
      }
      if (!this.noiseLoop) {
        if (level <= 0) return;
        const ctx = this.staticContext();
        if (!ctx) return;
        if (!this.noiseBuffer) {
          const size = Math.floor(ctx.sampleRate * STATIC_SECONDS);
          this.noiseBuffer = ctx.createBuffer(1, size, ctx.sampleRate);
          const data = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
        }
        const source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
        source.buffer = this.noiseBuffer; source.loop = true;
        band.type = 'bandpass'; band.frequency.value = 2400; band.Q.value = 0.5;
        gain.gain.value = 0;
        source.connect(band).connect(gain).connect(ctx.destination);
        source.onended = () => { source.disconnect(); band.disconnect(); gain.disconnect(); };
        source.start();
        this.noiseLoop = { ctx, source, gain };
        if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* a tap or a key starts it (wake) */ });
      }
      if (level <= 0 ? this.noiseLevel > 0 : Math.abs(level - this.noiseLevel) > 0.002) {
        this.noiseLevel = level;
        this.noiseLoop.gain.gain.setTargetAtTime(level, this.noiseLoop.ctx.currentTime, 0.08);
      }
    } catch { /* no static, then */ }
  }

  /** `visible`: the driving view is up. `indoors`: the carrier has left the car, and the radio with it. */
  update(visible: boolean, indoors: boolean): void {
    this.chip.hidden = !visible;
    this.chip.classList.toggle('expanded', performance.now() < this.expandedUntil);
    if (indoors !== this.indoors) { this.indoors = indoors; this.hold(); }
    // Sit under the bladder gauge, wherever the layout has put it.
    if (visible && !document.body.classList.contains('tcOn') && --this.layout <= 0) {
      this.layout = 15;
      const gauge = document.getElementById('relief');
      const box = gauge && !gauge.hidden ? gauge.getBoundingClientRect() : null;
      if (box && box.height) {
        this.chip.style.top = `${Math.round(box.bottom + 6)}px`;
        this.chip.style.left = `${Math.round(box.left)}px`;
        this.chip.style.maxWidth = `${Math.max(90, Math.min(300, Math.floor(innerWidth - box.left - 10)))}px`;
      }
    }
  }

  /** Stops the sound while the carrier is indoors or the page is hidden, and picks the station up again after. */
  private hold(): void { this.setHeld(this.indoors || document.hidden); this.sound(); }

  protected override label(): void {
    this.expandedUntil = performance.now() + 4000;
    const off = this.station < 0, lost = !off && this.band === 'lost', weak = !off && this.band === 'weak';
    this.chip.classList.toggle('off', off);
    this.chip.classList.toggle('lost', lost);
    this.chip.classList.toggle('weak', weak);
    this.chip.classList.toggle('call', !off && !lost && !!this.callLine);
    // The station's name keeps its place when the signal goes, so the readout keeps its size; only the song's line changes.
    this.dial.textContent = off ? '♪ RADIO OFF' : `♪ ${this.stations[this.station].dial} ${this.stations[this.station].name}`;
    const title = off ? '' : this.callLine || this.stations[this.station].tracks[this.track].title;
    // A call line is shown as it is: the player's name has the room.
    this.song.textContent = lost ? 'NO SIGNAL' : weak && !this.callLine ? `WEAK · ${title}` : title;
    this.chip.setAttribute('aria-label', off ? 'Radio is off. Press for the first station.'
      : lost ? `Radio: ${this.stations[this.station].name} does not come in here. Press for the next station.`
        : `Radio: ${this.stations[this.station].name}, ${weak ? 'weak signal, ' : ''}playing ${title}. Press for the next station.`);
  }
}
