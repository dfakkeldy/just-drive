// Just Listen: the car radio alone, on a light page of its own (/listen/, built by tools/listen-page.mjs).
// It loads no land and no game. It reads the same station list and the same song files as the car radio, and the
// engine in radio-player.ts keeps the same clock, so this page and a car play the same second of the same song.
// The page plays on with the screen locked: the phone's lock screen shows the station and the title, pauses and plays,
// and its previous and next buttons move the dial down and up.

import { RadioPlayer, clockAt, fetchStations, type RadioStation, type RadioTrack } from './radio-player';

/** What the page shows at a moment. */
interface Shown { station: number; track: number; at: number; wanted: boolean; sound: boolean; onClock: boolean }

class ListenRadio extends RadioPlayer {
  private picked = -1;     // the station whose programme the listener has stepped into, off its clock; -1 is none
  private sound = false;   // sound is really coming out
  private outside = false; // the phone or the browser stopped the song, not the listener

  constructor(stations: RadioStation[], base: string, start: string | undefined, private readonly changed: () => void) {
    super(stations, base, start, 'mmm.radio.listen');
    this.background = true;
    if (this.station < 0) this.station = this.first;   // this page has no "off" on its dial
    // The phone or the browser can stop the song by itself (a telephone call, earphones pulled out), and start it again.
    // It is judged a moment later, because a change of song also passes through "paused".
    this.audio.addEventListener('pause', () => setTimeout(() => {
      if (this.stopped()) { this.held = true; this.outside = true; this.changed(); }
    }, 300));
    this.audio.addEventListener('playing', () => {
      if (!this.outside) return;
      this.outside = false;
      if (!this.held) return;
      this.held = false;
      if (this.onClock) this.tuneLive(); else this.changed();   // the clock went on meanwhile
    });
  }

  /** The song stands still, and the listener did not ask for that. */
  private stopped(): boolean { return this.on && !this.held && this.audio.paused && !this.audio.ended && this.mine(); }

  get list(): readonly RadioStation[] { return this.stations; }
  get loudness(): number { return this.volume; }
  /** On the station's clock, as a radio is. Off it, the station plays its pieces in order from the one the listener chose. */
  private get onClock(): boolean { return !this.plain.has(this.station); }

  shown(): Shown {
    const wanted = this.on && !this.held, clock = clockAt(this.stations, this.station);
    // While it plays, the piece is the one in the player. A silent radio shows what is on the air now.
    const track = wanted || !this.onClock ? this.track : clock.track;
    // A chosen piece keeps its own time, also while it is paused; a station on its clock shows the clock's.
    const at = this.mine() && (this.sound || !this.onClock) ? this.audio.currentTime : this.onClock && track === clock.track ? clock.at : 0;
    return { station: this.station, track, at, wanted, sound: this.sound, onClock: this.onClock };
  }

  protected override label(): void { this.changed(); }
  protected override sounding(live: boolean): void { this.sound = live; this.changed(); }

  /** The play button: start, pause, or play again. */
  toggle(play = !(this.on && !this.held) || this.stopped()): void {
    if (play && this.stopped()) this.held = true;   // stopped from outside, and not yet seen: play starts it again
    this.outside = false;
    if (!play) this.setHeld(true);
    else if (!this.on) { this.held = false; this.start(); }
    else if (this.held) {
      // On a hidden page (the lock screen's play button) the old song starts at once, so that the page is not silent
      // while the clock's song arrives.
      if (document.hidden && this.mine()) void this.audio.play().catch(() => { /* the tune below plays */ });
      if (this.onClock) this.setHeld(false);
      else { this.held = false; if (this.mine()) this.play(); else this.tune(this.track, 0); }
    }
    this.changed();
  }

  /** Moves the dial to a station; past either end it comes round again. This page has no "off": the play button pauses. */
  to(station: number): void {
    const n = this.stations.length;
    station = ((station % n) + n) % n;
    if (station === this.station && this.on && !this.held && this.onClock && !this.stopped()) return;
    this.outside = false;
    if (this.picked >= 0) { this.plain.delete(this.picked); this.picked = -1; }
    this.held = false;
    this.turnTo(station);
  }
  step(by: number): void { this.to(this.station + by); }

  /** The programme list: plays a piece from its start. The station then goes on in order until LIVE. */
  pick(track: number): void {
    this.plain.add(this.station); this.picked = this.station;
    this.outside = false; this.held = false; this.on = true;
    this.prime();
    this.tune(track, 0);
  }

  /** Back to the station's clock. */
  goLive(): void {
    this.plain.delete(this.station); this.picked = -1;
    this.outside = false; this.held = false;
    if (this.on) this.tuneLive(); else this.start();
    this.changed();
  }

  volumeTo(text: string): void { this.setVolume(text); }
}

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
};
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
/** Writes a text only when it has changed, so that a screen reader hears each title once. */
const say = (node: HTMLElement, text: string) => { if (node.textContent !== text) node.textContent = text; };

const LOW = 87.5, HIGH = 108.5;   // the ends of the dial's scale, in MHz

function page(radio: ListenRadio): () => void {
  const stations = radio.list;
  const unit = el('unit'), band = el('band'), needle = el('needle'), presets = el('presets'), programme = el('programme');
  const dial = el('dial'), name = el('name'), state = el('state'), title = el('title'), next = el('next'), bar = el('bar');
  const play = el<HTMLButtonElement>('play'), live = el<HTMLButtonElement>('live'), timeNow = el('timeNow'), timeAll = el('timeAll');

  // A station sits on the scale at its own frequency. A list whose dials are not frequencies gets even spacing.
  const numbers = stations.map((s) => parseFloat(s.dial));
  const scale = numbers.every((f) => f >= LOW && f <= HIGH);
  const place = (i: number) => scale ? (numbers[i] - LOW) / (HIGH - LOW) * 100 : (i + .5) / stations.length * 100;
  if (scale) {
    // A tick at each megahertz, a longer one and a number at each fourth.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${HIGH - LOW} 18`); svg.setAttribute('preserveAspectRatio', 'none');
    for (let f = Math.ceil(LOW); f <= HIGH; f++) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(f - LOW)); line.setAttribute('x2', String(f - LOW));
      line.setAttribute('y1', '4'); line.setAttribute('y2', f % 4 ? '11' : '18');
      svg.append(line);
      if (f % 4 === 0) { const num = make('span', { className: 'num' }, String(f)); num.style.left = `${(f - LOW) / (HIGH - LOW) * 100}%`; band.append(num); }
    }
    band.prepend(svg);
  }
  const marks = stations.map((_, i) => {
    const mark = make('i', { className: 'mark' });
    mark.style.left = `${place(i)}%`;
    band.append(mark);
    return mark;
  });
  // A tap on the scale moves the needle to the nearest station. (The station keys below are the buttons with names.)
  band.addEventListener('click', (ev) => {
    const box = band.getBoundingClientRect(), at = (ev.clientX - box.left) / box.width * 100;
    let near = 0;
    stations.forEach((_, i) => { if (Math.abs(place(i) - at) < Math.abs(place(near) - at)) near = i; });
    radio.to(near);
  });
  const keys = stations.map((s, i) => {
    const key = make('button', { className: 'preset', type: 'button' }, make('b', {}, s.dial), make('span', {}, s.name));
    key.addEventListener('click', () => radio.to(i));
    presets.append(key);
    return key;
  });
  el('down').addEventListener('click', () => radio.step(-1));
  el('up').addEventListener('click', () => radio.step(1));
  play.addEventListener('click', () => radio.toggle());
  live.addEventListener('click', () => radio.goLive());
  addEventListener('keydown', (ev) => {
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey || (ev.target as HTMLElement | null)?.closest?.('input,a,button,summary')) return;
    if (ev.code === 'Space' || ev.code === 'KeyK') { ev.preventDefault(); radio.toggle(); }
    else if (ev.code === 'ArrowRight' || ev.code === 'KeyT') radio.step(1);
    else if (ev.code === 'ArrowLeft') radio.step(-1);
  });

  // A phone sets its own volume; a mouse gets a slider.
  const volume = el<HTMLInputElement>('volume');
  if (matchMedia('(pointer: coarse)').matches) el('volumeRow').hidden = true;
  else { volume.value = String(radio.loudness); volume.addEventListener('input', () => radio.volumeTo(volume.value)); }

  // The lock screen and the earphone buttons.
  const media = 'mediaSession' in navigator ? navigator.mediaSession : null;
  const action = (what: MediaSessionAction, run: () => void) => { try { media?.setActionHandler(what, run); } catch { /* this browser has no such button */ } };
  action('play', () => radio.toggle(true));
  action('pause', () => radio.toggle(false));
  action('previoustrack', () => radio.step(-1));
  action('nexttrack', () => radio.step(1));
  const art = (size: number) => ({ src: new URL(`icon-${size}.png`, location.href).href, sizes: `${size}x${size}`, type: 'image/png' });

  let listed = -1, told = '';
  const rows: HTMLButtonElement[] = [];
  const draw = () => {
    const now = radio.shown(), station = stations[now.station], tracks = station.tracks, piece: RadioTrack = tracks[now.track];
    if (listed !== now.station) {
      listed = now.station;
      rows.length = 0;
      programme.replaceChildren(...tracks.map((t, i) => {
        const row = make('button', { type: 'button' }, make('span', {}, t.title), make('time', {}, clock(t.seconds)));
        row.addEventListener('click', () => radio.pick(i));
        rows.push(row);
        return make('li', {}, row);
      }));
      el('programmeName').textContent = `${station.dial} ${station.name}`;
    }
    say(dial, station.dial); say(name, station.name);
    say(title, piece.title); say(next, tracks[(now.track + 1) % tracks.length].title);
    say(state, !now.wanted ? (now.onClock ? 'ON THE AIR NOW' : 'PAUSED') : !now.sound ? 'TUNING…' : now.onClock ? 'NOW PLAYING' : 'FROM THE START');
    unit.dataset.state = !now.wanted ? 'silent' : now.sound ? 'sound' : 'tuning';
    needle.style.left = `${place(now.station)}%`;
    marks.forEach((mark, i) => mark.classList.toggle('on', i === now.station));
    keys.forEach((key, i) => { key.setAttribute('aria-pressed', String(i === now.station)); });
    rows.forEach((row, i) => { if (i === now.track) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current'); });
    play.setAttribute('aria-label', now.wanted ? 'Pause the radio' : 'Play the radio');
    play.setAttribute('aria-pressed', String(now.wanted));
    live.setAttribute('aria-pressed', String(now.onClock));
    say(live, now.onClock ? 'LIVE' : 'GO TO LIVE');
    bar.style.width = `${Math.min(100, now.at / piece.seconds * 100).toFixed(1)}%`;
    say(timeNow, clock(Math.min(now.at, piece.seconds))); say(timeAll, clock(piece.seconds));
    const tab = `${station.dial} ${station.name} · Just Listen`;
    if (document.title !== tab) document.title = tab;
    if (media) {
      const key = `${station.dial}\n${piece.file}`;
      if (key !== told && 'MediaMetadata' in window) {
        told = key;
        media.metadata = new MediaMetadata({ title: piece.title, artist: `${station.dial} ${station.name}`, album: 'Just Listen', artwork: [art(192), art(512)] });
      }
      media.playbackState = now.wanted ? 'playing' : 'paused';
    }
  };
  return draw;
}

async function begin(): Promise<void> {
  // The songs are beside the game's: the same folder, the same list (audio/radio.json, on both hosts), the same files.
  const base = new URL('../audio', location.href).pathname.replace(/\/$/, '');
  const got = await fetchStations(base);
  if (!got) {
    el('state').textContent = 'NO SIGNAL';
    el('title').textContent = 'The radio is not here now. Try again in a while.';
    return;
  }
  let draw = () => { /* the page is not built yet */ };
  const radio = new ListenRadio(got.stations, base, got.start, () => draw());
  draw = page(radio);
  draw();
  document.documentElement.dataset.listen = 'ready';
  // The clock moves a silent radio's title too. A hidden page needs no drawing; it draws again when it is seen.
  setInterval(() => { if (!document.hidden) draw(); }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
}

void begin();
