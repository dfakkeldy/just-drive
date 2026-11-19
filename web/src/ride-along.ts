/**
 * The Boss's ride-along days in mail play: Get Fired's Boss car (boss-car.ts), parked at or crawling along a seeded part
 * of the day's run. It never chases; it watches. An avoidable complaint, speeding past it or passing the flashing school
 * bus in its sight is on file at once as seen; then it follows and flashes, and when the player stops a short card gives
 * the write-up and the shift clock jumps. The rules are ride-along-rules.ts. Mail play only, single player only: main.ts
 * builds none in Get Fired, Today's run or Just Drive, and it holds still (unseen, seeing nothing) in multiplayer.
 */
import * as THREE from 'three';
import { GARAGE } from './garage';
import { Vehicle } from './vehicle';
import { PointTupperDriver } from './point-tupper-driver';
import { buildMailCar } from './car-switch';
import { makeBossCar, mergeForLow, type BossCar } from './boss-car';
import { bossGlow, bossHorn } from './boss';
import { cruise, followSpeed, hillBetween, openRoadTop, roadTop, type Occluders, type Spot } from './boss-rules';
import { CRAWL_LENGTH, FLASH_LINE, POST_BACK, START_LINE, START_SHOW, Watch, clockJump, crawlPose, postPlan,
  rideAlongLive, rideAlongToday, seeable, seenLabel, seenReport, seenVerdict, speedLabel, watchSees, writeUpCard,
  type Verdict, type WatchInput } from './ride-along-rules';
import { SceneRoad, type Pose } from './road-scene-rules';
import { bodyGap } from './parked';
import { CLOCK_FACTOR, END_TIME, START_TIME } from './shift-rules';
import type { Complaint } from './complaints';
import type { Roads } from './roads';
import type { Terrain } from './terrain';
import type { AreaContacts } from './world-contacts';
import type { Shift, ShiftWatcher } from './shift';
import type { Props } from './props';
import { DAMAGE_COMPLAINT } from './yard-props-rules';

export { rideAlongEnabled } from './ride-along-rules';

/** How often it looks (seconds), as the Get Fired Boss. */
const LOOK = .2;
const HONK_EVERY = 3.2;
/** The write-up card stays this long (play seconds). */
const CARD_SECONDS = 7;
/** It goes back to its post only when the player is this far from it and nobody sees the spot. */
const AWAY = 100;
const NOTE_CSS = `#bossNote{position:fixed;z-index:6;left:50%;top:calc(22% + env(safe-area-inset-top,0px));transform:translateX(-50%);
 box-sizing:border-box;width:min(440px,calc(100% - 24px));padding:10px 14px;background:rgba(12,20,28,.94);color:#eef2f6;
 border:1px solid #69747c;border-top:3px solid #ffa526;border-radius:8px;font:14px/1.45 system-ui,sans-serif;pointer-events:none}
#bossNote[hidden]{display:none}#bossNote b{display:block;font-size:17px;letter-spacing:.02em}#bossNote p{margin:4px 0 0}
body.tcOn #bossNote{font-size:12px;top:calc(30% + env(safe-area-inset-top,0px))}body.tcOn #bossNote b{font-size:14px}
body.indoorOn #bossNote{display:none}`;

/** `edge`: its lane's right edge (side metres from the road's centre line); `side`: where it parks, which on a highway is
 * the shoulder, clear of the traffic lane (ambient-traffic.ts keeps CLEAR 2.4 m from a body round its LANE 1.65 m). */
interface Post { path: SceneRoad; along: number; length: number; edge: number; side: number; crawl: boolean; stop: number }
const SHOULDER = 4.3;
/** Its post and the end of its crawl stay this far from every mailbox: it never parks in front of a customer's box. */
const BOX_CLEAR = 8;
/** Pulling out from the shoulder into its lane before it follows: forward and sideways speeds, m/s. */
const PULL_AHEAD = 4, PULL_ACROSS = 1.5;

export class RideAlong implements ShiftWatcher {
  readonly driver: PointTupperDriver;
  readonly watch = new Watch();
  car!: BossCar;
  /** True on a ride-along day. */
  today = false;
  /** True once it has watched in this shift (live, on the road): the report speaks of it only then. */
  met = false;
  post: Post | null = null;
  /** The Boss's spot for the small map while it follows, else null. */
  mapSpot: Spot | null = null;
  honks = 0;
  /** Seconds into its crawl (it holds while the player is in its way). */
  crawl = 0;
  /** Pulling out from a highway shoulder: metres along from the post, and its side now. */
  private pullAlong = 0;
  private pullSide = 0;
  private readonly openTop: number;
  private readonly input: { -readonly [K in keyof WatchInput]: WatchInput[K] };
  private readonly pose: Pose = { x: 0, z: 0, heading: 0 };
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 4);
  private readonly glow = bossGlow();
  private readonly note = document.createElement('div');
  private noteTime = 0;
  private run = -1;
  private live = false;
  private held = false;
  private time = 0;
  private look = 0;
  private seen = false;
  private kind: number | null = null;
  private honk = 0;
  private audio: AudioContext | null = null;
  /** The start-card line (main.ts adds it to the title card). */
  private titleLine: HTMLElement | null = null;
  constructor(private readonly roads: Roads, private readonly terrain: Terrain, contacts: AreaContacts, sea: number, low: boolean,
    private readonly shift: Shift, private readonly occluders: Occluders | null, private readonly player: Vehicle,
    private readonly touch: boolean, private readonly params: URLSearchParams, private readonly props: Props | null = null) {
    this.openTop = openRoadTop(player.spec);
    this.input = { boss: player, player, seen: false, onRoad: false };
    const entry = GARAGE.find(e => e.id === 'car')!;
    this.driver = new PointTupperDriver(roads, terrain, contacts, 'car', sea, Math.random, () => {
      const rig = buildMailCar(true, false);
      this.car = makeBossCar(rig);
      if (low) mergeForLow(rig);
      rig.root.name = 'The Boss';
      return { rig, vehicle: new Vehicle(rig, terrain, roads, sea, entry.spec) };
    }, low, {
      kind: 'car',
      speed: (gap, ahead) => followSpeed(gap, ahead, this.limit()),
      stopGap: 3,
      goal: () => this.watch.state === 'following' ? this.input.player : null,
      keep: () => this.watch.state === 'following',
      roadMargin: 1.6,
      radius: 3.5,
    });
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: NOTE_CSS }));
    this.note.id = 'bossNote'; this.note.hidden = true; this.note.setAttribute('role', 'status');
    document.body.appendChild(this.note);
    // The school bus reports each unsafe pass to the score stream; in its sight, that is seen too.
    shift.score.listen(e => { if (e.kind === 'schoolBus' && e.x !== undefined && e.z !== undefined) this.sawAt('schoolBus', [{ x: e.x, z: e.z }], false); });
    shift.watcher = this;
    shift.roadside.push(this);
  }
  get group(): THREE.Group { return this.driver.group; }
  get vehicle(): Vehicle { return this.driver.vehicle; }
  /** Following: never more than 80 % of what the player's car can do on this road (boss-rules.ts cruise). */
  private limit(): number {
    const kind = this.roads.nearest(this.vehicle.x, this.vehicle.z, 12)?.road.kind ?? 1;
    const top = this.player.strongHelp && this.player.touchSpeedLimit && this.touch ? Math.min(this.openTop, roadTop(kind)) : this.openTop;
    return cruise('following', 2, top);
  }
  /** The start card: one line under the title card's words (shown on ride-along days only). */
  announce(card: HTMLElement | null): void {
    const words = card?.querySelector('p:not(.tag)');
    if (!words) return;
    this.sync();
    this.titleLine = Object.assign(document.createElement('span'), { id: 'titleBoss', textContent: START_LINE });
    this.titleLine.style.cssText = 'display:block;margin-top:6px';
    this.titleLine.hidden = !this.today || !this.post; words.append(this.titleLine);
  }
  /** A new shift (each Shift.start clears the score stream): a new day, a new post. */
  private sync(): void {
    if (this.shift.score.runs === this.run) return;
    this.run = this.shift.score.runs;
    this.today = rideAlongToday(this.shift.career.day, this.params);
    this.watch.reset(this.today); this.met = false;
    this.driver.hide(); this.post = this.today ? this.choosePost() : null; this.crawl = 0;
    this.mapSpot = null; this.seen = false; this.honk = this.noteTime = 0; this.note.hidden = true; this.glow.hidden = true;
    this.car?.flash(false, 0);
    if (this.titleLine) this.titleLine.hidden = !this.today || !this.post;
  }
  /** Clear of every mailbox (and on the day's route, not at a cemetery, church ground or bus stop). */
  private fits(x: number, z: number): boolean {
    return this.shift.placeAt(x, z) === 'route' && !this.props?.mail.some(m => Math.hypot(m.x - x, m.z - z) < BOX_CLEAR);
  }
  /** The seeded stop: the first in the day's order on a road the car fits, long enough to wait on, on ordinary ground.
   * On a highway it parks on the shoulder and never crawls (it would turn across the traffic). */
  private choosePost(): Post | null {
    const stops = this.shift.run.stops, plan = postPlan(this.shift.career.day, stops.map(s => s.index)), half = this.vehicle.spec.halfWidth;
    for (const index of plan.order) {
      const stop = stops.find(s => s.index === index)!, road = stop.hit.road;
      if (road.bridge || road.kind > 3 || road.halfWidth < half + 1.6) continue;
      const highway = road.kind === 1, crawl = plan.crawl && !highway;
      const path = new SceneRoad(plan.reverse ? [...road.pts].reverse() : road.pts, 0, 1), total = path.cumulative.at(-1)!;
      const along = path.alongAt(stop.hit.x, stop.hit.z) - POST_BACK;
      if (along < 20) continue;
      const length = Math.min(crawl ? CRAWL_LENGTH : 0, total - 20 - along);
      if (crawl && length < 60) continue;
      const edge = road.halfWidth - half - .1, side = highway ? Math.max(edge, SHOULDER) : edge;
      path.at(along, side, this.pose);
      if (!this.fits(this.pose.x, this.pose.z)) continue;
      // A crawl waits at both ends: out at the far end, and back at the post across the road.
      if (crawl) { path.at(along + length, edge, this.pose); if (!this.fits(this.pose.x, this.pose.z)) continue; }
      if (crawl) { path.at(along, -edge, this.pose); if (!this.fits(this.pose.x, this.pose.z)) continue; }
      return { path, along, length, edge, side, crawl, stop: index };
    }
    return null;
  }
  /** Where it sits now at its post (parked, or this far into the crawl). */
  private postPose(out: Pose): void {
    const p = this.post!;
    if (!p.crawl) { p.path.at(p.along, p.side, out); return; }
    const c = crawlPose(this.crawl, p.length, p.edge);
    p.path.at(p.along + c.along, c.side, out); out.heading += c.turn;
  }
  /** Still pulling out from a highway shoulder (its own step moves it, not the driver's). */
  private get pulling(): boolean { const p = this.post; return this.watch.state === 'following' && !!p && !p.crawl && this.pullSide > p.edge; }
  private inView(x: number, z: number, y: number): boolean { this.sphere.center.set(x, y + 1.5, z); return this.frustum.intersectsSphere(this.sphere); }
  /** Sight from the Boss's seat: distance, angle, then buildings and hills. */
  private blocked = (a: Spot, b: Spot): boolean => !!this.occluders?.blocks(a, b) || hillBetween(a, b, (x, z) => this.terrain.heightAt(x, z));
  private sees(p: Spot): boolean { return watchSees(this.vehicle, p, this.blocked); }
  /** A seen offence, if the Boss is watching and sees any of these points or (`car`) the player's car. Protected places
   * (a cemetery, a church ground, the bus stop) are never written up, except a school bus pass, which is about the bus. */
  private sawAt(kind: string, at: readonly Spot[], route = true, label = seenLabel(kind), car = true): boolean {
    this.sync();
    if (!this.live || this.held || !this.driver.active || !this.watch.watching) return false;
    const spots = car ? [...at, this.player] : [...at];
    if (route && spots.some(s => this.shift.placeAt(s.x, s.z) !== 'route')) return false;
    if (!spots.some(s => this.sees(s))) return false;
    return this.watch.saw({ kind, label, at: this.shift.elapsed });
  }
  // ShiftWatcher
  saw(c: Complaint, landing?: { x: number; z: number }): boolean {
    // Yard damage: the break itself, in its sight. A bale the player sent rolling can break a fence far from the car.
    return seeable(c.kind, c.preExisting) && this.sawAt(c.kind, landing ? [c, { x: landing.x, z: landing.z }] : [c], true, seenLabel(c.kind), c.kind !== DAMAGE_COMPLAINT);
  }
  verdict(base: Verdict): Verdict { return this.today ? seenVerdict(base, this.watch.seen) : base; }
  report(): string[] { return this.today && (this.met || this.watch.seen.length) ? seenReport(this.watch.seen, this.watch.gaveUp) : []; }
  // Shift.roadside: the HUD's hint line, and nothing in the roadside report.
  get hint(): string {
    if (!this.today || !this.live || !this.post) return '';
    if (this.watch.signal) return FLASH_LINE;
    return this.shift.elapsed / CLOCK_FACTOR < START_SHOW ? START_LINE : '';
  }
  reportLine(): string { return ''; }
  /** Every frame. `dt` is play time (0 while paused). `held`: the player is out of the car (a drone flight, indoors):
   * it stays where it is and sees nothing. */
  update(camera: THREE.Camera, dt: number, multiplayer: boolean, playing: boolean, held = false): void {
    this.sync();
    if (this.noteTime > 0) { this.noteTime -= dt; if (this.noteTime <= 0) this.note.hidden = true; }
    this.live = this.today && rideAlongLive(multiplayer) && playing && !this.shift.ended;
    this.held = this.live && held;
    const w = this.watch, v = this.vehicle, player = this.player;
    // Multiplayer, or no post on this run: no Boss on the road.
    if (this.titleLine) this.titleLine.hidden = !this.today || !this.post || multiplayer;
    if (!this.today || !this.post || multiplayer) { if (this.driver.active) this.driver.hide(); this.mapSpot = null; this.glow.hidden = true; return; }
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    // At its post: put there as the day starts, or back there once nobody sees the spot and the player is well away.
    if (!this.driver.active && (w.state === 'post' || w.state === 'away')) {
      this.postPose(this.pose);
      const ground = this.terrain.heightAt(this.pose.x, this.pose.z), far = Math.hypot(this.pose.x - player.x, this.pose.z - player.z) > AWAY;
      if (ground !== null && (w.state === 'post' || far && !this.inView(this.pose.x, this.pose.z, ground)) && v.place(this.pose.x, this.pose.z, this.pose.heading)) {
        this.driver.show(); w.back(); this.pullAlong = 0; this.pullSide = this.post.side; v.vx = v.vz = v.speed = 0;
      }
    }
    if (this.held) { this.car.flash(false, 0); this.glow.hidden = true; return; }
    // Following, or driving off: the driver's own frame (it leaves the road where nobody sees it).
    if (this.driver.active && (w.state === 'following' && !this.pulling || this.driver.leaving)) this.driver.update(camera, player, true, 'car');
    if (!this.live) { this.mapSpot = null; this.car.flash(false, 0); this.glow.hidden = true; return; }
    this.time += dt;
    if (this.driver.active) this.met = true;
    if ((this.look -= dt) <= 0) {
      this.look = LOOK;
      this.seen = this.driver.active && !this.driver.leaving && this.sees(player);
      const under = this.roads.nearest(player.x, player.z, 12, r => r.kind <= 3 || r.kind === 5);
      this.kind = under && under.dist <= under.road.halfWidth + .5 ? under.road.kind : null;
    }
    const i = this.input;
    i.boss = v; i.player = player; i.seen = this.seen; i.onRoad = this.driver.active && !this.driver.leaving;
    if (w.passing(i, this.kind) && this.kind !== null && this.shift.placeAt(player.x, player.z) === 'route')
      w.saw({ kind: 'speeding', label: speedLabel(player.speed, this.kind), at: this.shift.elapsed });
    const event = w.tick(dt, i);
    if (event === 'pulledOver') this.pullOver();
    else if (event === 'gaveUp') this.driver.leaving = true;
    if (w.signal) {
      this.honk -= dt;
      if (this.honk <= 0) { this.honk = HONK_EVERY; this.honks++; this.audio = bossHorn(this.audio, Math.hypot(v.x - player.x, v.z - player.z)); }
    } else this.honk = 0;
    this.glow.hidden = !this.car.flash(w.signal, this.time);
    this.mapSpot = this.driver.active && w.state === 'following' ? v : null;
  }
  /** The physics step (main.ts driveVehicle): the driver while it follows or leaves; the crawl at its post. */
  step(dt: number): void {
    if (!this.live || this.held || !this.driver.active) return;
    const p = this.post;
    if (this.pulling && p) {
      // From the shoulder into its lane first, at a crawl; then the driver has it.
      const along = this.pullAlong + PULL_AHEAD * dt, side = Math.max(p.edge, this.pullSide - PULL_ACROSS * dt);
      if (!this.ease(p.path, p.along + along, side, side > p.edge ? -Math.atan2(PULL_ACROSS, PULL_AHEAD) : 0, dt)) return;
      this.pullAlong = along; this.pullSide = side;
      if (side <= p.edge) this.driver.show();
      return;
    }
    if (this.watch.state === 'following' || this.driver.leaving) { this.driver.step(dt, this.player); return; }
    if (this.watch.state !== 'post' || !p?.crawl) return;
    const t = this.crawl + dt, c = crawlPose(t, p.length, p.edge);
    if (this.ease(p.path, p.along + c.along, c.side, c.turn, dt)) this.crawl = t;
  }
  /** Move the car to a pose on its road, unless the player or another body (the trailer, the school bus, a parked car)
   * is in the way: it never drives into anything. */
  private ease(path: SceneRoad, along: number, side: number, turn: number, dt: number): boolean {
    const v = this.vehicle;
    path.at(along, side, this.pose); this.pose.heading += turn;
    const next = { x: this.pose.x, z: this.pose.z, y: v.y, heading: this.pose.heading, spec: v.spec };
    if (bodyGap(next, this.player) < 1.5 || this.driver.obstacles().some(b => bodyGap(next, b) < 1.5)) return false;
    const x = v.x, z = v.z;
    if (!v.place(this.pose.x, this.pose.z, this.pose.heading)) return false;
    // Others (the traffic, the player's contacts) read its motion.
    v.vx = (v.x - x) / Math.max(dt, 1e-3); v.vz = (v.z - z) / Math.max(dt, 1e-3); v.speed = Math.hypot(v.vx, v.vz);
    return true;
  }
  private pullOver(): void {
    const before = this.shift.elapsed;
    this.shift.elapsed += clockJump(before, END_TIME - START_TIME);
    const card = writeUpCard(this.watch.pulledOver, this.watch.release(), this.shift.elapsed - before);
    this.note.replaceChildren(Object.assign(document.createElement('b'), { textContent: card.title }),
      ...card.lines.map(line => Object.assign(document.createElement('p'), { textContent: line })));
    this.note.hidden = false; this.noteTime = CARD_SECONDS;
    this.driver.leaving = true;
    this.car.flash(false, 0); this.glow.hidden = true;
  }
}
