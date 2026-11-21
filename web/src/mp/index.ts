import { SocialView, savedHandle } from './social-view';
import { RaceView } from './race';
import { GameView } from './games';
// Multiplayer, first version: other players' cars are drawn on this player's roads. They are pictures only: no
// collisions, and each player's mail game stays their own. The game loads this file only when the player
// consents to Drive with others; an Off visit neither downloads it nor opens a connection.
import type * as THREE from 'three';
import { Horns } from './horn';
import { Ghosts } from './ghosts';
import { Net, type Local } from './net';
import { FLAG, VERSION, encodeState } from './wire';
import { browserSession } from './session';

export interface MultiplayerHost {
  scene: THREE.Scene;
  roads?: readonly import('../roads').Road[];
  ride?: () => import('./wire').Ride;
  /** The player's own car: read only. */
  vehicle: { x: number; y: number; z: number; heading: number; vx: number; vz: number; speed: number; steerAngle: number; airborne: boolean };
  /** Ground height at a world point, a deck only with a caller height; null where the land has not loaded. */
  ground: (x: number, z: number, referenceY?:number) => number | null;
  heightScale?:number;seaLevel?:number;
  low: boolean;
  /** A picture run (?hud=0): no readout. */
  bare: boolean;
  touch: boolean;
  params: URLSearchParams;
  /** The land this build shows. Rooms belong to an area, so its coordinates mean the same to everybody in a room. */
  area: string;
  /** Optional display-only label; room identities and names on the wire stay unchanged. */
  label?: (name: string, id: number) => string;
  /** Real places where nothing scores (church grounds, cemeteries, the school bus stop), for room games. */
  quiet?: () => readonly import('./game-field').QuietPlace[];
}

export class Multiplayer {
  readonly net: Net;
  readonly race: RaceView;
  readonly games: GameView;
  private readonly social: SocialView | null;
  readonly ghosts: Ghosts;
  readonly horns = new Horns();
  private peers: readonly import('./wire').PeerView[] = [];
  status = 'Looking for other drivers…';
  private readonly chip: HTMLElement | null;
  private readonly local: Local = { flags: 0, steer: 0, heading: 0, x: 0, z: 0, vx: 0, vz: 0, air: 0 };
  /** For test scripts on the dev server: they play other games by hand. */
  readonly encode = encodeState;
  private lastSpeed = 0; private brake = 0; private shown = ''; private chipFit = 0;

  private readonly visibility = () => this.net.setVisible(!document.hidden);
  private readonly pagehide = () => this.net.stop();
  private readonly pageshow = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;

  constructor(private readonly host: MultiplayerHost, code: string | null) {
    // The room server is the page's own address. A test build may name another (the local wrangler dev).
    const asked = import.meta.env.DEV ? host.params.get('mpserver') : null;
    const base = asked ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    // A code is a private room: one address. Without a code the open room, and its overflow rooms when it is full.
    const rooms = code ? [code] : ['world', ...Array.from({ length: 7 }, (_, i) => `world${i + 2}`)];
    this.net = new Net({ handle: savedHandle(), identity: browserSession(), urls: rooms.map((room) => `${base}/mp/v${VERSION}/${host.area}/${room}?heights=1`) });
    this.visibility();
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('pagehide', this.pagehide);
    window.addEventListener('pageshow', this.pageshow);
    this.heartbeatTimer = setInterval(() => this.net.heartbeat(), 20000);
    this.race = new RaceView(this.net,host);
    // After the race: on a phone both live in Settings, race first.
    // A sender's height, in this view's land scale. Ghosts and chat bubbles read decks within reach of it.
    const sea = host.seaLevel ?? 0, height = (y: number) => y > sea ? sea + (y - sea) * (host.heightScale ?? 1) : y;
    this.social = host.bare ? null : new SocialView(this.net, host.ground, host.touch, height);
    // Room games: on a phone, in Settings between the race and the drivers.
    this.games = new GameView(this.net, host);
    this.ghosts = new Ghosts({ ground: host.ground, low: host.low, height, label: host.label });
    host.scene.add(this.ghosts.group);
    this.chip = host.bare || host.touch ? null : document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mpChip' }));
    if (this.chip) {
      this.chip.style.cssText = 'position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 6px);transform:translateX(-50%);z-index:5;'
        + 'padding:3px 10px;border-radius:10px;background:rgba(11,22,32,.72);color:#eef2f6;font:12px/1.4 system-ui,sans-serif;'
        + 'pointer-events:none;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis';
      this.chip.setAttribute('role', 'status');
    }
  }

  /**
   * Once a frame, before the picture is drawn. dt is real seconds. `running` is false while the game holds the
   * car still (the title card, the end of a shift, the free camera): the car keeps its speed for later, but to the others it stands.
   */
  update(dt: number, camera: THREE.Camera, running: boolean): void {
    const now = performance.now(), v = this.host.vehicle, s = this.local;
    // Brake lamps for the others: the car is losing speed faster than a lifted pedal does.
    if (dt > 0) {
      const slowing = (Math.abs(this.lastSpeed) - Math.abs(v.speed)) / dt;
      this.brake = slowing > 2.5 ? 0.25 : Math.max(0, this.brake - dt);
      this.lastSpeed = v.speed;
    }
    const ground = v.airborne ? this.host.ground(v.x, v.z,v.y) : null;
    s.x = v.x; s.z = v.z; s.heading = v.heading; s.vx = running ? v.vx : 0; s.vz = running ? v.vz : 0; s.steer = v.steerAngle;
    s.air = ground !== null ? Math.max(0, v.y - ground) : 0;
    const sea=this.host.seaLevel??0,support=v.y-s.air;s.y=support>sea?sea+(support-sea)/(this.host.heightScale??1):support;
    s.flags = (v.airborne ? FLAG.air : 0) | (this.brake > 0 ? FLAG.brake : 0);
    const ride = this.host.ride?.(); if (ride) this.net.setRide(ride);
    this.net.report(s, now, !running);
    this.race.update();
    this.peers = this.net.views(now);
    this.games.update(dt, this.peers, camera);
    this.social?.update(camera, this.peers, v);
    this.ghosts.update(dt, this.peers, camera, v, ride);
    this.horns.update(this.peers, v.x, v.z, now);
    {
      const n = this.net.count, st = this.net.status;
      const say = st === 'on' ? `${this.net.me ? this.host.label?.(this.net.me.name, this.net.me.id) ?? this.net.me.name : ''} · ${n === 0 ? 'nobody else on the road' : n === 1 ? '1 other driver' : `${n} other drivers`}`
        : st === 'connecting' ? 'Looking for other drivers…'
          : st === 'retry' ? 'Connection lost. Trying again…'
            : st === 'full' ? 'Every room is full.'
              : 'Driving with others is not available now.';
      this.status = say;
      if (this.chip && say !== this.shown) this.chip.textContent = this.shown = say;
      this.chipFit -= dt;
      if (this.chipFit <= 0) { this.chipFit = .5; this.fitChip(); }
    }
  }

  /** Keep the desktop chip between the real readouts, including narrow desktop windows. */
  private fitChip(): void {
    if (!this.chip) return;
    this.chip.style.maxWidth = 'min(440px,92vw)';
    this.chip.style.top = 'calc(env(safe-area-inset-top,0px) + 6px)';
    const box = this.chip.getBoundingClientRect();
    let top = box.top;
    const readouts = ['hud', 'gear', 'shiftHud', 'stopHint', 'miniMap', 'radio', 'photoTag'];
    // A wide development HUD can reach past the centre. Keep the chip centred, below that HUD.
    for (let pass = 0; pass < readouts.length; pass++) {
      let next = top;
      for (const id of readouts) {
        const r = document.getElementById(id)?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0 && box.left < r.right && box.right > r.left
          && top < r.bottom && top + box.height > r.top) next = Math.max(next, r.bottom + 6);
      }
      if (next === top) break;
      top = next;
    }
    this.chip.style.top = `${top}px`;
  }

  marks(out: { x: number; z: number }[]): void {
    for (const v of this.peers) out.push({ x: v.x, z: v.z });
  }
  /** The room game's parcel, for the small map. */
  gameMarks(out: { x: number; z: number; label: string; rank?: number; colour?: string }[]): void { this.games.marks(out); }

  dispose(): void {
    clearInterval(this.heartbeatTimer);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pagehide', this.pagehide);
    window.removeEventListener('pageshow', this.pageshow);
    this.social?.dispose();
    this.race.dispose();
    this.games.dispose();
    this.net.stop();
    this.horns.dispose();
    this.peers = [];
    this.host.scene.remove(this.ghosts.group);
    this.ghosts.dispose();
    this.chip?.remove();
  }
}
