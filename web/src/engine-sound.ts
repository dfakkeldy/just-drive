// The driving sounds: an engine voice for each motor and the tyres on each surface, synthesised with the Web Audio API
// (no recordings). The numbers come from engine-sound-rules.ts; this file only builds the graph and glides it.
//
// The graph, built once at the first tap or key (a browser lets sound start only inside one):
//   voice (saw or square at the firing frequency; for the truck a periodic wave of one whole engine cycle, its uneven
//   pulses heard as the V8's lope) + upper (an octave up, full detail only: a phone speaker cannot play the low firing
//   note itself, so this carries it; the truck has none) -> lowpass -> engine gain
//   noise -> bandpass -> engine rasp gain (full detail only; it follows the load)
//   noise -> bandpass -> pulse gain (opened and shut by a square LFO: gravel chatter, washboard rattle) -> tyre gain
//   noise -> lowpass -> splash gain (wheels through a puddle: rough-roads.ts; quick to rise, slow to die away)
//   all -> master (the "Engine sound" volume times OUTPUT_TRIM, ducked under the radio) -> speakers
// LOW detail drops the upper voice and the rasp: two sources and three filters (with the splash lowpass) in all.
// The context is suspended (no CPU, no sound) while the page is hidden, off the road, indoors or at an ending.

import { ENGINES, OUTPUT_TRIM, RADIO_DUCK, SPLASH_DUCK, SPLASH_GAIN, UPPER, engineKind, engineState, engineWave, tyreState, voicePulses, type EngineKind } from './engine-sound-rules';

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
const KEY = 'mmm.engine.vol';
const GLIDE = .06;        // seconds: how quickly the voice follows a new engine speed
const QUIET_AFTER = .4;   // seconds of silence before the context is suspended

export interface DrivingMoment {
  /** Garage id of the vehicle driven now (car, truck, sxs, bike, horse). */
  kind: string;
  speed: number; throttle: number; surface: string; airborne: boolean; grade: number; towing: boolean;
  /** The radio is sounding now, and turned up. */
  radio: boolean;
  /** How far a drift is open, 0 to 1 (drift-rules.ts): the tyres squeal or spray. Absent or 0: rolling. */
  slide?: number;
  /** How hard the wheels go through water now, 0 to 1 (puddles.ts splashLevel). Absent or 0: dry. */
  splash?: number;
}

interface Graph {
  voice: OscillatorNode; upper: OscillatorNode | null; upperGain: GainNode | null; tone: BiquadFilterNode; engine: GainNode;
  rasp: GainNode | null; raspFilter: BiquadFilterNode | null;
  tyreFilter: BiquadFilterNode; pulse: GainNode; lfo: OscillatorNode; lfoDepth: GainNode; tyre: GainNode;
  splash: GainNode; master: GainNode;
}

/** The volume a new player hears, well under the radio music. At this setting the horse's hooves keep their own level. */
export const DEFAULT_ENGINE_VOLUME = .25;

/** Reads the saved volume (0 to 1). */
export function savedEngineVolume(): number {
  try { const v = parseFloat(localStorage.getItem(KEY) ?? ''); if (v >= 0 && v <= 1) return v; } catch { /* private mode */ }
  return DEFAULT_ENGINE_VOLUME;
}

/** Keeps the volume (0 to 1) for the next visit. The engine and the hooves share it. */
export function saveEngineVolume(v: number): void {
  try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ }
}

export class EngineSound {
  /** 0 to 1, from the Settings slider. */
  volume = savedEngineVolume();
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private gear = 1;
  private kind: EngineKind | null = null;
  private waves = new Map<EngineKind, PeriodicWave>();   // the pulse-train voices, made once per context
  private quiet = 0;        // seconds the master has been silent
  private live = false;     // the last update asked for sound
  private unlocked = false; // the context has really run once (a phone allows that only inside a tap's release)
  private parked = false;   // silenced and asked to suspend: quiet frames have nothing more to do
  private last = { rpm: 0, gear: 1, load: 0, tyre: 0, surface: '', splash: 0 };   // numbers only: snapshot rounds them
  private readonly unlock = () => this.start();

  constructor(private readonly low: boolean) {
    for (const type of GESTURES) addEventListener(type, this.unlock, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.hush(true); });
  }

  /**
   * Inside a tap or key: make the context and the graph, once, and let it run. A phone unlocks only a context that has
   * run inside a tap; the master is silent until update() asks for sound, and update() suspends it again when the game is
   * not driving. The listeners stay: a later tap resumes a context that a phone call or another app interrupted.
   */
  private start(): void {
    // Later taps resume while the game drives, or until the context has run once. A phone's press is not a gesture (only
    // the lift is), so a context made on the press stays suspended until a lift resumes it. Once unlocked, a tap on the
    // title card or indoors does not wake a paused engine.
    if (this.ctx) {
      if ((this.live || !this.unlocked) && !document.hidden && this.ctx.state !== 'running' && this.ctx.state !== 'closed') { this.parked = false; void this.ctx.resume().catch(() => {}); }
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.graph = this.build(this.ctx);
      const made = this.ctx;
      made.addEventListener('statechange', () => { if (made.state === 'running') this.unlocked = true; });
      if (!document.hidden) void this.ctx.resume().catch(() => {});
    } catch { this.ctx = null; this.graph = null; /* audio unavailable: the game plays silent */ }
  }

  private build(a: AudioContext): Graph {
    const master = a.createGain(); master.gain.value = 0; master.connect(a.destination);
    // One second of white noise, looped: the tyres and the rasp share it.
    const buffer = a.createBuffer(1, a.sampleRate, a.sampleRate), samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const noise = a.createBufferSource(); noise.buffer = buffer; noise.loop = true;

    const engine = a.createGain(); engine.gain.value = 0; engine.connect(master);
    const tone = a.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 1.2; tone.connect(engine);
    const voice = a.createOscillator(); voice.connect(tone);
    let upper: OscillatorNode | null = null, upperGain: GainNode | null = null, rasp: GainNode | null = null, raspFilter: BiquadFilterNode | null = null;
    if (!this.low) {
      upper = a.createOscillator(); upper.type = 'triangle';
      upperGain = a.createGain(); upperGain.gain.value = UPPER; upper.connect(upperGain).connect(tone);
      raspFilter = a.createBiquadFilter(); raspFilter.type = 'bandpass'; raspFilter.Q.value = 1.4;
      rasp = a.createGain(); rasp.gain.value = 0;
      noise.connect(raspFilter).connect(rasp).connect(master);
    }

    const tyre = a.createGain(); tyre.gain.value = 0; tyre.connect(master);
    const pulse = a.createGain(); pulse.gain.value = 1; pulse.connect(tyre);
    const tyreFilter = a.createBiquadFilter(); tyreFilter.type = 'bandpass'; noise.connect(tyreFilter).connect(pulse);
    const lfo = a.createOscillator(); lfo.type = 'square';
    const lfoDepth = a.createGain(); lfoDepth.gain.value = 0; lfo.connect(lfoDepth).connect(pulse.gain);

    // Water: a low, broad wash of the same noise. Silent until a wheel is in a puddle.
    const splash = a.createGain(); splash.gain.value = 0; splash.connect(master);
    const splashFilter = a.createBiquadFilter(); splashFilter.type = 'lowpass'; splashFilter.frequency.value = 900; splashFilter.Q.value = .7;
    noise.connect(splashFilter).connect(splash);

    noise.start(); voice.start(); upper?.start(); lfo.start();
    return { voice, upper, upperGain, tone, engine, rasp, raspFilter, tyreFilter, pulse, lfo, lfoDepth, tyre, splash, master };
  }

  /** Silences at once and suspends: the page is hidden, or the game has stopped driving. */
  private hush(now: boolean): void {
    const a = this.ctx, g = this.graph;
    if (!a || !g) return;
    g.master.gain.cancelScheduledValues(a.currentTime);
    // Suspending now freezes the graph: the gain must already be 0, or the old note comes back at the next resume.
    if (now) g.master.gain.setValueAtTime(0, a.currentTime); else g.master.gain.setTargetAtTime(0, a.currentTime, .02);
    // Also while a resume is still pending (state 'suspended' until it settles): a hidden page runs no frame to correct it.
    if (now && a.state !== 'closed') { this.parked = true; void a.suspend().catch(() => {}); }
  }

  /**
   * Once a frame. `moment` null: no driving sound now (title card, fly view, indoors, an ending, a hidden page).
   * The sound follows the vehicle the player drives now, so a fleet change or a vehicle choice needs no call.
   */
  update(dt: number, moment: DrivingMoment | null): void {
    const kind = moment ? engineKind(moment.kind) : null;
    this.live = !!kind && !document.hidden;
    const a = this.ctx, g = this.graph;
    if (!a || !g) return;
    if (!this.live || !moment || !kind) {
      this.quiet += dt;
      // Parked and suspended (or interrupted by a phone call): nothing to schedule, no promise a frame.
      if (!(this.parked && (a.state === 'suspended' || (a.state as string) === 'interrupted'))) this.hush(this.quiet >= QUIET_AFTER || document.hidden);
      return;
    }
    this.parked = false;
    if (a.state === 'suspended') void a.resume().catch(() => {});
    this.quiet = 0;
    const p = ENGINES[kind], t = a.currentTime, fresh = kind !== this.kind;
    if (fresh) {
      this.kind = kind; this.gear = 1;
      // A pulse train is a periodic wave; the type 'custom' itself cannot be set (the browser throws).
      if (p.wave === 'custom') {
        let wave = this.waves.get(kind);
        if (!wave) { const w = engineWave(p); wave = a.createPeriodicWave(w.real, w.imag); this.waves.set(kind, wave); }
        g.voice.setPeriodicWave(wave);
      } else g.voice.type = p.wave;
      g.upperGain?.gain.setValueAtTime(p.upper ?? UPPER, t);
    }
    const e = engineState(p, moment, this.gear);
    this.gear = e.gear;
    // A new vehicle starts on its own note at once: a pulse train's voice runs eight times lower than a plain wave's.
    const glide = (param: AudioParam, value: number) => fresh ? param.setValueAtTime(value, t) : param.setTargetAtTime(value, t, GLIDE);
    glide(g.voice.frequency, e.voice);
    if (g.upper) glide(g.upper.frequency, e.frequency * 2);
    g.tone.frequency.setTargetAtTime(e.cutoff, t, GLIDE);
    g.engine.gain.setTargetAtTime(e.gain, t, .05);
    if (g.rasp && g.raspFilter) {
      g.raspFilter.frequency.setTargetAtTime(e.rasp, t, GLIDE);
      g.rasp.gain.setTargetAtTime(p.level * .12 * e.load * e.load, t, .05);
    }
    const ty = tyreState(moment.surface, moment.speed, moment.airborne, p.tyres, moment.slide ?? 0);
    g.tyreFilter.frequency.setTargetAtTime(ty.frequency, t, .08);
    g.tyreFilter.Q.setTargetAtTime(ty.q, t, .08);
    g.lfo.frequency.setTargetAtTime(ty.rate, t, .05);
    // The pulse gain swings between 1 - depth and 1 (its base 1 - depth/2, the square LFO adds +-depth/2).
    g.pulse.gain.setTargetAtTime(1 - ty.depth / 2, t, .08);
    g.lfoDepth.gain.setTargetAtTime(ty.depth / 2, t, .08);
    const splash = Math.min(1, Math.max(0, moment.splash ?? 0)), wash = splash * SPLASH_GAIN;
    g.tyre.gain.setTargetAtTime(ty.gain * (1 - SPLASH_DUCK * splash), t, .08);
    g.splash.gain.setTargetAtTime(wash, t, wash > this.last.splash ? .015 : .2);
    this.last.splash = wash;
    g.master.gain.setTargetAtTime(this.volume * OUTPUT_TRIM * (moment.radio ? RADIO_DUCK : 1), t, .08);
    const last = this.last; last.rpm = e.rpm; last.gear = e.gear; last.load = e.load; last.tyre = ty.gain; last.surface = moment.surface;
  }

  /** Sets and keeps the volume. */
  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    saveEngineVolume(this.volume);
  }

  /** For the dev checks: what the sound is doing now. Not proof that a person heard it. */
  get snapshot() {
    return { context: this.ctx?.state ?? 'none', built: !!this.graph, unlocked: this.unlocked, low: this.low, kind: this.kind, live: this.live, volume: this.volume,
      master: this.graph ? +this.graph.master.gain.value.toFixed(3) : 0, wave: this.graph?.voice.type ?? '',
      // The firing frequency the voice plays now: a pulse train's oscillator runs once per engine cycle.
      frequency: this.graph ? +(this.graph.voice.frequency.value * (this.kind ? voicePulses(ENGINES[this.kind]) : 1)).toFixed(1) : 0,
      rpm: Math.round(this.last.rpm), gear: this.last.gear, load: +this.last.load.toFixed(3), tyre: +this.last.tyre.toFixed(3), surface: this.last.surface,
      splash: +this.last.splash.toFixed(3) };
  }
}

/** The "Engine sound" slider in the settings panel (or "Hoof sound" on a horse). Changes apply at once. */
export function engineVolumeSetting(label: string, initial: number, onChange: (v: number) => void): HTMLInputElement | null {
  const panel = document.getElementById('settings');
  if (!panel) return null;
  const wrap = Object.assign(document.createElement('label'), { id: 'engineVolume', textContent: label });
  wrap.style.cssText = 'display:block;margin-top:12px';
  const slider = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '1', step: '0.05', value: String(initial) });
  slider.setAttribute('aria-label', label);
  slider.addEventListener('input', () => onChange(parseFloat(slider.value)));
  wrap.appendChild(slider);
  panel.insertBefore(wrap, document.getElementById('startOver'));
  return slider;
}
