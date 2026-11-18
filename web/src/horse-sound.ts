/** Short filtered noise and resonators, with no downloaded recordings or motor sounds. */
export class HorseSound {
  /** A multiple of the hooves' own loudness, from the "Hoof sound" setting (1 at its default). */
  volume = 1;
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private playing = false;
  private snortTime = 17;
  private lastWhinny = -10;
  constructor() {
    const unlock = () => this.start();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
  }
  private start(): void {
    if (!this.playing) return;
    if (!this.audio) {
      this.audio = new AudioContext();
      this.master = this.audio.createGain(); this.master.gain.value = .55 * this.volume; this.master.connect(this.audio.destination);
      this.noise = this.audio.createBuffer(1, this.audio.sampleRate * .5, this.audio.sampleRate);
      const samples = this.noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (this.audio.state === 'suspended') void this.audio.resume();
  }
  private thud(soft: boolean): void {
    const a = this.audio, master = this.master, noise = this.noise;
    if (!a || !master || !noise || a.state !== 'running') return;
    const now = a.currentTime, gain = a.createGain(), filter = a.createBiquadFilter(), source = a.createBufferSource();
    source.buffer = noise; filter.type = 'lowpass'; filter.frequency.value = soft ? 470 : 2100;
    gain.gain.setValueAtTime(soft ? .075 : .18, now); gain.gain.exponentialRampToValueAtTime(.001, now + .065);
    source.connect(filter).connect(gain).connect(master); source.start(); source.stop(now + .08);
    const tone = a.createOscillator(), ring = a.createGain(); tone.type = 'triangle'; tone.frequency.setValueAtTime(soft ? 95 : 190, now);
    tone.frequency.exponentialRampToValueAtTime(65, now + .06); ring.gain.setValueAtTime(soft ? .04 : .12, now);
    ring.gain.exponentialRampToValueAtTime(.001, now + .085); tone.connect(ring).connect(master); tone.start(); tone.stop(now + .09);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    tone.onended = () => { tone.disconnect(); ring.disconnect(); };
  }
  private snort(): void {
    const a = this.audio, master = this.master;
    if (!a || !master || !this.noise) return;
    const source = a.createBufferSource(), filter = a.createBiquadFilter(), gain = a.createGain(), now = a.currentTime;
    source.buffer = this.noise; filter.type = 'bandpass'; filter.frequency.value = 420; filter.Q.value = .65;
    gain.gain.setValueAtTime(.001, now); gain.gain.linearRampToValueAtTime(.13, now + .07); gain.gain.exponentialRampToValueAtTime(.001, now + .4);
    source.connect(filter).connect(gain).connect(master); source.start(); source.stop(now + .43);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  whinny(): void {
    this.start(); const a = this.audio, master = this.master;
    if (!a || !master || a.currentTime - this.lastWhinny < 1.5) return;
    const now = a.currentTime; this.lastWhinny = now;
    master.gain.setValueAtTime(.55 * this.volume, now);
    const tone = a.createOscillator(), gain = a.createGain(), vibrato = a.createOscillator(), depth = a.createGain(), filter = a.createBiquadFilter();
    tone.type = 'sawtooth'; tone.frequency.setValueAtTime(480, now); tone.frequency.linearRampToValueAtTime(790, now + .2);
    tone.frequency.exponentialRampToValueAtTime(270, now + 1.25);
    vibrato.frequency.value = 13; depth.gain.value = 32; vibrato.connect(depth).connect(tone.frequency);
    filter.type = 'lowpass'; filter.frequency.value = 1900;
    gain.gain.setValueAtTime(.001, now); gain.gain.linearRampToValueAtTime(.10, now + .06); gain.gain.exponentialRampToValueAtTime(.001, now + 1.3);
    tone.connect(filter).connect(gain).connect(master); tone.start(); vibrato.start(); tone.stop(now + 1.35); vibrato.stop(now + 1.35);
    tone.onended = () => { tone.disconnect(); filter.disconnect(); gain.disconnect(); vibrato.disconnect(); depth.disconnect(); };
  }
  footfall(surface: string): void { this.thud(['grass', 'brush', 'dirt track'].includes(surface)); }
  update(dt: number, playing: boolean): void {
    if (this.audio && this.master) this.master.gain.setTargetAtTime(playing ? .55 * this.volume : 0, this.audio.currentTime, .025);
    this.playing = playing;
    if (!playing) {
      const a = this.audio;
      if (a?.state === 'running') void a.suspend().then(() => { if (this.playing && a.state === 'suspended') void a.resume(); });
      return;
    }
    if (this.audio?.state === 'suspended') void this.audio.resume();
    this.snortTime -= dt;
    if (this.snortTime <= 0) { this.snort(); this.snortTime = 17 + Math.random() * 14; }
  }
}
