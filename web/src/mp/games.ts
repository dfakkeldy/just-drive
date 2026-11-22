import * as THREE from 'three';
import { mountRoomCard, removeRoomCard, RoomCountdown } from './room-cards';
import { GAMES, PHASE, gameName, type GameName } from './game-wire';
import { RACE_LIMIT } from './race-wire';
import { TAG } from './tag-rules';
import { gameField } from './game-field';
import type { MultiplayerHost } from './index';
import type { Net } from './net';
import type { PeerView } from './wire';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const clock = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };


/**
 * Room games in the game: the host's controls, the live and final score table, the parcel over the holder's car (big
 * enough to see from far off), an arrow to it over this car, and its mark on the small map. Like the race, it exists only
 * in a room that said hello.games, and goes with the connection.
 */
export class GameView {
  readonly group = new THREE.Group();
  private readonly panel: HTMLDetailsElement | null;
  private readonly summary = document.createElement('summary');
  private readonly readout: HTMLDivElement | null;
  private readonly results: HTMLDivElement | null;
  private readonly status = document.createElement('p');
  private readonly countdown: RoomCountdown;
  private readonly table = document.createElement('ol');
  private readonly select = document.createElement('select');
  private readonly start = document.createElement('button');
  private readonly stop = document.createElement('button');
  private readonly parcel = new THREE.Group();
  private readonly arrow: THREE.Mesh;
  private readonly tape: THREE.MeshLambertMaterial;
  private readonly disposables: { dispose(): void }[] = [];
  private shown = ''; private tableText = ''; private readoutText = ''; private resultText = ''; private summaryText = '';
  /** The room answers a refused start with the same state: after a moment the host is told what a start needs. */
  private refused = false;
  private goAt = -Infinity;
  private serial = -1; private phase = -1; private overAt = 0; private asked = 0;
  /** Where the parcel is drawn, for the small map. */
  private where: { x: number; z: number } | null = null;

  constructor(private readonly net: Net, private readonly host: MultiplayerHost) {
    // The parcel: a plain brown box with tape, no marks. The arrow: gold, flat, pointing at it.
    const box = new THREE.BoxGeometry(1.5, 1, 1.1), strap = new THREE.BoxGeometry(1.54, 1.04, .22), band = new THREE.BoxGeometry(.22, 1.04, 1.14);
    const card = new THREE.MeshLambertMaterial({ color: 0xb4834a }); this.tape = new THREE.MeshLambertMaterial({ color: 0xe9d9a6, emissive: 0x000000 });
    this.parcel.add(new THREE.Mesh(box, card), new THREE.Mesh(strap, this.tape), new THREE.Mesh(band, this.tape));
    const cone = new THREE.ConeGeometry(.55, 1.5, 3).rotateX(-Math.PI / 2).scale(1, .35, 1);
    const gold = new THREE.MeshBasicMaterial({ color: 0xffca64, depthTest: false, transparent: true, opacity: .92 });
    this.arrow = new THREE.Mesh(cone, gold); this.arrow.renderOrder = 10;
    this.disposables.push(box, strap, band, card, this.tape, cone, gold);
    this.group.add(this.parcel, this.arrow); this.group.visible = false;
    host.scene.add(this.group);
    this.countdown = new RoomCountdown('gameCountdown', !!host.bare);
    // On a phone the controls live in Settings after the race, like the race; the readout sits beside the race's.
    const settings = host.touch ? document.getElementById('settings') : null;
    this.panel = host.bare ? null : document.createElement('details');
    const phoneStatus = host.touch && !host.bare ? document.getElementById('phoneStatus') : null;
    this.readout = phoneStatus?.appendChild(Object.assign(document.createElement('div'), { id: 'gameReadout', hidden: true })) ?? null;
    this.results = host.bare ? null : document.body.appendChild(Object.assign(document.createElement('div'), { id: 'gameResults', hidden: true }));
    if (this.results) {
      this.results.setAttribute('role', 'status');
      this.results.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 58px);transform:translateX(-50%);z-index:6;pointer-events:none;'
        + 'background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px 14px;font:13px/1.45 system-ui;max-width:min(320px,70vw);box-sizing:border-box';
    }
    if (!this.panel) return;
    const panel = this.panel;
    panel.id = 'gamePanel'; panel.hidden = true;
    mountRoomCard(panel, host.touch);
    this.summary.textContent = 'Room games';
    const label = document.createElement('label'); label.textContent = 'Game ';
    this.select.setAttribute('aria-label', 'Room game');
    for (const [key, g] of Object.entries(GAMES)) this.select.add(new Option(g.name, key));
    label.append(this.select);
    this.start.textContent = 'Start · 5 seconds'; this.stop.textContent = 'Stop game';

    if (settings) for (const e of [this.select, this.start, this.stop]) e.style.minHeight = '56px';
    this.status.setAttribute('role', 'status'); this.status.style.margin = '6px 0';
    this.table.id = 'gameTable'; this.table.style.cssText = 'margin:4px 0;padding-left:22px';
    panel.append(this.summary, label, this.start, this.stop, this.status, this.table);
    this.start.onclick = () => {
      const v = host.vehicle, name = this.select.value as GameName;
      this.asked = performance.now();
      this.net.gameCommand('start', name, gameField(host.roads ?? [], host.quiet?.() ?? [], v));
    };
    this.stop.onclick = () => this.net.gameCommand('stop');
    panel.addEventListener('keydown', e => e.stopPropagation());
  }

  private name(id: number): string {
    if (id === this.net.me?.id) return 'You';
    const n = this.net.names.get(id) ?? `Driver ${id}`, shown = this.host.label?.(n, id) ?? n;
    // A driver who left (or reconnected, and plays on under a new seat) keeps the points, marked as gone.
    return this.net.roster.some(p => p.id === id) ? shown : `${shown} (gone)`;
  }
  /** The place of a car in the room, smoothed as it is drawn; this car from the game itself. */
  private car(id: number, peers: readonly PeerView[]): { x: number; z: number; y: number } | null {
    if (id === this.net.me?.id) return { x: this.host.vehicle.x, z: this.host.vehicle.z, y: this.host.vehicle.y };
    const p = peers.find(v => v.id === id);
    if (!p) return null;
    return { x: p.x, z: p.z, y: (this.host.ground(p.x, p.z) ?? 0) + p.air };
  }
  private toward(p: { x: number; z: number }): { distance: number; angle: number; text: string } {
    const dx = p.x - this.host.vehicle.x, dz = p.z - this.host.vehicle.z, angle = Math.atan2(dx, -dz), distance = Math.hypot(dx, dz);
    return { distance, angle, text: `${Math.round(distance)} m ${COMPASS[Math.round((angle + Math.PI * 2) / (Math.PI / 4)) % 8]}` };
  }

  update(dt: number, peers: readonly PeerView[], camera: THREE.Camera): void {
    const f = this.net.game, me = this.net.me, on = this.net.status === 'on' && this.net.gamesSupported && !!f && !!me;
    if (this.panel) this.panel.hidden = !on;
    if (!on || !f || !me) { this.countdown.update(null); this.group.visible = false; this.where = null; if (this.readout) this.readout.hidden = true; if (this.results) this.results.hidden = true; return; }
    const left = this.net.gameLeft(), host = f.host === me.id, game = gameName(f.kind), title = game ? GAMES[game].name : 'Room games';
    if (f.phase === PHASE.play && this.phase === PHASE.countdown) this.goAt = performance.now();
    this.countdown.update(f.phase === PHASE.countdown ? left : f.phase === PHASE.play ? -(performance.now() - this.goAt) : null);
    if (f.serial !== this.serial || f.phase !== this.phase) {
      // A new countdown opens the desktop panel, so the table is in sight; a phone keeps Settings closed.
      if (f.phase === PHASE.countdown && this.panel && !this.host.touch) this.panel.open = true;
      if (f.phase === PHASE.over && this.phase !== PHASE.over) this.overAt = performance.now();
      this.serial = f.serial; this.phase = f.phase; this.asked = 0; this.refused = false;
    }
    if (this.asked && performance.now() - this.asked > 2500) { this.asked = 0; this.refused = true; }
    const race = this.net.race, raceBusy = !!race?.startAt && this.net.serverNow() - race.startAt < RACE_LIMIT && race.racers.some(r => r.time === null && !r.out);
    this.select.disabled = !host || f.phase !== PHASE.free;
    this.start.disabled = !host || f.phase !== PHASE.free || this.net.count < 1 || raceBusy || performance.now() - this.asked < 3000;
    this.stop.disabled = !host || f.phase === PHASE.free;
    this.stop.hidden = f.phase === PHASE.free;
    // What is said, in the room's dry voice.
    const tag = f.tag, holder = tag?.holder ?? 0, mine = holder === me.id;
    let target: { x: number; z: number } | null = null, y = 0;
    if (tag && (f.phase === PHASE.countdown || f.phase === PHASE.play)) {
      const car = holder ? this.car(holder, peers) : null;
      // Over your own car it sits low and small, out of your view of the road; the others see it high and large.
      if (car) { target = car; y = car.y + (mine ? 2.4 : 3.3); }
      else { target = tag.parcel; y = (this.host.ground(tag.parcel.x, tag.parcel.z) ?? 0) + 1.3 + Math.sin(performance.now() / 400) * .2; }
    }
    let say: string;
    const reach = TAG.startReachM;
    if (f.phase === PHASE.free) say = host ? (this.net.count < 1 ? 'Room games need one more driver in the room.' : raceBusy ? 'A race is on. Games wait for it.'
      : this.refused ? `No game. It needs another driver within ${reach} m of you on this version of the game, and a road nearby.` : `Pick a game. Drivers within ${reach} m of you play.`) : 'The room host starts games.';
    else if (f.phase === PHASE.countdown) say = 'The parcel waits on the road until GO.';
    else if (f.phase === PHASE.play) {
      const where = target && !mine ? ` ${this.toward(target).text}.` : '';
      say = `${clock(left)} left. ` + (mine ? (tag!.immune > 0 ? 'You signed for the parcel. Nobody can take it for a moment.' : 'You have the parcel. Keep moving, keep to the roads.')
        : holder ? `${this.name(holder)} has the parcel.${where}` : `The parcel is lying on the road. Nobody has signed for it.${where}`);
    } else {
      const best = Math.max(0, ...f.table.map(r => r.score)), winners = f.table.filter(r => r.score === best && best > 0).map(r => this.name(r.id));
      say = winners.length ? `Round over. ${winners.join(' and ')} ${winners.length > 1 || winners[0] === 'You' ? 'win' : 'wins'} with ${best}.` : 'Round over. Nobody held the parcel long enough to count.';
    }
    if (say !== this.shown) this.status.textContent = this.shown = say;
    const summary = f.phase === PHASE.free ? 'Room games' : f.phase === PHASE.countdown ? `${title} in ${Math.min(5, Math.ceil(left / 1000))}` : f.phase === PHASE.play ? `${title} · ${clock(left)}` : `${title} · results`;
    if (summary !== this.summaryText) this.summary.textContent = this.summaryText = summary;
    // The table, highest first: live while playing, final after.
    const rows = [...f.table].sort((a, b) => b.score - a.score || a.id - b.id);
    const lines = f.phase === PHASE.free ? [] : rows.map(r => `${this.name(r.id)}${r.id === holder && f.phase === PHASE.play ? ' (parcel)' : ''}: ${r.score}`);
    const text = lines.join('\n');
    if (text !== this.tableText) { this.tableText = text; this.table.replaceChildren(...lines.map(t => Object.assign(document.createElement('li'), { textContent: t }))); }
    const place = rows.findIndex(r => r.id === me.id), myScore = place >= 0 ? rows[place].score : 0;
    if (this.readout) {
      const r = f.phase === PHASE.free ? '' : f.phase === PHASE.countdown ? `${title} in ${Math.min(5, Math.ceil(left / 1000))}${target ? ` · ${this.toward(target).text}` : ''}`
        // Where the parcel is comes first: a narrow phone cuts the end of the line.
        : f.phase === PHASE.play ? `Tag ${clock(left)}${mine ? ' · parcel!' : target ? ` · ${this.toward(target).text}` : ''}${place >= 0 ? ` · #${place + 1}` : ''} · ${myScore} pts`
        : `Tag over · ${myScore} pts${place >= 0 ? ` · #${place + 1}` : ''}`;
      this.readout.hidden = !r;
      if (r !== this.readoutText) this.readout.textContent = this.readoutText = r;
    }
    if (this.results) {
      const showing = f.phase === PHASE.over && performance.now() - this.overAt < 12000;
      this.results.hidden = !showing;
      const top = rows.slice(0, 5), res = showing ? `${title} · final\n` + top.map((r, i) => `${i + 1}. ${this.name(r.id)} ${r.score}`).join('\n')
        + (place >= 5 ? `\n${place + 1}. You ${myScore}` : '') : '';
      if (res !== this.resultText) {
        this.resultText = res;
        this.results.replaceChildren(...res.split('\n').filter(Boolean).map((t, i) => Object.assign(document.createElement('div'), { textContent: t, style: i ? '' : 'font-weight:700' })));
      }
    }
    // The parcel and the arrow.
    this.where = target;
    this.group.visible = !!target;
    if (target) {
      const eye = (camera as THREE.Camera & { position: THREE.Vector3 }).position;
      // Seen from far off: it grows with distance, so it stays a few pixels tall at the edge of the area.
      const far = Math.hypot(eye.x - target.x, eye.z - target.z);
      this.parcel.position.set(target.x, y, target.z);
      this.parcel.scale.setScalar(mine ? .5 : Math.max(1.4, far / 40));
      this.parcel.rotation.y += dt * .8;
      this.tape.emissive.setHex(tag!.immune > 0 && Math.floor(performance.now() / 160) % 2 ? 0x7a5a10 : 0x000000);
      const to = this.toward(target);
      this.arrow.visible = !mine && to.distance > 8;
      this.arrow.position.set(this.host.vehicle.x, this.host.vehicle.y + 2.6, this.host.vehicle.z);
      this.arrow.rotation.y = -to.angle;
    }
  }
  /** The parcel on the small map. */
  marks(out: { x: number; z: number; label: string; rank?: number; colour?: string }[]): void {
    if (this.where) out.push({ x: this.where.x, z: this.where.z, label: 'Parcel', rank: 0, colour: '#ffca64' });
  }
  dispose(): void {
    this.countdown.dispose();
    removeRoomCard(this.panel); this.readout?.remove(); this.results?.remove();
    this.host.scene.remove(this.group); this.group.clear();
    for (const d of this.disposables) d.dispose();
  }
}
