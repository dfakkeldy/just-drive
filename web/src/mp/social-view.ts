import { Vector3, type Camera } from 'three';
import { mountRoomCard, removeRoomCard } from './room-cards';
import type { TagBox } from './ghosts';
import type { Net } from './net';
import type { PeerView } from './wire';
import { PHRASES, CHAT_MS, GAME_PHRASES, isPhraseId, readHandle } from './social';
interface Bubble { node: HTMLElement; phrase: number; phone: boolean; width: number; height: number }
const lowerTagFirst = (a: TagBox, b: TagBox) => b.bottom - a.bottom;
export function savedHandle(): string | undefined {
  try { return readHandle(localStorage.getItem('mmm.mp.handle')) ?? undefined; } catch { return undefined; }
}
export class SocialView {
  private readonly root = document.createElement('details');
  private readonly bubbles = document.createElement('div');
  private readonly roster = document.createElement('ul');
  private readonly log = document.createElement('div');
  private readonly point = new Vector3();
  private shown = '';
  private readonly chatButton = document.createElement('button');
  private readonly grid = document.createElement('div');
  private readonly bubbleNodes = new Map<number, Bubble>();
  private readonly sortedTags: TagBox[] = [];
  private readonly tagsById = new Map<number, TagBox>();
  private readonly gameButtons: HTMLButtonElement[] = [];
  private readonly key = (ev: KeyboardEvent) => {
    if (!this.net.canChat || ev.repeat || ev.altKey || ev.ctrlKey || ev.metaKey || (ev.target instanceof HTMLElement && (ev.target.closest('input,textarea,select') || ev.target.isContentEditable))) return;
    // 1-8 the road phrases; 9 and 0 the first two game phrases, in a room that runs games.
    const id = ev.key === '0' ? GAME_PHRASES + 1 : Number(ev.key)-1;
    if (/^[0-9]$/.test(ev.key) && isPhraseId(id) && (id < GAME_PHRASES || this.net.gamesSupported)) { ev.preventDefault(); ev.stopImmediatePropagation(); this.net.chat(id); }
  };
  constructor(private readonly net: Net, private readonly ground: (x:number,z:number) => number | null, touch = false) {
    this.root.id = 'mpSocial';
    this.root.open = !touch;
    mountRoomCard(this.root, touch);
    const title = document.createElement('summary'); title.textContent = 'Room drivers and chat';
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
    this.root.append(title, people, button, grid, this.log);
    this.root.addEventListener('keydown', ev => ev.stopPropagation());
    this.bubbles.id = 'mpChatBubbles'; this.bubbles.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;overflow:hidden';
    document.body.append(this.bubbles); addEventListener('keydown', this.key, true);
  }
  update(camera: Camera, peers: readonly PeerView[], me: {x:number;y:number;z:number}, tags: readonly TagBox[] = []): void {
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
    for (const [id, bubble] of this.bubbleNodes) if (!latest.has(id)) { bubble.node.remove(); this.bubbleNodes.delete(id); }
    this.sortedTags.length = 0; this.tagsById.clear();
    for (const tag of tags) { this.sortedTags.push(tag); this.tagsById.set(tag.id, tag); }
    this.sortedTags.sort(lowerTagFirst);
    const phone = document.body.classList.contains('tcOn');
    for (const c of latest.values()) {
      let entry = this.bubbleNodes.get(c.id);
      if (!entry) {
        entry = { node: document.createElement('div'), phrase: -1, phone, width: 0, height: 0 };
        this.bubbleNodes.set(c.id, entry); this.bubbles.append(entry.node);
      }
      const bubble = entry.node;
      bubble.hidden = true;
      let p: PeerView | typeof me | undefined = c.id === this.net.me?.id ? me : undefined;
      if (!p) for (const peer of peers) if (peer.id === c.id) { p = peer; break; }
      if (!p) continue;
      const y = 'y' in p ? p.y : (this.ground(p.x,p.z) ?? 0) + p.air;
      this.point.set(p.x,y+4,p.z).applyMatrix4(camera.matrixWorldInverse);
      if (this.point.z >= 0) continue;
      this.point.applyMatrix4(camera.projectionMatrix);
      if (Math.abs(this.point.x)>1 || Math.abs(this.point.y)>1 || this.point.z>1) continue;
      bubble.hidden = false;
      if (entry.phrase !== c.phrase || entry.phone !== phone) {
        bubble.textContent = PHRASES[c.phrase]; bubble.dataset.sender = String(c.id);
        bubble.style.cssText = `position:absolute;transform:translate(-50%,-100%);background:#fff;color:#16262e;border-radius:12px;padding:6px 10px;font:600 ${phone ? 11 : 14}px system-ui;white-space:nowrap`;
        const rect = bubble.getBoundingClientRect();
        entry.width = rect.width; entry.height = rect.height; entry.phrase = c.phrase; entry.phone = phone;
      }
      const x = (this.point.x + 1) * innerWidth / 2, screenY = (1 - this.point.y) * innerHeight / 2;
      const left = x - entry.width / 2, right = x + entry.width / 2;
      const ownTag = this.tagsById.get(c.id);
      let bottom = ownTag ? Math.min(screenY, ownTag.top - 8) : screenY;
      for (const tag of this.sortedTags) {
        if (left < tag.right && right > tag.left && bottom > tag.top - 8 && bottom - entry.height < tag.bottom + 8) bottom = tag.top - 8;
      }
      bubble.style.left = `${x}px`;
      bubble.style.top = `${bottom}px`;
    }
  }
  dispose(): void { removeEventListener('keydown',this.key,true); removeRoomCard(this.root); this.bubbles.remove(); }
}
