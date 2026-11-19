import { Vector3, type Camera } from 'three';
import type { Net } from './net';
import type { PeerView } from './wire';
import { PHRASES, CHAT_MS, GAME_PHRASES, isPhraseId, readHandle } from './social';
export function savedHandle(): string | undefined {
  try { return readHandle(localStorage.getItem('mmm.mp.handle')) ?? undefined; } catch { return undefined; }
}
export class SocialView {
  private readonly root = document.createElement('div');
  private readonly bubbles = document.createElement('div');
  private readonly roster = document.createElement('ul');
  private readonly log = document.createElement('div');
  private readonly point = new Vector3();
  private shown = '';
  private readonly chatButton = document.createElement('button');
  private readonly grid = document.createElement('div');
  private readonly bubbleNodes = new Map<number, HTMLElement>();
  private readonly gameButtons: HTMLButtonElement[] = [];
  private readonly key = (ev: KeyboardEvent) => {
    if (!this.net.canChat || ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey || (ev.target instanceof HTMLElement && (ev.target.closest('input,textarea,select') || ev.target.isContentEditable))) return;
    // 1-8 the road phrases; 9 and 0 the first two game phrases, in a room that runs games.
    const id = ev.key === '0' ? GAME_PHRASES + 1 : Number(ev.key)-1;
    if (/^[0-9]$/.test(ev.key) && isPhraseId(id) && (id < GAME_PHRASES || this.net.gamesSupported)) { ev.preventDefault(); ev.stopImmediatePropagation(); this.net.chat(id); }
  };
  constructor(private readonly net: Net, private readonly ground: (x:number,z:number,referenceY?:number) => number | null, touch = false,
    private readonly height: (y:number) => number = y => y) {
    this.root.id = 'mpSocial';
    // A phone's screen edges belong to the driving controls, so there the panel lives in Settings, after the race
    // (the way the race panel does). Bubbles over cars stay on the road for everyone: they take no touches.
    const settings = touch ? document.getElementById('settings') : null;
    this.root.style.cssText = settings
      ? 'color:#eef2f6;font:13px system-ui;background:#16262eee;border-radius:8px;padding:6px;margin-bottom:12px;box-sizing:border-box'
      // On a desktop it sits beside the left column (map, relief gauge, radio up to 300 px wide), so a short window
      // cannot lift it over them; 160 px up keeps the stop hint and the mail score below it free, and 100 px at the
      // top keeps an open Chat off the text panel on a very short window.
      : 'position:fixed;left:calc(max(10px,env(safe-area-inset-left,0px)) + 310px);bottom:calc(env(safe-area-inset-bottom,0px) + 160px);z-index:6;max-width:min(300px,calc(100vw - 330px));color:#eef2f6;font:13px system-ui;background:#16262eee;border-radius:8px;padding:6px;max-height:min(35vh,calc(100vh - 260px));overflow:auto';
    const people = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Room drivers'; people.append(summary, this.roster);
    this.roster.id = 'mpRoster'; this.roster.style.cssText = 'padding-left:20px;margin:4px';
    const button = this.chatButton; button.id = 'mpChatButton'; button.textContent = 'Chat'; button.setAttribute('aria-expanded','false');
    const grid = this.grid; grid.id = 'mpChatGrid'; grid.hidden = true; grid.style.cssText = 'grid-template-columns:1fr 1fr;gap:4px';
    const style = (b: HTMLButtonElement) => b.style.cssText = 'min-height:44px;background:#24445c;color:white;border:1px solid #8198aa;border-radius:6px;font:inherit;padding:5px 8px';
    style(button);
    button.onclick = () => { grid.hidden = !grid.hidden; grid.style.display = grid.hidden ? 'none' : 'grid'; button.setAttribute('aria-expanded',String(!grid.hidden)); };
    PHRASES.forEach((phrase, id) => {
      if (!isPhraseId(id)) return;
      const b = document.createElement('button'); style(b); b.textContent = id < GAME_PHRASES + 2 ? `${(id+1) % 10} ${phrase}` : phrase;
      if (id >= GAME_PHRASES) { b.hidden = true; b.dataset.game = '1'; this.gameButtons.push(b); }
      b.onclick = () => { this.net.chat(id); grid.hidden = true; grid.style.display = 'none'; button.setAttribute('aria-expanded','false'); }; grid.append(b);
    });
    this.log.id = 'mpChatLog'; this.log.setAttribute('role','log'); this.log.setAttribute('aria-label','Quick chat');
    this.root.append(people, button, grid, this.log);
    this.root.addEventListener('keydown', ev => ev.stopPropagation());
    this.bubbles.id = 'mpChatBubbles'; this.bubbles.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;overflow:hidden';
    const race = settings?.querySelector('#racePanel');
    if (race) race.after(this.root); else if (settings) settings.prepend(this.root); else document.body.append(this.root);
    document.body.append(this.bubbles); addEventListener('keydown', this.key, true);
  }
  update(camera: Camera, peers: readonly PeerView[], me: {x:number;y:number;z:number}): void {
    const now = performance.now();
    // No chat control at all until the room says it relays phrases (an older room, or between rooms).
    for (const b of this.gameButtons) if (b.hidden === this.net.gamesSupported) b.hidden = !this.net.gamesSupported;
    if (this.chatButton.hidden === this.net.canChat) {
      this.chatButton.hidden = !this.net.canChat;
      if (!this.net.canChat) { this.grid.hidden = true; this.grid.style.display = 'none'; this.chatButton.setAttribute('aria-expanded','false'); }
    }
    const text = this.net.roster.map(p => p.name).join('\n') + this.net.chats.map(c => `${c.at}:${c.id}:${c.phrase}`).join(',');
    if (text !== this.shown) {
      this.shown = text; this.roster.replaceChildren(...this.net.roster.map(p => Object.assign(document.createElement('li'), { textContent:p.name })));
      this.log.replaceChildren(...this.net.chats.map(c => Object.assign(document.createElement('div'), { textContent:`${this.net.names.get(c.id) ?? 'Driver'}: ${PHRASES[c.phrase]}` })));
    }
    const latest = this.net.bubbles;
    for (const [id,c] of latest) if (now-c.at >= CHAT_MS) latest.delete(id);
    for (const [id, node] of this.bubbleNodes) if (!latest.has(id)) { node.remove(); this.bubbleNodes.delete(id); }
    for (const c of latest.values()) {
      let bubble = this.bubbleNodes.get(c.id);
      if (!bubble) { bubble = document.createElement('div'); this.bubbleNodes.set(c.id,bubble); this.bubbles.append(bubble); }
      bubble.hidden = true;
      const peer = c.id === this.net.me?.id ? null : peers.find(p => p.id === c.id);
      if (peer === undefined) continue;
      // A peer's bubble floats over its ghost, which stands on the deck within reach of the peer's own height.
      const y = peer ? (this.ground(peer.x,peer.z,peer.y === undefined ? undefined : this.height(peer.y)) ?? 0) + peer.air : me.y;
      this.point.set(peer ? peer.x : me.x,y+4,peer ? peer.z : me.z).applyMatrix4(camera.matrixWorldInverse);
      if (this.point.z >= 0) continue;
      this.point.applyMatrix4(camera.projectionMatrix);
      if (Math.abs(this.point.x)>1 || Math.abs(this.point.y)>1 || this.point.z>1) continue;
      bubble.hidden = false; bubble.textContent = PHRASES[c.phrase]; bubble.dataset.sender = String(c.id);
      bubble.style.cssText = `position:absolute;left:${(this.point.x+1)*50}%;top:${(1-this.point.y)*50}%;transform:translate(-50%,-100%);background:#fff;color:#16262e;border-radius:12px;padding:6px 10px;font:600 14px system-ui;white-space:nowrap`;
    }
  }
  dispose(): void { removeEventListener('keydown',this.key,true); this.root.remove(); this.bubbles.remove(); }
}
