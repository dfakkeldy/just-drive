import * as THREE from 'three';
import { Damage } from './damage-rules';
import type { Building } from './buildings';
import { Complaints, complaintLine, dismissed, type Complaint, type ComplaintKind } from './complaints';
import { Evidence, type Subject } from './evidence';
import type { Mail } from './mail';
import type { Props } from './props';
import type { Roads } from './roads';
import { Route, type Run } from './route';
import { Ruts } from './ruts';
import { BALE_STRIKE, DAMAGE_COMPLAINT } from './yard-props-rules';
import { ScoreStream } from './score-events';
import { CLOCK_FACTOR, DAILY_PAY, VEHICLE_ALLOWANCE, END_TIME, START_TIME, clock, dayType, draw, freshCareer, makeDay, migrateCareer, missedCustomers, nextCareer, readCareer, saveCareer, verdict, type Career, type DayDraw } from './shift-rules';
import type { Terrain } from './terrain';
import type { InteriorReceipt } from './interiors';
import type { Vehicle } from './vehicle';
import type { DriftFacts } from './drift-rules';

/** Mail play on a ride-along day (ride-along.ts): the Boss sees complaints as they come, and adds to the verdict and the
 * daily report. */
export interface ShiftWatcher {
  /** A new complaint (and where thrown mail landed): true when the Boss saw it, which puts it on file as seen. */
  saw(c: Complaint, landing?: { x: number; z: number }): boolean;
  verdict(base: ReturnType<typeof verdict>): ReturnType<typeof verdict>;
  /** The report's lines about the Boss; none on other days. */
  report(): string[];
  /** Offences seen directly by the Boss today (includes speeding and school-bus passes with no customer call). */
  seenItems?(): readonly { kind: string; label: string }[];
}

export class Shift {
  endsAtSix = true;
  readonly damage = new Damage();
  private readonly roadsideReport = document.createElement('p');
  private readonly bossReport = document.createElement('p');
  readonly roadside: { reportLine(): string; readonly hint: string; readonly score?: number; setPaused?(paused: boolean): void }[] = [];
  get roadsideScore(): number { return this.roadside.reduce((score, scene) => score + (scene.score ?? 0), 0); }
  /** True when the HUD line shows this roadside scene's hint now: no damage hint, and no earlier scene with a hint first.
   *  The same order as refreshUI. A loop, not find(): scenes call this every physics step. */
  showsHint(scene: object): boolean {
    if (this.damage.hintTime > 0) return false;
    for (let i = 0; i < this.roadside.length; i++) if (this.roadside[i].hint) return this.roadside[i] === scene;
    return false;
  }
  readonly evidence = new Evidence();
  /** Plain facts for Get Fired. In mail play it records and nobody listens: it shows and changes nothing. */
  readonly score = new ScoreStream();
  /** Names the place of a point: 'route', or a protected place where nothing scores. main.ts sets it. */
  placeAt: (x: number, z: number) => string = () => 'route';
  /** Get Fired: true when the Boss sees this point (boss.ts sets it). */
  witness: (x: number, z: number) => boolean = () => false;
  /** Mail play: the Boss on a ride-along day (ride-along.ts sets it). */
  watcher: ShiftWatcher | null = null;
  /** Get Fired: called once when the run ends, instead of the daily report. */
  onFiredEnd: (() => void) | null = null;
  /** Mail play: called after the daily report opens, with the verdict, Boss-seen count, upheld complaints and direct Boss sightings. */
  onReport: ((info: { outcome: 'clear' | 'warning' | 'suspension'; bossSeen: number; complaints: readonly Complaint[]; seenNotes: readonly { kind: string; label: string }[]; day: number }) => void) | null = null;
  /** Mail play: optional interceptor for clicking #nextDay (return true to take over advancing via advanceToNextDay()). */
  onNextDay: (() => boolean) | null = null;
  /** Breakable yard and field props (yard-props.ts): everything stands again, with the day's bins and laundry. */
  yard: { reset(day: number): void } | null = null;
  /** Get Fired: each shift step while the day runs, before the 18:00 check (world seconds; 0 while paused). */
  onUpdate: ((dt: number) => void) | null = null;
  private rutMark = 0; private speed = 0;
  /** Play seconds of the last frightened animal; a protected place a drift passed through ('' when none). */
  private animalAt = -Infinity; private driftPlace = '';
  /** Where thrown mail landed, while its complaint is filed: a protected place there scores nothing either. */
  private readonly landing = { x: 0, z: 0, set: false };
  readonly group = new THREE.Group();
  readonly ruts: Ruts;
  career: Career;
  today!: DayDraw;
  remaining: number[] = [];
  complaints = new Complaints();
  elapsed = 0;
  indoorParcels = 0;
  indoorBonus = 0;
  private indoorHint = '';
  private indoorHintTime = 0;
  private readonly indoorVisits = new Set<string>();
  done = 0; stops = 0;
  ended = false;
  lastDelivery: number | null = null;
  private next!: Career;
  readonly route: Route;
  run!: Run;
  private readonly forcedRun: number;
  private readonly passed = new Set<number>();
  private readonly boxSubjects: Subject[] = [];
  private readonly stuffedIndices: number[] = [];
  private cleanIndex = -1; private cleanTime = 0;
  private uiTimer = 0; private paperTimer = 0; private flashTimer = 0; private photoCooldown = 0;
  private readonly paper: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly hud = document.getElementById('shiftHud')!;
  private readonly progress = document.getElementById('stopHint')!;
  private readonly report = document.getElementById('shiftReport')!;
  private readonly endButton = document.getElementById('endShift') as HTMLButtonElement;
  /** Set when the phone controls are on screen: hints then name buttons, not keys. */
  phone = false;
  private get idleHint(): string { return this.phone ? 'CAMERA: photo · gear: end shift' : 'C: camera · Esc/P: pause · Enter: end shift'; }
  private readonly cameraButton = document.getElementById('cameraButton') as HTMLButtonElement;
  private readonly tag = document.getElementById('photoTag')!;
  private readonly flash = document.getElementById('photoFlash')!;

  constructor(private readonly props: Props | null, private readonly mail: Mail, private readonly roads: Roads,
    private readonly terrain: Terrain, buildings: Building[], village: [number, number], private readonly low: boolean,
    params: URLSearchParams, private readonly restart: () => void, private readonly routeEnabled = true, readonly fired = false, fixedDay = 0, customRun?: Run) {
    this.roadsideReport.hidden = this.bossReport.hidden = true;
    this.bossReport.id = 'reportBoss';
    document.getElementById('reportMissed')!.after(this.roadsideReport, this.bossReport);
    this.career = this.routeEnabled ? migrateCareer(readCareer(), props?.mail.length ?? 0, props?.sites.length ?? 0) : freshCareer();   // an area with no route never touches the saved Mabou career
    const requested = Number(params.get('day'));
    if (Number.isSafeInteger(requested) && requested > 0) {
      this.career = { ...freshCareer(), day: requested };
    }
    // Today's run fixes the day for every player (daily-rules.ts). Get Fired never writes the career, so nothing is saved.
    if (fired && Number.isSafeInteger(fixedDay) && fixedDay > 0) this.career = { ...freshCareer(), day: fixedDay };
    if (params.get('double') === '1') this.career.double = true;
    this.route = new Route(roads, props, routeEnabled, customRun);
    const forced = Number(params.get('run'));
    this.forcedRun = Number.isSafeInteger(forced) && forced >= 1 && forced <= this.route.runs.length ? forced : 0;
    this.ruts = new Ruts(terrain, buildings, village, low, (id, x, z, at) => {
      const road = roads.nearest(x, z, 80, (r) => r.kind <= 3);
      this.add('lawnDamage', id, x, z, at, road?.road.id ?? -1);
    });
    this.paper = new THREE.InstancedMesh(new THREE.BoxGeometry(.28, .018, .4),
      new THREE.MeshLambertMaterial({ color: 0xd4c68f }), 30);
    this.paper.frustumCulled = false; this.paper.name = 'Two months of old flyers';
    this.group.add(this.ruts.mesh, this.paper);
    if (props) {
      // Frame members are distinct customers. Props reports each affected stable index.
      props.onKnock = (index) => {
        const p = props.mail[index]; this.add('boxDown', index, p.x, p.z, this.elapsed);
      };
      // Props reports each grade once per box per day, and a rock on each fresh touch.
      props.onBump = (index, grade, speed) => {
        const p = props.mail[index]; this.reportScore(['box:rock', 'box:lean', 'box:dent', 'box:down'][grade], p.x, p.z, speed);
      };
    }
    mail.service = {
      condition: (index) => !this.remaining[index] ? 'none' : this.today.stuffed[index] ? 'stuffed' : this.today.down[index] ? 'preExisting' : 'ready',
      deliver: (index) => this.deliver(index),
      ground: (x, z, lawn) => {
        // The nearest customer within 100 m, at a rural box or at a community cabinet.
        let p = props?.nearestMailbox(x, z, 100) ?? null;
        let best = p ? Math.hypot(p.x - x, p.z - z) : 100;
        for (let i = 0; props && i < props.sites.length; i++) {
          const s = props.sites[i], d = Math.hypot(s.x - x, s.z - z);
          if (d <= best) { best = d; p = { x: s.x, z: s.z, index: props.mail.length + i }; }
        }
        if (p) {
          this.landing.x = x; this.landing.z = z; this.landing.set = true;
          this.add(lawn ? 'lawnMail' : 'ditchMail', p.index, p.x, p.z, this.elapsed); this.landing.set = false;
        }
      },
    };
    this.endButton.addEventListener('click', () => this.end());
    document.getElementById('nextDay')!.addEventListener('click', () => {
      if (this.onNextDay?.()) return;
      this.advanceToNextDay();
    });
    document.getElementById('startOver')!.addEventListener('click', () => {
      this.startOver();
    });
    this.start();
    this.damage.seed(params.get('damage') ?? '');
  }

  /** Advance from the end-of-shift report into the next day. */
  advanceToNextDay(): void {
    this.career = this.next; this.start(); this.restart();
  }

  /** The settings button and every ending use the same complete career reset. */
  startOver(): void {
    // Get Fired keeps the day's route and never writes the career.
    if (!this.fired) { this.career = this.routeEnabled ? migrateCareer(freshCareer(), this.props?.mail.length ?? 0, this.props?.sites.length ?? 0) : freshCareer(); if (this.routeEnabled) saveCareer(this.career); }
    this.start(); this.restart();
    document.getElementById('settings')!.classList.remove('open');
  }

  private start(): void {
    this.elapsed = this.done = this.indoorParcels = this.indoorBonus = 0; this.indoorHint = ''; this.indoorHintTime = 0; this.indoorVisits.clear(); this.ended = false; this.lastDelivery = null;
    this.cleanIndex = -1; this.cleanTime = this.uiTimer = this.paperTimer = this.flashTimer = this.photoCooldown = 0;
    this.damage.reset();
    // A box that was down before the shift is not the player's offence.
    this.complaints = new Complaints(c => {
      if (c.kind === 'sceneAnimal') this.animalAt = c.at / CLOCK_FACTOR;
      if (c.preExisting) return;
      const landing = this.landing.set ? this.landing : undefined;
      if (this.watcher?.saw(c, landing)) c.seen = true;
      this.reportScore(c.kind, c.x, c.z, this.speed, landing);
    }); this.evidence.photos.length = 0;
    this.score.clear(); this.rutMark = this.speed = 0;
    this.animalAt = -Infinity; this.driftPlace = '';
    this.tag.hidden = true; this.flash.classList.remove('exposed'); this.report.hidden = true;
    this.ruts.reset(); this.mail.reset(); this.props?.resetShift(); this.yard?.reset(this.career.day);
    this.run = this.route.forDay(this.career.day, this.forcedRun);
    this.passed.clear();
    this.today = makeDay(this.career.day, (this.props?.mail.length ?? 0) + (this.props?.sites.length ?? 0),
      { ...this.run, allRural: this.route.rural, downCandidates: this.route.downCandidates }, this.career.double, this.career.carryover);
    this.boxSubjects.length = this.stuffedIndices.length = 0;
    this.remaining = this.today.pieces.slice(); this.stops = this.remaining.filter((n) => n > 0).length;
    // Remove only our subjects; animal and extension registrations survive the next shift.
    for (const [id, s] of this.evidence.subjects) if (s.kind === 'stuffed' || s.kind === 'preExisting') this.evidence.unregister(id);
    if (this.props) {
      for (let i = 0; i < this.props.mail.length; i++) if (this.today.down[i]) this.props.knockMailbox(i, 0, 0, true);
      // Daily pre-existing falls use single posts; player impacts still take shared frames down.
      for (let i = 0; i < this.props.mail.length; i++) {
        const p = this.props.mail[i]; this.today.down[i] = p.motion.down;
        if (p.motion.down) p.motion.angle = Math.PI * .49;
        if (this.today.stuffed[i]) this.stuffedIndices.push(i);
        for (const kind of ['stuffed', 'preExisting'] as const) if (kind === 'stuffed' ? this.today.stuffed[i] : p.motion.down) {
          this.boxSubjects.push(this.evidence.register({ id: `${kind}:${i}`, kind, target: i, x: p.x, z: p.z, radius: .6,
            label: kind === 'stuffed' ? 'Stuffed mailbox · old flyers' : 'Mailbox · pre-existing damage', active: true }));
        }
      }
    }
    this.refreshUI();
  }

  private customer(target: number, x: number, z: number): string {
    const road = this.roads.nearest(x, z, 120)?.road.name;
    const descriptions = ['the customer with the leaning mailbox', 'the customer in the yellow house',
      'the customer behind the hedge', 'the customer with the very short driveway'];
    return draw(1, target, 15) < .4 && road ? `a customer on ${road} who would like it noted` : descriptions[Math.floor(draw(1, target, 16) * descriptions.length)];
  }
  private add(kind: ComplaintKind, target: number, x: number, z: number, at: number, road = -1, preExisting = false): void {
    if (this.ended) return;
    this.complaints.add({ kind, target, x, z, at, road, preExisting, customer: this.customer(target, x, z),
      line: complaintLine(kind, this.career.day, target) });
  }
  private deliver(index: number): boolean {
    if (this.ended || !this.remaining[index]) return false;
    if (this.remaining[index] > 0) {
      this.remaining[index]--; this.lastDelivery = this.elapsed;
      if (this.remaining[index] === 0) this.done++;
      if (this.today.flags[index] && this.props) {
        const p = this.props.mail[index]; p.flagUp = this.career.day % 2 === 1; p.motion.dirty = true;
        this.add('flag', index, p.x, p.z, this.elapsed);
      }
    }
    return this.remaining[index] === 0;
  }
  /** Get Fired: the same day again, on the same route. */
  retry(): void { this.start(); this.restart(); }
  /** One plain fact for the score stream. Each source reports a fact once; a new touch can rock a box again. */
  reportScore(kind: string, x: number, z: number, speed: number, also?: { x: number; z: number }): void {
    if (this.ended) return;
    const place = this.placeAt(x, z);
    this.score.report({ kind, place: place === 'route' && also ? this.placeAt(also.x, also.z) : place, speed: Math.abs(speed), time: this.elapsed / CLOCK_FACTOR,
      x, z, witnessed: this.witness(x, z) });
  }
  /** A yard or field prop broke: one score fact, a strike beside it when a rolling bale did it (a combo), and one call
   *  per property per day. `kind` is the prop's score kind (yard-props-rules.ts scoreKind); `speed` is the hit speed
   *  (the car's, or the rolling bale's for a strike). */
  propBroken(kind: string, owner: number, x: number, z: number, speed: number, byBale = false): void {
    if (this.ended) return;
    this.reportScore(kind, x, z, speed);
    if (byBale) this.reportScore(BALE_STRIKE, x, z, speed);
    if (owner >= 0) this.add(DAMAGE_COMPLAINT, owner, x, z, this.elapsed);
  }
  /** A finished drift (drift-rules.ts) as one fact. Its place is the first protected place it touched (start, end or any
   * frame between); an animal that had to get out of the way while it lasted makes it an animal's event, which never scores. */
  reportDrift(d: DriftFacts): void {
    if (this.ended) return;
    const time = this.elapsed / CLOCK_FACTOR, end = this.placeAt(d.x1, d.z1), start = this.placeAt(d.x0, d.z0);
    const place = this.driftPlace || (start !== 'route' ? start : end);
    this.driftPlace = '';
    // Where it ended: the Boss heads there, and doubles it when it saw the slide end.
    this.score.report({ kind: 'drift', place, speed: d.speed, time, drift: d, ...(this.animalAt >= time - d.seconds - 1 ? { subject: 'animal' } : {}),
      x: d.x1, z: d.z1, witnessed: this.witness(d.x1, d.z1) });
  }
  /** A roadside break in view of a house: one call per house per day, and no photo answers it. */
  seenAtRoadside(house: number, x: number, z: number): void { this.add('relief', house, x, z, this.elapsed); }
  /** The one result hook used by every interior. Duplicate receipts cannot count twice. */
  interiorResult({ door, result }: InteriorReceipt): void {
    if (this.ended || this.indoorVisits.has(door.id)) return;
    this.indoorVisits.add(door.id);
    if (result.delivered) {
      this.indoorParcels++; this.lastDelivery = this.elapsed;
      const bonus = result.bonus !== undefined && Number.isFinite(result.bonus) && result.bonus > 0 ? Math.round(result.bonus) : 0;
      this.indoorBonus += bonus;
      this.indoorHint = bonus > 0 ? `${door.name}: parcel delivered · +$${bonus} bonus` : `${door.name}: parcel delivered`;
      this.indoorHintTime = 6;
    } else {
      let target = 0;
      for (const char of door.id) target = (Math.imul(target, 31) + char.charCodeAt(0)) >>> 0;
      this.complaints.add({ kind: 'indoors', target, at: this.elapsed, x: door.position.x, z: door.position.z,
        road: -1, customer: `the indoor mail desk at ${door.name}`, line: complaintLine('indoors', this.career.day, target) + ` ${result.note}` });
      this.indoorHint = `${door.name}: ${result.note}`;
      this.indoorHintTime = 6;
    }
    this.refreshUI();
  }
  /** Clock only. The caller closes the interior before opening the 18:00 report. */
  updateIndoors(dt: number): boolean {
    if (!this.ended) this.elapsed = Math.min(END_TIME - START_TIME, this.elapsed + dt * CLOCK_FACTOR);
    return this.elapsed >= END_TIME - START_TIME;
  }
  takePhoto(vehicle: Vehicle, camera: THREE.Camera): boolean {
    if (this.ended || this.photoCooldown > 0) return false;
    this.photoCooldown = .6;
    const photo = this.evidence.take(this.elapsed, vehicle.x, vehicle.z, vehicle.heading, camera);
    this.tag.hidden = false;
    document.getElementById('photoCaption')!.textContent = `PHOTO ${this.evidence.photos.length} · ${photo.caption}`;
    // A tiny retained image; no second render or full-resolution GPU readback.
    const thumbnail = document.getElementById('photoThumb') as HTMLCanvasElement;
    const source = document.getElementById('c') as HTMLCanvasElement;
    const width = Math.min(source.width, source.height * thumbnail.width / thumbnail.height);
    const height = width * thumbnail.height / thumbnail.width;
    thumbnail.getContext('2d')?.drawImage(source, (source.width - width) / 2, (source.height - height) / 2,
      width, height, 0, 0, thumbnail.width, thumbnail.height);
    this.flash.classList.remove('exposed'); void this.flash.offsetWidth; this.flash.classList.add('exposed'); this.flashTimer = .5;
    return photo.facts.length > 0;
  }
  update(dt: number, vehicle: Vehicle): void {
    if (this.ended) return;
    this.elapsed = Math.min(END_TIME - START_TIME, this.elapsed + dt * CLOCK_FACTOR);
    this.damage.updateHint(dt);
    if (this.indoorHintTime > 0) this.indoorHintTime = Math.max(0, this.indoorHintTime - dt);
    this.photoCooldown = Math.max(0, this.photoCooldown - dt);
    this.flashTimer -= dt; if (this.flashTimer <= 0) this.flash.classList.remove('exposed');
    this.ruts.update(vehicle, this.elapsed);
    this.speed = Math.hypot(vehicle.vx, vehicle.vz);
    // About three metres of fresh ruts make one fact; ruts.reset() sets its count back to 0.
    if (this.ruts.count - this.rutMark >= 8) { this.rutMark = this.ruts.count; this.reportScore('rut', vehicle.x, vehicle.z, this.speed); }
    // A drift: sample the ground under it while it lasts, so a slide through a protected place scores nothing.
    if (vehicle.drift?.active && !this.driftPlace) { const here = this.placeAt(vehicle.x, vehicle.z); if (here !== 'route') this.driftPlace = here; }
    const drift = vehicle.takeDrift?.();
    if (drift) this.reportDrift(drift);
    if (!vehicle.drift?.active) this.driftPlace = '';
    for (const s of this.boxSubjects) if ((s.x - vehicle.x) ** 2 + (s.z - vehicle.z) ** 2 <= 60 ** 2) this.passed.add(s.target!);
    let nearby = -1, distance = 2.5 * 2.5;
    if (this.props && Math.hypot(vehicle.vx, vehicle.vz) < .15) for (const i of this.stuffedIndices) {
      if (!this.today.stuffed[i]) continue;
      const p = this.props.mail[i], d = (p.x - vehicle.x) ** 2 + (p.z - vehicle.z) ** 2;
      if (d <= distance) { nearby = i; distance = d; }
    }
    if (nearby !== this.cleanIndex) { this.cleanIndex = nearby; this.cleanTime = 0; }
    if (nearby >= 0) {
      this.cleanTime += dt;
      if (this.cleanTime >= 4) {
        this.today.stuffed[nearby] = false;
        const subject = this.evidence.subjects.get(`stuffed:${nearby}`); if (subject) subject.active = false;
        this.cleanIndex = -1; this.cleanTime = 0; this.paperTimer = 0;
      }
    }
    this.paperTimer -= dt;
    if (this.paperTimer <= 0) { this.paintFlyers(); this.paperTimer = .4; }
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) { this.refreshUI(vehicle); this.uiTimer = .2; }
    this.onUpdate?.(dt);
    if (this.elapsed >= END_TIME - START_TIME) this.end();
  }
  private paintFlyers(): void {
    let slot = 0;
    for (const s of this.boxSubjects) s.y = (this.terrain.heightAt(s.x, s.z) ?? 0) + (s.kind === 'stuffed' ? 1.3 : .25);
    if (this.props) for (const i of this.stuffedIndices) {
      const p = this.props.mail[i], ground = this.terrain.heightAt(p.x, p.z);
      if (!this.today.stuffed[i] || slot >= this.paper.count) continue;
      for (let k = 0; k < 6; k++) {
        if (ground === null) this.paper.setMatrixAt(slot++, this.zero);
        else {
          const heading = p.heading * Math.PI / 180;
          this.dummy.position.set(p.x + Math.sin(heading) * .42 + Math.cos(heading) * (k % 3 - 1) * .045,
            ground + (p.motion.down ? .25 : 1.11) + k * .025, p.z - Math.cos(heading) * .42);
          this.dummy.rotation.set(.13 + k * .1, Math.PI - p.heading * Math.PI / 180 + (k % 2 ? .15 : -.15), .06 * k);
          this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix(); this.paper.setMatrixAt(slot++, this.dummy.matrix);
        }
      }
    }
    while (slot < this.paper.count) this.paper.setMatrixAt(slot++, this.zero);
    this.paper.instanceMatrix.needsUpdate = true;
  }
  private refreshUI(v?: Vehicle): void {
    const type = this.career.double ? 'DOUBLE MAIL' : dayType(this.career.day) === 'flyers' ? 'FLYER DAY' : dayType(this.career.day) === 'light' ? 'LIGHT MAIL' : 'DAILY MAIL';
    this.hud.textContent = `DAY ${this.career.day} · ${this.done}/${this.stops} STOPS · ${clock(this.elapsed)}${this.endsAtSix ? ` · ENDS ${clock(END_TIME - START_TIME)}` : ''}\n${this.run.short} · ${this.fired ? 'GET FIRED' : type}${this.roadsideScore && !this.fired ? ` · Roadside score ${this.roadsideScore}` : ''}`;
    this.endButton.hidden = this.ended;
    this.cameraButton.hidden = false;
    if (this.damage.hintTime > 0) this.progress.textContent = (this.phone || this.low) && this.damage.hint.includes('pulls left')
      ? 'Something in the front end. The garage will check it.' : this.damage.hint;
    else if (this.roadside.some(s => s.hint)) this.progress.textContent = this.roadside.find(s => s.hint)!.hint;
    else if (this.indoorHintTime > 0) this.progress.textContent = this.indoorHint;
    else if (this.cleanIndex >= 0) this.progress.textContent = `Clearing old flyers: ${Math.min(100, this.cleanTime / 4 * 100).toFixed(0)}% · stay stopped`;
    else if (v) {
      const p = this.props?.nearestMailbox(v.x, v.z, 35);
      this.progress.textContent = p ? (this.today.down[p.index] ? 'Box already down: photograph it; leave mail beside the post' : this.today.stuffed[p.index] ? 'Old flyers: stop within 2.5 m for 4 seconds' : this.remaining[p.index] > 0 ? `Nearest stop: ${this.remaining[p.index]} pieces still due` : 'Nearest stop: nothing else due today') : this.idleHint;
    } else this.progress.textContent = this.idleHint;
    if (this.progress.textContent === this.idleHint) this.progress.classList.add('intro');
    else this.progress.classList.remove('intro');
  }
  end(): void {
    if (this.ended) return;
    if (this.fired) {
      // No verdict, no pay and no career: Get Fired never touches the saved shift. The end-of-day sweep (stops
      // skipped, flyers left, the late call) is the verdict's: it never scores, so ending at once earns no step.
      this.ended = true; for (const scene of this.roadside) scene.setPaused?.(true);
      this.endButton.hidden = true; this.cameraButton.hidden = true;
      this.onFiredEnd?.(); return;
    }
    const at = this.elapsed + .001;
    if (this.props) {
      for (const i of missedCustomers(this.career.day, this.remaining)) {
        const p = i < this.props.mail.length ? this.props.mail[i] : this.props.sites[i - this.props.mail.length];
        this.add('missing', i, p.x, p.z, at);
      }
      for (const i of this.run.rural) {
        const p = this.props.mail[i];
        if (!this.passed.has(i)) continue;
        if (this.today.stuffed[i]) this.add('stuffed', i, p.x, p.z, at);
        if (this.today.down[i]) this.add('boxDown', i, p.x, p.z, at, -1, true);
      }
      if (this.run.rural.includes(this.route.late)) {
        const p = this.props.mail[this.route.late]; this.add('late', this.route.late, p.x, p.z, at);
      }
    }
    const upheld = this.complaints.all.filter((c) => !dismissed(c, this.evidence.photos));
    // What the Boss saw on a ride-along day adds to the verdict; the career rules stay the verdict's.
    const base = verdict(upheld), outcome = this.watcher ? this.watcher.verdict(base) : base;
    this.next = nextCareer(this.career, outcome, this.damage.total, this.indoorBonus);
    // Other runs retain their undelivered bundles until that customer's next visit.
    for (const stop of this.run.stops) this.next.carryover[stop.index] = this.remaining[stop.index];
    // Dense arrays survive JSON round trips and storage validation.
    this.next.carryover = Array.from({ length: this.remaining.length }, (_, i) => this.next.carryover[i] ?? 0);
    if (this.props && (this.props.mail.length === 468 && this.props.sites.length === 7 ||
      this.props.mail.length === 469 && this.props.sites.length === 6 && this.career.mailCount !== undefined)) {
      this.next.mailCount = this.props.mail.length;
    }
    if (this.routeEnabled) saveCareer(this.next);
    this.ended = true; for (const scene of this.roadside) scene.setPaused?.(true);
    this.endButton.hidden = true; this.cameraButton.hidden = true;
    document.getElementById('reportDay')!.textContent = `DAY ${this.career.day} · ${this.run.name} · ${clock(this.elapsed)}`;
    document.getElementById('reportVerdict')!.textContent = outcome === 'suspension' ? 'One-day suspension. Without pay.' : outcome === 'warning' ? 'Written warning.' : 'No action taken.';
    const stats = document.getElementById('reportStats')!; stats.replaceChildren();
    for (const [label, value] of [['Stops done', `${this.done} / ${this.stops}`], ['Pieces delivered', this.mail.delivered],
      ['Parcels delivered indoors', this.indoorParcels],
      ...(this.indoorBonus ? [['Indoor bonus', `$${this.indoorBonus}`]] : []), ['Pieces on ground', this.mail.lawn + this.mail.ditch], ['Mailboxes down', this.mail.down],
      ['Lawns damaged', this.complaints.all.filter((c) => c.kind === 'lawnDamage').length],
      ...(this.complaints.all.some((c) => c.kind === DAMAGE_COMPLAINT) ? [['Yards damaged', this.complaints.all.filter((c) => c.kind === DAMAGE_COMPLAINT).length]] : []),
      ['Photos taken', this.evidence.photos.length],
      ...(this.roadsideScore ? [['Roadside score', this.roadsideScore]] : []), ['Last delivery', this.lastDelivery === null ? 'None' : clock(this.lastDelivery)], ['Daily pay', `$${DAILY_PAY}`], ['Vehicle allowance', `$${VEHICLE_ALLOWANCE}`], ['Allowance less repairs', money(VEHICLE_ALLOWANCE - this.damage.total)], ['Day pay', money(DAILY_PAY + VEHICLE_ALLOWANCE - this.damage.total + this.indoorBonus)], ['Total pay', `$${this.next.pay}`]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = String(label); dd.textContent = String(value); stats.append(dt, dd);
    }
    const repairs = document.getElementById('reportRepairs')!; repairs.replaceChildren();
    if (!this.damage.items.length) repairs.textContent = 'Repairs: none';
    else for (const item of this.damage.items) {
      const row = document.createElement('li'); row.textContent = `${item.name}${item.level === 2 ? ' · worsened' : ''}: ${money(item.price)}`; repairs.append(row);
    }
    document.getElementById('repairTotal')!.textContent = `Repairs total: ${money(this.damage.total)} · Allowance left: ${money(VEHICLE_ALLOWANCE - this.damage.total)}`;
    this.roadsideReport.textContent = this.roadside.map(s => s.reportLine()).filter(Boolean).join(' ');
    this.roadsideReport.hidden = !this.roadsideReport.textContent;
    this.bossReport.textContent = this.watcher?.report().join(' ') ?? '';
    this.bossReport.hidden = !this.bossReport.textContent;
    const missed = document.getElementById('reportMissed')!;
    missed.textContent = `Stops missed: ${this.remaining.filter((n) => n > 0).length} · carried over to tomorrow`;
    document.getElementById('reportConsequence')!.textContent = (outcome === 'suspension'
      ? `Day ${this.career.day + 1}: $0. Nobody covers the route. Day ${this.next.day}: TWO days of mail for ONE day of pay. Same clock.`
      : `Next shift: day ${this.next.day}.`) + ` Written warnings on file: ${this.next.warnings}.`;
    document.getElementById('callCount')!.textContent = `${this.complaints.all.length} calls · ${upheld.length} upheld`;
    const calls = document.getElementById('reportCalls')!; calls.replaceChildren();
    for (const c of this.complaints.all) {
      const row = document.createElement('li'), customer = document.createElement('strong'), quote = document.createElement('p'), status = document.createElement('small');
      const closed = dismissed(c, this.evidence.photos);
      row.className = closed ? 'closed' : 'upheld'; customer.textContent = c.customer; quote.textContent = `“${c.line}”`;
      status.textContent = closed ? 'Photo on file. Complaint closed.' : 'UPHELD' + (c.seen ? ' · Seen by the Boss. No photo accepted.' : c.kind === 'late' || c.kind === 'flag' || c.kind === 'indoors' || c.kind === 'relief' || c.kind === DAMAGE_COMPLAINT ? ' · No defence accepted.' : ' · No earlier photo explains this.');
      row.append(customer, quote, status); calls.append(row);
    }
    if (this.complaints.groundOverflow) {
      const more = document.createElement('li'); more.textContent = `and ${this.complaints.groundOverflow} more like it`; calls.append(more);
    }
    document.getElementById('nextDay')!.textContent = `Start day ${this.next.day}${this.next.double ? ' · double mail' : ''}`;
    this.report.hidden = false;
    const panel = document.getElementById('reportPanel')!; panel.scrollTop = 0; panel.focus();
    const seenNotes = this.watcher?.seenItems?.() ?? [];
    this.onReport?.({ outcome, bossSeen: Math.max(upheld.filter(c => c.seen).length, seenNotes.length), complaints: upheld, seenNotes, day: this.career.day });
  }
}

function money(amount: number): string { return amount < 0 ? `−$${-amount}` : `$${amount}`; }
