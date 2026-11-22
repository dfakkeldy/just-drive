import { readHandle, inventedName } from './social';
import { readSite } from '../site';
// Always loaded, but the connection and car pictures load only after a player chooses On.
import type * as THREE from 'three';
import type { Multiplayer, MultiplayerHost } from './index';

const HOSTS = ['mmm.fakkeldy.ca', 'justdrive.fakkeldy.ca', 'localhost', '127.0.0.1'] as const;
export const multiplayerHost = (hostname: string): boolean => (HOSTS as readonly string[]).includes(hostname);
export const roomCode = (text: string): string | null => /^[a-z]{4}$/i.test(text) ? text.toLowerCase() : null;
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';
export function newRoomCode(): string {
  let code = '';
  const bytes = new Uint8Array(16), limit = 256 - 256 % LETTERS.length;
  while (code.length < 4) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) { if (b < limit) code += LETTERS[b % LETTERS.length]; if (code.length === 4) break; }
  }
  return code;
}
const saved = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key: string, value: string): void => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* this visit only */ } };

export const roomInvitation = (origin: string, path: string, code: string, area: string, params = new URLSearchParams()): string => {
  const site = readSite(new URL(origin).hostname, path, params);
  return site.brand === 'just'
    ? `${origin}${site.area ? `/${site.area}` : path}?room=${code}${new URL(origin).hostname === 'localhost' ? '&site=just' : ''}`
    : `${origin}${path}?room=${code}${area === 'mabou' ? '' : `&area=${encodeURIComponent(area)}`}`;
};

const CSS = `
.mpControl{margin:14px 0 0;padding-top:12px;border-top:1px solid #eef2f633;font:13px/1.4 system-ui,sans-serif;min-width:0}
.mpControl [hidden]{display:none!important}
.mpControl .mpHeading{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700}
.mpControl button,.mpControl input{box-sizing:border-box;min-height:38px;border:1px solid #6b7780;border-radius:6px;background:transparent;color:inherit;font:inherit;padding:7px 9px}
.mpControl button{cursor:pointer;min-width:58px}
.mpControl button[aria-pressed=true],.mpControl button[aria-checked=true]{background:#3d6f8f}
.mpControl :is(button,input):focus-visible{outline:3px solid #f4be79;outline-offset:-3px}
.mpControl .mpToggle{display:flex;align-items:center;gap:8px;min-height:44px;border:0;background:transparent!important}
.mpToggle::before{content:"";display:block;flex:none;width:40px;height:24px;border:1px solid currentColor;border-radius:20px;background:radial-gradient(circle at 12px 12px,currentColor 8px,transparent 9px)}
.mpToggle[aria-checked=true]::before{color:var(--title-accent,#a7d9bc);background:radial-gradient(circle at 28px 12px,currentColor 8px,transparent 9px)}
.mpControl button:disabled{opacity:.5;cursor:default}
.mpControl small{display:block;margin:7px 0;color:#b9c3cc;font:12px/1.4 system-ui,sans-serif}
.mpControl .mpChoices,.mpControl .mpJoin,.mpControl .mpNameRow{display:flex;gap:6px;margin-top:8px}
.mpControl .mpChoices button{flex:1}
.mpControl .mpCode{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
.mpControl output{font:700 27px/1.2 ui-monospace,monospace;letter-spacing:.15em;color:#f4be79}
.mpControl label{display:block;margin-top:8px!important;font:12px/1.4 system-ui,sans-serif!important}
.mpControl input{width:100%;min-width:0;letter-spacing:.1em;text-transform:uppercase}
.mpControl .mpJoin input,.mpControl .mpNameRow input{flex:1;width:0}
.mpControl .mpCopy{width:100%;margin-top:8px}
.mpControl .mpStatus:empty{display:none}
.mpControl .mpStatus{overflow-wrap:anywhere;color:#eef2f6}
.mpControl .mpError{color:#ffbc99}
#title:has(.mpControl){display:flex;align-items:safe center;justify-content:center}
#titleCard:has(.mpControl){flex:none;max-width:100%;box-sizing:border-box}

`;

// True on the development server only. (A node check loads this file with no build at all: then it is false.)
const DEV = !!import.meta.env?.DEV;
/** The two rules of consent that depend on the kind of build; here as plain functions so a check can read them. */
export const addressTurnsOn = (dev: boolean, mp: string | null): boolean => dev && mp === '1';
export const startsWithoutButton = (dev: boolean, prior: boolean, invited: boolean, titleCard: boolean): boolean =>
  !invited && !titleCard && (dev || prior);

/**
 * The yes after the player used the switch or chose a room. With the title card on screen the choice waits for
 * its start button, whatever was agreed before. While driving, turning it on is the yes; turning it off changes nothing.
 */
export const consentAfterSwitch = (before: boolean, enabled: boolean, titleCard: boolean): boolean =>
  titleCard ? false : enabled ? true : before;
const titleShowing = (): boolean => { const t = document.getElementById('title'); return !!t && !t.hidden; };

export interface MultiplayerChoice { readonly on: boolean; readonly room: string | null }

type Host = MultiplayerHost & { settings: HTMLElement | null; before: HTMLElement | null; touch: boolean };
export function multiplayerSwitch(host: Host) {
  let current: Multiplayer | null = null;
  const allowed = multiplayerHost(location.hostname);
  // A choice saved on an earlier visit is this player's own earlier yes.
  const prior = saved('mmm.mp') === '1';
  let on = prior;
  let code = roomCode(saved('mmm.mp.room') ?? '') ?? '';
  const invitation = roomCode(host.params.get('room') ?? '');
  if (invitation) { code = invitation; on = true; }
  // ?mp=1 turns it on for tests, on a development build only: a published address can never switch it on by itself.
  if (addressTurnsOn(DEV, host.params.get('mp'))) on = true;
  if (host.params.get('mp') === '0') on = false;
  let consent = false, generation = 0, loading = false, failed = false, titleMounted = false;
  let status = '';
  const blocks: { paint(): void; say(text: string): void }[] = [];

  const stop = () => { generation++; loading = false; current?.dispose(); current = null; failed = false; };
  const remember = () => { save('mmm.mp', on ? '1' : '0'); save('mmm.mp.room', code); };
  const paint = () => blocks.forEach(b => b.paint());
  const change = (enabled: boolean, room = code) => {
    if (on !== enabled || code !== room) stop();
    on = enabled; code = room;
    // Turning it on by hand is the player's yes. While the title card is up (also when it was opened again in the
    // middle of a shift), its start button comes first: an earlier yes does not carry over to a new choice there.
    consent = consentAfterSwitch(consent, enabled, titleShowing());
    remember(); paint();
  };
  const load = () => {
    if (!allowed || !on || !consent || current || loading || failed) return;
    loading = true;
    const token = generation;
    import('./index').then(({ Multiplayer }) => {
      if (token !== generation || !on) return;
      current = new Multiplayer(host, code || null);
      loading = false;
    }).catch(() => { if (token === generation) { loading = false; failed = true; } });
  };
  const invitationLink = () => roomInvitation(location.origin, location.pathname, code, host.area, new URLSearchParams(location.search));

  function block(parent: HTMLElement, before: HTMLElement | null, title: boolean): void {
    const group = document.createElement('section');
    group.className = 'mpControl'; group.dataset.mp = title ? 'title' : 'settings';
    group.setAttribute('aria-label', 'Drive with others');
    group.innerHTML = `<div class="mpHeading"><span>Drive with others</span><button type="button" role="switch" aria-label="Drive with others" class="mpToggle"></button></div>
      <small>Others see your car and handle. Use an invented name, never a real person’s name. Room races also share a road course, checkpoint progress and times; room games share who holds the parcel and the scores.</small>
      <small class="mpInvite"></small>
      <div class="mpRooms"><label>Your name<div class="mpNameRow"><input class="mpName" aria-label="Your name" maxlength="14" autocomplete="off" spellcheck="false" style="text-transform:none;letter-spacing:normal"><button type="button" class="mpDice" aria-label="Pick an invented name">⚄</button></div></label><small class="mpNameHint" role="status">3–14 letters, digits, spaces or hyphens. Invalid names use a call sign.</small>
        <div class="mpChoices"><button type="button" class="mpOpen">Open road</button><button type="button" class="mpPrivate">Private room</button></div>
        <div class="mpPrivateControls">
          <div class="mpCode"><output aria-label="Private room code"></output><button type="button" class="mpNew">New code</button></div>
          <label>Code from a friend<div class="mpJoin"><input type="text" aria-label="Room code" autocomplete="off" autocapitalize="characters" spellcheck="false" pattern="[A-Za-z]{4}"><button type="button" class="mpUse" disabled>Join</button></div></label>
          <small class="mpError" role="status" hidden>Use exactly 4 letters.</small>
          <button type="button" class="mpCopy">Copy invitation link</button>
          <input class="mpLink" aria-label="Invitation link" readonly hidden>
          <small class="mpCopied" role="status" hidden></small>
        </div>
      </div><small class="mpStatus" role="status"></small>`;
    const find = <T extends HTMLElement>(selector: string) => group.querySelector<T>(selector)!;
    const toggle = find<HTMLButtonElement>('.mpToggle'), rooms = find('.mpRooms'), privateControls = find('.mpPrivateControls');
    const open = find<HTMLButtonElement>('.mpOpen'), privateButton = find<HTMLButtonElement>('.mpPrivate');
    const input = find<HTMLInputElement>('.mpJoin input'), use = find<HTMLButtonElement>('.mpUse'), error = find('.mpError');
    const invite = find('.mpInvite'), copied = find('.mpCopied'), link = find<HTMLInputElement>('.mpLink');
    const name = find<HTMLInputElement>('.mpName'); name.value = saved('mmm.mp.handle') ?? '';
    const rename = () => {
      const valid = readHandle(name.value); save('mmm.mp.handle', valid ?? '');
      // The title card and the settings sheet each carry this field: keep the other one showing the same name.
      document.querySelectorAll<HTMLInputElement>('.mpControl .mpName').forEach(other => { other.value = name.value; });
      name.setAttribute('aria-invalid', String(!!name.value && !valid));
      find('.mpNameHint').textContent = valid || !name.value ? '3–14 letters, digits, spaces or hyphens. Use an invented name.' : 'Name unavailable. An invented call sign will be used.';
      stop();
    };
    name.addEventListener('change', rename);
    find('.mpDice').addEventListener('click', () => { name.value = inventedName(); rename(); });
    blocks.push({
      paint() {
        toggle.setAttribute('aria-checked', String(on)); toggle.textContent = on ? 'On' : 'Off';
        rooms.hidden = !on; privateControls.hidden = !code;
        open.setAttribute('aria-pressed', String(!code)); privateButton.setAttribute('aria-pressed', String(!!code));
        find('output').textContent = code.toUpperCase();
        invite.hidden = !title || !on || !invitation || invitation !== code;
        invite.textContent = `You are invited to private room ${code.toUpperCase()}`;
        copied.hidden = link.hidden = true;
      },
      say(text) { find('.mpStatus').textContent = text; },
    });
    toggle.addEventListener('click', () => change(!on));
    open.addEventListener('click', () => change(on, ''));
    privateButton.addEventListener('click', () => change(on, code || newRoomCode()));
    find('.mpNew').addEventListener('click', () => change(on, newRoomCode()));
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[a-z]/g, letter => letter.toUpperCase());
      const valid = roomCode(input.value) !== null;
      use.disabled = !valid; error.hidden = valid || !input.value;
      input.setAttribute('aria-invalid', String(!valid && !!input.value));
    });
    const join = () => { const room = roomCode(input.value); if (room) { change(on, room); input.value = ''; use.disabled = true; } };
    use.addEventListener('click', join);
    input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); join(); } });
    find('.mpCopy').addEventListener('click', async () => {
      const url = invitationLink();
      try { await navigator.clipboard.writeText(url); copied.textContent = 'Link copied.'; }
      catch { link.value = url; link.hidden = false; link.focus(); link.select(); copied.textContent = 'Copy the selected link.'; }
      copied.hidden = false;
    });
    // All keys here belong to a control: typing WASD or H in a room field must never drive or honk.
    group.addEventListener('keydown', ev => ev.stopPropagation());
    parent.insertBefore(group, before);
  }

  if (allowed) {
    document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
    if (host.settings) block(host.settings, host.before, false);
    // The title is made later in main.ts. Observe only until it exists, then release the observer.
    const mountTitle = () => {
      const start = document.getElementById('titleStart');
      if (!start || titleMounted) return;
      titleMounted = true;
      block(start.parentElement!, start.parentElement!.querySelector('.titleFooter'), true); paint();
    };
    const observer = new MutationObserver(() => { mountTitle(); if (titleMounted) observer.disconnect(); });
    mountTitle();
    if (!titleMounted) observer.observe(document.body, { childList: true });
    document.addEventListener('click', ev => {
      if (ev.target instanceof Element && ev.target.closest('#titleStart')) {
        consent = true;
        if (invitation && host.params.get('mp') !== '0') remember();
        paint();
      }
    }, { capture: true });
    addEventListener('pagehide', stop);
    paint();
  }
  return {
    /** Read the live controls when leaving. Arrival prefers fresh saved settings,
     * falling back to this tab's handoff only when storage is unavailable. */
    get choice(): MultiplayerChoice { return { on, room: code || null }; },
    /** Re-read preferences at arrival: an Off saved during navigation beats an invitation. */
    get storedChoice(): MultiplayerChoice | null {
      try {
        const value = localStorage.getItem('mmm.mp');
        if (value === '0') return { on: false, room: roomCode(saved('mmm.mp.room') ?? '') };
        if (value === '1') return { on: true, room: roomCode(localStorage.getItem('mmm.mp.room') ?? '') };
      } catch { /* unavailable storage: use this tab's latest explicit choice */ }
      return null;
    },
    restoreChoice(choice: MultiplayerChoice): void { change(choice.on, roomCode(choice.room ?? '') ?? ''); },
    /** Dev checks can inspect the live instance, without importing it while Off. */
    get current() { return current; },
    update(dt: number, camera: THREE.Camera, running: boolean): void {
      if (!allowed) return;
      // An address that starts without a title card (a placement or test address) has no start button to press.
      // Then only a development build, or the player's own saved yes, may connect. Invitations always need the button.
      if (running && startsWithoutButton(DEV, prior, !!invitation, !!document.getElementById('titleStart'))) consent = true;
      load();
      current?.update(dt, camera, running);
      const next = !on ? '' : !consent ? 'Starts when you press the start button.' : failed ? 'Driving with others is not available now.'
        : current?.status ?? 'Looking for other drivers…';
      if (next !== status) { status = next; blocks.forEach(b => b.say(status)); }
    },
    marks(out: { x: number; z: number }[]): void { out.length = 0; current?.marks(out); },
    /** Adds the room game's parcel to the small map's marks (nothing outside a game). */
    gameMarks(out: { x: number; z: number; label: string; rank?: number; colour?: string }[]): void { current?.gameMarks(out); },
    reset(): void { current?.net.teleport(); },
    horn(): void { current?.net.horn(); },
  };
}
