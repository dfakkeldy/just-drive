/**
 * The Boss in Get Fired: one car on the roads (the Point Tupper AI driver, with a goal), its pursuit, its signals
 * (the amber roof box and the horn), the pull-over card, and the witness rule for the score stream. The rules are
 * boss-rules.ts. Get Fired only, one Boss, single player only: main.ts builds none in mail play or Just Drive.
 */
import * as THREE from 'three';
import { GARAGE } from './garage';
import { Vehicle } from './vehicle';
import { PointTupperDriver } from './point-tupper-driver';
import { buildMailCar } from './car-switch';
import { makeBossCar, mergeForLow, type BossCar } from './boss-car';
import { Pursuit, bossLine, bossLive, bossSummary, clockCost, cruise, followSpeed, hillBetween, openRoadTop, pullOverCard, roadTop, sees,
  spawnRange, type Occluders, type PursuitInput, type Spot } from './boss-rules';
import { scores } from './score-rules';
import type { ScoreEvent } from './score-events';
import { END_TIME, START_TIME } from './shift-rules';
import type { Roads } from './roads';
import type { Terrain } from './terrain';
import type { AreaContacts } from './world-contacts';
import type { Shift } from './shift';
import type { FiredRun } from './fired';

export { bossEnabled } from './boss-rules';

/** How often it looks for the player (seconds). Sight is a few rays of terrain and a box grid: cheap, but not per frame. */
const LOOK = .2;
/** Seconds between honks while it flashes. */
const HONK_EVERY = 3.2;
/** The pull-over card stays this long (play seconds). */
const CARD_SECONDS = 7;
/** The chase camera sits where a car close behind would be: its flash reaches the player as amber light on the edges of
 * the screen, in time with the roof box. */
const GLOW_CSS = `#bossGlow{position:fixed;inset:0;z-index:2;pointer-events:none;box-shadow:inset 0 -46px 60px -30px #ffa526d0,inset 0 0 80px -40px #ffa52690}
#bossGlow[hidden]{display:none}body.indoorOn #bossGlow{display:none}`;

/** The amber screen-edge glow, made once per page (Get Fired's Boss or the ride-along Boss: never both). */
export function bossGlow(): HTMLDivElement {
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: GLOW_CSS }));
  const glow = document.createElement('div');
  glow.id = 'bossGlow'; glow.hidden = true; document.body.appendChild(glow);
  return glow;
}
/** Two short low notes, quieter far away. A tap or key started the game, so audio may play. Returns the context to reuse. */
export function bossHorn(audio: AudioContext | null, distance: number): AudioContext | null {
  let a = audio;
  try {
    a ??= new AudioContext();
    const gain = a.createGain(), level = .07 * Math.max(.2, 1 - distance / 80), now = a.currentTime;
    gain.connect(a.destination);
    for (const [start, length] of [[0, .22], [.32, .38]]) {
      for (const hz of [349, 440]) {
        const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz;
        const g = a.createGain(); g.gain.setValueAtTime(0, now + start);
        g.gain.linearRampToValueAtTime(level, now + start + .02); g.gain.setValueAtTime(level, now + start + length - .04);
        g.gain.linearRampToValueAtTime(0, now + start + length);
        o.connect(g); g.connect(gain); o.start(now + start); o.stop(now + start + length + .02);
      }
    }
    void a.resume().catch(() => {});
    return a;
  } catch { return a; /* no audio: the flash still says it (and a context made here is kept, not made again) */ }
}

export class Boss {
  readonly driver: PointTupperDriver;
  readonly pursuit = new Pursuit();
  car!: BossCar;
  /** True once it has been on the road in this run (the end card says so). */
  met = false;
  /** The Boss's spot for the small map while it has seen you, else null. */
  mapSpot: Spot | null = null;
  private readonly openTop: number;
  private time = 0;
  private look = 0;
  private seen = false;
  private honk = 0;
  private run = -1;
  private live = false;
  private held = false;
  /** One input object, refilled each frame. */
  private readonly input: { -readonly [K in keyof PursuitInput]: PursuitInput[K] };
  private audio: AudioContext | null = null;
  /** Honks so far (checks count them; the sound itself cannot be heard by a check). */
  honks = 0;
  private readonly glow = bossGlow();
  /** The road kind under the Boss, looked up with its sight (its speed limit on a phone). */
  private kind = 1;
  constructor(private readonly roads: Roads, private readonly terrain: Terrain, contacts: AreaContacts, sea: number, low: boolean,
    private readonly shift: Shift, private readonly fired: FiredRun, private readonly occluders: Occluders | null,
    private readonly player: Vehicle, private readonly touch: boolean) {
    this.openTop = openRoadTop(player.spec);
    this.input = { boss: player, player, seen: false, onRoad: false };
    const entry = GARAGE.find(e => e.id === 'car')!;
    this.driver = new PointTupperDriver(roads, terrain, contacts, 'car', sea, Math.random, () => {
      const rig = buildMailCar(true, false);
      this.car = makeBossCar(rig);
      // A phone draws it in a handful of calls (the Mabou phone start has no room for the full car's two dozen).
      if (low) mergeForLow(rig);
      rig.root.name = 'The Boss';
      return { rig, vehicle: new Vehicle(rig, terrain, roads, sea, entry.spec) };
    }, low, {
      kind: 'car',
      speed: (gap, ahead) => followSpeed(gap, ahead, this.limit()),
      stopGap: 3,
      goal: () => this.pursuit.goal(),
      keep: () => this.pursuit.state === 'following',
      spawnRange: () => spawnRange(this.rung),
      // Mabou's gravel roads (2.6 m half width) are the route's roads too; it tries a few hidden starts a frame.
      roadMargin: 1.6,
      tries: 6,
      // A car, not a log truck: close behind the chase camera after a pull-over it is out of sight, so it can go.
      radius: 3.5,
    });
    this.run = shift.score.runs;
    // The newest scoring offence is its lead; witnessed or not.
    shift.score.listen(e => this.hear(e));
    shift.witness = (x, z) => this.witnesses(x, z);
    fired.boss = this;
  }
  get rung(): number { return this.fired.book.step; }
  get group(): THREE.Group { return this.driver.group; }
  get vehicle(): Vehicle { return this.driver.vehicle; }
  /** Its cruise now: never more than TOP_SHARE of what the player's car can do on this road. */
  private limit(): number {
    const top = this.player.strongHelp && this.player.touchSpeedLimit && this.touch ? Math.min(this.openTop, roadTop(this.kind)) : this.openTop;
    return cruise(this.pursuit.state, this.rung, top);
  }
  private sync(): void { if (this.shift.score.runs !== this.run) { this.run = this.shift.score.runs; this.reset(); } }
  reset(): void { this.pursuit.reset(); this.driver.hide(); this.met = false; this.mapSpot = null; this.seen = false; this.honk = 0; this.car?.flash(false, 0); this.glow.hidden = true; }
  private hear(e: ScoreEvent): void {
    this.sync();
    if (e.x === undefined || e.z === undefined || e.kind === 'lostBoss' || !scores(e)) return;
    this.pursuit.complaint({ x: e.x, z: e.z });
  }
  /** Sight from the Boss's driver seat: distance, angle, then buildings and hills. */
  private blocked = (a: Spot, b: Spot): boolean =>
    !!this.occluders?.blocks(a, b) || hillBetween(a, b, (x, z) => this.terrain.heightAt(x, z));
  witnesses(x: number, z: number): boolean {
    // Its own "Lost the Boss" bonus is reported just after it lost the player: never witnessed.
    if (!this.live || this.held || !this.driver.active || this.pursuit.state === 'pulledOver' || this.pursuit.state === 'lost') return false;
    return sees(this.driver.vehicle, { x, z }, this.rung, this.blocked);
  }
  /** Every frame. `dt` is play time (0 while paused). `held`: the player is out of the car (a drone flight, indoors):
   * the Boss stays just where it is, sees nothing and its clocks stop, so it can neither vanish nor pull over an
   * empty car. */
  update(camera: THREE.Camera, dt: number, multiplayer: boolean, playing: boolean, held = false): void {
    this.sync();
    this.live = bossLive(multiplayer, this.rung) && playing && !this.shift.ended;
    this.held = this.live && held;
    const p = this.pursuit;
    if (this.held) { this.car.flash(false, 0); this.glow.hidden = true; return; }
    // After a pull-over it drives off; it does not come back on the road until its cooldown has run.
    this.driver.update(camera, this.player, this.live && (this.driver.active || p.cooldown <= 0), 'car');
    if (!this.live) { this.mapSpot = null; this.car?.flash(false, 0); this.glow.hidden = true; return; }
    if (this.driver.active) this.met = true;
    this.time += dt;
    const v = this.driver.vehicle, player = this.player;
    if ((this.look -= dt) <= 0) {
      this.look = LOOK;
      this.seen = this.driver.active && sees(v, player, this.rung, this.blocked);
      this.kind = this.driver.active ? this.roads.nearest(v.x, v.z, 12)?.road.kind ?? 1 : 1;
    }
    const look = this.input;
    look.boss = v; look.player = player; look.seen = this.seen; look.onRoad = this.driver.active;
    const event = p.tick(dt, this.rung, look);
    if (event === 'signal') { this.honk = 0; }
    else if (event === 'pulledOver') this.pullOver();
    else if (event === 'lost') this.shift.reportScore('lostBoss', player.x, player.z, Math.hypot(player.vx, player.vz));
    if (p.signal) {
      this.honk -= dt;
      if (this.honk <= 0) { this.honk = HONK_EVERY; this.horn(Math.hypot(v.x - player.x, v.z - player.z)); }
    }
    this.glow.hidden = !this.car.flash(p.signal, this.time);
    this.mapSpot = this.driver.active && p.state === 'following' ? v : null;
  }
  /** The physics step, with the world (main.ts driveVehicle). */
  step(dt: number): void { if (this.live && !this.held) this.driver.step(dt, this.player); }
  private pullOver(): void {
    const step = Math.max(1, this.rung), before = this.shift.elapsed;
    // The clock jumps (never past 18:00: the shift then ends as at any 18:00); the combo ends; points and step stay.
    this.shift.elapsed = Math.min(END_TIME - START_TIME, before + clockCost(step));
    const card = pullOverCard(this.pursuit.pulledOver, step, this.shift.elapsed - before);
    this.fired.book.breakCombo();
    this.fired.card(card.title, card.lines, CARD_SECONDS);
    this.pursuit.release();
    this.driver.leaving = true;
    this.car.flash(false, 0);
  }
  /** The HUD line under the score. */
  line(): string { return this.live ? bossLine(this.pursuit) : ''; }
  summary(): string { return bossSummary(this.pursuit.pulledOver, this.pursuit.escaped, this.met); }
  private horn(distance: number): void { this.honks++; this.audio = bossHorn(this.audio, distance); }
}
