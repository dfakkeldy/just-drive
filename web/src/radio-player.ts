// The radio's playing engine: the station clocks, the songs in memory, and the join in the middle of a song.
// It puts nothing on the page. The car's readout (radio.ts) and the Just Listen page (listen.ts) both stand on it,
// so the two play the same thing at the same moment.
// A station is a short playlist that keeps "playing" while nobody listens, so a change of station lands in the
// middle of a song, as a radio does.
// One plain <audio> element plays the music: on a phone it still sounds with the ringer switch off, and the phone's
// own buttons set the volume. Only the burst of static between stations uses the Web Audio API.
// A song is downloaded whole and played from memory. A host that cannot send part of a file (the public site's cannot)
// would stop a phone from playing it at all, and would stop any browser from joining a song in the middle.
// The songs are data (audio/radio.json and its files), not code.

export interface RadioTrack { file: string; title: string; seconds: number }
export interface RadioStation { dial: string; name: string; tracks: RadioTrack[] }

/** Reads audio/radio.json. Anything that is not a usable station is left out, so a bad file cannot stop the game. */
export function readRadio(json: unknown): RadioStation[] {
  const list = (json as { stations?: unknown } | null)?.stations;
  if (!Array.isArray(list)) return [];
  const out: RadioStation[] = [];
  for (const s of list as Partial<RadioStation>[]) {
    if (!s || typeof s.dial !== 'string' || typeof s.name !== 'string' || !Array.isArray(s.tracks)) continue;
    const tracks = s.tracks.filter((t): t is RadioTrack => !!t && typeof t.file === 'string' && /^[\w.-]+$/.test(t.file)
      && typeof t.title === 'string' && Number.isFinite(t.seconds) && t.seconds > 5);
    if (tracks.length) out.push({ dial: s.dial, name: s.name, tracks });
  }
  return out;
}

/** The dial the radio is on for a player who has not yet chosen one (the list's `start`), if the list names one. */
export function readStart(json: unknown): string | undefined {
  const start = (json as { start?: unknown } | null)?.start;
  return typeof start === 'string' ? start : undefined;
}

/**
 * Fetches a station list. With no list, or a list with no usable station, the answer is null: one list never stands
 * in for another.
 */
export async function fetchStations(base: string, list = 'radio.json'): Promise<{ stations: RadioStation[]; start?: string } | null> {
  try {
    const answer = await fetch(`${base}/${list}`);
    if (!answer.ok) return null;
    const json: unknown = await answer.json();
    const stations = readRadio(json);
    return stations.length ? { stations, start: readStart(json) } : null;
  } catch {
    return null;
  }
}

const SPREAD = 97;          // seconds between one station's clock and the next, so they are never in step
const STATIC = 0.26;        // seconds of static when the dial moves
const KEPT = 3;             // songs held in memory at once

/**
 * Where a station's own clock is at a moment: which song, and how many seconds into it. Every page that asks gets the
 * same answer at the same moment, so the car and the Just Listen page are on the same second of the same song.
 */
export function clockAt(stations: readonly RadioStation[], station: number, now = Date.now()): { track: number; at: number } {
  const tracks = stations[station].tracks;
  const total = tracks.reduce((sum, t) => sum + t.seconds, 0);
  let at = (now / 1000 + station * SPREAD) % total, i = 0;
  while (i < tracks.length - 1 && at >= tracks[i].seconds) at -= tracks[i++].seconds;
  return { track: i, at };
}

/** A tenth of a second of silence, as a sound file. Playing it inside a tap lets a phone play the real song a moment later. */
function silence(): string {
  const n = 800, bytes = new Uint8Array(44 + n), view = new DataView(bytes.buffer);
  const text = (at: number, word: string) => { for (let i = 0; i < word.length; i++) bytes[at + i] = word.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + n, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true); view.setUint16(34, 8, true); text(36, 'data'); view.setUint32(40, n, true);
  bytes.fill(128, 44);
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

export class RadioPlayer {
  protected readonly audio = new Audio();
  protected station = 0;            // -1 is off
  protected readonly first: number; // the station a new player hears; off sits just before it on the dial
  protected track = 0;
  protected on = false;             // a real tap or key has started the radio, so sound may play
  protected held = false;           // something keeps the radio silent for now (see setHeld)
  /**
   * The page plays on while it is hidden (a locked phone). A phone may stop a hidden page as soon as it is silent, so
   * such a radio fetches the next song while this one plays, and no download stands between two songs.
   */
  protected background = false;
  private ticket = 0;               // a newer tune cancels the work of an older one
  private missed = 0;               // songs in a row that did not arrive since the radio last joined its clock (see tune)
  private seek: { ticket: number; at: number } | null = null;   // where to join the song once the browser knows its length
  protected readonly plain = new Set<number>();   // stations that leave the clock: these play their songs in order, each from the top
  private waiting = false;          // the browser refused to play before a tap or a key
  private songUrl = '';             // the song now in the player (an address in memory); the short silence is not a song
  private songFile = '';
  private songTicket = -1;          // the tune that put that song in the player; a newer tune disowns it
  private primed = false;           // the silence has been played inside a tap
  private quiet: string | null = null;
  private readonly songs = new Map<string, Promise<string>>();   // file name to its address in memory
  protected volume = 0.7;
  private noise: AudioContext | null = null;
  /** A call played into a pause of the station (see interject): what is left to play, and where the piece waits. */
  private cut: { urls: string[]; now: string; at: number; ended: boolean; ticket: number; done: () => void } | null = null;
  /** A call has played: the station is a little behind its clock, so its pieces go on in order, each from the top,
   * until the radio joins the clock again (the dial moves, the radio comes back from a hold). */
  private behind = false;

  /** `storageKey`: where this radio keeps the listener's station and volume. A second radio (another game or page on the same site) takes its own. */
  constructor(protected readonly stations: RadioStation[], protected readonly base: string, start?: string, protected readonly storageKey = 'mmm.radio') {
    const saved = (() => { try { return [localStorage.getItem(this.storageKey), localStorage.getItem(`${this.storageKey}.vol`)]; } catch { return [null, null]; } })();
    this.first = Math.max(0, stations.findIndex((s) => s.dial === start));
    const savedStation = stations.findIndex((s) => s.dial === saved[0]);
    this.station = saved[0] === 'off' ? -1 : savedStation >= 0 ? savedStation : this.first;
    const vol = parseFloat(saved[1] ?? '');
    if (vol >= 0 && vol <= 1) this.volume = vol;
    this.audio.preload = 'none';
    this.audio.volume = this.volume;
    // At the end of a song the station clock decides what comes next (advance). At the end of a call's piece, the next.
    this.audio.addEventListener('ended', () => {
      if (this.cut) { if (this.audio.src === this.cut.now) this.cutNext(); return; }
      if (this.station < 0 || !this.mine()) return;
      if (!this.atEnd()) this.advance();
    });
    // One listener for every tune: it joins the song at the wanted second, never past the song's real end.
    this.audio.addEventListener('loadedmetadata', () => {
      if (!this.mine()) return;
      const seek = this.seek;
      this.seek = null;
      if (!seek || seek.ticket !== this.ticket || seek.at <= 1) return;
      const length = this.audio.duration;
      if (Number.isFinite(length) && seek.at > length - 1) {
        if (Math.abs(length - (this.stations[this.station]?.tracks[this.track]?.seconds ?? 0)) < 1.5) {
          // The file is as long as the list says: the clock is only in this song's last second. The next song starts,
          // a moment early. (Without this, a join in a song's last second took the station off its clock for good.)
          if (!this.background || !document.hidden) this.audio.pause();
          this.tune(this.track + 1, 0);
          return;
        }
        // The clock is past the real end of this file, so the list's times are wrong. Seeking to the end again and again
        // would loop; this station now plays its songs in order instead, each from the top.
        if (!this.plain.has(this.station)) console.info(`[radio] ${this.stations[this.station]?.dial}: song lengths do not match the list; playing in order`);
        this.plain.add(this.station);
        return;
      }
      try { this.audio.currentTime = seek.at; } catch { /* the song starts from the top */ }
    });
    // Sound is really coming out, or it is not: the page shows which.
    this.audio.addEventListener('playing', () => {
      if (this.cut) { this.sounding(true); return; }
      if (!this.mine()) return;
      this.sounding(true);
      if (this.background && this.station >= 0) {
        const tracks = this.stations[this.station].tracks;
        if (tracks.length > 1) void this.fetchSong(tracks[(this.track + 1) % tracks.length].file);
      }
    });
    for (const type of ['pause', 'waiting', 'emptied', 'error'] as const) this.audio.addEventListener(type, () => this.sounding(false));
    // A song that will not play: try the next one, a few seconds later, and not in a tight loop.
    this.audio.addEventListener('error', () => { if (this.cut) this.cutEnd(true); else if (this.mine()) this.skipSoon(this.ticket); });
  }

  /** The next piece after the end of one: the station clock decides, so the playlist never drifts from it. */
  protected advance(): void {
    // If the clock says this same song is still on (the file was shorter than the list says), the next one starts.
    const live = this.live();
    if (this.behind || this.plain.has(this.station) || live.track === this.track) this.tune(this.track + 1, 0); else this.tune(live.track, live.at);
  }
  /** At the end of a piece, before the next: true when the page plays something into that gap (it then goes on by itself). */
  protected atEnd(): boolean { return false; }

  /** Where the station's own piece is now, while it really sounds: not while it loads, waits, or a call plays. */
  protected heard(): { file: string; at: number } | null {
    // Not before the join: until the browser has the piece's length, the player is at 0, not at the clock's second.
    if (this.cut || this.station < 0 || this.held || !this.mine() || this.audio.paused || this.seek || this.audio.readyState < 1) return null;
    return { file: this.songFile, at: this.audio.currentTime };
  }

  /**
   * Plays short pieces (a call to the talk show) into a pause of the station. The piece that was on waits, and goes on
   * from the same second after; `ended`: the pause is the end of a piece, so the station goes on by its clock after.
   * The radio's own <audio> element plays them: a phone that lets the radio play lets these play too, and anything that
   * hears the radio hears them. Refused (false) while the radio is off, held, not started, or not on its own piece.
   * `done` is called once, when the last piece ends or the call is cut off (the dial moves, the radio is held).
   */
  protected interject(urls: readonly string[], done: () => void, ended = false): boolean {
    if (this.cut || !urls.length || this.station < 0 || this.held || !this.on || !this.mine()) return false;
    this.cut = { urls: [...urls], now: '', at: this.audio.currentTime, ended, ticket: this.ticket, done };
    this.cutNext();
    return true;
  }
  private cutNext(): void {
    const cut = this.cut;
    if (!cut) return;
    const url = cut.urls.shift();
    if (url === undefined) { this.cutEnd(true); return; }
    cut.now = url;
    this.audio.src = url;
    this.audio.play().catch(() => { if (this.cut === cut && cut.now === url) this.cutEnd(true); });
  }

  /** A call that plays stops here, and the station's piece goes on (the page has lost the station, say). */
  protected endCall(): void { this.cutEnd(true); }

  /** `resume`: the call is over, so the station's piece goes on. Otherwise the dial moved or the radio is held, and that owns the player. */
  private cutEnd(resume: boolean): void {
    const cut = this.cut;
    if (!cut) return;
    this.cut = null;
    cut.done();
    if (!resume || cut.ticket !== this.ticket || this.station < 0 || this.held) return;
    this.behind = true;
    if (cut.ended) { this.advance(); return; }
    // Back to the same second of the same piece: the one 'loadedmetadata' listener joins it there.
    this.seek = { ticket: this.ticket, at: cut.at };
    this.audio.src = this.songUrl;
    this.play();
  }

  /** The page's words for the station and the song have changed. */
  protected label(): void { /* the page that shows the radio fills this in */ }
  /** `live`: sound is really coming out now. */
  protected sounding(_live: boolean): void { /* the page that shows the radio fills this in */ }
  /** How loud the player is set, from 0 to 1. */
  protected level(): number { return this.volume; }

  /** Sets and keeps the listener's volume. `text` is a number from 0 to 1, as a slider gives it. */
  protected setVolume(text: string): void {
    this.volume = parseFloat(text); this.audio.volume = this.level();
    try { localStorage.setItem(`${this.storageKey}.vol`, text); } catch { /* private mode */ }
  }

  /** A real tap or key has come, so the browser lets sound start. */
  start(): void {
    if (this.on) return;
    this.on = true;
    this.prime();
    if (this.station >= 0) this.tuneLive();
  }

  /** True when the player holds the song of the present tune: not the short silence, and not a song that a newer tune has replaced. */
  protected mine(): boolean { return this.songUrl !== '' && this.audio.src === this.songUrl && this.songTicket === this.ticket; }

  /**
   * Inside a tap or a key press: play a moment of silence. A phone lets a player that has once been started by the
   * person start again by itself, and the real song is ready only after its download.
   */
  protected prime(): void {
    if (this.primed || this.mine()) return;
    // Counted as done only when the browser really played it: a call outside a tap is refused, and the next tap tries again.
    try { this.audio.src = this.quiet ??= silence(); this.audio.play().then(() => { this.primed = true; }, () => { /* refused: not inside a tap */ }); } catch { /* no sound yet */ }
  }

  private skipSoon(ticket: number): void {
    setTimeout(() => { if (ticket === this.ticket && this.station >= 0) this.tune(this.track + 1, 0); }, 4000);
  }

  /** Downloads a song once and keeps it in memory; the oldest of more than a few is let go. */
  private fetchSong(file: string): Promise<string> {
    let song = this.songs.get(file);
    if (!song) {
      // The type is set by hand: the songs are always MP3, whatever a host calls them.
      song = fetch(`${this.base}/${file}`).then((r) => { if (!r.ok) throw new Error(`${file}: ${r.status}`); return r.arrayBuffer(); })
        .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
      const mine = song;
      song.catch(() => { if (this.songs.get(file) === mine) this.songs.delete(file); });
      this.songs.set(file, song);
      for (const [name, old] of this.songs) {
        if (this.songs.size <= KEPT) break;
        if (name === file || name === this.songFile) continue;
        this.songs.delete(name);
        old.then((url) => { if (url !== this.songUrl) URL.revokeObjectURL(url); }).catch(() => { /* it never arrived */ });
      }
    }
    return song;
  }

  /** Moves the dial to a station (-1 is off), keeps the choice, and joins the station where its clock is. */
  protected turnTo(station: number): void {
    // A call that plays is over, while the old station is still the one on the dial (its end puts the station's words back).
    this.cutEnd(false);
    this.station = station;
    try { localStorage.setItem(this.storageKey, this.station < 0 ? 'off' : this.stations[this.station].dial); } catch { /* private mode */ }
    this.on = true;
    // The old station stops at once, as when a dial moves, and its song is disowned: it must not go on (and end) under
    // the new station's name. This comes before the silence, or the pause would stop the silence too.
    // (On a hidden page that plays on, the old song goes on, disowned, until the new station's song has arrived:
    // a moment of silence there could end the radio.)
    if (!this.background || !document.hidden || this.station < 0) this.audio.pause();
    this.ticket++;
    this.prime();
    this.hiss();
    // Off is silent at once. (The player's own 'pause' event comes later, and a page that waited for it showed and
    // ducked under a radio that was already off.) A station says so for itself, in tune().
    if (this.station < 0) { this.sounding(false); this.label(); } else this.tuneLive();
  }

  /**
   * Stops the sound while something holds the radio (the carrier is indoors, the page is hidden, the listener has
   * pressed pause), and picks the station up again after.
   */
  protected setHeld(held: boolean): void {
    if (held === this.held) return;
    this.held = held;
    if (held) { this.cutEnd(false); this.audio.pause(); }
    else if (this.on && this.station >= 0) this.tuneLive();
  }

  /** Where the station's own clock is now: which song, and how many seconds into it. */
  protected live(): { track: number; at: number } { return clockAt(this.stations, this.station); }

  /** Joins the station where its own clock says it is. */
  protected tuneLive(): void {
    this.behind = false;
    const live = this.live();
    this.missed = 0;
    this.tune(live.track, live.at, true);
  }

  /** `live`: join at the clock's second as it is when the song has arrived, not as it was when the download began. */
  protected tune(track: number, at: number, live = false): void {
    if (this.station < 0) return;
    this.cutEnd(false);   // a new tune (a skip, a retry) owns the player: a call that plays is over
    const tracks = this.stations[this.station].tracks;
    this.track = ((track % tracks.length) + tracks.length) % tracks.length;
    const ticket = ++this.ticket;
    this.label();
    if (this.held || !this.on) return;
    this.sounding(false);
    this.fetchSong(tracks[this.track].file).then((url) => {
      if (ticket !== this.ticket || this.held || this.station < 0) return;
      this.missed = 0;   // only a song this tune will play starts the count again
      if (live && !this.plain.has(this.station)) {
        const now = this.live();
        if (now.track !== this.track) { this.tuneLive(); return; }   // the clock moved on to the next song meanwhile
        at = now.at;
      }
      this.seek = { ticket, at };
      this.songUrl = url; this.songFile = tracks[this.track].file; this.songTicket = ticket;
      this.audio.src = url;
      this.play();
    }).catch(() => {
      if (ticket !== this.ticket) return;
      // A song that does not arrive: the next one is tried at once, for one full turn of the station. Offline, only the
      // songs the download saved arrive, and the clock is mostly on one it did not save. One try every few seconds
      // walked on past the saved songs and left the radio silent. After a full turn with none, one try every few seconds.
      if (++this.missed < tracks.length) this.tune(this.track + 1, 0); else this.skipSoon(ticket);
    });
  }

  protected play(): void {
    const ticket = this.ticket;
    this.audio.play().catch((e: unknown) => {
      // No tap or key yet: wait for the first one. Any other refusal (a newer tune took over) needs nothing.
      if ((e as { name?: string } | null)?.name !== 'NotAllowedError' || this.waiting || ticket !== this.ticket) return;
      this.waiting = true;
      // A phone counts the end of a touch as the player's say-so, not its start; a click or a key counts everywhere.
      const events = ['pointerup', 'touchend', 'click', 'keydown'] as const;
      const retry = () => {
        for (const type of events) removeEventListener(type, retry, true);
        this.waiting = false;
        if (!this.on || this.held || this.station < 0) return;
        // The song is already in the player: start it right here, inside the tap, at the clock's second.
        const now = this.live();
        if (this.mine() && ticket === this.ticket && (now.track === this.track || this.plain.has(this.station))) {
          if (!this.plain.has(this.station)) {
            // Before the browser knows the song's length, the join waits in the seek record; after, it is set here.
            if (this.audio.readyState >= 1) { try { this.audio.currentTime = now.at; } catch { /* from where it stands */ } }
            else this.seek = { ticket, at: now.at };
          }
          this.play();
        } else this.tuneLive();
      };
      for (const type of events) addEventListener(type, retry, true);
    });
  }

  /** The radio's one Web Audio context, made at the first need. Only static goes through it. */
  protected staticContext(): AudioContext | null {
    if (!this.noise) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.noise = new Ctx();
    }
    return this.noise;
  }

  /** A short burst of static as the dial moves. */
  private hiss(): void {
    try {
      if (this.volume <= 0 || document.hidden) return;   // nobody is at a hidden dial
      const ctx = this.staticContext();
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume();
      const n = Math.floor(ctx.sampleRate * STATIC), buffer = ctx.createBuffer(1, n, ctx.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
      const source = ctx.createBufferSource(), band = ctx.createBiquadFilter(), gain = ctx.createGain();
      source.buffer = buffer;
      band.type = 'bandpass'; band.frequency.value = 2400; band.Q.value = 0.5;
      gain.gain.value = 0.16 * this.level();
      source.connect(band).connect(gain).connect(ctx.destination);
      source.start();
    } catch { /* no static, then */ }
  }
}
